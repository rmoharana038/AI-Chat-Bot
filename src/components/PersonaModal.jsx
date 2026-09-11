import React from 'react';
import { X, Check, Plus, Heart, Sparkles } from 'lucide-react';
import { PRESET_PERSONAS } from '../data/personas';

export default function PersonaModal({
  isOpen,
  onClose,
  activePersonaId,
  onSelectPersona,
  customPersonas = [],
  onOpenCreateCustom
}) {
  if (!isOpen) return null;

  const allPersonas = [...PRESET_PERSONAS, ...customPersonas];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-message">
      <div className="glass-panel w-full max-w-2xl rounded-3xl p-5 sm:p-6 border border-pink-500/30 shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              Choose Your Companion <Sparkles className="w-5 h-5 text-pink-400" />
            </h2>
            <p className="text-xs text-pink-200/70">Pick a personality or craft your own dream companion</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Persona Cards List */}
        <div className="flex-1 overflow-y-auto py-4 space-y-3.5 pr-1">
          {allPersonas.map((p) => {
            const isSelected = p.id === activePersonaId;
            return (
              <div
                key={p.id}
                onClick={() => {
                  onSelectPersona(p);
                  onClose();
                }}
                className={`p-4 rounded-2xl glass-card cursor-pointer transition-all border ${
                  isSelected
                    ? 'border-pink-500 bg-pink-500/10 ring-2 ring-pink-500/30'
                    : 'border-white/10 hover:border-pink-500/40 hover:bg-slate-800/80'
                }`}
              >
                <div className="flex items-start gap-4">
                  <img
                    src={p.avatar}
                    alt={p.name}
                    className="w-16 h-16 rounded-2xl object-cover border-2 border-pink-500/40 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-white text-base flex items-center gap-1.5">
                        {p.name}
                        {isSelected && (
                          <span className="px-2 py-0.5 rounded-full bg-pink-500 text-white text-[10px] font-semibold flex items-center gap-1">
                            <Check className="w-3 h-3" /> Active
                          </span>
                        )}
                      </h3>
                    </div>
                    <p className="text-xs text-pink-300/90 font-medium mb-1">{p.tagline}</p>
                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">{p.personality}</p>

                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.hobbies?.slice(0, 3).map((h, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-white/5">
                          {h}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer with Create Custom Button */}
        <div className="pt-4 border-t border-white/10 flex items-center justify-between">
          <button
            onClick={() => {
              onClose();
              onOpenCreateCustom();
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-pink-500/20 hover:bg-pink-500/30 text-pink-300 border border-pink-500/30 text-xs font-semibold transition"
          >
            <Plus className="w-4 h-4" /> Create Custom Girlfriend
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
