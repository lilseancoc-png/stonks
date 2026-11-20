// Real PrizePicks standard lines from the public mirror
// (github.com/enkday/prizepicks-data-mirror), matched to stored games and
// players once by scripts/sports-mirror-seed.mjs and committed as
// research/sports/prizepicks-mirror/<sport>.json.gz. The data job reads the
// file from its checkout beside the line archive (no network, no store
// write), so the model's real-line check and the promo clearance tables
// start with every day the mirror has. A line the props scans archived for
// the same game, player and stat wins (models.mjs ranks archive > issued >
// mirror). A missing or broken file means no mirror lines, never an error.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIRROR_SOURCE = 'https://github.com/enkday/prizepicks-data-mirror';
export const MIRROR_FIELDS = Object.freeze(['date', 'game_id', 'player_id', 'stat', 'line']);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_BYTES = 8 << 20;

export function mirrorSeedPath(sport, root = ROOT) {
  if (sport !== 'nba' && sport !== 'nfl') throw new Error('sport must be nba or nfl');
  return resolve(root, 'research', 'sports', 'prizepicks-mirror', sport + '.json.gz');
}

// The seed's rows as real lines ({ game_id, player_id, stat, threshold,
// source: 'mirror' }), optionally only for the given game ids.
export function mirrorLinesFrom(doc, { sport, gameIds = null } = {}) {
  if (!doc || doc.schema_version !== 1 || (sport && doc.sport !== sport) || !Array.isArray(doc.rows)) return [];
  const want = gameIds ? new Set(gameIds) : null;
  const out = [];
  for (const r of doc.rows) {
    if (!Array.isArray(r) || r.length < 5) continue;
    const [, game_id, player_id, stat, line] = r;
    if (typeof game_id !== 'string' || !game_id || typeof player_id !== 'string' || !player_id || typeof stat !== 'string') continue;
    if (!(typeof line === 'number' && Number.isFinite(line) && line >= 0 && line <= 1000 && (line * 2) % 1 === 0)) continue;
    if (want && !want.has(game_id)) continue;
    out.push({ game_id, player_id, stat, threshold: line, source: 'mirror' });
  }
  return out;
}

export async function loadMirrorLines(sport, { root = ROOT, gameIds = null } = {}) {
  try {
    const bytes = await readFile(mirrorSeedPath(sport, root));
    if (bytes.length > MAX_BYTES) return [];
    return mirrorLinesFrom(JSON.parse(gunzipSync(bytes, { maxOutputLength: 64 << 20 }).toString('utf8')), { sport, gameIds });
  } catch { return []; }
}
