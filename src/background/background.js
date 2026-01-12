// src/background/background.js

import { getAIService } from './ai-service.js';

// 1. Helper to use chrome.storage.local.get with await
function getStorage(keys) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(keys, (items) => resolve(items || {}));
        } catch (e) {
            resolve({});
        }
    });
}

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

// 2. Main Message Listener
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
                console.error("Offscreen OCR Error:", err);
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // --- C. AI REQUEST HANDLER (Initial Snip) ---
    if (request.action === "ASK_AI" || request.action === "ASK_AI_TEXT") {
        const type = request.action === "ASK_AI_TEXT" ? 'text' : 'image';
        const content = type === 'text' ? request.text : request.base64Image;
        const ocrConfidence = request.ocrConfidence || null;

        // SECURITY: Keys are retrieved from storage, not passed via messages
        handleAIRequest(content, type, request.model, sendResponse, ocrConfidence);
        return true;
    }

    // --- D. CHAT CONTINUATION (REPLY) ---
    if (request.action === "CONTINUE_CHAT") {
        (async () => {
            try {
                const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel', 'groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);

                // Determine Key
                const modelName = request.model || storage.selectedModel;

                // Select appropriate key/host based on model type
                let activeKeyOrHost;
                if (modelName.startsWith('ollama:')) activeKeyOrHost = storage.ollamaHost || "http://localhost:11434";
                else if (modelName.startsWith('openrouter:')) activeKeyOrHost = storage.openrouterKey;
                else if (modelName.includes('gemini') || modelName.includes('gemma')) activeKeyOrHost = storage.geminiKey;
                else activeKeyOrHost = storage.groqKey;

                const aiService = getAIService(activeKeyOrHost, modelName, storage.interactionMode, storage.customPrompt);

                const answer = await aiService.chat(request.history);
                sendResponse({ success: true, answer: answer });

            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }
});


// 3. The Core Logic
// SECURITY: API keys are retrieved from storage only, never passed via messages
async function handleAIRequest(inputContent, type, explicitModel, sendResponse, ocrConfidence) {
    try {
        const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel', 'selectedMode', 'customModes', 'groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);
        const mode = storage.selectedMode || storage.interactionMode || 'short';

        const modelName = explicitModel || storage.selectedModel || "meta-llama/llama-4-scout-17b-16e-instruct";

        // === KEY/HOST SELECTION LOGIC (from secure storage only) ===
        let activeKeyOrHost;
        if (modelName.startsWith('ollama:')) {
            // For Ollama, we pass the Host URL
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

        // Pass customModes from storage to enable user-defined prompts
        const aiService = getAIService(activeKeyOrHost, modelName, mode, storage.customPrompt, storage.customModes);

        // Route to unified chat method or specific handlers
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
            ocrConfidence
        });

    } catch (error) {
        console.error("AI Service Error:", error);
        sendResponse({
            success: false,
            error: error.message || String(error)
        });
    }
}