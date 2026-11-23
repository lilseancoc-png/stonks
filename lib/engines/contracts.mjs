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
import { BOOK, SIZE_WEIGHTS, normalizeMaxQty, normalizePremiumUsd, normalizeSharesMaxUsd, premiumMaxQty } from "./config.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (fin(x) ? Math.round(x * 10000) / 10000 : null);

export const contractKey = (symbol, c) => (c?.structure === "shares" ? `${symbol}|shares` : `${symbol}|${c?.expiry}|${Number(c?.strike)}|${(c?.optionType || "call") === "put" ? "P" : "C"}`);

// A share trade (2026-11-17): BOOK.sharesUsd of stock at the run's price (a
// share dearer than that is not bought). It sits in the trade's `contract` slot so the book marks it
// like any other position: `mid` is the price per share, `shares` the count,
// and `costPct` the round-trip cost taken off the result. No expiry, so the
// expiry exits never fire. Long only (the side is always "call").
// `usd` sets another lot size (the core engines' holdings, 2026-11-17).
export function sharesContract(spot, { usd = BOOK.sharesUsd } = {}) {
  const px = Number(spot), lot = Number(usd) > 0 ? Number(usd) : BOOK.sharesUsd;
  if (!(px > 0)) return { skip: "no price" };
  // The same cap as one option contract: a share that costs more than the lot
  // (a reverse-split fund in the history test) is not bought.
  if (px > lot) return { skip: `one share costs more than the $${lot.toLocaleString("en-US")} lot` };
  const shares = Math.floor(lot / px);
  // Four decimals: split-adjusted history has prices under a dollar.
  return { structure: "shares", optionType: "call", shares, mid: r4(px), usd: Math.round(shares * px), costPct: BOOK.sharesCostPct * 2 };
}
// Contracts in an option position: `qty` since the option size went to
// dollars (2026-11-17, BOOK.optionUsd); a trade without it is one contract.
export const contractsOf = (c) => (Number.isInteger(c?.qty) && c.qty > 0 ? c.qty : 1);
// Dollars in a position at its entry: the contracts (x100 each) or the share
// lot. An option bought on the fill basis (2026-11-19) counts what it cost at
// the ask (`entryFill`); older trades their mid.
export const entryPxOf = (c) => (Number(c?.entryFill) > 0 ? Number(c.entryFill) : Number(c?.mid) || 0);
export const positionUsd = (c) => (c?.structure === "shares" ? (Number(c.shares) || 0) * (Number(c.mid) || 0) : entryPxOf(c) * 100 * contractsOf(c));
// The same position at the flat risk size (2026-11-19: `flatQty` /
// `flatShares`, the size before the conviction multiplier). A trade with no
// flat size was not conviction-sized: its flat size is its size.
export const flatPositionUsd = (c) => (c?.structure === "shares"
  ? (Number.isInteger(c.flatShares) ? c.flatShares : Number(c.shares) || 0) * (Number(c.mid) || 0)
  : entryPxOf(c) * 100 * (Number.isInteger(c?.flatQty) && c.flatQty > 0 ? c.flatQty : contractsOf(c)));
// How many contracts make about `usd` of premium: the count whose cost is
// nearest it, at least one (a contract dearer than `usd` is bought once; the
// book's per-contract cap still applies). No size given = one contract.
export function optionQty(mid, usd) {
  const one = (Number(mid) || 0) * 100;
  if (!(one > 0) || !(Number(usd) > 0)) return 1;
  return Math.max(1, Math.round(Number(usd) / one));
}

// ---------------------------------------------------------------------------
// Fill basis (2026-11-19): a new option trade books the ask going in and the
// bid coming out. Stops and targets still fire on the mid (markAndCheck);
// only the booked result changes. When the chain has no two-sided quote for
// the held strike (a Black-Scholes mark), the bid is the mark less half the
// spread the contract had at entry (`basis: "est"`).
// ---------------------------------------------------------------------------
export function exitFill(q, contract) {
  if (!q || !(Number(q.mid) > 0)) return null;
  if (q.source === "chain" && Number(q.bid) > 0) return { px: Number(q.bid), basis: "bid" };
  const half = Math.max(0, Number(contract?.spreadPct) || 0) / 200;
  return { px: Math.max(0.01, Number(q.mid) * (1 - half)), basis: "est" };
}

