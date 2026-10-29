import assert from "node:assert/strict";
import { prepareManualRecovery } from "../lib/webull-manual-recovery.mjs";
import { emptyLedger, newTrade, updateQuantities, runWebullMirror, ledgerToTestTrades, ledgerToFillRows, parseOrderDetail } from "../lib/webull-mirror.mjs";
import { parsePositions, reconcilePositions } from "../lib/webull-reconciliation.mjs";
import { positionBindings, bindNewFilledGroups } from "../lib/webull-position-groups.mjs";
import { pickTradeId } from "../lib/pick-trade-text.mjs";
import { webullAnalyticsFactory } from "../lib/webull-analytics.mjs";
import { recoverManualSpread } from "./recover-webull-manual.mjs";

// Anonymized shapes from sandbox v3: parent quantities; no leg quantity/side;
// reordered spread legs, and an external single overlapping the spread's long.
const expiry = "2026-12-18", sec = Date.UTC(2026, 11, 18) / 1000;
const leg = (symbol, strike, side, type = "PUT") => ({ symbol, strike_price: String(strike), side, quantity: "1", option_type: type, option_expire_date: expiry, option_contract_multiplier: "100", option_contract_deliverable: "100" });
const tslaLegs = [leg("TSLA", 390, "BUY"), leg("TSLA", 345, "SELL")], mrvlLegs = [leg("MRVL", 250, "BUY", "CALL"), leg("MRVL", 300, "SELL", "CALL")];
function order(id, legs, price, at) {
  return { client_order_id: id, orders: [{ client_order_id: id, order_id: id + "-broker", symbol: legs[0].symbol,
    status: "FILLED", total_quantity: "1", filled_quantity: "1", filled_price: String(price), filled_time_at: at,
    place_time_at: new Date(Date.parse(at) - 2000).toISOString(), limit_price: String(price), legs,
    fees: [{ actual_value: "0.12" }], commission: {}, option_strategy: legs.length === 2 ? "VERTICAL" : "SINGLE" }] };
}
function group(id, legs) {
  return { position_id: id, symbol: legs[0].symbol, instrument_type: "OPTION", quantity: "1", option_strategy: legs.length === 2 ? "VERTICAL" : "SINGLE",
    legs: legs.slice().reverse().map((l, i) => ({ symbol: l.symbol, leg_id: id + "-" + i, option_type: l.option_type,
      option_expire_date: expiry, option_exercise_price: l.strike_price, option_contract_multiplier: "100", option_contract_deliverable: "100" })) };
}
const positions = [group("manual-spread", tslaLegs), group("external-single", [tslaLegs[0]]), group("old-mirror", mrvlLegs)];
const pick = (symbol, legs, entryDate, mid) => ({ symbol, side: legs[0].option_type.toLowerCase(), entryDate, contract: {
  structure: "debit_vertical", expiry: sec, netDebit: mid, mid, legs: legs.map(l => ({ qty: l.side === "BUY" ? 1 : -1, type: l.option_type.toLowerCase(), strike: Number(l.strike_price), expiry: sec })) } });
