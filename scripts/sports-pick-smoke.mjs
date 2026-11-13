// Pick Builder for the Owner Sports section: the payout math (roadmap V4
// §5.2-5.4 fixtures), entry checks against stored games, the paper journal
// (save under a lease, settle from final stats, owner revisions) and the
// route. Offline: fixture CSV only, fake R2 store.
//   node scripts/sports-pick-smoke.mjs
import assert from 'node:assert/strict';
import { legResult, poissonBinomial, jointBounds, payoutProblems, evaluatePayout, sameGameGroups, settleFromLegs, perPickBreakeven, wilsonRange, evCheck } from '../lib/sports/payout.mjs';
import { unpackRows } from '../lib/sports/rows.mjs';
import { evaluateEntry, saveEntry, reviseEntry, journalView, hitHistory, ownerTag } from '../lib/sports/journal.mjs';
import { ingestLeague } from '../lib/sports/ingest.mjs';
import { NBA_SOURCE, HOOPR_URLS } from '../lib/sports/hoopr.mjs';
import { NFL_SOURCE, NFLVERSE_URLS } from '../lib/sports/nflverse.mjs';
import { handleSportsRequest, recordLoader } from '../lib/sports/http.mjs';
import { SPORTS_PREFIX } from '../lib/sports/store.mjs';
import { parsePrice, cleanTeamLeg, teamLegLabel, milestoneLabel, teamLegResult, fairOdds, americanOf, neverBothWin, winSpan } from '../lib/sports/bets.mjs';
import { encodePrefill, decodePrefill } from '../lib/sports/prefill.mjs';
import { sportsFactory } from './render/sports-client.mjs';
import { SCHEDULE_2026, SCHEDULE_2027, BOX_2026, BOX_2027 } from './fixtures/sports-nba.mjs';
import { GAMES, PLAYERS, WEEK_2025, WEEK_2026 } from './fixtures/sports-nfl.mjs';
import { nbaModelLeague } from './fixtures/sports-model.mjs';
import { buildTeamModel, forecastGame } from '../lib/sports/team-model.mjs';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, msg, tol = 1e-9) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); checks++; };
const rejects = async (p, status, re, msg) => {
  await assert.rejects(p, (err) => err.status === status && (!re || re.test(err.message)), msg); checks++;
};

// --- payout math (V4 fixtures) ------------------------------------------------
const v4 = evaluatePayout({ stake: 1, format: 'power', payouts: { 2: 55 }, probabilities: [0.3, 0.3] });
near(v4.joint_probability, 0.09, 'two 30% picks: 9% to hit both');
eq([v4.expected_net, v4.expected_roi, v4.breakeven_probability], [3.95, 3.95, 0.018182], '$1 at 9% and 55x: +$3.95, +395% ROI, breakeven 1.81818%');
eq(evaluatePayout({ stake: 1, format: 'power', payouts: { 2: 53 }, probabilities: [0.3, 0.3] }).expected_net, 3.77, '53x: +$3.77');
eq(poissonBinomial([0.5, 0.5]), [0.25, 0.5, 0.25], 'exact-count distribution');
const b = jointBounds([0.6, 0.7]);
near(b.low, 0.3, 'Frechet lower bound', 1e-12); eq(b.high, 0.6, 'Frechet upper bound');
eq(jointBounds([0.2, 0.3]).low, 0, 'the lower bound never goes negative');
const flex = evaluatePayout({ stake: 10, format: 'flex', payouts: { 3: 2.25, 2: 1.25 }, probabilities: [0.6, 0.6, 0.6] });
eq(flex.distribution, [0.064, 0.288, 0.432, 0.216], 'flex distribution 0..3 wins');
eq([flex.expected_gross, flex.expected_net, flex.breakeven_probability], [10.26, 0.26, null], 'flex pays partial outcomes; no single breakeven');
eq(evaluatePayout({ stake: 5, format: 'power', payouts: { 2: 3 }, probabilities: [0.6, null] }).status, 'needs_probabilities', 'a missing chance is reported, not guessed');
ok(payoutProblems('power', 3, { 3: 5, 2: 1 }).some((e) => /power/.test(e)), 'power pays only for every pick');
ok(payoutProblems('flex', 3, { 2: 1.25 }).some((e) => /all 3/.test(e)), 'the all-win payout is required');
ok(payoutProblems('flex', 2, { 3: 4, 2: 3 }).length > 0, 'no payout key above the number of picks');
eq(payoutProblems('flex', 3, { 3: 2.25, 2: 1.25 }), [], 'a valid flex table');
eq([legResult(25, 'over', 24.5), legResult(24, 'over', 24), legResult(20, 'under', 24.5), legResult(null, 'over', 1)], ['win', 'push', 'win', null], 'leg results');
eq(sameGameGroups([{ sport: 'nba', game_id: 'a' }, { sport: 'nba', game_id: 'b' }, { sport: 'nba', game_id: 'a' }]), [{ game: 'a', legs: [0, 2] }], 'same-game groups');
eq(settleFromLegs({ stake: 10, format: 'power', payouts: { 2: 3 }, results: ['win', 'loss'] }), { state: 'settled', outcome: 'loss', gross: 0, net: -10 });
eq(settleFromLegs({ stake: 10, format: 'flex', payouts: { 3: 2.25, 2: 1.25 }, results: ['win', 'win', 'loss'] }), { state: 'settled', outcome: 'win', wins: 2, gross: 12.5, net: 2.5 });
eq(settleFromLegs({ stake: 10, format: 'flex', payouts: { 3: 2.25, 2: 0.5 }, results: ['win', 'win', 'loss'] }).outcome, 'partial', 'paid back less than the stake');
eq(settleFromLegs({ stake: 10, format: 'power', payouts: { 2: 3 }, results: ['win', 'push'] }).state, 'review', 'a push is left for the owner');
eq(settleFromLegs({ stake: 10, format: 'power', payouts: { 2: 3 }, results: ['win', null] }).state, 'pending');
eq(hitHistory([{ date: '2026-01-02', played: true, stats: { points: 25 } }, { date: '2026-01-01', played: false, stats: { points: null } }, { date: '2025-12-30', played: true, stats: { points: 24 } }], 'points', 'over', 24),
  { last5: { hits: 1, pushes: 1, games: 2, range: { low: 0.2065, high: 1 } }, last10: { hits: 1, pushes: 1, games: 2, range: { low: 0.2065, high: 1 } }, all: { hits: 1, pushes: 1, games: 2, range: { low: 0.2065, high: 1 } } }, 'history counts skip missed games and count pushes (the range leaves the push out: 1 of 1 decided)');
