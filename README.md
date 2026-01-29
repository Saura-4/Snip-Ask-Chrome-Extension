# Snip & Ask

**Your AI Screen Assistant. Snip anything, ask anything.**

> *No subscriptions. No data mining. Just instant intelligence.*

---

## Why This Exists

As a student, I constantly faced two problems:
1.  **The Context-Switching Tax**: Encountering a complex diagram or error log meant taking a screenshot, switching tabs to ChatGPT, uploading the image, and then switching back. It broke my flow every time.
2.  **The Subscription Wall**: Well, I can't afford expensive monthly subscriptions. I needed powerful AI tools without the hefty price tag.

I realized that powerful, free resources exist (Groq, Google Gemini, Ollama), but they are scattered. **Snip & Ask** is my solution: an open-source extension that aggregates these free tools into a single, seamless workflow floating right over your screen.

## What It Does

**Snip & Ask** removes the friction between you and the answer.
1.  **Snip**: Draw a box around *any* content—code errors, diagrams, or UI mockups.
2.  **Select & Ask**: Highlight text on any webpage, right-click, and ask immediately.
3.  **Instant Answer**: An overlay appears with the specific help you need.

### How It "Sees"
*   **Vision Models** (e.g., Llama 4 , Gemini 2.5/3): These models see the actual image pixel-by-pixel, perfect for diagrams and charts.
*   **Non-Vision Models** (e.g., DeepSeek, Kimi, gpt oss): We use the powerful **Tesseract.js OCR** engine to extract text from your snip on-device, so even text-only models can understand your screen content.

## Key Features

### ⚡ Zero Friction
-   **Universal Capture**: Works on any website, local file, or PDF open in Chrome.
-   **Temporary Chat**: Conversations are ephemeral and focused on the task at hand. Privacy by default.

### 🧠 Multi-Model Intelligence
-   **Cloud Integration**: Support for **Groq** (Llama 3 - blazing fast), **Google Gemini** (strong reasoning), and **OpenRouter** (access to Claude, GPT-4, etc).
-   **Local AI (Ollama)**: Run models entirely offline on your machine.
-   **Compare Mode**: AI can hallucinate. Tackle this by asking two different models simultaneously and comparing their answers side-by-side to verify the truth.

### 🛠️ Power User Tools
-   **Custom Modes**: Create your own personas (e.g., "Strict Code Reviewer", "Simple Explainer").
-   **Custome Prompt**: Create your temporary custom prompt on the fly.
-   **Guest Mode**: Unsure about API keys? Try the extension immediately using our hosted provider. Generous limits included.
-   **Shortcuts**: Configurable keyboard shortcuts  via `chrome://extensions/shortcuts`.

## Installation

### [Chrome Web Store](https://chromewebstore.google.com/detail/snip-ask-ai-screen-assist/bhbmfojjmimjpdkebhhipkffjkcglofo)
*(Recommended for most users)*

### Developer Install
1.  Clone this repository:
    ```bash
    git clone https://github.com/Saura-4/Snip-Ask-Chrome-Extension.git
    ```
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Toggle **Developer mode** (top right corner).
4.  Click **Load unpacked** and select the extension folder.

## Setup & Configuration

1.  **Click the Icon** in your toolbar.
2.  **Guest Mode**: You can start snipping immediately!
3.  **Add Your Keys (For Unlimited Access)**:
    -   Open **Settings** (⚙️).
    -   **Groq**: [Groq Console](https://console.groq.com/keys) (Free Tier available).
    -   **Gemini**: [Google AI Studio](https://aistudio.google.com/app/apikey) (Free Tier available).
    -   **Ollama**:
        *   Install from [Ollama.com](https://ollama.com/).
        *   **Important**: You must run the CORS fix script to allow the extension to talk to Ollama.
        *   👉 [**View setup guide**](src/setupguide/setupguide.html) for detailed instructions.

## Support the Project

This project is 100% free and open-source. If it saves you time or helps you learn, consider supporting the development!

| Method | Link/ID |
| :--- | :--- |
| **GitHub Sponsor** | [github.com/sponsors/Saura-4](https://github.com/sponsors/Saura-4) |
| **PayPal** | [paypal.me/saura444](https://paypal.me/saura444) |
| **UPI (India)** | `saurav04042004@okaxis` |

## Community

-   **Found a bug?** [Open an Issue](https://github.com/Saura-4/Snip-Ask-Chrome-Extension/issues)
-   **Have an idea?** [Start a Discussion](https://github.com/Saura-4/Snip-Ask-Chrome-Extension/discussions)
-   **Chat with us:** [Join our Discord](https://discord.gg/bppspgkd)

---

<div align="center">
    Built with ❤️ by <a href="https://github.com/Saura-4">Saurav Chourasia</a>
</div>