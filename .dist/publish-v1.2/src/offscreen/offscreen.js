// src/offscreen/offscreen.js

// --- OCR QUALITY VALIDATION CONSTANTS ---
const OCR_CONFIG = {
    MAX_OUTPUT_CHARS: 8000,           // Max chars to send to LLM (prevents token waste)
    MIN_CONFIDENCE: 25,                // Below this = likely garbage (Tesseract returns 0-100)
    MIN_READABLE_RATIO: 0.3,           // At least 30% must be alphanumeric
    MAX_REPETITION_RATIO: 0.4,         // If 40%+ is same char, it's noise
    MAX_CONSECUTIVE_GARBAGE: 20        // Max consecutive non-printable chars
};

// --- OCR TEXT QUALITY ANALYZER ---
function analyzeOCRQuality(text) {
    if (!text || text.length === 0) {
        return { isValid: false, reason: 'empty', cleanedText: '' };
    }

    // 1. Check readable character ratio (letters, numbers, common punctuation)
    const readableChars = text.match(/[a-zA-Z0-9.,!?;:'"()\-\s]/g) || [];
    const readableRatio = readableChars.length / text.length;

    if (readableRatio < OCR_CONFIG.MIN_READABLE_RATIO) {
        return {
            isValid: false,
            reason: 'garbage_ratio',
            detail: `Only ${(readableRatio * 100).toFixed(1)}% readable characters`,
            cleanedText: ''
        };
    }

    // 2. Check for repetitive patterns (common in noise: "||||||||" or "........")
    const charCounts = {};
    for (const char of text) {
        charCounts[char] = (charCounts[char] || 0) + 1;
    }
    const maxCharCount = Math.max(...Object.values(charCounts));
    const repetitionRatio = maxCharCount / text.length;

    if (repetitionRatio > OCR_CONFIG.MAX_REPETITION_RATIO && text.length > 50) {
        return {
            isValid: false,
            reason: 'repetitive',
            detail: `Single character repeated ${(repetitionRatio * 100).toFixed(1)}% of text`,
            cleanedText: ''
        };
    }

    // 3. Check for consecutive garbage sequences
    const garbageMatch = text.match(/[^a-zA-Z0-9.,!?;:'"()\-\s\n]{20,}/g);
    if (garbageMatch) {
        return {
            isValid: false,
            reason: 'consecutive_garbage',
            detail: `Found ${garbageMatch.length} garbage sequences`,
            cleanedText: ''
        };
    }

    // 4. Clean and truncate
    let cleanedText = text
        .replace(/[^\x20-\x7E\n\t]/g, ' ')  // Replace non-printable with space
        .replace(/\s+/g, ' ')                 // Collapse whitespace
        .trim();

    // 5. Truncate if too long (prevents token waste)
    const wasTruncated = cleanedText.length > OCR_CONFIG.MAX_OUTPUT_CHARS;
    if (wasTruncated) {
        // Truncate at word boundary
        cleanedText = cleanedText.substring(0, OCR_CONFIG.MAX_OUTPUT_CHARS);
        const lastSpace = cleanedText.lastIndexOf(' ');
        if (lastSpace > OCR_CONFIG.MAX_OUTPUT_CHARS - 100) {
            cleanedText = cleanedText.substring(0, lastSpace) + '... [truncated]';
        }
    }

    return {
        isValid: true,
        cleanedText,
        wasTruncated,
        stats: {
            originalLength: text.length,
            cleanedLength: cleanedText.length,
            readableRatio: (readableRatio * 100).toFixed(1) + '%'
        }
    };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'OCR_Request') {
        runOCR(msg.base64Image).then(sendResponse);
        return true; // Keep channel open
    }
});

async function runOCR(base64Image) {
    try {
        // Validate input
        if (!base64Image || typeof base64Image !== 'string') {
            throw new Error("Invalid image data provided");
        }

        // 1. Prepare Image Data
        const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

        // Validate base64 format
        if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
            throw new Error("Invalid base64 encoding detected");
        }

        // Check reasonable size (10MB limit)
        if (base64Data.length > 10 * 1024 * 1024) {
            throw new Error("Image too large for processing (max 10MB)");
        }

        const binaryString = atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

        // 2. Setup Paths
        const workerPath = chrome.runtime.getURL('lib/worker.min.js');
        const corePath = chrome.runtime.getURL('lib/tesseract-core.wasm.js');
        const langPath = chrome.runtime.getURL('lib/');

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

        // 4. Recognize
        const { data: { text, confidence } } = await worker.recognize(bytes);
        await worker.terminate();

        // 5. Validate OCR quality
        if (confidence < OCR_CONFIG.MIN_CONFIDENCE) {
            console.warn(`[Offscreen] Low confidence OCR (${confidence}%) - likely noise`);
            return {
                success: false,
                error: `OCR confidence too low (${confidence.toFixed(0)}%). Image may be too noisy or not contain text.`,
                confidence: confidence
            };
        }

        const qualityCheck = analyzeOCRQuality(text);

        if (!qualityCheck.isValid) {
            console.warn(`[Offscreen] OCR quality check failed: ${qualityCheck.reason}`, qualityCheck.detail);
            return {
                success: false,
                error: `OCR produced unusable text (${qualityCheck.reason}). Try snipping clearer content.`,
                confidence: confidence,
                reason: qualityCheck.reason
            };
        }

        return {
            text: qualityCheck.cleanedText,
            confidence: confidence,
            success: true,
            wasTruncated: qualityCheck.wasTruncated,
            stats: qualityCheck.stats
        };

    } catch (err) {
        console.error("[Offscreen] ERROR:", err);
        return { success: false, error: err.message };
    }
}