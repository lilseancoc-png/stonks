// Smoke test for the quant labs (lib/labs/, 2026-11-16): the shared
// statistics, the market fall and recovery odds, the calibration lab, the
// research registry, the factor and volatility labs, the annual report text
// comparison, the bake entry point, and the Owner / public split.
// Synthetic, seeded data only: no network, no store, no AI.
// Run: node scripts/quant-labs-smoke.mjs
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  mean, sd, quantile, median, percentileOf, normCdf, normInv, pFromT, tStat, mulberry32, blockBootstrap, spearman, pearson,
  brier, brierSkill, auc, reliability, coverage, fitLogistic, predictLogistic, fitPlatt, applyPlatt, ols, maxDrawdown,
  deflatedSharpe, expectedMaxSharpe, benjaminiHochberg, trialsAdjustedT,
} from "../lib/labs/stats.mjs";
import { buildDrawdownOdds, gradeDrawdownLog, DD_FEATURES, REC_FEATURES, DD_TARGETS } from "../lib/labs/drawdown-odds.mjs";
import { scoreChance, scoreScore, scoreRange, buildCalibrationLab, recordSources, engineSources, loopSources, predictionSource, foldPredictionLog, earningsMoveSource } from "../lib/labs/calibration.mjs";
import { registryRow, buildRegistry, TRIAL_LOG, trialsFor } from "../lib/labs/registry.mjs";
import { evaluateVolModels, buildVolLab, VOL_MODELS } from "../lib/labs/vol.mjs";
import { evaluateFactors, publicFactorRows, exposures, gradeVsFactors, foldPanel, panelSnapshot, percentiles, PRICE_FACTORS, ALL_FACTORS } from "../lib/labs/factors.mjs";
import { evaluateUniverse, UNIVERSE_FACTORS } from "../lib/labs/factor-universe.mjs";
import { universeFixture } from "./fixtures/factor-universe.mjs";
import { htmlToLines, riskSection, compareSections, refreshFilingText, buildFilingLab, archiveUrl } from "../lib/labs/filing-text.mjs";
import { runQuantLabs, loadQuantLabs, writeQuantLabs, carryQuantLabs, quantLabsEnabled, quantLabsTextEnabled, QUANT_LABS_KEY, QUANT_LABS_STATE_KEY } from "../lib/labs/index.mjs";

