// Strategy engines: the earnings straddle paper trial (2026-11-27, owner:
// "Implement the paper trial straddle strategy then", after the 2026-11-26
// event tests). On the Earnings engine (ERN), labeled unproven.
//
// The idea: options usually price a bigger earnings move than the stock then
// makes, so buying straddles before reports loses on average. But when the
// stock's own past reactions are clearly bigger than what its options price
// now (the "cheap" side), buying both sides has paid. In the 2026-11-26 event
// study (AAPL, AMZN, IBM and GS since 2011, the implied move read from Cboe's
// single-stock volatility indexes before each report, no look-ahead) a
// straddle where the average of the last 8 reaction moves was 15%+ over the
// implied move made +44% a print over 99 prints (t 3.6; +32% and +54% in the
// two halves; +34% at twice the costs), while the rich side lost 26%. On the
// site's own 2026 prints the cheap side made +40% over 18, but three names
// carried it, so it runs on paper to be proven live.
//
// The rule, per stock with a report whose session is known (before the open
// or after the close; an unknown time is skipped, and so is a date that only
// Webull's backup list gives):
//   - at the afternoon decision run (15:30 ET) of the last session before the
//     report's reaction (the report day itself for an after-the-close
//     report, the session before for a before-the-open one);
//   - the expected size is the average of the stock's last 8 reaction-day
//     moves (close to close, at least 6 on hand), as a %;
//   - the implied move is the price of the at-the-money straddle in the first
//     expiry the trade can be held through (its call mid plus its put mid,
//     over the stock price), so it is the price actually paid;
//   - it buys when the expected size is at least 1.15x the implied move;
//   - both legs (same strike, same expiry, the strike nearest the stock that
//     quotes both sides liquidly) are bought at the ask, the same number of
//     each, sized so the pair costs about the risk budget (Owner Settings
//     ENGINES_RISK_USD, $2,000), never more than twice it;
//   - both legs are sold at the first run on the reaction day (the 11:00 ET
//     run), whatever they show: no stop, no target;
//   - at most 2 straddles a day and 4 open at once.
// Both legs reach the Webull paper account as ordinary option buys (the
// mirror only buys to open), tagged ERN with the -ST suffix on their IDs.
// The trial teaches the engine nothing, takes none of its slots, is not
// sized by conviction, the tape, the brake or the Allocator, and is scored
// apart (`trial: true`); `straddle` on each leg links the pair.
//
// Owner Settings ENGINES_TRIAL_STRADDLE (on) retires it for new trades.
// Pure. No network, no AI.

import { BOOK, sideMaxQty, sideMaxPremiumUsd, premiumMaxQty } from "./config.mjs";
import { contractKey, dteOf, expiryExitDate, positionUsd } from "./contracts.mjs";
import { greeks, yearsToExpiry } from "../greeks.mjs";
import { sessionForDate, etClock } from "../us-equity-calendar.mjs";
import { isNeverTrade, isSharesOnly } from "../never-trade.mjs";
import { rulesVersion } from "./learn.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (fin(x) ? Math.round(x * 10000) / 10000 : null);

export const STRADDLE = Object.freeze({
  setup: "straddle",
  idSuffix: "ST",
  cheapX: 1.15,       // expected size over the implied move to buy
  lookback: 8,        // past reactions averaged
  minPast: 6,         // fewest past reactions on hand
  perDay: 2,          // straddles opened a day at most
  slots: 4,           // straddles open at once
  maxDte: 45,         // the first expiry past the sale, within this many days
  skipX: 2,           // a pair costing more than this many risk budgets is not bought
});

// The next session after `date` (the exchange calendar where it covers the
// year, else the next weekday).
export function sessionAfter(date) {
  let ms = Date.parse(String(date).slice(0, 10) + "T12:00:00Z");
  if (!fin(ms)) return null;
  for (let k = 0; k < 10; k++) {
    ms += 86400000;
    const d = new Date(ms).toISOString().slice(0, 10), wd = new Date(ms).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const s = sessionForDate(d);
    if (!s || s.open) return d;
  }
  return null;
}

// The report this stock trades on today, or why not. earn: the view's `earn`
// (lib/engines/earn.mjs). Returns { entryDay, sellOn, reportDate, session } or
// { skip }.
export function straddleTiming(earn, today) {
  const nx = earn?.next;
  if (!nx?.date) return { skip: "no report date" };
  if (nx.source === "webull-backup") return { skip: "report date from the backup list only" };
  if (nx.session !== "AM" && nx.session !== "PM") return { skip: "report time not known" };
  const entryDay = nx.exitBy;
  if (!entryDay || entryDay !== today) return { skip: "not the last session before the report" };
  const sellOn = nx.session === "PM" ? sessionAfter(nx.date) : nx.date;
  if (!sellOn || sellOn <= today) return { skip: "no session after the report" };
  return { entryDay, sellOn, reportDate: nx.date, session: nx.session };
}

