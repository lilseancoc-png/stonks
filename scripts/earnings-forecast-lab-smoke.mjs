// Earnings Forecast history test (lib/earnings-forecast-lab.mjs): the replay
// never reads the future, a planted better rule wins and an unplanted one does
// not, the ranges cover what they claim, the winner reaches the frozen forecast
// only through forecastQuarter's rules, the analyst archive and the Calibration
// Lab hookup. Synthetic companies only; no network.
// Run: node scripts/earnings-forecast-lab-smoke.mjs
import assert from 'node:assert/strict';
import { historyUniverse, historyFred } from './fixtures/earnings-forecast-history.mjs';
import { forecastQuarter, quarterlyFacts, evaluateRuns, makeObservation, selectCohort, normalizeCompanyFacts, HISTORY_YEARS, FORECAST_MODEL } from '../lib/earnings-forecast.mjs';
import { LAB_MODELS, LAB_MIN_ROWS, LAB_BAND_MIN, LAB_HORIZON_DAYS, companyOrigins, originsKey, growthRules, buildHistoryLab, bandQuantiles, forecastBands, forecastCalibrationSources, archiveConsensus, consensusForward, macroFeatures, fitDrivers, labQuarter } from '../lib/earnings-forecast-lab.mjs';
import { scoreSource } from '../lib/labs/calibration.mjs';
import { trialsAdjustedT } from '../lib/labs/stats.mjs';
import { prepareEarningsForecast, readForecastState } from './refresh-earnings-forecast.mjs';
import { graderContextBuilder } from './build.mjs';
import { OWNER_SETTINGS } from '../lib/owner-settings.mjs';
import { isPremiumKey, roleClaimForKey } from '../lib/premium-keys.mjs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const DAY = 86400000, asOf = '2026-11-16T12:00:00.000Z';
const originsOf = (uni, at = asOf) => Object.fromEntries(Object.entries(uni).map(([s, obs]) => [s, companyOrigins(s, obs, at)]));

// --- the rule arithmetic ----------------------------------------------------------------
{
  const q = (end, v) => ({ end, currency: 'USD', basis: 'US GAAP', metrics: { revenue: { value: v } } });
  const known = [q('2023-03-31', 100), q('2023-06-30', 100), q('2023-09-30', 100), q('2023-12-31', 100), q('2024-03-31', 104), q('2024-06-30', 108), q('2024-09-30', 112), q('2024-12-31', 120)];
  const r = growthRules(known, '2025-03-31');
  eq(r.last, 120, 'last quarter again');
  eq(r.seasonal, 104, 'same quarter last year');
  ok(Math.abs(r.latest - 104 * 1.2) < 1e-9, 'latest growth uses the newest year-over-year rate');
  ok(Math.abs(r.weighted - 104 * (1 + (0.04 * 1 + 0.08 * 2 + 0.12 * 3 + 0.2 * 4) / 10)) < 1e-9, 'weighted growth counts the newest most');
  ok(Math.abs(r.trend - 104 * (1 + 0.2 + 0.5 * (0.2 - 0.12))) < 1e-9, 'trend adds half the latest change in growth');
  eq(growthRules(known.slice(-3), '2025-03-31'), null, 'no year-ago quarter, no rules');
  const short = growthRules([q('2024-03-31', 100), q('2024-12-31', 120)], '2025-03-31');
  ok(short.seasonal === 100 && short.latest === null && short.trend === null, 'no growth history leaves the growth rules empty');
  eq(labQuarter('2025-03-31'), '2025-Q1', 'calendar quarter of a quarter end');
  eq(labQuarter('2025-04-05'), '2025-Q1', 'a 52/53-week quarter ending early next month stays in its quarter');
  eq(LAB_MODELS.filter((m) => m.role === 'candidate').length, 4, 'four candidate rules');
  ok(LAB_MODELS.every((m) => m.label && m.hint && !/[—]/.test(m.label + m.hint)), 'every rule has a plain label and hint');
  eq(HISTORY_YEARS, 11, 'eleven fiscal years of filed history are kept');
}

