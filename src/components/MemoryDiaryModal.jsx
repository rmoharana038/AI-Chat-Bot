import React, { useState } from 'react';
import { X, Heart, BookHeart, Sparkles, Plus, Calendar, Award } from 'lucide-react';
import { RELATIONSHIP_LEVELS } from '../data/personas';

export default function MemoryDiaryModal({
  isOpen,
  onClose,
  persona,
  affection,
  relationship,
  memories = [],
  onAddMemory
}) {
  const [newMemoryText, setNewMemoryText] = useState('');

  if (!isOpen) return null;

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newMemoryText.trim()) return;
    onAddMemory(newMemoryText.trim());
    setNewMemoryText('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-message">
      <div className="glass-panel w-full max-w-xl rounded-3xl p-5 sm:p-6 border border-pink-500/30 shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              Our Relationship Diary <BookHeart className="w-5 h-5 text-pink-400" />
            </h2>
            <p className="text-xs text-pink-200/70">Your shared moments, affection milestones & memories with {persona.name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-5 pr-1 text-xs">
          {/* Status Card */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-pink-900/30 via-slate-800 to-purple-900/20 border border-pink-500/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-pink-300 flex items-center gap-1.5">
                <Award className="w-4 h-4 text-pink-400" /> Level {relationship.level}: {relationship.name}
              </span>
              <span className="text-xs font-bold text-white flex items-center gap-1">
                <Heart className="w-3.5 h-3.5 text-pink-400 fill-pink-400 animate-heartbeat" />
                {affection} Affection Points
              </span>
            </div>

            <p className="text-slate-300 text-xs mb-3 italic">"{relationship.title}"</p>

            {/* Progress bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>Progress to {relationship.nextLevel ? `Level ${relationship.nextLevel.level} (${relationship.nextLevel.name})` : 'Max Bound'}</span>
                <span>{relationship.progressToNext}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-white/5">
                <div
                  className="h-full bg-gradient-to-r from-pink-500 to-rose-400 rounded-full transition-all duration-500"
                  style={{ width: `${relationship.progressToNext}%` }}
                />
              </div>
            </div>
          </div>

          {/* Relationship Stages Timeline */}
          <div>
            <h3 className="text-slate-200 font-semibold mb-2.5 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-pink-400" /> Bond Milestones
            </h3>
            <div className="grid grid-cols-5 gap-1.5 text-center">
              {RELATIONSHIP_LEVELS.map((lvl) => {
                const reached = affection >= lvl.minAffection;
                return (
                  <div
                    key={lvl.level}
                    className={`p-2 rounded-xl border transition ${
                      reached
                        ? 'bg-pink-500/15 border-pink-500/40 text-pink-200 shadow-sm'
                        : 'bg-slate-800/40 border-white/5 text-slate-500'
                    }`}
                  >
                    <div className="text-[10px] font-bold">Lv.{lvl.level}</div>
                    <div className="text-[9px] truncate font-medium">{lvl.name}</div>
                    <div className="text-[8px] opacity-70">{lvl.minAffection} pts</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add a Memory Form */}
          <div>
            <form onSubmit={handleAdd} className="flex gap-2">
              <input
                type="text"
                value={newMemoryText}
                onChange={(e) => setNewMemoryText(e.target.value)}
                placeholder="Write a memory or note to remember together..."
                className="flex-1 bg-slate-800 text-white rounded-xl px-3 py-2 border border-white/10 focus:outline-none focus:ring-1 focus:ring-pink-500 text-xs"
              />
              <button
                type="submit"
                disabled={!newMemoryText.trim()}
                className="px-3.5 py-2 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-semibold transition disabled:opacity-40 flex items-center gap-1 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> Remember
              </button>
            </form>
          </div>

          {/* Memories List */}
          <div>
            <h3 className="text-slate-200 font-semibold mb-2 flex items-center gap-1.5">
              <BookHeart className="w-3.5 h-3.5 text-pink-400" /> Sweet Memories & Notes ({memories.length})
            </h3>
            <div className="space-y-2">
              {memories.length === 0 ? (
                <p className="text-slate-400 italic text-center py-4">No memories recorded yet. Chat more to make sweet memories!</p>
              ) : (
                memories.map((m) => (
                  <div key={m.id} className="p-3 rounded-xl glass-card border border-white/5 flex items-start gap-2.5">
                    <span className="text-pink-400 mt-0.5">💖</span>
                    <div className="flex-1">
                      <p className="text-slate-200 leading-relaxed">{m.text}</p>
                      <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1">
                        <Calendar className="w-3 h-3" />
                        <span>{m.date}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