// Wilson 95% ranges: 7 of 10 is roughly 40-89%; none decided has no range.
eq(wilsonRange(7, 10), { low: 0.3968, high: 0.8922 }, 'Wilson range for 7 of 10');
eq(wilsonRange(0, 0), null);
// The chance each pick needs: power is the n-th root of 1 / payout.
near(perPickBreakeven('power', { 2: 3 }, 2), Math.sqrt(1 / 3), 'power 2-pick at 3x needs 57.7% each', 1e-6);
near(perPickBreakeven('power', { 6: 37.5 }, 6), 37.5 ** (-1 / 6), 'power 6-pick', 1e-6);
{ // Flex 3-pick paying 3x for 3/3 and 1x for 2/3: solve p³·3 + 3p²(1−p)·1 = 1.
  const p = perPickBreakeven('flex', { 3: 3, 2: 1 }, 3);
  near(p ** 3 * 3 + 3 * p * p * (1 - p), 1, 'flex per-pick breakeven pays back exactly', 1e-6);
}
eq(perPickBreakeven('power', { 2: 0.5 }, 2), null, 'a table that never pays back has no breakeven');
eq(perPickBreakeven('power', {}, 2), null);
eq(evaluatePayout({ stake: 10, format: 'power', payouts: { 2: 3 }, probabilities: [0.6, 0.6] }).breakeven_per_pick, perPickBreakeven('power', { 2: 3 }, 2));

// --- stored data -----------------------------------------------------------------
function fakeR2() {
  const objects = new Map(), held = new Set();
  return {
    objects, backend: 'r2', held,
    rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null),
    rawPut: async (k, v) => { objects.set(k, String(v)); },
    async withLease(name, fn) {
      if (held.has(name)) return { busy: true, reason: 'held' };
      held.add(name);
      try { return { busy: false, result: await fn(() => {}) }; } finally { held.delete(name); }
    },
  };
}
const files = new Map([
  [HOOPR_URLS.schedule(2025), SCHEDULE_2026], [HOOPR_URLS.schedule(2026), SCHEDULE_2027], [HOOPR_URLS.box(2025), BOX_2026], [HOOPR_URLS.box(2026), BOX_2027],
  [NFLVERSE_URLS.games, GAMES], [NFLVERSE_URLS.players, PLAYERS], [NFLVERSE_URLS.weekly(2025), WEEK_2025], [NFLVERSE_URLS.weekly(2026), WEEK_2026],
]);
const NOW = Date.parse('2026-11-02T18:00:00Z');
const st = fakeR2();
for (const adapter of [NBA_SOURCE, NFL_SOURCE]) await ingestLeague({ adapter, store: st, fetchText: async (u) => files.get(u) ?? null, now: NOW });
const nflGames = JSON.parse(st.objects.get(SPORTS_PREFIX + 'nfl/games/2026.json')).games;
const KC_DEN = nflGames.find((g) => g.home_team === 'den' && g.week === 8).game_id;
const load = () => recordLoader(st);

const curry = (game_id, extra = {}) => ({ sport: 'nba', player_id: '3975', game_id, stat: 'points', side: 'over', threshold: 24.5, ...extra });
const pod = (game_id, extra = {}) => ({ sport: 'nba', player_id: '4433', game_id, stat: 'points', side: 'over', threshold: 19.5, ...extra });
const lebron = (game_id, extra = {}) => ({ sport: 'nba', player_id: '1966', game_id, stat: 'points', side: 'over', threshold: 25.5, ...extra });

