// One chart request, separate research depth and the existing scoring window.
export const PATTERN_HISTORY_DAYS = 730;
export const TECHNICAL_HISTORY_DAYS = 365;
export function splitPatternHistory(bars, now = new Date()) {
  const cutoff = new Date(now.getTime() - TECHNICAL_HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  return {research: bars, technical: bars.filter(b => String(b.t || '') >= cutoff)};
}
