# Privacy Policy for Snip & Ask

**Last updated:** July 13, 2026

## What stays in your browser

- API keys, selected models, custom prompts, and Ollama host settings are stored in `chrome.storage.local`.
- Popup-window layout settings are stored locally.
- Side-panel chat content is stored locally while the panel is active so it can move between the panel and popup. Closing the side panel clears its active session.

## Screenshots, selected text, and AI responses

Screenshots and selected text are processed only when you request an answer. They are sent to the provider you selected. In Guest Mode, they first pass through the Snip & Ask Cloudflare Worker, which forwards the request to Groq. They are not written to the extension's local storage or to the Worker database.

## Guest Mode abuse prevention

Guest Mode stores a random installation ID locally. For rate limiting, the Worker receives that ID and a hashed browser/device fingerprint. Cloudflare also supplies the request IP to the Worker; the Worker stores only a keyed cryptographic hash of that IP, never the raw IP address. The Worker retains request timestamps, selected model/mode, and token counts only for rate limiting and operational accounting. Daily counters are deleted at the daily reset and velocity records are deleted after one hour.

Guest Mode does not use behavioral analytics or collect prompts, images, OCR text, API keys, browsing history, names, or email addresses for analytics.

## Third-party providers

When you use a provider, its own privacy policy applies to the request it receives:

| Provider | Privacy policy |
| --- | --- |
| Groq | [groq.com/privacy](https://groq.com/privacy) |
| Google Gemini | [policies.google.com/privacy](https://policies.google.com/privacy) |
| OpenAI | [openai.com/privacy](https://openai.com/privacy) |
| OpenRouter | [openrouter.ai/privacy](https://openrouter.ai/privacy) |
| Ollama | Local host selected by you |

## Your choices

- Use your own provider key to avoid Guest Mode.
- Clear API keys in the extension settings.
- Clear extension data or remove the extension to remove locally stored data.
- Contact the project through the [GitHub repository](https://github.com/Saura-4/Snip-Ask-Chrome-Extension) with privacy questions.
