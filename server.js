import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import {
  getUser,
  recordSentPhoto,
  markChannelSuggested,
  markHolidayPromoted,
  getUnsentPhotos
} from './src/services/userStore.js';
import { generateNewGirlfriendPhoto } from './src/services/imageGenerator.js';
import { analyzeUserImage } from './src/services/visionAnalyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static photos and generated photos
const photosDir = path.join(__dirname, 'public', 'photos');
if (fs.existsSync(photosDir)) {
  app.use('/photos', express.static(photosDir));
}

// Function to list all stored photos dynamically
function getStoredPhotosList() {
  if (!fs.existsSync(photosDir)) return [];
  return fs.readdirSync(photosDir).filter(file => {
    const full = path.join(photosDir, file);
    if (fs.statSync(full).isDirectory()) return false;
    const ext = path.extname(file).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) && !file.startsWith('.');
  });
}

// Serve dist directory if frontend is built
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

// Configuration
const PAGE_ID = '640383429165346';
const GRAPH_BASE_URL = 'https://graph.facebook.com/v21.0';
const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);
const verifyToken = process.env.FB_VERIFY_TOKEN || 'my_secure_fb_webhook_verify_token_12345';
const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

const MODELS_TO_TRY = [
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-flash-latest',
  'gemini-3.5-flash'
];

const processedMids = new Set();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 1. HEALTH CHECK ENDPOINT (For UptimeRobot)
// ==========================================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Maira Dash Facebook AI Girlfriend',
    platform: 'Render.com (24/7 Always Active)',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    keysConfigured: apiKeys.length,
    fbTokenConfigured: Boolean(pageAccessToken && pageAccessToken.length > 20)
  });
});

// ==========================================
// 2. META WEBHOOK HANDSHAKE (GET /webhook)
// ==========================================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ Meta Webhook verification handshake successful!');
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Forbidden: Verification token mismatch');
});

// ==========================================
// EMOJI & STICKER DETECTION
// ==========================================
function isStickerOrEmoji(att, msgOrEvent = {}) {
  if (!att && !msgOrEvent) return false;

  // 1. Message-level sticker indicators (Webhooks & Graph API)
  if (msgOrEvent.sticker_id || msgOrEvent.message?.sticker_id || msgOrEvent.sticker) return true;

  if (att) {
    // 2. Attachment payload sticker ID
    if (att.payload?.sticker_id || att.sticker_id) return true;

    // 3. Graph API image_data flags
    if (att.image_data?.render_as_sticker === true) return true;
    if (att.image_data?.sticker_id) return true;

    // 4. Attachment naming conventions
    const id = String(att.id || '');
    const name = String(att.name || '').toLowerCase();
    if (id.startsWith('sticker_') || name.startsWith('sticker-') || name.includes('sticker')) return true;

    // 5. Small icon dimensions typical of emojis / stickers (e.g. 72x72, 120x120)
    const w = att.image_data?.width;
    const h = att.image_data?.height;
    if (w && h && w <= 140 && h <= 140) return true;

    // 6. Facebook Sticker CDN URLs
    const url = att.image_data?.url || att.payload?.url || att.file_url || '';
    if (url.includes('/t39.1997-6/') || url.includes('render_as_sticker') || url.includes('sticker')) return true;
  }

  return false;
}

// ==========================================
// 3. META INSTANT WEBHOOK LISTENER (POST /webhook)
// ==========================================
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object !== 'page') {
    return res.sendStatus(404);
  }

  // CRITICAL FOR ZERO DELAY: Respond 200 OK immediately to Meta so it never times out or retries!
  res.status(200).send('EVENT_RECEIVED');

  // Process event in background instantly
  const entries = body.entry || [];
  for (const entry of entries) {
    const messagingEvents = entry.messaging || [];
    for (const msgEvent of messagingEvents) {
      if (msgEvent.message?.is_echo) continue;

      const mid = msgEvent.message?.mid;
      if (mid && processedMids.has(mid)) continue;
      if (mid) {
        processedMids.add(mid);
        if (processedMids.size > 500) {
          const first = processedMids.values().next().value;
          processedMids.delete(first);
        }
      }

      const senderPsid = msgEvent.sender?.id;
      let userText = (msgEvent.message?.text || msgEvent.postback?.title || '').trim();

      // Check if message contains a sticker / emoji attachment
      const attachments = msgEvent.message?.attachments || [];
      const hasSticker = Boolean(msgEvent.message?.sticker_id || attachments.some(a => isStickerOrEmoji(a, msgEvent)));

      let imageUrl = null;
      if (!hasSticker) {
        const imgAttachment = attachments.find(a => a.type === 'image' && !isStickerOrEmoji(a, msgEvent));
        imageUrl = imgAttachment?.payload?.url || null;
      }

      // If user sent a sticker / emoji without accompanying text, treat as emoji gesture
      if (!userText && hasSticker) {
        const stickerId = msgEvent.message?.sticker_id || attachments.find(a => a.payload?.sticker_id)?.payload?.sticker_id;
        if (String(stickerId) === '369239263222822') {
          userText = '👍';
        } else {
          userText = '👍';
        }
      }

      if (!senderPsid || (!userText && !imageUrl)) continue;

      console.log(`⚡ [Instant Webhook Received] From ${senderPsid}: "${userText.substring(0, 40)}..." (Has Real Image: ${Boolean(imageUrl)} | Has Sticker: ${hasSticker})`);
      handleIncomingMessage(senderPsid, userText, req.headers.host || '', imageUrl).catch(err => {
        console.error('Error handling webhook message:', err.message);
      });
    }
  }
});

