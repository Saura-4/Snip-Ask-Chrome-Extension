// popup.js - Custom Modes & Provider Selection

// --- IMPORTS ---
import {
  ALL_MODELS,
  PROVIDER_LABELS,
  DEFAULT_PROVIDERS,
  getDefaultEnabledModels,
  GUEST_MODE_PROVIDERS,
  checkGuestModeStatus,
  getCustomSavedModels,
  saveCustomModel,
  removeCustomModel,
  toggleCustomModel,
  getMergedModelsWithCustom
} from '../background/models/models-config.js';
import { CONTENT_SCRIPT_FILES, isRestrictedPage } from '../background/core/content-script-files.js';
import { getMissingConfigMessage } from './modules/model-validation.js';
import {
  getProvidersToShow,
  populateModelSelect,
  populateModelsList,
  promptForCustomModel
} from './modules/popup-models.js';
import {
  populateModeSelect,
  populateModesList,
  validateModeInput
} from './modules/popup-modes.js';
import { showToast, confirmDialog } from './modules/popup-dialogs.js';

// --- DEFAULT DATA ---
const DEFAULT_MODES = [
  { id: 'default', name: 'Default', prompt: "You are a helpful assistant. Analyze the user's input and provide a clear, well-structured response. Use Markdown formatting when helpful. Be accurate, balanced in detail, and adapt your tone to the question.", isDefault: true },
  { id: 'short', name: 'Short Answer', prompt: "You are a concise answer engine. 1. Analyze the user's input. 2. If it is a multiple-choice question, Output in this format: 'Answer: <option>. <explanation>'. 3. For follow-up chat or non-questions, reply naturally but concisely.", isDefault: true },
  { id: 'detailed', name: 'Detailed', prompt: "You are an expert tutor. Analyze the input. Provide a detailed, step-by-step answer. Use Markdown.", isDefault: true },
  { id: 'code', name: 'Code Debug', prompt: "You are a code debugger. Correct the code and explain the fix. Output a single fenced code block first.", isDefault: true }
];

const API_KEY_CONFIG = {
  groq: { id: 'apiKey', placeholder: 'Groq Key (gsk_...)', type: 'password', storageKey: 'groqKey' },
  google: { id: 'geminiKey', placeholder: 'Gemini Key (AIza...)', type: 'password', storageKey: 'geminiKey' },
  openai: { id: 'openaiKey', placeholder: 'OpenAI Key (sk-...)', type: 'password', storageKey: 'openaiKey' },
  openrouter: { id: 'openrouterKey', placeholder: 'OpenRouter Key (sk-or-...)', type: 'password', storageKey: 'openrouterKey' },
  ollama: { id: 'ollamaHost', placeholder: 'Ollama URL (http://localhost:11434)', type: 'text', storageKey: 'ollamaHost' }
};
const DEFAULT_MODEL = 'groq:auto';
const DEFAULT_MODE = 'default';

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
    // Use shared guest mode service for consistent behavior
    const guestStatus = await checkGuestModeStatus();

    // Update state
    isGuestModeActive = guestStatus.isGuestMode;

    // Update banner immediately
    updateGuestBanner(guestStatus);

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
  const result = await chrome.storage.local.get([
    'customModes',
    'enabledProviders',
    'enabledModels',
    'selectedModel',
    'selectedMode'
  ]);

  if (!result.customModes) {
    await chrome.storage.local.set({ customModes: DEFAULT_MODES });
  } else {
    let modes = result.customModes;
    let changed = false;

    // Inject missing default modes
    for (const defMode of DEFAULT_MODES) {
      if (!modes.some(m => m.id === defMode.id)) {
        modes = [defMode, ...modes];
        changed = true;
      }
    }

    // Sync names and prompts for built-in default modes
    modes = modes.map(m => {
      const defMatch = DEFAULT_MODES.find(d => d.id === m.id && m.isDefault);
      if (defMatch && (m.name !== defMatch.name || m.prompt !== defMatch.prompt)) {
        changed = true;
        return { ...m, name: defMatch.name, prompt: defMatch.prompt };
      }
      return m;
    });

    if (changed) {
      await chrome.storage.local.set({ customModes: modes });
    }
  }

  if (!result.enabledProviders) {
    await chrome.storage.local.set({ enabledProviders: DEFAULT_PROVIDERS });
  }

  if (!result.enabledModels) {
    await chrome.storage.local.set({ enabledModels: getDefaultEnabledModels() });
  }

  if (!result.selectedModel) {
    await chrome.storage.local.set({ selectedModel: DEFAULT_MODEL });
  }

  if (!result.selectedMode) {
    await chrome.storage.local.set({ selectedMode: DEFAULT_MODE });
  }
}

