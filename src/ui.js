import { tileToString, tileToUnicode, tileSuit, sortTiles, parseTile, parseHand } from './tiles.js';
import { Phase, WIND_NAMES, CALL_TYPES, CALL_LABELS, buildTurnPairs, computeRoundState, phasePrompt } from './state.js';
import { YAKU, totalHan, fuOverride, computeScoreDeltas, paymentSummary } from './scoring.js';

// ── Tile rendering ─────────────────────────────────────────────────────────────

export function tileEl(code, opts = {}) {
  const el   = document.createElement('div');
  const suit = tileSuit(code);
  const isAka = code === 51 || code === 52 || code === 53;
  el.className = `tile suit-${suit}${isAka ? ' aka' : ''}${opts.small ? ' tile-sm' : ''}`;
  if (opts.editing) el.classList.add('editing');
  if (opts.onClick) el.classList.add('clickable');
  el.title = tileToString(code);

  const glyph = document.createElement('span');
  glyph.className = 'tile-glyph';
  glyph.textContent = tileToUnicode(code);
  el.appendChild(glyph);

  if (!opts.noLabel) {
    const lbl = document.createElement('span');
    lbl.className = 'tile-label';
    lbl.textContent = opts.labelText ?? tileToString(code);
    el.appendChild(lbl);
  }

  if (opts.onClick) el.addEventListener('click', opts.onClick);
  return el;
}

