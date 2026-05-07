import { getAIService } from '../ai-service.js';
import { optimizeMessageHistory } from '../ai/token-budget.js';
import { isGuestMode, isGuestConfigured, makeGuestRequest, GUEST_DEFAULT_MODEL } from '../guest-config.js';
import { getChatWindowModels, checkGuestModeStatus } from '../models/models-config.js';
import { isAutoGuestModel, isGoogleModel, isGroqModel, isOllamaModel, isOpenAIModel, isOpenRouterModel } from '../models/model-routing.js';
import { buildGuestRequestPayload, buildGuestSystemPrompt } from '../guest/request.js';
import { parseGuestResponse } from '../guest/response.js';
import { getStorage } from '../core/storage.js';

const GUEST_TEXT_LIMIT = 4000;

function getProviderCredential(modelName, storage) {
    if (isOllamaModel(modelName)) {
        return storage.ollamaHost || "http://localhost:11434";
    }
    if (isOpenRouterModel(modelName)) {
        return storage.openrouterKey;
    }
    if (isGoogleModel(modelName)) {
        return storage.geminiKey;
    }
    if (isOpenAIModel(modelName)) {
        return storage.openaiKey;
    }
    return storage.groqKey;
}

function truncateGuestText(text, maxLength = GUEST_TEXT_LIMIT) {
    if (typeof text !== 'string') {
        return text;
    }

    if (text.length <= maxLength) {
        return text;
    }

    const slice = text.slice(0, maxLength);
    const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
    const trimmed = lastBreak > maxLength - 300 ? slice.slice(0, lastBreak) : slice;
    return `${trimmed}\n\n[truncated for guest mode]`;
}

function getBudgetedMessages(messages, modelName, mode) {
    const result = optimizeMessageHistory(messages, modelName, [], { mode });
    if (result.error) {
        throw new Error(result.error.message);
    }
    return result.messages;
}

export async function handleCustomModelValidation(request, sendResponse, signal) {
    try {
        const modelName = request.model;
        if (!modelName) {
            throw new Error('Missing model for validation.');
        }

        const storage = await getStorage([
            'customModes',
            'customPrompt',
            'selectedMode',
            'interactionMode',
            'groqKey',
            'geminiKey',
            'openaiKey',
            'openrouterKey',
            'ollamaHost'
        ]);

        const activeKeyOrHost = getProviderCredential(modelName, storage);
        if (!activeKeyOrHost) {
            throw new Error('Missing provider configuration. Add the API key or host first.');
        }

        const mode = storage.selectedMode || storage.interactionMode || 'short';
        const aiService = getAIService(activeKeyOrHost, modelName, mode, storage.customPrompt, storage.customModes);
        const result = await aiService.askText('Reply with OK only.', signal);

        sendResponse({
            success: true,
            model: result.model || modelName
        });
    } catch (error) {
        sendResponse({
            success: false,
            error: error.message || String(error)
        });
    }
}

