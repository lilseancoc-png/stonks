#!/usr/bin/env node
// Webull paper mirror upgrades from Webull's own data (2026-11-19, wave 2
// build A): the contract check and Webull's price step, real fees from order
// history, share orders priced off Webull's stock snapshot.
//   node scripts/webull-data-mirror-smoke.mjs   (no npm script, so verify:risk-cost stays green)
// Settings for reruns under other assumptions (env, all optional):
//   WB_BAND_PCT   Webull vs Yahoo stock-mid band before Yahoo is used (default 1)
//   WB_PRICE      option mid of the test trades (default 4)
// Every scenario uses a fake Webull (no network, no store, never a real or
// paper order).
import assert from "node:assert/strict";
import { runWebullMirror, LIVE_SIZING, roundTick, makeQuoteFn, ledgerToFillRows, ledgerToTestTrades, fillRowsToCsv, orderAttemptsToCsv, parseOrderDetail, updateQuantities } from "../lib/webull-mirror.mjs";
import { executionPrice } from "../lib/webull-execution-policy.mjs";
import { occSymbol, parseContractList, matchLeg, legProblem, contractVerdict, optionTick, makeContractCheck, NOT_TRADABLE_PREFIX } from "../lib/webull-contracts.mjs";
import { snapshotRow, snapshotQuote, chooseStockQuote, makeWebullStockFetcher, WEBULL_STOCK_SOURCE, STOCK_QUOTE_BAND_PCT } from "../lib/webull-quotes.mjs";
import { parseOrderHistory, historyShape, attemptsNeedingFees, applyHistoryFees, backfillFees, feeBreakdown } from "../lib/webull-fees.mjs";
import { createWebullClient } from "../lib/webull-client.mjs";
import { ownerSettingDef, runtimeEnvOverrides } from "../lib/owner-settings.mjs";

const BAND = Number(process.env.WB_BAND_PCT || STOCK_QUOTE_BAND_PCT);
const PX = Number(process.env.WB_PRICE || 4);
let passed = 0, failed = 0;
const ok = async (name, fn) => { try { await fn(); passed++; } catch (err) { failed++; console.error(`FAIL ${name}\n  ${err?.stack || err}`); process.exitCode = 1; } };

const EXP = Date.UTC(2027, 0, 15) / 1000;                 // Fri Jan 15 2027
const T0 = Date.parse("2026-11-19T16:10:00Z");           // Thu 11:10 ET, regular session
const ENTRY = "2026-11-19T16:00:00.000Z", BUILT = "2026-11-19T16:02:00.000Z";
const flag = (symbol, o = {}) => ({ symbol, side: "call", entryDate: ENTRY, exitPolicy: { version: "2026-10-22-tp25", takeProfitPct: 25, stopPct: -50 },
  contract: { structure: "long", strike: 100, expiry: EXP, mid: PX }, ...o });
const ledger0 = () => ({ version: 2, goLiveIso: "2026-11-01T14:00:00.000Z", accountId: "PAPER1", trades: {}, runs: [] });
const row = (symbol, o = {}) => ({ symbol, underlying_symbol: symbol.replace(/\d.*$/, ""), status: "LISTING", tradable_status: "OC", expiration_date: "2027-01-15",
  option_type: "CALL", strike_price: "100", multiplier: "100", def_type: "STANDARD", ppind: true, ...o });

