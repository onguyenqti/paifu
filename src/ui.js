import { tileToString, tileToUnicode, tileSuit, sortTiles, parseTile, parseHand } from './tiles.js';
import { Phase, WIND_NAMES, phasePrompt, currentRound } from './state.js';
import { YAKU, totalHan, fuOverride, computeScoreDeltas, paymentSummary } from './scoring.js';

const CALL_TYPES  = new Set(['chi','pon','kan','kakan','ankan']);
const CALL_LABELS = { chi: 'Chi', pon: 'Pon', kan: 'Kan', kakan: 'Kan+', ankan: 'Ankan' };

// Index of the visually-rotated (called) tile within a meld display.
// Convention: shimocha (right) → leftmost; toimen → middle; kamicha (left) → rightmost.
function meldRotatedIndex(meld, callingPlayer) {
  if (meld.type === 'ankan' || meld.calledFrom == null) return -1;
  const rel = (meld.calledFrom - callingPlayer + 4) % 4;
  if (rel === 1) return meld.tiles.length - 1;                  // shimocha → rightmost
  if (rel === 2) return Math.floor((meld.tiles.length - 1) / 2); // toimen → middle
  return 0;                                                      // kamicha → leftmost
}

// ── Tile rendering ─────────────────────────────────────────────────────────────

export function tileEl(code, opts = {}) {
  const el  = document.createElement('div');
  const suit = tileSuit(code);
  const isAka = code === 51 || code === 52 || code === 53;

  el.className = `tile suit-${suit}${isAka ? ' aka' : ''}${opts.small ? ' tile-sm' : ''}`;
  if (opts.editing)  el.classList.add('editing');
  if (opts.onClick)  el.classList.add('clickable');
  el.title = tileToString(code);

  const glyph = document.createElement('span');
  glyph.className = 'tile-glyph';
  glyph.textContent = tileToUnicode(code);

  const label = document.createElement('span');
  label.className = 'tile-label';
  label.textContent = opts.labelText ?? tileToString(code);

  el.appendChild(glyph);
  if (!opts.noLabel) el.appendChild(label);

  if (opts.onClick) el.addEventListener('click', opts.onClick);
  return el;
}

// A tile displayed sideways (90° rotation) with the label sitting below in normal orientation.
function rotatedTileEl(code) {
  const suit  = tileSuit(code);
  const isAka = code === 51 || code === 52 || code === 53;

  const wrap = document.createElement('div');
  wrap.className = `tile-rotated-wrap suit-${suit}${isAka ? ' aka' : ''}`;

  const inner = document.createElement('div');
  inner.className = 'tile-rotated-inner';
  inner.appendChild(tileEl(code, { small: true, noLabel: true }));
  wrap.appendChild(inner);

  const lbl = document.createElement('span');
  lbl.className = 'tile-label';
  lbl.textContent = tileToString(code);
  wrap.appendChild(lbl);

  return wrap;
}

// tiles: array of tile codes
// opts.small, opts.onTileClick(tile, index), opts.editingIndex
function tileListEl(tiles, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'tile-list';
  tiles.forEach((t, i) => {
    const tOpts = { small: opts.small };
    if (opts.onTileClick) tOpts.onClick = () => opts.onTileClick(t, i);
    if (opts.editingIndex === i) tOpts.editing = true;
    wrap.appendChild(tileEl(t, tOpts));
  });
  return wrap;
}

// ── Nav panel ──────────────────────────────────────────────────────────────────

