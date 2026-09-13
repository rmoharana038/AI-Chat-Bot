import React, { useState } from 'react';
import { X, Key, Palette, Volume2, Trash2, ExternalLink, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react';

const THEMES = [
  { id: 'pink', name: 'Sakura Pink', color: 'from-pink-500 to-rose-400' },
  { id: 'purple', name: 'Midnight Violet', color: 'from-purple-500 to-indigo-400' },
  { id: 'neon', name: 'Cyber Neon', color: 'from-cyan-400 to-pink-500' },
  { id: 'sunset', name: 'Sunset Warmth', color: 'from-amber-400 to-rose-500' },
];

export default function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  onClearData,
  personaName
}) {
  const [apiKey, setApiKey] = useState(settings.apiKey || '');
  const [showKey, setShowKey] = useState(false);
  const [userName, setUserName] = useState(settings.userName || 'Sweetheart');
  const [voiceEnabled, setVoiceEnabled] = useState(settings.voiceEnabled ?? true);
  const [autoVoice, setAutoVoice] = useState(settings.autoVoice ?? false);
  const [soundEffects, setSoundEffects] = useState(settings.soundEffects ?? true);
  const [theme, setTheme] = useState(settings.theme || 'pink');
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e) => {
    e.preventDefault();
    onSaveSettings({
      apiKey: apiKey.trim(),
      userName: userName.trim() || 'Sweetheart',
      voiceEnabled,
      autoVoice,
      soundEffects,
      theme,
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  const handleClear = () => {
    if (window.confirm(`Are you sure you want to reset your chat history and affection with ${personaName}?`)) {
      onClearData();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-message">
      <div className="glass-panel w-full max-w-xl rounded-3xl p-5 sm:p-6 border border-pink-500/30 shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              Companion Settings
            </h2>
            <p className="text-xs text-pink-200/70">Personalize AI connection, speech, and appearance</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto py-4 space-y-5 pr-1 text-xs">
          {/* Gemini API Key */}
          <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-white font-semibold flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-pink-400" /> Google Gemini API Key
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-pink-400 hover:underline flex items-center gap-1"
              >
                Get free key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Power your girlfriend with Google Gemini AI (`gemini-2.5-flash`). If left blank, the app will run in Demo/Offline simulated mode.
            </p>

            <div className="relative flex items-center">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-slate-900/90 text-white rounded-xl pl-3 pr-10 py-2.5 border border-white/10 focus:outline-none focus:ring-1 focus:ring-pink-500 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 text-slate-400 hover:text-white p-1"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" /> Stored locally in your browser. Also configurable as VITE_GEMINI_API_KEY in Render!
            </div>
          </div>

          {/* User Nickname */}
          <div className="glass-card p-4 rounded-2xl border border-white/10">
            <label className="block text-white font-semibold mb-1">
              What should she call you?
            </label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="e.g. Sweetheart, Darling, Alex..."
              className="w-full bg-slate-900/90 text-white rounded-xl px-3 py-2 border border-white/10 focus:outline-none focus:ring-1 focus:ring-pink-500 text-xs"
            />
          </div>

          {/* Theme selection */}
          <div className="glass-card p-4 rounded-2xl border border-white/10">
            <label className="block text-white font-semibold mb-2.5 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-pink-400" /> Color Accent Theme
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {THEMES.map((th) => (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => setTheme(th.id)}
                  className={`p-2 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                    theme === th.id
                      ? 'border-pink-500 bg-pink-500/10 ring-2 ring-pink-500/40'
                      : 'border-white/10 hover:border-white/30 bg-slate-800/60'
                  }`}
                >
                  <div className={`w-full h-3 rounded-full bg-gradient-to-r ${th.color}`} />
                  <span className="text-[11px] text-slate-200">{th.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Audio & Speech toggles */}
          <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-3">
            <label className="text-white font-semibold flex items-center gap-1.5 mb-1">
              <Volume2 className="w-3.5 h-3.5 text-pink-400" /> Voice & Audio
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="text-slate-200 font-medium">Text-to-Speech Voice</div>
                <div className="text-[10px] text-slate-400">Allows listening to her voice messages</div>
              </div>
              <input
                type="checkbox"
                checked={voiceEnabled}
                onChange={(e) => setVoiceEnabled(e.target.checked)}
                className="w-4 h-4 accent-pink-500 rounded"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="text-slate-200 font-medium">Auto-Speak Replies</div>
                <div className="text-[10px] text-slate-400">Automatically read aloud new girlfriend messages</div>
              </div>
              <input
                type="checkbox"
                checked={autoVoice}
                onChange={(e) => setAutoVoice(e.target.checked)}
                className="w-4 h-4 accent-pink-500 rounded"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="text-slate-200 font-medium">UI Chimes & Sound Effects</div>
                <div className="text-[10px] text-slate-400">Cute sound notifications on send/receive</div>
              </div>
              <input
                type="checkbox"
                checked={soundEffects}
                onChange={(e) => setSoundEffects(e.target.checked)}
                className="w-4 h-4 accent-pink-500 rounded"
              />
            </label>
          </div>

          {/* Danger zone */}
          <div className="glass-card p-4 rounded-2xl border border-red-500/20 flex items-center justify-between">
            <div>
              <div className="text-red-300 font-semibold flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" /> Reset Chat & Memories
              </div>
              <div className="text-[10px] text-slate-400">Erase conversation history and reset affection score</div>
            </div>
            <button
              type="button"
              onClick={handleClear}
              className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition text-xs font-semibold"
            >
              Reset Data
            </button>
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-white/10 flex items-center justify-between">
            {savedSuccess ? (
              <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
                <Check className="w-4 h-4" /> Settings saved!
              </span>
            ) : <span />}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 text-white font-semibold shadow-md"
              >
                Save Settings
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
