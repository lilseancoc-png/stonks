// Prediction market odds tracker: the two venues' free public read APIs.
//
// Kalshi (CFTC-regulated, US): https://api.elections.kalshi.com/trade-api/v2
//   GET /series?category=<c>                       series with category / tags
//   GET /events?status=open&with_nested_markets=true&limit=200&min_close_ts&cursor
//   GET /markets?tickers=A,B,...                    current prices for tracked markets
//   GET /series/<s>/markets/<m>/candlesticks?start_ts&end_ts&period_interval=60|1440
//   GET /historical/markets/<m>/candlesticks        markets past the live cutoff
// Polymarket: https://gamma-api.polymarket.com (events / markets, public) and
//   https://clob.polymarket.com/prices-history?market=<yes token>&startTs&endTs&fidelity
//
// No key, no login and no account: these are the venues' public market-data
// reads, the same ones the calendar and Crowd page already use. Every call is
// counted against a per-bake budget and every failure is caught: a venue that
// does not answer leaves its contracts on their last stored price, marked
// stale, and never stops the bake. Calls time out after CALL_TIMEOUT_MS, a
// venue that stops answering is left alone after BREAKER_AFTER failures, and
// the whole step can be capped (createClient `maxMs`).

import { finite, round, errorText } from '../crowd/util.mjs';

export const KALSHI_BASES = [
  process.env.KALSHI_API_BASE,
  'https://api.elections.kalshi.com/trade-api/v2',
  'https://external-api.kalshi.com/trade-api/v2',
].filter(Boolean);
export const POLY_GAMMA = process.env.POLYMARKET_GAMMA_BASE || 'https://gamma-api.polymarket.com';
export const POLY_CLOB = process.env.POLYMARKET_CLOB_BASE || 'https://clob.polymarket.com';
export const PREDICTION_USER_AGENT = 'stonks-app market-data pipeline (https://mingstreet.app)';
export const KALSHI_CATEGORIES = Object.freeze(['Politics', 'Elections', 'Economics', 'Financials', 'Crypto', 'Companies', 'World', 'Commodities', 'Science and Technology']);
export const POLY_TAGS = Object.freeze(['politics', 'elections', 'geopolitics', 'world', 'economy', 'fed-rates', 'finance', 'crypto', 'business', 'tech', 'commodities', 'tariffs']);

// One call's longest wait. A venue that hangs must not hold up the build: the
// tracker runs ahead of the Top Picks run (PREDICTION_TIMEOUT_MS overrides).
export const CALL_TIMEOUT_MS = (() => { const n = Number(process.env.PREDICTION_TIMEOUT_MS); return Number.isFinite(n) && n >= 1000 ? n : 8000; })();
// A venue that fails this many calls in a row without answering (timeouts,
// network errors, 5xx) gets no more calls this bake.
export const BREAKER_AFTER = 3;

async function defaultFetchJson(url, { timeoutMs = CALL_TIMEOUT_MS } = {}) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': PREDICTION_USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error('non-JSON response'); }
}

const venueOfUrl = (url) => (String(url).startsWith(POLY_GAMMA) || String(url).startsWith(POLY_CLOB) ? 'polymarket' : 'kalshi');