export function renderNavPanel(game, viewingIndex, onSelect, onAddHand) {
  const nav = document.getElementById('hand-nav');
  nav.innerHTML = '';

  game.rounds.forEach((round, i) => {
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (i === viewingIndex ? ' active' : '');

    const label = document.createElement('span');
    const wind  = WIND_NAMES[round.roundWind] ?? 'East';
    label.textContent = `${wind} ${round.roundNum + 1} - ${round.honba}`;
    btn.appendChild(label);

    if (round.result) {
      const badge = document.createElement('span');
      const t = round.result.type;
      badge.className = `nav-result ${t}`;
      badge.textContent = t === 'tsumo' ? 'T' : t === 'ron' ? 'R' : '—';
      btn.appendChild(badge);
    }

    btn.addEventListener('click', () => onSelect(i));
    nav.appendChild(btn);
  });

  if (game.rounds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'nav-empty';
    empty.textContent = 'No hands yet';
    nav.appendChild(empty);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'nav-add-btn';
  addBtn.textContent = '+ New Hand';
  addBtn.addEventListener('click', onAddHand);
  nav.appendChild(addBtn);
}

// ── Round header ───────────────────────────────────────────────────────────────

export function renderRoundHeader(round, { onDoraClick, editTarget, title, onTitleClick } = {}) {
  const titleEl = document.getElementById('round-title');
  const el      = document.getElementById('round-display');
  const riichi  = document.getElementById('riichi-display');
  const dora    = document.getElementById('dora-display');

  // Title
  if (titleEl) {
    const titleText = (title ?? []).filter(t => t).join(' — ');
    titleEl.textContent = titleText;
    titleEl.style.display = titleText ? '' : 'none';
    titleEl.onclick = onTitleClick ?? null;
  }

  if (!round) {
    el.textContent     = '—';
    riichi.textContent = '';
    dora.innerHTML     = '';
    return;
  }

  el.textContent = `${WIND_NAMES[round.roundWind] ?? 'East'} ${round.roundNum + 1} - ${round.honba}`;
  riichi.textContent = `Riichi sticks: ${round.riichiSticks}`;

  dora.innerHTML = '';

  const addDoraGroup = (label, indicators, context) => {
    const lbl = document.createElement('span');
    lbl.textContent = label;
    dora.appendChild(lbl);

    indicators.forEach((t, i) => {
      const opts = { small: true };
      if (onDoraClick) opts.onClick = () => onDoraClick({ context, index: i, tile: t });
      if (editTarget?.context === context && editTarget?.index === i) opts.editing = true;
      dora.appendChild(tileEl(t, opts));
    });

    if (onDoraClick) {
      const add = document.createElement('div');
      add.className = 'tile tile-sm tile-add';
      add.title     = `Add ${label.replace(':', '').trim().toLowerCase()}`;
      add.textContent = '+';
      add.addEventListener('click', () => onDoraClick({ context, add: true }));
      dora.appendChild(add);
    }
  };

  addDoraGroup('Dora:', round.doraIndicators, 'dora');
  addDoraGroup('Ura:', round.uraDoraIndicators, 'uraDora');
}

// ── Player hands ───────────────────────────────────────────────────────────────

// Build a player's draw slot list with { type:'skip' } entries inserted where
// other players' calls skipped this player's turn.
function buildDrawSlotsWithSkips(round, p) {
  // Natural slots: draws and calls by p, in global action order, with actionIdx preserved.
  const natural = round.actions
    .map((a, actionIdx) => ({ ...a, actionIdx }))
    .filter(a =>
      (a.type === 'draw' && a.player === p) ||
      (CALL_TYPES.has(a.type) && a.callingPlayer === p)
    );

  // For each call action, check if p is skipped and splice a skip entry at the right slot.
  for (let i = 0; i < round.actions.length; i++) {
    const a = round.actions[i];
    if (!CALL_TYPES.has(a.type)) continue;
    const { calledFrom, callingPlayer } = a;
    if (calledFrom == null || callingPlayer == null) continue;
    if (calledFrom === p || callingPlayer === p) continue;

    // p is skipped when it's strictly between calledFrom and callingPlayer in turn order.
    const dist  = (callingPlayer - calledFrom + 4) % 4;
    const distP = (p - calledFrom + 4) % 4;
    if (distP <= 0 || distP >= dist) continue;

    // K = caller's draw-slot index just before this call action in the global array.
    let k = 0;
    for (let j = 0; j < i; j++) {
      const b = round.actions[j];
      if ((b.type === 'draw' && b.player === callingPlayer) ||
          (CALL_TYPES.has(b.type) && b.callingPlayer === callingPlayer)) k++;
    }

    // Find insertion point: before the k-th natural (non-skip) slot.
    let naturalCount = 0;
    let insertAt = natural.length;
    for (let si = 0; si < natural.length; si++) {
      if (natural[si].type === 'skip') continue;
      if (naturalCount === k) { insertAt = si; break; }
      naturalCount++;
    }
    natural.splice(insertAt, 0, { type: 'skip' });
  }

  return natural;
}

// onTileClick(target) where target = { player, context:'hand'|'draw'|'discard', index, actionIdx?, tile }
// editTarget: same shape — used to highlight the tile being edited
// onEditName(playerIndex) — called when the edit button next to a player name is clicked
// round: the round to display (may differ from the active recording round)
export function renderPlayers(game, round, { onTileClick, editTarget, onEditName } = {}) {
  const container = document.getElementById('players-container');
  container.innerHTML = '';

  for (let p = 0; p < 4; p++) {
    const pane = document.createElement('div');
    pane.className = 'player-pane';
    const isActive = round && round._currentPlayer === p && game.phase !== Phase.COMPLETE;
    if (isActive) pane.classList.add('active');

    // Header
    const header = document.createElement('div');
    header.className = 'player-header';
    const seatWind = round ? WIND_NAMES[(p - round.dealer + 4) % 4] : WIND_NAMES[p];
    const isDealer = round && round.dealer === p;

    const nameWrap = document.createElement('span');
    nameWrap.className = 'player-name-wrap';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'player-name';
    nameSpan.textContent = game.meta.players[p];
    nameWrap.appendChild(nameSpan);

    if (onEditName) {
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-name-btn';
      editBtn.title = 'Edit name';
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', () => onEditName(p));
      nameWrap.appendChild(editBtn);
    }

    const windSpan = document.createElement('span');
    windSpan.className = 'player-wind';
    windSpan.textContent = seatWind + (isDealer ? ' (Dealer)' : '');

    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'player-score';
    if (!round) {
      scoreSpan.textContent = '—';
    } else {
      const base  = round.scores[p] ?? 0;
      const delta = round.result?.scoreDeltas?.[p];
      scoreSpan.textContent = base.toLocaleString();
      if (delta != null && delta !== 0) {
        const deltaSpan = document.createElement('span');
        deltaSpan.className = `score-delta ${delta > 0 ? 'pos' : 'neg'}`;
        deltaSpan.textContent = ` ${delta > 0 ? '+' : ''}${delta.toLocaleString()}`;
        scoreSpan.appendChild(deltaSpan);
      }
    }

    header.appendChild(nameWrap);
    header.appendChild(windSpan);
    header.appendChild(scoreSpan);
    pane.appendChild(header);

    if (!round) { container.appendChild(pane); continue; }

    const hand = round.hands[p];

    const makeRow = (labelText, className) => {
      const row = document.createElement('div');
      row.className = `hand-row ${className}`;
      const lbl = document.createElement('span');
      lbl.className = 'hand-label';
      lbl.textContent = labelText;
      row.appendChild(lbl);
      return row;
    };

    const addTile = (onClick) => {
      const el = document.createElement('div');
      el.className = 'tile tile-sm tile-add';
      el.title = 'Add tile';
      el.textContent = '+';
      if (onClick) el.addEventListener('click', onClick);
      return el;
    };

    // 1. Starting Hand — exactly 13 read-only slots
    const startRow = makeRow('Starting Hand:', 'starting-row');
    const startList = document.createElement('div');
    startList.className = 'tile-list';
    const sorted13 = sortTiles(hand.startingTiles);
    for (let s = 0; s < 13; s++) {
      if (s < sorted13.length) {
        const tOpts = { small: true };
        if (onTileClick) tOpts.onClick = () => onTileClick({ player: p, context: 'starting', index: s, tile: sorted13[s] });
        if (editTarget?.player === p && editTarget?.context === 'starting' && editTarget?.index === s) tOpts.editing = true;
        startList.appendChild(tileEl(sorted13[s], tOpts));
      } else {
        const ph = document.createElement('div');
        ph.className = 'tile tile-sm tile-placeholder';
        startList.appendChild(ph);
      }
    }
    startRow.appendChild(startList);
    pane.appendChild(startRow);

    // 2+3. Turns — draw slot (wall draw, call, or skip) above the matching discard.
    // virtualSlots includes { type:'skip' } entries for turns skipped due to calls.
    const virtualSlots = buildDrawSlotsWithSkips(round, p);
    const discardActions = round.actions
      .map((a, actionIdx) => ({ ...a, actionIdx }))
      .filter(a => (a.type === 'discard' || a.type === 'call_discard' || a.type === 'riichi') && a.player === p);

    // Map virtual slot index → draw-only index (for edit-target context).
    let drawOnlyCount = 0;
    const drawOnlyIdxMap = virtualSlots.map(a => a.type === 'draw' ? drawOnlyCount++ : -1);

    const turnsRow = makeRow('Turns:', 'turns-row');
    const turnsGrid = document.createElement('div');
    turnsGrid.className = 'turns-grid';

    const colCount = virtualSlots.length;
    let discardCursor = 0; // index into hand.discards; advances for non-skip columns only
    for (let i = 0; i < colCount; i++) {
      const col = document.createElement('div');
      col.className = 'turn-col';

      const a          = virtualSlots[i];
      const isSkip     = a?.type === 'skip';
      const drawOnlyIdx = drawOnlyIdxMap[i];

      // ── Draw slot ──
      if (a?.type === 'draw') {
        const tOpts = { small: true };
        if (onTileClick) tOpts.onClick = () => onTileClick({
          player: p, context: 'draw', index: drawOnlyIdx, actionIdx: a.actionIdx, tile: a.tile,
        });
        if (editTarget?.player === p && editTarget?.context === 'draw' && editTarget?.index === drawOnlyIdx)
          tOpts.editing = true;
        col.appendChild(tileEl(a.tile, tOpts));
      } else if (a && CALL_TYPES.has(a.type)) {
        const calledTile = a.calledTile ?? a.tiles?.[0];
        const wrap = document.createElement('div');
        wrap.className = 'call-draw-wrap';
        const lbl = document.createElement('span');
        lbl.className = 'call-type-label';
        lbl.textContent = CALL_LABELS[a.type] ?? a.type;
        wrap.appendChild(lbl);
        if (calledTile != null) wrap.appendChild(tileEl(calledTile, { small: true }));
        col.appendChild(wrap);
      } else if (isSkip) {
        const ph = document.createElement('div');
        ph.className = 'tile tile-sm tile-skip';
        ph.title = 'Turn skipped (call)';
        ph.textContent = '—';
        col.appendChild(ph);
      } else {
        const ph = document.createElement('div');
        ph.className = 'tile tile-sm tile-placeholder';
        col.appendChild(ph);
      }

      // ── Discard slot ──
      if (isSkip) {
        // Skipped turns have no discard.
        const ph = document.createElement('div');
        ph.className = 'tile tile-sm tile-placeholder';
        col.appendChild(ph);
      } else if (discardCursor < hand.discards.length) {
        const di       = discardCursor++; // capture before increment
        const t        = hand.discards[di];
        const isTsumo  = discardActions[di]?.tsumogiri ?? false;
        const isEditing = editTarget?.player === p && editTarget?.context === 'discard' && editTarget?.index === di;
        if (isTsumo) {
          const el = document.createElement('div');
          el.className = 'tile tile-sm tsumogiri' + (isEditing ? ' editing' : '') + (onTileClick ? ' clickable' : '');
          el.title = tileToString(t);
          el.textContent = '↓';
          if (onTileClick) el.addEventListener('click', () => onTileClick({ player: p, context: 'discard', index: di, tile: t }));
          col.appendChild(el);
        } else {
          const tOpts = { small: true };
          if (onTileClick) tOpts.onClick = () => onTileClick({ player: p, context: 'discard', index: di, tile: t });
          if (isEditing) tOpts.editing = true;
          col.appendChild(tileEl(t, tOpts));
        }
      } else {
        const ph = document.createElement('div');
        ph.className = 'tile tile-sm tile-placeholder';
        col.appendChild(ph);
      }

      turnsGrid.appendChild(col);
    }

    if (onTileClick) {
      const addCol = document.createElement('div');
      addCol.className = 'turn-col';
      addCol.appendChild(addTile(() => onTileClick({ player: p, context: 'draw', add: true })));
      addCol.appendChild(addTile(() => onTileClick({ player: p, context: 'discard', add: true })));
      turnsGrid.appendChild(addCol);
    }

    turnsRow.appendChild(turnsGrid);
    pane.appendChild(turnsRow);

    // 4. Current Hand — sorted uncalled tiles, then open melds inline to the right
    const handRow = makeRow('Current Hand:', 'hand-row');
    handRow.appendChild(tileListEl(sortTiles(hand.tiles)));
    if (hand.inRiichi) {
      const badge = document.createElement('span');
      badge.className = 'riichi-badge';
      badge.textContent = 'Riichi';
      handRow.appendChild(badge);
    }
    if (hand.melds.length) {
      const sep = document.createElement('div');
      sep.className = 'meld-sep';
      handRow.appendChild(sep);
      for (const meld of hand.melds) {
        const meldEl = document.createElement('div');
        meldEl.className = 'meld';
        const rotIdx = meldRotatedIndex(meld, p);
        meld.tiles.forEach((t, ti) => {
          meldEl.appendChild(ti === rotIdx ? rotatedTileEl(t) : tileEl(t, { small: true }));
        });
        handRow.appendChild(meldEl);
      }
    }
    pane.appendChild(handRow);

    container.appendChild(pane);
  }
}

// ── Input / action panel ───────────────────────────────────────────────────────

const ALL_BUTTONS = ['btn-tsumo','btn-ron','btn-chi','btn-pon','btn-kan','btn-riichi','btn-pass','btn-exhausted'];

export function renderControls(game) {
  const prompt = phasePrompt(game);

  document.getElementById('phase-label').textContent        = prompt.label;
  document.getElementById('active-player-label').textContent = '';
  document.getElementById('hint-text').textContent          = prompt.hint;

  const input   = document.getElementById('tile-input');
  const confirm = document.getElementById('btn-confirm');

  // Reset all buttons
  for (const id of ALL_BUTTONS) {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = 'none';
  }

  const show = (...ids) => ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });

  switch (game.phase) {
    case Phase.SETUP:
      input.style.display = 'none';
      confirm.style.display = 'none';
      break;

    case Phase.DEAL:
      input.placeholder = 'e.g. 123m456p789s1234z';
      input.style.display = '';
      confirm.style.display = '';
      break;

    case Phase.DRAW:
      input.placeholder = 'Drawn tile, e.g. 3m';
      input.style.display = '';
      confirm.style.display = '';
      show('btn-tsumo', 'btn-exhausted');
      break;

    case Phase.DISCARD:
      input.placeholder = 'Tile to discard, e.g. 9m';
      input.style.display = '';
      confirm.style.display = '';
      show('btn-riichi');
      break;

    case Phase.CALL_WINDOW:
      input.style.display = 'none';
      confirm.style.display = 'none';
      show('btn-chi', 'btn-pon', 'btn-kan', 'btn-ron', 'btn-pass');
      break;

    case Phase.CALL_DISCARD:
      input.placeholder = 'Tile to discard';
      input.style.display = '';
      confirm.style.display = '';
      break;

    case Phase.COMPLETE:
      input.style.display = 'none';
      confirm.style.display = 'none';
      show('btn-exhausted'); // repurpose as "New Round" trigger via label
      document.getElementById('btn-exhausted').textContent = 'Next Round';
      break;
  }

  // Restore exhausted label outside COMPLETE
  if (game.phase !== Phase.COMPLETE) {
    const ex = document.getElementById('btn-exhausted');
    if (ex) ex.textContent = 'Draw Exhausted';
  }
}

