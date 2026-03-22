export function populateModeSelect(modeSelect, modes, selectedMode) {
  modeSelect.innerHTML = '';

  modes.forEach((mode) => {
    const option = document.createElement('option');
    option.value = mode.id;
    option.textContent = mode.name;
    modeSelect.appendChild(option);
  });

  const customOption = document.createElement('option');
  customOption.value = 'custom';
  customOption.textContent = 'Custom Prompt';
  modeSelect.appendChild(customOption);

  if (selectedMode) {
    modeSelect.value = selectedMode;
  }
}

export function populateModesList(modesList, modes) {
  modesList.innerHTML = '';

  modes.forEach((mode) => {
    const div = document.createElement('div');
    div.className = 'mode-item';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'mode-name';
    nameSpan.textContent = mode.name;

    const actions = document.createElement('div');
    actions.className = 'mode-actions';

    const editButton = document.createElement('button');
    editButton.dataset.modeId = mode.id;
    editButton.className = 'edit-mode-btn';
    editButton.textContent = 'Edit';
    actions.appendChild(editButton);

    if (!mode.isDefault) {
      const deleteButton = document.createElement('button');
      deleteButton.dataset.modeId = mode.id;
      deleteButton.className = 'delete-mode-btn';
      deleteButton.textContent = 'Delete';
      actions.appendChild(deleteButton);
    }

    div.appendChild(nameSpan);
    div.appendChild(actions);
    modesList.appendChild(div);
  });
}

export function validateModeInput(name, prompt) {
  if (!name || !prompt) {
    return 'Please fill in both name and prompt';
  }

  if (name.length > 50) {
    return 'Mode name must be 50 characters or less';
  }

  if (prompt.length > 2000) {
    return 'Prompt must be 2000 characters or less';
  }

  return null;
}
