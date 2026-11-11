#!/usr/bin/env node
// Owner Sports stat models (lib/sports/models.mjs): the curve math, the
// fitted corrections, the day-by-day check on a made-up league with known
// effects, forecasts with and without a line, and the forecasts the player
// page and Pick Builder routes return. Offline, fake store.
import assert from 'node:assert/strict';
import {
  nbCdf, nbPmf, nbQuantile, normCdf, cdfAt, quantileOf, lineChances, fitSpread, fitCorrection, varianceOf, nbSizeOf,
  forecastStat, buildModel, modelSummary, positionGroup, MODEL_SPECS, SPORTS_MODEL_VERSION, MIN_GAMES,
  regularMinutes, absentMinutes, absenceFactor, ABSENCE,
} from '../lib/sports/models.mjs';
import { SPORTS_STATS } from '../lib/sports/schema.mjs';
import { teamAbsence, PROP_RANK_VERSION } from '../lib/sports/props.mjs';
import { packRows } from '../lib/sports/rows.mjs';
import { sportsKey, SPORTS_PREFIX } from '../lib/sports/store.mjs';
import { handleSportsRequest } from '../lib/sports/http.mjs';
import { chanceCheck, PROB_SOURCES } from '../lib/sports/journal.mjs';
import { ingestLeague } from '../lib/sports/ingest.mjs';
import { NFL_SOURCE, NFLVERSE_URLS } from '../lib/sports/nflverse.mjs';
import { NBA_SOURCE, HOOPR_URLS } from '../lib/sports/hoopr.mjs';
import { GAMES, PLAYERS, WEEK_2025, WEEK_2026 } from './fixtures/sports-nfl.mjs';
import { SCHEDULE_2026, SCHEDULE_2027, BOX_2026, BOX_2027 } from './fixtures/sports-nba.mjs';
import { nbaModelLeague, rng, SOFT_DEFENSE, TOUGH_DEFENSE } from './fixtures/sports-model.mjs';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, msg, tol = 1e-6) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); checks++; };

// --- curve math ------------------------------------------------------------------
near(nbCdf(3, Infinity, 2), Math.exp(-3) * (1 + 3 + 4.5), 'Poisson CDF');
near(nbCdf(10, 4, 400), 1, 'a negative binomial adds up to one', 1e-9);
let total = 0;
for (let k = 0; k <= 200; k++) total += nbPmf(12, 5, k);
near(total, 1, 'the probabilities sum to one', 1e-9);
// NB(mean 12, size 5): variance 12 + 144/5 = 40.8.
let m1 = 0, m2 = 0;
for (let k = 0; k <= 400; k++) { const p = nbPmf(12, 5, k); m1 += k * p; m2 += k * k * p; }
near(m1, 12, 'negative binomial mean', 1e-6);
near(m2 - m1 * m1, 40.8, 'negative binomial variance', 1e-4);
ok(nbQuantile(12, 5, 0.1) < 12 && nbQuantile(12, 5, 0.9) > 12, 'the 80% range brackets the mean');
ok(nbCdf(12, 5, nbQuantile(12, 5, 0.9)) >= 0.9 && nbCdf(12, 5, nbQuantile(12, 5, 0.9) - 1) < 0.9, 'the 90th percentile is the first whole number past 90%');
near(normCdf(0), 0.5, 'normal CDF at zero', 1e-7);
near(normCdf(1.959964), 0.975, 'normal CDF at 1.96', 1e-6);
near(normCdf(-1) + normCdf(1), 1, 'normal CDF is symmetric', 1e-7);
eq(varianceOf({ a: 2, b: 1.5 }, 10), 17, 'variance = a + b × mean');
eq(varianceOf({ a: -50, b: 1 }, 10), 3, 'the spread never drops below 30% of the mean');
eq(nbSizeOf({ a: 0, b: 1 }, 10), Infinity, 'variance equal to the mean is a Poisson');
near(nbSizeOf({ a: 0, b: 2 }, 10), 10, 'size = mean² / (variance − mean)');

