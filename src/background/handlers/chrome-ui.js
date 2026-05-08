import { getStorage } from '../core/storage.js';
import { CONTENT_SCRIPT_FILES, isRestrictedPage } from '../core/content-script-files.js';

const ASK_AI_MENU_ID = 'askAI';

function logContextMenuSetupIssue(message, details = null) {
    if (details) {
        console.debug('Snip & Ask: Context menu setup skipped:', message, details);
        return;
    }

    console.debug('Snip & Ask: Context menu setup skipped:', message);
}

function getRestrictedPageReason(url) {
    if (!url) {
        return 'No tab URL is available.';
    }

    if (url.startsWith('chrome://')) {
        return 'Chrome internal pages do not allow extensions to inject UI.';
    }

    if (url.startsWith('chrome-extension://')) {
        return 'Chrome extension pages do not allow this extension to inject UI.';
    }

    if (url.startsWith('https://chrome.google.com/webstore')) {
        return 'The Chrome Web Store blocks extension injection.';
    }

    if (url.startsWith('edge://')) {
        return 'Edge internal pages do not allow extensions to inject UI.';
    }

    if (url.startsWith('about:')) {
        return 'Browser internal pages do not allow extensions to inject UI.';
    }

    return 'This page does not allow the extension UI to run.';
}

function getTabFailureReason(tab, error) {
    if (isRestrictedPage(tab?.url)) {
        return getRestrictedPageReason(tab?.url);
    }

    if (tab?.url?.startsWith('file://')) {
        return 'This looks like a local file page. In Chrome, enable "Allow access to file URLs" for the extension.';
    }

    return error?.message || String(error || 'Unknown tab error');
}

async function removeContextMenu(id) {
    await new Promise((resolve) => {
        try {
            chrome.contextMenus.remove(id, () => {
                const errorMessage = chrome.runtime.lastError?.message;
                if (errorMessage && !errorMessage.includes('Cannot find menu item')) {
                    console.warn('Snip & Ask: Failed to remove context menu', errorMessage);
                }
                resolve();
            });
        } catch {
            resolve();
        }
    });
}

async function ensureAskAiContextMenu() {
    const storage = await getStorage(['hideContextMenu']);
    await removeContextMenu(ASK_AI_MENU_ID);

    if (storage.hideContextMenu) {
        return;
    }

    await new Promise((resolve) => {
        try {
            chrome.contextMenus.create({
                id: ASK_AI_MENU_ID,
                title: 'Ask AI about selection',
                contexts: ['selection']
            }, () => {
                if (chrome.runtime.lastError) {
                    logContextMenuSetupIssue(chrome.runtime.lastError.message);
                }
                resolve();
            });
        } catch (error) {
            logContextMenuSetupIssue(error?.message || String(error), error);
            resolve();
        }
    });
}

async function sendMessageWithInjectionFallback(tab, message) {
    if (!tab?.id) {
        throw new Error('No active tab was provided.');
    }

    try {
        return await chrome.tabs.sendMessage(tab.id, message);
    } catch (initialError) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: CONTENT_SCRIPT_FILES
            });
            return await chrome.tabs.sendMessage(tab.id, message);
        } catch (injectionError) {
            injectionError.cause = initialError;
            throw injectionError;
        }
    }
}

export function registerChromeUiHandlers() {
    chrome.runtime.onInstalled.addListener(async (details) => {
        if (details.reason === 'install') {
            chrome.tabs.create({ url: chrome.runtime.getURL('src/setupguide/setupguide.html') });
        }

        await ensureAskAiContextMenu();
    });

    chrome.runtime.onStartup.addListener(() => {
        void ensureAskAiContextMenu();
    });

    void ensureAskAiContextMenu();

    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
        if (isRestrictedPage(tab?.url)) {
            console.warn('Snip & Ask: Cannot run from context menu on this page:', getRestrictedPageReason(tab?.url));
            return;
        }

        if (info.menuItemId !== ASK_AI_MENU_ID || !info.selectionText?.trim()) {
            return;
        }

        try {
            await sendMessageWithInjectionFallback(tab, {
                action: 'SHOW_AI_RESPONSE_FOR_TEXT',
                text: info.selectionText
            });
        } catch (error) {
            console.error('Snip & Ask: Failed to handle selected text from context menu:', getTabFailureReason(tab, error), error);
        }
    });

    chrome.commands.onCommand.addListener(async (command) => {
        if (command !== 'start-snip') {
            return;
        }

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || isRestrictedPage(tab.url)) {
            console.warn('Snip & Ask: Cannot start snip on this page:', getRestrictedPageReason(tab?.url));
            return;
        }

        try {
            await sendMessageWithInjectionFallback(tab, { action: 'START_SNIP' });
        } catch (error) {
            console.error('Snip & Ask: Failed to start snip:', getTabFailureReason(tab, error), error);
        }
    });
}
