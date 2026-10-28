// Descriptive MA context from the same completed bars used by the streak.
export const STREAK_MA_PERIODS = Object.freeze([20, 50, 100, 200]);
export function buildStreakMaContext(bars) {
  if (!Array.isArray(bars) || !bars.length) return null;
  const last = bars.at(-1);
  if (!(last?.c > 0)) return null;
  const meanAt = (period, end) => {
    if (end < period) return null;
    const window = bars.slice(end - period, end);
    if (window.some(b => !Number.isFinite(b?.c) || b.c <= 0)) return null;
    return window.reduce((sum, b) => sum + b.c, 0) / period;
  };
  const round = n => n == null ? null : Math.round(n * 10000) / 10000;
  const levels = STREAK_MA_PERIODS.flatMap(period => {
    const value = meanAt(period, bars.length);
    if (value == null) return [];
    const prior = meanAt(period, bars.length - 1), older = meanAt(period, bars.length - 5);
    const distancePct = (last.c / value - 1) * 100;
    const priorClose = bars.at(-2)?.c;
    const event = prior && priorClose <= prior && last.c > value ? 'reclaimed'
      : prior && priorClose >= prior && last.c < value ? 'lost' : null;
    const slopePct = older ? (value / older - 1) * 100 : null;
    return [{period, value: round(value), distancePct: round(distancePct),
      slopePct: round(slopePct), slope: slopePct == null ? null : Math.abs(slopePct) < 0.05 ? 'flat' : slopePct > 0 ? 'rising' : 'falling', event}];
  });
  const nearest = levels.slice().sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct) || a.period - b.period)[0];
  return {asOf: last.t || last.date || null, close: last.c, nearestPeriod: nearest?.period ?? null, levels};
}
