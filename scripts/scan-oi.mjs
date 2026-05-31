// Twice-daily near-term open-interest tracker. Sweeps the curated ticker
// universe and snapshots the front two option-chain expirations (this week
// + next week) for each symbol. For every ticker we surface:
//
//   • Top 12 highest-OI strikes (calls + puts, mixed)
//   • Call wall (highest call-OI strike) and put wall (highest put-OI strike)
//   • Call/Put OI ratio across the short-dated chain
//   • Per-strike Δ open interest vs the most recent prior-trading-day
//     snapshot (Δ + %Δ), with +30% / +100% flag chips
//   • Vol / OI ratio per strike (only meaningful for the EOD scan — pre-
//     market scans have zero session volume so this rolls to 0)
//   • % distance from spot, plus an OI > 1000 chip
//   • Gamma Squeeze Score 0–5 with reason chips, computed rule-by-rule
//     against the 5 criteria in CLAUDE.md / the product spec
//
// Scheduling (managed externally by cron-job.org, dispatched as
// .github/workflows/oi-tracker.yml):
//   • Pre-market scan ~08:30 ET (1h before the bell). OI is reported T+1, so
//     this is when the overnight OI update lands — ΔOI vs the prior
//     trading-day snapshot reflects the just-closed session's net OI change.
//     Session volume is 0, so rule 3 of the gamma score can't fire pre-market.
//   • EOD scan ~19:00 ET (3h after the close). Re-runs mainly to light up the
//     volume-based signals (rule 3 needs session volume). Today's trades won't
//     post to OI until tomorrow's T+1 update, so this scan's ΔOI equals the
//     morning scan's — it reflects the prior session, NOT today's OI move.
//
// Writes:
//   data/oi-tracker.json    Today's payload (consumed by the UI via
//                           MANIFEST.oi).
//   data/oi-history.json    Rolling ~6 snapshots used to compute ΔOI
//                           against the previous trading-day snapshot.
//                           Bounded so the file stays small.
//
// Gracefully degrades: when no prior-day snapshot exists (first run) ΔOI
// fields are null and the UI renders "—". When unusual.json is missing
// the "aggressive ask flow" rule simply doesn't fire.

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YahooFinance from "yahoo-finance2";
import { TICKERS } from "./build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");

// Number of front expirations to fetch — "this week + next week" in the
// product spec. For weekly-options tickers this is literally Friday this
// week + Friday next week. For monthlies-only tickers it falls through to
// the front two monthlies, which is still the most relevant near-term OI.
const FRONT_EXPIRATIONS = 2;

// Strike scan band: ±60% of spot. Wider than the unusual-flow scanner's
// ±55% so we don't accidentally clip a deep ITM put wall on a high-
// volatility name. Tighter than unbounded so we don't pull thousands of
// lottery-ticket strikes that will never matter for gamma exposure.
const STRIKE_BAND = 0.60;

// Top-N OI strikes to surface per ticker. Spec says "top 12".
const TOP_STRIKES = 12;

// Floor at which a strike's OI is large enough to surface a chip. Spec
// says "OI > 1000+".
const BIG_OI = 1000;

// ΔOI flag thresholds (per spec):
//   +30%  → new buying, surface a chip
//   +100% → very aggressive new buying, stronger chip
const DELTA_OI_PCT_NEW = 0.30;
const DELTA_OI_PCT_AGGR = 1.00;
// A strike that went from 0 OI yesterday to a meaningful book today is the
// strongest new-positioning signal there is — an infinite % increase that the
// prevOi>0 percentage simply can't express. We surface it as both ΔOI chips
// when the fresh OI clears the "big OI" bar, so 0→noise (e.g. 0→3) doesn't
// trip it. Reusing BIG_OI keeps this on the same notability scale as the rest
// of the tracker rather than inventing a new magic number.
const NEW_OI_FROM_ZERO_FLOOR = BIG_OI;

// Gamma squeeze "near the money" band: 0–12% OTM (calls).
const NEAR_THE_MONEY_OTM_MAX = 0.12;

