#!/usr/bin/env node
// Webull paper mirror: quantities and share orders (2026-11-19).
//   node scripts/webull-shares-smoke.mjs        (also run by npm run test:webull-mirror)
// Settings for reruns under other assumptions (env, all optional):
//   WB_RISK_USD   Top Picks risk budget (default 2000)
//   WB_PRICE      option mid of the test trades (default 4)
//   WB_STOCK      stock price of the share trades (default 150)
//   WB_SPREAD     stock bid/ask half-spread in dollars (default 0.05)
// Every scenario uses a fake Webull (no network, no store, never a real or
// paper order) that keeps option and stock positions from its own fills.
import assert from "node:assert/strict";
import {
  runWebullMirror as runActual, mergeEngineTrades, picksRiskQty, mirrorQty, buildOrder, newTrade, fillOutcome,
  ledgerToTestTrades, ledgerToFillRows, fillRowsToCsv, makeQuoteFn, isStockTrade, positionText,
  LIVE_SIZING, DEFAULT_SIZING, MIRROR_MAX_QTY, describeKindCounts,
} from "../lib/webull-mirror.mjs";
import { executionPrice } from "../lib/webull-execution-policy.mjs";
import { reconcilePositions, parsePositions, expectedEquities } from "../lib/webull-reconciliation.mjs";
import { mirrorHealth } from "../lib/webull-mirror-health.mjs";
import { fillPnlPct } from "../lib/track-record-fills.mjs";
import { webullAnalyticsFactory } from "../lib/webull-analytics.mjs";
import { ENGINES } from "../lib/engines/config.mjs";
import { pickTradeId } from "../lib/pick-trade-text.mjs";

const RISK = Number(process.env.WB_RISK_USD || 2000);
const PX = Number(process.env.WB_PRICE || 4);
const STOCK = Number(process.env.WB_STOCK || 150);
const HALF = Number(process.env.WB_SPREAD || 0.05);

let passed = 0, failed = 0;
const ok = async (name, fn) => { try { await fn(); passed++; } catch (err) { failed++; console.error(`FAIL ${name}\n  ${err?.stack || err}`); process.exitCode = 1; } };
const r2 = (v) => Math.round(v * 100) / 100;

// Fake Webull: options keyed by contract, stock by symbol, from cumulative fills.
function fakeWebull() {
  const orders = new Map(), placed = [], cancelled = [];
  return {
    orders, placed, cancelled, extraStock: {},
    accountList: async () => [{ account_id: "PAPER1" }],
    positions: async function () {
      const opt = new Map(), eq = new Map(Object.entries(this.extraStock));
      for (const o of orders.values()) {
        const qty = Number(o.filled_quantity || 0);
        if (!qty) continue;
        if (o.body.instrument_type === "EQUITY") { eq.set(o.body.symbol, (eq.get(o.body.symbol) || 0) + (o.body.side === "BUY" ? qty : -qty)); continue; }
        for (const l of o.body.legs) {
          const key = [l.symbol, l.option_expire_date, l.option_type, l.strike_price].join("|");
          const prior = opt.get(key) || { instrument_type: "OPTION", symbol: l.symbol, quantity: 0, legs: [{ ...l, quantity: 0 }] };
          prior.legs[0].quantity += (l.side === "BUY" ? qty : -qty);
          prior.quantity = prior.legs[0].quantity; delete prior.legs[0].side;
          opt.set(key, prior);
        }
      }
      return [...[...opt.values()].filter((p) => p.quantity),
        ...[...eq.entries()].filter(([, q]) => q).map(([symbol, q]) => ({ instrument_type: "EQUITY", symbol, quantity: String(q) }))];
    },
    previewOrder: async () => ({ estimated_transaction_fee: "0.50" }),
    placeOrder: async (acct, list) => {
      const o = list[0];
      if (orders.has(o.client_order_id)) throw new Error("duplicate client_order_id");
      orders.set(o.client_order_id, { status: "SUBMITTED", body: o });
      placed.push(o);
      return { client_order_id: o.client_order_id };
    },
    orderDetail: async (acct, id) => {
      const o = orders.get(id);
      if (!o) throw new Error("not found");
      return { orders: [{ client_order_id: id, status: o.status, filled_price: o.filled_price ?? null, filled_quantity: o.filled_quantity || "0", filled_time_at: o.filled_time_at ?? null }] };
    },
    cancelOrder: async (acct, id) => {
      const o = orders.get(id);
      if (!o || o.status === "FILLED") throw new Error("cannot cancel");
      o.status = "CANCELLED"; cancelled.push(id);
      return {};
    },
    fill(id, price, qty = null) {
      const o = orders.get(id); o.filled_quantity = String(qty ?? o.body.quantity);
      o.status = Number(o.filled_quantity) === Number(o.body.quantity) ? "FILLED" : "PARTIAL_FILLED";
      o.filled_price = String(price); o.filled_time_at = "2026-11-19T16:12:00.000Z";
    },
    fillOpen(price = null) { for (const [id, o] of orders) if (o.status === "SUBMITTED") this.fill(id, price ?? Number(o.body.limit_price)); },
  };
}

