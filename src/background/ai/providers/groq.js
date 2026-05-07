import { normalizeProviderScopedModelName } from '../../models/model-routing.js';
import { AbstractAIService } from '../base-service.js';
import { normalizeProviderErrorMessage } from '../errors.js';
import { getBudgetedMessages, getMaxTokensForMode } from '../token-budget.js';
import { CLOUD_TIMEOUT_MS, fetchWithTimeout } from '../transport.js';
import { createTextSnipMessage, stripThinkingTags } from '../text-utils.js';

class GroqService extends AbstractAIService {
    constructor(apiKey, modelName, interactionMode, customPrompt, customModes) {
        super(apiKey, modelName, interactionMode, customPrompt, customModes);
        this.actualModel = normalizeProviderScopedModelName(modelName) || "meta-llama/llama-4-scout-17b-16e-instruct";
        this.API_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
    }

    async chat(messages, signal = null) {
        const finalMessages = [...messages];
        if (finalMessages.length === 0 || finalMessages[0].role !== 'system') {
            finalMessages.unshift({ role: "system", content: this._getSystemInstruction() });
        }
        const requestMessages = getBudgetedMessages(finalMessages, this.actualModel, this.mode);

        const requestBody = {
            messages: requestMessages,
            model: this.actualModel,
            temperature: 0.3,
            max_tokens: getMaxTokensForMode(this.mode, this.actualModel)
        };

        const response = await fetchWithTimeout(this.API_ENDPOINT, {
            method: "POST",
            headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        }, CLOUD_TIMEOUT_MS, signal);

        const data = await response.json();
        if (!response.ok) throw new Error(normalizeProviderErrorMessage(response, data, 'Groq'));

        const rawContent = data.choices?.[0]?.message?.content || "No answer.";
        const text = stripThinkingTags(rawContent);
        const usage = data.usage || {};

        return {
            text,
            model: data.model || this.actualModel,
            tokenUsage: {
                promptTokens: usage.prompt_tokens || 0,
                completionTokens: usage.completion_tokens || 0,
                totalTokens: usage.total_tokens || 0
            }
        };
    }

    async askImage(base64Image, signal = null) {
        const promptText = this._createImagePrompt();
        const userMsg = {
            role: "user",
            content: [
                { type: "text", text: promptText },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
            ]
        };
        const result = await this.chat([userMsg], signal);
        return { answer: result.text, model: result.model, tokenUsage: result.tokenUsage, initialUserMessage: userMsg };
    }

    async askText(rawText, signal = null) {
        const userMsg = createTextSnipMessage(rawText);
        const result = await this.chat([userMsg], signal);
        return { answer: result.text, model: result.model, tokenUsage: result.tokenUsage, initialUserMessage: userMsg };
    }
}

export { GroqService };
