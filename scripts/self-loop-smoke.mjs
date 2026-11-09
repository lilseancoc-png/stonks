// Self-improving loop smoke test (lib/self-loop/, 2026-11-09). Offline,
// synthetic data only: no store, no network, no AI.
//
// Checks the prediction ledger (append, dedupe, prune, parse), the option
// replay (take-profit, stop, expiry, time limit, no fake day-one exit), the
// join to picks-outcomes.json, the calibration (walk-forward, shrinkage,
// learning label), the reliability read, the scorecard and rule audit, the two
// bake hooks end to end with the files round-tripping, the kill switch, the
// evidence rows, the Owner-only keys and the Owner Lab Loop view.
//
// Run: node scripts/self-loop-smoke.mjs

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import * as Lg from "../lib/self-loop/ledger.mjs";
import { cellKeys, estimateFor, fitCalibration, modelTable, reliability, MIN_ROWS_FOR_ESTIMATE, SHRINK_K } from "../lib/self-loop/calibrate.mjs";
import { buildScorecard, directionRead, gateAudit, historyRows, optionRead, rankSkill, tStat } from "../lib/self-loop/scorecard.mjs";
import * as Loop from "../lib/self-loop/index.mjs";
import * as Dg from "../lib/self-loop/diagnose.mjs";
import { appendRunOutcomes, emptyOutcomesState, fillOutcomes } from "../lib/picks-outcomes.mjs";
import { isPremiumKey, isRoleRestrictedKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { OPTIONAL_BAKE_KEYS, isBakeOwnedKey, isDynamicBakeKey, isLocalOnlyKey } from "../lib/data-ownership.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

// ---- fixtures ------------------------------------------------------------------------------
// Trading days from a start date, weekends skipped.
function sessions(start, n) {
  const out = [];
  let t = Date.parse(`${start}T12:00:00Z`);
  while (out.length < n) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}
const expEpoch = (date) => Date.parse(`${date}T00:00:00Z`) / 1000;
function runRow(s, tot, { spot = 100, out = "below-bar", ev = null, iv = 0.4, exp = null, signals = null, ep = null } = {}) {
  const side = tot < 0 ? "put" : "call";
  const k = Math.round(spot);
  return {
    s, side, tot, spot, out, signals: signals || { rsiMomentum: tot > 0 ? 1 : -1, smaStack: 0, guidance: 0.5 }, pillars: { f: 1.5, t: tot > 0 ? 2 : -2, m: 0 },
    iv: { atm: iv, pct: 50, z: 0, rv30: 0.3 }, ai: ev ? { ev } : null, tm: ep ? { ep } : null,
    c: exp ? { k, exp, dte: 45, b: 4.8, a: 5.2, m: 5, iv, d: side === "call" ? 0.55 : -0.55 } : null,
  };
}
function chainsFrom(paths) {
  const out = {};
  for (const [sym, bars] of Object.entries(paths)) out[sym] = { _bars: bars.map(([t, c]) => ({ t, c })) };
  return out;
}

// The two bake hooks over 50 sessions, one run a day over 10 names: the
// strong half of the book drifts its way, the weak half does not. Also the
// browser test's fixture (scripts/self-loop-browser.mjs).
export function selfLoopFixture({ runs = 50 } = {}) {
  const days = sessions("2026-11-10", 70);
  const syms = ["AAPL", "MSFT", "NVDA", "AMD", "META", "GOOGL", "AMZN", "TSLA", "NFLX", "AVGO"];
  const path = {};
  syms.forEach((s, j) => { path[s] = days.map((t, i) => [t, 100 * Math.pow(1 + (j < 5 ? 0.004 : -0.001), i) * (1 + 0.01 * Math.sin(i + j))]); });
  const state = Loop.emptyLoopState();
  const outcomes = emptyOutcomesState();
  const perRun = [];
  let view = null;
  for (let i = 0; i < runs; i++) {
    const d = days[i];
    const chainsToday = chainsFrom(Object.fromEntries(syms.map((s) => [s, path[s].slice(0, i + 1)])));
    const run = {
      et: "11:00", regime: { st: i % 2 ? "neutral" : "risk-on" }, lab: { cell: "up-calm" },
      rows: syms.map((s, j) => runRow(s, j < 5 ? 6 + (j % 3) : 1 + (j % 3), { spot: path[s][i][1], exp: expEpoch("2027-03-19"), out: j === 0 ? "pick:single" : j === 1 ? "gate:losing-streak" : "below-bar", ev: j === 0 ? "buy-now" : null, signals: { rsiMomentum: j < 5 ? 1 : -1, guidance: (j % 3) - 1 } })),
    };
    fillOutcomes(outcomes, chainsToday, { today: d });
    appendRunOutcomes(outcomes, run, d);
    perRun.push(Loop.loopOnRun(state, { run, date: d, outcomes, builtAtIso: `${d}T15:00:00Z` }).added);
    view = Loop.loopOnBake(state, { chains: chainsToday, outcomes, today: d, builtAtIso: `${d}T21:10:00Z` }).view;
  }
  return { state, view, perRun, days };
}

async function main() {
  // ---- ledger: append, dedupe, fields ------------------------------------------------------
  const days = sessions("2026-11-10", 70);
  const exp = expEpoch("2027-01-15");
  const L = Lg.emptyLedger();
  const run0 = {
    et: "11:00", regime: { st: "severe" }, lab: { cell: "up-calm" },
    rows: [
      runRow("AAPL", 6.2, { out: "pick:single", ev: "buy-now", exp, signals: { rsiMomentum: 1, smaStack: 0, macd: 0 } }),
      runRow("MSFT", -5.1, { out: "gate:crowd-squeeze", exp }),
      runRow("bad sym", 3),
      runRow("NVDA", 0.4),
    ],
  };
  const added = Lg.appendRunLedger(L, run0, days[0], { estimate: () => ({ p5: 51.23, p10: 52, p20: 53, em10: 0.333, pTp: 40, n: 7 }) });
  eq(added, 3, "three valid rows, the bad symbol dropped");
  eq(Lg.appendRunLedger(L, run0, days[0]), 0, "the same run twice adds nothing");
  const I = Lg.LEDGER_INDEX;
  const aapl = L.rows.find((r) => r[I.s] === "AAPL");
  eq(aapl[I.mk], "risk-off", "severe pools with risk-off");
  eq(aapl[I.cell], "up-calm");
  eq(aapl[I.et], "11:00", "the full run time is kept, as picks-outcomes keys it");
  eq(aapl[I.sig], { rsiMomentum: 1 }, "only non-zero votes are kept");
  eq(aapl[I.c], [100, exp, 5, 0.4], "the planned contract: strike, expiry, mid, iv");
  eq(aapl[I.px], 100, "the run spot is kept for the option model");
  eq(aapl[I.p5], 51.2, "estimates are rounded");
  eq(aapl[I.tot0], 6.2, "untuned total equals the total when no live weight moved it");
  eq(aapl[I.im10], Lg.impliedMove(0.4, 10), "the options' 10-session move from ATM IV");
  ok(Math.abs(Lg.impliedMove(0.4, 10) - 7.97) < 0.01, "40% IV prices about an 8% two-week move");
  const nvda = L.rows.find((r) => r[I.s] === "NVDA");
  eq(nvda[I.c], null, "no contract, no option replay");
  eq(nvda[I.p10], 52, "a name without a contract still gets its stock odds");
  // tot0 from baseTotals; the estimate reads the untuned band.
  const L2 = Lg.emptyLedger();
  let askedBand = null;
  Lg.appendRunLedger(L2, { et: "15:30", rows: [runRow("AMD", 7.4)] }, days[0], { baseTotals: { AMD: 4.2 }, estimate: (setup) => { askedBand = setup.band; return null; } });
  eq(L2.rows[0][I.tot0], 4.2);
  eq(askedBand, 4, "the estimate reads the band the calibration counted (untuned)");
  eq(L2.rows[0][I.mk], null, "no regime, no market type");
  // parse: a file written with a different key order or a missing key still reads.
  const shuffled = { keys: [...Lg.LEDGER_KEYS].reverse(), rows: L.rows.map((r) => [...r].reverse()) };
  eq(Lg.parseLedger(shuffled).rows, L.rows, "rows map by key name");
  const old = { keys: Lg.LEDGER_KEYS.filter((k) => k !== "px"), rows: L.rows.map((r) => r.filter((_, i) => i !== I.px)) };
  eq(Lg.parseLedger(old).rows[0][I.px], null, "a file from before a new key reads it as missing");
  eq(Lg.parseLedger({ rows: [["2026-02-30", "11:00", "AAPL", "call"], ["2026-11-10", "11:00", "AAPL", "long"], "x"] }).rows.length, 0, "bad dates, sides and rows are dropped");
  eq(Lg.parseLedger(null).rows, [], "nothing parses to empty");
  // prune keeps the newest N run days.
  const P = Lg.emptyLedger();
  days.slice(0, 5).forEach((d) => Lg.appendRunLedger(P, { et: "11:00", rows: [runRow("AAPL", 5)] }, d));
  eq(Lg.pruneLedger(P, 3), 2, "two oldest days pruned");
  eq(P.rows.map((r) => r[I.d]), days.slice(2, 5));
  eq(Lg.pruneLedger(P, 3), 0, "nothing more to prune");

  // ---- option replay ---------------------------------------------------------------------
  const opt = [100, exp, 5, 0.4];
  const flat = days.slice(1, 30).map((t) => ({ t, c: 100 }));
  const rise = days.slice(1, 30).map((t, i) => ({ t, c: 100 + 2 * (i + 1) }));
  const fall = days.slice(1, 30).map((t, i) => ({ t, c: 100 - 2 * (i + 1) }));
  const tpCall = Lg.simulateOption({ side: "call", opt, closes: rise, spot0: 100, d0: days[0] });
  eq(tpCall[0], "tp", "a steady rise reaches +25% on a call");
  ok(tpCall[1] >= 25 - Lg.OPTION_COST && tpCall[2] <= 5, "net of costs, within a few sessions");
  eq(Lg.simulateOption({ side: "call", opt, closes: fall, spot0: 100, d0: days[0] })[0], "stop", "a steady fall stops a call out");
  eq(Lg.simulateOption({ side: "put", opt, closes: fall, spot0: 100, d0: days[0] })[0], "tp", "and pays a put");
  const flatRes = Lg.simulateOption({ side: "call", opt, closes: flat, spot0: 100, d0: days[0] });
  eq(flatRes[0], "t20", "a flat stock runs the 20-session clock");
  ok(flatRes[1] < -Lg.OPTION_COST && flatRes[1] > -50, "and bleeds time value plus costs");
  eq(flatRes[2], 20);
  eq(Lg.simulateOption({ side: "call", opt, closes: flat.slice(0, 3), spot0: 100, d0: days[0] }), null, "undecided until a limit is hit");
  // A model value well under the quoted mid would fake a take-profit on day one
  // if the mid were the entry; the model entry removes that.
  const richMid = [100, exp, 3.2, 0.4];
  eq(Lg.simulateOption({ side: "call", opt: richMid, closes: flat.slice(0, 1), maxSessions: 1, spot0: 100, d0: days[0] })[0], "t20", "no fake day-one exit");
  eq(Lg.simulateOption({ side: "call", opt: richMid, closes: flat.slice(0, 1), maxSessions: 1 })[0], "tp", "(the mid alone would have faked one)");
  // Expiry inside the window.
  const shortExp = [100, expEpoch(days[3]), 2, 0.4];
  const expRes = Lg.simulateOption({ side: "call", opt: shortExp, closes: flat, spot0: 100, d0: days[0] });
  ok(expRes[0] === "exp" || expRes[0] === "stop", "a contract that expires inside the window is decided by then");
  ok(expRes[2] <= 3, "on or before its expiry session");
  eq(Lg.simulateOption({ side: "call", opt: [0, exp, 5, 0.4], closes: flat }), null, "a broken contract is skipped");
  // fill only uses sessions after the run day and before today.
  const F = Lg.emptyLedger();
  Lg.appendRunLedger(F, { et: "11:00", rows: [runRow("AAPL", 6, { exp })] }, days[0]);
  const fChains = chainsFrom({ AAPL: [[days[0], 100], ...days.slice(1, 4).map((t, i) => [t, 104 + 8 * i])] });
  eq(Lg.fillOptionOutcomes(F, fChains, { today: days[1] }), 0, "today's partial bar is not a close");
  eq(Lg.fillOptionOutcomes(F, fChains, { today: days[5] }), 1, "a later close decides it");
  eq(F.rows[0][I.o][0], "tp");
  eq(Lg.fillOptionOutcomes(F, fChains, { today: days[5] }), 0, "a decided row is not redone");

  // ---- join to the stock outcomes --------------------------------------------------------
  const O = emptyOutcomesState();
  const J = Lg.emptyLedger();
  const jRun = { et: "11:00", regime: { st: "neutral" }, rows: [runRow("AAPL", 5, { exp }), runRow("MSFT", -5, { exp })] };
  appendRunOutcomes(O, jRun, days[0]);
  Lg.appendRunLedger(J, jRun, days[0]);
  const jChains = chainsFrom({ AAPL: days.slice(0, 25).map((t, i) => [t, 100 + i]), MSFT: days.slice(0, 25).map((t, i) => [t, 100 + i]) });
  fillOutcomes(O, jChains, { today: days[24] });
  const joined = Lg.joinedRows(J, O);
  const jA = joined.find((r) => r.s === "AAPL"), jM = joined.find((r) => r.s === "MSFT");
  ok(jA.y10 > 0 && jM.y10 < 0, "moves are signed to the trade's side: a rise pays the call, hurts the put");
  eq(jA.y10, -jM.y10);
  eq(jA.cls, "below-bar");
  eq(Lg.joinedRows(J, null)[0].y10, null, "no outcome file, no outcome");

  // ---- calibration ----------------------------------------------------------------------
  const synth = [];
  for (let i = 0; i < 400; i++) {
    const d = days[i % 40];
    const strong = i % 2 === 0;
    // Strong calls go their way 80% of the time, weak ones 40%.
    const hit = strong ? (i % 10) < 7 : (i % 20) < 9;
    synth.push({ d, side: "call", tot: strong ? 7.5 : 1.5, tot0: strong ? 7.5 : 1.5, mk: i % 3 ? "neutral" : "risk-on", y5: hit ? 1 : -1, y10: hit ? 2 : -2, y20: hit ? 3 : -3, opt: { res: hit ? "tp" : "stop", net: hit ? 21.5 : -53.5 } });
  }
  const model = fitCalibration(synth, { before: days[40] });
  eq(model.rows, 400);
  const strongEst = estimateFor(model, { band: 7, side: "call", mk: "neutral" });
  const weakEst = estimateFor(model, { band: 1, side: "call", mk: "neutral" });
  ok(strongEst.p10 > 76 && strongEst.p10 < 81, `strong calls read near 80% (${strongEst.p10})`);
  ok(weakEst.p10 > 39 && weakEst.p10 < 44, `weak calls near 40% (${weakEst.p10})`);
  eq(strongEst.learning, false, "400 rows is past the learning bar");
  eq(strongEst.cell, "b7|call|neutral", "the finest cell with rows");
  ok(strongEst.ev > 0 && weakEst.ev < 0, "expected option value follows the hit rate");
  // Walk-forward: rows on or after the cut-off are not counted.
  eq(fitCalibration(synth, { before: days[0] }).rows, 0, "nothing before the first day");
  eq(fitCalibration(synth, { before: days[20] }).rows, 200, "only the earlier half");
  // Shrinkage: a cell with 5 rows says mostly what its parent says.
  const tiny = synth.filter((r) => r.tot === 7.5).slice(0, 200).concat([0, 1, 2, 3, 4].map((i) => ({ d: days[0], side: "put", tot: -7.5, tot0: -7.5, mk: "neutral", y10: 5, y5: 5, y20: 5, opt: null })));
  const tm = fitCalibration(tiny);
  const putEst = estimateFor(tm, { band: 7, side: "put", mk: "neutral" });
  ok(putEst.p10 < 90, `5 straight wins do not read as a sure thing (${putEst.p10})`);
  ok(putEst.p10 > estimateFor(tm, { band: 7, side: "call", mk: "neutral" }).p10, "but they do pull it up");
  eq(estimateFor(null, { band: 5, side: "call" }).p10, 50, "no model reads the coin-flip prior");
  eq(estimateFor(null, { band: 5, side: "call" }).n, 0);
  eq(estimateFor(null, {}).learning, true, "and says it is learning");
  eq(cellKeys({ band: 3, side: "put", mk: "risk-on" }), ["all", "b3", "b3|put", "b3|put|risk-on"]);
  eq(cellKeys({ band: 3 }), ["all", "b3"], "no side, no side cells");
  // useBase counts by the untuned total.
  const tuned = [{ d: days[0], side: "call", tot: 8.2, tot0: 3.1, y10: 1 }];
  ok(fitCalibration(tuned, { useBase: true }).cells.b3, "counted under the untuned band");
  ok(fitCalibration(tuned).cells.b8, "or the live band when asked");
  eq(modelTable(model).length, 20, "ten bands by two sides");
  eq(MIN_ROWS_FOR_ESTIMATE, 200);
  eq(SHRINK_K, 20);

  // ---- reliability -----------------------------------------------------------------------
  const perfect = reliability([{ p: 100, y: true }, { p: 0, y: false }]);
  eq(perfect.brier, 0);
  const coin = reliability(Array.from({ length: 10 }, (_, i) => ({ p: 50, y: i < 5 })));
  eq(coin.brier, 0.25);
  eq(coin.skillVsBase, 0, "the coin on a 50% base rate is the base rate");
  const good = reliability(Array.from({ length: 100 }, (_, i) => ({ p: i < 50 ? 80 : 20, y: i < 50 ? i < 40 : i < 60 })));
  ok(good.skillVsBase > 0.2, "sorted odds beat the base rate");
  eq(good.bins.map((b) => b.n), [50, 50]);
  eq(reliability([]).n, 0);

  // ---- scorecard pieces ------------------------------------------------------------------
  eq(directionRead([{ y10: 1 }, { y10: -1 }, { y10: 0 }, { y10: 2 }]).hit, 66.7, "flat moves are left out of the hit rate");
  eq(optionRead([]).n, 0);
  const or = optionRead([{ opt: { res: "tp", net: 21.5 } }, { opt: { res: "stop", net: -53.5 } }]);
  eq([or.n, or.tp, or.stop, or.win, or.avg], [2, 50, 50, 50, -16]);
  eq(tStat([1, 1, 1]), null, "no spread, no t");
  // Rank skill: totals that order the moves perfectly in every run.
  const rk = [];
  days.slice(0, 30).forEach((d) => [1, 2, 3, 4, 5, 6].forEach((k) => rk.push({ d, et: "11:00", side: "call", tot: k, y10: k })));
  const rs = rankSkill(rk, "y10");
  eq(rs.avg, 1);
  eq(rs.runs, 30);
  eq(rs.indep, 3, "one run per 10 sessions counts toward t");
  // Puts: a negative total with a falling stock is a correct call.
  const rkPut = [-6, -5, -4, -3, -2, -1].map((k) => ({ d: days[0], et: "11:00", side: "put", tot: k, y10: -k }));
  eq(rankSkill(rkPut, "y10").avg, 1, "the side sign is undone before ranking");
  // Rule audit.
  const ga = [];
  for (let i = 0; i < 25; i++) ga.push({ tot: 6, cls: "pick", out: "pick:single", opt: { res: "tp", net: 10 } });
  for (let i = 0; i < 25; i++) ga.push({ tot: 6, cls: "gate", out: "gate:losing-streak", opt: { res: "stop", net: -20 } });
  for (let i = 0; i < 25; i++) ga.push({ tot: -6, cls: "gate", out: "gate:crowd-squeeze", opt: { res: "tp", net: 30 } });
  for (let i = 0; i < 5; i++) ga.push({ tot: 6, cls: "gate", out: "gate:market-mode", opt: { res: "tp", net: 30 } });
  ga.push({ tot: 2, cls: "gate", out: "gate:losing-streak", opt: { res: "tp", net: 99 } });
  const audit = gateAudit(ga, { tradeBar: 4 });
  const byGate = Object.fromEntries(audit.gates.map((g) => [g.gate, g]));
  eq(byGate["losing-streak"].verdict, "paying", "the names it stopped did worse");
  eq(byGate["losing-streak"].saved, 30);
  eq(byGate["losing-streak"].n, 25, "a name under the trade bar is not counted");
  eq(byGate["crowd-squeeze"].verdict, "costing");
  eq(byGate["market-mode"].verdict, "collecting", "fewer than 20 names");
  // Whole scorecard + history on the joined fixture.
  const sc = buildScorecard(synth, { tradeBar: 4 });
  eq(sc.rows, 400);
  eq(sc.days, 40);
  ok(sc.direction.trade.y10.hit === 80, "trade-grade names went their way 80%");
  eq(sc.options.bySide[0].key, "call");
  eq(historyRows(synth).length, 40, "one history row per run date");

  // ---- the two hooks end to end ----------------------------------------------------------
  const { state, view, perRun } = selfLoopFixture();
  perRun.forEach((n, i) => eq(n, 10, `run ${i} logs every name`));
  eq(state.runs, 50);
  eq(state.ledger.rows.length, 500);
  ok(view.status.modelRows >= 300, `the model grew as outcomes resolved (${view.status.modelRows})`);
  eq(view.status.learning, false, "past 200 resolved rows");
  ok(view.status.resolved.opt > 0, "option outcomes modeled");
  eq(view.latest.count, 10);
  eq(view.latest.rows[0].s, "NVDA", "today's estimates, strongest grade first");
  const last = view.latest.rows.find((r) => r.s === "AAPL");
  ok(last.p10 > 55, `the strong drifting names read better than a coin by now (${last.p10})`);
  const weak = view.latest.rows.find((r) => r.s === "AVGO");
  ok(weak.p10 < last.p10, "the weak names read worse");
  ok(view.history.length > 0 && view.history.every((h) => h.d < days[49]), "history only from resolved dates");
  eq(view.model.length, 20);
  ok(view.scorecard.honesty.p10.n > 0, "estimates with real rows behind them are graded");
  // The first run's estimates came from an empty model: walk-forward, no peeking.
  const firstRows = state.ledger.rows.filter((r) => r[I.d] === days[0]);
  ok(firstRows.every((r) => r[I.p10] === 50 && r[I.pn] === 0), "the first run had nothing to learn from");
  // Evidence rows.
  const tests = Loop.loopEvidenceTests(view);
  eq(tests.map((t) => t.id), ["loop-honest-odds", "loop-gate-audit"]);
  ok(tests.every((t) => t.lane === "loop" && t.progress && t.rule), "each row has a lane, progress and a rule");
  eq(Loop.loopEvidenceTests(null), []);

  // ---- step 2: diagnosis ----------------------------------------------------------------
  eq(L.rows.find((r) => r[I.s] === "AAPL")[I.pl], { f: 1.5, t: 2 }, "pillar scores ride the ledger, zeros dropped");
  // 40 run dates x 12 names. "good" always lines up with the move; "late"
  // lined up for the first 20 dates and then turned; "flip" works in risk-on
  // and points the wrong way in risk-off.
  const dRows = [];
  const ddays = sessions("2026-06-01", 40);
  ddays.forEach((d, di) => {
    const mk = di % 2 ? "risk-on" : "risk-off";
    for (let j = 0; j < 12; j++) {
      const move = (j - 5.5) * (1 + (di % 3) * 0.1);
      const side = j % 2 ? "call" : "put";
      const signed = side === "put" ? -move : move;
      dRows.push({ d, et: "11:00", s: `S${j}`, side, tot: side === "put" ? -5 : 5, mk, cell: di % 4 < 2 ? "up-calm" : "down-stressed",
        sig: { good: j, late: di < 20 ? j : -j, flip: mk === "risk-on" ? j : -j, noise: (j * 7) % 5 }, pl: { f: j % 3 },
        y5: signed, y10: signed, opt: { res: side === "put" && mk === "risk-off" ? "stop" : "tp", net: side === "put" && mk === "risk-off" ? -53.5 : 21.5, days: side === "put" ? 2 : 6 } });
    }
  });
  const byRun = Dg.inputIcByRun(dRows, "y5");
  eq(byRun.length, 40, "one IC row per run");
  eq(byRun[0].ic.good, 1, "a perfectly aligned input reads +1");
  const decay = Object.fromEntries(Dg.inputDecay(dRows).map((x) => [x.key, x]));
  eq(decay.good.status, "working");
  eq(decay.late.status, "against", "an input that turned over the newest 20 sessions points the wrong way");
  eq(decay.late.all.avg, 0, "even though over all of it the two halves cancel");
  ok(decay["P:f"], "pillars are read as inputs");
  eq(Dg.inputLabel("P:f"), "Fundamentals pillar");
  eq(Dg.inputLabel("analystRevisions"), "analyst revisions");
  // Fading: worked over 60 sessions, nothing over the last 20.
  const fadeRows = [];
  sessions("2026-03-02", 60).forEach((d, di) => { for (let j = 0; j < 10; j++) fadeRows.push({ d, et: "11:00", side: "call", tot: 5, sig: { fade: di < 40 ? j : (j * 3) % 10 === 0 ? 1 : 0 }, y5: j - 4.5 }); });
  const fade = Dg.inputDecay(fadeRows).find((x) => x.key === "fade");
  ok(fade.w60.avg >= 0.02 && fade.w20.avg <= 0.02, `fixture shape (${fade.w60.avg}, ${fade.w20.avg})`);
  ok(fade.status === "fading" || fade.status === "quiet" || fade.status === "against", "a faded input is not called working");
  const few = Dg.inputDecay(dRows.filter((r) => r.d <= ddays[4]));
  ok(few.every((x) => x.status === "collecting"), "under 10 sessions every input is still collecting");
  const ms = Dg.marketSplits(dRows, { tradeBar: 4 });
  eq(ms.byMarket.map((g) => g.key), ["risk-on", "risk-off"]);
  const flipRow = ms.inputs.find((x) => x.key === "flip");
  eq(flipRow.flips, { works: ["risk-on"], against: ["risk-off"] }, "an input that changes sign with the market is named");
  eq(ms.inputs[0].key, "flip", "flipping inputs listed first");
  eq(ms.byCell.length, 2);
  const lp = Dg.lossPatterns(dRows, { tradeBar: 4 });
  eq(lp.n, 480);
  eq(lp.lossRate, 25);
  ok(lp.worst.some((g) => g.feature === "side x market" && g.value === "put / risk-off" && g.lossRate === 100), "puts in risk-off are the losing setup");
  ok(lp.best.length > 0);
  eq(lp.how.losses, 120);
  eq(lp.how.fastStop, 120, "all stopped within 3 sessions");
  eq(lp.how.wrongWay + lp.how.rightWayLost, 120);
  eq(Dg.lossPatterns([], {}).n, 0);
  // Weekly report timing (ET). 2026-11-13 is a Friday; 21:10Z is 16:10 ET.
  eq(Dg.mondayOf("2026-11-13"), "2026-11-09");
  eq(Dg.mondayOf("2026-11-15"), "2026-11-09", "Sunday belongs to the week before");
  eq(Dg.reportWeekDue("2026-11-13T21:10:00Z"), "2026-11-09", "after the Friday close: this week");
  eq(Dg.reportWeekDue("2026-11-13T20:30:00Z"), "2026-11-02", "Friday 15:30 ET: last week is the newest finished one");
  eq(Dg.reportWeekDue("2026-11-13T21:10:00Z", { lastWeek: "2026-11-09" }), null, "once per week");
  eq(Dg.reportWeekDue("2026-11-16T15:00:00Z", { lastWeek: "2026-11-02" }), "2026-11-09", "a missed Friday is caught up on Monday");
  eq(Dg.reportWeekDue("2026-11-13T21:10:00Z", { startedAt: "2026-11-16" }), null, "no report for a week before the loop started");
  eq(Dg.reportWeekDue("2026-07-03T20:10:00Z"), "2026-06-29", "summer time: 16:10 ET is 20:10Z");
  const rstate = { reports: [], startedAt: "2026-11-10" };
  const r1st = Dg.maybeAddWeeklyReport(rstate, { builtAtIso: "2026-11-13T21:10:00Z", rows: dRows, scorecard: buildScorecard(dRows), diagnosis: Dg.buildDiagnosis(dRows) });
  eq(r1st.week, "2026-11-09");
  ok(r1st.items.some((it) => it.kind === "input-against" && /late/.test(it.text)), "the report names the input that turned");
  ok(r1st.items.some((it) => it.kind === "loss-pattern"), "and the losing setup");
  eq(Dg.maybeAddWeeklyReport(rstate, { builtAtIso: "2026-11-13T22:00:00Z", rows: dRows }), null, "not twice in a week");
  const r2nd = Dg.maybeAddWeeklyReport(rstate, { builtAtIso: "2026-11-20T21:10:00Z", rows: dRows, scorecard: { ...buildScorecard(dRows), rank: { y10: { avg: 0.5 } } }, diagnosis: Dg.buildDiagnosis(dRows) });
  eq(rstate.reports.length, 2);
  ok(r2nd.change.rank10 != null, "the change since last week is computed");
  // The end-to-end fixture spans Fridays, so the view carries reports.
  ok(view.diagnosis && view.diagnosis.inputs.length > 0, "the view carries the diagnosis");
  ok(view.reports.length >= 5 && view.reports.length <= 8, `weekly reports in the view (${view.reports.length})`);
  ok(state.reports.every((r, i, a) => i === 0 || r.week > a[i - 1].week), "one report per week, in order");

  // ---- files ----------------------------------------------------------------------------
  const dir = await mkdtemp(resolve(tmpdir(), "stonks-self-loop-"));
  try {
    const info = await Loop.writeLoopFiles(dir, state, view);
    eq(info.rows, 500);
    ok(info.stateBytes > 0 && info.viewBytes > 0);
    ok(info.viewBytes < 120000, `the view stays small for the browser (${info.viewBytes} bytes)`);
    const loaded = await Loop.loadLoopState(dir);
    eq(loaded.error, undefined);
    eq(loaded.state.ledger.rows, state.ledger.rows, "the ledger round-trips");
    eq(loaded.state.history, state.history);
    eq(loaded.state.runs, 50);
    const fresh = await Loop.loadLoopState(resolve(dir, "missing"));
    eq(fresh.fresh, true, "a missing file is a fresh start");
    eq(fresh.state.ledger.rows, []);
    await writeFile(resolve(dir, Loop.LOOP_STATE_KEY), "not json");
    const bad = await Loop.loadLoopState(dir);
    ok(bad.error && bad.state && !bad.skip, "a corrupt file starts over");
    await rm(resolve(dir, Loop.LOOP_STATE_KEY));
    await mkdir(resolve(dir, Loop.LOOP_STATE_KEY));
    const unreadable = await Loop.loadLoopState(dir);
    eq(unreadable.skip, true, "a file that cannot be read skips the loop");
    eq(unreadable.state, null, "and leaves the stored copy alone");
  } finally { await rm(dir, { recursive: true, force: true }); }
  eq(Loop.parseLoopState("[]"), null);
  eq(Loop.parseLoopState(JSON.stringify({ runs: "x", history: [{ d: "2026-11-10" }, null, { x: 1 }] })).history.length, 1, "bad history rows dropped");

  // ---- kill switch -----------------------------------------------------------------------
  eq(Loop.loopEnabled({}), true);
  eq(Loop.loopEnabled({ LOOP: "0" }), false);
  eq(Loop.loopEnabled({ LOOP: "off" }), false);
  eq(Loop.loopEnabled({ LOOP: " FALSE " }), false);
  eq(Loop.loopEnabled({ LOOP: "1" }), true);
  eq(Loop.loopOnRun(null, {}).added, 0, "no state, no run hook");

  // ---- keys ------------------------------------------------------------------------------
  for (const key of [Loop.LOOP_STATE_KEY, Loop.LOOP_VIEW_KEY]) {
    eq(isPremiumKey(key), true, `${key} is private`);
    eq(isRoleRestrictedKey(key), true);
    eq(roleClaimForKey(key), ["tr", "tp"], "Owner claims required");
    ok(isBakeOwnedKey(key) && OPTIONAL_BAKE_KEYS.includes(key), `${key} is bake-owned and optional`);
    eq(isLocalOnlyKey(key), false);
    eq(isDynamicBakeKey(key), false, "never delete-staled");
  }

  // ---- render ----------------------------------------------------------------------------
  const { renderHtml, renderAppJs, renderStylesCss } = await import("./build.mjs");
  const app = renderAppJs({});
  ok(/function loadSelfLoop\(/.test(app), "app.js carries the loop loader");
  ok(/'regime','loop'\]\.indexOf\(view\)/.test(app), "the Owner Lab view switch accepts the loop view");
  ok(/data-owner-loop-refresh/.test(app), "refresh button is bound");
  ok(/\['loop', 'Self-improving loop'\]/.test(app), "the Evidence board lists the loop lane");
  ok(/dataUrl\('picks-loop\.json'\)/.test(app), "reads the view file, not the large state file");
  ok(!/picks-loop-state\.json/.test(app), "the browser never asks for the state file");
  ok(/\.slp-kpis \{/.test(renderStylesCss()), "stylesheet carries the view");
  const tmp = await mkdtemp(resolve(tmpdir(), "stonks-self-loop-html-"));
  try {
    const dataDir = resolve(tmp, "data"); await mkdir(dataDir);
    const html = await renderHtml({ symbols: ["AAPL"], builtAt: "Nov 9, 2026", builtAtIso: "2026-11-09T16:10:00Z", narratives: [], sectorOverviews: {}, spots: {}, dataDir });
    ok(/id="owner-tab-loop"/.test(html), "Owner Lab tab");
    ok(/id="owner-panel-loop"[^>]*hidden/.test(html), "panel starts hidden");
    ok(/id="self-loop-root"/.test(html), "panel root");
    ok(html.indexOf('id="owner-panel-loop"') > html.indexOf('id="owner-panel-regime"'), "panel sits after the Regime Lab");
  } finally { await rm(tmp, { recursive: true, force: true }); }

  console.log(`self-loop smoke: ok (${checks} checks)`);
}

if (process.argv[1] && /self-loop-smoke\.mjs$/.test(process.argv[1])) await main();