// Fake Webull with a contract list (one row set per OCC symbol).
function fakeWebull({ contracts = {}, listError = null, history = null, snapshots = {} } = {}) {
  const orders = new Map(), placed = [], listCalls = [], snapCalls = [], historyCalls = [];
  return {
    placed, listCalls, snapCalls, historyCalls, orders,
    accountList: async () => [{ account_id: "PAPER1" }],
    positions: async () => {
      const out = [];
      for (const o of orders.values()) {
        const q = Number(o.filled_quantity || 0);
        if (!q || o.body.instrument_type === "EQUITY") continue;
        const l = o.body.legs[0];
        out.push({ instrument_type: "OPTION", symbol: l.symbol, quantity: String(q), legs: [{ symbol: l.symbol, option_expire_date: l.option_expire_date, option_type: l.option_type, strike_price: l.strike_price, quantity: String(q) }] });
      }
      return out;
    },
    balance: async () => ({ total_cash_balance: "1000000" }),
    previewOrder: async () => ({ estimated_transaction_fee: "0.65" }),
    placeOrder: async (acct, list) => { const o = list[0]; orders.set(o.client_order_id, { status: "SUBMITTED", body: o }); placed.push(o); return { client_order_id: o.client_order_id }; },
    orderDetail: async (acct, id) => { const o = orders.get(id); if (!o) throw new Error("not found");
      return { orders: [{ client_order_id: id, status: o.status, filled_price: o.filled_price ?? null, filled_quantity: o.filled_quantity || "0", filled_time_at: o.filled_time_at ?? null }] }; },
    cancelOrder: async (acct, id) => { const o = orders.get(id); if (!o || o.status === "FILLED") throw new Error("cannot cancel"); o.status = "CANCELLED"; return {}; },
    optionContracts: async (q) => {
      listCalls.push(q);
      if (listError) throw listError;
      if (q.option_symbols) return { data: q.option_symbols.split(",").map((s) => contracts[s]).filter(Boolean) };
      return { data: Object.values(contracts).filter((r) => r.underlying_symbol === q.underlying_symbols && r.expiration_date === q.start_date && Number(r.strike_price) === Number(q.strike_price_gte)) };
    },
    stockSnapshots: async (symbols, category) => { snapCalls.push([symbols.join(","), category]); const r = snapshots[`${symbols[0]}|${category}`]; if (r instanceof Error) throw r; return r ? [r] : []; },
    orderHistory: async (acct, q) => { historyCalls.push(q); if (history instanceof Error) throw history; return history; },
  };
}
const quote = async (t) => ({ bid: t.engineEntryPrice, ask: t.engineEntryPrice });
const run = (args) => runWebullMirror({ clock: () => 0, quoteFn: quote, sizing: { ...LIVE_SIZING, riskUsd: 2000 }, accountId: "PAPER1", nowMs: T0, ...args });
const OCC = "AAA270115C00100000";