// The expected size: the average of the last `lookback` reaction-day moves
// (absolute, %), or null with fewer than `minPast`.
export function expectedMove(earn, { lookback = STRADDLE.lookback, minPast = STRADDLE.minPast } = {}) {
  const rows = [earn?.last, ...(Array.isArray(earn?.hist) ? earn.hist : [])].filter(Boolean);
  const moves = rows.map((r) => Number(r.movePct)).filter(fin).slice(0, lookback).map(Math.abs);
  if (moves.length < minPast) return null;
  return { pct: moves.reduce((a, b) => a + b, 0) / moves.length, n: moves.length };
}

function quoteRow(row) {
  const b = Number(row?.b), a = Number(row?.a);
  if (!(b > 0) || !(a > 0) || a < b) return null;
  const mid = (a + b) / 2;
  return { bid: b, ask: a, mid, spreadPct: ((a - b) / mid) * 100 };
}
const liquid = (row, strict) => {
  const oi = Number(row?.oi) || 0, vol = Number(row?.v) || 0;
  return strict ? oi >= BOOK.minOiAlone || (oi >= BOOK.minOi && vol >= BOOK.minVol) : oi >= BOOK.minOi || vol >= BOOK.minVol;
};

// The straddle to buy: the first expiry whose pre-expiry exit day (two
// sessions before it, when the mirror's expiry control closes it) is after
// the sale day, and in it the strike nearest the stock with a liquid,
// two-sided call and put. Returns { call, put, implied } or { skip }.
// data: the per-ticker chain ({ spot, chains: { [expSec]: { c, p } } }).
export function pickStraddle(data, { sellOn, nowMs, rfr = 0.045, strictLiq = true, avoid = null, symbol = null } = {}) {
  const spot = Number(data?.spot);
  if (!(spot > 0) || !data?.chains) return { skip: "no chain" };
  const exps = Object.keys(data.chains).map(Number).filter((e) => e > 0).sort((a, b) => a - b)
    .filter((e) => { const x = expiryExitDate(e), d = dteOf(e, nowMs); return x && x > sellOn && fin(d) && d > 0 && d <= STRADDLE.maxDte; });
  if (!exps.length) return { skip: "no expiry that holds past the report" };
  const e = exps[0];
  const calls = data.chains[e]?.c || [], puts = data.chains[e]?.p || [];
  const putAt = new Map(puts.map((r) => [Math.round(Number(r?.s) * 1000), r]));
  const T = yearsToExpiry(e, nowMs / 1000);
  let best = null, why = "no strike quotes both sides";
  for (const cr of calls) {
    const K = Number(cr?.s); if (!(K > 0)) continue;
    const pr = putAt.get(Math.round(K * 1000)); if (!pr) continue;
    const cq = quoteRow(cr), pq = quoteRow(pr);
    if (!cq || !pq) continue;
    if (cq.mid < BOOK.minMid || pq.mid < BOOK.minMid || cq.spreadPct > BOOK.maxSpreadPct || pq.spreadPct > BOOK.maxSpreadPct) { why = "spreads too wide"; continue; }
    if (!liquid(cr, strictLiq) || !liquid(pr, strictLiq)) { why = "strikes too thin"; continue; }
    if (cq.mid * 100 > BOOK.maxCost || pq.mid * 100 > BOOK.maxCost) { why = "one leg costs more than the $5,000 cap"; continue; }
    if (avoid && (avoid.has(contractKey(symbol, { expiry: e, strike: K, optionType: "call" })) || avoid.has(contractKey(symbol, { expiry: e, strike: K, optionType: "put" })))) { why = "the at-the-money contracts are already held"; continue; }
    const dist = Math.abs(K - spot);
    if (!best || dist < best.dist) best = { K, cr, pr, cq, pq, dist };
  }
  if (!best) return { skip: why };
  // Nearest strike only: a strike more than 5% from the stock is not a straddle.
  if (best.dist / spot > 0.05) return { skip: "no liquid strike within 5% of the stock" };
  const dte = Math.round(dteOf(e, nowMs));
  const leg = (type, row, q) => {
    const iv = Number(row.iv) > 0.03 && Number(row.iv) <= 5 ? Number(row.iv) : null;
    const g = iv ? greeks(type, spot, best.K, T, iv, rfr) : null;
    return { structure: "long", optionType: type, strike: best.K, expiry: e, dte, bid: r2(q.bid), ask: r2(q.ask), mid: r2(q.mid), spreadPct: r1(q.spreadPct),
      iv: r4(iv), delta: g ? r2(g.delta) : null, thetaDay: g ? r4(g.thetaDay) : null, oi: Number(row.oi) || 0, vol: Number(row.v) || 0 };
  };
  const call = leg("call", best.cr, best.cq), put = leg("put", best.pr, best.pq);
  return { call, put, implied: ((best.cq.mid + best.pq.mid) / spot) * 100, spot };
}

