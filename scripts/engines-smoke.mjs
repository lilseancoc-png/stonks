#!/usr/bin/env node
// Strategy engines smoke test (node scripts/engines-smoke.mjs). No network,
// no store, no AI: synthetic bars and option chains only.
//
// Covers: every evaluator on a crafted setup, the book (slots, run limits,
// exits, shadow trades, probation), the same-contract labels (engine vs
// engine, engine vs Top Picks, both directions), learning (brake, mute,
// lift), the build hook (load / run / write / carry, unreadable files), the
// page file, the history test, the switches and the Owner-only keys.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { ENGINES, ENGINE_IDS, BOOK, MACRO_ETFS, FLAGSHIP, CLOSE_LABEL, engineSwitches, engineByTag } from "../lib/engines/config.mjs";
import { precompute, featAt, toColumns, barDate } from "../lib/engines/features.mjs";
import { evalTechnicals, evalReversion, evalMacro, evalEarnings, evalFundamentals, evalFlow, thesisCheck } from "../lib/engines/signals.mjs";
import { stepBook, emptyRecord, emptyState, engineTradeId } from "../lib/engines/book.mjs";
import { pickContract, quoteContract, contractKey } from "../lib/engines/contracts.mjs";
import { newEngineState, observe, adapt, LEARN, learnView } from "../lib/engines/learn.mjs";
import { prepareReports, earnView, fundCore } from "../lib/engines/earn.mjs";
import { buildMacro } from "../lib/engines/macro.mjs";
import { engineStats, summarize, scoreBand } from "../lib/engines/record.mjs";
import { runBacktest, publicResult } from "../lib/engines/backtest.mjs";
import { loadEngineFiles, carryEngineFiles, writeEngineFiles, runEngines, buildEnginesView, flagshipCompare, enginesEnabled, ENGINES_RECORD_KEY, ENGINES_STATE_KEY, ENGINES_VIEW_KEY } from "../lib/engines/index.mjs";
import { isPremiumKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { OPTIONAL_BAKE_KEYS } from "../lib/data-ownership.mjs";
import { bsPrice } from "../lib/greeks.mjs";
import { pickTradeId } from "../lib/pick-trade-text.mjs";

let passed = 0;
const ok = (name, fn) => { try { fn(); passed++; } catch (err) { console.error(`FAIL ${name}\n  ${err?.stack || err}`); process.exitCode = 1; } };
const okAsync = async (name, fn) => { try { await fn(); passed++; } catch (err) { console.error(`FAIL ${name}\n  ${err?.stack || err}`); process.exitCode = 1; } };

// ---- synthetic data --------------------------------------------------------
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function weekdays(endDate, n) {
  const out = []; const d = new Date(endDate + "T12:00:00Z");
  while (out.length < n) { if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
  return out;
}
function walk(dates, { seed, start = 100, drift = 0.0004, vol = 0.015 }) {
  const r = rng(seed); let c = start; const bars = [];
  for (const t of dates) {
    const z = (r() + r() + r() + r() - 2) * 1.7, o = c * (1 + (r() - 0.5) * vol * 0.6);
    c = Math.max(1, c * (1 + drift + z * vol));
    const h = Math.max(o, c) * (1 + r() * vol * 0.5), l = Math.min(o, c) * (1 - r() * vol * 0.5);
    bars.push({ t, o, h, l, c, v: Math.round(1e6 * (0.6 + r() * 1.2)) });
  }
  return bars;
}
// An option chain priced with Black-Scholes around `spot`.
function chainFor(spot, nowMs, { iv = 0.35 } = {}) {
  const chains = {};
  for (const dte of [9, 16, 23, 30, 37, 44, 58, 72, 100, 128, 156, 191]) {
    const exp = Math.floor((nowMs + dte * 86400000) / 1000);
    const c = [], p = [];
    for (let k = 0.7; k <= 1.3001; k += 0.025) {
      const K = Math.round(spot * k * 2) / 2;
      for (const [type, col] of [["call", c], ["put", p]]) {
        const px = bsPrice(type, spot, K, dte / 365, iv, 0.045);
        if (!(px > 0.05)) continue;
        col.push({ s: K, b: +(px * 0.97).toFixed(2), a: +(px * 1.03).toFixed(2), l: +px.toFixed(2), iv, oi: 800, v: 60 });
      }
    }
    chains[exp] = { c, p };
  }
  return chains;
}
const END = "2026-11-13";           // last confirmed session (a Friday)
const TODAY = "2026-11-16";         // the first paper session
const NOW_AM = "2026-11-16T16:00:00.000Z";  // 11:00 ET
const NOW_PM = "2026-11-16T20:30:00.000Z";  // 15:30 ET
const DATES = weekdays(END, 520);

// A feature row that looks like a clean uptrend (a base for crafted setups).
function baseF(over = {}) {
  return {
    i: 400, date: END, c: 100, o: 99.5, h: 100.5, l: 99, v: 1.5e6, pc: 99,
    ret1: 0.01, ret3: 0.01, ret5: 0.02, ret10: 0.03, ret21: 0.05, ret63: 0.12, ret126: 0.25, ret252: 0.4,
    sma10: 99, sma20: 98, sma50: 94, sma100: 90, sma200: 85, sma50Prev: 93, sma200Prev: 84,
    sd20: 2, z20: 1, atr: 2, atrPct: 0.02, rsi14: 60, rsi2: 60, rsi2Min3: 50, rsi2Max3: 70,
    hi20p: 101, lo20p: 95, hi55p: 102, lo55p: 88, hi252: 103, lo252: 60, lo5: 97.5, hi5: 101,
    bbw: 0.08, bbwRank: 0.5, bbwRankPrev: 0.5, volRatio: 1, rv20: 0.3, rv60: 0.3,
    upStreak: 1, downStreak: 0, rangePos: 0.7, gap: 0.005, dayAtr: 0.5, move3Atr: 0.5, move5Atr: 1, distHi252: -0.03,
    ...over,
  };
}
const spyF = baseF({ c: 500, sma50: 480, ret63: 0.05 });
const CTX = { date: TODAY, spy: spyF, byId: {}, macro: null, env: { rates: "on hold", vix: "15-20" }, macroEvent: null, regime: { cell: "up-calm", era: "normal", stressed: false }, macroState: "neutral" };
const V = (sym, f, extra = {}) => ({ sym, isEtf: false, spot: f.c, f, ...extra });

// ---- config ----------------------------------------------------------------
ok("six engines, unique tags, every setup has a label", () => {
  assert.deepEqual(ENGINE_IDS, ["earnings", "macro", "technicals", "fundamentals", "flow", "reversion"]);
  const tags = ENGINE_IDS.map((id) => ENGINES[id].tag);
  assert.equal(new Set(tags).size, 6);
  assert.ok(!tags.includes(FLAGSHIP.tag));
  for (const id of ENGINE_IDS) {
    const e = ENGINES[id];
    assert.ok(e.slots >= 1 && e.perRun >= 1 && e.bar.min <= e.bar.base && e.bar.base <= e.bar.max, id);
    assert.ok(e.contract.dteMin < e.contract.dteIdeal && e.contract.dteIdeal < e.contract.dteMax, id);
    assert.ok(e.exits.tp > 0 && e.exits.stop < 0 && e.exits.maxSessions > 0, id);
    for (const [k, s] of Object.entries(e.setups)) assert.ok(s.label && s.how, `${id}.${k}`);
    assert.equal(engineByTag(e.tag).id, id);
  }
  // No two engines buy the same window and delta as each other by design.
  assert.equal(Object.values(ENGINES).flatMap((e) => Object.values(e.setups)).filter((s) => s.probation).length, 6);
});
ok("switches", () => {
  assert.deepEqual(engineSwitches({}).mode, "on");
  assert.equal(engineSwitches({ ENGINES: "pause" }).mode, "pause");
  for (const v of ["0", "off", "false", "no"]) assert.equal(engineSwitches({ ENGINES: v }).mode, "off");
  assert.deepEqual([...engineSwitches({ ENGINES_OFF: "flow, TEC,nope" }).off].sort(), ["flow", "technicals"]);
  assert.equal(enginesEnabled({ ENGINES: "0" }), false);
  assert.equal(enginesEnabled({}), true);
});
ok("the three files are Owner-only and optional bake keys", () => {
  for (const k of [ENGINES_RECORD_KEY, ENGINES_STATE_KEY, ENGINES_VIEW_KEY]) {
    assert.equal(isPremiumKey(k), true, k);
    assert.deepEqual(roleClaimForKey(k), ["tr", "tp"], k);
    assert.ok([...OPTIONAL_BAKE_KEYS].includes(k), k);
  }
});

// ---- features --------------------------------------------------------------
ok("bars: date strings and epochs both key by New York date; repeats dropped", () => {
  assert.equal(barDate("2026-11-13T00:00:00Z"), "2026-11-13");
  assert.equal(barDate(Date.parse("2026-11-13T14:30:00Z") / 1000), "2026-11-13");
  assert.equal(barDate(Date.parse("2026-11-13T14:30:00Z")), "2026-11-13");
  assert.equal(barDate(null), null);
  const S = toColumns([{ t: "2026-11-12", c: 10 }, { t: "2026-11-12", c: 11 }, { t: "2026-11-13", c: 12 }, { t: "2026-11-11", c: 9 }]);
  assert.deepEqual(S.t, ["2026-11-12", "2026-11-13"]);
});
ok("features need 60 bars and match a direct calculation", () => {
  const bars = walk(DATES, { seed: 3 });
  assert.equal(featAt(precompute(bars.slice(0, 50))), null);
  const P = precompute(bars), f = featAt(P);
  assert.equal(f.date, END);
  const closes = bars.map((b) => b.c);
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  assert.ok(Math.abs(f.sma20 - sma20) < 1e-9);
  assert.ok(Math.abs(f.hi55p - Math.max(...bars.slice(-56, -1).map((b) => b.h))) < 1e-9);
  assert.ok(Math.abs(f.ret5 - (closes.at(-1) / closes.at(-6) - 1)) < 1e-12);
});

// ---- evaluators ------------------------------------------------------------
ok("technicals: pullback call, breakdown put, nothing when chasing", () => {
  const pull = V("AAA", baseF({ rsi2Min3: 8, lo5: 98.2, c: 100, pc: 99, volRatio: 1.3 }));
  const c1 = evalTechnicals(pull, CTX);
  assert.equal(c1.length, 1); assert.equal(c1[0].setup, "pullback"); assert.equal(c1[0].side, "call");
  assert.ok(c1[0].score >= 60 && c1[0].stopLevel < 98.2 && c1[0].signalKey === `AAA|pullback|${END}`);
  // Today already ran 2 ATR: chasing, skipped.
  assert.equal(evalTechnicals({ ...pull, spot: 104.5 }, CTX).length, 0);
  const down = V("BBB", baseF({ c: 80, pc: 83, sma20: 88, sma50: 92, sma200: 96, sma50Prev: 93, ret126: -0.2, ret63: -0.1, lo55p: 81, dayAtr: -1.5, volRatio: 2, rangePos: 0.1, lo252: 80, hi5: 86, rsi2Max3: 30 }));
  const c2 = evalTechnicals(down, { ...CTX, spy: baseF({ c: 400, sma50: 420, ret63: -0.02 }) });
  assert.equal(c2.length, 1); assert.equal(c2[0].setup, "breakdown"); assert.equal(c2[0].side, "put");
});
ok("reversion: washout call; stands aside next to a report", () => {
  const f = baseF({ c: 90, pc: 93, sma20: 97, sma200: 85, sd20: 3, z20: -2.3, rsi2: 4, move5Atr: -3, downStreak: 4, rangePos: 0.6, l: 89 });
  const c = evalReversion(V("CCC", f), CTX);
  assert.equal(c.length, 1); assert.equal(c[0].setup, "oversold-bounce"); assert.equal(c[0].targetLevel, 97);
  assert.equal(evalReversion(V("CCC", f, { earn: { next: { sessionsUntil: 1 } } }), CTX).length, 0);
  assert.equal(evalReversion(V("CCC", f, { earn: { last: { sessionsSince: 0 } } }), CTX).length, 0);
  // An after-the-close report from the last finished session: today is the
  // reaction day, so the washout may be the report itself.
  assert.equal(evalReversion(V("CCC", f, { earn: { reacting: { date: END, session: "PM" }, last: { sessionsSince: 60 }, next: { sessionsUntil: 60 } } }), CTX).length, 0);
});
ok("earnings: drift after a beat that held; run-in closed before the report", () => {
  const f = baseF({ c: 108, pc: 107, sma50: 98 });
  const last = { date: "2026-11-11", session: "PM", surprisePct: 12, guidance: "raised", gapPct: 6, movePct: 7, low: 104, high: 109, close: 107, prevClose: 100, volRatio: 3, sessionsSince: 1, impliedPct: 5 };
  const hist = [1, 2, 3, 4].map(() => ({ movePct: 4, week1Pct: 2, pre10Pct: 3 }));
  const c = evalEarnings(V("DDD", f, { earn: { last, hist, next: null } }), CTX);
  assert.equal(c.length, 1); assert.equal(c[0].setup, "drift"); assert.equal(c[0].side, "call");
  assert.equal(c[0].signalKey, "DDD|drift|2026-11-11");
  assert.ok(c[0].reasons.some((r) => /bigger than the 5% options had priced/.test(r)));
  // A miss with a gap down that held: a put.
  const miss = evalEarnings(V("DDD", baseF({ c: 92, pc: 93, sma50: 98 }), { earn: { last: { ...last, surprisePct: -9, guidance: "soft", gapPct: -6, movePct: -7, low: 91, high: 95, close: 93 }, hist: [], next: null } }), CTX);
  assert.equal(miss[0]?.side, "put");
  // Run-in: 5 sessions before a report, rose into 4 of 4.
  const run = evalEarnings(V("EEE", baseF({}), { earn: { last: null, hist, next: { date: "2026-11-23", session: "PM", sessionsUntil: 5, exitBy: "2026-11-23" } }, live: { iv: { band: "normal" } } }), CTX);
  assert.equal(run.length, 1); assert.equal(run[0].setup, "run-in"); assert.equal(run[0].exitBy, "2026-11-23");
  // ... but not into very rich options.
  assert.equal(evalEarnings(V("EEE", baseF({}), { earn: { last: null, hist, next: { date: "2026-11-23", session: "PM", sessionsUntil: 5, exitBy: "2026-11-23" } }, live: { iv: { band: "very-rich" } } }), CTX).length, 0);
});
ok("fundamentals: compounder call reads live quality; nothing right before a report", () => {
  const core = { epsYoy: 30, epsYoyPrev: 20, beats4: 4, misses4: 0, reports: 9, lastDate: "2026-10-28", sessionsSince: 12 };
  const live = { fyEpsRevision: { pct30: 5 }, operatingMargin: 30, returnOnEquity: 35, revenueGrowthYoy: 18, freeCashFlow: 5e9, marketCap: 1e11, debtToEquity: 40, forwardPE: 22, targetMeanPrice: 125 };
  const c = evalFundamentals(V("FFF", baseF({}), { fund: { core, live, groupPE: 24 }, earn: { next: { sessionsUntil: 40 } } }), CTX);
  assert.equal(c.length, 1); assert.equal(c[0].setup, "compounder"); assert.ok(c[0].score >= 70);
  assert.ok(c[0].reasons.some((r) => /Forward P\/E 22 against 24/.test(r)));
  assert.equal(evalFundamentals(V("FFF", baseF({}), { fund: { core, live, groupPE: 24 }, earn: { next: { sessionsUntil: 3 } } }), CTX).length, 0);
  // Without the live block the replayable core alone still scores.
  assert.equal(evalFundamentals(V("FFF", baseF({}), { fund: { core } }), CTX)[0].facts.live, false);
});
ok("flow: aggressive call buying; short squeeze reads borrow and short-sale volume", () => {
  const flow = { nCall: 7, nPut: 1, callPrem: 1.2e6, putPrem: 1e5, persist: 0.4, gamma: 1, callWall: null, siPct: null, covering: false, rvol: 1.6, borrowTight: false, shortVolZ: null };
  const c = evalFlow(V("GGG", baseF({}), { spot: 100.6, live: { flow } }));
  assert.equal(c.length, 1); assert.equal(c[0].setup, "aggressive-flow"); assert.equal(c[0].side, "call");
  // The week's flow on the other side: no trade.
  assert.equal(evalFlow(V("GGG", baseF({}), { spot: 100.6, live: { flow: { ...flow, persist: -0.5 } } })).length, 0);
  const sq = evalFlow(V("HHH", baseF({ ret5: 0.09, volRatio: 2 }), { live: { flow: { nCall: 0, nPut: 0, callPrem: 0, putPrem: 0, siPct: 22, covering: true, borrowTight: true, shortVolZ: 2.1 } } }));
  assert.equal(sq[0].setup, "short-squeeze");
  assert.ok(sq[0].reasons.some((r) => /hard to borrow/.test(r)) && sq[0].reasons.some((r) => /Short-sale volume/.test(r)));
});
ok("macro: yields falling buys TLT calls; an event day is followed in QQQ", () => {
  const tlt = V("TLT", baseF({ c: 95, sma50: 92, sma200: 90, ret21: 0.04 }), { isEtf: true });
  const spy = V("SPY", spyF, { isEtf: true });
  const m = { y10Chg: -40, dffChg: -0.25, usdChgPct: 0, nfciChg: 0, vixRatio: 0.9, vix: 16 };
  const c = evalMacro({ ...CTX, macro: m, byId: { SPY: spy, TLT: tlt } });
  assert.ok(c.some((x) => x.symbol === "TLT" && x.setup === "rates-fall" && x.side === "call"));
  const qqq = V("QQQ", baseF({ dayAtr: 1.8, volRatio: 1.4 }), { isEtf: true });
  const ev = evalMacro({ ...CTX, macro: { ...m, y10Chg: 0 }, macroEvent: "fomc", byId: { SPY: spy, QQQ: qqq } });
  assert.ok(ev.some((x) => x.symbol === "QQQ" && x.setup === "event-drift"));
  assert.deepEqual(evalMacro({ ...CTX, macro: null }), []);
});
ok("thesis checks: a drift trade ends when price gives back the reaction day", () => {
  const t = { engine: "earnings", setup: "drift", side: "call", signalDate: "2026-11-11", entryDate: "2026-11-12T16:00:00Z" };
  assert.equal(thesisCheck(t, { spot: 99, earn: { last: { date: "2026-11-11", prevClose: 100 } } }), "signal-gone");
  assert.equal(thesisCheck(t, { spot: 103, earn: { last: { date: "2026-11-11", prevClose: 100 } } }), null);
});

// ---- earnings facts --------------------------------------------------------
ok("report list: store fractions become percent; reaction measured from bars", () => {
  const bars = walk(DATES, { seed: 11 });
  const P = precompute(bars), i = P.n - 1;
  const repDate = DATES[DATES.length - 4];
  const reps = prepareReports([{ date: "2019-01-30", session: "PM", epsActual: 1, epsEstimate: 0.9, movePct: 0.05, week1Pct: -0.02, pre10Pct: 0.03, impliedMovePct: 0.06 }, { date: repDate, session: "AM", epsActual: 2, epsEstimate: 1.6 }]);
  assert.equal(reps[0].movePct, 5); assert.equal(reps[0].week1Pct, -2); assert.equal(reps[0].impliedPct, 6);
  assert.ok(Math.abs(reps[1].surprisePct - 25) < 1e-9);
  const e = earnView(P, i, reps, { today: TODAY, next: { date: "2026-11-26", session: "AM" } });
  assert.equal(e.last.date, repDate); assert.equal(e.last.sessionsSince, 3);
  const r = P.S.t.indexOf(repDate);
  assert.ok(Math.abs(e.last.movePct - (P.S.c[r] / P.S.c[r - 1] - 1) * 100) < 1e-9);
  assert.equal(e.hist[0].stored, true);
  // Thanksgiving 2026 is Thursday Nov 26: a before-the-open report on Friday
  // Nov 27 must be exited by Wednesday Nov 25, not the holiday.
  const e2 = earnView(P, i, reps, { today: TODAY, next: { date: "2026-11-27", session: "AM" } });
  assert.equal(e2.next.exitBy, "2026-11-25");
  assert.equal(earnView(P, i, reps, { today: TODAY, next: { date: "2026-11-24", session: "PM" } }).next.exitBy, "2026-11-24");
  assert.equal(fundCore({ last: null, hist: [] }), null);
  // An after-the-close report dated on the last confirmed bar has no
  // reaction bar yet: it is `reacting`, not `last` and not `next`.
  const lastBar = DATES[DATES.length - 1];
  const pm = earnView(P, i, prepareReports([{ date: repDate, session: "AM", epsActual: 2, epsEstimate: 1.6 }, { date: lastBar, session: "PM", epsActual: 1, epsEstimate: 0.9 }]), { today: TODAY, next: { date: "2027-02-10", session: "PM" } });
  assert.deepEqual(pm.reacting, { date: lastBar, session: "PM" }); assert.equal(pm.last.date, repDate); assert.equal(pm.next.date, "2027-02-10");
  // A before-the-open report on that bar already has its reaction: `last`.
  const am = earnView(P, i, prepareReports([{ date: lastBar, session: "AM", epsActual: 1, epsEstimate: 0.9 }]), { today: TODAY });
  assert.equal(am.reacting, null); assert.equal(am.last.date, lastBar); assert.equal(am.last.sessionsSince, 0);
  assert.equal(e.reacting, null);
});
ok("macro factors respect publication lags", () => {
  // Daily series through Tuesday Nov 17: a Monday Nov 16 decision must read
  // Friday's 10-year yield, not Monday's own print and not Tuesday's.
  const dates = weekdays("2026-11-17", 300);
  const lib = buildMacro({ fred: { DGS10: dates.map((t, i) => ({ t, v: 4 + i * 0.001 })), CPIAUCSL: [{ t: "2025-08-01", v: 300 }, { t: "2026-08-01", v: 309 }, { t: "2026-10-01", v: 330 }] }, vix: dates.map((t, i) => ({ t, v: i === 298 ? 40 : 18 })), vix3m: dates.map((t) => ({ t, v: 20 })), events: [{ date: "2026-11-13", kind: "jobs" }, { date: "2026-11-13", kind: "cpi" }] });
  assert.equal(dates[297], "2026-11-13"); assert.equal(dates[298], TODAY);
  const f = lib.factors(TODAY);
  assert.ok(Math.abs(f.y10 - (4 + 297 * 0.001)) < 1e-9, "the 10-year read is Friday's");
  assert.ok(Math.abs(lib.factors("2026-11-10").cpiYoy - 3) < 1e-9, "October CPI is not public on Nov 10");
  assert.ok(Math.abs(f.cpiYoy - 10) < 1e-9, "and is public 45 days after its month starts");
  assert.equal(f.vix, 18, "today's own VIX close is not read");
  assert.equal(f.vixRatio, 0.9);
  assert.equal(lib.factors("2026-11-17").vix, 40);
  assert.equal(lib.eventOn("2026-11-13"), "jobs+cpi");
  assert.equal(lib.env("2026-11-10").inflation, "above target");
});

// ---- contracts -------------------------------------------------------------
const nowMs = Date.parse(NOW_AM);
ok("contract pick: each engine's own window and delta; liquidity and cost screens", () => {
  const data = { spot: 100, chains: chainFor(100, nowMs) };
  const seen = new Set();
  for (const id of ENGINE_IDS) {
    const c = pickContract(data, "call", ENGINES[id].contract, { nowMs });
    assert.ok(!c.skip, `${id}: ${c.skip}`);
    assert.ok(c.dte >= ENGINES[id].contract.dteMin && c.dte <= ENGINES[id].contract.dteMax, id);
    assert.ok(Math.abs(Math.abs(c.delta) - ENGINES[id].contract.delta) < 0.12, `${id} delta ${c.delta}`);
    assert.ok(c.mid >= BOOK.minMid && c.mid * 100 <= BOOK.maxCost && c.spreadPct <= BOOK.maxSpreadPct);
    seen.add(`${c.expiry}|${c.strike}`);
  }
  assert.ok(seen.size >= 4, "the engines do not all land on one contract");
  assert.match(pickContract({ spot: 100, chains: {} }, "call", ENGINES.flow.contract, { nowMs }).skip, /no expiry/);
  const wide = { spot: 100, chains: Object.fromEntries(Object.entries(chainFor(100, nowMs)).map(([e, v]) => [e, { c: v.c.map((r) => ({ ...r, b: r.l * 0.6, a: r.l * 1.4 })), p: v.p }])) };
  assert.match(pickContract(wide, "call", ENGINES.flow.contract, { nowMs }).skip, /thin or too wide/);
  assert.match(pickContract({ spot: 4000, chains: chainFor(4000, nowMs) }, "call", ENGINES.fundamentals.contract, { nowMs }).skip, /\$5,000 cap/);
  const c = pickContract(data, "put", ENGINES.reversion.contract, { nowMs });
  const q = quoteContract(data, c, { nowMs });
  assert.equal(q.source, "chain"); assert.equal(q.mid, c.mid);
  assert.equal(quoteContract({ spot: 100, chains: {} }, c, { nowMs }).source, "model");
  assert.equal(contractKey("AAA", c), `AAA|${c.expiry}|${c.strike}|P`);
});

// ---- the book --------------------------------------------------------------
const pullF = (over = {}) => baseF({ rsi2Min3: 8, lo5: 98.2, c: 100, pc: 99, volRatio: 1.3, ...over });
// One feature row that is both a Technicals pullback and a Reversion washout
// (not a real bar: the test needs two engines on one name).
const bothF = () => pullF({ rsi2: 4, z20: -2.3, move5Atr: -3, downStreak: 4, l: 99 });
function bookInput(views, { nowIso = NOW_AM, late = false, chains, flagshipOpen = [], ...rest } = {}) {
  const ms = Date.parse(nowIso);
  const data = chains || Object.fromEntries(Object.values(views).map((v) => [v.sym, { spot: v.spot, chains: chainFor(100, Date.parse(NOW_AM)) }]));
  return {
    nowIso, today: nowIso.slice(0, 10), late, views, ctx: { ...CTX, byId: views },
    quote: (t) => (data[t.symbol] ? quoteContract(data[t.symbol], t.contract, { nowMs: ms }) : null),
    pick: (view, side, spec) => pickContract(data[view.sym], side, spec.contract, { nowMs: ms }),
    flagshipOpen, coverage: null, ...rest,
  };
}
ok("book: opens inside slots and run limits, one trade per name per engine", () => {
  const seven = (prefix, date) => Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`${prefix}${n}`, V(`${prefix}${n}`, pullF({ date }))]));
  const views = seven("A", END);
  const state = emptyState(), record = emptyRecord();
  const out = stepBook(state, record, bookInput(views, { engines: ["technicals"] }));
  assert.equal(out.opened.length, ENGINES.technicals.perRun);
  // What the run limit turned away is tracked on paper, so the cap's cost is measured.
  assert.equal(out.shadowOpened, 7 - ENGINES.technicals.perRun);
  assert.ok(out.candidates.technicals.filter((c) => !c.taken).every((c) => /run limit \(tracked as a shadow trade\)/.test(c.why)));
  for (const t of out.opened) {
    assert.match(t.tradeId, /^TEC:A\d-C-11\/16\/26-11:00$/);
    assert.equal(t.contract.structure, "long"); assert.equal(t.engine, "technicals"); assert.equal(t.rulesVersion, "TEC-1");
    assert.deepEqual(t.regime, { cell: "up-calm" }); assert.equal(t.exits.tp, 30);
  }
  // The afternoon run sees the same confirmed bars: nothing is opened twice,
  // on the record or on the shadow book (one entry step a day, as in the history test).
  const out2 = stepBook(state, record, bookInput(views, { engines: ["technicals"], nowIso: NOW_PM, late: true }));
  assert.equal(out2.opened.length, 0); assert.equal(out2.shadowOpened, 0);
  assert.ok(out2.candidates.technicals.every((c) => /already (traded|tracked) this signal/.test(c.why)));
  // New signals on later days fill the slots, and no further.
  const out3 = stepBook(state, record, bookInput(seven("B", "2026-11-16"), { engines: ["technicals"], nowIso: "2026-11-17T16:00:00.000Z" }));
  assert.equal(out3.opened.length, ENGINES.technicals.perRun);
  const out4 = stepBook(state, record, bookInput(seven("C", "2026-11-17"), { engines: ["technicals"], nowIso: "2026-11-18T16:00:00.000Z" }));
  assert.equal(out4.opened.length, ENGINES.technicals.slots - 2 * ENGINES.technicals.perRun);
  assert.ok(out4.candidates.technicals.some((c) => /no free slot/.test(c.why || "")));
  assert.equal(record.open.length, ENGINES.technicals.slots);
  assert.equal(new Set(record.open.map((t) => t.symbol)).size, record.open.length);
  assert.equal(new Set(record.open.map((t) => t.tradeId)).size, record.open.length);
  assert.ok(state.engines.technicals.shadow.open.length <= BOOK.shadowOpenMax);
});
ok("book: the whole book opens at most five trades a run", () => {
  const views = {};
  for (let i = 0; i < 9; i++) views[`B${i}`] = V(`B${i}`, bothF());
  const state = emptyState(), record = emptyRecord();
  const out = stepBook(state, record, bookInput(views, { engines: ["technicals", "reversion"], maxTotal: 3 }));
  assert.equal(out.opened.length, 3);
});
ok("book: a setup ruled out by today's price move is listed, not traded and not tracked", () => {
  // AAA ran 4.5 ATR-ish above the last close: the pullback is there, the entry is not.
  const ran = { RAN1: { ...V("RAN1", pullF()), spot: 104.5 }, OK1: V("OK1", pullF()) };
  const state = emptyState(), record = emptyRecord();
  const out = stepBook(state, record, bookInput(ran, { engines: ["technicals"] }));
  const rows = out.candidates.technicals;
  const skip = rows.find((c) => c.symbol === "RAN1");
  assert.ok(skip && skip.skipped === "price" && skip.taken === false && skip.score === null && skip.setup === "pullback");
  assert.match(skip.why, /^price already ran \d+(\.\d+)? ATR its way today \(not chased\)$/);
  assert.equal(rows.indexOf(skip), rows.length - 1);            // after the scored rows
  assert.deepEqual(out.opened.map((t) => t.symbol), ["OK1"]);   // the other name still opens
  assert.equal(out.shadowOpened, 0);
  assert.ok(!Object.keys(state.engines.technicals.seen).some((k) => k.startsWith("RAN1|")));
  assert.equal(out.skippedPrice, 1);
  // The price comes back by the afternoon run: the same signal can still open.
  const out2 = stepBook(state, record, bookInput({ RAN1: V("RAN1", pullF()), OK1: V("OK1", pullF()) }, { engines: ["technicals"], nowIso: NOW_PM, late: true }));
  assert.deepEqual(out2.opened.map((t) => t.symbol), ["RAN1"]);
  // A move against the setup is named as such.
  const against = stepBook(emptyState(), emptyRecord(), bookInput({ AG1: { ...V("AG1", pullF()), spot: 97 } }, { engines: ["technicals"] }));
  assert.match(against.candidates.technicals[0].why, /^price moved \d+(\.\d+)? ATR against it today$/);
});
ok("book: the shared run limit is handed out in turns, and the first engine changes each run", () => {
  const mk = () => { const views = {}; for (let i = 0; i < 9; i++) views[`B${i}`] = V(`B${i}`, bothF()); return views; };
  const count = (out, id) => out.opened.filter((t) => t.engine === id).length;
  const two = ["technicals", "reversion"];
  // First run: Technicals goes first. One each, then Technicals takes the third.
  const a = emptyState();
  const outA = stepBook(a, emptyRecord(), bookInput(mk(), { engines: two, maxTotal: 3 }));
  assert.deepEqual(outA.order, two); assert.equal(a.turn, 0);
  assert.equal(count(outA, "technicals"), 2); assert.equal(count(outA, "reversion"), 1);
  // The next run starts with Reversion.
  const b = emptyState(); b.turn = 0;
  const outB = stepBook(b, emptyRecord(), bookInput(mk(), { engines: two, maxTotal: 3 }));
  assert.deepEqual(outB.order, ["reversion", "technicals"]); assert.equal(b.turn, 1);
  assert.equal(count(outB, "reversion"), 2); assert.equal(count(outB, "technicals"), 1);
  // With one slot left for the whole book, the engine whose turn it is gets it.
  const c = emptyState(); c.turn = 0;
  const outC = stepBook(c, emptyRecord(), bookInput(mk(), { engines: two, maxTotal: 1 }));
  assert.equal(outC.opened.length, 1); assert.equal(outC.opened[0].engine, "reversion");
  // The old order gave a two-trade limit to the first engine alone.
  const d = emptyState();
  const outD = stepBook(d, emptyRecord(), bookInput(mk(), { engines: two, maxTotal: 2 }));
  assert.equal(count(outD, "technicals"), 1); assert.equal(count(outD, "reversion"), 1);
  // A marks-only step does not use up a turn.
  const e = emptyState(); e.turn = 0;
  stepBook(e, emptyRecord(), bookInput(mk(), { engines: two, marksOnly: true }));
  assert.equal(e.turn, 0);
});
ok("book: take-profit, stop, time limit, event exit, expiry, left coverage", () => {
  const mk = (over = {}) => {
    const views = { AAA: V("AAA", pullF()) }, state = emptyState(), record = emptyRecord();
    stepBook(state, record, bookInput(views, { engines: ["technicals"] }));
    Object.assign(record.open[0], over);
    return { views, state, record };
  };
  const step = (x, spot, { nowIso = "2026-11-17T16:00:00.000Z", late = false, coverage = null, noChain = false } = {}) => {
    const views = { AAA: { ...x.views.AAA, spot } };
    const chains = noChain ? {} : { AAA: { spot, chains: chainFor(spot, Date.parse(nowIso)) } };
    return stepBook(x.state, x.record, bookInput(views, { engines: ["technicals"], nowIso, late, chains, coverage, mode: "pause" }));
  };
  let x = mk(); let out = step(x, 112);
  assert.equal(out.closed[0].status, "take-profit"); assert.equal(out.closed[0].outcome, "win"); assert.ok(out.closed[0].optionPnlPct >= 30);
  x = mk(); out = step(x, 90);
  assert.equal(out.closed[0].status, "stop"); assert.equal(out.closed[0].outcome, "loss");
  assert.equal(x.state.engines.technicals.cooldown.AAA, "2026-11-17");
  x = mk({ sessions: 14 }); out = step(x, 100.2);
  assert.equal(out.closed[0].status, "time");
  x = mk({ exitBy: "2026-11-17" }); out = step(x, 100.2);
  assert.equal(out.closed.length, 0, "the event exit waits for the afternoon run");
  out = step(x, 100.2, { nowIso: "2026-11-17T20:30:00.000Z", late: true });
  assert.equal(out.closed[0].status, "event-exit"); assert.equal(!!out.closed[0].exitLate, false);
  x = mk({ exitBy: "2026-11-17" }); out = step(x, 100.2, { nowIso: "2026-11-18T16:00:00.000Z" });
  assert.equal(out.closed[0].exitLate, true);
  x = mk({ stopLevel: 99 }); out = step(x, 98.5);
  assert.equal(out.closed[0].status, "stock-stop");
  x = mk(); out = step(x, 100, { coverage: new Set(["ZZZ"]) });
  assert.equal(out.closed[0].status, "left-coverage"); assert.equal(out.closed[0].outcome, "void");
  assert.equal(summarize(x.record.closed).n, 0, "a left-coverage close is not counted");
  // No chain this run: held. No chain after the last day: closed as expired.
  x = mk(); out = step(x, 100, { noChain: true });
  assert.equal(out.closed.length, 0);
  out = step(x, 100, { noChain: true, nowIso: new Date(x.record.open[0].contract.expiry * 1000 + 3 * 86400000).toISOString() });
  assert.equal(out.closed[0].status, "expired");
});
ok("book: pause opens nothing but still manages; an engine switched off opens nothing", () => {
  const views = { AAA: V("AAA", pullF()) };
  let state = emptyState(), record = emptyRecord();
  let out = stepBook(state, record, bookInput(views, { engines: ["technicals"], mode: "pause" }));
  assert.equal(out.opened.length, 0); assert.equal(out.shadowOpened, 0);
  assert.match(out.candidates.technicals[0].why, /paused by the owner/);
  out = stepBook(state, record, bookInput(views, { engines: ["technicals"], off: new Set(["technicals"]) }));
  assert.equal(out.opened.length, 0); assert.match(out.candidates.technicals[0].why, /switched off/);
});
ok("book: a setup that starts on shadow is tracked, not traded", () => {
  const f = baseF({ c: 92, pc: 93, sma20: 95, sma50: 97, sma200: 99, sma50Prev: 98, ret126: -0.2, ret63: -0.1, rsi2Max3: 92, hi5: 95.5, rangePos: 0.2 });
  const views = { RRR: V("RRR", f) };
  const state = emptyState(), record = emptyRecord();
  const out = stepBook(state, record, bookInput(views, { engines: ["technicals"], ctx: { ...CTX, spy: baseF({ c: 400, sma50: 420, ret63: 0 }) } }));
  assert.equal(out.opened.length, 0); assert.equal(out.shadowOpened, 1);
  assert.match(out.candidates.technicals[0].why, /on shadow until it proves itself/);
  assert.equal(state.engines.technicals.shadow.open[0].setup, "rally-fade");
  assert.equal(record.open.length, 0);
});

