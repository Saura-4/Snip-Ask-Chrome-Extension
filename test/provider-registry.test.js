import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getModelProvider,
    isGroqModel,
    isRegistryProviderModel,
    normalizeProviderScopedModelName
} from '../src/background/models/model-routing.js';
import {
    OPENAI_COMPATIBLE_PROVIDERS,
    buildModelOptions,
    getProviderConfigForModel,
    getProviderStorageKeys,
    isVisionCapableModel
} from '../src/background/models/provider-registry.js';
import { getSafeLimit } from '../src/background/ai/token-budget.js';

test('every registry provider routes its scoped models to itself', () => {
    for (const config of Object.values(OPENAI_COMPATIBLE_PROVIDERS)) {
        const modelValue = `${config.prefix}${config.models[0].id}`;
        assert.equal(getModelProvider(modelValue), config.id, modelValue);
        assert.equal(isRegistryProviderModel(modelValue), true, modelValue);
        assert.equal(isGroqModel(modelValue), false, modelValue);
        assert.equal(normalizeProviderScopedModelName(modelValue), config.models[0].id, modelValue);
    }
});

test('registry routing does not steal existing provider models', () => {
    assert.equal(getModelProvider('openrouter:deepseek/deepseek-r1-0528:free'), 'openrouter');
    assert.equal(getModelProvider('openai:gpt-5-mini'), 'openai');
    assert.equal(getModelProvider('ollama:llava'), 'ollama');
    assert.equal(getModelProvider('gemini-2.5-flash'), 'google');
    assert.equal(getModelProvider('openai/gpt-oss-20b'), 'groq');
    assert.equal(isRegistryProviderModel('openrouter:deepseek/deepseek-r1-0528:free'), false);
});

test('registry entries are internally consistent and collision-free', () => {
    const prefixes = new Set();
    const storageKeys = new Set();

    for (const [key, config] of Object.entries(OPENAI_COMPATIBLE_PROVIDERS)) {
        assert.equal(key, config.id, 'registry key must match config.id');
        assert.equal(config.prefix, `${config.id}:`, `${config.id} prefix must be "<id>:"`);
        assert.ok(config.apiEndpoint.startsWith('https://'), `${config.id} endpoint must be https`);
        assert.ok(config.models.length > 0, `${config.id} needs at least one model`);
        assert.ok(config.models.some(m => m.chat === true), `${config.id} needs a chat-dropdown model`);

        // The host permission must actually cover the endpoint origin.
        const origin = new URL(config.apiEndpoint).origin;
        assert.equal(config.hostPermission, `${origin}/*`, `${config.id} host permission mismatch`);

        assert.equal(prefixes.has(config.prefix), false, `duplicate prefix ${config.prefix}`);
        assert.equal(storageKeys.has(config.storageKey), false, `duplicate storage key ${config.storageKey}`);
        prefixes.add(config.prefix);
        storageKeys.add(config.storageKey);
    }

    assert.equal(getProviderStorageKeys().length, Object.keys(OPENAI_COMPATIBLE_PROVIDERS).length);
});

test('registry host permissions are all declared in the manifest', async () => {
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

    for (const config of Object.values(OPENAI_COMPATIBLE_PROVIDERS)) {
        assert.ok(
            manifest.host_permissions.includes(config.hostPermission),
            `manifest is missing host permission ${config.hostPermission} for ${config.id}`
        );
    }
});

test('text-only providers never report vision support', () => {
    const cerebras = getProviderConfigForModel('cerebras:qwen-3.8-27b');
    assert.equal(isVisionCapableModel(cerebras, 'cerebras:qwen-3.8-27b'), false);
    // Even a custom model that looks multimodal stays text-only on Cerebras.
    assert.equal(isVisionCapableModel(cerebras, 'cerebras:some-custom-vision-model'), false);
});

test('vision-capable models are recognised with or without their prefix', () => {
    const zai = getProviderConfigForModel('zai:glm-4.6v');
    assert.equal(isVisionCapableModel(zai, 'zai:glm-4.6v'), true);
    assert.equal(isVisionCapableModel(zai, 'glm-4.6v'), true);
    assert.equal(isVisionCapableModel(zai, 'zai:glm-5.3'), false);
    // glm-4.7-flash is text-only even though other *-flash models see images.
    assert.equal(isVisionCapableModel(zai, 'zai:glm-4.7-flash'), false);

    const deepseek = getProviderConfigForModel('deepseek:deepseek-flash');
    assert.equal(isVisionCapableModel(deepseek, 'deepseek:deepseek-flash'), true);

    const meta = getProviderConfigForModel('meta:muse-spark-1.3');
    assert.equal(isVisionCapableModel(meta, 'meta:muse-spark-1.3'), true);

    const kimi = getProviderConfigForModel('moonshot:kimi-k3');
    assert.equal(isVisionCapableModel(kimi, 'moonshot:kimi-k3'), true);
});

test('model options carry the provider prefix and a custom entry', () => {
    const config = OPENAI_COMPATIBLE_PROVIDERS.moonshot;
    const options = buildModelOptions(config, false);

    assert.equal(options[options.length - 1].value, 'moonshot:custom');
    for (const option of options.slice(0, -1)) {
        assert.ok(option.value.startsWith('moonshot:'), option.value);
    }

    const chatOptions = buildModelOptions(config, true);
    assert.ok(chatOptions.length > 0);
    assert.equal(chatOptions.some(o => o.value.endsWith(':custom')), false);
});

test('custom model patterns accept real ids and reject junk', () => {
    for (const config of Object.values(OPENAI_COMPATIBLE_PROVIDERS)) {
        for (const model of config.models) {
            assert.ok(
                config.customModel.pattern.test(model.id),
                `${config.id} pattern rejects its own model ${model.id}`
            );
        }
        assert.equal(config.customModel.pattern.test('bad id/with slash'), false, config.id);
        assert.equal(config.customModel.pattern.test(''), false, config.id);
    }
});

test('registry models get a real context budget, not the 32k default', () => {
    for (const config of Object.values(OPENAI_COMPATIBLE_PROVIDERS)) {
        for (const model of config.models) {
            const scoped = getSafeLimit(`${config.prefix}${model.id}`);
            const bare = getSafeLimit(model.id);
            assert.ok(scoped >= 65536, `${config.prefix}${model.id} budget too small: ${scoped}`);
            assert.ok(bare >= 65536, `${model.id} (bare) budget too small: ${bare}`);
        }
    }
});
