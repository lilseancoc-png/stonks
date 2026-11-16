// Earnings Forecast history test (2026-11-16). Pure: no file, no network, no AI.
//
// Every stored quarter of every company on the list is forecast again from
// only what was public seven days before its results were filed, by a small
// fixed set of revenue rules, and scored against what was reported. The same
// replay gives the forecast its ranges: how far actual results have landed from
// a forecast like this one, tested on quarters the range never saw.
//
// What it decides: whether a rule beats the current one by enough to trust
// (LAB_MODELS candidates; the bar allows for the number of rules tried), and
// the 50% and 80% ranges shown beside the point forecast. What it never does:
// rewrite a frozen forecast or its forward record.
import { quarterlyFacts, forecastQuarter } from './earnings-forecast.mjs';
import { finite, mean, median, quantile, round, clamp, tStat, trialsAdjustedT } from './labs/stats.mjs';

export const LAB_VERSION = 1;
export const LAB_HORIZON_DAYS = 7;      // days before the filing each replayed forecast is made
export const LAB_MIN_ROWS = 100;        // company-quarters a verdict needs
export const LAB_MIN_QUARTERS = 12;     // calendar quarters a verdict needs
export const LAB_DRIVER_MIN = 80;       // earlier company-quarters the driver fit needs
export const LAB_PICK_MIN = 60;         // earlier company-quarters the walk-forward pick needs
export const LAB_BAND_MIN = 40;         // earlier company-quarters a range needs
export const LAB_HOLD_T = 1;            // a promoted rule stays while it still leads by this t value
const DAY = 86400000;
const BAND_QS = [0.1, 0.25, 0.75, 0.9];
const EPS_FLOOR = 0.1;                  // EPS misses are measured against at least 10 cents
const gap = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const iso = (ms) => new Date(ms).toISOString();
// The calendar quarter a fiscal quarter mostly falls in (a 52/53-week quarter
// can end a few days into the next month).
export const labQuarter = (end) => { const d = new Date(Date.parse(end) - 15 * DAY); return d.getUTCFullYear() + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1); };

export const LAB_MODELS = Object.freeze([
  { id: 'last', role: 'baseline', label: 'Last quarter again', hint: 'Revenue repeats the latest reported quarter.' },
  { id: 'seasonal', role: 'baseline', label: 'Same quarter last year', hint: 'Revenue repeats the same fiscal quarter a year earlier.' },
  { id: 'base', role: 'live', label: 'Current rule', hint: 'Same quarter last year, grown by the middle of the last four year-over-year growth rates.' },
  { id: 'latest', role: 'candidate', label: 'Latest growth', hint: 'Same quarter last year, grown by the newest year-over-year growth rate.' },
  { id: 'weighted', role: 'candidate', label: 'Recent growth weighted', hint: 'Same quarter last year, grown by the last four growth rates with the newest counting most (weights 4, 3, 2, 1).' },
  { id: 'trend', role: 'candidate', label: 'Growth trend', hint: 'The newest growth rate plus half of its change from the quarter before.' },
  { id: 'drivers', role: 'candidate', label: 'Current rule plus drivers', hint: 'The current rule, moved by how companies that already reported the same quarter did against their own forecast, by factory output and by the dollar. The sizes are refitted at every step from earlier quarters only.' },
  { id: 'picked', role: 'check', label: 'Pick the best so far', hint: 'At each step, uses whichever rule had the smallest average miss on quarters already reported. It shows what choosing a winner would have delivered.' },
]);
const CANDIDATES = LAB_MODELS.filter((m) => m.role === 'candidate').map((m) => m.id);
const PICK_FROM = ['base', ...CANDIDATES];
const labelOf = (id) => LAB_MODELS.find((m) => m.id === id)?.label || id;

function yearAgo(quarters, end) {
  for (let i = quarters.length - 1; i >= 0; i--) if (Math.abs(gap(quarters[i].end, end) - 365) <= 16) return quarters[i];
  return null;
}

