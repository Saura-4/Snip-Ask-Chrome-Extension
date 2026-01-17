// src/background/fingerprint.js
// Browser fingerprinting for anti-cheat rate limiting
// Runs in SERVICE WORKER context - uses only SW-compatible APIs

/**
 * Generate a device fingerprint based on browser/hardware characteristics.
 * This fingerprint persists across extension reinstalls.
 * 
 * NOTE: Service workers don't have access to: screen, window, document, matchMedia
 * 
 * Components used (all SW-compatible):
 * - Canvas fingerprint via OffscreenCanvas (GPU-specific rendering)
 * - WebGL renderer info via OffscreenCanvas
 * - Audio context fingerprint via OfflineAudioContext
 * - Timezone and language (Intl API)
 * - Hardware info (navigator.hardwareConcurrency, deviceMemory)
 */

// Cache the fingerprint to avoid regenerating on every request
let cachedFingerprint = null;

/**
 * Generate a hash from a string using SHA-256
 */
async function hashString(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get canvas fingerprint - renders text and shapes, then hashes the result.
 * Different GPUs/drivers produce slightly different renderings.
 */
async function getCanvasFingerprint() {
    try {
        const canvas = new OffscreenCanvas(200, 50);
        const ctx = canvas.getContext('2d');

        // Draw text with specific font
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.fillText('Snip&Ask!🎨', 2, 15);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.fillText('Snip&Ask!🎨', 4, 17);

        // Draw some shapes
        ctx.beginPath();
        ctx.arc(50, 25, 20, 0, Math.PI * 2);
        ctx.stroke();

        // Get image data and hash it
        const imageData = ctx.getImageData(0, 0, 200, 50);
        const dataString = Array.from(imageData.data).join(',');
        return await hashString(dataString);
    } catch (e) {
        return 'canvas-unavailable';
    }
}

/**
 * Get WebGL fingerprint - GPU vendor and renderer info
 */
function getWebGLFingerprint() {
    try {
        const canvas = new OffscreenCanvas(1, 1);
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return 'webgl-unavailable';

        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (!debugInfo) return 'webgl-no-debug';

        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        return `${vendor}|${renderer}`;
    } catch (e) {
        return 'webgl-error';
    }
}

/**
 * Get audio fingerprint - AudioContext properties
 */
async function getAudioFingerprint() {
    try {
        const audioContext = new OfflineAudioContext(1, 44100, 44100);
        const oscillator = audioContext.createOscillator();
        const analyser = audioContext.createAnalyser();
        const gainNode = audioContext.createGain();
        const compressor = audioContext.createDynamicsCompressor();

        // Set some values that will produce a unique result
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(10000, audioContext.currentTime);

        compressor.threshold.setValueAtTime(-50, audioContext.currentTime);
        compressor.knee.setValueAtTime(40, audioContext.currentTime);
        compressor.ratio.setValueAtTime(12, audioContext.currentTime);
        compressor.attack.setValueAtTime(0, audioContext.currentTime);
        compressor.release.setValueAtTime(0.25, audioContext.currentTime);

        oscillator.connect(compressor);
        compressor.connect(analyser);
        analyser.connect(gainNode);
        gainNode.connect(audioContext.destination);
        gainNode.gain.setValueAtTime(0, audioContext.currentTime);

        oscillator.start(0);

        const buffer = await audioContext.startRendering();
        const data = buffer.getChannelData(0).slice(4500, 5000);
        const sum = data.reduce((acc, val) => acc + Math.abs(val), 0);

        return sum.toString();
    } catch (e) {
        return 'audio-unavailable';
    }
}

/**
 * Collect all fingerprint components and generate final hash
 * NOTE: Service workers don't have access to screen, devicePixelRatio, or matchMedia
 * We use only APIs available in service worker context
 */
async function generateFingerprint() {
    // Collect all components (service worker compatible only)
    const components = {
        // Hardware info (available in SW)
        cores: navigator.hardwareConcurrency || 'unknown',
        memory: navigator.deviceMemory || 'unknown',

        // Browser/system info (available in SW)
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
        languages: navigator.languages?.join(',') || navigator.language,
        platform: navigator.userAgentData?.platform || navigator.platform || 'unknown',

        // User agent data (more reliable in modern browsers)
        uaData: navigator.userAgentData ?
            `${navigator.userAgentData.brands?.map(b => b.brand).join(',')}|mobile:${navigator.userAgentData.mobile}` :
            navigator.userAgent.substring(0, 100),

        // Canvas fingerprint (GPU-specific) - OffscreenCanvas works in SW
        canvas: await getCanvasFingerprint(),

        // WebGL fingerprint - OffscreenCanvas works in SW
        webgl: getWebGLFingerprint(),

        // Audio fingerprint - OfflineAudioContext works in SW
        audio: await getAudioFingerprint(),

        // Touch support (available in SW)
        touchSupport: navigator.maxTouchPoints || 0,

        // Additional entropy
        connectionType: navigator.connection?.effectiveType || 'unknown',
    };

    // Combine all components into a single string
    const fingerprintString = Object.entries(components)
        .map(([key, value]) => `${key}:${value}`)
        .join('|');

    // Hash the combined string
    const fingerprint = await hashString(fingerprintString);

    // Return first 32 chars for a reasonable-length ID
    return fingerprint.substring(0, 32);
}

/**
 * Get or generate the device fingerprint.
 * Cached in chrome.storage.local for persistence.
 * 
 * NOTE: We use local (not sync) storage because:
 * 1. sync would share the fingerprint across all Chrome instances on same Google account
 * 2. This defeats device-specific rate limiting
 * 3. While local storage can be cleared via DevTools, the server-side device_fingerprint
 *    tracking will catch repeat offenders when they generate similar fingerprints
 */
async function getDeviceFingerprint() {
    // Check memory cache first
    if (cachedFingerprint) {
        return cachedFingerprint;
    }

    // Check storage cache (using local, not sync)
    const storage = await chrome.storage.local.get(['deviceFingerprint', 'fingerprintTimestamp']);

    // Fingerprint expires after 7 days (in case hardware changes)
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const isValid = storage.fingerprintTimestamp &&
        (Date.now() - storage.fingerprintTimestamp) < sevenDays;

    if (storage.deviceFingerprint && isValid) {
        cachedFingerprint = storage.deviceFingerprint;
        return cachedFingerprint;
    }

    // Generate new fingerprint
    cachedFingerprint = await generateFingerprint();

    // Store in local storage
    await chrome.storage.local.set({
        deviceFingerprint: cachedFingerprint,
        fingerprintTimestamp: Date.now()
    });

    return cachedFingerprint;
}

/**
 * Force regenerate the fingerprint (useful for debugging)
 */
async function regenerateFingerprint() {
    cachedFingerprint = null;
    await chrome.storage.local.remove(['deviceFingerprint', 'fingerprintTimestamp']);
    return await getDeviceFingerprint();
}

// Export functions
export {
    getDeviceFingerprint,
    regenerateFingerprint
};
