#!/usr/bin/env node
// The earnings straddle paper trial (lib/engines/straddle.mjs, 2026-11-27):
// node scripts/engines-straddle-smoke.mjs. No network, no store, no AI:
// synthetic report histories and option chains through the real book code.
//
// Covers: the timing (after-the-close and before-the-open reports, unknown
// times, backup dates), the expected move, the straddle picker (first expiry
// that outlasts the sale, one strike for both legs), the cheap test, sizing,
// the day and open limits, the Owner controls, the sale on the reaction
// morning, the switch, opposite tags, the pair rows and the Webull merge.
import assert from "node:assert/strict";
import { STRADDLE, sessionAfter, straddleTiming, expectedMove, pickStraddle, isStraddleLeg, straddleRows } from "../lib/engines/straddle.mjs";
import { stepBook, emptyRecord, emptyState } from "../lib/engines/book.mjs";
import { ENGINES, CLOSE_LABEL, engineSwitches, engineSpecs, ENGINE_TRIALS, contractFor } from "../lib/engines/config.mjs";
import { quoteContract, pickContract, positionUsd } from "../lib/engines/contracts.mjs";
import { stampOpposites } from "../lib/engines/opposite.mjs";
import { buildEnginesView } from "../lib/engines/index.mjs";
import { mergeEngineTrades } from "../lib/webull-mirror.mjs";
import { ownerSettingDef } from "../lib/owner-settings.mjs";

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; }
  catch (err) { failed++; console.log(`FAIL ${name}\n  ${String(err?.stack || err).split("\n").slice(0, 6).join("\n  ")}`); }
}

// Tuesday 2026-12-01, the 15:30 ET run (20:30 UTC) and the next morning's 11:00 run.
const DAY = "2026-12-01", PM_RUN = `${DAY}T20:30:00.000Z`, AM_RUN = `${DAY}T16:00:00.000Z`;
const NEXT = "2026-12-02", NEXT_AM = `${NEXT}T16:00:00.000Z`, NEXT_PM = `${NEXT}T20:30:00.000Z`;
const expSec = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 1000;
const FRI1 = expSec("2026-12-04"), FRI2 = expSec("2026-12-11"), FRI3 = expSec("2026-12-18");

// One expiry's rows around the stock: a straddle at the money costs `pct` of
// the stock (call and put about half each).
function expiryRows(spot, pct, { oi = 500, v = 50, wide = false } = {}) {
  const c = [], p = [];
  for (let K = Math.round(spot * 0.8); K <= Math.round(spot * 1.2); K += Math.max(1, Math.round(spot / 50))) {
    const atm = ((pct / 100) * spot) / 2, dist = Math.abs(K - spot);
    const cm = Math.max(0.35, atm - (K > spot ? dist * 0.45 : -dist * 0.55)), pm = Math.max(0.35, atm - (K < spot ? dist * 0.45 : -dist * 0.55));
    const sp = wide ? 0.4 : 0.04;
    c.push({ s: K, b: +(cm * (1 - sp / 2)).toFixed(2), a: +(cm * (1 + sp / 2)).toFixed(2), iv: 0.5, oi, v });
    p.push({ s: K, b: +(pm * (1 - sp / 2)).toFixed(2), a: +(pm * (1 + sp / 2)).toFixed(2), iv: 0.5, oi, v });
  }
  return { c, p };
}
const chainOf = (spot, pct, o) => ({ spot, chains: { [FRI1]: expiryRows(spot, pct * 0.9, o), [FRI2]: expiryRows(spot, pct, o), [FRI3]: expiryRows(spot, pct * 1.2, o) } });
// A stock's earnings view: past reaction moves (newest first), the next report.
function earnOf(moves, next) {
  const rows = moves.map((m, k) => ({ date: `2026-${String(10 - Math.min(k, 8)).padStart(2, "0")}-15`, movePct: m, sessionsSince: 30 + k * 60 }));
  return { last: rows[0] || null, hist: rows.slice(1), next, reports: rows.length };
}
const pmNext = { date: DAY, session: "PM", sessionsUntil: 0, exitBy: DAY };
const amNext = { date: NEXT, session: "AM", sessionsUntil: 1, exitBy: DAY };
const F = (spot) => ({ date: "2026-11-30", c: spot, o: spot, h: spot * 1.01, l: spot * 0.99, sma5: spot, sma20: spot, sma50: spot * 0.97, sma200: spot * 0.9, atr: spot * 0.02, atrPct: 0.02, rsi2: 50, rsi14: 55, dayAtr: 0.2, move3Atr: 0.3, move5Atr: 0.5, volRatio: 1 });
const view = (sym, spot, moves, next) => ({ sym, isEtf: false, spot, f: F(spot), group: "Tech", earn: earnOf(moves, next) });
const CTX = { date: DAY, regime: { cell: "up-calm" }, macroState: "neutral", env: {} };
const SIZING = { mode: "risk", budget: 2000, conviction: true };
function input(views, chains, { nowIso = PM_RUN, late = true, ...rest } = {}) {
  const ms = Date.parse(nowIso);
  return {
    nowIso, today: nowIso.slice(0, 10), late, views, ctx: { ...CTX, byId: views }, engines: ["earnings"], sizing: SIZING, fillBasis: true,
    quote: (t) => (chains[t.symbol] ? quoteContract(chains[t.symbol], t.contract, { nowMs: ms }) : null),
    pick: (v, side, spec, c) => pickContract(chains[v.sym], side, contractFor(spec, c?.setup), { nowMs: ms }),
    straddle: { chains, rfr: 0.045 }, ...rest,
  };
}
// Past moves near 8% against a 5% straddle: cheap (1.6x).
const BIG = [8, -9, 7.5, -8.5, 9, -7, 8, -8.2];

