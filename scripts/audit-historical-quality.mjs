// One-off data check over raw downloads (no store, no network): Yahoo chart
// JSON files and FRED CSVs saved in a folder, read the same way the collector
// reads them, then run the build's data checks and print the study counts.
//
// Usage: node scripts/audit-historical-quality.mjs --dir=<folder> [--json]
//   <folder>/yahoo/<SYMBOL with ^ as _>.json   v8 chart responses
//   <folder>/fred/<ID>.csv                     fredgraph.csv downloads
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HISTORICAL_MARKETS, HISTORICAL_EVENT_MARKETS, HISTORICAL_CONTEXT } from '../lib/historical-sources.mjs';
import { cleanHistoricalBars, cleanLongBars } from '../lib/historical-market-history.mjs';
import { buildHistoricalData } from '../lib/historical-data.mjs';
import { parseFredHistoryCsv } from './collect-historical-sources.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dir = arg('dir');
if (!dir) { console.error('Usage: node scripts/audit-historical-quality.mjs --dir=<folder> [--json]'); process.exit(2); }

// Same date label as loadFreeMarketHistory: the bar's timestamp as a UTC day.
function yahooChartRows(json) {
  const r = json?.chart?.result?.[0], ts = r?.timestamp || [], close = r?.indicators?.quote?.[0]?.close || [];
  return ts.map((t, i) => ({ t: new Date(t * 1000).toISOString().slice(0, 10), v: close[i] })).filter(x => x.v != null);
}
const cutoff = arg('cutoff') || new Date().toISOString().slice(0, 10);
const symbols = {}, records = {}, context = {};
for (const def of [...HISTORICAL_MARKETS, ...HISTORICAL_EVENT_MARKETS]) {
  try {
    const raw = yahooChartRows(JSON.parse(await readFile(resolve(dir, 'yahoo', def.id.replace('^', '_') + '.json'), 'utf8')));
    const rows = (def.long ? cleanLongBars : cleanHistoricalBars)(raw.filter(r => r.t >= (def.since || '1990-01-01')), cutoff);
    const kept = new Set(rows.map(r => r.t));
    const off = [...new Set(raw.map(r => r.t).filter(t => t >= '1990-01-01' && t <= cutoff && !kept.has(t)))].sort();
    symbols[def.id] = rows;
    records[def.id] = { collectedAtIso: `${cutoff}T23:00:00Z`, confirmedThrough: rows.at(-1)?.t, offCalendarRows: off.length, offCalendarSample: off.slice(-5) };
  } catch (e) { records[def.id] = { error: e.message }; }
}
const fredFiles = new Set(await readdir(resolve(dir, 'fred')).catch(() => []));
for (const def of HISTORICAL_CONTEXT) {
  if (!fredFiles.has(def.id + '.csv')) continue;
  try { context[def.id] = { rows: parseFredHistoryCsv(await readFile(resolve(dir, 'fred', def.id + '.csv'), 'utf8'), def.id) }; } catch (e) { records[def.id] = { error: e.message }; }
}
const data = buildHistoricalData({ sourceCache: { version: 2, symbols, records, context, releases: {} }, builtAtIso: `${cutoff}T23:00:00Z`, inputs: { headlineHits: {}, squeezes: [] } });
const years = (sym, id) => data.indexes[sym]?.studies.find(s => s.id === id)?.ranges.all.years.map(e => e.year) || [];
const studies = Object.fromEntries(Object.keys(data.indexes).map(sym => [sym, Object.fromEntries(data.indexes[sym].studies.map(s => [s.id, { n: s.ranges.all.n, first: s.ranges.all.years[0]?.year ?? null, meanPct: s.ranges.all.meanPct, medianPct: s.ranges.all.medianPct, positivePct: s.ranges.all.positivePct }]))]));
const out = { cutoff, quality: data.quality, midterm: { '^GSPC': years('^GSPC', 'midterm'), SPY: years('SPY', 'midterm') }, studies, events: Object.fromEntries(Object.entries(data.events.studies).map(([k, s]) => [k, s.summary?.n ?? s.all?.n ?? s.rows?.length ?? null])) };
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
else {
  console.log(`Data checks: ${data.quality.summary.pass} pass, ${data.quality.summary.warn} watch, ${data.quality.summary.fail} fail`);
  for (const c of data.quality.checks) if (c.status !== 'pass') console.log(`  [${c.status}] ${c.title}: ${c.detail}`);
  console.log(`S&P 500 midterm years (${out.midterm['^GSPC'].length}): ${out.midterm['^GSPC'].join(', ')}`);
  console.log(`SPY midterm years (${out.midterm.SPY.length}): ${out.midterm.SPY.join(', ')}`);
}
