function sanitizeUserSnip(rawText) {
    return rawText
        .replace(/</g, "\\<")
        .replace(/>/g, "\\>");
}

function createTextSnipMessage(rawText) {
    return {
        role: 'user',
        content: `<user_snip>\n${sanitizeUserSnip(rawText)}\n</user_snip>`
    };
}

function stripThinkingTags(text) {
    if (!text) return text;
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export {
    createTextSnipMessage,
    stripThinkingTags
};
