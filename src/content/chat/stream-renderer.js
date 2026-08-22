// src/content/chat/stream-renderer.js
// Typewriter-paced streaming renderer.
//
// Provider deltas arrive in bursts (Groq especially). Rendering them the
// moment they land makes text jump in blobs, and re-rendering markdown
// mid-token makes the active paragraph shape-shift (**bold**, half links).
//
// Instead, arrival is decoupled from display:
//   - Deltas buffer into the full target text.
//   - A rAF loop reveals characters at an adaptive rate (large enough to
//     drain bursts quickly, small enough to always look like smooth typing).
//   - Text up to the reveal point is split into "stable" blank-line-separated
//     blocks outside code fences; each is parsed to markdown exactly once.
//   - The active region renders as plain pre-wrap text with an inline caret,
//     so nothing re-flows until its block closes and formats once.

/**
 * Split streamed text into completed blocks plus the active tail.
 * A block is closed by a blank line that sits outside a code fence.
 * @param {string} text
 */
function splitStreamBlocks(text) {
    const blocks = [];
    let current = [];
    let inFence = false;
    const lines = text.split('\n');

    for (const line of lines) {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            current.push(line);
            continue;
        }
        if (!inFence && line.trim() === '') {
            if (current.length > 0) {
                blocks.push(current.join('\n'));
                current = [];
            }
            continue;
        }
        current.push(line);
    }

    return { blocks, tail: current.join('\n') };
}

/**
 * Create a streaming renderer bound to a container element.
 * @param {HTMLElement} container - Host for the streamed message content
 * @param {{onRender?: Function, onSettled?: Function}} options
 */
function createSnipAskStreamRenderer(container, options = {}) {
    const stableHost = document.createElement('div');
    stableHost.className = 'sa-stream-stable';
    const tailHost = document.createElement('div');
    tailHost.className = 'sa-stream-tail';
    tailHost.style.whiteSpace = 'pre-wrap';

    const caretSpan = document.createElement('span');
    caretSpan.className = 'sa-stream-caret';
    caretSpan.textContent = '▍';

    container.appendChild(stableHost);
    container.appendChild(tailHost);

    let fullText = '';
    let displayedChars = 0;
    let renderedBlocks = 0;
    let rafId = null;
    let completeRequested = false;
    let settledFired = false;

    // Reveal pacing: display lag stays around REVEAL_LAG behind arrival,
    // with a minimum throughput floor so bursts never trickle out slowly.
    const REVEAL_LAG_SECONDS = 0.13;
    const MIN_REVEAL_CHARS_PER_SECOND = 480;
    let lastFrameTs = 0;

    function renderFrame(ts) {
        rafId = null;

        const backlog = fullText.length - displayedChars;
        if (backlog > 0) {
            if (completeRequested) {
                displayedChars = fullText.length;
            } else {
                const dt = lastFrameTs ? Math.min(0.05, Math.max(0.005, (ts - lastFrameTs) / 1000)) : 0.0166;
                const step = Math.max(
                    Math.ceil(backlog * dt / REVEAL_LAG_SECONDS),
                    Math.ceil(MIN_REVEAL_CHARS_PER_SECOND * dt)
                );
                displayedChars = Math.min(fullText.length, displayedChars + step);
            }
        }
        lastFrameTs = ts;

        const visibleText = fullText.slice(0, displayedChars);
        const { blocks, tail } = splitStreamBlocks(visibleText);

        for (let i = renderedBlocks; i < blocks.length; i++) {
            const blockDiv = document.createElement('div');
            if (typeof parseMarkdown === 'function') {
                blockDiv.innerHTML = parseMarkdown(blocks[i]);
            } else {
                blockDiv.textContent = blocks[i];
            }
            stableHost.appendChild(blockDiv);
        }
        renderedBlocks = blocks.length;

        // Active region: plain text only — no partial-markdown reflow.
        tailHost.textContent = tail;
        const showCaret = !completeRequested || tail.length > 0 || backlog > 0;
        if (showCaret) tailHost.appendChild(caretSpan);

        if (typeof options.onRender === 'function') options.onRender();

        if (displayedChars < fullText.length) {
            rafId = requestAnimationFrame(renderFrame);
            return;
        }

        if (completeRequested && !settledFired) {
            settledFired = true;
            caretSpan.remove();
            if (typeof options.onSettled === 'function') options.onSettled();
        }
    }

    function schedule() {
        if (rafId == null) rafId = requestAnimationFrame(renderFrame);
    }

    return {
        /** Buffer the latest accumulated stream text. */
        update(text) {
            fullText = text || '';
            schedule();
        },
        /** Fast-forward the reveal to the end, then fire onSettled. */
        complete() {
            completeRequested = true;
            schedule();
        },
        destroy() {
            if (rafId != null) cancelAnimationFrame(rafId);
            rafId = null;
            stableHost.remove();
            tailHost.remove();
        }
    };
}
