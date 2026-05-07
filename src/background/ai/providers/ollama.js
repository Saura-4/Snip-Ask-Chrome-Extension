import { AbstractAIService } from '../base-service.js';
import { getBudgetedMessages, getMaxTokensForMode } from '../token-budget.js';
import { LOCAL_TIMEOUT_MS, fetchWithTimeout } from '../transport.js';
import { createTextSnipMessage } from '../text-utils.js';

function isValidOllamaHost(url) {
    try {
        const parsed = new URL(url);

        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { valid: false, reason: "Only HTTP/HTTPS protocols allowed" };
        }

        const blockedHosts = [
            '169.254.169.254',
            'metadata.google.internal',
            'metadata.google.com',
        ];
        if (blockedHosts.includes(parsed.hostname)) {
            return { valid: false, reason: "Cloud metadata endpoints are blocked" };
        }

        const allowedPatterns = [
            /^localhost$/i,
            /^127\.\d+\.\d+\.\d+$/,
            /^192\.168\.\d+\.\d+$/,
            /^10\.\d+\.\d+\.\d+$/,
            /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
            /^0\.0\.0\.0$/,
            /^host\.docker\.internal$/i,
            /^\[::1\]$/,
        ];

        const isAllowed = allowedPatterns.some(pattern => pattern.test(parsed.hostname));
        if (!isAllowed) {
            return { valid: false, reason: "Only localhost and private network IPs allowed for Ollama" };
        }

        return { valid: true };
    } catch (e) {
        return { valid: false, reason: "Invalid URL format" };
    }
}

class OllamaService extends AbstractAIService {
    constructor(host, modelName, interactionMode, customPrompt, customModes) {
        super(null, modelName, interactionMode, customPrompt, customModes);
        this.actualModel = modelName.replace('ollama:', '');

        const hostUrl = host || "http://localhost:11434";
        const validation = isValidOllamaHost(hostUrl);
        if (!validation.valid) {
            throw new Error(`Invalid Ollama Host: ${validation.reason}`);
        }
        this.baseUrl = hostUrl.replace(/\/$/, "");
    }

    async chat(messages, signal = null) {
        const endpoint = `${this.baseUrl}/api/chat`;
        let finalMessages = [...messages];
        if (finalMessages.length > 0 && finalMessages[0].role !== 'system') {
            finalMessages.unshift({ role: "system", content: this._getSystemInstruction() });
        }
        finalMessages = getBudgetedMessages(finalMessages, this.modelName || `ollama:${this.actualModel}`, this.mode, [], {
            outputTokens: getMaxTokensForMode(this.mode, this.modelName || `ollama:${this.actualModel}`)
        });

        const cleanMessages = finalMessages.map(msg => {
            const cleanMsg = { role: msg.role, content: "" };

            if (Array.isArray(msg.content)) {
                msg.content.forEach(part => {
                    if (part.type === 'text') cleanMsg.content += part.text;
                    if (part.type === 'image_url') {
                        const base64 = part.image_url.url.split(',')[1];
                        if (!cleanMsg.images) cleanMsg.images = [];
                        cleanMsg.images.push(base64);
                    }
                });
            } else {
                cleanMsg.content = msg.content;
            }
            return cleanMsg;
        });

        const payload = {
            model: this.actualModel,
            messages: cleanMessages,
            stream: false,
            options: { temperature: 0.3, num_ctx: 4096 }
        };

        try {
            const response = await fetchWithTimeout(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            }, LOCAL_TIMEOUT_MS, signal);

            if (!response.ok) throw new Error("Ollama Connection Failed. Is it running?");
            const data = await response.json();

            return {
                text: data.message.content,
                model: data.model || this.actualModel,
                tokenUsage: {
                    promptTokens: data.prompt_eval_count || 0,
                    completionTokens: data.eval_count || 0,
                    totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
                }
            };

        } catch (e) {
            throw new Error(`Ollama Error: ${e.message}. Ensure 'OLLAMA_ORIGINS="*"' is set.`);
        }
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

export { OllamaService, isValidOllamaHost };
