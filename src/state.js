export const Phase = {
  DEAL:         'DEAL',
  DRAW:         'DRAW',
  DISCARD:      'DISCARD',
  CALL_WINDOW:  'CALL_WINDOW',
  CALL_DISCARD: 'CALL_DISCARD',
  CHANKAN:      'CHANKAN',
  COMPLETE:     'COMPLETE',
};

export const WIND_NAMES  = ['East', 'South', 'West', 'North'];
export const CALL_TYPES  = new Set(['chi', 'pon', 'kan', 'kakan', 'ankan']);
export const CALL_LABELS = { chi: 'Chi', pon: 'Pon', kan: 'Kan', kakan: 'Kan+', ankan: 'Ankan' };

export function createGame(playerNames = ['Player 1', 'Player 2', 'Player 3', 'Player 4']) {
  return {
    meta: { players: [...playerNames], title: ['', ''], rules: { rounds: 'east-south', basePoints: 25000 } },
    rounds: [],
  };
}

export function createRound({ dealer = 0, honba = 0, riichiSticks = 0, scores, doraIndicator } = {}) {
  return {
    dealer,
    honba,
    initialRiichiSticks: riichiSticks,
    initialScores:       scores ?? [25000, 25000, 25000, 25000],
    doraIndicators:      doraIndicator != null ? [doraIndicator] : [],
    uraDoraIndicators:   [],
    actions:             [],
  };
}

// Derive full game state from round.actions[0..upToIdx] inclusive.
// upToIdx = Infinity means apply all actions.
export function computeRoundState(round, upToIdx = Infinity) {
  const hands = Array.from({ length: 4 }, () => ({
    startingTiles: [], tiles: [], melds: [], discards: [],
    inRiichi: false, riichiTurn: -1,
  }));
  const state = {
    hands,
    scores:            [...(round.initialScores        ?? [25000, 25000, 25000, 25000])],
    riichiSticks:      round.initialRiichiSticks        ?? 0,
    doraIndicators:    [...(round.doraIndicators ?? round.initialDoraIndicators ?? [])],
    uraDoraIndicators: [...(round.uraDoraIndicators ?? [])],
    dealer:            round.dealer ?? 0,
    currentPlayer:     round.dealer ?? 0,
    callWindowPlayer:  null,
    lastRiichiPlayer:  null,
    phase:             Phase.DEAL,
    dealStep:          0,
    result:            null,
  };

  const limit = Math.min(upToIdx + 1, round.actions.length);
  for (let i = 0; i < limit; i++) _apply(state, round.actions[i]);
  return state;
}

