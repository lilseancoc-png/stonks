import assert from "node:assert/strict";
import { emptyLedger, newTrade, updateQuantities, runWebullMirror } from "../lib/webull-mirror.mjs";
import { parsePositions } from "../lib/webull-reconciliation.mjs";
import { pickTradeId } from "../lib/pick-trade-text.mjs";

// The live account from 2026-10-22: MRVL's automatic entry filled before
// broker legs were recorded, so its v3 group could never be bound and every
// run stopped at "position group unverified". Positions held outside the
// mirror (here a TSLA spread and single) must not pause the account either.
const expiry = "2026-12-18", sec = Date.UTC(2026, 11, 18) / 1000;
const leg = (symbol, strike, side, type) => ({ symbol, strike_price: String(strike), side, quantity: "1", option_type: type, option_expire_date: expiry, option_contract_multiplier: "100", option_contract_deliverable: "100" });
const mrvlLegs = [leg("MRVL", 250, "BUY", "CALL"), leg("MRVL", 300, "SELL", "CALL")];
const tslaLegs = [leg("TSLA", 390, "BUY", "PUT"), leg("TSLA", 345, "SELL", "PUT")];
const aaplLegs = [leg("AAPL", 200, "BUY", "CALL"), leg("AAPL", 220, "SELL", "CALL")];
const group = (id, legs) => ({ position_id: id, symbol: legs[0].symbol, instrument_type: "OPTION", quantity: "1", option_strategy: legs.length === 2 ? "VERTICAL" : "SINGLE",
  legs: legs.slice().reverse().map((l, i) => ({ symbol: l.symbol, leg_id: `${id}-${i}`, option_type: l.option_type, option_expire_date: expiry,
    option_exercise_price: l.strike_price, option_contract_multiplier: "100", option_contract_deliverable: "100" })) });
const detail = (id, legs) => ({ orders: [{ client_order_id: id, status: "FILLED", total_quantity: "1", filled_quantity: "1", filled_price: "12.50",
  filled_time_at: "2026-10-22T14:04:08.246Z", legs, fees: [{ actual_value: "0.13" }], commission: {} }] });
const pick = (symbol, legs, entryDate, mid) => ({ symbol, side: legs[0].option_type.toLowerCase(), entryDate, contract: {
  structure: "debit_vertical", expiry: sec, netDebit: mid, mid, legs: legs.map(l => ({ qty: l.side === "BUY" ? 1 : -1, type: l.option_type.toLowerCase(), strike: Number(l.strike_price), expiry: sec })) } });

const mrvl = pick("MRVL", mrvlLegs, "2026-10-21T19:34:45.642Z", 14.73);
const ledger = { ...emptyLedger(), accountId: "PAPER", goLiveIso: "2026-10-21T19:04:45.642Z", lastRunIso: "2026-10-27T15:05:08.675Z",
  positionBaseline: { capturedAtIso: "2026-10-21T20:18:25.247Z", options: {}, equities: {} } };
const old = newTrade(mrvl, pickTradeId(mrvl));
Object.assign(old, { state: "open", entryAttempts: [{ phase: "entry", n: 1, clientOrderId: "mrvl-entry-1", quantity: 1, filledQty: 1, status: "FILLED",
  filledPrice: 12.5, filledIso: "2026-10-22T14:04:08.246Z", feeEst: 0.13 }] });
updateQuantities(old); ledger.trades[old.tradeId] = old;
const outside = [group("tsla-spread", tslaLegs), group("tsla-single", [tslaLegs[0]])];
const positions = [group("mrvl-auto", mrvlLegs), ...outside];
const acc = { builtAtIso: "2026-10-27T19:33:19.598Z", open: [mrvl], closed: [] };
const after = Date.parse("2026-10-27T21:00:00Z"), during = Date.parse("2026-10-27T19:35:00Z");
const client = (over = {}) => ({ accountList: async () => [{ account_id: "PAPER" }], positions: async () => positions,
  orderDetail: async (_, id) => detail(id, mrvlLegs), placeOrder: async () => { throw new Error("no orders expected"); }, ...over });

// Without an owned-contract list the parser stays strict, as before.
assert.throws(() => parsePositions(positions), { code: "POSITION_GROUP_UNVERIFIED" });

let r = await runWebullMirror({ client: client(), accountId: "PAPER", acc, ledger: structuredClone(ledger), nowMs: after });
const t = r.ledger.trades[old.tradeId];
assert.equal(r.ledger.reconciliation.status, "matched", "legacy fill binds once the broker's own order legs are read");
assert.equal(t.brokerPosition.positionId, "mrvl-auto");
assert.equal(t.entryAttempts[0].brokerLegs.length, 2);
assert.equal(r.ledger.reconciliation.externalGroups, 2, "outside positions are counted, not adopted");
assert.equal(r.summary.errors, 0);
let calls = 0;
r = await runWebullMirror({ client: client({ orderDetail: async () => { calls++; return null; } }), accountId: "PAPER", acc, ledger: r.ledger, nowMs: after + 120000 });
assert.equal(calls, 0, "a bound trade does not re-read its order");
assert.equal(r.ledger.reconciliation.status, "matched");

r = await runWebullMirror({ client: client({ orderDetail: async () => { throw new Error("timeout"); } }), accountId: "PAPER", acc, ledger: structuredClone(ledger), nowMs: after });
assert.equal(r.ledger.reconciliation.status, "unavailable", "no broker evidence still fails closed");
assert.equal(r.ledger.trades[old.tradeId].entryAttempts[0].lookupFailed, undefined, "a failed leg read does not mark the fill unverified");
r = await runWebullMirror({ client: client({ orderDetail: async (_, id) => detail(id, [mrvlLegs[0], leg("MRVL", 310, "SELL", "CALL")]) }), accountId: "PAPER", acc, ledger: structuredClone(ledger), nowMs: after });
assert.equal(r.ledger.trades[old.tradeId].needsReview, true, "broker legs that differ from the pick are flagged");
assert.equal(r.ledger.trades[old.tradeId].brokerPosition, undefined);
const overlap = [...positions, group("mrvl-manual", [mrvlLegs[0]])];
r = await runWebullMirror({ client: client({ positions: async () => overlap }), accountId: "PAPER", acc, ledger: structuredClone(ledger), nowMs: after });
assert.equal(r.ledger.reconciliation.status, "unavailable", "an outside group sharing a mirror contract still pauses");

// New picks during the session: one that shares a contract with an outside
// position is not entered; an unrelated one is.
const tsla = pick("TSLA", tslaLegs, "2026-10-27T19:33:00.000Z", 20), aapl = pick("AAPL", aaplLegs, "2026-10-27T19:33:00.000Z", 6);
const sent = [];
r = await runWebullMirror({ client: client({ placeOrder: async (_, orders) => { sent.push(...orders); return {}; },
  orderDetail: async (_, id) => id === "mrvl-entry-1" ? detail(id, mrvlLegs) : { orders: [{ client_order_id: id, status: "SUBMITTED", filled_quantity: "0" }] } }),
  accountId: "PAPER", acc: { ...acc, open: [mrvl, tsla, aapl] }, ledger: structuredClone(ledger), nowMs: during, quoteFn: async () => null });
assert.deepEqual(sent.map(o => o.legs?.[0]?.symbol ?? o.symbol), ["AAPL"], "only the unrelated pick is entered");
assert.match(r.ledger.trades[pickTradeId(tsla)].note, /outside the mirror/);
console.log("Webull legacy fill: broker-leg backfill binds the old spread, outside positions don't pause entries, overlaps still fail closed (offline).");
