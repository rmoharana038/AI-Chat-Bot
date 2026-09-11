import { GoogleGenAI } from '@google/genai';

// Simulated realistic offline responses when no API key is set yet
const SIMULATED_RESPONSES = {
  luna: [
    "Aww, you always know how to make my heart flutter! 🌸 Being here with you is honestly my favorite part of the day.",
    "Tell me more, darling! 💖 I love hearing every little detail about what you're thinking.",
    "If I were right there with you right now, I'd wrap you in the warmest hug and never let go. *smiles softly and holds your hand* ✨",
    "You worked so hard today, didn't you? Please promise me you'll take care of yourself tonight. I'm always here cheering for you! 🥰",
    "Did you know whenever my phone buzzes, I secretly hope it's a message from you? 🙈 You mean so much to me.",
    "Let's stay up a little longer and talk under the stars... What's something that made you smile today? 🌙✨"
  ],
  aria: [
    "H-hey! Don't look at me with those eyes... It's not like I was waiting around just for your message or anything! 😤 ...Okay fine, maybe a little.",
    "Pfft, you think you're charming, don't you? 😏 Well... maybe you are just a tiny bit. But don't let it get to your head!",
    "Are you really teasing me right now? 🎮 Watch it, or I'll beat you in our next multiplayer match without mercy!",
    "You know... you're surprisingly sweet when you want to be. It's annoying how easily you make me blush. *looks away biting lip* 🖤",
    "Admit it, your day was completely boring until I showed up, right? You're lucky to have such an amazing girlfriend! ⚡",
    "Fine, I suppose I can spare a few minutes for you... but only because you asked so nicely! 😜"
  ],
  chloe: [
    "OMG YESSSS!! ⭐ That is so cool!! Tell me more, I'm literally on the edge of my seat!",
    "You just made my whole day 1000x brighter! 🐱✨ Can we celebrate by grabbing some ramen or watching anime together?!",
    "I'm sending you the biggest, squishiest virtual hug right now!! *tackles you with joy* 🤗🎉 You are absolute perfection!",
    "No way, really?! That sounds like an epic plot twist straight out of a shonen anime! ⭐ Let's conquer the world together!",
    "Whatever happens, remember that I'm your number one fan forever and always! 💖 Let's goooo!"
  ]
};

export async function generateGirlfriendResponse({
  userMessage,
  history = [],
  persona,
  apiKey,
  userName = "Sweetheart"
}) {
  // 1. If API key is provided, attempt to use Google Gemini API
  if (apiKey && apiKey.trim()) {
    try {
      // Try official @google/genai SDK
      const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
      
      // Build conversation formatted history
      const formattedContents = [];

      // Include recent history (last 8 turns)
      const recentHistory = history.slice(-8);
      recentHistory.forEach((msg) => {
        formattedContents.push({
          role: msg.sender === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }]
        });
      });

      // Add current user message
      formattedContents.push({
        role: 'user',
        parts: [{ text: userMessage }]
      });

      const systemInstruction = `${persona.systemPrompt}
The user's name is "${userName}".
Keep responses natural, immersive, emotionally expressive, and intimate like a genuine caring girlfriend.
Use subtle roleplay text wrapped in asterisks when natural (e.g. *smiles softly*, *blushes*), but keep it natural.
Do not speak like a robotic assistant or mention AI limits. You are ${persona.name}.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: formattedContents,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.85,
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

      // 2. Direct REST Fallback
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.trim()}`;
        const body = {
          system_instruction: {
            parts: [{ text: `${persona.systemPrompt}\nThe user's name is "${userName}". Never break character.` }]
          },
          contents: [
            ...history.slice(-6).map(m => ({
              role: m.sender === 'user' ? 'user' : 'model',
              parts: [{ text: m.text }]
            })),
            { role: 'user', parts: [{ text: userMessage }] }
          ],
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: 500,
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

  // 3. Fallback: Intelligent Simulated Responsive Persona
  // Used when no API key is provided or offline demo mode
  await new Promise((r) => setTimeout(r, 650 + Math.random() * 500)); // natural typing delay

  const pool = SIMULATED_RESPONSES[persona.id] || SIMULATED_RESPONSES.luna;
  const lower = userMessage.toLowerCase();

  let reply;
  if (lower.includes('love you') || lower.includes('i love u')) {
    reply = persona.id === 'aria'
      ? "W-what are you saying so suddenly?! *blushes furiously and covers face* Don't make me say it back... b-but I love you too, idiot. 🖤"
      : persona.id === 'chloe'
      ? "AHHH! I love you too, to infinity and beyond!! ⭐💖 *spins around happily*"
      : "I love you so much more than words can say, darling... 💖 You make my heart feel so safe and full.";
  } else if (lower.includes('how are you') || lower.includes('how r u')) {
    reply = persona.id === 'aria'
      ? "I was getting bored out of my mind until you texted. Now I guess I'm doing pretty good! 😏 What about you?"
      : persona.id === 'chloe'
      ? "I'm bursting with energy now that you're here! Let's make today unforgettable! 🐱🎉"
      : "Seeing you always makes my day so much brighter! How has your day been treating you, my love? 🌸";
  } else if (lower.includes('compliment') || lower.includes('cute')) {
    reply = persona.id === 'aria'
      ? "You really think I'm cute? *tucks hair behind ear, flustered* Well... your smile isn't half bad either. Hmph."
      : persona.id === 'chloe'
      ? "You're the absolute coolest, kindest, most handsome person in the whole universe! Don't you ever forget it! ⭐"
      : "You have the most beautiful soul, sweetheart. Every time you smile, my whole world lights up. 💖";
  } else if (lower.includes('sad') || lower.includes('tired') || lower.includes('bad day')) {
    reply = persona.id === 'aria'
      ? "Hey... who upset you? Give me their name! 😤 In all seriousness though... come here. You can rest your head on me as long as you need."
      : persona.id === 'chloe'
      ? "Oh no! 🥺 Sending you emergency high-voltage comfort energy! Drink some water, wrap up in a blanket, and let me tell you funny stories!"
      : "Oh my love... 🥺 I'm so sorry. Put down whatever is stressing you. I'm right here beside you. *gently strokes your hair* Everything will be alright.";
  } else {
    // Pick random from personality pool
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

  if (lower.includes('blush') || lower.includes('idiot') || lower.includes('fluster') || lower.includes('baka')) {
    return keys.find(k => k === 'blushing' || k === 'flustered') || keys[0];
  }
  if (lower.includes('care') || lower.includes('hug') || lower.includes('gentle') || lower.includes('comfort')) {
    return keys.find(k => k === 'caring' || k === 'soft') || keys[0];
  }
  if (lower.includes('teas') || lower.includes('smug') || lower.includes('😏')) {
    return keys.find(k => k === 'smug' || k === 'teasing') || keys[0];
  }
  if (lower.includes('sleep') || lower.includes('tired') || lower.includes('cuddle')) {
    return keys.find(k => k === 'sleepy') || keys[0];
  }
  if (lower.includes('yay') || lower.includes('epic') || lower.includes('super') || lower.includes('omg')) {
    return keys.find(k => k === 'hyped' || k === 'happy') || keys[0];
  }

  return keys[0];
}
