// src/content/chat/floating-chat-ui.js
// FloatingChatUI class - the main chat window component

/**
 * FloatingChatUI - Floating chat window for AI interactions
 */
class FloatingChatUI {
    constructor() {
        this.uiId = crypto.randomUUID();
        this.chatHistory = [];
        this.currentModel = null;
        this.currentMode = null; // Track selected mode (short/detailed/code/default/custom)
        this.displayMode = 'popup';
        this.availableModels = [];
        this.customModes = [];  // User-created custom modes
        this.customPrompt = ''; // Custom prompt text for 'custom' mode
        this.isGuestMode = false;
        this.isMinimized = false;
        this.hasSavedPosition = false;
        this.initialUserMessage = null;
        this.initialBase64Image = null;
        this.allImages = [];  // Store all snipped images for compare window
        this.activeTabId = null;
        this.windowId = null;
    }

    /**
     * Static factory method for async initialization
     * @returns {Promise<FloatingChatUI>}
     */
    static async create(options = {}) {
        const ui = new FloatingChatUI();
        ui.isSidePanelHost = options.isSidePanelHost === true;
        await ui.initModel();
        if (ui.isSidePanelHost) {
            ui.displayMode = 'sidebar';
        }
        ui.createWindow();
        ui.loadState();
        return ui;
    }

    static async createFromSession(session, options = {}) {
        const ui = await FloatingChatUI.create({
            isSidePanelHost: options.isSidePanelHost === true
        });
        ui.hydrateFromSession(session, options);
        return ui;
    }

