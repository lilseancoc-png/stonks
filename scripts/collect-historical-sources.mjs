// Free, bounded downloads only. Invoked inside the existing full bake, never by
// a new scheduled job. Persist this cache before the next data/ wipe.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YahooFinance from 'yahoo-finance2';
import { HISTORICAL_MARKETS, HISTORICAL_CONTEXT, HISTORICAL_SOURCE_KEY, historicalCoverage, cleanSourceRows } from '../lib/historical-sources.mjs';
import { completedCloseCutoff, historicalTradingDate } from '../lib/historical-market-calendar.mjs';
import { cleanHistoricalBars, confirmedMarketBars } from '../lib/historical-market-history.mjs';

export function parseFredHistoryCsv(text, id) {
  const lines = String(text).trim().split(/\r?\n/), header = lines.shift()?.split(',');
  if (!header || !['observation_date','DATE'].includes(header[0]) || header[1] !== id) throw new Error('Unexpected FRED CSV schema');
  return cleanSourceRows(lines.map(line => { const [t, raw] = line.split(','); return { t, v: raw == null || raw.trim() === '' || raw === '.' ? null : Number(raw) }; }));
}
export async function loadFreeFredHistory(id, fetcher = fetch, { signal } = {}) {
  if (!HISTORICAL_CONTEXT.some(s => s.id === id)) throw new Error('Unlisted historical source');
  const res = await fetcher(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Stonks historical research)', accept: 'text/csv', referer: 'https://fred.stlouisfed.org/' }, signal: signal || AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
  return parseFredHistoryCsv(await res.text(), id);
}
export async function loadFreeMarketHistory(yahoo, symbol, { signal } = {}) {
  if (!HISTORICAL_MARKETS.some(s => s.id === symbol)) throw new Error('Unlisted historical market');
  const result = await yahoo.chart(symbol, { period1: '1990-01-01', interval: '1d' }, { fetchOptions: { signal: signal || AbortSignal.timeout(15000) } });
  return (result.quotes || []).filter(q => q.close != null).map(q => ({ t: new Date(q.date).toISOString().slice(0, 10), v: q.close }));
}
export async function readHistoricalSourceCache(dataDir) {
  try { return JSON.parse(await readFile(resolve(dataDir, HISTORICAL_SOURCE_KEY), 'utf8')); }
  catch { return { symbols: {}, context: {}, records: {} }; }
}
export async function refreshHistoricalSourceCache({ previous = {}, builtAtIso = new Date().toISOString(), collectedAtIso = builtAtIso, loadMarket, loadContext, force = false, log = () => {}, budgetMs = 60000, clock = Date.now } = {}) {
  const symbols = {}, context = {}, records = { ...(previous.records || {}) }, today = collectedAtIso.slice(0, 10);
  const confirmedThrough = historicalTradingDate(completedCloseCutoff(collectedAtIso));
  let requests = 0;
  const started = clock();
  const invoke = (loader, id) => loader(id, { signal: AbortSignal.timeout(Math.max(1, Math.min(15000, Math.ceil(budgetMs - (clock() - started))))) });
  const jobs = [];
  for (const def of HISTORICAL_MARKETS) {
    const old = records[def.id];
    const rows = confirmedMarketBars(previous.symbols?.[def.id], old, previous.version);
    // Migrate direct downloads with their original time. Legacy core reuse was
    // unverified and must be downloaded before it can become a confirmed source.
    records[def.id] = { ...old, lastSuccessAt: rows.length ? old.lastSuccessAt || null : null, collectedAtIso: rows.length ? (old.collectedAtIso || old.lastSuccessAt) : null, confirmedThrough: rows.at(-1)?.t || null };
    if (loadMarket && (force || old?.checkedAt?.slice(0, 10) !== today || old?.checkedThrough !== confirmedThrough)) jobs.push(async () => {
      records[def.id] = { ...records[def.id], checkedAt: collectedAtIso, checkedThrough: confirmedThrough, error: null }; requests++;
      try {
        const result = cleanHistoricalBars(await invoke(loadMarket, def.id), confirmedThrough);
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
  // Two outstanding downloads. Markets can retry after a newly completed
  // session; a failed attempt at that same target waits until the next UTC day.
  let cursor = 0;
  await Promise.all([0, 1].map(async () => { while (cursor < jobs.length && clock() - started < budgetMs) await jobs[cursor++](); }));
  return { version: 2, builtAtIso, symbols, context, records, cost: { providerFeeUsd: 0, requestsThisRun: requests, deferredSources: jobs.length - cursor, refreshBudgetMs: budgetMs, maxRequestsPerDay: 2 * HISTORICAL_MARKETS.length + HISTORICAL_CONTEXT.length, newScheduledJobs: 0, aiCalls: 0 } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
  await mkdir(dataDir, { recursive: true });
  const previous = await readHistoricalSourceCache(dataDir);
  const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  const cache = await refreshHistoricalSourceCache({ previous, force: process.argv.includes('--force'), log: console.log,
    loadMarket: (symbol, request) => loadFreeMarketHistory(yahoo, symbol, request),
    loadContext: (id, request) => loadFreeFredHistory(id, fetch, request),
  });
  await writeFile(resolve(dataDir, HISTORICAL_SOURCE_KEY), JSON.stringify(cache));
  console.log(JSON.stringify({ requests: cache.cost.requestsThisRun, markets: Object.values(cache.symbols).filter(r => historicalCoverage(r).status === 'ready').length, context: Object.entries(cache.context).filter(([id, v]) => historicalCoverage(v.rows, HISTORICAL_CONTEXT.find(d => d.id === id).frequency).status === 'ready').length, providerFeeUsd: 0 }));
}
