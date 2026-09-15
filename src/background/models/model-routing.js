import { getProviderConfigForModel } from './provider-registry.js';

function getModelProvider(modelName) {
    if (!modelName || typeof modelName !== 'string') return 'groq';
    if (modelName.startsWith('groq:')) return 'groq';
    if (modelName.startsWith('google:')) return 'google';
    if (modelName.startsWith('openai:')) return 'openai';
    if (modelName.startsWith('ollama:')) return 'ollama';
    if (modelName.startsWith('openrouter:')) return 'openrouter';

    const registryProvider = getProviderConfigForModel(modelName);
    if (registryProvider) return registryProvider.id;

    if (modelName.includes('gemini') || modelName.includes('gemma')) return 'google';
    return 'groq';
}

function isGroqModel(modelName) {
    return getModelProvider(modelName) === 'groq';
}

function isGoogleModel(modelName) {
    return getModelProvider(modelName) === 'google';
}

function isOpenRouterModel(modelName) {
    return getModelProvider(modelName) === 'openrouter';
}

function isOllamaModel(modelName) {
    return getModelProvider(modelName) === 'ollama';
}

function isOpenAIModel(modelName) {
    return getModelProvider(modelName) === 'openai';
}

/** True for the registry-driven OpenAI-compatible providers (DeepSeek, Cerebras, ...). */
function isRegistryProviderModel(modelName) {
    return getProviderConfigForModel(modelName) !== null;
}

function isAutoGuestModel(modelName) {
    return modelName === 'groq:auto';
}

function resolveGuestModel(modelName, fallbackModel) {
    if (isAutoGuestModel(modelName)) {
        return modelName;
    }
    // getModelProvider() defaults unknown names to 'groq', so isGroqModel() alone
    // would let a missing or provider-scoped name through to the guest worker,
    // which then rejects it with "The requested guest model is not available."
    if (typeof modelName !== 'string' || modelName.length === 0) {
        return fallbackModel;
    }
    if (modelName.includes(':')) {
        return fallbackModel;
    }
    return isGroqModel(modelName) ? modelName : fallbackModel;
}

function normalizeProviderScopedModelName(modelName) {
    if (!modelName || typeof modelName !== 'string') return modelName;
    if (modelName.startsWith('groq:')) return modelName.slice('groq:'.length);
    if (modelName.startsWith('google:')) return modelName.slice('google:'.length);
    if (modelName.startsWith('openai:')) return modelName.slice('openai:'.length);

    const registryProvider = getProviderConfigForModel(modelName);
    if (registryProvider) return modelName.slice(registryProvider.prefix.length);

    return modelName;
}

export {
    getModelProvider,
    isGroqModel,
    isGoogleModel,
    isOpenRouterModel,
    isOllamaModel,
    isOpenAIModel,
    isRegistryProviderModel,
    isAutoGuestModel,
    resolveGuestModel,
    normalizeProviderScopedModelName
};
