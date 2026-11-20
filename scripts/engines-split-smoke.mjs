// Strategy engines: the stock split guard (lib/engines/split.mjs, 2026-11-20).
// Also: lib/webull-mirror.mjs splitSinceLedger (a mirrored trade after a split).
// Run: node scripts/engines-split-smoke.mjs
import assert from "node:assert/strict";
import { engineSplitFactor, applyEngineSplit, calendarFactor, splitHoldRuns } from "../lib/engines/split.mjs";
import { stepBook, emptyRecord, emptyState } from "../lib/engines/book.mjs";
import { quoteContract, positionUsd } from "../lib/engines/contracts.mjs";
import { splitSinceLedger, newTrade } from "../lib/webull-mirror.mjs";

let n = 0, failed = 0;
function ok(name, fn) {
  try { fn(); n++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.log(`FAIL ${name}`); console.log(err?.stack || err); }
}
const bars = (rows) => rows.map(([t, c]) => ({ t, c }));
const NOW = "2026-11-20T16:00:00.000Z";

// Sandisk, 8-for-1 at the open on 2026-11-20. The Momentum basket's lot was
// last marked at $771.30 on 2026-11-18.
const ADJ = bars([["2026-11-17", 97.2], ["2026-11-18", 96.4], ["2026-11-19", 94.4], ["2026-11-20", 95.1]]); // Yahoo after the split
const OLD = bars([["2026-11-17", 777.6], ["2026-11-18", 771.2], ["2026-11-19", 755.2], ["2026-11-20", 760.0]]); // before Yahoo adjusts

ok("8-for-1 confirmed by split-adjusted history, even after a 3% move", () => {
  assert.equal(engineSplitFactor({ lastSpot: 771.3, lastDate: "2026-11-18", spot: 91.6, bars: ADJ }), 8);
  assert.equal(engineSplitFactor({ lastSpot: 771.3, lastDate: "2026-11-18", spot: 99.5, bars: ADJ }), 8);
});
ok("an ordinary move is not a split", () => {
  assert.equal(engineSplitFactor({ lastSpot: 771.3, lastDate: "2026-11-18", spot: 730, bars: OLD }), null);
  assert.equal(engineSplitFactor({ lastSpot: 100, lastDate: "2026-11-18", spot: 82, bars: [] }), null);
});
ok("a real 50% crash on old-scale history is not a 2-for-1", () => {
  const crash = bars([["2026-11-18", 100.4], ["2026-11-19", 50.3]]);
  assert.equal(engineSplitFactor({ lastSpot: 100, lastDate: "2026-11-18", spot: 50.2, bars: crash }), null);
});
ok("a 2-for-1 with adjusted history is a split", () => {
  const adj = bars([["2026-11-18", 50.1], ["2026-11-19", 50.6]]);
  assert.equal(engineSplitFactor({ lastSpot: 100, lastDate: "2026-11-18", spot: 51, bars: adj }), 2);
});
ok("an exact 8x gap counts before Yahoo adjusts its history; a loose one waits", () => {
  assert.equal(engineSplitFactor({ lastSpot: 771.3, lastDate: "2026-11-18", spot: 96.0, bars: OLD }), 8);
  assert.equal(engineSplitFactor({ lastSpot: 771.3, lastDate: "2026-11-18", spot: 88.0, bars: OLD }), null);
});
ok("a 1-for-10 reverse split", () => {
  const adj = bars([["2026-11-18", 41], ["2026-11-19", 40]]);
  assert.equal(engineSplitFactor({ lastSpot: 4.1, lastDate: "2026-11-18", spot: 40.5, bars: adj }), 0.1);
});
ok("no dated history: an exact gap counts (as in Top Picks)", () => {
  assert.equal(engineSplitFactor({ lastSpot: 100, lastDate: "2026-11-18", spot: 50.5, bars: [] }), 2);
  assert.equal(engineSplitFactor({ lastSpot: 100, lastDate: "2026-11-18", spot: 50.5, bars: null }), 2);
});
ok("a move on the day of the last mark is never a split (the live bar shows the move)", () => {
  // Entered at 11:00 at $100, $50 at 15:30: Yahoo's live bar for today reads $50.
  const live = bars([["2026-11-19", 101], ["2026-11-20", 50.2]]);
  assert.equal(engineSplitFactor({ lastSpot: 100, lastDate: "2026-11-20", spot: 50, bars: live, today: "2026-11-20" }), null);
  assert.equal(engineSplitFactor({ lastSpot: 100, lastDate: "2026-11-20", spot: 12.5, bars: [], today: "2026-11-20" }), null);
  assert.equal(splitHoldRuns(100, 50, { lastDate: "2026-11-20", today: "2026-11-20" }), 0);
});
ok("Yahoo's split list confirms the ratio, even off the exact gap", () => {
  const cal = [{ date: "2026-11-20", numerator: 8, denominator: 1, splitRatio: "8:1" }];
  assert.equal(calendarFactor(cal, "2026-11-18", "2026-11-20"), 8);
  assert.equal(calendarFactor([{ date: "2026-11-20", splitRatio: "1:10" }], "2026-11-18", "2026-11-20"), 0.1);
  assert.equal(calendarFactor(cal, "2026-11-20", "2026-11-21"), null);
  const old = Object.assign(OLD.slice(), { splitEvents: cal });
  assert.equal(engineSplitFactor({ lastSpot: 771.3, lastDate: "2026-11-18", spot: 88, bars: old, today: "2026-11-20" }), 8);
  // Already rescaled (the gap is gone): never applied twice.
  assert.equal(engineSplitFactor({ lastSpot: 96.4, lastDate: "2026-11-18", spot: 95, bars: old, today: "2026-11-20" }), null);
  // A listed split with a tape that does not match it is not applied.
  assert.equal(engineSplitFactor({ lastSpot: 771.3, lastDate: "2026-11-18", spot: 400, bars: old, today: "2026-11-20" }), null);
});
ok("only a gap of about a split ratio is held, and a small ratio for one run", () => {
  assert.equal(splitHoldRuns(771.3, 88), 4);
  assert.equal(splitHoldRuns(100, 55), 1);
  assert.equal(splitHoldRuns(100, 70), 0);
  assert.equal(splitHoldRuns(100, 30), 0);
});
ok("bad inputs never throw", () => {
  assert.equal(engineSplitFactor({}), null);
  assert.equal(engineSplitFactor({ lastSpot: 0, spot: 10 }), null);
  assert.equal(engineSplitFactor({ lastSpot: 100, spot: 12.5, bars: [{ t: null, c: "x" }] }), 8);
});

