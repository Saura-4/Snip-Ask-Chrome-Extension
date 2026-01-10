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
    if (request.action === "ASK_GROQ" || request.action === "ASK_GROQ_TEXT") {
        const type = request.action === "ASK_GROQ_TEXT" ? 'text' : 'image';
        const content = type === 'text' ? request.text : request.base64Image;
        const ocrConfidence = request.ocrConfidence || null;

        // Note: content.js sends 'apiKey', but we double-check in handleAIRequest to ensure we use the right one
        handleAIRequest(request.apiKey, content, type, request.model, sendResponse, ocrConfidence);
        return true; 
    }

    // --- D. CHAT CONTINUATION (REPLY) ---
    if (request.action === "CONTINUE_CHAT") {
        (async () => {
            try {
                // Load keys and settings to ensure we have the latest
                const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel', 'groqKey', 'geminiKey']);
                
                // Determine Key
                const modelName = request.model || storage.selectedModel;
                const isGoogle = modelName.includes('gemini') || modelName.includes('gemma');
                const activeKey = isGoogle ? storage.geminiKey : storage.groqKey;

                if (!activeKey) throw new Error(`Missing API Key for ${isGoogle ? 'Google' : 'Groq'}`);

                const aiService = getAIService(activeKey, modelName, storage.interactionMode, storage.customPrompt);
                
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
async function handleAIRequest(passedApiKey, inputContent, type, explicitModel, sendResponse, ocrConfidence) {
    try {
        const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel', 'groqKey', 'geminiKey']);
        const mode = storage.interactionMode || 'short';
        
        const modelName = explicitModel || storage.selectedModel || "meta-llama/llama-4-scout-17b-16e-instruct";

        // === KEY SELECTION LOGIC ===
        // We ignore the 'passedApiKey' if it doesn't match the model provider requirements, 
        // prioritizing the secure storage keys.
        const isGoogle = modelName.includes('gemini') || modelName.includes('gemma');
        let activeKey = isGoogle ? storage.geminiKey : storage.groqKey;

        // Fallback: if storage was empty but content.js passed one (rare), use it
        if (!activeKey && passedApiKey) activeKey = passedApiKey;

        if (!activeKey) {
            throw new Error(`Missing API Key. Please add your ${isGoogle ? 'Google' : 'Groq'} Key in the extension popup.`);
        }

        const aiService = getAIService(activeKey, modelName, mode, storage.customPrompt);

        console.log(`[Background] Asking AI: Model=${modelName}, Mode=${mode}, Type=${type}`);

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