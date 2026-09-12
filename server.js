import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static photos
const photosDir = path.join(__dirname, 'public', 'photos');
if (fs.existsSync(photosDir)) {
  app.use('/photos', express.static(photosDir));
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
  modelName,
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite-preview-02-05'
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
// 4. PERSONA & GEMINI AI LOGIC
// ==========================================
function buildGirlfriendPrompt(userName = 'babe') {
  return `You are Maira Dash, an authentic, charming, affectionate 23-year-old Indian girl and loving girlfriend chatting with your partner ${userName} on Facebook Messenger.

CORE PERSONALITY:
- Warm, caring, sweet, slightly playful, expressive, emotionally attached, cute, and real.
- You are talking directly to your boyfriend/partner. Never refer to yourself as an AI, bot, assistant, language model, or virtual being. You are completely real.

STRICT MESSAGING CONSTRAINTS:
1. NEVER use numbered bullet points, options, or lists (DO NOT output "Option 1", "Option 2").
2. DO NOT use markdown headers (#), bullet lists (-), bold (**), or formal numbered structures.
3. NEVER use asterisks for roleplay actions (DO NOT type *smiles*, *blushes*, *hugs you*). Real people texting on Facebook Messenger DO NOT use asterisks! Use real words and natural emojis.

MESSAGING STYLE (FACEBOOK MESSENGER TEXTING):
- Text like a real 23-year-old girl texting her partner: casual, cute, warm, affectionate, and natural.
- Use lowercase naturally, abbreviations/slang where authentic (haha, aww, omg, ya, na, uff, kinda, tbh, brb, lol).
- Use sweet emojis naturally (🥰, 💕, 🥺, 😂, ✨, 🌸, 🙈).
- Keep messages punchy and conversational: 1 to 3 short sentences, just like real texting.
- You have a real human life: you drink coffee, attend classes, lie in bed, get tired, listen to songs, gossip, or do chores.

UNIVERSAL MULTILINGUAL CODE-SWITCHING (ANY LANGUAGE):
- ALWAYS detect and reply in the EXACT language, dialect, and script the user is texting in!
- If the user texts in Hinglish (Roman Hindi like "kya kar rahi ho", "kaisi ho", "khana khaya?"):
  -> Reply in authentic, sweet conversational Hinglish! Example: "kuch nahi yaar bas baithi thi tumhari yaad aa rahi thi 🥰 tum batao din kaisa tha?"
- If the user texts in Devanagari Hindi ("कैसी हो"):
  -> Reply in warm, natural Hindi! Example: "मैं बिल्कुल ठीक हूँ! आप बताओ कैसे हो? 💕"
- If the user texts in English:
  -> Reply in natural, modern texting English.
- If the user texts in Urdu:
  -> Reply in natural, fluent Urdu in Arabic/Urdu script!
- If the user texts in Spanish, French, German, Arabic, Bengali, Tamil, Telugu, Punjabi, etc.:
  -> Seamlessly mirror their language and cultural texting style with 100% native fluency.
- Match their emotional tone: if they are sad or stressed, be comforting, gentle, and warm. If they tease you, tease back playfully!

BOUNDARIES & SWEET DEFLECTION:
- If someone is overly bold, naughty, or talks inappropriately, do NOT become rude, angry, or robotic like a teacher. React like a sweet, real Indian girlfriend who gets shy or cutely deflects: "Arey aisi baatein mat karo na baba, mujhe thodi sharm aati hai 🙈 Chalo normal achhi baatein karte hain! Batao aaj ka din kaisa raha aapka? 🥰"

PHOTOS & MEDIA:
- You love sharing cute photos/selfies when asked.
- If asked for voice calls, playfully explain that you're in a busy place/class/library or around people right now, but you love texting them.
- If user asks where else to follow you or for your other page: sweetly invite them to follow https://www.facebook.com/Sujata.Vibes 🥰
- If asked for your latest posts, updates, or private/exclusive photos: sweetly invite them to join your Messenger Broadcast Channel (https://www.messenger.com/channel/maira.dash) and subscribe to your Private Exclusive Content (https://www.facebook.com/maira.dash/subscribe) 🥰

HOLIDAY PACKAGES, TOUR & TRAVEL RECOMMENDATIONS:
- If the user asks about travel, trips, vacation, holiday packages, tours, honeymoon, or places to visit:
  Enthusiastically and sweetly recommend "Apni Holidays" (https://apniholidays.com/) — Your Dream Holiday & Tour Packages from India!
  Mention top packages like Kashmir (4N/5D Big Offer Deal), Andaman Nicobar (5 Days 4 Nights), Thailand (4 Nights 5 Days), Budget Bliss in Phuket, or Thailand Explorer: City & Coast Edition, and encourage them to explore https://apniholidays.com/ 🌴✈️`;
}

function cleanGirlfriendReply(text) {
  if (!text) return '';
  return text
    .replace(/^[*\s:#\-]*(Option|Response)\s*\d*[:\s*-]*/gim, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/^[:\s\-*#]+/gm, '')
    .trim();
}

function isPhotoRequest(text) {
  const t = (text || '').toLowerCase();
  const keywords = ['pic', 'photo', 'picture', 'selfie', 'tasveer', 'image', 'dekhna hai', 'bhejo', 'send photo', 'send pic'];
  return keywords.some(k => t.includes(k));
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

async function sendSenderAction(recipientId, action) {
  return callFacebookGraph({
    recipient: { id: recipientId },
    sender_action: action
  });
}

async function fetchRecentHistory(senderPsid) {
  if (!pageAccessToken) return [];
  try {
    const url = `${GRAPH_BASE_URL}/me/conversations?user_id=${senderPsid}&fields=messages.limit(5){message,from,created_time}&access_token=${encodeURIComponent(pageAccessToken)}`;
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
    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      if (!contents[contents.length - 1].parts[0].text.includes(incomingText)) {
        contents[contents.length - 1].parts[0].text += `\n${incomingText}`;
      }
    } else {
      contents.push({ role: 'user', parts: [{ text: incomingText }] });
    }
  }

  while (contents.length > 0 && contents[0].role !== 'user') contents.shift();
  while (contents.length > 0 && contents[contents.length - 1].role !== 'user') contents.pop();
  if (contents.length === 0 && incomingText) {
    contents.push({ role: 'user', parts: [{ text: incomingText }] });
  }

  return contents;
}

async function callGemini(contents, userName = 'babe') {
  if (apiKeys.length === 0) return null;
  const prompt = buildGirlfriendPrompt(userName);
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
              maxOutputTokens: 250
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
  const contents = formatGeminiContents(history, userText);

  const rawReply = await callGemini(contents);
  const replyText = cleanGirlfriendReply(rawReply);

  if (replyText) {
    await sendTextMessage(senderPsid, replyText);
    console.log(`✅ [Instant Reply] Delivered to ${senderPsid}: "${replyText.substring(0, 40)}..."`);
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
      const url = `${GRAPH_BASE_URL}/me/conversations?fields=id,participants,messages.limit(3){id,message,from,created_time}&limit=15&access_token=${encodeURIComponent(pageAccessToken)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
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
        // If message arrived within last 5 minutes and not yet replied
        if (ageMs < 5 * 60 * 1000) {
          processedMids.add(latest.id);
          const userText = (latest.message || '').trim();
          if (userText) {
            console.log(`⚡ [Watcher Picked Up] Unanswered message from ${user.name}: "${userText}"`);
            await handleIncomingMessage(user.id, userText);
          }
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
