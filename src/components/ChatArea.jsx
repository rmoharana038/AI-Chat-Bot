import React, { useEffect, useRef } from 'react';
import { Volume2, Heart, Sparkles, MessageCircleHeart } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function ChatArea({
  messages,
  persona,
  isTyping,
  onPlayVoice,
  onAddReaction,
  onSendPreset,
  currentlyPlayingId
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleHeartReaction = (msgId, e) => {
    // Drop heart confetti from click coordinate
    const rect = e.currentTarget.getBoundingClientRect();
    confetti({
      particleCount: 16,
      spread: 50,
      origin: {
        x: rect.left / window.innerWidth,
        y: rect.top / window.innerHeight
      },
      colors: ['#f43f68', '#fb718d', '#ffccd5']
    });

    onAddReaction(msgId);
  };

  // Helper to style italic action tags like *smiles softly*
  const renderMessageContent = (text) => {
    const parts = text.split(/(\*[^*]+\*)/g);
    return parts.map((part, index) => {
      if (part.startsWith('*') && part.endsWith('*')) {
        return (
          <span key={index} className="italic text-pink-300/90 font-medium">
            {part}
          </span>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 space-y-4 max-w-4xl mx-auto w-full">
      {/* Intro Welcome Banner */}
      {messages.length === 0 && (
        <div className="text-center py-8 px-4 max-w-md mx-auto animate-message">
          <div className="relative inline-block mb-4">
            <img
              src={persona.avatar}
              alt={persona.name}
              className="w-24 h-24 rounded-full mx-auto object-cover border-4 border-pink-500/40 shadow-xl"
            />
            <span className="absolute bottom-1 right-1 text-2xl">💖</span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">
            Say hello to {persona.name}!
          </h2>
          <p className="text-pink-200/80 text-sm mb-4">
            {persona.tagline}
          </p>

          <div className="glass-card p-4 rounded-2xl text-left text-xs space-y-2 mb-6 border border-pink-500/20">
            <div className="text-pink-300 font-semibold flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> What she loves:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {persona.hobbies?.map((hobby, idx) => (
                <span key={idx} className="px-2.5 py-1 rounded-full bg-slate-800/80 text-pink-200/90 border border-white/5">
                  {hobby}
                </span>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-400 mb-3">Send a message or tap one below to start chatting:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <button
              onClick={() => onSendPreset("Hey darling! How's your day going? 🌸")}
              className="p-2.5 rounded-xl glass-card hover:border-pink-500/50 text-pink-200 transition text-left"
            >
              🌸 "Hey darling! How's your day going?"
            </button>
            <button
              onClick={() => onSendPreset("I was thinking of you today 🥰")}
              className="p-2.5 rounded-xl glass-card hover:border-pink-500/50 text-pink-200 transition text-left"
            >
              🥰 "I was thinking of you today"
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      {messages.map((msg) => {
        const isUser = msg.sender === 'user';
        const isPlaying = currentlyPlayingId === msg.id;

        return (
          <div
            key={msg.id}
            className={`flex items-end gap-2.5 sm:gap-3 ${isUser ? 'justify-end' : 'justify-start'} animate-message`}
          >
            {/* Girlfriend Avatar */}
            {!isUser && (
              <img
                src={persona.avatar}
                alt={persona.name}
                className="w-8 h-8 rounded-full object-cover shrink-0 border border-pink-500/30 mb-1"
              />
            )}

            {/* Bubble */}
            <div className={`relative max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-md group ${
              isUser
                ? 'glass-bubble-user text-white rounded-br-xs'
                : 'glass-bubble-ai text-slate-100 rounded-bl-xs'
            }`}>
              <div className="text-sm leading-relaxed whitespace-pre-wrap select-text">
                {renderMessageContent(msg.text)}
              </div>

              {/* Footer with timestamp and tools */}
              <div className={`flex items-center gap-2 mt-1.5 text-[10px] ${
                isUser ? 'justify-end text-rose-100/70' : 'justify-between text-slate-400'
              }`}>
                {!isUser && (
                  <div className="flex items-center gap-2">
                    {/* Audio Play button */}
                    <button
                      onClick={() => onPlayVoice(msg.id, msg.text)}
                      className={`flex items-center gap-1 transition-colors ${
                        isPlaying ? 'text-pink-400 font-semibold animate-pulse' : 'hover:text-pink-300'
                      }`}
                      title={isPlaying ? "Playing voice..." : "Listen to voice"}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>{isPlaying ? 'Speaking...' : 'Voice'}</span>
                    </button>

                    {/* Heart reaction */}
                    <button
                      onClick={(e) => handleHeartReaction(msg.id, e)}
                      className="flex items-center gap-1 hover:text-pink-400 transition-colors"
                      title="Send love (+Affection)"
                    >
                      <Heart className={`w-3.5 h-3.5 ${msg.liked ? 'text-pink-400 fill-pink-400' : ''}`} />
                      {msg.reactionCount > 0 && <span>{msg.reactionCount}</span>}
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-1.5 ml-auto">
                  <span>{msg.timestamp}</span>
                  {!isUser && msg.source === 'gemini-api' && (
                    <span className="px-1.5 py-0.2 rounded bg-pink-500/10 text-pink-300 border border-pink-500/20 text-[9px]">
                      Gemini
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Typing Indicator */}
      {isTyping && (
        <div className="flex items-end gap-2.5 animate-message">
          <img
            src={persona.avatar}
            alt={persona.name}
            className="w-8 h-8 rounded-full object-cover shrink-0 border border-pink-500/30 mb-1"
          />
          <div className="glass-bubble-ai px-4 py-3 rounded-2xl rounded-bl-xs flex items-center gap-1.5">
            <span className="text-xs text-pink-300/80 mr-1 font-medium">{persona.name} is typing</span>
            <span className="w-2 h-2 rounded-full bg-pink-400 typing-dot" />
            <span className="w-2 h-2 rounded-full bg-pink-400 typing-dot" />
            <span className="w-2 h-2 rounded-full bg-pink-400 typing-dot" />
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
