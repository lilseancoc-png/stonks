// Strategy engines: the option each engine buys, and how it is priced later.
// One single long call or put, chosen from the live chain by the
// engine's own days-to-expiry window and target delta (each engine's window
// is different from the flagship's 30-90 day pick on purpose), with a
// liquidity screen so the Webull paper order has a real quote to fill at.
// A setup marked `calls: "shares"` buys stock on its call side instead
// (sharesContract below).
//
// Pure. No network, no AI.

import { greeks, bsPrice, yearsToExpiry, expiryCloseEpochSec } from "../greeks.mjs";
import { previousTradingDate } from "../us-equity-calendar.mjs";
import { BOOK } from "./config.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (fin(x) ? Math.round(x * 10000) / 10000 : null);

export const contractKey = (symbol, c) => (c?.structure === "shares" ? `${symbol}|shares` : `${symbol}|${c?.expiry}|${Number(c?.strike)}|${(c?.optionType || "call") === "put" ? "P" : "C"}`);

// A share trade (2026-11-17): BOOK.sharesUsd of stock at the run's price (a
// share dearer than that is not bought). It sits in the trade's `contract` slot so the book marks it
// like any other position: `mid` is the price per share, `shares` the count,
// and `costPct` the round-trip cost taken off the result. No expiry, so the
// expiry exits never fire. Long only (the side is always "call").
export function sharesContract(spot) {
  const px = Number(spot);
  if (!(px > 0)) return { skip: "no price" };
  // The same cap as one option contract: a share that costs more than the lot
  // (a reverse-split fund in the history test) is not bought.
  if (px > BOOK.sharesUsd) return { skip: "one share costs more than the $5,000 lot" };
  const shares = Math.floor(BOOK.sharesUsd / px);
  // Four decimals: split-adjusted history has prices under a dollar.
  return { structure: "shares", optionType: "call", shares, mid: r4(px), usd: Math.round(shares * px), costPct: BOOK.sharesCostPct * 2 };
}
// Dollars in a position at its entry: one contract (x100) or the share lot.
export const positionUsd = (c) => (c?.structure === "shares" ? (Number(c.shares) || 0) * (Number(c.mid) || 0) : (Number(c?.mid) || 0) * 100);

// The session before `date`: the exchange calendar where it covers the year
// (market holidays skipped), else the prior weekday.
export function sessionBefore(date) {
  const cal = previousTradingDate(date);
  if (cal) return cal;
  let ms = Date.parse(String(date).slice(0, 10) + "T12:00:00Z");
  if (!fin(ms)) return null;
  do { ms -= 86400000; } while ([0, 6].includes(new Date(ms).getUTCDay()));
  return new Date(ms).toISOString().slice(0, 10);
}
// The day an engine closes a contract it still holds: two sessions before
// the expiration date. That is the day the Webull mirror's own expiry
// control starts closing the position (expiryControl in
// lib/us-equity-calendar.mjs), so the record and the paper account close on
// the same run.
export function expiryExitDate(expirySec) {
  const d = new Date(Number(expirySec) * 1000);
  if (!(Number(expirySec) > 0) || !fin(d.getTime())) return null;
  let day = d.toISOString().slice(0, 10);
  for (let i = 0; i < BOOK.expiryExitSessions; i++) { day = sessionBefore(day); if (!day) return null; }
  return day;
}

export function dteOf(expirySec, nowMs) {
  const close = expiryCloseEpochSec(expirySec);
  return fin(close) ? (close * 1000 - nowMs) / 86400000 : null;
}

function rowQuote(row) {
  const b = Number(row?.b), a = Number(row?.a);
  if (!(b > 0) || !(a > 0) || a < b) return null;
  const mid = (a + b) / 2;
  return { bid: b, ask: a, mid, spreadPct: ((a - b) / mid) * 100 };
}

