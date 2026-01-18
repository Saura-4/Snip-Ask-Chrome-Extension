// popup.js - Custom Modes & Provider Selection

// --- DEFAULT DATA ---
const DEFAULT_MODES = [
  { id: 'short', name: '⚡ Short Answer', prompt: "You are a concise answer engine. 1. Analyze the user's input. 2. If it is a multiple-choice question, Output in this format: 'Answer: <option>. <explanation>'. 3. For follow-up chat or non-questions, reply naturally but concisely.", isDefault: true },
  { id: 'detailed', name: '🧠 Detailed', prompt: "You are an expert tutor. Analyze the input. Provide a detailed, step-by-step answer. Use Markdown.", isDefault: true },
  { id: 'code', name: '💻 Code Debug', prompt: "You are a code debugger. Correct the code and explain the fix. Output a single fenced code block first.", isDefault: true }
];

const DEFAULT_PROVIDERS = {
  groq: true,
  google: false,
  openrouter: false,
  ollama: false
};

// Generate default enabled models (all enabled by default)
function getDefaultEnabledModels() {
  const enabled = {};
  for (const [provider, models] of Object.entries(ALL_MODELS)) {
    models.forEach(model => {
      enabled[model.value] = true;
    });
  }
  return enabled;
}

const ALL_MODELS = {
  groq: [
    { value: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout (Vision)' },
    { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick (Vision)' },
    { value: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Text)' },
    { value: 'qwen/qwen3-32b', name: 'Qwen 3 32B (Text)' }
  ],
  google: [
    { value: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.0-flash-lite-preview-02-05', name: 'Gemini 2.0 Flash Lite' },
    { value: 'gemma-3-27b-it', name: 'Gemma 3 27B (Vision)' },
    { value: 'gemma-3-12b-it', name: 'Gemma 3 12B (Vision)' },
    { value: 'gemma-3-4b-it', name: 'Gemma 3 4B' },
    { value: 'gemma-3-1b-it', name: 'Gemma 3 1B' }
  ],
  openrouter: [
    { value: 'openrouter:deepseek/deepseek-r1-0528:free', name: 'DeepSeek R1 (Free)' },
    { value: 'openrouter:custom', name: '⚙️ Custom Model' }
  ],
  ollama: [
    { value: 'ollama:gemma3:4b', name: 'Gemma 3 4B' },
    { value: 'ollama:llama3', name: 'Llama 3' },
    { value: 'ollama:mistral', name: 'Mistral' },
    { value: 'ollama:llava', name: 'LLaVA (Vision)' },
    { value: 'ollama:moondream', name: 'Moondream (Vision)' },
    { value: 'ollama:custom', name: '⚙️ Custom Model' }
  ]
};

const PROVIDER_LABELS = {
  groq: '🚀 Groq (Fast)',
  google: '✨ Google (Gemini)',
  openrouter: '🌐 OpenRouter',
  ollama: '🦙 Ollama (Local)'
};

const API_KEY_CONFIG = {
  groq: { id: 'apiKey', placeholder: 'Groq Key (gsk_...)', type: 'password', storageKey: 'groqKey' },
  google: { id: 'geminiKey', placeholder: 'Google Key (AIza...)', type: 'password', storageKey: 'geminiKey' },
  openrouter: { id: 'openrouterKey', placeholder: 'OpenRouter Key (sk-or-...)', type: 'password', storageKey: 'openrouterKey' },
  ollama: { id: 'ollamaHost', placeholder: 'Ollama URL (http://localhost:11434)', type: 'text', storageKey: 'ollamaHost' }
};

// --- STATE ---
let editingModeId = null;
let isGuestModeActive = false;
const MIN_PANEL_WIDTH = 480;
const MIN_PANEL_HEIGHT = 600;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  await initializeDefaults();
  await checkGuestStatus(); // Check guest mode first
  await loadSettings();
  setupEventListeners();
  setupDynamicResize();

  // Load version dynamically from manifest.json
  const versionEl = document.getElementById('versionDisplay');
  if (versionEl) {
    const manifest = chrome.runtime.getManifest();
    versionEl.textContent = `v${manifest.version}`;
  }
});

// --- GUEST MODE CHECK ---
async function checkGuestStatus() {
  try {
    // Check storage DIRECTLY instead of relying on background script
    // This prevents banner from being stuck when background doesn't respond
    const storage = await chrome.storage.local.get(['groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);

    // Check if any key has actual content (even if invalid)
    const hasGroqKey = storage.groqKey && storage.groqKey.trim().length > 0;
    const hasGeminiKey = storage.geminiKey && storage.geminiKey.trim().length > 0;
    const hasOpenRouterKey = storage.openrouterKey && storage.openrouterKey.trim().length > 0;
    const hasOllamaHost = storage.ollamaHost && storage.ollamaHost.trim().length > 0;

    // User is in guest mode ONLY if NO keys are entered
    const inGuestMode = !hasGroqKey && !hasGeminiKey && !hasOpenRouterKey && !hasOllamaHost;

    // Update state
    isGuestModeActive = inGuestMode;

    // Update banner immediately based on storage
    updateGuestBanner({
      isGuestMode: inGuestMode,
      isConfigured: true // Assume configured if GUEST_WORKER_URL is set in guest-config.js
    });

  } catch (e) {
    console.error('Failed to check guest status:', e);
    // On error, hide the banner to be safe
    const banner = document.getElementById('guestBanner');
    if (banner) banner.classList.add('hidden');
  }
}

function updateGuestBanner(guestStatus) {
  const banner = document.getElementById('guestBanner');

  if (!banner || !guestStatus) return;

  if (guestStatus.isGuestMode && guestStatus.isConfigured) {
    // Show guest mode banner (backend is source of truth for limits)
    banner.classList.remove('hidden');
  } else {
    // Hide banner (user has API keys or guest mode not configured)
    banner.classList.add('hidden');
  }
}

async function initializeDefaults() {
  const result = await chrome.storage.local.get(['customModes', 'enabledProviders', 'enabledModels']);

  if (!result.customModes) {
    await chrome.storage.local.set({ customModes: DEFAULT_MODES });
  }

  if (!result.enabledProviders) {
    await chrome.storage.local.set({ enabledProviders: DEFAULT_PROVIDERS });
  }

  if (!result.enabledModels) {
    await chrome.storage.local.set({ enabledModels: getDefaultEnabledModels() });
  }
}

// --- LOAD SETTINGS ---
async function loadSettings() {
  const result = await chrome.storage.local.get([
    'customModes', 'enabledProviders', 'enabledModels', 'selectedModel', 'selectedMode',
    'groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost', 'customPrompt',
    'providerHiddenSince', 'hideContextMenu'
  ]);

  // Check and cleanup old keys
  await checkKeyCleanup(result.enabledProviders || DEFAULT_PROVIDERS, result.providerHiddenSince || {});

  // Load providers into settings panel
  loadProviderToggles(result.enabledProviders || DEFAULT_PROVIDERS);

  // Load models list in settings
  loadModelsList(result.enabledProviders || DEFAULT_PROVIDERS, result.enabledModels || getDefaultEnabledModels());

  // Load models based on enabled providers and enabled models
  loadModels(result.enabledProviders || DEFAULT_PROVIDERS, result.enabledModels || getDefaultEnabledModels(), result.selectedModel);

  // Load API key inputs based on enabled providers
  loadApiKeyInputs(result.enabledProviders || DEFAULT_PROVIDERS, result);

  // Load modes
  loadModes(result.customModes || DEFAULT_MODES, result.selectedMode);

  // Load modes list in settings
  loadModesList(result.customModes || DEFAULT_MODES);

  // Show provider hint if only Groq enabled
  updateProviderHint(result.enabledProviders || DEFAULT_PROVIDERS);

  // Load context menu visibility setting
  const hideContextMenuToggle = document.getElementById('hideContextMenu');
  if (hideContextMenuToggle) {
    hideContextMenuToggle.checked = result.hideContextMenu === true;
  }

  // Handle custom prompt visibility
  const modeSelect = document.getElementById('modeSelect');
  const customPromptContainer = document.getElementById('customPromptContainer');
  const customPromptText = document.getElementById('customPromptText');

  if (result.selectedMode === 'custom') {
    customPromptContainer.classList.remove('hidden');
  }
  if (result.customPrompt) {
    customPromptText.value = result.customPrompt;
  }
}

function loadProviderToggles(enabledProviders) {
  document.getElementById('providerGroq').checked = enabledProviders.groq !== false;
  document.getElementById('providerGoogle').checked = enabledProviders.google === true;
  document.getElementById('providerOpenRouter').checked = enabledProviders.openrouter === true;
  document.getElementById('providerOllama').checked = enabledProviders.ollama === true;
}

function loadModels(enabledProviders, enabledModels, selectedModel) {
  const modelSelect = document.getElementById('modelSelect');
  modelSelect.innerHTML = '';

  // In guest mode, only show Groq models (ignore user's provider settings)
  const providersToShow = isGuestModeActive
    ? { groq: true, google: false, openrouter: false, ollama: false }
    : enabledProviders;

  for (const [provider, models] of Object.entries(ALL_MODELS)) {
    if (providersToShow[provider]) {
      // In guest mode, show ALL Groq models regardless of user's model settings
      const enabledModelsInProvider = isGuestModeActive && provider === 'groq'
        ? models
        : models.filter(model => enabledModels[model.value] !== false);

      if (enabledModelsInProvider.length > 0) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = PROVIDER_LABELS[provider];

        // Add Guest Mode indication
        if (isGuestModeActive && provider === 'groq') {
          optgroup.label = PROVIDER_LABELS[provider] + ' (Guest Mode)';
        }

        enabledModelsInProvider.forEach(model => {
          const option = document.createElement('option');
          option.value = model.value;
          option.textContent = model.name;
          optgroup.appendChild(option);
        });

        modelSelect.appendChild(optgroup);
      }
    }
  }

  if (selectedModel && [...modelSelect.options].some(opt => opt.value === selectedModel)) {
    modelSelect.value = selectedModel;
  } else if (modelSelect.options.length > 0) {
    // Saved model not available in dropdown - auto-select first available model
    // This happens when: switching providers, disabling providers, or guest mode
    modelSelect.selectedIndex = 0;
    // IMPORTANT: Save the auto-selected model to storage so startSnip uses it
    const autoSelectedModel = modelSelect.value;
    if (autoSelectedModel) {
      chrome.storage.local.set({ selectedModel: autoSelectedModel });
    }
  } else {
    // No models available - all providers disabled
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '⚠️ Enable a provider in Settings';
    emptyOption.disabled = true;
    modelSelect.appendChild(emptyOption);
    modelSelect.selectedIndex = 0;
  }
}

function loadModelsList(enabledProviders, enabledModels) {
  const modelsList = document.getElementById('modelsList');
  if (!modelsList) return;
  modelsList.innerHTML = '';

  for (const [provider, models] of Object.entries(ALL_MODELS)) {
    // Provider header
    const providerHeader = document.createElement('div');
    providerHeader.className = 'model-provider-header';
    providerHeader.innerHTML = `<span>${PROVIDER_LABELS[provider]}</span>`;
    if (!enabledProviders[provider]) {
      providerHeader.innerHTML += ' <span class="provider-disabled-badge">(Provider disabled)</span>';
    }
    modelsList.appendChild(providerHeader);

    // Models for this provider
    models.forEach(model => {
      const div = document.createElement('div');
      div.className = 'model-item';
      if (!enabledProviders[provider]) {
        div.classList.add('model-item-disabled');
      }
      div.innerHTML = `
        <div class="model-info">
          <span class="model-name">${model.name}</span>
        </div>
        <label class="toggle">
          <input type="checkbox" class="model-toggle" data-model="${model.value}" ${enabledModels[model.value] !== false ? 'checked' : ''} ${!enabledProviders[provider] ? 'disabled' : ''}>
          <span class="toggle-slider"></span>
        </label>
      `;
      modelsList.appendChild(div);
    });
  }

  // Attach event listeners
  modelsList.querySelectorAll('.model-toggle').forEach(toggle => {
    toggle.addEventListener('change', async (e) => {
      const modelValue = e.target.dataset.model;
      const result = await chrome.storage.local.get(['enabledModels']);
      const enabledModels = result.enabledModels || getDefaultEnabledModels();
      enabledModels[modelValue] = e.target.checked;
      await chrome.storage.local.set({ enabledModels });
      await loadSettings();
    });
  });
}

function loadApiKeyInputs(enabledProviders, savedValues) {
  const container = document.getElementById('apiKeyInputs');
  container.innerHTML = '';

  for (const [provider, config] of Object.entries(API_KEY_CONFIG)) {
    if (enabledProviders[provider]) {
      const input = document.createElement('input');
      input.type = config.type;
      input.id = config.id;
      input.placeholder = config.placeholder;
      input.style.marginBottom = '6px';
      input.value = savedValues[config.storageKey] || '';

      // Use both 'input' (real-time) and 'change' (on blur) events
      let debounceTimer = null;
      const handleApiKeyUpdate = async () => {
        const value = input.value.trim();
        // Save the trimmed value (empty string if only whitespace)
        await chrome.storage.local.set({ [config.storageKey]: value });

        // Track whether guest mode status changed
        const wasGuestMode = isGuestModeActive;

        // Re-check guest status immediately to update banner visibility
        await checkGuestStatus();

        // Only refresh models if guest mode status changed
        // Debounce to prevent focus loss during fast typing
        if (wasGuestMode !== isGuestModeActive) {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => loadSettings(), 300);
        }
      };

      input.addEventListener('input', handleApiKeyUpdate);
      input.addEventListener('change', handleApiKeyUpdate);

      container.appendChild(input);
    }
  }

  if (container.children.length === 0) {
    container.innerHTML = '<div style="font-size: 11px; color: #666;">No providers enabled</div>';
  }
}

function loadModes(modes, selectedMode) {
  const modeSelect = document.getElementById('modeSelect');
  modeSelect.innerHTML = '';

  modes.forEach(mode => {
    const option = document.createElement('option');
    option.value = mode.id;
    option.textContent = mode.name;
    modeSelect.appendChild(option);
  });

  // Add custom prompt option
  const customOption = document.createElement('option');
  customOption.value = 'custom';
  customOption.textContent = '✍️ Custom Prompt';
  modeSelect.appendChild(customOption);

  if (selectedMode) {
    modeSelect.value = selectedMode;
  }
}

function loadModesList(modes) {
  const modesList = document.getElementById('modesList');
  modesList.innerHTML = '';

  modes.forEach(mode => {
    const div = document.createElement('div');
    div.className = 'mode-item';
    div.innerHTML = `
            <span class="mode-name">${mode.name}</span>
            <div class="mode-actions">
                <button data-mode-id="${mode.id}" class="edit-mode-btn">Edit</button>
                ${!mode.isDefault ? `<button data-mode-id="${mode.id}" class="delete-mode-btn">🗑️</button>` : ''}
            </div>
        `;
    modesList.appendChild(div);
  });

  // Attach event listeners
  modesList.querySelectorAll('.edit-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => editMode(btn.dataset.modeId));
  });

  modesList.querySelectorAll('.delete-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteMode(btn.dataset.modeId));
  });
}

