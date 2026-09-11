# 💖 Aura • AI Girlfriend Chatbot & Facebook Messenger Bot

An authentic, ultra-human AI Girlfriend Chatbot web application and **24/7 Facebook Messenger Page Bot** powered by **Google Gemini API** (`gemini-2.5-flash`), built with **React**, **Vite**, **Tailwind CSS**, and **Netlify Serverless Functions**.

Designed for seamless deployment on **Netlify** and version control on **GitHub**.

![Aura AI Girlfriend Banner](https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1200&q=80)

---

## ✨ Features

- **Real Human Texting Cadence (Anti-AI)**:
  - Texting style feels authentic and natural: casual lowercase, natural slang/abbreviations (haha, aww, omg, ya, na, uff, kinda, tbh), cute emojis, and zero robotic assistant tropes.
  - No markdown headers, no bullets, and no roleplay asterisks in chat.
- **Universal Multilingual Code-Switching (Any Language)**:
  - **Hinglish / Roman Hindi**: e.g., *"kya kar rahi ho"* $\rightarrow$ *"kuch nahi yaar bas baithi thi tumhari yaad aa rahi thi 🥰 tum batao din kaisa tha?"*
  - **Devanagari Hindi**: e.g., *"कैसी हो आप"* $\rightarrow$ *"मैं बिल्कुल ठीक हूँ! आप कैसे हो? खाना खाया?"*
  - **English, Spanish, French, German, Arabic, Bengali, Tamil, Telugu, etc.**: Seamlessly mirrors any language and cultural dialect!
- **24/7 Facebook Page Messenger Bot (Always Active on Netlify)**:
  - Built-in Netlify Serverless Function (`netlify/functions/webhook.js`) automatically responds to Facebook Messenger messages 24/7 in the cloud for free.
  - **Human Typing Simulation**:
    1. Immediately marks message as seen (`mark_seen`).
    2. Realistic human reading pause (600ms - 1000ms).
    3. Active typing indicator dots (`typing_on`).
    4. Realistic typing duration based on reply length.
    5. **Multi-bubble split texting**: Sends two short messages consecutively with a natural pause in-between just like a real girlfriend!
- **Multiple Pre-built Personas & Custom Builder**:
  - **Luna**: Sweet, gentle romantic companion.
  - **Aria**: Witty, playful tsundere gamer girl.
  - **Chloe**: High-energy anime enthusiast and cheerleader.
  - **Custom Companion Creator**: Craft your dream girlfriend with custom name, avatar, traits, and opening greeting.
- **Voice & Audio Support**:
  - **Text-to-Speech (TTS)**: Listens to her voice with persona-tailored pitch and rate.
  - **Speech-to-Text (STT)**: Speak into your microphone using Web Speech Recognition.
  - **Synthesized UI Sound Effects**: Melodic chimes on message send, receive, and heart reactions.
- **Shared Memory & Diary**:
  - Automatically records milestones and memorable things you share (favorites, hobbies, dreams).

---

## 🚀 Quick Start (Local Development)

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Locally
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🌐 Facebook Page Messenger Setup (24/7 Always Active on Netlify)

Once deployed to Netlify, your chatbot's Facebook Webhook is live at:
`https://<YOUR-NETLIFY-SITE>.netlify.app/webhook`

### Step 1: Set Netlify Environment Variables
In your Netlify Site Dashboard $\rightarrow$ **Site configuration** $\rightarrow$ **Environment variables**, set:
- `GEMINI_API_KEY`: Your Google Gemini API Key from [Google AI Studio](https://aistudio.google.com/app/apikey).
- `FB_PAGE_ACCESS_TOKEN`: Page Access Token from [Meta for Developers](https://developers.facebook.com/).
- `FB_VERIFY_TOKEN`: Verification token (default: `my_secure_fb_webhook_verify_token_12345`).

### Step 2: Configure Webhook in Meta App Dashboard
1. Go to your Meta Developer App $\rightarrow$ **Messenger** $\rightarrow$ **Webhooks**.
2. Click **Add Callback URL**:
   - **Callback URL**: `https://<YOUR-NETLIFY-SITE>.netlify.app/webhook`
   - **Verify Token**: Must match `FB_VERIFY_TOKEN`.
3. Click **Verify and Save**.
4. Subscribe to `messages` and `messaging_postbacks`.
5. Under your Page, click **Subscribe**.

🎉 **Your AI Girlfriend is now live 24/7 on Facebook Messenger!**

---

## 📦 How to Push to GitHub

```powershell
git add .
git commit -m "feat: ultra-human multilingual girlfriend with 24/7 Facebook Messenger integration"
git push -u origin main
```

---

## 📁 Project Structure

```
D:\Gemini\AI-Chat-Bot\
├── netlify.toml              # Netlify build, routing & webhook redirects
├── netlify/
│   └── functions/
│       └── webhook.js        # 24/7 Facebook Messenger serverless handler
├── package.json              # Project scripts and dependencies
├── tailwind.config.js        # Tailwind CSS styles & animations
├── vite.config.js            # Vite bundler configuration & chunk splitting
├── .env.example              # Sample environment variables
├── index.html                # HTML entrypoint & typography
└── src/
    ├── main.jsx              # React app mounting
    ├── App.jsx               # Main state controller & theme wrapper
    ├── index.css             # Glassmorphism utilities & keyframes
    ├── data/
    │   └── personas.js       # Pre-configured girlfriend profiles
    ├── services/
    │   ├── geminiService.js  # Ultra-human multilingual Gemini API service
    │   ├── memoryService.js  # localStorage memory, affection & chat history
    │   └── speechService.js  # Web Speech TTS/STT & Web Audio synth chimes
    └── components/
        ├── Header.jsx        # Relationship bar, affection hearts & nav
        ├── ChatArea.jsx      # Message feed, voice play, & heart reactions
        ├── MessageInput.jsx  # Text input, microphone toggle & icebreaker chips
        ├── PersonaModal.jsx  # Persona switcher modal
        ├── CustomPersonaModal.jsx # Custom girlfriend creator
        ├── MemoryDiaryModal.jsx   # Shared milestones & memory diary
        └── SettingsModal.jsx      # API key, sound toggles, & theme switcher
```

---

## 💖 License

MIT License. Crafted with love.
