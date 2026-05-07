const CLOUD_TIMEOUT_MS = 30000;
const OPENROUTER_TIMEOUT_MS = 90000;
const LOCAL_TIMEOUT_MS = 120000;

async function fetchWithTimeout(url, options = {}, timeoutMs = CLOUD_TIMEOUT_MS, externalSignal = null) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let cancelledByUser = false;

    let externalAbortHandler;
    if (externalSignal) {
        if (externalSignal.aborted) {
            clearTimeout(timeoutId);
            throw new Error('Request cancelled.');
        }
        externalAbortHandler = () => {
            cancelledByUser = true;
            controller.abort();
        };
        externalSignal.addEventListener('abort', externalAbortHandler);
    }

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(cancelledByUser ? 'Request cancelled.' : 'Request timed out. Please try again.');
        }
        throw error;
    } finally {
        if (externalSignal && externalAbortHandler) {
            externalSignal.removeEventListener('abort', externalAbortHandler);
        }
    }
}

export {
    CLOUD_TIMEOUT_MS,
    LOCAL_TIMEOUT_MS,
    OPENROUTER_TIMEOUT_MS,
    fetchWithTimeout
};