ok("timing: an after-the-close report buys today and sells the next session; before the open buys the session before", () => {
  assert.equal(sessionAfter("2026-12-04"), "2026-12-07", "Friday to Monday");
  assert.equal(sessionAfter("2026-11-25"), "2026-11-27", "skips Thanksgiving");
  assert.deepEqual(straddleTiming({ next: pmNext }, DAY), { entryDay: DAY, sellOn: NEXT, reportDate: DAY, session: "PM" });
  assert.deepEqual(straddleTiming({ next: amNext }, DAY), { entryDay: DAY, sellOn: NEXT, reportDate: NEXT, session: "AM" });
  assert.match(straddleTiming({ next: { ...pmNext, session: "TBD" } }, DAY).skip, /time not known/);
  assert.match(straddleTiming({ next: { ...pmNext, source: "webull-backup" } }, DAY).skip, /backup/);
  assert.match(straddleTiming({ next: { ...amNext, exitBy: NEXT } }, DAY).skip, /not the last session/);
  assert.match(straddleTiming({}, DAY).skip, /no report date/);
});

ok("expected move: the average size of the last 8 reactions, at least 6 on hand", () => {
  const e = expectedMove(earnOf([...BIG, 50, 50], pmNext));
  assert.equal(e.n, 8); assert.ok(Math.abs(e.pct - BIG.reduce((a, b) => a + Math.abs(b), 0) / 8) < 1e-9, "only the newest 8");
  assert.equal(expectedMove(earnOf([5, 5, 5, 5, 5], pmNext)), null);
});

ok("picker: first expiry whose exit day is after the sale, one strike for both legs, nearest the stock", () => {
  const nowMs = Date.parse(PM_RUN);
  const s = pickStraddle(chainOf(100, 5), { sellOn: NEXT, nowMs });
  assert.ok(!s.skip, s.skip);
  // Dec 4 expiry exits Dec 2 (two sessions before), the sale day: not held through. Dec 11 is taken.
  assert.equal(s.call.expiry, FRI2); assert.equal(s.put.expiry, FRI2);
  assert.equal(s.call.strike, s.put.strike); assert.equal(s.call.strike, 100);
  assert.equal(s.call.optionType, "call"); assert.equal(s.put.optionType, "put");
  assert.ok(Math.abs(s.implied - 5) < 0.6, String(s.implied));
  assert.match(pickStraddle(chainOf(100, 5, { wide: true }), { sellOn: NEXT, nowMs }).skip, /spreads too wide/);
  assert.match(pickStraddle(chainOf(100, 5, { oi: 3, v: 0 }), { sellOn: NEXT, nowMs }).skip, /too thin/);
  assert.match(pickStraddle({ spot: 100, chains: { [FRI1]: expiryRows(100, 5) } }, { sellOn: NEXT, nowMs }).skip, /no expiry that holds past/);
});

