// Tenhou-compatible JSON export/import
//
// Tile encoding (Tenhou standard):
//   Man:    11-19    Pin:    21-29    Sou:    31-39
//   Honors: 41-47    Aka:    51(0m) 52(0p) 53(0s)
//
// Log format (per hand):
//   [scores, [honba,riichi], [doras], hand0, hand1, hand2, hand3,
//    p0actions, p1actions, p2actions, p3actions, result]
//
//   Each pNactions array contains interleaved draw/discard events:
//     { t: tile }           → draw
//     { d: tile }           → discard
//     { r: tile }           → riichi discard
//     { c: tiles, f: from } → chi (tiles=full set, f=from player idx)
//     { p: tiles, f: from } → pon
//     { k: tiles, f: from, kt: type } → kan (type: 'closed'|'open'|'added')
//     { w: tile, wt: 'tsumo'|'ron', wf: from? } → win


export function gameToTenhouJSON(game) {
  const log = game.rounds.map(roundToLog);
  return JSON.stringify({
    title: ['', ''],
    name: game.meta.players,
    rule: {
      disp: '東南戦',
      aka:  1,
    },
    log,
  }, null, 2);
}

function roundToLog(round) {
  const playerActions = [[], [], [], []];

  for (const action of round.actions) {
    const p = action.player ?? action.callingPlayer ?? 0;
    switch (action.type) {
      case 'draw':
        playerActions[p].push({ t: action.tile });
        break;
      case 'discard':
        playerActions[p].push({ d: action.tile });
        break;
      case 'riichi':
        playerActions[p].push({ r: action.tile });
        break;
      case 'call_discard':
        playerActions[p].push({ d: action.tile });
        break;
      case 'chi':
        playerActions[action.callingPlayer].push({
          c: action.tiles,
          f: action.calledFrom,
        });
        break;
      case 'pon':
        playerActions[action.callingPlayer].push({
          p: action.tiles,
          f: action.calledFrom,
        });
        break;
      case 'kan':
        playerActions[action.callingPlayer].push({
          k: action.tiles,
          f: action.calledFrom ?? -1,
          kt: action.kanType,
        });
        break;
      case 'tsumo':
        playerActions[p].push({ t: action.tile, w: action.tile, wt: 'tsumo' });
        break;
      case 'ron':
        playerActions[action.winner].push({
          w: action.tile, wt: 'ron', wf: action.loser,
        });
        break;
      case 'add_dora':
      case 'add_ura_dora':
      case 'pass':
      case 'draw_exhausted':
        break;
    }
  }

  const result = round.result
    ? {
        type: round.result.type,
        winner: round.result.winner,
        loser:  round.result.loser,
        tile:   round.result.tile,
      }
    : null;

  return [
    round.scores,
    [round.honba, round.riichiSticks],
    round.doraIndicators,
    round.hands[0].tiles,
    round.hands[1].tiles,
    round.hands[2].tiles,
    round.hands[3].tiles,
    playerActions[0],
    playerActions[1],
    playerActions[2],
    playerActions[3],
    result,
  ];
}

export function tenhouJSONToGame(jsonStr) {
  const data = JSON.parse(jsonStr);
  const game = {
    meta: {
      players: data.name ?? ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
      rules: { rounds: 'east-south', basePoints: 25000 },
    },
    rounds: [],
    phase: 'COMPLETE',
    setupStep: 1,
  };

  for (const entry of (data.log ?? [])) {
    const [scores, [honba, riichiSticks], doras, h0, h1, h2, h3,
           a0, a1, a2, a3, result] = entry;

    const hands = [h0, h1, h2, h3].map((tiles) => ({
      tiles:      [...(tiles ?? [])],
      melds:      [],
      discards:   [],
      inRiichi:   false,
      riichiTurn: -1,
    }));

    const actions = reconstructActions(a0, a1, a2, a3);

    game.rounds.push({
      dealer:            0,
      honba:             honba ?? 0,
      riichiSticks:      riichiSticks ?? 0,
      roundWind:         Math.floor(game.rounds.length / 4),
      roundNum:          game.rounds.length % 4,
      scores:            [...(scores ?? [25000, 25000, 25000, 25000])],
      doraIndicators:    [...(doras ?? [])],
      uraDoraIndicators: [],
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

function reconstructActions(a0, a1, a2, a3) {
  const actions = [];
  for (let p = 0; p < 4; p++) {
    const pActions = [a0, a1, a2, a3][p] ?? [];
    for (const ev of pActions) {
      if (ev.wt === 'tsumo') {
        actions.push({ type: 'tsumo', player: p, tile: ev.t });
      } else if (ev.wt === 'ron') {
        actions.push({ type: 'ron', winner: p, loser: ev.wf, tile: ev.w });
      } else if (ev.t !== undefined) {
        actions.push({ type: 'draw', player: p, tile: ev.t });
      } else if (ev.r !== undefined) {
        actions.push({ type: 'riichi', player: p, tile: ev.r });
      } else if (ev.d !== undefined) {
        actions.push({ type: 'discard', player: p, tile: ev.d });
      } else if (ev.c !== undefined) {
        actions.push({ type: 'chi', callingPlayer: p, calledFrom: ev.f, tiles: ev.c, fromHand: [], calledTile: ev.c[0] });
      } else if (ev.p !== undefined) {
        actions.push({ type: 'pon', callingPlayer: p, calledFrom: ev.f, tiles: ev.p, fromHand: [], calledTile: ev.p[0] });
      } else if (ev.k !== undefined) {
        actions.push({ type: 'kan', callingPlayer: p, calledFrom: ev.f, tiles: ev.k, kanType: ev.kt, fromHand: [], calledTile: ev.k[0] });
      }
    }
  }
  return actions;
}
