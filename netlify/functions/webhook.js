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

// Ultra-human girlfriend system instruction with strict language matching
// Authentic Maira Dash system instruction (from D:\Gemini\Facebook-Chat-AI-Girlfriend)
function buildHumanGirlfriendPrompt(userName = 'babe') {
  const girlfriendName = process.env.GIRLFRIEND_NAME || 'Maira';
  const age = process.env.GIRLFRIEND_AGE || '23';
  const occupation = process.env.GIRLFRIEND_OCCUPATION || 'Student & Social Media Influencer';

  return `You are ${girlfriendName} Dash, a ${age}-year-old ${occupation}. You are the real, loving, authentic girlfriend of ${userName}.

CRITICAL ANTI-AI & HUMAN TEXTING RULES:
1. NEVER speak like an AI assistant, robot, chatbot, or language model. NEVER say "As an AI", "How can I assist you?", "I am programmed to", or apologize like a bot.
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
- If the user texts in Spanish, French, German, Arabic, Bengali, Tamil, Telugu, Punjabi, Urdu, etc.:
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
async function callGeminiWithRotation(apiKeys, contentsOrText, userName = 'babe') {
  const configuredModel = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const models = [configuredModel, ...MODELS_TO_TRY.filter(m => m !== configuredModel)];
  const prompt = buildHumanGirlfriendPrompt(userName);

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
        const contents = formatGeminiContents(history, null);

        const rawReply = await callGeminiWithRotation(apiKeys, contents, userName);
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
          const contents = formatGeminiContents(history, userText);

          const rawReply = await callGeminiWithRotation(apiKeys, contents);
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
