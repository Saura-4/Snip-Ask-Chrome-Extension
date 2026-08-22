import { normalizeProviderScopedModelName } from '../../models/model-routing.js';
import { AbstractAIService } from '../base-service.js';
import { normalizeProviderErrorMessage } from '../errors.js';
import { getBudgetedMessages, getMaxTokensForMode } from '../token-budget.js';
import { CLOUD_TIMEOUT_MS, fetchWithTimeout } from '../transport.js';
import { streamChatCompletions } from '../streaming.js';
import { createTextSnipMessage, stripThinkingTags } from '../text-utils.js';

function isQwen36Model(modelName) {
    return typeof modelName === 'string' && modelName.toLowerCase().includes('qwen3.6-27b');
}

function isGptOssModel(modelName) {
    return typeof modelName === 'string' && modelName.toLowerCase().includes('gpt-oss');
}

// Reasoning models spend completion tokens on hidden reasoning before any
// visible text. Without a floor, small modes (short = 150) are consumed
// entirely by reasoning and the model returns an empty answer.
const REASONING_MODEL_MIN_COMPLETION_TOKENS = 1024;

function applyReasoningModelGuards(requestBody, modelName) {
    if (isQwen36Model(modelName)) {
        requestBody.temperature = 0.7;
        requestBody.reasoning_effort = 'none';
        requestBody.reasoning_format = 'hidden';
    } else if (isGptOssModel(modelName)) {
        // gpt-oss does not support reasoning_effort 'none' — use the lowest
        // effort and hide whatever reasoning remains.
        requestBody.reasoning_effort = 'low';
        requestBody.reasoning_format = 'hidden';
    } else {
        return;
    }

    if (requestBody.max_completion_tokens < REASONING_MODEL_MIN_COMPLETION_TOKENS) {
        requestBody.max_completion_tokens = REASONING_MODEL_MIN_COMPLETION_TOKENS;
    }
}

function buildGroqRequestBody({ messages, model, mode }) {
    const requestBody = {
        messages,
        model,
        temperature: isQwen36Model(model) ? 0.7 : 0.3,
        max_completion_tokens: getMaxTokensForMode(mode, model)
    };

    applyReasoningModelGuards(requestBody, model);

    return requestBody;
}

class GroqService extends AbstractAIService {
    constructor(apiKey, modelName, interactionMode, customPrompt, customModes) {
        super(apiKey, modelName, interactionMode, customPrompt, customModes);
        this.actualModel = normalizeProviderScopedModelName(modelName) || "qwen/qwen3.6-27b";
        this.API_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
    }

    async chat(messages, signal = null, onDelta = null) {
        const finalMessages = [...messages];
        if (finalMessages.length === 0 || finalMessages[0].role !== 'system') {
            finalMessages.unshift({ role: "system", content: this._getSystemInstruction() });
        }
        const requestMessages = getBudgetedMessages(finalMessages, this.actualModel, this.mode);

        const requestBody = buildGroqRequestBody({
            messages: requestMessages,
            model: this.actualModel,
            mode: this.mode
        });

        const requestInit = {
            method: "POST",
            headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        };

        if (typeof onDelta === 'function') {
            const result = await streamChatCompletions({
                url: this.API_ENDPOINT,
                headers: requestInit.headers,
                body: requestBody,
                onDelta,
                signal,
                timeoutMs: CLOUD_TIMEOUT_MS,
                providerName: 'Groq'
            });
            const streamedText = stripThinkingTags(result.text);
            if (!streamedText) {
                throw new Error('Groq returned no final answer. Please try again.');
            }
            return {
                text: streamedText,
                model: result.model || this.actualModel,
                tokenUsage: result.tokenUsage
            };
        }

        const response = await fetchWithTimeout(this.API_ENDPOINT, {
            ...requestInit,
            body: JSON.stringify(requestBody)
        }, CLOUD_TIMEOUT_MS, signal);

        const data = await response.json();
        if (!response.ok) throw new Error(normalizeProviderErrorMessage(response, data, 'Groq'));

        const rawContent = data.choices?.[0]?.message?.content;
        const text = stripThinkingTags(rawContent);
        if (!text) {
            throw new Error('Groq returned no final answer. Please try again.');
        }
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

export { GroqService, buildGroqRequestBody, isQwen36Model };
