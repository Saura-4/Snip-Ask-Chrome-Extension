function renderClonedChatMessage(targetUI, msg) {
    const msgDiv = document.createElement("div");
    msgDiv.style.cssText = `max-width: 85%; padding: 12px 14px; border-radius: 10px; line-height: 1.5; word-wrap: break-word; font-size: 13px; position: relative;`;

    if (msg.role === 'user') {
        msgDiv.style.alignSelf = "flex-end";
        msgDiv.style.background = "linear-gradient(135deg, #3a3a3a 0%, #2d2d2d 100%)";
        msgDiv.style.color = "#e8e8e8";
        msgDiv.style.borderRadius = "10px 10px 2px 10px";
        msgDiv.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";

        if (msg.base64Image) {
            const imgContainer = document.createElement('div');
            imgContainer.style.cssText = `margin-bottom: 8px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); background: #1a1a1a; position: relative;`;

            const thumbnail = document.createElement('img');
            thumbnail.src = `data:image/png;base64,${msg.base64Image}`;
            thumbnail.style.cssText = `width: 100%; max-height: 120px; object-fit: cover; cursor: pointer; display: block;`;
            thumbnail.onclick = () => targetUI._showImageModal(`data:image/png;base64,${msg.base64Image}`);

            const overlay = document.createElement('div');
            overlay.style.cssText = `position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,0.6); border-radius: 4px; padding: 2px 6px; font-size: 10px; color: #ccc;`;
            overlay.textContent = '📷';

            imgContainer.appendChild(thumbnail);
            imgContainer.appendChild(overlay);
            msgDiv.appendChild(imgContainer);
        }

        const textLabel = document.createElement('span');
        textLabel.style.cssText = "opacity: 0.9; font-size: 12px;";
        textLabel.textContent = msg.displayText || '';
        msgDiv.appendChild(textLabel);
    } else {
        msgDiv.style.alignSelf = "flex-start";
        msgDiv.style.background = "rgba(255,255,255,0.05)";
        msgDiv.style.color = "#e8e8e8";
        msgDiv.style.border = "1px solid rgba(255,255,255,0.08)";
        msgDiv.style.borderRadius = "10px 10px 10px 2px";

        const modelLabel = targetUI._getModelDisplayName(msg.model);
        const labelDiv = document.createElement("div");
        labelDiv.style.cssText = "font-size: 10px; color: #ff6b4a; margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 4px; background: rgba(255,107,74,0.1); padding: 3px 8px; border-radius: 4px;";
        labelDiv.innerHTML = `<span style="font-size: 11px;">✨</span> ${modelLabel}`;
        msgDiv.appendChild(labelDiv);

        const contentDiv = document.createElement("div");
        contentDiv.style.cssText = "max-height: 350px; overflow-y: auto;";
        const text = msg.displayText || (typeof msg.content === 'string' ? msg.content : '');
        if (typeof parseMarkdown === 'function') {
            contentDiv.innerHTML = parseMarkdown(sanitizeModelText(text));
            if (typeof attachCodeBlockCopyHandlers === 'function') {
                attachCodeBlockCopyHandlers(contentDiv);
            }
        } else {
            contentDiv.innerText = text;
        }
        msgDiv.appendChild(contentDiv);
    }

    targetUI.chatBody.appendChild(msgDiv);
}
