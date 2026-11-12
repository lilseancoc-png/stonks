#!/usr/bin/env node
// Owner Sports same-game chances (lib/sports/joint.mjs, lib/sports/normal.mjs):
// the normal-curve math, the seeded simulation against exact answers, the
// link fit and its later-games check on records with a known link, the
// pricing of an entry (power and flex, range, bounds, reasons for no
// number), and the Pick Builder route on a made-up league with a shared game
// pace. Offline, fake store.
import assert from 'node:assert/strict';
import { normCdf, invNorm, bvnUpper, seededNormals, seededRandom, seedOf } from '../lib/sports/normal.mjs';
import { relationOf, linkKey, linkInterval, fitJoint, choleskyOf, simulateGroup, jointEvaluation, linkLabel, JOINT_VERSION, JOINT_METHOD, JOINT_DRAWS } from '../lib/sports/joint.mjs';
import { poissonBinomial, payoutValue, evaluatePayout, sameGameGroups } from '../lib/sports/payout.mjs';
import { buildModel, modelSummary } from '../lib/sports/models.mjs';
import { packRows } from '../lib/sports/rows.mjs';
import { sportsKey } from '../lib/sports/store.mjs';
import { handleSportsRequest } from '../lib/sports/http.mjs';
import { nbaModelLeague } from './fixtures/sports-model.mjs';
import { evaluateOutcomes } from '../lib/sports/entry-price.mjs';
import { latentOf } from '../lib/sports/bets.mjs';
import { GAME_STATS } from '../lib/sports/joint.mjs';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, msg, tol = 1e-6) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); checks++; };

// --- normal-curve math ---------------------------------------------------------------
for (const p of [1e-6, 0.01, 0.0242, 0.0243, 0.2, 0.5, 0.77, 0.99, 1 - 1e-6]) near(normCdf(invNorm(p)), p, 'inverse normal round trip at ' + p, 2e-7);
near(invNorm(0.975), 1.959963985, 'inverse normal at 97.5%', 1e-8);
near(invNorm(0.5), 0, 'inverse normal at the middle', 1e-12);
// Closed form at the middle: P(X>0, Y>0) = 1/4 + asin(r) / 2π.
for (const r of [-0.9, -0.5, 0.1, 0.5, 0.9]) near(bvnUpper(0, 0, r), 0.25 + Math.asin(r) / (2 * Math.PI), 'two-normal chance at zero, r=' + r, 1e-7);
near(bvnUpper(0.4, -1.1, 0), normCdf(-0.4) * normCdf(1.1), 'no link: the chances multiply', 1e-12);
near(bvnUpper(0.3, -0.7, 0.4), bvnUpper(-0.7, 0.3, 0.4), 'order does not matter', 1e-12);
{
  // Against a direct simulation.
  const g = seededNormals(11), N = 400000;
  for (const [h, k, r] of [[0.3, -0.7, 0.4], [1.2, 0.8, -0.3], [0.5, 1.5, 0.85]]) {
    let c = 0;
    for (let i = 0; i < N; i++) { const a = g(), b = r * a + Math.sqrt(1 - r * r) * g(); if (a > h && b > k) c++; }
    near(bvnUpper(h, k, r), c / N, 'two-normal chance matches a simulation', 0.003);
  }
}
{
  const a = seededNormals(5), b = seededNormals(5), c = seededNormals(6);
  const xs = Array.from({ length: 5 }, () => a()), ys = Array.from({ length: 5 }, () => b());
  eq(xs, ys, 'the same seed gives the same draws');
  ok(xs[0] !== c(), 'another seed gives other draws');
  const u = seededRandom(3); ok(Array.from({ length: 1000 }, u).every((x) => x >= 0 && x < 1), 'uniform draws stay in [0, 1)');
  eq(seedOf('abc'), seedOf('abc'));
  ok(seedOf('abc') !== seedOf('abd'), 'seeds follow the text');
}

