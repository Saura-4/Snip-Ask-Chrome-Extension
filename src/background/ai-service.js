// src/background/ai-service.js
import { GeminiService } from './ai/providers/gemini.js';
import { GroqService } from './ai/providers/groq.js';
import { OpenAIService } from './ai/providers/openai.js';
import { OpenRouterService } from './ai/providers/openrouter.js';
import { OllamaService } from './ai/providers/ollama.js';

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