const shareTrade = () => ({
  tradeId: "MOM:SNDK-S-11/17/26-11:06", engine: "momentum", tag: "MOM", symbol: "SNDK", side: "call", setup: "top-10",
  entryDate: "2026-11-17T16:06:00.000Z", entrySpot: 777.31, lastSpot: 771.3, lastMid: 771.3, lastMarkDate: "2026-11-18",
  contract: { structure: "shares", optionType: "call", shares: 3, mid: 777.31, usd: 2332, costPct: 0.2 },
  exits: {}, stopLevel: null, targetLevel: null, optionPnlPct: -0.9, hiPct: 0.4, loPct: -2.1, sessions: 2,
});
const optionTrade = () => ({
  tradeId: "FUN:SNDK-C-11/17/26-11:06", engine: "fundamentals", tag: "FUN", symbol: "SNDK", side: "call", setup: "rank-top",
  entryDate: "2026-11-17T16:06:00.000Z", entrySpot: 777.31, lastSpot: 771.3, lastMid: 61.2, lastMarkDate: "2026-11-18",
  contract: { structure: "long", optionType: "call", strike: 800, expiry: "2027-03-19", mid: 62.4, bid: 61.9, ask: 62.9, entryFill: 62.9, iv: 0.62, qty: 2, flatQty: 2 },
  fill: { basis: "ask-bid", entry: 62.9, entryMid: 62.4 },
  exits: { tp: 50, stop: -50 }, stopLevel: 700, targetLevel: 900, optionPnlPct: -3, hiPct: 1, loPct: -4, sessions: 2,
});