// The growth rules, from the quarters known at a cutoff. The current rule
// itself always comes from forecastQuarter so the two can never drift apart.
export function growthRules(known, targetEnd) {
  const latest = known.at(-1), seasonal = yearAgo(known, targetEnd);
  if (!latest || !seasonal || !(seasonal.metrics.revenue.value > 0)) return null;
  const S = seasonal.metrics.revenue.value, growths = [];
  for (const q of known.slice(-4)) {
    const p = yearAgo(known, q.end);
    if (p && p.metrics.revenue.value > 0) growths.push(q.metrics.revenue.value / p.metrics.revenue.value - 1);
  }
  const out = { last: latest.metrics.revenue.value, seasonal: S, latest: null, weighted: null, trend: null, seasonalShares: seasonal.metrics.dilutedShares?.value ?? null, lastEps: latest.metrics.eps?.value ?? null, lastShares: latest.metrics.dilutedShares?.value ?? null };
  if (!growths.length) return out;
  const newest = growths.at(-1), before = growths.length > 1 ? growths.at(-2) : null;
  let w = 0, sum = 0;
  growths.forEach((g, i) => { w += i + 1; sum += (i + 1) * g; });
  const grow = (g) => S * (1 + clamp(g, -0.9, 3));
  out.latest = grow(newest);
  out.weighted = grow(sum / w);
  if (before != null) out.trend = grow(newest + 0.5 * (newest - before));
  return out;
}

// One company's replay: a row per reported quarter that has a year-ago quarter
// behind it. Reconstructed mode: facts are joined by filing date (next-day
// cutoff), not by when this site first saw them.
export function companyOrigins(symbol, observations, asOf, { horizonDays = LAB_HORIZON_DAYS } = {}) {
  const rows = [];
  let actuals = [];
  try { actuals = quarterlyFacts(observations, asOf, { mode: 'reconstructed', earliest: true }); } catch { return rows; }
  for (const actual of actuals) {
    const rev = actual.metrics.revenue;
    if (!(rev?.value > 0)) continue;
    const cutoffAt = iso(Date.parse(rev.availableAt) - horizonDays * DAY);
    let run = null;
    try { run = forecastQuarter({ symbol, observations, cutoffAt, mode: 'reconstructed', horizon: 'history' }); } catch { continue; }
    if (!run?.target || Math.abs(gap(run.target.end, actual.end)) > 10 || !finite(run.outputs?.revenue) || !(run.assumptions?.growthSample >= 1)) continue;
    if (rev.currency !== run.currency || rev.basis !== run.basis) continue;
    const known = quarterlyFacts(observations, cutoffAt, { mode: 'reconstructed' }).filter((q) => q.currency === run.currency && q.basis === run.basis);
    const rules = growthRules(known, run.target.end);
    if (!rules) continue;
    const row = { s: symbol, e: actual.end, q: labQuarter(actual.end), c: cutoffAt, a: rev.availableAt, A: rev.value,
      f: { last: rules.last, seasonal: rules.seasonal, base: run.outputs.revenue, latest: rules.latest, weighted: rules.weighted, trend: rules.trend } };
    const fact = actual.metrics.eps, shares = actual.metrics.dilutedShares?.value, assumed = run.assumptions.dilutedShares;
    const sameBasis = (other) => finite(shares) && finite(other) && shares / other <= 1.5 && shares / other >= 2 / 3;
    if (fact && finite(fact.value) && fact.currency === run.currency && fact.basis === run.basis && sameBasis(assumed)) {
      row.eps = { A: fact.value, base: finite(run.outputs.eps) ? run.outputs.eps : null,
        seasonal: finite(run.baseline?.eps) && sameBasis(rules.seasonalShares) ? run.baseline.eps : null,
        last: finite(rules.lastEps) && sameBasis(rules.lastShares) ? rules.lastEps : null };
    }
    rows.push(row);
  }
  return rows;
}

// A cheap cache key: observations are append-only, so the count that is public
// by `asOf` changes exactly when the replay can change.
export function originsKey(observations, asOf) {
  // Count, newest arrival and oldest period: a quarter added while an old one
  // leaves the window changes the key even when the count does not.
  let n = 0, newest = '', oldest = '';
  for (const o of observations || []) {
    if (!(o.availableAt <= asOf)) continue;
    n++;
    if (o.availableAt > newest) newest = o.availableAt;
    if (o.end && (!oldest || o.end < oldest)) oldest = o.end;
  }
  return [LAB_VERSION, LAB_HORIZON_DAYS, n, newest, oldest].join('|');
}