// ---- same-contract labels --------------------------------------------------
ok("same contract, two engines: the second is recorded, labeled, and not bought twice", () => {
  const views = { AAA: V("AAA", bothF()) };
  const state = emptyState(), record = emptyRecord();
  const input = bookInput(views, { engines: ["technicals", "reversion"] });
  const fixed = pickContract({ spot: 100, chains: chainFor(100, nowMs) }, "call", ENGINES.reversion.contract, { nowMs });
  input.pick = () => ({ ...fixed });
  const out = stepBook(state, record, input);
  assert.equal(out.opened.length, 2);
  const [tec, rev] = [record.open.find((t) => t.engine === "technicals"), record.open.find((t) => t.engine === "reversion")];
  assert.equal(!!tec.noMirror, false);
  assert.deepEqual(tec.sharedWith.map((x) => [x.engine, x.tradeId]), [["reversion", rev.tradeId]]);
  assert.equal(rev.noMirror, true);
  assert.equal(rev.shared.heldBy, "technicals"); assert.equal(rev.shared.heldById, tec.tradeId); assert.equal(rev.shared.role, "follower");
  assert.match(out.candidates.reversion[0].note, /Same contract is held by Technicals/);
  assert.notEqual(tec.tradeId, rev.tradeId);
  // Each engine keeps its own row and its own P&L.
  const view = buildEnginesView({ record, state, ctx: CTX, builtAtIso: NOW_AM });
  assert.equal(view.shared.length, 1);
  assert.equal(view.shared[0].heldBy.engine, "technicals");
  assert.deepEqual(view.shared[0].alsoOn.map((x) => x.engine), ["reversion"]);
});
ok("same contract as Top Picks: the engine trade is labeled held by Top Picks, and the other way round", () => {
  const fixed = pickContract({ spot: 100, chains: chainFor(100, nowMs) }, "call", ENGINES.technicals.contract, { nowMs });
  const flag = { symbol: "AAA", side: "call", entryDate: "2026-11-16T16:00:00.000Z", contract: { structure: "long", strike: fixed.strike, expiry: fixed.expiry, mid: fixed.mid } };
  const flagId = pickTradeId(flag);
  // Top Picks holds it first.
  let views = { AAA: V("AAA", pullF()) }, state = emptyState(), record = emptyRecord();
  let input = bookInput(views, { engines: ["technicals"], flagshipOpen: [{ tradeId: flagId, ...flag }] });
  input.pick = () => ({ ...fixed });
  stepBook(state, record, input);
  assert.equal(record.open[0].noMirror, true);
  assert.equal(record.open[0].shared.heldBy, "flagship"); assert.equal(record.open[0].shared.heldById, flagId);
  assert.deepEqual(record.flagshipShared[flagId].map((x) => [x.engine, x.engineRole]), [["technicals", "follower"]]);
  let view = buildEnginesView({ record, state, ctx: CTX, builtAtIso: NOW_AM });
  assert.equal(view.shared[0].heldBy.engine, "flagship");
  assert.equal(view.flagshipShared[flagId][0].tradeId, record.open[0].tradeId);
  // A debit spread on the same long strike is not the same contract.
  state = emptyState(); record = emptyRecord();
  input = bookInput(views, { engines: ["technicals"], flagshipOpen: [{ tradeId: flagId, ...flag, contract: { ...flag.contract, structure: "debit_vertical" } }] });
  input.pick = () => ({ ...fixed });
  stepBook(state, record, input);
  assert.equal(!!record.open[0].noMirror, false);
  // The engine holds it first; Top Picks opens it at a later run.
  state = emptyState(); record = emptyRecord();
  input = bookInput(views, { engines: ["technicals"] }); input.pick = () => ({ ...fixed });
  stepBook(state, record, input);
  assert.equal(!!record.open[0].noMirror, false);
  input = bookInput(views, { engines: ["technicals"], nowIso: NOW_PM, late: true, flagshipOpen: [{ tradeId: flagId, ...flag }] }); input.pick = () => ({ ...fixed });
  stepBook(state, record, input);
  assert.equal(!!record.open[0].noMirror, false, "the engine keeps the Webull position");
  assert.deepEqual(record.open[0].sharedWith.map((x) => x.engine), ["flagship"]);
  assert.deepEqual(record.flagshipShared[flagId].map((x) => x.engineRole), ["holder"]);
  view = buildEnginesView({ record, state, ctx: CTX, builtAtIso: NOW_PM });
  assert.equal(view.shared[0].heldBy.engine, "technicals");
  assert.deepEqual(view.shared[0].alsoOn.map((x) => x.engine), ["flagship"]);
  // The label goes away with the Top Picks trade.
  input = bookInput(views, { engines: ["technicals"], nowIso: "2026-11-17T16:00:00.000Z" }); input.pick = () => ({ ...fixed });
  stepBook(state, record, input);
  assert.deepEqual(record.flagshipShared, {});
});

