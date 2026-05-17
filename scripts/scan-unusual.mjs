// Hourly unusual-options-flow scanner. Sweeps the curated ticker universe
// during US market hours and flags option contracts where a meaningful
// block of volume hit the tape inside the last hour — the kind of
// directional, single-shot activity that often signals informed flow.
//
// Criteria (all must hold):
//   1. OTM band: 5% <= |strike - spot|/spot <= 30% (directional bets, not
//      ITM hedges or far-OTM lottos).
//   2. Volume > open interest (the classic baseline "unusual" signal).
//   3. Hourly delta gate, scaled by days-to-expiry:
//        - DTE <= 14 (near-term): vol - prevVol >= 4000
//        - DTE > 14 (further out): vol - prevVol >= 2000
//   4. A prior snapshot exists for that contract. First scan of the day
//      produces no hits — we wait one hour so a real delta can be measured.
//
// Each hit is tagged with a "tape" string (ask/abv/mid/blw/bid) derived
// from where the last print sat relative to bid/ask, as a read-the-tape
// hint for execution context. Informational only.
//
// Writes data/unusual.json (current snapshot) and data/unusual-history.json
// (rolling window of recent snapshots — stores per-contract volume for
// every in-band candidate, not just flagged hits, so the next scan can
// compute deltas for contracts that weren't flagged last hour).
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

// Strike scan band is tighter than the OTM-flag band so we still see a few
// ITM strikes for context, but only OTM 5–30% can actually flag.
const STRIKE_BAND = 0.35;
const FRONT_EXPIRATIONS = 3;
const OTM_MIN = 0.05;
const OTM_MAX = 0.30;
const DTE_NEAR_DAYS = 14;
const DELTA_NEAR = 4000;
const DELTA_FAR = 2000;
// Minimum vol to bother persisting a contract in history. Skips dead
// contracts and keeps history file size reasonable.
const HISTORY_MIN_VOL = 50;
const POLITENESS_MS = 250;
// Rolling per-hour snapshot history used to compute hour-over-hour volume
// deltas. 8 snapshots covers a full 9am-4pm ET session at hourly cadence.
const HISTORY_FILE = "unusual-history.json";
const HISTORY_MAX_SNAPSHOTS = 8;
// Long-running log of every flagged hit across hourly scans. Used to surface
// "repeat conviction" — contracts that flag in multiple scans across days,
// which is a much stronger informed-flow signal than a one-off block. Pruned
// to a 7-day calendar window (covers ~5 trading days plus a weekend).
const LOG_FILE = "unusual-log.json";
const LOG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Flag the "🔥 ×N" repeat badge on the UI when a contract has been flagged
// at least this many times in the window.
const REPEAT_MIN = 2;
// Yahoo intermittently 401s GitHub Actions runners ("Host not in allowlist")
// or rate-limits after a burst — match build.mjs's retry pattern.
const FETCH_RETRIES = 3;
const FETCH_BACKOFF_MS = [1000, 3000, 8000];
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

// Where did the last trade sit relative to the current bid/ask? "ask" means
// buyers were lifting offers (scrambling in), "bid" means sellers were
// hitting bids. Returns null when quotes are missing or the spread is
// degenerate (e.g. crossed market, illiquid contract).
function tapeTag(bid, ask, last) {
  if (bid == null || ask == null || last == null) return null;
  const spread = ask - bid;
  if (!(spread > 0)) return null;
  const eps = Math.max(0.01, spread * 0.05);
  const mid = (bid + ask) / 2;
  if (last >= ask - eps) return "ask";
  if (last <= bid + eps) return "bid";
  if (Math.abs(last - mid) <= eps) return "mid";
  return last > mid ? "abv" : "blw";
}

