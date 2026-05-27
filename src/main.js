import { parseTile, parseHand, tileToString } from './tiles.js';
import { Phase, CALL_TYPES, createGame, createRound, computeRoundState, phasePrompt } from './state.js';
import { saveToStorage, loadFromStorage, listSaves, deleteFromStorage, importFromFile } from './storage.js';
import { gameToTenhouJSON } from './tenhou.js';
import {
  renderNavPanel, renderRoundHeader, renderVisualization, renderActionLog,
  renderControls, showSaveModal, showCallModal, showSaveNameModal,
  showRoundSetupModal, showSingleNameModal, showWinScoringModal, showTitleModal,
  showSelfKanModal, showTilePromptModal, showDrawExhaustedModal,
} from './ui.js';

// ── App state ──────────────────────────────────────────────────────────────────

let game             = createGame();
let viewingRoundIdx  = null;  // null = follow active round
let selectedActionIdx = null; // null = end of log; otherwise index in round.actions
let riichiMode       = false; // true while Riichi toggle is active

function viewingRound() {
  if (viewingRoundIdx !== null && game.rounds[viewingRoundIdx]) return game.rounds[viewingRoundIdx];
  return game.rounds[game.rounds.length - 1] ?? null;
}

// State after selectedActionIdx (or after last action if null).
function workingState() {
  const round = viewingRound();
  if (!round) return null;
  const idx = selectedActionIdx ?? (round.actions.length - 1);
  return computeRoundState(round, idx < 0 ? -1 : idx);
}

// ── Action management ──────────────────────────────────────────────────────────

function addActions(newActions) {
  const round = viewingRound();
  if (!round) return;
  const insertAt = selectedActionIdx != null ? selectedActionIdx + 1 : round.actions.length;
  round.actions.splice(insertAt, 0, ...newActions);
  selectedActionIdx = insertAt + newActions.length - 1;
  render();
}

function addAction(a) { addActions([a]); }

function deleteAction(idx) {
  const round = viewingRound();
  if (!round) return;
  round.actions.splice(idx, 1);
  if (selectedActionIdx !== null) {
    if (selectedActionIdx === idx)           selectedActionIdx = Math.max(-1, idx - 1);
    else if (selectedActionIdx > idx)        selectedActionIdx--;
  }
  if (selectedActionIdx !== null && selectedActionIdx < 0) selectedActionIdx = null;
  render();
}

function deleteAfter(idx) {
  const round = viewingRound();
  if (!round) return;
  round.actions.splice(idx + 1);
  selectedActionIdx = idx >= round.actions.length ? round.actions.length - 1 : idx;
  if (selectedActionIdx < 0) selectedActionIdx = null;
  render();
}

