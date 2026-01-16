// src/background/demo-config.js
// Demo mode configuration and usage tracking for users without API keys

// =============================================================================
// CONFIGURATION - Update this URL after deploying your Cloudflare Worker
// =============================================================================

// Placeholder URL - replace with your actual Cloudflare Worker URL
const DEMO_WORKER_URL = 'https://snip-ask-demo.saurav04042004.workers.dev/';

// Default Groq model for demo mode (vision-capable)
const DEMO_DEFAULT_MODEL = 'meta-llama/llama-4-maverick-17b-128e-instruct';

// Daily limit (should match Cloudflare Worker setting)
const DEMO_DAILY_LIMIT = 15;

// =============================================================================
// INSTANCE ID MANAGEMENT
// =============================================================================

/**
 * Get or create a unique instance ID for this extension installation.
 * This ID is used by the Cloudflare Worker to track usage per user.
 */
async function getInstanceId() {
    const storage = await chrome.storage.local.get(['demoInstanceId']);

    if (storage.demoInstanceId) {
        return storage.demoInstanceId;
    }

    // Generate a new unique ID
    const instanceId = 'snip-' + crypto.randomUUID();
    await chrome.storage.local.set({ demoInstanceId: instanceId });
    return instanceId;
}

// =============================================================================
// DEMO MODE DETECTION
// =============================================================================

/**
 * Check if the extension is in demo mode (no user API keys configured)
 */
async function isDemoMode() {
    const storage = await chrome.storage.local.get(['groqKey', 'geminiKey', 'openrouterKey']);
    return !storage.groqKey && !storage.geminiKey && !storage.openrouterKey;
}

/**
 * Check if demo mode is properly configured (worker URL is set)
 */
function isDemoConfigured() {
    return DEMO_WORKER_URL && !DEMO_WORKER_URL.includes('YOUR_SUBDOMAIN');
}

// =============================================================================
// USAGE TRACKING (Local mirror of server-side tracking)
// =============================================================================

/**
 * Get current demo usage from local storage
 * This is a local cache - the server is the source of truth
 */
async function getDemoUsage() {
    const today = new Date().toISOString().split('T')[0];
    const storage = await chrome.storage.local.get(['demoUsageCount', 'demoUsageDate']);

    // Reset if it's a new day
    if (storage.demoUsageDate !== today) {
        await chrome.storage.local.set({
            demoUsageCount: 0,
            demoUsageDate: today
        });
        return { count: 0, remaining: DEMO_DAILY_LIMIT, limit: DEMO_DAILY_LIMIT };
    }

    const count = storage.demoUsageCount || 0;
    return {
        count,
        remaining: Math.max(0, DEMO_DAILY_LIMIT - count),
        limit: DEMO_DAILY_LIMIT
    };
}

/**
 * Update local usage cache based on server response
 */
async function updateDemoUsage(serverUsage) {
    const today = new Date().toISOString().split('T')[0];
    await chrome.storage.local.set({
        demoUsageCount: serverUsage.usage,
        demoUsageDate: today
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
async function makeDemoRequest(requestBody) {
    if (!isDemoConfigured()) {
        throw new Error('Demo mode is not configured. Please add your own API key or wait for the developer to set up the demo service.');
    }

    const instanceId = await getInstanceId();

    const response = await fetch(DEMO_WORKER_URL, {
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
        await updateDemoUsage({ usage: data.limit || DEMO_DAILY_LIMIT });
        throw new Error(data.message || 'Daily demo limit reached. Get your own free API key at console.groq.com for unlimited use!');
    }

    // Handle other errors
    if (!response.ok) {
        throw new Error(data.error || 'Demo service error. Please try again later.');
    }

    // Update local usage cache from server response
    if (data._demo) {
        await updateDemoUsage(data._demo);
    }

    return data;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    DEMO_WORKER_URL,
    DEMO_DEFAULT_MODEL,
    DEMO_DAILY_LIMIT,
    getInstanceId,
    isDemoMode,
    isDemoConfigured,
    getDemoUsage,
    updateDemoUsage,
    makeDemoRequest
};