// ── Action log ─────────────────────────────────────────────────────────────────

export function renderLog(game, round) {
  const log = document.getElementById('action-log');
  if (!round) { log.innerHTML = ''; return; }

  const lines = round.actions.map((a, i) => {
    const pName = game.meta.players[a.player ?? a.callingPlayer ?? a.winner ?? 0] ?? '?';
    switch (a.type) {
      case 'draw':        return `<span class="log-draw">${pName} draws ${tileToString(a.tile)}</span>`;
      case 'discard':     return `<span class="log-discard">${pName} discards ${tileToString(a.tile)}</span>`;
      case 'call_discard':return `<span class="log-discard">${pName} discards ${tileToString(a.tile)}</span>`;
      case 'riichi':      return `<span class="log-riichi">${pName} declares Riichi, discards ${tileToString(a.tile)}</span>`;
      case 'pass':        return `<span class="log-pass">— pass —</span>`;
      case 'chi':         return `<span class="log-call">${game.meta.players[a.callingPlayer]} Chi ${a.tiles.map(tileToString).join(' ')}</span>`;
      case 'pon':         return `<span class="log-call">${game.meta.players[a.callingPlayer]} Pon ${a.tiles.map(tileToString).join(' ')}</span>`;
      case 'kan':         return `<span class="log-call">${game.meta.players[a.callingPlayer]} Kan (${a.kanType})</span>`;
      case 'tsumo':       return `<span class="log-win">Tsumo! ${pName} wins on ${tileToString(a.tile)}</span>`;
      case 'ron':         return `<span class="log-win">Ron! ${game.meta.players[a.winner]} wins from ${game.meta.players[a.loser]} on ${tileToString(a.tile)}</span>`;
      case 'draw_exhausted': return `<span class="log-draw">Exhaustive draw (Ryuukyoku)</span>`;
      case 'add_dora':    return `<span class="log-dora">New dora: ${tileToString(a.tile)}</span>`;
      default:            return `<span>${a.type}</span>`;
    }
  });

  log.innerHTML = lines.map(l => `<div class="log-line">${l}</div>`).join('');
  log.scrollTop = log.scrollHeight;
}