const ET_ID = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function legId(symbol, side, nowIso) {
  const p = {};
  for (const x of ET_ID.formatToParts(new Date(nowIso))) p[x.type] = x.value;
  return `ERN:${symbol}-${side === "put" ? "P" : "C"}-${p.month}/${p.day}/${p.year}-${p.hour}:${p.minute}-${STRADDLE.idSuffix}`;
}
export const isStraddleLeg = (t) => !!t?.straddle && t.setup === STRADDLE.setup;

// Opens the day's straddles. Called by stepBook after every engine's own
// setups and paper trials (input.straddle), so the Owner controls, account
// limits and the same-contract rule read the run's other new trades.
// ctx: { state, record, views, chains, nowIso, nowMs, today, late, rfr,
//   spec (the Earnings engine's registry entry), es (its state), sizing,
//   fillBasis, mode, off, ctl, dial, holders (contract key -> holder),
//   limitWhy(spec, c, contract), countNew() }.
// Returns { opened: [legs], rows: [check rows], skipped: n }.
export function openStraddles(ctx) {
  const { record, views, chains, nowIso, nowMs, today, late, rfr = 0.045, spec, es, sizing, fillBasis, mode, off, ctl, dial, holders, limitWhy, countNew } = ctx;
  const out = { opened: [], rows: [] };
  if (!spec?.setups?.[STRADDLE.setup] || spec.setups[STRADDLE.setup].retired) return out;
  if (!late) return out;
  const etDay = (iso) => { const ms = Date.parse(iso); return fin(ms) ? etClock(ms).date : null; };
  const legsOf = (list) => list.filter(isStraddleLeg);
  const pairs = (list) => new Set(legsOf(list).map((t) => t.straddle.id));
  const openPairs = () => pairs(record.open).size;
  const todayPairs = () => pairs([...record.open, ...record.closed].filter((t) => etDay(t.entryDate) === today)).size;
  const budget = Number(sizing?.budget) > 0 ? Number(sizing.budget) : BOOK.riskUsd;
  const wantLegs = [];
  for (const view of Object.values(views)) {
    if (!view || view.isEtf || view.aux || !view.earn) continue;
    const tm = straddleTiming(view.earn, today);
    if (tm.skip) continue;
    const sym = view.sym;
    const row = { symbol: sym, side: "call", setup: STRADDLE.setup, score: null, reasons: [], taken: false, why: null };
    out.rows.push(row);
    const ex = expectedMove(view.earn);
    if (!ex) { row.why = `fewer than ${STRADDLE.minPast} past reactions`; continue; }
    const signalKey = `straddle|${sym}|${tm.reportDate}`;
    if (es?.seen?.[signalKey]) { row.why = "already traded this report"; continue; }
    if (isNeverTrade(sym)) { row.why = "on the never-trade list"; continue; }
    if (isSharesOnly(sym)) { row.why = "shares-only name: no options"; continue; }
    if (mode !== "on") { row.why = "engines paused by the owner"; continue; }
    if (ctl?.stop) { row.why = "new trades stopped by the owner"; continue; }
    if (off?.has?.("earnings")) { row.why = "engine switched off"; continue; }
    if (ctl?.avoid?.has(sym)) { row.why = "on the owner's avoid list"; continue; }
    if (record.open.some((t) => isStraddleLeg(t) && t.symbol === sym)) { row.why = "already holds a straddle on this name"; continue; }
    const picked = pickStraddle(chains?.[sym], { sellOn: tm.sellOn, nowMs, rfr, strictLiq: spec.liquidAnd !== false, avoid: new Set(holders.keys()), symbol: sym });
    if (picked.skip) { row.why = `no straddle: ${picked.skip}`; continue; }
    const ratio = ex.pct / picked.implied;
    row.score = Math.round(ratio * 100);
    row.reasons = [`past ${ex.n} reactions averaged ${r1(ex.pct)}%`, `the straddle prices ${r1(picked.implied)}%`, `${r2(ratio)}x`];
    if (ratio < STRADDLE.cheapX) { row.why = `options not cheap: past moves ${r2(ratio)}x the implied move (needs ${STRADDLE.cheapX}x)`; continue; }
    wantLegs.push({ view, tm, ex, picked, ratio, row, signalKey });
  }
  // Cheapest first (the biggest expected move against the price).
  wantLegs.sort((a, b) => b.ratio - a.ratio || (a.view.sym < b.view.sym ? -1 : 1));
  for (const w of wantLegs) {
    const { view, tm, ex, picked, ratio, row, signalKey } = w, sym = view.sym;
    if (openPairs() >= STRADDLE.slots) { row.why = `no free slot (${STRADDLE.slots} straddles open)`; continue; }
    if (todayPairs() >= STRADDLE.perDay) { row.why = `day limit (${STRADDLE.perDay} straddles a day)`; continue; }
    const px = (ct) => (fillBasis && Number(ct.ask) > 0 ? Number(ct.ask) : Number(ct.mid));
    const pair1 = (px(picked.call) + px(picked.put)) * 100;
    if (!(pair1 > 0)) { row.why = "no price"; continue; }
    if (pair1 > STRADDLE.skipX * budget) { row.why = `one straddle costs $${Math.round(pair1).toLocaleString("en-US")}, over twice the $${budget.toLocaleString("en-US")} budget`; continue; }
    const flat = Math.max(1, Math.floor(budget / pair1 + 1e-9));
    // Both legs the same count: the tighter of the call and put caps, and of
    // the premium caps at each leg's own price.
    const cap = Math.min(sideMaxQty(sizing, "call"), sideMaxQty(sizing, "put"),
      sizing?.mode === "risk" ? premiumMaxQty(px(picked.call) * 100, sideMaxPremiumUsd(sizing, "call")) : Infinity,
      sizing?.mode === "risk" ? premiumMaxQty(px(picked.put) * 100, sideMaxPremiumUsd(sizing, "put")) : Infinity);
    let qty = Math.min(flat, cap), dialWhy = "";
    if (dial?.sizeMult && dial.sizeMult !== 1) { const q2 = Math.max(1, Math.min(cap, Math.round(qty * dial.sizeMult))); if (q2 !== qty) { dialWhy = `; risk dial ${dial.label} ${dial.sizeMult}x`; qty = q2; } }
    const why = `a straddle costs $${Math.round(pair1).toLocaleString("en-US")} against a $${budget.toLocaleString("en-US")} budget: ${qty} of each leg${qty < flat ? ` (capped at ${cap})` : ""}${dialWhy}`;
    const id = legId(sym, "call", nowIso), putId = legId(sym, "put", nowIso);
    const size = { mode: "straddle", budget, pairUsd: r2(pair1), qty, flatQty: flat, why };
    const mk = (ct, side, tradeId, pairId) => {
      const contract = { ...ct, qty, flatQty: flat, size, ...(fillBasis && Number(ct.ask) > 0 ? { entryFill: ct.ask } : {}) };
      const t = {
        engine: "earnings", tag: "ERN", symbol: sym, side, setup: STRADDLE.setup, score: row.score,
        reasons: row.reasons, facts: { expectedPct: r1(ex.pct), impliedPct: r1(picked.implied), ratio: r2(ratio), past: ex.n },
        signalKey, signalDate: view.f?.date || null, entryDate: nowIso, entrySpot: r2(view.spot), contract,
        exits: {}, stopLevel: null, targetLevel: null, exitBy: null, sellOn: tm.sellOn, trial: true,
        ...(es ? { rulesVersion: rulesVersion(spec, es), bar: es.bar ?? null } : {}),
        lastSpot: r2(view.spot), lastMid: ct.mid, optionPnlPct: 0, hiPct: 0, loPct: 0, sessions: 0, lastMarkDate: today,
        tradeId,
        straddle: { id: tradeId === id ? id : pairId, leg: side, pair: pairId, reportDate: tm.reportDate, session: tm.session, sellOn: tm.sellOn,
          expectedPct: r1(ex.pct), impliedPct: r1(picked.implied), ratio: r2(ratio), past: ex.n, pairUsd: r2(pair1 * qty) },
      };
      if (fillBasis && Number(ct.ask) > 0) {
        t.fill = { basis: "ask-bid", entry: ct.ask, entryMid: ct.mid };
        const bid0 = Number(ct.bid) > 0 ? Number(ct.bid) : Number(ct.mid);
        t.optionPnlPct = r1((bid0 / ct.ask - 1) * 100); t.markPnlPct = 0;
        if (Number(ct.bid) > 0) t.lastBid = ct.bid;
      }
      return t;
    };
    const callT = mk(picked.call, "call", id, putId), putT = mk(picked.put, "put", putId, id);
    // Account limits: the pair as one position (the call leg checked with the
    // put's premium added, so a limit is never passed by half a straddle).
    const both = { ...callT.contract, mid: (Number(callT.contract.mid) || 0) + (Number(putT.contract.mid) || 0), entryFill: callT.contract.entryFill && putT.contract.entryFill ? callT.contract.entryFill + putT.contract.entryFill : undefined };
    const lw = limitWhy ? limitWhy(spec, { symbol: sym, side: "call", setup: STRADDLE.setup }, both) || (positionUsd(both) > 0 ? null : "no price") : null;
    if (lw) { row.why = lw; continue; }
    if (ctl) {
      // Which Owner controls touched it (the dial), like every engine trade.
      if (dial) { callT.ownerControls = { dial: dial.level }; putT.ownerControls = { dial: dial.level }; }
    }
    for (const t of [callT, putT]) {
      record.open.push(t); out.opened.push(t);
      holders.set(contractKey(sym, t.contract), { engine: "earnings", tradeId: t.tradeId, trade: t });
      if (countNew) countNew(t);
    }
    if (es) { es.seen ||= {}; es.seen[signalKey] = "t"; }
    row.taken = true; row.tradeId = callT.tradeId; row.twin = putT.tradeId; row.size = why;
  }
  return out;
}