// --- relations and keys -------------------------------------------------------------
const P = (player_id, team, stat = 'points') => ({ player_id, team, stat });
eq([relationOf(P('a', 'gs'), P('a', 'gs')), relationOf(P('a', 'gs'), P('b', 'gs')), relationOf(P('a', 'gs'), P('c', 'lal'))], ['same_player', 'teammate', 'opponent']);
eq([linkKey('rebounds', 'points', 'teammate'), linkKey('points', 'rebounds', 'teammate'), linkKey('points', 'points', 'opponent')], ['points|rebounds|teammate', 'points|rebounds|teammate', 'points|points|opponent'], 'keys do not depend on order');
eq(linkLabel(['passing_yards', 'receptions'], 'teammate'), 'passing yards and receptions, teammates');
{
  const iv = linkInterval(0.3, 1003);
  ok(iv.low < 0.3 && 0.3 < iv.high && iv.high - iv.low < 0.13, 'the 95% interval brackets the link');
  ok(linkInterval(0.3, 103).high - linkInterval(0.3, 103).low > iv.high - iv.low, 'fewer games, wider interval');
  eq(linkInterval(0.3, 2), { low: -0.9, high: 0.9 }, 'almost no games: the widest interval');
}

// --- correlation matrices ----------------------------------------------------------
{
  const R = [[1, 0.5, 0.2], [0.5, 1, 0.3], [0.2, 0.3, 1]];
  const { L, shrink } = choleskyOf(R);
  eq(shrink, 1, 'a valid matrix is kept as is');
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(L[i].reduce((s, v, k) => s + v * L[j][k], 0), R[i][j], 'L·Lᵀ rebuilds the links', 1e-12);
  const bad = choleskyOf([[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]]);
  ok(bad.shrink < 1 && bad.shrink > 0, 'links that do not fit together are pulled toward 0');
}

// --- one game's simulation against exact answers ---------------------------------------
const link = (v, w = 0.05) => ({ link: v, interval: { low: v - w, high: v + w } });
{
  const legs = [{ side: 'over', probability: 0.55 }, { side: 'over', probability: 0.4 }];
  const sim = simulateGroup({ legs, links: { '0,1': link(0.3) }, seed: 42 });
  const exact = bvnUpper(invNorm(0.45), invNorm(0.6), 0.3);
  const se = Math.sqrt(exact * (1 - exact) / JOINT_DRAWS);
  near(sim.all, exact, 'two overs: simulation matches the exact chance', 4 * se);
  near(sim.distribution.reduce((a, b) => a + b, 0), 1, 'the distribution adds up to one', 1e-9);
  near(sim.distribution[1] + 2 * sim.distribution[2], 0.95, 'expected wins = sum of the chances', 0.006);
  ok(sim.low < sim.all && sim.all < sim.high, 'the range brackets the estimate');
  near(simulateGroup({ legs, links: { '0,1': link(0.3, 0) }, seed: 42 }).all, sim.all, 'common draws: the same seed gives the same estimate', 1e-12);
  const flip = simulateGroup({ legs: [legs[0], { side: 'under', probability: 0.4 }], links: { '0,1': link(0.3) }, seed: 42 });
  near(flip.all, bvnUpper(invNorm(0.45), invNorm(0.6), -0.3), 'an over with an under: a positive link works against both hitting', 4 * se);
  ok(flip.low < flip.all && flip.all < flip.high, 'the range still brackets it');
  const indep = simulateGroup({ legs, links: { '0,1': link(0, 0) }, seed: 9 });
  near(indep.all, 0.22, 'no link: about the product', 0.006);
  eq(simulateGroup({ legs, links: { '0,1': link(0.3) }, seed: 42 }), sim, 'deterministic');
}
{
  // Three picks, one shared link pattern: the exact-k chances by brute force on a fine grid are
  // replaced by two facts that must hold: they add up to one and the mean is the sum of the chances.
  const legs = [{ side: 'over', probability: 0.6 }, { side: 'over', probability: 0.5 }, { side: 'under', probability: 0.45 }];
  const links = { '0,1': link(0.25), '0,2': link(0.1), '1,2': link(-0.05) };
  const sim = simulateGroup({ legs, links, seed: 7 });
  near(sim.distribution.reduce((a, b) => a + b, 0), 1, 'three picks add up to one', 1e-9);
  near(sim.distribution.reduce((a, p, k) => a + p * k, 0), 1.55, 'three picks: expected wins', 0.01);
  ok(sim.all >= Math.max(0, 1.55 - 2) && sim.all <= 0.45, 'inside the any-link bounds');
}

