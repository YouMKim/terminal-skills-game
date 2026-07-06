// Progress persistence via localStorage.
const KEY = 'terminal-quest-save-v1';

function defaultSave() {
  return { version: 1, completed: {}, lastLevel: null };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw);
    return { ...defaultSave(), ...data };
  } catch {
    return defaultSave();
  }
}

export function persist(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch { /* storage full or unavailable — game still playable */ }
}

export function markComplete(save, levelId, keystrokes) {
  const prev = save.completed[levelId];
  save.completed[levelId] = {
    best: prev ? Math.min(prev.best, keystrokes) : keystrokes,
    at: Date.now(),
  };
  persist(save);
}

export function setLastLevel(save, levelId) {
  save.lastLevel = levelId;
  persist(save);
}

export function resetSave() {
  localStorage.removeItem(KEY);
}
