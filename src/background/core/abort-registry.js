const activeAbortControllers = new Set();
const activeAbortControllersById = new Map();
const cancelledRequestIds = new Set();

export function createTrackedAbortController(requestId = null) {
    const controller = new AbortController();
    activeAbortControllers.add(controller);
    if (requestId) {
        activeAbortControllersById.set(requestId, controller);
        if (cancelledRequestIds.has(requestId)) {
            controller.abort();
        }
    }
    return controller;
}

export function removeTrackedController(controller, requestId = null) {
    activeAbortControllers.delete(controller);
    if (requestId && activeAbortControllersById.get(requestId) === controller) {
        activeAbortControllersById.delete(requestId);
        cancelledRequestIds.delete(requestId);
    }
}

export function cancelTrackedRequest(requestId) {
    if (!requestId) {
        cancelAllActiveRequests();
        return;
    }

    const controller = activeAbortControllersById.get(requestId);
    if (controller) {
        controller.abort();
        activeAbortControllers.delete(controller);
        activeAbortControllersById.delete(requestId);
        return;
    }

    cancelledRequestIds.add(requestId);
}

export function cancelAllActiveRequests() {
    for (const controller of activeAbortControllers) {
        controller.abort();
    }
    activeAbortControllers.clear();
    activeAbortControllersById.clear();
    cancelledRequestIds.clear();
}
