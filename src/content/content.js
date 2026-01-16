// src/content/content.js

let startX, startY, selectionBox, glassPane;
let isSelecting = false;

// Compare Windows System
let chatWindows = []; // Array of FloatingChatUI instances
let pendingResponses = 0; // Track responses for synchronized follow-up
let maxCompareWindows = 4; // Default limit, loaded from storage

// Window Management Functions

// Global Escape Key Handler
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && chatWindows.length > 0) {
        // Don't close if user is typing in a page input
        const active = document.activeElement;
        const isInput = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;

        // Check if the input belongs to our extension (shadow DOM host)
        // If active element is a chat host, we DO want to close
        const isChatHost = active.id === 'groq-chat-host'; // Host div ID

        if (isInput && !isChatHost) {
            return; // Allow page interaction
        }

        // Close all chat windows
        // Create a copy since close() modifies the array
        [...chatWindows].forEach(w => w.close());
    }
});

// Page unload cleanup - close all chat windows when navigating away
window.addEventListener('beforeunload', () => {
    [...chatWindows].forEach(w => w.close());
});

function registerWindow(ui) {
    chatWindows.push(ui);
    autoPositionWindow(ui, chatWindows.length - 1);
}

function unregisterWindow(ui) {
    const idx = chatWindows.indexOf(ui);
    if (idx > -1) chatWindows.splice(idx, 1);
}

function autoPositionWindow(ui, index) {
    const width = 420;
    const gap = 30;

    setTimeout(() => {
        if (!ui.container) return;

        if (index === 0) {
            // Main window: use saved position or default to top-right
            // loadState() will be called and restore position, don't override
            // Just set a default right-aligned position if no saved state
            if (!ui.hasSavedPosition) {
                ui.container.style.right = '50px';
                ui.container.style.left = 'auto';
                ui.container.style.top = '50px';
            }
        } else {
            // Compare windows: spawn to the LEFT of existing windows
            // Calculate position based on rightmost window
            const rightEdge = window.innerWidth - 50;
            const posX = rightEdge - (index + 1) * (width + gap);
            ui.container.style.left = Math.max(20, posX) + 'px';
            ui.container.style.right = 'auto';
            ui.container.style.top = '50px';
        }
    }, 50);
}

function broadcastFollowUp(text, senderUI) {
    if (chatWindows.length <= 1) {
        // Single window mode - just send normally
        senderUI.sendMessageDirect(text);
        return;
    }
    // Multi-window mode - sync all
    // Mark the total window count for rate limiting purposes
    const windowCount = chatWindows.length;
    pendingResponses = windowCount;
    chatWindows.forEach(w => w.setInputDisabled(true));
    
    // First window is the "primary" and counts for all windows
    // Other windows are "companions" and don't increment the counter
    chatWindows.forEach((w, index) => {
        w.sendMessageDirect(text, index === 0 ? windowCount : 0);
    });
}

function onResponseReceived() {
    if (chatWindows.length <= 1) return;
    pendingResponses--;
    if (pendingResponses <= 0) {
        pendingResponses = 0;
        chatWindows.forEach(w => w.setInputDisabled(false));
    }
}

// Helper to update local demo usage cache from server response
// This keeps the frontend counter in sync with server-side usage
function updateLocalDemoCache(demoInfo) {
    if (!demoInfo) return;
    const today = new Date().toISOString().split('T')[0];
    chrome.storage.local.set({
        guestUsageCount: demoInfo.usage,
        guestUsageDate: today
    });
}

// Load max windows setting
chrome.storage.local.get(['maxCompareWindows'], (res) => {
    if (res.maxCompareWindows) maxCompareWindows = res.maxCompareWindows;
});

// Helper to identify Vision Models
function isVisionModel(modelName) {
    if (!modelName) return false;
    const lower = modelName.toLowerCase();
    return lower.includes("llama-4") ||
        lower.includes("vision") ||
        lower.includes("gemini") ||
        lower.includes("gemma") ||
        lower.includes("llava") ||
        lower.includes("moondream") ||
        lower.includes("minicpm");
}

// 1. Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_SNIP") {
        if (isSelecting) return true;
        isSelecting = true;

        createGlassPane();
        createSelectionBox();

        sendResponse({ status: "Snip started" });
    }

    // Handle text selection from context menu
    if (request.action === "SHOW_AI_RESPONSE_FOR_TEXT") {
        if (typeof showLoadingCursor === 'function') showLoadingCursor();

        chrome.runtime.sendMessage({
            action: "ASK_AI_TEXT",
            text: request.text
        }, handleResponse);

        sendResponse({ status: "Processing text" });
    }

    return true;
});