// --- monthly macro readings as they were known at a cutoff ----------------------------
const monthOf = (ms) => iso(ms).slice(0, 7);
function shiftMonth(key, n) { const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) - 1 + n; return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); }
function monthlyMeans(rows) {
  const sums = new Map();
  for (const r of rows || []) { const v = Number(r?.value); const d = String(r?.date || ''); if (!Number.isFinite(v) || d.length < 7) continue; const k = d.slice(0, 7), o = sums.get(k) || [0, 0]; o[0] += v; o[1]++; sums.set(k, o); }
  return new Map([...sums].map(([k, [s, n]]) => [k, s / n]));
}
const yoy = (map, key) => { const now = map.get(key), then = map.get(shiftMonth(key, -12)); return finite(now) && finite(then) && then > 0 ? now / then - 1 : null; };
// Factory output is published about six weeks after the month starts; the
// dollar's monthly average is complete a week after the month ends. Values are
// the revised ones (the first print is not kept), which flatters them slightly.
export function macroFeatures(macro, cutoffMs) {
  const ipKey = monthOf(cutoffMs - 50 * DAY), usdKey = monthOf(cutoffMs - 38 * DAY);
  const ipNow = yoy(macro.ip, ipKey), ipThen = yoy(macro.ip, shiftMonth(ipKey, -3));
  const usd = yoy(macro.usd, usdKey);
  return { ip: finite(ipNow) && finite(ipThen) ? ipNow - ipThen : 0, usd: finite(usd) ? usd : 0 };
}

// --- a tiny ridge regression from running sums --------------------------------------------
const K = 3; // peer, ip, usd
function newSums() { return { n: 0, x: Array(K).fill(0), xx: Array.from({ length: K }, () => Array(K).fill(0)), y: 0, xy: Array(K).fill(0) }; }
function addSums(s, x, y) { s.n++; s.y += y; for (let i = 0; i < K; i++) { s.x[i] += x[i]; s.xy[i] += x[i] * y; for (let j = 0; j < K; j++) s.xx[i][j] += x[i] * x[j]; } }
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / M[i][i]);
}
// Ridge on standardized inputs (strength 20 rows, fixed before any test). An
// input with no variation gets no weight.
export function fitDrivers(s, l2 = 20) {
  if (s.n < 3) return null;
  const m = s.x.map((v) => v / s.n), my = s.y / s.n;
  const sdv = m.map((mi, i) => Math.sqrt(Math.max(0, s.xx[i][i] / s.n - mi * mi)));
  const live = sdv.map((v) => v > 1e-9);
  const R = Array.from({ length: K }, (_, i) => Array.from({ length: K }, (_, j) => {
    if (!live[i] || !live[j]) return i === j ? 1 : 0;
    return (s.xx[i][j] / s.n - m[i] * m[j]) / (sdv[i] * sdv[j]) + (i === j ? l2 / s.n : 0);
  }));
  const r = m.map((mi, i) => (live[i] ? (s.xy[i] / s.n - mi * my) / sdv[i] : 0));
  const bs = solve(R, r);
  if (!bs) return null;
  const b = bs.map((v, i) => (live[i] ? v / sdv[i] : 0));
  return { a: my - b.reduce((t, v, i) => t + v * m[i], 0), b, std: bs.map((v, i) => (live[i] ? v : 0)), n: s.n };
}
const driverShift = (fit, x) => clamp(fit.a + fit.b.reduce((t, v, i) => t + v * x[i], 0), -0.15, 0.15);

// --- scoring -------------------------------------------------------------------------------------
const ape = (f, a) => (finite(f) && a > 0 ? Math.min(Math.abs(f - a) / a, 1) : null);
const epsMiss = (f, a) => (finite(f) && finite(a) ? Math.min(Math.abs(f - a) / Math.max(Math.abs(a), EPS_FLOOR), 1) : null);
function pairedByQuarter(rows, better) {
  // better(row) = the reference rule's miss minus this rule's (positive = this rule is closer).
  const byQ = new Map();
  let n = 0;
  for (const r of rows) { const d = better(r); if (!finite(d)) continue; n++; (byQ.get(r.q) || byQ.set(r.q, []).get(r.q)).push(d); }
  const keys = [...byQ.keys()].sort(), means = keys.map((k) => mean(byQ.get(k)));
  const half = Math.floor(means.length / 2);
  return { n, quarters: keys.length, diff: mean(means), t: tStat(means), firstHalf: mean(means.slice(0, half)), secondHalf: mean(means.slice(half)) };
}
function scoreRule(rows, id, miss, forecastOf, actualOf) {
  const xs = rows.map((r) => miss(forecastOf(r, id), actualOf(r))).filter(finite);
  const signed = rows.map((r) => { const f = forecastOf(r, id), a = actualOf(r); return finite(f) && finite(a) && a !== 0 ? (a - f) / Math.abs(a) : null; }).filter(finite);
  return { n: xs.length, typical: round(median(xs), 4), average: round(mean(xs), 4), bias: round(median(signed), 4) };
}

