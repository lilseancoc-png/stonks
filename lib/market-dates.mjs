// Market-structure dates for the Calendar and the .ics feed (2026-11-07).
//
// Rule-based dates that explain many "pin" and "flush" sessions:
//   - monthly options expiration (the third Friday; the Thursday before when
//     that Friday is an exchange holiday),
//   - quarterly "triple witching" (the March / June / September / December
//     expiration, when index futures and options expire together),
//   - the S&P 500 quarterly rebalance (takes effect after the close on the
//     same third Friday),
//   - the Nasdaq-100 annual reconstitution (after the close on the third
//     Friday of December),
//   - VIX options and futures expiration (the Wednesday 30 days before the
//     next month's third-Friday S&P 500 expiration),
//   - estimated IPO lockup ends (about 180 days after a sizable listing; an
//     estimate, the prospectus sets the real date).
//
// Pure and deterministic: no network, no AI. Dates only resolve inside years
// lib/us-equity-calendar.mjs knows, so an unknown year yields nothing rather
// than a guessed session. Events carry type 'market' and never a `symbol`
// field (calendarEventsForUniverse would drop an IPO ticker outside the
// tracked universe); the listing's ticker rides in `ipoSymbol`.

import { sessionForDate } from "./us-equity-calendar.mjs";

export const MARKET_DATES_VERSION = 1;
// A listing must be at least this big for its lockup to matter to the tape.
export const LOCKUP_MIN_RAISED = 100e6;
export const LOCKUP_MIN_MCAP = 1e9;
export const LOCKUP_DAYS = 180;

const DAY_MS = 86400000;
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// Third Friday of a month (1-based month).
export function thirdFriday(year, month) {
  const dow15 = new Date(Date.UTC(year, month - 1, 15)).getUTCDay();
  return iso(year, month, 15 + ((5 - dow15 + 7) % 7));
}

// The trading day on or before `date` (null for a year the calendar does not know).
export function onOrBeforeTradingDay(date) {
  let d = date;
  for (let i = 0; i < 7; i++) {
    const s = sessionForDate(d);
    if (!s) return null;
    if (s.open) return d;
    d = addDays(d, -1);
  }
  return null;
}

// Monthly expiration session for a month: the third Friday, or the trading
// day before it when that Friday is a holiday (Good Friday 2027 is March 26).
export function monthlyExpiration(year, month) {
  return onOrBeforeTradingDay(thirdFriday(year, month));
}

// VIX expiration in a month: the Wednesday 30 days before the third Friday of
// the FOLLOWING month; the trading day before when that Wednesday is closed.
export function vixExpiration(year, month) {
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const wed = addDays(thirdFriday(ny, nm), -30);
  return onOrBeforeTradingDay(wed);
}

function event(kind, date, title, detail, importance, extra = {}) {
  return {
    type: "market",
    subtype: kind,
    date,
    title,
    detail,
    importance,
    source: extra.source || "Exchange rules",
    sourceKey: "market-dates",
    ...(extra.sourceUrl ? { sourceUrl: extra.sourceUrl } : {}),
    ...(extra.time ? { time: extra.time } : {}),
    ...(extra.ipoSymbol ? { ipoSymbol: extra.ipoSymbol } : {}),
    ...(extra.estimate ? { estimate: true } : {}),
  };
}

// Rows from ipo-credit.json's ipos.byQuarter[].items ({ date, symbol, name,
// raised, mcap }). Only sizable listings count; SPAC shells are skipped.
export function ipoListingsFrom(ipoCredit) {
  const out = [];
  for (const q of ipoCredit?.ipos?.byQuarter || []) {
    for (const it of Array.isArray(q?.items) ? q.items : []) {
      if (!it || !/^\d{4}-\d{2}-\d{2}$/.test(it.date || "") || !it.symbol) continue;
      if (it.spac || /acquisition corp|capital corp|spac/i.test(String(it.name || ""))) continue;
      out.push({ date: it.date, symbol: String(it.symbol).toUpperCase(), name: it.name || it.symbol, raised: Number(it.raised) || null, mcap: Number(it.mcap) || null });
    }
  }
  return out;
}

// All market-structure events whose date falls in [startMs, cutoffMs].
export function marketStructureCalendarEvents(startMs, cutoffMs, { ipos = [] } = {}) {
  if (!Number.isFinite(startMs) || !Number.isFinite(cutoffMs) || cutoffMs < startMs) return [];
  const startIso = new Date(startMs).toISOString().slice(0, 10);
  const endIso = new Date(cutoffMs).toISOString().slice(0, 10);
  const inWindow = (d) => d && d >= startIso && d <= endIso;
  const events = [];
  const first = new Date(startMs);
  let y = first.getUTCFullYear(), m = first.getUTCMonth() + 1;
  for (let i = 0; i < 26; i++) {
    const opex = monthlyExpiration(y, m);
    if (opex && opex > endIso) break;
    if (inWindow(opex)) {
      const quarterly = m % 3 === 0;
      const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
      if (quarterly) {
        events.push(event("witching", opex,
          `Quarterly options expiration ("triple witching")`,
          `Stock options, index options and index futures all expire. Volume runs heavy and prices can pin near big strikes into the close.`,
          "high", { time: "16:00 ET" }));
        events.push(event("sp-rebalance", opex,
          "S&P 500 quarterly rebalance takes effect after the close",
          "Index funds trade at the close to match new share counts and any additions or removals, announced about two weeks earlier.",
          "medium", { time: "16:00 ET", source: "S&P Dow Jones Indices", sourceUrl: "https://www.spglobal.com/spdji/en/governance/index-policies/" }));
        if (m === 12) {
          events.push(event("ndx-recon", opex,
            "Nasdaq-100 annual reconstitution takes effect after the close",
            "The yearly reset of the Nasdaq-100 list; names that join or leave see heavy closing trades.",
            "medium", { time: "16:00 ET", source: "Nasdaq", sourceUrl: "https://indexes.nasdaqomx.com/" }));
        }
      } else {
        events.push(event("opex", opex,
          `Monthly options expiration (${name})`,
          "The standard monthly stock and index options expire. Big open-interest strikes can pull prices toward them into the close.",
          "medium", { time: "16:00 ET" }));
      }
    }
    const vix = vixExpiration(y, m);
    if (inWindow(vix)) {
      events.push(event("vix-expiry", vix,
        "VIX options and futures expire",
        "Settles on the morning S&P 500 option prices. Volatility hedges roll around this date.",
        "low", { time: "09:30 ET", source: "Cboe", sourceUrl: "https://www.cboe.com/tradable_products/vix/" }));
    }
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  const seen = new Set();
  for (const row of Array.isArray(ipos) ? ipos : []) {
    const big = (row.raised != null && row.raised >= LOCKUP_MIN_RAISED) || (row.mcap != null && row.mcap >= LOCKUP_MIN_MCAP);
    if (!big || seen.has(row.symbol)) continue;
    const end = onOrBeforeTradingDay(addDays(row.date, LOCKUP_DAYS));
    if (!inWindow(end)) continue;
    seen.add(row.symbol);
    events.push(event("lockup", end,
      `${row.symbol} IPO lockup likely ends (estimate)`,
      `${row.name || row.symbol} listed ${row.date}. Insiders usually may sell about ${LOCKUP_DAYS} days after an IPO; the prospectus sets the real date.`,
      "low", { ipoSymbol: row.symbol, estimate: true, source: "Estimated from the IPO date" }));
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.subtype.localeCompare(b.subtype)));
  return events;
}
