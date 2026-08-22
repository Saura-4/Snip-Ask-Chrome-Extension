import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONTENT_SCRIPT_FILES } from '../src/background/core/content-script-files.js';

test('manifest grants Ollama access only as an optional runtime permission', async () => {
    const manifestText = await readFile(new URL('../manifest.json', import.meta.url), 'utf8');
    assert.equal((manifestText.match(/"optional_host_permissions"/g) || []).length, 1);
    const manifest = JSON.parse(manifestText);
    assert.ok(manifest.optional_host_permissions.includes('http://*/*'));
    assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
    assert.equal(manifest.host_permissions.some((origin) => origin === 'http://*/*'), false);
});

test('DOMPurify loads before markdown rendering utilities', () => {
    const purifier = CONTENT_SCRIPT_FILES.indexOf('lib/purify.min.js');
    const renderer = CONTENT_SCRIPT_FILES.indexOf('src/content/utils.js');
    assert.ok(purifier >= 0);
    assert.ok(purifier < renderer);
});

test('sidepanel loads DOMPurify before markdown rendering utilities', async () => {
    const html = await readFile(new URL('../src/sidepanel/sidepanel.html', import.meta.url), 'utf8');
    const purifier = html.indexOf('lib/purify.min.js');
    const renderer = html.indexOf('../content/utils.js');
    assert.ok(purifier >= 0, 'sidepanel.html must load lib/purify.min.js');
    assert.ok(renderer >= 0, 'sidepanel.html must load src/content/utils.js');
    assert.ok(purifier < renderer, 'DOMPurify must load before utils.js in sidepanel.html');
});
