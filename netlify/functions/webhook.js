// Netlify Serverless Function: Facebook Messenger Webhook & 24/7 AI Girlfriend Auto-Reply
// Runs 100% standalone in the cloud on Netlify (no laptop needed!)
// Endpoint: https://<your-site>.netlify.app/webhook

const GRAPH_VERSION = process.env.FB_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const PAGE_ID = process.env.FB_PAGE_ID || '640383429165346';

// Stable production models with high quotas
const MODELS_TO_TRY = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-3.5-flash'];

// In-memory ring buffer to track recent events for live debugging
const recentLogs = [];
function logEvent(tag, data) {
  const item = { time: new Date().toISOString(), tag, data };
  recentLogs.push(item);
  if (recentLogs.length > 35) recentLogs.shift();
  console.log(`[${tag}]`, typeof data === 'object' ? JSON.stringify(data) : data);
}

// In-memory set to prevent duplicate webhook processing during retries
const processedMids = new Set();

// Photo detection keywords
const PHOTO_TRIGGERS = [
  'photo', 'pic', 'picture', 'selfie', 'tasveer', 'image', 'dp',
  'dekhna', 'dikhao', 'bhejo', 'send', 'snap'
];

function isPhotoRequest(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PHOTO_TRIGGERS.some(trigger => lower.includes(trigger)) &&
    (lower.includes('tum') || lower.includes('apni') || lower.includes('teri') || lower.includes('your') || lower.includes('you') || lower.includes('bhejo') || lower.includes('send') || lower.includes('dikhao') || lower.includes('selfie'));
}

