import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroqRequestBody } from '../src/background/ai/providers/groq.js';

test('Qwen 3.6 direct requests use non-thinking final-answer mode', () => {
    const request = buildGroqRequestBody({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: 'qwen/qwen3.6-27b',
        mode: 'short'
    });

    assert.equal(request.max_completion_tokens, 150);
    assert.equal(request.reasoning_effort, 'none');
    assert.equal(request.reasoning_format, 'hidden');
});

test('other Groq models retain their normal request configuration', () => {
    const request = buildGroqRequestBody({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: 'openai/gpt-oss-20b',
        mode: 'short'
    });

    assert.equal(request.reasoning_effort, undefined);
    assert.equal(request.reasoning_format, undefined);
});
