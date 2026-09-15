// src/background/models/provider-registry.js
//
// Registry for BYOK providers that speak the OpenAI /chat/completions wire
// format. Everything the extension needs for one of these providers lives in a
// single entry here: routing prefix, endpoint, storage key, popup wiring, model
// list, and custom-model validation.
//
// Adding another OpenAI-compatible provider means adding one entry below plus
// its host in manifest.json "host_permissions". Groq, Google, OpenAI, OpenRouter
// and Ollama stay on their own dedicated services because they need
// provider-specific request shaping.
//
// NOTE ON VERIFICATION: endpoints and model IDs are taken from each provider's
// public docs. If a provider renames a model or moves an endpoint, the fix is a
// one-line edit in this file — nothing else in the codebase hardcodes them.

const OPENAI_COMPATIBLE_PROVIDERS = {
    deepseek: {
        id: 'deepseek',
        label: 'DeepSeek',
        description: 'V4.1 Flash, 1M context',
        prefix: 'deepseek:',
        storageKey: 'deepseekKey',
        toggleId: 'providerDeepSeek',
        badge: 'DS',
        keyPlaceholder: 'DeepSeek Key (sk-...)',
        dashboardUrl: 'https://platform.deepseek.com/api_keys',
        apiEndpoint: 'https://api.deepseek.com/chat/completions',
        hostPermission: 'https://api.deepseek.com/*',
        timeoutMs: 90000,
        models: [
            // deepseek-v4-pro was retired 2026-09-14 and now routes to flash.
            { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', vision: true, chat: true }
        ],
        customModel: {
            title: 'Add DeepSeek model',
            label: 'Enter your DeepSeek model ID:',
            placeholder: 'deepseek-flash',
            pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
            error: 'Invalid DeepSeek model ID. Use an ID like deepseek-flash.'
        }
    },

    cerebras: {
        id: 'cerebras',
        label: 'Cerebras',
        description: 'Very fast inference',
        prefix: 'cerebras:',
        storageKey: 'cerebrasKey',
        toggleId: 'providerCerebras',
        badge: 'CB',
        keyPlaceholder: 'Cerebras Key (csk-...)',
        dashboardUrl: 'https://cloud.cerebras.ai/platform/apikeys',
        apiEndpoint: 'https://api.cerebras.ai/v1/chat/completions',
        hostPermission: 'https://api.cerebras.ai/*',
        // Cerebras' public tier serves text only. Never send it an image.
        textOnly: true,
        models: [
            { id: 'gpt-oss-120b', name: 'GPT OSS 120B', chat: true },
            { id: 'qwen-3.8-27b', name: 'Qwen 3.8 27B', chat: true }
        ],
        customModel: {
            title: 'Add Cerebras model',
            label: 'Enter your Cerebras model ID:',
            placeholder: 'gpt-oss-120b',
            pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
            error: 'Invalid Cerebras model ID. Use an ID like gpt-oss-120b or qwen-3.8-27b.'
        }
    },

    zai: {
        id: 'zai',
        label: 'Z.AI (GLM)',
        description: 'GLM 5.3 series',
        prefix: 'zai:',
        storageKey: 'zaiKey',
        toggleId: 'providerZai',
        badge: 'GLM',
        keyPlaceholder: 'Z.AI Key',
        dashboardUrl: 'https://z.ai/manage-apikey/apikey-list',
        apiEndpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
        hostPermission: 'https://api.z.ai/*',
        timeoutMs: 90000,
        models: [
            { id: 'glm-5.3', name: 'GLM 5.3', chat: true },
            { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', vision: true, chat: true },
            { id: 'glm-5.2', name: 'GLM 5.2', chat: true },
            { id: 'glm-4.7', name: 'GLM 4.7' },
            { id: 'glm-4.7-flash', name: 'GLM 4.7 Flash (Free)', chat: true },
            { id: 'glm-4.6v', name: 'GLM 4.6V', vision: true, chat: true },
            { id: 'glm-4.6v-flash', name: 'GLM 4.6V Flash (Free)', vision: true }
        ],
        customModel: {
            title: 'Add Z.AI model',
            label: 'Enter your GLM model ID:',
            placeholder: 'glm-5.3',
            pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
            error: 'Invalid Z.AI model ID. Use an ID like glm-5.3 or glm-4.6v.'
        }
    },

    moonshot: {
        id: 'moonshot',
        label: 'Kimi (Moonshot)',
        description: 'Kimi K3, 1M context',
        prefix: 'moonshot:',
        storageKey: 'moonshotKey',
        toggleId: 'providerMoonshot',
        badge: 'K3',
        keyPlaceholder: 'Kimi Key (sk-...)',
        dashboardUrl: 'https://platform.kimi.ai/console/api-keys',
        apiEndpoint: 'https://api.moonshot.ai/v1/chat/completions',
        hostPermission: 'https://api.moonshot.ai/*',
        timeoutMs: 90000,
        // Every current Kimi model takes text + image content blocks.
        models: [
            { id: 'kimi-k3', name: 'Kimi K3', vision: true, chat: true },
            { id: 'kimi-k2.6', name: 'Kimi K2.6', vision: true, chat: true },
            { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', vision: true, chat: true },
            { id: 'kimi-k2.7-code-highspeed', name: 'Kimi K2.7 Code Highspeed', vision: true }
        ],
        customModel: {
            title: 'Add Kimi model',
            label: 'Enter your Kimi model ID:',
            placeholder: 'kimi-k3',
            pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
            error: 'Invalid Kimi model ID. Use an ID like kimi-k3 or kimi-k2.6.'
        }
    },

    meta: {
        id: 'meta',
        label: 'Meta (Model API)',
        description: 'Muse Spark',
        prefix: 'meta:',
        storageKey: 'metaKey',
        toggleId: 'providerMeta',
        badge: 'M',
        keyPlaceholder: 'Meta Model API Key',
        dashboardUrl: 'https://ai.developer.meta.com/docs',
        // The old Llama API (api.llama.com) is now the Meta Model API.
        apiEndpoint: 'https://api.meta.ai/v1/chat/completions',
        hostPermission: 'https://api.meta.ai/*',
        // "-contributor" variants are cheaper but train on your data — add one
        // through Custom Model if you want that trade.
        models: [
            { id: 'muse-spark-1.3', name: 'Muse Spark 1.3', vision: true, chat: true },
            { id: 'muse-spark-1.2', name: 'Muse Spark 1.2', vision: true, chat: true },
            { id: 'muse-spark-1.1', name: 'Muse Spark 1.1', vision: true }
        ],
        customModel: {
            title: 'Add Meta model',
            label: 'Enter your Meta Model API model ID:',
            placeholder: 'muse-spark-1.3',
            pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
            error: 'Invalid Meta model ID. Use an ID like muse-spark-1.3.'
        }
    }
};

const OPENAI_COMPATIBLE_PROVIDER_IDS = Object.keys(OPENAI_COMPATIBLE_PROVIDERS);

/** Registry entry for a provider id, or null. */
function getProviderConfig(providerId) {
    return OPENAI_COMPATIBLE_PROVIDERS[providerId] || null;
}

/** Registry entry whose prefix matches a `provider:model` value, or null. */
function getProviderConfigForModel(modelName) {
    if (!modelName || typeof modelName !== 'string') return null;
    for (const config of Object.values(OPENAI_COMPATIBLE_PROVIDERS)) {
        if (modelName.startsWith(config.prefix)) return config;
    }
    return null;
}

/** Storage keys holding the API keys for every registry provider. */
function getProviderStorageKeys() {
    return OPENAI_COMPATIBLE_PROVIDER_IDS.map(id => OPENAI_COMPATIBLE_PROVIDERS[id].storageKey);
}

/** Full model value (e.g. 'zai:glm-4.6') for a registry model entry. */
function toModelValue(config, modelId) {
    return `${config.prefix}${modelId}`;
}

/**
 * Model list for one provider in models-config format.
 * @param {Object} config Registry entry
 * @param {boolean} chatOnly Only models flagged for the compact chat dropdown
 */
function buildModelOptions(config, chatOnly = false) {
    const options = config.models
        .filter(model => (chatOnly ? model.chat === true : true))
        .map(model => ({
            value: toModelValue(config, model.id),
            name: chatOnly || !model.vision ? model.name : `${model.name} (Vision)`
        }));

    if (!chatOnly) {
        options.push({ value: `${config.id}:custom`, name: 'Custom Model' });
    }

    return options;
}

/**
 * Does this model accept image input?
 * Unknown (custom) models are treated as vision-capable unless the provider is
 * marked text-only, so a user's own multimodal model still works.
 */
function isVisionCapableModel(config, modelId) {
    if (!config || config.textOnly === true) return false;
    if (!modelId || typeof modelId !== 'string') return false;

    const bare = modelId.startsWith(config.prefix) ? modelId.slice(config.prefix.length) : modelId;
    const known = config.models.find(model => model.id.toLowerCase() === bare.toLowerCase());
    if (known) return known.vision === true;

    const lower = bare.toLowerCase();
    return lower.includes('vision') ||
        lower.includes('-vl') ||
        lower.endsWith('v') ||
        lower.startsWith('kimi-') ||
        lower.startsWith('muse-spark');
}

export {
    OPENAI_COMPATIBLE_PROVIDERS,
    OPENAI_COMPATIBLE_PROVIDER_IDS,
    buildModelOptions,
    getProviderConfig,
    getProviderConfigForModel,
    getProviderStorageKeys,
    isVisionCapableModel,
    toModelValue
};