// A small client: counts calls, stops at the budget, runs at most
// `concurrency` requests at once and remembers which Kalshi host answered.
// Three limits keep one bake's reads short however a venue behaves:
//   - each call waits at most `timeoutMs`;
//   - a venue that fails BREAKER_AFTER calls in a row without answering is
//     left alone for the rest of the bake;
//   - with `maxMs` set, no call starts after that many ms from the first.
// A call refused by any of the three rejects with `budget: true`, the same
// flag as a used-up call budget, so every reader stops the same way and the
// contracts it did not reach keep their last stored price.
export function createClient({ fetchJson = defaultFetchJson, budget = 400, concurrency = 4, timeoutMs = CALL_TIMEOUT_MS, maxMs = null, breakerAfter = BREAKER_AFTER, now = Date.now } = {}) {
  let calls = 0, active = 0;
  const queue = [];
  const errors = [];
  let kalshiBase = null;
  const deadline = Number.isFinite(maxMs) && maxMs > 0 ? now() + maxMs : null;
  const fails = { kalshi: 0, polymarket: 0 };
  const tripped = { kalshi: false, polymarket: false };
  let timedOut = false;
  const stop = (why) => Object.assign(new Error(why), { budget: true, stopped: true });
  const refused = (venue) => {
    if (deadline != null && now() >= deadline) { timedOut = true; return stop('time limit reached'); }
    if (tripped[venue]) return Object.assign(stop(`${venue} is not answering, no more calls this run`), { venueDown: venue });
    return null;
  };
  // A finished call hands its slot straight to the next waiter, so the count
  // of running calls never passes `concurrency`.
  const run = async (fn) => {
    if (active >= concurrency) await new Promise((r) => queue.push(r));
    else active += 1;
    try { return await fn(); } finally {
      const next = queue.shift();
      if (next) next();
      else active -= 1;
    }
  };
  const get = (url) => {
    const venue = venueOfUrl(url);
    if (calls >= budget) return Promise.reject(Object.assign(new Error('call budget used up'), { budget: true }));
    const no = refused(venue);
    if (no) return Promise.reject(no);
    calls += 1;
    return run(async () => {
      // The wait for a slot may have used up the time, or the venue may have
      // stopped answering meanwhile.
      const late = refused(venue);
      if (late) throw late;
      const wait = deadline != null ? Math.min(timeoutMs, Math.max(250, deadline - now())) : timeoutMs;
      try {
        const json = await fetchJson(url, { timeoutMs: wait });
        fails[venue] = 0;
        return json;
      } catch (err) {
        if (err?.status >= 400 && err?.status < 500) fails[venue] = 0; // the host answered
        else {
          // No answer (timeout, network, 5xx): worth another try on a later bake.
          if (err && typeof err === 'object') err.transient = true;
          fails[venue] += 1;
          if (fails[venue] >= breakerAfter) tripped[venue] = true;
        }
        throw err;
      }
    });
  };
  const kalshi = async (path) => {
    const bases = kalshiBase ? [kalshiBase, ...KALSHI_BASES.filter((b) => b !== kalshiBase)] : KALSHI_BASES;
    let last = null;
    for (const base of bases) {
      try {
        const json = await get(`${base}${path}`);
        kalshiBase = base;
        return json;
      } catch (err) {
        last = err;
        // A 4xx means the host answered and the request itself is wrong (or
        // the market is past the live cutoff); another host will say the same.
        if (err?.budget || (err?.status >= 400 && err?.status < 500)) throw err;
      }
    }
    throw last || new Error('no Kalshi host answered');
  };
  return {
    get, kalshi,
    get calls() { return calls; },
    get budget() { return budget; },
    // Calls still allowed: none once the time limit has passed.
    left: () => (deadline != null && now() >= deadline ? 0 : Math.max(0, budget - calls)),
    // Why the client stopped handing out calls early, or null.
    get stopped() {
      const out = [];
      if (timedOut) out.push('time limit');
      for (const v of ['kalshi', 'polymarket']) if (tripped[v]) out.push(`${v} not answering`);
      return out.length ? out.join(', ') : null;
    },
    get active() { return active; },
    noteError: (venue, err) => { if (errors.length < 20) errors.push(`${venue}: ${errorText(err)}`); },
    errors,
  };
}

// ---- prices ---------------------------------------------------------------

const dollars = (m, key) => {
  const d = finite(m?.[`${key}_dollars`]);
  if (d != null) return d;
  const c = finite(m?.[key]);
  return c != null ? c / 100 : null;
};

// One Kalshi market's YES chance: the bid/ask mid when the book is two-sided
// and not wider than 30 points, else the last trade, else whichever side
// exists. Returns 0..1 or null.
export function kalshiProb(m) {
  const bid = dollars(m, 'yes_bid'), ask = dollars(m, 'yes_ask'), last = dollars(m, 'last_price');
  if (bid != null && ask != null && ask > 0 && ask - bid <= 0.3 && ask >= bid) return round((bid + ask) / 2, 4);
  if (last != null && last > 0) return round(last, 4);
  if (bid != null && ask != null && ask > 0) return round((bid + ask) / 2, 4);
  return null;
}

export function kalshiQuote(m) {
  const status = String(m?.status || '').toLowerCase();
  const result = String(m?.result || '').toLowerCase();
  return {
    prob: kalshiProb(m),
    bid: dollars(m, 'yes_bid'), ask: dollars(m, 'yes_ask'), last: dollars(m, 'last_price'),
    volume: finite(m?.volume_fp ?? m?.volume),
    volume24h: finite(m?.volume_24h_fp ?? m?.volume_24h),
    openInterest: finite(m?.open_interest_fp ?? m?.open_interest),
    closeTime: m?.close_time || m?.expected_expiration_time || null,
    openTime: m?.open_time || null,
    status: /settled|finalized|determined/.test(status) ? 'settled' : /closed/.test(status) ? 'closed' : status ? 'open' : null,
    result: result === 'yes' || result === 'no' ? result : null,
    expirationValue: m?.expiration_value != null && m.expiration_value !== '' ? String(m.expiration_value) : null,
  };
}

const parseList = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const x = JSON.parse(v); return Array.isArray(x) ? x : null; } catch { return null; } }
  return null;
};

