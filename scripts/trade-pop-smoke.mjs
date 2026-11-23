// Chance of profit on the Webull trades (lib/trade-pop.mjs, 2026-11-22).
// Offline: made-up trades, the real engine code through the engines fixture,
// and the page code run in a small sandbox. Exits 1 on any failure.
import vm from "node:vm";
import {
  POP, tradePopEnabled, modelChance, heldToExpiryChance, recordChance, blendChance, buildPopStamp,
  popResult, stampPopResults, compactPop, historyWinRate, liveWinRate, engineTradePop, picksTradePop,
  popRows, buildPopCheck, webullPopOutcomes, popLabSources, sessionsUntil, atmIv, realizedVol,
  EG, expectedGain, engineForecast, loopForecastFor, pathVolOf, ivShiftOf, buildEgCheck, compactEg,
} from "../lib/trade-pop.mjs";
import { holdExitPolicy } from "../lib/top-picks-exit-review.mjs";
import { scoreChance } from "../lib/labs/calibration.mjs";
import { renderTradePopJs } from "./render/trade-pop-client.mjs";
import { OWNER_SETTINGS } from "../lib/owner-settings.mjs";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error("FAIL:", msg); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- switch ------------------------------------------------------------------
ok(tradePopEnabled({}) === true, "on by default");
for (const v of ["0", "off", "false", "no", " OFF "]) ok(tradePopEnabled({ TRADE_POP: v }) === false, `off on ${v}`);
ok(tradePopEnabled({ TRADE_POP: "1" }) === true, "on with 1");
const setting = OWNER_SETTINGS.find((s) => s.key === "TRADE_POP");
ok(setting && setting.scope === "build" && setting.default === true, "TRADE_POP is a build Owner Setting, default on");

// --- the market model ------------------------------------------------------------
const nowSec = Date.parse("2026-11-20T16:00:00Z") / 1000;
const atm = { id: "t1", kind: "option", side: "call", spot: 100, sigma: 0.3, rfr: 0.045, sessions: 40, T: 56 / 365, legs: [{ type: "call", strike: 100, qty: 1, iv: 0.3 }], tp: 25, stop: -50 };
const a1 = modelChance(atm), a2 = modelChance(atm);
ok(a1 && a1.p === a2.p && a1.avg === a2.avg, "seeded: the same trade gives the same chance");
ok(a1.p > 0.3 && a1.p < 0.8, `ATM call with +25/-50 exits lands in a sane range (${a1.p})`);
ok(near(a1.tp + a1.stop + a1.sStop + a1.sTarget + a1.end, 1, 0.005), "path endings add to one");
ok(a1.paths === POP.paths, "paths count");
const askBid = modelChance({ ...atm, entryRatio: 1.04, exitHaircut: 0.02 });
ok(askBid.p <= a1.p && askBid.avg < a1.avg, `ask in, bid out costs chance (${askBid.p} vs ${a1.p}, avg ${askBid.avg} vs ${a1.avg})`);
const noExits = modelChance({ ...atm, tp: null, stop: null, sessions: 39 });
const held = heldToExpiryChance({ spot: 100, breakeven: 100 + 4.9, sigma: 0.3, T: 56 / 365, rfr: 0.045, side: "call" });
ok(held > 0.2 && held < 0.5, `held-to-expiry chance of a long call is under a coin flip (${held})`);
ok(noExits && noExits.end > 0.99, "no exits: every path runs to the end");
const deepItm = modelChance({ ...atm, id: "t2", legs: [{ type: "call", strike: 60, qty: 1, iv: 0.3 }] });
ok(deepItm.p > 0.35 && deepItm.p < 0.65, `deep ITM call behaves like stock with a stop (${deepItm.p})`);
const put = modelChance({ ...atm, id: "t3", side: "put", legs: [{ type: "put", strike: 100, qty: 1, iv: 0.3 }] });
ok(put && put.p > 0.25 && put.p < 0.8, `put is modeled (${put && put.p})`);
const shares = modelChance({ id: "s1", kind: "shares", side: "call", spot: 50, sigma: 0.25, rfr: 0.045, sessions: 20, costPct: 0.1, stop: -8, tp: 12 });
ok(shares && shares.p > 0.35 && shares.p < 0.65, `shares about a coin flip (${shares && shares.p})`);
const sharesCost = modelChance({ id: "s1", kind: "shares", side: "call", spot: 50, sigma: 0.25, rfr: 0.045, sessions: 20, costPct: 2, stop: -8, tp: 12 });
ok(sharesCost.p < shares.p, "a bigger round-trip cost lowers the chance");
const stockStop = modelChance({ ...atm, id: "t4", stockStop: 97 });
ok(stockStop.sStop > 0.1, "a stock stop near the price fires on many paths");
const credit = modelChance({ id: "c1", kind: "option", side: "call", spot: 100, sigma: 0.35, rfr: 0.045, sessions: 30, T: 42 / 365, credit: true,
  legs: [{ type: "put", strike: 95, qty: -1, iv: 0.35 }, { type: "put", strike: 90, qty: 1, iv: 0.35 }], tp: 50, stop: -50 });
