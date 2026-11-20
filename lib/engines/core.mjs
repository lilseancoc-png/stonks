// Strategy engines: the core engines (2026-11-17; the multi-asset rotation,
// a live paper test, since 2026-11-20). The owner's "beat the
// S&P" plan puts most of the money in a long-only stock core that follows
// trend and momentum, and a smaller options sleeve (the signal engines). The
// rules are the ones that beat holding the S&P 500 in the 1972-2026 and
// 2006-2026 research (engines/beat-sp500-2026-11-17 in the project files):
//
//   Trend follower ("dual momentum" with a T-bill fallback). At each monthly
//   check, compare SPY's and QQQ's return over the last 12 months (month-end
//   closes). Hold the stronger one if it beat T-bills. Otherwise hold TLT if
//   TLT beat T-bills, else hold nothing (cash in T-bills).
//
//   Momentum basket. At each monthly check, rank the covered stocks by their
//   rise from 12 months ago to 1 month ago ("12-1" momentum, which skips the
//   latest month's short-term reversal) and own the ten strongest, equal
//   weight. While SPY closed the month under its 10-month average, own TLT
//   with the whole basket's money instead (or nothing when TLT also trails
//   T-bills).
//
// "Standing" like the Fundamentals rank: the targets are fixed from one
// month-end to the next, so a day's quote cannot reshuffle the book. A holding
// closes as "rotate" only when a monthly check drops it. No stops, no
// targets, no learning, shares only, long only.
//
// The T-bill return is the average fed funds rate over the 12 months
// (ctx.macro.cash12), close to what 3-month bills paid.
//
// Pure. No network, no AI. Nothing here reads a Top Picks grade.

import { ENGINES } from "./config.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const pctTxt = (x) => (fin(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "n/a");

export const CORE = Object.freeze({
  safe: "TLT",          // the Treasuries fund
  indexes: Object.freeze(["SPY", "QQQ"]),
  minRanked: 20,        // the basket needs at least this many ranked stocks
  rankedShown: 20,      // ranked rows kept for the page
  logKept: 24,          // monthly checks kept on the engine's state
});

// 12-month return from month-end closes (13 of them), or null.
export function ret12(mo) {
  if (!Array.isArray(mo) || mo.length < 13) return null;
  const a = mo[mo.length - 13].c, b = mo[mo.length - 1].c;
  return a > 0 && b > 0 ? b / a - 1 : null;
}
// From 12 months ago to 1 month ago (the latest month left out).
export function ret12skip1(mo) {
  if (!Array.isArray(mo) || mo.length < 13) return null;
  const a = mo[mo.length - 13].c, b = mo[mo.length - 2].c;
  return a > 0 && b > 0 ? b / a - 1 : null;
}
// The average of the last 10 month-end closes.
export function avg10(mo) {
  if (!Array.isArray(mo) || mo.length < 10) return null;
  const xs = mo.slice(-10).map((x) => x.c);
  return xs.every((x) => x > 0) ? xs.reduce((a, b) => a + b, 0) / 10 : null;
}
// The month every read is for: the latest month SPY has closed.
function monthOf(views) {
  const mo = views?.SPY?.mo;
  return Array.isArray(mo) && mo.length ? mo[mo.length - 1] : null;
}
// A view's month-end series, only when it is current with SPY's month.
function moOf(views, sym, month) {
  const mo = views?.[sym]?.mo;
  return Array.isArray(mo) && mo.length && mo[mo.length - 1].m === month ? mo : null;
}

// Treasuries while they beat T-bills, else nothing (T-bills).
function safeRead(views, month, cash) {
  const tlt = ret12(moOf(views, CORE.safe, month));
  return { tlt, hold: fin(tlt) && tlt * 100 > cash ? CORE.safe : null };
}

// The trend follower's read for the latest closed month, or null when a
// number it needs is missing (the engine then keeps its stored target).
export function trendRead(views, ctx) {
  const me = monthOf(views), cash = ctx?.macro?.cash12;
  if (!me || !fin(cash)) return null;
  const spy = ret12(moOf(views, "SPY", me.m)), qqq = ret12(moOf(views, "QQQ", me.m));
  if (!fin(spy) || !fin(qqq)) return null;
  const best = qqq > spy ? "QQQ" : "SPY", bestRet = best === "QQQ" ? qqq : spy;
  const safe = safeRead(views, me.m, cash);
  let hold = null, setup = null, why;
  if (bestRet * 100 > cash) { hold = best; setup = "index"; why = `${best} rose ${pctTxt(bestRet)} over 12 months, more than ${best === "QQQ" ? "SPY" : "QQQ"} (${pctTxt(best === "QQQ" ? spy : qqq)}) and more than T-bills (${r1(cash)}%)`; }
  else if (safe.hold) { hold = safe.hold; setup = "bonds"; why = `Neither index fund beat T-bills (${r1(cash)}%) over 12 months (SPY ${pctTxt(spy)}, QQQ ${pctTxt(qqq)}); TLT did (${pctTxt(safe.tlt)})`; }
  else why = `Neither index fund nor TLT beat T-bills (${r1(cash)}%) over 12 months (SPY ${pctTxt(spy)}, QQQ ${pctTxt(qqq)}, TLT ${pctTxt(safe.tlt)}): holding T-bills (cash)`;
  return {
    engine: "trend", month: me.m, asOf: me.d, hold: hold ? [hold] : [], setups: hold ? { [hold]: setup } : {}, why,
    reads: { SPY: r1(spy * 100), QQQ: r1(qqq * 100), TLT: r1(fin(safe.tlt) ? safe.tlt * 100 : null), cash: r2(cash) },
  };
}

