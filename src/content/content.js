// src/content/content.js
// Main orchestrator - coordinates between modules
// Dependencies are loaded via manifest.json content_scripts array in order

/**
 * Message Listener - Entry point for extension messages
 */
let pendingSnipConfig = null;
let activeOverlayRequestId = 0;
const cancelledOverlayRequestIds = new Set();

function beginOverlayRequest() {
    activeOverlayRequestId += 1;
    return activeOverlayRequestId;
}

function cancelActiveOverlayRequest() {
    if (activeOverlayRequestId) {
        cancelledOverlayRequestIds.add(activeOverlayRequestId);
    }
    pendingSnipConfig = null;
}

function isOverlayRequestCancelled(requestId) {
    return Boolean(requestId && cancelledOverlayRequestIds.has(requestId));
}

function finishOverlayRequest(requestId) {
    if (requestId) {
        cancelledOverlayRequestIds.delete(requestId);
    }
}

document.addEventListener('snipAskCancelActiveRequest', cancelActiveOverlayRequest);

function isExtensionContextInvalidatedError(error) {
    const message = typeof error === 'string'
        ? error
        : (error?.message || error?.reason?.message || String(error || ''));
    return message.includes('Extension context invalidated');
}

window.addEventListener('error', (event) => {
    if (isExtensionContextInvalidatedError(event.error || event.message)) {
        event.preventDefault();
    }
}, true);

window.addEventListener('unhandledrejection', (event) => {
    if (isExtensionContextInvalidatedError(event.reason)) {
        event.preventDefault();
    }
}, true);

function getSessionModel(apiResponse, responseContext = {}) {
    return apiResponse.selectedModel || responseContext.model || apiResponse.model || null;
}

function getResponseModel(apiResponse, responseContext = {}) {
    return apiResponse.responseModel || apiResponse.model || responseContext.model || null;
}

function buildSessionFromApiResponse(apiResponse, responseContext = {}) {
    const sessionModel = getSessionModel(apiResponse, responseContext);
    const responseModel = getResponseModel(apiResponse, responseContext);
    const userEntry = createChatHistoryEntry(
        'user',
        apiResponse.initialUserMessage,
        null,
        apiResponse.base64Image || null,
        false
    );
    const assistantEntry = createChatHistoryEntry(
        'assistant',
        apiResponse.answer,
        responseModel,
        null,
        false
    );

    return {
        uiId: crypto.randomUUID(),
        chatHistory: [userEntry, assistantEntry],
        currentModel: sessionModel,
        currentMode: responseContext.mode || null,
        availableModels: [],
        customModes: [],
        customPrompt: '',
        initialUserMessage: apiResponse.initialUserMessage,
        initialBase64Image: apiResponse.base64Image || null,
        allImages: apiResponse.base64Image ? [apiResponse.base64Image] : [],
        lastUpdated: Date.now()
    };
}