// Gamma squeeze rule thresholds (made explicit for tuning).
//   CONCENTRATED_RATIO: a near-the-money strike's OI must be at least
//     this multiple of the average call OI across all short-dated
//     strikes for rule 1 ("concentrated"). With BIG_OI as the absolute
//     floor this catches "a wall is forming" rather than "everything is
//     evenly noisy".
//   CP_RATIO_HOT: call/put OI ratio that fires rule 2.
//   VOL_OVER_OI_HOT: Vol/OI on the top call wall strike that fires
//     rule 3. Spec says "Vol >> OI (Vol 1.5x+ higher than OI)".
//   NEAR_WALL_PCT: how close spot has to be to the call wall for rule 4
//     to fire. Spec says "within 10%".
//   GAMMA_FLAG_MIN: score at which we set ticker.flagged = true. Spec
//     says 4 or 5 = strong potential setup.
const CONCENTRATED_RATIO = 1.5;
const CP_RATIO_HOT = 2.0;
const VOL_OVER_OI_HOT = 1.5;
const NEAR_WALL_PCT = 0.10;
const GAMMA_FLAG_MIN = 4;

// Rolling-history retention. Each snapshot stores per-strike OI for every
// in-band contract across every ticker, so size grows quickly — bounded
// retention keeps the committed file under ~1MB even after weeks of
// twice-daily runs. ~6 snapshots = roughly 3 trading days, more than
// enough headroom to pick up "yesterday's EOD" even if a dispatch is
// missed.
const HISTORY_FILE = "oi-history.json";
const HISTORY_MAX_SNAPSHOTS = 6;

// Politeness between Yahoo expiration fetches per ticker. Same delay
// scan-unusual.mjs uses.
const POLITENESS_MS = 250;

// Retry budget mirrors scan-unusual.mjs — Yahoo intermittently 401s
// GitHub Actions runner IPs ("Host not in allowlist") and benefits from
// a quick re-try at increasing backoff before giving up on a ticker.
const FETCH_RETRIES = 3;
const FETCH_BACKOFF_MS = [1000, 3000, 8000];
const YAHOO_CALL_TIMEOUT_MS = 12000;

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

// YYYY-MM-DD in America/New_York. Used to find the previous trading-day
// snapshot in history — we want "the most recent snapshot whose etDate is
// strictly earlier than today's", which is always yesterday's EOD when
// both scans ran.
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

// Heuristic for the scan label. Pre-market run sits in 6–10 ET, EOD run
// sits in 16–22 ET. Anything else (manual / out-of-band) is tagged
// "manual" so it doesn't get misclassified.
function classifyScan(date) {
  const etHour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false })
      .format(date)
      .replace(/[^0-9]/g, ""),
  );
  if (etHour >= 6 && etHour < 10) return "premarket";
  if (etHour >= 16 && etHour < 22) return "eod";
  return "manual";
}

async function loadOiHistory() {
  try {
    const raw = await readFile(resolve(DATA_DIR, HISTORY_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.snapshots)) return parsed;
    return { snapshots: [] };
  } catch {
    return { snapshots: [] };
  }
}

// Picks the most recent snapshot whose etDate is strictly before
// today's. That's always yesterday's last scan (EOD if both runs landed,
// pre-market if only one). Returns null on a cold start.
function findPreviousDaySnapshot(history, todayKey) {
  const snaps = (history.snapshots || []).slice().reverse();
  for (const snap of snaps) {
    if (snap?.etDate && snap.etDate !== todayKey) return snap;
  }
  return null;
}

// Compresses a prior snapshot into a Map keyed by contract identity so
// per-strike ΔOI lookups stay O(1) in the hot loop.
function buildPrevOiLookup(snap) {
  if (!snap || !Array.isArray(snap.contracts)) return null;
  const map = new Map();
  for (const h of snap.contracts) {
    if (h.symbol == null || h.strike == null || h.expSec == null || !h.side) continue;
    map.set(`${h.symbol}|${h.side}|${h.strike}|${h.expSec}`, {
      oi: h.oi ?? 0,
      vol: h.vol ?? 0,
    });
  }
  return map;
}

