// Read-only, chronological research on archived REAL PrizePicks standard lines.
// Inputs/results live under ignored data/, never in the public data reader.
// No current injuries, fitted models or final-game participants choose a pick.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackRows } from '../lib/sports/rows.mjs';
import { statValue } from '../lib/sports/schema.mjs';
import { buildModel } from '../lib/sports/models.mjs';
import { rankGameProps, PROP_RANK_VERSION } from '../lib/sports/props.mjs';
import { teamCode } from '../lib/sports/prop-sources.mjs';
import { teamTable, matchupView, shownStats, foldName } from '../lib/sports/read.mjs';
import { localDate } from '../lib/sports/time.mjs';

const DAY = 86400000;
const SOURCE = 'https://github.com/enkday/prizepicks-data-mirror';
const STATS = {
  nba: { Points: 'points', Rebounds: 'rebounds', Assists: 'assists', '3-PT Made': 'threes', Steals: 'steals', 'Blocked Shots': 'blocks', Turnovers: 'turnovers' },
  nfl: { 'Pass Yards': 'passing_yards', Receptions: 'receptions', 'Rush Yards': 'rushing_yards', 'Receiving Yards': 'receiving_yards', 'Pass TDs': 'passing_tds', INT: 'interceptions', 'Pass Completions': 'completions', 'Pass Attempts': 'attempts', 'Rush Attempts': 'carries' },
};
// Declare the small experiment family before scoring outcomes. Changes are
// evaluated on validation, and the selected rule gets ONE untouched test.
export const VARIANTS = ['one_per_team', 'stable_workload', 'rank_60', 'history_70', 'exclude_rare_events', 'modeled_only', 'history_only'];
const RARE = new Set(['steals', 'blocks', 'turnovers', 'passing_tds', 'interceptions']);
const nameKey = (n) => foldName(n).replace(/\s+(jr|sr|ii|iii|iv)$/, '');
const round = (n, digits = 4) => n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** digits) / 10 ** digits;

