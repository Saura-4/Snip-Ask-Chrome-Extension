// src/content/content.js

let startX, startY, selectionBox, glassPane;
let isSelecting = false;

// Helper to identify Vision Models
function isVisionModel(modelName) {
    if (!modelName) return false;
    return modelName.includes("llama-4") || modelName.includes("vision");
}

// 1. Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_SNIP") {
        // Prevent multiple start clicks
        if (isSelecting) return true;
        
        isSelecting = true;
        
        // A. Create the "Glass Pane" (Crucial for PDFs)
        createGlassPane();
        
        // B. Create the Selection Box (Hidden initially)
        createSelectionBox();
        
        sendResponse({ status: "Snip started" });
    }
    return true;
});

// 2. Selection UI Logic
function createGlassPane() {
    // This invisible layer sits ON TOP of the PDF to capture mouse clicks
    glassPane = document.createElement("div");
    
    // 1. Make it focusable so we can steal keyboard/mouse focus from the PDF
    glassPane.setAttribute("tabindex", "-1"); 
    
    glassPane.style.cssText = `
        position: fixed; 
        top: 0; left: 0; 
        width: 100vw; height: 100vh; 
        z-index: 2147483647; 
        cursor: crosshair; 
        
        /* 2. Force a tiny background color. "Transparent" sometimes lets clicks fall through to PDFs. */
        background: rgba(0,0,0,0.01); 
        
        /* 3. Force the browser to put this on a new GPU layer (fixes the "tab switch" lag) */
        transform: translateZ(100px);
        outline: none;
    `;
    
    document.documentElement.appendChild(glassPane); // Append to root, not body, for better PDF compatibility
    
    // 4. Force Focus Immediately
    glassPane.focus();
    
    // Attach events to the GLASS PANE
    glassPane.addEventListener("mousedown", onMouseDown);
}

function createSelectionBox() {
    if (selectionBox) selectionBox.remove();
    selectionBox = document.createElement("div");
    selectionBox.style.cssText = `
        position: fixed; 
        border: 2px dashed #f55036; 
        background-color: rgba(245, 80, 54, 0.2); 
        z-index: 2147483647; 
        pointer-events: none; 
        display: none;
    `;
    document.body.appendChild(selectionBox);
}

function onMouseDown(e) {
    if (!isSelecting) return;
    e.preventDefault();
    e.stopPropagation(); // Stop PDF viewer from reacting

    startX = e.clientX;
    startY = e.clientY;
    
    selectionBox.style.left = startX + "px";
    selectionBox.style.top = startY + "px";
    selectionBox.style.width = "0px";
    selectionBox.style.height = "0px";
    selectionBox.style.display = "block";
    
    // Add move/up listeners to the glass pane to ensure we catch them
    glassPane.addEventListener("mousemove", onMouseMove);
    glassPane.addEventListener("mouseup", onMouseUp);
}

function onMouseMove(e) {
    const currentX = e.clientX;
    const currentY = e.clientY;
    
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const left = Math.min(currentX, startX);
    const top = Math.min(currentY, startY);

    selectionBox.style.width = width + "px";
    selectionBox.style.height = height + "px";
    selectionBox.style.left = left + "px";
    selectionBox.style.top = top + "px";
}