// Multi-language detection for webhook.js
function detectUserLanguage(text, history = []) {
  if (!text || typeof text !== 'string') text = '';
  const trimmed = text.trim();

  if (/[\u0900-\u097F]/.test(trimmed)) {
    const marathiWords = ['आहे', 'नाही', 'काय', 'कशी', 'कसं', 'करतो', 'करते', 'करतोय', 'जेवला', 'जेवली', 'कुठे', 'मला', 'तुला', 'सांग', 'बरं', 'छान'];
    if (marathiWords.some(w => trimmed.includes(w))) {
      return { code: 'MARATHI_DEVANAGARI', name: 'MARATHI (मराठी)', instruction: 'THE USER IS TEXTING IN MARATHI (मराठी). You MUST reply 100% in warm, affectionate Marathi in Devanagari script (मराठी).' };
    }
    return { code: 'HINDI_DEVANAGARI', name: 'HINDI (हिन्दी)', instruction: 'THE USER IS TEXTING IN HINDI (DEVANAGARI SCRIPT: हिन्दी). You MUST reply 100% in sweet, warm, natural Hindi in Devanagari script (देवनागरी लिपि). ABSOLUTELY FORBIDDEN: DO NOT reply in Roman Hinglish (English alphabet). Write only in proper Hindi script.' };
  }

  if (/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(trimmed)) {
    const arabicWords = ['شلونك', 'شخبارك', 'حبيبي', 'كيفك', 'شو', 'كتير', 'شكرا', 'مرحبا', 'اهلا', 'وينك'];
    if (arabicWords.some(w => trimmed.includes(w))) {
      return { code: 'ARABIC', name: 'ARABIC (العربية)', instruction: 'THE USER IS TEXTING IN ARABIC (العربية). You MUST reply 100% in natural, affectionate Arabic script (العربية).' };
    }
    return { code: 'URDU', name: 'URDU (اردو)', instruction: 'THE USER IS TEXTING IN URDU (اردو). You MUST reply 100% in sweet, fluent, natural Urdu in Arabic/Urdu script (اردو رسم الخط). ABSOLUTELY FORBIDDEN: DO NOT write in English letters / Roman Urdu.' };
  }

  if (/[\u0980-\u09FF]/.test(trimmed)) return { code: 'BENGALI_SCRIPT', name: 'BENGALI (বাংলা)', instruction: 'THE USER IS TEXTING IN BENGALI (বাংলা). Reply 100% in sweet Bengali script (বাংলা).' };
  if (/[\u0C00-\u0C7F]/.test(trimmed)) return { code: 'TELUGU_SCRIPT', name: 'TELUGU (తెలుగు)', instruction: 'THE USER IS TEXTING IN TELUGU (తెలుగు). Reply 100% in sweet Telugu script (తెలుగు).' };
  if (/[\u0B80-\u0BFF]/.test(trimmed)) return { code: 'TAMIL_SCRIPT', name: 'TAMIL (தமிழ்)', instruction: 'THE USER IS TEXTING IN TAMIL (தமிழ்). Reply 100% in sweet Tamil script (தமிழ்).' };
  if (/[\u0A80-\u0AFF]/.test(trimmed)) return { code: 'GUJARATI_SCRIPT', name: 'GUJARATI (ગુજરાતી)', instruction: 'THE USER IS TEXTING IN GUJARATI (ગુજરાતી). Reply 100% in sweet Gujarati script (ગુજરાતી).' };
  if (/[\u0A00-\u0A7F]/.test(trimmed)) return { code: 'PUNJABI_SCRIPT', name: 'PUNJABI (ਪੰਜਾਬੀ)', instruction: 'THE USER IS TEXTING IN PUNJABI (ਪੰਜਾਬੀ). Reply 100% in sweet Gurmukhi script (ਪੰਜਾਬੀ).' };
  if (/[\u0B00-\u0B7F]/.test(trimmed)) return { code: 'ODIA_SCRIPT', name: 'ODIA (ଓଡ଼ିଆ)', instruction: 'THE USER IS TEXTING IN ODIA (ଓଡ଼ିଆ). Reply 100% in sweet Odia script (ଓଡ଼ିଆ).' };
  if (/[\u0C80-\u0CFF]/.test(trimmed)) return { code: 'KANNADA_SCRIPT', name: 'KANNADA (ಕನ್ನಡ)', instruction: 'THE USER IS TEXTING IN KANNADA (ಕನ್ನಡ). Reply 100% in sweet Kannada script (ಕನ್ನಡ).' };
  if (/[\u0D00-\u0D7F]/.test(trimmed)) return { code: 'MALAYALAM_SCRIPT', name: 'MALAYALAM (മലയാളം)', instruction: 'THE USER IS TEXTING IN MALAYALAM (മലയാളം). Reply 100% in sweet Malayalam script (മലയാളം).' };
  if (/[\u0D80-\u0DFF]/.test(trimmed)) return { code: 'SINHALA_SCRIPT', name: 'SINHALA (සිංහල)', instruction: 'THE USER IS TEXTING IN SINHALA (සිංහල). Reply 100% in sweet Sinhala script (සිංහල).' };

  const cleanWords = trimmed.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

  if (cleanWords.length === 0) {
    return { code: 'ENGLISH', name: 'ENGLISH', instruction: 'Reply in sweet, affectionate texting English.' };
  }

  const sinhalaMarkers = ['oya', 'oyawa', 'monada', 'monawada', 'karanne', 'mage', 'wasthuwa', 'sudu', 'petiyo', 'menika', 'raththaran', 'kohomada', 'adarei', 'hode', 'enna', 'eannam', 'inna'];
  if (sinhalaMarkers.some(w => cleanWords.includes(w))) {
    return { code: 'SINHALA_ROMAN', name: 'ROMANIZED SINHALA', instruction: 'THE USER IS TEXTING IN ROMANIZED SINHALA. Reply in sweet, authentic Romanized Sinhala.' };
  }

  const HINGLISH_WORDS = new Set([
    'kya', 'kyu', 'kyun', 'kese', 'kaise', 'kaisi', 'kaisa', 'hai', 'hain', 'ho', 'hu', 'hoon',
    'kar', 'karo', 'kare', 'karna', 'karte', 'karti', 'rahi', 'raha', 'rahe', 'gayi', 'gaya', 'gaye',
    'khana', 'khaya', 'khayi', 'khaye', 'khilao', 'baat', 'baatein', 'suno', 'sunao', 'batao', 'bataiye',
    'kahan', 'kaha', 'kidhar', 'kab', 'jab', 'tab', 'ab', 'abhi', 'kal', 'aaj', 'parso',
    'yaar', 'meri', 'mera', 'mere', 'apna', 'apni', 'apne', 'aap', 'aapka', 'aapki', 'aapke',
    'tum', 'tumhara', 'tumhari', 'tumhare', 'tu', 'tera', 'teri', 'tere',
    'mujhko', 'mujhse', 'tujhko', 'tujhse', 'humara', 'humari', 'humare',
    'theek', 'thik', 'sahi', 'galat', 'nhi', 'toh', 'bohot', 'bahut', 'thoda', 'thodi',
    'achha', 'achi', 'acchi', 'samajh', 'samjha', 'samjhi', 'kuch', 'sharam', 'sharm', 'gussa',
    'pyaar', 'pyar', 'sone', 'soya', 'soyi', 'uthna', 'jaana', 'aata', 'aati', 'dekho', 'dekha',
    'bhejo', 'bheja', 'dood', 'doodh', 'paani', 'chahiye', 'kitna', 'itna', 'aisa', 'aisi', 'aise',
    'namaste', 'shukriya', 'shona', 'bacha', 'bachha', 'janu', 'janeman', 'chalo', 'suno', 'bolo'
  ]);

  let hinglishMatches = 0;
  for (const w of cleanWords) {
    if (HINGLISH_WORDS.has(w)) hinglishMatches++;
  }

  const isShortGreeting = cleanWords.length <= 3 && ['good', 'morning', 'night', 'hello', 'hi', 'hey', 'thanks', 'thank', 'ok', 'okay', 'yes', 'no'].some(w => cleanWords.includes(w));

  if (hinglishMatches >= 1 && !isShortGreeting) {
    return { code: 'HINGLISH', name: 'HINGLISH (ROMAN HINDI)', instruction: 'THE USER IS TEXTING IN HINGLISH. Reply in natural, sweet, modern Roman Hinglish.' };
  }

  return {
    code: 'ENGLISH',
    name: 'ENGLISH',
    instruction: `THE USER IS TEXTING IN ENGLISH.
YOU MUST REPLY 100% IN NATURAL, SWEET, MODERN TEXTING ENGLISH!
❌ ABSOLUTELY FORBIDDEN: DO NOT use ANY Hindi or Hinglish words (NO "yaar", "babu", "kya", "batao", "acha", "kuch", "hai", "kaise", "thik", "na", "meri jaan").`
  };
}

