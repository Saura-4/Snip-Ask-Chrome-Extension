// src/content/ui-helpers.js
// UI utility functions - toasts, text sanitizers, model helpers, loading overlay

/**
 * Global reference for the loading overlay element
 * @type {HTMLElement|null}
 */
let _loadingOverlay = null;

/**
 * Show a full-screen thinking overlay while processing snip
 * Called after user snips the screen, before the response window appears
 */
function showLoadingCursor() {
    // Remove existing overlay if any
    hideLoadingCursor();

    // Create overlay container
    _loadingOverlay = document.createElement('div');
    _loadingOverlay.id = 'snip-loading-overlay';
    _loadingOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 12px;
        animation: overlayFadeIn 0.2s ease;
    `;

    // Container for bubble and text (similar to .typing-container but centered)
    const thinkingContainer = document.createElement('div');
    thinkingContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        opacity: 0.9;
    `;

    // Bubble (matching .typing-bubble)
    const bubble = document.createElement('div');
    bubble.style.cssText = `
        background: #2a2a2a;
        padding: 8px 14px;
        border-radius: 12px;
        display: flex;
        gap: 4px;
        width: fit-content;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    // Create 3 animated dots
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.style.cssText = `
            width: 6px;
            height: 6px;
            background: #666;
            border-radius: 50%;
            animation: bounce 1.4s infinite ease-in-out both;
            animation-delay: ${i === 0 ? '-0.32s' : i === 1 ? '-0.16s' : '0s'};
        `;
        bubble.appendChild(dot);
    }

    // "Thinking..." text (matching .thinking-text)
    const text = document.createElement('span');
    text.textContent = 'Thinking...';
    text.style.cssText = `
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11px;
        color: #ddd;
        font-style: italic;
        animation: thinkingPulse 1.5s infinite;
    `;

    thinkingContainer.appendChild(bubble);
    thinkingContainer.appendChild(text);
    _loadingOverlay.appendChild(thinkingContainer);

    // Add keyframes animation via style tag
    const style = document.createElement('style');
    style.textContent = `
        @keyframes overlayFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes bounce { 
            0%, 80%, 100% { transform: scale(0); } 
            40% { transform: scale(1); background: #f55036; } 
        }
        @keyframes thinkingPulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 1; }
        }
    `;
    _loadingOverlay.appendChild(style);

    document.body.appendChild(_loadingOverlay);
}

/**
 * Hide the loading overlay
 */
function hideLoadingCursor() {
    if (_loadingOverlay) {
        _loadingOverlay.style.animation = 'overlayFadeIn 0.15s ease reverse';
        setTimeout(() => {
            if (_loadingOverlay && _loadingOverlay.parentNode) {
                _loadingOverlay.remove();
            }
            _loadingOverlay = null;
        }, 150);
    }
    // Also remove by ID in case of orphaned overlays
    const existing = document.getElementById('snip-loading-overlay');
    if (existing && existing !== _loadingOverlay) {
        existing.remove();
    }
}


/**
 * Helper to identify Vision Models
 * @param {string} modelName - The model name to check
 * @returns {boolean} - True if the model supports vision/images
 */
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

/**
 * Update local guest usage cache from server response
 * Keeps the frontend counter in sync with server-side usage
 * @param {Object} guestInfo - Guest info from API response
 */
function updateLocalGuestCache(guestInfo) {
    if (!guestInfo) return;
    const today = new Date().toISOString().split('T')[0];
    chrome.storage.local.set({
        guestUsageCount: guestInfo.usage,
        guestUsageDate: today
    });
}

/**
 * Sanitize model response text - removes thinking tags, HTML artifacts, and other model noise
 * IMPORTANT: Preserves code blocks to avoid stripping valid syntax like <iostream>, <vector>, etc.
 * @param {string} rawText - Raw text from model response
 * @returns {string} - Cleaned text
 */
function sanitizeModelText(rawText) {
    if (!rawText) return rawText;

    let text = rawText;

    // --- STEP 1: PROTECT CODE BLOCKS ---
    // Extract code blocks BEFORE HTML stripping to preserve <iostream>, <T>, etc.
    const codeBlocks = [];
    const inlineCodes = [];
    const blockToken = '\x00CODEBLOCK_';
    const inlineToken = '\x00INLINE_';

    // Protect fenced code blocks: ```lang\ncode\n```
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        codeBlocks.push({ lang, code });
        return `${blockToken}${codeBlocks.length - 1}\x00`;
    });

    // Protect inline code: `code`
    text = text.replace(/`([^`]+)`/g, (match, code) => {
        inlineCodes.push(code);
        return `${inlineToken}${inlineCodes.length - 1}\x00`;
    });

    // --- STEP 2: STRIP MODEL ARTIFACTS ---
    // Strip <think>...</think> blocks from Qwen/DeepSeek models
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    text = text.replace(/<think>[\s\S]*$/gi, '').trim();

    // Strip malformed JSON artifacts
    text = text.replace(/<\?\s*\{[^}]*\}?\s*/gi, '').trim();

    // Strip other model artifacts
    text = text.replace(/<\|.*?\|>/g, '').trim();
    text = text.replace(/\[INST\][\s\S]*?\[\/INST\]/gi, '').trim();
    text = text.replace(/<\|im_start\|>[\s\S]*?<\|im_end\|>/gi, '').trim();

    // --- STEP 3: STRIP HTML TAGS (code blocks are protected) ---
    // Strip style/script blocks entirely
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

    // Repeatedly strip HTML tags until none remain
    let prevText;
    let iterations = 0;
    const maxIterations = 10;

    do {
        prevText = text;
        iterations++;
        // Strip opening tags with attributes: <code style="...">
        text = text.replace(/<[a-z][a-z0-9]*\s+[^>]*>/gi, '');
        // Strip simple opening tags: <code>
        text = text.replace(/<[a-z][a-z0-9]*>/gi, '');
        // Strip closing tags: </code>
        text = text.replace(/<\/[a-z][a-z0-9]*>/gi, '');
        // Strip self-closing tags: <br/>
        text = text.replace(/<[a-z][a-z0-9]*\s*\/>/gi, '');
    } while (text !== prevText && iterations < maxIterations);

    // Catch remaining HTML-like patterns
    text = text.replace(/<\/?[a-z][^>]*>/gi, '');

    // Clean up excessive horizontal whitespace (preserve newlines)
    text = text.replace(/[^\S\r\n]{3,}/g, '  ').trim();

    // --- STEP 4: RESTORE CODE BLOCKS ---
    // Restore fenced code blocks
    text = text.replace(new RegExp(`${blockToken.replace(/\x00/g, '\\x00')}(\\d+)\\x00`, 'g'), (match, index) => {
        const block = codeBlocks[parseInt(index)];
        return block ? `\`\`\`${block.lang}\n${block.code}\`\`\`` : match;
    });

    // Restore inline code
    text = text.replace(new RegExp(`${inlineToken.replace(/\x00/g, '\\x00')}(\\d+)\\x00`, 'g'), (match, index) => {
        const code = inlineCodes[parseInt(index)];
        return code !== undefined ? `\`${code}\`` : match;
    });

    // --- STEP 5: CLEANUP ---
    const lines = text.split('\n');
    if (lines[0].match(/^\s*Corrected text\s*:/i)) {
        const corrected = lines[0].replace(/^\s*Corrected text\s*:\s*/i, '').trim();
        if (corrected.length < 60) {
            return lines.slice(1).join('\n').trim();
        }
        const trimmed = corrected.length > 200 ? corrected.slice(0, 200) + '…' : corrected;
        return ("Corrected text: " + trimmed + "\n" + lines.slice(1).join('\n')).trim();
    }

    return text;
}

/**
 * Show an error toast notification with smart action buttons
 * @param {string} message - Error message to display
 */
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