function rotatedTileEl(code) {
  const suit  = tileSuit(code);
  const isAka = code === 51 || code === 52 || code === 53;
  const wrap  = document.createElement('div');
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

function meldRotatedIndex(meld, callingPlayer) {
  if (meld.type === 'ankan' || meld.calledFrom == null) return -1;
  const rel = (meld.calledFrom - callingPlayer + 4) % 4;
  if (rel === 1) return meld.tiles.length - 1;
  if (rel === 2) return Math.floor((meld.tiles.length - 1) / 2);
  return 0;
}

// ── Nav panel ──────────────────────────────────────────────────────────────────

export function renderNavPanel(game, viewingIndex, onSelect, onAddHand) {
  const nav = document.getElementById('hand-nav');
  nav.innerHTML = '';

  game.rounds.forEach((round, i) => {
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (i === viewingIndex ? ' active' : '');
    const wind = WIND_NAMES[round.roundWind] ?? WIND_NAMES[Math.floor(i / 4)] ?? 'East';
    const num  = round.roundNum ?? (i % 4);

    const lbl = document.createElement('span');
    lbl.textContent = `${wind} ${num + 1} - ${round.honba}`;
    btn.appendChild(lbl);

    const finalState = computeRoundStateForNav(round);
    if (finalState?.result) {
      const badge = document.createElement('span');
      const t = finalState.result.type;
      badge.className = `nav-result ${t}`;
      badge.textContent = t === 'tsumo' ? 'T' : t === 'ron' ? 'R' : '—';
      btn.appendChild(badge);
    }

    btn.addEventListener('click', () => onSelect(i));
    nav.appendChild(btn);
  });

  if (!game.rounds.length) {
    const e = document.createElement('div');
    e.className = 'nav-empty';
    e.textContent = 'No hands yet';
    nav.appendChild(e);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'nav-add-btn';
  addBtn.textContent = '+ New Hand';
  addBtn.addEventListener('click', onAddHand);
  nav.appendChild(addBtn);
}

// Lightweight state for nav badge
function computeRoundStateForNav(round) {
  try { return computeRoundState(round); } catch { return null; }
}

// ── Round header ───────────────────────────────────────────────────────────────

export function renderRoundHeader(round, state, { title, onTitleClick, onAddDora, onAddUraDora } = {}) {
  const titleEl  = document.getElementById('round-title');
  const el       = document.getElementById('round-display');
  const riichiEl = document.getElementById('riichi-display');
  const doraEl   = document.getElementById('dora-display');

  if (titleEl) {
    titleEl.textContent = (title ?? []).filter(t => t).join(' — ');
    titleEl.onclick = onTitleClick ?? null;
  }

  if (!round) {
    el.textContent      = '—';
    riichiEl.textContent = '';
    doraEl.innerHTML    = '';
    return;
  }

  const wind = round.roundWind != null ? WIND_NAMES[round.roundWind] : WIND_NAMES[Math.floor((state?.dealer ?? 0) / 4)] ?? 'East';
  const num  = round.roundNum  != null ? round.roundNum : 0;
  el.textContent      = `${wind} ${num + 1} - ${round.honba}`;
  riichiEl.textContent = `Riichi sticks: ${state?.riichiSticks ?? round.initialRiichiSticks ?? 0}`;

  doraEl.innerHTML = '';
  const doras    = state?.doraIndicators    ?? round.doraIndicators    ?? round.initialDoraIndicators ?? [];
  const uraDoras = state?.uraDoraIndicators ?? round.uraDoraIndicators ?? [];

  [[' Dora:', doras], ['Ura:', uraDoras]].forEach(([label, tiles]) => {
    if (!tiles.length && label.startsWith('Ura')) return;
    const lbl = document.createElement('span');
    lbl.textContent = label;
    doraEl.appendChild(lbl);
    tiles.forEach(t => doraEl.appendChild(tileEl(t, { small: true })));
  });

  const doraBtn = (text, handler) => {
    const btn = document.createElement('button');
    btn.className = 'dora-add-btn';
    btn.textContent = text;
    btn.addEventListener('click', handler);
    doraEl.appendChild(btn);
  };
  if (onAddDora)    doraBtn('+Dora', onAddDora);
  if (onAddUraDora) doraBtn('+Ura',  onAddUraDora);
}

// ── Visualization (centre column) ─────────────────────────────────────────────
// Tiles are clickable; clicking selects the corresponding action in the log.

export function renderVisualization(state, round, playerNames, selectedActionIdx, onSelectAction) {
  const container = document.getElementById('players-container');
  container.innerHTML = '';
  if (!state || !round) return;

  for (let p = 0; p < 4; p++) {
    const pane = document.createElement('div');
    pane.className = 'player-pane';
    if (state.currentPlayer === p && state.phase !== Phase.COMPLETE) pane.classList.add('active');

    // Header
    const header = document.createElement('div');
    header.className = 'player-header';
    const seatWind = WIND_NAMES[(p - (state.dealer ?? 0) + 4) % 4];
    const isDealer = state.dealer === p;

    const nameWrap = document.createElement('span');
    nameWrap.className = 'player-name-wrap';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'player-name';
    nameSpan.textContent = playerNames[p];
    nameWrap.appendChild(nameSpan);

    const windSpan = document.createElement('span');
    windSpan.className = 'player-wind';
    windSpan.textContent = seatWind + (isDealer ? ' (D)' : '');

    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'player-score';
    const base  = state.scores[p] ?? 0;
    const delta = state.result?.scoreDeltas?.[p];
    scoreSpan.textContent = base.toLocaleString();
    if (delta != null && delta !== 0) {
      const ds = document.createElement('span');
      ds.className = `score-delta ${delta > 0 ? 'pos' : 'neg'}`;
      ds.textContent = ` ${delta > 0 ? '+' : ''}${delta.toLocaleString()}`;
      scoreSpan.appendChild(ds);
    }

    header.appendChild(nameWrap);
    header.appendChild(windSpan);
    header.appendChild(scoreSpan);
    pane.appendChild(header);

    const hand = state.hands[p];

    // Click handler: select the action in the log
    const clickAction = (actionIdx) => {
      if (onSelectAction) onSelectAction(actionIdx);
    };

    // Helper: make a row with a label
    const makeRow = (labelText, className) => {
      const row = document.createElement('div');
      row.className = `hand-row ${className}`;
      const lbl = document.createElement('span');
      lbl.className = 'hand-label';
      lbl.textContent = labelText;
      row.appendChild(lbl);
      return row;
    };

    // 1. Starting hand — from deal action
    const dealActionIdx = round.actions.findIndex(a => a.type === 'deal' && a.player === p);
    const startRow = makeRow('Start:', 'starting-row');
    const startList = document.createElement('div');
    startList.className = 'tile-list';
    const sorted13 = sortTiles(hand.startingTiles);
    for (let s = 0; s < Math.max(13, sorted13.length); s++) {
      if (s < sorted13.length) {
        const opts = { small: true };
        if (dealActionIdx !== -1 && onSelectAction) opts.onClick = () => clickAction(dealActionIdx);
        if (dealActionIdx === selectedActionIdx) opts.editing = true;
        startList.appendChild(tileEl(sorted13[s], opts));
      } else {
        const ph = document.createElement('div');
        ph.className = 'tile tile-sm tile-placeholder';
        startList.appendChild(ph);
      }
    }
    startRow.appendChild(startList);
    pane.appendChild(startRow);

    // 2+3. Turns — draw/discard pairs
    const pairs = buildTurnPairs(round.actions, p, selectedActionIdx ?? (round.actions.length - 1));
    const turnsRow = makeRow('Turns:', 'turns-row');
    const grid = document.createElement('div');
    grid.className = 'turns-grid';

    for (const { draw, discard } of pairs) {
      const col = document.createElement('div');
      col.className = 'turn-col';

      // Draw slot
      if (draw) {
        if (draw.type === 'draw') {
          const opts = { small: true };
          if (onSelectAction) opts.onClick = () => clickAction(draw.actionIdx);
          if (draw.actionIdx === selectedActionIdx) opts.editing = true;
          col.appendChild(tileEl(draw.tile, opts));
        } else {
          // Call in draw slot
          const wrap = document.createElement('div');
          wrap.className = 'call-draw-wrap' + (draw.actionIdx === selectedActionIdx ? ' selected-action' : '');
          if (onSelectAction) wrap.addEventListener('click', () => clickAction(draw.actionIdx));
          const lbl = document.createElement('span');
          lbl.className = 'call-type-label';
          lbl.textContent = draw.label ?? draw.type;
          wrap.appendChild(lbl);
          if (draw.tile != null) wrap.appendChild(tileEl(draw.tile, { small: true }));
          col.appendChild(wrap);
        }
      } else {
        const ph = document.createElement('div');
        ph.className = 'tile tile-sm tile-placeholder';
        col.appendChild(ph);
      }

      // Discard slot
      if (discard) {
        if (discard.type === 'ankan' || discard.type === 'kakan') {
          const wrap = document.createElement('div');
          wrap.className = 'call-draw-wrap' + (discard.actionIdx === selectedActionIdx ? ' selected-action' : '');
          if (onSelectAction) wrap.addEventListener('click', () => clickAction(discard.actionIdx));
          const lbl = document.createElement('span');
          lbl.className = 'call-type-label';
          lbl.textContent = discard.label ?? discard.type;
          wrap.appendChild(lbl);
          if (discard.tile != null) wrap.appendChild(tileEl(discard.tile, { small: true }));
          col.appendChild(wrap);
        } else if (discard.riichi) {
          const wrap = document.createElement('div');
          wrap.className = 'call-draw-wrap' + (discard.actionIdx === selectedActionIdx ? ' selected-action' : '');
          if (onSelectAction) wrap.addEventListener('click', () => clickAction(discard.actionIdx));
          const lbl = document.createElement('span');
          lbl.className = 'call-type-label';
          lbl.textContent = 'Riichi';
          wrap.appendChild(lbl);
          const el = tileEl(discard.tile, { small: true });
          if (discard.tsumogiri) {
            el.classList.add('tsumogiri');
            const glyph = el.querySelector('.tile-glyph');
            if (glyph) glyph.textContent = '↓';
          }
          wrap.appendChild(el);
          col.appendChild(wrap);
        } else {
          const opts = { small: true };
          if (onSelectAction) opts.onClick = () => clickAction(discard.actionIdx);
          if (discard.actionIdx === selectedActionIdx) opts.editing = true;
          const el = tileEl(discard.tile, opts);
          if (discard.tsumogiri) {
            el.classList.add('tsumogiri');
            const glyph = el.querySelector('.tile-glyph');
            if (glyph) glyph.textContent = '↓';
          }
          col.appendChild(el);
        }
      } else {
        const ph = document.createElement('div');
        ph.className = 'tile tile-sm tile-placeholder';
        col.appendChild(ph);
      }

      grid.appendChild(col);
    }

    turnsRow.appendChild(grid);
    pane.appendChild(turnsRow);

    // 4. Current hand
    const handRow = makeRow('Hand:', 'hand-row');
    handRow.appendChild(buildTileList(sortTiles(hand.tiles)));
    if (hand.melds.length) {
      const sep = document.createElement('div');
      sep.className = 'meld-sep';
      handRow.appendChild(sep);
      for (const meld of [...hand.melds].reverse()) {
        const meldEl = document.createElement('div');
        meldEl.className = 'meld';
        // For chi, put the called tile first so the rotation always lands on it.
        const displayTiles = meld.type === 'chi' && meld.calledTile != null
          ? [meld.calledTile, ...meld.tiles.filter(t => t !== meld.calledTile).sort((a, b) => a - b)]
          : meld.tiles;
        const rotIdx = meldRotatedIndex(meld, p);
        displayTiles.forEach((t, ti) => {
          meldEl.appendChild(ti === rotIdx ? rotatedTileEl(t) : tileEl(t, { small: true }));
        });
        handRow.appendChild(meldEl);
      }
    }
    pane.appendChild(handRow);

    container.appendChild(pane);
  }
}

function buildTileList(tiles) {
  const wrap = document.createElement('div');
  wrap.className = 'tile-list';
  tiles.forEach(t => wrap.appendChild(tileEl(t, { small: true })));
  return wrap;
}

// ── Action log (right column) ─────────────────────────────────────────────────

export function renderActionLog(round, playerNames, selectedIdx, { onSelect, onDelete, onDeleteAfter }) {
  const log = document.getElementById('action-log');
  log.innerHTML = '';
  if (!round) return;

  round.actions.forEach((a, idx) => {
    const item = document.createElement('div');
    item.className = 'log-item' + (idx === selectedIdx ? ' selected' : '');
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.log-item-btns')) onSelect(idx);
    });

    const text = document.createElement('span');
    text.className = 'log-item-text';
    text.innerHTML = actionDescription(a, playerNames);
    item.appendChild(text);

    const btns = document.createElement('span');
    btns.className = 'log-item-btns';

    const delBtn = document.createElement('button');
    delBtn.className = 'log-del-btn';
    delBtn.title = 'Delete this action';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); onDelete(idx); });
    btns.appendChild(delBtn);

    const delAfterBtn = document.createElement('button');
    delAfterBtn.className = 'log-del-after-btn';
    delAfterBtn.title = 'Delete this and everything after';
    delAfterBtn.textContent = '×≥';
    delAfterBtn.addEventListener('click', (e) => { e.stopPropagation(); onDeleteAfter(idx); });
    btns.appendChild(delAfterBtn);

    item.appendChild(btns);
    log.appendChild(item);
  });

  // Scroll selected item into view
  if (selectedIdx !== null) {
    const sel = log.children[selectedIdx];
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  } else {
    log.scrollTop = log.scrollHeight;
  }
}