// --- fitting links on records with a known link -----------------------------------------
{
  // 3000 made-up games: two teams of three, two stats. Teammates' points
  // share a link of 0.35, opponents 0, the same player's two stats 0.5.
  // Earlier 1800 games train, the later 1200 are scored.
  const g = seededNormals(3), recs = [];
  for (let d = 0; d < 3000; d++) {
    const shared = { a: g(), b: g() };
    for (const team of ['a', 'b']) {
      for (let i = 0; i < 3; i++) {
        const own = g(), z1 = Math.sqrt(0.35) * shared[team] + Math.sqrt(0.65) * own;
        const z2 = 0.5 * z1 + Math.sqrt(0.75) * g();
        for (const [stat, z] of [['points', z1], ['rebounds', z2]]) {
          const p = 0.3 + 0.4 * ((i + d) % 5) / 4; // chances from 30% to 70%
          const r = { stat, game_id: 'g' + d, team, player_id: team + i, z };
          if (d < 1800) r.zTrain = z; else { r.pTest = p; r.y = z > invNorm(1 - p) ? 1 : 0; }
          recs.push(r);
        }
      }
    }
  }
  const J = fitJoint(recs);
  eq([J.version, J.method], [JOINT_VERSION, JOINT_METHOD]);
  const pp = J.pairs;
  near(pp['points|points|teammate'].link, 0.35, 'finds the teammate link', 0.05);
  near(pp['points|points|opponent'].link, 0, 'finds no opponent link', 0.05);
  near(pp['points|rebounds|same_player'].link, 0.5, 'finds the same-player link', 0.05);
  near(pp['points|rebounds|teammate'].link, 0.175, 'teammate points and rebounds: 0.35 × 0.5', 0.05);
  eq([pp['points|points|teammate'].games, pp['points|points|teammate'].pairs], [3000, 3000 * 2 * 3], 'counts games and unordered pairs');
  eq(pp['points|points|teammate'].status, 'validated', 'a real link beats independence on later games');
  ok(pp['points|points|teammate'].test.brier.copula < pp['points|points|teammate'].test.brier.independent, 'with a better score');
  const bc = pp['points|rebounds|same_player'].test.both_cleared;
  ok(Math.abs(bc.copula - bc.observed) < Math.abs(bc.independent - bc.observed), 'the link gets the both-cleared rate closer than independence');
  ok(pp['points|rebounds|same_player'].link_train != null && pp['points|rebounds|same_player'].test.pairs === 1200 * 6, 'scored on later games only');
  // Too few games: no link at all; few later pairs: experimental.
  const few = fitJoint(recs.filter((r) => Number(r.game_id.slice(1)) < 20));
  eq(Object.keys(few.pairs), [], 'fewer than 30 games: no link is stored');
  const short = fitJoint(recs.filter((r) => Number(r.game_id.slice(1)) < 1820));
  eq([short.pairs['points|rebounds|same_player'].status, short.pairs['points|rebounds|same_player'].reason], ['experimental', 'fewer than 300 later pairs to check']);
  eq(fitJoint([]).pairs, {});
  // A link the later games do not back up is not validated.
  const broken = recs.map((r) => (r.pTest != null && r.stat === 'points' ? { ...r, y: (Number(r.game_id.slice(1)) + r.player_id.charCodeAt(1)) % 2 } : r));
  ok(fitJoint(broken).pairs['points|points|teammate'].status === 'experimental', 'scores that ignore the link fail the check');
}

