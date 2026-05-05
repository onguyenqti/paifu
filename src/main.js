import { parseTile, parseHand, tileToString } from './tiles.js';
import {
  Phase, createGame, startRound, applyAction, currentRound, phasePrompt,
} from './state.js';
import {
  saveToStorage, loadFromStorage, listSaves, deleteFromStorage,
  exportToFile, importFromFile,
} from './storage.js';
import {
  renderNavPanel, renderRoundHeader, renderPlayers, renderControls, renderLog,
  showSaveModal, showCallModal, showSaveNameModal, showRoundSetupModal, showSingleNameModal,
  showWinScoringModal,
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
  renderRoundHeader(vRound);
  renderPlayers(game, vRound, { onTileClick, editTarget, onEditName });
  renderControls(game);
  renderLog(game, vRound);
}

// ── Tile editing ───────────────────────────────────────────────────────────────

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

// ── Input submission ───────────────────────────────────────────────────────────

function submitInput(rawValue) {
  if (editTarget) {
    const newTile = parseTile(rawValue.trim());
    if (newTile === null) { showHint('Unrecognised tile.'); return; }
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
      if (!value) {
        // Empty → tsumogiri: discard the most recently drawn tile
        const lastDraw = [...round.actions].reverse().find(
          a => a.type === 'draw' && a.player === round._currentPlayer
        );
        tile = lastDraw?.tile ?? null;
        if (tile === null) { showHint('No drawn tile to discard.'); return; }
      } else {
        tile = parseTile(value);
        if (tile === null) { showHint('Unrecognised tile.'); return; }
      }
      if (!round.hands[round._currentPlayer].tiles.includes(tile)) {
        showHint(`${tileToString(tile)} is not in hand.`);
        return;
      }
      const type = game.phase === Phase.CALL_DISCARD ? 'call_discard' : 'discard';
      applyAction(game, { type, player: round._currentPlayer, tile });
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
      ({ scoreDeltas }) => {
        applyAction(game, { type: 'tsumo', player: winner, tile, scoreDeltas });
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
  showSaveNameModal((name) => {
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

function handleExport() {
  exportToFile(game);
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
  document.getElementById('btn-save').addEventListener('click',   handleSave);
  document.getElementById('btn-load').addEventListener('click',   handleLoad);
  document.getElementById('btn-export').addEventListener('click', handleExport);
  document.getElementById('btn-import').addEventListener('click', handleImport);

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