ok("book: a cheap straddle opens both legs at the 15:30 run, linked, sized to the budget; a rich one does not", () => {
  const views = { CHEAP: view("CHEAP", 100, BIG, pmNext), RICH: view("RICH", 100, [2, -2, 1.5, -2.5, 2, -1, 2, -2], pmNext), TBD: view("TBD", 100, BIG, { ...pmNext, session: "TBD" }) };
  const chains = { CHEAP: chainOf(100, 5), RICH: chainOf(100, 5), TBD: chainOf(100, 5) };
  const st = emptyState(), rec = emptyRecord();
  const out = stepBook(st, rec, input(views, chains));
  const legs = out.opened.filter(isStraddleLeg);
  assert.equal(legs.length, 2); assert.deepEqual(legs.map((t) => t.side).sort(), ["call", "put"]);
  const [c, p] = [legs.find((t) => t.side === "call"), legs.find((t) => t.side === "put")];
  assert.equal(c.symbol, "CHEAP"); assert.equal(c.engine, "earnings"); assert.equal(c.setup, "straddle"); assert.equal(c.trial, true);
  assert.match(c.tradeId, /^ERN:CHEAP-C-12\/01\/26-15:30-ST$/); assert.match(p.tradeId, /^ERN:CHEAP-P-12\/01\/26-15:30-ST$/);
  assert.equal(c.straddle.id, c.tradeId); assert.equal(p.straddle.id, c.tradeId); assert.equal(c.straddle.pair, p.tradeId); assert.equal(p.straddle.pair, c.tradeId);
  assert.equal(c.sellOn, NEXT); assert.deepEqual(c.exits, {}); assert.equal(c.stopLevel, null);
  assert.equal(c.contract.qty, p.contract.qty); assert.equal(c.contract.strike, p.contract.strike); assert.equal(c.contract.expiry, p.contract.expiry);
  const pair1 = (c.contract.entryFill + p.contract.entryFill) * 100;
  assert.equal(c.contract.qty, Math.max(1, Math.floor(2000 / pair1)), "about the $2,000 budget for the pair");
  assert.ok(c.fill?.entry === c.contract.ask && c.optionPnlPct < 0, "booked at the ask, marked at the bid");
  assert.ok(c.straddle.ratio >= STRADDLE.cheapX); assert.equal(c.straddle.reportDate, DAY); assert.equal(c.straddle.session, "PM");
  assert.equal(rec.open.length, 2);
  const rows = out.candidates.earnings.filter((r) => r.setup === "straddle");
  assert.match(rows.find((r) => r.symbol === "RICH").why, /options not cheap/);
  assert.ok(!rows.some((r) => r.symbol === "TBD"), "an unknown report time is not looked at");
  assert.equal(rows.find((r) => r.symbol === "CHEAP").taken, true);
  // The 11:00 run the same day does not open (afternoon only), and a second
  // afternoon run does not open the same report again.
  const am = stepBook(emptyState(), emptyRecord(), input(views, chains, { nowIso: AM_RUN, late: false }));
  assert.equal(am.opened.filter(isStraddleLeg).length, 0);
  const again = stepBook(st, rec, input(views, chains, { nowIso: `${DAY}T20:40:00.000Z` }));
  assert.equal(again.opened.filter(isStraddleLeg).length, 0); assert.equal(rec.open.length, 2);
});

ok("book: both legs are sold at the first run on the reaction day, whatever they show", () => {
  const views = { CHEAP: view("CHEAP", 100, BIG, pmNext) }, chains = { CHEAP: chainOf(100, 5) };
  const st = emptyState(), rec = emptyRecord();
  stepBook(st, rec, input(views, chains));
  // The stock jumps 9% on the report.
  const after = { CHEAP: { ...chainOf(109, 3) } };
  const v2 = { CHEAP: { ...view("CHEAP", 109, BIG, null) } };
  const out = stepBook(st, rec, input(v2, after, { nowIso: NEXT_AM, late: false }));
  const closed = out.closed.filter(isStraddleLeg);
  assert.equal(closed.length, 2); assert.ok(closed.every((t) => t.status === "after-report"));
  assert.equal(CLOSE_LABEL["after-report"], "sold the morning after the report");
  assert.equal(rec.open.filter(isStraddleLeg).length, 0);
  const call = closed.find((t) => t.side === "call"), put = closed.find((t) => t.side === "put");
  assert.ok(call.optionPnlPct > 0 && put.optionPnlPct < 0);
  const pr = straddleRows(rec);
  assert.equal(pr.closed, 1); assert.equal(pr.open, 0); assert.equal(pr.rows[0].legs, 2);
  const usd = closed.reduce((a, t) => a + (t.optionPnlPct / 100) * t.fill.entry * 100 * t.contract.qty, 0);
  assert.equal(pr.rows[0].usd, Math.round(usd)); assert.ok(pr.rows[0].usd > 0, "a 9% move pays a 5% straddle");
  assert.equal(pr.rows[0].moveAtExitPct, 9);
  // With no quote on the sale day a leg waits one session, then closes.
  const st2 = emptyState(), rec2 = emptyRecord();
  stepBook(st2, rec2, input(views, chains));
  assert.equal(stepBook(st2, rec2, input(v2, {}, { nowIso: NEXT_AM, late: false })).closed.length, 0);
  const late = stepBook(st2, rec2, input(v2, {}, { nowIso: "2026-12-03T16:00:00.000Z", late: false }));
  assert.equal(late.closed.filter((t) => t.status === "after-report").length, 2);
});