const EXP = Date.UTC(2027, 0, 15) / 1000;                 // Fri Jan 15 2027 (57 days out)
const EXP_NEAR = Date.UTC(2026, 11, 4) / 1000;           // Fri Dec 4 2026 (15 days out)
const T0 = Date.parse("2026-11-19T16:10:00Z");           // Thu 11:10 ET, regular session
const MIN = 60000, H = 60 * MIN;
const BUILT = "2026-11-19T16:02:00.000Z", ENTRY = "2026-11-19T16:00:00.000Z";
const accOf = (open = [], closed = [], builtAtIso = BUILT) => ({ builtAtIso, open, closed });
const engOf = (open = [], closed = [], builtAtIso = BUILT) => ({ version: 1, builtAtIso, open, closed });
const flag = (symbol, o = {}) => ({ symbol, side: "call", entryDate: ENTRY, exitPolicy: { version: "2026-10-22-tp25", takeProfitPct: 25, stopPct: -50 },
  contract: { structure: "long", strike: 100, expiry: EXP, mid: PX }, ...o });
const eng = (engine, symbol, o = {}) => ({ engine, tag: ENGINES[engine].tag, tradeId: `${ENGINES[engine].tag}:${symbol}-C-11/19/26-11:00`, symbol, side: "call", entryDate: ENTRY,
  contract: { structure: "long", optionType: "call", strike: 100, expiry: EXP, mid: PX }, optionPnlPct: 0, ...o });
const shr = (engine, symbol, shares, o = {}) => eng(engine, symbol, { tradeId: `${ENGINES[engine].tag}:${symbol}-S-11/19/26-11:00`,
  contract: { structure: "shares", optionType: "call", shares, mid: STOCK, usd: Math.round(shares * STOCK), costPct: 0.1 }, ...o });
const closedRow = (e, o = {}) => ({ ...e, status: "rotate", exitDate: "2026-11-20T16:00:00.000Z", optionPnlPct: 2, ...o });
const quote = async (t) => isStockTrade(t)
  ? { bid: r2((t.engineExitPrice || t.engineEntryPrice) - HALF), ask: r2((t.engineExitPrice || t.engineEntryPrice) + HALF), spot: t.engineEntryPrice }
  : { bid: t.engineExitPrice || t.engineEntryPrice, ask: t.engineExitPrice || t.engineEntryPrice };
const run = (args) => runActual({ clock: () => 0, quoteFn: quote, sizing: { ...LIVE_SIZING, riskUsd: RISK }, ...args });
const live = (o = {}) => ({ ...LIVE_SIZING, riskUsd: RISK, ...o });
const noShort = (wb) => wb.placed.every((o) => o.side !== "SHORT" && (o.instrument_type !== "EQUITY" || ["BUY", "SELL"].includes(o.side)));

