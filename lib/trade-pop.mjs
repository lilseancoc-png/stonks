// Chance of profit on every Webull paper trade (2026-11-22, owner request:
// "measure probability of profits on each of our trades ... record our
// estimate and when the engine exits the trade record the outcome").
//
// At entry each Top Picks and strategy-engine record trade gets a `pop`
// stamp, frozen there and never re-estimated:
//
//   model   a seeded simulation of the stock at the contract's own implied
//           volatility (shares: the stock's at-the-money option IV, else its
//           20-day realized move), drifting at the risk-free rate (no edge
//           assumed). Each path re-prices the position every session and
//           runs it through the trade's real exits: the take-profit and stop
//           on the option's price, the stock stop and target, the session
//           limit, the pre-expiry exit day or the event exit, and expiry.
//           It is sold on the record's own basis (the bid after an ask entry
//           for engine options, the mid for Top Picks, the round-trip cost
//           for shares). `m` = the share of paths that close with a gain.
//   record  how often this kind of trade has won before: for an engine, the
//           setup's history-test win rate (counted as at most POP.historyCap
//           trades, because the history test priced options from a model)
//           plus every live and shadow close of the same engine, setup, side
//           and instrument; for Top Picks, the self-improving loop's
//           "+25% before -50%" chance once the loop is past learning, else
//           the Similar-setup odds (side, grade band, market type).
//   p       our estimate: the record and the model blended, the record's
//           weight n / (n + POP.recordK) growing with its sample.
//
// At exit the record writes `res` on the stamp: y = 1 for a close with a gain,
// 0 for a loss or flat close, the P&L, and the close time. The check
// (buildPopCheck) grades every stamped close: stated against what happened,
// in buckets, with the Brier skill against always saying the base rate, by
// group (Top Picks, engine options, engine shares, paper trials) and by method
// (our estimate, the model, the record), plus the Webull fill results.
//
// Nothing here changes which trades open, their size or their exits.
// Kill switch: Owner Settings TRADE_POP (off = no new stamps; stored stamps
// and the check stay). Pure: no network, no AI, no clock.

import { bsPrice, ncdf, expiryCloseEpochSec } from "./greeks.mjs";
import { scoreChance } from "./labs/calibration.mjs";
import { pickTradeId } from "./pick-trade-text.mjs";

