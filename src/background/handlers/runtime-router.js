import { cancelTrackedRequest, createTrackedAbortController, removeTrackedController } from '../core/abort-registry.js';
import { CONTENT_SCRIPT_FILES } from '../core/content-script-files.js';
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
const SIDE_PANEL_PRESENCE_TTL_MS = 7000;
const EMPTY_SIDE_PANEL_SESSION = {
    chatHistory: [],
    currentModel: null,
    currentMode: null,
    availableModels: [],
    customModes: [],
    customPrompt: '',
    initialUserMessage: null,
    initialBase64Image: null,
    allImages: [],
    isGuestMode: false
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

async function closeSidePanelForTab(tab) {
    if (!tab?.id && !tab?.windowId) return;

    if (chrome.sidePanel.close && tab.windowId) {
        try {
            await chrome.sidePanel.close({ windowId: tab.windowId });
        } catch {
            // Fall through to disabling the tab-specific side panel below.
        }
    }

    if (chrome.sidePanel.setOptions && tab.id) {
        try {
            await chrome.sidePanel.setOptions({
                tabId: tab.id,
                path: SIDE_PANEL_PATH,
                enabled: false
            });
        } catch {
            // Popout already succeeded; failing to close the browser side panel is non-fatal.
        }
    }
}

function isActiveSidePanelPresence(presence, tab) {
    if (!presence?.lastSeen) return false;
    if (Date.now() - presence.lastSeen > SIDE_PANEL_PRESENCE_TTL_MS) return false;
    if (tab?.id && presence.activeTabId && presence.activeTabId !== tab.id) return false;
    if (tab?.windowId && presence.windowId && presence.windowId !== tab.windowId) return false;
    return true;
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
            files: CONTENT_SCRIPT_FILES
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
    const response = await chrome.tabs.sendMessage(targetTab.id, {
        action: 'OPEN_FLOATING_CHAT_SESSION',
        session,
        compare,
        sourceModel
    });
    if (response?.success === false) {
        throw new Error(response.error || 'Could not open popup window.');
    }
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
            if (!sender.tab?.windowId) {
                sendResponse({ error: 'Missing tab context for screenshot capture.' });
                return true;
            }

            chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "jpeg", quality: 80 }, (dataUrl) => {
                const errorMessage = chrome.runtime.lastError?.message;
                if (errorMessage) {
                    sendResponse({ error: errorMessage });
                    return;
                }
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
            const requestId = request.requestId || null;
            const controller = createTrackedAbortController(requestId);

            handleAIRequest(content, type, request.model, sendResponse, request.ocrConfidence || null, request.mode, controller.signal, request.base64Image || null)
                .finally(() => removeTrackedController(controller, requestId));
            return true;
        }

        if (request.action === "ASK_AI_MULTI_IMAGE") {
            const requestId = request.requestId || null;
            const controller = createTrackedAbortController(requestId);
            handleMultiImageRequest(request.images, request.model, request.textContext, sendResponse, request.mode, controller.signal)
                .finally(() => removeTrackedController(controller, requestId));
            return true;
        }

        if (request.action === "CONTINUE_CHAT") {
            const requestId = request.requestId || null;
            const controller = createTrackedAbortController(requestId);
            handleContinueChat(request, sendResponse, controller.signal)
                .finally(() => removeTrackedController(controller, requestId));
            return true;
        }

        if (request.action === "CANCEL_AI_REQUEST") {
            cancelTrackedRequest(request.requestId || null);
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
            const previousSessionPromise = chrome.storage.local.get(['sidePanelSession', 'sidePanelPresence']);
            const enablePanelPromise = chrome.sidePanel.setOptions
                ? chrome.sidePanel.setOptions({
                    tabId: tab.id,
                    path: SIDE_PANEL_PATH,
                    enabled: true
                }).catch(() => null)
                : Promise.resolve();

            // Open the side panel IMMEDIATELY — no awaits before this call
            chrome.sidePanel.open({ windowId: tab.windowId })
                .then(async () => {
                    await enablePanelPromise;

                    const current = await previousSessionPromise.catch(() => ({}));
                    const prevSession = current.sidePanelSession || null;
                    const hasActiveSidePanel = isActiveSidePanelPresence(current.sidePanelPresence, tab);
                    const hasPreviousChat = Array.isArray(prevSession?.chatHistory) && prevSession.chatHistory.length > 0;
                    const shouldPopPrevious = hasActiveSidePanel && hasPreviousChat && prevSession.uiId !== request.session?.uiId;

                    // Commit the clicked popup after the previous side-panel session
                    // is captured. Popping the old session out is best-effort and
                    // must not keep the clicked popup open after the panel accepted it.
                    await chrome.storage.local.set({
                        sidePanelSession: {
                            ...(request.session || {}),
                            activeTabId: tab.id,
                            windowId: tab.windowId,
                            lastUpdated: Date.now()
                        }
                    });

                    sendResponse({ success: true });

                    if (shouldPopPrevious) {
                        openFloatingPopupSession(prevSession, false, tab).catch((error) => {
                            console.warn('Snip & Ask: Failed to pop previous side-panel chat into a popup:', error?.message || error);
                        });
                    }
                })
                .catch(async (error) => {
                    await enablePanelPromise;
                    sendResponse({ success: false, error: error?.message || String(error) });
                });
            return true;
        }

        if (request.action === 'MOVE_SIDEPANEL_TO_POPUP') {
            (async () => {
                let targetTab = null;
                let popoutSession = request.session || {};
                try {
                    targetTab = await getTabForSession(request.session);
                    popoutSession = {
                        ...popoutSession,
                        activeTabId: targetTab?.id || popoutSession.activeTabId || null,
                        windowId: targetTab?.windowId || popoutSession.windowId || null,
                        lastUpdated: Date.now()
                    };

                    await chrome.storage.local.set({
                        sidePanelSession: null,
                        sidePanelPresence: null
                    });
                    const closePromise = closeSidePanelForTab(targetTab);
                    await openFloatingPopupSession(popoutSession, false, targetTab);
                    await closePromise;
                    sendResponse({ success: true });
                } catch (error) {
                    if (targetTab && popoutSession) {
                        try {
                            await chrome.storage.local.set({
                                sidePanelSession: popoutSession,
                                sidePanelPresence: null
                            });
                            await enableAndOpenSidePanelForTab(targetTab);
                        } catch {
                            // Preserve the original popout error for the caller.
                        }
                    }
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

        if (request.action === 'BROADCAST_TO_POPUP_WINDOWS') {
            (async () => {
                try {
                    const storage = await chrome.storage.local.get(['sidePanelSession']);
                    const targetTab = await getTabForSession(storage.sidePanelSession || null, sender.tab || null);
                    if (!targetTab?.id) {
                        throw new Error('No active tab available for popup windows.');
                    }

                    await ensureActiveTabContentScript(targetTab.id);
                    const result = await chrome.tabs.sendMessage(targetTab.id, {
                        action: 'BROADCAST_TO_POPUP_WINDOWS',
                        text: request.text,
                        parallelCount: request.parallelCount || 0
                    });
                    sendResponse(result || { success: false });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
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
            const requestId = request.requestId || null;
            const controller = createTrackedAbortController(requestId);
            handleCustomModelValidation(request, sendResponse, controller.signal)
                .finally(() => removeTrackedController(controller, requestId));
            return true;
        }

        return false;
    };
}

const STREAM_PORT_NAME = 'snip-ask-stream';

/**
 * Port-based streaming listener. The client connects with port name
 * 'snip-ask-stream' and posts a single request payload (CONTINUE_CHAT or
 * ASK_AI_MULTI_IMAGE). Deltas are posted back as {type:'delta', text},
 * followed by {type:'done', response} or {type:'error', error}.
 */
export function createRuntimePortListener() {
    return (port) => {
        if (port.name !== STREAM_PORT_NAME) {
            return;
        }

        let requestId = null;
        let controller = null;
        let settled = false;

        const finish = () => {
            if (controller) {
                removeTrackedController(controller, requestId);
                controller = null;
            }
            try {
                port.disconnect();
            } catch {
                // Already disconnected.
            }
        };

        port.onDisconnect.addListener(() => {
            // Client went away (window closed / Stop clicked) — abort upstream.
            if (!settled && requestId) {
                cancelTrackedRequest(requestId);
            }
            if (controller) {
                removeTrackedController(controller, requestId);
                controller = null;
            }
        });

        port.onMessage.addListener((request) => {
            if (request?.action !== 'CONTINUE_CHAT' && request?.action !== 'ASK_AI_MULTI_IMAGE') {
                port.postMessage({ type: 'error', error: `Streaming does not support action: ${request?.action}` });
                finish();
                return;
            }

            requestId = request.requestId || null;
            controller = createTrackedAbortController(requestId);

            const onDelta = (text) => {
                try {
                    port.postMessage({ type: 'delta', text });
                } catch {
                    // Port closed mid-stream; the disconnect handler aborts.
                    cancelTrackedRequest(requestId);
                }
            };

            const handle = request.action === 'CONTINUE_CHAT'
                ? handleContinueChat(request, (response) => {
                    settled = true;
                    try {
                        port.postMessage({ type: 'done', response });
                    } catch {
                        // Client disconnected.
                    }
                    finish();
                }, controller.signal, onDelta)
                : handleMultiImageRequest(request.images, request.model, request.textContext, (response) => {
                    settled = true;
                    try {
                        port.postMessage({ type: 'done', response });
                    } catch {
                        // Client disconnected.
                    }
                    finish();
                }, request.mode || null, controller.signal, onDelta);

            handle.catch((error) => {
                settled = true;
                try {
                    port.postMessage({ type: 'error', error: error?.message || String(error) });
                } catch {
                    // Client disconnected.
                }
                finish();
            });
        });
    };
}
