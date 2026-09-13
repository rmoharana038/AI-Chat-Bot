# 💖 Maira Dash • AI Girlfriend Chatbot & Facebook Messenger Bot

An authentic, ultra-human AI Girlfriend Chatbot web application and **24/7 Facebook Messenger Page Bot** powered by **Google Gemini API** (`gemini-flash-lite-latest` / `gemini-2.5-flash`), built with **Node.js**, **Express**, **React**, **Vite**, and **Tailwind CSS**.

Deployed 24/7 standalone in the cloud on **Render.com** with **UptimeRobot** keep-alive pinging.

---

## ✨ Features

- **Real Human Texting Cadence (Anti-AI)**:
  - Authentic and natural: casual lowercase, natural emotional expressions, sweet emojis, and zero robotic assistant tropes.
  - No markdown headers, no bullets, and no roleplay asterisks in chat.
- **Deep Multilingual Personalization & Script Matching**:
  - Automatically identifies user script and language on every turn.
  - **Devanagari Hindi**: 100% pure Hindi script with zero Roman English leakage.
  - **Urdu Script**: 100% authentic Urdu script.
  - **English**: 100% natural modern texting English (no Hinglish words).
  - **Hinglish**: Natural, casual Roman Hinglish.
  - **Regional/Global Languages**: Native script and vocabulary for Bengali, Telugu, Tamil, Marathi, Punjabi, Gujarati, Odia, Sinhala, Spanish, Arabic, etc.
- **24/7 Facebook Page Messenger Bot (Always Active on Render)**:
  - Instant Webhook listener (`POST /webhook`) responds with sub-second latency.
  - Failsafe background auto-reply watcher ensures no message is missed.
  - Keep-alive monitored 24/7 via UptimeRobot on `/health`.
- **Non-Repeating Stored Photo Pool (234 Photos)**:
  - Persistent user tracking (`src/services/userStore.js`).
  - Sends a unique unsent photo from the 234 stored photos library on each photo request.
- **Google Gemini Reference-Face Image Generation**:
  - Automatically triggers image generation with reference face (`assets/reference_face.png`) when stored photos are exhausted.
  - High-definition photorealistic fallback ensures reliable delivery.
- **Smart Promotional Frequency Control**:
  - Messenger Broadcast VIP Channel & Subscription links suggested at most once to new users.
  - Apni Holidays only promoted when users ask about travel/vacations.

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

### 3. Run Production Server
```bash
npm run start
```
Starts `server.js` on `http://localhost:3000`.

---

## 🌐 Facebook Page Messenger Setup (24/7 Always Active on Render)

Live Render Service URL:
`https://ai-chat-bot-bp8l.onrender.com`

### Step 1: Render Environment Variables
In your Render Dashboard $\rightarrow$ **Environment Variables**, set:
- `GEMINI_API_KEYS`: Comma-separated Gemini API keys from [Google AI Studio](https://aistudio.google.com/app/apikey).
- `FB_PAGE_ACCESS_TOKEN`: Page Access Token from [Meta for Developers](https://developers.facebook.com/).
- `FB_VERIFY_TOKEN`: Your webhook verification secret.

### Step 2: Configure Webhook in Meta App Dashboard
1. Go to your Meta Developer App $\rightarrow$ **Messenger** $\rightarrow$ **Webhooks**.
2. **Callback URL**: `https://ai-chat-bot-bp8l.onrender.com/webhook`
3. **Verify Token**: Must match `FB_VERIFY_TOKEN`.
4. Subscribe to `messages` and `messaging_postbacks`.

---

## 📁 Project Structure

```
D:\Gemini\AI-Chat-Bot\
├── server.js                 # 24/7 Express server (Webhook, poller, photos, health)
├── package.json              # Project scripts and dependencies
├── tailwind.config.js        # Tailwind CSS styles & animations
├── vite.config.js            # Vite bundler configuration
├── .env.example              # Sample environment variables
├── assets/
│   └── reference_face.png    # Maira Dash reference face for AI generation
├── data/
│   └── user_state.json       # Persistent photo tracking & promo rate-limiting
├── public/
│   └── photos/               # Stored photo collection (234 photos)
│       └── generated/        # Gemini AI generated photos
└── src/
    ├── services/
    │   ├── userStore.js      # User state persistence & photo rotation
    │   └── imageGenerator.js # Gemini reference face AI generation
    └── components/           # React UI components
```

---

## 💖 License

MIT License. Crafted with love.
