// Hourly unusual-options-flow scanner. Sweeps the curated ticker universe
// during US market hours and flags option contracts where today's volume
// dwarfs the open interest — the classic "fresh positioning" signal that
// often surfaces informed flow or large hedges.
//
// Threshold: volume >= 2000 AND volume / max(oi, 1) >= 2, within ±50% of spot.
// Scope: front 3 expirations per ticker (near-dated where flow concentrates).
//
// Writes data/unusual.json (current snapshot) and data/unusual-history.json
// (rolling window of recent snapshots, used for hour-over-hour spike tagging).
// Invoked by .github/workflows/unusual-flow.yml at the top of every hour
// 14:00-21:00 UTC Mon-Fri.
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YahooFinance from "yahoo-finance2";
import { TICKERS } from "./build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");

const STRIKE_BAND = 0.50;
const FRONT_EXPIRATIONS = 3;
const MIN_VOLUME = 2000;
const MIN_RATIO = 2;
const POLITENESS_MS = 250;
// Rolling per-hour snapshot history used for hour-over-hour volume-spike
// detection. 8 snapshots covers a full 9am-4pm ET session at hourly cadence.
const HISTORY_FILE = "unusual-history.json";
const HISTORY_MAX_SNAPSHOTS = 8;
// A "spike" is current vol >= 3x prior-snapshot vol, with an absolute floor
// so small contracts (e.g. 50 -> 200) don't trip the label.
const SPIKE_RATIO = 3;
const SPIKE_ABS_FLOOR = 1000;
// Yahoo intermittently 401s GitHub Actions runners ("Host not in allowlist")
// or rate-limits after a burst — match build.mjs's retry pattern.
const FETCH_RETRIES = 3;
const FETCH_BACKOFF_MS = [1000, 3000, 8000];
// ETFs trade enormous volume on small "OI" relative to single names — keep
// them in scope but they'll mostly self-filter out of the loudest hits.
const EXCLUDE_FROM_SCAN = new Set([]);

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
  fetchOptions: {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  },
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientYahooError(err) {
  const msg = String(err?.message || err || "");
  if (/allowlist|401|403|429|5\d\d|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(msg)) return true;
  if (/validation|schema|FailedYahooValidationError/i.test(msg)) return false;
  return true;
}