// ---------------------------------------------------------------------------
// Sizing (2026-11-19). Risk sizing: each trade risks about the budget. An
// option expiring within BOOK.riskWholeDte days risks its whole premium; a
// longer one its premium x the stop x BOOK.riskStopPad (gaps and fills past
// the stop). Shares risk entry minus stop per share. Then the conviction
// multiplier (SIZE_WEIGHTS), 0.5x to 2x. Options: 1 to the contract cap
// (`sizing.maxQty`, Owner Settings ENGINES_MAX_QTY; BOOK.riskMaxQty, 200 since
// 2026-11-23, 25 from 2026-11-20, when unset) and at most the premium cap
// (`sizing.maxPremiumUsd`, ENGINES_MAX_PREMIUM_USD, $200,000; a put's side
// cap is passed in by the book), whichever is fewer. Each trade records the
// cap and whether the cap, not the budget, set its size (`size.cap`,
// `size.capBy`, `size.capped`, `size.wantQty`). Shares: at least one share,
// at most the share cap (`sizing.sharesMaxUsd`, ENGINES_SHARES_MAX_USD,
// BOOK.sharesMaxUsd, $250,000 since 2026-11-23; $25,000 before).
// ---------------------------------------------------------------------------
const clampN = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const usd = (x) => "$" + Math.round(x).toLocaleString("en-US");
// The conviction multiplier and its parts (each { key, x, why }).
// scorePart: false leaves the score out (Reversion and Macro since
// 2026-11-20, ENGINES_CONV_NO_SCORE): it is listed at 1x with the reason.
export function convictionRead({ score, bar, alloc, ivBand, spreadPct, nameHeld, groupOpen, option, scorePart = true }) {
  const W = SIZE_WEIGHTS, parts = [];
  if (!scorePart) parts.push({ key: "score", x: 1, why: "the setup score is left out on this engine (its higher scores did worse in the 2007-2026 test)" });
  else if (fin(score) && fin(bar)) {
    const t = clampN((score - bar) / W.scoreSpan, 0, 1), x = r2(W.scoreAtBar + (W.scoreTop - W.scoreAtBar) * t);
    parts.push({ key: "score", x, why: `score ${Math.round(score)} against a bar of ${Math.round(bar)}` });
  }
  if (alloc) {
    const x = alloc.status === "closed" ? W.allocHeld : alloc.status === "open" && fin(alloc.w) && alloc.w >= 1.5 ? W.allocHigh : alloc.status === "open" && fin(alloc.w) && alloc.w <= 0.5 ? W.allocLow : 1;
    parts.push({ key: "allocator", x, why: alloc.status === "closed" ? "the Allocator expects this setup to lose in today's market type" : alloc.status === "new" ? "the Allocator has too few results for this setup" : `the Allocator's size is ${alloc.w}x` });
  }
  if (option) {
    const x = ivBand === "cheap" ? W.ivCheap : ivBand === "rich" ? W.ivRich : ivBand === "very-rich" ? W.ivVeryRich : 1;
    if (ivBand) parts.push({ key: "iv", x, why: `options are ${ivBand.replace("-", " ")} against the stock's own history` });
    if (fin(spreadPct)) {
      const sx = spreadPct > W.spreadVeryWide ? W.spreadVeryWideX : spreadPct > W.spreadWide ? W.spreadWideX : 1;
      parts.push({ key: "spread", x: sx, why: `spread ${Math.round(spreadPct * 10) / 10}% of the mid` });
    }
  }
  if (nameHeld) parts.push({ key: "name", x: W.nameHeld, why: "the name is already open in another trade" });
  if (fin(groupOpen) && groupOpen >= W.groupBusy) parts.push({ key: "group", x: W.groupBusyX, why: `${groupOpen} trades already open in its sector group` });
  const raw = parts.reduce((a, p) => a * p.x, 1);
  return { mult: r2(clampN(raw, BOOK.convMin, BOOK.convMax)), raw: r2(raw), parts };
}