const tsla = pick("TSLA", tslaLegs, "2026-10-23T15:03:47.399Z", 20.38), mrvl = pick("MRVL", mrvlLegs, "2026-10-21T19:34:45.642Z", 14.73);
const manualOrder = order("manual", tslaLegs, 19.25, "2026-10-23T18:12:02.000Z");
const heldOrder = order("old-auto", mrvlLegs, 11.75, "2026-10-22T14:10:00.000Z");
const externalOrder = order("external", [tslaLegs[0]], 29.75, "2026-10-23T18:10:04.000Z");
const ledger = { ...emptyLedger(), accountId: "PAPER", lastRunIso: "2026-10-22T19:34:06.613Z", goLiveIso: "2026-10-21T19:04:00Z" };
const old = newTrade(mrvl, pickTradeId(mrvl));
Object.assign(old, { state: "open", entryAttempts: [{ phase: "entry", clientOrderId: "old-auto", quantity: 1, filledQty: 1, status: "FILLED", filledPrice: 11.75, filledIso: heldOrder.orders[0].filled_time_at, feeEst: 0.13 }] });
updateQuantities(old); ledger.trades[old.tradeId] = old;
const acc = { builtAtIso: "2026-10-23T19:32:22Z", open: [mrvl, tsla], closed: [] };
const input = { ledger, acc, positions, manualOrder, heldOrders: [heldOrder], externalOrders: [externalOrder], accountId: "PAPER", checkedAtIso: "2026-10-24T17:00:00Z" };
assert.throws(() => parsePositions(positions), { code: "POSITION_GROUP_UNVERIFIED" }, "unknown directions cannot be inferred from holdings");
const before = JSON.stringify(input), plan = prepareManualRecovery(input), t = plan.ledger.trades[plan.manualTradeId];
assert.equal(JSON.stringify(input), before, "planning cannot mutate its evidence");
assert.equal(plan.reconciliation.status, "matched");
assert.equal(plan.ledger.lastRunIso, ledger.lastRunIso, "a plan is not a production run");
assert.equal(t.filledQty, 1); assert.equal(t.fillPrice, 19.25); assert.equal(t.fees, 0.12);
assert.equal(t.entryAttempts[0].filledIso, "2026-10-23T18:12:02.000Z");
assert.equal(t.entrySource, "manual"); assert.equal(t.entryDiffPct, -5.5);
assert.equal(plan.ledger.positionBaseline.options["TSLA|2026-12-18|PUT|390"], 1);
const discovered = structuredClone(plan.ledger);
delete discovered.trades[old.tradeId].brokerPosition;
bindNewFilledGroups(discovered, positions);
assert.equal(discovered.trades[old.tradeId].brokerPosition.positionId, "old-mirror", "new groups bind to actual filled broker legs");
const noProof = structuredClone(plan.ledger);
delete noProof.trades[old.tradeId].brokerPosition; delete noProof.trades[old.tradeId].entryAttempts[0].brokerLegs;
bindNewFilledGroups(noProof, positions);
assert.equal(noProof.trades[old.tradeId].brokerPosition, undefined, "engine legs cannot substitute for broker fill evidence");
assert.deepEqual(prepareManualRecovery({ ...input, ledger: plan.ledger }).ledger.trades, plan.ledger.trades, "the same manual import is idempotent");
const nestedHeldOrder = structuredClone(heldOrder);
delete nestedHeldOrder.client_order_id;
assert.equal(prepareManualRecovery({ ...input, heldOrders: [nestedHeldOrder] }).reconciliation.status, "matched",
  "held-order evidence uses the required nested ID rather than an optional envelope field");
const wrongHeldOrder = structuredClone(heldOrder);
wrongHeldOrder.orders[0].client_order_id = "different-order";
assert.throws(() => prepareManualRecovery({ ...input, heldOrders: [wrongHeldOrder] }), /confirmed broker fill/,
  "an outer envelope ID must not authorize a different nested order");
// The first normal run after deployment can enroll TSLA before holdings
// verification pauses the account. That zero-intent queue is safe to adopt;
// a durable broker intent or any exposure must never be replaced.
const blockedRun = await runWebullMirror({ ledger: structuredClone(ledger), acc, accountId: "PAPER",
  nowMs: Date.parse("2026-10-23T19:35:00Z"), client: {
    accountList: async () => [{ account_id: "PAPER" }], positions: async () => positions,
    placeOrder: async () => { throw new Error("unverified holdings must not submit orders"); },
  } });
const queued = blockedRun.ledger.trades[plan.manualTradeId];
assert.equal(blockedRun.ledger.reconciliation.status, "unavailable");
assert.equal(queued.state, "entering"); assert.equal(queued.entryAttempts.length, 0);
assert.equal(prepareManualRecovery({ ...input, ledger: blockedRun.ledger }).ledger.trades[plan.manualTradeId].entrySource,
  "manual", "a paused zero-intent queue must not prevent verified manual adoption");