// --- LOAD SETTINGS ---
async function loadSettings() {
  const result = await chrome.storage.local.get([
    'customModes', 'enabledProviders', 'enabledModels', 'selectedModel', 'selectedMode',
    'groqKey', 'geminiKey', 'openaiKey', 'openrouterKey', 'ollamaHost', 'customPrompt',
    'providerHiddenSince', 'hideContextMenu', 'hiddenModels'
  ]);

  // Check and cleanup old keys
  await checkKeyCleanup(result.enabledProviders || DEFAULT_PROVIDERS, result.providerHiddenSince || {});
  await checkGuestStatus();

  // Load providers into settings panel
  loadProviderToggles(result.enabledProviders || DEFAULT_PROVIDERS);

  // Load models list in settings
  loadModelsList(
    result.enabledProviders || DEFAULT_PROVIDERS,
    result.enabledModels || getDefaultEnabledModels()
  );

  // Load models based on enabled providers and enabled models
  await loadModels(
    result.enabledProviders || DEFAULT_PROVIDERS,
    result.enabledModels || getDefaultEnabledModels(),
    result.hiddenModels || {},
    result.selectedModel
  );

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
  document.getElementById('providerOpenAI').checked = enabledProviders.openai === true;
  document.getElementById('providerOpenRouter').checked = enabledProviders.openrouter === true;
  document.getElementById('providerOllama').checked = enabledProviders.ollama === true;
}

// Lightweight refresh that only updates models dropdown without recreating inputs
// Used when guest mode status changes during typing to avoid losing input focus
async function refreshModelsOnly() {
  const result = await chrome.storage.local.get(['enabledProviders', 'enabledModels', 'hiddenModels', 'selectedModel']);
  await loadModels(
    result.enabledProviders || DEFAULT_PROVIDERS,
    result.enabledModels || getDefaultEnabledModels(),
    result.hiddenModels || {},
    result.selectedModel
  );
}

async function loadModels(enabledProviders, enabledModels, hiddenModels, selectedModel) {
  const modelSelect = document.getElementById('modelSelect');
  const providersToShow = getProvidersToShow(enabledProviders, isGuestModeActive, GUEST_MODE_PROVIDERS);
  const customSavedModels = await getCustomSavedModels();
  const mergedModels = getMergedModelsWithCustom(ALL_MODELS, customSavedModels);

  // Edge case: if leaving guest mode with Auto selected, fallback to Qwen 3.6 Vision
  if (!isGuestModeActive && selectedModel === 'groq:auto') {
    selectedModel = 'qwen/qwen3.6-27b';
    await chrome.storage.local.set({ selectedModel });
  }

  const selection = populateModelSelect({
    modelSelect,
    mergedModels,
    providersToShow,
    enabledModels,
    hiddenModels,
    selectedModel,
    isGuestModeActive,
    providerLabels: PROVIDER_LABELS
  });

  if (selection.didAutoSelect && selection.selectedModel) {
    await chrome.storage.local.set({ selectedModel: selection.selectedModel });
  }
}

