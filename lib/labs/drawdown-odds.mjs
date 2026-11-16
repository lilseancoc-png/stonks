// Drawdown and recovery odds for the S&P 500 (Owner-only, no AI, no fetch).
//
// Turns the staged reads on the Bottom tracker and Booms & busts into stated
// chances of events fixed in advance:
//   fall10 / fall20  the index closes 10% / 20% below today's close at some
//                    point in the next 3, 6 or 12 months
//   lowIn            (only while 10%+ below the high) the lowest close of this
//                    decline is not undercut in the next 6 months
//   newHigh          (same) the index closes back above its old high within
//                    12 months
// One small logistic model per event. Every input has its direction fixed
// before the fit (a wider credit spread may only raise the chance of a fall),
// so the fit can size an input but never flip it. The model is judged only on
// eras it never saw: history is cut into eras, one per 10%+ decline, each era
// is predicted by a model fitted on the others (with a gap of the event's
// horizon on both sides so overlapping windows cannot leak), and the stated
// chances are scored against a no-skill forecast that always states the
// historical rate.
//
// Inputs come from data the bake already holds (the shared long-history
// cache): S&P 500 closes since 1950 and nine FRED series. Monthly series are
// read with a publication delay; they are the revised values, not the first
// print, which flatters the unemployment and production inputs slightly.

import {
  finite, round, clamp, mean, sd, quantile, mulberry32, percentileOf,
  fitLogistic, predictLogistic, standardizer, fitPlatt, applyPlatt,
  brier, brierSkill, auc, reliability, calibrationError,
} from "./stats.mjs";

export const DRAWDOWN_ODDS_VERSION = "drawdown-odds-1";

const DAY = 86400000;
const dayKey = (t) => {
  if (typeof t === "string") return t.slice(0, 10);
  if (finite(t)) return new Date(t < 1e11 ? t * 1000 : t).toISOString().slice(0, 10);
  return null;
};
const addDays = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

// Each input: how it is read, the direction it may push a FALL (+1 raises the
// chance, -1 lowers it), and the plain name shown on the page.
export const DD_FEATURES = [
  { key: "curve", label: "10-year yield minus the Fed rate", unit: "pts", fall: -1 },
  { key: "fedChg", label: "Fed rate change over a year", unit: "pts", fall: 1 },
  { key: "credit", label: "Baa credit spread", unit: "pts", fall: 1 },
  { key: "creditChg", label: "Credit spread change over 3 months", unit: "pts", fall: 1 },
  { key: "vol", label: "S&P 500 swings over 3 months (yearly rate)", unit: "%", fall: 1 },
  { key: "sahm", label: "Rise in unemployment from its 12-month low", unit: "pts", fall: 1 },
  { key: "trend", label: "S&P 500 vs its 200-day average", unit: "%", fall: -1 },
  { key: "offHigh", label: "S&P 500 below its 1-year high", unit: "%", fall: 1 },
  { key: "growth", label: "Factory output change over 6 months", unit: "%", fall: -1 },
  { key: "inflation", label: "Consumer prices, change over a year", unit: "%", fall: 1 },
  { key: "runUp", label: "S&P 500 gain over 5 years", unit: "%", fall: 1 },
];
// Inputs for the recovery events (read only inside a 10%+ decline). `sign` is
// the direction for "the low is in" and "back to the high": 0 = left free.
export const REC_FEATURES = [
  { key: "depth", label: "Decline from the high", unit: "%", sign: 0 },
  { key: "offLow", label: "Bounce off the low of this decline", unit: "%", sign: 1 },
  { key: "sinceLow", label: "Sessions since the low", unit: "", sign: 1 },
  { key: "creditChg", label: "Credit spread change over 3 months", unit: "pts", sign: -1 },
  { key: "volTurn", label: "Swings over 1 month vs 3 months", unit: "x", sign: -1 },
  { key: "trend50", label: "S&P 500 vs its 50-day average", unit: "%", sign: 1 },
  { key: "curve", label: "10-year yield minus the Fed rate", unit: "pts", sign: 0 },
  { key: "sahm", label: "Rise in unemployment from its 12-month low", unit: "pts", sign: 0 },
];

