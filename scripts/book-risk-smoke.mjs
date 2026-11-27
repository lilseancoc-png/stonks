#!/usr/bin/env node
// Book risk v2 (2026-11-23): the risk math (lib/book-risk.mjs), the crash
// table (lib/book-risk-crashes.mjs) and the Open picks panel
// (scripts/render/book-risk-client.mjs) run in a stub page. No network.
import assert from "node:assert/strict";
import vm from "node:vm";
import { bookRiskFactory } from "../lib/book-risk.mjs";
import { BOOK_CRASHES } from "../lib/book-risk-crashes.mjs";
import { renderBookRiskJs } from "./render/book-risk-client.mjs";
import { greeks, bsPrice } from "../lib/greeks.mjs";
import { scenarioImpactFactory } from "../lib/scenario-engine.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);

// The factory is pasted into app.js with toString(): no outside names, no
// backslash, backtick or template opener.
const src = bookRiskFactory.toString();
ok(!/[\\`]/.test(src) && !src.includes("${"), "factory text survives the app.js template");
ok(!/\b(let|const)\s/.test(src) && !/=>/.test(src), "factory is ES5");

const BR = bookRiskFactory({ price: bsPrice, greeks, r: 0.04 });

// --- Ledoit-Wolf against a second, matrix-form coding (Ledoit's covCor) ---
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => { const u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function covCor(X) {
  const t = X.length, n = X[0].length;
  const sample = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0) / t));
  const sv = sample.map((r, i) => Math.sqrt(r[i]));
  let rs = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rs += sample[i][j] / (sv[i] * sv[j]);
  const rBar = (rs - n) / (n * (n - 1));
  const prior = sample.map((r, i) => r.map((v, j) => (i === j ? v : rBar * sv[i] * sv[j])));
  let phi = 0; const phiMat = sample.map((r, i) => r.map((s, j) => X.reduce((a, x) => a + (x[i] * x[j] - s) ** 2, 0) / t));
  phiMat.forEach((r) => r.forEach((v) => { phi += v; }));
  let rho = 0; for (let i = 0; i < n; i++) rho += phiMat[i][i];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const th = X.reduce((a, x) => a + x[i] ** 3 * x[j], 0) / t - sample[i][i] * sample[i][j];
    rho += rBar * (sv[j] / sv[i]) * th;
  }
  let gamma = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) gamma += (sample[i][j] - prior[i][j]) ** 2;
  const d = Math.max(0, Math.min(1, (phi - rho) / gamma / t));
  return { cov: sample.map((r, i) => r.map((v, j) => d * prior[i][j] + (1 - d) * v)), delta: d };
}
function panel(T, n, common) {
  const rows = [];
  for (let t = 0; t < T; t++) { const m = gauss(); rows.push(Array.from({ length: n }, (_, i) => 0.01 * (common * m + (1 + i * 0.1) * gauss()))); }
  const mu = rows[0].map((_, j) => rows.reduce((s, r) => s + r[j], 0) / T);
  return rows.map((r) => r.map((v, j) => v - mu[j]));
}
for (const [T, n, c] of [[252, 12, 0.8], [40, 25, 0.5], [500, 6, 0]]) {
  const X = panel(T, n, c);
  const a = BR.lwShrink(X), b = covCor(X);
  near(a.delta, b.delta, 1e-9, `Ledoit-Wolf shrinkage matches covCor (T ${T}, n ${n})`);
  near(a.cov[1][3], b.cov[1][3], 1e-12, "shrunk covariance entry matches");
  ok(a.delta >= 0 && a.delta <= 1, "shrinkage between 0 and 1");
}
ok(BR.lwShrink(panel(40, 25, 0.5)).delta > BR.lwShrink(panel(1000, 25, 0.5)).delta, "fewer days shrink more");

// --- crisis matrix: stock pairs reach the target, own swings kept, still valid ---
function chol(C) { const n = C.length, L = C.map(() => new Array(n).fill(0)); for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = C[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; if (i === j) { if (s < -1e-15) return null; L[i][i] = Math.sqrt(Math.max(0, s)); } else L[i][j] = L[j][j] > 0 ? s / L[j][j] : 0; } return L; }
{
  const syms = ["AAPL", "MSFT", "NVDA", "TLT", "GLD"];
  const sd = [0.015, 0.014, 0.03, 0.009, 0.01];
  const R = [[1, 0.5, 0.45, -0.2, 0.05], [0.5, 1, 0.4, -0.15, 0.02], [0.45, 0.4, 1, -0.25, 0], [-0.2, -0.15, -0.25, 1, 0.3], [0.05, 0.02, 0, 0.3, 1]];
  const C = R.map((r, i) => r.map((v, j) => v * sd[i] * sd[j]));
  const cr = BR.crisisCov(C, syms, 0.72);
  near(cr.rhoNow, (0.5 + 0.45 + 0.4) / 3, 1e-12, "today's stock correlation is the stock pairs only");
  const corr = (i, j) => cr.cov[i][j] / Math.sqrt(cr.cov[i][i] * cr.cov[j][j]);
  near((corr(0, 1) + corr(0, 2) + corr(1, 2)) / 3, 0.72, 1e-12, "crisis stock correlation reaches the March 2020 level");
  sd.forEach((s, i) => near(Math.sqrt(cr.cov[i][i]), s, 1e-12, `own swings unchanged (${syms[i]})`));
  ok(Math.abs(corr(0, 3)) < 0.2 && corr(0, 3) < 0, "a bond link keeps its sign and weakens");
  near(corr(3, 4), 0.3, 1e-12, "bond-gold link unchanged");
  ok(chol(cr.cov), "crisis matrix stays positive semidefinite");
  ok(BR.crisisCov(C, syms, 0.3).k === 0, "a lower target leaves the matrix alone");
}

// --- the year of days: synthetic market-days.json ---
const nD = 252, dates = [], moves = { SPY: [], AAA: [], BBB: [], TLT: [] };
let d0 = Date.UTC(2025, 10, 3);
for (let i = 0; i < nD; i++) {
  while ([0, 6].includes(new Date(d0).getUTCDay())) d0 += 864e5;
  dates.push(new Date(d0).toISOString().slice(0, 10)); d0 += 864e5;
  const m = 0.01 * gauss();
  moves.SPY.push(Math.round(m * 1e4));
  moves.AAA.push(Math.round((1.5 * m + 0.01 * gauss()) * 1e4));
  moves.BBB.push(i < 100 ? null : Math.round((0.8 * m + 0.008 * gauss()) * 1e4));
  moves.TLT.push(Math.round((-0.3 * m + 0.006 * gauss()) * 1e4));
}
const days = BR.seriesFrom({ dates, moves });
ok(days && days.bySym.SPY.length === nD && Math.abs(days.bySym.SPY[0] - moves.SPY[0] / 1e4) < 1e-12, "basis points read as decimals");
const sharesPos = (id, symbol, usd, src = "Top Picks") => ({ id, symbol, src, side: "shares", kind: "shares", S: 100, T: 0, legs: [], shares: usd / 100 });
const callPos = (id, symbol, K, q, iv, years, src = "Technicals") => ({ id, symbol, src, side: "call", kind: "option", S: 100, T: years, legs: [{ type: "call", K, q, iv }], shares: 0 });
const putPos = (id, symbol, K, q, iv, years, src = "Top Picks") => ({ id, symbol, src, side: "put", kind: "option", S: 100, T: years, legs: [{ type: "put", K, q, iv }], shares: 0 });

{
  const A = BR.analyze([sharesPos("s1", "SPY", 10000)], days, { crisisRho: 0.72 });
  ok(A.ok && A.days === nD, "analysis runs on a year of days");
  near(A.betaDelta, 10000, 1e-6, "SPY shares are their own S&P 500 dollars");
  const spy = days.bySym.SPY, mu = spy.reduce((a, b) => a + b, 0) / nD;
  const sd = Math.sqrt(spy.reduce((a, b) => a + (b - mu) ** 2, 0) / nD);
  near(A.smooth.sigma, 10000 * sd, 1e-6, "one-name smooth sigma is its own volatility");
  near(A.smooth.cvar95 / A.smooth.var95, 2.0627128 / 1.6448536, 1e-9, "normal tail average over the 1-in-20 loss");
  const losses = spy.map((r) => -10000 * r).sort((a, b) => b - a);
  near(A.hist.var95, losses[Math.ceil(nD * 0.05) - 1], 1e-6, "replayed 1-in-20 loss is the 13th worst day");
  near(A.hist.cvar95, losses.slice(0, 13).reduce((a, b) => a + b, 0) / 13, 1e-6, "replayed tail average is the 13 worst days");
  near(A.share.bySrc["Top Picks"], 1, 1e-9, "one trade carries all the risk");
  ok(A.hist.worst.date && A.hist.worst.pnl === -losses[0], "worst day carries its date");
}
{
  // A hedge: long AAA shares and AAA puts carry less than the shares alone.
  const alone = BR.analyze([sharesPos("s", "AAA", 20000)], days, {}).hist.cvar95;
  const hedged = BR.analyze([sharesPos("s", "AAA", 20000), putPos("p", "AAA", 100, 2, 0.4, 0.15)], days, {}).hist.cvar95;
  ok(hedged < alone, `puts cut the tail (${hedged.toFixed(0)} < ${alone.toFixed(0)})`);
  const A = BR.analyze([sharesPos("s", "AAA", 20000), callPos("c", "BBB", 105, 3, 0.45, 0.2), sharesPos("t", "TLT", 10000, "Multi-asset rotation"), sharesPos("x", "XLE", 5000, "Momentum basket")], days, { crisisRho: 0.72 });
  ok(A.ok && A.proxied.includes("XLE"), "a fund the file does not carry moves with SPY and is listed");
  ok(A.gaps.includes("BBB"), "a name listed part way through the year is filled by its beta and listed");
  near(A.betas.AAA, 1.5, 0.25, "beta read from the year of moves");
  ok(A.betas.TLT < 0, "a bond fund's beta is negative");
  const shareSum = Object.values(A.share.bySrc).reduce((a, b) => a + b, 0);
  near(shareSum, 1, 1e-9, "shares of risk add to 100%");
  ok(A.share.bySrc["Multi-asset rotation"] < 0.05, "the bond fund carries little or negative risk");
  ok(A.crisis.var95 >= A.smooth.var95 - 1e-6, "moving together never lowers a long book's risk");
  ok(A.nEff > 1 && A.nEff < 4, `diversification reads as a few bets (${A.nEff.toFixed(2)})`);
  ok(A.hist.var95 > 0 && A.hist.cvar95 >= A.hist.var95, "tail average is at least the 1-in-20 loss");
}
{
  ok(!BR.analyze([], days).ok && BR.analyze([sharesPos("s", "SPY", 1)], { dates: [], bySym: {} }).why === "no-returns", "no trades or no SPY: no analysis");
  ok(BR.analyze([sharesPos("s", "SPY", 1)], { dates: dates.slice(0, 20), bySym: { SPY: days.bySym.SPY.slice(0, 20) } }).why === "few-days", "fewer than 60 days: no analysis");
}

// --- greeks and replays ---
{
  const g = BR.greeksOf(callPos("c", "AAA", 100, 2, 0.4, 0.25));
  const ref = greeks("call", 100, 100, 0.25, 0.4, 0.04);
  near(g.deltaUsd, ref.delta * 2 * 100 * 100, 1e-9, "option delta $ = delta x contracts x 100 x spot");
  near(g.vegaUsd, ref.vega * 2 * 100, 1e-9, "vega $ per volatility point");
  near(g.thetaUsd, ref.thetaDay * 2 * 100, 1e-9, "decay $ per day");
  const exp = BR.greeksOf({ ...callPos("c", "AAA", 90, 1, 0.4, 0), T: 0 });
  near(exp.valueUsd, 1000, 1e-9, "an expired call is worth its intrinsic value");
  const covid = BOOK_CRASHES.windows.find((w) => w.id === "covid-2020");
  const r = BR.replay([sharesPos("s", "SPY", 10000), putPos("p", "AAPL", 95, 1, 0.3, 0.2), sharesPos("n", "NEWCO", 5000)], covid, { NEWCO: 2 });
  near(r.rows.find((x) => x.id === "s").pnl, 10000 * covid.moves.SPY, 1e-6, "shares replay their own move");
  near(covid.moves.SPY, covid.spy, 1e-9, "SPY's own row is the window's S&P move");
  ok(r.rows.find((x) => x.id === "p").pnl > 0, "a put gains in the crash");
  near(r.rows.find((x) => x.id === "n").move, 2 * covid.spy, 1e-12, "an unlisted stock moves by beta x SPY");
  ok(r.viaBeta === 1 && r.own === 2, "replay counts own moves and beta moves");
  near(r.ivAdd, (covid.vix.to - covid.vix.from) / 100, 1e-12, "options' volatility rises by the VIX's rise");
  const SI = scenarioImpactFactory();
  const scare = SI.PRESETS.find((p) => p.key === "growth-scare");
  const w = BR.whatIf([sharesPos("s", "AAA", 10000), sharesPos("b", "BBB", 10000)], scare, { AAA: { vector: { marketBeta: { value: 1.5 } }, annualizedVolPct: 30 } }, SI.impact, { BBB: 1 });
  near(w.rows.find((x) => x.id === "s").move, SI.impact({ marketBeta: { value: 1.5 } }, 30, scare.shocks).mid / 100, 1e-12, "What-if uses the scenario layer's shock rule");
  near(w.rows.find((x) => x.id === "b").move, scare.shocks.spyPct / 100, 1e-12, "a name without a sensitivity moves by beta");
}

// --- exposure by stock and opposite bets (2026-11-25) ---
{
  const put = (id, symbol, q, src) => ({ id, symbol, src, side: "put", kind: "option", S: 100, T: 30 / 365, legs: [{ type: "put", K: 100, q, iv: 0.3 }], shares: 0 });
  const call = (id, symbol, q, src) => ({ id, symbol, src, side: "call", kind: "option", S: 100, T: 30 / 365, legs: [{ type: "call", K: 100, q, iv: 0.3 }], shares: 0 });
  const far = { id: "f", symbol: "DDD", src: "Macro", side: "put", kind: "option", S: 100, T: 2 / 365, legs: [{ type: "put", K: 40, q: 1, iv: 0.3 }], shares: 0 };
  const P = [sharesPos("s1", "SPY", 10000, "Rotation"), put("p1", "SPY", 5, "Macro"), sharesPos("s2", "SBUX", 9500, "Flow trial"), put("p2", "SBUX", 4, "Fundamentals"),
    call("c1", "AAA", 2, "Top Picks"), sharesPos("s3", "AAA", 3000, "Technicals"), sharesPos("s4", "DDD", 2000, "Trend"), far];
  const G = P.map(BR.greeksOf);
  const B = BR.bySymbol(P, G, { SPY: 1, SBUX: 0.6, AAA: 1.4 });
  const by = Object.fromEntries(B.rows.map((r) => [r.symbol, r]));
  ok(B.rows.length === 4 && B.clashes === 2, "four stocks, two with opposite bets");
  ok(by.SPY.clash && by.SPY.clash.longBy[0] === "Rotation" && by.SPY.clash.shortBy[0] === "Macro", "SPY: shares long, put short, by engine");
  near(by.SPY.deltaUsd, G[0].deltaUsd + G[1].deltaUsd, 1e-9, "SPY nets both trades");
  ok(by.SPY.clash.nets === (by.SPY.deltaUsd > 0 ? "long" : "short") || by.SPY.clash.nets === "flat", "SPY says which side wins");
  near(by.SPY.clash.cancelledUsd, Math.min(G[0].deltaUsd, -G[1].deltaUsd), 1e-9, "cancelled $ is the smaller side");
  ok(by.SBUX.clash, "SBUX shares vs puts flagged");
  ok(!by.AAA.clash && by.AAA.n === 2, "a call and shares on one stock are the same side, not flagged");
  ok(Math.abs(G[7].deltaUsd) < 1 && !by.DDD.clash, "a put under $1 of delta $ does not count as a side");
  near(by.AAA.betaUsd, by.AAA.deltaUsd * 1.4, 1e-9, "S&P 500 $ is net delta times beta");
  ok(by.DDD.betaUsd === null, "no beta, no S&P 500 $");
  near(by.SPY.thetaUsd, G[1].thetaUsd, 1e-12, "decay comes from the options only");
  ok(by.SPY.trades.length === 2 && by.SPY.trades[0].qty > 0 && by.SPY.trades.some((t) => t.kind === "shares" && t.qty === 100), "trades listed with their sizes");
  for (let i = 1; i < B.rows.length; i++) ok(Math.abs(B.rows[i - 1].deltaUsd) >= Math.abs(B.rows[i].deltaUsd), "rows run largest first");
  const flat = BR.bySymbol([sharesPos("a", "X", 1000, "A"), sharesPos("b", "X", 1000, "B")], [{ deltaUsd: 1000, thetaUsd: 0, vegaUsd: 0, valueUsd: 1000 }, { deltaUsd: -950, thetaUsd: 0, vegaUsd: 0, valueUsd: 0 }], null);
  ok(flat.rows[0].clash.nets === "flat" && flat.rows[0].betaUsd === null, "a near-even clash nets about flat; no betas while loading");
  ok(BR.bySymbol([], [], null).rows.length === 0, "an empty book has no rows");
  const tiny = BR.bySymbol([sharesPos("a", "Y", 100000, "Trend"), sharesPos("b", "Y", 1000, "Macro")], [{ deltaUsd: 100000, thetaUsd: 0, vegaUsd: 0, valueUsd: 0 }, { deltaUsd: -2000, thetaUsd: -5, vegaUsd: 0, valueUsd: 0 }], null);
  ok(!tiny.rows[0].clash && tiny.clashes === 0, "a small put beside a big share lot (under a tenth) is not an opposite bet");
  // The earnings straddle (2026-11-27): its call and put are one position, not an opposite bet.
  const leg = (id, type, q) => ({ ...(type === "call" ? call : put)(id, "STR", q, "Earnings"), trade: { straddle: { id: "ERN:STR-C" } } });
  const sp = [leg("sc", "call", 3), leg("sp", "put", 3)], sg = sp.map(BR.greeksOf);
  const sb = BR.bySymbol(sp, sg, null);
  ok(!sb.rows[0].clash && sb.clashes === 0 && sb.rows[0].n === 2, "a straddle's two legs are not tagged as opposite bets");
  near(sb.rows[0].deltaUsd, sg[0].deltaUsd + sg[1].deltaUsd, 1e-9, "a straddle nets both legs");
  const sx = BR.bySymbol([...sp, sharesPos("sx", "STR", 30000, "Technicals")], [...sg, { deltaUsd: -30000, thetaUsd: 0, vegaUsd: 0, valueUsd: 0 }], null);
  ok(sx.rows[0].trades.length === 3, "a straddle beside another trade on the stock still lists all three");
  const small = BR.bySymbol([sharesPos("a", "Z", 1000, "A"), sharesPos("b", "Z", 1000, "B")], [{ deltaUsd: 1000, thetaUsd: 0, vegaUsd: 0, valueUsd: 0 }, { deltaUsd: -200, thetaUsd: 0, vegaUsd: 0, valueUsd: 0 }], null);
  ok(!small.rows[0].clash, "a side under $250 is not an opposite bet");
  const odd = BR.positionOf({ symbol: "Q", side: "call", lastSpot: 100, contract: { structure: "debit_vertical", strike: 100, expiry: 1900000000, legs: "xx", iv: 0.3 } }, "T", true, { ledger: null, spot: (s, l) => l, yrs: () => 0.1, tradeId: () => "x" });
  ok(odd.kind === "option" && odd.legs.length === 1, "legs that are not a list fall back to the single strike");
  const soon = { id: "z", symbol: "Z", src: "T", side: "call", kind: "option", S: 100, T: 1 / 365.25, legs: [{ type: "call", K: 100, q: 2, iv: 0.4 }], shares: 0 };
  const worth = BR.valueAt(soon, 100, soon.T, 0), wk = BR.decayOver(soon, 7);
  near(wk, -worth, 1e-6, "an option expiring inside the week loses at most its value over the week");
  ok(BR.greeksOf(soon).thetaUsd * 7 < wk, "where seven days of theta would overstate it");
  const month = { ...soon, T: 60 / 365.25 };
  ok(Math.abs(BR.decayOver(month, 7) / (BR.greeksOf(month).thetaUsd * 7) - 1) < 0.1, "a two-month option's week is close to seven days of theta");
  ok(BR.decayOver(sharesPos("s", "Z", 1000), 7) === 0, "shares have no decay");
  const ivp = [{ symbol: "AAA", legs: [{ iv: null }] }, { symbol: "NOPE", legs: [{ iv: null }] }, { symbol: "AAA", legs: [{ iv: 0.3 }] }];
  ok(BR.fillIv(ivp, BR.seriesFrom({ dates, moves })) === 2 && ivp[0].legs[0].iv > 0.05 && ivp[1].legs[0].iv === 0.45 && ivp[2].legs[0].iv === 0.3 && !ivp[2].ivEst, "missing IV: own swings, else 45%; a known IV is kept");
}

// --- the crash table ---
{
  const ids = BOOK_CRASHES.windows.map((w) => w.id);
  eqList(ids, ["covid-2020", "bear-2022", "unwind-2024", "tariff-2025"], "four sell-offs");
  for (const w of BOOK_CRASHES.windows) {
    ok(w.spy < -0.05 && w.vix.to > w.vix.from, `${w.id}: S&P fell and the VIX rose`);
    ok(w.corr > 0.2 && w.corr < 0.95 && w.corrStocks >= 40, `${w.id}: average correlation measured on enough stocks`);
    ok(Object.keys(w.moves).length >= 70, `${w.id}: most covered names have their own move`);
    ok(Object.entries(w.moves).every(([k, m]) => k === "UVXY" || (m > -0.95 && m < 1.5)), `${w.id}: moves are adjusted (no split jumps)`);
    if (w.sessions < 30) ok(w.moves.UVXY > 0.5, `${w.id}: the volatility fund rose in a short sell-off`);
  }
  const bear = BOOK_CRASHES.windows.find((w) => w.id === "bear-2022");
  ok(bear.moves.AMZN > -0.6 && bear.moves.AMZN < -0.3, "AMZN's 2022 move is split-adjusted");
}
function eqList(a, b, m) { assert.deepEqual(a, b, m); checks++; }

// --- the panel in a stub page ---
{
  const fetched = [];
  const days2 = { dates, moves };
  const ctx = {
    HAS_OWNER_ACCESS: true, RFR: 0.04, SPOTS: { SPY: 600, AAA: 100, BBB: 100, TLT: 90 },
    console, Date, Math, JSON, Number, String, Object, Array, isFinite, Promise,
    VIEWS: { get: () => true, set: () => {} },
    document: { addEventListener() {} },
    $: () => null, dataUrl: (k) => "/data/" + k,
    fetch: (u) => { fetched.push(u); return new Promise(() => {}); },
    escapeHtml: (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    vtCbarHtml: (v, m, label) => "<span>" + label + "</span>",
    sectorGroupOf: (s) => (s === "TLT" ? "Funds" : "Tech"),
    bookExposureBarsHtml: () => "",
    tlTradeId: (o) => o.tradeId,
    posYrs: (exp) => Math.max(1e-6, (exp - Date.now() / 1000) / (365.25 * 86400)),
    stratBsPrice: (type, S, K, T, sigma, r) => (T <= 0 ? (type === "call" ? Math.max(0, S - K) : Math.max(0, K - S)) : bsPrice(type, S, K, T, sigma, r)),
    greeks, engName: (e) => ({ technicals: "Technicals", rotation: "Multi-asset rotation" }[e] || e),
    SCENARIO_IMPACT: scenarioImpactFactory(),
    marketState: { data: null },
  };
  const code = renderBookRiskJs() + "\nthis.bookRiskHtml = bookRiskHtml; this.bookData = bookData; this.BOOK_RISK = BOOK_RISK;";
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  ctx.opWb = { by: null };
  const exp = Math.round(Date.now() / 1000) + 40 * 86400;
  const open = [{ tradeId: "tp1", symbol: "AAA", side: "call", lastSpot: 100, contract: { strike: 100, exp, iv: 0.4 } }];
  const eng = [
    { tradeId: "e1", engine: "technicals", symbol: "BBB", side: "call", lastSpot: 100, contract: { structure: "shares", shares: 50, mid: 100 } },
    { tradeId: "e2", engine: "technicals", symbol: "BBB", side: "call", lastSpot: 100, contract: { strike: 105, expiry: exp, qty: 4, iv: null } },
    { tradeId: "e3", engine: "rotation", symbol: "TLT", side: "call", lastSpot: 90, contract: { structure: "shares", shares: 100, mid: 90 } },
    { tradeId: "e4", engine: "technicals", symbol: "AAA", side: "call", lastSpot: 100, shared: { role: "follower" }, noMirror: true, contract: { strike: 100, expiry: exp, qty: 1, iv: 0.4 } },
  ];
  let html = ctx.bookRiskHtml(open, eng);
  ok(/Book risk: the paper account/.test(html) && /4 trades/.test(html), "panel lists Top Picks and engine trades, a follower left out");
  ok(/Loading the last year/.test(html), "risk waits for the year of moves");
  ok(fetched.includes("/data/market-days.json") && fetched.includes("/data/calendar.json") && fetched.includes("/data/market-analysis.json"), "panel reads market days, the calendar and the What-if sensitivities");
  ok(/held by another trade on the same contract/.test(html), "the follower is named in the notes");
  ok(/had no implied volatility/.test(html), "an option with no IV is flagged");
  ctx.bookData.days = ctx.BOOK_RISK.seriesFrom(days2); ctx.bookData.daysAt = "x"; ctx.bookData.sens = []; ctx.bookData.sensLoading = false;
  html = ctx.bookRiskHtml(open, eng);
  for (const t of ["A bad day", "Last year’s days replayed", "Smooth estimate", "like March 2020", "Who carries the risk", "Multi-asset rotation", "Covid crash, 2020", "April 2025 tariff shock", "Expiry ladder", "In S&amp;P 500 dollars"]) ok(html.includes(t), `panel shows ${t}`);
  ok(html.includes("Exposure by stock") && html.includes("a week") && /Opposite bets<\/span><b>None/.test(html), "panel shows exposure by stock, weekly decay and no opposite bets");
  const engClash = eng.concat([{ tradeId: "e5", engine: "rotation", symbol: "BBB", side: "put", lastSpot: 100, contract: { strike: 100, expiry: exp, qty: 6, iv: 0.35 } }]);
  html = ctx.bookRiskHtml(open, engClash);
  ok(/Opposite bets<\/span><b class="sig-neg">1 stock<\/b><small>BBB/.test(html), "a put against shares on one stock counts as an opposite bet");
  ok(/book-clash-row"><td><b>BBB/.test(html) && /long: Technicals · short: Multi-asset rotation/.test(html), "the clash row comes first and names both engines");
  ok(/Multi-asset rotation <small>6 puts<\/small>/.test(html) && /Technicals <small>50 sh<\/small>/.test(html), "trades show their size");
  // Webull sizes: a filled 3-lot replaces the record's 1, a missed trade drops out.
  ctx.opWb = { by: { tp1: { tradeId: "tp1", fillOutcome: "filled", state: "open", openQty: 3 }, e2: { tradeId: "e2", fillOutcome: "missed", state: "skipped", filledQty: 0 } } };
  html = ctx.bookRiskHtml(open, eng);
  ok(/1 missed at Webull/.test(html) && /3 trades/.test(html), "a trade Webull missed is left out");
  const memo = ctx.bookData.memo;
  ok(memo && memo.ok, "analysis cached for the page");
  ctx.HAS_OWNER_ACCESS = false; fetched.length = 0;
  ok(ctx.bookRiskHtml(open, eng) === "" && fetched.length === 0, "a public visitor gets nothing and fetches nothing");
}

console.log(`book risk smoke passed (${checks} checks)`);