function updateProviderHint(enabledProviders) {
  const hint = document.getElementById('providerHint');
  const enabledCount = Object.values(enabledProviders).filter(v => v).length;

  if (enabledCount <= 1) {
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }
}

// --- KEY CLEANUP ---
async function checkKeyCleanup(enabledProviders, hiddenSince) {
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const keysToDelete = [];

  for (const [provider, config] of Object.entries(API_KEY_CONFIG)) {
    if (!enabledProviders[provider] && hiddenSince[provider]) {
      if (now - hiddenSince[provider] > SEVEN_DAYS) {
        keysToDelete.push(config.storageKey);
        delete hiddenSince[provider];
      }
    }
  }

  if (keysToDelete.length > 0) {
    await chrome.storage.local.remove(keysToDelete);
    await chrome.storage.local.set({ providerHiddenSince: hiddenSince });
  }
}

async function trackProviderHidden(provider, isEnabled) {
  const result = await chrome.storage.local.get(['providerHiddenSince']);
  const hiddenSince = result.providerHiddenSince || {};

  if (!isEnabled) {
    if (!hiddenSince[provider]) {
      hiddenSince[provider] = Date.now();
    }
  } else {
    delete hiddenSince[provider];
  }

  await chrome.storage.local.set({ providerHiddenSince: hiddenSince });
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  // Settings panel toggle
  document.getElementById('openSettingsBtn').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.add('open');
    document.body.classList.add('settings-open');
  });

  document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.remove('open');
    document.body.classList.remove('settings-open');
    // Reset body dimensions to default popup size
    document.body.style.width = '';
    document.body.style.height = '';
    document.body.style.minWidth = '';
    document.body.style.minHeight = '';
  });

  // Provider hint link
  document.getElementById('enableMoreProviders')?.addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.add('open');
    document.body.classList.add('settings-open');
  });

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab + 'Tab').classList.add('active');
    });
  });

  // Provider toggles
  ['Groq', 'Google', 'OpenRouter', 'Ollama'].forEach(provider => {
    const checkbox = document.getElementById('provider' + provider);
    checkbox?.addEventListener('change', async () => {
      const result = await chrome.storage.local.get(['enabledProviders']);
      const enabledProviders = result.enabledProviders || DEFAULT_PROVIDERS;
      const key = provider.toLowerCase();
      enabledProviders[key] = checkbox.checked;

      await chrome.storage.local.set({ enabledProviders });
      await trackProviderHidden(key, checkbox.checked);
      await loadSettings();
    });
  });

  // Model selection
  document.getElementById('modelSelect').addEventListener('change', async (e) => {
    const model = e.target.value;

    if (model === 'ollama:custom') {
      const name = prompt("Enter your Ollama model name:", "llama3");
      if (name && /^[a-zA-Z0-9\-_:.]+$/.test(name)) {
        await chrome.storage.local.set({ selectedModel: 'ollama:' + name });
      } else {
        // User cancelled or invalid input - refresh to show actual saved model
        await loadSettings();
        return;
      }
    } else if (model === 'openrouter:custom') {
      const slug = prompt("Enter OpenRouter model slug (e.g., openai/gpt-4):", "openai/gpt-4");
      // Validate slug format: provider/model-name with optional :variant suffix
      // Examples: openai/gpt-4, deepseek/deepseek-r1-0528:free, meta-llama/llama-4
      // More restrictive: only allows alphanumeric, hyphen, underscore for provider
      // Model name allows dots for versions (e.g., gpt-4.0)
      if (slug && /^[a-zA-Z][a-zA-Z0-9_-]*\/[a-zA-Z][a-zA-Z0-9._-]*(:[a-zA-Z0-9_-]+)?$/.test(slug)) {
        await chrome.storage.local.set({ selectedModel: 'openrouter:' + slug });
      } else if (slug) {
        alert('Invalid model slug format. Use format: provider/model-name (e.g., openai/gpt-4, deepseek/deepseek-r1:free)');
        // Refresh to show actual saved model
        await loadSettings();
        return;
      } else {
        // User cancelled - refresh to show actual saved model
        await loadSettings();
        return;
      }
    } else {
      await chrome.storage.local.set({ selectedModel: model });
    }
  });

  // Mode selection
  document.getElementById('modeSelect').addEventListener('change', async (e) => {
    const mode = e.target.value;
    await chrome.storage.local.set({ selectedMode: mode });

    const customPromptContainer = document.getElementById('customPromptContainer');
    if (mode === 'custom') {
      customPromptContainer.classList.remove('hidden');
    } else {
      customPromptContainer.classList.add('hidden');
    }
  });

  // Custom prompt
  document.getElementById('customPromptText')?.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ customPrompt: e.target.value });
  });

  // Mode editor
  document.getElementById('addModeBtn').addEventListener('click', () => {
    editingModeId = null;
    document.getElementById('modeNameInput').value = '';
    document.getElementById('modePromptInput').value = '';
    updateCharCounters(); // Reset counters
    document.getElementById('modeEditor').classList.add('active');
  });

  // Character counter updates
  document.getElementById('modeNameInput').addEventListener('input', updateCharCounters);
  document.getElementById('modePromptInput').addEventListener('input', updateCharCounters);

  document.getElementById('cancelModeBtn').addEventListener('click', () => {
    document.getElementById('modeEditor').classList.remove('active');
    editingModeId = null;
  });

  document.getElementById('saveModeBtn').addEventListener('click', saveMode);

  // Snip button
  document.getElementById('snipBtn').addEventListener('click', startSnip);

  // PDF settings link
  document.getElementById('openExtSettings')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  });

  // Reset All Keys
  document.getElementById('resetAllKeys')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (confirm('⚠️ Are you sure you want to reset all API keys? This will clear all stored keys (Groq, Google, OpenRouter, and Ollama host).')) {
      await chrome.storage.local.remove(['groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);
      alert('✅ All API keys have been cleared.');
      await loadSettings(); // Reload to clear the input fields
    }
  });

  // Keyboard shortcuts link
  document.getElementById('openShortcutsLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // Contact links
  document.getElementById('instagramLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://www.instagram.com/saura_v_chourasia/' });
  });

  document.getElementById('linkedinLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://www.linkedin.com/in/saurav-chourasia/' });
  });

  document.getElementById('discordLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://discord.gg/bppspgkd' });
  });

  document.getElementById('githubLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://github.com/Saura-4' });
  });

  // Groq API keys links (Providers tab and General tab)
  document.getElementById('groqKeysLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://console.groq.com/keys' });
  });
  document.getElementById('groqKeysLinkGeneral')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://console.groq.com/keys' });
  });

  // Keyboard shortcuts link (General tab - different element from Providers tab)
  document.getElementById('openShortcutsLinkGeneral')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // Setup Guide link
  document.getElementById('open-welcome')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('src/setupguide/setupguide.html') });
  });

  // Provider dashboard links
  document.querySelectorAll('.provider-dashboard-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = e.target.dataset.url || e.target.parentElement.dataset.url;
      if (url) {
        chrome.tabs.create({ url });
      }
    });
  });

  // Max compare windows setting
  const maxCompareSelect = document.getElementById('maxCompareWindows');
  if (maxCompareSelect) {
    chrome.storage.local.get(['maxCompareWindows'], (res) => {
      if (res.maxCompareWindows) maxCompareSelect.value = res.maxCompareWindows;
    });
    maxCompareSelect.addEventListener('change', () => {
      chrome.storage.local.set({ maxCompareWindows: parseInt(maxCompareSelect.value) });
    });
  }

  // Hide context menu toggle
  const hideContextMenuToggle = document.getElementById('hideContextMenu');
  if (hideContextMenuToggle) {
    hideContextMenuToggle.addEventListener('change', async () => {
      const hide = hideContextMenuToggle.checked;
      await chrome.storage.local.set({ hideContextMenu: hide });
      // Notify background to update context menu
      chrome.runtime.sendMessage({ action: 'UPDATE_CONTEXT_MENU', hide });
    });
  }

  // Guest mode key links
  document.getElementById('getOwnKeyLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://console.groq.com/keys' });
  });
  document.getElementById('getDemoKeyLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://console.groq.com/keys' });
  });
}