// --- the replay never reads the future ----------------------------------------------------
const trending = historyUniverse({ mode: 'trending' });
const steady = historyUniverse({ mode: 'steady' });
{
  const sym = 'H00', obs = trending[sym], rows = companyOrigins(sym, obs, asOf);
  ok(rows.length >= 38, 'ten years of quarters are replayed (' + rows.length + ')');
  ok(rows.every((r) => Date.parse(r.a) - Date.parse(r.c) === LAB_HORIZON_DAYS * DAY), 'each forecast is made seven days before the result was public');
  const r = rows[20], run = forecastQuarter({ symbol: sym, observations: obs, cutoffAt: r.c, mode: 'reconstructed' });
  eq(r.f.base, run.outputs.revenue, 'the current rule in the replay is forecastQuarter at that cutoff');
  eq(r.f.seasonal, run.baseline.revenue, 'the seasonal baseline matches too');
  const known = quarterlyFacts(obs, r.c, { mode: 'reconstructed' });
  ok(known.every((q) => q.end < r.e), 'nothing from the target quarter or later is known at the cutoff');
  // A later restatement of an old quarter must not change any earlier row.
  const old = obs.find((o) => o.metric === 'revenue' && o.end === rows[10].e);
  const restated = makeObservation({ ...old, id: undefined, value: old.value * 3, filed: '2026-10-01', availableAt: '2026-10-02T12:00:00.000Z', firstSeenAt: '2026-10-02T12:00:00.000Z', accession: 'restated' });
  const after = companyOrigins(sym, [...obs, restated], asOf);
  eq(after.slice(0, 11).map((x) => [x.A, x.f]), rows.slice(0, 11).map((x) => [x.A, x.f]), 'a later restatement leaves earlier forecasts and first-reported actuals alone');
  ok(rows.every((x) => x.eps && Number.isFinite(x.eps.base) && Number.isFinite(x.eps.seasonal)), 'EPS rides the same replay');
  // An earlier `asOf` sees fewer quarters and the same rows for the ones it sees.
  const early = companyOrigins(sym, obs, '2022-01-15T12:00:00.000Z');
  ok(early.length < rows.length && early.every((x, i) => x.e === rows[i].e && x.f.base === rows[i].f.base), 'an earlier as-of date replays a prefix of the same rows');
  ok(originsKey(obs, asOf) !== originsKey(obs, '2022-01-15T12:00:00.000Z') && originsKey(obs, asOf) === originsKey([...obs], asOf), 'the cache key moves only when the public facts do');
  { const swapped = [...obs.slice(1), { ...obs[obs.length - 1], end: '2026-09-30', availableAt: '2026-11-10T12:00:00.000Z' }]; ok(swapped.length === obs.length && originsKey(swapped, asOf) !== originsKey(obs, asOf), 'the cache key moves when one fact replaces another and the count stays the same'); }
  eq(companyOrigins('NONE', [], asOf), [], 'no facts, no rows');
  // A split between the year-ago quarter and the target drops the EPS baseline rather than compare two share bases.
  const split = obs.map((o) => (o.end >= '2022-01-01' && o.metric === 'dilutedShares' ? { ...o, value: o.value * 10 } : o.end >= '2022-01-01' && o.metric === 'eps' ? { ...o, value: o.value / 10 } : o));
  const splitRows = companyOrigins(sym, split, asOf).filter((x) => x.e >= '2022-01-01' && x.e <= '2022-12-31');
  ok(splitRows.length >= 3 && splitRows.every((x) => !x.eps || x.eps.seasonal === null), 'a year-ago EPS on a different share count is not used as a baseline');
}

