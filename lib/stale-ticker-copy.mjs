// Last-good stock page for a ticker that failed this bake (2026-11-26).
//
// When one ticker's fetch fails (or its input cannot publish), the bake used
// to write no data/<SYM>.json for it, and the bake push then removed the
// stored copy, so the stock page went blank until the next bake. Now the
// bake keeps the prior published copy, marked `staleCopy`, for DISPLAY ONLY:
//
// - it is written after the wipe, never added to `chains`, so no grade, pick,
//   engine, Top Picks contract or auto-pick in this bake can read it;
// - the freshness check skips it (it counts toward neither coverage nor the
//   grades match) and only checks that it is a valid, marked copy;
// - the scanners and offline readers that build signals from data/<SYM>.json
//   skip a marked copy (isStaleTickerCopy);
// - the stock page says the data is from an earlier build.
//
// A copy is kept at most STALE_COPY_MAX_DAYS after its last fresh quote, and
// only for a symbol still in TICKERS, so a dropped or delisted name still
// leaves the site. Pure. No network, no AI.

import { publishedTickerError } from "./published-ticker-contract.mjs";

export const STALE_COPY_MAX_DAYS = 7;
export const STALE_COPY_REASON = "not-updated";

export function isStaleTickerCopy(payload) {
  return !!(payload && typeof payload === "object" && payload.staleCopy && typeof payload.staleCopy === "object");
}

// The prior payload as a marked display copy, or null when it can't be kept
// (missing, not a valid published ticker file, or too old).
export function staleTickerCopy(prior, { builtAtIso, why = STALE_COPY_REASON } = {}) {
  if (!prior || typeof prior !== "object" || publishedTickerError(prior)) return null;
  const nowMs = Date.parse(builtAtIso || "") || Date.now();
  const quoteMs = Date.parse(prior.quoteAsOf || "");
  if (!Number.isFinite(quoteMs) || nowMs - quoteMs > STALE_COPY_MAX_DAYS * 86400000) return null;
  const since = isStaleTickerCopy(prior) && typeof prior.staleCopy.since === "string" ? prior.staleCopy.since : prior.quoteAsOf;
  return { ...prior, staleCopy: { since, why: String(why || STALE_COPY_REASON).slice(0, 80), keptAtIso: new Date(nowMs).toISOString() } };
}

// Copies for every expected symbol missing from this bake's chains, read
// from the hydrated data/ before the wipe. readPrior(sym) -> payload | null.
export async function collectStaleTickerCopies({ expectedSymbols, chains, readPrior, builtAtIso, whyOf = () => STALE_COPY_REASON } = {}) {
  const out = new Map();
  for (const sym of Array.isArray(expectedSymbols) ? expectedSymbols : []) {
    if (chains && chains[sym]) continue;
    let prior = null;
    try { prior = await readPrior(sym); } catch { prior = null; }
    const copy = staleTickerCopy(prior, { builtAtIso, why: whyOf(sym) });
    if (copy) out.set(sym, copy);
  }
  return out;
}