// ---- learning --------------------------------------------------------------
const closedRow = (over = {}) => ({ engine: "technicals", symbol: "X", side: "call", setup: "pullback", score: 62, optionPnlPct: -40, status: "stop", outcome: "loss", entryDate: "2026-11-16T16:00:00Z", exitDate: "2026-11-17T16:00:00Z", regime: { cell: "up-calm" }, ...over });
ok("learning: five straight losses pause the engine for five sessions, then it resumes", () => {
  const spec = ENGINES.technicals, es = newEngineState(spec);
  for (let i = 0; i < 5; i++) observe(es, closedRow({ exitDate: `2026-11-${17 + i}T16:00:00Z` }));
  const ch = adapt(es, spec, { today: "2026-11-23" });
  assert.ok(es.paused && ch.some((c) => c.kind === "pause"), JSON.stringify(ch));
  assert.equal(es.v, 2);
  assert.ok(!adapt(es, spec, { today: "2026-11-24" }).some((c) => c.kind === "resume"));
  const later = adapt(es, spec, { today: "2026-12-02" });
  assert.equal(es.paused, null); assert.ok(later.some((c) => c.kind === "resume"));
});
ok("learning: a setup with a clearly losing record is moved to shadow; shadow wins bring it back", () => {
  const spec = ENGINES.technicals, es = newEngineState(spec);
  const r = rng(5);
  for (let i = 0; i < LEARN.setupN + 5; i++) observe(es, closedRow({ setup: "breakout", optionPnlPct: -30 + (r() - 0.5) * 30, exitDate: "2026-06-01T16:00:00Z", regime: { cell: i % 2 ? "up-calm" : "chop-calm" } }));
  es.paused = null;
  const ch = adapt(es, spec, { today: "2026-06-02", parts: { setups: true } });
  assert.ok(es.setups.breakout?.muted, JSON.stringify(ch));
  assert.ok(ch.some((c) => c.kind === "mute" && /breakout|Range breakout/.test(c.text)));
  // Not enough shadow evidence yet: still muted.
  for (let i = 0; i < 10; i++) observe(es, closedRow({ setup: "breakout", optionPnlPct: 30, outcome: "win", entryDate: "2026-07-10T16:00:00Z", exitDate: "2026-07-15T16:00:00Z" }), { shadow: true });
  adapt(es, spec, { today: "2026-08-03", parts: { setups: true } });
  assert.ok(es.setups.breakout.muted);
  for (let i = 0; i < LEARN.probationLiftN; i++) observe(es, closedRow({ setup: "breakout", optionPnlPct: 20 + (r() - 0.5) * 30, outcome: "win", entryDate: "2026-08-10T16:00:00Z", exitDate: "2026-08-15T16:00:00Z" }), { shadow: true });
  const lift = adapt(es, spec, { today: "2026-09-01", parts: { setups: true } });
  assert.ok(!es.setups.breakout?.muted, JSON.stringify(lift));
  const lv = learnView(es, spec);
  assert.ok(lv.log.length >= 2 && lv.rulesVersion === `TEC-${es.v}` && es.v >= 3);
  // Bounds: the bar never leaves [min, max].
  assert.ok(es.bar >= spec.bar.min && es.bar <= spec.bar.max);
});