async function loadModelsList(enabledProviders, enabledModels) {
  const modelsList = document.getElementById('modelsList');
  if (!modelsList) return;

  const openProviders = Array.from(modelsList.querySelectorAll('.model-provider-group[open]'))
    .map((group) => group.dataset.provider);
  const hiddenStorage = await chrome.storage.local.get(['hiddenModels']);
  const hiddenModels = hiddenStorage.hiddenModels || {};
  const customSavedModels = await getCustomSavedModels();
  populateModelsList({
    modelsList,
    allModels: ALL_MODELS,
    customSavedModels,
    enabledProviders,
    enabledModels,
    hiddenModels,
    providerLabels: PROVIDER_LABELS,
    openProviders
  });

  modelsList.querySelectorAll('.model-toggle').forEach(toggle => {
    toggle.addEventListener('change', async (e) => {
      const modelValue = e.target.dataset.model;
      const result = await chrome.storage.local.get(['enabledModels']);
      const nextEnabledModels = result.enabledModels || getDefaultEnabledModels();
      const modelProvider = Object.entries(ALL_MODELS).find(([, models]) =>
        models.some((model) => model.value === modelValue)
      )?.[0];

      if (!e.target.checked && modelProvider) {
        const customSavedModels = await getCustomSavedModels();
        const hiddenStorage = await chrome.storage.local.get(['hiddenModels']);
        const hiddenModels = hiddenStorage.hiddenModels || {};
        const remainingRegularModels = (ALL_MODELS[modelProvider] || [])
          .filter((model) => !model.value.endsWith(':custom') && model.value !== modelValue && hiddenModels[model.value] !== true)
          .filter((model) => nextEnabledModels[model.value] !== false)
          .length;
        const remainingCustomModels = (customSavedModels[modelProvider] || [])
          .filter((model) => model.enabled !== false)
          .length;

        if (remainingRegularModels + remainingCustomModels <= 0) {
          e.target.checked = true;
          showToast('Keep at least one model enabled for each provider.', 'error');
          return;
        }
      }

      nextEnabledModels[modelValue] = e.target.checked;
      await chrome.storage.local.set({ enabledModels: nextEnabledModels });
      await loadSettings();
    });
  });

  modelsList.querySelectorAll('.custom-model-toggle').forEach(toggle => {
    toggle.addEventListener('change', async (e) => {
      const modelValue = e.target.dataset.model;
      const provider = e.target.dataset.provider;
      await toggleCustomModel(provider, modelValue, e.target.checked);
      await loadSettings();
    });
  });

  modelsList.querySelectorAll('.delete-custom-model-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const button = e.currentTarget;
      if (button.disabled) {
        return;
      }
      const modelValue = button.dataset.model;
      const provider = button.dataset.provider;
      await removeCustomModel(provider, modelValue);
      await loadSettings();
    });
  });

  modelsList.querySelectorAll('.remove-model-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const button = e.currentTarget;
      if (button.disabled || button.classList.contains('delete-custom-model-btn')) {
        return;
      }

      const modelValue = button.dataset.model;
      const result = await chrome.storage.local.get(['enabledModels', 'hiddenModels']);
      const nextEnabledModels = result.enabledModels || getDefaultEnabledModels();
      const nextHiddenModels = result.hiddenModels || {};
      nextEnabledModels[modelValue] = false;
      nextHiddenModels[modelValue] = true;
      await chrome.storage.local.set({ enabledModels: nextEnabledModels, hiddenModels: nextHiddenModels });
      await loadSettings();
    });
  });

  modelsList.querySelectorAll('.restore-provider-models-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const button = e.currentTarget;
      const provider = button.dataset.provider;
      const result = await chrome.storage.local.get(['enabledModels', 'hiddenModels']);
      const nextEnabledModels = result.enabledModels || getDefaultEnabledModels();
      const nextHiddenModels = { ...(result.hiddenModels || {}) };
      (ALL_MODELS[provider] || []).forEach((model) => {
        if (!model.value.endsWith(':custom') && nextHiddenModels[model.value] === true) {
          delete nextHiddenModels[model.value];
          nextEnabledModels[model.value] = true;
        }
      });
      await chrome.storage.local.set({ enabledModels: nextEnabledModels, hiddenModels: nextHiddenModels });
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

      let debounceTimer = null;
      let lastSavedValue = input.value.trim();
      const saveApiKeyUpdate = async () => {
        const value = input.value.trim();
        if (value === lastSavedValue) {
          return;
        }

        if (provider === 'ollama' && value) {
          let originPattern;
          try {
            const host = new URL(value);
            if (!['http:', 'https:'].includes(host.protocol)) throw new Error('Unsupported protocol');
            originPattern = `${host.protocol}//${host.hostname}/*`;
          } catch {
            showToast('Enter a valid HTTP or HTTPS Ollama URL.', 'error');
            return;
          }

          const granted = await chrome.permissions.request({ origins: [originPattern] });
          if (!granted) {
            showToast('Snip & Ask needs access to that Ollama host before it can connect.', 'error');
            return;
          }
        }

        const wasGuestMode = isGuestModeActive;
        await chrome.storage.local.set({ [config.storageKey]: value });
        lastSavedValue = value;

        await checkGuestStatus();

        if (wasGuestMode !== isGuestModeActive) {
          await refreshModelsOnly();
        }
      };

      input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          void saveApiKeyUpdate();
        }, 500);
      });
      input.addEventListener('change', () => {
        clearTimeout(debounceTimer);
        void saveApiKeyUpdate();
      });
      input.addEventListener('blur', () => {
        clearTimeout(debounceTimer);
        void saveApiKeyUpdate();
      });

      container.appendChild(input);
    }
  }

  if (container.children.length === 0) {
    container.innerHTML = '<div style="font-size: 11px; color: #666;">No providers enabled</div>';
  }
}

