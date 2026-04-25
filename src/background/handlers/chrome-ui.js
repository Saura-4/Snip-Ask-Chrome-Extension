import { getStorage } from '../core/storage.js';
import { CONTENT_SCRIPT_FILES, isRestrictedPage } from '../core/content-script-files.js';

const ASK_AI_MENU_ID = 'askAI';

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
                    console.error('Snip & Ask: Failed to create context menu', chrome.runtime.lastError.message);
                }
                resolve();
            });
        } catch (error) {
            console.error('Snip & Ask: Failed to create context menu', error);
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

async function prepareSidePanelIfPreferred(tab) {
    if (!tab?.id) return;

    // Read the user's preference. We do this in parallel with the open
    // attempt to minimise the async gap before sidePanel.open().
    const storagePromise = getStorage(['chatDisplayMode']);

    // Try to open the side panel IMMEDIATELY to preserve the user gesture.
    // The default_path from manifest.json is used automatically.
    let panelOpened = false;
    try {
        await chrome.sidePanel.open({ windowId: tab.windowId || undefined });
        panelOpened = true;
    } catch (error) {
        // Fallback: try with tabId
        try {
            await chrome.sidePanel.open({ tabId: tab.id });
            panelOpened = true;
        } catch {
            // Side panel open failed entirely — continue without it
        }
    }

    const storage = await storagePromise;
    if (storage.chatDisplayMode !== 'sidebar') {
        // User doesn't want sidebar mode. Close the panel we just opened.
        if (panelOpened && chrome.sidePanel.close) {
            try {
                await chrome.sidePanel.close({ windowId: tab.windowId || undefined });
            } catch {
                // Ignore close failures
            }
        }
        return;
    }

    // Panel is open and user wants sidebar — ensure options are set
    try {
        await chrome.sidePanel.setOptions({
            tabId: tab.id,
            path: 'src/sidepanel/sidepanel.html',
            enabled: true
        });
    } catch (error) {
        console.warn('Snip & Ask: Failed to set side panel options', error?.message || error);
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
            await prepareSidePanelIfPreferred(tab);
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
            await prepareSidePanelIfPreferred(tab);
            await sendMessageWithInjectionFallback(tab, { action: 'START_SNIP' });
        } catch (error) {
            console.error('Snip & Ask: Failed to start snip:', getTabFailureReason(tab, error), error);
        }
    });
}
