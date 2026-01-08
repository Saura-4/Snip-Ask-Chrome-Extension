// src/content/content.js

let startX, startY, selectionBox;
let isSelecting = false;

// Helper to identify Vision Models
function isVisionModel(modelName) {
    if (!modelName) return false;
    return modelName.includes("llama-4") || modelName.includes("vision");
}

// 1. Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_SNIP") {
    document.removeEventListener("mousedown", onMouseDown); 
    document.body.style.cursor = "crosshair";
    isSelecting = true;
    createSelectionBox();
    document.addEventListener("mousedown", onMouseDown);
    sendResponse({ status: "Snip started" });
  }
  return true; 
});

// 2. Selection UI Logic
function createSelectionBox() {
  if (selectionBox) selectionBox.remove();
  selectionBox = document.createElement("div");
  selectionBox.style.position = "fixed";
  selectionBox.style.border = "2px dashed #f55036"; 
  selectionBox.style.backgroundColor = "rgba(245, 80, 54, 0.2)";
  selectionBox.style.zIndex = "2147483647"; 
  selectionBox.style.pointerEvents = "none";
  selectionBox.style.display = "none"; 
  document.body.appendChild(selectionBox);
}

function onMouseDown(e) {
  if (!isSelecting) return;
  e.preventDefault();
  startX = e.clientX;
  startY = e.clientY;
  selectionBox.style.left = startX + "px";
  selectionBox.style.top = startY + "px";
  selectionBox.style.width = "0px";
  selectionBox.style.height = "0px";
  selectionBox.style.display = "block";
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
}

function onMouseMove(e) {
  const currentX = e.clientX;
  const currentY = e.clientY;
  selectionBox.style.width = Math.abs(currentX - startX) + "px";
  selectionBox.style.height = Math.abs(currentY - startY) + "px";
  selectionBox.style.left = Math.min(currentX, startX) + "px";
  selectionBox.style.top = Math.min(currentY, startY) + "px";
}

// 3. The Core Logic (Snip Complete)
async function onMouseUp(e) {
  isSelecting = false;
  document.body.style.cursor = "default";
  document.removeEventListener("mousemove", onMouseMove);
  document.removeEventListener("mouseup", onMouseUp);
  document.removeEventListener("mousedown", onMouseDown);

  const rect = selectionBox.getBoundingClientRect();
  selectionBox.remove();

  if (rect.width < 10 || rect.height < 10) return;

  // Capture Screenshot
  chrome.runtime.sendMessage({ action: "CAPTURE_VISIBLE_TAB" }, (response) => {
    if (!response || !response.dataUrl) {
      alert("Screenshot failed. Reload page.");
      if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
      return;
    }
    
    if (typeof showLoadingCursor === 'function') showLoadingCursor();

    // Crop the image (using utils.js helper if available, or we could move it here too)
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
        
        // === PATH B: TEXT MODEL (Must use OCR) ===
        console.log(`Text Model detected (${currentModel}). Engaging OCR.`);

        try {
            // 1. Load Engine
            await loadTesseractEngine();
            
            // 2. Run OCR (Using the LOCAL function, not utils.js)
            const ocrRes = await runLocalOCR(croppedBase64);
            console.log("OCR Result:", ocrRes);

            // 3. Validate Result
            if (ocrRes.text && ocrRes.text.trim().length > 3) {
                 chrome.runtime.sendMessage({
                    action: "ASK_GROQ_TEXT",
                    apiKey: result.groqKey,
                    model: currentModel,
                    text: ocrRes.text,
                    ocrConfidence: ocrRes.confidence
                }, handleResponse);
            } else {
                // FAILURE: Text model cannot read empty text
                console.warn("OCR failed to find text.");
                alert("⚠️ No text detected!\n\nYou selected a Text Model (Llama 3), but this snip looks like an image/diagram.\n\nPlease switch to a 'Vision Model' (Llama 4) in the popup to analyze images.");
                if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
            }

        } catch (err) {
            console.error("OCR Pipeline Failed:", err);
            alert("OCR Initialization Failed. Please reload the page.");
            if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
        }
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

// 5. Dynamic Tesseract Loader (Fixed for Scope Isolation)
async function loadTesseractEngine() {
    // Check if it's already loaded in OUR scope
    if (window.Tesseract) {
        console.log("Tesseract already loaded.");
        return;
    }

    console.log("Requesting Tesseract injection from background...");

    return new Promise((resolve, reject) => {
        // Ask background to inject the script into our isolated world
        chrome.runtime.sendMessage({ action: "INJECT_TESSERACT" }, (response) => {
            if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
            }
            if (response && response.success) {
                console.log("Tesseract loaded successfully.");
                resolve();
            } else {
                reject(new Error("Failed to load Tesseract: " + (response ? response.error : "Unknown error")));
            }
        });
    });
}

// ... (keep runLocalOCR and other functions same) ...

// 6. Local OCR Function (Offline Mode - Fixed for v7)
// src/content/content.js

// --- HELPER: Convert Base64 to Binary Buffer ---
function base64ToBuffer(base64) {
    // Remove the data URI prefix if it exists (e.g., "data:image/jpeg;base64,")
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    
    // Decode Base64 string
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// --- UPDATED OCR FUNCTION ---
async function runLocalOCR(base64Image) {
    if (!window.Tesseract) throw new Error("Tesseract not loaded");

    const workerPath = chrome.runtime.getURL('lib/worker.min.js');
    const corePath = chrome.runtime.getURL('lib/tesseract-core.wasm.js');
    const langPath = chrome.runtime.getURL('lib/');

    // 1. Initialize Worker
    const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: workerPath,
        corePath: corePath,
        langPath: langPath,
        cacheMethod: 'none',
        gzip: true,
        // errorHandler helps debug if something goes wrong inside the worker
        errorHandler: e => console.error('Tesseract Worker Error:', e) 
    });

    // 2. Convert Image to Buffer (This fixes the "Unknown format" & "404" errors)
    const imageBuffer = base64ToBuffer(base64Image);

    // 3. Recognize
    try {
        const { data: { text, confidence } } = await worker.recognize(imageBuffer);
        await worker.terminate();
        return { text: text.trim(), confidence: confidence };
    } catch (err) {
        await worker.terminate();
        throw err;
    }
}

// 7. UI: Shadow DOM Window (From previous steps)
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
    const state = res.winState || { top: 50, left: 50, width: 500, height: 400 };

    const host = document.createElement("div");
    host.id = "snip-ask-extension-host";
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;";
    
    const shadow = host.attachShadow({ mode: 'closed' });

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
        // Create a temporary div to sanitize HTML if parseMarkdown returns raw HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = parseMarkdown(cleaned);
        // Then move children to body. (Ideally use a sanitizer library here)
        while(tempDiv.firstChild) body.appendChild(tempDiv.firstChild);
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
      if(e.target.tagName === 'BUTTON') return; 
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