export const DD_TARGETS = [
  { id: "fall10_3m", kind: "fall", drop: 0.10, horizon: 63, label: "10%+ fall within 3 months" },
  { id: "fall10_6m", kind: "fall", drop: 0.10, horizon: 126, label: "10%+ fall within 6 months", headline: true },
  { id: "fall10_12m", kind: "fall", drop: 0.10, horizon: 252, label: "10%+ fall within 12 months" },
  { id: "fall20_6m", kind: "fall", drop: 0.20, horizon: 126, label: "20%+ fall within 6 months" },
  { id: "fall20_12m", kind: "fall", drop: 0.20, horizon: 252, label: "20%+ fall within 12 months" },
  { id: "lowIn_6m", kind: "lowIn", horizon: 126, label: "The low of this decline holds for 6 months" },
  { id: "newHigh_12m", kind: "newHigh", horizon: 252, label: "Back above the old high within 12 months" },
];

export const DD_DEFAULTS = {
  start: "1962-01-01",   // daily 10-year yields start here
  l2: 20,                // ridge strength, fixed before any test (see registry)
  minEras: 8,
  minEvents: 12,
  draws: 120,            // refits for the range around today's chance
  decline: 0.10,         // a "decline" for the recovery events and the eras
  workingSkill: 0.05,    // Brier skill a model needs to count as working
};

// --- series helpers ------------------------------------------------------------------

// Sorted { t: "YYYY-MM-DD", v } rows with a "last value on or before" lookup.
function series(rows) {
  const out = [];
  for (const r of rows || []) {
    const t = dayKey(r.t ?? r.date), v = Number(r.v ?? r.value);
    if (t && Number.isFinite(v)) out.push({ t, v });
  }
  out.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const ts = out.map((r) => r.t);
  const idxAt = (key) => {
    let lo = 0, hi = ts.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (ts[mid] <= key) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  };
  return {
    rows: out,
    first: out.length ? out[0].t : null,
    last: out.length ? out[out.length - 1].t : null,
    idxAt,
    // Newest value dated on or before `key`, no older than `maxAge` days.
    at(key, maxAge = 45) {
      const i = idxAt(key);
      if (i < 0) return null;
      if (maxAge && Date.parse(key) - Date.parse(out[i].t) > maxAge * DAY) return null;
      return out[i].v;
    },
  };
}

// --- features ---------------------------------------------------------------------------

