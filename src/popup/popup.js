document.addEventListener('DOMContentLoaded', () => 
{
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('modelSelect');
    const modeSelect = document.getElementById('modeSelect');
    const customPromptContainer = document.getElementById('customPromptContainer');
    const customPromptText = document.getElementById('customPromptText');
    const snipBtn = document.getElementById('snipBtn');
    const resetBtn = document.getElementById('resetBtn'); // Select the new reset button

    // 1. Load Saved Settings
    chrome.storage.local.get(['groqKey', 'interactionMode', 'customPrompt', 'selectedModel'], (result) => 
    {
      if (result.groqKey) apiKeyInput.value = result.groqKey;
      
      if (result.interactionMode) 
      {
        modeSelect.value = result.interactionMode;
        toggleCustomBox(result.interactionMode);
      }
      if (result.customPrompt) customPromptText.value = result.customPrompt;
      if (result.selectedModel) modelSelect.value = result.selectedModel;
    });
      
    // 2. Save Settings
    apiKeyInput.addEventListener('change', () => chrome.storage.local.set({ groqKey: apiKeyInput.value.trim() }));
    modelSelect.addEventListener('change', () => chrome.storage.local.set({ selectedModel: modelSelect.value }));
    
    modeSelect.addEventListener('change', () => 
    {
      const mode = modeSelect.value;
      chrome.storage.local.set({ interactionMode: mode });
      toggleCustomBox(mode);
    });
    
    customPromptText.addEventListener('change', () => chrome.storage.local.set({ customPrompt: customPromptText.value }));
    function toggleCustomBox(mode) {
      customPromptContainer.style.display = (mode === 'custom') ? 'block' : 'none';
    }

    // 3. Start Snipping
    snipBtn.addEventListener('click', () => 
    {
      const apiKey = apiKeyInput.value.trim();
      if (!apiKey) { alert("Please enter your Groq API Key!"); return; }
      
      if (!apiKey.startsWith("gsk_")) 
      { 
          alert("⚠️ Warning: That doesn't look like a Groq key (it should start with 'gsk_')."); 
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      {
        chrome.tabs.sendMessage(tabs[0].id, { action: "START_SNIP" })
          .then(() => window.close())
          .catch(() => alert("⚠️ Refresh the page first!"));
      });
    });

  // 4. Reset / Logout (Cleaned up to prevent dialog conflicts)
    const messageContainer = document.getElementById('messageContainer');
    if (resetBtn) {
      resetBtn.addEventListener('click', () =>
      {
        // 1. Ask User (Confirm is the only dialog we will use)
        if (confirm("Are you sure? This will remove your API Key and all settings."))
        {
          
          // Disable buttons and change text
          resetBtn.disabled = true; 
          resetBtn.innerText = "Purging...";
          snipBtn.disabled = true;
          // 2. Clear Storage
          chrome.storage.local.clear(() => 
          {
            
            // 3. Update UI
            apiKeyInput.value = "";
            customPromptText.value = "";
            messageContainer.style.display = 'block';
            
            // 4. Close the popup after a short delay for user confirmation
            setTimeout(() => 
            {
              window.close(); 
            }, 1500); // 1.5 seconds delay
          });
        }
        // If the user clicks 'No', the function simply returns, leaving the popup open 
        // and the key intact, fulfilling your requirement.
      });
    }
});