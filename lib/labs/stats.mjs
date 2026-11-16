// Quant labs: shared statistics. Pure functions, no I/O, no randomness that is
// not seeded. Every lab scores itself with these, so a Brier score or a
// deflated Sharpe ratio means the same thing on every tab.
//
// Spec: docs/quant-labs.md.

export const finite = (v) => typeof v === "number" && Number.isFinite(v);
export const round = (v, d = 4) => (finite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function mean(xs) {
  let s = 0, n = 0;
  for (const x of xs) if (finite(x)) { s += x; n++; }
  return n ? s / n : null;
}
export function sd(xs, sample = true) {
  const m = mean(xs);
  if (m == null) return null;
  let s = 0, n = 0;
  for (const x of xs) if (finite(x)) { s += (x - m) ** 2; n++; }
  const d = sample ? n - 1 : n;
  return d > 0 ? Math.sqrt(s / d) : null;
}
export function quantile(xs, q) {
  const a = xs.filter(finite).sort((x, y) => x - y);
  if (!a.length) return null;
  const pos = clamp(q, 0, 1) * (a.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
export const median = (xs) => quantile(xs, 0.5);

// Share of the values at or below v (midrank), 0..1.
export function percentileOf(xs, v) {
  let below = 0, equal = 0, n = 0;
  for (const x of xs) { if (!finite(x)) continue; n++; if (x < v) below++; else if (x === v) equal++; }
  return n ? (below + equal / 2) / n : null;
}

export function skewness(xs) {
  const a = xs.filter(finite), m = mean(a), s = sd(a, false);
  if (!a.length || !s) return null;
  return mean(a.map((x) => ((x - m) / s) ** 3));
}
// Plain (non-excess) kurtosis: 3 for a normal sample.
export function kurtosis(xs) {
  const a = xs.filter(finite), m = mean(a), s = sd(a, false);
  if (!a.length || !s) return null;
  return mean(a.map((x) => ((x - m) / s) ** 4));
}

// --- the normal distribution ---------------------------------------------------
export function normCdf(z) {
  // Abramowitz-Stegun 7.1.26 on erf; error under 1.5e-7.
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
export function normInv(p) {
  // Acklam's rational approximation; relative error under 1.2e-9.
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
// Two-sided p-value for a t statistic, normal approximation with a small-sample
// correction (Cornish-Fisher on the degrees of freedom). Good to ~2 decimals
// from 10 degrees of freedom up, which is all the labs need.
export function pFromT(t, df) {
  if (!finite(t) || !(df > 0)) return null;
  const z = Math.abs(t) * (1 - 1 / (4 * df)) / Math.sqrt(1 + (t * t) / (2 * df));
  return clamp(2 * (1 - normCdf(z)), 0, 1);
}
export function tStat(xs) {
  const a = xs.filter(finite), s = sd(a);
  if (a.length < 3 || !s) return null;
  return mean(a) / (s / Math.sqrt(a.length));
}

// --- seeded randomness ----------------------------------------------------------
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < String(text).length; i++) { h ^= String(text).charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Percentile range of a statistic over resampled groups. `groups` is an array
// of arrays (one per independent block: a crisis era, a week, a stock); each
// draw picks groups with replacement and passes the flattened rows to stat().
export function blockBootstrap(groups, stat, { draws = 400, seed = 1, lo = 0.1, hi = 0.9 } = {}) {
  const usable = groups.filter((g) => g && g.length);
  if (usable.length < 2) return null;
  const rnd = mulberry32(seed), out = [];
  for (let d = 0; d < draws; d++) {
    const rows = [];
    for (let i = 0; i < usable.length; i++) for (const r of usable[Math.floor(rnd() * usable.length)]) rows.push(r);
    const v = stat(rows);
    if (finite(v)) out.push(v);
  }
  if (out.length < draws / 2) return null;
  return { lo: quantile(out, lo), hi: quantile(out, hi), mid: quantile(out, 0.5), draws: out.length };
}

// --- ranks and correlation --------------------------------------------------------
export function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}
export function pearson(xs, ys) {
  const pairs = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) if (finite(xs[i]) && finite(ys[i])) pairs.push([xs[i], ys[i]]);
  if (pairs.length < 3) return null;
  const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
export function spearman(xs, ys) {
  const a = [], b = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) if (finite(xs[i]) && finite(ys[i])) { a.push(xs[i]); b.push(ys[i]); }
  return a.length < 3 ? null : pearson(ranks(a), ranks(b));
}

// --- probability scores -------------------------------------------------------------
const EPS = 1e-6;
const pairsOf = (p, y) => { const out = []; for (let i = 0; i < Math.min(p.length, y.length); i++) if (finite(p[i]) && (y[i] === 0 || y[i] === 1)) out.push([clamp(p[i], 0, 1), y[i]]); return out; };
export function brier(p, y) {
  const ps = pairsOf(p, y);
  return ps.length ? mean(ps.map(([q, o]) => (q - o) ** 2)) : null;
}
export function logLoss(p, y) {
  const ps = pairsOf(p, y);
  return ps.length ? -mean(ps.map(([q, o]) => (o ? Math.log(Math.max(q, EPS)) : Math.log(Math.max(1 - q, EPS))))) : null;
}
// 1 - Brier / Brier of a constant forecast. `base` defaults to the sample's own
// event rate (the hardest constant to beat); pass a per-row base to score
// against a rate known beforehand.
export function brierSkill(p, y, base = null) {
  const ps = pairsOf(p, y);
  if (ps.length < 2) return null;
  const rate = mean(ps.map((x) => x[1]));
  const bs = mean(ps.map(([q, o]) => (q - o) ** 2));
  let ref;
  if (Array.isArray(base)) {
    const rows = [];
    for (let i = 0; i < Math.min(p.length, y.length); i++) if (finite(p[i]) && (y[i] === 0 || y[i] === 1) && finite(base[i])) rows.push((base[i] - y[i]) ** 2);
    ref = mean(rows);
  } else ref = mean(ps.map(([, o]) => ((finite(base) ? base : rate) - o) ** 2));
  return ref > 0 ? 1 - bs / ref : null;
}
// Area under the ROC curve (the chance a random event outranks a random
// non-event), ties counted half. Rank-based, so `p` may be any score on any
// scale (a 4-10 grade, a 0-100 engine score); values are not clamped to 0..1.
export function auc(p, y) {
  const ps = [];
  for (let i = 0; i < Math.min(p.length, y.length); i++) if (finite(p[i]) && (y[i] === 0 || y[i] === 1)) ps.push([p[i], y[i]]);
  const pos = ps.filter((x) => x[1] === 1).length, neg = ps.length - pos;
  if (!pos || !neg) return null;
  const r = ranks(ps.map((x) => x[0]));
  let sum = 0;
  for (let i = 0; i < ps.length; i++) if (ps[i][1] === 1) sum += r[i];
  return (sum - (pos * (pos + 1)) / 2) / (pos * neg);
}
// Reliability table: forecasts grouped into `bins` equal-count buckets, each
// with its mean forecast, the share that happened and the count.
export function reliability(p, y, bins = 10) {
  const ps = pairsOf(p, y).sort((a, b) => a[0] - b[0]);
  if (!ps.length) return [];
  const k = Math.max(1, Math.min(bins, Math.floor(ps.length / 5) || 1)), out = [];
  for (let b = 0; b < k; b++) {
    const part = ps.slice(Math.floor((b * ps.length) / k), Math.floor(((b + 1) * ps.length) / k));
    if (!part.length) continue;
    out.push({ p: round(mean(part.map((x) => x[0]))), hit: round(mean(part.map((x) => x[1]))), n: part.length });
  }
  return out;
}
// Expected calibration error: the count-weighted gap between stated and
// realized frequency across the reliability buckets.
export function calibrationError(p, y, bins = 10) {
  const rel = reliability(p, y, bins), n = rel.reduce((s, r) => s + r.n, 0);
  return n ? rel.reduce((s, r) => s + (r.n / n) * Math.abs(r.p - r.hit), 0) : null;
}
// One summary block for a set of stated chances and what happened.
export function scoreForecasts(p, y, { bins = 10, base = null } = {}) {
  const ps = pairsOf(p, y);
  if (!ps.length) return { n: 0 };
  const rate = mean(ps.map((x) => x[1]));
  return {
    n: ps.length, rate: round(rate), meanP: round(mean(ps.map((x) => x[0]))),
    brier: round(brier(p, y)), skill: round(brierSkill(p, y, base)), logLoss: round(logLoss(p, y)),
    auc: round(auc(p, y)), ece: round(calibrationError(p, y, bins)), bins: reliability(p, y, bins),
  };
}
// Share of outcomes that landed inside a stated range, against the share the
// range claimed (0.5 for a 50% band).
export function coverage(rows, claimed) {
  const usable = rows.filter((r) => r && finite(r.lo) && finite(r.hi) && finite(r.actual));
  if (!usable.length) return { n: 0, claimed };
  const inside = usable.filter((r) => r.actual >= r.lo && r.actual <= r.hi).length;
  return { n: usable.length, claimed, hit: round(inside / usable.length), gap: round(inside / usable.length - claimed) };
}

// --- logistic regression with fixed signs -------------------------------------------
const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
export { sigmoid };
// Ridge logistic regression by accelerated projected gradient (FISTA with
// restart). `signs[j]` is +1 (the weight may only raise the chance), -1 (only
// lower it) or 0 (free); a weight that would cross zero is held at zero. X rows
// are plain arrays; put features on a common scale first (see standardizer).
// The loss is the summed log loss plus (l2 / 2) * |w|^2; the intercept is not
// penalized. `init` warm-starts from an earlier fit. Returns { w, b, iters }.
export function fitLogistic(X, y, { l2 = 1, signs = null, iters = 500, tol = 1e-6, weights = null, init = null } = {}) {
  const n = X.length, k = n ? X[0].length : 0;
  const A = new Float64Array(n * k), Y = new Float64Array(n), W = new Float64Array(n);
  let wsum = 0, rate = 0;
  for (let i = 0; i < n; i++) {
    const row = X[i];
    for (let j = 0; j < k; j++) A[i * k + j] = finite(row[j]) ? row[j] : 0;
    Y[i] = y[i]; W[i] = weights ? weights[i] : 1;
    wsum += W[i]; rate += W[i] * Y[i];
  }
  wsum = wsum || 1;
  rate = clamp(rate / wsum, 1e-4, 1 - 1e-4);
  // Largest curvature of the mean log loss: a quarter of the top eigenvalue of
  // the weighted second-moment matrix (intercept column included), by power
  // iteration, plus the ridge term.
  const v = new Float64Array(k + 1).fill(1), u = new Float64Array(k + 1);
  let top = 1;
  for (let it = 0; it < 30; it++) {
    u.fill(0);
    for (let i = 0; i < n; i++) {
      let d = v[k];
      const o = i * k;
      for (let j = 0; j < k; j++) d += A[o + j] * v[j];
      d *= W[i];
      for (let j = 0; j < k; j++) u[j] += A[o + j] * d;
      u[k] += d;
    }
    let norm = 0;
    for (let j = 0; j <= k; j++) norm += u[j] * u[j];
    norm = Math.sqrt(norm) || 1;
    top = norm / wsum;
    for (let j = 0; j <= k; j++) v[j] = u[j] / norm;
  }
  const step = 1 / (0.25 * top * 1.05 + l2 / wsum);
  const w = new Float64Array(k), wPrev = new Float64Array(k), q = new Float64Array(k), g = new Float64Array(k);
  let b = init && finite(init.b) ? init.b : Math.log(rate / (1 - rate)), bPrev = b, qb = b, tk = 1, it = 0;
  if (init?.w) for (let j = 0; j < k; j++) { w[j] = init.w[j] || 0; wPrev[j] = w[j]; q[j] = w[j]; }
  for (; it < iters; it++) {
    g.fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = qb;
      const o = i * k;
      for (let j = 0; j < k; j++) z += q[j] * A[o + j];
      const e = W[i] * (sigmoid(z) - Y[i]);
      gb += e;
      for (let j = 0; j < k; j++) g[j] += e * A[o + j];
    }
    let move = 0, dot = 0;
    const bNext = qb - step * (gb / wsum);
    for (let j = 0; j < k; j++) {
      let next = q[j] - step * (g[j] / wsum + (l2 / wsum) * q[j]);
      const s = signs ? signs[j] : 0;
      if (s > 0 && next < 0) next = 0;
      if (s < 0 && next > 0) next = 0;
      dot += (q[j] - next) * (next - w[j]);
      wPrev[j] = w[j]; w[j] = next;
      move += Math.abs(w[j] - wPrev[j]);
    }
    dot += (qb - bNext) * (bNext - b);
    bPrev = b; b = bNext;
    move += Math.abs(b - bPrev);
    if (move < tol) { it++; break; }
    // Momentum, dropped whenever it points uphill.
    const tNext = dot > 0 ? 1 : (1 + Math.sqrt(1 + 4 * tk * tk)) / 2;
    const m = dot > 0 ? 0 : (tk - 1) / tNext;
    for (let j = 0; j < k; j++) {
      let qq = w[j] + m * (w[j] - wPrev[j]);
      const s = signs ? signs[j] : 0;
      if (s > 0 && qq < 0) qq = 0;
      if (s < 0 && qq > 0) qq = 0;
      q[j] = qq;
    }
    qb = b + m * (b - bPrev);
    tk = tNext;
  }
  return { w: Array.from(w), b, iters: it };
}
export function predictLogistic(model, row) {
  let z = model.b;
  for (let j = 0; j < model.w.length; j++) z += model.w[j] * (finite(row[j]) ? row[j] : 0);
  return sigmoid(z);
}
// Column means and spreads from the training rows. apply() centers, scales and
// writes 0 (the training mean) for a missing value, so a feature with no
// history yet neither helps nor hurts.
export function standardizer(X) {
  const k = X.length ? X[0].length : 0, mu = [], sg = [];
  for (let j = 0; j < k; j++) {
    const col = X.map((r) => r[j]).filter(finite);
    const m = col.length ? mean(col) : 0, s = col.length > 1 ? sd(col) : 1;
    mu.push(m); sg.push(s > 1e-12 ? s : 1);
  }
  return { mu, sg, apply: (row) => row.map((v, j) => (finite(v) ? clamp((v - mu[j]) / sg[j], -6, 6) : 0)) };
}
// Platt scaling: a logistic fit of the outcome on the forecast's log-odds.
export function fitPlatt(p, y) {
  const ps = pairsOf(p, y);
  if (ps.length < 20) return null;
  const X = ps.map(([q]) => [Math.log(clamp(q, EPS, 1 - EPS) / (1 - clamp(q, EPS, 1 - EPS)))]);
  const m = fitLogistic(X, ps.map((x) => x[1]), { l2: 0.01, iters: 800 });
  return { a: m.w[0], b: m.b };
}
export function applyPlatt(platt, p) {
  if (!platt || !finite(p)) return p;
  const q = clamp(p, EPS, 1 - EPS);
  return sigmoid(platt.a * Math.log(q / (1 - q)) + platt.b);
}

// --- least squares ---------------------------------------------------------------------
function solve(A, b) {
  const n = A.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function invert(A) {
  const n = A.length, cols = [];
  for (let c = 0; c < n; c++) {
    const e = new Array(n).fill(0); e[c] = 1;
    const x = solve(A, e);
    if (!x) return null;
    cols.push(x);
  }
  return A.map((_, r) => cols.map((col) => col[r]));
}
// Ordinary least squares with an intercept. X rows are arrays of regressors
// (without the constant). `lags` > 0 gives Newey-West standard errors, for
// daily returns whose errors are serially correlated. Returns
// { alpha, beta[], se[], t[], r2, n, resid } where se/t index 0 is the intercept.
export function ols(X, y, { lags = 0 } = {}) {
  const rows = [];
  for (let i = 0; i < Math.min(X.length, y.length); i++) if (finite(y[i]) && X[i].every(finite)) rows.push([[1, ...X[i]], y[i]]);
  const n = rows.length, k = n ? rows[0][0].length : 0;
  if (n < k + 2) return null;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0)), Xty = new Array(k).fill(0);
  for (const [x, v] of rows) for (let a = 0; a < k; a++) { Xty[a] += x[a] * v; for (let b = 0; b < k; b++) XtX[a][b] += x[a] * x[b]; }
  const inv = invert(XtX);
  if (!inv) return null;
  const coef = inv.map((r) => r.reduce((s, v, j) => s + v * Xty[j], 0));
  const resid = rows.map(([x, v]) => v - x.reduce((s, xv, j) => s + xv * coef[j], 0));
  const my = mean(rows.map((r) => r[1]));
  const sst = rows.reduce((s, r) => s + (r[1] - my) ** 2, 0), sse = resid.reduce((s, e) => s + e * e, 0);
  // Sandwich middle: sum of x x' e^2 plus Bartlett-weighted lagged terms.
  const S = Array.from({ length: k }, () => new Array(k).fill(0));
  if (lags > 0) {
    for (let l = 0; l <= Math.min(lags, n - 1); l++) {
      const wgt = l === 0 ? 1 : 1 - l / (lags + 1);
      for (let i = l; i < n; i++) {
        const xi = rows[i][0], xj = rows[i - l][0], ee = resid[i] * resid[i - l];
        for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) S[a][b] += wgt * ee * (l === 0 ? xi[a] * xi[b] : xi[a] * xj[b] + xj[a] * xi[b]);
      }
    }
  }
  const se = [];
  for (let a = 0; a < k; a++) {
    let v;
    if (lags > 0) { v = 0; for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) v += inv[a][i] * S[i][j] * inv[j][a]; v *= n / (n - k); }
    else v = (sse / (n - k)) * inv[a][a];
    se.push(v > 0 ? Math.sqrt(v) : null);
  }
  return { alpha: coef[0], beta: coef.slice(1), se, t: coef.map((c, i) => (se[i] ? c / se[i] : null)), r2: sst > 0 ? 1 - sse / sst : null, n, resid };
}

