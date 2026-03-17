// src/background/background.js

import { getAIService, optimizeMessageHistory } from './ai-service.js';
import { isGuestMode, isGuestConfigured, makeGuestRequest, GUEST_DEFAULT_MODEL } from './guest-config.js';
import { getChatWindowModels, checkGuestModeStatus } from './models-config.js';
import { isGoogleModel, isGroqModel, isOllamaModel, isOpenRouterModel } from './model-routing.js';
import { buildGuestRequestPayload, buildGuestSystemPrompt } from './guest-request.js';
import { parseGuestResponse } from './guest-response.js';

// --- UTILITIES ---

function getStorage(keys) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(keys, (items) => resolve(items || {}));
        } catch (e) {
            resolve({});
        }
    });
}

// --- ABORT CONTROLLER TRACKING ---
// Tracks all in-progress AI requests so they can be cancelled by the user
const activeAbortControllers = new Set();

function createTrackedAbortController() {
    const controller = new AbortController();
    activeAbortControllers.add(controller);
    return controller;
}

function removeTrackedController(controller) {
    activeAbortControllers.delete(controller);
}

function cancelAllActiveRequests() {
    for (const controller of activeAbortControllers) {
        controller.abort();
    }
    activeAbortControllers.clear();
}

// --- CONTEXT MENU & KEYBOARD SHORTCUTS ---

// Create context menu on install
chrome.runtime.onInstalled.addListener(async (details) => {
    // Open setup guide on fresh install only (not on updates)
    if (details.reason === 'install') {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/setupguide/setupguide.html') });
    }

    // Check if context menu should be hidden
    const storage = await getStorage(['hideContextMenu']);
    if (!storage.hideContextMenu) {
        // Create context menu (without showing selected text - user already knows what they selected)
        chrome.contextMenus.create({
            id: "askAI",
            title: "Ask AI about selection",
            contexts: ["selection"]
        });
    }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // Prevent errors on restricted pages (Chrome store, Settings, etc.)
    if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") ||
        tab.url.startsWith("https://chrome.google.com/webstore") || tab.url.startsWith("edge://") ||
        tab.url.startsWith("about:")) {
        console.warn("Snip & Ask: Cannot run on this restricted page");
        return;
    }

    if (info.menuItemId === "askAI" && info.selectionText) {
        // Send selected text to content script for display
        try {
            await chrome.tabs.sendMessage(tab.id, {
                action: "SHOW_AI_RESPONSE_FOR_TEXT",
                text: info.selectionText
            });
        } catch (e) {
            // Content script not loaded, inject it first
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: [
                    'lib/katex.min.js',
                    'lib/purify.min.js',
                    'src/content/utils.js',
                    'src/content/ui-helpers.js',
                    'src/content/chat-message-utils.js',
                    'src/content/chat-render-utils.js',
                    'src/content/window-manager.js',
                    'src/content/snip-selection.js',
                    'src/content/floating-chat-ui.js',
                    'src/content/content.js'
                ]
            });
            await chrome.tabs.sendMessage(tab.id, {
                action: "SHOW_AI_RESPONSE_FOR_TEXT",
                text: info.selectionText
            });
        }
    }
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
    if (command === "start-snip") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            // Prevent errors on restricted pages
            if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") ||
                tab.url.startsWith("https://chrome.google.com/webstore") || tab.url.startsWith("edge://") ||
                tab.url.startsWith("about:")) {
                console.warn("Snip & Ask: Cannot run on this restricted page");
                return;
            }

            try {
                await chrome.tabs.sendMessage(tab.id, { action: "START_SNIP" });
            } catch (e) {
                // Content script not loaded, inject it first
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: [
                        'lib/katex.min.js',
                        'lib/purify.min.js',
                        'src/content/utils.js',
                        'src/content/ui-helpers.js',
                        'src/content/chat-message-utils.js',
                        'src/content/chat-render-utils.js',
                        'src/content/window-manager.js',
                        'src/content/snip-selection.js',
                        'src/content/floating-chat-ui.js',
                        'src/content/content.js'
                    ]
                });
                await chrome.tabs.sendMessage(tab.id, { action: "START_SNIP" });
            }
        }
    }
});

