const activeAbortControllers = new Set();

export function createTrackedAbortController() {
    const controller = new AbortController();
    activeAbortControllers.add(controller);
    return controller;
}

export function removeTrackedController(controller) {
    activeAbortControllers.delete(controller);
}

export function cancelAllActiveRequests() {
    for (const controller of activeAbortControllers) {
        controller.abort();
    }
    activeAbortControllers.clear();
}
