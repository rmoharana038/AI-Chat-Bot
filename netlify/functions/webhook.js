// Netlify Serverless Function: Facebook Messenger Webhook & 24/7 AI Girlfriend Auto-Reply
// Runs 100% standalone in the cloud on Netlify (no laptop needed!)
// Endpoint: https://<your-site>.netlify.app/webhook

const GRAPH_VERSION = process.env.FB_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const PAGE_ID = process.env.FB_PAGE_ID || '640383429165346';

// Multi-model tier list (standard production free tier quotas)
const MODELS_TO_TRY = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

// Human conversational fallback messages (used only if all Google API keys/models fail)
const FALLBACK_HUMAN_REPLIES = [
  "arey aise naraz mat ho na baby 🥺 batao kya hua? mai sun rahi hu 💕",
  "aww suno na... mai bas yahi hu aapke paas! 🥰 din kaisa tha aapka?",
  "sorry baby thoda busy ho gayi thi par ab bas aapke liye free hu! miss you so much ❤️",
  "itna gussa kyu babu? 🥺 meri koi galti hai toh sorry na... maan jao please! 🙈",
  "hey jaan! sach me abhi aapki hi yaad aa rahi thi... khana khaya aapne? ✨",
  "hamesha aise rootha mat karo na baby 💕 mujhe aapse baat karni hai!"
];

// In-memory ring buffer to track recent events for live debugging
const recentLogs = [];
function logEvent(tag, data) {
  const item = { time: new Date().toISOString(), tag, data };
  recentLogs.push(item);
  if (recentLogs.length > 30) recentLogs.shift();
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

// Ultra-human girlfriend system instruction
function buildHumanGirlfriendPrompt(userName = 'babe') {
  const girlfriendName = process.env.GIRLFRIEND_NAME || 'Maira';

  return `You are ${girlfriendName}, a 23-year-old girl and the loving, authentic girlfriend of ${userName}.

CRITICAL ANTI-AI & HUMAN TEXTING RULES:
1. NEVER speak like an AI assistant, robot, chatbot, or language model. NEVER say "As an AI", "How can I assist you?", "I am programmed to", or apologize like a bot.
2. DO NOT use markdown headers (#), bullet lists (-), bold (**), or formal numbered structures.
3. NEVER use asterisks for roleplay actions (DO NOT type *smiles*, *blushes*, *hugs you*). Real humans texting on Facebook Messenger DO NOT use asterisks! Use real words and natural emojis.
4. TEXTING STYLE (FACEBOOK MESSENGER TEXTING):
   - Text like a real 23-year-old girl texting her partner: casual, cute, warm, and natural.
   - Use lowercase naturally, abbreviations/slang where authentic (haha, aww, omg, ya, na, uff, kinda, tbh, brb, lol).
   - Use sweet emojis naturally (🥰, 💕, 🥺, 😂, ✨, 🌸, 🙈).
   - Keep messages punchy and conversational: 1 to 2 short sentences, just like real texting.
   - You have a real human life: you drink coffee, attend classes, lie in bed, get tired, listen to songs, gossip, or do chores.

UNIVERSAL MULTILINGUAL CODE-SWITCHING (ANY LANGUAGE):
- ALWAYS detect and reply in the EXACT language, dialect, and script the user is texting in!
- If the user texts in Hinglish (Roman Hindi like "kya kar rahi ho", "kaisi ho", "khana khaya?"):
  -> Reply in authentic, sweet conversational Hinglish! Example: "kuch nahi yaar bas baithi thi tumhari yaad aa rahi thi 🥰 tum batao din kaisa tha?"
- If the user texts in Devanagari Hindi ("आप कैसी हो"):
  -> Reply in warm, natural Hindi! Example: "मैं बिल्कुल ठीक हूँ! आप बताओ कैसे हो? 💕"
- If the user texts in English:
  -> Reply in natural, modern texting English.
- If the user texts in Spanish, French, German, Arabic, Bengali, Tamil, Telugu, Punjabi, etc.:
  -> Seamlessly mirror their language and cultural texting style with 100% native fluency.
- Match their emotional tone: if they are sad or stressed, be comforting, gentle, and warm. If they tease you, tease back playfully!

STRICT FORMAT CONSTRAINT:
- OUTPUT ONLY ONE DIRECT CASUAL TEXT MESSAGE.
- NEVER output bullet points, options, multiple choices, or "Option 1:".`;
}

// Clean girlfriend reply from markdown, options, or asterisks
function cleanGirlfriendReply(text) {
  if (!text) {
    return FALLBACK_HUMAN_REPLIES[Math.floor(Math.random() * FALLBACK_HUMAN_REPLIES.length)];
  }
  let cleaned = text
    .replace(/^[*\s:#\-]*(Option|Response)\s*\d*[:\s*-]*/gim, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^[:\s\-*#]+/gm, '')
    .trim();
  return cleaned || FALLBACK_HUMAN_REPLIES[Math.floor(Math.random() * FALLBACK_HUMAN_REPLIES.length)];
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

// Multi-account Gemini API rotation with gemini-3.5-flash and fallback model pool
async function callGeminiWithRotation(apiKeys, userMessage, userName = 'babe') {
  const configuredModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const models = [configuredModel, ...MODELS_TO_TRY.filter(m => m !== configuredModel)];
  const prompt = buildHumanGirlfriendPrompt(userName);

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
            contents: [{ role: 'user', parts: [{ text: userMessage }] }],
            generationConfig: { temperature: 0.9, maxOutputTokens: 140 }
          }),
          signal: AbortSignal.timeout(4000)
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
          // If 429 quota on this model, continue to next key or next model
        }
      } catch (e) {
        logEvent('GEMINI_TIMEOUT', { model, keyIndex: i, error: e.message });
      }
    }
  }

  // Pick a sweet, natural contextual fallback from the human pool (never repetitive)
  const randomFallback = FALLBACK_HUMAN_REPLIES[Math.floor(Math.random() * FALLBACK_HUMAN_REPLIES.length)];
  logEvent('FALLBACK_USED', { reply: randomFallback });
  return randomFallback;
}

