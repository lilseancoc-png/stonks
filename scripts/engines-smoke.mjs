#!/usr/bin/env node
// Strategy engines smoke test (node scripts/engines-smoke.mjs). No network,
// no store, no AI: synthetic bars and option chains only.
//
// Covers: every evaluator on a crafted setup, the book (slots, run limits,
// exits, shadow trades, probation), the same-contract labels (engine vs
// engine, engine vs Top Picks, both directions), learning (brake, mute,
// lift), the build hook (load / run / write / carry, unreadable files), the
// page file, the history test, the switches and the Owner-only keys.
import { markPrice } from "../lib/pick-trade-text.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { ENGINES, ENGINE_IDS, SIGNAL_IDS, CORE_IDS, BOOK, MACRO_ETFS, FLAGSHIP, CLOSE_LABEL, ENGINE_FIXES, ENGINE_FIX_IDS, ENGINE_TRIALS, ENGINE_TRIAL_IDS, engineSwitches, engineSpecs, engineByTag, engineName, instrumentFor, isSharesTrade, contractFor, exitsFor } from "../lib/engines/config.mjs";
import { precompute, featAt, toColumns, barDate, monthEnds } from "../lib/engines/features.mjs";
import { trendRead, momentumRead, rotationRead, standCore, ret12, ret12skip1, avg10 } from "../lib/engines/core.mjs";
import { ALLOC, allocObserve, allocDecide, allocKey, allocStamp, allocBook, allocPriorFrom, allocView, emptyAlloc } from "../lib/engines/allocator.mjs";
import { evalTechnicals, evalReversion, evalMacro, evalEarnings, evalFundamentals, evalFlow, thesisCheck } from "../lib/engines/signals.mjs";
import { stepBook, emptyRecord, emptyState, engineTradeId } from "../lib/engines/book.mjs";
import { pickContract, quoteContract, contractKey, sharesContract, positionUsd, optionQty, contractsOf, exitFill, sizeOption, sizeShares, convictionRead, entryPxOf, flatPositionUsd } from "../lib/engines/contracts.mjs";
import { SIZE_WEIGHTS } from "../lib/engines/config.mjs";
import { isRetiredCand, fearRead } from "../lib/engines/signals.mjs";
import { newEngineState, observe, adapt, adoptRules, LEARN, learnView } from "../lib/engines/learn.mjs";
import { standRank, rankView, RANK } from "../lib/engines/rank.mjs";
import { prepareReports, earnView, fundCore } from "../lib/engines/earn.mjs";
import { buildMacro, fearReading } from "../lib/engines/macro.mjs";
import { engineStats, summarize, scoreBand, tradeUsd, flatTradeUsd } from "../lib/engines/record.mjs";
import { runBacktest, publicResult } from "../lib/engines/backtest.mjs";
import { loadEngineFiles, carryEngineFiles, writeEngineFiles, runEngines, buildEngineViews, buildEnginesView, flagshipCompare, enginesEnabled, liveVsHistory, LIVE_VS_HISTORY, ENGINES_RECORD_KEY, ENGINES_STATE_KEY, ENGINES_VIEW_KEY, fearGreedCtx, sizingCompare, SIZE_READ_MIN } from "../lib/engines/index.mjs";
import { isPremiumKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { DIAL } from "../lib/owner-controls.mjs";
import { ownerSettingDef } from "../lib/owner-settings.mjs";
import { newTrade } from "../lib/webull-mirror.mjs";
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
// The rules under the live data pack and the newer paper trials (2026-11-20),
// which sit on top of everything else: the older checks read what is under them.
const peel = (r) => { while (r && r.before && /\|(live|trials2):[^|]*$/.test(r.key || "") && (r.n || 1) > (r.before.n || 1)) r = r.before; return r; };
ok("nine engines (six signal, three core), unique tags, every setup has a label", () => {
  assert.deepEqual(ENGINE_IDS, ["earnings", "macro", "technicals", "fundamentals", "flow", "reversion", "trend", "momentum", "rotation"]);
  assert.deepEqual(SIGNAL_IDS, ["earnings", "macro", "technicals", "fundamentals", "flow", "reversion"]);
  assert.deepEqual(CORE_IDS, ["trend", "momentum", "rotation"]);
  const tags = ENGINE_IDS.map((id) => ENGINES[id].tag);
  assert.equal(new Set(tags).size, 9);
  assert.ok(!tags.includes(FLAGSHIP.tag));
  for (const id of ENGINE_IDS) {
    const e = ENGINES[id];
    assert.ok(e.slots >= 1 && e.perRun >= 1 && e.bar.min <= e.bar.base && e.bar.base <= e.bar.max, id);
    for (const [k, s] of Object.entries(e.setups)) assert.ok(s.label && s.how, `${id}.${k}`);
    assert.equal(engineByTag(e.tag).id, id);
    if (e.core) {
      // A core engine: long stock only, its own lot, no stops or targets.
      assert.ok(e.standing && e.lotUsd > 0 && !Object.keys(e.exits).length, id);
      assert.ok(Object.values(e.setups).every((s) => s.calls === "shares"), id);
      assert.equal(instrumentFor(e, Object.keys(e.setups)[0], "call", { shares: false }), "shares", "ENGINES_SHARES=0 leaves the core engines on shares");
      continue;
    }
    assert.ok(e.contract.dteMin < e.contract.dteIdeal && e.contract.dteIdeal < e.contract.dteMax, id);
    assert.ok(e.exits.tp > 0 && e.exits.stop < 0 && e.exits.maxSessions > 0, id);
  }
  assert.equal(ENGINES.trend.lotUsd * ENGINES.trend.slots, 50000);
  assert.equal(ENGINES.momentum.lotUsd * ENGINES.momentum.top, 30000);
  assert.equal(engineName("allocator"), "Allocator");
  // No two engines buy the same window and delta as each other by design.
  // Five shadow-start setups since Macro's vol-normal was dropped (2026-11-17).
  assert.equal(Object.values(ENGINES).flatMap((e) => Object.values(e.setups)).filter((s) => s.probation).length, 5);
  assert.equal(ENGINES.macro.setups["vol-normal"].retired, true);
});
ok("switches", () => {
  assert.deepEqual(engineSwitches({}).mode, "on");
  assert.equal(engineSwitches({ ENGINES: "pause" }).mode, "pause");
  for (const v of ["0", "off", "false", "no"]) assert.equal(engineSwitches({ ENGINES: v }).mode, "off");
  assert.deepEqual([...engineSwitches({ ENGINES_OFF: "flow, TEC,nope" }).off].sort(), ["flow", "technicals"]);
  assert.deepEqual([...engineSwitches({ ENGINES_OFF: "TRD,momentum" }).off].sort(), ["momentum", "trend"]);
  assert.equal(enginesEnabled({ ENGINES: "0" }), false);
  assert.equal(enginesEnabled({}), true);
  assert.equal(engineSwitches({}).allocator, "advise", "the Allocator advises by default");
  assert.equal(engineSwitches({ ENGINES_ALLOCATOR: "advise" }).allocator, "advise");
  assert.equal(engineSwitches({ ENGINES_ALLOCATOR: "on" }).allocator, "on");
  for (const v of ["0", "off", "false", "no"]) assert.equal(engineSwitches({ ENGINES_ALLOCATOR: v }).allocator, "off");
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
ok("earnings: a Webull backup date never opens a run-in trade", () => {
  const hist = [1, 2, 3, 4].map(() => ({ movePct: 4, week1Pct: 2, pre10Pct: 3 }));
  const next = { date: "2026-11-23", session: "TBD", sessionsUntil: 5, exitBy: "2026-11-20", source: "webull-backup" };
  assert.equal(evalEarnings(V("EEE", baseF({}), { earn: { last: null, hist, next }, live: { iv: { band: "normal" } } }), CTX).length, 0);
});
// Thirty stocks: F01 has the strongest fundamentals, F30 the weakest. The
// weaker half sits under its 200-day (puts are not opened far above it).
function fundViews({ n = 30, over = {} } = {}) {
  const views = {};
  for (let i = 1; i <= n; i++) {
    const sym = `F${String(i).padStart(2, "0")}`, g = (n - i) / (n - 1);
    const core = { epsYoy: -40 + g * 90, epsYoyPrev: -30 + g * 60, beats4: Math.round(g * 4), misses4: Math.round((1 - g) * 4), reports: 9, lastDate: "2026-10-20", sessionsSince: 18 };
    const live = { fyEpsRevision: { pct30: -6 + g * 12 }, operatingMargin: 2 + g * 35, returnOnEquity: 3 + g * 35, revenueGrowthYoy: -8 + g * 30, freeCashFlow: (0.005 + g * 0.05) * 1e11, marketCap: 1e11, debtToEquity: 250 - g * 220, forwardPE: 40 - g * 22, targetMeanPrice: 90 + g * 35 };
    views[sym] = V(sym, baseF(i > n / 2 ? { sma200: 110 } : {}), { fund: { core, live, groupPE: 24 }, earn: { next: { sessionsUntil: 40 } }, ...(over[sym] || {}) });
  }
  return views;
}
const ranked = (views, es = newEngineState(ENGINES.fundamentals), opts = {}) => {
  const rk = standRank(es, views, { today: TODAY, ...opts });
  for (const sym of rk.order) if (views[sym]?.fund) views[sym].fund.rank = { ...rk.rows[sym], n: rk.n };
  return rk;
};
ok("fundamentals: one standing rank; calls from the best eight, puts from the worst eight", () => {
  const views = fundViews(), rk = ranked(views);
  assert.equal(rk.n, 30); assert.equal(rk.keep, 10); assert.equal(rk.order[0], "F01"); assert.equal(rk.order[29], "F30");
  assert.deepEqual(rk.order, Object.keys(views), "better numbers rank higher, all the way down");
  const top = evalFundamentals(views.F01, CTX);
  assert.equal(top.length, 1); assert.equal(top[0].setup, "rank-top"); assert.equal(top[0].side, "call"); assert.equal(top[0].score, 100);
  assert.equal(top[0].signalKey, `F01|rank-top|${TODAY}`);
  assert.ok(top[0].reasons.some((r) => /^Ranked 1 of 30 stocks with full data \(funds are not ranked\)$/.test(r)));
  assert.ok(top[0].reasons.some((r) => /Earnings power \d+, quality \d+, price \d+/.test(r)));
  assert.equal(evalFundamentals(views.F08, CTX)[0].side, "call");
  assert.equal(evalFundamentals(views.F09, CTX).length, 0, "ninth best: kept if held, never opened");
  assert.equal(views.F10.fund.rank.zone, "top"); assert.equal(views.F11.fund.rank.zone, "mid"); assert.equal(views.F21.fund.rank.zone, "bottom");
  const bottom = evalFundamentals(views.F30, CTX);
  assert.equal(bottom[0].setup, "rank-bottom"); assert.equal(bottom[0].side, "put"); assert.equal(bottom[0].score, 100);
  assert.ok(bottom[0].reasons.some((r) => /Ranked 30 of 30 stocks with full data \(1 from the bottom\)/.test(r)));
  assert.equal(evalFundamentals(views.F23, CTX)[0].side, "put");
  assert.equal(evalFundamentals(views.F22, CTX).length, 0);
  // Held back: a report inside six sessions, the reaction day of a report,
  // a call far under the 200-day, a put far above it, today's move.
  assert.equal(evalFundamentals({ ...views.F01, earn: { next: { sessionsUntil: 3 } } }, CTX).length, 0);
  assert.equal(evalFundamentals({ ...views.F01, earn: { reacting: { date: END, session: "PM" } } }, CTX).length, 0);
  assert.equal(evalFundamentals({ ...views.F01, f: baseF({ sma200: 120 }) }, CTX).length, 0);
  assert.equal(evalFundamentals({ ...views.F30, f: baseF({ sma200: 85 }) }, CTX).length, 0);
  assert.equal(evalFundamentals({ ...views.F01, spot: 104.5 }, CTX).length, 0);
  // The history test has only the report numbers: it ranks on earnings power alone.
  const bare = Object.fromEntries(Object.entries(fundViews()).map(([sym, v]) => [sym, { ...v, fund: { core: v.fund.core } }]));
  const rk2 = ranked(bare);
  assert.equal(rk2.order[0], "F01"); assert.equal(rk2.rows.F01.q, null); assert.equal(rk2.rows.F01.p, null); assert.ok(rk2.rows.F01.e > 90);
  // A fund, or a stock without a beat record, is not ranked.
  const mixed = fundViews(); mixed.SPY = { ...V("SPY", baseF({})), isEtf: true, fund: mixed.F01.fund }; mixed.F15 = { ...mixed.F15, fund: { core: null, live: mixed.F15.fund.live } };
  const rk3 = ranked(mixed);
  assert.equal(rk3.n, 29); assert.ok(!rk3.rows.SPY && !rk3.rows.F15);
});
ok("fundamentals: a stock's place is fixed until the month changes or it reports again", () => {
  const es = newEngineState(ENGINES.fundamentals);
  ranked(fundViews(), es, { today: "2026-11-16" });
  // F20's numbers jump the next day with no new report: its place does not move.
  const jump = (v, lastDate) => ({ ...v, fund: { ...v.fund, core: { ...v.fund.core, epsYoy: 200, epsYoyPrev: 0, beats4: 4, misses4: 0, lastDate }, live: { ...v.fund.live, fyEpsRevision: { pct30: 20 }, operatingMargin: 60, returnOnEquity: 60, revenueGrowthYoy: 50, freeCashFlow: 1e10, debtToEquity: 5, forwardPE: 10, targetMeanPrice: 160 } } });
  let views = fundViews(); views.F20 = jump(views.F20, "2026-10-20");
  let rk = ranked(views, es, { today: "2026-11-17" });
  assert.equal(rk.rows.F20.rank, 20); assert.equal(rk.rows.F20.asOf, "2026-11-16");
  // It reports: it is ranked again, and only it.
  views = fundViews(); views.F20 = jump(views.F20, "2026-11-17");
  rk = ranked(views, es, { today: "2026-11-18" });
  assert.ok(rk.rows.F20.rank <= 2); assert.equal(rk.rows.F20.asOf, "2026-11-18"); assert.equal(rk.rows.F01.asOf, "2026-11-16"); assert.ok(rk.rows.F01.rank <= 2);
  // A new month: every stock is ranked again.
  rk = ranked(fundViews(), es, { today: "2026-12-01" });
  assert.ok(Object.values(rk.rows).every((r) => r.asOf === "2026-12-01")); assert.equal(rk.rows.F20.rank, 20);
  // No data for a stock this run: it keeps its place. Out of coverage: dropped.
  const fewer = fundViews(); delete fewer.F05;
  rk = ranked(fewer, es, { today: "2026-12-02" });
  assert.equal(rk.rows.F05.rank, 5);
  rk = ranked(fewer, es, { today: "2026-12-02", coverage: new Set(Object.keys(fewer)) });
  assert.equal(rk.n, 29); assert.ok(!rk.rows.F05);
  // Too few ranked names: there is no rank to trade or to close on.
  const small = fundViews({ n: RANK.minNames - 1 }), rkS = ranked(small);
  assert.equal(rkS.live, false); assert.equal(small.F01.fund.rank.enter, null); assert.equal(small.F01.fund.rank.zone, null);
  assert.equal(evalFundamentals(small.F01, CTX).length, 0);
  // A short rank: new trades come from inside the kept third, never outside it.
  const short = fundViews({ n: 12 }), rkT = ranked(short);
  assert.equal(rkT.keep, 4); assert.equal(rkT.enter, 4);
  assert.equal(short.F04.fund.rank.enter, "call"); assert.equal(short.F05.fund.rank.enter, null); assert.equal(short.F08.fund.rank.enter, null); assert.equal(short.F09.fund.rank.enter, "put");
  // The page read: both ends, and what is held.
  const pv = rankView(es, [{ symbol: "F02", side: "call" }, { symbol: "F15", side: "call" }]);
  assert.equal(pv.top.length, RANK.shown); assert.equal(pv.bottom.length, RANK.shown); assert.equal(pv.top[1].held, "call");
  assert.deepEqual(pv.heldElsewhere.map((r) => r.symbol), ["F15"]);
});
ok("flow: signed bullish flow; short squeeze reads borrow and short-sale volume", () => {
  const flow = { signed: true, nBull: 7, nBear: 1, bullUsd: 9e6, bearUsd: 1e6, bullPrem: 1.2e6, bearPrem: 1e5, persist: 0.4, gamma: 1, callWall: null, siPct: null, covering: false, rvol: 1.6, borrowTight: false, shortVolZ: null };
  const c = evalFlow(V("GGG", baseF({}), { spot: 100.6, live: { flow } }));
  assert.equal(c.length, 1); assert.equal(c[0].setup, "aggressive-flow"); assert.equal(c[0].side, "call");
  assert.ok(c[0].reasons.some((r) => /calls bought or puts sold/.test(r)));
  // Bearish signed flow (puts bought / calls sold) with a falling stock reads put.
  const bear = evalFlow(V("GGG", baseF({}), { spot: 99.4, live: { flow: { ...flow, bullUsd: 1e6, bearUsd: 9e6, bullPrem: 1e5, bearPrem: 1.2e6, nBull: 1, nBear: 7, persist: -0.4 } } }));
  assert.ok(bear.length === 0 || bear[0].side === "put");
  // The older shape (FLOW_SIGNED=0) still reads.
  const legacy = evalFlow(V("GGG", baseF({}), { spot: 100.6, live: { flow: { ...flow, signed: false, bullUsd: 1.2e6, bearUsd: 1e5 } } }));
  assert.equal(legacy[0].setup, "aggressive-flow"); assert.ok(legacy[0].reasons.some((r) => /prints at the ask/.test(r)));
  // The week's flow on the other side: no trade.
  assert.equal(evalFlow(V("GGG", baseF({}), { spot: 100.6, live: { flow: { ...flow, persist: -0.5 } } })).length, 0);
  const sq = evalFlow(V("HHH", baseF({ ret5: 0.09, volRatio: 2 }), { live: { flow: { nBull: 0, nBear: 0, bullUsd: 0, bearUsd: 0, siPct: 22, covering: true, borrowTight: true, shortVolZ: 2.1 } } }));
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
  for (const id of SIGNAL_IDS) {
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
// shares: false by default, so the option mechanics below are tested on the
// setups that buy shares live too; the share-trade checks pass shares: true.
function bookInput(views, { nowIso = NOW_AM, late = false, chains, flagshipOpen = [], shares = false, ...rest } = {}) {
  const ms = Date.parse(nowIso);
  const data = chains || Object.fromEntries(Object.values(views).map((v) => [v.sym, { spot: v.spot, chains: chainFor(100, Date.parse(NOW_AM)) }]));
  return {
    nowIso, today: nowIso.slice(0, 10), late, views, ctx: { ...CTX, byId: views },
    quote: (t) => (data[t.symbol] ? quoteContract(data[t.symbol], t.contract, { nowMs: ms }) : null),
    pick: (view, side, spec, c) => pickContract(data[view.sym], side, contractFor(spec, c?.setup), { nowMs: ms }),
    flagshipOpen, coverage: null, shares, ...rest,
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
ok("book: Fundamentals holds three calls and two puts, one new trade a run, and swaps only when a name leaves its third", () => {
  const state = emptyState(), record = emptyRecord();
  const run = (nowIso, views = fundViews()) => stepBook(state, record, bookInput(views, { engines: ["fundamentals"], nowIso, late: /T20/.test(nowIso) }));
  const runs = ["2026-11-16T16:00:00.000Z", "2026-11-16T20:30:00.000Z", "2026-11-17T16:00:00.000Z", "2026-11-17T20:30:00.000Z", "2026-11-18T16:00:00.000Z"].map((iso) => run(iso));
  assert.deepEqual(runs.map((o) => o.opened.map((t) => `${t.symbol} ${t.side}`).join()), ["F01 call", "F30 put", "F02 call", "F29 put", "F03 call"]);
  assert.ok(runs.every((o) => o.shadowOpened === 0), "a name with no room is looked at again next run, not parked as a shadow trade");
  assert.ok(runs[0].candidates.fundamentals.some((c) => c.symbol === "F30" && c.why === "run limit"));
  const t0 = record.open[0];
  assert.equal(t0.setup, "rank-top"); assert.equal(t0.exits.maxSessions, 60); assert.equal(t0.exits.tp, 50); assert.equal(t0.signalDate, "2026-11-16");
  assert.ok(t0.contract.dte >= 75 && t0.contract.dte <= 200);
  // Full: three calls and two puts. The next names wait.
  let out = run("2026-11-18T20:30:00.000Z");
  assert.equal(out.opened.length, 0); assert.equal(out.closed.length, 0); assert.equal(out.shadowOpened, 0);
  assert.ok(out.candidates.fundamentals.some((c) => c.symbol === "F04" && c.why === "no free call slot"));
  assert.ok(out.candidates.fundamentals.some((c) => c.symbol === "F28" && c.why === "no free put slot"));
  // F03 slips after its report but stays in the top third: held.
  const slip = (v, over) => ({ ...v, fund: { ...v.fund, core: { ...v.fund.core, ...over } } });
  let views = fundViews(); views.F03 = slip(views.F03, { epsYoy: 0, epsYoyPrev: 20, beats4: 2, misses4: 2, lastDate: "2026-11-18" });
  out = run("2026-11-19T16:00:00.000Z", views);
  assert.ok(state.engines.fundamentals.rank.rows.F03.rank > 3 && state.engines.fundamentals.rank.rows.F03.zone === "top");
  assert.equal(out.closed.length, 0);
  // F02 reports badly and leaves the top third: closed, and the best name not held takes the slot.
  views = fundViews(); views.F03 = slip(views.F03, { epsYoy: 0, epsYoyPrev: 20, beats4: 2, misses4: 2, lastDate: "2026-11-18" });
  views.F02 = { ...slip(views.F02, { epsYoy: -30, epsYoyPrev: 10, beats4: 0, misses4: 4, lastDate: "2026-11-19" }), fund: { ...views.F02.fund, core: { ...views.F02.fund.core, epsYoy: -30, epsYoyPrev: 10, beats4: 0, misses4: 4, lastDate: "2026-11-19" }, live: views.F25.fund.live } };
  out = run("2026-11-20T16:00:00.000Z", views);
  assert.equal(out.closed.length, 1); assert.equal(out.closed[0].symbol, "F02"); assert.equal(out.closed[0].status, "rank-out"); assert.ok(CLOSE_LABEL["rank-out"]);
  assert.deepEqual(out.opened.map((t) => t.symbol), ["F04"]);
  assert.equal(record.open.filter((t) => t.side === "call").length, 3); assert.equal(record.open.filter((t) => t.side === "put").length, 2);
  // A fresh start is already on the new rules: no version bump.
  assert.equal(record.open[0].rulesVersion, "FUN-1"); assert.equal(state.engines.fundamentals.rules, ENGINES.fundamentals.rules.n);
});
ok("book: the rule change reaches a running engine once, as a logged version bump; first-rules trades keep their own checks", () => {
  const state = emptyState(), record = emptyRecord();
  state.engines.fundamentals = newEngineState(ENGINES.fundamentals); delete state.engines.fundamentals.rules;   // a state written before the change
  let out = stepBook(state, record, bookInput(fundViews(), { engines: ["fundamentals"] }));
  assert.deepEqual(out.changes.map((c) => `${c.engine}:${c.kind}`), ["fundamentals:rules"]);
  assert.match(out.changes[0].text, /\$2,000 of premium/);
  assert.equal(state.engines.fundamentals.v, 2); assert.equal(state.engines.fundamentals.log[0].v, "FUN-2"); assert.equal(out.opened[0].rulesVersion, "FUN-2");
  out = stepBook(state, record, bookInput(fundViews(), { engines: ["fundamentals"], nowIso: NOW_PM, late: true }));
  assert.equal(out.changes.length, 0);
  // The entry bar never decides a rank trade: with the bar at its top, the
  // eighth-best name (score under the bar) still opens when it is the best free one.
  const st3 = emptyState(); st3.engines.fundamentals = newEngineState(ENGINES.fundamentals); st3.engines.fundamentals.bar = 99;
  const only8 = fundViews(); for (const sym of ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F23", "F24", "F25", "F26", "F27", "F28", "F29", "F30"]) only8[sym] = { ...only8[sym], earn: { next: { sessionsUntil: 3 } } };
  out = stepBook(st3, emptyRecord(), bookInput(only8, { engines: ["fundamentals"] }));
  assert.equal(out.opened.length, 1); assert.equal(out.opened[0].symbol, "F08"); assert.ok(out.opened[0].score < 99);
  // Every engine carries a hand-made rule change since 2026-11-17 (shares for
  // the slow call setups, Macro's vol-normal dropped); each lands once.
  const st2 = emptyState(); for (const id of ENGINE_IDS) { st2.engines[id] = newEngineState(ENGINES[id]); delete st2.engines[id].rules; }
  out = stepBook(st2, emptyRecord(), bookInput({ AAA: V("AAA", pullF()) }, {}));
  assert.deepEqual(out.changes.map((c) => c.engine), SIGNAL_IDS, "the core engines start on their first rules");
  assert.ok(out.changes.filter((c) => c.engine !== "fundamentals").every((c) => /shares/.test(c.text)));
  assert.match(out.changes.find((c) => c.engine === "macro").text, /dropped/);
  // A trade opened under the first rules still closes on a report that goes against it, and never on the rank.
  const old = { engine: "fundamentals", setup: "compounder", side: "call", signalDate: "2026-10-20", entryDate: "2026-10-25T16:00:00.000Z" };
  assert.equal(thesisCheck(old, { earn: { last: { date: "2026-11-10", surprisePct: -5 } }, fund: { rank: { zone: "bottom", n: 30 } } }), "signal-gone");
  assert.equal(thesisCheck(old, { earn: { last: { date: "2026-11-10", surprisePct: 4 } }, fund: { rank: { zone: "bottom", n: 30 } } }), null);
  // A rank trade closes only on the rank.
  const rankT = { engine: "fundamentals", setup: "rank-top", side: "call" };
  assert.equal(thesisCheck(rankT, { earn: { last: { date: "2026-11-10", surprisePct: -5 } }, fund: { rank: { zone: "top", n: 30 } } }), null);
  assert.equal(thesisCheck(rankT, { fund: { rank: { zone: "mid", n: 30 } } }), "rank-out");
  assert.equal(thesisCheck({ ...rankT, setup: "rank-bottom", side: "put" }, { fund: { rank: { zone: "mid", n: 30 } } }), "rank-out");
  assert.equal(thesisCheck(rankT, { fund: {} }), null, "no rank this run: hold");
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
// ---- share trades (2026-11-17: fit the contract to the signal) -------------
ok("shares: which setups buy stock, long only, and the switch", () => {
  const S = (id, k, side) => instrumentFor(ENGINES[id], k, side);
  for (const [id, k] of [["technicals", "pullback"], ["technicals", "breakout"], ["reversion", "capitulation"], ["earnings", "drift"], ["flow", "aggressive-flow"], ["flow", "gamma-wall"], ["flow", "short-squeeze"], ["macro", "gold-rates"], ["macro", "dollar-asia"]]) {
    assert.equal(S(id, k, "call"), "shares", `${id}.${k}`);
    assert.equal(S(id, k, "put"), "option", `${id}.${k} puts stay options: the engines never short stock`);
  }
  // Since 2026-11-19 (Technicals shares only) the squeeze's up side buys shares too.
  assert.equal(S("technicals", "squeeze", "call"), "shares"); assert.equal(instrumentFor(engineSpecs({ tecShares: false }).technicals, "squeeze", "call"), "option");
  for (const [id, k] of [["reversion", "oversold-bounce"], ["earnings", "run-in"], ["macro", "rates-fall"], ["macro", "stress-off"], ["macro", "event-drift"], ["fundamentals", "rank-top"]]) assert.equal(S(id, k, "call"), "option", `${id}.${k}`);
  assert.equal(instrumentFor(ENGINES.technicals, "pullback", "call", { shares: false }), "option");
  assert.equal(engineSwitches({}).shares, true);
  for (const v of ["0", "off", "false", "no"]) assert.equal(engineSwitches({ ENGINES_SHARES: v }).shares, false);
  const c = sharesContract(100);
  assert.deepEqual(c, { structure: "shares", optionType: "call", shares: 50, mid: 100, usd: 5000, costPct: 0.1 });
  assert.equal(sharesContract(4900).shares, 1);
  assert.match(sharesContract(7200).skip, /costs more than the \$5,000 lot/);
  assert.equal(sharesContract(0.3412).mid, 0.3412, "split-adjusted prices keep four decimals");
  assert.match(sharesContract(0).skip, /no price/);
  assert.equal(positionUsd(c), 5000); assert.equal(positionUsd({ mid: 4 }), 400);
  assert.equal(contractKey("AAA", c), "AAA|shares");
  assert.deepEqual(quoteContract({ spot: 103.4, chains: {} }, c), { mid: 103.4, bid: null, ask: null, spot: 103.4, source: "spot", iv: null });
});
ok("shares: a pullback buys $5,000 of stock with stock exits, marked at the price less costs", () => {
  const mk = (over = {}, input = {}) => {
    const views = { AAA: V("AAA", pullF()) }, state = emptyState(), record = emptyRecord();
    const out = stepBook(state, record, bookInput(views, { engines: ["technicals"], shares: true, ...input }));
    Object.assign(record.open[0], over);
    return { views, state, record, out };
  };
  const step = (x, spot, { nowIso = "2026-11-17T16:00:00.000Z", noChain = false } = {}) => {
    const views = { AAA: { ...x.views.AAA, spot } };
    const chains = noChain ? {} : { AAA: { spot, chains: chainFor(spot, Date.parse(nowIso)) } };
    return stepBook(x.state, x.record, bookInput(views, { engines: ["technicals"], nowIso, chains, mode: "pause", shares: true }));
  };
  let x = mk();
  const t = x.out.opened[0];
  assert.ok(isSharesTrade(t)); assert.equal(t.side, "call");
  assert.equal(t.tradeId, "TEC:AAA-S-11/16/26-11:00");
  assert.equal(t.contract.shares, 50); assert.equal(t.contract.mid, 100);
  assert.deepEqual(t.exits, { maxSessions: BOOK.sharesMaxSessions });
  // Technicals' share stop (2026-11-17): 3 ATR under the entry (94), in place
  // of the pullback's own stop (lo5 98.2 - 0.25 ATR = 97.7); target 3 ATR over.
  assert.equal(t.stopLevel, 94); assert.equal(t.targetLevel, 106);
  // With the fix off: the setup's own stop where it is higher than 2 ATR under (96).
  const old = stepBook(emptyState(), emptyRecord(), bookInput({ AAA: V("AAA", pullF()) }, { engines: ["technicals"], shares: true, specs: engineSpecs({ stockStop: false }) })).opened[0];
  assert.equal(old.stopLevel, 97.7); assert.equal(old.targetLevel, 106);
  assert.ok(!t.noMirror && !t.shared);
  let out = step(x, 101);
  assert.equal(out.closed.length, 0); assert.equal(x.record.open[0].optionPnlPct, 0.9, "+1% less 0.1% costs");
  out = step(x, 106.5);
  assert.equal(out.closed[0].status, "target"); assert.equal(out.closed[0].outcome, "win"); assert.equal(out.closed[0].optionPnlPct, 6.4);
  assert.equal(tradeUsd(out.closed[0]), 320, "6.4% of the $5,000 lot");
  assert.equal(x.state.engines.technicals.outcomes.at(-1).i, "s", "learning knows it was a share trade");
  const st = engineStats(x.record.closed);
  assert.equal(st.n, 0, "options scored apart"); assert.equal(st.shares.n, 1); assert.equal(st.shares.usd, 320); assert.equal(st.shares.bySetup[0].key, "pullback");
  x = mk(); out = step(x, 97.5);
  assert.equal(out.closed.length, 0, "inside the 3 ATR stop");
  out = step(x, 93.5);
  assert.equal(out.closed[0].status, "stock-stop"); assert.equal(out.closed[0].outcome, "loss");
  x = mk({ sessions: BOOK.sharesMaxSessions - 1 }); out = step(x, 100.5);
  assert.equal(out.closed[0].status, "time");
  // No expiry: no quote holds it, however long.
  x = mk(); out = step(x, 100, { noChain: true, nowIso: "2027-06-01T16:00:00.000Z" });
  assert.equal(out.closed.length, 0);
  // Top Picks holding a call on the same stock is not a "same contract".
  const fl = [{ tradeId: "AAA-C-11/16/26-11:00", symbol: "AAA", side: "call", contract: { structure: "long", optionType: "call", strike: 100, expiry: t.contract.expiry ?? 1797000000 } }];
  x = mk({}, { flagshipOpen: fl });
  assert.ok(!x.record.open[0].noMirror && !x.record.open[0].shared);
  // A put setup on the same engine still buys a put (the range breakdown,
  // retired on 2026-11-17, with the retirement switched off).
  const bd = baseF({ c: 86, pc: 89, l: 85.5, sma200: 95, sma50: 96, lo55p: 88, dayAtr: -1.2, volRatio: 1.8, rangePos: 0.1 });
  const inP = { engines: ["technicals"], shares: true, ctx: { ...CTX, spy: baseF({ c: 400, sma50: 420, ret63: 0 }) } };
  const outP = stepBook(emptyState(), emptyRecord(), bookInput({ BBB: V("BBB", bd) }, { ...inP, specs: engineSpecs({ retirePuts: false }) }));
  assert.equal(outP.opened[0].setup, "breakdown"); assert.equal(outP.opened[0].contract.structure, "long"); assert.equal(outP.opened[0].contract.optionType, "put");
  const gone = stepBook(emptyState(), emptyRecord(), bookInput({ BBB: V("BBB", bd) }, inP));
  assert.equal(gone.opened.length, 0); assert.equal(gone.shadowOpened, 0); assert.equal(gone.candidates.technicals.length, 0, "a retired setup is not even listed");
});
ok("shares: learning counts a share result 5x and says so; the page splits them out", () => {
  const es = newEngineState(ENGINES.reversion);
  for (let i = 0; i < 45; i++) observe(es, { setup: "capitulation", side: "call", optionPnlPct: i % 2 ? -1 : -4, exitDate: "2026-11-20", entryDate: "2026-11-18", contract: { structure: "shares" } });
  const made = adapt(es, ENGINES.reversion, { today: "2026-11-20", parts: { brake: false, bar: false, cells: false } });
  assert.equal(made[0]?.kind, "mute", "-2.5% stock trades read as -12.7% option trades");
  assert.match(made[0].text, /Share results count 5x/);
  const lv = learnView(es, ENGINES.reversion).setups.find((r) => r.key === "capitulation");
  assert.equal(lv.real.n, 0); assert.equal(lv.realShares.n, 45); assert.ok(lv.realShares.avg > -3 && lv.realShares.avg < -2, "shown in its own %");
  // Without the 5x the same results would not mute anything.
  const es2 = newEngineState(ENGINES.reversion);
  for (let i = 0; i < 45; i++) observe(es2, { setup: "capitulation", side: "call", optionPnlPct: i % 2 ? -1 : -4, exitDate: "2026-11-20", entryDate: "2026-11-18", contract: { structure: "long" } });
  assert.equal(adapt(es2, ENGINES.reversion, { today: "2026-11-20", parts: { brake: false, bar: false, cells: false } }).length, 0);
  // The page file: share trades in their own block, not on the shared-contract list.
  const record = emptyRecord(), state = emptyState();
  const shr = { engine: "reversion", tag: "REV", tradeId: "REV:AAA-S-11/16/26-11:00", symbol: "AAA", side: "call", setup: "capitulation", entryDate: NOW_AM, contract: sharesContract(100), optionPnlPct: 2, exits: { maxSessions: 20 } };
  record.open.push(shr, { ...shr, engine: "technicals", tag: "TEC", tradeId: "TEC:AAA-S-11/16/26-11:00", setup: "pullback" });
  record.closed.push({ ...shr, tradeId: "REV:BBB-S-11/10/26-11:00", symbol: "BBB", status: "target", outcome: "win", exitDate: "2026-11-13T16:00:00.000Z", optionPnlPct: 4 });
  const view = buildEnginesView({ record, state, ctx: CTX, builtAtIso: NOW_AM });
  const rev = view.engines.find((e) => e.id === "reversion");
  assert.equal(rev.stats.n, 0); assert.equal(rev.sharesStats.n, 1); assert.equal(rev.sharesStats.open, 1); assert.equal(rev.sharesStats.openUsd, 100);
  assert.equal(rev.open[0].instrument, "shares"); assert.equal(rev.open[0].contract.shares, 50);
  assert.equal(rev.setups.find((r) => r.key === "capitulation").calls, "shares");
  assert.equal(view.shared.length, 0, "two engines holding the same stock is not a shared contract");
  assert.equal(view.total.n, 0); assert.equal(view.total.shares.n, 1); assert.equal(view.total.shares.open, 2);
  assert.equal(view.book.shares.usd, 5000);
  assert.equal(view.compare.find((c) => c.id === "reversion").shares.n, 1);
});

// ---- the money-leak fixes (2026-11-17) ---------------------------------------
const WASHOUT = (over = {}) => baseF({ c: 90, pc: 93, sma20: 97, sma200: 85, sd20: 3, z20: -2.3, rsi2: 4, move5Atr: -3, downStreak: 4, rangePos: 0.6, l: 89, ...over });
ok("fixes: the Owner Settings switches, all on by default", () => {
  assert.deepEqual(ENGINE_FIX_IDS, ["retirePuts", "bounce", "size", "stockStop", "fillBasis", "riskSize", "conviction", "tecShares", "crashStand", "fearBounce", "convNoScore", "runInShares"]);
  const sw = engineSwitches({});
  assert.deepEqual(sw.fixes, Object.fromEntries(ENGINE_FIX_IDS.map((id) => [id, true])));
  assert.equal(BOOK.optionUsd, 2000); assert.equal(sw.optionUsd, 2000);
  for (const f of ENGINE_FIXES) {
    for (const v of ["0", "off", "false", "no", " OFF "]) {
      const x = engineSwitches({ [f.env]: v });
      assert.equal(x.fixes[f.id], false, `${f.env}=${v}`);
      assert.equal(Object.values(x.fixes).filter((on) => !on).length, 1, "one switch moves one fix");
    }
    for (const v of ["", "1", "on", "true"]) assert.equal(engineSwitches({ [f.env]: v }).fixes[f.id], true, `${f.env}=${v}`);
    const def = ownerSettingDef(f.env);
    assert.ok(def && def.kind === "switch" && def.default === true && def.group === "Strategy engines" && def.scope === "build", f.env);
    assert.ok(f.engines.length && f.engines.every((id) => SIGNAL_IDS.includes(id)), f.id);
  }
  assert.equal(engineSwitches({ ENGINES_FIX_SIZE: "0" }).optionUsd, null, "size off: one contract, as before");
  assert.equal(engineSpecs(), ENGINES); assert.equal(engineSpecs({}), ENGINES); assert.equal(engineSpecs({ bounce: true }), ENGINES);
});
ok("fixes: each one changes only its own setups, and off puts them back", () => {
  // The two losing put setups are retired; off brings them back as they were.
  assert.equal(ENGINES.technicals.setups.breakdown.retired, true);
  assert.equal(ENGINES.reversion.setups["overbought-fade"].retired, true);
  const pr = engineSpecs({ retirePuts: false });
  assert.ok(!pr.technicals.setups.breakdown.retired && !pr.reversion.setups["overbought-fade"].retired);
  assert.equal(pr.reversion.setups["overbought-fade"].probation, true, "the fade still starts on shadow");
  assert.equal(pr.technicals.setups.breakdown.label, "Range breakdown");
  // The yields-falling TLT calls keep the engine's +30% take-profit: no
  // take-profit lost money in the full book (fewer, longer trades).
  assert.deepEqual(exitsFor("macro", "rates-fall"), { ...ENGINES.macro.exits }); assert.equal(exitsFor("macro", "rates-fall").tp, 30);
  // The washout bounce: its own contract and stop; every other setup keeps the engine's.
  assert.deepEqual(contractFor(ENGINES.reversion, "oversold-bounce"), { dteMin: 14, dteIdeal: 21, dteMax: 35, delta: 0.3 });
  assert.deepEqual(contractFor(ENGINES.reversion, "capitulation"), { ...ENGINES.reversion.contract });
  assert.deepEqual(exitsFor("reversion", "oversold-bounce"), { ...ENGINES.reversion.exits, stop: -60 });
  const nb = engineSpecs({ bounce: false });
  assert.deepEqual(contractFor(nb.reversion, "oversold-bounce"), { ...ENGINES.reversion.contract });
  assert.deepEqual(exitsFor("reversion", "oversold-bounce", nb), { ...ENGINES.reversion.exits });
  // Technicals' share stop.
  assert.equal(ENGINES.technicals.sharesStopAtr, 3); assert.equal(ENGINES.technicals.sharesOwnStop, false);
  const ns = engineSpecs({ stockStop: false });
  assert.equal(ns.technicals.sharesStopAtr, null); assert.equal(ns.technicals.sharesOwnStop, true);
  // A switch leaves the other engines' setups alone, and the core engines entirely.
  assert.deepEqual(nb.technicals.setups, ENGINES.technicals.setups); assert.deepEqual(nb.macro.setups, ENGINES.macro.setups);
  for (const id of CORE_IDS) assert.equal(nb[id], ENGINES[id]);
  // The honest paper trades (2026-11-19) on every signal engine: rules 4,
  // or rules 5 on Reversion and Macro over their paper trial (rules 4,
  // #870), all over rules 3 (the money-leak fixes); each note names only the
  // fixes that reach it.
  const hasTrial = (id) => ENGINE_TRIALS.some((t) => t.engine === id && (t.layer || "under") === "under");
  const rules3Of = (r, id) => (hasTrial(id) ? r.before.before : r.before);
  // The contract cap (2026-11-20) sits on top: rules 6 on Reversion and
  // Macro, 5 elsewhere, its note naming the new range and the old one.
  for (const id of SIGNAL_IDS) {
    const rc = peel(ENGINES[id].rules), r = rc.before, r3 = rules3Of(r, id);
    assert.equal(rc.n, hasTrial(id) ? 6 : 5, id); assert.equal(rc.date, "2026-11-20"); assert.match(rc.note, /^New rules \(wider size range\): each risk-sized option trade buys 1 to 25 contracts \(was 1 to 10\)/, id);
    assert.match(rc.note, /Riskier dial/); assert.equal(rc.key, `${r.key}|cap:25`, id); assert.match(rc.switchNote, /Size range: each risk-sized option trade buys 1 to 25 contracts\.$/);
    assert.equal(r.n, hasTrial(id) ? 5 : 4, id); assert.equal(r.date, "2026-11-19"); assert.match(r.note, /^New rules \(honest paper trades\): .*ask going in.*1 to 10 contracts.*0\.5x to 2x/, id);
    assert.doesNotMatch(r.note, /\$2,000 of premium/, "the premium size is not in force while risk sizing is on");
    if (hasTrial(id)) { assert.equal(r.before.n, 4, id); assert.match(r.before.note, /paper trial/, id); assert.match(r.key, /\|trials:/, id); }
    assert.equal(r3?.n, 3, id); assert.match(r3.note, /^New rules \(the money-leak fixes\): .*\$2,000 of premium/, id);
    assert.equal(r3.before?.n, 2, id); assert.ok(/^fixes:/.test(r.key), id); assert.ok(!/size,|size$|size\|/.test(r.key.replace("riskSize", "")), id);
  }
  const r3 = (id) => rules3Of(peel(ENGINES[id].rules).before, id).note;
  assert.match(r3("reversion"), /spike-in-a-downtrend fade is retired/); assert.match(r3("reversion"), /0\.3 delta/);
  assert.match(r3("technicals"), /range breakdown is retired/); assert.match(r3("technicals"), /3 ATR/);
  assert.doesNotMatch(r3("earnings"), /retired|TLT|ATR/); assert.doesNotMatch(r3("macro"), /TLT|take-profit/);
  assert.match(ENGINES.technicals.rules.before.note, /shares only/); assert.match(peel(ENGINES.reversion.rules).before.note, /stands aside.*7%/); assert.match(peel(ENGINES.reversion.rules).before.note, /extreme-fear bounce/);
  for (const id of ["earnings", "macro", "fundamentals", "flow"]) assert.doesNotMatch(peel(ENGINES[id].rules).before.note, /shares only|stands aside|extreme-fear/, id);
  // Under risk sizing the premium-size switch changes no trade: no logged change.
  const sz = engineSpecs({ size: false });
  assert.equal(peel(sz.earnings.rules).n, 5); assert.equal(peel(sz.earnings.rules).before.n, 4); assert.equal(peel(sz.earnings.rules).before.before.n, 2, "size was the only rules-3 fix on Earnings");
  assert.equal(peel(sz.reversion.rules).n, 6); assert.equal(rules3Of(peel(sz.reversion.rules).before, "reversion").n, 3); assert.doesNotMatch(rules3Of(peel(sz.reversion.rules).before, "reversion").note, /\$2,000/);
  assert.equal(sz.reversion.rules.key, ENGINES.reversion.rules.key);
  // Every honest-paper change off: back to rules 3 exactly as adopted on
  // 2026-11-17, with the paper trial on top where there is one (rules 4, as
  // on main before this change).
  const step4 = Object.fromEntries(ENGINE_FIXES.filter((f) => f.step === 4).map((f) => [f.id, false]));
  const s3 = engineSpecs(step4);
  for (const id of SIGNAL_IDS) {
    const s3r = peel(s3[id].rules);
    assert.equal(s3r.n, hasTrial(id) ? 4 : 3, id);
    assert.equal((hasTrial(id) ? s3r.before : s3r).note, r3(id), id);
  }
  assert.equal(peel(s3.reversion.rules).key, "fixes:retirePuts,bounce,size|trials:rsi2Dip"); assert.equal(s3.technicals.rules.key, "fixes:retirePuts,size,stockStop");
  const s2 = engineSpecs({ ...step4, size: false });
  assert.equal(peel(s2.earnings.rules).n, 2); assert.equal(peel(s2.earnings.rules).note, peel(ENGINES.earnings.rules).before.before.before.note);
  // A paper trial switched off: the honest paper trades sit straight on rules 3.
  const nt = engineSpecs(undefined, { rsi2Dip: false });
  const ntR = peel(nt.reversion.rules);
  assert.equal(ntR.n, 5); assert.equal(ntR.before.n, 4); assert.equal(ntR.before.before.n, 3); assert.equal(nt.reversion.setups["rsi2-dip"].retired, true);
  assert.equal(peel(nt.macro.rules).n, 6, "the other engine's trial is untouched");
  const allOff = engineSpecs(Object.fromEntries(ENGINE_FIX_IDS.map((id) => [id, false])));
  // (The Flow paper trials of 2026-11-20 are a rules step of their own on top.)
  for (const id of SIGNAL_IDS) assert.equal(allOff[id].rules.n, (hasTrial(id) ? 3 : 2) + (id === "flow" ? 1 : 0), id);
});
ok("fixes: option trades buy about $2,000 of premium in the record; Webull still buys one", () => {
  assert.equal(optionQty(1.2, 2000), 17); assert.equal(optionQty(30, 2000), 1, "a $3,000 contract is bought once");
  assert.equal(optionQty(0.5, 2000), 40); assert.equal(optionQty(1.2, null), 1); assert.equal(optionQty(null, 2000), 1);
  assert.equal(contractsOf({}), 1); assert.equal(contractsOf({ qty: 17 }), 17); assert.equal(contractsOf({ qty: 0 }), 1); assert.equal(contractsOf({ qty: 2.5 }), 1);
  assert.equal(positionUsd({ mid: 1.2, qty: 17 }), 2040); assert.equal(positionUsd({ mid: 1.2 }), 120);
  assert.equal(tradeUsd({ optionPnlPct: 10, contract: { mid: 1.2, qty: 17 } }), 204);
  const run = (over = {}) => stepBook(emptyState(), emptyRecord(), bookInput({ AAA: V("AAA", pullF()) }, { engines: ["technicals"], ...over })).opened[0];
  const t = run();
  assert.equal(t.contract.structure, "long");
  assert.equal(t.contract.qty, optionQty(t.contract.mid, 2000));
  assert.ok(Math.abs(positionUsd(t.contract) - 2000) <= t.contract.mid * 50 + 0.01, "within half a contract of $2,000");
  const row = buildEnginesView({ record: { open: [t], closed: [] }, state: emptyState(), ctx: CTX, builtAtIso: NOW_AM }).engines.find((e) => e.id === "technicals").open[0];
  assert.equal(row.contract.qty, t.contract.qty); assert.equal(row.contract.usd, Math.round(positionUsd(t.contract)));
  const one = run({ optionUsd: null });
  assert.equal(contractsOf(one.contract), 1); assert.equal(Math.round(positionUsd(one.contract)), Math.round(one.contract.mid * 100));
  // Share trades are untouched.
  const sh = run({ shares: true });
  assert.ok(isSharesTrade(sh)); assert.equal(sh.contract.qty, undefined);
  // The paper account order is one contract whatever the record holds.
  assert.equal(newTrade(t, t.tradeId).requestedQty, 1);
});
ok("fixes: the washout bounce buys a ~0.3-delta call about 21 days out with a -60% stop", () => {
  const go = (specs) => stepBook(emptyState(), emptyRecord(), bookInput({ CCC: V("CCC", WASHOUT()) }, { engines: ["reversion"], ...(specs ? { specs } : {}) }));
  const t = go().opened[0];
  assert.equal(t?.setup, "oversold-bounce"); assert.equal(t.contract.optionType, "call");
  assert.ok(t.contract.dte >= 14 && t.contract.dte <= 35, `dte ${t.contract.dte}`);
  assert.ok(Math.abs(Math.abs(t.contract.delta) - 0.3) <= 0.06, `delta ${t.contract.delta}`);
  assert.equal(t.exits.stop, -60); assert.equal(t.exits.tp, ENGINES.reversion.exits.tp);
  const old = go(engineSpecs({ bounce: false })).opened[0];
  assert.ok(Math.abs(old.contract.delta) >= 0.5, `old delta ${old.contract.delta}`); assert.equal(old.exits.stop, ENGINES.reversion.exits.stop);
  // The live picker reaches under 0.3 for a 0.3 target, never under 0.25; other targets keep the 0.3 floor.
  const data = { spot: 100, chains: chainFor(100, Date.parse(NOW_AM)) };
  const lo = pickContract(data, "call", { dteMin: 14, dteIdeal: 21, dteMax: 35, delta: 0.3 }, { nowMs: Date.parse(NOW_AM) });
  assert.ok(Math.abs(lo.delta) >= 0.25 && Math.abs(lo.delta) <= 0.36, `picked ${lo.delta}`);
  const hi = pickContract(data, "call", { ...ENGINES.technicals.contract, delta: 0.3 + 0.0001 }, { nowMs: Date.parse(NOW_AM) });
  assert.ok(Math.abs(hi.delta) >= 0.25);
});
ok("fixes: the record splits where a rule changes, including a switch flipped in Owner Settings", () => {
  // An engine still on its first rules (before #851) gets both notes in one change, oldest first.
  const es = newEngineState(ENGINES.technicals); es.rules = 1; delete es.rulesKey;
  const made = adoptRules(es, ENGINES.technicals, TODAY);
  assert.equal(made.kind, "rules"); assert.equal(es.v, 2); assert.equal(es.rules, 5); assert.equal(es.rulesKey, ENGINES.technicals.rules.key);
  assert.deepEqual(es.rulesFrom, { date: TODAY, v: "TEC-2" });
  const at = (w) => made.text.indexOf(w);
  assert.ok(at("buy shares instead of calls") >= 0 && at("buy shares instead of calls") < at("money-leak fixes") && at("money-leak fixes") < at("honest paper trades") && at("honest paper trades") < at("wider size range"), made.text);
  // One already on rules 2 gets the two newer notes; one on rules 3 the newest only.
  const es2 = newEngineState(ENGINES.technicals); es2.rules = 2; delete es2.rulesKey;
  assert.equal(adoptRules(es2, ENGINES.technicals, TODAY).text, `${ENGINES.technicals.rules.before.before.note} ${ENGINES.technicals.rules.before.note} ${ENGINES.technicals.rules.note}`);
  assert.equal(adoptRules(es2, ENGINES.technicals, TODAY), null, "once");
  const es4 = newEngineState(ENGINES.technicals); es4.rules = 3; es4.rulesKey = "fixes:retirePuts,size,stockStop";
  assert.equal(adoptRules(es4, ENGINES.technicals, TODAY).text, `${ENGINES.technicals.rules.before.note} ${ENGINES.technicals.rules.note}`); assert.equal(es4.rules, 5);
  // An engine on the honest paper trades (rules 4, as on main on 2026-11-19) gets the cap note only.
  const es5 = newEngineState(ENGINES.technicals); es5.rules = 4; es5.rulesKey = ENGINES.technicals.rules.before.key;
  const capMade = adoptRules(es5, ENGINES.technicals, TODAY);
  assert.equal(capMade.text, ENGINES.technicals.rules.note); assert.equal(es5.rules, 5); assert.equal(es5.rulesKey, ENGINES.technicals.rules.key);
  // Changing the cap in Owner Settings later is a logged change at the same rules number;
  // back at 10 the rules stay on 5 and the note says the range.
  const at10 = engineSpecs(undefined, undefined, null, 10), at12 = engineSpecs(undefined, undefined, null, 12);
  assert.equal(at10.technicals.rules.n, 4); assert.equal(at10.technicals.rules.key, `${ENGINES.technicals.rules.before.key}|cap:10`);
  assert.equal(at12.technicals.rules.n, 5); assert.match(at12.technicals.rules.note, /1 to 12 contracts \(was 1 to 10\)/);
  const down = adoptRules(es5, at10.technicals, TODAY);
  assert.equal(down.kind, "rules"); assert.match(down.text, /Size range: each risk-sized option trade buys 1 to 10 contracts\.$/); assert.equal(es5.rules, 5);
  assert.match(adoptRules(es5, at12.technicals, TODAY).text, /1 to 12 contracts\.$/); assert.equal(adoptRules(es5, at12.technicals, TODAY), null, "once");
  assert.equal(engineSpecs(undefined, undefined, null, 25), ENGINES); assert.equal(engineSpecs(undefined, undefined, null, 99), ENGINES, "out of range = the default");
  assert.deepEqual(at10.core ?? null, null); assert.equal(at10.trend, ENGINES.trend, "core engines have no cap step");
  // A state from before the switches (rules 3, no key) just takes the key.
  const es3 = newEngineState(ENGINES.reversion); delete es3.rulesKey;
  assert.equal(adoptRules(es3, ENGINES.reversion, TODAY), null); assert.equal(es3.rulesKey, ENGINES.reversion.rules.key); assert.equal(es3.v, 1);
  // Flipping the bounce fix off is a logged change on Reversion only, and so is flipping it back.
  const state = emptyState();
  stepBook(state, emptyRecord(), bookInput({}, { engines: ["technicals", "reversion"] }));
  let out = stepBook(state, emptyRecord(), bookInput({}, { engines: ["technicals", "reversion"], specs: engineSpecs({ bounce: false }), fixesOff: ["bounce"] }));
  assert.deepEqual(out.changes.map((c) => c.engine), ["reversion"]);
  assert.match(out.changes[0].text, /^Rule changes switched in Owner Settings\. On now: .*retired/); assert.doesNotMatch(out.changes[0].text, /0\.3 delta/);
  assert.equal(state.engines.reversion.v, 2); assert.equal(state.engines.reversion.log[0].kind, "rules");
  out = stepBook(state, emptyRecord(), bookInput({}, { engines: ["technicals", "reversion"], specs: engineSpecs({ bounce: false }), fixesOff: ["bounce"] }));
  assert.equal(out.changes.length, 0, "logged once");
  out = stepBook(state, emptyRecord(), bookInput({}, { engines: ["technicals", "reversion"] }));
  assert.deepEqual(out.changes.map((c) => c.engine), ["reversion"]); assert.match(out.changes[0].text, /0\.3 delta/); assert.equal(state.engines.reversion.v, 3);
  // Every fix off on an engine: back to rules 2's setups, logged, rules number kept.
  const allOff = Object.fromEntries(ENGINE_FIX_IDS.map((id) => [id, false]));
  out = stepBook(state, emptyRecord(), bookInput({}, { engines: ["reversion"], specs: engineSpecs(allOff), fixesOff: ENGINE_FIX_IDS }));
  assert.match(out.changes[0].text, /switched off in Owner Settings/); assert.equal(state.engines.reversion.rules, 7);
  // A trade opened with a fix off carries the ones that reach its engine.
  const rv = stepBook(emptyState(), emptyRecord(), bookInput({ CCC: V("CCC", WASHOUT()) }, { engines: ["reversion"], specs: engineSpecs({ bounce: false, stockStop: false }), fixesOff: ["bounce", "stockStop"] })).opened[0];
  assert.deepEqual(rv.fixesOff, ["bounce"]);
  const tc = stepBook(emptyState(), emptyRecord(), bookInput({ AAA: V("AAA", pullF()) }, { engines: ["technicals"], fixesOff: ["bounce"] })).opened[0];
  assert.equal(tc.fixesOff, undefined);
});
ok("paper trial: the RSI(2) dip buys shares, sells back above the 5-day average, and has its own switch", () => {
  // Registry: the RSI(2) trial on Reversion, shares only, labeled unproven, rules 4 on top of the fixes.
  assert.deepEqual(ENGINE_TRIAL_IDS, ["rsi2Dip", "fearIndex", "bigOrder", "optionSurge"]);
  const st = ENGINES.reversion.setups["rsi2-dip"];
  assert.equal(st.trial, true); assert.equal(st.calls, "shares"); assert.match(st.label, /paper trial/); assert.match(st.how, /unproven/i);
  // (The honest paper trades sit on top as rules 5: the trial is rules 4.)
  // (The contract cap of 2026-11-20 is rules 6 on top of those.)
  const revR = peel(ENGINES.reversion.rules);
  assert.equal(ENGINES.reversion.rules.n, 7, "the live data pack is rules 7 on top");
  assert.equal(revR.n, 6); assert.equal(revR.before.n, 5); assert.equal(revR.before.before.n, 4); assert.equal(revR.before.before.date, "2026-11-19");
  assert.match(revR.before.before.note, /paper trial/); assert.match(revR.key, /\|trials:rsi2Dip\|cap:25$/);
  assert.equal(ownerSettingDef("ENGINES_TRIAL_RSI2_DIP")?.default, true);
  // Switches: on by default, off with its own variable or with share trades off.
  assert.equal(engineSwitches({}).trials.rsi2Dip, true);
  assert.equal(engineSwitches({ ENGINES_TRIAL_RSI2_DIP: "0" }).trials.rsi2Dip, false);
  assert.equal(engineSwitches({ ENGINES_SHARES: "0" }).trials.rsi2Dip, false);
  assert.equal(engineSpecs(undefined, { rsi2Dip: true }), ENGINES);
  const off = engineSpecs(undefined, { rsi2Dip: false });
  assert.equal(off.reversion.setups["rsi2-dip"].retired, true); const offR = peel(off.reversion.rules); assert.equal(offR.n, 5); assert.equal(offR.before.n, 4); assert.equal(offR.before.before.n, 3);
  assert.match(off.reversion.rules.switchNote, /switched off/); assert.notEqual(off.reversion.rules.key, ENGINES.reversion.rules.key);
  assert.deepEqual(off.technicals, ENGINES.technicals);
  // The signal: above the 200-day with a 2-day RSI under 5; deeper scores higher.
  const dip = (over = {}) => baseF({ c: 100, pc: 101, sma5: 102, sma20: 101, sma200: 90, z20: -0.8, rsi2: 3, move5Atr: -1, ...over });
  const ev = (f) => evalReversion(V("DDD", f), CTX).filter((c) => c.setup === "rsi2-dip");
  assert.equal(ev(dip()).length, 1);
  assert.ok(ev(dip({ rsi2: 1 }))[0].score > ev(dip({ rsi2: 4.5 }))[0].score);
  assert.equal(ev(dip({ rsi2: 6 })).length, 0); assert.equal(ev(dip({ c: 85 })).length, 0); assert.equal(ev(dip({ sma5: null })).length, 0);
  // The book: $5,000 of stock, 10 sessions at most, stamped as a trial.
  const t = stepBook(emptyState(), emptyRecord(), bookInput({ DDD: V("DDD", dip()) }, { engines: ["reversion"], shares: true })).opened[0];
  assert.equal(t?.setup, "rsi2-dip"); assert.ok(isSharesTrade(t)); assert.equal(t.trial, true); assert.equal(t.exits.maxSessions, 10);
  assert.ok(t.stopLevel < 100 && t.targetLevel > 100, "the usual ATR stop and target");
  // Share trades off: the trial opens nothing (never a call).
  const none = stepBook(emptyState(), emptyRecord(), bookInput({ DDD: V("DDD", dip()) }, { engines: ["reversion"], shares: false }));
  assert.equal(none.opened.length, 0);
  // Switched off: retired, so it is not even listed.
  const ret = stepBook(emptyState(), emptyRecord(), bookInput({ DDD: V("DDD", dip()) }, { engines: ["reversion"], shares: true, specs: off }));
  assert.equal(ret.opened.length, 0);
  // The exit: a confirmed close after the signal back above the 5-day average.
  const tr = { engine: "reversion", setup: "rsi2-dip", side: "call", signalDate: "2026-11-10" };
  assert.equal(thesisCheck(tr, V("DDD", dip({ date: "2026-11-10", c: 103, sma5: 102 }))), null, "not on the signal bar itself");
  assert.equal(thesisCheck(tr, V("DDD", dip({ date: "2026-11-11", c: 101, sma5: 102 }))), null);
  assert.equal(thesisCheck(tr, V("DDD", dip({ date: "2026-11-11", c: 103, sma5: 102 }))), "target");
  assert.equal(ENGINE_TRIALS[0].engine, "reversion");
  // Kept apart: a washout on the same name still opens its own bounce call
  // beside the trial, the trial uses none of Reversion's slots or run places,
  // and a closed trial trade teaches the engine nothing.
  const both = stepBook(emptyState(), emptyRecord(), bookInput({ CCC: V("CCC", { ...WASHOUT(), sma5: 95 }) }, { engines: ["reversion"], shares: true }));
  assert.deepEqual(both.opened.map((x) => x.setup).sort(), ["oversold-bounce", "rsi2-dip"]);
  const many = Object.fromEntries(["D1", "D2", "D3", "D4", "D5", "D6"].map((s) => [s, V(s, dip())]));
  const st5 = emptyState(), rec5 = emptyRecord();
  const r1 = stepBook(st5, rec5, bookInput(many, { engines: ["reversion"], shares: true }));
  assert.equal(r1.opened.length, ENGINES.reversion.setups["rsi2-dip"].perRun, "the trial's own run limit");
  const tradeT = r1.opened[0]; tradeT.outcome = "loss";
  const es5 = st5.engines.reversion;
  const lost = stepBook(st5, rec5, bookInput({ [tradeT.symbol]: V(tradeT.symbol, dip({ c: 50, l: 49, date: "2026-12-01" })) }, { engines: ["reversion"], shares: true }));
  assert.ok(lost.closed.some((x) => x.trial), "the trial trade closed");
  assert.equal(es5.cooldown[tradeT.symbol], undefined, "no re-entry pause from a trial loss");
});
ok("paper trials and the Owner controls: Stop and Avoid hold them, Safer lets one open only on a quiet run, they count toward the daily limit", () => {
  const dip = (over = {}) => baseF({ c: 100, pc: 101, sma5: 102, sma20: 101, sma200: 90, z20: -0.8, rsi2: 3, move5Atr: -1, ...over });
  const ctl = (over = {}) => ({ stop: false, avoid: new Map(), watch: new Set(), catalysts: [], catalystSyms: new Set(), dial: null, any: true, limits: null, ...over });
  const safer = { ...DIAL.safer, at: NOW_AM, until: "2026-11-27T21:00:00.000Z" };
  const run = (views, c) => stepBook(emptyState(), emptyRecord(), bookInput(views, { engines: ["reversion"], shares: true, controls: c }));
  // Stop: no trial trade (and no shadow), and the reason shows in Check this stock.
  let out = run({ DDD: V("DDD", dip()) }, ctl({ stop: true }));
  assert.equal(out.opened.length, 0); assert.equal(out.checks.DDD.find((r) => r.setup === "rsi2-dip").why, "new trades stopped by the owner");
  assert.equal(out.checks.DDD.filter((r) => r.setup === "rsi2-dip").length, 1, "one check row per trial candidate");
  // Avoid.
  out = run({ DDD: V("DDD", dip()) }, ctl({ avoid: new Map([["DDD", { close: false }]]) }));
  assert.equal(out.opened.length, 0); assert.equal(out.checks.DDD[0].why, "on the owner's avoid list");
  // Safer: alone on the run, one trial opens (at half size); beside a real trade, none.
  out = run(Object.fromEntries(["D1", "D2", "D3"].map((s) => [s, V(s, dip())])), ctl({ dial: safer }));
  assert.equal(out.opened.length, 1); assert.equal(out.opened[0].trial, true);
  assert.ok(Object.values(out.checks).flat().some((r) => /one new trade a run/.test(r.why || "")), "the others say why");
  out = run({ CCC: V("CCC", { ...WASHOUT(), sma5: 95 }) }, ctl({ dial: safer }));
  assert.deepEqual(out.opened.map((x) => x.setup), ["oversold-bounce"], "the engine's own trade first, then no trial");
  out = run({ CCC: V("CCC", { ...WASHOUT(), sma5: 95 }) }, ctl());
  assert.deepEqual(out.opened.map((x) => x.setup).sort(), ["oversold-bounce", "rsi2-dip"], "Normal: both, as before");
  // The new-trades-a-day count includes the trial.
  assert.equal(out.controls.newToday, 2);
});
ok("paper trial: index funds after extreme fear buy shares for 20 sessions, decided on confirmed closes, with their own switch", () => {
  // Registry: on Macro, shares only, no stop or target, labeled unproven, rules 4.
  const st = ENGINES.macro.setups["fear-index"];
  assert.equal(st.trial, true); assert.equal(st.calls, "shares"); assert.equal(st.levels, false); assert.equal(st.exits.maxSessions, 20);
  assert.match(st.label, /paper trial/); assert.match(st.how, /unproven/i);
  const macR = peel(ENGINES.macro.rules);
  assert.equal(ENGINES.macro.rules.n, 7); assert.equal(macR.n, 6); assert.equal(macR.before.n, 5); assert.equal(macR.before.before.n, 4); assert.equal(macR.before.before.before.n, 3); assert.match(macR.key, /\|trials:fearIndex\|cap:25$/);
  assert.equal(ownerSettingDef("ENGINES_TRIAL_FEAR_INDEX")?.default, true);
  assert.equal(engineSwitches({}).trials.fearIndex, true);
  assert.equal(engineSwitches({ ENGINES_TRIAL_FEAR_INDEX: "off" }).trials.fearIndex, false);
  assert.equal(engineSwitches({ ENGINES_SHARES: "0" }).trials.fearIndex, false);
  const off = engineSpecs(undefined, { fearIndex: false });
  const offM = peel(off.macro.rules);
  assert.equal(off.macro.setups["fear-index"].retired, true); assert.equal(offM.n, 5); assert.equal(offM.before.n, 4); assert.equal(offM.before.before.n, 3);
  assert.equal(peel(off.reversion.rules).n, 6, "the other trial stays on"); assert.deepEqual(off.reversion.setups, ENGINES.reversion.setups);
  // The reading: the last two closes before today, never today's, never stale.
  assert.deepEqual(fearReading([["2026-11-17", 30], ["2026-11-18", 22], ["2026-11-19", 10]], "2026-11-19"), { date: "2026-11-18", score: 22, prevDate: "2026-11-17", prev: 30 });
  assert.deepEqual(fearReading([{ date: "2026-11-18", score: 22 }, { date: "2026-11-17", score: 30 }], "2026-11-19")?.prev, 30, "objects in any order");
  assert.equal(fearReading([["2026-11-01", 30], ["2026-11-02", 22]], "2026-11-19"), null, "stale");
  assert.equal(fearReading([["2026-11-18", 22]], "2026-11-19"), null);
  assert.deepEqual(fearReading([["2026-11-17", 20, 30], ["2026-11-18", 22, 31]], "2026-11-19"), { date: "2026-11-18", score: 22, prevDate: "2026-11-17", prev: 20 }, "a [date, score, vix] row reads the score, not the VIX");
  // The signal: a first close under 25, on SPY, QQQ and IWM, with no FRED input needed.
  const idx = Object.fromEntries(["SPY", "QQQ", "IWM"].map((s) => [s, V(s, baseF({ date: "2026-11-18" }), { isEtf: true })]));
  const fear = (score, prev) => ({ date: "2026-11-18", score, prevDate: "2026-11-17", prev });
  const ev = (fr) => evalMacro({ ...CTX, macro: null, byId: idx, fear: fr }).filter((c) => c.setup === "fear-index");
  assert.deepEqual(ev(fear(22, 30)).map((c) => c.symbol), ["SPY", "QQQ", "IWM"]);
  assert.equal(ev(fear(22, 30))[0].signalKey, "SPY|fear-index|2026-11-18");
  assert.ok(ev(fear(10, 30))[0].score > ev(fear(24, 30))[0].score);
  assert.equal(ev(fear(22, 24)).length, 0, "already under 25"); assert.equal(ev(fear(26, 30)).length, 0); assert.equal(ev(null).length, 0);
  // The book: three $5,000 share trades, 20 sessions, no stop or target, trial-stamped.
  const r = stepBook(emptyState(), emptyRecord(), bookInput(idx, { engines: ["macro"], shares: true, ctx: { ...CTX, macro: null, byId: idx, fear: fear(22, 30) } }));
  assert.equal(r.opened.length, 3);
  for (const t of r.opened) { assert.ok(isSharesTrade(t)); assert.equal(t.trial, true); assert.equal(t.exits.maxSessions, 20); assert.equal(t.stopLevel, null); assert.equal(t.targetLevel, null); }
  // Switched off or share trades off: nothing.
  assert.equal(stepBook(emptyState(), emptyRecord(), bookInput(idx, { engines: ["macro"], shares: true, specs: off, ctx: { ...CTX, macro: null, byId: idx, fear: fear(22, 30) } })).opened.length, 0);
  assert.equal(stepBook(emptyState(), emptyRecord(), bookInput(idx, { engines: ["macro"], shares: false, ctx: { ...CTX, macro: null, byId: idx, fear: fear(22, 30) } })).opened.length, 0);
});
ok("paper trials are scored apart: engine stats, the page rows and live against the test", () => {
  const sh = (setup, pnl, over = {}) => ({ engine: "reversion", setup, side: "call", status: pnl > 0 ? "target" : "stock-stop", outcome: pnl > 0 ? "win" : "loss", optionPnlPct: pnl, rulesVersion: "REV-4",
    entryDate: "2026-11-20T16:00:00.000Z", exitDate: "2026-11-24T16:00:00.000Z", contract: { structure: "shares", mid: 100, shares: 50, usd: 5000, costPct: 0.1 }, ...over });
  const rows = [sh("capitulation", 2), sh("capitulation", -1), ...Array.from({ length: 12 }, (_, i) => sh("rsi2-dip", i % 4 ? 1 : -2, { trial: true }))];
  const st = engineStats(rows);
  assert.equal(st.shares.n, 2, "the engine's own share trades only"); assert.equal(st.trials.n, 12); assert.equal(st.n, 0);
  assert.deepEqual(st.trials.bySetup.map((r) => r.key), ["rsi2-dip"]);
  assert.equal(engineStats(rows.filter((t) => !t.trial)).trials, null);
  const es = newEngineState(ENGINES.reversion); es.log = [{ date: "2026-11-19", v: "REV-4", kind: "rules", text: "x" }];
  const v = liveVsHistory(ENGINES.reversion, es, rows, [], { bySetup: [], shares: { bySetup: [{ key: "capitulation", n: 53, avg: 0.6 }] }, trials: { bySetup: [{ key: "rsi2-dip", n: 2439, avg: 0.4, winRate: 0.64 }] } });
  const tr = v.rows.find((r) => r.key === "rsi2-dip");
  assert.equal(tr.trial, true); assert.equal(tr.instrument, "shares"); assert.equal(tr.live.n, 12); assert.equal(tr.history.n, 2439);
  assert.equal(v.rows.filter((r) => r.key === "rsi2-dip").length, 1, "one row for a trial");
  assert.equal(v.rows.find((r) => r.key === "capitulation").live.n, 2);
  // The page file: trial flag on trade and setup rows, trial stats apart.
  const record = { ...emptyRecord(), closed: rows };
  const view = buildEnginesView({ record, state: emptyState(), ctx: CTX, builtAtIso: NOW_AM });
  const rev = view.engines.find((e) => e.id === "reversion");
  assert.equal(rev.trialStats.n, 12); assert.equal(rev.sharesStats.n, 2);
  assert.ok(rev.closed.filter((t) => t.trial).length === 12 && rev.closed.some((t) => !t.trial));
  assert.equal(rev.setups.find((x) => x.key === "rsi2-dip").trial, true); assert.equal(rev.setups.find((x) => x.key === "capitulation").trial, false);
  assert.equal(view.total.trials.n, 12); assert.equal(view.total.shares.n, 2);
  assert.equal(view.compare.find((c) => c.id === "reversion").trials.n, 12);
  // The Allocator page lists no trial setup, even with a stray table row for one.
  const av = allocView({ alloc: { table: { "reversion|rsi2-dip|call|s": { n: 9 } } } }, {}, ENGINES, SIGNAL_IDS, null);
  assert.ok(!av.rows.some((r) => r.setup === "rsi2-dip" || r.setup === "fear-index"), "trials sit outside the Allocator");
  assert.ok(av.rows.some((r) => r.setup === "capitulation"));
});
ok("fixes: live against the history test, setup by setup, from the current rules only", () => {
  const es = newEngineState(ENGINES.reversion);
  es.log = [{ date: "2026-11-17", v: "REV-3", kind: "rules", text: "x" }, { date: "2026-11-01", v: "REV-2", kind: "rules", text: "y" }];
  const tr = (i, pnl, over = {}) => ({ engine: "reversion", setup: "oversold-bounce", side: "call", status: pnl > 0 ? "take-profit" : "stop", outcome: pnl > 0 ? "win" : "loss",
    optionPnlPct: pnl, rulesVersion: "REV-3", entryDate: `2026-11-${String(10 + (i % 15)).padStart(2, "0")}T16:00:00.000Z`, exitDate: "2026-11-28T16:00:00.000Z", contract: { structure: "long", mid: 2, qty: 10 }, ...over });
  const closed = [...Array.from({ length: 12 }, (_, i) => tr(i, i % 3 ? 20 : -10)), ...Array.from({ length: 5 }, (_, i) => tr(i, -50, { rulesVersion: "REV-2" }))];
  const hist = { bySetup: [{ key: "oversold-bounce", n: 884, winRate: 0.56, avg: 7.7 }, { key: "overbought-fade", n: 284, avg: -10.3 }], shares: { bySetup: [{ key: "capitulation", n: 53, avg: 0.6 }] } };
  let v = liveVsHistory(ENGINES.reversion, es, closed, [], hist);
  assert.deepEqual(v.since, { date: "2026-11-17", v: "REV-3" });
  const b = v.rows.find((r) => r.key === "oversold-bounce" && r.instrument === "option");
  assert.equal(b.live.n, 12, "the five trades under rules 2 are left out"); assert.equal(b.live.avg, 10); assert.equal(b.history.avg, 7.7);
  assert.equal(b.diff, 2.3); assert.equal(b.read, "in-line");
  assert.equal(v.rows.find((r) => r.key === "capitulation").read, "too-early");
  assert.ok(!v.rows.some((r) => r.key === "overbought-fade"), "a retired setup has no row");
  v = liveVsHistory(ENGINES.reversion, es, closed.map((t) => ({ ...t, optionPnlPct: t.optionPnlPct + 20 })), [], hist);
  assert.equal(v.rows.find((r) => r.key === "oversold-bounce").read, "ahead");
  v = liveVsHistory(ENGINES.reversion, es, closed.slice(0, 9), [], hist);
  assert.equal(v.rows.find((r) => r.key === "oversold-bounce").read, "too-early", `under ${LIVE_VS_HISTORY.minLive} trades`);
  v = liveVsHistory(ENGINES.reversion, es, closed, [], null);
  assert.equal(v.rows.find((r) => r.key === "oversold-bounce").read, "no-history");
  // The split point outlives the 60-entry change log.
  const esOld = { ...es, rulesFrom: { date: "2026-11-17", v: "REV-3" }, log: Array.from({ length: 60 }, (_, i) => ({ date: "2027-06-01", v: `REV-${70 - i}`, kind: "bar", text: "z" })) };
  assert.equal(liveVsHistory(ENGINES.reversion, esOld, closed, [], hist).rows.find((r) => r.key === "oversold-bounce").live.n, 12);
  // Fresh engine: no rules entry, every trade counts.
  assert.equal(liveVsHistory(ENGINES.reversion, newEngineState(ENGINES.reversion), closed, [], hist).rows.find((r) => r.key === "oversold-bounce").live.n, 17);
  // The page file carries it, the fixes, the size and each setup's own contract and exits.
  const state = emptyState(); state.engines.reversion = es;
  const view = buildEnginesView({ record: { open: [], closed }, state, ctx: CTX, builtAtIso: NOW_AM, fixes: { ...engineSwitches({}).fixes, bounce: false }, specs: engineSpecs({ bounce: false }) });
  assert.deepEqual(view.fixes.map((f) => [f.id, f.on]), ENGINE_FIX_IDS.map((id) => [id, id !== "bounce"]));
  assert.equal(view.book.optionUsd, 2000);
  const rev = view.engines.find((e) => e.id === "reversion");
  assert.equal(rev.vsHistory.rows.length > 0, true); assert.deepEqual(rev.fixesOff, ["bounce"]);
  assert.equal(rev.setups.find((r) => r.key === "oversold-bounce").contract, null, "with the fix off the bounce has the engine's contract");
  assert.equal(rev.setups.find((r) => r.key === "overbought-fade").state, "retired");
  const on = buildEnginesView({ record: { open: [], closed: [] }, state: emptyState(), ctx: CTX, builtAtIso: NOW_AM });
  const r2 = on.engines.find((e) => e.id === "reversion").setups.find((r) => r.key === "oversold-bounce");
  assert.equal(r2.contract.delta, 0.3); assert.equal(r2.exitsAll.stop, -60); assert.deepEqual(on.engines.find((e) => e.id === "reversion").fixesOff, []);
  assert.equal(on.engines.find((e) => e.id === "technicals").sharesStopAtr, 3);
  assert.equal(on.engines.find((e) => e.id === "trend").vsHistory, null);
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
  // The rally fade is retired with Technicals shares only (2026-11-19); off, it is back on shadow.
  const out = stepBook(state, record, bookInput(views, { engines: ["technicals"], specs: engineSpecs({ tecShares: false }), ctx: { ...CTX, spy: baseF({ c: 400, sma50: 420, ret63: 0 }) } }));
  assert.equal(out.opened.length, 0); assert.equal(out.shadowOpened, 1);
  assert.match(out.candidates.technicals[0].why, /on shadow until it proves itself/);
  assert.equal(state.engines.technicals.shadow.open[0].setup, "rally-fade");
  assert.equal(record.open.length, 0);
});


// ---- honest paper trades (2026-11-19) ---------------------------------------
const RISK = { mode: "risk", budget: 2000, conviction: true };
// The live picker with the avoid set (index.mjs passes { avoid, symbol }).
const honestInput = (views, over = {}) => {
  const ms = Date.parse(over.nowIso || NOW_AM);
  const data = Object.fromEntries(Object.values(views).map((v) => [v.sym, { spot: v.spot, chains: chainFor(v.spot, Date.parse(NOW_AM)) }]));
  return bookInput(views, { chains: data, sizing: RISK, fillBasis: true,
    pick: (view, side, spec, c, o = {}) => pickContract(data[view.sym], side, contractFor(spec, c?.setup), { nowMs: ms, avoid: o.avoid || null, symbol: view.sym }), ...over });
};
ok("honest: the exit fill is the chain's bid, else the mid less half the entry spread", () => {
  assert.deepEqual(exitFill({ mid: 2, bid: 1.9, ask: 2.1, source: "chain" }, { spreadPct: 10 }), { px: 1.9, basis: "bid" });
  assert.deepEqual(exitFill({ mid: 2, source: "model" }, { spreadPct: 10 }), { px: 1.9, basis: "est" });
  assert.deepEqual(exitFill({ mid: 2, source: "model" }, {}), { px: 2, basis: "est" }, "no spread on file: the mid");
  assert.equal(exitFill({ mid: 0.01, source: "model" }, { spreadPct: 50 }).px, 0.01, "never under a cent");
  assert.equal(exitFill(null, {}), null); assert.equal(exitFill({ mid: 0 }, {}), null);
  // An option bought on the fill basis counts what it cost at the ask.
  assert.equal(entryPxOf({ mid: 2, entryFill: 2.1 }), 2.1); assert.equal(entryPxOf({ mid: 2 }), 2);
  assert.equal(positionUsd({ mid: 2, entryFill: 2.1, qty: 3 }), 630);
  assert.equal(flatPositionUsd({ mid: 2, entryFill: 2.1, qty: 6, flatQty: 3 }), 630); assert.equal(flatPositionUsd({ mid: 2, qty: 4 }), 800);
  assert.equal(flatPositionUsd({ structure: "shares", shares: 40, flatShares: 20, mid: 50 }), 1000);
});
ok("honest: risk sizing, 1 to the cap (25 since 2026-11-20); whole premium within 30 days, premium x stop x 1.25 past it", () => {
  const c = (over) => ({ mid: 2, ask: 2.1, dte: 21, ...over });
  // 21 days: the whole premium is at risk. At the ask: $210 a contract, 9 for $2,000.
  let z = sizeOption(c(), { sizing: { ...RISK, conviction: false }, exits: { stop: -60 }, fillBasis: true });
  assert.equal(z.qty, 9); assert.equal(z.flatQty, 9); assert.equal(z.size.risk1, 210); assert.match(z.size.basis, /whole premium/);
  assert.equal(sizeOption(c(), { sizing: { ...RISK, conviction: false }, exits: { stop: -60 } }).qty, 10, "on the mid: $200 a contract");
  assert.equal(sizeOption(c({ dte: 30 }), { sizing: RISK, exits: { stop: -40 } }).size.basis.startsWith("whole"), true, "30 days is still under a month");
  // 45 days, -40% stop: risk $100 x 0.4 x 1.25 = $50 a contract: 40 asked, capped at 25.
  z = sizeOption(c({ mid: 1, ask: 1, dte: 45 }), { sizing: RISK, exits: { stop: -40 } });
  assert.equal(z.size.risk1, 50); assert.equal(z.qty, 25); assert.equal(z.flatQty, 25); assert.equal(z.size.cap, 25); assert.equal(z.size.capped, true); assert.equal(z.size.wantQty, 40);
  assert.match(z.size.why, /the 25-contract cap set it; the budget asked for 40/);
  // An Owner Settings cap: 10 (the old one) and 1.
  z = sizeOption(c({ mid: 1, ask: 1, dte: 45 }), { sizing: { ...RISK, maxQty: 10 }, exits: { stop: -40 } });
  assert.equal(z.qty, 10); assert.equal(z.size.cap, 10); assert.equal(z.size.capped, true);
  assert.equal(sizeOption(c({ mid: 1, ask: 1, dte: 45 }), { sizing: { ...RISK, maxQty: 1 }, exits: { stop: -40 } }).qty, 1);
  assert.equal(sizeOption(c({ mid: 1, ask: 1, dte: 45 }), { sizing: { ...RISK, maxQty: 60 }, exits: { stop: -40 } }).qty, 25, "out of range = the default cap");
  // Under the old cap of 10 these three convictions all bought 10; with 25 they differ.
  const cv = (m) => sizeOption(c({ mid: 1.2, ask: 1.2, dte: 21 }), { sizing: RISK, exits: {}, conviction: { mult: m, parts: [] } }).qty;
  assert.deepEqual([cv(0.85), cv(1), cv(1.25)], [14, 16, 20]);
  assert.deepEqual([0.85, 1, 1.25].map((m) => sizeOption(c({ mid: 1.2, ask: 1.2, dte: 21 }), { sizing: { ...RISK, maxQty: 10 }, exits: {}, conviction: { mult: m, parts: [] } }).qty), [10, 10, 10]);
  z = sizeOption(c({ mid: 10, ask: 10, dte: 45 }), { sizing: RISK, exits: { stop: -40 } });
  assert.equal(z.size.risk1, 500); assert.equal(z.qty, 4); assert.equal(z.size.capped, false); assert.doesNotMatch(z.size.why, /cap/);
  // No stop on a long-dated option: the whole premium.
  assert.equal(sizeOption(c({ mid: 10, ask: 10, dte: 45 }), { sizing: RISK, exits: {} }).size.risk1, 1000);
  // A contract dearer than twice the budget is not bought; one that costs more than the budget still buys one.
  assert.equal(sizeOption(c({ mid: 41, ask: 41 }), { sizing: RISK, exits: {} }).dear, true);
  assert.equal(sizeOption(c({ mid: 30, ask: 30 }), { sizing: RISK, exits: {} }).qty, 1);
  // The conviction multiplier scales the risk, inside 1 to the cap.
  assert.equal(sizeOption(c({ mid: 5, ask: 5 }), { sizing: RISK, exits: {}, conviction: { mult: 2, parts: [] } }).qty, 8);
  assert.equal(sizeOption(c({ mid: 5, ask: 5 }), { sizing: RISK, exits: {}, conviction: { mult: 0.5, parts: [] } }).qty, 2);
  assert.equal(sizeOption(c({ mid: 5, ask: 5 }), { sizing: RISK, exits: {}, conviction: { mult: 0.1, parts: [] } }).qty, 1, "never under one");
  assert.equal(sizeOption(c({ mid: 5, ask: 5 }), { sizing: { ...RISK, conviction: false }, exits: {}, conviction: { mult: 2, parts: [] } }).qty, 4, "multiplier off: flat");
  // A fixed quantity (the extreme-fear test) wins; the other modes keep their sizes.
  assert.equal(sizeOption(c(), { sizing: RISK, exits: {}, fixedQty: 1, conviction: { mult: 2, parts: [] } }).qty, 1);
  assert.equal(sizeOption(c(), { sizing: { mode: "one" } }).qty, 1);
  assert.equal(sizeOption(c(), { sizing: { mode: "premium", optionUsd: 2000 } }).qty, 10);
  assert.equal(sizeOption(c({ mid: 0 , ask: 0 }), { sizing: RISK }).skip, "no price");
  // The budget comes from Owner Settings; a bad value falls back.
  assert.equal(engineSwitches({}).sizing.budget, 2000); assert.equal(engineSwitches({ ENGINES_RISK_USD: "3500" }).sizing.budget, 3500);
  for (const v of ["abc", "-5", "50", "1e9", ""]) assert.equal(engineSwitches({ ENGINES_RISK_USD: v }).sizing.budget, 2000, v);
  assert.deepEqual(engineSwitches({ ENGINES_RISK_SIZE: "0" }).sizing, { mode: "premium", optionUsd: 2000 });
  assert.equal(engineSwitches({ ENGINES_SIZE_MULTIPLIER: "0" }).sizing.conviction, false);
});
ok("honest: share trades risk the budget between entry and stop, capped in dollars", () => {
  let z = sizeShares(100, 94, { sizing: RISK });
  assert.equal(z.flatShares, 250); assert.equal(z.shares, 250); assert.equal(z.size.capped, true, "333 shares would be $33,300: capped at $25,000");
  z = sizeShares(100, 90, { sizing: RISK, conviction: { mult: 0.5, parts: [] } });
  assert.equal(z.flatShares, 200); assert.equal(z.shares, 100);
  z = sizeShares(30000, 29000, { sizing: RISK }); assert.equal(z.shares, 1, "at least one share");
  assert.equal(sizeShares(100, 101, { sizing: RISK }), null, "a stop over the price: keep the lot");
  assert.equal(sizeShares(100, null, { sizing: RISK }), null);
  assert.equal(sizeShares(100, 94, { sizing: { mode: "premium" } }), null);
});
ok("honest: the conviction multiplier is stated part by part and clamped to 0.5x-2x", () => {
  const W = SIZE_WEIGHTS;
  let r = convictionRead({ score: 60, bar: 60 });
  assert.equal(r.mult, W.scoreAtBar); assert.equal(r.parts[0].key, "score");
  assert.equal(convictionRead({ score: 60 + W.scoreSpan, bar: 60 }).mult, W.scoreTop);
  assert.equal(convictionRead({ score: 99, bar: 60 }).mult, W.scoreTop, "score past the span adds nothing more");
  r = convictionRead({ score: 70, bar: 60, alloc: { status: "open", w: 1.6 }, ivBand: "cheap", spreadPct: 4, option: true });
  assert.deepEqual(r.parts.map((p) => p.key), ["score", "allocator", "iv", "spread"]);
  assert.equal(r.raw, Math.round(1.05 * W.allocHigh * W.ivCheap * 100) / 100);
  r = convictionRead({ score: 60, bar: 60, alloc: { status: "closed" }, ivBand: "very-rich", spreadPct: 15, nameHeld: true, groupOpen: 3, option: true });
  assert.equal(r.mult, 0.5, "clamped at 0.5x"); assert.ok(r.raw < 0.5);
  assert.ok(r.parts.every((p) => typeof p.why === "string" && p.why.length > 5));
  assert.equal(convictionRead({ ivBand: "rich", spreadPct: 20, option: false }).parts.length, 0, "shares read no option inputs");
  // The weights are small: no one part moves the size by more than 25%.
  for (const [k, v] of Object.entries(W)) if (/X$|^(alloc|iv|name|score)(Held|High|Low|Cheap|Rich|VeryRich|AtBar|Top)$/.test(k)) assert.ok(v >= 0.75 && v <= 1.25, `${k}=${v}`);
});
ok("honest: a new option trade books the ask in and the bid out; stops still fire on the mid", () => {
  const views = { AAA: V("AAA", pullF()) };
  const state = emptyState(), record = emptyRecord();
  let out = stepBook(state, record, honestInput(views, { engines: ["technicals"], shares: false, specs: engineSpecs({ tecShares: false }, undefined, { technicals: "options" }) }));
  const t = out.opened[0];
  assert.ok(t && !isSharesTrade(t), "an option trade");
  assert.equal(t.fill.basis, "ask-bid"); assert.equal(t.fill.entry, t.contract.ask); assert.equal(t.contract.entryFill, t.contract.ask); assert.equal(t.fill.entryMid, t.contract.mid);
  assert.ok(t.optionPnlPct < 0, "starts at the spread's cost"); assert.equal(t.optionPnlPct, Math.round((t.contract.bid / t.contract.ask - 1) * 1000) / 10, "booked as if sold back at the bid");
  assert.equal(t.markPnlPct, 0, "the mid read starts at zero"); assert.equal(t.lastBid, t.contract.bid);
  // Prices in the trade text and the Webull mirror's exit ladder stay at the mid.
  assert.equal(markPrice(t), t.contract.mid);
  assert.ok(Number.isInteger(t.contract.qty) && t.contract.qty >= 1 && t.contract.qty <= 10); assert.ok(Number.isInteger(t.contract.flatQty));
  assert.equal(t.contract.size.mode, "risk"); assert.ok(t.contract.size.why.length > 20); assert.ok(Array.isArray(t.contract.size.parts) && t.contract.size.parts.length >= 1);
  // A later run: booked at the bid, the mid read kept beside it.
  out = stepBook(state, record, honestInput(views, { engines: ["technicals"], shares: false, nowIso: NOW_PM, late: true, marksOnly: true, specs: engineSpecs({ tecShares: false }, undefined, { technicals: "options" }) }));
  const m = record.open[0];
  assert.ok(m.lastBid > 0 && m.lastBid < m.lastMid, "the bid is under the mid");
  assert.equal(m.optionPnlPct, Math.round((m.lastBid / m.fill.entry - 1) * 10000) / 100);
  assert.ok(m.markPnlPct > m.optionPnlPct, "the mid read is kinder than the booked one");
  // Fill basis off: the mid both ways, as before.
  const old = stepBook(emptyState(), emptyRecord(), honestInput(views, { engines: ["technicals"], shares: false, fillBasis: false, specs: engineSpecs({ tecShares: false }, undefined, { technicals: "options" }) })).opened[0];
  assert.equal(old.fill, undefined); assert.equal(old.optionPnlPct, 0);
  // The page row carries the size and the fill.
  const row = buildEnginesView({ record, state, ctx: CTX, builtAtIso: NOW_AM, sizing: RISK, fixes: engineSwitches({}).fixes }).engines.find((e) => e.id === "technicals").open[0];
  assert.equal(row.fill.basis, "ask-bid"); assert.equal(row.size.mode, "risk"); assert.equal(row.contract.flatQty, t.contract.flatQty); assert.equal(row.lastBid, m.lastBid);
  assert.equal(typeof row.flatUsd, "number");
});
ok("honest: Technicals trades shares only; the squeeze's puts and the rally fade are retired", () => {
  assert.deepEqual(ENGINES.technicals.setups.squeeze.retiredSides, ["put"]); assert.equal(ENGINES.technicals.setups["rally-fade"].retired, true);
  assert.equal(isRetiredCand({ setup: "squeeze", side: "put" }, { retired: new Set(["squeeze|put"]) }), true);
  assert.equal(isRetiredCand({ setup: "squeeze", side: "call" }, { retired: new Set(["squeeze|put"]) }), false);
  for (const k of Object.keys(ENGINES.technicals.setups)) {
    const s = ENGINES.technicals.setups[k];
    if (s.retired) continue;
    assert.equal(instrumentFor(ENGINES.technicals, k, "call"), "shares", k);
    assert.ok((s.retiredSides || []).includes("put") || ["pullback", "breakout"].includes(k), `${k}: no live put side`);
  }
  const off = engineSpecs({ tecShares: false });
  assert.equal(off.technicals.setups.squeeze.retiredSides, undefined); assert.equal(off.technicals.setups["rally-fade"].retired, undefined);
  assert.equal(off.technicals.setups["rally-fade"].probation, true, "back on shadow as before");
  assert.deepEqual(off.reversion, ENGINES.reversion, "the switch reaches Technicals only");
});
ok("honest: the crash stand-aside skips a washout after a 7% one-day drop, and says so", () => {
  const go = (f, over = {}) => stepBook(emptyState(), emptyRecord(), honestInput({ CCC: V("CCC", f) }, { engines: ["reversion"], ...over }));
  let out = go(WASHOUT({ worst5: -0.075 }));
  assert.equal(out.opened.length, 0);
  assert.ok(out.candidates.reversion.some((c) => c.setup === "oversold-bounce" && /crash rule/.test(c.why || "")), JSON.stringify(out.candidates.reversion));
  out = go(WASHOUT({ worst5: -0.069 }));
  assert.equal(out.opened[0]?.setup, "oversold-bounce", "a 6.9% drop is not a crash");
  out = go(WASHOUT({ worst5: -0.075 }), { specs: engineSpecs({ crashStand: false }) });
  assert.equal(out.opened[0]?.setup, "oversold-bounce", "switch off: taken");
  assert.ok(out.opened[0].facts.worst5Pct === -7.5);
});
ok("honest: the extreme-fear test opens one call plus a shares twin on its own contract", () => {
  const fg = (score, over = {}) => ({ ...CTX, fearGreed: { score, asOf: TODAY, stale: false, source: "CNN", ...over } });
  const go = (ctx, over = {}) => { const state = emptyState(), record = emptyRecord(); const out = stepBook(state, record, honestInput({ CCC: V("CCC", WASHOUT()) }, { engines: ["reversion"], ctx, ...over })); return { out, record, state }; };
  let { out, record } = go(fg(18));
  const bounce = out.opened.find((t) => t.setup === "oversold-bounce"), test = out.opened.find((t) => t.setup === "fear-bounce" && !isSharesTrade(t)), twin = out.opened.find((t) => t.setup === "fear-bounce" && isSharesTrade(t));
  assert.ok(bounce && test && twin, out.opened.map((t) => t.tradeId).join());
  assert.equal(test.test, true); assert.equal(twin.test, true); assert.match(test.tradeId, /-XF$/); assert.match(twin.tradeId, /-XF$/);
  assert.equal(twin.twinOf, test.tradeId); assert.equal(test.twin, twin.tradeId);
  assert.equal(test.contract.qty, 1, "one contract"); assert.ok(twin.contract.shares >= 1);
  assert.notEqual(contractKey("CCC", test.contract), contractKey("CCC", bounce.contract), "its own contract at Webull");
  assert.ok(!test.noMirror && !bounce.noMirror, "neither rides on the other's fill");
  assert.match(test.reasons.join(" "), /Fear and greed 18/);
  // Twins take no slot: three test trades on three names, one a run.
  assert.equal(record.open.filter((t) => t.setup === "fear-bounce").length, 2);
  // No reading, a stale or old one, or 25 and over: no test trade.
  for (const ctx of [CTX, fg(18, { stale: true }), fg(18, { asOf: "2026-11-10" }), fg(25)]) assert.ok(!go(ctx).out.opened.some((t) => t.setup === "fear-bounce"), JSON.stringify(ctx.fearGreed || null));
  // Switch off: retired, the washout bounce alone.
  ({ out } = go(fg(18), { specs: engineSpecs({ fearBounce: false }) }));
  assert.deepEqual(out.opened.map((t) => t.setup), ["oversold-bounce"]);
  // The crash rule is built in.
  out = stepBook(emptyState(), emptyRecord(), honestInput({ CCC: V("CCC", WASHOUT({ worst5: -0.09 })) }, { engines: ["reversion"], ctx: fg(18) }));
  assert.equal(out.opened.length, 0); assert.ok(out.candidates.reversion.some((c) => c.setup === "fear-bounce" && /crash rule/.test(c.why || "")));
  // fearRead and the CNN snapshot.
  assert.deepEqual(fearGreedCtx({ score: 21.4, previous: { close: 24 }, asOf: "2026-11-19T15:00:00Z" }), { score: 21.4, prevClose: 24, asOf: "2026-11-19T15:00:00Z", stale: false, source: "CNN" });
  assert.equal(fearGreedCtx(null), null); assert.equal(fearGreedCtx({ score: "x" }), null);
  assert.equal(fearRead({ date: TODAY, fearGreed: { score: 20, asOf: "2026-11-13" } }).ok, true, "three days back (a weekend) still counts");
});
ok("merged with #870/#871: Owner controls come first, the dial and limits reach the twin, and the fear test and the RSI(2) trial never share a stock", () => {
  const fg = { ...CTX, fearGreed: { score: 18, asOf: TODAY, stale: false, source: "CNN" } };
  const ctl = (over = {}) => ({ stop: false, avoid: new Map(), watch: new Set(), catalysts: [], catalystSyms: new Set(), dial: null, any: true, limits: null, ...over });
  const views = () => ({ CCC: V("CCC", { ...WASHOUT(), sma5: 95 }) });
  const go = (over = {}, record = emptyRecord(), state = emptyState()) => ({ out: stepBook(state, record, honestInput(views(), { engines: ["reversion"], shares: true, ctx: fg, ...over })), record, state });
  // No controls: the washout bounce, the fear test (call + twin); the RSI(2) trial leaves the stock to the fear test.
  let { out } = go();
  const fear = out.opened.filter((t) => t.setup === "fear-bounce");
  assert.deepEqual(out.opened.map((t) => t.setup).sort(), ["fear-bounce", "fear-bounce", "oversold-bounce"]);
  assert.equal(out.checks.CCC.find((r) => r.setup === "rsi2-dip").why, "the extreme-fear test already holds this name");
  const base = { opt: fear.find((t) => !isSharesTrade(t)), twin: fear.find(isSharesTrade) };
  // Stop and Avoid hold every new trade first: no fear call, no twin, no trial, no shadow.
  for (const c of [ctl({ stop: true }), ctl({ avoid: new Map([["CCC", { close: false }]]) })]) {
    const r = go({ controls: c });
    assert.equal(r.out.opened.length, 0); assert.equal(r.out.shadowOpened, 0);
    assert.ok(r.out.checks.CCC.every((x) => /stopped by the owner|avoid list/.test(x.why || "")), JSON.stringify(r.out.checks.CCC));
  }
  // Riskier: 1.5x on the sized trade and on its twin, said on the size line, stamped.
  const riskier = { ...DIAL.riskier, at: NOW_AM, until: "2026-11-27T21:00:00.000Z" };
  ({ out } = go({ controls: ctl({ dial: riskier }) }));
  const rOpt = out.opened.find((t) => t.setup === "fear-bounce" && !isSharesTrade(t)), rTwin = out.opened.find((t) => t.setup === "fear-bounce" && isSharesTrade(t));
  assert.equal(rOpt.contract.qty, Math.max(1, Math.round(base.opt.contract.qty * 1.5)));
  assert.equal(rTwin.contract.shares, Math.floor(base.twin.contract.shares * 1.5)); assert.match(rTwin.contract.size.why, /risk dial/);
  assert.ok(rTwin.ownerControls && rOpt.ownerControls, "both carry the controls stamp");
  // A name limit that the option fits under and the twin would pass: the option opens, the twin does not.
  const optUsd = positionUsd(base.opt.contract) + positionUsd(out.opened.find((t) => t.setup === "oversold-bounce")?.contract || {});
  const lim = { any: true, openUsd: null, dayLossUsd: null, newPerDay: null, nameUsd: Math.ceil(optUsd + positionUsd(base.opt.contract) + 1) };
  ({ out } = go({ controls: ctl({ limits: lim }) }));
  assert.ok(out.opened.some((t) => t.setup === "fear-bounce" && !isSharesTrade(t)), "the fear call opens");
  assert.ok(!out.opened.some((t) => t.setup === "fear-bounce" && isSharesTrade(t)), "the twin passes the name limit");
  assert.match(out.candidates.reversion.find((r) => r.setup === "fear-bounce").twinWhy || "", /shares twin not opened: account limit/);
  // The twin counts toward the new-trades-a-day limit like any new trade.
  ({ out } = go({ controls: ctl({ limits: { any: true, openUsd: null, dayLossUsd: null, nameUsd: null, newPerDay: 50 } }) }));
  assert.equal(out.controls.newToday, out.opened.length);
  // A paper trial already holding the stock keeps it: the fear test stands aside, the washout bounce still opens.
  const record = emptyRecord();
  record.open.push({ engine: "reversion", setup: "rsi2-dip", trial: true, symbol: "CCC", side: "call", tradeId: "MR-CCC-T", entryDate: NOW_AM, contract: { structure: "shares", shares: 10, mid: 90 } });
  ({ out } = go({}, record));
  assert.deepEqual(out.opened.map((t) => t.setup), ["oversold-bounce"]);
  assert.equal(out.checks.CCC.find((r) => r.setup === "fear-bounce").why, "a paper trial already holds this name");
});
ok("honest: a test trade's results never move the engine's own learning", () => {
  const es = newEngineState(ENGINES.reversion);
  const t = (p, test) => ({ setup: test ? "fear-bounce" : "oversold-bounce", side: "call", optionPnlPct: p, exitDate: "2026-11-20", entryDate: "2026-11-18", score: 70, ...(test ? { test: true } : {}) });
  for (let i = 0; i < 12; i++) observe(es, t(-60, true));
  assert.equal(es.outcomes.length, 12); assert.ok(es.outcomes.every((o) => o.t === 1)); assert.equal(es.realSinceBar || 0, 0);
  const made = adapt(es, ENGINES.reversion, { today: "2026-11-20" });
  assert.equal(made.length, 0, "twelve test losses: no pause, no new bar, no mute"); assert.equal(es.paused, null);
  for (let i = 0; i < 12; i++) observe(es, t(-60, false));
  assert.ok(adapt(es, ENGINES.reversion, { today: "2026-11-20" }).some((c) => c.kind === "pause"), "the engine's own losses still pause it");
});
ok("honest: rules 4 is adopted once on a running engine, and every new trade says how it was sized", () => {
  // Reversion as it runs on main after #870 (rules 4, the paper trial): one change to rules 5.
  const es = newEngineState(ENGINES.reversion); es.rules = 4; es.rulesKey = "fixes:retirePuts,bounce,size|trials:rsi2Dip";
  const made = adoptRules(es, ENGINES.reversion, TODAY);
  assert.equal(made.kind, "rules"); assert.match(made.text, /^New rules \(honest paper trades\).*New rules \(wider size range\).*New rules \(live data pack\)/); assert.doesNotMatch(made.text, /paper trial is added/); assert.equal(es.rules, 7);
  assert.equal(adoptRules(es, ENGINES.reversion, TODAY), null);
  // An engine still on rules 3 gets both notes in one change, the trial first.
  const es3b = newEngineState(ENGINES.reversion); es3b.rules = 3; es3b.rulesKey = "fixes:retirePuts,bounce,size";
  const both = adoptRules(es3b, ENGINES.reversion, TODAY);
  assert.match(both.text, /^New rules: a paper trial is added.*New rules \(honest paper trades\)/); assert.equal(es3b.rules, 7);
  // Earnings (no trial): rules 3 to 4.
  const ee = newEngineState(ENGINES.earnings); ee.rules = 3; ee.rulesKey = "fixes:size";
  assert.match(adoptRules(ee, ENGINES.earnings, TODAY).text, /^New rules \(honest paper trades\)/); assert.equal(ee.rules, 6);
  // Shares on the conviction size with the flat size kept.
  const sh = stepBook(emptyState(), emptyRecord(), honestInput({ AAA: V("AAA", pullF()) }, { engines: ["technicals"], shares: true })).opened[0];
  assert.ok(isSharesTrade(sh)); assert.ok(Number.isInteger(sh.contract.flatShares)); assert.equal(sh.contract.size.mode, "risk"); assert.match(sh.contract.size.why, /a share/);
  // The comparison line: the same trades at both sizes.
  const done = [{ ...sh, outcome: "win", optionPnlPct: 10, status: "take-profit", contract: { ...sh.contract, shares: 100, flatShares: 50, mid: 20 } }];
  const z = sizingCompare(done, []);
  assert.equal(z.shares.n, 1); assert.equal(z.shares.usd, 200); assert.equal(z.shares.flatUsd, 100); assert.equal(z.shares.bigger, 1);
  assert.equal(flatTradeUsd(done[0]), 100);
});

ok("contract cap: an Owner Settings number from 1 to 25, and a size-bucket read of whether bigger trades do better", () => {
  // The switch: 25 unless set; a whole number from 1 to 25, else the default.
  assert.equal(BOOK.riskMaxQty, 25); assert.equal(BOOK.riskMaxQtyBefore, 10);
  assert.equal(engineSwitches({}).sizing.maxQty, 25); assert.equal(engineSwitches({}).maxQty, 25);
  assert.equal(engineSwitches({ ENGINES_MAX_QTY: "12" }).sizing.maxQty, 12); assert.equal(engineSwitches({ ENGINES_MAX_QTY: " 1 " }).sizing.maxQty, 1);
  for (const bad of ["0", "26", "2.5", "x", ""]) assert.equal(engineSwitches({ ENGINES_MAX_QTY: bad }).sizing.maxQty, 25, bad);
  assert.equal(engineSwitches({ ENGINES_RISK_SIZE: "0" }).sizing.maxQty, undefined, "not risk sizing: no cap in play");
  const def = ownerSettingDef("ENGINES_MAX_QTY");
  assert.equal(def.default, 25); assert.equal(def.min, 1); assert.equal(def.max, 25); assert.equal(def.impact, "high");
  // A live trade records the cap, the count asked for and whether the cap set it.
  const t = stepBook(emptyState(), emptyRecord(), honestInput({ CCC: V("CCC", WASHOUT()) }, { engines: ["reversion"] })).opened.find((x) => !isSharesTrade(x));
  assert.ok(t, "a washout opens an option trade"); { assert.equal(t.contract.size.cap, 25); assert.equal(typeof t.contract.size.capped, "boolean"); assert.ok(Number.isInteger(t.contract.size.wantQty)); }
  // A lower cap from Owner Settings holds the trade under it.
  const dialRun = stepBook(emptyState(), emptyRecord(), honestInput({ CCC: V("CCC", WASHOUT()) }, { engines: ["reversion"], sizing: { ...RISK, maxQty: 3 } })).opened.find((x) => !isSharesTrade(x));
  assert.ok(dialRun); assert.ok(contractsOf(dialRun.contract) <= 3); assert.equal(dialRun.contract.size.cap, 3);
  // The buckets: closed risk-sized trades by the multiplier and by contracts.
  const tr = (mult, qty, pnl, extra = {}) => ({ engine: "reversion", outcome: pnl > 0 ? "win" : "loss", optionPnlPct: pnl, status: "take-profit",
    contract: { structure: "long", mid: 1, qty, flatQty: Math.max(1, Math.round(qty / mult)), size: { mode: "risk", mult, capped: qty === 25 } }, ...extra });
  const rows = [];
  for (let i = 0; i < SIZE_READ_MIN; i++) { rows.push(tr(1.4, 20, 12)); rows.push(tr(0.7, 4, -6)); }
  rows.push(tr(1, 10, 5)); rows.push(tr(1.9, 25, 30)); rows.push(tr(1, 1, -50, { test: true }));
  const z = sizingCompare(rows, []);
  const b = z.buckets, band = (k) => b.options.bands.find((x) => x.key === k);
  assert.equal(band("up").n, SIZE_READ_MIN + 1); assert.equal(band("down").n, SIZE_READ_MIN); assert.equal(band("flat").n, 1, "the labeled test is left out");
  assert.equal(band("down").winRate, 0); assert.equal(band("down").avg, -6); assert.equal(band("flat").avg, 5);
  assert.equal(b.options.read.state, "helps"); assert.ok(b.options.read.gap > 18);
  assert.deepEqual(b.byQty.map((x) => [x.label, x.n]), [["1-2", 0], ["3-5", SIZE_READ_MIN], ["6-10", 1], ["11-17", 0], ["18-25", SIZE_READ_MIN + 1]]);
  assert.equal(b.capped.options, 1); assert.equal(b.capped.recorded, rows.length - 1);
  // Too few on one side: no verdict.
  const few = sizingCompare(rows.slice(0, 6), []).buckets.options.read;
  assert.equal(few.state, "too-few"); assert.equal(few.need, SIZE_READ_MIN);
  // A worse sized-up group reads as hurting.
  const flip = sizingCompare(rows.slice(0, 2 * SIZE_READ_MIN).map((r) => ({ ...r, optionPnlPct: -r.optionPnlPct })), []).buckets.options.read;
  assert.equal(flip.state, "hurts");
  // The page row carries the cap read.
  const view = buildEnginesView({ record: { open: [], closed: rows.slice(0, 3) }, state: emptyState(), ctx: CTX, builtAtIso: NOW_AM, sizing: engineSwitches({}).sizing });
  assert.equal(view.sizing.maxQty, 25); assert.equal(view.sizing.maxQtyBefore, 10); assert.ok(view.sizing.compare.buckets);
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
    // Core engines are outside the book's per-run limit (share trades never reach Webull).
    // Paper trials are outside it too (their own slots and run limit).
    assert.ok(res.summary.opened - res.summary.openedCore - res.summary.openedTrial <= BOOK.perRunTotal);
    assert.deepEqual(res.summary.errors, []);
    for (const id of ENGINE_IDS) assert.ok(res.record.open.filter((t) => t.engine === id && !t.trial).length <= ENGINES[id].slots, id);
    for (const t of ENGINE_TRIALS) assert.ok(res.record.open.filter((x) => x.trial && x.setup === t.setup).length <= ENGINES[t.engine].setups[t.setup].slots, t.id);
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
    if (t.contract.structure === "shares") {
      // A share trade: long stock only, never mirrored, ID marked S.
      assert.equal(t.side, "call"); assert.match(t.tradeId, /-S-/); assert.ok(t.contract.shares >= 1 && t.contract.mid > 0 && !t.contract.expiry);
      assert.ok(ENGINES[t.engine].setups[t.setup].calls === "shares");
    } else { assert.equal(t.contract.structure, "long"); assert.ok(t.contract.strike > 0 && t.contract.expiry > 0 && t.contract.mid > 0); }
    assert.ok(t.env && "rates" in t.env, "macro backdrop tags are on every trade");
    assert.equal(t.regime.cell, "up-calm");
  }
  for (const t of rec.closed) { assert.ok(t.exitDate && CLOSE_LABEL[t.status], t.status); assert.ok(["win", "loss", "flat", "void"].includes(t.outcome)); }
  assert.equal(st.runs.length, runs);
  assert.ok(st.replay && st.replay.date === "2026-11-25" && !st.replay.error, JSON.stringify(st.replay).slice(0, 200));
  // The page file.
  assert.equal(view.engines.length, 9);
  assert.deepEqual(view.engines.map((e) => e.id), ENGINE_IDS);
  assert.equal(view.engines.reduce((a, e) => a + e.open.length, 0), rec.open.length);
  assert.equal(view.compare.length, 9);
  // The core engines: a monthly target from the October month-end, held as share lots.
  for (const id of CORE_IDS) {
    const e = view.engines.find((x) => x.id === id);
    assert.equal(e.core, true); assert.equal(e.holdings.month, "2026-10");
    assert.ok(e.holdings.why && e.holdings.log.length >= 1, id);
    assert.deepEqual([...e.holdings.held].sort(), [...e.holdings.hold].sort(), `${id} holds its target`);
    assert.ok(e.open.every((t) => t.instrument === "shares" && !t.exits?.maxSessions && t.stopLevel == null), id);
    assert.equal(e.holdings.bench.since, "2026-11-16"); assert.ok(e.holdings.bench.spyThen > 0);
  }
  const mom = view.engines.find((x) => x.id === "momentum");
  if (mom.holdings.setups && Object.values(mom.holdings.setups).includes("top-10")) {
    assert.equal(mom.open.length, 10);
    assert.ok(mom.open.every((t) => Math.abs(t.contract.shares * t.contract.mid - ENGINES.momentum.lotUsd) < t.contract.mid + 1), "a $3,000 lot each");
  }
  assert.equal(view.total.core.open, rec.open.filter((t) => CORE_IDS.includes(t.engine)).length);
  // The Allocator: a row for every live setup, today's market type, and the history test's read.
  assert.equal(view.allocator.mode, "advise"); assert.equal(view.allocator.cell, "up-calm");
  assert.ok(view.allocator.rows.length >= SIGNAL_IDS.length);
  assert.ok(view.allocator.rows.every((r) => SIGNAL_IDS.includes(r.engine)));
  assert.ok(rec.open.filter((t) => SIGNAL_IDS.includes(t.engine) && !t.trial).every((t) => t.alloc && t.alloc.mode === "advise"), "every signal trade carries the Allocator's stamp");
  assert.ok(rec.open.filter((t) => t.trial).every((t) => !t.alloc), "paper trials are outside the Allocator");
  assert.ok(rec.open.filter((t) => CORE_IDS.includes(t.engine)).every((t) => !t.alloc), "core holdings are not allocated");
  assert.equal(view.engines.find((e) => e.id === "technicals").history.live.n, 3);
  assert.ok(view.engines.find((e) => e.id === "technicals").replay?.held, "the recent replay is on the page");
  assert.equal(view.engines.find((e) => e.id === "flow").replay?.held ?? null, null, "Flow has no replay");
  assert.equal(view.engines.find((e) => e.id === "technicals").setups.find((s) => s.key === "rally-fade").state, "retired", "retired with Technicals shares only (2026-11-19)");
  assert.equal(view.market.regime.cell, "up-calm"); assert.equal(view.market.env.rates, "on hold");
  assert.equal(view.health.views, Object.keys(SERIES).length);
  assert.equal(lastView.runIso, "2026-11-25T20:30:00.000Z");
  // Confirmed bars only: today's partial bar never reaches a feature row.
  for (const t of [...rec.open, ...rec.closed]) assert.ok(String(t.signalDate).replace("pre-", "") !== String(t.entryDate).slice(0, 10) || t.engine === "earnings" || t.engine === "fundamentals");   // a rank trade is dated the day the stock was ranked
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

// ---- core engines (Trend follower, Momentum basket) ----------------------------
// Month-end closes ending at `last` ("YYYY-MM"), oldest first.
const moSeries = (last, closes) => {
  const [y, m] = last.split("-").map(Number);
  return closes.map((c, k) => { const ym = new Date(Date.UTC(y, m - 1 - (closes.length - 1 - k), 1)).toISOString().slice(0, 7); return { m: ym, d: `${ym}-28`, c }; });
};
const ramp = (a, b, n = 14) => Array.from({ length: n }, (_, k) => a + ((b - a) * k) / (n - 1));
const coreView = (sym, closes, { last = "2026-10", etf = true, spot = null } = {}) => {
  const mo = moSeries(last, closes), px = spot ?? mo.at(-1).c;
  return { sym, isEtf: etf, spot: px, f: baseF({ c: px, atr: px * 0.02 }), mo };
};
const coreCtx = (cash = 4) => ({ ...CTX, macro: { cash12: cash } });
ok("month-end closes: only months that have ended, read through the prior close", () => {
  const bars = weekdays("2026-11-13", 320).map((t, i) => ({ t, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1e6 }));
  const P = precompute(bars);
  const me = monthEnds(P, P.n - 1, "2026-11-16", 14);
  assert.equal(me.length, 14);
  assert.deepEqual(me.at(-1), { m: "2026-10", d: "2026-10-30", c: bars.find((b) => b.t === "2026-10-30").c });
  for (const x of me) { const j = bars.findIndex((b) => b.t === x.d); assert.notEqual(bars[j + 1].t.slice(0, 7), x.m); }
  // On the first run of December the last bar on hand closes November.
  assert.equal(monthEnds(P, P.n - 1, "2026-12-01", 14).at(-1).m, "2026-11");
  // Read as of an earlier bar: nothing after it is seen.
  const i = bars.findIndex((b) => b.t === "2026-06-10");
  assert.equal(monthEnds(P, i, "2026-06-11", 14).at(-1).m, "2026-05");
  assert.equal(ret12(me), me.at(-1).c / me.at(-13).c - 1);
  assert.equal(ret12skip1(me), me.at(-2).c / me.at(-13).c - 1);
  assert.equal(avg10(me), me.slice(-10).reduce((a, x) => a + x.c, 0) / 10);
});
ok("Trend follower: the stronger index fund, else Treasuries, else T-bills", () => {
  let r = trendRead({ SPY: coreView("SPY", ramp(400, 480)), QQQ: coreView("QQQ", ramp(300, 330)), TLT: coreView("TLT", ramp(100, 100)) }, coreCtx());
  assert.deepEqual(r.hold, ["SPY"]); assert.equal(r.setups.SPY, "index"); assert.equal(r.month, "2026-10"); assert.match(r.why, /SPY rose/);
  r = trendRead({ SPY: coreView("SPY", ramp(400, 480)), QQQ: coreView("QQQ", ramp(300, 400)), TLT: coreView("TLT", ramp(100, 100)) }, coreCtx());
  assert.deepEqual(r.hold, ["QQQ"]);
  // Neither index beat T-bills; Treasuries did.
  r = trendRead({ SPY: coreView("SPY", ramp(400, 402)), QQQ: coreView("QQQ", ramp(300, 301)), TLT: coreView("TLT", ramp(90, 100)) }, coreCtx());
  assert.deepEqual(r.hold, ["TLT"]); assert.equal(r.setups.TLT, "bonds");
  // Nothing beat T-bills: cash.
  r = trendRead({ SPY: coreView("SPY", ramp(400, 380)), QQQ: coreView("QQQ", ramp(300, 290)), TLT: coreView("TLT", ramp(100, 95)) }, coreCtx());
  assert.deepEqual(r.hold, []); assert.match(r.why, /holding T-bills/);
  // A missing number: no read (the stored target stands).
  assert.equal(trendRead({ SPY: coreView("SPY", ramp(400, 480)), QQQ: coreView("QQQ", ramp(300, 330)) }, { ...CTX, macro: {} }), null);
  // A fund whose month-ends stop a month early is not read as current.
  assert.equal(trendRead({ SPY: coreView("SPY", ramp(400, 480)), QQQ: coreView("QQQ", ramp(300, 400), { last: "2026-09" }) }, coreCtx()), null);
});
// 25 stocks: S00 the strongest over 12-1 months, S24 the weakest; J00 jumps
// only in the latest month (left out of 12-1 momentum).
function momViews({ spyCloses = ramp(400, 480), tlt = ramp(100, 100), last = "2026-10" } = {}) {
  const v = { SPY: coreView("SPY", spyCloses, { last }), TLT: coreView("TLT", tlt, { last }) };
  for (let i = 0; i < 25; i++) v[`S${String(i).padStart(2, "0")}`] = coreView(`S${String(i).padStart(2, "0")}`, ramp(50, 50 + (25 - i) * 4), { etf: false, last });
  v.J00 = coreView("J00", [...ramp(50, 50, 13), 200], { etf: false, last });
  return v;
}
ok("Momentum basket: the ten strongest on 12-1 momentum, Treasuries or T-bills while SPY is under its 10-month average", () => {
  let r = momentumRead(momViews(), coreCtx());
  assert.deepEqual(r.hold, ["S00", "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09"]);
  assert.ok(Object.values(r.setups).every((s) => s === "top-10"));
  assert.equal(r.ranked[0].symbol, "S00"); assert.equal(r.reads.ranked, 26);
  assert.ok(!r.hold.includes("J00"), "the latest month's jump is left out");
  // SPY under its 10-month average: TLT when it beat T-bills, else cash.
  const weak = [...ramp(400, 480, 10), 470, 440, 420, 400];
  r = momentumRead(momViews({ spyCloses: weak, tlt: ramp(90, 100) }), coreCtx());
  assert.deepEqual(r.hold, ["TLT"]); assert.equal(r.setups.TLT, "safe"); assert.equal(r.reads.spyAbove, false);
  r = momentumRead(momViews({ spyCloses: weak, tlt: ramp(100, 95) }), coreCtx());
  assert.deepEqual(r.hold, []);
  // Fewer than 20 ranked names: no read.
  const few = momViews(); for (let i = 5; i < 25; i++) delete few[`S${String(i).padStart(2, "0")}`];
  assert.equal(momentumRead(few, coreCtx()), null);
});
ok("core target: replaced only by a later month, with the swaps logged", () => {
  const es = {};
  const v1 = { SPY: coreView("SPY", ramp(400, 480)), QQQ: coreView("QQQ", ramp(300, 330)), TLT: coreView("TLT", ramp(100, 100)) };
  standCore(es, "trend", v1, coreCtx(), { today: "2026-11-16" });
  assert.deepEqual(es.core.hold, ["SPY"]); assert.equal(es.coreLog.length, 1); assert.deepEqual(es.coreLog[0].in, ["SPY"]);
  // Same month again (a second run): unchanged even if a quote moved.
  standCore(es, "trend", { ...v1, QQQ: coreView("QQQ", ramp(300, 500)) }, coreCtx(), { today: "2026-11-16" });
  assert.deepEqual(es.core.hold, ["SPY"]); assert.equal(es.coreLog.length, 1);
  // A read that cannot be made keeps the stored target.
  standCore(es, "trend", {}, coreCtx(), { today: "2026-12-01" });
  assert.deepEqual(es.core.hold, ["SPY"]);
  // The next month: QQQ leads.
  const v2 = { SPY: coreView("SPY", ramp(400, 480), { last: "2026-11" }), QQQ: coreView("QQQ", ramp(300, 420), { last: "2026-11" }), TLT: coreView("TLT", ramp(100, 100), { last: "2026-11" }) };
  standCore(es, "trend", v2, coreCtx(), { today: "2026-12-01" });
  assert.deepEqual(es.core.hold, ["QQQ"]); assert.equal(es.core.since, "2026-12-01");
  assert.deepEqual(es.coreLog[0].in, ["QQQ"]); assert.deepEqual(es.coreLog[0].out, ["SPY"]);
});
ok("book: core holdings open as share lots outside the run limit, swap as 'rotate', never learn", () => {
  const state = emptyState(), record = emptyRecord();
  const v1 = { SPY: coreView("SPY", ramp(400, 500)), QQQ: coreView("QQQ", ramp(300, 330)), TLT: coreView("TLT", ramp(100, 100)) };
  let out = stepBook(state, record, bookInput(v1, { engines: ["trend"], ctx: { ...coreCtx(), byId: v1 }, maxTotal: 0 }));
  assert.equal(out.opened.length, 1, "the book's run limit does not hold back a core holding");
  const t = out.opened[0];
  assert.equal(t.symbol, "SPY"); assert.equal(t.setup, "index"); assert.equal(t.contract.structure, "shares");
  assert.equal(t.contract.shares, 100); assert.match(t.tradeId, /^TRD:SPY-S-/);
  assert.deepEqual(t.exits, {}); assert.equal(t.stopLevel, null); assert.equal(t.targetLevel, null); assert.ok(!t.alloc);
  assert.ok(state.engines.trend.bench && state.engines.trend.bench.date === "2026-11-16");
  // A later run in the same month, price down 20%: held (no stop).
  const v1b = { ...v1, SPY: { ...v1.SPY, spot: 400 } };
  const day2 = { ...bookInput(v1b, { engines: ["trend"], ctx: { ...coreCtx(), byId: v1b }, nowIso: "2026-11-17T16:00:00.000Z" }) };
  out = stepBook(state, record, day2);
  assert.equal(out.closed.length, 0); assert.equal(record.open[0].optionPnlPct, -20.1);
  // December's check picks QQQ: SPY closes as "rotate" and QQQ opens in the same run.
  const v2 = { SPY: coreView("SPY", ramp(400, 480), { last: "2026-11", spot: 400 }), QQQ: coreView("QQQ", ramp(300, 420), { last: "2026-11" }), TLT: coreView("TLT", ramp(100, 100), { last: "2026-11" }) };
  out = stepBook(state, record, bookInput(v2, { engines: ["trend"], ctx: { ...coreCtx(), byId: v2 }, nowIso: "2026-12-01T16:00:00.000Z" }));
  assert.deepEqual(out.closed.map((x) => [x.symbol, x.status, x.outcome]), [["SPY", "rotate", "loss"]]);
  assert.deepEqual(out.opened.map((x) => x.symbol), ["QQQ"]);
  assert.equal(CLOSE_LABEL.rotate, "swapped at the monthly check");
  // No learning on a core engine, and a loss leaves no cooldown that matters.
  assert.equal(state.engines.trend.v || 1, 1);
  assert.equal(thesisCheck({ engine: "trend" }, { core: { trend: false } }), "rotate");
  assert.equal(thesisCheck({ engine: "trend" }, { core: { trend: true } }), null);
  assert.equal(thesisCheck({ engine: "trend" }, { core: { momentum: false } }), null);
});
ok("book: the Momentum basket buys ten $3,000 lots, then moves the whole basket to Treasuries", () => {
  const state = emptyState(), record = emptyRecord();
  const v1 = momViews();
  let out = stepBook(state, record, bookInput(v1, { engines: ["momentum"], ctx: { ...coreCtx(), byId: v1 }, maxTotal: 2 }));
  assert.equal(out.opened.length, 10);
  for (const t of out.opened) { assert.ok(Math.abs(positionUsd(t.contract) - 3000) <= t.contract.mid); assert.equal(t.setup, "top-10"); }
  const weak = [...ramp(400, 480, 10), 470, 440, 420, 400];
  const v2 = momViews({ spyCloses: weak, tlt: ramp(90, 100), last: "2026-11" });
  out = stepBook(state, record, bookInput(v2, { engines: ["momentum"], ctx: { ...coreCtx(), byId: v2 }, nowIso: "2026-12-01T16:00:00.000Z" }));
  assert.equal(out.closed.length, 10); assert.ok(out.closed.every((t) => t.status === "rotate"));
  assert.deepEqual(out.opened.map((t) => [t.symbol, t.setup]), [["TLT", "safe"]]);
  assert.ok(Math.abs(positionUsd(out.opened[0].contract) - 30000) <= 100, "the whole basket's money");
});
ok("history test: the core engines are scored as a portfolio against SPY", () => {
  const res = runBacktest({ series: SERIES, isEtf: (s) => MACRO_ETFS.includes(s), from: SERIES_DATES[300], engines: ["trend", "momentum"], control: 0,
    fred: { DFF: { t: SERIES_DATES, v: SERIES_DATES.map(() => 4) } } });
  for (const id of ["trend", "momentum"]) {
    const c = res.engines[id].core;
    assert.ok(c && c.years > 0 && Number.isFinite(c.cagr) && Number.isFinite(c.spyCagr), id);
    assert.ok(c.maxDrawdown <= 0 && c.spyMaxDrawdown <= 0 && c.invested >= 0 && c.invested <= 100, id);
    assert.ok(c.byYear.length >= 1);
  }
  assert.ok(publicResult(res).engines.trend.core, "the public copy carries the portfolio line");
});

// ---- the Allocator ------------------------------------------------------------
ok("Allocator: normal size until 30 results, then held back or sized by today's market", () => {
  const st = {};
  const mk = (p, cell, shares = false) => ({ engine: "technicals", setup: "pullback", side: "call", optionPnlPct: p, outcome: p > 0 ? "win" : "loss", regime: { cell }, contract: shares ? { structure: "shares" } : { strike: 1 }, exitDate: "2026-11-10T20:00:00.000Z" });
  const key = allocKey("technicals", "pullback", "call", "option");
  for (let i = 0; i < 29; i++) allocObserve(st, mk(i % 2 ? 10 : -14, "down-calm"));
  let d = allocDecide(st, null, key, "down-calm");
  assert.equal(d.status, "new"); assert.equal(d.w, 1); assert.equal(d.open, true);
  allocObserve(st, mk(-2 * 30 - (st.alloc.table[key]["*"][1]), "down-calm"));   // brings the 30 to an average of -2
  d = allocDecide(st, null, key, "down-calm");
  assert.equal(d.n, 30); assert.equal(d.avg, -2); assert.equal(d.status, "closed"); assert.equal(d.open, false); assert.match(d.why, /trending-down, calm/);
  // Thirty more in up-calm averaging +10: the overall average is +4.
  for (let i = 0; i < 30; i++) allocObserve(st, mk(10, "up-calm"));
  assert.equal(allocDecide(st, null, key, "up-calm").ev, 7);      // 0.5 x 10 + 0.5 x 4
  assert.equal(allocDecide(st, null, key, "up-calm").w, 1.75);
  assert.equal(allocDecide(st, null, key, "down-calm").w, 0.25);  // 0.5 x -2 + 0.5 x 4 = 1
  assert.equal(allocDecide(st, null, key, "chop-calm").w, 1);     // no record there: the overall +4
  // A share result counts 5x, on its own row.
  allocObserve(st, mk(1, "up-calm", true));
  assert.deepEqual(st.alloc.table[allocKey("technicals", "pullback", "call", "shares")]["*"], [1, 5]);
  // Void trades are not counted.
  allocObserve(st, { ...mk(50, "up-calm"), outcome: "void" });
  assert.equal(st.alloc.table[key]["*"][0], 60);
  // A prior adds to the live record.
  const prior = allocPriorFrom(Array.from({ length: 40 }, () => mk(-5, "chop-calm")));
  d = allocDecide({}, prior, key, "chop-calm");
  assert.equal(d.priorN, 40); assert.equal(d.liveN, 0); assert.equal(d.status, "closed");
  assert.equal(allocDecide(st, prior, key, "chop-calm").n, 100);
  // Stamp, and the dollar line at the Allocator's size.
  assert.equal(allocStamp(d, "on").w, 0); assert.equal(allocStamp(allocDecide(st, null, key, "up-calm"), "on").w, 1.75);
  const b = allocBook([{ alloc: { w: 2, status: "open" }, optionPnlPct: 10, contract: { mid: 1 } }, { alloc: { w: 0, status: "closed" }, optionPnlPct: -20, contract: { mid: 1 } }, { optionPnlPct: 5, contract: { mid: 1 } }], tradeUsd);
  assert.deepEqual(b, { n: 2, plainUsd: -10, sizedUsd: 20, advisedOut: 1, heldUsd: -20 });
  assert.equal(ALLOC.minN, 30);
});
ok("book: the Allocator holds a losing setup back as a shadow trade; 'advise' only stamps it", () => {
  const losing = () => { const s = emptyState(); s.alloc = emptyAlloc("2026-11-01"); s.alloc.table[allocKey("technicals", "pullback", "call", "option")] = { "*": [40, -200], "up-calm": [40, -200] }; return s; };
  let state = losing(), record = emptyRecord();
  let out = stepBook(state, record, bookInput({ AAA: V("AAA", pullF()) }, { engines: ["technicals"], allocator: { mode: "on", prior: null } }));
  assert.equal(out.opened.length, 0); assert.equal(out.shadowOpened, 1);
  assert.equal(state.engines.technicals.shadow.open[0].shadowWhy, "held back by the Allocator");
  assert.equal(state.engines.technicals.shadow.open[0].alloc.status, "closed");
  assert.match(out.candidates.technicals[0].why, /^Allocator: expected -5% a trade/);
  assert.equal(out.candidates.technicals[0].alloc.status, "closed");
  state = losing(); record = emptyRecord();
  out = stepBook(state, record, bookInput({ AAA: V("AAA", pullF()) }, { engines: ["technicals"], allocator: { mode: "advise", prior: null } }));
  assert.equal(out.opened.length, 1);
  assert.deepEqual({ w: out.opened[0].alloc.w, status: out.opened[0].alloc.status, mode: out.opened[0].alloc.mode }, { w: 0, status: "closed", mode: "advise" });
  // Off (the default when not passed): nothing stamped, nothing held back.
  state = losing(); record = emptyRecord();
  out = stepBook(state, record, bookInput({ AAA: V("AAA", pullF()) }, { engines: ["technicals"] }));
  assert.equal(out.opened.length, 1); assert.equal(out.opened[0].alloc, undefined);
  // Each finished trade, real or shadow, is counted.
  state = emptyState(); record = emptyRecord();
  stepBook(state, record, bookInput({ AAA: V("AAA", pullF()) }, { engines: ["technicals"], allocator: { mode: "on", prior: null } }));
  const views = { AAA: { ...V("AAA", pullF()), spot: 112 } };
  stepBook(state, record, bookInput(views, { engines: ["technicals"], nowIso: "2026-11-17T16:00:00.000Z", chains: { AAA: { spot: 112, chains: chainFor(112, Date.parse("2026-11-17T16:00:00.000Z")) } }, mode: "pause", allocator: { mode: "on", prior: null } }));
  assert.equal(record.closed.length, 1);
  assert.deepEqual(state.alloc.table[allocKey("technicals", "pullback", "call", "option")]["up-calm"][0], 1);
  // The page's table: every live signal setup, ordered open / new / closed.
  const v = allocView(losing(), null, ENGINES, SIGNAL_IDS, "up-calm");
  assert.equal(v.rows.find((r) => r.key === allocKey("technicals", "pullback", "call", "option")).status, "closed");
  assert.ok(v.rows.every((r) => !ENGINES[r.engine].setups[r.setup].retired));
  assert.equal(v.cellLabel, "trending-up, calm");
});

ok("views: the Webull earnings backup fills only names the main source has no report for", () => {
  const nowIso = "2026-11-18T16:00:00.000Z", today = "2026-11-18";
  const input = fixture(nowIso);
  const [a, b] = input.tickers.filter((s) => !MACRO_ETFS.includes(s) && s !== "SPY" && s !== "QQQ");
  delete input.earningsStore.tickers[a];
  input.earningsStore.tickers[b].events.push({ date: "2026-11-25", session: "PM" });
  const backup = { [a]: "2026-11-24", [b]: "2026-12-01" };
  const off = buildEngineViews({ ...input, today, nowMs: Date.parse(nowIso) });
  assert.equal(off.views[a]?.earn?.next ?? null, null);
  const on = buildEngineViews({ ...input, today, nowMs: Date.parse(nowIso), earningsBackup: backup });
  assert.equal(on.views[a].earn.next.date, "2026-11-24");
  assert.equal(on.views[a].earn.next.source, "webull-backup");
  assert.equal(on.views[a].earn.next.exitBy, "2026-11-23");
  // The main source's date stands; the backup is not read for it.
  assert.equal(on.views[b].earn.next.date, "2026-11-25");
  assert.equal(on.views[b].earn.next.source, undefined);
  assert.deepEqual(on.health.earnBackup, [a]);
});

// ---- live data pack (2026-11-20) ----------------------------------------------
ok("live pack: registry, switches and rules steps", () => {
  // Two Flow paper trials on top of the cap step (rules 6 on Flow), dated today.
  assert.equal(ENGINES.flow.rules.n, 6); assert.equal(ENGINES.flow.rules.date, "2026-11-20");
  assert.match(ENGINES.flow.rules.note, /^New rules: paper trials are added, labeled unproven: .*large orders.*flagged call volume/);
  assert.match(ENGINES.flow.rules.key, /\|cap:25\|trials2:bigOrder,optionSurge$/);
  for (const k of ["big-order-buying", "option-surge"]) {
    const st = ENGINES.flow.setups[k];
    assert.equal(st.trial, true, k); assert.equal(st.calls, "shares", k); assert.equal(st.exits.maxSessions, 10, k); assert.match(st.how, /untested/i, k);
  }
  // The live data pack: rules 7 on Reversion and Macro, 6 on Earnings; Technicals and Fundamentals untouched.
  assert.equal(ENGINES.reversion.rules.n, 7); assert.equal(ENGINES.macro.rules.n, 7); assert.equal(ENGINES.earnings.rules.n, 6);
  for (const id of ["reversion", "macro", "earnings"]) { assert.match(ENGINES[id].rules.note, /^New rules \(live data pack\)/, id); assert.equal(ENGINES[id].rules.date, "2026-11-20", id); }
  assert.match(ENGINES.reversion.rules.note, /80-84 scores lost 5\.2%/); assert.match(ENGINES.macro.rules.note, /75-79 scores lost 4\.1%/); assert.match(ENGINES.earnings.rules.note, /run-in's up side buys shares/);
  assert.equal(ENGINES.technicals.rules.n, 5); assert.equal(ENGINES.fundamentals.rules.n, 5);
  assert.equal(ENGINES.reversion.convScore, false); assert.equal(ENGINES.macro.convScore, false); assert.equal(ENGINES.technicals.convScore, undefined);
  assert.equal(ENGINES.earnings.setups["run-in"].ivShares, true);
  // Every new switch is on by default, read by name, and in Owner Settings.
  for (const [env, path] of [["ENGINES_TRIAL_BIG_ORDER", ["trials", "bigOrder"]], ["ENGINES_TRIAL_OPTION_SURGE", ["trials", "optionSurge"]], ["ENGINES_CONV_NO_SCORE", ["fixes", "convNoScore"]], ["ENGINES_RUNIN_BY_IV", ["fixes", "runInShares"]]]) {
    assert.equal(engineSwitches({})[path[0]][path[1]], true, env);
    assert.equal(engineSwitches({ [env]: "0" })[path[0]][path[1]], false, env);
    const def = ownerSettingDef(env); assert.ok(def && def.kind === "switch" && def.default === true && def.group === "Strategy engines", env);
  }
  assert.equal(engineSwitches({ ENGINES_SHARES: "0" }).trials.bigOrder, false, "trials need share trades");
  assert.ok(!engineSwitches({}).off.has("rotation")); assert.ok(engineSwitches({ ENGINES_ROTATION: "off" }).off.has("rotation"));
  assert.ok(ownerSettingDef("ENGINES_ROTATION")?.default === true);
  // Switching each off: the setup retires or the flag comes back, and the rules key moves (logged as a change).
  const off = engineSpecs({ convNoScore: false, runInShares: false }, { bigOrder: false, optionSurge: false });
  assert.equal(off.reversion.convScore, true); assert.equal(off.macro.convScore, true); assert.equal(off.earnings.setups["run-in"].ivShares, false);
  assert.equal(off.flow.setups["big-order-buying"].retired, true); assert.equal(off.flow.setups["option-surge"].retired, true);
  for (const id of ["reversion", "macro", "earnings", "flow"]) { assert.notEqual(off[id].rules.key, ENGINES[id].rules.key, id); assert.equal(off[id].rules.n, ENGINES[id].rules.n - 1, id); }
  assert.match(off.reversion.rules.switchNote, /leaves out the setup score.*switched off/);
  const es = newEngineState(ENGINES.flow); es.rules = 5; es.rulesKey = peel(ENGINES.flow.rules).key;
  const made = adoptRules(es, ENGINES.flow, "2026-11-20");
  assert.equal(made.kind, "rules"); assert.equal(es.rules, 6); assert.match(made.text, /^New rules: paper trials are added/);
  assert.equal(adoptRules(es, ENGINES.flow, "2026-11-20"), null, "once");
  assert.match(adoptRules(es, off.flow, "2026-11-21").text, /switched off and opens nothing new/);
});
const flowView = (sym, { wb = null, surge = null, f = {}, etf = false, spot = null } = {}) => {
  const ff = baseF({ c: 100, sma50: 94, ...f });
  return V(sym, ff, { isEtf: etf, spot: spot ?? ff.c + 0.5, live: { iv: { band: "normal" }, flow: { signed: true, nBull: 0, nBear: 0, bullUsd: 0, bearUsd: 0, bullPrem: 0, bearPrem: 0, surge, ...(wb ? { wb } : {}) } } });
};
ok("live pack: Flow big-order trial reads Webull large-order flow, stocks above the 50-day only", () => {
  const hit = evalFlow(flowView("BIG", { wb: { wfl5: 24, wfl: 50, wft: 30 } }), CTX);
  assert.equal(hit.length, 1); assert.equal(hit[0].setup, "big-order-buying"); assert.equal(hit[0].side, "call");
  assert.equal(hit[0].score, 60 + 7 + 3); assert.deepEqual(hit[0].facts, { wfl5: 24, wfl: 50, wft: 30 });
  assert.ok(hit[0].reasons.some((r) => /Large orders net bought 24% of everything traded over the last five sessions/.test(r)));
  assert.equal(evalFlow(flowView("BIG", { wb: { wfl5: 9.9, wfl: 50 } }), CTX).length, 0, "under 10% over five sessions");
  assert.equal(evalFlow(flowView("BIG", { wb: { wfl5: 24, wfl: -1 } }), CTX).length, 0, "the latest session must be net buying");
  assert.equal(evalFlow(flowView("BIG", { wb: { wfl5: 24, wfl: 5 }, f: { sma50: 105 } }), CTX).length, 0, "under the 50-day");
  assert.equal(evalFlow(flowView("SPY", { wb: { wfl5: 24, wfl: 5 }, etf: true }), CTX).length, 0, "funds belong to Macro and the core engines");
  assert.equal(evalFlow(flowView("BIG", { wb: { wfl5: 24, wfl: 5 } }), { ...CTX, retired: new Set(["big-order-buying"]) }).length, 0, "switched off");
  assert.equal(evalFlow(flowView("BIG", { wb: { wfl5: 24, wfl: 5 }, spot: 104 }), CTX).length, 0, "chasing filter: 2 ATR up today");
  assert.equal(evalFlow(flowView("BIG", {}), CTX).length, 0, "no Webull read, no trade");
});
ok("live pack: Flow option-surge trial needs call premium, a call-heavy mix and the stock rising today", () => {
  const sg = (callPrem, putPrem) => ({ n: 4, nCall: 3, callPrem, putPrem });
  const hit = evalFlow(flowView("SRG", { surge: sg(900000, 100000) }), CTX);
  assert.equal(hit.length, 1); assert.equal(hit[0].setup, "option-surge"); assert.equal(hit[0].facts.callShare, 0.9);
  assert.equal(evalFlow(flowView("SRG", { surge: sg(400000, 0) }), CTX).length, 0, "under $500k");
  assert.equal(evalFlow(flowView("SRG", { surge: sg(900000, 600000) }), CTX).length, 0, "under 70% calls");
  assert.equal(evalFlow(flowView("SRG", { surge: sg(900000, 0), spot: 100 }), CTX).length, 0, "the stock must be rising today");
  assert.equal(evalFlow(flowView("SRG", { surge: sg(900000, 0), spot: 99 }), CTX).length, 0);
});
ok("live pack: the bake's flow read keeps 7+ day flagged contracts and counts readable prints", () => {
  const unusual = { scannedAt: "2026-11-16T15:00:00.000Z", tickers: [{ symbol: "AAA", contracts: [
    { side: "call", dte: 1, premium: 5e6, flagged: true, tape: null, tapeStale: true },
    { side: "call", dte: 9, premium: 7e5, flagged: true, tape: "ask" },
    { side: "put", dte: 30, premium: 1e5, flagged: true, tape: "bid" },
    { side: "call", dte: 30, premium: 9e6, flagged: false, tape: "ask" },
  ] }] };
  const bars = walk(DATES, { seed: 7 });
  const chains = { AAA: { spot: bars.at(-1).c, chains: {} }, SPY: { spot: 500, chains: {} } };
  const v = buildEngineViews({ today: TODAY, nowMs: Date.parse(NOW_AM), chains, tickers: ["AAA"], barsOf: () => bars, unusual,
    webullFlow: { AAA: { wfl: 12.5, wft: 3, wfl5: 18 } }, policyNews: { AAA: { frn: 2, nvr: 3.1, ntn: -1.2 } } });
  assert.deepEqual(v.views.AAA.live.flow.surge, { n: 2, nCall: 1, callPrem: 700000, putPrem: 100000 });
  assert.deepEqual(v.views.AAA.live.flow.wb, { wfl: 12.5, wft: 3, wfl5: 18 });
  assert.deepEqual(v.views.AAA.live.news, { frn: 2, nvr: 3.1, ntn: -1.2 });
  assert.deepEqual(v.health.flow, { scan: "2026-11-16T15:00:00.000Z", prints: 3, readable: 2, stale: 1, noTape: 0, signedNames: 0 });
  assert.equal(v.health.webullFlowNames, 1);
  const none = buildEngineViews({ today: TODAY, nowMs: Date.parse(NOW_AM), chains, tickers: ["AAA"], barsOf: () => bars });
  assert.equal(none.views.AAA.live.flow.surge, null); assert.equal(none.views.AAA.live.flow.wb, undefined); assert.equal(none.views.AAA.live.news, undefined);
  assert.equal(none.health.flow.scan, null);
});
ok("live pack: a Flow trial buys $5,000 of stock in its own slots, with the trial stamp, a 10-session limit and ATR levels", () => {
  const views = { BIG: flowView("BIG", { wb: { wfl5: 24, wfl: 50 } }), SRG: flowView("SRG", { surge: { n: 3, nCall: 3, callPrem: 9e5, putPrem: 0 } }) };
  const out = stepBook(emptyState(), emptyRecord(), bookInput(views, { engines: ["flow"], shares: true }));
  assert.deepEqual(out.opened.map((t) => t.setup).sort(), ["big-order-buying", "option-surge"]);
  for (const t of out.opened) {
    assert.ok(isSharesTrade(t)); assert.equal(t.trial, true); assert.equal(t.exits.maxSessions, 10);
    assert.ok(Math.abs(positionUsd(t.contract) - 5000) <= t.contract.mid); assert.match(t.contract.size.why, /paper trial lot/);
    assert.ok(t.stopLevel < t.entrySpot && t.targetLevel > t.entrySpot); assert.match(t.tradeId, /^FLO:(BIG|SRG)-S-/);
    assert.equal(newTrade(t, t.tradeId).requestedQty >= 1, true);
  }
  // Share trades off: no trial opens.
  const noSh = stepBook(emptyState(), emptyRecord(), bookInput(views, { engines: ["flow"], shares: false }));
  assert.equal(noSh.opened.length, 0); assert.ok(noSh.candidates.flow.every((c) => /shares only/.test(c.why || "")));
});
ok("live pack: conviction leaves the score out on Reversion and Macro only", () => {
  const r = convictionRead({ score: 80, bar: 60, scorePart: false });
  assert.equal(r.mult, 1); assert.equal(r.parts[0].key, "score"); assert.equal(r.parts[0].x, 1); assert.match(r.parts[0].why, /left out/);
  assert.equal(convictionRead({ score: 80, bar: 60 }).mult, SIZE_WEIGHTS.scoreTop);
  const rv = stepBook(emptyState(), emptyRecord(), honestInput({ CCC: V("CCC", WASHOUT()) }, { engines: ["reversion"] })).opened.find((t) => t.setup === "oversold-bounce");
  assert.ok(rv); const sp = (rv.contract.size.parts || []).find((p) => p.key === "score");
  assert.equal(sp?.x, 1); assert.match(sp.why, /left out/);
  const tc = stepBook(emptyState(), emptyRecord(), honestInput({ AAA: V("AAA", pullF()) }, { engines: ["technicals"], shares: true })).opened[0];
  assert.notEqual((tc.contract.size.parts || []).find((p) => p.key === "score")?.why, sp.why, "Technicals keeps its score part");
  const back = stepBook(emptyState(), emptyRecord(), honestInput({ CCC: V("CCC", WASHOUT()) }, { engines: ["reversion"], specs: engineSpecs({ convNoScore: false }) })).opened.find((t) => t.setup === "oversold-bounce");
  assert.match((back.contract.size.parts || []).find((p) => p.key === "score")?.why || "", /^score \d+ against a bar/);
});
ok("live pack: the earnings run-in buys shares when options are rich, calls otherwise, closed before the report either way", () => {
  const hist = [1, 2, 3, 4].map(() => ({ movePct: 4, week1Pct: 2, pre10Pct: 3 }));
  const earn = { last: null, hist, next: { date: "2026-11-23", session: "PM", sessionsUntil: 5, exitBy: "2026-11-23" } };
  const view = (band) => V("EEE", baseF({}), { earn, live: { iv: { band } } });
  const ctxOn = { ...CTX, setups: ENGINES.earnings.setups };
  assert.equal(evalEarnings(view("normal"), ctxOn)[0].buyShares, undefined);
  for (const band of ["rich", "very-rich"]) {
    const c = evalEarnings(view(band), ctxOn);
    assert.equal(c.length, 1, band); assert.equal(c[0].buyShares, true, band); assert.equal(c[0].facts.ivBand, band);
    assert.ok(c[0].reasons.some((r) => /buys shares instead of a call/.test(r)), band);
  }
  // Switched off: very rich still skips, rich buys the call as before.
  const ctxOff = { ...CTX, setups: engineSpecs({ runInShares: false }).earnings.setups };
  assert.equal(evalEarnings(view("very-rich"), ctxOff).length, 0); assert.equal(evalEarnings(view("rich"), ctxOff)[0].buyShares, undefined);
  // In the book: a share trade that still closes by the report.
  const out = stepBook(emptyState(), emptyRecord(), bookInput({ EEE: view("rich") }, { engines: ["earnings"], shares: true }));
  const t = out.opened[0];
  assert.ok(t && isSharesTrade(t)); assert.equal(t.setup, "run-in"); assert.equal(t.exitBy, "2026-11-23"); assert.equal(t.exits.maxSessions, 8);
  const call = stepBook(emptyState(), emptyRecord(), bookInput({ EEE: view("normal") }, { engines: ["earnings"], shares: true })).opened[0];
  assert.equal(call.contract.structure, "long"); assert.equal(call.contract.optionType, "call");
  const noSh = stepBook(emptyState(), emptyRecord(), bookInput({ EEE: view("rich") }, { engines: ["earnings"], shares: false })).opened[0];
  assert.equal(noSh.contract.structure, "long", "share trades off: the call");
});
ok("live pack: Reversion's bounce entries carry the news tag, and it changes no score", () => {
  const plain = evalReversion(V("CCC", WASHOUT()), CTX).find((c) => c.setup === "oversold-bounce");
  const tagged = evalReversion(V("CCC", WASHOUT(), { live: { news: { frn: 1, nvr: 2.4, ntn: -0.8 } } }), CTX).find((c) => c.setup === "oversold-bounce");
  assert.equal(plain.facts.news, undefined, "no read: no tag");
  assert.deepEqual(tagged.facts.news, { frn: 1, nvr: 2.4, ntn: -0.8, spike: true });
  assert.equal(tagged.score, plain.score);
  const dip = evalReversion(V("DDD", baseF({ c: 100, pc: 101, sma5: 102, sma20: 101, sma200: 90, z20: -0.8, rsi2: 3, move5Atr: -1 }), { live: { news: { frn: 0, nvr: 1.1 } } }), CTX).find((c) => c.setup === "rsi2-dip");
  assert.deepEqual(dip.facts.news, { frn: 0, nvr: 1.1, ntn: null, spike: false });
});
ok("live pack (audit): the run-in's share swap respects share trades off and a chosen instrument", () => {
  const hist = [1, 2, 3, 4].map(() => ({ movePct: 4, week1Pct: 2, pre10Pct: 3 }));
  const earn = { last: null, hist, next: { date: "2026-11-23", session: "PM", sessionsUntil: 5, exitBy: "2026-11-23" } };
  const view = (band) => V("EEE", baseF({}), { earn, live: { iv: { band } } });
  // Share trades off: very rich still skips (no call where the old rule skipped); rich buys the call.
  assert.equal(stepBook(emptyState(), emptyRecord(), bookInput({ EEE: view("very-rich") }, { engines: ["earnings"], shares: false })).opened.length, 0);
  assert.equal(evalEarnings(view("very-rich"), { ...CTX, setups: ENGINES.earnings.setups, swapToShares: false }).length, 0);
  // The Owner chose options for Earnings: options it is.
  const optSpecs = engineSpecs(undefined, undefined, { earnings: "options" });
  assert.equal(stepBook(emptyState(), emptyRecord(), bookInput({ EEE: view("very-rich") }, { engines: ["earnings"], shares: true, specs: optSpecs })).opened.length, 0);
  const rich = stepBook(emptyState(), emptyRecord(), bookInput({ EEE: view("rich") }, { engines: ["earnings"], shares: true, specs: optSpecs })).opened[0];
  assert.equal(rich.contract.structure, "long");
});
ok("live pack (audit): one Flow trial lot per name, across both trials", () => {
  const v = flowView("TWO", { wb: { wfl5: 24, wfl: 50 }, surge: { n: 3, nCall: 3, callPrem: 9e5, putPrem: 0 } });
  assert.equal(evalFlow(v, CTX).length, 2, "both trials match the name");
  const out = stepBook(emptyState(), emptyRecord(), bookInput({ TWO: v }, { engines: ["flow"], shares: true }));
  assert.equal(out.opened.length, 1); assert.ok(out.candidates.flow.some((c) => !c.taken && /already holds this name/.test(c.why || "")));
});
const rotViews = (over = {}, last = "2026-10") => {
  const base = { SPY: ramp(400, 480), QQQ: ramp(300, 390), IWM: ramp(200, 210), SMH: ramp(200, 330), TLT: ramp(100, 90), GLD: ramp(180, 260), SLV: ramp(20, 31), USO: ramp(70, 65), EWY: ramp(60, 63), KWEB: ramp(30, 29) };
  return Object.fromEntries(Object.entries({ ...base, ...over }).map(([s, c]) => [s, coreView(s, c, { last })]));
};
ok("Multi-asset rotation: the three strongest funds that pass both checks, T-bills for a place that fails", () => {
  let r = rotationRead(rotViews(), coreCtx());
  assert.deepEqual(r.hold, ["SMH", "SLV", "GLD"]); assert.ok(Object.values(r.setups).every((s) => s === "top-3"));
  assert.equal(r.ranked.length, 10); assert.equal(r.ranked[0].symbol, "SMH"); assert.equal(r.month, "2026-10");
  assert.match(r.why, /Holding SMH, SLV, GLD/);
  // A top fund under its 10-month average keeps its place in T-bills.
  const fade = [...ramp(10, 60, 11), 52, 48, 45];
  r = rotationRead(rotViews({ SLV: fade }), coreCtx());
  assert.ok(r.ranked.find((x) => x.symbol === "SLV").rank <= 3, "still ranked near the top");
  assert.deepEqual(r.hold, ["SMH", "GLD"]); assert.match(r.why, /SLV \(under its 10-month average\) left in T-bills/);
  // Nothing beats T-bills: cash.
  const flat = Object.fromEntries(["SPY", "QQQ", "IWM", "SMH", "TLT", "GLD", "SLV", "USO", "EWY", "KWEB"].map((s) => [s, ramp(100, 101)]));
  r = rotationRead(rotViews(flat), coreCtx(4)); assert.deepEqual(r.hold, []); assert.match(r.why, /holding T-bills/);
  // A fund without current history is named and left out; too few funds: no read.
  const v = rotViews(); v.KWEB = coreView("KWEB", ramp(30, 29), { last: "2026-09" });
  r = rotationRead(v, coreCtx()); assert.deepEqual(r.reads.missing, ["KWEB"]); assert.equal(r.ranked.length, 9);
  const few = rotViews(); for (const s of ["IWM", "SMH", "TLT", "GLD", "SLV", "USO", "EWY"]) delete few[s];
  assert.equal(rotationRead(few, coreCtx()), null);
  assert.equal(rotationRead(rotViews(), { ...CTX, macro: {} }), null);
});
ok("rotation (audit): a target read with a fund missing is replaced in the same month by a fuller read", () => {
  const es = {};
  const part = rotViews(); part.SLV = coreView("SLV", ramp(20, 31), { last: "2026-09" });
  standCore(es, "rotation", part, coreCtx(), { today: "2026-11-02" });
  assert.deepEqual(es.core.reads.missing, ["SLV"]); assert.ok(!es.core.hold.includes("SLV"));
  const first = es.core.hold.slice();
  standCore(es, "rotation", rotViews(), coreCtx(), { today: "2026-11-03" });
  assert.equal(es.core.reads.missing, undefined); assert.deepEqual(es.core.hold, ["SMH", "SLV", "GLD"]);
  assert.equal(es.core.since, "2026-11-02", "the month's start stands"); assert.equal(es.coreLog.length, 1, "one log line for the month");
  assert.ok(es.coreLog[0].in.includes("SLV")); assert.notDeepEqual(first, es.core.hold);
  // A same-month read that is no fuller changes nothing.
  standCore(es, "rotation", part, coreCtx(), { today: "2026-11-04" });
  assert.deepEqual(es.core.hold, ["SMH", "SLV", "GLD"]);
});
ok("book: the rotation buys three $10,000 lots of shares, then swaps at the next monthly check", () => {
  const state = emptyState(), record = emptyRecord();
  const v1 = rotViews();
  let out = stepBook(state, record, bookInput(v1, { engines: ["rotation"], ctx: { ...coreCtx(), byId: v1 }, maxTotal: 1 }));
  assert.deepEqual(out.opened.map((t) => t.symbol).sort(), ["GLD", "SLV", "SMH"]);
  for (const t of out.opened) {
    assert.ok(isSharesTrade(t)); assert.equal(t.engine, "rotation"); assert.equal(t.tag, "ROT"); assert.equal(t.setup, "top-3");
    assert.ok(Math.abs(positionUsd(t.contract) - 10000) <= t.contract.mid); assert.deepEqual(t.exits, {}); assert.equal(t.stopLevel, null);
    assert.match(t.tradeId, /^ROT:[A-Z]+-S-/); assert.ok(t.reasons.some((x) => /average 3, 6 and 12-month rise/.test(x)));
  }
  assert.equal(engineByTag("ROT").id, "rotation");
  // Next month SLV falls out of the three for USO.
  const v2 = rotViews({ SLV: [...ramp(20, 31, 13), 18], USO: ramp(40, 90) }, "2026-11");
  out = stepBook(state, record, bookInput(v2, { engines: ["rotation"], ctx: { ...coreCtx(), byId: v2 }, nowIso: "2026-12-01T16:00:00.000Z" }));
  assert.deepEqual(out.closed.map((x) => [x.symbol, x.status]), [["SLV", "rotate"]]);
  assert.ok(out.opened.some((x) => x.symbol === "USO"));
  // Switched off: no new holdings.
  const offOut = stepBook(emptyState(), emptyRecord(), bookInput(v1, { engines: ["rotation"], ctx: { ...coreCtx(), byId: v1 }, off: new Set(["rotation"]) }));
  assert.equal(offOut.opened.length, 0);
  // The page row.
  const page = buildEnginesView({ record, state, ctx: CTX, builtAtIso: NOW_AM }).engines.find((e) => e.id === "rotation");
  assert.equal(page.top, 3); assert.equal(page.funds.length, 10); assert.equal(page.liveTest, true); assert.ok(page.holdings.ranked.length >= 9);
});
ok("one bad name: a stock whose input throws is left out, the run and every other name go on", () => {
  const nowIso = "2026-11-18T16:00:00.000Z", today = "2026-11-18";
  const input = fixture(nowIso);
  const [bad] = input.tickers.filter((s) => !MACRO_ETFS.includes(s) && s !== "SPY" && s !== "QQQ");
  Object.defineProperty(input.chains[bad], "ivRank", { get() { throw new Error("poisoned input"); } });
  const clean = buildEngineViews({ ...fixture(nowIso), today, nowMs: Date.parse(nowIso) });
  const v = buildEngineViews({ ...input, today, nowMs: Date.parse(nowIso) });
  assert.equal(v.views[bad], undefined);
  assert.equal(v.P[bad], undefined);
  assert.deepEqual(v.health.badInput.map((r) => r.symbol), [bad]);
  assert.match(v.health.badInput[0].error, /poisoned input/);
  assert.equal(v.health.views, clean.health.views - 1, "every other name still has its view");
  const res = runEngines({ loaded: { record: emptyRecord(), state: emptyState() }, ...input });
  assert.ok(res && !res.skipped, "the run itself completes");
});

// The stock split guard (2026-11-20) keeps its checks in its own file; CI
// runs them through this one.
{
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, [new URL("./engines-split-smoke.mjs", import.meta.url).pathname], { stdio: "inherit" });
  if (r.status !== 0) { console.log("FAIL engines split smoke"); process.exitCode = 1; }
}

console.log(`${passed} engine checks passed${process.exitCode ? " (with failures)" : ""}`);