async function validateCustomModelBeforeSave(customModel) {
  if (customModel.provider === 'openrouter') {
    return { success: true, model: customModel.modelValue };
  }

  const response = await chrome.runtime.sendMessage({
    action: 'VALIDATE_CUSTOM_MODEL',
    model: customModel.modelValue
  });

  if (!response?.success) {
    throw new Error(response?.error || 'Model validation failed.');
  }

  return response;
}

function loadModes(modes, selectedMode) {
  const modeSelect = document.getElementById('modeSelect');
  populateModeSelect(modeSelect, modes, selectedMode);
}

function loadModesList(modes) {
  const modesList = document.getElementById('modesList');
  populateModesList(modesList, modes);

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
    // Clear forced inline dimensions from previous close so panel can expand
    document.documentElement.style.width = '';
    document.documentElement.style.height = '';
    document.body.style.width = '';
    document.body.style.height = '';
    document.body.style.minWidth = '';
    document.body.style.minHeight = '';

    document.getElementById('settingsPanel').classList.add('open');
    document.body.classList.add('settings-open');
  });

  document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.remove('open');
    document.body.classList.remove('settings-open');
    
    // Explicitly force html and body to shrink, as Chrome popups 
    // often ignore CSS-based shrinking (e.g. when setting style.width = '')
    document.documentElement.style.width = '340px';
    document.body.style.width = '340px';
    document.body.style.minWidth = '340px';
    
    document.documentElement.style.height = 'auto';
    document.body.style.height = 'auto';
    document.body.style.minHeight = '400px';
  });

  // Provider hint link
  document.getElementById('enableMoreProviders')?.addEventListener('click', () => {
    document.documentElement.style.width = '';
    document.documentElement.style.height = '';
    document.body.style.width = '';
    document.body.style.height = '';
    document.body.style.minWidth = '';
    document.body.style.minHeight = '';

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
  ['Groq', 'Google', 'OpenAI', 'OpenRouter', 'Ollama'].forEach(provider => {
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
    const customModel = await promptForCustomModel(model);

    if (customModel.cancelled) {
      await loadSettings();
      return;
    }

    if (customModel.error) {
      showToast(customModel.error, 'error');
      await loadSettings();
      return;
    }

    if (customModel.provider) {
      try {
        await validateCustomModelBeforeSave(customModel);
      } catch (error) {
        showToast(`Unable to validate this model before saving. ${error.message}`, 'error');
        await loadSettings();
        return;
      }
      await saveCustomModel(customModel.provider, customModel.modelValue, customModel.displayName);
      await chrome.storage.local.set({ selectedModel: customModel.modelValue });
      await loadSettings();
      return;
    }

    await chrome.storage.local.set({ selectedModel: model });
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
    const confirmed = await confirmDialog({
      title: 'Reset all API keys',
      message: 'This will clear all stored keys (Groq, Gemini, OpenAI, OpenRouter, and Ollama host).',
      confirmText: 'Reset keys',
      danger: true
    });
    if (confirmed) {
      await chrome.storage.local.remove(['groqKey', 'geminiKey', 'openaiKey', 'openrouterKey', 'ollamaHost']);
      showToast('All API keys have been cleared.');
      await loadSettings(); // Reload to clear the input fields
    }
  });

  // Keyboard shortcuts link
  document.getElementById('openShortcutsLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // Contact links
  document.getElementById('linkedinLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://www.linkedin.com/in/saurav-chourasia/' });
  });

  document.getElementById('discordLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://discord.gg/hUdshmSxET' });
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

  // Support Button (Footer)
  document.getElementById('supportBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('settingsPanel').classList.add('open');
    document.body.classList.add('settings-open');
    // Switch to General tab
    document.querySelector('.tab-btn[data-tab="general"]').click();
    // Scroll to support section
    setTimeout(() => {
      const supportSection = document.querySelector('.settings-section:last-child');
      if (supportSection) supportSection.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  });

  // Copy UPI ID functionality
  const copyUpiBtn = document.getElementById('copyUpiBtn');
  const upiIdDisplay = document.getElementById('upiIdDisplay');

  if (copyUpiBtn && upiIdDisplay) {
    copyUpiBtn.addEventListener('click', () => {
      const upiId = upiIdDisplay.textContent;
      // Don't copy placeholder if user hasn't set it (though buttons are generic now)
      if (upiId.includes('INSERT')) {
        showToast('Please configure your UPI ID first.', 'error');
        return;
      }

      navigator.clipboard.writeText(upiId).then(() => {
        const originalIcon = copyUpiBtn.innerHTML;
        copyUpiBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        copyUpiBtn.style.color = '#4caf50';
        setTimeout(() => {
          copyUpiBtn.innerHTML = originalIcon;
          copyUpiBtn.style.color = '';
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy text: ', err);
      });
    });
  }

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
  const validationError = validateModeInput(name, prompt);

  if (validationError) {
    showToast(validationError, 'error');
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
  const confirmed = await confirmDialog({
    title: 'Delete mode',
    message: 'Delete this mode? This cannot be undone.',
    confirmText: 'Delete',
    danger: true
  });
  if (!confirmed) return;

  const result = await chrome.storage.local.get(['customModes']);
  let modes = result.customModes || DEFAULT_MODES;
  modes = modes.filter(m => m.id !== modeId);

  await chrome.storage.local.set({ customModes: modes });
  await loadSettings();
}

// --- SNIP FUNCTIONALITY ---
async function startSnip() {
  const result = await chrome.storage.local.get(['enabledProviders', 'selectedModel', 'selectedMode', 'groqKey', 'geminiKey', 'openaiKey', 'openrouterKey', 'ollamaHost']);
  const modelSelect = document.getElementById('modelSelect');
  const modeSelect = document.getElementById('modeSelect');
  let model = modelSelect?.value || result.selectedModel || DEFAULT_MODEL;
  const mode = modeSelect?.value || result.selectedMode || DEFAULT_MODE;

  const customModel = await promptForCustomModel(model);
  if (customModel.cancelled) {
    return;
  }
  if (customModel.error) {
    showToast(customModel.error, 'error');
    return;
  }
  if (customModel.provider) {
    try {
      await validateCustomModelBeforeSave(customModel);
    } catch (error) {
      showToast(`Unable to validate this model before saving. ${error.message}`, 'error');
      return;
    }
    model = customModel.modelValue;
    await saveCustomModel(customModel.provider, customModel.modelValue, customModel.displayName);
  }

  if (model && model !== result.selectedModel) {
    await chrome.storage.local.set({ selectedModel: model });
  }

  if (!isGuestModeActive) {
    const missingConfigMessage = getMissingConfigMessage(model, result);
    if (missingConfigMessage) {
      showToast(missingConfigMessage, 'error');
      return;
    }
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) return;

  const tab = tabs[0];
  if (isRestrictedPage(tab.url)) {
    showToast('Cannot run on this restricted page.', 'error');
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "START_SNIP", model, mode });
    window.close();
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: CONTENT_SCRIPT_FILES
      });
      await chrome.tabs.sendMessage(tab.id, { action: "START_SNIP", model, mode });
      window.close();
    } catch (injectErr) {
      showToast('Could not start snip. Please refresh the page!', 'error');
    }
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