function actionDescription(a, players) {
  const pn = (p) => `<b>${players[p] ?? `P${p}`}</b>`;
  const tl = (t) => (t != null ? ` <em>${tileToString(t)}</em>` : '');
  switch (a.type) {
    case 'deal':      return `${pn(a.player)} dealt ${a.tiles?.length ?? 0} tiles`;
    case 'draw':      return `${pn(a.player)} draws${tl(a.tile)}`;
    case 'discard':
    case 'call_discard': {
      const tag     = a.riichi     ? ' <span class="log-tag riichi">Riichi</span>' : '';
      const tsumark = a.tsumogiri  ? ' <span class="log-tag tsumogiri">↓</span>'  : '';
      return `${pn(a.player)} discards${tl(a.tile)}${tsumark}${tag}`;
    }
    case 'riichi':    return `${pn(a.player)} Riichi discards${tl(a.tile)}`;
    case 'riichi_complete': return `${pn(a.player)} <span class="log-tag riichi-ok">Riichi ✓</span> (−1000)`;
    case 'chi':       return `${pn(a.callingPlayer)} Chi <em>${(a.tiles ?? []).map(tileToString).join(' ')}</em>`;
    case 'pon':       return `${pn(a.callingPlayer)} Pon <em>${(a.tiles ?? []).map(tileToString).join(' ')}</em>`;
    case 'kan': case 'kakan': case 'ankan':
      return `${pn(a.callingPlayer)} Kan (${a.type}) <em>${tileToString(a.calledTile ?? a.tiles?.[0])}</em>`;
    case 'tsumo':     return `${pn(a.player)} <span class="log-tag win">Tsumo</span>${tl(a.tile)}`;
    case 'ron':       return `${pn(a.winner)} <span class="log-tag win">Ron</span>${tl(a.tile)} from ${pn(a.loser)}`;
    case 'draw_exhausted': return `<span class="log-tag draw">Ryuukyoku</span>`;
    case 'add_dora':  return `Dora indicator:${tl(a.tile)}`;
    case 'add_ura_dora': return `Ura dora:${tl(a.tile)}`;
    case 'pass':      return `— pass —`;
    default:          return a.type;
  }
}