function _apply(st, a) {
  const h = st.hands;
  switch (a.type) {
    case 'deal':
      h[a.player].startingTiles = [...a.tiles];
      h[a.player].tiles         = [...a.tiles];
      st.dealStep++;
      if (st.dealStep >= 4) { st.phase = Phase.DRAW; st.currentPlayer = st.dealer; }
      break;

    case 'draw':
      h[a.player].tiles.push(a.tile);
      st.currentPlayer = a.player;
      st.phase = Phase.DISCARD;
      break;

    case 'discard':
    case 'call_discard': {
      const hd = h[a.player];
      const ix = hd.tiles.lastIndexOf(a.tile);
      if (ix !== -1) hd.tiles.splice(ix, 1);
      hd.discards.push(a.tile);
      if (a.riichi) { hd.inRiichi = true; hd.riichiTurn = hd.discards.length - 1; st.lastRiichiPlayer = a.player; }
      st.callWindowPlayer = a.player;
      st.phase = Phase.CALL_WINDOW;
      break;
    }

    // Legacy action type kept for imported games
    case 'riichi':
      _apply(st, { ...a, type: 'discard', riichi: true });
      break;

    case 'riichi_complete': {
      const p = a.player ?? st.lastRiichiPlayer;
      if (p != null) { st.riichiSticks++; st.scores[p] -= 1000; }
      st.currentPlayer     = ((st.callWindowPlayer ?? 0) + 1) % 4;
      st.callWindowPlayer  = null;
      st.lastRiichiPlayer  = null;
      st.phase = Phase.DRAW;
      break;
    }

    case 'pass':
      // After chankan, the kakan caller draws rinshan (same player); elsewhere next player draws
      st.currentPlayer    = st.phase === Phase.CHANKAN
        ? (st.callWindowPlayer ?? st.currentPlayer)
        : ((st.callWindowPlayer ?? 0) + 1) % 4;
      st.callWindowPlayer = null;
      st.phase = Phase.DRAW;
      break;

    case 'chi':
    case 'pon': {
      const caller = h[a.callingPlayer];
      for (const t of (a.fromHand ?? [])) { const i = caller.tiles.lastIndexOf(t); if (i !== -1) caller.tiles.splice(i, 1); }
      caller.melds.push({ type: a.type, tiles: a.tiles, calledFrom: a.calledFrom, calledTile: a.calledTile });
      st.currentPlayer = a.callingPlayer; st.callWindowPlayer = null; st.lastRiichiPlayer = null;
      st.phase = Phase.CALL_DISCARD;
      break;
    }

    case 'kan': case 'kakan': case 'ankan': {
      const caller = h[a.callingPlayer];
      for (const t of (a.fromHand ?? [])) { const i = caller.tiles.lastIndexOf(t); if (i !== -1) caller.tiles.splice(i, 1); }
      if (a.type === 'kakan') {
        // Extend the existing pon meld in place rather than adding a duplicate
        const tile = a.calledTile ?? a.tiles?.[0];
        const ponIdx = caller.melds.findIndex(m => m.type === 'pon' && (m.calledTile ?? m.tiles?.[0]) === tile);
        if (ponIdx !== -1) {
          caller.melds[ponIdx] = { ...caller.melds[ponIdx], type: 'kakan', tiles: a.tiles };
        } else {
          caller.melds.push({ type: 'kakan', tiles: a.tiles, calledFrom: a.calledFrom, calledTile: a.calledTile });
        }
      } else {
        caller.melds.push({ type: a.type, kanType: a.kanType, tiles: a.tiles, calledFrom: a.calledFrom, calledTile: a.calledTile });
      }
      if (a.newDora) st.doraIndicators.push(a.newDora);
      st.currentPlayer = a.callingPlayer; st.lastRiichiPlayer = null;
      if (a.type === 'kakan') {
        st.callWindowPlayer = a.callingPlayer;
        st.phase = Phase.CHANKAN;
      } else {
        st.callWindowPlayer = null;
        st.phase = Phase.DRAW;
      }
      break;
    }

    case 'tsumo':
      if (a.scoreDeltas) for (let p = 0; p < 4; p++) st.scores[p] += a.scoreDeltas[p];
      st.result = { type: 'tsumo', winner: a.player, winners: a.winners ?? [{ player: a.player, yaku: [] }], tile: a.tile, scoreDeltas: a.scoreDeltas ?? null };
      st.phase = Phase.COMPLETE;
      break;

    case 'ron':
      if (a.scoreDeltas) for (let p = 0; p < 4; p++) st.scores[p] += a.scoreDeltas[p];
      st.result = { type: 'ron', winner: a.winner, winners: a.winners ?? [{ player: a.winner }], loser: a.loser, tile: a.tile, scoreDeltas: a.scoreDeltas ?? null };
      st.phase = Phase.COMPLETE;
      break;

    case 'draw_exhausted':
      if (a.scoreDeltas) for (let p = 0; p < 4; p++) st.scores[p] += a.scoreDeltas[p];
      st.result = { type: 'draw_exhausted', scoreDeltas: a.scoreDeltas ?? null };
      st.phase = Phase.COMPLETE;
      break;

    case 'add_dora':     st.doraIndicators.push(a.tile);    break;
    case 'add_ura_dora': st.uraDoraIndicators.push(a.tile); break;
  }
}

