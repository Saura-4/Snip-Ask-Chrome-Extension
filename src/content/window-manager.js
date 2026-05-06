// src/content/window-manager.js
// Manages floating chat windows - registration, positioning, broadcasting

/**
 * WindowManager - Singleton object for managing chat window instances
 * @type {Object}
 */
const WindowManager = {
    /** @type {Array} Active chat window instances */
    windows: [],

    /** @type {number} Maximum allowed compare windows */
    maxWindows: 4,

    /** @type {number} Pending responses counter for synchronized follow-up */
    pendingResponses: 0,

    /** @type {string|null} Window id currently docked as sidebar */
    sidebarWindowId: null,

    /**
     * Initialize window manager settings from storage
     */
    init() {
        chrome.storage.local.get(['maxCompareWindows'], (res) => {
            if (res.maxCompareWindows) this.maxWindows = res.maxCompareWindows;
        });

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;

            if (changes.maxCompareWindows) {
                this.maxWindows = changes.maxCompareWindows.newValue || 4;
            }

        });

        // Global Escape Key Handler
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.windows.length > 0) {
                const active = document.activeElement;
                const isInput = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;
                const isChatHost = active.id === 'groq-chat-host';

                if (isInput && !isChatHost) return;

                this.closeAll();
            }
        });

        // Page unload cleanup
        window.addEventListener('beforeunload', () => {
            this.closeAll();
        });
    },

    /**
     * Register a new chat window
     * @param {Object} ui - FloatingChatUI instance
     */
    register(ui) {
        this.windows.push(ui);
        if (ui.displayMode === 'sidebar') {
            this.setSidebarWindow(ui, false);
            return;
        }
        this.refreshLayout();
    },

    /**
     * Unregister a chat window
     * @param {Object} ui - FloatingChatUI instance
     */
    unregister(ui) {
        const idx = this.windows.indexOf(ui);
        if (idx > -1) this.windows.splice(idx, 1);

        if (this.sidebarWindowId === ui.uiId) {
            this.sidebarWindowId = null;
        }

        this.refreshLayout();
    },

    /**
     * Close all chat windows
     */
    closeAll() {
        [...this.windows].forEach(w => w.close());
        this.sidebarWindowId = null;
    },

    getSidebarWindow() {
        return this.windows.find((windowUi) => windowUi.uiId === this.sidebarWindowId) || null;
    },

    isSidebarMode() {
        return Boolean(this.getSidebarWindow());
    },

    setSidebarWindow(targetUi, shouldRefresh = true) {
        const existingSidebar = this.getSidebarWindow();

        if (existingSidebar && existingSidebar !== targetUi) {
            existingSidebar.setDisplayMode('popup');
        }

        targetUi.setDisplayMode('sidebar');
        this.sidebarWindowId = targetUi.uiId;

        if (shouldRefresh) {
            this.refreshLayout();
        }
    },

    popoutSidebarWindow(targetUi, shouldRefresh = true) {
        if (this.sidebarWindowId !== targetUi.uiId) {
            return;
        }

        targetUi.setDisplayMode('popup');
        this.sidebarWindowId = null;

        if (shouldRefresh) {
            this.refreshLayout();
        }
    },

    toggleWindowDisplayMode(targetUi) {
        if (targetUi.displayMode === 'sidebar') {
            this.popoutSidebarWindow(targetUi);
            return 'popup';
        }

        this.setSidebarWindow(targetUi);
        return 'sidebar';
    },

    activateWindow(windowId) {
        const targetUi = this.windows.find((windowUi) => windowUi.uiId === windowId);
        if (!targetUi) return;

        this.setSidebarWindow(targetUi);
    },

    refreshLayout() {
        if (this.windows.length === 0) {
            this.sidebarWindowId = null;
            return;
        }

        const sidebarWindow = this.getSidebarWindow();
        const popupWindows = this.windows.filter((windowUi) => windowUi !== sidebarWindow);
        const reservedRight = sidebarWindow?.container
            ? Math.ceil(sidebarWindow.container.getBoundingClientRect().width) + 24
            : 50;

        if (sidebarWindow && typeof sidebarWindow.applyManagedLayout === 'function') {
            sidebarWindow.applyManagedLayout({
                mode: 'sidebar',
                isActive: true
            });
        }

        popupWindows.forEach((windowUi, index) => {
            if (typeof windowUi.applyManagedLayout === 'function') {
                windowUi.applyManagedLayout({
                    mode: 'popup',
                    isActive: true
                });
            }
            this.autoPosition(windowUi, index, reservedRight);
        });
    },

    /**
     * Automatically position a window based on its index
     * @param {Object} ui - FloatingChatUI instance
     * @param {number} index - Window index
     */
    autoPosition(ui, index, reservedRight = 50) {
        const width = 420;
        const gap = 30;

        setTimeout(() => {
            if (!ui.container) return;

            if (index === 0) {
                // Main window: use saved position or default to top-right
                if (!ui.hasSavedPosition) {
                    ui.container.style.right = `${reservedRight}px`;
                    ui.container.style.left = 'auto';
                    ui.container.style.top = '50px';
                }
            } else {
                // Compare windows: spawn to the LEFT of existing windows
                const rightEdge = window.innerWidth - reservedRight;
                const posX = rightEdge - width - index * (width + gap);
                ui.container.style.left = Math.max(20, posX) + 'px';
                ui.container.style.right = 'auto';
                ui.container.style.top = '50px';
            }
        }, 50);
    },

    /**
     * Broadcast a follow-up message to all windows
     * @param {string} text - Message text
     * @param {Object} senderUI - The sending window instance
     */
    broadcastFollowUp(text, senderUI) {
        chrome.storage.local.get(['sidePanelSession'], (storage) => {
            const hasSidebarSession = Array.isArray(storage.sidePanelSession?.chatHistory) && storage.sidePanelSession.chatHistory.length > 0;
            const totalTargets = this.windows.length + (hasSidebarSession ? 1 : 0);

            // Always disable input while waiting for response(s)
            this.pendingResponses = this.windows.length;
            this.windows.forEach((w) => w.setInputDisabled(true));

            if (totalTargets <= 1) {
                const mode = senderUI.currentMode || 'short';
                senderUI.sendMessageDirect(text, 1, mode);
                return;
            }

            this.windows.forEach((w, index) => {
                const windowMode = w.currentMode || 'short';
                w.sendMessageDirect(text, index === 0 ? totalTargets : 0, windowMode);
            });

            if (hasSidebarSession) {
                chrome.runtime.sendMessage({
                    action: 'BROADCAST_TO_SIDEPANEL',
                    text,
                    parallelCount: 0
                });
            }
        });
    },

    /**
     * Called when a response is received (for multi-window sync)
     */
    onResponseReceived() {
        this.pendingResponses--;
        if (this.pendingResponses <= 0) {
            this.pendingResponses = 0;
            this.windows.forEach(w => w.setInputDisabled(false));
        }
    },

    /**
     * Get the current window count
     * @returns {number}
     */
    getWindowCount() {
        return this.windows.length;
    },

    /**
     * Check if max windows reached
     * @returns {boolean}
     */
    isMaxReached() {
        return this.windows.length >= this.maxWindows;
    }
};

// Initialize on load
WindowManager.init();
