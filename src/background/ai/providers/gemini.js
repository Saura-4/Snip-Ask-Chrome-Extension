import { normalizeProviderScopedModelName } from '../../models/model-routing.js';
import { AbstractAIService } from '../base-service.js';
import { normalizeProviderErrorMessage } from '../errors.js';
import { getBudgetedMessages, getMaxTokensForMode } from '../token-budget.js';
import { CLOUD_TIMEOUT_MS, fetchWithTimeout } from '../transport.js';
import { createTextSnipMessage } from '../text-utils.js';

class GeminiService extends AbstractAIService {
    constructor(apiKey, modelName, interactionMode, customPrompt, customModes) {
        super(apiKey, modelName, interactionMode, customPrompt, customModes);
        this.actualModel = normalizeProviderScopedModelName(modelName);
        this.baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.actualModel}:generateContent`;
    }

    async chat(messages, signal = null) {
        const isGemma = this.actualModel.toLowerCase().includes('gemma');
        let finalMessages = [...messages];
        if (finalMessages.length === 0 || finalMessages[0].role !== 'system') {
            finalMessages.unshift({ role: 'system', content: this._getSystemInstruction() });
        }
        finalMessages = getBudgetedMessages(finalMessages, this.actualModel, this.mode);

        const contents = [];
        let systemPromptText = null;

        for (const msg of finalMessages) {
            if (msg.role === 'system') systemPromptText = msg.content;
        }
        if (!systemPromptText) systemPromptText = this._getSystemInstruction();

        for (const msg of finalMessages) {
            if (msg.role === 'system') continue;
            const role = msg.role === 'assistant' ? 'model' : 'user';
            const parts = [];

            if (Array.isArray(msg.content)) {
                msg.content.forEach(item => {
                    if (item.type === 'text') parts.push({ text: item.text });
                    else if (item.type === 'image_url') {
                        const base64 = item.image_url.url.split(',')[1];
                        parts.push({ inline_data: { mime_type: "image/jpeg", data: base64 } });
                    }
                });
            } else {
                parts.push({ text: msg.content });
            }
            contents.push({ role, parts });
        }

        let finalSystemInstruction = null;

        if (isGemma) {
            if (contents.length > 0 && contents[0].role === 'user') {
                const existingText = contents[0].parts.find(p => p.text)?.text || "";
                const newText = `[System Instructions]:\n${systemPromptText}\n\n[User Request]:\n${existingText}`;
                const textIndex = contents[0].parts.findIndex(p => p.text);
                if (textIndex >= 0) contents[0].parts[textIndex].text = newText;
                else contents[0].parts.unshift({ text: newText });
            }
        } else {
            finalSystemInstruction = { parts: [{ text: systemPromptText }] };
        }

        const payload = {
            contents,
            generationConfig: { temperature: 0.3, maxOutputTokens: getMaxTokensForMode(this.mode, this.actualModel) }
        };

        if (finalSystemInstruction) payload.system_instruction = finalSystemInstruction;

        const response = await fetchWithTimeout(this.baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": this.apiKey
            },
            body: JSON.stringify(payload)
        }, CLOUD_TIMEOUT_MS, signal);

        const data = await response.json();
        if (!response.ok) throw new Error(normalizeProviderErrorMessage(response, data, 'Google Gemini'));

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No answer returned.";
        const usage = data.usageMetadata || {};

        return {
            text,
            model: this.actualModel,
            tokenUsage: {
                promptTokens: usage.promptTokenCount || 0,
                completionTokens: usage.candidatesTokenCount || 0,
                totalTokens: usage.totalTokenCount || 0
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

export { GeminiService };
