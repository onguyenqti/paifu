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

// ── File Upload ────────────────────────────────────────────────────────────────

function parseImportText(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return tenhouJSONToGame(trimmed);
  }
  // URL-per-line format: each line is https://tenhou.net/5/#json=<encoded>
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
  const games = lines.map(line => {
    const match = line.match(/[#&]json=(.+)/);
    if (!match) throw new Error(`Unrecognised line: ${line}`);
    return tenhouJSONToGame(match[1]);
  });
  if (!games.length) throw new Error('No rounds found');
  const base = games[0];
  base.rounds = games.flatMap(g => g.rounds);
  return base;
}

export function importFromFile() {
  return new Promise((resolve, reject) => {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = '.json,.txt,application/json,text/plain';
    input.onchange = async () => {
      try {
        const text = await input.files[0].text();
        resolve(parseImportText(text));
      } catch (e) {
        reject(e);
      }
    };
    input.oncancel = () => reject(new Error('Cancelled'));
    input.click();
  });
}
