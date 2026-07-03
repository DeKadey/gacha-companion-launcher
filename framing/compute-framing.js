// Orchestrates full framing computation for all characters across all games.
// Runs on GitHub Actions; outputs framing_hsr.json, framing_zzz.json, framing_version.json
// to the framing-output/ directory, then publishes them to a GitHub release.
//
// Usage: node framing/compute-framing.js
//
// Environment variables:
//   ASSET_CACHE_DIR  — where to store downloaded spine assets (default: .framing-cache/assets)
//   ONNX_MODEL_PATH  — path to yolov8_animeface.onnx (default: .framing-cache/yolov8_animeface.onnx)
//   OUTPUT_DIR       — where to write framing_*.json (default: framing-output)

'use strict';

const fs   = require('fs');
const path = require('path');

const { downloadCharAssets, listManifestIds } = require('./downloader');
const { computeFraming } = require('./live2dFraming');
const { getAnimatedBounds } = require('./live2dFaceDetect');

const ASSET_DIR  = path.resolve(process.env.ASSET_CACHE_DIR ?? path.join(__dirname, '..', '.framing-cache', 'assets'));
const ONNX_PATH  = path.resolve(process.env.ONNX_MODEL_PATH ?? path.join(__dirname, '..', '.framing-cache', 'yolov8_animeface.onnx'));
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR      ?? path.join(__dirname, '..', 'framing-output'));

const GAMES = ['hsr', 'zzz'];

function loadExisting(game) {
  const file = path.join(OUTPUT_DIR, `framing_${game}.json`);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { version: parsed.version ?? 0, data: parsed.data ?? parsed };
  } catch {
    return { version: 0, data: {} };
  }
}

function saveOutput(game, version, data) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `framing_${game}.json`),
    JSON.stringify({ version, generated: new Date().toISOString(), data }, null, 2),
  );
}

async function processGame(game) {
  console.log(`\n=== ${game.toUpperCase()} ===`);
  const existing = loadExisting(game);
  const ids = await listManifestIds(game);
  console.log(`  ${ids.length} characters in manifest`);

  const data    = { ...existing.data };
  let   changed = false;

  for (const id of ids) {
    const existing  = data[id];
    const hasAnchor = !!existing && existing.cx !== undefined;
    const hasBounds = !!existing && existing.topY !== undefined && existing.bottomY !== undefined;

    if (hasAnchor && hasBounds) {
      console.log(`  [${id}] cached — skip`);
      continue;
    }

    process.stdout.write(`  [${id}] downloading assets…`);
    const dl = await downloadCharAssets(ASSET_DIR, game, id).catch((e) => ({ ok: false, error: e.message }));
    if (!dl.ok) {
      process.stdout.write(` skip (${dl.reason ?? dl.error})\n`);
      continue;
    }

    if (!hasAnchor) {
      // No cached anchor (new character, or never computed) — full compute, gets both anchor + bounds.
      process.stdout.write(` computing framing…`);
      const result = await computeFraming(dl.dir, dl.bases, id, ONNX_PATH, game).catch((e) => {
        process.stdout.write(` ERROR: ${e.message}\n`);
        return null;
      });
      if (!result) continue;
      data[id] = result;
      changed = true;
      process.stdout.write(` done (cx=${result.cx.toFixed(0)}, cy=${result.cy.toFixed(0)})\n`);
      continue;
    }

    // Anchor already cached, just missing the bounds — backfill only that (cheap:
    // skeleton pose + getBounds, no atlas/skin scan, no face-detect render/inference).
    process.stdout.write(` backfilling bounds…`);
    const bounds = await getAnimatedBounds(dl.dir, dl.bases).catch((e) => {
      process.stdout.write(` ERROR: ${e.message}\n`);
      return null;
    });
    if (!bounds) continue;
    data[id] = { ...existing, ...bounds };
    changed = true;
    process.stdout.write(` done (topY=${bounds.topY.toFixed(0)}, bottomY=${bounds.bottomY.toFixed(0)})\n`);
  }

  // Always bump the version on a successful run (even if nothing changed for
  // this game) — a run failure throws before reaching here, so this only ever
  // advances on success. Needed because framing_version.json is one combined
  // number shared by both games: if only one game's version ever moved, the
  // other game's real updates could be masked by the shared number not
  // increasing, and framingSync would wrongly skip re-downloading it.
  const version = existing.version + 1;
  saveOutput(game, version, data);
  console.log(`  ${game}: version=${version}, entries=${Object.keys(data).length}, changed=${changed}`);
  return { version, changed };
}

async function main() {
  fs.mkdirSync(ASSET_DIR,  { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  if (!fs.existsSync(ONNX_PATH)) {
    console.error(`ONNX model not found at ${ONNX_PATH}. Set ONNX_MODEL_PATH or ensure the cache step ran.`);
    process.exit(1);
  }

  const results = {};
  for (const game of GAMES) {
    results[game] = await processGame(game);
  }

  const maxVersion = Math.max(...Object.values(results).map((r) => r.version));
  const versionFile = path.join(OUTPUT_DIR, 'framing_version.json');
  fs.writeFileSync(versionFile, JSON.stringify({ version: maxVersion, generated: new Date().toISOString() }, null, 2));
  console.log(`\nDone. Combined version=${maxVersion}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
