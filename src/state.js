// Game state machine for mahjong paifu recording

export const Phase = {
  SETUP:         'SETUP',         // Input player names + dora
  DEAL:          'DEAL',          // Input starting hands (one player at a time)
  DRAW:          'DRAW',          // Current player draws a tile
  DISCARD:       'DISCARD',       // Current player discards (or declares tsumo)
  CALL_WINDOW:   'CALL_WINDOW',   // After discard: other players may call
  CALL_DISCARD:  'CALL_DISCARD',  // After a call: caller must discard
  COMPLETE:      'COMPLETE',      // Hand finished
};

export const WIND_NAMES   = ['East', 'South', 'West', 'North'];
export const PLAYER_WINDS = ['East', 'South', 'West', 'North']; // seat winds

export function createGame(playerNames = ['Player 1', 'Player 2', 'Player 3', 'Player 4']) {
  return {
    meta: {
      players: [...playerNames],
      title: ['', ''],
      rules: { rounds: 'east-south', basePoints: 25000 },
    },
    rounds: [],
    phase: Phase.SETUP,
    setupStep: 0, // 0=awaiting player names, 1=all set
  };
}

function emptyHand() {
  return { startingTiles: [], tiles: [], melds: [], discards: [], inRiichi: false, riichiTurn: -1 };
}

export function startRound(game, { dealer, honba, riichiSticks, scores, doraIndicator }) {
  const round = {
    dealer,
    honba:        honba        ?? 0,
    riichiSticks: riichiSticks ?? 0,
    roundWind: Math.floor(game.rounds.length / 4),
    roundNum:  game.rounds.length % 4,          // 0-3 within the wind
    scores: scores ? [...scores] : Array(4).fill(game.meta.rules.basePoints),
    doraIndicators:    doraIndicator ? [doraIndicator] : [],
    uraDoraIndicators: [],
    hands: [emptyHand(), emptyHand(), emptyHand(), emptyHand()],
    actions: [],
    result: null,
    // transient during data entry
    _dealStep: 0,        // which player's hand we're filling (0-3)
    _currentPlayer: dealer,
    _callWindowPlayer: null, // who just discarded
    _callingPlayer: null,    // who is making a call
  };
  game.rounds.push(round);
  game.phase = Phase.DEAL;
}

export function currentRound(game) {
  return game.rounds[game.rounds.length - 1] ?? null;
}

// Apply a validated action to the current round and advance the phase.
// Returns the updated game (mutated in place for simplicity).
export function applyAction(game, action) {
  const round = currentRound(game);
  if (!round) return game;

  const hand = round.hands[action.player];
  round.actions.push({ ...action });

  switch (action.type) {
    case 'draw': {
      hand.tiles.push(action.tile);
      game.phase = Phase.DISCARD;
      break;
    }

    case 'discard': {
      const idx = hand.tiles.lastIndexOf(action.tile);
      if (idx !== -1) hand.tiles.splice(idx, 1);
      hand.discards.push(action.tile);
      round._callWindowPlayer = action.player;
      game.phase = Phase.CALL_WINDOW;
      break;
    }

    case 'pass': {
      // No calls; advance to next player
      const next = (round._callWindowPlayer + 1) % 4;
      round._currentPlayer = next;
      round._callWindowPlayer = null;
      game.phase = Phase.DRAW;
      break;
    }

    case 'chi':
    case 'pon': {
      // fromHand: tiles removed from caller's hand
      const caller = round.hands[action.callingPlayer];
      for (const t of action.fromHand) {
        const i = caller.tiles.lastIndexOf(t);
        if (i !== -1) caller.tiles.splice(i, 1);
      }
      caller.melds.push({
        type: action.type,
        tiles: action.tiles, // full set including called tile
        calledFrom: action.calledFrom,
        calledTile: action.calledTile,
      });
      round._currentPlayer = action.callingPlayer;
      round._callingPlayer = null;
      round._callWindowPlayer = null;
      game.phase = Phase.CALL_DISCARD;
      break;
    }

    case 'kan': {
      const caller = round.hands[action.callingPlayer];
      for (const t of action.fromHand) {
        const i = caller.tiles.lastIndexOf(t);
        if (i !== -1) caller.tiles.splice(i, 1);
      }
      caller.melds.push({
        type: 'kan',
        kanType: action.kanType,
        tiles: action.tiles,
        calledFrom: action.calledFrom,
        calledTile: action.calledTile,
      });
      if (action.newDora) round.doraIndicators.push(action.newDora);
      // After kan the calling player draws a rinshan tile (goes back to DRAW)
      round._currentPlayer = action.callingPlayer;
      round._callingPlayer = null;
      round._callWindowPlayer = null;
      game.phase = Phase.DRAW;
      break;
    }

    case 'call_discard': {
      // Alias for a discard that happens after a call
      const idx = hand.tiles.lastIndexOf(action.tile);
      if (idx !== -1) hand.tiles.splice(idx, 1);
      hand.discards.push(action.tile);
      round._callWindowPlayer = action.player;
      game.phase = Phase.CALL_WINDOW;
      break;
    }

    case 'riichi': {
      hand.inRiichi = true;
      hand.riichiTurn = round.actions.length - 1;
      round.riichiSticks = (round.riichiSticks || 0) + 1;
      // Mark the tile as riichi discard
      const ridx = hand.tiles.lastIndexOf(action.tile);
      if (ridx !== -1) hand.tiles.splice(ridx, 1);
      hand.discards.push(action.tile);
      round._callWindowPlayer = action.player;
      game.phase = Phase.CALL_WINDOW;
      break;
    }

    case 'tsumo': {
      hand.tiles.push(action.tile);
      const tsumoFinal = action.scoreDeltas
        ? round.scores.map((s, i) => s + action.scoreDeltas[i])
        : [...round.scores];
      round.result = {
        type: 'tsumo',
        winner: action.player,
        winners: action.winners ?? [{ player: action.player, yaku: [] }],
        tile: action.tile,
        scoreDeltas: action.scoreDeltas ?? null,
        finalScores: tsumoFinal,
      };
      game.phase = Phase.COMPLETE;
      break;
    }

    case 'ron': {
      const ronFinal = action.scoreDeltas
        ? round.scores.map((s, i) => s + action.scoreDeltas[i])
        : [...round.scores];
      round.result = {
        type: 'ron',
        winner: action.winner,
        winners: action.winners ?? [{ player: action.winner }],
        loser: action.loser,
        tile: action.tile,
        scoreDeltas: action.scoreDeltas ?? null,
        finalScores: ronFinal,
      };
      game.phase = Phase.COMPLETE;
      break;
    }

    case 'draw_exhausted': {
      round.result = { type: 'draw' };
      game.phase = Phase.COMPLETE;
      break;
    }

    case 'add_dora': {
      round.doraIndicators.push(action.tile);
      break;
    }

    case 'add_ura_dora': {
      round.uraDoraIndicators.push(action.tile);
      break;
    }
  }

  return game;
}