ok("rescale keeps a share lot's dollars and multiplies the count", () => {
  const t = applyEngineSplit(shareTrade(), 8, "2026-11-20T16:00:00.000Z");
  assert.equal(t.contract.shares, 24); assert.ok(Math.abs(t.contract.mid - 97.16375) < 0.0002); assert.equal(t.entrySpot, 97.16);
  assert.ok(Math.abs(positionUsd(t.contract) - 3 * 777.31) < 0.01);
  assert.deepEqual(t.corpActions, [{ type: "split", factor: 8, date: "2026-11-20T16:00:00.000Z" }]);
});
ok("rescale moves an option's strike, prices, levels and count like the OCC", () => {
  const t = applyEngineSplit(optionTrade(), 8, "2026-11-20T16:00:00.000Z");
  assert.equal(t.contract.strike, 100); assert.equal(t.contract.qty, 16); assert.equal(t.contract.flatQty, 16);
  const odd775 = optionTrade(); odd775.contract.strike = 775;
  assert.equal(applyEngineSplit(odd775, 8, NOW).contract.strike, 96.875);
  const quoted = quoteContract({ spot: 95, chains: { "2027-03-19": { c: [{ s: 96.875, b: 7, a: 7.4, iv: 0.6 }], p: [] } } }, { structure: "long", optionType: "call", strike: 96.875, expiry: "2027-03-19", iv: 0.6 }, { nowMs: Date.parse(NOW) });
  assert.equal(quoted.source, "chain");
  const vert = optionTrade(); vert.contract.structure = "debit_vertical"; vert.contract.legs = [{ type: "call", strike: 800, qty: 1, mid: 62 }, { type: "call", strike: 900, qty: -1, mid: 30 }];
  const v = applyEngineSplit(vert, 8, NOW);
  assert.deepEqual(v.contract.legs.map((l) => [l.strike, l.qty, l.mid]), [[100, 1, 7.75], [112.5, -1, 3.75]]);
  assert.equal(t.contract.mid, 7.8); assert.equal(t.fill.entry, 7.8625); assert.equal(t.stopLevel, 87.5); assert.equal(t.targetLevel, 112.5);
  assert.ok(Math.abs(positionUsd(t.contract) - 62.9 * 100 * 2) < 1);
  assert.equal(t.splitReview, undefined);
  const odd = applyEngineSplit(optionTrade(), 1.5, "2026-11-20T16:00:00.000Z");
  assert.equal(odd.contract.qty, 3); assert.match(odd.splitReview, /Non-standard split/);
});

