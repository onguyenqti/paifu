import { parseTile, parseHand, tileToString } from './tiles.js';
import {
  Phase, createGame, startRound, applyAction, currentRound, phasePrompt,
} from './state.js';
import {
  saveToStorage, loadFromStorage, listSaves, deleteFromStorage,
  importFromFile,
} from './storage.js';
import { gameToTenhouJSON } from './tenhou.js';
import {
  renderNavPanel, renderRoundHeader, renderPlayers, renderControls, renderLog,
  showSaveModal, showCallModal, showSaveNameModal, showRoundSetupModal, showSingleNameModal,
  showWinScoringModal, showTitleModal, showDiscardEditCallModal,
} from './ui.js';

// Expose parsers for modal use
window._tiles = { parseTile, parseHand };

// ── App state ──────────────────────────────────────────────────────────────────

let game = createGame();

let editTarget       = null; // { player, context, index, actionIdx?, tile }
let viewingRoundIndex = null; // null = follow the active round

function viewingRound() {
  if (viewingRoundIndex !== null && game.rounds[viewingRoundIndex]) {
    return game.rounds[viewingRoundIndex];
  }
  return currentRound(game);
}

function onSelectRound(i) {
  viewingRoundIndex = i;
  render();
}

function onAddHand() {
  const prev = currentRound(game);
  showRoundSetupModal(game, (opts) => {
    startRound(game, { ...opts, riichiSticks: prev?.riichiSticks ?? 0 });
    viewingRoundIndex = game.rounds.length - 1;
    render();
  });
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function render() {
  const vRound    = viewingRound();
  const vIndex    = viewingRoundIndex ?? (game.rounds.length - 1);
  renderNavPanel(game, vIndex, onSelectRound, onAddHand);
  renderRoundHeader(vRound, { onDoraClick, editTarget, title: game.meta.title, onTitleClick: handleSetTitle });
  renderPlayers(game, vRound, { onTileClick, editTarget, onEditName });
  renderControls(game);
  renderLog(game, vRound);
}

// ── Tile editing ───────────────────────────────────────────────────────────────

function onDoraClick(target) {
  editTarget = target;
  const input = document.getElementById('tile-input');
  input.style.display = '';
  if (target.add) {
    input.value = '';
    input.placeholder = 'New dora indicator…';
    showHint(`Adding ${target.context === 'uraDora' ? 'ura ' : ''}dora — type tile and confirm, or Esc to cancel`);
  } else {
    input.value = tileToString(target.tile);
    input.select();
    showHint(`Editing ${target.context === 'uraDora' ? 'ura ' : ''}dora ${tileToString(target.tile)} — type replacement and confirm, or Esc to cancel`);
  }
  input.focus();
}

function onTileClick(target) {
  editTarget = target;
  const input = document.getElementById('tile-input');
  input.style.display = '';
  if (target.add) {
    input.value = '';
    input.placeholder = 'New tile…';
    showHint(`Adding to ${target.context} for ${game.meta.players[target.player]} — type tile and confirm, or Esc to cancel`);
  } else {
    input.value = tileToString(target.tile);
    input.select();
    showHint(`Editing ${tileToString(target.tile)} — type replacement and confirm, or Esc to cancel`);
  }
  input.focus();
}

function applyEdit(newTile) {
  const round = currentRound(game);
  const { player, context, index, actionIdx, tile: oldTile, add } = editTarget;

  if (context === 'dora') {
    if (add) round.doraIndicators.push(newTile);
    else round.doraIndicators[index] = newTile;
    return;
  }
  if (context === 'uraDora') {
    if (add) round.uraDoraIndicators.push(newTile);
    else round.uraDoraIndicators[index] = newTile;
    return;
  }

  const hand = round.hands[player];

  if (add) {
    if (context === 'starting') {
      hand.startingTiles.push(newTile);
      hand.tiles.push(newTile);
    } else if (context === 'draw') {
      hand.tiles.push(newTile);
      round.actions.push({ type: 'draw', player, tile: newTile });
    } else if (context === 'discard') {
      hand.discards.push(newTile);
      round.actions.push({ type: 'discard', player, tile: newTile });
    }
    return;
  }

  if (context === 'starting') {
    const i = hand.startingTiles.indexOf(oldTile);
    if (i !== -1) hand.startingTiles[i] = newTile;
    const j = hand.tiles.indexOf(oldTile);
    if (j !== -1) hand.tiles[j] = newTile;
  } else if (context === 'hand') {
    const sorted = [...hand.tiles].sort((a, b) => a - b);
    const targetCode = sorted[index];
    const i = hand.tiles.lastIndexOf(targetCode);
    if (i !== -1) hand.tiles[i] = newTile;
  } else if (context === 'draw') {
    const action = round.actions[actionIdx];
    if (action) {
      action.tile = newTile;
      const i = hand.tiles.lastIndexOf(oldTile);
      if (i !== -1) hand.tiles[i] = newTile;
    }
  } else if (context === 'discard') {
    hand.discards[index] = newTile;
    const discardActions = round.actions.filter(
      a => (a.type === 'discard' || a.type === 'call_discard' || a.type === 'riichi') && a.player === player
    );
    if (discardActions[index]) discardActions[index].tile = newTile;
  }
}

// Insert or replace a call action at the calling player's K-th draw slot.
// K = capturedTarget.index (the discard index = the turn slot in the game).
function applyDiscardCall(round, capturedTarget, callInfo) {
  const { player: discarder, index } = capturedTarget;
  const CALL_TYPES = new Set(['chi', 'pon', 'kan', 'kakan', 'ankan']);

  // Global actions index of player p's k-th draw slot (wall draw or call by p).
  function callerSlotGlobalIdx(p, k) {
    let count = 0;
    for (let i = 0; i < round.actions.length; i++) {
      const a = round.actions[i];
      if ((a.type === 'draw' && a.player === p) ||
          (CALL_TYPES.has(a.type) && a.callingPlayer === p)) {
        if (count === k) return i;
        count++;
      }
    }
    return -1;
  }

  // Remove any existing call from discarder whose draw-slot index equals `index`.
  for (let i = 0; i < round.actions.length; i++) {
    const a = round.actions[i];
    if (!CALL_TYPES.has(a.type) || a.calledFrom !== discarder) continue;
    let slotsBefore = 0;
    for (let j = 0; j < i; j++) {
      const b = round.actions[j];
      if ((b.type === 'draw' && b.player === a.callingPlayer) ||
          (CALL_TYPES.has(b.type) && b.callingPlayer === a.callingPlayer)) slotsBefore++;
    }
    if (slotsBefore === index) {
      const oldHand = round.hands[a.callingPlayer];
      for (const t of (a.fromHand ?? [])) oldHand.tiles.push(t);
      for (let mi = oldHand.melds.length - 1; mi >= 0; mi--) {
        if (oldHand.melds[mi].type === a.type && oldHand.melds[mi].calledFrom === discarder) {
          oldHand.melds.splice(mi, 1); break;
        }
      }
      round.actions.splice(i, 1);
      break;
    }
  }

  if (!callInfo) return;

  const { callType, callingPlayer, tiles, fromHand, calledTile } = callInfo;
  const callAction = { type: callType, callingPlayer, calledFrom: discarder, calledTile, tiles, fromHand };

  let insertPos = callerSlotGlobalIdx(callingPlayer, index);
  if (insertPos === -1) insertPos = round.actions.length;
  round.actions.splice(insertPos, 0, callAction);

  const callerHand = round.hands[callingPlayer];
  for (const t of fromHand) {
    const idx = callerHand.tiles.lastIndexOf(t);
    if (idx !== -1) callerHand.tiles.splice(idx, 1);
  }
  callerHand.melds.push({ type: callType, tiles, calledFrom: discarder, calledTile });
}

// ── Input submission ───────────────────────────────────────────────────────────

function submitInput(rawValue) {
  if (editTarget) {
    const newTile = parseTile(rawValue.trim());
    if (newTile === null) { showHint('Unrecognised tile.'); return; }

    if (editTarget.context === 'discard') {
      const capturedTarget = { ...editTarget };
      applyEdit(newTile);
      editTarget = null;
      const round = currentRound(game);
      if (capturedTarget.add) {
        capturedTarget.index = round.hands[capturedTarget.player].discards.length - 1;
      }
      showDiscardEditCallModal(
        { tile: newTile, discarder: capturedTarget.player, playerNames: game.meta.players },
        (callInfo) => {
          applyDiscardCall(round, capturedTarget, callInfo);
          clearInput();
          render();
        },
      );
      return;
    }

    applyEdit(newTile);
    editTarget = null;
    clearInput();
    render();
    return;
  }

  const round = currentRound(game);
  const value = rawValue.trim();

  switch (game.phase) {
    case Phase.DEAL: {
      const tiles = parseHand(value);
      if (tiles.length === 0) { showHint('No tiles recognised — try "123m456p789s1234z"'); return; }
      const pIdx  = round._dealStep;
      const expected = 13; // All players start with 13 tiles; dealer draws first
      if (tiles.length !== expected) {
        showHint(`Expected ${expected} tiles for ${game.meta.players[pIdx]}, got ${tiles.length}.`);
        return;
      }
      round.hands[pIdx].tiles         = tiles;
      round.hands[pIdx].startingTiles = [...tiles];
      round._dealStep++;
      if (round._dealStep >= 4) {
        // All hands dealt — dealer draws first in DRAW phase
        round._currentPlayer = round.dealer;
        game.phase = Phase.DRAW;
      }
      break;
    }

    case Phase.DRAW: {
      const tile = parseTile(value);
      if (tile === null) { showHint('Unrecognised tile. Try "3m", "7p", "E", "1z" …'); return; }
      applyAction(game, { type: 'draw', player: round._currentPlayer, tile });
      break;
    }

    case Phase.DISCARD:
    case Phase.CALL_DISCARD: {
      let tile;
      let tsumogiri = false;
      if (!value) {
        const lastDraw = [...round.actions].reverse().find(
          a => a.type === 'draw' && a.player === round._currentPlayer
        );
        tile = lastDraw?.tile ?? null;
        if (tile === null) { showHint('No drawn tile to discard.'); return; }
        tsumogiri = true;
      } else {
        tile = parseTile(value);
        if (tile === null) { showHint('Unrecognised tile.'); return; }
      }
      if (!round.hands[round._currentPlayer].tiles.includes(tile)) {
        showHint(`${tileToString(tile)} is not in hand.`);
        return;
      }
      const type = game.phase === Phase.CALL_DISCARD ? 'call_discard' : 'discard';
      applyAction(game, { type, player: round._currentPlayer, tile, tsumogiri });
      break;
    }

    default:
      break;
  }

  clearInput();
  render();
}

// ── Button handlers ────────────────────────────────────────────────────────────

function handleTsumo() {
  const input = document.getElementById('tile-input').value.trim();
  const round = currentRound(game);
  if (!round) return;

  if (game.phase === Phase.DRAW) {
    const tile = parseTile(input);
    if (tile === null) { showHint('Enter the winning tile first.'); return; }
    const winner = round._currentPlayer;
    showWinScoringModal(
      { isTsumo: true, tile, winner, loser: null, round, playerNames: game.meta.players },
      ({ winners, scoreDeltas }) => {
        applyAction(game, { type: 'tsumo', player: winner, tile, scoreDeltas, winners });
        clearInput();
        render();
      },
      () => {},
    );
  }
}

function handleRon() {
  if (game.phase !== Phase.CALL_WINDOW) return;
  const round = currentRound(game);
  const loser = round._callWindowPlayer;
  const tile  = round.hands[loser].discards.at(-1);
  showWinScoringModal(
    { isTsumo: false, tile, winner: null, loser, round, playerNames: game.meta.players },
    ({ winners, scoreDeltas }) => {
      applyAction(game, {
        type: 'ron',
        winner: winners[0].player,
        winners,
        loser,
        tile,
        scoreDeltas,
      });
      render();
    },
    () => {},
  );
}

function handleCall(callType) {
  if (game.phase !== Phase.CALL_WINDOW) return;
  showCallModal(game, callType, ({ callingPlayer, fromHandTiles, calledTile, kanType }) => {
    const round    = currentRound(game);
    const calledFrom = round._callWindowPlayer;
    const allTiles  = callType === 'pon'
      ? [calledTile, calledTile, calledTile]
      : callType === 'kan'
      ? [calledTile, calledTile, calledTile, calledTile]
      : [...fromHandTiles, calledTile].sort((a,b) => a - b);

    applyAction(game, {
      type: callType,
      callingPlayer,
      calledFrom,
      calledTile,
      fromHand: fromHandTiles,
      tiles: allTiles,
      kanType: kanType ?? null,
    });
    render();
  }, () => {});
}

function handlePass() {
  if (game.phase !== Phase.CALL_WINDOW) return;
  applyAction(game, { type: 'pass', player: currentRound(game)._callWindowPlayer });
  render();
}

function handleRiichi() {
  if (game.phase !== Phase.DISCARD) return;
  const input = document.getElementById('tile-input').value.trim();
  const tile  = parseTile(input);
  if (tile === null) { showHint('Enter the riichi discard tile first.'); return; }
  applyAction(game, { type: 'riichi', player: currentRound(game)._currentPlayer, tile });
  clearInput();
  render();
}

function handleExhausted() {
  if (game.phase === Phase.COMPLETE) {
    // "Next Round" behaviour
    showRoundSetupModal(game, (opts) => {
      startRound(game, { ...opts, riichiSticks: currentRound(game)?.riichiSticks ?? 0 });
      render();
    });
    return;
  }
  if (game.phase === Phase.DRAW || game.phase === Phase.DISCARD || game.phase === Phase.CALL_WINDOW) {
    applyAction(game, { type: 'draw_exhausted' });
    render();
  }
}

// ── Save / Load / Export ───────────────────────────────────────────────────────

function handleSave() {
  const title = game.meta.title ?? ['', ''];
  const defaultName = title.filter(t => t).join(' ').trim() || 'Game';
  showSaveNameModal(defaultName, (name) => {
    saveToStorage(name, game);
    showHint(`Saved as "${name}".`);
  });
}

function handleLoad() {
  const saves = listSaves();
  showSaveModal(saves,
    (name) => { game = loadFromStorage(name); viewingRoundIndex = game.rounds.length > 0 ? game.rounds.length - 1 : null; render(); },
    (name) => { deleteFromStorage(name); },
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
  const lines = game.rounds.map(round => {
    const json = gameToTenhouJSON({ ...game, rounds: [round] });
    return 'https://tenhou.net/5/#json=' + json;
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `paifu_${Date.now()}.txt`;
  a.click();
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
    game = await importFromFile();
    viewingRoundIndex = game.rounds.length > 0 ? game.rounds.length - 1 : null;
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

function handleNewGame() {
  if (!confirm('Start a new game? Unsaved progress will be lost.')) return;
  game = createGame();
  viewingRoundIndex = null;
  // Skip setup step — open name + round modal immediately
  const defaultNames = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
  game.meta.players = defaultNames;
  showRoundSetupModal(game, (opts) => {
    startRound(game, opts);
    viewingRoundIndex = game.rounds.length - 1;
    render();
  });
}

// ── Utility ────────────────────────────────────────────────────────────────────

function clearInput() {
  const el = document.getElementById('tile-input');
  el.value = '';
  el.focus();
}

function showHint(msg) {
  const el = document.getElementById('hint-text');
  el.textContent = msg;
  el.classList.add('hint-error');
  setTimeout(() => { el.classList.remove('hint-error'); }, 3000);
}

// ── Wiring ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Toolbar
  document.getElementById('btn-new').addEventListener('click', handleNewGame);
  document.getElementById('btn-title').addEventListener('click', handleSetTitle);
  document.getElementById('btn-save').addEventListener('click',   handleSave);
  document.getElementById('btn-load').addEventListener('click',   handleLoad);
  document.getElementById('btn-export').addEventListener('click', handleExport);
  document.getElementById('btn-import').addEventListener('click', handleImport);
  document.getElementById('btn-tenhou').addEventListener('click', handleTenhouView);

  // Confirm input
  document.getElementById('btn-confirm').addEventListener('click', () => {
    submitInput(document.getElementById('tile-input').value);
  });
  document.getElementById('tile-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.stopPropagation(); submitInput(e.target.value); }
    if (e.key === 'Escape' && editTarget) {
      editTarget = null;
      clearInput();
      render();
    }
  });

  // Typing anywhere focuses the tile input (when it's visible and no modal/input is active)
  document.addEventListener('keydown', (e) => {
    if (e.key.length !== 1) return;          // ignore specials (Enter, Backspace, F-keys…)
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const modal = document.getElementById('modal-overlay');
    if (!modal.classList.contains('hidden')) return;
    const input = document.getElementById('tile-input');
    if (input.style.display === 'none') return;
    if (document.activeElement === input) return;
    input.focus();
  });

  // Enter passes during the call window regardless of focus
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (game.phase !== Phase.CALL_WINDOW) return;
    if (!document.getElementById('modal-overlay').classList.contains('hidden')) return;
    handlePass();
  });

  // Action buttons
  document.getElementById('btn-tsumo').addEventListener('click',    handleTsumo);
  document.getElementById('btn-ron').addEventListener('click',      handleRon);
  document.getElementById('btn-chi').addEventListener('click',      () => handleCall('chi'));
  document.getElementById('btn-pon').addEventListener('click',      () => handleCall('pon'));
  document.getElementById('btn-kan').addEventListener('click',      () => handleCall('kan'));
  document.getElementById('btn-riichi').addEventListener('click',   handleRiichi);
  document.getElementById('btn-pass').addEventListener('click',     handlePass);
  document.getElementById('btn-exhausted').addEventListener('click', handleExhausted);

  // Close modal on backdrop click
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  render();
});
