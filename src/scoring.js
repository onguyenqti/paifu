// ── Yaku definitions ───────────────────────────────────────────────────────────
// han: closed hand value   hanOpen: open hand value (null = closed-only)

export const YAKU = [
  // 1-han closed only
  { id: 'riichi',        name: 'Riichi',            jp: '立直',       han: 1,  hanOpen: null },
  { id: 'ippatsu',       name: 'Ippatsu',           jp: '一発',       han: 1,  hanOpen: null },
  { id: 'menzentsumo',   name: 'Menzen Tsumo',      jp: '門前清自摸和', han: 1,  hanOpen: null, tsumoOnly: true },
  { id: 'pinfu',         name: 'Pinfu',             jp: '平和',       han: 1,  hanOpen: null, fuOverride: 20 },
  { id: 'iipeiko',       name: 'Iipeiko',           jp: '一盃口',     han: 1,  hanOpen: null },
  // 1-han open ok
  { id: 'tanyao',        name: 'Tanyao',            jp: '断么九',     han: 1,  hanOpen: 1 },
  { id: 'haitei',        name: 'Haitei',            jp: '海底撈月',   han: 1,  hanOpen: 1,    tsumoOnly: true },
  { id: 'houtei',        name: 'Houtei',            jp: '河底撈魚',   han: 1,  hanOpen: 1,    tsumoOnly: false },
  { id: 'rinshan',       name: 'Rinshan',           jp: '嶺上開花',   han: 1,  hanOpen: 1 },
  { id: 'chankan',       name: 'Chankan',           jp: '槍槓',       han: 1,  hanOpen: 1 },
  { id: 'haku',          name: 'Haku',              jp: '白',         han: 1,  hanOpen: 1 },
  { id: 'hatsu',         name: 'Hatsu',             jp: '発',         han: 1,  hanOpen: 1 },
  { id: 'chun',          name: 'Chun',              jp: '中',         han: 1,  hanOpen: 1 },
  { id: 'seatwind',      name: 'Seat Wind',         jp: '自風',       han: 1,  hanOpen: 1 },
  { id: 'roundwind',     name: 'Round Wind',        jp: '場風',       han: 1,  hanOpen: 1 },
  // 2-han
  { id: 'daburi',        name: 'Double Riichi',     jp: 'ダブル立直', han: 2,  hanOpen: null },
  { id: 'chiitoitsu',    name: 'Chiitoitsu',        jp: '七対子',     han: 2,  hanOpen: null, fuOverride: 25 },
  { id: 'ittsu',         name: 'Ittsu',             jp: '一気通貫',   han: 2,  hanOpen: 1 },
  { id: 'sanshokudoujun',name: 'San Shoku Doujun',  jp: '三色同順',   han: 2,  hanOpen: 1 },
  { id: 'sanshokudoukou',name: 'San Shoku Doukou',  jp: '三色同刻',   han: 2,  hanOpen: 2 },
  { id: 'sanankou',      name: 'San Ankou',         jp: '三暗刻',     han: 2,  hanOpen: 2 },
  { id: 'toitoi',        name: 'Toitoi',            jp: '対々和',     han: 2,  hanOpen: 2 },
  { id: 'chanta',        name: 'Chanta',            jp: '混全帯么九', han: 2,  hanOpen: 1 },
  { id: 'sankantsu',     name: 'Sankantsu',         jp: '三槓子',     han: 2,  hanOpen: 2 },
  // 3-han
  { id: 'honitsu',       name: 'Honitsu',           jp: '混一色',     han: 3,  hanOpen: 2 },
  { id: 'junchan',       name: 'Junchan',           jp: '純全帯么九', han: 3,  hanOpen: 2 },
  { id: 'ryanpeiko',     name: 'Ryanpeiko',         jp: '二盃口',     han: 3,  hanOpen: null },
  // 6-han
  { id: 'chinitsu',      name: 'Chinitsu',          jp: '清一色',     han: 6,  hanOpen: 5 },
  // Yakuman
  { id: 'kokushi',       name: 'Kokushi',           jp: '国士無双',   han: 13, hanOpen: null },
  { id: 'suuankou',      name: 'Suuankou',          jp: '四暗刻',     han: 13, hanOpen: null },
  { id: 'daisangen',     name: 'Daisangen',         jp: '大三元',     han: 13, hanOpen: 13 },
  { id: 'shousuushi',    name: 'Shousuushi',        jp: '小四喜',     han: 13, hanOpen: 13 },
  { id: 'daisuushi',     name: 'Daisuushi',         jp: '大四喜',     han: 13, hanOpen: 13 },
  { id: 'tsuuiisou',     name: 'Tsuuiisou',         jp: '字一色',     han: 13, hanOpen: 13 },
  { id: 'ryuuiisou',     name: 'Ryuuiisou',         jp: '緑一色',     han: 13, hanOpen: 13 },
  { id: 'chinroutou',    name: 'Chinroutou',        jp: '清老頭',     han: 13, hanOpen: 13 },
  { id: 'chuurenpoutou', name: 'Chuuren Poutou',    jp: '九蓮宝燈',   han: 13, hanOpen: null },
  { id: 'suukantsu',     name: 'Suukantsu',         jp: '四槓子',     han: 13, hanOpen: 13 },
  { id: 'tenhou',        name: 'Tenhou',            jp: '天和',       han: 13, hanOpen: null },
  { id: 'chihou',        name: 'Chihou',            jp: '地和',       han: 13, hanOpen: null },
];

