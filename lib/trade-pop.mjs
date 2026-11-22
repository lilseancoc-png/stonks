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
// The stamp also carries `eg`, the expected gain under a forecast move
// (expectedGain, below).
//
// Nothing here changes which trades open, their size or their exits.
// Kill switch: Owner Settings TRADE_POP (off = no new stamps; stored stamps
// and the check stay). Pure: no network, no AI, no clock.

import { bsPrice, ncdf, expiryCloseEpochSec } from "./greeks.mjs";
import { scoreChance, scoreScore } from "./labs/calibration.mjs";
import { pickTradeId } from "./pick-trade-text.mjs";
import { isHoldPolicy } from "./top-picks-exit-review.mjs";

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
//
// Expected-gain inputs (expectedGain below; all optional, so the chance of
// profit above is unchanged without them): pathSigma (the stock's own path
// volatility, else sigma), move / moveSessions (a forecast: the stock's
// expected move in % over the first moveSessions sessions, signed in stock
// terms; the drift after them is the risk-free rate), ivShift / ivHalfLife
// (each leg's IV drifts by ivShift, half of it within ivHalfLife sessions),
// crn (draw every session of every path, so runs that differ only in the
// move share the same draws and their results can be compared).
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
  const pSig = num(input.pathSigma) > 0.01 && num(input.pathSigma) <= 5 ? Number(input.pathSigma) : sigma;
  const dt = 1 / POP.sessionsPerYear, drift = (r - (pSig * pSig) / 2) * dt, vol = pSig * Math.sqrt(dt);
  // A forecast move: the drift that makes the expected price after
  // moveSessions sessions equal spot x (1 + move / 100).
  const mv = num(input.move), mS = Math.max(0, Math.round(num(input.moveSessions) ?? horizon));
  const fDrift = mv != null && mv > -95 && mS > 0 ? Math.log(1 + mv / 100) / mS - (pSig * pSig * dt) / 2 : null;
  const ivShift = shares ? 0 : num(input.ivShift) ?? 0, ivHl = Math.max(1, num(input.ivHalfLife) ?? 20);
  const crn = !!input.crn;
  const z = normals(mulberry32(seedOf(input.id)));
  let wins = 0, sumPnl = 0, sumDown = 0, nTp = 0, nStop = 0, nTrail = 0, nSStop = 0, nSTarget = 0, nEnd = 0;
  // Short shares (a put-side twin) gain when the stock falls.
  const shareRet = (v) => (up ? v / S0 - 1 : 1 - v / S0) * 100 - costPct;
  const midPnl = (v) => (shares ? shareRet(v) : credit ? ((base + v) / base) * 100 : (v / base - 1) * 100);
  const legsAt = (k) => (ivShift ? legs.map((l) => ({ ...l, iv: Math.max(0.03, l.iv + ivShift * (1 - Math.pow(0.5, k / ivHl))) })) : legs);
  const bookedPnl = (v) => {
    if (shares) return shareRet(v);
    if (credit) { const buyBack = -v * (1 + haircut); return ((base * (2 - entryRatio) - buyBack) / base) * 100; }
    return ((v * (1 - haircut)) / (base * entryRatio) - 1) * 100;
  };
  // With crn the paths come in antithetic pairs (the second path of a pair
  // takes the first one's draws with the sign flipped), which steadies the
  // averages the expected-gain stamp compares.
  const draws = crn ? new Float64Array(horizon + 1) : null;
  for (let i = 0; i < paths; i++) {
    let S = S0, v = v0, how = "end", hi = 0, k = 1;
    const flip = crn && i % 2 === 1;
    if (crn && !flip) for (let j = 1; j <= horizon; j++) draws[j] = z();
    for (; k <= horizon; k++) {
      const e = crn ? (flip ? -draws[k] : draws[k]) : z();
      S *= Math.exp((fDrift != null && k <= mS ? fDrift : drift) + vol * e);
      v = shares ? S : legsValue(ivShift ? legsAt(k) : legs, S, Math.max(0, T0 - k * dt), r);
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
    if (b < 0) sumDown -= b;
    if (Math.round(b * 10) / 10 > 0) wins++;
    if (how === "tp") nTp++; else if (how === "stop") nStop++; else if (how === "trail") nTrail++; else if (how === "sstop") nSStop++; else if (how === "starget") nSTarget++; else nEnd++;
  }
  return { p: r3(wins / paths), paths, avg: r1(sumPnl / paths), ...(crn ? { avgX: sumPnl / paths, down: r2(sumDown / paths) } : {}), tp: r3(nTp / paths), stop: r3(nStop / paths), ...(nTrail ? { trail: r3(nTrail / paths) } : {}), sStop: r3(nSStop / paths), sTarget: r3(nSTarget / paths), end: r3(nEnd / paths) };
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
export function buildPopStamp({ id, at, model = null, record = [], basis = null, note = null, eg = null }) {
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
    ...(eg ? { eg } : {}),
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
export const compactPop = (pop) => (pop ? { v: pop.v, at: pop.at, p: pop.p, m: pop.m, r: pop.r, rn: pop.rn, w: pop.w, ...(pop.eg ? { eg: compactEg(pop.eg) } : {}), ...(pop.res ? { res: pop.res } : {}) } : null);
// The expected gain's headline numbers (archives, slim page rows).
export const compactEg = (eg) => (eg ? { v: eg.v, ev: eg.ev, ev0: eg.ev0, pop: eg.pop, hurdle: eg.hurdle, fc: eg.fc ? { move: eg.fc.move, sessions: eg.fc.sessions, n: eg.fc.n } : null, ...(eg.evUsd != null ? { evUsd: eg.evUsd } : {}), better: eg.better ?? null, ...(eg.twin ? { twin: { ev: eg.twin.ev } } : {}) } : null);
// An expected-gain stamp that never breaks the chance of profit beside it.
function safeEg(args) { try { return expectedGain(args); } catch { return null; } }

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
// pre-expiry exit day, YYYY-MM-DD), costUsd (the position's dollars, for the
// expected gain) }.
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
  const eg = ctx.expectedGain === false ? null : safeEg({ id: t.tradeId, model, forecast: engineForecast(t, { ...ctx, sessions: model.sessions }), path: pathVolOf(ctx.bars, model.sigma), iv: ivShiftOf(ctx.chain), costUsd: ctx.costUsd });
  return buildPopStamp({ id: t.tradeId, at: t.entryDate, model, record, basis: shares ? "shares" : model.entryRatio > 1 ? "ask in, bid out" : "mid", eg });
}

// --- Top Picks trades -------------------------------------------------------------------------
// One Top Picks record trade's stamp at enrollment. ctx: { exitPolicy
// ({ takeProfitPct, stopPct }, or the hold style), rfr, nowMs, setupOdds
// (oddsFor row: winPct, n, level, few), loopOdds (pick.loopOdds: pTp, n,
// learning), forecast (loopForecastFor), bars (daily closes), chain (the
// per-ticker chain, for ivRank) }.
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
  const toExpiry = T ? Math.max(1, Math.round(T * POP.sessionsPerYear)) : null;
  // The hold style (the 2026-11-22 flagship review, lib/top-picks-exit-review.mjs):
  // a fixed number of sessions with the premium stop only: no take-profit and
  // no stock stop (resolvePickOutcome in build.mjs). Credit spreads keep
  // today's exits.
  const hold = !credit && isHoldPolicy(ex);
  const holdN = hold ? Math.max(1, Math.round(num(ex.holdSessions) ?? 10)) : null;
  const model = {
    kind: "option", side: t.side, spot: num(t.entrySpot), sigma, sigmaFrom: "option IV", rfr: ctx.rfr, T, credit, legs,
    sessions: hold ? (toExpiry != null ? Math.min(holdN, toExpiry) : holdN) : toExpiry,
    horizonWhy: hold ? (toExpiry != null && toExpiry < holdN ? "expiry" : `held ${holdN} sessions`) : "expiry, no time stop",
    entryRatio: 1, exitHaircut: 0, tp: hold ? null : num(ex.takeProfitPct), stop: num(ex.stopPct), stockStop: hold ? null : num(t.cut), breakeven: num(c.breakeven),
  };
  const record = [];
  const lo = ctx.loopOdds;
  if (lo && !lo.learning && num(lo.pTp) != null && num(lo.n) > 0) record.push({ id: "loop", label: "Self-improving loop: +25% before -50%", p: Number(lo.pTp) / 100, n: Number(lo.n) });
  else {
    const so = ctx.setupOdds;
    if (so && num(so.winPct) != null && num(so.n) > 0) record.push({ id: "setup", label: `Similar past Top Picks (${String(so.level || "side").replace(/-/g, " + ")})`, p: Number(so.winPct) / 100, n: Number(so.n) });
  }
  const note = lo && lo.learning ? "The self-improving loop's chance is still learning (it reads a 50% prior), so it is not used yet." : null;
  // The expected gain: the loop's expected 10-session move (ctx.forecast,
  // loopForecastFor), zero with none. One contract at the mid.
  const mid = Math.abs(num(c.mid) ?? 0);
  const eg = ctx.expectedGain === false ? null : safeEg({ id: t.tradeId || pickTradeId(t), model,
    forecast: ctx.forecast || { move: 0, sessions: 10, n: 0, from: "no loop estimate: zero" },
    path: pathVolOf(ctx.bars, sigma), iv: ivShiftOf(ctx.chain), costUsd: mid > 0 ? mid * 100 : null });
  return buildPopStamp({ id: t.tradeId || pickTradeId(t), at: t.entryDate, model, record, basis: "mid (the record's own marks)", note, eg });
}

