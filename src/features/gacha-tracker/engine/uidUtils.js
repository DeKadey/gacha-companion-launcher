// UID validation and server-offset derivation for HoYoverse games.
//
// Each game has a set of valid (prefix, totalLength) combinations.
// The prefix encodes the server region; the total length is fixed per region.
//
// Genshin: single-digit prefix (1,2,3,5,6,7,8,9) + 8 digits = 9 total
//          two-digit prefix 18 (Asia) + 8 digits = 10 total
// HSR:     single-digit prefix (1,2,5,6,7,8,9)   + 8 digits = 9 total
// ZZZ:     single-digit prefix (1,2,3) CN         + 7 digits = 8 total
//          two-digit prefix (10,13,15,17)          + 8 digits = 10 total

const UID_RULES = {
  genshin: [
    { prefixes: ['1','2','3','5','6','7','8','9'], length: 9 },
    { prefixes: ['18'],                            length: 10 },
  ],
  hsr: [
    { prefixes: ['1','2','5','6','7','8','9'], length: 9 },
  ],
  zzz: [
    { prefixes: ['1','2','3'],           length: 8  },
    { prefixes: ['10','13','15','17'],   length: 10 },
  ],
};

// Maps a matched prefix string to the server's UTC offset.
const PREFIX_OFFSET = {
  '6': -5, '10': -5,   // America
  '7': 1,  '15': 1,    // Europe
};

// Returns { valid: boolean, serverOffset: number | null, error: string | null }.
// linkedDatabase: 'genshin' | 'hsr' | 'zzz'
export function parseUid(uid, linkedDatabase) {
  const rules = UID_RULES[linkedDatabase];
  if (!rules) return { valid: false, serverOffset: null, error: null };

  const str = String(uid ?? '').trim();
  if (!str) return { valid: false, serverOffset: null, error: null };
  if (!/^\d+$/.test(str)) {
    return { valid: false, serverOffset: null, error: 'UID must contain only digits.' };
  }

  for (const rule of rules) {
    if (str.length !== rule.length) continue;
    for (const prefix of rule.prefixes) {
      if (str.startsWith(prefix)) {
        const serverOffset = PREFIX_OFFSET[prefix] ?? 8;
        return { valid: true, serverOffset, error: null };
      }
    }
  }

  const game = linkedDatabase === 'hsr' ? 'HSR' : linkedDatabase === 'zzz' ? 'ZZZ' : 'Genshin';
  return { valid: false, serverOffset: null, error: `Invalid UID for ${game}.` };
}
