// src/content/floating-chat-ui.js
// FloatingChatUI class - the main chat window component

/**
 * FloatingChatUI - Floating chat window for AI interactions
 */
class FloatingChatUI {
    constructor() {
        this.chatHistory = [];
        this.currentModel = null;
        this.currentMode = null; // Track selected mode (short/detailed/code/default/custom)
        this.availableModels = [];
        this.customModes = [];  // User-created custom modes
        this.customPrompt = ''; // Custom prompt text for 'custom' mode
        this.isMinimized = false;
        this.hasSavedPosition = false;
        this.initialUserMessage = null;
        this.initialBase64Image = null;
        this.allImages = [];  // Store all snipped images for compare window
    }

    /**
     * Static factory method for async initialization
     * @returns {Promise<FloatingChatUI>}
     */
    static async create() {
        const ui = new FloatingChatUI();
        await ui.initModel();
        ui.createWindow();
        ui.loadState();
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
                { value: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout' }
            ];
        }

        // Get the current selected model, mode, and custom modes from storage
        const storage = await new Promise(resolve => {
            chrome.storage.local.get(['selectedModel', 'selectedMode', 'customModes', 'customPrompt'], resolve);
        });
        this.currentModel = storage.selectedModel || 'meta-llama/llama-4-scout-17b-16e-instruct';
        this.currentMode = storage.selectedMode || 'short';
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
        this.container.style.resize = 'none';

        // Create bubble element
        this.bubble = document.createElement("div");
        this.bubble.style.cssText = `
            padding: 10px 16px;
            background: #2d2d2d;
            border-radius: 10px;
            cursor: move;
            display: flex;
            align-items: center;
            gap: 8px;
            white-space: nowrap;
            user-select: none;
        `;
        this.bubble.innerHTML = `
            <span style="color: #f55036; font-weight: bold;">⚡</span>
            <span style="color: #ccc; font-size: 12px;">${this._getModelDisplayName(this.currentModel)}</span>
            <span style="color: #f55036; font-size: 14px; font-weight: bold; margin-left: 6px; padding: 2px 6px; background: #3a3a3a; border-radius: 4px; border: 1px solid #f55036;" title="Click to expand">⬆</span>
        `;
        this.bubble.title = "Drag to move, click ⬆ to expand";

        // Make bubble draggable
        this.makeBubbleDraggable(this.bubble);