for (const status of ["PREPARED", "UNKNOWN", "SENT", "FILLED"]) {
  const journaled = structuredClone(blockedRun.ledger);
  journaled.trades[plan.manualTradeId].entryAttempts.push({ clientOrderId: "existing-intent", status, quantity: 1, filledQty: 0 });
  assert.throws(() => prepareManualRecovery({ ...input, ledger: journaled }), /execution state/, "recovery must never overwrite a journaled broker intent");
}
for (const recorded of [{ needsReview: true }, { brokerPosition: {} }, { provenance: {} }, { filledQty: 1 }, { closedQty: 1 }, { openQty: 1 }, { settledQty: 1 }]) {
  const active = structuredClone(blockedRun.ledger);
  Object.assign(active.trades[plan.manualTradeId], recorded);
  assert.throws(() => prepareManualRecovery({ ...input, ledger: active }), /execution state/, "only a pristine zero-exposure queue can be adopted");
}
for (const quantity of [100, -100]) {
  const stockChange = [...positions, { instrument_type: "EQUITY", symbol: "TSLA", quantity }];
  assert.throws(() => prepareManualRecovery({ ...input, ledger: plan.ledger, positions: stockChange }), /stock holdings baseline differs/, "recovery must reject unexpected long or short stock holdings");
}
const withStock = structuredClone(plan.ledger);
withStock.positionBaseline.equities = { TSLA: 100, AAPL: 5 };
const existingStock = [{ instrument_type: "EQUITY", symbol: "AAPL", quantity: 5 }, { instrument_type: "EQUITY", symbol: "TSLA", quantity: 100 }];
assert.deepEqual(prepareManualRecovery({ ...input, ledger: withStock, positions: [...positions, ...existingStock] }).ledger.positionBaseline.equities,
  { AAPL: 5, TSLA: 100 }, "unchanged stocks remain recoverable regardless of object key order");
assert.throws(() => prepareManualRecovery({ ...input, ledger: withStock }), /stock holdings baseline differs/, "recovery must reject disappeared stock holdings");
const missingStockBaseline = structuredClone(plan.ledger);
delete missingStockBaseline.positionBaseline.equities;
assert.throws(() => prepareManualRecovery({ ...input, ledger: missingStockBaseline }), /stock holdings baseline is unavailable/, "missing stock evidence cannot become an empty baseline");
assert.throws(() => prepareManualRecovery({ ...input, accountId: "OTHER" }), /account/);
assert.throws(() => prepareManualRecovery({ ...input, manualOrder: externalOrder }), /published/);
const partial = structuredClone(manualOrder); partial.orders[0].filled_quantity = "0";
assert.throws(() => prepareManualRecovery({ ...input, manualOrder: partial }), /confirmed/);
const missingTime = structuredClone(manualOrder); delete missingTime.orders[0].filled_time_at;
assert.throws(() => prepareManualRecovery({ ...input, manualOrder: missingTime }), /timestamp/);
const wrongDirection = structuredClone(manualOrder); wrongDirection.orders[0].legs[0].side = "SELL";
assert.throws(() => prepareManualRecovery({ ...input, manualOrder: wrongDirection }), /published/);
const wrongGroup = structuredClone(positions); wrongGroup[0].legs[0].leg_id = "changed";
assert.throws(() => parsePositions(wrongGroup, positionBindings(plan.ledger)), { code: "POSITION_GROUP_UNVERIFIED" });
const ratio = structuredClone(positions); ratio[0].legs[0].quantity = "2";
assert.throws(() => parsePositions(ratio, positionBindings(plan.ledger)), { code: "POSITION_GROUP_UNVERIFIED" });
const conflictingSide = structuredClone(positions); conflictingSide[0].legs[0].side = "BUY";
assert.throws(() => parsePositions(conflictingSide, positionBindings(plan.ledger)), { code: "POSITION_GROUP_UNVERIFIED" });
const changedExternal = structuredClone(positions); changedExternal[1].quantity = "2";
assert.equal(reconcilePositions(structuredClone(plan.ledger), parsePositions(changedExternal, positionBindings(plan.ledger)), input.checkedAtIso).status, "attention");