// Pulls today's unusual-flow file so rule 5 of the gamma score can read
// "aggressive ask buying" for a ticker. Soft-fails: missing or corrupt
// file just disables the rule.
async function loadUnusualForFlow() {
  try {
    const raw = await readFile(resolve(DATA_DIR, "unusual.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.tickers)) return parsed;
  } catch {}
  return null;
}

// Returns the set of symbols that have at least one CALL hit with
// tape === "ask" in today's unusual.json. That's our rule-5 input.
function buildAskCallSymbols(unusual) {
  const set = new Set();
  if (!unusual) return set;
  for (const t of unusual.tickers || []) {
    for (const c of t.contracts || []) {
      if (c.side === "call" && c.tape === "ask") {
        set.add(t.symbol);
        break;
      }
    }
  }
  return set;
}

// Fetches the front-N expirations for a ticker and returns every in-band
// contract (calls + puts, both sides, every strike). Mirrors the scan-
// unusual.mjs pattern: pull the first expiration via the bare options()
// call, then iterate the remaining expirationDates with explicit { date }.
async function fetchTickerChain(symbol) {
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

  const contracts = [];
  const ingest = (entry, expSec) => {
    for (const c of entry.calls || []) {
      if (!inBand(c)) continue;
      contracts.push({
        symbol,
        side: "call",
        strike: c.strike,
        expSec,
        oi: c.openInterest ?? 0,
        vol: c.volume ?? 0,
        last: c.lastPrice ?? null,
        bid: c.bid ?? null,
        ask: c.ask ?? null,
        iv: c.impliedVolatility ?? null,
      });
    }
    for (const c of entry.puts || []) {
      if (!inBand(c)) continue;
      contracts.push({
        symbol,
        side: "put",
        strike: c.strike,
        expSec,
        oi: c.openInterest ?? 0,
        vol: c.volume ?? 0,
        last: c.lastPrice ?? null,
        bid: c.bid ?? null,
        ask: c.ask ?? null,
        iv: c.impliedVolatility ?? null,
      });
    }
  };

  const firstEntry = first.options?.[0];
  const firstExpSec = firstEntry?.expirationDate
    ? Math.round(new Date(firstEntry.expirationDate).getTime() / 1000)
    : null;
  if (firstEntry && firstExpSec) ingest(firstEntry, firstExpSec);

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
      ingest(entry, expSec);
    } catch (err) {
      console.log(`    · ${symbol} expiration ${d.toISOString().slice(0, 10)} failed: ${err.message}`);
    }
  }

  return { symbol, spot, marketState, contracts };
}

// % distance from spot, signed. Calls: positive = OTM (strike above spot).
// Puts: positive = OTM (strike below spot). Stored as a fraction
// (0.034 = 3.4%) so the UI can format consistently.
function otmPct(side, strike, spot) {
  if (!(spot > 0) || strike == null) return null;
  return side === "call" ? (strike - spot) / spot : (spot - strike) / spot;
}

// Enriches each contract with rendering fields. Pure transform, no
// network. `prevOiLookup` is from yesterday's EOD; null on cold start.
function decorateContract(c, spot, prevOiLookup) {
  const key = `${c.symbol}|${c.side}|${c.strike}|${c.expSec}`;
  const prev = prevOiLookup ? prevOiLookup.get(key) : null;
  const prevOi = prev?.oi ?? null;
  const oiDelta = prevOi != null ? c.oi - prevOi : null;
  const oiDeltaPct = prevOi != null && prevOi > 0 ? oiDelta / prevOi : null;
  // 0 → big book: the percentage above is null (can't divide by 0), so flag
  // it explicitly off the absolute fresh OI instead of dropping the signal.
  const freshFromZero = prevOi === 0 && c.oi >= NEW_OI_FROM_ZERO_FLOOR;
  const volOiRatio = c.oi > 0 ? c.vol / c.oi : null;
  const fromSpot = otmPct(c.side, c.strike, spot);
  return {
    ...c,
    prevOi,
    oiDelta,
    oiDeltaPct: oiDeltaPct != null ? Math.round(oiDeltaPct * 1000) / 1000 : null,
    volOiRatio: volOiRatio != null ? Math.round(volOiRatio * 100) / 100 : null,
    fromSpotPct: fromSpot != null ? Math.round(fromSpot * 1000) / 1000 : null,
    flagOiBig: c.oi >= BIG_OI,
    flagOiDelta30: freshFromZero || (oiDeltaPct != null && oiDeltaPct >= DELTA_OI_PCT_NEW),
    flagOiDelta100: freshFromZero || (oiDeltaPct != null && oiDeltaPct >= DELTA_OI_PCT_AGGR),
  };
}