        // Click on arrow to expand
        const expandArrow = this.bubble.querySelector('span:last-child');
        expandArrow.style.cursor = 'pointer';
        expandArrow.onclick = (e) => {
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
            if (e.target.textContent === '⬆') return;
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
            
            /* TYPING INDICATOR */
            .typing-container { display: flex; align-items: center; gap: 10px; opacity: 0.8; margin-bottom: 10px; }
            .typing-bubble { background: #2a2a2a; padding: 8px 14px; border-radius: 12px 12px 12px 2px; display: flex; gap: 4px; width: fit-content; }
            .dot { width: 6px; height: 6px; background: #666; border-radius: 50%; animation: bounce 1.4s infinite ease-in-out both; }
            .dot:nth-child(1) { animation-delay: -0.32s; }
            .dot:nth-child(2) { animation-delay: -0.16s; }
            @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); background: #f55036; } }
            .thinking-text { font-size: 11px; color: #666; font-style: italic; animation: pulse 1.5s infinite; }
            @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
            
            /* MATH BLOCKS (LaTeX) */
            .math-block { background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 6px; padding: 12px 16px; margin: 10px 0; overflow-x: auto; text-align: center; }
            .math-inline { background: rgba(139, 92, 246, 0.15); padding: 2px 6px; border-radius: 4px; color: #c4b5fd; }
            .katex { font-size: 1.1em; color: #c4b5fd; }
            .katex-display { margin: 0.5em 0; }
        `;
        this.shadow.appendChild(style);

        // Header with model selector
        const header = document.createElement("div");
        header.style.cssText = `
            padding: 12px 14px; 
            background: linear-gradient(135deg, #2a2a2a 0%, #1f1f1f 100%); 
            border-bottom: 1px solid rgba(255,255,255,0.08);
            cursor: move; display: flex; justify-content: space-between; align-items: center;
            border-radius: 12px 12px 0 0; user-select: none; gap: 10px;
            position: relative;
            border-top: 2px solid rgba(255, 107, 74, 0.6);
        `;

        const titleSection = document.createElement("div");
        titleSection.style.cssText = "display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;";
        titleSection.innerHTML = `<strong style="color: #ff6b4a; white-space: nowrap; font-size: 16px;">⚡</strong>`;

        // Model selector dropdown
        this.modelSelect = document.createElement("select");
        this.modelSelect.style.cssText = `
            background: #0a0a0a; color: #e8e8e8; border: 1px solid rgba(255, 255, 255, 0.15); 
            border-radius: 6px; padding: 6px 10px; font-size: 12px;
            cursor: pointer; flex: 1; min-width: 0; max-width: 200px;
            transition: all 0.2s; font-weight: 500;
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
        });

        titleSection.appendChild(this.modelSelect);

        // Mode selector dropdown
        this.modeSelect = document.createElement("select");
        this.modeSelect.style.cssText = `
            background: #0a0a0a; color: #e8e8e8; border: 1px solid rgba(255, 255, 255, 0.15); 
            border-radius: 6px; padding: 6px 10px; font-size: 12px;
            cursor: pointer; min-width: 90px;
            transition: all 0.2s; font-weight: 500;
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
        });

        titleSection.appendChild(this.modeSelect);
        header.appendChild(titleSection);

        // Snip Again button
        const snipAgainBtn = document.createElement("button");
        snipAgainBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`;
        snipAgainBtn.title = "Snip and add to this chat";
        snipAgainBtn.style.cssText = `
            background: rgba(255,255,255,0.05); color: #888; border: 1px solid rgba(255,255,255,0.1);
            width: 28px; height: 28px; border-radius: 6px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: all 0.2s;
        `;
        snipAgainBtn.onclick = () => this.startSnipAgain();
        header.appendChild(snipAgainBtn);

        // Compare button
        const compareBtn = document.createElement("button");
        compareBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
        compareBtn.title = "Compare with another model";
        compareBtn.style.cssText = `
            background: rgba(255,255,255,0.05); color: #888; border: 1px solid rgba(255,255,255,0.1);
            width: 28px; height: 28px; border-radius: 6px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: all 0.2s;
        `;
        compareBtn.onclick = () => this.spawnCompareWindow();
        header.appendChild(compareBtn);

        // Minimize button
        const minimizeBtn = document.createElement("button");
        minimizeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
        minimizeBtn.title = "Minimize to bubble";
        minimizeBtn.style.cssText = `
            background: rgba(255,255,255,0.05); color: #888; border: 1px solid rgba(255,255,255,0.1);
            width: 28px; height: 28px; border-radius: 6px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: all 0.2s;
        `;
        minimizeBtn.onclick = () => this.minimize();
        header.appendChild(minimizeBtn);

        const closeBtn = document.createElement("span");
        closeBtn.id = "closeBtn";
        closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        closeBtn.style.cssText = `
            cursor: pointer; color: #888;
            width: 28px; height: 28px; border-radius: 6px;
            display: flex; align-items: center; justify-content: center;
            background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
            transition: all 0.2s;
        `;
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
        `;
        this.container.appendChild(this.chatBody);

        // Input Area
        const inputArea = document.createElement("div");
        inputArea.style.cssText = `
            padding: 12px 14px; border-top: 1px solid rgba(255,255,255,0.08); 
            background: linear-gradient(135deg, #1f1f1f 0%, #171717 100%);
            display: flex; gap: 10px; border-radius: 0 0 12px 12px; align-items: flex-end;
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

        this.sendBtn = document.createElement("button");
        this.sendBtn.innerText = "➤";
        this.sendBtn.style.cssText = `
            background: linear-gradient(135deg, #ff6b4a 0%, #ff5533 100%); color: white; border: none; 
            padding: 0 18px; height: 38px; border-radius: 8px; cursor: pointer; font-weight: 600;
            box-shadow: 0 2px 8px rgba(255,107,74,0.3); transition: all 0.2s;
        `;

        this.sendBtn.onclick = () => this.handleSend();
        this.input.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        };

        inputArea.appendChild(this.input);
        inputArea.appendChild(this.sendBtn);
        this.container.appendChild(inputArea);

        this.shadow.appendChild(this.container);
        document.body.appendChild(this.host);

        // --- Event Listeners ---
        closeBtn.onclick = () => this.close();

        this.makeDraggable(header);

        this.container.addEventListener('mouseup', () => this.saveState());

        // Escape key closes the focused chat window
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            }
        });
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
        // Track model name for assistant messages
        const msgModel = role === 'assistant' ? (modelName || this.currentModel) : null;

        // Store FULL raw content in chatHistory to preserve image data for regeneration
        // Also extract text for display purposes
        let rawContent = content; // Keep original for history
        let displayText = content;

        if (typeof content !== 'string') {
            if (Array.isArray(content)) {
                const textPart = content.find(c => c.type === 'text');
                displayText = textPart ? textPart.text : '(image analyzed)';
            } else if (content && content.content) {
                if (Array.isArray(content.content)) {
                    const textPart = content.content.find(c => c.type === 'text');
                    displayText = textPart ? textPart.text : '(image analyzed)';
                } else if (typeof content.content === 'string') {
                    displayText = content.content;
                } else {
                    displayText = '(complex content)';
                }
            } else {
                displayText = '(complex content)';
            }
        }

        // Store full message object with raw content AND optional image data
        const historyEntry = {
            role: role,
            content: rawContent, // Keep full raw content
            displayText: typeof displayText === 'string' ? displayText : String(displayText),
            model: msgModel,
            base64Image: base64Image || null, // Store image data if provided
            isRegenerated: isRegenerated || false,
            timestamp: Date.now()
        };

        this.chatHistory.push(historyEntry);
        const messageIndex = this.chatHistory.length - 1;

        const msgDiv = document.createElement("div");
        msgDiv.style.cssText = `max-width: 85%; padding: 12px 14px; border-radius: 10px; line-height: 1.5; word-wrap: break-word; font-size: 13px; position: relative; transition: all 0.2s ease;`;

        if (role === 'user') {
            msgDiv.style.alignSelf = "flex-end";
            msgDiv.style.background = "linear-gradient(135deg, #3a3a3a 0%, #2d2d2d 100%)";
            msgDiv.style.color = "#e8e8e8";
            msgDiv.style.borderRadius = "10px 10px 2px 10px";
            msgDiv.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";

            // Check if this message has an image (from base64Image or content array)
            const hasImage = base64Image || (Array.isArray(content) && content.some(c => c.type === 'image_url'));

            if (hasImage) {
                // Create image thumbnail preview
                const imgContainer = document.createElement('div');
                imgContainer.style.cssText = `
                    margin-bottom: 8px; 
                    border-radius: 6px; 
                    overflow: hidden; 
                    border: 1px solid rgba(255,255,255,0.1);
                    background: #1a1a1a;
                    position: relative;
                `;

                const thumbnail = document.createElement('img');
                // Get image source from base64Image or content array
                let imgSrc = base64Image ? `data:image/png;base64,${base64Image}` : null;
                if (!imgSrc && Array.isArray(content)) {
                    const imgPart = content.find(c => c.type === 'image_url');
                    if (imgPart?.image_url?.url) {
                        imgSrc = imgPart.image_url.url;
                    }
                }

                thumbnail.src = imgSrc;
                thumbnail.style.cssText = `
                    width: 100%; 
                    max-height: 120px; 
                    object-fit: cover; 
                    cursor: pointer;
                    display: block;
                    transition: transform 0.2s;
                `;
                thumbnail.title = "Click to view full size";
                thumbnail.alt = "Screenshot thumbnail";

                // Hover effect
                thumbnail.onmouseenter = () => thumbnail.style.opacity = '0.85';
                thumbnail.onmouseleave = () => thumbnail.style.opacity = '1';

                // Click to view full size
                thumbnail.onclick = () => this._showImageModal(imgSrc);

                // Image icon overlay
                const iconOverlay = document.createElement('div');
                iconOverlay.style.cssText = `
                    position: absolute;
                    bottom: 4px;
                    right: 4px;
                    background: rgba(0,0,0,0.6);
                    border-radius: 4px;
                    padding: 2px 6px;
                    font-size: 10px;
                    color: #ccc;
                    pointer-events: none;
                `;
                iconOverlay.textContent = '📷 Click to expand';

                imgContainer.appendChild(thumbnail);
                imgContainer.appendChild(iconOverlay);
                msgDiv.appendChild(imgContainer);

                // Add text label
                const textLabel = document.createElement('em');
                textLabel.style.cssText = "opacity: 0.7; font-size: 11px; display: block;";
                if (Array.isArray(content)) {
                    const textPart = content.find(c => c.type === 'text');
                    textLabel.textContent = textPart?.text || '(Screenshot)';
                } else {
                    textLabel.textContent = '(Screenshot)';
                }
                msgDiv.appendChild(textLabel);
            } else if (typeof content === 'object' && content.content) {
                const textPart = Array.isArray(content.content) ? content.content.find(c => c.type === 'text') : { text: content.content };
                const em = document.createElement('em');
                em.textContent = '(Snippet)';
                em.style.opacity = "0.8";
                em.style.fontSize = "0.9em";
                msgDiv.appendChild(em);
                msgDiv.appendChild(document.createElement('br'));
                const textSpan = document.createElement('span');
                textSpan.textContent = textPart ? textPart.text : '';
                msgDiv.appendChild(textSpan);
            } else {
                msgDiv.innerText = typeof displayText === 'string' ? displayText : String(content);
            }
        } else {
            msgDiv.style.alignSelf = "flex-start";
            msgDiv.style.background = "rgba(255,255,255,0.05)";
            msgDiv.style.color = "#e8e8e8";
            msgDiv.style.border = "1px solid rgba(255,255,255,0.08)";
            msgDiv.style.borderRadius = "10px 10px 10px 2px";

            // Add model label for assistant messages (with regenerated indicator if applicable)
            const modelLabel = this._getModelDisplayName(msgModel);
            const labelDiv = document.createElement("div");
            labelDiv.style.cssText = "font-size: 10px; color: #ff6b4a; margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 4px; background: rgba(255,107,74,0.1); padding: 3px 8px; border-radius: 4px;";

            // Format token count for display
            const tokenInfo = tokenUsage?.totalTokens ? tokenUsage.totalTokens.toLocaleString() : null;

            if (isRegenerated) {
                labelDiv.innerHTML = `<span style="font-size: 11px;">🔄</span> ${modelLabel}${tokenInfo ? ` <span style="font-size: 9px; color: #888; margin-left: 6px;">• ${tokenInfo} tokens</span>` : ''} <span style="font-size: 9px; color: #888; margin-left: 4px; font-weight: 500;">Regenerated</span>`;
            } else {
                labelDiv.innerHTML = `<span style="font-size: 11px;">✨</span> ${modelLabel}${tokenInfo ? ` <span style="font-size: 9px; color: #888; margin-left: 6px;">• ${tokenInfo} tokens</span>` : ''}`;
            }
            msgDiv.appendChild(labelDiv);

            const contentDiv = document.createElement("div");
            contentDiv.style.cssText = "max-height: 350px; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: #404040 transparent;";
            const cleanText = sanitizeModelText(content);
            if (typeof parseMarkdown === 'function') {
                contentDiv.innerHTML = parseMarkdown(cleanText);
            } else {
                contentDiv.innerText = cleanText;
            }
            msgDiv.appendChild(contentDiv);



            // Action buttons container
            const actionsDiv = document.createElement("div");
            actionsDiv.style.cssText = "display: flex; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);";

            // Helper to style buttons
            const createActionButton = (text, icon, title, isPrimary = false) => {
                const btn = document.createElement("button");
                btn.innerHTML = `${icon} ${text}`;
                btn.title = title;
                btn.style.cssText = `
                    background: ${isPrimary ? 'rgba(255, 107, 74, 0.15)' : 'rgba(255,255,255,0.05)'}; 
                    color: ${isPrimary ? '#ff6b4a' : '#888'}; 
                    border: 1px solid ${isPrimary ? 'rgba(255, 107, 74, 0.3)' : 'rgba(255,255,255,0.1)'}; 
                    padding: 4px 10px; 
                    border-radius: 6px; 
                    font-size: 11px; 
                    cursor: pointer; 
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    font-weight: 500;
                `;
                btn.onmouseenter = () => {
                    btn.style.background = isPrimary ? 'rgba(245, 80, 54, 0.25)' : 'rgba(255,255,255,0.1)';
                    btn.style.color = isPrimary ? '#ff6b52' : '#e5e7eb';
                };
                btn.onmouseleave = () => {
                    btn.style.background = isPrimary ? 'rgba(245, 80, 54, 0.15)' : 'rgba(255,255,255,0.05)';
                    btn.style.color = isPrimary ? '#f55036' : '#9ca3af';
                };
                return btn;
            };

            // Copy entire response button
            const copyBtn = createActionButton("Copy", '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>', "Copy entire response");
            copyBtn.onclick = () => {
                const responseText = contentDiv.textContent;
                navigator.clipboard.writeText(responseText).then(() => {
                    const originalHTML = copyBtn.innerHTML;
                    copyBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied';
                    copyBtn.style.borderColor = "#4ade80";
                    copyBtn.style.color = "#4ade80";
                    setTimeout(() => {
                        copyBtn.innerHTML = originalHTML;
                        copyBtn.style.borderColor = "rgba(255,255,255,0.1)";
                        copyBtn.style.color = "#9ca3af";
                    }, 2000);
                });
            };
            actionsDiv.appendChild(copyBtn);

            // Regenerate button - pass the message index for targeted regeneration
            const regenBtn = createActionButton("Regenerate", '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>', "Regenerate from this point");
            regenBtn.onclick = () => this.regenerateAtIndex(messageIndex);
            actionsDiv.appendChild(regenBtn);

            // Minimize/Expand button
            const minimizeBtn = createActionButton("Minimize", '➖', "Minimize response");
            minimizeBtn.onclick = () => {
                const isMinimized = contentDiv.style.display === 'none';
                if (isMinimized) {
                    // Expand
                    contentDiv.style.display = 'block';
                    minimizeBtn.innerHTML = '➖ Minimize';
                    minimizeBtn.title = 'Minimize response';
                } else {
                    // Minimize
                    contentDiv.style.display = 'none';
                    minimizeBtn.innerHTML = '➕ Expand';
                    minimizeBtn.title = 'Expand response';
                }
            };
            actionsDiv.appendChild(minimizeBtn);

            // Retry button for error messages
            if (isError) {
                const retryBtn = createActionButton("Retry", '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"></path></svg>', "Retry failed request", true);
                retryBtn.onclick = () => this.retryLastRequest();
                actionsDiv.appendChild(retryBtn);
            }

            msgDiv.appendChild(actionsDiv);
        }
        this.chatBody.appendChild(msgDiv);
        this.chatBody.scrollTop = this.chatBody.scrollHeight;
    }