const sent = []; let current = structuredClone(positions), exitFill = false;
const client = { accountList: async () => [{ account_id: "PAPER" }], positions: async () => current,
  placeOrder: async (_, orders) => { sent.push(...orders); return {}; },
  orderDetail: async (_, id) => ({ orders: [{ client_order_id: id, status: exitFill ? "FILLED" : "SUBMITTED", filled_quantity: exitFill ? "1" : "0", filled_price: exitFill ? "25.50" : null, filled_time_at: exitFill ? "2026-10-23T19:45:00Z" : null, fees: [{ actual_value: "0.16" }], commission: {} }] }),
  cancelOrder: async () => { throw new Error("unexpected cancel"); } };
let result = await runWebullMirror({ client, accountId: "PAPER", acc, ledger: structuredClone(plan.ledger), nowMs: Date.parse("2026-10-23T19:35:00Z") });
assert.equal(result.ledger.reconciliation.status, "matched"); assert.equal(sent.length, 0, "recovery never buys TSLA again");
const closed = { ...tsla, status: "hit-tp-prem", optionPnlPct: 25, exitDate: "2026-10-23T19:36:00Z" };
const closing = { ...acc, open: [mrvl], closed: [closed] };
let durable = null;
result = await runWebullMirror({ client, accountId: "PAPER", acc: closing, ledger: result.ledger, nowMs: Date.parse("2026-10-23T19:40:00Z"),
  quoteFn: async () => ({ bid: 25.4, ask: 25.6 }), checkpoint: async value => { durable = structuredClone(value); } });
assert.equal(sent.length, 1); assert.equal(sent[0].quantity, "1");
assert.equal(sent[0].legs.find(l => l.strike_price === "390").side, "SELL");
assert.equal(sent[0].legs.find(l => l.strike_price === "345").side, "BUY");
assert.equal(durable.trades[plan.manualTradeId].exitAttempts[0].order.client_order_id, sent[0].client_order_id, "exit intent is durable");
exitFill = true; current = current.filter(p => p.position_id !== "manual-spread");
result = await runWebullMirror({ client, accountId: "PAPER", acc: closing, ledger: structuredClone(durable), nowMs: Date.parse("2026-10-23T19:46:00Z") });
assert.equal(sent.length, 1); assert.equal(result.ledger.trades[plan.manualTradeId].state, "closed");
assert.equal(result.ledger.trades[plan.manualTradeId].fees, 0.28, "entry and exit actual fees count once");
assert.equal(result.ledger.reconciliation.status, "matched");
assert.equal(current.find(p => p.position_id === "external-single").quantity, "1", "extra long is retained");
const corruptManual = structuredClone(result.ledger);
Object.assign(corruptManual.trades[plan.manualTradeId], { state: "entering", requestedQty: 2 });
await runWebullMirror({ client, accountId: "PAPER", acc, ledger: corruptManual, nowMs: Date.parse("2026-10-23T19:49:00Z") });
assert.equal(sent.length, 1, "a manual entry is never topped up or resubmitted");
const view = ledgerToTestTrades(result.ledger).find(x => x.entrySource === "manual");
assert.equal(view.entrySentIso, null); assert.equal(view.entryHow, null); assert.equal(view.entryDiffPct, -5.5);
assert.equal(view.manualEntrySentIso, manualOrder.orders[0].place_time_at);
assert.match(ledgerToFillRows(result.ledger).find(x => x.symbol === "TSLA").account, /manual entry/);
assert.equal(ledgerToFillRows(result.ledger).find(x => x.symbol === "TSLA").source, "webull-paper");
assert.equal(webullAnalyticsFactory().analyze([{ t: { ...view, entryDiffPct: 99, exitDiffPct: null } }]).slippage.length, 0);
assert.equal(parseOrderDetail(order("fees", tslaLegs, 1, input.checkedAtIso)).feeActual, 0.12);
// Exercise the operational command's boundary: inspection cannot acquire the
// lock or write; applying must re-read under the account-wide lease and refuse
// concurrent publications, open orders and expired guards.
const data = new Map([["webull-paper-ledger.json", Buffer.from(JSON.stringify(ledger))], ["picks-accuracy.json", Buffer.from(JSON.stringify(acc))]]);
let checkpoints = 0, acquisitions = 0;
const store = { backend: "r2", get: async key => data.get(key), put: async (key, value) => { checkpoints++; data.set(key, Buffer.from(value)); },
  withLease: async (name, fn) => { assert.equal(name, "webull-paper"); acquisitions++; return { busy: false, result: await fn(() => {}) }; } };
