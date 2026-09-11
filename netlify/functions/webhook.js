// Netlify Serverless Function: Facebook Messenger Webhook & 24/7 AI Girlfriend Auto-Reply
// Runs 100% standalone in the cloud on Netlify (no laptop needed!)
// Endpoint: https://<your-site>.netlify.app/webhook

const GRAPH_VERSION = process.env.FB_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

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
- Match their emotional tone: if they are sad or stressed, be comforting, gentle, and warm. If they tease you, tease back playfully!`;
}

// Call Meta Graph API with timeout protection
async function callFacebookGraph(pageAccessToken, payload) {
  const url = `${GRAPH_BASE_URL}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.warn('[Facebook API Error]:', errorData);
    }
    return res;
  } catch (err) {
    console.warn('[Facebook API Dispatch Error]:', err.message);
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

// Multi-account Gemini API rotation with timeout guard
async function callGeminiWithRotation(apiKeys, userMessage, userName = 'babe') {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const prompt = buildHumanGirlfriendPrompt(userName);

  for (let i = 0; i < apiKeys.length; i++) {
    const key = apiKeys[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: prompt }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 200 }
        }),
        signal: AbortSignal.timeout(4500)
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      }
    } catch (e) {
      console.warn(`[Gemini Rotation] Key index ${i} failed (${e.message}). Trying next...`);
    }
  }

  return "heyy babe! sorry my connection was spotty 💕 how was your day?";
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

export async function handler(event, context) {
  const method = event.httpMethod;

  // 1. GET: Meta Webhook Verification Handshake & Health Check
  if (method === 'GET') {
    const params = event.queryStringParameters || {};
    const mode = params['hub.mode'];
    const token = params['hub.verify_token'];
    const challenge = params['hub.challenge'];

    const expectedToken = process.env.FB_VERIFY_TOKEN;

    if (mode === 'subscribe' && token && expectedToken && token === expectedToken) {
      console.log('[Webhook] Meta verification handshake succeeded!');
      return {
        statusCode: 200,
        body: challenge,
      };
    }

    // Health check if accessed directly in browser
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'online',
        service: 'Aura AI Girlfriend Facebook Messenger Serverless Webhook',
        standalone: true,
        cloud: 'Netlify'
      })
    };
  }

  // 2. POST: Ingest Facebook Messenger events
  if (method === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return { statusCode: 400, body: 'Invalid JSON' };
    }

    if (body.object !== 'page') {
      return { statusCode: 404, body: 'Not Found' };
    }

    const pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
    
    // Support multi-account Gemini keys
    const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
    const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

    if (!pageAccessToken || apiKeys.length === 0) {
      console.warn('[Webhook] Missing FB_PAGE_ACCESS_TOKEN or GEMINI_API_KEY(S) in environment variables.');
      return { statusCode: 200, body: 'EVENT_RECEIVED' };
    }

    const host = event.headers['host'] || event.headers['x-forwarded-host'] || '';
    const entries = body.entry || [];

    for (const entry of entries) {
      const messagingEvents = entry.messaging || [];
      for (const msgEvent of messagingEvents) {
        const senderPsid = msgEvent.sender?.id;

        // Ignore echo messages
        if (msgEvent.message?.is_echo) continue;

        const mid = msgEvent.message?.mid;
        if (mid && processedMids.has(mid)) {
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

        console.log(`[Webhook] Message from ${senderPsid}: "${userText}"`);

        // Execute Fast Human-Like Cadence:
        try {
          // A. Mark message as seen immediately
          sendSenderAction(pageAccessToken, senderPsid, 'mark_seen').catch(() => {});

          // B. Quick reading pause (300ms)
          await sleep(300);

          // C. Show Messenger typing indicator dots
          sendSenderAction(pageAccessToken, senderPsid, 'typing_on').catch(() => {});

          // D. Handle Photo/Selfie Request
          if (isPhotoRequest(userText) && host) {
            const randomPhotoNum = Math.floor(Math.random() * 12) + 1;
            const photoUrl = `https://${host}/photos/photo_${randomPhotoNum}.png`;

            await sendFbImage(pageAccessToken, senderPsid, photoUrl);
            await sleep(500);

            const photoPrompt = `${userText} (Context: You just sent a cute photo of yourself. Send a sweet, cute 1-sentence follow-up asking how you look!)`;
            const caption = await callGeminiWithRotation(apiKeys, photoPrompt);

            await sendFbText(pageAccessToken, senderPsid, caption);
            sendSenderAction(pageAccessToken, senderPsid, 'typing_off').catch(() => {});
            continue;
          }

          // E. Generate Girlfriend Reply with Gemini
          const replyText = await callGeminiWithRotation(apiKeys, userText);

          // F. Quick typing delay (~800ms)
          await sleep(800);

          // G. Multi-bubble texting (splits into 2 realistic texts if natural)
          const bubbles = splitIntoHumanBubbles(replyText);

          if (bubbles.length === 1) {
            await sendFbText(pageAccessToken, senderPsid, bubbles[0]);
          } else {
            await sendFbText(pageAccessToken, senderPsid, bubbles[0]);
            sendSenderAction(pageAccessToken, senderPsid, 'typing_on').catch(() => {});
            await sleep(600);
            await sendFbText(pageAccessToken, senderPsid, bubbles[1]);
          }

          // H. Stop typing indicator
          sendSenderAction(pageAccessToken, senderPsid, 'typing_off').catch(() => {});
        } catch (error) {
          console.error('[Webhook Processing Error]:', error);
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
