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
const SIDE_PANEL_PATH = 'src/sidepanel/sidepanel.html';
const EMPTY_SIDE_PANEL_SESSION = {
    chatHistory: [],
    currentModel: null,
    currentMode: null,
    availableModels: [],
    customModes: [],
    customPrompt: '',
    initialUserMessage: null,
    initialBase64Image: null,
    allImages: []
};

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
}

async function enableAndOpenSidePanelForTab(tab) {
    if (!tab?.id) {
        throw new Error('No active tab available for side panel.');
    }

    await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: SIDE_PANEL_PATH,
        enabled: true
    });

    if (tab.windowId) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        return;
    }

    await chrome.sidePanel.open({ tabId: tab.id });
}

async function getTabForSession(session = null, fallbackTab = null) {
    if (session?.activeTabId) {
        try {
            const tab = await chrome.tabs.get(session.activeTabId);
            if (tab?.id) {
                return tab;
            }
        } catch {
            // Fall back to the current active tab if the original tab no longer exists.
        }
    }

    if (fallbackTab?.id) {
        return fallbackTab;
    }

    return getActiveTab();
}

async function ensureActiveTabContentScript(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, { action: '__PING__' });
    } catch {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: [
                'lib/katex.min.js',
                'src/content/utils.js',
                'src/content/ui-helpers.js',
                'src/content/chat/message-utils.js',
                'src/content/chat/render-utils.js',
                'src/content/window-manager.js',
                'src/content/snip-selection.js',
                'src/content/chat/floating-chat-ui.js',
                'src/content/content.js'
            ]
        });
    }
}

async function openSidePanelWithSession(session, fallbackTab = null) {
    const targetTab = await getTabForSession(session, fallbackTab);
    if (!targetTab?.id) {
        throw new Error('No active tab available for side panel.');
    }

    // Try to open the panel first (for user-gesture-sensitive callers).
    // If this throws, the caller handles it.
    await enableAndOpenSidePanelForTab(targetTab);

    // Save session to storage so the side panel picks it up.
    await chrome.storage.local.set({
        chatDisplayMode: 'sidebar',
        sidePanelSession: {
            ...(session || {}),
            activeTabId: targetTab.id,
            windowId: targetTab.windowId,
            lastUpdated: Date.now()
        }
    });
}

async function setSidePanelSession(session, fallbackTab = null) {
    const targetTab = await getTabForSession(session, fallbackTab);
    if (!targetTab?.id) {
        throw new Error('No active tab available for side panel.');
    }

    await chrome.storage.local.set({
        chatDisplayMode: 'sidebar',
        sidePanelSession: {
            ...(session || {}),
            activeTabId: targetTab.id,
            windowId: targetTab.windowId,
            lastUpdated: Date.now()
        }
    });
}

async function resetSidePanelSessionForTab(fallbackTab = null) {
    const targetTab = await getTabForSession(null, fallbackTab);
    if (!targetTab?.id) {
        throw new Error('No active tab available for side panel.');
    }

    const storage = await chrome.storage.local.get(['selectedModel', 'selectedMode', 'customModes', 'customPrompt']);
    await chrome.storage.local.set({
        chatDisplayMode: 'sidebar',
        sidePanelSession: {
            ...EMPTY_SIDE_PANEL_SESSION,
            currentModel: storage.selectedModel || null,
            currentMode: storage.selectedMode || null,
            customModes: Array.isArray(storage.customModes) ? storage.customModes : [],
            customPrompt: storage.customPrompt || '',
            activeTabId: targetTab.id,
            windowId: targetTab.windowId,
            lastUpdated: Date.now()
        }
    });
}

async function prepareSidePanelForActiveTab() {
    const activeTab = await getActiveTab();
    if (!activeTab?.id) {
        throw new Error('No active tab available for side panel.');
    }

    const storage = await chrome.storage.local.get(['selectedModel', 'selectedMode', 'customModes', 'customPrompt']);

    await enableAndOpenSidePanelForTab(activeTab);
    await chrome.storage.local.set({
        chatDisplayMode: 'sidebar',
        sidePanelSession: {
            ...EMPTY_SIDE_PANEL_SESSION,
            currentModel: storage.selectedModel || null,
            currentMode: storage.selectedMode || null,
            customModes: Array.isArray(storage.customModes) ? storage.customModes : [],
            customPrompt: storage.customPrompt || '',
            activeTabId: activeTab.id,
            windowId: activeTab.windowId,
            lastUpdated: Date.now()
        }
    });
}

