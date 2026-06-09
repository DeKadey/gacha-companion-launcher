const genshin = require('genshin-db');

// ─── Item lookup ──────────────────────────────────────────────────────────────

function lookupSlug(slug) {
  if (slug.startsWith('traveler')) return { name: 'Traveler', rarity: 5 };

  const name = slug.replace(/_/g, ' ');

  try {
    const char = genshin.characters(name, { matchAliases: true });
    if (char?.name) return { name: char.name, rarity: char.rarity };
  } catch (_) {}

  try {
    const weapon = genshin.weapons(name, { matchAliases: true });
    if (weapon?.name) return { name: weapon.name, rarity: weapon.rarity };
  } catch (_) {}

  // Fallback: title-case the slug, assume 3★
  const fallbackName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return { name: fallbackName, rarity: 3 };
}

// ─── Rarity verification ──────────────────────────────────────────────────────

function buildRarityCache(names) {
  const cache = {};
  for (const name of names) {
    try {
      const char = genshin.characters(name, { matchAliases: true });
      if (char?.name) { cache[name] = char.rarity; continue; }
    } catch (_) {}
    try {
      const weapon = genshin.weapons(name, { matchAliases: true });
      if (weapon?.name) { cache[name] = weapon.rarity; continue; }
    } catch (_) {}
    cache[name] = null;
  }
  return cache;
}

function verifyAndFixEntries(entries) {
  const unverified = entries.filter(e => !e.verified);
  if (!unverified.length) return entries;

  const uniqueNames = [...new Set(unverified.map(e => e.name))];
  const cache = buildRarityCache(uniqueNames);

  return entries.map(e => {
    if (e.verified) return e;
    const rarity = cache[e.name];
    return { ...e, rarity: rarity ?? e.rarity, verified: true };
  });
}

// ─── Server timezone offset ──────────────────────────────────────────────────

function serverNameToOffset(name) {
  if (!name) return 8;
  const s = name.toLowerCase();
  if (s.includes('euro'))                          return 1;
  if (s.includes('usa') || s.includes('amer'))     return -5;
  return 8;
}

// ─── Paimon.moe JSON import ───────────────────────────────────────────────────

// won5050 is stored as a string enum:
//   'won'       → won the 50/50 (rate 1)
//   'lost'      → lost the 50/50 (rate 0)
//   'guaranteed'→ was guaranteed (rate 2)
//   null        → non-5★ pull, or unknown
// Backward-compat: old saves may have boolean true/false — the UI handles both.
function buildPaimonEntries(pulls, banner) {
  return pulls.map(pull => {
    const lookup  = lookupSlug(pull.id);
    const rarity  = lookup.rarity;
    const is5star = rarity === 5;
    let fate = null;
    if (is5star) {
      if      (pull.rate === 1) fate = 'won';
      else if (pull.rate === 2) fate = 'guaranteed';
      else if (pull.rate === 0) fate = 'lost';
    }
    return {
      name:       lookup.name,
      type:       pull.type,
      rarity,
      banner,
      bannerName: null,  // filled by Excel import
      roll:       null,  // filled by Excel import
      time:       pull.time,
      pity:       pull.pity ?? null,
      won5050:    fate,
      code:       pull.code ?? null,
      source:     'json',
      verified:   true,
    };
  });
}

function derivePityFromEntries(entries) {
  let pity = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].rarity === 5) break;
    pity++;
  }
  return pity;
}

