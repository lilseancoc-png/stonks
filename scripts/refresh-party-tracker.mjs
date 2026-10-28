// Downloads adjusted ETF history and writes the Owner Party tracker.
// The bake calls refreshPartyTracker with the shared Yahoo client. Running
// this file directly writes data/party-tracker.json for a local check.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PARTY_SERIES,
  PARTY_TRACKER_KEY,
  barsFromChart,
  buildPartyTracker,
  emptyPartyTracker,
  priorPartyTrackerUsable,
  refreshReady,
} from '../lib/party-tracker.mjs';

export async function readPartyTracker(dataDir) {
  try { return JSON.parse(await readFile(resolve(dataDir, PARTY_TRACKER_KEY), 'utf8')); }
  catch { return null; }
}

export async function writePartyTracker(dataDir, payload) {
  await writeFile(resolve(dataDir, PARTY_TRACKER_KEY), JSON.stringify(payload) + '\n', 'utf8');
}

export async function fetchPartyBars(yahoo, symbol, since) {
  const result = await yahoo.chart(symbol, { period1: since, interval: '1d' }, { fetchOptions: { signal: AbortSignal.timeout(20000) } });
  return barsFromChart(result);
}

async function mapPool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

export async function refreshPartyTracker({ prior = null, builtAtIso, fetchSeries } = {}) {
  if (typeof fetchSeries !== 'function') throw new Error('Party tracker needs a price fetch');
  const series = {};
  const errors = [];
  let adjusted = 0;
  let closeOnly = 0;
  await mapPool(PARTY_SERIES, 4, async (def) => {
    try {
      const loaded = await fetchSeries(def.id, def.since);
      const parsed = loaded?.rows ? loaded : { rows: loaded, adjusted: 0, closeOnly: 0 };
      if (!Array.isArray(parsed.rows) || parsed.rows.length < 2) throw new Error('not enough prices');
      series[def.id] = parsed.rows;
      adjusted += parsed.adjusted || 0;
      closeOnly += parsed.closeOnly || 0;
    } catch (err) {
      errors.push({ id: def.id, message: String(err?.message || err).slice(0, 180) });
    }
  });
  if (!series.SPY) {
    if (priorPartyTrackerUsable(prior)) {
      return { ...prior, builtAtIso, carriedForward: true, errors };
    }
    return emptyPartyTracker(builtAtIso, errors.find((item) => item.id === 'SPY')?.message || 'S&P 500 history could not be downloaded.');
  }
  const payload = buildPartyTracker({ series, builtAtIso });
  payload.errors = errors;
  if (closeOnly > 0 && adjusted === 0) {
    payload.methodology = payload.methodology.concat('This run used Yahoo closes without a separate adjusted-close field, so cash dividends may be missing.');
  }
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const YahooFinance = (await import('yahoo-finance2')).default;
  const yahoo = new YahooFinance({
    suppressNotices: ['yahooSurvey'],
    validation: { logErrors: false },
    fetchOptions: { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' } },
  });
  const dataDir = resolve(process.argv[2] || 'data');
  const prior = await readPartyTracker(dataDir);
  const payload = await refreshPartyTracker({
    prior,
    builtAtIso: new Date().toISOString(),
    fetchSeries: (symbol, since) => fetchPartyBars(yahoo, symbol, since),
  });
  await writePartyTracker(dataDir, payload);
  const president = payload.offices?.find((office) => office.id === 'president');
  console.log(JSON.stringify({
    asOf: payload.asOf || null,
    carriedForward: payload.carriedForward === true,
    error: payload.error || null,
    president: president?.parties || null,
    errors: payload.errors || [],
    ready: refreshReady(payload),
  }, null, 2));
}
