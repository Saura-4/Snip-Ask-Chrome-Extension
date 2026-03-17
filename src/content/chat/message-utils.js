function extractMessageDisplayText(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        const textPart = content.find((item) => item.type === 'text');
        return textPart ? textPart.text : '(image analyzed)';
    }

    if (content && content.content) {
        if (Array.isArray(content.content)) {
            const textPart = content.content.find((item) => item.type === 'text');
            return textPart ? textPart.text : '(image analyzed)';
        }

        if (typeof content.content === 'string') {
            return content.content;
        }
    }

    return '(complex content)';
}

function createChatHistoryEntry(role, content, modelName = null, base64Image = null, isRegenerated = false) {
    const displayText = extractMessageDisplayText(content);

    return {
        role,
        content,
        displayText: typeof displayText === 'string' ? displayText : String(displayText),
        model: modelName,
        base64Image: base64Image || null,
        isRegenerated: isRegenerated || false,
        timestamp: Date.now()
    };
}

function buildApiHistoryFromChat(chatHistory, upToIndex) {
    return chatHistory.slice(0, upToIndex + 1).map((message) => {
        let textContent = message.displayText || message.content;
        if (typeof textContent !== 'string') {
            if (Array.isArray(textContent)) {
                const textPart = textContent.find((item) => item.type === 'text');
                textContent = textPart ? textPart.text : '';
            } else {
                textContent = String(textContent);
            }
        }

        return { role: message.role, content: textContent };
    });
}

function extractUserTextFromHistory(chatHistory, upToIndex) {
    return chatHistory
        .slice(0, upToIndex + 1)
        .filter((message) => message.role === 'user')
        .map((message) => message.displayText || (typeof message.content === 'string' ? message.content : ''))
        .join('\n');
}

function formatChatHistoryForApi(chatHistory, getModelDisplayName) {
    return chatHistory.map((message) => {
        const textContent = message.displayText || (typeof message.content === 'string' ? message.content : '');
        if (message.model && message.role === 'assistant') {
            return { role: message.role, content: `[Response from ${getModelDisplayName(message.model)}]: ${textContent}` };
        }

        return { role: message.role, content: textContent };
    });
}