// --- expected gain ------------------------------------------------------------------------------
// The owner's question (2026-11-22): "if we are entering into an options
// strategy we should have a rough idea of what we could make." The chance of
// profit above assumes no edge, so its average result is only the cost of
// the vehicle. The expected-gain stamp runs the same simulation with a
// forecast instead:
//
//   forecast  the stock's expected move the trade's way over its horizon:
//             Top Picks = the self-improving loop's expected 10-session move
//             (em10, from rows resolved before the run); engines = the
//             setup's history-test share result plus the live and shadow
//             closes' stock moves, shrunk toward zero (EG.shrinkK). No data
//             = zero, and the stamp says so.
//   path vol  the stock's own trailing realized volatility (the 20- and
//             60-session average), else the option's IV. The option is still
//             priced at its own IV, so an IV above realized moves shows up as
//             a cost.
//   IV drift  each leg's IV drifts toward the stock's own IV-history mean,
//             half the gap within EG.ivHalfLife sessions; IV stays flat with
//             no history.
//
// Fields: ev (average booked result in % of the premium, under the forecast),
// evUsd (for one contract, or the trade's size when known), ev0 (the same with
// no move: the vehicle's cost), pop (chance of a gain under the forecast),
// hurdle (the move the trade's way, over the forecast's sessions, at which
// the average result is zero), twin (the same forecast on shares the same
// way, no option), better (option / shares / about even / neither, by the
// average result per dollar of average loss). Measure only: nothing here
// changes which trades open, their size or their exits.
export const EG_VERSION = 1;
export const EG = Object.freeze({
  paths: 2000,         // the forecast run
  hurdlePaths: 800,    // each step of the hurdle search
  hurdleSteps: 14,
  hurdleRange: [-25, 40],
  shrinkK: 20,         // forecast trades' weight n / (n + shrinkK)
  historyCap: 200,     // a history-test share average counts as at most this many trades
  historyMinN: 10,     // a history-test share average needs this many trades to count
  ivHalfLife: 20,      // sessions for half the IV gap to close
  twinCostPct: 0.1,    // the shares twin's round-trip cost
  evenBand: 0.05,      // result per dollar of loss closer than this = about even
});

