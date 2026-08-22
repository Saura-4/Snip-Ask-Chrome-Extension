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

/**
 * Parse a duration string like "6.23s", "12m3s", "1h20m", "2d",
 * "30 seconds", "5 minutes" into whole seconds.
 */
function parseDurationString(text) {
    if (!text || typeof text !== 'string') return null;
    let total = 0;
    let found = false;
    const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|minutes?|mins?|min|seconds?|secs?|sec|days?|d|[smhd])/gi;
    let match;
    while ((match = re.exec(text)) !== null) {
        found = true;
        const value = parseFloat(match[1]);
        const unit = match[2].toLowerCase()[0];
        if (unit === 'h') total += value * 3600;
        else if (unit === 'm') total += value * 60;
        else if (unit === 's') total += value;
        else if (unit === 'd') total += value * 86400;
    }
    return found ? Math.max(1, Math.ceil(total)) : null;
}

/**
 * Extract the retry delay from a rate-limited response. Prefers explicit
 * headers, then falls back to Groq-style "Please try again in 6.23s" text.
 */
function getRateLimitRetrySeconds(response, apiMessage) {
    const retryAfterMs = response?.headers?.get?.('retry-after-ms');
    if (retryAfterMs && Number.isFinite(parseFloat(retryAfterMs))) {
        return Math.max(1, Math.ceil(parseFloat(retryAfterMs) / 1000));
    }

    const retryAfter = response?.headers?.get?.('retry-after');
    if (retryAfter) {
        const asNumber = parseFloat(retryAfter);
        if (Number.isFinite(asNumber)) return Math.max(1, Math.ceil(asNumber));
        const asDate = Date.parse(retryAfter);
        if (!Number.isNaN(asDate)) {
            return Math.max(1, Math.ceil((asDate - Date.now()) / 1000));
        }
    }

    const textMatch = apiMessage?.match(/try again in\s+((?:[\d.,]+\s*(?:hours?|hrs?|hr|minutes?|mins?|min|seconds?|secs?|sec|days?|day|[smhd])\s*,?\s*)+)/i);
    if (textMatch) {
        return parseDurationString(textMatch[1]);
    }

    return null;
}

/**
 * Extract the limit window from Groq-style messages, e.g.
 * "on tokens per minute (TPM)" -> { resource: 'tokens', period: 'minute' }.
 */
function getRateLimitWindow(apiMessage) {
    const match = apiMessage?.match(/on\s+([a-z]+)\s+per\s+([a-z]+)/i);
    if (!match) return null;
    return { resource: match[1].toLowerCase(), period: match[2].toLowerCase() };
}

function extractLimitNumber(text, field) {
    const match = text?.match(new RegExp(`${field}\\s*:?\\s*(\\d[\\d,]*)`, 'i'));
    if (!match) return null;
    const cleaned = match[1].replace(/,+$/, '');
    const numeric = Number(cleaned.replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric.toLocaleString('en-US') : cleaned;
}

function humanizeSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    if (seconds < 60) return `~${seconds}s`;
    const minutesTotal = Math.round(seconds / 60);
    if (minutesTotal < 60) return `~${minutesTotal} min`;
    const hours = Math.floor(minutesTotal / 60);
    const minutes = minutesTotal % 60;
    if (hours < 24) return minutes > 0 ? `~${hours}h ${minutes}m` : `~${hours}h`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `~${days}d ${remHours}h` : `~${days}d`;
}

/**
 * Build a human-friendly 429 message that surfaces which limit was hit,
 * the usage numbers, and exactly how long until reset.
 */
function formatRateLimitMessage(response, data, provider) {
    const apiMessage = getProviderApiMessage(data);
    const retrySeconds = getRateLimitRetrySeconds(response, apiMessage);
    const window = getRateLimitWindow(apiMessage);

    const limit = extractLimitNumber(apiMessage, 'Limit');
    const used = extractLimitNumber(apiMessage, 'Used');
    const requested = extractLimitNumber(apiMessage, 'Requested');

    let message = `Rate limit reached on ${provider}`;
    if (window) {
        message += ` (${window.resource}/${window.period})`;
    }

    const parts = [];
    if (limit) parts.push(`limit ${limit}`);
    if (used) parts.push(`used ${used}`);
    if (requested) parts.push(`request needs ${requested}`);
    if (parts.length > 0) {
        message += `: ${parts.join(', ')}`;
    }

    const humanTime = humanizeSeconds(retrySeconds);
    if (humanTime) {
        message += `. Resets in ${humanTime} — try again then.`;
    } else {
        message += '. Please wait a moment and try again.';
    }

    return message;
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
        return formatRateLimitMessage(response, data, provider);
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
    formatRateLimitMessage,
    getProviderApiMessage,
    isContextLimitErrorMessage,
    normalizeProviderErrorMessage
};
