#!/usr/bin/env node
// Owner Sports data job. Downloads free public game data and writes JSON
// records under `_stonks/sports/v1/` in the private store. Run daily by
// .github/workflows/sports-data.yml; never touches data/ or the repo.
//
//   node scripts/sports-ingest.mjs --sport=nfl              # needs R2_* env
//   node scripts/sports-ingest.mjs --sport=nba --dry-run    # fetch + check, write nothing
//   node scripts/sports-ingest.mjs --sport=nfl --source-dir=DIR --dry-run
//       reads the provider files (same file names as the release URLs) from
//       DIR instead of the network (offline checks)
//
// Logs carry counts and status only; the workflow log is public.
import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { ingestLeague } from '../lib/sports/ingest.mjs';
import { LEAGUE_SOURCES } from '../lib/sports/leagues.mjs';

const MAX_BYTES = 80 * 1024 * 1024;
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
  if (!m) throw new Error('unknown argument ' + a);
  return [m[1], m[2] ?? true];
}));

// NBA.com's public box-score files (cdn.nba.com, the cross-check) refuse a
// request that does not look like its own site's page reading them, so those
// get a browser's headers with nba.com as the page; everything else keeps the
// plain research User-Agent.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
export function headersFor(url) {
  const host = new URL(url).hostname;
  if (host === 'cdn.nba.com' || host.endsWith('.nba.com')) {
    return { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nba.com/', Origin: 'https://www.nba.com' };
  }
  return { 'User-Agent': 'stonks-sports-research (private, non-commercial)' };
}
export async function fetchText(url, { attempts = 3, fetchImpl = fetch } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl(url, { redirect: 'follow', headers: headersFor(url), signal: AbortSignal.timeout(90000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${basename(new URL(url).pathname)}`);
      const len = Number(res.headers.get('content-length') || 0);
      if (len > MAX_BYTES) throw new Error('download is larger than the size ceiling');
      const text = await res.text();
      if (text.length > MAX_BYTES) throw new Error('download is larger than the size ceiling');
      return text;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
  throw lastErr;
}

function localFetcher(dir) {
  return async (url) => {
    const name = basename(new URL(url).pathname);
    try { return await readFile(resolve(dir, name), 'utf8'); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  };
}

async function main() {
  const sport = args.sport;
  const adapter = LEAGUE_SOURCES[sport];
  if (!adapter) throw new Error('--sport must be nfl or nba');
  const dryRun = args['dry-run'] === true;
  let store;
  if (dryRun) {
    // Dry runs never need credentials: reads come back empty, writes are refused.
    store = { rawGet: async () => null, rawPut: async () => { throw new Error('dry run must not write'); }, backend: 'dry-run' };
  } else {
    store = (await import('../lib/datastore.mjs')).store;
    if (store.backend !== 'r2') throw new Error('Sports records need the R2 store (set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)');
  }
  const fetcher = args['source-dir'] ? localFetcher(String(args['source-dir'])) : (url) => fetchText(url);
  const result = await ingestLeague({ adapter, store, fetchText: fetcher, log: (m) => console.log(m), dryRun });
  for (const w of result.writes) console.log(`${dryRun ? 'would write' : 'wrote'} ${w.key.replace(/^_stonks\/sports\/v1\//, '')} (${Math.round(w.bytes / 1024)} KB)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('sports ingest failed:', err?.message || err);
    process.exit(1);
  });
}