// --- 1. Sizing rules ----------------------------------------------------------------
await ok("risk sizing: a Top Pick longer than a month risks premium x stop x 1.25", () => {
  const per = PX * 100 * 0.5 * 1.25;
  const r = picksRiskQty(flag("AAA"), RISK);
  assert.equal(r.riskPerContract, r2(per));
  assert.equal(r.qty, Math.min(MIRROR_MAX_QTY, Math.max(1, Math.floor(RISK / per))));
});
await ok("risk sizing: under a month the whole premium is at risk", () => {
  const r = picksRiskQty(flag("AAA", { contract: { structure: "long", strike: 100, expiry: EXP_NEAR, mid: PX } }), RISK);
  assert.equal(r.riskPerContract, PX * 100);
  assert.equal(r.qty, Math.min(MIRROR_MAX_QTY, Math.max(1, Math.floor(RISK / (PX * 100)))));
});
await ok("risk sizing: a cheap contract is capped at 10, a dear one is still bought once", () => {
  assert.equal(picksRiskQty(flag("AAA", { contract: { structure: "long", strike: 100, expiry: EXP, mid: 0.4 } }), 2000).qty, 10);
  assert.equal(picksRiskQty(flag("AAA", { contract: { structure: "long", strike: 100, expiry: EXP, mid: 45 } }), 2000).qty, 1);
  assert.equal(picksRiskQty(flag("AAA"), 0).qty, 1);
  assert.equal(picksRiskQty(flag("AAA", { contract: { structure: "long", strike: 100, mid: PX } }), 2000).riskPerContract, PX * 100, "unknown expiry = whole premium");
});
await ok("risk sizing: a credit spread risks its width less the credit", () => {
  const cs = flag("AAA", { side: "put", contract: { structure: "credit_vertical", optionType: "put", expiry: EXP, netCredit: 1.2, legs: [{ strike: 240, qty: -1 }, { strike: 235, qty: 1 }] } });
  const r = picksRiskQty(cs, 2000);
  assert.equal(r.riskPerContract, 380); assert.equal(r.qty, 5);
  const bad = flag("AAA", { contract: { structure: "credit_vertical", netCredit: 6, legs: [{ strike: 240, qty: -1 }, { strike: 235, qty: 1 }] } });
  assert.equal(picksRiskQty(bad, 2000).qty, 1, "a credit wider than the spread is not sized");
});
await ok("mirrorQty: engine qty, cap, missing qty, switches, shares", () => {
  assert.deepEqual(mirrorQty(eng("flow", "A", { contract: { structure: "long", mid: 2, qty: 3 } }), live()).qty, 3);
  const capped = mirrorQty(eng("flow", "A", { contract: { structure: "long", mid: 0.4, qty: 50 } }), live());
  assert.equal(capped.qty, 10); assert.equal(capped.basis, "record-capped"); assert.equal(capped.recordQty, 50);
  assert.equal(mirrorQty(eng("flow", "A"), live()).qty, 1, "an old trade without qty is one contract");
  assert.equal(mirrorQty(eng("flow", "A", { contract: { structure: "long", mid: 2, qty: 3 } }), live({ quantities: false })).qty, 1);
  assert.equal(mirrorQty(flag("A"), live({ picksSizing: false })).qty, 1);
  assert.equal(mirrorQty(flag("A"), live({ quantities: false })).qty, 1, "quantities off overrides Top Picks sizing");
  assert.equal(mirrorQty(flag("A"), live()).basis, "risk");
  assert.equal(mirrorQty(shr("technicals", "S", 33), live()).qty, 33);
  assert.equal(mirrorQty(shr("technicals", "S", 33), live({ quantities: false })).qty, 33, "shares are the trade itself");
  assert.equal(mirrorQty(shr("technicals", "S", 0), live()).qty, null);
  assert.equal(mirrorQty(flag("A")).qty, 1, "no sizing passed = the old one-contract path");
  assert.deepEqual({ ...DEFAULT_SIZING, riskUsd: 0 }, { quantities: false, picksSizing: false, shares: false, riskUsd: 0 });
});

// --- 2. Stock order body and prices ----------------------------------------------------
await ok("stock order: the fields of Webull's stock limit order, long only", () => {
  const t = newTrade(shr("technicals", "AAPL", 20), "TEC:AAPL-S-11/19/26-11:00", live());
  assert.equal(t.instrument, "stock"); assert.deepEqual(t.legs, []); assert.equal(t.requestedQty, 20);
  const buy = buildOrder(t, "entry", 180.123, "id1", 20);
  assert.deepEqual(buy, { client_order_id: "id1", combo_type: "NORMAL", symbol: "AAPL", instrument_type: "EQUITY", market: "US", order_type: "LIMIT",
    limit_price: "180.12", quantity: "20", side: "BUY", time_in_force: "DAY", support_trading_session: "CORE", entrust_type: "QTY" });
  assert.equal(buildOrder(t, "exit", 181, "id2", 5).side, "SELL");
  assert.equal(positionText(t), "20 shares");
  assert.throws(() => buildOrder(t, "entry", 180, "id3", 0));
});
await ok("stock prices: penny ticks, the 2% / 4% / 5% ladder, a 5%-under-the-bid emergency sell", () => {
  const t = { structure: "shares", legs: [], engineEntryPrice: 100, engineExitPrice: 110 };
  const q = { bid: 100.1, ask: 100.3 };
  const e0 = executionPrice(t, { phase: "entry", stage: 0, quote: q });
  assert.equal(e0.limit, 100.3); assert.equal(e0.allowancePct, 2);
  const far = executionPrice(t, { phase: "entry", stage: 0, quote: { bid: 104, ask: 104.2 } });
  assert.equal(far.limit, 102, "the 2% cap binds, in pennies (an option over $3 would round to a nickel)");
  assert.equal(executionPrice(t, { phase: "entry", stage: "eod-entry", quote: { bid: 104, ask: 104.2 } }).limit, 104.2);
  const x = executionPrice(t, { phase: "exit", stage: 0, quote: { bid: 109.5, ask: 109.7 } });
  assert.equal(x.limit, 109.5); assert.equal(x.buying, false);
  assert.equal(executionPrice(t, { phase: "exit", stage: 0, emergency: true, quote: { bid: 109.5, ask: 109.7 } }).limit, 104.02);
  assert.equal(executionPrice(t, { phase: "exit", stage: 0, emergency: true, quote: { bid: 0, ask: 109.7 } }), null, "no bid, no emergency sell");
});
await ok("stock quote: the stock's own bid/ask; a 0 / 0 quote sends nothing", async () => {
  let calls = 0;
  const qf = makeQuoteFn(async () => { throw new Error("no option call for shares"); }, async (s) => { calls++; return s === "ZZZ" ? { bid: 0, ask: 0, spot: 5 } : { bid: 99.9, ask: 100.1, spot: 100, quoteAsOf: "2026-11-19T16:09:00Z" }; });
  const q = await qf({ structure: "shares", symbol: "AAA", legs: [] });
  assert.equal(q.bid, 99.9); assert.equal(q.source, "Yahoo stock quote");
  await qf({ structure: "shares", symbol: "AAA", legs: [] });
  assert.equal(calls, 1, "one Yahoo call per symbol per run");
  assert.equal(await qf({ structure: "shares", symbol: "ZZZ", legs: [] }), null);
  assert.equal(await makeQuoteFn(async () => null)({ structure: "shares", symbol: "AAA", legs: [] }), null, "no stock fetcher, no quote");
});