// --- a planted better rule wins; an unplanted one does not ----------------------------------
const fred = historyFred();
const labT = buildHistoryLab({ origins: originsOf(trending), fred, asOf });
const labS = buildHistoryLab({ origins: originsOf(steady), fred, asOf });
{
  const s = labT.summary, by = Object.fromEntries(s.models.map((m) => [m.id, m]));
  ok(s.rows >= 400 && s.companies === 12 && s.quarters >= 38, 'the test covers every company and quarter');
  eq(s.tBar, Math.round(trialsAdjustedT(4) * 100) / 100, 'the bar allows for four rules tried');
  eq(s.verdict, 'promoted', 'drifting growth: a newer-growth rule is promoted');
  ok(['latest', 'weighted'].includes(s.winner.id) && s.inUse === s.winner.id, 'the winner is a rule that leans on recent growth (' + s.winner.id + ')');
  ok(by[s.winner.id].vsCurrent.pass && by[s.winner.id].vsCurrent.firstHalf > 0 && by[s.winner.id].vsCurrent.secondHalf > 0 && by[s.winner.id].vsCurrent.t >= s.tBar, 'the winner leads in both halves by more than the bar');
  ok(by[s.winner.id].typical < by.base.typical && by.base.typical < by.seasonal.typical, 'typical misses rank winner < current < same quarter last year');
  ok(by.base.vsCurrent === undefined && by.seasonal.vsCurrent.pass === false && by.picked.vsCurrent.pass === false, 'baselines and the pick-the-best check can never be promoted');
  ok(by.picked.n < by.base.n && by.picked.average <= by.base.average, 'picking the best so far would have helped out of sample');
  ok(s.drivers.fitted && s.drivers.inputs[0].weight > 0 && s.drivers.macro, 'the drivers rule learns that early reporters carry the shared shock');
  ok(by.drivers.n < by.base.n, 'the drivers rule is scored only once it had enough earlier quarters');
  ok(/beat the current rule/.test(s.read) && !/undefined|NaN/.test(s.read), 'the verdict reads in plain words');
  const t = labS.summary, bt = Object.fromEntries(t.models.map((m) => [m.id, m]));
  eq(t.verdict, 'current-stands', 'steady growth: the current rule stands');
  ok(t.winner === null && t.inUse === 'base' && bt.latest.vsCurrent.diff < 0, 'no winner, and latest growth is worse when growth is noise');
  ok(/stays/.test(t.read) && /Closest:/.test(t.read), 'the no-winner verdict names the closest rule');
  ok(labS.liveRevenue({ symbol: 'H00', known: [], targetEnd: '2026-09-30', baseRevenue: 1, cutoffAt: asOf }) === null, 'no winner, no live revenue');
}

// --- thin history, switches and holding a winner -------------------------------------------
{
  const few = Object.fromEntries(Object.entries(trending).slice(0, 2));
  const thin = buildHistoryLab({ origins: originsOf(few), asOf });
  ok(thin.summary.rows < LAB_MIN_ROWS && thin.summary.verdict === 'collecting' && thin.winner === null, 'under ' + LAB_MIN_ROWS + ' company-quarters reads Collecting');
  const empty = buildHistoryLab({ origins: {}, asOf });
  ok(empty.summary.rows === 0 && empty.summary.verdict === 'collecting' && Object.keys(empty.bands).length === 0, 'no companies still returns a summary');
  const off = buildHistoryLab({ origins: originsOf(trending), fred, asOf, promote: false });
  ok(off.summary.verdict === 'winner-off' && off.summary.inUse === 'base' && off.winner && /switch is off/.test(off.summary.read), 'the switch off names the winner and keeps the current rule');
  ok(off.liveRevenue({ symbol: 'H00', known: [], targetEnd: '2026-09-30', baseRevenue: 1, cutoffAt: asOf }) === null, 'the switch off supplies no revenue');
  const other = labT.winner.id === 'latest' ? 'weighted' : 'latest';
  const kept = buildHistoryLab({ origins: originsOf(trending), fred, asOf, prior: { winner: { id: other, since: '2026-01-01T00:00:00.000Z' } } });
  ok(kept.winner.id === other && kept.winner.since === '2026-01-01T00:00:00.000Z', 'a rule already in use stays while it still leads, with its start date');
  const dropped = buildHistoryLab({ origins: originsOf(steady), fred, asOf, prior: { winner: { id: 'latest', since: '2026-01-01T00:00:00.000Z' } } });
  ok(dropped.winner === null, 'a rule in use that now trails is dropped');
  const noMacro = buildHistoryLab({ origins: originsOf(trending), asOf });
  ok(noMacro.summary.drivers.macro === false && noMacro.summary.drivers.inputs[1].weight === 0 && noMacro.summary.drivers.inputs[0].weight > 0, 'without the macro cache the drivers rule uses early reporters only');
}

