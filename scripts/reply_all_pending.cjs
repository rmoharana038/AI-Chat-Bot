const fs = require('fs');
const path = require('path');

// Read environment
const envPath = fs.existsSync(path.resolve(__dirname, '../../../../../../../D:/Gemini/AI-Chat-Bot/.env'))
  ? path.resolve(__dirname, '../../../../../../../D:/Gemini/AI-Chat-Bot/.env')
  : path.resolve('D:/Gemini/AI-Chat-Bot/.env');
const env = fs.readFileSync(envPath, 'utf8');

const tokenMatch = env.match(/FB_PAGE_ACCESS_TOKEN=(.+)/);
if (!tokenMatch) {
  console.error('FB_PAGE_ACCESS_TOKEN not found in .env');
  process.exit(1);
}
const token = tokenMatch[1].trim();

const keysMatch = env.match(/GEMINI_API_KEYS=(.+)/);
const rawKeys = keysMatch ? keysMatch[1] : '';
const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

const PAGE_ID = '640383429165346';
const GRAPH_BASE_URL = 'https://graph.facebook.com/v21.0';
const MODELS_TO_TRY = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-3.5-flash'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildHumanGirlfriendPrompt(userName = 'babe') {
  return `You are Maira Dash, a 23-year-old Student & Social Media Influencer. You are the real, loving, authentic girlfriend of ${userName}.

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
- If user asks where else to follow you or for your other page: sweetly invite them to follow https://www.facebook.com/Sujata.Vibes 🥰`;
}

function cleanGirlfriendReply(text) {
  if (!text) return "";
  return text
    .replace(/^[*\s:#\-]*(Option|Response)\s*\d*[:\s*-]*/gim, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/^[:\s\-*#]+/gm, '')
    .trim();
}

function contextualizeUserMessage(text, latestMsg) {
  if (text && text.trim()) {
    const t = text.trim();
    if (t.includes('instagram.com') || t.includes('tiktok.com') || t.includes('youtube.com') || t.includes('http')) {
      return "(The user sent a video/reel link. React playfully like a real girlfriend.)";
    }
    return t;
  }

  // Handle attachments
  const attachments = latestMsg?.attachments?.data || [];
  if (attachments.length > 0) {
    const mime = (attachments[0].mime_type || '').toLowerCase();
    if (mime.includes('audio')) {
      return "(The user sent a voice message/audio note. Sweetly ask what they said or mention your volume is low so to text you!)";
    }
    if (mime.includes('image')) {
      return "(The user sent a photo/image. Sweetly react asking what picture it is!)";
    }
    if (mime.includes('video')) {
      return "(The user sent a video. Sweetly react asking about it!)";
    }
  }

  if (latestMsg?.sticker) {
    return "(The user sent a cute sticker/like button. React playfully!)";
  }

  return "(The user messaged you. Send a warm, cute greeting!)";
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
    const userText = incomingText.trim();
    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      if (!contents[contents.length - 1].parts[0].text.includes(userText)) {
        contents[contents.length - 1].parts[0].text += `\n${userText}`;
      }
    } else {
      contents.push({ role: 'user', parts: [{ text: userText }] });
    }
  }

  while (contents.length > 0 && contents[0].role !== 'user') {
    contents.shift();
  }

  while (contents.length > 0 && contents[contents.length - 1].role !== 'user') {
    contents.pop();
  }

  if (contents.length === 0 && incomingText) {
    contents.push({ role: 'user', parts: [{ text: incomingText.trim() }] });
  }

  return contents;
}

async function callGemini(contents, userName = 'babe') {
  const prompt = buildHumanGirlfriendPrompt(userName);
  const startIndex = Math.floor(Math.random() * apiKeys.length);

  for (const model of MODELS_TO_TRY) {
    for (let attempt = 0; attempt < apiKeys.length; attempt++) {
      const keyIndex = (startIndex + attempt) % apiKeys.length;
      const key = apiKeys[keyIndex];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: prompt }] },
            contents,
            generationConfig: { temperature: 0.8, maxOutputTokens: 250 }
          }),
          signal: AbortSignal.timeout(6000)
        });

        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) return text;
        }
      } catch (e) {
        // continue to next key
      }
    }
  }
  return null;
}