// ── Save list modal ────────────────────────────────────────────────────────────

export function showSaveModal(saves, onLoad, onDelete) {
  const names = Object.keys(saves);
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');

  content.innerHTML = `
    <h2>Saved Games</h2>
    ${names.length === 0 ? '<p>No saves yet.</p>' : ''}
    <ul class="save-list">
      ${names.map(n => `
        <li>
          <span>${n}</span>
          <span class="save-date">${saves[n].savedAt?.slice(0,16).replace('T',' ') ?? ''}</span>
          <button data-action="load" data-name="${n}">Load</button>
          <button data-action="delete" data-name="${n}" class="danger">Delete</button>
        </li>`).join('')}
    </ul>
    <button id="modal-close">Close</button>
  `;

  overlay.classList.remove('hidden');

  content.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, name } = btn.dataset;
    if (action === 'load')   { overlay.classList.add('hidden'); onLoad(name); }
    if (action === 'delete') { onDelete(name); btn.closest('li').remove(); }
  });

  document.getElementById('modal-close').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });
}

export function showCallModal(game, callType, onConfirm, onCancel) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  const round   = currentRound(game);
  const players = game.meta.players;

  const otherPlayers = [0,1,2,3].filter(p => p !== round._callWindowPlayer);

  let html = `<h2>${callType.toUpperCase()}</h2>`;

  if (callType === 'ron') {
    html += `
      <p>Which player wins by Ron?</p>
      <div class="modal-buttons">
        ${otherPlayers.map(p => `<button data-player="${p}">${players[p]}</button>`).join('')}
      </div>
    `;
    content.innerHTML = html + `<button id="modal-cancel">Cancel</button>`;
    overlay.classList.remove('hidden');
    content.querySelectorAll('button[data-player]').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.classList.add('hidden');
        onConfirm({ winner: +btn.dataset.player, loser: round._callWindowPlayer });
      });
    });
  } else {
    let playerSelect = '';
    if (callType === 'chi') {
      const chiPlayer = (round._callWindowPlayer + 1) % 4;
      playerSelect = `<input type="hidden" id="calling-player" value="${chiPlayer}">
        <p>Caller: ${players[chiPlayer]}</p>`;
    } else {
      playerSelect = `
        <p>Which player calls?</p>
        <div class="modal-buttons">
          ${otherPlayers.map(p => `<button class="sel-player${p === otherPlayers[0]?' selected':''}" data-player="${p}">${players[p]}</button>`).join('')}
        </div>
        <input type="hidden" id="calling-player" value="${otherPlayers[0]}">
      `;
    }

    const discardedTile = round.hands[round._callWindowPlayer].discards.at(-1);
    const tileStr = tileToString(discardedTile);

    html += playerSelect + `
      <p>Enter hand tiles used in the call (not including the called tile <strong>${tileStr}</strong>):</p>
      <input id="call-tiles-input" type="text" placeholder="e.g. 2m 4m" style="width:100%">
      <small>Separate with spaces. For Kan, enter 3 matching tiles from hand.</small>
    `;

    if (callType === 'kan') {
      html += `
        <p>Kan type:</p>
        <select id="kan-type">
          <option value="open">Open Kan (called from discard)</option>
          <option value="closed">Closed Kan (self-draw)</option>
          <option value="added">Added Kan (extend pon)</option>
        </select>
      `;
    }

    content.innerHTML = html + `
      <div class="modal-buttons">
        <button id="modal-confirm">Confirm</button>
        <button id="modal-cancel">Cancel</button>
      </div>
    `;
    overlay.classList.remove('hidden');

    // Player selection
    content.querySelectorAll('.sel-player').forEach(btn => {
      btn.addEventListener('click', () => {
        content.querySelectorAll('.sel-player').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('calling-player').value = btn.dataset.player;
      });
    });

    document.getElementById('modal-confirm').addEventListener('click', () => {
      const { parseHand } = window._tiles;
      const callingPlayer = +document.getElementById('calling-player').value;
      const fromHandTiles = parseHand(document.getElementById('call-tiles-input').value);
      const calledTile    = discardedTile;
      const kanType       = callType === 'kan' ? document.getElementById('kan-type')?.value : null;

      overlay.classList.add('hidden');
      onConfirm({ callingPlayer, fromHandTiles, calledTile, kanType });
    });
  }

  document.getElementById('modal-cancel').addEventListener('click', () => {
    overlay.classList.add('hidden');
    onCancel();
  });
}

