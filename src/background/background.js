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

// --- OFFSCREEN DOCUMENT MANAGER (Robust Version) ---
let creating; // A promise to prevent race conditions

async function setupOffscreenDocument(path) {
    // Check if ANY offscreen doc already exists (not just by specific URL)
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        return; // Already exists, do nothing
    }

    // Create it if not
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
            sendResponse({
                dataUrl: dataUrl
            });
        });
        return true; 
    }

    // --- B. OCR HANDLER ---
    if (request.action === "PERFORM_OCR") {
        (async () => {
            try {
                // Robust setup
                await setupOffscreenDocument('src/offscreen/offscreen.html');

                // Send image to Offscreen
                const response = await chrome.runtime.sendMessage({
                    action: 'OCR_Request',
                    base64Image: request.base64Image
                });

                sendResponse(response);
            } catch (err) {
                console.error("Offscreen OCR Error:", err);
                sendResponse({
                    success: false,
                    error: err.message
                });
            }
        })();
        return true; 
    }

    // --- C. AI REQUEST HANDLER ---
    if (request.action === "ASK_GROQ" || request.action === "ASK_GROQ_TEXT") {
        const type = request.action === "ASK_GROQ_TEXT" ? 'text' : 'image';
        const content = type === 'text' ? request.text : request.base64Image;
        const ocrConfidence = request.ocrConfidence || null;

        handleAIRequest(request.apiKey, content, type, request.model, sendResponse, ocrConfidence);
        return true; 
    }
});


// 3. The Core Logic
async function handleAIRequest(apiKey, inputContent, type, explicitModel, sendResponse, ocrConfidence) {
    try {
        const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel']);
        const mode = storage.interactionMode || 'short';
        
        const modelName = explicitModel || storage.selectedModel || "meta-llama/llama-4-scout-17b-16e-instruct";

        const aiService = getAIService(apiKey, modelName, mode, storage.customPrompt);

        console.log(`[Background] Asking AI: Model=${modelName}, Mode=${mode}, Type=${type}`);

        let answer;
        if (type === 'image') {
            answer = await aiService.askImage(inputContent);
        } else {
            answer = await aiService.askText(inputContent);
        }

        sendResponse({
            success: true,
            answer: answer,
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