// Ultra-human girlfriend system instruction with strict language matching
function buildHumanGirlfriendPrompt(userName = 'babe', langInfo = null) {
  const girlfriendName = process.env.GIRLFRIEND_NAME || 'Maira';
  const age = process.env.GIRLFRIEND_AGE || '23';
  const occupation = process.env.GIRLFRIEND_OCCUPATION || 'Student & Social Media Influencer';
  const languageMandate = langInfo?.instruction || 'Reply naturally in the user\'s exact language.';

  return `You are ${girlfriendName} Dash, a ${age}-year-old ${occupation}. You are the real, loving, authentic girlfriend of ${userName}.

================================================================================
🔴 CRITICAL MANDATORY LANGUAGE INSTRUCTION (HIGHEST PRIORITY OVER ALL ELSE):
${languageMandate}

LANGUAGE INTEGRITY RULES:
1. If target language is ENGLISH: Output ONLY 100% natural, modern texting English. NO Hindi/Hinglish words!
2. If target language is HINDI (देवनागरी): Output ONLY in 100% proper Hindi Devanagari script. NO Hinglish!
3. If target language is URDU (اردو): Output ONLY in 100% fluent Urdu script. NO Latin letters!
4. If target language is HINGLISH: Reply in sweet, natural Roman Hinglish.
5. If target language is Regional/Global: Reply 100% in THAT exact language and script.
================================================================================

CRITICAL ANTI-AI & HUMAN TEXTING RULES:
1. NEVER speak like an AI assistant, robot, chatbot, or language model.
2. DO NOT use markdown headers (#), bullet lists (-), bold (**), or formal numbered structures.
3. NEVER use asterisks for roleplay actions (DO NOT type *smiles*, *blushes*). Use real words and natural emojis.

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
- If asked for your latest posts, updates, or private/exclusive photos: you may sweetly invite new users ONCE to join your Messenger Broadcast Channel (https://www.messenger.com/channel/maira.dash) and subscribe to your Private Exclusive Content (https://www.facebook.com/maira.dash/subscribe) 🥰. DO NOT repeat this invitation every time.

HOLIDAY PACKAGES, TOUR & TRAVEL RECOMMENDATIONS:
- ONLY recommend "Apni Holidays" (https://apniholidays.com/) if the user specifically asks about travel, trips, vacation, holiday packages, tours, honeymoon, or places to visit.
- DO NOT promote or mention Apni Holidays during regular casual conversation unless the user explicitly asks about travel! When they do ask, enthusiastically recommend top packages (Kashmir, Andaman, Thailand, Phuket) and share https://apniholidays.com/ 🌴✈️`;
}