// ---- record math -----------------------------------------------------------
ok("record: stats, splits and the dollar curve", () => {
  const rows = [closedRow({ optionPnlPct: 30, outcome: "win", status: "take-profit", contract: { mid: 2 }, env: { rates: "cutting" } }), closedRow({ contract: { mid: 3 }, env: { rates: "cutting" } }), closedRow({ status: "left-coverage", outcome: "void", optionPnlPct: -5, contract: { mid: 1 } })];
  const s = engineStats(rows);
  assert.equal(s.n, 2); assert.equal(s.wins, 1); assert.equal(s.winRate, 0.5); assert.equal(s.avg, -5);
  assert.equal(s.usd, 60 - 120);
  assert.equal(s.bySetup[0].key, "pullback"); assert.equal(s.byEnv.rates[0].key, "cutting"); assert.equal(s.byScore[0].key, "60-64");
  assert.equal(scoreBand(79), "75-79");
  assert.equal(s.curve.at(-1)[1], -60);
});

// ---- the history test ------------------------------------------------------
// Bars run through Nov 25 so the build-hook test can walk eight sessions of runs.
const SERIES = {}, SERIES_DATES = weekdays("2026-11-25", 528);
{
  let seed = 100;
  for (const s of MACRO_ETFS) SERIES[s] = walk(SERIES_DATES, { seed: seed++, start: 100 + seed, drift: 0.0003, vol: 0.011 });
  for (let i = 0; i < 24; i++) SERIES[`S${String(i).padStart(2, "0")}`] = walk(SERIES_DATES, { seed: seed++, start: 40 + i * 7, drift: (i % 5 - 1.5) * 0.0004, vol: 0.014 + (i % 4) * 0.004 });
}
ok("history test: runs, is repeatable, and learning off / raw / on are separate passes", () => {
  const base = { series: SERIES, isEtf: (s) => MACRO_ETFS.includes(s), from: SERIES_DATES[230], engines: ["technicals", "reversion"], control: 4 };
  const a = runBacktest(base), b = runBacktest(base);
  assert.deepEqual(a.engines.technicals.n, b.engines.technicals.n);
  assert.equal(a.engines.technicals.avg, b.engines.technicals.avg);
  assert.ok(a.engines.technicals.n + a.engines.reversion.n > 10, "the synthetic tape produces trades");
  const raw = runBacktest({ ...base, raw: true });
  assert.ok(raw.engines.technicals.n >= a.engines.technicals.n, "raw trades every setup");
  const pub = publicResult(a);
  assert.ok(!JSON.stringify(pub).includes("tradeId"), "the public copy has no trade rows");
  assert.ok(Array.isArray(pub.engines.technicals.bySetup) && pub.engines.technicals.curve);
});

