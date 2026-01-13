// src/background/background.js

import { getAIService } from './ai-service.js';

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

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "askAI",
        title: "Ask AI about '%s'",
        contexts: ["selection"]
    });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
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

                const modelName = request.model || storage.selectedModel;

                let activeKeyOrHost;
                if (modelName.startsWith('ollama:')) activeKeyOrHost = storage.ollamaHost || "http://localhost:11434";
                else if (modelName.startsWith('openrouter:')) activeKeyOrHost = storage.openrouterKey;
                else if (modelName.includes('gemini') || modelName.includes('gemma')) activeKeyOrHost = storage.geminiKey;
                else activeKeyOrHost = storage.groqKey;

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
});

// ============================================================================
// 5. AI REQUEST HANDLER
// ============================================================================

async function handleAIRequest(inputContent, type, explicitModel, sendResponse, ocrConfidence) {
    try {
        const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel', 'selectedMode', 'customModes', 'groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);
        const mode = storage.selectedMode || storage.interactionMode || 'short';

        const modelName = explicitModel || storage.selectedModel || "meta-llama/llama-4-scout-17b-16e-instruct";

        // KEY/HOST SELECTION LOGIC
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