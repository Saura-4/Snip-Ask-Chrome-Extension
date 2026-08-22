// src/content/chat/compare.js
// Compare-mode window spawning for FloatingChatUI.
// All functions receive the owning UI instance as their first argument.

/**
 * Spawn a comparison window with a different model.
 * Duplicates the entire chat history and regenerates the last response.
 * @param {FloatingChatUI} ui
 */
async function spawnCompareWindowFor(ui) {
    if (WindowManager.isMaxReached()) {
        showErrorToast(`Maximum ${WindowManager.maxWindows} comparison windows allowed`);
        return;
    }

    // Find the last assistant message index in current chat
    let lastAssistantIndex = -1;
    for (let i = ui.chatHistory.length - 1; i >= 0; i--) {
        if (ui.chatHistory[i].role === 'assistant') {
            lastAssistantIndex = i;
            break;
        }
    }

    if (lastAssistantIndex === -1) {
        showErrorToast("No response to compare yet");
        return;
    }

    const newUI = await FloatingChatUI.create();
    newUI.setDisplayMode('popup');
    WindowManager.register(newUI);

    // Copy all state to compare window
    newUI.initialUserMessage = ui.initialUserMessage;
    newUI.initialBase64Image = ui.initialBase64Image;
    newUI.allImages = [...ui.allImages];
    newUI.isGuestMode = ui.isGuestMode;

    // Inherit mode from parent window
    newUI.currentMode = ui.currentMode;
    if (newUI.modeSelect) newUI.modeSelect.value = ui.currentMode;

    // Select a different model
    const otherModel = getNextAvailableChatModel(ui);
    if (otherModel && newUI.modelSelect) {
        newUI.currentModel = otherModel;
        newUI.modelSelect.value = otherModel;
    }

    // Clone all messages UP TO (but not including) the last assistant message
    // This preserves the full conversation context
    for (let i = 0; i < lastAssistantIndex; i++) {
        const msg = ui.chatHistory[i];
        // Recreate each message in the new window (without adding to DOM twice)
        newUI.chatHistory.push({
            role: msg.role,
            content: msg.content,
            displayText: msg.displayText,
            model: msg.model,
            base64Image: msg.base64Image,
            isRegenerated: msg.isRegenerated,
            metadata: msg.metadata ? { ...msg.metadata } : null,
            timestamp: msg.timestamp
        });

        // Render the message in the UI
        renderClonedChatMessage(newUI, msg);
    }

    // Now regenerate the last response with the new model
    const requestId = newUI.showTypingIndicator();

    try {
        let response;
        let responseMetadataOverrides = { selectedModel: newUI.currentModel };

        // Collect all images from history
        const imagesToSend = [];
        if (newUI.initialBase64Image) {
            imagesToSend.push(newUI.initialBase64Image);
        }
        for (let i = 0; i < newUI.chatHistory.length; i++) {
            if (newUI.chatHistory[i].base64Image && !imagesToSend.includes(newUI.chatHistory[i].base64Image)) {
                imagesToSend.push(newUI.chatHistory[i].base64Image);
            }
        }

        // Build full conversation history as text
        const apiHistory = buildApiHistoryFromChat(newUI.chatHistory, newUI.chatHistory.length - 1);
        const fullTextContext = apiHistory.map(m => `${m.role}: ${m.content}`).join('\n');

        const isAutoGuestModel = newUI.currentModel === 'groq:auto';

        if (!isAutoGuestModel && isVisionModel(newUI.currentModel) && imagesToSend.length > 0) {
            // Vision model with images: Always use MULTI_IMAGE which supports textContext
            // ASK_AI does NOT support additionalContext, so we must use MULTI_IMAGE even for 1 image
            response = await chrome.runtime.sendMessage({
                action: "ASK_AI_MULTI_IMAGE",
                model: newUI.currentModel,
                images: imagesToSend,
                textContext: fullTextContext,
                mode: newUI.currentMode,
                requestId
            });
        } else if (!isVisionModel(newUI.currentModel) && imagesToSend.length > 0) {
            // Non-vision model with images: Extract text via OCR first
            let ocrTextParts = [];

            if (isAutoGuestModel) {
                const autoOcr = await collectReliableAutoOcrText(newUI, imagesToSend, 'compare');
                ocrTextParts = autoOcr.reliable ? autoOcr.textParts : [];
            } else {
                for (const img of imagesToSend) {
                    const ocrResult = await chrome.runtime.sendMessage({
                        action: "PERFORM_OCR",
                        base64Image: img
                    });
                    if (ocrResult?.success && ocrResult.text) {
                        ocrTextParts.push(ocrResult.text);
                    }
                }
            }

            if (ocrTextParts.length > 0) {
                // Inject OCR context at the start of history
                const ocrContext = ocrTextParts.join('\n---\n');
                const historyWithOcr = [
                    { role: 'user', content: `[Image content extracted via OCR]:\n${ocrContext}` },
                    ...apiHistory.slice(1) // Skip first message which references the image
                ];

                response = await chrome.runtime.sendMessage({
                    action: "CONTINUE_CHAT",
                    model: newUI.currentModel,
                    history: historyWithOcr,
                    mode: newUI.currentMode,
                    usedOCR: isAutoGuestModel,
                    requestId
                });
                responseMetadataOverrides.usedOCR = isAutoGuestModel;
            } else if (isAutoGuestModel) {
                response = await sendAutoVisionFallback(newUI, imagesToSend, fullTextContext, requestId);
            } else {
                // OCR failed, just use text history
                response = await chrome.runtime.sendMessage({
                    action: "CONTINUE_CHAT",
                    model: newUI.currentModel,
                    history: apiHistory,
                    mode: newUI.currentMode,
                    requestId
                });
            }
        } else {
            // No images: Use text-only chat
            response = await chrome.runtime.sendMessage({
                action: "CONTINUE_CHAT",
                model: newUI.currentModel,
                history: apiHistory,
                mode: newUI.currentMode,
                requestId
            });
        }

        newUI.removeTypingIndicator();
        if (newUI._requestCancelled) return; // User clicked Stop
        if (response && response.success) {
            const responseModel = response.responseModel || response.model || newUI.currentModel;
            newUI.addMessage(
                'assistant',
                response.answer,
                responseModel,
                false,
                null,
                false,
                response.tokenUsage,
                newUI._createAssistantMetadata(response, responseMetadataOverrides)
            );
            if (response.guestInfo) {
                updateLocalGuestCache(response.guestInfo);
            }
        } else {
            newUI.addMessage('assistant', "⚠️ Error: " + (response?.error || "Unknown error"), newUI.currentModel, true);
        }
    } catch (e) {
        newUI.removeTypingIndicator();
        if (newUI._requestCancelled) return;
        newUI.addMessage('assistant', "⚠️ Network Error: " + e.message, newUI.currentModel, true);
    }
}

/**
 * Pick the first model not already used by an open window.
 * @param {FloatingChatUI} ui
 */
function getNextAvailableChatModel(ui) {
    const usedModels = WindowManager.windows.map(w => w.currentModel);
    for (const m of ui.availableModels) {
        if (!usedModels.includes(m.value)) return m.value;
    }
    return ui.availableModels.find(m => m.value !== ui.currentModel)?.value || null;
}
