import { getAIService } from '../ai-service.js';
import { optimizeMessageHistory } from '../ai/token-budget.js';
import { isGuestMode, isGuestConfigured, makeGuestRequest, GUEST_DEFAULT_MODEL } from '../guest-config.js';
import { getChatWindowModels, checkGuestModeStatus } from '../models/models-config.js';
import { isAutoGuestModel, isGoogleModel, isGroqModel, isOllamaModel, isOpenAIModel, isOpenRouterModel } from '../models/model-routing.js';
import { getProviderConfigForModel, getProviderStorageKeys } from '../models/provider-registry.js';
import { buildGuestRequestPayload, buildGuestSystemPrompt } from '../guest/request.js';
import { parseGuestResponse } from '../guest/response.js';
import { getStorage } from '../core/storage.js';

const GUEST_TEXT_LIMIT = 4000;

// Storage keys every handler must load to resolve a credential for any model.
const PROVIDER_STORAGE_KEYS = ['groqKey', 'geminiKey', 'openaiKey', 'openrouterKey', 'ollamaHost', ...getProviderStorageKeys()];

/**
 * Which credential a model needs, and whether Guest Mode can serve it at all.
 * Only the built-in Groq models run through the guest worker.
 */
function getProviderRequirement(modelName) {
    const registryProvider = getProviderConfigForModel(modelName);
    if (registryProvider) {
        return { label: registryProvider.label, storageKey: registryProvider.storageKey, guestCapable: false };
    }
    if (isOllamaModel(modelName)) {
        return { label: 'Ollama', storageKey: 'ollamaHost', guestCapable: false, isHost: true };
    }
    if (isOpenRouterModel(modelName)) {
        return { label: 'OpenRouter', storageKey: 'openrouterKey', guestCapable: false };
    }
    if (isGoogleModel(modelName)) {
        return { label: 'Gemini', storageKey: 'geminiKey', guestCapable: false };
    }
    if (isOpenAIModel(modelName)) {
        return { label: 'OpenAI', storageKey: 'openaiKey', guestCapable: false };
    }
    return { label: 'Groq', storageKey: 'groqKey', guestCapable: true };
}

function getProviderCredential(modelName, storage) {
    const requirement = getProviderRequirement(modelName);
    if (requirement.isHost) {
        return storage.ollamaHost || "http://localhost:11434";
    }
    return storage[requirement.storageKey];
}

/** Error for a model whose credential is missing, naming the provider. */
function missingCredentialError(modelName) {
    const requirement = getProviderRequirement(modelName);
    if (requirement.isHost) {
        return new Error('Ollama host is not set. Add your Ollama URL in Settings -> API Keys.');
    }
    return new Error(`Missing ${requirement.label} API key. Add it in Settings -> API Keys to use ${modelName}.`);
}

/**
 * Guest Mode can only answer with the built-in Groq models. Routing a BYOK
 * model through it either fails on the worker allowlist or silently answers
 * with a different model than the user picked — both confusing. Fail clearly.
 */
