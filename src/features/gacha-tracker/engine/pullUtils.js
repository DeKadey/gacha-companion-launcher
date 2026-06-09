// ─── Shared pull log utilities ────────────────────────────────────────────────
// Game-agnostic helpers used by all games that have a pull/gacha log.
// Genshin-specific logic lives in ./genshin/genshinImport.js
// HSR-specific logic lives in ./hsr/hsrImport.js

// ─── Roll number recomputation ────────────────────────────────────────────────

// Recomputes roll numbers for every entry in the pull log.
// Within each banner type, pulls are sorted by time ascending and numbered
// sequentially from 1. Time is the sole ordering key — earlier = lower roll.
// Always call this as the final step after any operation that changes the log.
export function recomputeRolls(pullLog) {
  if (!pullLog?.length) return pullLog ?? [];

  // Group by banner type (object references preserved — no copies yet)
  const byBanner = {};
  for (const p of pullLog) {
    if (!byBanner[p.banner]) byBanner[p.banner] = [];
    byBanner[p.banner].push(p);
  }

  // Sort each group chronologically and record roll number in a Map keyed by
  // object reference so identical timestamps don't collide across banners.
  const rollMap = new Map();
  for (const pulls of Object.values(byBanner)) {
    pulls
      .slice()
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
      .forEach((p, i) => rollMap.set(p, i + 1));
  }

  return pullLog.map(p => ({ ...p, roll: rollMap.get(p) ?? null }));
}

// ─── Replace-by-banner merge ──────────────────────────────────────────────────

// Replaces all existing entries for the specified banners with the incoming set.
// Entries from other banners (or other sources) are preserved.
// Used for file imports where incoming data is authoritative for those banners.
export function replaceBannerPulls(existing, incoming, bannersToReplace) {
  const kept = (existing ?? []).filter(p => !bannersToReplace.includes(p.banner));
  return [...kept, ...(incoming ?? [])];
}

// ─── Preserve newer API pulls across imports ──────────────────────────────────

// When a file is imported, it replaces the stored log for its banners.
// Any API-synced pulls that are NEWER than the import's latest entry for a given
// banner would be silently deleted — but those are exactly the recent pulls the
// user synced because the export hadn't caught up yet.
//
// This function scans existingLog for source:'api' entries that sit beyond the
// import's coverage window and appends them to importedLog so they survive.
// If the import has no data for a banner at all, every API pull for that banner
// is kept (the import doesn't cover it, so nothing should be dropped).
// Roll numbers for the kept entries are fixed by recomputeRolls() afterwards.
export function preserveNewerApiPulls(existingLog, importedLog) {
  const latestImported = {};
  for (const p of (importedLog ?? [])) {
    if (!latestImported[p.banner] || p.time > latestImported[p.banner]) {
      latestImported[p.banner] = p.time;
    }
  }
  const toKeep = (existingLog ?? []).filter(p => {
    if (p.source !== 'api') return false;
    const latest = latestImported[p.banner];
    // Keep if: no import coverage for this banner, OR pull is strictly newer
    return !latest || p.time > latest;
  });
  return toKeep.length > 0 ? [...(importedLog ?? []), ...toKeep] : (importedLog ?? []);
}

// ─── Append-new-pulls merge ───────────────────────────────────────────────────

// Adds only pulls not already present in the existing log.
//
// Primary dedup: by API pull id. If the incoming pull has an unknown id AND the
// existing log has ids for that banner, the pull is new — include regardless of
// timestamp (catches id-gaps between batches via SYNC_LOOKBACK).
//
// Fallback — existing has no ids for that banner (Excel import without DEV column):
//   - Pulls strictly newer than the latest existing timestamp: always include.
//   - Pulls at or before the latest timestamp: count-based excess — if the API
//     returns more pulls at a given timestamp than existing already holds, the
//     extra ones are a missed batch → include them.
export function appendNewPulls(existing, incoming) {
  const latestByBanner  = {};
  const existingIds     = new Set();
  const bannerHasIds    = {};
  const existCountByKey = {};   // "banner|time" → count of existing pulls

  for (const p of (existing ?? [])) {
    if (!latestByBanner[p.banner] || p.time > latestByBanner[p.banner])
      latestByBanner[p.banner] = p.time;
    if (p.id) {
      existingIds.add(p.id);
      bannerHasIds[p.banner] = true;
    }
    const k = `${p.banner}|${p.time}`;
    existCountByKey[k] = (existCountByKey[k] ?? 0) + 1;
  }

  const incomCountByKey = {};
  for (const p of (incoming ?? [])) {
    const k = `${p.banner}|${p.time}`;
    incomCountByKey[k] = (incomCountByKey[k] ?? 0) + 1;
  }
  const addedByKey = {};

  const newPulls = (incoming ?? []).filter(p => {
    if (p.id && existingIds.has(p.id)) return false;        // already have by id → skip
    const latest = latestByBanner[p.banner];
    if (!latest) return true;                               // no existing for this banner
    if (p.time > latest) return true;                      // strictly newer → include
    if (p.id && bannerHasIds[p.banner]) return true;       // unknown id, existing has ids → new
    // No ids in existing for this banner: count-based excess at this timestamp.
    const k = `${p.banner}|${p.time}`;
    const excess = Math.max(0, (incomCountByKey[k] ?? 0) - (existCountByKey[k] ?? 0));
    if ((addedByKey[k] ?? 0) < excess) { addedByKey[k] = (addedByKey[k] ?? 0) + 1; return true; }
    return false;
  });

  return [...(existing ?? []), ...newPulls];
}
