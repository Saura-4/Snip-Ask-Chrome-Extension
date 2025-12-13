// content.js

let startX, startY, selectionBox;
let isSelecting = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_SNIP") {
    document.removeEventListener("mousedown", onMouseDown); // Cleanup first

    document.body.style.cursor = "crosshair";
    isSelecting = true;
    createSelectionBox();
    document.addEventListener("mousedown", onMouseDown);

    sendResponse({ status: "Snip started" });
  }
  return true; 
});

function createSelectionBox() {
  if (selectionBox) selectionBox.remove();
  selectionBox = document.createElement("div");
  selectionBox.style.position = "fixed";
  selectionBox.style.border = "2px dashed #f55036"; // Groq Orange
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

  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  const left = Math.min(currentX, startX);
  const top = Math.min(currentY, startY);

  selectionBox.style.width = width + "px";
  selectionBox.style.height = height + "px";
  selectionBox.style.left = left + "px";
  selectionBox.style.top = top + "px";
}

async function onMouseUp(e) {
  isSelecting = false;
  document.body.style.cursor = "default";

  document.removeEventListener("mousemove", onMouseMove);
  document.removeEventListener("mouseup", onMouseUp);
  document.removeEventListener("mousedown", onMouseDown);

  const rect = selectionBox.getBoundingClientRect();
  selectionBox.remove();

  if (rect.width < 10 || rect.height < 10) return;


  chrome.runtime.sendMessage({ action: "CAPTURE_VISIBLE_TAB" }, (response) => {
    if (!response || !response.dataUrl) {
      alert("Screenshot failed. Reload page.");
      hideLoadingCursor();
      return;
    }
    showLoadingCursor();

    // New hybrid pipeline: OCR first, fallback to image
    cropImage(response.dataUrl, rect, async (croppedBase64) => {
      // Get GROQ Key
      chrome.storage.local.get(['groqKey'], async (result) => {
        if (!result.groqKey) {
          alert("Please set Groq API Key in extension popup!");
          hideLoadingCursor();
          return;
        }
        try {
          // Run Tesseract OCR on the cropped image
          const ocrRes = await runTesseractOCR(croppedBase64);
          console.log('OCR result:', ocrRes);

          // threshold for confidence (tweakable)
          const CONF_THRESHOLD = 50;

          if (ocrRes.text && (ocrRes.confidence >= CONF_THRESHOLD|| ocrRes.text.length > 12)) {
            // send the OCR text to the model (better token efficiency)
            chrome.runtime.sendMessage({
              action: "ASK_GROQ_TEXT",
              apiKey: result.groqKey,
              text: ocrRes.text,
              ocrConfidence: ocrRes.confidence
            }, (apiResponse) => {
              hideLoadingCursor();
              if (apiResponse && apiResponse.success) {
                createFloatingWindow(apiResponse.answer);
              } else {
                alert("Error: " + (apiResponse ? apiResponse.error : "Unknown error"));
              }
            });
          } else {
            // OCR not confident enough — fallback to original image send
            chrome.runtime.sendMessage({
              action: "ASK_GROQ",
              apiKey: result.groqKey,
              base64Image: croppedBase64
            }, (apiResponse) => {
              hideLoadingCursor();
              if (apiResponse && apiResponse.success) {
                createFloatingWindow(apiResponse.answer);
              } else {
                alert("Error: " + (apiResponse ? apiResponse.error : "Unknown error"));
              }
            });
          }

        } catch (err) {
          console.error('Error in OCR pipeline:', err);
          hideLoadingCursor();
          alert('OCR failed; sending image to model as fallback.');
          chrome.runtime.sendMessage({
            action: "ASK_GROQ",
            apiKey: result.groqKey,
            base64Image: croppedBase64
          }, (apiResponse) => {
            if (apiResponse && apiResponse.success) {
              createFloatingWindow(apiResponse.answer);
            } else {
              alert("Error: " + (apiResponse ? apiResponse.error : "Unknown error"));
            }
          });
        }
      });
    });
  });
}
// Remove unnecessary "Corrected text:" line when it is trivial
function sanitizeModelText(rawText) {
  if (!rawText) return rawText;

  const lines = rawText.split('\n');

  // If the response starts with "Corrected text: ..."
  if (lines[0].match(/^\s*Corrected text\s*:/i)) {

    // Extract what follows after "Corrected text:"
    const corrected = lines[0].replace(/^\s*Corrected text\s*:\s*/i, '').trim();

    // If the corrected line is short, it’s trivial — hide it entirely
    if (corrected.length < 60) {
      return lines.slice(1).join('\n').trim();
    }

    // If meaningful, keep it but limit overly long text
    const trimmed = corrected.length > 200 ? corrected.slice(0, 200) + '…' : corrected;
    return ("Corrected text: " + trimmed + "\n" + lines.slice(1).join('\n')).trim();
  }

  return rawText;
}

function createFloatingWindow(text) {
  
  chrome.storage.local.get(['winState'], (res) => {
    const state = res.winState || { top: 50, left: 50, width: 500, height: 400 };

    const container = document.createElement("div");
    container.style.cssText = `
      position: fixed; top: ${state.top}px; left: ${state.left}px;
      width: ${state.width}px; height: ${state.height}px;
      background: #1e1e1e; color: #d4d4d4;
      border: 1px solid #f55036; border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      z-index: 2147483647; display: flex; flex-direction: column;
      font-family: 'Segoe UI', sans-serif; font-size: 14px;
      resize: both; overflow: hidden; min-width: 200px; min-height: 150px;
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
    const cleaned = sanitizeModelText(text);
    body.innerHTML = parseMarkdown(cleaned);
    
    container.appendChild(body);

    // --- NEW: Add Copy Buttons to Code Blocks ---
    const codeBlocks = body.querySelectorAll("pre");
    codeBlocks.forEach(pre => {
      pre.style.position = "relative"; // Needed to position the button

      const btn = document.createElement("button");
      btn.innerText = "Copy";
      btn.style.cssText = `
        position: absolute; top: 5px; right: 5px;
        background: #f55036; color: white; border: none;
        border-radius: 3px; font-size: 10px; padding: 3px 8px;
        cursor: pointer; opacity: 0.9;
      `;

      btn.onclick = () => {
        const codeText = pre.querySelector("code").innerText;
        navigator.clipboard.writeText(codeText).then(() => {
          btn.innerText = "Copied!";
          setTimeout(() => btn.innerText = "Copy", 2000);
        });
      };

      pre.appendChild(btn);
    });

    // --- NEW: Copy All Button Logic ---
    header.querySelector("#copyAllBtn").onclick = () => {
       navigator.clipboard.writeText(text).then(() => {
         const btn = header.querySelector("#copyAllBtn");
         btn.innerText = "Copied!";
         setTimeout(() => btn.innerText = "Copy All", 2000);
       });
    };

    document.body.appendChild(container);

    // Close Handler
    header.querySelector("#closeGroqBtn").onclick = () => container.remove();

    // Drag Logic
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
      if(e.target.tagName === 'BUTTON') return; // Don't drag if clicking buttons
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