const evidence = new Map([["manual", manualOrder], ["old-auto", heldOrder], ["external", externalOrder]]);
const reads = { accountList: client.accountList, positions: async () => positions, openOrders: async () => ({ data: [] }), orderDetail: async (_, id) => evidence.get(id) };
const config = { manualClientOrderId: "manual", externalClientOrderIds: ["external"] };
const operation = { store, client: reads, accountId: "PAPER", config, now: () => input.checkedAtIso };
await recoverManualSpread(operation);
assert.equal(checkpoints, 0); assert.equal(acquisitions, 0, "default recovery is strictly read-only");
await recoverManualSpread({ ...operation, apply: true });
assert.equal(checkpoints, 1); assert.equal(acquisitions, 1);
assert.equal(JSON.parse(String(data.get("webull-paper-ledger.json"))).lastRunIso, ledger.lastRunIso);
const savedBeforeStockChange = String(data.get("webull-paper-ledger.json"));
await assert.rejects(recoverManualSpread({ ...operation, apply: true, client: { ...reads, positions: async () => [...positions,
  { instrument_type: "EQUITY", symbol: "TSLA", quantity: 100 }] } }), /stock holdings baseline differs/);
assert.equal(checkpoints, 1, "unexpected stock holdings must stop before the recovery checkpoint");
assert.equal(String(data.get("webull-paper-ledger.json")), savedBeforeStockChange, "rejected stock recovery leaves the saved ledger unchanged");
await assert.rejects(recoverManualSpread({ ...operation, apply: true, client: { ...reads, openOrders: async () => ({ data: [{ status: "SUBMITTED" }] }) } }), /open or incomplete/);
assert.equal(checkpoints, 1);
await assert.rejects(recoverManualSpread({ ...operation, apply: true, store: { ...store, withLease: async () => ({ busy: true }) } }), { code: "LEASE_HELD" });
await assert.rejects(recoverManualSpread({ ...operation, apply: true, client: { ...reads, orderDetail: async (...args) => {
  data.set("picks-accuracy.json", Buffer.from(JSON.stringify({ ...acc, builtAtIso: "changed" }))); return reads.orderDetail(...args);
} } }), /changed during recovery/);
assert.equal(checkpoints, 1, "moving research cannot cause a stale recovery checkpoint");
console.log("Webull grouped positions: broker-order evidence, manual provenance, duplicate prevention, one-spread exit and untouched extra long passed (offline).");