// --- pricing an entry ---------------------------------------------------------------------
const joints = {
  nba: { version: JOINT_VERSION, method: JOINT_METHOD, pairs: {
    'points|points|teammate': { stats: ['points', 'points'], relation: 'teammate', link: -0.05, interval: { low: -0.08, high: -0.02 }, status: 'validated' },
    'points|points|opponent': { stats: ['points', 'points'], relation: 'opponent', link: 0.12, interval: { low: 0.08, high: 0.16 }, status: 'experimental' },
    'points|rebounds|same_player': { stats: ['points', 'rebounds'], relation: 'same_player', link: 0.3, interval: { low: 0.27, high: 0.33 }, status: 'validated' },
  } },
};
const L_ = (player_id, team, game_id, stat, side, probability, extra = {}) => ({ sport: 'nba', player_id, team, game_id, stat, side, probability, team_in_game: true, model: { regular_role: true }, ...extra });
{
  const legs = [L_('lbj', 'lal', 'g1', 'points', 'over', 0.55), L_('lbj', 'lal', 'g1', 'rebounds', 'over', 0.5), L_('sc', 'gs', 'g2', 'points', 'over', 0.6)];
  const groups = sameGameGroups(legs);
  const E = jointEvaluation({ legs, groups, joints, asOf: { nba: '2026-01-14' }, versions: { nba: 'sports-model-1' }, stake: 10, format: 'power', payouts: { 3: 6 } });
  eq([E.status, E.quality, E.method, E.as_of_date, E.model_version], ['joint_estimate', 'validated', JOINT_METHOD, '2026-01-14', 'sports-model-1']);
  const pair = bvnUpper(invNorm(0.45), invNorm(0.5), 0.3);
  near(E.joint_probability, pair * 0.6, 'same game by link, other game multiplied', 0.006);
  near(E.independent_probability, 0.165, 'independent number for comparison', 1e-9);
  ok(E.joint_probability > E.independent_probability, 'a positive link raises the all-hit chance');
  ok(E.bounds.low <= E.range.low && E.range.low <= E.joint_probability && E.joint_probability <= E.range.high && E.range.high <= E.bounds.high, 'the range sits inside the any-link bounds');
  near(E.expected_gross, 10 * 6 * E.distribution[3], 'power pays only on all three', 0.01);
  eq(E.expected_net, Math.round((E.expected_gross - 10) * 100) / 100);
  ok(E.expected_net_range.low <= E.expected_net && E.expected_net <= E.expected_net_range.high, 'expected profit across the range');
  eq(E.breakeven_probability, 0.166667);
  eq(E.links, [{ legs: [0, 1], relation: 'same_player', stats: ['points', 'rebounds'], link: 0.3, low: 0.27, high: 0.33, status: 'validated' }]);
  eq(E.simulation.draws, JOINT_DRAWS);
  eq(jointEvaluation({ legs, groups, joints, stake: 10, format: 'power', payouts: { 3: 6 } }).simulation.seed, E.simulation.seed, 'same entry, same seed');
  ok(jointEvaluation({ legs: legs.map((l, i) => (i ? l : { ...l, probability: 0.56 })), groups, joints, stake: 10, format: 'power', payouts: { 3: 6 } }).simulation.seed !== E.simulation.seed, 'another chance, another seed');
  // Flex: pays for 2 of 3 as well.
  const F = jointEvaluation({ legs, groups, joints, stake: 10, format: 'flex', payouts: { 3: 3, 2: 1 } });
  near(F.expected_gross, 10 * (3 * F.distribution[3] + F.distribution[2]), 'flex expected payback from the exact-k chances', 0.01);
  near(F.distribution.reduce((a, b) => a + b, 0), 1, 'flex chances add up to one', 1e-5);
  ok(!('expected_net_range' in F) && F.breakeven_probability === null, 'flex: no single breakeven');
  // Opponents' link is experimental; so is a player outside the regular role.
  const opp = [L_('lbj', 'lal', 'g1', 'points', 'over', 0.55), L_('ad', 'gs', 'g1', 'points', 'over', 0.5)];
  const O = jointEvaluation({ legs: opp, groups: sameGameGroups(opp), joints, stake: 5, format: 'power', payouts: { 2: 3 } });
  eq([O.status, O.quality, O.quality_reason], ['joint_estimate', 'experimental', 'a link did not pass its check on later games']);
  const bench = [legs[0], { ...legs[1], model: { regular_role: false } }];
  eq(jointEvaluation({ legs: bench, groups: sameGameGroups(bench), joints, stake: 5, format: 'power', payouts: { 2: 3 } }).quality, 'experimental', 'a bench player is never validated');
  // Reasons for no number.
  const none = (ls, js) => jointEvaluation({ legs: ls, groups: sameGameGroups(ls), joints: js, stake: 5, format: 'power', payouts: { [ls.length]: 3 } });
  const noLink = none([L_('a', 'lal', 'g1', 'rebounds', 'over', 0.5), L_('b', 'lal', 'g1', 'rebounds', 'over', 0.5)], joints);
  eq([noLink.status, noLink.reason, noLink.joint_probability], ['not_calculated', 'same_game', undefined]);
  ok(/no measured link yet for rebounds, teammates/.test(noLink.detail), noLink.detail);
  ok(/not been measured/.test(none(opp, { nba: null }).detail), 'no links fitted yet');
  ok(/team in this game is not known/.test(none([opp[0], { ...opp[1], team_in_game: false }], joints).detail), 'a player not on either team');
  ok(/team in this game is not known/.test(none([opp[0], { ...opp[1], team: null }], joints).detail), 'an unknown team');
}
{
  // The plain value helper agrees with the independence baseline.
  const ps = [0.6, 0.5];
  eq(payoutValue({ stake: 10, payouts: { 2: 3 }, distribution: poissonBinomial(ps) }), { expected_gross: 9, expected_net: -1, expected_roi: -0.1 });
  eq(evaluatePayout({ stake: 10, format: 'power', payouts: { 2: 3 }, probabilities: ps }).expected_net, -1);
}

