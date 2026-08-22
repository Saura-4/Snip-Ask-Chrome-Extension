// src/content/chat/regeneration.js
// Regenerate / vision-retry request flows for FloatingChatUI.
// All functions receive the owning UI instance as their first argument.

/**
 * Retry an assistant message with the Auto vision-capable model.
 * @param {FloatingChatUI} ui
 * @param {number} index
 */
async function retryAssistantWithVision(ui, index) {
    if (ui.isGeneratingResponse()) return;
    if (!ui._shouldShowVisionRetry(index)) return;

    const image = ui._getVisionRetryImageForIndex(index);
    if (!image) return;

    const requestId = ui.showTypingIndicator();

    try {
        const response = await chrome.runtime.sendMessage({
            action: "ASK_AI",
            model: 'groq:auto',
            base64Image: image,
            mode: ui.currentMode,
            requestId
        });

        ui.removeTypingIndicator();
        if (ui._requestCancelled) return;

        if (response && response.success) {
            const responseModel = response.responseModel || response.model || 'qwen/qwen3.6-27b';
            const metadata = ui._createAssistantMetadata(response, {
                selectedModel: 'groq:auto',
                responseModel,
                usedOCR: false,
                visionRetry: true
            });
            const replacement = createChatHistoryEntry(
                'assistant',
                response.answer,
                responseModel,
                null,
                ui.chatHistory[index]?.isRegenerated || false,
                metadata
            );
            replacement.timestamp = ui.chatHistory[index]?.timestamp || replacement.timestamp;
            ui.chatHistory[index] = replacement;
            ui._rerenderChatHistory();
            if (response.guestInfo) {
                updateLocalGuestCache(response.guestInfo);
            }
            ui.onSessionChanged?.();
        } else if (typeof showErrorToast === 'function') {
            showErrorToast("Vision retry failed: " + (response?.error || "Unknown error"));
        } else {
            console.warn("Vision retry failed:", response?.error || "Unknown error");
        }
    } catch (error) {
        ui.removeTypingIndicator();
        if (ui._requestCancelled) return;
        if (typeof showErrorToast === 'function') {
            showErrorToast("Vision retry failed: " + (error?.message || String(error)));
        } else {
            console.warn("Vision retry failed:", error);
        }
    }
}

/**
 * Regenerate the last assistant response.
 * @param {FloatingChatUI} ui
 */
async function regenerateLastChatResponse(ui) {
    // Find last assistant message index and regenerate from there
    for (let i = ui.chatHistory.length - 1; i >= 0; i--) {
        if (ui.chatHistory[i].role === 'assistant') {
            await regenerateChatResponseAt(ui, i);
            return;
        }
    }
}

/**
 * Regenerate response at a specific index - "rewinds" conversation to that point
 * @param {FloatingChatUI} ui
 * @param {number} index - The index of the assistant message to regenerate
 */