// --- returns, Sharpe and overfitting -----------------------------------------------------
export function maxDrawdown(returns) {
  let eq = 1, peak = 1, worst = 0;
  for (const r of returns) { if (!finite(r)) continue; eq *= 1 + r; if (eq > peak) peak = eq; worst = Math.min(worst, eq / peak - 1); }
  return worst;
}
export function sharpe(returns, perYear = 252) {
  const a = returns.filter(finite), s = sd(a);
  return a.length > 2 && s ? (mean(a) / s) * Math.sqrt(perYear) : null;
}
// Probabilistic Sharpe ratio (Bailey and Lopez de Prado 2012): the chance the
// true per-period Sharpe is above `benchmark`, given the sample's length,
// skew and kurtosis. `sr` and `benchmark` are per period, not annualized.
export function probabilisticSharpe(sr, n, skew = 0, kurt = 3, benchmark = 0) {
  if (!finite(sr) || !(n > 2)) return null;
  const denom = Math.sqrt(Math.max(1e-12, 1 - (skew || 0) * sr + (((kurt || 3) - 1) / 4) * sr * sr));
  return normCdf(((sr - benchmark) * Math.sqrt(n - 1)) / denom);
}
// The Sharpe ratio the best of `trials` unrelated, skill-free strategies would
// show by luck (per period), given the spread of Sharpe ratios across trials.
export function expectedMaxSharpe(trials, sdOfTrials) {
  if (!(trials >= 1) || !finite(sdOfTrials)) return null;
  if (trials < 2) return 0;
  const g = 0.5772156649015329;
  return sdOfTrials * ((1 - g) * normInv(1 - 1 / trials) + g * normInv(1 - 1 / (trials * Math.E)));
}
// Deflated Sharpe ratio (Bailey and Lopez de Prado 2014): the probabilistic
// Sharpe ratio measured against the luck threshold for the number of trials
// run. Below about 0.95 a result is not distinguishable from the best of that
// many random tries. With no spread given, the null spread of a Sharpe
// estimate, sqrt(1/n), stands in.
export function deflatedSharpe({ sr, n, skew = 0, kurt = 3, trials = 1, sdOfTrials = null }) {
  if (!finite(sr) || !(n > 2)) return null;
  const spread = finite(sdOfTrials) && sdOfTrials > 0 ? sdOfTrials : Math.sqrt(1 / n);
  const bench = expectedMaxSharpe(Math.max(1, trials), spread) || 0;
  return { dsr: probabilisticSharpe(sr, n, skew, kurt, bench), benchmark: bench };
}
// Benjamini-Hochberg: which p-values survive a false discovery rate of q.
export function benjaminiHochberg(pvals, q = 0.1) {
  const idx = pvals.map((p, i) => [p, i]).filter((x) => finite(x[0])).sort((a, b) => a[0] - b[0]);
  const m = idx.length, pass = new Array(pvals.length).fill(false);
  let cut = -1;
  for (let i = 0; i < m; i++) if (idx[i][0] <= ((i + 1) / m) * q) cut = i;
  for (let i = 0; i <= cut; i++) pass[idx[i][1]] = true;
  return pass;
}
// The t statistic a result must clear after `trials` tries (Bonferroni on a
// two-sided 5% test). 1 try = 1.96, 10 = 2.81, 100 = 3.48.
export function trialsAdjustedT(trials, alpha = 0.05) {
  return -normInv(alpha / (2 * Math.max(1, trials)));
}
