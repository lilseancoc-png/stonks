// Lightweight, high-frequency LIVE Day Trades runner.
//
// The full hourly scan (scripts/scan-unusual.mjs) is expensive: it fetches the
// front two option chains for every ticker and makes per-contract Gemini calls.
// But the Day Trades engine itself only needs UNDERLYING quotes plus the
// nightly-baked per-ticker JSON (20D avg volume, S/R levels, the gamma chain) —
// no option-chain fetch, no AI. This runner exploits that: one batched Yahoo
// quote call feeds the exact same volume + Day Trades engine the full scan uses,
// so it is cheap enough to run every ~15 minutes.
//
// On each run it:
//   1. marks every OPEN day trade to the live tape and CLOSES any that hit their
//      take-profit / stop-loss (or timed out) into the P/L history, and
//   2. (live session only) mines the volume board for fresh ideas and tops the
//      roster up.
// So new day trades + durable TP/SL closes land DURING the session, not just on
// the hourly full scan. The browser already re-marks every 30s and files
// provisional closes; this run makes those closes durable far sooner and seeds
// genuinely new ideas intraday.
//
// It writes ONLY data/day-trades.json + data/day-trades-history.json. It calls
// runVolumePass with persist:false, so the hourly full scan stays the sole owner
// of volume-flags.json / volume-history.json (their hour-over-hour bucket deltas
// depend on a strictly hourly snapshot cadence).
//
// Invoked by .github/workflows/day-trades.yml (cron-job.org dispatches it every
// ~15 min, 9:30–16:00 ET, weekdays).
import { pathToFileURL } from "node:url";
import { yahooFinance, withYahooTimeout } from "../lib/yahoo.mjs";
import { TICKERS } from "./build.mjs";
import { runVolumePass, runDayTradePass } from "./scan-unusual.mjs";

// Same field set the live /api/quotes proxy requests — everything the volume +
// Day Trades engine needs from the underlying (spot, day range, cumulative
// volume, prior close, % move, market state).
const QUOTE_FIELDS = [
  "regularMarketPrice",
  "regularMarketPreviousClose",
  "regularMarketChangePercent",
  "marketState",
  "preMarketPrice",
  "postMarketPrice",
  "regularMarketVolume",
  "regularMarketDayHigh",
  "regularMarketDayLow",
];
// yahoo-finance2's quote() issues one upstream request per call; cap each batch
// well under Yahoo's comfort zone (the live proxy caps at 150).
const QUOTE_BATCH = 120;
// Abort before writing if a systemic fetch failure means almost nothing came
// back — leaves the last-good roster in place rather than blanking the board.
const MIN_SUCCESS_RATE = 0.5;

async function fetchQuotes(symbols) {
  const out = [];
  for (let i = 0; i < symbols.length; i += QUOTE_BATCH) {
    const batch = symbols.slice(i, i + QUOTE_BATCH);
    try {
      const r = await withYahooTimeout(
        yahooFinance.quote(batch, { fields: QUOTE_FIELDS }),
        `quotes(${batch.length})`,
      );
      const list = Array.isArray(r) ? r : r ? [r] : [];
      for (const q of list) if (q && q.symbol) out.push(q);
    } catch (err) {
      console.log(`  ✗ quote batch ${i / QUOTE_BATCH + 1} failed — ${err.message}`);
    }
  }
  return out;
}

// Map one Yahoo quote to the underlying-level shape runVolumePass expects.
// Mirrors api/quotes.js: when the regular price is null and spot falls back to a
// pre/post-market print, re-derive the % move off the prior close so spot and
// the move share one baseline.
function toPerTickerResult(q) {
  const reg = q?.regularMarketPrice ?? null;
  const spot = reg ?? q?.postMarketPrice ?? q?.preMarketPrice ?? null;
  if (spot == null) return null;
  const prevClose = q?.regularMarketPreviousClose ?? null;
  let changePct = q?.regularMarketChangePercent ?? null;
  if (reg == null) {
    changePct = (prevClose != null && prevClose !== 0)
      ? ((spot - prevClose) / prevClose) * 100
      : null;
  }
  return {
    symbol: q.symbol,
    spot,
    cumVol: q?.regularMarketVolume ?? null,
    prevClose,
    dayHigh: q?.regularMarketDayHigh ?? null,
    dayLow: q?.regularMarketDayLow ?? null,
    changePct,
  };
}

async function main() {
  const scannedAt = new Date().toISOString();
  const nowDate = new Date(scannedAt);
  console.log(`Live Day Trades run — fetching quotes for ${TICKERS.length} tickers…`);

  const quotes = await fetchQuotes(TICKERS);
  const perTickerResults = [];
  for (const q of quotes) {
    const r = toPerTickerResult(q);
    if (r) perTickerResults.push(r);
  }

  const got = perTickerResults.length;
  if (TICKERS.length && got / TICKERS.length < MIN_SUCCESS_RATE) {
    console.error(
      `Only ${got}/${TICKERS.length} quotes returned (${((got / TICKERS.length) * 100).toFixed(0)}% < ${MIN_SUCCESS_RATE * 100}%) — likely a systemic Yahoo block. Leaving last-good day trades in place.`,
    );
    process.exit(1);
  }

  let marketState = null;
  for (const q of quotes) {
    if (q?.marketState) { marketState = q.marketState; break; }
  }

  // Build the live volume board WITHOUT persisting volume-flags/history (the
  // hourly full scan owns those), then run the Day Trades engine over it.
  let volRows = [];
  try {
    volRows = await runVolumePass({
      perTickerResults,
      scannedAt,
      marketState,
      nowDate,
      persist: false,
    }) || [];
  } catch (err) {
    console.log(`volume pass failed: ${err.message}`);
  }

  const quotesMap = new Map();
  for (const r of perTickerResults) {
    quotesMap.set(r.symbol, { spot: r.spot, dayHi: r.dayHigh, dayLo: r.dayLow, changePct: r.changePct });
  }

  await runDayTradePass({
    volRows,
    quotesMap,
    scannedAt,
    marketState,
    nowDate,
  });
}

const isEntryPoint = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