// Build draw/discard turn pairs for player p, up to upToIdx inclusive.
// Each pair: { draw: { actionIdx, tile, type, label? } | null,
//              discard: { actionIdx, tile, riichi } | null }
export function buildTurnPairs(actions, p, upToIdx = Infinity) {
  const limit = Math.min(upToIdx + 1, actions.length);
  const pairs = [];
  let pending = null;
  for (let i = 0; i < limit; i++) {
    const a = actions[i];
    if (a.type === 'draw' && a.player === p) {
      pending = { actionIdx: i, tile: a.tile, type: 'draw' };
    } else if (CALL_TYPES.has(a.type) && a.callingPlayer === p) {
      if (a.type === 'kakan' || a.type === 'ankan') {
        // Self-kan: pairs with the preceding draw as draw slot, kan as discard slot
        pairs.push({ draw: pending ?? null, discard: { actionIdx: i, tile: a.calledTile ?? a.tiles?.[0], type: a.type, label: CALL_LABELS[a.type], riichi: false, tsumogiri: false } });
        pending = null;
      } else if (a.type === 'kan') {
        // Minkan: flush as its own draw-slot pair; rinshan draw follows in the next pair
        pairs.push({ draw: { actionIdx: i, tile: a.calledTile ?? a.tiles?.[0], type: a.type, label: CALL_LABELS[a.type] }, discard: null });
        pending = null;
      } else {
        pending = { actionIdx: i, tile: a.calledTile ?? a.tiles?.[0], type: a.type, label: CALL_LABELS[a.type] };
      }
    } else if ((a.type === 'discard' || a.type === 'call_discard' || a.type === 'riichi') && a.player === p) {
      pairs.push({ draw: pending ?? null, discard: { actionIdx: i, tile: a.tile, riichi: !!(a.riichi || a.type === 'riichi'), tsumogiri: !!a.tsumogiri } });
      pending = null;
    }
  }
  if (pending) pairs.push({ draw: pending, discard: null });
  return pairs;
}

export function phasePrompt(state, players) {
  switch (state.phase) {
    case Phase.DEAL:
      return { label: `Deal — ${players[state.dealStep]}'s hand`, hint: `Enter 13 tiles for ${players[state.dealStep]}.`, expects: 'hand', player: state.dealStep };
    case Phase.DRAW:
      return { label: `${players[state.currentPlayer]}'s Draw`, hint: 'Enter the drawn tile (e.g. 3m, 7p, 1z).', expects: 'tile', player: state.currentPlayer };
    case Phase.DISCARD:
      return { label: `${players[state.currentPlayer]}'s Discard`, hint: 'Enter tile to discard. Toggle Riichi before confirming if declaring.', expects: 'tile', player: state.currentPlayer };
    case Phase.CALL_WINDOW: {
      const wasRiichi = state.lastRiichiPlayer != null;
      return { label: 'Call Window', hint: `${players[state.callWindowPlayer]} discarded${wasRiichi ? ' (Riichi)' : ''}. Type next draw to pass, or use buttons to call.`, expects: 'call', discardingPlayer: state.callWindowPlayer, wasRiichi };
    }
    case Phase.CALL_DISCARD:
      return { label: `${players[state.currentPlayer]}'s Discard`, hint: 'Discard a tile after the call.', expects: 'tile', player: state.currentPlayer };
    case Phase.CHANKAN:
      return { label: 'Chankan', hint: `${players[state.callWindowPlayer ?? 0]} declared Kakan. Ron to rob the kan, or enter rinshan draw to pass.`, expects: 'call', discardingPlayer: state.callWindowPlayer };
    case Phase.COMPLETE: {
      const r = state.result;
      const desc = r?.type === 'tsumo' ? `${players[r.winner]} wins by Tsumo!`
                 : r?.type === 'ron'   ? `${players[r.winner]} wins by Ron!`
                 : 'Exhaustive Draw (Ryuukyoku)';
      return { label: 'Round Complete', hint: desc, expects: 'none' };
    }
    default: return { label: '', hint: '', expects: 'none' };
  }
}