// One option trade's size. Returns { qty, flatQty, size } or { skip, dear }.
// sizing: { mode: "risk", budget, conviction } | { mode: "premium", optionUsd } | { mode: "one" }.
export function sizeOption(contract, { sizing, exits = {}, fixedQty = null, conviction = null, fillBasis = false } = {}) {
  const px = fillBasis && Number(contract?.ask) > 0 ? Number(contract.ask) : Number(contract?.mid) || 0;
  const cost1 = px * 100;
  if (!(cost1 > 0)) return { skip: "no price" };
  if (!sizing || sizing.mode === "one") return { qty: 1, flatQty: 1, size: { mode: "one", why: "one contract" } };
  if (sizing.mode === "premium") { const q = optionQty(contract.mid, sizing.optionUsd); return { qty: q, flatQty: q, size: { mode: "premium", usd: sizing.optionUsd, why: `about ${usd(sizing.optionUsd)} of premium` } }; }
  const budget = Number(sizing.budget) > 0 ? Number(sizing.budget) : BOOK.riskUsd;
  // `dearBudget` (logic audit fix, 2026-11-21): the too-dear check reads the
  // full budget when an engine or a candidate sizes on part of it.
  const dearAt = Number(sizing.dearBudget) > 0 ? Number(sizing.dearBudget) : budget;
  if (cost1 > BOOK.riskSkipX * dearAt) return { skip: `one contract costs ${usd(cost1)}, more than ${BOOK.riskSkipX}x the ${usd(dearAt)} risk budget`, dear: true };
  const dte = Number(contract.dte);
  const whole = !(dte > BOOK.riskWholeDte) || !fin(exits?.stop);
  const risk1 = whole ? cost1 : Math.min(cost1, cost1 * (Math.abs(exits.stop) / 100) * BOOK.riskStopPad);
  const qtyCap = normalizeMaxQty(sizing.maxQty), premCap = premiumMaxQty(cost1, sizing.maxPremiumUsd);
  const cap = Math.min(qtyCap, premCap), capBy = premCap < qtyCap ? "premium" : "contracts";
  const premUsd = normalizePremiumUsd(sizing.maxPremiumUsd);
  const flatWant = Math.floor(budget / risk1), flatQty = clampN(flatWant, 1, cap);
  const basis = whole ? `whole premium (expires within ${BOOK.riskWholeDte} days)` : `premium x ${Math.abs(exits.stop)}% stop x ${BOOK.riskStopPad}`;
  const size = { mode: "risk", budget, risk1: Math.round(risk1), basis, flatQty, cap, capBy, maxPremiumUsd: premUsd };
  if (Number.isInteger(fixedQty) && fixedQty > 0) return { qty: fixedQty, flatQty: fixedQty, size: { ...size, flatQty: fixedQty, qty: fixedQty, mult: 1, parts: [], why: `fixed at ${fixedQty} contract${fixedQty > 1 ? "s" : ""} (a test)` } };
  const cv = sizing.conviction && conviction ? conviction : null;
  // What the budget asked for before the cap, so the record shows when the
  // cap (not the budget or conviction) decided the size.
  const wantQty = cv ? Math.floor((budget * cv.mult) / risk1) : flatWant;
  const qty = clampN(wantQty, 1, cap), capped = wantQty > cap;
  return { qty, flatQty, size: { ...size, qty, wantQty, capped, flatCapped: flatWant > cap, mult: cv ? cv.mult : 1, parts: cv ? cv.parts : [],
    why: `risk ${usd(risk1)} a contract (${basis}) against a ${usd(budget)} budget: ${flatQty} flat${cv ? `, x${cv.mult} conviction = ${qty}` : ""}${capped ? ` (the ${capBy === "premium" ? `${usd(premUsd)} premium cap (${cap} contracts)` : `${cap}-contract cap`} set it; the budget asked for ${wantQty})` : ""}` } };
}

