import { tileToString, tileToUnicode, tileSuit, sortTiles } from './tiles.js';
import { Phase, WIND_NAMES, phasePrompt, currentRound } from './state.js';
import { YAKU, totalHan, fuOverride, computeScoreDeltas, paymentSummary } from './scoring.js';

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
  label.textContent = tileToString(code);

  el.appendChild(glyph);
  el.appendChild(label);

  if (opts.onClick) el.addEventListener('click', opts.onClick);
  return el;
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

export function renderRoundHeader(round) {
  const el    = document.getElementById('round-display');
  const honba = document.getElementById('honba-display');
  const riichi = document.getElementById('riichi-display');
  const dora  = document.getElementById('dora-display');

  if (!round) {
    el.textContent     = '—';
    honba.textContent  = '';
    riichi.textContent = '';
    dora.innerHTML     = '';
    return;
  }

  el.textContent = `${WIND_NAMES[round.roundWind] ?? 'East'} ${round.roundNum + 1}`;
  honba.textContent  = `Honba: ${round.honba}`;
  riichi.textContent = `Riichi sticks: ${round.riichiSticks}`;

  dora.innerHTML = '';
  if (round.doraIndicators.length) {
    const label = document.createElement('span');
    label.textContent = 'Dora: ';
    dora.appendChild(label);
    for (const t of round.doraIndicators) dora.appendChild(tileEl(t, { small: true }));
  }
}

// ── Player hands ───────────────────────────────────────────────────────────────

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
    scoreSpan.textContent = round ? (round.scores[p] ?? 0).toLocaleString() : '—';

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

    // 2. Draws
    const drawActions = round.actions
      .map((a, actionIdx) => ({ ...a, actionIdx }))
      .filter(a => a.type === 'draw' && a.player === p);
    const drawRow = makeRow('Draws:', 'draw-row');
    drawRow.appendChild(tileListEl(drawActions.map(a => a.tile), {
      small: true,
      onTileClick: onTileClick && ((t, i) => onTileClick({
        player: p, context: 'draw', index: i,
        actionIdx: drawActions[i].actionIdx, tile: t,
      })),
      editingIndex: editTarget?.player === p && editTarget?.context === 'draw'
        ? editTarget.index : -1,
    }));
    if (onTileClick) drawRow.appendChild(addTile(() => onTileClick({ player: p, context: 'draw', add: true })));
    pane.appendChild(drawRow);

    // 3. Discards
    const discardRow = makeRow('Discards:', 'discard-row');
    discardRow.appendChild(tileListEl(hand.discards, {
      small: true,
      onTileClick: onTileClick && ((t, i) => onTileClick({
        player: p, context: 'discard', index: i, tile: t,
      })),
      editingIndex: editTarget?.player === p && editTarget?.context === 'discard'
        ? editTarget.index : -1,
    }));
    if (onTileClick) discardRow.appendChild(addTile(() => onTileClick({ player: p, context: 'discard', add: true })));
    pane.appendChild(discardRow);

    // 4. Current Hand — read-only derived view
    const handRow = makeRow('Current Hand:', 'hand-row');
    handRow.appendChild(tileListEl(sortTiles(hand.tiles)));
    if (hand.inRiichi) {
      const badge = document.createElement('span');
      badge.className = 'riichi-badge';
      badge.textContent = 'Riichi';
      handRow.appendChild(badge);
    }
    pane.appendChild(handRow);

    if (hand.melds.length) {
      const meldRow = makeRow('Melds:', 'meld-row');
      for (const meld of hand.melds) {
        const meldEl = document.createElement('div');
        meldEl.className = 'meld';
        for (const t of meld.tiles) meldEl.appendChild(tileEl(t, { small: true }));
        meldRow.appendChild(meldEl);
      }
      pane.appendChild(meldRow);
    }

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

export function showSaveNameModal(onConfirm) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <h2>Save Game</h2>
    <input id="save-name-input" type="text" placeholder="Save name" style="width:100%">
    <div class="modal-buttons" style="margin-top:12px">
      <button id="modal-confirm">Save</button>
      <button id="modal-cancel">Cancel</button>
    </div>
  `;
  overlay.classList.remove('hidden');
  document.getElementById('save-name-input').focus();
  document.getElementById('modal-confirm').addEventListener('click', () => {
    const name = document.getElementById('save-name-input').value.trim();
    if (name) { overlay.classList.add('hidden'); onConfirm(name); }
  });
  document.getElementById('modal-cancel').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });
}

export function showRoundSetupModal(game, onConfirm) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  const prevRound = currentRound(game);
  const defaultScores = prevRound
    ? prevRound.scores.map(s => s.toLocaleString()).join(', ')
    : '25000, 25000, 25000, 25000';

  content.innerHTML = `
    <h2>Start New Round</h2>
    <label>Dora indicator tile: <input id="dora-input" type="text" placeholder="e.g. 5z" style="width:120px"></label><br><br>
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
    const { parseTile } = window._tiles;
    const doraStr  = document.getElementById('dora-input').value.trim();
    const scores   = document.getElementById('scores-input').value
      .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    const dealer   = parseInt(document.getElementById('dealer-input').value, 10);
    const honba    = parseInt(document.getElementById('honba-input').value, 10);
    overlay.classList.add('hidden');
    onConfirm({
      doraIndicator: doraStr ? parseTile(doraStr) : null,
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

    const winners = selectedWinners.map(p => ({
      player: p,
      han:  effectiveHan(p),
      fu:   effectiveFu(p),
      yaku: [...winnerState[p].selectedYaku],
    }));

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
