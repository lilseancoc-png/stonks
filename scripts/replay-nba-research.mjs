// Verify a saved pregame decision using only its frozen inputs. No network.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { unpackRows } from '../lib/sports/rows.mjs';
import { rankGameProps } from '../lib/sports/props.mjs';
import { NBA_ALPHA_VERSION, selectNBAProps } from '../lib/sports/nba-market.mjs';
const file = process.argv[2]; if (!file) throw new Error('Pass a downloaded nba-research-<game>.json.gz file');
const data = JSON.parse(gunzipSync(await readFile(file), { maxOutputLength: 160 * 1024 * 1024 }).toString('utf8'));
if (data.format !== 'nba-research-export-1' || !Array.isArray(data.research?.points)) throw new Error('Invalid NBA research export');
const results = [];
for (const p of data.research.points) {
  if (p.version !== NBA_ALPHA_VERSION) throw new Error('Use the repository revision for research version ' + p.version);
  const { snapshot_id: snapshotId, ...unsigned } = p;
  if (createHash('sha256').update(JSON.stringify(unsigned)).digest('hex') !== snapshotId) throw new Error('Changed decision snapshot');
  const input = data.inputs[p.input_hash];
  if (!input || createHash('sha256').update(JSON.stringify(input)).digest('hex') !== p.input_hash) throw new Error('Missing or changed frozen inputs');
  const rows = input.records.flatMap((r) => unpackRows(r.rows)), games = input.records.flatMap((r) => r.games?.games || []), now = Date.parse(p.evaluated_utc);
  const ranked = rankGameProps({ sport: 'nba', game: p.game, lines: p.offered_lines, injuries: p.injuries, players: input.people?.players || [], rows,
    model: input.model, matchup: p.matchup, allGames: games, now, includeCandidates: true, nbaResearch: true });
  const alpha = selectNBAProps(ranked.ranked_candidates || [], p.quotes, input.model, now);
  const same = JSON.stringify(alpha.picks) === JSON.stringify(p.picks) && JSON.stringify(alpha.pair) === JSON.stringify(p.pair);
  results.push({ snapshot_id: p.snapshot_id, evaluated_utc: p.evaluated_utc, matched: same });
}
console.log(JSON.stringify({ snapshots: results.length, matched: results.filter((r) => r.matched).length, results }, null, 2));
if (results.some((r) => !r.matched)) process.exitCode = 1;
const out = process.argv.find((s) => s.startsWith('--out='))?.slice(6); if (out) await writeFile(out, JSON.stringify({ results }, null, 2));
