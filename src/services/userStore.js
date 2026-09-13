import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const STATE_FILE = path.join(DATA_DIR, 'user_state.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to create data directory:', e.message);
  }
}

// In-memory cache
let stateCache = {};
let saveTimeout = null;

// Load state from file
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      stateCache = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[userStore] Error reading user state, initializing empty:', err.message);
    stateCache = {};
  }
}

loadState();

// Save state to file (debounced)
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const tempPath = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(stateCache, null, 2), 'utf8');
      fs.renameSync(tempPath, STATE_FILE);
    } catch (err) {
      console.error('[userStore] Error persisting user state:', err.message);
    }
  }, 1000);
}

export function getUser(psid) {
  if (!psid) return null;
  const id = String(psid);
  if (!stateCache[id]) {
    stateCache[id] = {
      psid: id,
      firstSeen: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      sentPhotos: [],
      channelSuggested: false,
      holidayPromoted: false,
      photoCount: 0,
      personaMode: 'default',
      isNewUser: true
    };
    scheduleSave();
  } else if (!stateCache[id].personaMode) {
    stateCache[id].personaMode = 'default';
  }
  return stateCache[id];
}

export function recordSentPhoto(psid, photoFilename) {
  const user = getUser(psid);
  if (!user) return;
  if (!user.sentPhotos.includes(photoFilename)) {
    user.sentPhotos.push(photoFilename);
  }
  user.photoCount = user.sentPhotos.length;
  user.lastActive = new Date().toISOString();
  user.isNewUser = false;
  scheduleSave();
}

export function markChannelSuggested(psid) {
  const user = getUser(psid);
  if (!user) return;
  user.channelSuggested = true;
  user.lastActive = new Date().toISOString();
  scheduleSave();
}

export function markHolidayPromoted(psid) {
  const user = getUser(psid);
  if (!user) return;
  user.holidayPromoted = true;
  user.lastActive = new Date().toISOString();
  scheduleSave();
}

export function setUserPersonaMode(psid, mode = 'default') {
  const user = getUser(psid);
  if (!user) return null;
  user.personaMode = mode;
  user.lastActive = new Date().toISOString();
  scheduleSave();
  return user;
}

export function updateUserProfile(psid, updates = {}) {
  const user = getUser(psid);
  if (!user) return null;
  Object.assign(user, updates);
  user.lastActive = new Date().toISOString();
  scheduleSave();
  return user;
}

export function getUnsentPhotos(psid, allPhotosList) {
  const user = getUser(psid);
  if (!user || !Array.isArray(allPhotosList)) return allPhotosList || [];
  return allPhotosList.filter(p => !user.sentPhotos.includes(p));
}

export function getAllUserState() {
  return stateCache;
}
