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

// Sanitize language identifier to prevent XSS via malformed code fence labels
// Only allows alphanumeric, underscore, and hyphen (covers all valid language identifiers)
function sanitizeLanguage(lang) {
  return (lang || 'text').replace(/[^a-zA-Z0-9_-]/g, '');
}

// DOMPurify configuration for safe HTML rendering
// Allows styling and safe elements needed for markdown rendering
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'div', 'span', 'p', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'del', 's', 'u',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'pre', 'code', 'blockquote',
    'a', 'button', 'svg', 'rect', 'path', 'line', 'polyline', 'circle'
  ],
  ALLOWED_ATTR: [
    'style', 'class', 'id', 'href', 'target', 'rel', 'title',
    'width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width',
    'stroke-linecap', 'stroke-linejoin', 'd', 'x', 'y', 'rx', 'ry',
    'x1', 'y1', 'x2', 'y2', 'points', 'cx', 'cy', 'r'
  ],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['target'], // Allow target="_blank" on links
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur']
};

/**
 * Sanitize HTML using DOMPurify if available, otherwise return as-is
 * This provides defense-in-depth against XSS attacks
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML
 */
function sanitizeHtml(html) {
  if (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) {
    return DOMPurify.sanitize(html, DOMPURIFY_CONFIG);
  }
  // Fallback: return as-is (our manual escaping should still protect)
  return html;
}

