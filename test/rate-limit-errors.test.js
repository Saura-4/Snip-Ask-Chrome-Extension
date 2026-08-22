import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRateLimitMessage } from '../src/background/ai/errors.js';

function fakeResponse(headers = {}, status = 429) {
    return {
        status,
        ok: false,
        headers: {
            get: (name) => headers[name.toLowerCase()] ?? null
        }
    };
}

test('formats Groq TPM limit with retry time parsed from message text', () => {
    const response = fakeResponse();
    const data = {
        error: {
            message: "Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 6000, Requested 8985, Used 3846. Please try again in 6.23s."
        }
    };

    const message = formatRateLimitMessage(response, data, 'Groq');
    assert.match(message, /Rate limit reached on Groq \(tokens\/minute\)/);
    assert.match(message, /limit 6,000/);
    assert.match(message, /used 3,846/);
    assert.match(message, /request needs 8,985/);
    assert.match(message, /Resets in ~7s/);
});

test('prefers the retry-after header over message text', () => {
    const response = fakeResponse({ 'retry-after': '30' });
    const data = {
        error: { message: 'Rate limit reached for model on requests per day (RPD): Limit 14400, Used 14400. Please try again in 11h52m.' }
    };

    const message = formatRateLimitMessage(response, data, 'Groq');
    assert.match(message, /\(requests\/day\)/);
    assert.match(message, /limit 14,400/);
    // HTTP Retry-After is expressed in seconds.
    assert.match(message, /Resets in ~30s/);
});

test('handles retry-after-ms and compound durations', () => {
    const response = fakeResponse({ 'retry-after-ms': '2500' });
    const message = formatRateLimitMessage(response, { error: { message: 'Rate limit reached' } }, 'Groq');
    assert.match(message, /Resets in ~3s/);

    const textOnly = formatRateLimitMessage(
        fakeResponse(),
        { error: { message: 'Rate limit reached on tokens per day (TPD): Limit 500000. Please try again in 2m30s.' } },
        'Groq'
    );
    assert.match(textOnly, /Resets in ~3 min/);
});

test('falls back to a generic nudge when no timing details exist', () => {
    const response = fakeResponse();
    const message = formatRateLimitMessage(response, { error: { message: 'Rate limit reached' } }, 'OpenRouter');
    assert.equal(message, 'Rate limit reached on OpenRouter. Please wait a moment and try again.');
});