// The momentum basket's read for the latest closed month, or null.
export function momentumRead(views, ctx, { top = ENGINES.momentum?.top || 10 } = {}) {
  const me = monthOf(views), cash = ctx?.macro?.cash12;
  if (!me || !fin(cash)) return null;
  const spyMo = moOf(views, "SPY", me.m), a10 = avg10(spyMo);
  if (!spyMo || !fin(a10)) return null;
  const spyC = spyMo[spyMo.length - 1].c, above = spyC >= a10;
  const ranked = [];
  for (const [sym, v] of Object.entries(views || {})) {
    if (!v || v.isEtf) continue;
    const m = ret12skip1(moOf(views, sym, me.m));
    if (fin(m)) ranked.push({ symbol: sym, mom: m });
  }
  if (ranked.length < CORE.minRanked) return null;
  ranked.sort((a, b) => b.mom - a.mom || (a.symbol < b.symbol ? -1 : 1));
  ranked.forEach((r, i) => { r.rank = i + 1; });
  const safe = safeRead(views, me.m, cash);
  let hold, setups = {}, why;
  if (above) {
    hold = ranked.slice(0, top).map((r) => r.symbol);
    for (const s of hold) setups[s] = "top-10";
    why = `SPY closed the month ${pctTxt(spyC / a10 - 1)} above its 10-month average: holding the ${top} strongest of ${ranked.length} ranked stocks`;
  } else if (safe.hold) {
    hold = [safe.hold]; setups = { [safe.hold]: "safe" };
    why = `SPY closed the month ${pctTxt(spyC / a10 - 1)} under its 10-month average: the basket's money goes to TLT, which beat T-bills over 12 months (${pctTxt(safe.tlt)} against ${r1(cash)}%)`;
  } else {
    hold = [];
    why = `SPY closed the month ${pctTxt(spyC / a10 - 1)} under its 10-month average and TLT trailed T-bills (${pctTxt(safe.tlt)} against ${r1(cash)}%): holding T-bills (cash)`;
  }
  return {
    engine: "momentum", month: me.m, asOf: me.d, hold, setups, why, top,
    reads: { spy: r2(spyC), spyAvg10: r2(a10), spyAbove: above, TLT: r1(fin(safe.tlt) ? safe.tlt * 100 : null), cash: r2(cash), ranked: ranked.length },
    ranked: ranked.slice(0, CORE.rankedShown).map((r) => ({ symbol: r.symbol, rank: r.rank, mom: r1(r.mom * 100) })),
  };
}

// Return over the last k months from month-end closes (k+1 of them), or null.
export function retK(mo, k) {
  if (!Array.isArray(mo) || mo.length < k + 1) return null;
  const a = mo[mo.length - 1 - k].c, b = mo[mo.length - 1].c;
  return a > 0 && b > 0 ? b / a - 1 : null;
}