// Each straddle as one row (both legs together): open and closed, with the
// pair's dollar result and its % on the premium paid. For the engines page.
export function straddleRows(record, { kept = 30 } = {}) {
  const all = [...(record?.open || []), ...(record?.closed || [])].filter(isStraddleLeg);
  const byId = new Map();
  for (const t of all) {
    const k = t.straddle.id;
    if (!byId.has(k)) byId.set(k, []);
    byId.get(k).push(t);
  }
  const rows = [];
  for (const [id, legs] of byId) {
    const c = legs.find((t) => t.side === "call") || legs[0], s = c.straddle || {};
    const cost = legs.reduce((a, t) => a + (Number(t.fill?.entry) > 0 ? Number(t.fill.entry) : Number(t.contract?.mid) || 0) * 100 * (Number(t.contract?.qty) || 1), 0);
    const usd = legs.reduce((a, t) => a + ((Number(t.optionPnlPct) || 0) / 100) * (Number(t.fill?.entry) > 0 ? Number(t.fill.entry) : Number(t.contract?.mid) || 0) * 100 * (Number(t.contract?.qty) || 1), 0);
    const open = legs.some((t) => !t.exitDate);
    rows.push({ id, symbol: c.symbol, reportDate: s.reportDate || null, session: s.session || null, sellOn: s.sellOn || null, entryDate: c.entryDate,
      exitDate: open ? null : legs.map((t) => t.exitDate).sort().pop(), open, legs: legs.length, strike: c.contract?.strike ?? null, expiry: c.contract?.expiry ?? null,
      qty: Number(c.contract?.qty) || 1, expectedPct: s.expectedPct ?? null, impliedPct: s.impliedPct ?? null, ratio: s.ratio ?? null,
      costUsd: Math.round(cost), usd: Math.round(usd), pct: cost > 0 ? r1((usd / cost) * 100) : null,
      moveAtExitPct: !open && Number(c.entrySpot) > 0 && Number(c.exitSpot) > 0 ? r1((Number(c.exitSpot) / Number(c.entrySpot) - 1) * 100) : null });
  }
  rows.sort((a, b) => (a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : 0));
  const closed = rows.filter((r) => !r.open);
  const sum = closed.reduce((a, r) => a + r.usd, 0), cost = closed.reduce((a, r) => a + r.costUsd, 0);
  return {
    open: rows.filter((r) => r.open).length, closed: closed.length, wins: closed.filter((r) => r.usd > 0).length,
    usd: Math.round(sum), pct: cost > 0 ? r1((sum / cost) * 100) : null, avgPct: closed.length ? r1(closed.reduce((a, r) => a + (r.pct || 0), 0) / closed.length) : null,
    rows: rows.slice(0, kept),
  };
}
