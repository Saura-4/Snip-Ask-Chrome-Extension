import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroqRequestBody } from '../src/background/ai/providers/groq.js';

test('Qwen 3.8 direct requests use non-thinking final-answer mode', () => {
    const request = buildGroqRequestBody({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: 'qwen/qwen3.8-27b',
        mode: 'short'
    });

    // Short mode requests 150 tokens. Qwen must NOT be floored up: Groq
    // on_demand enforces OTPM 1000, so any max above 1000 fails outright.
    assert.equal(request.max_completion_tokens, 150);
    assert.equal(request.reasoning_effort, 'none');
    assert.equal(request.reasoning_format, 'hidden');
});

test('Qwen 3.8 large budgets are capped at the OTPM rate limit safe cap', () => {
    const request = buildGroqRequestBody({
        messages: [{ role: 'user', content: 'Write code.' }],
        model: 'qwen/qwen3.8-27b',
        mode: 'code'
    });

    // Code mode requests 1536 tokens; capped at 450 to protect 1000 OTPM rate limit.
    assert.equal(request.max_completion_tokens, 450);
    assert.equal(request.reasoning_effort, 'none');
});

test('GPT OSS requests minimize hidden reasoning and enforce a completion floor', () => {
    const request = buildGroqRequestBody({
        messages: [{ role: 'user', content: 'Write a long essay.' }],
        model: 'openai/gpt-oss-120b',
        mode: 'short'
    });

    // gpt-oss reasons by default on Groq and does not support effort 'none'.
    // Without the floor, short-mode reasoning consumes the entire budget and
    // the model returns an empty answer.
    assert.equal(request.max_completion_tokens, 1024);
    assert.equal(request.reasoning_effort, 'low');
    assert.equal(request.reasoning_format, 'hidden');
});

test('non-reasoning Groq models get no reasoning overrides', () => {
    const request = buildGroqRequestBody({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: 'llama-3.1-8b-instant',
        mode: 'short'
    });

    assert.equal(request.max_completion_tokens, 150);
    assert.equal(request.reasoning_effort, undefined);
    assert.equal(request.reasoning_format, undefined);
});