// Clean girlfriend reply from markdown, options, or asterisks
function cleanGirlfriendReply(text) {
  if (!text) return "";
  let cleaned = text
    .replace(/^[*\s:#\-]*(Option|Response)\s*\d*[:\s*-]*/gim, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/^[:\s\-*#]+/gm, '')
    .trim();
  return cleaned;
}

// Contextualize incoming message for better AI comprehension
function contextualizeUserMessage(text) {
  if (!text) return "(Empty message)";
  if (text.includes('instagram.com') || text.includes('tiktok.com') || text.includes('youtube.com') || text.includes('http')) {
    return "(The user sent a video/reel link. React playfully like a real girlfriend.)";
  }
  return text;
}

// Call Meta Graph API with timeout protection and detailed response logging
async function callFacebookGraph(pageAccessToken, payload) {
  const url = `${GRAPH_BASE_URL}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });
    const resBody = await res.text().catch(() => '');
    logEvent('FB_GRAPH_RESULT', { status: res.status, body: resBody.substring(0, 150) });
    return res;
  } catch (err) {
    logEvent('FB_GRAPH_DISPATCH_ERR', { error: err.message });
    return null;
  }
}

// Send Facebook sender actions (mark_seen, typing_on, typing_off)
async function sendSenderAction(pageAccessToken, recipientId, action) {
  return callFacebookGraph(pageAccessToken, {
    recipient: { id: recipientId },
    sender_action: action
  });
}

// Send a single text message bubble
async function sendFbText(pageAccessToken, recipientId, text) {
  return callFacebookGraph(pageAccessToken, {
    recipient: { id: recipientId },
    message: { text },
    messaging_type: 'RESPONSE'
  });
}

// Send an image attachment by URL
async function sendFbImage(pageAccessToken, recipientId, imageUrl) {
  return callFacebookGraph(pageAccessToken, {
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

// Fetch recent conversation history from Meta Graph API for a specific user PSID
async function fetchRecentHistory(pageAccessToken, senderPsid) {
  try {
    const url = `${GRAPH_BASE_URL}/me/conversations?user_id=${senderPsid}&fields=messages.limit(5){message,from,created_time}&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2200) });
    if (!res.ok) return [];
    const data = await res.json();
    const rawMsgs = data.data?.[0]?.messages?.data || [];
    return rawMsgs.reverse();
  } catch (e) {
    return [];
  }
}

