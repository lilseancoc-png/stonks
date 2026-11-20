#!/usr/bin/env node
// Offline checks for scripts/top-picks-real-prices.mjs on a small made-up
// quote folder. Run: node scripts/top-picks-real-prices-smoke.mjs
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRows, historyReader, occSymbol } from "../lib/option-history/index.mjs";
import { etDate, recordTrades, pullPlan, repricePick, runTopPicksRealPrices } from "./top-picks-real-prices.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok -", name); };

const EXP = "2026-12-18", EXP_SEC = Date.parse(`${EXP}T21:00:00Z`) / 1000;
const q = (u, date, right, strike, bid, ask) => ({ underlying: u, date, symbol: occSymbol(u, EXP, right, strike), expiry: EXP, right, strike, bid, ask, source: "test" });
const dir = mkdtempSync(join(tmpdir(), "tp-real-"));
writeRows(dir, [
  // AAA call: real mids rise to +30% on 11-04 (take-profit at +25%), and are back to flat by the exit date.
  q("AAA", "2026-11-02", "C", 100, 4.9, 5.1), q("AAA", "2026-11-03", "C", 100, 5.4, 5.6), q("AAA", "2026-11-04", "C", 100, 6.4, 6.6),
  q("AAA", "2026-11-05", "C", 100, 5.6, 5.8), q("AAA", "2026-11-06", "C", 100, 4.9, 5.1),
  // BBB put: only falls; the stop at -50% fires on 11-05.
  q("BBB", "2026-11-02", "P", 50, 1.9, 2.1), q("BBB", "2026-11-03", "P", 50, 1.5, 1.7), q("BBB", "2026-11-05", "P", 50, 0.9, 1.1), q("BBB", "2026-11-06", "P", 50, 0.7, 0.9),
]);
const reader = historyReader(dir);
const pol = { takeProfitPct: 25, stopPct: 50 };
const AAA = { symbol: "AAA", side: "call", entryDate: "2026-11-02T16:00:00.000Z", exitDate: "2026-11-06T20:30:00.000Z", outcome: "win", optionPnlPct: 12, realFillPnlPct: 4, exitPolicy: pol, contract: { structure: "long", strike: 100, expiry: EXP_SEC, mid: 5, bid: 4.9, ask: 5.1 } };
const BBB = { symbol: "BBB", side: "put", entryDate: "2026-11-02T20:30:00.000Z", exitDate: "2026-11-06T16:00:00.000Z", outcome: "loss", optionPnlPct: -30, exitPolicy: pol, contract: { structure: "long", strike: 50, expiry: EXP_SEC, mid: 2 } };
const acc = { builtAtIso: "2026-11-20T16:00:00.000Z", closed: [
  AAA, BBB,
  { ...AAA, symbol: "SPY", pairKey: "AAA:call:x" },                          // baseline pair: not counted
  { ...AAA, outcome: "flat", optionPnlPct: 0 },                               // flat: not counted
  { ...AAA, symbol: "CCC", contract: { ...AAA.contract, structure: "credit_vertical" } }, // spread: skipped
  { ...AAA, symbol: "DDD" },                                                  // no quotes: skipped
] };

ok("run times become New York trade dates", () => {
  assert.equal(etDate("2026-11-02T20:30:00.000Z"), "2026-11-02");
  assert.equal(etDate("2026-11-03T02:00:00.000Z"), "2026-11-02", "late evening UTC is the same NY day");
  assert.equal(etDate("nope"), null);
});

ok("only counted record trades; the pull plan names their symbols and dates", () => {
  const t = recordTrades(acc);
  assert.deepEqual(t.map((x) => x.symbol), ["AAA", "BBB", "CCC", "DDD"]);
  assert.deepEqual(pullPlan(t), { symbols: ["AAA", "BBB", "CCC", "DDD"], from: "2026-11-02", to: "2026-11-06" });
});

ok("a call: the record's ask in, the real bid out, and the take-profit on real prices", () => {
  const r = repricePick(AAA, reader);
  assert.equal(r.ok, true); assert.equal(r.basis, "record ask");
  assert.equal(Math.round(r.samePct * 10) / 10, Math.round((4.9 / 5.1 - 1) * 1000) / 10);
  assert.equal(r.pathReason, "take-profit"); assert.equal(Math.round(r.pathPct * 10) / 10, Math.round((6.4 / 5.1 - 1) * 1000) / 10);
});

ok("a put with no record ask: the real ask that day, and the stop on real prices", () => {
  const r = repricePick(BBB, reader);
  assert.equal(r.ok, true); assert.equal(r.basis, "real ask (end of day)");
  assert.equal(r.pathReason, "stop"); assert.ok(r.pathPct < -50);
  assert.equal(Math.round(r.samePct), Math.round((0.7 / 2.1 - 1) * 100));
});

ok("aggregates only, with skips named", () => {
  const res = runTopPicksRealPrices(acc, reader);
  assert.equal(res.trades, 4); assert.equal(res.priced, 2);
  assert.deepEqual(res.skips, { "spread (not re-priced)": 1, "no quotes for the contract": 1 });
  assert.equal(res.all.n, 2); assert.equal(res.calls.n, 1); assert.equal(res.puts.n, 1);
  assert.equal(res.all.modeled.avg, -9); assert.equal(res.all.recordRealFill.n, 1);
  assert.deepEqual(res.all.pathExits, { "take-profit": 1, stop: 1 });
  const text = JSON.stringify(res);
  assert.doesNotMatch(text, /AAA|BBB|"bid"|"ask"/, "no trade row or quote leaves the script");
});

console.log(`top-picks real prices smoke: ${passed} passed`);
