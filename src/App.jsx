import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import ChatArea from './components/ChatArea';
import MessageInput from './components/MessageInput';
import PersonaModal from './components/PersonaModal';
import CustomPersonaModal from './components/CustomPersonaModal';
import MemoryDiaryModal from './components/MemoryDiaryModal';
import SettingsModal from './components/SettingsModal';

import { PRESET_PERSONAS } from './data/personas';
import {
  getSettings,
  saveSettings,
  getAffection,
  addAffection,
  getRelationshipLevel,
  getMessages,
  saveMessages,
  getMemories,
  addMemory,
  getCustomPersonas,
  saveCustomPersona,
  getActivePersonaId,
  setActivePersonaId,
  clearPersonaData
} from './services/memoryService';
import { generateGirlfriendResponse, detectMoodFromText } from './services/geminiService';
import { speechService } from './services/speechService';

export default function App() {
  // Settings & Theme
  const [settings, setSettingsState] = useState(getSettings);
  
  // Personas
  const [customPersonas, setCustomPersonas] = useState(getCustomPersonas);
  const allPersonas = [...PRESET_PERSONAS, ...customPersonas];
  
  const [activePersonaId, setActivePersonaIdState] = useState(() => {
    const savedId = getActivePersonaId();
    return allPersonas.some(p => p.id === savedId) ? savedId : PRESET_PERSONAS[0].id;
  });

  const activePersona = allPersonas.find(p => p.id === activePersonaId) || PRESET_PERSONAS[0];

  // Conversation & Progression State
  const [messages, setMessages] = useState(() => getMessages(activePersona.id));
  const [affection, setAffection] = useState(() => getAffection(activePersona.id));
  const [memories, setMemories] = useState(() => getMemories(activePersona.id));
  const [currentMood, setCurrentMood] = useState('happy');
  const [isTyping, setIsTyping] = useState(false);
  
  // Audio State
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Modals
  const [isPersonaModalOpen, setIsPersonaModalOpen] = useState(false);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [isDiaryModalOpen, setIsDiaryModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Sync with localStorage when switching active persona
  useEffect(() => {
    setMessages(getMessages(activePersona.id));
    setAffection(getAffection(activePersona.id));
    setMemories(getMemories(activePersona.id));
    setCurrentMood('happy');
    speechService.stop();
    setCurrentlyPlayingId(null);
    setIsSpeaking(false);
  }, [activePersona.id]);

  // Persist messages whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(activePersona.id, messages);
    }
  }, [messages, activePersona.id]);

  const relationship = getRelationshipLevel(affection);

  // Send Message Logic
  const handleSendMessage = async (text) => {
    if (!text.trim() || isTyping) return;

    const userMessageObj = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      liked: false,
      reactionCount: 0
    };

    const updatedMessages = [...messages, userMessageObj];
    setMessages(updatedMessages);

    // Audio feedback on send
    if (settings.soundEffects) {
      speechService.playCuteChime('send');
    }

    // Affection calculations
    const lower = text.toLowerCase();
    let bonusAffection = 4;
    if (lower.includes('love') || lower.includes('miss you') || lower.includes('cute') || lower.includes('sweet')) {
      bonusAffection += 4;
    }
    const newAffection = addAffection(activePersona.id, bonusAffection);
    setAffection(newAffection);

    // Check if user shared something memorable to save in diary
    if (lower.includes('my favorite') || lower.includes('i love to') || lower.includes('i work as') || lower.includes('my birthday')) {
      const updatedMemories = addMemory(activePersona.id, `You shared: "${text}"`);
      setMemories(updatedMemories);
    }

    // Start AI Response Generation
    setIsTyping(true);

    try {
      const response = await generateGirlfriendResponse({
        userMessage: text,
        history: updatedMessages,
        persona: activePersona,
        apiKey: settings.apiKey,
        userName: settings.userName
      });

      // Detect mood for avatar expression
      const detectedMood = detectMoodFromText(response.text, activePersona.moods || {});
      setCurrentMood(detectedMood);

      const aiMessageObj = {
        id: `ai_${Date.now()}`,
        sender: 'ai',
        text: response.text,
        source: response.source,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        liked: false,
        reactionCount: 0
      };

      setMessages(prev => [...prev, aiMessageObj]);

      // Sound chime on receive
      if (settings.soundEffects) {
        speechService.playCuteChime('receive');
      }

      // Auto speech if enabled
      if (settings.voiceEnabled && settings.autoVoice) {
        handlePlayVoice(aiMessageObj.id, aiMessageObj.text);
      }
    } catch (err) {
      console.error("Error generating girlfriend response:", err);
    } finally {
      setIsTyping(false);
    }
  };

  // Play voice synthesis for a message
  const handlePlayVoice = (msgId, text) => {
    if (!settings.voiceEnabled) return;

    if (currentlyPlayingId === msgId && isSpeaking) {
      speechService.stop();
      setCurrentlyPlayingId(null);
      setIsSpeaking(false);
      return;
    }

    setCurrentlyPlayingId(msgId);
    speechService.speak(text, {
      pitch: activePersona.voiceSettings?.pitch || 1.1,
      rate: activePersona.voiceSettings?.rate || 1.0,
      onStart: () => setIsSpeaking(true),
      onEnd: () => {
        setIsSpeaking(false);
        setCurrentlyPlayingId(null);
      },
      onError: () => {
        setIsSpeaking(false);
        setCurrentlyPlayingId(null);
      }
    });
  };

  const handleStopSpeaking = () => {
    speechService.stop();
    setIsSpeaking(false);
    setCurrentlyPlayingId(null);
  };

  // Add Heart Reaction to a message
  const handleAddReaction = (msgId) => {
    setMessages(prev => prev.map(msg => {
      if (msg.id === msgId) {
        return {
          ...msg,
          liked: true,
          reactionCount: (msg.reactionCount || 0) + 1
        };
      }
      return msg;
    }));

    if (settings.soundEffects) {
      speechService.playCuteChime('heart');
    }

    const newAff = addAffection(activePersona.id, 2);
    setAffection(newAff);
  };

  // Persona Switching
  const handleSelectPersona = (persona) => {
    setActivePersonaIdState(persona.id);
    setActivePersonaId(persona.id);
  };

  // Custom Persona Creation
  const handleSaveCustomPersona = (newPersona) => {
    const updated = saveCustomPersona(newPersona);
    setCustomPersonas(updated);
    handleSelectPersona(newPersona);
  };

  // Save Settings
  const handleSaveSettings = (newSettings) => {
    saveSettings(newSettings);
    setSettingsState(newSettings);
  };

  // Reset Data
  const handleClearData = () => {
    clearPersonaData(activePersona.id);
    setMessages([]);
    setAffection(25);
    setMemories([]);
  };

  // Theme-specific glow classes
  const getThemeBackground = () => {
    switch (settings.theme) {
      case 'purple':
        return 'from-slate-950 via-purple-950/40 to-slate-950';
      case 'neon':
        return 'from-slate-950 via-cyan-950/30 to-rose-950/30';
      case 'sunset':
        return 'from-slate-950 via-amber-950/30 to-rose-950/40';
      case 'pink':
      default:
        return 'from-slate-950 via-pink-950/30 to-slate-950';
    }
  };

  return (
    <div className={`min-h-screen bg-gradient-to-b ${getThemeBackground()} flex flex-col relative`}>
      {/* Header */}
      <Header
        persona={activePersona}
        currentMood={currentMood}
        relationship={relationship}
        affection={affection}
        onOpenPersonas={() => setIsPersonaModalOpen(true)}
        onOpenDiary={() => setIsDiaryModalOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        isSpeaking={isSpeaking}
        onStopSpeaking={handleStopSpeaking}
        autoVoice={settings.autoVoice}
        theme={settings.theme}
      />

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <ChatArea
          messages={messages}
          persona={activePersona}
          isTyping={isTyping}
          onPlayVoice={handlePlayVoice}
          onAddReaction={handleAddReaction}
          onSendPreset={handleSendMessage}
          currentlyPlayingId={currentlyPlayingId}
        />

        {/* Input Bar */}
        <MessageInput
          onSendMessage={handleSendMessage}
          disabled={isTyping}
          personaName={activePersona.name}
          soundEffects={settings.soundEffects}
        />
      </main>

      {/* Modals */}
      <PersonaModal
        isOpen={isPersonaModalOpen}
        onClose={() => setIsPersonaModalOpen(false)}
        activePersonaId={activePersona.id}
        onSelectPersona={handleSelectPersona}
        customPersonas={customPersonas}
        onOpenCreateCustom={() => setIsCustomModalOpen(true)}
      />

      <CustomPersonaModal
        isOpen={isCustomModalOpen}
        onClose={() => setIsCustomModalOpen(false)}
        onSaveCustomPersona={handleSaveCustomPersona}
      />

      <MemoryDiaryModal
        isOpen={isDiaryModalOpen}
        onClose={() => setIsDiaryModalOpen(false)}
        persona={activePersona}
        affection={affection}
        relationship={relationship}
        memories={memories}
        onAddMemory={(txt) => setMemories(addMemory(activePersona.id, txt))}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        onClearData={handleClearData}
        personaName={activePersona.name}
      />
    </div>
  );
}
