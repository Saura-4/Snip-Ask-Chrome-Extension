// src/background/guest-config.js
// Guest Mode: Allows users without API keys to try the extension with limited daily usage

// =============================================================================
// CONFIGURATION - Update this URL after deploying your Cloudflare Worker
// =============================================================================

// Placeholder URL - replace with your actual Cloudflare Worker URL
const GUEST_WORKER_URL = 'https://snip-ask-guest.saurav04042004.workers.dev/';

// Default Groq model for Guest Mode mode (vision-capable)
const GUEST_DEFAULT_MODEL = 'meta-llama/llama-4-maverick-17b-128e-instruct';

// Daily limit for Guest Mode (should match Cloudflare Worker setting)
const GUEST_DAILY_LIMIT = 15;

// =============================================================================
// INSTANCE ID MANAGEMENT
// =============================================================================

/**
 * Get or create a unique instance ID for this extension installation.
 * This ID is used by the Cloudflare Worker to track usage per user.
 */
async function getInstanceId() {
    const storage = await chrome.storage.local.get(['guestInstanceId']);

    if (storage.guestInstanceId) {
        return storage.guestInstanceId;
    }

    // Generate a new unique ID
    const instanceId = 'snip-' + crypto.randomUUID();
    await chrome.storage.local.set({ guestInstanceId: instanceId });
    return instanceId;
}

// =============================================================================
// DEMO MODE DETECTION
// =============================================================================

/**
 * Check if the extension is in Guest Mode mode (no user API keys configured)
 */
async function isGuestMode() {
    const storage = await chrome.storage.local.get(['groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);
    // Guest Mode only if NO keys/hosts are configured at all
    return !storage.groqKey && !storage.geminiKey && !storage.openrouterKey && !storage.ollamaHost;
}

/**
 * Check if Guest Mode mode is properly configured (worker URL is set)
 */
function isGuestConfigured() {
    return GUEST_WORKER_URL && !GUEST_WORKER_URL.includes('YOUR_SUBDOMAIN');
}

// =============================================================================
// USAGE TRACKING (Local mirror of server-side tracking)
// =============================================================================

/**
 * Get current demo usage from local storage
 * This is a local cache - the server is the source of truth
 */
async function getGuestUsage() {
    const today = new Date().toISOString().split('T')[0];
    const storage = await chrome.storage.local.get(['guestUsageCount', 'guestUsageDate']);

    // Reset if it's a new day
    if (storage.guestUsageDate !== today) {
        await chrome.storage.local.set({
            guestUsageCount: 0,
            guestUsageDate: today
        });
        return { count: 0, remaining: GUEST_DAILY_LIMIT, limit: GUEST_DAILY_LIMIT };
    }

    const count = storage.guestUsageCount || 0;
    return {
        count,
        remaining: Math.max(0, GUEST_DAILY_LIMIT - count),
        limit: GUEST_DAILY_LIMIT
    };
}

/**
 * Update local usage cache based on server response
 */
async function updateGuestUsage(serverUsage) {
    const today = new Date().toISOString().split('T')[0];
    await chrome.storage.local.set({
        guestUsageCount: serverUsage.usage,
        guestUsageDate: today
    });
}

// =============================================================================
// DEMO API REQUEST
// =============================================================================

/**
 * Make a demo mode API request through the Cloudflare Worker proxy
 * @param {Object} requestBody - The request body to send to Groq API
 * @returns {Promise<Object>} - The API response with usage info
 */
async function makeGuestRequest(requestBody) {
    if (!isGuestConfigured()) {
        throw new Error('Guest Mode is not configured. Please add your own API key in the extension popup.');
    }

    const instanceId = await getInstanceId();

    const response = await fetch(GUEST_WORKER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Instance-ID': instanceId
        },
        body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    // Handle rate limit exceeded
    if (response.status === 429 || data.code === 'LIMIT_EXCEEDED') {
        // Update local cache
        await updateGuestUsage({ usage: data.limit || GUEST_DAILY_LIMIT });
        throw new Error(data.message || 'Guest Mode daily limit reached. Get your own free API key at console.groq.com for unlimited use!');
    }

    // Handle other errors
    if (!response.ok) {
        throw new Error(data.error || 'Guest Mode service error. Please try again later.');
    }

    // Update local usage cache from server response
    if (data._demo) {
        await updateGuestUsage(data._demo);
    }

    return data;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    GUEST_WORKER_URL,
    GUEST_DEFAULT_MODEL,
    GUEST_DAILY_LIMIT,
    getInstanceId,
    isGuestMode,
    isGuestConfigured,
    getGuestUsage,
    updateGuestUsage,
    makeGuestRequest
};