// ── Input / action panel ───────────────────────────────────────────────────────

const ALL_BUTTONS = ['btn-tsumo','btn-ron','btn-chi','btn-pon','btn-kan','btn-riichi','btn-pass','btn-exhausted'];

export function renderControls(state, players, riichiMode, { onRiichiToggle } = {}) {
  const prompt  = state ? phasePrompt(state, players) : { label: '—', hint: '', expects: 'none' };
  document.getElementById('phase-label').textContent = prompt.label;
  document.getElementById('hint-text').textContent   = prompt.hint;

  const input   = document.getElementById('tile-input');
  const confirm = document.getElementById('btn-confirm');

  for (const id of ALL_BUTTONS) {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = 'none';
  }

  const show = (...ids) => ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });

  if (!state) { input.style.display = 'none'; confirm.style.display = 'none'; return; }

  switch (state.phase) {
    case Phase.DEAL:
      input.placeholder = 'e.g. 123m456p789s1234z';
      input.style.display = '';
      confirm.style.display = '';
      break;
    case Phase.DRAW:
      input.placeholder = 'Drawn tile, e.g. 3m';
      input.style.display = '';
      confirm.style.display = '';
      show('btn-exhausted');
      break;
    case Phase.DISCARD:
      input.placeholder = riichiMode ? 'Riichi discard…' : 'Tile to discard';
      input.style.display = '';
      confirm.style.display = '';
      show('btn-tsumo', 'btn-kan', 'btn-riichi');
      document.getElementById('btn-riichi').textContent = riichiMode ? '✓ Riichi' : 'Riichi';
      document.getElementById('btn-riichi').classList.toggle('active-toggle', riichiMode);
      break;
    case Phase.CALL_WINDOW:
      input.placeholder = 'Next draw (pass) or use call buttons';
      input.style.display = '';
      confirm.style.display = '';
      show('btn-chi', 'btn-pon', 'btn-kan', 'btn-ron', 'btn-pass');
      document.getElementById('btn-pass').textContent = prompt.wasRiichi ? 'Riichi OK' : 'Pass';
      break;
    case Phase.CALL_DISCARD:
      input.placeholder = 'Tile to discard';
      input.style.display = '';
      confirm.style.display = '';
      show('btn-kan');
      break;
    case Phase.CHANKAN:
      input.placeholder = 'Rinshan draw tile (pass)';
      input.style.display = '';
      confirm.style.display = '';
      show('btn-ron', 'btn-pass');
      document.getElementById('btn-pass').textContent = 'Pass';
      break;
    case Phase.COMPLETE:
      input.style.display = 'none';
      confirm.style.display = 'none';
      show('btn-exhausted');
      document.getElementById('btn-exhausted').textContent = 'Next Round';
      break;
    default:
      input.style.display = 'none';
      confirm.style.display = 'none';
  }

  if (state.phase !== Phase.COMPLETE) {
    const ex = document.getElementById('btn-exhausted');
    if (ex && state.phase !== Phase.DRAW) ex.textContent = 'Draw Exhausted';
  }
}

// ── Modals ─────────────────────────────────────────────────────────────────────

export function showSaveModal(saves, onLoad, onDelete) {
  const names   = Object.keys(saves);
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <h2>Saved Games</h2>
    ${!names.length ? '<p>No saves yet.</p>' : ''}
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
  document.getElementById('modal-close').addEventListener('click', () => overlay.classList.add('hidden'));
}

