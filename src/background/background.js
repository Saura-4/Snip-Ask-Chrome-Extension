// src/background/background.js

import { getAIService } from './ai-service.js';
import { isGuestMode, isGuestConfigured, makeGuestRequest, GUEST_DEFAULT_MODEL } from './guest-config.js';
import { getChatWindowModels, checkGuestModeStatus } from './models-config.js';

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

// --- CONTEXT MENU & KEYBOARD SHORTCUTS ---

// Create context menu on install
chrome.runtime.onInstalled.addListener(async (details) => {
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
                    'src/content/utils.js',
                    'src/content/ui-helpers.js',
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
                        'src/content/utils.js',
                        'src/content/ui-helpers.js',
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

        handleAIRequest(content, type, request.model, sendResponse, ocrConfidence);
        return true;
    }

    // --- C2. MULTI-IMAGE AI REQUEST (for compare window) ---
    if (request.action === "ASK_AI_MULTI_IMAGE") {
        handleMultiImageRequest(request.images, request.model, request.textContext, sendResponse);
        return true;
    }

    // --- D. CHAT CONTINUATION (REPLY) ---
    if (request.action === "CONTINUE_CHAT") {
        (async () => {
            try {
                const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel', 'selectedMode', 'customModes', 'groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);

                let modelName = request.model || storage.selectedModel;

                // Check if this is a Groq model and if we need demo mode
                const isOllama = modelName && modelName.startsWith('ollama:');
                const isOpenRouter = modelName && modelName.startsWith('openrouter:');
                const isGoogle = modelName && (modelName.includes('gemini') || modelName.includes('gemma'));
                const isGroq = !isOllama && !isOpenRouter && !isGoogle;

                // Check if we should use demo mode for this request
                if (isGroq && !storage.groqKey && isGuestConfigured()) {
                    // Demo mode: use Cloudflare Worker for follow-up chat
                    // parallelCount: how many requests to count (for comparison mode)
                    // 0 means don't count this request (companion in parallel batch)
                    const parallelCount = request.parallelCount ?? 1;

                    // Use mode from request (mode selector), fallback to storage
                    const mode = request.mode || storage.selectedMode || storage.interactionMode || 'short';
                    const customModes = storage.customModes || null;

                    // Build system prompt based on mode (guest mode doesn't use aiService, so we add manually)
                    let systemPrompt = 'This is a POPUP WINDOW. Analyze the input and provide a helpful, concise response (under 200 words). Be direct and focused.';
                    if (mode === 'short') systemPrompt = "POPUP WINDOW: Concise answer engine. Keep under 100 words. For MCQs: 'Answer: <option>. <one-sentence explanation>'. For other questions: direct answer only. No preamble, no elaboration.";
                    else if (mode === 'detailed') systemPrompt = "POPUP TUTOR: Provide a focused, step-by-step answer. Use concise bullet points. Limit to 3-5 key steps max. Use Markdown sparingly (bold for emphasis only).";
                    else if (mode === 'code') systemPrompt = "POPUP CODE ASSISTANT: Provide ESSENTIAL CODE ONLY - no exhaustive examples. Output ONE clean code block + 1-2 sentences explaining the key fix/concept. Be concise.";
                    else if (mode === 'custom' && storage.customPrompt) {
                        // Use user's custom prompt
                        systemPrompt = storage.customPrompt;
                    } else if (customModes) {
                        // Check for user-created custom mode
                        const customMode = customModes.find(m => m.id === mode);
                        if (customMode) systemPrompt = customMode.prompt;
                    }

                    // Prepend system message to history
                    const messagesWithSystem = [
                        { role: 'system', content: systemPrompt },
                        ...request.history
                    ];

                    const guestResponse = await makeGuestRequest({
                        model: modelName || GUEST_DEFAULT_MODEL,
                        messages: messagesWithSystem,
                        temperature: 0.3,
                        max_tokens: mode === 'short' ? 512 : (mode === 'code' ? 2048 : 1536),
                        _meta: { parallelCount } // Pass to worker for proper counting
                    });

                    let answer = guestResponse.choices?.[0]?.message?.content || 'No answer returned.';

                    // Strip thinking tags from Qwen models
                    answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

                    // Extract token usage from Groq response
                    const tokenUsage = guestResponse.usage ? {
                        promptTokens: guestResponse.usage.prompt_tokens || 0,
                        completionTokens: guestResponse.usage.completion_tokens || 0,
                        totalTokens: guestResponse.usage.total_tokens || 0
                    } : null;

                    sendResponse({ success: true, answer: answer, guestInfo: guestResponse._demo, tokenUsage: tokenUsage });
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

                // Use mode from request (set by mode selector), fallback to storage
                const mode = request.mode || storage.selectedMode || storage.interactionMode || 'short';
                const aiService = getAIService(activeKeyOrHost, modelName, mode, storage.customPrompt, storage.customModes);

                const result = await aiService.chat(request.history);
                sendResponse({ success: true, answer: result.text, tokenUsage: result.tokenUsage });

            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
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
                const storage = await getStorage(['groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost', 'selectedModel']);
                let modelName = request.model || storage.selectedModel || 'meta-llama/llama-4-scout-17b-16e-instruct';

                // Determine which provider this model needs
                const isOllama = modelName.startsWith('ollama:');
                const isOpenRouter = modelName.startsWith('openrouter:');
                const isGoogle = modelName.includes('gemini') || modelName.includes('gemma');
                const isGroq = !isOllama && !isOpenRouter && !isGoogle;

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
                        // Force model to Groq-compatible in Guest Mode mode
                        modelName = GUEST_DEFAULT_MODEL;
                    }
                    providerName = 'Groq Key';
                }

                sendResponse({
                    success: true,
                    isConfigured,
                    providerName,
                    model: modelName
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
                const models = getChatWindowModels(enabledProviders, enabledModels, inGuestMode);

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

async function handleAIRequest(inputContent, type, explicitModel, sendResponse, ocrConfidence) {
    try {
        const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel', 'selectedMode', 'customModes', 'groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);
        const mode = storage.selectedMode || storage.interactionMode || 'short';

        let modelName = explicitModel || storage.selectedModel || "meta-llama/llama-4-scout-17b-16e-instruct";

        // CHECK FOR FREE TRIAL MODE
        const inGuestMode = await isGuestMode();

        if (inGuestMode) {
            // Guest Mode: use Cloudflare Worker proxy
            if (!isGuestConfigured()) {
                throw new Error('Guest Mode is not available. Please add your own API key in the extension popup.');
            }

            // Force Groq model in demo mode
            if (!modelName || modelName.startsWith('openrouter:') || modelName.includes('gemini') || modelName.includes('gemma') || modelName.startsWith('ollama:')) {
                modelName = GUEST_DEFAULT_MODEL;
            }

            // Build request body for Cloudflare Worker
            const messages = [];

            // Add system instruction
            const customModes = storage.customModes || null;
            let systemPrompt = 'This is a POPUP WINDOW. Analyze the input and provide a helpful, concise response (under 200 words).';
            if (mode === 'short') systemPrompt = "POPUP WINDOW: Concise answer engine. Keep under 100 words. For MCQs: 'Answer: <option>. <one-sentence explanation>'. For other questions: direct answer only. No preamble, no elaboration.";
            else if (mode === 'detailed') systemPrompt = "POPUP TUTOR: Provide a focused, step-by-step answer. Use concise bullet points. Limit to 3-5 key steps max. Use Markdown sparingly (bold for emphasis only).";
            else if (mode === 'code') systemPrompt = "POPUP CODE ASSISTANT: Provide ESSENTIAL CODE ONLY - no exhaustive examples. Output ONE clean code block + 1-2 sentences explaining the key fix/concept. Be concise.";
            else if (mode === 'custom' && storage.customPrompt) {
                // Use user's custom prompt
                systemPrompt = storage.customPrompt;
            } else if (customModes) {
                const customMode = customModes.find(m => m.id === mode);
                if (customMode) systemPrompt = customMode.prompt;
            }

            messages.push({ role: 'system', content: systemPrompt });

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
            const guestResponse = await makeGuestRequest({
                model: modelName,
                messages: messages,
                temperature: 0.3,
                max_tokens: mode === 'short' ? 512 : (mode === 'code' ? 2048 : 1536)
            });

            let answer = guestResponse.choices?.[0]?.message?.content || 'No answer returned.';

            // Strip thinking tags from Qwen models
            answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

            const guestInfo = guestResponse._demo || null;

            // Extract token usage from Groq response
            const tokenUsage = guestResponse.usage ? {
                promptTokens: guestResponse.usage.prompt_tokens || 0,
                completionTokens: guestResponse.usage.completion_tokens || 0,
                totalTokens: guestResponse.usage.total_tokens || 0
            } : null;

            sendResponse({
                success: true,
                answer: answer,
                initialUserMessage: messages[messages.length - 1],
                usedOCR: type === 'text',
                ocrConfidence,
                base64Image: type === 'image' ? inputContent : null,
                guestInfo: guestInfo,
                tokenUsage: tokenUsage
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
            result = await aiService.askImage(inputContent);
        } else {
            result = await aiService.askText(inputContent);
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

async function handleMultiImageRequest(images, explicitModel, textContext, sendResponse) {
    try {
        const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel', 'selectedMode', 'customModes', 'groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);
        const mode = storage.selectedMode || storage.interactionMode || 'short';

        let modelName = explicitModel || storage.selectedModel || "meta-llama/llama-4-scout-17b-16e-instruct";

        // CHECK FOR FREE TRIAL MODE
        const inGuestMode = await isGuestMode();

        if (inGuestMode) {
            // Guest Mode: use Cloudflare Worker proxy
            if (!isGuestConfigured()) {
                throw new Error('Guest Mode is not available. Please add your own API key in the extension popup.');
            }

            // Force Groq model in demo mode
            if (!modelName || modelName.startsWith('openrouter:') || modelName.includes('gemini') || modelName.includes('gemma') || modelName.startsWith('ollama:')) {
                modelName = GUEST_DEFAULT_MODEL;
            }

            // Build request body with multiple images
            const messages = [];

            // Add system instruction
            const customModes = storage.customModes || null;
            let systemPrompt = 'This is a POPUP WINDOW. Analyze the input and provide a helpful, concise response (under 200 words).';
            if (mode === 'short') systemPrompt = "POPUP WINDOW: Concise answer engine. Keep under 100 words. For MCQs: 'Answer: <option>. <one-sentence explanation>'. For other questions: direct answer only. No preamble, no elaboration.";
            else if (mode === 'detailed') systemPrompt = "POPUP TUTOR: Provide a focused, step-by-step answer. Use concise bullet points. Limit to 3-5 key steps max. Use Markdown sparingly (bold for emphasis only).";
            else if (mode === 'code') systemPrompt = "POPUP CODE ASSISTANT: Provide ESSENTIAL CODE ONLY - no exhaustive examples. Output ONE clean code block + 1-2 sentences explaining the key fix/concept. Be concise.";
            else if (mode === 'custom' && storage.customPrompt) {
                // Use user's custom prompt
                systemPrompt = storage.customPrompt;
            } else if (customModes) {
                const customMode = customModes.find(m => m.id === mode);
                if (customMode) systemPrompt = customMode.prompt;
            }

            messages.push({ role: 'system', content: systemPrompt });

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

            // Make demo request through Cloudflare Worker
            const guestResponse = await makeGuestRequest({
                model: modelName,
                messages: messages,
                temperature: 0.3,
                max_tokens: mode === 'short' ? 512 : (mode === 'code' ? 2048 : 1536)
            });

            let answer = guestResponse.choices?.[0]?.message?.content || 'No answer returned.';

            // Strip thinking tags from Qwen models
            answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

            const guestInfo = guestResponse._demo || null;

            // Extract token usage from Groq response
            const tokenUsage = guestResponse.usage ? {
                promptTokens: guestResponse.usage.prompt_tokens || 0,
                completionTokens: guestResponse.usage.completion_tokens || 0,
                totalTokens: guestResponse.usage.total_tokens || 0
            } : null;

            sendResponse({
                success: true,
                answer: answer,
                initialUserMessage: messages[messages.length - 1],
                imageCount: images.length,
                guestInfo: guestInfo,
                tokenUsage: tokenUsage
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

        const answer = await aiService.chat(messages);
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