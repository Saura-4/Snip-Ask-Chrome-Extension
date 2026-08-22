import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroqRequestBody } from '../src/background/ai/providers/groq.js';

test('Qwen 3.6 direct requests use non-thinking final-answer mode', () => {
    const request = buildGroqRequestBody({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: 'qwen/qwen3.6-27b',
        mode: 'short'
    });

    // Short mode requests 150 tokens, but the Qwen hidden-reasoning budget
    // enforces a 1024 minimum so the model has room for a final answer.
    assert.equal(request.max_completion_tokens, 1024);
    assert.equal(request.reasoning_effort, 'none');
    assert.equal(request.reasoning_format, 'hidden');
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