// Half lines never push; whole lines do; the three chances add to one.
const half = lineChances(24.6, { a: 5, b: 2 }, 'over', 24.5);
eq(half.push, 0, 'a half line cannot push');
near(half.win + half.loss, 1, 'over and under cover a half line');
const whole = lineChances(24.6, { a: 5, b: 2 }, 'over', 24);
ok(whole.push > 0.02 && whole.push < 0.2, 'a whole line can push');
near(whole.win + whole.loss + whole.push, 1, 'win, loss and push add to one');
near(whole.push, nbPmf(24.6, nbSizeOf({ a: 5, b: 2 }, 24.6), 24), 'push = chance of exactly the line');
const under = lineChances(24.6, { a: 5, b: 2 }, 'under', 24);
near(under.win, whole.loss, 'the under wins when the over loses');
eq(under.push, whole.push);
// Passing yards use the normal curve: symmetric around the mean.
const py = lineChances(250, { a: 6400, b: 0 }, 'over', 249.5, 'normal');
near(py.win, normCdf(0.5 / 80), 'normal curve: over 249.5 is everything from 250 up', 1e-9);
near(lineChances(250, { a: 6400, b: 0 }, 'over', 249.5, 'normal').win + lineChances(250, { a: 6400, b: 0 }, 'over', 250.5, 'normal').win, 1, 'symmetric around the mean', 1e-9);
const pyWhole = lineChances(250, { a: 6400, b: 0 }, 'over', 250, 'normal');
near(pyWhole.push, normCdf(0.5 / 80) - normCdf(-0.5 / 80), 'a whole yard line pushes on the one-yard band');
near(cdfAt('normal', 250, { a: 6400, b: 0 }, 249), normCdf(-0.5 / 80), 'normal CDF uses the half-point band');
eq([quantileOf('normal', 250, { a: 6400, b: 0 }, 0.1), quantileOf('normal', 250, { a: 6400, b: 0 }, 0.9)], [147, 353], 'normal 80% range');

// --- fitted corrections -----------------------------------------------------------
const rand = rng(11);
const pairs = Array.from({ length: 6000 }, () => {
  const mu = 2 + rand() * 20;
  const sd = Math.sqrt(3 + 1.5 * mu);
  return [mu, mu + sd * Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand())];
});
const sp = fitSpread(pairs);
near(sp.b, 1.5, 'spread slope recovered', 0.2);
near(sp.a, 3, 'spread intercept recovered', 2);
eq(fitSpread(pairs.slice(0, 10)), { a: 0, b: 1 }, 'too few pairs keep a Poisson-like spread');
const lin = fitCorrection(pairs.map(([m, x]) => [m, 1 + 0.8 * x]));
near(lin.b, 0.8, 'correction slope recovered', 0.03);
eq(fitCorrection(pairs.map(([m]) => [m, 100 - 3 * m])).b, 0.6, 'the correction slope is held at 0.6 or more');
eq(fitCorrection(pairs.slice(0, 5)), { a: 0, b: 1 }, 'too few pairs: no correction');

// --- the model on a made-up league ------------------------------------------------
const NOW = Date.parse('2026-01-15T18:00:00Z');
const L = nbaModelLeague({});
const model = buildModel({ sport: 'nba', rows: L.rows, now: NOW });
eq(model.model_version, SPORTS_MODEL_VERSION);
eq([model.sport, model.as_of_date, model.generated_utc], ['nba', '2026-01-08', '2026-01-15T18:00:00.000Z']);
ok(JSON.stringify(model) === JSON.stringify(buildModel({ sport: 'nba', rows: L.rows.slice().reverse(), now: NOW })), 'the same games always give the same model, in any order');
ok(Buffer.byteLength(JSON.stringify(model)) < 64 * 1024, 'the model record stays small');
const P = model.evaluation.points, R = model.evaluation.rebounds;
eq(P.status, 'validated', 'points pass the check when the league has real opponent effects');
ok(P.test.n >= 300 && P.test.brier.model < P.test.brier.last10_hit_rate && P.test.brier.model < P.test.brier.plain_average && P.test.ece <= 0.03, 'the validation bar');
ok(P.split_date > P.train.from && P.test.to >= P.split_date, 'holdout days come after the fitting days');
ok(P.train.n > P.test.n, 'about 60% of days fit, 40% check');
eq([R.status, R.reason], ['experimental', 'did not beat both simple baselines'], 'rebounds have no opponent effect here, so the plain average is as good');
ok(model.context.teams.points[SOFT_DEFENSE].factor > 1.05, 'finds the soft defense');
ok(model.context.teams.points[TOUGH_DEFENSE].factor < 0.95, 'finds the tough defense');
ok(model.context.location.points.home > 1, 'finds the home edge');
ok(P.test.reliability.every((b) => b.n > 0 && b.lo >= 0 && b.hi <= 1), 'reliability bins');
ok(/regular-role games only \(20\+ expected minutes\)/.test(model.scored), 'says which games were scored');
const summary = modelSummary({ ...model, seasons: [2025] });
eq(Object.keys(summary.stats), Object.keys(MODEL_SPECS.nba), 'every modeled stat has a check');
eq([summary.stats.points.status, summary.stats.rebounds.reason, summary.seasons], ['validated', 'did not beat both simple baselines', [2025]]);
eq(summary.stats.assists.reason, 'not enough past games to check yet', 'a stat the league has no numbers for is never validated');
eq(model.evaluation.pts_reb.forecasts > 0, true, 'combos are summed from the stored stats and modeled');
// Every stat the catalog marks as modeled has a spec, in catalog order.
for (const sp of ['nba', 'nfl']) eq(SPORTS_STATS[sp].filter((x) => x.model).map((x) => x.id), Object.keys(MODEL_SPECS[sp]), sp + ' catalog and model specs agree');
eq(SPORTS_MODEL_VERSION, 'sports-model-3');
eq(PROP_RANK_VERSION, 'props-rank-4');
const empty = buildModel({ sport: 'nfl', rows: [], now: NOW });
eq([empty.evaluation.passing_yards.status, empty.evaluation.receptions.reason], ['experimental', 'not enough past games to check yet'], 'no data: experimental, never validated');