function mergeSidebarSession(existingSession, apiResponse, responseContext = {}) {
    const sessionModel = getSessionModel(apiResponse, responseContext);
    const responseModel = getResponseModel(apiResponse, responseContext);
    const priorHistory = Array.isArray(existingSession?.chatHistory)
        ? existingSession.chatHistory.map((message) => ({ ...message }))
        : [];
    const priorImages = Array.isArray(existingSession?.allImages)
        ? [...existingSession.allImages]
        : [];

    const userEntry = createChatHistoryEntry(
        'user',
        apiResponse.initialUserMessage,
        null,
        apiResponse.base64Image || null,
        false
    );
    const assistantEntry = createChatHistoryEntry(
        'assistant',
        apiResponse.answer,
        responseModel,
        null,
        false
    );

    if (apiResponse.base64Image && !priorImages.includes(apiResponse.base64Image)) {
        priorImages.push(apiResponse.base64Image);
    }

    return {
        ...(existingSession || {}),
        chatHistory: [...priorHistory, userEntry, assistantEntry],
        currentModel: sessionModel || existingSession?.currentModel || null,
        currentMode: responseContext.mode || existingSession?.currentMode || null,
        initialUserMessage: existingSession?.initialUserMessage || apiResponse.initialUserMessage,
        initialBase64Image: existingSession?.initialBase64Image || apiResponse.base64Image || null,
        allImages: priorImages,
        lastUpdated: Date.now()
    };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === '__PING__') {
        sendResponse({ ok: true });
        return false;
    }

    if (request.action === "START_SNIP") {
        pendingSnipConfig = {
            appendToSidebar: request.appendToSidebar === true,
            model: request.model || null,
            mode: request.mode || null
        };
        if (SnipSelection.isActive()) return true;

        SnipSelection.start(handleSnipComplete);
        sendResponse({ status: "Snip started" });
    }

    // Handle text selection from context menu
    if (request.action === "SHOW_AI_RESPONSE_FOR_TEXT") {
        if (typeof showLoadingCursor === 'function') showLoadingCursor();
        const requestId = beginOverlayRequest();

        // Read mode from storage to pass explicitly
        chrome.storage.local.get(['selectedMode', 'interactionMode'], (modeStorage) => {
            if (isOverlayRequestCancelled(requestId)) return;
            const mode = modeStorage.selectedMode || modeStorage.interactionMode || 'short';
            chrome.runtime.sendMessage({
                action: "ASK_AI_TEXT",
                text: request.text,
                mode: mode
            }, (apiResponse) => handleResponse(apiResponse, { requestId }));
        });

        sendResponse({ status: "Processing text" });
    }

    if (request.action === 'OPEN_FLOATING_CHAT_SESSION') {
        (async () => {
            const ui = await FloatingChatUI.createFromSession(request.session || {}, { isSidePanelHost: false });
            ui.setDisplayMode('popup');
            WindowManager.register(ui);

            if (request.compare) {
                // When comparing from the side panel, sourceModel tells us which
                // model the sidebar is using so we can pick a different one.
                const sourceModel = request.sourceModel || ui.currentModel;
                let otherModel = null;

                // Find a model that's different from the source
                for (const m of ui.availableModels) {
                    if (m.value !== sourceModel) {
                        otherModel = m.value;
                        break;
                    }
                }

                if (otherModel && ui.modelSelect) {
                    ui.currentModel = otherModel;
                    ui.modelSelect.value = otherModel;
                }
                await ui.regenerateLastResponse();
            }
        })();

        sendResponse({ status: 'Popup opened' });
    }

    if (request.action === 'BROADCAST_TO_POPUP_WINDOWS') {
        if (WindowManager.windows.length === 0) {
            sendResponse({ success: false });
            return false;
        }

        const windowCount = WindowManager.windows.length;
        WindowManager.pendingResponses = windowCount;
        WindowManager.windows.forEach((w) => w.setInputDisabled(true));
        WindowManager.windows.forEach((w, index) => {
            const windowMode = w.currentMode || 'short';
            w.sendMessageDirect(request.text, index === 0 ? windowCount : 0, windowMode);
        });
        sendResponse({ success: true, count: windowCount });
        return false;
    }

    return true;
});

/**
 * Handle snip selection completion
 * @param {DOMRect} rect - The selection rectangle
 */
