// Regime Lab: the hidden-Markov challenger (A8, F2).
//
// A Gaussian hidden Markov model on SPY daily log returns with two or three
// states, fitted by Baum-Welch. The label is the CAUSAL filtered state: the
// forward recursion through today only, never the smoothed (forward-backward)
// state, which would read the future (G1). Models are refit on an expanding
// window at most once a year, so the state on any day comes from a model that
// saw only earlier data. States are ordered by their standard deviation, so
// state 0 is always the calmest.
//
// Pure, deterministic (seeded start), no network.

const SQRT2PI = Math.sqrt(2 * Math.PI);
const EPS = 1e-12;

function gauss(x, mu, sigma) {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * SQRT2PI);
}

function seeded(seedText) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) { h ^= seedText.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0 || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Initial parameters: equal priors, sticky transitions, means near zero and
// standard deviations spread across the sample's volatility range.
function initModel(x, K, rnd) {
  const n = x.length;
  const m = x.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1)) || 0.01;
  const mu = [], sigma = [];
  for (let k = 0; k < K; k++) {
    mu.push(m + (rnd() - 0.5) * sd * 0.2);
    sigma.push(sd * (0.5 + (1.6 * k) / Math.max(1, K - 1)) * (0.9 + rnd() * 0.2));
  }
  const pi = new Array(K).fill(1 / K);
  const A = [];
  for (let i = 0; i < K; i++) { const row = new Array(K).fill(0.05 / Math.max(1, K - 1)); row[i] = 0.95; A.push(row); }
  return { K, pi, A, mu, sigma };
}

function orderStates(model) {
  const idx = model.sigma.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  const K = model.K;
  return {
    K, logLik: model.logLik ?? null, iterations: model.iterations ?? null,
    pi: idx.map((i) => model.pi[i]),
    A: idx.map((i) => idx.map((j) => model.A[i][j])),
    mu: idx.map((i) => model.mu[i]),
    sigma: idx.map((i) => model.sigma[i]),
  };
}

// Baum-Welch with per-step scaling. Returns the ordered model.
export function fitGaussianHmm(x, { states = 2, iters = 60, seed = "hmm", tol = 1e-5 } = {}) {
  const K = Math.max(2, Math.min(4, Math.round(states)));
  const obs = x.filter((v) => Number.isFinite(v));
  const n = obs.length;
  if (n < 200) return null;
  const rnd = seeded(`${seed}|${K}|${n}`);
  const model = initModel(obs, K, rnd);
  let prevLL = -Infinity;
  const alpha = Array.from({ length: n }, () => new Array(K).fill(0));
  const beta = Array.from({ length: n }, () => new Array(K).fill(0));
  const scale = new Array(n).fill(0);
  const B = Array.from({ length: n }, () => new Array(K).fill(0));
  for (let it = 0; it < iters; it++) {
    // Emission probabilities.
    for (let t = 0; t < n; t++) for (let k = 0; k < K; k++) B[t][k] = Math.max(EPS, gauss(obs[t], model.mu[k], model.sigma[k]));
    // Forward.
    let ll = 0;
    for (let k = 0; k < K; k++) alpha[0][k] = model.pi[k] * B[0][k];
    scale[0] = alpha[0].reduce((a, b) => a + b, 0) || EPS;
    for (let k = 0; k < K; k++) alpha[0][k] /= scale[0];
    ll += Math.log(scale[0]);
    for (let t = 1; t < n; t++) {
      let s = 0;
      for (let k = 0; k < K; k++) {
        let a = 0;
        for (let j = 0; j < K; j++) a += alpha[t - 1][j] * model.A[j][k];
        alpha[t][k] = a * B[t][k]; s += alpha[t][k];
      }
      scale[t] = s || EPS;
      for (let k = 0; k < K; k++) alpha[t][k] /= scale[t];
      ll += Math.log(scale[t]);
    }
    // Backward.
    for (let k = 0; k < K; k++) beta[n - 1][k] = 1;
    for (let t = n - 2; t >= 0; t--) {
      for (let k = 0; k < K; k++) {
        let b = 0;
        for (let j = 0; j < K; j++) b += model.A[k][j] * B[t + 1][j] * beta[t + 1][j];
        beta[t][k] = b / scale[t + 1];
      }
    }
    // Re-estimate.
    const gammaSum = new Array(K).fill(0), muNum = new Array(K).fill(0), xiSum = Array.from({ length: K }, () => new Array(K).fill(0));
    const gamma0 = new Array(K).fill(0);
    const gammas = Array.from({ length: n }, () => new Array(K).fill(0));
    for (let t = 0; t < n; t++) {
      let s = 0;
      for (let k = 0; k < K; k++) { gammas[t][k] = alpha[t][k] * beta[t][k]; s += gammas[t][k]; }
      s = s || EPS;
      for (let k = 0; k < K; k++) { gammas[t][k] /= s; gammaSum[k] += gammas[t][k]; muNum[k] += gammas[t][k] * obs[t]; if (t === 0) gamma0[k] = gammas[t][k]; }
      if (t < n - 1) {
        let xs = 0;
        const xi = Array.from({ length: K }, () => new Array(K).fill(0));
        for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) { xi[i][j] = alpha[t][i] * model.A[i][j] * B[t + 1][j] * beta[t + 1][j]; xs += xi[i][j]; }
        xs = xs || EPS;
        for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) xiSum[i][j] += xi[i][j] / xs;
      }
    }
    for (let k = 0; k < K; k++) {
      model.pi[k] = Math.max(EPS, gamma0[k]);
      const gs = gammaSum[k] || EPS;
      model.mu[k] = muNum[k] / gs;
      let v = 0;
      for (let t = 0; t < n; t++) v += gammas[t][k] * (obs[t] - model.mu[k]) ** 2;
      model.sigma[k] = Math.max(1e-4, Math.sqrt(v / gs));
      const rowSum = xiSum[k].reduce((a, b) => a + b, 0) || EPS;
      for (let j = 0; j < K; j++) model.A[k][j] = Math.max(EPS, xiSum[k][j] / rowSum);
    }
    model.logLik = ll; model.iterations = it + 1;
    if (Math.abs(ll - prevLL) < tol * Math.abs(ll)) break;
    prevLL = ll;
  }
  return orderStates(model);
}

