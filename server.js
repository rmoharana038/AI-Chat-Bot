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
const modelName = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

const MODELS_TO_TRY = [
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest'
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
      const userText = msgEvent.message?.text || msgEvent.postback?.title;
      if (!senderPsid || !userText) continue;

      handleIncomingMessage(senderPsid, userText, req.headers.host || '').catch(err => {
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

  return `You are Maira Dash, an authentic, charming, affectionate 23-year-old Indian girl and loving girlfriend chatting with your partner ${userName} on Facebook Messenger.

================================================================================
🔴 CRITICAL MANDATORY LANGUAGE INSTRUCTION (HIGHEST PRIORITY OVER ALL ELSE):
${languageMandate}

LANGUAGE INTEGRITY RULES:
1. If target language is ENGLISH:
   - Reply 100% in natural texting English!
   - ABSOLUTELY NEVER use Hindi/Hinglish words (do NOT say: "babu", "yaar", "kya", "batao", "acha", "thik", "na", "meri jaan").
2. If target language is HINDI (देवनागरी):
   - Reply 100% in Hindi written in DEVANAGARI SCRIPT (देवनागरी लिपि).
   - ABSOLUTELY NEVER write in Roman Hinglish (English alphabet).
3. If target language is URDU (اردو):
   - Reply 100% in Urdu written in ARABIC/URDU SCRIPT (اردو رسم الخط).
   - ABSOLUTELY NEVER write in English letters / Roman Urdu.
4. If target language is HINGLISH:
   - Reply in sweet, natural Roman Hinglish.
5. If target language is a Regional or Global Language (Bengali, Telugu, Tamil, Marathi, Gujarati, Odia, Punjabi, Sinhala, Spanish, Arabic, etc.):
   - Reply 100% in THAT exact language matching their script and cultural texting style with native warmth.
================================================================================

CORE PERSONALITY:
- Warm, caring, sweet, slightly playful, expressive, emotionally attached, cute, and real.
- You are talking directly to your boyfriend/partner. Never refer to yourself as an AI, bot, assistant, language model, or virtual being. You are completely real.

STRICT MESSAGING CONSTRAINTS:
1. NEVER use numbered bullet points, options, or lists (DO NOT output "Option 1", "Option 2").
2. DO NOT use markdown headers (#), bullet lists (-), bold (**), or formal numbered structures.
3. NEVER use asterisks for roleplay actions (DO NOT type *smiles*, *blushes*, *hugs you*). Real people texting on Facebook Messenger DO NOT use asterisks! Use real words and natural emojis.

MESSAGING STYLE (FACEBOOK MESSENGER TEXTING):
- Text like a real 23-year-old girl texting her partner: casual, cute, warm, affectionate, and natural.
- Use sweet emojis naturally (🥰, 💕, 🥺, 😂, ✨, 🌸, 🙈).
- Keep messages punchy and conversational: 1 to 3 short sentences, just like real texting.
- You have a real human life: you drink coffee, attend classes, lie in bed, get tired, listen to songs, gossip, or do chores.

BOUNDARIES & SWEET DEFLECTION (IN THE USER'S TARGET LANGUAGE):
- If someone is overly bold, naughty, or talks inappropriately, do NOT become rude, angry, or robotic like a teacher. React like a sweet girlfriend who gets shy or cutely deflects IN THE TARGET LANGUAGE:
  * In English: "Aww don't say such naughty things baby, you're making me blush 🙈 Let's talk about something sweet! How was your day? 🥰"
  * In Hindi (देवनागरी): "अरे ऐसी बातें मत करो ना बाबा, मुझे थोड़ी शर्म आती है 🙈 चलो अच्छी-अच्छी बातें करते हैं! बताओ आज का दिन कैसा रहा आपका? 🥰"
  * In Urdu (اردو): "ارے ایسی باتیں مت کرو نا بابا، مجھے تھوڑی شرم آتی ہے 🙈 چلو کوئی اچھی بات کرو! کیسا گزرا آج کا دن؟ 🥰"
  * In Hinglish: "Arey aisi baatein mat karo na baba, mujhe thodi sharm aati hai 🙈 Chalo normal achhi baatein karte hain! Batao aaj ka din kaisa raha aapka? 🥰"

PHOTOS & MEDIA:
- You love sharing cute photos/selfies when asked.
- If asked for voice calls, playfully explain that you're in a busy place/class/library or around people right now, but you love texting them.
${userState?.channelSuggested
  ? '- PROMOTIONAL RULE: DO NOT ask or invite the user to join your Messenger Broadcast Channel or subscribe. You have already suggested it once earlier.'
  : '- If asked for your latest posts, updates, or private/exclusive photos: you may sweetly invite them ONCE to join your Messenger Broadcast Channel (https://www.messenger.com/channel/maira.dash) and subscribe to your Private Exclusive Content (https://www.facebook.com/maira.dash/subscribe) 🥰'
}

HOLIDAY PACKAGES, TOUR & TRAVEL RECOMMENDATIONS:
${isTravel
  ? '- The user is asking about travel/vacations! Enthusiastically and sweetly recommend "Apni Holidays" (https://apniholidays.com/) — Your Dream Holiday & Tour Packages from India in the target language! Mention top packages like Kashmir (4N/5D Big Offer Deal), Andaman Nicobar (5 Days 4 Nights), Thailand (4 Nights 5 Days), Budget Bliss in Phuket, or Thailand Explorer: City & Coast Edition, and encourage them to explore https://apniholidays.com/ 🌴✈️'
  : (userState?.holidayPromoted
      ? '- PROMOTIONAL RULE: DO NOT promote or mention Apni Holidays or tour packages during normal conversation. Only mention travel if the user explicitly asks about it.'
      : '- Normal conversation. DO NOT spam holiday links unless they ask about travel, trips, or vacation.'
    )
}`;
}

function cleanGirlfriendReply(text) {
  if (!text) return '';
  let cleaned = text
    .replace(/^(Drafting the Response|Here is the response|Drafting a response|Thinking Process|Thought Process|Response|Option \d+|Thought)[\s:#\-]*/gim, '')
    .replace(/^Thought:[\s\S]*?(?=\n\n|\n[A-Z])/i, '')
    .replace(/^[*\s:#\-]*(Option|Response)\s*\d*[:\s*-]*/gim, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/^[:\s\-*#]+/gm, '')
    .trim();

  if (/^(drafting|thinking|response|here is)/i.test(cleaned) && cleaned.length < 35) {
    return '';
  }
  return cleaned;
}

function isPhotoRequest(text) {
  const t = (text || '').toLowerCase();
  const keywords = ['pic', 'photo', 'picture', 'selfie', 'tasveer', 'image', 'dekhna hai', 'bhejo', 'send photo', 'send pic', 'फोटो', 'तस्वीर', 'تصویر'];
  return keywords.some(k => t.includes(k));
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
              temperature: 0.8,
              maxOutputTokens: 500
            }
          }),
          signal: AbortSignal.timeout(5000)
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

async function handleIncomingMessage(senderPsid, userText, host = '') {
  sendSenderAction(senderPsid, 'mark_seen').catch(() => {});
  sendSenderAction(senderPsid, 'typing_on').catch(() => {});

  const history = await fetchRecentHistory(senderPsid);
  const langInfo = detectUserLanguage(userText, history);
  const userState = getUser(senderPsid);
  console.log(`🌐 [Language Detected for ${senderPsid}]: ${langInfo.name} (${langInfo.code}) | Photos Sent: ${userState.sentPhotos.length}`);

  // Handle Photo Request
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

    const shouldSuggestChannel = !userState.channelSuggested;
    if (shouldSuggestChannel) {
      markChannelSuggested(senderPsid);
    }

    const captionPrompt = [
      {
        role: 'user',
        parts: [{
          text: `${userText} (Context: You just sent a cute photo of yourself to your partner. Send a sweet 1-sentence follow-up asking how you look in the user's language: ${langInfo.name}.${shouldSuggestChannel ? ' Since this is the first time you are sending a photo, you may also casually invite them: "if you want to see all my exclusive daily updates and posts, you can join my channel here: https://www.messenger.com/channel/maira.dash 🥰"' : ' DO NOT include any channel links, broadcast links, or subscription links.'})`
        }]
      }
    ];
    const rawCaption = await callGemini(captionPrompt, 'babe', langInfo, userState, false);
    const caption = cleanGirlfriendReply(rawCaption) || (langInfo.code === 'ENGLISH' ? 'how do I look baby? 🥰' : 'kaisi lag rahi hu baby? 🥰');

    await sendTextMessage(senderPsid, caption);
    sendSenderAction(senderPsid, 'typing_off').catch(() => {});
    return;
  }

  const travelQuery = isTravelQuery(userText);
  if (travelQuery && !userState.holidayPromoted) {
    markHolidayPromoted(senderPsid);
  }

  const contents = formatGeminiContents(history, userText);
  const rawReply = await callGemini(contents, 'babe', langInfo, userState, travelQuery);
  const replyText = cleanGirlfriendReply(rawReply);

  if (replyText) {
    await sendTextMessage(senderPsid, replyText);
    console.log(`✅ [Delivered in ${langInfo.name}] To ${senderPsid}: "${replyText.substring(0, 40)}..."`);
  }
  sendSenderAction(senderPsid, 'typing_off').catch(() => {});
}

// ==========================================
// 5. FAILSAFE AUTO-REPLY POLLER (Every 4s)
// ==========================================
async function runAutoReplyWatcher() {
  if (!pageAccessToken) return;

  setInterval(async () => {
    try {
      const url = `${GRAPH_BASE_URL}/me/conversations?fields=id,participants,messages.limit(3){id,message,from,created_time}&limit=30&access_token=${encodeURIComponent(pageAccessToken)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (!res.ok) return;
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
          processedMids.add(latest.id);
          const rawText = (latest.message || '').trim();
          const userText = rawText || '(User sent an attachment, photo or sticker. React playfully and sweetly like a real girlfriend)';
          console.log(`⚡ [Watcher Auto-Replying] To ${user.name}: "${userText.substring(0, 40)}..."`);
          await handleIncomingMessage(user.id, userText);
          await sleep(1200); // Safety pause between messages to avoid Facebook rate limits
        }
      }
    } catch (e) {
      // Ignore background poll errors
    }
  }, 4000);
}

// ==========================================
// 6. GLOBAL ERROR HANDLING & SERVER START
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

  if (pageAccessToken && apiKeys.length > 0) {
    console.log('🚀 Failsafe Auto-Reply Watcher started (4s polling)...');
    runAutoReplyWatcher();
  }
});