// --- the outcome-table pricer (lib/sports/entry-price.mjs, game bets 2026-11-12) --------
{
  const withLatent = (ls, game) => ls.map((l) => ({ ...l, latent: latentOf(l, game) }));
  // Player picks only: the same numbers and seed as the earlier pricer.
  const legs = withLatent([L_('lbj', 'lal', 'g1', 'points', 'over', 0.55), L_('lbj', 'lal', 'g1', 'rebounds', 'over', 0.5), L_('sc', 'gs', 'g2', 'points', 'over', 0.6)]);
  const groups = sameGameGroups(legs);
  for (const [format, payouts] of [['power', { 3: 6 }], ['flex', { 3: 3, 2: 1 }]]) {
    const old = jointEvaluation({ legs, groups, joints, stake: 10, format, payouts });
    const now = evaluateOutcomes({ legs, groups, joints, stake: 10, format, payouts });
    eq([now.status, now.joint_probability, now.range, now.distribution, now.expected_net, now.simulation.seed], [old.status, old.joint_probability, old.range, old.distribution, old.expected_net, old.simulation.seed], 'player picks price exactly as before (' + format + ')');
  }
  eq(evaluateOutcomes({ legs: legs.slice(2), groups: [], joints, stake: 10, format: 'power', payouts: { 1: 1.5 } }).odds.fair.american, -150, 'fair odds at 60%');
  // Game bets: who wins and the spread read one number, so they are priced
  // exactly with no link: winning AND covering −5.5 is just covering.
  const game = { home_team: 'lal', away_team: 'gs' };
  const T = (market, team, extra) => ({ kind: 'team', sport: 'nba', game_id: 'g1', market, team, side: 'over', team_in_game: true, ...extra });
  const tl = withLatent([T('moneyline', 'lal', { probability: 0.62 }), T('spread', 'lal', { line: -5.5, probability: 0.45 })], game);
  const te = evaluateOutcomes({ legs: tl, groups: sameGameGroups(tl), joints: { nba: null }, stake: 10, format: 'parlay', payouts: { 2: 2.9 } });
  eq([te.status, te.joint_probability, te.shared_numbers, te.links], ['joint_estimate', 0.45, [{ legs: [0, 1] }], []], 'nested picks on one number: the smaller chance');
  // The away team to win reads the same margin from the other side: it
  // cannot win with LAL covering.
  const opp = withLatent([T('spread', 'lal', { line: -5.5, probability: 0.45 }), T('moneyline', 'gs', { probability: 0.38 })], game);
  eq(evaluateOutcomes({ legs: opp, groups: sameGameGroups(opp), joints: { nba: null }, stake: 10, format: 'parlay', payouts: { 2: 4 } }).joint_probability, 0, 'LAL −5.5 and GS to win never both win');
  // A push on one number: win by 6 or more and −6 (whole line) share cut points.
  const push = withLatent([T('spread', 'lal', { line: -6, probability: 0.4, push: 0.05 }), T('win_by', 'lal', { line: 6, probability: 0.45 })], game);
  const pe = evaluateOutcomes({ legs: push, groups: sameGameGroups(push), joints: { nba: null }, stake: 10, format: 'parlay', payouts: { 2: 3 }, prices: [1.9, 1.9] });
  near(pe.joint_probability, 0.4, 'both win when the margin beats 6', 1e-6);
  near(pe.push_chance, 0.05, 'landing on 6 pushes the spread while win-by-6 wins', 1e-6);
  near(pe.expected_gross, 10 * (0.4 * 1.9 * 1.9 + 0.05 * 1.9), 'the pushed pick drops out of the parlay', 0.01);
  // A game total and a player's points need a measured link like any pair.
  const mixed = withLatent([T('total', null, { side: 'over', line: 228.5, probability: 0.5 }), L_('lbj', 'lal', 'g1', 'points', 'over', 0.55)], game);
  const mx = evaluateOutcomes({ legs: mixed, groups: sameGameGroups(mixed), joints, stake: 10, format: 'power', payouts: { 2: 3 } });
  eq([mx.status, mx.missing_links.length], ['not_calculated', 1], 'no measured link: not priced');
  ok(/game total and points, same game|points and game total, same game/.test(mx.detail), mx.detail);
  const withTotal = { nba: { ...joints.nba, pairs: { ...joints.nba.pairs, 'game_total|points|game': { stats: ['game_total', 'points'], relation: 'game', link: 0.25, interval: { low: 0.2, high: 0.3 }, status: 'validated' } } } };
  const mx2 = evaluateOutcomes({ legs: mixed, groups: sameGameGroups(mixed), joints: withTotal, stake: 10, format: 'power', payouts: { 2: 3 } });
  near(mx2.joint_probability, bvnUpper(invNorm(0.5), invNorm(0.45), 0.25), 'priced with the measured game link', 0.006);
  eq(relationOf({ player_id: 'game:g1', stat: 'game_total' }, { player_id: 'lbj', stat: 'points' }), 'game');
  eq(linkLabel(['team_margin', 'points'], 'same_player'), 'team margin and points, one team');
  eq(GAME_STATS, ['team_margin', 'team_points', 'game_total']);
}

