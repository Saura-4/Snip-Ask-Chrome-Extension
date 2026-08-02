import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getModelProvider,
    isAutoGuestModel,
    resolveGuestModel
} from '../src/background/models/model-routing.js';

test('provider routing keeps scoped models with their provider', () => {
    assert.equal(getModelProvider('openai:gpt-5-mini'), 'openai');
    assert.equal(getModelProvider('openrouter:openai/gpt-oss-20b:free'), 'openrouter');
    assert.equal(getModelProvider('ollama:llava'), 'ollama');
    assert.equal(getModelProvider('gemini-2.5-flash'), 'google');
});

test('guest routing preserves Auto and rejects other provider scopes', () => {
    assert.equal(isAutoGuestModel('groq:auto'), true);
    assert.equal(resolveGuestModel('groq:auto', 'openai/gpt-oss-20b'), 'groq:auto');
    assert.equal(resolveGuestModel('openai:gpt-5-mini', 'openai/gpt-oss-20b'), 'openai/gpt-oss-20b');
});
