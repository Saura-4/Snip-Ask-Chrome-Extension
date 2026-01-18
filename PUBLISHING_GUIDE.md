# Publishing Guide for Snip & Ask v1.0

I have packaged your extension into **`Snip-Ask-Chrome-Extension-v1.0.zip`** located in your project root.

Follow these steps to publish it:

## 1. Access Developer Dashboard
Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard).

## 2. Upload Package
- **New Item:** Click **+ New Item** button (top right).
- **Update Existing:** Click on your existing extension, then **Package** > **Upload new package**.
- **File:** Select `Snip-Ask-Chrome-Extension-v1.0.zip`.

## 3. Store Listing (Required Fields)
Ensure these fields are filled:
- **Description:** Your manifest description is good, but you can expand it here for marketing.
- **Category:** `Productivity` -> `Developer Tools` (recommended).
- **Language:** `English`.
- **Graphic Assets:**
    - **Store Icon:** `assets/icons/icon-128.png` (128x128).
    - **Screenshots:** You must upload at least one screenshot (1280x800 or 640x400).
    - **Marquee/Promo Tile:** (Optional) 440x280.

## 4. Privacy Practices
- **Privacy Policy URL:** You need a public URL for your Privacy Policy.
    - *Tip:* You can host your `PRIVACY_POLICY.md` on GitHub Pages, a Gist, or a Google Doc and paste that link.
- **Justification:** You may need to justify permissions like `activeTab`, `scripting`, `storage`.
    - **activeTab/scripting:** "Used to capture screenshots and interact with the page content when the user activates the extension."
    - **storage:** "Used to save user preferences and API keys locally."

## 5. Submit
Click **Submit for Review**.

---

## Post-Publishing
Once approved (can take 24-48 hours), refer to **`POST_PUBLISHING.md`** for the final setup steps (getting the ID specifically).
