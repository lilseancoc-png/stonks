// P2 — Kalshi index close ranges and macro-release odds (public market data).
//
// GET https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=<S>
// &status=open&with_nested_markets=true returns open events with their
// markets (yes bid / ask / last in cents and *_dollars strings, strike_type
// less / greater / between with floor_strike / cap_strike, volume, open
// interest, close_time). No key for reads. One call per series each build;
// a range series yields an implied distribution over the buckets, a
// threshold series an implied probability per level and a median by
// interpolation. These are traded prices, not forecasts by the site.

import { fetchJson, finite, round, carried, errorText, upsertDated } from "./util.mjs";

export const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
export const KALSHI_SERIES = Object.freeze([
  { ticker: "KXINX", label: "S&P 500 close", kind: "range", group: "index", unit: "pts", maxEvents: 2 },
  { ticker: "KXNASDAQ100", label: "Nasdaq-100 close", kind: "range", group: "index", unit: "pts", maxEvents: 2 },
  { ticker: "KXCPI", label: "CPI month over month", kind: "threshold", group: "macro", unit: "%", maxEvents: 2 },
  { ticker: "KXCPICOREYOY", label: "Core CPI year over year", kind: "threshold", group: "macro", unit: "%", maxEvents: 1 },
  { ticker: "KXPAYROLLS", label: "Nonfarm payrolls", kind: "threshold", group: "macro", unit: "k", maxEvents: 2 },
  { ticker: "KXU3MIN", label: "Unemployment rate", kind: "threshold", group: "macro", unit: "%", maxEvents: 2 },
  { ticker: "KXJOBLESS", label: "Initial jobless claims", kind: "threshold", group: "macro", unit: "k", maxEvents: 2 },
  { ticker: "KXQRECESS", label: "US recession", kind: "threshold", group: "macro", unit: "", maxEvents: 1 },
  { ticker: "KXNOTE10Y", label: "10-year Treasury yield", kind: "threshold", group: "rates", unit: "%", maxEvents: 2 },
]);
export const KALSHI_EVENTS_URL = (series) => `${KALSHI_BASE}/events?series_ticker=${encodeURIComponent(series)}&status=open&with_nested_markets=true&limit=20`;
export const KALSHI_HISTORY_KEEP = 120;
const MAX_MARKETS = 40;

function cents(m, key) {
  const dollars = finite(m?.[`${key}_dollars`]);
  if (dollars != null) return round(dollars, 4);
  const c = finite(m?.[key]);
  return c != null ? round(c / 100, 4) : null;
}

export function compactMarket(m) {
  const yesBid = cents(m, "yes_bid");
  const yesAsk = cents(m, "yes_ask");
  const last = cents(m, "last_price");
  let mid = yesBid != null && yesAsk != null ? (yesBid + yesAsk) / 2 : (last ?? yesBid ?? yesAsk);
  // A one-sided book (bid 0 / ask 1) carries no information; fall back to last.
  if (yesBid != null && yesAsk != null && yesAsk - yesBid > 0.5 && last != null) mid = last;
  return {
    ticker: m?.ticker || null,
    title: String(m?.yes_sub_title || m?.subtitle || m?.title || "").trim() || null,
    strikeType: m?.strike_type || null,
    floor: finite(m?.floor_strike),
    cap: finite(m?.cap_strike),
    yesBid, yesAsk, last,
    prob: mid != null ? round(mid, 4) : null,
    volume: finite(m?.volume),
    openInterest: finite(m?.open_interest),
    closeTime: m?.close_time || null,
    status: m?.status || null,
  };
}

// Implied distribution for a set of between/less/greater buckets.
export function rangeDistribution(markets) {
  const rows = markets.filter((m) => m.prob != null && (m.floor != null || m.cap != null));
  if (rows.length < 2) return null;
  const widths = rows.filter((m) => m.floor != null && m.cap != null).map((m) => m.cap - m.floor).filter((w) => w > 0);
  const typical = widths.length ? widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)] : null;
  const total = rows.reduce((a, m) => a + m.prob, 0);
  if (!(total > 0)) return null;
  let mean = 0;
  let best = null;
  const buckets = rows.map((m) => {
    const p = m.prob / total;
    let mid;
    if (m.floor != null && m.cap != null) mid = (m.floor + m.cap) / 2;
    else if (m.floor != null) mid = m.floor + (typical || 0) / 2;
    else mid = m.cap - (typical || 0) / 2;
    mean += p * mid;
    if (!best || p > best.p) best = { p, floor: m.floor, cap: m.cap, title: m.title };
    return { title: m.title, floor: m.floor, cap: m.cap, prob: round(p, 4), rawProb: m.prob, volume: m.volume };
  }).sort((a, b) => (a.floor ?? -Infinity) - (b.floor ?? -Infinity));
  // Central 80% from the cumulative sum of the sorted buckets.
  let cum = 0;
  let lo = null;
  let hi = null;
  for (const b of buckets) {
    const before = cum;
    cum += b.prob;
    if (lo == null && cum >= 0.1) lo = b.floor ?? b.cap;
    if (hi == null && cum >= 0.9) hi = b.cap ?? b.floor;
    void before;
  }
  return {
    impliedMean: round(mean, 1),
    mostLikely: best ? { floor: best.floor, cap: best.cap, prob: round(best.p, 3), title: best.title } : null,
    band80: lo != null && hi != null ? [lo, hi] : null,
    overround: round(total, 3),
    buckets,
  };
}