// --- 1. Contract list --------------------------------------------------------------
await ok("occSymbol: OCC format as Webull lists it (root, YYMMDD, C/P, strike x 1000 in 8 digits)", () => {
  assert.equal(occSymbol("AAPL", "2026-12-18", "PUT", 350), "AAPL261218P00350000");
  assert.equal(occSymbol("AAPL", "2027-01-15", "CALL", 352.5), "AAPL270115C00352500");
  assert.equal(occSymbol("BRK.B", "2027-01-15", "CALL", 7.5), "BRKB270115C00007500");
  assert.equal(occSymbol("AAPL", "bad", "CALL", 1), null);
  assert.equal(occSymbol("AAPL", "2027-01-15", "CALL", 0), null);
});
await ok("verdict: tradable OC passes; CO, NT, missing, delisting, non-standard and adjusted fail", () => {
  const t = { symbol: "AAA", legs: [{ side: "BUY", type: "CALL", strike: 100, expiry: "2027-01-15" }] };
  assert.equal(contractVerdict(t, [row(OCC)]).ok, true);
  assert.equal(contractVerdict(t, [row(OCC)]).ppind, true);
  assert.equal(contractVerdict(t, [row(OCC, { ppind: false })]).ppind, false);
  assert.equal(contractVerdict(t, [row(OCC, { tradable_status: "CO" })]).reason, "closing orders only");
  assert.equal(contractVerdict(t, [row(OCC, { tradable_status: "NT" })]).reason, "not tradable");
  assert.equal(contractVerdict(t, []).reason, "contract not listed");
  assert.equal(contractVerdict(t, [row(OCC, { status: "DELISTING" })]).reason, "being delisted");
  assert.equal(contractVerdict(t, [row(OCC, { def_type: "FLEX" })]).reason, "non-standard contract");
  assert.equal(contractVerdict(t, [row(OCC, { multiplier: "106" })]).reason, "adjusted contract (not 100 shares)");
  // An adjusted root still matches on its fields.
  assert.ok(matchLeg("AAA", t.legs[0], [row("AAA1270115C00100000", { underlying_symbol: "AAA" })]));
  assert.equal(legProblem(null), "contract not listed");
  assert.deepEqual(parseContractList({ data: [row(OCC)], pagination_key: "k" }).next, "k");
});
await ok("price step: Penny Pilot keeps the old rule; standard classes step $0.05 / $0.10; spreads $0.01", () => {
  assert.equal(optionTick(2.5, { ppind: true }), 0.01); assert.equal(optionTick(3, { ppind: true }), 0.05);
  assert.equal(optionTick(2.5, { ppind: false }), 0.05); assert.equal(optionTick(3, { ppind: false }), 0.10);
  assert.equal(optionTick(2.5), 0.01); assert.equal(optionTick(9, { ppind: false, spread: true }), 0.01);
  assert.equal(roundTick(3.07, { ppind: false }), 3.1); assert.equal(roundTick(3.07), 3.05); assert.equal(roundTick(2.03, { ppind: false }), 2.05);
  assert.equal(roundTick(2.03, { nickel: true }), 2.05);
  const base = { structure: "long", legs: [{}], engineEntryPrice: 4.02 };
  const q = { bid: 4.0, ask: 4.2 };
  assert.equal(executionPrice(base, { phase: "entry", stage: 0, quote: q }).limit, 4.1, "unknown flag: the old nickel at $3+");
  assert.equal(executionPrice({ ...base, contractCheck: { ppind: true } }, { phase: "entry", stage: 0, quote: q }).limit, 4.1);
  assert.equal(executionPrice({ ...base, contractCheck: { ppind: false } }, { phase: "entry", stage: 0, quote: q }).limit, 4.1, "dime floor of 4.10");
  assert.equal(executionPrice({ ...base, engineEntryPrice: 2.02, contractCheck: { ppind: false } }, { phase: "entry", stage: 0, quote: { bid: 2.0, ask: 2.2 } }).limit, 2.05);
  assert.equal(executionPrice({ ...base, engineEntryPrice: 2.02 }, { phase: "entry", stage: 0, quote: { bid: 2.0, ask: 2.2 } }).limit, 2.06, "penny rule unchanged");
});
await ok("checker: one batched lookup, a field lookup for a missed symbol, unknown on error", async () => {
  const wb = fakeWebull({ contracts: { [OCC]: row(OCC), BBB270115C00100000: row("BBB270115C00100000", { tradable_status: "NT" }) } });
  const cc = makeContractCheck(wb);
  const tA = { symbol: "AAA", legs: [{ type: "CALL", strike: 100, expiry: "2027-01-15" }] }, tB = { ...tA, symbol: "BBB" }, tC = { ...tA, symbol: "CCC" };
  await cc.prefetch([tA, tB, tC]);
  assert.equal(wb.listCalls.length, 1); assert.equal(wb.listCalls[0].option_symbols.split(",").length, 3);
  assert.equal((await cc.check(tA)).ok, true);
  assert.equal((await cc.check(tB)).reason, "not tradable");
  const c = await cc.check(tC);
  assert.equal(c.reason, "contract not listed"); assert.equal(wb.listCalls.length, 2, "one field lookup for the missing symbol");
  assert.equal(wb.listCalls[1].underlying_symbols, "CCC"); assert.equal(wb.listCalls[1].start_date, "2027-01-15");
  const bad = makeContractCheck(fakeWebull({ listError: Object.assign(new Error("x"), { status: 403 }) }));
  assert.equal((await bad.check(tA)).ok, null, "an unreadable list is unknown, never a miss");
  assert.equal(bad.stats().denied, true);
  const capped = makeContractCheck(fakeWebull({ contracts: {} }), { maxCalls: 1 });
  assert.equal((await capped.check(tC)).ok, null, "out of calls is unknown, never a miss");
});