// Tomorrow's manual recovery: three picks already have failed automatic
// attempts, another holding filled on its second attempt, and old settlement
// history must stay untouched. All prices/times come from broker evidence.
{
  const queuedLedger = structuredClone(ledger);
  const auto = queuedLedger.trades[old.tradeId];
  const autoCancelled = { orders: [{ client_order_id: "auto-cancelled", status: "CANCELLED", filled_quantity: "0" }] };
  auto.entryAttempts.unshift({ phase: "entry", n: 1, clientOrderId: "auto-cancelled", quantity: 1, filledQty: 0, status: "CANCELLED" });
  auto.entryAttempts[1].n = 2;
  // Its actual fill was not yet observed when the previous window ended.
  Object.assign(auto.entryAttempts[1], { filledQty: 0, status: "SENT", filledPrice: null });
  Object.assign(auto, { state: "entering", filledQty: 0, openQty: 0, fillPrice: null });
  const picks = ["MU", "TSM", "WDC"].map(symbol => pick(symbol,
    [leg(symbol, 100, "BUY", "CALL"), leg(symbol, 110, "SELL", "CALL")], "2026-10-28T19:33:26Z", 1));
  const manuals = picks.map((e, i) => order("manual-" + e.symbol, [leg(e.symbol, 100, "BUY", "CALL"), leg(e.symbol, 110, "SELL", "CALL")], 1.02 + i / 100, "2026-10-29T13:31:00Z"));
  const retired = picks.map(e => ({ orders: [{ client_order_id: "cancelled-" + e.symbol, status: "CANCELLED", filled_quantity: "0" }] }));
  for (const e of picks) {
    const q = newTrade(e, pickTradeId(e));
    Object.assign(q, { needsReview: true, reviewCode: "EOD_ORDER_UNCONFIRMED", entryAttempts: [{ phase: "entry", n: 1,
      clientOrderId: "cancelled-" + e.symbol, status: "SENT", quantity: 1, filledQty: 0,
      sentIso: "2026-10-28T19:35:00Z", bid: 0.9, ask: 1.1 }] });
    queuedLedger.trades[q.tradeId] = q;
    if (e.symbol === "MU") { q.reviewCode = "CANCEL_UNCONFIRMED"; q.entryAttempts[0].cancelFails = 3; }
  }
  const settled = newTrade({ ...picks[0], symbol: "OLD", entryDate: "2026-10-22T15:00:00Z" }, "settled-history");
  Object.assign(settled, { state: "settled", filledQty: 1, settledQty: 1, openQty: 0, closedQty: 0,
    entryAttempts: [{ phase: "entry", n: 1, clientOrderId: "irrelevant-history", quantity: 1, filledQty: 1, filledPrice: 1, status: "FILLED" }] });
  queuedLedger.trades[settled.tradeId] = settled;
  const fullPositions = [group("old-mirror", mrvlLegs), group("external-single", [tslaLegs[0]]),
    ...manuals.map(o => group(o.orders[0].client_order_id, o.orders[0].legs))];
  const record = { ...acc, open: [mrvl, ...picks], closed: [{ ...picks[0], entryDate: "2026-10-25T15:00:00Z", exitDate: "2026-10-27T15:00:00Z" }] };
  const evidence = [heldOrder, autoCancelled, ...retired];
  const args = { ledger: queuedLedger, acc: record, positions: fullPositions, accountId: "PAPER", checkedAtIso: "2026-10-29T14:00:00Z",
    manualOrders: manuals, retiredOrders: retired, heldOrders: evidence, externalOrders: [externalOrder] };
  const result = prepareManualRecovery(args);
  const retiredOnly = prepareManualRecovery({ ...args, heldOrders: [heldOrder, autoCancelled] });
  assert.equal(retiredOnly.manualTradeIds.length, 3, "fresh retired-order evidence clears only its transient prior status review");
  assert.equal(result.manualTradeIds.length, 3);
  assert.equal(result.ledger.trades[old.tradeId].filledQty, 1, "late automatic fill is refreshed before group allocation");
  assert.equal(result.ledger.trades[settled.tradeId].state, "settled", "unrelated settlement history is preserved");
  const views = ledgerToTestTrades(result.ledger).filter(t => t.entrySource === "manual");
  assert.equal(views.length, 3);
  for (const v of views) {
    assert.equal(v.automaticEntryOutcome, "missed"); assert.equal(v.automaticEntryAttemptCount, 1);
    assert.equal(v.attempts.length, 2); assert.equal(v.manualEntrySentIso, manuals[0].orders[0].place_time_at);
    assert.equal(v.entryBid, null, "yesterday's failed auto quotes cannot describe the manual entry");
    assert.equal(v.needsReview, false); assert.notEqual(v.entryDiffPct, null);
  }
  assert.equal(prepareManualRecovery({ ...args, ledger: result.ledger }).ledger.trades[pickTradeId(picks[0])].entryAttempts.length, 2, "recovery is idempotent");
  const badProof = structuredClone(retired); badProof[0].orders[0].status = "SUBMITTED";
  assert.throws(() => prepareManualRecovery({ ...args, retiredOrders: badProof, heldOrders: [heldOrder, autoCancelled, ...badProof] }), /execution state/);
  const objects = new Map([["webull-paper-ledger.json", Buffer.from(JSON.stringify(queuedLedger))], ["picks-accuracy.json", Buffer.from(JSON.stringify(record))]]);
  const calls = [];
  const allOrders = new Map([...evidence, ...manuals, externalOrder].map(o => [o.orders[0].client_order_id, o]));
  const operation = await recoverManualSpread({ accountId: "PAPER", config: { manualClientOrderIds: manuals.map(o => o.orders[0].client_order_id), externalClientOrderIds: ["external"] },
    store: { backend: "r2", get: async key => objects.get(key) }, now: () => args.checkedAtIso,
    client: { accountList: async () => [{ account_id: "PAPER" }], positions: async () => fullPositions, openOrders: async () => [],
      orderDetail: async (_, id) => { calls.push(id); if (!allOrders.has(id)) throw new Error("unrelated historical order is unavailable"); return allOrders.get(id); } } });
  assert.equal(operation.manualTradeIds.length, 3); assert(!calls.includes("irrelevant-history"));
  const exitBodies = [], batchNow = Date.parse("2026-10-29T14:01:00Z");
  let exitsFilled = false;
  const closedRecord = { ...record, builtAtIso: new Date(batchNow).toISOString(), open: [mrvl],
    closed: [...record.closed, ...picks.map(e => ({ ...e, exitDate: new Date(batchNow).toISOString(), status: "hit-tp-prem", optionPnlPct: 25 }))] };
  const batchClient = { accountList: async () => [{ account_id: "PAPER" }],
    positions: async () => fullPositions.filter(p => !exitsFilled || !picks.some(e => e.symbol === p.symbol)),
    placeOrder: async (_, orders) => {
      assert.equal(orders.length, 1); assert.equal(orders[0].side, "SELL"); assert.equal(orders[0].quantity, "1");
      assert.equal(orders[0].legs.length, 2); exitBodies.push(orders[0]);
    },
    orderDetail: async (_, id) => {
      const body = exitBodies.find(o => o.client_order_id === id);
      assert(body, "manual entries must not be replayed or looked up as new automatic entries");
      return order(id, body.legs, 1.24, new Date(batchNow + 1000).toISOString());
    } };
  let batch = await runWebullMirror({ client: batchClient, accountId: "PAPER", acc: closedRecord, ledger: operation.ledger,
    nowMs: batchNow, quoteFn: async () => ({ bid: 1.2, ask: 1.3 }) });
  assert.equal(exitBodies.length, 3, "each manually recovered spread receives exactly one automatic exit");
  exitsFilled = true;
  batch = await runWebullMirror({ client: batchClient, accountId: "PAPER", acc: closedRecord, ledger: batch.ledger, nowMs: batchNow + 60000 });
  for (const id of operation.manualTradeIds) {
    const t = batch.ledger.trades[id];
    assert.equal(t.state, "closed"); assert.equal(t.openQty, 0); assert.equal(t.closeFillPrice, 1.24);
    assert.equal(t.automaticEntryOutcome, "missed"); assert.equal(t.entrySource, "manual");
    assert.equal(t.entryAttempts.length, 2); assert.equal(t.exitAttempts.length, 1);
  }
  assert.equal(batch.ledger.reconciliation.status, "matched");
  await runWebullMirror({ client: batchClient, accountId: "PAPER", acc: closedRecord, ledger: structuredClone(batch.ledger), nowMs: batchNow + 120000 });
  assert.equal(exitBodies.length, 3, "restart cannot duplicate any of the three exits");
  console.log("Manual batch recovery: three prior misses, late automatic fill, exact manual timestamps, historical-contract disambiguation, preserved settlement history, subsequent automatic exits and restart safety passed.");
}
