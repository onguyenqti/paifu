// Format: { title, name, rule, log }
//   log = [ round0, round1, … ]
//   roundN = [[round_number, honba_count, riichi_sticks], [scores],
//             [doras], [uradoras],
//             hand0, p0draws, p0discards,
//             hand1, p1draws, p1discards,
//             hand2, p2draws, p2discards,
//             hand3, p3draws, p3discards,
//             result]

import { computeRoundState } from './state.js';

export function gameToTenhouJSON(game, { pretty = false } = {}) {
  const log = game.rounds.map((round, ri) => roundToLog(round, ri));
  return JSON.stringify({
    title: game.meta.title ?? ['', ''],
    name:  game.meta.players,
    rule:  { disp: '東南戦', aka: 1 },
    log,
  }, null, pretty ? 2 : 0);
}

const CALL_TYPE_PREFIXES = { chi: 'c', pon: 'p', kan: 'k', kakan: 'm', ankan: 'a' };

function pointText(result) {
  const d = result.scoreDeltas;
  if (!d) return '';
  if (result.type === 'ron') return `${Math.abs(d[result.loser ?? result.winner])}点`;
  if (result.type === 'tsumo') {
    const payments = d.filter((_, i) => i !== result.winner).map(v => Math.abs(v)).filter(v => v > 0).sort((a, b) => a - b);
    const unique = [...new Set(payments)];
    return unique.length === 1 ? `${unique[0]}all点` : `${unique[0]}-${unique[1]}点`;
  }
  return '';
}

function resultToLog(result) {
  if (!result) return null;
  const combined = result.scoreDeltas ?? Array(4).fill(0);
  switch (result.type) {
    case 'tsumo': {
      const w = result.winner;
      const yakuStrs = (result.winners?.[0]?.yaku ?? []).map(y => `${y.name}(${y.han >= 13 ? '役満' : y.han + '飜'})`);
      return ['和了', [...combined], [w, w, w, pointText(result), ...yakuStrs]];
    }
    case 'ron': {
      const loser   = result.loser ?? -1;
      const winners = result.winners?.length ? result.winners : [{ player: result.winner }];
      const parts   = [];
      for (const winner of winners) {
        const w        = winner.player;
        const gain     = combined[w] ?? 0;
        const perDelta = combined.map((_, i) => i === w ? gain : i === loser ? -gain : 0);
        const yakuStrs = (winner.yaku ?? []).map(y => `${y.name}(${y.han >= 13 ? '役満' : y.han + '飜'})`);
        parts.push([...perDelta], [w, loser, w, `${gain}点`, ...yakuStrs]);
      }
      return ['和了', ...parts];
    }
    case 'draw_exhausted':
    case 'exhausted':
      return ['流局', [...combined]];
    default:
      return ['不明'];
  }
}

function parseYakuStr(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(.+)\((\d+飜|役満)\)$/);
  if (!m) return null;
  return { name: m[1], han: m[2] === '役満' ? 13 : parseInt(m[2], 10) };
}

function resultFromLog(raw) {
  if (!raw || !Array.isArray(raw)) return null;
  const type = raw[0];
  if (type === '和了') {
    const pairs = [];
    for (let i = 1; i + 1 < raw.length; i += 2) {
      const d = raw[i], det = raw[i + 1];
      if (Array.isArray(d) && Array.isArray(det)) pairs.push({ d, det });
      else break;
    }
    if (!pairs.length) return null;
    const [p0, p1] = pairs[0].det;
    const isTsumo  = p0 === p1;
    const loser    = isTsumo ? null : p1;
    const combined = Array(4).fill(0);
    for (const { d } of pairs) d.slice(0, 4).forEach((v, i) => { combined[i] += v; });
    return {
      type:    isTsumo ? 'tsumo' : 'ron',
      winner:  p0,
      winners: pairs.map(({ det }) => ({ player: det[0], yaku: det.slice(4).map(parseYakuStr).filter(Boolean) })),
      loser,
      tile:    null,
      scoreDeltas: combined,
    };
  }
  if (type === '流局') {
    return { type: 'draw_exhausted', scoreDeltas: Array.isArray(raw[1]) ? raw[1].slice(0, 4) : null };
  }
  return null;
}

