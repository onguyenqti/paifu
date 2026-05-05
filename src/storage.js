import { gameToTenhouJSON, tenhouJSONToGame } from './tenhou.js';

const LS_KEY = 'paifu_saves';

// ── Local Storage ──────────────────────────────────────────────────────────────

export function listSaves() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveToStorage(name, game) {
  const saves = listSaves();
  saves[name] = {
    savedAt: new Date().toISOString(),
    data: JSON.parse(gameToTenhouJSON(game)),
    meta: game.meta,
    phase: game.phase,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(saves));
}

export function loadFromStorage(name) {
  const saves = listSaves();
  if (!saves[name]) throw new Error(`Save "${name}" not found`);
  const entry = saves[name];
  return tenhouJSONToGame(JSON.stringify(entry.data));
}

export function deleteFromStorage(name) {
  const saves = listSaves();
  delete saves[name];
  localStorage.setItem(LS_KEY, JSON.stringify(saves));
}

// ── File Download / Upload ─────────────────────────────────────────────────────

export function exportToFile(game, filename) {
  const json = gameToTenhouJSON(game);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename ?? `paifu_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importFromFile() {
  return new Promise((resolve, reject) => {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = '.json,application/json';
    input.onchange = async () => {
      try {
        const text = await input.files[0].text();
        resolve(tenhouJSONToGame(text));
      } catch (e) {
        reject(e);
      }
    };
    input.oncancel = () => reject(new Error('Cancelled'));
    input.click();
  });
}
