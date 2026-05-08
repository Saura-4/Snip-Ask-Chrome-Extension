// src/content/snip-selection.js
// Screen snipping/selection logic - glass pane, selection box, mouse handling

/**
 * SnipSelection - Manages the screen snipping UI and interaction
 */
const SnipSelection = {
    /** @type {boolean} Is selection in progress */
    isSelecting: false,

    /** @type {HTMLElement|null} Glass pane overlay */
    glassPane: null,

    /** @type {HTMLElement|null} Selection box element */
    selectionBox: null,

    /** @type {number} Start X coordinate */
    startX: 0,

    /** @type {number} Start Y coordinate */
    startY: 0,

    /** @type {number|null} Safety timeout ID */
    safetyTimeout: null,

    /** @type {Function|null} Callback when selection completes */
    onComplete: null,

    /**
     * Wait until browser has painted after removing selection UI.
     * This prevents captureVisibleTab from grabbing the orange selection layer.
     * @param {Function} callback
     */
    waitForOverlayRemoval(callback) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setTimeout(callback, 0);
            });
        });
    },

    /**
     * Start the snipping process
     * @param {Function} onComplete - Callback(rect) when selection completes
     */
    start(onComplete) {
        if (this.isSelecting) return;
        this.isSelecting = true;
        this.onComplete = onComplete;

        this.createGlassPane();
        this.createSelectionBox();
    },

    /**
     * Create the glass pane overlay
     */
    createGlassPane() {
        this.glassPane = document.createElement("div");
        this.glassPane.setAttribute("tabindex", "-1");

        this.glassPane.style.cssText = `
            position: fixed; 
            top: 0; left: 0; 
            width: 100vw; height: 100vh; 
            z-index: 2147483647; 
            cursor: crosshair; 
            background: rgba(0,0,0,0.01); 
            transform: translateZ(100px);
            outline: none;
        `;

        document.documentElement.appendChild(this.glassPane);
        this.glassPane.focus();

        // Bind event handlers
        this._onMouseDown = this.onMouseDown.bind(this);
        this._onKeyDown = this.onKeyDown.bind(this);

        this.glassPane.addEventListener("mousedown", this._onMouseDown);
        this.glassPane.addEventListener("keydown", this._onKeyDown);

        // Visual cancel button
        const cancelBtn = document.createElement("button");
        cancelBtn.id = "snip-cancel-btn";
        cancelBtn.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6 6 18"></path>
                <path d="m6 6 12 12"></path>
            </svg>
            <span>Cancel</span>
            <span style="opacity: 0.6; font-size: 10px;">Esc</span>
        `;
        cancelBtn.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 2147483647;
            background: rgba(16,16,16,0.92);
            color: #b8b8b8;
            border: 1px solid rgba(255,255,255,0.12);
            padding: 7px 12px;
            border-radius: 999px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            box-shadow: 0 10px 28px rgba(0,0,0,0.32);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            line-height: 1;
            min-height: 32px;
            transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
        `;
        cancelBtn.onmouseenter = () => {
            cancelBtn.style.background = 'rgba(255,255,255,0.08)';
            cancelBtn.style.borderColor = 'rgba(255,255,255,0.18)';
            cancelBtn.style.color = '#e5e7eb';
        };
        cancelBtn.onmouseleave = () => {
            cancelBtn.style.background = 'rgba(16,16,16,0.92)';
            cancelBtn.style.borderColor = 'rgba(255,255,255,0.12)';
            cancelBtn.style.color = '#b8b8b8';
            cancelBtn.style.transform = 'none';
        };
        cancelBtn.onmousedown = (event) => {
            event.preventDefault();
            event.stopPropagation();
            cancelBtn.style.transform = 'scale(0.96)';
        };
        cancelBtn.onmouseup = () => {
            cancelBtn.style.transform = 'none';
        };
        cancelBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.cancel();
        };
        this.glassPane.appendChild(cancelBtn);

        // Safety timeout: auto-cancel after 30 seconds
        this.safetyTimeout = setTimeout(() => {
            if (this.glassPane && this.isSelecting) {
                console.warn("Snip & Ask: Safety timeout triggered - cancelling snip mode");
                this.cancel();
                if (typeof showErrorToast === 'function') {
                    showErrorToast("Snip mode timed out after 30 seconds. Click the extension icon to try again.");
                }
            }
        }, 30000);
    },

    /**
     * Create the selection box element
     */
    createSelectionBox() {
        if (this.selectionBox) this.selectionBox.remove();
        this.selectionBox = document.createElement("div");
        this.selectionBox.style.cssText = `
            position: fixed; 
            border: 2px solid #f55036; 
            background-color: rgba(245, 80, 54, 0.2); 
            z-index: 2147483647; 
            pointer-events: none; 
            display: none;
        `;
        document.body.appendChild(this.selectionBox);
    },

    /**
     * Handle key down events
     * @param {KeyboardEvent} e
     */
    onKeyDown(e) {
        if (e.key === "Escape") {
            this.cancel();
        }
    },

    /**
     * Handle mouse down event
     * @param {MouseEvent} e
     */
    onMouseDown(e) {
        if (!this.isSelecting) return;
        e.preventDefault();
        e.stopPropagation();

        this.startX = e.clientX;
        this.startY = e.clientY;

        this.selectionBox.style.left = this.startX + "px";
        this.selectionBox.style.top = this.startY + "px";
        this.selectionBox.style.width = "0px";
        this.selectionBox.style.height = "0px";
        this.selectionBox.style.display = "block";

        this._onMouseMove = this.onMouseMove.bind(this);
        this._onMouseUp = this.onMouseUp.bind(this);

        this.glassPane.addEventListener("mousemove", this._onMouseMove);
        this.glassPane.addEventListener("mouseup", this._onMouseUp);
    },

    /**
     * Handle mouse move event
     * @param {MouseEvent} e
     */
    onMouseMove(e) {
        const currentX = e.clientX;
        const currentY = e.clientY;

        const width = Math.abs(currentX - this.startX);
        const height = Math.abs(currentY - this.startY);
        const left = Math.min(currentX, this.startX);
        const top = Math.min(currentY, this.startY);

        this.selectionBox.style.width = width + "px";
        this.selectionBox.style.height = height + "px";
        this.selectionBox.style.left = left + "px";
        this.selectionBox.style.top = top + "px";
    },

    /**
     * Handle mouse up event - complete selection
     * @param {MouseEvent} e
     */
    onMouseUp(e) {
        // Remove listeners
        this.glassPane.removeEventListener("mousemove", this._onMouseMove);
        this.glassPane.removeEventListener("mouseup", this._onMouseUp);
        this.glassPane.removeEventListener("mousedown", this._onMouseDown);

        const rect = this.selectionBox.getBoundingClientRect();

        // Clean up UI
        this.selectionBox.remove();
        this.glassPane.remove();
        this.selectionBox = null;
        this.glassPane = null;
        this.isSelecting = false;

        // Clear safety timeout
        if (this.safetyTimeout) {
            clearTimeout(this.safetyTimeout);
            this.safetyTimeout = null;
        }

        // Minimum size check
        if (rect.width < 10 || rect.height < 10) {
            window.restoreSnipAskPopupWindows?.();
            return;
        }

        // Call completion callback
        const completionCallback = this.onComplete;
        this.onComplete = null;
        if (completionCallback) {
            this.waitForOverlayRemoval(() => {
                completionCallback(rect);
            });
        }
    },

    /**
     * Cancel the current snipping operation
     */
    cancel() {
        // Clear safety timeout
        if (this.safetyTimeout) {
            clearTimeout(this.safetyTimeout);
            this.safetyTimeout = null;
        }

        // Clean up selection UI
        if (this.selectionBox) {
            this.selectionBox.remove();
            this.selectionBox = null;
        }
        if (this.glassPane) {
            this.glassPane.removeEventListener("mousedown", this._onMouseDown);
            this.glassPane.removeEventListener("mousemove", this._onMouseMove);
            this.glassPane.removeEventListener("mouseup", this._onMouseUp);
            this.glassPane.removeEventListener("keydown", this._onKeyDown);
            this.glassPane.remove();
            this.glassPane = null;
        }
        this.isSelecting = false;
        this.onComplete = null;
        window.restoreSnipAskPopupWindows?.();

        // If in snip-again mode, restore chat windows
        if (window._snipAgainMode) {
            window._snipAgainMode = false;
            window._snipAgainTarget = null;
            if (typeof WindowManager !== 'undefined') {
                WindowManager.windows.forEach(w => {
                    if (w.container) w.container.style.display = 'flex';
                });
            }
        }
    },

    /**
     * Check if currently selecting
     * @returns {boolean}
     */
    isActive() {
        return this.isSelecting;
    }
};