// --- 3. Merge and go-live ----------------------------------------------------------
await ok("merge: share trades join only with share orders on; known ones always", () => {
  const s = shr("technicals", "SSS", 30), o = eng("technicals", "OOO");
  assert.deepEqual(mergeEngineTrades(accOf(), engOf([s, o]), null, { shares: true }).open.map((e) => e.symbol), ["SSS", "OOO"]);
  assert.deepEqual(mergeEngineTrades(accOf(), engOf([s, o]), null, { shares: false }).open.map((e) => e.symbol), ["OOO"]);
  const known = { trades: { [s.tradeId]: { tradeId: s.tradeId } } };
  assert.deepEqual(mergeEngineTrades(accOf(), engOf([s, o]), known, { shares: false }).open.map((e) => e.symbol), ["SSS", "OOO"]);
  assert.deepEqual(mergeEngineTrades(accOf(), engOf([s, o]), known, { shares: true, mirrorNew: false }).open.map((e) => e.symbol), ["SSS"]);
});
await ok("go-live: share trades opened before share orders went live are never bought late", async () => {
  const wb = fakeWebull();
  const old = shr("momentum", "OLD", 20, { tradeId: "MOM:OLD-S-11/17/26-11:00", entryDate: "2026-11-17T16:00:00.000Z" });
  const now = shr("momentum", "NEW", 20);
  const ledger0 = { version: 2, goLiveIso: "2026-11-01T14:00:00.000Z", accountId: "PAPER1", trades: {}, runs: [] };
  const { ledger } = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([old, now]), ledger0, { shares: true }), ledger: ledger0, nowMs: T0 });
  assert.ok(!ledger.trades[old.tradeId], "pre-cutoff holding stays on the engine record only");
  assert.ok(ledger.trades[now.tradeId]); assert.equal(wb.placed.length, 1); assert.equal(wb.placed[0].symbol, "NEW");
  assert.ok(Date.parse(ledger.sharesGoLiveIso) <= Date.parse(ENTRY));
});

