// Hourly unusual-options-flow scanner. Sweeps the curated ticker universe
// during US market hours and flags option contracts where a meaningful
// block of volume hit the tape inside the last hour — the kind of
// directional, single-shot activity that often signals informed flow.
//
// Criteria (all must hold):
//   1. OTM band: 5% <= |strike - spot|/spot <= 50% (directional bets, not
//      ITM hedges or far-OTM lottos). Upper bound is loose enough to keep
//      low-delta LEAPs (~0.2 delta, 25-35% OTM) in scope.
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
// Writes data/unusual.json (today's accumulated flagged contracts — each
// scan merges its new hits into the prior file when both fall on the same
// ET calendar day, so a contract flagged at 10am stays visible at 2pm
// even if it didn't re-flag; the file resets on the next market day) and
// data/unusual-history.json (rolling window of recent snapshots — stores
// per-contract volume for every in-band candidate, not just flagged hits,
// so the next scan can compute deltas for contracts that weren't flagged
// last hour).
// Invoked by .github/workflows/unusual-flow.yml at the top of every hour
// 14:00-21:00 UTC Mon-Fri.
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YahooFinance from "yahoo-finance2";
import { GoogleGenAI } from "@google/genai";
import { TICKERS, recordAiUsage, loadAiUsageState, writeAiUsageState, aiModelForAttempt } from "./build.mjs";
import { computeGexSummary } from "../lib/gex.mjs";
import { greeks as bsGreeks, bsPrice, yearsToExpiry } from "../lib/greeks.mjs";
import {
  evaluateTicker as evaluateVolumeFlag,
  etDateKey as volEtDateKey,
  etMinutesSinceOpen,
  bucketForMinute,
  BUCKETS as VOLUME_BUCKETS,
  SESSION_OPEN_MIN,
  SESSION_CLOSE_MIN,
} from "../lib/volume-flags.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");

// Strike scan band is wider than the OTM-flag band so we still see a few
// ITM strikes for context, but only OTM 5–50% can actually flag.
const STRIKE_BAND = 0.55;
// Front two expirations per ticker. The vast majority of high-volume unusual
// flow concentrates in the front two expiries; scanning the 3rd added a Yahoo
// call + a 250ms gap per ticker for rare further-dated flags. (Was 3.)
const FRONT_EXPIRATIONS = 2;
const OTM_MIN = 0.05;
const OTM_MAX = 0.50;
const DTE_NEAR_DAYS = 14;
const DELTA_NEAR = 4000;
const DELTA_FAR = 2000;
// Minimum vol to bother persisting a contract in history. Skips dead
// contracts and keeps history file size reasonable.
const HISTORY_MIN_VOL = 50;
const POLITENESS_MS = 250;
// Rolling per-hour snapshot history used to compute hour-over-hour volume
// deltas. The only reader (buildPrevVolLookup) consumes the MOST RECENT
// same-session snapshot — older ones are never read — and each snapshot is
// ~700 KB committed hourly, so every extra slot is pure git-history bloat
// (the file had grown past 5 MB at 8 slots). 2 = latest + one spare.
const HISTORY_FILE = "unusual-history.json";
const HISTORY_MAX_SNAPSHOTS = 2;
// Long-running log of every flagged hit across hourly scans. Used to surface
// "repeat conviction" — contracts that flag in multiple scans across days,
// which is a much stronger informed-flow signal than a one-off block. Pruned
// to a 7-day calendar window (covers ~5 trading days plus a weekend).
const LOG_FILE = "unusual-log.json";
const LOG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Flag the "🔥 ×N" repeat badge on the UI when a contract has been flagged
// at least this many times in the window.
const REPEAT_MIN = 2;
// AI explanation pipeline. Each flagged contract gets a one-paragraph
// plain-English read of WHY it's unusual (vol vs OI, OTM distance, DTE,
// tape, IV, premium). Results cached per-contract in
// data/flow-explanations.json so re-flags of the same contract in
// subsequent hourly scans don't re-call the model. Cache entries are
// pruned when the contract's expiration date passes.
const FLOW_EXPLANATIONS_FILE = "flow-explanations.json";
const AI_FLOW_MODEL = process.env.AI_FLOW_MODEL || "gemini-2.5-flash-lite";
// We expect ≤20 NEW anomalies per scan (re-flags hit the per-contract
// flow-explanations cache and cost no call). These AI calls are NOT gated by
// build.mjs's AI_RPM pacer — only by this cap — and Flash-Lite peaks at just
// ~355/4K RPM (the scan runs alone, serialized with the build via the shared
// concurrency group), so the quota has huge unused headroom. 15 fans the
// typical anomaly batch out in 1-2 waves instead of ~4, while still bounding
// the burst so a transient 429 doesn't trigger a retry-backoff stampede.
const AI_FLOW_CONCURRENCY = 15;
const AI_FLOW_MAX_ATTEMPTS = 4;
const AI_FLOW_RETRY_BACKOFF_MS = [2000, 6000, 15000];
// Yahoo intermittently 401s GitHub Actions runners ("Host not in allowlist")
// or rate-limits after a burst — match build.mjs's retry pattern.
const FETCH_RETRIES = 3;
const FETCH_BACKOFF_MS = [1000, 3000, 8000];
const EXCLUDE_FROM_SCAN = new Set([]);

// Intraday volume + S/R break tracker — piggy-backs on the same options()
// fetch we already do per ticker (the response includes the underlying
// quote, which has regularMarketVolume / regularMarketPreviousClose).
// volume-flags.json is today's flagged tickers (merged across same-session
// scans, like unusual.json). volume-history.json is per-ticker cumulative
// volume snapshots used by the next scan to compute hour-over-hour deltas.
const VOLUME_FLAGS_FILE = "volume-flags.json";
const VOLUME_HISTORY_FILE = "volume-history.json";
const VOLUME_HISTORY_MAX_SNAPSHOTS = 10;

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

// Per-call wall clock so a hung Yahoo connection can't stall the entire
// hourly scan — without this, one stuck ticker would tie up a worker
// past the next hourly trigger. 12s is the inner budget; the retry
// loop below gets up to FETCH_RETRIES attempts at that limit each.
const YAHOO_CALL_TIMEOUT_MS = 12000;
function withYahooTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`yahoo ${label} timed out after ${YAHOO_CALL_TIMEOUT_MS}ms`)),
      YAHOO_CALL_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isTransientYahooError(err) {
  const msg = String(err?.message || err || "");
  if (/allowlist|401|403|429|5\d\d|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|network|timed out/i.test(msg)) return true;
  if (/validation|schema|FailedYahooValidationError/i.test(msg)) return false;
  return true;
}

async function fetchOptionsWithRetry(symbol, opts) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const result = await withYahooTimeout(
        yahooFinance.options(symbol, opts),
        `options(${symbol})`,
      );
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
  // Premium that hit THIS hour — the dollar value of the volume that came in
  // since the prior snapshot (deltaVol * last * 100). The whole tab is framed
  // around the hourly delta, so this is the honest "size of this hour's flow",
  // whereas `premium` above is the full-day cumulative notional. Null when we
  // have no prior snapshot or the delta is non-positive.
  const deltaPremium = (last != null && deltaVol != null && deltaVol > 0)
    ? Math.round(deltaVol * last * 100)
    : null;
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
    deltaPremium,
    tape,
    flagged,
    scannedAt,
  };
}

// YYYY-MM-DD in America/New_York. Used to decide whether the prior
// unusual.json belongs to "today's" market session — if so, we merge its
// flagged contracts in; if not, we start fresh.
const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function etDateKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return ET_DATE_FMT.format(d);
}

