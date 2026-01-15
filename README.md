# ⚡ Snip & Ask

> **Instant AI analysis for any screenshot. Free. Open-source. Privacy-first.**

Snip & Ask lets you draw a box around anything on your screen and get instant AI-powered analysis. Whether it's a math problem, code bug, diagram, or text — just snip it and ask.

<!-- TODO: Add hero GIF here -->
<!-- ![Demo](assets/demo.gif) -->

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🖼️ **Instant Snips** | Draw a selection box anywhere, get AI analysis in seconds |
| 🔄 **Compare Models** | Open multiple windows to compare responses from different AI models |
| 🤖 **4 AI Providers** | Groq, Google Gemini, OpenRouter, Ollama (local) |
| 🧠 **Smart Modes** | Short Answer, Detailed, Code Debug, or Custom prompts |
| 📷 **Vision + OCR** | Auto-detects: uses Vision APIs for images, Tesseract.js for text |
| 💬 **Chat Follow-ups** | Continue the conversation in a floating chat window |
| ⌨️ **Keyboard Shortcuts** | Set custom hotkeys for instant snipping |
| 🔒 **Privacy First** | API keys stored locally. No servers. No telemetry. |

---

## 🚀 Quick Start

### 1. Install the Extension

**Option A: Chrome Web Store** *(Coming Soon)*

**Option B: Manual Install**
```bash
git clone https://github.com/Saura-4/Snip-Ask-Chrome-Extension.git
```
1. Open `chrome://extensions`
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked** → Select the cloned folder

### 2. Get Your Free API Key

1. Go to [console.groq.com/keys](https://console.groq.com/keys)
2. Create a free account and generate a key
3. Paste it in the extension popup under **API Keys**

### 3. Start Snipping!

Click the extension icon → **Snip Screen** → Draw a box → Get AI response!

---

## 🎯 Usage

| Action | How |
|--------|-----|
| **Snip Screen** | Click extension → "Snip Screen" or use keyboard shortcut |
| **Ask About Text** | Select text → Right-click → "Ask AI about '...'" |
| **Compare Models** | Click **+** button in chat window to compare responses |
| **Custom Shortcut** | Go to `chrome://extensions/shortcuts` → Set your hotkey |

---

## 🤖 Supported Providers

| Provider | Free Tier | Vision Support | Speed |
|----------|:---------:|:--------------:|:-----:|
| **Groq** | ✅ | ✅ Llama 4 | ⚡ Fastest |
| **Google Gemini** | ✅ | ✅ Gemini/Gemma | Fast |
| **OpenRouter** | ✅ Free models | Varies | Moderate |
| **Ollama** | ✅ Local | LLaVA, Moondream | Depends on hardware |

---

## 💡 Why I Built This

As a developer and student, I was tired of the constant workflow interruption: screenshot → switch tabs → upload to ChatGPT → ask question. 

I built Snip & Ask to eliminate that friction — instant AI analysis without leaving your current context. And since similar tools were all paid, I made this one **free and open-source** for everyone.

---

## 🏗️ Architecture

Built with a modular **Service-Oriented Architecture**:

- **AbstractAIService** — Base contract for all AI providers
- **Provider Services** — GroqService, GeminiService, OpenRouterService, OllamaService
- **Factory Pattern** — `getAIService()` routes to the correct provider automatically

This design allows adding new AI providers with zero changes to core logic.

---

## 📂 Project Structure

```
Snip-Ask-Chrome-Extension/
├── manifest.json           # Extension configuration (Manifest V3)
├── lib/                    # Tesseract.js OCR engine
├── assets/                 # Icons
└── src/
    ├── background/         # Service worker & AI service layer
    ├── content/            # Snipping UI & floating chat
    └── popup/              # Settings UI
```

---

## 🗺️ Roadmap

- ✅ **v4.0** — Multi-provider support, Compare Windows, Keyboard shortcuts
- 🔄 **v4.1** — Snip history, improved PDF support
- 📋 **v5.0** — Desktop app (Electron)

---

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Open issues for bugs or feature requests
- Submit pull requests
- Share feedback on [Discord](https://discord.gg/bppspgkd)

---

## 🧩 Credits

- **OCR Engine:** [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0)
- **AI Providers:** Groq, Google, OpenRouter, Ollama

---

## 📜 License

MIT License — Free to use, modify, and distribute.

---

**Built with ❤️ by [Saurav Chourasia](https://github.com/Saura-4)**

[![Instagram](https://img.shields.io/badge/Instagram-%23E4405F.svg?style=flat&logo=Instagram&logoColor=white)](https://www.instagram.com/saura_v_chourasia/)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-%230077B5.svg?style=flat&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/saurav-chourasia/)
[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?style=flat&logo=discord&logoColor=white)](https://discord.gg/bppspgkd)