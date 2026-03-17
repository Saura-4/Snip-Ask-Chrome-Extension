import { getStorage } from '../core/storage.js';
import { CONTENT_SCRIPT_FILES, isRestrictedPage } from '../core/content-script-files.js';

export function registerChromeUiHandlers() {
    chrome.runtime.onInstalled.addListener(async (details) => {
        if (details.reason === 'install') {
            chrome.tabs.create({ url: chrome.runtime.getURL('src/setupguide/setupguide.html') });
        }

        const storage = await getStorage(['hideContextMenu']);
        if (!storage.hideContextMenu) {
            chrome.contextMenus.create({
                id: "askAI",
                title: "Ask AI about selection",
                contexts: ["selection"]
            });
        }
    });

    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
        if (isRestrictedPage(tab?.url)) {
            console.warn("Snip & Ask: Cannot run on this restricted page");
            return;
        }

        if (info.menuItemId === "askAI" && info.selectionText) {
            try {
                await chrome.tabs.sendMessage(tab.id, {
                    action: "SHOW_AI_RESPONSE_FOR_TEXT",
                    text: info.selectionText
                });
            } catch (error) {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: CONTENT_SCRIPT_FILES
                });
                await chrome.tabs.sendMessage(tab.id, {
                    action: "SHOW_AI_RESPONSE_FOR_TEXT",
                    text: info.selectionText
                });
            }
        }
    });

    chrome.commands.onCommand.addListener(async (command) => {
        if (command !== "start-snip") {
            return;
        }

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || isRestrictedPage(tab.url)) {
            console.warn("Snip & Ask: Cannot run on this restricted page");
            return;
        }

        try {
            await chrome.tabs.sendMessage(tab.id, { action: "START_SNIP" });
        } catch (error) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: CONTENT_SCRIPT_FILES
            });
            await chrome.tabs.sendMessage(tab.id, { action: "START_SNIP" });
        }
    });
}