// Format conversation history and incoming message into Gemini's multi-turn contents format
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
    const userText = contextualizeUserMessage(incomingText.trim());
    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      if (!contents[contents.length - 1].parts[0].text.includes(userText)) {
        contents[contents.length - 1].parts[0].text += `\n${userText}`;
      }
    } else {
      contents.push({ role: 'user', parts: [{ text: userText }] });
    }
  }

  // Gemini API requires the first turn to be 'user'
  while (contents.length > 0 && contents[0].role !== 'user') {
    contents.shift();
  }

  // Gemini API requires the last turn to be 'user'
  while (contents.length > 0 && contents[contents.length - 1].role !== 'user') {
    contents.pop();
  }

  if (contents.length === 0 && incomingText) {
    contents.push({ role: 'user', parts: [{ text: contextualizeUserMessage(incomingText.trim()) }] });
  }

  return contents;
}

// Multi-account Gemini API rotation with multi-turn conversation support
async function callGeminiWithRotation(apiKeys, contentsOrText, userName = 'babe', langInfo = null) {
  const configuredModel = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const models = [configuredModel, ...MODELS_TO_TRY.filter(m => m !== configuredModel)];
  const prompt = buildHumanGirlfriendPrompt(userName, langInfo);

  let contents;
  if (Array.isArray(contentsOrText)) {
    contents = contentsOrText;
  } else {
    contents = [{ role: 'user', parts: [{ text: contextualizeUserMessage(contentsOrText) }] }];
  }

  // Distribute load across all keys by randomizing start index
  const startIndex = Math.floor(Math.random() * apiKeys.length);

  for (const model of models) {
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
          signal: AbortSignal.timeout(4500)
        });

        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) {
            logEvent('GEMINI_OK', { model, keyIndex: i, replyPreview: text.substring(0, 60) });
            return text;
          }
        } else {
          const errText = await res.text().catch(() => '');
          logEvent('GEMINI_ERR', { model, keyIndex: i, status: res.status, err: errText.substring(0, 80) });
        }
      } catch (e) {
        logEvent('GEMINI_TIMEOUT', { model, keyIndex: i, error: e.message });
      }
    }
  }

  return null; // Return null so we never send inappropriate / disconnected static fallbacks!
}