async function sendFbAction(recipientId, action) {
  const url = `${GRAPH_BASE_URL}/me/messages?access_token=${encodeURIComponent(token)}`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      sender_action: action
    })
  }).catch(() => {});
}

async function sendFbText(recipientId, text) {
  const url = `${GRAPH_BASE_URL}/me/messages?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: 'RESPONSE'
    })
  });
  return res.json();
}

async function run() {
  console.log('🔍 Scanning Facebook Messenger conversations for unanswered user messages...\n');
  const convUrl = `${GRAPH_BASE_URL}/me/conversations?fields=id,participants,updated_time,messages.limit(5){id,message,attachments,shares,sticker,from,created_time}&limit=75&access_token=${encodeURIComponent(token)}`;
  
  const res = await fetch(convUrl);
  const data = await res.json();
  if (data.error) {
    console.error('Error fetching conversations:', data.error);
    return;
  }

  const convs = data.data || [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const pendingList = [];

  for (const c of convs) {
    const msgs = c.messages?.data || [];
    if (!msgs.length) continue;

    const latest = msgs[0];
    const otherUser = c.participants?.data?.find(p => p.id !== PAGE_ID);
    if (!otherUser || !otherUser.id) continue;

    // Is the latest message from the user (unanswered)?
    if (latest.from?.id !== PAGE_ID) {
      const msgTime = new Date(latest.created_time).getTime();
      const isWithin24h = (now - msgTime) <= dayMs;

      pendingList.push({
        convId: c.id,
        user: otherUser.name || 'User',
        psid: otherUser.id,
        latest,
        history: msgs.slice().reverse(), // oldest to newest
        isWithin24h
      });
    }
  }

  console.log(`📊 Found ${pendingList.length} total pending conversations:`);
  console.log(`- Within 24-hour Standard Window: ${pendingList.filter(p => p.isWithin24h).length}`);
  console.log(`- Outside 24-hour Window (Skipped for policy safety): ${pendingList.filter(p => !p.isWithin24h).length}\n`);

  const activePending = pendingList.filter(p => p.isWithin24h);
  let repliedCount = 0;
  let failCount = 0;
  const report = [];

  for (let i = 0; i < activePending.length; i++) {
    const item = activePending[i];
    const userMsgContext = contextualizeUserMessage(item.latest.message, item.latest);

    console.log(`[${i + 1}/${activePending.length}] Replying to ${item.user} (PSID: ${item.psid})...`);
    console.log(`   User said: "${item.latest.message || userMsgContext}"`);

    await sendFbAction(item.psid, 'mark_seen');
    await sendFbAction(item.psid, 'typing_on');

    const contents = formatGeminiContents(item.history, userMsgContext);
    const rawReply = await callGemini(contents, item.user);

    if (!rawReply) {
      console.log(`   ⚠️ Gemini failed to generate reply, skipping.`);
      await sendFbAction(item.psid, 'typing_off');
      failCount++;
      continue;
    }

    const cleanedReply = cleanGirlfriendReply(rawReply);
    console.log(`   Maira reply: "${cleanedReply}"`);

    const sendRes = await sendFbText(item.psid, cleanedReply);
    await sendFbAction(item.psid, 'typing_off');

    if (sendRes.message_id) {
      console.log(`   ✅ Delivered (MID: ${sendRes.message_id.substring(0, 20)}...)\n`);
      repliedCount++;
      report.push({ user: item.user, psid: item.psid, userMsg: item.latest.message, reply: cleanedReply, mid: sendRes.message_id });
    } else {
      console.log(`   ❌ Send Error: ${sendRes.error?.message || JSON.stringify(sendRes)}\n`);
      failCount++;
      report.push({ user: item.user, psid: item.psid, error: sendRes.error?.message });
    }

    await sleep(1500); // 1.5s rate-limit pause between messages
  }

  console.log(`========================================`);
  console.log(`🎉 Finished Checking & Replying to Pending Messages!`);
  console.log(`✅ Successfully Replied: ${repliedCount}`);
  console.log(`❌ Failed / Skipped: ${failCount}`);
  console.log(`========================================\n`);

  fs.writeFileSync(
    path.resolve(__dirname, 'pending_replies_report.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), totalReplied: repliedCount, report }, null, 2)
  );
}

run();