// One row of inputs per sample date. `bars` are confirmed S&P 500 daily closes
// ({ t, c }, oldest first); `fred(id)` returns that series' rows. Sample dates
// are each month's last session plus the newest session.
export function buildDrawdownFrame({ bars, fred, opts = {} } = {}) {
  const o = { ...DD_DEFAULTS, ...opts };
  const px = [];
  for (const b of bars || []) {
    const t = dayKey(b.t), c = Number(b.c);
    if (t && Number.isFinite(c) && c > 0 && (!px.length || t > px[px.length - 1].t)) px.push({ t, c });
  }
  const n = px.length;
  if (n < 1500) return null;
  const close = px.map((b) => b.c);
  const ret = close.map((c, i) => (i ? Math.log(c / close[i - 1]) : 0));
  const get = (id) => series(typeof fred === "function" ? fred(id) : fred?.[id]);
  const S = { dff: get("DFF"), dgs10: get("DGS10"), baa: get("BAA10Y"), unrate: get("UNRATE"), indpro: get("INDPRO"), cpi: get("CPIAUCSL") };

  // Running sums for moving averages and realized swings.
  const cum = [0], cum2 = [0];
  for (let i = 0; i < n; i++) { cum.push(cum[i] + close[i]); cum2.push(cum2[i] + ret[i] * ret[i]); }
  const sma = (i, w) => (i + 1 >= w ? (cum[i + 1] - cum[i + 1 - w]) / w : null);
  const rvol = (i, w) => (i >= w ? Math.sqrt(((cum2[i + 1] - cum2[i + 1 - w]) / w) * 252) : null);
  // Rolling 1-year high, the all-time high so far, and the state of the
  // current decline from that high (its low and when it was set).
  const hi252 = new Array(n), peak = new Array(n), peakIdx = new Array(n), low = new Array(n), lowIdx = new Array(n);
  for (let i = 0, p = -Infinity, pi = 0, l = Infinity, li = 0; i < n; i++) {
    if (close[i] >= p) { p = close[i]; pi = i; l = close[i]; li = i; }
    if (close[i] < l) { l = close[i]; li = i; }
    peak[i] = p; peakIdx[i] = pi; low[i] = l; lowIdx[i] = li;
    let h = -Infinity;
    for (let j = Math.max(0, i - 251); j <= i; j++) if (close[j] > h) h = close[j];
    hi252[i] = h;
  }
  // Monthly series become known about seven weeks after the month they describe.
  const monthly = (s, key, back = 0) => {
    const i = s.idxAt(addDays(key, -50));
    return i - back >= 0 ? s.rows[i - back].v : null;
  };
  const sahmAt = (key) => {
    const i = S.unrate.idxAt(addDays(key, -50));
    if (i < 14) return null;
    const avg3 = (j) => (S.unrate.rows[j].v + S.unrate.rows[j - 1].v + S.unrate.rows[j - 2].v) / 3;
    let lowest = Infinity;
    for (let j = i - 12; j < i; j++) lowest = Math.min(lowest, avg3(j));
    return avg3(i) - lowest;
  };

  const rowAt = (i) => {
    const t = px[i].t;
    const dff = S.dff.at(t, 10), y10 = S.dgs10.at(t, 10), baa = S.baa.at(t, 10);
    const dffAgo = S.dff.at(addDays(t, -365), 10), baaAgo = S.baa.at(addDays(t, -91), 10);
    const ind = monthly(S.indpro, t), indAgo = monthly(S.indpro, t, 6);
    const cpi = monthly(S.cpi, t), cpiAgo = monthly(S.cpi, t, 12);
    const s200 = sma(i, 200), s50 = sma(i, 50), v63 = rvol(i, 63), v21 = rvol(i, 21);
    const x = {
      curve: finite(y10) && finite(dff) ? y10 - dff : null,
      fedChg: finite(dff) && finite(dffAgo) ? dff - dffAgo : null,
      credit: baa,
      creditChg: finite(baa) && finite(baaAgo) ? baa - baaAgo : null,
      vol: finite(v63) ? v63 * 100 : null,
      sahm: sahmAt(t),
      trend: finite(s200) ? (close[i] / s200 - 1) * 100 : null,
      offHigh: (1 - close[i] / hi252[i]) * 100,
      growth: finite(ind) && finite(indAgo) && indAgo > 0 ? Math.log(ind / indAgo) * 100 : null,
      inflation: finite(cpi) && finite(cpiAgo) && cpiAgo > 0 ? (cpi / cpiAgo - 1) * 100 : null,
      runUp: i >= 1260 ? (close[i] / close[i - 1260] - 1) * 100 : null,
      depth: (1 - close[i] / peak[i]) * 100,
      offLow: (close[i] / low[i] - 1) * 100,
      sinceLow: i - lowIdx[i],
      volTurn: finite(v21) && finite(v63) && v63 > 0 ? v21 / v63 : null,
      trend50: finite(s50) ? (close[i] / s50 - 1) * 100 : null,
    };
    for (const e of o.extra || []) x[e.key] = e.at(t);
    return { i, t, x, inDecline: close[i] <= peak[i] * (1 - o.decline) };
  };
  // Falls are sampled at each month's last session. The recovery events are
  // rarer (they only exist inside a decline), so they are sampled weekly.
  const rows = [], recRows = [];
  for (let i = 1300; i < n; i++) {
    if (px[i].t < o.start) continue;
    const lastOfMonth = i === n - 1 || px[i + 1].t.slice(0, 7) !== px[i].t.slice(0, 7);
    if (lastOfMonth) rows.push(rowAt(i));
    if ((n - 1 - i) % 5 === 0 && close[i] <= peak[i] * (1 - o.decline)) recRows.push(rowAt(i));
  }
  // The newest session is always scored, even mid-month.
  const lastRow = n > 1300 ? rowAt(n - 1) : null;
  return { px, close, n, rows, recRows, peak, peakIdx, low, lowIdx, today: lastRow, rowAt, opts: o };
}