// 2. Selection UI Logic
function createGlassPane() {
    glassPane = document.createElement("div");
    glassPane.setAttribute("tabindex", "-1");

    glassPane.style.cssText = `
        position: fixed; 
        top: 0; left: 0; 
        width: 100vw; height: 100vh; 
        z-index: 2147483647; 
        cursor: crosshair; 
        background: rgba(0,0,0,0.01); 
        transform: translateZ(100px);
        outline: none;
    `;

    document.documentElement.appendChild(glassPane);
    glassPane.focus();
    glassPane.addEventListener("mousedown", onMouseDown);

    // Accessibility: Allow Escape key to cancel snipping
    glassPane.addEventListener("keydown", onKeyDown);

    // Visual cancel button for safety (in case Escape key doesn't work)
    const cancelBtn = document.createElement("button");
    cancelBtn.id = "snip-cancel-btn";
    cancelBtn.textContent = "✕ Cancel (Esc)";
    cancelBtn.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        background: #1e1e1e;
        color: #f55036;
        border: 1px solid #f55036;
        padding: 8px 16px;
        border-radius: 6px;
        font-family: 'Segoe UI', sans-serif;
        font-size: 14px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    `;
    cancelBtn.onclick = cancelSnipping;
    glassPane.appendChild(cancelBtn);

    // Safety timeout: auto-cancel after 30 seconds to prevent trapping users
    window._snipSafetyTimeout = setTimeout(() => {
        if (glassPane && isSelecting) {
            console.warn("Snip & Ask: Safety timeout triggered - cancelling snip mode");
            cancelSnipping();
        }
    }, 30000);
}

function onKeyDown(e) {
    if (e.key === "Escape") {
        cancelSnipping();
    }
}

function cancelSnipping() {
    // Clear safety timeout
    if (window._snipSafetyTimeout) {
        clearTimeout(window._snipSafetyTimeout);
        window._snipSafetyTimeout = null;
    }

    // Clean up selection UI
    if (selectionBox) {
        selectionBox.remove();
        selectionBox = null;
    }
    if (glassPane) {
        glassPane.removeEventListener("mousedown", onMouseDown);
        glassPane.removeEventListener("mousemove", onMouseMove);
        glassPane.removeEventListener("mouseup", onMouseUp);
        glassPane.removeEventListener("keydown", onKeyDown);
        glassPane.remove();
        glassPane = null;
    }
    isSelecting = false;

    // If in snip-again mode, restore chat windows
    if (window._snipAgainMode) {
        window._snipAgainMode = false;
        window._snipAgainTarget = null;
        chatWindows.forEach(w => {
            if (w.container) w.container.style.display = 'flex';
        });
    }
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
    e.stopPropagation();

    startX = e.clientX;
    startY = e.clientY;

    selectionBox.style.left = startX + "px";
    selectionBox.style.top = startY + "px";
    selectionBox.style.width = "0px";
    selectionBox.style.height = "0px";
    selectionBox.style.display = "block";

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
    glassPane.removeEventListener("mousemove", onMouseMove);
    glassPane.removeEventListener("mouseup", onMouseUp);
    glassPane.removeEventListener("mousedown", onMouseDown);

    const rect = selectionBox.getBoundingClientRect();

    selectionBox.remove();
    glassPane.remove();
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

            // Show first-time privacy toast (only once per user)
            chrome.storage.local.get(['hasShownSnipToast'], (res) => {
                if (!res.hasShownSnipToast) {
                    chrome.storage.local.set({ hasShownSnipToast: true });
                    const toast = document.createElement('div');
                    toast.textContent = '📸 Screenshot captured locally (not stored)';
                    toast.style.cssText = `
                        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                        background: #2d2d2d; color: #ccc; padding: 10px 20px;
                        border-radius: 8px; font-family: 'Segoe UI', sans-serif;
                        z-index: 2147483647; border: 1px solid #f55036;
                    `;
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 3000);
                }
            });

            // Check if this is a snip-again (add to existing chat)
            if (window._snipAgainMode && window._snipAgainTarget) {
                window._snipAgainMode = false;
                const targetUI = window._snipAgainTarget;
                window._snipAgainTarget = null;

                if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                targetUI.addSnippedImage(croppedBase64);
                return;
            }

            // === SECURITY: Ask background.js to check provider config (keys never touch content script) ===
            chrome.runtime.sendMessage({ action: "CHECK_PROVIDER_CONFIG" }, async (configResult) => {
                if (chrome.runtime.lastError || !configResult?.success) {
                    showErrorToast("Failed to check configuration. Please reload the page.");
                    if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                    return;
                }

                const currentModel = configResult.model;

                if (!configResult.isConfigured) {
                    showErrorToast(`Please set your ${configResult.providerName} in the extension popup!`);
                    if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                    chrome.runtime.sendMessage({ action: "OPEN_OPTIONS_PAGE" });
                    return;
                }

                // === PATH A: VISION MODEL (Direct Image) ===
                if (isVisionModel(currentModel)) {
                    chrome.runtime.sendMessage({
                        action: "ASK_AI",
                        // SECURITY: API keys are retrieved from storage in background.js
                        model: currentModel,
                        base64Image: croppedBase64
                    }, handleResponse);
                    return;
                }

                // === PATH B: TEXT MODEL (Engage OCR via Background) ===

                chrome.runtime.sendMessage({
                    action: "PERFORM_OCR",
                    base64Image: croppedBase64
                }, (ocrResponse) => {

                    if (chrome.runtime.lastError || !ocrResponse) {
                        showErrorToast("OCR Failed: " + (chrome.runtime.lastError?.message || "Unknown error"));
                        if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                        return;
                    }

                    // Handle OCR quality failures with helpful messages
                    if (!ocrResponse.success && ocrResponse.error) {
                        console.warn("OCR Quality Check Failed:", ocrResponse.error);
                        // Fall through to vision model fallback or show error
                    }

                    if (ocrResponse.success && ocrResponse.text && ocrResponse.text.length > 3) {
                        // Log if text was truncated to save tokens
                        if (ocrResponse.wasTruncated) {
                            console.log(`OCR text was truncated to save API tokens: ${ocrResponse.stats?.originalLength} → ${ocrResponse.stats?.cleanedLength} chars`);
                        }

                        chrome.runtime.sendMessage({
                            action: "ASK_AI_TEXT",
                            // SECURITY: API keys are retrieved from storage in background.js
                            model: currentModel,
                            text: ocrResponse.text,
                            ocrConfidence: ocrResponse.confidence
                        }, handleResponse);
                    } else {
                        console.warn("OCR Empty or Failed:", ocrResponse.error || 'No readable text');
                        if (isVisionModel(currentModel)) {
                            // Retry as image if OCR fails (fallback)
                            chrome.runtime.sendMessage({
                                action: "ASK_AI",
                                // SECURITY: API keys are retrieved from storage in background.js
                                model: currentModel,
                                base64Image: croppedBase64
                            }, handleResponse);
                        } else {
                            alert(`⚠️ No text found in snippet.\n\nSince '${currentModel}' cannot see images, please try snipping clearer text or switch to a Vision model.`);
                            if (typeof hideLoadingCursor === 'function') hideLoadingCursor();
                        }
                    }
                });
            });
        });
    });
}

// 4. Response Handler
async function handleResponse(apiResponse) {
    if (typeof hideLoadingCursor === 'function') hideLoadingCursor();

    if (apiResponse && apiResponse.success) {
        // Close all existing chat windows on new snip
        chatWindows.forEach(w => w.close());
        chatWindows = [];

        const ui = await FloatingChatUI.create();
        registerWindow(ui);
        ui.addMessage('user', apiResponse.initialUserMessage);
        ui.addMessage('assistant', apiResponse.answer);

        // Store initial state for comparison cloning
        ui.initialUserMessage = apiResponse.initialUserMessage;
        // Store base64 image for compare windows (vision models need this)
        ui.initialBase64Image = apiResponse.base64Image || null;
        
        // Update local demo usage cache if demoInfo is returned
        if (apiResponse.demoInfo) {
            updateLocalDemoCache(apiResponse.demoInfo);
        }
    } else {
        // Show error in a styled toast instead of native alert
        showErrorToast(apiResponse ? apiResponse.error : "Unknown error");
    }
}

// Error toast notification with smart action buttons
function showErrorToast(message) {
    const existing = document.getElementById('snip-error-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'snip-error-toast';
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 2147483647;
        padding: 15px 20px; background: #1e1e1e; color: #f55036;
        border: 1px solid #f55036; border-radius: 8px;
        font-family: 'Segoe UI', sans-serif; font-size: 14px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        animation: slideIn 0.3s ease;
        max-width: 350px;
    `;

    // Check if this is an API key error
    const isKeyError = message.toLowerCase().includes('api key') ||
        message.toLowerCase().includes('invalid') ||
        message.toLowerCase().includes('401') ||
        message.toLowerCase().includes('unauthorized');

    if (isKeyError) {
        toast.innerHTML = `
            <div style="margin-bottom: 8px;">⚠️ ${message}</div>
            <div style="font-size: 12px; color: #ccc;">
                Click the extension icon to update your API key.
            </div>
        `;
    } else {
        toast.textContent = '⚠️ ' + message;
    }

    document.body.appendChild(toast);

    // Auto-remove after 6 seconds for key errors (longer to read), 5 for others
    setTimeout(() => toast.remove(), isKeyError ? 6000 : 5000);

    // Allow clicking to dismiss
    toast.style.cursor = 'pointer';
    toast.addEventListener('click', () => toast.remove());
}