// --- 2. Contract check inside the mirror ---------------------------------------------
await ok("mirror: a contract Webull does not list gets no order and a labeled miss", async () => {
  const wb = fakeWebull({ contracts: {} });
  const { ledger, summary } = await run({ client: wb, acc: { builtAtIso: BUILT, open: [flag("AAA")], closed: [] }, ledger: ledger0(), contractCheck: makeContractCheck(wb) });
  const t = Object.values(ledger.trades)[0];
  assert.equal(wb.placed.length, 0); assert.equal(t.state, "missed");
  assert.ok(t.note.startsWith(NOT_TRADABLE_PREFIX), t.note);
  assert.ok(t.labels.some((l) => l.includes("Not tradable at Webull")));
  assert.equal(t.contractCheck.ok, false);
  assert.equal(summary.webullData["not tradable at Webull - contract not listed"], 1);
  assert.equal(ledgerToFillRows(ledger)[0].webull_contract_check, "not tradable: contract not listed");
  // The end-of-day window never revives it.
  const eod = Date.parse("2026-11-19T20:52:00Z");
  const again = await run({ client: wb, acc: { builtAtIso: BUILT, open: [flag("AAA")], closed: [] }, ledger, nowMs: eod, contractCheck: makeContractCheck(wb) });
  assert.equal(wb.placed.length, 0); assert.equal(Object.values(again.ledger.trades)[0].state, "missed");
});
await ok("mirror: a listed contract is bought, flag stored, step used on the limit", async () => {
  const wb = fakeWebull({ contracts: { [OCC]: row(OCC, { ppind: false }) } });
  const { ledger, summary } = await run({ client: wb, acc: { builtAtIso: BUILT, open: [flag("AAA", { contract: { structure: "long", strike: 100, expiry: EXP, mid: 3.07 } })], closed: [] }, ledger: ledger0(), contractCheck: makeContractCheck(wb) });
  const t = Object.values(ledger.trades)[0];
  assert.equal(wb.placed.length, 1); assert.equal(t.contractCheck.ppind, false);
  assert.equal(Number(wb.placed[0].limit_price) * 100 % 10, 0, `dime step: ${wb.placed[0].limit_price}`);
  assert.equal(summary.webullData["contract checked - standard price step"], 1);
  assert.equal(ledgerToTestTrades(ledger)[0].contractCheck.ppind, false);
});
await ok("mirror: an unreadable contract list sends the order as before, with a warning", async () => {
  const wb = fakeWebull({ listError: Object.assign(new Error("boom"), { status: 500 }) });
  const { ledger, summary } = await run({ client: wb, acc: { builtAtIso: BUILT, open: [flag("AAA")], closed: [] }, ledger: ledger0(), contractCheck: makeContractCheck(wb) });
  assert.equal(wb.placed.length, 1); assert.equal(Object.values(ledger.trades)[0].contractCheck, undefined);
  assert.equal(summary.warnings["contract list unavailable - contract not checked"], 1);
});
await ok("mirror: switch off (no checker) never calls the contract list", async () => {
  const wb = fakeWebull({ contracts: {} });
  await run({ client: wb, acc: { builtAtIso: BUILT, open: [flag("AAA")], closed: [] }, ledger: ledger0() });
  assert.equal(wb.listCalls.length, 0); assert.equal(wb.placed.length, 1);
});