// Ranges: own history shrunk toward everyone's. `own` and `pool` hold signed
// relative misses (actual over forecast, minus one) that were public already.
// The cut points are placed for the NEXT result (position q x (n + 1) in the
// sorted misses), not for the sample itself: the middle half of eight past
// misses holds the next one well under half the time. A tail the company's own
// history is too short to place uses everyone's.
function nextQuantile(sorted, q) {
  const n = sorted.length, pos = q * (n + 1);
  if (pos < 1 || pos > n) return null;
  const lo = Math.floor(pos), hi = Math.min(n, lo + 1);
  return sorted[lo - 1] + (sorted[hi - 1] - sorted[lo - 1]) * (pos - lo);
}
export function bandQuantiles(own, pool) {
  if (pool.length < LAB_BAND_MIN) return null;
  const a = own.filter(finite).sort((x, y) => x - y), b = pool.filter(finite).sort((x, y) => x - y);
  const w = a.length / (a.length + 8);
  return BAND_QS.map((q) => { const mine = nextQuantile(a, q), all = nextQuantile(b, q); return all == null ? null : round(mine == null ? all : w * mine + (1 - w) * all, 4); });
}
const cover = (rows) => { const n = rows.length; return n ? { n, hit: round(rows.filter((r) => r[2] >= r[0] && r[2] <= r[1]).length / n, 3) } : { n: 0, hit: null }; };

function consensusEps(rows, events) {
  // Analyst EPS estimates as stored with each past print (adjusted EPS, taken
  // at the print) against our GAAP EPS forecast a week before the filing, each
  // measured on its own basis.
  const ours = [], theirs = [];
  for (const r of rows) {
    if (!r.eps || !finite(r.eps.base)) continue;
    const list = events?.[r.s];
    if (!Array.isArray(list)) continue;
    const endMs = Date.parse(r.e);
    const ev = list.filter((e) => e?.date && Date.parse(e.date) > endMs && Date.parse(e.date) <= endMs + 100 * DAY && finite(e.epsEstimate) && finite(e.epsActual)).sort((x, y) => String(x.date).localeCompare(String(y.date)))[0];
    if (!ev) continue;
    ours.push(epsMiss(r.eps.base, r.eps.A));
    theirs.push(epsMiss(ev.epsEstimate, ev.epsActual));
  }
  return { n: ours.length, ours: round(median(ours), 4), analysts: round(median(theirs), 4), oursAverage: round(mean(ours), 4), analystsAverage: round(mean(theirs), 4),
    note: 'Analyst estimates are for adjusted EPS and are the last ones before each report; ours is GAAP EPS, made a week before the filing. Each is measured against its own actual.' };
}

// Our frozen forward forecasts against the analyst estimate archived on or
// before the same day. Starts empty: free sources keep no past revenue estimates.
export function consensusForward(evaluations, archive) {
  const latest = new Map();
  for (const e of [...(evaluations || [])].sort((a, b) => a.cutoffAt.localeCompare(b.cutoffAt))) if (e.kind === 'live') latest.set(e.symbol + '|' + e.targetEnd + '|' + e.metric, e);
  const out = { revenue: { ours: [], analysts: [] }, eps: { ours: [], analysts: [] } };
  for (const e of latest.values()) {
    const key = e.metric === 'revenue' ? 'rev' : 'eps';
    const row = (archive?.[e.symbol] || []).filter((c) => finite(c[key]) && Math.abs(gap(c.end, e.targetEnd)) <= 16 && c.d <= e.cutoffAt.slice(0, 10)).sort((a, b) => a.d.localeCompare(b.d)).at(-1);
    if (!row || !finite(e.forecast) || !finite(e.actual)) continue;
    if (e.metric === 'revenue') { if (!(e.actual > 0) || row.rev / e.forecast > 2 || row.rev / e.forecast < 0.5) continue; out.revenue.ours.push(ape(e.forecast, e.actual)); out.revenue.analysts.push(ape(row.rev, e.actual)); }
    else { out.eps.ours.push(epsMiss(e.forecast, e.actual)); out.eps.analysts.push(epsMiss(row.eps, e.actual)); }
  }
  const pack = (o) => ({ n: o.ours.length, ours: round(mean(o.ours), 4), analysts: round(mean(o.analysts), 4) });
  let rows = 0, first = null;
  const companies = Object.entries(archive || {}).filter(([, list]) => Array.isArray(list) && list.length);
  for (const [, list] of companies) { rows += list.length; for (const c of list) if (!first || c.d < first) first = c.d; }
  return { revenue: pack(out.revenue), eps: pack(out.eps), archived: rows, companies: companies.length, since: first };
}