function parsePaimonMoe(jsonText, existingLog) {
  let json;
  try {
    json = JSON.parse(jsonText);
  } catch (_) {
    throw new Error('Invalid JSON file — make sure you selected the paimon-moe-local-data_*.json export.');
  }

  if (!json['wish-counter-character-event']) {
    throw new Error("This doesn't look like a Paimon.moe export. Select the paimon-moe-local-data_*.json file.");
  }

  const serverOffset = serverNameToOffset(json['server'] ?? null);

  const charCounter     = json['wish-counter-character-event'] ?? {};
  const weaponCounter   = json['wish-counter-weapon-event']    ?? {};
  const chronCounter    = json['wish-counter-chronicled']      ?? {};
  const standardCounter = json['wish-counter-standard']        ?? {};
  const beginnerCounter = json['wish-counter-beginners']       ?? {};

  const charPulls     = charCounter.pulls     ?? [];
  const weaponPulls   = weaponCounter.pulls   ?? [];
  const chronPulls    = chronCounter.pulls    ?? [];
  const standardPulls = standardCounter.pulls ?? [];
  const beginnerPulls = beginnerCounter.pulls ?? [];

  const charEntries     = buildPaimonEntries(charPulls,     'character');
  const weaponEntries   = buildPaimonEntries(weaponPulls,   'weapon');
  const chronEntries    = buildPaimonEntries(chronPulls,    'chronicled');
  const standardEntries = buildPaimonEntries(standardPulls, 'standard');
  const beginnerEntries = buildPaimonEntries(beginnerPulls, 'beginner');

  const fixedExisting = verifyAndFixEntries(existingLog ?? []);

  return {
    pullLog: [...charEntries, ...weaponEntries, ...chronEntries, ...standardEntries, ...beginnerEntries],
    fixedExisting,
    serverOffset,
    charPity:              derivePityFromEntries(charEntries),
    charGuaranteed:        charCounter.guaranteed?.legendary   ?? false,
    weaponPity:            derivePityFromEntries(weaponEntries),
    weaponGuaranteed:      weaponCounter.guaranteed?.legendary ?? false,
    chronicledPity:        derivePityFromEntries(chronEntries),
    chronicledGuaranteed:  chronCounter.guaranteed?.legendary ?? false,
    totalImported: charPulls.length + weaponPulls.length + chronPulls.length + standardPulls.length + beginnerPulls.length,
    charCount:       charPulls.length,
    weaponCount:     weaponPulls.length,
    chronicledCount: chronPulls.length,
    standardCount:   standardPulls.length,
    beginnerCount:   beginnerPulls.length,
  };
}

// ─── Paimon.moe Excel import ──────────────────────────────────────────────────

const SHEET_TO_BANNER = {
  'Character Event': 'character',
  'Weapon Event':    'weapon',
  'Standard':        'standard',
  "Beginners' Wish": 'beginner',
};

function parseExcelMoe(buffer, existingLog) {
  const XLSX = require('xlsx');

  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', raw: false, dateNF: 'YYYY-MM-DD HH:mm:ss' });
  } catch (_) {
    throw new Error('Could not read the file as an Excel workbook. Make sure you selected the Paimon.moe .xlsx export.');
  }

  // Validate it looks like a paimon.moe export
  if (!wb.Sheets['Character Event'] && !wb.Sheets['Standard']) {
    throw new Error("This doesn't look like a Paimon.moe Excel export. Select the paimon-moe-wish-history_*.xlsx file.");
  }

  function parsePullSheet(sheetName, bannerType) {
    const ws = wb.Sheets[sheetName];
    if (!ws) return [];
    // Use header row 0 as keys
    const rows = XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: 'YYYY-MM-DD HH:mm:ss', defval: null });
    if (!rows.length) return [];

    // The ⭐ column header is a Unicode star emoji — find it by checking includes
    const starKey = Object.keys(rows[0]).find(k => k.includes('⭐')) ?? '⭐';

    return rows
      .filter(r => r.Name)
      .map(r => {
        const name      = String(r.Name);
        const typeRaw   = r.Type ? String(r.Type).toLowerCase() : 'weapon';
        const type      = typeRaw === 'character' ? 'character' : 'weapon';
        // Time may come as string "YYYY-MM-DD HH:mm:ss" or similar — normalise
        let time = r.Time ? String(r.Time).slice(0, 19) : null;
        // SheetJS sometimes uses "YYYY-MM-DD HH:mm:ss" — ensure space not T
        if (time) time = time.replace('T', ' ');
        const rarity    = r[starKey] != null ? Number(r[starKey]) : 3;
        const pity      = r.Pity    != null ? Number(r.Pity)     : null;
        const roll      = r['#Roll'] != null ? Number(r['#Roll']) : null;
        const bannerName = r.Banner  ? String(r.Banner)           : null;
        const part      = r.Part    ? String(r.Part)              : null;

        return {
          name,
          type,
          rarity,
          banner:     bannerType,
          bannerName,
          part,
          time,
          pity,
          roll,
          won5050:    null,   // filled in by merge when JSON is also present
          code:       null,
          source:     'excel',
          verified:   true,   // rarity comes directly from Paimon.moe data
        };
      });
  }

  function parseBannerList() {
    const ws = wb.Sheets['Banner List'];
    if (!ws) return [];
    const rows = XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: 'YYYY-MM-DD HH:mm:ss', defval: null });
    return rows
      .filter(r => r.Name)
      .map(r => ({
        name:  String(r.Name),
        start: r.Start ? String(r.Start).slice(0, 19).replace('T', ' ') : null,
        end:   r.End   ? String(r.End).slice(0, 19).replace('T', ' ')   : null,
      }));
  }

  const charEntries     = parsePullSheet('Character Event', 'character');
  const weaponEntries   = parsePullSheet('Weapon Event',    'weapon');
  const standardEntries = parsePullSheet('Standard',        'standard');
  const beginnerEntries = parsePullSheet("Beginners' Wish", 'beginner');
  const bannerList      = parseBannerList();

  const allEntries = [...charEntries, ...weaponEntries, ...standardEntries, ...beginnerEntries];

  const fixedExisting = verifyAndFixEntries(existingLog ?? []);

  return {
    pullLog: allEntries,
    fixedExisting,
    bannerList,
    charPity:              derivePityFromEntries(charEntries),
    weaponPity:            derivePityFromEntries(weaponEntries),
    chronicledPity:        0,
    charGuaranteed:        false,
    weaponGuaranteed:      false,
    chronicledGuaranteed:  false,
    totalImported: allEntries.length,
    charCount:       charEntries.length,
    weaponCount:     weaponEntries.length,
    chronicledCount: 0,
    standardCount:   standardEntries.length,
    beginnerCount:   beginnerEntries.length,
  };
}