function git(mirror, args) { return execFileSync('git', args, { cwd: mirror, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function bump(o, k, n = 1) { o[k] = (o[k] || 0) + n; }

export function pickPair(candidates, variant = 'one_per_team') {
  const players = new Set(), teams = new Set(), picks = [];
  for (const p of candidates) {
    if (players.has(p.player_id) || variant !== 'legacy' && teams.has(p.team)) continue;
    const w = p.features.workload, ratio = w.last10 > 0 ? w.last5 / w.last10 : null;
    if (variant === 'stable_workload' && !(ratio >= 0.9 && ratio <= 1.1)) continue;
    if (variant === 'rank_60' && p.rank_score < 60) continue;
    if (variant === 'history_70' && p.history.hits / p.history.games < 0.7) continue;
    if (variant === 'exclude_rare_events' && RARE.has(p.stat)) continue;
    if (variant === 'modeled_only' && p.basis !== 'model_and_history') continue;
    players.add(p.player_id); teams.add(p.team); picks.push(p);
    if (picks.length === 2) break;
  }
  return picks;
}

export function gradePick(p, row, hasBox, sport) {
  if (row?.played === false || !row && hasBox && sport === 'nba') return 'void';
  const actual = row?.played ? statValue(row, p.stat) : null;
  return actual == null ? 'awaiting_stats' : actual === p.threshold ? 'push' : (p.side === 'over' ? actual > p.threshold : actual < p.threshold) ? 'win' : 'loss';
}

export function summarize(games, variant) {
  const pairs = games.filter((g) => g.variants[variant].length === 2);
  const picks = pairs.flatMap((g) => g.variants[variant]);
  const wins = picks.filter((p) => p.result === 'win').length, losses = picks.filter((p) => p.result === 'loss').length;
  const resolved = pairs.filter((g) => g.variants[variant].every((p) => ['win', 'loss'].includes(p.result)));
  return { games: games.length, pairs: pairs.length, coverage: round(pairs.length / games.length), partial_games: games.filter((g) => g.variants[variant].length === 1).length,
    wins, losses, pushes: picks.filter((p) => p.result === 'push').length, voids: picks.filter((p) => p.result === 'void').length,
    awaiting_stats: picks.filter((p) => p.result === 'awaiting_stats').length, hit_rate: round(wins / (wins + losses)),
    resolved_pairs: resolved.length, both_win: resolved.filter((g) => g.variants[variant].every((p) => p.result === 'win')).length,
    both_win_rate: round(resolved.filter((g) => g.variants[variant].every((p) => p.result === 'win')).length / resolved.length) };
}

// Resample whole calendar days, preserving both picks and same-day games.
// Seeded, reproducible percentile interval; this does not model season drift.
export function bootstrap(games, variant, other, iterations = 2000) {
  const days = [...new Set(games.map((g) => g.date))].sort();
  const daily = days.map((d) => {
    const day = games.filter((g) => g.date === d), a = summarize(day, variant), b = other ? summarize(day, other) : null;
    return [a.wins, a.wins + a.losses, b?.wins || 0, b ? b.wins + b.losses : 0];
  });
  if (daily.length < 2) return null;
  let seed = 7637;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const values = [];
  for (let i = 0; i < iterations; i++) {
    const total = [0, 0, 0, 0];
    for (let j = 0; j < daily.length; j++) { const x = daily[Math.floor(random() * daily.length)]; for (let k = 0; k < 4; k++) total[k] += x[k]; }
    if (total[1] && (!other || total[3])) values.push(total[0] / total[1] - (other ? total[2] / total[3] : 0));
  }
  values.sort((a, b) => a - b);
  return values.length ? [round(values[Math.floor(values.length * 0.025)]), round(values[Math.min(values.length - 1, Math.floor(values.length * 0.975))])] : null;
}

function teamNames(sport, games) {
  const names = new Map();
  for (const g of games) for (const side of ['home', 'away']) {
    const code = teamCode(g[side + '_team'], sport);
    names.set(foldName(code), code);
    for (const key of [side + '_name', side + '_team_name']) if (g[key]) names.set(foldName(g[key]), code);
  }
  // Mirror files before Dec 7 have full names without codes. Fixed franchise
  // aliases are identities, not a reconstructed future roster.
  const fixed = sport === 'nba'
    ? ['atl|Atlanta Hawks','bkn|Brooklyn Nets','bos|Boston Celtics','cha|Charlotte Hornets','chi|Chicago Bulls','cle|Cleveland Cavaliers','dal|Dallas Mavericks','den|Denver Nuggets','det|Detroit Pistons','gs|Golden State Warriors','hou|Houston Rockets','ind|Indiana Pacers','lac|Los Angeles Clippers','lal|Los Angeles Lakers','mem|Memphis Grizzlies','mia|Miami Heat','mil|Milwaukee Bucks','min|Minnesota Timberwolves','no|New Orleans Pelicans','ny|New York Knicks','okc|Oklahoma City Thunder','orl|Orlando Magic','phi|Philadelphia 76ers','phx|Phoenix Suns','por|Portland Trail Blazers','sa|San Antonio Spurs','sac|Sacramento Kings','tor|Toronto Raptors','utah|Utah Jazz','wsh|Washington Wizards']
    : ['ari|Arizona Cardinals','atl|Atlanta Falcons','bal|Baltimore Ravens','buf|Buffalo Bills','car|Carolina Panthers','chi|Chicago Bears','cin|Cincinnati Bengals','cle|Cleveland Browns','dal|Dallas Cowboys','den|Denver Broncos','det|Detroit Lions','gb|Green Bay Packers','hou|Houston Texans','ind|Indianapolis Colts','jax|Jacksonville Jaguars','kc|Kansas City Chiefs','lv|Las Vegas Raiders','lac|Los Angeles Chargers','la|Los Angeles Rams','mia|Miami Dolphins','min|Minnesota Vikings','ne|New England Patriots','no|New Orleans Saints','nyg|New York Giants','nyj|New York Jets','phi|Philadelphia Eagles','pit|Pittsburgh Steelers','sea|Seattle Seahawks','sf|San Francisco 49ers','tb|Tampa Bay Buccaneers','ten|Tennessee Titans','was|Washington Commanders'];
  for (const v of fixed) { const [code, name] = v.split('|'); names.set(foldName(name), code); }
  return (value) => names.get(foldName(String(value || ''))) || teamCode(value, sport);
}

async function snapshots({ mirror, sport, until, games }) {
  const file = `data/prizepicks-${sport === 'nba' ? 'nba-today' : 'nfl'}.json`;
  const commits = git(mirror, ['log', '--reverse', '--format=%H %cI', '--', file]).split('\n').filter(Boolean);
  const team = teamNames(sport, games), audit = {}, out = new Map(), sources = [];
  const seen = new Set();
  for (const entry of commits) {
    const [sha, committed] = entry.split(' ');
    const raw = git(mirror, ['show', sha + ':' + file]), data = JSON.parse(raw), observed = Date.parse(data.scrapedAt);
    const committedMs = Date.parse(committed);
    if (!Number.isFinite(observed) || observed > committedMs + 60000 || committedMs - observed > 10 * 60000) { bump(audit, 'untrusted_capture_time'); continue; }
    if (data.scrapedAt.slice(0, 10) > until) continue;
    if (data.collectionStatus?.ok === false || data.sport && String(data.sport).toLowerCase() !== sport) { bump(audit, 'failed_or_wrong_sport_feed'); continue; }
    sources.push({ sha, committed, observed_utc: data.scrapedAt, sha256: createHash('sha256').update(raw).digest('hex') });
    const byGame = new Map();
    for (const p of data.props || []) {
      bump(audit, 'raw_props');
      const stat = STATS[sport][p.stat], start = Date.parse(p.startTimeIso), threshold = Number(p.line);
      if (!stat) { bump(audit, 'unsupported_stat'); continue; }
      if (p.oddsType !== 'standard' || p.status != null && p.status !== 'pre_game' || typeof p.player !== 'string' || !p.player.trim() || !Number.isFinite(threshold) || threshold < 0 || threshold > 1000 || threshold * 2 % 1 || p.line == null || String(p.line).trim() === '') { bump(audit, 'nonstandard'); continue; }
      if (!Number.isFinite(start) || start <= observed || start - observed > DAY) { bump(audit, 'outside_pregame_day'); continue; }
      if (p.providerFetchedAt && (Date.parse(p.providerFetchedAt) > observed + 60000 || observed - Date.parse(p.providerFetchedAt) > 10 * 60000 || !Number.isFinite(Date.parse(p.providerFetchedAt)))) { bump(audit, 'stale_provider_time'); continue; }
      const t = team(p.teamCode || p.Team), opponent = team(p.opponentCode || p.Opponent);
      // Use schedule identities/times, never whether this player later played.
      const matches = games.filter((g) => [g.home_team, g.away_team].includes(t) && [g.home_team, g.away_team].includes(opponent) && t !== opponent && Math.abs(Date.parse(g.start_utc) - start) <= 10 * 60000 && Date.parse(g.start_utc) > observed);
      if (matches.length !== 1) { bump(audit, 'schedule_mismatch'); continue; }
      const game = matches[0], date = localDate(Date.parse(game.start_utc), 'America/New_York');
      if (date > until || seen.has(game.game_id)) continue;
      const projectionKey = p.player + '|' + stat;
      const group = byGame.get(game.game_id) || { game, now: observed, observed_utc: data.scrapedAt, source_sha: sha, lines: [], identities: new Map(), ambiguous: new Set() };
      // Conflicting lines on one board are not resolved by picking the easier
      // threshold. Drop that player's entire stat if the archive is ambiguous.
      if (group.identities.has(projectionKey)) {
        if (group.identities.get(projectionKey) !== threshold) group.ambiguous.add(projectionKey);
        continue;
      }
      group.identities.set(projectionKey, threshold);
      for (const side of ['over', 'under']) group.lines.push({ player_name: p.player, stat, threshold, side,
        home_team: game.home_team, away_team: game.away_team, start_utc: p.startTimeIso, observed_utc: data.scrapedAt,
        archive_team: t, archive_key: projectionKey });
      byGame.set(game.game_id, group);
    }
    for (const [id, group] of byGame) {
      group.lines = group.lines.filter((l) => !group.ambiguous.has(l.archive_key));
      bump(audit, 'ambiguous_stats', group.ambiguous.size);
      if (!group.lines.length) continue;
      out.set(id, group); seen.add(id);
    }
  }
  return { samples: [...out.values()].sort((a, b) => a.now - b.now || a.game.game_id.localeCompare(b.game.game_id)), audit, sources, file };
}

async function refreshData(root) {
  const { createStore } = await import('../lib/datastore.mjs');
  const { recordLoader } = await import('../lib/sports/http.mjs');
  const load = recordLoader(createStore());
  for (const sport of ['nba', 'nfl']) {
    const status = await load('status', { sport }), players = await load('players', { sport });
    const seasons = [...new Set([...(status?.seasons || []), ...(status?.model?.seasons || [])])];
    if (!seasons.length) throw new Error('No stored seasons for ' + sport);
    const records = await Promise.all(seasons.map(async (season) => ({ season, games: await load('games', { sport, season }), box: await load('player-games', { sport, season }), record: await load('prop-record', { sport, season }) })));
    await mkdir(resolve(root, 'raw'), { recursive: true });
    await writeFile(resolve(root, 'raw', sport + '.json'), JSON.stringify({ sport, status, players, records }));
  }
}

export async function runBacktest({ root, mirror, until, log = console.log }) {
  const output = { generated_utc: new Date().toISOString(), until, rank_version: PROP_RANK_VERSION, source: SOURCE,
    mirror_head: git(mirror, ['rev-parse', 'HEAD']), limits: ['Real archived morning lines; partial single-stat boards, not the complete PropLine board.', 'Both standard directions assumed available; the mirror does not archive allowed wager sides.', 'Historical injury/news/starting-lineup reports unavailable: no injury/absence adjustments, and this is not a validation of the full live system.', 'Current canonical names identify players, but team and position eligibility come exclusively from prior box rows.', 'Models refit for each snapshot from earlier calendar dates, including prior holdout validation; current fitted models are never loaded.', 'This is a retrospective replay of the current model specification; its original design was informed by some of these seasons.', 'Original box publication times/revisions unavailable; prior calendar-day final stats are assumed available.', 'Original source commits fix archive provenance, but cannot prove the source itself had no historical errors.', 'No payout, profit, operator reboot rule or calibrated rank-probability claim.'], leagues: {} };
  for (const sport of ['nba', 'nfl']) {
    const raw = await readFile(resolve(root, 'raw', sport + '.json'), 'utf8'), data = JSON.parse(raw);
    const games = data.records.flatMap((r) => r.games?.games || []), rows = data.records.flatMap((r) => unpackRows(r.box));
    const byOutcome = new Map(rows.map((r) => [r.game_id + '|' + r.player_id, r])), hasBox = new Set(rows.map((r) => r.game_id));
    const archive = await snapshots({ mirror, sport, until, games });
    const results = [], models = new Map(), tables = new Map(), audit = { ...archive.audit };
    for (const s of archive.samples) {
      const { game, now } = s, captureDate = localDate(now, 'America/New_York'), date = localDate(Date.parse(game.start_utc), 'America/New_York');
      const prior = rows.filter((r) => r.date < captureDate && [game.season, game.season - 1].includes(r.season));
      const last = new Map();
      for (const r of prior) if (!last.has(r.player_id) || last.get(r.player_id).date < r.date) last.set(r.player_id, r);
      // Do not use players.team or their current position (both can be future).
      const players = (data.players?.players || []).filter((p) => last.has(p.player_id)).map((p) => ({ ...p, team: last.get(p.player_id).team, position: last.get(p.player_id).position }));
      const lines = s.lines.filter((l) => players.some((p) => nameKey(p.name) === nameKey(l.player_name) && p.team === l.archive_team));
      bump(audit, 'player_team_unmatched', s.lines.length - lines.length);
      if (!models.has(captureDate)) models.set(captureDate, buildModel({ sport, rows: rows.filter((r) => r.date < captureDate), now, includeJoint: false }));
      const tableKey = game.season + '|' + captureDate;
      if (!tables.has(tableKey)) tables.set(tableKey, teamTable({ sport, rows: prior.filter((r) => r.season === game.season), games: games.filter((g) => g.season === game.season && (g.local_date || g.start_utc.slice(0, 10)) < captureDate), players: new Map(players.map((p) => [p.player_id, p])), stats: shownStats(sport).filter((st) => st !== 'minutes') }));
      const matchup = matchupView({ sport, game, gameDate: captureDate, allGames: games, table: tables.get(tableKey), stats: shownStats(sport).filter((st) => st !== 'minutes') });
      const args = { sport, game: { ...game, status: 'scheduled' }, now, lines, players, rows: prior, allGames: games.filter((g) => (g.local_date || g.start_utc.slice(0, 10)) < captureDate),
        injuries: { state: 'ok', observed_utc: s.observed_utc, reports: [] }, matchup, model: models.get(captureDate), includeCandidates: true };
      const ranked = rankGameProps(args), historyOnly = rankGameProps({ ...args, model: null });
      for (const [k, n] of Object.entries(ranked.skipped)) bump(audit, 'rank_skip_' + k, n);
      const candidates = ranked.ranked_candidates || [], variants = {};
      for (const variant of ['legacy', ...VARIANTS]) variants[variant] = pickPair(variant === 'history_only' ? historyOnly.ranked_candidates || [] : candidates, variant).map((p) => ({ ...p,
        result: gradePick(p, byOutcome.get(game.game_id + '|' + p.player_id), hasBox.has(game.game_id), sport), actual: statValue(byOutcome.get(game.game_id + '|' + p.player_id), p.stat) }));
      if (game.status !== 'final') { bump(audit, 'not_final'); continue; }
      results.push({ game_id: game.game_id, date, capture_date: captureDate, season: game.season, start_utc: game.start_utc,
        observed_utc: s.observed_utc, source_sha: s.source_sha, model_as_of: models.get(captureDate).as_of_date, candidates: candidates.length, variants });
      if (results.length % 100 === 0) log(`${sport}: replayed ${results.length} games`);
    }
    const dates = [...new Set(results.map((g) => g.date))].sort(), validationStart = dates[Math.floor(dates.length * 0.5)], testStart = dates[Math.floor(dates.length * 0.75)];
    const split = { development: results.filter((g) => g.date < validationStart), validation: results.filter((g) => g.date >= validationStart && g.date < testStart), test: results.filter((g) => g.date >= testStart) };
    const metrics = Object.fromEntries(Object.entries(split).map(([phase, gs]) => [phase, Object.fromEntries(['legacy', ...VARIANTS].map((v) => [v, summarize(gs, v)]))]));
    // Eligibility prevents declaring a tiny cherry-picked subset the winner.
    // Choose on validation only, then report that frozen choice on final test.
    const base = metrics.validation.one_per_team;
    const eligible = VARIANTS.filter((v) => { const m = metrics.validation[v]; return m.wins + m.losses >= 100 && m.pairs >= base.pairs * 0.75; });
    eligible.sort((a, b) => metrics.validation[b].hit_rate - metrics.validation[a].hit_rate || VARIANTS.indexOf(a) - VARIANTS.indexOf(b));
    const selected = eligible[0] || 'one_per_team';
    const breakdown = (key) => {
      const picks = split.test.filter((g) => g.variants.one_per_team.length === 2).flatMap((g) => g.variants.one_per_team);
      return Object.fromEntries([...new Set(picks.map(key))].sort().map((k) => { const p = picks.filter((p) => key(p) === k), w = p.filter((p) => p.result === 'win').length, l = p.filter((p) => p.result === 'loss').length; return [k, { wins: w, losses: l, hit_rate: round(w / (w + l)) }]; }));
    };
    const live = data.records.flatMap((r) => r.record?.picks || []);
    const common = split.test.filter((g) => g.variants.one_per_team.length === 2 && g.variants.legacy.length === 2);
    const league = { input_sha256: createHash('sha256').update(raw).digest('hex'), archive_file: archive.file, archived_commits: archive.sources.length, sources: archive.sources,
      audit, games: results.length, dates: [dates[0], dates.at(-1)], split: { validation_start: validationStart, test_start: testStart }, metrics, selected_on_validation: selected,
      test_hit_rate_ci95: bootstrap(split.test, 'one_per_team'), selected_test_delta_ci95: bootstrap(split.test, selected, 'one_per_team'),
      same_game_test_comparison: summarize(split.test.filter((g) => g.variants[selected].length === 2 && g.variants.one_per_team.length === 2), selected),
      same_game_test_baseline: summarize(split.test.filter((g) => g.variants[selected].length === 2 && g.variants.one_per_team.length === 2), 'one_per_team'),
      team_rule_common_games: { old: summarize(common, 'legacy'), new: summarize(common, 'one_per_team'), delta_ci95: bootstrap(common, 'one_per_team', 'legacy') },
      test_breakdown: { stat: breakdown((p) => p.stat), side: breakdown((p) => p.side), basis: breakdown((p) => p.basis), rank: breakdown((p) => String(Math.floor(p.rank_score / 10) * 10)) },
      live_record: { picks: live.length, resolved: live.filter((p) => ['win', 'loss'].includes(gradePick(p, byOutcome.get(p.game_id + '|' + p.player_id), hasBox.has(p.game_id), sport))).length } };
    output.leagues[sport] = league;
    await writeFile(resolve(root, sport + '-replay.json'), JSON.stringify({ sport, results }));
    log(JSON.stringify({ sport, games: results.length, split: league.split, selected, test: metrics.test.one_per_team, selected_test: metrics.test[selected], ci95: league.test_hit_rate_ci95, delta_ci95: league.selected_test_delta_ci95 }));
  }
  await writeFile(resolve(root, 'report.json'), JSON.stringify(output, null, 2));
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), option = (k, fallback) => args.find((a) => a.startsWith(k + '='))?.slice(k.length + 1) || fallback;
  const root = resolve(option('--out', 'data/sports-backtest')), mirror = resolve(option('--mirror', 'data/sports-backtest/mirror')), until = option('--until', new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error('Invalid --until date');
  await mkdir(root, { recursive: true });
  if (args.includes('--refresh-data')) await refreshData(root);
  await runBacktest({ root, mirror, until });
}
