// src/content/ui-helpers.js
// UI utility functions - toasts, text sanitizers, model helpers, loading overlay

/**
 * Global reference for the loading overlay element
 * @type {HTMLElement|null}
 */
let _loadingOverlay = null;
let _loadingOverlayEscapeHandler = null;

function getSnipAskDesign() {
    return window.SNIP_ASK_DESIGN || {
        radius: { md: '8px', pill: '999px' },
        space: { 2: '4px', 3: '6px', 4: '8px', 7: '14px', 9: '18px', 10: '20px' },
        shadow: {
            md: '0 8px 22px rgba(0, 0, 0, 0.22)',
            lg: '0 12px 30px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(255, 255, 255, 0.055)'
        },
        border: { strong: '1px solid rgba(255, 255, 255, 0.1)' },
        color: { surfaceHeader: '#1d1d1d', textSoft: '#d5d5d5' },
        icon: { sm: '12px' },
        control: { md: '30px', overlay: '40px' },
        type: { small: '12px', ui: '14px' },
        leading: { tight: '1.2' },
        weight: { medium: '500' },
        transition: {
            fast: '0.16s ease',
            entrance: '0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'
        }
    };
}

/**
 * Show a draggable, nonblocking thinking panel while processing a snip.
 */
function showLoadingCursor() {
    hideLoadingCursor({ immediate: true });
    const design = getSnipAskDesign();

    _loadingOverlay = document.createElement('div');
    _loadingOverlay.id = 'snip-loading-overlay';
    _loadingOverlay.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
        animation: overlayFadeIn 0.2s ease;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        align-items: center;
        gap: ${design.space[7]};
        background: rgba(18, 18, 18, 0.92);
        color: #fff4f1;
        border: ${design.border.strong};
        border-radius: ${design.radius.pill};
        min-width: 150px;
        min-height: ${design.control.overlay};
        padding: ${design.space[3]} ${design.space[4]} ${design.space[3]} ${design.space[9]};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: ${design.shadow.lg};
        backdrop-filter: blur(10px);
        pointer-events: auto;
        cursor: grab;
        user-select: none;
        touch-action: none;
    `;

    let panelLeft = null;
    let panelTop = null;
    let dragState = null;

    const movePanel = (left, top) => {
        const rect = panel.getBoundingClientRect();
        const margin = 8;
        panelLeft = Math.min(Math.max(left, margin), window.innerWidth - rect.width - margin);
        panelTop = Math.min(Math.max(top, margin), window.innerHeight - rect.height - margin);
        panel.style.left = `${panelLeft}px`;
        panel.style.top = `${panelTop}px`;
        panel.style.transform = 'none';
    };

    panel.addEventListener('pointerdown', (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        if (event.target.closest('button')) return;

        const rect = panel.getBoundingClientRect();
        dragState = {
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top
        };
        panel.setPointerCapture(event.pointerId);
        panel.style.cursor = 'grabbing';
    });

    panel.addEventListener('pointermove', (event) => {
        if (!dragState) return;
        movePanel(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
    });

    const stopDragging = (event) => {
        if (!dragState) return;
        dragState = null;
        panel.style.cursor = 'grab';
        try {
            panel.releasePointerCapture(event.pointerId);
        } catch {
            // Pointer capture may already be released by the browser.
        }
    };
    panel.addEventListener('pointerup', stopDragging);
    panel.addEventListener('pointercancel', stopDragging);

    const thinkingContainer = document.createElement('div');
    thinkingContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: ${design.space[4]};
        flex: 1;
        min-width: 0;
    `;

    const bubble = document.createElement('div');
    bubble.style.cssText = `
        display: flex;
        gap: ${design.space[2]};
        width: fit-content;
    `;

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

    const text = document.createElement('span');
    text.textContent = 'Thinking...';
    text.style.cssText = `
        font-size: ${design.type.small};
        line-height: ${design.leading.tight};
        font-weight: ${design.weight.medium};
        color: ${design.color.textSoft};
        font-style: normal;
        animation: thinkingPulse 1.5s infinite;
        white-space: nowrap;
    `;
    thinkingContainer.appendChild(bubble);
    thinkingContainer.appendChild(text);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true" style="width: ${design.icon.sm}; height: ${design.icon.sm}; display: block;"><path d="M3.25 3.25 8.75 8.75M8.75 3.25 3.25 8.75" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/></svg>`;
    cancelButton.title = 'Stop generating';
    cancelButton.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: ${design.control.md};
        height: ${design.control.md};
        background: transparent;
        color: ${design.color.textSoft};
        border: ${design.border.strong};
        border-radius: ${design.radius.pill};
        padding: 0;
        margin-left: auto;
        font: inherit;
        cursor: pointer;
        transition: transform ${design.transition.fast}, background ${design.transition.fast}, border-color ${design.transition.fast};
    `;
    cancelButton.addEventListener('mouseenter', () => {
        cancelButton.style.background = 'rgba(255, 255, 255, 0.06)';
        cancelButton.style.borderColor = 'rgba(255, 107, 74, 0.28)';
        cancelButton.style.color = '#ff8a6d';
        cancelButton.style.transform = 'translateY(-1px)';
    });
    cancelButton.addEventListener('mouseleave', () => {
        cancelButton.style.background = 'transparent';
        cancelButton.style.borderColor = 'rgba(255, 255, 255, 0.12)';
        cancelButton.style.color = '#d5d5d5';
        cancelButton.style.transform = 'translateY(0)';
    });
    cancelButton.addEventListener('click', () => {
        cancelButton.disabled = true;
        cancelButton.style.opacity = '0.75';
        cancelButton.style.cursor = 'default';
        cancelButton.textContent = '...';
        document.dispatchEvent(new CustomEvent('snipAskCancelActiveRequest'));
        hideLoadingCursor({ immediate: true });
        chrome.runtime.sendMessage({ action: 'CANCEL_AI_REQUEST' }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Failed to cancel active AI request:', chrome.runtime.lastError.message);
            }
        });
    });

    _loadingOverlayEscapeHandler = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (!cancelButton.disabled) {
            cancelButton.click();
        }
    };
    document.addEventListener('keydown', _loadingOverlayEscapeHandler, true);

    panel.appendChild(thinkingContainer);
    panel.appendChild(cancelButton);
    _loadingOverlay.appendChild(panel);

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
function hideLoadingCursor(options = {}) {
    const { immediate = false } = options;

    if (_loadingOverlayEscapeHandler) {
        document.removeEventListener('keydown', _loadingOverlayEscapeHandler, true);
        _loadingOverlayEscapeHandler = null;
    }

    const overlayToRemove = _loadingOverlay || document.getElementById('snip-loading-overlay');
    _loadingOverlay = null;

    if (!overlayToRemove) {
        return;
    }

    const removeOverlay = () => {
        if (overlayToRemove.parentNode) {
            overlayToRemove.remove();
        }

        document.querySelectorAll('#snip-loading-overlay').forEach((overlay) => {
            if (overlay !== overlayToRemove && overlay !== _loadingOverlay) {
                overlay.remove();
            }
        });
    };

    if (immediate) {
        removeOverlay();
        return;
    }

    overlayToRemove.style.animation = 'overlayFadeIn 0.15s ease reverse';
    setTimeout(removeOverlay, 150);
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
        lower.includes("gemma-3") ||
        lower.includes("gpt-5") ||
        lower.includes("gpt-4o") ||
        lower.includes("gpt-4.1") ||
        lower.includes("llava") ||
        lower.includes("moondream") ||
        lower.includes("minicpm") ||
        lower.includes("qwen-vl") ||
        lower.includes("omni");
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
    const design = getSnipAskDesign();

    const normalizedMessage = (() => {
        if (typeof message === 'string') return message;
        if (message == null) return 'Unknown error';
        if (typeof message === 'object') {
            const candidates = [message.message, message.error, message.detail, message.code]
                .filter(value => typeof value === 'string' && value.trim());
            if (candidates.length > 0) return candidates.join(' ');
            try {
                return JSON.stringify(message);
            } catch {
                return String(message);
            }
        }
        return String(message);
    })();

    const toast = document.createElement('div');
    toast.id = 'snip-error-toast';
    toast.style.cssText = `
        position: fixed; top: ${design.space[10]}; right: ${design.space[10]}; z-index: 2147483647;
        padding: 15px ${design.space[10]}; background: ${design.color.surfaceHeader}; color: #f55036;
        border: 1px solid #f55036; border-radius: ${design.radius.md};
        font-family: 'Segoe UI', sans-serif; font-size: ${design.type.ui};
        box-shadow: ${design.shadow.md};
        animation: slideIn ${design.transition.entrance};
        max-width: 350px;
    `;

    // Check if this is an API key error
    const lowerMessage = normalizedMessage.toLowerCase();
    const isUnauthorizedExtension = lowerMessage.includes('unauthorized extension') ||
        lowerMessage.includes('invalid_extension_id') ||
        lowerMessage.includes('invalid_origin');

    const isKeyError = !isUnauthorizedExtension && (lowerMessage.includes('api key') ||
        lowerMessage.includes('invalid') ||
        lowerMessage.includes('401') ||
        lowerMessage.includes('unauthorized'));

    if (isUnauthorizedExtension) {
        const messageLine = document.createElement('div');
        messageLine.style.marginBottom = '8px';
        messageLine.textContent = 'Warning: ' + normalizedMessage;

        const helpLine = document.createElement('div');
        helpLine.style.cssText = `font-size: ${design.type.small}; line-height: ${design.leading.tight}; color: ${design.color.textSoft};`;
        helpLine.textContent = 'This build is not allowlisted for Guest Mode.';

        toast.appendChild(messageLine);
        toast.appendChild(helpLine);
    } else if (isKeyError) {
        const messageLine = document.createElement('div');
        messageLine.style.marginBottom = '8px';
        messageLine.textContent = 'Warning: ' + normalizedMessage;

        const helpLine = document.createElement('div');
        helpLine.style.cssText = `font-size: ${design.type.small}; line-height: ${design.leading.tight}; color: ${design.color.textSoft};`;
        helpLine.textContent = 'Click the extension icon to update your API key.';

        toast.appendChild(messageLine);
        toast.appendChild(helpLine);
    } else {
        toast.textContent = 'Warning: ' + normalizedMessage;
    }

    document.body.appendChild(toast);

    // Auto-remove after 6 seconds for key errors (longer to read), 5 for others
    setTimeout(() => toast.remove(), isKeyError ? 6000 : 5000);

    // Allow clicking to dismiss
    toast.style.cursor = 'pointer';
    toast.addEventListener('click', () => toast.remove());
}

