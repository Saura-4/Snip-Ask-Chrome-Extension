# ⚡ Snip & Ask (v3.1)

> **A high-performance, modular Chrome Extension that brings multimodal AI analysis to any webpage.**
> *Now featuring a scalable Service-Oriented Architecture.*

**Snip & Ask** allows users to instantly capture any region of their screen and receive an AI-powered analysis using the Groq API. It supports standard Llama models as well as the new **Reasoning Models** (OpenAI GPT-OSS).

---

## 🎯 The Origin Story: Why Snip & Ask?

As a developer and student, I was frustrated by the slow, constant workflow interruption required to get AI feedback: capturing a screenshot, switching tabs, uploading the image to Gemini or ChatGPT, and then asking the question.

I built **Snip & Ask** to eliminate this friction. The core idea was to enable instant, contextual analysis directly on the screen, without saving files or switching apps. Furthermore, since existing extensions offering this crucial productivity gain were paid, I decided to create a **superior, free, and open-source solution** for the community.

---

## 🚀 Key Features

* **Instant Visual Snips:** Draw a box anywhere on your screen for immediate analysis.
* **Hybrid OCR Engine:** Automatically detects text density. Uses **Tesseract.js (v6)** for text-heavy snips and **Multimodal Vision** for diagrams/images.
* **Multiple Intelligence Modes:**
    * **⚡ Short Answer:** Instant, direct answers (great for quizzes).
    * **🧠 Detailed Explanation:** Use complex logic and step-by-step thinking.
    * **💻 Code Debugger:** Specialized prompts to fix code and explain bugs.
    * **✍️ Custom:** Define your own prompt behavior.
* **Privacy First:** Your API Key is stored locally (`chrome.storage`). No intermediate servers.
* **Zero-Cost:** Designed to work with the free tier of the Groq API.

---

## 🛠️ Installation

### 1. Get Your API Key
1.  Sign up at [Groq Console](https://console.groq.com/).
2.  Generate a new API Key (starts with `gsk_...`).

### 2. Load the Extension
1.  Clone this repository:
    ```bash
    git clone [https://github.com/Saura-4/Snip-Ask-Chrome-Extension.git](https://github.com/Saura-4/Snip-Ask-Chrome-Extension.git)
    ```
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable **Developer Mode** (top right).
4.  Click **Load unpacked**.
5.  Select the **root folder** of this project (the folder containing `manifest.json`).

### 3. Setup
1.  Pin the extension icon to your toolbar.
2.  Click the icon and paste your API Key.
3.  Select your preferred model (e.g., **OpenAI GPT-OSS 120B**).

---

## 🏗️ Architecture & Engineering

Unlike typical "script-kiddie" extensions, **Snip & Ask v3.1** is built on a scalable **Service-Oriented Architecture** using the **Factory Design Pattern**. This ensures the codebase is decoupled, testable, and future-proof.

### The "Service" Design
Instead of hardcoding API calls into the background script, the logic is encapsulated in an abstract service layer.

* **`AbstractAIService`**: Defines the contract (`askImage`, `askText`) that all AI providers must adhere to.
* **`GroqService`**: Concrete implementation that handles Groq's specific headers, JSON structure, and "Thinking" tag parsing.
* **`Factory` (`getAIService`)**: A central switchboard that instantiates the correct service class based on the user's selected model.

### Scalability
This architecture allows for:
* **Hot-Swapping APIs:** Adding `GeminiService` or `OpenAIService` requires **zero changes** to the core application logic.
* **Unified Error Handling:** All API errors are caught and normalized before reaching the UI.
* **Clean Code:** Follows **Allman Style** formatting for maximum readability.

---

## 📂 Project Structure

    snip-and-ask-extension/
    │
    ├── manifest.json              # Extension Configuration (Manifest V3)
    ├── lib/                       # Third-party dependencies (Tesseract.js)
    ├── assets/                    # Static assets (Icons)
    │
    └── src/
        ├── background/
        │   ├── background.js      # The "Traffic Controller" (Event Bus)
        │   └── ai-service.js      # The "Brain" (Factory & Service Classes)
        │
        ├── content/
        │   ├── content.js         # Snipping UI & DOM Overlay logic
        │   └── utils.js           # Image processing & Math helpers
        │
        └── popup/
            ├── popup.html         # Settings UI
            └── popup.js           # Popup Logic

---

## 🗺️ Roadmap

* **v3.1 (Current):** Modular Refactor, Support for OpenAI OSS Reasoning models.
* **v3.2 (Planned):**
    * **Contextual Chat:** Ability to reply to the AI's answer within the popup.
    * **History Sync:** Local storage of past snips and solutions.
* **v4.0 (Future):**
    * **Electron Port:** Converting the modular `ai-service.js` core into a native Desktop Application for Windows/Mac.

---

## 🧩 Credits & Acknowledgments

* **OCR Engine:** Powered by [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0 License).
* **LLM Provider:** Powered by [Groq Cloud](https://groq.com/).

---

## 📜 License

This project is open-source and available under the **MIT License**.

**Developed by Saurav Chourasia**