function handleSnipComplete(rect) {
    const requestConfig = pendingSnipConfig || { model: null, mode: null };
    pendingSnipConfig = null;
    const requestId = beginOverlayRequest();

    // Capture Screenshot
    chrome.runtime.sendMessage({
        action: "CAPTURE_VISIBLE_TAB"
    }, (response) => {
        if (isOverlayRequestCancelled(requestId)) return;
        if (!response || !response.dataUrl) {
            alert("Screenshot failed. Reload page.");
            if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
            finishOverlayRequest(requestId);
            return;
        }

        if (typeof showLoadingCursor === 'function') showLoadingCursor();

        // Crop the image
        cropImage(response.dataUrl, rect, async (croppedBase64) => {
            if (isOverlayRequestCancelled(requestId)) return;

            // Show first-time privacy toast (only once per user)
            chrome.storage.local.get(['hasShownSnipToast'], (res) => {
                if (isOverlayRequestCancelled(requestId)) return;
                if (!res.hasShownSnipToast) {
                    chrome.storage.local.set({ hasShownSnipToast: true });
                    const toast = document.createElement('div');
                    toast.textContent = '📸 Screenshot captured locally (not stored)';
                    toast.style.cssText = `
                        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                        background: #2d2d2d; color: #ccc; padding: 10px 20px;
                        border-radius: 8px; font-family: 'Segoe UI', sans-serif;
                        z-index: 2147483647; border: 1px solid #f55036;
                    `;
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 3000);
                }
            });

            // Check if this is a snip-again (add to existing chat)
            if (window._snipAgainMode && window._snipAgainTarget) {
                window._snipAgainMode = false;
                const targetUI = window._snipAgainTarget;
                window._snipAgainTarget = null;

                if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                finishOverlayRequest(requestId);
                targetUI.addSnippedImage(croppedBase64);
                return;
            }

            // Ask background.js to check provider config (keys never touch content script)
            chrome.runtime.sendMessage({
                action: "CHECK_PROVIDER_CONFIG",
                model: requestConfig.model
            }, async (configResult) => {
                if (isOverlayRequestCancelled(requestId)) return;
                if (chrome.runtime.lastError || !configResult?.success) {
                    showErrorToast("Failed to check configuration. Please reload the page.");
                    if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                    finishOverlayRequest(requestId);
                    return;
                }

                const currentModel = configResult.model;
                const currentMode = requestConfig.mode || configResult.mode || 'short';
                const isAutoGuestModel = currentModel === 'groq:auto';

                if (!configResult.isConfigured) {
                    showErrorToast(`Please set your ${configResult.providerName} in the extension popup!`);
                    if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                    chrome.runtime.sendMessage({ action: "OPEN_OPTIONS_PAGE" });
                    finishOverlayRequest(requestId);
                    return;
                }

                if (!isAutoGuestModel && isVisionModel(currentModel)) {
                    chrome.runtime.sendMessage({
                        action: "ASK_AI",
                        model: currentModel,
                        base64Image: croppedBase64,
                        mode: currentMode
                    }, (apiResponse) => handleResponse(apiResponse, { ...requestConfig, model: currentModel, mode: currentMode, requestId }));
                    return;
                }

                // === PATH B: TEXT MODEL (Engage OCR via Background) ===

                chrome.runtime.sendMessage({
                    action: "PERFORM_OCR",
                    base64Image: croppedBase64
                }, (ocrResponse) => {
                    if (isOverlayRequestCancelled(requestId)) return;

                    if (chrome.runtime.lastError || !ocrResponse) {
                        showErrorToast("OCR Failed: " + (chrome.runtime.lastError?.message || "Unknown error"));
                        if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                        finishOverlayRequest(requestId);
                        return;
                    }

                    // Handle OCR quality failures with helpful messages
                    if (!ocrResponse.success && ocrResponse.error) {
                        console.debug("OCR Quality Check Failed:", ocrResponse.error);
                    }

                    if (ocrResponse.success && ocrResponse.text && ocrResponse.text.length > 3) {
                        chrome.runtime.sendMessage({
                            action: "ASK_AI_TEXT",
                            model: currentModel,
                            text: ocrResponse.text,
                            ocrConfidence: ocrResponse.confidence,
                            mode: currentMode
                        }, (apiResponse) => handleResponse(apiResponse, { ...requestConfig, model: currentModel, mode: currentMode, requestId }));
                    } else {
                        console.debug("OCR Empty or Failed:", ocrResponse.error || 'No readable text');
                        if (isAutoGuestModel || isVisionModel(currentModel)) {
                            chrome.runtime.sendMessage({
                                action: "ASK_AI",
                                model: currentModel,
                                base64Image: croppedBase64,
                                mode: currentMode
                            }, (apiResponse) => handleResponse(apiResponse, { ...requestConfig, model: currentModel, mode: currentMode, requestId }));
                        } else {
                            alert(`⚠️ No text found in snippet.\n\nSince '${currentModel}' cannot see images, please try snipping clearer text or switch to a Vision model.`);
                            if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                            finishOverlayRequest(requestId);
                        }
                    }
                });
            });
        });
    });
}

/**
 * Handle API response - create chat window with result
 * @param {Object} apiResponse
 */