ok(credit && credit.p > 0.4, `bull put credit spread wins more often than not (${credit && credit.p})`);
const trail = modelChance({ ...atm, id: "t5", tp: null, trailArm: 20, trailGive: 10 });
ok(trail && trail.trail > 0.1 && near(trail.trail + trail.stop + trail.sStop + trail.sTarget + trail.end, 1, 0.005), `a trailing exit fires and the endings still add to one (${trail && trail.trail})`);
ok(a1.trail == null, "no trailing exit set: none reported");
ok(modelChance({ ...atm, sigma: null }) === null, "no volatility, no model");
ok(modelChance({ ...atm, sessions: 0 }) === null, "no horizon, no model");
ok(modelChance({ ...atm, legs: [] }) === null, "no legs, no model");

// --- the record and the blend --------------------------------------------------------
const rec = recordChance([{ id: "history", p: 0.6, n: 500, cap: 20 }, { id: "live", p: 0.4, n: 20 }]);
ok(rec.p === 0.5 && rec.n === 40, `history capped at 20 trades (${rec.p}, ${rec.n})`);
ok(rec.src[0].cap === 20 && rec.src[1].cap == null, "cap is shown on the capped source only");
const b = blendChance(0.6, { p: 0.4, n: 40 });
ok(b.w === 0.5 && b.p === 0.5, "40 trades = half weight");
ok(blendChance(0.6, { p: null, n: 0 }).p === 0.6, "no record: the model alone");
const nm = blendChance(null, { p: 0.8, n: 40 });
ok(nm.noModel && nm.p === 0.65, "no model: the record pulled toward a coin flip");
ok(blendChance(null, { p: null }) === null, "nothing: no chance");

// --- the stamp ------------------------------------------------------------------------
const stamp = buildPopStamp({ id: "x", at: "2026-11-20T16:00:00Z", model: { ...atm, sigmaFrom: "option IV", breakeven: 104.9, horizonWhy: "expiry" }, record: [{ id: "live", label: "Live", p: 0.55, n: 10 }], basis: "mid" });
ok(stamp && stamp.p > 0 && stamp.p < 1 && stamp.m === modelChance({ ...atm, id: "x" }).p && stamp.r === 0.55 && stamp.w === 0.2, "stamp blends model and record");
ok(stamp.mod.out && stamp.mod.held != null && stamp.mod.be === 104.9 && stamp.mod.hw === "expiry", "stamp keeps its why");
ok(JSON.stringify(stamp).length < 1400, `stamp stays small (${JSON.stringify(stamp).length} bytes)`);
const slim = compactPop({ ...stamp, res: { y: 1, pnl: 25 } });
ok(slim.res && !slim.mod && !slim.src, "the archive copy is slim");

// --- outcomes ------------------------------------------------------------------------
ok(popResult({ outcome: "win", optionPnlPct: 25.04, exitDate: "d" }).y === 1, "win is 1");
ok(popResult({ outcome: "flat", optionPnlPct: 0 }).y === 0, "flat is not a gain");
ok(popResult({ outcome: "void" }).y === null, "void grades nothing");
ok(popResult({ outcome: "win", counted: false }).y === null, "not counted grades nothing");
const closed = [{ outcome: "loss", optionPnlPct: -50, pop: { p: 0.5 } }, { outcome: "win", optionPnlPct: 10 }, { outcome: "win", optionPnlPct: 5, pop: { p: 0.6, res: { y: 0 } } }];
ok(stampPopResults(closed) === 1 && closed[0].pop.res.y === 0 && !closed[1].pop && closed[2].pop.res.y === 0, "outcome stamped once, never rewritten");
ok(stampPopResults(closed) === 0, "second pass changes nothing");

