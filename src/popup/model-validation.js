import { isGoogleModel, isOllamaModel, isOpenRouterModel } from '../background/model-routing.js';

function getMissingConfigMessage(model, storage) {
    if (isOllamaModel(model) && !storage.ollamaHost) {
        return 'Please set Ollama URL in API Keys';
    }

    if (isGoogleModel(model) && !storage.geminiKey) {
        return 'Please set Google API Key';
    }

    if (isOpenRouterModel(model) && !storage.openrouterKey) {
        return 'Please set OpenRouter API Key';
    }

    if (!isOllamaModel(model) && !isGoogleModel(model) && !isOpenRouterModel(model) && !storage.groqKey) {
        return 'Please set Groq API Key';
    }

    return null;
}

export { getMissingConfigMessage };
