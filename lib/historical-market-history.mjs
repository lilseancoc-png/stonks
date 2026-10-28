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

// Long index histories (S&P 500 since 1950, Nasdaq since 1971) predate the
// 1990 research calendar. Before 1990 only weekends are rejected; the provider's
// own session list stands in for the holiday calendar. From 1990 the same
// calendar rule as cleanHistoricalBars applies.
export function cleanLongBars(rows, cutoff) {
  const byDay = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const c = row?.c ?? row?.v, t = row?.t;
    if (typeof t !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t) || t > cutoff || typeof c !== 'number' || !Number.isFinite(c) || c <= 0) continue;
    const day = new Date(`${t}T00:00:00Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== t) continue;
    if (t >= '1990-01-01' ? !isHistoricalTradingDate(t) : [0, 6].includes(day.getUTCDay())) continue;
    byDay.set(t, c);
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([t, c]) => ({ t, c }));
}

// Confirmation belongs to the download, never to a later snapshot build.
// Version-one core-cache reuse did not retain trustworthy confirmation metadata.
export function confirmedMarketBars(rows, record, version, cutoff, clean = cleanHistoricalBars) {
  const collectedAt = version >= 2 ? record?.collectedAtIso : !record?.existingCache ? record?.lastSuccessAt : null;
  if (!Number.isFinite(Date.parse(collectedAt))) return [];
  let through = completedCloseCutoff(collectedAt);
  if (version >= 2) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record?.confirmedThrough || '') || record.confirmedThrough > through) return [];
    through = record.confirmedThrough;
  }
  return clean(rows, cutoff && cutoff < through ? cutoff : through);
}
