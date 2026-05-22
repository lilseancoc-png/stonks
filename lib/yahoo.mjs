// Shared Yahoo Finance client + helpers used by every serverless endpoint.
// Centralized here so api/quote.js, api/chain.js, and api/portfolio-review.js
// share one client instance (one cookie/crumb handshake) and one allowlist.

import YahooFinance from "yahoo-finance2";

export const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
  fetchOptions: {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  },
});

// Yahoo symbols: 1–6 chars, leading letter, letters/digits/dot only.
// Cheap allowlist to keep us from being used as an open Yahoo proxy.
export const SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,5}$/;

const STRIKE_BAND = 0.5;

export function isValidSymbol(s) {
  return typeof s === "string" && SYMBOL_RE.test(s);
}

export function compressContract(c) {
  return {
    s: c.strike,
    b: c.bid ?? null,
    a: c.ask ?? null,
    l: c.lastPrice ?? null,
    iv: c.impliedVolatility ?? null,
    oi: c.openInterest ?? null,
    v: c.volume ?? null,
  };
}

// Per-call wall clock so a hung Yahoo connection can't starve the
// serverless function's whole maxDuration budget. yahoo-finance2
// doesn't expose a per-call AbortSignal cleanly (fetchOptions is
// constructor-scoped), so we race the SDK promise against a timer.
// clearTimeout in the .finally so the leftover timer doesn't keep
// the event loop alive past the function return.
const YAHOO_CALL_TIMEOUT_MS = 8000;
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

export async function fetchQuote(symbol) {
  const q = await withYahooTimeout(
    yahooFinance.quote(symbol, {
      fields: [
        "regularMarketPrice",
        "regularMarketPreviousClose",
        "regularMarketChange",
        "regularMarketChangePercent",
        "marketState",
        "preMarketPrice",
        "postMarketPrice",
      ],
    }),
    `quote(${symbol})`,
  );
  const spot =
    q?.regularMarketPrice ?? q?.postMarketPrice ?? q?.preMarketPrice ?? null;
  return {
    symbol,
    spot,
    prevClose: q?.regularMarketPreviousClose ?? null,
    change: q?.regularMarketChange ?? null,
    changePct: q?.regularMarketChangePercent ?? null,
    marketState: q?.marketState ?? null,
  };
}

// Returns { symbol, spot, exp, marketState, chain: { c: [...], p: [...] } }
// or null if Yahoo returns no chain. expDate is optional — when omitted
// Yahoo returns the nearest expiration.
export async function fetchChain(symbol, expDate) {
  const r = await withYahooTimeout(
    yahooFinance.options(symbol, expDate ? { date: expDate } : {}),
    `chain(${symbol})`,
  );
  const spot =
    r.quote?.regularMarketPrice ??
    r.quote?.postMarketPrice ??
    r.quote?.preMarketPrice ??
    null;
  if (spot == null) return null;
  const entry = r.options?.[0];
  if (!entry) return null;

  const minK = spot * (1 - STRIKE_BAND);
  const maxK = spot * (1 + STRIKE_BAND);
  const keep = (c) => c.strike != null && c.strike >= minK && c.strike <= maxK;

  const calls = (entry.calls || []).filter(keep).map(compressContract);
  const puts = (entry.puts || []).filter(keep).map(compressContract);

  const expSec = entry.expirationDate
    ? Math.round(new Date(entry.expirationDate).getTime() / 1000)
    : null;

  return {
    symbol,
    spot,
    exp: expSec,
    marketState: r.quote?.marketState ?? null,
    chain: { c: calls, p: puts },
  };
}

// Looks up a single contract row for the given (symbol, expiry-sec, side, strike).
// Returns the compressed contract or null. Used by portfolio review to price
// a position the user owns. Strike match is exact-to-2dp to handle Yahoo's
// occasional 199.99999 float drift.
//
// Hits yahoo.options directly rather than going through fetchChain, which
// bands results to ±50% of spot — that silently drops far OTM/ITM strikes
// the user actually owns (e.g. a $130 TEAM call when TEAM trades far below
// that), leaving the review with no mark or Greeks for the position.
export async function fetchContract(symbol, expirySec, side, strike) {
  const r = await withYahooTimeout(
    yahooFinance.options(symbol, { date: new Date(expirySec * 1000) }),
    `contract(${symbol} ${side} ${strike})`,
  );
  const spot =
    r?.quote?.regularMarketPrice ??
    r?.quote?.postMarketPrice ??
    r?.quote?.preMarketPrice ??
    null;
  const entry = r?.options?.[0];
  if (!entry) return null;
  const list = side === "put" ? entry.puts || [] : entry.calls || [];
  const target = Number(strike);
  let best = null;
  let bestDiff = Infinity;
  for (const c of list) {
    if (c.strike == null) continue;
    const diff = Math.abs(c.strike - target);
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  // 0.01 tolerance — within a cent is the same strike.
  if (best && bestDiff <= 0.01) {
    return { ...compressContract(best), spot, marketState: r?.quote?.marketState ?? null };
  }
  return null;
}
