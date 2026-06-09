// ─── StarRailStation Excel parser (main process) ─────────────────────────────
//
// Parses the starrailstation-warp-data.xlsx export.
// Sheet layout:
//   Pull sheets  — 'Character Event Warp', 'Light Cone Event Warp',
//                  'Stellar Warp', 'Departure Warp'
//                  Columns: #No | Rarity | Item | Pity | Time | Banner | DEV
//   Banners sheet — Type | Name | Rate UP | Warps | 5★ | RateUP% | … | Start Time | End Time
//
// Time values are Excel serial dates representing UTC time.
// We add 8 hours on conversion to produce UTC+8 strings consistent with
// Genshin data elsewhere in the app.

const XLSX = require('xlsx');

const SHEET_TO_BANNER = {
  'Character Event Warp':  'character',
  'Light Cone Event Warp': 'weapon',
  'Stellar Warp':          'standard',
  'Departure Warp':        'beginner',
};

// Excel serial date → "YYYY-MM-DD HH:mm:ss" in UTC+8
// StarRailStation encodes pull/banner times as UTC serials.
// Adding 8 h shifts to UTC+8 for consistent display and storage.
function serialToTimestamp(serial) {
  if (!serial && serial !== 0) return null;
  if (typeof serial !== 'number') return null;
  // Days from Excel epoch (Dec 30 1899) to Unix epoch (Jan 1 1970) = 25569
  const ms = (serial - 25569) * 86400 * 1000 + 8 * 3600 * 1000;
  const dt = new Date(ms);
  const p  = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())} ` +
         `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
}

// "★★★★★" → 5,  "★★★★" → 4,  "★★★" → 3
function parseRarity(str) {
  if (!str) return 3;
  const count = (str.match(/★/g) ?? []).length;
  return count > 0 ? count : 3;
}

// DEV column format: "itemId,manual,bannerId,pullId"
// itemId: 1xxx (4 digits) → character;  2xxxx (5 digits) → weapon (light cone)
// pullId (field[3]): 19-digit HoYoverse API pull ID — used for sync deduplication
function parseItemType(devStr) {
  if (!devStr) return 'weapon';
  const id = parseInt(String(devStr).split(',')[0], 10);
  return id < 10000 ? 'character' : 'weapon';
}

// Normalise item name for 50/50 comparison
function slugKey(s) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ─── Sheet parsers ────────────────────────────────────────────────────────────

function parsePullSheet(wb, sheetName, bannerType) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
  if (!rows.length) return [];

  return rows
    .filter(r => r['Item'] != null)
    .map(r => {
      const rarity     = parseRarity(r['Rarity']);
      const time       = serialToTimestamp(r['Time']);
      const pity       = r['Pity'] != null && r['Pity'] !== '' ? Number(r['Pity']) : null;
      const devStr     = r['DEV (id,manual,banner,uid)'];
      const devParts   = devStr ? String(devStr).split(',') : [];
      const devId      = devParts.length ? parseInt(devParts[0], 10) : null;
      const pullId     = devParts[3] ? devParts[3].trim() : null;
      const type       = parseItemType(devStr);
      const bannerName = r['Banner'] != null ? String(r['Banner']) : null;

      return {
        id:         pullId || null,
        name:       String(r['Item']),
        type,
        rarity,
        banner:     bannerType,
        bannerName,
        time,
        roll:       null,    // set by recomputeRolls()
        pity,
        won5050:    null,    // computed below by computeWon5050()
        source:     'excel',
        verified:   true,
        _devId:     (devId != null && !isNaN(devId)) ? devId : null, // temp — removed after featuredId lookup
      };
    });
}

function parseBannersSheet(wb) {
  const ws = wb.Sheets['Banners'];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
  return rows
    .filter(r => r['Name'] && r['Type'] && SHEET_TO_BANNER[r['Type']])
    .map(r => ({
      name:     String(r['Name']),
      type:     SHEET_TO_BANNER[r['Type']],
      featured: r['Rate UP'] ? String(r['Rate UP']).trim() : null,
      start:    serialToTimestamp(r['Start Time']),
      end:      serialToTimestamp(r['End Time']),
    }));
}

// ─── 50/50 computation ────────────────────────────────────────────────────────

