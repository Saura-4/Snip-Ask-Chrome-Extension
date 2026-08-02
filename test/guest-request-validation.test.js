import test from 'node:test';
import assert from 'node:assert/strict';
import { GUEST_MODEL_ALLOWLIST, buildGroqRequestBody, normalizeParallelCount, validateGuestPayload } from '../cloudflare-worker/worker.js';
import { ALL_MODELS } from '../src/background/models/models-config.js';

function validPayload(overrides = {}) {
    return {
        model: 'openai/gpt-oss-20b',
        max_tokens: 384,
        temperature: 0.3,
        messages: [{ role: 'user', content: 'Explain this selection.' }],
        ...overrides
    };
}

test('guest validation accepts a bounded supported request', () => {
    assert.deepEqual(validateGuestPayload(validPayload()), { ok: true });
});

test('guest validation rejects unsupported models and oversized output', () => {
    assert.equal(validateGuestPayload(validPayload({ model: 'arbitrary-model' })).code, 'UNSUPPORTED_MODEL');
    assert.equal(validateGuestPayload(validPayload({ max_tokens: 4096 })).code, 'INVALID_MAX_TOKENS');
});

test('parallel count is an integer bounded to compare mode limits', () => {
    assert.equal(normalizeParallelCount(4), 4);
    assert.equal(normalizeParallelCount(0.5), 1);
    assert.equal(normalizeParallelCount(500), 1);
});

test('Qwen 3.6 guest requests disable reasoning and enforce a token floor', () => {
    const request = buildGroqRequestBody(validPayload({ max_tokens: 384 }), 'qwen/qwen3.6-27b');

    assert.equal(request.max_tokens, undefined);
    assert.equal(request.max_completion_tokens, 1024, 'short-mode budget should be raised to the 1024-token floor');
    assert.equal(request.reasoning_effort, 'none');
    assert.equal(request.reasoning_format, 'hidden');

    const codeRequest = buildGroqRequestBody(validPayload({ max_tokens: 1536 }), 'qwen/qwen3.6-27b');
    assert.equal(codeRequest.max_completion_tokens, 1536, 'budgets already above the floor should be preserved');
});

test('every built-in guest model is explicitly allowed by the worker', () => {
    const guestModels = ALL_MODELS.groq
        .map(({ value }) => value)
        .filter((value) => value !== 'groq:custom');

    assert.deepEqual(guestModels.filter((model) => !GUEST_MODEL_ALLOWLIST.has(model)), []);
});
