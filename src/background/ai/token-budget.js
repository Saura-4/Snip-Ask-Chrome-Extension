import { REQUEST_TOO_LARGE_MESSAGE } from './errors.js';

const TOKEN_BUDGET_BUFFER_RATIO = 0.90;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 32768;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_IMAGE_TOKEN_ESTIMATE = 2048;
const IMAGE_REMOVED_PLACEHOLDER = '[Image removed to fit context]';

const MODEL_CONTEXT_BUDGETS = [
    { pattern: 'ollama:', contextWindow: 4096, maxOutputTokens: 2048 },

    { pattern: 'gpt-4.1', contextWindow: 1047576, maxOutputTokens: 32768 },
    { pattern: 'gpt-4o', contextWindow: 128000, maxOutputTokens: 16384 },
    { pattern: 'gpt-5', contextWindow: 400000, maxOutputTokens: 128000 },
    { pattern: 'openai:', contextWindow: 128000, maxOutputTokens: 16384 },

    { pattern: 'gemini', contextWindow: 1048576, maxOutputTokens: 65536 },
    { pattern: 'gemma', contextWindow: 128000, maxOutputTokens: 8192 },

    { pattern: 'openrouter/free', contextWindow: 200000, maxOutputTokens: 8192 },

    { pattern: 'groq:auto', contextWindow: 131072, maxOutputTokens: 8192 },
    { pattern: 'llama-3.3', contextWindow: 131072, maxOutputTokens: 32768 },
    { pattern: 'llama-3.1', contextWindow: 131072, maxOutputTokens: 8192 },
    { pattern: 'llama-4', contextWindow: 131072, maxOutputTokens: 8192 },
    { pattern: 'gpt-oss', contextWindow: 131072, maxOutputTokens: 32768 },
    { pattern: 'qwen', contextWindow: 131072, maxOutputTokens: 8192 },
    { pattern: 'compound', contextWindow: 131072, maxOutputTokens: 8192 },
    { pattern: 'groq:', contextWindow: 131072, maxOutputTokens: 8192 },
    { pattern: 'openrouter', contextWindow: 64000, maxOutputTokens: 8192 }
];

function getBaseMaxTokensForMode(mode) {
    if (mode === 'short') return 150;
    if (mode === 'code') return 1536;
    return 1024;
}

function getModelBudget(modelID) {
    if (!modelID || typeof modelID !== 'string') {
        return {
            contextWindow: DEFAULT_CONTEXT_WINDOW_TOKENS,
            maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS
        };
    }

    const lowerModel = modelID.toLowerCase();
    const match = MODEL_CONTEXT_BUDGETS.find(({ pattern }) => lowerModel.includes(pattern));
    return match
        ? { contextWindow: match.contextWindow, maxOutputTokens: match.maxOutputTokens }
        : { contextWindow: DEFAULT_CONTEXT_WINDOW_TOKENS, maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS };
}

function getMaxTokensForMode(mode, modelID = null) {
    return Math.min(getBaseMaxTokensForMode(mode), getModelBudget(modelID).maxOutputTokens);
}

function getSafeLimit(modelID) {
    return getModelBudget(modelID).contextWindow;
}

function getRequestBudget(targetModel, comparisonModels = [], options = {}) {
    const modelIds = [targetModel, ...comparisonModels].filter(Boolean);
    const budgets = modelIds.length > 0
        ? modelIds.map(getModelBudget)
        : [getModelBudget(null)];
    const contextWindow = Math.min(...budgets.map((budget) => budget.contextWindow));
    const maxOutputTokens = Math.min(...budgets.map((budget) => budget.maxOutputTokens));
    const requestedOutputTokens = Number.isFinite(options.outputTokens)
        ? options.outputTokens
        : getBaseMaxTokensForMode(options.mode);
    const outputTokens = Math.min(requestedOutputTokens, maxOutputTokens);
    const safeInputTokens = Math.max(256, Math.floor(contextWindow * TOKEN_BUDGET_BUFFER_RATIO) - outputTokens);

    return {
        contextWindow,
        maxOutputTokens,
        outputTokens,
        safeInputTokens
    };
}

function estimateMessageTokens(msg) {
    if (!msg || !msg.content) return 0;

    if (typeof msg.content === 'string') {
        return Math.ceil(msg.content.length / 4);
    }

    if (Array.isArray(msg.content)) {
        let tokens = 0;
        for (const part of msg.content) {
            if (part.type === 'text' && part.text) {
                tokens += Math.ceil(part.text.length / 4);
            } else if (part.type === 'image_url') {
                tokens += DEFAULT_IMAGE_TOKEN_ESTIMATE;
            }
        }
        return tokens;
    }

    return 0;
}