// 3. The Core Logic (Snip Complete)
async function onMouseUp(e) {
    // Cleanup Listeners
    glassPane.removeEventListener("mousemove", onMouseMove);
    glassPane.removeEventListener("mouseup", onMouseUp);
    glassPane.removeEventListener("mousedown", onMouseDown);
    
    const rect = selectionBox.getBoundingClientRect();
    
    // Cleanup DOM
    selectionBox.remove();
    glassPane.remove(); // Remove the glass pane so you can click the PDF again
    selectionBox = null;
    glassPane = null;
    isSelecting = false;

    if (rect.width < 10 || rect.height < 10) return;

    // Capture Screenshot
    chrome.runtime.sendMessage({
        action: "CAPTURE_VISIBLE_TAB"
    }, (response) => {
        if (!response || !response.dataUrl) {
            alert("Screenshot failed. Reload page.");
            if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
            return;
        }

        if (typeof showLoadingCursor === 'function') showLoadingCursor();

        // Crop the image
        cropImage(response.dataUrl, rect, async (croppedBase64) => {

            chrome.storage.local.get(['groqKey', 'selectedModel'], async (result) => {
                if (!result.groqKey) {
                    alert("Please set Groq API Key in extension popup!");
                    if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                    return;
                }

                const currentModel = result.selectedModel || "llama-3.3-70b-versatile";

                // === PATH A: VISION MODEL (Direct Image) ===
                if (isVisionModel(currentModel)) {
                    console.log(`Vision Model detected (${currentModel}). Sending Image directly.`);
                    chrome.runtime.sendMessage({
                        action: "ASK_GROQ",
                        apiKey: result.groqKey,
                        model: currentModel,
                        base64Image: croppedBase64
                    }, handleResponse);
                    return;
                }

                // === PATH B: TEXT MODEL (Engage OCR via Background) ===
                console.log(`Text Model detected (${currentModel}). Engaging OCR via Background.`);

                chrome.runtime.sendMessage({
                    action: "PERFORM_OCR",
                    base64Image: croppedBase64
                }, (ocrResponse) => {

                    if (chrome.runtime.lastError || !ocrResponse) {
                        alert("OCR Failed: " + (chrome.runtime.lastError?.message || "Unknown error"));
                        if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                        return;
                    }

                    if (ocrResponse.success && ocrResponse.text && ocrResponse.text.length > 3) {
                        console.log("OCR Success:", ocrResponse.text);
                        chrome.runtime.sendMessage({
                            action: "ASK_GROQ_TEXT",
                            apiKey: result.groqKey,
                            model: currentModel,
                            text: ocrResponse.text,
                            ocrConfidence: ocrResponse.confidence
                        }, handleResponse);
                    } else {
                        console.warn("OCR Empty or Failed.");
                        if (isVisionModel(currentModel)) {
                            chrome.runtime.sendMessage({
                                action: "ASK_GROQ",
                                apiKey: result.groqKey,
                                model: currentModel,
                                base64Image: croppedBase64
                            }, handleResponse);
                        } else {
                            alert("⚠️ No text found in snippet.\n\nSince 'Llama 3' cannot see images, please try snipping clearer text or switch to 'Llama 4 (Vision)'.");
                            if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                        }
                    }
                });
            });
        });
    });
}

// ... (Existing snip/OCR logic remains above) ...

// ============================================================================
// 4. RESPONSE HANDLER (Updated)
// ============================================================================
function handleResponse(apiResponse) {
    if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
    
    if (apiResponse && apiResponse.success) {
        // Instantiate the new Chat UI
        const ui = new FloatingChatUI();
        
        // Add the Initial User Context (Image or Text)
        ui.addMessage('user', apiResponse.initialUserMessage); 
        
        // Add the AI Response
        ui.addMessage('assistant', apiResponse.answer);
    } else {
        alert("Error: " + (apiResponse ? apiResponse.error : "Unknown error"));
    }
}

// ============================================================================
// 5. HELPER: Text Sanitizer (KEEP THIS!)
// ============================================================================
function sanitizeModelText(rawText) {
    if (!rawText) return rawText;
    const lines = rawText.split('\n');
    // Removes "Corrected text: ..." prefix common in some Llama models
    if (lines[0].match(/^\s*Corrected text\s*:/i)) {
        const corrected = lines[0].replace(/^\s*Corrected text\s*:\s*/i, '').trim();
        if (corrected.length < 60) {
            return lines.slice(1).join('\n').trim();
        }
        const trimmed = corrected.length > 200 ? corrected.slice(0, 200) + '…' : corrected;
        return ("Corrected text: " + trimmed + "\n" + lines.slice(1).join('\n')).trim();
    }
    return rawText;
}
// ============================================================================
// 6. UI CLASS (Robust State Management)
// ============================================================================
class FloatingChatUI {
    constructor() {
        this.chatHistory = []; 
        this.createWindow();
        this.loadState(); // This will now handle Position AND Size
    }

