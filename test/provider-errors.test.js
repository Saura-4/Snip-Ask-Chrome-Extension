import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGuestModel } from '../src/background/models/model-routing.js';
import {
    isInsufficientBalanceMessage,
    normalizeProviderErrorMessage
} from '../src/background/ai/errors.js';
import { OPENAI_COMPATIBLE_PROVIDERS } from '../src/background/models/provider-registry.js';

// The guest worker allowlists only the built-in Groq model ids. Anything else
// reaching it comes back as "The requested guest model is not available.",
// which tells the user nothing actionable.
const GUEST_MODEL_ALLOWLIST = new Set([
    'groq:auto',
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b',
    'groq/compound-mini',
    'groq/compound'
]);

test('guest resolution never emits a model the worker would reject', () => {
    const fallback = 'groq:auto';
    const candidates = [
        undefined,
        null,
        '',
        'groq:custom',
        'groq:moonshotai/kimi-k2-instruct',
        'google:gemini-3-flash-preview',
        'openrouter:deepseek/deepseek-r1-0528:free',
        'ollama:llava',
        ...Object.values(OPENAI_COMPATIBLE_PROVIDERS)
            .flatMap(config => config.models.map(model => `${config.prefix}${model.id}`))
    ];

    for (const candidate of candidates) {
        const resolved = resolveGuestModel(candidate, fallback);
        assert.ok(
            GUEST_MODEL_ALLOWLIST.has(resolved),
            `resolveGuestModel(${JSON.stringify(candidate)}) produced "${resolved}", which the guest worker rejects`
        );
    }
});

test('guest resolution still passes through real Groq guest models', () => {
    assert.equal(resolveGuestModel('groq:auto', 'groq:auto'), 'groq:auto');
    assert.equal(resolveGuestModel('openai/gpt-oss-20b', 'groq:auto'), 'openai/gpt-oss-20b');
    assert.equal(resolveGuestModel('groq/compound', 'groq:auto'), 'groq/compound');
});

test('out-of-credit responses are reported as billing, not as a bad key', () => {
    // DeepSeek: 402 Insufficient Balance
    const deepseek = normalizeProviderErrorMessage(
        { status: 402, ok: false, headers: { get: () => null } },
        { error: { message: 'Insufficient Balance' } },
        'DeepSeek'
    );
    assert.match(deepseek, /out of credit/i);
    assert.doesNotMatch(deepseek, /invalid/i);

    // OpenAI-style: 429 with insufficient_quota must not be read as a rate limit.
    const quota = normalizeProviderErrorMessage(
        { status: 429, ok: false, headers: { get: () => null } },
        { error: { message: 'You exceeded your current quota, please check your plan and billing details.', code: 'insufficient_quota' } },
        'Kimi (Moonshot)'
    );
    assert.match(quota, /out of credit/i);
    assert.doesNotMatch(quota, /Rate limit/i);
});

test('genuine rate limits and bad keys keep their own messages', () => {
    const rateLimited = normalizeProviderErrorMessage(
        { status: 429, ok: false, headers: { get: () => null } },
        { error: { message: 'Rate limit reached on tokens per minute (TPM). Please try again in 6.23s' } },
        'Groq'
    );
    assert.match(rateLimited, /Rate limit reached on Groq/);
    assert.doesNotMatch(rateLimited, /out of credit/i);

    const badKey = normalizeProviderErrorMessage(
        { status: 401, ok: false, headers: { get: () => null } },
        { error: { message: 'Invalid authentication credentials' } },
        'Z.AI (GLM)'
    );
    assert.match(badKey, /Invalid Z\.AI \(GLM\) API key/);
});

test('insufficient-balance detection ignores unrelated errors', () => {
    assert.equal(isInsufficientBalanceMessage('Insufficient Balance'), true);
    assert.equal(isInsufficientBalanceMessage('insufficient_quota'), true);
    assert.equal(isInsufficientBalanceMessage('Rate limit reached'), false);
    assert.equal(isInsufficientBalanceMessage('model not found'), false);
    assert.equal(isInsufficientBalanceMessage(''), false);
});
