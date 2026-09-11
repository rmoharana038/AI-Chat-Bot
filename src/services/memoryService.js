import { RELATIONSHIP_LEVELS, PRESET_PERSONAS } from '../data/personas';

const STORAGE_KEYS = {
  SETTINGS: 'aura_girlfriend_settings',
  AFFECTION: 'aura_girlfriend_affection',
  MESSAGES: 'aura_girlfriend_messages',
  MEMORIES: 'aura_girlfriend_memories',
  CUSTOM_PERSONAS: 'aura_custom_personas',
  ACTIVE_PERSONA: 'aura_active_persona',
};

// Default app settings
export const getSettings = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return data ? JSON.parse(data) : {
      apiKey: import.meta.env.VITE_GEMINI_API_KEY || '',
      voiceEnabled: true,
      autoVoice: false,
      soundEffects: true,
      theme: 'pink', // 'pink', 'purple', 'neon', 'sunset'
      userName: 'Sweetheart',
    };
  } catch (e) {
    return {
      apiKey: '',
      voiceEnabled: true,
      autoVoice: false,
      soundEffects: true,
      theme: 'pink',
      userName: 'Sweetheart',
    };
  }
};

export const saveSettings = (settings) => {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
};

// Affection & Relationship Progress
export const getAffection = (personaId) => {
  try {
    const data = localStorage.getItem(`${STORAGE_KEYS.AFFECTION}_${personaId}`);
    return data ? parseInt(data, 10) : 25; // start with slight warmth
  } catch (e) {
    return 25;
  }
};

export const addAffection = (personaId, points = 5) => {
  const current = getAffection(personaId);
  const updated = Math.min(1000, current + points);
  localStorage.setItem(`${STORAGE_KEYS.AFFECTION}_${personaId}`, updated.toString());
  return updated;
};

export const getRelationshipLevel = (affectionPoints) => {
  for (let i = RELATIONSHIP_LEVELS.length - 1; i >= 0; i--) {
    if (affectionPoints >= RELATIONSHIP_LEVELS[i].minAffection) {
      const current = RELATIONSHIP_LEVELS[i];
      const next = RELATIONSHIP_LEVELS[i + 1] || null;
      const progressToNext = next 
        ? Math.min(100, Math.round(((affectionPoints - current.minAffection) / (next.minAffection - current.minAffection)) * 100))
        : 100;
      return {
        ...current,
        nextLevel: next,
        progressToNext,
      };
    }
  }
  return { ...RELATIONSHIP_LEVELS[0], nextLevel: RELATIONSHIP_LEVELS[1], progressToNext: 0 };
};

// Chat Messages History
export const getMessages = (personaId) => {
  try {
    const data = localStorage.getItem(`${STORAGE_KEYS.MESSAGES}_${personaId}`);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
};

export const saveMessages = (personaId, messages) => {
  try {
    // Keep last 100 messages to avoid browser storage bloat
    const trimmed = messages.slice(-100);
    localStorage.setItem(`${STORAGE_KEYS.MESSAGES}_${personaId}`, JSON.stringify(trimmed));
  } catch (e) {
    console.error("Failed to save chat history", e);
  }
};

// Memory Diary
export const getMemories = (personaId) => {
  try {
    const data = localStorage.getItem(`${STORAGE_KEYS.MEMORIES}_${personaId}`);
    return data ? JSON.parse(data) : [
      { id: '1', date: new Date().toLocaleDateString(), text: "First day we met! You said hello to me." }
    ];
  } catch (e) {
    return [];
  }
};

export const addMemory = (personaId, memoryText) => {
  const memories = getMemories(personaId);
  const newMemory = {
    id: Date.now().toString(),
    date: new Date().toLocaleDateString(),
    text: memoryText,
  };
  const updated = [newMemory, ...memories].slice(0, 30);
  localStorage.setItem(`${STORAGE_KEYS.MEMORIES}_${personaId}`, JSON.stringify(updated));
  return updated;
};

// Custom Personas
export const getCustomPersonas = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CUSTOM_PERSONAS);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
};

export const saveCustomPersona = (persona) => {
  const customs = getCustomPersonas();
  const existingIdx = customs.findIndex(p => p.id === persona.id);
  let updated;
  if (existingIdx >= 0) {
    customs[existingIdx] = persona;
    updated = [...customs];
  } else {
    updated = [...customs, persona];
  }
  localStorage.setItem(STORAGE_KEYS.CUSTOM_PERSONAS, JSON.stringify(updated));
  return updated;
};

export const getActivePersonaId = () => {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_PERSONA) || 'luna';
  } catch (e) {
    return 'luna';
  }
};

export const setActivePersonaId = (id) => {
  localStorage.setItem(STORAGE_KEYS.ACTIVE_PERSONA, id);
};

export const clearPersonaData = (personaId) => {
  localStorage.removeItem(`${STORAGE_KEYS.MESSAGES}_${personaId}`);
  localStorage.removeItem(`${STORAGE_KEYS.AFFECTION}_${personaId}`);
  localStorage.removeItem(`${STORAGE_KEYS.MEMORIES}_${personaId}`);
};