// --- one forecast ------------------------------------------------------------------
const hist = (id, before = '9999') => L.rows.filter((r) => r.player_id === id && r.date < before).sort((a, b) => b.date.localeCompare(a.date));
const star = L.truth.find((p) => p.team === 'gs' && p.minutes === 34);
const fc = forecastStat({ sport: 'nba', stat: 'points', history: hist(star.player_id), home: true, opponent: SOFT_DEFENSE, group: 'G', model, side: 'over', threshold: 20.5, lines: true });
eq([fc.status, fc.quality, fc.regular_role, fc.unit], ['ok', 'validated', true, 'minutes']);
ok(fc.probability > 0 && fc.probability < 1 && fc.push === 0, 'a chance for the line, no push on a half line');
ok(fc.sensitivity.opportunity_down_10 < fc.probability && fc.probability < fc.sensitivity.opportunity_up_10, 'more minutes, better over');
ok(fc.low < fc.mean && fc.mean < fc.high, 'the range brackets the forecast');
eq(fc.lines.length, 5);
ok(fc.lines.every((x, i) => i === 0 || (x.threshold === fc.lines[i - 1].threshold + 1 && x.over < fc.lines[i - 1].over)), 'higher lines, lower chance of the over');
const vsTough = forecastStat({ sport: 'nba', stat: 'points', history: hist(star.player_id), home: true, opponent: TOUGH_DEFENSE, group: 'G', model });
ok(vsTough.mean < fc.mean, 'a tough defense lowers the forecast');
const away = forecastStat({ sport: 'nba', stat: 'points', history: hist(star.player_id), home: false, opponent: SOFT_DEFENSE, group: 'G', model });
ok(away.mean < fc.mean, 'away lowers it a little');
const bench = L.truth.find((p) => p.team === 'gs' && p.minutes === 11);
const fcBench = forecastStat({ sport: 'nba', stat: 'points', history: hist(bench.player_id), home: true, opponent: 'bos', group: 'C', model });
eq([fcBench.status, fcBench.regular_role, fcBench.quality], ['ok', false, 'experimental'], 'a bench role is outside the check, so never shown as validated');
eq(forecastStat({ sport: 'nba', stat: 'points', history: hist(star.player_id).slice(-(MIN_GAMES - 1)), home: true, opponent: 'bos', group: 'G', model }).reason, 'too_few_games');
eq(forecastStat({ sport: 'nba', stat: 'points', history: hist(star.player_id), home: true, opponent: 'bos', group: 'G', model: null }).reason, 'no_model');
eq(forecastStat({ sport: 'nba', stat: 'field_goals_made', history: hist(star.player_id), home: true, opponent: 'bos', group: 'G', model }).reason, 'stat', 'only enabled stats are modeled');
eq(forecastStat({ sport: 'nba', stat: 'assists', history: hist(star.player_id), home: true, opponent: 'bos', group: 'G', model }).reason, 'too_few_games', 'no stored assists: no forecast');
// The forecast reads the games it is given and nothing later.
const early = forecastStat({ sport: 'nba', stat: 'points', history: hist(star.player_id, '2025-12-01'), home: true, opponent: 'bos', group: 'G', model });
const tampered = L.rows.map((r) => (r.date >= '2025-12-01' && r.player_id === star.player_id ? { ...r, stats: { ...r.stats, points: 90 } } : r));
eq(forecastStat({ sport: 'nba', stat: 'points', history: tampered.filter((r) => r.player_id === star.player_id && r.date < '2025-12-01').sort((a, b) => b.date.localeCompare(a.date)), home: true, opponent: 'bos', group: 'G', model }).mean, early.mean, 'later games never leak in');