export function showCallModal(game, callType, state, onConfirm, onCancel) {
  const overlay       = document.getElementById('modal-overlay');
  const content       = document.getElementById('modal-content');
  const players       = game.meta.players;
  const discarder     = state.callWindowPlayer;
  const discardedTile = state.hands[discarder]?.discards?.at(-1);
  const tileStr       = tileToString(discardedTile);

  content.innerHTML = `<h2>${callType.toUpperCase()}</h2>`;
  overlay.classList.remove('hidden');

  if (callType === 'chi') {
    // Chi: always the next player, needs the two sequence tiles from hand
    const chiPlayer = (discarder + 1) % 4;
    content.innerHTML += `<p>Caller: <strong>${players[chiPlayer]}</strong></p>
      <p style="margin-top:8px">Hand tiles used (not including <strong>${tileStr}</strong>):</p>
      <input id="call-tiles-input" type="text" placeholder="e.g. 2m 4m" style="width:100%;margin-top:4px" autocomplete="off">
      <div id="chi-error" style="color:var(--red);font-size:12px;min-height:16px;margin-top:4px"></div>
      <div class="modal-buttons" style="margin-top:8px">
        <button id="modal-confirm">Confirm</button>
        <button id="modal-cancel">Cancel</button>
      </div>`;
    const inp    = document.getElementById('call-tiles-input');
    const errEl  = document.getElementById('chi-error');
    const chiHand = state.hands[chiPlayer].tiles;
    inp.focus();
    const doConfirm = () => {
      const fromHandTiles = parseHand(inp.value);
      if (fromHandTiles.length !== 2) {
        errEl.textContent = `Enter exactly 2 tiles (got ${fromHandTiles.length}).`;
        return;
      }
      const handCopy = [...chiHand];
      for (const t of fromHandTiles) {
        const idx = handCopy.indexOf(t);
        if (idx === -1) { errEl.textContent = `${tileToString(t)} is not in hand.`; return; }
        handCopy.splice(idx, 1);
      }
      overlay.classList.add('hidden');
      onConfirm({ callingPlayer: chiPlayer, fromHandTiles, calledTile: discardedTile, kanType: null });
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') doConfirm(); });
    document.getElementById('modal-confirm').addEventListener('click', doConfirm);
    document.getElementById('modal-cancel').addEventListener('click', () => { overlay.classList.add('hidden'); onCancel?.(); });
    return;
  }

  // Pon / Kan: fromHand is always copies of the discarded tile
  const needed       = callType === 'pon' ? 2 : 3;
  const fromHandTiles = Array(needed).fill(discardedTile);
  const others       = [0,1,2,3].filter(p => p !== discarder);
  const candidates   = others.filter(p =>
    state.hands[p].tiles.filter(t => t === discardedTile).length >= needed
  );

  // Determine calling player: auto if unambiguous, manual otherwise
  let callerRef; // { get: () => number }
  if (candidates.length === 1) {
    content.innerHTML += `<p>Caller: <strong>${players[candidates[0]]}</strong></p>`;
    callerRef = { get: () => candidates[0] };
  } else {
    const fallback = candidates.length ? candidates[0] : others[0];
    const pool     = candidates.length ? candidates : others;
    content.innerHTML += `<p>Which player calls?</p>
      <div class="modal-buttons" id="caller-btns">
        ${pool.map((p, i) => `<button class="sel-player${i === 0 ? ' selected' : ''}" data-player="${p}">${players[p]}</button>`).join('')}
      </div>
      <input type="hidden" id="calling-player" value="${fallback}">`;
    content.querySelectorAll('.sel-player').forEach(btn => {
      btn.addEventListener('click', () => {
        content.querySelectorAll('.sel-player').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('calling-player').value = btn.dataset.player;
      });
    });
    callerRef = { get: () => +document.getElementById('calling-player').value };
  }

  const actionRow = document.createElement('div');
  actionRow.className = 'modal-buttons';
  actionRow.style.marginTop = '12px';
  actionRow.innerHTML = `<button id="modal-confirm">Confirm</button><button id="modal-cancel">Cancel</button>`;
  content.appendChild(actionRow);

  const confirmBtn = document.getElementById('modal-confirm');
  const doConfirm = () => {
    overlay.classList.add('hidden');
    overlay.removeEventListener('keydown', onKey);
    onConfirm({ callingPlayer: callerRef.get(), fromHandTiles, calledTile: discardedTile, kanType: callType === 'kan' ? 'open' : null });
  };
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); doConfirm(); } };
  overlay.addEventListener('keydown', onKey);
  confirmBtn.addEventListener('click', doConfirm);
  document.getElementById('modal-cancel').addEventListener('click', () => {
    overlay.classList.add('hidden');
    overlay.removeEventListener('keydown', onKey);
    onCancel?.();
  });
  confirmBtn.focus();
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
  input.focus(); input.select();
  const doConfirm = () => {
    const name = input.value.trim();
    if (name) { overlay.classList.add('hidden'); onConfirm(name); }
  };
  document.getElementById('modal-confirm').addEventListener('click', doConfirm);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doConfirm(); });
  document.getElementById('modal-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
}

