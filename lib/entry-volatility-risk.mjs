// Pure execution-risk thresholds from already-fetched, confirmed OHLC bars.
// Each return window uses ATR ending BEFORE that window: the shock cannot
// inflate its own denominator. Absolute floors suppress tiny-noise vetoes;
// emergency caps still protect against very large gaps in volatile stocks.
export const ENTRY_VOLATILITY_POLICY = Object.freeze({
  atrSessions: 14,
  knife: { d1: [3, 2], d3: [4, 1.5] },
  severe: { d1: [5, 2.75], d3: [7, 2.3] },
  emergency: { d1: 20, d3: 30, d5: 40 },
  extension: { mild: [2, 4 / 3], soft: [4, 8 / 3], extreme: [8, 5], catastrophic: [15, 8] },
  run5: { soft: [5, 1.2], extreme: [8, 1.8], catastrophic: [15, 3] },
});

export function entryVolatilityRisk(series, side, { fightsTape = false } = {}) {
  const { c = [], h = [], l = [] } = series || {};
  const n = c.length, dir = side === 'put' ? -1 : 1;
  const priorAtr = window => {
    const end = n - 1 - window;
    if (end < ENTRY_VOLATILITY_POLICY.atrSessions) return null;
    const ranges = [];
    for (let i = end - ENTRY_VOLATILITY_POLICY.atrSessions + 1; i <= end; i++) {
      if (![h[i], l[i], c[i - 1]].every(x => Number.isFinite(x) && x > 0) || h[i] < l[i]) return null;
      ranges.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    }
    const atr = ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
    return atr > 0 && c[end] > 0 ? { dollars: atr, pct: atr / c[end] * 100 } : null;
  };
  const atr = Object.fromEntries([1, 3, 5].map(window => ['d' + window, priorAtr(window)]));
  const available = Object.values(atr).every(Boolean);
  const ret = window => n > window && c[n - 1 - window] > 0
    ? (c[n - 1] / c[n - 1 - window] - 1) * 100 * dir : null;
  const returns = { d1: ret(1), d3: ret(3), d5: ret(5) };
  const tighten = fightsTape ? .75 : 1;
  const limit = (rule, key, window, scale = 1) => available
    ? Math.max(rule[0], rule[1] * atr[key].pct * Math.sqrt(window) * scale) : null;
  const thresholds = {
    knife1: limit(ENTRY_VOLATILITY_POLICY.knife.d1, 'd1', 1, tighten),
    knife3: limit(ENTRY_VOLATILITY_POLICY.knife.d3, 'd3', 3, tighten),
    severe1: limit(ENTRY_VOLATILITY_POLICY.severe.d1, 'd1', 1, tighten),
    severe3: limit(ENTRY_VOLATILITY_POLICY.severe.d3, 'd3', 3, tighten),
    acceleration1: limit([2, 4 / 3], 'd1', 1, tighten),
  };
  const adverse = (key, threshold) => returns[key] != null && threshold != null && returns[key] <= -threshold;
  const emergencyKnife = adverse('d1', ENTRY_VOLATILITY_POLICY.emergency.d1)
    || adverse('d3', ENTRY_VOLATILITY_POLICY.emergency.d3);
  const mean20 = n >= 20 ? c.slice(-20).reduce((sum, value) => sum + value, 0) / 20 : null;
  const distPct = mean20 > 0 ? (c[n - 1] / mean20 - 1) * 100 * dir : null;
  const distAtr = atr.d1 && mean20 > 0 ? (c[n - 1] - mean20) * dir / atr.d1.dollars : null;
  const extension = Object.fromEntries(Object.entries(ENTRY_VOLATILITY_POLICY.extension).map(([name, [floor, multiple]]) =>
    [name, available && distPct >= floor && distAtr >= multiple]));
  const run5 = Object.fromEntries(Object.entries(ENTRY_VOLATILITY_POLICY.run5).map(([name, rule]) =>
    [name, available && returns.d5 >= limit(rule, 'd5', 5)]));
  const round = value => value == null ? null : Math.round(value * 100) / 100;
  return {
    available, basis: available ? 'prior-window-14-session-ATR' : 'legacy-percentage-fallback',
    priorAtrPct: Object.fromEntries(Object.entries(atr).map(([key, value]) => [key, round(value?.pct)])),
    directionalAtr: Object.fromEntries(Object.entries(returns).map(([key, value]) => [key, atr[key] && value != null ? round(value / atr[key].pct) : null])),
    distanceAtr: round(distAtr), thresholdsPct: Object.fromEntries(Object.entries(thresholds).map(([key, value]) => [key, round(value)])),
    candidateKnife: emergencyKnife || adverse('d1', thresholds.knife1) || adverse('d3', thresholds.knife3),
    severeKnife: emergencyKnife || adverse('d1', thresholds.severe1) || adverse('d3', thresholds.severe3),
    acceleration: adverse('d1', thresholds.acceleration1), emergencyKnife,
    emergencyRun: returns.d5 != null && returns.d5 >= ENTRY_VOLATILITY_POLICY.emergency.d5,
    extension, run5,
  };
}