// Walks all pulls chronologically and sets won5050 for 5-star character/weapon
// banner pulls using the bannerList's 'featured' field as the truth source.
// Mirrors the same logic as genshinImport.enrichApiPulls but runs at parse time
// since the single Excel file contains everything we need.
function computeWon5050(pullLog, bannerList) {
  // bannerName → featured item name (for character and weapon banners)
  const featuredByName = {};
  for (const b of bannerList) {
    if (b.featured) featuredByName[b.name] = b.featured;
  }

  // Process chronologically so the guarantee carry-over state is tracked correctly
  const sorted = [...pullLog].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

  // Last 50/50 result per banner type ('won' | 'lost' | 'guaranteed')
  const lastResult = {};

  for (const pull of sorted) {
    if (pull.rarity !== 5) continue;
    if (pull.banner !== 'character' && pull.banner !== 'weapon') continue;

    const featured = pull.bannerName ? featuredByName[pull.bannerName] : null;
    if (!featured) continue;

    const isFeatured = slugKey(pull.name) === slugKey(featured);

    if (!isFeatured) {
      pull.won5050 = 'lost';
    } else {
      pull.won5050 = lastResult[pull.banner] === 'lost' ? 'guaranteed' : 'won';
    }
    lastResult[pull.banner] = pull.won5050;
  }
}

// ─── Pity trailing count ──────────────────────────────────────────────────────

function derivePityFromEntries(entries) {
  let pity = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].rarity === 5) break;
    pity++;
  }
  return pity;
}

// ─── Main export ──────────────────────────────────────────────────────────────

function parseHsrExcel(buffer, nameIdMap = null) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', raw: true });
  } catch (_) {
    throw new Error(
      'Could not read the file as an Excel workbook. ' +
      'Make sure you selected the starrailstation-warp-data.xlsx export.'
    );
  }

  // Validate it looks like a StarRailStation export
  if (!wb.Sheets['Character Event Warp'] && !wb.Sheets['Stellar Warp']) {
    throw new Error(
      "This doesn't look like a StarRailStation warp export. " +
      'Select the starrailstation-warp-data.xlsx file.'
    );
  }

  const charEntries     = parsePullSheet(wb, 'Character Event Warp',  'character');
  const weaponEntries   = parsePullSheet(wb, 'Light Cone Event Warp', 'weapon');
  const standardEntries = parsePullSheet(wb, 'Stellar Warp',          'standard');
  const beginnerEntries = parsePullSheet(wb, 'Departure Warp',        'beginner');
  const bannerList      = parseBannersSheet(wb);

  // Compute won5050 in-place — mutates won5050 field on 5-star pulls
  const allEntries = [...charEntries, ...weaponEntries, ...standardEntries, ...beginnerEntries];
  computeWon5050(allEntries, bannerList);

  // Build name → { id, type } map for featuredId lookup.
  // Any pull of a given item carries the same DEV id, so the first occurrence wins.
  const nameToId = {};
  for (const entry of allEntries) {
    if (entry._devId != null) {
      const key = slugKey(entry.name);
      if (!nameToId[key]) nameToId[key] = { id: entry._devId, type: entry.type };
    }
  }

  // Augment bannerList entries with featuredId / featuredType.
  // Primary:  external EnkaNetwork name→ID map — covers every character/LC regardless of pull history.
  // Fallback: pull-data map — used when network was unavailable at import time.
  for (const b of bannerList) {
    if (!b.featured) continue;
    const key   = slugKey(b.featured);
    const match = nameIdMap?.[key] ?? nameToId[key];
    if (match) {
      b.featuredId   = match.id;
      b.featuredType = match.type;
    }
  }

  // Remove the temporary _devId field from every pull entry
  for (const entry of allEntries) delete entry._devId;

  return {
    pullLog:          allEntries,
    bannerList,
    charPity:         derivePityFromEntries(charEntries),
    weaponPity:       derivePityFromEntries(weaponEntries),
    charGuaranteed:   false,
    weaponGuaranteed: false,
    totalImported:    allEntries.length,
    charCount:        charEntries.length,
    weaponCount:      weaponEntries.length,
    standardCount:    standardEntries.length,
    beginnerCount:    beginnerEntries.length,
  };
}

module.exports = { parseHsrExcel };
