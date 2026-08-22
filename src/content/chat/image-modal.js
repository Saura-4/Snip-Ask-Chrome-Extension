// src/content/chat/image-modal.js
// Full-size screenshot modal overlay (standalone, UI-instance independent)

/**
 * Show full-size image in a modal overlay attached to the given shadow root.
 * @param {ShadowRoot} shadowRoot - Shadow DOM root to append the overlay to
 * @param {string} imgSrc - Image source URL or data URI
 */
function openSnipAskImageModal(shadowRoot, imgSrc) {
    if (!imgSrc || !shadowRoot) return;

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        cursor: zoom-out;
        animation: fadeIn 0.2s ease;
    `;

    // Add animation keyframes
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    `;
    overlay.appendChild(style);

    // Create image container
    const imgContainer = document.createElement('div');
    imgContainer.style.cssText = `
        position: relative;
        max-width: 90vw;
        max-height: 90vh;
        animation: scaleIn 0.2s ease;
    `;

    // Full-size image
    const fullImg = document.createElement('img');
    fullImg.src = imgSrc;
    fullImg.style.cssText = `
        max-width: 90vw;
        max-height: 85vh;
        object-fit: contain;
        border-radius: var(--sa-radius-md);
        box-shadow: var(--sa-shadow-overlay);
    `;
    fullImg.alt = "Full size screenshot";

    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.style.cssText = `
        position: absolute;
        top: -15px;
        right: -15px;
        width: var(--sa-control-lg);
        height: var(--sa-control-lg);
        background: var(--sa-surface-header);
        border: var(--sa-border-strong);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: var(--sa-type-title);
        color: var(--sa-text-primary);
        box-shadow: var(--sa-shadow-md);
        transition: transform var(--sa-transition-normal), border-color var(--sa-transition-normal), color var(--sa-transition-normal), background var(--sa-transition-normal);
    `;
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('role', 'button');
    closeBtn.setAttribute('aria-label', 'Close image');
    closeBtn.onmouseenter = () => {
        closeBtn.style.transform = 'scale(1.06)';
        closeBtn.style.borderColor = 'rgba(255,107,74,0.26)';
        closeBtn.style.color = 'var(--sa-accent-soft)';
        closeBtn.style.background = '#242424';
    };
    closeBtn.onmouseleave = () => {
        closeBtn.style.transform = 'scale(1)';
        closeBtn.style.borderColor = 'rgba(255,255,255,0.12)';
        closeBtn.style.color = 'var(--sa-text-primary)';
        closeBtn.style.background = 'var(--sa-surface-header)';
    };

    // Hint text
    const hint = document.createElement('div');
    hint.style.cssText = `
        position: absolute;
        bottom: -30px;
        left: 50%;
        transform: translateX(-50%);
        color: var(--sa-text-muted);
        font-size: var(--sa-type-small);
        white-space: nowrap;
    `;
    hint.textContent = 'Click anywhere or press ESC to close';

    imgContainer.appendChild(fullImg);
    imgContainer.appendChild(closeBtn);
    imgContainer.appendChild(hint);
    overlay.appendChild(imgContainer);

    // Close handlers
    const closeModal = () => {
        overlay.style.animation = 'fadeIn 0.15s ease reverse';
        setTimeout(() => overlay.remove(), 150);
        document.removeEventListener('keydown', escHandler);
    };

    overlay.onclick = closeModal;
    closeBtn.onclick = (e) => { e.stopPropagation(); closeModal(); };
    imgContainer.onclick = (e) => e.stopPropagation(); // Prevent close when clicking image

    // ESC key handler
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    };
    document.addEventListener('keydown', escHandler);

    // Add to shadow DOM
    shadowRoot.appendChild(overlay);
}