// Top-N strikes by absolute OI across calls + puts mixed. Ties broken
// by side (call before put) then by lower strike — stable and
// deterministic.
function pickTopStrikes(contracts) {
  return contracts
    .slice()
    .sort((a, b) => {
      if (b.oi !== a.oi) return b.oi - a.oi;
      if (a.side !== b.side) return a.side === "call" ? -1 : 1;
      return a.strike - b.strike;
    })
    .slice(0, TOP_STRIKES);
}

// Find the highest-OI strike for one side.
function highestOi(contracts, side) {
  let best = null;
  for (const c of contracts) {
    if (c.side !== side) continue;
    if (!best || c.oi > best.oi) best = c;
  }
  return best;
}

// Sum OI on one side across the full short-dated chain.
function sumOi(contracts, side) {
  let total = 0;
  for (const c of contracts) if (c.side === side) total += c.oi;
  return total;
}

// Computes the gamma squeeze score for one ticker. Returns
// { score, reasons[] } where reasons is the user-facing breakdown of
// which rules fired. Pure function — no I/O.
function computeGammaScore({ contracts, spot, callWall, callOiTotal, putOiTotal, askCallFlow }) {
  const reasons = [];
  let score = 0;

  // Rule 1: heavy call OI concentrated in the 0–12% OTM band, this/next
  // week. "Concentrated" = a single strike's OI is ≥ CONCENTRATED_RATIO
  // × the average call OI across all short-dated strikes AND ≥ BIG_OI
  // in absolute terms.
  const callStrikes = contracts.filter((c) => c.side === "call");
  const avgCallOi = callStrikes.length
    ? callStrikes.reduce((s, c) => s + c.oi, 0) / callStrikes.length
    : 0;
  const nearMoneyCalls = callStrikes.filter((c) => {
    const otm = otmPct("call", c.strike, spot);
    return otm != null && otm >= 0 && otm <= NEAR_THE_MONEY_OTM_MAX;
  });
  const concentratedNearMoney = nearMoneyCalls.find(
    (c) => c.oi >= BIG_OI && (avgCallOi <= 0 || c.oi >= CONCENTRATED_RATIO * avgCallOi),
  );
  if (concentratedNearMoney) {
    score += 1;
    reasons.push({
      rule: "concentrated",
      label: `Heavy call OI at $${concentratedNearMoney.strike} (${(otmPct("call", concentratedNearMoney.strike, spot) * 100).toFixed(1)}% OTM)`,
    });
  }

  // Rule 2: call / put OI ratio ≥ CP_RATIO_HOT.
  const cpRatio = putOiTotal > 0 ? callOiTotal / putOiTotal : (callOiTotal > 0 ? Infinity : 0);
  if (cpRatio >= CP_RATIO_HOT) {
    score += 1;
    reasons.push({
      rule: "cp_ratio",
      label: `C/P OI ratio ${isFinite(cpRatio) ? cpRatio.toFixed(2) : "∞"}:1`,
    });
  }

  // Rule 3: today's call volume on the call wall strike "much greater"
  // than its OI. Only meaningful on the EOD scan — in pre-market the
  // session hasn't started, so vol = 0 and this rule never fires.
  if (callWall && callWall.oi > 0) {
    const ratio = callWall.vol / callWall.oi;
    if (ratio >= VOL_OVER_OI_HOT) {
      score += 1;
      reasons.push({
        rule: "vol_over_oi",
        label: `Call wall Vol/OI ${ratio.toFixed(2)}× (Vol ${callWall.vol.toLocaleString()})`,
      });
    }
  }

  // Rule 4: spot is within NEAR_WALL_PCT of the highest call OI strike.
  // Distance is unsigned — a stock 5% above the wall or 5% below both
  // count as "approaching".
  if (callWall && spot > 0) {
    const distance = Math.abs(callWall.strike - spot) / spot;
    if (distance <= NEAR_WALL_PCT) {
      score += 1;
      reasons.push({
        rule: "near_wall",
        label: `Spot ${(distance * 100).toFixed(1)}% from call wall $${callWall.strike}`,
      });
    }
  }

  // Rule 5: unusual.json has at least one CALL hit on this ticker bought
  // at the ask (sweep/block buying pressure). Captures the "fresh
  // aggressive bet" signal from the spec without needing to re-fetch
  // tape data ourselves.
  if (askCallFlow) {
    score += 1;
    reasons.push({
      rule: "ask_sweeps",
      label: "Aggressive call buying at the ask in today's flow",
    });
  }

  return { score, reasons };
}

