// Shared session helpers for popup, side-panel, and compare chat windows.
(function initSnipAskSession(global) {
    function cloneArray(value) {
        return Array.isArray(value) ? [...value] : [];
    }

    function cloneChatHistory(chatHistory) {
        return Array.isArray(chatHistory)
            ? chatHistory.map((message) => ({ ...message }))
            : [];
    }

    function getSessionModel(apiResponse, responseContext = {}) {
        return apiResponse.selectedModel || responseContext.model || apiResponse.model || null;
    }

    function getResponseModel(apiResponse, responseContext = {}) {
        return apiResponse.responseModel || apiResponse.model || responseContext.model || null;
    }

    function createApiResponseEntries(apiResponse, responseContext = {}) {
        const responseModel = getResponseModel(apiResponse, responseContext);
        return {
            userEntry: createChatHistoryEntry(
                'user',
                apiResponse.initialUserMessage,
                null,
                apiResponse.base64Image || null,
                false
            ),
            assistantEntry: createChatHistoryEntry(
                'assistant',
                apiResponse.answer,
                responseModel,
                null,
                false
            )
        };
    }

    function buildSessionFromApiResponse(apiResponse, responseContext = {}) {
        const sessionModel = getSessionModel(apiResponse, responseContext);
        const { userEntry, assistantEntry } = createApiResponseEntries(apiResponse, responseContext);

        return {
            uiId: crypto.randomUUID(),
            chatHistory: [userEntry, assistantEntry],
            currentModel: sessionModel,
            currentMode: responseContext.mode || null,
            availableModels: [],
            customModes: [],
            customPrompt: '',
            initialUserMessage: apiResponse.initialUserMessage,
            initialBase64Image: apiResponse.base64Image || null,
            allImages: apiResponse.base64Image ? [apiResponse.base64Image] : [],
            lastUpdated: Date.now()
        };
    }

    function mergeSessionWithApiResponse(existingSession, apiResponse, responseContext = {}) {
        const sessionModel = getSessionModel(apiResponse, responseContext);
        const priorHistory = cloneChatHistory(existingSession?.chatHistory);
        const priorImages = cloneArray(existingSession?.allImages);
        const { userEntry, assistantEntry } = createApiResponseEntries(apiResponse, responseContext);

        if (apiResponse.base64Image && !priorImages.includes(apiResponse.base64Image)) {
            priorImages.push(apiResponse.base64Image);
        }

        return {
            ...(existingSession || {}),
            chatHistory: [...priorHistory, userEntry, assistantEntry],
            currentModel: sessionModel || existingSession?.currentModel || null,
            currentMode: responseContext.mode || existingSession?.currentMode || null,
            initialUserMessage: existingSession?.initialUserMessage || apiResponse.initialUserMessage,
            initialBase64Image: existingSession?.initialBase64Image || apiResponse.base64Image || null,
            allImages: priorImages,
            lastUpdated: Date.now()
        };
    }

    function serializeFloatingChat(ui) {
        return {
            uiId: ui.uiId,
            chatHistory: cloneChatHistory(ui.chatHistory),
            currentModel: ui.currentModel,
            currentMode: ui.currentMode,
            availableModels: cloneArray(ui.availableModels),
            customModes: cloneArray(ui.customModes),
            customPrompt: ui.customPrompt || '',
            initialUserMessage: ui.initialUserMessage || null,
            initialBase64Image: ui.initialBase64Image || null,
            allImages: cloneArray(ui.allImages),
            activeTabId: ui.activeTabId || null,
            windowId: ui.windowId || null,
            lastUpdated: Date.now()
        };
    }

    function hydrateFloatingChat(ui, session, options = {}) {
        if (!session) return;

        ui.uiId = session.uiId || ui.uiId;
        ui.availableModels = Array.isArray(session.availableModels) && session.availableModels.length > 0
            ? cloneArray(session.availableModels)
            : ui.availableModels;
        ui.customModes = Array.isArray(session.customModes) ? cloneArray(session.customModes) : ui.customModes;
        ui.customPrompt = session.customPrompt || ui.customPrompt;
        ui.currentModel = session.currentModel || ui.currentModel;
        ui.currentMode = session.currentMode || ui.currentMode;
        ui.initialUserMessage = session.initialUserMessage || null;
        ui.initialBase64Image = session.initialBase64Image || null;
        ui.allImages = cloneArray(session.allImages);
        ui.activeTabId = session.activeTabId || ui.activeTabId || null;
        ui.windowId = session.windowId || ui.windowId || null;
        ui.chatHistory = cloneChatHistory(session.chatHistory);
        ui.isSidePanelHost = options.isSidePanelHost === true;

        if (ui.modelSelect) {
            ui.modelSelect.innerHTML = '';
            ui.availableModels.forEach((model) => {
                const opt = document.createElement('option');
                opt.value = model.value;
                opt.textContent = model.name;
                if (model.value === ui.currentModel) opt.selected = true;
                ui.modelSelect.appendChild(opt);
            });
            ui.modelSelect.value = ui.currentModel;
        }

        if (ui.modeSelect) {
            ui.modeSelect.value = ui.currentMode;
        }

        if (ui.chatBody) {
            ui.chatBody.innerHTML = '';
            ui.chatHistory.forEach((message, index) => {
                renderClonedChatMessage(ui, message, {
                    includeActions: true,
                    messageIndex: index
                });
            });
            ui.chatBody.scrollTop = ui.chatBody.scrollHeight;
        }

        ui.updateDisplayModeButton();
    }

    function isSameRenderedSession(session, ui) {
        return Boolean(
            session?.uiId &&
            session.uiId === ui?.uiId &&
            session.lastUpdated === ui?._lastRenderedTimestamp
        );
    }

    global.SnipAskSession = {
        buildSessionFromApiResponse,
        getResponseModel,
        getSessionModel,
        hydrateFloatingChat,
        isSameRenderedSession,
        mergeSessionWithApiResponse,
        serializeFloatingChat
    };
})(window);
