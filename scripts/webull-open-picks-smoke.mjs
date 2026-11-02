// Reproduce live-readiness failures with synthetic saved records. No network.
import assert from "node:assert/strict";
import { mirrorHealth, expectedOpenPicksPublication } from "../lib/webull-mirror-health.mjs";
import { diagnoseMirrorStore } from "./diagnose-webull-mirror.mjs";
import { pickTradeId } from "../lib/pick-trade-text.mjs";
const now = Date.parse("2026-11-02T17:00:00Z");
const entry = { symbol: "TEST", side: "call", entryDate: "2026-11-02T16:05:00Z", contract: { structure: "long", mid: 1 } };
const id = pickTradeId(entry);
const acc = { builtAtIso: entry.entryDate, open: [entry], closed: [] };
const ledger = { accountId: "PRIVATE-ACCOUNT", goLiveIso: "2026-10-21T19:04:00Z", engineSnapshotIso: entry.entryDate,
  lastRunIso: "2026-11-02T16:10:00Z", lastEndOfDayDeadlineIso: "2026-10-30T19:55:00Z",
  reconciliation: { status: "matched", checkedAtIso: "2026-11-02T16:10:00Z", alerts: [] }, trades: { [id]: { tradeId: id, state: "open", filledQty: 1, openQty: 1,
    entryAttempts: [{ status: "FILLED", filledQty: 1, clientOrderId: "PRIVATE-ORDER" }], exitAttempts: [] } } };
