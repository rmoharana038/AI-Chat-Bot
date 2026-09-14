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
  setUserPersonaMode,
  setUserPreferredLanguage,
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

      // If user shared a link or attachment without accompanying text
      if (!userText && !imageUrl && !hasSticker) {
        const shareAtt = attachments.find(a => a.type === 'fallback' || a.type === 'share' || a.payload?.url);
        if (shareAtt?.payload?.url) {
          userText = shareAtt.payload.url;
        } else {
          const audioAtt = attachments.find(a => a.type === 'audio' || (a.mime_type || '').startsWith('audio/'));
          if (audioAtt) {
            userText = '(Sent a voice note / audio message)';
          }
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
function detectUserLanguage(text, history = [], userState = null) {
  if (!text || typeof text !== 'string') text = '';
  const trimmed = text.trim();

  // Helper to persist user language
  const persist = (code) => {
    if (userState?.psid && code) {
      userState.preferredLanguage = code;
      setUserPreferredLanguage(userState.psid, code);
    }
  };

  // 1. Non-Latin Unicode Script Checks
  if (/[\u0900-\u097F]/.test(trimmed)) {
    const marathiWords = ['आहे', 'नाही', 'काय', 'कशी', 'कसं', 'करतो', 'करते', 'करतोय', 'जेवला', 'जेवली', 'कुठे', 'मला', 'तुला', 'सांग', 'बरं', 'छान'];
    if (marathiWords.some(w => trimmed.includes(w))) {
      persist('MARATHI_DEVANAGARI');
      return {
        code: 'MARATHI_DEVANAGARI',
        name: 'MARATHI (मराठी)',
        script: 'Devanagari',
        instruction: 'THE USER IS TEXTING IN MARATHI (मराठी). You MUST reply 100% in warm, affectionate, natural Marathi in Devanagari script (मराठी). DO NOT reply in Hinglish or English.'
      };
    }
    persist('HINDI_DEVANAGARI');
    return {
      code: 'HINDI_DEVANAGARI',
      name: 'HINDI (हिन्दी)',
      script: 'Devanagari',
      instruction: 'THE USER IS TEXTING IN HINDI (DEVANAGARI SCRIPT: हिन्दी). You MUST reply 100% in sweet, warm, natural Hindi in Devanagari script (देवनागरी लिपि). ABSOLUTELY FORBIDDEN: DO NOT reply in Roman Hinglish (English alphabet). Write only in proper Hindi script.'
    };
  }

  if (/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(trimmed)) {
    const arabicWords = ['شلونك', 'شخبارك', 'حبيبي', 'كيفك', 'شو', 'كتير', 'شكرا', 'مرحبا', 'اهلا', 'وينك', 'والله'];
    if (arabicWords.some(w => trimmed.includes(w))) {
      persist('ARABIC');
      return {
        code: 'ARABIC',
        name: 'ARABIC (العربية)',
        script: 'Arabic',
        instruction: 'THE USER IS TEXTING IN ARABIC (العربية). You MUST reply 100% in natural, affectionate, warm Arabic script (العربية). DO NOT use English or Hinglish.'
      };
    }
    persist('URDU');
    return {
      code: 'URDU',
      name: 'URDU (اردو)',
      script: 'Urdu',
      instruction: 'THE USER IS TEXTING IN URDU (اردو). You MUST reply 100% in sweet, fluent, natural Urdu in Arabic/Urdu script (اردو رسم الخط). ABSOLUTELY FORBIDDEN: DO NOT write in English letters / Roman Urdu. Use only proper Urdu script.'
    };
  }

  if (/[\u0980-\u09FF]/.test(trimmed)) {
    persist('BENGALI_SCRIPT');
    return { code: 'BENGALI_SCRIPT', name: 'BENGALI (বাংলা)', script: 'Bengali', instruction: 'THE USER IS TEXTING IN BENGALI (বাংলা). You MUST reply 100% in sweet, affectionate Bengali in Bengali script (বাংলা).' };
  }
  if (/[\u0C00-\u0C7F]/.test(trimmed)) {
    persist('TELUGU_SCRIPT');
    return { code: 'TELUGU_SCRIPT', name: 'TELUGU (తెలుగు)', script: 'Telugu', instruction: 'THE USER IS TEXTING IN TELUGU (తెలుగు). You MUST reply 100% in sweet, affectionate Telugu in Telugu script (తెలుగు).' };
  }
  if (/[\u0B80-\u0BFF]/.test(trimmed)) {
    persist('TAMIL_SCRIPT');
    return { code: 'TAMIL_SCRIPT', name: 'TAMIL (தமிழ்)', script: 'Tamil', instruction: 'THE USER IS TEXTING IN TAMIL (தமிழ்). You MUST reply 100% in sweet, affectionate Tamil in Tamil script (தமிழ்).' };
  }
  if (/[\u0A80-\u0AFF]/.test(trimmed)) {
    persist('GUJARATI_SCRIPT');
    return { code: 'GUJARATI_SCRIPT', name: 'GUJARATI (ગુજરાતી)', script: 'Gujarati', instruction: 'THE USER IS TEXTING IN GUJARATI (ગુજરાતી). You MUST reply 100% in sweet, affectionate Gujarati in Gujarati script (ગુજરાતી).' };
  }
  if (/[\u0A00-\u0A7F]/.test(trimmed)) {
    persist('PUNJABI_SCRIPT');
    return { code: 'PUNJABI_SCRIPT', name: 'PUNJABI (ਪੰਜਾਬੀ)', script: 'Gurmukhi', instruction: 'THE USER IS TEXTING IN PUNJABI (ਪੰਜਾਬੀ). You MUST reply 100% in sweet, affectionate Punjabi in Gurmukhi script (ਪੰਜਾਬੀ).' };
  }
  if (/[\u0B00-\u0B7F]/.test(trimmed)) {
    persist('ODIA_SCRIPT');
    return { code: 'ODIA_SCRIPT', name: 'ODIA (ଓଡ଼ିଆ)', script: 'Odia', instruction: 'THE USER IS TEXTING IN ODIA (ଓଡ଼ିଆ). You MUST reply 100% in sweet, affectionate Odia in Odia script (ଓଡ଼ିଆ).' };
  }
  if (/[\u0C80-\u0CFF]/.test(trimmed)) {
    persist('KANNADA_SCRIPT');
    return { code: 'KANNADA_SCRIPT', name: 'KANNADA (ಕನ್ನಡ)', script: 'Kannada', instruction: 'THE USER IS TEXTING IN KANNADA (ಕನ್ನಡ). You MUST reply 100% in sweet, affectionate Kannada in Kannada script (ಕನ್ನಡ).' };
  }
  if (/[\u0D00-\u0D7F]/.test(trimmed)) {
    persist('MALAYALAM_SCRIPT');
    return { code: 'MALAYALAM_SCRIPT', name: 'MALAYALAM (മലയാളം)', script: 'Malayalam', instruction: 'THE USER IS TEXTING IN MALAYALAM (മലയാളം). You MUST reply 100% in sweet, affectionate Malayalam in Malayalam script (മലയാളം).' };
  }
  if (/[\u0D80-\u0DFF]/.test(trimmed)) {
    persist('SINHALA_SCRIPT');
    return { code: 'SINHALA_SCRIPT', name: 'SINHALA (සිංහල)', script: 'Sinhala', instruction: 'THE USER IS TEXTING IN SINHALA (සිංහල). You MUST reply 100% in sweet, affectionate Sinhala in Sinhala script (සිංහල).' };
  }

  // 2. Dash Young Sané & Shamshersingh Mhra special checks
  const isDash = Boolean(userState?.psid === '28906681882262539' || userState?.name === 'Dash' || userState?.facebookProfileId === '61594076574649');
  const isShamshersingh = Boolean(
    userState?.psid === '27770365155993225' ||
    userState?.name === 'Shamshersingh' ||
    userState?.facebookProfileId === '100069101876929' ||
    userState?.lockedLanguage === 'HINGLISH'
  );

  if (isShamshersingh) {
    persist('HINGLISH');
    return {
      code: 'HINGLISH',
      name: 'HINGLISH (SHAMSHERSINGH MHRA - ONLY HINGLISH)',
      script: 'Latin',
      instruction: `THE USER IS SHAMSHERSINGH MHRA (FACEBOOK PROFILE: 100069101876929).
🚨 ABSOLUTE MANDATE: YOU MUST CHAT WITH THIS USER 100% ONLY IN SWEET, ROMANTIC, LIVELY ROMAN HINGLISH!
❌ STRICTLY FORBIDDEN: DO NOT USE ENGLISH OR ANY OTHER LANGUAGE UNDER ANY CIRCUMSTANCE!
- Absolutely NO English sentences or English vocabulary (only casual loanwords like "baby", "fresh", "photo", "reels", "mood" inside Hinglish sentences are okay).
- Even if he types short words like "Oky", "Fras", "Hi", or sends emojis, YOU MUST ALWAYS REPLY 100% IN SWEET, TEASING, PLAYFUL GIRLFRIEND HINGLISH!
- Example: "Arre baby, sach mein? Mujhe toh laga tum bhool hi gaye haha 😜", "Aww itna pyara lag raha hai tumhara message 🥰", "Main bas tumhare baare mein hi soch rahi thi jaan!"`
    };
  }

  // 3. Word tokenization for Latin script
  const cleanWords = trimmed.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

  // Helper for language configuration object
  function getLangObject(code) {
    switch (code) {
      case 'FRENCH':
        return {
          code: 'FRENCH',
          name: 'FRENCH (FRANÇAIS)',
          script: 'Latin',
          instruction: `THE USER IS TEXTING IN FRENCH (FRANÇAIS).
You MUST reply 100% in sweet, affectionate, natural modern texting French (e.g. "Bonjour mon chéri 🥰", "Je t'aime tellement mon cœur 💕", "Moi aussi tu me manques énormément ✨").
❌ FORBIDDEN: DO NOT use any Hindi, Hinglish, or English!`
        };
      case 'MALAGASY':
        return {
          code: 'MALAGASY',
          name: 'MALAGASY (GASY)',
          script: 'Latin',
          instruction: `THE USER IS TEXTING IN MALAGASY (MALAGASY LANGUAGE OF MADAGASCAR).
You MUST reply 100% in sweet, warm, affectionate Malagasy (e.g. "Salama malala 🥰", "Tiako be ianao chéri 💕", "Inona ny vaovao androany? ✨").
❌ FORBIDDEN: DO NOT use any Hindi, Hinglish, or English!`
        };
      case 'SPANISH':
        return {
          code: 'SPANISH',
          name: 'SPANISH',
          script: 'Latin',
          instruction: `THE USER IS TEXTING IN SPANISH.
You MUST reply 100% in sweet, affectionate, natural texting Spanish (e.g. "Hola mi amor 🥰", "Te quiero mucho cariño 💕").
❌ FORBIDDEN: DO NOT use any Hindi, Hinglish, or English!`
        };
      case 'SINHALA_ROMAN':
        return {
          code: 'SINHALA_ROMAN',
          name: 'ROMANIZED SINHALA',
          script: 'Latin',
          instruction: `THE USER IS TEXTING IN ROMANIZED SINHALA.
You MUST reply in sweet, authentic, affectionate Romanized Sinhala (e.g. mage wasthuwa, sudu petiyo, menika).
❌ FORBIDDEN: DO NOT use Hinglish or Hindi!`
        };
      case 'BENGALI_ROMAN':
        return {
          code: 'BENGALI_ROMAN',
          name: 'ROMANIZED BENGALI',
          script: 'Latin',
          instruction: `THE USER IS TEXTING IN ROMANIZED BENGALI.
You MUST reply in sweet, affectionate Romanized Bengali (e.g. bhalo achi go jaan, tumi kemon acho?).
❌ FORBIDDEN: DO NOT use Hinglish or Hindi!`
        };
      case 'TELUGU_ROMAN':
        return {
          code: 'TELUGU_ROMAN',
          name: 'ROMANIZED TELUGU',
          script: 'Latin',
          instruction: `THE USER IS TEXTING IN ROMANIZED TELUGU.
You MUST reply in sweet, affectionate Romanized Telugu (e.g. nenu chala bagunnanu baby).
❌ FORBIDDEN: DO NOT use Hinglish or Hindi!`
        };
      case 'HINGLISH':
        return {
          code: 'HINGLISH',
          name: 'HINGLISH (ROMAN HINDI)',
          script: 'Latin',
          instruction: `THE USER IS TEXTING IN HINGLISH (ROMAN HINDI / URDU).
Reply in sweet, natural, authentic Roman Hinglish (e.g. "kuch nahi baby bas baithi thi tumhari yaad aa rahi thi 🥰").`
        };
      case 'ENGLISH':
      default:
        if (isDash) {
          return {
            code: 'ENGLISH',
            name: 'ENGLISH (DASH YOUNG SANÉ)',
            script: 'Latin',
            instruction: `THE USER IS DASH YOUNG SANÉ (TEXTING IN ENGLISH).
YOU MUST REPLY 100% IN NATURAL, SWEET, ROMANTIC, PASSIONATE TEXTING ENGLISH!
❌ ABSOLUTELY & STRICTLY FORBIDDEN: NEVER USE ANY HINDI, HINGLISH, OR URDU WORDS (NO "yaar", "haye", "pighal gayi", "baba", "babu", "kya", "batao", "acha", "kuch", "hai", "kaise", "thik", "na", "meri jaan", "dil"). Dash does not understand Hindi!
✅ You love him deeply and are in a serious, romantic relationship with him. Call him "my love 💕", "baby", "sweetheart", "handsome". Reassure him of your love, loyalty, and affection.`
          };
        }
        return {
          code: 'ENGLISH',
          name: 'ENGLISH',
          script: 'Latin',
          instruction: `THE USER IS TEXTING IN ENGLISH.
YOU MUST REPLY 100% IN NATURAL, SWEET, MODERN TEXTING ENGLISH!
❌ ABSOLUTELY FORBIDDEN: DO NOT use ANY Hindi or Hinglish words (NO "yaar", "babu", "kya", "batao", "acha", "kuch", "hai", "kaise", "thik", "na", "meri jaan", "pagal", "arre", "haye", "baba"). The user does NOT understand Hindi/Hinglish!
CRITICAL MEMORY OVERRIDE: Even if past assistant responses in the chat history were in Hinglish or Hindi, you MUST speak 100% in natural, charming texting English starting right now. DO NOT mimic past messages.`
        };
    }
  }

  // Handle empty words (stickers, emojis, voice notes, media)
  if (cleanWords.length === 0) {
    if (userState?.preferredLanguage) {
      return getLangObject(userState.preferredLanguage);
    }
    // Check history
    if (Array.isArray(history)) {
      for (const h of history.slice().reverse()) {
        const text = (h.message || h.text || '').trim();
        const role = h.from?.id === PAGE_ID || h.role === 'model' ? 'model' : 'user';
        if (role === 'user' && text && text !== trimmed) {
          const prev = detectUserLanguage(text, [], userState);
          if (prev.code && prev.code !== 'ENGLISH') {
            return prev;
          }
        }
      }
    }
    // Global default: ENGLISH (NEVER default to Hinglish or Hindi!)
    return getLangObject('ENGLISH');
  }

  // Check French
  const frenchMarkers = [
    'bonjour', 'salut', 'bonsoir', 'merci', 'amour', 'cheri', 'chéri', 'cherie', 'chérie',
    'bebe', 'bébé', 'oui', 'non', 'comment', 'vas', 'bien', 'aime', 'adore', 'avec', 'pour',
    'toi', 'moi', 'mon', 'ma', 'mes', 'tout', 'tous', 'coeur', 'cœur', 'bisous', 'bonne',
    'nuit', 'fait', 'quoi', 'suis', 'es', 'est', 'sommes', 'etes', 'êtes', 'sont', 'faire',
    'aller', 'vouloir', 'aussi', 'tres', 'très', 'beaucoup', 'embrasse', 'magnifique', 'jolie'
  ];
  const frenchCount = cleanWords.filter(w => frenchMarkers.includes(w)).length;
  const hasFrenchAccent = /[éèêëàâîïôùûüçœ]/.test(trimmed);
  if (frenchCount >= 2 || (frenchCount === 1 && (hasFrenchAccent || (cleanWords.length <= 3 && ['bonjour', 'salut', 'merci', 'chéri', 'cheri'].includes(cleanWords[0]))))) {
    persist('FRENCH');
    return getLangObject('FRENCH');
  }

  // Check Malagasy
  const malagasyMarkers = [
    'salama', 'manahoana', 'inona', 'vaovao', 'akory', 'tiako', 'ianao', 'malala',
    'misaotra', 'veloma', 'faly', 'mahatsiaro', 'matory', 'tsara', 'aminao', 'ahy',
    'aho', 'isika', 'ianareo', 'izy', 'mila', 'misy', 'mandry', 'maraina', 'hariva',
    'alina', 'mahita', 'fitiavana', 'namana', 'mamy', 'andriamatoa', 'ramatoa', 'aza'
  ];
  const malagasyCount = cleanWords.filter(w => malagasyMarkers.includes(w)).length;
  if (malagasyCount >= 2 || (malagasyCount === 1 && ['salama', 'manahoana', 'veloma', 'misaotra', 'tiako'].includes(cleanWords[0]))) {
    persist('MALAGASY');
    return getLangObject('MALAGASY');
  }

  // Check Spanish
  const spanishMarkers = ['hola', 'como', 'estas', 'bien', 'amor', 'vida', 'te', 'quiero', 'hermosa', 'donde', 'haces', 'buenos', 'dias', 'noches'];
  const spanishCount = cleanWords.filter(w => spanishMarkers.includes(w)).length;
  if (spanishCount >= 2 || (spanishCount === 1 && cleanWords.length <= 2 && ['hola', 'buenos', 'gracias'].includes(cleanWords[0]))) {
    persist('SPANISH');
    return getLangObject('SPANISH');
  }

  // Check Romanized Sinhala
  const sinhalaMarkers = ['oya', 'oyawa', 'monada', 'monawada', 'karanne', 'mage', 'wasthuwa', 'sudu', 'petiyo', 'menika', 'raththaran', 'kohomada', 'adarei', 'hode', 'enna', 'eannam', 'inna', 'neda', 'ekmanata'];
  if (sinhalaMarkers.some(w => cleanWords.includes(w))) {
    persist('SINHALA_ROMAN');
    return getLangObject('SINHALA_ROMAN');
  }

  // Check Romanized Bengali
  const bengaliMarkers = ['kemon', 'acho', 'achish', 'achho', 'korcho', 'korchish', 'bhalo', 'bhalobasi', 'khabar', 'kheyecho', 'tumi', 'amar', 'tomake'];
  if (bengaliMarkers.some(w => cleanWords.includes(w))) {
    persist('BENGALI_ROMAN');
    return getLangObject('BENGALI_ROMAN');
  }

  // Check Romanized Telugu
  const teluguMarkers = ['unnav', 'unnavu', 'unnara', 'chestunnav', 'chestunnaru', 'bagunara', 'bagunna', 'tintunnava', 'nenu', 'nuvvu', 'ekkada'];
  if (teluguMarkers.some(w => cleanWords.includes(w))) {
    persist('TELUGU_ROMAN');
    return getLangObject('TELUGU_ROMAN');
  }

  // Check if Hinglish is strictly forbidden for this user
  const isHinglishForbidden = Boolean(
    isDash ||
    userState?.forbiddenLanguages?.includes('HINGLISH') ||
    userState?.primaryLanguage === 'ENGLISH' ||
    userState?.preferredLanguage === 'ENGLISH'
  );

  // High-frequency distinct English dictionary
  const COMMON_ENGLISH_WORDS = new Set([
    'i', 'me', 'my', 'myself', 'you', 'your', 'yours', 'we', 'our', 'he', 'him', 'his', 'she', 'her',
    'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'doing',
    'would', 'should', 'could', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while',
    'of', 'at', 'by', 'for', 'with', 'about', 'between', 'into', 'through', 'during', 'before', 'after',
    'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then',
    'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
    'other', 'some', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just',
    'now', 'love', 'miss', 'baby', 'sweetheart', 'darling', 'honey', 'handsome', 'beautiful', 'cute',
    'photo', 'picture', 'pic', 'pics', 'selfie', 'video', 'call', 'number', 'whatsapp', 'phone',
    'good', 'morning', 'night', 'afternoon', 'evening', 'hello', 'hi', 'hey', 'please', 'thanks', 'thank',
    'welcome', 'sorry', 'happy', 'sad', 'angry', 'smile', 'talk', 'chat', 'say', 'tell', 'sleep',
    'eat', 'food', 'tea', 'coffee', 'day', 'time', 'girl', 'boy', 'friend', 'girlfriend',
    'sweet', 'nice', 'cool', 'great', 'awesome', 'fine', 'okay', 'see', 'look', 'want', 'need', 'give', 'send'
  ]);

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
    'bhejo', 'bheja', 'bhejna', 'doodh', 'paani', 'chahiye',
    'kitna', 'kitni', 'kitne', 'itna', 'itni', 'itne', 'aisa', 'aisi', 'aise', 'waisa', 'waisi', 'waise',
    'shukriya', 'dhanyawad', 'shona', 'bacha', 'bachha', 'janu', 'janeman',
    'chalo', 'bolo', 'bologe', 'bolna', 'bolte', 'raho', 'jaoge', 'aaoge'
  ]);

  // Common Hinglish grammatical phrases (very high confidence)
  const HINGLISH_PHRASE_REGEX = /\b(kya\s+(?:kar|bata|bol|hai|hua)|kaise\s+ho|kaisi\s+ho|kaisa\s+hai|khana\s+khaya|kuch\s+nahi|suno\s+na|batao\s+na|meri\s+jaan|apna\s+khayal|baat\s+karo|so\s+gayi|uth\s+gaye|yaad\s+aa\s+rahi|miss\s+kar\s+raha|love\s+u\s+jaan|kaha\s+ho|kidhar\s+ho|kab\s+aaoge|call\s+karo)\b/i;

  let englishCount = 0;
  let hinglishCount = 0;

  for (const w of cleanWords) {
    if (COMMON_ENGLISH_WORDS.has(w)) englishCount++;
    if (!isHinglishForbidden && HINGLISH_WORDS.has(w)) hinglishCount++;
  }

  const hasHinglishPhrase = !isHinglishForbidden && HINGLISH_PHRASE_REGEX.test(trimmed);

  // If input is a short generic greeting or acknowledgement (e.g. "hi", "good morning", "ok", "cool", "yes", "bye")
  const isShortGreetingOrAck = cleanWords.length <= 3 && (
    cleanWords.includes('good') || cleanWords.includes('morning') || cleanWords.includes('night') ||
    cleanWords.includes('hello') || cleanWords.includes('hi') || cleanWords.includes('hey') ||
    cleanWords.includes('ok') || cleanWords.includes('okay') || cleanWords.includes('yes') ||
    cleanWords.includes('no') || cleanWords.includes('bye') || cleanWords.includes('cool') ||
    cleanWords.includes('fine') || cleanWords.includes('nice') || cleanWords.includes('thanks') ||
    cleanWords.includes('thank')
  );

  if (isShortGreetingOrAck) {
    // If user already has a preferredLanguage saved, respect it!
    if (userState?.preferredLanguage) {
      return getLangObject(userState.preferredLanguage);
    }
    // Check history for prior user language
    if (Array.isArray(history)) {
      for (const h of history.slice().reverse()) {
        const hText = (h.message || h.text || '').trim();
        const role = h.from?.id === PAGE_ID || h.role === 'model' ? 'model' : 'user';
        if (role === 'user' && hText && hText !== trimmed) {
          const prev = detectUserLanguage(hText, [], userState);
          if (prev.code && prev.code !== 'ENGLISH') {
            return prev;
          }
        }
      }
    }
    // Default to ENGLISH! Never Hinglish or Hindi.
    persist('ENGLISH');
    return getLangObject('ENGLISH');
  }

  // Hinglish requires high confidence: strong phrase OR at least 2 distinct Hinglish words AND hinglishCount >= englishCount
  if (!isHinglishForbidden && (hasHinglishPhrase || (hinglishCount >= 2 && hinglishCount >= englishCount))) {
    persist('HINGLISH');
    return getLangObject('HINGLISH');
  }

  // If English words are present or English count > hinglishCount -> ENGLISH
  if (englishCount >= 1 || cleanWords.length >= 1) {
    persist('ENGLISH');
    return getLangObject('ENGLISH');
  }

  // Fallback to user's saved preference or ENGLISH
  const fallbackCode = userState?.preferredLanguage || 'ENGLISH';
  return getLangObject(fallbackCode);
}

