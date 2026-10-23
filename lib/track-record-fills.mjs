// Real-fill measurement for the Top Picks track record.
//
// The record's headline P&L is a model: Black-Scholes at the entry IV, entry
// and exit at mid (scripts/build.mjs markOptionToMarket). This module adds the
// numbers a person actually trading the picks would see, without changing the
// model or any exit rule:
//
//   - realFillMark: buy at the ask, sell at the bid (shorts the other way),
//     priced from the chain the bake already fetched. A leg with no usable
//     quote falls back to the model price less half its entry bid/ask spread.
//   - exitDetailFor: the exit trigger next to the mark the close was booked at,
//     so "booked at the twice-daily mark" and "a resting order at the trigger"
//     can both be read off the record.
//   - compactClosedForArchive / mergeArchive: closed trades past the record's
//     120-day / 250-trade window move to a slim archive instead of being lost.
//   - parseFillsCsv: the Owner's own trade log (paper / real fills), uploaded
//     through api/auth/[action].js "picks-fills".
//
// Pure: no network, no AI, no file access.

import { bsPrice, yearsToExpiry } from "./greeks.mjs";

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

// Outcome from a P&L %, shared by the record and the SPY baseline. A close
// that rounds to 0.0% is "flat": neither a win nor a loss, so it stays out of
// the win rate (every reader counts only "win" / "loss").
export function outcomeFromPnl(pnlPct) {
  if (pnlPct == null || !Number.isFinite(Number(pnlPct))) return "void";
  const p = Math.round(Number(pnlPct) * 10) / 10;
  if (p === 0) return "flat";
  return p > 0 ? "win" : "loss";
}

// The position as signed legs (+qty long, -qty short). A single long option is
// one +1 leg. Returns null when the contract can't be described.
export function positionLegs(contract, side) {
  const c = contract;
  if (!c) return null;
  const structure = c.structure || "long";
  if (structure === "debit_vertical" || structure === "credit_vertical") {
    if (!Array.isArray(c.legs) || !c.legs.length) return null;
    return c.legs.map((l) => ({
      qty: num(l.qty) || 0,
      type: l.type || c.optionType || side,
      strike: num(l.strike),
      expiry: num(l.expiry ?? c.expiry),
      iv: num(l.iv),
      bid: num(l.bid),
      ask: num(l.ask),
    }));
  }
  return [{ qty: 1, type: side, strike: num(c.strike), expiry: num(c.expiry), iv: num(c.iv), bid: num(c.bid), ask: num(c.ask) }];
}

// Live bid/ask for one leg from a bake chain payload
// (data.chains[expirySec].c|p rows of { s, b, a }). Null when the row is
// missing or the quote is unusable (crossed, or both sides zero).
export function legQuote(data, leg) {
  const chain = data?.chains?.[String(leg.expiry)];
  const rows = chain ? (leg.type === "put" ? chain.p : chain.c) : null;
  if (!Array.isArray(rows) || leg.strike == null) return null;
  const row = rows.find((r) => r && num(r.s) != null && Math.abs(num(r.s) - leg.strike) < 1e-6);
  if (!row) return null;
  const bid = num(row.b), ask = num(row.a);
  if (bid == null || ask == null || bid < 0 || ask <= 0 || bid > ask) return null;
  return { bid, ask };
}

// Cash to open at the touch: pay the ask on longs, take the bid on shorts.
// > 0 is a debit, < 0 a credit. Null without a stored entry bid/ask on every
// leg (trades enrolled before 2026-10-21 have none).
export function entryFillCost(legs) {
  if (!Array.isArray(legs) || !legs.length) return null;
  let cost = 0;
  for (const l of legs) {
    const px = l.qty > 0 ? l.ask : l.bid;
    if (px == null || !(px >= 0) || l.ask == null || l.bid == null) return null;
    cost += l.qty * px;
  }
  return cost;
}

