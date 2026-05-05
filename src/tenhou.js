// Format: { title, name, rule, log }
//   log = [ round0, round1, … ]
//   roundN = [[round_number, honba_count, riichi_sticks], [scores],
//             [doras], [uradoras],
//             hand0, p0draws, p0discards,
//             hand1, p1draws, p1discards,
//             hand2, p2draws, p2discards,
//             hand3, p3draws, p3discards,
//             result]
//
//   round_number = roundWind * 4 + roundNum  (East1=0, East2=1, … South1=4 …)
//   handN        = starting tile array
//   pNdraws      = drawn tile codes; may include call strings e.g. "c131415"
//   pNdiscards   = discarded tile codes; 60 = tsumogiri (discard the drawn tile)
//   result       = { type, winner, loser, tile, scoreDeltas, finalScores } | null

export function gameToTenhouJSON(game, { pretty = false } = {}) {
  const log = game.rounds.map(roundToLog);
  return JSON.stringify({
    title: game.meta.title ?? ['', ''],
    name:  game.meta.players,
    rule:  { disp: '東南戦', aka: 1 },
    log,
  }, null, pretty ? 2 : 0);
}

const CALL_TYPE_PREFIXES = { chi: 'c', pon: 'p', kan: 'k', kakan: 'm', ankan: 'a' };

function callActionToString(action) {
  const prefix = CALL_TYPE_PREFIXES[action.type];
  return prefix + action.tiles.map(t => String(t).padStart(2, '0')).join('');
}

function roundToLog(round) {
  const roundNumber = round.roundWind * 4 + round.roundNum;

  const playerData = [0, 1, 2, 3].flatMap(p => {
    // Draws array: wall draws and calls interleaved in turn order, matching the discard array.
    const draws = round.actions
      .filter(a =>
        (a.type === 'draw' && a.player === p) ||
        (a.type in CALL_TYPE_PREFIXES && a.callingPlayer === p)
      )
      .map(a => a.type === 'draw' ? a.tile : callActionToString(a));
    const discardActions = round.actions.filter(
      a => (a.type === 'discard' || a.type === 'call_discard' || a.type === 'riichi') && a.player === p
    );
    const discards = round.hands[p].discards.map((tile, i) =>
      discardActions[i]?.tsumogiri ? 60 : tile
    );
    return [round.hands[p].startingTiles, draws, discards];
  });

  const result = round.result
    ? {
        type:        round.result.type,
        winner:      round.result.winner,
        loser:       round.result.loser,
        tile:        round.result.tile,
        scoreDeltas: round.result.scoreDeltas ?? null,
        finalScores: round.result.finalScores ?? null,
      }
    : null;

  return [
    [roundNumber, round.honba, round.riichiSticks],
    round.scores,
    round.doraIndicators,
    round.uraDoraIndicators,
    ...playerData,
    result,
  ];
}

