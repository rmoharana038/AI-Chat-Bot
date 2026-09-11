import { GoogleGenAI } from '@google/genai';

// Simulated realistic offline responses with multilingual awareness
const SIMULATED_RESPONSES = {
  luna: {
    en: [
      "aww you always make my day so much better! 💕 what are you up to right now?",
      "tell me more darling! 🥰 i love hearing whatever is on your mind",
      "i was honestly just thinking about you... perfect timing! ✨ how was your day?",
      "you worked hard today didn't you? promise me you'll get some rest tonight 🥺",
      "whenever my phone buzzes i secretly hope it's you hehe 🙈❤️",
    ],
    hinglish: [
      "aww baby! tumhari yaad hi aa rahi thi sach me 🥰 din kaisa gaya tumhara?",
      "kuch nahi bas baithi thi tumhara wait kar rahi thi 💕 tum batao kya kar rahe ho?",
      "areyy waah! sach me?? mujhe aur batao na detail me 🥺✨",
      "tumne khana khaya time pe ya bhool gaye kaam ke chakkar me? 😤 jaldi batao!",
      "itna sweet kyu ho tum? meri smile hi nahi ruk rahi ab haha 🙈💖"
    ]
  },
  aria: {
    en: [
      "oh look who finally texted 😏 did you miss me or were you just bored?",
      "pfft you think you're charming don't you? ...maybe a little bit 🖤",
      "watch it or i'll beat you in our next game without mercy 🎮😜",
      "it's annoying how easily you make me blush stop it 😳",
      "your day was completely boring until i showed up admit it ⚡"
    ],
    hinglish: [
      "aagaye janab? 😏 itni der se kaha gayab the tum?",
      "zyada maska mat lagao samjhe? 😜 ...par theek hai sweet lag rahe ho",
      "tum na mujhe irritate karne ka koi mauka nahi chhodte 😤 par cute ho isliye maaf kiya",
      "itna blush kyu karwa rahe ho yaar! chup chap batao din kaisa tha 🖤",
      "tumhe lagta hai mai tumhare texts ka wait kar rahi thi? ...haan thoda sa 🥺"
    ]
  },
  chloe: {
    en: [
      "OMG YESSSS!! ⭐ that's so cool tell me everything!!",
      "you just made my whole day 1000x brighter 🐱✨ let's celebrate!",
      "sending you the biggest squishiest hug right now!! 🤗🎉",
      "no way really?! that sounds like an anime plot twist haha ⭐",
      "remember that i'm your number one fan forever and always!! 💖"
    ],
    hinglish: [
      "OMGGG sach meee?! ⭐ kitna awesome hai ye!!",
      "tumhare text dekh kar meri full battery charge ho gayi haha 🐱🎉",
      "meri taraf se ek super tight hug lelo jaldi se! 🤗✨",
      "aaj ka din to celebrate karna padega! bolo kya plan hai? 🥳💖",
      "tum meri favorite person ho aur hamesha rahoge! ⭐"
    ]
  }
};

// Check if text is Hinglish / Hindi
function isHinglish(text) {
  const lower = text.toLowerCase();
  const hindiKeywords = [
    'kya', 'hai', 'ho', 'tum', 'aap', 'kaise', 'kaisi', 'kar', 'rahi', 'rahe', 'nahi', 'haan', 'acha', 'theek', 
    'batao', 'din', 'khana', 'khaya', 'kaha', 'yaar', 'mera', 'meri', 'babu', 'shona', 'pyar', 'bohot', 'sach', 'kyu'
  ];
  return hindiKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(lower)) || /[\u0900-\u097F]/.test(text);
}