export function showDiscardEditCallModal({ tile, discarder, playerNames }, onConfirm) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  const tileName = tileToString(tile);
  const chiCaller = (discarder + 1) % 4;
  const others    = [0, 1, 2, 3].filter(p => p !== discarder);

  function show(html) {
    content.innerHTML = html;
    content.style.maxWidth = '420px';
    overlay.classList.remove('hidden');
  }

  function step1() {
    show(`
      <h2>Was ${tileName} called?</h2>
      <p>Discarded by ${playerNames[discarder]}</p>
      <div class="modal-buttons">
        <button id="ec-none">No Call</button>
        <button id="ec-chi">Chi</button>
        <button id="ec-pon">Pon</button>
        <button id="ec-kan">Kan</button>
      </div>
    `);
    document.getElementById('ec-none').addEventListener('click', () => {
      overlay.classList.add('hidden');
      onConfirm(null);
    });
    document.getElementById('ec-chi').addEventListener('click', stepChi);
    document.getElementById('ec-pon').addEventListener('click', () => stepPlayer('pon'));
    document.getElementById('ec-kan').addEventListener('click', () => stepPlayer('kan'));
  }

  function stepChi() {
    show(`
      <h2>Chi by ${playerNames[chiCaller]}</h2>
      <p>Other 2 tiles in the chi (not including <strong>${tileName}</strong>):</p>
      <input id="chi-tiles" type="text" class="tile-input" placeholder="e.g. 2m 4m" autocomplete="off">
      <div id="chi-err" class="hint" style="min-height:1.2em"></div>
      <div class="modal-buttons">
        <button id="chi-back">Back</button>
        <button id="chi-ok">Confirm Chi</button>
      </div>
    `);
    const input = document.getElementById('chi-tiles');
    input.focus();
    document.getElementById('chi-back').addEventListener('click', step1);

    function confirmChi() {
      const handTiles = parseHand(input.value);
      if (handTiles.length !== 2) {
        document.getElementById('chi-err').textContent = 'Enter exactly 2 tiles.';
        return;
      }
      const allTiles = [...handTiles, tile].sort((a, b) => a - b);
      overlay.classList.add('hidden');
      onConfirm({ callType: 'chi', callingPlayer: chiCaller, tiles: allTiles, fromHand: handTiles, calledTile: tile });
    }
    document.getElementById('chi-ok').addEventListener('click', confirmChi);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmChi(); });
  }

  function stepPlayer(callType) {
    const label = callType === 'pon' ? 'Pon' : 'Kan';
    show(`
      <h2>${label} called by:</h2>
      <div class="modal-buttons">
        ${others.map(p => `<button data-p="${p}">${playerNames[p]}</button>`).join('')}
      </div>
      <div class="modal-buttons"><button id="player-back">Back</button></div>
    `);
    document.getElementById('player-back').addEventListener('click', step1);
    content.querySelectorAll('[data-p]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p        = +btn.dataset.p;
        const fromHand = Array(callType === 'pon' ? 2 : 3).fill(tile);
        const allTiles = Array(callType === 'pon' ? 3 : 4).fill(tile);
        overlay.classList.add('hidden');
        onConfirm({ callType, callingPlayer: p, tiles: allTiles, fromHand, calledTile: tile });
      });
    });
  }

  step1();
}

