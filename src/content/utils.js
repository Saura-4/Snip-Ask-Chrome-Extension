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
    const langLabel = lang ? `<span style="position: absolute; top: 6px; left: 10px; font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.5px;">${lang}</span>` : '';
    codeBlocks.push(`<pre style="position: relative; background: linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 100%); color: #e0e0e0; padding: ${lang ? '28px' : '12px'} 14px 12px 14px; border-radius: 8px; overflow-x: auto; border: 1px solid #2a2a2a; font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace; margin: 12px 0; font-size: 12px; line-height: 1.5; box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);">${langLabel}<code style="font-family: inherit;">${escapeHtml(code.trim())}</code></pre>`);
    return `${placeholderPrefix}${codeBlocks.length - 1}\x00`;
  });

  // Also handle inline code blocks (single backticks on same line) before escaping
  text = text.replace(/```([\s\S]*?)```/g, (match, code) => {
    codeBlocks.push(`<pre style="background: linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 100%); color: #e0e0e0; padding: 12px 14px; border-radius: 8px; overflow-x: auto; border: 1px solid #2a2a2a; font-family: 'JetBrains Mono', 'Consolas', monospace; margin: 12px 0; font-size: 12px; line-height: 1.5;"><code>${escapeHtml(code.trim())}</code></pre>`);
    return `${placeholderPrefix}${codeBlocks.length - 1}\x00`;
  });

  // Build regex pattern for this specific parse session
  const placeholderRegex = new RegExp(`(${placeholderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+\x00)|([\\s\\S]+?)(?=${placeholderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|$)`, 'g');

  // Escape HTML in remaining text to prevent XSS
  text = text.replace(placeholderRegex, (match, codeBlock, normalText) => {
    if (codeBlock) return codeBlock;
    return escapeHtml(normalText || '');
  });

  // Highlight the "Answer" label specifically
  text = text.replace(/\*\*Answer:\*\*/g, '<span style="display: inline-flex; align-items: center; gap: 6px; color: #4ade80; font-weight: 600; font-size: 1.05em;"><span style="background: #22543d; padding: 2px 6px; border-radius: 4px;">✓</span> Answer:</span>');

  // Build restoration regex for this specific parse session
  const restoreRegex = new RegExp(`${placeholderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\x00`, 'g');

  // Parse standard Markdown syntax
  text = text
    // Headers with improved styling
    .replace(/^#### (.*$)/gim, '<h4 style="margin: 14px 0 8px 0; color: #94a3b8; font-size: 13px; font-weight: 600; letter-spacing: 0.3px;">$1</h4>')
    .replace(/^### (.*$)/gim, '<h3 style="margin: 16px 0 10px 0; color: #e2e8f0; font-size: 14px; font-weight: 600;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="margin: 20px 0 12px 0; color: #f8fafc; font-size: 16px; font-weight: 700; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 style="margin: 22px 0 14px 0; color: #f8fafc; font-size: 18px; font-weight: 700; border-bottom: 2px solid #f55036; padding-bottom: 8px;">$1</h1>')
    // Horizontal rules
    .replace(/^---$/gim, '<hr style="border: none; height: 1px; background: linear-gradient(90deg, transparent, #444, transparent); margin: 16px 0;">')
    .replace(/^\*\*\*$/gim, '<hr style="border: none; height: 1px; background: linear-gradient(90deg, transparent, #444, transparent); margin: 16px 0;">')
    // Blockquotes with improved styling
    .replace(/^&gt;\s?(.*)$/gim, '<blockquote style="border-left: 3px solid #f55036; margin: 12px 0; padding: 8px 16px; color: #a1a1aa; background: linear-gradient(90deg, rgba(245, 80, 54, 0.08), transparent); border-radius: 0 6px 6px 0; font-style: italic;">$1</blockquote>')
    // Strikethrough
    .replace(/~~(.*?)~~/gim, '<del style="color: #71717a; text-decoration: line-through;">$1</del>')
    // Links (after HTML escaping, so we look for escaped URLs)
    .replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener" style="color: #60a5fa; text-decoration: none; border-bottom: 1px dotted #60a5fa;">$1</a>')
    // Bold with accent color
    .replace(/\*\*(.*?)\*\*/gim, '<strong style="color: #f0f0f0; font-weight: 600;">$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/gim, '<em style="color: #d4d4d8;">$1</em>')
    // Inline code with improved styling
    .replace(/`(.*?)`/gim, '<code style="background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; color: #fbbf24; font-family: \'JetBrains Mono\', monospace; font-size: 0.9em; border: 1px solid rgba(255,255,255,0.06);">$1</code>');

  // Process lists with improved bullet styling
  const lines = text.split('\n');
  let inList = false;
  let listType = null;
  const processedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ulMatch = line.match(/^[\*\-\+]\s+(.*)$/);
    const olMatch = line.match(/^\d+\.\s+(.*)$/);

    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
        processedLines.push('<ul style="margin: 10px 0; padding-left: 8px; list-style: none;">');
        inList = true;
        listType = 'ul';
      }
      // Custom bullet point with accent color
      processedLines.push(`<li style="margin: 6px 0; padding-left: 20px; position: relative; color: #e4e4e7; line-height: 1.6;"><span style="position: absolute; left: 0; color: #f55036; font-weight: bold;">•</span>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
        processedLines.push('<ol style="margin: 10px 0; padding-left: 8px; list-style: none; counter-reset: item;">');
        inList = true;
        listType = 'ol';
      }
      // Custom numbered list with accent color
      processedLines.push(`<li style="margin: 6px 0; padding-left: 24px; position: relative; color: #e4e4e7; line-height: 1.6; counter-increment: item;"><span style="position: absolute; left: 0; color: #f55036; font-weight: 600; font-size: 0.9em;"></span>${olMatch[1]}</li>`);
    } else {
      if (inList) {
        processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
        listType = null;
      }
      processedLines.push(line);
    }
  }

  if (inList) {
    processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
  }

  text = processedLines.join('\n');

  // Convert newlines to breaks, but be smarter about paragraph spacing
  text = text.replace(/\n\n+/g, '</p><p style="margin: 12px 0;">');
  text = text.replace(/\n/g, '<br>');

  // Clean up breaks around block elements
  text = text.replace(/<br>(<\/?(?:ul|ol|li|h[1-6]|blockquote|pre|hr|p))/gi, '$1');
  text = text.replace(/(<\/(?:ul|ol|li|h[1-6]|blockquote|pre|hr|p)>)<br>/gi, '$1');

  // Restore code blocks
  text = text.replace(restoreRegex, (match, index) => codeBlocks[index]);

  // Wrap in a styled container for consistent typography
  return `<div style="font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif; line-height: 1.65; color: #d4d4d8;">${text}</div>`;
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