# Snip & Ask

Snip any part of your screen and ask AI to explain, solve, or debug it. Supports Groq, Gemini, OpenAI, OpenRouter, and Ollama.

**[Download directly from the Chrome Web Store](https://chromewebstore.google.com/detail/snip-ask-ai-screen-assist/bhbmfojjmimjpdkebhhipkffjkcglofo)**

## Key Features

- **Guest Mode**: Try the extension instantly without needing an API key.
- **Auto Mode**: In Guest Mode, choose Auto to route requests through an available Groq model, avoid single-model rate-limit dead ends, and fall back to a vision-capable model for image snips when OCR is not enough.
- **Bring Your Own Key (BYOK)**: Connect your own API keys for Groq, Gemini, OpenRouter, or local Ollama for unlimited access and full control.
- **Universal Capture**: Works on any website, local file, or PDF open in Chrome.
- **Right-Click Ask**: Simply select text or an image, right-click, and ask the AI instantly via the context menu.
- **Custom Modes**: Create and tailor custom system prompts and modes for your specific workflows.
- **Temporary Chat**: Conversations can be cleared from the side panel and are intended for focused, task-specific use.
- **Compare Mode**: Ask two different models simultaneously and compare their answers side-by-side to verify truth.
- **On-Device OCR**: Built-in text extraction using Tesseract.js ensures text-only models can understand screen content.

## Tech Stack

- **Extension Framework**: Chrome Extensions Manifest V3
- **Language**: Vanilla JavaScript (ES6+), HTML, CSS
- **OCR Engine**: Tesseract.js (Client-side, WebAssembly)
- **Math Rendering**: KaTeX
- **Security**: DOMPurify, strict content limits, and provider-specific host permissions
- **Backend/Rate Limiting**: Cloudflare Workers (for Guest Mode)
- **Database**: Cloudflare D1 (rate-limiting state only)
- **Deployment**: Chrome Web Store

## Prerequisites

- Google Chrome browser (or Chromium-based alternative)
- Optional: API Keys (Groq, Gemini, or OpenRouter)
- Optional: Ollama installed locally for offline inference
- Optional: Node.js (for deploying the Cloudflare Worker)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/Saura-4/Snip-Ask-Chrome-Extension.git
cd Snip-Ask-Chrome-Extension
```

### 2. Load the Extension

1. Open Chrome and navigate to `chrome://extensions`.
2. Toggle **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the `Snip-Ask-Chrome-Extension` directory.

### 3. Setup AI Providers (Optional but recommended)

1. Click the extension icon in your toolbar.
2. Open Settings.
3. Enter your API keys for Groq, Gemini, or OpenRouter.
4. For Ollama: Ensure Ollama is running locally with correct CORS settings.

## Architecture

### Directory Structure

```
├── src/
│   ├── background/    # Service workers and AI routing logic
│   ├── content/       # Content scripts for DOM interaction
│   ├── offscreen/     # Offscreen document for clipboard and OCR processing
│   ├── popup/         # Extension popup UI
│   ├── setupguide/    # Local Ollama setup guide
│   └── sidepanel/     # Chrome side panel UI
├── lib/               # Local libraries (Tesseract.js, KaTeX, DOMPurify)
├── cloudflare-worker/ # Guest Mode proxy and rate limiter
├── assets/            # Icons and UI assets
└── manifest.json      # Extension configuration
```

### Request Lifecycle

1. User triggers a snip or text selection via Chrome context menu or keyboard shortcut.
2. Content script captures the screen or text and sends it to the background worker.
3. If an image is captured and the selected AI model is text-only, the background worker delegates the image to the offscreen document for local OCR via Tesseract.js.
4. Background worker routes the query to the appropriate AI service (Groq, Gemini, OpenRouter, or local Ollama).
5. If using Guest Mode, the request routes through the Cloudflare Worker proxy, which enforces request, device, and network rate limits via D1.
6. The AI response is returned to the popup or side panel UI and rendered using KaTeX and DOMPurify.

## Environment Variables

Environment variables are strictly used for the Cloudflare Worker proxy (`cloudflare-worker/wrangler.toml`). No environment variables are needed for the Chrome Extension itself.

### Required (Cloudflare Worker)

| Variable | Description | Example |
| --- | --- | --- |
| `GROQ_API_KEY` | Proxy API key for Groq Guest Mode | `gsk_...` |
| `RATE_LIMIT_HMAC_KEY` | Worker secret used to hash Cloudflare client IPs | Set with `wrangler secret put` |

### Optional (Cloudflare Worker)

| Variable | Description | Default |
| --- | --- | --- |
| `VELOCITY_LIMIT` | Max requests per minute | `10` |
| `HARD_CAP_DAILY` | Max requests per day | `100` |
| `IP_VELOCITY_LIMIT` | Max guest requests per minute per network | `60` |
| `IP_DAILY_LIMIT` | Max guest requests per day per network | `500` |
| `ALLOWED_EXTENSION_ID` | CORS allowed origin | `bhbmfojjmimjpdkebhhipkffjkcglofo` |

## Available Scripts

There is no bundler for the Chrome Extension itself; the code is vanilla JavaScript.

For the Cloudflare Worker:

| Command | Description |
| --- | --- |
| `npm install` | Install Cloudflare Worker dependencies |
| `npx wrangler dev` | Start local development server |
| `npx wrangler deploy` | Deploy worker to Cloudflare |

## Testing

Run the dependency-free unit tests with `npm test`. They cover model routing, token-budget behavior, and guest-request validation. Manual browser checks are still required for capture, OCR, side-panel handoff, and each enabled provider.

1. Navigate to `chrome://extensions`.
2. Reload the extension after making file changes.
3. Inspect views:
   - Popup: Right click the extension icon -> Inspect popup.
   - Background Worker: Click "service worker" on the extension card.
   - Side Panel: Right click inside the side panel -> Inspect.

## Troubleshooting

### Local Ollama Connection Issues

**Error:** Extension cannot connect to local Ollama instance.

**Solution:**
Ollama blocks cross-origin requests by default. You must configure CORS.
1. See the guide in `src/setupguide/setupguide.html`.
2. Generally, you need to set `OLLAMA_ORIGINS="chrome-extension://extension_id"` in your system environment variables before starting Ollama.

### OCR Failing

**Error:** Text extraction returns empty or nonsense.

**Solution:**
Ensure the `lib/` directory contains `eng.traineddata.gz` and the WebAssembly core files (`tesseract-core.wasm`). They are required for offline OCR.

### Guest Mode Blocked

**Error:** Rate limit exceeded or Access Denied.

**Solution:**
The Cloudflare Worker restricts requests per device fingerprint to prevent abuse. Use your own API keys in Settings to completely bypass Guest Mode limits.

---

Built by Saurav Chourasia.