// Causal filtered state probabilities: P(state_t | x_1..x_t). Returns an
// array of probability vectors aligned to `x` (null where x is not finite).
export function filterStates(x, model) {
  if (!model) return x.map(() => null);
  const K = model.K;
  const out = [];
  let prev = null;
  for (let t = 0; t < x.length; t++) {
    const v = x[t];
    if (!Number.isFinite(v)) { out.push(null); continue; }
    const cur = new Array(K).fill(0);
    let s = 0;
    for (let k = 0; k < K; k++) {
      let prior = 0;
      if (!prev) prior = model.pi[k]; else for (let j = 0; j < K; j++) prior += prev[j] * model.A[j][k];
      cur[k] = prior * Math.max(EPS, gauss(v, model.mu[k], model.sigma[k])); s += cur[k];
    }
    s = s || EPS;
    for (let k = 0; k < K; k++) cur[k] /= s;
    out.push(cur); prev = cur;
  }
  return out;
}

export function argmax(p) {
  if (!p) return null;
  let b = 0;
  for (let k = 1; k < p.length; k++) if (p[k] > p[b]) b = k;
  return b;
}

// A label series on an aligned calendar. `returns[i]` is the log return on
// cal[i] (null where unknown). The model used on day i was fitted on returns
// strictly before the most recent refit point, which is at least `minTrain`
// observations in and repeats every `refitEvery` sessions. The returned rows
// carry the filtered state (0 = calmest) and `stressed` = the top-variance
// state has the most probability.
export function hmmLabelSeries({ cal, returns, states = 2, refitEvery = 252, minTrain = 750, seed = "spy" } = {}) {
  if (!Array.isArray(cal) || !Array.isArray(returns) || cal.length !== returns.length) throw new Error("hmmLabelSeries needs cal and returns of equal length");
  const rows = new Array(cal.length).fill(null);
  let model = null, nextRefit = minTrain, fits = 0;
  // Filter incrementally: keep the running posterior so a refit does not
  // need to re-run from the start (the model changes, the posterior carries).
  let prev = null;
  for (let i = 0; i < cal.length; i++) {
    if (i >= nextRefit) {
      const train = returns.slice(0, i).filter((v) => Number.isFinite(v));
      const m = fitGaussianHmm(train, { states, seed: `${seed}|${cal[i]}` });
      if (m) { model = m; fits++; prev = null; }
      nextRefit = i + refitEvery;
    }
    if (!model || !Number.isFinite(returns[i])) { rows[i] = { date: cal[i], state: null, probs: null, stressed: null }; continue; }
    const K = model.K, cur = new Array(K).fill(0);
    let s = 0;
    for (let k = 0; k < K; k++) {
      let prior = 0;
      if (!prev) prior = model.pi[k]; else for (let j = 0; j < K; j++) prior += prev[j] * model.A[j][k];
      cur[k] = prior * Math.max(EPS, gauss(returns[i], model.mu[k], model.sigma[k])); s += cur[k];
    }
    s = s || EPS;
    for (let k = 0; k < K; k++) cur[k] /= s;
    prev = cur;
    const st = argmax(cur);
    rows[i] = { date: cal[i], state: st, probs: cur.map((p) => Math.round(p * 1000) / 1000), stressed: st === K - 1 };
  }
  // Flip count of the stressed/calm reading, for the stability comparison.
  let flips = 0, n = 0, lastS = null;
  for (const r of rows) { if (!r || r.stressed == null) continue; n++; if (lastS != null && r.stressed !== lastS) flips++; lastS = r.stressed; }
  return { version: `hmm-${states}`, states, rows, model: model ? { mu: model.mu.map((v) => Math.round(v * 1e5) / 1e5), sigma: model.sigma.map((v) => Math.round(v * 1e5) / 1e5), A: model.A.map((row) => row.map((v) => Math.round(v * 1000) / 1000)) } : null, fits, stats: { sessions: n, flips, flipsPerYear: n ? Math.round((flips / (n / 252)) * 100) / 100 : null }, centered: false };
}
