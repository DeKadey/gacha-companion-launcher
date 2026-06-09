// NOTE: parsePaimonMoe lives in electron/genshin/genshinParse.js (main process)
// because genshin-db is too large to webpack-bundle in the renderer.
// Call it via window.api.parsePaimonMoe(jsonText) from the renderer.
//
// Shared pull log utilities (recomputeRolls, appendNewPulls, etc.) live in
// ../pullUtils.js and are game-agnostic.

// ─── Banner enrichment helpers ────────────────────────────────────────────────

// Converts "YYYY-MM-DD HH:mm:ss" from server-local time to UTC+8 for banner
// date comparisons (all banner start/end times are stored in UTC+8).
function toUTC8(timeStr, serverOffset) {
  if (!timeStr || serverOffset === 8) return timeStr;
  const [date, time] = timeStr.split(' ');
  const [y, m, d]   = date.split('-').map(Number);
  const [h, mi, s]  = time.split(':').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, h - serverOffset, mi, s);
  const dt = new Date(utcMs + 8 * 3_600_000);
  const p  = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth()+1)}-${p(dt.getUTCDate())} `
       + `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
}

// Normalise a name for comparison (same logic as HistoryTab).
function slugKey(s) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Build a flat list of all banners with type, start, end, featured, shortName.
// Mirrors the allBanners memo in HistoryTab so both sides match the same entries.
// Entries from the new schedule format also carry version and featuredId.
function buildBannerList(banners, bannersDual) {
  const list = [];
  const dualRanges = new Set();

  if (bannersDual) {
    for (const pairs of Object.values(bannersDual)) {
      for (const b of pairs) {
        list.push({ ...b, type: 'character' });
        dualRanges.add(`${b.start}|${b.end}`);
      }
    }
  }

  for (const b of (banners.characters ?? [])) {
    if (!dualRanges.has(`${b.start}|${b.end}`)) {
      list.push({ ...b, type: 'character' });
    }
  }

  const nonChar = [
    ['weapons',    'weapon'],
    ['chronicled', 'chronicled'],
    ['standard',   'standard'],
    ['beginners',  'beginner'],
  ];
  for (const [paimonKey, type] of nonChar) {
    for (const b of (banners[paimonKey] ?? [])) {
      list.push({ ...b, type });
    }
  }

  return list;
}

// Normalise featured list for comparison — handles both string and array.
function featuredIncludes(bannerObj, nameKey) {
  const raw = bannerObj.featured;
  if (!raw) return false;
  if (Array.isArray(raw)) return raw.some(f => slugKey(f) === nameKey);
  return slugKey(raw) === nameKey;
}

// ─── API pull enrichment ──────────────────────────────────────────────────────

// For every API-sourced pull that is missing bannerName or won5050, derive those
// fields from the Paimon.moe banner calendar.
//
// bannerName: matched by timestamp against the active banner's date window.
//   For dual character banners (two running concurrently), 5-star pulls are
//   matched to the sub-banner whose shortName slug equals the character's name.
//   3/4-star pulls get the first matching sub-banner.
//
// won5050 (character / weapon / chronicled banners only):
//   - If the 5-star is NOT in the banner's featured list → 'lost'
//   - If it IS featured and the previous 5-star on that banner type was 'lost' → 'guaranteed'
//   - If it IS featured and no prior loss → 'won'
//   All existing pulls (Excel/JSON) are read in chronological order to seed the
//   50/50 state before reaching the first API-only entry.
//
// serverOffset: the game server's UTC offset (stored in game.state.serverOffset).
export function enrichApiPulls(pullLog, banners, bannersDual, serverOffset = 8) {
  if (!banners || !pullLog?.length) return pullLog ?? [];

  const bannerList = buildBannerList(banners, bannersDual);

  // Find the banner entry active at the time of a given pull.
  function findBanner(pull) {
    const t8 = toUTC8(pull.time, serverOffset);
    const candidates = bannerList.filter(b =>
      b.type === pull.banner && b.start && b.end &&
      t8 >= b.start && t8 <= b.end,
    );
    if (candidates.length <= 1) return candidates[0] ?? null;

    // Multiple matches = dual character banners running simultaneously.
    // For 5-star pulls prefer the sub-banner whose shortName slug matches the character.
    if (pull.rarity === 5) {
      const nk = slugKey(pull.name);
      const specific = candidates.find(b => slugKey(b.shortName ?? '') === nk);
      if (specific) return specific;
    }
    // 3/4-star pulls: attribute to the first matching sub-banner.
    return candidates[0];
  }

  // Process chronologically so 50/50 state can be tracked across the full log.
  const sorted = [...pullLog].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

  // lastResult[bannerType] = won5050 of the most recent 5-star on that banner type.
  const lastResult = {};
  const enrichedMap = new Map();

  for (const pull of sorted) {
    let bannerObj     = null;
    let newBannerName = pull.bannerName ?? null;
    let newWon5050    = pull.won5050    ?? null;

    let newVersion    = pull.version    ?? null;
    let newFeaturedId = pull.featuredId ?? null;

    if (pull.source === 'api') {
      // 1. Backfill bannerName
      if (!newBannerName) {
        bannerObj     = findBanner(pull);
        newBannerName = bannerObj?.name ?? null;
      }

      // 2. Attach version and featuredId (skip chronicled — no images yet)
      if (pull.banner !== 'chronicled') {
        bannerObj = bannerObj ?? findBanner(pull);
        if (bannerObj) {
          if (newVersion    == null) newVersion    = bannerObj.version    ?? null;
          if (newFeaturedId == null) newFeaturedId = bannerObj.featuredId ?? null;
        }
      }

      // 3. Compute won5050 for 5-star limited-banner pulls
      if (pull.rarity === 5 && newWon5050 == null &&
          pull.banner !== 'standard' && pull.banner !== 'beginner') {
        bannerObj = bannerObj ?? findBanner(pull);
        if (bannerObj) {
          const nk         = slugKey(pull.name);
          const isFeatured = featuredIncludes(bannerObj, nk);
          if (!isFeatured) {
            newWon5050 = 'lost';
          } else {
            newWon5050 = lastResult[pull.banner] === 'lost' ? 'guaranteed' : 'won';
          }
        }
      }
    }

    // Track the 50/50 result of every 5-star (API or imported) to seed future entries.
    if (pull.rarity === 5) {
      const result = newWon5050 ?? pull.won5050;
      if (result != null) lastResult[pull.banner] = result;
    }

    enrichedMap.set(pull, { bannerName: newBannerName, won5050: newWon5050, version: newVersion, featuredId: newFeaturedId });
  }

  // Apply enrichment back in the original array order (no re-sorting).
  return pullLog.map(pull => {
    const { bannerName: nb, won5050: n5, version: nv, featuredId: nf } = enrichedMap.get(pull) ?? {};
    if (nb === pull.bannerName && n5 === pull.won5050 && nv === pull.version && nf === pull.featuredId) return pull;
    return { ...pull, bannerName: nb, won5050: n5, version: nv, featuredId: nf };
  });
}