// Whether a target is a live question on a date. Falls always are. The
// recovery events need a 10%+ decline, and "the low holds" also needs the low
// to be recent: once it has stood for the whole horizon the answer is known.
export function appliesTo(row, target) {
  if (target.kind === "fall") return true;
  if (!row.inDecline) return false;
  if (target.kind === "lowIn") return row.x.sinceLow <= target.horizon;
  return true;
}

// The outcome of one target for a sample row: 1, 0, or null when the window
// has not finished (or the target does not apply on that date).
export function labelFor(frame, row, target) {
  const { close, n, peak, low } = frame;
  const i = row.i, end = i + target.horizon;
  if (!appliesTo(row, target)) return null;
  let min = Infinity, max = -Infinity;
  for (let j = i + 1; j <= Math.min(end, n - 1); j++) { if (close[j] < min) min = close[j]; if (close[j] > max) max = close[j]; }
  const done = end <= n - 1;
  if (target.kind === "fall") {
    if (min <= close[i] * (1 - target.drop)) return 1;      // already happened: known early
    return done ? 0 : null;
  }
  if (target.kind === "lowIn") {
    if (min < low[i]) return 0;
    return done ? 1 : null;
  }
  if (target.kind === "newHigh") {
    if (max >= peak[i]) return 1;
    return done ? 0 : null;
  }
  return null;
}

// Eras for the test: one per decline of `decline` or more from the all-time
// high. An era runs from halfway between the last decline's recovery and this
// decline's high, to halfway between this recovery and the next high.
export function declineEras(frame) {
  const { close, n, px, opts } = frame;
  const eps = [];
  let p = close[0], pi = 0, inDd = false, cur = null;
  for (let i = 1; i < n; i++) {
    if (close[i] >= p) {
      if (inDd && cur) { cur.recover = i; eps.push(cur); cur = null; inDd = false; }
      p = close[i]; pi = i;
    } else if (!inDd && close[i] <= p * (1 - opts.decline)) {
      inDd = true; cur = { peak: pi, trough: i, recover: null };
    }
    if (inDd && cur && close[i] < close[cur.trough]) cur.trough = i;
  }
  if (inDd && cur) eps.push(cur);
  const eras = eps.map((e, k) => {
    const prev = eps[k - 1], next = eps[k + 1];
    const from = prev ? Math.floor(((prev.recover ?? prev.trough) + e.peak) / 2) + 1 : 0;
    const to = next ? Math.floor(((e.recover ?? n - 1) + next.peak) / 2) : n - 1;
    return {
      id: k, from, to, name: px[e.peak].t.slice(0, 4) === px[e.trough].t.slice(0, 4) ? px[e.peak].t.slice(0, 4) : `${px[e.peak].t.slice(0, 4)}-${px[e.trough].t.slice(2, 4)}`,
      peak: px[e.peak].t, trough: px[e.trough].t, recover: e.recover != null ? px[e.recover].t : null,
      depth: round((1 - close[e.trough] / close[e.peak]) * 100, 1),
    };
  });
  return eras;
}

// --- the fit ----------------------------------------------------------------------------------

// `extra` (research only): candidate inputs tried on top of the fixed list,
// each { key, label, fall, at(date) }.
const featsOf = (target, o = null) => (target.kind === "fall" ? [...DD_FEATURES, ...((o && o.extra) || [])] : REC_FEATURES);
const signsOf = (target, o = null) => featsOf(target, o).map((f) => {
  if (target.kind === "fall") return f.fall;
  return f.sign;                                  // lowIn and newHigh share directions
});
const vec = (row, feats) => feats.map((f) => (finite(row.x[f.key]) ? row.x[f.key] : null));