// data: the per-ticker chain object ({ spot, chains: { [expSec]: { c, p } } }).
// prefs: { dteMin, dteIdeal, dteMax, delta }. Returns the contract or
// { skip: reason }.
export function pickContract(data, side, prefs, { nowMs = Date.now(), rfr = 0.045, minDteAfter = null } = {}) {
  const spot = Number(data?.spot);
  if (!(spot > 0) || !data?.chains) return { skip: "no chain" };
  const type = side === "put" ? "put" : "call", col = type === "put" ? "p" : "c";
  const exps = Object.keys(data.chains).map(Number).filter((e) => e > 0).map((e) => ({ e, dte: dteOf(e, nowMs) }))
    .filter((x) => fin(x.dte) && x.dte >= Math.max(prefs.dteMin, minDteAfter ?? 0) && x.dte <= prefs.dteMax)
    .sort((a, b) => Math.abs(a.dte - prefs.dteIdeal) - Math.abs(b.dte - prefs.dteIdeal));
  if (!exps.length) return { skip: "no expiry in the engine's window" };
  let sawQuote = false, sawLiquid = false;
  // Nearest-to-ideal expiry first; fall through to the next one when its
  // strikes are too thin.
  for (const { e, dte } of exps.slice(0, 4)) {
    const rows = data.chains[e]?.[col] || [];
    const T = yearsToExpiry(e, nowMs / 1000);
    let best = null;
    for (const row of rows) {
      const K = Number(row?.s), iv = Number(row?.iv);
      if (!(K > 0) || !(iv > 0.03) || iv > 5) continue;
      const q = rowQuote(row); if (!q) continue;
      sawQuote = true;
      if (q.mid < BOOK.minMid || q.spreadPct > BOOK.maxSpreadPct) continue;
      if (!((Number(row.oi) || 0) >= BOOK.minOi || (Number(row.v) || 0) >= BOOK.minVol)) continue;
      sawLiquid = true;
      if (q.mid * 100 > BOOK.maxCost) continue;
      const g = greeks(type, spot, K, T, iv, rfr); if (!g) continue;
      const d = Math.abs(g.delta);
      if (d < 0.3 || d > 0.8) continue;
      const fit = Math.abs(d - prefs.delta) + q.spreadPct / 400;
      if (!best || fit < best.fit) best = { fit, K, iv, q, g, d, row };
    }
    if (best) {
      return {
        structure: "long", optionType: type, strike: best.K, expiry: e, dte: Math.round(dte),
        bid: r2(best.q.bid), ask: r2(best.q.ask), mid: r2(best.q.mid), spreadPct: Math.round(best.q.spreadPct * 10) / 10,
        iv: r4(best.iv), delta: r2(best.g.delta), thetaDay: r4(best.g.thetaDay),
        oi: Number(best.row.oi) || 0, vol: Number(best.row.v) || 0,
      };
    }
  }
  return { skip: !sawQuote ? "no two-sided quotes" : !sawLiquid ? "strikes too thin or too wide" : "one contract costs more than the $5,000 cap" };
}

// The current price of a held contract: the chain's own mid when the exact
// strike is quoted, else Black-Scholes at the entry IV.
export function quoteContract(data, contract, { nowMs = Date.now(), rfr = 0.045 } = {}) {
  const spot = Number(data?.spot);
  if (!(spot > 0) || !contract) return null;
  // A share position is marked at the stock's price.
  if (contract.structure === "shares") return { mid: r4(spot), bid: null, ask: null, spot, source: "spot", iv: null };
  const col = contract.optionType === "put" ? "p" : "c";
  const row = (data.chains?.[contract.expiry]?.[col] || []).find((r) => Number(r?.s) === Number(contract.strike));
  const q = row ? rowQuote(row) : null;
  if (q && q.spreadPct <= 60) return { mid: r2(q.mid), bid: r2(q.bid), ask: r2(q.ask), spot, source: "chain", iv: Number(row.iv) > 0 ? r4(Number(row.iv)) : null };
  const T = yearsToExpiry(contract.expiry, nowMs / 1000);
  const iv = Number(row?.iv) > 0.03 ? Number(row.iv) : Number(contract.iv);
  const px = bsPrice(col === "p" ? "put" : "call", spot, Number(contract.strike), T, iv, rfr);
  return px == null ? null : { mid: r2(Math.max(0.01, px)), bid: null, ask: null, spot, source: "model", iv: r4(iv) };
}