    /**
     * Show typing indicator in chat
     */
    showTypingIndicator() {
        this.removeTypingIndicator(); // Ensure only one exists

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
        `;

        this.chatBody.appendChild(container);
        this.chatBody.scrollTop = this.chatBody.scrollHeight;
    }

    /**
     * Remove typing indicator from chat
     */
    removeTypingIndicator() {
        const existing = this.chatBody.querySelector("#typing-indicator");
        if (existing) existing.remove();
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

        this.showTypingIndicator();

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
            if (isVisionModel(this.currentModel)) {
                if (imagesToSend.length > 0) {
                    // Use multi-image if multiple, single image otherwise
                    if (imagesToSend.length === 1) {
                        response = await chrome.runtime.sendMessage({
                            action: "ASK_AI",
                            model: this.currentModel,
                            base64Image: imagesToSend[0]
                        });
                    } else {
                        response = await chrome.runtime.sendMessage({
                            action: "ASK_AI_MULTI_IMAGE",
                            model: this.currentModel,
                            images: imagesToSend,
                            textContext: this._extractTextFromHistory(userMsgIndex)
                        });
                    }
                } else {
                    // No images, use text chat
                    response = await chrome.runtime.sendMessage({
                        action: "CONTINUE_CHAT",
                        model: this.currentModel,
                        history: this._buildApiHistory(userMsgIndex),
                        mode: this.currentMode
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
                            mode: this.currentMode
                        });
                    } else {
                        // OCR failed, use text history as fallback
                        response = await chrome.runtime.sendMessage({
                            action: "CONTINUE_CHAT",
                            model: this.currentModel,
                            history: this._buildApiHistory(userMsgIndex),
                            mode: this.currentMode
                        });
                    }
                } else {
                    // No images, use text history
                    response = await chrome.runtime.sendMessage({
                        action: "CONTINUE_CHAT",
                        model: this.currentModel,
                        history: this._buildApiHistory(userMsgIndex),
                        mode: this.currentMode
                    });
                }
            }

            this.removeTypingIndicator();

            if (response && response.success) {
                // Add regenerated indicator to the response
                this._addRegeneratedMessage(response.answer, this.currentModel);
                if (response.guestInfo) {
                    updateLocalGuestCache(response.guestInfo);
                }
            } else {
                this.addMessage('assistant', "⚠️ Regenerate failed: " + (response?.error || "Unknown error"), this.currentModel, true);
            }
        } catch (e) {
            this.removeTypingIndicator();
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
        return this.chatHistory.slice(0, upToIndex + 1).map(m => {
            // Extract text content for API (some models don't support complex content)
            let textContent = m.displayText || m.content;
            if (typeof textContent !== 'string') {
                if (Array.isArray(textContent)) {
                    const textPart = textContent.find(c => c.type === 'text');
                    textContent = textPart ? textPart.text : '';
                } else {
                    textContent = String(textContent);
                }
            }
            return { role: m.role, content: textContent };
        });
    }

    /**
     * Extract text content from history for context
     * @param {number} upToIndex - Include messages up to this index
     * @returns {string} Combined text content
     */
    _extractTextFromHistory(upToIndex) {
        return this.chatHistory
            .slice(0, upToIndex + 1)
            .filter(m => m.role === 'user')
            .map(m => m.displayText || (typeof m.content === 'string' ? m.content : ''))
            .join('\n');
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
    }

    /**
     * Process a snipped image for this window
     * Creates a proper message object (like the initial snip) so it persists in history correctly
     * @param {string} croppedBase64
     */
    _processSnippedImage(croppedBase64) {
        // Store image for compare window access
        this.allImages.push(croppedBase64);

        this.showTypingIndicator();

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
                base64Image: croppedBase64
            }, (response) => {
                this.removeTypingIndicator();
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
                        text: ocrResult.text
                    }, (response) => {
                        this.removeTypingIndicator();
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
        newUI.showTypingIndicator();

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

            if (isVisionModel(newUI.currentModel) && imagesToSend.length > 0) {
                // Vision model with images: Always use MULTI_IMAGE which supports textContext
                // ASK_AI does NOT support additionalContext, so we must use MULTI_IMAGE even for 1 image
                response = await chrome.runtime.sendMessage({
                    action: "ASK_AI_MULTI_IMAGE",
                    model: newUI.currentModel,
                    images: imagesToSend,
                    textContext: fullTextContext
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
                        mode: newUI.currentMode
                    });
                } else {
                    // OCR failed, just use text history
                    response = await chrome.runtime.sendMessage({
                        action: "CONTINUE_CHAT",
                        model: newUI.currentModel,
                        history: apiHistory,
                        mode: newUI.currentMode
                    });
                }
            } else {
                // No images: Use text-only chat
                response = await chrome.runtime.sendMessage({
                    action: "CONTINUE_CHAT",
                    model: newUI.currentModel,
                    history: apiHistory,
                    mode: newUI.currentMode
                });
            }

            newUI.removeTypingIndicator();
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
            newUI.addMessage('assistant', "⚠️ Network Error: " + e.message, newUI.currentModel, true);
        }
    }

    /**
     * Helper to render a cloned message in a new window
     * @param {FloatingChatUI} targetUI - The target window
     * @param {Object} msg - The message object from chatHistory
     */
    _renderClonedMessage(targetUI, msg) {
        const msgDiv = document.createElement("div");
        msgDiv.style.cssText = `max-width: 85%; padding: 12px 14px; border-radius: 10px; line-height: 1.5; word-wrap: break-word; font-size: 13px; position: relative;`;

        if (msg.role === 'user') {
            msgDiv.style.alignSelf = "flex-end";
            msgDiv.style.background = "linear-gradient(135deg, #3a3a3a 0%, #2d2d2d 100%)";
            msgDiv.style.color = "#e8e8e8";
            msgDiv.style.borderRadius = "10px 10px 2px 10px";
            msgDiv.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";

            // Check for image
            if (msg.base64Image) {
                const imgContainer = document.createElement('div');
                imgContainer.style.cssText = `margin-bottom: 8px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); background: #1a1a1a; position: relative;`;