export function showRoundSetupModal(game, onConfirm) {
  const overlay   = document.getElementById('modal-overlay');
  const content   = document.getElementById('modal-content');
  const prevRound = game.rounds[game.rounds.length - 1];
  const prevState = prevRound ? (() => { try { return computeRoundState(prevRound); } catch { return null; } })() : null;
  const defScores = prevState
    ? prevState.scores.map(s => s.toLocaleString()).join(', ')
    : '25000, 25000, 25000, 25000';
  const defDealer = prevRound ? ((prevRound.dealer + 1) % 4) : 0;
  const defHonba  = prevRound?.honba ?? 0;

  content.innerHTML = `
    <h2>Start New Round</h2>
    <label>Scores: <input id="scores-input" type="text" value="${defScores}" style="width:240px"></label><br><br>
    <label>Dealer (0-3): <input id="dealer-input" type="number" min="0" max="3" value="${defDealer}" style="width:60px"></label><br><br>
    <label>Honba: <input id="honba-input" type="number" min="0" value="${defHonba}" style="width:60px"></label><br><br>
    <label>Dora indicator: <input id="dora-input" type="text" placeholder="e.g. 1m" style="width:80px"></label><br><br>
    <div class="modal-buttons">
      <button id="modal-confirm">Start Round</button>
      <button id="modal-cancel">Cancel</button>
    </div>
  `;
  overlay.classList.remove('hidden');

  document.getElementById('modal-confirm').addEventListener('click', () => {
    const scores = document.getElementById('scores-input').value
      .split(',').map(s => parseInt(s.trim().replace(/,/g, ''), 10)).filter(n => !isNaN(n));
    const dealer  = parseInt(document.getElementById('dealer-input').value, 10);
    const honba   = parseInt(document.getElementById('honba-input').value, 10);
    const doraStr = document.getElementById('dora-input').value.trim();
    const dora    = doraStr ? parseTile(doraStr) : null;
    overlay.classList.add('hidden');
    onConfirm({
      scores:       scores.length === 4 ? scores : null,
      dealer:       isNaN(dealer) ? 0 : dealer % 4,
      honba:        isNaN(honba)  ? 0 : honba,
      doraIndicator: dora,
    });
  });
  document.getElementById('modal-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
}

export function showSingleNameModal(playerIndex, currentName, onConfirm) {
  const winds   = ['East', 'South', 'West', 'North'];
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <h2>Edit name — ${winds[playerIndex]}</h2>
    <input id="single-name-input" type="text" value="${currentName}" style="width:100%" autocomplete="off">
    <div class="modal-buttons" style="margin-top:12px">
      <button id="modal-confirm">Save</button>
      <button id="modal-cancel">Cancel</button>
    </div>
  `;
  overlay.classList.remove('hidden');
  const input = document.getElementById('single-name-input');
  input.focus(); input.select();
  const confirm = () => {
    const name = input.value.trim() || `Player ${playerIndex + 1}`;
    overlay.classList.add('hidden'); onConfirm(name);
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') overlay.classList.add('hidden'); });
  document.getElementById('modal-confirm').addEventListener('click', confirm);
  document.getElementById('modal-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
}

export function showTitleModal(currentTitle, onConfirm) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <h2>Set Title</h2>
    <label style="display:block;margin-bottom:10px">Line 1<br>
      <input id="title-0" type="text" value="${currentTitle[0]}" style="width:100%" autocomplete="off"></label>
    <label style="display:block;margin-bottom:16px">Line 2<br>
      <input id="title-1" type="text" value="${currentTitle[1]}" style="width:100%" autocomplete="off"></label>
    <div class="modal-buttons">
      <button id="modal-confirm">Save</button>
      <button id="modal-cancel">Cancel</button>
    </div>
  `;
  overlay.classList.remove('hidden');
  document.getElementById('title-0').focus();
  const confirm = () => {
    overlay.classList.add('hidden');
    onConfirm([document.getElementById('title-0').value, document.getElementById('title-1').value]);
  };
  document.getElementById('modal-confirm').addEventListener('click', confirm);
  document.getElementById('modal-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
}

export function showTilePromptModal(title, onConfirm, onCancel) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <h2>${title}</h2>
    <input id="tile-prompt-input" type="text" placeholder="e.g. 3m" style="width:100%" autocomplete="off">
    <div id="tile-prompt-error" style="color:var(--red);font-size:12px;min-height:16px;margin-top:4px"></div>
    <div class="modal-buttons" style="margin-top:8px">
      <button id="modal-confirm">Add</button>
      <button id="modal-cancel">Cancel</button>
    </div>
  `;
  overlay.classList.remove('hidden');
  const inp = document.getElementById('tile-prompt-input');
  const errEl = document.getElementById('tile-prompt-error');
  inp.focus();
  const doConfirm = () => {
    const tile = parseTile(inp.value.trim());
    if (tile === null) { errEl.textContent = 'Unrecognised tile.'; return; }
    overlay.classList.add('hidden');
    onConfirm(tile);
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') doConfirm(); });
  document.getElementById('modal-confirm').addEventListener('click', doConfirm);
  document.getElementById('modal-cancel').addEventListener('click', () => { overlay.classList.add('hidden'); onCancel?.(); });
}

export function showSelfKanModal(state, playerNames, onConfirm, onCancel) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  const p    = state.currentPlayer;
  const hand = state.hands[p];

  // Ankan: 4 of the same tile currently in hand
  const counts = {};
  for (const t of hand.tiles) counts[t] = (counts[t] ?? 0) + 1;
  const options = [
    ...Object.entries(counts)
      .filter(([, c]) => c >= 4)
      .map(([t]) => ({ type: 'ankan', tile: +t })),
    // Kakan: existing pon meld + the 4th tile is still in hand
    ...hand.melds
      .filter(m => m.type === 'pon')
      .map(m => ({ ...m, ponTile: m.calledTile ?? m.tiles?.[0] }))
      .filter(({ ponTile }) => ponTile != null && hand.tiles.includes(ponTile))
      .map(({ ponTile }) => ({ type: 'kakan', tile: ponTile })),
  ];

  content.innerHTML = `<h2>Kan — ${playerNames[p]}</h2>`;
  overlay.classList.remove('hidden');

  if (!options.length) {
    content.innerHTML += `<p style="color:var(--text-1);margin-bottom:12px">No kan available.</p>`;
  } else {
    const btnRow = document.createElement('div');
    btnRow.className = 'modal-buttons';
    btnRow.style.marginBottom = '8px';
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.textContent = `${opt.type === 'ankan' ? 'Ankan' : 'Kakan'} ${tileToString(opt.tile)}`;
      btn.addEventListener('click', () => { overlay.classList.add('hidden'); onConfirm(opt); });
      btnRow.appendChild(btn);
    }
    content.appendChild(btnRow);
  }

  const cancelRow = document.createElement('div');
  cancelRow.className = 'modal-buttons';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => { overlay.classList.add('hidden'); onCancel?.(); });
  cancelRow.appendChild(cancelBtn);
  content.appendChild(cancelRow);
}

// ── Win scoring modal ──────────────────────────────────────────────────────────

export function showWinScoringModal(opts, onConfirm, onCancel) {
  const { isTsumo, tile, winner: tsumoWinner, loser, state, playerNames, honba: honbaOpt } = opts;
  const overlay   = document.getElementById('modal-overlay');
  const content   = document.getElementById('modal-content');
  const honba     = honbaOpt ?? 0;
  const riichiPot = state.riichiSticks ?? 0;
  const dealer    = state.dealer    ?? 0;
  const scores    = state.scores;

  const candidates = isTsumo ? [tsumoWinner] : [0,1,2,3].filter(p => p !== loser);

  const winnerState = {};
  for (const p of candidates) {
    winnerState[p] = {
      selected:     isTsumo,
      isOpen:       (state.hands[p]?.melds?.some(m => m.type !== 'ankan') ?? false),
      selectedYaku: new Set(),
      dora: 0, akaDora: 0, uraDora: 0, fu: 30,
    };
  }

  const FU_OPTIONS  = [20,25,30,40,50,60,70,80,90,100,110];
  const YAKU_BY_HAN = [1,2,3,6,13].map(h => ({ label: h >= 13 ? 'Yakuman' : `${h} han`, yaku: YAKU.filter(y => y.han === h) }));

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

  const summaryEl = document.createElement('div');
  summaryEl.className = 'score-summary';
  content.appendChild(summaryEl);

  const sectionsWrap = document.createElement('div');
  content.appendChild(sectionsWrap);

  const effectiveHan = (p) => {
    const ws = winnerState[p];
    return totalHan([...ws.selectedYaku], ws.isOpen) + ws.dora + ws.akaDora + ws.uraDora;
  };
  const effectiveFu = (p) => {
    const ws = winnerState[p];
    const fo = fuOverride([...ws.selectedYaku]);
    return fo !== null ? fo : ws.fu;
  };

  const recomputeSummary = () => {
    const selected = candidates.filter(p => winnerState[p].selected);
    const deltas   = [0,0,0,0];
    for (const p of selected) {
      const han = effectiveHan(p), fu = effectiveFu(p);
      if (!han) continue;
      const d = computeScoreDeltas(han, fu, { winner: p, loser, dealer, isTsumo, honba, riichiPot: selected[0] === p ? riichiPot : 0 });
      for (let i = 0; i < 4; i++) deltas[i] += d[i];
    }
    summaryEl.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'score-table';
    for (let i = 0; i < 4; i++) {
      const tr = document.createElement('tr');
      const d  = deltas[i];
      tr.innerHTML = `<td>${playerNames[i]}${i===dealer?' ★':''}</td><td>${scores[i].toLocaleString()}</td>
        <td class="${d>0?'pos':d<0?'neg':''}">${d>0?'+':''}${d.toLocaleString()}</td>
        <td>${(scores[i]+d).toLocaleString()}</td>`;
      table.appendChild(tr);
    }
    summaryEl.appendChild(table);
    summaryEl._deltas = deltas;
  };

  const buildWinnerSection = (p) => {
    const ws  = winnerState[p];
    const sec = document.createElement('div');
    sec.className = 'winner-section';

    const hdr = document.createElement('div');
    hdr.className = 'winner-hdr';
    if (!isTsumo) {
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = `winner-cb-${p}`; cb.checked = ws.selected;
      cb.addEventListener('change', () => { ws.selected = cb.checked; body.style.display = cb.checked ? '' : 'none'; recomputeSummary(); });
      hdr.appendChild(cb);
    }
    const lbl = document.createElement('label');
    lbl.htmlFor = `winner-cb-${p}`; lbl.className = 'winner-name'; lbl.textContent = playerNames[p];
    hdr.appendChild(lbl);
    sec.appendChild(hdr);

    const body = document.createElement('div');
    body.className = 'winner-body';
    if (!isTsumo) body.style.display = ws.selected ? '' : 'none';

    const openRow = document.createElement('div');
    openRow.className = 'open-row';
    openRow.innerHTML = `
      <label><input type="radio" name="open-${p}" value="closed" ${!ws.isOpen?'checked':''}> Closed</label>
      <label><input type="radio" name="open-${p}" value="open"   ${ws.isOpen?'checked':''}>  Open</label>
    `;
    openRow.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', () => {
      ws.isOpen = r.value === 'open'; rebuildYaku(p, body); rebuildHanFu(p, body); recomputeSummary();
    }));
    body.appendChild(openRow);

    const yakuWrap = document.createElement('div');
    yakuWrap.className = 'yaku-wrap';
    body.appendChild(yakuWrap);

    const hanFuRow = document.createElement('div');
    hanFuRow.className = 'han-fu-row';
    body.appendChild(hanFuRow);

    sec.appendChild(body);
    sectionsWrap.appendChild(sec);
    rebuildYaku(p, body); rebuildHanFu(p, body);
  };

  const rebuildYaku = (p, body) => {
    const ws = winnerState[p];
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
      cat.className = 'yaku-category'; cat.textContent = group.label;
      yakuWrap.appendChild(cat);
      const grid = document.createElement('div');
      grid.className = 'yaku-grid';
      for (const y of visible) {
        const btn = document.createElement('button');
        btn.className = 'yaku-btn' + (ws.selectedYaku.has(y.id) ? ' selected' : '');
        const dispHan = ws.isOpen ? (y.hanOpen ?? y.han) : y.han;
        btn.textContent = `${y.name} (${dispHan})`;
        btn.addEventListener('click', () => {
          if (ws.selectedYaku.has(y.id)) ws.selectedYaku.delete(y.id); else ws.selectedYaku.add(y.id);
          btn.classList.toggle('selected'); rebuildHanFu(p, body); recomputeSummary();
        });
        grid.appendChild(btn);
      }
      yakuWrap.appendChild(grid);
    }
  };

  const rebuildHanFu = (p, body) => {
    const ws = winnerState[p];
    const row = body.querySelector('.han-fu-row');
    row.innerHTML = '';
    const yHan = totalHan([...ws.selectedYaku], ws.isOpen);
    const fo   = fuOverride([...ws.selectedYaku]);
    const total = yHan + ws.dora + ws.akaDora + ws.uraDora;

    const baseSpan = document.createElement('span');
    baseSpan.innerHTML = `Han: <strong>${yHan}</strong>`;
    row.appendChild(baseSpan);

    for (const [key, label] of [['dora','Dora'],['akaDora','Aka'],['uraDora','Ura']]) {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px';
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = '0'; inp.max = '10'; inp.value = ws[key];
      inp.style.cssText = 'width:40px;padding:3px 4px';
      inp.addEventListener('input', () => { ws[key] = Math.max(0, parseInt(inp.value)||0); rebuildHanFu(p, body); recomputeSummary(); });
      wrap.textContent = `+${label} `;
      wrap.appendChild(inp);
      row.appendChild(wrap);
    }

    const totalSpan = document.createElement('span');
    totalSpan.innerHTML = `= <strong>${total}</strong>`;
    row.appendChild(totalSpan);

    const fuWrap = document.createElement('label');
    fuWrap.style.marginLeft = '16px';
    if (fo !== null) {
      fuWrap.innerHTML = `Fu: <strong>${fo}</strong> (fixed)`;
    } else {
      fuWrap.innerHTML = 'Fu: ';
      const fuSel = document.createElement('select');
      for (const v of FU_OPTIONS) {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v; if (v === ws.fu) opt.selected = true;
        fuSel.appendChild(opt);
      }
      fuSel.addEventListener('change', () => { ws.fu = parseInt(fuSel.value); recomputeSummary(); });
      fuWrap.appendChild(fuSel);
    }
    row.appendChild(fuWrap);

    if (total > 0) {
      const fu2  = fo !== null ? fo : ws.fu;
      const pmnt = paymentSummary(total, fu2, { winner: p, loser, dealer, isTsumo, honba, riichiPot: candidates[0] === p ? riichiPot : 0 });
      const prev = document.createElement('span');
      prev.className = 'payment-preview';
      prev.textContent = ` → ${pmnt.limit ? pmnt.limit + ' ' : ''}${pmnt.label} pts`;
      row.appendChild(prev);
    }
  };

  for (const p of candidates) buildWinnerSection(p);
  recomputeSummary();

  const btnRow = document.createElement('div');
  btnRow.className = 'modal-buttons';
  btnRow.style.marginTop = '16px';

  const confirmBtn = document.createElement('button');
  confirmBtn.id = 'modal-confirm'; confirmBtn.textContent = 'Confirm Win';
  confirmBtn.addEventListener('click', () => {
    const selected = candidates.filter(p => winnerState[p].selected);
    if (!selected.length) return;
    const winners = selected.map(p => {
      const ws = winnerState[p];
      return {
        player: p,
        han: effectiveHan(p), fu: effectiveFu(p),
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
  cancelBtn.id = 'modal-cancel'; cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => { overlay.classList.add('hidden'); onCancel?.(); });

  btnRow.appendChild(confirmBtn); btnRow.appendChild(cancelBtn);
  content.appendChild(btnRow);
  overlay.classList.remove('hidden');
}