// NFL: positions decide which stats are modeled; passing yards use the normal curve.
eq([positionGroup('nfl', 'QB'), positionGroup('nfl', 'FB'), positionGroup('nfl', 'K'), positionGroup('nba', 'PF'), positionGroup('nba', 'C'), positionGroup('nba', 'SG')], ['QB', 'RB', 'other', 'F', 'C', 'G']);
eq([MODEL_SPECS.nfl.passing_yards.dist, MODEL_SPECS.nfl.receptions.dist, MODEL_SPECS.nba.points.dist], ['normal', 'nb', 'nb']);
eq([MODEL_SPECS.nfl.receiving_yards.dist, MODEL_SPECS.nfl.rushing_yards.dist, MODEL_SPECS.nfl.rush_rec_yards.dist, MODEL_SPECS.nfl.pass_rush_yards.dist], ['nb', 'nb', 'nb', 'normal'], 'measured on real seasons: NB for rushing/receiving yards, normal for passing');
eq([MODEL_SPECS.nfl.rush_rec_yards.opportunity, MODEL_SPECS.nfl.pass_rush_yards.opportunity], [['carries', 'targets'], ['attempts', 'carries']], 'combo yards use the summed opportunity');
const nflContext = { context: {
  groups: { passing_yards: { QB: { opp_mean: 33, rate: 7, n: 500 } }, receptions: { WR: { opp_mean: 6, rate: 0.62, n: 900 } } },
  teams: { passing_yards: { kc: { factor: 1.04, games: 12 } }, receptions: {} },
  location: { passing_yards: { home: 1.02, away: 0.98 }, receptions: { home: 1, away: 1 } },
  spread: { passing_yards: { a: 6400, b: 0 }, receptions: { a: 0.2, b: 1.25 } },
  correction: { passing_yards: { a: 0, b: 1 }, receptions: { a: 0, b: 1 } },
}, model_version: SPORTS_MODEL_VERSION, as_of_date: '2026-11-01', evaluation: { passing_yards: { status: 'validated' }, receptions: { status: 'experimental' } } };
const qbRows = Array.from({ length: 8 }, (_, i) => ({ date: '2026-10-' + String(25 - i).padStart(2, '0'), game_id: 'g' + i, played: true, position: 'QB', stats: { attempts: 35, passing_yards: 250 } }));
const qb = forecastStat({ sport: 'nfl', stat: 'passing_yards', history: qbRows, home: true, opponent: 'kc', group: 'QB', model: nflContext, side: 'over', threshold: 260 });
near(qb.mean, 35 * 7.0 * 1.04 * 1.02, 'attempts × yards per attempt × opponent × home', 30);
ok(qb.push > 0 && qb.push < 0.01, 'a whole-yard line can push, rarely');
eq([qb.quality, qb.unit], ['validated', 'pass attempts']);
eq(forecastStat({ sport: 'nfl', stat: 'receptions', history: qbRows, home: true, opponent: 'kc', group: 'QB', model: nflContext }).reason, 'position', 'receptions are not modeled for quarterbacks');
eq(forecastStat({ sport: 'nfl', stat: 'passing_yards', history: qbRows, home: true, opponent: 'kc', group: 'QB', model: { ...nflContext, context: { ...nflContext.context, spread: {} } } }).reason, 'no_model', 'no fitted spread: no forecast');