                const thumbnail = document.createElement('img');
                thumbnail.src = `data:image/png;base64,${msg.base64Image}`;
                thumbnail.style.cssText = `width: 100%; max-height: 120px; object-fit: cover; cursor: pointer; display: block;`;
                thumbnail.onclick = () => targetUI._showImageModal(`data:image/png;base64,${msg.base64Image}`);

                const overlay = document.createElement('div');
                overlay.style.cssText = `position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,0.6); border-radius: 4px; padding: 2px 6px; font-size: 10px; color: #ccc;`;
                overlay.textContent = '📷';

                imgContainer.appendChild(thumbnail);
                imgContainer.appendChild(overlay);
                msgDiv.appendChild(imgContainer);
            }

            const textLabel = document.createElement('span');
            textLabel.style.cssText = "opacity: 0.9; font-size: 12px;";
            textLabel.textContent = msg.displayText || '';
            msgDiv.appendChild(textLabel);
        } else {
            msgDiv.style.alignSelf = "flex-start";
            msgDiv.style.background = "rgba(255,255,255,0.05)";
            msgDiv.style.color = "#e8e8e8";
            msgDiv.style.border = "1px solid rgba(255,255,255,0.08)";
            msgDiv.style.borderRadius = "10px 10px 10px 2px";

            const modelLabel = targetUI._getModelDisplayName(msg.model);
            const labelDiv = document.createElement("div");
            labelDiv.style.cssText = "font-size: 10px; color: #ff6b4a; margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 4px; background: rgba(255,107,74,0.1); padding: 3px 8px; border-radius: 4px;";
            labelDiv.innerHTML = `<span style="font-size: 11px;">✨</span> ${modelLabel}`;
            msgDiv.appendChild(labelDiv);

            const contentDiv = document.createElement("div");
            contentDiv.style.cssText = "max-height: 350px; overflow-y: auto;";
            const text = msg.displayText || (typeof msg.content === 'string' ? msg.content : '');
            if (typeof parseMarkdown === 'function') {
                contentDiv.innerHTML = parseMarkdown(sanitizeModelText(text));
            } else {
                contentDiv.innerText = text;
            }
            msgDiv.appendChild(contentDiv);
        }

        targetUI.chatBody.appendChild(msgDiv);
    }

    /**
     * Get the next available model not currently in use
     * @returns {string|null}
     */
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

        this.showTypingIndicator();

        const modelToUse = this.currentModel;
        const modeToUse = mode || this.currentMode || 'short';

        // Use displayText for API calls (compatible format) while preserving model attribution
        const formattedHistory = this.chatHistory.map(msg => {
            const textContent = msg.displayText || (typeof msg.content === 'string' ? msg.content : '');
            if (msg.model && msg.role === 'assistant') {
                return { role: msg.role, content: `[Response from ${this._getModelDisplayName(msg.model)}]: ${textContent}` };
            }
            return { role: msg.role, content: textContent };
        });

        try {
            const response = await chrome.runtime.sendMessage({
                action: "CONTINUE_CHAT",
                model: modelToUse,
                history: formattedHistory,
                mode: modeToUse,
                parallelCount: parallelCount
            });

            this.removeTypingIndicator();

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
            this.addMessage('assistant', "⚠️ Network Error: " + e.message, modelToUse, true);
        }
        WindowManager.onResponseReceived();
    }

    /**
     * Handle send button click
     */
    async handleSend() {
        const text = this.input.value.trim();
        if (!text) return;
        this.input.value = "";
        this.input.style.height = 'auto';
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
        this.hasSavedPosition = true;

        chrome.storage.local.get(['chatWinState'], (res) => {
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