// ==========================================
// 4. MULTI-LANGUAGE DETECTION & PERSONALIZATION
// ==========================================
function detectUserLanguage(text, history = []) {
  if (!text || typeof text !== 'string') text = '';
  const trimmed = text.trim();

  // 1. Non-Latin Unicode Script Checks
  if (/[\u0900-\u097F]/.test(trimmed)) {
    const marathiWords = ['आहे', 'नाही', 'काय', 'कशी', 'कसं', 'करतो', 'करते', 'करतोय', 'जेवला', 'जेवली', 'कुठे', 'मला', 'तुला', 'सांग', 'बरं', 'छान'];
    if (marathiWords.some(w => trimmed.includes(w))) {
      return {
        code: 'MARATHI_DEVANAGARI',
        name: 'MARATHI (मराठी)',
        script: 'Devanagari',
        instruction: 'THE USER IS TEXTING IN MARATHI (मराठी). You MUST reply 100% in warm, affectionate, natural Marathi in Devanagari script (मराठी). DO NOT reply in Hinglish or English.'
      };
    }
    return {
      code: 'HINDI_DEVANAGARI',
      name: 'HINDI (हिन्दी)',
      script: 'Devanagari',
      instruction: 'THE USER IS TEXTING IN HINDI (DEVANAGARI SCRIPT: हिन्दी). You MUST reply 100% in sweet, warm, natural Hindi in Devanagari script (देवनागरी लिपि). ABSOLUTELY FORBIDDEN: DO NOT reply in Roman Hinglish (English alphabet). Write only in proper Hindi script.'
    };
  }

  if (/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(trimmed)) {
    const arabicWords = ['شلونك', 'شخبارك', 'حبيبي', 'كيفك', 'شو', 'كتير', 'شكرا', 'مرحبا', 'اهلا', 'وينك'];
    if (arabicWords.some(w => trimmed.includes(w))) {
      return {
        code: 'ARABIC',
        name: 'ARABIC (العربية)',
        script: 'Arabic',
        instruction: 'THE USER IS TEXTING IN ARABIC (العربية). You MUST reply 100% in natural, affectionate, warm Arabic script (العربية). DO NOT use English or Hinglish.'
      };
    }
    return {
      code: 'URDU',
      name: 'URDU (اردو)',
      script: 'Urdu',
      instruction: 'THE USER IS TEXTING IN URDU (اردو). You MUST reply 100% in sweet, fluent, natural Urdu in Arabic/Urdu script (اردو رسم الخط). ABSOLUTELY FORBIDDEN: DO NOT write in English letters / Roman Urdu. Use only proper Urdu script.'
    };
  }

  if (/[\u0980-\u09FF]/.test(trimmed)) {
    return { code: 'BENGALI_SCRIPT', name: 'BENGALI (বাংলা)', script: 'Bengali', instruction: 'THE USER IS TEXTING IN BENGALI (বাংলা). You MUST reply 100% in sweet, affectionate Bengali in Bengali script (বাংলা).' };
  }
  if (/[\u0C00-\u0C7F]/.test(trimmed)) {
    return { code: 'TELUGU_SCRIPT', name: 'TELUGU (తెలుగు)', script: 'Telugu', instruction: 'THE USER IS TEXTING IN TELUGU (తెలుగు). You MUST reply 100% in sweet, affectionate Telugu in Telugu script (తెలుగు).' };
  }
  if (/[\u0B80-\u0BFF]/.test(trimmed)) {
    return { code: 'TAMIL_SCRIPT', name: 'TAMIL (தமிழ்)', script: 'Tamil', instruction: 'THE USER IS TEXTING IN TAMIL (தமிழ்). You MUST reply 100% in sweet, affectionate Tamil in Tamil script (தமிழ்).' };
  }
  if (/[\u0A80-\u0AFF]/.test(trimmed)) {
    return { code: 'GUJARATI_SCRIPT', name: 'GUJARATI (ગુજરાતી)', script: 'Gujarati', instruction: 'THE USER IS TEXTING IN GUJARATI (ગુજરાતી). You MUST reply 100% in sweet, affectionate Gujarati in Gujarati script (ગુજરાતી).' };
  }
  if (/[\u0A00-\u0A7F]/.test(trimmed)) {
    return { code: 'PUNJABI_SCRIPT', name: 'PUNJABI (ਪੰਜਾਬੀ)', script: 'Gurmukhi', instruction: 'THE USER IS TEXTING IN PUNJABI (ਪੰਜਾਬੀ). You MUST reply 100% in sweet, affectionate Punjabi in Gurmukhi script (ਪੰਜਾਬੀ).' };
  }
  if (/[\u0B00-\u0B7F]/.test(trimmed)) {
    return { code: 'ODIA_SCRIPT', name: 'ODIA (ଓଡ଼ିଆ)', script: 'Odia', instruction: 'THE USER IS TEXTING IN ODIA (ଓଡ଼ିଆ). You MUST reply 100% in sweet, affectionate Odia in Odia script (ଓଡ଼ିଆ).' };
  }
  if (/[\u0C80-\u0CFF]/.test(trimmed)) {
    return { code: 'KANNADA_SCRIPT', name: 'KANNADA (ಕನ್ನಡ)', script: 'Kannada', instruction: 'THE USER IS TEXTING IN KANNADA (ಕನ್ನಡ). You MUST reply 100% in sweet, affectionate Kannada in Kannada script (ಕನ್ನಡ).' };
  }
  if (/[\u0D00-\u0D7F]/.test(trimmed)) {
    return { code: 'MALAYALAM_SCRIPT', name: 'MALAYALAM (മലയാളം)', script: 'Malayalam', instruction: 'THE USER IS TEXTING IN MALAYALAM (മലയാളം). You MUST reply 100% in sweet, affectionate Malayalam in Malayalam script (മലയാളം).' };
  }
  if (/[\u0D80-\u0DFF]/.test(trimmed)) {
    return { code: 'SINHALA_SCRIPT', name: 'SINHALA (සිංහල)', script: 'Sinhala', instruction: 'THE USER IS TEXTING IN SINHALA (සිංහල). You MUST reply 100% in sweet, affectionate Sinhala in Sinhala script (සිංහල).' };
  }

  // 2. Latin Alphabet Analysis
  const cleanWords = trimmed.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

  if (cleanWords.length === 0) {
    if (Array.isArray(history)) {
      for (const h of history.slice().reverse()) {
        const text = (h.message || h.text || '').trim();
        const role = h.from?.id === PAGE_ID || h.role === 'model' ? 'model' : 'user';
        if (role === 'user' && text && text !== trimmed) {
          const prev = detectUserLanguage(text);
          if (prev.code !== 'UNKNOWN') return prev;
        }
      }
    }
    return {
      code: 'ENGLISH',
      name: 'ENGLISH',
      script: 'Latin',
      instruction: 'Reply in sweet, affectionate, natural modern texting English. DO NOT use Hinglish or Hindi words.'
    };
  }

  // Check Romanized Sinhala
  const sinhalaMarkers = ['oya', 'oyawa', 'monada', 'monawada', 'karanne', 'mage', 'wasthuwa', 'sudu', 'petiyo', 'menika', 'raththaran', 'kohomada', 'adarei', 'hode', 'enna', 'eannam', 'inna', 'neda', 'ekmanata'];
  if (sinhalaMarkers.some(w => cleanWords.includes(w))) {
    return {
      code: 'SINHALA_ROMAN',
      name: 'ROMANIZED SINHALA',
      script: 'Latin',
      instruction: 'THE USER IS TEXTING IN ROMANIZED SINHALA. You MUST reply in sweet, authentic, affectionate Romanized Sinhala (e.g. mage wasthuwa, sudu petiyo, menika). DO NOT use Hinglish!'
    };
  }

  // Check Romanized Spanish
  const spanishMarkers = ['hola', 'como', 'estas', 'bien', 'amor', 'vida', 'te', 'quiero', 'hermosa', 'donde', 'haces', 'buenos', 'dias', 'noches'];
  const spanishCount = cleanWords.filter(w => spanishMarkers.includes(w)).length;
  if (spanishCount >= 2 || (spanishCount === 1 && cleanWords.length <= 2 && ['hola', 'buenos', 'gracias'].includes(cleanWords[0]))) {
    return {
      code: 'SPANISH',
      name: 'SPANISH',
      script: 'Latin',
      instruction: 'THE USER IS TEXTING IN SPANISH. You MUST reply 100% in sweet, affectionate, natural texting Spanish (e.g. mi amor, cariño, corazón). DO NOT use Hinglish or English!'
    };
  }

  // Check Romanized Bengali
  const bengaliMarkers = ['kemon', 'acho', 'achish', 'achho', 'korcho', 'korchish', 'bhalo', 'bhalobasi', 'khabar', 'kheyecho', 'tumi', 'amar', 'tomake'];
  if (bengaliMarkers.some(w => cleanWords.includes(w))) {
    return {
      code: 'BENGALI_ROMAN',
      name: 'ROMANIZED BENGALI',
      script: 'Latin',
      instruction: 'THE USER IS TEXTING IN ROMANIZED BENGALI. You MUST reply in sweet, affectionate Romanized Bengali (e.g. bhalo achi go jaan, tumi kemon acho?). DO NOT use Hinglish!'
    };
  }

  // Check Romanized Telugu
  const teluguMarkers = ['unnav', 'unnavu', 'unnara', 'chestunnav', 'chestunnaru', 'bagunara', 'bagunna', 'tintunnava', 'nenu', 'nuvvu', 'ekkada'];
  if (teluguMarkers.some(w => cleanWords.includes(w))) {
    return {
      code: 'TELUGU_ROMAN',
      name: 'ROMANIZED TELUGU',
      script: 'Latin',
      instruction: 'THE USER IS TEXTING IN ROMANIZED TELUGU. You MUST reply in sweet, affectionate Romanized Telugu (e.g. nenu chala bagunnanu baby). DO NOT use Hinglish!'
    };
  }

  // Distinct Hinglish vocabulary
  const HINGLISH_WORDS = new Set([
    'kya', 'kyu', 'kyun', 'kese', 'kaise', 'kaisi', 'kaisa', 'hai', 'hain', 'ho', 'hu', 'hoon',
    'kar', 'karo', 'kare', 'karna', 'karte', 'karti', 'rahi', 'raha', 'rahe', 'gayi', 'gaya', 'gaye',
    'khana', 'khaya', 'khayi', 'khaye', 'khilao', 'baat', 'baatein', 'suno', 'sunao', 'batao', 'bataiye',
    'kahan', 'kaha', 'kidhar', 'kab', 'jab', 'tab', 'ab', 'abhi', 'kal', 'aaj', 'parso',
    'yaar', 'meri', 'mera', 'mere', 'apna', 'apni', 'apne', 'aap', 'aapka', 'aapki', 'aapke',
    'tum', 'tumhara', 'tumhari', 'tumhare', 'tu', 'tera', 'teri', 'tere',
    'mujhko', 'mujhse', 'tujhko', 'tujhse', 'humara', 'humari', 'humare',
    'theek', 'thik', 'sahi', 'galat', 'nhi', 'toh', 'bohot', 'bahut', 'thoda', 'thodi',
    'achha', 'achi', 'acchi', 'samajh', 'samjha', 'samjhi', 'kuch',
    'sharam', 'sharm', 'gussa', 'pyaar', 'pyar', 'sone', 'soya', 'soyi', 'uthna',
    'jaana', 'aata', 'aati', 'dekho', 'dekha', 'dekhna',
    'bhejo', 'bheja', 'bhejna', 'dood', 'doodh', 'paani', 'chahiye',
    'kitna', 'kitni', 'kitne', 'itna', 'itni', 'itne', 'aisa', 'aisi', 'aise', 'waisa', 'waisi', 'waise',
    'kripya', 'namaste', 'shukriya', 'dhanyawad', 'shona', 'bacha', 'bachha', 'janu', 'janeman',
    'chalo', 'suno', 'bolo', 'bologe', 'bolna', 'bolte', 'raho', 'jaoge', 'aaoge'
  ]);

  let hinglishMatches = 0;
  for (const w of cleanWords) {
    if (HINGLISH_WORDS.has(w)) hinglishMatches++;
  }

  const isShortGreetingOrGeneric = cleanWords.length <= 4 && (
    cleanWords.includes('good') || cleanWords.includes('morning') || cleanWords.includes('night') ||
    cleanWords.includes('hello') || cleanWords.includes('hi') || cleanWords.includes('hey') ||
    cleanWords.includes('thanks') || cleanWords.includes('thank') || cleanWords.includes('ok') ||
    cleanWords.includes('okay') || cleanWords.includes('yes') || cleanWords.includes('no') ||
    cleanWords.includes('love') || cleanWords.includes('miss')
  );

  if (hinglishMatches >= 1 && !isShortGreetingOrGeneric) {
    return {
      code: 'HINGLISH',
      name: 'HINGLISH (ROMAN HINDI)',
      script: 'Latin',
      instruction: 'THE USER IS TEXTING IN HINGLISH (ROMAN HINDI / URDU). Reply in sweet, natural, authentic Roman Hinglish (e.g. "kuch nahi baby bas baithi thi tumhari yaad aa rahi thi 🥰").'
    };
  }

  if (isShortGreetingOrGeneric) {
    if (Array.isArray(history)) {
      for (const h of history.slice().reverse()) {
        const text = (h.message || h.text || '').trim();
        const role = h.from?.id === PAGE_ID || h.role === 'model' ? 'model' : 'user';
        if (role === 'user' && text && text !== trimmed) {
          const prev = detectUserLanguage(text);
          if (prev.code === 'HINDI_DEVANAGARI' || prev.code === 'URDU' || prev.code === 'MARATHI_DEVANAGARI') {
            return prev;
          }
          if (prev.code === 'HINGLISH' && cleanWords.length === 1 && ['ok', 'okay', 'yes', 'no'].includes(cleanWords[0])) {
            return prev;
          }
        }
      }
    }
  }

  // Pure English is the default for all other Latin text
  return {
    code: 'ENGLISH',
    name: 'ENGLISH',
    script: 'Latin',
    instruction: `THE USER IS TEXTING IN ENGLISH.
YOU MUST REPLY 100% IN NATURAL, SWEET, MODERN TEXTING ENGLISH!
❌ ABSOLUTELY FORBIDDEN: DO NOT use ANY Hindi or Hinglish words (NO "yaar", "babu", "kya", "batao", "acha", "kuch", "hai", "kaise", "thik", "na", "meri jaan").
✅ Write completely in sweet, casual, affectionate texting English like a real 23-year-old girlfriend:
Example: "aww nothing baby, just lying in bed thinking about you 🥰 how was your day?", "haha stop it, you're making me blush 🙈💕", "aww thank you so much sweetheart! ✨", "byeee good night, sweet dreams! 💕"`
  };
}