// Compresses one in-band contract into the candidate record that's used
// both for flagging logic AND persisted to history. Returns the raw record
// (no flag decision); caller filters on whether `flagged` is true.
function buildCandidate(symbol, side, c, expSec, scannedAt, spot, prevVolLookup, nowMs) {
  const vol = c.volume ?? 0;
  const oi = c.openInterest ?? 0;
  const strike = c.strike;
  if (strike == null) return null;
  const otmPct = side === "call" ? (strike - spot) / spot : (spot - strike) / spot;
  const dte = Math.max(0, Math.round((expSec * 1000 - nowMs) / 86400000));
  const last = c.lastPrice ?? null;
  const bid = c.bid ?? null;
  const ask = c.ask ?? null;
  const prevVol = prevVolLookup
    ? prevVolLookup.get(`${symbol}|${side}|${strike}|${expSec}`)
    : null;
  const havePrev = prevVol != null;
  const deltaVol = havePrev ? vol - prevVol : null;
  const deltaThreshold = dte <= DTE_NEAR_DAYS ? DELTA_NEAR : DELTA_FAR;

  // Flag check — all four conditions must hold.
  const flagged =
    havePrev &&
    deltaVol >= deltaThreshold &&
    vol > oi &&
    otmPct >= OTM_MIN &&
    otmPct <= OTM_MAX;

  // Option premium in dollars: vol * last * 100 (each contract = 100 shares).
  const premium = (last != null && vol > 0) ? Math.round(vol * last * 100) : null;
  const tape = tapeTag(bid, ask, last);

  return {
    symbol,
    side,
    strike,
    expSec,
    vol,
    oi,
    last,
    bid,
    ask,
    iv: c.impliedVolatility ?? null,
    prevVol: havePrev ? prevVol : null,
    deltaVol,
    otmPct: Math.round(otmPct * 1000) / 1000,
    dte,
    premium,
    tape,
    flagged,
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

async function loadUnusualLog() {
  try {
    const raw = await readFile(resolve(DATA_DIR, LOG_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.entries)) return parsed;
    return { entries: [] };
  } catch {
    return { entries: [] };
  }
}

// Build a lookup from the persisted log: contract-key -> {count, lastSeen}.
// Counts how many distinct scans flagged each contract within the window,
// so the UI can render a "🔥 ×N" repeat-conviction badge inline.
function buildRepeatLookup(log, nowMs) {
  const cutoff = nowMs - LOG_WINDOW_MS;
  const map = new Map();
  for (const e of log.entries || []) {
    const t = Date.parse(e.scannedAt || "");
    if (!Number.isFinite(t) || t < cutoff) continue;
    const key = `${e.symbol}|${e.side}|${e.strike}|${e.expSec}`;
    const prior = map.get(key);
    if (!prior) {
      map.set(key, { count: 1, lastSeen: e.scannedAt });
    } else {
      prior.count += 1;
      if (Date.parse(e.scannedAt) > Date.parse(prior.lastSeen)) prior.lastSeen = e.scannedAt;
    }
  }
  return map;
}

// Flattens the most recent snapshot's per-contract volumes into a lookup
// keyed by contract identity tuple. Returns null when there's no prior
// snapshot (first run after deploy, or file wiped).
function buildPrevVolLookup(history) {
  const last = history?.snapshots?.[history.snapshots.length - 1];
  if (!last || !Array.isArray(last.contracts)) return null;
  const map = new Map();
  for (const h of last.contracts) {
    if (h.symbol == null || h.strike == null || h.expSec == null) continue;
    map.set(`${h.symbol}|${h.side}|${h.strike}|${h.expSec}`, h.vol ?? 0);
  }
  return map;
}

async function scanTicker(symbol, scannedAt, prevVolLookup, nowMs) {
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

  const candidates = [];
  const firstEntry = first.options?.[0];
  const firstExpSec = firstEntry?.expirationDate
    ? Math.round(new Date(firstEntry.expirationDate).getTime() / 1000)
    : null;
  const scanEntry = (entry, expSec) => {
    for (const c of entry.calls || []) {
      if (!inBand(c)) continue;
      const rec = buildCandidate(symbol, "call", c, expSec, scannedAt, spot, prevVolLookup, nowMs);
      if (rec) candidates.push(rec);
    }
    for (const c of entry.puts || []) {
      if (!inBand(c)) continue;
      const rec = buildCandidate(symbol, "put", c, expSec, scannedAt, spot, prevVolLookup, nowMs);
      if (rec) candidates.push(rec);
    }
  };
  if (firstEntry && firstExpSec) scanEntry(firstEntry, firstExpSec);

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

  const hits = candidates.filter((c) => c.flagged);
  hits.sort((a, b) => (b.deltaVol ?? 0) - (a.deltaVol ?? 0));
  return { symbol, spot, marketState, hits, candidates };
}

async function main() {
  const scannedAt = new Date().toISOString();
  const nowMs = Date.now();
  const history = await loadUnusualHistory();
  const log = await loadUnusualLog();
  const prevVolLookup = buildPrevVolLookup(history);
  // Repeat lookup is built from the log BEFORE we append this scan's hits, so
  // a contract that fires for the first time today shows count=1 (not 2) on
  // its inaugural badge.
  const repeatLookup = buildRepeatLookup(log, nowMs);
  console.log(
    `Scanning ${TICKERS.length} tickers for unusual options flow…` +
      (prevVolLookup ? ` (delta comparison vs ${prevVolLookup.size} prior contracts)` : " (no prior snapshot — flagging skipped this run)"),
  );
  const tickerRows = [];
  const allCandidates = [];
  let firstMarketState = null;
  let scannedCount = 0;
  let failedCount = 0;

  for (const symbol of TICKERS) {
    if (EXCLUDE_FROM_SCAN.has(symbol)) continue;
    try {
      const result = await scanTicker(symbol, scannedAt, prevVolLookup, nowMs);
      if (!result) {
        failedCount++;
        continue;
      }
      scannedCount++;
      if (!firstMarketState && result.marketState) firstMarketState = result.marketState;
      for (const c of result.candidates) {
        if ((c.vol ?? 0) >= HISTORY_MIN_VOL) allCandidates.push(c);
      }
      if (result.hits.length) {
        const top = result.hits[0];
        const topDelta = top.deltaVol ?? 0;
        const stripped = result.hits.map((h) => {
          const out = stripCandidate(h);
          const key = `${out.symbol}|${out.side}|${out.strike}|${out.expSec}`;
          const prior = repeatLookup.get(key);
          // +1 includes the current scan, so a contract flagged once before
          // and again this hour shows "×2", a brand-new hit shows "×1" (badge
          // won't render until count >= REPEAT_MIN).
          out.repeatCount = (prior?.count ?? 0) + 1;
          out.firstSeen = prior?.lastSeen ?? scannedAt;
          return out;
        });
        tickerRows.push({
          symbol: result.symbol,
          spot: result.spot,
          topDelta,
          contracts: stripped,
        });
        console.log(`  ✓ ${symbol} — ${result.hits.length} hit${result.hits.length === 1 ? "" : "s"}, top +${topDelta}/hr (${top.side} $${top.strike})`);
      } else {
        console.log(`  · ${symbol} — no unusual flow`);
      }
    } catch (err) {
      failedCount++;
      console.log(`  ✗ ${symbol} — ${err.message}`);
    }
    await sleep(POLITENESS_MS);
  }

  tickerRows.sort((a, b) => b.topDelta - a.topDelta);
  const contractCount = tickerRows.reduce((sum, t) => sum + t.contracts.length, 0);
  const hottestDelta = tickerRows[0]?.topDelta ?? 0;

  const payload = {
    scannedAt,
    marketState: firstMarketState,
    summary: {
      tickerCount: tickerRows.length,
      contractCount,
      hottestDelta,
      scanned: scannedCount,
      failed: failedCount,
      hadPrior: !!prevVolLookup,
    },
    tickers: tickerRows,
  };

  await mkdir(DATA_DIR, { recursive: true });
  const outPath = resolve(DATA_DIR, "unusual.json");
  await writeFile(outPath, JSON.stringify(payload), "utf8");
  console.log(
    `wrote ${outPath} — ${tickerRows.length} ticker${tickerRows.length === 1 ? "" : "s"}, ${contractCount} contract${contractCount === 1 ? "" : "s"} flagged${hottestDelta ? `, hottest +${hottestDelta}/hr` : ""}`,
  );

  // Append this scan to history. Persist EVERY in-band candidate (above the
  // min-vol floor), not just the flagged hits, so next hour's scan can
  // compute deltas for contracts that didn't flag this hour.
  history.snapshots.push({
    scannedAt,
    contracts: allCandidates.map((c) => ({
      symbol: c.symbol,
      side: c.side,
      strike: c.strike,
      expSec: c.expSec,
      vol: c.vol,
    })),
  });
  history.snapshots = history.snapshots.slice(-HISTORY_MAX_SNAPSHOTS);
  const historyPath = resolve(DATA_DIR, HISTORY_FILE);
  await writeFile(historyPath, JSON.stringify(history), "utf8");
  console.log(
    `wrote ${historyPath} — ${history.snapshots.length}/${HISTORY_MAX_SNAPSHOTS} snapshot${history.snapshots.length === 1 ? "" : "s"} retained, ${allCandidates.length} contract volume${allCandidates.length === 1 ? "" : "s"} stored`,
  );

  // Append this scan's flagged hits to the long-running log, then prune
  // anything older than LOG_WINDOW_MS so the file size stays bounded.
  const cutoff = nowMs - LOG_WINDOW_MS;
  const kept = (log.entries || []).filter((e) => {
    const t = Date.parse(e.scannedAt || "");
    return Number.isFinite(t) && t >= cutoff;
  });
  for (const t of tickerRows) {
    for (const c of t.contracts) {
      kept.push({
        scannedAt,
        symbol: c.symbol,
        side: c.side,
        strike: c.strike,
        expSec: c.expSec,
        deltaVol: c.deltaVol,
        vol: c.vol,
        premium: c.premium,
      });
    }
  }
  const logPayload = { updatedAt: scannedAt, entries: kept };
  const logPath = resolve(DATA_DIR, LOG_FILE);
  await writeFile(logPath, JSON.stringify(logPayload), "utf8");
  console.log(
    `wrote ${logPath} — ${kept.length} log entr${kept.length === 1 ? "y" : "ies"} retained (${LOG_WINDOW_MS / 86400000}-day window)`,
  );
}

// Trim the candidate object down to the fields the UI actually renders.
function stripCandidate(c) {
  return {
    symbol: c.symbol,
    side: c.side,
    strike: c.strike,
    expSec: c.expSec,
    vol: c.vol,
    oi: c.oi,
    last: c.last,
    bid: c.bid,
    ask: c.ask,
    iv: c.iv,
    prevVol: c.prevVol,
    deltaVol: c.deltaVol,
    otmPct: c.otmPct,
    dte: c.dte,
    premium: c.premium,
    tape: c.tape,
    scannedAt: c.scannedAt,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