function fitOne(train, target, o, init = null) {
  const feats = featsOf(target, o);
  const Xraw = train.map((r) => vec(r.row, feats));
  const st = standardizer(Xraw);
  const model = fitLogistic(Xraw.map(st.apply), train.map((r) => r.y), { l2: o.l2, signs: signsOf(target, o), init });
  return { st: { mu: st.mu, sg: st.sg }, w: model.w, b: model.b, apply: st.apply };
}
const scoreWith = (m, row, feats) => predictLogistic(m, m.apply(vec(row, feats)));

// Fit, test and score one target. Returns the page block plus the stored model.
export function fitTarget(frame, eras, target, opts = {}) {
  const o = { ...frame.opts, ...opts };
  const feats = featsOf(target, o);
  const labeled = [];
  for (const row of target.kind === "fall" ? frame.rows : frame.recRows) {
    const y = labelFor(frame, row, target);
    if (y == null) continue;
    const era = eras.find((e) => row.i >= e.from && row.i <= e.to);
    labeled.push({ row, y, era: era ? era.id : -1 });
  }
  const events = labeled.reduce((s, r) => s + r.y, 0);
  const eraIds = [...new Set(labeled.map((r) => r.era))];
  const base = labeled.length ? events / labeled.length : null;
  const out = {
    id: target.id, label: target.label, kind: target.kind, horizon: target.horizon, headline: !!target.headline,
    n: labeled.length, events, base: round(base, 4), eras: eraIds.length,
  };
  if (labeled.length < 60 || events < o.minEvents || labeled.length - events < o.minEvents || eraIds.length < o.minEras) {
    return { block: { ...out, status: "thin", note: "Too little history to fit this one." }, model: null };
  }
  // Leave one era out, with a gap of the horizon on both sides of the era.
  const oof = [];
  for (const id of eraIds) {
    const era = eras.find((e) => e.id === id);
    const test = labeled.filter((r) => r.era === id);
    const train = labeled.filter((r) => r.era !== id && (!era || r.row.i < era.from - target.horizon || r.row.i > era.to + target.horizon));
    const pos = train.reduce((s, r) => s + r.y, 0);
    if (train.length < 40 || !pos || pos === train.length) continue;
    const m = fitOne(train, target, o);
    const rate = pos / train.length;
    for (const r of test) oof.push({ era: id, y: r.y, p: scoreWith(m, r.row, feats), base: rate, t: r.row.t });
  }
  const P = oof.map((r) => r.p), Y = oof.map((r) => r.y), B = oof.map((r) => r.base);
  const skill = brierSkill(P, Y, B);
  // Cross-fitted recalibration: each era's chances are adjusted by a curve
  // fitted on the other eras' out-of-sample chances. Kept only if it scores
  // better than the raw chances.
  const plattFor = new Map();
  for (const id of eraIds) {
    const others = oof.filter((q) => q.era !== id);
    plattFor.set(id, fitPlatt(others.map((q) => q.p), others.map((q) => q.y)));
  }
  const cal = oof.map((r) => (plattFor.get(r.era) ? applyPlatt(plattFor.get(r.era), r.p) : r.p));
  const calSkill = brierSkill(cal, Y, B);
  const useCal = finite(calSkill) && finite(skill) && calSkill > skill + 0.005;
  const finalP = useCal ? cal : P;
  const byEra = eraIds.map((id) => oof.map((r, k) => ({ ...r, p: finalP[k] })).filter((r) => r.era === id)).filter((g) => g.length);
  // Range of the skill score over resampled eras.
  const rnd = mulberry32(7 + target.horizon);
  const skills = [];
  for (let d = 0; d < 400; d++) {
    const rows = [];
    for (let k = 0; k < byEra.length; k++) for (const r of byEra[Math.floor(rnd() * byEra.length)]) rows.push(r);
    const s = brierSkill(rows.map((r) => r.p), rows.map((r) => r.y), rows.map((r) => r.base));
    if (finite(s)) skills.push(s);
  }
  // The model the page uses: fitted on every finished window.
  const full = fitOne(labeled, target, o);
  const platt = useCal ? fitPlatt(P, Y) : null;
  const eraSkill = byEra.map((g) => {
    const e = eras.find((x) => x.id === g[0].era);
    return {
      era: e ? e.name : "other", n: g.length, events: g.reduce((s, r) => s + r.y, 0),
      meanP: round(mean(g.map((r) => r.p)), 3), brier: round(brier(g.map((r) => r.p), g.map((r) => r.y)), 4),
      baseBrier: round(brier(g.map((r) => r.base), g.map((r) => r.y)), 4),
    };
  });
  const finalSkill = useCal ? calSkill : skill;
  const block = {
    ...out,
    status: finite(finalSkill) && finalSkill >= o.workingSkill && skills.length && quantile(skills, 0.1) > 0 ? "working"
      : finite(finalSkill) && finalSkill > 0 ? "weak" : "no-skill",
    skill: round(finalSkill, 3),
    skillRange: skills.length >= 200 ? [round(quantile(skills, 0.1), 3), round(quantile(skills, 0.9), 3)] : null,
    brier: round(brier(finalP, Y), 4), baseBrier: round(brier(B, Y), 4),
    auc: round(auc(finalP, Y), 3), ece: round(calibrationError(finalP, Y, 8), 3),
    tested: oof.length, recalibrated: useCal,
    bins: reliability(finalP, Y, 8).map((b) => ({ p: round(b.p, 3), hit: round(b.hit, 3), n: b.n })),
    eraSkill,
    weights: feats.map((f, j) => ({ key: f.key, label: f.label, w: round(full.w[j], 3) })),
  };
  return {
    block,
    model: { id: target.id, feats: feats.map((f) => f.key), mu: full.st.mu.map((v) => round(v, 6)), sg: full.st.sg.map((v) => round(v, 6)), w: full.w.map((v) => round(v, 6)), b: round(full.b, 6), platt: platt ? { a: round(platt.a, 5), b: round(platt.b, 5) } : null },
    labeled,
    oof: oof.map((r, k) => ({ t: r.t, y: r.y, p: finalP[k], base: r.base })),
  };
}

