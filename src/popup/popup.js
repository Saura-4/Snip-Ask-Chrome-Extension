document.addEventListener('DOMContentLoaded', () => 
{
    const apiKeyInput = document.getElementById('apiKey');
    const geminiKeyInput = document.getElementById('geminiKey');
    const ollamaHostInput = document.getElementById('ollamaHost');
    const modelSelect = document.getElementById('modelSelect');
    const modeSelect = document.getElementById('modeSelect');
    const customPromptContainer = document.getElementById('customPromptContainer');
    const customPromptText = document.getElementById('customPromptText');
    const snipBtn = document.getElementById('snipBtn');
    const resetBtn = document.getElementById('resetBtn'); 

    // 1. Load Saved Settings
    chrome.storage.local.get(['groqKey', 'geminiKey', 'ollamaHost','interactionMode', 'customPrompt', 'selectedModel'], (result) => 
    {
      if (result.groqKey) apiKeyInput.value = result.groqKey;
      if (result.geminiKey) geminiKeyInput.value = result.geminiKey; 
      ollamaHostInput.value = result.ollamaHost || "http://localhost:11434"; 
      
      if (result.interactionMode) 
      {
        modeSelect.value = result.interactionMode;
        toggleCustomBox(result.interactionMode);
      }
      if (result.customPrompt) customPromptText.value = result.customPrompt;

      if (result.selectedModel) {
          modelSelect.value = result.selectedModel;
      } else {
          chrome.storage.local.set({ selectedModel: modelSelect.value });
      }
    });
      
    // 2. Save Settings
    apiKeyInput.addEventListener('change', () => chrome.storage.local.set({ groqKey: apiKeyInput.value.trim() }));
    geminiKeyInput.addEventListener('change', () => chrome.storage.local.set({ geminiKey: geminiKeyInput.value.trim() })); 
    ollamaHostInput.addEventListener('change', () => chrome.storage.local.set({ ollamaHost: ollamaHostInput.value.trim() })); 
    
    modelSelect.addEventListener('change', () => {
        if(modelSelect.value === 'ollama:custom') {
            const modelName = prompt("Enter your local Ollama model name (e.g., 'deepseek-coder'):", "llama3");
            if(modelName) {
                chrome.storage.local.set({ selectedModel: "ollama:" + modelName });
                const opt = modelSelect.querySelector('option[value="ollama:custom"]');
                if(opt) opt.text = `Custom: ${modelName}`;
            }
        } else {
            chrome.storage.local.set({ selectedModel: modelSelect.value });
        }
    });
    
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
      const currentModel = modelSelect.value;
      
      // === FIX 1: Correct Variable Naming ===
      const isOllama = currentModel.startsWith('ollama');
      const isGoogle = currentModel.includes('gemini') || currentModel.includes('gemma'); // Renamed to isGoogle for consistency
      
      // Validation Logic
      if (isOllama) {
          if (!ollamaHostInput.value.trim()) {
              alert("Please enter your Ollama Host URL (default: http://localhost:11434)");
              return;
          }
      } 
      else if (isGoogle) {
          if (!geminiKeyInput.value.trim()) { 
              alert("Please enter your Google API Key (starts with AIza...)"); 
              return; 
          }
      } 
      else {
          // Groq
          if (!apiKeyInput.value.trim()) { 
              alert("Please enter your Groq API Key (starts with gsk_...)"); 
              return; 
          }
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      {
        if (tabs.length === 0) return;
        chrome.tabs.sendMessage(tabs[0].id, { action: "START_SNIP" })
          .then(() => window.close())
          .catch((err) => {
              console.error(err);
              alert("⚠️ Could not start snip. Please refresh the page!");
          });
      });
    });

  // 4. Reset / Logout
    const messageContainer = document.getElementById('messageContainer');
    if (resetBtn) {
      resetBtn.addEventListener('click', () =>
      {
        if (confirm("Reset all settings?"))
        {
          chrome.storage.local.clear(() => 
          {
            apiKeyInput.value = "";
            geminiKeyInput.value = ""; 
            customPromptText.value = "";
            ollamaHostInput.value = "http://localhost:11434";
            if(messageContainer) messageContainer.style.display = 'block'; 
            setTimeout(() => window.close(), 1000); 
          });
        }
      });
    }
});