// --- 3. Stock quotes -----------------------------------------------------------------
const NOW = Date.parse("2026-11-19T16:10:00Z");
const fresh = { symbol: "AAA", bid: "99.98", ask: "100.02", price: "100", last_trade_time: NOW - 5000 };
await ok("stock quote: fresh Webull wins; stale, failed or out-of-band falls back to Yahoo", () => {
  const w = snapshotQuote(fresh), y = { bid: 99.9, ask: 100.1, spot: 100 };
  assert.equal(chooseStockQuote(w, y, { nowMs: NOW }).source, WEBULL_STOCK_SOURCE);
  assert.equal(chooseStockQuote(w, null, { nowMs: NOW }).source, WEBULL_STOCK_SOURCE, "Yahoo down: Webull alone");
  assert.equal(chooseStockQuote(snapshotQuote({ ...fresh, last_trade_time: NOW - 10 * 60000 }), y, { nowMs: NOW }).fallbackWhy, "Webull quote stale");
  assert.equal(chooseStockQuote(null, y, { nowMs: NOW }).fallbackWhy, "Webull quote unavailable");
  const off = snapshotQuote({ ...fresh, bid: "103", ask: "103.1" });
  assert.match(chooseStockQuote(off, y, { nowMs: NOW, bandPct: BAND }).fallbackWhy, /differ over/);
  assert.equal(chooseStockQuote(null, null, { nowMs: NOW }), null);
  assert.equal(snapshotQuote({ ...fresh, bid: "101", ask: "100" }), null, "crossed quote is no quote");
  assert.equal(snapshotQuote({ ...fresh, bid: "0" }), null);
  assert.equal(snapshotRow([fresh], "aaa").symbol, "AAA");
});
await ok("stock fetcher: one call per symbol, ETF retried under US_ETF, source labels reach the attempt", async () => {
  const wb = fakeWebull({ snapshots: { "AAA|US_STOCK": fresh, "TLT|US_ETF": { ...fresh, symbol: "TLT", bid: "88.00", ask: "88.02" } } });
  const events = {};
  const yahoo = async (s) => (s === "TLT" ? { bid: 87.99, ask: 88.03, spot: 88 } : { bid: 99.97, ask: 100.03, spot: 100 });
  const f = makeWebullStockFetcher(wb, yahoo, { nowMs: () => NOW, onEvent: (k) => { events[k] = (events[k] || 0) + 1; } });
  const qf = makeQuoteFn(async () => null, f);
  const a = await qf({ structure: "shares", symbol: "AAA", legs: [] });
  assert.equal(a.source, WEBULL_STOCK_SOURCE); assert.equal(a.bid, 99.98);
  await qf({ structure: "shares", symbol: "AAA", legs: [] });
  const tlt = await qf({ structure: "shares", symbol: "TLT", legs: [] });
  assert.equal(tlt.bid, 88);
  assert.deepEqual(wb.snapCalls, [["AAA", "US_STOCK"], ["TLT", "US_STOCK"], ["TLT", "US_ETF"]]);
  assert.equal(events["share order priced off Webull"], 2);
  const down = makeQuoteFn(async () => null, makeWebullStockFetcher(fakeWebull({ snapshots: { "AAA|US_STOCK": new Error("down") } }), yahoo, { nowMs: () => NOW }));
  const y = await down({ structure: "shares", symbol: "AAA", legs: [] });
  assert.equal(y.source, "Yahoo stock quote (Webull quote unavailable)"); assert.equal(y.bid, 99.97);
});

// --- 4. Real fees -----------------------------------------------------------------------
const histOrder = (coid, o = {}) => ({ client_order_id: coid, order_id: "9" + coid.length, status: "FILLED", filled_quantity: "2", filled_price: "4.10", filled_time_at: "2026-11-19T16:12:00.000Z",
  commission: { actual_commission: "1.30", receivable_commission: "1.30" }, fees: [{ type: "FINRA_CAT_REGULATORY_FEE", actual_value: "0.02", receivable_value: "0.02" }], ...o });
