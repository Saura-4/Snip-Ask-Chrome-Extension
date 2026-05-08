function createChatActionButton(text, icon, title, isPrimary) {
    const button = document.createElement("button");
    button.innerHTML = `${icon} ${text}`;
    button.title = title;
    button.style.cssText = `
        background: ${isPrimary ? 'rgba(245, 80, 54, 0.12)' : 'rgba(255,255,255,0.04)'};
        color: ${isPrimary ? '#ff6b4a' : '#b8b8b8'};
        border: 1px solid ${isPrimary ? 'rgba(245, 80, 54, 0.5)' : 'rgba(255,255,255,0.1)'};
        padding: 5px 10px;
        border-radius: 999px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.18s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        font-weight: 500;
        line-height: 1;
        min-height: 26px;
    `;
    button.onmouseenter = () => {
        button.style.background = isPrimary ? 'rgba(245, 80, 54, 0.18)' : 'rgba(255,255,255,0.08)';
        button.style.borderColor = isPrimary ? 'rgba(245, 80, 54, 0.65)' : 'rgba(255,255,255,0.16)';
        button.style.color = isPrimary ? '#ff7a5c' : '#e5e7eb';
    };
    button.onmouseleave = () => {
        button.style.background = isPrimary ? 'rgba(245, 80, 54, 0.12)' : 'rgba(255,255,255,0.04)';
        button.style.borderColor = isPrimary ? 'rgba(245, 80, 54, 0.5)' : 'rgba(255,255,255,0.1)';
        button.style.color = isPrimary ? '#ff6b4a' : '#b8b8b8';
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
        const imgContainer = document.createElement('div');
        imgContainer.style.cssText = `
            margin-bottom: 8px;
            border-radius: 6px;
            overflow: hidden;
            border: 1px solid rgba(255,255,255,0.1);
            background: #1a1a1a;
            position: relative;
        `;

        const thumbnail = document.createElement('img');
        thumbnail.src = imgSrc;
        thumbnail.style.cssText = `
            width: 100%;
            max-height: 120px;
            object-fit: cover;
            cursor: pointer;
            display: block;
            transition: transform 0.2s;
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

        const iconOverlay = document.createElement('div');
        iconOverlay.style.cssText = `
            position: absolute;
            bottom: 4px;
            right: 4px;
            background: rgba(0,0,0,0.6);
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 10px;
            color: #ccc;
            pointer-events: none;
        `;
        iconOverlay.textContent = 'Click to expand';

        imgContainer.appendChild(thumbnail);
        imgContainer.appendChild(iconOverlay);
        msgDiv.appendChild(imgContainer);

        let ocrContainer = null;
        if (canToggleOcr) {
            ocrContainer = document.createElement('div');
            ocrContainer.textContent = ocrText;
            ocrContainer.style.cssText = `
                display: none;
                max-height: 180px;
                overflow-y: auto;
                white-space: pre-wrap;
                border: 1px solid rgba(255,255,255,0.1);
                background: rgba(0,0,0,0.18);
                border-radius: 6px;
                padding: 8px 9px;
                font-size: 12px;
                line-height: 1.45;
            `;
            msgDiv.appendChild(ocrContainer);
        }

        if (canToggleOcr && ocrContainer) {
            const setOcrView = (view) => {
                const showOcr = view === 'ocr';
                imgContainer.style.display = showOcr ? 'none' : 'block';
                ocrContainer.style.display = showOcr ? 'block' : 'none';
                toggleBtn.innerHTML = showOcr
                    ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="8" cy="10" r="1.5"></circle><path d="M21 15l-5-5L5 19"></path></svg> Image'
                    : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"></path><path d="M9 20h6"></path><path d="M12 4v16"></path></svg> OCR';
                toggleBtn.title = showOcr ? 'Show screenshot' : 'Show OCR text';
            };

            const actionsDiv = document.createElement('div');
            actionsDiv.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);";
            const toggleBtn = createChatActionButton(
                "OCR",
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"></path><path d="M9 20h6"></path><path d="M12 4v16"></path></svg>',
                "Show OCR text",
                false
            );
            toggleBtn.onclick = () => {
                if (!metadata) return;
                metadata.ocrView = metadata.ocrView === 'ocr' ? 'image' : 'ocr';
                setOcrView(metadata.ocrView);
                targetUI?.onSessionChanged?.();
            };
            actionsDiv.appendChild(toggleBtn);
            msgDiv.appendChild(actionsDiv);
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
        label.style.opacity = "0.8";
        label.style.fontSize = "0.9em";
        msgDiv.appendChild(label);
        msgDiv.appendChild(document.createElement('br'));

        const textSpan = document.createElement('span');
        textSpan.textContent = textPart ? textPart.text : '';
        msgDiv.appendChild(textSpan);
        return;
    }

    msgDiv.innerText = typeof displayText === 'string' ? displayText : String(content);
}

function buildAssistantLabel(modelLabel, isRegenerated, tokenUsage) {
    const tokenInfo = tokenUsage?.totalTokens ? tokenUsage.totalTokens.toLocaleString() : null;

    if (isRegenerated) {
        return `${modelLabel}${tokenInfo ? ` • ${tokenInfo} tokens` : ''} Regenerated`;
    }

    return `${modelLabel}${tokenInfo ? ` • ${tokenInfo} tokens` : ''}`;
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

    const labelDiv = document.createElement("div");
    labelDiv.style.cssText = "font-size: 10px; color: #ff6b4a; margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 4px; background: rgba(255,107,74,0.1); padding: 3px 8px; border-radius: 4px;";
    labelDiv.textContent = buildAssistantLabel(modelLabel, isRegenerated, tokenUsage);
    msgDiv.appendChild(labelDiv);

    const contentDiv = document.createElement("div");
    contentDiv.style.cssText = "max-height: 350px; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: #404040 transparent;";
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
    actionsDiv.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);";

    const copyBtn = createChatActionButton(
        "Copy",
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
        "Copy entire response",
        false
    );
    copyBtn.onclick = () => {
        const responseText = contentDiv.textContent || '';
        navigator.clipboard.writeText(responseText).then(() => {
            const originalHTML = copyBtn.innerHTML;
            copyBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied';
            copyBtn.style.borderColor = "#4ade80";
            copyBtn.style.color = "#4ade80";
            setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                copyBtn.style.borderColor = "rgba(255,255,255,0.1)";
                copyBtn.style.color = "#b8b8b8";
            }, 2000);
        });
    };
    actionsDiv.appendChild(copyBtn);

    const regenBtn = createChatActionButton(
        "Regenerate",
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
        "Regenerate from this point",
        false
    );
    regenBtn.onclick = () => targetUI.regenerateAtIndex(messageIndex);
    actionsDiv.appendChild(regenBtn);

    if (!isError &&
        typeof targetUI._shouldShowScoutRetry === 'function' &&
        targetUI._shouldShowScoutRetry(messageIndex, metadata)) {
        const scoutBtn = createChatActionButton(
            "Scout",
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="2"></circle><path d="M12 2v2M12 20v2M2 12h2M20 12h2"></path></svg>',
            "Regenerate this answer with Scout vision",
            false
        );
        scoutBtn.onclick = () => targetUI.retryWithScoutAtIndex(messageIndex);
        actionsDiv.appendChild(scoutBtn);
    }

    const minimizeBtn = createChatActionButton("Minimize", '-', "Minimize response", false);
    minimizeBtn.onclick = () => {
        const isMinimized = contentDiv.style.display === 'none';
        if (isMinimized) {
            contentDiv.style.display = 'block';
            minimizeBtn.innerHTML = '- Minimize';
            minimizeBtn.title = 'Minimize response';
        } else {
            contentDiv.style.display = 'none';
            minimizeBtn.innerHTML = '+ Expand';
            minimizeBtn.title = 'Expand response';
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
    msgDiv.style.cssText = "max-width: 85%; padding: 12px 14px; border-radius: 10px; line-height: 1.5; word-wrap: break-word; font-size: 13px; position: relative; transition: all 0.2s ease;";
    if (Number.isInteger(messageIndex) && messageIndex >= 0) {
        msgDiv.dataset.snipAskMessageIndex = String(messageIndex);
    }

    if (role === 'user') {
        msgDiv.style.alignSelf = "flex-end";
        msgDiv.style.background = "linear-gradient(135deg, #3a3a3a 0%, #2d2d2d 100%)";
        msgDiv.style.color = "#e8e8e8";
        msgDiv.style.borderRadius = "10px 10px 2px 10px";
        msgDiv.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
        renderUserMessageContent(targetUI, msgDiv, content, base64Image, displayText, (imageSrc) => targetUI._showImageModal(imageSrc), messageIndex, metadata);
    } else {
        msgDiv.style.alignSelf = "flex-start";
        msgDiv.style.background = "rgba(255,255,255,0.05)";
        msgDiv.style.color = "#e8e8e8";
        msgDiv.style.border = "1px solid rgba(255,255,255,0.08)";
        msgDiv.style.borderRadius = "10px 10px 10px 2px";
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