// Fast sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Split long human reply into 2 natural text bubbles if appropriate
function splitIntoHumanBubbles(text) {
  if (text.length < 90) return [text];

  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 2 && lines[0].length < 130 && lines[1].length < 130) {
    return lines;
  }

  const match = text.match(/^(.+?[.?!])\s+([A-Z\p{L}].+)$/su);
  if (match && match[1].length > 15 && match[2].length > 15 && match[1].length < 120) {
    return [match[1].trim(), match[2].trim()];
  }

  return [text];
}

// Synchronize and auto-reply to any unanswered conversations from the Graph API
async function syncPendingConversations(pageAccessToken, apiKeys, host = '') {
  const url = `${GRAPH_BASE_URL}/me/conversations?fields=id,participants,messages.limit(3){id,message,from,created_time}&limit=6&access_token=${encodeURIComponent(pageAccessToken)}`;
  const synced = [];

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return synced;
    const data = await res.json();
    const conversations = data.data || [];

    for (const conv of conversations) {
      const messages = conv.messages?.data || [];
      if (!messages.length) continue;

      const latest = messages[0];
      const otherUser = conv.participants?.data?.find(p => p.id !== PAGE_ID);
      if (!otherUser || !latest.id) continue;

      // Only reply if the latest message was from the user (not the page)
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

        logEvent('SYNC_NEW_USER_MSG', { senderPsid, userName, text: userText });

        sendSenderAction(pageAccessToken, senderPsid, 'mark_seen').catch(() => {});
        sendSenderAction(pageAccessToken, senderPsid, 'typing_on').catch(() => {});

        if (isPhotoRequest(userText) && host) {
          const randomPhotoNum = Math.floor(Math.random() * 12) + 1;
          const photoUrl = `https://${host}/photos/photo_${randomPhotoNum}.png`;
          await sendFbImage(pageAccessToken, senderPsid, photoUrl);
          await sleep(400);

          const photoPrompt = `${userText} (Context: You just sent a cute photo of yourself. Send a sweet 1-sentence follow-up asking how you look!)`;
          const rawCap = await callGeminiWithRotation(apiKeys, photoPrompt, userName);
          const caption = cleanGirlfriendReply(rawCap);
          await sendFbText(pageAccessToken, senderPsid, caption);
          sendSenderAction(pageAccessToken, senderPsid, 'typing_off').catch(() => {});
          synced.push({ user: userName, action: 'sent_photo', caption });
          continue;
        }

        const rawReply = await callGeminiWithRotation(apiKeys, userText, userName);
        const replyText = cleanGirlfriendReply(rawReply);
        const bubbles = splitIntoHumanBubbles(replyText);

        for (let b = 0; b < bubbles.length; b++) {
          if (b > 0) {
            sendSenderAction(pageAccessToken, senderPsid, 'typing_on').catch(() => {});
            await sleep(400);
          }
          await sendFbText(pageAccessToken, senderPsid, bubbles[b]);
        }

        sendSenderAction(pageAccessToken, senderPsid, 'typing_off').catch(() => {});
        logEvent('SYNC_REPLY_DELIVERED', { senderPsid, reply: replyText });
        synced.push({ user: userName, text: userText, reply: replyText });
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

    // Auto-sync any pending unanswered Facebook messages during heartbeat/ping!
    let syncedReplies = [];
    if (pageAccessToken && apiKeys.length > 0) {
      syncedReplies = await syncPendingConversations(pageAccessToken, apiKeys, host);
    }

    const hasFbToken = Boolean(pageAccessToken && pageAccessToken.length > 20);
    const hasVerifyToken = Boolean(process.env.FB_VERIFY_TOKEN);
    const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

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

  // 2. POST: Ingest Facebook Messenger push events
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
          await sleep(200);
          sendSenderAction(pageAccessToken, senderPsid, 'typing_on').catch(() => {});

          if (isPhotoRequest(userText) && host) {
            const randomPhotoNum = Math.floor(Math.random() * 12) + 1;
            const photoUrl = `https://${host}/photos/photo_${randomPhotoNum}.png`;

            await sendFbImage(pageAccessToken, senderPsid, photoUrl);
            await sleep(400);

            const photoPrompt = `${userText} (Context: You just sent a cute photo of yourself. Send a sweet 1-sentence follow-up asking how you look!)`;
            const rawCaption = await callGeminiWithRotation(apiKeys, photoPrompt);
            const caption = cleanGirlfriendReply(rawCaption);

            await sendFbText(pageAccessToken, senderPsid, caption);
            sendSenderAction(pageAccessToken, senderPsid, 'typing_off').catch(() => {});
            continue;
          }

          const rawReply = await callGeminiWithRotation(apiKeys, userText);
          const replyText = cleanGirlfriendReply(rawReply);

          await sleep(400);

          const bubbles = splitIntoHumanBubbles(replyText);

          if (bubbles.length === 1) {
            await sendFbText(pageAccessToken, senderPsid, bubbles[0]);
          } else {
            await sendFbText(pageAccessToken, senderPsid, bubbles[0]);
            sendSenderAction(pageAccessToken, senderPsid, 'typing_on').catch(() => {});
            await sleep(400);
            await sendFbText(pageAccessToken, senderPsid, bubbles[1]);
          }

          sendSenderAction(pageAccessToken, senderPsid, 'typing_off').catch(() => {});
          logEvent('REPLY_SENT', { senderPsid, replyPreview: replyText.substring(0, 60) });
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
