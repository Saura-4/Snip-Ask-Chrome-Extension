const REQUEST_TOO_LARGE_MESSAGE = 'This request is too large for the selected model. Try a smaller snip, fewer images, or a shorter chat.';
const DEFAULT_GUEST_ERROR_MESSAGE = 'Guest Mode service error. Please try again later.';

function extractErrorMessage(errorLike, fallback = DEFAULT_GUEST_ERROR_MESSAGE) {
    if (!errorLike) return fallback;
    if (typeof errorLike === 'string') return errorLike;

    if (Array.isArray(errorLike)) {
        const parts = errorLike
            .map((item) => extractErrorMessage(item, ''))
            .filter(Boolean);
        return parts.join(' ').trim() || fallback;
    }

    if (typeof errorLike === 'object') {
        const preferredFields = ['message', 'error', 'detail', 'details', 'status', 'code'];
        for (const field of preferredFields) {
            const value = extractErrorMessage(errorLike[field], '');
            if (value) return value;
        }

        const values = Object.values(errorLike)
            .map((value) => extractErrorMessage(value, ''))
            .filter(Boolean);
        return values.join(' ').trim() || fallback;
    }

    return String(errorLike);
}

function isContextLimitErrorMessage(errorLike) {
    const message = extractErrorMessage(errorLike, '');
    if (!message) return false;

    const lower = message.toLowerCase();
    if (lower.includes('context_length_exceeded')) return true;
    if (lower.includes('maximum context')) return true;
    if (lower.includes('context length')) return true;
    if (lower.includes('too many tokens')) return true;
    if (lower.includes('input is too long')) return true;
    if (lower.includes('prompt is too long')) return true;
    if (lower.includes('request too large')) return true;
    if (lower.includes('payload too large')) return true;

    return lower.includes('token') &&
        (lower.includes('exceed') || lower.includes('too large') || lower.includes('maximum') || lower.includes('limit'));
}

function getProviderApiMessage(data) {
    return [
        typeof data?.error === 'string' ? data.error : null,
        data?.error?.message,
        data?.error?.status,
        data?.message,
        data?.detail
    ].filter(Boolean).map(String).join(' ');
}

function normalizeProviderErrorMessage(response, data, provider) {
    const status = response.status;
    const apiMessage = getProviderApiMessage(data);

    if (status === 401) {
        return `Invalid ${provider} API key. Please check your key in extension settings.`;
    }
    if (status === 403) {
        return `Access denied by ${provider}. Your API key may lack permissions.`;
    }
    if (status === 429) {
        return `Rate limit exceeded on ${provider}. Please wait a moment and try again.`;
    }
    if (status !== 429 && isContextLimitErrorMessage(apiMessage)) {
        return REQUEST_TOO_LARGE_MESSAGE;
    }
    if (status === 500 || status === 502 || status === 503) {
        return `${provider} server is temporarily unavailable. Please try again later.`;
    }
    if (status === 0 || (!response.ok && !apiMessage)) {
        return 'Network error. Please check your internet connection.';
    }

    return apiMessage || `${provider} error (${status})`;
}

export {
    REQUEST_TOO_LARGE_MESSAGE,
    extractErrorMessage,
    isContextLimitErrorMessage,
    normalizeProviderErrorMessage
};