    /**
     * Initialize model list and current model from background script
     */
    async initModel() {
        // Fetch model list from background script (uses centralized models-config.js)
        const modelResult = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: "GET_CHAT_WINDOW_MODELS" }, resolve);
        });

        if (modelResult && modelResult.success) {
            this.availableModels = modelResult.models;
            this.isGuestMode = modelResult.isGuestMode === true;
        } else {
            // Fallback: minimal default if background script fails
            console.warn('Failed to fetch models from background:', modelResult?.error);
            this.availableModels = [
                { value: 'groq:auto', name: 'Auto' }
            ];
            this.isGuestMode = false;
        }

        // Get the current selected model, mode, and custom modes from storage
        const storage = await new Promise(resolve => {
            chrome.storage.local.get(['selectedModel', 'selectedMode', 'customModes', 'customPrompt'], resolve);
        });
        this.currentModel = storage.selectedModel || 'groq:auto';
        this.currentMode = storage.selectedMode || 'short';
        this.displayMode = 'popup';
        this.customModes = storage.customModes || [];
        this.customPrompt = storage.customPrompt || '';

        // If current model is not in available models, auto-select first available
        const isCurrentModelValid = this.availableModels.some(m => m.value === this.currentModel);
        if (!isCurrentModelValid && this.availableModels.length > 0) {
            this.currentModel = this.availableModels[0].value;
        }
    }

    /**
     * Close and cleanup the chat window
     */
    close() {
        // Cleanup drag listeners to prevent memory leaks
        if (this._dragCleanup) {
            this._dragCleanup();
            this._dragCleanup = null;
        }
        if (this._bubbleCleanup) {
            this._bubbleCleanup();
            this._bubbleCleanup = null;
        }

        // Trigger exit animation if container exists
        if (this.container) {
            this.container.style.animation = 'slideOut 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) both';

            // Wait for animation to finish
            setTimeout(() => {
                if (this.host) {
                    this.host.remove();
                    this.host = null;
                }
                WindowManager.unregister(this);
            }, 200); // Match animation duration
        } else {
            if (this.host) {
                this.host.remove();
                this.host = null;
            }
            WindowManager.unregister(this);
        }
    }

    /**
     * Minimize the chat window to a bubble
     */
    minimize() {
        if (this.isMinimized) return;
        this.isMinimized = true;

        // Store current dimensions and display states for restoration
        const rect = this.container.getBoundingClientRect();
        this._savedState = {
            width: this.container.style.width,
            height: this.container.style.height,
            minWidth: this.container.style.minWidth,
            minHeight: this.container.style.minHeight,
            maxWidth: this.container.style.maxWidth,
            maxHeight: this.container.style.maxHeight,
            background: this.container.style.background,
            border: this.container.style.border,
            borderRadius: this.container.style.borderRadius,
            boxShadow: this.container.style.boxShadow,
            overflow: this.container.style.overflow,
            backdropFilter: this.container.style.backdropFilter,
            top: rect.top,
            left: rect.left,
            childDisplays: []
        };

        // Hide all content and store original display values
        Array.from(this.container.children).forEach(child => {
            this._savedState.childDisplays.push(child.style.display);
            child.style.display = 'none';
        });

        // Create minimized bubble
        this.container.style.width = 'auto';
        this.container.style.height = 'auto';
        this.container.style.minWidth = 'unset';
        this.container.style.minHeight = 'unset';
        this.container.style.maxWidth = 'calc(100vw - 16px)';
        this.container.style.maxHeight = 'unset';
        this.container.style.background = 'transparent';
        this.container.style.border = 'none';
        this.container.style.borderRadius = '999px';
        this.container.style.boxShadow = 'none';
        this.container.style.overflow = 'visible';
        this.container.style.backdropFilter = 'none';
        this.container.style.resize = 'none';

        // Create bubble element
        this.bubble = document.createElement("div");
        this.bubble.style.cssText = `
            min-height: var(--sa-control-overlay);
            padding: var(--sa-space-3) var(--sa-space-4) var(--sa-space-3) var(--sa-space-6);
            background: rgba(18, 18, 18, 0.92);
            color: #fff4f1;
            border: var(--sa-border-strong);
            border-radius: var(--sa-radius-pill);
            box-shadow: var(--sa-shadow-lg);
            backdrop-filter: blur(10px);
            cursor: move;
            display: flex;
            align-items: center;
            gap: var(--sa-space-5);
            white-space: nowrap;
            user-select: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        const bubbleIcon = document.createElement('img');
        bubbleIcon.src = chrome.runtime.getURL("assets/icons/icon-32.png");
        bubbleIcon.alt = "Snip & Ask";
        bubbleIcon.style.cssText = `
            width: var(--sa-icon-lg);
            height: var(--sa-icon-lg);
            display: block;
            object-fit: contain;
            flex: 0 0 auto;
        `;

        const bubbleLabel = document.createElement('span');
        bubbleLabel.style.cssText = `
            color: #d5d5d5;
            font-size: var(--sa-type-small);
            line-height: var(--sa-leading-tight);
            max-width: 180px;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        bubbleLabel.textContent = this._getModelDisplayName(this.currentModel);

        const expandButton = document.createElement('button');
        expandButton.type = 'button';
        expandButton.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" style="width: var(--sa-icon-sm); height: var(--sa-icon-sm); display: block;"><path d="M3 7.25 6 4.25l3 3" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        expandButton.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: var(--sa-control-md);
            height: var(--sa-control-md);
            background: transparent;
            color: #d5d5d5;
            border: var(--sa-border-strong);
            border-radius: var(--sa-radius-pill);
            padding: 0;
            font: inherit;
            cursor: pointer;
            transition: transform var(--sa-transition-fast), background var(--sa-transition-fast), border-color var(--sa-transition-fast), color var(--sa-transition-fast);
        `;
        expandButton.title = 'Expand';
        expandButton.addEventListener('mouseenter', () => {
            expandButton.style.background = 'rgba(255, 255, 255, 0.06)';
            expandButton.style.borderColor = 'rgba(255, 107, 74, 0.28)';
            expandButton.style.color = '#ff8a6d';
            expandButton.style.transform = 'translateY(-1px)';
        });
        expandButton.addEventListener('mouseleave', () => {
            expandButton.style.background = 'transparent';
            expandButton.style.borderColor = 'rgba(255, 255, 255, 0.12)';
            expandButton.style.color = '#d5d5d5';
            expandButton.style.transform = 'translateY(0)';
        });

        this.bubble.appendChild(bubbleIcon);
        this.bubble.appendChild(bubbleLabel);
        this.bubble.appendChild(expandButton);
        this.bubble.title = 'Drag to move';

        // Make bubble draggable
        this.makeBubbleDraggable(this.bubble);

        // Click on button to expand
        expandButton.onclick = (e) => {
            e.stopPropagation();
            this.expand();
        };

        this.container.appendChild(this.bubble);
    }

    /**
     * Expand from minimized bubble to full window
     */
    expand() {
        if (!this.isMinimized) return;
        this.isMinimized = false;

        // Remove bubble first
        if (this.bubble) {
            this.bubble.remove();
            this.bubble = null;
        }

        // Restore children visibility with original display values
        const children = Array.from(this.container.children);
        children.forEach((child, index) => {
            if (this._savedState && this._savedState.childDisplays[index] !== undefined) {
                child.style.display = this._savedState.childDisplays[index];
            } else {
                child.style.removeProperty('display');
            }
        });

        // Restore dimensions
        if (this._savedState) {
            this.container.style.width = this._savedState.width || '450px';
            this.container.style.height = this._savedState.height || '500px';
            this.container.style.minWidth = this._savedState.minWidth || '300px';
            this.container.style.minHeight = this._savedState.minHeight || '200px';
            this.container.style.maxWidth = this._savedState.maxWidth || '90vw';
            this.container.style.maxHeight = this._savedState.maxHeight || '90vh';
            this.container.style.background = this._savedState.background || 'var(--sa-surface-base)';
            this.container.style.border = this._savedState.border || 'var(--sa-border-strong)';
            this.container.style.borderRadius = this._savedState.borderRadius || 'var(--sa-radius-xl)';
            this.container.style.boxShadow = this._savedState.boxShadow || 'var(--sa-shadow-overlay)';
            this.container.style.overflow = this._savedState.overflow || 'hidden';
            this.container.style.backdropFilter = this._savedState.backdropFilter || 'blur(6px)';
            this.container.style.resize = 'both';
        }

        this._savedState = null;
    }

    /**
     * Make the minimized bubble draggable
     * @param {HTMLElement} bubble
     */
    makeBubbleDraggable(bubble) {
        let isDragging = false;
        let offsetX, offsetY;

        bubble.addEventListener('mousedown', (e) => {
            if (e.target.closest?.('button')) return;
            isDragging = true;
            const rect = this.container.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            e.preventDefault();
        });

        const onMouseMove = (e) => {
            if (isDragging) {
                this.container.style.left = (e.clientX - offsetX) + 'px';
                this.container.style.top = (e.clientY - offsetY) + 'px';
                this.container.style.right = 'auto';
            }
        };

        const onMouseUp = () => {
            isDragging = false;
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // Store cleanup function to prevent memory leaks
        this._bubbleCleanup = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }

    /**
     * Create the chat window DOM structure
     */
    createWindow() {
        this.host = document.createElement("div");
        this.host.id = "groq-chat-host";
        this.host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;";

        this.shadow = this.host.attachShadow({ mode: 'closed' });

        this.container = document.createElement("div");
        this.container.style.cssText = `
            position: fixed; 
            width: 480px; height: 580px;
            background: var(--sa-surface-base);
            color: var(--sa-text-primary);
            border: var(--sa-border-strong); border-radius: var(--sa-radius-xl);
            box-shadow: var(--sa-shadow-overlay);
            display: flex; flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; font-size: var(--sa-type-ui); line-height: var(--sa-leading-normal);
            resize: both; overflow: hidden; 
            min-width: 320px; min-height: 280px;
            max-width: 90vw; max-height: 90vh;
            backdrop-filter: blur(6px);
            animation: slideIn var(--sa-transition-entrance) both;
        `;

        // Inject UX Polish Styles (Tables, Code Blocks, Typing Indicator)
        const style = document.createElement('style');
        const designVars = window.SNIP_ASK_DESIGN?.cssVars?.(':host') || '';
        style.textContent = `
            ${designVars}

            /* WINDOW TRANSITIONS */
            @keyframes slideIn {
                from { opacity: 0; transform: translateY(20px) scale(0.95); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            @keyframes slideOut {
                from { opacity: 1; transform: translateY(0) scale(1); }
                to { opacity: 0; transform: translateY(10px) scale(0.95); }
            }

            /* MARKDOWN TABLES */
            .table-container { overflow-x: auto; border-radius: var(--sa-radius-md); border: var(--sa-border-default); background: var(--sa-surface-panel); margin: var(--sa-space-5) 0; box-shadow: inset 0 1px 0 rgba(255,255,255,0.02); }
            table { width: 100%; border-collapse: collapse; font-size: var(--sa-type-body); line-height: var(--sa-leading-normal); text-align: left; }
            th { background: var(--sa-surface-header); padding: var(--sa-space-5) var(--sa-space-6); color: var(--sa-text-muted); font-weight: var(--sa-font-semibold); border-bottom: var(--sa-border-default); }
            td { padding: var(--sa-space-5) var(--sa-space-6); border-bottom: var(--sa-border-subtle); color: var(--sa-text-soft); }
            tr:last-child td { border-bottom: none; }
            
            /* ENHANCED CODE BLOCKS */
            .code-block-wrapper { background: var(--sa-surface-field); border: var(--sa-border-default); border-radius: var(--sa-radius-md); overflow: hidden; margin: var(--sa-space-5) 0; }
            .code-header { display: flex; justify-content: space-between; align-items: center; background: var(--sa-surface-header); padding: var(--sa-space-3) var(--sa-space-6); border-bottom: var(--sa-border-default); }
            .lang-label { font-size: var(--sa-type-caption); line-height: var(--sa-leading-tight); color: var(--sa-text-subtle); font-weight: var(--sa-font-semibold); letter-spacing: 0; }
            .copy-btn { background: transparent; border: none; color: var(--sa-text-muted); font-size: var(--sa-type-meta); line-height: var(--sa-leading-tight); cursor: pointer; display: flex; align-items: center; gap: var(--sa-space-2); }
            .copy-btn:hover { color: var(--sa-text-strong); }
            pre { margin: 0; padding: var(--sa-space-6); overflow-x: auto; }
            code { font-family: 'JetBrains Mono', monospace; font-size: var(--sa-type-small); line-height: var(--sa-leading-normal); color: var(--sa-text-soft); }

            /* HEADER TOOLBAR */
            .chat-header-select {
                box-sizing: border-box;
                height: var(--sa-control-xl);
                background: var(--sa-surface-control);
                color: var(--sa-text-strong);
                border: var(--sa-border-strong);
                border-radius: var(--sa-radius-md);
                padding: 0 var(--sa-space-5);
                font-size: var(--sa-type-body);
                font-weight: var(--sa-font-medium);
                line-height: var(--sa-leading-tight);
                cursor: pointer;
                outline: none;
                box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
                transition: background var(--sa-transition-normal), border-color var(--sa-transition-normal), color var(--sa-transition-normal);
            }
            .chat-header-select:hover,
            .chat-header-select:focus {
                background: var(--sa-surface-control-hover);
                border-color: rgba(255,107,74,0.20);
            }
            .chat-header-actions {
                box-sizing: border-box;
                height: var(--sa-control-xl);
                display: inline-flex;
                align-items: center;
                gap: var(--sa-space-1);
                padding: var(--sa-space-1);
                flex: 0 0 auto;
                background: var(--sa-surface-base);
                border: var(--sa-border-default);
                border-radius: var(--sa-radius-lg);
                box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);
            }
            .chat-header-action {
                box-sizing: border-box;
                width: var(--sa-control-sm);
                height: var(--sa-control-sm);
                appearance: none;
                background: transparent;
                color: #b8b8b8;
                border: 1px solid transparent;
                border-radius: var(--sa-radius-md);
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                flex: 0 0 auto;
                transition: background var(--sa-transition-normal), border-color var(--sa-transition-normal), color var(--sa-transition-normal), transform var(--sa-transition-fast);
            }
            .chat-header-action:hover {
                background: var(--sa-surface-hover);
                border-color: rgba(255,255,255,0.08);
                color: var(--sa-accent-soft);
            }
            .chat-header-action:focus-visible {
                outline: none;
                border-color: rgba(255,107,74,0.24);
            }
            .chat-header-action:active { transform: scale(0.96); }
            .chat-header-action svg {
                width: var(--sa-icon-md);
                height: var(--sa-icon-md);
                display: block;
            }
            .chat-action-btn--quiet {
                width: var(--sa-control-xs);
                padding-left: 0 !important;
                padding-right: 0 !important;
            }
            .chat-action-btn--quiet svg {
                width: var(--sa-icon-xs);
                height: var(--sa-icon-xs);
                display: block;
            }
            .chat-action-btn svg {
                width: var(--sa-icon-xs);
                height: var(--sa-icon-xs);
                display: block;
                flex: 0 0 auto;
            }
            .assistant-actions {
                opacity: 0.72;
                transition: opacity var(--sa-transition-normal);
            }
            .assistant-message:hover .assistant-actions,
            .assistant-message:focus-within .assistant-actions {
                opacity: 1;
            }
            .snip-message {
                max-width: 68% !important;
                padding: var(--sa-space-3) !important;
                opacity: 0.86;
                transition: opacity var(--sa-transition-normal), border-color var(--sa-transition-normal);
            }
            .snip-message:hover,
            .snip-message:focus-within {
                opacity: 1;
            }
            .snip-ocr-toggle:focus-visible {
                outline: none;
                border-color: rgba(255,107,74,0.32) !important;
                color: var(--sa-accent-soft) !important;
            }

            /* CHAT COMPOSER */
            .chat-input-area {
                box-sizing: border-box;
                padding: var(--sa-space-4) var(--sa-space-5) var(--sa-space-5);
                border-top: var(--sa-border-subtle);
                background: var(--sa-surface-canvas);
                border-radius: 0 0 var(--sa-radius-xl) var(--sa-radius-xl);
                flex-shrink: 0;
            }
            .chat-input-shell {
                box-sizing: border-box;
                display: flex;
                align-items: flex-end;
                gap: var(--sa-space-2);
                min-height: var(--sa-control-input);
                background: var(--sa-surface-base);
                border: var(--sa-border-default);
                border-radius: var(--sa-radius-lg);
                padding: var(--sa-space-2) var(--sa-space-2) var(--sa-space-2) var(--sa-space-6);
                box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
                transition: border-color var(--sa-transition-normal), background var(--sa-transition-normal), box-shadow var(--sa-transition-normal);
            }
            .chat-input-shell:focus-within {
                background: var(--sa-surface-panel);
                border-color: rgba(255,107,74,0.18);
                box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
            }
            .chat-followup-input {
                box-sizing: border-box;
                flex: 1 1 auto;
                min-width: 0;
                min-height: 22px;
                max-height: 112px;
                background: transparent;
                border: none;
                color: var(--sa-text-primary);
                padding: var(--sa-space-3) 0;
                resize: none;
                font-family: inherit;
                font-size: var(--sa-type-body);
                line-height: var(--sa-leading-normal);
                outline: none;
                scrollbar-width: thin;
                scrollbar-color: #404040 transparent;
            }
            .chat-followup-input::placeholder {
                color: var(--sa-text-subtle);
            }
            .chat-send-btn {
                box-sizing: border-box;
                width: var(--sa-control-lg);
                height: var(--sa-control-lg);
                min-width: var(--sa-control-lg);
                border: 1px solid rgba(255,107,74,0.18);
                border-radius: var(--sa-radius-md);
                background: rgba(255,107,74,0.14);
                color: var(--sa-accent-soft);
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                font-size: var(--sa-type-ui);
                font-weight: var(--sa-font-semibold);
                line-height: var(--sa-leading-tight);
                box-shadow: none;
                margin-left: var(--sa-space-1);
                transition: background var(--sa-transition-normal), border-color var(--sa-transition-normal), color var(--sa-transition-normal), transform var(--sa-transition-fast), opacity var(--sa-transition-normal);
            }
            .chat-send-btn svg {
                width: var(--sa-icon-md);
                height: var(--sa-icon-md);
                display: block;
            }
            .chat-send-btn:hover:not(:disabled) {
                background: rgba(255,107,74,0.20);
                border-color: rgba(255,107,74,0.30);
                color: var(--sa-accent-soft);
            }
            .chat-send-btn:focus-visible {
                outline: none;
                border-color: rgba(255,107,74,0.36);
            }
            .chat-send-btn:active:not(:disabled) {
                transform: scale(0.96);
            }
            .chat-send-btn:disabled {
                cursor: default;
                background: rgba(255,255,255,0.035);
                border-color: transparent;
                color: var(--sa-text-muted);
            }
            
            /* TYPING INDICATOR */
            .typing-container { display: flex; align-items: center; gap: var(--sa-space-5); margin-bottom: var(--sa-space-5); padding: 0; width: fit-content; max-width: 100%; }
            .typing-bubble { background: transparent; padding: 0; display: flex; gap: var(--sa-space-2); width: fit-content; }
            .dot { width: 6px; height: 6px; background: #666; border-radius: 50%; animation: bounce 1.4s infinite ease-in-out both; }
            .dot:nth-child(1) { animation-delay: -0.32s; }
            .dot:nth-child(2) { animation-delay: -0.16s; }
            @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); background: #f55036; } }
            .thinking-text { font-size: var(--sa-type-meta); line-height: var(--sa-leading-tight); color: var(--sa-text-muted); font-style: normal; animation: pulse 1.5s infinite; }
            @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
            .stop-btn { width: var(--sa-control-xs); height: var(--sa-control-xs); background: transparent; border: none; color: var(--sa-text-subtle); padding: 0; border-radius: var(--sa-radius-pill); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background var(--sa-transition-normal), color var(--sa-transition-normal), transform var(--sa-transition-fast); margin-left: var(--sa-space-1); }
            .stop-btn svg { width: var(--sa-icon-sm); height: var(--sa-icon-sm); display: block; }
            .stop-btn:hover { color: #ff8a6d; background: rgba(245, 80, 54, 0.08); }
            .stop-btn:active { transform: scale(0.94); }
            
            /* MATH BLOCKS (LaTeX) */
            .math-block { background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: var(--sa-radius-sm); padding: var(--sa-space-6) var(--sa-space-8); margin: var(--sa-space-5) 0; overflow-x: auto; text-align: center; }
            .math-inline { background: rgba(139, 92, 246, 0.15); padding: var(--sa-space-1) var(--sa-space-3); border-radius: var(--sa-radius-xs); color: #c4b5fd; }
            .katex { font-size: 1.1em; color: #c4b5fd; }
            .katex-display { margin: 0.5em 0; }
        `;
        this.shadow.appendChild(style);

        // Header with model selector
        const header = document.createElement("div");
        this.header = header;
        header.style.cssText = `
            padding: 7px var(--sa-space-5);
            background: var(--sa-surface-header);
            border-bottom: var(--sa-border-default);
            cursor: move; display: flex; justify-content: flex-start; align-items: center;
            border-radius: var(--sa-radius-xl) var(--sa-radius-xl) 0 0; user-select: none; gap: var(--sa-space-4);
            position: relative;
            border-top: var(--sa-border-top-accent);
        `;

        const titleSection = document.createElement("div");
        titleSection.style.cssText = "display: flex; align-items: center; gap: var(--sa-space-4); flex: 1 1 auto; min-width: 0;";

        const brandIcon = document.createElement("img");
        brandIcon.src = chrome.runtime.getURL("assets/icons/icon-32.png");
        brandIcon.alt = "Snip & Ask";
        brandIcon.style.cssText = `
            width: var(--sa-icon-lg);
            height: var(--sa-icon-lg);
            flex: 0 0 auto;
            display: block;
            object-fit: contain;
        `;
        titleSection.appendChild(brandIcon);

        // Model selector dropdown
        this.modelSelect = document.createElement("select");
        this.modelSelect.className = "chat-header-select";
        this.modelSelect.style.cssText = `
            flex: 1 1 auto;
            min-width: 72px;
            max-width: 220px;
        `;

        // Populate options
        this.availableModels.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m.value;
            opt.textContent = m.name;
            if (m.value === this.currentModel) opt.selected = true;
            this.modelSelect.appendChild(opt);
        });

        this.modelSelect.addEventListener("change", () => {
            this.currentModel = this.modelSelect.value;
            chrome.storage.local.set({ selectedModel: this.currentModel });
            if (WindowManager.isSidebarMode()) {
                WindowManager.refreshLayout();
            }
            this.onSessionChanged?.();
        });

        titleSection.appendChild(this.modelSelect);

        // Mode selector dropdown
        this.modeSelect = document.createElement("select");
        this.modeSelect.className = "chat-header-select";
        this.modeSelect.style.cssText = `
            flex: 0 1 140px;
            min-width: 124px;
            max-width: 150px;
        `;

        // Load all modes from storage (includes built-in and user-created modes)
        // This matches how popup.js handles modes - storage is the source of truth
        if (this.customModes && this.customModes.length > 0) {
            this.customModes.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m.id;
                opt.textContent = m.name;
                if (m.id === this.currentMode) opt.selected = true;
                this.modeSelect.appendChild(opt);
            });
        } else {
            // Fallback if no modes in storage (shouldn't normally happen)
            const defaultModes = [
                { id: 'short', name: 'Short Answer' },
                { id: 'detailed', name: 'Detailed' },
                { id: 'code', name: 'Code Debug' }
            ];
            defaultModes.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m.id;
                opt.textContent = m.name;
                if (m.id === this.currentMode) opt.selected = true;
                this.modeSelect.appendChild(opt);
            });
        }

        // Add custom prompt option (only if user has a custom prompt set)
        if (this.customPrompt) {
            const customOpt = document.createElement("option");
            customOpt.value = 'custom';
            customOpt.textContent = 'Custom Prompt';
            if (this.currentMode === 'custom') customOpt.selected = true;
            this.modeSelect.appendChild(customOpt);
        }

        this.modeSelect.addEventListener("change", () => {
            this.currentMode = this.modeSelect.value;
            chrome.storage.local.set({ selectedMode: this.currentMode });
            this.onSessionChanged?.();
        });

        titleSection.appendChild(this.modeSelect);
        header.appendChild(titleSection);

        const actionGroup = document.createElement("div");
        this.actionGroup = actionGroup;
        actionGroup.className = "chat-header-actions";

        // Snip Again button
        const snipAgainBtn = document.createElement("button");
        snipAgainBtn.type = "button";
        this.snipAgainBtn = snipAgainBtn;
        snipAgainBtn.className = "chat-header-action";
        snipAgainBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`;
        snipAgainBtn.title = "Snip and add to this chat";
        snipAgainBtn.onclick = () => this.startSnipAgain();
        actionGroup.appendChild(snipAgainBtn);

        // Compare button
        const compareBtn = document.createElement("button");
        compareBtn.type = "button";
        this.compareBtn = compareBtn;
        compareBtn.className = "chat-header-action";
        compareBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
        compareBtn.title = "Compare with another model";
        compareBtn.onclick = () => this.spawnCompareWindow();
        actionGroup.appendChild(compareBtn);

        const displayModeBtn = document.createElement("button");
        displayModeBtn.type = "button";
        this.displayModeBtn = displayModeBtn;
        displayModeBtn.className = "chat-header-action";
        displayModeBtn.onclick = async () => {
            if (this.isGeneratingResponse()) {
                if (typeof showErrorToast === 'function') {
                    showErrorToast('Wait for the current response to finish before switching layout.');
                }
                return;
            }

            const session = this.serializeSession();
            if (this.isSidePanelHost) {
                const result = await chrome.runtime.sendMessage({ action: 'MOVE_SIDEPANEL_TO_POPUP', session });
                if (!result?.success && typeof showErrorToast === 'function') {
                    showErrorToast(result?.error || 'Could not move sidebar chat to popup.');
                }
                return;
            }

            const result = await chrome.runtime.sendMessage({ action: 'MOVE_CHAT_TO_SIDE_PANEL', session });
            if (result?.success) {
                this.close();
                return;
            }

            if (typeof showErrorToast === 'function') {
                showErrorToast(result?.error || 'Could not move popup chat to sidebar.');
            }
        };
        actionGroup.appendChild(displayModeBtn);

        // Minimize button
        const minimizeBtn = document.createElement("button");
        minimizeBtn.type = "button";
        this.minimizeBtn = minimizeBtn;
        minimizeBtn.className = "chat-header-action";
        minimizeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
        minimizeBtn.title = "Minimize to bubble";
        minimizeBtn.onclick = () => this.minimize();
        actionGroup.appendChild(minimizeBtn);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        this.closeBtn = closeBtn;
        closeBtn.id = "closeBtn";
        closeBtn.className = "chat-header-action";
        closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        actionGroup.appendChild(closeBtn);
        header.appendChild(actionGroup);

        this.container.appendChild(header);

        // Chat Body
        this.chatBody = document.createElement("div");
        this.chatBody.style.cssText = `
            flex-grow: 1; overflow-y: auto; overflow-x: hidden; padding: var(--sa-space-8);
            display: flex; flex-direction: column; gap: var(--sa-space-8);
            background: var(--sa-surface-canvas);
            scrollbar-width: thin; scrollbar-color: #404040 transparent;
            scroll-behavior: smooth;
            min-height: 0;
        `;
        this.container.appendChild(this.chatBody);

        // Input Area
        const inputArea = document.createElement("div");
        this.inputArea = inputArea;
        inputArea.className = "chat-input-area";

        const inputShell = document.createElement("div");
        this.inputShell = inputShell;
        inputShell.className = "chat-input-shell";

        this.input = document.createElement("textarea");
        this.input.className = "chat-followup-input";
        this.input.placeholder = "Ask a follow-up...";
        this.input.rows = 1;

        this.input.addEventListener('input', () => {
            this.input.style.height = 'auto';
            this.input.style.height = Math.min(this.input.scrollHeight, 112) + 'px';
        });

        // Prevent host page (GitHub, Gmail, etc.) from capturing keyboard events
        // These sites have global keyboard shortcuts that can steal focus
        const stopPropagation = (e) => {
            e.stopPropagation();
        };
        this.input.addEventListener('keydown', stopPropagation);
        this.input.addEventListener('keyup', stopPropagation);
        this.input.addEventListener('keypress', stopPropagation);

        // Also prevent focus-related events from bubbling
        this.input.addEventListener('focus', stopPropagation);
        this.input.addEventListener('blur', stopPropagation);
        this.input.addEventListener('focusin', stopPropagation);
        this.input.addEventListener('focusout', stopPropagation);

        this.sendBtn = document.createElement("button");
        this.sendBtn.type = "button";
        this.sendBtn.className = "chat-send-btn";
        this.sendBtn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5V3.75M4.5 7.25 8 3.75l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        this.sendBtn.title = "Send";
        this.sendBtn.setAttribute("aria-label", "Send");
        this.sendBtn.onclick = () => this.handleSend();

        // Consolidated keyboard handlers for follow-up input.
        // We listen on both `keydown` and `beforeinput` so Enter-to-send remains
        // reliable on pages that aggressively intercept key events.
        const isPlainEnter = (e) => {
            if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return false;
            return e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter';
        };

        this.input.addEventListener('keydown', (e) => {
            if (isPlainEnter(e)) {
                e.preventDefault();
                e.stopPropagation();
                this.handleSend();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            }
        });

        this.input.addEventListener('beforeinput', (e) => {
            if (e.inputType === 'insertLineBreak' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                this.handleSend();
            }
        });

        inputShell.appendChild(this.input);
        inputShell.appendChild(this.sendBtn);
        inputArea.appendChild(inputShell);
        this.container.appendChild(inputArea);

        this.shadow.appendChild(this.container);
        document.body.appendChild(this.host);

        // --- Event Listeners ---
        closeBtn.onclick = () => this.close();

        this.makeDraggable(header);

        this.container.addEventListener('mouseup', () => this.saveState());

        // Prevent ALL keyboard events from reaching the host page
        // This is critical for sites like GitHub/Gmail that have aggressive keyboard shortcuts
        const preventHostCapture = (e) => {
            e.stopPropagation();
        };
        this.host.addEventListener('keydown', preventHostCapture, true);
        this.host.addEventListener('keyup', preventHostCapture, true);
        this.host.addEventListener('keypress', preventHostCapture, true);

        this.setDisplayMode(this.displayMode);
    }

    setDisplayMode(mode) {
        this.displayMode = mode === 'sidebar' ? 'sidebar' : 'popup';

        if (!this.container || !this.header) {
            return;
        }

        if (this.displayMode === 'sidebar') {
            if (this.isSidePanelHost) {
                this.host.style.cssText = 'all: initial; position: static; display: block; width: 100%; height: 100%;';
                this.container.style.position = 'relative';
                this.container.style.width = '100%';
                this.container.style.height = '100%';
                this.container.style.maxHeight = '100%';
                this.container.style.minHeight = '100%';
                this.container.style.minWidth = '0';
                this.container.style.maxWidth = '100%';
                this.container.style.removeProperty('top');
                this.container.style.removeProperty('right');
                this.container.style.removeProperty('left');
                this.container.style.removeProperty('bottom');
                this.container.style.removeProperty('transform');
            } else {
                this.host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;';
                this.container.style.position = 'fixed';
                this.container.style.width = '100vw';
                this.container.style.height = '100vh';
                this.container.style.maxHeight = '100vh';
                this.container.style.minHeight = '100vh';
                this.container.style.minWidth = '100vw';
                this.container.style.maxWidth = '100vw';
                this.container.style.top = '0';
                this.container.style.right = '0';
                this.container.style.left = 'auto';
                this.container.style.bottom = 'auto';
            }
            this.container.style.borderRadius = '0';
            this.container.style.borderRight = 'none';
            this.container.style.borderTop = 'none';
            this.container.style.resize = 'none';
            this.container.style.boxShadow = 'none';
            this.container.style.margin = '0';
            this.header.style.cursor = 'default';
            this.header.style.borderRadius = '0';
            this.header.style.padding = '7px var(--sa-space-5)';
            if (this.inputArea) this.inputArea.style.borderRadius = '0';
            if (this.minimizeBtn) this.minimizeBtn.style.display = 'none';
            this.hasSavedPosition = false;
        } else {
            this.host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;';
            this.container.style.position = 'fixed';
            this.container.style.width = '480px';
            this.container.style.height = '580px';
            this.container.style.minWidth = '320px';
            this.container.style.minHeight = '280px';
            this.container.style.maxWidth = '90vw';
            this.container.style.maxHeight = '90vh';
            this.container.style.top = this.container.style.top || '50px';
            this.container.style.bottom = 'auto';
            this.container.style.borderRadius = 'var(--sa-radius-xl)';
            this.container.style.border = 'var(--sa-border-strong)';
            this.container.style.borderTop = 'var(--sa-border-top-accent)';
            this.container.style.borderRight = 'var(--sa-border-strong)';
            this.container.style.resize = 'both';
            this.container.style.boxShadow = 'var(--sa-shadow-overlay)';
            this.header.style.cursor = 'move';
            this.header.style.borderRadius = 'var(--sa-radius-xl) var(--sa-radius-xl) 0 0';
            this.header.style.padding = '7px var(--sa-space-5)';
            if (this.inputArea) this.inputArea.style.borderRadius = '0 0 var(--sa-radius-xl) var(--sa-radius-xl)';
            if (this.minimizeBtn) this.minimizeBtn.style.display = 'flex';
            this.loadState();
        }

        this.updateDisplayModeButton();
    }

    applyManagedLayout({ mode, isActive }) {
        if (!this.container) return;

        if (mode === 'sidebar') {
            this.container.style.display = isActive ? 'flex' : 'none';
            return;
        }

        this.container.style.display = 'flex';
    }

    renderSidebarTabs(windows, activeWindowId) {
        return;
    }

    updateDisplayModeButton() {
        if (!this.displayModeBtn) return;

        if (this.displayMode === 'sidebar') {
            this.displayModeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 8l5 4-5 4"/><path d="M21 12H9"/></svg>`;
            this.displayModeBtn.title = 'Pop out to popup';
        } else {
            this.displayModeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/></svg>`;
            this.displayModeBtn.title = 'Move to sidebar';
        }
    }

    serializeSession() {
        return SnipAskSession.serializeFloatingChat(this);
    }

    hydrateFromSession(session, options = {}) {
        SnipAskSession.hydrateFloatingChat(this, session, options);
    }

    /**
     * Add a message to the chat
     * @param {string} role - 'user' or 'assistant'
     * @param {string|Object} content - Message content (can include image_url data)
     * @param {string|null} modelName - Model name for assistant messages
     * @param {boolean} isError - Whether this is an error message
     * @param {string|null} base64Image - Optional base64 image data for this message
     * @param {boolean} isRegenerated - Whether this is a regenerated response
     * @param {Object|null} tokenUsage - Token usage data from API response
     * @param {Object|null} metadata - Internal message metadata
     */
    addMessage(role, content, modelName = null, isError = false, base64Image = null, isRegenerated = false, tokenUsage = null, metadata = null) {
        const msgModel = role === 'assistant' ? (modelName || this.currentModel) : null;
        const messageMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : null;
        if (role === 'assistant' && tokenUsage && messageMetadata && !messageMetadata.tokenUsage) {
            messageMetadata.tokenUsage = tokenUsage;
        }
        const historyEntry = createChatHistoryEntry(role, content, msgModel, base64Image, isRegenerated, messageMetadata);

        this.chatHistory.push(historyEntry);
        const messageIndex = this.chatHistory.length - 1;

        renderChatMessage(this, {
            role,
            content,
            displayText: historyEntry.displayText,
            base64Image,
            isError,
            isRegenerated,
            messageIndex,
            metadata: historyEntry.metadata,
            modelLabel: role === 'assistant' ? this._getModelDisplayName(msgModel) : null,
            tokenUsage
        });

        this.chatBody.scrollTop = this.chatBody.scrollHeight;
        this.onSessionChanged?.();
        if (role === 'assistant') {
            this._prepareFollowUpInput(isError);
        }
    }

    _prepareFollowUpInput(isError = false) {
        if (!this.input) return;
        this.input.placeholder = isError ? 'Ask a follow-up or adjust the request...' : 'Ask about this answer...';

        setTimeout(() => {
            if (!this.input || this.input.disabled || this.isGeneratingResponse()) return;
            if (WindowManager.pendingResponses > 0) return;
            if (this.isMinimized || this.container?.style.display === 'none') return;
            if (WindowManager.windows.length > 1 && this.displayMode !== 'sidebar') return;

            try {
                this.input.focus({ preventScroll: true });
            } catch {
                this.input.focus();
            }
        }, 80);
    }

    /**
     * Show typing indicator in chat
     */
    showTypingIndicator() {
        this.removeTypingIndicator(); // Ensure only one exists
        this._requestCancelled = false; // Reset cancel flag for new request
        this._requestFinishedNotified = false;
        this._requestInFlight = true;
        this._activeRequestId = crypto.randomUUID();

        const container = document.createElement("div");
        container.className = "typing-container";
        container.id = "typing-indicator";
        container.innerHTML = `
            <div class="typing-bubble">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
            <span class="thinking-text">Thinking...</span>
            <button class="stop-btn" title="Stop generating">
                <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M3 3 9 9M9 3 3 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
            </button>
        `;

        // Wire up stop button
        const stopBtn = container.querySelector('.stop-btn');
        stopBtn.addEventListener('click', () => this._handleStopRequest());

        this.chatBody.appendChild(container);
        this.chatBody.scrollTop = this.chatBody.scrollHeight;
        return this._activeRequestId;
    }

    /**
     * Handle user clicking the Stop button
     */
    _handleStopRequest() {
        const requestId = this._activeRequestId;
        this._requestCancelled = true;
        this.removeTypingIndicator();

        // Tell background to abort this window's in-progress request.
        chrome.runtime.sendMessage({ action: "CANCEL_AI_REQUEST", requestId });

        // Show stopped message
        this.addMessage('assistant', '⏹ Response stopped by user.', this.currentModel, true);

        // Re-enable input since this window's response is done
        this._notifyRequestFinished();
    }

    _notifyRequestFinished() {
        if (this._requestFinishedNotified) return;
        this._requestFinishedNotified = true;
        this._requestInFlight = false;
        WindowManager.onResponseReceived();
    }

    /**
     * Remove typing indicator from chat
     */
    removeTypingIndicator() {
        const existing = this.chatBody.querySelector("#typing-indicator");
        if (existing) existing.remove();
        this._requestInFlight = false;
    }

    isGeneratingResponse() {
        return Boolean(this._requestInFlight || this.chatBody?.querySelector("#typing-indicator"));
    }

    /**
     * Get display name for a model
     * @param {string} modelValue
     * @returns {string}
     */
    _getModelDisplayName(modelValue) {
        if (!modelValue) return 'AI';
        const found = this.availableModels.find(m => m.value === modelValue);
        if (found) return found.name;
        const parts = modelValue.split(/[/:]/);
        return parts[parts.length - 1] || 'AI';
    }

    _isVisionFallbackModel(modelValue) {
        return typeof modelValue === 'string' &&
            modelValue.toLowerCase().includes('qwen3.6-27b');
    }

    _createAssistantMetadata(response = {}, overrides = {}) {
        const selectedModel = response.selectedModel || overrides.selectedModel || this.currentModel;
        const responseModel = response.responseModel || response.model || overrides.responseModel || selectedModel;
        const tokenUsage = response.tokenUsage || overrides.tokenUsage || null;
        const usedOCR = response.usedOCR === true || overrides.usedOCR === true;
        const isGuestResponse = Boolean(response.guestInfo) || overrides.isGuestResponse === true;
        const visionRetryEligible = overrides.visionRetryEligible === true ||
            overrides.scoutRetryEligible === true ||
            (selectedModel === 'groq:auto' && usedOCR && isGuestResponse && !this._isVisionFallbackModel(responseModel));

        return {
            selectedModel,
            responseModel,
            usedOCR,
            isGuestResponse,
            visionRetryEligible,
            tokenUsage,
            visionRetry: overrides.visionRetry === true || overrides.scoutRetry === true
        };
    }

    _getTriggeringUserMessageIndex(assistantIndex) {
        for (let i = assistantIndex - 1; i >= 0; i--) {
            if (this.chatHistory[i]?.role === 'user') {
                return i;
            }
        }
        return -1;
    }

    _getVisionRetryImageForIndex(assistantIndex) {
        const userIndex = this._getTriggeringUserMessageIndex(assistantIndex);
        if (userIndex >= 0 && this.chatHistory[userIndex]?.base64Image) {
            return this.chatHistory[userIndex].base64Image;
        }

        return this.initialBase64Image || null;
    }

    _shouldShowVisionRetry(messageIndex, metadata = null) {
        const message = this.chatHistory[messageIndex];
        if (!message || message.role !== 'assistant') return false;

        const meta = metadata || message.metadata || {};
        const selectedModel = meta.selectedModel || null;
        const responseModel = meta.responseModel || message.model || null;

        if (meta.isGuestResponse !== true && this.isGuestMode !== true) return false;
        if (selectedModel !== 'groq:auto') return false;
        if (meta.visionRetryEligible === false || meta.scoutRetryEligible === false) return false;
        if (meta.usedOCR !== true) return false;
        if (this._isVisionFallbackModel(responseModel)) return false;
        return Boolean(this._getVisionRetryImageForIndex(messageIndex));
    }

    _rerenderChatHistory() {
        if (!this.chatBody) return;
        this.chatBody.innerHTML = '';
        this.chatHistory.forEach((message, index) => {
            renderClonedChatMessage(this, message, {
                includeActions: true,
                messageIndex: index
            });
        });
        this.chatBody.scrollTop = this.chatBody.scrollHeight;
    }

    _refreshChatMessageAtIndex(index) {
        if (!this.chatBody || !Number.isInteger(index) || !this.chatHistory[index]) return;

        const existing = this.chatBody.querySelector(`[data-snip-ask-message-index="${index}"]`);
        if (!existing) return;

        const replacement = renderClonedChatMessage(this, this.chatHistory[index], {
            includeActions: true,
            messageIndex: index
        });

        if (replacement) {
            existing.replaceWith(replacement);
        }
    }

    async retryWithVisionAtIndex(index) {
        return retryAssistantWithVision(this, index);
    }

    /**
     * Regenerate the last assistant response (convenience wrapper)
     */
    async regenerateLastResponse() {
        return regenerateLastChatResponse(this);
    }

    /**
     * Regenerate response at a specific index - "rewinds" conversation to that point
     * @param {number} index - The index of the assistant message to regenerate
     */
    async regenerateAtIndex(index) {
        return regenerateChatResponseAt(this, index);
    }

    /**
     * Add a regenerated message with indicator badge
     * @param {string} content - Message content
     * @param {string} modelName - Model name
     */
    _addRegeneratedMessage(content, modelName, response = {}, metadataOverrides = {}) {
        // Use addMessage but mark it as regenerated
        this.addMessage(
            'assistant',
            content,
            modelName,
            false,
            null,
            true,
            response.tokenUsage || null,
            this._createAssistantMetadata(response, metadataOverrides)
        );
    }

    /**
     * Build API-compatible history array from chatHistory up to (and including) specified index
     * @param {number} upToIndex - Include messages up to this index
     * @returns {Array} History formatted for API calls
     */
    _buildApiHistory(upToIndex) {
        return buildApiHistoryFromChat(this.chatHistory, upToIndex);
    }

    /**
     * Extract text content from history for context
     * @param {number} upToIndex - Include messages up to this index
     * @returns {string} Combined text content
     */
    _extractTextFromHistory(upToIndex) {
        return extractUserTextFromHistory(this.chatHistory, upToIndex);
    }

    _isReliableAutoOcrResult(ocrResult) {
        return isReliableAutoOcrResult(ocrResult);
    }

    _logAutoOcrFallback(context, ocrResult) {
        logAutoOcrFallback(context, ocrResult);
    }

    async _collectReliableAutoOcrText(images, context) {
        return collectReliableAutoOcrText(this, images, context);
    }

    async _sendAutoVisionFallback(images, textContext, requestId) {
        return sendAutoVisionFallback(this, images, textContext, requestId);
    }

    /**
     * Show full-size image in a modal overlay
     * @param {string} imgSrc - Image source URL or data URI
     */
    _showImageModal(imgSrc) {
        openSnipAskImageModal(this.shadow, imgSrc);
    }

    /**
     * Retry the last request (for error recovery)
     */
    async retryLastRequest() {
        await this.regenerateLastResponse();
    }

    /**
     * Start snip-again mode to add a new screenshot to this chat
     */
    async startSnipAgain() {
        // Set flags BEFORE starting snip so handleSnipComplete knows this is snip-again mode
        window._snipAgainMode = true;
        window._snipAgainTarget = this;

        // Minimize all chat windows temporarily
        WindowManager.windows.forEach(w => {
            if (w.container) w.container.style.display = 'none';
        });

        // Start the snip process using the global handleSnipComplete callback
        // which checks window._snipAgainMode to route appropriately
        if (typeof window.handleSnipComplete === 'function') {
            SnipSelection.start(window.handleSnipComplete);
        } else {
            // Fallback if handleSnipComplete isn't exposed (shouldn't happen)
            console.error('handleSnipComplete not found, snip-again may not work');
            SnipSelection.start((rect) => {
                console.warn('Snip completed but no handler available');
            });
        }
    }

    /**
     * Add a snipped image to all windows
     * @param {string} croppedBase64
     */
    addSnippedImage(croppedBase64) {
        // Show all windows again
        WindowManager.windows.forEach(w => {
            if (w.container) w.container.style.display = 'flex';
        });

        // Broadcast the new image to ALL windows
        WindowManager.windows.forEach(w => {
            w._processSnippedImage(croppedBase64);
        });

        if (!this.isSidePanelHost) {
            chrome.runtime.sendMessage({
                action: 'ADD_SNIPPED_IMAGE_TO_SIDEPANEL',
                base64Image: croppedBase64,
                sourceUiId: this.uiId
            }).catch(() => {
                // No active side panel is fine; popup windows already received the snip.
            });
        }

        WindowManager.refreshLayout();
    }

    /**
     * Process a snipped image for this window
     * Creates a proper message object (like the initial snip) so it persists in history correctly
     * @param {string} croppedBase64
     */
    _processSnippedImage(croppedBase64) {
        // Store image for compare window access
        this.allImages.push(croppedBase64);

        const requestId = this.showTypingIndicator();

        // Create a proper message object with image data (unified format like initial snip)
        const userContent = [
            { type: 'text', text: '(Additional screenshot)' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${croppedBase64}` } }
        ];

        // Add message with the full content AND store the base64 image
        this.addMessage('user', userContent, null, false, croppedBase64);
        const userMessageIndex = this.chatHistory.length - 1;
        const storeHiddenOcrText = (text) => {
            if (typeof text !== 'string' || !text.trim()) return;
            const userEntry = this.chatHistory[userMessageIndex];
            if (!userEntry || userEntry.role !== 'user') return;
            userEntry.content = text;
            userEntry.displayText = text;
            userEntry.metadata = {
                ...(userEntry.metadata || {}),
                usedOCR: true,
                ocrText: text.trim(),
                ocrView: userEntry.metadata?.ocrView || 'image'
            };
            this._refreshChatMessageAtIndex(userMessageIndex);
        };

        const handleSnippedImageResponse = (response) => {
            this.removeTypingIndicator();
            if (this._requestCancelled) return; // User clicked Stop
            if (response && response.success) {
                const responseModel = response.responseModel || response.model || this.currentModel;
                this.addMessage(
                    'assistant',
                    response.answer,
                    responseModel,
                    false,
                    null,
                    false,
                    response.tokenUsage,
                    this._createAssistantMetadata(response, {
                        selectedModel: this.currentModel,
                        usedOCR: response.usedOCR === true
                    })
                );
                if (response.guestInfo) {
                    updateLocalGuestCache(response.guestInfo);
                }
            } else {
                this.addMessage('assistant', "Error: " + (response?.error || "Unknown error"), this.currentModel, true);
            }
        };

        const sendSnippedImageToModel = () => {
            chrome.runtime.sendMessage({
                action: "ASK_AI",
                model: this.currentModel,
                base64Image: croppedBase64,
                mode: this.currentMode,
                requestId
            }, handleSnippedImageResponse);
        };

        const sendSnippedTextToModel = (text) => {
            chrome.runtime.sendMessage({
                action: "ASK_AI_TEXT",
                model: this.currentModel,
                text,
                base64Image: croppedBase64,
                mode: this.currentMode,
                requestId
            }, handleSnippedImageResponse);
        };

        const isAutoGuestModel = this.currentModel === 'groq:auto';

        if (isAutoGuestModel) {
            chrome.runtime.sendMessage({
                action: "PERFORM_OCR",
                base64Image: croppedBase64
            }, (ocrResult) => {
                if (this._isReliableAutoOcrResult(ocrResult)) {
                    storeHiddenOcrText(ocrResult.text);
                    sendSnippedTextToModel(ocrResult.text);
                } else {
                    this._logAutoOcrFallback('snip-again', ocrResult);
                    sendSnippedImageToModel();
                }
            });
        } else if (isVisionModel(this.currentModel)) {
            chrome.runtime.sendMessage({
                action: "ASK_AI",
                model: this.currentModel,
                base64Image: croppedBase64,
                mode: this.currentMode,
                requestId
            }, (response) => {
                this.removeTypingIndicator();
                if (this._requestCancelled) return; // User clicked Stop
                if (response && response.success) {
                    const responseModel = response.responseModel || response.model || this.currentModel;
                    this.addMessage(
                        'assistant',
                        response.answer,
                        responseModel,
                        false,
                        null,
                        false,
                        response.tokenUsage,
                        this._createAssistantMetadata(response, { selectedModel: this.currentModel })
                    );
                    if (response.guestInfo) {
                        updateLocalGuestCache(response.guestInfo);
                    }
                } else {
                    this.addMessage('assistant', "⚠️ Error: " + (response?.error || "Unknown error"), this.currentModel, true);
                }
            });
        } else {
            chrome.runtime.sendMessage({
                action: "PERFORM_OCR",
                base64Image: croppedBase64
            }, (ocrResult) => {
                if (ocrResult && ocrResult.success && ocrResult.text) {
                    storeHiddenOcrText(ocrResult.text);
                    chrome.runtime.sendMessage({
                        action: "ASK_AI_TEXT",
                        model: this.currentModel,
                        text: ocrResult.text,
                        base64Image: croppedBase64,
                        mode: this.currentMode,
                        requestId
                    }, (response) => {
                        this.removeTypingIndicator();
                        if (this._requestCancelled) return; // User clicked Stop
                        if (response && response.success) {
                            const responseModel = response.responseModel || response.model || this.currentModel;
                            this.addMessage(
                                'assistant',
                                response.answer,
                                responseModel,
                                false,
                                null,
                                false,
                                response.tokenUsage,
                                this._createAssistantMetadata(response, {
                                    selectedModel: this.currentModel,
                                    usedOCR: response.usedOCR === true
                                })
                            );
                            if (response.guestInfo) {
                                updateLocalGuestCache(response.guestInfo);
                            }
                        } else {
                            this.addMessage('assistant', "⚠️ Error: " + (response?.error || "Unknown error"), this.currentModel, true);
                        }
                    });
                } else {
                    this.removeTypingIndicator();
                    if (this._requestCancelled) return;
                    this.addMessage('assistant', "⚠️ OCR failed - no text extracted from image", this.currentModel, true);
                }
            });
        }
    }

    /**
     * Build summarized context for compare window
     * Includes original context + summary of follow-up messages
     * @returns {string}
     */
    _buildSummarizedContext() {
        // Get the initial message text
        let initialText = '';
        if (typeof this.initialUserMessage === 'string') {
            initialText = this.initialUserMessage;
        } else if (this.initialUserMessage && Array.isArray(this.initialUserMessage.content)) {
            const textPart = this.initialUserMessage.content.find(c => c.type === 'text');
            initialText = textPart ? textPart.text : '';
        } else if (this.initialUserMessage && typeof this.initialUserMessage.content === 'string') {
            initialText = this.initialUserMessage.content;
        }

        // Check if there are follow-up messages beyond the initial exchange
        // chatHistory: [{role, content, model}, ...]
        // First 2 entries are typically initial user message + initial assistant response
        const followUpMessages = this.chatHistory.slice(2);

        if (followUpMessages.length === 0) {
            // No follow-ups, just return initial context
            return initialText;
        }

        // Build summary of follow-ups (use displayText for consistent text handling)
        const userFollowUps = followUpMessages.filter(m => m.role === 'user');
        const snipAgainCount = userFollowUps.filter(m => {
            const text = m.displayText || (typeof m.content === 'string' ? m.content : '');
            return text.includes('(Additional screenshot)') || text.includes('(Snippet)') || m.base64Image;
        }).length;
        const textFollowUps = userFollowUps.filter(m => {
            const text = m.displayText || (typeof m.content === 'string' ? m.content : '');
            return !text.includes('(Additional screenshot)') && !text.includes('(Snippet)') && !m.base64Image;
        });

        let summary = initialText;

        if (snipAgainCount > 0 || textFollowUps.length > 0) {
            summary += '\n\n---\n[Additional context from conversation:]\n';

            if (snipAgainCount > 0) {
                summary += `• User added ${snipAgainCount} more screenshot(s) to analyze\n`;
            }

            // Include text follow-ups (condensed)
            textFollowUps.forEach((msg, i) => {
                const text = msg.displayText || (typeof msg.content === 'string' ? msg.content : '');
                const truncated = text.length > 100
                    ? text.substring(0, 100) + '...'
                    : text;
                summary += `• Follow-up ${i + 1}: "${truncated}"\n`;
            });
        }

        return summary;
    }

    /**
     * Spawn a comparison window with a different model.
     * Duplicates the entire chat history and regenerates the last response.
     */
    async spawnCompareWindow() {
        return spawnCompareWindowFor(this);
    }

    /**
     * Helper to render a cloned message in a new window
     * @param {FloatingChatUI} targetUI - The target window
     * @param {Object} msg - The message object from chatHistory
     */
    _renderClonedMessage(targetUI, msg) {
        renderClonedChatMessage(targetUI, msg);
    }

    _getNextAvailableModel() {
        return getNextAvailableChatModel(this);
    }

    /**
     * Enable/disable input controls
     * @param {boolean} disabled
     */
    setInputDisabled(disabled) {
        if (this.input) {
            this.input.disabled = disabled;
            this.input.style.opacity = disabled ? '0.5' : '1';
            this.input.placeholder = disabled ? 'Waiting for responses...' : 'Ask about this answer...';
        }
        if (this.sendBtn) {
            this.sendBtn.disabled = disabled;
            this.sendBtn.style.opacity = disabled ? '0.5' : '1';
        }
    }

    /**
     * Send a message directly (for broadcast)
     * @param {string} text
     * @param {number} parallelCount
     * @param {string|null} mode - Interaction mode (short/detailed/code/default)
     */
    async sendMessageDirect(text, parallelCount = 1, mode = null) {
        this.addMessage('user', text);

        let requestId = this.showTypingIndicator();

        const modelToUse = this.currentModel;
        const modeToUse = mode || this.currentMode || 'short';

        // Use displayText for API calls (compatible format) while preserving model attribution
        const formattedHistory = formatChatHistoryForApi(this.chatHistory, this._getModelDisplayName.bind(this));

        // BYOK requests stream token-by-token over a dedicated port.
        // Guest mode still uses the plain request/response proxy.
        if (!this.isGuestMode && modelToUse !== 'groq:auto') {
            const streamed = await this._streamChatResponse({
                requestId,
                selectedModel: modelToUse,
                payload: {
                    action: "CONTINUE_CHAT",
                    model: modelToUse,
                    history: formattedHistory,
                    mode: modeToUse,
                    parallelCount: parallelCount,
                    requestId
                }
            });
            if (streamed === 'handled') {
                return;
            }
            // 'unsupported' (or interrupted before any output): retry legacy
            // path with a fresh indicator/requestId pair.
            requestId = this.showTypingIndicator();
        }

        try {
            const response = await chrome.runtime.sendMessage({
                action: "CONTINUE_CHAT",
                model: modelToUse,
                history: formattedHistory,
                mode: modeToUse,
                parallelCount: parallelCount,
                requestId
            });

            this.removeTypingIndicator();

            if (this._requestCancelled) {
                this._notifyRequestFinished();
                return;
            }

            if (response && response.success) {
                const responseModel = response.responseModel || response.model || modelToUse;
                this.addMessage(
                    'assistant',
                    response.answer,
                    responseModel,
                    false,
                    null,
                    false,
                    response.tokenUsage,
                    this._createAssistantMetadata(response, { selectedModel: modelToUse })
                );
                if (response.guestInfo) {
                    updateLocalGuestCache(response.guestInfo);
                }
            } else {
                this.addMessage('assistant', "⚠️ Error: " + (response?.error || "Unknown error"), modelToUse, true);
            }
        } catch (e) {
            this.removeTypingIndicator();
            if (this._requestCancelled) {
                this._notifyRequestFinished();
                return;
            }
            this.addMessage('assistant', "⚠️ Network Error: " + e.message, modelToUse, true);
        }
        this._notifyRequestFinished();
    }

    /**
     * Stream a chat request over the snip-ask-stream port.
     * @returns {Promise<'handled'|'unsupported'>} 'handled' when the response
     * (or error) was fully rendered here; 'unsupported' when the caller should
     * fall back to the legacy request/response path.
     */
    _streamChatResponse({ requestId, selectedModel, payload }) {
        return new Promise((resolve) => {
            let port;
            try {
                port = chrome.runtime.connect({ name: 'snip-ask-stream' });
            } catch {
                resolve('unsupported');
                return;
            }

            let settled = false;
            let sawDelta = false;
            let bubble = null;
            let pendingText = '';
            let renderer = null;
            let doneMsg = null;
            let finalized = false;

            const cleanup = () => {
                if (renderer) {
                    renderer.destroy();
                    renderer = null;
                }
                try {
                    port.disconnect();
                } catch {
                    // Already disconnected.
                }
                if (bubble) {
                    bubble.remove();
                    bubble = null;
                }
            };

            const finishCancelled = () => {
                if (settled) return;
                settled = true;
                cleanup();
                this.removeTypingIndicator();
                this._notifyRequestFinished();
                resolve('handled');
            };

            const finishInterrupted = () => {
                if (settled) return;
                settled = true;
                cleanup();
                if (!sawDelta) {
                    resolve('unsupported');
                    return;
                }
                this.removeTypingIndicator();
                this.addMessage('assistant', "⚠️ Connection interrupted. Please try again.", selectedModel, true);
                this._notifyRequestFinished();
                resolve('handled');
            };

            // Swap the streaming bubble for the canonical rendered message
            // once the typewriter reveal has caught up with the final text.
            const finalizeAfterDone = () => {
                if (finalized || !settled || !doneMsg) return;
                finalized = true;
                if (renderer) {
                    renderer.destroy();
                    renderer = null;
                }
                if (bubble) {
                    bubble.remove();
                    bubble = null;
                }
                this.removeTypingIndicator();

                if (this._requestCancelled) {
                    this._notifyRequestFinished();
                    resolve('handled');
                    return;
                }

                const response = doneMsg.response;
                if (response && response.success) {
                    const responseModel = response.responseModel || response.model || selectedModel;
                    this.addMessage(
                        'assistant',
                        response.answer,
                        responseModel,
                        false,
                        null,
                        false,
                        response.tokenUsage,
                        this._createAssistantMetadata(response, { selectedModel })
                    );
                    if (response.guestInfo) {
                        updateLocalGuestCache(response.guestInfo);
                    }
                } else {
                    this.addMessage('assistant', "⚠️ Error: " + (response?.error || "Unknown error"), selectedModel, true);
                }
                this._notifyRequestFinished();
                resolve('handled');
            };

            const ensureRenderer = () => {
                if (renderer || !bubble) return renderer;
                const contentDiv = bubble.querySelector('.sa-streaming-content');
                if (!contentDiv || typeof createSnipAskStreamRenderer !== 'function') {
                    return null;
                }
                renderer = createSnipAskStreamRenderer(contentDiv, {
                    onRender: () => {
                        const body = this.chatBody;
                        const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
                        if (distanceFromBottom < 120) {
                            body.scrollTop = body.scrollHeight;
                        }
                        // Stop clicked while the reveal was still draining.
                        if (settled && this._requestCancelled && doneMsg) {
                            finalizeAfterDone();
                        }
                    },
                    onSettled: () => finalizeAfterDone()
                });
                return renderer;
            };

            port.onDisconnect.addListener(() => {
                if (this._requestCancelled) {
                    finishCancelled();
                    return;
                }
                finishInterrupted();
            });

            port.onMessage.addListener((msg) => {
                if (settled) return;

                if (msg.type === 'delta') {
                    if (this._requestCancelled) return;
                    if (!bubble) {
                        this.removeTypingIndicator();
                        bubble = this._createStreamingBubble();
                    }
                    sawDelta = true;
                    pendingText += msg.text;
                    ensureRenderer()?.update(pendingText);
                    return;
                }

                if (msg.type === 'done') {
                    settled = true;
                    doneMsg = msg;
                    try {
                        port.disconnect();
                    } catch {
                        // Background already closed the port.
                    }

                    if (this._requestCancelled || !renderer) {
                        // Nothing (or nothing worth draining) on screen.
                        finalizeAfterDone();
                        return;
                    }
                    // Let the typewriter reveal catch up, then swap renders.
                    renderer.complete();
                    return;
                }

                if (msg.type === 'error') {
                    if (this._requestCancelled) {
                        finishCancelled();
                        return;
                    }
                    settled = true;
                    cleanup();
                    this.removeTypingIndicator();
                    this.addMessage('assistant', "⚠️ Error: " + (msg.error || "Unknown error"), selectedModel, true);
                    this._notifyRequestFinished();
                    resolve('handled');
                }
            });

            port.postMessage(payload);
        });
    }

    /**
     * Create a live-updating assistant bubble for streamed output.
     */
    _createStreamingBubble() {
        // One-time caret animation styles for this shadow root.
        if (this.shadow && !this.shadow.getElementById('sa-stream-caret-style')) {
            const style = document.createElement('style');
            style.id = 'sa-stream-caret-style';
            style.textContent = `
                @keyframes saCaretBlink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0; } }
                .sa-stream-caret {
                    display: inline-block;
                    margin-left: 1px;
                    color: var(--sa-accent-soft, #ff8a6d);
                    animation: saCaretBlink 0.9s steps(1) infinite;
                }
            `;
            this.shadow.appendChild(style);
        }

        const msgDiv = document.createElement('div');
        // Matches the flat assistant-message style so the final render swap
        // doesn't shift the layout.
        msgDiv.className = 'assistant-message';
        msgDiv.style.cssText = "max-width: 100%; padding: 0; border-radius: 0; line-height: var(--sa-leading-reading); word-wrap: break-word; font-size: var(--sa-type-body-large); align-self: flex-start; background: transparent; color: var(--sa-text-primary); border: none; box-shadow: none;";
        const contentDiv = document.createElement('div');
        contentDiv.className = 'sa-streaming-content';
        msgDiv.appendChild(contentDiv);
        this.chatBody.appendChild(msgDiv);
        this.chatBody.scrollTop = this.chatBody.scrollHeight;
        return msgDiv;
    }

    /**
     * Handle send button click
     */
    async handleSend() {
        const text = this.input.value.trim();
        if (!text) return;
        this.input.value = "";
        this.input.style.height = 'auto';
        this._requestInFlight = true;
        WindowManager.broadcastFollowUp(text, this);
    }

    /**
     * Make the header draggable
     * @param {HTMLElement} header
     */
    makeDraggable(header) {
        let isDragging = false;
        let offsetX, offsetY;
        let animationFrameId = null;
        let containerWidth, containerHeight;

        header.addEventListener('mousedown', (e) => {
            if (this.displayMode === 'sidebar') return;
            if (e.target.id === 'closeBtn') return;
            // Prevent drag when clicking controls
            if (e.target.closest('button') || e.target.closest('select')) return;

            isDragging = true;

            // Cache dimensions and offsets
            const rect = this.container.getBoundingClientRect();
            containerWidth = rect.width;
            containerHeight = rect.height;
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;

            // Optimization: Remove transitions during drag
            this.container.style.transition = 'none';
        });

        const onMouseMove = (e) => {
            if (!isDragging) return;
            e.preventDefault();

            if (animationFrameId) return;

            animationFrameId = requestAnimationFrame(() => {
                const mouseX = e.clientX;
                const mouseY = e.clientY;

                let newLeft = mouseX - offsetX;
                let newTop = mouseY - offsetY;

                // Viewport boundary checks (keep fully on screen)
                const winWidth = window.innerWidth;
                const winHeight = window.innerHeight;

                newLeft = Math.max(0, Math.min(newLeft, winWidth - containerWidth));
                newTop = Math.max(0, Math.min(newTop, winHeight - containerHeight));

                this.container.style.left = newLeft + "px";
                this.container.style.top = newTop + "px";
                this.container.style.right = 'auto'; // Ensure right doesn't conflict

                animationFrameId = null;
            });
        };

        const onMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
                this.container.style.transition = ''; // Restore transitions
                this.saveState();
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        this._dragCleanup = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        };
    }

    /**
     * Save window position and size to storage
     */
    saveState() {
        if (this.displayMode === 'sidebar') return;

        const rect = this.container.getBoundingClientRect();
        chrome.storage.local.set({
            chatWinState: {
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height
            }
        });
    }

    /**
     * Load window position and size from storage
     */
    loadState() {
        if (this.displayMode === 'sidebar') {
            this.hasSavedPosition = false;
            return;
        }

        this.hasSavedPosition = true;

        chrome.storage.local.get(['chatWinState'], (res) => {
            if (this.displayMode === 'sidebar') {
                this.hasSavedPosition = false;
                return;
            }

            if (res.chatWinState) {
                const s = res.chatWinState;
                const top = Math.max(0, Math.min(s.top, window.innerHeight - 50));
                const left = Math.max(0, Math.min(s.left, window.innerWidth - 50));

                this.container.style.top = top + "px";
                this.container.style.left = left + "px";
                this.container.style.right = 'auto';

                if (s.width) this.container.style.width = s.width + "px";
                if (s.height) this.container.style.height = s.height + "px";
            } else {
                this.hasSavedPosition = false;
                this.container.style.top = "50px";
                this.container.style.right = "50px";
                this.container.style.left = "auto";
            }
        });
    }
}


