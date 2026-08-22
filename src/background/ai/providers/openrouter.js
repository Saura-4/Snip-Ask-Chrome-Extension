import { AbstractAIService } from '../base-service.js';
import { normalizeProviderErrorMessage } from '../errors.js';
import { getBudgetedMessages, getMaxTokensForMode } from '../token-budget.js';
import { OPENROUTER_TIMEOUT_MS, fetchWithTimeout } from '../transport.js';
import { streamChatCompletions } from '../streaming.js';
import { createTextSnipMessage, stripThinkingTags } from '../text-utils.js';

class OpenRouterService extends AbstractAIService {
    constructor(apiKey, modelName, interactionMode, customPrompt, customModes) {
        super(apiKey, modelName, interactionMode, customPrompt, customModes);
        this.actualModel = modelName.replace('openrouter:', '');
        this.API_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
    }

    async chat(messages, signal = null, onDelta = null) {
        const finalMessages = [];

        if (messages.length === 0 || messages[0].role !== 'system') {
            finalMessages.push({ role: "system", content: this._getSystemInstruction() });
        }

        for (const msg of messages) {
            if (msg.role === 'system' && finalMessages.length > 0 && finalMessages[0].role === 'system') {
                continue;
            }

            let content = msg.content;
            if (Array.isArray(content)) {
                const textParts = content.filter(p => p.type === 'text').map(p => p.text);
                const hasImage = content.some(p => p.type === 'image_url');

                if (hasImage && this._isVisionModel()) {
                    content = msg.content;
                } else {
                    content = textParts.join('\n') || 'Analyze this content.';
                }
            }

            finalMessages.push({ role: msg.role, content });
        }

        const requestMessages = getBudgetedMessages(finalMessages, this.actualModel, this.mode);

        const requestBody = {
            model: this.actualModel,
            messages: requestMessages,
            max_tokens: getMaxTokensForMode(this.mode, this.actualModel)
        };

        const requestHeaders = {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/Saura-4/Snip-Ask-Chrome-Extension",
            "X-Title": "Snip & Ask Extension"
        };

        if (typeof onDelta === 'function') {
            const result = await streamChatCompletions({
                url: this.API_ENDPOINT,
                headers: requestHeaders,
                body: requestBody,
                onDelta,
                signal,
                timeoutMs: OPENROUTER_TIMEOUT_MS,
                providerName: 'OpenRouter'
            });
            const streamedText = stripThinkingTags(result.text);
            if (!streamedText) {
                throw new Error('No response content from OpenRouter');
            }
            return {
                text: streamedText,
                model: result.model || this.actualModel,
                tokenUsage: result.tokenUsage
            };
        }

        const response = await fetchWithTimeout(this.API_ENDPOINT, {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify(requestBody)
        }, OPENROUTER_TIMEOUT_MS, signal);

        const data = await response.json();

        if (!response.ok) {
            throw new Error(normalizeProviderErrorMessage(response, data, 'OpenRouter'));
        }

        const answer = data.choices?.[0]?.message?.content;
        if (!answer) {
            throw new Error('No response content from OpenRouter');
        }

        const text = stripThinkingTags(answer);
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

    _isVisionModel() {
        const lower = this.actualModel.toLowerCase();
        return lower.includes('vision') ||
            lower.includes('vl') ||
            lower.includes('llava') ||
            lower.includes('llama-4');
    }

    async askImage(base64Image, signal = null) {
        const promptText = this._createImagePrompt();

        if (this._isVisionModel()) {
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

        const userMsg = { role: "user", content: promptText + "\n\n[Image provided but model doesn't support vision]" };
        const result = await this.chat([userMsg], signal);
        return { answer: result.text, model: result.model, tokenUsage: result.tokenUsage, initialUserMessage: userMsg };
    }

    async askText(rawText, signal = null) {
        const userMsg = createTextSnipMessage(rawText);
        const result = await this.chat([userMsg], signal);
        return { answer: result.text, model: result.model, tokenUsage: result.tokenUsage, initialUserMessage: userMsg };
    }
}

export { OpenRouterService };
