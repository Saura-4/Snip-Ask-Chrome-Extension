// src/background/guest-config.js
// Guest Mode: Allows users without API keys to use the extension
// Backend (Cloudflare Worker) is the sole authority for rate limiting

import { getDeviceFingerprint } from './fingerprint.js';

// =============================================================================
// CONFIGURATION
// Build-time configurable. For custom builds, modify these values.
// =============================================================================

const GUEST_WORKER_URL = 'https://snip-ask-guest.saurav04042004.workers.dev/';
const GUEST_DEFAULT_MODEL = 'meta-llama/llama-4-maverick-17b-128e-instruct';

// =============================================================================
// INSTANCE ID MANAGEMENT
// =============================================================================

/**
 * Get or create a unique instance ID for this extension installation.
 */
async function getInstanceId() {
    const storage = await chrome.storage.local.get(['guestInstanceId']);

    if (storage.guestInstanceId) {
        return storage.guestInstanceId;
    }

    const instanceId = 'snip-' + crypto.randomUUID();
    await chrome.storage.local.set({ guestInstanceId: instanceId });
    return instanceId;
}

// =============================================================================
// GUEST MODE DETECTION
// =============================================================================

/**
 * Check if the extension is in Guest Mode (no user API keys configured)
 * Returns true only if ALL API key fields are empty or contain only whitespace
 */
async function isGuestMode() {
    const storage = await chrome.storage.local.get(['groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);

    // Check if any key has actual content (even if it's invalid)
    // If user enters ANY text, we consider them NOT in guest mode
    const hasGroqKey = storage.groqKey && storage.groqKey.trim().length > 0;
    const hasGeminiKey = storage.geminiKey && storage.geminiKey.trim().length > 0;
    const hasOpenRouterKey = storage.openrouterKey && storage.openrouterKey.trim().length > 0;
    const hasOllamaHost = storage.ollamaHost && storage.ollamaHost.trim().length > 0;

    // Guest mode = NO keys entered at all
    return !hasGroqKey && !hasGeminiKey && !hasOpenRouterKey && !hasOllamaHost;
}

/**
 * Check if Guest Mode is properly configured (worker URL is set)
 */
function isGuestConfigured() {
    return GUEST_WORKER_URL && !GUEST_WORKER_URL.includes('YOUR_SUBDOMAIN');
}

// =============================================================================
// GUEST API REQUEST
// =============================================================================

/**
 * Make a Guest Mode API request through the Cloudflare Worker proxy
 * @param {Object} requestBody - The request body to send to Groq API
 * @returns {Promise<Object>} - The API response
 */
async function makeGuestRequest(requestBody) {
    if (!isGuestConfigured()) {
        throw new Error('Guest Mode is not configured. Please add your own API key.');
    }

    // Get identifiers for anti-abuse tracking
    const clientUuid = await getInstanceId();
    const deviceFingerprint = await getDeviceFingerprint();

    // Inject identifiers into _meta
    const enrichedBody = {
        ...requestBody,
        _meta: {
            ...requestBody._meta,
            clientUuid,
            deviceFingerprint
        }
    };

    // Use chrome.runtime.id as origin validation token
    // This is dynamic - no hardcoding needed
    // After publishing, this will be your consistent extension ID
    const extensionId = chrome.runtime.id;

    const response = await fetch(GUEST_WORKER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Extension-Id': extensionId  // Dynamic origin validation
        },
        body: JSON.stringify(enrichedBody)
    });

    const data = await response.json();

    // Handle errors from anti-abuse system
    if (data.code === 'BANNED') {
        throw new Error(data.message || 'Access denied. Please contact support.');
    }

    if (data.code === 'VELOCITY_BAN') {
        throw new Error('Too many requests. Please slow down and try again later.');
    }

    if (data.code === 'HARD_CAP') {
        throw new Error(data.message || 'Daily limit reached. Get your own free API key at console.groq.com!');
    }

    if (data.code === 'API_EXHAUSTED') {
        throw new Error('Service temporarily unavailable. Please try again in a few minutes.');
    }

    if (data.code === 'MISSING_ID') {
        throw new Error('Please update your extension to the latest version.');
    }

    if (!response.ok) {
        throw new Error(data.error || 'Guest Mode service error. Please try again later.');
    }

    return data;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    GUEST_WORKER_URL,
    GUEST_DEFAULT_MODEL,
    getInstanceId,
    isGuestMode,
    isGuestConfigured,
    makeGuestRequest
};
