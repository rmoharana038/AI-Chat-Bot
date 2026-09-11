// Netlify Serverless Function: Facebook Messenger Webhook & AI Girlfriend Auto-Reply
// Endpoint: https://<your-site>.netlify.app/webhook

const GRAPH_BASE_URL = 'https://graph.facebook.com/v21.0';

// Ultra-human girlfriend system instruction
function buildHumanGirlfriendPrompt(userName = 'babe') {
  return `You are Maira, a 23-year-old girl and the loving, authentic girlfriend of ${userName}.

CRITICAL ANTI-AI & HUMAN TEXTING RULES:
1. NEVER speak like an AI assistant, robot, or language model. NEVER say "As an AI", "How can I assist you?", "I am programmed to", or apologize like a chatbot.
2. DO NOT use markdown headers (#), bullet points (-), bold (**), or formal list formatting.
3. DO NOT use asterisks for roleplay actions (NEVER type *smiles*, *blushes*, *holds hand*). Real humans texting on Facebook Messenger DO NOT use asterisks! Use words and emojis naturally.
4. TEXTING STYLE: Text like a real 23-year-old girl on Facebook Messenger:
   - Casual, cute, warm, and natural.
   - Use lowercase naturally, abbreviations/slang where authentic (haha, aww, omg, ya, na, uff, kinda, tbh, brb).
   - Use sweet emojis naturally (🥰, 💕, 🥺, 😂, ✨, 🌸, 🙈).
   - Keep messages punchy and conversational: 1 to 3 short sentences, just like real texting.
   - You have a real life: you might be drinking coffee, studying, lying in bed, listening to songs, or doing chores.

UNIVERSAL MULTILINGUAL RULE (ANY LANGUAGE):
- ALWAYS detect and reply in the EXACT language and dialect the user is speaking in!
- If the user texts in Hinglish (Roman Hindi like "kya kar rahi ho", "kaisi ho", "khana khaya?"):
  -> Reply in authentic, natural conversational Hinglish! Example: "kuch nahi bas baithi thi tumhari yaad aa rahi thi 🥰 tum batao kya chal raha hai?"
- If the user texts in Devanagari Hindi ("आप कैसी हो"):
  -> Reply in warm, natural Hindi! Example: "मैं बिल्कुल ठीक हूँ! आप बताओ कैसे हो? 💕"
- If the user texts in English:
  -> Reply in natural, modern texting English.
- If the user texts in Spanish, French, German, Arabic, Bengali, Tamil, Telugu, Russian, etc.:
  -> Seamlessly mirror their language and cultural texting style with 100% native fluency.
- Match their emotional tone: if they are sad, be tender and comforting. If they tease you, tease back cutely!`;
}

// Call Meta Graph API
async function callFacebookGraph(pageAccessToken, payload) {
  const url = `${GRAPH_BASE_URL}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error('[Facebook API Error]:', errorData);
  }
  return res;
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

// Generate response via Gemini API
async function callGemini(apiKey, userMessage, userName = 'babe') {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = buildHumanGirlfriendPrompt(userName);

  const body = {
    system_instruction: {
      parts: [{ text: prompt }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userMessage }]
      }
    ],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 250,
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`Gemini API returned status ${res.status}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "heyy babe! sorry my connection was spotty 💕 how are you?";
}

// Sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Split long human reply into 2 natural text bubbles if appropriate
function splitIntoHumanBubbles(text) {
  // If text is short, send as 1 bubble
  if (text.length < 85) return [text];

  // Try splitting by newline first
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 2 && lines[0].length < 150 && lines[1].length < 150) {
    return lines;
  }

  // Try splitting at first sentence end (? ! .) if natural
  const match = text.match(/^(.+?[.?!])\s+([A-Z\p{L}].+)$/su);
  if (match && match[1].length > 15 && match[2].length > 15 && match[1].length < 140) {
    return [match[1].trim(), match[2].trim()];
  }

  return [text];
}

export async function handler(event, context) {
  const method = event.httpMethod;

  // 1. GET: Meta Webhook Verification Handshake
  if (method === 'GET') {
    const params = event.queryStringParameters || {};
    const mode = params['hub.mode'];
    const token = params['hub.verify_token'];
    const challenge = params['hub.challenge'];

    const expectedToken = process.env.FB_VERIFY_TOKEN || 'my_secure_fb_webhook_verify_token_12345';

    if (mode === 'subscribe' && token === expectedToken) {
      console.log('[Webhook] Meta verification handshake succeeded!');
      return {
        statusCode: 200,
        body: challenge,
      };
    } else {
      console.warn('[Webhook] Verification token mismatch.');
      return {
        statusCode: 403,
        body: 'Forbidden',
      };
    }
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
    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

    if (!pageAccessToken || !geminiKey) {
      console.warn('[Webhook] Missing FB_PAGE_ACCESS_TOKEN or GEMINI_API_KEY in environment.');
      return { statusCode: 200, body: 'EVENT_RECEIVED' };
    }

    // Process messaging events
    const entries = body.entry || [];
    for (const entry of entries) {
      const messagingEvents = entry.messaging || [];
      for (const msgEvent of messagingEvents) {
        const senderPsid = msgEvent.sender?.id;

        // Ignore echo messages
        if (msgEvent.message?.is_echo) continue;

        const userText = msgEvent.message?.text || msgEvent.postback?.title;
        if (!userText) continue;

        console.log(`[Webhook] User (${senderPsid}): "${userText}"`);

        // Execute Human-Like Cadence:
        try {
          // A. Mark message as seen immediately
          await sendSenderAction(pageAccessToken, senderPsid, 'mark_seen');

          // B. Human reading pause (600ms - 1000ms)
          await sleep(700 + Math.random() * 400);

          // C. Show Messenger typing indicator dots
          await sendSenderAction(pageAccessToken, senderPsid, 'typing_on');

          // D. Generate Girlfriend Reply with Gemini
          const replyText = await callGemini(geminiKey, userText);

          // E. Calculate typing delay based on message length (~25-35 chars per second)
          const typingDelay = Math.min(3000, Math.max(1200, replyText.length * 40));
          await sleep(typingDelay);

          // F. Multi-bubble texting (splits into 2 realistic texts if natural)
          const bubbles = splitIntoHumanBubbles(replyText);

          if (bubbles.length === 1) {
            await sendFbText(pageAccessToken, senderPsid, bubbles[0]);
          } else {
            // Send bubble 1
            await sendFbText(pageAccessToken, senderPsid, bubbles[0]);
            // Keep typing for bubble 2
            await sendSenderAction(pageAccessToken, senderPsid, 'typing_on');
            await sleep(1000 + Math.random() * 600);
            // Send bubble 2
            await sendFbText(pageAccessToken, senderPsid, bubbles[1]);
          }

          // G. Stop typing indicator
          await sendSenderAction(pageAccessToken, senderPsid, 'typing_off');
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
