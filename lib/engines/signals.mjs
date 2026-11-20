// Strategy engines: the six rule sets. Each evaluator reads a "view" of one
// name (confirmed daily features, today's price, and whatever extra data that
// engine owns) plus the run's market context, and returns candidate trades:
//   { engine, symbol, side, setup, score (0-100), reasons[], facts{},
//     stopLevel?, targetLevel?, exitBy?, signalKey }
// The same functions run in the live bake and in the history test.
//
// None of this is the flagship's four-pillar grade: no engine reads a Top
// Picks score, and each engine reads only its own kind of evidence.
//
// Pure. No network, no AI.

import { trendUp, trendDown } from "./features.mjs";
import { RANK, RANK_SETUPS, isRankSetup } from "./rank.mjs";
import { BOOK } from "./config.mjs";

const CRASH_DROP = BOOK.crashDrop, FEAR_BELOW = BOOK.fearBelow, FEAR_MAX_AGE = BOOK.fearMaxAgeDays;

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const pct = (x) => (fin(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "n/a");

// Today's move so far, in ATRs, measured from the last confirmed close.
const nowAtr = (view) => (view.f && view.spot > 0 ? (view.spot - view.f.c) / view.f.atr : 0);
// An entry is skipped when today already ran 1.5 ATR its way (chasing) or
// 0.9 ATR against it (the setup is failing as we look at it).
// Every caller checks this last, after the setup's own conditions, so a
// "no" here means the setup was there and only today's move ruled it out.
// Those are collected while withSkips() runs, so the page can list them
// ("price already ran") instead of showing nothing.
let SKIPS = null;
export function withSkips(fn) {
  const prev = SKIPS; SKIPS = [];
  try { const out = fn(); return { out, skips: SKIPS }; } finally { SKIPS = prev; }
}
function entryOk(view, side, { chase = 1.5, against = 0.9, setup = null } = {}) {
  const m = nowAtr(view) * (side === "call" ? 1 : -1);
  const ok = m <= chase && m >= -against;
  if (!ok && SKIPS) SKIPS.push({ symbol: view.sym, side, setup, moveAtr: r1(Math.abs(nowAtr(view))), ran: m > chase });
  return ok;
}
function cand(engine, view, side, setup, score, reasons, facts = {}, extra = {}) {
  return {
    engine, symbol: view.sym, side, setup, score: Math.round(clamp(score, 0, 100)),
    reasons: reasons.filter(Boolean), facts,
    signalKey: `${view.sym}|${setup}|${extra.signalDate || view.f?.date || ""}`,
    ...extra,
  };
}
// The best candidate per symbol; two sides on one symbol cancel. A retired
// setup (ctx.retired, the book's list for the engine being read) is dropped
// first, so it neither cancels nor adds to another setup on the same name.
// A retired side ("squeeze|put", 2026-11-19) is dropped the same way.
export const isRetiredCand = (c, ctx) => !!(ctx?.retired?.has(c.setup) || ctx?.retired?.has(`${c.setup}|${c.side}`));
function bestPerSymbol(list, ctx) {
  const by = new Map();
  for (const c of list) {
    if (isRetiredCand(c, ctx)) continue;
    const cur = by.get(c.symbol);
    if (!cur) { by.set(c.symbol, c); continue; }
    if (cur.side !== c.side) { by.set(c.symbol, { conflict: true, symbol: c.symbol, side: cur.side }); continue; }
    if (cur.conflict) continue;
    const best = c.score > cur.score ? c : cur, other = best === c ? cur : c;
    by.set(c.symbol, { ...best, score: Math.min(100, best.score + 3), reasons: [...best.reasons, `Also: ${other.setup.replace(/-/g, " ")}`] });
  }
  return [...by.values()].filter((c) => !c.conflict);
}
const marketAgree = (ctx, side, yes = 5, no = -7) => {
  const s = ctx.spy; if (!s || s.sma50 == null) return 0;
  return (side === "call") === (s.c > s.sma50) ? yes : no;
};
const stressAdj = (ctx, calm = 0, stressed = -4, crisis = -10) => (ctx.regime?.era === "crisis" ? crisis : ctx.regime?.stressed || /stressed/.test(ctx.regime?.cell || "") ? stressed : calm);

// ---------------------------------------------------------------------------
// TECHNICALS: price and volume only.
// ---------------------------------------------------------------------------
export function evalTechnicals(view, ctx) {
  const f = view.f; if (!f || f.sma200 == null || !(view.spot > 0)) return [];
  const out = [];
  const rs = fin(f.ret63) && fin(ctx.spy?.ret63) ? f.ret63 - ctx.spy.ret63 : null;
  const vr = f.volRatio;
  // Trend pullback.
  if (trendUp(f) && f.ret126 > 0 && fin(f.rsi2Min3) && f.rsi2Min3 <= 20 && f.c > f.pc && f.lo5 <= f.sma20 + 0.5 * f.atr && entryOk(view, "call", { setup: "pullback" })) {
    const score = 50 + Math.min(12, f.ret126 * 30) + (f.rsi2Min3 <= 10 ? 6 : 0) + (f.sma20 > f.sma50 ? 4 : 0) + (vr >= 1.2 ? 4 : 0) + (rs > 0 ? 5 : 0) + (f.rangePos >= 0.6 ? 3 : 0) + marketAgree(ctx, "call");
    out.push(cand("technicals", view, "call", "pullback", score, [
      `Uptrend: price over the 50-day over the 200-day, ${pct(f.ret126)} in six months`,
      `2-day RSI fell to ${r1(f.rsi2Min3)} near the 20-day, then closed up`,
      rs > 0 ? `Stronger than SPY over three months (${pct(rs)})` : null,
    ], { ret126: r2(f.ret126), rsi2: r1(f.rsi2Min3), volRatio: r2(vr), rs63: r2(rs) }, { stopLevel: r2(f.lo5 - 0.25 * f.atr) }));
  }
  if (trendDown(f) && f.ret126 < 0 && fin(f.rsi2Max3) && f.rsi2Max3 >= 80 && f.c < f.pc && f.hi5 >= f.sma20 - 0.5 * f.atr && entryOk(view, "put", { setup: "rally-fade" })) {
    const score = 50 + Math.min(12, -f.ret126 * 30) + (f.rsi2Max3 >= 90 ? 6 : 0) + (f.sma20 < f.sma50 ? 4 : 0) + (vr >= 1.2 ? 4 : 0) + (rs < 0 ? 5 : 0) + (f.rangePos <= 0.4 ? 3 : 0) + marketAgree(ctx, "put");
    out.push(cand("technicals", view, "put", "rally-fade", score, [
      `Downtrend: price under the 50-day under the 200-day, ${pct(f.ret126)} in six months`,
      `2-day RSI rose to ${r1(f.rsi2Max3)} near the 20-day, then closed down`,
      rs < 0 ? `Weaker than SPY over three months (${pct(rs)})` : null,
    ], { ret126: r2(f.ret126), rsi2: r1(f.rsi2Max3), volRatio: r2(vr), rs63: r2(rs) }, { stopLevel: r2(f.hi5 + 0.25 * f.atr) }));
  }
  // Range breakout.
  if (fin(f.hi55p) && f.c > f.hi55p && f.dayAtr >= 0.8 && vr >= 1.4 && f.c > f.sma200 && entryOk(view, "call", { chase: 1.2, against: 0.6, setup: "breakout" })) {
    const score = 52 + Math.min(10, (vr - 1.4) * 8) + (f.bbwRankPrev != null && f.bbwRankPrev <= 0.3 ? 8 : f.bbwRankPrev != null && f.bbwRankPrev <= 0.5 ? 4 : 0) + (f.distHi252 >= -0.02 ? 5 : 0) + (rs > 0 ? 4 : 0) + (f.rangePos >= 0.7 ? 3 : 0) + marketAgree(ctx, "call");
    out.push(cand("technicals", view, "call", "breakout", score, [
      `Closed above its prior 55-day high (${r2(f.hi55p)}) on ${r1(vr)}x volume`,
      f.bbwRankPrev != null && f.bbwRankPrev <= 0.3 ? "Broke out of a tight range" : null,
      f.distHi252 >= -0.02 ? "At a 52-week high" : null,
    ], { level: r2(f.hi55p), volRatio: r2(vr), dayAtr: r2(f.dayAtr) }, { stopLevel: r2(f.hi55p - f.atr) }));
  }
  if (fin(f.lo55p) && f.c < f.lo55p && f.dayAtr <= -0.8 && vr >= 1.4 && f.c < f.sma200 && entryOk(view, "put", { chase: 1.2, against: 0.6, setup: "breakdown" })) {
    const score = 52 + Math.min(10, (vr - 1.4) * 8) + (f.bbwRankPrev != null && f.bbwRankPrev <= 0.3 ? 8 : f.bbwRankPrev != null && f.bbwRankPrev <= 0.5 ? 4 : 0) + (f.lo252 && f.c <= f.lo252 * 1.02 ? 5 : 0) + (rs < 0 ? 4 : 0) + (f.rangePos <= 0.3 ? 3 : 0) + marketAgree(ctx, "put");
    out.push(cand("technicals", view, "put", "breakdown", score, [
      `Closed below its prior 55-day low (${r2(f.lo55p)}) on ${r1(vr)}x volume`,
      f.bbwRankPrev != null && f.bbwRankPrev <= 0.3 ? "Broke down out of a tight range" : null,
    ], { level: r2(f.lo55p), volRatio: r2(vr), dayAtr: r2(f.dayAtr) }, { stopLevel: r2(f.lo55p + f.atr) }));
  }
  // Squeeze break.
  if (f.bbwRankPrev != null && f.bbwRankPrev <= 0.15 && fin(f.z20) && Math.abs(f.z20) >= 2 && vr >= 1.2) {
    const side = f.z20 > 0 ? "call" : "put";
    if (((side === "call" && f.c > f.sma200) || (side === "put" && f.c < f.sma200)) && entryOk(view, side, { chase: 1.2, against: 0.6, setup: "squeeze" })) {
      const score = 52 + Math.min(8, (0.15 - f.bbwRankPrev) * 60) + Math.min(6, (Math.abs(f.z20) - 2) * 6) + Math.min(6, (vr - 1.2) * 6) + marketAgree(ctx, side);
      out.push(cand("technicals", view, side, "squeeze", score, [
        `Bollinger width was in the tightest ${Math.round(f.bbwRankPrev * 100)}% of six months`,
        `Closed ${r1(Math.abs(f.z20))} standard deviations ${side === "call" ? "above" : "below"} its 20-day on ${r1(vr)}x volume`,
      ], { bbwRank: r2(f.bbwRankPrev), z20: r2(f.z20), volRatio: r2(vr) }, { stopLevel: r2(f.sma20) }));
    }
  }
  return bestPerSymbol(out, ctx);
}

// ---------------------------------------------------------------------------
// REVERSION: against stretched moves.
// ---------------------------------------------------------------------------
export function evalReversion(view, ctx) {
  const f = view.f; if (!f || f.sma200 == null || !(view.spot > 0) || !fin(f.z20) || !fin(f.rsi2)) return [];
  // Stand aside around the company's own report: a gap there is news, not noise.
  const e = view.earn;
  // Stand aside around a report: two sessions before it, the session the
  // stock reacts (`reacting`: an after-the-close report from the last finished
  // session, whose reaction bar is still forming), and until the reaction bar
  // is more than one confirmed session old (`last.sessionsSince <= 1`).
  if (e && (e.reacting || (e.next && e.next.sessionsUntil != null && e.next.sessionsUntil <= 2) || (e.last && e.last.sessionsSince != null && e.last.sessionsSince <= 1))) return [];
  const out = [], test = [];
  const now = nowAtr(view);
  const setups = ctx?.setups || {};
  // Crash stand-aside (2026-11-19): a one-day drop of 7%+ in the prior five
  // sessions (bars through the last confirmed close; the entry day is not
  // counted) is a crash, not a washout.
  const crash = fin(f.worst5) && f.worst5 <= CRASH_DROP;
  const crashWhy = crash ? `stood aside: fell ${r1(-f.worst5 * 100)}% in one day in the prior five sessions (crash rule)` : null;
  if (f.c > f.sma200 && f.rsi2 <= 8 && f.z20 <= -1.8 && f.move5Atr <= -2 && now >= -1) {
    const score = 50 + Math.min(12, (-f.z20 - 1.8) * 10) + (f.rsi2 <= 3 ? 5 : 0) + (f.downStreak >= 4 ? 4 : 0) + (f.rangePos >= 0.5 ? 5 : 0) + (f.ret126 > 0 ? 5 : 0) + (now > 0 ? 4 : 0) + stressAdj(ctx, 3, -5, -12);
    const reasons = [
      `Still above its 200-day, but 2-day RSI is ${r1(f.rsi2)} after a ${r1(-f.move5Atr)} ATR drop in five sessions`,
      `${r1(-f.z20)} standard deviations under its 20-day`,
      now > 0 ? "Bouncing today" : null,
    ];
    const facts = { rsi2: r1(f.rsi2), z20: r2(f.z20), move5Atr: r2(f.move5Atr), worst5Pct: fin(f.worst5) ? r1(f.worst5 * 100) : null, ...newsTag(view) };
    const levels = { targetLevel: r2(f.sma20), stopLevel: r2(f.c - 2 * f.atr) };
    if (crash && setups["oversold-bounce"]?.crashStand) skipNote(view, "call", "oversold-bounce", crashWhy);
    else out.push(cand("reversion", view, "call", "oversold-bounce", score, reasons, facts, levels));
    // The extreme-fear bounce test: the same washout, only while the market's
    // fear and greed reading is under 25. It stays out of bestPerSymbol (its
    // own record, never merged into the washout bounce's score).
    const fb = setups["fear-bounce"];
    if (fb && !fb.retired && !ctx?.retired?.has("fear-bounce")) {
      const fg = fearRead(ctx);
      if (fg.ok && fg.score < FEAR_BELOW) {
        if (crash && fb.crashStand !== false) skipNote(view, "call", "fear-bounce", crashWhy);
        else test.push(cand("reversion", view, "call", "fear-bounce", score, [...reasons, `Fear and greed ${r1(fg.score)} (${fg.source}, under ${FEAR_BELOW}: extreme fear)`],
          { ...facts, fearGreed: r1(fg.score), fearSource: fg.source, fearAsOf: fg.asOf }, levels));
      }
    }
  }
  if (f.c < f.sma200 && f.rsi2 >= 92 && f.z20 >= 1.8 && f.move5Atr >= 2 && now <= 1) {
    const score = 50 + Math.min(12, (f.z20 - 1.8) * 10) + (f.rsi2 >= 97 ? 5 : 0) + (f.upStreak >= 4 ? 4 : 0) + (f.rangePos <= 0.5 ? 5 : 0) + (f.ret126 < 0 ? 5 : 0) + (now < 0 ? 4 : 0) + stressAdj(ctx, 0, 3, 3);
    out.push(cand("reversion", view, "put", "overbought-fade", score, [
      `Still under its 200-day, but 2-day RSI is ${r1(f.rsi2)} after a ${r1(f.move5Atr)} ATR rise in five sessions`,
      `${r1(f.z20)} standard deviations over its 20-day`,
      now < 0 ? "Fading today" : null,
    ], { rsi2: r1(f.rsi2), z20: r2(f.z20), move5Atr: r2(f.move5Atr) }, { targetLevel: r2(f.sma20), stopLevel: r2(f.c + 2 * f.atr) }));
  }
  if (fin(f.move3Atr) && f.move3Atr <= -3 && f.volRatio >= 2 && f.rangePos >= 0.6 && f.hi252 && f.c >= 0.6 * f.hi252 && now >= -0.75) {
    const score = 54 + Math.min(10, (-f.move3Atr - 3) * 4) + (f.volRatio >= 3 ? 5 : 0) + (f.c > f.sma200 ? 6 : 0) + (now > 0 ? 3 : 0) + stressAdj(ctx, 2, -4, -10);
    out.push(cand("reversion", view, "call", "capitulation", score, [
      `Fell ${r1(-f.move3Atr)} ATR in three sessions, ending on ${r1(f.volRatio)}x volume`,
      `Closed in the top ${Math.round((1 - f.rangePos) * 100)}% of the day's range`,
    ], { move3Atr: r2(f.move3Atr), volRatio: r2(f.volRatio), rangePos: r2(f.rangePos), ...newsTag(view) }, { targetLevel: r2(f.sma10 ?? f.c + 2 * f.atr), stopLevel: r2(f.l - 0.5 * f.atr) }));
  }
  // Paper trial (2026-11-19): the RSI(2) dip in an uptrend, shares only.
  // Deeper dips score higher (2-day RSI under 2 scored 70, at 5 scored 60).
  // Kept out of bestPerSymbol: a trial never replaces the engine's own setup
  // on a name (the book also gives it its own slots).
  const trial = [];
  if (fin(f.sma5) && f.c > f.sma200 && f.rsi2 < 5 && !ctx?.retired?.has("rsi2-dip")) {
    trial.push(cand("reversion", view, "call", "rsi2-dip", 60 + Math.min(10, (5 - f.rsi2) * 3.4), [
      `Above its 200-day with a 2-day RSI of ${r1(f.rsi2)}`,
      "Paper trial: sells on a close back above the 5-day average",
    ], { rsi2: r1(f.rsi2), sma5: r2(f.sma5), ...newsTag(view) }));
  }
  return [...bestPerSymbol(out, ctx), ...test, ...trial];
}

// News tag on Reversion's bounce entries (2026-11-20, log only: it changes
// no score, size or gate). Was there a reason for the drop? `news` holds
// what the bake's policy and news read had for the name: Federal Register
// documents tagged to it in the last three days (frn), GDELT news volume in
// the last 24 hours against the six days before (nvr) and the tone change on
// a spike (ntn). `spike` is volume at 2x or more. Absent when the read had
// nothing for the name (not read, or stale), so "no tag" is not "no news".
function newsTag(view) {
  const n = view.live?.news;
  if (!n) return {};
  return { news: { frn: fin(n.frn) ? n.frn : null, nvr: fin(n.nvr) ? r2(n.nvr) : null, ntn: fin(n.ntn) ? r2(n.ntn) : null, spike: fin(n.nvr) ? n.nvr >= 2 : null } };
}

// The market's fear and greed reading for the extreme-fear test: ctx.fearGreed
// { score, asOf, source, stale } (live: CNN's, from the bake's fear-greed
// snapshot; the history test: a dated series passed by hand). A stale or
// old reading (more than BOOK.fearMaxAgeDays calendar days before the
// decision) does not count: no reading, no test trade.
export function fearRead(ctx) {
  const g = ctx?.fearGreed;
  if (!g || !fin(g.score)) return { ok: false, why: "no fear and greed reading" };
  if (g.stale) return { ok: false, why: "fear and greed reading is stale" };
  const asOf = String(g.asOf || "").slice(0, 10), today = String(ctx.date || "").slice(0, 10);
  if (asOf && today) {
    const age = (Date.parse(today + "T12:00:00Z") - Date.parse(asOf + "T12:00:00Z")) / 86400000;
    if (!(age >= -1) || age > FEAR_MAX_AGE) return { ok: false, why: `fear and greed reading is from ${asOf}` };
  }
  return { ok: true, score: g.score, asOf: asOf || null, source: g.source || "CNN" };
}
// A setup that matched but a stand-aside rule kept out (shown, never traded).
function skipNote(view, side, setup, why) { if (SKIPS) SKIPS.push({ symbol: view.sym, side, setup, why }); }

// ---------------------------------------------------------------------------
// MACRO: funds only. One call per run (not per name).
// ctx.macro: factor row (lib/engines/macro.mjs), ctx.macroEvent: the event
// kind on the last confirmed session ("fomc", "cpi", "jobs") or null.
// ---------------------------------------------------------------------------
// Paper trial (2026-11-19): the day after Fear & Greed first closes under
// 25 (ctx.fear: the last two confirmed closes), SPY, QQQ and IWM shares.
// Deeper fear scores higher. Kept out of bestPerSymbol, and read before the
// other Macro rules so it does not depend on the FRED inputs.
function fearIndexTrial(ctx) {
  const fr = ctx.fear;
  if (!fr || !fin(fr.score) || !fin(fr.prev) || !(fr.score < 25 && fr.prev >= 25) || ctx.retired?.has("fear-index")) return [];
  const out = [];
  for (const sym of ["SPY", "QQQ", "IWM"]) {
    const v = ctx.byId?.[sym];
    if (!v || !v.f || !(v.spot > 0)) continue;
    out.push(cand("macro", v, "call", "fear-index", 60 + Math.min(10, (25 - fr.score) * 0.5), [
      `Fear & Greed closed at ${r1(fr.score)} on ${fr.date}, under 25 from ${r1(fr.prev)}`,
      "Paper trial: holds the fund 20 sessions",
    ], { fear: r1(fr.score), fearPrev: r1(fr.prev) }, { signalDate: fr.date }));
  }
  return out;
}

export function evalMacro(ctx) {
  const trial = fearIndexTrial(ctx);
  const m = ctx.macro; if (!m) return trial;
  const V = (s) => { const v = ctx.byId?.[s]; return v && v.f && v.spot > 0 ? v : null; };
  const spy = V("SPY"); if (!spy) return trial;
  const idx = ["SPY", "QQQ", "IWM"].map(V).filter(Boolean);
  const by21 = idx.slice().sort((a, b) => (a.f.ret21 ?? 0) - (b.f.ret21 ?? 0));
  const out = [];
  const add = (view, side, setup, score, reasons, facts) => { if (view && entryOk(view, side, { setup })) out.push(cand("macro", view, side, setup, score, reasons, facts)); };
  const s = spy.f;
  if (fin(m.nfciChg) && m.nfciChg >= 0.08 && fin(m.vixRatio) && m.vixRatio >= 0.97 && s.c < s.sma50) {
    add(by21[0], "put", "stress-on", 56 + Math.min(12, (m.nfciChg - 0.08) * 100) + (m.vixRatio >= 1 ? 6 : 0) + (s.sma200 && s.c < s.sma200 ? 4 : 0) + (m.y10Chg >= 25 ? 3 : 0), [
      `Financial conditions tightened ${r2(m.nfciChg)} in four weeks`,
      `VIX is ${r2(m.vixRatio)}x 3-month VIX and SPY is under its 50-day`,
    ], { nfciChg: r2(m.nfciChg), vixRatio: r2(m.vixRatio) });
  }
  if (fin(m.nfciChg) && m.nfciChg <= -0.06 && fin(m.nfciMed) && m.nfci > m.nfciMed && fin(m.vixRatio) && m.vixRatio <= 0.92 && s.c > s.sma20 && s.ret5 > 0) {
    add(by21[by21.length - 1], "call", "stress-off", 56 + Math.min(12, (-m.nfciChg - 0.06) * 100) + (s.c > s.sma50 ? 4 : 0) + (m.vix >= 18 ? 4 : 0), [
      `Financial conditions eased ${r2(-m.nfciChg)} in four weeks from a tight level`,
      `VIX curve is normal (${r2(m.vixRatio)}x) and SPY is rising`,
    ], { nfciChg: r2(m.nfciChg), vixRatio: r2(m.vixRatio) });
  }
  const tlt = V("TLT");
  if (tlt && fin(m.y10Chg)) {
    const t = tlt.f;
    if (m.y10Chg <= -25 && t.c > t.sma50 && t.ret21 > 0) add(tlt, "call", "rates-fall", 56 + Math.min(12, (-m.y10Chg - 25) / 3) + (m.dffChg <= -0.25 ? 5 : 0) + (t.sma200 && t.c > t.sma200 ? 4 : 0), [
      `10-year yield fell ${-m.y10Chg}bp in a month`, "TLT is above its 50-day and rising",
    ], { y10Chg: m.y10Chg });
    if (m.y10Chg >= 25 && t.c < t.sma50 && t.ret21 < 0) add(tlt, "put", "rates-rise", 56 + Math.min(12, (m.y10Chg - 25) / 3) + (m.dffChg >= 0.25 ? 5 : 0) + (t.sma200 && t.c < t.sma200 ? 4 : 0), [
      `10-year yield rose ${m.y10Chg}bp in a month`, "TLT is under its 50-day and falling",
    ], { y10Chg: m.y10Chg });
  }
  if (m.vixInverted2 && s.c < s.sma20) add(spy, "put", "vol-inverted", 56 + Math.min(10, (m.vixRatio - 1) * 100) + (s.c < s.sma50 ? 4 : 0) + (m.vix >= 25 ? 3 : 0), [
    `VIX (${r1(m.vix)}) has been above 3-month VIX for two sessions`, "SPY is under its 20-day",
  ], { vixRatio: r2(m.vixRatio), vix: r1(m.vix) });
  // "vol-normal" (SPY calls after the VIX curve un-inverts) was dropped on
  // 2026-11-17: it lost 11.6% a trade over 128 trades in the 1971-2026 test.
  if (ctx.macroEvent) {
    const label = String(ctx.macroEvent).split("+").map((k) => ({ fomc: "Fed decision", cpi: "CPI", jobs: "jobs report" })[k] || k).join(" and ");
    for (const sym of ["QQQ", "TLT"]) {
      const v = V(sym); if (!v || !(Math.abs(v.f.dayAtr) >= 1)) continue;
      const side = v.f.dayAtr > 0 ? "call" : "put";
      const withTrend = (side === "call") === (v.f.c > v.f.sma50);
      add(v, side, "event-drift", 56 + Math.min(10, (Math.abs(v.f.dayAtr) - 1) * 6) + (v.f.volRatio >= 1.2 ? 4 : 0) + (withTrend ? 4 : 0) + (/fomc/.test(ctx.macroEvent) ? 3 : 0), [
        `${sym} moved ${r1(Math.abs(v.f.dayAtr))} ATR ${side === "call" ? "up" : "down"} on the ${label} day`,
        withTrend ? "The move is in the direction of its 50-day trend" : null,
      ], { dayAtr: r2(v.f.dayAtr), event: ctx.macroEvent });
    }
  }
  const gld = V("GLD");
  if (gld && fin(m.y10Chg) && fin(m.usdChgPct)) {
    const g = gld.f;
    if (m.y10Chg <= -15 && m.usdChgPct <= -0.5 && fin(g.hi20p) && g.c > g.hi20p && g.c > g.sma50) add(gld, "call", "gold-rates", 56 + Math.min(8, -m.y10Chg / 5) + Math.min(6, -m.usdChgPct * 3), [
      `Yields (${m.y10Chg}bp) and the dollar (${r1(m.usdChgPct)}%) both fell in a month`, "GLD closed above its prior 20-day high",
    ], { y10Chg: m.y10Chg, usdChgPct: r1(m.usdChgPct) });
    if (m.y10Chg >= 15 && m.usdChgPct >= 0.5 && fin(g.lo20p) && g.c < g.lo20p && g.c < g.sma50) add(gld, "put", "gold-rates", 56 + Math.min(8, m.y10Chg / 5) + Math.min(6, m.usdChgPct * 3), [
      `Yields (+${m.y10Chg}bp) and the dollar (+${r1(m.usdChgPct)}%) both rose in a month`, "GLD closed below its prior 20-day low",
    ], { y10Chg: m.y10Chg, usdChgPct: r1(m.usdChgPct) });
  }
  if (fin(m.usdChgPct) && Math.abs(m.usdChgPct) >= 1.5) {
    const asia = ["EWY", "KWEB"].map(V).filter(Boolean).sort((a, b) => (a.f.ret21 ?? 0) - (b.f.ret21 ?? 0));
    const up = m.usdChgPct > 0, v = up ? asia[0] : asia[asia.length - 1];
    if (v && ((up && v.f.c < v.f.sma50 && v.f.ret21 < 0) || (!up && v.f.c > v.f.sma50 && v.f.ret21 > 0))) {
      add(v, up ? "put" : "call", "dollar-asia", 56 + Math.min(10, (Math.abs(m.usdChgPct) - 1.5) * 5) + (v.f.sma200 && (up ? v.f.c < v.f.sma200 : v.f.c > v.f.sma200) ? 4 : 0), [
        `The dollar ${up ? "rose" : "fell"} ${r1(Math.abs(m.usdChgPct))}% in a month`, `${v.sym} is ${up ? "under" : "over"} its 50-day`,
      ], { usdChgPct: r1(m.usdChgPct) });
    }
  }
  return [...bestPerSymbol(out, ctx), ...trial];
}

// ---------------------------------------------------------------------------
// EARNINGS & EVENTS. view.earn (lib/engines/earn.mjs):
//   last: { date, surprisePct, guidance, gapPct, movePct, low, high, close, volRatio, sessionsSince }
//   next: { date, session, sessionsUntil, exitBy }
//   hist: prior reports, newest first, each { movePct, week1Pct, pre10Pct }
// ---------------------------------------------------------------------------
export function evalEarnings(view, ctx) {
  const f = view.f, e = view.earn; if (!f || !e || !(view.spot > 0)) return [];
  const out = [];
  const L = e.last;
  if (L && L.sessionsSince != null && L.sessionsSince >= 0 && L.sessionsSince <= 2 && fin(L.gapPct) && fin(L.movePct)) {
    const sp = L.surprisePct, g = L.gapPct, mv = L.movePct;
    const dir = g > 0 ? 1 : -1, side = dir > 0 ? "call" : "put";
    const guide = /rais/i.test(L.guidance || "") ? 1 : /(lower|cut|soft)/i.test(L.guidance || "") ? -1 : 0;
    const epsOk = fin(sp) ? sp * dir >= 5 : false;
    const priceOnly = !fin(sp) && Math.abs(g) >= 5;
    const guideLed = guide === dir && Math.abs(g) >= 5 && !(fin(sp) && sp * dir < 0);
    const held = mv * dir >= 2 && (dir > 0 ? f.c >= L.low : f.c <= L.high);
    const ext = L.close > 0 ? (f.c / L.close - 1) * dir : 0;
    if ((epsOk || priceOnly || guideLed) && Math.abs(g) >= 3 && held && ext <= 0.06 && ext >= -0.03 && entryOk(view, side, { setup: "drift" })) {
      // The stock's own record: after a same-way reaction, did the next week follow?
      const same = (e.hist || []).filter((h) => fin(h.movePct) && fin(h.week1Pct) && h.movePct * dir >= 2);
      const followed = same.filter((h) => h.week1Pct * dir > 0).length;
      const own = same.length >= 3 ? followed / same.length : null;
      // A reaction bigger than the move options had priced is a real surprise.
      const beatImplied = fin(L.impliedPct) && L.impliedPct > 0 && Math.abs(mv) > L.impliedPct;
      const score = (priceOnly ? 48 : 52) + (fin(sp) ? Math.min(10, Math.abs(sp) / 3) : 0) + Math.min(8, Math.abs(g))
        + (guide === dir ? 6 : guide === -dir ? -8 : 0) + (own == null ? 0 : own >= 0.6 ? 5 : own <= 0.35 ? -6 : 0)
        + (L.volRatio >= 2 ? 3 : 0) + ((dir > 0) === (f.c > f.sma50) ? 3 : 0) + marketAgree(ctx, side, 3, -4)
        + (beatImplied ? 4 : 0);
      out.push(cand("earnings", view, side, "drift", score, [
        fin(sp) ? `EPS ${sp >= 0 ? "beat" : "missed"} by ${r1(Math.abs(sp))}% on ${L.date}` : `Reported on ${L.date}`,
        `Gapped ${r1(g)}% and closed ${r1(mv)}% on the day, and has held since`,
        guide ? `Guidance ${guide > 0 ? "raised" : "lowered"}` : null,
        beatImplied ? `The move was bigger than the ${r1(L.impliedPct)}% options had priced` : null,
        own != null ? `Its next week followed the reaction ${followed} of ${same.length} past times` : null,
      ], { surprisePct: r1(sp), gapPct: r1(g), movePct: r1(mv), impliedPct: r1(L.impliedPct), sessionsSince: L.sessionsSince, ownFollow: own == null ? null : r2(own) },
      { signalDate: L.date, stopLevel: r2(dir > 0 ? L.low - 0.25 * f.atr : L.high + 0.25 * f.atr) }));
    }
  }
  const N = e.next;
  if (N && N.sessionsUntil != null && N.sessionsUntil >= 4 && N.sessionsUntil <= 9 && N.exitBy && N.source !== "webull-backup") {
    const runs = (e.hist || []).map((h) => h.pre10Pct).filter(fin).slice(0, 8);
    if (runs.length >= 4) {
      const upShare = runs.filter((x) => x > 0).length / runs.length, avg = runs.reduce((a, b) => a + b, 0) / runs.length;
      const rs = fin(f.ret63) && fin(ctx.spy?.ret63) ? f.ret63 - ctx.spy.ret63 : null;
      const band = view.live?.iv?.band || null, veryRich = band === "very-rich";
      // Live data pack (2026-11-20): with `ivShares` the up side buys shares
      // when the options are rich or very rich, so very rich no longer skips it.
      const ivShares = !!ctx?.setups?.["run-in"]?.ivShares, dear = band === "rich" || band === "very-rich";
      if (upShare >= 0.62 && avg >= 1.5 && f.c > f.sma50 && f.ret21 > 0 && (!veryRich || ivShares) && entryOk(view, "call", { setup: "run-in" })) {
        const score = 52 + Math.min(12, (upShare - 0.5) * 40) + Math.min(6, avg) + (trendUp(f) ? 5 : 0) + (rs > 0 ? 3 : 0) + marketAgree(ctx, "call", 3, -5);
        out.push(cand("earnings", view, "call", "run-in", score, [
          `Reports ${N.date}${N.session && N.session !== "TBD" ? ` (${N.session === "AM" ? "before the open" : "after the close"})` : ""}, ${N.sessionsUntil} sessions away`,
          `Rose into ${Math.round(upShare * runs.length)} of its last ${runs.length} reports, ${r1(avg)}% on average over the 10 sessions before`,
          "Closed before the report, never held through it",
          ivShares && dear ? `Options are ${band.replace("-", " ")} against the stock's own history: buys shares instead of a call` : null,
        ], { nextDate: N.date, upShare: r2(upShare), avgRunIn: r1(avg), sessionsUntil: N.sessionsUntil, ivBand: band }, { signalDate: `pre-${N.date}`, exitBy: N.exitBy, ...(ivShares && dear ? { buyShares: true } : {}) }));
      }
      if (upShare <= 0.38 && avg <= -1.5 && f.c < f.sma50 && f.ret21 < 0 && !veryRich && entryOk(view, "put", { setup: "run-in" })) {
        const score = 52 + Math.min(12, (0.5 - upShare) * 40) + Math.min(6, -avg) + (trendDown(f) ? 5 : 0) + (rs < 0 ? 3 : 0) + marketAgree(ctx, "put", 3, -5);
        out.push(cand("earnings", view, "put", "run-in", score, [
          `Reports ${N.date}, ${N.sessionsUntil} sessions away`,
          `Fell into ${Math.round((1 - upShare) * runs.length)} of its last ${runs.length} reports, ${r1(avg)}% on average over the 10 sessions before`,
          "Closed before the report, never held through it",
        ], { nextDate: N.date, upShare: r2(upShare), avgRunIn: r1(avg), sessionsUntil: N.sessionsUntil }, { signalDate: `pre-${N.date}`, exitBy: N.exitBy }));
      }
    }
  }
  return bestPerSymbol(out, ctx);
}

// ---------------------------------------------------------------------------
// FUNDAMENTALS (standing rank, 2026-11-16). The book ranks every covered
// stock once (lib/engines/rank.mjs) and puts the stock's place on the view:
//   view.fund.rank: { rank, n, score, e, q, p, zone, enter, asOf, facts }
// A stock is a candidate only while it is one of the best (calls) or worst
// (puts) names; the price, the chart and option flow cannot open a trade.
// Three things can hold one back: a report inside six sessions (it is ranked
// again right after), a price far on the wrong side of its 200-day, and
// today's move (the shared chasing filter).
// ---------------------------------------------------------------------------
export function evalFundamentals(view) {
  const f = view.f, rk = view.fund?.rank; if (!f || !rk || !rk.enter || !(view.spot > 0) || f.sma200 == null) return [];
  if (view.earn?.reacting) return [];
  const next = view.earn?.next;
  if (next && next.sessionsUntil != null && next.sessionsUntil < 6) return [];
  const side = rk.enter, setup = RANK_SETUPS[side];
  if (side === "call" ? !(f.c > f.sma200 * 0.92) : !(f.c < f.sma200 * 1.05)) return [];
  if (!entryOk(view, side, { setup })) return [];
  // 100 at the very top (calls) or the very bottom (puts) of the rank.
  const fromEnd = side === "call" ? rk.rank - 1 : rk.n - rk.rank;
  const score = 100 - (fromEnd / Math.max(1, rk.n - 1)) * 100;
  const x = rk.facts || {};
  const part = (label, v) => (fin(v) ? `${label} ${Math.round(v)}` : null);
  return [cand("fundamentals", view, side, setup, score, [
    side === "call" ? `Ranked ${rk.rank} of ${rk.n} stocks with full data (funds are not ranked)` : `Ranked ${rk.rank} of ${rk.n} stocks with full data (${rk.n - rk.rank + 1} from the bottom)`,
    [part("Earnings power", rk.e), part("quality", rk.q), part("price", rk.p)].filter(Boolean).join(", ") + " (each 0 to 100 against the other ranked stocks)",
    fin(x.epsYoy) ? `EPS ${x.epsYoy >= 0 ? "up" : "down"} ${r1(Math.abs(x.epsYoy))}% on the year, beat in ${x.beats4} and missed in ${x.misses4} of the last 4 reports` : `Beat in ${x.beats4} and missed in ${x.misses4} of the last 4 reports`,
    fin(x.rev30) && Math.abs(x.rev30) >= 1 ? `Full-year EPS estimate ${x.rev30 > 0 ? "raised" : "cut"} ${r1(Math.abs(x.rev30))}% in 30 days` : null,
    fin(x.fwdPE) && fin(x.groupPE) ? `Forward P/E ${r1(x.fwdPE)} against ${r1(x.groupPE)} for its group` : null,
  ], { rank: rk.rank, of: rk.n, rankScore: rk.score, earn: rk.e, quality: rk.q, price: rk.p, rankedOn: rk.asOf }, { signalDate: rk.asOf })];
}

// ---------------------------------------------------------------------------
// FLOW & POSITIONING (live only). view.live.flow (lib/engines/index.mjs):
//   { signed, nBull, nBear, bullUsd, bearUsd, bullPrem, bearPrem, persist, gamma, callWall, siPct, covering, rvol, borrowTight, shortVolZ }
// Signed (lib/flow-direction.mjs, 2026-11-16): bull = calls bought or puts
// sold, bear = calls sold or puts bought; *Usd in delta dollars, *Prem in
// option premium. signed: false = the older ask-side call vs put premium.
// ---------------------------------------------------------------------------
export function evalFlow(view, ctx) {
  const f = view.f, w = view.live?.flow; if (!f || !w || !(view.spot > 0)) return [];
  const out = [];
  const now = nowAtr(view);
  const tot = (w.bullUsd || 0) + (w.bearUsd || 0), n = (w.nBull || 0) + (w.nBear || 0);
  if (n >= 5 && tot > 0) {
    const bullShare = (w.bullUsd || 0) / tot, side = bullShare >= 0.7 ? "call" : bullShare <= 0.3 ? "put" : null;
    if (side) {
      const dir = side === "call" ? 1 : -1, prem = side === "call" ? w.bullPrem : w.bearPrem, share = side === "call" ? bullShare : 1 - bullShare;
      const persistAgree = fin(w.persist) && w.persist * dir >= 0.2, persistAgainst = fin(w.persist) && w.persist * dir <= -0.2;
      if (prem >= 250000 && !persistAgainst && now * dir >= 0.1 && entryOk(view, side, { setup: "aggressive-flow" })) {
        const score = 54 + Math.min(10, (share - 0.7) * 40) + Math.min(6, Math.log10(prem / 250000) * 6) + (persistAgree ? 6 : 0) + (w.rvol >= 1.3 ? 4 : 0) + ((dir > 0) === (f.c > f.sma50) ? 3 : 0);
        const count = side === "call" ? w.nBull : w.nBear;
        const what = w.signed
          ? (side === "call" ? `${count} flagged bullish trades (calls bought or puts sold)` : `${count} flagged bearish trades (puts bought or calls sold)`)
          : `${count} flagged ${side} prints at the ask`;
        out.push(cand("flow", view, side, "aggressive-flow", score, [
          `${what}, $${Math.round(prem / 1000).toLocaleString("en-US")}k of premium (${Math.round(share * 100)}% of the ${w.signed ? "signed delta dollars" : "ask-side premium"})`,
          persistAgree ? "The week's flow is on the same side" : null,
          "The stock is moving with it today",
        ], { prints: n, premium: Math.round(prem), share: r2(share), persist: r2(w.persist), signed: !!w.signed }));
      }
    }
  }
  if (fin(w.gamma) && w.gamma >= 3 && w.callWall > 0 && w.callWall >= view.spot && w.callWall / view.spot - 1 <= 0.04 && (w.nBull || 0) >= 3 && (w.bullUsd || 0) > (w.bearUsd || 0) && entryOk(view, "call", { setup: "gamma-wall" })) {
    const score = 56 + (w.gamma - 3) * 6 + Math.min(6, (0.04 - (w.callWall / view.spot - 1)) * 150) + (f.c > f.sma50 ? 3 : 0) + (now > 0 ? 3 : 0);
    out.push(cand("flow", view, "call", "gamma-wall", score, [
      `Gamma score ${w.gamma} of 5 with the call wall at ${w.callWall}, ${r1((w.callWall / view.spot - 1) * 100)}% above the price`,
      w.signed ? "Bullish option flow today (calls bought or puts sold)" : "Call buying at the ask today",
    ], { gamma: w.gamma, callWall: w.callWall }, { targetLevel: w.callWall }));
  }
  if (fin(w.siPct) && w.siPct >= 15 && w.covering && f.ret5 >= 0.05 && f.volRatio >= 1.5 && entryOk(view, "call", { setup: "short-squeeze" })) {
    const heavyShorting = fin(w.shortVolZ) && w.shortVolZ >= 1.5;
    const score = 56 + Math.min(8, (w.siPct - 15) / 2) + Math.min(6, f.ret5 * 40) + (w.borrowTight ? 4 : 0) + (heavyShorting ? 3 : 0) + (now > 0 ? 3 : 0);
    out.push(cand("flow", view, "call", "short-squeeze", score, [
      `${r1(w.siPct)}% of the float is short and shorts are covering`,
      `Up ${pct(f.ret5)} in five sessions on ${r1(f.volRatio)}x volume`,
      w.borrowTight ? "Shares are hard to borrow" : null,
      heavyShorting ? "Short-sale volume is well above its 20-day norm while the price rises" : null,
    ], { siPct: r1(w.siPct), ret5: r2(f.ret5), shortVolZ: r2(w.shortVolZ) }));
  }
  return [...bestPerSymbol(out, ctx), ...flowTrials(view, ctx)];
}

// Flow paper trials (2026-11-20). Shares only, long only, stocks only (the
// funds belong to Macro and the core engines). Kept out of bestPerSymbol: a
// trial never replaces the engine's own setup on a name, and the book gives
// trials their own slots.
//   big-order-buying: Webull capital flow (view.live.flow.wb, sessions before
//     today): large orders net buying 10%+ of everything traded over five
//     sessions (wfl5) and net buying on the latest one (wfl > 0).
//   option-surge: today's flagged contracts 7+ days out (view.live.flow.surge):
//     $500k+ of call premium, 70%+ of the flagged premium in calls, and the
//     stock rising today (the side of most prints cannot be read).
// Both need the stock above its 50-day and pass the shared chasing filter.
export const FLOW_TRIAL = Object.freeze({ wfl5Min: 10, surgeCallUsd: 500000, surgeCallShare: 0.7, surgeMoveAtr: 0.1 });
function flowTrials(view, ctx) {
  const f = view.f, w = view.live?.flow; if (view.isEtf || !f || !w || !(view.spot > 0) || !(f.sma50 > 0) || !(f.c > f.sma50)) return [];
  const out = [], now = nowAtr(view), T = FLOW_TRIAL;
  const wb = w.wb;
  if (wb && fin(wb.wfl5) && wb.wfl5 >= T.wfl5Min && fin(wb.wfl) && wb.wfl > 0 && !ctx?.retired?.has("big-order-buying") && entryOk(view, "call", { setup: "big-order-buying" })) {
    out.push(cand("flow", view, "call", "big-order-buying", 60 + Math.min(10, (wb.wfl5 - T.wfl5Min) / 2) + (wb.wfl >= 20 ? 3 : 0), [
      `Large orders net bought ${r1(wb.wfl5)}% of everything traded over the last five sessions (Webull capital flow)`,
      `and ${r1(wb.wfl)}% on the latest session`,
      "Paper trial: shares, up to 10 sessions",
    ], { wfl5: r1(wb.wfl5), wfl: r1(wb.wfl), wft: r1(wb.wft) }));
  }
  const sg = w.surge;
  const tot = sg ? sg.callPrem + sg.putPrem : 0;
  if (sg && sg.callPrem >= T.surgeCallUsd && tot > 0 && sg.callPrem / tot >= T.surgeCallShare && now >= T.surgeMoveAtr && !ctx?.retired?.has("option-surge") && entryOk(view, "call", { setup: "option-surge" })) {
    const share = sg.callPrem / tot;
    out.push(cand("flow", view, "call", "option-surge", 60 + Math.min(6, Math.log10(sg.callPrem / T.surgeCallUsd) * 6) + Math.min(4, (share - T.surgeCallShare) * 13), [
      `$${Math.round(sg.callPrem / 1000).toLocaleString("en-US")}k of flagged call volume 7+ days out today, ${Math.round(share * 100)}% of the flagged premium`,
      `The stock is up ${r1(now)} ATR today and above its 50-day`,
      "Paper trial: shares, up to 10 sessions (the side of most prints cannot be read)",
    ], { callPrem: sg.callPrem, putPrem: sg.putPrem, callShare: r2(share), contracts: sg.n, moveAtr: r2(now) }));
  }
  return out;
}

// Is an open trade's reason still there? Returns a close reason or null.
// Only engine-specific thesis checks live here; price exits are in the book.
export function thesisCheck(trade, view) {
  if (!view) return null;
  // A core engine's holding (Trend follower, Momentum basket) is held while it
  // stays in the engine's monthly target. No target yet: hold.
  if (view.core && trade.engine in view.core) return view.core[trade.engine] === false ? "rotate" : null;
  if (trade.engine === "fundamentals" && isRankSetup(trade.setup)) {
    // A rank trade is held while the stock stays in the top (calls) or bottom
    // (puts) third of the standing rank. No rank this run: hold.
    const rk = view.fund?.rank;
    if (rk && rk.zone && rk.n >= RANK.minNames && rk.zone !== (trade.side === "put" ? "bottom" : "top")) return "rank-out";
    return null;
  }
  if (trade.engine === "fundamentals") {
    // Trades opened under the first rules (before the standing rank).
    const L = view.earn?.last;
    if (L && L.date > String(trade.signalDate || "") && L.date > String(trade.entryDate || "").slice(0, 10) && fin(L.surprisePct)) {
      if ((trade.side === "call" && L.surprisePct <= -2) || (trade.side === "put" && L.surprisePct >= 2)) return "signal-gone";
    }
  }
  if (trade.engine === "reversion" && trade.setup === "rsi2-dip") {
    // The dip is over once a confirmed close after the signal is back above
    // its 5-day average.
    const f = view.f;
    if (f && fin(f.sma5) && f.c > f.sma5 && String(f.date || "") > String(trade.signalDate || "")) return "target";
    return null;
  }
  if (trade.engine === "earnings" && trade.setup === "drift") {
    // A drift trade is over when price gives back the whole reaction day.
    const L = view.earn?.last;
    if (L && L.date === trade.signalDate && view.spot > 0 && fin(L.prevClose)) {
      if ((trade.side === "call" && view.spot < L.prevClose) || (trade.side === "put" && view.spot > L.prevClose)) return "signal-gone";
    }
  }
  return null;
}

export const EVALUATORS = Object.freeze({
  earnings: evalEarnings, technicals: evalTechnicals, fundamentals: evalFundamentals, flow: evalFlow, reversion: evalReversion,
});
