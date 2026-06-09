// ZZZ-specific constants and pull processing.
// API gacha types: 2 = Exclusive (character), 3 = W-Engine (weapon), 1 = Stable (standard), 5 = Bangboo

export const ZZZ_BANNER_LABELS = {
  character: 'Exclusive',
  weapon:    'W-Engine',
  standard:  'Stable',
  bangboo:   'Bangboo',
};

export const ZZZ_ALL_BANNERS = ['character', 'weapon', 'standard', 'bangboo'];

// Community-sourced character ID → name map (IDs from rng.moe backup format)
const ZZZ_CHAR_NAMES = {
  1011: 'Anby',           1021: 'Nekomata',       1031: 'Nicole',
  1041: 'Soldier 11',     1051: 'Yidhari',         1061: 'Corin',
  1071: 'Caesar',         1081: 'Billy',            1091: 'Miyabi',
  1101: 'Koleda',         1111: 'Anton',            1121: 'Ben',
  1131: 'Soukaku',        1141: 'Lycaon',           1151: 'Lucy',
  1161: 'Lighter',        1171: 'Burnice',          1181: 'Grace',
  1191: 'Ellen',          1201: 'Harumasa',         1211: 'Rina',
  1221: 'Yanagi',         1231: 'Rokudou Sariel',   1241: 'Zhu Yuan',
  1251: 'Qingyi',         1261: 'Jane Doe',         1271: 'Seth',
  1281: 'Piper',          1291: 'Hugo Vlad',        1301: 'Orphie & Magus',
  1311: 'Astra Yao',      1321: 'Evelyn',           1331: 'Vivian',
  1341: 'Zhao',           1351: 'Pulchra',          1361: 'Trigger',
  1371: 'Yi Xuan',        1381: 'Silver Anby',      1391: 'Ju Fufu',
  1401: 'Alice',          1411: 'Yuzuha',           1421: 'Pan Yinhu',
  1431: 'Ye Shunguang',   1441: 'Komano Manato',    1451: 'Lucia',
  1461: 'Seed',           1471: 'Banyue',           1481: 'Dialyn',
  1491: 'Sunna',          1501: 'Aria',             1511: 'Nangong Yu',
  1521: 'Cissia',         1531: 'Billy SP',         1541: 'Promeia',
  1551: 'Pyrois',         1561: 'Velina',           1571: 'Norma',
  1581: 'Remielle',
  2011: 'Wise',           2021: 'Belle',
};

function resolveItem(id) {
  if (id >= 1000 && id < 12000) {
    return { name: ZZZ_CHAR_NAMES[id] ?? `Agent #${id}`, type: 'character' };
  }
  if (id >= 53000) return { name: `W-Engine #${id}`, type: 'weapon' };
  // 12xxx = B-rank bangboo, 13xxx = A-rank bangboo, 14xxx = S-rank bangboo
  return { name: `Bangboo #${id}`, type: 'bangboo' };
}

function msToZzzTime(ts) {
  const d = new Date(ts + 8 * 3600 * 1000); // shift to UTC+8
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const RNGMOE_TO_BANNER = { 1001: 'standard', 2001: 'character', 3001: 'weapon', 5001: 'bangboo' };
// result field: 0=no 50/50 tracking, 1=won, 2=lost, 3=guaranteed
const RNGMOE_TO_WON5050 = { 1: 'won', 2: 'lost', 3: 'guaranteed' };

export function parseZzzRngMoe(jsonText, existingLog = []) {
  let raw;
  try { raw = JSON.parse(jsonText); }
  catch { throw new Error('Invalid JSON — could not parse file.'); }

  if (raw.game !== 'zzz') throw new Error('This backup is not for ZZZ (game field is not "zzz").');
  if (!raw.data?.profiles)  throw new Error('No profile data found in backup.');

  const profileId = String(raw.data.curProfileId ?? Object.keys(raw.data.profiles)[0]);
  const profile   = raw.data.profiles[profileId];
  if (!profile) throw new Error('Profile not found in backup.');

  const store = profile.stores?.['0'];
  if (!store?.items) throw new Error('No gacha items found in backup.');

  const pullLog = [];
  let totalImported = 0;
  const counts = { character: 0, weapon: 0, standard: 0, bangboo: 0 };

  for (const [gachaTypeStr, items] of Object.entries(store.items)) {
    const gachaType = parseInt(gachaTypeStr, 10);
    const banner    = RNGMOE_TO_BANNER[gachaType];
    if (!banner || !Array.isArray(items) || items.length === 0) continue;

    const sorted = [...items].sort((a, b) => a.no - b.no);
    let pityCounter = 0;

    for (const item of sorted) {
      pityCounter++;
      const rarity   = item.rarity + 1; // rng.moe 2/3/4 → our 3/4/5
      const { name, type } = resolveItem(item.id);
      const time     = msToZzzTime(item.timestamp);
      // 50/50 only tracked on Exclusive (character) and W-Engine banners
      const won5050  = (rarity === 5 && banner !== 'standard' && banner !== 'bangboo')
        ? (RNGMOE_TO_WON5050[item.result] ?? null)
        : null;

      pullLog.push({
        id:       String(item.uid ?? ''),
        name, type, rarity, banner,
        bannerName: null,
        time,
        roll:     null,
        pity:     pityCounter,
        won5050,
        source:   'json',
        verified: true,
      });

      if (rarity === 5) pityCounter = 0;
      counts[banner] = (counts[banner] ?? 0) + 1;
      totalImported++;
    }
  }

  return { pullLog, totalImported, counts };
}

// ─────────────────────────────────────────────────────────────────────────────

function derivePityFromLog(entries) {
  let pity = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].rarity === 5) break;
    pity++;
  }
  return pity;
}

