// Side-panel storage, presence, and browser-panel lifecycle helpers.
(function initSnipAskSidePanelHost(global) {
    const SIDE_PANEL_PATH = 'src/sidepanel/sidepanel.html';
    const SIDE_PANEL_PRESENCE_INTERVAL_MS = 2000;

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function createSessionHost({ getUi }) {
        const instanceId = crypto.randomUUID();
        let presenceTimer = null;

        async function persistSession() {
            const ui = getUi();
            if (!ui) return;

            const session = ui.serializeSession();
            ui._lastRenderedTimestamp = session.lastUpdated || null;
            await chrome.storage.local.set({
                sidePanelSession: session
            });
        }

        async function loadSession() {
            const storage = await chrome.storage.local.get(['sidePanelSession']);
            return storage.sidePanelSession || null;
        }

        function getPresence() {
            const ui = getUi();
            return {
                instanceId,
                activeTabId: ui?.activeTabId || null,
                windowId: ui?.windowId || null,
                lastSeen: Date.now()
            };
        }

        async function markAlive() {
            try {
                await chrome.storage.local.set({
                    sidePanelPresence: getPresence()
                });
            } catch {
                // Presence is only used to avoid stale-session swaps.
            }
        }

        function startPresence() {
            if (presenceTimer) return;
            void markAlive();
            presenceTimer = setInterval(() => {
                void markAlive();
            }, SIDE_PANEL_PRESENCE_INTERVAL_MS);
        }

        async function clearPresence() {
            if (presenceTimer) {
                clearInterval(presenceTimer);
                presenceTimer = null;
            }

            try {
                const storage = await chrome.storage.local.get(['sidePanelPresence']);
                if (!storage.sidePanelPresence?.instanceId || storage.sidePanelPresence.instanceId === instanceId) {
                    await chrome.storage.local.set({ sidePanelPresence: null });
                }
            } catch {
                // Closing the panel should not depend on storage cleanup.
            }
        }

        async function waitForInitialSession() {
            for (let attempt = 0; attempt < 10; attempt++) {
                const session = await loadSession();
                if (session) {
                    return session;
                }
                await wait(50);
            }
            return null;
        }

        async function closeBrowserSidePanel(windowId = null, tabId = null) {
            const ui = getUi();

            if (!windowId || !tabId) {
                const storage = await chrome.storage.local.get(['sidePanelSession']);
                windowId = windowId || storage.sidePanelSession?.windowId;
                tabId = tabId || storage.sidePanelSession?.activeTabId;
            }
            windowId = windowId || ui?.windowId || null;
            tabId = tabId || ui?.activeTabId || null;

            if (!windowId && chrome.windows?.getCurrent) {
                try {
                    const currentWindow = await chrome.windows.getCurrent();
                    windowId = currentWindow?.id;
                } catch {
                    // Ignore and fall through to the no-op below.
                }
            }

            if (!tabId && chrome.tabs?.query) {
                try {
                    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    tabId = activeTab?.id || null;
                } catch {
                    // Without a tab id, the close API above is still our best effort.
                }
            }

            if (chrome.sidePanel.close && windowId) {
                try {
                    await chrome.sidePanel.close({ windowId });
                } catch {
                    // Ignore close failures to avoid breaking popout behavior.
                }
            }

            if (chrome.sidePanel.setOptions && tabId) {
                try {
                    await chrome.sidePanel.setOptions({
                        tabId,
                        path: SIDE_PANEL_PATH,
                        enabled: false
                    });
                } catch {
                    // The background close path may have already handled this.
                }
            }
        }

        return {
            clearPresence,
            closeBrowserSidePanel,
            loadSession,
            markAlive,
            persistSession,
            startPresence,
            waitForInitialSession
        };
    }

    global.SnipAskSidePanelHost = {
        createSessionHost
    };
})(window);