// --- drivers: timing and the fit ---------------------------------------------------------------
{
  const cutoff = Date.parse('2024-06-10T00:00:00Z');
  const mk = (extra) => ({ ip: new Map([['2023-01', 100], ['2023-04', 100], ['2024-01', 102], ['2024-04', 105], ...extra]), usd: new Map([['2023-04', 100], ['2024-04', 110], ['2023-05', 100], ['2024-05', 90]]) });
  const a = macroFeatures(mk([]), cutoff), b = macroFeatures(mk([['2024-05', 999], ['2024-06', 999]]), cutoff);
  eq(a, b, 'factory output for a month not yet published cannot change the reading');
  ok(Math.abs(a.ip - (0.05 - 0.02)) < 1e-9, 'factory output: the change in year-over-year growth over three months');
  ok(Math.abs(a.usd - (-0.1)) < 1e-9, 'the dollar: last full month against a year earlier');
  eq(macroFeatures({ ip: new Map(), usd: new Map() }, cutoff), { ip: 0, usd: 0 }, 'missing series read as no move');
  // The fit recovers planted weights and ignores an input that never moves.
  const sums = { n: 0, x: [0, 0, 0], xx: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], y: 0, xy: [0, 0, 0] };
  let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  for (let i = 0; i < 4000; i++) { const x = [rnd() * 0.1, rnd() * 0.06, 0], y = 0.01 + 0.6 * x[0] - 0.3 * x[1] + rnd() * 0.002; sums.n++; sums.y += y; for (let k = 0; k < 3; k++) { sums.x[k] += x[k]; sums.xy[k] += x[k] * y; for (let j = 0; j < 3; j++) sums.xx[k][j] += x[k] * x[j]; } }
  const fit = fitDrivers(sums);
  ok(Math.abs(fit.b[0] - 0.6) < 0.02 && Math.abs(fit.b[1] + 0.3) < 0.02 && fit.b[2] === 0 && Math.abs(fit.a - 0.01) < 0.002, 'the ridge fit recovers planted weights');
  eq(fitDrivers({ ...sums, n: 2 }), null, 'too few rows, no fit');
}

// --- ranges ------------------------------------------------------------------------------------------
{
  for (const [name, lab] of [['trending', labT], ['steady', labS]]) {
    const r = lab.summary.ranges;
    ok(r.revenue.p50.n >= 300 && Math.abs(r.revenue.p50.hit - 0.5) < 0.08, name + ': the 50% revenue range holds about half (' + r.revenue.p50.hit + ')');
    ok(Math.abs(r.revenue.p80.hit - 0.8) < 0.08, name + ': the 80% revenue range holds about four in five (' + r.revenue.p80.hit + ')');
    ok(Math.abs(r.eps.p50.hit - 0.5) < 0.08 && Math.abs(r.eps.p80.hit - 0.8) < 0.08, name + ': the EPS ranges hold what they claim');
    ok(r.revenue.p80.hit > r.revenue.p50.hit, name + ': the wider range holds more');
  }
  eq(bandQuantiles([0.01, 0.02], Array(LAB_BAND_MIN - 1).fill(0)), null, 'under ' + LAB_BAND_MIN + ' earlier results there is no range');
  const pool = Array.from({ length: 99 }, (_, i) => (i - 49) / 100);
  const none = bandQuantiles([], pool), own = bandQuantiles(Array.from({ length: 19 }, (_, i) => (i - 9) / 1000), pool);
  ok(Math.abs(none[0] + 0.4) < 1e-9 && Math.abs(none[3] - 0.4) < 1e-9 && Math.abs(none[1] + 0.25) < 1e-9, 'with no own history the range is everyone\'s, placed for the next result');
  ok(Math.abs(own[0]) < Math.abs(none[0]) && Math.abs(own[3]) < Math.abs(none[3]), 'a steadier company gets a tighter range');
  const two = bandQuantiles([0.5, 0.6], pool);
  ok(two[0] === none[0] && two[3] === none[3], 'two own results cannot place the outer cut points, so everyone\'s are used');
  const b = forecastBands(labT.bands, 'H00', { revenue: 1000, eps: 2 });
  ok(b.revenue.p80[0] < b.revenue.p50[0] && b.revenue.p50[0] < 1000 && b.revenue.p50[1] > 1000 && b.revenue.p80[1] > b.revenue.p50[1], 'money ranges nest around the forecast');
  ok(b.eps.p80[0] < b.eps.p50[0] && b.eps.p50[1] < b.eps.p80[1] && b.revenue.own >= 38, 'EPS ranges nest too');
  eq(forecastBands(labT.bands, 'ZZZ', { revenue: 1, eps: 1 }), null, 'an unknown company has no range');
  eq(forecastBands(labT.bands, 'H00', { revenue: null, eps: null }), null, 'a withheld forecast has no range');
  // Calibration Lab hookup.
  const sources = forecastCalibrationSources({ calibration: labT.calibration });
  eq(sources.map((s) => s.id), ['earnings-forecast-revenue-50', 'earnings-forecast-revenue-80', 'earnings-forecast-eps-50', 'earnings-forecast-eps-80'], 'four range sources');
  ok(sources.every((s) => s.kind === 'range' && s.rows.length >= 300 && s.rows.every((r) => r.lo < r.hi && Number.isFinite(r.actual))), 'each source carries graded ranges');
  const scored = sources.map((s) => scoreSource(s));
  ok(scored.every((s) => s.kind === 'range' && ['good', 'over', 'under'].includes(s.verdict) && Math.abs(s.covered - s.claimed) < 0.08), 'the Calibration Lab grades them');
  eq(forecastCalibrationSources(null), [], 'no test yet, no sources');
  eq(forecastCalibrationSources({ calibration: { revenue50: 'bad' } }).map((s) => s.rows.length), [0, 0, 0, 0], 'malformed rows are dropped');
}

