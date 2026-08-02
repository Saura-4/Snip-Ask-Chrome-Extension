function createChatActionButton(text, icon, title, isPrimary, variant = 'default') {
    const button = document.createElement("button");
    const isQuiet = variant === 'quiet';
    button.className = `chat-action-btn${isPrimary ? ' chat-action-btn--primary' : ''}${isQuiet ? ' chat-action-btn--quiet' : ''}`;
    button.innerHTML = isQuiet ? icon : `${icon} ${text}`;
    button.title = title;
    button.setAttribute('aria-label', title || text);
    const baseBackground = isPrimary ? 'rgba(245, 80, 54, 0.1)' : (isQuiet ? 'var(--sa-button-quiet-bg)' : 'var(--sa-surface-control)');
    const baseColor = isPrimary ? 'var(--sa-accent-soft)' : (isQuiet ? 'var(--sa-button-quiet-text)' : '#b8b8b8');
    const baseBorder = isPrimary ? 'rgba(245, 80, 54, 0.28)' : (isQuiet ? 'transparent' : 'rgba(255,255,255,0.09)');
    const hoverBackground = isPrimary ? 'rgba(245, 80, 54, 0.13)' : 'var(--sa-surface-control-hover)';
    const hoverBorder = isPrimary ? 'rgba(245, 80, 54, 0.38)' : 'rgba(255,255,255,0.12)';
    const hoverColor = isPrimary ? 'var(--sa-accent-soft)' : '#e2e2e2';
    button.style.cssText = `
        background: ${baseBackground};
        color: ${baseColor};
        border: 1px solid ${baseBorder};
        padding: 5px 9px;
        border-radius: var(--sa-radius-md);
        font-size: var(--sa-type-meta);
        cursor: pointer;
        transition: background var(--sa-transition-normal), border-color var(--sa-transition-normal), color var(--sa-transition-normal);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--sa-space-3);
        font-weight: var(--sa-font-medium);
        line-height: var(--sa-leading-tight);
        min-height: var(--sa-control-xs);
        white-space: nowrap;
    `;
    button.onmouseenter = () => {
        button.style.background = hoverBackground;
        button.style.borderColor = hoverBorder;
        button.style.color = hoverColor;
    };
    button.onmouseleave = () => {
        button.style.background = baseBackground;
        button.style.borderColor = baseBorder;
        button.style.color = baseColor;
    };
    return button;
}

function getMessageImageSource(content, base64Image) {
    if (base64Image) {
        return `data:image/png;base64,${base64Image}`;
    }

    if (!Array.isArray(content)) {
        return null;
    }

    const imagePart = content.find((item) => item.type === 'image_url');
    return imagePart?.image_url?.url || null;
}

function getOcrToggleText(content, displayText, metadata) {
    if (typeof metadata?.ocrText === 'string' && metadata.ocrText.trim()) {
        return metadata.ocrText.trim();
    }
    if (typeof displayText === 'string' && displayText.trim()) {
        return displayText.trim();
    }
    if (typeof content === 'string' && content.trim()) {
        return content.trim();
    }
    if (content && typeof content.content === 'string' && content.content.trim()) {
        return content.content.trim();
    }
    return '';
}