ok("book: at most 2 straddles a day, 4 open, cheapest first; the pair never splits", () => {
  const syms = ["AA", "BB", "CC"], views = {}, chains = {};
  syms.forEach((s, k) => { views[s] = view(s, 100, BIG.map((m) => m * (1 + k * 0.1)), pmNext); chains[s] = chainOf(100, 5); });
  const st = emptyState(), rec = emptyRecord();
  const out = stepBook(st, rec, input(views, chains));
  const opened = [...new Set(out.opened.filter(isStraddleLeg).map((t) => t.symbol))];
  assert.deepEqual(opened.sort(), ["BB", "CC"], "the two cheapest");
  assert.match(out.candidates.earnings.find((r) => r.symbol === "AA" && r.setup === "straddle").why, /day limit/);
  // Four open already: no free slot.
  const full = emptyRecord();
  for (const s of ["W1", "W2", "W3", "W4"]) for (const side of ["call", "put"]) full.open.push({ engine: "earnings", setup: "straddle", symbol: s, side, entryDate: "2026-11-20T20:30:00.000Z", trial: true, straddle: { id: `ERN:${s}`, leg: side }, contract: { structure: "long", optionType: side, strike: 1, expiry: FRI3, mid: 1, qty: 1 } });
  const o2 = stepBook(emptyState(), full, input({ AA: views.AA }, { AA: chains.AA }));
  assert.equal(o2.opened.filter(isStraddleLeg).length, 0); assert.match(o2.candidates.earnings.find((r) => r.setup === "straddle").why, /no free slot/);
});

ok("book: the Owner's stop, avoid list, engine off, paused engines and account limits hold it back", () => {
  const views = { CHEAP: view("CHEAP", 100, BIG, pmNext) }, chains = { CHEAP: chainOf(100, 5) };
  const why = (extra) => { const o = stepBook(emptyState(), emptyRecord(), input(views, chains, extra)); return { n: o.opened.length, why: o.candidates.earnings.find((r) => r.setup === "straddle")?.why }; };
  assert.deepEqual(why({ controls: { stop: true } }), { n: 0, why: "new trades stopped by the owner" });
  assert.deepEqual(why({ controls: { avoid: new Set(["CHEAP"]) } }), { n: 0, why: "on the owner's avoid list" });
  assert.deepEqual(why({ off: new Set(["earnings"]) }), { n: 0, why: "engine switched off" });
  assert.deepEqual(why({ mode: "pause" }), { n: 0, why: "engines paused by the owner" });
  const lim = why({ controls: { limits: { any: true, openUsd: 500 } } });
  assert.equal(lim.n, 0); assert.match(lim.why, /^account limit/);
  // A contract another trade holds at Webull: the straddle is not split.
  const o = stepBook(emptyState(), emptyRecord(), input(views, chains, { flagshipOpen: [{ tradeId: "TP1", symbol: "CHEAP", side: "call", contract: { structure: "long", optionType: "call", strike: 100, expiry: FRI2 } }] }));
  const legs = o.opened.filter(isStraddleLeg);
  assert.equal(legs.length, 2); assert.notEqual(legs[0].contract.strike, 100, "moves to the next strike rather than share a leg");
  // The risk dial scales both legs alike.
  const half = stepBook(emptyState(), emptyRecord(), input(views, chains, { controls: { dial: { level: "safer", label: "Safer", sizeMult: 0.5 } }, sizing: { ...SIZING, budget: 8000 } })).opened.filter(isStraddleLeg);
  assert.equal(half[0].contract.qty, half[1].contract.qty); assert.ok(half[0].contract.qty < half[0].contract.flatQty);
});

