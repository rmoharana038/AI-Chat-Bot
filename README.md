# 💖 Aura • AI Girlfriend & Companion Chatbot

An intimate, empathetic, and witty AI Girlfriend Chatbot web application powered by **Google Gemini API** (`gemini-2.5-flash`), built with **React**, **Vite**, and **Tailwind CSS**.

Designed for seamless deployment on **Netlify** and version control on **GitHub**.

![Aura AI Girlfriend Banner](https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1200&q=80)

---

## ✨ Features

- **Multiple Pre-built Personalities**:
  - **Luna (The Sweet & Tender Romantic)**: Loving, empathetic, attentive, loves hearing about your day and sending warm compliments.
  - **Aria (The Witty & Sassy Tsundere)**: Sharp-witted, teasing gamer girl who feigns indifference but secretly cares deeply.
  - **Chloe (The Bubbly Anime Sunshine)**: High-energy otaku buddy who brings pure optimism and cheers you up unconditionally.
- **Custom Girlfriend Creator**:
  - Build your dream companion from scratch with custom name, avatar, personality traits, speech style, and custom greeting.
- **Affection & Relationship Progression**:
  - Affection points increase as you chat and send love reactions.
  - 5 relationship milestones: *Acquaintance* $\rightarrow$ *Good Friend* $\rightarrow$ *Mutual Crush* $\rightarrow$ *In Love* $\rightarrow$ *Soulmates*.
  - Dynamic avatar mood expressions (*Happy*, *Blushing*, *Teasing*, *Caring*, *Sleepy*).
- **Voice & Audio Support**:
  - **Text-to-Speech (TTS)**: Listen to your girlfriend's voice responses with persona-tailored pitch and rate.
  - **Voice Input (STT)**: Speak directly into your microphone using Web Speech Recognition.
  - **Cute UI Sound Effects**: Melodic synthesized chimes on message send, receive, and heart reactions.
- **Shared Memory & Diary**:
  - Automatically records milestones and memorable things you share (favorites, hobbies, dreams).
- **Romantic Aesthetics**:
  - Glassmorphic UI with multiple themes (*Sakura Pink*, *Midnight Violet*, *Cyber Neon*, *Sunset Warmth*).
  - Floating confetti heart reactions and smooth animations.
- **Offline & Demo Mode Fallback**:
  - Works out of the box with realistic simulated dialogue even before an API key is provided.

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- **Node.js** (v18 or higher recommended)
- **npm** or **pnpm**

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Locally
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🔑 Google Gemini API Key Setup

1. Get a free API key at [Google AI Studio](https://aistudio.google.com/app/apikey).
2. You can provide the API key in two ways:
   - **In the App UI**: Click the ⚙️ **Settings** button in the top bar and paste your key. It will be stored securely in your browser's `localStorage`.
   - **In an Environment Variable**: Create a `.env` file from `.env.example`:
     ```env
     VITE_GEMINI_API_KEY=AIzaSy...
     ```

---

## 📦 How to Push to GitHub

1. Initialize git and make your first commit:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: AI Girlfriend Chatbot"
   ```

2. Create a new repository on [GitHub](https://github.com/new) (e.g. `AI-Chat-Bot` or `ai-girlfriend-companion`).

3. Link and push your code:
   ```bash
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME.git
   git push -u origin main
   ```

---

## 🌐 How to Deploy to Netlify

### Method 1: Deploy via GitHub (Recommended)

1. Log in to [Netlify](https://app.netlify.com/).
2. Click **Add new site** $\rightarrow$ **Import an existing project**.
3. Select **GitHub** and authorize Netlify to access your repository.
4. Choose your `AI-Chat-Bot` repository.
5. Netlify will automatically detect the settings from `netlify.toml`:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
6. *(Optional)* Add your Gemini API key under **Site configuration** $\rightarrow$ **Environment variables**:
   - Key: `VITE_GEMINI_API_KEY`
   - Value: `your_gemini_api_key_here`
7. Click **Deploy Site**! Your chatbot will be live in seconds with HTTPS and automatic CI/CD.

### Method 2: Deploy via Netlify CLI

```bash
# Install Netlify CLI if you haven't already
npm install -g netlify-cli

# Build the project
npm run build

# Deploy to production
npx netlify deploy --prod --dir=dist
```

---

## 📁 Project Structure

```
D:\Gemini\AI-Chat-Bot\
├── netlify.toml              # Netlify build & redirect routing configuration
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
    │   └── personas.js       # Luna, Aria, Chloe profiles & prompts
    ├── services/
    │   ├── geminiService.js  # Google Gemini SDK & fallback simulated persona
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

## 🛡️ Privacy & Security

- **Client-Side Privacy**: Conversations and affection scores are saved locally on the user's device (`localStorage`).
- **No Sensitive Leakage**: Your `.env` and `dist` build files are excluded via `.gitignore`.

---

## 💖 License

MIT License. Crafted with love.
