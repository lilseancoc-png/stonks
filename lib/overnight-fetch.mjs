// Yahoo fetch for the overnight read (lib/overnight-inputs.mjs). Shared by the
// 09:2x ET pre-open job (scripts/overnight-preopen.mjs) and the bake, which
// rebuilds the morning call from the same bars when the live job missed it.
// Free Yahoo chart data only; no AI calls.

import { OVERNIGHT_SYMBOLS, OVERNIGHT_INTRADAY_KINDS } from "./overnight-inputs.mjs";
import { withYahooRetry, summarizeYahooError } from "./yahoo-retry.mjs";
import { withYahooTimeout } from "./yahoo.mjs";

export const OVERNIGHT_DAILY_DAYS = 400;
// Yahoo serves 15-minute bars for about the last 60 days.
export const OVERNIGHT_INTRADAY_MAX_DAYS = 58;

// Exchange-local calendar date, so an Asian session is dated the day it traded
// (a raw UTC slice puts the ASX open on the previous day).
function localDate(date, tz) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

async function chart(yahooFinance, symbol, opts, label) {
  return withYahooRetry(
    () => withYahooTimeout(yahooFinance.chart(symbol, opts), label),
    { label, attempts: 2 },
  );
}

export async function fetchOvernightDaily(yahooFinance, symbol, { nowMs = Date.now(), days = OVERNIGHT_DAILY_DAYS } = {}) {
  const res = await chart(yahooFinance, symbol, {
    period1: new Date(nowMs - days * 86400000), period2: new Date(nowMs), interval: "1d",
  }, `overnight ${symbol} daily`);
  const tz = res?.meta?.exchangeTimezoneName || null;
  return (res?.quotes || [])
    .filter((q) => q && q.close != null && Number.isFinite(q.close))
    .map((q) => ({ t: localDate(q.date, tz), o: Number.isFinite(q.open) ? q.open : null, c: q.close }))
    .filter((b) => b.t);
}

export async function fetchOvernightIntraday(yahooFinance, symbol, { nowMs = Date.now(), days = 5 } = {}) {
  const res = await chart(yahooFinance, symbol, {
    period1: new Date(nowMs - Math.min(days, OVERNIGHT_INTRADAY_MAX_DAYS) * 86400000),
    period2: new Date(nowMs),
    interval: "15m",
    includePrePost: true,
  }, `overnight ${symbol} 15m`);
  return (res?.quotes || [])
    .filter((q) => q && q.close != null && Number.isFinite(q.close))
    .map((q) => ({ ms: new Date(q.date).getTime(), c: q.close, h: q.high ?? null, l: q.low ?? null, v: q.volume ?? null }))
    .filter((b) => Number.isFinite(b.ms));
}

// Fetch every overnight symbol. intradayDays=5 for the live call, up to 58
// to rebuild past mornings, 0 for daily bars only (grading). Failures are logged and skipped: a missing market
// is simply absent from the scorer, which needs 3 of 5 groups to call a tone.
export async function fetchOvernightSeries(yahooFinance, { nowMs = Date.now(), intradayDays = 5, symbols = Object.keys(OVERNIGHT_SYMBOLS), log = console.log, concurrency = 4 } = {}) {
  const series = {};
  const failed = [];
  let i = 0;
  const worker = async () => {
    while (i < symbols.length) {
      const sym = symbols[i++];
      const kind = OVERNIGHT_SYMBOLS[sym]?.kind;
      const out = {};
      try {
        out.daily = await fetchOvernightDaily(yahooFinance, sym, { nowMs });
      } catch (err) {
        failed.push(`${sym} daily: ${summarizeYahooError(err)}`);
      }
      if (intradayDays > 0 && OVERNIGHT_INTRADAY_KINDS.has(kind)) {
        try {
          out.intraday = await fetchOvernightIntraday(yahooFinance, sym, { nowMs, days: intradayDays });
        } catch (err) {
          failed.push(`${sym} 15m: ${summarizeYahooError(err)}`);
        }
      }
      if (out.daily || out.intraday) series[sym] = out;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker));
  if (failed.length) log(`    ⚠ overnight fetch: ${failed.length} request(s) failed — ${failed.slice(0, 6).join("; ")}${failed.length > 6 ? " …" : ""}`);
  return { series, failed };
}