let checks = 0;
const ok = (test, label) => { assert.ok(test, label); checks++; };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const near = (a, b, tol, label) => { assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`); checks++; };
const gaussOf = (rnd) => () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };

// --- synthetic data ---------------------------------------------------------------

// A 64-year index with a slow hidden risk state: when it was high 40 sessions
// ago, returns turn down and swing more. Credit spreads, the yield curve and
// unemployment all follow the same state, so the odds model has something
// real to find.
export function synthMarket({ seed = 5, start = "1962-01-02", end = "2026-11-13" } = {}) {
  const rnd = mulberry32(seed), gauss = gaussOf(rnd);
  const bars = [], risk = [];
  let c = 70, r = 0;
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86400000) {
    const d = new Date(t), wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    r = 0.996 * r + 0.06 * gauss();
    const lag = risk.length > 40 ? risk[risk.length - 40] : 0;
    c *= Math.exp(0.0006 - 0.0014 * Math.max(0, lag - 0.3) + (0.007 + 0.004 * Math.max(0, lag)) * gauss());
    bars.push({ t: d.toISOString().slice(0, 10), c: Math.round(c * 100) / 100 });
    risk.push(r);
  }
  const daily = (fn) => bars.map((b, i) => ({ date: b.t, value: Math.round(fn(i) * 1000) / 1000 }));
  const monthly = (fn) => { const out = []; let last = ""; bars.forEach((b, i) => { const m = b.t.slice(0, 7); if (m !== last) { last = m; out.push({ date: `${m}-01`, value: Math.round(fn(i, out.length) * 1000) / 1000 }); } }); return out; };
  const fred = {
    BAA10Y: daily((i) => Math.max(0.5, 2 + 0.8 * risk[i])),
    DGS10: daily((i) => 5 + 0.5 * Math.sin(i / 700)),
    DFF: daily((i) => 4 + 0.5 * Math.sin(i / 700) + 1.2 * risk[i]),
    UNRATE: monthly((i) => 5 + 0.6 * risk[Math.max(0, i - 60)]),
    INDPRO: monthly((i, k) => 40 * Math.exp(0.002 * k - 0.02 * risk[i])),
    CPIAUCSL: monthly((i, k) => 30 * Math.exp(0.0025 * k)),
  };
  return { bars, fred: (id) => fred[id] || [] };
}

// A year of daily bars for a made-up universe on the index's last sessions.
// Each stock has its own beta, drift and swinging volatility.
export function synthUniverse({ seed = 9, market, names = 30, sessions = 262 } = {}) {
  const rnd = mulberry32(seed), gauss = gaussOf(rnd);
  const cal = market.slice(-sessions).map((b) => b.t);
  const mret = cal.map((_, i) => { const k = market.length - sessions + i; return k > 0 ? market[k].c / market[k - 1].c - 1 : 0; });
  const mk = (beta, drift, baseVol, start) => {
    let c = start, v = baseVol; const out = [];
    for (let i = 0; i < cal.length; i++) {
      const shock = gauss();
      v = Math.sqrt(0.00002 * (baseVol / 0.02) ** 2 + 0.9 * v * v + 0.08 * (v * shock) ** 2);
      c *= 1 + beta * mret[i] + drift + v * shock;
      out.push({ t: cal[i], c: Math.round(c * 100) / 100, h: c * 1.01, l: c * 0.99 });
    }
    return out;
  };
  const symbols = Array.from({ length: names }, (_, i) => `N${String(i + 1).padStart(2, "0")}`);
  const bars = { SPY: market.slice(-sessions).map((b) => ({ t: b.t, c: Math.round(b.c / 10 * 100) / 100 })), QQQ: mk(1.15, 0.0001, 0.006, 400), IWM: mk(1.1, -0.0001, 0.008, 200) };
  const drift = {};
  for (const s of symbols) { drift[s] = (rnd() - 0.5) * 0.004; bars[s] = mk(0.6 + rnd() * 1.2, drift[s], 0.012 + rnd() * 0.02, 20 + rnd() * 300); }
  return { cal, symbols, bars, drift };
}

let FIXTURE = null;
// The whole context the bake would pass, built from the synthetic data, and
// the labs run on it once.
export function quantLabsFixture() {
  if (FIXTURE) return FIXTURE;
  const market = synthMarket();
  const uni = synthUniverse({ market: market.bars });
  const rnd = mulberry32(21), gauss = gaussOf(rnd);
  const { cal, symbols, bars } = uni;
  const today = cal[cal.length - 1];
  // Implied volatility: the last 21 sessions' realized move, marked up.
  const ivOf = (s) => {
    const b = bars[s], out = [];
    for (let i = 30; i < b.length; i++) {
      let ss = 0; for (let k = i - 20; k <= i; k++) ss += Math.log(b[k].c / b[k - 1].c) ** 2;
      out.push({ date: b[i].t, iv: Math.sqrt((ss / 21) * 252) * (1.05 + 0.25 * rnd()) });
    }
    return out;
  };
  const ivs = Object.fromEntries([...symbols, "SPY", "QQQ", "IWM"].map((s) => [s, ivOf(s)]));
  // Grades lean on each stock's drift (so they carry some momentum) plus noise.
  const days = cal.slice(-120).map((date) => ({ date, totals: Object.fromEntries(symbols.map((s) => [s, Math.round(Math.max(-9, Math.min(9, uni.drift[s] * 2500 + gauss() * 2.5)) * 10) / 10])) }));
  const trade = (i, engine) => {
    const s = symbols[Math.floor(rnd() * symbols.length)];
    const e = 40 + Math.floor(rnd() * 180), x = Math.min(cal.length - 1, e + 3 + Math.floor(rnd() * 20));
    const pop = 0.3 + rnd() * 0.35, win = rnd() < pop + 0.05;
    const pnl = Math.round((win ? 10 + rnd() * 25 : -(15 + rnd() * 35)) * 10) / 10;
    return {
      tradeId: `${s}-C-${i}`, symbol: s, side: rnd() < 0.7 ? "call" : "put", entryDate: `${cal[e]}T15:00:00Z`, exitDate: cal[x],
      outcome: win ? "win" : "loss", counted: true, optionPnlPct: pnl, realFillPnlPct: pnl - 4, score: Math.round((4 + rnd() * 5) * 10) / 10,
      contract: { pop, structure: "long", mid: 5, iv: 0.4 }, thesis: { aiGrade: ["strong", "moderate", "weak"][Math.floor(rnd() * 3)] }, entryRegime: "neutral",
      ...(engine ? { engine, score: Math.round(40 + rnd() * 55), setup: "s" } : {}),
    };
  };
  const closed = Array.from({ length: 70 }, (_, i) => trade(i));
  const open = Array.from({ length: 5 }, (_, i) => ({ ...trade(100 + i), entryDate: `${i === 0 ? today : cal[cal.length - 6 - i]}T15:00:00Z`, exitDate: null, outcome: null }));
  const engClosed = [...Array.from({ length: 34 }, (_, i) => trade(200 + i, "tec")), ...Array.from({ length: 12 }, (_, i) => trade(300 + i, "rev"))];
  const loopRows = Array.from({ length: 240 }, (_, i) => {
    const p = 35 + rnd() * 30, up = rnd() < p / 100;
    return { d: cal[30 + (i % 200)], pn: 12, p5: p, p10: p, p20: p, pTp: p - 5, y5: up ? 1.2 : -1.1, y10: up ? 2 : -1.8, y20: up ? 3 : -2.5, opt: { res: rnd() < (p - 5) / 100 ? "tp" : "stop" } };
  });
  const predictionResolved = Array.from({ length: 45 }, (_, i) => { const before = Math.round(5 + rnd() * 90); return { id: `K:TEST-${i}`, before, result: rnd() < before / 100 ? "yes" : "no", resolvedAt: `${cal[100 + i]}T21:00:00Z` }; });
  const earningsStore = { tickers: Object.fromEntries(symbols.slice(0, 20).map((s) => [s, { events: Array.from({ length: 3 }, () => { const implied = 0.03 + rnd() * 0.05; return { impliedMovePct: implied, movePct: implied * 1.25 * gauss() }; }) }])) };
  const funds = Object.fromEntries(symbols.map((s) => [s, { forwardPE: 10 + rnd() * 40, priceToSales: 1 + rnd() * 12, priceToBook: 1 + rnd() * 10, profitMargin: rnd() * 0.35, grossMargin: 0.2 + rnd() * 0.6, returnOnEquity: rnd() * 0.5, revenueGrowthYoy: rnd() * 0.6 - 0.1, debtToEquity: rnd() * 180, freeCashFlow: 1e9 }]));
  const research = {
    v: 1, ran: "2026-11-16", note: null,
    registry: [{ id: "dd-fall10_6m", label: "Market odds: 10%+ fall within 6 months", family: "drawdown-odds", result: "Brier skill 0.058 with each era held out", verdict: "working", ran: "2026-11-16" }],
    marketOdds: { through: today, ridge: [5, 20, 80].map((l2) => ({ l2, skill: { fall10_3m: 0.07, fall10_6m: 0.055, fall10_12m: 0.07, fall20_12m: 0.01, lowIn_6m: 0.29, newHigh_12m: 0.13 } })), breadth: { from: "2006-10-17", funds: 9, rows: [], read: "Breadth added nothing on the months it covers, so it is not an input." } },
    vol: null, factors: null,
  };
  // The history tests the committed run would carry, from the same synthetic bars.
  const stockBars = Object.fromEntries(symbols.map((s) => [s, bars[s]]));
  const volHist = evaluateVolModels(stockBars, { step: 5, minBars: 150, warm: 125 });
  research.vol = { version: 1, har: volHist.har, best: volHist.best, models: volHist.models, rows: volHist.rows, symbols: volHist.symbols, from: volHist.from };
  // The wide factor test, on its own made-up universe (aggregates only).
  research.factorUniverse = { ...evaluateUniverse(universeFixture(), { size: 120, minNames: 100 }), ran: "2026-11-16", data: { builtAt: "2026-11-16" }, caveats: ["Made-up companies: this block only checks the page."] };
  const text = {};
  symbols.slice(0, 12).forEach((s, i) => { text[s] = { acc: `0000000000-26-${i}`, prevAcc: `0000000000-25-${i}`, form: "10-K", filed: "2026-02-10", prevFiled: "2025-02-11", at: "2026-11-10T15:00:00.000Z", sim: Math.round((0.99 - i * 0.02) * 1000) / 1000, added: i * 3, removed: i, paragraphs: 120, addedShare: Math.round((i * 3 / 120) * 1000) / 1000, words: 9000 + i * 400, wordsChg: i * 2.5, newTerms: i > 6 ? ["tariffs", "export"] : [], goneTerms: i > 8 ? ["pandemic"] : [], sample: i > 6 ? ["A new paragraph about export controls and what they could mean for sales next year."] : [] }; });
  text[symbols[13]] = { failedAcc: "0000000000-26-99", at: "2026-11-10T15:00:00.000Z", why: "no risk section found" };
  const ctx = {
    state: { text }, prior: null, research, builtAtIso: `${today}T21:10:00.000Z`, today,
    spx: market.bars, fred: market.fred, symbols, optionSymbols: [...symbols, "SPY", "QQQ", "IWM"],
    barsOf: (s) => bars[s] || [], ivOf: (s) => ivs[s] || [], fundamentalsOf: (s) => funds[s] || null,
    gradesDaily: { days }, grades: Object.fromEntries(Object.entries(days[days.length - 1].totals).map(([k, total]) => [k, { total }])),
    record: { open, closed, baseline: { closed: closed.map((c) => ({ ...c, optionPnlPct: Math.round(c.optionPnlPct / 2) })) } },
    engines: { open: [], closed: engClosed, names: { tec: "Technicals", rev: "Reversion" } },
    loopRows, predictionResolved, earningsStore, textWaiting: 17,
  };
  const t0 = Date.now();
  const run = runQuantLabs(ctx);
  FIXTURE = { market, uni, ctx, run, payload: run.payload, state: run.state, ms: Date.now() - t0 };
  return FIXTURE;
}

async function main() {
  // --- statistics ----------------------------------------------------------------
  near(mean([1, 2, 3, 4]), 2.5, 1e-12, "mean");
  near(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138, 1e-3, "sample standard deviation");
  near(quantile([1, 2, 3, 4, 5], 0.5), 3, 1e-12, "median by quantile"); near(median([5, 1, 3]), 3, 1e-12, "median");
  ok(percentileOf([1, 2, 3, 4], 3.5) > 0.5 && percentileOf([1, 2, 3, 4], 3.5) <= 1, "percentileOf returns a fraction");
  near(normCdf(1.96), 0.975, 1e-3, "normal cdf"); near(normInv(0.975), 1.96, 1e-2, "normal inverse");
  ok(pFromT(2.5, 40) < 0.05 && pFromT(0.5, 40) > 0.5, "p value from t");
  near(tStat([1, 2, 3, 4, 5]), 3 / (sd([1, 2, 3, 4, 5]) / Math.sqrt(5)), 1e-9, "t statistic");
  near(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 100]), 1, 1e-12, "rank correlation ignores scale"); near(pearson([1, 2, 3], [3, 2, 1]), -1, 1e-12, "correlation");
  near(brier([0.5, 0.5], [1, 0]), 0.25, 1e-12, "coin Brier"); near(brierSkill([1, 0], [1, 0]), 1, 1e-12, "perfect skill");
  ok(Math.abs(brierSkill([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0])) < 1e-9, "the average has no skill");
  near(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]), 1, 1e-12, "perfect ranking"); near(auc([1, 1, 1, 1], [0, 1, 0, 1]), 0.5, 1e-12, "ties rank at one half");
  eq(reliability([0.1, 0.1, 0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9, 0.9], [0, 0, 0, 0, 1, 1, 1, 1, 1, 0], 2).map((b) => b.n), [5, 5], "reliability buckets");
  near(coverage([{ lo: -1, hi: 1, actual: 0 }, { lo: -1, hi: 1, actual: 2 }], 0.5).hit, 0.5, 1e-12, "coverage");
  near(maxDrawdown([0.1, -0.2, -0.1, 0.3]), 0.8 * 0.9 - 1, 1e-9, "largest fall of the running total");
  {
    const rnd = mulberry32(4), gauss = gaussOf(rnd);
    const X = [], y = [];
    for (let i = 0; i < 4000; i++) { const a = gauss(), b = gauss(), c = gauss(); X.push([a, b, c]); y.push(rnd() < 1 / (1 + Math.exp(-(0.4 + 1.5 * a - 0.8 * b))) ? 1 : 0); }
    const fit = fitLogistic(X, y, { l2: 1 });
    near(fit.w[0], 1.5, 0.2, "logistic recovers the first weight"); near(fit.w[1], -0.8, 0.15, "logistic recovers the second weight"); near(fit.w[2], 0, 0.12, "an unrelated input stays near zero");
    const signed = fitLogistic(X, y, { l2: 1, signs: [-1, -1, 0] });
    ok(signed.w[0] <= 1e-12, "a sign rule holds an input that points the other way at zero"); ok(signed.w[1] < 0, "an input on its allowed side keeps its weight");
    const p = X.map((r) => predictLogistic(fit, r));
    ok(p.every((v) => v > 0 && v < 1), "chances stay inside 0 and 1");
    const pl = fitPlatt(p, y);
    near(pl.a, 1, 0.15, "an honest model needs no rescaling (slope)"); near(pl.b, 0, 0.12, "an honest model needs no rescaling (shift)");
    const squeezed = p.map((v) => 0.5 + (v - 0.5) * 0.4);
    ok(fitPlatt(squeezed, y).a > 1.5, "a too-cautious model is stretched");
    ok(applyPlatt(pl, 0.3) > 0.2 && applyPlatt(pl, 0.3) < 0.4, "rescaling keeps the scale");
    const o = ols(X.map((r) => [r[0], r[1]]), X.map((r) => 0.02 + 2 * r[0] - 0.5 * r[1] + 0.3 * gauss()), { lags: 3 });
    near(o.beta[0], 2, 0.05, "least squares slope"); near(o.beta[1], -0.5, 0.05, "least squares second slope"); ok(o.r2 > 0.9 && o.t[1] > 20, "fit quality and t values");
    const groups = Array.from({ length: 20 }, (_, g) => y.slice(g * 10, g * 10 + 10));
    eq(blockBootstrap(groups, mean, { draws: 50, seed: 3 }), blockBootstrap(groups, mean, { draws: 50, seed: 3 }), "the resampler is seeded");
    const range = blockBootstrap(groups, mean, { draws: 200, seed: 3 });
    ok(range.lo <= range.mid && range.mid <= range.hi && range.lo < mean(y.slice(0, 200)) && range.hi > mean(y.slice(0, 200)), "the resampled range brackets the sample value");
  }
  ok(expectedMaxSharpe(50, 0.1) > expectedMaxSharpe(5, 0.1), "more attempts raise the lucky best");
  ok(deflatedSharpe({ sr: 0.2, n: 200, skew: 0, kurt: 3, trials: 1, sdOfTrials: 0.07 }).dsr > deflatedSharpe({ sr: 0.2, n: 200, skew: 0, kurt: 3, trials: 200, sdOfTrials: 0.07 }).dsr, "more attempts lower the chance a result is real");
  ok(trialsAdjustedT(1) < trialsAdjustedT(20) && trialsAdjustedT(20) < trialsAdjustedT(500), "the t bar rises with the attempts"); near(trialsAdjustedT(1), 1.96, 0.02, "one attempt needs the usual bar");
  eq(benjaminiHochberg([0.001, 0.04, 0.03, 0.8], 0.1), [true, true, true, false], "false discovery control");

  // --- the bake entry point on the synthetic fixture ---------------------------------
  const fx = quantLabsFixture();
  const p = fx.payload;
  ok(fx.ms < 60000, `the labs ran in ${fx.ms} ms`);
  eq(Object.keys(p).sort(), ["builtAt", "calibration", "card", "drawdown", "factors", "filings", "registry", "research", "today", "v", "vol"].sort(), "page file blocks");
  const json = JSON.stringify(p);
  ok(!/NaN|undefined|Infinity/.test(json), "the page file holds no raw NaN or undefined"); ok(json.length < 400000, `page file size ${json.length}`);
  ok(JSON.stringify(fx.state).length < 1500000, "state file size");

  // --- market odds ---------------------------------------------------------------------
  const dd = p.drawdown;
  eq(dd.status, "ok", "market odds fitted"); ok(!("models" in dd), "fitted weights for scoring stay in the state file");
  eq(dd.targets.map((t) => t.id), DD_TARGETS.map((t) => t.id), "every target reported"); ok(dd.eras.length >= 8, "decline eras found");
  for (const t of dd.targets) {
    if (t.status === "thin") continue;
    ok(t.base > 0 && t.base < 1 && t.n >= 60, `${t.id}: base rate and sample`);
    ok(t.bins.length >= 4 && t.bins.every((b) => b.p >= 0 && b.p <= 1 && b.hit >= 0 && b.hit <= 1), `${t.id}: reliability bins`);
    ok(t.eraSkill.length >= 8, `${t.id}: graded era by era`);
    ok(["working", "weak", "no-skill"].includes(t.status), `${t.id}: status`);
    if (t.today != null) { ok(t.today > 0 && t.today < 1, `${t.id}: chance inside 0 and 1`); ok(t.range[0] <= t.range[1] && t.range[0] >= 0 && t.range[1] <= 1, `${t.id}: range ordered`); }
    const feats = t.kind === "fall" ? DD_FEATURES : REC_FEATURES;
    for (const w of t.weights) { const f = feats.find((x) => x.key === w.key), dir = f ? (f.fall ?? f.sign) : 0; ok(!dir || w.w === 0 || Math.sign(w.w) === Math.sign(dir), `${t.id}: ${w.key} pushes its set direction`); }
  }
  const head = dd.targets.find((t) => t.id === "fall10_6m");
  ok(head.headline && head.status === "working" && head.skill > 0.05, `the planted signal is found (skill ${head.skill})`);
  ok(head.weights.find((w) => w.key === "credit").w > 0, "the credit spread raises the chance");
  ok(dd.inputs.length >= 10 && dd.inputs.every((x) => x.pct == null || (x.pct >= 0 && x.pct <= 100)), "inputs carry a 0-100 rank");
  eq(dd.log.length, 1, "one stated row per close"); eq(dd.log[0].d, dd.asOf, "the stated row is dated by the close");
  ok(dd.study && dd.study.ridge.length === 3 && dd.study.breadth.read, "the history run's side checks ride along");
  ok(p.card && p.card.fall.some((t) => t.id === "fall10_6m") && p.card.asOf === dd.asOf, "the card carries the headline chance");
  eq(p.card.inDecline, dd.inDecline, "card decline flag"); ok(!dd.inDecline || p.card.recovery.length > 0, "recovery chances only inside a decline");
  eq(buildDrawdownOdds({ bars: fx.market.bars.slice(-300), fred: fx.market.fred }).status, "no-data", "a short history says so");
  // A stored log is graded once its windows close.
  const logged = gradeDrawdownLog([{ d: fx.market.bars[fx.market.bars.length - 400].t, c: { fall10_3m: 0.2, fall10_12m: 0.3 } }, { d: dd.asOf, c: { fall10_3m: 0.2 } }], { bars: fx.market.bars, fred: fx.market.fred });
  ok(logged.length === 2 && logged.every((r) => (r.y === 0 || r.y === 1) && r.p > 0), "old stated chances are graded; today's is not yet");

  // --- second build: the fit is reused, the log grows ------------------------------------
  const second = runQuantLabs({ ...fx.ctx, state: JSON.parse(JSON.stringify(fx.state)), prior: p, builtAtIso: `${fx.ctx.today}T21:40:00.000Z` });
  ok(!second.lines.some((l) => /refitted/.test(l)), "the same close does not refit the market odds");
  eq(second.payload.drawdown.targets.map((t) => t.today), dd.targets.map((t) => t.today), "the reused fit states the same chances");
  eq(second.state.ddLog.length, 1, "a later build on the same close overwrites its stated row");
  eq(second.state.panel.length, fx.state.panel.length, "the weekly panel keeps one snapshot per week");
  // A lab that throws keeps its last good block, marked stale; the others still run.
  const broken = runQuantLabs({ ...fx.ctx, state: JSON.parse(JSON.stringify(fx.state)), prior: p, ivOf: () => { throw new Error("boom"); } });
  ok(broken.payload.vol.stale === true && broken.payload.vol.names.length === p.vol.names.length, "a failed lab keeps its last good block");
  ok(broken.payload.calibration.sources.length > 0 && broken.lines.some((l) => /volatility skipped: boom/.test(l)), "the other labs still ran and the failure is logged");
  ok(runQuantLabs({ ...fx.ctx, state: null, spx: [], prior: null }).payload.card === null, "no index history means no card, not a made-up one");

  // --- calibration ------------------------------------------------------------------------
  {
    const rnd = mulberry32(8);
    const honest = Array.from({ length: 600 }, () => { const q = 0.1 + rnd() * 0.8; return { p: q, y: rnd() < q ? 1 : 0 }; });
    eq(scoreChance({ id: "a", label: "a", rows: honest }).verdict, "good", "honest, spread-out chances are good");
    eq(scoreChance({ id: "a", label: "a", rows: honest.map((r) => ({ p: Math.min(0.99, r.p + 0.25), y: r.y })) }).verdict.replace("worse", "over"), "over", "chances stated too high are caught");
    eq(scoreChance({ id: "a", label: "a", rows: honest.map((r) => ({ p: 0.5, y: r.y })) }).verdict, "flat", "always the average is honest but adds little");
    eq(scoreChance({ id: "a", label: "a", rows: honest.slice(0, 10) }).verdict, "few", "under 30 rows is collecting");
    eq(scoreScore({ id: "s", label: "s", rows: honest.map((r) => ({ s: r.p * 10, y: r.y })) }).verdict, "good", "a score that ranks outcomes");
    eq(scoreScore({ id: "s", label: "s", rows: honest.map((r) => ({ s: -r.p, y: r.y })) }).verdict, "worse", "a backwards score");
    eq(scoreScore({ id: "s", label: "s", rows: honest.map((r, i) => ({ s: i % 7, y: r.y })) }).verdict, "flat", "an unrelated score");
    const ranges = Array.from({ length: 300 }, () => ({ lo: -1, hi: 1, actual: (rnd() - 0.5) * 4 }));
    eq(scoreRange({ id: "r", label: "r", claimed: 0.5, rows: ranges }).verdict, "good", "a 50% range that covers half");
    eq(scoreRange({ id: "r", label: "r", claimed: 0.9, rows: ranges }).verdict, "over", "a range that claims too much is too narrow");
  }
  const cal = p.calibration;
  const ids = cal.sources.map((s) => s.id);
  for (const id of ["picks-pop", "picks-grade", "picks-ai", "engine-tec", "engine-rev", "loop-p10", "loop-pTp", "prediction-markets", "earnings-implied-move", "dd-fall10_6m"]) ok(ids.includes(id), `calibration source ${id}`);
  eq(cal.summary.total, cal.sources.length, "summary counts every source"); eq(cal.summary.good + cal.summary.off + cal.summary.flat + cal.summary.few, cal.summary.total, "summary groups add up");
  eq(cal.sources.find((s) => s.id === "engine-rev").verdict, "few", "12 engine trades are still collecting");
  ok(cal.sources.find((s) => s.id === "picks-ai").n === 70, "the AI grader is scored from its stored tier");
  ok(cal.sources.find((s) => s.id === "prediction-markets").n === 45 && cal.sources.find((s) => s.id === "earnings-implied-move").n === 60, "prediction and earnings rows counted");
  ok(cal.sources.every((s) => s.read && s.verdict), "every source has a verdict and a sentence");
  eq(foldPredictionLog(fx.state.predLog, fx.ctx.predictionResolved).length, 45, "settled contracts are logged once");
  eq(recordSources([{ outcome: "flat", contract: { pop: 0.5 } }])[0].rows.length, 0, "flat trades are not graded as wins or losses");
  eq(engineSources([{ engine: "x", score: 50, optionPnlPct: 5 }], {})[0].rows.length, 1, "engine adapter"); eq(loopSources([{ pn: 0, p5: 50, y5: 1 }])[0].rows.length, 0, "unfitted loop rows are left out");
  eq(predictionSource([{ p: 0.4, y: 1 }]).rows.length, 1, "prediction adapter"); eq(earningsMoveSource({ tickers: { A: { events: [{ impliedMoveEstPct: 0.05, movePct: 0.02 }] } } }).rows.length, 0, "estimated implied moves are not graded");
  eq(buildCalibrationLab([null, { id: "x", label: "x", rows: [] }]).sources.length, 1, "an empty source is listed as collecting");

  // --- registry ------------------------------------------------------------------------------
  {
    const rnd = mulberry32(12), gauss = gaussOf(rnd);
    const good = Array.from({ length: 300 }, () => 4 + 12 * gauss());
    eq(registryRow({ id: "g", label: "g", family: "x", returns: good, trials: 1 }).verdict, "holds", "a strong result with one attempt holds");
    ok(["lucky", "unproven"].includes(registryRow({ id: "g", label: "g", family: "x", returns: good.slice(0, 40).map((v) => v - 1), trials: 500 }).verdict), "the same kind of result after 500 attempts does not");
    eq(registryRow({ id: "l", label: "l", family: "x", returns: good.map((v) => -v), trials: 1 }).verdict, "losing", "a losing book");
    eq(registryRow({ id: "f", label: "f", family: "x", returns: good.slice(0, 5), trials: 1 }).verdict, "few", "too few trades");
    ok(registryRow({ id: "g", label: "g", family: "x", returns: good, trials: 1 }).tNeeded < registryRow({ id: "g", label: "g", family: "x", returns: good, trials: 50 }).tNeeded, "the bar rises with attempts");
  }
  ok(trialsFor("top-picks") >= 10 && trialsFor("nope") === 1 && TRIAL_LOG.every((r) => r.trials > 0 && r.what), "the trial log");
  const reg = p.registry;
  ok(reg.rows.some((r) => r.id === "top-picks") && reg.rows.some((r) => r.id === "spy-baseline") && reg.rows.some((r) => r.id === "engine-tec"), "registry books");
  eq(reg.rows.find((r) => r.id === "spy-baseline").trials, 1, "the baseline counts one attempt"); ok(reg.research.length === 1 && reg.trials.length === TRIAL_LOG.length, "research tests and the trial log are listed");
  eq(buildRegistry([]).rows.length, 0, "an empty registry");

  // --- volatility ---------------------------------------------------------------------------------
  const vol = p.vol;
  eq(vol.status, "ok", "volatility lab ran"); ok(VOL_MODELS.includes(vol.model), "a known model is in use");
  eq(vol.names.length, 33, "one row per symbol with bars");
  ok(vol.names.every((r) => r.forecast > 0 && r.forecast < 400 && r.trailing > 0 && r.garch > 0 && r.ewma > 0 && r.har > 0), "every model forecasts a sane annual volatility");
  ok(vol.names.every((r) => r.premium == null || Math.abs(r.premium - (r.iv - r.forecast)) < 0.11), "premium is the option price minus the forecast");
  ok(vol.names.every((r) => r.rank == null || (r.rank >= 0 && r.rank <= 100)) && vol.names.some((r) => r.rank >= 90), "premium ranks run 0 to 100");
  eq(vol.test.live.models.map((m) => m.model), VOL_MODELS, "four models tested"); ok(vol.test.history && vol.test.history.best === fx.ctx.research.vol.best, "the history test rides along");
  ok(["better", "same", "worse", "collecting"].includes(vol.premiumTest.verdict) && vol.premiumTest.read, "the premium test is a paired comparison with a verdict");
  ok(vol.premiumTest.verdict === "collecting" || (Number.isFinite(vol.premiumTest.gain) && Number.isFinite(vol.premiumTest.baseIc)), "the premium test reports the gain over the plain gap");
  eq(vol.byPremium.length, 3, "trades split into three premium bands"); ok(vol.tradesMatched > 0, "closed single options matched to a premium");
  eq(buildVolLab({ symbols: ["A"], barsOf: () => [], ivOf: () => [] }).status, "no-data", "no bars, no forecast");

  // --- factors ----------------------------------------------------------------------------------------
  const fac = p.factors;
  eq(fac.status, "ok", "factor lab ran"); eq(fac.names.length, 30, "one row per stock"); eq(fac.list.length, ALL_FACTORS.length, "every factor listed");
  ok(fac.names.every((r) => Object.values(r.f).every((v) => v == null || (v >= 0 && v <= 99))), "factor ranks run 0 to 99");
  ok(fac.snapshots >= 15 && fx.state.panel.length === fac.snapshots, "the weekly panel was backfilled for the price factors");
  ok(fac.skill.some((r) => r.key === "grade") && fac.skill.find((r) => r.key === "mom6").ic.some((x) => x.n > 0), "rank skill includes the grade and the price factors");
  ok(fac.skill.find((r) => r.key === "value").ic.every((x) => x.n <= 1), "fundamental factors have no backfilled history");
  eq(fac.exposures.map((b) => b.id), ["grade", "top-picks", "engine-tec", "engine-rev"], "a book for the grade, Top Picks and each engine");
  ok(fac.exposures[0].status === "ok" && fac.exposures[0].betas.length === 5 && Number.isFinite(fac.exposures[0].alpha), "the grade book's exposures");
  ok(fac.gradeVs.status === "ok" && fac.gradeVs.r2 >= 0 && fac.gradeVs.r2 <= 1 && fac.gradeVs.names.length === 30, "the grade against the factors");
  eq(fac.trades.length, 5, "one factor line per open trade"); eq(fac.trades.filter((t) => t.atEntry).length, 1, "only a trade opened today is logged on its entry day");
  ok(Object.keys(fx.state.entryFactors).length === 5, "entry factor values are frozen in the state file");
  {
    // A grade that is momentum by another name is caught.
    const rows = fac.names.map((r) => ({ s: r.s, grade: (r.f.mom6 - 50) / 6, f: r.f }));
    ok(gradeVsFactors(rows).r2 > 0.9, "a grade that copies momentum is almost fully explained");
    // A book that is twice the market loads 2 on the market.
    const rnd = mulberry32(3), gauss = gaussOf(rnd), days = Array.from({ length: 200 }, (_, i) => `d${String(i).padStart(3, "0")}`);
    const mk = new Map(days.map((d) => [d, 0.01 * gauss()])), other = new Map(days.map((d) => [d, 0.01 * gauss()]));
    const ex = exposures(days.map((d) => ({ d, r: 0.0005 + 2 * mk.get(d) + 0.002 * gauss() })), { market: mk, size: other });
    near(ex.betas[0].beta, 2, 0.1, "a known market lean is recovered"); ok(Math.abs(ex.betas[1].beta) < 0.15 && ex.r2 > 0.8, "an unrelated factor gets no weight");
    eq(exposures(days.slice(0, 10).map((d) => ({ d, r: 0.01 })), { market: mk }).status, "few", "too few days");
    eq(percentiles([1, 2, 3]).filter((v) => v != null).length, 0, "under five values are not ranked");
    const pnl = foldPanel(foldPanel([], panelSnapshot("2026-11-09", ["A"], () => 1)), panelSnapshot("2026-11-12", ["A"], () => 1));
    eq(pnl.map((x) => x.d), ["2026-11-12"], "one snapshot per week, the newest");
    // The history test on a longer synthetic universe with planted momentum.
    const market = fx.market.bars.slice(-1500), uni = synthUniverse({ market, names: 40, sessions: 1500, seed: 17 });
    const ev = evaluateFactors(Object.fromEntries(uni.symbols.map((s) => [s, uni.bars[s]])), market, { step: 21 });
    eq(ev.factors.length, PRICE_FACTORS.length, "every price factor tested"); eq(ev.trials, PRICE_FACTORS.length * 4, "trials = factors x horizons");
    const mom = ev.factors.find((f) => f.key === "mom12");
    const m63 = mom.ic.find((x) => x.h === 63);
    ok(m63.ic > 0.04 && m63.first > 0 && m63.second > 0 && mom.spread.perYear > 0, "planted drift shows up as momentum skill in both halves");
    ok(Math.abs(ev.factors.find((f) => f.key === "rev1").spread.t) < ev.tBar, "a factor with nothing planted does not clear the bar");
    ok(ev.tBar > 2.9 && publicFactorRows(ev).every((r) => !("_spread" in r)), "the bar counts the trials and the public rows carry aggregates only");
  }

  // --- annual report text ---------------------------------------------------------------------------------
  {
    const rnd = mulberry32(6);
    const words = "supply demand customers pricing regulation tariffs currency competition suppliers inventory litigation cybersecurity talent climate interest liquidity acquisitions technology patents markets".split(" ");
    const para = (seedWords) => `<p>${Array.from({ length: 45 }, () => seedWords[Math.floor(rnd() * seedWords.length)]).join(" ")}.</p>`;
    // Each paragraph of the old report has its own made-up vocabulary plus a few
    // shared words, the way real risk paragraphs each cover their own topic.
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const made = (n) => { let w = "", v = n + 7; for (let k = 0; k < 6; k++) { w += letters[v % 26]; v = Math.floor(v / 26) + 3 * k + 11; } return w; };
    const base = Array.from({ length: 40 }, (_, i) => para([...Array.from({ length: 14 }, (_, k) => made(i * 97 + k * 31)), ...words.slice(i % 15, (i % 15) + 4)]));
    const doc = (paras) => `<html><body><div>Table of contents</div><p>Item 1A. Risk Factors</p><p>Item 1B. Unresolved Staff Comments</p><h2>Item 1. Business</h2><p>We sell things.</p><h2>Item 1A. Risk Factors</h2>${paras.join("")}<h2>Item 1B. Unresolved Staff Comments</h2><p>None.</p><h2>Item 2. Properties</h2></body></html>`;
    const fresh = Array.from({ length: 12 }, () => para(["sanctions", "export", "licenses", "semiconductors", "restrictions", "controls", "china", "entity", "shipments", "wafers"]));
    const last = doc(base), same = doc(base), changed = doc([...base.slice(0, 30), ...fresh]);
    eq(htmlToLines("<p>a&amp;b</p><div>c&nbsp;d</div><script>x()</script>"), ["a&b", "c d"], "HTML to lines");
    const sec = riskSection(htmlToLines(last), "10-K");
    ok(sec && sec.length === 40, "the risk section is the long one, not the contents line"); eq(riskSection(htmlToLines("<p>Item 1A. Risk Factors</p><p>short</p>"), "10-K"), null, "a stub section is refused");
    const copy = compareSections(riskSection(htmlToLines(last)), riskSection(htmlToLines(same)));
    near(copy.sim, 1, 1e-6, "a straight copy is 100% similar"); eq(copy.added, 0, "a straight copy adds nothing");
    const diff = compareSections(riskSection(htmlToLines(last)), riskSection(htmlToLines(changed)));
    ok(diff.sim < 0.95 && diff.added === 12 && diff.removed === 10 && diff.newTerms.includes("sanctions") && diff.sample.length > 0, "a rewritten section shows its new paragraphs and words");
    eq(archiveUrl("0000320193", "0000320193-25-000079", "aapl-20250927.htm"), "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm", "archive link");
    const companies = Object.fromEntries(["AAA", "BBB", "CCC", "DDD", "EEE"].map((s, i) => [s, { cik: String(1000 + i), sub: { annual: [{ form: "10-K", filed: "2026-02-01", acc: `0000001000-26-00000${i}`, file: "now.htm" }, { form: "10-K", filed: "2025-02-01", acc: `0000001000-25-00000${i}`, file: "before.htm" }] } }]));
    const asked = [];
    const fetchImpl = async (url, opts) => {
      asked.push({ url, ua: opts?.headers?.["user-agent"] });
      if (/\/1003\//.test(url)) return { ok: false, status: 404, text: async () => "" };
      return { ok: true, status: 200, text: async () => (/now\.htm/.test(url) ? (/\/1001\//.test(url) ? same : changed) : last) };
    };
    const one = await refreshFilingText({ prior: null, companies, symbols: Object.keys(companies), fetchImpl, userAgent: "Test agent (test@example.com)", maxNames: 2, gapMs: 0 });
    eq(one.run.read, 2, "reads only the per-build allowance"); eq(one.waiting, 3, "the rest wait for later builds"); eq(asked.length, 4, "two documents per company");
    ok(asked.every((a) => a.url.startsWith("https://www.sec.gov/Archives/edgar/data/") && a.ua === "Test agent (test@example.com)"), "only SEC archive links, with the declared user agent");
    const two = await refreshFilingText({ prior: one.store, companies, symbols: Object.keys(companies), fetchImpl, maxNames: 5, gapMs: 0 });
    eq(two.run.read, 2, "already compared reports are not read again"); ok(two.store.DDD.failedAcc && two.run.errors.length === 1, "a failed read is recorded, not thrown");
    const three = await refreshFilingText({ prior: two.store, companies, symbols: Object.keys(companies), fetchImpl, maxNames: 5, gapMs: 0 });
    eq(three.run.requests, 0, "a failed report waits a week before a retry");
    let threw = false; try { await refreshFilingText({ companies, symbols: ["AAA"], fetchImpl: async () => { throw new Error("offline"); }, gapMs: 0 }); } catch { threw = true; }
    ok(!threw, "a network failure never throws into the build");
    const lab = buildFilingLab(two.store, { symbols: Object.keys(companies), waiting: 0 });
    eq(lab.read, 4, "compared reports listed"); eq(lab.failed.map((f) => f.s), ["DDD"], "failed reads listed"); ok(lab.rows[0].sim <= lab.rows[lab.rows.length - 1].sim, "least similar first");
    eq(lab.rows.find((r) => r.s === "BBB").flag, "copied", "a copied section is flagged");
  }
  const fil = p.filings;
  eq(fil.read, 12, "the fixture's compared reports"); eq(fil.waiting, 17, "still to read"); eq(fil.failed.length, 1, "a failed read is listed");
  ok(fil.summary.rewritten >= 1 && fil.summary.copied >= 1, "rewritten and copied flags");

  // --- files, switches, and the Owner / public split -------------------------------------------------------------
  const dir = await mkdtemp(join(tmpdir(), "quant-labs-"));
  try {
    const first = await loadQuantLabs(dir);
    ok(first.prior === null && first.stateRaw === null && Array.isArray(first.state.ddLog), "a missing file is a fresh start");
    const info = await writeQuantLabs(dir, p, fx.state);
    ok(info.bytes > 1000 && info.stateBytes > 1000, "both files written");
    const back = await loadQuantLabs(dir);
    eq(back.prior.card, p.card, "the page file reads back"); eq(back.state.ddLog, fx.state.ddLog, "the state reads back");
    const dir2 = await mkdtemp(join(tmpdir(), "quant-labs-carry-"));
    eq(await carryQuantLabs(dir2, back), 2, "a carry-forward writes both files back");
    eq(await readFile(join(dir2, QUANT_LABS_KEY), "utf8"), await readFile(join(dir, QUANT_LABS_KEY), "utf8"), "carried byte for byte");
    await rm(dir2, { recursive: true, force: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
  ok(quantLabsEnabled({}) && !quantLabsEnabled({ QUANT_LABS: "0" }), "QUANT_LABS=0 is the kill switch");
  ok(quantLabsTextEnabled({}) && !quantLabsTextEnabled({ QUANT_LABS_TEXT: "0" }) && !quantLabsTextEnabled({ QUANT_LABS: "0" }), "the SEC text reader has its own switch");

  const { isPremiumKey, roleClaimForKey } = await import("../lib/premium-keys.mjs");
  for (const key of [QUANT_LABS_KEY, QUANT_LABS_STATE_KEY]) { ok(isPremiumKey(key), `${key} is not public`); eq([...roleClaimForKey(key)].sort(), ["tp", "tr"], `${key} needs the full Owner session`); }
  const ownership = await readFile(resolve("lib/data-ownership.mjs"), "utf8");
  ok(ownership.includes('"quant-labs.json"') && ownership.includes('"quant-labs-state.json"'), "both keys are optional bake keys");
  const { FEATURE_DATASETS } = await import("../lib/mcp/tools.mjs");
  eq(FEATURE_DATASETS.quant.labs, QUANT_LABS_KEY, "the MCP serves the page file as quant.labs");
  ok(!JSON.stringify(FEATURE_DATASETS).includes(QUANT_LABS_STATE_KEY), "the MCP never serves the state file");
  const { OWNER_SETTINGS } = await import("../lib/owner-settings.mjs");
  ok(OWNER_SETTINGS.some((d) => d.key === "QUANT_LABS" && d.default === true) && OWNER_SETTINGS.some((d) => d.key === "QUANT_LABS_TEXT" && d.default === true), "both switches are on the Settings page");
  const app = await readFile(resolve("app.js"), "utf8"), html = await readFile(resolve("index.html"), "utf8");
  ok(app.includes("dataUrl('quant-labs.json')") && !app.includes("quant-labs-state.json"), "the browser reads the page file and never the state file");
  ok(/function qlFetch\(force\)\{\s*if \(!HAS_OWNER_ACCESS\) return Promise\.resolve\(null\);/.test(app), "the browser read is behind the Owner check");
  ok(html.includes('id="owner-panel-labs"') && html.includes('id="risk-odds" hidden') && html.includes('id="bottom-odds" hidden'), "the tab and both card hosts are in the page, hidden until filled");
  // Public Brief sources and the public manifest never name the labs.
  const build = await readFile(resolve("scripts/build.mjs"), "utf8");
  const briefSources = build.slice(build.indexOf("const BRIEF_TOOL_SOURCES"), build.indexOf("const BRIEF_TOOL_SOURCES") + 6000);
  ok(briefSources.length > 100 && !/quant-labs/.test(briefSources), "the public Brief does not read the labs");
  // The committed history results are aggregates: no stock, no trade row.
  const research = await readFile(resolve("research/quant-labs/results/latest.json"), "utf8");
  const { TICKERS } = await import("./build.mjs");
  ok(TICKERS.every((s) => !research.includes(`"${s}"`)), "the committed research file names no covered stock");
  ok(!/"tradeId"|"optionPnlPct"|"entryDate"/.test(research), "the committed research file holds no trade rows");
  const rj = JSON.parse(research);
  ok(rj.marketOdds.targets.length === 7 && rj.vol.models.length === 4 && rj.factors.rows.length === PRICE_FACTORS.length && rj.registry.length > 5, "the research file carries the three history tests");

  console.log(`quant labs smoke passed (${checks} checks, fixture ${fx.ms} ms)`);
}

if (process.argv[1] && /quant-labs-smoke\.mjs$/.test(process.argv[1])) await main();