// The multi-asset rotation's read (2026-11-20, a live paper test): every fund
// on its list scored by the average of its 3, 6 and 12-month returns; the
// `top` strongest that are above their 10-month average and beat T-bills over
// 12 months are held, equal weight. A fund that fails either check leaves its
// place in T-bills (cash). A fund with no current month-end history is left
// out (and named). Null when SPY's month or the T-bill rate is missing.
export function rotationRead(views, ctx, { funds = ENGINES.rotation?.funds || [], top = ENGINES.rotation?.top || 3 } = {}) {
  const me = monthOf(views), cash = ctx?.macro?.cash12;
  if (!me || !fin(cash)) return null;
  const rows = [], missing = [];
  for (const sym of funds) {
    const mo = moOf(views, sym, me.m);
    const r3 = retK(mo, 3), r6 = retK(mo, 6), r12 = retK(mo, 12), a10 = avg10(mo);
    if (!fin(r3) || !fin(r6) || !fin(r12) || !fin(a10)) { missing.push(sym); continue; }
    const c = mo[mo.length - 1].c;
    rows.push({ symbol: sym, score: (r3 + r6 + r12) / 3, r3, r6, r12, above: c >= a10, beatCash: r12 * 100 > cash });
  }
  if (rows.length < Math.min(funds.length, top + 3)) return null;
  rows.sort((a, b) => b.score - a.score || (a.symbol < b.symbol ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  const picks = rows.slice(0, top), hold = picks.filter((r) => r.above && r.beatCash).map((r) => r.symbol);
  const setups = Object.fromEntries(hold.map((s) => [s, "top-3"]));
  const failed = picks.filter((r) => !hold.includes(r.symbol)).map((r) => `${r.symbol} (${!r.above ? "under its 10-month average" : `12 months ${pctTxt(r.r12)}, not ahead of T-bills`})`);
  const why = hold.length
    ? `The ${top} strongest of ${rows.length} funds by average 3, 6 and 12-month rise: ${picks.map((r) => `${r.symbol} ${pctTxt(r.score)}`).join(", ")}. Holding ${hold.join(", ")}${failed.length ? `; ${failed.join(" and ")} left in T-bills` : ""}`
    : `None of the ${top} strongest funds (${picks.map((r) => r.symbol).join(", ")}) passed both checks: holding T-bills (cash)`;
  return {
    engine: "rotation", month: me.m, asOf: me.d, hold, setups, why, top,
    reads: { cash: r2(cash), ranked: rows.length, ...(missing.length ? { missing } : {}) },
    ranked: rows.map((r) => ({ symbol: r.symbol, rank: r.rank, mom: r1(r.score * 100), r3: r1(r.r3 * 100), r6: r1(r.r6 * 100), r12: r1(r.r12 * 100), above: r.above, beatCash: r.beatCash })),
  };
}

// Bring a core engine's standing target up to date. A new read replaces the
// stored one only when it is for a later month; a read that cannot be made
// (a number missing this run) keeps the stored target. Returns the target.
export function standCore(es, id, views, ctx, { today } = {}) {
  let read = null;
  try {
    read = id === "trend" ? trendRead(views, ctx) : id === "momentum" ? momentumRead(views, ctx, { top: ENGINES[id].top })
      : id === "rotation" ? rotationRead(views, ctx, { funds: ENGINES[id].funds, top: ENGINES[id].top }) : null;
  } catch { read = null; }
  const later = read && (!es.core || String(es.core.month) < read.month);
  // A read that had funds missing (no current history this run, the
  // rotation) is replaced in the same month by a later run that sees more of
  // them, so one failed fetch on the first run of a month does not fix the
  // whole month's target. The month's log line is rewritten, not repeated.
  const fuller = read && !later && es.core && String(es.core.month) === read.month
    && (es.core.reads?.missing || []).length > (read.reads?.missing || []).length;
  if (later || fuller) {
    const rest = fuller ? (es.coreLog || []).slice(1) : (es.coreLog || []);
    const prev = fuller ? (rest[0]?.hold || []) : (es.core?.hold || []);
    es.core = { ...read, since: fuller ? es.core.since : today || null };
    es.coreLog = [{ month: read.month, asOf: read.asOf, since: es.core.since, hold: read.hold, in: read.hold.filter((s) => !prev.includes(s)), out: prev.filter((s) => !read.hold.includes(s)), why: read.why }, ...rest].slice(0, CORE.logKept);
  }
  return es.core || null;
}

// Candidates: every target holding the engine does not hold yet. The book's
// usual rules then apply (one trade per name, slots, the signal used once).
export function evalCore(id, views, es) {
  const tgt = es?.core;
  if (!tgt || !Array.isArray(tgt.hold)) return [];
  const spec = ENGINES[id], out = [];
  const lot = tgt.hold.length === 1 && tgt.setups?.[tgt.hold[0]] === "safe" ? spec.lotUsd * (spec.top || 1) : spec.lotUsd;
  tgt.hold.forEach((sym, k) => {
    const v = views?.[sym];
    if (!v || !(v.spot > 0)) return;
    const setup = tgt.setups?.[sym] || Object.keys(spec.setups)[0];
    const r = (tgt.ranked || []).find((x) => x.symbol === sym);
    const basis = id === "rotation" ? "average 3, 6 and 12-month rise" : "12-1 momentum";
    const reasons = [tgt.why, r ? `Ranked ${r.rank} of ${tgt.reads?.ranked ?? "?"} on ${basis} (${r.mom >= 0 ? "+" : ""}${r.mom}%)` : null].filter(Boolean);
    out.push({
      engine: id, symbol: sym, side: "call", setup, score: 100 - k, reasons,
      facts: { month: tgt.month, asOf: tgt.asOf, ...(r ? { rank: r.rank, mom: r.mom } : {}), reads: tgt.reads },
      signalKey: `${sym}|${id}|${tgt.asOf}`, signalDate: tgt.asOf, lotUsd: lot,
    });
  });
  return out;
}

// Put each covered name's place on its view for the thesis check: true =
// in the engine's current target, false = not. Left unset when the engine
// has no target yet (a holding is then kept).
export function markCoreViews(views, id, es) {
  const hold = es?.core?.hold;
  if (!Array.isArray(hold)) return;
  for (const [sym, v] of Object.entries(views || {})) if (v) (v.core ||= {})[id] = hold.includes(sym);
}

// The page's read of a core engine.
export function coreView(es, open = []) {
  const t = es?.core || null;
  return t ? {
    month: t.month, asOf: t.asOf, since: t.since || null, hold: t.hold, setups: t.setups || {}, why: t.why, reads: t.reads || null, ranked: t.ranked || null,
    held: open.map((x) => x.symbol), log: (es.coreLog || []).slice(0, 12),
  } : { month: null, hold: [], held: open.map((x) => x.symbol), log: [] };
}