// Today's chance from a stored model.
export function scoreModel(model, x) {
  if (!model) return null;
  let z = model.b;
  const parts = [];
  for (let j = 0; j < model.feats.length; j++) {
    const v = x[model.feats[j]];
    const zj = finite(v) ? clamp((v - model.mu[j]) / model.sg[j], -6, 6) : 0;
    z += model.w[j] * zj;
    parts.push({ key: model.feats[j], z: round(zj, 2), push: round(model.w[j] * zj, 3), missing: !finite(v) });
  }
  let p = 1 / (1 + Math.exp(-z));
  if (model.platt) p = applyPlatt(model.platt, p);
  return { p, parts };
}

// Range around today's chance: refit on resampled eras and re-score today.
function todayRange(frame, eras, target, labeled, x, o, init) {
  const feats = featsOf(target, o);
  const groups = new Map();
  for (const r of labeled) { if (!groups.has(r.era)) groups.set(r.era, []); groups.get(r.era).push(r); }
  const gs = [...groups.values()];
  if (gs.length < o.minEras) return null;
  const rnd = mulberry32(31 + target.horizon + target.id.length);
  const ps = [];
  for (let d = 0; d < o.draws; d++) {
    const rows = [];
    for (let k = 0; k < gs.length; k++) for (const r of gs[Math.floor(rnd() * gs.length)]) rows.push(r);
    const pos = rows.reduce((s, r) => s + r.y, 0);
    if (!pos || pos === rows.length) continue;
    const m = fitOne(rows, target, o, init);
    ps.push(scoreWith(m, { x }, feats));
  }
  return ps.length >= o.draws / 2 ? [quantile(ps, 0.1), quantile(ps, 0.9)] : null;
}