// --- MODE MANAGEMENT ---
async function editMode(modeId) {
  const result = await chrome.storage.local.get(['customModes']);
  const modes = result.customModes || DEFAULT_MODES;
  const mode = modes.find(m => m.id === modeId);

  if (mode) {
    editingModeId = modeId;
    document.getElementById('modeNameInput').value = mode.name;
    document.getElementById('modePromptInput').value = mode.prompt;
    updateCharCounters(); // Update counters for existing values
    document.getElementById('modeEditor').classList.add('active');
  }
}

// Character counter helper
function updateCharCounters() {
  const nameInput = document.getElementById('modeNameInput');
  const promptInput = document.getElementById('modePromptInput');
  const nameCounter = document.getElementById('nameCounter');
  const promptCounter = document.getElementById('promptCounter');

  if (nameInput && nameCounter) {
    const len = nameInput.value.length;
    const max = 50;
    nameCounter.textContent = `${len}/${max}`;
    nameCounter.className = 'char-counter' + (len >= max ? ' limit' : len > max * 0.8 ? ' warning' : '');
  }

  if (promptInput && promptCounter) {
    const len = promptInput.value.length;
    const max = 2000;
    promptCounter.textContent = `${len}/${max}`;
    promptCounter.className = 'char-counter' + (len >= max ? ' limit' : len > max * 0.8 ? ' warning' : '');
  }
}

