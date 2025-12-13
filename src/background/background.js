// src/background/background.js

// Import the factory from our new 'Brain' module
import { getAIService } from './ai-service.js';

// 1. Helper to use chrome.storage.local.get with await
function getStorage(keys)
{
    return new Promise((resolve) =>
    {
        try
        {
            chrome.storage.local.get(keys, (items) => resolve(items || {}));
        }
        catch (e)
        {
            resolve({});
        }
    });
}

// 2. Main Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) =>
{
    // Screenshot Handler (Standard Chrome API work)
    if (request.action === "CAPTURE_VISIBLE_TAB")
    {
        chrome.tabs.captureVisibleTab(null,
        {
            format: "jpeg",
            quality: 80
        }, (dataUrl) =>
        {
            sendResponse(
            {
                dataUrl: dataUrl
            });
        });
        return true; // Keep channel open for async response
    }

    // AI Request Handler (Delegates to AI Service)
    if (request.action === "ASK_GROQ" || request.action === "ASK_GROQ_TEXT")
    {
        // Determine if this is a Text (OCR) request or an Image request
        const type = request.action === "ASK_GROQ_TEXT" ? 'text' : 'image';
        const content = type === 'text' ? request.text : request.base64Image;
        const ocrConfidence = request.ocrConfidence || null;

        handleAIRequest(request.apiKey, content, type, sendResponse, ocrConfidence);
        return true; // Keep channel open
    }
});

// 3. The Core Logic (Delegation)
async function handleAIRequest(apiKey, inputContent, type, sendResponse, ocrConfidence)
{
    try
    {
        // Fetch User Settings
        const storage = await getStorage(['interactionMode', 'customPrompt', 'selectedModel']);
        const mode = storage.interactionMode || 'short';
        const modelName = storage.selectedModel || "meta-llama/llama-4-scout-17b-16e-instruct";

        // ------------------------------------------------------------------
        // THE "STRATEGY PATTERN" IN ACTION
        // We ask the factory for the correct service.
        // If modelName was "gemini...", we'd get a GeminiService object here.
        // ------------------------------------------------------------------
        const aiService = getAIService(apiKey, modelName, mode, storage.customPrompt);

        console.log(`[Background] Handling Request: Model=${modelName}, Mode=${mode}, Type=${type}`);

        let answer;

        if (type === 'image')
        {
            // Ask the service to handle an image
            answer = await aiService.askImage(inputContent);
        }
        else
        {
            // Ask the service to handle text
            answer = await aiService.askText(inputContent);
        }

        // Send success back to content.js
        sendResponse(
        {
            success: true,
            answer: answer,
            usedOCR: type === 'text',
            ocrConfidence
        });

    }
    catch (error)
    {
        console.error("AI Service Error:", error);
        
        // Send error back to content.js so it can alert the user
        sendResponse(
        {
            success: false,
            error: error.message || String(error)
        });
    }
}