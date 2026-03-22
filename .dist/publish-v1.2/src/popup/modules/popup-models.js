export function getProvidersToShow(enabledProviders, isGuestModeActive, guestModeProviders) {
  return isGuestModeActive === true ? guestModeProviders : enabledProviders;
}

export function populateModelSelect({
  modelSelect,
  mergedModels,
  providersToShow,
  enabledModels,
  hiddenModels,
  selectedModel,
  isGuestModeActive,
  providerLabels
}) {
  modelSelect.innerHTML = '';

  for (const [provider, models] of Object.entries(mergedModels)) {
    if (!providersToShow[provider]) {
      continue;
    }

    const visibleModels = isGuestModeActive
      ? models.filter((model) => !model.value.endsWith(':custom') && !model.isCustom)
      : models.filter((model) => hiddenModels?.[model.value] !== true);

    const enabledModelsInProvider = isGuestModeActive && provider === 'groq'
      ? visibleModels
      : visibleModels.filter((model) => enabledModels[model.value] !== false);

    if (enabledModelsInProvider.length === 0) {
      continue;
    }

    const optgroup = document.createElement('optgroup');
    optgroup.label = isGuestModeActive && provider === 'groq'
      ? `${providerLabels[provider]} (Guest Mode)`
      : providerLabels[provider];

    enabledModelsInProvider.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.value;
      option.textContent = model.name;
      optgroup.appendChild(option);
    });

    modelSelect.appendChild(optgroup);
  }

  if (selectedModel && [...modelSelect.options].some((option) => option.value === selectedModel)) {
    modelSelect.value = selectedModel;
    return { selectedModel, didAutoSelect: false };
  }

  if (modelSelect.options.length > 0) {
    modelSelect.selectedIndex = 0;
    return { selectedModel: modelSelect.value, didAutoSelect: true };
  }

  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = 'Enable a provider in Settings';
  emptyOption.disabled = true;
  modelSelect.appendChild(emptyOption);
  modelSelect.selectedIndex = 0;
  return { selectedModel: '', didAutoSelect: false };
}

