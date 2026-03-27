import { registerChromeUiHandlers } from './handlers/chrome-ui.js';
import { createRuntimeMessageListener } from './handlers/runtime-router.js';
import { warmDeviceFingerprint } from './fingerprint.js';

registerChromeUiHandlers();
chrome.runtime.onMessage.addListener(createRuntimeMessageListener());
warmDeviceFingerprint();
