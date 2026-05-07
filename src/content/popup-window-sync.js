// Helpers for syncing existing popup windows during side-panel initiated snips.
(function initSnipAskPopupWindows(global) {
    function forEachPopupWindow(callback) {
        if (typeof WindowManager === 'undefined' || !Array.isArray(WindowManager.windows)) {
            return 0;
        }

        let count = 0;
        WindowManager.windows.forEach((windowUi) => {
            callback(windowUi);
            count++;
        });
        return count;
    }

    function hideForSidebarSnip() {
        forEachPopupWindow((windowUi) => {
            if (windowUi.container) {
                windowUi.container.style.display = 'none';
            }
        });
        global._restorePopupWindowsAfterSnip = true;
    }

    function restoreAfterSidebarSnip() {
        if (!global._restorePopupWindowsAfterSnip) return;
        global._restorePopupWindowsAfterSnip = false;

        forEachPopupWindow((windowUi) => {
            if (windowUi.container) {
                windowUi.container.style.display = 'flex';
            }
        });
        WindowManager.refreshLayout?.();
    }

    function broadcastSnippedImage(croppedBase64) {
        let count = 0;
        forEachPopupWindow((windowUi) => {
            if (typeof windowUi._processSnippedImage === 'function') {
                windowUi._processSnippedImage(croppedBase64);
                count++;
            }
        });

        if (count > 0) {
            WindowManager.refreshLayout?.();
        }
        return count;
    }

    global.SnipAskPopupWindows = {
        broadcastSnippedImage,
        hideForSidebarSnip,
        restoreAfterSidebarSnip
    };
})(window);