export function showSaveNameModal(defaultName, onConfirm) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <h2>Save Game</h2>
    <input id="save-name-input" type="text" value="${defaultName ?? ''}" placeholder="Save name" style="width:100%">
    <div class="modal-buttons" style="margin-top:12px">
      <button id="modal-confirm">Save</button>
      <button id="modal-cancel">Cancel</button>
    </div>
  `;
  overlay.classList.remove('hidden');
  const input = document.getElementById('save-name-input');
  input.focus();
  input.select();
  const doConfirm = () => {
    const name = input.value.trim();
    if (name) { overlay.classList.add('hidden'); onConfirm(name); }
  };
  document.getElementById('modal-confirm').addEventListener('click', doConfirm);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doConfirm(); });
  document.getElementById('modal-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
}

export function showRoundSetupModal(game, onConfirm) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  const prevRound = currentRound(game);
  const defaultScores = prevRound
    ? (prevRound.result?.finalScores ?? prevRound.scores).map(s => s.toLocaleString()).join(', ')
    : '25000, 25000, 25000, 25000';

  content.innerHTML = `
    <h2>Start New Round</h2>
    <label>Scores (comma-separated): <input id="scores-input" type="text" value="${defaultScores}" style="width:240px"></label><br><br>
    <label>Dealer (0-3): <input id="dealer-input" type="number" min="0" max="3" value="${prevRound ? ((prevRound.dealer+1)%4) : 0}" style="width:60px"></label><br><br>
    <label>Honba: <input id="honba-input" type="number" min="0" value="${prevRound ? prevRound.honba : 0}" style="width:60px"></label><br><br>
    <div class="modal-buttons">
      <button id="modal-confirm">Start Round</button>
      <button id="modal-cancel">Cancel</button>
    </div>
  `;
  overlay.classList.remove('hidden');

  document.getElementById('modal-confirm').addEventListener('click', () => {
    const scores   = document.getElementById('scores-input').value
      .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    const dealer   = parseInt(document.getElementById('dealer-input').value, 10);
    const honba    = parseInt(document.getElementById('honba-input').value, 10);
    overlay.classList.add('hidden');
    onConfirm({
      scores: scores.length === 4 ? scores : null,
      dealer: isNaN(dealer) ? 0 : dealer % 4,
      honba:  isNaN(honba)  ? 0 : honba,
    });
  });

  document.getElementById('modal-cancel').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });
}

export function showSingleNameModal(playerIndex, currentName, onConfirm) {
  const winds   = ['East', 'South', 'West', 'North'];
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');

  content.innerHTML = `
    <h2>Edit name — ${winds[playerIndex]}</h2>
    <input id="single-name-input" type="text" value="${currentName}"
           style="width:100%" autocomplete="off">
    <div class="modal-buttons" style="margin-top:12px">
      <button id="modal-confirm">Save</button>
      <button id="modal-cancel">Cancel</button>
    </div>
  `;

  overlay.classList.remove('hidden');
  const input = document.getElementById('single-name-input');
  input.focus();
  input.select();

  const confirm = () => {
    const name = input.value.trim() || `Player ${playerIndex + 1}`;
    overlay.classList.add('hidden');
    onConfirm(name);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  confirm();
    if (e.key === 'Escape') overlay.classList.add('hidden');
  });
  document.getElementById('modal-confirm').addEventListener('click', confirm);
  document.getElementById('modal-cancel').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });
}

// ── Win scoring modal ──────────────────────────────────────────────────────────
// opts: { isTsumo, tile, winner (tsumo only), loser (ron), round, playerNames }
// onConfirm({ winners:[{player,han,fu,yaku,scoreDeltas}], scoreDeltas })
export function showWinScoringModal(opts, onConfirm, onCancel) {
  const { isTsumo, tile, winner: tsumoWinner, loser, round, playerNames } = opts;
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  const honba     = round.honba     ?? 0;
  const riichiPot = round.riichiSticks ?? 0;
  const dealer    = round.dealer    ?? 0;
  const scores    = round.scores;

  // For ron: all players except the discarder are potential winners
  const candidates = isTsumo
    ? [tsumoWinner]
    : [0, 1, 2, 3].filter(p => p !== loser);

  // Per-winner state
  const winnerState = {};
  for (const p of candidates) {
    const hasMelds = (round.hands[p]?.melds?.length ?? 0) > 0;
    winnerState[p] = {
      selected:     isTsumo,
      isOpen:       hasMelds,
      selectedYaku: new Set(),
      dora:         0,
      akaDora:      0,
      uraDora:      0,
      fu:           30,
    };
  }

  const FU_OPTIONS = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110];
  const YAKU_BY_HAN = [1, 2, 3, 6, 13].map(h => ({
    label: h >= 13 ? 'Yakuman' : `${h} han`,
    yaku: YAKU.filter(y => y.han === h),
  }));

  // ── Build modal DOM ──

  content.innerHTML = '';
  content.style.maxWidth = '620px';

  const title = document.createElement('h2');
  title.textContent = isTsumo ? 'Tsumo Win' : 'Ron Win';
  content.appendChild(title);

  if (!isTsumo) {
    const sub = document.createElement('p');
    sub.style.cssText = 'color:var(--text-1);margin-bottom:12px;font-size:13px';
    sub.textContent = `${playerNames[loser]} discarded ${tileToString(tile)}. Select winners:`;
    content.appendChild(sub);
  }

  // Summary div — updated live
  const summaryEl = document.createElement('div');
  summaryEl.className = 'score-summary';
  content.appendChild(summaryEl);

  // Per-winner sections
  const sectionsWrap = document.createElement('div');
  content.appendChild(sectionsWrap);

  function effectiveHan(p) {
    const ws = winnerState[p];
    const yHan = totalHan([...ws.selectedYaku], ws.isOpen);
    return yHan + ws.dora + ws.akaDora + ws.uraDora;
  }

  function effectiveFu(p) {
    const ws = winnerState[p];
    const fo = fuOverride([...ws.selectedYaku]);
    return fo !== null ? fo : ws.fu;
  }

  function recomputeSummary() {
    const selectedWinners = candidates.filter(p => winnerState[p].selected);
    const deltas = [0, 0, 0, 0];

    for (const p of selectedWinners) {
      const han = effectiveHan(p);
      const fu  = effectiveFu(p);
      if (han === 0) continue;
      const d = computeScoreDeltas(han, fu, {
        winner: p, loser, dealer, isTsumo,
        honba, riichiPot: selectedWinners[0] === p ? riichiPot : 0, // pot goes to first winner
      });
      for (let i = 0; i < 4; i++) deltas[i] += d[i];
    }

    summaryEl.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'score-table';
    for (let i = 0; i < 4; i++) {
      const tr = document.createElement('tr');
      const d  = deltas[i];
      tr.innerHTML = `
        <td>${playerNames[i]}${i === dealer ? ' ★' : ''}</td>
        <td>${scores[i].toLocaleString()}</td>
        <td class="${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${d.toLocaleString()}</td>
        <td>${(scores[i] + d).toLocaleString()}</td>
      `;
      table.appendChild(tr);
    }
    summaryEl.appendChild(table);

    // Stash for confirm
    summaryEl._deltas = deltas;
  }

  function buildWinnerSection(p) {
    const ws  = winnerState[p];
    const sec = document.createElement('div');
    sec.className = 'winner-section';
    sec.dataset.player = p;

    // Header row (checkbox for ron, plain label for tsumo)
    const hdr = document.createElement('div');
    hdr.className = 'winner-hdr';

    if (!isTsumo) {
      const cb = document.createElement('input');
      cb.type    = 'checkbox';
      cb.id      = `winner-cb-${p}`;
      cb.checked = ws.selected;
      cb.addEventListener('change', () => {
        ws.selected = cb.checked;
        body.style.display = cb.checked ? '' : 'none';
        recomputeSummary();
      });
      hdr.appendChild(cb);
    }

    const lbl = document.createElement('label');
    lbl.htmlFor   = `winner-cb-${p}`;
    lbl.className = 'winner-name';
    lbl.textContent = playerNames[p];
    hdr.appendChild(lbl);

    if (isTsumo) {
      const sub = document.createElement('span');
      sub.style.cssText = 'color:var(--text-1);font-size:12px;margin-left:8px';
      sub.textContent = `(drew ${tileToString(tile)})`;
      hdr.appendChild(sub);
    }

    sec.appendChild(hdr);

    // Body (collapsible for ron)
    const body = document.createElement('div');
    body.className = 'winner-body';
    if (!isTsumo) body.style.display = ws.selected ? '' : 'none';

    // Open/closed toggle
    const openRow = document.createElement('div');
    openRow.className = 'open-row';
    openRow.innerHTML = `
      <label><input type="radio" name="open-${p}" value="closed" ${!ws.isOpen ? 'checked' : ''}> Closed</label>
      <label><input type="radio" name="open-${p}" value="open"   ${ws.isOpen  ? 'checked' : ''}> Open</label>
    `;
    openRow.querySelectorAll('input[type=radio]').forEach(r => {
      r.addEventListener('change', () => {
        ws.isOpen = r.value === 'open';
        rebuildYaku(p, body);
        rebuildHanFu(p, body);
        recomputeSummary();
      });
    });
    body.appendChild(openRow);

    // Yaku grid placeholder (built by rebuildYaku)
    const yakuWrap = document.createElement('div');
    yakuWrap.className = 'yaku-wrap';
    yakuWrap.dataset.player = p;
    body.appendChild(yakuWrap);

    // Han / Fu row
    const hanFuRow = document.createElement('div');
    hanFuRow.className = 'han-fu-row';
    hanFuRow.dataset.player = p;
    body.appendChild(hanFuRow);

    sec.appendChild(body);
    sectionsWrap.appendChild(sec);

    rebuildYaku(p, body);
    rebuildHanFu(p, body);
  }

  function rebuildYaku(p, body) {
    const ws       = winnerState[p];
    const yakuWrap = body.querySelector('.yaku-wrap');
    yakuWrap.innerHTML = '';

    for (const group of YAKU_BY_HAN) {
      const visible = group.yaku.filter(y => {
        if (ws.isOpen && y.hanOpen === null) return false;
        if (isTsumo && y.tsumoOnly === false) return false;
        if (!isTsumo && y.tsumoOnly) return false;
        if (y.id === 'menzentsumo' && !isTsumo) return false;
        return true;
      });
      if (!visible.length) continue;

      const cat = document.createElement('div');
      cat.className = 'yaku-category';
      cat.textContent = group.label;
      yakuWrap.appendChild(cat);

      const grid = document.createElement('div');
      grid.className = 'yaku-grid';
      for (const y of visible) {
        const btn = document.createElement('button');
        btn.className = 'yaku-btn' + (ws.selectedYaku.has(y.id) ? ' selected' : '');
        const dispHan = ws.isOpen ? (y.hanOpen ?? y.han) : y.han;
        btn.textContent = `${y.name} (${dispHan})`;
        btn.addEventListener('click', () => {
          if (ws.selectedYaku.has(y.id)) ws.selectedYaku.delete(y.id);
          else ws.selectedYaku.add(y.id);
          btn.classList.toggle('selected');
          rebuildHanFu(p, body);
          recomputeSummary();
        });
        grid.appendChild(btn);
      }
      yakuWrap.appendChild(grid);
    }
  }

  function rebuildHanFu(p, body) {
    const ws       = winnerState[p];
    const hanFuRow = body.querySelector('.han-fu-row');
    hanFuRow.innerHTML = '';

    const yHan  = totalHan([...ws.selectedYaku], ws.isOpen);
    const fo    = fuOverride([...ws.selectedYaku]);
    const total = yHan + ws.dora + ws.akaDora + ws.uraDora;

    // Han base from yaku
    const baseSpan = document.createElement('span');
    baseSpan.innerHTML = `Han: <strong>${yHan}</strong>`;
    hanFuRow.appendChild(baseSpan);

    // Dora / Aka / Ura inputs
    for (const [key, label] of [['dora','Dora'],['akaDora','Aka'],['uraDora','Ura']]) {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px';
      const inp = document.createElement('input');
      inp.type  = 'number';
      inp.min   = '0';
      inp.max   = '10';
      inp.value = ws[key];
      inp.style.cssText = 'width:40px;padding:3px 4px';
      inp.addEventListener('input', () => {
        ws[key] = Math.max(0, parseInt(inp.value) || 0);
        rebuildHanFu(p, body);
        recomputeSummary();
      });
      wrap.textContent = `+${label} `;
      wrap.appendChild(inp);
      hanFuRow.appendChild(wrap);
    }

    // Total
    const totalSpan = document.createElement('span');
    totalSpan.innerHTML = `= <strong>${total}</strong> total`;
    hanFuRow.appendChild(totalSpan);

    // Fu display
    const fuWrap = document.createElement('label');
    fuWrap.style.marginLeft = '16px';
    if (fo !== null) {
      fuWrap.innerHTML = `Fu: <strong>${fo}</strong> (fixed)`;
    } else {
      fuWrap.innerHTML = 'Fu: ';
      const fuSel = document.createElement('select');
      for (const v of FU_OPTIONS) {
        const opt = document.createElement('option');
        opt.value   = v;
        opt.textContent = v;
        if (v === ws.fu) opt.selected = true;
        fuSel.appendChild(opt);
      }
      fuSel.addEventListener('change', () => {
        ws.fu = parseInt(fuSel.value);
        recomputeSummary();
      });
      fuWrap.appendChild(fuSel);
    }
    hanFuRow.appendChild(fuWrap);

    // Payment preview
    if (total > 0) {
      const fu2  = fo !== null ? fo : ws.fu;
      const pmnt = paymentSummary(total, fu2, {
        winner: p, loser, dealer, isTsumo, honba,
        riichiPot: candidates[0] === p ? riichiPot : 0,
      });
      const prev = document.createElement('span');
      prev.className = 'payment-preview';
      prev.textContent = ` → ${pmnt.limit ? pmnt.limit + ' ' : ''}${pmnt.label} pts`;
      hanFuRow.appendChild(prev);
    }
  }

  for (const p of candidates) buildWinnerSection(p);
  recomputeSummary();

  // Confirm / Cancel
  const btnRow = document.createElement('div');
  btnRow.className = 'modal-buttons';
  btnRow.style.marginTop = '16px';

  const confirmBtn = document.createElement('button');
  confirmBtn.id          = 'modal-confirm';
  confirmBtn.textContent = 'Confirm Win';
  confirmBtn.addEventListener('click', () => {
    const selectedWinners = candidates.filter(p => winnerState[p].selected);
    if (!selectedWinners.length) return;

    const winners = selectedWinners.map(p => {
      const ws = winnerState[p];
      return {
        player: p,
        han:  effectiveHan(p),
        fu:   effectiveFu(p),
        yaku: [...ws.selectedYaku].map(id => {
          const y = YAKU.find(y => y.id === id);
          if (!y) return null;
          return { name: y.jp ?? y.name, han: ws.isOpen ? (y.hanOpen ?? y.han) : y.han };
        }).filter(Boolean),
      };
    });

    overlay.classList.add('hidden');
    onConfirm({ winners, scoreDeltas: summaryEl._deltas ?? [0,0,0,0] });
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.id          = 'modal-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    overlay.classList.add('hidden');
    onCancel?.();
  });

  btnRow.appendChild(confirmBtn);
  btnRow.appendChild(cancelBtn);
  content.appendChild(btnRow);

  overlay.classList.remove('hidden');
}

export function showTitleModal(currentTitle, onConfirm) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');

  content.innerHTML = `
    <h2>Set Title</h2>
    <label style="display:block;margin-bottom:10px">
      Title line 1<br>
      <input id="title-0" type="text" value="${currentTitle[0]}" style="width:100%" autocomplete="off">
    </label>
    <label style="display:block;margin-bottom:16px">
      Title line 2<br>
      <input id="title-1" type="text" value="${currentTitle[1]}" style="width:100%" autocomplete="off">
    </label>
    <div class="modal-buttons">
      <button id="modal-confirm">Save</button>
      <button id="modal-cancel">Cancel</button>
    </div>
  `;

  overlay.classList.remove('hidden');
  document.getElementById('title-0').focus();

  const confirm = () => {
    const t0 = document.getElementById('title-0').value;
    const t1 = document.getElementById('title-1').value;
    overlay.classList.add('hidden');
    onConfirm([t0, t1]);
  };

  document.getElementById('modal-confirm').addEventListener('click', confirm);
  document.getElementById('modal-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
}