// The stock's path volatility: the 20- and 60-session realized average.
export function pathVolOf(bars, fallbackIv = null) {
  const a = realizedVol(bars, 20), b = realizedVol(bars, 60);
  if (a != null && b != null) return { sigma: r3((a + b) / 2), from: "20- and 60-session realized" };
  if (a != null || b != null) return { sigma: a ?? b, from: a != null ? "20-session realized" : "60-session realized" };
  return num(fallbackIv) > 0.01 ? { sigma: r3(Number(fallbackIv)), from: "option IV (no price history)" } : null;
}

// The IV the legs drift toward: the stock's own ~18-month ATM IV mean
// (chain.ivRank.mean), moved by the gap between that mean and today's ATM IV.
export function ivShiftOf(chain) {
  const mean = num(chain?.ivRank?.mean), now = num(chain?.ivRank?.iv);
  if (!(mean > 0.03) || !(now > 0.03)) return { shift: 0, from: "flat (no IV history)" };
  return { shift: r3(mean - now), mean: r3(mean), now: r3(now), from: "toward its own IV mean" };
}

// Solve for the move (trade's way, %) at which the average result is zero.
function solveHurdle(run) {
  const [lo0, hi0] = EG.hurdleRange;
  let lo = lo0, hi = hi0;
  const fLo = run(lo, EG.hurdlePaths), fHi = run(hi, EG.hurdlePaths);
  if (fLo == null || fHi == null) return { hurdle: null, why: "no result" };
  if (fLo >= 0) return { hurdle: null, why: `pays even with a ${Math.abs(lo0)}% move against` };
  if (fHi <= 0) return { hurdle: null, why: `needs more than a ${hi0}% move` };
  for (let i = 0; i < EG.hurdleSteps; i++) {
    const mid = (lo + hi) / 2, f = run(mid, EG.hurdlePaths);
    if (f == null) return { hurdle: null, why: "no result" };
    if (f >= 0) hi = mid; else lo = mid;
  }
  return { hurdle: r2((lo + hi) / 2) };
}