export function populateModelsList({
  modelsList,
  allModels,
  customSavedModels,
  enabledProviders,
  enabledModels,
  hiddenModels,
  providerLabels,
  openProviders = []
}) {
  modelsList.innerHTML = '';

  const getActiveModelCount = (provider) => {
    const regularEnabledCount = (allModels[provider] || [])
      .filter((model) => !model.value.endsWith(':custom') && hiddenModels?.[model.value] !== true)
      .filter((model) => enabledModels[model.value] !== false)
      .length;
    const customEnabledCount = (customSavedModels[provider] || [])
      .filter((model) => model.enabled !== false)
      .length;
    return regularEnabledCount + customEnabledCount;
  };

  const createRemoveButton = ({ modelValue, provider, disabled, title }) => {
    const deleteButton = document.createElement('button');
    deleteButton.className = 'remove-model-btn';
    deleteButton.dataset.model = modelValue;
    deleteButton.dataset.provider = provider;
    deleteButton.title = title;
    deleteButton.disabled = disabled;
    deleteButton.style.cssText = `background: none; border: none; color: ${disabled ? '#555' : '#888'}; cursor: ${disabled ? 'not-allowed' : 'pointer'}; padding: 4px 8px; transition: color 0.2s;`;
    deleteButton.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;
    return deleteButton;
  };

  for (const [provider, models] of Object.entries(allModels)) {
    const providerGroup = document.createElement('details');
    providerGroup.className = 'model-provider-group';
    providerGroup.dataset.provider = provider;
    providerGroup.open = openProviders.includes(provider);

    const providerHeader = document.createElement('summary');
    providerHeader.className = 'model-provider-header';
    const providerHeaderLeft = document.createElement('div');
    providerHeaderLeft.className = 'model-provider-header-left';

    const providerLabel = document.createElement('span');
    providerLabel.className = 'model-provider-title';
    providerLabel.textContent = providerLabels[provider];

    const visibleBuiltInModels = models.filter((model) =>
      !model.value.endsWith(':custom') && hiddenModels?.[model.value] !== true
    ).length;
    const visibleCustomModels = (customSavedModels[provider] || []).length;

    const providerCount = document.createElement('span');
    providerCount.className = 'model-provider-count';
    providerCount.textContent = `${visibleBuiltInModels + visibleCustomModels} models`;

    providerHeaderLeft.appendChild(providerLabel);
    providerHeaderLeft.appendChild(providerCount);
    providerHeader.appendChild(providerHeaderLeft);

    if (!enabledProviders[provider]) {
      const badge = document.createElement('span');
      badge.className = 'provider-disabled-badge';
      badge.textContent = '(Provider disabled)';
      providerHeader.appendChild(badge);
    }

    const chevron = document.createElement('span');
    chevron.className = 'model-provider-chevron';
    chevron.textContent = '▾';
    providerHeader.appendChild(chevron);
    providerGroup.appendChild(providerHeader);

    const providerContent = document.createElement('div');
    providerContent.className = 'model-provider-content';

    const removedModels = models.filter((model) =>
      !model.value.endsWith(':custom') && hiddenModels?.[model.value] === true
    );

    models.forEach((model) => {
      if (model.value.endsWith(':custom')) {
        return;
      }
      if (hiddenModels?.[model.value] === true) {
        return;
      }

      const activeModelCount = getActiveModelCount(provider);
      const div = document.createElement('div');
      div.className = 'model-item';
      if (!enabledProviders[provider]) {
        div.classList.add('model-item-disabled');
      }
      const info = document.createElement('div');
      info.className = 'model-info';
      const name = document.createElement('span');
      name.className = 'model-name';
      name.textContent = model.name;
      info.appendChild(name);

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'model-toggle';
      input.dataset.model = model.value;
      input.checked = enabledModels[model.value] !== false;
      input.disabled = !enabledProviders[provider];
      const slider = document.createElement('span');
      slider.className = 'toggle-slider';
      toggleLabel.appendChild(input);
      toggleLabel.appendChild(slider);

      const removeButton = createRemoveButton({
        modelValue: model.value,
        provider,
        disabled: activeModelCount <= 1 || !enabledProviders[provider],
        title: activeModelCount <= 1 ? 'Keep at least one model in this provider' : 'Hide model from selector'
      });

      const actions = document.createElement('div');
      actions.className = 'model-actions';
      actions.appendChild(removeButton);
      actions.appendChild(toggleLabel);

      div.appendChild(info);
      div.appendChild(actions);
      providerContent.appendChild(div);
    });

    if (customSavedModels[provider] && customSavedModels[provider].length > 0) {
      customSavedModels[provider].forEach((model) => {
        const activeModelCount = getActiveModelCount(provider);
        const div = document.createElement('div');
        div.className = 'model-item';
        if (!enabledProviders[provider]) {
          div.classList.add('model-item-disabled');
        }
        const info = document.createElement('div');
        info.className = 'model-info';
        info.style.flex = '1';
        const name = document.createElement('span');
        name.className = 'model-name';
        name.textContent = model.name;
        const badge = document.createElement('span');
        badge.className = 'custom-model-badge';
        badge.style.cssText = 'font-size: 9px; background: rgba(255,107,74,0.15); color: #ff6b4a; padding: 2px 6px; border-radius: 4px; margin-left: 6px;';
        badge.textContent = 'Custom';
        info.appendChild(name);
        info.appendChild(badge);

        const deleteButton = createRemoveButton({
          modelValue: model.value,
          provider,
          disabled: activeModelCount <= 1 || !enabledProviders[provider],
          title: activeModelCount <= 1 ? 'Keep at least one model in this provider' : 'Delete custom model'
        });
        deleteButton.className = 'delete-custom-model-btn';

        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'custom-model-toggle';
        input.dataset.model = model.value;
        input.dataset.provider = provider;
        input.checked = model.enabled !== false;
        input.disabled = !enabledProviders[provider];
        const slider = document.createElement('span');
        slider.className = 'toggle-slider';
        toggleLabel.appendChild(input);
        toggleLabel.appendChild(slider);

        const actions = document.createElement('div');
        actions.className = 'model-actions';
        actions.appendChild(deleteButton);
        actions.appendChild(toggleLabel);

        div.appendChild(info);
        div.appendChild(actions);
        providerContent.appendChild(div);
      });
    }

    if (removedModels.length > 0) {
      const restoreButton = document.createElement('button');
      restoreButton.className = 'restore-provider-models-btn';
      restoreButton.dataset.provider = provider;
      restoreButton.textContent = `Restore Removed Models (${removedModels.length})`;
      providerContent.appendChild(restoreButton);
    }

    providerGroup.appendChild(providerContent);
    modelsList.appendChild(providerGroup);
  }
}

