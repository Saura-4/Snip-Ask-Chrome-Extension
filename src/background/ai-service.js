// src/background/ai-service.js
import { GeminiService } from './ai/providers/gemini.js';
import { GroqService } from './ai/providers/groq.js';
import { OpenAICompatibleService, OpenAIService } from './ai/providers/openai.js';
import { OpenRouterService } from './ai/providers/openrouter.js';
import { OllamaService } from './ai/providers/ollama.js';
import { getProviderConfigForModel, isVisionCapableModel } from './models/provider-registry.js';

export function getAIService(apiKeyOrHost, modelName, interactionMode, customPrompt, customModes = null) {
    if (modelName && modelName.startsWith('ollama:')) {
        return new OllamaService(apiKeyOrHost, modelName, interactionMode, customPrompt, customModes);
    }

    if (modelName && modelName.startsWith('openrouter:')) {
        return new OpenRouterService(apiKeyOrHost, modelName, interactionMode, customPrompt, customModes);
    }

    if (modelName && modelName.startsWith('openai:')) {
        return new OpenAIService(apiKeyOrHost, modelName, interactionMode, customPrompt, customModes);
    }

    // DeepSeek, Cerebras, Z.AI, Moonshot, Meta — all OpenAI /chat/completions
    // compatible, described declaratively in models/provider-registry.js.
    const registryProvider = getProviderConfigForModel(modelName);
    if (registryProvider) {
        return new OpenAICompatibleService(apiKeyOrHost, modelName, interactionMode, customPrompt, customModes, {
            apiEndpoint: registryProvider.apiEndpoint,
            providerName: registryProvider.label,
            headers: registryProvider.headers || {},
            extraBody: registryProvider.extraBody || null,
            timeoutMs: registryProvider.timeoutMs,
            supportsVision: isVisionCapableModel(registryProvider, modelName)
        });
    }

    if (modelName && (modelName.includes('gemini') || modelName.includes('gemma'))) {
        return new GeminiService(apiKeyOrHost, modelName, interactionMode, customPrompt, customModes);
    }

    return new GroqService(apiKeyOrHost, modelName, interactionMode, customPrompt, customModes);
}

export {
    getMaxTokensForMode,
    getRequestBudget,
    getSafeLimit,
    optimizeMessageHistory
} from './ai/token-budget.js';
export { REQUEST_TOO_LARGE_MESSAGE } from './ai/errors.js';
