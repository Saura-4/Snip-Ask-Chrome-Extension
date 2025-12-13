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


// ------------------ OCR (Tesseract.js v6) ------------------

let tesseractWorker = null;
let tesseractReady = false;

// Preprocess image (resize + grayscale)
// Improved preprocessBase64 for better handwriting OCR
async function preprocessBase64(base64Full, maxDim = 1600, upscaleFactor = 2) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      try {
        // 1) upscale so small text becomes readable
        const rawW = img.width;
        const rawH = img.height;
        const scaleRatio = Math.min(1, maxDim / Math.max(rawW, rawH));
        // allow upscaleFactor to blow it up for tiny text
        const w = Math.round(rawW * scaleRatio * upscaleFactor);
        const h = Math.round(rawH * scaleRatio * upscaleFactor);

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(64, w); // keep reasonable min size
        canvas.height = Math.max(64, h);
        const ctx = canvas.getContext("2d");

        // Draw original into upscaled canvas (this performs a simple cubic smoothing in browsers)
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Get image data
        let id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let data = id.data;

        // Convert to grayscale + collect luminance histogram
        const lum = new Uint8ClampedArray((canvas.width * canvas.height) | 0);
        const hist = new Uint32Array(256);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          // luminosity
          const L = Math.round(0.21 * r + 0.72 * g + 0.07 * b);
          lum[j] = L;
          hist[L] = (hist[L] || 0) + 1;
        }

        // Contrast stretch: find low/high percentiles to ignore outliers
        const total = canvas.width * canvas.height;
        let csum = 0;
        let low = 0, high = 255;
        const lowPct = 0.005 * total;  // 0.5%
        const highPct = 0.995 * total; // 99.5%
        for (let i = 0; i < 256; i++) {
          csum += hist[i];
          if (csum >= lowPct) { low = i; break; }
        }
        csum = 0;
        for (let i = 255; i >= 0; i--) {
          csum += hist[i];
          if (csum >= (total - highPct)) { high = i; break; }
        }
        // Avoid division by zero
        const denom = Math.max(1, (high - low));
        // Apply contrast stretch to RGB data
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          let v = lum[j];
          v = Math.min(255, Math.max(0, Math.round((v - low) * 255 / denom)));
          data[i] = data[i + 1] = data[i + 2] = v;
        }
        ctx.putImageData(id, 0, 0);

        // Re-get image data after stretch
        id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        data = id.data;

        // Unsharp mask (simple kernel)
        const copy = new Uint8ClampedArray(id.data); // copy
        const w2 = canvas.width, h2 = canvas.height;
        // unsharp kernel: original + amount*(original - blurred)
        const radius = 1; // small radius for light sharpen
        const amount = 0.8; // sharpening strength
        // simple box blur + subtract (fast approximate)
        for (let y = 1; y < h2 - 1; y++) {
          for (let x = 1; x < w2 - 1; x++) {
            const idx = (y * w2 + x) * 4;
            // blur neighbors luminance
            const neighbors = (
              copy[idx - 4] + copy[idx + 4] + copy[idx - w2 * 4] + copy[idx + w2 * 4]
            ) / 4;
            const orig = copy[idx];
            const sharpened = Math.round(orig + amount * (orig - neighbors));
            const v = Math.max(0, Math.min(255, sharpened));
            data[idx] = data[idx + 1] = data[idx + 2] = v;
          }
        }
        ctx.putImageData(id, 0, 0);

        // Adaptive mean thresholding (fast)
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = imgData.data;
        const W = canvas.width, H = canvas.height;
        const blockSize = Math.max(16, Math.floor(Math.min(W, H) / 16)); // dynamic block size
        // integral image for fast mean per block
        const integral = new Uint32Array((W + 1) * (H + 1));
        for (let y = 0; y < H; y++) {
          let rowSum = 0;
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            rowSum += px[i];
            integral[(y + 1) * (W + 1) + (x + 1)] = integral[y * (W + 1) + (x + 1)] + rowSum;
          }
        }
        // apply threshold
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const x1 = Math.max(0, x - blockSize);
            const x2 = Math.min(W - 1, x + blockSize);
            const y1 = Math.max(0, y - blockSize);
            const y2 = Math.min(H - 1, y + blockSize);
            const count = (x2 - x1 + 1) * (y2 - y1 + 1);
            const sum = integral[(y2 + 1) * (W + 1) + (x2 + 1)] - integral[(y1) * (W + 1) + (x2 + 1)] - integral[(y2 + 1) * (W + 1) + (x1)] + integral[(y1) * (W + 1) + (x1)];
            const mean = Math.round(sum / count);
            const i = (y * W + x) * 4;
            const val = px[i] < (mean - 10) ? 0 : 255; // bias of 10 to prefer dark text
            px[i] = px[i + 1] = px[i + 2] = val;
          }
        }
        // detect dark-on-light vs light-on-dark by center sample brightness
        let sampleSum = 0;
        const sx = Math.floor(W / 2), sy = Math.floor(H / 2);
        const sampleRadius = Math.max(4, Math.floor(Math.min(W, H) / 20));
        for (let yy = sy - sampleRadius; yy <= sy + sampleRadius; yy++) {
          for (let xx = sx - sampleRadius; xx <= sx + sampleRadius; xx++) {
            if (xx >= 0 && xx < W && yy >= 0 && yy < H) {
              sampleSum += px[(yy * W + xx) * 4];
            }
          }
        }
        const sampleAvg = sampleSum / ((2 * sampleRadius + 1) ** 2);
        // if background is dark (avg low), invert to make text dark on light background
        if (sampleAvg < 128) {
          for (let i = 0; i < px.length; i += 4) {
            px[i] = px[i + 1] = px[i + 2] = 255 - px[i];
          }
        }
        ctx.putImageData(imgData, 0, 0);

        // final small resize back to sane size (optional) to reduce worker load
        // we keep as-is to benefit from upscaling readability

        // Export final image as base64 (no data: prefix)
        const out = canvas.toDataURL("image/jpeg", 0.95).replace(/^data:image\/(png|jpeg);base64,/, "");
        res(out);
      } catch (e) {
        rej(e);
      }
    };
    img.onerror = (e) => rej(e);
    img.src = base64Full.startsWith("data:") ? base64Full : ("data:image/jpeg;base64," + base64Full);
  });
}


// Initialize worker once
async function initTesseract() {
  if (tesseractReady) return;

  try {
    tesseractWorker = await Tesseract.createWorker("eng"); 
    tesseractReady = true;
    console.log("Tesseract v6 initialized");
  } catch (err) {
    console.error("Tesseract init failed:", err);
  }
}

// OCR function
async function runTesseractOCR(base64) {
  try {
    await initTesseract();
    if (!tesseractReady) return { text: "", confidence: 0 };

    const dataUri = "data:image/jpeg;base64," + base64;

    const result = await tesseractWorker.recognize(dataUri);

    return {
      text: (result?.data?.text || "").trim(),
      confidence: result?.data?.confidence || 0
    };
  } catch (err) {
    console.error("OCR Error:", err);
    return { text: "", confidence: 0 };
  }
}
