// src/background/background.js

import { getAIService } from './ai-service.js';
import { isGuestMode, isGuestConfigured, getGuestUsage, makeGuestRequest, GUEST_DEFAULT_MODEL, GUEST_DAILY_LIMIT } from './guest-config.js';

// ============================================================================
// 1. UTILITIES
// ============================================================================

function getStorage(keys) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(keys, (items) => resolve(items || {}));
        } catch (e) {
            resolve({});
        }
    });
}

// ============================================================================
// 2. CONTEXT MENU & KEYBOARD SHORTCUTS
// ============================================================================

// Create context menu on install and show welcome page
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

    // Open welcome page only on first install AND if no API keys configured AND demo mode not available
    if (details.reason === 'install') {
        const keyCheck = await getStorage(['groqKey', 'geminiKey', 'openrouterKey']);
        const hasKey = keyCheck.groqKey || keyCheck.geminiKey || keyCheck.openrouterKey;
        const guestAvailable = isGuestConfigured();

        // Don't open welcome page if user has keys OR guest mode is available
        if (!hasKey && !guestAvailable) {
            chrome.tabs.create({
                url: chrome.runtime.getURL('src/welcome/welcome.html')
            });
        }
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
                files: ['src/content/utils.js', 'src/content/content.js']
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
                    files: ['src/content/utils.js', 'src/content/content.js']
                });
                await chrome.tabs.sendMessage(tab.id, { action: "START_SNIP" });
            }
        }
    }
});

// ============================================================================
// 3. OFFSCREEN DOCUMENT MANAGER
// ============================================================================

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

// ============================================================================
// 4. MESSAGE LISTENER
// ============================================================================

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
                    const guestResponse = await makeGuestRequest({
                        model: modelName || GUEST_DEFAULT_MODEL,
                        messages: request.history,
                        temperature: 0.3,
                        max_tokens: 1024
                    });

                    let answer = guestResponse.choices?.[0]?.message?.content || 'No answer returned.';

                    // Strip thinking tags from Qwen models
                    answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

                    sendResponse({ success: true, answer: answer, demoInfo: guestResponse._demo });
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

                const mode = storage.selectedMode || storage.interactionMode || 'short';
                const aiService = getAIService(activeKeyOrHost, modelName, mode, storage.customPrompt, storage.customModes);

                const answer = await aiService.chat(request.history);
                sendResponse({ success: true, answer: answer });

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

    // --- G. CHECK PROVIDER CONFIGURATION (Security: never expose keys to content script) ---
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
                    isConfigured = !!(storage.ollamaHost || 'http://localhost:11434');
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

    // --- H. DEMO MODE STATUS CHECK ---
    if (request.action === "CHECK_GUEST_STATUS") {
        (async () => {
            try {
                const inGuestMode = await isGuestMode();
                const isConfigured = isGuestConfigured();
                const usage = await getGuestUsage();

                sendResponse({
                    success: true,
                    isDemoMode: inGuestMode,
                    isConfigured,
                    usage: usage.count,
                    remaining: usage.remaining,
                    limit: usage.limit,
                    defaultModel: GUEST_DEFAULT_MODEL
                });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }
});

// ============================================================================
// 5. AI REQUEST HANDLER
// ============================================================================

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
            let systemPrompt = 'Analyze the input and provide a helpful response.';
            if (mode === 'short') systemPrompt = "You are a concise answer engine. Analyze the user's input. If it is a multiple-choice question, output 'Answer: <option>. <explanation>'. For follow-up chat, reply concisely.";
            else if (mode === 'detailed') systemPrompt = "You are an expert tutor. Analyze the input. Provide a detailed, step-by-step answer. Use Markdown.";
            else if (mode === 'code') systemPrompt = "You are a code debugger. Correct the code and explain the fix. Output a single fenced code block first.";
            else if (customModes) {
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
                max_tokens: 1024
            });

            let answer = guestResponse.choices?.[0]?.message?.content || 'No answer returned.';

            // Strip thinking tags from Qwen models
            answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

            const demoInfo = guestResponse._demo || null;

            sendResponse({
                success: true,
                answer: answer,
                initialUserMessage: messages[messages.length - 1],
                usedOCR: type === 'text',
                ocrConfidence,
                base64Image: type === 'image' ? inputContent : null,
                demoInfo: demoInfo
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