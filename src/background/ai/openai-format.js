import { getMaxTokensForMode, getModelBudget } from './token-budget.js';

function isGPT5Model(modelID) {
    if (typeof modelID !== 'string') return false;
    return modelID.toLowerCase().startsWith('gpt-5');
}

function buildOpenAICompatibleRequestBody(messages, model, mode) {
    const requestBody = {
        messages,
        model
    };

    if (!isGPT5Model(model)) {
        requestBody.temperature = 0.3;
    }

    const maxTokens = getMaxTokensForMode(mode, model);
    if (isGPT5Model(model)) {
        requestBody.max_completion_tokens = maxTokens;
    } else {
        requestBody.max_tokens = maxTokens;
    }

    return requestBody;
}

function getOpenAIMaxOutputTokens(modelID, mode) {
    const baseTokens = getMaxTokensForMode(mode);

    if (!isGPT5Model(modelID)) {
        return baseTokens;
    }

    const modelMaxOutput = getModelBudget(modelID).maxOutputTokens;
    if (mode === 'short') return Math.min(Math.max(baseTokens, 640), modelMaxOutput);
    if (mode === 'code') return Math.min(Math.max(baseTokens, 2048), modelMaxOutput);
    return Math.min(Math.max(baseTokens, 1280), modelMaxOutput);
}

function mapMessagePartToResponsesInput(part) {
    if (!part || typeof part !== 'object') return null;

    if (part.type === 'text' && typeof part.text === 'string') {
        return { type: 'input_text', text: part.text };
    }

    if (part.type === 'image_url' && part.image_url?.url) {
        return { type: 'input_image', image_url: part.image_url.url };
    }

    return null;
}

function mapMessageToResponsesInput(message) {
    const isAssistant = message.role === 'assistant';
    const content = [];

    if (typeof message.content === 'string') {
        content.push({
            type: isAssistant ? 'output_text' : 'input_text',
            text: message.content
        });
    } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
            let mappedPart = mapMessagePartToResponsesInput(part);
            if (mappedPart && isAssistant && mappedPart.type === 'input_text') {
                mappedPart = { type: 'output_text', text: mappedPart.text };
            }
            if (mappedPart) content.push(mappedPart);
        }
    }

    if (content.length === 0) {
        content.push({
            type: isAssistant ? 'output_text' : 'input_text',
            text: ''
        });
    }

    return {
        role: isAssistant ? 'assistant' : 'user',
        content
    };
}

function buildOpenAIResponsesRequestBody(messages, model, mode) {
    const systemMessages = messages
        .filter(msg => msg.role === 'system' && typeof msg.content === 'string')
        .map(msg => msg.content.trim())
        .filter(Boolean);

    const input = messages
        .filter(msg => msg.role !== 'system')
        .map(mapMessageToResponsesInput);

    const requestBody = {
        model,
        input: input.length > 0 ? input : [{ role: 'user', content: [{ type: 'input_text', text: '' }] }],
        max_output_tokens: getOpenAIMaxOutputTokens(model, mode),
        truncation: 'auto'
    };

    if (systemMessages.length > 0) {
        requestBody.instructions = systemMessages.join('\n\n');
    }

    if (isGPT5Model(model)) {
        requestBody.reasoning = { effort: 'minimal' };
        requestBody.text = { verbosity: 'low' };
    }

    return requestBody;
}

function extractOpenAIResponsesText(data) {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) {
        return data.output_text.trim();
    }

    const messageTexts = [];
    const outputItems = Array.isArray(data?.output) ? data.output : [];

    for (const item of outputItems) {
        if (item?.type !== 'message' || !Array.isArray(item.content)) continue;

        for (const part of item.content) {
            if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
                messageTexts.push(part.text.trim());
            } else if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
                messageTexts.push(part.text.trim());
            }
        }
    }

    return messageTexts.join('\n').trim();
}

export {
    buildOpenAICompatibleRequestBody,
    buildOpenAIResponsesRequestBody,
    extractOpenAIResponsesText,
    getOpenAIMaxOutputTokens
};