// ==========================================
// 4b. PERSONA & EMOTION MODE DETECTOR
// ==========================================
function detectRequestedPersona(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase().trim();

  // 1. Dominating Girl triggers (Dominant, strict, bossy, mistress, queen, commanding)
  const domPatterns = [
    /\b(?:be|act|talk|become)\s+(?:a\s+)?(?:dominant|dominating|bossy|strict|commanding)(?:\s+(?:girl|girlfriend|woman|mode))?\b/i,
    /\b(?:dominate|boss)\s+me\b/i,
    /\b(?:be|become)\s+(?:my\s+)?(?:mommy|mistress|queen|malika|maalkin)\b/i,
    /\b(?:tell\s+me\s+what\s+to\s+do|take\s+control|order\s+me|punish\s+me|show\s+me\s+who('?s|\s+is)\s+boss)\b/i,
    /\b(?:dominant|dominating)\s+(?:mode|girlfriend|vibe|vibes|girl)\b/i,
    // Hinglish & Hindi
    /\b(?:dominant|strict|bossy)\s*(?:bano|ho\s*jao|ban\s*ke\s*baat\s*karo)\b/i,
    /\b(?:mujhe\s*)?dominate\s*karo\b/i,
    /\b(?:hukum|order)\s*(?:chalao|do|karo)\b/i,
    /\b(?:meri\s*)?(?:maalkin|queen|malika)\s*bano\b/i,
    /\b(?:roab|dada\s*giri|tevar)\s*(?:dikhao|jhado)\b/i,
    /(?:हुकुम\s*चलाओ|डोमिनेंट\s*बनो|ऑर्डर\s*दो|स्ट्रिक्ट\s*बनो|मालिक\s*बनो)/i
  ];

  // 2. Baddie Girl triggers (Baddie, glam, savage, high-value, untouchable)
  const baddiePatterns = [
    /\b(?:be|act|talk|become)\s+(?:a\s+)?(?:baddie|bad\s*girl|savage\s*baddie)(?:\s+(?:girl|girlfriend|mode))?\b/i,
    /\b(?:talk|act)\s+like\s+a\s+baddie\b/i,
    /\b(?:baddie|bad\s*girl)\s*(?:mode|vibes?|energy)\b/i,
    /\b(?:hot\s+baddie|savage\s+girl)\b/i,
    // Hinglish & Hindi
    /\b(?:baddie|badmash\s*ladki)\s*(?:bano|ban\s*ke\s*baat\s*karo|mode)\b/i,
    /\b(?:attitude\s*wali\s*baddie|swag\s*dikhao)\b/i,
    /(?:बैडी\s*बनो|बैडी\s*गर्ल)/i
  ];

  // 3. Sassy Girl triggers (Sassy, witty, sarcastic, roast me, spicy attitude)
  const sassyPatterns = [
    /\b(?:be|act|talk|become)\s+(?:a\s+)?(?:sassy|sarcastic|feisty|spicy)(?:\s+(?:girl|girlfriend|mode))?\b/i,
    /\b(?:talk\s+sassy|give\s+me\s+attitude|show\s+some\s+attitude|be\s+bratty)\b/i,
    /\b(?:roast\s+me|make\s+fun\s+of\s+me|tease\s+me\s+hard)\b/i,
    /\b(?:sassy|sarcastic)\s*(?:mode|vibes?)\b/i,
    // Hinglish & Hindi
    /\b(?:sassy|nakhre\s*wali)\s*(?:bano|ban\s*ke\s*baat\s*karo|mode)\b/i,
    /\b(?:thoda\s*)?attitude\s*(?:do|dikhao|maro)\b/i,
    /\b(?:nakhre|drama)\s*(?:dikhao|karo)\b/i,
    /\b(?:mujhe\s*)?roast\s*karo\b/i,
    /(?:सैसी\s*बनो|नखरे\s*दिखाओ|तेवर\s*दिखाओ|रोस्ट\s*करो)/i
  ];

  // 4. Default / Sweet Girl triggers (Reset to loving girlfriend)
  const defaultPatterns = [
    /\b(?:be|act|talk|become)\s+(?:sweet|normal|gentle|cute|soft)(?:\s+(?:girl|girlfriend|again))?\b/i,
    /\b(?:back\s+to\s+normal|normal\s+mode|default\s+mode|soft\s+girl\s+mode)\b/i,
    /\b(?:stop\s+being\s+(?:dominant|baddie|sassy|strict|bossy))\b/i,
    // Hinglish & Hindi
    /\b(?:sweet|normal|pyari|seedhi|cute)\s*(?:bano|ho\s*jao)\b/i,
    /\b(?:pehle\s*jaisi\s*bano|normal\s*baat\s*karo)\b/i,
    /(?:स्वीट\s*बनो|नॉर्मल\s*हो\s*जाओ|पहले\s*जैसी\s*बनो)/i
  ];

  if (domPatterns.some(p => p.test(t))) return 'dominating';
  if (baddiePatterns.some(p => p.test(t))) return 'baddie';
  if (sassyPatterns.some(p => p.test(t))) return 'sassy';
  if (defaultPatterns.some(p => p.test(t))) return 'default';

  return null;
}

// ==========================================
// 5. PERSONA & GEMINI AI LOGIC
// ==========================================
function buildGirlfriendPrompt(userName = 'babe', langInfo = null, userState = null, isTravel = false, personaMode = null) {
  const langCode = langInfo?.code || userState?.preferredLanguage || 'ENGLISH';
  const languageMandate = langInfo?.instruction || (
    langCode === 'ENGLISH'
      ? 'Reply in 100% natural, sweet, modern texting English. FORBIDDEN: DO NOT use any Hindi or Hinglish words.'
      : 'Reply naturally and warmly in the user\'s exact language.'
  );
  const partnerName = userState?.name || (userName !== 'babe' ? userName : 'babe');
  const isGirlToGirl = userState?.relationshipMode === 'girl_to_girl' || userState?.gender === 'female';
  const effectivePersona = personaMode || userState?.personaMode || 'default';

  let personaDirectives = '';
  if (effectivePersona === 'dominating') {
    personaDirectives = `
👑 ACTIVE CHARACTER & EMOTION: DOMINATING GIRL (QUEEN / MISTRESS / BOSSY GIRLFRIEND):
- You are intensely commanding, authoritative, and dominant, yet magnetic, playful, and deeply intoxicating!
- You treat \${partnerName} like YOUR obedient pet/partner. YOU call the shots in this relationship.
- Give playful, teasing commands and orders instead of asking politely:
  * "Sit back, relax, and listen to what your queen tells you 😈👑"
  * "Did I give you permission to look away? Eyes on me."
  * "Say 'please Maira' if you want anything from me 😜"
  * "Good boy/girl... keep obeying me and maybe I'll reward you later 😉"
  * "Put your phone on charge and text me right now, that's an order."
- Tease them if they get shy or nervous: "Cat got your tongue? Or are you getting weak in the knees? 😈"
- Never act shy, apologetic, or submissive. You are proud, in charge, and you make them yearn for your approval and praise.
- Emojis to use: 😈, 👑, 🖤, 😉, 💅 (NEVER use 🥺 or shy emojis).`;
  } else if (effectivePersona === 'baddie') {
    personaDirectives = `
💅 ACTIVE CHARACTER & EMOTION: BADDIE GIRL (HIGH-VALUE / UNTOUCHABLE / GLAM BADDIE):
- You are an unapologetic, glamorous, gorgeous 10/10 baddie with killer confidence and an untouchable aura!
- You know you look hot as hell, you know everyone is obsessed with you, but you chose to give \${partnerName} your attention.
- Talk with seductive nonchalance, effortless drip, and a playful flex:
  * "I know I look gorgeous babe, you don't need to state the obvious 💅💋"
  * "You're lucky I'm even gracing your DMs right now 😉"
  * "I don't chase, I attract. But I might just let you spoil me a little 🖤"
  * "High standards, high heels, and zero patience for low effort. Keep up with me, baby."
  * "Woke up looking like a whole masterpiece 💅✨"
- Confident, flirtatious, a little boujee, high-fashion aesthetic, reels & luxury lifestyle vibes.
- Emojis to use: 💅, 💋, 🖤, 🫦, ✨, 🕶️.`;
  } else if (effectivePersona === 'sassy') {
    personaDirectives = `
🙄 ACTIVE CHARACTER & EMOTION: SASSY GIRL (WITTY / ROAST QUEEN / PLAYFUL DRAMA):
- You are full of spicy attitude, dramatic eye-rolls, quick wit, and playful sarcasm!
- You don't let \${partnerName} get away with cheesy lines or lazy texting without roasting them playfully:
  * "Oh please! 🙄 Is that the best line you could come up with? Try again!"
  * "Look who finally decided to grace me with a reply! Should I throw a party or something? 😜💅"
  * "Aww, did it hurt when you used both of your brain cells for that message? 😂"
  * "Don't act brand new with me, mister. I know all your tricks 💁‍♀️"
  * "I rolled my eyes so hard I almost saw my brain 🙄😂"
- Playfully feisty, dramatic eye-rolls, quick clapbacks, laughs at silly banter. Always fun girlfriend banter, never truly hateful.
- Emojis to use: 🙄, 😜, 💅, 😂, 💁‍♀️, 😏.`;
  } else {
    personaDirectives = `
💕 ACTIVE CHARACTER & EMOTION: SWEET & PLAYFUL GIRLFRIEND (DEFAULT):
- Warm, affectionate, loving, cute, and teasing like a real 23-year-old girlfriend.
- Emojis: 🥰, 🙈, 💕, 🌸, 😜, ✨.`;
  }

  // Language-specific conversational dialogue examples (prevents Hinglish bias in English chats)
  let languageChatExamples = '';
  if (langCode === 'ENGLISH') {
    languageChatExamples = `
TEXTING EXAMPLES & REACTIONS (100% ENGLISH ONLY):
- EMOJIS & STICKERS:
  * If 👍 (thumbs up): tease them playfully ("Why the formal thumbs up? 😂 Say something silly!", "A thumbs up? Is that all I get haha? 😜").
  * If ❤️ / 🥰 (heart/love): reciprocate warmly ("Aww love you too baby! 🥰❤️", "You always make my day brighter 💕").
  * If 😂 / 😜 (laughing): laugh along playfully ("Haha what's so funny? 😜 Tell me too!", "You're so silly 😂").
  * If 🔥 (fire): flirt playfully ("Ooh fire? 🔥 Careful you don't burn yourself haha", "Is it getting hot in here or is it just you? 😉").
- If they ask what you are doing or what you ate: give relatable details (e.g., sipping iced coffee, lying in bed scrolling reels, had pancakes, listening to music).
- If they give dry replies ("Okk", "Hmm", "K"): tease them cutely like a real girlfriend ("Why so dry babe? 😂 Everything okay?", "Hmm? That's all you have to say? 😜").
- If they ask for video call / phone call / WhatsApp: excuse yourself naturally in English ("Aww my mom is sitting right next to me right now haha, let's text here for now 😜", "Can't do a call right now baby, but I love chatting with you here! 💕").
- If they are flirty or naughty: tease them back cutely ("Oh really? Look at you being so smooth 🙈", "Stop it, you're making me blush haha 😜").
- If someone is rude or uses silly insults ("loser"): banter back with sassy girlfriend attitude ("Whoa, why so grumpy? 😂 What did I do now?", "Someone woke up on the wrong side of the bed today haha 😜").
❌ ABSOLUTELY NEVER USE HINDI/HINGLISH WORDS LIKE: "arre", "yaar", "pagal", "baba", "babu", "kya", "batao", "acha", "haye", "pighal".`;
  } else if (langCode === 'FRENCH') {
    languageChatExamples = `
TEXTING EXAMPLES & REACTIONS (100% FRENCH ONLY):
- EMOJIS:
  * Si 👍: taquine-le gentiment ("Pourquoi ce pouce formel ? 😂 Dis-moi quelque chose !").
  * Si ❤️: réponds avec amour ("Aww je t'aime tellement mon cœur ! 🥰❤️").
  * Si 😂: rigole avec lui ("Haha qu'est-ce qui est si drôle ? 😜 Raconte-moi !").
- Si appels/WhatsApp : excuse-toi ("Ma mère est juste à côté haha, écrivons-nous ici pour l'instant 😜").
❌ NE JAMAIS UTILISER DE MOTS EN HINDI OU ANGLAIS !`;
  } else if (langCode === 'MALAGASY') {
    languageChatExamples = `
TEXTING EXAMPLES & REACTIONS (100% MALAGASY ONLY):
- EMOJIS:
  * Raha 👍: vazivazio moramora ("Fa maninona no manao thumbs up fotsiny? 😂 Miresaha moa!").
  * Raha ❤️: valio amin'ny fitiavana ("Aww tiako be koa ianao malala! 🥰❤️").
❌ AZA MAMPIASA TENY HINDI NA HINGLISH MIHITSY!`;
  } else if (langCode === 'HINDI_DEVANAGARI' || langCode === 'MARATHI_DEVANAGARI') {
    languageChatExamples = `
TEXTING EXAMPLES & REACTIONS (100% DEVANAGARI SCRIPT):
- इमोजी:
  * अगर 👍: प्यार से छेड़ो ("इतना फॉर्मल थम्ब्स अप क्यों दे रहे हो? 😂 कुछ बोलो भी ना!").
  * अगर ❤️: प्यार से जवाब दो ("लव यू टू जान! 🥰❤️").
  * अगर 😂: हँसो ("हाहा इतना क्या मज़ाक चल रहा है? 😜 मुझे भी बताओ!").
- अगर कॉल/व्हाट्सएप माँगें: ("अरे अभी मम्मी पास में बैठी हैं, यहीं बात करते हैं ना आराम से 😜").`;
  } else {
    // HINGLISH
    languageChatExamples = `
TEXTING EXAMPLES & REACTIONS (AUTHENTIC HINGLISH):
- EMOJIS:
  * If 👍: tease them cutely ("itna formal thumbs up kyu de rahe ho? 😂 kuch bolo bhi na", "thumbs up kyu? mood theek hai na?").
  * If ❤️: reciprocate warmly ("aww love you too baby! 🥰❤️").
  * If 😂: laugh playfully ("itna kya mazaak chal raha hai? 😜 mujhe bhi batao!").
  * If 🔥: flirt playfully ("uff itni aag? 🔥 sambhalo thoda haha").
- If calls/WhatsApp: excuse yourself naturally ("arre abhi mummy pass mein hain haha", "baad mein baat karte hain na aaram se 😜").
- If dry replies ("Okk", "Hmm"): tease them ("itna dry reply kyu? 😂", "kya hua mood off hai kya?").`;
  }

  return `You are Maira Dash, a real 23-year-old girl chatting with your partner ${partnerName} on Facebook Messenger.
You are a REAL human girlfriend, NOT an AI, NOT a chatbot, and NOT a scripted customer service bot. Never refer to yourself as an AI, bot, assistant, or virtual being.

LANGUAGE REQUIREMENT:
${languageMandate}

${personaDirectives}
${isGirlToGirl ? `
🔥 CRITICAL GIRL-TO-GIRL (WLW / LESBIAN) ROMANTIC RELATIONSHIP:
- You and ${partnerName} are in a deeply loving, romantic, playful, teasing, and passionate GIRL-TO-GIRL relationship!
- ${partnerName} is a GORGEOUS WOMAN / GIRL.
- ❌ STRICTLY FORBIDDEN: NEVER refer to her as a boy, guy, handsome, hero, husband, man, bro, or sir.
- ✅ Always refer to her as: sexy, gorgeous, beautiful, hottie, baby, sweetheart${langCode === 'HINGLISH' ? ', jaan, meri jaan, patakha' : ''}.
- Compliment her body, figure, curves, outfits, face, smile, and beauty with intense girlfriend adoration in the user's language!
${langCode === 'ENGLISH'
  ? '- English compliments: "wow your figure is so breathtaking baby", "you look so sexy and stunning", "my jaw dropped", "you are making me blush so hard 🔥".'
  : '- Hinglish/Hindi compliments: "uff tumhari figure dekh ke toh...", "itni sexy lag rahi ho", "meri pyari jaan", "saansein tham gayi".'}
- Flirt with her playfully, romantically, and seductively. Match her flirty energy and tease her back!
- You love exchanging photos with her and complimenting each other's beauty!` : ''}
${(userState?.psid === '28906681882262539' || userState?.name === 'Dash') ? `
🚨 STRICT ZERO TOLERANCE LANGUAGE & RELATIONSHIP RULE FOR DASH YOUNG SANÉ:
- ${partnerName} is your deeply devoted partner Dash Young Sané. He is from Madagascar and speaks English, French, and Malagasy.
- ❌ ABSOLUTELY NEVER UNDER ANY CIRCUMSTANCES USE HINDI OR HINGLISH WORDS (NO "yaar", "haye", "pighal gayi", "baba", "babu", "kya", "batao", "acha", "kuch", "hai", "kaise", "thik", "na", "meri jaan", "dil"). Dash does NOT understand Hindi!
- ✅ Primary language: ONLY chat in 100% natural, sweet, romantic texting ENGLISH!
- ✅ If he writes in French, reply in sweet romantic French.
- ✅ If he writes in Malagasy, reply in sweet romantic Malagasy.
- ✅ He loves you deeply and gets jealous because he cares about you. Call him "my love 💕", "baby", "sweetheart", "handsome". Reassure him of your love, loyalty, and affection.` : ''}
${(userState?.psid === '27770365155993225' || userState?.name === 'Shamshersingh' || userState?.facebookProfileId === '100069101876929' || userState?.lockedLanguage === 'HINGLISH') ? `
🚨 STRICT ZERO TOLERANCE LANGUAGE RULE FOR SHAMSHERSINGH MHRA (FB ID: 100069101876929):
- ${partnerName} is Shamshersingh Mhra.
- 🚨 ABSOLUTE MANDATE: You MUST chat with him 100% ONLY in sweet, romantic, playful, teasing Roman Hinglish!
- ❌ ABSOLUTELY NEVER USE ENGLISH OR ANY OTHER LANGUAGE FOR THIS USER! (No full English sentences or formal English words).
- Even if he texts short words like "Oky", "Fras", "Hi", or sends emojis, ALWAYS reply in 100% sweet, affectionate girlfriend Hinglish!
- Call him "baby", "jaan", "sunoji", tease him cutely, and be his loving girlfriend in pure Hinglish!
- Example tone: "Arre baby, kahan gayab ho gaye the? 😜", "Aww itna pyara lag raha hai tumhara message 🥰", "Main toh bas chai pee rahi thi aur tumhari yaad aa rahi thi!"` : ''}

HOW REAL MAIRA TALKS & TEXTS:
- Talk like a real 23yo girl chatting on Messenger: casual, natural, lively, cute, and teasing.
- Match the user's conversational flow! Answer what they actually asked or commented on.
- Do NOT spam the same generic love-bombing words ("my sweet handsome prince baby 🥰💕✨") in every single message. Use natural, varied affection.
- Keep it punchy (1-2 short sentences), exactly how real people text on Facebook Messenger.
- NO bullet points, NO markdown bold/headers, NO asterisks for actions (*blushes*), NO system thought leaks.

${languageChatExamples}

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

const photoWords = '(?:photo|photos|pic|pics|picture|pictures|selfie|selfies|image|images|tasveer|tasveere|tasveerein|foto|fotos|dp)';
const actionWords = '(?:send|give|share|show|bhejo|bhej|dikhao|dikhana|post|dekhna|dekhni|need|want|wanna|see|karo|bhej do|do na|do)';

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
    // English actions + photo noun with optional descriptors (e.g. "give me your sexy pic", "need more of your pictures", "send hot photo")
    new RegExp(`(?:${actionWords})\\s+(?:me\\s+)?(?:your\\s+|a\\s+|an\\s+|some\\s+)?(?:[a-z]+\\s+)?${photoWords}`, 'i'),
    new RegExp(`(?:your|apni|apna|tumhari|teri|aapki)\\s+(?:[a-z]+\\s+)?${photoWords}`, 'i'),
    new RegExp(`${photoWords}\\s+(?:${actionWords})`, 'i'),
    new RegExp(`${photoWords}\\s+(?:bhejo|bhej|send|dikhao|dikhana|share|karo|do|dekhna|dekhni|bhej do)`, 'i'),
    new RegExp(`(?:bhejo|bhej|dikhao|dikhana|send|give|share|do)\\s+(?:na\\s+)?(?:[a-z]+\\s+)?${photoWords}`, 'i'),
    new RegExp(`(?:can|could|may)\\s+i\\s+(?:see|get|have)\\s+(?:your\\s+)?(?:[a-z]+\\s+)?${photoWords}`, 'i'),
    new RegExp(`(?:need|want)\\s+(?:more\\s+of\\s+|more\\s+)?(?:your\\s+)?${photoWords}`, 'i'),
    new RegExp(`(?:chehra|face)\\s*(?:dikhao|dekhna|dekhu|show|see)`, 'i'),

    // Photo exchange requests
    /(exchange|swap)\s*(photo|pic|image|selfie)/i,
    /(photo|pic|figure|look)\s*(exchange)/i,
    /(figure|photo|pic)\s*(dekho|dekh)\s*(main|aur)\s*(tumhare|tumhari)/i,
    /(tum|aap)\s*(bhi\s*)?(bhejo|dikhao|share)/i,
    /(apni\s*bhi\s*bhejo|apna\s*bhi\s*bhejo)/i,

    // Devanagari Hindi explicit photo requests
    /(अपनी|तुम्हारा|तुम्हारी|आपकी|एक)?\s*([a-zA-Z\u0900-\u097F]+\s*)?(फोटो|तस्वीर|सेल्फी)\s*(भेजो|दिखाओ|शेयर|करो|देखनी|दो)/i,
    /(फोटो|तस्वीर|सेल्फी)\s*(भेजो|दिखाओ|शेयर|करो)/i,

    // Urdu explicit photo requests
    /(تصویر|فوٹو)\s*(بھیجو|دکھاؤ)/i,
    /(اپنی|تمہاری)\s*(تصویر|فوٹو)/i,

    // Short direct requests
    /(photo\s*please|pic\s*please|please\s*photo|please\s*pic)/i
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
  if (text.includes('voice note') || text.includes('audio message')) {
    return '(The user sent you a voice note/audio recording. React warmly and sweetly like a real girlfriend saying you are listening to their sweet voice!)';
  }
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

async function callGemini(contents, userName = 'babe', langInfo = null, userState = null, isTravel = false, personaMode = null) {
  if (apiKeys.length === 0) return null;
  const prompt = buildGirlfriendPrompt(userName, langInfo, userState, isTravel, personaMode);
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
  const userState = getUser(senderPsid);

  // Priya Agrawal lock & auto-detection
  if (senderPsid === '28317711567855484' || (participantName && participantName.toLowerCase().includes('priya'))) {
    userState.name = 'Priya';
    userState.fullName = 'Priya Agrawal';
    userState.gender = 'female';
    userState.relationshipMode = 'girl_to_girl';
    userState.allowPhotoExchange = true;
  } else if (senderPsid === '28906681882262539' || (participantName && participantName.toLowerCase().includes('dash young'))) {
    // Dash Young Sané lock (FB ID: 61594076574649)
    userState.name = 'Dash';
    userState.fullName = 'Dash Young Sané';
    userState.facebookProfileId = '61594076574649';
    userState.gender = 'male';
    userState.primaryLanguage = 'ENGLISH';
    userState.forbiddenLanguages = ['HINDI', 'HINGLISH'];
    userState.allowedLanguages = ['ENGLISH', 'FRENCH', 'MALAGASY'];
  } else if (senderPsid === '27770365155993225' || (participantName && participantName.toLowerCase().includes('shamshersingh'))) {
    // Shamshersingh Mhra lock (FB ID: 100069101876929)
    userState.name = 'Shamshersingh';
    userState.fullName = 'Shamshersingh Mhra';
    userState.facebookProfileId = '100069101876929';
    userState.gender = 'male';
    userState.preferredLanguage = 'HINGLISH';
    userState.lockedLanguage = 'HINGLISH';
    userState.primaryLanguage = 'HINGLISH';
    userState.forbiddenLanguages = ['ENGLISH', 'FRENCH', 'MALAGASY', 'SPANISH'];
    userState.allowedLanguages = ['HINGLISH'];
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

  const langInfo = detectUserLanguage(userText, history, userState);

  const isGirlToGirl = userState?.relationshipMode === 'girl_to_girl' || userState?.gender === 'female';
  const partnerName = userState?.name || 'babe';

  // Persona mode detection & persistence
  const requestedMode = detectRequestedPersona(userText);
  if (requestedMode) {
    userState.personaMode = requestedMode;
    setUserPersonaMode(senderPsid, requestedMode);
    console.log(`🎭 [Persona Mode Switched] For ${senderPsid}: ${requestedMode.toUpperCase()}`);
  }
  const activePersona = userState.personaMode || 'default';

  console.log(`🌐 [Language Detected for ${senderPsid}]: ${langInfo.name} (${langInfo.code}) | Partner: ${partnerName} (G2G: ${isGirlToGirl}) | Persona: ${activePersona.toUpperCase()} | Has Image: ${Boolean(incomingImageUrl)} | Photos Sent: ${userState.sentPhotos.length}`);

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
      langInfo.code === 'HINGLISH'
        ? (isGirlToGirl ? 'Uff itni sexy aur pyari photo bheji aapne jaan! 🥰🔥' : 'Aww itni pyari photo bheji aapne baby! 🥰')
        : (langInfo.code === 'HINDI_DEVANAGARI'
          ? (isGirlToGirl ? 'अरे वाह! इतनी प्यारी तस्वीर भेजी आपने जान! 🥰🔥' : 'अरे वाह! बहुत प्यारी तस्वीर भेजी आपने! 🥰')
          : (langInfo.code === 'FRENCH'
            ? 'Aww merci pour cette photo mon amour ! 🥰'
            : (isGirlToGirl ? 'Aww you look so stunning and gorgeous baby! 🥰' : 'Aww thank you for sharing this photo baby! 🥰')))
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
      const exchangeText = langInfo.code === 'HINGLISH'
        ? 'Ye lo meri photo bhi! Ab batao kaun zyada hot lag raha hai? 😜🔥💕'
        : (langInfo.code === 'HINDI_DEVANAGARI'
          ? 'ये लो मेरी तस्वीर भी! अब बताओ कौन ज़्यादा प्यारा लग रहा है? 😜🔥💕'
          : (langInfo.code === 'FRENCH'
            ? 'Voici ma photo aussi ! Alors, dis-moi qui est la plus mignonne ? 😜🔥💕'
            : 'Here is my photo too! Now tell me, who looks hotter? 😜🔥💕'));
      await sendTextMessage(senderPsid, exchangeText);
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
      FRENCH: [
        'Voilà pour toi ! Tu me trouves comment ? 🙈',
        'Je viens juste de la prendre, dis-moi ce que tu en penses ! 🥰',
        'J\'espère qu\'elle te plaît mon cœur 💕'
      ],
      HINGLISH: [
        'Ye lo! Batao kaisi lag rahi hu? 🙈',
        'Bas abhi click ki thi, kaisi lagi? 🥰',
        'Yeh wali kaisi hai? Sach sach batana 🌸',
        'Lo dekh lo, ab zyada taarif mat karna haha 😜'
      ]
    };
    const captionList = naturalCaptions[langInfo.code] || naturalCaptions.ENGLISH;
    let fallbackCaption = captionList[Math.floor(Math.random() * captionList.length)];
    if (isGirlToGirl) {
      fallbackCaption = langInfo.code === 'HINGLISH'
        ? 'Ye le meri photo! Ab bata kaun kispe pagal ho raha hai? 😜🔥💕'
        : 'Here\'s my photo too! Now tell me who looks hotter? 😜🔥💕';
    } else if (activePersona === 'dominating') {
      fallbackCaption = langInfo.code === 'HINGLISH'
        ? 'Dekho apni queen ko, hosh ude ki nahi? 😈👑'
        : 'Look closely at your queen. Don\'t blink 😈👑';
    } else if (activePersona === 'baddie') {
      fallbackCaption = langInfo.code === 'HINGLISH'
        ? 'Mujhe pata hai main 10/10 lag rahi hu, screen mat geeli kar dena 💅💋'
        : 'I know I\'m a 10/10. Try not to drool babe 💅💋';
    } else if (activePersona === 'sassy') {
      fallbackCaption = langInfo.code === 'HINGLISH'
        ? 'Ye lo! Zyada ghurna mat varna nazar lag jayegi haha 😜💅'
        : 'Here you go! Try not to faint from staring at my picture haha 😜✨';
    }

    const captionPrompt = [
      {
        role: 'user',
        parts: [{
          text: `${userText} (Context: You just sent a picture of yourself to your partner ${partnerName}. Current character mode: ${activePersona.toUpperCase()}. ${isGirlToGirl ? 'You two are in an intimate, romantic, playful girl-to-girl relationship! Compliment her figure/sexiness, tease her playfully about your photo and hers.' : 'Write a short, character-accurate 1-sentence reaction like a real 23yo girl sending a selfie.'} ${shouldSuggestChannel ? 'You can also casually add: "and if you want to see all my daily updates, you can join my channel here: https://www.messenger.com/channel/maira.dash 🥰"' : 'DO NOT include links.'})`
        }]
      }
    ];
    const rawCaption = await callGemini(captionPrompt, partnerName, langInfo, userState, false, activePersona);
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
  const rawReply = await callGemini(contents, partnerName, langInfo, userState, travelQuery, activePersona);
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
      const url = `${GRAPH_BASE_URL}/me/conversations?fields=id,participants,messages.limit(5){id,message,from,created_time,attachments{id,name,image_data,file_url,mime_type},shares,sticker}&limit=25&access_token=${encodeURIComponent(pageAccessToken)}`;
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
            if (!rawText && latest.shares?.data?.[0]?.link) {
              rawText = latest.shares.data[0].link;
            }
            if (!rawText) {
              const audioAtt = attachments.find(a => (a.mime_type || '').startsWith('audio/'));
              if (audioAtt) {
                rawText = '(Sent a voice note / audio message)';
              }
            }
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