// Today's analyst estimates for the quarters ahead, kept one row per change so
// the forward record can later be compared with what analysts expected on the
// day each forecast was frozen. Reads fields the build already holds.
export function archiveConsensus(archive, symbol, fundamentals, day, keep = 240) {
  const rev = new Map(), eps = new Map();
  for (const r of fundamentals?.revenueForwardEstimates || []) if (r?.date && ['0q', '+1q'].includes(r.period) && finite(r.value) && r.value > 0) rev.set(r.date, r.value);
  for (const r of fundamentals?.epsForwardEstimates || []) if (r?.date && ['0q', '+1q'].includes(r.period) && finite(r.value)) eps.set(r.date, r.value);
  const list = Array.isArray(archive[symbol]) ? archive[symbol] : [];
  for (const end of new Set([...rev.keys(), ...eps.keys()])) {
    const row = { d: day, end, rev: rev.get(end) ?? null, eps: eps.get(end) ?? null };
    const prior = [...list].reverse().find((c) => c.end === end);
    if (prior && prior.rev === row.rev && prior.eps === row.eps) continue;
    if (prior && prior.d === day) Object.assign(prior, row); else list.push(row);
  }
  archive[symbol] = list.slice(-keep);
  return archive[symbol];
}

// The whole test. `origins` is { SYMBOL: rows from companyOrigins }; `fred(id)`
// returns [{ date, value }] or nothing; `earningsEvents` is { SYMBOL: prints }.
export function buildHistoryLab({ origins = {}, fred = null, earningsEvents = null, evaluations = [], consensus = {}, asOf, prior = null, promote = true } = {}) {
  const rows = Object.values(origins).flat().map((r) => ({ ...r, f: { ...r.f }, cMs: Date.parse(r.c), aMs: Date.parse(r.a), eMs: Date.parse(r.e) })).sort((x, y) => x.cMs - y.cMs || x.s.localeCompare(y.s));
  const macro = { ip: monthlyMeans(fred ? fred('INDPRO') : []), usd: monthlyMeans(fred ? fred('DTWEXBGS') : []) };
  const haveMacro = macro.ip.size > 24 || macro.usd.size > 24;

  // Peers that already reported the same quarter: the middle of their misses
  // against their own current-rule forecast, shrunk when few have reported.
  const peerOf = (symbol, eMs, cutoffMs) => {
    const xs = [];
    for (const o of rows) if (o.s !== symbol && o.aMs <= cutoffMs && Math.abs(o.eMs - eMs) <= 35 * DAY && o.f.base > 0) xs.push(clamp(o.A / o.f.base - 1, -0.5, 0.5));
    return xs.length ? median(xs) * xs.length / (xs.length + 3) : 0;
  };
  const featuresOf = (symbol, eMs, cutoffMs) => { const m = macroFeatures(macro, cutoffMs); return [peerOf(symbol, eMs, cutoffMs), m.ip, m.usd]; };

  // Walk forward in cutoff order; a row joins the training set only once its
  // result was public.
  const byAvail = [...rows].sort((x, y) => x.aMs - y.aMs);
  const sums = newSums(), pickSum = Object.fromEntries(PICK_FROM.map((id) => [id, [0, 0]]));
  let ptr = 0, fit = null;
  for (const r of rows) {
    while (ptr < byAvail.length && byAvail[ptr].aMs <= r.cMs) {
      const o = byAvail[ptr++];
      addSums(sums, o.x, clamp(o.A / o.f.base - 1, -0.5, 0.5));
      for (const id of PICK_FROM) { const m = ape(o.f[id], o.A); if (finite(m)) { pickSum[id][0] += m; pickSum[id][1]++; } }
      fit = null;
    }
    r.x = featuresOf(r.s, r.eMs, r.cMs);
    if (sums.n >= LAB_DRIVER_MIN) { fit ||= fitDrivers(sums); r.f.drivers = fit ? r.f.base * (1 + driverShift(fit, r.x)) : null; }
    else r.f.drivers = null;
    let best = 'base', bestMiss = Infinity;
    for (const id of PICK_FROM) if (pickSum[id][1] >= LAB_PICK_MIN && pickSum[id][0] / pickSum[id][1] < bestMiss) { bestMiss = pickSum[id][0] / pickSum[id][1]; best = id; }
    r.f.picked = pickSum.base[1] >= LAB_PICK_MIN ? (finite(r.f[best]) ? r.f[best] : r.f.base) : null;
    r.pick = pickSum.base[1] >= LAB_PICK_MIN ? best : null;
  }
  // The fit on everything public by `asOf` is the one used for today's forecast.
  const finalSums = newSums();
  const asOfMs = Date.parse(asOf);
  for (const o of rows) if (o.aMs <= asOfMs) addSums(finalSums, o.x, clamp(o.A / o.f.base - 1, -0.5, 0.5));
  const finalFit = finalSums.n >= LAB_DRIVER_MIN ? fitDrivers(finalSums) : null;

  // --- scores ---
  const trials = CANDIDATES.length, bar = trialsAdjustedT(trials);
  const rev = (r, id) => r.f[id], act = (r) => r.A;
  const seasonalMiss = (r) => ape(r.f.seasonal, r.A), baseMiss = (r) => ape(r.f.base, r.A);
  const models = LAB_MODELS.map((m) => {
    const s = scoreRule(rows, m.id, ape, rev, act);
    const mine = (r) => ape(r.f[m.id], r.A);
    const scored = rows.filter((r) => finite(mine(r)));
    const beats = scored.length ? scored.filter((r) => mine(r) < seasonalMiss(r)).length / scored.length : null;
    const out = { id: m.id, role: m.role, label: m.label, hint: m.hint, ...s, beatsSeasonal: round(beats, 3) };
    if (m.id !== 'base') {
      const v = pairedByQuarter(rows, (r) => (finite(mine(r)) ? baseMiss(r) - mine(r) : null));
      const pass = m.role === 'candidate' && v.n >= LAB_MIN_ROWS && v.quarters >= LAB_MIN_QUARTERS && v.diff > 0 && v.t >= bar && v.firstHalf > 0 && v.secondHalf > 0;
      out.vsCurrent = { n: v.n, quarters: v.quarters, diff: round(v.diff, 4), t: round(v.t, 2), firstHalf: round(v.firstHalf, 4), secondHalf: round(v.secondHalf, 4), pass };
    }
    return out;
  });
  const byId = Object.fromEntries(models.map((m) => [m.id, m]));
  const passing = models.filter((m) => m.vsCurrent?.pass).sort((a, b) => b.vsCurrent.diff - a.vsCurrent.diff);
  const held = prior?.winner?.id && byId[prior.winner.id]?.role === 'candidate' && byId[prior.winner.id].vsCurrent.diff > 0 && byId[prior.winner.id].vsCurrent.t >= LAB_HOLD_T ? byId[prior.winner.id] : null;
  const chosen = held || passing[0] || null;
  const winner = chosen ? { id: chosen.id, label: chosen.label, since: held ? prior.winner.since : asOf, held: !!held && !chosen.vsCurrent.pass } : null;
  const inUse = winner && promote ? winner.id : 'base';

  // --- ranges, walked forward on the rule in use ---
  const relOf = (r) => (r.f[inUse] > 0 ? clamp(r.A / r.f[inUse] - 1, -1, 1) : (r.f.base > 0 ? clamp(r.A / r.f.base - 1, -1, 1) : null));
  const epsRel = (r) => (r.eps && finite(r.eps.base) ? clamp((r.eps.A - r.eps.base) / Math.max(Math.abs(r.eps.base), EPS_FLOOR), -2, 2) : null);
  const walkBands = (relFn) => {
    const pool = [], own = new Map(), r50 = [], r80 = [];
    let p = 0;
    for (const r of rows) {
      while (p < byAvail.length && byAvail[p].aMs <= r.cMs) { const o = byAvail[p++], v = relFn(o); if (finite(v)) { pool.push(v); (own.get(o.s) || own.set(o.s, []).get(o.s)).push(v); } }
      const v = relFn(r), q = finite(v) ? bandQuantiles(own.get(r.s) || [], pool) : null;
      if (!q) continue;
      r50.push([q[1], q[2], round(v, 4)]); r80.push([q[0], q[3], round(v, 4)]);
    }
    const now = {}, all = [], mine = new Map();
    for (const o of rows) { if (o.aMs > asOfMs) continue; const v = relFn(o); if (finite(v)) { all.push(v); (mine.get(o.s) || mine.set(o.s, []).get(o.s)).push(v); } }
    for (const s of Object.keys(origins)) { const q = bandQuantiles(mine.get(s) || [], all); if (q) now[s] = { q, own: (mine.get(s) || []).length }; }
    return { r50, r80, now, pool: all.length };
  };
  const revBands = walkBands(relOf), epsBands = walkBands(epsRel);

  // --- EPS ---
  const epsRows = rows.filter((r) => r.eps);
  const epsModels = [['last', 'Last quarter again'], ['seasonal', 'Same quarter last year'], ['base', 'Current rule (margin, tax and share bridge)']].map(([id, label]) => {
    const s = scoreRule(epsRows, id, epsMiss, (r, k) => r.eps[k], (r) => r.eps.A);
    const out = { id, label, ...s };
    if (id !== 'base') { const v = pairedByQuarter(epsRows, (r) => { const a = epsMiss(r.eps[id], r.eps.A), b = epsMiss(r.eps.base, r.eps.A); return finite(a) && finite(b) ? a - b : null; }); out.currentBeatsBy = { n: v.n, diff: round(v.diff, 4), t: round(v.t, 2) }; }
    return out;
  });

  // --- per company ---
  const byCompany = {};
  for (const s of Object.keys(origins)) {
    const mine = rows.filter((r) => r.s === s);
    if (!mine.length) { byCompany[s] = { n: 0 }; continue; }
    const typical = (id) => round(median(mine.map((r) => ape(r.f[id], r.A)).filter(finite)), 4);
    const scored = PICK_FROM.map((id) => [id, mean(mine.map((r) => ape(r.f[id], r.A)).filter(finite))]).filter(([, v]) => finite(v)).sort((a, b) => a[1] - b[1]);
    byCompany[s] = { n: mine.length, from: mine[0].e, to: mine.at(-1).e, current: typical('base'), seasonal: typical('seasonal'), inUse: typical(inUse), closest: scored[0]?.[0] || null, epsN: mine.filter((r) => r.eps && finite(r.eps.base)).length };
  }

  const quarters = new Set(rows.map((r) => r.q));
  const enough = rows.length >= LAB_MIN_ROWS && quarters.size >= LAB_MIN_QUARTERS;
  const pctText = (v) => (finite(v) ? (v * 100).toFixed(1) + '%' : 'n/a');
  const closest = models.filter((m) => m.role === 'candidate' && finite(m.vsCurrent?.diff)).sort((a, b) => b.vsCurrent.diff - a.vsCurrent.diff)[0];
  let verdict, read;
  if (!enough) { verdict = 'collecting'; read = `Collecting: ${rows.length} company-quarters over ${quarters.size} quarters so far. A verdict needs ${LAB_MIN_ROWS} over ${LAB_MIN_QUARTERS}.`; }
  else if (winner) {
    verdict = promote ? 'promoted' : 'winner-off';
    read = `${winner.label} beat the current rule: a typical miss of ${pctText(byId[winner.id].typical)} against ${pctText(byId.base.typical)}, ahead in both halves of the history (t ${byId[winner.id].vsCurrent.t}; ${round(bar, 2)} needed after ${trials} rules were tried). ` + (promote ? 'It is the forecast shown.' : 'The switch is off, so the current rule stays.') + (winner.held ? ' It no longer clears the full bar but still leads, so it stays.' : '');
  } else {
    verdict = 'current-stands';
    read = `No rule beat the current one by enough to trust, so it stays. Its typical miss is ${pctText(byId.base.typical)}; repeating the same quarter last year misses by ${pctText(byId.seasonal.typical)}.` + (closest ? ` Closest: ${closest.label} (t ${closest.vsCurrent.t}; ${round(bar, 2)} needed).` : '');
  }
  const DRIVER_LABELS = ['Companies that already reported', 'Factory output speeding up', 'A stronger dollar'];
  const summary = {
    version: LAB_VERSION, asOf, horizonDays: LAB_HORIZON_DAYS, rows: rows.length, companies: Object.values(byCompany).filter((c) => c.n).length, quarters: quarters.size,
    from: rows.length ? rows.map((r) => r.e).sort()[0] : null, to: rows.length ? rows.map((r) => r.e).sort().at(-1) : null,
    trials, tBar: round(bar, 2), verdict, read, winner, inUse, inUseLabel: labelOf(inUse), promote: !!promote,
    models,
    drivers: { fitted: !!finalFit, rows: finalSums.n, macro: haveMacro, inputs: DRIVER_LABELS.map((label, i) => ({ label, weight: finalFit ? round(finalFit.std[i], 3) : null })),
      note: 'Weights are per one standard move of each input, as a share of revenue. Factory output and the dollar are the revised series, not the first print.' },
    ranges: {
      rule: inUse, minRows: LAB_BAND_MIN,
      revenue: { p50: { claimed: 0.5, ...cover(revBands.r50) }, p80: { claimed: 0.8, ...cover(revBands.r80) } },
      eps: { p50: { claimed: 0.5, ...cover(epsBands.r50) }, p80: { claimed: 0.8, ...cover(epsBands.r80) } },
      note: 'Each range is built only from results that were already public, from the company\'s own past misses shrunk toward every company\'s. The share shown is how often the result then landed inside.',
    },
    eps: { rows: epsRows.filter((r) => finite(r.eps.base)).length, models: epsModels, analysts: consensusEps(rows, earningsEvents) },
    consensus: consensusForward(evaluations, consensus),
    byCompany,
    limits: [
      'Facts are joined by filing date with a next-day cutoff. The date each number first reached this site is not reconstructed, and an earnings press release can come out before the filing.',
      'Each forecast is made seven days before the filing that carried the result, not on a date known in advance.',
      'The companies are the ones on the list today plus recent leavers, so companies that shrank out of the top of the market long ago are missing.',
      'A miss is the gap between forecast and reported revenue as a share of reported revenue, capped at 100%.',
    ],
  };
  const bands = {};
  for (const s of Object.keys(origins)) {
    const r = revBands.now[s], e = epsBands.now[s];
    if (r || e) bands[s] = { revenue: r ? { q: r.q, own: r.own, pool: revBands.pool } : null, eps: e ? { q: e.q, own: e.own, pool: epsBands.pool } : null };
  }
  const calibration = { rule: inUse, revenue50: revBands.r50, revenue80: revBands.r80, eps50: epsBands.r50, eps80: epsBands.r80 };

  // Today's revenue from the promoted rule, for forecastQuarter's `historyModel`.
  const liveRevenue = ({ symbol, known, targetEnd, baseRevenue, cutoffAt }) => {
    if (!winner || !promote || !(baseRevenue > 0)) return null;
    let revenue = null;
    if (winner.id === 'drivers') {
      if (!finalFit) return null;
      const cutoffMs = Date.parse(cutoffAt), x = featuresOf(symbol, Date.parse(targetEnd), cutoffMs);
      // Quantized so a frozen forecast only changes when an input really moves.
      revenue = baseRevenue * (1 + Math.round(driverShift(finalFit, x) * 1000) / 1000);
    } else revenue = growthRules(known, targetEnd)?.[winner.id] ?? null;
    if (!finite(revenue) || !(revenue > 0) || revenue / baseRevenue > 2 || revenue / baseRevenue < 0.5) return null;
    return { id: winner.id, label: winner.label, revenue, labVersion: LAB_VERSION, since: winner.since };
  };
  return { summary, bands, calibration, winner, liveRevenue };
}

