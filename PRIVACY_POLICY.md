# Privacy Policy for Snip & Ask

**Last Updated:** January 18, 2026

## Overview

Snip & Ask is a Chrome browser extension that allows users to capture screen regions and receive AI-powered analysis. This privacy policy explains how we handle your data.

## Data Collection & Storage

### API Keys
- **What**: API keys for Groq, Google Gemini, OpenRouter, and Ollama host URLs
- **Storage**: Stored locally in your browser using `chrome.storage.local`
- **Access**: Never transmitted to our servers; sent only to the respective AI provider APIs

### Screenshots
- **What**: Screen regions you select for analysis
- **Storage**: Processed in memory only; never saved to disk
- **Transmission**: Sent directly to your configured AI provider for analysis, then discarded

### Settings
- **What**: Your preferences (selected model, interaction mode, custom prompts)
- **Storage**: Stored locally in `chrome.storage.local`

### Guest Mode 
- **What**: A browser fingerprint hash is generated to track rate limits for guest mode usage
- **Storage**: The fingerprint hash is sent to our rate-limiting server (Cloudflare Worker) to enforce daily usage limits
- **Purpose**: To prevent abuse of the guest mode while providing users the ability to try the extension without API keys
- **Note**: No personally identifiable information is collected; the fingerprint is a one-way hash

## Third-Party Services

When you use this extension, your screenshots and queries are sent to the AI provider you configure:

| Provider | Privacy Policy |
|----------|----------------|
| Groq | [groq.com/privacy](https://groq.com/privacy) |
| Google Gemini | [policies.google.com/privacy](https://policies.google.com/privacy) |
| OpenRouter | [openrouter.ai/privacy](https://openrouter.ai/privacy) |
| Ollama | Local only (no external transmission) |

**OpenRouter Note**: When using OpenRouter, requests include a referrer header (`github.com/Saura-4/Snip-Ask-Chrome-Extension`) and app title for API attribution.

**Guest Mode**: When using Guest Mode without API keys, requests are routed through our Cloudflare Worker proxy to the Groq API.

## Data We Do NOT Collect

- ❌ Browsing history
- ❌ Personal information (name, email, etc.)
- ❌ Analytics or telemetry
- ❌ Screenshots (beyond temporary processing)
- ❌ Your queries or AI responses

## Your Rights

- You can delete all stored data by removing the extension
- You can clear API keys through the extension settings
- Guest Mode usage resets daily

## Contact

For privacy concerns, please open an issue on our [GitHub repository](https://github.com/Saura-4/Snip-Ask-Chrome-Extension).

## Changes

We may update this policy. Changes will be posted to the GitHub repository.
