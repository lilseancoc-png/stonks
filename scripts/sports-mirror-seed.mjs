// Builds the real-line seed from the public PrizePicks mirror
// (github.com/enkday/prizepicks-data-mirror: one standard-line snapshot a
// day, about 7 AM ET, since December 2025; its README says the data may be
// used however you like). Run by hand, never by a workflow:
//
//   git clone https://github.com/enkday/prizepicks-data-mirror /tmp/mirror
//   node --env-file=r2.env scripts/sports-mirror-seed.mjs --mirror /tmp/mirror
//   node scripts/sports-mirror-seed.mjs --mirror /tmp/mirror --store DIR   (a local copy of the records)
//
// It matches each pregame standard line to a stored game (both teams, start
// within 10 minutes) and player (name among the players whose last stored
// game before the snapshot was with that team), keeps the first line seen
// per game, player and stat, and writes
// research/sports/prizepicks-mirror/<sport>.json.gz: [date, game_id,
// player_id, stat, line] rows. The data job reads that file
// (lib/sports/mirror-seed.mjs) beside the line archive, so the model's
// real-line check (models.mjs `real_lines`) and the promo clearance tables
// have every stat's history from the start. Outcomes are never read here.
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sportsKey, readSportsJson } from '../lib/sports/store.mjs';
import { unpackRows } from '../lib/sports/rows.mjs';
import { MODEL_SPECS } from '../lib/sports/models.mjs';
import { teamCode } from '../lib/sports/prop-sources.mjs';
import { playerFor } from '../lib/sports/props.mjs';
import { foldName } from '../lib/sports/read.mjs';
import { localDate } from '../lib/sports/time.mjs';
import { MIRROR_SOURCE, MIRROR_FIELDS, mirrorSeedPath } from '../lib/sports/mirror-seed.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86400000;
// Mirror stat names to the site's stat ids (model stats only).
export const MIRROR_STATS = Object.freeze({
  nba: { Points: 'points', Rebounds: 'rebounds', Assists: 'assists', '3-PT Made': 'threes', Steals: 'steals', 'Blocked Shots': 'blocks', Turnovers: 'turnovers',
    'Pts+Rebs+Asts': 'pra', 'Pts+Rebs': 'pts_reb', 'Pts+Asts': 'pts_ast', 'Rebs+Asts': 'reb_ast', 'Blks+Stls': 'blk_stl' },
  nfl: { 'Pass Yards': 'passing_yards', Receptions: 'receptions', 'Rush Yards': 'rushing_yards', 'Receiving Yards': 'receiving_yards', 'Pass Completions': 'completions',
    'Pass Attempts': 'attempts', 'Rush Attempts': 'carries', 'Rush+Rec Yds': 'rush_rec_yards', 'Pass+Rush Yds': 'pass_rush_yards' },
});
// Mirror team codes that differ from the stored ids.
const FIXED = { nba: { SAS: 'sa', GSW: 'gs', NOP: 'no', NYK: 'ny', UTA: 'utah', WAS: 'wsh', PHX: 'phx', BKN: 'bkn' }, nfl: { LAR: 'la', WAS: 'was', JAC: 'jax' } };
const FULL = {
  nba: ['atl|Atlanta Hawks','bkn|Brooklyn Nets','bos|Boston Celtics','cha|Charlotte Hornets','chi|Chicago Bulls','cle|Cleveland Cavaliers','dal|Dallas Mavericks','den|Denver Nuggets','det|Detroit Pistons','gs|Golden State Warriors','hou|Houston Rockets','ind|Indiana Pacers','lac|Los Angeles Clippers','lal|Los Angeles Lakers','mem|Memphis Grizzlies','mia|Miami Heat','mil|Milwaukee Bucks','min|Minnesota Timberwolves','no|New Orleans Pelicans','ny|New York Knicks','okc|Oklahoma City Thunder','orl|Orlando Magic','phi|Philadelphia 76ers','phx|Phoenix Suns','por|Portland Trail Blazers','sa|San Antonio Spurs','sac|Sacramento Kings','tor|Toronto Raptors','utah|Utah Jazz','wsh|Washington Wizards'],
  nfl: ['ari|Arizona Cardinals','atl|Atlanta Falcons','bal|Baltimore Ravens','buf|Buffalo Bills','car|Carolina Panthers','chi|Chicago Bears','cin|Cincinnati Bengals','cle|Cleveland Browns','dal|Dallas Cowboys','den|Denver Broncos','det|Detroit Lions','gb|Green Bay Packers','hou|Houston Texans','ind|Indianapolis Colts','jax|Jacksonville Jaguars','kc|Kansas City Chiefs','lv|Las Vegas Raiders','lac|Los Angeles Chargers','la|Los Angeles Rams','mia|Miami Dolphins','min|Minnesota Vikings','ne|New England Patriots','no|New Orleans Saints','nyg|New York Giants','nyj|New York Jets','phi|Philadelphia Eagles','pit|Pittsburgh Steelers','sea|Seattle Seahawks','sf|San Francisco 49ers','tb|Tampa Bay Buccaneers','ten|Tennessee Titans','was|Washington Commanders'],
};
// Short names the mirror also uses.
const ALIASES = { nba: ['lac|LA Clippers', 'lal|LA Lakers'], nfl: ['la|LA Rams', 'lac|LA Chargers'] };
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

