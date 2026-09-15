import { isGoogleModel, isOllamaModel, isOpenAIModel, isOpenRouterModel } from '../../background/models/model-routing.js';
import { getProviderConfigForModel } from '../../background/models/provider-registry.js';

function getMissingConfigMessage(model, storage) {
    const registryProvider = getProviderConfigForModel(model);
    if (registryProvider) {
        return storage[registryProvider.storageKey] ? null : `Please set ${registryProvider.label} API Key`;
    }

    if (isOllamaModel(model) && !storage.ollamaHost) {
        return 'Please set Ollama URL in API Keys';
    }

    if (isGoogleModel(model) && !storage.geminiKey) {
        return 'Please set Gemini API Key';
    }

    if (isOpenRouterModel(model) && !storage.openrouterKey) {
        return 'Please set OpenRouter API Key';
    }

    if (isOpenAIModel(model) && !storage.openaiKey) {
        return 'Please set OpenAI API Key';
    }

    if (!isOllamaModel(model) && !isGoogleModel(model) && !isOpenRouterModel(model) && !isOpenAIModel(model) && !storage.groqKey) {
        return 'Please set Groq API Key';
    }

    return null;
}

export { getMissingConfigMessage };
