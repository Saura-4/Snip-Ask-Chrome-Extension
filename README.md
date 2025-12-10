# ⚡ Groq Snip & Ask: Multimodal AI Browser Tool

Groq Snip & Ask is a powerful Chrome Extension that allows you to instantly snip any area of your screen and get an AI response using the high-speed Groq API. It is designed for maximum speed and contextual solving of code, diagrams, and quizzes.



## 🎯 The Origin Story: Why Groq Snip & Ask?

As a developer and student, I was frustrated by the slow, constant workflow interruption required to get AI feedback: capturing a screenshot, switching tabs, uploading the image to Gemini or ChatGPT, and then asking the question.

I built **Groq Snip & Ask** to eliminate this friction. The core idea was to enable instant, contextual analysis directly on the screen, without saving files or switching apps. Furthermore, since existing extensions offering this crucial productivity gain were paid, I decided to create a **superior, free, and open-source solution** for the community.

## 💡 Features

* **Instant Visual Snips:** Select a specific region of your browser window for fast analysis.
* **Groq API Integration (BYOK):** Uses your own Groq API Key for fast, secure processing with multimodal models.
* **Multiple Modes:** Choose between **Short Answer** (for quizzes), **Detailed Explanation**, **Code Debugger**, or a **Custom Prompt**.
* **Enhanced UX:** One-click copy buttons for easy transfer of code and text.
* **Privacy-Focused:** The "Reset Keys" function allows you to instantly purge your stored API key and settings.

## 🛠️ Installation

### 1. Get Your Groq API Key
1.  Sign up or log in to the [Groq Console](https://console.groq.com/).
2.  Generate a new API Key (it will start with `gsk_...`).

### 2. Install the Extension
1.  Download or clone this repository to your local machine.
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable **Developer Mode** using the toggle in the top right corner.
4.  Click **Load unpacked**.
5.  Select the entire folder containing your `manifest.json` file.

### 3. Setup
1.  Click the extension icon.
2.  Paste your `gsk_...` API Key into the input field.

## 💻 Development & Structure

This project follows Manifest V3 standards and uses a modular file structure:

* `content.js`: Manages the core snipping UI logic and answer display.
* `utils.js`: Contains reusable helper functions like `cropImage` and `parseMarkdown`.
* `background.js`: Handles API calls, prompt formatting, and communication with Groq.

## 🔒 Privacy and Security

* Your **Groq API Key** is stored locally (`chrome.storage.local`) and is never transmitted to any third-party server besides the official Groq API endpoint.
* **Image Data** is captured, cropped client-side, and sent directly to Groq. No intermediate server stores your screen captures.

## 📜 License

This project is released under the **MIT License**.

**Developed and Maintained by Saurav Chourasia**