// Real-fill P&L % of an open or closing position. Same sign convention as
// markOptionToMarket: + means the trade is making money. Returns
// { pnlPct, basis: "quote" | "model" } or null when it can't be priced.
export function realFillMark(entry, data, { rate = 0.045, nowSec = Date.now() / 1000 } = {}) {
  const legs = positionLegs(entry?.contract, entry?.side);
  if (!legs) return null;
  const cost = entryFillCost(legs);
  if (cost == null || cost === 0) return null;
  const spot = num(data?.spot);
  let close = 0;
  let basis = "quote";
  for (const l of legs) {
    if (l.strike == null || l.expiry == null) return null;
    const T = yearsToExpiry(l.expiry, nowSec);
    const expired = T <= 1 / (365.25 * 24 * 60) + 1e-12;
    let px;
    if (expired) {
      if (!spot) return null;
      px = l.type === "put" ? Math.max(0, l.strike - spot) : Math.max(0, spot - l.strike);
    } else {
      const q = legQuote(data, l);
      if (q) {
        px = l.qty > 0 ? q.bid : q.ask;
      } else {
        // No usable quote: model price, less half the entry spread on a sale
        // and plus half on a buy-back.
        if (!spot || l.iv == null) return null;
        const model = bsPrice(l.type, spot, l.strike, T, l.iv, rate);
        if (!(model >= 0)) return null;
        const half = Math.max(0, (l.ask - l.bid) / 2);
        px = l.qty > 0 ? Math.max(0, model - half) : model + half;
        basis = "model";
      }
    }
    close += l.qty * px;
  }
  const pnl = cost > 0 ? (close / cost - 1) * 100 : ((-cost + close) / -cost) * 100;
  return Number.isFinite(pnl) ? { pnlPct: r1(pnl), basis } : null;
}

// Exit trigger vs the booked mark. tpPct / stopPct are the record's rules in
// percent (25 / 50, or 50 / 50 for credit spreads; legacy closes retain theirs). atTriggerPct is what a
// resting order sitting exactly at the trigger would have booked; it is
// optimistic for stops, which can gap through the level.
export function exitDetailFor(status, bookedPct, { tpPct, stopPct } = {}) {
  const booked = num(bookedPct);
  let trigger = null;
  if (status === "hit-tp-prem" && tpPct != null) trigger = Number(tpPct);
  else if (status === "hit-stop-prem" && stopPct != null) trigger = -Number(stopPct);
  return {
    triggerPct: trigger,
    bookedPct: r1(booked),
    atTriggerPct: trigger != null ? trigger : r1(booked),
    overshootPct: trigger != null && booked != null ? r1(booked - trigger) : null,
  };
}

// Slim copy of a closed trade for the archive: the fields the stats and a
// later review need, without the per-pick narrative and timing payloads.
export function compactClosedForArchive(c) {
  if (!c) return null;
  const k = c.contract || {};
  return {
    symbol: c.symbol, side: c.side, tier: c.tier ?? null, score: c.score ?? null,
    entryDate: c.entryDate, exitDate: c.exitDate ?? null,
    entrySpot: c.entrySpot ?? null, exitSpot: c.exitSpot ?? null,
    status: c.status ?? null, outcome: c.outcome ?? null,
    optionPnlPct: c.optionPnlPct ?? null, underlyingPnlPct: c.underlyingPnlPct ?? null,
    realFillPnlPct: c.realFillPnlPct ?? null, realFillBasis: c.realFillBasis ?? null,
    exitDetail: c.exitDetail ?? null,
    exitPolicy: c.exitPolicy ?? null,
    mfePct: c.mfePct ?? null, maePct: c.maePct ?? null, optHiPct: c.optHiPct ?? null, optLoPct: c.optLoPct ?? null,
    sector: c.sector ?? null, entryRegime: c.entryRegime ?? null, cohort: c.cohort ?? null,
    modelEpoch: c.modelEpoch ?? null, gradeModelVersion: c.gradeModelVersion ?? null,
    entryPolicyVersion: c.entryPolicyVersion ?? null,
    entryVolatilityRisk: c.entryVolatilityRisk ?? null,
    entryEconomics: c.entryEconomics ?? null,
    entryInvalidation: c.entryInvalidation ?? null, entryTarget: c.entryTarget ?? null,
    vehicleCut: c.vehicleCut ?? null,
    aiGrade: c.thesis?.aiGrade ?? c.aiGrade ?? null,
    contract: {
      structure: k.structure || "long", strike: k.strike ?? null, expiry: k.expiry ?? null,
      mid: k.mid ?? null, bid: k.bid ?? null, ask: k.ask ?? null,
    },
    archived: true,
  };
}

const archiveKey = (c) => `${c.symbol}:${c.side}:${c.entryDate}`;

// Newest first, deduped by symbol:side:entryDate, capped at max entries.
export function mergeArchive(prevArchive, removedClosed, max = 5000) {
  const out = [];
  const seen = new Set();
  const add = (c) => {
    if (!c || !c.symbol || !c.entryDate) return;
    const k = archiveKey(c);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };
  for (const c of (removedClosed || [])) add(c.archived ? c : compactClosedForArchive(c));
  for (const c of (Array.isArray(prevArchive) ? prevArchive : [])) add(c);
  out.sort((a, b) => Date.parse(b.exitDate || b.entryDate) - Date.parse(a.exitDate || a.entryDate));
  return out.slice(0, max);
}

