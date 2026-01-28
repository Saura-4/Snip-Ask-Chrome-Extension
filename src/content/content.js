// src/content/content.js
// Main orchestrator - coordinates between modules
// Dependencies are loaded via manifest.json content_scripts array in order

/**
 * Message Listener - Entry point for extension messages
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_SNIP") {
        if (SnipSelection.isActive()) return true;

        SnipSelection.start(handleSnipComplete);
        sendResponse({ status: "Snip started" });
    }

    // Handle text selection from context menu
    if (request.action === "SHOW_AI_RESPONSE_FOR_TEXT") {
        if (typeof showLoadingCursor === 'function') showLoadingCursor();

        chrome.runtime.sendMessage({
            action: "ASK_AI_TEXT",
            text: request.text
        }, handleResponse);

        sendResponse({ status: "Processing text" });
    }

    return true;
});

/**
 * Handle snip selection completion
 * @param {DOMRect} rect - The selection rectangle
 */
function handleSnipComplete(rect) {
    // Capture Screenshot
    chrome.runtime.sendMessage({
        action: "CAPTURE_VISIBLE_TAB"
    }, (response) => {
        if (!response || !response.dataUrl) {
            alert("Screenshot failed. Reload page.");
            if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
            return;
        }

        if (typeof showLoadingCursor === 'function') showLoadingCursor();

        // Crop the image
        cropImage(response.dataUrl, rect, async (croppedBase64) => {

            // Show first-time privacy toast (only once per user)
            chrome.storage.local.get(['hasShownSnipToast'], (res) => {
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
                targetUI.addSnippedImage(croppedBase64);
                return;
            }

            // Ask background.js to check provider config (keys never touch content script)
            chrome.runtime.sendMessage({ action: "CHECK_PROVIDER_CONFIG" }, async (configResult) => {
                if (chrome.runtime.lastError || !configResult?.success) {
                    showErrorToast("Failed to check configuration. Please reload the page.");
                    if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                    return;
                }

                const currentModel = configResult.model;

                if (!configResult.isConfigured) {
                    showErrorToast(`Please set your ${configResult.providerName} in the extension popup!`);
                    if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                    chrome.runtime.sendMessage({ action: "OPEN_OPTIONS_PAGE" });
                    return;
                }

                if (isVisionModel(currentModel)) {
                    chrome.runtime.sendMessage({
                        action: "ASK_AI",
                        model: currentModel,
                        base64Image: croppedBase64
                    }, handleResponse);
                    return;
                }

                // === PATH B: TEXT MODEL (Engage OCR via Background) ===

                chrome.runtime.sendMessage({
                    action: "PERFORM_OCR",
                    base64Image: croppedBase64
                }, (ocrResponse) => {

                    if (chrome.runtime.lastError || !ocrResponse) {
                        showErrorToast("OCR Failed: " + (chrome.runtime.lastError?.message || "Unknown error"));
                        if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                        return;
                    }

                    // Handle OCR quality failures with helpful messages
                    if (!ocrResponse.success && ocrResponse.error) {
                        console.warn("OCR Quality Check Failed:", ocrResponse.error);
                    }

                    if (ocrResponse.success && ocrResponse.text && ocrResponse.text.length > 3) {
                        chrome.runtime.sendMessage({
                            action: "ASK_AI_TEXT",
                            model: currentModel,
                            text: ocrResponse.text,
                            ocrConfidence: ocrResponse.confidence
                        }, handleResponse);
                    } else {
                        console.warn("OCR Empty or Failed:", ocrResponse.error || 'No readable text');
                        if (isVisionModel(currentModel)) {
                            chrome.runtime.sendMessage({
                                action: "ASK_AI",
                                model: currentModel,
                                base64Image: croppedBase64
                            }, handleResponse);
                        } else {
                            alert(`⚠️ No text found in snippet.\n\nSince '${currentModel}' cannot see images, please try snipping clearer text or switch to a Vision model.`);
                            if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
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
async function handleResponse(apiResponse) {
    if (typeof hideLoadingCursor === 'function') hideLoadingCursor();

    if (apiResponse && apiResponse.success) {
        // Close all existing chat windows on new snip
        WindowManager.closeAll();

        const ui = await FloatingChatUI.create();
        WindowManager.register(ui);

        // Pass base64Image so image thumbnail appears in chat
        ui.addMessage('user', apiResponse.initialUserMessage, null, false, apiResponse.base64Image || null);
        ui.addMessage('assistant', apiResponse.answer);

        // Store initial state for comparison cloning
        ui.initialUserMessage = apiResponse.initialUserMessage;
        ui.initialBase64Image = apiResponse.base64Image || null;

        // Update local demo usage cache if demoInfo is returned
        if (apiResponse.demoInfo) {
            updateLocalDemoCache(apiResponse.demoInfo);
        }
    } else {
        // Show error in a styled toast instead of native alert
        showErrorToast(apiResponse ? apiResponse.error : "Unknown error");
    }
}

// Expose handleSnipComplete globally for snip-again flow
window.handleSnipComplete = handleSnipComplete;