export const TRADE_POP_VERSION = 1;
export const POP = Object.freeze({
  paths: 2000,          // simulated paths per trade
  sessionsPerYear: 252,
  maxSessions: 260,     // longest horizon simulated
  recordK: 40,          // the record's weight is n / (n + recordK)
  historyCap: 20,       // a history-test win rate counts as at most this many trades
  checkMinN: 30,        // closes before the check gives a verdict
});
export const POP_BUCKETS = Object.freeze([[0, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 1.0001]]);

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r3 = (x) => (fin(x) ? Math.round(x * 1000) / 1000 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export const tradePopEnabled = (env = process.env) => !/^(0|off|false|no)$/.test(String(env?.TRADE_POP ?? "").trim().toLowerCase());

// --- seeded draws -------------------------------------------------------------------
function seedOf(str) {
  let h = 2166136261;
  for (const ch of String(str || "pop")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normals(rand) {
  let spare = null;
  return function () {
    if (spare != null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0;
    while (u <= 1e-12) u = rand();
    v = rand();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
}

// --- the market model ------------------------------------------------------------------
// legs: [{ type: "call"|"put", strike, qty (+1 long, -1 short), iv }] per share.
function legsValue(legs, S, T, r) {
  let v = 0;
  for (const l of legs) {
    const intrinsic = l.type === "put" ? Math.max(0, l.strike - S) : Math.max(0, S - l.strike);
    const px = T <= 1 / (POP.sessionsPerYear * 4) ? intrinsic : bsPrice(l.type, S, l.strike, T, l.iv, r);
    v += l.qty * (fin(px) ? px : intrinsic);
  }
  return v;
}

// input:
//   id (seed), kind "option" | "shares", side "call" | "put" (the direction:
//   a call or share trade gains when the stock rises), spot, sigma (yearly),
//   rfr, sessions (horizon: the last session the trade can be held),
//   T (years to expiry at entry, options), legs (options), credit (true for
//   a credit spread: profit is the credit kept),
//   entryRatio (entry price / mid: the ask over the mid for an ask entry, 1
//   for a mid entry), exitHaircut (share of the mid given up on the way out),
//   costPct (shares: round-trip cost in % of the price),
//   tp / stop (% of the premium or the share price, stop negative; fired on
//   the mid), trailArm / trailGive (the trailing exit: once the mid P&L has
//   been up trailArm, close when it gives back trailGive points from its
//   best), stockStop / stockTarget (stock levels).
export function modelChance(input, { paths = POP.paths } = {}) {
  const S0 = num(input?.spot), sigma = num(input?.sigma), r = num(input?.rfr) ?? 0.045;
  const H = Math.round(num(input?.sessions) ?? 0);
  if (!(S0 > 0) || !(sigma > 0.01) || sigma > 5 || !(H >= 1)) return null;
  const horizon = Math.min(H, POP.maxSessions);
  const shares = input.kind === "shares";
  const legs = shares ? null : (input.legs || []).filter((l) => l && num(l.strike) > 0 && num(l.iv) > 0.01 && (l.qty === 1 || l.qty === -1))
    .map((l) => ({ type: l.type === "put" ? "put" : "call", strike: Number(l.strike), qty: l.qty, iv: Number(l.iv) }));
  if (!shares && !legs?.length) return null;
  const T0 = shares ? null : num(input.T);
  if (!shares && !(T0 > 0)) return null;
  const credit = !!input.credit;
  const v0 = shares ? S0 : legsValue(legs, S0, T0, r);
  const base = credit ? -v0 : v0;
  if (!(base > 0.001)) return null;
  const entryRatio = clamp(num(input.entryRatio) ?? 1, 0.5, 2);
  const haircut = clamp(num(input.exitHaircut) ?? 0, 0, 0.5);
  const costPct = shares ? Math.max(0, num(input.costPct) ?? 0) : 0;
  const tp = num(input.tp), stop = num(input.stop) != null ? -Math.abs(num(input.stop)) : null;
  const up = input.side !== "put";
  const sStop = num(input.stockStop), sTarget = num(input.stockTarget);
  const trailArm = num(input.trailArm), trailGive = num(input.trailGive);
  const dt = 1 / POP.sessionsPerYear, drift = (r - (sigma * sigma) / 2) * dt, vol = sigma * Math.sqrt(dt);
  const z = normals(mulberry32(seedOf(input.id)));
  let wins = 0, sumPnl = 0, nTp = 0, nStop = 0, nTrail = 0, nSStop = 0, nSTarget = 0, nEnd = 0;
  const midPnl = (v) => (shares ? (v / S0 - 1) * 100 - costPct : credit ? ((base + v) / base) * 100 : (v / base - 1) * 100);
  const bookedPnl = (v) => {
    if (shares) return (v / S0 - 1) * 100 - costPct;
    if (credit) { const buyBack = -v * (1 + haircut); return ((base * (2 - entryRatio) - buyBack) / base) * 100; }
    return ((v * (1 - haircut)) / (base * entryRatio) - 1) * 100;
  };
  for (let i = 0; i < paths; i++) {
    let S = S0, v = v0, how = "end", hi = 0;
    for (let k = 1; k <= horizon; k++) {
      S *= Math.exp(drift + vol * z());
      v = shares ? S : legsValue(legs, S, Math.max(0, T0 - k * dt), r);
      const m = midPnl(v);
      if (tp != null && m >= tp) { how = "tp"; break; }
      if (stop != null && m <= stop) { how = "stop"; break; }
      // The record's order: take-profit, stop, trailing exit, stock stop, stock target.
      if (m > hi) hi = m;
      if (trailArm != null && trailGive != null && hi >= trailArm && m <= hi - trailGive) { how = "trail"; break; }
      if (sStop != null && (up ? S <= sStop : S >= sStop)) { how = "sstop"; break; }
      if (sTarget != null && (up ? S >= sTarget : S <= sTarget)) { how = "starget"; break; }
    }
    const b = bookedPnl(v);
    sumPnl += b;
    if (Math.round(b * 10) / 10 > 0) wins++;
    if (how === "tp") nTp++; else if (how === "stop") nStop++; else if (how === "trail") nTrail++; else if (how === "sstop") nSStop++; else if (how === "starget") nSTarget++; else nEnd++;
  }
  return { p: r3(wins / paths), paths, avg: r1(sumPnl / paths), tp: r3(nTp / paths), stop: r3(nStop / paths), ...(nTrail ? { trail: r3(nTrail / paths) } : {}), sStop: r3(nSStop / paths), sTarget: r3(nSTarget / paths), end: r3(nEnd / paths) };
}

// The textbook chance of finishing past the breakeven at expiry (N(d2)).
export function heldToExpiryChance({ spot, breakeven, sigma, T, rfr = 0.045, side }) {
  const S = num(spot), B = num(breakeven), s = num(sigma), t = num(T);
  if (!(S > 0 && B > 0 && s > 0 && t > 0)) return null;
  const d2 = (Math.log(S / B) + (rfr - (s * s) / 2) * t) / (s * Math.sqrt(t));
  return r3(side === "put" ? ncdf(-d2) : ncdf(d2));
}

// --- volatility for share trades ------------------------------------------------------
// The at-the-money implied volatility nearest 30 days out, from a per-ticker
// chain ({ spot, chains: { expSec: { c, p } } }, rows { s, iv }).
export function atmIv(data, nowMs) {
  const spot = num(data?.spot);
  if (!(spot > 0) || !data?.chains) return null;
  const exps = Object.keys(data.chains).map(Number).filter((e) => e > 0)
    .map((e) => ({ e, d: (e * 1000 - nowMs) / 86400000 })).filter((x) => x.d >= 7)
    .sort((a, b) => Math.abs(a.d - 30) - Math.abs(b.d - 30));
  for (const { e } of exps.slice(0, 3)) {
    const ivs = [];
    for (const col of ["c", "p"]) {
      const rows = (data.chains[e]?.[col] || []).filter((x) => num(x?.s) > 0 && num(x?.iv) > 0.03 && num(x?.iv) < 5);
      if (!rows.length) continue;
      rows.sort((a, b) => Math.abs(a.s - spot) - Math.abs(b.s - spot));
      ivs.push(Number(rows[0].iv));
    }
    if (ivs.length) return r3(ivs.reduce((a, b) => a + b, 0) / ivs.length);
  }
  return null;
}
// Yearly realized volatility of the last `n` daily closes ([{ c }] or numbers).
export function realizedVol(bars, n = 20) {
  const c = (bars || []).map((b) => num(b?.c ?? b)).filter((x) => x > 0).slice(-(n + 1));
  if (c.length < Math.min(n, 10) + 1) return null;
  const rets = [];
  for (let i = 1; i < c.length; i++) rets.push(Math.log(c[i] / c[i - 1]));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rets.length - 1);
  return r3(Math.sqrt(v * POP.sessionsPerYear));
}

// Weekdays after `from` up to and including `to` (YYYY-MM-DD): the sessions a
// trade can still be held. Market holidays are ignored (a day or two at most).
export function sessionsUntil(from, to) {
  const a = Date.parse(String(from).slice(0, 10) + "T12:00:00Z"), b = Date.parse(String(to).slice(0, 10) + "T12:00:00Z");
  if (!fin(a) || !fin(b) || b <= a) return 0;
  let n = 0;
  for (let t = a + 86400000; t <= b; t += 86400000) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n++; }
  return n;
}

// --- the record and the blend -----------------------------------------------------------
// sources: [{ id, label, p (0..1), n (trades behind it), cap (counted as at
// most this many) }]. Returns the pooled rate and the trades counted.
export function recordChance(sources) {
  const used = (sources || []).filter((s) => s && fin(num(s.p)) && num(s.n) > 0)
    .map((s) => ({ id: s.id, label: s.label || s.id, p: r3(clamp(Number(s.p), 0, 1)), n: Math.round(Number(s.n)), w: Math.min(Number(s.n), num(s.cap) ?? Infinity) }));
  const W = used.reduce((a, s) => a + s.w, 0);
  if (!(W > 0)) return { p: null, n: 0, src: used.map(({ w, ...s }) => s) };
  return { p: r3(used.reduce((a, s) => a + s.p * s.w, 0) / W), n: Math.round(W * 10) / 10, src: used.map((s) => ({ id: s.id, label: s.label, p: s.p, n: s.n, ...(s.w < s.n ? { cap: s.w } : {}) })) };
}
export function blendChance(m, rec, k = POP.recordK) {
  const mp = num(m), rp = num(rec?.p), rn = num(rec?.n) || 0;
  if (mp == null && rp == null) return null;
  if (rp == null || !(rn > 0)) return { p: r3(mp), w: 0 };
  const w = rn / (rn + k);
  // No model (no usable volatility): the record, pulled toward a coin flip.
  if (mp == null) return { p: r3((rn * rp + k * 0.5) / (rn + k)), w: r3(w), noModel: true };
  return { p: r3(w * rp + (1 - w) * mp), w: r3(w) };
}

// The stamp. `model` is modelChance's input plus `sigmaFrom` and `held`
// inputs; `record` the record sources; `basis` what the model sells at.
export function buildPopStamp({ id, at, model = null, record = [], basis = null, note = null }) {
  const sim = model ? modelChance({ ...model, id }) : null;
  const rec = recordChance(record);
  const est = blendChance(sim?.p, rec);
  if (!est) return null;
  const held = model && model.kind !== "shares" && model.breakeven != null
    ? heldToExpiryChance({ spot: model.spot, breakeven: model.breakeven, sigma: model.sigma, T: model.T, rfr: model.rfr, side: model.side }) : null;
  return {
    v: TRADE_POP_VERSION, at: at || null, p: est.p, m: sim?.p ?? null, r: rec.p, rn: rec.n, w: est.w,
    ...(est.noModel ? { noModel: true } : {}),
    mod: model ? {
      kind: model.kind, sigma: r3(num(model.sigma)), from: model.sigmaFrom || null, sessions: Math.round(num(model.sessions) || 0),
      tp: num(model.tp), stop: num(model.stop) != null ? -Math.abs(num(model.stop)) : null,
      ...(num(model.trailArm) != null && num(model.trailGive) != null ? { trail: [num(model.trailArm), num(model.trailGive)] } : {}),
      sStop: r2(num(model.stockStop)), sTarget: r2(num(model.stockTarget)),
      ...(model.kind === "shares" ? { cost: num(model.costPct) } : { basis: basis || null, entryRatio: r3(num(model.entryRatio) ?? 1), haircut: r3(num(model.exitHaircut) ?? 0) }),
      ...(held != null ? { held } : {}), ...(num(model.breakeven) != null ? { be: r2(num(model.breakeven)) } : {}),
      ...(model.horizonWhy ? { hw: model.horizonWhy } : {}),
      ...(sim ? { avg: sim.avg, out: { tp: sim.tp, stop: sim.stop, ...(sim.trail != null ? { trail: sim.trail } : {}), sStop: sim.sStop, sTarget: sim.sTarget, end: sim.end }, paths: sim.paths } : { none: model.noneWhy || "no usable volatility" }),
    } : null,
    src: rec.src,
    ...(note ? { note } : {}),
  };
}

// The outcome, written once when the record closes the trade. A void close
// (left coverage, a split, a data fault: not counted) grades nothing.
export function popResult(trade, { pnlKey = "optionPnlPct" } = {}) {
  const o = trade?.outcome;
  if (trade?.counted === false || (o !== "win" && o !== "loss" && o !== "flat")) return { y: null, why: o || "void", at: trade?.exitDate || null };
  return { y: o === "win" ? 1 : 0, pnl: r1(num(trade?.[pnlKey])), at: trade?.exitDate || null, status: trade?.status || null };
}
// Stamp the outcome on every closed trade that has a stamp and no outcome yet.
export function stampPopResults(closed, opts) {
  let n = 0;
  for (const t of closed || []) {
    if (!t?.pop || t.pop.res) continue;
    t.pop = { ...t.pop, res: popResult(t, opts) };
    n++;
  }
  return n;
}
// The slim copy kept when a closed trade moves to an archive.
export const compactPop = (pop) => (pop ? { v: pop.v, at: pop.at, p: pop.p, m: pop.m, r: pop.r, rn: pop.rn, w: pop.w, ...(pop.res ? { res: pop.res } : {}) } : null);

const yearsLeft = (expiry, nowSec) => {
  const close = expiryCloseEpochSec(Number(expiry));
  return fin(close) && fin(nowSec) ? Math.max(1 / 365, (close - nowSec) / (365.25 * 86400)) : null;
};

// --- engine trades --------------------------------------------------------------------------
// The history-test win rate for an engine setup and instrument (the committed
// research results, learning-off run: the rules as written).
export function historyWinRate(research, engine, setup, { shares = false, trial = false } = {}) {
  const run = research?.learningOff?.engines?.[engine] || research?.raw?.engines?.[engine] || null;
  if (!run) return null;
  const block = trial ? run.trials : shares ? run.shares : run;
  const row = (block?.bySetup || []).find((s) => s?.key === setup);
  return row && num(row.winRate) != null && num(row.n) > 0 ? { p: Number(row.winRate), n: Number(row.n) } : null;
}
const isShr = (t) => t?.contract?.structure === "shares";
const sameKind = (a, b) => a.engine === b.engine && a.setup === b.setup && (a.side === "put") === (b.side === "put") && isShr(a) === isShr(b) && !!a.trial === !!b.trial;
// Live and shadow closes of the same kind of trade, before this one opened.
export function liveWinRate(trade, closedLists) {
  let n = 0, w = 0;
  const seen = new Set();
  for (const list of closedLists || []) for (const c of list || []) {
    if (!c || !sameKind(c, trade) || c.outcome === "void" || c.counted === false) continue;
    // The record's own outcome (win / loss / flat), else the P&L sign.
    const won = c.outcome === "win" ? true : c.outcome === "loss" || c.outcome === "flat" ? false : fin(num(c.optionPnlPct)) ? Math.round(Number(c.optionPnlPct) * 10) / 10 > 0 : null;
    if (won == null) continue;
    if (c.exitDate && trade.entryDate && String(c.exitDate) > String(trade.entryDate)) continue;
    const k = c.tradeId || `${c.symbol}|${c.side}|${c.entryDate}|${c.shadow ? "s" : ""}`;
    if (seen.has(k)) continue;
    seen.add(k); n++; if (won) w++;
  }
  return n ? { p: w / n, n } : null;
}

// One engine trade's stamp. ctx: { research, closedLists, chain (the
// per-ticker chain), bars (daily closes), rfr, nowMs, today, exitDay (the
// pre-expiry exit day, YYYY-MM-DD) }.
export function engineTradePop(t, ctx = {}) {
  if (!t?.contract || !t.symbol) return null;
  const c = t.contract, shares = isShr(t), today = ctx.today || String(t.entryDate || "").slice(0, 10);
  const x = t.exits || {};
  let sessions = fin(num(x.maxSessions)) ? Number(x.maxSessions) : null, hw = sessions != null ? "session limit" : null;
  const cap = (n, why) => { if (n != null && n >= 1 && (sessions == null || n < sessions)) { sessions = n; hw = why; } };
  if (t.exitBy) cap(sessionsUntil(today, t.exitBy), "event exit");
  let model = null;
  if (shares) {
    const iv = atmIv(ctx.chain, ctx.nowMs ?? Date.parse(t.entryDate));
    const rv = iv == null ? realizedVol(ctx.bars) : null;
    // A core holding (no session limit, no levels) is held a month at least.
    if (sessions == null) { sessions = 21; hw = "next monthly check"; }
    model = { kind: "shares", side: "call", spot: num(c.mid), sigma: iv ?? rv, sigmaFrom: iv != null ? "option IV" : rv != null ? "20-day realized" : null,
      rfr: ctx.rfr, sessions, costPct: num(c.costPct) ?? 0, tp: num(x.tp), stop: num(x.stop), trailArm: num(x.trailArm), trailGive: num(x.trailGive), stockStop: num(t.stopLevel), stockTarget: num(t.targetLevel), horizonWhy: hw };
  } else {
    const nowSec = (ctx.nowMs ?? Date.parse(t.entryDate)) / 1000;
    const T = yearsLeft(c.expiry, nowSec);
    if (ctx.exitDay) cap(sessionsUntil(today, ctx.exitDay), "pre-expiry exit day");
    if (T) cap(Math.max(1, Math.round(T * POP.sessionsPerYear)), "expiry");
    const mid = num(c.mid), ask = num(c.entryFill) ?? null, spread = num(c.spreadPct) ?? 0;
    const type = c.optionType === "put" ? "put" : "call";
    model = { kind: "option", side: t.side, spot: num(t.entrySpot), sigma: num(c.iv), sigmaFrom: "option IV", rfr: ctx.rfr, sessions, T,
      legs: [{ type, strike: num(c.strike), qty: 1, iv: num(c.iv) }],
      entryRatio: ask && mid ? ask / mid : 1, exitHaircut: ask ? spread / 200 : 0,
      tp: num(x.tp), stop: num(x.stop), trailArm: num(x.trailArm), trailGive: num(x.trailGive), stockStop: num(t.stopLevel), stockTarget: num(t.targetLevel), horizonWhy: hw,
      breakeven: num(c.strike) != null && (ask || mid) ? (type === "put" ? Number(c.strike) - (ask || mid) : Number(c.strike) + (ask || mid)) : null };
  }
  const record = [];
  const h = historyWinRate(ctx.research, t.engine, t.setup, { shares, trial: !!t.trial });
  // The label names the years the committed history test covered.
  const yrs = [ctx.research?.data?.from, ctx.research?.data?.to].map((d) => String(d || "").slice(0, 4));
  if (h) record.push({ id: "history", label: /^\d{4}$/.test(yrs[0]) && /^\d{4}$/.test(yrs[1]) ? `History test ${yrs[0]}-${yrs[1]}` : "History test", p: h.p, n: h.n, cap: POP.historyCap });
  const live = liveWinRate(t, ctx.closedLists);
  if (live) record.push({ id: "live", label: "Live and shadow closes", p: live.p, n: live.n });
  return buildPopStamp({ id: t.tradeId, at: t.entryDate, model, record, basis: shares ? "shares" : model.entryRatio > 1 ? "ask in, bid out" : "mid" });
}

// --- Top Picks trades -------------------------------------------------------------------------
// One Top Picks record trade's stamp at enrollment. ctx: { exitPolicy
// ({ takeProfitPct, stopPct }), rfr, nowMs, setupOdds (oddsFor row: winPct,
// n, level, few), loopOdds (pick.loopOdds: pTp, n, learning) }.
export function picksTradePop(t, ctx = {}) {
  const c = t?.contract;
  if (!c || !t.symbol) return null;
  const nowSec = (ctx.nowMs ?? Date.parse(t.entryDate)) / 1000;
  const T = yearsLeft(c.expiry, nowSec);
  const structure = c.structure || "long";
  const credit = structure === "credit_vertical";
  const legs = structure === "long"
    ? [{ type: t.side === "put" ? "put" : "call", strike: num(c.strike), qty: 1, iv: num(c.iv) }]
    : (c.legs || []).map((l) => ({ type: l.type === "put" ? "put" : "call", strike: num(l.strike), qty: num(l.qty) < 0 ? -1 : 1, iv: num(l.iv) ?? num(c.iv) }));
  const sigma = structure === "long" ? num(c.iv) : num((c.legs || []).find((l) => num(l.qty) > 0)?.iv) ?? num(c.iv);
  const ex = ctx.exitPolicy || {};
  const model = {
    kind: "option", side: t.side, spot: num(t.entrySpot), sigma, sigmaFrom: "option IV", rfr: ctx.rfr, T, credit, legs,
    sessions: T ? Math.max(1, Math.round(T * POP.sessionsPerYear)) : null, horizonWhy: "expiry, no time stop",
    entryRatio: 1, exitHaircut: 0, tp: num(ex.takeProfitPct), stop: num(ex.stopPct), stockStop: num(t.cut), breakeven: num(c.breakeven),
  };
  const record = [];
  const lo = ctx.loopOdds;
  if (lo && !lo.learning && num(lo.pTp) != null && num(lo.n) > 0) record.push({ id: "loop", label: "Self-improving loop: +25% before -50%", p: Number(lo.pTp) / 100, n: Number(lo.n) });
  else {
    const so = ctx.setupOdds;
    if (so && num(so.winPct) != null && num(so.n) > 0) record.push({ id: "setup", label: `Similar past Top Picks (${String(so.level || "side").replace(/-/g, " + ")})`, p: Number(so.winPct) / 100, n: Number(so.n) });
  }
  const note = lo && lo.learning ? "The self-improving loop's chance is still learning (it reads a 50% prior), so it is not used yet." : null;
  return buildPopStamp({ id: t.tradeId || pickTradeId(t), at: t.entryDate, model, record, basis: "mid (the record's own marks)", note });
}

// --- the check ----------------------------------------------------------------------------------
export const POP_GROUPS = Object.freeze([
  { id: "all", label: "Every Webull trade" },
  { id: "top-picks", label: "Top Picks" },
  { id: "engine-options", label: "Engine option trades" },
  { id: "engine-shares", label: "Engine share trades" },
  { id: "trials", label: "Paper trials" },
]);
export const POP_METHODS = Object.freeze([
  { id: "p", label: "Our estimate" },
  { id: "m", label: "Market model" },
  { id: "r", label: "Track record" },
]);
const groupOf = (t, flagship) => (flagship ? "top-picks" : t.trial ? "trials" : isShr(t) ? "engine-shares" : "engine-options");

// Rows from both records. `webull`: { tradeId: { pnl, fill } } from the paper
// ledger (closed trades only), so the same stated chance can be graded
// against the Webull fill too. Trades the mirror never takes (`noMirror`: a
// second record of a contract another trade holds) are left out.
export function popRows({ flagship = [], engines = [], webull = null } = {}) {
  const rows = [], seen = new Set();
  const add = (t, flag) => {
    const s = t?.pop;
    if (!s || !fin(num(s.p)) || t.noMirror || t.shadow) return;
    // A Top Picks trade is keyed like the Webull ledger keys it.
    const id = t.tradeId || (flag ? pickTradeId(t) : `${t.symbol}|${t.side}|${t.entryDate}`);
    if (seen.has(id)) return;
    seen.add(id);
    const w = webull?.[id];
    rows.push({ id, g: groupOf(t, flag), sym: t.symbol, side: t.side, eng: flag ? null : t.engine || null, setup: t.setup || null,
      p: num(s.p), m: num(s.m), r: num(s.r), y: s.res ? s.res.y ?? null : null, pnl: s.res?.pnl ?? null, at: s.at, x: s.res?.at || null,
      open: !s.res, wy: w && fin(num(w.pnl)) ? (Math.round(Number(w.pnl) * 10) / 10 > 0 ? 1 : 0) : null });
  };
  for (const t of flagship || []) add(t, true);
  for (const t of engines || []) add(t, false);
  return rows;
}
function bucketTable(rows, key, yKey = "y") {
  return POP_BUCKETS.map(([lo, hi]) => {
    const part = rows.filter((r) => fin(r[key]) && r[key] >= lo && r[key] < hi && (r[yKey] === 0 || r[yKey] === 1));
    const n = part.length;
    return { lo, hi: Math.min(1, hi), n, stated: n ? r3(part.reduce((a, r) => a + r[key], 0) / n) : null, won: n ? r3(part.filter((r) => r[yKey] === 1).length / n) : null };
  });
}
function grade(rows, key, yKey, label, minN) {
  const src = { id: `${key}-${yKey}`, label, kind: "chance", rows: rows.filter((r) => fin(r[key]) && (r[yKey] === 0 || r[yKey] === 1)).map((r) => ({ p: r[key], y: r[yKey] })) };
  const s = scoreChance(src, { minN });
  return { n: s.n, verdict: s.verdict, read: s.read, stated: s.stated ?? (src.rows.length ? r3(src.rows.reduce((a, r) => a + r.p, 0) / src.rows.length) : null),
    rate: s.rate ?? (src.rows.length ? r3(src.rows.filter((r) => r.y === 1).length / src.rows.length) : null), brier: s.brier ?? null, skill: s.skill ?? null, buckets: bucketTable(rows, key, yKey) };
}
export function buildPopCheck(rows, { builtAtIso = null, minN = POP.checkMinN, recent = 40, enabled = true } = {}) {
  const all = rows || [];
  const groups = POP_GROUPS.map((g) => {
    const part = g.id === "all" ? all : all.filter((r) => r.g === g.id);
    const closed = part.filter((r) => r.y === 0 || r.y === 1);
    return { id: g.id, label: g.label, open: part.filter((r) => r.open).length, closed: closed.length,
      methods: POP_METHODS.map((m) => ({ id: m.id, label: m.label, ...grade(part, m.id, "y", `${g.label}: ${m.label}`, minN) })) };
  });
  const wb = all.filter((r) => r.wy === 0 || r.wy === 1);
  return {
    v: TRADE_POP_VERSION, builtAtIso, enabled, minN, stamped: all.length, open: all.filter((r) => r.open).length, closed: all.filter((r) => r.y === 0 || r.y === 1).length,
    groups,
    webull: { n: wb.length, ...grade(wb, "p", "wy", "Our estimate against the Webull fill", minN) },
    recent: all.filter((r) => !r.open).sort((a, b) => String(b.x || "").localeCompare(String(a.x || ""))).slice(0, recent)
      .map((r) => ({ id: r.id, g: r.g, sym: r.sym, side: r.side, eng: r.eng, setup: r.setup, p: r.p, m: r.m, r: r.r, y: r.y, pnl: r.pnl, wy: r.wy, at: r.at, x: r.x })),
    method: {
      paths: POP.paths, recordK: POP.recordK, historyCap: POP.historyCap,
      text: "Each trade's chance is set once, when it opens. The market model simulates the stock at the option's own implied volatility (no edge assumed) and runs the trade through its real exits; the track record is how often the same kind of trade has won before; our estimate blends them, leaning on the record as its sample grows. A trade counts as a win when the record closes it with a gain.",
    },
  };
}

// The Webull paper ledger's closed results, by trade ID: { pnl, state }.
// Only trades whose every filled contract or share was sold back carry a
// paper result (paperPnlPct), so a partly sold or still working trade is left out.
export function webullPopOutcomes(ledger) {
  const out = {};
  for (const t of Object.values(ledger?.trades || {})) {
    if (!t?.tradeId || !fin(num(t.paperPnlPct))) continue;
    out[String(t.tradeId)] = { pnl: Number(t.paperPnlPct), state: t.state || null };
  }
  return out;
}

// The Calibration lab's sources (Quant labs): our estimate on every closed
// Webull record trade, and the market model and the track record apart.
export function popLabSources(rows) {
  const closed = (rows || []).filter((r) => r.y === 0 || r.y === 1);
  const src = (key, id, label, note) => ({
    id, kind: "chance", label, where: "Open picks, Chance of profit", event: "The record closed the trade with a gain", note,
    rows: closed.filter((r) => fin(r[key])).map((r) => ({ p: r[key], y: r.y, t: String(r.at || "").slice(0, 10) })),
  });
  return [
    src("p", "trade-pop", "Webull trades: our chance of profit at entry", "Top Picks and strategy-engine trades sent to the Webull paper account; set once at entry."),
    src("m", "trade-pop-model", "Webull trades: market-model chance of profit", "Simulated at the option's own implied volatility through each trade's exits."),
    src("r", "trade-pop-record", "Webull trades: track-record chance of profit", "How often the same kind of trade had won before it opened."),
  ];
}