// ─── API pull processor ───────────────────────────────────────────────────────

// Convert HoYoverse API pull list (single banner type) to internal format.
// apiPulls is in reverse-chronological order (newest first); we sort it.
// existingBannerPulls: already-stored entries for this banner (chronological),
//   used to derive the pity offset for incremental syncs.
// Roll numbers here are provisional — recomputeRolls() always overwrites them.
function buildApiEntries(apiPulls, banner, existingBannerPulls = []) {
  const sorted = [...apiPulls].sort((a, b) => a.time.localeCompare(b.time));

  // Pity offset: count pulls since the last 5-star in existing data so new
  // entries continue the streak rather than restarting from 1.
  let pityCounter = 0;
  const existingSorted = [...existingBannerPulls].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  for (let i = existingSorted.length - 1; i >= 0; i--) {
    if (existingSorted[i].rarity === 5) break;
    pityCounter++;
  }

  return sorted.map(pull => {
    pityCounter++;
    const rarity = parseInt(pull.rank_type, 10);
    const entry = {
      id:       pull.id,
      name:     pull.name,
      type:     pull.item_type === 'Character' ? 'character' : 'weapon',
      rarity,
      banner,
      time:     pull.time,
      roll:     null,          // set correctly by recomputeRolls()
      pity:     pityCounter,
      won5050:  undefined,     // cannot determine from API alone
      source:   'api',
      verified: true,          // API provides rank_type directly — no lookup needed
    };
    if (rarity === 5) pityCounter = 0;
    return entry;
  });
}

// Count pulls since last 5-star in a processed entry array (chronological)
function derivePityFromLog(entries) {
  let pity = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].rarity === 5) break;
    pity++;
  }
  return pity;
}

// charApiPulls: combined 301 + 400 pulls (both are char event banners, share pity)
// existingLog: full current pull log — used to derive per-banner pity offsets
export function processApiPulls(charApiPulls, weaponApiPulls, chronApiPulls, standardApiPulls = [], beginnerApiPulls = [], existingLog = []) {
  // Group existing log by banner, sorted chronologically, for pity offset calculation
  const byBanner = {};
  for (const p of existingLog) {
    if (!byBanner[p.banner]) byBanner[p.banner] = [];
    byBanner[p.banner].push(p);
  }
  for (const k of Object.keys(byBanner)) {
    byBanner[k].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  }

  const charLog     = buildApiEntries(charApiPulls,     'character',  byBanner['character']  ?? []);
  const weaponLog   = buildApiEntries(weaponApiPulls,   'weapon',     byBanner['weapon']     ?? []);
  const chronLog    = buildApiEntries(chronApiPulls,    'chronicled', byBanner['chronicled'] ?? []);
  const standardLog = buildApiEntries(standardApiPulls, 'standard',   byBanner['standard']   ?? []);
  const beginnerLog = buildApiEntries(beginnerApiPulls, 'beginner',   byBanner['beginner']   ?? []);

  return {
    pullLog:         [...charLog, ...weaponLog, ...chronLog, ...standardLog, ...beginnerLog],
    charPity:        derivePityFromLog(charLog),
    weaponPity:      derivePityFromLog(weaponLog),
    chronicledPity:  derivePityFromLog(chronLog),
    totalImported:   charApiPulls.length + weaponApiPulls.length + chronApiPulls.length + standardApiPulls.length + beginnerApiPulls.length,
    charCount:       charApiPulls.length,
    weaponCount:     weaponApiPulls.length,
    chronicledCount: chronApiPulls.length,
    standardCount:   standardApiPulls.length,
    beginnerCount:   beginnerApiPulls.length,
  };
}