function selectAction(idx) {
  selectedActionIdx = idx;
  render();
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function render() {
  const vRound = viewingRound();
  const vIdx   = viewingRoundIdx ?? (game.rounds.length - 1);
  const state  = workingState();

  renderNavPanel(game, vIdx, onSelectRound, onAddHand);
  renderRoundHeader(vRound, state, {
    title:          game.meta.title,
    onTitleClick:   handleSetTitle,
    onAddDora:      vRound ? () => showTilePromptModal('Add Dora Indicator', (tile) => { (vRound.doraIndicators    ??= []).push(tile); render(); }) : null,
    onAddUraDora:   vRound ? () => showTilePromptModal('Add Ura Dora',      (tile) => { (vRound.uraDoraIndicators ??= []).push(tile); render(); }) : null,
    onDeleteRound:       vRound ? handleDeleteRound : null,
    onEditRiichiSticks:  vRound ? (v) => { if (v !== null) { vRound.initialRiichiSticks = v; render(); } } : null,
  });
  renderVisualization(state, vRound, game.meta.players, selectedActionIdx, selectAction);
  renderActionLog(vRound, game.meta.players, selectedActionIdx, {
    onSelect:      selectAction,
    onDelete:      deleteAction,
    onDeleteAfter: deleteAfter,
  });
  renderControls(state, game.meta.players, riichiMode, {
    onRiichiToggle: () => { riichiMode = !riichiMode; render(); },
  });
}

function onSelectRound(i) {
  viewingRoundIdx   = i;
  selectedActionIdx = null;
  render();
}

function onAddHand() {
  const prev      = viewingRound();
  const prevState = prev ? computeRoundState(prev) : null;
  const prevResult = prevState?.result;
  const carrySticks = (prevResult?.type === 'tsumo' || prevResult?.type === 'ron')
    ? 0
    : (prevState?.riichiSticks ?? 0);
  showRoundSetupModal(game, (opts) => {
    const round = createRound({ ...opts, riichiSticks: carrySticks });
    game.rounds.push(round);
    viewingRoundIdx   = game.rounds.length - 1;
    selectedActionIdx = null;
    render();
  });
}

// ── Input submission ───────────────────────────────────────────────────────────

function submitInput(rawValue) {
  const state = workingState();
  if (!state) return;
  const value = rawValue.trim();

  switch (state.phase) {
    case Phase.DEAL: {
      const tiles = parseHand(value);
      if (tiles.length !== 13) { showHint(`Expected 13 tiles, got ${tiles.length}.`); return; }
      addAction({ type: 'deal', player: state.dealStep, tiles });
      break;
    }

    case Phase.DRAW: {
      const tile = parseTile(value);
      if (tile === null) { showHint('Unrecognised tile.'); return; }
      addAction({ type: 'draw', player: state.currentPlayer, tile });
      break;
    }

    case Phase.DISCARD:
    case Phase.CALL_DISCARD: {
      let tile = value ? parseTile(value) : null;
      if (tile === null && !value) {
        // Tsumogiri: take last draw by current player
        const round  = viewingRound();
        const upTo   = selectedActionIdx ?? (round.actions.length - 1);
        for (let i = upTo; i >= 0; i--) {
          const a = round.actions[i];
          if (a.type === 'draw' && a.player === state.currentPlayer) { tile = a.tile; break; }
        }
      }
      if (tile === null) { showHint('Enter a tile.'); return; }
      if (!state.hands[state.currentPlayer].tiles.includes(tile)) {
        showHint(`${tileToString(tile)} is not in hand.`); return;
      }
      const a = { type: 'discard', player: state.currentPlayer, tile };
      if (riichiMode) { a.riichi = true; riichiMode = false; }
      if (!value && state.phase === Phase.DISCARD) a.tsumogiri = true;
      addAction(a);
      break;
    }

    case Phase.CHANKAN: {
      const tile = parseTile(value);
      if (tile === null) { showHint('Enter the rinshan draw tile.'); return; }
      addActions([
        { type: 'pass' },
        { type: 'draw', player: state.callWindowPlayer, tile },
      ]);
      break;
    }

    case Phase.CALL_WINDOW: {
      const lower = value.toLowerCase();
      if (lower === 'chi') { handleCall('chi'); break; }
      if (lower === 'pon') { handleCall('pon'); break; }
      if (lower === 'kan') { handleCall('kan'); break; }
      if (lower === 'ron') { handleRon();       break; }
      // Typing a tile = pass + next player draws that tile
      const tile = parseTile(value);
      if (tile === null) { showHint('Enter the next drawn tile, or use the call buttons.'); return; }
      const toAdd = [];
      if (state.lastRiichiPlayer != null) toAdd.push({ type: 'riichi_complete', player: state.lastRiichiPlayer });
      toAdd.push({ type: 'draw', player: (state.callWindowPlayer + 1) % 4, tile });
      addActions(toAdd);
      break;
    }

    default: break;
  }

  clearInput();
}

// ── Button handlers ────────────────────────────────────────────────────────────

function handleTsumo() {
  const state = workingState();
  if (!state || state.phase !== Phase.DISCARD) return;
  const round  = viewingRound();
  const winner = state.currentPlayer;
  // Find the winning tile from the last draw action for this player
  const upTo = selectedActionIdx ?? (round.actions.length - 1);
  let tile = null;
  for (let i = upTo; i >= 0; i--) {
    const a = round.actions[i];
    if (a.type === 'draw' && a.player === winner) { tile = a.tile; break; }
  }
  if (tile === null) { showHint('No drawn tile found.'); return; }
  showWinScoringModal(
    { isTsumo: true, tile, winner, loser: null, state, playerNames: game.meta.players, honba: round.honba ?? 0 },
    ({ winners, scoreDeltas }) => {
      addAction({ type: 'tsumo', player: winner, tile, scoreDeltas, winners });
      clearInput();
    },
    () => {},
  );
}

function handleRon() {
  const state = workingState();
  if (!state) return;
  const round = viewingRound();
  let loser, tile;
  if (state.phase === Phase.CHANKAN) {
    loser = state.callWindowPlayer;
    const kakanMeld = [...(state.hands[loser]?.melds ?? [])].reverse().find(m => m.type === 'kakan');
    tile = kakanMeld?.calledTile ?? kakanMeld?.tiles?.[0] ?? null;
  } else if (state.phase === Phase.CALL_WINDOW) {
    loser = state.callWindowPlayer;
    tile  = state.hands[loser].discards.at(-1);
  } else {
    return;
  }
  showWinScoringModal(
    { isTsumo: false, tile, winner: null, loser, state, playerNames: game.meta.players, honba: round?.honba ?? 0 },
    ({ winners, scoreDeltas }) => {
      addAction({ type: 'ron', winner: winners[0].player, winners, loser, tile, scoreDeltas });
    },
    () => {},
  );
}

function handleCall(callType) {
  const state = workingState();
  if (!state || state.phase !== Phase.CALL_WINDOW) return;
  showCallModal(game, callType, state, ({ callingPlayer, fromHandTiles, calledTile, kanType }) => {
    const calledFrom = state.callWindowPlayer;
    const allTiles   = callType === 'pon' || callType === 'kan'
      ? [calledTile, ...fromHandTiles]
      : [...fromHandTiles, calledTile].sort((a, b) => a - b);
    addAction({ type: callType, callingPlayer, calledFrom, calledTile, fromHand: fromHandTiles, tiles: allTiles, kanType: kanType ?? null });
    clearInput();
  }, () => {});
}

function handleSelfKan() {
  const state = workingState();
  if (!state || (state.phase !== Phase.DISCARD && state.phase !== Phase.CALL_DISCARD)) return;
  showSelfKanModal(state, game.meta.players, ({ tile, type, tiles, addedTile }) => {
    const p        = state.currentPlayer;
    const allTiles = tiles ?? [tile, tile, tile, tile];
    const fromHand = type === 'kakan' ? [addedTile ?? tile] : allTiles;
    addAction({ type, callingPlayer: p, calledFrom: null, calledTile: tile, fromHand, tiles: allTiles });
    clearInput();
  }, () => {});
}

function handleKan() {
  const state = workingState();
  if (!state) return;
  if (state.phase === Phase.CALL_WINDOW) handleCall('kan');
  else if (state.phase === Phase.DISCARD || state.phase === Phase.CALL_DISCARD) handleSelfKan();
}

function handlePass() {
  const state = workingState();
  if (!state) return;
  if (state.phase === Phase.CHANKAN) {
    addAction({ type: 'pass' });
    return;
  }
  if (state.phase !== Phase.CALL_WINDOW) return;
  if (state.lastRiichiPlayer != null) {
    addAction({ type: 'riichi_complete', player: state.lastRiichiPlayer });
  } else {
    addAction({ type: 'pass' });
  }
}

function handleExhausted() {
  const state = workingState();
  if (!state) return;
  if (state.phase === Phase.COMPLETE) {
    onAddHand();
    return;
  }
  if (state.phase === Phase.DRAW || state.phase === Phase.DISCARD || state.phase === Phase.CALL_WINDOW) {
    showDrawExhaustedModal(game.meta.players, state.scores, ({ scoreDeltas }) => {
      addAction({ type: 'draw_exhausted', scoreDeltas });
    }, () => {});
  }
}

// ── Save / Load / Export ───────────────────────────────────────────────────────

function handleSave() {
  const title       = game.meta.title ?? ['', ''];
  const defaultName = title.filter(t => t).join(' ').trim() || 'Game';
  showSaveNameModal(defaultName, (name) => {
    saveToStorage(name, game);
    showHint(`Saved as "${name}".`);
  });
}

function handleLoad() {
  const saves = listSaves();
  showSaveModal(saves,
    (name) => {
      game              = loadFromStorage(name);
      viewingRoundIdx   = game.rounds.length > 0 ? game.rounds.length - 1 : null;
      selectedActionIdx = null;
      render();
    },
    (name) => deleteFromStorage(name),
  );
}

function handleSetTitle() {
  showTitleModal(game.meta.title ?? ['', ''], (title) => {
    game.meta.title = title;
    render();
  });
}

function handleExport() {
  if (!game.rounds.length) return;
  const lines = game.rounds.map(round => 'https://tenhou.net/5/#json=' + gameToTenhouJSON({ ...game, rounds: [round] }));
  const blob  = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href     = url; a.download = `paifu_${Date.now()}.txt`; a.click();
  URL.revokeObjectURL(url);
}

function handleTenhouView() {
  const round = viewingRound();
  if (!round) return;
  const json = gameToTenhouJSON({ ...game, rounds: [round] });
  window.open('https://tenhou.net/5/#json=' + encodeURIComponent(json), '_blank');
}

async function handleImport() {
  try {
    game              = await importFromFile();
    viewingRoundIdx   = game.rounds.length > 0 ? game.rounds.length - 1 : null;
    selectedActionIdx = null;
    render();
  } catch (e) {
    if (e.message !== 'Cancelled') showHint(`Import failed: ${e.message}`);
  }
}

function onEditName(playerIndex) {
  showSingleNameModal(playerIndex, game.meta.players[playerIndex], (name) => {
    game.meta.players[playerIndex] = name;
    render();
  });
}

function handleDeleteRound() {
  const idx = viewingRoundIdx ?? (game.rounds.length - 1);
  if (idx == null || !game.rounds[idx]) return;
  if (!confirm('Delete this round? This cannot be undone.')) return;
  game.rounds.splice(idx, 1);
  viewingRoundIdx   = game.rounds.length > 0 ? Math.min(idx, game.rounds.length - 1) : null;
  selectedActionIdx = null;
  render();
}

function handleNewGame() {
  if (!confirm('Start a new game? Unsaved progress will be lost.')) return;
  game              = createGame();
  viewingRoundIdx   = null;
  selectedActionIdx = null;
  game.meta.players = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
  showRoundSetupModal(game, (opts) => {
    const round = createRound(opts);
    game.rounds.push(round);
    viewingRoundIdx = 0;
    render();
  });
}

// ── Utility ────────────────────────────────────────────────────────────────────

function clearInput() {
  const el = document.getElementById('tile-input');
  el.value = '';
  if (document.getElementById('modal-overlay').classList.contains('hidden')) el.focus();
}

function showHint(msg) {
  const el = document.getElementById('hint-text');
  el.textContent = msg;
  el.classList.add('hint-error');
  setTimeout(() => el.classList.remove('hint-error'), 3000);
}

// ── Wiring ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-new').addEventListener('click',    handleNewGame);
  document.getElementById('btn-title').addEventListener('click',  handleSetTitle);
  document.getElementById('btn-save').addEventListener('click',   handleSave);
  document.getElementById('btn-load').addEventListener('click',   handleLoad);
  document.getElementById('btn-export').addEventListener('click', handleExport);
  document.getElementById('btn-import').addEventListener('click', handleImport);
  document.getElementById('btn-tenhou').addEventListener('click', handleTenhouView);

  document.getElementById('btn-confirm').addEventListener('click', () => {
    submitInput(document.getElementById('tile-input').value);
  });
  document.getElementById('tile-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.stopPropagation(); submitInput(e.target.value); }
    if (e.key === 'Escape') {
      selectedActionIdx = null;
      riichiMode = false;
      clearInput();
      render();
    }
  });

  // Typing anywhere focuses the tile input when no modal is open
  document.addEventListener('keydown', (e) => {
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!document.getElementById('modal-overlay').classList.contains('hidden')) return;
    const input = document.getElementById('tile-input');
    if (input.style.display === 'none') return;
    if (document.activeElement === input) return;
    input.focus();
  });

  // Enter passes during call window
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const state = workingState();
    if (!state || state.phase !== Phase.CALL_WINDOW) return;
    if (!document.getElementById('modal-overlay').classList.contains('hidden')) return;
    if (document.activeElement === document.getElementById('tile-input')) return;
    handlePass();
  });

  document.getElementById('btn-tsumo').addEventListener('click',    handleTsumo);
  document.getElementById('btn-ron').addEventListener('click',      handleRon);
  document.getElementById('btn-chi').addEventListener('click',      () => handleCall('chi'));
  document.getElementById('btn-pon').addEventListener('click',      () => handleCall('pon'));
  document.getElementById('btn-kan').addEventListener('click',      handleKan);
  document.getElementById('btn-riichi').addEventListener('click',   () => { riichiMode = !riichiMode; render(); });
  document.getElementById('btn-pass').addEventListener('click',     handlePass);
  document.getElementById('btn-exhausted').addEventListener('click', handleExhausted);

  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  render();
});