// --- evaluate --------------------------------------------------------------------
const draft = await evaluateEntry({ load: load(), body: { legs: [curry('401900003')] }, now: NOW });
eq(draft.evaluation.status, 'needs_payout', 'a draft without a payout still gets checked');
const leg = draft.legs[0];
eq([leg.player_name, leg.matchup, leg.team, leg.opponent, leg.team_in_game], ['Stephen Curry', 'phx@gs', 'gs', 'phx', true], 'the pick is filled from stored records');
eq(leg.history.all, { hits: 3, pushes: 0, games: 4, range: { low: 0.3006, high: 0.9544 } }, 'history: 31, 22, 28 and 27 against 24.5; the missed game is left out');
eq(leg.recent.map((r) => r.value).slice().sort((a, b) => a - b), [22, 27, 28, 31], 'the small chart gets the same four played games');
ok(leg.recent.every((r, i) => i === 0 || r.date <= leg.recent[i - 1].date) && leg.recent.every((r) => r.opponent && typeof r.home === 'boolean'), 'newest first, with the opponent');
eq(draft.locked, false);
{ // NBA lineup (sports-model-5): starting tonight is carried, and only for NBA.
  const withStart = await evaluateEntry({ load: load(), body: { legs: [curry('401900003', { starting: 'no' })] }, now: NOW });
  eq(withStart.legs[0].starting, false, 'starting no is kept on the pick');
  ok('lineup' in withStart.legs[0].model || withStart.legs[0].model.status !== 'ok', 'the model read carries the lineup block');
  eq((await evaluateEntry({ load: load(), body: { legs: [curry('401900003', { starting: 'maybe' })] }, now: NOW })).legs[0].starting, undefined, 'an unknown lineup is left out');
}
const same = await evaluateEntry({ load: load(), body: { legs: [curry('401900003'), pod('401900003')], operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } }, now: NOW });
eq([same.evaluation.status, same.evaluation.breakeven_probability], ['needs_probabilities', 0.333333], 'same-game picks without chances: only the breakeven');
eq(same.same_game, [{ game: '401900003', legs: [0, 1] }]);
const sameP = await evaluateEntry({ load: load(), body: { legs: [curry('401900003', { probability: 0.6 }), pod('401900003', { probability: 0.5 })], operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } }, now: NOW });
eq([sameP.evaluation.status, sameP.evaluation.reason, sameP.evaluation.breakeven_probability, sameP.evaluation.joint_probability], ['not_calculated', 'same_game', 0.333333, undefined], 'no measured link in this small fixture: no joint number');
ok(/no measured link|not been measured/.test(sameP.evaluation.detail), 'and the reason says why: ' + sameP.evaluation.detail);
const priced = await evaluateEntry({ load: load(), body: { legs: [curry('401900003', { probability: 0.6 }), lebron('401900004', { probability: 0.55, probability_source: 'history' })], operator: 'betr', format: 'power', stake: 10, payouts: { 2: 3 } }, now: NOW });
eq([priced.evaluation.status, priced.evaluation.joint_probability, priced.evaluation.expected_gross, priced.evaluation.expected_net], ['independence_baseline', 0.33, 9.9, -0.1], 'two games: the independence baseline');
eq(priced.legs.map((l) => l.probability_source), ['owner', 'history'], 'where each chance came from is kept');
// Good or bad at these chances (evCheck): one read for the page, the journal and the MCP.
const PC = priced.evaluation.ev_check;
eq([PC.verdict, PC.expected_roi, PC.chance_all_hit, PC.breakeven, PC.gap_pts, PC.chances_from], ['negative_ev', -0.01, 0.33, 0.333333, -0.3, { owner: 1, history: 1 }], '33% against 33.3% at 3x: a 1% loss, flagged');
eq(PC.reason, 'This entry loses about 1.0% of the stake on average at these chances and payouts. Both hit 33.0% of the time against 33.3% needed.');
eq(PC.weak_picks, [{ pick: 2, chance: 0.55, needs: 0.57735 }], 'the 55% pick is under the 57.7% each pick needs');
eq(PC.at_tested_rates, null, 'typed and history chances are not moved by the model’s test');
eq(draft.evaluation.ev_check.verdict, 'unknown', 'no payout: no verdict');
eq(same.evaluation.ev_check.verdict, 'unknown', 'no chances: no verdict');
const SC = sameP.evaluation.ev_check;
eq([SC.verdict, SC.expected_roi, SC.roi_range], ['unsure', null, { low: -0.7, high: 0.5 }], 'no measured link: under any link the return runs from −70% to +50%, so the sign is not known');
ok(/sign is not known/.test(SC.reason), SC.reason);
{ // The pure read, every branch.
  const legs2 = [{ probability: 0.7, probability_source: 'model' }, { probability: 0.6, probability_source: 'model' }];
  const base = { status: 'independence_baseline', joint_probability: 0.42, breakeven_probability: 0.333333, breakeven_per_pick: 0.57735, expected_roi: 0.26 };
  eq(evCheck({ evaluation: base, format: 'power', stake: 10, legs: legs2 }).verdict, 'positive_ev', 'clear of break-even: positive');
  const t = evCheck({ evaluation: base, format: 'power', stake: 10, legs: legs2, tested: { expected_roi: -0.02, picks: [{ pick: 1, chance: 0.7, tested: 0.55 }] } });
  ok(t.verdict === 'unsure' && /actually had, it is −2\.0%/.test(t.reason), 'positive at the model’s chances but negative at its tested hit rates: unsure. ' + t.reason);
  const j = evCheck({ evaluation: { ...base, status: 'joint_estimate', expected_net_range: { low: -0.5, high: 3 } }, format: 'power', stake: 10, legs: legs2 });
  ok(j.verdict === 'unsure' && /falls to −5\.0% at the low end/.test(j.reason), 'below 0 at the low end of the same-game range: unsure. ' + j.reason);
  // About break-even (shows as 0.0%): not a clear edge, never "positive"; a
  // loss that small is still a loss.
  const even = evCheck({ evaluation: { ...base, expected_roi: 0 }, format: 'power', stake: 10, legs: legs2 });
  eq([even.verdict, even.reason], ['unsure', 'This entry about breaks even at these chances and payouts (expected return under 0.1%). Both hit 42.0% of the time against 33.3% needed.'], 'exactly break-even: not a clear edge');
  eq(evCheck({ evaluation: { ...base, expected_roi: 0.0004 }, format: 'power', stake: 10, legs: legs2 }).verdict, 'unsure', 'a gain that shows as +0.0% is no edge');
  eq(evCheck({ evaluation: { ...base, expected_roi: 0.0005 }, format: 'power', stake: 10, legs: legs2 }).verdict, 'positive_ev', '+0.1% and up is');
  const tiny = evCheck({ evaluation: { ...base, expected_roi: -0.0004 }, format: 'power', stake: 10, legs: legs2 });
  ok(tiny.verdict === 'negative_ev' && /^This entry loses a little \(under 0\.1% of the stake\) on average/.test(tiny.reason), 'a loss that shows as 0.0% is still flagged, in words: ' + tiny.reason);
  const evenTested = evCheck({ evaluation: { ...base, expected_roi: 0 }, format: 'power', stake: 10, legs: legs2, tested: { expected_roi: 0.03, picks: [] } });
  ok(evenTested.verdict === 'unsure' && /would be \+3\.0%\.$/.test(evenTested.reason), 'break-even still reports the tested-rate return: ' + evenTested.reason);
  eq(evCheck({ evaluation: { status: 'not_calculated', expected_net_range: { low: -4, high: -1 } }, format: 'power', stake: 10, legs: legs2 }).verdict, 'negative_ev', 'below 0 under every link: negative');
  eq(evCheck({ evaluation: { status: 'not_calculated', expected_net_range: { low: 1, high: 4 } }, format: 'power', stake: 10, legs: legs2 }).verdict, 'positive_ev');
  eq(evCheck({ evaluation: { status: 'not_calculated' }, format: 'flex', stake: 10, legs: legs2 }).verdict, 'unknown', 'no range at all: unknown');
  const par = evCheck({ evaluation: { ...base, expected_roi: 0.05 }, format: 'parlay', stake: 10, legs: [{ ...legs2[0], price: 1.5, odds: { edge: 0.05 } }, { ...legs2[1], price: 1.6, odds: { edge: -0.04 } }] });
  eq(par.weak_picks, [{ pick: 2, chance: 0.6, edge: -0.04 }], 'a parlay with each pick’s odds names the pick that loses on its own odds');
  const page = sportsFactory({}, { addEventListener() {}, getElementById() { return null; } }, {});
  const html = page.evCheckHtml(PC);
  ok(html.includes('sp-ev-negative-ev') && html.includes('Negative expected value') && html.includes('loses about 1.0% of the stake') && /Pick 2 \(55\.0%\) is under the 57\.7% each pick needs/.test(html), 'the Pick Builder shows the warning: ' + html.slice(0, 120));
  ok(/2 of the chances are typed in or copied from hit rates/.test(html), 'and says how many chances were typed in or copied');
  eq(page.evCheckHtml(draft.evaluation.ev_check), '', 'nothing shown without a verdict');
  ok(page.evCheckHtml(SC).includes('sp-ev-unsure'), 'an unsure read gets the caution style');
}
const wrong = await evaluateEntry({ load: load(), body: { legs: [lebron('401900003')] }, now: NOW });
ok(/LeBron James is not on either team/.test(wrong.warnings[0]), 'a player not in the game is flagged');
await rejects(evaluateEntry({ load: load(), body: { legs: [curry('401900003'), curry('401900003', { side: 'under' })] }, now: NOW }), 400, /cancel out/, 'over and under on the same line');
await rejects(evaluateEntry({ load: load(), body: { legs: [curry('401900003', { threshold: 10 }), curry('401900003', { side: 'under', threshold: 11 })] }, now: NOW }), 400, /cancel out/, 'integer points cannot be both over 10 and under 11');
eq((await evaluateEntry({ load: load(), body: { legs: [curry('401900003', { stat: 'fantasy', threshold: 10 }), curry('401900003', { stat: 'fantasy', side: 'under', threshold: 10.5 })] }, now: NOW })).legs.length, 2, 'fractional fantasy scores can be over 10 and under 10.5');
eq((await evaluateEntry({ load: load(), body: { legs: [curry('401900003'), curry('401900004')] }, now: NOW })).legs.length, 2, 'the same player and stat in different games are separate picks');
await rejects(evaluateEntry({ load: load(), body: { legs: Array.from({ length: 7 }, (_, i) => curry('401900003', { threshold: i + 0.5 })) }, now: NOW }), 400, /1 to 6/, 'at most six picks');
await rejects(evaluateEntry({ load: load(), body: { legs: [curry('401900003', { stat: 'passing_yards' })] }, now: NOW }), 400, /not available/, 'stats belong to the league');
await rejects(evaluateEntry({ load: load(), body: { legs: [curry('401900003', { stat: 'minutes' })] }, now: NOW }), 400, /not available/, 'minutes is not a pick stat');
// Every catalog stat and combo can be picked: history from the stored rows,
// a model chance only for the stats with a forecast.
const combo = await evaluateEntry({ load: load(), body: { legs: [curry('401900003', { threshold: 0.5 }), curry('401900003', { stat: 'rebounds', threshold: 0.5 }), curry('401900003', { stat: 'pts_reb', threshold: 30.5 }), curry('401900003', { stat: 'three_attempts', threshold: 10.5 })] }, now: NOW });
const [cPts, cReb, cPR, cAst] = combo.legs;
eq(cPR.recent.map((r) => r.date), cPts.recent.map((r) => r.date), 'the combo uses the same played games');
eq(cPR.recent.map((r) => r.value), cPts.recent.map((r, i) => r.value + cReb.recent[i].value), 'points + rebounds is summed per game');
eq(cPR.history.all.hits, cPR.recent.filter((r) => r.value > 30.5).length, 'combo history counts the summed values');
eq([cAst.model.status, cAst.model.reason], ['not_calculated', 'stat'], 'a stat without a forecast (three-point attempts) says so');
ok(cAst.history.all.games > 0, 'and still gets history');
ok(combo.legs.every((l) => l.recent.length === cPts.recent.length), 'every stat has the same stored games here');
await rejects(evaluateEntry({ load: load(), body: { legs: [curry('401900003', { threshold: 24.3 })] }, now: NOW }), 400, /whole or half/, 'lines are whole or half numbers');
await rejects(evaluateEntry({ load: load(), body: { legs: [curry('401999999')] }, now: NOW }), 400, /not stored/, 'unknown games are refused');
await rejects(evaluateEntry({ load: load(), body: { legs: [curry('401900003', { probability: 1 })] }, now: NOW }), 400, /between 0% and 100%/, 'a chance of 100% is refused');
for (const probability of [0.000001, 0.999999]) await rejects(evaluateEntry({ load: load(), body: { legs: [curry('401900003', { probability })] }, now: NOW }), 400, /between 0% and 100%/, 'rounding cannot turn a chance into an accepted 0% or 100%');