ok("switch: on by default, off retires it (open legs are still sold), Owner Settings and the rules step", () => {
  assert.equal(engineSwitches({}).trials.straddle, true);
  assert.equal(engineSwitches({ ENGINES_TRIAL_STRADDLE: "0" }).trials.straddle, false);
  assert.equal(engineSwitches({ ENGINES_SHARES: "0" }).trials.straddle, true, "options: runs with share trades off");
  const d = ownerSettingDef("ENGINES_TRIAL_STRADDLE");
  assert.ok(d && d.kind === "switch" && d.default === true && d.group === "Strategy engines" && d.scope === "build");
  assert.ok(ENGINE_TRIALS.some((t) => t.id === "straddle" && t.engine === "earnings" && t.env === "ENGINES_TRIAL_STRADDLE"));
  assert.equal(ENGINES.earnings.setups.straddle.trial, true);
  assert.match(ENGINES.earnings.rules.note, /^New rules: a paper trial is added, labeled unproven: the earnings straddle/);
  assert.equal(ENGINES.earnings.rules.date, "2026-11-27"); assert.match(ENGINES.earnings.rules.key, /\|trials4:straddle$/);
  const off = engineSpecs(undefined, { straddle: false });
  assert.equal(off.earnings.setups.straddle.retired, true); assert.notEqual(off.earnings.rules.key, ENGINES.earnings.rules.key);
  const views = { CHEAP: view("CHEAP", 100, BIG, pmNext) }, chains = { CHEAP: chainOf(100, 5) };
  const st = emptyState(), rec = emptyRecord();
  stepBook(st, rec, input(views, chains));
  assert.equal(stepBook(emptyState(), emptyRecord(), input(views, chains, { specs: off })).opened.length, 0);
  // Switched off after opening: the open legs are still sold on schedule.
  const o = stepBook(st, rec, input({ CHEAP: view("CHEAP", 103, BIG, null) }, { CHEAP: chainOf(103, 4) }, { nowIso: NEXT_AM, late: false, specs: off, straddle: null }));
  assert.equal(o.closed.filter((t) => t.status === "after-report").length, 2);
  // The live input only: no straddle without input.straddle (history test, variants).
  assert.equal(stepBook(emptyState(), emptyRecord(), input(views, chains, { straddle: null })).opened.length, 0);
});

ok("opposite tags: the two legs of one straddle are not tagged against each other, another engine's put still is", () => {
  const views = { CHEAP: view("CHEAP", 100, BIG, pmNext) }, chains = { CHEAP: chainOf(100, 5) };
  const rec = emptyRecord();
  stepBook(emptyState(), rec, input(views, chains));
  assert.equal(stampOpposites(rec, { nowIso: PM_RUN }), 0);
  rec.open.push({ engine: "downside", symbol: "CHEAP", side: "put", tradeId: "DWN:CHEAP-P", entryDate: "2026-11-30T16:00:00.000Z", opposes: [] });
  const n = stampOpposites(rec, { nowIso: PM_RUN });
  assert.equal(n, 1, "the call leg against the other engine's put");
});

ok("page and Webull: the view's straddle rows, and both legs enter the mirror as option buys", () => {
  const views = { CHEAP: view("CHEAP", 100, BIG, pmNext) }, chains = { CHEAP: chainOf(100, 5) };
  const st = emptyState(), rec = emptyRecord();
  const out = stepBook(st, rec, input(views, chains));
  const v = buildEnginesView({ record: rec, state: st, ctx: CTX, builtAtIso: PM_RUN, out, today: DAY, trials: { straddle: true } });
  assert.equal(v.straddles.open, 1); assert.equal(v.straddles.rows[0].symbol, "CHEAP"); assert.equal(v.straddles.on, true); assert.equal(v.straddles.cheapX, STRADDLE.cheapX);
  assert.ok(v.straddles.rows[0].costUsd > 0 && v.straddles.rows[0].costUsd <= 4000);
  assert.ok(v.trialSwitches.some((t) => t.id === "straddle" && t.on));
  const acc = mergeEngineTrades({ open: [], closed: [] }, rec, {}, { mirrorNew: true });
  assert.equal(acc.open.filter((e) => e.setup === "straddle").length, 2);
  assert.ok(acc.open.every((e) => (e.contract.structure || "long") === "long" && !e.noMirror));
  assert.equal(positionUsd(rec.open[0].contract) > 0, true);
});

console.log(`${passed} straddle checks passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