// --- helpers ----------------------------------------------------------------------------
ok(sessionsUntil("2026-11-20", "2026-11-27") === 5, "weekdays after Friday to next Friday");
ok(sessionsUntil("2026-11-20", "2026-11-20") === 0, "same day: no sessions");
const chain = { spot: 100, chains: { [String(Math.round(nowSec + 30 * 86400))]: { c: [{ s: 100, iv: 0.32 }], p: [{ s: 100, iv: 0.34 }] } } };
ok(near(atmIv(chain, nowSec * 1000), 0.33, 0.001), "ATM IV from the per-ticker chain");
const bars = Array.from({ length: 30 }, (_, i) => ({ c: 100 * (1 + 0.01 * Math.sin(i)) }));
ok(realizedVol(bars) > 0.05, "realized vol from closes");
const research = { learningOff: { engines: { REV: { bySetup: [{ key: "oversold-bounce", winRate: 0.58, n: 300 }], shares: { bySetup: [{ key: "oversold-bounce", winRate: 0.52, n: 120 }] }, trials: { bySetup: [{ key: "rsi2-dip", winRate: 0.61, n: 90 }] } } } } };
ok(historyWinRate(research, "REV", "oversold-bounce").p === 0.58, "history: option setup");
ok(historyWinRate(research, "REV", "oversold-bounce", { shares: true }).p === 0.52, "history: share setup");
ok(historyWinRate(research, "REV", "rsi2-dip", { trial: true }).n === 90, "history: trial");
ok(historyWinRate(research, "TEC", "x") === null, "history: unknown engine");
const me = { engine: "REV", setup: "oversold-bounce", side: "call", entryDate: "2026-11-20T16:00:00Z", contract: { structure: "single" } };
const lw = liveWinRate(me, [[{ ...me, tradeId: "a", outcome: "win", optionPnlPct: 20, exitDate: "2026-11-10" }, { ...me, tradeId: "b", outcome: "loss", optionPnlPct: -20, exitDate: "2026-11-12" }, { ...me, tradeId: "c", outcome: "win", optionPnlPct: 20, exitDate: "2026-11-25" }, { ...me, tradeId: "d", outcome: "void", optionPnlPct: 0 }], [{ ...me, tradeId: "a", outcome: "win", optionPnlPct: 20, exitDate: "2026-11-10" }]]);
ok(lw && lw.n === 2 && lw.p === 0.5, `live: only earlier closes, no voids, no duplicates (${lw && lw.n})`);
const flatRow = liveWinRate(me, [[{ ...me, tradeId: "f", outcome: "flat", optionPnlPct: 0.04, exitDate: "2026-11-10" }, { ...me, tradeId: "g", outcome: "win", optionPnlPct: 0.06, exitDate: "2026-11-10" }, { ...me, tradeId: "h", counted: false, outcome: "loss", optionPnlPct: -9, exitDate: "2026-11-10" }]]);
ok(flatRow && flatRow.n === 2 && flatRow.p === 0.5, `live: the record's own outcome decides (flat is not a win, not-counted is skipped): ${JSON.stringify(flatRow)}`);
ok(liveWinRate({ ...me, side: "put" }, [[{ ...me, outcome: "win", optionPnlPct: 5, exitDate: "2026-11-01" }]]) === null, "live: a different side is a different kind of trade");

// --- engine and Top Picks trades ---------------------------------------------------------
const expiry = Math.round(Date.parse("2026-12-18T12:00:00Z") / 1000);
const engOpt = { tradeId: "REV-1", engine: "REV", setup: "oversold-bounce", symbol: "AMD", side: "call", entryDate: "2026-11-20T16:00:00Z", entrySpot: 100,
  contract: { structure: "single", optionType: "call", strike: 100, expiry, iv: 0.45, mid: 5, entryFill: 5.2, spreadPct: 4 }, exits: { tp: 50, stop: -60, maxSessions: 15 } };
const eo = engineTradePop(engOpt, { research, closedLists: [], rfr: 0.045, nowMs: Date.parse(engOpt.entryDate), today: "2026-11-20", exitDay: "2026-12-11" });
ok(eo && eo.mod.kind === "option" && eo.mod.sessions === 15 && eo.mod.hw === "session limit", "engine option: the session limit is the horizon");
ok(eo.mod.entryRatio === 1.04 && eo.mod.haircut === 0.02 && eo.mod.basis === "ask in, bid out", "engine option: booked at the ask and bid");
ok(eo.src.length === 1 && eo.src[0].cap === POP.historyCap && eo.r === 0.58, "engine option: history test counted as 20 trades");
const eo2 = engineTradePop({ ...engOpt, exits: { tp: 50, stop: -60, maxSessions: 30 } }, { research, rfr: 0.045, nowMs: Date.parse(engOpt.entryDate), today: "2026-11-20", exitDay: "2026-12-11" });
ok(eo2.mod.sessions === 15 && eo2.mod.hw === "pre-expiry exit day", `the pre-expiry exit day caps the horizon (${eo2.mod.sessions} ${eo2.mod.hw})`);
const engShr = { tradeId: "TRD-1", engine: "TRD", setup: "trend", symbol: "SPY", side: "call", entryDate: "2026-11-20T16:00:00Z", entrySpot: 600, contract: { structure: "shares", mid: 600, shares: 80, costPct: 0.1 }, exits: {} };
const es = engineTradePop(engShr, { chain: { ...chain, spot: 600, chains: { [String(Math.round(nowSec + 30 * 86400))]: { c: [{ s: 600, iv: 0.16 }], p: [{ s: 600, iv: 0.18 }] } } }, rfr: 0.045, nowMs: Date.parse(engShr.entryDate) });
ok(es && es.mod.kind === "shares" && es.mod.sessions === 21 && es.mod.hw === "next monthly check" && es.mod.from === "option IV", "core holding: a month at the ATM IV");
ok(es.r == null && es.p === es.m, "no record: the model alone");
const esRv = engineTradePop(engShr, { bars, rfr: 0.045 });
ok(esRv && esRv.mod.from === "20-day realized", "no chain: realized volatility");
const esNone = engineTradePop(engShr, { research: { learningOff: { engines: { TRD: { shares: { bySetup: [{ key: "trend", winRate: 0.6, n: 40 }] } } } } } });
ok(esNone && esNone.m == null && esNone.noModel && esNone.mod.none, "no volatility at all: the record alone, pulled toward a coin flip");
const pick = { symbol: "NVDA", side: "put", entryDate: "2026-11-20T16:00:00Z", entrySpot: 180, cut: 192,
  contract: { structure: "long", strike: 180, expiry, iv: 0.5, breakeven: 171 } };