// One share trade's size (signal engines). Returns the share count and size,
// or null to keep the lot (no stop to size from, or not risk sizing).
export function sizeShares(px, stopLevel, { sizing, conviction = null } = {}) {
  if (!sizing || sizing.mode !== "risk" || !(px > 0) || !fin(stopLevel) || !(px > stopLevel)) return null;
  const budget = Number(sizing.budget) > 0 ? Number(sizing.budget) : BOOK.riskUsd, per = px - stopLevel;
  const capUsd = normalizeSharesMaxUsd(sizing.sharesMaxUsd);
  const cap = Math.max(1, Math.floor(capUsd / px));
  const flat = clampN(Math.floor(budget / per), 1, cap);
  const cv = sizing.conviction && conviction ? conviction : null;
  const want = Math.floor((budget * (cv ? cv.mult : 1)) / per);
  const n = clampN(want, 1, cap);
  return { shares: n, flatShares: flat, size: { mode: "risk", budget, riskPerShare: r2(per), flatShares: flat, shares: n, capUsd, capped: want > cap,
    mult: cv ? cv.mult : 1, parts: cv ? cv.parts : [],
    why: `risk $${r2(per)} a share (entry minus stop) against a ${usd(budget)} budget: ${flat} shares flat${cv ? `, x${cv.mult} conviction = ${n}` : ""}${want > cap ? ` (capped at ${usd(capUsd)} of stock)` : ""}` } };
}

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
// avoid: contract keys (contractKey with `symbol`) not to take: the
// extreme-fear test's own contract at Webull, never one another trade holds.
export function pickContract(data, side, prefs, { nowMs = Date.now(), rfr = 0.045, minDteAfter = null, avoid = null, symbol = null } = {}) {
  const spot = Number(data?.spot);
  if (!(spot > 0) || !data?.chains) return { skip: "no chain" };
  const type = side === "put" ? "put" : "call", col = type === "put" ? "p" : "c";
  const exps = Object.keys(data.chains).map(Number).filter((e) => e > 0).map((e) => ({ e, dte: dteOf(e, nowMs) }))
    .filter((x) => fin(x.dte) && x.dte >= Math.max(prefs.dteMin, minDteAfter ?? 0) && x.dte <= prefs.dteMax)
    .sort((a, b) => Math.abs(a.dte - prefs.dteIdeal) - Math.abs(b.dte - prefs.dteIdeal));
  if (!exps.length) return { skip: "no expiry in the engine's window" };
  let sawQuote = false, sawLiquid = false, sawInRange = false;
  // Deltas from 0.3 to 0.8, or from 0.05 under the target when it is lower
  // (the washout bounce's 0.3-delta calls, 2026-11-17: a 0.3 floor would only
  // ever take strikes on the far side of the target).
  const dLo = fin(Number(prefs.delta)) ? Math.min(0.3, Number(prefs.delta) - 0.05) : 0.3;
  // Nearest-to-ideal expiry first; fall through to the next one when its
  // strikes are too thin.
  for (const { e, dte } of exps.slice(0, 4)) {
    const rows = data.chains[e]?.[col] || [];
    const T = yearsToExpiry(e, nowMs / 1000);
    let best = null;
    for (const row of rows) {
      const K = Number(row?.s), iv = Number(row?.iv);
      if (!(K > 0) || !(iv > 0.03) || iv > 5) continue;
      if (avoid && avoid.has(contractKey(symbol, { expiry: e, strike: K, optionType: type }))) continue;
      const q = rowQuote(row); if (!q) continue;
      sawQuote = true;
      if (q.mid < BOOK.minMid || q.spreadPct > BOOK.maxSpreadPct) continue;
      if (!((Number(row.oi) || 0) >= BOOK.minOi || (Number(row.v) || 0) >= BOOK.minVol)) continue;
      sawLiquid = true;
      // Delta before cost (the same strikes pass either way): a liquid strike
      // in the delta range that costs too much is "too dear"; no liquid
      // strike in the range at all is said as that.
      const g = greeks(type, spot, K, T, iv, rfr); if (!g) continue;
      const d = Math.abs(g.delta);
      if (d < dLo || d > 0.8) continue;
      sawInRange = true;
      if (q.mid * 100 > BOOK.maxCost) continue;
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
  // Until 2026-11-23 a chain whose liquid strikes were all outside the delta
  // range was reported as too dear.
  return { skip: !sawQuote ? "no two-sided quotes" : !sawLiquid ? "strikes too thin or too wide" : !sawInRange ? `no liquid strike between ${r2(dLo)} and 0.8 delta` : "one contract costs more than the $5,000 cap" };
}

// The current price of a held contract: the chain's own mid when the exact
// strike is quoted (to half a cent: a split-adjusted strike is 96.875), else Black-Scholes at the entry IV.
export function quoteContract(data, contract, { nowMs = Date.now(), rfr = 0.045 } = {}) {
  const spot = Number(data?.spot);
  if (!(spot > 0) || !contract) return null;
  // A share position is marked at the stock's price.
  if (contract.structure === "shares") return { mid: r4(spot), bid: null, ask: null, spot, source: "spot", iv: null };
  const col = contract.optionType === "put" ? "p" : "c";
  const row = (data.chains?.[contract.expiry]?.[col] || []).find((r) => Math.abs(Number(r?.s) - Number(contract.strike)) < 0.005);
  const q = row ? rowQuote(row) : null;
  if (q && q.spreadPct <= 60) return { mid: r2(q.mid), bid: r2(q.bid), ask: r2(q.ask), spot, source: "chain", iv: Number(row.iv) > 0 ? r4(Number(row.iv)) : null };
  const T = yearsToExpiry(contract.expiry, nowMs / 1000);
  const iv = Number(row?.iv) > 0.03 ? Number(row.iv) : Number(contract.iv);
  const px = bsPrice(col === "p" ? "put" : "call", spot, Number(contract.strike), T, iv, rfr);
  return px == null ? null : { mid: r2(Math.max(0.01, px)), bid: null, ask: null, spot, source: "model", iv: r4(iv) };
}