function renderUserMessageContent(targetUI, msgDiv, content, base64Image, displayText, showImageModal, messageIndex, metadata) {
    const hasImage = Boolean(base64Image) || (Array.isArray(content) && content.some((item) => item.type === 'image_url'));
    const ocrText = getOcrToggleText(content, displayText, metadata);
    const canToggleOcr = hasImage && metadata?.usedOCR === true && Boolean(ocrText);

    if (hasImage) {
        const imgSrc = getMessageImageSource(content, base64Image);
        msgDiv.classList.add('snip-message');
        const imgContainer = document.createElement('div');
        imgContainer.style.cssText = `
            margin-bottom: 0;
            border-radius: var(--sa-radius-sm);
            overflow: hidden;
            border: var(--sa-border-default);
            background: var(--sa-surface-control);
            position: relative;
        `;

        const thumbnail = document.createElement('img');
        thumbnail.src = imgSrc;
        thumbnail.style.cssText = `
            width: 100%;
            height: 72px;
            max-height: 72px;
            object-fit: cover;
            cursor: pointer;
            display: block;
            transition: opacity var(--sa-transition-normal), transform var(--sa-transition-normal);
        `;
        thumbnail.title = "Click to view full size";
        thumbnail.alt = "Screenshot thumbnail";
        thumbnail.onmouseenter = () => {
            thumbnail.style.opacity = '0.85';
        };
        thumbnail.onmouseleave = () => {
            thumbnail.style.opacity = '1';
        };
        thumbnail.onclick = () => showImageModal(imgSrc);

        imgContainer.appendChild(thumbnail);
        msgDiv.appendChild(imgContainer);

        let ocrContainer = null;
        if (canToggleOcr) {
            ocrContainer = document.createElement('div');
            ocrContainer.textContent = ocrText;
            ocrContainer.style.cssText = `
                display: none;
                max-height: 118px;
                overflow-y: auto;
                white-space: pre-wrap;
                border: var(--sa-border-default);
                background: var(--sa-surface-field);
                border-radius: var(--sa-radius-sm);
                padding: 28px var(--sa-space-5) var(--sa-space-4);
                font-size: var(--sa-type-small);
                line-height: var(--sa-leading-normal);
            `;
            msgDiv.appendChild(ocrContainer);
        }

        if (canToggleOcr && ocrContainer) {
            const ocrToggle = document.createElement('button');
            ocrToggle.type = 'button';
            ocrToggle.className = 'chat-action-btn snip-ocr-toggle';
            ocrToggle.title = 'Show OCR text';
            ocrToggle.setAttribute('aria-label', 'Show OCR text');
            ocrToggle.style.cssText = `
                position: absolute;
                top: var(--sa-space-2);
                right: var(--sa-space-2);
                min-height: var(--sa-control-xxs);
                padding: 0 var(--sa-space-3);
                border-radius: var(--sa-radius-sm);
                border: var(--sa-border-default);
                background: rgba(8,8,8,0.76);
                color: var(--sa-text-soft);
                font-size: var(--sa-type-caption);
                font-weight: var(--sa-font-semibold);
                line-height: var(--sa-leading-tight);
                cursor: pointer;
                transition: background var(--sa-transition-normal), border-color var(--sa-transition-normal), color var(--sa-transition-normal);
            `;

            const setOcrView = (view) => {
                const showOcr = view === 'ocr';
                imgContainer.style.display = showOcr ? 'none' : 'block';
                ocrContainer.style.display = showOcr ? 'block' : 'none';
                ocrToggle.textContent = showOcr ? 'Image' : 'OCR';
                ocrToggle.title = showOcr ? 'Show screenshot' : 'Show OCR text';
                ocrToggle.setAttribute('aria-label', ocrToggle.title);
            };

            ocrToggle.onmouseenter = () => {
                ocrToggle.style.background = 'rgba(255,255,255,0.08)';
                ocrToggle.style.borderColor = 'rgba(255,107,74,0.24)';
                ocrToggle.style.color = 'var(--sa-accent-soft)';
            };
            ocrToggle.onmouseleave = () => {
                ocrToggle.style.background = 'rgba(8,8,8,0.76)';
                ocrToggle.style.borderColor = 'rgba(255,255,255,0.08)';
                ocrToggle.style.color = 'var(--sa-text-soft)';
            };
            ocrToggle.onclick = (event) => {
                event.stopPropagation();
                if (!metadata) return;
                metadata.ocrView = metadata.ocrView === 'ocr' ? 'image' : 'ocr';
                setOcrView(metadata.ocrView);
                targetUI?.onSessionChanged?.();
            };
            msgDiv.appendChild(ocrToggle);
            ocrContainer.addEventListener('dblclick', () => showImageModal(imgSrc));
            setOcrView(metadata.ocrView === 'ocr' ? 'ocr' : 'image');
        }
        return;
    }

    if (typeof content === 'object' && content?.content) {
        const textPart = Array.isArray(content.content)
            ? content.content.find((item) => item.type === 'text')
            : { text: content.content };
        const label = document.createElement('em');
        label.textContent = '(Snippet)';
        label.style.cssText = "display: block; margin-bottom: var(--sa-space-2); color: var(--sa-text-muted); font-size: var(--sa-type-caption); line-height: var(--sa-leading-tight); font-style: normal; font-weight: var(--sa-font-medium);";
        msgDiv.appendChild(label);

        const textSpan = document.createElement('span');
        textSpan.textContent = textPart ? textPart.text : '';
        textSpan.style.cssText = "display: block; line-height: var(--sa-leading-normal);";
        msgDiv.appendChild(textSpan);
        return;
    }

    msgDiv.innerText = typeof displayText === 'string' ? displayText : String(content);
}

