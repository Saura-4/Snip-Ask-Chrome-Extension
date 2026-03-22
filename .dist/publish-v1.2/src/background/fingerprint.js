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
 * Get canvas fingerprint - renders text with multiple fonts and shapes.
 * Different GPUs/drivers/font-configs produce slightly different renderings.
 * Enhanced with multiple fonts to catch system-level differences.
 */
async function getCanvasFingerprint() {
    try {
        const canvas = new OffscreenCanvas(300, 100);
        const ctx = canvas.getContext('2d');

        // Background gradient (reveals gradient rendering differences)
        const gradient = ctx.createLinearGradient(0, 0, 300, 100);
        gradient.addColorStop(0, '#ff6600');
        gradient.addColorStop(0.5, '#0066ff');
        gradient.addColorStop(1, '#00ff66');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 300, 100);

        ctx.textBaseline = 'top';

        // Test multiple fonts (font rendering varies by system config)
        const fonts = ['14px Arial', '16px Georgia', '12px Courier New', '15px Impact', '13px Times New Roman'];
        fonts.forEach((font, i) => {
            ctx.font = font;
            ctx.fillStyle = `rgba(${i * 50}, ${100 - i * 20}, ${i * 30 + 50}, 0.7)`;
            ctx.fillText('SnipAsk!@#$%🎨', 5, i * 18 + 5);
        });

        // Complex shapes with different blend modes
        ctx.globalCompositeOperation = 'multiply';
        ctx.beginPath();
        ctx.arc(150, 50, 30, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.fill();

        ctx.globalCompositeOperation = 'screen';
        ctx.beginPath();
        ctx.arc(170, 50, 30, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
        ctx.fill();

        // Bezier curves (anti-aliasing differences)
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#000033';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(10, 90);
        ctx.bezierCurveTo(50, 10, 150, 90, 290, 10);
        ctx.stroke();

        // Get image data and hash it
        const imageData = ctx.getImageData(0, 0, 300, 100);
        const dataString = Array.from(imageData.data).join(',');
        return await hashString(dataString);
    } catch (e) {
        return 'canvas-unavailable';
    }
}


/**
 * Get WebGL fingerprint - GPU vendor, renderer, and detailed parameters
 * Extended with more parameters that vary even on identical hardware
 */
function getWebGLFingerprint() {
    try {
        const canvas = new OffscreenCanvas(1, 1);
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return 'webgl-unavailable';

        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown';
        const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';

        // Additional WebGL parameters that vary per driver/installation
        const params = {
            vendor,
            renderer,
            // Max values often differ slightly between driver versions
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS)?.join(','),
            maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
            maxCubeMapTextureSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
            maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
            // Shader precision (varies by GPU/driver)
            vertexShaderPrecision: getShaderPrecision(gl, gl.VERTEX_SHADER),
            fragmentShaderPrecision: getShaderPrecision(gl, gl.FRAGMENT_SHADER),
            // Extensions (set varies by driver version and config)
            extensions: (gl.getSupportedExtensions() || []).sort().join(','),
            // Aliased values
            aliasedLineWidthRange: gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE)?.join(','),
            aliasedPointSizeRange: gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)?.join(','),
            // Depth/stencil bits
            redBits: gl.getParameter(gl.RED_BITS),
            greenBits: gl.getParameter(gl.GREEN_BITS),
            blueBits: gl.getParameter(gl.BLUE_BITS),
            alphaBits: gl.getParameter(gl.ALPHA_BITS),
            depthBits: gl.getParameter(gl.DEPTH_BITS),
            stencilBits: gl.getParameter(gl.STENCIL_BITS),
        };

        return Object.entries(params).map(([k, v]) => `${k}:${v}`).join('|');
    } catch (e) {
        return 'webgl-error';
    }
}

/**
 * Get shader precision for high/medium/low float
 */
function getShaderPrecision(gl, shaderType) {
    try {
        const high = gl.getShaderPrecisionFormat(shaderType, gl.HIGH_FLOAT);
        const medium = gl.getShaderPrecisionFormat(shaderType, gl.MEDIUM_FLOAT);
        const low = gl.getShaderPrecisionFormat(shaderType, gl.LOW_FLOAT);
        return `h:${high?.precision},m:${medium?.precision},l:${low?.precision}`;
    } catch {
        return 'unknown';
    }
}

/**
 * Get storage quota estimate - unique per user based on disk usage
 * Different users have different available storage quotas
 */
async function getStorageQuota() {
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            // Round quota to nearest GB to reduce volatility while keeping uniqueness
            const quotaGB = Math.round((estimate.quota || 0) / (1024 * 1024 * 1024));
            return `q:${quotaGB}GB`;
        }
        return 'storage-unavailable';
    } catch {
        return 'storage-error';
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

        // Storage quota - unique per user based on disk usage patterns
        storageQuota: await getStorageQuota(),

        // Additional Intl details (locale-specific formatting)
        numberFormat: new Intl.NumberFormat().resolvedOptions().locale,
        dateTimeOptions: JSON.stringify(Intl.DateTimeFormat().resolvedOptions()),

        // PDF viewer support (varies by browser config)
        pdfViewerEnabled: navigator.pdfViewerEnabled ?? 'unknown',
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
