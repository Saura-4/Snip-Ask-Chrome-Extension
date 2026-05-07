export const CONTENT_SCRIPT_FILES = [
    'lib/katex.min.js',
    'src/content/utils.js',
    'src/content/ui-helpers.js',
    'src/content/chat/message-utils.js',
    'src/content/chat/render-utils.js',
    'src/content/chat/session-state.js',
    'src/content/window-manager.js',
    'src/content/popup-window-sync.js',
    'src/content/snip-selection.js',
    'src/content/chat/floating-chat-ui.js',
    'src/content/content.js'
];

export function isRestrictedPage(url) {
    return !url ||
        url.startsWith("chrome://") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("https://chrome.google.com/webstore") ||
        url.startsWith("edge://") ||
        url.startsWith("about:");
}
