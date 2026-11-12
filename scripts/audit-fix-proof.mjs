// Reproduce the product defects in the unchanged integration base, then run
// identical probes against the working tree. No provider or store access.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = process.argv[2] || '5187aa091aabc1b7cdf8296ce6aef8ea2e7c2370';
const temp = await mkdtemp(join(tmpdir(), 'stonks-fix-proof-'));
async function probe(dir) {
  const mod = name => import(pathToFileURL(resolve(dir, 'lib', name)));
  const [{ inboxView }, { buildHistoryRhymes }, { evaluateOutcomes }, { latentOf, cleanTeamLeg }, { evaluateEntry }, { buildTeamModel, forecastGame }] = await Promise.all([
    mod('contact-messages.mjs'), mod('history-rhymes.mjs'), mod('sports/entry-price.mjs'), mod('sports/bets.mjs'), mod('sports/journal.mjs'),
    mod('sports/team-model.mjs'),
  ]);
  const at = '2026-11-12T09:00:00Z';
  const inbox = inboxView({ messages: ['first', 'second', 'third'].map(title => ({ at, title })) }).messages.map(m => m.title);
  const signs = buildHistoryRhymes({ builtAtIso: at, chains: { SMH: { spot: 70, fundamentals: { fiftyTwoWeekHigh: 100 } }, CRWV: { fundamentals: { operatingCashFlow: -5e9, capitalAllocation: { capexTtm: 10e9 } } } } }).now.signs;
  const game = { game_id: 'proof-game', sport: 'nba', season: 2026, home_team: 'lal', away_team: 'gs', status: 'scheduled', local_date: '2026-11-13', start_utc: '2026-11-14T00:00:00Z' };
  const legs = [{ kind: 'team', sport: 'nba', game_id: game.game_id, market: 'spread', team: 'lal', side: 'over', line: -6, probability: .4, push: .05 },
    { kind: 'team', sport: 'nba', game_id: game.game_id, market: 'win_by', team: 'lal', side: 'over', line: 6, probability: .45 }].map(l => ({ ...l, latent: latentOf(l, game) }));
  const parlay = evaluateOutcomes({ legs, groups: [{ legs: [0, 1] }], joints: { nba: null }, stake: 10, format: 'parlay', payouts: { 2: 3.61 }, prices: [1.9, 1.9] });
  const body = { legs: [{ kind: 'team', sport: 'nba', game_id: game.game_id, market: 'total', side: 'over', line: 220.5, probability: .5 }], operator: 'sportsbook', format: 'power', stake: 10, payouts: { 1: 2 } };
  const input = async (changes, strict = true) => {
    try { const r = await evaluateEntry({ load: async kind => kind === 'games' ? { games: [game, { ...game, game_id: 'proof-game-2' }] } : kind === 'players' ? { players: [{ player_id: 'proof-player', name: 'Proof player', team: 'lal' }] } : null, body: { ...body, ...changes }, strict, now: Date.parse(at) }); return { status: 200, stake: r.stake, probability: r.legs[0].probability }; }
    catch (e) { if (e.status !== 400) throw e; return { status: 400 }; }
  };
  const player = { sport: 'nba', game_id: game.game_id, player_id: 'proof-player', stat: 'points', side: 'over', threshold: 10 };
  const { nbaModelLeague } = await import(pathToFileURL(resolve(dir, 'scripts/fixtures/sports-model.mjs')));
  const model = buildTeamModel({ sport: 'nba', games: [...nbaModelLeague({ start: '2024-10-21', season: 2024 }).games, ...nbaModelLeague().games], now: Date.parse(at) });
  const modelGame = { ...game, home_team: 'gs', away_team: 'phx' };
  const priced = await evaluateEntry({ load: async kind => kind === 'games' ? { games: [modelGame] } : kind === 'team-model' ? model : null,
    body: { ...body, legs: [{ ...body.legs[0], line: Math.round(forecastGame(model, modelGame).expected.total), probability: .9999, price: 1.91 }], format: 'parlay' }, now: Date.parse(at) });
  const source = await readFile(resolve(dir, 'scripts/render/sports-client.mjs'), 'utf8');
  const fn = source.slice(source.indexOf('function tbDefaultLine('), source.indexOf('function tbPrice(')).trim();
  const defaultLine = new Function('halfUp', 'return (' + fn + ')')(x => Math.round(x - .5) + .5);
  const line = defaultLine({ market: { total: 221.25, home_margin: -10.25 } }, game, { market: 'total', team: null }, 'nba');
  return { inbox, funding: signs.find(s => s.id === 'capex-vs-cash').status, missingGrowth: signs.find(s => s.id === 'leaders-crack').status,
    parlay: { profit: parlay.expected_net, range: parlay.expected_net_range },
    subcent: await input({ stake: .001 }), nearZero: await input({ legs: [{ ...body.legs[0], probability: .000001 }] }), nearOne: await input({ legs: [{ ...body.legs[0], probability: .999999 }] }),
    integerRange: await input({ legs: [player, { ...player, side: 'under', threshold: 11 }] }, false),
    fantasyRange: await input({ legs: [{ ...player, stat: 'fantasy' }, { ...player, stat: 'fantasy', side: 'under', threshold: 10.5 }] }, false),
    differentGames: await input({ legs: [player, { ...player, game_id: 'proof-game-2' }] }, false),
    quarterLine: { line, accepted: !cleanTeamLeg({ market: 'total', side: 'over', line }).error },
    pushConsistency: { totalProbability: priced.legs[0].probability + priced.legs[0].push, legEdge: priced.legs[0].odds.edge, entryEdge: priced.evaluation.expected_roi } };
}
try {
  await writeFile(join(temp, 'source.tar'), execFileSync('git', ['archive', base, 'lib', 'scripts', 'package.json'], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
  execFileSync('tar', ['-xf', join(temp, 'source.tar'), '-C', temp]);
  await symlink(resolve(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
  const before = await probe(temp), after = await probe(root);
  assert.deepEqual(before.inbox, ['first', 'second', 'third']); assert.deepEqual(after.inbox, ['third', 'second', 'first']);
  assert.deepEqual([before.funding, after.funding], ['unknown', 'lit']);
  assert.deepEqual([before.missingGrowth, after.missingGrowth], ['lit', 'unknown']);
  assert.deepEqual(before.parlay, { profit: 5.39, range: { low: 4.44, high: 4.44 } });
  assert.deepEqual(after.parlay, { profit: 5.39, range: { low: 5.39, high: 5.39 } });
  for (const name of ['subcent', 'nearZero', 'nearOne']) { assert.equal(before[name].status, 200); assert.equal(after[name].status, 400); }
  assert.equal(before.subcent.stake, 0); assert.equal(before.nearZero.probability, 0); assert.equal(before.nearOne.probability, 1);
  assert.deepEqual([before.integerRange.status, after.integerRange.status], [200, 400]);
  for (const name of ['fantasyRange', 'differentGames']) assert.deepEqual([before[name].status, after[name].status], [400, 200]);
  assert.deepEqual(before.quarterLine, { line: 221.25, accepted: false });
  assert.deepEqual(after.quarterLine, { line: 221.5, accepted: true });
  assert(before.pushConsistency.totalProbability > 1); assert.notEqual(before.pushConsistency.legEdge, before.pushConsistency.entryEdge);
  assert(after.pushConsistency.totalProbability <= 1); assert.equal(after.pushConsistency.legEdge, after.pushConsistency.entryEdge);
  const report = { base, before, after, checks: 12, result: 'Each original defect reproduces in the base and is fixed in the working tree.' };
  await writeFile(process.env.AUDIT_PROOF_OUTPUT || join(tmpdir(), 'stonks-fix-proof.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await rm(temp, { recursive: true, force: true }); }
