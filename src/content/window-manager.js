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

    /**
     * Initialize window manager settings from storage
     */
    init() {
        chrome.storage.local.get(['maxCompareWindows'], (res) => {
            if (res.maxCompareWindows) this.maxWindows = res.maxCompareWindows;
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
        this.autoPosition(ui, this.windows.length - 1);
    },

    /**
     * Unregister a chat window
     * @param {Object} ui - FloatingChatUI instance
     */
    unregister(ui) {
        const idx = this.windows.indexOf(ui);
        if (idx > -1) this.windows.splice(idx, 1);
    },

    /**
     * Close all chat windows
     */
    closeAll() {
        [...this.windows].forEach(w => w.close());
    },

    /**
     * Automatically position a window based on its index
     * @param {Object} ui - FloatingChatUI instance
     * @param {number} index - Window index
     */
    autoPosition(ui, index) {
        const width = 420;
        const gap = 30;

        setTimeout(() => {
            if (!ui.container) return;

            if (index === 0) {
                // Main window: use saved position or default to top-right
                if (!ui.hasSavedPosition) {
                    ui.container.style.right = '50px';
                    ui.container.style.left = 'auto';
                    ui.container.style.top = '50px';
                }
            } else {
                // Compare windows: spawn to the LEFT of existing windows
                const rightEdge = window.innerWidth - 50;
                const posX = rightEdge - (index + 1) * (width + gap);
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
        const mode = senderUI.currentMode || 'short'; // Get mode from sender

        if (this.windows.length <= 1) {
            senderUI.sendMessageDirect(text, 1, mode);
            return;
        }

        // Multi-window mode - sync all with sender's mode
        const windowCount = this.windows.length;
        this.pendingResponses = windowCount;
        this.windows.forEach(w => w.setInputDisabled(true));

        // First window counts for all, others don't increment counter
        this.windows.forEach((w, index) => {
            w.sendMessageDirect(text, index === 0 ? windowCount : 0, mode);
        });
    },

    /**
     * Called when a response is received (for multi-window sync)
     */
    onResponseReceived() {
        if (this.windows.length <= 1) return;
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