// One Polymarket binary market's YES chance and its YES token id.
export function polyQuote(m) {
  const outcomes = parseList(m?.outcomes);
  const prices = parseList(m?.outcomePrices);
  const tokens = parseList(m?.clobTokenIds);
  let yesIdx = 0;
  if (outcomes) {
    const i = outcomes.findIndex((o) => String(o).toLowerCase() === 'yes');
    yesIdx = i >= 0 ? i : 0;
  }
  const bid = finite(m?.bestBid), ask = finite(m?.bestAsk), last = finite(m?.lastTradePrice);
  let prob = null;
  if (bid != null && ask != null && ask > 0 && ask - bid <= 0.3 && ask >= bid) prob = (bid + ask) / 2;
  else if (prices && finite(prices[yesIdx]) != null) prob = finite(prices[yesIdx]);
  else if (last != null && last > 0) prob = last;
  if (prob != null && prob > 1.5) prob /= 100;
  const closed = m?.closed === true || m?.closed === 'true';
  // A resolved market's outcome prices settle at 1 / 0.
  let result = null;
  if (closed && prices && prices.length === 2) {
    const y = finite(prices[yesIdx]);
    if (y != null && y >= 0.99) result = 'yes';
    else if (y != null && y <= 0.01) result = 'no';
  }
  return {
    prob: prob != null ? round(prob, 4) : null,
    bid, ask, last,
    volume: finite(m?.volumeNum ?? m?.volume),
    volume24h: finite(m?.volume24hr ?? m?.volume24hrClob),
    liquidity: finite(m?.liquidityNum ?? m?.liquidity),
    closeTime: m?.endDate || m?.endDateIso || null,
    openTime: m?.startDate || m?.createdAt || null,
    status: closed ? (result ? 'settled' : 'closed') : m?.active === false ? 'closed' : 'open',
    result,
    tokenId: tokens && tokens[yesIdx] != null ? String(tokens[yesIdx]) : null,
    outcomeLabel: outcomes && outcomes.length === 2 ? null : (outcomes ? String(outcomes[yesIdx]) : null),
  };
}

// ---- discovery ------------------------------------------------------------

// Kalshi series → { category, tags, frequency }, one call per category.
export async function kalshiSeriesMap(client, categories = KALSHI_CATEGORIES) {
  const out = new Map();
  for (const cat of categories) {
    try {
      const body = await client.kalshi(`/series?category=${encodeURIComponent(cat)}`);
      for (const s of Array.isArray(body?.series) ? body.series : []) {
        if (!s?.ticker) continue;
        out.set(s.ticker, { category: s.category || cat, tags: Array.isArray(s.tags) ? s.tags : [], frequency: s.frequency || null, title: s.title || null });
      }
    } catch (err) {
      client.noteError('kalshi', err);
      if (err?.budget) break;
    }
  }
  return out;
}