function formatOllamaDisplayName(name) {
  return name.split(':')[0].charAt(0).toUpperCase() + name.split(':')[0].slice(1) +
    (name.includes(':') ? ` (${name.split(':').slice(1).join(':')})` : '');
}

function formatOpenRouterDisplayName(slug) {
  const parts = slug.split('/');
  const modelPart = parts[1].split(':')[0];
  return modelPart.charAt(0).toUpperCase() + modelPart.slice(1).replace(/-/g, ' ');
}

function formatSimpleCustomDisplayName(name) {
  return `Custom ${name}`;
}

function isLikelyValidGroqModelId(name) {
  return /^(?:[a-zA-Z][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*|[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)+)$/.test(name);
}

function isLikelyValidGoogleModelId(name) {
  return /^(gemini|gemma)-[a-zA-Z0-9][a-zA-Z0-9._-]*$/i.test(name);
}

function isLikelyValidOpenAIModelId(name) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);
}

export function promptForCustomModel(model) {
  if (model === 'groq:custom') {
    const name = prompt("Enter your Groq model ID:", "moonshotai/kimi-k2-instruct");
    if (!name) {
      return { cancelled: true };
    }
    if (!isLikelyValidGroqModelId(name)) {
      return {
        cancelled: false,
        error: 'Invalid Groq model ID. Use a full model ID like moonshotai/kimi-k2-instruct or llama-3.3-70b-versatile.'
      };
    }
    return {
      cancelled: false,
      provider: 'groq',
      modelValue: `groq:${name}`,
      displayName: formatSimpleCustomDisplayName(name)
    };
  }

  if (model === 'google:custom') {
    const name = prompt("Enter your Gemini model ID:", "gemini-3.1-flash-lite-preview");
    if (!name) {
      return { cancelled: true };
    }
    if (!isLikelyValidGoogleModelId(name)) {
      return {
        cancelled: false,
        error: 'Invalid Gemini model ID. Use an ID like gemini-3.1-flash-lite-preview, gemini-3-flash-preview, or gemma-3-27b-it.'
      };
    }
    return {
      cancelled: false,
      provider: 'google',
      modelValue: `google:${name}`,
      displayName: formatSimpleCustomDisplayName(name)
    };
  }

  if (model === 'openai:custom') {
    const name = prompt("Enter your OpenAI model ID:", "gpt-4.1-mini");
    if (!name) {
      return { cancelled: true };
    }
    if (!isLikelyValidOpenAIModelId(name)) {
      return {
        cancelled: false,
        error: 'Invalid OpenAI model ID. Use an ID like gpt-4.1-mini or gpt-4o.'
      };
    }
    return {
      cancelled: false,
      provider: 'openai',
      modelValue: `openai:${name}`,
      displayName: formatSimpleCustomDisplayName(name)
    };
  }

  if (model === 'ollama:custom') {
    const name = prompt("Enter your Ollama model name:", "llama3");
    if (!name) {
      return { cancelled: true };
    }
    if (!/^[a-zA-Z0-9\-_:.]+$/.test(name)) {
      return {
        cancelled: false,
        error: 'Invalid model name. Use only letters, numbers, hyphens, underscores, colons, and dots.'
      };
    }
    return {
      cancelled: false,
      provider: 'ollama',
      modelValue: `ollama:${name}`,
      displayName: `Custom ${formatOllamaDisplayName(name)}`
    };
  }

  if (model === 'openrouter:custom') {
    const slug = prompt("Enter OpenRouter model slug (e.g., openai/gpt-4):", "openai/gpt-4");
    if (!slug) {
      return { cancelled: true };
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*\/[a-zA-Z][a-zA-Z0-9._-]*(:[a-zA-Z0-9_-]+)?$/.test(slug)) {
      return {
        cancelled: false,
        error: 'Invalid model slug format. Use format: provider/model-name (e.g., openai/gpt-4, deepseek/deepseek-r1:free)'
      };
    }
    return {
      cancelled: false,
      provider: 'openrouter',
      modelValue: `openrouter:${slug}`,
      displayName: `Custom ${formatOpenRouterDisplayName(slug)}`
    };
  }

  return { cancelled: false, modelValue: model };
}