async function saveMode() {
  const name = document.getElementById('modeNameInput').value.trim();
  const prompt = document.getElementById('modePromptInput').value.trim();

  // Validation
  if (!name || !prompt) {
    alert('Please fill in both name and prompt');
    return;
  }

  if (name.length > 50) {
    alert('Mode name must be 50 characters or less');
    return;
  }

  if (prompt.length > 2000) {
    alert('Prompt must be 2000 characters or less');
    return;
  }

  const result = await chrome.storage.local.get(['customModes']);
  let modes = result.customModes || DEFAULT_MODES;

  if (editingModeId) {
    modes = modes.map(m => m.id === editingModeId ? { ...m, name, prompt } : m);
  } else {
    const id = 'custom_' + Date.now();
    modes.push({ id, name, prompt, isDefault: false });
  }

  await chrome.storage.local.set({ customModes: modes });
  document.getElementById('modeEditor').classList.remove('active');
  editingModeId = null;
  await loadSettings();
}

async function deleteMode(modeId) {
  if (!confirm('Delete this mode?')) return;

  const result = await chrome.storage.local.get(['customModes']);
  let modes = result.customModes || DEFAULT_MODES;
  modes = modes.filter(m => m.id !== modeId);

  await chrome.storage.local.set({ customModes: modes });
  await loadSettings();
}