const pp = picksTradePop(pick, { exitPolicy: { takeProfitPct: 25, stopPct: 50 }, rfr: 0.045, setupOdds: { winPct: 55, n: 12, level: "side-band" }, loopOdds: { pTp: 50, n: 300, learning: true } });
ok(pp && pp.mod.tp === 25 && pp.mod.stop === -50 && pp.mod.sStop === 192, "Top Picks: the record's exits and the stock stop");
ok(pp.src[0].id === "setup" && pp.note && /learning/.test(pp.note), "Top Picks: a learning loop is not used, the setup odds are");
const pp2 = picksTradePop(pick, { exitPolicy: { takeProfitPct: 25, stopPct: 50 }, rfr: 0.045, loopOdds: { pTp: 47, n: 300, learning: false } });
ok(pp2.src[0].id === "loop" && pp2.r === 0.47, "Top Picks: a learned loop chance is the record");
const vert = picksTradePop({ ...pick, side: "call", contract: { structure: "debit_vertical", expiry, iv: 0.5, breakeven: 183, legs: [{ type: "call", strike: 180, qty: 1, iv: 0.5 }, { type: "call", strike: 190, qty: -1, iv: 0.48 }] } }, { exitPolicy: { takeProfitPct: 25, stopPct: 50 }, rfr: 0.045 });
ok(vert && vert.m != null, "Top Picks: a debit spread is modeled on both legs");

// --- the check ----------------------------------------------------------------------------
const flagship = [{ ...pick, tradeId: undefined, pop: { p: 0.5, m: 0.45, r: 0.55, res: { y: 1, pnl: 25, at: "2026-11-25" } } }];
const engines = [
  { ...engOpt, pop: { p: 0.6, m: 0.5, r: 0.58, res: { y: 0, pnl: -60, at: "2026-11-26" } } },
  { ...engShr, pop: { p: 0.52, m: 0.52, r: null } },
  { ...engOpt, tradeId: "REV-2", noMirror: true, pop: { p: 0.6, res: { y: 1 } } },
  { ...engOpt, tradeId: "REV-3", shadow: true, pop: { p: 0.6, res: { y: 1 } } },
  { ...engOpt, tradeId: "REV-4", trial: true, pop: { p: 0.4, m: 0.4, r: null, res: { y: 1, pnl: 3 } } },
];
const wbl = webullPopOutcomes({ trades: { a: { tradeId: "REV-1", paperPnlPct: 4.2, state: "closed" }, b: { tradeId: "TRD-1", paperPnlPct: null } } });
ok(Object.keys(wbl).length === 1 && wbl["REV-1"].pnl === 4.2, "Webull: only closed paper results");
const rows = popRows({ flagship, engines, webull: wbl });
ok(rows.length === 4, `rows leave out mirror-skipped and shadow trades (${rows.length})`);
ok(rows.find((r) => r.id === "REV-1").wy === 1 && rows.find((r) => r.id === "REV-1").y === 0, "the same chance is graded against the Webull fill too");
ok(rows[0].g === "top-picks" && rows.find((r) => r.id === "TRD-1").g === "engine-shares" && rows.find((r) => r.id === "REV-4").g === "trials", "groups");
const chk = buildPopCheck(rows, { builtAtIso: "2026-11-26T21:00:00Z", minN: 2 });
ok(chk.stamped === 4 && chk.open === 1 && chk.closed === 3, "check counts");
ok(chk.groups.length === 5 && chk.groups[0].methods.length === 3 && chk.groups[0].methods[0].buckets.length === 6, "check shape");
ok(chk.webull.n === 1 && chk.recent.length === 3 && chk.recent[0].x === "2026-11-26", "recent closes newest first");
const lab = popLabSources(rows);
ok(lab.length === 5 && lab[0].rows.length === 3 && lab[2].rows.length === 2, "Calibration lab sources (record source skips rows with no record)");
ok(lab[3].id === "trade-eg" && lab[3].kind === "score" && lab[3].rows.length === 0 && lab[4].id === "trade-eg-pop", "Calibration lab: the expected gain as a score and its chance (none stamped here)");

