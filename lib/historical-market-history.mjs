import { completedCloseCutoff, isHistoricalTradingDate } from './historical-market-calendar.mjs';

export function cleanHistoricalBars(rows, cutoff) {
  const byDay = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const c = row?.c ?? row?.v, t = row?.t;
    if (!isHistoricalTradingDate(t) || t > cutoff || typeof c !== 'number' || !Number.isFinite(c) || c <= 0) continue;
    byDay.set(t, c);
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([t, c]) => ({ t, c }));
}

// Confirmation belongs to the download, never to a later snapshot build.
// Version-one core-cache reuse did not retain trustworthy confirmation metadata.
export function confirmedMarketBars(rows, record, version, cutoff) {
  const collectedAt = version >= 2 ? record?.collectedAtIso : !record?.existingCache ? record?.lastSuccessAt : null;
  if (!Number.isFinite(Date.parse(collectedAt))) return [];
  let through = completedCloseCutoff(collectedAt);
  if (version >= 2) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record?.confirmedThrough || '') || record.confirmedThrough > through) return [];
    through = record.confirmedThrough;
  }
  return cleanHistoricalBars(rows, cutoff && cutoff < through ? cutoff : through);
}