// Threshold markets ("above X") sorted by level, with the median where the
// implied probability of being above crosses one half.
export function thresholdLadder(markets) {
  const rows = markets.filter((m) => m.prob != null && (m.floor != null || m.cap != null)).map((m) => {
    const level = m.floor ?? m.cap;
    // "greater": prob is P(x > level). "less": P(x < level) -> P(above) = 1 - p. "between": keep as a bucket.
    let above = null;
    if (m.strikeType === "greater" || (m.strikeType == null && m.floor != null && m.cap == null)) above = m.prob;
    else if (m.strikeType === "less" || (m.strikeType == null && m.cap != null && m.floor == null)) above = 1 - m.prob;
    return { title: m.title, level, strikeType: m.strikeType, prob: m.prob, probAbove: above != null ? round(above, 4) : null, floor: m.floor, cap: m.cap, volume: m.volume };
  }).sort((a, b) => a.level - b.level);
  const ladder = rows.filter((r) => r.probAbove != null);
  let median = null;
  for (let i = 1; i < ladder.length; i++) {
    const a = ladder[i - 1];
    const b = ladder[i];
    if (a.probAbove >= 0.5 && b.probAbove < 0.5) {
      const t = (a.probAbove - 0.5) / Math.max(1e-6, a.probAbove - b.probAbove);
      median = round(a.level + t * (b.level - a.level), 3);
      break;
    }
  }
  if (median == null && ladder.length === 1) median = null;
  return { rows, median, levels: ladder.length };
}

export function buildKalshiSeries(def, events) {
  const list = (Array.isArray(events) ? events : []).map((ev) => {
    const markets = (Array.isArray(ev?.markets) ? ev.markets : []).map(compactMarket).filter((m) => m.ticker).slice(0, MAX_MARKETS);
    const closeTimes = markets.map((m) => Date.parse(m.closeTime || "")).filter(Number.isFinite);
    return {
      eventTicker: ev?.event_ticker || null,
      title: String(ev?.title || "").trim() || null,
      subTitle: String(ev?.sub_title || "").trim() || null,
      closeTime: closeTimes.length ? new Date(Math.min(...closeTimes)).toISOString() : null,
      volume: markets.reduce((a, m) => a + (m.volume || 0), 0),
      openInterest: markets.reduce((a, m) => a + (m.openInterest || 0), 0),
      markets,
      ...(def.kind === "range" ? { distribution: rangeDistribution(markets) } : { ladder: thresholdLadder(markets) }),
    };
  }).filter((ev) => ev.markets.length)
    .sort((a, b) => String(a.closeTime || "9").localeCompare(String(b.closeTime || "9")))
    .slice(0, def.maxEvents || 2);
  return list;
}

export async function fetchKalshi({ prior, nowIso = new Date().toISOString(), todayEt, fetchImpl = fetchJson, series = KALSHI_SERIES } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  const out = {};
  const errors = [];
  let okCount = 0;
  for (const def of series) {
    const priorSeries = base.series?.[def.ticker] || null;
    try {
      const body = await fetchImpl(KALSHI_EVENTS_URL(def.ticker));
      const events = buildKalshiSeries(def, body?.events);
      if (!events.length) throw new Error("no open events");
      const lead = events[0];
      const headline = def.kind === "range"
        ? { impliedMean: lead.distribution?.impliedMean ?? null, band80: lead.distribution?.band80 ?? null, mostLikely: lead.distribution?.mostLikely ?? null }
        : { median: lead.ladder?.median ?? null, levels: lead.ladder?.levels ?? 0 };
      const histRow = [todayEt || nowIso.slice(0, 10), def.kind === "range" ? headline.impliedMean : headline.median, lead.volume];
      const history = upsertDated(priorSeries?.history, histRow, KALSHI_HISTORY_KEEP);
      out[def.ticker] = { ...def, ok: true, stale: false, fetchedAt: nowIso, headline, events, history };
      okCount++;
    } catch (err) {
      errors.push(`${def.ticker}: ${errorText(err)}`);
      out[def.ticker] = priorSeries ? { ...priorSeries, ok: false, stale: true, carriedForward: true, error: errorText(err) } : { ...def, ok: false, stale: true, error: errorText(err), events: [], history: [] };
    }
  }
  if (!okCount) return carried(base, errors[0] || "no series read", nowIso);
  return {
    ok: true, stale: false, carriedForward: false,
    error: errors.length ? `${errors.length} series failed: ${errors[0]}` : null,
    fetchedAt: nowIso, fetchedDate: todayEt || null, asOf: nowIso,
    seriesOk: okCount, seriesTotal: series.length,
    series: out,
    note: "Prices on Kalshi's event contracts, read as implied probabilities (a 45-cent YES is a 45% market-implied chance). Thin markets carry wide bid/ask; volume is shown so a quiet market can be weighed accordingly.",
  };
}