// 5. HELPER: Text Sanitizer
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

// 6. UI CLASS (Robust State Management)
class FloatingChatUI {
    constructor() {
        this.chatHistory = [];
        this.currentModel = null;
        this.availableModels = [];
        this.isMinimized = false;
    }

    // Static factory method for async initialization
    static async create() {
        const ui = new FloatingChatUI();
        await ui.initModel();
        ui.createWindow();
        ui.loadState();
        return ui;
    }

    async initModel() {
        const result = await new Promise(resolve => {
            chrome.storage.local.get(['selectedModel', 'enabledProviders', 'enabledModels'], resolve);
        });
        this.currentModel = result.selectedModel || 'meta-llama/llama-4-scout-17b-16e-instruct';

        // Build available models list from enabled providers
        const ALL_MODELS = {
            groq: [
                { value: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout' },
                { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick' },
                { value: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
                { value: 'qwen/qwen3-32b', name: 'Qwen 3 32B' }
            ],
            google: [
                { value: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
                { value: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
                { value: 'gemma-3-27b-it', name: 'Gemma 3 27B' }
            ],
            openrouter: [
                { value: 'openrouter:deepseek/deepseek-r1-0528:free', name: 'DeepSeek R1' }
            ],
            ollama: [
                { value: 'ollama:llama3', name: 'Ollama Llama 3' },
                { value: 'ollama:gemma3:4b', name: 'Ollama Gemma 3' }
            ]
        };

        const enabledProviders = result.enabledProviders || { groq: true };
        const enabledModels = result.enabledModels || {};

        this.availableModels = [];
        for (const [provider, models] of Object.entries(ALL_MODELS)) {
            if (enabledProviders[provider]) {
                models.forEach(m => {
                    if (enabledModels[m.value] !== false) {
                        this.availableModels.push(m);
                    }
                });
            }
        }
    }

    close() {
        // Cleanup bubble drag listeners to prevent memory leaks
        if (this._bubbleCleanup) {
            this._bubbleCleanup();
            this._bubbleCleanup = null;
        }
        if (this.host) {
            this.host.remove();
            this.host = null;
        }
        unregisterWindow(this);
    }

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
            childDisplays: [] // Store each child's display value
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
                // Fallback: remove display override
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

    makeBubbleDraggable(bubble) {
        let isDragging = false;
        let offsetX, offsetY;

        bubble.addEventListener('mousedown', (e) => {
            // Don't start drag on the expand button
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

    createWindow() {
        this.host = document.createElement("div");
        this.host.id = "groq-chat-host";
        this.host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;";

        this.shadow = this.host.attachShadow({ mode: 'closed' });

        this.container = document.createElement("div");
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

        // Header with model selector
        const header = document.createElement("div");
        header.style.cssText = `
            padding: 10px 12px; background: #2d2d2d; border-bottom: 1px solid #454545;
            cursor: move; display: flex; justify-content: space-between; align-items: center;
            border-radius: 10px 10px 0 0; user-select: none; gap: 8px;
        `;

        const titleSection = document.createElement("div");
        titleSection.style.cssText = "display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;";
        titleSection.innerHTML = `<strong style="color: #f55036; white-space: nowrap;">⚡</strong>`;

        // Model selector dropdown
        this.modelSelect = document.createElement("select");
        this.modelSelect.style.cssText = `
            background: #1e1e1e; color: #ccc; border: 1px solid #454545; 
            border-radius: 4px; padding: 4px 8px; font-size: 12px;
            cursor: pointer; flex: 1; min-width: 0; max-width: 200px;
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
        header.appendChild(titleSection);

        // Snip Again button
        const snipAgainBtn = document.createElement("button");
        snipAgainBtn.textContent = "📷";
        snipAgainBtn.title = "Snip and add to this chat";
        snipAgainBtn.style.cssText = `
            background: #3a3a3a; color: #ccc; border: 1px solid #555;
            width: 28px; height: 24px; border-radius: 4px; cursor: pointer;
            font-size: 14px; line-height: 1;
        `;
        snipAgainBtn.onclick = () => this.startSnipAgain();
        header.appendChild(snipAgainBtn);

        // Compare button
        const compareBtn = document.createElement("button");
        compareBtn.textContent = "+";
        compareBtn.title = "Compare with another model";
        compareBtn.style.cssText = `
            background: #3a3a3a; color: #f55036; border: 1px solid #f55036;
            width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
            font-weight: bold; font-size: 16px; line-height: 1;
        `;
        compareBtn.onclick = () => this.spawnCompareWindow();
        header.appendChild(compareBtn);

        // Minimize button
        const minimizeBtn = document.createElement("button");
        minimizeBtn.textContent = "−";
        minimizeBtn.title = "Minimize to bubble";
        minimizeBtn.style.cssText = `
            background: #3a3a3a; color: #ccc; border: 1px solid #555;
            width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
            font-weight: bold; font-size: 18px; line-height: 1;
        `;
        minimizeBtn.onclick = () => this.minimize();
        header.appendChild(minimizeBtn);

        const closeBtn = document.createElement("span");
        closeBtn.id = "closeBtn";
        closeBtn.textContent = "✖";
        closeBtn.style.cssText = "cursor: pointer; color: #888; font-weight: bold; font-size: 16px; margin-left: 8px;";
        header.appendChild(closeBtn);

        this.container.appendChild(header);

        // Chat Body
        this.chatBody = document.createElement("div");
        this.chatBody.style.cssText = `
            flex-grow: 1; overflow-y: auto; padding: 15px; 
            display: flex; flex-direction: column; gap: 15px;
            background: #1e1e1e; scrollbar-width: thin; scrollbar-color: #444 #1e1e1e;
        `;
        this.container.appendChild(this.chatBody);

        // Input Area
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

    addMessage(role, content, modelName = null) {
        // Track model name for assistant messages
        const msgModel = role === 'assistant' ? (modelName || this.currentModel) : null;

        // ALWAYS store string content in chatHistory for compatibility with all models
        let historyContent = content;
        if (typeof content !== 'string') {
            // Extract text from complex objects (vision model messages)
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
        msgDiv.style.cssText = `max-width: 90%; padding: 10px 12px; border-radius: 8px; line-height: 1.5; word-wrap: break-word; font-size: 13px;`;

        if (role === 'user') {
            msgDiv.style.alignSelf = "flex-end"; msgDiv.style.background = "#3a3a3a"; msgDiv.style.color = "#ececec";
            if (typeof content === 'object' && content.content) {
                const textPart = Array.isArray(content.content) ? content.content.find(c => c.type === 'text') : { text: content.content };
                // SECURITY: Use DOM methods instead of innerHTML to prevent XSS
                const em = document.createElement('em');
                em.textContent = '(Snippet)';
                msgDiv.appendChild(em);
                msgDiv.appendChild(document.createElement('br'));
                msgDiv.appendChild(document.createTextNode(textPart ? textPart.text : ''));
            } else { msgDiv.innerText = content; }
        } else {
            msgDiv.style.alignSelf = "flex-start"; msgDiv.style.background = "#2d2d2d"; msgDiv.style.borderLeft = "3px solid #f55036";

            // Add model label for assistant messages
            const modelLabel = this._getModelDisplayName(msgModel);
            const labelDiv = document.createElement("div");
            labelDiv.style.cssText = "font-size: 10px; color: #888; margin-bottom: 6px; font-weight: 500;";
            labelDiv.textContent = `🤖 ${modelLabel}`;
            msgDiv.appendChild(labelDiv);

            const contentDiv = document.createElement("div");
            const cleanText = sanitizeModelText(content);
            if (typeof parseMarkdown === 'function') contentDiv.innerHTML = parseMarkdown(cleanText);
            else contentDiv.innerText = cleanText;
            msgDiv.appendChild(contentDiv);

            const codeBlocks = msgDiv.querySelectorAll("pre");
            codeBlocks.forEach(pre => {
                pre.style.position = "relative";
                const btn = document.createElement("button");
                btn.innerText = "Copy";
                btn.style.cssText = `position: absolute; top: 5px; right: 5px; background: #f55036; color: white; border: none; border-radius: 3px; font-size: 10px; padding: 3px 8px; cursor: pointer; opacity: 0.9;`;
                btn.onclick = () => {
                    // Use textContent from <code> element specifically (more reliable than innerText)
                    // This avoids including button text and preserves formatting better
                    const codeEl = pre.querySelector("code");
                    const codeText = codeEl ? codeEl.textContent : pre.textContent.replace(/^Copy$|^Copied!$/gm, '').trim();
                    navigator.clipboard.writeText(codeText).then(() => { btn.innerText = "Copied!"; setTimeout(() => btn.innerText = "Copy", 2000); });
                };
                pre.appendChild(btn);
            });

            // Action buttons for assistant messages (Copy Response, Regenerate)
            const actionsDiv = document.createElement("div");
            actionsDiv.style.cssText = "display: flex; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #3a3a3a;";

            // Copy entire response button
            const copyBtn = document.createElement("button");
            copyBtn.innerHTML = "📋 Copy";
            copyBtn.title = "Copy entire response";
            copyBtn.style.cssText = "background: transparent; color: #888; border: 1px solid #444; padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;";
            copyBtn.onclick = () => {
                const responseText = contentDiv.textContent;
                navigator.clipboard.writeText(responseText).then(() => {
                    copyBtn.innerHTML = "✓ Copied";
                    setTimeout(() => copyBtn.innerHTML = "📋 Copy", 2000);
                });
            };
            actionsDiv.appendChild(copyBtn);

            // Regenerate button
            const regenBtn = document.createElement("button");
            regenBtn.innerHTML = "🔄 Regenerate";
            regenBtn.title = "Get a new response";
            regenBtn.style.cssText = "background: transparent; color: #888; border: 1px solid #444; padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;";
            regenBtn.onclick = () => this.regenerateLastResponse();
            actionsDiv.appendChild(regenBtn);

            // Retry button for error messages
            if (content.includes('⚠️') || content.toLowerCase().includes('error')) {
                const retryBtn = document.createElement("button");
                retryBtn.innerHTML = "🔁 Retry";
                retryBtn.title = "Retry failed request";
                retryBtn.style.cssText = "background: #f55036; color: white; border: none; padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;";
                retryBtn.onclick = () => this.retryLastRequest();
                actionsDiv.appendChild(retryBtn);
            }

            msgDiv.appendChild(actionsDiv);
        }
        this.chatBody.appendChild(msgDiv);
        this.chatBody.scrollTop = this.chatBody.scrollHeight;
    }

    _getModelDisplayName(modelValue) {
        if (!modelValue) return 'AI';
        // Find in available models or generate from value
        const found = this.availableModels.find(m => m.value === modelValue);
        if (found) return found.name;
        // Fallback: extract last part of model ID
        const parts = modelValue.split(/[/:]/);
        return parts[parts.length - 1] || 'AI';
    }

    // Regenerate the last assistant response
    async regenerateLastResponse() {
        // Find the last user message in history
        let lastUserMsgIndex = -1;
        for (let i = this.chatHistory.length - 1; i >= 0; i--) {
            if (this.chatHistory[i].role === 'user') {
                lastUserMsgIndex = i;
                break;
            }
        }

        if (lastUserMsgIndex === -1) return;

        // Remove the last assistant message from history and UI
        if (this.chatHistory.length > lastUserMsgIndex + 1) {
            this.chatHistory.pop();
            const lastMsgDiv = this.chatBody.lastElementChild;
            if (lastMsgDiv) lastMsgDiv.remove();
        }

        // Re-send the last user message
        const lastUserMsg = this.chatHistory[lastUserMsgIndex].content;
        const historyUpToLastUser = this.chatHistory.slice(0, lastUserMsgIndex + 1);

        const loadingDiv = document.createElement("div");
        loadingDiv.innerText = `🔄 ${this._getModelDisplayName(this.currentModel)} is regenerating...`;
        loadingDiv.style.cssText = "align-self: flex-start; color: #888; font-style: italic; font-size: 12px;";
        this.chatBody.appendChild(loadingDiv);
        this.chatBody.scrollTop = this.chatBody.scrollHeight;

        try {
            let response;

            // Check if this is a vision model AND we have the original image
            // For initial snip regeneration, we need to use the image
            if (isVisionModel(this.currentModel) && this.initialBase64Image && lastUserMsgIndex === 0) {
                // Vision model with original image - re-send the image
                response = await chrome.runtime.sendMessage({
                    action: "ASK_AI",
                    model: this.currentModel,
                    base64Image: this.initialBase64Image
                });
            } else {
                // Text-based regeneration via chat history
                response = await chrome.runtime.sendMessage({
                    action: "CONTINUE_CHAT",
                    model: this.currentModel,
                    history: historyUpToLastUser.map(m => ({ role: m.role, content: m.content }))
                });
            }
            loadingDiv.remove();
            if (response && response.success) {
                this.addMessage('assistant', response.answer, this.currentModel);
                // Update local demo usage cache if demoInfo is returned
                if (response.demoInfo) {
                    updateLocalDemoCache(response.demoInfo);
                }
            } else {
                this.addMessage('assistant', "⚠️ Regenerate failed: " + (response?.error || "Unknown error"), this.currentModel);
            }
        } catch (e) {
            loadingDiv.remove();
            this.addMessage('assistant', "⚠️ Network Error: " + e.message, this.currentModel);
        }
    }

    // Retry the last request (for error recovery)
    async retryLastRequest() {
        // Same as regenerate - replay the last user message
        await this.regenerateLastResponse();
    }

    // === SNIP AGAIN FUNCTIONALITY ===

    async startSnipAgain() {
        // Store reference to this chat for callback
        window._snipAgainTarget = this;

        // Minimize all chat windows temporarily
        chatWindows.forEach(w => {
            if (w.container) w.container.style.display = 'none';
        });

        // Start the snip process
        createGlassPane();
        createSelectionBox();
        isSelecting = true;

        // Override the normal response handler for snip-again mode
        window._snipAgainMode = true;
    }

    addSnippedImage(croppedBase64) {
        // Show all windows again
        chatWindows.forEach(w => {
            if (w.container) w.container.style.display = 'flex';
        });

        // Broadcast the new image to ALL windows
        chatWindows.forEach(w => {
            w._processSnippedImage(croppedBase64);
        });
    }

    _processSnippedImage(croppedBase64) {
        // Add loading indicator
        const loadingDiv = document.createElement("div");
        loadingDiv.innerText = `🤖 ${this._getModelDisplayName(this.currentModel)} is analyzing new image...`;
        loadingDiv.style.cssText = "align-self: flex-start; color: #888; font-style: italic; font-size: 12px;";
        this.chatBody.appendChild(loadingDiv);
        this.chatBody.scrollTop = this.chatBody.scrollHeight;

        // Add user message indicator
        this.addMessage('user', '(New screenshot added)');

        // Handle vision vs non-vision models differently
        if (isVisionModel(this.currentModel)) {
            // Vision model: send image directly
            chrome.runtime.sendMessage({
                action: "ASK_AI",
                model: this.currentModel,
                base64Image: croppedBase64
            }, (response) => {
                loadingDiv.remove();
                if (response && response.success) {
                    this.addMessage('assistant', response.answer, this.currentModel);
                    // Update local demo usage cache if demoInfo is returned
                    if (response.demoInfo) {
                        updateLocalDemoCache(response.demoInfo);
                    }
                } else {
                    this.addMessage('assistant', "⚠️ Error: " + (response?.error || "Unknown error"), this.currentModel);
                }
            });
        } else {
            // Non-vision model: run OCR first
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
                        loadingDiv.remove();
                        if (response && response.success) {
                            this.addMessage('assistant', response.answer, this.currentModel);
                            // Update local demo usage cache if demoInfo is returned
                            if (response.demoInfo) {
                                updateLocalDemoCache(response.demoInfo);
                            }
                        } else {
                            this.addMessage('assistant', "⚠️ Error: " + (response?.error || "Unknown error"), this.currentModel);
                        }
                    });
                } else {
                    loadingDiv.remove();
                    this.addMessage('assistant', "⚠️ OCR failed - no text extracted from image", this.currentModel);
                }
            });
        }
    }

