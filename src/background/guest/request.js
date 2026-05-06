import { optimizeMessageHistory } from '../ai-service.js';
import { GUEST_DEFAULT_MODEL } from '../guest-config.js';
import { resolveGuestModel } from '../models/model-routing.js';

function getGuestMaxTokens(mode) {
    if (mode === 'short') return 384;
    if (mode === 'code') return 1536;
    if (mode === 'detailed' || mode === 'custom') return 1024;
    return 320;
}

function getGuestModeLabel(mode, storage) {
    if (mode === 'short') return 'Short Answer';
    if (mode === 'detailed') return 'Detailed';
    if (mode === 'code') return 'Code Debug';
    if (mode === 'custom' && storage?.customPrompt) return 'Custom Prompt';

    const customModes = storage?.customModes || [];
    const matchingMode = customModes.find((item) => item.id === mode);
    if (matchingMode?.name) {
        return matchingMode.name;
    }

    return mode || 'short';
}

function buildGuestSystemPrompt(mode, storage) {
    const customModes = storage.customModes || null;

    if (mode === 'short') {
        return "POPUP WINDOW: Concise answer engine. Keep under 100 words. For MCQs: 'Answer: <option>. <one-sentence explanation>'. For other questions: direct answer only. No preamble, no elaboration.";
    }

    if (mode === 'detailed') {
        return 'POPUP TUTOR: Provide a focused, step-by-step answer. Use concise bullet points. Limit to 3-5 key steps max. Use Markdown sparingly (bold for emphasis only).';
    }

    if (mode === 'code') {
        return 'POPUP CODE ASSISTANT: Provide ESSENTIAL CODE ONLY - no exhaustive examples. Output ONE clean code block + 1-2 sentences explaining the key fix/concept. Be concise.';
    }

    if (mode === 'custom' && storage.customPrompt) {
        return storage.customPrompt;
    }

    if (customModes) {
        const customMode = customModes.find((item) => item.id === mode);
        if (customMode) return customMode.prompt;
    }

    return 'This is a POPUP WINDOW. Analyze the input and provide a helpful, concise response (under 200 words). Be direct and focused.';
}

function buildGuestRequestPayload({ modelName, mode, storage, messages, parallelCount = null, optimize = false, forceVisionFallback = false }) {
    const resolvedModel = resolveGuestModel(modelName, GUEST_DEFAULT_MODEL);
    const shouldOptimize = optimize && forceVisionFallback !== true;
    const requestMessages = shouldOptimize ? optimizeMessageHistory(messages, resolvedModel) : messages;
    const payload = {
        model: resolvedModel,
        messages: requestMessages,
        temperature: 0.3,
        max_tokens: getGuestMaxTokens(mode)
    };

    if (parallelCount !== null) {
        payload._meta = {
            parallelCount,
            mode: getGuestModeLabel(mode, storage),
            requestedModel: modelName || null,
            forceVisionFallback: forceVisionFallback === true
        };
    } else {
        payload._meta = {
            mode: getGuestModeLabel(mode, storage),
            requestedModel: modelName || null,
            forceVisionFallback: forceVisionFallback === true
        };
    }

    return {
        modelName: resolvedModel,
        messages: requestMessages,
        payload
    };
}

export {
    buildGuestRequestPayload,
    buildGuestSystemPrompt,
    getGuestMaxTokens
};
