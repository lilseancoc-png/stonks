// Deliberately synthetic close series for deterministic UI/math checks.
// Not a record of actual market performance.
import { isHistoricalTradingDate } from '../../lib/historical-market-calendar.mjs';
export function historicalFixtureBars() {
  const rows = [], end = Date.parse('2026-10-24T00:00:00Z'); let price = 100;
  for (let t = Date.parse('1999-01-01T00:00:00Z'), i = 0; t < end; t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (!isHistoricalTradingDate(day)) continue;
    price *= 1 + .00015 + Math.sin(++i * .17) * .006 + Math.cos(i * .013) * .001;
    rows.push({ t: day, c: price });
  }
  return rows;
}