    // === COMPARE WINDOWS FUNCTIONALITY ===

    async spawnCompareWindow() {
        if (chatWindows.length >= maxCompareWindows) {
            showErrorToast(`Maximum ${maxCompareWindows} comparison windows allowed`);
            return;
        }

        const newUI = await FloatingChatUI.create();
        registerWindow(newUI);

        if (this.initialUserMessage) {
            newUI.initialUserMessage = this.initialUserMessage;
            newUI.initialBase64Image = this.initialBase64Image; // Copy for nested comparisons
            newUI.addMessage('user', this.initialUserMessage);

            const otherModel = this._getNextAvailableModel();
            if (otherModel && newUI.modelSelect) {
                newUI.currentModel = otherModel;
                newUI.modelSelect.value = otherModel;
            }

            const loadingDiv = document.createElement("div");
            loadingDiv.innerText = `🤖 ${newUI._getModelDisplayName(newUI.currentModel)} is thinking...`;
            loadingDiv.style.cssText = "align-self: flex-start; color: #888; font-style: italic; font-size: 12px;";
            newUI.chatBody.appendChild(loadingDiv);

            try {
                let response;

                // Check if the new model is a vision model and we have an image
                if (isVisionModel(newUI.currentModel) && this.initialBase64Image) {
                    // Vision model: send the actual image
                    response = await chrome.runtime.sendMessage({
                        action: "ASK_AI",
                        model: newUI.currentModel,
                        base64Image: this.initialBase64Image
                    });
                } else if (!isVisionModel(newUI.currentModel) && this.initialBase64Image) {
                    // Non-vision model BUT we have an image: run OCR first
                    const ocrResult = await chrome.runtime.sendMessage({
                        action: "PERFORM_OCR",
                        base64Image: this.initialBase64Image
                    });

                    if (ocrResult && ocrResult.success && ocrResult.text) {
                        response = await chrome.runtime.sendMessage({
                            action: "ASK_AI_TEXT",
                            model: newUI.currentModel,
                            text: ocrResult.text
                        });
                    } else {
                        response = { success: false, error: "OCR failed - no text extracted from image" };
                    }
                } else {
                    // No image available: use text content from history
                    let msgContent = this.initialUserMessage;
                    if (typeof msgContent === 'object') {
                        if (Array.isArray(msgContent.content)) {
                            const textPart = msgContent.content.find(c => c.type === 'text');
                            msgContent = textPart ? textPart.text : 'Analyze this content';
                        } else if (typeof msgContent.content === 'string') {
                            msgContent = msgContent.content;
                        } else {
                            msgContent = 'Analyze this content';
                        }
                    }

                    response = await chrome.runtime.sendMessage({
                        action: "CONTINUE_CHAT",
                        model: newUI.currentModel,
                        history: [{ role: 'user', content: msgContent }]
                    });
                }

                loadingDiv.remove();
                if (response && response.success) {
                    newUI.addMessage('assistant', response.answer, newUI.currentModel);
                    // Update local demo usage cache if demoInfo is returned
                    if (response.demoInfo) {
                        updateLocalDemoCache(response.demoInfo);
                    }
                } else {
                    newUI.addMessage('assistant', "⚠️ Error: " + (response?.error || "Unknown error"), newUI.currentModel);
                }
            } catch (e) {
                loadingDiv.remove();
                newUI.addMessage('assistant', "⚠️ Network Error: " + e.message, newUI.currentModel);
            }
        }
    }