function buildApiEntries(apiPulls, banner, existingBannerPulls = []) {
  const sorted = [...apiPulls].sort((a, b) => a.time.localeCompare(b.time));

  let pityCounter = 0;
  const existingSorted = [...existingBannerPulls].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  for (let i = existingSorted.length - 1; i >= 0; i--) {
    if (existingSorted[i].rarity === 5) break;
    pityCounter++;
  }

  return sorted.map(pull => {
    pityCounter++;
    const rarity  = parseInt(pull.rank_type, 10) + 1; // API: 2/3/4 (B/A/S) → internal: 3/4/5
    const itemId  = parseInt(pull.item_id, 10);
    let type;
    if (itemId >= 13000 && itemId < 15000) type = 'bangboo';      // 13xxx=A-rank, 14xxx=S-rank bangboo
    else if (itemId >= 12000)              type = 'weapon';        // 12xxx W-engines; 53xxx+ handled same
    else                                   type = 'character';     // 1xxx agents
    const entry  = {
      id:       pull.id,
      name:     pull.name,
      type,
      rarity,
      banner,
      time:     pull.time,
      roll:     null,
      pity:     pityCounter,
      won5050:  undefined,
      source:   'api',
      verified: true,
    };
    if (rarity === 5) pityCounter = 0;
    return entry;
  });
}

export function processZzzApiPulls(
  charApiPulls, weaponApiPulls, standardApiPulls = [], bangbooApiPulls = [],
  existingLog = [],
) {
  const byBanner = {};
  for (const p of existingLog) {
    if (!byBanner[p.banner]) byBanner[p.banner] = [];
    byBanner[p.banner].push(p);
  }
  for (const k of Object.keys(byBanner)) {
    byBanner[k].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  }

  const charLog    = buildApiEntries(charApiPulls,    'character', byBanner['character'] ?? []);
  const weaponLog  = buildApiEntries(weaponApiPulls,  'weapon',    byBanner['weapon']    ?? []);
  const standardLog = buildApiEntries(standardApiPulls, 'standard', byBanner['standard'] ?? []);
  const bangbooLog  = buildApiEntries(bangbooApiPulls,  'bangboo',  byBanner['bangboo']  ?? []);

  return {
    pullLog:    [...charLog, ...weaponLog, ...standardLog, ...bangbooLog],
    charPity:   derivePityFromLog(charLog),
    weaponPity: derivePityFromLog(weaponLog),
  };
}

// ─── API pull enrichment ──────────────────────────────────────────────────────

function toUTC8Zzz(timeStr, serverOffset) {
  if (!timeStr || serverOffset === 8) return timeStr;
  const [date, time] = timeStr.split(' ');
  const [y, m, d]   = date.split('-').map(Number);
  const [h, mi, s]  = time.split(':').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, h - serverOffset, mi, s);
  const dt    = new Date(utcMs + 8 * 3_600_000);
  const p     = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth()+1)}-${p(dt.getUTCDate())} `
       + `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
}