function buildAssistantMetaParts(modelLabel, isRegenerated, tokenUsage) {
    const tokenInfo = tokenUsage?.totalTokens ? tokenUsage.totalTokens.toLocaleString() : null;
    const detailParts = [];

    if (tokenInfo) detailParts.push(`${tokenInfo} tokens`);
    if (isRegenerated) detailParts.push('Regenerated');

    return {
        model: modelLabel || 'AI',
        details: detailParts.join(' / ')
    };
}

function renderAssistantMessageContent(targetUI, msgDiv, options) {
    const {
        content,
        includeActions = true,
        isError,
        isRegenerated,
        messageIndex,
        metadata,
        modelLabel,
        tokenUsage
    } = options;

    const labelParts = buildAssistantMetaParts(modelLabel, isRegenerated, tokenUsage);
    const labelDiv = document.createElement("div");
    labelDiv.style.cssText = "font-size: var(--sa-type-caption); line-height: var(--sa-leading-tight); color: var(--sa-text-subtle); margin-bottom: var(--sa-space-6); font-weight: var(--sa-font-medium); letter-spacing: 0; display: flex; align-items: center; gap: var(--sa-space-3);";

    const modelSpan = document.createElement("span");
    modelSpan.textContent = labelParts.model;
    modelSpan.style.cssText = "color: rgba(255,138,109,0.70);";
    labelDiv.appendChild(modelSpan);

    if (labelParts.details) {
        const detailsSpan = document.createElement("span");
        detailsSpan.textContent = labelParts.details;
        detailsSpan.style.cssText = "color: var(--sa-text-subtle);";
        labelDiv.appendChild(detailsSpan);
    }
    msgDiv.appendChild(labelDiv);

    const contentDiv = document.createElement("div");
    contentDiv.style.cssText = "max-height: 360px; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: #404040 transparent; color: var(--sa-text-primary); font-size: var(--sa-type-body-large); line-height: var(--sa-leading-reading); padding: 0 var(--sa-space-1) var(--sa-space-1) 0;";
    const cleanText = sanitizeModelText(content);
    if (typeof parseMarkdown === 'function') {
        contentDiv.innerHTML = parseMarkdown(cleanText);
        if (typeof attachCodeBlockCopyHandlers === 'function') {
            attachCodeBlockCopyHandlers(contentDiv);
        }
    } else {
        contentDiv.innerText = cleanText;
    }
    msgDiv.appendChild(contentDiv);

    if (!includeActions) {
        return;
    }

    const actionsDiv = document.createElement("div");
    actionsDiv.className = 'assistant-actions';
    actionsDiv.style.cssText = "display: flex; flex-wrap: wrap; align-items: center; gap: var(--sa-space-3); margin-top: var(--sa-space-8); padding-top: var(--sa-space-6); border-top: var(--sa-border-subtle);";

    const copyIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    const copyBtn = createChatActionButton(
        "Copy",
        copyIcon,
        "Copy entire response",
        false,
        'quiet'
    );
    copyBtn.onclick = () => {
        const responseText = contentDiv.textContent || '';
        navigator.clipboard.writeText(responseText).then(() => {
            const originalHTML = copyBtn.innerHTML;
            const originalTitle = copyBtn.title;
            copyBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            copyBtn.title = 'Copied';
            copyBtn.setAttribute('aria-label', 'Copied');
            copyBtn.style.borderColor = "#4ade80";
            copyBtn.style.color = "#4ade80";
            setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                copyBtn.title = originalTitle;
                copyBtn.setAttribute('aria-label', originalTitle);
                copyBtn.style.borderColor = "transparent";
                copyBtn.style.color = "var(--sa-button-quiet-text)";
            }, 2000);
        });
    };
    actionsDiv.appendChild(copyBtn);

    const regenBtn = createChatActionButton(
        "Regenerate",
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
        "Regenerate from this point",
        false,
        'quiet'
    );
    regenBtn.onclick = () => targetUI.regenerateAtIndex(messageIndex);
    actionsDiv.appendChild(regenBtn);

    if (!isError &&
        typeof targetUI._shouldShowVisionRetry === 'function' &&
        targetUI._shouldShowVisionRetry(messageIndex, metadata)) {
        const visionBtn = createChatActionButton(
            "Vision",
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="2"></circle><path d="M12 2v2M12 20v2M2 12h2M20 12h2"></path></svg>',
            "Regenerate this answer with the vision fallback model",
            false,
            'quiet'
        );
        visionBtn.onclick = () => targetUI.retryWithVisionAtIndex(messageIndex);
        actionsDiv.appendChild(visionBtn);
    }

    const minimizeBtn = createChatActionButton("Minimize", '-', "Minimize response", false, 'quiet');
    minimizeBtn.onclick = () => {
        const isMinimized = contentDiv.style.display === 'none';
        if (isMinimized) {
            contentDiv.style.display = 'block';
            minimizeBtn.innerHTML = '-';
            minimizeBtn.title = 'Minimize response';
            minimizeBtn.setAttribute('aria-label', 'Minimize response');
        } else {
            contentDiv.style.display = 'none';
            minimizeBtn.innerHTML = '+';
            minimizeBtn.title = 'Expand response';
            minimizeBtn.setAttribute('aria-label', 'Expand response');
        }
    };
    actionsDiv.appendChild(minimizeBtn);

    if (isError) {
        const retryBtn = createChatActionButton(
            "Retry",
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"></path></svg>',
            "Retry failed request",
            true
        );
        retryBtn.onclick = () => targetUI.retryLastRequest();
        actionsDiv.appendChild(retryBtn);
    }

    msgDiv.appendChild(actionsDiv);
}