// The whole read. Heavy (a few seconds): run once per new close and store it.
export function buildDrawdownOdds({ bars, fred, opts = {}, targets = DD_TARGETS } = {}) {
  const frame = buildDrawdownFrame({ bars, fred, opts });
  if (!frame || frame.rows.length < 120) return { version: DRAWDOWN_ODDS_VERSION, status: "no-data", note: "Not enough index history." };
  const o = frame.opts;
  const eras = declineEras(frame);
  const today = frame.today;
  const blocks = [], models = [];
  for (const target of targets) {
    const { block, model, labeled } = fitTarget(frame, eras, target, o);
    const applies = appliesTo(today, target);
    if (model && applies) {
      const s = scoreModel(model, today.x);
      const range = todayRange(frame, eras, target, labeled, today.x, o, { w: model.w, b: model.b });
      block.today = round(s.p, 3);
      // The range comes from raw refits; carry the same recalibration shift.
      block.range = range ? range.map((v) => round(model.platt ? applyPlatt(model.platt, v) : v, 3)).sort((a, b) => a - b) : null;
      if (block.range) { block.range[0] = Math.min(block.range[0], block.today); block.range[1] = Math.max(block.range[1], block.today); }
      block.drivers = s.parts.filter((q) => Math.abs(q.push) >= 0.05).sort((a, b) => Math.abs(b.push) - Math.abs(a.push)).slice(0, 4)
        .map((q) => ({ key: q.key, label: featsOf(target).find((f) => f.key === q.key)?.label, push: q.push, value: round(today.x[q.key], 2) }));
    } else if (!applies) {
      block.today = null;
      block.note = today.inDecline && target.kind === "lowIn"
        ? "The low of this decline has already held for the whole window."
        : "Read only while the index is 10% or more below its high.";
    }
    blocks.push(block);
    if (model) models.push(model);
  }
  const sampleVals = (key) => frame.rows.map((r) => r.x[key]).filter(finite);
  const inputs = [...DD_FEATURES, ...REC_FEATURES.filter((f) => !DD_FEATURES.some((d) => d.key === f.key))].map((f) => ({
    key: f.key, label: f.label, unit: f.unit, value: round(today.x[f.key], 2),
    pct: finite(today.x[f.key]) ? round(percentileOf(sampleVals(f.key), today.x[f.key]) * 100, 0) : null,
    from: frame.rows.find((r) => finite(r.x[f.key]))?.t || null,
  }));
  return {
    version: DRAWDOWN_ODDS_VERSION,
    status: "ok",
    asOf: today.t,
    close: round(today && frame.close[today.i], 2),
    offHigh: round(today.x.depth, 1),
    inDecline: today.inDecline,
    sampleFrom: frame.rows[0].t,
    samples: frame.rows.length,
    eras: eras.filter((e) => e.to >= frame.rows[0].i).map((e) => ({ name: e.name, peak: e.peak, trough: e.trough, recover: e.recover, depth: e.depth })),
    l2: o.l2,
    targets: blocks,
    inputs,
    models,
  };
}

// A light re-score between full fits: same models, the newest inputs.
export function rescoreDrawdownOdds(stored, { bars, fred } = {}) {
  if (!stored?.models?.length) return null;
  const frame = buildDrawdownFrame({ bars, fred, opts: { l2: stored.l2 } });
  if (!frame) return null;
  const today = frame.today;
  return {
    asOf: today.t,
    chances: stored.models.map((m) => ({ id: m.id, p: round(scoreModel(m, today.x)?.p, 3) })),
  };
}

// Grade chances stated at past builds. `log` is [{ d, c: { targetId: p } }];
// returns [{ id, p, y, t }] for every stated chance whose window has closed.
export function gradeDrawdownLog(log, { bars, fred, targets = DD_TARGETS } = {}) {
  const frame = buildDrawdownFrame({ bars, fred });
  if (!frame) return [];
  const idx = new Map(frame.px.map((b, i) => [b.t, i]));
  const out = [];
  for (const entry of log || []) {
    const i = idx.get(entry?.d);
    if (i == null || i < 1300 || !entry.c) continue;
    const row = frame.rowAt(i);
    for (const target of targets) {
      const p = entry.c[target.id];
      if (!finite(p)) continue;
      const y = labelFor(frame, row, target);
      if (y != null) out.push({ id: target.id, p, y, t: entry.d });
    }
  }
  return out;
}

export const _test = { series, dayKey, addDays, sd };
