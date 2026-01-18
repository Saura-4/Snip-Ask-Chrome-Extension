# ⚡ Snip & Ask

> **Your AI Screen Assistant. Snip anything, ask anything.**
>
> *No subscriptions. No data mining. Just instant intelligence.*



**Snip & Ask** is the open-source Chrome extension that eliminates the context-switching tax. Stop saving screenshots, switching tabs, and uploading files just to get an answer.

Simply **draw a box** around code, text, diagrams, or math problems, and get an instant AI analysis floating right on your screen.

---

## ✨ Why You'll Love It

| 🚀 **Zero Friction** | 🔒 **Privacy First** | 💸 **100% Free** |
|-------------------|-------------------|-------------------|
| Snip > Ask > Done. No file uploads. No tab switching. | Your API keys stay on your device. No middleman servers tracking your queries. | Open source. Bring your own free keys (Groq, Gemini, etc.) or run local models. |

---

## ⚡ Key Features

*   **🎁 Guest Mode:** Try it immediately without any setup or API keys. 
*   **🖼️ Instant Visual Analysis:** Powered by Llama 3.2 Vision, Gemini 1.5, and more. It sees what you see.
*   **🤖 Multi-Model Chat:** Compare answers side-by-side. Is GPT-4o stuck? Ask Llama 3 or DeepSeek instantly.
*   **🧠 Intelligent Modes:**
    *   *Code Debugger:* Fixes undefined variables & logic errors.
    *   *Short Answer:* Concise facts for quick research.
    *   *Detailed Explainer:* Deep dives for complex topics.
*   **🏠 Local AI Support:** Full **Ollama** integration. Run privacy-focused models like Llama 3 or Mistral directly on your machine.
*   **⌨️ Power User Ready:** Custom keyboard shortcuts & right-click context menu integrations.

---

## 🚀 Get Started in 30 Seconds

### Option 1: Chrome Web Store (Recommended)
*[Link coming soon - Pending Review]*

### Option 2: Developer Install (Latest Features)
1.  Clone this repo:
    ```bash
    git clone https://github.com/Saura-4/Snip-Ask-Chrome-Extension.git
    ```
2.  Open Chrome and navigate to `chrome://extensions`
3.  Toggle **Developer mode** (top right corner).
4.  Click **Load unpacked** and select the folder you just cloned.

### 🔌 Connect Your Brain
1.  Click the **Snip & Ask** icon in your toolbar.
2.  **No Key Needed:** Just start snipping immediately in **Guest Mode** (limited free usage).
3.  **Power Up:** Open **Settings** (⚙️) to add your own keys for unlimited usage:
    *   [Groq Console](https://console.groq.com/keys) (Fastest, Recommended)
    *   [Google AI Studio](https://aistudio.google.com/app/apikey) (Gemini Models)
    *   [OpenRouter](https://openrouter.ai/keys) (Access to Claude, GPT-4, etc.)
4.  **Done!** Hit `Alt+Shift+S` (or your set shortcut) to start snipping.

---

## � Supported Providers

We support the fastest and most capable models available today:

| Provider | Best For | Vision? | Cost |
| :--- | :--- | :---: | :---: |
| **Groq** | ⚡ **Speed.** Near-instant answers. | ✅ | Free Tier |
| **Google Gemini** | 🧠 **Reasoning.** Great for multimodal tasks. | ✅ | Free Tier |
| **OpenRouter** | 🌐 **Variety.** Access DeepSeek R1, Claude 3.5, etc. | Varies | Varies |
| **Ollama** | 🛡️ **Privacy.** Run completely offline. | ✅ | **Free** |

---

## 🏗️ For Developers

Snip & Ask is built with a modular, maintainable **Service-Oriented Architecture** using Vanilla JS (no heavy frameworks).

*   **`AbstractAIService`**: The interface that all providers implement. Want to add Anthropic directly? Just extend this class.
*   **`Standard Factory Pattern`**: `getAIService()` dynamically loads the user's preferred brain.
*   **`Tesseract.js`**: Client-side OCR for extracting text when Vision models are overkill.

**Roadmap (v2.0 Goals):**
- [ ] ☁️ Sync history across devices (optional encrypted sync)
- [ ] � PDF Analysis support
- [ ] �️ Native Desktop App (Electron)

---

## 🤝 Join the Mission

We believe AI tools should be **invisible utilities**, not walled gardens.

*   **Found a bug?** [Open an Issue](https://github.com/Saura-4/Snip-Ask-Chrome-Extension/issues)
*   **Have an idea?** [Start a Discussion](https://github.com/Saura-4/Snip-Ask-Chrome-Extension/discussions)
*   **Want to chat?** [Join our Discord](https://discord.gg/bppspgkd)

**License:** MIT. Hack away.

---

<div align="center">

**Built with ❤️ by [Saurav Chourasia](https://github.com/Saura-4)**

[![Instagram](https://img.shields.io/badge/Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://www.instagram.com/saura_v_chourasia/)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/saurav-chourasia/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-blue.svg)](https://chrome.google.com/webstore)
[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2)](https://discord.gg/bppspgkd)

</div>