await ok("history: commission + fees per order, the order-detail fields; unknown stays unknown", () => {
  const { orders, next } = parseOrderHistory({ data: [{ combo_type: "NORMAL", client_order_id: "c1", orders: [histOrder("c1")] }, { combo_type: "NORMAL", orders: [histOrder("c2", { commission: undefined })] }], pagination_key: "p2" });
  assert.equal(next, "p2"); assert.equal(orders.length, 2);
  assert.equal(orders[0].feeActual, 1.32); assert.deepEqual(orders[0].feeLines.map((f) => f.type), ["COMMISSION", "FINRA_CAT_REGULATORY_FEE"]);
  assert.equal(orders[1].feeActual, null, "no commission object: not a known fee");
  assert.equal(parseOrderDetail(histOrder("c1")).feeActual, 1.32, "same parser as order detail");
  assert.deepEqual(historyShape({ data: [{ orders: [histOrder("c1")] }] }).commission, ["actual_commission", "receivable_commission"]);
});
const tradeWith = (attempts) => { const t = { tradeId: "X", symbol: "AAA", side: "call", structure: "long", legs: [{ side: "BUY", type: "CALL", strike: 100, expiry: "2027-01-15" }], engineEntryPrice: 4,
  state: "open", requestedQty: 2, entryAttempts: attempts, exitAttempts: [], labels: [] }; updateQuantities(t); return t; };
await ok("apply: fills only missing real fees, same fill only; t.fees moves from estimate to real", () => {
  const t = tradeWith([{ phase: "entry", n: 1, clientOrderId: "c1", quantity: 2, filledQty: 2, status: "FILLED", filledPrice: 4.1, filledIso: "2026-11-19T16:12:00.000Z", sentIso: "2026-11-19T16:11:00.000Z", feeEst: 0.65 }]);
  const L = { trades: { X: t } };
  assert.equal(t.fees, 0.65); assert.deepEqual(feeBreakdown(t), { actual: null, estimated: 0.65, basis: "estimate", realOrders: 0, orders: 1 });
  assert.equal(attemptsNeedingFees(L, T0).length, 1);
  assert.equal(applyHistoryFees(L, [{ clientOrderId: "c1", filledQty: 1, feeActual: 9 }]), 0, "a different fill size is not applied");
  assert.equal(applyHistoryFees(L, parseOrderHistory({ data: [{ orders: [histOrder("c1")] }] }).orders), 1);
  assert.equal(t.fees, 1.32); assert.equal(t.entryAttempts[0].feeSource, "order-history");
  assert.deepEqual(feeBreakdown(t), { actual: 1.32, estimated: 0.65, basis: "actual", realOrders: 1, orders: 1 });
  assert.equal(applyHistoryFees(L, [{ clientOrderId: "c1", filledQty: 2, feeActual: 5 }]), 0, "a known real fee is never replaced");
  assert.equal(attemptsNeedingFees(L, T0).length, 0);
  const rows = ledgerToFillRows(L);
  assert.equal(rows[0].fees_actual, 1.32); assert.equal(rows[0].fees_estimated, 0.65); assert.equal(rows[0].fee_basis, "actual");
  assert.match(fillRowsToCsv(rows).split("\n")[0], /fees_actual,fees_estimated,fee_basis,webull_contract_check/);
  assert.match(orderAttemptsToCsv(L), /order-history/);
  assert.equal(ledgerToTestTrades(L)[0].attempts[0].feeSource, "order-history");
});
await ok("sweep: no call without a need; one window read; errors never throw; old orders are left", async () => {
  const idle = fakeWebull({ history: { data: [] } });
  assert.equal((await backfillFees({ client: idle, accountId: "PAPER1", ledger: { trades: {} }, nowMs: T0 })).calls, 0);
  assert.equal(idle.historyCalls.length, 0);
  const t = tradeWith([{ phase: "entry", n: 1, clientOrderId: "c1", quantity: 2, filledQty: 2, status: "FILLED", filledPrice: 4.1, sentIso: "2026-11-18T16:11:00.000Z", feeEst: 0.65 }]);
  const L = { trades: { X: t } };
  const wb = fakeWebull({ history: { data: [{ orders: [histOrder("c1")] }] } });
  const r = await backfillFees({ client: wb, accountId: "PAPER1", ledger: L, nowMs: T0 });
  assert.deepEqual([r.calls, r.applied, r.error], [1, 1, null]);
  assert.equal(wb.historyCalls[0].start_time, "2026-11-17T16:11:00.000Z", "from a day before the oldest unfilled fee");
  assert.ok(L.orderHistoryShape.order.includes("commission"));
  const t2 = tradeWith([{ phase: "entry", n: 1, clientOrderId: "c9", quantity: 1, filledQty: 1, status: "FILLED", filledPrice: 4.1, sentIso: "2026-11-18T16:11:00.000Z" }]);
  const fail = await backfillFees({ client: fakeWebull({ history: Object.assign(new Error("x"), { status: 403 }) }), accountId: "PAPER1", ledger: { trades: { Y: t2 } }, nowMs: T0 });
  assert.equal(fail.error, "HTTP 403"); assert.equal(fail.applied, 0);
  const old = tradeWith([{ phase: "entry", n: 1, clientOrderId: "c8", quantity: 1, filledQty: 1, status: "FILLED", sentIso: "2026-11-01T16:11:00.000Z" }]);
  assert.equal(attemptsNeedingFees({ trades: { Z: old } }, T0).length, 0, "past the 7-day window");
  await assert.rejects(backfillFees({ client: wb, accountId: "PAPER1", ledger: { trades: { Y: t2 } }, nowMs: T0, check: () => { throw Object.assign(new Error("lease"), { code: "LEASE_EXPIRED" }); } }));
});

