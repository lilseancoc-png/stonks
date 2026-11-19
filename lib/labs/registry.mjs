// Research registry (Owner-only, no AI, no fetch): every book and backtest
// with the number of things that were tried to get it, and its result after a
// penalty for that count.
//
// Try enough rules and one will look good by luck. The registry keeps the
// count (`trials`) beside each result and reports:
//   t          the plain t-statistic of the average return
//   tNeeded    the t a result needs once `trials` attempts are allowed for
//   chanceReal the deflated Sharpe ratio: the chance the true average is above
//              what the best of `trials` lucky attempts would show
// A book "holds up" only when chanceReal is 95%+ and t clears tNeeded.

import { finite, round, mean, sd, skewness, kurtosis, tStat, deflatedSharpe, trialsAdjustedT } from "./stats.mjs";

export const REGISTRY_VERSION = 1;
export const REGISTRY_MIN_N = 20;

// Counts of what was tried, for families whose attempts are fixed in code or
// in a committed research run. Edit a count when a new variant is tried.
export const TRIAL_LOG = [
  { family: "top-picks", trials: 12, what: "Top Picks rule sets since the rebuild (grade, entry, exit and structure versions on the record)" },
  { family: "engines", trials: 28, what: "Eight strategy engines and the setups each one trades (the Trend follower and Momentum basket added four on 2026-11-17)" },
  { family: "regime-lab", trials: 22, what: "Regime Lab tests F1 to F22" },
  { family: "loop", trials: 9, what: "Self-improving loop challenger menu" },
  { family: "drawdown-odds", trials: 21, what: "Seven market events at three ridge strengths (5, 20, 80; 20 was fixed first)" },
  { family: "factors", trials: 28, what: "Seven price factors at four horizons" },
  { family: "vol", trials: 4, what: "Four volatility forecasts (trailing, EWMA, GARCH, HAR)" },
  { family: "factor-universe", trials: 18, what: "Wide history test: 17 factors and one combined score on the 500 largest US companies" },
  { family: "earnings-forecast", trials: 4, what: "Earnings Forecast history test: three growth rules and one drivers rule against the current rule" },
  { family: "engine-strategy-tests", trials: 553, what: "2026-11-19 strategy test series on real option prices: 553 variants of entries, exits, instruments, sizing, adaptive rules and events; the engines' two paper trials (RSI(2) dip, index after extreme fear) came from it and did not clear its bar" },
];
// Largest fall of the running sum of per-trade results, in points of one
// trade's stake. Trades are not compounded: each one risks its own premium,
// so one total loss is a 100-point step, not the end of the book.
export function worstRunPts(xs) {
  let sum = 0, peak = 0, worst = 0;
  for (const x of xs || []) { if (!finite(x)) continue; sum += x; if (sum > peak) peak = sum; if (sum - peak < worst) worst = sum - peak; }
  return worst;
}
export const trialsFor = (family, log = TRIAL_LOG) => log.find((r) => r.family === family)?.trials || 1;

// One registry row from a list of per-trade (or per-period) returns in percent.
export function registryRow({ id, label, family, returns, trials = null, siblings = null, note = null, unit = "trade" }) {
  const xs = (returns || []).filter(finite);
  const n = xs.length;
  const tr = trials || trialsFor(family);
  const row = { id, label, family, unit, n, trials: tr, note };
  if (n < REGISTRY_MIN_N) return { ...row, verdict: "few", read: `Only ${n} closed; ${REGISTRY_MIN_N} are needed for a read.` };
  const m = mean(xs), s = sd(xs), t = tStat(xs);
  const sr = s > 0 ? m / s : 0;
  // Spread of the Sharpe ratios across the family when its other books are
  // known; otherwise the spread luck alone gives at this sample size.
  const sib = (siblings || []).filter(finite);
  const sdTrials = sib.length >= 3 ? Math.max(sd(sib), 1 / Math.sqrt(n)) : 1 / Math.sqrt(n);
  const d = deflatedSharpe({ sr, n, skew: skewness(xs), kurt: kurtosis(xs), trials: tr, sdOfTrials: sdTrials });
  const tNeeded = trialsAdjustedT(tr);
  let verdict, read;
  if (m <= 0) { verdict = "losing"; read = `Average ${round(m, 1)}% a ${unit}: losing before any penalty.`; }
  else if (d.dsr >= 0.95 && t >= tNeeded) { verdict = "holds"; read = `Holds up: average ${round(m, 1)}% a ${unit}, and that survives the penalty for ${tr} things tried.`; }
  else if (t >= 2) { verdict = "lucky"; read = `Looks good alone (t ${round(t, 1)}) but not after allowing for ${tr} things tried (needs t ${round(tNeeded, 1)}).`; }
  else { verdict = "unproven"; read = `Average ${round(m, 1)}% a ${unit}, which chance alone can produce at ${n} ${unit}s.`; }
  return {
    ...row, mean: round(m, 2), sd: round(s, 2), t: round(t, 2), tNeeded: round(tNeeded, 2), sharpe: round(sr, 3),
    chanceReal: round(d.dsr, 3), worstRun: round(worstRunPts(xs), 1), verdict, read,
  };
}

// Books: [{ id, label, family, returns, note }]. Rows in one family share the
// spread of their Sharpe ratios.
export function buildRegistry(books, { log = TRIAL_LOG, research = [] } = {}) {
  const sharpeOf = (b) => { const xs = (b.returns || []).filter(finite); const s = xs.length > 2 ? sd(xs) : 0; return s > 0 ? mean(xs) / s : null; };
  const byFamily = new Map();
  for (const b of books || []) { if (!byFamily.has(b.family)) byFamily.set(b.family, []); byFamily.get(b.family).push(sharpeOf(b)); }
  const rows = (books || []).map((b) => registryRow({ ...b, trials: b.trials || trialsFor(b.family, log), siblings: byFamily.get(b.family) }));
  const order = { holds: 0, lucky: 1, unproven: 2, losing: 3, few: 4 };
  rows.sort((a, b) => (order[a.verdict] ?? 5) - (order[b.verdict] ?? 5) || (b.n || 0) - (a.n || 0));
  return {
    v: REGISTRY_VERSION,
    rows,
    trials: log.map((r) => ({ family: r.family, trials: r.trials, what: r.what })),
    // History tests logged by the research runner (aggregates only).
    research: (research || []).map((r) => ({ id: r.id, label: r.label, family: r.family, trials: r.trials ?? trialsFor(r.family, log), result: r.result, verdict: r.verdict || null, ran: r.ran || null })),
    summary: { total: rows.length, holds: rows.filter((r) => r.verdict === "holds").length, lucky: rows.filter((r) => r.verdict === "lucky").length, losing: rows.filter((r) => r.verdict === "losing").length, few: rows.filter((r) => r.verdict === "few").length },
  };
}