// model: modelChance's input (as the chance-of-profit stamp builds it);
// forecast: { move (% the trade's way), sessions, from, n, learning, ref };
// path: pathVolOf(); iv: ivShiftOf(); costUsd: dollars put in (premium or
// shares) for evUsd.
export function expectedGain({ id, model, forecast, path = null, iv = null, costUsd = null } = {}) {
  if (!model || !forecast) return null;
  const dir = model.side === "put" ? -1 : 1;
  const H = Math.round(num(model.sessions) ?? 0);
  if (!(H >= 1)) return null;
  const fs = Math.max(1, Math.min(H, Math.round(num(forecast.sessions) ?? H)));
  const fc = clamp(num(forecast.move) ?? 0, -50, 100);
  const pathSigma = num(path?.sigma) ?? num(model.sigma);
  const shift = model.kind === "shares" ? 0 : num(iv?.shift) ?? 0;
  const base = { ...model, id, crn: true, pathSigma, ivShift: shift, ivHalfLife: EG.ivHalfLife, moveSessions: fs };
  const run = (m, paths) => modelChance({ ...base, move: dir * m }, { paths });
  const main = run(fc, EG.paths);
  if (!main) return null;
  const zero = run(0, EG.paths);
  const h = solveHurdle((m, paths) => run(m, paths)?.avgX ?? null);
  let twin = null;
  if (model.kind !== "shares") {
    const tBase = { id, kind: "shares", side: model.side, spot: model.spot, sigma: pathSigma, pathSigma, rfr: model.rfr, sessions: H, costPct: EG.twinCostPct,
      stockStop: model.stockStop, stockTarget: model.stockTarget, crn: true, moveSessions: fs };
    const tRun = (m, paths) => modelChance({ ...tBase, move: dir * m }, { paths });
    const t = tRun(fc, EG.paths);
    if (t) {
      const th = solveHurdle((m, paths) => tRun(m, paths)?.avgX ?? null);
      twin = { ev: t.avg, down: t.down, perRisk: t.down > 0 ? r2(t.avgX / t.down) : null, pop: t.p, hurdle: th.hurdle, ...(th.why ? { hurdleWhy: th.why } : {}) };
    }
  }
  const perRisk = main.down > 0 ? r2(main.avgX / main.down) : null;
  let better = null;
  if (twin) {
    if (main.avgX <= 0 && (twin.ev ?? 0) <= 0) better = "neither";
    else if (perRisk != null && twin.perRisk != null) better = Math.abs(perRisk - twin.perRisk) < EG.evenBand ? "about even" : perRisk > twin.perRisk ? "option" : "shares";
  }
  const usd = num(costUsd);
  const ivNow = model.kind === "shares" ? null : num(model.sigma);
  return {
    v: EG_VERSION,
    fc: { move: r2(fc), sessions: fs, from: forecast.from || null, n: num(forecast.n) ?? 0, ...(forecast.learning ? { learning: true } : {}), ...(forecast.ref ? { ref: forecast.ref } : {}) },
    vol: { path: r3(pathSigma), from: path?.from || "option IV", ...(ivNow != null ? { iv: r3(ivNow), gap: r3(ivNow - pathSigma) } : {}) },
    ...(model.kind !== "shares" ? { ivEnd: r3(Math.max(0.03, ivNow + shift * (1 - Math.pow(0.5, H / EG.ivHalfLife)))), ivFrom: iv?.from || "flat (no IV history)" } : {}),
    sessions: H, ev: main.avg, ev0: zero?.avg ?? null, pop: main.p, down: main.down, perRisk,
    ...(usd > 0 ? { costUsd: Math.round(usd), evUsd: Math.round((main.avgX / 100) * usd) } : {}),
    hurdle: h.hurdle, ...(h.why ? { hurdleWhy: h.why } : {}),
    twin, better, paths: main.paths,
  };
}

