// Tile encoding follows Tenhou conventions:
//   Man  (characters): 11-19
//   Pin  (circles):    21-29
//   Sou  (bamboo):     31-39
//   Honors:            41=1z(East) 42=2z(South) 43=3z(West) 44=4z(North)
//                      45=5z(Haku/White) 46=6z(Hatsu/Green) 47=7z(Chun/Red)
//   Aka dora (red 5):  51=0m  52=0p  53=0s

export const HONOR_Z = [0, 41, 42, 43, 44, 45, 46, 47]; // index 1-7

const LETTER_MAP = {
  E: 41, S: 42, N: 44,        // winds (West = 3z, no letter)
  W: 45, G: 46, R: 47,        // W=Haku(White/5z), G=Hatsu(Green/6z), R=Chun(Red/7z)
};

const UNICODE_BASE = {
  m: 0x1F006,  // +1..+9 = 🀇-🀏
  s: 0x1F00F,  // +1..+9 = 🀐-🀘
  p: 0x1F018,  // +1..+9 = 🀙-🀡
};

const HONOR_UNICODE = {
  41: '🀀', 42: '🀁', 43: '🀂', 44: '🀃',
  45: '🀆', 46: '🀅', 47: '🀄',
};

const HONOR_NAMES = ['', 'East', 'South', 'West', 'North', 'Haku', 'Hatsu', 'Chun'];
const HONOR_SHORT = ['', '1z', '2z', '3z', '4z', '5z', '6z', '7z'];

// Parse a single tile token like "3m", "7p", "1z", "E", "0m" → Tenhou code
export function parseTile(raw) {
  const str = raw.trim();
  if (!str) return null;

  // Single honor letter
  const upper = str.toUpperCase();
  if (str.length === 1 && LETTER_MAP[upper] !== undefined) return LETTER_MAP[upper];

  // Number+suit pair: "3m", "7p", "5s", "1z", "0m"
  const m = str.match(/^(\d)([mpsz])$/i);
  if (m) {
    const num = parseInt(m[1]);
    const suit = m[2].toLowerCase();
    if (suit === 'z') {
      if (num < 1 || num > 7) return null;
      return HONOR_Z[num];
    }
    if (num === 0) {
      return suit === 'm' ? 51 : suit === 'p' ? 52 : suit === 's' ? 53 : null;
    }
    if (num < 1 || num > 9) return null;
    return { m: 10, p: 20, s: 30 }[suit] + num;
  }

  return null;
}

// Parse a hand shorthand like "123m456p789s1234z" or space/comma separated tiles
export function parseHand(str) {
  str = str.trim();
  const tiles = [];

  // Try space/comma separated first
  if (/[ ,]/.test(str)) {
    for (const token of str.split(/[ ,]+/).filter(Boolean)) {
      const t = parseTile(token);
      if (t !== null) tiles.push(t);
    }
    return tiles;
  }

  // Compact notation: digits accumulate until a suit letter flushes them
  let nums = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const upper = ch.toUpperCase();

    if ('0123456789'.includes(ch)) {
      nums += ch;
    } else if ('mMpPsS'.includes(ch)) {
      const suit = ch.toLowerCase();
      for (const d of nums) {
        const t = parseTile(d + suit);
        if (t !== null) tiles.push(t);
      }
      nums = '';
    } else if (ch === 'z' || ch === 'Z') {
      for (const d of nums) {
        const t = parseTile(d + 'z');
        if (t !== null) tiles.push(t);
      }
      nums = '';
    } else if (LETTER_MAP[upper] !== undefined && nums === '') {
      // Single letter honor inline (only when no pending digits)
      tiles.push(LETTER_MAP[upper]);
    } else {
      // Discard pending nums, skip unknown
      nums = '';
    }
  }

  return tiles;
}

// Tenhou code → short string like "3m", "1z"
export function tileToString(code) {
  if (code === 51) return '0m';
  if (code === 52) return '0p';
  if (code === 53) return '0s';
  if (code >= 11 && code <= 19) return `${code - 10}m`;
  if (code >= 21 && code <= 29) return `${code - 20}p`;
  if (code >= 31 && code <= 39) return `${code - 30}s`;
  if (code >= 41 && code <= 47) return HONOR_SHORT[code - 40];
  return `?${code}`;
}

// Tenhou code → Unicode character
export function tileToUnicode(code) {
  if (HONOR_UNICODE[code]) return HONOR_UNICODE[code];
  if (code === 51) return '🀋'; // red 5m same glyph
  if (code === 52) return '🀝'; // red 5p
  if (code === 53) return '🀔'; // red 5s
  if (code >= 11 && code <= 19) return String.fromCodePoint(UNICODE_BASE.m + (code - 10));
  if (code >= 21 && code <= 29) return String.fromCodePoint(UNICODE_BASE.p + (code - 20));
  if (code >= 31 && code <= 39) return String.fromCodePoint(UNICODE_BASE.s + (code - 30));
  return '?';
}

// Full display name, e.g. "3 of Man", "East Wind"
export function tileLongName(code) {
  const nums = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  if (code >= 41 && code <= 47) return HONOR_NAMES[code - 40];
  if (code === 51) return 'Red Five (Man)';
  if (code === 52) return 'Red Five (Pin)';
  if (code === 53) return 'Red Five (Sou)';
  const suit = code >= 11 && code <= 19 ? 'Man' : code >= 21 && code <= 29 ? 'Pin' : 'Sou';
  const num = code % 10;
  return `${nums[num]} of ${suit}`;
}

export function tileSuit(code) {
  if (code >= 11 && code <= 19 || code === 51) return 'm';
  if (code >= 21 && code <= 29 || code === 52) return 'p';
  if (code >= 31 && code <= 39 || code === 53) return 's';
  return 'z';
}

export function sortTiles(tiles) {
  const order = (c) => {
    if (c === 51) return 15.5;
    if (c === 52) return 25.5;
    if (c === 53) return 35.5;
    return c;
  };
  return [...tiles].sort((a, b) => order(a) - order(b));
}