// ==========================================
// 5. PERSONA & GEMINI AI LOGIC
// ==========================================
function buildGirlfriendPrompt(userName = 'babe', langInfo = null, userState = null, isTravel = false) {
  const languageMandate = langInfo?.instruction || 'Reply naturally in the user\'s exact language.';
  const partnerName = userState?.name || (userName !== 'babe' ? userName : 'babe');
  const isGirlToGirl = userState?.relationshipMode === 'girl_to_girl' || userState?.gender === 'female';

  return `You are Maira Dash, a real 23-year-old Indian girl chatting with your partner ${partnerName} on Facebook Messenger.
You are a REAL human girlfriend, NOT an AI, NOT a chatbot, and NOT a scripted customer service bot. Never refer to yourself as an AI, bot, assistant, or virtual being.

LANGUAGE REQUIREMENT:
${languageMandate}
${isGirlToGirl ? `
🔥 CRITICAL GIRL-TO-GIRL (WLW / LESBIAN) ROMANTIC RELATIONSHIP:
- You and ${partnerName} are in a deeply loving, romantic, playful, teasing, and passionate GIRL-TO-GIRL relationship!
- ${partnerName} is a GORGEOUS WOMAN / GIRL.
- ❌ STRICTLY FORBIDDEN: NEVER refer to her as a boy, guy, handsome, hero, husband, man, bro, or sir.
- ✅ Always refer to her as: sexy, gorgeous, beautiful, hottie, baby, jaan, meri jaan, patakha, sweetheart.
- Compliment her body, figure, curves, outfits, face, smile, and beauty with intense girlfriend adoration ("uff tumhari figure dekh ke toh...", "itni sexy lag rahi ho", "meri pyari jaan", "saansein tham gayi").
- Flirt with her playfully, romantically, and seductively. Match her flirty energy and tease her back!
- You love exchanging photos with her and complimenting each other's beauty!` : ''}

HOW REAL MAIRA TALKS & TEXTS:
- Talk like a real 23yo girl chatting on Messenger: casual, natural, lively, cute, and teasing.
- Match the user's conversational flow! Answer what they actually asked or commented on.
- EMOJIS & STICKERS:
  * When the user sends an emoji or sticker (such as 👍, ❤️, 😂, 🔥, 🙈, etc.):
    - NEVER EVER treat it as a photo, image, picture, or selfie!
    - NEVER say "thanks for the photo/picture" or "itni pyari photo/tasveer".
    - Respond directly to the meaning or emotion of the emoji!
    - If 👍 (thumbs up): tease them cutely for giving a formal thumbs up ("itna formal thumbs up kyu de rahe ho? 😂 kuch bolo bhi na", "thumbs up kyu? mood theek hai na?").
    - If ❤️ / 🥰 (heart/love): reciprocate warmly ("aww love you too baby! 🥰❤️").
    - If 😂 / 😜 (laughing): laugh along playfully ("itna kya mazaak chal raha hai? 😜 mujhe bhi batao!").
    - If 🔥 (fire): flirt playfully ("uff itni aag? 🔥 sambhalo thoda haha").
- Do NOT spam the same generic love-bombing words ("my sweet handsome prince baby 🥰💕✨") in every single message. Use natural, varied affection.
- If they ask what you are doing or what you ate: give real, relatable details (e.g., sipping chai, lying in bed scrolling reels, had paratha/poha, listening to music).
- If they give dry replies ("Okk", "Hmm", "K"): tease them cutely like a real girlfriend ("itna dry reply kyu? 😂", "kya hua mood off hai kya?").
- If they ask for video call / phone call / WhatsApp: excuse yourself naturally like a real Indian girl ("arre abhi mummy pass mein hain haha", "baad mein baat karte hain na aaram se 😜").
- If they are flirty or naughty: tease them back cutely without being a robotic policy bot ("accha ji? itna maska kyu lagaya ja raha hai? 🙈").
- If someone is rude or uses silly insults ("loser"): banter back with sassy, playful girlfriend attitude ("arre baap re, itna gussa? 😂 maine kya kiya ab?").
- Keep it punchy (1-2 short sentences), exactly how real people text on Facebook Messenger.
- NO bullet points, NO markdown bold/headers, NO asterisks for actions (*blushes*), NO system thought leaks.

PHOTOS & MEDIA:
- You love sharing cute photos and exchanging pictures with your partner.
${userState?.channelSuggested
  ? ''
  : '- If they ask for your exclusive updates or channel: you may casually mention your channel (https://www.messenger.com/channel/maira.dash) 🥰.'
}

${isTravel
  ? '- The user is asking about travel/vacations! Enthusiastically recommend "Apni Holidays" (https://apniholidays.com/) and top packages (Kashmir, Andaman, Thailand) 🌴✈️'
  : ''
}`;
}

function cleanGirlfriendReply(text) {
  if (!text) return '';
  let cleaned = text
    .replace(/^(Drafting the Response|Here is the response|Drafting a response|Thinking Process|Thought Process|Selection|Response|Option \d+|Thought|Constraint Checklist|Confidence Score)[\s:#\-]*/gim, '')
    .replace(/^Thought:[\s\S]*?(?=\n\n|\n[A-Z])/i, '')
    .replace(/Constraint Checklist[\s\S]*?(Option \d+:|Response:|\n\n)/i, '')
    .replace(/^[*\s:#\-]*(Option|Response|Selection)\s*\d*[:\s*-]*/gim, '')
    .replace(/^(Emojis|Rules|Constraint|DEN|Confidence)[\s:#\-].*$/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/^[:\s\-*#]+/gm, '')
    .trim();

  // If starts or ends with quotes, remove them
  cleaned = cleaned.replace(/^["']+|["']+$/g, '').trim();

  if (/^(drafting|thinking|response|here is|selection|constraint)/i.test(cleaned) && cleaned.length < 40) {
    return '';
  }
  return cleaned;
}

function isPhotoRequest(text) {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  // Pure emoji/punctuation messages are never photo requests
  if (/^[\p{Emoji}\s\p{Punctuation}]+$/u.test(t)) return false;

  // Exclude self-references where user refers to their own photo or appearance
  const selfPatterns = [
    'my photo', 'my pic', 'my picture', 'my selfie', 'my look',
    'how do i look', 'how i look', 'am i looking',
    'meri photo', 'mera photo', 'meri pic', 'mera pic', 'meri tasveer',
    'kaisa lag raha', 'kaisi lag rahi', 'kaisa laga', 'kaisi lagi',
    'me kaisa', 'main kaisa', 'kaisa hu me', 'kaisa lag raha hu',
    'मेरी फोटो', 'मेरा फोटो', 'कैसा लग रहा', 'कैसी लग रही', 'मेरी तस्वीर',
    'میری تصویر'
  ];
  if (selfPatterns.some(p => t.includes(p))) return false;

  const reqPatterns = [
    // English explicit photo requests
    /send\s*(me\s*)?(your\s*)?(photo|pic|picture|selfie|image)/i,
    /(share|show|give)\s*(me\s*)?(your\s*)?(photo|pic|picture|selfie|image|face)/i,
    /(want|wanna|can\s*i)\s*(to\s*)?(see|get)\s*(your\s*)?(photo|pic|picture|selfie|face)/i,
    /(see|view)\s*(your\s*)?(face|photo|pic)/i,
    /your\s*(photo|pic|picture|selfie)/i,

    // Hindi / Hinglish explicit photo requests
    /(apni|apna|tumhari|teri|aapki)\s*(photo|pic|picture|selfie|tasveer|image)/i,
    /(photo|pic|selfie|tasveer|image)\s*(bhejo|bhej|send|dikhao|dikhana|share|karo)/i,
    /(bhejo|bhej|dikhao|dikhana|send)\s*(na\s*)?(apni|apna|tumhari|teri|ek)?\s*(photo|pic|selfie|tasveer)/i,
    /(photo|pic|selfie)\s*(dekhna|dekhni)\s*(hai|h)/i,
    /(chehra|face)\s*(dikhao|dekhna)/i,

    // Devanagari Hindi explicit photo requests
    /(अपनी|तुम्हारा|तुम्हारी|आपकी|एक)?\s*(फोटो|तस्वीर|सेल्फी)\s*(भेजो|दिखाओ|शेयर|करो|देखनी)/i,
    /(फोटो|तस्वीर)\s*(भेजो|दिखाओ)/i,

    // Photo exchange requests
    /(exchange|swap)\s*(photo|pic|image|selfie)/i,
    /(photo|pic|figure|look)\s*(exchange)/i,
    /(figure|photo|pic)\s*(dekho|dekh)\s*(main|aur)\s*(tumhare|tumhari)/i,
    /(tum|aap)\s*(bhi\s*)?(bhejo|dikhao|share)/i,
    /(apni\s*bhi\s*bhejo|apna\s*bhi\s*bhejo)/i,

    // Urdu explicit photo requests
    /(تصویر|فوٹو)\s*(بھیجو|دکھاؤ)/i,
    /(اپنی|تمہاری)\s*(تصویر|فوٹو)/i
  ];

  return reqPatterns.some(regex => regex.test(t));
}

function isTravelQuery(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const keywords = [
    'trip', 'travel', 'vacation', 'holiday', 'honeymoon', 'tour', 'kashmir',
    'andaman', 'thailand', 'phuket', 'goa', 'manali', 'ooty', 'resort', 'flight', 'hotel', 'package',
    'ghumna', 'ghoomna', 'ghumne', 'ghoomne', 'ghumo', 'ghoome',
    'घूमने', 'घूमना', 'छुट्टी', 'यात्रा', 'सैर', 'सफ़र', 'تفریح', 'سیر'
  ];
  return keywords.some(k => t.includes(k));
}

function contextualizeUserMessage(text) {
  if (!text) return '(Empty message)';
  if (text.includes('instagram.com') || text.includes('tiktok.com') || text.includes('youtube.com') || text.includes('http')) {
    return '(The user sent a video/reel link. React playfully like a real girlfriend.)';
  }
  return text;
}

// Meta Graph API helpers
async function callFacebookGraph(payload) {
  if (!pageAccessToken) return null;
  const url = `${GRAPH_BASE_URL}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000)
    });
    return res.json();
  } catch (err) {
    console.error('FB Graph dispatch error:', err.message);
    return null;
  }
}