// --- expected gain ------------------------------------------------------------------------
const call10 = { kind: "option", side: "call", spot: 100, sigma: 0.4, rfr: 0.045, sessions: 10, T: 30 / 365, legs: [{ type: "call", strike: 102, qty: 1, iv: 0.4 }], stop: 60 };
const g0 = expectedGain({ id: "g", model: call10, forecast: { move: 0, sessions: 10 }, path: { sigma: 0.32, from: "rv" } });
const g2 = expectedGain({ id: "g", model: call10, forecast: { move: 2, sessions: 10 }, path: { sigma: 0.32, from: "rv" }, costUsd: 400 });
ok(g0 && g0.ev === g0.ev0 && g0.ev < 0, `no move: the expected result is the vehicle's cost (${g0 && g0.ev})`);
ok(g2.ev > g0.ev && g2.pop > g0.pop && g2.ev0 === g0.ev0, "a forecast move raises the expected result and the chance");
ok(g2.hurdle > 0 && g2.hurdle < 2.5, `a 30-day call held 10 sessions needs a small move (${g2.hurdle}%)`);
ok(g2.evUsd === Math.round((g2.ev / 100) * 400) || Math.abs(g2.evUsd - (g2.ev / 100) * 400) <= 1, "dollars on the money put in");
const atH = modelChance({ ...call10, id: "g", crn: true, pathSigma: 0.32, ivHalfLife: EG.ivHalfLife, moveSessions: 10, move: g2.hurdle }, { paths: EG.paths });
ok(Math.abs(atH.avgX) < 1.5, `at the break-even move the average result is about zero (${atH.avg})`);
ok(g2.twin && Math.abs(g2.twin.hurdle - EG.twinCostPct) < 0.1 && g2.better, `the shares twin breaks even at its cost (${g2.twin && g2.twin.hurdle}) and a vehicle is named (${g2.better})`);
ok(g0.better === "neither", "no forecast: neither vehicle is expected to gain");
const gRich = expectedGain({ id: "g", model: call10, forecast: { move: 2, sessions: 10 }, path: { sigma: 0.32 }, iv: { shift: -0.08 } });
ok(gRich.ev < g2.ev && gRich.ivEnd < 0.4 && gRich.hurdle > g2.hurdle, "IV drifting down costs the long option");
const gPut = expectedGain({ id: "gp", model: { ...call10, side: "put", legs: [{ type: "put", strike: 98, qty: 1, iv: 0.4 }] }, forecast: { move: 2, sessions: 10 }, path: { sigma: 0.32 } });
ok(gPut && gPut.ev > gPut.ev0 && gPut.twin.ev > 0, "a put gains from a move its way (the stock falling), and so does its short-shares twin");
const gSh = expectedGain({ id: "gs", model: { kind: "shares", side: "call", spot: 50, sigma: 0.3, rfr: 0.045, sessions: 20, costPct: 0.1 }, forecast: { move: 1.5, sessions: 20 }, path: { sigma: 0.3 } });
ok(gSh && Math.abs(gSh.ev - 1.4) <= 0.3 && gSh.twin === null && gSh.better === null, `shares: the expected result is about the move less the cost (${gSh && gSh.ev})`);
ok(expectedGain({ id: "g", model: { ...call10, sessions: 0 }, forecast: { move: 1 } }) === null, "no horizon: no expected gain");
ok(JSON.stringify(g2).length < 900, `the expected gain stays small (${JSON.stringify(g2).length} bytes)`);
const cEg = compactEg(g2);
ok(cEg.ev === g2.ev && cEg.hurdle === g2.hurdle && cEg.twin.ev === g2.twin.ev && !cEg.vol, "the slim copy keeps the headline numbers");
const t0 = Date.now(); expectedGain({ id: "speed", model: { ...call10, sessions: 40, T: 60 / 365 }, forecast: { move: 1, sessions: 40 }, path: { sigma: 0.3 } });
ok(Date.now() - t0 < 2000, `a 40-session option stamp stays quick (${Date.now() - t0} ms)`);
// The forecasts.
ok(pathVolOf(Array.from({ length: 70 }, (_, i) => ({ c: 100 * (1 + 0.01 * Math.sin(i)) }))).from === "20- and 60-session realized", "path volatility: 20 and 60 sessions");
ok(pathVolOf(null, 0.3).sigma === 0.3 && /option IV/.test(pathVolOf(null, 0.3).from), "path volatility: the option's IV without history");
ok(ivShiftOf({ ivRank: { mean: 0.35, iv: 0.45 } }).shift === -0.1 && ivShiftOf({}).shift === 0, "IV drifts toward its own mean, else flat");
const resF = { learningOff: { engines: { TEC: { bySetup: [], shares: { bySetup: [{ key: "pullback", n: 1061, avg: 1.1 }] } }, REV: { bySetup: [{ key: "oversold-bounce", n: 898, avg: 8.2 }], shares: { bySetup: [] }, trials: { bySetup: [{ key: "rsi2-dip", n: 2367, avg: 0.4 }] } } } } };
const fTec = engineForecast({ engine: "TEC", setup: "pullback", side: "call", entryDate: "2026-11-23" }, { research: resF });
ok(fTec.n === EG.historyCap && Math.abs(fTec.move - 1.1 * (EG.historyCap / (EG.historyCap + EG.shrinkK))) < 0.02, `engine forecast: the history share result, capped and shrunk (${fTec.move})`);
const liveC = [{ engine: "REV", setup: "oversold-bounce", side: "call", entrySpot: 100, exitSpot: 103, exitDate: "2026-11-10", tradeId: "x1" }, { engine: "REV", setup: "oversold-bounce", side: "call", entrySpot: 100, exitSpot: 99, exitDate: "2026-11-11", tradeId: "x2" }, { engine: "REV", setup: "oversold-bounce", side: "call", entrySpot: 100, exitSpot: 150, exitDate: "2026-12-30", tradeId: "late" }];
const fRev = engineForecast({ engine: "REV", setup: "oversold-bounce", side: "call", entryDate: "2026-11-23" }, { research: resF, closedLists: [liveC, liveC] });
ok(fRev.n === 2 && fRev.raw === 1 && Math.abs(fRev.move - 1 * 2 / 22) < 0.01 && fRev.ref && fRev.ref.optAvg === 8.2, `engine forecast: earlier live stock moves only, no duplicates, the option average as a reference (${JSON.stringify(fRev)})`);
const fTrial = engineForecast({ engine: "REV", setup: "rsi2-dip", side: "call", trial: true, entryDate: "2026-11-23" }, { research: resF });
ok(fTrial.raw === 0.4 && !fTrial.ref, "engine forecast: a paper trial reads the trials block");
ok(engineForecast({ engine: "MAC", setup: "x", side: "put" }, {}).move === 0, "engine forecast: nothing known is zero");
ok(engineForecast({ engine: "REV", setup: "oversold-bounce", side: "call" }, { research: { learningOff: { engines: { REV: { bySetup: [], shares: { bySetup: [{ key: "oversold-bounce", n: 1, avg: 14.1 }] } } } } } }).move === 0, "engine forecast: one history trade is not a record");
const resCore = { learningOff: { engines: { momentum: { core: { cagr: 26, from: "2007-02-01", swaps: 540 }, shares: { avg: 11.4, bySetup: [{ key: "top-10", n: 530, avg: 11.6 }, { key: "safe", n: 10, avg: 1.5 }, { key: "bonds", n: 4, avg: 1.7 }] } } } } };
const fCore = engineForecast({ engine: "momentum", setup: "top-10", side: "call", contract: { structure: "shares" } }, { research: resCore, sessions: 21 });
ok(fCore.raw > 1.8 && fCore.raw < 2.1 && fCore.sessions === 21 && /survivors/.test(fCore.from), `core engine: the portfolio's yearly growth over the stamp's month, not the per-trade average (${fCore.raw}%)`);
const fSafe = engineForecast({ engine: "momentum", setup: "safe", side: "call", contract: { structure: "shares" } }, { research: resCore, sessions: 21 });
ok(fSafe.raw > 0.2 && fSafe.raw < 0.4 && /share 13%/.test(fSafe.from), `core engine: the defensive holding gets its share of the growth (${fSafe.raw}%)`);
ok(engineForecast({ engine: "momentum", setup: "bonds", side: "call", contract: { structure: "shares" } }, { research: resCore, sessions: 21 }).move === 0, "core engine: a holding with too few history trades falls through to the live closes");
const ledgerKeys = ["d", "et", "s", "side", "em10", "im10", "pn"];
const ledger = { keys: ledgerKeys, rows: [["2026-11-20", "11:00", "NVDA", "call", 0.5, 6, 40], ["2026-11-23", "11:00", "NVDA", "call", 0.8, 6.2, 50], ["2026-11-23", "15:30", "NVDA", "call", 1.1, 6.1, 55], ["2026-11-23", "15:30", "AMD", "put", -0.3, 8, 30]] };
const lf = loopForecastFor(ledger, { date: "2026-11-23", symbol: "NVDA", side: "call", modelRows: 150 });
ok(lf && lf.move === 1.1 && lf.sessions === 10 && lf.n === 55 && lf.learning && lf.ref.implied10 === 6.1, "loop forecast: the day's latest row, learning below 200 model rows");
ok(loopForecastFor(ledger, { date: "2026-11-23", symbol: "AMD", side: "put", modelRows: 300 }).move === -0.3 && !loopForecastFor(ledger, { date: "2026-11-23", symbol: "AMD", side: "put", modelRows: 300 }).learning, "loop forecast: a put row");
ok(loopForecastFor(ledger, { date: "2026-11-23", symbol: "TSLA", side: "call" }) === null, "loop forecast: no row, none");
// The call hold (2026-11-22 flagship review): 10 sessions, the premium stop only.
const holdPick = { ...pick, side: "call", cut: 170, contract: { structure: "long", strike: 182, expiry, iv: 0.5, breakeven: 190, mid: 8 } };
const ph = picksTradePop(holdPick, { exitPolicy: holdExitPolicy(10, 60), rfr: 0.045, nowMs: Date.parse(pick.entryDate), forecast: { move: 1, sessions: 10, n: 40, from: "loop" } });
ok(ph && ph.mod.sessions === 10 && ph.mod.tp == null && ph.mod.stop === -60 && ph.mod.sStop == null && /held 10 sessions/.test(ph.mod.hw), `Top Picks call hold: 10 sessions, the -60% stop, no take-profit or stock stop (${JSON.stringify([ph && ph.mod.sessions, ph && ph.mod.hw])})`);
ok(ph.eg && ph.eg.fc.move === 1 && ph.eg.costUsd === 800 && ph.eg.sessions === 10, "Top Picks: the expected gain on one contract with the loop's move");
const pNoFc = picksTradePop(holdPick, { exitPolicy: holdExitPolicy(10, 60), rfr: 0.045, nowMs: Date.parse(pick.entryDate) });
ok(pNoFc.eg && pNoFc.eg.fc.move === 0 && /zero/.test(pNoFc.eg.fc.from), "Top Picks: no loop estimate is a zero forecast, labeled");
ok(picksTradePop(holdPick, { exitPolicy: holdExitPolicy(10, 60), rfr: 0.045, expectedGain: false }).eg == null, "expected gain can be left out");
ok(compactPop(ph).eg && compactPop(ph).eg.ev === ph.eg.ev, "the archive copy keeps the expected gain's headline");
// Grading.
const egRows = popRows({ flagship: [{ ...pick, pop: { p: 0.5, eg: { ev: 10, ev0: -8, pop: 0.45, hurdle: 1, fc: { move: 1.5 }, better: "shares" }, res: { y: 1, pnl: 30, at: "2026-11-25" } } }],
  engines: [{ ...engOpt, pop: { p: 0.4, eg: { ev: -20, ev0: -25, pop: 0.2, hurdle: 3, fc: { move: 0.2 }, better: "neither" }, res: { y: 0, pnl: -60, at: "2026-11-26" } } }, { ...engOpt, tradeId: "REV-9", pop: { p: 0.5, eg: { ev: 2, pop: 0.4, better: "option" } } }] });
