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
        } else {
            // Fallback: minimal default if background script fails
            console.warn('Failed to fetch models from background:', modelResult?.error);
            this.availableModels = [
                { value: 'groq:auto', name: 'Auto' }
            ];
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
            min-height: 40px;
            padding: 6px 8px 6px 12px;
            background: rgba(18, 18, 18, 0.92);
            color: #fff4f1;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 999px;
            box-shadow: 0 14px 38px rgba(0, 0, 0, 0.34), 0 0 0 1px rgba(245, 80, 54, 0.08);
            backdrop-filter: blur(14px);
            cursor: move;
            display: flex;
            align-items: center;
            gap: 10px;
            white-space: nowrap;
            user-select: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        const bubbleIcon = document.createElement('img');
        bubbleIcon.src = chrome.runtime.getURL("assets/icons/icon-32.png");
        bubbleIcon.alt = "Snip & Ask";
        bubbleIcon.style.cssText = `
            width: 18px;
            height: 18px;
            display: block;
            object-fit: contain;
            flex: 0 0 auto;
        `;

        const bubbleLabel = document.createElement('span');
        bubbleLabel.style.cssText = `
            color: #d5d5d5;
            font-size: 12px;
            line-height: 1;
            max-width: 180px;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        bubbleLabel.textContent = this._getModelDisplayName(this.currentModel);

        const expandButton = document.createElement('button');
        expandButton.type = 'button';
        expandButton.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" style="width: 12px; height: 12px; display: block;"><path d="M3 7.25 6 4.25l3 3" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        expandButton.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            background: transparent;
            color: #d5d5d5;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 999px;
            padding: 0;
            font: inherit;
            cursor: pointer;
            transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
        `;
        expandButton.title = 'Expand';
        expandButton.addEventListener('mouseenter', () => {
            expandButton.style.background = 'rgba(245, 80, 54, 0.14)';
            expandButton.style.borderColor = 'rgba(245, 80, 54, 0.5)';
            expandButton.style.color = '#ff6b4a';
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
            this.container.style.background = this._savedState.background || 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)';
            this.container.style.border = this._savedState.border || '1px solid rgba(255, 107, 74, 0.4)';
            this.container.style.borderRadius = this._savedState.borderRadius || '12px';
            this.container.style.boxShadow = this._savedState.boxShadow || '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05)';
            this.container.style.overflow = this._savedState.overflow || 'hidden';
            this.container.style.backdropFilter = this._savedState.backdropFilter || 'blur(10px)';
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
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
            color: #e8e8e8;
            border: 1px solid rgba(255, 107, 74, 0.4); border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05);
            display: flex; flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; font-size: 14px;
            resize: both; overflow: hidden; 
            min-width: 320px; min-height: 280px;
            max-width: 90vw; max-height: 90vh;
            backdrop-filter: blur(10px);
            animation: slideIn 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;
        `;

        // Inject UX Polish Styles (Tables, Code Blocks, Typing Indicator)
        const style = document.createElement('style');
        style.textContent = `
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
            .table-container { overflow-x: auto; border-radius: 8px; border: 1px solid #333; background: #111; margin: 10px 0; }
            table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
            th { background: #1f1f1f; padding: 10px 12px; color: #aaa; font-weight: 600; border-bottom: 1px solid #333; }
            td { padding: 10px 12px; border-bottom: 1px solid #222; color: #ddd; }
            tr:last-child td { border-bottom: none; }
            
            /* ENHANCED CODE BLOCKS */
            .code-block-wrapper { background: #0d0d0d; border: 1px solid #333; border-radius: 8px; overflow: hidden; margin: 10px 0; }
            .code-header { display: flex; justify-content: space-between; align-items: center; background: #1a1a1a; padding: 6px 12px; border-bottom: 1px solid #333; }
            .lang-label { font-size: 10px; color: #666; font-weight: 700; letter-spacing: 0.5px; }
            .copy-btn { background: transparent; border: none; color: #888; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px; }
            .copy-btn:hover { color: #fff; }
            pre { margin: 0; padding: 12px; overflow-x: auto; }
            code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #ccc; }

            /* HEADER ICON BUTTONS */
            .chat-header-select {
                height: 36px;
                background: #080808;
                color: #f1f1f1;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 8px;
                padding: 0 12px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                outline: none;
                transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
            }
            .chat-header-select:hover,
            .chat-header-select:focus {
                background: #0d0d0d;
                border-color: rgba(255,107,74,0.38);
            }
            .chat-header-action {
                width: 30px;
                height: 30px;
                background: #0d0d0d;
                color: #c4c4c4;
                border: 1px solid rgba(255,255,255,0.13);
                border-radius: 999px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                flex: 0 0 auto;
                transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
            }
            .chat-header-action:hover {
                background: #101010;
                border-color: rgba(255,107,74,0.42);
                color: #ff8a6d;
            }
            .chat-header-action:active { transform: scale(0.94); }
            .chat-header-action svg {
                width: 14px;
                height: 14px;
                display: block;
            }
            
            /* TYPING INDICATOR */
            .typing-container { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; padding: 8px 10px; width: fit-content; max-width: 100%; background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; box-shadow: 0 8px 22px rgba(0,0,0,0.22); }
            .typing-bubble { background: transparent; padding: 0; display: flex; gap: 4px; width: fit-content; }
            .dot { width: 6px; height: 6px; background: #666; border-radius: 50%; animation: bounce 1.4s infinite ease-in-out both; }
            .dot:nth-child(1) { animation-delay: -0.32s; }
            .dot:nth-child(2) { animation-delay: -0.16s; }
            @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); background: #f55036; } }
            .thinking-text { font-size: 11px; color: #9ca3af; font-style: normal; animation: pulse 1.5s infinite; }
            @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
            .stop-btn { width: 26px; height: 26px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #b8b8b8; padding: 0; border-radius: 999px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.18s ease; margin-left: 2px; }
            .stop-btn svg { width: 12px; height: 12px; display: block; }
            .stop-btn:hover { border-color: rgba(245, 80, 54, 0.55); color: #ff6b4a; background: rgba(245, 80, 54, 0.12); }
            .stop-btn:active { transform: scale(0.94); }
            
            /* MATH BLOCKS (LaTeX) */
            .math-block { background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 6px; padding: 12px 16px; margin: 10px 0; overflow-x: auto; text-align: center; }
            .math-inline { background: rgba(139, 92, 246, 0.15); padding: 2px 6px; border-radius: 4px; color: #c4b5fd; }
            .katex { font-size: 1.1em; color: #c4b5fd; }
            .katex-display { margin: 0.5em 0; }
        `;
        this.shadow.appendChild(style);

        // Header with model selector
        const header = document.createElement("div");
        this.header = header;
        header.style.cssText = `
            padding: 8px 10px;
            background: #232323;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            cursor: move; display: flex; justify-content: space-between; align-items: center;
            border-radius: 12px 12px 0 0; user-select: none; gap: 4px;
            position: relative;
            border-top: 2px solid rgba(255, 107, 74, 0.6);
        `;

        const titleSection = document.createElement("div");
        titleSection.style.cssText = "display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;";

        const brandIcon = document.createElement("img");
        brandIcon.src = chrome.runtime.getURL("assets/icons/icon-32.png");
        brandIcon.alt = "Snip & Ask";
        brandIcon.style.cssText = `
            width: 18px;
            height: 18px;
            flex: 0 0 auto;
            display: block;
            object-fit: contain;
        `;
        titleSection.appendChild(brandIcon);

        // Model selector dropdown
        this.modelSelect = document.createElement("select");
        this.modelSelect.className = "chat-header-select";
        this.modelSelect.style.cssText = `
            flex: 1;
            min-width: 0;
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
            min-width: 144px;
        `;

        // Load all modes from storage (includes built-in and user-created modes)
        // This matches how popup.js handles modes - storage is the source of truth
        if (this.customModes && this.customModes.length > 0) {
            this.customModes.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m.id;
                // Add 📝 prefix only for user-created modes (isDefault !== true)
                opt.textContent = m.isDefault ? m.name : `📝 ${m.name}`;
                if (m.id === this.currentMode) opt.selected = true;
                this.modeSelect.appendChild(opt);
            });
        } else {
            // Fallback if no modes in storage (shouldn't normally happen)
            const defaultModes = [
                { id: 'short', name: '⚡ Short Answer' },
                { id: 'detailed', name: '🧠 Detailed' },
                { id: 'code', name: '💻 Code Debug' }
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
            customOpt.textContent = '✍️ Custom Prompt';
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

        // Snip Again button
        const snipAgainBtn = document.createElement("button");
        this.snipAgainBtn = snipAgainBtn;
        snipAgainBtn.className = "chat-header-action";
        snipAgainBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`;
        snipAgainBtn.title = "Snip and add to this chat";
        snipAgainBtn.onclick = () => this.startSnipAgain();
        header.appendChild(snipAgainBtn);

        // Compare button
        const compareBtn = document.createElement("button");
        this.compareBtn = compareBtn;
        compareBtn.className = "chat-header-action";
        compareBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
        compareBtn.title = "Compare with another model";
        compareBtn.onclick = () => this.spawnCompareWindow();
        header.appendChild(compareBtn);

        const displayModeBtn = document.createElement("button");
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
        header.appendChild(displayModeBtn);

        // Minimize button
        const minimizeBtn = document.createElement("button");
        this.minimizeBtn = minimizeBtn;
        minimizeBtn.className = "chat-header-action";
        minimizeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
        minimizeBtn.title = "Minimize to bubble";
        minimizeBtn.onclick = () => this.minimize();
        header.appendChild(minimizeBtn);

        const closeBtn = document.createElement("span");
        this.closeBtn = closeBtn;
        closeBtn.id = "closeBtn";
        closeBtn.className = "chat-header-action";
        closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        header.appendChild(closeBtn);

        this.container.appendChild(header);

        // Chat Body
        this.chatBody = document.createElement("div");
        this.chatBody.style.cssText = `
            flex-grow: 1; overflow-y: auto; overflow-x: hidden; padding: 16px; 
            display: flex; flex-direction: column; gap: 16px;
            background: linear-gradient(180deg, #0a0a0a 0%, #121212 100%); 
            scrollbar-width: thin; scrollbar-color: #404040 transparent;
            scroll-behavior: smooth;
            min-height: 0;
        `;
        this.container.appendChild(this.chatBody);

        // Input Area
        const inputArea = document.createElement("div");
        this.inputArea = inputArea;
        inputArea.style.cssText = `
            padding: 12px 14px; border-top: 1px solid rgba(255,255,255,0.08); 
            background: linear-gradient(135deg, #1f1f1f 0%, #171717 100%);
            display: flex; gap: 10px; border-radius: 0 0 12px 12px; align-items: flex-end;
            flex-shrink: 0;
        `;

        this.input = document.createElement("textarea");
        this.input.placeholder = "Ask a follow-up...";
        this.input.rows = 1;
        this.input.style.cssText = `
            flex-grow: 1; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); color: #e8e8e8;
            padding: 10px 12px; border-radius: 8px; resize: none; font-family: inherit; font-size: 13px;
            min-height: 38px; max-height: 120px; line-height: 1.5; transition: all 0.2s;
        `;

        this.input.addEventListener('input', () => {
            this.input.style.height = 'auto';
            this.input.style.height = Math.min(this.input.scrollHeight, 120) + 'px';
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
        this.sendBtn.innerText = "➤";
        this.sendBtn.style.cssText = `
            background: linear-gradient(135deg, #ff6b4a 0%, #ff5533 100%); color: white; border: none; 
            padding: 0 18px; height: 38px; border-radius: 8px; cursor: pointer; font-weight: 600;
            box-shadow: 0 2px 8px rgba(255,107,74,0.3); transition: all 0.2s;
        `;

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

        inputArea.appendChild(this.input);
        inputArea.appendChild(this.sendBtn);
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
            this.header.style.padding = '10px 12px';
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
            this.container.style.borderRadius = '12px';
            this.container.style.borderTop = '1px solid rgba(255, 107, 74, 0.4)';
            this.container.style.borderRight = '1px solid rgba(255, 107, 74, 0.4)';
            this.container.style.resize = 'both';
            this.container.style.boxShadow = '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05)';
            this.header.style.cursor = 'move';
            this.header.style.borderRadius = '12px 12px 0 0';
            this.header.style.padding = '10px 12px';
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
     */
    addMessage(role, content, modelName = null, isError = false, base64Image = null, isRegenerated = false, tokenUsage = null) {
        const msgModel = role === 'assistant' ? (modelName || this.currentModel) : null;
        const historyEntry = createChatHistoryEntry(role, content, msgModel, base64Image, isRegenerated);

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
            modelLabel: role === 'assistant' ? this._getModelDisplayName(msgModel) : null,
            tokenUsage
        });

        this.chatBody.scrollTop = this.chatBody.scrollHeight;
        this.onSessionChanged?.();
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

    /**
     * Regenerate the last assistant response (convenience wrapper)
     */
    async regenerateLastResponse() {
        // Find last assistant message index and regenerate from there
        for (let i = this.chatHistory.length - 1; i >= 0; i--) {
            if (this.chatHistory[i].role === 'assistant') {
                await this.regenerateAtIndex(i);
                return;
            }
        }
    }

    /**
     * Regenerate response at a specific index - "rewinds" conversation to that point
     * @param {number} index - The index of the assistant message to regenerate
     */
    async regenerateAtIndex(index) {
        if (index < 0 || index >= this.chatHistory.length) return;
        if (this.chatHistory[index].role !== 'assistant') return;

        // Find the user message that triggered this response
        let userMsgIndex = -1;
        for (let i = index - 1; i >= 0; i--) {
            if (this.chatHistory[i].role === 'user') {
                userMsgIndex = i;
                break;
            }
        }
        if (userMsgIndex === -1) return;

        // Slice history to remove everything from the target index onward ("rewind")
        const messagesToRemove = this.chatHistory.length - index;
        this.chatHistory = this.chatHistory.slice(0, index);

        // Remove corresponding DOM elements from chatBody
        for (let i = 0; i < messagesToRemove; i++) {
            const lastChild = this.chatBody.lastElementChild;
            if (lastChild && !lastChild.classList?.contains('typing-container')) {
                lastChild.remove();
            }
        }

        const requestId = this.showTypingIndicator();

        try {
            let response;

            // Collect all images from history up to (and including) the user message
            const imagesToSend = [];
            for (let i = 0; i <= userMsgIndex; i++) {
                if (this.chatHistory[i].base64Image) {
                    imagesToSend.push(this.chatHistory[i].base64Image);
                }
            }
            // Also include initialBase64Image if not already in history
            if (this.initialBase64Image && !imagesToSend.includes(this.initialBase64Image)) {
                imagesToSend.unshift(this.initialBase64Image);
            }

            // Check if we need to include image data for vision models
            const isAutoGuestModel = this.currentModel === 'groq:auto';

            if (!isAutoGuestModel && isVisionModel(this.currentModel)) {
                if (imagesToSend.length > 0) {
                    // Use multi-image if multiple, single image otherwise
                    if (imagesToSend.length === 1) {
                        response = await chrome.runtime.sendMessage({
                            action: "ASK_AI",
                            model: this.currentModel,
                            base64Image: imagesToSend[0],
                            mode: this.currentMode,
                            requestId
                        });
                    } else {
                        response = await chrome.runtime.sendMessage({
                            action: "ASK_AI_MULTI_IMAGE",
                            model: this.currentModel,
                            images: imagesToSend,
                            textContext: this._extractTextFromHistory(userMsgIndex),
                            mode: this.currentMode,
                            requestId
                        });
                    }
                } else {
                    // No images, use text chat
                    response = await chrome.runtime.sendMessage({
                        action: "CONTINUE_CHAT",
                        model: this.currentModel,
                        history: this._buildApiHistory(userMsgIndex),
                        mode: this.currentMode,
                        requestId
                    });
                }
            } else {
                // Non-vision model - need to use OCR text if there are images
                if (imagesToSend.length > 0) {
                    // OCR all images and build context
                    let ocrTextParts = [];
                    for (const img of imagesToSend) {
                        const ocrResult = await chrome.runtime.sendMessage({
                            action: "PERFORM_OCR",
                            base64Image: img
                        });
                        if (ocrResult?.success && ocrResult.text) {
                            ocrTextParts.push(ocrResult.text);
                        }
                    }

                    if (ocrTextParts.length > 0) {
                        // Build history with OCR text as the first user message
                        const ocrContext = ocrTextParts.join('\n---\n');
                        const historyWithOcr = [
                            { role: 'user', content: `[Image content extracted via OCR]:\n${ocrContext}` },
                            ...this._buildApiHistory(userMsgIndex).slice(1) // Skip original first message, use OCR instead
                        ];

                        response = await chrome.runtime.sendMessage({
                            action: "CONTINUE_CHAT",
                            model: this.currentModel,
                            history: historyWithOcr,
                            mode: this.currentMode,
                            requestId
                        });
                    } else if (isAutoGuestModel) {
                        response = imagesToSend.length === 1
                            ? await chrome.runtime.sendMessage({
                                action: "ASK_AI",
                                model: this.currentModel,
                                base64Image: imagesToSend[0],
                                mode: this.currentMode,
                                requestId
                            })
                            : await chrome.runtime.sendMessage({
                                action: "ASK_AI_MULTI_IMAGE",
                                model: this.currentModel,
                                images: imagesToSend,
                                textContext: this._extractTextFromHistory(userMsgIndex),
                                mode: this.currentMode,
                                requestId
                            });
                    } else {
                        // OCR failed, use text history as fallback
                        response = await chrome.runtime.sendMessage({
                            action: "CONTINUE_CHAT",
                            model: this.currentModel,
                            history: this._buildApiHistory(userMsgIndex),
                            mode: this.currentMode,
                            requestId
                        });
                    }
                } else {
                    // No images, use text history
                    response = await chrome.runtime.sendMessage({
                        action: "CONTINUE_CHAT",
                        model: this.currentModel,
                        history: this._buildApiHistory(userMsgIndex),
                        mode: this.currentMode,
                        requestId
                    });
                }
            }

            this.removeTypingIndicator();

            if (this._requestCancelled) return; // User clicked Stop

            if (response && response.success) {
                // Add regenerated indicator to the response
                this._addRegeneratedMessage(response.answer, response.responseModel || response.model || this.currentModel);
                if (response.guestInfo) {
                    updateLocalGuestCache(response.guestInfo);
                }
            } else {
                this.addMessage('assistant', "⚠️ Regenerate failed: " + (response?.error || "Unknown error"), this.currentModel, true);
            }
        } catch (e) {
            this.removeTypingIndicator();
            if (this._requestCancelled) return;
            this.addMessage('assistant', "⚠️ Network Error: " + e.message, this.currentModel, true);
        }
    }

    /**
     * Add a regenerated message with indicator badge
     * @param {string} content - Message content
     * @param {string} modelName - Model name
     */
    _addRegeneratedMessage(content, modelName) {
        // Use addMessage but mark it as regenerated
        this.addMessage('assistant', content, modelName, false, null, true);
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

    /**
     * Show full-size image in a modal overlay
     * @param {string} imgSrc - Image source URL or data URI
     */
    _showImageModal(imgSrc) {
        if (!imgSrc) return;

        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2147483647;
            cursor: zoom-out;
            animation: fadeIn 0.2s ease;
        `;

        // Add animation keyframes
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes scaleIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        `;
        overlay.appendChild(style);

        // Create image container
        const imgContainer = document.createElement('div');
        imgContainer.style.cssText = `
            position: relative;
            max-width: 90vw;
            max-height: 90vh;
            animation: scaleIn 0.2s ease;
        `;

        // Full-size image
        const fullImg = document.createElement('img');
        fullImg.src = imgSrc;
        fullImg.style.cssText = `
            max-width: 90vw;
            max-height: 85vh;
            object-fit: contain;
            border-radius: 8px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        `;
        fullImg.alt = "Full size screenshot";

        // Close button
        const closeBtn = document.createElement('div');
        closeBtn.style.cssText = `
            position: absolute;
            top: -15px;
            right: -15px;
            width: 32px;
            height: 32px;
            background: #ff6b4a;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 18px;
            color: white;
            box-shadow: 0 4px 12px rgba(255, 107, 74, 0.4);
            transition: transform 0.2s;
        `;
        closeBtn.innerHTML = '×';
        closeBtn.onmouseenter = () => closeBtn.style.transform = 'scale(1.1)';
        closeBtn.onmouseleave = () => closeBtn.style.transform = 'scale(1)';

        // Hint text
        const hint = document.createElement('div');
        hint.style.cssText = `
            position: absolute;
            bottom: -30px;
            left: 50%;
            transform: translateX(-50%);
            color: #888;
            font-size: 12px;
            white-space: nowrap;
        `;
        hint.textContent = 'Click anywhere or press ESC to close';

        imgContainer.appendChild(fullImg);
        imgContainer.appendChild(closeBtn);
        imgContainer.appendChild(hint);
        overlay.appendChild(imgContainer);

        // Close handlers
        const closeModal = () => {
            overlay.style.animation = 'fadeIn 0.15s ease reverse';
            setTimeout(() => overlay.remove(), 150);
        };

        overlay.onclick = closeModal;
        closeBtn.onclick = (e) => { e.stopPropagation(); closeModal(); };
        imgContainer.onclick = (e) => e.stopPropagation(); // Prevent close when clicking image

        // ESC key handler
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // Add to shadow DOM
        this.shadow.appendChild(overlay);
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

        if (isVisionModel(this.currentModel)) {
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
                    this.addMessage('assistant', response.answer, this.currentModel, false, null, false, response.tokenUsage);
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
                    chrome.runtime.sendMessage({
                        action: "ASK_AI_TEXT",
                        model: this.currentModel,
                        text: ocrResult.text,
                        mode: this.currentMode,
                        requestId
                    }, (response) => {
                        this.removeTypingIndicator();
                        if (this._requestCancelled) return; // User clicked Stop
                        if (response && response.success) {
                            this.addMessage('assistant', response.answer, this.currentModel, false, null, false, response.tokenUsage);
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
     * Spawn a comparison window with a different model
     * Duplicates the entire chat history and regenerates the last response
     */
    async spawnCompareWindow() {
        if (WindowManager.isMaxReached()) {
            showErrorToast(`Maximum ${WindowManager.maxWindows} comparison windows allowed`);
            return;
        }

        // Find the last assistant message index in current chat
        let lastAssistantIndex = -1;
        for (let i = this.chatHistory.length - 1; i >= 0; i--) {
            if (this.chatHistory[i].role === 'assistant') {
                lastAssistantIndex = i;
                break;
            }
        }

        if (lastAssistantIndex === -1) {
            showErrorToast("No response to compare yet");
            return;
        }

        const newUI = await FloatingChatUI.create();
        newUI.setDisplayMode('popup');
        WindowManager.register(newUI);

        // Copy all state to compare window
        newUI.initialUserMessage = this.initialUserMessage;
        newUI.initialBase64Image = this.initialBase64Image;
        newUI.allImages = [...this.allImages];

        // Inherit mode from parent window
        newUI.currentMode = this.currentMode;
        if (newUI.modeSelect) newUI.modeSelect.value = this.currentMode;

        // Select a different model
        const otherModel = this._getNextAvailableModel();
        if (otherModel && newUI.modelSelect) {
            newUI.currentModel = otherModel;
            newUI.modelSelect.value = otherModel;
        }

        // Clone all messages UP TO (but not including) the last assistant message
        // This preserves the full conversation context
        for (let i = 0; i < lastAssistantIndex; i++) {
            const msg = this.chatHistory[i];
            // Recreate each message in the new window (without adding to DOM twice)
            newUI.chatHistory.push({
                role: msg.role,
                content: msg.content,
                displayText: msg.displayText,
                model: msg.model,
                base64Image: msg.base64Image,
                isRegenerated: msg.isRegenerated,
                timestamp: msg.timestamp
            });

            // Render the message in the UI
            this._renderClonedMessage(newUI, msg);
        }

        // Now regenerate the last response with the new model
        const requestId = newUI.showTypingIndicator();

        try {
            let response;

            // Collect all images from history
            const imagesToSend = [];
            if (newUI.initialBase64Image) {
                imagesToSend.push(newUI.initialBase64Image);
            }
            for (let i = 0; i < newUI.chatHistory.length; i++) {
                if (newUI.chatHistory[i].base64Image && !imagesToSend.includes(newUI.chatHistory[i].base64Image)) {
                    imagesToSend.push(newUI.chatHistory[i].base64Image);
                }
            }

            // Build full conversation history as text
            const apiHistory = newUI._buildApiHistory(newUI.chatHistory.length - 1);
            const fullTextContext = apiHistory.map(m => `${m.role}: ${m.content}`).join('\n');

            const isAutoGuestModel = newUI.currentModel === 'groq:auto';

            if (!isAutoGuestModel && isVisionModel(newUI.currentModel) && imagesToSend.length > 0) {
                // Vision model with images: Always use MULTI_IMAGE which supports textContext
                // ASK_AI does NOT support additionalContext, so we must use MULTI_IMAGE even for 1 image
                response = await chrome.runtime.sendMessage({
                    action: "ASK_AI_MULTI_IMAGE",
                    model: newUI.currentModel,
                    images: imagesToSend,
                    textContext: fullTextContext,
                    mode: newUI.currentMode,
                    requestId
                });
            } else if (!isVisionModel(newUI.currentModel) && imagesToSend.length > 0) {
                // Non-vision model with images: Extract text via OCR first
                let ocrTextParts = [];
                for (const img of imagesToSend) {
                    const ocrResult = await chrome.runtime.sendMessage({
                        action: "PERFORM_OCR",
                        base64Image: img
                    });
                    if (ocrResult?.success && ocrResult.text) {
                        ocrTextParts.push(ocrResult.text);
                    }
                }

                if (ocrTextParts.length > 0) {
                    // Inject OCR context at the start of history
                    const ocrContext = ocrTextParts.join('\n---\n');
                    const historyWithOcr = [
                        { role: 'user', content: `[Image content extracted via OCR]:\n${ocrContext}` },
                        ...apiHistory.slice(1) // Skip first message which references the image
                    ];

                    response = await chrome.runtime.sendMessage({
                        action: "CONTINUE_CHAT",
                        model: newUI.currentModel,
                        history: historyWithOcr,
                        mode: newUI.currentMode,
                        requestId
                    });
                } else if (isAutoGuestModel) {
                    response = await chrome.runtime.sendMessage({
                        action: "ASK_AI_MULTI_IMAGE",
                        model: newUI.currentModel,
                        images: imagesToSend,
                        textContext: fullTextContext,
                        mode: newUI.currentMode,
                        requestId
                    });
                } else {
                    // OCR failed, just use text history
                    response = await chrome.runtime.sendMessage({
                        action: "CONTINUE_CHAT",
                        model: newUI.currentModel,
                        history: apiHistory,
                        mode: newUI.currentMode,
                        requestId
                    });
                }
            } else {
                // No images: Use text-only chat
                response = await chrome.runtime.sendMessage({
                    action: "CONTINUE_CHAT",
                    model: newUI.currentModel,
                    history: apiHistory,
                    mode: newUI.currentMode,
                    requestId
                });
            }

            newUI.removeTypingIndicator();
            if (newUI._requestCancelled) return; // User clicked Stop
            if (response && response.success) {
                newUI.addMessage('assistant', response.answer, newUI.currentModel, false, null, false, response.tokenUsage);
                if (response.guestInfo) {
                    updateLocalGuestCache(response.guestInfo);
                }
            } else {
                newUI.addMessage('assistant', "⚠️ Error: " + (response?.error || "Unknown error"), newUI.currentModel, true);
            }
        } catch (e) {
            newUI.removeTypingIndicator();
            if (newUI._requestCancelled) return;
            newUI.addMessage('assistant', "⚠️ Network Error: " + e.message, newUI.currentModel, true);
        }
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
        const usedModels = WindowManager.windows.map(w => w.currentModel);
        for (const m of this.availableModels) {
            if (!usedModels.includes(m.value)) return m.value;
        }
        return this.availableModels.find(m => m.value !== this.currentModel)?.value || null;
    }

    /**
     * Enable/disable input controls
     * @param {boolean} disabled
     */
    setInputDisabled(disabled) {
        if (this.input) {
            this.input.disabled = disabled;
            this.input.style.opacity = disabled ? '0.5' : '1';
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

        const requestId = this.showTypingIndicator();

        const modelToUse = this.currentModel;
        const modeToUse = mode || this.currentMode || 'short';

        // Use displayText for API calls (compatible format) while preserving model attribution
        const formattedHistory = formatChatHistoryForApi(this.chatHistory, this._getModelDisplayName.bind(this));

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
                this.addMessage('assistant', response.answer, modelToUse, false, null, false, response.tokenUsage);
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