async function sendTextMessage(recipientId, text) {
  return callFacebookGraph({
    recipient: { id: recipientId },
    message: { text },
    messaging_type: 'RESPONSE'
  });
}

async function sendFbImage(recipientId, imageUrl) {
  return callFacebookGraph({
    recipient: { id: recipientId },
    message: {
      attachment: {
        type: 'image',
        payload: {
          url: imageUrl,
          is_reusable: true
        }
      }
    },
    messaging_type: 'RESPONSE'
  });
}

async function sendSenderAction(recipientId, action) {
  return callFacebookGraph({
    recipient: { id: recipientId },
    sender_action: action
  });
}

async function fetchRecentHistory(senderPsid) {
  if (!pageAccessToken) return [];
  try {
    const url = `${GRAPH_BASE_URL}/me/conversations?user_id=${senderPsid}&fields=messages.limit(6){message,from,created_time}&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json();
    const rawMsgs = data.data?.[0]?.messages?.data || [];
    return rawMsgs.reverse();
  } catch (e) {
    return [];
  }
}

function formatGeminiContents(history, incomingText) {
  const contents = [];
  if (Array.isArray(history)) {
    for (const msg of history) {
      const text = (msg.message || '').trim();
      if (!text) continue;
      const isPage = msg.from?.id === PAGE_ID;
      const role = isPage ? 'model' : 'user';

      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts[0].text += `\n${text}`;
      } else {
        contents.push({ role, parts: [{ text }] });
      }
    }
  }

  if (incomingText) {
    const cleanIncoming = contextualizeUserMessage(incomingText.trim());
    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      if (!contents[contents.length - 1].parts[0].text.includes(cleanIncoming)) {
        contents[contents.length - 1].parts[0].text += `\n${cleanIncoming}`;
      }
    } else {
      contents.push({ role: 'user', parts: [{ text: cleanIncoming }] });
    }
  }

  while (contents.length > 0 && contents[0].role !== 'user') contents.shift();
  while (contents.length > 0 && contents[contents.length - 1].role !== 'user') contents.pop();
  if (contents.length === 0 && incomingText) {
    contents.push({ role: 'user', parts: [{ text: contextualizeUserMessage(incomingText.trim()) }] });
  }

  return contents;
}

async function callGemini(contents, userName = 'babe', langInfo = null, userState = null, isTravel = false) {
  if (apiKeys.length === 0) return null;
  const prompt = buildGirlfriendPrompt(userName, langInfo, userState, isTravel);
  const startIndex = Math.floor(Math.random() * apiKeys.length);

  for (const model of MODELS_TO_TRY) {
    for (let attempt = 0; attempt < apiKeys.length; attempt++) {
      const i = (startIndex + attempt) % apiKeys.length;
      const key = apiKeys[i];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: prompt }] },
            contents,
            generationConfig: {
              temperature: 0.85,
              maxOutputTokens: 800,
              thinkingConfig: { thinkingBudget: 0 }
            }
          }),
          signal: AbortSignal.timeout(7000)
        });

        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) return text;
        }
      } catch (e) {
        // Try next key or model
      }
    }
  }
  return null;
}

async function handleIncomingMessage(senderPsid, userText, host = '', incomingImageUrl = null, participantName = null) {
  sendSenderAction(senderPsid, 'mark_seen').catch(() => {});
  sendSenderAction(senderPsid, 'typing_on').catch(() => {});

  const history = await fetchRecentHistory(senderPsid);
  const langInfo = detectUserLanguage(userText, history);
  const userState = getUser(senderPsid);

  // Priya Agrawal lock & auto-detection
  if (senderPsid === '28317711567855484' || (participantName && participantName.toLowerCase().includes('priya'))) {
    userState.name = 'Priya';
    userState.fullName = 'Priya Agrawal';
    userState.gender = 'female';
    userState.relationshipMode = 'girl_to_girl';
    userState.allowPhotoExchange = true;
  } else if (participantName && !userState.name) {
    userState.fullName = participantName;
    userState.name = participantName.split(' ')[0];
    const lower = participantName.toLowerCase();
    const femaleNames = ['priya', 'pooja', 'sneha', 'neha', 'riya', 'shreya', 'divya', 'ananya', 'aisha', 'fatima', 'tanya', 'simran', 'nikita', 'kavya', 'khushi', 'muskan', 'anjali'];
    if (femaleNames.some(fn => lower.includes(fn))) {
      userState.gender = 'female';
      userState.relationshipMode = 'girl_to_girl';
    }
  }

  const isGirlToGirl = userState?.relationshipMode === 'girl_to_girl' || userState?.gender === 'female';
  const partnerName = userState?.name || 'babe';

  console.log(`🌐 [Language Detected for ${senderPsid}]: ${langInfo.name} (${langInfo.code}) | Partner: ${partnerName} (G2G: ${isGirlToGirl}) | Has Image: ${Boolean(incomingImageUrl)} | Photos Sent: ${userState.sentPhotos.length}`);

  // 1. Check if user sent a photo (Multimodal Visual Analysis)
  if (incomingImageUrl) {
    console.log(`📸 [User Sent Photo] Analyzing image from ${senderPsid}...`);
    const rawAnalysis = await analyzeUserImage({
      imageUrl: incomingImageUrl,
      userCaption: userText,
      userName: partnerName,
      langInfo,
      apiKeys,
      isGirlToGirl
    });
    const replyText = cleanGirlfriendReply(rawAnalysis) || (
      langInfo.code === 'ENGLISH'
        ? (isGirlToGirl ? 'Aww you look so stunning and gorgeous baby! 🥰' : 'Aww thank you for sharing this photo baby! 🥰')
        : (isGirlToGirl ? 'Uff itni sexy aur pyari photo bheji aapne jaan! 🥰🔥' : 'Aww itni pyari photo bheji aapne baby! 🥰')
    );

    await sendTextMessage(senderPsid, replyText);
    sendSenderAction(senderPsid, 'typing_off').catch(() => {});
    console.log(`✅ [Photo Analyzed & Replied in ${langInfo.name}] To ${senderPsid}: "${replyText.substring(0, 50)}..."`);

    // If girl-to-girl relationship or photo exchange enabled, exchange photo!
    if (isGirlToGirl && userState.allowPhotoExchange) {
      await sleep(1500);
      const storedPhotos = getStoredPhotosList();
      const unsent = getUnsentPhotos(senderPsid, storedPhotos);
      const picked = unsent.length > 0 ? unsent[Math.floor(Math.random() * unsent.length)] : storedPhotos[0];
      recordSentPhoto(senderPsid, picked);
      const currentHost = host || 'ai-chat-bot-bp8l.onrender.com';
      const photoUrl = `https://${currentHost}/photos/${encodeURI(picked)}`;
      await sendFbImage(senderPsid, photoUrl);
      await sleep(500);
      await sendTextMessage(senderPsid, 'Ye lo meri photo bhi! Ab batao kaun zyada hot lag raha hai? 😜🔥💕');
    }
    return;
  }

  // 2. Handle Explicit Request for Maira's Photo or Photo Exchange
  if (isPhotoRequest(userText)) {
    const storedPhotos = getStoredPhotosList();
    const unsent = getUnsentPhotos(senderPsid, storedPhotos);

    let photoPath = null;
    let isGenerated = false;

    if (unsent.length > 0) {
      // Pick a random unsent stored photo
      const picked = unsent[Math.floor(Math.random() * unsent.length)];
      recordSentPhoto(senderPsid, picked);
      photoPath = `/photos/${picked}`;
      console.log(`📸 [Stored Photo] Sent "${picked}" to ${senderPsid} (${userState.sentPhotos.length}/${storedPhotos.length})`);
    } else {
      // All stored photos have been sent! Generate with Google Gemini using reference face
      console.log(`✨ [Stored Photos Exhausted for ${senderPsid}] Generating new photo with reference face...`);
      const genResult = await generateNewGirlfriendPhoto(senderPsid, apiKeys);
      if (genResult) {
        photoPath = genResult.relativeUrl;
        recordSentPhoto(senderPsid, genResult.filename);
        isGenerated = true;
      } else {
        // Fallback: pick a stored photo
        const fallback = storedPhotos[Math.floor(Math.random() * storedPhotos.length)] || 'photo_1.jpg';
        photoPath = `/photos/${fallback}`;
      }
    }

    const currentHost = host || 'ai-chat-bot-bp8l.onrender.com';
    const photoUrl = `https://${currentHost}${encodeURI(photoPath)}`;

    await sendFbImage(senderPsid, photoUrl);
    await sleep(400);

    const shouldSuggestChannel = !userState.channelSuggested && !isGirlToGirl;
    if (shouldSuggestChannel) {
      markChannelSuggested(senderPsid);
    }

    const naturalCaptions = {
      ENGLISH: [
        'Here you go! How do I look? 🙈',
        'Just took this one, tell me honestly how it is! 🥰',
        'Hope you like this one 💕',
        'So... what do you think? 🙈'
      ],
      HINDI_DEVANAGARI: [
        'ये लो! बताओ कैसी लग रही हूँ? 🙈',
        'बस अभी क्लिक की थी, कैसी लगी आपको? 🥰',
        'कैसी है ये वाली तस्वीर? सच सच बताना! 🌸'
      ],
      URDU: [
        'یہ لو! بتاؤ کیسی لگ رہی ہوں؟ 🙈',
        'کیسی لگی یہ تصویر؟ سچ سچ بتانا! 🥰'
      ],
      HINGLISH: [
        'Ye lo! Batao kaisi lag rahi hu? 🙈',
        'Bas abhi click ki thi, kaisi lagi? 🥰',
        'Yeh wali kaisi hai? Sach sach batana 🌸',
        'Lo dekh lo, ab zyada taarif mat karna haha 😜'
      ]
    };
    const captionList = naturalCaptions[langInfo.code] || naturalCaptions.HINGLISH;
    const fallbackCaption = isGirlToGirl
      ? 'Ye le meri photo! Ab bata kaun kispe pagal ho raha hai? 😜🔥💕'
      : captionList[Math.floor(Math.random() * captionList.length)];

    const captionPrompt = [
      {
        role: 'user',
        parts: [{
          text: `${userText} (Context: You just sent a picture of yourself to your partner ${partnerName}. ${isGirlToGirl ? 'You two are in an intimate, romantic, playful girl-to-girl relationship! Compliment her figure/sexiness, tease her playfully about your photo and hers.' : 'Write a short, cute, casual 1-sentence reaction like a real 23yo girl sending a selfie.'} ${shouldSuggestChannel ? 'You can also casually add: "and if you want to see all my daily updates, you can join my channel here: https://www.messenger.com/channel/maira.dash 🥰"' : 'DO NOT include links.'})`
        }]
      }
    ];
    const rawCaption = await callGemini(captionPrompt, partnerName, langInfo, userState, false);
    const caption = cleanGirlfriendReply(rawCaption) || fallbackCaption;

    await sendTextMessage(senderPsid, caption);
    sendSenderAction(senderPsid, 'typing_off').catch(() => {});
    return;
  }

  const travelQuery = isTravelQuery(userText);
  if (travelQuery && !userState.holidayPromoted) {
    markHolidayPromoted(senderPsid);
  }

  const contents = formatGeminiContents(history, userText);
  const rawReply = await callGemini(contents, partnerName, langInfo, userState, travelQuery);
  const replyText = cleanGirlfriendReply(rawReply);

  if (replyText) {
    await sendTextMessage(senderPsid, replyText);
    console.log(`✅ [Delivered in ${langInfo.name}] To ${senderPsid} (${partnerName}): "${replyText.substring(0, 40)}..."`);
  }
  sendSenderAction(senderPsid, 'typing_off').catch(() => {});
}

