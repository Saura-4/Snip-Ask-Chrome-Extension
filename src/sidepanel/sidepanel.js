const WindowManager = {
    windows: [],
    maxWindows: 4,
    pendingResponses: 0,
    register(ui) {
        this.windows = [ui];
    },
    unregister() {
        this.windows = [];
    },
    closeAll() {
        this.windows.forEach((ui) => ui.close());
        this.windows = [];
    },
    isMaxReached() {
        return false;
    },
    refreshLayout() {},
    isSidebarMode() {
        return false;
    },
    broadcastFollowUp(text, senderUI) {
        chrome.runtime.sendMessage({ action: 'BROADCAST_TO_POPUP_WINDOWS', text });
        senderUI.sendMessageDirect(text, 1, senderUI.currentMode || 'short');
    },
    onResponseReceived() {}
};

let sidePanelUi = null;

async function persistSidePanelSession() {
    if (!sidePanelUi) return;
    const session = sidePanelUi.serializeSession();
    sidePanelUi._lastRenderedTimestamp = session.lastUpdated || null;
    await chrome.storage.local.set({
        sidePanelSession: session
    });
}

async function loadSidePanelSession() {
    const storage = await chrome.storage.local.get(['sidePanelSession']);
    return storage.sidePanelSession || null;
}

async function closeBrowserSidePanel(windowId = null) {
    if (!windowId) {
        const storage = await chrome.storage.local.get(['sidePanelSession']);
        windowId = storage.sidePanelSession?.windowId;
    }
    if (chrome.sidePanel.close && windowId) {
        try {
            await chrome.sidePanel.close({ windowId });
        } catch {
            // Ignore close failures to avoid breaking popout behavior.
        }
    }
}

async function renderSession(session) {
    if (!sidePanelUi) {
        sidePanelUi = await FloatingChatUI.createFromSession(session || {}, { isSidePanelHost: true });
        sidePanelUi.setDisplayMode('sidebar');
        sidePanelUi._lastRenderedTimestamp = session?.lastUpdated || null;
        sidePanelUi.onSessionChanged = () => {
            void persistSidePanelSession();
        };
        WindowManager.register(sidePanelUi);

        if (sidePanelUi.compareBtn) {
            sidePanelUi.compareBtn.onclick = async () => {
                await chrome.runtime.sendMessage({
                    action: 'OPEN_COMPARE_FROM_SIDEPANEL',
                    session: sidePanelUi.serializeSession(),
                    sourceModel: sidePanelUi.currentModel || null
                });
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
                await chrome.storage.local.set({ sidePanelSession: null });
                await closeBrowserSidePanel(windowId);
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
        return;
    }

    // Only skip hydration if this is an echo of our own write (same uiId AND same timestamp).
    // This prevents the storage listener from re-rendering after persistSidePanelSession().
    const isSelfEcho = session.uiId
        && session.uiId === sidePanelUi.uiId
        && session.lastUpdated === sidePanelUi._lastRenderedTimestamp;
    if (isSelfEcho) {
        // Still update tab/window ids in case they changed
        sidePanelUi.activeTabId = session.activeTabId || sidePanelUi.activeTabId || null;
        sidePanelUi.windowId = session.windowId || sidePanelUi.windowId || null;
        return;
    }

    sidePanelUi.hydrateFromSession(session, { isSidePanelHost: true });
    sidePanelUi.setDisplayMode('sidebar');
    sidePanelUi._lastRenderedTimestamp = session.lastUpdated || null;
}

document.addEventListener('DOMContentLoaded', async () => {
    const session = await loadSidePanelSession();
    await renderSession(session);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.sidePanelSession) {
        return;
    }

    void renderSession(changes.sidePanelSession.newValue || null);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'BROADCAST_TO_SIDEPANEL') {
        if (!sidePanelUi) {
            sendResponse({ success: false });
            return false;
        }

        sidePanelUi.sendMessageDirect(request.text, request.parallelCount || 0, sidePanelUi.currentMode || 'short');
        sendResponse({ success: true });
        return false;
    }

    return false;
});