export async function handleContinueChat(request, sendResponse, signal) {
    try {
        const storage = await getStorage([
            'interactionMode', 'customPrompt', 'selectedModel', 'selectedMode',
            'customModes', 'groqKey', 'geminiKey', 'openaiKey', 'openrouterKey', 'ollamaHost'
        ]);

        const modelName = request.model || storage.selectedModel;
        const isGroq = isGroqModel(modelName);

        if (isGroq && !storage.groqKey && isGuestConfigured()) {
            const parallelCount = request.parallelCount ?? 1;
            const mode = request.mode || storage.selectedMode || storage.interactionMode || 'short';
            const systemPrompt = buildGuestSystemPrompt(mode, storage);
            const messagesWithSystem = [
                { role: 'system', content: systemPrompt },
                ...request.history
            ];

            const guestRequest = buildGuestRequestPayload({
                modelName,
                mode,
                storage,
                messages: messagesWithSystem,
                parallelCount
            });

            const guestResponse = await makeGuestRequest(guestRequest.payload, signal);
            const { answer, guestInfo, tokenUsage } = parseGuestResponse(guestResponse);

            const responseModel = guestInfo?.model || guestResponse.model || guestRequest.modelName;
            sendResponse({ success: true, answer, model: responseModel, responseModel, selectedModel: modelName, guestInfo, tokenUsage });
            return;
        }

        const activeKeyOrHost = getProviderCredential(modelName, storage);
        if (!activeKeyOrHost) {
            throw new Error('Missing API key. Please configure your API keys in the extension popup.');
        }

        const mode = request.mode || storage.selectedMode || storage.interactionMode || 'short';
        const aiService = getAIService(activeKeyOrHost, modelName, mode, storage.customPrompt, storage.customModes);
        const optimizedHistory = getBudgetedMessages(request.history, modelName, mode);
        const result = await aiService.chat(optimizedHistory, signal);
        sendResponse({ success: true, answer: result.text, model: modelName, responseModel: result.model, tokenUsage: result.tokenUsage });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

export async function handleProviderConfigCheck(request, sendResponse) {
    try {
        const storage = await getStorage(['groqKey', 'geminiKey', 'openaiKey', 'openrouterKey', 'ollamaHost', 'selectedModel', 'selectedMode', 'interactionMode']);
        const requestedModel = request.model || storage.selectedModel || GUEST_DEFAULT_MODEL;
        const modelName = requestedModel;
        const currentMode = storage.selectedMode || storage.interactionMode || 'short';

        let isConfigured = false;
        let providerName = 'Groq Key';

        if (isOllamaModel(modelName)) {
            isConfigured = !!storage.ollamaHost;
            providerName = 'Ollama Host';
        } else if (isOpenRouterModel(modelName)) {
            isConfigured = !!storage.openrouterKey;
            providerName = 'OpenRouter Key';
        } else if (isGoogleModel(modelName)) {
            isConfigured = !!storage.geminiKey;
            providerName = 'Google Key';
        } else if (isOpenAIModel(modelName)) {
            isConfigured = !!storage.openaiKey;
            providerName = 'OpenAI Key';
        } else {
            isConfigured = !!storage.groqKey || isGuestConfigured();
        }

        sendResponse({
            success: true,
            isConfigured,
            providerName,
            model: modelName,
            selectedModel: requestedModel,
            mode: currentMode
        });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

export async function handleGuestStatusCheck(sendResponse) {
    try {
        const inGuestMode = await isGuestMode();
        sendResponse({
            success: true,
            isGuestMode: inGuestMode,
            isDemoMode: inGuestMode,
            isConfigured: isGuestConfigured(),
            defaultModel: GUEST_DEFAULT_MODEL
        });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

export async function handleChatWindowModels(sendResponse) {
    try {
        const storage = await getStorage(['enabledProviders', 'enabledModels', 'hiddenModels']);
        const { isGuestMode: inGuestMode } = await checkGuestModeStatus();
        const enabledProviders = storage.enabledProviders || { groq: true };
        const enabledModels = storage.enabledModels || {};
        const hiddenModels = storage.hiddenModels || {};
        const models = await getChatWindowModels(enabledProviders, enabledModels, hiddenModels, inGuestMode);

        sendResponse({ success: true, models, isGuestMode: inGuestMode });
    } catch (error) {
        sendResponse({ success: false, error: error.message, models: [] });
    }
}

export async function handleAIRequest(inputContent, type, explicitModel, sendResponse, ocrConfidence, explicitMode, signal = null) {
    try {
        const storage = await getStorage([
            'interactionMode', 'customPrompt', 'selectedModel', 'selectedMode',
            'customModes', 'groqKey', 'geminiKey', 'openaiKey', 'openrouterKey', 'ollamaHost'
        ]);
        const mode = explicitMode || storage.selectedMode || storage.interactionMode || 'short';
        const requestedModelName = explicitModel || storage.selectedModel || GUEST_DEFAULT_MODEL;
        const inGuestMode = await isGuestMode();
        const modelName = requestedModelName;

        if (inGuestMode) {
            if (!isGuestConfigured()) {
                throw new Error('Guest Mode is not available. Please add your own API key in the extension popup.');
            }

            const messages = [{ role: 'system', content: buildGuestSystemPrompt(mode, storage) }];
            if (type === 'image') {
                messages.push({
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Analyze this image and provide a helpful response.' },
                        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${inputContent}` } }
                    ]
                });
            } else {
                messages.push({ role: 'user', content: truncateGuestText(inputContent) });
            }

            const guestRequest = buildGuestRequestPayload({
                modelName: requestedModelName,
                mode,
                storage,
                messages,
                forceVisionFallback: type === 'image' && isAutoGuestModel(requestedModelName)
            });
            const guestResponse = await makeGuestRequest(guestRequest.payload, signal);
            const { answer, guestInfo, tokenUsage } = parseGuestResponse(guestResponse);
            const responseModel = guestInfo?.model || guestResponse.model || guestRequest.modelName;

            sendResponse({
                success: true,
                answer,
                model: responseModel,
                selectedModel: requestedModelName,
                responseModel,
                initialUserMessage: messages[messages.length - 1],
                usedOCR: type === 'text',
                ocrConfidence,
                base64Image: type === 'image' ? inputContent : null,
                guestInfo,
                tokenUsage
            });
            return;
        }

        const activeKeyOrHost = getProviderCredential(modelName, storage);
        if (!activeKeyOrHost) {
            throw new Error('Missing Configuration. Please configure your API keys in the extension popup.');
        }

        const aiService = getAIService(activeKeyOrHost, modelName, mode, storage.customPrompt, storage.customModes);
        const result = type === 'image'
            ? await aiService.askImage(inputContent, signal)
            : await aiService.askText(inputContent, signal);

        sendResponse({
            success: true,
            answer: result.answer,
            model: modelName,
            responseModel: result.model,
            tokenUsage: result.tokenUsage,
            initialUserMessage: result.initialUserMessage,
            usedOCR: type === 'text',
            ocrConfidence,
            base64Image: type === 'image' ? inputContent : null
        });
    } catch (error) {
        sendResponse({ success: false, error: error.message || String(error) });
    }
}

export async function handleMultiImageRequest(images, explicitModel, textContext, sendResponse, explicitMode, signal = null) {
    try {
        const storage = await getStorage([
            'interactionMode', 'customPrompt', 'selectedModel', 'selectedMode',
            'customModes', 'groqKey', 'geminiKey', 'openaiKey', 'openrouterKey', 'ollamaHost'
        ]);
        const mode = explicitMode || storage.selectedMode || storage.interactionMode || 'short';
        const requestedModelName = explicitModel || storage.selectedModel || GUEST_DEFAULT_MODEL;
        const inGuestMode = await isGuestMode();
        const modelName = requestedModelName;

        if (inGuestMode) {
            if (!isGuestConfigured()) {
                throw new Error('Guest Mode is not available. Please add your own API key in the extension popup.');
            }

            const messages = [{ role: 'system', content: buildGuestSystemPrompt(mode, storage) }];
            const contentArray = [];
            contentArray.push({ type: 'text', text: truncateGuestText(textContext || `Analyze these ${images.length} images and provide a helpful response.`) });
            for (const img of images) {
                contentArray.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } });
            }
            messages.push({ role: 'user', content: contentArray });

            const guestRequest = buildGuestRequestPayload({
                modelName: requestedModelName,
                mode,
                storage,
                messages,
                forceVisionFallback: isAutoGuestModel(requestedModelName)
            });
            const guestResponse = await makeGuestRequest(guestRequest.payload, signal);
            const { answer, guestInfo, tokenUsage } = parseGuestResponse(guestResponse);
            const responseModel = guestInfo?.model || guestResponse.model || guestRequest.modelName;

            sendResponse({
                success: true,
                answer,
                model: responseModel,
                selectedModel: requestedModelName,
                responseModel,
                initialUserMessage: messages[messages.length - 1],
                imageCount: images.length,
                guestInfo,
                tokenUsage
            });
            return;
        }

        const activeKeyOrHost = getProviderCredential(modelName, storage);
        if (!activeKeyOrHost) {
            throw new Error('Missing Configuration. Please configure your API keys in the extension popup.');
        }

        const aiService = getAIService(activeKeyOrHost, modelName, mode, storage.customPrompt, storage.customModes);
        const contentArray = [];
        contentArray.push({ type: 'text', text: textContext || `Analyze these ${images.length} images and provide a helpful response.` });
        for (const img of images) {
            contentArray.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } });
        }

        const messages = [{ role: 'user', content: contentArray }];
        const optimizedMessages = getBudgetedMessages(messages, modelName, mode);
        const result = await aiService.chat(optimizedMessages, signal);

        sendResponse({
            success: true,
            answer: result.text,
            model: modelName,
            responseModel: result.model,
            tokenUsage: result.tokenUsage,
            initialUserMessage: messages[0],
            imageCount: images.length
        });
    } catch (error) {
        sendResponse({ success: false, error: error.message || String(error) });
    }
}