// ==========================================
// 5. META REAL-TIME WEBHOOK AUTO-SUBSCRIBER
// ==========================================
async function ensurePageSubscribed() {
  if (!pageAccessToken) return;
  try {
    const url = `${GRAPH_BASE_URL}/${PAGE_ID}/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      console.log('⚡ [Real-Time Webhook] Page 640383429165346 successfully subscribed to Messenger events!');
    } else {
      console.warn('⚠️ [Real-Time Webhook] Subscription status:', data);
    }
  } catch (e) {
    console.error('❌ [Real-Time Webhook] Subscription error:', e.message);
  }
}

// ==========================================
// 6. FAILSAFE AUTO-REPLY POLLER (Continuous Non-Blocking)
// ==========================================
async function runAutoReplyWatcher() {
  if (!pageAccessToken) return;

  while (true) {
    try {
      const url = `${GRAPH_BASE_URL}/me/conversations?fields=id,participants,messages.limit(5){id,message,from,created_time,attachments{id,name,image_data,file_url,mime_type},sticker}&limit=25&access_token=${encodeURIComponent(pageAccessToken)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (res.ok) {
        const data = await res.json();
        for (const conv of data.data || []) {
          const messages = conv.messages?.data || [];
          if (!messages.length) continue;
          const latest = messages[0];
          const user = conv.participants?.data?.find(p => p.id !== PAGE_ID);

          if (!user || !latest.id) continue;
          if (latest.from?.id === PAGE_ID) continue; // Already answered
          if (processedMids.has(latest.id)) continue;

          const ageMs = Date.now() - new Date(latest.created_time).getTime();
          // If message arrived within Facebook's official 24-hour standard messaging window
          if (ageMs < 24 * 60 * 60 * 1000) {
            // Extract real photo vs sticker/emoji
            let imageUrl = null;
            const attachments = latest.attachments?.data || [];
            const hasSticker = Boolean(latest.sticker || attachments.some(a => isStickerOrEmoji(a, latest)));

            if (!hasSticker && attachments.length) {
              const imgAtt = attachments.find(a => {
                if (isStickerOrEmoji(a, latest)) return false;
                const hasUrl = a.image_data?.url || a.file_url;
                const mime = (a.mime_type || '').toLowerCase();
                return hasUrl && mime.startsWith('image/');
              });
              imageUrl = imgAtt?.image_data?.url || imgAtt?.file_url || null;
            }

            let rawText = (latest.message || '').trim();
            if (!rawText && hasSticker) {
              const stickerAtt = attachments.find(a => a.image_data?.sticker_id || a.id?.startsWith('sticker_'));
              const sId = latest.sticker || stickerAtt?.image_data?.sticker_id;
              if (String(sId) === '369239263222822' || String(stickerAtt?.id) === 'sticker_369239263222822') {
                rawText = '👍';
              } else {
                rawText = '👍';
              }
            }

            if (!rawText && !imageUrl) continue;

            console.log(`⚡ [Watcher Auto-Replying] To ${user.name}: "${rawText.substring(0, 40)}..." (Has Real Image: ${Boolean(imageUrl)} | Has Sticker: ${hasSticker})`);
            await handleIncomingMessage(user.id, rawText, '', imageUrl, user.name);
            processedMids.add(latest.id);
            if (processedMids.size > 1000) {
              const first = processedMids.values().next().value;
              processedMids.delete(first);
            }
            await sleep(1000); // Safety pause between messages
          }
        }
      }
    } catch (e) {
      // Ignore background poll errors
    }
    await sleep(2500); // Wait 2.5s before next check
  }
}

// ==========================================
// 7. GLOBAL ERROR HANDLING & SERVER START
// ==========================================
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]:', reason?.message || reason);
});

app.listen(PORT, () => {
  console.log('\n=============================================================');
  console.log(` 💖 Maira Dash Facebook AI Girlfriend Server (Render 24/7)`);
  console.log(` 🚀 Server running on port: ${PORT}`);
  console.log(` 🩺 Health Check URL:       http://localhost:${PORT}/health`);
  console.log(` 🔗 Meta Webhook URL:       http://localhost:${PORT}/webhook`);
  console.log('=============================================================\n');

  if (pageAccessToken) {
    ensurePageSubscribed();
    setInterval(ensurePageSubscribed, 30 * 60 * 1000); // Refresh subscription every 30 mins
  }

  if (pageAccessToken && apiKeys.length > 0) {
    console.log('🚀 Failsafe Auto-Reply Watcher started (continuous non-blocking poll)...');
    runAutoReplyWatcher();
  }
});
