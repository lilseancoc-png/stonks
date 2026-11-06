// Synthetic fixtures only. Verify actual chronological replay, not just math:
// changing future outcomes/rosters cannot change the pregame selections.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pickPair, gradePick, summarize, bootstrap, runBacktest } from './sports-props-backtest.mjs';
import { buildModel } from '../lib/sports/models.mjs';

const candidate = (id, team) => ({ player_id: id, team, rank_score: 60, history: { hits: 15, games: 20 }, features: { workload: { last5: 30, last10: 30 } }, stat: 'points', threshold: 15.5, side: 'over' });
const candidates = [candidate('p0', 'lal'), candidate('p1', 'lal'), candidate('p2', 'gs')];
assert.deepEqual(pickPair(candidates).map((p) => p.player_id), ['p0', 'p2']);
assert.deepEqual(pickPair(candidates, 'legacy').map((p) => p.player_id), ['p0', 'p1']);
assert.equal(pickPair(candidates.slice(0, 2)).length, 1);
assert.equal(gradePick(candidates[0], { played: true, stats: { points: 16 } }, true, 'nba'), 'win');
assert.equal(gradePick({ ...candidates[0], threshold: 16 }, { played: true, stats: { points: 16 } }, true, 'nba'), 'push');
assert.equal(gradePick(candidates[0], null, true, 'nba'), 'void');
assert.equal(gradePick(candidates[0], null, true, 'nfl'), 'awaiting_stats');
assert.equal(gradePick(candidates[0], { played: false }, true, 'nba'), 'void');
const fixtures = [{ date: '2026-01-01', variants: { base: [{ result: 'win' }, { result: 'loss' }] } },
  { date: '2026-01-02', variants: { base: [{ result: 'push' }, { result: 'void' }] } },
  { date: '2026-01-03', variants: { base: [{ result: 'win' }] } }];
assert.equal(summarize(fixtures, 'base').hit_rate, 0.5);
assert.equal(summarize(fixtures, 'base').pairs, 2);
assert.equal(summarize(fixtures, 'base').partial_games, 1);
assert.deepEqual(bootstrap(fixtures, 'base'), bootstrap(fixtures, 'base'), 'seeded clustered intervals are reproducible');

const root = await mkdtemp(join(tmpdir(), 'sports-props-replay-')), mirror = join(root, 'mirror');
try {
  await mkdir(join(mirror, 'data'), { recursive: true }); await mkdir(join(root, 'raw'));
  const git = (args, env = process.env) => execFileSync('git', args, { cwd: mirror, env, stdio: 'pipe' });
  git(['init', '-q']);
  const observed = '2026-11-05T12:00:00Z', game = { game_id: 'g1', season: 2026, local_date: '2026-11-05', start_utc: '2026-11-05T23:00Z', home_team: 'lal', away_team: 'gs', status: 'final' };
  const players = candidates.map((p, i) => ({ player_id: p.player_id, name: 'Fixture ' + i, team: 'future-trade', position: 'future-position' }));
  const history = candidates.flatMap((p) => Array.from({ length: 20 }, (_, i) => ({ player_id: p.player_id, game_id: 'prior-' + i, season: 2026,
    date: new Date(Date.parse('2026-10-16T12:00Z') + i * 86400000).toISOString().slice(0, 10), team: p.team, opponent: p.team === 'lal' ? 'gs' : 'lal', home: p.team === 'lal', played: true, position: 'G', minutes: 32, stats: { points: 25 } })));
  const outcomes = candidates.map((p) => ({ ...history.find((r) => r.player_id === p.player_id), game_id: game.game_id, date: '2026-11-05', stats: { points: 30 } }));
  const raw = { players: { players }, records: [{ season: 2026, games: { games: [game] }, box: { rows: [...history, ...outcomes] } }] };
  const props = candidates.map((p, i) => ({ player: players[i].name, stat: 'Points', line: 15.5, oddsType: 'standard', status: 'pre_game', teamCode: p.team, opponentCode: p.team === 'lal' ? 'gs' : 'lal', startTimeIso: game.start_utc }));
  const malformed = [{ ...props[0], line: ' ' }, { ...props[0], oddsType: 'goblin', line: 0.5 }, { ...props[0], status: 'live' },
    { ...props[0], stat: 'Points 1H' }, { ...props[0], providerFetchedAt: '2026-11-05T13:00Z' }, { ...props[0], startTimeIso: '2026-11-05T11:00Z' }];
  await writeFile(join(mirror, 'data/prizepicks-nba-today.json'), JSON.stringify({ scrapedAt: observed, props: [...props, ...malformed] }));
  await writeFile(join(mirror, 'data/prizepicks-nfl.json'), JSON.stringify({ scrapedAt: observed, props: [] }));
  for (const sport of ['nba', 'nfl']) await writeFile(join(root, 'raw', sport + '.json'), JSON.stringify(sport === 'nba' ? raw : { players: { players: [] }, records: [] }));
  git(['add', 'data']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Pregame snapshot'], { ...process.env, GIT_AUTHOR_DATE: observed, GIT_COMMITTER_DATE: observed });
  const first = await runBacktest({ root, mirror, until: '2026-11-05', log: () => {} });
  const replay1 = JSON.parse(await readFile(join(root, 'nba-replay.json'), 'utf8')).results;
  assert.equal(first.leagues.nba.games, 1);
  assert.equal(first.leagues.nba.audit.nonstandard, 3);
  assert.equal(first.leagues.nba.audit.unsupported_stat, 1);
  assert.equal(first.leagues.nba.audit.stale_provider_time, 1);
  assert.equal(first.leagues.nba.audit.outside_pregame_day, 1);
  assert.deepEqual(replay1[0].variants.one_per_team.map((p) => p.player_id), ['p0', 'p2']);
  assert.equal(replay1[0].model_as_of, '2026-11-04');
  raw.records[0].box.rows = [...history, ...outcomes.map((r) => ({ ...r, position: 'future-change', team: 'future-trade', stats: { points: 0 } }))];
  await writeFile(join(root, 'raw/nba.json'), JSON.stringify(raw));
  await runBacktest({ root, mirror, until: '2026-11-05', log: () => {} });
  const replay2 = JSON.parse(await readFile(join(root, 'nba-replay.json'), 'utf8')).results;
  const selected = (rs) => rs[0].variants.one_per_team.map(({ result, actual, ...p }) => p);
  assert.deepEqual(selected(replay1), selected(replay2), 'future stats and team changes cannot alter selections or forecasts');
  assert.notEqual(replay1[0].variants.one_per_team[0].result, replay2[0].variants.one_per_team[0].result, 'outcomes are used only for grading');
  const full = buildModel({ sport: 'nba', rows: history, now: Date.parse(observed) });
  const fast = buildModel({ sport: 'nba', rows: history, now: Date.parse(observed), includeJoint: false });
  assert.deepEqual({ ...full, joint: null }, fast, 'research can skip unused joint fitting without changing forecasts or validation');
} finally { await rm(root, { recursive: true, force: true }); }
console.log('Sports props backtest passed: actual replay cutoff, future outcome/roster invariance, team constraints, grading and clustered intervals.');