const ec = buildEgCheck(egRows, { minN: 2 });
ok(ec.n === 3 && ec.closed === 2 && ec.open === 1 && ec.groups[0].stated === -5 && ec.groups[0].made === -15 && ec.verdict === "over", `the expected-gain check: stated against made (${JSON.stringify([ec.groups[0], ec.verdict])})`);
ok(ec.bands.find((b) => b.lo === 10).n === 1 && ec.bands.find((b) => b.lo === -Infinity || b.lo === null).n === 1, "the check's bands");
ok(ec.vehicle.find((v) => v.better === "option").open === 1, "the check counts the better vehicle");
ok(buildEgCheck([], {}).verdict === "few", "no rows: too few");
ok(buildPopCheck(egRows, { minN: 2 }).eg.closed === 2, "the chance check carries the expected-gain check");
ok(popLabSources(egRows)[3].rows.length === 2, "Calibration lab: closed trades with an expected gain are ranked");
const scored = scoreChance(lab[0], { minN: 2 });
ok(scored && scored.n === 3, "the Calibration lab scores them");

// --- the page code ---------------------------------------------------------------------------
const sandbox = {
  HAS_OWNER_ACCESS: true, console,
  escapeHtml: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
  VIEWS: { expandHtml: (l) => `<button data-vt-expand>${l}</button>`, get: () => true, set: () => {} },
  vtCbarHtml: (v, r, l) => `<span>${l}</span>`,
  document: { addEventListener() {} },
};
vm.createContext(sandbox);
vm.runInContext(renderTradePopJs() + "\nthis.__pop = { popWhyHtml, popChipHtml, popCellHtml, popCheckHtml, popSortOf, POP_TIP, egCellHtml, egSortOf, egCheckHtml, EG_TIP };", sandbox);
const P = sandbox.__pop;
const why = P.popWhyHtml(eo);
ok(/Our estimate: \d+%/.test(why) && /simulated paths/.test(why) && /ask/.test(why) && /History test/.test(why) && /counted as 20/.test(why), "the Why lays out the blend, the model and the record");
ok(/Set once when the trade opened/.test(why), "the Why says the chance is frozen");
ok(/not run/.test(P.popWhyHtml(esNone)), "the Why says when the model was not run");
ok(/No chance was stated/.test(P.popWhyHtml(null)), "a trade with no stamp says so");
ok(/Outcome: closed without a gain/.test(P.popWhyHtml({ ...eo, res: { y: 0, pnl: -60 } })), "the Why shows the outcome");
ok(/pop-chip/.test(P.popChipHtml({ pop: eo })) && P.popChipHtml({}) === "", "the card line");
ok(/data-vt-expand/.test(P.popCellHtml({ pop: eo }, true)) && !/data-vt-expand/.test(P.popCellHtml({}, true)), "the table cell has the expand button only with a stamp");
ok(P.popSortOf({ pop: eo }) === eo.p && P.popSortOf({}) === null, "sort key");
const egWhy = P.popWhyHtml(ph);
ok(/Expected gain: [+−]/.test(egWhy) && /breaks even at a move/.test(egWhy) && /Shares instead/.test(egWhy) && /Measure only/.test(egWhy), "the Why lays out the expected gain");
ok(/needs/.test(P.egCellHtml({ pop: ph })) && /—/.test(P.egCellHtml({})) && P.egSortOf({ pop: ph }) === ph.eg.ev && P.egSortOf({}) === null, "the expected-gain cell and sort");
ok(/Expected/.test(P.popChipHtml({ pop: ph })), "the card line shows the expected gain");
ok(/Expected gain check/.test(P.egCheckHtml(ec)) && /Too hopeful/.test(P.egCheckHtml(ec)) && /23 November/.test(P.egCheckHtml(null)), "the expected-gain check renders");
const page = P.popCheckHtml(chk);
ok(/Chance of profit check/.test(page) && /Top Picks/.test(page) && /Latest closes/.test(page) && /Webull fills/.test(page), "the check renders");
ok(/next 11:00 or 15:30/.test(P.popCheckHtml(null)), "no check yet says when it comes");
sandbox.HAS_OWNER_ACCESS = false;
ok(P.popCheckHtml(chk) === "" && P.popChipHtml({ pop: eo }) === "", "nothing shows without the Owner session");