function renderChatMessage(targetUI, options) {
    const {
        role,
        content,
        displayText,
        base64Image,
        includeActions = true,
        isError,
        isRegenerated,
        messageIndex,
        metadata,
        modelLabel,
        tokenUsage
    } = options;

    const msgDiv = document.createElement("div");
    msgDiv.style.cssText = "max-width: 85%; padding: var(--sa-space-6) var(--sa-space-7); border-radius: var(--sa-radius-lg); line-height: var(--sa-leading-normal); word-wrap: break-word; font-size: var(--sa-type-body); position: relative; transition: background var(--sa-transition-normal), border-color var(--sa-transition-normal);";
    if (Number.isInteger(messageIndex) && messageIndex >= 0) {
        msgDiv.dataset.snipAskMessageIndex = String(messageIndex);
    }

    if (role === 'user') {
        msgDiv.classList.add('user-message');
        msgDiv.style.alignSelf = "flex-end";
        msgDiv.style.background = "var(--sa-surface-control-hover)";
        msgDiv.style.color = "var(--sa-text-soft)";
        msgDiv.style.border = "var(--sa-border-default)";
        msgDiv.style.borderRadius = "var(--sa-radius-lg) var(--sa-radius-lg) var(--sa-space-1) var(--sa-radius-lg)";
        msgDiv.style.boxShadow = "var(--sa-shadow-sm)";
        renderUserMessageContent(targetUI, msgDiv, content, base64Image, displayText, (imageSrc) => targetUI._showImageModal(imageSrc), messageIndex, metadata);
    } else {
        msgDiv.classList.add('assistant-message');
        msgDiv.style.alignSelf = "flex-start";
        msgDiv.style.background = "var(--sa-surface-panel)";
        msgDiv.style.color = "var(--sa-text-primary)";
        msgDiv.style.border = "var(--sa-border-default)";
        msgDiv.style.borderRadius = "var(--sa-radius-lg) var(--sa-radius-lg) var(--sa-radius-lg) var(--sa-space-1)";
        msgDiv.style.padding = "var(--sa-space-8) var(--sa-space-8) var(--sa-space-7)";
        msgDiv.style.boxShadow = "var(--sa-shadow-sm)";
        renderAssistantMessageContent(targetUI, msgDiv, {
            content,
            includeActions,
            isError,
            isRegenerated,
            messageIndex,
            metadata,
            modelLabel,
            tokenUsage
        });
    }

    targetUI.chatBody.appendChild(msgDiv);
    return msgDiv;
}

function renderClonedChatMessage(targetUI, msg, options = {}) {
    const {
        includeActions = false,
        messageIndex = -1
    } = options;

    return renderChatMessage(targetUI, {
        role: msg.role,
        content: msg.content,
        displayText: msg.displayText || (typeof msg.content === 'string' ? msg.content : ''),
        base64Image: msg.base64Image || null,
        includeActions: msg.role === 'assistant' && includeActions,
        isError: false,
        isRegenerated: Boolean(msg.isRegenerated),
        messageIndex,
        metadata: msg.metadata || null,
        modelLabel: msg.role === 'assistant' ? targetUI._getModelDisplayName(msg.model) : null,
        tokenUsage: msg.metadata?.tokenUsage || null
    });
}