// --- save --------------------------------------------------------------------------
const OWNER = 'discord-owner-1', OTHER = 'discord-owner-2';
const entryBody = (legs, extra = {}) => ({ legs, operator: 'prizepicks', format: 'power', stake: 10, payouts: { [legs.length]: 3 }, ...extra });
await rejects(saveEntry({ store: st, load: load(), body: entryBody([curry('401900003')], { stake: 0.001 }), now: NOW, sub: OWNER }), 400, /stake/, 'a sub-cent stake cannot be rounded to a saved $0 entry');
await rejects(saveEntry({ store: st, load: load(), body: { legs: [curry('401900003')], operator: 'prizepicks', format: 'power', stake: 10 }, now: NOW, sub: OWNER }), 400, /payout/, 'saving needs the payout');
await rejects(saveEntry({ store: st, load: load(), body: entryBody([curry('401900002')]), now: NOW, sub: OWNER }), 409, /started/, 'no saves after the game starts');
await rejects(saveEntry({ store: { ...st, backend: 'mem' }, load: load(), body: entryBody([curry('401900003')]), now: NOW, sub: OWNER }), 503, /R2/, 'saving needs R2');
st.held.add('sports-journal');
await rejects(saveEntry({ store: st, load: load(), body: entryBody([curry('401900003')]), now: NOW, sub: OWNER }), 409, /in progress/, 'a held lease is a busy answer');
st.held.delete('sports-journal');

// Entries saved before last week's games, settled from the stored finals.
const EARLY = Date.parse('2026-10-30T12:00:00Z');
const A = await saveEntry({ store: st, load: load(), body: entryBody([pod('401900002'), lebron('401900002')], { note: 'same game' }), now: EARLY, sub: OWNER }); // 21 and 30: both win
const B = await saveEntry({ store: st, load: load(), body: entryBody([curry('401900002'), pod('401900001', { stat: 'rebounds', threshold: 10.5 })]), now: EARLY, sub: OWNER }); // void + loss
const C = await saveEntry({ store: st, load: load(), body: entryBody([curry('401900001', { probability: 0.6 }), pod('401900002', { threshold: 25.5, probability: 0.5 })], { format: 'flex', payouts: { 2: 3, 1: 0.5 } }), now: EARLY, sub: OWNER }); // 27 hits, 21 misses
const D = await saveEntry({ store: st, load: load(), body: entryBody([curry('401900002')]), now: EARLY, sub: OWNER }); // did not play
const N = await saveEntry({ store: st, load: load(), body: { legs: [{ sport: 'nfl', player_id: '00-0007', game_id: KC_DEN, stat: 'receptions', side: 'over', threshold: 0.5 }], operator: 'other', format: 'power', stake: 5, payouts: { 1: 1.8 } }, now: EARLY, sub: OTHER });
const E = await saveEntry({ store: st, load: load(), body: entryBody([curry('401900003')]), now: NOW, sub: OWNER }); // tonight
ok(/^pe_[a-f0-9]{18}$/.test(A.entry_id) && A.by === ownerTag(OWNER) && !JSON.stringify(A).includes(OWNER), 'saved with an owner tag, never the Discord id');
ok(A.legs.every((l) => !('recent' in l) && l.history), 'chart values are not saved with the entry');
eq(A.evaluation.status, 'needs_probabilities', 'the same-game entry without chances is saved without a joint number');
eq([C.evaluation.status, C.evaluation.expected_net], ['independence_baseline', 1.5], 'the priced entry keeps its expected value');
eq([C.evaluation.ev_check.verdict, C.evaluation.ev_check.expected_roi], ['positive_ev', 0.15], 'and its expected-value read');
const journalRec = JSON.parse(st.objects.get(SPORTS_PREFIX + 'journal/entries.json'));
eq(journalRec.events.length, 6, 'six entries appended');
const obs = JSON.parse(st.objects.get(SPORTS_PREFIX + 'markets/observations.json')).observations;
eq(obs.length, 9, 'every pick is captured as a line observation');
ok(obs.every((o) => /^ms_[a-f0-9]{24}$/.test(o.market_series) && o.source === 'manual' && o.entry_id), 'observations carry a market series and the entry');