// ── Export ────────────────────────────────────────────────────────────────────

// Build call string with prefix character position encoding the calling direction.
// For chi: prefix precedes the called tile in the sorted sequence.
// For pon/kan: prefix position = (calledFrom - callingPlayer + 4) % 4 - 1.
// For ankan: <tile><tile><tile>a<tile> (drawn tile last, 3 hand tiles first).
// For kakan: <tile>m<tile><tile><tile> (drawn/added tile first, 3 pon tiles after).
function callStr(a) {
  const parts = (a.tiles ?? []).map(t => String(t).padStart(2, '0'));
  const type  = a.type;
  if (type === 'ankan') return parts.slice(0, 3).join('') + 'a' + parts.slice(3).join('');
  if (type === 'kakan') return parts.slice(0, 1).join('') + 'm' + parts.slice(1).join('');
  if (type === 'chi') {
    const ct    = a.calledTile ?? a.tiles?.[0];
    const ctIdx = (a.tiles ?? []).indexOf(ct);
    const reordered = ctIdx >= 0
      ? [parts[ctIdx], ...parts.slice(0, ctIdx), ...parts.slice(ctIdx + 1)]
      : parts;
    return 'c' + reordered.join('');
  }
  const ch  = CALL_TYPE_PREFIXES[type] ?? 'p';
  const rel = a.calledFrom != null ? (a.calledFrom - a.callingPlayer + 4) % 4 : 3;
  const idx = Math.max(0, Math.min(parts.length - rel, parts.length - 1));
  return parts.slice(0, idx).join('') + ch + parts.slice(idx).join('');
}

// Build per-player draws/discards arrays in Tenhou format.
// Draw array:  wall draws (numbers) + chi/pon/minkan call strings.
// Discard array: discards (numbers), tsumogiri (60), riichi ("r<tile>"),
//                ankan/kakan strings (replace the discard slot for that turn).
function buildTenhouArrays(actions) {
  const players = [0, 1, 2, 3].map(() => ({ draws: [], discards: [] }));

  for (const a of actions) {
    switch (a.type) {
      case 'draw':
        players[a.player].draws.push(a.tile);
        break;

      case 'discard':
      case 'call_discard':
        if (a.riichi) {
          players[a.player].discards.push('r' + a.tile);
        } else {
          players[a.player].discards.push(a.tsumogiri ? 60 : a.tile);
        }
        break;

      case 'riichi':
        players[a.player].discards.push('r' + a.tile);
        break;

      case 'chi':
      case 'pon':
      case 'kan':
        players[a.callingPlayer].draws.push(callStr(a));
        break;

      case 'ankan':
      case 'kakan':
        players[a.callingPlayer].discards.push(callStr(a));
        break;
    }
  }

  return players;
}

function roundToLog(round, roundIndex) {
  const finalState = computeRoundState(round);

  const roundNumber = (round.roundWind != null)
    ? round.roundWind * 4 + round.roundNum
    : roundIndex;

  const arrays = buildTenhouArrays(round.actions);

  const playerData = [0, 1, 2, 3].flatMap(p => [
    finalState.hands[p].startingTiles,
    arrays[p].draws,
    arrays[p].discards,
  ]);

  return [
    [roundNumber, round.honba ?? 0, round.initialRiichiSticks ?? 0],
    round.initialScores ?? [25000, 25000, 25000, 25000],
    finalState.doraIndicators,
    finalState.uraDoraIndicators,
    ...playerData,
    resultToLog(finalState.result),
  ];
}

// ── Import ────────────────────────────────────────────────────────────────────

