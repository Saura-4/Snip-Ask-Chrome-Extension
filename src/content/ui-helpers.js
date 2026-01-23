// src/content/ui-helpers.js
// UI utility functions - toasts, text sanitizers, model helpers

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
 * Update local demo usage cache from server response
 * Keeps the frontend counter in sync with server-side usage
 * @param {Object} demoInfo - Demo info from API response
 */
function updateLocalDemoCache(demoInfo) {
    if (!demoInfo) return;
    const today = new Date().toISOString().split('T')[0];
    chrome.storage.local.set({
        guestUsageCount: demoInfo.usage,
        guestUsageDate: today
    });
}

/**
 * Sanitize model response text - removes thinking tags and artifacts
 * @param {string} rawText - Raw text from model response
 * @returns {string} - Cleaned text
 */
function sanitizeModelText(rawText) {
    if (!rawText) return rawText;

    let text = rawText;

    // Strip <think>...</think> blocks from Qwen/DeepSeek models (including multiline)
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Strip incomplete/unclosed thinking tags (model started but didn't finish thinking)
    text = text.replace(/<think>[\s\S]*$/gi, '').trim();

    // Strip malformed JSON artifacts like "<? {}" or "<?{...}"
    text = text.replace(/<\?\s*\{[^}]*\}?\s*/gi, '').trim();

    // Strip other potential model artifacts
    text = text.replace(/<\|.*?\|>/g, '').trim(); // DeepSeek special tokens
    text = text.replace(/\[INST\][\s\S]*?\[\/INST\]/gi, '').trim(); // Llama instruction tokens
    text = text.replace(/<\|im_start\|>[\s\S]*?<\|im_end\|>/gi, '').trim(); // ChatML tokens

    // Handle "Corrected text:" prefix (original logic)
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
