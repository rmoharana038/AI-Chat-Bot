import React, { useState, useRef, useEffect } from 'react';
import { Send, Mic, MicOff, Sparkles, Heart } from 'lucide-react';
import { QUICK_ICEBREAKERS } from '../data/personas';
import { speechService } from '../services/speechService';

export default function MessageInput({
  onSendMessage,
  disabled,
  personaName,
  soundEffects = true
}) {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (!text.trim() || disabled) return;
    onSendMessage(text.trim());
    setText('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Voice recording handler
  const toggleRecording = () => {
    if (isRecording) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsRecording(false);
      return;
    }

    const recognizer = speechService.createRecognizer(
      (transcript) => {
        setText(prev => (prev ? `${prev} ${transcript}` : transcript));
      },
      () => {
        setIsRecording(false);
      },
      (error) => {
        console.error("Speech recognition error:", error);
        setIsRecording(false);
      }
    );

    if (recognizer) {
      recognitionRef.current = recognizer;
      try {
        recognizer.start();
        setIsRecording(true);
      } catch (err) {
        console.error(err);
      }
    } else {
      alert("Speech recognition is not supported in this browser. Try Google Chrome or Microsoft Edge!");
    }
  };

  const handleChipClick = (prompt) => {
    onSendMessage(prompt);
  };

  return (
    <div className="w-full glass-panel border-t border-pink-500/20 p-3 sm:p-4 max-w-4xl mx-auto rounded-t-3xl sm:rounded-t-none">
      {/* Quick Icebreakers */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-2 scrollbar-none text-xs">
        <span className="text-[11px] text-pink-300/70 font-semibold flex items-center gap-1 shrink-0">
          <Sparkles className="w-3 h-3 text-pink-400" /> Prompts:
        </span>
        {QUICK_ICEBREAKERS.slice(0, 5).map((prompt, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleChipClick(prompt)}
            className="shrink-0 px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-pink-500/20 text-pink-200/90 border border-pink-500/20 hover:border-pink-500/40 transition text-[11px]"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input Box */}
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        {/* Voice mic toggle */}
        <button
          type="button"
          onClick={toggleRecording}
          className={`p-3 rounded-2xl border transition-all shrink-0 ${
            isRecording
              ? 'bg-rose-600 text-white border-rose-400 animate-pulse ring-2 ring-rose-400/50'
              : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-white/10 hover:text-pink-300'
          }`}
          title={isRecording ? "Listening... click to stop" : "Speak to your girlfriend"}
        >
          {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${personaName}...`}
            rows={1}
            disabled={disabled}
            className="w-full bg-slate-800/90 text-white placeholder-slate-400 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/60 border border-white/10 resize-none max-h-32 transition"
          />
        </div>

        {/* Send button */}
        <button
          type="submit"
          disabled={!text.trim() || disabled}
          className="p-3 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white shadow-lg shadow-pink-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shrink-0 group active:scale-95"
          title="Send message"
        >
          <Send className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </button>
      </form>
    </div>
  );
}