// --- 5. Client paths and switches ------------------------------------------------------
await ok("client: the documented paths and query names, sandbox host, signed", async () => {
  const seen = [];
  const c = createWebullClient({ appKey: "k", appSecret: "s", fetchImpl: async (url, init) => { seen.push([init.method, url, init.headers["x-signature"] ? "signed" : ""]); return { ok: true, status: 200, text: async () => "[]" }; } });
  await c.optionContracts({ category: "US_OPTION", option_symbols: "A,B", status: null });
  await c.stockSnapshots(["AAA"], "US_ETF");
  await c.orderHistory("ACC", { start_time: "2026-11-18T00:00:00.000Z", pagination_key: null });
  assert.deepEqual(seen.map((s) => s[0]), ["GET", "GET", "GET"]);
  assert.equal(seen[0][1], "https://api.sandbox.webull.com/trading/instruments/options/contracts/list?category=US_OPTION&option_symbols=A%2CB");
  assert.equal(seen[1][1], "https://api.sandbox.webull.com/market-data/stocks/snapshots/list?symbols=AAA&category=US_ETF");
  assert.equal(seen[2][1], "https://api.sandbox.webull.com/trading/orders/historical-orders/list?start_time=2026-11-18T00%3A00%3A00.000Z&account_id=ACC");
  assert.ok(seen.every((s) => s[2] === "signed"));
});
await ok("switches: three Live site switches, on by default, off maps to 0", () => {
  for (const k of ["WEBULL_CONTRACT_CHECK", "WEBULL_REAL_FEES", "WEBULL_STOCK_QUOTES"]) {
    const d = ownerSettingDef(k);
    assert.ok(d, k); assert.equal(d.scope, "site"); assert.equal(d.default, true);
    assert.equal(runtimeEnvOverrides(Buffer.from(JSON.stringify({ values: { [k]: false } })))[k], "0");
  }
});

console.log(`Webull data in the mirror: ${passed} checks passed${failed ? `, ${failed} failed` : ""} (option $${PX}, stock band ${BAND}%).`);
