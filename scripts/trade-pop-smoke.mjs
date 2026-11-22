// Chance of profit on the Webull trades (lib/trade-pop.mjs, 2026-11-22).
// Offline: made-up trades, the real engine code through the engines fixture,
// and the page code run in a small sandbox. Exits 1 on any failure.
import vm from "node:vm";
import {
  POP, tradePopEnabled, modelChance, heldToExpiryChance, recordChance, blendChance, buildPopStamp,
  popResult, stampPopResults, compactPop, historyWinRate, liveWinRate, engineTradePop, picksTradePop,
  popRows, buildPopCheck, webullPopOutcomes, popLabSources, sessionsUntil, atmIv, realizedVol,
} from "../lib/trade-pop.mjs";
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
ok(lab.length === 3 && lab[0].rows.length === 3 && lab[2].rows.length === 2, "Calibration lab sources (record source skips rows with no record)");
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
vm.runInContext(renderTradePopJs() + "\nthis.__pop = { popWhyHtml, popChipHtml, popCellHtml, popCheckHtml, popSortOf, POP_TIP };", sandbox);
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
  const off = await enginesFixture({ sessions: 20 });
  ok(off.view.popCheck != null, "fixture: short run still builds the check");
} catch (err) { fail++; console.error("FAIL: engines fixture", err); }

console.log(`trade-pop smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