function parseMarkdown(text) {
  if (!text) return "";
  const codeBlocks = [];

  // Unique token per parse prevents placeholder collision attacks
  const uniqueToken = crypto.randomUUID();
  const placeholderPrefix = `\x00CB_${uniqueToken}_`;

  // --- STEP 1: Extract fenced code blocks into placeholders ---
  // This prevents their internal content from being affected by other parsing.
  // Regex supports both:
  //   ```lang\ncode\n``` (multiline with newline after fence)
  //   ```lang code``` (single-line without newline)
  text = text.replace(/```(\w+)?[ \t]*\n?([\s\S]*?)```/g, (match, lang, code) => {
    const language = sanitizeLanguage(lang);
    const blockHtml = `
      <div class="code-block-wrapper" style="background: #0d0d0d; border: 1px solid #333; border-radius: 8px; overflow: hidden; margin: 10px 0; font-family: 'JetBrains Mono', monospace;">
        <div class="code-header" style="display: flex; justify-content: space-between; align-items: center; background: #1a1a1a; padding: 6px 12px; border-bottom: 1px solid #333;">
            <span class="lang-label" style="font-size: 10px; color: #666; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">${language}</span>
            <button class="copy-btn" style="background: transparent; border: none; color: #888; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                Copy
            </button>
        </div>
        <pre><code class="language-${language}" style="display: block; padding: 12px; overflow-x: auto; color: #ccc; font-size: 12px; margin: 0;">${escapeHtml(code.trim())}</code></pre>
      </div>`;

    codeBlocks.push(blockHtml);
    return `${placeholderPrefix}${codeBlocks.length - 1}\x00`;
  });

  // Handle unclosed code fences (message ends with ``` but no closing)
  text = text.replace(/```(\w+)?[ \t]*\n?([\s\S]*)$/g, (match, lang, code) => {
    // Only match if there's actual code content (not just the fence at the end)
    if (!code || code.trim().length === 0) return match;
    const language = sanitizeLanguage(lang);
    const blockHtml = `
      <div class="code-block-wrapper" style="background: #0d0d0d; border: 1px solid #333; border-radius: 8px; overflow: hidden; margin: 10px 0; font-family: 'JetBrains Mono', monospace;">
        <div class="code-header" style="display: flex; justify-content: space-between; align-items: center; background: #1a1a1a; padding: 6px 12px; border-bottom: 1px solid #333;">
            <span class="lang-label" style="font-size: 10px; color: #666; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">${language}</span>
            <button class="copy-btn" style="background: transparent; border: none; color: #888; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                Copy
            </button>
        </div>
        <pre><code class="language-${language}" style="display: block; padding: 12px; overflow-x: auto; color: #ccc; font-size: 12px; margin: 0;">${escapeHtml(code.trim())}</code></pre>
      </div>`;
    codeBlocks.push(blockHtml);
    return `${placeholderPrefix}${codeBlocks.length - 1}\x00`;
  });

  // --- STEP 1b: Extract LaTeX math into placeholders ---
  // Handles \[...\], $$...$$, \(...\), and $...$
  const mathBlocks = [];
  const mathPlaceholderPrefix = `\x00MATH_${uniqueToken}_`;

  // Helper to render math (uses KaTeX if available, otherwise styled display)
  const renderMath = (mathContent, isBlock) => {
    // Try KaTeX if available (loaded globally)
    if (typeof katex !== 'undefined') {
      try {
        return katex.renderToString(mathContent, {
          displayMode: isBlock,
          throwOnError: false,
          output: 'html'
        });
      } catch (e) {
        // Fall through to styled fallback
      }
    }

    // Styled fallback - display math in a monospace container
    const escapedMath = escapeHtml(mathContent);
    if (isBlock) {
      return `<div class="math-block" style="background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 6px; padding: 12px 16px; margin: 10px 0; font-family: 'JetBrains Mono', 'Cambria Math', serif; color: #c4b5fd; overflow-x: auto; text-align: center;">
        <span style="font-size: 10px; color: #8b5cf6; display: block; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Math</span>
        ${escapedMath}
      </div>`;
    } else {
      return `<code class="math-inline" style="background: rgba(139, 92, 246, 0.15); padding: 2px 6px; border-radius: 4px; color: #c4b5fd; font-family: 'JetBrains Mono', 'Cambria Math', serif; font-size: 0.95em; border: 1px solid rgba(139, 92, 246, 0.2);">${escapedMath}</code>`;
    }
  };

  // Block math: \[...\]
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (match, math) => {
    const mathHtml = renderMath(math.trim(), true);
    mathBlocks.push(mathHtml);
    return `${mathPlaceholderPrefix}${mathBlocks.length - 1}\x00`;
  });

  // Block math: $$...$$
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
    const mathHtml = renderMath(math.trim(), true);
    mathBlocks.push(mathHtml);
    return `${mathPlaceholderPrefix}${mathBlocks.length - 1}\x00`;
  });

  // Inline math: \(...\)
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (match, math) => {
    const mathHtml = renderMath(math.trim(), false);
    mathBlocks.push(mathHtml);
    return `${mathPlaceholderPrefix}${mathBlocks.length - 1}\x00`;
  });

  // Inline math: $...$ (be careful not to match currency like $100)
  // Only match if not preceded by a digit or followed by a digit
  text = text.replace(/(?<!\d)\$([^\$\n]+?)\$(?!\d)/g, (match, math) => {
    // Skip if it looks like currency (just numbers with optional commas/decimals)
    if (/^[\d,.\s]+$/.test(math.trim())) return match;
    const mathHtml = renderMath(math.trim(), false);
    mathBlocks.push(mathHtml);
    return `${mathPlaceholderPrefix}${mathBlocks.length - 1}\x00`;
  });

  // --- STEP 2: Escape HTML in the remaining text (excluding placeholders) ---
  // This is done BEFORE any other markdown parsing to prevent XSS.
  const escapedMathPrefix = mathPlaceholderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const placeholderRegex = new RegExp(`(${placeholderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+\\x00)|(${escapedMathPrefix}\\d+\\x00)|([\\s\\S]+?)(?=${placeholderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${escapedMathPrefix}|$)`, 'g');
  text = text.replace(placeholderRegex, (match, codeBlock, mathBlock, normalText) => {
    if (codeBlock || mathBlock) return match;
    return escapeHtml(normalText || '');
  });

  // --- STEP 3: Convert inline backticks to <code> tags ---
  // This happens AFTER escaping, so the HTML we generate here won't be escaped.
  // We match the escaped backticks: &#039; is the escaped single quote. Backticks are not escaped by escapeHtml.
  text = text.replace(/`([^`]+)`/g, (match, code) => {
    return `<code style="background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; color: #fbbf24; font-family: 'JetBrains Mono', monospace; font-size: 0.9em; border: 1px solid rgba(255,255,255,0.06);">${code}</code>`;
  });

  // Highlight the "Answer" label specifically
  text = text.replace(/\*\*Answer:\*\*/g, '<span style="display: inline-flex; align-items: center; gap: 6px; color: #4ade80; font-weight: 600; font-size: 1.05em;"><span style="background: #22543d; padding: 2px 6px; border-radius: 4px;">✓</span> Answer:</span>');

  // --- STEP 4: Markdown Tables ---
  // Note: Pipes `|` are not escaped by escapeHtml(); they remain literal.
  const tableRegex = /^\|(.+)\|\n\|([-:| ]+)\|\n((?:\|.*\|\n?)*)/gm;

  text = text.replace(tableRegex, (match, headerRow, separatorRow, bodyRows) => {
    const headers = headerRow.split('|').filter(cell => cell.trim() !== '').map(cell => cell.trim());
    const alignMap = separatorRow.split('|').filter(cell => cell.trim() !== '').map(cell => {
      const trimmed = cell.trim();
      if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
      if (trimmed.endsWith(':')) return 'right';
      return 'left';
    });

    const rows = bodyRows.trim().split('\n').map(row =>
      row.split('|').filter(cell => cell.trim() !== '').map(cell => cell.trim())
    );

    let tableHtml = '<div class="table-container" style="overflow-x: auto; border-radius: 8px; border: 1px solid #333; background: #111; margin: 10px 0;"><table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;"><thead><tr>';

    headers.forEach((header, i) => {
      tableHtml += `<th style="background: #1f1f1f; padding: 10px 12px; color: #aaa; font-weight: 600; border-bottom: 1px solid #333; text-align: ${alignMap[i] || 'left'};">${header}</th>`;
    });

    tableHtml += '</tr></thead><tbody>';

    rows.forEach(row => {
      tableHtml += '<tr>';
      row.forEach((cell, i) => {
        tableHtml += `<td style="padding: 10px 12px; border-bottom: 1px solid #222; color: #ddd; text-align: ${alignMap[i] || 'left'};">${cell}</td>`;
      });
      tableHtml += '</tr>';
    });

    tableHtml += '</tbody></table></div>';
    return tableHtml;
  });


  // Build restoration regex for this specific parse session
  const restoreRegex = new RegExp(`${placeholderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\x00`, 'g');
  const mathRestoreRegex = new RegExp(`${mathPlaceholderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\x00`, 'g');

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
    // Blockquotes with improved styling (look for &gt; which is escaped >)
    .replace(/^&gt;\s?(.*)$/gim, '<blockquote style="border-left: 3px solid #f55036; margin: 12px 0; padding: 8px 16px; color: #a1a1aa; background: linear-gradient(90deg, rgba(245, 80, 54, 0.08), transparent); border-radius: 0 6px 6px 0; font-style: italic;">$1</blockquote>')
    // Strikethrough
    .replace(/~~(.*?)~~/gim, '<del style="color: #71717a; text-decoration: line-through;">$1</del>')
    // Links (after HTML escaping, so we look for escaped URLs)
    .replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener" style="color: #60a5fa; text-decoration: none; border-bottom: 1px dotted #60a5fa;">$1</a>')
    // Bold with accent color
    .replace(/\*\*(.*?)\*\*/gim, '<strong style="color: #f0f0f0; font-weight: 600;">$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/gim, '<em style="color: #d4d4d8;">$1</em>');

  // Process lists with improved bullet styling
  const lines = text.split('\n');
  let inList = false;
  let listType = null;
  const processedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip if line already part of a table or code block placeholder
    if (line.includes(placeholderPrefix) || line.includes('class="table-container"')) {
      processedLines.push(line);
      continue;
    }

    // Match list items (after escaping, * is still *)
    const ulMatch = line.match(/^[\*\-\+]\s+(.*)$/);
    const olMatch = line.match(/^\d+\.\s+(.*)$/);

    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
        processedLines.push('<ul style="margin: 10px 0; padding-left: 8px; list-style: none;">');
        inList = true;
        listType = 'ul';
      }
      processedLines.push(`<li style="margin: 6px 0; padding-left: 20px; position: relative; color: #e4e4e7; line-height: 1.6;"><span style="position: absolute; left: 0; color: #f55036; font-weight: bold;">•</span>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
        processedLines.push('<ol style="margin: 10px 0; padding-left: 8px; list-style: none; counter-reset: item;">');
        inList = true;
        listType = 'ol';
      }
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

  // Convert newlines to breaks
  text = text.replace(/\n\n+/g, (match) => {
    return '</p><p style="margin: 12px 0;">';
  });
  text = text.replace(/\n/g, '<br>');

  // Clean up breaks around block elements
  text = text.replace(/<br>(<\/?(?:ul|ol|li|h[1-6]|blockquote|pre|hr|p|div|table|thead|tbody|tr|th|td))/gi, '$1');
  text = text.replace(/(<\/(?:ul|ol|li|h[1-6]|blockquote|pre|hr|p|div|table|thead|tbody|tr|th|td)>)<br>/gi, '$1');

  // Restore code blocks
  text = text.replace(restoreRegex, (match, index) => codeBlocks[index]);

  // Restore math blocks
  text = text.replace(mathRestoreRegex, (match, index) => mathBlocks[index]);

  // Wrap in a styled container for consistent typography
  const rawHtml = `<div style="font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif; line-height: 1.65; color: #d4d4d8;">${text}</div>`;

  // Final sanitization through DOMPurify for defense-in-depth
  return sanitizeHtml(rawHtml);
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

