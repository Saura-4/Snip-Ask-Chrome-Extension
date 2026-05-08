// src/offscreen/offscreen.js

// --- OCR QUALITY VALIDATION CONSTANTS ---
const OCR_CONFIG = {
    MAX_OUTPUT_CHARS: 8000,           // Max chars to send to LLM (prevents token waste)
    MIN_CONFIDENCE: 25,                // Below this = likely garbage (Tesseract returns 0-100)
    MIN_READABLE_RATIO: 0.3,           // At least 30% must be alphanumeric
    MAX_REPETITION_RATIO: 0.4,         // If 40%+ is same char, it's noise
    MAX_CONSECUTIVE_GARBAGE: 20,       // Max consecutive non-printable chars
    RELIABLE_CONFIDENCE: 70,
    RELIABLE_MIN_CHARS: 24,
    RELIABLE_MIN_TOKENS: 4,
    RELIABLE_READABLE_RATIO: 0.75,
    RELIABLE_WORD_MEDIAN_CONFIDENCE: 65,
    RELIABLE_WORD_MIN_CONFIDENCE: 55,
    RELIABLE_WORD_MIN_PASS_RATIO: 0.7
};

let ocrWorkerPromise = null;

function getOcrWorker() {
    if (!ocrWorkerPromise) {
        ocrWorkerPromise = Tesseract.createWorker('eng', 1, {
            workerPath: chrome.runtime.getURL('lib/worker.min.js'),
            corePath: chrome.runtime.getURL('lib/tesseract-core.wasm.js'),
            langPath: chrome.runtime.getURL('lib/'),
            cacheMethod: 'none',
            gzip: true,
            workerBlobURL: false,
            errorHandler: e => console.debug('[Offscreen] Worker Error:', e)
        });
    }

    return ocrWorkerPromise;
}

function getMeaningfulTokens(text) {
    if (!text) return [];
    return text.match(/[A-Za-z0-9][A-Za-z0-9'_:-]{1,}/g) || [];
}

function getMedian(numbers) {
    if (!Array.isArray(numbers) || numbers.length === 0) return null;
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function analyzeWordConfidence(words) {
    const meaningfulWords = Array.isArray(words)
        ? words
            .map((word) => ({
                text: String(word?.text || '').trim(),
                confidence: Number(word?.confidence)
            }))
            .filter((word) => /[A-Za-z0-9]/.test(word.text) && Number.isFinite(word.confidence))
        : [];

    if (meaningfulWords.length === 0) {
        return { available: false, total: 0 };
    }

    const confidences = meaningfulWords.map((word) => word.confidence);
    const passCount = confidences.filter((value) => value >= OCR_CONFIG.RELIABLE_WORD_MIN_CONFIDENCE).length;

    return {
        available: true,
        total: meaningfulWords.length,
        median: getMedian(confidences),
        passRatio: passCount / confidences.length,
        passCount
    };
}

function analyzeReliableOCR(qualityCheck, confidence, words) {
    const cleanedText = qualityCheck.cleanedText || '';
    const meaningfulTokens = getMeaningfulTokens(cleanedText);
    const readableRatioValue = qualityCheck.stats?.readableRatioValue || 0;
    const wordConfidence = analyzeWordConfidence(words);
    const stats = {
        ...qualityCheck.stats,
        confidence,
        meaningfulTokenCount: meaningfulTokens.length,
        wordConfidence
    };

    if (confidence < OCR_CONFIG.RELIABLE_CONFIDENCE) {
        return { reliable: false, reason: 'low_reliable_confidence', stats };
    }

    if (cleanedText.length < OCR_CONFIG.RELIABLE_MIN_CHARS) {
        return { reliable: false, reason: 'too_short', stats };
    }

    if (meaningfulTokens.length < OCR_CONFIG.RELIABLE_MIN_TOKENS) {
        return { reliable: false, reason: 'too_few_meaningful_tokens', stats };
    }

    if (readableRatioValue < OCR_CONFIG.RELIABLE_READABLE_RATIO) {
        return { reliable: false, reason: 'low_readable_ratio', stats };
    }

    if (wordConfidence.available) {
        if (wordConfidence.median < OCR_CONFIG.RELIABLE_WORD_MEDIAN_CONFIDENCE) {
            return { reliable: false, reason: 'low_word_median_confidence', stats };
        }

        if (wordConfidence.passRatio < OCR_CONFIG.RELIABLE_WORD_MIN_PASS_RATIO) {
            return { reliable: false, reason: 'low_word_confidence_ratio', stats };
        }
    }

    return { reliable: true, reason: 'reliable', stats };
}

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
            readableRatio: (readableRatio * 100).toFixed(1) + '%',
            readableRatioValue: readableRatio
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

        // 2. Recognize with a cached worker. Creating Tesseract workers is expensive.
        let worker;
        try {
            worker = await getOcrWorker();
        } catch (error) {
            ocrWorkerPromise = null;
            throw error;
        }
        let recognitionResult;
        try {
            recognitionResult = await worker.recognize(bytes);
        } catch (error) {
            ocrWorkerPromise = null;
            throw error;
        }
        const { data: { text, confidence, words } } = recognitionResult;
        const numericConfidence = Number.isFinite(Number(confidence)) ? Number(confidence) : 0;

        // 3. Validate OCR quality
        if (numericConfidence < OCR_CONFIG.MIN_CONFIDENCE) {
            console.debug(`[Offscreen] Low confidence OCR (${numericConfidence}%) - likely noise`);
            return {
                success: false,
                reliable: false,
                error: `OCR confidence too low (${numericConfidence.toFixed(0)}%). Image may be too noisy or not contain text.`,
                confidence: numericConfidence,
                reason: 'low_confidence',
                stats: { confidence: numericConfidence }
            };
        }

        const qualityCheck = analyzeOCRQuality(text);

        if (!qualityCheck.isValid) {
            console.debug(`[Offscreen] OCR quality check failed: ${qualityCheck.reason}`, qualityCheck.detail);
            return {
                success: false,
                reliable: false,
                error: `OCR produced unusable text (${qualityCheck.reason}). Try snipping clearer content.`,
                confidence: numericConfidence,
                reason: qualityCheck.reason,
                stats: qualityCheck.stats
            };
        }

        const reliableCheck = analyzeReliableOCR(qualityCheck, numericConfidence, words);
        if (!reliableCheck.reliable) {
            console.debug(`[Offscreen] OCR not reliable for Auto routing: ${reliableCheck.reason}`, reliableCheck.stats);
        }

        return {
            text: qualityCheck.cleanedText,
            confidence: numericConfidence,
            success: true,
            reliable: reliableCheck.reliable,
            reason: reliableCheck.reason,
            wasTruncated: qualityCheck.wasTruncated,
            stats: reliableCheck.stats
        };

    } catch (err) {
        console.debug("[Offscreen] OCR failed:", err);
        return { success: false, reliable: false, reason: 'ocr_error', error: err.message };
    }
}
