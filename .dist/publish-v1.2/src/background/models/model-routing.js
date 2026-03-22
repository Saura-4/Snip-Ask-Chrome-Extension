function getModelProvider(modelName) {
    if (!modelName || typeof modelName !== 'string') return 'groq';
    if (modelName.startsWith('groq:')) return 'groq';
    if (modelName.startsWith('google:')) return 'google';
    if (modelName.startsWith('openai:')) return 'openai';
    if (modelName.startsWith('ollama:')) return 'ollama';
    if (modelName.startsWith('openrouter:')) return 'openrouter';
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

function resolveGuestModel(modelName, fallbackModel) {
    if (typeof modelName === 'string' && modelName.startsWith('groq:')) {
        return fallbackModel;
    }
    return isGroqModel(modelName) ? modelName : fallbackModel;
}

function normalizeProviderScopedModelName(modelName) {
    if (!modelName || typeof modelName !== 'string') return modelName;
    if (modelName.startsWith('groq:')) return modelName.slice('groq:'.length);
    if (modelName.startsWith('google:')) return modelName.slice('google:'.length);
    if (modelName.startsWith('openai:')) return modelName.slice('openai:'.length);
    return modelName;
}

export {
    getModelProvider,
    isGroqModel,
    isGoogleModel,
    isOpenRouterModel,
    isOllamaModel,
    isOpenAIModel,
    resolveGuestModel,
    normalizeProviderScopedModelName
};