// --- forecasts ----------------------------------------------------------------------------------
// Engines: the setup's history-test share result (the share block, or the
// trials block for a paper trial; counted as at most EG.historyCap trades)
// pooled with the live and shadow closes' stock moves the trade's way, then
// shrunk toward zero by n / (n + EG.shrinkK). The option history-test average
// rides along as a reference (it was priced from a model, so it is not used).
//
// A core engine (Trend, Momentum: a monthly target held until it rotates) has
// no per-trade horizon to match a trade's average to, so its forecast is the
// history test's yearly portfolio growth (core.cagr) scaled to the stamp's
// sessions, shrunk the same way by its swaps. That test ran on today's list
// of names, so it flatters a stock basket (survivors only).
export function engineForecast(t, { research = null, closedLists = [], sessions = null } = {}) {
  const run = research?.learningOff?.engines?.[t?.engine] || research?.raw?.engines?.[t?.engine] || null;
  const core = run?.core && num(run.core.cagr) != null && t?.contract?.structure === "shares" && !t?.trial ? run.core : null;
  // A core engine's defensive holding (Treasuries, the safe asset) earned far
  // less than its main one: its share of the growth is its own per-trade
  // average over the engine's (0 to 1); fewer than EG.historyMinN trades of it
  // and it falls through to the live closes below.
  const cRow = core ? (run.shares?.bySetup || []).find((x) => x?.key === t.setup && num(x.avg) != null && num(x.n) >= EG.historyMinN) : null;
  const cAll = num(run?.shares?.avg);
  if (core && cRow && num(sessions) > 0) {
    const n = Math.min(num(core.swaps) ?? 0, EG.historyCap);
    const scale = cAll > 0 ? clamp(Number(cRow.avg) / cAll, 0, 1) : 1;
    const raw = (Math.pow(1 + (scale * Number(core.cagr)) / 100, Number(sessions) / POP.sessionsPerYear) - 1) * 100;
    return { move: r2((n / (n + EG.shrinkK)) * raw), sessions: Number(sessions), n, raw: r2(raw),
      from: `history test portfolio, ${r1(Number(core.cagr))}% a year since ${String(core.from || "").slice(0, 4) || "its start"}${scale < 0.995 ? ` (this holding's share ${Math.round(scale * 100)}%)` : ""}, over ${Number(sessions)} sessions (today's list of names, so survivors only)` };
  }
  const block = t?.trial ? run?.trials : run?.shares;
  const hRow = (block?.bySetup || []).find((s) => s?.key === t?.setup && num(s.avg) != null && num(s.n) >= EG.historyMinN) || null;
  const oRow = !t?.trial ? (run?.bySetup || []).find((s) => s?.key === t?.setup && num(s.avg) != null && num(s.n) > 0) || null : null;
  const dirOf = (side) => (side === "put" ? -1 : 1);
  let n = 0, sum = 0;
  const seen = new Set();
  for (const list of closedLists || []) for (const c of list || []) {
    if (!c || c.engine !== t.engine || c.setup !== t.setup || (c.side === "put") !== (t.side === "put") || c.counted === false || c.outcome === "void") continue;
    if (c.exitDate && t.entryDate && String(c.exitDate) > String(t.entryDate)) continue;
    const a = num(c.entrySpot), b = num(c.exitSpot ?? c.lastSpot);
    if (!(a > 0 && b > 0)) continue;
    const k = c.tradeId || `${c.symbol}|${c.side}|${c.entryDate}|${c.shadow ? "s" : ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    sum += dirOf(c.side) * (b / a - 1) * 100; n++;
  }
  const hn = hRow ? Math.min(Number(hRow.n), EG.historyCap) : 0;
  const N = hn + n;
  const raw = N ? (hn * (hRow ? Number(hRow.avg) : 0) + sum) / N : 0;
  const from = [hRow ? `history test shares (${Number(hRow.n)} trades)` : null, n ? `${n} live and shadow close${n === 1 ? "" : "s"}` : null].filter(Boolean).join(" + ") || "no record yet: zero";
  return {
    move: r2((N / (N + EG.shrinkK)) * raw), from, n: N, raw: r2(raw),
    ...(oRow ? { ref: { optAvg: num(oRow.avg), optN: num(oRow.n), note: "history-test option average, priced from a model" } } : {}),
  };
}

// Top Picks: the loop's estimate for this run's row (symbol and side), from
// the prediction ledger ({ keys, rows }). Returns the latest of the day.
export function loopForecastFor(ledger, { date, symbol, side, modelRows = null, minRows = 200 } = {}) {
  const keys = ledger?.keys, rows = ledger?.rows;
  if (!Array.isArray(keys) || !Array.isArray(rows)) return null;
  const I = Object.fromEntries(keys.map((k, i) => [k, i]));
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r[I.d] !== date) { if (String(r[I.d]) < String(date)) break; continue; }
    if (r[I.s] !== symbol || (r[I.side] === "put") !== (side === "put")) continue;
    const em = num(r[I.em10]);
    if (em == null) return null;
    const learning = modelRows != null && modelRows < minRows;
    return { move: em, sessions: 10, n: num(r[I.pn]) ?? 0, from: `self-improving loop, expected 10-session move (${num(r[I.pn]) ?? 0} similar rows)`, ...(learning ? { learning: true } : {}),
      ...(num(r[I.im10]) != null ? { ref: { implied10: num(r[I.im10]), note: "the options' implied 10-session move" } } : {}) };
  }
  return null;
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
      open: !s.res, wy: w && fin(num(w.pnl)) ? (Math.round(Number(w.pnl) * 10) / 10 > 0 ? 1 : 0) : null,
      ...(s.eg && fin(num(s.eg.ev)) ? { ev: num(s.eg.ev), ev0: num(s.eg.ev0), ep: num(s.eg.pop), hu: num(s.eg.hurdle), fm: num(s.eg.fc?.move), bv: s.eg.better || null } : {}) });
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
// The expected-gain check: what each closed trade was expected to make
// against what it made. Stated against booked P&L (both % of the money put
// in) overall, by group and in bands of the stated result; the ranking skill
// of the stated result on win / loss; the chance of a gain under the
// forecast, graded like the chance of profit.
export const EG_BANDS = Object.freeze([[-Infinity, -10], [-10, 0], [0, 10], [10, Infinity]]);
function spearman(xs, ys) {
  const rank = (a) => { const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const n = xs.length;
  if (n < 3) return null;
  const a = rank(xs), b = rank(ys), ma = (n - 1) / 2;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - ma); saa += (a[i] - ma) ** 2; sbb += (b[i] - ma) ** 2; }
  return saa > 0 && sbb > 0 ? r3(sab / Math.sqrt(saa * sbb)) : null;
}
export function buildEgCheck(rows, { minN = POP.checkMinN } = {}) {
  const has = (rows || []).filter((r) => fin(r.ev));
  const closed = has.filter((r) => (r.y === 0 || r.y === 1) && fin(r.pnl));
  const mean = (xs) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const read = (part) => ({ n: part.length, stated: mean(part.map((r) => r.ev)), noEdge: mean(part.filter((r) => fin(r.ev0)).map((r) => r.ev0)), made: mean(part.map((r) => r.pnl)),
    won: part.length ? r3(part.filter((r) => r.y === 1).length / part.length) : null });
  const groups = POP_GROUPS.map((g) => ({ id: g.id, label: g.label, ...read(g.id === "all" ? closed : closed.filter((r) => r.g === g.id)) }));
  const bands = EG_BANDS.map(([lo, hi]) => ({ lo: fin(lo) ? lo : null, hi: fin(hi) ? hi : null, ...read(closed.filter((r) => r.ev >= lo && r.ev < hi)) }));
  const rank = scoreScore({ id: "eg-rank", label: "Stated result against win or loss", rows: closed.map((r) => ({ s: r.ev, y: r.y })) }, { minN });
  const rho = closed.length >= minN ? spearman(closed.map((r) => r.ev), closed.map((r) => r.pnl)) : null;
  const pop = grade(has, "ep", "y", "Chance of a gain under the forecast", minN);
  const vehicle = ["option", "shares", "about even", "neither"].map((b) => ({ better: b, open: has.filter((r) => r.open && r.bv === b).length, closed: closed.filter((r) => r.bv === b).length }));
  const all = groups[0];
  let verdict = "few", text = `Only ${closed.length} closed trade${closed.length === 1 ? "" : "s"} with an expected gain so far; ${minN} are needed for a read.`;
  if (closed.length >= minN) {
    const gap = all.made - all.stated;
    verdict = Math.abs(gap) <= 5 ? "close" : gap > 0 ? "under" : "over";
    text = verdict === "close" ? `Close: trades were expected to make ${all.stated}% on average and made ${all.made}%.`
      : verdict === "over" ? `Too hopeful: trades were expected to make ${all.stated}% on average and made ${all.made}%.`
        : `Too cautious: trades were expected to make ${all.stated}% on average and made ${all.made}%.`;
  }
  return { n: has.length, open: has.filter((r) => r.open).length, closed: closed.length, verdict, text, groups, bands,
    rank: { auc: rank.auc ?? null, verdict: rank.verdict, read: rank.read, rho }, pop: { ...pop }, vehicle };
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
    eg: buildEgCheck(all, { minN }),
    recent: all.filter((r) => !r.open).sort((a, b) => String(b.x || "").localeCompare(String(a.x || ""))).slice(0, recent)
      .map((r) => ({ id: r.id, g: r.g, sym: r.sym, side: r.side, eng: r.eng, setup: r.setup, p: r.p, m: r.m, r: r.r, y: r.y, pnl: r.pnl, wy: r.wy, at: r.at, x: r.x, ...(fin(r.ev) ? { ev: r.ev } : {}) })),
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
  const eg = closed.filter((r) => fin(r.ev));
  return [
    src("p", "trade-pop", "Webull trades: our chance of profit at entry", "Top Picks and strategy-engine trades sent to the Webull paper account; set once at entry."),
    src("m", "trade-pop-model", "Webull trades: market-model chance of profit", "Simulated at the option's own implied volatility through each trade's exits."),
    src("r", "trade-pop-record", "Webull trades: track-record chance of profit", "How often the same kind of trade had won before it opened."),
    { id: "trade-eg", kind: "score", label: "Webull trades: expected gain at entry", where: "Open picks, Expected gain", event: "The record closed the trade with a gain",
      note: "The simulated average result under the forecast move, set once at entry; ranked against win or loss.",
      rows: eg.map((r) => ({ s: r.ev, y: r.y, t: String(r.at || "").slice(0, 10) })) },
    src("ep", "trade-eg-pop", "Webull trades: chance of a gain under the forecast", "The expected-gain run's share of paths that close with a gain (forecast drift, realized path volatility)."),
  ];
}
