// src/content/floating-chat-ui.js
// FloatingChatUI class - the main chat window component

/**
 * FloatingChatUI - Floating chat window for AI interactions
 */
class FloatingChatUI {
    constructor() {
        this.chatHistory = [];
        this.currentModel = null;
        this.currentMode = null; // Track selected mode (short/detailed/code/default)
        this.availableModels = [];
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

        // Get the current selected model from storage
        const storage = await new Promise(resolve => {
            chrome.storage.local.get(['selectedModel', 'selectedMode'], resolve);
        });
        this.currentModel = storage.selectedModel || 'meta-llama/llama-4-scout-17b-16e-instruct';
        this.currentMode = storage.selectedMode || 'short';

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
        if (this.host) {
            this.host.remove();
            this.host = null;
        }
        WindowManager.unregister(this);
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
        `;

        // Inject UX Polish Styles (Tables, Code Blocks, Typing Indicator)
        const style = document.createElement('style');
        style.textContent = `
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

        const modes = [
            { value: 'short', name: '⚡ Short' },
            { value: 'detailed', name: '📚 Detailed' },
            { value: 'code', name: '💻 Code' },
            { value: 'default', name: '🎯 Default' }
        ];

        modes.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m.value;
            opt.textContent = m.name;
            if (m.value === this.currentMode) opt.selected = true;
            this.modeSelect.appendChild(opt);
        });

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
     * @param {string|Object} content - Message content
     * @param {string|null} modelName - Model name for assistant messages
     * @param {boolean} isError - Whether this is an error message
     */
    addMessage(role, content, modelName = null, isError = false) {
        // Track model name for assistant messages
        const msgModel = role === 'assistant' ? (modelName || this.currentModel) : null;

        // ALWAYS store string content in chatHistory for compatibility with all models
        let historyContent = content;
        if (typeof content !== 'string') {
            if (Array.isArray(content)) {
                const textPart = content.find(c => c.type === 'text');
                historyContent = textPart ? textPart.text : '(image analyzed)';
            } else if (content && content.content) {
                if (Array.isArray(content.content)) {
                    const textPart = content.content.find(c => c.type === 'text');
                    historyContent = textPart ? textPart.text : '(image analyzed)';
                } else if (typeof content.content === 'string') {
                    historyContent = content.content;
                } else {
                    historyContent = '(complex content)';
                }
            } else {
                historyContent = '(complex content)';
            }
        }
        this.chatHistory.push({ role: role, content: historyContent, model: msgModel });

        const msgDiv = document.createElement("div");
        msgDiv.style.cssText = `max-width: 85%; padding: 12px 14px; border-radius: 10px; line-height: 1.5; word-wrap: break-word; font-size: 13px; position: relative; transition: all 0.2s ease;`;

        if (role === 'user') {
            msgDiv.style.alignSelf = "flex-end";
            msgDiv.style.background = "linear-gradient(135deg, #3a3a3a 0%, #2d2d2d 100%)";
            msgDiv.style.color = "#e8e8e8";
            msgDiv.style.borderRadius = "10px 10px 2px 10px";
            msgDiv.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";

            if (typeof content === 'object' && content.content) {
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
                msgDiv.innerText = content;
            }
        } else {
            msgDiv.style.alignSelf = "flex-start";
            msgDiv.style.background = "rgba(255,255,255,0.05)";
            msgDiv.style.color = "#e8e8e8";
            msgDiv.style.border = "1px solid rgba(255,255,255,0.08)";
            msgDiv.style.borderRadius = "10px 10px 10px 2px";

            // Add model label for assistant messages
            const modelLabel = this._getModelDisplayName(msgModel);
            const labelDiv = document.createElement("div");
            labelDiv.style.cssText = "font-size: 10px; color: #ff6b4a; margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 4px; background: rgba(255,107,74,0.1); padding: 3px 8px; border-radius: 4px;";
            labelDiv.innerHTML = `<span style="font-size: 11px;">✨</span> ${modelLabel}`;
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

            // Regenerate button
            const regenBtn = createActionButton("Regenerate", '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>', "Get a new response");
            regenBtn.onclick = () => this.regenerateLastResponse();
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
     * Regenerate the last assistant response
     */
    async regenerateLastResponse() {
        let lastUserMsgIndex = -1;
        for (let i = this.chatHistory.length - 1; i >= 0; i--) {
            if (this.chatHistory[i].role === 'user') {
                lastUserMsgIndex = i;
                break;
            }
        }

        if (lastUserMsgIndex === -1) return;

        if (this.chatHistory.length > lastUserMsgIndex + 1) {
            this.chatHistory.pop();
            const lastMsgDiv = this.chatBody.lastElementChild;
            if (lastMsgDiv) lastMsgDiv.remove();
        }



        this.showTypingIndicator();

        try {
            let response;

            if (isVisionModel(this.currentModel) && this.initialBase64Image && lastUserMsgIndex === 0) {
                response = await chrome.runtime.sendMessage({
                    action: "ASK_AI",
                    model: this.currentModel,
                    base64Image: this.initialBase64Image
                });
            } else {
                response = await chrome.runtime.sendMessage({
                    action: "CONTINUE_CHAT",
                    model: this.currentModel,
                    history: this.chatHistory.slice(0, lastUserMsgIndex + 1).map(m => ({ role: m.role, content: m.content })),
                    mode: this.currentMode // Maintain selected mode on regenerate
                });
            }

            this.removeTypingIndicator();

            if (response && response.success) {
                this.addMessage('assistant', response.answer, this.currentModel);
                if (response.demoInfo) {
                    updateLocalDemoCache(response.demoInfo);
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
     * @param {string} croppedBase64
     */
    _processSnippedImage(croppedBase64) {
        // Store image for compare window access
        this.allImages.push(croppedBase64);

        this.showTypingIndicator();

        this.addMessage('user', '(New screenshot added)');

        if (isVisionModel(this.currentModel)) {
            chrome.runtime.sendMessage({
                action: "ASK_AI",
                model: this.currentModel,
                base64Image: croppedBase64
            }, (response) => {
                this.removeTypingIndicator();
                if (response && response.success) {
                    this.addMessage('assistant', response.answer, this.currentModel);
                    if (response.demoInfo) {
                        updateLocalDemoCache(response.demoInfo);
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
                            this.addMessage('assistant', response.answer, this.currentModel);
                            if (response.demoInfo) {
                                updateLocalDemoCache(response.demoInfo);
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

        // Build summary of follow-ups
        const userFollowUps = followUpMessages.filter(m => m.role === 'user');
        const snipAgainCount = userFollowUps.filter(m =>
            m.content.includes('(New screenshot added)') || m.content.includes('(Snippet)')
        ).length;
        const textFollowUps = userFollowUps.filter(m =>
            !m.content.includes('(New screenshot added)') && !m.content.includes('(Snippet)')
        );

        let summary = initialText;

        if (snipAgainCount > 0 || textFollowUps.length > 0) {
            summary += '\n\n---\n[Additional context from conversation:]\n';

            if (snipAgainCount > 0) {
                summary += `• User added ${snipAgainCount} more screenshot(s) to analyze\n`;
            }

            // Include text follow-ups (condensed)
            textFollowUps.forEach((msg, i) => {
                const truncated = msg.content.length > 100
                    ? msg.content.substring(0, 100) + '...'
                    : msg.content;
                summary += `• Follow-up ${i + 1}: "${truncated}"\n`;
            });
        }

        return summary;
    }

    /**
     * Spawn a comparison window with a different model
     */
    async spawnCompareWindow() {
        if (WindowManager.isMaxReached()) {
            showErrorToast(`Maximum ${WindowManager.maxWindows} comparison windows allowed`);
            return;
        }

        const newUI = await FloatingChatUI.create();
        WindowManager.register(newUI);

        if (this.initialUserMessage) {
            // Copy all context to compare window
            newUI.initialUserMessage = this.initialUserMessage;
            newUI.initialBase64Image = this.initialBase64Image;
            newUI.allImages = [...this.allImages];  // Copy all images

            // Inherit mode from parent window
            newUI.currentMode = this.currentMode;
            if (newUI.modeSelect) newUI.modeSelect.value = this.currentMode;

            // Build summarized context for text display
            const summarizedContext = this._buildSummarizedContext();
            newUI.addMessage('user', summarizedContext);

            const otherModel = this._getNextAvailableModel();
            if (otherModel && newUI.modelSelect) {
                newUI.currentModel = otherModel;
                newUI.modelSelect.value = otherModel;
            }

            newUI.showTypingIndicator();

            try {
                let response;

                // Collect all images (initial + snip-again)
                const allImagesToSend = [];
                if (this.initialBase64Image) {
                    allImagesToSend.push(this.initialBase64Image);
                }
                allImagesToSend.push(...this.allImages);

                // For vision models, send ALL images
                if (isVisionModel(newUI.currentModel) && allImagesToSend.length > 0) {
                    response = await chrome.runtime.sendMessage({
                        action: "ASK_AI_MULTI_IMAGE",
                        model: newUI.currentModel,
                        images: allImagesToSend,
                        textContext: summarizedContext
                    });

                    // Fallback to single image if multi-image not supported
                    if (!response || response.error?.includes('not supported')) {
                        response = await chrome.runtime.sendMessage({
                            action: "ASK_AI",
                            model: newUI.currentModel,
                            base64Image: allImagesToSend[allImagesToSend.length - 1],  // Use latest image
                            additionalContext: summarizedContext
                        });
                    }
                } else if (!isVisionModel(newUI.currentModel) && allImagesToSend.length > 0) {
                    // Text model - OCR all images and combine
                    // ... (legacy ocr logic)
                    let allOcrText = '';
                    for (const img of allImagesToSend) {
                        const ocrResult = await chrome.runtime.sendMessage({
                            action: "PERFORM_OCR",
                            base64Image: img
                        });
                        if (ocrResult?.success && ocrResult.text) {
                            allOcrText += ocrResult.text + '\n---\n';
                        }
                    }

                    if (allOcrText) {
                        response = await chrome.runtime.sendMessage({
                            action: "ASK_AI_TEXT",
                            model: newUI.currentModel,
                            text: allOcrText.trim()
                        });
                    } else {
                        response = { success: false, error: "OCR failed - no text extracted from images" };
                    }
                } else {
                    // No image - send summarized context as chat
                    response = await chrome.runtime.sendMessage({
                        action: "CONTINUE_CHAT",
                        model: newUI.currentModel,
                        history: [{ role: 'user', content: summarizedContext }],
                        mode: newUI.currentMode // Inherit mode from parent
                    });
                }

                newUI.removeTypingIndicator();
                if (response && response.success) {
                    newUI.addMessage('assistant', response.answer, newUI.currentModel);
                    if (response.demoInfo) {
                        updateLocalDemoCache(response.demoInfo);
                    }
                } else {
                    newUI.addMessage('assistant', "⚠️ Error: " + (response?.error || "Unknown error"), newUI.currentModel, true);
                }
            } catch (e) {
                newUI.removeTypingIndicator();
                newUI.addMessage('assistant', "⚠️ Network Error: " + e.message, newUI.currentModel, true);
            }
        }
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

        const formattedHistory = this.chatHistory.map(msg => {
            if (msg.model && msg.role === 'assistant') {
                return { role: msg.role, content: `[Response from ${this._getModelDisplayName(msg.model)}]: ${msg.content}` };
            }
            return { role: msg.role, content: msg.content };
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
                this.addMessage('assistant', response.answer, modelToUse);
                if (response.demoInfo) {
                    updateLocalDemoCache(response.demoInfo);
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

        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'closeBtn') return;
            isDragging = true;
            const rect = this.container.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
        });

        const onMouseMove = (e) => {
            if (isDragging) {
                e.preventDefault();
                this.container.style.left = (e.clientX - offsetX) + "px";
                this.container.style.top = (e.clientY - offsetY) + "px";
            }
        };

        const onMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                this.saveState();
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        this._dragCleanup = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
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
