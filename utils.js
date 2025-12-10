// utils.js

function escapeHtml(unsafe) 
{
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function parseMarkdown(text) 
{
  if (!text) return "";
  const codeBlocks = [];
  text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    // Note: The styles below are INJECTED HTML styles, which is fine for content scripts
    codeBlocks.push(`<pre style="background: #0d0d0d; color: #cccccc; padding: 10px; border-radius: 6px; overflow-x: auto; border: 1px solid #333; font-family: 'Consolas', monospace; margin: 10px 0;"><code>${escapeHtml(code.trim())}</code></pre>`);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`; 
  });

  text = text.replace(/\*\*Answer:\*\*/g, '<strong style="color: #f55036; font-size: 1.1em;">✓ Answer:</strong>');

  return text
    .replace(/^#### (.*$)/gim, '<h4 style="margin: 10px 0 5px 0; color: #f55036; font-size: 13px;">$1</h4>')
    .replace(/^### (.*$)/gim, '<h3 style="margin: 15px 0 8px 0; color: #ff8c73; font-size: 14px;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="margin: 20px 0 10px 0; color: #f55036; font-size: 16px; border-bottom: 1px solid #333; padding-bottom: 5px;">$1</h2>')
    .replace(/\*\*(.*?)\*\*/gim, '<b style="color: #ff8c73;">$1</b>')
    .replace(/\*(.*?)\*/gim, '<i>$1</i>')
    .replace(/`(.*?)`/gim, '<code style="background:#333; padding:2px 4px; border-radius:3px; color:#dcdcaa; font-family: monospace;">$1</code>')
    .replace(/\n/g, '<br>')
    .replace(/__CODE_BLOCK_(\d+)__/g, (match, index) => codeBlocks[index]);
}

function cropImage(base64Full, rect, callback)
 {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = rect.width * pixelRatio;
    canvas.height = rect.height * pixelRatio;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, rect.left * pixelRatio, rect.top * pixelRatio, rect.width * pixelRatio, rect.height * pixelRatio, 0, 0, canvas.width, canvas.height);
    callback(canvas.toDataURL("image/jpeg").replace(/^data:image\/(png|jpeg);base64,/, ""));
  };
  img.src = base64Full;
}

function showLoadingCursor() 
{
  const el = document.createElement("div");
  el.id = "groq-loader";
  el.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); padding:15px 25px; background:rgba(0,0,0,0.8); color:white; border-radius:8px; z-index:2147483647; font-family:sans-serif;";
  el.innerText = "Groq is thinking...";
  document.body.appendChild(el);
}

function hideLoadingCursor() 
{
  const el = document.getElementById("groq-loader");
  if (el) el.remove();
}