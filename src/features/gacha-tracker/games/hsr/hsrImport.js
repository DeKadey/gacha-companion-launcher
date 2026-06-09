// HSR-specific constants used by HistoryTab and GameSettingsModal.
// Parsing and 50/50 computation happen in electron/hsr/hsrParse.js (main process)
// because xlsx is bundled for main only.
// Shared pull log utilities live in ../pullUtils.js.

// Display labels for each HSR banner type
export const HSR_BANNER_LABELS = {
  character: 'Character',
  weapon:    'Light Cone',
  standard:  'Stellar',
  beginner:  'Departure',
};

// Ordered list of banner type keys for HSR (no Chronicled banner)
export const HSR_ALL_BANNERS = ['character', 'weapon', 'standard', 'beginner'];

// ─── API pull processor ───────────────────────────────────────────────────────

function slugKey(s) { return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Count pulls since last 5-star in a processed entry array (chronological)
function derivePityFromLog(entries) {
  let pity = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].rarity === 5) break;
    pity++;
  }
  return pity;
}

// Convert HoYoverse API pull list (single banner type) to internal format.
// apiPulls is reverse-chronological (newest first); we sort it.
function buildApiEntries(apiPulls, banner, existingBannerPulls = []) {
  const sorted = [...apiPulls].sort((a, b) => a.time.localeCompare(b.time));

  // Pity offset: count pulls since the last 5-star in existing data
  let pityCounter = 0;
  const existingSorted = [...existingBannerPulls].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  for (let i = existingSorted.length - 1; i >= 0; i--) {
    if (existingSorted[i].rarity === 5) break;
    pityCounter++;
  }

  return sorted.map(pull => {
    pityCounter++;
    const rarity = parseInt(pull.rank_type, 10);
    // HSR returns item_type as "Character" / "Light Cone" (EN) or "角色" / "光锥" (CN)
    const type   = (pull.item_type === 'Character' || pull.item_type === '角色') ? 'character' : 'weapon';
    const entry  = {
      id:       pull.id,
      name:     pull.name,
      type,
      rarity,
      banner,
      time:     pull.time,
      roll:     null,     // set by recomputeRolls()
      pity:     pityCounter,
      won5050:  undefined,
      source:   'api',
      verified: true,
    };
    if (rarity === 5) pityCounter = 0;
    return entry;
  });
}

// Build and return processed pull arrays from raw API results.
// Returns the same shape as genshinImport.processApiPulls (minus chronicled).
export function processHsrApiPulls(
  charApiPulls, weaponApiPulls, standardApiPulls = [], beginnerApiPulls = [],
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

  const charLog     = buildApiEntries(charApiPulls,    'character', byBanner['character'] ?? []);
  const weaponLog   = buildApiEntries(weaponApiPulls,  'weapon',    byBanner['weapon']    ?? []);
  const standardLog = buildApiEntries(standardApiPulls,'standard',  byBanner['standard']  ?? []);
  const beginnerLog = buildApiEntries(beginnerApiPulls,'beginner',  byBanner['beginner']  ?? []);

  return {
    pullLog:       [...charLog, ...weaponLog, ...standardLog, ...beginnerLog],
    charPity:      derivePityFromLog(charLog),
    weaponPity:    derivePityFromLog(weaponLog),
    totalImported: charApiPulls.length + weaponApiPulls.length + standardApiPulls.length + beginnerApiPulls.length,
    charCount:     charApiPulls.length,
    weaponCount:   weaponApiPulls.length,
    standardCount: standardApiPulls.length,
    beginnerCount: beginnerApiPulls.length,
  };
}

// ─── API pull enrichment ──────────────────────────────────────────────────────

// Converts "YYYY-MM-DD HH:mm:ss" from server-local time to UTC+8.
// Offsets: Asia=+8, America=-5, Europe=+1 (fixed, no DST).
function toUTC8(timeStr, serverOffset) {
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

// Normalise featured list — handles both string (old cache) and array (new schema).
function featuredIncludes(bannerObj, nameKey) {
  const raw = bannerObj.featured;
  if (!raw) return false;
  if (Array.isArray(raw)) return raw.some(f => slugKey(f) === nameKey);
  return slugKey(raw) === nameKey;
}

// For every API-sourced pull missing bannerName, won5050, version, or featuredId,
// derive those fields from the stored HSR banner schedule.
//
// bannerSchedule entries: { type, name, featured, start, end, version, featuredId }
//   type:     'character' | 'weapon' (matches pull.banner)
//   featured: array of featured character/LC names (or legacy string)
//   start/end: "YYYY-MM-DD HH:MM:SS" in UTC+8
//
// serverOffset: game server's UTC offset (Asia=8, America=-5, Europe=1).
export function enrichHsrApiPulls(pullLog, bannerSchedule, serverOffset = 8) {
  if (!bannerSchedule?.length || !pullLog?.length) return pullLog ?? [];

  function findBanner(pull) {
    const t8 = toUTC8(pull.time, serverOffset);
    const candidates = bannerSchedule.filter(b =>
      b.type === pull.banner && b.start && b.end &&
      t8 >= b.start && t8 <= b.end,
    );
    if (pull.rarity === 5) {
      const nk = slugKey(pull.name);
      // Prefer any time-window banner that features this character.
      const specific = candidates.find(b => featuredIncludes(b, nk));
      if (specific) return specific;
      // No time-window featured match — search all banners by name.
      // Handles: (a) timezone mismatch putting the pull outside the window,
      // (b) multiple concurrent banners where none happens to feature this char.
      const byName = bannerSchedule.filter(b =>
        b.type === pull.banner && featuredIncludes(b, nk)
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
      // 1. Backfill bannerName
      if (!newBannerName) {
        bannerObj     = findBanner(pull);
        newBannerName = bannerObj?.name ?? null;
      }

      // 2. Attach version and featuredId
      bannerObj = bannerObj ?? findBanner(pull);
      if (bannerObj) {
        if (newVersion    == null) newVersion    = bannerObj.version    ?? null;
        if (newFeaturedId == null) newFeaturedId = bannerObj.featuredId ?? null;
      }

      // 3. Compute won5050 for 5-star limited-banner pulls.
      // Always recompute from banner data (don't trust a stored value — it may have
      // been set incorrectly due to a prior timezone mismatch in findBanner).
      if (pull.rarity === 5 &&
          pull.banner !== 'standard' && pull.banner !== 'beginner') {
        if (bannerObj) {
          const isFeatured = featuredIncludes(bannerObj, slugKey(pull.name));
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