// --- OFFSCREEN DOCUMENT MANAGER ---

let creating;

async function setupOffscreenDocument(path) {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) return;

    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: path,
            reasons: ['BLOBS'],
            justification: 'OCR processing for image to text conversion',
        });
        await creating;
        creating = null;
    }
}

// --- MESSAGE LISTENER ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // --- A. SCREENSHOT HANDLER ---
    if (request.action === "CAPTURE_VISIBLE_TAB") {
        chrome.tabs.captureVisibleTab(null, {
            format: "jpeg",
            quality: 80
        }, (dataUrl) => {
            sendResponse({ dataUrl: dataUrl });
        });
        return true;
    }

    // --- B. OCR HANDLER ---
    if (request.action === "PERFORM_OCR") {
        (async () => {
            try {
                await setupOffscreenDocument('src/offscreen/offscreen.html');
                const response = await chrome.runtime.sendMessage({
                    action: 'OCR_Request',
                    base64Image: request.base64Image
                });
                sendResponse(response);
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // --- C. AI REQUEST HANDLER (Initial Snip or Text Selection) ---
    if (request.action === "ASK_AI" || request.action === "ASK_AI_TEXT") {
        const type = request.action === "ASK_AI_TEXT" ? 'text' : 'image';
        const content = type === 'text' ? request.text : request.base64Image;
        const ocrConfidence = request.ocrConfidence || null;
        const controller = createTrackedAbortController();

        handleAIRequest(content, type, request.model, sendResponse, ocrConfidence, request.mode, controller.signal)
            .finally(() => removeTrackedController(controller));
        return true;
    }

    // --- C2. MULTI-IMAGE AI REQUEST (for compare window) ---
    if (request.action === "ASK_AI_MULTI_IMAGE") {
        const controller = createTrackedAbortController();
        handleMultiImageRequest(request.images, request.model, request.textContext, sendResponse, request.mode, controller.signal)
            .finally(() => removeTrackedController(controller));
        return true;
    }

    // --- D. CHAT CONTINUATION (REPLY) ---
    if (request.action === "CONTINUE_CHAT") {
        const controller = createTrackedAbortController();
        (async () => {
            try {
                const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel', 'selectedMode', 'customModes', 'groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);

                let modelName = request.model || storage.selectedModel;

                // Check if this is a Groq model and if we need demo mode
                const isOllama = isOllamaModel(modelName);
                const isOpenRouter = isOpenRouterModel(modelName);
                const isGoogle = isGoogleModel(modelName);
                const isGroq = isGroqModel(modelName);

                // Check if we should use demo mode for this request
                if (isGroq && !storage.groqKey && isGuestConfigured()) {
                    // Demo mode: use Cloudflare Worker for follow-up chat
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
                        parallelCount,
                        optimize: true
                    });

                    const guestResponse = await makeGuestRequest(guestRequest.payload, controller.signal);

                    const { answer, guestInfo, tokenUsage } = parseGuestResponse(guestResponse);

                    sendResponse({
                        success: true,
                        answer,
                        guestInfo,
                        tokenUsage
                    });
                    return;
                }

                // Regular mode with user API keys
                let activeKeyOrHost;
                if (isOllama) activeKeyOrHost = storage.ollamaHost || "http://localhost:11434";
                else if (isOpenRouter) activeKeyOrHost = storage.openrouterKey;
                else if (isGoogle) activeKeyOrHost = storage.geminiKey;
                else activeKeyOrHost = storage.groqKey;

                if (!activeKeyOrHost) {
                    throw new Error('Missing API key. Please configure your API keys in the extension popup.');
                }

                const mode = request.mode || storage.selectedMode || storage.interactionMode || 'short';
                const aiService = getAIService(activeKeyOrHost, modelName, mode, storage.customPrompt, storage.customModes);

                const optimizedHistory = optimizeMessageHistory(request.history, modelName);
                const result = await aiService.chat(optimizedHistory, controller.signal);
                sendResponse({ success: true, answer: result.text, tokenUsage: result.tokenUsage });

            } catch (err) {
                sendResponse({ success: false, error: err.message });
            } finally {
                removeTrackedController(controller);
            }
        })();
        return true;
    }

    // --- CANCEL AI REQUEST HANDLER ---
    if (request.action === "CANCEL_AI_REQUEST") {
        cancelAllActiveRequests();
        sendResponse({ success: true });
        return true;
    }

    // --- E. CONTEXT MENU VISIBILITY TOGGLE ---
    if (request.action === "UPDATE_CONTEXT_MENU") {
        if (request.hide) {
            // Remove context menu
            chrome.contextMenus.remove("askAI", () => {
                if (chrome.runtime.lastError) {
                    // Menu didn't exist, ignore
                }
            });
        } else {
            // Create context menu
            chrome.contextMenus.create({
                id: "askAI",
                title: "Ask AI about selection",
                contexts: ["selection"]
            }, () => {
                if (chrome.runtime.lastError) {
                    // Menu already exists, ignore
                }
            });
        }
        return false;
    }

    // --- F. OPEN OPTIONS PAGE (from content script) ---
    if (request.action === "OPEN_OPTIONS_PAGE") {
        chrome.action.openPopup();
        return false;
    }

    // --- G. CHECK PROVIDER CONFIG (keys never touch content script) ---
    if (request.action === "CHECK_PROVIDER_CONFIG") {
        (async () => {
            try {
                const storage = await getStorage(['groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost', 'selectedModel', 'selectedMode', 'interactionMode']);
                let modelName = request.model || storage.selectedModel || 'meta-llama/llama-4-scout-17b-16e-instruct';

                // Resolve current mode for the caller
                const currentMode = storage.selectedMode || storage.interactionMode || 'short';

                // Determine which provider this model needs
                const isOllama = isOllamaModel(modelName);
                const isOpenRouter = isOpenRouterModel(modelName);
                const isGoogle = isGoogleModel(modelName);
                const isGroq = isGroqModel(modelName);

                let isConfigured = false;
                let providerName = 'Groq';

                if (isOllama) {
                    isConfigured = !!storage.ollamaHost;
                    providerName = 'Ollama Host';
                } else if (isOpenRouter) {
                    isConfigured = !!storage.openrouterKey;
                    providerName = 'OpenRouter Key';
                } else if (isGoogle) {
                    isConfigured = !!storage.geminiKey;
                    providerName = 'Google Key';
                } else {
                    // Groq - check for user key OR demo mode
                    if (storage.groqKey) {
                        isConfigured = true;
                    } else if (isGuestConfigured()) {
                        // Guest Mode mode is available - user can use Groq without their own key
                        isConfigured = true;
                        // Do NOT force a single model here. In guest mode we still want to respect
                        // the user's selected Groq model if it's already Groq-compatible.
                        // Background request handlers will still fall back to GUEST_DEFAULT_MODEL
                        // if the user selected a non-Groq model.
                    }
                    providerName = 'Groq Key';
                }

                sendResponse({
                    success: true,
                    isConfigured,
                    providerName,
                    model: modelName,
                    mode: currentMode
                });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // --- H. GUEST MODE STATUS CHECK ---
    if (request.action === "CHECK_GUEST_STATUS") {
        (async () => {
            try {
                const inGuestMode = await isGuestMode();
                const isConfigured = isGuestConfigured();

                sendResponse({
                    success: true,
                    isGuestMode: inGuestMode,
                    isDemoMode: inGuestMode,
                    isConfigured,
                    defaultModel: GUEST_DEFAULT_MODEL
                });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // --- I. GET CHAT WINDOW MODELS (centralized model list for content.js) ---
    if (request.action === "GET_CHAT_WINDOW_MODELS") {
        (async () => {
            try {
                const storage = await getStorage(['enabledProviders', 'enabledModels']);
                const { isGuestMode: inGuestMode } = await checkGuestModeStatus();

                const enabledProviders = storage.enabledProviders || { groq: true };
                const enabledModels = storage.enabledModels || {};

                // Get filtered models using centralized logic
                const models = await getChatWindowModels(enabledProviders, enabledModels, inGuestMode);

                sendResponse({
                    success: true,
                    models,
                    isGuestMode: inGuestMode
                });
            } catch (err) {
                sendResponse({ success: false, error: err.message, models: [] });
            }
        })();
        return true;
    }
});

// --- AI REQUEST HANDLER ---

async function handleAIRequest(inputContent, type, explicitModel, sendResponse, ocrConfidence, explicitMode, signal = null) {
    try {
        const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel', 'selectedMode', 'customModes', 'groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);
        // Prioritize explicit mode from request, then storage values
        const mode = explicitMode || storage.selectedMode || storage.interactionMode || 'short';

        let modelName = explicitModel || storage.selectedModel || "meta-llama/llama-4-scout-17b-16e-instruct";

        // CHECK FOR FREE TRIAL MODE
        const inGuestMode = await isGuestMode();

        if (inGuestMode) {
            // Guest Mode: use Cloudflare Worker proxy
            if (!isGuestConfigured()) {
                throw new Error('Guest Mode is not available. Please add your own API key in the extension popup.');
            }

            // Force Groq model in demo mode
            const messages = [{ role: 'system', content: buildGuestSystemPrompt(mode, storage) }];

            // Add user message
            if (type === 'image') {
                messages.push({
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Analyze this image and provide a helpful response.' },
                        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${inputContent}` } }
                    ]
                });
            } else {
                messages.push({ role: 'user', content: inputContent });
            }

            // Make demo request through Cloudflare Worker
            const guestRequest = buildGuestRequestPayload({
                modelName,
                mode,
                storage,
                messages
            });
            const guestResponse = await makeGuestRequest(guestRequest.payload, signal);

            const { answer, guestInfo, tokenUsage } = parseGuestResponse(guestResponse);

            sendResponse({
                success: true,
                answer,
                initialUserMessage: messages[messages.length - 1],
                usedOCR: type === 'text',
                ocrConfidence,
                base64Image: type === 'image' ? inputContent : null,
                guestInfo,
                tokenUsage
            });
            return;
        }

        // REGULAR MODE: KEY/HOST SELECTION LOGIC
        let activeKeyOrHost;
        if (modelName.startsWith('ollama:')) {
            activeKeyOrHost = storage.ollamaHost || "http://localhost:11434";
        }
        else if (modelName.startsWith('openrouter:')) {
            activeKeyOrHost = storage.openrouterKey;
        }
        else if (modelName.includes('gemini') || modelName.includes('gemma')) {
            activeKeyOrHost = storage.geminiKey;
        }
        else {
            activeKeyOrHost = storage.groqKey;
        }

        if (!activeKeyOrHost) {
            throw new Error(`Missing Configuration. Please configure your API keys in the extension popup.`);
        }

        const aiService = getAIService(activeKeyOrHost, modelName, mode, storage.customPrompt, storage.customModes);

        let result;
        if (type === 'image') {
            result = await aiService.askImage(inputContent, signal);
        } else {
            result = await aiService.askText(inputContent, signal);
        }

        sendResponse({
            success: true,
            answer: result.answer,
            model: result.model,
            tokenUsage: result.tokenUsage,
            initialUserMessage: result.initialUserMessage,
            usedOCR: type === 'text',
            ocrConfidence,
            base64Image: type === 'image' ? inputContent : null
        });

    } catch (error) {
        sendResponse({
            success: false,
            error: error.message || String(error)
        });
    }
}

// --- MULTI-IMAGE REQUEST HANDLER ---

async function handleMultiImageRequest(images, explicitModel, textContext, sendResponse, explicitMode, signal = null) {
    try {
        const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel', 'selectedMode', 'customModes', 'groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);
        // Prioritize explicit mode from request, then storage values
        const mode = explicitMode || storage.selectedMode || storage.interactionMode || 'short';

        let modelName = explicitModel || storage.selectedModel || "meta-llama/llama-4-scout-17b-16e-instruct";

        // CHECK FOR FREE TRIAL MODE
        const inGuestMode = await isGuestMode();

        if (inGuestMode) {
            // Guest Mode: use Cloudflare Worker proxy
            if (!isGuestConfigured()) {
                throw new Error('Guest Mode is not available. Please add your own API key in the extension popup.');
            }

            // Force Groq model in demo mode
            const messages = [{ role: 'system', content: buildGuestSystemPrompt(mode, storage) }];

            // Build content array with text and all images
            const contentArray = [];

            // Add text context first
            const contextText = textContext || `Analyze these ${images.length} images and provide a helpful response.`;
            contentArray.push({ type: 'text', text: contextText });

            // Add all images
            for (const img of images) {
                contentArray.push({
                    type: 'image_url',
                    image_url: { url: `data:image/jpeg;base64,${img}` }
                });
            }

            messages.push({ role: 'user', content: contentArray });

            // Optimize history to stay within model token limits
            const guestRequest = buildGuestRequestPayload({
                modelName,
                mode,
                storage,
                messages,
                optimize: true
            });
            const guestResponse = await makeGuestRequest(guestRequest.payload, signal);

            const { answer, guestInfo, tokenUsage } = parseGuestResponse(guestResponse);

            sendResponse({
                success: true,
                answer,
                initialUserMessage: messages[messages.length - 1],
                imageCount: images.length,
                guestInfo,
                tokenUsage
            });
            return;
        }

        // REGULAR MODE: KEY/HOST SELECTION LOGIC
        let activeKeyOrHost;
        if (modelName.startsWith('ollama:')) {
            activeKeyOrHost = storage.ollamaHost || "http://localhost:11434";
        }
        else if (modelName.startsWith('openrouter:')) {
            activeKeyOrHost = storage.openrouterKey;
        }
        else if (modelName.includes('gemini') || modelName.includes('gemma')) {
            activeKeyOrHost = storage.geminiKey;
        }
        else {
            activeKeyOrHost = storage.groqKey;
        }

        if (!activeKeyOrHost) {
            throw new Error(`Missing Configuration. Please configure your API keys in the extension popup.`);
        }

        const aiService = getAIService(activeKeyOrHost, modelName, mode, storage.customPrompt, storage.customModes);

        // Use chat() with properly formatted messages including images and text context
        // Build a message with all images and the conversation context
        const contentArray = [];

        // Add text context (conversation history)
        if (textContext) {
            contentArray.push({ type: 'text', text: textContext });
        } else {
            contentArray.push({ type: 'text', text: `Analyze these ${images.length} images and provide a helpful response.` });
        }

        // Add all images
        for (const img of images) {
            contentArray.push({
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${img}` }
            });
        }

        // Use chat() which all services implement
        const messages = [
            { role: 'user', content: contentArray }
        ];

        // Optimize history to stay within model token limits
        const optimizedMessages = optimizeMessageHistory(messages, modelName);
        const answer = await aiService.chat(optimizedMessages, signal);
        const result = { answer: answer, initialUserMessage: messages[0] };

        sendResponse({
            success: true,
            answer: result.answer,
            initialUserMessage: result.initialUserMessage,
            imageCount: images.length
        });

    } catch (error) {
        sendResponse({
            success: false,
            error: error.message || String(error)
        });
    }
}