async function handleResponse(apiResponse, responseContext = {}) {
    if (isOverlayRequestCancelled(responseContext.requestId)) {
        finishOverlayRequest(responseContext.requestId);
        return;
    }

    if (typeof hideLoadingCursor === 'function') hideLoadingCursor();

    if (apiResponse && apiResponse.success) {
        const storage = await chrome.storage.local.get(['chatDisplayMode', 'sidePanelSession', 'pendingSidebarSnip']);
        if (isOverlayRequestCancelled(responseContext.requestId)) {
            finishOverlayRequest(responseContext.requestId);
            return;
        }
        const preferredMode = storage.chatDisplayMode === 'sidebar' ? 'sidebar' : 'popup';

        if (preferredMode === 'sidebar') {
            const isAppend = responseContext.appendToSidebar === true;
            let session;
            if (isAppend) {
                session = mergeSidebarSession(storage.sidePanelSession || null, apiResponse, responseContext);
            } else {
                session = buildSessionFromApiResponse(apiResponse, responseContext);
            }

            // Use OPEN_SIDE_PANEL_WITH_SESSION for new sessions to ensure the panel
            // is actually open. For appends the panel should already be open, so use
            // SET_SIDE_PANEL_SESSION to avoid the user-gesture restriction.
            const sidePanelAction = isAppend ? 'SET_SIDE_PANEL_SESSION' : 'OPEN_SIDE_PANEL_WITH_SESSION';
            const sidePanelResult = await chrome.runtime.sendMessage({
                action: sidePanelAction,
                session
            });
            if (isOverlayRequestCancelled(responseContext.requestId)) {
                finishOverlayRequest(responseContext.requestId);
                return;
            }
            if (storage.pendingSidebarSnip === true) {
                await chrome.storage.local.remove('pendingSidebarSnip');
            }

            if (sidePanelResult?.success) {
                if (apiResponse.guestInfo) {
                    updateLocalGuestCache(apiResponse.guestInfo);
                }
                finishOverlayRequest(responseContext.requestId);
                return;
            }

            showErrorToast(sidePanelResult?.error || 'Could not open sidebar. Showing popup instead.');
        } else {
            // Close all existing chat windows on new snip
            WindowManager.closeAll();

            const ui = await FloatingChatUI.create();
            WindowManager.register(ui);

            // Pass base64Image so image thumbnail appears in chat
            ui.addMessage('user', apiResponse.initialUserMessage, null, false, apiResponse.base64Image || null);
            ui.addMessage('assistant', apiResponse.answer, getResponseModel(apiResponse, responseContext), false, null, false, apiResponse.tokenUsage);

            // Store initial state for comparison cloning
            ui.initialUserMessage = apiResponse.initialUserMessage;
            ui.initialBase64Image = apiResponse.base64Image || null;

            // Update local guest usage cache if guestInfo is returned
            if (apiResponse.guestInfo) {
                updateLocalGuestCache(apiResponse.guestInfo);
            }
            finishOverlayRequest(responseContext.requestId);
            return;
        }

        // Fallback popup when sidebar open fails
        WindowManager.closeAll();

        const ui = await FloatingChatUI.create();
        WindowManager.register(ui);
        ui.addMessage('user', apiResponse.initialUserMessage, null, false, apiResponse.base64Image || null);
        ui.addMessage('assistant', apiResponse.answer, getResponseModel(apiResponse, responseContext), false, null, false, apiResponse.tokenUsage);
        ui.initialUserMessage = apiResponse.initialUserMessage;
        ui.initialBase64Image = apiResponse.base64Image || null;

        if (apiResponse.guestInfo) {
            updateLocalGuestCache(apiResponse.guestInfo);
        }
        finishOverlayRequest(responseContext.requestId);
    } else {
        // Show error in a styled toast instead of native alert
        if (!isOverlayRequestCancelled(responseContext.requestId)) {
            showErrorToast(apiResponse ? apiResponse.error : "Unknown error");
        }
        finishOverlayRequest(responseContext.requestId);
    }
}

// Expose handleSnipComplete globally for snip-again flow
window.handleSnipComplete = handleSnipComplete;