// --- journal ------------------------------------------------------------------------
let view = await journalView({ load: load(), now: NOW, sub: OWNER });
const byId = (v, id) => v.entries.find((e) => e.entry_id === id);
eq(view.entries[0].entry_id, E.entry_id, 'newest first');
eq(byId(view, A.entry_id).settlement, { state: 'settled', outcome: 'win', wins: 2, gross: 30, net: 20 }, 'A: both picks hit');
eq(byId(view, A.entry_id).legs.map((l) => [l.actual, l.result]), [[21, 'win'], [30, 'win']]);
eq(byId(view, B.entry_id).settlement.outcome, 'loss', 'B: a power entry with a miss loses even with a void');
eq(byId(view, C.entry_id).settlement, { state: 'settled', outcome: 'partial', wins: 1, gross: 5, net: -5 }, 'C: flex, one of two hit, part of the stake back');
eq(byId(view, D.entry_id).settlement.state, 'review', 'D: a pick that did not play waits for the owner');
eq(byId(view, D.entry_id).legs[0].result, 'void');
eq(byId(view, D.entry_id).actions, ['settle'], 'only the payout can be entered once the game has started');
eq([byId(view, N.entry_id).settlement.state, byId(view, N.entry_id).legs[0].result], ['pending', null], 'NFL: a player missing from the final file stays open');
// The schedule says final but the box score has not landed yet: NBA picks
// on that game stay open instead of reading as did-not-play.
const noBox = (() => {
  const base = load();
  return async (kind, opts) => {
    const rec = await base(kind, opts);
    if (kind !== 'player-games' || opts.sport !== 'nba' || !rec) return rec;
    const gi = rec.columns.indexOf('game_id');
    return { ...rec, rows: rec.rows.filter((a) => a[gi] !== '401900002') };
  };
})();
const early = await journalView({ load: noBox, now: NOW, sub: OWNER });
eq([byId(early, D.entry_id).legs[0].result, byId(early, D.entry_id).settlement.state], [null, 'pending'], 'NBA: a final game with no stored box score yet stays open, not void');
eq(byId(early, A.entry_id).settlement.state, 'pending');
eq([byId(view, N.entry_id).mine, byId(view, N.entry_id).actions], [false, []], 'the other owner cannot change it');
eq(byId(view, E.entry_id).actions, ['withdraw'], 'tonight: can still be withdrawn');
eq([view.summary.entries, view.summary.settled, view.summary.pending, view.summary.review, view.summary.wins], [6, 3, 2, 1, 1]);
eq([view.summary.staked, view.summary.returned, view.summary.net, view.summary.priced_settled, view.summary.expected_net_settled], [30, 35, 5, 1, 1.5]);

// --- revisions --------------------------------------------------------------------------
await rejects(reviseEntry({ store: st, load: load(), body: { entry_id: D.entry_id, action: 'settle', gross: 10 }, now: NOW, sub: OTHER }), 403, /Only the owner/, 'only the saver revises');
await rejects(reviseEntry({ store: st, load: load(), body: { entry_id: A.entry_id, action: 'settle', gross: 99 }, now: NOW, sub: OWNER }), 409, /already settled/, 'a stats-settled entry cannot be overwritten');
await rejects(reviseEntry({ store: st, load: load(), body: { entry_id: D.entry_id, action: 'withdraw' }, now: NOW, sub: OWNER }), 409, /stays in the record/, 'no withdraw after the start');
await rejects(reviseEntry({ store: st, load: load(), body: { entry_id: E.entry_id, action: 'settle', gross: 30 }, now: NOW, sub: OWNER }), 409, /after every game/, 'no payout before the games');
await rejects(reviseEntry({ store: st, load: load(), body: { entry_id: D.entry_id, action: 'settle', gross: '' }, now: NOW, sub: OWNER }), 400, /paid back/, 'a payout amount is required');
await rejects(reviseEntry({ store: st, load: load(), body: { entry_id: 'pe_000000000000000000', action: 'withdraw' }, now: NOW, sub: OWNER }), 404);
await reviseEntry({ store: st, load: load(), body: { entry_id: D.entry_id, action: 'settle', gross: 10, note: 'refunded' }, now: NOW, sub: OWNER });
await reviseEntry({ store: st, load: load(), body: { entry_id: E.entry_id, action: 'withdraw' }, now: NOW, sub: OWNER });
view = await journalView({ load: load(), now: NOW, sub: OWNER });
eq(byId(view, D.entry_id).settlement, { state: 'settled', outcome: 'refund', gross: 10, net: 0, manual: true, note: 'refunded' }, 'D: refunded stake, entered by hand');
eq(byId(view, D.entry_id).actions, ['settle'], 'a typed-in payout can be corrected');
eq([byId(view, E.entry_id).settlement.state, byId(view, E.entry_id).actions], ['withdrawn', []]);
eq([view.summary.entries, view.summary.settled, view.summary.staked, view.summary.returned], [5, 4, 40, 45], 'withdrawn entries leave the totals');

