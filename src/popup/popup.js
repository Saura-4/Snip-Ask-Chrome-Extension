document.addEventListener('DOMContentLoaded', () => 
{
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('modelSelect');
    const modeSelect = document.getElementById('modeSelect');
    const customPromptContainer = document.getElementById('customPromptContainer');
    const customPromptText = document.getElementById('customPromptText');
    const snipBtn = document.getElementById('snipBtn');
    const resetBtn = document.getElementById('resetBtn'); 

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

      // --- UPDATED LOGIC HERE ---
      if (result.selectedModel) {
          modelSelect.value = result.selectedModel;
      } else {
          // Critical: If no model is saved (first run), save the default one immediately.
          // This ensures content.js always knows what model is selected.
          chrome.storage.local.set({ selectedModel: modelSelect.value });
      }
      // --------------------------
    });
      
    // 2. Save Settings
    apiKeyInput.addEventListener('change', () => chrome.storage.local.set({ groqKey: apiKeyInput.value.trim() }));
    
    // This line you already had is correct:
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

  // 4. Reset / Logout
    const messageContainer = document.getElementById('messageContainer');
    if (resetBtn) {
      resetBtn.addEventListener('click', () =>
      {
        if (confirm("Are you sure? This will remove your API Key and all settings."))
        {
          resetBtn.disabled = true; 
          resetBtn.innerText = "Purging...";
          snipBtn.disabled = true;
          
          chrome.storage.local.clear(() => 
          {
            apiKeyInput.value = "";
            customPromptText.value = "";
            if(messageContainer) messageContainer.style.display = 'block'; // Added safety check
            
            setTimeout(() => 
            {
              window.close(); 
            }, 1500); 
          });
        }
      });
    }
});