export function teamOf(sport) {
  const names = new Map([...FULL[sport], ...ALIASES[sport]].map((v) => { const [code, name] = v.split('|'); return [foldName(name), code]; }));
  return (v) => { const s = String(v || ''); return FIXED[sport][s.toUpperCase()] || names.get(foldName(s)) || teamCode(s, sport); };
}

// The last stored game of each player strictly before a date, as playerFor's
// history map (newest first, one row is all it reads).
function historyBefore(byPlayer, date) {
  return {
    get(id) {
      const list = byPlayer.get(id);
      if (!list) return [];
      let lo = 0, hi = list.length; // oldest first; first index with date >= date
      while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].date < date) lo = mid + 1; else hi = mid; }
      return lo ? [list[lo - 1]] : [];
    },
  };
}

// One sport's seed rows from the mirror's commit history.
export function seedFromSnapshots({ sport, snapshots, games, rows, players }) {
  const team = teamOf(sport), stats = MIRROR_STATS[sport], audit = {};
  const byPlayer = new Map();
  for (const r of rows) { if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []); byPlayer.get(r.player_id).push(r); }
  for (const list of byPlayer.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  const out = new Map();
  for (const { data, committed } of snapshots) {
    const observed = Date.parse(data?.scrapedAt), committedMs = Date.parse(committed);
    // A capture time that does not fit its commit is not trusted.
    if (!Number.isFinite(observed) || observed > committedMs + 60000 || committedMs - observed > 10 * 60000) { bump(audit, 'untrusted_capture_time'); continue; }
    if (data.collectionStatus?.ok === false) { bump(audit, 'failed_feed'); continue; }
    const capture = localDate(observed, 'America/New_York');
    const history = historyBefore(byPlayer, capture);
    const seenHere = new Map(), ambiguous = new Set();
    for (const p of data.props || []) {
      const stat = stats[p.stat];
      if (!stat || !MODEL_SPECS[sport][stat]) { bump(audit, 'other_stat'); continue; }
      const line = Number(p.line), start = Date.parse(p.startTimeIso);
      if (p.oddsType !== 'standard' || (p.status != null && p.status !== 'pre_game') || typeof p.player !== 'string' || !p.player.trim() || p.line == null || String(p.line).trim() === ''
        || !Number.isFinite(line) || line < 0 || line > 1000 || (line * 2) % 1) { bump(audit, 'nonstandard'); continue; }
      if (!Number.isFinite(start) || start <= observed || start - observed > DAY) { bump(audit, 'outside_pregame_day'); continue; }
      const t = team(p.teamCode || p.Team), o = team(p.opponentCode || p.Opponent);
      const matches = games.filter((g) => t !== o && [g.home_team, g.away_team].includes(t) && [g.home_team, g.away_team].includes(o) && Math.abs(Date.parse(g.start_utc) - start) <= 10 * 60000);
      if (matches.length !== 1) { bump(audit, 'schedule_mismatch'); continue; }
      const game = matches[0];
      const hit = playerFor({ player_name: p.player }, players, history, game, 'nba');
      if (!hit || hit.team_changed || history.get(hit.player.player_id)[0]?.team !== t) { bump(audit, 'player_unmatched'); continue; }
      const key = game.game_id + '|' + hit.player.player_id + '|' + stat;
      // Two different lines for one player and stat on one board: dropped.
      if (seenHere.has(key) && seenHere.get(key) !== line) { ambiguous.add(key); continue; }
      seenHere.set(key, line);
      if (!out.has(key)) out.set(key, [localDate(Date.parse(game.start_utc), 'America/New_York'), game.game_id, hit.player.player_id, stat, line]);
    }
    for (const k of ambiguous) { if (out.get(k) && seenHere.has(k)) out.delete(k); bump(audit, 'ambiguous'); }
  }
  const list = [...out.values()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || a[3].localeCompare(b[3]));
  audit.kept = list.length;
  return { rows: list, audit };
}

