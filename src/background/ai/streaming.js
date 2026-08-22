// src/background/ai/streaming.js
// SSE / NDJSON streaming transport helpers for provider-side delta streaming.

import { formatRateLimitMessage, getProviderApiMessage } from './errors.js';

const STREAM_FIRST_BYTE_TIMEOUT_MS = 45000;

/**
 * Fetch a streaming response. The timeout only guards time-to-first-byte;
 * the read loop is bounded by the caller's external signal instead.
 */
async function openStreamingResponse(url, options = {}, timeoutMs = STREAM_FIRST_BYTE_TIMEOUT_MS, externalSignal = null) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
        if (externalSignal.aborted) {
            clearTimeout(timeoutId);
            throw new Error('Request cancelled.');
        }
        externalSignal.addEventListener('abort', onExternalAbort);
    }

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return {
            response,
            cleanup: () => {
                clearTimeout(timeoutId);
                if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
            }
        };
    } catch (error) {
        clearTimeout(timeoutId);
        if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
        if (error.name === 'AbortError') {
            throw new Error(timedOut ? 'Request timed out. Please try again.' : 'Request cancelled.');
        }
        throw error;
    }
}

async function readStreamLines(response, externalSignal, onLine) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            if (externalSignal?.aborted) {
                throw new Error('Request cancelled.');
            }
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
                buffer = buffer.slice(newlineIndex + 1);
                if (line) onLine(line);
            }
        }
        if (buffer.trim()) onLine(buffer.trim());
    } finally {
        try {
            reader.cancel();
        } catch {
            // Stream already closed.
        }
    }
}

async function consumeSSE(response, externalSignal, onData) {
    await readStreamLines(response, externalSignal, (line) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        try {
            onData(JSON.parse(payload));
        } catch {
            // Ignore malformed keep-alive fragments.
        }
    });
}

async function consumeNDJSON(response, externalSignal, onData) {
    await readStreamLines(response, externalSignal, (line) => {
        try {
            onData(JSON.parse(line));
        } catch {
            // Ignore malformed lines.
        }
    });
}

/**
 * Stream an OpenAI-compatible /chat/completions endpoint (Groq, OpenRouter, ...).
 * Returns the same shape as the non-streaming chat result.
 */
async function streamChatCompletions({ url, headers, body, onDelta = null, signal = null, timeoutMs = undefined, providerName = null }) {
    const { response, cleanup } = await openStreamingResponse(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, stream: true })
    }, timeoutMs, signal);

    let text = '';
    let model = null;
    let usage = null;

    try {
        if (!response.ok || !response.body) {
            const data = await response.json().catch(() => ({}));
            throw new Error(normalizeStreamErrorText(response, data, providerName));
        }

        await consumeSSE(response, signal, (json) => {
            const deltaText = json.choices?.[0]?.delta?.content;
            if (typeof deltaText === 'string' && deltaText) {
                text += deltaText;
                onDelta?.(deltaText);
            }
            if (json.model && !model) model = json.model;
            if (json.usage) usage = json.usage;
        });
    } finally {
        cleanup();
    }

    return {
        text,
        model: model || null,
        tokenUsage: {
            promptTokens: usage?.prompt_tokens || 0,
            completionTokens: usage?.completion_tokens || 0,
            totalTokens: usage?.total_tokens || 0
        }
    };
}

/**
 * Stream the OpenAI /v1/responses endpoint.
 */
async function streamOpenAIResponses({ url, headers, body, onDelta = null, signal = null, timeoutMs = undefined, providerName = null }) {
    const { response, cleanup } = await openStreamingResponse(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, stream: true })
    }, timeoutMs, signal);

    let text = '';
    let model = null;
    let usage = null;

    try {
        if (!response.ok || !response.body) {
            const data = await response.json().catch(() => ({}));
            throw new Error(normalizeStreamErrorText(response, data, providerName));
        }

        await consumeSSE(response, signal, (json) => {
            if (json.type === 'response.output_text.delta' && typeof json.delta === 'string') {
                text += json.delta;
                onDelta?.(json.delta);
            } else if (json.type === 'response.completed' && json.response) {
                model = json.response.model || model;
                usage = json.response.usage || usage;
            }
        });
    } finally {
        cleanup();
    }

    if (!text.trim()) {
        throw new Error('No response content from OpenAI');
    }

    return {
        text,
        model: model || null,
        tokenUsage: {
            promptTokens: usage?.input_tokens || 0,
            completionTokens: usage?.output_tokens || 0,
            totalTokens: usage?.total_tokens || 0
        }
    };
}

/**
 * Stream Google Gemini generateContent via alt=sse.
 */
async function streamGeminiContent({ url, headers, body, onDelta = null, signal = null, timeoutMs = undefined, providerName = null }) {
    const sseUrl = `${url}?alt=sse`;
    const { response, cleanup } = await openStreamingResponse(sseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    }, timeoutMs, signal);

    let text = '';
    let usage = null;

    try {
        if (!response.ok || !response.body) {
            const data = await response.json().catch(() => ({}));
            throw new Error(normalizeStreamErrorText(response, data, providerName));
        }

        await consumeSSE(response, signal, (json) => {
            const parts = json.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
                for (const part of parts) {
                    if (typeof part?.text === 'string' && part.text) {
                        text += part.text;
                        onDelta?.(part.text);
                    }
                }
            }
            if (json.usageMetadata) usage = json.usageMetadata;
        });
    } finally {
        cleanup();
    }

    return {
        text,
        model: null,
        tokenUsage: {
            promptTokens: usage?.promptTokenCount || 0,
            completionTokens: usage?.candidatesTokenCount || 0,
            totalTokens: usage?.totalTokenCount || 0
        }
    };
}

/**
 * Stream an Ollama /api/chat endpoint (NDJSON lines).
 */
async function streamOllamaChat({ url, headers, body, onDelta = null, signal = null, timeoutMs = undefined }) {
    const { response, cleanup } = await openStreamingResponse(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, stream: true })
    }, timeoutMs, signal);

    let text = '';
    let model = null;
    let counts = { prompt: 0, completion: 0 };

    try {
        if (!response.ok || !response.body) {
            throw new Error('Ollama Connection Failed. Is it running?');
        }

        await consumeNDJSON(response, signal, (json) => {
            const deltaText = json.message?.content;
            if (typeof deltaText === 'string' && deltaText) {
                text += deltaText;
                onDelta?.(deltaText);
            }
            if (json.model && !model) model = json.model;
            if (json.done) {
                counts.prompt = json.prompt_eval_count || counts.prompt;
                counts.completion = json.eval_count || counts.completion;
            }
        });
    } finally {
        cleanup();
    }

    return {
        text,
        model: model || null,
        tokenUsage: {
            promptTokens: counts.prompt,
            completionTokens: counts.completion,
            totalTokens: counts.prompt + counts.completion
        }
    };
}

function normalizeStreamErrorText(response, data, providerName) {
    if (response?.status === 429) {
        return formatRateLimitMessage(response, data, providerName || 'the provider');
    }
    const apiMessage = getProviderApiMessage(data);
    if (apiMessage) return apiMessage;
    return `Request failed with status ${response?.status}.`;
}

export {
    STREAM_FIRST_BYTE_TIMEOUT_MS,
    streamChatCompletions,
    streamGeminiContent,
    streamOllamaChat,
    streamOpenAIResponses
};