    _getNextAvailableModel() {
        const usedModels = chatWindows.map(w => w.currentModel);
        for (const m of this.availableModels) {
            if (!usedModels.includes(m.value)) return m.value;
        }
        return this.availableModels.find(m => m.value !== this.currentModel)?.value || null;
    }

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

    async sendMessageDirect(text, parallelCount = 1) {
        this.addMessage('user', text);

        const loadingDiv = document.createElement("div");
        loadingDiv.innerText = `🤖 ${this._getModelDisplayName(this.currentModel)} is thinking...`;
        loadingDiv.style.cssText = "align-self: flex-start; color: #888; font-style: italic; font-size: 12px;";
        this.chatBody.appendChild(loadingDiv);
        this.chatBody.scrollTop = this.chatBody.scrollHeight;

        const modelToUse = this.currentModel;
        // History is guaranteed to be strings (normalized in addMessage)
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
                parallelCount: parallelCount // How many parallel requests (0 = don't count this one)
            });
            loadingDiv.remove();
            if (response && response.success) {
                this.addMessage('assistant', response.answer, modelToUse);
                // Update local demo usage cache if demoInfo is returned
                if (response.demoInfo) {
                    updateLocalDemoCache(response.demoInfo);
                }
            } else {
                this.addMessage('assistant', "⚠️ Error: " + (response?.error || "Unknown error"), modelToUse);
            }
        } catch (e) {
            loadingDiv.remove();
            this.addMessage('assistant', "⚠️ Network Error: " + e.message, modelToUse);
        }
        onResponseReceived();
    }

    async handleSend() {
        const text = this.input.value.trim();
        if (!text) return;
        this.input.value = ""; this.input.style.height = 'auto';
        broadcastFollowUp(text, this);
    }

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

    loadState() {
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

                this.hasSavedPosition = true;
            } else {
                // Default to top-right corner
                this.container.style.top = "50px";
                this.container.style.right = "50px";
                this.container.style.left = "auto";
                this.hasSavedPosition = false;
            }
        });
    }
}