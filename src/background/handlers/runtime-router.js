import { cancelAllActiveRequests, createTrackedAbortController, removeTrackedController } from '../core/abort-registry.js';
import {
    handleAIRequest,
    handleChatWindowModels,
    handleContinueChat,
    handleCustomModelValidation,
    handleGuestStatusCheck,
    handleMultiImageRequest,
    handleProviderConfigCheck
} from './request-handlers.js';

let creating;

async function setupOffscreenDocument(path) {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        return;
    }

    if (creating) {
        await creating;
        return;
    }

    creating = chrome.offscreen.createDocument({
        url: path,
        reasons: ['BLOBS'],
        justification: 'OCR processing for image to text conversion'
    });
    await creating;
    creating = null;
}

export function createRuntimeMessageListener() {
    return (request, sender, sendResponse) => {
        if (request.action === "CAPTURE_VISIBLE_TAB") {
            chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 80 }, (dataUrl) => {
                sendResponse({ dataUrl });
            });
            return true;
        }

        if (request.action === "PERFORM_OCR") {
            (async () => {
                try {
                    await setupOffscreenDocument('src/offscreen/offscreen.html');
                    const response = await chrome.runtime.sendMessage({
                        action: 'OCR_Request',
                        base64Image: request.base64Image
                    });
                    sendResponse(response);
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }

        if (request.action === "ASK_AI" || request.action === "ASK_AI_TEXT") {
            const type = request.action === "ASK_AI_TEXT" ? 'text' : 'image';
            const content = type === 'text' ? request.text : request.base64Image;
            const controller = createTrackedAbortController();

            handleAIRequest(content, type, request.model, sendResponse, request.ocrConfidence || null, request.mode, controller.signal)
                .finally(() => removeTrackedController(controller));
            return true;
        }

        if (request.action === "ASK_AI_MULTI_IMAGE") {
            const controller = createTrackedAbortController();
            handleMultiImageRequest(request.images, request.model, request.textContext, sendResponse, request.mode, controller.signal)
                .finally(() => removeTrackedController(controller));
            return true;
        }

        if (request.action === "CONTINUE_CHAT") {
            const controller = createTrackedAbortController();
            handleContinueChat(request, sendResponse, controller.signal)
                .finally(() => removeTrackedController(controller));
            return true;
        }

        if (request.action === "CANCEL_AI_REQUEST") {
            cancelAllActiveRequests();
            sendResponse({ success: true });
            return true;
        }

        if (request.action === "UPDATE_CONTEXT_MENU") {
            if (request.hide) {
                chrome.contextMenus.remove("askAI", () => {});
            } else {
                chrome.contextMenus.create({
                    id: "askAI",
                    title: "Ask AI about selection",
                    contexts: ["selection"]
                }, () => {});
            }
            return false;
        }

        if (request.action === "OPEN_OPTIONS_PAGE") {
            chrome.action.openPopup();
            return false;
        }

        if (request.action === "CHECK_PROVIDER_CONFIG") {
            handleProviderConfigCheck(request, sendResponse);
            return true;
        }

        if (request.action === "CHECK_GUEST_STATUS") {
            handleGuestStatusCheck(sendResponse);
            return true;
        }

        if (request.action === "GET_CHAT_WINDOW_MODELS") {
            handleChatWindowModels(sendResponse);
            return true;
        }

        if (request.action === "VALIDATE_CUSTOM_MODEL") {
            const controller = createTrackedAbortController();
            handleCustomModelValidation(request, sendResponse, controller.signal)
                .finally(() => removeTrackedController(controller));
            return true;
        }

        return false;
    };
}