export function phasePrompt(game) {
  const round = currentRound(game);
  switch (game.phase) {
    case Phase.SETUP:
      return {
        label: 'No game in progress',
        hint: 'Click "New Game" to start recording a hand.',
        expects: 'none',
      };
    case Phase.DEAL: {
      const pIdx = round._dealStep;
      return {
        label: `Dealing — ${game.meta.players[pIdx]}'s hand`,
        hint: `Enter 13 tiles for ${game.meta.players[pIdx]}. Use shorthand like 123m456p789s1234z or space-separated: 1m 2m 3p …`,
        expects: 'hand',
        player: pIdx,
      };
    }
    case Phase.DRAW: {
      const p = round._currentPlayer;
      return {
        label: `${game.meta.players[p]}'s Draw`,
        hint: 'Enter the drawn tile (e.g. 3m, 7p, E). Press Tsumo instead of confirming if it completes the hand.',
        expects: 'tile',
        player: p,
      };
    }
    case Phase.DISCARD: {
      const p = round._currentPlayer;
      return {
        label: `${game.meta.players[p]}'s Discard`,
        hint: 'Enter the tile to discard. Use Riichi button before confirming if declaring riichi.',
        expects: 'tile',
        player: p,
      };
    }
    case Phase.CALL_WINDOW: {
      const p = round._callWindowPlayer;
      const tile = round.hands[p].discards.at(-1);
      return {
        label: 'Call Window',
        hint: `${game.meta.players[p]} discarded. Any player may call: Chi, Pon, Kan, or Ron. Press Pass to continue.`,
        expects: 'call',
        discardingPlayer: p,
        discardedTile: tile,
      };
    }
    case Phase.CALL_DISCARD: {
      const p = round._currentPlayer;
      return {
        label: `${game.meta.players[p]}'s Discard (after call)`,
        hint: 'Enter the tile to discard after the call.',
        expects: 'tile',
        player: p,
      };
    }
    case Phase.COMPLETE: {
      const r = round.result;
      let desc = '';
      if (r.type === 'tsumo') desc = `${game.meta.players[r.winner]} wins by Tsumo!`;
      else if (r.type === 'ron') desc = `${game.meta.players[r.winner]} wins by Ron from ${game.meta.players[r.loser]}!`;
      else desc = 'Exhaustive Draw (Ryuukyoku)';
      return { label: 'Hand Complete', hint: desc, expects: 'none' };
    }
    default:
      return { label: '', hint: '', expects: 'none' };
  }
}
