const WindowManager = {
    windows: [],
    maxWindows: 4,
    pendingResponses: 0,
    responseBatchResolver: null,
    register(ui) {
        this.windows = [ui];
    },
    unregister() {
        this.windows = [];
        this.resolveResponseBatch();
    },
    closeAll() {
        this.windows.forEach((ui) => ui.close());
        this.windows = [];
        this.resolveResponseBatch();
    },
    isMaxReached() {
        return false;
    },
    refreshLayout() {},
    isSidebarMode() {
        return false;
    },
    broadcastFollowUp(text, senderUI) {
        this.beginResponseBatch(2);
        chrome.runtime.sendMessage({ action: 'BROADCAST_TO_POPUP_WINDOWS', text })
            .then(() => this.onResponseReceived())
            .catch(() => this.onResponseReceived());
        senderUI.sendMessageDirect(text, 1, senderUI.currentMode || 'short');
    },
    beginResponseBatch(count) {
        this.resolveResponseBatch();
        this.pendingResponses = Math.max(0, count);
        this.windows.forEach((ui) => ui.setInputDisabled(this.pendingResponses > 0));

        if (this.pendingResponses === 0) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            this.responseBatchResolver = resolve;
        });
    },
    resolveResponseBatch() {
        if (this.responseBatchResolver) {
            const resolve = this.responseBatchResolver;
            this.responseBatchResolver = null;
            resolve();
        }
    },
    onResponseReceived() {
        if (this.pendingResponses > 0) {
            this.pendingResponses--;
        }
        if (this.pendingResponses <= 0) {
            this.pendingResponses = 0;
            this.windows.forEach((ui) => ui.setInputDisabled(false));
            this.resolveResponseBatch();
        }
    }
};

let sidePanelUi = null;
const sidePanelHost = SnipAskSidePanelHost.createSessionHost({
    getUi: () => sidePanelUi
});

async function renderSession(session) {
    if (!sidePanelUi) {
        sidePanelUi = await FloatingChatUI.createFromSession(session || {}, { isSidePanelHost: true });
        sidePanelUi.setDisplayMode('sidebar');
        sidePanelUi._lastRenderedTimestamp = session?.lastUpdated || null;
        sidePanelUi.onSessionChanged = () => {
            void sidePanelHost.persistSession();
        };
        WindowManager.register(sidePanelUi);
        sidePanelHost.startPresence();

        if (sidePanelUi.compareBtn) {
            sidePanelUi.compareBtn.onclick = async () => {
                try {
                    const result = await chrome.runtime.sendMessage({
                        action: 'OPEN_COMPARE_FROM_SIDEPANEL',
                        session: sidePanelUi.serializeSession(),
                        sourceModel: sidePanelUi.currentModel || null
                    });
                    if (!result?.success && typeof showErrorToast === 'function') {
                        showErrorToast(result?.error || 'Could not open compare window.');
                    }
                } catch (error) {
                    if (typeof showErrorToast === 'function') {
                        showErrorToast(error?.message || 'Could not open compare window.');
                    }
                }
            };
        }

        if (sidePanelUi.snipAgainBtn) {
            sidePanelUi.snipAgainBtn.onclick = async () => {
                await chrome.runtime.sendMessage({
                    action: 'START_SNIP_FROM_SIDE_PANEL',
                    model: sidePanelUi.currentModel,
                    mode: sidePanelUi.currentMode
                });
            };
        }

        if (sidePanelUi.closeBtn) {
            sidePanelUi.closeBtn.onclick = async () => {
                const windowId = sidePanelUi.windowId;
                const tabId = sidePanelUi.activeTabId;
                await sidePanelHost.clearPresence();
                await chrome.storage.local.set({
                    sidePanelSession: null,
                    sidePanelPresence: null
                });
                void sidePanelHost.closeBrowserSidePanel(windowId, tabId);
                sidePanelUi.chatBody.innerHTML = '';
            };
        }

        return;
    }

    if (!session) {
        // Null/empty session — clear the chat body
        sidePanelUi.chatHistory = [];
        if (sidePanelUi.chatBody) sidePanelUi.chatBody.innerHTML = '';
        sidePanelUi._lastRenderedTimestamp = null;
        void sidePanelHost.clearPresence();
        void sidePanelHost.closeBrowserSidePanel(sidePanelUi.windowId, sidePanelUi.activeTabId);
        return;
    }

    // Only skip hydration if this is an echo of our own write (same uiId AND same timestamp).
    // This prevents the storage listener from re-rendering after our own session write.
    const isSelfEcho = SnipAskSession.isSameRenderedSession(session, sidePanelUi);
    if (isSelfEcho) {
        // Still update tab/window ids in case they changed
        sidePanelUi.activeTabId = session.activeTabId || sidePanelUi.activeTabId || null;
        sidePanelUi.windowId = session.windowId || sidePanelUi.windowId || null;
        void sidePanelHost.markAlive();
        return;
    }

    sidePanelUi.hydrateFromSession(session, { isSidePanelHost: true });
    sidePanelUi.setDisplayMode('sidebar');
    sidePanelUi._lastRenderedTimestamp = session.lastUpdated || null;
    void sidePanelHost.markAlive();
}

document.addEventListener('DOMContentLoaded', async () => {
    const session = await sidePanelHost.waitForInitialSession();
    if (session) {
        await renderSession(session);
        return;
    }
    void sidePanelHost.clearPresence();
    await sidePanelHost.closeBrowserSidePanel();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.sidePanelSession) {
        return;
    }

    void renderSession(changes.sidePanelSession.newValue || null);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ADD_SNIPPED_IMAGE_TO_SIDEPANEL') {
        if (!sidePanelUi || !request.base64Image) {
            sendResponse({ success: false });
            return false;
        }

        sidePanelUi._processSnippedImage(request.base64Image);
        sendResponse({ success: true });
        return false;
    }

    if (request.action === 'BROADCAST_TO_SIDEPANEL') {
        if (!sidePanelUi) {
            sendResponse({ success: false });
            return false;
        }

        (async () => {
            sidePanelUi.setInputDisabled(true);
            try {
                await sidePanelUi.sendMessageDirect(request.text, request.parallelCount || 0, sidePanelUi.currentMode || 'short');
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            } finally {
                sidePanelUi.setInputDisabled(false);
            }
        })();
        return true;
    }

    return false;
});
