// Prices are net spread prices per share. Price stages never compound and
// cancellation/status polls never advance them. Broker fills remain authoritative.
import { marketSession, etClock } from "./us-equity-calendar.mjs";

export const EXECUTION_POLICY = "2026-10-29-ladder";
export const ENTRY_ALLOWANCES = [2, 4];
export const EXIT_ALLOWANCES = [2, 4];
export const ENTRY_DWELL_MS = 120000;
// Reach the market (since 2026-11-17): the last ordinary step and the
// end-of-day entry may pay up to the quoted ask plus a small cushion (the
// quote is Yahoo's; Webull fills on its own book), never more than
// REACH_BAND_PCT past the recorded price. Exits mirror it on the bid. A
// 2/4/5% ceiling alone can never fill a contract whose ask sits more than 5%
// over its mid, and the engines may pick spreads up to 18% of the mid (ask up
// to 9% over). Owner Settings "WEBULL_REACH_ASK" (off) restores the plain caps.
export const REACH_BAND_PCT = 10;
export const REACH_CUSHION_PCT = 2;

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

export function executionPrice(t, { phase, stage, quote, emergency = false, expiry = false, nickel = false, reachAsk = false }) {
  const credit = t.structure === "credit_vertical", buying = phase === "entry" ? !credit : credit;
  const reference = phase === "entry" ? t.engineEntryPrice : t.engineExitPrice;
  const bid = Number(quote?.bid), ask = Number(quote?.ask);
  const validQuote = quote?.bid != null && quote?.ask != null && Number.isFinite(bid) && Number.isFinite(ask) && bid >= 0 && ask > 0 && bid <= ask;
  if (!validQuote) return null;
  const tick = nickel || t.legs.length === 1 && Math.max(ask, reference || 0) >= 3 ? 0.05 : 0.01;
  const floor = x => Math.floor((x + 1e-9) / tick) * tick;
  const ceil = x => Math.ceil((x - 1e-9) / tick) * tick;
  const width = spreadWidth(t);
  let limit, allowancePct = null, reached = false;
  if (emergency) {
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
    // The final ordinary step (and the end-of-day entry) reaches the market
    // when the cap stops short of it, inside the band.
    if (reachAsk && (stage === 1 || stage === "eod-entry")) {
      const reach = buying ? Math.min(ceil(ask * (1 + REACH_CUSHION_PCT / 100)), floor(reference * (1 + REACH_BAND_PCT / 100)))
        : Math.max(floor(bid * (1 - REACH_CUSHION_PCT / 100)), ceil(reference * (1 - REACH_BAND_PCT / 100)));
      if (buying ? reach > limit : reach < limit) { limit = reach; reached = true; }
    }
  }
  if (!(limit > 0) || phase === "entry" && width && limit >= width || emergency && buying && !width) return null;
  return { limit: Number(limit.toFixed(2)), allowancePct: reached ? REACH_BAND_PCT : allowancePct, reference, buying, reached,
    stage: emergency ? "emergency-exit" : expiry ? "expiry-exit" : stage === "eod-entry" ? stage : reached ? `${phase}-reach` : `${phase}-${allowancePct}`,
    emergency, quoteMarketable: buying ? limit >= ask : limit <= bid };
}