// --- the engines, through the real engine code ------------------------------------------------
try {
  const { enginesFixture } = await import("./engines-fixture.mjs");
  const fx = await enginesFixture();
  const opened = [...fx.record.open, ...fx.record.closed];
  const stamped = opened.filter((t) => t.pop);
  ok(opened.length > 0 && stamped.length / opened.length > 0.8, `fixture: most engine trades carry a chance (${stamped.length} of ${opened.length})`);
  ok(stamped.every((t) => t.pop.p > 0 && t.pop.p < 1), "fixture: every chance is between 0 and 1");
  const closedStamped = fx.record.closed.filter((t) => t.pop);
  ok(closedStamped.every((t) => t.pop.res), "fixture: every closed trade with a chance has its outcome");
  ok(fx.view.popCheck && fx.view.popCheck.stamped > 0, "fixture: the page file carries the check");
  const viewOpen = (fx.view.engines || []).flatMap((e) => e.open || []);
  ok(viewOpen.some((t) => t.pop), "fixture: the page rows carry the chance");
  ok(stamped.filter((t) => t.pop.eg).length / stamped.length > 0.8 && stamped.every((t) => !t.pop.eg || (Number.isFinite(t.pop.eg.ev) && t.pop.eg.fc)), "fixture: engine trades carry an expected gain with its forecast");
  ok(fx.view.popCheck.eg && fx.view.popCheck.eg.n > 0, "fixture: the page file carries the expected-gain check");
  const off = await enginesFixture({ sessions: 20 });
  ok(off.view.popCheck != null, "fixture: short run still builds the check");
} catch (err) { fail++; console.error("FAIL: engines fixture", err); }

console.log(`trade-pop smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