function slugKeyZzz(s) { return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function featuredIncludesZzz(bannerObj, nameKey) {
  const raw = bannerObj.featured;
  if (!raw) return false;
  if (Array.isArray(raw)) return raw.some(f => slugKeyZzz(f) === nameKey);
  return slugKeyZzz(raw) === nameKey;
}

// For every API-sourced pull missing bannerName, won5050, version, or featuredId,
// derive those fields from the ZZZ banner schedule.
//
// bannerSchedule entries: { type, name, featured, start, end, version, featuredId }
//   type: 'character' | 'weapon' (matches pull.banner)
//   start/end: "YYYY-MM-DD HH:MM:SS" in UTC+8
//
// serverOffset: game server's UTC offset (Asia=8, America=-5, Europe=1).
export function enrichZzzApiPulls(pullLog, bannerSchedule = [], serverOffset = 8) {
  if (!bannerSchedule?.length || !pullLog?.length) return pullLog ?? [];

  function findBanner(pull) {
    const t8 = toUTC8Zzz(pull.time, serverOffset);
    const candidates = bannerSchedule.filter(b =>
      b.type === pull.banner && b.start && b.end &&
      t8 >= b.start && t8 <= b.end,
    );
    if (pull.rarity === 5) {
      const nk = slugKeyZzz(pull.name);
      // Prefer any time-window banner that features this character.
      const specific = candidates.find(b => featuredIncludesZzz(b, nk));
      if (specific) return specific;
      // No time-window featured match — search all banners by name.
      // Handles: (a) timezone mismatch putting the pull outside the window,
      // (b) multiple concurrent banners where none happens to feature this char.
      const byName = bannerSchedule.filter(b =>
        b.type === pull.banner && featuredIncludesZzz(b, nk)
      );
      if (byName.length > 0) {
        const pt = new Date(t8.replace(' ', 'T'));
        byName.sort((a, b) => {
          const da = Math.min(
            Math.abs(new Date(a.start.replace(' ', 'T')) - pt),
            Math.abs(new Date(a.end.replace(' ', 'T'))   - pt),
          );
          const db = Math.min(
            Math.abs(new Date(b.start.replace(' ', 'T')) - pt),
            Math.abs(new Date(b.end.replace(' ', 'T'))   - pt),
          );
          return da - db;
        });
        return byName[0];
      }
    }
    return candidates[0] ?? null;
  }

  const sorted = [...pullLog].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  const lastResult  = {};
  const enrichedMap = new Map();

  for (const pull of sorted) {
    let bannerObj     = null;
    let newBannerName = pull.bannerName ?? null;
    let newWon5050    = pull.won5050    ?? null;
    let newVersion    = pull.version    ?? null;
    let newFeaturedId = pull.featuredId ?? null;

    if (pull.source === 'api') {
      if (!newBannerName) {
        bannerObj     = findBanner(pull);
        newBannerName = bannerObj?.name ?? null;
      }

      bannerObj = bannerObj ?? findBanner(pull);
      if (bannerObj) {
        if (newVersion    == null) newVersion    = bannerObj.version    ?? null;
        if (newFeaturedId == null) newFeaturedId = bannerObj.featuredId ?? null;
      }

      // Always recompute from banner data (don't trust a stored value — it may have
      // been set incorrectly due to a prior timezone mismatch in findBanner).
      if (pull.rarity === 5 &&
          pull.banner !== 'standard' && pull.banner !== 'bangboo') {
        if (bannerObj) {
          const isFeatured = featuredIncludesZzz(bannerObj, slugKeyZzz(pull.name));
          newWon5050 = isFeatured
            ? (lastResult[pull.banner] === 'lost' ? 'guaranteed' : 'won')
            : 'lost';
        }
        // No schedule match: leave won5050 as the existing stored value (or null).
      }
    }

    if (pull.rarity === 5) {
      const result = newWon5050 ?? pull.won5050;
      if (result != null) lastResult[pull.banner] = result;
    }

    enrichedMap.set(pull, { bannerName: newBannerName, won5050: newWon5050, version: newVersion, featuredId: newFeaturedId });
  }

  const result = pullLog.map(pull => {
    const { bannerName: nb, won5050: n5, version: nv, featuredId: nf } = enrichedMap.get(pull) ?? {};
    if (nb === pull.bannerName && n5 === pull.won5050 && nv === pull.version && nf === pull.featuredId) return pull;
    return { ...pull, bannerName: nb, won5050: n5, version: nv, featuredId: nf };
  });
  return result.every((p, i) => p === pullLog[i]) ? pullLog : result;
}