function assertGuestCanServe(modelName) {
    const requirement = getProviderRequirement(modelName);
    if (requirement.guestCapable) return;
    throw new Error(`${requirement.label} models need your own API key. Add your ${requirement.label} key in Settings -> API Keys, or pick a Guest Mode model.`);
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
            ...PROVIDER_STORAGE_KEYS,
            'ollamaHost'
        ]);

        const activeKeyOrHost = getProviderCredential(modelName, storage);
        if (!activeKeyOrHost) {
            throw missingCredentialError(modelName);
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

export async function handleContinueChat(request, sendResponse, signal, onDelta = null) {
    try {
        const storage = await getStorage([
            'interactionMode', 'customPrompt', 'selectedModel', 'selectedMode',
            'customModes', ...PROVIDER_STORAGE_KEYS
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
            sendResponse({ success: true, answer, model: responseModel, responseModel, selectedModel: modelName, guestInfo, tokenUsage, usedOCR: request.usedOCR === true });
            return;
        }

        const activeKeyOrHost = getProviderCredential(modelName, storage);
        if (!activeKeyOrHost) {
            throw missingCredentialError(modelName);
        }

        const mode = request.mode || storage.selectedMode || storage.interactionMode || 'short';
        const aiService = getAIService(activeKeyOrHost, modelName, mode, storage.customPrompt, storage.customModes);
        const optimizedHistory = getBudgetedMessages(request.history, modelName, mode);
        const result = await aiService.chat(optimizedHistory, signal, typeof onDelta === 'function' ? onDelta : null);
        sendResponse({ success: true, answer: result.text, model: modelName, responseModel: result.model, tokenUsage: result.tokenUsage, usedOCR: request.usedOCR === true });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

export async function handleProviderConfigCheck(request, sendResponse) {
    try {
        const storage = await getStorage([...PROVIDER_STORAGE_KEYS, 'selectedModel', 'selectedMode', 'interactionMode']);
        const requestedModel = request.model || storage.selectedModel || GUEST_DEFAULT_MODEL;
        const modelName = requestedModel;
        const currentMode = storage.selectedMode || storage.interactionMode || 'short';

        const requirement = getProviderRequirement(modelName);
        const providerName = requirement.isHost ? 'Ollama Host' : `${requirement.label} Key`;
        const isConfigured = requirement.guestCapable
            ? (!!storage[requirement.storageKey] || isGuestConfigured())
            : !!storage[requirement.storageKey];

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

export async function handleAIRequest(inputContent, type, explicitModel, sendResponse, ocrConfidence, explicitMode, signal = null, sourceBase64Image = null) {
    try {
        const storage = await getStorage([
            'interactionMode', 'customPrompt', 'selectedModel', 'selectedMode',
            'customModes', ...PROVIDER_STORAGE_KEYS
        ]);
        const mode = explicitMode || storage.selectedMode || storage.interactionMode || 'short';
        const requestedModelName = explicitModel || storage.selectedModel || GUEST_DEFAULT_MODEL;
        const inGuestMode = await isGuestMode();
        const modelName = requestedModelName;
        const usedOCR = type === 'text' && Boolean(sourceBase64Image);

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

            assertGuestCanServe(requestedModelName);
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
                usedOCR,
                ocrConfidence,
                base64Image: sourceBase64Image || (type === 'image' ? inputContent : null),
                guestInfo,
                tokenUsage
            });
            return;
        }

        const activeKeyOrHost = getProviderCredential(modelName, storage);
        if (!activeKeyOrHost) {
            throw missingCredentialError(modelName);
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
            usedOCR,
            ocrConfidence,
            base64Image: sourceBase64Image || (type === 'image' ? inputContent : null)
        });
    } catch (error) {
        sendResponse({ success: false, error: error.message || String(error) });
    }
}

export async function handleMultiImageRequest(images, explicitModel, textContext, sendResponse, explicitMode, signal = null, onDelta = null) {
    try {
        const storage = await getStorage([
            'interactionMode', 'customPrompt', 'selectedModel', 'selectedMode',
            'customModes', ...PROVIDER_STORAGE_KEYS
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

            assertGuestCanServe(requestedModelName);
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
            throw missingCredentialError(modelName);
        }

        const aiService = getAIService(activeKeyOrHost, modelName, mode, storage.customPrompt, storage.customModes);
        const contentArray = [];
        contentArray.push({ type: 'text', text: textContext || `Analyze these ${images.length} images and provide a helpful response.` });
        for (const img of images) {
            contentArray.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } });
        }

        const messages = [{ role: 'user', content: contentArray }];
        const optimizedMessages = getBudgetedMessages(messages, modelName, mode);
        const result = await aiService.chat(optimizedMessages, signal, typeof onDelta === 'function' ? onDelta : null);

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
