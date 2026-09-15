import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_MODELS, CHAT_WINDOW_MODELS } from '../src/background/models/models-config.js';
import { getModelProvider } from '../src/background/models/model-routing.js';
import { getModelBudget } from '../src/background/ai/token-budget.js';

test('new models are registered in ALL_MODELS and CHAT_WINDOW_MODELS', () => {
    const googleAll = ALL_MODELS.google.map(m => m.value);
    const googleChat = CHAT_WINDOW_MODELS.google.map(m => m.value);
    assert.ok(googleAll.includes('gemini-3.8-flash'), 'gemini-3.8-flash in ALL_MODELS.google');
    assert.ok(googleChat.includes('gemini-3.8-flash'), 'gemini-3.8-flash in CHAT_WINDOW_MODELS.google');
    assert.ok(googleAll.includes('gemini-3.1-pro-preview'), 'gemini-3.1-pro-preview in ALL_MODELS.google');
    assert.ok(googleChat.includes('gemini-3.1-pro-preview'), 'gemini-3.1-pro-preview in CHAT_WINDOW_MODELS.google');

    const openaiAll = ALL_MODELS.openai.map(m => m.value);
    const openaiChat = CHAT_WINDOW_MODELS.openai.map(m => m.value);
    assert.ok(openaiAll.includes('openai:gpt-6-astra'), 'gpt-6-astra in ALL_MODELS.openai');
    assert.ok(openaiChat.includes('openai:gpt-6-astra'), 'gpt-6-astra in CHAT_WINDOW_MODELS.openai');
    assert.ok(openaiAll.includes('openai:gpt-5.6-sol'), 'gpt-5.6-sol in ALL_MODELS.openai');
    assert.ok(openaiChat.includes('openai:gpt-5.6-sol'), 'gpt-5.6-sol in CHAT_WINDOW_MODELS.openai');
    assert.ok(openaiAll.includes('openai:gpt-5.4'), 'gpt-5.4 in ALL_MODELS.openai');
    assert.ok(openaiChat.includes('openai:gpt-5.4'), 'gpt-5.4 in CHAT_WINDOW_MODELS.openai');
    assert.ok(openaiAll.includes('openai:gpt-5.4-mini'), 'gpt-5.4-mini in ALL_MODELS.openai');
    assert.ok(openaiChat.includes('openai:gpt-5.4-mini'), 'gpt-5.4-mini in CHAT_WINDOW_MODELS.openai');
    assert.ok(openaiAll.includes('openai:o3-mini'), 'o3-mini in ALL_MODELS.openai');
    assert.ok(openaiChat.includes('openai:o3-mini'), 'o3-mini in CHAT_WINDOW_MODELS.openai');

    const openrouterAll = ALL_MODELS.openrouter.map(m => m.value);
    const openrouterChat = CHAT_WINDOW_MODELS.openrouter.map(m => m.value);
    assert.ok(openrouterAll.includes('openrouter:nvidia/nemotron-3.5-lightning:free'), 'nemotron-3.5 in ALL_MODELS.openrouter');
    assert.ok(openrouterChat.includes('openrouter:nvidia/nemotron-3.5-lightning:free'), 'nemotron-3.5 in CHAT_WINDOW_MODELS.openrouter');

    const ollamaAll = ALL_MODELS.ollama.map(m => m.value);
    const ollamaChat = CHAT_WINDOW_MODELS.ollama.map(m => m.value);
    assert.ok(ollamaAll.includes('ollama:llama4'), 'llama4 in ALL_MODELS.ollama');
    assert.ok(ollamaChat.includes('ollama:llama4'), 'llama4 in CHAT_WINDOW_MODELS.ollama');
    assert.ok(ollamaAll.includes('ollama:qwen3-vl'), 'qwen3-vl in ALL_MODELS.ollama');
    assert.ok(ollamaChat.includes('ollama:qwen3-vl'), 'qwen3-vl in CHAT_WINDOW_MODELS.ollama');
    assert.ok(ollamaAll.includes('ollama:qwen3-coder'), 'qwen3-coder in ALL_MODELS.ollama');
    assert.ok(ollamaChat.includes('ollama:qwen3-coder'), 'qwen3-coder in CHAT_WINDOW_MODELS.ollama');
    assert.ok(ollamaAll.includes('ollama:deepseek-r1'), 'deepseek-r1 in ALL_MODELS.ollama');
    assert.ok(ollamaChat.includes('ollama:deepseek-r1'), 'deepseek-r1 in CHAT_WINDOW_MODELS.ollama');
});

test('new models route correctly to their respective providers', () => {
    assert.equal(getModelProvider('gemini-3.8-flash'), 'google');
    assert.equal(getModelProvider('gemini-3.1-pro-preview'), 'google');
    assert.equal(getModelProvider('openai:gpt-6-astra'), 'openai');
    assert.equal(getModelProvider('openai:gpt-5.6-sol'), 'openai');
    assert.equal(getModelProvider('openai:gpt-5.4'), 'openai');
    assert.equal(getModelProvider('openai:gpt-5.4-mini'), 'openai');
    assert.equal(getModelProvider('openai:o3-mini'), 'openai');
    assert.equal(getModelProvider('openrouter:nvidia/nemotron-3.5-lightning:free'), 'openrouter');
    assert.equal(getModelProvider('ollama:llama4'), 'ollama');
    assert.equal(getModelProvider('ollama:qwen3-vl'), 'ollama');
});

test('new models receive context budgets', () => {
    assert.equal(getModelBudget('gemini-3.8-flash').contextWindow, 1048576);
    assert.equal(getModelBudget('openai:gpt-6-astra').contextWindow, 1048576);
    assert.equal(getModelBudget('openai:gpt-5.6-sol').contextWindow, 400000);
    assert.equal(getModelBudget('openai:gpt-5.4').contextWindow, 400000);
    assert.equal(getModelBudget('openai:gpt-5.4-mini').contextWindow, 400000);
    assert.equal(getModelBudget('openai:o3-mini').contextWindow, 200000);
    assert.ok(getModelBudget('openrouter:nvidia/nemotron-3.5-lightning:free').contextWindow >= 64000);
    assert.equal(getModelBudget('ollama:llama4').contextWindow, 4096);
});
