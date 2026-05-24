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
import { fileURLToPath } from "node:url";
import YahooFinance from "yahoo-finance2";
import { GoogleGenAI } from "@google/genai";
import { TICKERS, recordAiUsage, loadAiUsageState, writeAiUsageState } from "./build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");

// Strike scan band is wider than the OTM-flag band so we still see a few
// ITM strikes for context, but only OTM 5–50% can actually flag.
const STRIKE_BAND = 0.55;
const FRONT_EXPIRATIONS = 3;
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
// AI explanation pipeline. Each flagged contract gets a one-paragraph
// plain-English read of WHY it's unusual (vol vs OI, OTM distance, DTE,
// tape, IV, premium). Results cached per-contract in
// data/flow-explanations.json so re-flags of the same contract in
// subsequent hourly scans don't re-call the model. Cache entries are
// pruned when the contract's expiration date passes.
const FLOW_EXPLANATIONS_FILE = "flow-explanations.json";
const AI_FLOW_MODEL = process.env.AI_FLOW_MODEL || "gemini-2.5-flash-lite";
// Modest concurrency — we expect ≤20 new anomalies per scan, and the
// shared Gemini Flash-Lite quota is generous, but cap to keep retries
// from stampeding.
const AI_FLOW_CONCURRENCY = 5;
const AI_FLOW_MAX_ATTEMPTS = 4;
const AI_FLOW_RETRY_BACKOFF_MS = [2000, 6000, 15000];
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
      map.set(key, { count: 1, lastSeen: e.scannedAt, lastSeenMs: t });
    } else {
      prior.count += 1;
      if (t > prior.lastSeenMs) { prior.lastSeen = e.scannedAt; prior.lastSeenMs = t; }
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
        model: AI_FLOW_MODEL,
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
        model: AI_FLOW_MODEL,
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

async function main() {
  const scannedAt = new Date().toISOString();
  const nowMs = Date.now();
  // AI usage totals are shared with the daily build via data/ai-usage.json;
  // load at start so the per-call recordAiUsage() entries inside the flow
  // explanation pipeline accumulate onto today's totals.
  await loadAiUsageState();
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

  // Carry over earlier-today hits so contracts that flagged at 10am stay on
  // the page at 2pm even if they didn't re-flag. The prior file is treated
  // as same-session only when its ET calendar date matches this scan's; on
  // the next market day (or a manual run on a different ET date) we reset
  // and only show this scan's hits.
  const prior = await loadPriorUnusual();
  const todayKey = etDateKey(scannedAt);
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
    tape: c.tape,
    scannedAt: c.scannedAt,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