async function fetchOptionsWithRetry(symbol, opts) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const result = await yahooFinance.options(symbol, opts);
      if (attempt > 1) console.log(`    ↻ ${symbol} succeeded on attempt ${attempt}`);
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt === FETCH_RETRIES || !isTransientYahooError(err)) break;
      const wait = FETCH_BACKOFF_MS[attempt - 1] ?? 8000;
      console.log(`    ↻ ${symbol} attempt ${attempt} failed (${err.message}) — retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function compressHit(symbol, side, c, expSec, scannedAt, prevVolLookup) {
  const vol = c.volume ?? 0;
  const oi = c.openInterest ?? 0;
  const ratio = vol / Math.max(oi, 1);
  const last = c.lastPrice ?? null;
  // Option premium in dollars: vol * last * 100 (each contract = 100 shares).
  const premium = (last != null && vol > 0) ? Math.round(vol * last * 100) : null;
  const prevVol = prevVolLookup
    ? prevVolLookup.get(`${symbol}|${side}|${c.strike}|${expSec}`)
    : null;
  const spikeRatio = (prevVol != null && prevVol > 0) ? vol / prevVol : null;
  const isSpike =
    spikeRatio != null && spikeRatio >= SPIKE_RATIO && (vol - prevVol) >= SPIKE_ABS_FLOOR;
  return {
    symbol,
    side,
    strike: c.strike,
    expSec,
    vol,
    oi,
    ratio: Math.round(ratio * 10) / 10,
    last,
    premium,
    iv: c.impliedVolatility ?? null,
    prevVol: prevVol ?? null,
    spikeRatio: spikeRatio != null ? Math.round(spikeRatio * 10) / 10 : null,
    isSpike,
    scannedAt,
  };
}

async function loadUnusualHistory() {
  try {
    const raw = await readFile(resolve(DATA_DIR, HISTORY_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.snapshots)) return parsed;
    return { snapshots: [] };
  } catch {
    return { snapshots: [] };
  }
}

// Flattens the most recent snapshot's hits into a vol-lookup map keyed by
// the contract-identity tuple. Returned null when there's no prior snapshot
// (first run after deploy, or the file was wiped).
function buildPrevVolLookup(history) {
  const last = history?.snapshots?.[history.snapshots.length - 1];
  if (!last || !Array.isArray(last.hits)) return null;
  const map = new Map();
  for (const h of last.hits) {
    if (h.symbol == null || h.strike == null || h.expSec == null) continue;
    map.set(`${h.symbol}|${h.side}|${h.strike}|${h.expSec}`, h.vol ?? 0);
  }
  return map;
}

async function scanTicker(symbol, scannedAt, prevVolLookup) {
  // First call: nearest expiration + the full expirationDates list. Reuse its
  // chain so we don't repeat the same Yahoo call when iterating expirations.
  const first = await fetchOptionsWithRetry(symbol);
  const spot =
    first.quote?.regularMarketPrice ??
    first.quote?.postMarketPrice ??
    first.quote?.preMarketPrice ??
    null;
  if (spot == null) return null;
  const marketState = first.quote?.marketState ?? null;
  const minK = spot * (1 - STRIKE_BAND);
  const maxK = spot * (1 + STRIKE_BAND);
  const inBand = (c) => c.strike != null && c.strike >= minK && c.strike <= maxK;

  const expirationDates = Array.isArray(first.expirationDates) ? first.expirationDates : [];
  const expirations = expirationDates.slice(0, FRONT_EXPIRATIONS);

  const hits = [];
  const firstEntry = first.options?.[0];
  const firstExpSec = firstEntry?.expirationDate
    ? Math.round(new Date(firstEntry.expirationDate).getTime() / 1000)
    : null;
  const scanEntry = (entry, expSec) => {
    for (const c of entry.calls || []) {
      if (!inBand(c)) continue;
      const vol = c.volume ?? 0;
      const oi = c.openInterest ?? 0;
      if (vol >= MIN_VOLUME && vol / Math.max(oi, 1) >= MIN_RATIO) {
        hits.push(compressHit(symbol, "call", c, expSec, scannedAt, prevVolLookup));
      }
    }
    for (const c of entry.puts || []) {
      if (!inBand(c)) continue;
      const vol = c.volume ?? 0;
      const oi = c.openInterest ?? 0;
      if (vol >= MIN_VOLUME && vol / Math.max(oi, 1) >= MIN_RATIO) {
        hits.push(compressHit(symbol, "put", c, expSec, scannedAt, prevVolLookup));
      }
    }
  };
  if (firstEntry && firstExpSec) scanEntry(firstEntry, firstExpSec);

  // Walk additional expirations (skip the first since `options(symbol)` with
  // no date returned it already).
  for (let i = 1; i < expirations.length; i++) {
    const d = expirations[i];
    await sleep(POLITENESS_MS);
    try {
      const r = await fetchOptionsWithRetry(symbol, { date: d });
      const entry = r.options?.[0];
      if (!entry) continue;
      const expSec = entry.expirationDate
        ? Math.round(new Date(entry.expirationDate).getTime() / 1000)
        : Math.round(d.getTime() / 1000);
      scanEntry(entry, expSec);
    } catch (err) {
      console.log(`    · ${symbol} expiration ${d.toISOString().slice(0, 10)} failed: ${err.message}`);
    }
  }

  hits.sort((a, b) => b.ratio - a.ratio);
  return { symbol, spot, marketState, hits };
}

async function main() {
  const scannedAt = new Date().toISOString();
  // Load prior snapshots BEFORE the scan so each hit can be tagged with its
  // hour-over-hour spike status as it's computed. First-run history is just
  // an empty container; lookup will be null and no contracts will be flagged
  // as spikes until the second hourly snapshot lands.
  const history = await loadUnusualHistory();
  const prevVolLookup = buildPrevVolLookup(history);
  console.log(
    `Scanning ${TICKERS.length} tickers for unusual options flow…` +
      (prevVolLookup ? ` (spike comparison vs ${prevVolLookup.size} prior contracts)` : " (no prior snapshot — spike tagging skipped)"),
  );
  const tickerRows = [];
  let firstMarketState = null;
  let scannedCount = 0;
  let failedCount = 0;

  for (const symbol of TICKERS) {
    if (EXCLUDE_FROM_SCAN.has(symbol)) continue;
    try {
      const result = await scanTicker(symbol, scannedAt, prevVolLookup);
      if (!result) {
        failedCount++;
        continue;
      }
      scannedCount++;
      if (!firstMarketState && result.marketState) firstMarketState = result.marketState;
      if (result.hits.length) {
        tickerRows.push({
          symbol: result.symbol,
          spot: result.spot,
          topRatio: result.hits[0].ratio,
          contracts: result.hits,
        });
        console.log(`  ✓ ${symbol} — ${result.hits.length} hit${result.hits.length === 1 ? "" : "s"}, top ${result.hits[0].ratio.toFixed(1)}x (${result.hits[0].side} $${result.hits[0].strike})`);
      } else {
        console.log(`  · ${symbol} — no unusual flow`);
      }
    } catch (err) {
      failedCount++;
      console.log(`  ✗ ${symbol} — ${err.message}`);
    }
    await sleep(POLITENESS_MS);
  }

  tickerRows.sort((a, b) => b.topRatio - a.topRatio);
  const contractCount = tickerRows.reduce((sum, t) => sum + t.contracts.length, 0);
  const hottestRatio = tickerRows[0]?.topRatio ?? 0;

  const payload = {
    scannedAt,
    marketState: firstMarketState,
    summary: {
      tickerCount: tickerRows.length,
      contractCount,
      hottestRatio,
      scanned: scannedCount,
      failed: failedCount,
    },
    tickers: tickerRows,
  };

  await mkdir(DATA_DIR, { recursive: true });
  const outPath = resolve(DATA_DIR, "unusual.json");
  await writeFile(outPath, JSON.stringify(payload), "utf8");
  console.log(
    `wrote ${outPath} — ${tickerRows.length} ticker${tickerRows.length === 1 ? "" : "s"}, ${contractCount} contract${contractCount === 1 ? "" : "s"} flagged${hottestRatio ? `, hottest ${hottestRatio.toFixed(1)}x` : ""}`,
  );

  // Append this scan to history and trim. Each entry stores only the keying
  // tuple + vol so the file stays small (tens of KB across the full window).
  history.snapshots.push({
    scannedAt,
    hits: tickerRows.flatMap((t) =>
      t.contracts.map((c) => ({
        symbol: c.symbol,
        side: c.side,
        strike: c.strike,
        expSec: c.expSec,
        vol: c.vol,
      })),
    ),
  });
  history.snapshots = history.snapshots.slice(-HISTORY_MAX_SNAPSHOTS);
  const historyPath = resolve(DATA_DIR, HISTORY_FILE);
  await writeFile(historyPath, JSON.stringify(history), "utf8");
  const spikeCount = tickerRows.reduce(
    (sum, t) => sum + t.contracts.filter((c) => c.isSpike).length,
    0,
  );
  console.log(
    `wrote ${historyPath} — ${history.snapshots.length}/${HISTORY_MAX_SNAPSHOTS} snapshot${history.snapshots.length === 1 ? "" : "s"} retained${spikeCount ? `, ${spikeCount} spike${spikeCount === 1 ? "" : "s"} tagged this run` : ""}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
