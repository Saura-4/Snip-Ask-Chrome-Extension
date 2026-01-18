// setupguide.js - Setup Guide page script

// Handle chrome:// URL link (can't be clicked directly)
document.getElementById('shortcutsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
