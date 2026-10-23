// Execute the shipped Webull renderer against a synthetic ledger. No broker/data.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = app.indexOf("  var wbTest = "), end = app.indexOf('  // --- Per-pick "Strategy & entry details"', start);
assert.ok(start > 0 && end > start);
const box = { innerHTML: "" }, summaries = [];
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fixture = { enabled: true, lastRunIso: new Date().toISOString(), reconciliation: { status: "attention", checkedAtIso: new Date().toISOString(), alerts: ['NVDA: review <unsafe> holdings'] }, trades: [
  { tradeId: "closed", symbol: "NVDA", side: "call", structure: "long", state: "closed", requestedQty: 3, filledQty: 3, closedQty: 3, openQty: 0, fillPrice: 5, closeFillPrice: 6.25, paperPnlPct: 25, fees: 3, closeFillIso: "2026-10-22T19:30:00Z", engineEntryPrice: 5, engineExitPrice: 6.25, enginePnlPct: 25, engineCloseReason: "hit-tp-prem" },
  { tradeId: "queued", symbol: "NVDA", side: "call", structure: "long", state: "entering", entryTries: 0, requestedQty: 1, filledQty: 0, closedQty: 0, openQty: 0 },
  { tradeId: "partial", symbol: "AAPL", side: "put", structure: "debit_vertical", state: "exiting", requestedQty: 3, filledQty: 2, closedQty: 1, openQty: 1 },
  { tradeId: "expiry", symbol: "AAPL", side: "put", structure: "long", state: "settled", requestedQty: 1, filledQty: 1, closedQty: 0, openQty: 0, paperPnlPct: null },
] };
const context = vm.createContext({ console, Date, isFinite, $, escapeHtml,
  accuracyState: { data: {} }, accFills: { rows: [] }, accView: { wbSide: "all", wbStruct: "all", wbRun: "all", wbState: "all", wbRange: "all", wbLens: "trades", wbGroup: "structure" },
  accFillKey: (s) => s, tlTradeId: (e) => e.tradeId, tlEtParts: () => ({ hour: "11" }),
  accSeg: () => "", accPaneSummary: (...args) => summaries.push(args),
  accDateTime: (v) => v || "—", accPct: (v) => v == null ? "—" : `${v.toFixed(1)}%`,
  accMoney: (v) => `$${v.toFixed(2)}`, accDate: (v) => v || "—", accUsd: (v) => v == null ? null : `$${v}`,
  ACC_STATUS_LABEL: { "hit-tp-prem": "take profit" }, chHoverAttr: () => "",
});
function $(id) { return id === "an-webull" ? box : null; }
vm.runInContext(app.slice(start, end), context);
context.wbTest = { loaded: true, data: fixture };
vm.runInContext("renderWebullTest()", context);
assert.match(box.innerHTML, /3\/3 filled · 3 closed · 0 open/);
assert.match(box.innerHTML, /2\/3 filled · 1 closed · 1 open/);
assert.match(box.innerHTML, /queued<\/td>|queued<br>/);
assert.match(box.innerHTML, /flat; settlement P&amp;L unverified/);
assert.match(box.innerHTML, /review &lt;unsafe&gt; holdings/);
assert.doesNotMatch(box.innerHTML, /review <unsafe>/);
context.accView.wbLens = "performance";
vm.runInContext("renderWebullTest()", context);
assert.match(box.innerHTML, /\$372\.00/, "paper dollars use 3 contracts less $3 fees");
assert.match(box.innerHTML, /\$375\.00/, "engine comparison uses the same 3 contracts");
assert.equal(vm.runInContext("wbFeePct(wbTest.data.trades[0])", context), 0.2);
context.accView.wbState = "open";
assert.equal(vm.runInContext("wbRows().length", context), 2, "open filter includes queued/partial and excludes settled");
fixture.trades.push({ tradeId: "pending", state: "settlement-pending", side: "call", structure: "long", openQty: 1 });
assert.equal(vm.runInContext("wbRows().length", context), 3, "unresolved expiry stays visible under Open");
// A quiet interval between builds is expected; freshness follows the engine
// snapshot actually read, rather than time since the last broker request.
fixture.lastRunIso = "2026-10-22T15:10:00Z";
fixture.engineSnapshotIso = "2026-10-22T15:00:00Z";
context.accuracyState.data.builtAtIso = fixture.engineSnapshotIso;
vm.runInContext("renderWebullTest()", context);
assert.doesNotMatch(box.innerHTML, /latest Track Record build has not been checked/);
assert.match(box.innerHTML, /11:00 and 15:30 ET Top Picks builds after publication/);
assert.doesNotMatch(box.innerHTML, /every 5 minutes|over 15 minutes old/);
context.accuracyState.data.builtAtIso = "2026-10-22T19:30:00Z";
vm.runInContext("renderWebullTest()", context);
assert.match(box.innerHTML, /latest Track Record build has not been checked/);
console.log("Webull shipped view: quantity totals, partial/settlement states, safe alerts and filters passed.");