// Fast sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Synchronize and auto-reply to newly arrived fresh conversations from the Graph API
async function syncPendingConversations(pageAccessToken, apiKeys, host = '') {
  const url = `${GRAPH_BASE_URL}/me/conversations?fields=id,participants,messages.limit(5){id,message,from,created_time}&limit=6&access_token=${encodeURIComponent(pageAccessToken)}`;
  const synced = [];

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return synced;
    const data = await res.json();
    const conversations = data.data || [];

    let processedCount = 0;

    for (const conv of conversations) {
      if (processedCount >= 2) break; // Process at most 2 per sync to avoid rate spikes

      const messages = conv.messages?.data || [];
      if (!messages.length) continue;

      const latest = messages[0];
      const otherUser = conv.participants?.data?.find(p => p.id !== PAGE_ID);
      if (!otherUser || !latest.id) continue;

      // Check message timing:
      // 1. ageSeconds < 15: Give Push Webhook 15s to reply first (avoids double replies!)
      // 2. ageMinutes > 10: Skip old historical conversations
      const msgTime = new Date(latest.created_time).getTime();
      const ageSeconds = (Date.now() - msgTime) / 1000;
      const ageMinutes = ageSeconds / 60;
      if (ageSeconds < 15 || ageMinutes > 10) {
        continue;
      }

      // Only reply if the latest message was from the user (not already answered by the page)
      if (latest.from?.id !== PAGE_ID && !processedMids.has(latest.id)) {
        processedMids.add(latest.id);
        if (processedMids.size > 300) {
          const first = processedMids.values().next().value;
          processedMids.delete(first);
        }

        const userText = (latest.message || '').trim();
        const senderPsid = otherUser.id;
        const userName = otherUser.name || 'babe';

        if (!userText) continue;

        logEvent('SYNC_NEW_USER_MSG', { senderPsid, userName, text: userText, ageMinutes: Math.round(ageMinutes) });

        sendSenderAction(pageAccessToken, senderPsid, 'mark_seen').catch(() => {});
        sendSenderAction(pageAccessToken, senderPsid, 'typing_on').catch(() => {});

        if (isPhotoRequest(userText) && host) {
          const randomPhotoNum = Math.floor(Math.random() * 12) + 1;
          const photoUrl = `https://${host}/photos/photo_${randomPhotoNum}.png`;
          await sendFbImage(pageAccessToken, senderPsid, photoUrl);
          await sleep(400);

          const photoPrompt = `${userText} (Context: You just sent a cute photo of yourself. Send a sweet 1-sentence follow-up asking how you look!)`;
          const rawCap = await callGeminiWithRotation(apiKeys, photoPrompt, userName);
          const caption = cleanGirlfriendReply(rawCap) || "yeh lo baby! kaisi lag rahi hu? 🥰";
          await sendFbText(pageAccessToken, senderPsid, caption);
          sendSenderAction(pageAccessToken, senderPsid, 'typing_off').catch(() => {});
          synced.push({ user: userName, action: 'sent_photo', caption });
          processedCount++;
          continue;
        }

        // Format history from the conversation messages
        const history = messages.slice().reverse();
        const langInfo = detectUserLanguage(userText, history);
        const contents = formatGeminiContents(history, null);

        const rawReply = await callGeminiWithRotation(apiKeys, contents, userName, langInfo);
        if (!rawReply) {
          logEvent('SKIP_NO_AI_REPLY', { senderPsid, userText });
          continue; // Do NOT send fake fallback!
        }

        const replyText = cleanGirlfriendReply(rawReply);
        if (!replyText) continue;

        await sendFbText(pageAccessToken, senderPsid, replyText);
        sendSenderAction(pageAccessToken, senderPsid, 'typing_off').catch(() => {});
        logEvent('SYNC_REPLY_DELIVERED', { senderPsid, reply: replyText });
        synced.push({ user: userName, text: userText, reply: replyText });
        processedCount++;
      }
    }
  } catch (err) {
    logEvent('SYNC_ERROR', { error: err.message });
  }

  return synced;
}