function estimateMessagesTokens(messages) {
    return (Array.isArray(messages) ? messages : [])
        .reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

function findLatestUserMessageIndex(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user') return i;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role !== 'system') return i;
    }

    return messages.length - 1;
}

function isProtectedBudgetMessage(message, index, latestUserIndex) {
    return index === latestUserIndex || message?.role === 'system';
}

function createRequestTooLargeError(details = {}) {
    return {
        code: 'REQUEST_TOO_LARGE',
        message: REQUEST_TOO_LARGE_MESSAGE,
        details
    };
}

function replaceImagesWithPlaceholder(message) {
    if (!Array.isArray(message?.content) || !message.content.some((part) => part.type === 'image_url')) {
        return false;
    }

    const textParts = message.content
        .filter((part) => part.type === 'text' && part.text)
        .map((part) => part.text);
    message.content = textParts.length > 0
        ? `${textParts.join('\n')}\n${IMAGE_REMOVED_PLACEHOLDER}`
        : IMAGE_REMOVED_PLACEHOLDER;
    return true;
}

function removeFirstMessageByRole(messages, role, latestUserIndex) {
    for (let i = 0; i < messages.length; i++) {
        if (messages[i]?.role !== role || isProtectedBudgetMessage(messages[i], i, latestUserIndex)) {
            continue;
        }

        messages.splice(i, 1);
        return i < latestUserIndex ? latestUserIndex - 1 : latestUserIndex;
    }

    return latestUserIndex;
}

function optimizeMessageHistory(messages, targetModel, comparisonModels = [], options = {}) {
    const budget = getRequestBudget(targetModel, comparisonModels, options);

    if (!Array.isArray(messages) || messages.length === 0) {
        return {
            messages,
            estimatedTokens: 0,
            pruned: false,
            error: null,
            budget
        };
    }

    const initialTokens = estimateMessagesTokens(messages);
    if (initialTokens <= budget.safeInputTokens) {
        return {
            messages,
            estimatedTokens: initialTokens,
            pruned: false,
            error: null,
            budget
        };
    }

    const optimized = JSON.parse(JSON.stringify(messages));
    let latestUserIndex = findLatestUserMessageIndex(optimized);
    let pruned = false;

    const protectedMessages = optimized.filter((message, index) =>
        isProtectedBudgetMessage(message, index, latestUserIndex));
    const protectedTokens = estimateMessagesTokens(protectedMessages);

    if (protectedTokens > budget.safeInputTokens) {
        return {
            messages,
            estimatedTokens: initialTokens,
            pruned: false,
            error: createRequestTooLargeError({
                estimatedTokens: protectedTokens,
                safeInputTokens: budget.safeInputTokens
            }),
            budget
        };
    }

    for (let i = 0; i < optimized.length; i++) {
        if (isProtectedBudgetMessage(optimized[i], i, latestUserIndex)) continue;
        if (replaceImagesWithPlaceholder(optimized[i])) {
            pruned = true;
            if (estimateMessagesTokens(optimized) <= budget.safeInputTokens) {
                return {
                    messages: optimized,
                    estimatedTokens: estimateMessagesTokens(optimized),
                    pruned,
                    error: null,
                    budget
                };
            }
        }
    }

    while (estimateMessagesTokens(optimized) > budget.safeInputTokens) {
        const nextLatestUserIndex = removeFirstMessageByRole(optimized, 'assistant', latestUserIndex);
        if (nextLatestUserIndex === latestUserIndex) break;
        latestUserIndex = nextLatestUserIndex;
        pruned = true;
    }

    while (estimateMessagesTokens(optimized) > budget.safeInputTokens) {
        const nextLatestUserIndex = removeFirstMessageByRole(optimized, 'user', latestUserIndex);
        if (nextLatestUserIndex === latestUserIndex) break;
        latestUserIndex = nextLatestUserIndex;
        pruned = true;
    }

    const finalTokens = estimateMessagesTokens(optimized);
    return {
        messages: optimized,
        estimatedTokens: finalTokens,
        pruned,
        error: finalTokens > budget.safeInputTokens
            ? createRequestTooLargeError({
                estimatedTokens: finalTokens,
                safeInputTokens: budget.safeInputTokens
            })
            : null,
        budget
    };
}

function getBudgetedMessages(messages, targetModel, mode, comparisonModels = [], options = {}) {
    const result = optimizeMessageHistory(messages, targetModel, comparisonModels, {
        mode,
        ...options
    });
    if (result.error) {
        throw new Error(result.error.message);
    }
    return result.messages;
}

export {
    REQUEST_TOO_LARGE_MESSAGE,
    getBudgetedMessages,
    getMaxTokensForMode,
    getModelBudget,
    getRequestBudget,
    getSafeLimit,
    optimizeMessageHistory
};