export function tenhouJSONToGame(jsonStr) {
  const data = JSON.parse(jsonStr);
  const game = {
    meta: {
      players: data.name  ?? ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
      title:   data.title ?? ['', ''],
      rules:   { rounds: 'east-south', basePoints: 25000 },
    },
    rounds: [],
    phase:     'COMPLETE',
    setupStep: 1,
  };

  for (const entry of (data.log ?? [])) {
    const [[roundNumber, honba, riichiSticks], scores, doras, uraDoras,
           h0, d0, disc0, h1, d1, disc1,
           h2, d2, disc2, h3, d3, disc3,
           result] = entry;

    // Parse a call string like "c131415", "p272727", "k11111111"
    // c=chi, p=pon, k=open kan, m=kakan (added kan), a=ankan (closed kan)
    const parseCall = (s, callingPlayer) => {
      const c = s[0];
      const tiles = [];
      for (let i = 1; i < s.length; i += 2) tiles.push(parseInt(s.slice(i, i + 2), 10));
      const type = c === 'c' ? 'chi' : c === 'p' ? 'pon'
                 : c === 'k' ? 'kan' : c === 'm' ? 'kakan' : 'ankan';
      const fromHandCount = c === 'a' ? 4 : c === 'k' ? 3 : 2;
      // Chi is always called from kamicha (player to the left, i.e. (p+3)%4)
      const calledFrom = c === 'c' ? (callingPlayer + 3) % 4 : null;
      return { type, tiles, fromHandCount, calledFrom };
    };

    // Keep rawDraws intact so position i in draws aligns with position i in discards.
    // Tsumogiri (60) means "discard the tile drawn this turn" — use rawDraws[i] to resolve it.
    const processPlayer = (starting, rawDraws, rawDiscs) => {
      const rds  = rawDraws ?? [];
      const rdsc = rawDiscs ?? [];
      const discards = rdsc.map((t, i) =>
        t === 60 ? (typeof rds[i] === 'number' ? rds[i] : null) : t
      ).filter(t => typeof t === 'number' && t !== null);
      return { starting: starting ?? [], rawDraws: rds, rawDiscs: rdsc, discards };
    };

    const players = [
      processPlayer(h0, d0, disc0),
      processPlayer(h1, d1, disc1),
      processPlayer(h2, d2, disc2),
      processPlayer(h3, d3, disc3),
    ];

    // Build hands: replay draws/calls/discards in turn order to derive current tiles and melds
    const hands = players.map(({ starting, rawDraws, discards }, p) => {
      const tiles = [...starting];
      const melds = [];
      const turnCount = Math.max(rawDraws.length, discards.length);
      for (let i = 0; i < turnCount; i++) {
        const draw = rawDraws[i];
        if (typeof draw === 'string') {
          const call = parseCall(draw, p);
          let removed = 0;
          for (const t of call.tiles) {
            if (removed >= call.fromHandCount) break;
            const idx = tiles.indexOf(t);
            if (idx !== -1) { tiles.splice(idx, 1); removed++; }
          }
          melds.push({ type: call.type, tiles: call.tiles, calledFrom: call.calledFrom });
        } else if (typeof draw === 'number') {
          tiles.push(draw);
        }
        if (i < discards.length) {
          const idx = tiles.indexOf(discards[i]);
          if (idx !== -1) tiles.splice(idx, 1);
        }
      }
      return {
        startingTiles: [...starting],
        tiles,
        melds,
        discards,
        inRiichi:   false,
        riichiTurn: -1,
      };
    });

    // Build actions: draw, call, and discard actions per player (with tsumogiri flag)
    const actions = [];
    for (let p = 0; p < 4; p++) {
      const { rawDraws, rawDiscs } = players[p];
      const len = Math.max(rawDraws.length, rawDiscs.length);
      for (let i = 0; i < len; i++) {
        const draw = rawDraws[i];
        if (typeof draw === 'string') {
          const call = parseCall(draw, p);
          actions.push({ type: call.type, callingPlayer: p, tiles: call.tiles, calledFrom: call.calledFrom });
        } else if (typeof draw === 'number') {
          actions.push({ type: 'draw', player: p, tile: draw });
        }
        if (i < rawDiscs.length) {
          const raw = rawDiscs[i];
          const tile = raw === 60
            ? (typeof draw === 'number' ? draw : null)
            : (typeof raw === 'number' ? raw : null);
          if (tile !== null)
            actions.push({ type: 'discard', player: p, tile, tsumogiri: raw === 60 });
        }
      }
    }

    const roundWind = Math.floor((roundNumber ?? game.rounds.length) / 4);
    const roundNum  = (roundNumber ?? game.rounds.length) % 4;

    game.rounds.push({
      dealer:            0,
      honba:             honba        ?? 0,
      riichiSticks:      riichiSticks ?? 0,
      roundWind,
      roundNum,
      scores:            [...(scores ?? Array(4).fill(25000))],
      doraIndicators:    [...(doras    ?? [])],
      uraDoraIndicators: [...(uraDoras ?? [])],
      hands,
      actions,
      result:            result ?? null,
      _currentPlayer:    0,
      _callWindowPlayer: null,
      _callingPlayer:    null,
      _dealStep:         4,
    });
  }

  return game;
}