// --- Owner trade log (paper / real fills) ----------------------------------
// Columns of /mnt/project-files/top-picks-review/trade-log-template.csv. Extra
// columns are ignored; missing ones read as blank.
export const FILL_COLUMNS = Object.freeze([
  "trade_id", "account", "symbol", "side", "structure", "legs", "qty",
  "mingstreet_run_time_et", "mingstreet_entry_mid", "order_sent_time_et",
  "stock_price_at_order", "bid_at_order", "ask_at_order", "order_type", "limit_steps",
  "fill_price", "fill_time_et", "skipped", "skip_reason",
  "close_reason_feed", "feed_exit_pnl_pct", "close_order_time_et",
  "bid_at_close", "ask_at_close", "close_fill_price", "close_fill_time_et",
  "fees", "close_trigger", "notes",
]);
const NUMERIC_FILL_COLUMNS = new Set([
  "qty", "mingstreet_entry_mid", "stock_price_at_order", "bid_at_order", "ask_at_order",
  "limit_steps", "fill_price", "feed_exit_pnl_pct", "bid_at_close", "ask_at_close",
  "close_fill_price", "fees",
]);
export const FILLS_MAX_ROWS = 2000;
export const FILLS_MAX_BYTES = 512 * 1024;

// RFC 4180-style splitter: quoted fields, doubled quotes, CRLF or LF.
function csvRows(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => String(f).trim() !== ""));
}

function cleanText(v, max = 200) {
  // Strip control characters; the client escapes on render as well.
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

// Your P&L % from your own fill prices. Credit spreads are entered as positive
// net credits and closed with a positive net debit to buy back.
export function fillPnlPct(row) {
  const open = num(row.fill_price), close = num(row.close_fill_price);
  if (open == null || close == null || !(open > 0)) return null;
  const qty = Math.abs(num(row.qty) || 1);
  const credit = /credit/i.test(String(row.structure || ""));
  let pnl = credit ? (open - close) / open * 100 : (close / open - 1) * 100;
  const fees = num(row.fees);
  if (fees != null && fees > 0) pnl -= fees / (open * 100 * qty) * 100;
  return r1(pnl);
}

// Entry slippage vs Mingstreet's entry mid, as % of the mid. + means you paid
// more than the record (or, on a credit, took in less).
export function entrySlippagePct(row, recordMid = null) {
  const fill = num(row.fill_price);
  const mid = num(row.mingstreet_entry_mid) ?? num(recordMid);
  if (fill == null || mid == null || !(mid > 0)) return null;
  const credit = /credit/i.test(String(row.structure || ""));
  return r2(credit ? (mid - fill) / mid * 100 : (fill / mid - 1) * 100);
}

export function parseFillsCsv(text) {
  const errors = [];
  if (typeof text !== "string" || !text.trim()) return { rows: [], errors: ["empty file"] };
  if (text.length > FILLS_MAX_BYTES) return { rows: [], errors: [`file is over ${Math.round(FILLS_MAX_BYTES / 1024)} KB`] };
  const all = csvRows(text.replace(/^﻿/, ""));
  if (!all.length) return { rows: [], errors: ["no rows"] };
  const header = all[0].map((h) => cleanText(h, 60).toLowerCase().replace(/\s+/g, "_"));
  if (!header.includes("trade_id")) return { rows: [], errors: ["missing trade_id column"] };
  const rows = [];
  for (let i = 1; i < all.length; i++) {
    if (rows.length >= FILLS_MAX_ROWS) { errors.push(`only the first ${FILLS_MAX_ROWS} rows were kept`); break; }
    const raw = {};
    header.forEach((h, j) => { raw[h] = all[i][j]; });
    const tradeId = cleanText(raw.trade_id, 40);
    if (!tradeId) { errors.push(`row ${i + 1}: no trade_id, skipped`); continue; }
    if (/example row/i.test(String(raw.notes || ""))) continue;
    const row = {};
    for (const col of FILL_COLUMNS) {
      const v = raw[col];
      if (NUMERIC_FILL_COLUMNS.has(col)) {
        const s = cleanText(v, 30).replace(/[$,%\s]/g, "");
        const n = s === "" ? null : Number(s);
        if (s !== "" && !Number.isFinite(n)) errors.push(`row ${i + 1}: ${col} "${cleanText(v, 20)}" is not a number`);
        row[col] = Number.isFinite(n) ? n : null;
      } else {
        row[col] = cleanText(v, col === "notes" || col === "skip_reason" ? 300 : 80);
      }
    }
    row.trade_id = tradeId;
    row.account = row.account || "unlabeled";
    row.your_pnl_pct = fillPnlPct(row);
    row.entry_slippage_pct = entrySlippagePct(row);
    rows.push(row);
  }
  return { rows, errors: errors.slice(0, 20) };
}
