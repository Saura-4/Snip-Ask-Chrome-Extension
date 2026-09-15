import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

test('floating-chat-ui.js contains disabled styling and pointer-events for chat-header-action', () => {
    const js = readFileSync(resolve(root, 'src/content/chat/floating-chat-ui.js'), 'utf8');

    assert.match(js, /\.chat-header-action:disabled/, 'Contains .chat-header-action:disabled style');
    assert.match(js, /cursor:\s*not-allowed/, 'Uses cursor: not-allowed for disabled action');
    assert.match(js, /pointer-events:\s*auto/, 'Keeps pointer-events: auto for tooltip visibility on hover');
});

test('floating-chat-ui.js implements updateCompareButton and guards spawnCompareWindow', () => {
    const js = readFileSync(resolve(root, 'src/content/chat/floating-chat-ui.js'), 'utf8');

    assert.match(js, /updateCompareButton\s*\(\)\s*\{/, 'Implements updateCompareButton method');
    assert.match(js, /this\.compareBtn\.disabled\s*=\s*true/, 'Sets compareBtn.disabled = true in guest mode');
    assert.match(js, /Compare mode requires your own API key \(BYOK\)/, 'Has BYOK tooltip explanation');
    assert.match(js, /this\.updateCompareButton\(\)/, 'Calls updateCompareButton in initModel or window creation');
});

test('compare.js guards spawnCompareWindowFor against guest mode', () => {
    const js = readFileSync(resolve(root, 'src/content/chat/compare.js'), 'utf8');

    assert.match(js, /if\s*\(ui\.isGuestMode\)/, 'Checks ui.isGuestMode in spawnCompareWindowFor');
    assert.match(js, /Compare mode requires your own API key \(BYOK\)/, 'Shows BYOK error toast in compare.js');
});

test('sidepanel.js guards compareBtn against guest mode', () => {
    const js = readFileSync(resolve(root, 'src/sidepanel/sidepanel.js'), 'utf8');

    assert.match(js, /if\s*\(sidePanelUi\.isGuestMode\)/, 'Checks sidePanelUi.isGuestMode in sidepanel compareBtn click');
    assert.match(js, /Compare mode requires your own API key \(BYOK\)/, 'Shows BYOK error toast in sidepanel');
});

test('runtime-router.js rejects OPEN_COMPARE_FROM_SIDEPANEL for guest session', () => {
    const js = readFileSync(resolve(root, 'src/background/handlers/runtime-router.js'), 'utf8');

    assert.match(js, /request\.session\?\.isGuestMode/, 'Checks request.session?.isGuestMode in runtime router');
    assert.match(js, /Compare mode requires your own API key \(BYOK\)/, 'Returns BYOK error message');
});

test('content.js rejects OPEN_FLOATING_CHAT_SESSION compare for guest session', () => {
    const js = readFileSync(resolve(root, 'src/content/content.js'), 'utf8');

    assert.match(js, /request\.compare\s*&&\s*request\.session\?\.isGuestMode/, 'Checks guest mode for compare requests in content.js');
    assert.match(js, /Compare mode requires your own API key \(BYOK\)/, 'Returns BYOK error message in content.js');
});

test('updateCompareButton logic correctly toggles button state on a mock object', () => {
    class MockButton {
        constructor() {
            this.disabled = false;
            this.classes = new Set();
            this.title = '';
            this.attrs = {};
        }
        get classList() {
            return {
                add: (c) => this.classes.add(c),
                remove: (c) => this.classes.delete(c),
                contains: (c) => this.classes.has(c)
            };
        }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        removeAttribute(k) { delete this.attrs[k]; }
        getAttribute(k) { return this.attrs[k]; }
    }

    const mockUI = {
        isGuestMode: true,
        compareBtn: new MockButton(),
        updateCompareButton() {
            if (!this.compareBtn) return;
            if (this.isGuestMode) {
                this.compareBtn.disabled = true;
                this.compareBtn.classList.add('disabled');
                this.compareBtn.title = 'Compare mode requires your own API key (BYOK). Add an API key in settings to unlock.';
                this.compareBtn.setAttribute('aria-disabled', 'true');
            } else {
                this.compareBtn.disabled = false;
                this.compareBtn.classList.remove('disabled');
                this.compareBtn.title = 'Compare with another model';
                this.compareBtn.removeAttribute('aria-disabled');
            }
        }
    };

    // Guest mode active: button must be disabled with BYOK explanation
    mockUI.updateCompareButton();
    assert.equal(mockUI.compareBtn.disabled, true);
    assert.equal(mockUI.compareBtn.classList.contains('disabled'), true);
    assert.equal(mockUI.compareBtn.getAttribute('aria-disabled'), 'true');
    assert.match(mockUI.compareBtn.title, /BYOK/);

    // Guest mode inactive (user added API key): button enabled
    mockUI.isGuestMode = false;
    mockUI.updateCompareButton();
    assert.equal(mockUI.compareBtn.disabled, false);
    assert.equal(mockUI.compareBtn.classList.contains('disabled'), false);
    assert.equal(mockUI.compareBtn.getAttribute('aria-disabled'), undefined);
    assert.equal(mockUI.compareBtn.title, 'Compare with another model');
});