// Range sources for the Calibration Lab (lib/labs/calibration.mjs), from the
// rows kept in the forecast state.
export function forecastCalibrationSources(lab) {
  const cal = lab?.calibration;
  if (!cal) return [];
  const rows = (list) => (Array.isArray(list) ? list.filter((r) => Array.isArray(r) && r.length === 3).map(([lo, hi, actual]) => ({ lo, hi, actual })) : []);
  const src = (id, label, claimed, list, what) => ({ id, kind: 'range', claimed, label, where: 'Earnings Forecast', event: `Reported ${what} landed inside the ${Math.round(claimed * 100)}% range`, rows: rows(list),
    note: 'History test: each range was built only from results already public at the time. Live forecasts join as their quarters are reported.' });
  return [
    src('earnings-forecast-revenue-50', 'Earnings Forecast: revenue, 50% range', 0.5, cal.revenue50, 'revenue'),
    src('earnings-forecast-revenue-80', 'Earnings Forecast: revenue, 80% range', 0.8, cal.revenue80, 'revenue'),
    src('earnings-forecast-eps-50', 'Earnings Forecast: EPS, 50% range', 0.5, cal.eps50, 'EPS'),
    src('earnings-forecast-eps-80', 'Earnings Forecast: EPS, 80% range', 0.8, cal.eps80, 'EPS'),
  ];
}

// The ranges for one frozen forecast, in money. Null when the history is too thin.
export function forecastBands(bands, symbol, outputs) {
  const b = bands?.[symbol];
  if (!b) return null;
  const out = {};
  if (b.revenue && outputs?.revenue > 0) { const [a, c, d, e] = b.revenue.q, f = outputs.revenue; out.revenue = { p80: [f * (1 + a), f * (1 + e)], p50: [f * (1 + c), f * (1 + d)], own: b.revenue.own, pool: b.revenue.pool }; }
  if (b.eps && finite(outputs?.eps)) { const [a, c, d, e] = b.eps.q, f = outputs.eps, s = Math.max(Math.abs(f), EPS_FLOOR); out.eps = { p80: [f + a * s, f + e * s], p50: [f + c * s, f + d * s], own: b.eps.own, pool: b.eps.pool }; }
  return out.revenue || out.eps ? out : null;
}
