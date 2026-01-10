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

// 4. Response Handler
function handleResponse(apiResponse) {
    if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
    if (apiResponse && apiResponse.success) {
        createFloatingWindow(apiResponse.answer);
    } else {
        alert("Error: " + (apiResponse ? apiResponse.error : "Unknown error"));
    }
}

// 5. UI: Shadow DOM Window
function sanitizeModelText(rawText) {
    if (!rawText) return rawText;
    const lines = rawText.split('\n');
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

function createFloatingWindow(text) {
    chrome.storage.local.get(['winState'], (res) => {
        const state = res.winState || {
            top: 50,
            left: 50,
            width: 500,
            height: 400
        };

        const host = document.createElement("div");
        host.id = "snip-ask-extension-host";
        host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;";

        const shadow = host.attachShadow({
            mode: 'closed'
        });

        const container = document.createElement("div");
        container.style.cssText = `
      position: fixed; top: ${state.top}px; left: ${state.left}px;
      width: ${state.width}px; height: ${state.height}px;
      background: #1e1e1e; color: #d4d4d4;
      border: 1px solid #f55036; border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      display: flex; flex-direction: column;
      font-family: 'Segoe UI', sans-serif; font-size: 14px;
      resize: both; overflow: hidden; min-width: 200px; min-height: 150px;
      box-sizing: border-box;
    `;

        const header = document.createElement("div");
        header.style.cssText = `
      padding: 10px; background: #2d2d2d; border-bottom: 1px solid #454545;
      cursor: move; display: flex; justify-content: space-between; align-items: center;
      border-radius: 8px 8px 0 0; user-select: none; flex-shrink: 0;
    `;
        header.innerHTML = `<strong style="color: #f55036;">⚡ Groq Answer</strong>
      <div style="display:flex; gap:10px;">
        <button id="copyAllBtn" style="background:transparent; border:1px solid #555; color:#ccc; cursor:pointer; font-size:10px; padding:2px 6px; border-radius:3px;">Copy All</button>
        <span id="closeGroqBtn" style="cursor: pointer; color: #888; font-weight: bold;">✖</span>
      </div>`;
        container.appendChild(header);

        const body = document.createElement("div");
        body.id = "groqContentBody";
        body.style.cssText = `padding: 15px; overflow-y: auto; flex-grow: 1; line-height: 1.6;`;

        // === PARSE LOGIC ===
        let thoughtContent = null;
        let finalAnswer = text;
        const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);

        if (thinkMatch) {
            thoughtContent = thinkMatch[1].trim();
            finalAnswer = text.replace(thinkMatch[0], "").trim();
        }

        // === INJECT THOUGHT ===
        if (thoughtContent) {
            const details = document.createElement("details");
            details.style.cssText = "margin-bottom: 15px; border: 1px solid #454545; border-radius: 6px; background: #252526; overflow: hidden;";
            const summary = document.createElement("summary");
            summary.innerText = "💭 Show Thought Process";
            summary.style.cssText = "cursor: pointer; padding: 8px 12px; color: #aaa; font-size: 12px; font-weight: 600; user-select: none; background: #2d2d2d;";
            const contentDiv = document.createElement("div");
            contentDiv.style.cssText = "padding: 10px 12px; color: #999; font-size: 13px; border-top: 1px solid #454545; white-space: pre-wrap; font-family: monospace;";
            contentDiv.innerText = thoughtContent;
            details.appendChild(summary);
            details.appendChild(contentDiv);
            body.appendChild(details);
        }

        const cleaned = sanitizeModelText(finalAnswer);

        if (typeof parseMarkdown === 'function') {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = parseMarkdown(cleaned);
            while (tempDiv.firstChild) body.appendChild(tempDiv.firstChild);
        } else {
            const p = document.createElement('p');
            p.innerText = cleaned;
            body.appendChild(p);
        }

        container.appendChild(body);

        const codeBlocks = body.querySelectorAll("pre");
        codeBlocks.forEach(pre => {
            pre.style.position = "relative";
            const btn = document.createElement("button");
            btn.innerText = "Copy";
            btn.style.cssText = `position: absolute; top: 5px; right: 5px; background: #f55036; color: white; border: none; border-radius: 3px; font-size: 10px; padding: 3px 8px; cursor: pointer; opacity: 0.9;`;
            btn.onclick = () => {
                const codeText = pre.querySelector("code") ? pre.querySelector("code").innerText : pre.innerText;
                navigator.clipboard.writeText(codeText).then(() => {
                    btn.innerText = "Copied!";
                    setTimeout(() => btn.innerText = "Copy", 2000);
                });
            };
            pre.appendChild(btn);
        });

        header.querySelector("#copyAllBtn").onclick = () => {
            navigator.clipboard.writeText(text).then(() => {
                const btn = header.querySelector("#copyAllBtn");
                btn.innerText = "Copied!";
                setTimeout(() => btn.innerText = "Copy All", 2000);
            });
        };

        shadow.appendChild(container);
        document.body.appendChild(host);

        header.querySelector("#closeGroqBtn").onclick = () => host.remove();

        let isDragging = false;
        let offsetX, offsetY;

        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true;
            offsetX = e.clientX - container.offsetLeft;
            offsetY = e.clientY - container.offsetTop;
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                container.style.left = (e.clientX - offsetX) + "px";
                container.style.top = (e.clientY - offsetY) + "px";
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                saveState();
            }
        });
        container.addEventListener('mouseup', saveState);

        function saveState() {
            chrome.storage.local.set({
                winState: {
                    top: container.offsetTop,
                    left: container.offsetLeft,
                    width: container.offsetWidth,
                    height: container.offsetHeight
                }
            });
        }
    });
}