// --- Pick Builder route on a league where one game's pace moves both teams --------------
const NOW = Date.parse('2026-01-15T12:00:00Z');
const L = nbaModelLeague({ pace: 0.2 });
const model = buildModel({ sport: 'nba', rows: L.rows, now: NOW });
const jp = model.joint.pairs;
ok(jp['points|points|opponent'].link > 0.06 && jp['points|points|teammate'].link > 0.06, 'a shared pace shows up as a points link between teammates and opponents');
ok(Math.abs(jp['rebounds|rebounds|opponent'].link) < 0.06, 'rebounds, which pace does not touch, show none');
eq(jp['points|points|opponent'].status, 'validated', 'and the pace link passes the later-games check');
const sum = modelSummary(model);
ok(sum.links.length === Object.keys(jp).length && sum.links.every((l) => l.key && l.stats && typeof l.link === 'number'), 'the status summary lists the links');

function fakeR2() {
  const objects = new Map();
  return {
    objects, backend: 'r2',
    rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null),
    rawPut: async (k, v) => { objects.set(k, String(v)); },
    async withLease(name, fn) { return { busy: false, result: await fn(() => {}) }; },
  };
}
const st = fakeR2();
const put = (kind, opts, value) => st.objects.set(sportsKey(kind, opts), JSON.stringify(value));
const next = { sport: 'nba', game_id: 'mnext1', season: 2025, season_type: 'REG', week: null, start_utc: '2026-01-16T03:00:00Z', local_date: '2026-01-15', time_tbd: false, home_team: 'gs', away_team: 'bos', status: 'scheduled', home_score: null, away_score: null, venue: null };
put('games', { sport: 'nba', season: 2025 }, { schema_version: 1, sport: 'nba', season: 2025, games: [...L.games, next] });
put('player-games', { sport: 'nba', season: 2025 }, { schema_version: 1, sport: 'nba', season: 2025, ...packRows(L.rows) });
put('players', { sport: 'nba' }, { schema_version: 1, players: L.players });
put('model', { sport: 'nba' }, { schema_version: 1, ...model, seasons: [2025] });
put('status', { sport: 'nba' }, { schema_version: 1, sport: 'nba', state: 'ok', last_success_utc: '2026-01-15T10:00:00Z', seasons: [2025], counts: { games: 481, player_games: L.rows.length, players: 96 }, model: modelSummary({ ...model, seasons: [2025] }) });
const SAME = { origin: 'https://mingstreet.app', host: 'mingstreet.app', 'x-forwarded-proto': 'https' };
// The injury report is faked (unreachable); tests never use the network.
const noFeed = async () => ({ injuries: { state: 'unavailable', reports: [] } });
async function call(method, query, body) {
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handleSportsRequest({ method, headers: SAME, query, body }, res, { env: { PRIVATE_DATA_ENABLED: '1' }, getSession: async () => ({ sub: 'owner-1', tr: true, tp: true }), store: st, now: () => NOW, loadPropSources: noFeed });
  return res;
}
const gsStar = L.truth.find((p) => p.team === 'gs' && p.minutes === 34), bosStar = L.truth.find((p) => p.team === 'bos' && p.minutes === 34);
const leg = (p, extra = {}) => ({ sport: 'nba', player_id: p.player_id, game_id: 'mnext1', stat: 'points', side: 'over', threshold: 15.5, ...extra });
const status = await call('GET', { sports: 'status' });
const links = status.body.sources.nba.model.links;
ok(links.some((l) => l.relation === 'opponent' && l.stats[0] === 'points' && l.status === 'validated' && l.both_cleared.observed != null), 'the status route carries the links and their check');
const draft = await call('POST', { sports: 'evaluate' }, { legs: [leg(gsStar), leg(bosStar)], operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } });
eq(draft.body.evaluation.status, 'needs_probabilities', 'same game without chances: asks for them');
const priced = await call('POST', { sports: 'evaluate' }, { legs: [leg(gsStar, { probability: 0.55 }), leg(bosStar, { probability: 0.5 })], operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } });
const E = priced.body.evaluation;
eq([E.status, E.quality, E.links[0].relation], ['joint_estimate', 'validated', 'opponent'], 'two stars in one game: priced with the opponents’ link');
ok(E.joint_probability > E.independent_probability, 'a fast game lifts both, so both hitting is likelier than independence says');
near(E.expected_net, 10 * (3 * E.joint_probability - 1), 'expected profit from the joint chance', 0.02);
const saved = await call('POST', { sports: 'save-entry' }, { legs: [leg(gsStar, { probability: 0.55 }), leg(bosStar, { probability: 0.5 })], operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } });
eq(saved.statusCode, 200);
eq([saved.body.entry.evaluation.status, saved.body.entry.evaluation.joint_probability, saved.body.entry.evaluation.simulation.seed], ['joint_estimate', E.joint_probability, E.simulation.seed], 'the saved entry keeps the estimate and its seed');
const journal = await call('GET', { sports: 'journal' });
eq(journal.body.summary.priced_settled, 0, 'nothing settled yet');

console.log(`Sports same-game smoke passed (${checks} checks).`);
