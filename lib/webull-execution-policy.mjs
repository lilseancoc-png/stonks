// Prices are net spread prices per share. Price stages never compound and
// cancellation/status polls never advance them. Broker fills remain authoritative.
import { marketSession, etClock } from "./us-equity-calendar.mjs";

export const EXECUTION_POLICY = "2026-10-29-ladder";
export const ENTRY_ALLOWANCES = [2, 4];
export const EXIT_ALLOWANCES = [2, 4];
export const ENTRY_DWELL_MS = 120000;

export function endOfDayWindow(nowMs) {
  const s = marketSession(nowMs);
  return { ...s, due: s.trading && s.minute >= s.closeMinute - 10,
    monitor: s.trading && s.minute >= s.closeMinute - 20 };
}

export function scheduledClosingWindow(nowMs, schedule) {
  const m = /^40,50 (16|17|18|19|20) \* \* 1-5$/.exec(schedule || "");
  if (!m) return false;
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return endOfDayWindow(Date.parse(`${day}T${m[1]}:40:00Z`)).monitor;
}

export function entrySessionMatches(t, nowMs) {
  const entered = Date.parse(t.engineEntryIso);
  return Number.isFinite(entered) && etClock(entered).date === etClock(nowMs).date;
}

export function spreadWidth(t) {
  return t.legs?.length === 2 ? Math.abs(t.legs[0].strike - t.legs[1].strike) : null;
}

export function executionPrice(t, { phase, stage, quote, emergency = false, expiry = false, nickel = false }) {
  const credit = t.structure === "credit_vertical", buying = phase === "entry" ? !credit : credit;
  const reference = phase === "entry" ? t.engineEntryPrice : t.engineExitPrice;
  const bid = Number(quote?.bid), ask = Number(quote?.ask);
  const validQuote = quote?.bid != null && quote?.ask != null && Number.isFinite(bid) && Number.isFinite(ask) && bid >= 0 && ask > 0 && bid <= ask;
  if (!validQuote) return null;
  // Stock (engine share trades, 2026-11-19) trades in pennies: the option
  // nickel rule does not apply. Same 2% / 4% / 5% allowances as options.
  const stock = t.structure === "shares";
  const tick = stock ? 0.01 : nickel || t.legs.length === 1 && Math.max(ask, reference || 0) >= 3 ? 0.05 : 0.01;
  const floor = x => Math.floor((x + 1e-9) / tick) * tick;
  const ceil = x => Math.ceil((x - 1e-9) / tick) * tick;
  const width = spreadWidth(t);
  let limit, allowancePct = null;
  if (emergency && stock) {
    // Shares are only ever sold here (long only). A sell limit 5% under the
    // bid crosses the book without a penny limit a broker could refuse as
    // far from the market; the fill is the broker's, not this limit.
    limit = buying || !(bid > 0) ? null : Math.max(tick, floor(bid * 0.95));
  } else if (emergency) {
    // Close the complete debit position at any positive net credit. A credit
    // vertical buyback may use its full width, never an unbounded debit.
    limit = buying ? width : tick;
  } else if (expiry) limit = buying ? ceil(ask) : floor(bid);
  else {
    if (!(reference > 0)) return null;
    allowancePct = stage === "eod-entry" ? 5 : (phase === "entry" ? ENTRY_ALLOWANCES : EXIT_ALLOWANCES)[stage];
    if (allowancePct == null) return null;
    limit = buying ? Math.min(ceil(ask), floor(reference * (1 + allowancePct / 100)))
      : Math.max(floor(bid), ceil(reference * (1 - allowancePct / 100)));
  }
  if (!(limit > 0) || phase === "entry" && width && limit >= width || emergency && buying && !width) return null;
  // Long only: a stock order never sells at entry or buys at exit.
  if (stock && buying !== (phase === "entry")) return null;
  return { limit: Number(limit.toFixed(2)), allowancePct, reference, buying,
    stage: emergency ? "emergency-exit" : expiry ? "expiry-exit" : stage === "eod-entry" ? stage : `${phase}-${allowancePct}`,
    emergency, quoteMarketable: buying ? limit >= ask : limit <= bid };
}
