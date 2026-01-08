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

// 2. Main Message Listener


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // --- NEW: Tesseract Injector ---
    if (request.action === "INJECT_TESSERACT") {
        if (!sender.tab) {
            sendResponse({ success: false, error: "No tab found" });
            return;
        }

        chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            files: ["lib/tesseract.min.js"] // Injects into Isolated World
        })
        .then(() => {
            console.log("Tesseract injected into tab " + sender.tab.id);
            sendResponse({ success: true });
        })
        .catch((err) => {
            console.error("Injection failed:", err);
            sendResponse({ success: false, error: err.message });
        });
        
        return true; // Keep channel open
    }
    // -------------------------------

    // Screenshot Handler
    if (request.action === "CAPTURE_VISIBLE_TAB") {
        chrome.tabs.captureVisibleTab(null, {
            format: "jpeg",
            quality: 80
        }, (dataUrl) => {
            sendResponse({
                dataUrl: dataUrl
            });
        });
        return true; // Keep channel open for async response
    }

    // AI Request Handler (Delegates to AI Service)
    if (request.action === "ASK_GROQ" || request.action === "ASK_GROQ_TEXT") {
        // Determine if this is a Text (OCR) request or an Image request
        const type = request.action === "ASK_GROQ_TEXT" ? 'text' : 'image';
        const content = type === 'text' ? request.text : request.base64Image;
        const ocrConfidence = request.ocrConfidence || null;

        // Pass the explicit model (request.model) to the handler
        handleAIRequest(request.apiKey, content, type, request.model, sendResponse, ocrConfidence);
        return true; // Keep channel open
    }
});

// 3. The Core Logic (Delegation)
async function handleAIRequest(apiKey, inputContent, type, explicitModel, sendResponse, ocrConfidence) {
    try {
        // Fetch User Settings
        const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel']);
        const mode = storage.interactionMode || 'short';

        // PRIORITIZE the model sent by content.js (explicitModel). 
        // Fallback to storage, then to default.
        const modelName = explicitModel || storage.selectedModel || "meta-llama/llama-4-scout-17b-16e-instruct";

        // Factory call: Get the correct service for this model
        const aiService = getAIService(apiKey, modelName, mode, storage.customPrompt);

        console.log(`[Background] Handling Request: Model=${modelName}, Mode=${mode}, Type=${type}`);

        let answer;

        if (type === 'image') {
            // Ask the service to handle an image
            answer = await aiService.askImage(inputContent);
        } else {
            // Ask the service to handle text
            answer = await aiService.askText(inputContent);
        }

        // Send success back to content.js
        sendResponse({
            success: true,
            answer: answer,
            usedOCR: type === 'text',
            ocrConfidence
        });

    } catch (error) {
        console.error("AI Service Error:", error);

        // Send error back to content.js so it can alert the user
        sendResponse({
            success: false,
            error: error.message || String(error)
        });
    }
}