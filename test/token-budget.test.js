import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeMessageHistory } from '../src/background/ai/token-budget.js';

test('token budgeting preserves the system instruction and latest user message', () => {
    const messages = [
        { role: 'system', content: 'Follow the requested format.' },
        { role: 'user', content: 'old '.repeat(60_000) },
        { role: 'assistant', content: 'old response '.repeat(60_000) },
        { role: 'user', content: 'latest request' }
    ];

    const result = optimizeMessageHistory(messages, 'ollama:llama3', [], { mode: 'short' });
    assert.equal(result.error, null);
    assert.equal(result.messages[0].role, 'system');
    assert.equal(result.messages.at(-1).content, 'latest request');
    assert.equal(result.pruned, true);
});
