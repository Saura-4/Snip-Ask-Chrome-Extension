// setupguide.js - Setup Guide page script

// Handle chrome:// URL links (extensions/shortcuts)
document.getElementById('shortcutsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// Handle 'Enable File Access' link - opens extension details page
const extensionsLink = document.getElementById('extensionsLink');
if (extensionsLink) {
    extensionsLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    });
}

// Handle UPI ID Copy
const upiCode = document.querySelector('code[title="Click to copy"]');
if (upiCode) {
    // Store original text once
    const originalText = upiCode.textContent;

    upiCode.addEventListener('click', () => {
        // Always copy the original text, not the current text (which might be "Copied!")
        navigator.clipboard.writeText(originalText).then(() => {
            upiCode.textContent = "Copied!";
            upiCode.style.color = "#4caf50";
            
            // Clear any existing timeout to prevent flickering if clicked rapidly
            if (upiCode._timeout) clearTimeout(upiCode._timeout);
            
            upiCode._timeout = setTimeout(() => {
                upiCode.textContent = originalText;
                upiCode.style.color = "#ff9e80"; // Restore original color
            }, 1500);
        });
    });
}
