import { isGoogleModel, isOllamaModel, isOpenAIModel, isOpenRouterModel } from '../../background/models/model-routing.js';

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

    if (isOpenAIModel(model) && !storage.openaiKey) {
        return 'Please set OpenAI API Key';
    }

    if (!isOllamaModel(model) && !isGoogleModel(model) && !isOpenRouterModel(model) && !isOpenAIModel(model) && !storage.groqKey) {
        return 'Please set Groq API Key';
    }

    return null;
}

export { getMissingConfigMessage };