async function openFloatingPopupSession(session, compare = false, fallbackTab = null, sourceModel = null) {
    const targetTab = await getTabForSession(session, fallbackTab);
    if (!targetTab?.id) {
        throw new Error('No active tab available for popup.');
    }

    await ensureActiveTabContentScript(targetTab.id);
    await chrome.tabs.sendMessage(targetTab.id, {
        action: 'OPEN_FLOATING_CHAT_SESSION',
        session,
        compare,
        sourceModel
    });
}

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
                chrome.contextMenus.remove("askAI", () => {
                    const errorMessage = chrome.runtime.lastError?.message;
                    if (errorMessage && !errorMessage.includes('Cannot find menu item')) {
                        console.warn('Snip & Ask: Failed to remove context menu', errorMessage);
                    }
                });
            } else {
                chrome.contextMenus.create({
                    id: "askAI",
                    title: "Ask AI about selection",
                    contexts: ["selection"]
                }, () => {
                    const errorMessage = chrome.runtime.lastError?.message;
                    if (errorMessage) {
                        console.warn('Snip & Ask: Failed to create context menu', errorMessage);
                    }
                });
            }
            return false;
        }

        if (request.action === "OPEN_OPTIONS_PAGE") {
            chrome.action.openPopup();
            return false;
        }

        if (request.action === 'OPEN_SIDE_PANEL_WITH_SESSION') {
            // This is typically called after an API response (user gesture is
            // long gone). If sidePanel.open() fails due to user gesture, we
            // still save the session so the panel picks it up via storage.
            (async () => {
                try {
                    await openSidePanelWithSession(request.session, sender.tab || null);
                    sendResponse({ success: true });
                } catch (error) {
                    const msg = error?.message || '';
                    // If it's a user gesture error, save session anyway so the
                    // side panel picks it up if already open.
                    if (msg.includes('user gesture')) {
                        await setSidePanelSession(request.session, sender.tab || null);
                        sendResponse({ success: true });
                    } else {
                        sendResponse({ success: false, error: msg });
                    }
                }
            })();
            return true;
        }

        if (request.action === 'PREPARE_SIDE_PANEL') {
            prepareSidePanelForActiveTab()
                .then(() => sendResponse({ success: true }))
                .catch((error) => sendResponse({ success: false, error: error.message }));
            return true;
        }

        if (request.action === 'SET_SIDE_PANEL_SESSION') {
            setSidePanelSession(request.session, sender.tab || null)
                .then(() => sendResponse({ success: true }))
                .catch((error) => sendResponse({ success: false, error: error.message }));
            return true;
        }

        if (request.action === 'RESET_SIDE_PANEL_SESSION') {
            resetSidePanelSessionForTab(sender.tab || null)
                .then(() => sendResponse({ success: true }))
                .catch((error) => sendResponse({ success: false, error: error.message }));
            return true;
        }

        if (request.action === 'MOVE_CHAT_TO_SIDE_PANEL') {
            // CRITICAL: Call sidePanel.open() SYNCHRONOUSLY from the user
            // gesture — no awaits before it. Chrome's user gesture context
            // expires if there are any async operations before open().
            const tab = sender.tab;
            if (!tab?.id) {
                sendResponse({ success: false, error: 'No active tab available.' });
                return true;
            }

            // Fetch previous session in parallel (non-blocking)
            const previousSessionPromise = chrome.storage.local.get(['sidePanelSession']);

            // Open the side panel IMMEDIATELY — no awaits before this call
            chrome.sidePanel.open({ windowId: tab.windowId })
                .then(async () => {
                    // Panel is open. Now save session to storage.
                    await chrome.storage.local.set({
                        chatDisplayMode: 'sidebar',
                        sidePanelSession: {
                            ...(request.session || {}),
                            activeTabId: tab.id,
                            windowId: tab.windowId,
                            lastUpdated: Date.now()
                        }
                    });

                    // If there was a previous different session, move it to popup
                    try {
                        const current = await previousSessionPromise;
                        const prevSession = current.sidePanelSession || null;
                        if (prevSession && prevSession.uiId !== request.session?.uiId) {
                            await openFloatingPopupSession(prevSession, false, tab);
                        }
                    } catch { /* best-effort */ }

                    sendResponse({ success: true });
                })
                .catch(async (error) => {
                    // Panel open failed (e.g. user gesture expired anyway).
                    // Still save the session so the panel picks it up if
                    // opened manually.
                    try {
                        await chrome.storage.local.set({
                            chatDisplayMode: 'sidebar',
                            sidePanelSession: {
                                ...(request.session || {}),
                                activeTabId: tab.id,
                                windowId: tab.windowId,
                                lastUpdated: Date.now()
                            }
                        });
                    } catch { /* best-effort */ }
                    sendResponse({ success: false, error: error?.message || String(error) });
                });
            return true;
        }

        if (request.action === 'MOVE_SIDEPANEL_TO_POPUP') {
            (async () => {
                try {
                    await chrome.storage.local.set({
                        chatDisplayMode: 'popup',
                        sidePanelSession: null
                    });
                    await openFloatingPopupSession(request.session, false);
                    const targetTab = await getTabForSession(request.session);
                    if (chrome.sidePanel.close && targetTab?.windowId) {
                        await chrome.sidePanel.close({ windowId: targetTab.windowId });
                    }
                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }

        if (request.action === 'OPEN_COMPARE_FROM_SIDEPANEL') {
            openFloatingPopupSession(request.session, true, null, request.sourceModel || null)
                .then(() => sendResponse({ success: true }))
                .catch((error) => sendResponse({ success: false, error: error.message }));
            return true;
        }

        if (request.action === 'START_SNIP_FROM_SIDE_PANEL') {
            (async () => {
                try {
                    const storage = await chrome.storage.local.get(['sidePanelSession']);
                    const targetTab = await getTabForSession(storage.sidePanelSession || null);
                    if (!targetTab?.id) {
                        throw new Error('No active tab available.');
                    }

                    await ensureActiveTabContentScript(targetTab.id);
                    await chrome.storage.local.set({ pendingSidebarSnip: true });
                    await chrome.tabs.sendMessage(targetTab.id, {
                        action: 'START_SNIP',
                        appendToSidebar: true,
                        model: request.model || null,
                        mode: request.mode || null
                    });
                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
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
