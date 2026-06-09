const fs   = require('fs');
const path = require('path');
const { fetchRepoFileConditional } = require('../dataRepo');

// ─── Schedule → app format conversion ────────────────────────────────────────

// Converts genshin/banner-schedule-genshin.json (flat array) into the
// {banners, bannersDual} shape that enrichApiPulls and buildBannerList expect.
function scheduleToAppFormat(schedule) {
  const characters = [];
  const weapons    = [];
  const chronicled = [];
  const dualMap    = {};

  // Group character banners by start+end date to detect dual banners
  const charEntries = schedule.filter(b => b.type === 'character' && b.start && b.end);
  const timeGroups  = {};
  for (const b of charEntries) {
    const key = b.start.slice(0, 10) + '|' + b.end.slice(0, 10);
    if (!timeGroups[key]) timeGroups[key] = [];
    timeGroups[key].push(b);
  }

  for (const key of Object.keys(timeGroups)) {
    const group      = timeGroups[key];
    const appBanners = group.map(b => ({
      start: b.start, end: b.end,
      name: b.name, shortName: b.name,
      featured: b.featured || [b.name],
      version: b.version ?? null,
      featuredId: b.featuredId ?? null,
    }));
    if (group.length >= 2) {
      const ver = group[0].version || 'unknown';
      if (!dualMap[ver]) dualMap[ver] = [];
      dualMap[ver].push(...appBanners);
    } else {
      characters.push(...appBanners);
    }
  }

  // Weapon banners — one entry per banner event (dedup by start date)
  const weaponSeen = {};
  for (const b of schedule.filter(b => b.type === 'weapon' && b.start && b.end)) {
    const k = b.start.slice(0, 10);
    if (!weaponSeen[k]) {
      weaponSeen[k] = true;
      weapons.push({ start: b.start, end: b.end, name: b.name, shortName: b.name, featured: b.featured || [b.name], version: b.version ?? null, featuredId: b.featuredId ?? null });
    }
  }

  // Chronicled wish — one entry per event (no featuredId for now)
  const chronSeen = {};
  for (const b of schedule.filter(b => b.type === 'chronicled' && b.start && b.end)) {
    const k = b.start.slice(0, 10);
    if (!chronSeen[k]) {
      chronSeen[k] = true;
      chronicled.push({ start: b.start, end: b.end, name: b.name, shortName: b.name, featured: b.featured || [b.name] });
    }
  }

  return {
    banners:     { characters, weapons, chronicled, standard: [], beginners: [] },
    bannersDual: dualMap,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches the Genshin banner schedule from the private repo, falling back to
 * local cache if the repo is unavailable.
 *
 * Returns: { ok, banners, bannersDual, bannerSchedule, fromCache, offline }
 *   banners/bannersDual — paimon.moe-compatible format for enrichApiPulls
 *   bannerSchedule      — raw flat array for the History tab banner panel
 */
async function fetchGenshinBanners(dataDir) {
  const cachePath = path.join(dataDir, 'banner-schedule-genshin.json');
  const etagPath  = path.join(dataDir, 'banner-schedule-genshin.etag');

  let storedSchedule = [];
  if (fs.existsSync(cachePath)) {
    try { storedSchedule = JSON.parse(fs.readFileSync(cachePath, 'utf-8')); } catch (_) {}
  }

  // ── 1. Try private repo (conditional fetch — skips download if unchanged) ──
  try {
    let storedEtag = null;
    try { storedEtag = fs.readFileSync(etagPath, 'utf-8').trim(); } catch (_) {}

    const result = await fetchRepoFileConditional('genshin/banner-schedule-genshin.json', storedEtag);

    if (result.notModified) {
      if (!storedSchedule.length) throw new Error('Cache empty.');
      const { banners, bannersDual } = scheduleToAppFormat(storedSchedule);
      return { ok: true, banners, bannersDual, bannerSchedule: storedSchedule, fromCache: true, offline: false };
    }

    const schedule = JSON.parse(result.body);
    if (!Array.isArray(schedule) || !schedule.length) throw new Error('Repo schedule empty.');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(schedule));
    if (result.etag) fs.writeFileSync(etagPath, result.etag);
    const { banners, bannersDual } = scheduleToAppFormat(schedule);
    return { ok: true, banners, bannersDual, bannerSchedule: schedule, fromCache: false, offline: false };
  } catch (_) {}

  // ── 2. Fallback: local cache ───────────────────────────────────────────────
  if (storedSchedule.length) {
    const { banners, bannersDual } = scheduleToAppFormat(storedSchedule);
    return { ok: true, banners, bannersDual, bannerSchedule: storedSchedule, fromCache: true, offline: true };
  }

  return { ok: false, banners: null, bannersDual: null, bannerSchedule: null, fromCache: false, offline: true };
}

module.exports = { fetchGenshinBanners };