// --- 4. End to end -----------------------------------------------------------------
await ok("shares: an engine share trade is bought as stock, held, reconciled and sold whole", async () => {
  const wb = fakeWebull();
  const s = shr("technicals", "SHR", 40);
  let { ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([s]), null, { shares: true }), ledger: null, nowMs: T0 });
  assert.equal(summary.placed, 1);
  const o = wb.placed[0];
  assert.equal(o.instrument_type, "EQUITY"); assert.equal(o.side, "BUY"); assert.equal(o.quantity, "40"); assert.equal(o.legs, undefined);
  assert.ok(/^mstec[0-9a-f]+$/.test(o.client_order_id), "engine-tagged order id");
  wb.fillOpen();
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([s]), ledger, { shares: true }), ledger, nowMs: T0 + 3 * MIN }));
  const t = ledger.trades[s.tradeId];
  assert.equal(t.state, "open"); assert.equal(t.openQty, 40); assert.equal(fillOutcome(t), "filled");
  assert.equal(ledger.reconciliation.status, "matched", JSON.stringify(ledger.reconciliation.alerts));
  // The engine closes it: SELL the 40 shares, never more.
  const er = engOf([], [closedRow(s, { optionPnlPct: 3 })], "2026-11-20T16:02:00.000Z");
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf([], [], "2026-11-20T16:02:00.000Z"), er, ledger, { shares: true }), ledger, nowMs: T0 + 24 * H }));
  const sell = wb.placed[1];
  assert.equal(sell.side, "SELL"); assert.equal(sell.quantity, "40"); assert.equal(sell.instrument_type, "EQUITY");
  wb.fillOpen();
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf([], [], "2026-11-20T16:02:00.000Z"), er, ledger, { shares: true }), ledger, nowMs: T0 + 24 * H + 3 * MIN }));
  const done = ledger.trades[s.tradeId];
  assert.equal(done.state, "closed"); assert.equal(done.openQty, 0); assert.ok(done.paperPnlPct != null);
  assert.equal(ledger.reconciliation.status, "matched");
  assert.ok(noShort(wb));
  const tt = ledgerToTestTrades(ledger)[0];
  assert.equal(tt.instrument, "stock"); assert.equal(tt.fillOutcome, "filled"); assert.equal(tt.legs, "40 shares");
});
// A quote that has moved up `bump` (fraction) since the engine's price, so a
// working order below the ask is replaced (the ladder's real trigger).
const movedQuote = (bump) => async (t) => {
  const ref = t.engineExitPrice || t.engineEntryPrice, m = r2(ref * (1 + bump));
  return isStockTrade(t) ? { bid: r2(m - HALF), ask: r2(m + HALF), spot: m } : { bid: m, ask: m };
};
const AFTER_CLOSE = Date.parse("2026-11-19T21:05:00Z");    // 16:05 ET, session over
const expireDay = (wb) => { for (const o of wb.orders.values()) if (!["FILLED", "CANCELLED"].includes(o.status)) o.status = "EXPIRED"; };
await ok("shares: a partial stock fill is held, labeled, and only the filled shares are sold", async () => {
  const wb = fakeWebull();
  const s = shr("reversion", "PRT", 50);
  const acc = () => mergeEngineTrades(accOf(), engOf([s]), null, { shares: true });
  let { ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger: null, nowMs: T0 });
  wb.fill(wb.placed[0].client_order_id, Number(wb.placed[0].limit_price), 30);
  // The stock moves 1% up: the first order is cancelled, the rest re-priced.
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger, nowMs: T0 + 3 * MIN, quoteFn: movedQuote(0.01) }));
  assert.equal(wb.placed.length, 2);
  assert.equal(wb.placed[1].quantity, "20", "the replacement asks only for the rest");
  assert.ok(Number(wb.placed[1].limit_price) <= Math.floor(STOCK * 1.04 * 100) / 100, "4% cap");
  expireDay(wb);
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger, nowMs: AFTER_CLOSE }));
  const t = ledger.trades[s.tradeId];
  assert.equal(t.state, "open"); assert.equal(t.openQty, 30); assert.equal(fillOutcome(t), "partial");
  assert.ok(t.labels.some((l) => l === "Partly filled: 30 of 50 shares"), t.labels.join("; "));
  assert.equal(expectedEquities(ledger).PRT, 30);
  const er = engOf([], [closedRow(s)], "2026-11-20T16:02:00.000Z");
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf([], [], "2026-11-20T16:02:00.000Z"), er, ledger, { shares: true }), ledger, nowMs: T0 + 24 * H }));
  assert.equal(ledger.reconciliation.status, "matched", JSON.stringify(ledger.reconciliation.alerts));
  assert.equal(wb.placed.at(-1).side, "SELL"); assert.equal(wb.placed.at(-1).quantity, "30");
  assert.ok(noShort(wb));
});
await ok("shares: a missed stock entry (price ran past the 4% cap) is logged as missed, not a holding", async () => {
  const wb = fakeWebull();
  const s = shr("technicals", "MIS", 10);
  const acc = () => mergeEngineTrades(accOf(), engOf([s]), null, { shares: true });
  const away = movedQuote(0.10);
  let { ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger: null, nowMs: T0, quoteFn: away });
  for (let i = 1; i <= 3; i++) ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger, nowMs: T0 + i * 3 * MIN, quoteFn: away }));
  assert.ok(wb.placed.every((o) => Number(o.limit_price) <= Math.floor(STOCK * 1.04 * 100) / 100), "never chased past 4%");
  expireDay(wb);
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger, nowMs: AFTER_CLOSE, quoteFn: away }));
  const t = ledger.trades[s.tradeId];
  assert.equal(t.state, "missed"); assert.equal(fillOutcome(t), "missed"); assert.equal(t.openQty, 0);
  assert.equal(expectedEquities(ledger).MIS || 0, 0);
});
await ok("core engines: the Trend follower and Momentum basket holdings reach Webull as stock", async () => {
  const wb = fakeWebull();
  const trd = shr("trend", "SPY", 70, { setup: "core" }), mom = shr("momentum", "NVDA", 15, { setup: "core" });
  const { ledger } = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([trd, mom]), null, { shares: true }), ledger: null, nowMs: T0 });
  assert.deepEqual(wb.placed.map((o) => `${o.symbol} ${o.side} ${o.quantity} ${o.instrument_type}`).sort(), ["NVDA BUY 15 EQUITY", "SPY BUY 70 EQUITY"]);
  assert.ok(wb.placed.some((o) => o.client_order_id.startsWith("mstrd")) && wb.placed.some((o) => o.client_order_id.startsWith("msmom")));
  assert.equal(ledger.trades[trd.tradeId].engine, "trend");
});
await ok("shares and options on one symbol: stock holdings = baseline + the mirror's own shares", async () => {
  const wb = fakeWebull();
  wb.extraStock = { AAPL: 100 };                       // held before the mirror (baseline)
  const s = shr("technicals", "AAPL", 20), o = eng("flow", "AAPL", { contract: { structure: "long", optionType: "call", strike: 100, expiry: EXP, mid: PX, qty: 2 } });
  const acc = () => mergeEngineTrades(accOf(), engOf([s, o]), null, { shares: true });
  let { ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger: null, nowMs: T0 });
  assert.equal(ledger.positionBaseline.equities.AAPL, 100);
  wb.fillOpen();
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger, nowMs: T0 + 3 * MIN }));
  assert.equal(ledger.reconciliation.status, "matched", JSON.stringify(ledger.reconciliation.alerts));
  assert.equal(ledger.trades[o.tradeId].openQty, 2);
  // Someone sells 5 AAPL by hand: every trade pauses for review.
  wb.extraStock = { AAPL: 95 };
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger, nowMs: T0 + 6 * MIN }));
  assert.equal(ledger.reconciliation.status, "attention");
  assert.ok(ledger.reconciliation.alerts.some((a) => /AAPL: stock holdings changed/.test(a)));
  assert.ok(ledger.reconciliation.blockedTradeIds.includes(s.tradeId) && ledger.reconciliation.blockedTradeIds.includes(o.tradeId));
});
await ok("old ledger: an existing baseline without share fields reconciles share trades", () => {
  const ledger = { positionBaseline: { capturedAtIso: "2026-10-20T15:00:00Z", options: {}, equities: { MSFT: 10 } },
    trades: { a: { tradeId: "a", structure: "shares", symbol: "MSFT", state: "open", openQty: 7, legs: [] }, b: { tradeId: "b", structure: "shares", symbol: "MSFT", state: "missed", openQty: 0, legs: [] } } };
  const snap = parsePositions([{ instrument_type: "EQUITY", symbol: "MSFT", quantity: "17" }]);
  assert.equal(reconcilePositions(ledger, snap, "2026-11-19T16:00:00Z").status, "matched");
  assert.equal(reconcilePositions(ledger, parsePositions([{ instrument_type: "EQUITY", symbol: "MSFT", quantity: "10" }]), "x").status, "attention");
});