// ── Han total ──────────────────────────────────────────────────────────────────

export function totalHan(selectedIds, isOpen) {
  let total = 0;
  for (const id of selectedIds) {
    const y = YAKU.find(y => y.id === id);
    if (!y) continue;
    const h = isOpen ? y.hanOpen : y.han;
    if (h !== null) total += h;
  }
  return total;
}

// Fu override from selected yaku (chiitoitsu → 25, pinfu → 20/30)
export function fuOverride(selectedIds) {
  for (const id of selectedIds) {
    const y = YAKU.find(y => y.id === id);
    if (y?.fuOverride !== undefined) return y.fuOverride;
  }
  return null;
}

// ── Point limits ───────────────────────────────────────────────────────────────

const LIMITS = {
  mangan:     { basic: 2000 },
  haneman:    { basic: 3000 },
  baiman:     { basic: 4000 },
  sanbaiman:  { basic: 6000 },
  yakuman:    { basic: 8000 },
};

export function limitName(han, basicPoints) {
  if (han >= 13) return 'Yakuman';
  if (han >= 11) return 'Sanbaiman';
  if (han >= 8)  return 'Baiman';
  if (han >= 6)  return 'Haneman';
  if (han >= 5 || basicPoints >= 2000) return 'Mangan';
  return null;
}

function basicPoints(han, fu) {
  return fu * Math.pow(2, han + 2);
}

function round100(n) { return Math.ceil(n / 100) * 100; }

// Returns { ron, tsumoDealer, tsumoOther }  — amounts paid BY loser/others
// These are the base amounts before honba adjustment.
export function basePayments(han, fu) {
  const yakumanMult = han >= 13 ? Math.floor(han / 13) : 1;

  let basic;
  let isLimit = false;
  if (han >= 13)      { basic = LIMITS.yakuman.basic * yakumanMult; isLimit = true; }
  else if (han >= 11) { basic = LIMITS.sanbaiman.basic;             isLimit = true; }
  else if (han >= 8)  { basic = LIMITS.baiman.basic;                isLimit = true; }
  else if (han >= 6)  { basic = LIMITS.haneman.basic;               isLimit = true; }
  else {
    basic = basicPoints(han, fu);
    if (basic >= 2000) { basic = LIMITS.mangan.basic;               isLimit = true; }
  }

  return {
    // Ron: loser pays basic × 4 (non-dealer) or × 6 (dealer)
    ronNonDealer:    round100(basic * 4),
    ronDealer:       round100(basic * 6),
    // Tsumo: how much each person pays
    tsumoOther:      round100(basic),  // each non-dealer pays tsumoBasic
    tsumoDealer:     round100(basic * 2),       // dealer pays 2x tsumoBasic ("X all" for dealer win)
  };
}

// Compute per-player score deltas for a win.
// winner, loser (null for tsumo): player indices 0-3
// dealer: dealer's player index
// isDealer: whether the winner is the dealer
// isTsumo: tsumo (vs ron)
// hon: honba count
// riichiPot: riichi sticks on the table (each worth 1000 pts)
export function computeScoreDeltas(han, fu, { winner, loser, dealer, isTsumo, honba, riichiPot }) {
  const isDealer = winner === dealer;
  const pay = basePayments(han, fu);

  const deltas = [0, 0, 0, 0];

  if (isTsumo) {
    // Dealer win: all pay tsumoDealer ("X all"). Non-dealer win: dealer pays tsumoDealer, others pay tsumoOther.
    for (let p = 0; p < 4; p++) {
      if (p === winner) continue;
      const amount = (isDealer || p === dealer) ? pay.tsumoDealer : pay.tsumoOther;
      const honbaBonus = honba * 100;
      const total = amount + honbaBonus;
      deltas[p]      -= total;
      deltas[winner] += total;
    }
  } else {
    // Ron: single loser pays
    const base = isDealer ? pay.ronDealer : pay.ronNonDealer;
    const honbaBonus = honba * 300; // 300 total per honba for ron
    const total = base + honbaBonus;
    deltas[loser]  -= total;
    deltas[winner] += total;
  }

  // Riichi pot goes to winner
  deltas[winner] += riichiPot * 1000;

  return deltas;
}

// Human-readable payment breakdown for display
export function paymentSummary(han, fu, { winner, loser, dealer, isTsumo, honba, riichiPot }) {
  const isDealer = winner === dealer;
  const pay = basePayments(han, fu);
  const limit = limitName(han, basicPoints(han, fu));
  const deltas = computeScoreDeltas(han, fu, { winner, loser, dealer, isTsumo, honba, riichiPot });

  const winnerGain = deltas[winner];

  if (isTsumo) {
    const honbaBonus = honba * 100;
    const dl = pay.tsumoDealer + honbaBonus;
    const ot = pay.tsumoOther  + honbaBonus;
    return {
      limit,
      label: isDealer
        ? `${dl.toLocaleString()} all`
        : `${dl.toLocaleString()} / ${ot.toLocaleString()}`,
      winnerGain,
    };
  } else {
    const base = isDealer ? pay.ronDealer : pay.ronNonDealer;
    const total = base + honba * 300;
    return { limit, label: total.toLocaleString(), winnerGain };
  }
}