// --- SNIP FUNCTIONALITY ---
async function startSnip() {
  const result = await chrome.storage.local.get(['enabledProviders', 'selectedModel', 'groqKey', 'geminiKey', 'openrouterKey', 'ollamaHost']);
  let model = result.selectedModel || 'meta-llama/llama-4-scout-17b-16e-instruct';

  // Handle custom model selection - prompt user for model name
  if (model === 'ollama:custom') {
    const name = prompt("Enter your Ollama model name:", "llama3");
    if (name && /^[a-zA-Z0-9\-_:.]+$/.test(name)) {
      model = 'ollama:' + name;
      await chrome.storage.local.set({ selectedModel: model });
    } else {
      // User cancelled or invalid input
      return;
    }
  } else if (model === 'openrouter:custom') {
    const slug = prompt("Enter OpenRouter model slug (e.g., openai/gpt-4):", "openai/gpt-4");
    if (slug && /^[a-zA-Z][a-zA-Z0-9_-]*\/[a-zA-Z][a-zA-Z0-9._-]*(:[a-zA-Z0-9_-]+)?$/.test(slug)) {
      model = 'openrouter:' + slug;
      await chrome.storage.local.set({ selectedModel: model });
    } else if (slug) {
      alert('Invalid model slug format. Use format: provider/model-name (e.g., openai/gpt-4)');
      return;
    } else {
      // User cancelled
      return;
    }
  }

  // In guest mode, skip API key validation (background.js handles it)
  // Server-side rate limiting is the real gate - cannot be bypassed via devtools
  if (isGuestModeActive) {
    // Just proceed - if limit is exceeded, server will return 429 error
  } else {
    // Validate API key based on model
    if (model.startsWith('ollama')) {
      if (!result.ollamaHost) {
        alert('Please set Ollama URL in API Keys');
        return;
      }
    } else if (model.includes('gemini') || model.includes('gemma')) {
      if (!result.geminiKey) {
        alert('Please set Google API Key');
        return;
      }
    } else if (model.startsWith('openrouter')) {
      if (!result.openrouterKey) {
        alert('Please set OpenRouter API Key');
        return;
      }
    } else {
      if (!result.groqKey) {
        alert('Please set Groq API Key');
        return;
      }
    }
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) return;

  try {
    await chrome.tabs.sendMessage(tabs[0].id, { action: "START_SNIP" });
    window.close();
  } catch (err) {
    alert("⚠️ Could not start snip. Please refresh the page!");
  }
}

// --- DYNAMIC PANEL RESIZE ---
function setupDynamicResize() {
  const textarea = document.getElementById('modePromptInput');
  const settingsPanel = document.getElementById('settingsPanel');

  if (!textarea || !settingsPanel) return;

  // Use ResizeObserver to watch textarea size changes
  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      // Calculate new panel size based on content
      const panelContent = settingsPanel.scrollHeight;
      const panelWidth = settingsPanel.scrollWidth;

      // Enforce minimum dimensions
      const newHeight = Math.max(MIN_PANEL_HEIGHT, panelContent + 40);
      const newWidth = Math.max(MIN_PANEL_WIDTH, panelWidth);

      // Apply new dimensions
      settingsPanel.style.height = newHeight + 'px';
      settingsPanel.style.width = newWidth + 'px';

      // Also update body dimensions when settings panel is open
      if (document.body.classList.contains('settings-open')) {
        document.body.style.height = newHeight + 'px';
        document.body.style.width = newWidth + 'px';
      }
    }
  });

  resizeObserver.observe(textarea);

  // Also handle input changes that might affect textarea height
  textarea.addEventListener('input', () => {
    // Auto-grow textarea based on content
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(100, textarea.scrollHeight) + 'px';
  });
}