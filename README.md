# Snip & Ask

Snip any part of your screen and ask AI to explain, solve, or debug it. Supports Groq, Gemini, OpenAI, OpenRouter, DeepSeek, Cerebras, Z.AI (GLM), Kimi (Moonshot), Meta (Model API), and Ollama.

**[Download directly from the Chrome Web Store](https://chromewebstore.google.com/detail/snip-ask-ai-screen-assist/bhbmfojjmimjpdkebhhipkffjkcglofo)**

## Key Features

- **Guest Mode**: Try the extension instantly without needing an API key.
- **Auto Mode**: In Guest Mode, choose Auto to route requests through an available Groq model, avoid single-model rate-limit dead ends, and fall back to a vision-capable model for image snips when OCR is not enough.
- **Bring Your Own Key (BYOK)**: Connect your own API keys for Groq, Gemini, OpenAI, OpenRouter, DeepSeek, Cerebras, Z.AI (GLM), Kimi (Moonshot), Meta (Model API), or local Ollama for unlimited access and full control.
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
- Optional: API keys for any supported provider (Groq, Gemini, OpenAI, OpenRouter, DeepSeek, Cerebras, Z.AI, Kimi, Meta)
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
3. Toggle the providers you want on, then enter their API keys.
4. For Ollama: Ensure Ollama is running locally with correct CORS settings.

## Architecture

### AI Providers

Providers fall into two groups.

**Dedicated services** (`src/background/ai/providers/`) — Groq, Gemini, OpenAI, OpenRouter and Ollama each have their own class because they need provider-specific request shaping (Gemini's own wire format, OpenAI's Responses API, Groq's reasoning guards, Ollama's local host).

**Registry providers** (`src/background/models/provider-registry.js`) — DeepSeek, Cerebras, Z.AI (GLM), Kimi (Moonshot) and Meta (Model API) all speak the OpenAI `/chat/completions` format, so they share `OpenAICompatibleService` and are described declaratively in one file:

| Provider | Prefix | Endpoint | Key | Default models |
| --- | --- | --- | --- | --- |
| DeepSeek | `deepseek:` | `api.deepseek.com/chat/completions` | `deepseekKey` | `deepseek-flash` (V4.1, 1M ctx, vision) |
| Cerebras | `cerebras:` | `api.cerebras.ai/v1/chat/completions` | `cerebrasKey` | `gpt-oss-120b`, `qwen-3.8-27b` (text only) |
| Z.AI (GLM) | `zai:` | `api.z.ai/api/paas/v4/chat/completions` | `zaiKey` | `glm-5.3`, `glm-5.3-flash`, `glm-4.6v` |
| Kimi (Moonshot) | `moonshot:` | `api.moonshot.ai/v1/chat/completions` | `moonshotKey` | `kimi-k3`, `kimi-k2.6`, `kimi-k2.7-code` |
| Meta (Model API) | `meta:` | `api.meta.ai/v1/chat/completions` | `metaKey` | `muse-spark-1.3` |

Everything downstream reads the registry: routing, credential lookup, guest-mode detection, popup toggles, API key inputs, model dropdowns, custom-model prompts, and the models settings tab. Nothing else hardcodes an endpoint or model ID.

#### Adding another OpenAI-compatible provider

1. Add one entry to `OPENAI_COMPATIBLE_PROVIDERS` in `src/background/models/provider-registry.js`.
2. Add its `hostPermission` value to `host_permissions` in `manifest.json`.
3. Run `npm test` — the registry tests check prefix/storage-key uniqueness, that the host permission matches the endpoint origin and is declared in the manifest, that custom-model patterns accept the provider's own model IDs, and that every model gets a real context budget.

Set `textOnly: true` for a provider that cannot accept images (Cerebras), and `vision: true` on individual models that can. Text-only models receive an OCR'd text payload instead of the image. The text-only prefixes are also listed in `isVisionModel()` in `src/content/ui-helpers.js`, which decides client-side whether to OCR before sending.

#### Verifying a provider without having used it before

Model IDs and endpoints come from each provider's public docs and change over time. To check one against a live key:

1. Enable the provider in Settings and paste the key.
2. Pick one of its models — the popup runs a real validation request through `VALIDATE_CUSTOM_MODEL` and surfaces the provider's own error (`Invalid <provider> API key`, `model not found`, rate limit details, and so on).
3. If a model ID is stale, use **Custom Model** in that provider's dropdown to enter the current ID, then update the registry entry.

A wrong endpoint or model ID is always a one-line fix in `provider-registry.js`.

### Directory Structure

```
├── src/
│   ├── background/    # Service workers, AI routing, provider registry
│   ├── content/       # Content scripts for DOM interaction
│   ├── offscreen/     # Offscreen document for clipboard and OCR processing
│   ├── popup/         # Extension popup UI
│   ├── setupguide/    # Local Ollama setup guide
│   └── sidepanel/     # Chrome side panel UI
├── lib/               # Local libraries (Tesseract.js, KaTeX, DOMPurify)
├── assets/            # Icons and UI assets
└── manifest.json      # Extension configuration
```

### Request Lifecycle

1. User triggers a snip or text selection via Chrome context menu or keyboard shortcut.
2. Content script captures the screen or text and sends it to the background worker.
3. If an image is captured and the selected AI model is text-only, the background worker delegates the image to the offscreen document for local OCR via Tesseract.js.
4. Background worker routes the query to the appropriate AI service based on the model's `provider:` prefix (Groq, Gemini, OpenAI, OpenRouter, an OpenAI-compatible provider from the registry, or local Ollama).
5. If using Guest Mode, the request routes through the proxy backend.
6. The AI response is returned to the popup or side panel UI and rendered using KaTeX and DOMPurify.

## Available Scripts

There is no bundler for the Chrome Extension itself; the code is vanilla JavaScript.

| Command | Description |
| --- | --- |
| `npm test` | Run the unit test suite |
| `npm run check` | Validate background syntax |

## Testing

Run the dependency-free unit tests with `npm test`. They cover model routing, the provider registry, token-budget behavior, and guest-request validation. Manual browser checks are still required for capture, OCR, side-panel handoff, and each enabled provider.

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
