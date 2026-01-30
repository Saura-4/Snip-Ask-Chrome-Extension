// src/background/models-config.js
// Centralized model definitions and provider configuration

/**
 * All available models organized by provider
 */
export const ALL_MODELS = {
    groq: [
        { value: 'groq/compound', name: 'Compound' },
        { value: 'groq/compound-mini', name: 'Compound Mini' },
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
        { value: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
        { value: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        { value: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
        { value: 'gemini-2.5-flash-tts', name: 'Gemini 2.5 Flash TTS' },
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
        { value: 'groq/compound', name: 'Compound' },
        { value: 'groq/compound-mini', name: 'Compound Mini' },
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
        { value: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
        { value: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        { value: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
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

// --- CUSTOM SAVED MODELS ---

/**
 * Get saved custom models from storage
 * @returns {Promise<Object>} Object with arrays of custom models per provider
 */
export async function getCustomSavedModels() {
    try {
        const result = await chrome.storage.local.get(['customSavedModels']);
        return result.customSavedModels || { ollama: [], openrouter: [] };
    } catch (e) {
        console.error('Failed to get custom saved models:', e);
        return { ollama: [], openrouter: [] };
    }
}

/**
 * Save a custom model for a provider
 * @param {string} provider - 'ollama' or 'openrouter'
 * @param {string} modelValue - Full model value (e.g., 'ollama:deepseek-r1:14b')
 * @param {string} modelName - Display name for the model
 * @returns {Promise<boolean>} Success status
 */
export async function saveCustomModel(provider, modelValue, modelName) {
    try {
        const customModels = await getCustomSavedModels();

        // Ensure provider array exists
        if (!customModels[provider]) {
            customModels[provider] = [];
        }

        // Check if already exists
        if (customModels[provider].some(m => m.value === modelValue)) {
            return true; // Already saved
        }

        // Add new custom model
        customModels[provider].push({
            value: modelValue,
            name: modelName,
            enabled: true,
            isCustom: true
        });

        await chrome.storage.local.set({ customSavedModels: customModels });
        return true;
    } catch (e) {
        console.error('Failed to save custom model:', e);
        return false;
    }
}

/**
 * Remove a custom model
 * @param {string} provider - 'ollama' or 'openrouter'
 * @param {string} modelValue - Full model value to remove
 * @returns {Promise<boolean>} Success status
 */
export async function removeCustomModel(provider, modelValue) {
    try {
        const customModels = await getCustomSavedModels();

        if (!customModels[provider]) {
            return true;
        }

        customModels[provider] = customModels[provider].filter(m => m.value !== modelValue);
        await chrome.storage.local.set({ customSavedModels: customModels });
        return true;
    } catch (e) {
        console.error('Failed to remove custom model:', e);
        return false;
    }
}

/**
 * Toggle a custom model's enabled state
 * @param {string} provider - 'ollama' or 'openrouter'
 * @param {string} modelValue - Full model value
 * @param {boolean} enabled - New enabled state
 * @returns {Promise<boolean>} Success status
 */
export async function toggleCustomModel(provider, modelValue, enabled) {
    try {
        const customModels = await getCustomSavedModels();

        if (!customModels[provider]) {
            return false;
        }

        const model = customModels[provider].find(m => m.value === modelValue);
        if (model) {
            model.enabled = enabled;
            await chrome.storage.local.set({ customSavedModels: customModels });
        }
        return true;
    } catch (e) {
        console.error('Failed to toggle custom model:', e);
        return false;
    }
}

/**
 * Get merged models (static + custom saved) for a model source
 * @param {Object} modelSource - ALL_MODELS or CHAT_WINDOW_MODELS
 * @param {Object} customSavedModels - Saved custom models object
 * @returns {Object} Merged model lists by provider
 */
export function getMergedModelsWithCustom(modelSource, customSavedModels) {
    const merged = {};

    for (const [provider, models] of Object.entries(modelSource)) {
        // Start with static models
        merged[provider] = [...models];

        // Add enabled custom models for this provider (before the "Custom Model" option)
        if (customSavedModels[provider]) {
            const enabledCustom = customSavedModels[provider].filter(m => m.enabled !== false);
            // Insert custom models before the last item (which is "⚙️ Custom Model")
            if (merged[provider].length > 0 && merged[provider][merged[provider].length - 1].value.endsWith(':custom')) {
                merged[provider].splice(merged[provider].length - 1, 0, ...enabledCustom);
            } else {
                merged[provider].push(...enabledCustom);
            }
        }
    }

    return merged;
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
 * Uses ALL_MODELS merged with custom saved models
 * @param {Object} enabledProviders - User's provider settings
 * @param {Object} enabledModels - User's model settings
 * @param {boolean} isGuestMode - Whether in guest mode
 * @returns {Promise<Array>} List of available models
 */
export async function getChatWindowModels(enabledProviders, enabledModels, isGuestMode) {
    // Get custom saved models and merge with static models
    const customSavedModels = await getCustomSavedModels();
    const mergedModels = getMergedModelsWithCustom(ALL_MODELS, customSavedModels);

    return getFilteredModels(enabledProviders, enabledModels, isGuestMode, mergedModels);
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
