import React from 'react';
import { Heart, Sparkles, BookHeart, Users, Settings as SettingsIcon, Volume2, VolumeX } from 'lucide-react';

export default function Header({
  persona,
  currentMood,
  relationship,
  affection,
  onOpenPersonas,
  onOpenDiary,
  onOpenSettings,
  isSpeaking,
  onStopSpeaking,
  autoVoice,
  theme = 'pink'
}) {
  const moodData = persona.moods?.[currentMood] || Object.values(persona.moods || {})[0] || { emoji: '😊', label: 'Happy' };

  return (
    <header className="sticky top-0 z-30 w-full glass-panel border-b border-pink-500/20 px-4 py-3 sm:px-6">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
        {/* Left: Avatar & Info */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative cursor-pointer group" onClick={onOpenPersonas} title="Switch Girlfriend Persona">
            <div className="w-11 h-11 sm:w-13 sm:h-13 rounded-full overflow-hidden p-[2px] bg-gradient-to-tr from-pink-500 via-rose-400 to-purple-500 shadow-md group-hover:scale-105 transition-transform duration-200">
              <img
                src={persona.avatar}
                alt={persona.name}
                className="w-full h-full object-cover rounded-full"
              />
            </div>
            {/* Status indicator */}
            <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 border-slate-900 rounded-full animate-pulse" />
            {/* Mood mini badge */}
            <span className="absolute -top-1 -right-1 text-xs bg-slate-900/90 rounded-full px-1 shadow border border-pink-500/30">
              {moodData.emoji}
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-white truncate flex items-center gap-1.5">
                {persona.name}
                <Sparkles className="w-3.5 h-3.5 text-pink-400 fill-pink-400" />
              </h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-pink-500/15 border border-pink-500/30 text-pink-300 font-medium hidden sm:inline-flex items-center gap-1">
                {moodData.label} {moodData.emoji}
              </span>
            </div>
            
            {/* Relationship Progress bar */}
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] sm:text-xs text-pink-200/80 font-medium">
                Lv.{relationship.level} {relationship.name}
              </span>
              <div className="w-16 sm:w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-white/5" title={`${relationship.progressToNext}% to next level`}>
                <div
                  className="h-full bg-gradient-to-r from-pink-500 to-rose-400 rounded-full transition-all duration-500"
                  style={{ width: `${relationship.progressToNext}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Speaking indicator toggle */}
          {isSpeaking && (
            <button
              onClick={onStopSpeaking}
              className="p-2 rounded-xl bg-pink-500/20 text-pink-300 hover:bg-pink-500/30 transition border border-pink-500/40 animate-pulse"
              title="Stop voice playback"
            >
              <VolumeX className="w-4 h-4" />
            </button>
          )}

          {/* Affection counter */}
          <div
            onClick={onOpenDiary}
            className="cursor-pointer flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-pink-500/10 hover:bg-pink-500/20 border border-pink-500/20 transition-all text-xs font-semibold text-pink-300 group"
            title="Relationship Affection Points • Click to view Diary"
          >
            <Heart className="w-3.5 h-3.5 text-pink-400 fill-pink-400 group-hover:scale-110 transition-transform animate-heartbeat" />
            <span>{affection}</span>
          </div>

          {/* Persona switch button */}
          <button
            onClick={onOpenPersonas}
            className="p-2 rounded-xl bg-slate-800/70 hover:bg-slate-700/80 text-slate-200 border border-white/10 transition-all hover:text-pink-300"
            title="Change Girlfriend Persona"
          >
            <Users className="w-4 h-4" />
          </button>

          {/* Memory Diary button */}
          <button
            onClick={onOpenDiary}
            className="p-2 rounded-xl bg-slate-800/70 hover:bg-slate-700/80 text-slate-200 border border-white/10 transition-all hover:text-pink-300"
            title="Our Diary & Memories"
          >
            <BookHeart className="w-4 h-4" />
          </button>

          {/* Settings button */}
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-xl bg-slate-800/70 hover:bg-slate-700/80 text-slate-200 border border-white/10 transition-all hover:text-pink-300"
            title="Chat & API Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