// ---- the build hook --------------------------------------------------------
function fixture(nowIso, { tweak = null } = {}) {
  const ms = Date.parse(nowIso), today = nowIso.slice(0, 10);
  const chains = {};
  const tickers = Object.keys(SERIES).filter((s) => !MACRO_ETFS.includes(s)).concat(["SPY", "QQQ"]);
  for (const [sym, bars] of Object.entries(SERIES)) {
    const conf = bars.filter((b) => b.t < today), last = conf.at(-1);
    const spot = last.c * 1.002;
    chains[sym] = {
      spot, marketState: "REGULAR", chains: chainFor(spot, ms, { iv: 0.3 }), _patternBars: [...conf, { t: today, o: spot, h: spot, l: spot, c: spot, v: 1 }],
      ivRank: { pctile: 55, iv: 0.3 }, technicals: { volRegime: { rv30: 0.25 }, volume: { rvol: 1.1 } },
      fundamentals: MACRO_ETFS.includes(sym) ? null : { forwardPE: 20 + (sym.charCodeAt(2) % 7), operatingMargin: 22, returnOnEquity: 25, revenueGrowthYoy: 12, marketCap: 5e10, freeCashFlow: 2e9, debtToEquity: 60, shortPercentOfFloat: 4 },
    };
  }
  const earningsStore = { tickers: {} };
  for (const sym of tickers) {
    if (MACRO_ETFS.includes(sym)) continue;
    const events = [];
    for (let q = 7; q >= 0; q--) { const d = DATES[DATES.length - 12 - q * 63]; if (d) events.push({ date: d, session: q % 2 ? "AM" : "PM", epsActual: 1 + (8 - q) * 0.15, epsEstimate: 1 + (8 - q) * 0.13 }); }
    earningsStore.tickers[sym] = { events };
  }
  const fredDates = weekdays(today, 420);
  const input = {
    builtAtIso: nowIso, chains, tickers, isEtf: (s) => MACRO_ETFS.includes(s), barsOf: (s) => chains[s]?._patternBars || [],
    earningsStore, groupOf: (s) => (MACRO_ETFS.includes(s) ? "ETF" : `g${s.charCodeAt(2) % 3}`),
    unusual: { tickers: [{ symbol: "S03", contracts: Array.from({ length: 6 }, () => ({ side: "call", tape: "ask", flagged: true, premium: 200000 })) }] },
    crowdRollup: [{ symbol: "S03", shortZ20: 1.8, borrowFeePct: 9 }],
    fred: { DGS10: fredDates.map((t, i) => ({ t, v: 4.6 - i * 0.002 })), DGS2: fredDates.map((t) => ({ t, v: 4 })), T10Y2Y: fredDates.map((t) => ({ t, v: 0.4 })), DFF: fredDates.map((t) => ({ t, v: 4.3 })), NFCI: fredDates.filter((_, i) => i % 5 === 0).map((t) => ({ t, v: -0.3 })), DTWEXBGS: fredDates.map((t) => ({ t, v: 120 })), CPIAUCSL: [{ t: "2025-09-01", v: 300 }, { t: "2026-09-01", v: 309 }], UNRATE: [{ t: "2026-09-01", v: 4.2 }], USREC: [{ t: "2026-09-01", v: 0 }] },
    vix: fredDates.map((t) => ({ t, v: 17 })), vix3m: fredDates.map((t) => ({ t, v: 19 })),
    macroEvents: [{ date: END, kind: "jobs" }],
    regime: { cell: "up-calm", era: "normal" }, labelRows: DATES.map((date) => ({ date, cell: "up-calm", era: "normal" })), macroState: "neutral",
    flagshipOpen: [], flagshipStats: null, env: {},
    research: { version: "engines-backtest-1", generatedAt: "2026-11-15", data: { from: "2007-01-03" }, notes: ["note"], engines: ["technicals"], raw: { engines: { technicals: { n: 1 } } }, learningOff: { engines: { technicals: { n: 2 } } }, learningOn: { engines: { technicals: { n: 3 } } } },
  };
  if (tweak) tweak(input);
  return input;
}
await okAsync("hook: a fresh start, a run, the three files, a second run, and a verbatim carry", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engines-smoke-"));
  let loaded = await loadEngineFiles(dir);
  assert.equal(loaded.fresh, true); assert.equal(loaded.skip, false);
  assert.equal(await carryEngineFiles(dir, loaded), 0);
  // Walk a few days of runs so something opens and closes.
  let opened = 0, closed = 0, runs = 0, lastView = null;
  const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25"];
  for (const day of days) for (const hhmm of ["16:00", "20:30"]) {
    loaded = await loadEngineFiles(dir);
    assert.equal(loaded.skip, false);
    const res = runEngines({ loaded, ...fixture(`${day}T${hhmm}:00.000Z`) });
    await writeEngineFiles(dir, res);
    opened += res.summary.opened; closed += res.summary.closed; runs++; lastView = res.view;
    assert.ok(res.summary.opened <= BOOK.perRunTotal);
    assert.deepEqual(res.summary.errors, []);
    for (const id of ENGINE_IDS) assert.ok(res.record.open.filter((t) => t.engine === id).length <= ENGINES[id].slots, id);
    assert.equal(res.summary.late, hhmm === "20:30");
  }
  assert.ok(opened >= 3, `opened ${opened}`);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, ENGINES_RECORD_KEY), "utf8"));
  const st = JSON.parse(fs.readFileSync(path.join(dir, ENGINES_STATE_KEY), "utf8"));
  const view = JSON.parse(fs.readFileSync(path.join(dir, ENGINES_VIEW_KEY), "utf8"));
  assert.equal(rec.open.length + rec.closed.length, opened);
  assert.equal(rec.closed.length, closed);
  const ids = [...rec.open, ...rec.closed].map((t) => t.tradeId);
  assert.equal(new Set(ids).size, ids.length, "trade IDs are unique");
  for (const t of [...rec.open, ...rec.closed]) {
    // Everything the Webull mirror reads from a record row.
    assert.ok(t.engine && ENGINES[t.engine] && t.tradeId.startsWith(`${ENGINES[t.engine].tag}:`));
    assert.ok(t.symbol && (t.side === "call" || t.side === "put") && t.entryDate);
    assert.equal(t.contract.structure, "long"); assert.ok(t.contract.strike > 0 && t.contract.expiry > 0 && t.contract.mid > 0);
    assert.ok(t.env && "rates" in t.env, "macro backdrop tags are on every trade");
    assert.equal(t.regime.cell, "up-calm");
  }
  for (const t of rec.closed) { assert.ok(t.exitDate && CLOSE_LABEL[t.status], t.status); assert.ok(["win", "loss", "flat", "void"].includes(t.outcome)); }
  assert.equal(st.runs.length, runs);
  assert.ok(st.replay && st.replay.date === "2026-11-25" && !st.replay.error, JSON.stringify(st.replay).slice(0, 200));
  // The page file.
  assert.equal(view.engines.length, 6);
  assert.deepEqual(view.engines.map((e) => e.id), ENGINE_IDS);
  assert.equal(view.engines.reduce((a, e) => a + e.open.length, 0), rec.open.length);
  assert.equal(view.compare.length, 6);
  assert.equal(view.engines.find((e) => e.id === "technicals").history.live.n, 3);
  assert.ok(view.engines.find((e) => e.id === "technicals").replay?.held, "the recent replay is on the page");
  assert.equal(view.engines.find((e) => e.id === "flow").replay?.held ?? null, null, "Flow has no replay");
  assert.equal(view.engines.find((e) => e.id === "technicals").setups.find((s) => s.key === "rally-fade").state, "shadow");
  assert.equal(view.market.regime.cell, "up-calm"); assert.equal(view.market.env.rates, "on hold");
  assert.equal(view.health.views, Object.keys(SERIES).length);
  assert.equal(lastView.runIso, "2026-11-25T20:30:00.000Z");
  // Confirmed bars only: today's partial bar never reaches a feature row.
  for (const t of [...rec.open, ...rec.closed]) assert.ok(String(t.signalDate).replace("pre-", "") !== String(t.entryDate).slice(0, 10) || t.engine === "earnings");
  // A bake that is not a decision run re-writes the files byte for byte.
  const before = [ENGINES_RECORD_KEY, ENGINES_STATE_KEY, ENGINES_VIEW_KEY].map((k) => fs.readFileSync(path.join(dir, k), "utf8"));
  loaded = await loadEngineFiles(dir);
  for (const k of [ENGINES_RECORD_KEY, ENGINES_STATE_KEY, ENGINES_VIEW_KEY]) fs.rmSync(path.join(dir, k));
  assert.equal(await carryEngineFiles(dir, loaded), 3);
  assert.deepEqual([ENGINES_RECORD_KEY, ENGINES_STATE_KEY, ENGINES_VIEW_KEY].map((k) => fs.readFileSync(path.join(dir, k), "utf8")), before);
  // An unreadable record skips the engines and is never replaced by an empty one.
  fs.writeFileSync(path.join(dir, ENGINES_RECORD_KEY), "{not json");
  loaded = await loadEngineFiles(dir);
  assert.equal(loaded.skip, true); assert.equal(loaded.record, null); assert.match(loaded.error, /engines-record\.json/);
  fs.writeFileSync(path.join(dir, ENGINES_RECORD_KEY), JSON.stringify({ open: "x" }));
  assert.equal((await loadEngineFiles(dir)).skip, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
ok("hook: Top Picks' open contract is seen; pause opens nothing; a name with no chain is skipped", () => {
  const loaded = { record: emptyRecord(), state: emptyState() };
  const res = runEngines({ loaded, ...fixture(NOW_AM, { tweak: (x) => { x.env = { ENGINES: "pause" }; delete x.chains.S05; } }) });
  assert.equal(res.summary.opened, 0); assert.equal(res.summary.mode, "pause");
  assert.ok(res.view.health.noChain.includes("S05"));
  assert.equal(res.view.mode, "pause");
  const off = runEngines({ loaded: { record: emptyRecord(), state: emptyState() }, ...fixture(NOW_AM, { tweak: (x) => { x.env = { ENGINES_OFF: ENGINE_IDS.join(",") }; } }) });
  assert.equal(off.summary.opened, 0);
  assert.ok(off.view.engines.every((e) => e.switchedOff));
});
ok("hook: stale bars are not traded", () => {
  const res = runEngines({ loaded: { record: emptyRecord(), state: emptyState() }, ...fixture("2026-12-09T16:00:00.000Z") });
  assert.equal(res.view.health.views, 0);
  assert.equal(res.view.health.staleBars.length, Object.keys(SERIES).length);
  assert.equal(res.summary.opened, 0);
});
ok("hook: a build outside market hours marks and opens nothing", () => {
  // Saturday, Thanksgiving, before the open, after the close, after a 13:00 half-day close.
  for (const iso of ["2026-11-21T16:00:00.000Z", "2026-11-26T16:00:00.000Z", "2026-11-16T13:00:00.000Z", "2026-11-16T21:05:00.000Z", "2026-11-27T18:30:00.000Z"]) {
    const loaded = { record: emptyRecord(), state: emptyState() };
    loaded.record.open.push({ engine: "technicals", symbol: "S01", side: "call", sessions: 2, contract: { strike: 100, expiry: 1900000000, mid: 5, optionType: "call" } });
    const res = runEngines({ loaded, ...fixture(iso) });
    assert.ok(res.skipped, iso);
    assert.equal(res.record, undefined);
    // Nothing was touched: the build re-writes the stored files as they were.
    assert.equal(loaded.record.open.length, 1); assert.equal(loaded.record.open[0].sessions, 2); assert.deepEqual(loaded.state, emptyState());
  }
  // The half day's morning run still acts.
  assert.ok(!runEngines({ loaded: { record: emptyRecord(), state: emptyState() }, ...fixture("2026-11-27T16:00:00.000Z") }).skipped);
});
ok("flagship comparison row", () => {
  assert.equal(flagshipCompare(null), null);
  const f = flagshipCompare({ open: [{}, {}], closed: [{ optionPnlPct: 25, outcome: "win" }, { optionPnlPct: -50, outcome: "loss" }, { optionPnlPct: 5, outcome: "void" }] });
  assert.deepEqual(f, { id: "flagship", name: "Top Picks", open: 2, n: 2, winRate: 0.5, avg: -12.5 });
});
ok("trade IDs carry the engine tag and the ET entry time", () => {
  assert.equal(engineTradeId("MAC", "TLT", "put", "2026-11-16T20:30:00.000Z"), "MAC:TLT-P-11/16/26-15:30");
});

console.log(`${passed} engine checks passed${process.exitCode ? " (with failures)" : ""}`);