// --- 5. Option quantities and partial fills ------------------------------------------
await ok("quantities: an engine option trade sends its qty; a partial fill is held and closed in full", async () => {
  const wb = fakeWebull();
  const o = eng("fundamentals", "QTY", { contract: { structure: "long", optionType: "call", strike: 100, expiry: EXP, mid: PX, qty: 4 } });
  const acc = () => mergeEngineTrades(accOf(), engOf([o]), null, { shares: true });
  let { ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger: null, nowMs: T0 });
  assert.equal(wb.placed[0].quantity, "4"); assert.ok(wb.placed[0].legs.every((l) => l.quantity === "4"));
  wb.fill(wb.placed[0].client_order_id, PX, 1);
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger, nowMs: T0 + 3 * MIN, quoteFn: movedQuote(0.02) }));
  assert.equal(wb.placed.length, 2); assert.equal(wb.placed[1].quantity, "3", "the replacement asks only for the 3 still unfilled");
  assert.ok(wb.placed[1].legs.every((l) => l.quantity === "3"), "leg quantity follows the order");
  expireDay(wb);
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger, nowMs: AFTER_CLOSE }));
  const t = ledger.trades[o.tradeId];
  assert.equal(t.requestedQty, 4); assert.equal(t.filledQty, 1); assert.equal(fillOutcome(t), "partial");
  assert.ok(t.labels.includes("Partly filled: 1 of 4 contracts"), t.labels.join("; "));
  const er = engOf([], [closedRow(o, { status: "take-profit", optionPnlPct: 25 })], "2026-11-20T16:02:00.000Z");
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf([], [], "2026-11-20T16:02:00.000Z"), er, ledger, { shares: true }), ledger, nowMs: T0 + 24 * H }));
  assert.equal(wb.placed.at(-1).quantity, "1", "the exit sells what was filled");
});
await ok("quantities: Top Picks are risk sized; the switches put them back on one contract", async () => {
  for (const [sizing, want] of [[live(), String(picksRiskQty(flag("TPS"), RISK).qty)], [live({ picksSizing: false }), "1"], [live({ quantities: false }), "1"], [DEFAULT_SIZING, "1"]]) {
    const wb = fakeWebull();
    const { ledger } = await run({ client: wb, accountId: "PAPER1", acc: accOf([flag("TPS")]), ledger: null, nowMs: T0, sizing });
    assert.equal(wb.placed[0].quantity, want, JSON.stringify(sizing));
    const t = ledger.trades[pickTradeId(flag("TPS"))];
    assert.equal(String(t.requestedQty), want);
    assert.equal(t.qtyBasis, sizing.quantities && sizing.picksSizing ? "risk" : "one");
  }
});
await ok("quantities: trades already in an old ledger keep their size when the switches change", async () => {
  const wb = fakeWebull();
  let { ledger } = await run({ client: wb, accountId: "PAPER1", acc: accOf([flag("OLD")]), ledger: null, nowMs: T0, sizing: DEFAULT_SIZING });
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: accOf([flag("OLD")]), ledger, nowMs: T0 + 3 * MIN }));
  assert.equal(ledger.trades[pickTradeId(flag("OLD"))].requestedQty, 1);
  assert.ok(wb.placed.every((o) => o.quantity === "1"));
});