// --- teammates out (NBA) -------------------------------------------------------------
const r10 = (team, mins, lastDate = '2026-01-10', played = 10) => Array.from({ length: 10 }, (_, i) => ({
  date: new Date(Date.parse(lastDate + 'T12:00:00Z') - i * 2 * 86400000).toISOString().slice(0, 10), team, played: i < played, minutes: i < played ? mins : 0,
}));
near(regularMinutes(r10('gs', 30), 'gs', '2026-01-12'), 30, 'a regular: his average minutes');
eq(regularMinutes(r10('gs', 12), 'gs', '2026-01-12'), 0, 'under 15 minutes is not a regular');
eq(regularMinutes(r10('bos', 30), 'gs', '2026-01-12'), 0, 'a player now on another team does not count');
eq(regularMinutes(r10('gs', 30, '2025-12-20'), 'gs', '2026-01-12'), 0, 'gone more than 12 days: already priced into the team');
eq(regularMinutes(r10('gs', 30).map((r, i) => (i < 3 ? { ...r, played: false } : r)), 'gs', '2026-01-12'), 0, 'out of the rotation lately: not a regular');
eq(absentMinutes([r10('gs', 30), r10('gs', 20), r10('gs', 8)], 'gs', '2026-01-12'), 50, 'minutes lost add up over the regulars out');
eq(absenceFactor({ absence: { points: { beta: 0.5 } } }, 'points', 60), 1.125, 'lift = beta × minutes out / 240');
eq(absenceFactor({ absence: { points: { beta: 0.5 } } }, 'points', 400), 1.25, 'held at 120 minutes out');
eq([absenceFactor({ absence: { points: { beta: 0 } } }, 'points', 60), absenceFactor({}, 'points', 60)], [1, 1], 'no measured lift: no change');
eq(ABSENCE.teamMinutes, 240);
const tPts = model.evaluation.points.teammates_out;
eq(typeof tPts.applied, 'boolean', 'the check reports whether teammates out is used');
ok(tPts.without && tPts.with && typeof tPts.why === 'string', 'with and without scores');
// A league where regulars sit and their teammates score more: the fit finds
// the lift and uses it; the plain league has none to use.
const LA = nbaModelLeague({ absenceLift: 1.2 });
const modelA = buildModel({ sport: 'nba', rows: LA.rows, now: NOW, includeJoint: false });
const tA = modelA.evaluation.points.teammates_out;
ok(tA.applied && modelA.context.absence.points.beta > 0.3 && tA.with.brier < tA.without.brier, 'finds the teammates-out lift and beats no adjustment');
eq(model.context.absence.points.beta, 0, 'the plain league shows no lift, so none is used');
eq(model.evaluation.rebounds.teammates_out.applied, false);
const starA = LA.truth.find((p) => p.team === 'gs' && p.minutes === 34);
const histA = LA.rows.filter((r) => r.player_id === starA.player_id).sort((a, b) => b.date.localeCompare(a.date));
const noneOut = forecastStat({ sport: 'nba', stat: 'points', history: histA, home: true, opponent: 'bos', group: 'G', model: modelA, side: 'over', threshold: 20.5 });
const twoOut = forecastStat({ sport: 'nba', stat: 'points', history: histA, home: true, opponent: 'bos', group: 'G', model: modelA, side: 'over', threshold: 20.5, absent: 60 });
near(twoOut.mean, noneOut.mean * absenceFactor(modelA.context, 'points', 60), 'the forecast rises by the fitted lift', 0.01);
ok(twoOut.probability > noneOut.probability, 'and the over gets likelier');
eq([twoOut.teammates_out.minutes, twoOut.teammates_out.applied, noneOut.teammates_out], [60, true, undefined], 'the forecast says who is out only when someone is');
ok(twoOut.sensitivity.opportunity_down_10 < twoOut.probability, 'the minutes check keeps the lift');
eq(forecastStat({ sport: 'nfl', stat: 'passing_yards', history: qbRows, home: true, opponent: 'kc', group: 'QB', model: nflContext, absent: 60 }).teammates_out, undefined, 'NFL: not used');
// Live: teammates listed Out or Doubtful on the injury report, regulars only.
const lastDay = LA.rows.reduce((a, r) => (r.date > a ? r.date : a), '');
const nextDay = new Date(Date.parse(lastDay + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
const gsReg = LA.truth.filter((p) => p.team === 'gs');
const reports = [
  { name: gsReg[1].name, espn_id: gsReg[1].player_id, team: 'gs', status: 'Out', detail: '' },
  { name: gsReg[2].name, espn_id: gsReg[2].player_id, team: 'gs', status: 'Doubtful', detail: '' },
  { name: gsReg[3].name, espn_id: gsReg[3].player_id, team: 'gs', status: 'Questionable', detail: '' },
  { name: gsReg[7].name, espn_id: gsReg[7].player_id, team: 'gs', status: 'Out', detail: '' },
];
const ta = teamAbsence({ sport: 'nba', team: 'gs', date: nextDay, reports, players: LA.players, rows: LA.rows });
eq(ta.players.map((x) => x.player_id).sort(), [gsReg[1].player_id, gsReg[2].player_id].sort(), 'Out and Doubtful regulars count; Questionable and a bench player do not');
near(ta.minutes, ta.players.reduce((a, b) => a + b.minutes, 0), 'minutes add up', 0.01);
eq(teamAbsence({ sport: 'nba', team: 'gs', date: nextDay, reports: [], players: LA.players, rows: LA.rows }), { minutes: 0, players: [] }, 'no report: nobody out');
eq(teamAbsence({ sport: 'nfl', team: 'gs', date: nextDay, reports, players: LA.players, rows: LA.rows }).minutes, 0, 'NFL: not used');
eq(teamAbsence({ sport: 'nba', team: 'gs', date: nextDay, reports, players: LA.players, rows: LA.rows, exclude: gsReg[1].player_id }).players.map((x) => x.player_id), [gsReg[2].player_id], 'the player being forecast is never their own teammate out');

// --- real PrizePicks lines in the check (fix 4) -----------------------------------------
eq([model.evaluation.points.real_lines.n, model.evaluation.points.real_lines.note], [0, 'no real lines stored yet'], 'no stored lines: says so');
const split = model.evaluation.points.split_date;
const heldOut = L.rows.filter((r) => r.played && r.date >= split && r.minutes >= 20);
const realLines = heldOut.map((r, i) => ({ game_id: r.game_id, player_id: r.player_id, stat: 'points', threshold: 12.5 + (i % 9), source: i % 2 ? 'archive' : 'issued' }));
// The same game twice: the archived line wins over the issued one.
realLines.push({ ...realLines[0], threshold: 99.5, source: 'archive' });
realLines.push({ game_id: 'nope', player_id: 'nope', stat: 'points', threshold: 10.5, source: 'issued' });
realLines.push({ game_id: heldOut[0].game_id, player_id: heldOut[0].player_id, stat: 'field_goals_made', threshold: 5.5, source: 'issued' });
const modelR = buildModel({ sport: 'nba', rows: L.rows, now: NOW, includeJoint: false, lines: realLines });
const rl = modelR.evaluation.points.real_lines;
ok(rl.n >= 300 && rl.enough, 'held-out games are scored at the stored line');
eq(rl.provided, heldOut.length + 1, 'one line per game, player and stat; stats the model skips are ignored');
ok(rl.not_scored >= 1 && rl.n + rl.not_scored === rl.provided, 'lines with no scored game are counted, not scored');
ok(rl.sources.archive > 0 && rl.sources.issued > 0, 'issued and archived lines both count');
ok(rl.brier.model < rl.brier.last10_hit_rate && rl.brier.model < rl.brier.even, 'the model beats the last-10 hit rate and a coin flip at the real lines');
eq(modelR.evaluation.points.status, 'validated', 'beating both on real lines keeps it validated');
eq(modelR.context, buildModel({ sport: 'nba', rows: L.rows, now: NOW, includeJoint: false }).context, 'real lines are only scored: the forecasts are the same');
ok(rl.reliability.every((b) => b.n > 0), 'with its own reliability bins');
const rsum = modelSummary(modelR).stats.points;
eq([rsum.real_lines.n, rsum.real_lines.enough, rsum.teammates_out.applied], [rl.n, true, false], 'the status card carries real lines and teammates out');

// --- routes: player page and Pick Builder -------------------------------------------
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
const next = { sport: 'nba', game_id: 'mnext1', season: 2025, season_type: 'REG', week: null, start_utc: '2026-01-16T03:00:00Z', local_date: '2026-01-15', time_tbd: false, home_team: 'gs', away_team: SOFT_DEFENSE, status: 'scheduled', home_score: null, away_score: null, venue: null };
put('games', { sport: 'nba', season: 2025 }, { schema_version: 1, sport: 'nba', season: 2025, games: [...L.games, next] });
put('player-games', { sport: 'nba', season: 2025 }, { schema_version: 1, sport: 'nba', season: 2025, ...packRows(L.rows) });
put('players', { sport: 'nba' }, { schema_version: 1, players: L.players });
put('model', { sport: 'nba' }, { schema_version: 1, ...model, seasons: [2025] });
put('status', { sport: 'nba' }, { schema_version: 1, sport: 'nba', state: 'ok', last_success_utc: '2026-01-15T10:00:00Z', seasons: [2024, 2025], counts: { games: 481, player_games: L.rows.length, players: 96 }, model: modelSummary({ ...model, seasons: [2025] }) });
function fakeRes() {
  return { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const SAME = { origin: 'https://mingstreet.app', host: 'mingstreet.app', 'x-forwarded-proto': 'https' };
// The site reads the free ESPN injury report for the player page and NBA
// Pick Builder checks; tests pass a fake feed (default: unreachable).
const noFeed = async () => ({ injuries: { state: 'unavailable', reports: [] } });
async function call(method, query, body, feed = noFeed) {
  const res = fakeRes();
  await handleSportsRequest({ method, headers: SAME, query, body }, res, { env: { PRIVATE_DATA_ENABLED: '1' }, getSession: async () => ({ sub: 'owner-1', tr: true, tp: true }), store: st, now: () => NOW, loadPropSources: feed });
  return res;
}
const page = await call('GET', { sports: 'player', sport: 'nba', id: star.player_id });
eq(page.statusCode, 200);
eq([page.body.next_game.game_id, page.body.forecast.game_id, page.body.forecast.home, page.body.forecast.opponent], ['mnext1', 'mnext1', true, SOFT_DEFENSE], 'the forecast is for the next scheduled game');
const pf = page.body.forecast.forecasts;
eq([pf.points.status, pf.points.quality, pf.rebounds.quality], ['ok', 'validated', 'experimental'], 'each stat carries its own check');
eq(pf.points.lines.length, 5, 'chance of the over at five lines');
near(pf.points.mean, fc.mean, 'the page shows the same forecast as the model', 0.01);
const status = await call('GET', { sports: 'status' });
const sm = status.body.sources.nba.model;
eq([sm.model_version, sm.seasons, sm.stats.points.status, sm.stats.rebounds.status], [SPORTS_MODEL_VERSION, [2025], 'validated', 'experimental'], 'status carries the model check');
ok(sm.stats.points.test_n >= 300 && sm.stats.points.brier.model < sm.stats.points.brier.plain_average, 'status carries the scores');
eq(status.body.sources.nfl.model, null, 'a league with no model says so');
eq([page.body.availability.state, page.body.forecast.teammates_out], ['unavailable', undefined], 'no injury report: the page says so and assumes the usual lineup');
// The same injury context as the MCP: the player's own listing, and regular
// teammates listed out raise the NBA forecast; the player is never their own teammate out.
const gsMates = L.truth.filter((p) => p.team === 'gs' && p.player_id !== star.player_id && p.minutes >= 24);
const listing = (p, status) => ({ name: p.name, espn_id: p.player_id, team: 'gs', status, detail: 'Ankle' });
const feedOf = (reports) => async ({ parts }) => { eq(parts, ['injuries'], 'only the free injury feed is read'); return { injuries: { state: 'ok', observed_utc: new Date(NOW).toISOString(), reports } }; };
const hurt = await call('GET', { sports: 'player', sport: 'nba', id: star.player_id }, undefined, feedOf([listing(star, 'Questionable'), listing(gsMates[0], 'Out')]));
eq([hurt.body.availability.status, hurt.body.availability.unsure, hurt.body.availability.out], ['Questionable', true, false], 'the page shows the player’s own listing');
eq(hurt.body.forecast.teammates_out.map((x) => x.player_id), [gsMates[0].player_id], 'a regular teammate listed out reaches the forecast');
ok(hurt.body.forecast.forecasts.points.teammates_out.minutes > 0, 'each stat says how many minutes are out');
const selfOut = await call('GET', { sports: 'player', sport: 'nba', id: star.player_id }, undefined, feedOf([listing(star, 'Out')]));
eq([selfOut.body.availability.out, selfOut.body.forecast.teammates_out], [true, undefined], 'the player’s own Out listing never raises their forecast');
near(selfOut.body.forecast.forecasts.points.mean, pf.points.mean, 'and the forecast is unchanged', 1e-9);

const leg = (extra = {}) => ({ sport: 'nba', player_id: star.player_id, game_id: 'mnext1', stat: 'points', side: 'over', threshold: 20.5, ...extra });
const ev = await call('POST', { sports: 'evaluate' }, { legs: [leg()] });
eq(ev.statusCode, 200);
const lm = ev.body.legs[0].model;
eq([lm.status, lm.quality], ['ok', 'validated']);
near(lm.probability, fc.probability, 'the Pick Builder shows the model’s chance for the typed line', 1e-4);
ok(lm.sensitivity && lm.mean > 0 && lm.low <= lm.high, 'with its range and minutes check');
ok(!('lines' in lm) && !('rate' in lm), 'saved legs carry a small model snapshot');
const kept = await call('POST', { sports: 'evaluate' }, { legs: [leg({ probability: lm.probability, probability_source: 'model' })] });
eq(kept.body.legs[0].probability_source, 'model', 'the model’s own number keeps its label');
const relabeled = await call('POST', { sports: 'evaluate' }, { legs: [leg({ probability: 0.5, probability_source: 'model' })] });
eq(relabeled.body.legs[0].probability_source, 'owner', 'any other number is the owner’s');
ok(PROB_SOURCES.includes('model'));
const benchLeg = await call('POST', { sports: 'evaluate' }, { legs: [leg({ player_id: bench.player_id })] });
eq(benchLeg.body.legs[0].model.quality, 'experimental');
const otherGame = await call('POST', { sports: 'evaluate' }, { legs: [leg({ player_id: L.truth.find((p) => p.team === 'bos').player_id })] });
eq(otherGame.body.legs[0].model, { status: 'not_calculated', reason: 'team' }, 'no forecast for a player not in the game');
const evOut = await call('POST', { sports: 'evaluate' }, { legs: [leg()] }, feedOf([listing(star, 'Out'), listing(gsMates[0], 'Out')]));
eq([evOut.body.legs[0].availability.status, evOut.body.legs[0].availability.out], ['Out', true], 'the Pick Builder shows the player’s listing');
eq(evOut.body.legs[0].model.teammates_out.minutes, hurt.body.forecast.forecasts.points.teammates_out.minutes, 'and counts the same teammates out as the player page, never the player');
const savedOut = await call('POST', { sports: 'save-entry' }, { legs: [leg({ probability: evOut.body.legs[0].model.probability, probability_source: 'model' })], operator: 'prizepicks', format: 'power', stake: 5, payouts: { 1: 1.5 } }, feedOf([listing(star, 'Out'), listing(gsMates[0], 'Out')]));
eq([savedOut.body.entry.legs[0].probability_source, 'availability' in savedOut.body.entry.legs[0]], ['model', false], 'saving reads the same report, so the model’s chance keeps its label; the listing is not saved');
const saved = await call('POST', { sports: 'save-entry' }, { legs: [leg({ probability: lm.probability, probability_source: 'model' })], operator: 'prizepicks', format: 'power', stake: 5, payouts: { 1: 1.5 } });
eq(saved.statusCode, 200);
eq([saved.body.entry.legs[0].probability_source, saved.body.entry.legs[0].model.probability], ['model', lm.probability], 'the saved entry keeps the model’s chance as it was');
const journal = await call('GET', { sports: 'journal' });
eq(journal.body.calibration, { model: { picks: 0, mean_chance: null, hit_rate: null, brier: null }, used: { picks: 0, mean_chance: null, hit_rate: null, brier: null } }, 'nothing settled: no calibration yet');

// --- calibration of settled picks ---------------------------------------------------
const settledLegs = [
  { result: 'win', probability: 0.6, model: { status: 'ok', probability: 0.7 } },
  { result: 'loss', probability: 0.6, model: { status: 'ok', probability: 0.4 } },
  { result: 'win', probability: null, model: { status: 'not_calculated' } },
];
eq(chanceCheck(settledLegs, (l) => (l.model.status === 'ok' ? l.model.probability : null)), { picks: 2, mean_chance: 0.55, hit_rate: 0.5, brier: 0.125 });
eq(chanceCheck(settledLegs, (l) => l.probability), { picks: 2, mean_chance: 0.6, hit_rate: 0.5, brier: 0.26 });

// --- the daily job fits and stores the model ------------------------------------------
const files = new Map([
  [HOOPR_URLS.schedule(2025), SCHEDULE_2026], [HOOPR_URLS.schedule(2026), SCHEDULE_2027], [HOOPR_URLS.box(2025), BOX_2026], [HOOPR_URLS.box(2026), BOX_2027],
  [NFLVERSE_URLS.games, GAMES], [NFLVERSE_URLS.players, PLAYERS], [NFLVERSE_URLS.weekly(2025), WEEK_2025], [NFLVERSE_URLS.weekly(2026), WEEK_2026],
]);
const fetchText = async (url) => files.get(url) ?? null;
const job = fakeR2();
const INGEST_NOW = Date.parse('2026-11-02T18:00:00Z');
const nba = await ingestLeague({ adapter: NBA_SOURCE, store: job, fetchText, now: INGEST_NOW });
ok(job.objects.has(SPORTS_PREFIX + 'nba/model.json'), 'the NBA job writes the model');
eq([nba.status.state, nba.status.model.model_version, nba.status.model.stats.points.status], ['ok', SPORTS_MODEL_VERSION, 'experimental'], 'a few fixture games: experimental');
const nfl = await ingestLeague({ adapter: NFL_SOURCE, store: job, fetchText, now: INGEST_NOW });
eq(NFL_SOURCE.modelHistory, 3, 'NFL keeps three older seasons for the model');
const noHistory = await ingestLeague({ adapter: { ...NFL_SOURCE, modelHistory: 0 }, store: fakeR2(), fetchText, now: INGEST_NOW });
eq([nfl.status.state, nfl.status.seasons, nfl.status.counts], [noHistory.status.state, [2025, 2026], noHistory.status.counts], 'missing older seasons never fail the run or change the pages');
ok(/older seasons for the model are unavailable: 2022, 2023, 2024(;|$)/.test(nfl.status.message), 'and are noted in one line');
const keys = [...job.objects.keys()].map((k) => k.slice(SPORTS_PREFIX.length));
ok(keys.includes('nfl/model.json') && !keys.some((k) => /\/(2022|2023|2024)\.json$/.test(k)), 'nothing is stored for a missing older season');
// A finished older season already in the store is used as is: no download.
const job2 = fakeR2();
const oldRows = JSON.parse(job.objects.get(SPORTS_PREFIX + 'nfl/player-games/2025.json'));
const oldGames = JSON.parse(job.objects.get(SPORTS_PREFIX + 'nfl/games/2025.json'));
job2.objects.set(SPORTS_PREFIX + 'nfl/player-games/2024.json', JSON.stringify({ ...oldRows, season: 2024, complete: true }));
job2.objects.set(SPORTS_PREFIX + 'nfl/games/2024.json', JSON.stringify({ ...oldGames, season: 2024, complete: true }));
const asked = [];
const withHistory = await ingestLeague({ adapter: NFL_SOURCE, store: job2, fetchText: async (url) => { asked.push(url); return files.get(url) ?? null; }, now: INGEST_NOW });
eq(withHistory.status.seasons, [2025, 2026], 'pages still read two seasons');
eq(withHistory.status.model.seasons, [2024, 2025, 2026], 'the model also reads the stored older season');
ok(!asked.includes(NFLVERSE_URLS.weekly(2024)), 'a stored finished season is not downloaded again');
ok(/older seasons for the model are unavailable: 2022, 2023(;|$)/.test(withHistory.status.message), 'only the missing ones are noted (no 2023 schedule in the fixture, so its stats are not even asked for)');
ok(!asked.includes(NFLVERSE_URLS.weekly(2023)));

console.log(`Sports model smoke passed (${checks} checks).`);
