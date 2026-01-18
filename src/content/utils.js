// src/content/utils.js

// --- UI Helpers ---

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseMarkdown(text) {
  if (!text) return "";
  const codeBlocks = [];

  // Unique token per parse prevents placeholder collision attacks
  const uniqueToken = crypto.randomUUID();
  const placeholderPrefix = `\x00CB_${uniqueToken}_`;

  // Extract code blocks first to avoid messing up their internal formatting
  text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    // Note: Inline styles are used here because content scripts cannot easily load external CSS files into Shadow DOM
    codeBlocks.push(`<pre style="background: #0d0d0d; color: #cccccc; padding: 10px; border-radius: 6px; overflow-x: auto; border: 1px solid #333; font-family: 'Consolas', monospace; margin: 10px 0;"><code>${escapeHtml(code.trim())}</code></pre>`);
    return `${placeholderPrefix}${codeBlocks.length - 1}\x00`;
  });

  // Build regex pattern for this specific parse session
  const placeholderRegex = new RegExp(`(${placeholderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+\x00)|([\\s\\S]+?)(?=${placeholderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|$)`, 'g');

  // Escape HTML in remaining text to prevent XSS
  // But preserve code block placeholders (which now use unique tokens)
  text = text.replace(placeholderRegex, (match, codeBlock, normalText) => {
    if (codeBlock) return codeBlock;
    return escapeHtml(normalText || '');
  });

  // Highlight the "Answer" label specifically (now safe after escaping)
  text = text.replace(/\*\*Answer:\*\*/g, '<strong style="color: #f55036; font-size: 1.1em;">✓ Answer:</strong>');

  // Build restoration regex for this specific parse session
  const restoreRegex = new RegExp(`${placeholderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\x00`, 'g');

  // Parse standard Markdown syntax
  return text
    .replace(/^#### (.*$)/gim, '<h4 style="margin: 10px 0 5px 0; color: #f55036; font-size: 13px;">$1</h4>')
    .replace(/^### (.*$)/gim, '<h3 style="margin: 15px 0 8px 0; color: #ff8c73; font-size: 14px;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="margin: 20px 0 10px 0; color: #f55036; font-size: 16px; border-bottom: 1px solid #333; padding-bottom: 5px;">$1</h2>')
    .replace(/\*\*(.*?)\*\*/gim, '<b style="color: #ff8c73;">$1</b>')
    .replace(/\*(.*?)\*/gim, '<i>$1</i>')
    .replace(/`(.*?)`/gim, '<code style="background:#333; padding:2px 4px; border-radius:3px; color:#dcdcaa; font-family: monospace;">$1</code>')
    .replace(/\n/g, '<br>')
    // Restore code blocks using session-specific token
    .replace(restoreRegex, (match, index) => codeBlocks[index]);
}

// --- Image Processing ---

// Max dimension to prevent huge payloads on 4K monitors (APIs may reject or timeout)
const MAX_IMAGE_DIMENSION = 1536;

function cropImage(base64Full, rect, callback) {
  const img = new Image();
  img.onload = () => {
    // Handle High DPI (Retina) displays for crisp screenshots
    const pixelRatio = window.devicePixelRatio || 1;

    let cropWidth = rect.width * pixelRatio;
    let cropHeight = rect.height * pixelRatio;

    // Calculate final output dimensions (compress if too large)
    let outputWidth = cropWidth;
    let outputHeight = cropHeight;

    if (outputWidth > MAX_IMAGE_DIMENSION || outputHeight > MAX_IMAGE_DIMENSION) {
      const scale = Math.min(MAX_IMAGE_DIMENSION / outputWidth, MAX_IMAGE_DIMENSION / outputHeight);
      outputWidth = Math.round(outputWidth * scale);
      outputHeight = Math.round(outputHeight * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const ctx = canvas.getContext("2d");

    ctx.drawImage(
      img,
      rect.left * pixelRatio, rect.top * pixelRatio, // Source X, Y
      cropWidth, cropHeight, // Source W, H
      0, 0, // Destination X, Y
      outputWidth, outputHeight // Destination W, H (scaled)
    );

    // Remove the data URL prefix so it's ready for transmission
    callback(canvas.toDataURL("image/jpeg", 0.85).replace(/^data:image\/(png|jpeg);base64,/, ""));
  };
  img.src = base64Full;
}

// --- Loading Indicators ---

// Reference counter for concurrent loading operations
let _loadingCursorCount = 0;

function showLoadingCursor() {
  _loadingCursorCount++;

  // Only create DOM element if it doesn't exist
  if (document.getElementById("groq-loader")) {
    const el = document.getElementById("groq-loader");
    if (_loadingCursorCount > 1) {
      el.innerHTML = `<span>⚡  thinking... (${_loadingCursorCount})</span>`;
    }
    return;
  }

  const el = document.createElement("div");
  el.id = "groq-loader";
  el.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); padding:15px 25px; background:rgba(0,0,0,0.8); color:white; border-radius:8px; z-index:2147483647; font-family:sans-serif; pointer-events: none;";
  el.innerHTML = "<span>⚡  thinking...</span>";
  document.body.appendChild(el);
}

function hideLoadingCursor() {
  _loadingCursorCount = Math.max(0, _loadingCursorCount - 1);

  // Only remove DOM element when ALL operations are complete
  if (_loadingCursorCount === 0) {
    const el = document.getElementById("groq-loader");
    if (el) el.remove();
  } else {
    const el = document.getElementById("groq-loader");
    if (el) {
      el.innerHTML = _loadingCursorCount > 1
        ? `<span>⚡  thinking... (${_loadingCursorCount})</span>`
        : `<span>⚡  thinking...</span>`;
    }
  }
}