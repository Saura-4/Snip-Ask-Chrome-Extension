import { normalizeProviderScopedModelName } from '../../models/model-routing.js';
import { AbstractAIService } from '../base-service.js';
import { normalizeProviderErrorMessage } from '../errors.js';
import {
    buildOpenAICompatibleRequestBody,
    buildOpenAIResponsesRequestBody,
    extractOpenAIResponsesText,
    getOpenAIMaxOutputTokens
} from '../openai-format.js';
import { getBudgetedMessages } from '../token-budget.js';
import { CLOUD_TIMEOUT_MS, fetchWithTimeout } from '../transport.js';
import { createTextSnipMessage } from '../text-utils.js';

class OpenAICompatibleService extends AbstractAIService {
    constructor(apiKey, modelName, interactionMode, customPrompt, customModes, options = {}) {
        super(apiKey, modelName, interactionMode, customPrompt, customModes);
        this.actualModel = normalizeProviderScopedModelName(modelName);
        this.apiEndpoint = options.apiEndpoint;
        this.providerName = options.providerName;
        this.headers = options.headers || {};
        this.timeoutMs = options.timeoutMs || CLOUD_TIMEOUT_MS;
        this.extraBody = options.extraBody || null;
    }

    async chat(messages, signal = null) {
        const finalMessages = [...messages];
        if (finalMessages.length === 0 || finalMessages[0].role !== 'system') {
            finalMessages.unshift({ role: "system", content: this._getSystemInstruction() });
        }
        const requestMessages = getBudgetedMessages(finalMessages, this.actualModel, this.mode);

        const requestBody = buildOpenAICompatibleRequestBody(requestMessages, this.actualModel, this.mode);
        if (this.extraBody) {
            Object.assign(requestBody, this.extraBody);
        }

        const response = await fetchWithTimeout(this.apiEndpoint, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                ...this.headers
            },
            body: JSON.stringify(requestBody)
        }, this.timeoutMs, signal);

        const data = await response.json();
        if (!response.ok) throw new Error(normalizeProviderErrorMessage(response, data, this.providerName));

        const text = data.choices?.[0]?.message?.content || "No answer.";
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

class OpenAIService extends OpenAICompatibleService {
    constructor(apiKey, modelName, interactionMode, customPrompt, customModes) {
        super(apiKey, modelName, interactionMode, customPrompt, customModes, {
            apiEndpoint: "https://api.openai.com/v1/responses",
            providerName: "OpenAI"
        });
    }

    async chat(messages, signal = null) {
        const finalMessages = [...messages];
        if (finalMessages.length === 0 || finalMessages[0].role !== 'system') {
            finalMessages.unshift({ role: "system", content: this._getSystemInstruction() });
        }
        const requestMessages = getBudgetedMessages(finalMessages, this.actualModel, this.mode, [], {
            outputTokens: getOpenAIMaxOutputTokens(this.actualModel, this.mode)
        });

        const requestBody = buildOpenAIResponsesRequestBody(requestMessages, this.actualModel, this.mode);

        const response = await fetchWithTimeout(this.apiEndpoint, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
        }, this.timeoutMs, signal);

        const data = await response.json();
        if (!response.ok) throw new Error(normalizeProviderErrorMessage(response, data, this.providerName));

        const text = extractOpenAIResponsesText(data);
        if (!text) {
            const incompleteReason = data?.incomplete_details?.reason;
            if (incompleteReason === 'max_output_tokens') {
                throw new Error('OpenAI stopped before producing visible text. Please try again or use a shorter request.');
            }
            throw new Error('No response content from OpenAI');
        }

        const usage = data.usage || {};
        return {
            text,
            model: data.model || this.actualModel,
            tokenUsage: {
                promptTokens: usage.input_tokens || 0,
                completionTokens: usage.output_tokens || 0,
                totalTokens: usage.total_tokens || 0
            }
        };
    }
}

export { OpenAICompatibleService, OpenAIService };