// --- 6. Reports ----------------------------------------------------------------------
await ok("reports: fill outcome, sizes and the share fee multiplier", async () => {
  assert.equal(fillOutcome({ state: "skipped", sharedContract: { heldBy: "flow" } }), "shared");
  assert.equal(fillOutcome({ state: "skipped" }), "not-bought");
  assert.equal(fillOutcome({ state: "entering", requestedQty: 3, filledQty: 0 }), "pending");
  assert.equal(fillOutcome({ state: "open", requestedQty: 3, filledQty: 3 }), "filled");
  assert.equal(fillOutcome({ state: "missed", requestedQty: 1, filledQty: 0 }), "missed");
  assert.equal(fillOutcome({ state: "closed", fillPrice: 2 }), "filled", "a legacy row with a fill and no quantities");
  // A $100 stock bought and sold at $110 on 10 shares with $1 of fees: +10% less 0.1%.
  assert.equal(fillPnlPct({ structure: "shares", fill_price: 100, close_fill_price: 110, qty: 10, fees: 1 }), 9.9);
  assert.equal(fillPnlPct({ structure: "long", fill_price: 1, close_fill_price: 1.1, qty: 10, fees: 1 }), 9.9);
  const A = webullAnalyticsFactory();
  const base = { state: "closed", fillPrice: 100, closeFillPrice: 110, filledQty: 10, closedQty: 10, openQty: 0, paperPnlPct: 10, fees: 1, closeFillIso: "2026-11-20T16:00:00Z", tradeId: "x", symbol: "S" };
  const res = A.analyze([{ t: { ...base, structure: "shares" } }], "structure");
  assert.equal(Math.round(res.closed[0].usd), 99, "shares: (110-100) x 10 shares - $1");
  assert.equal(Math.round(res.closed[0].pnl * 10) / 10, 9.9);
  const wb = fakeWebull(), s = shr("technicals", "CSV", 12);
  const { ledger } = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([s]), null, { shares: true }), ledger: null, nowMs: T0 });
  const rows = ledgerToFillRows(ledger);
  assert.equal(rows[0].requested_qty, 12); assert.equal(rows[0].fill_outcome, "pending"); assert.equal(rows[0].instrument, "stock"); assert.equal(rows[0].legs, "12 shares");
  const csv = fillRowsToCsv(rows).split("\n")[0].split(",");
  assert.ok(["requested_qty", "fill_outcome", "instrument"].every((c) => csv.includes(c)));
});
await ok("health: share trades before the cutoff, or with share orders off, are not mirror gaps", () => {
  const s = shr("momentum", "HLT", 10);
  const led = (o = {}) => ({ goLiveIso: "2026-11-01T14:00:00.000Z", trades: {}, engineSnapshotIso: BUILT, reconciliation: { status: "matched", alerts: [], checkedAtIso: BUILT }, ...o });
  const acc = accOf();
  assert.equal(mirrorHealth({ acc, ledger: led(), engines: engOf([s]) }, T0).engines.open, 0, "share orders never went live");
  const on = mirrorHealth({ acc, ledger: led({ sharesGoLiveIso: "2026-11-19T15:32:00.000Z" }), engines: engOf([s]) }, T0);
  assert.equal(on.engines.untracked, 1); assert.ok(on.issues.some((i) => i.code === "ENGINE_TRADES_UNTRACKED"));
  assert.equal(mirrorHealth({ acc, ledger: led({ sharesGoLiveIso: "2026-11-19T15:32:00.000Z" }), engines: engOf([s]), sharesMirror: false }, T0).engines.open, 0);
  assert.equal(mirrorHealth({ acc, ledger: led({ sharesGoLiveIso: "2026-11-20T15:32:00.000Z" }), engines: engOf([s]) }, T0).engines.open, 0, "opened before the cutoff");
});