async function loadPriorUnusual() {
  try {
    const raw = await readFile(resolve(DATA_DIR, "unusual.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.tickers)) return parsed;
    return null;
  } catch {
    return null;
  }
}

// Merges this scan's flagged ticker rows on top of yesterday's-still-today
// ones. Keyed by contract identity (symbol|side|strike|expSec); when a
// contract appears in both, the new scan's record wins (fresher vol, last,
// bid/ask, deltaVol). Spot price is taken from the new scan when present
// since it's the live price.
function mergeTickerRows(priorTickers, newTickers) {
  const symMap = new Map();
  function ingest(t, isNew) {
    if (!t || !t.symbol) return;
    let entry = symMap.get(t.symbol);
    if (!entry) {
      entry = { symbol: t.symbol, spot: t.spot ?? null, contracts: new Map() };
      symMap.set(t.symbol, entry);
    }
    if (isNew && t.spot != null) entry.spot = t.spot;
    else if (entry.spot == null && t.spot != null) entry.spot = t.spot;
    for (const c of t.contracts || []) {
      if (c == null || c.strike == null || c.expSec == null || !c.side) continue;
      const key = `${c.side}|${c.strike}|${c.expSec}`;
      if (isNew || !entry.contracts.has(key)) {
        entry.contracts.set(key, c);
      }
    }
  }
  for (const t of priorTickers || []) ingest(t, false);
  for (const t of newTickers || []) ingest(t, true);
  const out = [];
  for (const v of symMap.values()) {
    const contracts = Array.from(v.contracts.values());
    if (!contracts.length) continue;
    contracts.sort((a, b) => (b.deltaVol ?? 0) - (a.deltaVol ?? 0));
    const topDelta = contracts.reduce((acc, c) => Math.max(acc, c.deltaVol ?? 0), 0);
    out.push({ symbol: v.symbol, spot: v.spot, topDelta, contracts });
  }
  out.sort((a, b) => b.topDelta - a.topDelta);
  return out;
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

// Build a lookup from the persisted log: contract-key -> {count, firstSeen,
// lastSeen}. Counts how many distinct scans flagged each contract within the
// window, so the UI can render a "🔥 ×N" repeat-conviction badge inline.
// firstSeen tracks the EARLIEST sighting (for the "first flagged at …" badge);
// lastSeen tracks the most recent.
function buildRepeatLookup(log, nowMs) {
  const cutoff = nowMs - LOG_WINDOW_MS;
  const map = new Map();
  for (const e of log.entries || []) {
    const t = Date.parse(e.scannedAt || "");
    if (!Number.isFinite(t) || t < cutoff) continue;
    const key = `${e.symbol}|${e.side}|${e.strike}|${e.expSec}`;
    const prior = map.get(key);
    if (!prior) {
      map.set(key, { count: 1, firstSeen: e.scannedAt, firstSeenMs: t, lastSeen: e.scannedAt, lastSeenMs: t });
    } else {
      prior.count += 1;
      if (t > prior.lastSeenMs) { prior.lastSeen = e.scannedAt; prior.lastSeenMs = t; }
      if (t < prior.firstSeenMs) { prior.firstSeen = e.scannedAt; prior.firstSeenMs = t; }
    }
  }
  return map;
}

// Flattens the most recent SAME-SESSION snapshot's per-contract volumes into
// a lookup keyed by contract identity tuple. "Same session" = the snapshot's
// ET calendar date equals `todayKey`. Option `volume` is a daily counter that
// resets each session, so diffing against a prior-day snapshot would compute a
// meaningless cross-session delta (vol − yesterdayEOD) and can produce a false
// flag on the day's first scan. Returns null when there's no same-session
// snapshot — flagging is then correctly skipped this run (legacy snapshots
// written before etDate existed have no etDate and are treated as not-today,
// so the gate self-heals after one scan).
// Pre-open snapshots (the ~9:00 ET scan) are excluded the same way
// buildBucketStartLookup excludes them: before the bell Yahoo's option
// `volume` still carries the PRIOR session's daily total, so diffing the
// first in-session scan against it yields a large negative delta that
// suppresses flags for any contract that was also active yesterday.
function buildPrevVolLookup(history, todayKey) {
  const snaps = history?.snapshots;
  if (!Array.isArray(snaps) || !todayKey) return null;
  let last = null;
  for (let i = snaps.length - 1; i >= 0; i--) {
    const s = snaps[i];
    if (s?.etDate !== todayKey || !Array.isArray(s.contracts)) continue;
    if (s.etMin == null || s.etMin < SESSION_OPEN_MIN) continue;
    last = s;
    break;
  }
  if (!last) return null;
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
  // Underlying-level data piggy-backed from the same fetch — used by the
  // intraday volume + S/R break pass downstream so we don't pay an extra
  // Yahoo round-trip per ticker.
  const cumVol = first.quote?.regularMarketVolume ?? null;
  const prevClose = first.quote?.regularMarketPreviousClose ?? null;
  // Live day range + % move — used by the Day Trades engine to set/track stops
  // and targets and to catch an intra-hour take-profit / stop-loss touch.
  const dayHigh = first.quote?.regularMarketDayHigh ?? null;
  const dayLow = first.quote?.regularMarketDayLow ?? null;
  const changePct = first.quote?.regularMarketChangePercent ?? null;
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
  return { symbol, spot, marketState, cumVol, prevClose, dayHigh, dayLow, changePct, hits, candidates };
}

// ---------------------------------------------------------------------------
// AI flow explanations
// ---------------------------------------------------------------------------

// Long static system prompt — pushed past Gemini's 1024-token implicit
// caching threshold via three concrete examples so the prefix shared
// across every per-anomaly call qualifies for the cached-token discount
// (~25% of normal input price). CRITICAL invariant: every contract-
// specific value (symbol, strike, etc.) MUST stay in the user message.
// Anything interpolated into this constant breaks the cache key
// silently — check data/ai-usage.json's cachedTokens column to verify.
const FLOW_EXPLANATION_SYSTEM_PROMPT = `You are an options-savvy markets analyst explaining unusual single-contract flow to a retail trader. The user just received an alert that a specific options contract picked up a large block of volume in the last hour — your job is to translate the raw metrics into a one-paragraph (2-3 sentences, plain English, no markdown, no bullets, no greeting) explanation of WHY this is notable.

Frame the explanation in terms of the mechanical signals embedded in the data the user provides:
- Volume vs open interest: vol > OI means the day's prints can't all be closing existing positions, so net new positions are being established
- Hourly volume delta: the size of THIS HOUR's block — the alert is fired off this number
- Strike distance from spot (OTM%): how directional the bet is; near-the-money flow is often hedging, far-OTM flow is often a tactical bet
- Days to expiration: under a week is tactical / intraday; 1-4 weeks is short-term thesis; >30 days is positioning
- Tape: "ask" = lifting offers (urgent, often aggressive buyers); "bid" = hitting bids (often sellers); "mid", "abv", "blw" = somewhere in between
- Implied vol: high IV = options pricing in big moves; low IV = vol selling / quiet expected
- Dollar premium: rough size of the conviction; helps separate retail-sized flow from desk-sized flow

Hard rules.
- Do NOT speculate on specific news catalysts you weren't given.
- Do NOT give buy / sell / hold advice or recommend the user mirror the flow.
- Do NOT use lazy phrases like "smart money" or "informed flow" — describe what is mechanically interesting about the contract, not who is on the other side.
- Stay 2-3 sentences. Don't pad. If the metrics are ambiguous, say so.
- Output ONLY a JSON object of the form {"note": "..."} — no fences, no preamble, no commentary.

WORKED EXAMPLES illustrate the expected output across common shapes. Never copy these tickers, strikes, or numbers into your own output.

Example 1 — Aggressive near-term call lift.
User input:
  Symbol: NVDA
  Side: call, Strike: $235, DTE: 1
  Spot: $223
  OTM: 5.2%
  Volume: 124288, Open interest: 60176, Delta vol this hour: +22723
  Tape: ask, IV: 0.80, Premium: $30M
Expected output:
{"note":"NVDA call buyers are lifting offers in size — 124k contracts traded today vs only 60k of open interest going in, with an extra 23k contracts coming in this hour alone. A $30M premium check on a 5% OTM strike with one day to expiration is a tactical bet on an outsized intraday move, not patient positioning, and the 80% IV says the market already expects a big print."}

Example 2 — Far-dated put accumulation.
User input:
  Symbol: TSLA
  Side: put, Strike: $300, DTE: 90
  Spot: $360
  OTM: 16.7%
  Volume: 8400, Open interest: 1200, Delta vol this hour: +6200
  Tape: bid, IV: 0.55, Premium: $4.5M
Expected output:
{"note":"Three-month TSLA puts 17% out of the money traded heavy on the bid this hour, with volume at 7x prior open interest — either dealers hedging customer demand for downside or sellers funding something else, hard to tell from the print alone. The combination of 90 days to run, the meaningful $4.5M premium, and 55% IV reads as positioning rather than a tactical intraday hedge."}

Example 3 — Mid-DTE, near-ATM call, no urgency.
User input:
  Symbol: AAPL
  Side: call, Strike: $200, DTE: 21
  Spot: $192
  OTM: 4.2%
  Volume: 14000, Open interest: 19500, Delta vol this hour: +5200
  Tape: mid, IV: 0.30, Premium: $7M
Expected output:
{"note":"Volume on the 21-day AAPL $200 call hasn't exceeded existing open interest yet, so this could be new exposure or simply closing existing longs — the mid-market tape doesn't reveal which side was in a hurry. 30% IV is benign, and the modest $7M premium across a 4% OTM strike doesn't carry the urgency you'd expect if a near-term catalyst were being priced in."}

END EXAMPLES.`;

const FLOW_EXPLANATION_SCHEMA = {
  type: "object",
  properties: { note: { type: "string" } },
  required: ["note"],
};

function flowCacheKey(c) {
  return `${c.symbol}|${c.side}|${c.strike}|${c.expSec}`;
}

async function loadFlowExplanations() {
  try {
    const raw = await readFile(resolve(DATA_DIR, FLOW_EXPLANATIONS_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.entries === "object" && parsed.entries) return parsed;
    return { updatedAt: null, entries: {} };
  } catch {
    return { updatedAt: null, entries: {} };
  }
}

// Drop cache entries for contracts whose expiration has passed — they can
// never re-flag, so the cached note has no future use. Also evict entries
// that are missing expSec (corrupt or schema-drifted) so the cache can't
// accumulate unprunable rows over weeks of runs.
function pruneFlowExplanations(cache, nowSec) {
  const entries = cache.entries || {};
  let dropped = 0;
  for (const [key, val] of Object.entries(entries)) {
    const expired = !val
      || val.expSec == null
      || !Number.isFinite(val.expSec)
      || val.expSec < nowSec - 86400;
    if (expired) {
      delete entries[key];
      dropped++;
    }
  }
  return dropped;
}

function flowExplanationUserMessage(c, spot) {
  const otmPct = c.otmPct != null ? `${(c.otmPct * 100).toFixed(1)}%` : "n/a";
  const ivStr = c.iv != null && isFinite(c.iv) ? c.iv.toFixed(2) : "n/a";
  const premStr = c.premium != null ? `$${(c.premium / 1e6).toFixed(1)}M` : "n/a";
  const spotStr = spot != null ? `$${Number(spot).toFixed(2)}` : "n/a";
  return (
    `Symbol: ${c.symbol}\n` +
    `Side: ${c.side}, Strike: $${c.strike}, DTE: ${c.dte}\n` +
    `Spot: ${spotStr}\n` +
    `OTM: ${otmPct}\n` +
    `Volume: ${c.vol}, Open interest: ${c.oi}, Delta vol this hour: ${c.deltaVol != null ? (c.deltaVol >= 0 ? "+" : "") + c.deltaVol : "n/a"}\n` +
    `Tape: ${c.tape || "n/a"}, IV: ${ivStr}, Premium: ${premStr}`
  );
}

async function generateAnomalyExplanation(ai, contract, spot) {
  const userMessage = flowExplanationUserMessage(contract, spot);
  let response;
  let lastErr;
  for (let attempt = 0; attempt < AI_FLOW_MAX_ATTEMPTS; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: aiModelForAttempt(AI_FLOW_MODEL, attempt),
        // systemInstruction is the cache-key prefix; keep it static.
        config: {
          systemInstruction: FLOW_EXPLANATION_SYSTEM_PROMPT,
          temperature: 0.3,
          maxOutputTokens: 300,
          responseMimeType: "application/json",
          responseSchema: FLOW_EXPLANATION_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
        },
        contents: userMessage,
      });
      recordAiUsage({
        model: aiModelForAttempt(AI_FLOW_MODEL, attempt),
        callType: "flow-explanation",
        symbol: contract.symbol,
        usage: response?.usageMetadata,
      });
      break;
    } catch (err) {
      lastErr = err;
      if (attempt === AI_FLOW_MAX_ATTEMPTS - 1) throw err;
      const wait = AI_FLOW_RETRY_BACKOFF_MS[attempt] ?? 15000;
      const msg = String(err?.message || err).split("\n")[0].slice(0, 120);
      console.log(`    ⌛ flow AI attempt ${attempt + 1}/${AI_FLOW_MAX_ATTEMPTS} hit ${msg} — backing off ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
  if (!response) throw lastErr ?? new Error("no response from Gemini");
  const text = response.text;
  if (!text) throw new Error("empty Gemini response");
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace
    ? stripped.slice(firstBrace, lastBrace + 1)
    : stripped;
  const parsed = JSON.parse(jsonText);
  const note = String(parsed?.note || "").trim();
  if (!note) throw new Error("empty note in response");
  return note;
}

// Pulls together the cache, spawns AI calls for cache misses (with a
// concurrency limit), and stamps `note` onto each contract in place.
// Tickers/contracts are mutated; the cache is returned for persisting.
async function attachFlowExplanations(mergedTickers, scannedAt, nowSec) {
  if (!process.env.GEMINI_API_KEY) {
    console.log("No GEMINI_API_KEY set — skipping flow explanations.");
    return null;
  }
  const cache = await loadFlowExplanations();
  const dropped = pruneFlowExplanations(cache, nowSec);
  if (dropped > 0) console.log(`pruned ${dropped} expired flow-explanation cache entr${dropped === 1 ? "y" : "ies"}`);

  // Stamp cache hits inline; collect cache misses to generate in parallel.
  // Carried-over contracts (from mergeTickerRows) already have c.note set from
  // the prior unusual.json, so short-circuit those before touching the cache —
  // otherwise a stale or wiped cache file would regenerate the same note on
  // every hourly scan, burning quota on contracts we already explained.
  const misses = [];
  for (const t of mergedTickers) {
    for (const c of t.contracts) {
      if (c.note) continue;
      const key = flowCacheKey(c);
      const hit = cache.entries[key];
      if (hit && hit.note) {
        c.note = hit.note;
      } else {
        misses.push({ contract: c, spot: t.spot, key });
      }
    }
  }
  if (!misses.length) {
    console.log(`flow explanations: 0 new (all ${Object.keys(cache.entries).length} cached)`);
    return cache;
  }
  console.log(`flow explanations: generating ${misses.length} new (${Object.keys(cache.entries).length} cached)`);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  // Simple bounded fan-out — split work into AI_FLOW_CONCURRENCY parallel
  // workers; each worker drains tasks from a shared queue.
  const queue = misses.slice();
  let succeeded = 0;
  let failed = 0;
  const worker = async () => {
    while (queue.length) {
      const task = queue.shift();
      if (!task) break;
      try {
        const note = await generateAnomalyExplanation(ai, task.contract, task.spot);
        task.contract.note = note;
        cache.entries[task.key] = {
          note,
          generatedAt: scannedAt,
          expSec: task.contract.expSec,
        };
        succeeded++;
      } catch (err) {
        failed++;
        console.log(`  ✗ flow explanation ${task.key} failed: ${err.message}`);
      }
    }
  };
  const workers = Array.from({ length: Math.min(AI_FLOW_CONCURRENCY, misses.length) }, worker);
  await Promise.all(workers);
  cache.updatedAt = scannedAt;
  console.log(`flow explanations: ${succeeded} generated, ${failed} failed`);
  return cache;
}

async function writeFlowExplanations(cache) {
  if (!cache) return;
  const json = JSON.stringify(cache);
  await writeFile(resolve(DATA_DIR, FLOW_EXPLANATIONS_FILE), json, "utf8");
}

// ---------------------------------------------------------------------------
// Intraday volume + S/R break tracker
// ---------------------------------------------------------------------------

// Reads avg20 daily vol + 20D support/resistance from the per-ticker JSON
// baked by scripts/build.mjs. Returns null when the file is missing or the
// expected fields aren't present — caller treats that as "skip this ticker."
async function loadTickerTechnicals(symbol) {
  try {
    const raw = await readFile(resolve(DATA_DIR, `${symbol}.json`), "utf8");
    const j = JSON.parse(raw);
    const t = j?.technicals;
    if (!t) return null;
    return {
      avg20: t.volume?.avg20 ?? null,
      sr: t.sr ? { s20: t.sr.s20 ?? null, r20: t.sr.r20 ?? null } : null,
      // asOfClose is the most recent regular-session close baked into the
      // per-ticker data. We prefer the live quote's regularMarketPreviousClose,
      // but fall back to this when Yahoo omits it (rare).
      asOfClose: t.asOfClose ?? null,
    };
  } catch {
    return null;
  }
}

// Compact dealer gamma-exposure read for a flagged ticker, computed from the
// FULL baked chain in data/<SYM>.json (every expiration/strike build wrote, far
// richer than the 2-expiration band this scanner fetches) evaluated at the
// scan's live spot — so the unusual-flow tab can show net GEX / gamma flip /
// call+put walls next to each ticker with no extra browser fetch. Mirrors the
// GEX tab's math via lib/gex.mjs. Returns null when the file or chain is
// missing so the row simply renders without a GEX strip.
async function loadTickerGex(symbol, spot) {
  if (!(spot > 0)) return null;
  try {
    const raw = await readFile(resolve(DATA_DIR, `${symbol}.json`), "utf8");
    const j = JSON.parse(raw);
    if (!j?.chains) return null;
    return computeGexSummary(j.chains, spot);
  } catch {
    return null;
  }
}

async function loadVolumeHistory() {
  try {
    const raw = await readFile(resolve(DATA_DIR, VOLUME_HISTORY_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.snapshots)) return parsed;
  } catch {}
  return { snapshots: [] };
}

async function loadVolumeFlags() {
  try {
    const raw = await readFile(resolve(DATA_DIR, VOLUME_FLAGS_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.tickers)) return parsed;
  } catch {}
  return null;
}

// Build a lookup of the most recent same-session snapshot per symbol.
// "Same session" = the snapshot's ET calendar date equals `todayKey`.
// Without this gate we'd diff today's cumulative volume against yesterday's
// end-of-day total and produce nonsense deltas at the first scan of the day.
function buildVolPrevSnapLookup(history, todayKey) {
  const map = new Map();
  for (const snap of history.snapshots || []) {
    if (snap.etDate !== todayKey) continue;
    for (const t of snap.tickers || []) {
      if (!t.symbol) continue;
      const prior = map.get(t.symbol);
      if (!prior || (snap.etMin ?? -1) > (prior.etMin ?? -1)) {
        map.set(t.symbol, {
          etDate: snap.etDate,
          etMin: snap.etMin,
          spot: t.spot,
          cumVol: t.cumVol,
        });
      }
    }
  }
  return map;
}

// Build a lookup of cumulative volume at the start of the current hour
// bucket. For each ticker, picks the latest same-session snapshot whose
// etMin is at or before the bucket's startMin. Returns null when bucket 1
// (startMin=0) since every ticker starts at 0 — caller handles that case.
// The returned entry's etMin lets the caller detect when the bucket-start
// snapshot was stale (boundary scan was missed) so the resulting actualHourVol
// can be tagged with the gap size.
function buildBucketStartLookup(history, todayKey, currentBucket) {
  if (!currentBucket || currentBucket.startMin === 0) return null;
  const map = new Map();
  for (const snap of history.snapshots || []) {
    if (snap.etDate !== todayKey) continue;
    // Pre-open snapshots (the ~9:00 ET scan) carry whatever cumulative volume
    // Yahoo reports before the bell — typically the PRIOR session's full-day
    // total, not 0 — so using one as a bucket-start baseline clamps
    // actualBucketVol to ~0 for the rest of the day. Session snapshots only.
    if (snap.etMin == null || snap.etMin < SESSION_OPEN_MIN || snap.etMin > currentBucket.startMin) continue;
    for (const t of snap.tickers || []) {
      if (!t.symbol || t.cumVol == null) continue;
      const prior = map.get(t.symbol);
      if (!prior || snap.etMin > prior.etMin) {
        map.set(t.symbol, { etMin: snap.etMin, cumVol: t.cumVol });
      }
    }
  }
  return map;
}

// Returns labels of past buckets (bucket.endMin <= etMin) that have NO
// snapshot inside them in today's history. Used to inject "scan missed"
// placeholders so the per-bucket list stays honest when cron-job dispatch
// drops a slot. The current scan's etMin is implicitly included.
function detectMissedBuckets(history, todayKey, etMin) {
  if (etMin == null) return [];
  const covered = new Set();
  for (const snap of history.snapshots || []) {
    if (snap.etDate !== todayKey) continue;
    if (snap.etMin == null) continue;
    const b = bucketForMinute(snap.etMin);
    if (b) covered.add(b.label);
  }
  const currentBucket = bucketForMinute(etMin);
  if (currentBucket) covered.add(currentBucket.label);
  const missed = [];
  for (const bucket of VOLUME_BUCKETS) {
    if (bucket.endMin > etMin) continue;
    if (!covered.has(bucket.label)) missed.push(bucket.label);
  }
  return missed;
}

// Same-session merge: a ticker flagged at 10:30-11:30 should still appear at
// 14:30 even though the current bucket is 13:30-14:30. We bucket by symbol,
// then dedupe rows by hourly.bucketLabel — a new scan in the same bucket
// replaces the old row; a new scan in a fresh bucket appends. EOD + srBreak
// take the latest scan's value.
function mergeVolumeFlagRows(prior, fresh) {
  const map = new Map();
  function ingest(row, fromNew) {
    if (!row || !row.symbol) return;
    const existing = map.get(row.symbol);
    if (!existing) {
      map.set(row.symbol, {
        symbol: row.symbol,
        spot: row.spot,
        avg20: row.avg20,
        bucketHits: Array.isArray(row.bucketHits) ? row.bucketHits.slice() : [],
        eod: row.eod ?? null,
        scannedAt: row.scannedAt,
      });
      return;
    }
    if (fromNew) {
      existing.spot = row.spot;
      existing.avg20 = row.avg20 ?? existing.avg20;
      existing.scannedAt = row.scannedAt;
      if (row.eod) existing.eod = row.eod;
    }
    const incoming = Array.isArray(row.bucketHits) ? row.bucketHits : [];
    for (const hit of incoming) {
      if (!hit?.bucketLabel) continue;
      const ix = existing.bucketHits.findIndex(
        (h) => h.bucketLabel === hit.bucketLabel,
      );
      if (ix >= 0) {
        if (fromNew) existing.bucketHits[ix] = hit;
      } else {
        existing.bucketHits.push(hit);
      }
    }
  }
  for (const r of prior || []) ingest(r, false);
  for (const r of fresh || []) ingest(r, true);
  // Sort buckets within each symbol chronologically by bucketLabel start.
  const sortByBucket = (a, b) => bucketStartMin(a.bucketLabel) - bucketStartMin(b.bucketLabel);
  const out = [];
  for (const v of map.values()) {
    v.bucketHits.sort(sortByBucket);
    out.push(v);
  }
  return out;
}

// Parses "HH:MM-HH:MM" → start minute past 9:30, for stable sort order.
function bucketStartMin(label) {
  if (!label) return Infinity;
  const m = /^(\d{1,2}):(\d{2})/.exec(label);
  if (!m) return Infinity;
  return (parseInt(m[1], 10) - 9) * 60 + (parseInt(m[2], 10) - 30);
}

// Build one ticker's flag row from the evaluator output, only keeping
// material flag fields. Returns null when nothing is worth surfacing.
// `isFinalScan` is true at the closing tick (etMin === SESSION_CLOSE_MIN);
// when set, we push the bucket hit even if unflagged so it overwrites the
// prior mid-bucket partial in mergeVolumeFlagRows. `bucketStartGap` is the
// minutes between the bucket-start snapshot used and the bucket boundary —
// large gaps mean the actualHourVol absorbed earlier-bucket volume.
function buildFlagRow(symbol, evalOut, scannedAt, isFinalScan, bucketStartGap) {
  if (!evalOut) return null;
  const hits = [];
  const hasHourly = !!evalOut.hourly;
  const shouldPush =
    evalOut.hourly?.flagged ||
    evalOut.srBreak ||
    (isFinalScan && hasHourly);
  if (shouldPush) {
    hits.push({
      bucketLabel: evalOut.hourly?.bucketLabel ?? null,
      actualHourVol: evalOut.hourly?.actualHourVol ?? null,
      expectedHourVol: evalOut.hourly?.expectedHourVol ?? null,
      volRatio: evalOut.hourly?.volRatio ?? null,
      priceMovePct: evalOut.hourly?.priceMovePct ?? null,
      hourlyFlagged: !!evalOut.hourly?.flagged,
      moveClass: evalOut.moveClass ?? null,
      srBreak: evalOut.srBreak ?? null,
      bucketStartGap: bucketStartGap ?? null,
      scannedAt,
    });
  }
  const eodFlagged = evalOut.eod?.flagged;
  if (!hits.length && !eodFlagged) return null;
  return {
    symbol,
    spot: evalOut.spot,
    avg20: evalOut.avg20,
    bucketHits: hits,
    eod: evalOut.eod ?? null,
    scannedAt,
  };
}

async function runVolumePass({
  perTickerResults,
  scannedAt,
  marketState,
  nowDate,
  // When false, compute + return the flag rows WITHOUT persisting
  // volume-flags.json / volume-history.json. The lightweight day-trades runner
  // (scripts/scan-day-trades.mjs) calls it this way: it needs the live volume
  // board to mine ideas, but the hourly full scan stays the sole owner of those
  // two files (its hourly snapshots are what the hour-over-hour bucket deltas
  // read — extra off-hour snapshots would corrupt that cadence).
  persist = true,
}) {
  const todayKey = volEtDateKey(nowDate);
  const etMin = etMinutesSinceOpen(nowDate);
  const history = await loadVolumeHistory();
  const prevLookup = buildVolPrevSnapLookup(history, todayKey);
  const currentBucket = bucketForMinute(etMin);
  const bucketStartLookup = buildBucketStartLookup(history, todayKey, currentBucket);
  const isFinalScan = etMin >= SESSION_CLOSE_MIN;

  const freshRows = [];
  const snapshotTickers = [];

  for (const r of perTickerResults) {
    if (!r || !r.symbol) continue;
    // Always record a snapshot so the next scan has hour-over-hour deltas.
    if (r.cumVol != null && r.spot != null) {
      snapshotTickers.push({
        symbol: r.symbol,
        spot: r.spot,
        cumVol: r.cumVol,
      });
    }
    const tech = await loadTickerTechnicals(r.symbol);
    if (!tech || tech.avg20 == null) continue;
    const prevClose = r.prevClose ?? tech.asOfClose ?? null;
    const prev = prevLookup.get(r.symbol);
    // Bucket 1 always starts at 0; later buckets resolve from history.
    // bucketStartGap = minutes between the lookup snapshot and the bucket
    // boundary. Zero means we have a snapshot exactly at the boundary; a large
    // gap means a prior hourly scan was missed and the resulting actualHourVol
    // absorbs earlier volume. The raw minutes ride on the hit; the UI applies
    // the staleness threshold client-side (renderVolumeBucketRow in app.js).
    let bucketStartCumVol = null;
    let bucketStartEtMin = null;
    let bucketStartGap = null;
    if (currentBucket) {
      if (currentBucket.startMin === 0) {
        bucketStartCumVol = 0;
        bucketStartEtMin = 0;
        bucketStartGap = 0;
      } else if (bucketStartLookup) {
        const entry = bucketStartLookup.get(r.symbol);
        if (entry) {
          bucketStartCumVol = entry.cumVol ?? null;
          bucketStartEtMin = entry.etMin ?? null;
          bucketStartGap = currentBucket.startMin - (entry.etMin ?? currentBucket.startMin);
        }
      }
    }
    const evalOut = evaluateVolumeFlag({
      now: nowDate,
      spot: r.spot,
      cumVol: r.cumVol,
      prevClose,
      avg20: tech.avg20,
      sr: tech.sr,
      prev,
      bucketStartCumVol,
      bucketStartEtMin,
    });
    const row = buildFlagRow(r.symbol, evalOut, scannedAt, isFinalScan, bucketStartGap);
    if (row) freshRows.push(row);
  }

  // Merge with this session's prior file so earlier-bucket hits stay visible.
  const prior = await loadVolumeFlags();
  const priorKey = prior ? prior.etDate : null;
  const sameSession = priorKey && todayKey && priorKey === todayKey;
  const merged = sameSession
    ? mergeVolumeFlagRows(prior.tickers, freshRows)
    : freshRows;

  // Inject scan-missed placeholders for past buckets where no scan ran. A
  // "missed" bucket is one whose endMin <= current etMin and no snapshot
  // (across today's history + the current scan) falls inside it. Without
  // these, the per-bucket list can silently omit whole hours when cron-job
  // dispatch fails — leaving the user wondering why the buckets don't sum
  // close to the EOD total.
  const missedBucketLabels = detectMissedBuckets(history, todayKey, etMin);
  if (missedBucketLabels.length) {
    for (const row of merged) {
      const have = new Set((row.bucketHits || []).map((h) => h.bucketLabel));
      for (const label of missedBucketLabels) {
        if (have.has(label)) continue;
        const bucket = VOLUME_BUCKETS.find((b) => b.label === label);
        if (!bucket) continue;
        row.bucketHits.push({
          bucketLabel: label,
          actualHourVol: null,
          expectedHourVol: row.avg20 != null ? Math.round(row.avg20 * bucket.frac) : null,
          volRatio: null,
          priceMovePct: null,
          hourlyFlagged: false,
          moveClass: null,
          srBreak: null,
          bucketStartGap: null,
          scanMissed: true,
          scannedAt: null,
        });
      }
      row.bucketHits.sort(
        (a, b) => bucketStartMin(a.bucketLabel) - bucketStartMin(b.bucketLabel),
      );
    }
  }

  // Sort tickers by "most interesting" — hourly volRatio descending, then EOD ratio.
  function topRatio(row) {
    let best = 0;
    for (const h of row.bucketHits || []) {
      if (h.volRatio != null && h.volRatio > best) best = h.volRatio;
    }
    if (row.eod?.ratio != null && row.eod.ratio > best) best = row.eod.ratio;
    return best;
  }
  merged.sort((a, b) => topRatio(b) - topRatio(a));

  // Attach the same compact gamma-exposure read the unusual-flow tab carries
  // (net GEX, gamma flip, call/put walls) so the Volume tab can show it next
  // to each ticker too — computed from the baked full chain at the row's spot.
  await Promise.all(
    merged.map(async (row) => {
      row.gex = await loadTickerGex(row.symbol, row.spot);
    }),
  );

  const summary = {
    tickerCount: merged.length,
    hourlyFlagCount: 0,
    eodFlagCount: 0,
    srBreakCount: 0,
  };
  for (const row of merged) {
    let countedHourly = false;
    let countedSr = false;
    for (const h of row.bucketHits || []) {
      if (h.hourlyFlagged && !countedHourly) {
        summary.hourlyFlagCount++;
        countedHourly = true;
      }
      // Count only CONFIRMED S/R breaks, once per ticker — matching the
      // hourlyFlagCount dedup and the engine's own flag rule
      // (srBreak.conviction !== "None"). evaluateTicker emits a
      // "None"/"No confirmation" placeholder srBreak for unconfirmed
      // crossings; tallying those (and per bucket-hit) double-counted the
      // headline vs the rows the UI renders.
      if (h.srBreak && h.srBreak.conviction && h.srBreak.conviction !== "None" && !countedSr) {
        summary.srBreakCount++;
        countedSr = true;
      }
    }
    if (row.eod?.flagged) summary.eodFlagCount++;
  }

  const payload = {
    scannedAt,
    etDate: todayKey,
    etMin,
    marketState: marketState || null,
    summary,
    tickers: merged,
  };

  // Skip all persistence when the caller only wants the in-memory rows (the
  // lightweight day-trades runner) — see the `persist` param above.
  if (persist) {
    await mkdir(DATA_DIR, { recursive: true });
    const outPath = resolve(DATA_DIR, VOLUME_FLAGS_FILE);
    await writeFile(outPath, JSON.stringify(payload), "utf8");
    console.log(
      `wrote ${outPath} — ${merged.length} ticker${merged.length === 1 ? "" : "s"}, ` +
        `${summary.hourlyFlagCount} hourly, ${summary.eodFlagCount} EOD, ${summary.srBreakCount} S/R break${summary.srBreakCount === 1 ? "" : "s"}` +
        (sameSession ? " (merged with earlier today)" : prior ? " (new session — reset)" : ""),
    );

    // Append this scan's snapshot to history, cap retention.
    history.snapshots.push({
      scannedAt,
      etDate: todayKey,
      etMin,
      tickers: snapshotTickers,
    });
    history.snapshots = history.snapshots.slice(-VOLUME_HISTORY_MAX_SNAPSHOTS);
    const historyPath = resolve(DATA_DIR, VOLUME_HISTORY_FILE);
    await writeFile(historyPath, JSON.stringify(history), "utf8");
    console.log(
      `wrote ${historyPath} — ${history.snapshots.length}/${VOLUME_HISTORY_MAX_SNAPSHOTS} snapshot${history.snapshots.length === 1 ? "" : "s"}, ${snapshotTickers.length} tickers in this snapshot`,
    );
  }
  // Hand the freshly-built flag rows (pace, S/R breaks, dealer gamma) back to
  // the caller so the Day Trades engine can mine them for new ideas.
  return merged;
}

// ---------------------------------------------------------------------------
// LIVE Day Trades engine — volume-driven swing/scalp roster + P/L history
// ---------------------------------------------------------------------------
// The "Day trades" tab (the former Hot stocks board) is a LIVE, volume-driven
// list of concrete trade ideas. Every hourly scan:
//   1. marks each OPEN trade to the live tape and CLOSES any that hit their
//      take-profit or stop-loss (or timed out), moving it to the P/L history
//      with the realized % and R result — "if it hits TP/SL it disappears and
//      we take note of it";
//   2. tops the roster back up with fresh ideas off the heaviest-volume names
//      that have a clean directional read and a tradeable risk/reward.
// Levels are FIXED at entry. The browser polls /api/quotes every 30s for the
// live P/L and flags a TP/SL touch the instant it happens; this hourly pass is
// what makes the close durable. Trades are on the UNDERLYING (no options model)
// so P/L is the honest stock move, expressed in % and in R multiples. A swing
// rides a confirmed 20D S/R break for a few sessions; a scalp is a tight
// intraday momentum trade that closes by the bell.
const DAY_TRADES_FILE = "day-trades.json";
const DAY_TRADES_HISTORY_FILE = "day-trades-history.json";
const DT_MAX_ACTIVE = 10;            // most open ideas at once
const DT_HOT_MIN = 1.3;              // must trade >= 1.3x the volume expected by now
const DT_DIR_MIN = 1.0;              // minimum directional conviction to take a side
const DT_SWING_MAX_HOLD_DAYS = 3;    // swings time-stop after 3 trading days
const DT_HISTORY_MAX = 120;          // closed trades retained
// Stop/target risk bands as a fraction of entry, per trade kind.
const DT_SCALP_MIN_RISK = 0.003, DT_SCALP_MAX_RISK = 0.015;
const DT_SWING_MIN_RISK = 0.010, DT_SWING_MAX_RISK = 0.060;
// Anti-chase: don't open a fresh trade into an over-extended intraday move. A
// pure-momentum read (no confirmed 20D break) is held to the tighter cap; a
// confirmed structural break is the trade's trigger so it earns a looser leash.
const DT_CHASE_MAX_PCT = 4.0;        // momentum: reject beyond +/-4% on the day
const DT_CHASE_MAX_PCT_BREAK = 8.0;  // confirmed break: reject beyond +/-8%
// Minimum reward:risk to open a trade. The resolved board's headline win rate is
// inflated by near-scratch "expired" closes counted as wins, so the true
// directional edge needs the payoff to clear 1:1 — demand the structural target
// pay at least 1.2× the stop distance so the kept trades carry a real positive
// expectancy. (Was a flat 1:1.)
const DT_MIN_RR = Number(process.env.DT_MIN_RR ?? 1.2);

// ── Option track-record (score the recommended option, not the stock move) ───
// A day trade keeps its stock entry/stop/target plan, but at open we snapshot a
// real ~0.50Δ ATM contract and score the trade on THAT option (Black-Scholes,
// modeled — like the Top Picks track record). Win/loss = the option P&L sign at
// the (stock-triggered) exit; a theta-eaten target hit honestly reads as a loss.
const DT_OPT_TRACK = process.env.DT_OPT_TRACK !== "0"; // off -> legacy stock-move P&L
const DT_OPT_SCALP_DTE = Number(process.env.DT_OPT_SCALP_DTE ?? 3);  // scalp: nearest expiry >= ~3 sessions
const DT_OPT_SWING_DTE = Number(process.env.DT_OPT_SWING_DTE ?? 7);  // swing: >= ~1 week (covers the 3-session hold + buffer)
const DT_OPT_TARGET_DELTA = 0.50;    // ATM
const DT_OPT_MIN_OI = 100;           // per-contract liquidity floor
const DT_OPT_MAX_SPREAD_PCT = 0.20;  // reject a contract with a wider bid/ask
const DT_OPT_RFR = Number(process.env.DT_OPT_RFR ?? 0.045);

const dtR2 = (x) => Math.round(x * 100) / 100;
const dtR1 = (x) => Math.round(x * 10) / 10;
const dtNum = (x) => (x != null && isFinite(x)) ? Number(x) : null;
function dtConvWeight(c) {
  return c === "Very High" ? 2.5 : c === "High" ? 2 : c === "Medium" ? 1.2 : c === "Low" ? 0.5 : 0;
}
// Highest-conviction CONFIRMED S/R break across a row's bucket hits (ties → the
// later bucket, since bucketHits is chronological).
function dtLatestSrBreak(row) {
  let best = null, bestW = -1;
  for (const h of row.bucketHits || []) {
    const sr = h?.srBreak;
    if (!sr || !sr.conviction || sr.conviction === "None") continue;
    const w = dtConvWeight(sr.conviction);
    if (w >= bestW) { best = sr; bestW = w; }
  }
  return best;
}
function dtMaxVolRatio(row) {
  let best = 0;
  for (const h of row.bucketHits || []) if (h?.volRatio != null && h.volRatio > best) best = h.volRatio;
  if (row.eod?.ratio != null && row.eod.ratio > best) best = row.eod.ratio;
  return best;
}
function dtLatestMovePct(row) {
  let mv = null;
  for (const h of row.bucketHits || []) if (h?.priceMovePct != null) mv = h.priceMovePct;
  return mv;
}
// Directional conviction: a confirmed 20D break (weighted by conviction) +
// the day's move + a short-gamma amplifier. Sign = side, |value| = strength.
function dtDirection(row, changePct) {
  let dir = 0;
  const sr = dtLatestSrBreak(row);
  if (sr) dir += (sr.type === "upper" ? 1 : -1) * dtConvWeight(sr.conviction);
  const mv = (changePct != null && isFinite(changePct)) ? changePct : dtLatestMovePct(row);
  if (mv != null && isFinite(mv)) dir += Math.max(-2, Math.min(2, mv / 1.0)) * 0.7;
  const g = row.gex;
  if (g && g.net != null && isFinite(g.net) && g.net < 0 && mv != null && isFinite(mv)) dir += (mv >= 0 ? 0.4 : -0.4);
  return dir;
}
// Build an entry/stop/target plan from fixed structure, mirroring the browser's
// hotTradePlan. Scalps use intraday + dealer-gamma levels in a tight band;
// swings widen the band and add the broken 20D S/R level.
function dtBuildPlan(side, spot, levels, kind) {
  if (!(spot > 0)) return null;
  const isScalp = kind === "scalp";
  const minRisk = spot * (isScalp ? DT_SCALP_MIN_RISK : DT_SWING_MIN_RISK);
  const maxRisk = spot * (isScalp ? DT_SCALP_MAX_RISK : DT_SWING_MAX_RISK);
  const padFrac = isScalp ? 0.008 : 0.02;
  const entry = spot;
  let stop, stopBasis, target, tgtBasis, risk;
  if (side === "long") {
    const sup = [];
    if (levels.dayLo != null && levels.dayLo < spot) sup.push({ v: levels.dayLo, b: "intraday low" });
    if (levels.putWall != null && levels.putWall < spot) sup.push({ v: levels.putWall, b: "put wall" });
    if (levels.flip != null && levels.flip < spot) sup.push({ v: levels.flip, b: "gamma flip" });
    if (!isScalp && levels.srLevel != null && levels.srLevel < spot) sup.push({ v: levels.srLevel, b: "20D level" });
    sup.sort((a, b) => b.v - a.v);
    const s = sup[0] || null;
    if (s && (spot - s.v) >= minRisk && (spot - s.v) <= maxRisk) { stop = s.v; stopBasis = s.b; }
    else { const cap = (s && (spot - s.v) > maxRisk) ? maxRisk : Math.max(minRisk, spot * padFrac); stop = spot - cap; stopBasis = s ? `capped below ${s.b}` : "volatility band"; }
    risk = entry - stop;
    const res = [];
    if (levels.callWall != null && levels.callWall > spot) res.push({ v: levels.callWall, b: "call wall" });
    if (levels.dayHi != null && levels.dayHi > spot) res.push({ v: levels.dayHi, b: "day high" });
    if (!isScalp && levels.srLevel != null && levels.srLevel > spot) res.push({ v: levels.srLevel, b: "20D level" });
    res.sort((a, b) => a.v - b.v);
    const t = res.find((x) => (x.v - spot) >= risk);
    if (t) { target = t.v; tgtBasis = t.b; } else { target = spot + 2 * risk; tgtBasis = "2R measured move"; }
  } else {
    const res = [];
    if (levels.dayHi != null && levels.dayHi > spot) res.push({ v: levels.dayHi, b: "intraday high" });
    if (levels.callWall != null && levels.callWall > spot) res.push({ v: levels.callWall, b: "call wall" });
    if (levels.flip != null && levels.flip > spot) res.push({ v: levels.flip, b: "gamma flip" });
    if (!isScalp && levels.srLevel != null && levels.srLevel > spot) res.push({ v: levels.srLevel, b: "20D level" });
    res.sort((a, b) => a.v - b.v);
    const r0 = res[0] || null;
    if (r0 && (r0.v - spot) >= minRisk && (r0.v - spot) <= maxRisk) { stop = r0.v; stopBasis = r0.b; }
    else { const cap = (r0 && (r0.v - spot) > maxRisk) ? maxRisk : Math.max(minRisk, spot * padFrac); stop = spot + cap; stopBasis = r0 ? `capped above ${r0.b}` : "volatility band"; }
    risk = stop - entry;
    const sup = [];
    if (levels.putWall != null && levels.putWall < spot) sup.push({ v: levels.putWall, b: "put wall" });
    if (levels.dayLo != null && levels.dayLo < spot) sup.push({ v: levels.dayLo, b: "day low" });
    if (!isScalp && levels.srLevel != null && levels.srLevel < spot) sup.push({ v: levels.srLevel, b: "20D level" });
    sup.sort((a, b) => b.v - a.v);
    const t = sup.find((x) => (spot - x.v) >= risk);
    if (t) { target = t.v; tgtBasis = t.b; } else { target = spot - 2 * risk; tgtBasis = "2R measured move"; }
  }
  if (!(risk > 0)) return null;
  const reward = Math.abs(target - entry);
  return {
    entry: dtR2(entry), stop: dtR2(stop), target: dtR2(target),
    rr: Math.round((reward / risk) * 100) / 100,
    riskPct: Math.round((risk / entry) * 1000) / 10,
    rewardPct: Math.round((reward / entry) * 1000) / 10,
    stopBasis, tgtBasis,
  };
}
// Structured thesis for a day trade — the conviction + what makes it work + what
// would disprove it + an honest "no strong thesis" disclosure (the same
// discipline the Top Picks thesisCard carries, scoped to the intraday horizon).
// Day trades are technical/flow reads, so the "market read" is the setup quality
// (volume + confirmed structure + momentum), not a macro-causal thesis.
export function dtBuildThesis(side, kind, heat, sr, dir, moveToday) {
  const bull = side === "long";
  const hasBreak = !!(sr && dtConvWeight(sr.conviction) >= 1.2);
  const strongBreak = !!(sr && dtConvWeight(sr.conviction) >= 2);
  // Supporting evidence (a day trade is a pure flow/structure read — no company
  // drivers): volume participation + a confirmed break + aligned momentum.
  const confirmation = [];
  confirmation.push({ key: "volume", label: `${heat.toFixed(1)}× expected volume by now`, pillar: "Flow", value: "real participation, not noise" });
  if (sr && sr.conviction && sr.conviction !== "None") confirmation.push({ key: "srBreak", label: `Confirmed 20D ${sr.type === "upper" ? "resistance breakout" : "support breakdown"} (${sr.conviction})`, pillar: "Technicals", value: sr.level != null ? `level $${dtR2(sr.level)}` : null });
  if (moveToday != null && isFinite(moveToday)) confirmation.push({ key: "momentum", label: `${moveToday >= 0 ? "+" : ""}${moveToday.toFixed(1)}% on the day`, pillar: "Technicals", value: "momentum aligned with the trade" });
  const invalidators = [];
  invalidators.push({ key: "volumeFade", trigger: `volume conviction fades (heat back under ${DT_HOT_MIN}× expected)` });
  if (sr && sr.level != null) invalidators.push({ key: "levelLost", trigger: `${bull ? "loses" : "reclaims"} the broken level ~$${dtR2(sr.level)}` });
  invalidators.push({ key: "noFollow", trigger: kind === "swing" ? `no follow-through within ${DT_SWING_MAX_HOLD_DAYS} sessions` : "fails to follow through by the close" });

  // Quality rubric (intraday-scoped, 0..6): volume + confirmed structure +
  // momentum + clear invalidation. Mirrors the Top Picks thesis-quality model.
  const checklist = [];
  const volPts = heat >= 1.5 ? 2 : heat >= 1.0 ? 1 : 0;
  checklist.push({ key: "volume", label: "Volume-backed participation", pass: volPts >= 1, points: volPts, detail: `${heat.toFixed(1)}× expected volume by now` });
  const structPts = strongBreak ? 2 : hasBreak ? 1 : 0;
  checklist.push({ key: "structure", label: "Confirmed structural break", pass: structPts >= 1, points: structPts, detail: hasBreak ? `confirmed 20D ${sr.type === "upper" ? "breakout" : "breakdown"} (${sr.conviction})` : "no confirmed 20-day break — momentum only" });
  const momPts = Math.abs(dir) >= 2 ? 1 : 0;
  checklist.push({ key: "momentum", label: "Momentum aligned with the trade", pass: momPts >= 1, points: momPts, detail: `directional score ${dir >= 0 ? "+" : ""}${dtR2(dir)}` });
  checklist.push({ key: "invalidation", label: "Clear invalidation levels", pass: true, points: 1, detail: (sr && sr.level != null) ? "the broken level + heat-fade + time stop" : "the heat-fade + time stop" });
  const score = volPts + structPts + momPts + 1;

  // Strong preserves the prior bar (a confirmed-break swing reads solid; a no-break
  // momentum scalp discloses) so the engine gates the option idea consistently.
  const tier = (hasBreak && heat >= 1.5 && Math.abs(dir) >= 1.5) ? "strong"
    : (hasBreak || (heat >= 1.5 && Math.abs(dir) >= 2)) ? "moderate"
    : "weak";
  const hasSolidThesis = tier === "strong";
  const conviction = tier === "strong" ? `High — confirmed ${bull ? "breakout" : "breakdown"} on ${heat.toFixed(1)}× volume`
    : tier === "moderate" ? `Moderate — ${hasBreak ? "confirmed structural break" : "strong volume + momentum"}, ${heat.toFixed(1)}× volume`
    : `Speculative — momentum/volume only, no confirmed break`;
  const disclosure = tier === "strong" ? null
    : tier === "weak"
      ? `Weak thesis — a ${kind === "scalp" ? "momentum scalp" : "volume read"} without a confirmed structural break. No option idea is recommended; if you take it, trade the shares tiny and honor the stop.`
      : `Moderate thesis — ${hasBreak ? "a confirmed break but lighter volume/momentum" : "strong volume + momentum but no confirmed break"}. Keep it small and honor the stop.`;
  const setup = hasBreak
    ? `a confirmed 20-day ${bull ? "breakout" : "breakdown"} carried by ${heat.toFixed(1)}× expected volume`
    : `a ${heat.toFixed(1)}× volume surge with ${bull ? "upside" : "downside"} momentum but no confirmed break`;
  const marketRead = {
    support: hasBreak ? "supports" : "neutral",
    text: `Short-horizon ${bull ? "bullish" : "bearish"} technical trade: ${setup}. This is a flow/structure read, not a macro thesis — manage it on the tape.`,
  };
  const edge = tier === "weak"
    ? { hasEdge: false, text: `A ${heat.toFixed(1)}× volume ${bull ? "push" : "drop"} but no confirmed structural break — not a clean enough edge for a defined option trade. Watch the tape.` }
    : { hasEdge: true, text: `${setup}, with ${tier === "strong" ? "momentum, volume and structure all aligned" : "the setup mostly aligned"} → a short-horizon ${bull ? "long" : "short"} while the tape holds the break.` };
  return {
    conviction, quality: { score, tier, checklist }, edge,
    companyDrivers: [], confirmation: confirmation.slice(0, 3), works: confirmation.slice(0, 3),
    invalidators: invalidators.slice(0, 3), marketRead, hasSolidThesis, disclosure,
  };
}

// Deterministic option-structure idea for a day trade (the picks strategy menu,
// mirrored to the intraday horizon). The scanner has no per-name IV-history
// z-score, so the choice is conviction-driven — strong+confirmed → a naked long
// for max convexity; otherwise a defined-risk debit spread — with a note about
// the credit-spread alternative when IV is rich (checkable on the Grade tab). A
// WEAK thesis (no confirmed break) recommends NO option idea (mirrors the Top
// Picks "high grade but weak thesis -> no strategy" gate).
export function dtBuildOptionIdea(side, kind, dir, sr, tier) {
  const bull = side === "long";
  const optSide = bull ? "call" : "put";
  const hasBreak = !!(sr && dtConvWeight(sr.conviction) >= 1.2);
  const strong = Math.abs(dir) >= 2 && hasBreak;
  if (tier === "weak") {
    return {
      structure: "none", side: optSide, label: "No option idea", dteGuide: null, moneyness: null,
      rationale: `No confirmed structural break — the thesis is too thin to define an options trade. Trade the shares small (if at all) on the plan above, or wait for a clean break.`,
      note: null,
    };
  }
  const dteGuide = kind === "swing" ? "this week to next (~5–12 DTE)" : "0–3 DTE (very short — size tiny)";
  if (strong) {
    return {
      structure: "naked", side: optSide, label: `Naked ${optSide}`,
      dteGuide, moneyness: "ATM / slightly ITM (~0.50–0.60Δ) for max delta",
      rationale: `Strong, confirmed ${bull ? "breakout" : "breakdown"} — a single long ${optSide} gives the most delta/gamma for a fast move. Accept the theta; this is a short hold.`,
      note: "If IV is richly bid (check the Grade tab), a debit spread caps the cost.",
    };
  }
  return {
    structure: "debit_spread", side: optSide, label: `${bull ? "Bull-call" : "Bear-put"} debit spread`,
    dteGuide, moneyness: "long ~0.45–0.55Δ, short a ~0.25Δ wing",
    rationale: `A grounded but not high-conviction ${bull ? "long" : "short"} — a debit spread gets the direction cheaper with slower theta than a naked option, which matters on a short hold.`,
    note: "If IV is unusually rich, sell a credit spread on the bias side instead.",
  };
}

// Turn one volume-flag row + its live quote into a tradeable candidate, or null.
// Fetch a day trade's option chain: the nearest LISTED expiration >= the kind's
// min DTE, with the raw Yahoo contract rows. Returns { spot, exp, calls, puts } or
// null. Best-effort — a fetch failure leaves the trade on the stock-move fallback.
async function dtFetchOptionChain(sym, kind) {
  try {
    const r0 = await fetchOptionsWithRetry(sym, {});
    const spot = dtNum(r0?.quote?.regularMarketPrice ?? r0?.quote?.postMarketPrice ?? r0?.quote?.preMarketPrice);
    const exps = Array.isArray(r0?.expirationDates)
      ? r0.expirationDates.map((d) => Math.round(new Date(d).getTime() / 1000)).filter((e) => isFinite(e))
      : [];
    const nowSec = Math.floor(Date.now() / 1000);
    const minDte = kind === "swing" ? DT_OPT_SWING_DTE : DT_OPT_SCALP_DTE;
    let entry = r0?.options?.[0] || null;
    let entryExp = entry?.expirationDate ? Math.round(new Date(entry.expirationDate).getTime() / 1000) : null;
    // If the nearest returned expiry is too soon for the kind, fetch the first
    // listed expiration that clears the min DTE (one extra call, only for swings).
    const wantExp = exps.find((e) => (e - nowSec) / 86400 >= minDte);
    if (wantExp && entryExp !== wantExp) {
      const r1 = await fetchOptionsWithRetry(sym, { date: new Date(wantExp * 1000) }).catch(() => null);
      if (r1?.options?.[0]) { entry = r1.options[0]; entryExp = wantExp; }
    }
    if (!entry || spot == null || entryExp == null) return null;
    return { spot, exp: entryExp, calls: entry.calls || [], puts: entry.puts || [] };
  } catch { return null; }
}

// Snapshot a real ~0.50Δ ATM contract for a day trade's option idea (modeled with
// Black-Scholes thereafter, like the Top Picks track record). Returns
// { side, strike, expiry, iv, entryPrem, entrySpot, riskPct } or null (no liquid
// ATM contract -> the trade falls back to stock-move P&L).
function dtPickOptionContract(chain, optSide, spot, stop, rfr = DT_OPT_RFR) {
  if (!chain || !chain.exp || !(spot > 0)) return null;
  const rows = optSide === "call" ? chain.calls : chain.puts;
  if (!Array.isArray(rows) || !rows.length) return null;
  const T = yearsToExpiry(chain.exp);
  if (!(T > 0)) return null;
  let best = null, bestErr = Infinity;
  for (const c of rows) {
    const strike = dtNum(c.strike), bid = dtNum(c.bid), ask = dtNum(c.ask), iv = dtNum(c.impliedVolatility);
    if (strike == null || iv == null || !(iv > 0)) continue;
    if (bid == null || ask == null || !(bid > 0) || !(ask > 0)) continue;
    const mid = (bid + ask) / 2;
    if (!(mid > 0) || (ask - bid) / mid > DT_OPT_MAX_SPREAD_PCT) continue;
    if ((dtNum(c.openInterest) || 0) < DT_OPT_MIN_OI) continue;
    const g = bsGreeks(optSide, spot, strike, T, iv, rfr);
    const err = Math.abs(Math.abs(g.delta) - DT_OPT_TARGET_DELTA);
    if (err < bestErr) { bestErr = err; best = { strike, iv, entryPrem: mid }; }
  }
  if (!best) return null;
  const opt = { side: optSide, strike: dtR2(best.strike), expiry: chain.exp, iv: best.iv, entryPrem: dtR2(best.entryPrem), entrySpot: dtR2(spot) };
  // The option "1R": its P&L if the stock instantly tags its stop (no decay yet) —
  // a meaningful risk denominator for the option's R-multiple.
  const atStop = dtMarkOption(opt, stop);
  opt.riskPct = (atStop != null) ? Math.abs(dtR2(atStop)) : null;
  return opt;
}

// Modeled option P&L % at an underlying spot, as of `atSec` (epoch seconds; default
// now). Entry IV held — a modeled mark, not a live options fill. T<=0 -> intrinsic.
function dtMarkOption(opt, spot, atSec = null) {
  if (!opt || !(spot > 0) || !(opt.entryPrem > 0)) return null;
  const nowSec = atSec != null ? atSec : Math.floor(Date.now() / 1000);
  const T = Math.max(0, (opt.expiry - nowSec) / (365 * 86400));
  let price;
  if (T <= 0) price = opt.side === "call" ? Math.max(0, spot - opt.strike) : Math.max(0, opt.strike - spot);
  else price = bsPrice(opt.side, spot, opt.strike, T, opt.iv, DT_OPT_RFR);
  if (!(price >= 0)) price = 0;
  return (price / opt.entryPrem - 1) * 100;
}

function dtBuildCandidate(row, quote) {
  const spot = (quote && quote.spot > 0) ? quote.spot : (row.spot > 0 ? row.spot : null);
  if (!(spot > 0)) return null;
  const heat = dtMaxVolRatio(row);
  if (!(heat >= DT_HOT_MIN)) return null;
  const changePct = quote?.changePct ?? null;
  const dir = dtDirection(row, changePct);
  if (Math.abs(dir) < DT_DIR_MIN) return null;
  const side = dir >= 0 ? "long" : "short";
  const sr = dtLatestSrBreak(row);
  const hasBreak = !!(sr && dtConvWeight(sr.conviction) >= 1.2);
  const kind = hasBreak ? "swing" : "scalp";
  // Don't chase: a fresh long into a name already up big on the day (or a short
  // into one already down big) buys the top / sells the bottom, leaving the stop
  // inside the noise to be taken on the first mean-reversion. The cap only bites
  // when the day's move is ALIGNED with the trade — a counter-move entry (e.g. a
  // confirmed breakout that has since pulled back red) is a dip, not a chase.
  const moveToday = (changePct != null && isFinite(changePct)) ? changePct : dtLatestMovePct(row);
  if (moveToday != null && isFinite(moveToday)
      && Math.sign(moveToday) === (side === "long" ? 1 : -1)
      && Math.abs(moveToday) > (hasBreak ? DT_CHASE_MAX_PCT_BREAK : DT_CHASE_MAX_PCT)) {
    return null;
  }
  const g = row.gex || null;
  const levels = {
    dayHi: dtNum(quote?.dayHi), dayLo: dtNum(quote?.dayLo),
    callWall: g && g.callWall ? dtNum(g.callWall.strike) : null,
    putWall: g && g.putWall ? dtNum(g.putWall.strike) : null,
    flip: dtNum(g?.flip),
    srLevel: sr ? dtNum(sr.level) : null,
  };
  const plan = dtBuildPlan(side, spot, levels, kind);
  if (!plan || !(plan.rr >= DT_MIN_RR)) return null;   // require a real positive payoff
  const dirStr = side === "long" ? "bullish" : "bearish";
  const srStr = sr ? ` · ${sr.type === "upper" ? "resistance" : "support"} break (${sr.conviction})` : "";
  const mvStr = (changePct != null && isFinite(changePct)) ? ` · ${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}% today` : "";
  const basis = `${heat.toFixed(1)}× expected volume · ${dirStr}${srStr}${mvStr}`;
  const dtThesis = dtBuildThesis(side, kind, heat, sr, dir, moveToday);
  return {
    sym: row.symbol, side, kind, plan,
    heat: Math.round(heat * 100) / 100,
    rank: heat * Math.abs(dir),
    basis,
    openDayHi: dtNum(quote?.dayHi), openDayLo: dtNum(quote?.dayLo),
    thesis: dtThesis,
    optionIdea: dtBuildOptionIdea(side, kind, dir, sr, dtThesis.quality.tier),
  };
}
function dtTradingDaysBetween(fromKey, toKey) {
  if (!fromKey || !toKey) return 0;
  const from = new Date(fromKey + "T12:00:00Z");
  const to = new Date(toKey + "T12:00:00Z");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  let n = 0;
  const d = new Date(from);
  while (d < to) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) n++;
  }
  return n;
}
// A touched-level check using the live spot AND the day's post-open extreme
// (a new day high/low after entry necessarily happened during the trade, so it
// catches an intra-hour wick the hourly spot read would miss). Stop wins a tie.
function dtEvaluateHit(t, liveSpot, hiSince, loSince) {
  if (t.side === "long") {
    const hitStop = liveSpot <= t.stop || loSince <= t.stop;
    const hitTarget = liveSpot >= t.target || hiSince >= t.target;
    if (hitStop) return "stop";
    if (hitTarget) return "target";
  } else {
    const hitStop = liveSpot >= t.stop || hiSince >= t.stop;
    const hitTarget = liveSpot <= t.target || loSince <= t.target;
    if (hitStop) return "stop";
    if (hitTarget) return "target";
  }
  return null;
}
function dtCloseTrade(t, outcome, exitPrice, scannedAt, todayKey) {
  const sign = t.side === "long" ? 1 : -1;
  // Stock-move P&L (kept as secondary context; the headline is the option).
  const stockPnlPct = dtR2(((exitPrice - t.entry) / t.entry) * 100 * sign);
  const stockRiskPct = (t.riskPct && t.riskPct > 0) ? t.riskPct : (Math.abs(t.entry - t.stop) / t.entry) * 100;
  // Score the OPTION (the recommended contract): mark it at the exit spot + the
  // close time (theta decayed). Win = the OPTION P&L sign — a target hit too slowly
  // (theta > delta) honestly records as a loss. No snapshot -> stock-move fallback.
  const atSec = Math.floor(Date.parse(scannedAt) / 1000) || Math.floor(Date.now() / 1000);
  const oPnl = t.opt ? dtMarkOption(t.opt, exitPrice, atSec) : null;
  let pnlPct, pnlR, win, optModeled = false;
  if (oPnl != null) {
    optModeled = true;
    pnlPct = dtR2(oPnl);
    const oRisk = (t.opt.riskPct && t.opt.riskPct > 0) ? t.opt.riskPct : null;
    pnlR = oRisk ? dtR2(pnlPct / oRisk) : null;
    win = oPnl >= 0;
  } else {
    pnlPct = stockPnlPct;
    pnlR = stockRiskPct > 0 ? dtR2(stockPnlPct / stockRiskPct) : null;
    win = outcome === "target" || (outcome === "expired" && stockPnlPct > 0);
  }
  return {
    id: t.id, sym: t.sym, side: t.side, kind: t.kind,
    entry: t.entry, stop: t.stop, target: t.target,
    openedAt: t.openedAt, openEtDate: t.openEtDate,
    closedAt: scannedAt, closedEtDate: todayKey,
    exitPrice: dtR2(exitPrice), outcome, win, pnlPct, pnlR,
    optModeled, stockPnlPct,
    opt: t.opt || null, optHiPct: t.optHiPct ?? null, optLoPct: t.optLoPct ?? null,
    basis: t.basis, pace: t.pace,
  };
}
function dtComputeStats(closed) {
  const decided = closed.length;
  let wins = 0, losses = 0, pnlSum = 0, rSum = 0, rN = 0, scalps = 0, swings = 0, tHit = 0, sHit = 0, exp = 0;
  for (const c of closed) {
    if (c.win) wins++; else losses++;
    if (c.pnlPct != null) pnlSum += c.pnlPct;
    if (c.pnlR != null) { rSum += c.pnlR; rN++; }
    if (c.kind === "scalp") scalps++; else if (c.kind === "swing") swings++;
    if (c.outcome === "target") tHit++; else if (c.outcome === "stop") sHit++; else exp++;
  }
  return {
    decided, wins, losses,
    winRate: decided > 0 ? Math.round((wins / decided) * 1000) / 1000 : null,
    avgPnlPct: decided > 0 ? Math.round((pnlSum / decided) * 100) / 100 : null,
    avgR: rN > 0 ? Math.round((rSum / rN) * 100) / 100 : null,
    scalps, swings, targetHits: tHit, stopHits: sHit, expired: exp,
  };
}
async function loadDayTrades() {
  try { const raw = await readFile(resolve(DATA_DIR, DAY_TRADES_FILE), "utf8"); const p = JSON.parse(raw); if (p && Array.isArray(p.trades)) return p; } catch {}
  return { trades: [] };
}
async function loadDayTradesHistory() {
  try { const raw = await readFile(resolve(DATA_DIR, DAY_TRADES_HISTORY_FILE), "utf8"); const p = JSON.parse(raw); if (p && Array.isArray(p.closed)) return p; } catch {}
  return { closed: [], stats: dtComputeStats([]) };
}

async function runDayTradePass({ volRows, quotesMap, scannedAt, marketState, nowDate }) {
  const todayKey = volEtDateKey(nowDate);
  const etMin = etMinutesSinceOpen(nowDate);
  const isRegular = marketState === "REGULAR";
  const isFinalScan = etMin != null && etMin >= SESSION_CLOSE_MIN;
  const inSession = isRegular && etMin != null && etMin >= 0 && etMin < SESSION_CLOSE_MIN;

  const prior = await loadDayTrades();
  const histState = await loadDayTradesHistory();
  let active = Array.isArray(prior?.trades) ? prior.trades.slice() : [];
  const closedThisRun = [];
  const closedTodaySyms = new Set(
    (histState.closed || []).filter((c) => c.closedEtDate === todayKey).map((c) => c.sym),
  );

  // 1. Mark every open trade to the live tape; close on TP/SL or expiry.
  const stillActive = [];
  for (const t of active) {
    const q = quotesMap.get(t.sym) || null;
    const liveSpot = (q && q.spot > 0) ? q.spot : (t.lastSpot ?? null);
    let hiSince = t.hiSinceOpen ?? t.openSpot ?? t.entry;
    let loSince = t.loSinceOpen ?? t.openSpot ?? t.entry;
    if (liveSpot != null) { hiSince = Math.max(hiSince, liveSpot); loSince = Math.min(loSince, liveSpot); }
    if (isRegular && q) {
      // Only fold in a NEW day extreme (beyond the day's range at entry) so a
      // pre-entry high/low can't false-trigger the trade.
      if (q.dayHi != null && t.openDayHi != null && q.dayHi > t.openDayHi) hiSince = Math.max(hiSince, q.dayHi);
      if (q.dayLo != null && t.openDayLo != null && q.dayLo < t.openDayLo) loSince = Math.min(loSince, q.dayLo);
    }
    t.hiSinceOpen = dtR2(hiSince);
    t.loSinceOpen = dtR2(loSince);
    if (liveSpot != null) { t.lastSpot = dtR2(liveSpot); t.lastAt = scannedAt; }
    const favSpot = t.side === "long" ? hiSince : loSince;
    const advSpot = t.side === "long" ? loSince : hiSince;
    t.mfePct = dtR1(((favSpot - t.entry) / t.entry) * 100 * (t.side === "long" ? 1 : -1));
    t.maePct = dtR1(((advSpot - t.entry) / t.entry) * 100 * (t.side === "long" ? 1 : -1));
    // Mark the recommended OPTION to the live tape (modeled, entry IV held) — the
    // contract P&L the track record scores, plus its peak/dip over the hold.
    if (t.opt && liveSpot != null) {
      const oPnl = dtMarkOption(t.opt, liveSpot, Math.floor(Date.parse(scannedAt) / 1000));
      if (oPnl != null) {
        t.optPnlPct = dtR2(oPnl);
        t.optHiPct = dtR2(Math.max(isFinite(t.optHiPct) ? t.optHiPct : -Infinity, oPnl));
        t.optLoPct = dtR2(Math.min(isFinite(t.optLoPct) ? t.optLoPct : Infinity, oPnl));
      }
    }

    let outcome = null, exitPrice = null;
    if (isRegular && liveSpot != null) {
      const hit = dtEvaluateHit(t, liveSpot, hiSince, loSince);
      if (hit) { outcome = hit; exitPrice = hit === "stop" ? t.stop : t.target; }
    }
    if (!outcome) {
      const isScalp = t.kind === "scalp";
      const expired = isScalp
        ? (t.openEtDate !== todayKey || isFinalScan)
        : (dtTradingDaysBetween(t.openEtDate, todayKey) >= DT_SWING_MAX_HOLD_DAYS);
      if (expired) { outcome = "expired"; exitPrice = (liveSpot != null) ? liveSpot : (t.lastSpot ?? t.entry); }
    }
    if (outcome) closedThisRun.push(dtCloseTrade(t, outcome, exitPrice, scannedAt, todayKey));
    else stillActive.push(t);
  }
  active = stillActive;
  for (const c of closedThisRun) closedTodaySyms.add(c.sym);

  // 2. Top the roster back up off the heaviest-volume names (live session only).
  if (inSession) {
    const haveSyms = new Set(active.map((t) => t.sym));
    const candidates = [];
    for (const row of (volRows || [])) {
      if (!row || !row.symbol) continue;
      if (haveSyms.has(row.symbol) || closedTodaySyms.has(row.symbol)) continue;
      const cand = dtBuildCandidate(row, quotesMap.get(row.symbol) || null);
      if (cand) candidates.push(cand);
    }
    candidates.sort((a, b) => b.rank - a.rank);
    for (const cand of candidates) {
      if (active.length >= DT_MAX_ACTIVE) break;
      const openedMs = Date.now();
      // Snapshot the recommended OPTION so the trade is scored on the contract, not
      // the stock move (best-effort; no liquid contract -> stock-move fallback). Only
      // the handful of newly-minted trades fetch a chain — marking reuses the snapshot.
      let opt = null;
      if (DT_OPT_TRACK) {
        const optChain = await dtFetchOptionChain(cand.sym, cand.kind);
        if (optChain) opt = dtPickOptionContract(optChain, cand.side === "long" ? "call" : "put", cand.plan.entry, cand.plan.stop);
      }
      active.push({
        id: `${cand.sym}-${openedMs}`,
        sym: cand.sym, side: cand.side, kind: cand.kind,
        entry: cand.plan.entry, stop: cand.plan.stop, target: cand.plan.target,
        rr: cand.plan.rr, riskPct: cand.plan.riskPct, rewardPct: cand.plan.rewardPct,
        stopBasis: cand.plan.stopBasis, tgtBasis: cand.plan.tgtBasis,
        openedAt: scannedAt, openEtDate: todayKey,
        openSpot: cand.plan.entry,
        openDayHi: cand.openDayHi, openDayLo: cand.openDayLo,
        hiSinceOpen: cand.plan.entry, loSinceOpen: cand.plan.entry,
        lastSpot: cand.plan.entry, lastAt: scannedAt,
        mfePct: 0, maePct: 0,
        opt, optModeled: !!opt, optPnlPct: opt ? 0 : null, optHiPct: opt ? 0 : null, optLoPct: opt ? 0 : null,
        basis: cand.basis, pace: cand.heat,
        thesis: cand.thesis || null, optionIdea: cand.optionIdea || null,
      });
      haveSyms.add(cand.sym);
    }
  }

  // 3. Persist the active roster + the rolling P/L history.
  await mkdir(DATA_DIR, { recursive: true });
  const closed = [...closedThisRun, ...(histState.closed || [])].slice(0, DT_HISTORY_MAX);
  const stats = dtComputeStats(closed);
  await writeFile(
    resolve(DATA_DIR, DAY_TRADES_HISTORY_FILE),
    JSON.stringify({ updatedAt: scannedAt, etDate: todayKey, stats, closed }),
    "utf8",
  );
  let longN = 0, shortN = 0, scalpN = 0, swingN = 0;
  for (const t of active) {
    if (t.side === "short") shortN++; else longN++;
    if (t.kind === "swing") swingN++; else scalpN++;
  }
  await writeFile(
    resolve(DATA_DIR, DAY_TRADES_FILE),
    JSON.stringify({
      scannedAt, etDate: todayKey, etMin, marketState: marketState || null,
      summary: { count: active.length, long: longN, short: shortN, scalps: scalpN, swings: swingN },
      trades: active,
    }),
    "utf8",
  );
  console.log(
    `wrote data/${DAY_TRADES_FILE} — ${active.length} active day trade${active.length === 1 ? "" : "s"} ` +
      `(${longN}L/${shortN}S, ${scalpN} scalp/${swingN} swing), ${closedThisRun.length} closed this run, ${closed.length} in history` +
      (stats.winRate != null ? ` (${Math.round(stats.winRate * 100)}% win rate)` : ""),
  );
}

async function main() {
  const scannedAt = new Date().toISOString();
  const nowMs = Date.now();
  // ET calendar date of this scan — used to gate the per-contract volume delta
  // (and stamped onto each history snapshot) so we never diff across sessions.
  const todayKey = etDateKey(scannedAt);
  // AI usage totals are shared with the daily build via data/ai-usage.json;
  // load at start so the per-call recordAiUsage() entries inside the flow
  // explanation pipeline accumulate onto today's totals.
  await loadAiUsageState();
  const history = await loadUnusualHistory();
  const log = await loadUnusualLog();
  const prevVolLookup = buildPrevVolLookup(history, todayKey);
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
  // Underlying-level scan results for the volume + S/R break pass. Populated
  // for every ticker we successfully fetched, regardless of whether any
  // options-flow hits were flagged.
  const volumeScanResults = [];
  let firstMarketState = null;
  let scannedCount = 0;
  let failedCount = 0;

  // Bounded worker pool — matches the daily build's TICKER_CONCURRENCY (now 6)
  // against the identical Yahoo options() endpoint, restoring the "track the
  // build" invariant this comment describes (it drifted to 4 when the build was
  // bumped 4→6). Each scan ticker fetches only FRONT_EXPIRATIONS=2 chains with
  // the same POLITENESS_MS pacing, so at 6 workers the aggregate options() rate
  // is ~17 req/s — *below* the build's empirically-clean ~18 req/s on this same
  // endpoint and runner IP — and the two workflows never run concurrently (the
  // shared concurrency group serializes them), so this adds no rate-limit risk.
  // Each worker keeps scanTicker's inner
  // per-expiration pacing plus a trailing politeness sleep. The collectors below
  // are append-only and the counters are plain numbers: JS runs these tasks
  // cooperatively on a single thread (interleaving only at awaits), so the
  // pushes/increments can't race. `firstMarketState` becomes "any scanned
  // ticker's market state" rather than strictly the first — harmless, since all
  // tickers report the same market.
  const scanList = TICKERS.filter((s) => !EXCLUDE_FROM_SCAN.has(s));
  let scanCursor = 0;
  async function scanWorker() {
    while (true) {
      const idx = scanCursor++;
      if (idx >= scanList.length) return;
      const symbol = scanList[idx];
      try {
        const result = await scanTicker(symbol, scannedAt, prevVolLookup, nowMs);
        if (!result) {
          failedCount++;
        } else {
          scannedCount++;
          if (!firstMarketState && result.marketState) firstMarketState = result.marketState;
          volumeScanResults.push({
            symbol: result.symbol,
            spot: result.spot,
            cumVol: result.cumVol,
            prevClose: result.prevClose,
            dayHigh: result.dayHigh,
            dayLow: result.dayLow,
            changePct: result.changePct,
          });
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
              out.firstSeen = prior?.firstSeen ?? scannedAt;
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
        }
      } catch (err) {
        failedCount++;
        console.log(`  ✗ ${symbol} — ${err.message}`);
      }
      await sleep(POLITENESS_MS);
    }
  }
  const SCAN_CONCURRENCY = 6;
  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, scanList.length) }, scanWorker),
  );

  tickerRows.sort((a, b) => b.topDelta - a.topDelta);

  // Abort before writing anything if a systemic fetch failure (e.g. Yahoo
  // IP-blocking the runner) means almost nothing came back. The first scan of a
  // session has no prior hits to carry over, so writing now would commit a
  // near-empty unusual.json + history (and a degraded volume-flags/heatmap),
  // blanking the tab and poisoning the next run's deltas. Exiting non-zero fails
  // the workflow step so the commit never runs and last-good data stays — this
  // sits before every write below (flow-explanations, unusual, history, log,
  // volume pass).
  const MIN_SCAN_SUCCESS_RATE = 0.5;
  const attempted = scannedCount + failedCount;
  if (attempted && scannedCount / attempted < MIN_SCAN_SUCCESS_RATE) {
    console.error(
      `Only ${scannedCount}/${attempted} tickers fetched (${((scannedCount / attempted) * 100).toFixed(0)}% < ${MIN_SCAN_SUCCESS_RATE * 100}%) — likely a systemic Yahoo block. Leaving last-good flow data in place.`,
    );
    process.exit(1);
  }

  // Carry over earlier-today hits so contracts that flagged at 10am stay on
  // the page at 2pm even if they didn't re-flag. The prior file is treated
  // as same-session only when its ET calendar date matches this scan's; on
  // the next market day (or a manual run on a different ET date) we reset
  // and only show this scan's hits.
  const prior = await loadPriorUnusual();
  const priorKey = prior ? etDateKey(prior.scannedAt) : null;
  const sameSession = !!(prior && todayKey && priorKey && todayKey === priorKey);
  const mergedTickers = sameSession ? mergeTickerRows(prior.tickers, tickerRows) : tickerRows;
  const carriedOver = sameSession
    ? mergedTickers.reduce((sum, t) => sum + t.contracts.length, 0) - tickerRows.reduce((sum, t) => sum + t.contracts.length, 0)
    : 0;

  // AI-explain each contract before serializing payload — the note ends
  // up on each contract object via direct mutation. Cache lives in
  // data/flow-explanations.json; misses incur a Gemini Flash-Lite call.
  const nowSec = Math.floor(nowMs / 1000);
  const flowCache = await attachFlowExplanations(mergedTickers, scannedAt, nowSec);

  // Attach a compact gamma-exposure read to each flagged ticker (net GEX,
  // gamma flip, call/put walls) computed from the baked full chain at the
  // scan's live spot. Done after the merge so carried-over rows get a fresh
  // read too, and best-effort per ticker so a missing per-ticker JSON just
  // omits the strip rather than failing the row.
  await Promise.all(
    mergedTickers.map(async (t) => {
      t.gex = await loadTickerGex(t.symbol, t.spot);
    }),
  );

  const contractCount = mergedTickers.reduce((sum, t) => sum + t.contracts.length, 0);
  const hottestDelta = mergedTickers[0]?.topDelta ?? 0;

  const payload = {
    scannedAt,
    marketState: firstMarketState,
    summary: {
      tickerCount: mergedTickers.length,
      contractCount,
      hottestDelta,
      scanned: scannedCount,
      failed: failedCount,
      hadPrior: !!prevVolLookup,
    },
    tickers: mergedTickers,
  };

  await mkdir(DATA_DIR, { recursive: true });
  const outPath = resolve(DATA_DIR, "unusual.json");
  await writeFile(outPath, JSON.stringify(payload), "utf8");
  console.log(
    `wrote ${outPath} — ${mergedTickers.length} ticker${mergedTickers.length === 1 ? "" : "s"}, ${contractCount} contract${contractCount === 1 ? "" : "s"} flagged${hottestDelta ? `, hottest +${hottestDelta}/hr` : ""}` +
      (sameSession ? ` (${carriedOver} carried from earlier today)` : prior ? " (new session — prior day reset)" : ""),
  );

  // Append this scan to history. Persist EVERY in-band candidate (above the
  // min-vol floor), not just the flagged hits, so next hour's scan can
  // compute deltas for contracts that didn't flag this hour.
  history.snapshots.push({
    scannedAt,
    etDate: todayKey,
    // etMin lets buildPrevVolLookup skip pre-open snapshots next run (legacy
    // snapshots without it are treated as not-usable and age out in one scan).
    etMin: etMinutesSinceOpen(new Date(scannedAt)),
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

  if (flowCache) {
    await writeFlowExplanations(flowCache);
  }

  // Intraday volume + S/R break pass — reuses the cumVol / spot / prevClose
  // already pulled from each ticker's options() response above. Writes
  // data/volume-flags.json (today's flagged tickers, merged across same-
  // session scans) and data/volume-history.json (rolling snapshots used by
  // the next scan to compute hour-over-hour deltas). Independent of the
  // unusual-options-flow output — never throws back into the main flow so
  // one bad ticker's per-ticker JSON read can't kill the whole scan.
  let volRows = null;
  try {
    volRows = await runVolumePass({
      perTickerResults: volumeScanResults,
      scannedAt,
      marketState: firstMarketState,
      nowDate: new Date(scannedAt),
    });
  } catch (err) {
    console.log(`volume pass failed: ${err.message}`);
  }

  // LIVE Day Trades roster — mark open positions to the tape, close any that
  // hit their take-profit / stop-loss into the P/L history, then top up off the
  // volume board. Best-effort: a failure here must never blank the scan's other
  // outputs (a missed volume pass still lets open trades be managed/closed off
  // the live quotes). Writes data/day-trades.json + data/day-trades-history.json.
  try {
    const quotesMap = new Map();
    for (const r of volumeScanResults) {
      if (!r || !r.symbol) continue;
      quotesMap.set(r.symbol, { spot: r.spot, dayHi: r.dayHigh, dayLo: r.dayLow, changePct: r.changePct });
    }
    await runDayTradePass({
      volRows: volRows || [],
      quotesMap,
      scannedAt,
      marketState: firstMarketState,
      nowDate: new Date(scannedAt),
    });
  } catch (err) {
    console.log(`day-trades pass failed: ${err.message}`);
  }

  await writeAiUsageState();
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
    deltaPremium: c.deltaPremium,
    tape: c.tape,
    scannedAt: c.scannedAt,
  };
}

// Pure helpers exported for the offline day-trades smoke test (scripts/
// day-trades-smoke.mjs). Importing this module must NOT trigger a live scan —
// only run main() when invoked directly (mirrors build.mjs's entry guard).
export {
  dtBuildPlan, dtBuildCandidate, dtDirection, dtEvaluateHit, dtCloseTrade,
  dtComputeStats, dtTradingDaysBetween, dtPickOptionContract, dtMarkOption,
  // The volume + Day Trades engine passes, reused by the lightweight
  // high-frequency runner (scripts/scan-day-trades.mjs) so new ideas + TP/SL
  // closes land between the hourly full scans. DATA_DIR is shared so both
  // runners read/write the same data/ tree.
  runVolumePass, runDayTradePass, DATA_DIR,
};

const isEntryPoint = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
