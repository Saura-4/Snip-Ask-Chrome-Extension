document.addEventListener('DOMContentLoaded', () => 
{
    const apiKeyInput = document.getElementById('apiKey');
    const geminiKeyInput = document.getElementById('geminiKey'); // NEW
    const modelSelect = document.getElementById('modelSelect');
    const modeSelect = document.getElementById('modeSelect');
    const customPromptContainer = document.getElementById('customPromptContainer');
    const customPromptText = document.getElementById('customPromptText');
    const snipBtn = document.getElementById('snipBtn');
    const resetBtn = document.getElementById('resetBtn'); 

    // 1. Load Saved Settings
    chrome.storage.local.get(['groqKey', 'geminiKey', 'interactionMode', 'customPrompt', 'selectedModel'], (result) => 
    {
      if (result.groqKey) apiKeyInput.value = result.groqKey;
      if (result.geminiKey) geminiKeyInput.value = result.geminiKey; // NEW
      
      if (result.interactionMode) 
      {
        modeSelect.value = result.interactionMode;
        toggleCustomBox(result.interactionMode);
      }
      if (result.customPrompt) customPromptText.value = result.customPrompt;

      if (result.selectedModel) {
          modelSelect.value = result.selectedModel;
      } else {
          // Default save on first run
          chrome.storage.local.set({ selectedModel: modelSelect.value });
      }
    });
      
    // 2. Save Settings (Auto-save on change)
    apiKeyInput.addEventListener('change', () => chrome.storage.local.set({ groqKey: apiKeyInput.value.trim() }));
    geminiKeyInput.addEventListener('change', () => chrome.storage.local.set({ geminiKey: geminiKeyInput.value.trim() })); // NEW
    
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

    // 3. Start Snipping (Updated Validation)
    snipBtn.addEventListener('click', () => 
    {
      const currentModel = modelSelect.value;
      
      // Determine which key is required based on the model name
      // (Gemini and Gemma both use the Google API Key)
      const isGoogleModel = currentModel.includes('gemini') || currentModel.includes('gemma');
      
      const requiredKey = isGoogleModel ? geminiKeyInput.value.trim() : apiKeyInput.value.trim();
      
      if (!requiredKey) {
          const providerName = isGoogleModel ? "Google (Gemini)" : "Groq";
          alert(`Please enter your ${providerName} API Key to use this model!`); 
          return; 
      }
      
      // Basic format check
      if (!isGoogleModel && !requiredKey.startsWith("gsk_")) { 
          alert("⚠️ Warning: That doesn't look like a Groq key (it should start with 'gsk_')."); 
      }
      if (isGoogleModel && !requiredKey.startsWith("AIza")) {
          alert("⚠️ Warning: That doesn't look like a Google API key (it should start with 'AIza').");
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
        if (confirm("Are you sure? This will remove ALL your API Keys and settings."))
        {
          resetBtn.disabled = true; 
          resetBtn.innerText = "Purging...";
          snipBtn.disabled = true;
          
          chrome.storage.local.clear(() => 
          {
            apiKeyInput.value = "";
            geminiKeyInput.value = ""; // Clear UI
            customPromptText.value = "";
            if(messageContainer) messageContainer.style.display = 'block'; 
            
            setTimeout(() => 
            {
              window.close(); 
            }, 1500); 
          });
        }
      });
    }
});