import { registerChromeUiHandlers } from './handlers/chrome-ui.js';
import { createRuntimeMessageListener } from './handlers/runtime-router.js';

registerChromeUiHandlers();
chrome.runtime.onMessage.addListener(createRuntimeMessageListener());
