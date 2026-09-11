import React, { useState } from 'react';
import { X, Sparkles, Heart, Image as ImageIcon } from 'lucide-react';

const AVATAR_PRESETS = [
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80",
  "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80",
  "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&q=80",
  "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=400&q=80",
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80"
];

export default function CustomPersonaModal({ isOpen, onClose, onSaveCustomPersona }) {
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [avatar, setAvatar] = useState(AVATAR_PRESETS[0]);
  const [personality, setPersonality] = useState('');
  const [speechStyle, setSpeechStyle] = useState('');
  const [greeting, setGreeting] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newPersona = {
      id: `custom_${Date.now()}`,
      name: name.trim(),
      tagline: tagline.trim() || "Your custom dream companion",
      avatar: avatar.trim() || AVATAR_PRESETS[0],
      personality: personality.trim() || "Loving, attentive, and uniquely tailored to you.",
      speechStyle: speechStyle.trim() || "Affectionate and natural.",
      hobbies: ["Spending time with you", "Sharing dreams", "Laughing together"],
      greeting: greeting.trim() || `Hey my love! It's ${name}. I'm so happy to finally meet you! 💖`,
      voiceSettings: { pitch: 1.1, rate: 1.0 },
      moods: {
        happy: { label: "Happy", emoji: "😊" },
        loving: { label: "Loving", emoji: "🥰" },
        blushing: { label: "Blushing", emoji: "😳" }
      },
      systemPrompt: `You are ${name.trim()}, the user's girlfriend.
Personality: ${personality.trim() || "Sweet, loving, supportive, and romantic."}
Speech style: ${speechStyle.trim() || "Sweet and natural with cute warmth."}
Always stay in character as their loving girlfriend. Never refer to yourself as an AI assistant.`
    };

    onSaveCustomPersona(newPersona);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-message">
      <div className="glass-panel w-full max-w-lg rounded-3xl p-5 sm:p-6 border border-pink-500/30 shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              Create Your Dream Girl <Sparkles className="w-5 h-5 text-pink-400" />
            </h2>
            <p className="text-xs text-pink-200/70">Customize her name, look, personality, and tone</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto py-4 space-y-4 pr-1 text-xs">
          {/* Avatar selector */}
          <div>
            <label className="block text-slate-300 font-semibold mb-2">Avatar Choice</label>
            <div className="flex items-center gap-3 mb-2">
              <img
                src={avatar}
                alt="Preview"
                className="w-14 h-14 rounded-2xl object-cover border-2 border-pink-500 shadow-md"
              />
              <div className="flex-1">
                <input
                  type="text"
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  placeholder="Paste image URL or pick preset below"
                  className="w-full bg-slate-800 text-white rounded-xl px-3 py-2 border border-white/10 focus:outline-none focus:ring-1 focus:ring-pink-500"
                />
              </div>
            </div>
            <div className="flex gap-2">
              {AVATAR_PRESETS.map((pUrl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setAvatar(pUrl)}
                  className={`w-9 h-9 rounded-xl overflow-hidden border-2 transition ${
                    avatar === pUrl ? 'border-pink-500 scale-105' : 'border-transparent opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={pUrl} alt="preset" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          {/* Name & Tagline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Mia, Seraphina"
                className="w-full bg-slate-800 text-white rounded-xl px-3 py-2 border border-white/10 focus:outline-none focus:ring-1 focus:ring-pink-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Tagline</label>
              <input
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="e.g. Shy bookworm who adores you"
                className="w-full bg-slate-800 text-white rounded-xl px-3 py-2 border border-white/10 focus:outline-none focus:ring-1 focus:ring-pink-500"
              />
            </div>
          </div>

          {/* Personality */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Personality & Traits</label>
            <textarea
              rows={2}
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              placeholder="e.g. Gentle, loves poetry, shy at first but very warm and sweet once comfortable..."
              className="w-full bg-slate-800 text-white rounded-xl px-3 py-2 border border-white/10 focus:outline-none focus:ring-1 focus:ring-pink-500 resize-none"
            />
          </div>

          {/* Speech style */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Speaking Style</label>
            <input
              type="text"
              value={speechStyle}
              onChange={(e) => setSpeechStyle(e.target.value)}
              placeholder="e.g. Speaks softly with cute stutter (*blushes*), uses floral emojis"
              className="w-full bg-slate-800 text-white rounded-xl px-3 py-2 border border-white/10 focus:outline-none focus:ring-1 focus:ring-pink-500"
            />
          </div>

          {/* Greeting message */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">First Greeting Message</label>
            <textarea
              rows={2}
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="What she says when you first meet..."
              className="w-full bg-slate-800 text-white rounded-xl px-3 py-2 border border-white/10 focus:outline-none focus:ring-1 focus:ring-pink-500 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-white/10 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 text-white font-semibold shadow-md disabled:opacity-40"
            >
              Save & Meet Her 💖
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