// Parse a call string with embedded prefix character encoding calling direction.
function parseCallStr(s, callingPlayer) {
  const prefixIdx = s.search(/[^0-9]/);
  if (prefixIdx < 0) return null;
  const ch   = s[prefixIdx];
  const type = ch === 'c' ? 'chi' : ch === 'p' ? 'pon' : ch === 'k' ? 'kan' : ch === 'm' ? 'kakan' : 'ankan';
  const tileStr = s.slice(0, prefixIdx) + s.slice(prefixIdx + 1);
  const tiles = [];
  for (let i = 0; i < tileStr.length; i += 2) tiles.push(parseInt(tileStr.slice(i, i + 2), 10));
  const calledTileIdx = prefixIdx / 2;
  const calledTile = tiles[calledTileIdx] ?? tiles[0];
  let calledFrom = null;
  if (type === 'chi') calledFrom = (callingPlayer + 3) % 4;
  else if (type === 'pon' || type === 'kan') calledFrom = (callingPlayer + tiles.length - calledTileIdx) % 4;
  return { type, tiles, calledTile, calledTileIdx, calledFrom };
}

// Reconstruct actions in chronological order from per-player Tenhou arrays.
// Each player's draws[i] and discs[i] are paired: a draw + its corresponding discard.
// Discard slots may hold: number, 60 (tsumogiri), "r<n>" (riichi), or ankan/kakan string.
function buildRoundActions(players, dealer) {
  const actions = [];
  const cursor = [0, 0, 0, 0];  // shared index into both rawDraws[p] and rawDiscs[p]
  let cur = dealer;

  // After emitting a discard, find which player acts next:
  // the first other player whose next draw entry is a call string (chi/pon/minkan)
  // whose calledTile matches the tile just discarded.
  const nextAfterDiscard = (discardedTile) => {
    for (let rel = 1; rel <= 3; rel++) {
      const cp  = (cur + rel) % 4;
      const nxt = players[cp].rawDraws[cursor[cp]];
      if (typeof nxt === 'string') {
        const nc = parseCallStr(nxt, cp);
        if (nc && nc.type !== 'ankan' && nc.type !== 'kakan' && nc.calledTile === discardedTile && nc.calledFrom === cur) return cp;
      }
    }
    return (cur + 1) % 4;
  };

  for (;;) {
    const drawEntry = players[cur].rawDraws[cursor[cur]];
    if (drawEntry === undefined) break;
    const discEntry = players[cur].rawDiscs[cursor[cur]];
    cursor[cur]++;

    if (typeof drawEntry === 'string') {
      // Chi / pon / minkan kan: called from another player's discard
      const call = parseCallStr(drawEntry, cur);
      if (!call) { cur = (cur + 1) % 4; continue; }
      const fromHand = call.tiles.filter((_, i) => i !== call.calledTileIdx);
      actions.push({ type: call.type, callingPlayer: cur, tiles: call.tiles,
                     calledTile: call.calledTile, calledFrom: call.calledFrom, fromHand });
      if (call.type !== 'kan') {
        // chi / pon: emit the post-call discard
        if (typeof discEntry === 'number') {
          const tile = discEntry === 60 ? call.calledTile : discEntry;
          if (tile != null) {
            actions.push({ type: 'discard', player: cur, tile, tsumogiri: false });
            cur = nextAfterDiscard(tile);
          } else {
            cur = (cur + 1) % 4;
          }
        } else {
          cur = (cur + 1) % 4;
        }
      }
      // minkan: same player stays for rinshan draw (no discard at this cursor position)
      continue;
    }

    // Wall draw
    actions.push({ type: 'draw', player: cur, tile: drawEntry });

    if (typeof discEntry === 'string') {
      const rMatch = discEntry.match(/^r(\d+)$/);
      if (rMatch) {
        // Riichi discard
        const rTile = parseInt(rMatch[1], 10);
        actions.push({ type: 'discard', player: cur, tile: rTile, riichi: true });
        actions.push({ type: 'pass' });
        cur = nextAfterDiscard(rTile);
      } else {
        // Ankan or kakan: replaces the discard slot for this turn
        const call = parseCallStr(discEntry, cur);
        if (call && (call.type === 'ankan' || call.type === 'kakan')) {
          const fromHand = call.type === 'ankan' ? [...call.tiles] : [call.calledTile];
          actions.push({ type: call.type, callingPlayer: cur, tiles: call.tiles,
                         calledTile: call.calledTile, calledFrom: null, fromHand });
          actions.push({ type: 'pass' });  // advance CHANKAN → DRAW for rinshan
          // same player stays for rinshan (next cursor position)
        }
      }
      continue;
    }

    // Regular discard: number or 60 (tsumogiri)
    if (discEntry === undefined) { cur = (cur + 1) % 4; continue; }
    const tile = discEntry === 60 ? drawEntry : discEntry;
    actions.push({ type: 'discard', player: cur, tile, tsumogiri: discEntry === 60 });
    cur = nextAfterDiscard(tile);
  }

  return actions;
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
  };

  for (const entry of (data.log ?? [])) {
    const [[roundNumber, honba, riichiSticks], scores, doras, uraDoras,
           h0, d0, disc0, h1, d1, disc1,
           h2, d2, disc2, h3, d3, disc3,
           result] = entry;

    const roundWind = Math.floor((roundNumber ?? game.rounds.length) / 4);
    const roundNum  = (roundNumber ?? game.rounds.length) % 4;
    const dealer    = roundNum;

    const players = [
      { starting: h0 ?? [], rawDraws: d0    ?? [], rawDiscs: disc0 ?? [] },
      { starting: h1 ?? [], rawDraws: d1    ?? [], rawDiscs: disc1 ?? [] },
      { starting: h2 ?? [], rawDraws: d2    ?? [], rawDiscs: disc2 ?? [] },
      { starting: h3 ?? [], rawDraws: d3    ?? [], rawDiscs: disc3 ?? [] },
    ];

    const actions = [];

    for (let p = 0; p < 4; p++) {
      actions.push({ type: 'deal', player: p, tiles: players[p].starting });
    }

    for (const a of buildRoundActions(players, dealer)) actions.push(a);

    const parsedResult = resultFromLog(result);
    if (parsedResult) {
      // Find the winning tile from the reconstructed actions since Tenhou doesn't store it.
      const lastTileFor = (p, types) => {
        for (let i = actions.length - 1; i >= 0; i--) {
          const a = actions[i];
          if (types.includes(a.type) && (a.player === p || a.callingPlayer === p)) return a.tile;
        }
        return null;
      };
      if (parsedResult.type === 'tsumo') {
        const tile = lastTileFor(parsedResult.winner, ['draw']) ?? 0;
        actions.push({ type: 'tsumo', player: parsedResult.winner, tile,
                       winners: parsedResult.winners, scoreDeltas: parsedResult.scoreDeltas });
      } else if (parsedResult.type === 'ron') {
        const tile = lastTileFor(parsedResult.loser, ['discard']) ?? 0;
        actions.push({ type: 'ron', winner: parsedResult.winner, loser: parsedResult.loser,
                       tile, winners: parsedResult.winners, scoreDeltas: parsedResult.scoreDeltas });
      } else if (parsedResult.type === 'draw_exhausted') {
        actions.push({ type: 'draw_exhausted', scoreDeltas: parsedResult.scoreDeltas });
      }
    }

    game.rounds.push({
      dealer,
      honba:               honba        ?? 0,
      initialRiichiSticks: riichiSticks ?? 0,
      initialScores:       [...(scores  ?? Array(4).fill(25000))],
      doraIndicators:      [...(doras   ?? [])],
      uraDoraIndicators:   [...(uraDoras ?? [])],
      actions,
      roundWind,
      roundNum,
    });
  }

  return game;
}