async function main() {
  const scannedAtDate = new Date();
  const scannedAt = scannedAtDate.toISOString();
  const todayKey = etDateKey(scannedAt);
  const scanType = classifyScan(scannedAtDate);

  const history = await loadOiHistory();
  const prevSnap = findPreviousDaySnapshot(history, todayKey);
  const prevOiLookup = buildPrevOiLookup(prevSnap);
  const baselineEtDate = prevSnap?.etDate ?? null;

  const unusual = await loadUnusualForFlow();
  const askCallSymbols = buildAskCallSymbols(unusual);

  // OI_SCAN_LIMIT env var caps the universe to the first N tickers —
  // useful for local smoke tests and CI dry runs without hitting Yahoo
  // for the full ~137 symbols. Unset in production.
  const SCAN_TICKERS = process.env.OI_SCAN_LIMIT
    ? TICKERS.slice(0, Number(process.env.OI_SCAN_LIMIT))
    : TICKERS;

  console.log(
    `Scanning ${SCAN_TICKERS.length} tickers for near-term OI (${scanType} scan, ` +
      (prevOiLookup ? `ΔOI baseline: ${baselineEtDate}` : "no prior-day baseline yet") +
      ", " + (unusual ? `${askCallSymbols.size} tickers with ask-side call flow` : "no unusual.json available") +
      ")…",
  );

  const tickerRows = [];
  const historyContracts = [];
  let firstMarketState = null;
  let scannedCount = 0;
  let failedCount = 0;
  let flaggedCount = 0;

  for (const symbol of SCAN_TICKERS) {
    try {
      const result = await fetchTickerChain(symbol);
      if (!result) {
        failedCount++;
        continue;
      }
      scannedCount++;
      if (!firstMarketState && result.marketState) firstMarketState = result.marketState;

      const decorated = result.contracts.map((c) => decorateContract(c, result.spot, prevOiLookup));

      // History persists every in-band contract's raw OI + vol so the
      // next scan can compute ΔOI for any strike, not just the top 12
      // we surface today.
      for (const c of result.contracts) {
        if (c.oi > 0 || c.vol > 0) {
          historyContracts.push({
            symbol: c.symbol,
            side: c.side,
            strike: c.strike,
            expSec: c.expSec,
            oi: c.oi,
            vol: c.vol,
          });
        }
      }

      const callWall = highestOi(decorated, "call");
      const putWall = highestOi(decorated, "put");
      const callOiTotal = sumOi(decorated, "call");
      const putOiTotal = sumOi(decorated, "put");
      const cpRatio = putOiTotal > 0 ? callOiTotal / putOiTotal : (callOiTotal > 0 ? Infinity : 0);

      const { score, reasons } = computeGammaScore({
        contracts: decorated,
        spot: result.spot,
        callWall,
        callOiTotal,
        putOiTotal,
        askCallFlow: askCallSymbols.has(symbol),
      });

      const topStrikes = pickTopStrikes(decorated).map(stripStrike);
      const totalOi = callOiTotal + putOiTotal;

      // Skip tickers with no surfaced OI — these are typically newly-
      // listed names with no chain activity in the front two
      // expirations. They'd render as empty rows and add noise.
      if (totalOi === 0) {
        console.log(`  · ${symbol} — no OI in front ${FRONT_EXPIRATIONS} expirations`);
        continue;
      }

      const flagged = score >= GAMMA_FLAG_MIN;
      if (flagged) flaggedCount++;

      tickerRows.push({
        symbol: result.symbol,
        spot: result.spot,
        callWall: callWall ? { strike: callWall.strike, oi: callWall.oi, expSec: callWall.expSec } : null,
        putWall: putWall ? { strike: putWall.strike, oi: putWall.oi, expSec: putWall.expSec } : null,
        cpRatio: isFinite(cpRatio) ? Math.round(cpRatio * 100) / 100 : null,
        callOiTotal,
        putOiTotal,
        score,
        flagged,
        reasons,
        strikes: topStrikes,
      });

      const status = flagged ? "⚠" : "·";
      console.log(`  ${status} ${symbol} — score ${score}/5, C/P ${isFinite(cpRatio) ? cpRatio.toFixed(2) : "∞"}, top strike $${topStrikes[0]?.strike ?? "—"}`);
    } catch (err) {
      failedCount++;
      console.log(`  ✗ ${symbol} — ${err.message}`);
    }
    await sleep(POLITENESS_MS);
  }

  // Sort tickers: flagged first (highest score), then by score desc,
  // then by total OI desc. Gives the UI a sensible default order.
  tickerRows.sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return (b.callOiTotal + b.putOiTotal) - (a.callOiTotal + a.putOiTotal);
  });

  const payload = {
    scannedAt,
    scanType,
    etDate: todayKey,
    baselineEtDate,
    marketState: firstMarketState,
    summary: {
      tickerCount: tickerRows.length,
      flaggedCount,
      scanned: scannedCount,
      failed: failedCount,
      hadBaseline: !!prevOiLookup,
    },
    tickers: tickerRows,
  };

  await mkdir(DATA_DIR, { recursive: true });
  const outPath = resolve(DATA_DIR, "oi-tracker.json");
  await writeFile(outPath, JSON.stringify(payload), "utf8");
  console.log(
    `wrote ${outPath} — ${tickerRows.length} ticker${tickerRows.length === 1 ? "" : "s"}, ${flaggedCount} flagged (score ≥ ${GAMMA_FLAG_MIN})`,
  );

  history.snapshots.push({
    scannedAt,
    etDate: todayKey,
    scanType,
    contracts: historyContracts,
  });
  history.snapshots = history.snapshots.slice(-HISTORY_MAX_SNAPSHOTS);
  const historyPath = resolve(DATA_DIR, HISTORY_FILE);
  await writeFile(historyPath, JSON.stringify(history), "utf8");
  console.log(
    `wrote ${historyPath} — ${history.snapshots.length}/${HISTORY_MAX_SNAPSHOTS} snapshot${history.snapshots.length === 1 ? "" : "s"} retained, ${historyContracts.length} contracts in this snapshot`,
  );
}

// Trim a decorated contract down to the fields the UI actually renders.
// Keeps the payload tight — the full per-strike chain would otherwise be
// included on every commit and bloat the data file.
function stripStrike(c) {
  return {
    side: c.side,
    strike: c.strike,
    expSec: c.expSec,
    oi: c.oi,
    vol: c.vol,
    iv: c.iv,
    prevOi: c.prevOi,
    oiDelta: c.oiDelta,
    oiDeltaPct: c.oiDeltaPct,
    volOiRatio: c.volOiRatio,
    fromSpotPct: c.fromSpotPct,
    flagOiBig: c.flagOiBig,
    flagOiDelta30: c.flagOiDelta30,
    flagOiDelta100: c.flagOiDelta100,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