let groups = 0;
function check(name, fn) { fn(); groups++; console.log("PASS " + name); }
const health = (a = acc, l = ledger, ms = now) => mirrorHealth({ acc: a, ledger: l }, ms);
const has = (r, code) => r.issues.some(i => i.code === code);
check("the raw Open Picks record is authoritative and diagnostics cannot certify the broker", () => {
  const r = health();
  assert.equal(r.status, "saved-checks-current"); assert.equal(r.brokerVerified, false);
  assert.equal(r.counts.mirroredOpenPicks, 1); assert.equal(r.counts.openPicks, 1);
  assert(!JSON.stringify(r).includes("PRIVATE-")); assert(!JSON.stringify(r).includes(id));
});
check("new picks, missed entries, and pre-go-live picks remain distinct", () => {
  const untracked = health(acc, { ...ledger, trades: {} });
  assert(has(untracked, "OPEN_PICKS_UNTRACKED"));
  const missed = health(acc, { ...ledger, trades: { [id]: { state: "missed", filledQty: 0, openQty: 0 } } });
  assert.equal(missed.counts.missedOpenPicks, 1); assert(has(missed, "OPEN_PICKS_UNFILLED"));
  const old = { ...entry, entryDate: "2026-10-20T15:00:00Z" };
  const pre = health({ ...acc, open: [old] }, { ...ledger, trades: {} });
  assert.equal(pre.counts.preGoLiveOpenPicks, 1); assert(!has(pre, "OPEN_PICKS_UNTRACKED")); assert(has(pre, "OPEN_PICKS_PRE_GO_LIVE"));
});
check("manual broker-confirmed holdings are managed without inventing an automatic fill", () => {
  const manual = structuredClone(ledger); manual.trades[id].entrySource = "manual";
  assert.equal(health(acc, manual).counts.mirroredOpenPicks, 1);
});
check("a close signal can expose a pending exit even before its metadata is copied", () => {
  const r = health({ ...acc, open: [], closed: [{ ...entry, exitDate: entry.entryDate }] });
  assert.equal(r.counts.signaledExitsOpen, 1); assert(has(r, "SIGNALED_EXIT_PENDING"));
  assert.equal(health({ ...acc, open: [], closed: [], archive: [entry] }).counts.signaledExitsOpen, 1);
});
check("partial and legacy cumulative fills retain remaining exposure", () => {
  const l = structuredClone(ledger), t = l.trades[id];
  delete t.openQty; delete t.filledQty;
  t.entryAttempts = [{ status: "FILLED", quantity: 3 }]; t.exitAttempts = [{ status: "FILLED", quantity: 2 }];
  assert.equal(health(acc, l).counts.mirroredOpenPicks, 1);
  t.settledQty = 1; assert.equal(health(acc, l).counts.mirroredOpenPicks, 0);
});
check("working orders are pending and unknown outcomes need attention", () => {
  const l = structuredClone(ledger); l.trades[id] = { state: "entering", filledQty: 0, entryAttempts: [{ status: "SUBMITTED" }] };
  assert.equal(health(acc, l).status, "pending");
  l.trades[id].entryAttempts[0].status = "UNKNOWN";
  assert(has(health(acc, l), "ORDER_OUTCOME_UNCONFIRMED"));
  l.trades[id].entryAttempts[0] = { status: "FILLED", lookupFailed: true };
  assert(has(health(acc, l), "ORDER_OUTCOME_UNCONFIRMED"));
});
check("Friday stale data stays stale through the weekend and Monday morning", () => {
  const old = { ...acc, builtAtIso: "2026-10-29T19:33:41Z" };
  for (const at of ["2026-10-30T20:00:00Z", "2026-11-01T12:00:00Z", "2026-11-02T12:00:00Z"])
    assert(has(health(old, ledger, Date.parse(at)), "OPEN_PICKS_STALE"));
  assert(!has(health({ ...acc, builtAtIso: "2026-10-30T19:33:00Z" }, ledger, Date.parse("2026-11-02T12:00:00Z")), "OPEN_PICKS_STALE"));
  assert(has(health({ ...acc, builtAtIso: "2099-01-01T00:00:00Z" }), "OPEN_PICKS_TIMESTAMP_INVALID"));
});
check("decision windows account for DST, publication latency, early closes and holidays", () => {
  assert.deepEqual(expectedOpenPicksPublication(Date.parse("2026-11-02T16:19:00Z")), { date: "2026-10-30", minute: 930 });
  assert.deepEqual(expectedOpenPicksPublication(Date.parse("2026-11-02T16:20:00Z")), { date: "2026-11-02", minute: 660 });
  assert.deepEqual(expectedOpenPicksPublication(Date.parse("2026-11-27T21:00:00Z")), { date: "2026-11-27", minute: 660 });
  assert.deepEqual(expectedOpenPicksPublication(Date.parse("2026-11-26T21:00:00Z")), { date: "2026-11-25", minute: 930 });
  assert.equal(expectedOpenPicksPublication(Date.parse("2029-01-03T21:00:00Z")), null);
});
check("a late HTTP-successful run cannot stand in for a completed closing deadline", () => {
  const l = { ...ledger, lastRunIso: "2026-10-30T23:13:00Z", lastEndOfDayDeadlineIso: null };
  assert(has(health(acc, l), "CLOSING_DEADLINE_MISSED"));
  assert(has(health(acc, { ...l, lastEndOfDayDeadlineIso: l.lastRunIso }), "CLOSING_DEADLINE_MISSED"));
  assert(has(health(acc, { ...l, lastEndOfDayDeadlineIso: "2026-10-29T19:55:00Z" }), "CLOSING_DEADLINE_MISSED"));
  assert(!has(health(), "CLOSING_DEADLINE_MISSED"));
});
check("reconciliation, lock and source failures never become a healthy result", () => {
  assert(has(health(acc, { ...ledger, reconciliation: { status: "attention", alerts: ["PRIVATE-ALERT"] } }), "RECONCILIATION_NOT_MATCHED"));
  assert(has(health(acc, { ...ledger, engineSnapshotIso: "2026-10-30T19:33:00Z" }), "MIRROR_BEHIND_OPEN_PICKS"));
  assert(has(mirrorHealth({ acc, ledger, executionLock: { state: "invalid", owner: "PRIVATE-LOCK" } }, now), "EXECUTION_LOCK_UNVERIFIED"));
  assert(has(mirrorHealth({ acc, ledger, enabled: false }, now), "MIRROR_DISABLED"));
  assert(has(health(acc, { ...ledger, reconciliation: { status: "matched", checkedAtIso: "2026-10-30T19:55:00Z" } }), "RECONCILIATION_STALE"));
  assert(has(health(null, null), "OPEN_PICKS_UNAVAILABLE"));
  assert(has(health(acc, { trades: [] }), "MIRROR_LEDGER_UNAVAILABLE"));
});
const objects = new Map([["picks-accuracy.json", acc], ["webull-paper-ledger.json", ledger]]);
const reads = [];
const store = { backend: "r2", hasToken: () => true,
  get: async key => { reads.push(key); return objects.has(key) ? Buffer.from(JSON.stringify(objects.get(key))) : null; },
  rawGet: async key => { reads.push(key); return null; },
  put: () => { throw Error("diagnostics attempted a write"); }, withLease: () => { throw Error("diagnostics attempted a lease"); } };
const before = JSON.stringify({ acc, ledger });
const result = await diagnoseMirrorStore(store, now);
assert.equal(result.health.status, "saved-checks-current");
assert.deepEqual(reads.sort(), ["_stonks/leases/webull-paper.json", "picks-accuracy.json", "webull-paper-ledger.json"].sort());
assert.equal(JSON.stringify({ acc, ledger }), before); assert(!JSON.stringify(result).includes("PRIVATE-"));
console.log(`Open Picks mirror readiness: ${groups} groups and read-only store integration passed.`);