// The book step: the 11:00 ET run after the split. The chain carries the
// post-split spot and the adjusted strikes.
const chain = { spot: 95.2, chains: { "2027-03-19": { c: [{ s: 100, b: 7.5, a: 7.9, iv: 0.6, oi: 900, v: 100 }], p: [] } } };
const input = (o = {}) => ({
  nowIso: NOW, today: "2026-11-20", late: false, views: {}, ctx: {}, learn: false,
  engines: ["momentum", "fundamentals"], specs: undefined,
  quote: (t) => quoteContract(chain, t.contract, { nowMs: Date.parse(NOW) }),
  pick: () => ({ skip: "test" }), coverage: null, ...o,
});
function runStep(o) {
  const state = emptyState(), record = emptyRecord();
  record.open = [shareTrade(), optionTrade()];
  const out = stepBook(state, record, input(o));
  return { out, record };
}
ok("stepBook with the guard: no phantom loss, no stop, the split is reported", () => {
  const { out, record } = runStep({ splitBars: () => ADJ });
  assert.equal(out.closed.length, 0, `closed: ${out.closed.map((t) => `${t.tradeId} ${t.status}`).join(", ")}`);
  const s = record.open.find((t) => t.contract.structure === "shares"), o = record.open.find((t) => t.contract.structure === "long");
  assert.equal(s.contract.shares, 24); assert.ok(s.optionPnlPct > -5 && s.optionPnlPct < 0, `shares P&L ${s.optionPnlPct}`);
  assert.equal(o.contract.strike, 100); assert.ok(o.optionPnlPct > -10, `option P&L ${o.optionPnlPct}`);
  assert.equal(out.splits.length, 2); assert.ok(out.splits.every((x) => x.factor === 8 && x.symbol === "SNDK"));
  // The next run sees no new gap: nothing is rescaled twice.
  const out2 = stepBook(emptyState(), record, input({ splitBars: () => ADJ, nowIso: "2026-11-20T20:30:00.000Z", late: true }));
  assert.equal(out2.splits.length, 0); assert.equal(s.contract.shares, 24);
});
ok("stepBook holds an unconfirmed gap of about a split ratio, then marks and flags it", () => {
  const state = emptyState(), record = emptyRecord();
  const loose = { ...chain, spot: 88.0 };
  const inp = (iso) => ({ ...input({ splitBars: () => OLD, nowIso: iso }), quote: (t) => quoteContract(loose, t.contract, { nowMs: Date.parse(iso) }) });
  record.open = [shareTrade()];
  const a = stepBook(state, record, inp(NOW));
  assert.equal(a.closed.length, 0); assert.equal(record.open[0].lastSpot, 771.3); assert.equal(record.open[0].splitHold, 1);
  assert.equal(a.splits[0].held, 1); assert.equal(a.splits[0].factor, null);
  // Yahoo adjusts by the afternoon run: the split is applied from the old mark.
  const b = stepBook(state, record, { ...inp("2026-11-20T20:30:00.000Z"), splitBars: () => ADJ, late: true });
  assert.equal(b.splits[0].factor, 8); assert.equal(record.open[0].contract.shares, 24); assert.equal(record.open[0].splitHold, undefined);
  // Still unconfirmed after four holds (two sessions): the fifth run marks it
  // as a real move and flags it.
  record.open = [shareTrade()];
  const runs = ["2026-11-20T16:00:00.000Z", "2026-11-20T20:30:00.000Z", "2026-11-23T16:00:00.000Z", "2026-11-23T20:30:00.000Z"];
  for (const iso of runs) { const o = stepBook(state, record, { ...inp(iso), today: iso.slice(0, 10) }); assert.equal(o.splits[0].factor, null); assert.equal(record.open[0].lastSpot, 771.3); }
  const c = stepBook(state, record, { ...inp("2026-11-24T16:00:00.000Z"), today: "2026-11-24" });
  assert.equal(c.splits[0].marked, true); assert.equal(record.open[0].lastSpot, 88); assert.ok(record.open[0].optionPnlPct < -80);
  assert.equal(record.open[0].splitUnconfirmed.to, 88);
});
ok("stepBook: a same-day crash after an 11:00 entry is booked, not rescaled", () => {
  const state = emptyState(), record = emptyRecord();
  const t = shareTrade(); t.entrySpot = 100; t.lastSpot = 100; t.lastMarkDate = "2026-11-20"; t.contract.mid = 100; t.contract.shares = 20; t.optionPnlPct = 0;
  record.open = [t];
  const crash = { spot: 50, chains: {} };
  const out = stepBook(state, record, { ...input({ splitBars: () => bars([["2026-11-19", 101], ["2026-11-20", 50.2]]), nowIso: "2026-11-20T20:30:00.000Z", late: true }), quote: (x) => quoteContract(crash, x.contract, { nowMs: Date.parse(NOW) }) });
  assert.equal(out.splits.length, 0);
  const s = [...record.open, ...out.closed][0];
  assert.equal(s.contract.shares, 20); assert.ok(s.optionPnlPct < -45, `P&L ${s.optionPnlPct}`);
});
ok("stepBook without the guard (history test, switch off) marks the old way", () => {
  const { out, record } = runStep({});
  assert.equal(out.splits.length, 0);
  const all = [...record.open, ...out.closed];
  const s = all.find((t) => t.contract.structure === "shares");
  assert.ok(s.optionPnlPct < -80, `shares P&L ${s.optionPnlPct}`);
});

ok("Webull mirror: a ledger trade in pre-split units is flagged, a new one is not", () => {
  // The engines key expiries by epoch seconds, as the chains do.
  const e = optionTrade(); e.contract.expiry = Date.UTC(2027, 2, 19) / 1000; const ledger = newTrade(e, e.tradeId);
  assert.equal(ledger.legs[0].strike, 800);
  assert.equal(splitSinceLedger(ledger, e), null);
  applyEngineSplit(e, 8, NOW);
  assert.equal(splitSinceLedger(ledger, e), NOW);
  assert.equal(splitSinceLedger(newTrade(e, e.tradeId), e), null);
  const s = shareTrade(); const sl = newTrade(s, s.tradeId); sl.fillIso = "2026-11-17T16:10:00.000Z";
  applyEngineSplit(s, 8, NOW);
  assert.equal(splitSinceLedger(sl, s), NOW);
  sl.fillIso = "2026-11-20T16:30:00.000Z"; assert.equal(splitSinceLedger(sl, s), null);
});

console.log(failed ? `${failed} FAILED, ${n} passed` : `engines split smoke: ${n} checks passed`);
process.exit(failed ? 1 : 0);
