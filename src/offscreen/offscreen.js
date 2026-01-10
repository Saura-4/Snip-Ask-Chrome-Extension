// src/offscreen/offscreen.js

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'OCR_Request') {
       // console.log("[Offscreen] 1. Received Image. Size:", msg.base64Image.length);
        runOCR(msg.base64Image).then(sendResponse);
        return true; // Keep channel open
    }
});

async function runOCR(base64Image) {
    try {
        // 1. Prepare Image Data
        const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
        const binaryString = atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

        // 2. Setup Paths
        const workerPath = chrome.runtime.getURL('lib/worker.min.js');
        const corePath = chrome.runtime.getURL('lib/tesseract-core.wasm.js');
        const langPath = chrome.runtime.getURL('lib/');

       // console.log("[Offscreen] 2. Initializing Worker...");
        
        // 3. Initialize Tesseract
        const worker = await Tesseract.createWorker('eng', 1, {
            workerPath: workerPath,
            corePath: corePath,
            langPath: langPath,
            cacheMethod: 'none',
            gzip: true,
            workerBlobURL: false, // Essential for security
            errorHandler: e => console.error('[Offscreen] Worker Error:', e)
        });

        //console.log("[Offscreen] 3. Worker Ready. Recognizing...");

        // 4. Recognize
        const { data: { text, confidence } } = await worker.recognize(bytes);
        await worker.terminate();

        //console.log(`[Offscreen] 4. Result: "${text.substring(0, 20)}..." (Confidence: ${confidence})`);

        return { text: text.trim(), confidence: confidence, success: true };

    } catch (err) {
        console.error("[Offscreen] ERROR:", err);
        return { success: false, error: err.message };
    }
}