// Private read-only reporting/export. Credentials never enter stdout or files.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { store } from '../lib/datastore.mjs';
import { recordLoader } from '../lib/sports/http.mjs';
import { nbaResearchSummary, exportNBAResearch } from '../lib/sports/nba-research.mjs';
const args = process.argv.slice(2), option = (key) => args.find((s) => s.startsWith(key + '='))?.slice(key.length + 1);
const load = recordLoader(store), status = await load('status', { sport: 'nba' });
const seasons = option('--season') ? [Number(option('--season'))] : status?.seasons || [];
if (!seasons.length || seasons.some((s) => !Number.isInteger(s) || s < 1946 || s > 2100)) throw new Error('No valid NBA season');
if (option('--game')) {
  const gameId = option('--game'); if (!/^[a-z0-9][a-z0-9_.:-]{0,95}$/.test(gameId)) throw new Error('Invalid game id');
  const dir = resolve(option('--out') || 'data/nba-research'); await mkdir(dir, { recursive: true });
  const bytes = await exportNBAResearch({ store, season: seasons[0], gameId, webLimit: false }), path = resolve(dir, 'nba-research-' + gameId + '.json.gz');
  await writeFile(path, bytes); console.log(JSON.stringify({ path, bytes: bytes.length }));
} else console.log(JSON.stringify(await nbaResearchSummary({ load, seasons }), null, 2));