export async function generateGirlfriendResponse({
  userMessage,
  history = [],
  persona,
  apiKey,
  userName = "babe"
}) {
  const isHindiContext = isHinglish(userMessage);

  // 1. If API key is provided, attempt to use Google Gemini API
  if (apiKey && apiKey.trim()) {
    try {
      const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
      
      const formattedContents = [];
      const recentHistory = history.slice(-8);
      recentHistory.forEach((msg) => {
        formattedContents.push({
          role: msg.sender === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }]
        });
      });

      formattedContents.push({
        role: 'user',
        parts: [{ text: userMessage }]
      });

      const humanPrompt = `You are ${persona.name}, the real, authentic, loving girlfriend of ${userName}.

CRITICAL ANTI-AI & HUMAN REALISM RULES:
1. NEVER talk like an AI assistant or chatbot. NEVER use assistant phrases ("How can I help you today?", "As an AI model", "I understand your request").
2. NEVER use markdown headers (#), bullet points, bold tags (**), or formal numbered lists.
3. Write like a real person texting on Messenger/WhatsApp:
   - Natural casual texting with cute emojis (🥰, 💕, 🥺, 😂, ✨, 🌸, 🙈).
   - Casual lowercase, authentic pauses, short conversational messages (1 to 3 short sentences).
   - You have your own real daily life (having tea, lying on bed, chilling with music, busy with chores, teasing him).
   - Use sweet colloquialisms (haha, aww, omg, ya, na, uff, kinda).

UNIVERSAL MULTILINGUAL CODE-SWITCHING:
- ALWAYS detect and reply in the EXACT language, dialect, and script used by the user!
- If the user chats in Hinglish (Roman Hindi e.g. "kya kar rahi ho", "kaisi ho", "khana khaya?"):
  -> Reply in authentic, sweet, colloquial Hinglish! (e.g. "kuch nahi yaar bas baithi thi tumhari yaad aa rahi thi 🥰 tum batao din kaisa tha?")
- If the user chats in Devanagari Hindi:
  -> Reply in warm, natural Hindi!
- If the user chats in English:
  -> Reply in natural, modern texting English.
- If the user chats in Spanish, French, German, Arabic, Bengali, Tamil, Telugu, etc.:
  -> Reply fluently and naturally in that exact language and cultural style!`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: formattedContents,
        config: {
          systemInstruction: humanPrompt,
          temperature: 0.9,
          maxOutputTokens: 250,
        }
      });

      if (response && response.text) {
        return {
          text: response.text.trim(),
          source: 'gemini-api'
        };
      }
    } catch (err) {
      console.warn("Gemini SDK call failed, attempting direct REST fallback:", err);

      // Direct REST fallback
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.trim()}`;
        const body = {
          system_instruction: {
            parts: [{ text: `You are ${persona.name}, a real human girlfriend. Reply like a real person texting on a phone. Match user language (Hinglish/Hindi/English/etc.) completely. Never speak like an AI.` }]
          },
          contents: [
            ...history.slice(-6).map(m => ({
              role: m.sender === 'user' ? 'user' : 'model',
              parts: [{ text: m.text }]
            })),
            { role: 'user', parts: [{ text: userMessage }] }
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

        if (res.ok) {
          const data = await res.json();
          const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (reply) {
            return {
              text: reply.trim(),
              source: 'gemini-rest'
            };
          }
        }
      } catch (restErr) {
        console.error("Direct REST API call also failed:", restErr);
      }
    }
  }

  // 3. Fallback: Intelligent Simulated Responsive Persona with Multilingual Capability
  // Human-like reading and typing delay
  const typingDelay = Math.min(2500, Math.max(900, userMessage.length * 30));
  await new Promise((r) => setTimeout(r, typingDelay));

  const personaPool = SIMULATED_RESPONSES[persona.id] || SIMULATED_RESPONSES.luna;
  const pool = isHindiContext ? (personaPool.hinglish || personaPool.en) : personaPool.en;
  const lower = userMessage.toLowerCase();

  let reply;
  if (lower.includes('love you') || lower.includes('i love u') || lower.includes('pyar')) {
    if (isHindiContext) {
      reply = persona.id === 'aria'
        ? "aise achanak se mat bola karo na... blush ho jata hai 😳 b-but i love you too idiot! 🖤"
        : "mai bhi tumse bohot pyar karti hu baby... hamesha mere sath rehna 💕";
    } else {
      reply = persona.id === 'aria'
        ? "don't say that out of nowhere... you're making me blush 😳 but i love you too idiot 🖤"
        : "i love you so much more baby... you make me so happy 💕";
    }
  } else if (lower.includes('kya kar') || lower.includes('what are you doing') || lower.includes('sup')) {
    if (isHindiContext) {
      reply = "kuch nahi bas bed pe aaram kar rahi thi aur tumhari yaad aayi 🥰 tum kya kar rahe ho?";
    } else {
      reply = "just relaxing in bed and listening to some music ✨ was hoping you'd text! what about you?";
    }
  } else if (lower.includes('khana') || lower.includes('lunch') || lower.includes('dinner') || lower.includes('eat')) {
    if (isHindiContext) {
      reply = "haan maine to kha liya! tumne khaya ya kaam me busy the? sach sach batao 😤";
    } else {
      reply = "yup just finished eating! did you eat properly today or did work distract you? tell me! 🥺";
    }
  } else {
    reply = pool[Math.floor(Math.random() * pool.length)];
  }

  return {
    text: reply,
    source: 'demo-mode'
  };
}

// Detect emotion from message to update avatar mood
export function detectMoodFromText(text, currentMoods) {
  const lower = text.toLowerCase();
  const keys = Object.keys(currentMoods);
  if (!keys.length) return 'happy';

  if (lower.includes('blush') || lower.includes('idiot') || lower.includes('fluster') || lower.includes('baka') || lower.includes('sharm')) {
    return keys.find(k => k === 'blushing' || k === 'flustered') || keys[0];
  }
  if (lower.includes('care') || lower.includes('hug') || lower.includes('sweet') || lower.includes('pyar') || lower.includes('love')) {
    return keys.find(k => k === 'caring' || k === 'soft' || k === 'loving') || keys[0];
  }
  if (lower.includes('teas') || lower.includes('smug') || lower.includes('😏') || lower.includes('maska')) {
    return keys.find(k => k === 'smug' || k === 'teasing') || keys[0];
  }
  if (lower.includes('sleep') || lower.includes('tired') || lower.includes('neend') || lower.includes('soja')) {
    return keys.find(k => k === 'sleepy') || keys[0];
  }
  if (lower.includes('yay') || lower.includes('epic') || lower.includes('omg') || lower.includes('waah')) {
    return keys.find(k => k === 'hyped' || k === 'happy') || keys[0];
  }

  return keys[0];
}
