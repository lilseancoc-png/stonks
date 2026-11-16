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

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const pct = (x) => (fin(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "n/a");

// Today's move so far, in ATRs, measured from the last confirmed close.
const nowAtr = (view) => (view.f && view.spot > 0 ? (view.spot - view.f.c) / view.f.atr : 0);
// An entry is skipped when today already ran 1.5 ATR its way (chasing) or
// 0.9 ATR against it (the setup is failing as we look at it).
function entryOk(view, side, { chase = 1.5, against = 0.9 } = {}) {
  const m = nowAtr(view) * (side === "call" ? 1 : -1);
  return m <= chase && m >= -against;
}
function cand(engine, view, side, setup, score, reasons, facts = {}, extra = {}) {
  return {
    engine, symbol: view.sym, side, setup, score: Math.round(clamp(score, 0, 100)),
    reasons: reasons.filter(Boolean), facts,
    signalKey: `${view.sym}|${setup}|${extra.signalDate || view.f?.date || ""}`,
    ...extra,
  };
}
// The best candidate per symbol; two sides on one symbol cancel.
function bestPerSymbol(list) {
  const by = new Map();
  for (const c of list) {
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
  if (trendUp(f) && f.ret126 > 0 && fin(f.rsi2Min3) && f.rsi2Min3 <= 20 && f.c > f.pc && f.lo5 <= f.sma20 + 0.5 * f.atr && entryOk(view, "call")) {
    const score = 50 + Math.min(12, f.ret126 * 30) + (f.rsi2Min3 <= 10 ? 6 : 0) + (f.sma20 > f.sma50 ? 4 : 0) + (vr >= 1.2 ? 4 : 0) + (rs > 0 ? 5 : 0) + (f.rangePos >= 0.6 ? 3 : 0) + marketAgree(ctx, "call");
    out.push(cand("technicals", view, "call", "pullback", score, [
      `Uptrend: price over the 50-day over the 200-day, ${pct(f.ret126)} in six months`,
      `2-day RSI fell to ${r1(f.rsi2Min3)} near the 20-day, then closed up`,
      rs > 0 ? `Stronger than SPY over three months (${pct(rs)})` : null,
    ], { ret126: r2(f.ret126), rsi2: r1(f.rsi2Min3), volRatio: r2(vr), rs63: r2(rs) }, { stopLevel: r2(f.lo5 - 0.25 * f.atr) }));
  }
  if (trendDown(f) && f.ret126 < 0 && fin(f.rsi2Max3) && f.rsi2Max3 >= 80 && f.c < f.pc && f.hi5 >= f.sma20 - 0.5 * f.atr && entryOk(view, "put")) {
    const score = 50 + Math.min(12, -f.ret126 * 30) + (f.rsi2Max3 >= 90 ? 6 : 0) + (f.sma20 < f.sma50 ? 4 : 0) + (vr >= 1.2 ? 4 : 0) + (rs < 0 ? 5 : 0) + (f.rangePos <= 0.4 ? 3 : 0) + marketAgree(ctx, "put");
    out.push(cand("technicals", view, "put", "rally-fade", score, [
      `Downtrend: price under the 50-day under the 200-day, ${pct(f.ret126)} in six months`,
      `2-day RSI rose to ${r1(f.rsi2Max3)} near the 20-day, then closed down`,
      rs < 0 ? `Weaker than SPY over three months (${pct(rs)})` : null,
    ], { ret126: r2(f.ret126), rsi2: r1(f.rsi2Max3), volRatio: r2(vr), rs63: r2(rs) }, { stopLevel: r2(f.hi5 + 0.25 * f.atr) }));
  }
  // Range breakout.
  if (fin(f.hi55p) && f.c > f.hi55p && f.dayAtr >= 0.8 && vr >= 1.4 && f.c > f.sma200 && entryOk(view, "call", { chase: 1.2, against: 0.6 })) {
    const score = 52 + Math.min(10, (vr - 1.4) * 8) + (f.bbwRankPrev != null && f.bbwRankPrev <= 0.3 ? 8 : f.bbwRankPrev != null && f.bbwRankPrev <= 0.5 ? 4 : 0) + (f.distHi252 >= -0.02 ? 5 : 0) + (rs > 0 ? 4 : 0) + (f.rangePos >= 0.7 ? 3 : 0) + marketAgree(ctx, "call");
    out.push(cand("technicals", view, "call", "breakout", score, [
      `Closed above its prior 55-day high (${r2(f.hi55p)}) on ${r1(vr)}x volume`,
      f.bbwRankPrev != null && f.bbwRankPrev <= 0.3 ? "Broke out of a tight range" : null,
      f.distHi252 >= -0.02 ? "At a 52-week high" : null,
    ], { level: r2(f.hi55p), volRatio: r2(vr), dayAtr: r2(f.dayAtr) }, { stopLevel: r2(f.hi55p - f.atr) }));
  }
  if (fin(f.lo55p) && f.c < f.lo55p && f.dayAtr <= -0.8 && vr >= 1.4 && f.c < f.sma200 && entryOk(view, "put", { chase: 1.2, against: 0.6 })) {
    const score = 52 + Math.min(10, (vr - 1.4) * 8) + (f.bbwRankPrev != null && f.bbwRankPrev <= 0.3 ? 8 : f.bbwRankPrev != null && f.bbwRankPrev <= 0.5 ? 4 : 0) + (f.lo252 && f.c <= f.lo252 * 1.02 ? 5 : 0) + (rs < 0 ? 4 : 0) + (f.rangePos <= 0.3 ? 3 : 0) + marketAgree(ctx, "put");
    out.push(cand("technicals", view, "put", "breakdown", score, [
      `Closed below its prior 55-day low (${r2(f.lo55p)}) on ${r1(vr)}x volume`,
      f.bbwRankPrev != null && f.bbwRankPrev <= 0.3 ? "Broke down out of a tight range" : null,
    ], { level: r2(f.lo55p), volRatio: r2(vr), dayAtr: r2(f.dayAtr) }, { stopLevel: r2(f.lo55p + f.atr) }));
  }
  // Squeeze break.
  if (f.bbwRankPrev != null && f.bbwRankPrev <= 0.15 && fin(f.z20) && Math.abs(f.z20) >= 2 && vr >= 1.2) {
    const side = f.z20 > 0 ? "call" : "put";
    if (((side === "call" && f.c > f.sma200) || (side === "put" && f.c < f.sma200)) && entryOk(view, side, { chase: 1.2, against: 0.6 })) {
      const score = 52 + Math.min(8, (0.15 - f.bbwRankPrev) * 60) + Math.min(6, (Math.abs(f.z20) - 2) * 6) + Math.min(6, (vr - 1.2) * 6) + marketAgree(ctx, side);
      out.push(cand("technicals", view, side, "squeeze", score, [
        `Bollinger width was in the tightest ${Math.round(f.bbwRankPrev * 100)}% of six months`,
        `Closed ${r1(Math.abs(f.z20))} standard deviations ${side === "call" ? "above" : "below"} its 20-day on ${r1(vr)}x volume`,
      ], { bbwRank: r2(f.bbwRankPrev), z20: r2(f.z20), volRatio: r2(vr) }, { stopLevel: r2(f.sma20) }));
    }
  }
  return bestPerSymbol(out);
}

// ---------------------------------------------------------------------------
// REVERSION: against stretched moves.
// ---------------------------------------------------------------------------
export function evalReversion(view, ctx) {
  const f = view.f; if (!f || f.sma200 == null || !(view.spot > 0) || !fin(f.z20) || !fin(f.rsi2)) return [];
  // Stand aside around the company's own report: a gap there is news, not noise.
  const e = view.earn;
  if (e && ((e.next && e.next.sessionsUntil != null && e.next.sessionsUntil <= 2) || (e.last && e.last.sessionsSince != null && e.last.sessionsSince <= 1))) return [];
  const out = [];
  const now = nowAtr(view);
  if (f.c > f.sma200 && f.rsi2 <= 8 && f.z20 <= -1.8 && f.move5Atr <= -2 && now >= -1) {
    const score = 50 + Math.min(12, (-f.z20 - 1.8) * 10) + (f.rsi2 <= 3 ? 5 : 0) + (f.downStreak >= 4 ? 4 : 0) + (f.rangePos >= 0.5 ? 5 : 0) + (f.ret126 > 0 ? 5 : 0) + (now > 0 ? 4 : 0) + stressAdj(ctx, 3, -5, -12);
    out.push(cand("reversion", view, "call", "oversold-bounce", score, [
      `Still above its 200-day, but 2-day RSI is ${r1(f.rsi2)} after a ${r1(-f.move5Atr)} ATR drop in five sessions`,
      `${r1(-f.z20)} standard deviations under its 20-day`,
      now > 0 ? "Bouncing today" : null,
    ], { rsi2: r1(f.rsi2), z20: r2(f.z20), move5Atr: r2(f.move5Atr) }, { targetLevel: r2(f.sma20), stopLevel: r2(f.c - 2 * f.atr) }));
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
    ], { move3Atr: r2(f.move3Atr), volRatio: r2(f.volRatio), rangePos: r2(f.rangePos) }, { targetLevel: r2(f.sma10 ?? f.c + 2 * f.atr), stopLevel: r2(f.l - 0.5 * f.atr) }));
  }
  return bestPerSymbol(out);
}