async function regenerateChatResponseAt(ui, index) {
    if (index < 0 || index >= ui.chatHistory.length) return;
    if (ui.chatHistory[index].role !== 'assistant') return;

    // Find the user message that triggered this response
    let userMsgIndex = -1;
    for (let i = index - 1; i >= 0; i--) {
        if (ui.chatHistory[i].role === 'user') {
            userMsgIndex = i;
            break;
        }
    }
    if (userMsgIndex === -1) return;

    // Slice history to remove everything from the target index onward ("rewind")
    const messagesToRemove = ui.chatHistory.length - index;
    ui.chatHistory = ui.chatHistory.slice(0, index);

    // Remove corresponding DOM elements from chatBody
    for (let i = 0; i < messagesToRemove; i++) {
        const lastChild = ui.chatBody.lastElementChild;
        if (lastChild && !lastChild.classList?.contains('typing-container')) {
            lastChild.remove();
        }
    }

    const requestId = ui.showTypingIndicator();

    try {
        let response;
        let responseMetadataOverrides = { selectedModel: ui.currentModel };

        // Collect all images from history up to (and including) the user message
        const imagesToSend = [];
        for (let i = 0; i <= userMsgIndex; i++) {
            if (ui.chatHistory[i].base64Image) {
                imagesToSend.push(ui.chatHistory[i].base64Image);
            }
        }
        // Also include initialBase64Image if not already in history
        if (ui.initialBase64Image && !imagesToSend.includes(ui.initialBase64Image)) {
            imagesToSend.unshift(ui.initialBase64Image);
        }

        // Check if we need to include image data for vision models
        const isAutoGuestModel = ui.currentModel === 'groq:auto';

        if (!isAutoGuestModel && isVisionModel(ui.currentModel)) {
            if (imagesToSend.length > 0) {
                // Use multi-image if multiple, single image otherwise
                if (imagesToSend.length === 1) {
                    response = await chrome.runtime.sendMessage({
                        action: "ASK_AI",
                        model: ui.currentModel,
                        base64Image: imagesToSend[0],
                        mode: ui.currentMode,
                        requestId
                    });
                } else {
                    response = await chrome.runtime.sendMessage({
                        action: "ASK_AI_MULTI_IMAGE",
                        model: ui.currentModel,
                        images: imagesToSend,
                        textContext: extractUserTextFromHistory(ui.chatHistory, userMsgIndex),
                        mode: ui.currentMode,
                        requestId
                    });
                }
            } else {
                // No images, use text chat
                response = await chrome.runtime.sendMessage({
                    action: "CONTINUE_CHAT",
                    model: ui.currentModel,
                    history: buildApiHistoryFromChat(ui.chatHistory, userMsgIndex),
                    mode: ui.currentMode,
                    requestId
                });
            }
        } else {
            // Non-vision model - need to use OCR text if there are images
            if (imagesToSend.length > 0) {
                let ocrTextParts = [];

                if (isAutoGuestModel) {
                    const autoOcr = await collectReliableAutoOcrText(ui, imagesToSend, 'regenerate');
                    ocrTextParts = autoOcr.reliable ? autoOcr.textParts : [];
                } else {
                    // OCR all images and build context
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
                    // Build history with OCR text as the first user message
                    const ocrContext = ocrTextParts.join('\n---\n');
                    const historyWithOcr = [
                        { role: 'user', content: `[Image content extracted via OCR]:\n${ocrContext}` },
                        ...buildApiHistoryFromChat(ui.chatHistory, userMsgIndex).slice(1) // Skip original first message, use OCR instead
                    ];

                    response = await chrome.runtime.sendMessage({
                        action: "CONTINUE_CHAT",
                        model: ui.currentModel,
                        history: historyWithOcr,
                        mode: ui.currentMode,
                        usedOCR: isAutoGuestModel,
                        requestId
                    });
                    responseMetadataOverrides.usedOCR = isAutoGuestModel;
                } else if (isAutoGuestModel) {
                    const textContext = buildApiHistoryFromChat(ui.chatHistory, userMsgIndex)
                        .map(m => `${m.role}: ${m.content}`)
                        .join('\n');
                    response = await sendAutoVisionFallback(ui, imagesToSend, textContext, requestId);
                } else {
                    // OCR failed, use text history as fallback
                    response = await chrome.runtime.sendMessage({
                        action: "CONTINUE_CHAT",
                        model: ui.currentModel,
                        history: buildApiHistoryFromChat(ui.chatHistory, userMsgIndex),
                        mode: ui.currentMode,
                        requestId
                    });
                }
            } else {
                // No images, use text history
                response = await chrome.runtime.sendMessage({
                    action: "CONTINUE_CHAT",
                    model: ui.currentModel,
                    history: buildApiHistoryFromChat(ui.chatHistory, userMsgIndex),
                    mode: ui.currentMode,
                    requestId
                });
            }
        }

        ui.removeTypingIndicator();

        if (ui._requestCancelled) return; // User clicked Stop

        if (response && response.success) {
            // Add regenerated indicator to the response
            ui.addMessage(
                'assistant',
                response.answer,
                response.responseModel || response.model || ui.currentModel,
                false,
                null,
                true,
                response.tokenUsage || null,
                ui._createAssistantMetadata(response, responseMetadataOverrides)
            );
            if (response.guestInfo) {
                updateLocalGuestCache(response.guestInfo);
            }
        } else {
            ui.addMessage('assistant', "⚠️ Regenerate failed: " + (response?.error || "Unknown error"), ui.currentModel, true);
        }
    } catch (e) {
        ui.removeTypingIndicator();
        if (ui._requestCancelled) return;
        ui.addMessage('assistant', "⚠️ Network Error: " + e.message, ui.currentModel, true);
    }
}

function isReliableAutoOcrResult(ocrResult) {
    return ocrResult?.reliable === true &&
        typeof ocrResult.text === 'string' &&
        ocrResult.text.trim().length > 3;
}

function logAutoOcrFallback(context, ocrResult) {
    console.debug(
        "Auto OCR unreliable; using vision fallback:",
        context,
        ocrResult?.reason || ocrResult?.error || 'unreliable_ocr'
    );
}

async function collectReliableAutoOcrText(ui, images, context) {
    const ocrTextParts = [];

    for (const img of images) {
        let ocrResult;
        try {
            ocrResult = await chrome.runtime.sendMessage({
                action: "PERFORM_OCR",
                base64Image: img
            });
        } catch (error) {
            logAutoOcrFallback(context, {
                reason: 'ocr_request_failed',
                error: error?.message || String(error)
            });
            return { reliable: false, textParts: [] };
        }

        if (!isReliableAutoOcrResult(ocrResult)) {
            logAutoOcrFallback(context, ocrResult);
            return { reliable: false, textParts: [] };
        }

        ocrTextParts.push(ocrResult.text);
    }

    return {
        reliable: ocrTextParts.length > 0,
        textParts: ocrTextParts
    };
}

async function sendAutoVisionFallback(ui, images, textContext, requestId) {
    if (images.length === 1 && !textContext) {
        return chrome.runtime.sendMessage({
            action: "ASK_AI",
            model: ui.currentModel,
            base64Image: images[0],
            mode: ui.currentMode,
            requestId
        });
    }

    return chrome.runtime.sendMessage({
        action: "ASK_AI_MULTI_IMAGE",
        model: ui.currentModel,
        images,
        textContext,
        mode: ui.currentMode,
        requestId
    });
}