function readSnapshots(mirror, sport) {
  const file = 'data/prizepicks-' + (sport === 'nba' ? 'nba-today' : 'nfl') + '.json';
  const git = (args) => execFileSync('git', args, { cwd: mirror, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commits = git(['log', '--reverse', '--format=%H %cI', '--', file]).split('\n').filter(Boolean);
  const out = [];
  for (const c of commits) {
    const [sha, committed] = c.split(' ');
    try { out.push({ sha, committed, data: JSON.parse(git(['show', sha + ':' + file])) }); } catch { /* a broken snapshot is skipped */ }
  }
  return { snapshots: out, head: git(['rev-parse', 'HEAD']) };
}

async function localStore(dir) {
  const mem = new Map();
  for (const f of await readdir(dir)) mem.set(f.replace(/__/g, '/'), await readFile(resolve(dir, f)));
  return { rawGet: async (k) => mem.get(k) ?? null, keys: () => [...mem.keys()], backend: 'mem' };
}

async function main() {
  const arg = (name) => { const a = process.argv.find((x) => x.startsWith('--' + name + '=')); const i = process.argv.indexOf('--' + name); return a ? a.split('=').slice(1).join('=') : i > 0 ? process.argv[i + 1] : null; };
  const mirror = arg('mirror');
  if (!mirror) throw new Error('--mirror <clone of github.com/enkday/prizepicks-data-mirror> is required');
  const sports = (arg('sport') || 'nba,nfl').split(',');
  for (const sport of sports) {
    const storeDir = arg('store') ? resolve(String(arg('store')).replace('{sport}', sport)) : null;
    const store = storeDir ? await localStore(storeDir) : (await import('../lib/datastore.mjs')).createStore();
    const load = (kind, opts = {}) => readSportsJson(store, sportsKey(kind, { sport, ...opts }));
    const status = await load('status').catch(() => null);
    let seasons = [...new Set([...(status?.seasons || []), ...(status?.model?.seasons || [])])];
    if (!seasons.length && store.keys) seasons = [...new Set(store.keys().map((k) => k.match(new RegExp(sport + '/player-games/(\\d+)'))?.[1]).filter(Boolean).map(Number))];
    const games = [], rows = [];
    for (const season of seasons) {
      games.push(...((await load('games', { season }).catch(() => null))?.games || []));
      rows.push(...unpackRows(await load('player-games', { season }).catch(() => null)));
    }
    const players = (await load('players'))?.players || [];
    const { snapshots, head } = readSnapshots(mirror, sport);
    const { rows: seed, audit } = seedFromSnapshots({ sport, snapshots, games, rows, players });
    const doc = { schema_version: 1, sport, source: MIRROR_SOURCE, mirror_head: head, generated_utc: new Date().toISOString(),
      from: seed[0]?.[0] || null, to: seed[seed.length - 1]?.[0] || null, snapshots: snapshots.length, fields: MIRROR_FIELDS, audit, rows: seed };
    const path = mirrorSeedPath(sport, ROOT);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, gzipSync(JSON.stringify(doc), { level: 9 }));
    console.log(sport, 'seed lines', seed.length, 'from', doc.from, 'to', doc.to, JSON.stringify(audit));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e?.message || e); process.exit(1); });