// ---------------------------------------------------------------------------
// MACRO: funds only. One call per run (not per name).
// ctx.macro: factor row (lib/engines/macro.mjs), ctx.macroEvent: the event
// kind on the last confirmed session ("fomc", "cpi", "jobs") or null.
// ---------------------------------------------------------------------------
export function evalMacro(ctx) {
  const m = ctx.macro; if (!m) return [];
  const V = (s) => { const v = ctx.byId?.[s]; return v && v.f && v.spot > 0 ? v : null; };
  const spy = V("SPY"); if (!spy) return [];
  const idx = ["SPY", "QQQ", "IWM"].map(V).filter(Boolean);
  const by21 = idx.slice().sort((a, b) => (a.f.ret21 ?? 0) - (b.f.ret21 ?? 0));
  const out = [];
  const add = (view, side, setup, score, reasons, facts) => { if (view && entryOk(view, side)) out.push(cand("macro", view, side, setup, score, reasons, facts)); };
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
  if (m.vixInvertedIn10 && fin(m.vixRatio) && m.vixRatio <= 0.93 && s.c > s.sma10 && s.ret3 > 0) add(spy, "call", "vol-normal", 56 + (m.vix >= 20 ? 5 : 0) + Math.min(8, s.ret3 * 200) + (s.sma200 && s.c > s.sma200 ? 4 : 0), [
    "The VIX curve was inverted in the last 10 sessions and is normal again", `SPY is back over its 10-day, ${pct(s.ret3)} in three sessions`,
  ], { vixRatio: r2(m.vixRatio), vix: r1(m.vix) });
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
  return bestPerSymbol(out);
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
    if ((epsOk || priceOnly || guideLed) && Math.abs(g) >= 3 && held && ext <= 0.06 && ext >= -0.03 && entryOk(view, side)) {
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
  if (N && N.sessionsUntil != null && N.sessionsUntil >= 4 && N.sessionsUntil <= 9 && N.exitBy) {
    const runs = (e.hist || []).map((h) => h.pre10Pct).filter(fin).slice(0, 8);
    if (runs.length >= 4) {
      const upShare = runs.filter((x) => x > 0).length / runs.length, avg = runs.reduce((a, b) => a + b, 0) / runs.length;
      const rs = fin(f.ret63) && fin(ctx.spy?.ret63) ? f.ret63 - ctx.spy.ret63 : null;
      const veryRich = view.live?.iv?.band === "very-rich";
      if (upShare >= 0.62 && avg >= 1.5 && f.c > f.sma50 && f.ret21 > 0 && !veryRich && entryOk(view, "call")) {
        const score = 52 + Math.min(12, (upShare - 0.5) * 40) + Math.min(6, avg) + (trendUp(f) ? 5 : 0) + (rs > 0 ? 3 : 0) + marketAgree(ctx, "call", 3, -5);
        out.push(cand("earnings", view, "call", "run-in", score, [
          `Reports ${N.date}${N.session && N.session !== "TBD" ? ` (${N.session === "AM" ? "before the open" : "after the close"})` : ""}, ${N.sessionsUntil} sessions away`,
          `Rose into ${Math.round(upShare * runs.length)} of its last ${runs.length} reports, ${r1(avg)}% on average over the 10 sessions before`,
          "Closed before the report, never held through it",
        ], { nextDate: N.date, upShare: r2(upShare), avgRunIn: r1(avg), sessionsUntil: N.sessionsUntil }, { signalDate: `pre-${N.date}`, exitBy: N.exitBy }));
      }
      if (upShare <= 0.38 && avg <= -1.5 && f.c < f.sma50 && f.ret21 < 0 && !veryRich && entryOk(view, "put")) {
        const score = 52 + Math.min(12, (0.5 - upShare) * 40) + Math.min(6, -avg) + (trendDown(f) ? 5 : 0) + (rs < 0 ? 3 : 0) + marketAgree(ctx, "put", 3, -5);
        out.push(cand("earnings", view, "put", "run-in", score, [
          `Reports ${N.date}, ${N.sessionsUntil} sessions away`,
          `Fell into ${Math.round((1 - upShare) * runs.length)} of its last ${runs.length} reports, ${r1(avg)}% on average over the 10 sessions before`,
          "Closed before the report, never held through it",
        ], { nextDate: N.date, upShare: r2(upShare), avgRunIn: r1(avg), sessionsUntil: N.sessionsUntil }, { signalDate: `pre-${N.date}`, exitBy: N.exitBy }));
      }
    }
  }
  return bestPerSymbol(out);
}

// ---------------------------------------------------------------------------
// FUNDAMENTALS. view.fund (lib/engines/earn.mjs fundCore + live extras):
//   core: { epsYoy, epsYoyPrev, beats4, misses4, reports, lastDate, sessionsSince }
//   live: the stock's fundamentals object, the sector group's median forward P/E
// ---------------------------------------------------------------------------
export function evalFundamentals(view, ctx) {
  const f = view.f, core = view.fund?.core; if (!f || !core || !(view.spot > 0) || f.sma200 == null) return [];
  if (core.sessionsSince == null || core.sessionsSince < 3 || core.sessionsSince > 25) return [];
  const next = view.earn?.next;
  if (next && next.sessionsUntil != null && next.sessionsUntil < 6) return [];
  const x = view.fund.live || null, grpPE = view.fund.groupPE ?? null;
  const out = [];
  const liveBits = (dir) => {
    if (!x) return { pts: 0, notes: [] };
    let pts = 0; const notes = [];
    const rev30 = x.fyEpsRevision?.pct30;
    if (fin(rev30)) { if (rev30 * dir > 3) { pts += 6; notes.push(`Full-year EPS estimate ${rev30 > 0 ? "raised" : "cut"} ${r1(Math.abs(rev30))}% in 30 days`); } else if (rev30 * dir > 1) pts += 4; else if (rev30 * dir < -1) pts -= 5; }
    if (dir > 0) {
      if (x.operatingMargin >= 20) pts += 3;
      if (x.returnOnEquity >= 20) pts += 2;
      if (x.revenueGrowthYoy >= 10) { pts += 3; notes.push(`Revenue up ${r1(x.revenueGrowthYoy)}% on the year`); }
      if (fin(x.freeCashFlow) && x.marketCap > 0 && x.freeCashFlow / x.marketCap >= 0.03) pts += 3;
      if (x.debtToEquity > 200) pts -= 3;
      if (fin(x.forwardPE) && x.forwardPE > 0 && fin(grpPE) && grpPE > 0) { const rel = x.forwardPE / grpPE; if (rel <= 1.1) { pts += 4; notes.push(`Forward P/E ${r1(x.forwardPE)} against ${r1(grpPE)} for its group`); } else if (rel >= 1.8) pts -= 5; }
      if (fin(x.targetMeanPrice) && x.targetMeanPrice / view.spot - 1 >= 0.15) pts += 2;
    } else {
      if (fin(x.operatingMargin) && x.operatingMargin < 5) pts += 3;
      if (x.revenueGrowthYoy < 0) { pts += 3; notes.push(`Revenue down ${r1(-x.revenueGrowthYoy)}% on the year`); }
      if (x.debtToEquity > 200) { pts += 3; notes.push("Heavy debt"); }
      if (fin(x.forwardPE) && fin(grpPE) && grpPE > 0 && (x.forwardPE <= 0 || x.forwardPE / grpPE >= 1.5)) pts += 3;
      if (fin(x.targetMeanPrice) && x.targetMeanPrice < view.spot) pts += 2;
    }
    return { pts, notes };
  };
  if (fin(core.epsYoy) && core.epsYoy >= 8 && core.beats4 >= 3 && f.c > f.sma200 * 0.92 && entryOk(view, "call")) {
    const lb = liveBits(1);
    const score = 50 + Math.min(10, core.epsYoy / 4) + (core.beats4 >= 4 ? 5 : 2) + (fin(core.epsYoyPrev) && core.epsYoy > core.epsYoyPrev ? 3 : 0) + lb.pts;
    out.push(cand("fundamentals", view, "call", "compounder", score, [
      `EPS up ${r1(core.epsYoy)}% on the year, beat in ${core.beats4} of the last 4 reports`,
      fin(core.epsYoyPrev) && core.epsYoy > core.epsYoyPrev ? "Growth is speeding up" : null, ...lb.notes,
    ], { epsYoy: r1(core.epsYoy), beats4: core.beats4, live: !!x }, { signalDate: core.lastDate }));
  }
  if (fin(core.epsYoy) && core.epsYoy <= -8 && core.misses4 >= 2 && f.c < f.sma200 * 1.05 && entryOk(view, "put")) {
    const lb = liveBits(-1);
    const score = 50 + Math.min(10, -core.epsYoy / 4) + (core.misses4 >= 3 ? 5 : 2) + (fin(core.epsYoyPrev) && core.epsYoy < core.epsYoyPrev ? 3 : 0) + lb.pts;
    out.push(cand("fundamentals", view, "put", "deteriorating", score, [
      `EPS down ${r1(-core.epsYoy)}% on the year, missed in ${core.misses4} of the last 4 reports`,
      fin(core.epsYoyPrev) && core.epsYoy < core.epsYoyPrev ? "The decline is getting worse" : null, ...lb.notes,
    ], { epsYoy: r1(core.epsYoy), misses4: core.misses4, live: !!x }, { signalDate: core.lastDate }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// FLOW & POSITIONING (live only). view.live.flow (lib/engines/index.mjs):
//   { signed, nBull, nBear, bullUsd, bearUsd, bullPrem, bearPrem, persist, gamma, callWall, siPct, covering, rvol, borrowTight, shortVolZ }
// Signed (lib/flow-direction.mjs, 2026-11-16): bull = calls bought or puts
// sold, bear = calls sold or puts bought; *Usd in delta dollars, *Prem in
// option premium. signed: false = the older ask-side call vs put premium.
// ---------------------------------------------------------------------------
export function evalFlow(view) {
  const f = view.f, w = view.live?.flow; if (!f || !w || !(view.spot > 0)) return [];
  const out = [];
  const now = nowAtr(view);
  const tot = (w.bullUsd || 0) + (w.bearUsd || 0), n = (w.nBull || 0) + (w.nBear || 0);
  if (n >= 5 && tot > 0) {
    const bullShare = (w.bullUsd || 0) / tot, side = bullShare >= 0.7 ? "call" : bullShare <= 0.3 ? "put" : null;
    if (side) {
      const dir = side === "call" ? 1 : -1, prem = side === "call" ? w.bullPrem : w.bearPrem, share = side === "call" ? bullShare : 1 - bullShare;
      const persistAgree = fin(w.persist) && w.persist * dir >= 0.2, persistAgainst = fin(w.persist) && w.persist * dir <= -0.2;
      if (prem >= 250000 && !persistAgainst && now * dir >= 0.1 && entryOk(view, side)) {
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
  if (fin(w.gamma) && w.gamma >= 3 && w.callWall > 0 && w.callWall >= view.spot && w.callWall / view.spot - 1 <= 0.04 && (w.nBull || 0) >= 3 && (w.bullUsd || 0) > (w.bearUsd || 0) && entryOk(view, "call")) {
    const score = 56 + (w.gamma - 3) * 6 + Math.min(6, (0.04 - (w.callWall / view.spot - 1)) * 150) + (f.c > f.sma50 ? 3 : 0) + (now > 0 ? 3 : 0);
    out.push(cand("flow", view, "call", "gamma-wall", score, [
      `Gamma score ${w.gamma} of 5 with the call wall at ${w.callWall}, ${r1((w.callWall / view.spot - 1) * 100)}% above the price`,
      w.signed ? "Bullish option flow today (calls bought or puts sold)" : "Call buying at the ask today",
    ], { gamma: w.gamma, callWall: w.callWall }, { targetLevel: w.callWall }));
  }
  if (fin(w.siPct) && w.siPct >= 15 && w.covering && f.ret5 >= 0.05 && f.volRatio >= 1.5 && entryOk(view, "call")) {
    const heavyShorting = fin(w.shortVolZ) && w.shortVolZ >= 1.5;
    const score = 56 + Math.min(8, (w.siPct - 15) / 2) + Math.min(6, f.ret5 * 40) + (w.borrowTight ? 4 : 0) + (heavyShorting ? 3 : 0) + (now > 0 ? 3 : 0);
    out.push(cand("flow", view, "call", "short-squeeze", score, [
      `${r1(w.siPct)}% of the float is short and shorts are covering`,
      `Up ${pct(f.ret5)} in five sessions on ${r1(f.volRatio)}x volume`,
      w.borrowTight ? "Shares are hard to borrow" : null,
      heavyShorting ? "Short-sale volume is well above its 20-day norm while the price rises" : null,
    ], { siPct: r1(w.siPct), ret5: r2(f.ret5), shortVolZ: r2(w.shortVolZ) }));
  }
  return bestPerSymbol(out);
}

// Is an open trade's reason still there? Returns a close reason or null.
// Only engine-specific thesis checks live here; price exits are in the book.
export function thesisCheck(trade, view) {
  if (!view) return null;
  if (trade.engine === "fundamentals") {
    const L = view.earn?.last;
    if (L && L.date > String(trade.signalDate || "") && L.date > String(trade.entryDate || "").slice(0, 10) && fin(L.surprisePct)) {
      if ((trade.side === "call" && L.surprisePct <= -2) || (trade.side === "put" && L.surprisePct >= 2)) return "signal-gone";
    }
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
