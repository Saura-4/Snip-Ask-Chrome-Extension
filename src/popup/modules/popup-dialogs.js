let activeDialog = null;
let toastTimer = null;

function ensureToastElement() {
  let toast = document.getElementById('snipAskToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'snipAskToast';
    toast.className = 'sa-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  return toast;
}

export function showToast(message, type = 'success') {
  const toast = ensureToastElement();
  toast.textContent = message;
  toast.className = `sa-toast sa-toast-${type} visible`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
  }, type === 'error' ? 5000 : 2600);
}

function buildModal({ title, body, confirmText = 'OK', cancelText = 'Cancel', danger = false }) {
  const overlay = document.createElement('div');
  overlay.className = 'sa-modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'sa-modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  if (title) {
    const heading = document.createElement('h3');
    heading.className = 'sa-modal-title';
    heading.textContent = title;
    dialog.appendChild(heading);
  }

  dialog.appendChild(body);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'sa-modal-actions';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'sa-modal-btn sa-modal-btn-secondary';
  cancelButton.textContent = cancelText;

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = `sa-modal-btn ${danger ? 'sa-modal-btn-danger' : 'sa-modal-btn-primary'}`;
  confirmButton.textContent = confirmText;

  buttonRow.appendChild(cancelButton);
  buttonRow.appendChild(confirmButton);
  dialog.appendChild(buttonRow);
  overlay.appendChild(dialog);

  return { overlay, dialog, confirmButton, cancelButton };
}

function openModal(options, resolve) {
  if (activeDialog) {
    activeDialog.close(false);
  }

  const { overlay, dialog, confirmButton, cancelButton } = buildModal(options);
  let settled = false;

  const close = (result) => {
    if (settled) return;
    settled = true;
    overlay.remove();
    document.removeEventListener('keydown', onKeydown, true);
    activeDialog = null;
    resolve(result);
  };

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(null);
    }
  };

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay && options.dismissOnBackdrop !== false) {
      close(null);
    }
  });

  cancelButton.addEventListener('click', () => close(null));
  confirmButton.addEventListener('click', () => close('__confirmed__'));

  document.addEventListener('keydown', onKeydown, true);
  document.body.appendChild(overlay);
  activeDialog = { close };

  requestAnimationFrame(() => {
    const focusTarget = dialog.querySelector('input, textarea') || confirmButton;
    focusTarget.focus();
    if (focusTarget.select) focusTarget.select();
  });

  return { close, confirmButton, cancelButton };
}

export function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const body = document.createElement('p');
    body.className = 'sa-modal-message';
    body.textContent = message;

    const modal = openModal({ title, body, confirmText, cancelText, danger }, (result) => {
      resolve(result === '__confirmed__');
    });

    modal.confirmButton.focus();
  });
}

export function promptDialog({ title, label, placeholder = '', defaultValue = '', confirmText = 'Save' } = {}) {
  return new Promise((resolve) => {
    const body = document.createElement('div');

    if (label) {
      const labelText = document.createElement('p');
      labelText.className = 'sa-modal-message';
      labelText.textContent = label;
      body.appendChild(labelText);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sa-modal-input';
    input.placeholder = placeholder;
    input.value = defaultValue;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        modal.confirmButton.click();
      }
    });
    body.appendChild(input);

    const modal = openModal({ title, body, confirmText }, (result) => {
      if (result !== '__confirmed__') {
        resolve(null);
        return;
      }
      const value = input.value.trim();
      resolve(value || null);
    });
  });
}