// Open Kalshi events that close at least `minDays` from now (skips daily
// sports games, daily index ranges and the weather), with their markets.
export async function kalshiOpenEvents(client, { nowMs = Date.now(), minDays = 2, maxPages = 30 } = {}) {
  const events = [];
  let cursor = '';
  const minTs = Math.floor((nowMs + minDays * 86400000) / 1000);
  for (let page = 0; page < maxPages; page += 1) {
    let body;
    try {
      body = await client.kalshi(`/events?status=open&with_nested_markets=true&limit=200&min_close_ts=${minTs}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    } catch (err) {
      client.noteError('kalshi', err);
      break;
    }
    for (const ev of Array.isArray(body?.events) ? body.events : []) events.push(ev);
    cursor = body?.cursor || '';
    if (!cursor) break;
  }
  return events;
}

// Active Polymarket events: the most-traded overall plus a pull per tag.
export async function polyOpenEvents(client, { tags = POLY_TAGS, topPages = 3 } = {}) {
  const seen = new Map();
  const urls = [];
  for (let i = 0; i < topPages; i += 1) urls.push(`${POLY_GAMMA}/events?closed=false&active=true&limit=100&offset=${i * 100}&order=volume24hr&ascending=false`);
  for (const tag of tags) urls.push(`${POLY_GAMMA}/events?closed=false&active=true&limit=100&order=volume24hr&ascending=false&tag_slug=${encodeURIComponent(tag)}`);
  for (const url of urls) {
    try {
      const body = await client.get(url);
      const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
      for (const ev of list) {
        const id = ev?.id ?? ev?.slug;
        if (id != null && !seen.has(id)) seen.set(id, ev);
      }
    } catch (err) {
      client.noteError('polymarket', err);
      if (err?.budget) break;
    }
  }
  return [...seen.values()];
}

// ---- refresh --------------------------------------------------------------

// Current prices for tracked Kalshi markets, keyed by market ticker. Only
// tickers that were asked for are kept, so a host that ignores the filter
// cannot slip other markets in.
export async function kalshiMarketsByTicker(client, tickers, chunk = 50) {
  const want = [...new Set(tickers.filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < want.length; i += chunk) {
    const part = want.slice(i, i + chunk);
    try {
      const body = await client.kalshi(`/markets?tickers=${encodeURIComponent(part.join(','))}&limit=${part.length}`);
      const asked = new Set(part);
      for (const m of Array.isArray(body?.markets) ? body.markets : []) if (asked.has(m?.ticker)) out.set(m.ticker, m);
    } catch (err) {
      client.noteError('kalshi', err);
      if (err?.budget) break;
    }
  }
  return out;
}

export async function polyMarketsById(client, ids, chunk = 40) {
  const want = [...new Set(ids.filter((x) => x != null).map(String))];
  const out = new Map();
  for (let i = 0; i < want.length; i += chunk) {
    const part = want.slice(i, i + chunk);
    try {
      const body = await client.get(`${POLY_GAMMA}/markets?${part.map((id) => `id=${encodeURIComponent(id)}`).join('&')}&limit=${part.length}`);
      const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
      const asked = new Set(part);
      for (const m of list) if (m?.id != null && asked.has(String(m.id))) out.set(String(m.id), m);
    } catch (err) {
      client.noteError('polymarket', err);
      if (err?.budget) break;
    }
  }
  return out;
}

// ---- history --------------------------------------------------------------

// One candle's YES chance with the same rule as kalshiProb.
export function kalshiCandleProb(k) {
  const bid = finite(k?.yes_bid?.close_dollars ?? (k?.yes_bid?.close != null ? k.yes_bid.close / 100 : null));
  const ask = finite(k?.yes_ask?.close_dollars ?? (k?.yes_ask?.close != null ? k.yes_ask.close / 100 : null));
  const px = finite(k?.price?.close_dollars ?? (k?.price?.close != null ? k.price.close / 100 : null));
  if (bid != null && ask != null && ask > 0 && ask - bid <= 0.3 && ask >= bid) return round((bid + ask) / 2, 4);
  if (px != null && px > 0) return round(px, 4);
  if (bid != null && ask != null && ask > 0) return round((bid + ask) / 2, 4);
  return null;
}

// [[unixSec, prob], ...] for one Kalshi market. period 60 = hourly, 1440 = daily.
export async function kalshiHistory(client, { series, ticker, startTs, endTs, period = 60 }) {
  const q = `start_ts=${Math.floor(startTs)}&end_ts=${Math.floor(endTs)}&period_interval=${period}`;
  let body;
  try {
    body = await client.kalshi(`/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}/candlesticks?${q}`);
  } catch (err) {
    if (err?.budget || !(err?.status === 404 || err?.status === 400)) throw err;
    body = await client.kalshi(`/historical/markets/${encodeURIComponent(ticker)}/candlesticks?${q}`);
  }
  const out = [];
  for (const k of Array.isArray(body?.candlesticks) ? body.candlesticks : []) {
    const t = finite(k?.end_period_ts);
    const p = kalshiCandleProb(k);
    if (t != null && p != null) out.push([t, p]);
  }
  return out;
}

// [[unixSec, prob], ...] for one Polymarket YES token. fidelity in minutes.
export async function polyHistory(client, { tokenId, startTs, endTs, fidelity = 60 }) {
  const body = await client.get(`${POLY_CLOB}/prices-history?market=${encodeURIComponent(tokenId)}&startTs=${Math.floor(startTs)}&endTs=${Math.floor(endTs)}&fidelity=${fidelity}`);
  const out = [];
  for (const h of Array.isArray(body?.history) ? body.history : []) {
    const t = finite(h?.t), p = finite(h?.p);
    if (t != null && p != null) out.push([t, round(p > 1.5 ? p / 100 : p, 4)]);
  }
  return out;
}

// Settled events of one Kalshi series (the macro releases), newest first.
export async function kalshiSettledEvents(client, series, { limit = 30 } = {}) {
  const body = await client.kalshi(`/events?series_ticker=${encodeURIComponent(series)}&status=settled&with_nested_markets=true&limit=${limit}`);
  return Array.isArray(body?.events) ? body.events : [];
}

export const venueUrl = Object.freeze({
  kalshi: (c) => (c.series ? `https://kalshi.com/markets/${String(c.series).toLowerCase()}` : 'https://kalshi.com/markets'),
  polymarket: (c) => (c.eventSlug ? `https://polymarket.com/event/${c.eventSlug}` : 'https://polymarket.com'),
});