// --- route ---------------------------------------------------------------------------------
function fakeRes() {
  const r = { statusCode: 0, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const SAME = { origin: 'https://mingstreet.app', host: 'mingstreet.app', 'x-forwarded-proto': 'https' };
// The injury report is faked (unreachable); tests never use the network.
const noFeed = async () => ({ injuries: { state: 'unavailable', reports: [] } });
async function call(method, query, body, headers = SAME, sub = OWNER) {
  const res = fakeRes();
  await handleSportsRequest({ method, headers, query, body }, res, { env: { PRIVATE_DATA_ENABLED: '1' }, getSession: async () => ({ sub, tr: true, tp: true }), store: st, now: () => NOW, loadPropSources: noFeed });
  return res;
}
const ev = await call('POST', { sports: 'evaluate' }, entryBody([curry('401900003'), lebron('401900004')]));
eq([ev.statusCode, ev.body.schema_version, ev.body.evaluation.status], [200, 1, 'needs_probabilities'], 'evaluate through the route');
eq((await call('POST', { sports: 'evaluate' }, JSON.stringify(entryBody([curry('401900003')])))).statusCode, 200, 'a string body is parsed');
eq((await call('POST', { sports: 'evaluate' }, entryBody([curry('401900003')]), { host: 'mingstreet.app' })).statusCode, 403, 'cross-site POSTs are refused');
eq((await call('GET', { sports: 'evaluate' })).statusCode, 405, 'evaluate is POST only');
const bad = await call('POST', { sports: 'evaluate' }, entryBody([curry('401900003', { side: 'sideways' })]));
eq([bad.statusCode, bad.body.error], [400, 'Pick 1: choose over or under'], 'the reason comes back to the page');
eq((await call('POST', { sports: 'evaluate' }, { legs: [], pad: 'x'.repeat(20000) })).statusCode, 413, 'oversized bodies are refused');
eq((await call('POST', { sports: 'evaluate' }, '[1,2]')).statusCode, 400);
const saved = await call('POST', { sports: 'save-entry' }, entryBody([lebron('401900004')]));
ok(saved.statusCode === 200 && /^pe_/.test(saved.body.entry.entry_id), 'save through the route');
const jr = await call('GET', { sports: 'journal' });
eq([jr.statusCode, jr.headers['cache-control'], jr.body.entries[0].entry_id], [200, 'private, no-store', saved.body.entry.entry_id], 'the journal is private and fresh');
const rv = await call('POST', { sports: 'revise-entry' }, { entry_id: saved.body.entry.entry_id, action: 'withdraw' });
eq([rv.statusCode, rv.body.event.type], [200, 'withdraw']);
const broken = fakeR2(); broken.rawGet = async () => { throw new Error('secret detail'); };
const res502 = fakeRes();
await handleSportsRequest({ method: 'GET', headers: {}, query: { sports: 'journal' } }, res502, { env: { PRIVATE_DATA_ENABLED: '1' }, getSession: async () => ({ sub: OWNER, tr: true, tp: true }), store: broken });
eq([res502.statusCode, res502.body.error], [502, 'Sports data unavailable'], 'store failures do not leak details');

// --- next game on the player view -----------------------------------------------------------------
const log = await call('GET', { sports: 'player', sport: 'nba', id: '3975' });
eq([log.body.next_game.game_id, log.body.next_game.home_team], ['401900003', 'gs'], 'the player view names the next game for Pick Builder');
const kelce = await call('GET', { sports: 'player', sport: 'nfl', id: '00-0003' });
eq(kelce.body.next_game.week, 9, 'NFL: the team’s next game');

// --- a combo pick settles from the summed final stats ------------------------------------------
const settleSt = fakeR2();
for (const adapter of [NBA_SOURCE, NFL_SOURCE]) await ingestLeague({ adapter, store: settleSt, fetchText: async (u) => files.get(u) ?? null, now: NOW });
const PR = await saveEntry({ store: settleSt, load: recordLoader(settleSt), body: entryBody([pod('401900002', { stat: 'pts_reb', threshold: 25.5 })]), now: EARLY, sub: OWNER });
const prRow = unpackRows(JSON.parse(settleSt.objects.get(SPORTS_PREFIX + 'nba/player-games/2026.json')), { playerId: '4433' }).find((r) => r.game_id === '401900002');
const prLeg = (await journalView({ load: recordLoader(settleSt), now: NOW, sub: OWNER })).entries.find((e) => e.entry_id === PR.entry_id).legs[0];
eq(prLeg.actual, prRow.stats.points + prRow.stats.rebounds, 'the settled value is points + rebounds');
eq(prLeg.result, prLeg.actual > 25.5 ? 'win' : 'loss');

// --- game bets, odds formats and parlays (2026-11-12) --------------------------------
// Prices: American, decimal and Kalshi cents all become the decimal multiplier.
eq(parsePrice('-110'), { decimal: 1.9091, american: -110, cents: 52.4, typed: 'american' });
eq(parsePrice('+150').decimal, 2.5); eq(parsePrice('150').decimal, 2.5, 'an unsigned 150 reads as +150');
eq(parsePrice('−200').decimal, 1.5, 'the typographic minus works');
eq([parsePrice('1.91').decimal, parsePrice('1.91').typed], [1.91, 'decimal']);
eq([parsePrice('62¢').cents, parsePrice('62c').decimal, parsePrice('.62').decimal], [62, 1.6129, 1.6129], 'Kalshi cents and a chance read the same');
eq([parsePrice('abc'), parsePrice('-50'), parsePrice('0'), parsePrice('100c'), parsePrice(''), parsePrice(1)], [null, null, null, null, null, null], 'nonsense prices are refused');
eq([americanOf(1.909), americanOf(2.5), fairOdds(0.5).american, fairOdds(0.75).american], [-110, 150, 100, -300]);
{ // The page's copy of the parser agrees with the server's.
  const page = sportsFactory({}, { addEventListener() {}, getElementById() { return null; } }, {});
  for (const raw of ['-110', '+150', '150', '−200', '1.91', '62¢', '62c', '.62', '0.5', '7', '7.0', '+600', '14¢', '99c', 'abc', '-50', '', '1001', '100000', '+100000']) {
    const a = parsePrice(raw), b = page.priceOf(raw);
    eq(b ? { decimal: b.decimal, american: b.american, cents: b.cents } : null, a ? { decimal: a.decimal, american: a.american, cents: a.cents } : null, 'page and server read ' + raw + ' the same');
  }
}
eq(cleanTeamLeg({ market: 'spread', team: 'GS', line: -5.5 }), { market: 'spread', team: 'gs', side: 'over', line: -5.5 });
ok(/whole or half/.test(cleanTeamLeg({ market: 'spread', team: 'gs', line: -5.3 }).error), 'spreads are whole or half points');
ok(/1 to 60/.test(cleanTeamLeg({ market: 'win_by', team: 'gs', line: 7.5 }).error), 'win by takes whole points');
ok(/team/.test(cleanTeamLeg({ market: 'moneyline' }).error), 'a moneyline needs a team');
eq(cleanTeamLeg({ market: 'total', team: 'gs', side: 'under', line: 228.5 }).team, null, 'a game total has no team');
eq(['moneyline', 'spread', 'win_by', 'total', 'team_total'].map((market) => teamLegLabel({ market, team: 'lal', side: market === 'win_by' ? 'under' : 'over', line: market === 'spread' ? -5.5 : market === 'win_by' ? 10 : 114.5 })),
  ['LAL to win', 'LAL −5.5', 'LAL not to win by 10+', 'Game total over 114.5', 'LAL team total over 114.5']);
eq([milestoneLabel('over', 24.5), milestoneLabel('over', 24), milestoneLabel('under', 24.5)], ['25+', null, null], 'over 24.5 is Kalshi’s 25+');
{ const g = { home_team: 'gs', away_team: 'phx', home_score: 110, away_score: 104 };
  eq(['moneyline', 'spread', 'win_by', 'total', 'team_total'].map((market) => teamLegResult({ market, team: 'gs', side: 'over', line: market === 'spread' ? -6 : market === 'win_by' ? 6 : market === 'total' ? 214 : 110.5 }, g)),
    ['win', 'push', 'win', 'push', 'loss'], 'game bets settle from the final score (−6 and 214 push)'); }
eq(settleFromLegs({ stake: 10, format: 'parlay', payouts: { 2: 3.6 }, prices: [2, 1.8], results: ['win', 'win'] }), { state: 'settled', outcome: 'win', wins: 2, gross: 36, net: 26 });
eq(settleFromLegs({ stake: 10, format: 'parlay', payouts: { 2: 3.6 }, prices: [2, 1.8], results: ['win', 'push'] }).gross, 20, 'a pushed pick drops out of the parlay');
eq(settleFromLegs({ stake: 10, format: 'parlay', payouts: { 2: 3.6 }, prices: [2, 1.8], results: ['push', 'void'] }).outcome, 'refund', 'every pick pushed: the stake back');
eq(settleFromLegs({ stake: 10, format: 'parlay', payouts: { 2: 3.6 }, results: ['win', 'push'] }).state, 'review', 'one price for the whole parlay: a push waits for the owner');
eq(settleFromLegs({ stake: 10, format: 'parlay', payouts: { 2: 3.6 }, results: ['loss', null] }).outcome, 'loss', 'one losing pick settles a parlay at once');

const gsWin = (extra = {}) => ({ kind: 'team', sport: 'nba', game_id: '401900003', market: 'moneyline', team: 'gs', ...extra });
const gsSpread = (extra = {}) => ({ kind: 'team', sport: 'nba', game_id: '401900003', market: 'spread', team: 'gs', line: -5.5, ...extra });
const tb = await evaluateEntry({ load: load(), body: { legs: [gsWin(), gsSpread(), curry('401900003')] }, now: NOW });
const [tML, tSp] = tb.legs;
eq([tML.kind, tML.label, tML.matchup, tML.opponent, tSp.label], ['team', 'GS to win', 'phx@gs', 'phx', 'GS −5.5'], 'a game bet is filled from the stored game');
eq([tML.model.status, tML.model.reason], ['not_calculated', 'no_model'], 'no team model in this fixture: it says so');
ok(tML.history.all.games > 0 && tML.recent.length === tML.history.all.games && tML.chart.threshold === 0, 'the team’s record this season against the bet');
eq(tSp.chart, { side: 'over', threshold: 5.5 }, 'a −5.5 spread reads margins against 5.5');
eq([tML.latent.id, tSp.latent.id, tML.latent.up, tSp.latent.up], ['g:margin', 'g:margin', true, true], 'both read the home team’s margin');
await rejects(evaluateEntry({ load: load(), body: { legs: [gsWin(), gsWin({ team: 'phx' })] }, now: NOW }), 400, /Both teams to win/, 'both teams to win cancel out');
await rejects(evaluateEntry({ load: load(), body: { legs: [gsWin(), gsWin()] }, now: NOW }), 400, /twice/, 'the same game bet twice');
// Two game bets that no final score lets both win are refused; ranges are not.
const gsTotal = (side, line) => ({ kind: 'team', sport: 'nba', game_id: '401900003', market: 'total', side, line });
{ // An owner's win chance and a model push must use the same feasible
  // probability partition in the leg display and the entry calculation.
  const games = [...nbaModelLeague({ start: '2024-10-21', season: 2024 }).games, ...nbaModelLeague().games];
  const model = buildTeamModel({ sport: 'nba', games, now: NOW });
  const game = (await load()('games', { sport: 'nba', season: 2026 })).games.find(g => g.game_id === '401900003');
  const line = Math.round(forecastGame(model, game).expected.total);
  const normalLoad = load();
  const result = await evaluateEntry({ load: async (kind, args) => kind === 'team-model' ? model : normalLoad(kind, args),
    body: { legs: [{ ...gsTotal('over', line), probability: .9999, price: 1.91 }], operator: 'sportsbook', format: 'parlay', stake: 10 }, now: NOW });
  const leg = result.legs[0];
  ok(leg.model.push > 0.0001, 'the fitted model has a real whole-point push probability');
  ok(leg.probability + leg.push <= 1, 'win and effective push probabilities cannot exceed 100%');
  eq(leg.odds.edge, result.evaluation.expected_roi, 'a one-leg parlay shows the same edge on its leg and entry');
  ok(leg.model.push > leg.push, 'the original model forecast is preserved separately');
}
await rejects(evaluateEntry({ load: load(), body: { legs: [gsTotal('over', 240.5), gsTotal('under', 220.5)] }, now: NOW }), 400, /Game total over 240\.5 and Game total under 220\.5 can never both win/, 'over 240.5 and under 220.5');
await rejects(evaluateEntry({ load: load(), body: { legs: [gsSpread(), gsSpread({ team: 'phx', line: -3.5 })] }, now: NOW }), 400, /GS −5\.5 and PHX −3\.5 can never both win/, 'both favorites');
await rejects(evaluateEntry({ load: load(), body: { legs: [gsWin({ team: 'phx' }), gsWin({ market: 'win_by', line: 3 })] }, now: NOW }), 400, /never both win/, 'PHX to win and GS to win by 3+');
await rejects(evaluateEntry({ load: load(), body: { legs: [gsWin({ market: 'win_by', line: 10 }), gsWin({ market: 'win_by', line: 7, side: 'under' })] }, now: NOW }), 400, /never both win/, 'win by 10+ and not by 7+');
for (const legs of [[gsTotal('over', 220.5), gsTotal('under', 230.5)], [gsSpread({ line: -2.5 }), gsSpread({ team: 'phx', line: 6.5 })], [gsWin({ market: 'win_by', line: 7 }), gsWin({ market: 'win_by', line: 10, side: 'under' })], [gsWin(), gsSpread()]]) {
  eq((await evaluateEntry({ load: load(), body: { legs }, now: NOW })).legs.length, 2, 'a range or nested pair is allowed: ' + legs.map(teamLegLabel).join(' + '));
}
{ // The page's copy of the check agrees with the server's.
  const page = sportsFactory({}, { addEventListener() {}, getElementById() { return null; } }, {});
  const bets = [];
  for (const team of ['gs', 'phx']) {
    bets.push({ market: 'moneyline', team, side: 'over', line: null });
    for (const line of [-7.5, -3, 0, 2.5, 6]) bets.push({ market: 'spread', team, side: 'over', line });
    for (const line of [1, 3, 8]) for (const side of ['over', 'under']) bets.push({ market: 'win_by', team, side, line });
    for (const line of [99.5, 110]) for (const side of ['over', 'under']) bets.push({ market: 'team_total', team, side, line });
  }
  for (const line of [215.5, 220, 230.5]) for (const side of ['over', 'under']) bets.push({ market: 'total', team: null, side, line });
  let same = 0, pairs = 0;
  for (const a of bets) for (const b of bets) {
    const A = { kind: 'team', sport: 'nba', game_id: 'g', ...a }, B = { kind: 'team', sport: 'nba', game_id: 'g', ...b };
    pairs++; if (neverBothWin(A, B) === page.neverBoth(A, B)) same++;
  }
  eq(same, pairs, 'page and server agree on every pair of game bets (' + pairs + ')');
  ok(neverBothWin({ kind: 'team', sport: 'nba', game_id: 'g', market: 'team_total', team: 'gs', side: 'over', line: 110 }, { kind: 'team', sport: 'nba', game_id: 'g', market: 'team_total', team: 'gs', side: 'under', line: 111 }), 'over 110 (111+) and under 111 (110 or less) never both win');
  ok(!neverBothWin({ kind: 'team', sport: 'nba', game_id: 'g', market: 'team_total', team: 'gs', side: 'over', line: 110 }, { kind: 'team', sport: 'nba', game_id: 'g', market: 'team_total', team: 'phx', side: 'under', line: 90 }), 'two teams’ totals are different numbers');
  eq(winSpan({ market: 'spread', line: 3.5 }), [-3, Infinity], '+3.5 covers losing by 3 or less');
}
await rejects(evaluateEntry({ load: load(), body: { legs: [gsWin({ team: 'lal' })] }, now: NOW }), 400, /not in this game/, 'a team not in the game');
await rejects(evaluateEntry({ load: load(), body: { legs: [gsSpread({ line: 70 })] }, now: NOW }), 400, /spread/, 'a spread out of range');
await rejects(evaluateEntry({ load: load(), body: { legs: [gsWin({ price: 'abc' })], format: 'parlay' }, now: NOW }), 400, /odds must look like/, 'a bad price is refused');
// Who wins and the spread move as one number: all win is the spread's chance.
const shared = await evaluateEntry({ load: load(), body: { legs: [gsWin({ probability: 0.6 }), gsSpread({ probability: 0.5 })], operator: 'sportsbook', format: 'parlay', stake: 10, payouts: { 2: 2.5 } }, now: NOW });
eq([shared.evaluation.status, shared.evaluation.joint_probability, shared.evaluation.independent_probability], ['joint_estimate', 0.5, 0.3], 'one number: priced exactly, not multiplied');
eq(shared.evaluation.shared_numbers, [{ legs: [0, 1] }]);
eq([shared.evaluation.odds.fair.american, shared.evaluation.odds.offered.decimal, shared.evaluation.odds.edge], [100, 2.5, 0.25], 'fair odds, the typed parlay price and the edge');
eq([shared.evaluation.expected_net, shared.evaluation.breakeven_probability], [2.5, 0.4]);
const perPick = await evaluateEntry({ load: load(), body: { legs: [gsWin({ probability: 0.6, price: '-150' }), curry('401900004', { probability: 0.5, price: '1.91' })], operator: 'sportsbook', format: 'parlay', stake: 10 }, now: NOW });
eq([perPick.prices, perPick.payouts], [[1.6667, 1.91], { 2: 3.1834 }], 'each pick’s odds, multiplied');
eq([perPick.evaluation.status, perPick.evaluation.joint_probability, perPick.evaluation.expected_net], ['independence_baseline', 0.3, -0.45], 'two games, at the multiplied odds');
eq([perPick.legs[0].odds.price.american, perPick.legs[0].odds.edge, perPick.legs[1].odds.fair.american], [-150, 0, 100], 'each pick’s price, edge and fair odds');
eq((await evaluateEntry({ load: load(), body: { legs: [gsWin()], format: 'parlay', operator: 'kalshi', stake: 10 }, now: NOW })).evaluation.status, 'needs_payout', 'a parlay needs odds');
eq((await evaluateEntry({ load: load(), body: { legs: [gsWin({ price: '+120' })], format: 'power', operator: 'prizepicks', stake: 10, payouts: { 1: 2 } }, now: NOW })).legs[0].price, null, 'prices are kept only for parlays');
{ // A shared link carries game bets and prices, never chances.
  const link = encodePrefill({ operator: 'kalshi', format: 'parlay', stake: 5, payouts: {}, legs: [{ ...gsSpread(), price: 1.91, probability: 0.5 }, curry('401900003')] });
  const back = decodePrefill(link);
  eq([back.operator, back.format, back.legs[0].kind, back.legs[0].market, back.legs[0].line, back.legs[0].price, back.legs[0].probability], ['kalshi', 'parlay', 'team', 'spread', -5.5, 1.91, undefined], 'the link round-trips a game bet');
  eq(decodePrefill(encodePrefill({ format: 'power', legs: [{ ...gsSpread(), line: 99 }] })), null, 'a bad game bet in a link is refused');
  eq(decodePrefill(encodePrefill({ format: 'power', legs: [curry('401900003', { starting: false })] })).legs[0].starting, false, 'the link carries an NBA starting flag');
  eq(decodePrefill(encodePrefill({ format: 'power', legs: [curry('401900003')] })).legs[0].starting, undefined, 'and leaves it out when unknown');
}
// Game bets settle from the final score; a parlay with odds pays them.
{
  const settleSt2 = fakeR2();
  for (const adapter of [NBA_SOURCE, NFL_SOURCE]) await ingestLeague({ adapter, store: settleSt2, fetchText: async (u) => files.get(u) ?? null, now: NOW });
  const g2 = JSON.parse(settleSt2.objects.get(SPORTS_PREFIX + 'nba/games/2026.json')).games.find((g) => g.game_id === '401900002');
  const winner = g2.home_score > g2.away_score ? g2.home_team : g2.away_team, margin = Math.abs(g2.home_score - g2.away_score), sum = g2.home_score + g2.away_score;
  const T = (extra) => ({ kind: 'team', sport: 'nba', game_id: '401900002', team: winner, ...extra });
  const W = await saveEntry({ store: settleSt2, load: recordLoader(settleSt2), body: { legs: [T({ market: 'moneyline', price: 2 }), T({ market: 'spread', line: -margin, price: 1.8 })], operator: 'sportsbook', format: 'parlay', stake: 10 }, now: EARLY, sub: OWNER });
  const P = await saveEntry({ store: settleSt2, load: recordLoader(settleSt2), body: { legs: [T({ market: 'total', side: 'under', line: sum + 0.5 }), T({ market: 'win_by', side: 'under', line: margin + 1 })], operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } }, now: EARLY, sub: OWNER });
  const v2 = await journalView({ load: recordLoader(settleSt2), now: NOW, sub: OWNER });
  const w = byId(v2, W.entry_id), pw = byId(v2, P.entry_id);
  eq(w.legs.map((l) => [l.result, l.actual]), [['win', margin], ['push', margin]], 'won, and landed exactly on the spread');
  eq(w.settlement, { state: 'settled', outcome: 'win', wins: 1, gross: 20, net: 10 }, 'the push drops out: paid at the moneyline’s odds');
  eq([pw.legs.map((l) => l.result), pw.settlement.gross], [['win', 'win'], 30], 'under the total and not winning by margin + 1');
  ok(!JSON.parse(settleSt2.objects.get(SPORTS_PREFIX + 'markets/observations.json') || '{"observations":[]}').observations.some((o) => o.entry_id === W.entry_id), 'game bets are not written as player line observations');
}

console.log(`Sports Pick Builder smoke passed (${checks} checks).`);
