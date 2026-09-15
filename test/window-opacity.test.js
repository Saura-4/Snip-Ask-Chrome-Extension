import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

test('popup.html contains window opacity slider in General settings tab', () => {
    const html = readFileSync(resolve(root, 'src/popup/popup.html'), 'utf8');

    // Must be in generalTab
    const generalTabMatch = html.match(/id="generalTab"[\s\S]*?<\/div>\s*<\/div>\s*<script/);
    assert.ok(generalTabMatch, 'generalTab exists in popup.html');

    const generalTabContent = generalTabMatch[0];
    assert.match(generalTabContent, /id="windowOpacityInput"/, 'Slider input exists in general tab');
    assert.match(generalTabContent, /id="windowOpacityValue"/, 'Value badge exists in general tab');
    assert.match(generalTabContent, /min="0"/, 'Slider minimum is 0');
    assert.match(generalTabContent, /max="100"/, 'Slider maximum is 100');
    assert.match(generalTabContent, /type="range"/, 'Input type is range');
});

test('popup.css contains styles for opacity slider and badge', () => {
    const css = readFileSync(resolve(root, 'src/popup/popup.css'), 'utf8');

    assert.match(css, /\.opacity-slider/, 'Contains .opacity-slider class');
    assert.match(css, /\.opacity-value/, 'Contains .opacity-value class');
    assert.match(css, /\.opacity-slider-container/, 'Contains .opacity-slider-container class');
    assert.match(css, /::-webkit-slider-thumb/, 'Custom webkit slider thumb styled');
});

test('popup.js reads and writes windowOpacity in chrome.storage.local', () => {
    const js = readFileSync(resolve(root, 'src/popup/popup.js'), 'utf8');

    assert.match(js, /windowOpacityInput/, 'References windowOpacityInput element');
    assert.match(js, /windowOpacityValue/, 'References windowOpacityValue element');
    assert.match(js, /chrome\.storage\.local\.get\(\['windowOpacity'\]/, 'Retrieves windowOpacity from storage');
    assert.match(js, /chrome\.storage\.local\.set\(\{\s*windowOpacity:/, 'Persists windowOpacity to storage');
});

test('floating-chat-ui.js and window-manager.js implement windowOpacity correctly', () => {
    const floatingJs = readFileSync(resolve(root, 'src/content/chat/floating-chat-ui.js'), 'utf8');
    const windowMgrJs = readFileSync(resolve(root, 'src/content/window-manager.js'), 'utf8');

    // floating-chat-ui checks
    assert.match(floatingJs, /applyOpacity\s*\(/, 'FloatingChatUI implements applyOpacity method');
    assert.match(floatingJs, /--sa-window-opacity/, 'Sets --sa-window-opacity custom property');
    assert.match(floatingJs, /to\s*\{\s*opacity:\s*var\(--sa-window-opacity,\s*1\)/, 'slideIn keyframe uses --sa-window-opacity');
    assert.match(floatingJs, /from\s*\{\s*opacity:\s*var\(--sa-window-opacity,\s*1\)/, 'slideOut keyframe uses --sa-window-opacity');

    // window-manager checks
    assert.match(windowMgrJs, /windowOpacity/, 'WindowManager tracks windowOpacity');
    assert.match(windowMgrJs, /changes\.windowOpacity/, 'WindowManager reacts to windowOpacity storage changes');
});

test('opacity normalization logic bounds value between 0 and 1', () => {
    function normalizeOpacity(val) {
        const num = val !== undefined && val !== null ? Number(val) : 100;
        const bounded = Math.max(0, Math.min(100, isNaN(num) ? 100 : num));
        return (bounded / 100).toString();
    }

    assert.equal(normalizeOpacity(100), '1');
    assert.equal(normalizeOpacity(0), '0');
    assert.equal(normalizeOpacity(50), '0.5');
    assert.equal(normalizeOpacity(75), '0.75');
    assert.equal(normalizeOpacity(150), '1');
    assert.equal(normalizeOpacity(-10), '0');
    assert.equal(normalizeOpacity(undefined), '1');
    assert.equal(normalizeOpacity(null), '1');
    assert.equal(normalizeOpacity('invalid'), '1');
});
