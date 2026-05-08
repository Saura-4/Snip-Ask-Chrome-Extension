function extractTextFromModelContent(content) {
    if (!content) return '';
    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part?.type === 'text' && typeof part.text === 'string') return part.text;
                if (typeof part?.content === 'string') return part.content;
                if (typeof part?.message === 'string') return part.message;
                return '';
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    if (typeof content === 'object') {
        if (typeof content.text === 'string') return content.text;
        if (typeof content.content === 'string') return content.content;
        if (typeof content.message === 'string') return content.message;
        if (Array.isArray(content.content)) return extractTextFromModelContent(content.content);
    }

    return '';
}

function getGuestTokenUsage(guestResponse) {
    if (!guestResponse?.usage) return null;
    return {
        promptTokens: guestResponse.usage.prompt_tokens || 0,
        completionTokens: guestResponse.usage.completion_tokens || 0,
        totalTokens: guestResponse.usage.total_tokens || 0
    };
}

function parseGuestResponse(guestResponse) {
    const messageContent = guestResponse?.choices?.[0]?.message?.content;
    const rawAnswer = extractTextFromModelContent(messageContent);
    const answer = rawAnswer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || 'No answer returned.';

    return {
        answer,
        guestInfo: guestResponse?._demo || guestResponse?._guest || null,
        tokenUsage: getGuestTokenUsage(guestResponse)
    };
}

export {
    extractTextFromModelContent,
    getGuestTokenUsage,
    parseGuestResponse
};