// ─── Cross-file merge ─────────────────────────────────────────────────────────

// Detect whether the two pull logs have matching counts per banner type.
// Only compares banner types that are present in the Excel log — paimon.moe
// Excel exports do not include Chronicled Wish, so any JSON-only banner type
// is intentionally excluded from the comparison.
// Returns an array of { banner, json, excel } diff objects, or null if all good.
function detectMismatch(jsonLog, excelLog) {
  const count = (log) => {
    const c = {};
    for (const p of log) c[p.banner] = (c[p.banner] ?? 0) + 1;
    return c;
  };
  const jc = count(jsonLog);
  const ec = count(excelLog);
  // Only check banner types that actually appear in the Excel export
  const excelKeys = Object.keys(ec);
  const diffs = [];
  for (const k of excelKeys) {
    const j = jc[k] ?? 0;
    const e = ec[k] ?? 0;
    if (j !== e) diffs.push({ banner: k, json: j, excel: e });
  }
  return diffs.length ? diffs : null;
}

// Merge won5050 data from a JSON-sourced log into an Excel-sourced log.
// Matching key: time + name + banner (handles the common case).
// For duplicate keys (same item pulled at the same second on the same banner),
// we consume entries in order of appearance.
// Any pulls from jsonLog whose banner type does not appear in excelLog at all
// (e.g. Chronicled Wish, which paimon.moe Excel does not export) are appended
// to the end of the result so they are not silently dropped.
function mergeJsonIntoExcel(jsonLog, excelLog) {
  // Build a map: key → queue of won5050 values from the JSON log
  const map = new Map();
  for (const p of jsonLog) {
    const key = `${p.time}|${p.name}|${p.banner}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p.won5050);
  }
  const consumed = new Map();

  // Enrich Excel entries with won5050 from JSON
  const enriched = excelLog.map(p => {
    const key  = `${p.time}|${p.name}|${p.banner}`;
    const list = map.get(key);
    if (!list || list.length === 0) return p;
    const idx    = consumed.get(key) ?? 0;
    const fate   = idx < list.length ? list[idx] : null;
    consumed.set(key, idx + 1);
    return { ...p, won5050: fate };
  });

  // Append JSON-only pulls (banner types absent from the Excel export)
  const excelBanners = new Set(excelLog.map(p => p.banner));
  const jsonOnlyPulls = jsonLog.filter(p => !excelBanners.has(p.banner));

  return [...enriched, ...jsonOnlyPulls];
}

module.exports = { parsePaimonMoe, parseExcelMoe, detectMismatch, mergeJsonIntoExcel };