// --- EPS, analysts and the estimate archive -------------------------------------------------------
{
  const e = labT.summary.eps, by = Object.fromEntries(e.models.map((m) => [m.id, m]));
  ok(by.base.typical < by.seasonal.typical && by.base.typical < by.last.typical && by.seasonal.currentBeatsBy.diff > 0, 'the EPS bridge beats both simple baselines');
  eq(e.analysts.n, 0, 'no stored analyst estimates, no comparison');
  const rows = originsOf({ H00: trending.H00 }).H00;
  const events = { H00: rows.map((r) => ({ date: new Date(Date.parse(r.e) + 25 * DAY).toISOString().slice(0, 10), epsEstimate: r.eps.A * 1.02, epsActual: r.eps.A })) };
  const withAnalysts = buildHistoryLab({ origins: originsOf(trending), earningsEvents: events, asOf }).summary.eps.analysts;
  ok(withAnalysts.n === rows.length && Math.abs(withAnalysts.analysts - 0.02) < 1e-3 && withAnalysts.ours > withAnalysts.analysts && /adjusted EPS/.test(withAnalysts.note), 'stored analyst estimates are scored on their own basis');
  const archive = {};
  const f1 = { revenueForwardEstimates: [{ date: '2026-12-31', period: '0q', value: 100 }, { date: '2027-12-31', period: '+1y', value: 400 }], epsForwardEstimates: [{ date: '2026-12-31', period: '0q', value: 1.5 }] };
  archiveConsensus(archive, 'H00', f1, '2026-11-16');
  eq(archive.H00, [{ d: '2026-11-16', end: '2026-12-31', rev: 100, eps: 1.5 }], 'the quarter estimates are archived; the full-year one is not');
  archiveConsensus(archive, 'H00', f1, '2026-11-17');
  eq(archive.H00.length, 1, 'an unchanged estimate adds no row');
  archiveConsensus(archive, 'H00', { ...f1, revenueForwardEstimates: [{ date: '2026-12-31', period: '0q', value: 110 }] }, '2026-11-18');
  archiveConsensus(archive, 'H00', { ...f1, revenueForwardEstimates: [{ date: '2026-12-31', period: '0q', value: 111 }] }, '2026-11-18');
  eq(archive.H00.map((r) => [r.d, r.rev]), [['2026-11-16', 100], ['2026-11-18', 111]], 'a change adds a row; a second change the same day replaces it');
  archiveConsensus(archive, 'H01', null, '2026-11-18');
  eq(archive.H01, [], 'no fundamentals, an empty archive');
  for (let i = 0; i < 300; i++) archiveConsensus(archive, 'H02', { revenueForwardEstimates: [{ date: '2026-12-31', period: '0q', value: 100 + i }] }, '2027-' + String(1 + (i % 12)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0') + 'x' + i);
  ok(archive.H02.length === 240, 'the archive is capped per company');
  const ev = (cutoffAt, forecast) => ({ kind: 'live', symbol: 'H00', targetEnd: '2026-12-31', metric: 'revenue', cutoffAt, forecast, actual: 108 });
  const fwd = consensusForward([ev('2026-11-17T12:00:00.000Z', 104)], archive);
  ok(fwd.revenue.n === 1 && Math.abs(fwd.revenue.analysts - 8 / 108) < 1e-3 && Math.abs(fwd.revenue.ours - 4 / 108) < 1e-3, 'a frozen forecast is compared with the estimate archived on or before its day, not a later one');
  eq(consensusForward([ev('2026-11-15T12:00:00.000Z', 104)], archive).revenue.n, 0, 'no estimate on or before the forecast day, no comparison');
  eq(consensusForward([ev('2026-11-17T12:00:00.000Z', 10)], archive).revenue.n, 0, 'an estimate on a different scale is not compared');
  ok(fwd.archived >= 242 && fwd.companies === 2 && fwd.since === '2026-11-16', 'the archive reports its size and start');
  eq(consensusForward([], {}), { revenue: { n: 0, ours: null, analysts: null }, eps: { n: 0, ours: null, analysts: null }, archived: 0, companies: 0, since: null }, 'an empty archive is reported as empty');
}

// --- the winner reaches a forecast only through forecastQuarter ---------------------------------------
{
  const sym = 'H03', obs = trending[sym], cutoffAt = asOf;
  const base = forecastQuarter({ symbol: sym, observations: obs, cutoffAt });
  eq(forecastQuarter({ symbol: sym, observations: obs, cutoffAt, historyModel: null }), base, 'no winner leaves the forecast and its input key untouched');
  ok(base.history === null && !('history' in base.manifest), 'no history fields join the manifest without a winner');
  const known = quarterlyFacts(obs, cutoffAt).filter((q) => q.currency === base.currency && q.basis === base.basis);
  const model = labT.liveRevenue({ symbol: sym, known, targetEnd: base.target.end, baseRevenue: base.comparison.baseRevenue, cutoffAt });
  ok(model && model.id === labT.winner.id && model.revenue === growthRules(known, base.target.end)[labT.winner.id], 'the live revenue is the winning rule on today\'s facts');
  const run = forecastQuarter({ symbol: sym, observations: obs, cutoffAt, historyModel: model });
  ok(run.outputs.revenue === model.revenue && run.history.active && run.history.prior.revenue === base.outputs.revenue && run.history.prior.eps === base.outputs.eps, 'the winner supplies revenue and the prior numbers are kept beside it');
  ok(run.inputKey !== base.inputKey && run.comparison.baseRevenue === base.comparison.baseRevenue && run.modelVersion === FORECAST_MODEL, 'a new input key, the same base comparison and model version');
  ok(Math.abs(run.outputs.eps / base.outputs.eps - run.outputs.revenue / base.outputs.revenue) < 0.02, 'EPS follows the new revenue through the same bridge');
  eq(forecastQuarter({ symbol: sym, observations: obs, cutoffAt, historyModel: { id: 'latest', revenue: -5 } }), base, 'a bad revenue is ignored');
  ok(labT.liveRevenue({ symbol: sym, known, targetEnd: base.target.end, baseRevenue: base.comparison.baseRevenue * 5, cutoffAt }) === null, 'a winner more than double or under half the base is refused');
  // Forward record: the winner's own error is scored, and it steps back after
  // eight quarters behind the base.
  const frozen = forecastQuarter({ symbol: sym, observations: obs, cutoffAt: '2026-06-01T12:00:00.000Z', historyModel: { id: 'latest', label: 'Latest growth', revenue: 1 } });
  const scored = evaluateRuns([frozen], { [sym]: obs }, asOf).find((e) => e.metric === 'revenue');
  ok(scored.historyModel === 'latest' && scored.historyAbsoluteError > scored.baseAbsoluteError, 'a resolved forecast scores the winner beside the base');
  ok(!('historyModel' in evaluateRuns([forecastQuarter({ symbol: sym, observations: obs, cutoffAt: '2026-06-01T12:00:00.000Z' })], { [sym]: obs }, asOf)[0]), 'forecasts without a winner keep their old evaluation shape');
  const trail = Array.from({ length: 8 }, (_, i) => ({ id: 'e' + i, symbol: sym, model: FORECAST_MODEL, metric: 'revenue', kind: 'live', historyModel: model.id, targetEnd: '2024-0' + (i + 1) + '-28', cutoffAt: '2024-0' + (i + 1) + '-01T00:00:00Z', actualAvailableAt: '2025-01-01T00:00:00Z', historyAbsoluteError: 5, baseAbsoluteError: 1, forecast: 1, error: 0 }));
  const demoted = forecastQuarter({ symbol: sym, observations: obs, cutoffAt, historyModel: model, liveEvaluations: trail });
  ok(!demoted.history.active && /Stepped back/.test(demoted.history.status) && demoted.outputs.revenue === base.comparison.baseRevenue, 'eight forward quarters behind the base step the winner back');
  const fine = forecastQuarter({ symbol: sym, observations: obs, cutoffAt, historyModel: model, liveEvaluations: trail.slice(0, 7) });
  ok(fine.history.active, 'seven forward quarters are not enough to step it back');
  // The Top Picks grader keeps reading the forward-tested rule.
  const ctx = graderContextBuilder({ earningsForecast: { companies: [{ symbol: sym, forecast: run }, { symbol: 'H04', forecast: base }] } });
  ok(ctx(sym).earningsForecast.outputs.revenue === base.outputs.revenue && ctx(sym).earningsForecast.outputs.eps === base.outputs.eps, 'the grader line keeps the prior revenue and EPS while a history winner is active');
  eq(ctx('H04').earningsForecast, base, 'a forecast with no winner reaches the grader unchanged');
}

// --- the drivers rule as a live winner is quantized ----------------------------------------------------
{
  const forced = buildHistoryLab({ origins: originsOf(trending), fred, asOf, prior: { winner: { id: 'drivers', since: asOf } } });
  if (forced.winner?.id === 'drivers') {
    const m = forced.liveRevenue({ symbol: 'H03', known: [], targetEnd: '2026-09-30', baseRevenue: 1e9, cutoffAt: asOf });
    ok(m && Math.abs((m.revenue / 1e9 - 1) * 1000 - Math.round((m.revenue / 1e9 - 1) * 1000)) < 1e-6 && Math.abs(m.revenue / 1e9 - 1) <= 0.15, 'the drivers shift is capped at 15% and rounded to a tenth of a percent');
  } else ok(true, 'drivers did not hold in this fixture');
}

// --- through the build step ------------------------------------------------------------------------------
{
  const dir = await mkdtemp(resolve(tmpdir(), 'earnings-forecast-lab-')), state = await readForecastState(dir);
  const symbols = Object.keys(trending), chains = Object.fromEntries(symbols.map((s, i) => [s, { fundamentals: { marketCap: 1000 - i, name: s, revenueForwardEstimates: [{ date: '2026-09-30', period: '0q', value: 5e8 }], epsForwardEstimates: [{ date: '2026-09-30', period: '0q', value: 1.1 }] } }]));
  state.cohort = selectCohort(chains, symbols, {}, asOf);
  for (const s of symbols) state.observations[s] = trending[s];
  const offline = () => { throw Error('The history test must not contact a provider'); };
  const first = await prepareEarningsForecast({ previous: state, chains, universe: symbols, sectors: {}, cikMap: new Map(), fetchImpl: offline, now: () => asOf, fred });
  const t = first.payload.historyTest;
  ok(t && t.verdict === 'promoted' && t.rows >= 400 && first.payload.cost.requestsThisRun === 0, 'the build step runs the test with no request');
  ok(first.payload.companies.every((c) => c.forecast.history?.active && c.forecast.bands?.revenue && c.forecast.outputs.revenue === c.forecast.history.revenue), 'every shown forecast uses the winner and carries its ranges');
  ok(first.payload.companies.every((c) => c.forecast.bands.revenue.p50[0] < c.forecast.outputs.revenue && c.forecast.outputs.revenue < c.forecast.bands.revenue.p50[1]), 'the forecast sits inside its own range');
  ok(first.state.lab.winner.id === t.winner.id && Object.keys(first.state.lab.origins).length === symbols.length && first.state.lab.calibration.revenue50.length >= 300, 'the state keeps the replay, the winner and the range rows');
  ok(!('origins' in t) && !('calibration' in t) && JSON.stringify(t).length < 20000, 'the page file carries the summary only');
  ok(first.state.consensus[symbols[0]].length === 1 && t.consensus.archived === symbols.length, 'today\'s analyst estimates are archived');
  ok(first.payload.methodology.some((m) => /History test/.test(m)) && first.payload.methodology.some((m) => /Ranges/.test(m)), 'the method notes explain the test and the ranges');
  eq(forecastCalibrationSources(first.state.lab).length, 4, 'the Calibration Lab can read the state');
  // Second build: nothing changed, so the replay is reused and no new run is frozen.
  const calls = { n: 0 };
  const second = await prepareEarningsForecast({ previous: first.state, chains, universe: symbols, sectors: {}, cikMap: new Map(), fetchImpl: offline, now: () => { calls.n++; return asOf; }, fred });
  ok(symbols.every((s) => JSON.stringify(second.state.lab.origins[s]) === JSON.stringify(first.state.lab.origins[s])), 'an unchanged company reuses its replay');
  eq(second.state.runs.length, first.state.runs.length, 'a second build freezes no new forecast');
  eq(second.state.lab.winner.since, first.state.lab.winner.since, 'the winner keeps its start date');
  // Switch off: the test still runs, the current rule is shown, and the forecast returns to its original key.
  const plain = await prepareEarningsForecast({ previous: state, chains, universe: symbols, sectors: {}, cikMap: new Map(), fetchImpl: offline, now: () => asOf, fred, historyTest: false });
  const off = await prepareEarningsForecast({ previous: state, chains, universe: symbols, sectors: {}, cikMap: new Map(), fetchImpl: offline, now: () => asOf, fred, promoteWinner: false });
  ok(off.payload.historyTest.verdict === 'winner-off' && off.payload.companies.every((c) => c.forecast.history === null && c.forecast.bands?.revenue), 'the winner switch off shows the current rule with ranges');
  eq(off.state.runs.map((r) => r.inputKey), plain.state.runs.map((r) => r.inputKey), 'with the switch off every forecast keeps the key it had before the history test existed');
  ok(plain.payload.historyTest === undefined && plain.state.lab === undefined, 'the test off adds nothing');
  // Disabled refresh still shows the last test.
  const disabled = await prepareEarningsForecast({ previous: first.state, chains, universe: symbols, sectors: {}, enabled: false, fetchImpl: offline, now: () => asOf });
  ok(disabled.payload.enabled === false && disabled.payload.historyTest?.verdict === 'promoted', 'a disabled refresh keeps the last test on the page');
  // A failing test keeps the last one, marked stale, and the forecasts still ship.
  const broken = structuredClone(first.state); broken.observations[symbols[0]] = [{ availableAt: 'x' }];
  const failed = await prepareEarningsForecast({ previous: broken, chains, universe: symbols, sectors: {}, cikMap: new Map(), fetchImpl: offline, now: () => asOf, fred: () => { throw Error('boom'); } });
  ok(failed.payload.historyTest.stale === true && failed.state.lab.error === 'boom' && failed.payload.companies.length === symbols.length, 'a failing test keeps the last one, marked stale');
}

// --- wider history window, switches and access ----------------------------------------------------------
{
  const row = (start, end, val) => ({ start, end, val, accn: 'a' + end, form: '10-Q', filed: end });
  const raw = { cik: 1, facts: { 'us-gaap': { Revenues: { units: { USD: [row('2014-01-01', '2014-03-31', 1), row('2015-01-01', '2015-03-31', 2), row('2016-01-01', '2016-03-31', 3), row('2025-01-01', '2025-03-31', 4)] } } } } };
  const n = normalizeCompanyFacts(raw, { symbol: 'TEST', firstSeenAt: '2026-11-16T12:00:00.000Z', rawHash: 'raw' });
  eq(n.observations.map((o) => o.end).sort(), ['2015-03-31', '2016-03-31', '2025-03-31'], 'facts from the last eleven fiscal years are kept, older ones are not');
  const setting = OWNER_SETTINGS.find((s) => s.key === 'EARNINGS_FORECAST_WINNER');
  ok(setting && setting.default === true && setting.kind === 'switch' && /Top Picks grader/.test(setting.help), 'the winner switch is an Owner Setting, on by default');
  ok(isPremiumKey('earnings-forecast.json') && isPremiumKey('earnings-forecast-state.json') && roleClaimForKey('earnings-forecast.json').length === 2, 'both forecast files stay Owner-only');
}

console.log(`earnings-forecast-lab smoke: ok (${checks} checks)`);