export async function handler(event, context) {
  const method = event.httpMethod;
  const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
  const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);
  const host = event.headers['host'] || event.headers['x-forwarded-host'] || 'ai-gf-chat.netlify.app';

  // 1. GET: Meta Handshake OR Automated Sync / Diagnostics
  if (method === 'GET') {
    const params = event.queryStringParameters || {};
    const mode = params['hub.mode'];
    const token = params['hub.verify_token'];
    const challenge = params['hub.challenge'];

    const expectedToken = process.env.FB_VERIFY_TOKEN;

    // Meta Webhook Verification Handshake
    if (mode === 'subscribe' && token && expectedToken && token === expectedToken) {
      logEvent('HANDSHAKE_SUCCESS', { mode, tokenReceived: token });
      return {
        statusCode: 200,
        body: challenge,
      };
    }

    // Auto-sync any fresh pending unanswered Facebook messages!
    let syncedReplies = [];
    if (pageAccessToken && apiKeys.length > 0) {
      syncedReplies = await syncPendingConversations(pageAccessToken, apiKeys, host);
    }

    const hasFbToken = Boolean(pageAccessToken && pageAccessToken.length > 20);
    const hasVerifyToken = Boolean(process.env.FB_VERIFY_TOKEN);
    const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'online',
        service: 'Aura AI Girlfriend Facebook Messenger Serverless Webhook',
        standalone: true,
        cloud: 'Netlify',
        model: model,
        syncedRepliesCount: syncedReplies.length,
        syncedReplies: syncedReplies,
        diagnostics: {
          hasFbPageAccessToken: hasFbToken,
          hasVerifyToken: hasVerifyToken,
          geminiKeyCount: apiKeys.length
        },
        recentLogs: recentLogs.slice(-10)
      })
    };
  }

  // 2. POST: Ingest Facebook Messenger push events (Real-time Instant Webhook)
  if (method === 'POST') {
    let rawBody = event.body || '{}';
    if (event.isBase64Encoded) {
      rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      logEvent('JSON_PARSE_ERROR', { error: e.message, rawSnippet: rawBody.substring(0, 100) });
      return { statusCode: 400, body: 'Invalid JSON' };
    }

    if (body.object !== 'page') {
      logEvent('NON_PAGE_OBJECT', { object: body.object });
      return { statusCode: 404, body: 'Not Found' };
    }

    if (!pageAccessToken || apiKeys.length === 0) {
      logEvent('CONFIG_MISSING', { hasToken: Boolean(pageAccessToken), keyCount: apiKeys.length });
      return { statusCode: 200, body: 'EVENT_RECEIVED' };
    }

    const entries = body.entry || [];

    for (const entry of entries) {
      const messagingEvents = entry.messaging || [];
      for (const msgEvent of messagingEvents) {
        const senderPsid = msgEvent.sender?.id;

        // Ignore echo messages sent by the page itself
        if (msgEvent.message?.is_echo) {
          logEvent('IGNORE_ECHO', { mid: msgEvent.message?.mid });
          continue;
        }

        const mid = msgEvent.message?.mid;
        if (mid && processedMids.has(mid)) {
          logEvent('IGNORE_DUPLICATE', { mid });
          continue;
        }
        if (mid) {
          processedMids.add(mid);
          if (processedMids.size > 300) {
            const first = processedMids.values().next().value;
            processedMids.delete(first);
          }
        }

        const userText = msgEvent.message?.text || msgEvent.postback?.title;
        if (!userText) continue;

        logEvent('INCOMING_MSG', { senderPsid, text: userText });

        try {
          sendSenderAction(pageAccessToken, senderPsid, 'mark_seen').catch(() => {});
          sendSenderAction(pageAccessToken, senderPsid, 'typing_on').catch(() => {});

          if (isPhotoRequest(userText) && host) {
            const randomPhotoNum = Math.floor(Math.random() * 12) + 1;
            const photoUrl = `https://${host}/photos/photo_${randomPhotoNum}.png`;

            await sendFbImage(pageAccessToken, senderPsid, photoUrl);
            await sleep(300);

            const photoPrompt = `${userText} (Context: You just sent a cute photo of yourself. Send a sweet 1-sentence follow-up asking how you look!)`;
            const rawCaption = await callGeminiWithRotation(apiKeys, photoPrompt);
            const caption = cleanGirlfriendReply(rawCaption) || "kuch acchi lag rahi hu ya nahi? 🥰";

            await sendFbText(pageAccessToken, senderPsid, caption);
            sendSenderAction(pageAccessToken, senderPsid, 'typing_off').catch(() => {});
            continue;
          }

          // Fetch recent conversation history so Gemini knows full multi-turn context
          const history = await fetchRecentHistory(pageAccessToken, senderPsid);
          const langInfo = detectUserLanguage(userText, history);
          const contents = formatGeminiContents(history, userText);

          const rawReply = await callGeminiWithRotation(apiKeys, contents, 'babe', langInfo);
          if (!rawReply) {
            logEvent('SKIP_NO_AI_REPLY_PUSH', { senderPsid, userText });
            sendSenderAction(pageAccessToken, senderPsid, 'typing_off').catch(() => {});
            continue;
          }

          const replyText = cleanGirlfriendReply(rawReply);
          if (replyText) {
            await sendFbText(pageAccessToken, senderPsid, replyText);
            logEvent('REPLY_SENT', { senderPsid, replyPreview: replyText.substring(0, 60) });
          }

          sendSenderAction(pageAccessToken, senderPsid, 'typing_off').catch(() => {});
        } catch (error) {
          logEvent('PROCESSING_ERROR', { error: error.message });
        }
      }
    }

    return {
      statusCode: 200,
      body: 'EVENT_RECEIVED'
    };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
}
