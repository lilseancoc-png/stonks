// Free, bounded downloads only. Invoked inside the existing full bake, never by
// a new scheduled job. Persist this cache before the next data/ wipe.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YahooFinance from 'yahoo-finance2';
import { HISTORICAL_MARKETS, HISTORICAL_EVENT_MARKETS, HISTORICAL_RELEASES, HISTORICAL_CONTEXT, HISTORICAL_SOURCE_KEY, SHARED_FRED_EXTRA, SHARED_FRED_IDS, historicalCoverage, cleanSourceRows } from '../lib/historical-sources.mjs';
import { completedCloseCutoff, historicalTradingDate } from '../lib/historical-market-calendar.mjs';
import { cleanHistoricalBars, cleanLongBars, confirmedMarketBars } from '../lib/historical-market-history.mjs';

export function parseFredHistoryCsv(text, id) {
  const lines = String(text).trim().split(/\r?\n/), header = lines.shift()?.split(',');
  if (!header || !['observation_date','DATE'].includes(header[0]) || header[1] !== id) throw new Error('Unexpected FRED CSV schema');
  return cleanSourceRows(lines.map(line => { const [t, raw] = line.split(','); return { t, v: raw == null || raw.trim() === '' || raw === '.' ? null : Number(raw) }; }));
}
export async function loadFreeFredHistory(id, fetcher = fetch, { signal } = {}) {
  if (!SHARED_FRED_IDS.includes(id)) throw new Error('Unlisted historical source');
  const res = await fetcher(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Stonks historical research)', accept: 'text/csv', referer: 'https://fred.stlouisfed.org/' }, signal: signal || AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
  return parseFredHistoryCsv(await res.text(), id);
}
// Release calendars (CPI, jobs report) from the FRED API. Needs the existing
// FRED_API_KEY; without it the economic-release study shows FOMC days only.
// The key never appears in an error message.
export async function loadFredReleaseDates(id, fetcher = fetch, { signal, apiKey = process.env.FRED_API_KEY } = {}) {
  const def = HISTORICAL_RELEASES.find(r => r.id === id);
  if (!def) throw new Error('Unlisted release calendar');
  if (!apiKey) throw new Error('FRED_API_KEY not set');
  const url = `https://api.stlouisfed.org/fred/release/dates?release_id=${def.releaseId}&api_key=${encodeURIComponent(apiKey)}&file_type=json&include_release_dates_with_no_data=true&sort_order=asc&limit=10000`;
  const res = await fetcher(url, { signal: signal || AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`FRED release HTTP ${res.status}`);
  const body = await res.json();
  const dates = [...new Set((body?.release_dates || []).map(r => r?.date).filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (!dates.length) throw new Error('Release calendar returned no dates');
  return dates;
}
const MARKET_DEFS = [...HISTORICAL_MARKETS, ...HISTORICAL_EVENT_MARKETS];
export async function loadFreeMarketHistory(yahoo, symbol, { signal } = {}) {
  const def = MARKET_DEFS.find(s => s.id === symbol);
  if (!def) throw new Error('Unlisted historical market');
  const result = await yahoo.chart(symbol, { period1: def.since || '1990-01-01', interval: '1d' }, { fetchOptions: { signal: signal || AbortSignal.timeout(15000) } });
  return (result.quotes || []).filter(q => q.close != null).map(q => ({ t: new Date(q.date).toISOString().slice(0, 10), v: q.close }));
}
export async function readHistoricalSourceCache(dataDir) {
  try { return JSON.parse(await readFile(resolve(dataDir, HISTORICAL_SOURCE_KEY), 'utf8')); }
  catch { return { symbols: {}, context: {}, records: {} }; }
}
const RELEASE_REFRESH_DAYS = 7;
export async function refreshHistoricalSourceCache({ previous = {}, builtAtIso = new Date().toISOString(), collectedAtIso = builtAtIso, loadMarket, loadContext, loadRelease, force = false, log = () => {}, budgetMs = 60000, clock = Date.now } = {}) {
  const symbols = {}, context = {}, releases = {}, records = { ...(previous.records || {}) }, today = collectedAtIso.slice(0, 10);
  const confirmedThrough = historicalTradingDate(completedCloseCutoff(collectedAtIso));
  let requests = 0;
  const started = clock();
  const invoke = (loader, id) => loader(id, { signal: AbortSignal.timeout(Math.max(1, Math.min(15000, Math.ceil(budgetMs - (clock() - started))))) });
  const jobs = [];
  // Event-study markets (long S&P 500 / Nasdaq indexes and a few single
  // names) share the market refresh rule. Pre-1990 sessions use the provider's
  // own session list; see cleanLongBars.
  for (const def of MARKET_DEFS) {
    const clean = def.long ? cleanLongBars : cleanHistoricalBars;
    const old = records[def.id];
    const rows = confirmedMarketBars(previous.symbols?.[def.id], old, previous.version, undefined, clean);
    // Migrate direct downloads with their original time. Legacy core reuse was
    // unverified and must be downloaded before it can become a confirmed source.
    records[def.id] = { ...old, lastSuccessAt: rows.length ? old.lastSuccessAt || null : null, collectedAtIso: rows.length ? (old.collectedAtIso || old.lastSuccessAt) : null, confirmedThrough: rows.at(-1)?.t || null };
    if (loadMarket && (force || old?.checkedAt?.slice(0, 10) !== today || old?.checkedThrough !== confirmedThrough)) jobs.push(async () => {
      records[def.id] = { ...records[def.id], checkedAt: collectedAtIso, checkedThrough: confirmedThrough, error: null }; requests++;
      try {
        const result = clean(await invoke(loadMarket, def.id), confirmedThrough);
        if (historicalCoverage(result).status !== 'ready') {
          if (historicalCoverage(symbols[def.id]).status !== 'ready') {
            symbols[def.id] = result;
            records[def.id].collectedAtIso = collectedAtIso;
            records[def.id].confirmedThrough = confirmedThrough;
            records[def.id].existingCache = false;
          }
          throw new Error('Downloaded history did not pass the ten-year coverage check');
        }
        symbols[def.id] = result;
        Object.assign(records[def.id], { lastSuccessAt: collectedAtIso, collectedAtIso, confirmedThrough, existingCache: false });
      } catch (e) { records[def.id].error = String(e.message).slice(0, 180); }
      log(`${def.id}: ${records[def.id].error || 'downloaded'}`);
    });
    symbols[def.id] = rows;
  }
  for (const def of HISTORICAL_CONTEXT) {
    context[def.id] = { rows: cleanSourceRows(previous.context?.[def.id]?.rows || []) };
    if (loadContext && (force || records[def.id]?.checkedAt?.slice(0, 10) !== today)) jobs.push(async () => {
      const old = records[def.id]; records[def.id] = { ...old, checkedAt: collectedAtIso, error: null }; requests++;
      try {
        const rows = cleanSourceRows(await invoke(loadContext, def.id));
        if (historicalCoverage(rows, def.frequency).status !== 'ready') {
          if (historicalCoverage(context[def.id].rows, def.frequency).status !== 'ready') context[def.id] = { rows };
          throw new Error('Downloaded history did not pass the ten-year coverage check');
        }
        context[def.id] = { rows }; records[def.id].lastSuccessAt = collectedAtIso;
      } catch (e) { records[def.id].error = String(e.message).slice(0, 180); }
      log(`${def.id}: ${records[def.id].error || 'downloaded'}`);
    });
  }
  // Release calendars change a few times a year: one check a week. A failed
  // check keeps the last good dates.
  for (const def of HISTORICAL_RELEASES) {
    const key = `release:${def.id}`, prior = previous.releases?.[def.id];
    releases[def.id] = { dates: Array.isArray(prior?.dates) ? prior.dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [] };
    const last = Date.parse(records[key]?.checkedAt || '');
    if (loadRelease && (force || !Number.isFinite(last) || Date.parse(collectedAtIso) - last >= RELEASE_REFRESH_DAYS * 86400000)) jobs.push(async () => {
      records[key] = { ...records[key], checkedAt: collectedAtIso, error: null }; requests++;
      try { releases[def.id] = { dates: await invoke(loadRelease, def.id) }; records[key].lastSuccessAt = collectedAtIso; }
      catch (e) { records[key].error = String(e.message).slice(0, 180); }
      log(`${key}: ${records[key].error || 'downloaded'}`);
    });
  }
  // Shorter shared series (Bottom tracker credit spreads): same daily cadence,
  // kept when the download has any rows; a failed day keeps the last good rows.
  // Queued ahead of the long downloads: the Bottom tracker's credit gate needs
  // them, and they must not be the jobs the time budget defers.
  const sharedJobs = [];
  for (const def of SHARED_FRED_EXTRA) {
    context[def.id] = { rows: cleanSourceRows(previous.context?.[def.id]?.rows || []) };
    if (loadContext && (force || records[def.id]?.checkedAt?.slice(0, 10) !== today)) sharedJobs.push(async () => {
      const old = records[def.id]; records[def.id] = { ...old, checkedAt: collectedAtIso, error: null }; requests++;
      try {
        const rows = cleanSourceRows(await invoke(loadContext, def.id));
        if (!rows.length) throw new Error('Download returned no observations');
        context[def.id] = { rows }; records[def.id].lastSuccessAt = collectedAtIso;
      } catch (e) { records[def.id].error = String(e.message).slice(0, 180); }
      log(`${def.id}: ${records[def.id].error || 'downloaded'}`);
    });
  }
  jobs.unshift(...sharedJobs);
  // Two outstanding downloads. Markets can retry after a newly completed
  // session; a failed attempt at that same target waits until the next UTC day.
  let cursor = 0;
  await Promise.all([0, 1].map(async () => { while (cursor < jobs.length && clock() - started < budgetMs) await jobs[cursor++](); }));
  return { version: 2, builtAtIso, symbols, context, releases, records, cost: { providerFeeUsd: 0, requestsThisRun: requests, deferredSources: jobs.length - cursor, refreshBudgetMs: budgetMs, maxRequestsPerDay: 2 * MARKET_DEFS.length + HISTORICAL_CONTEXT.length + SHARED_FRED_EXTRA.length + HISTORICAL_RELEASES.length, newScheduledJobs: 0, aiCalls: 0 } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
  await mkdir(dataDir, { recursive: true });
  const previous = await readHistoricalSourceCache(dataDir);
  const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  const cache = await refreshHistoricalSourceCache({ previous, force: process.argv.includes('--force'), log: console.log,
    loadMarket: (symbol, request) => loadFreeMarketHistory(yahoo, symbol, request),
    loadContext: (id, request) => loadFreeFredHistory(id, fetch, request),
    loadRelease: process.env.FRED_API_KEY ? (id, request) => loadFredReleaseDates(id, fetch, request) : undefined,
  });
  await writeFile(resolve(dataDir, HISTORICAL_SOURCE_KEY), JSON.stringify(cache));
  console.log(JSON.stringify({ requests: cache.cost.requestsThisRun, markets: Object.values(cache.symbols).filter(r => historicalCoverage(r).status === 'ready').length, context: Object.entries(cache.context).filter(([id, v]) => historicalCoverage(v.rows, HISTORICAL_CONTEXT.find(d => d.id === id).frequency).status === 'ready').length, providerFeeUsd: 0 }));
}
