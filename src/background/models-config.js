// src/background/models-config.js
// Centralized model definitions and provider configuration

/**
 * All available models organized by provider
 */
export const ALL_MODELS = {
    groq: [
        { value: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout (Vision)' },
        { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick (Vision)' },
        { value: 'moonshotai/kimi-k2-instruct', name: 'Kimi k2 Instruct' },
        { value: 'moonshotai/kimi-k2-instruct-0905', name: 'Kimi k2 Instruct (0905)' },
        { value: 'openai/gpt-oss-120b', name: 'GPT OSS 120B' },
        { value: 'openai/gpt-oss-20b', name: 'GPT OSS 20B' },
        { value: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Text)' },
        { value: 'qwen/qwen3-32b', name: 'Qwen 3 32B (Text)' }
    ],
    google: [
        { value: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        { value: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
        { value: 'gemini-2.0-flash-lite-preview-02-05', name: 'Gemini 2.0 Flash Lite' },
        { value: 'gemma-3-27b-it', name: 'Gemma 3 27B (Vision)' },
        { value: 'gemma-3-12b-it', name: 'Gemma 3 12B (Vision)' },
        { value: 'gemma-3-4b-it', name: 'Gemma 3 4B' },
        { value: 'gemma-3-1b-it', name: 'Gemma 3 1B' }
    ],
    openrouter: [
        { value: 'openrouter:deepseek/deepseek-r1-0528:free', name: 'DeepSeek R1 (Free)' },
        { value: 'openrouter:custom', name: '⚙️ Custom Model' }
    ],
    ollama: [
        { value: 'ollama:gemma3:4b', name: 'Gemma 3 4B' },
        { value: 'ollama:llama3', name: 'Llama 3' },
        { value: 'ollama:mistral', name: 'Mistral' },
        { value: 'ollama:llava', name: 'LLaVA (Vision)' },
        { value: 'ollama:moondream', name: 'Moondream (Vision)' },
        { value: 'ollama:custom', name: '⚙️ Custom Model' }
    ]
};

/**
 * Compact model list for chat window dropdown (less detail)
 */
export const CHAT_WINDOW_MODELS = {
    groq: [
        { value: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout' },
        { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick' },
        { value: 'moonshotai/kimi-k2-instruct', name: 'Kimi k2' },
        { value: 'moonshotai/kimi-k2-instruct-0905', name: 'Kimi k2 (0905)' },
        { value: 'openai/gpt-oss-120b', name: 'GPT OSS 120B' },
        { value: 'openai/gpt-oss-20b', name: 'GPT OSS 20B' },
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

/**
 * Provider display labels
 */
export const PROVIDER_LABELS = {
    groq: '🚀 Groq (Fast)',
    google: '✨ Google (Gemini)',
    openrouter: '🌐 OpenRouter',
    ollama: '🦙 Ollama (Local)'
};

/**
 * Default provider configuration
 */
export const DEFAULT_PROVIDERS = {
    groq: true,
    google: false,
    openrouter: false,
    ollama: false
};

/**
 * Guest mode provider configuration (only Groq allowed)
 */
export const GUEST_MODE_PROVIDERS = {
    groq: true,
    google: false,
    openrouter: false,
    ollama: false
};

/**
 * Generate default enabled models (all enabled by default)
 */
export function getDefaultEnabledModels() {
    const enabled = {};
    for (const [provider, models] of Object.entries(ALL_MODELS)) {
        models.forEach(model => {
            enabled[model.value] = true;
        });
    }
    return enabled;
}

/**
 * Get filtered models based on enabled providers and enabled models
 * @param {Object} enabledProviders - Which providers are enabled
 * @param {Object} enabledModels - Which models are enabled
 * @param {boolean} isGuestMode - Whether in guest mode
 * @param {Object} modelSource - Which model list to use (ALL_MODELS or CHAT_WINDOW_MODELS)
 * @returns {Array} Filtered list of models
 */
export function getFilteredModels(enabledProviders, enabledModels, isGuestMode = false, modelSource = ALL_MODELS) {
    // In guest mode, force only Groq provider
    const providersToUse = isGuestMode ? GUEST_MODE_PROVIDERS : enabledProviders;

    const filteredModels = [];

    for (const [provider, models] of Object.entries(modelSource)) {
        if (providersToUse[provider]) {
            models.forEach(model => {
                // In guest mode, show ALL Groq models; otherwise respect user settings
                if (isGuestMode || enabledModels[model.value] !== false) {
                    filteredModels.push({ ...model, provider });
                }
            });
        }
    }

    return filteredModels;
}

/**
 * Get the first available model from filtered list
 * @param {Array} filteredModels - List of available models
 * @param {string} preferredModel - Model to prefer if available
 * @returns {string|null} Model value or null
 */
export function getFirstAvailableModel(filteredModels, preferredModel = null) {
    if (preferredModel && filteredModels.some(m => m.value === preferredModel)) {
        return preferredModel;
    }
    return filteredModels.length > 0 ? filteredModels[0].value : null;
}

// --- GUEST MODE SERVICE FUNCTIONS ---

/**
 * Check if the extension is in Guest Mode (no user API keys configured)
 * Returns true only if ALL API key fields are empty or contain only whitespace
 * @returns {Promise<{isGuestMode: boolean, isConfigured: boolean}>}
 */
export async function checkGuestModeStatus() {
    try {
        const storage = await chrome.storage.local.get(['groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);

        // Check if any key has actual content (even if invalid)
        const hasGroqKey = storage.groqKey && storage.groqKey.trim().length > 0;
        const hasGeminiKey = storage.geminiKey && storage.geminiKey.trim().length > 0;
        const hasOpenRouterKey = storage.openrouterKey && storage.openrouterKey.trim().length > 0;
        const hasOllamaHost = storage.ollamaHost && storage.ollamaHost.trim().length > 0;

        // Guest mode = NO keys entered at all
        const isGuestMode = !hasGroqKey && !hasGeminiKey && !hasOpenRouterKey && !hasOllamaHost;

        return {
            isGuestMode,
            isConfigured: true // Assume configured if GUEST_WORKER_URL is set in guest-config.js
        };
    } catch (e) {
        console.error('Failed to check guest mode status:', e);
        return {
            isGuestMode: false,
            isConfigured: false
        };
    }
}

/**
 * Get the provider configuration for guest mode
 * @returns {Object} Provider config with only groq enabled
 */
export function getGuestProviderConfig() {
    return GUEST_MODE_PROVIDERS;
}

/**
 * Get effective provider config based on guest mode status
 * @param {Object} userProviders - User's provider settings
 * @param {boolean} isGuestMode - Whether in guest mode
 * @returns {Object} Effective provider config
 */
export function getEffectiveProviders(userProviders, isGuestMode) {
    return isGuestMode ? GUEST_MODE_PROVIDERS : userProviders;
}

/**
 * Get available models for popup dropdown based on guest mode status
 * @param {Object} enabledProviders - User's provider settings
 * @param {Object} enabledModels - User's model settings
 * @param {boolean} isGuestMode - Whether in guest mode
 * @returns {Array} List of available models
 */
export function getPopupModels(enabledProviders, enabledModels, isGuestMode) {
    return getFilteredModels(enabledProviders, enabledModels, isGuestMode, ALL_MODELS);
}

/**
 * Get available models for chat window dropdown based on guest mode status
 * @param {Object} enabledProviders - User's provider settings
 * @param {Object} enabledModels - User's model settings
 * @param {boolean} isGuestMode - Whether in guest mode
 * @returns {Array} List of available models (compact names)
 */
export function getChatWindowModels(enabledProviders, enabledModels, isGuestMode) {
    return getFilteredModels(enabledProviders, enabledModels, isGuestMode, CHAT_WINDOW_MODELS);
}

/**
 * Check if current model is valid for guest mode, return corrected model if not
 * @param {string} currentModel - The currently selected model
 * @param {Array} availableModels - List of available models
 * @returns {string} Valid model value
 */
export function validateModelForGuestMode(currentModel, availableModels) {
    const isCurrentModelValid = availableModels.some(m => m.value === currentModel);
    if (isCurrentModelValid) {
        return currentModel;
    }
    // Return first available model if current is invalid
    return availableModels.length > 0 ? availableModels[0].value : currentModel;
}