await ok("health: a partly filled engine trade counts as in the paper account, never untracked", async () => {
  const wb = fakeWebull();
  const o = eng("flow", "HPF", { contract: { structure: "long", optionType: "call", strike: 100, expiry: EXP, mid: PX, qty: 3 } });
  const s = shr("technicals", "HPS", 25);
  const acc = () => mergeEngineTrades(accOf(), engOf([o, s]), null, { shares: true });
  let { ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger: null, nowMs: T0 });
  for (const p of wb.placed) wb.fill(p.client_order_id, Number(p.limit_price), 1);
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger, nowMs: T0 + 3 * MIN }));
  const h = mirrorHealth({ acc: accOf(), ledger, engines: engOf([o, s]) }, T0 + 4 * MIN);
  assert.equal(h.engines.open, 2); assert.equal(h.engines.mirrored, 2); assert.equal(h.engines.untracked, 0);
});
await ok("positions: a stock row in Webull's documented shape (position_id, option_strategy, legs) reads as shares", () => {
  // GET /trading/assets/positions/list: required position_id, symbol, instrument_type,
  // quantity (string), currency, option_strategy, last_price, cost_price,
  // unrealized_profit_loss; optional legs (leg_id + symbol). No side field.
  const row = { position_id: "N4I4SIM8TJF38KN2TAA0QVVNE9", symbol: "AAPL", instrument_type: "EQUITY", quantity: "20", currency: "USD",
    option_strategy: "SINGLE", last_price: "190.10", cost_price: "189.00", unrealized_profit_loss: "22.00", legs: [{ leg_id: "L1", symbol: "AAPL", quantity: "20" }] };
  const snap = parsePositions([row]);
  assert.equal(snap.equities.AAPL, 20); assert.deepEqual(snap.options, {}); assert.deepEqual(snap.groups || {}, {});
  const ledger = { positionBaseline: { capturedAtIso: "2026-11-19T15:00:00Z", options: {}, equities: {} },
    trades: { a: { tradeId: "a", structure: "shares", symbol: "AAPL", state: "open", openQty: 20, legs: [] } } };
  assert.equal(reconcilePositions(ledger, snap, "2026-11-19T16:00:00Z").status, "matched");
});

await ok("shares: the sell reference is the stock's closing price, not the record's after-cost result", async () => {
  const wb = fakeWebull();
  const s = shr("technicals", "XPX", 10, { setup: "pullback" });
  let { ledger } = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([s]), null, { shares: true }), ledger: null, nowMs: T0 });
  wb.fillOpen();
  const exitMid = r2(STOCK * 1.01), pnl = Math.round(((exitMid / STOCK - 1) * 100 - 0.1) * 100) / 100;
  const er = engOf([], [closedRow(s, { exitMid, optionPnlPct: pnl })], "2026-11-20T16:02:00.000Z");
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf([], [], "2026-11-20T16:02:00.000Z"), er, ledger, { shares: true }), ledger, nowMs: T0 + 24 * H }));
  assert.equal(ledger.trades[s.tradeId].engineExitPrice, exitMid);
  assert.equal(ledger.trades[s.tradeId].setup, "pullback", "the setup rides the ledger");
  assert.equal(ledgerToTestTrades(ledger)[0].setup, "pullback");
  const csv = fillRowsToCsv(ledgerToFillRows(ledger)).split("\n");
  const head = csv[0].split(","), row = csv[1].split(",");
  assert.equal(row[head.indexOf("setup")], "pullback"); assert.equal(row[head.indexOf("made_by")], ENGINES.technicals.name);
});
await ok("run log: errors and a still-pending window are named in fixed words, no tickers", async () => {
  const wb = fakeWebull();
  const s = shr("technicals", "LOGX", 10);
  const acc = () => mergeEngineTrades(accOf(), engOf([s]), null, { shares: true });
  let { ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger: null, nowMs: T0 });
  // The order rests at the ask (inside the 2% allowance): pending, and normal.
  ({ ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger, nowMs: T0 + 3 * MIN }));
  assert.equal(summary.followUpNeeded, true);
  assert.deepEqual(summary.pendingKinds, { "entry order working inside its price allowance": 1 });
  // Webull's order lookup fails: one fixed-kind error.
  wb.orderDetail = async () => { throw Object.assign(new Error("boom"), { status: 500 }); };
  ({ ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: acc(), ledger, nowMs: T0 + 6 * MIN }));
  assert.ok(summary.errors >= 1);
  assert.equal(summary.errorKinds["order status unavailable"], summary.errors);
  const text = describeKindCounts(summary.errorKinds) + describeKindCounts(summary.pendingKinds);
  assert.ok(!/LOGX|TEC:|mstec/.test(text), text);
});

console.log(`Webull quantities and shares: ${passed} checks passed${failed ? `, ${failed} FAILED` : ""} (risk $${RISK}, option $${PX}, stock $${STOCK}, half-spread $${HALF}).`);