    createWindow() {
        this.host = document.createElement("div");
        this.host.id = "groq-chat-host";
        this.host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;";
        
        this.shadow = this.host.attachShadow({ mode: 'closed' });

        this.container = document.createElement("div");
        // Default styles (will be overridden by loadState)
        this.container.style.cssText = `
            position: fixed; 
            width: 450px; height: 500px;
            background: #1e1e1e; color: #d4d4d4;
            border: 1px solid #f55036; border-radius: 10px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6);
            display: flex; flex-direction: column;
            font-family: 'Segoe UI', sans-serif; font-size: 14px;
            resize: both; overflow: hidden; 
            min-width: 300px; min-height: 200px;
            max-width: 90vw; max-height: 90vh;
        `;

        // 1. Header
        const header = document.createElement("div");
        header.innerHTML = `
            <strong style="color: #f55036;">⚡ Groq Chat</strong>
            <span id="closeBtn" style="cursor: pointer; color: #888; font-weight: bold; font-size:16px;">✖</span>
        `;
        header.style.cssText = `
            padding: 12px; background: #2d2d2d; border-bottom: 1px solid #454545;
            cursor: move; display: flex; justify-content: space-between; align-items: center;
            border-radius: 10px 10px 0 0; user-select: none;
        `;
        this.container.appendChild(header);

        // 2. Chat Body
        this.chatBody = document.createElement("div");
        this.chatBody.style.cssText = `
            flex-grow: 1; overflow-y: auto; padding: 15px; 
            display: flex; flex-direction: column; gap: 15px;
            background: #1e1e1e; scrollbar-width: thin; scrollbar-color: #444 #1e1e1e;
        `;
        this.container.appendChild(this.chatBody);

        // 3. Input Area
        const inputArea = document.createElement("div");
        inputArea.style.cssText = `
            padding: 10px; border-top: 1px solid #454545; background: #252526;
            display: flex; gap: 10px; border-radius: 0 0 10px 10px; align-items: flex-end;
        `;
        
        this.input = document.createElement("textarea");
        this.input.placeholder = "Ask a follow-up...";
        this.input.rows = 1;
        this.input.style.cssText = `
            flex-grow: 1; background: #333; border: 1px solid #444; color: white;
            padding: 8px; border-radius: 4px; resize: none; font-family: inherit; min-height: 36px; max-height: 120px;
        `;
        
        this.input.addEventListener('input', () => {
            this.input.style.height = 'auto';
            this.input.style.height = Math.min(this.input.scrollHeight, 120) + 'px';
        });

        this.sendBtn = document.createElement("button");
        this.sendBtn.innerText = "➤";
        this.sendBtn.style.cssText = `
            background: #f55036; color: white; border: none; padding: 0 15px; height: 36px;
            border-radius: 4px; cursor: pointer; font-weight: bold;
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
        header.querySelector("#closeBtn").onclick = () => this.host.remove();
        
        // Draggable Logic
        this.makeDraggable(header);
        
        // Listener for RESIZING (Save state when mouse releases on container)
        this.container.addEventListener('mouseup', () => this.saveState());
    }

    addMessage(role, content) {
        // ... (Keep your exact existing addMessage logic here) ...
        // COPY PASTE THE addMessage FUNCTION FROM PREVIOUS STEPS HERE
        if (typeof content === 'string') {
             this.chatHistory.push({ role: role, content: content });
        } else {
             this.chatHistory.push(content);
        }

        const msgDiv = document.createElement("div");
        msgDiv.style.cssText = `max-width: 90%; padding: 10px 12px; border-radius: 8px; line-height: 1.5; word-wrap: break-word; font-size: 13px;`;

        if (role === 'user') {
            msgDiv.style.alignSelf = "flex-end"; msgDiv.style.background = "#3a3a3a"; msgDiv.style.color = "#ececec";
            if (typeof content === 'object' && content.content) {
                const textPart = Array.isArray(content.content) ? content.content.find(c => c.type === 'text') : { text: content.content };
                msgDiv.innerHTML = `<em>(Snippet)</em><br>${textPart ? textPart.text : ''}`;
            } else { msgDiv.innerText = content; }
        } else {
            msgDiv.style.alignSelf = "flex-start"; msgDiv.style.background = "#2d2d2d"; msgDiv.style.borderLeft = "3px solid #f55036";
            const cleanText = sanitizeModelText(content);
            if (typeof parseMarkdown === 'function') msgDiv.innerHTML = parseMarkdown(cleanText);
            else msgDiv.innerText = cleanText;
            
            // Re-add copy buttons
            const codeBlocks = msgDiv.querySelectorAll("pre");
            codeBlocks.forEach(pre => {
                pre.style.position = "relative";
                const btn = document.createElement("button");
                btn.innerText = "Copy";
                btn.style.cssText = `position: absolute; top: 5px; right: 5px; background: #f55036; color: white; border: none; border-radius: 3px; font-size: 10px; padding: 3px 8px; cursor: pointer; opacity: 0.9;`;
                btn.onclick = () => {
                    const codeText = pre.querySelector("code") ? pre.querySelector("code").innerText : pre.innerText;
                    navigator.clipboard.writeText(codeText).then(() => { btn.innerText = "Copied!"; setTimeout(() => btn.innerText = "Copy", 2000); });
                };
                pre.appendChild(btn);
            });
        }
        this.chatBody.appendChild(msgDiv);
        this.chatBody.scrollTop = this.chatBody.scrollHeight;
    }

    async handleSend() {
        // ... (Keep your exact existing handleSend logic here) ...
        // COPY PASTE THE handleSend FUNCTION FROM PREVIOUS STEPS HERE
        const text = this.input.value.trim();
        if (!text) return;

        this.input.value = ""; this.input.style.height = 'auto';
        this.addMessage('user', text);

        const loadingDiv = document.createElement("div");
        loadingDiv.innerText = "Thinking...";
        loadingDiv.style.cssText = "align-self: flex-start; color: #888; font-style: italic; font-size: 12px; margin-left: 10px;";
        this.chatBody.appendChild(loadingDiv);
        this.chatBody.scrollTop = this.chatBody.scrollHeight;

        chrome.storage.local.get(['groqKey', 'selectedModel'], async (res) => {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: "CONTINUE_CHAT", apiKey: res.groqKey, model: res.selectedModel, history: this.chatHistory
                });
                loadingDiv.remove();
                if (response && response.success) { this.addMessage('assistant', response.answer); } 
                else { this.addMessage('assistant', "⚠️ Error: " + (response.error || "Unknown error")); }
            } catch (e) { loadingDiv.remove(); this.addMessage('assistant', "⚠️ Network Error: " + e.message); }
        });
    }

    makeDraggable(header) {
        let isDragging = false;
        let offsetX, offsetY;

        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'closeBtn') return; 
            isDragging = true;
            // Calculate offset relative to the CONTAINER, not the screen
            const rect = this.container.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault(); 
                this.container.style.left = (e.clientX - offsetX) + "px";
                this.container.style.top = (e.clientY - offsetY) + "px";
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                this.saveState();
            }
        });
    }

    // --- UPDATED SAVE/LOAD LOGIC ---

    saveState() {
        // Get absolute position and size
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

    loadState() {
        chrome.storage.local.get(['chatWinState'], (res) => {
            if (res.chatWinState) {
                const s = res.chatWinState;
                
                // Bounds check (prevent window from being lost off-screen)
                const top = Math.max(0, Math.min(s.top, window.innerHeight - 50));
                const left = Math.max(0, Math.min(s.left, window.innerWidth - 50));
                
                this.container.style.top = top + "px";
                this.container.style.left = left + "px";
                
                // Restore dimensions if they exist
                if (s.width) this.container.style.width = s.width + "px";
                if (s.height) this.container.style.height = s.height + "px";
            } else {
                // Default center-ish
                this.container.style.top = "50px";
                this.container.style.left = "50px";
            }
        });
    }
}