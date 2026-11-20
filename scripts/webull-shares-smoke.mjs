#!/usr/bin/env node
// Webull paper mirror: quantities and share orders (2026-11-19).
//   node scripts/webull-shares-smoke.mjs        (also run by npm run test:webull-mirror)
// Settings for reruns under other assumptions (env, all optional):
//   WB_RISK_USD   Top Picks risk budget (default 2000)
//   WB_PRICE      option mid of the test trades (default 4)
//   WB_STOCK      stock price of the share trades (default 150)
//   WB_SPREAD     stock bid/ask half-spread in dollars (default 0.05)
//   WB_STOCK_MIN / WB_STOCK_MAX   the engine stock order range checked in
//                 section 8 (default $2,000 / $25,000, the Owner Settings
//                 defaults). Sections 1-7 run with the range wide open so
//                 each checks its own subject at the record's share count.
// Every scenario uses a fake Webull (no network, no store, never a real or
// paper order) that keeps option and stock positions from its own fills.
import assert from "node:assert/strict";
import {
  runWebullMirror as runActual, mergeEngineTrades, picksRiskQty, mirrorQty, buildOrder, newTrade, fillOutcome,
  ledgerToTestTrades, ledgerToFillRows, fillRowsToCsv, makeQuoteFn, isStockTrade, positionText,
  LIVE_SIZING, DEFAULT_SIZING, MIRROR_MAX_QTY, describeKindCounts, CASH_NOTE, parseCashPower, openingCash,
  STOCK_MIN_USD, STOCK_MAX_USD, stockOrderShares, stockRangeFromSettings, stockSizeNote, picksCapFromSettings,
} from "../lib/webull-mirror.mjs";
import { ownerSettingDef, cleanValue } from "../lib/owner-settings.mjs";
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
const SMIN = Number(process.env.WB_STOCK_MIN ?? STOCK_MIN_USD);
const SMAX = Number(process.env.WB_STOCK_MAX ?? STOCK_MAX_USD);
const OPEN_RANGE = { stockMinUsd: 0, stockMaxUsd: 1e12 };

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
const run = (args) => runActual({ clock: () => 0, quoteFn: quote, sizing: { ...LIVE_SIZING, riskUsd: RISK, ...OPEN_RANGE }, ...args });
const live = (o = {}) => ({ ...LIVE_SIZING, riskUsd: RISK, ...OPEN_RANGE, ...o });
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
await ok("risk sizing: a cheap contract is capped at the Top Picks cap (25 unless set), a dear one is still bought once", () => {
  // $0.40 a contract, past a month: risk $25 a contract, 80 asked.
  const cheap = flag("AAA", { contract: { structure: "long", strike: 100, expiry: EXP, mid: 0.4 } });
  const r = picksRiskQty(cheap, 2000);
  assert.equal(r.qty, 25); assert.equal(r.cap, 25); assert.equal(r.capped, true); assert.equal(r.wantQty, 80);
  assert.equal(picksRiskQty(cheap, 2000, 10).qty, 10, "a cap of 10 from Owner Settings");
  assert.equal(picksRiskQty(cheap, 2000, 1).qty, 1);
  assert.equal(picksRiskQty(cheap, 2000, 40).qty, 25, "out of range = the default");
  assert.equal(picksRiskQty(flag("AAA"), 2000).capped, undefined, "under the cap: no capped mark");
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
  assert.equal(capped.qty, 25); assert.equal(capped.basis, "record-capped"); assert.equal(capped.recordQty, 50);
  assert.equal(mirrorQty(eng("flow", "A", { contract: { structure: "long", mid: 0.4, qty: 18 } }), live({ picksMaxQty: 5 })).qty, 18, "an engine trade follows its record, not the Top Picks cap");
  const pk = mirrorQty(flag("A", { contract: { structure: "long", strike: 100, expiry: EXP, mid: 0.4 } }), live({ picksMaxQty: 7 }));
  assert.equal(pk.qty, 7); assert.equal(pk.maxQty, 7); assert.equal(pk.capped, true); assert.equal(pk.wantQty, 80);
  // The saved Owner Settings cap, with a Vercel value winning.
  assert.deepEqual(picksCapFromSettings({}, {}), { picksMaxQty: 25 });
  assert.deepEqual(picksCapFromSettings({ WEBULL_PICKS_MAX_QTY: 12 }, {}), { picksMaxQty: 12 });
  assert.deepEqual(picksCapFromSettings({ WEBULL_PICKS_MAX_QTY: 12 }, { WEBULL_PICKS_MAX_QTY: "4" }), { picksMaxQty: 4 });
  assert.deepEqual(picksCapFromSettings({ WEBULL_PICKS_MAX_QTY: 99 }, { WEBULL_PICKS_MAX_QTY: " " }), { picksMaxQty: 25 });
  const capDef = ownerSettingDef("WEBULL_PICKS_MAX_QTY");
  assert.equal(capDef.default, 25); assert.equal(capDef.min, 1); assert.equal(capDef.max, 25); assert.equal(capDef.tab, "Account limits"); assert.equal(capDef.impact, "high");
  assert.equal(mirrorQty(eng("flow", "A"), live()).qty, 1, "an old trade without qty is one contract");
  assert.equal(mirrorQty(eng("flow", "A", { contract: { structure: "long", mid: 2, qty: 3 } }), live({ quantities: false })).qty, 1);
  assert.equal(mirrorQty(flag("A"), live({ picksSizing: false })).qty, 1);
  assert.equal(mirrorQty(flag("A"), live({ quantities: false })).qty, 1, "quantities off overrides Top Picks sizing");
  assert.equal(mirrorQty(flag("A"), live()).basis, "risk");
  assert.equal(mirrorQty(shr("technicals", "S", 33), live()).qty, 33);
  assert.equal(mirrorQty(shr("technicals", "S", 33), live({ quantities: false })).qty, 33, "shares are the trade itself");
  assert.equal(mirrorQty(shr("technicals", "S", 0), live()).qty, null);
  assert.equal(mirrorQty(flag("A")).qty, 1, "no sizing passed = the old one-contract path");
  assert.deepEqual({ ...DEFAULT_SIZING, riskUsd: 0 }, { quantities: false, picksSizing: false, shares: false, riskUsd: 0, stockMinUsd: 2000, stockMaxUsd: 25000, picksMaxQty: 25 });
  assert.equal(LIVE_SIZING.stockMinUsd, 2000); assert.equal(LIVE_SIZING.stockMaxUsd, 25000); assert.equal(LIVE_SIZING.picksMaxQty, 25); assert.equal(MIRROR_MAX_QTY, 25);
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

// Audit pass 1 (2026-11-19): a share order that fills between the order
// refresh and the positions read is an order filling, not an outside change.
const raceRun = async (extra = 0) => {
  const wb = fakeWebull();
  const f = flag("AAA");
  const s = shr("technicals", "SSS", 30);
  const ledger0 = { version: 2, goLiveIso: "2026-11-01T14:00:00.000Z", accountId: "PAPER1", trades: {}, runs: [] };
  let r = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf([f]), engOf([s]), ledger0, { shares: true }), ledger: ledger0, nowMs: T0 });
  const sId = [...wb.orders.entries()].find(([, o]) => o.body.instrument_type === "EQUITY")[0];
  const aId = [...wb.orders.entries()].find(([, o]) => o.body.instrument_type !== "EQUITY")[0];
  const orig = wb.positions; let n = 0;
  wb.positions = async function () { if (n++ === 0) { wb.fill(sId, STOCK); if (extra) wb.extraStock.SSS = extra; } return orig.call(this); };
  r = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf([f]), engOf([s]), r.ledger, { shares: true }), ledger: r.ledger, nowMs: T0 + 3 * MIN });
  return { wb, r, s, aId };
};
await ok("race: a share fill between order refresh and positions never cancels another trade's order", async () => {
  const { wb, r, s, aId } = await raceRun();
  assert.ok(!wb.cancelled.includes(aId), "the Top Picks entry order was cancelled by an in-flight share fill");
  assert.equal(r.ledger.trades[s.tradeId].openQty, 30);
  assert.equal(r.ledger.reconciliation.status, "matched");
  assert.ok(!r.ledger.reconciliation.alerts.length);
});
await ok("race: more stock than the working share orders can explain still pauses the whole account", async () => {
  const { wb, r, aId } = await raceRun(5);
  assert.equal(r.ledger.reconciliation.status, "attention");
  assert.ok(r.ledger.reconciliation.alerts.some((a) => /stock holdings changed/.test(a)));
  assert.ok(wb.cancelled.includes(aId), "an unexplained stock change must stop other trades' working orders");
});
await ok("race: the working range is per symbol and per direction (entry up, exit down)", () => {
  const t = (id, symbol, openQty) => [id, { tradeId: id, symbol, structure: "shares", state: "open", openQty }];
  const ledger = { trades: Object.fromEntries([t("A", "SSS", 30), t("B", "TTT", 10)]), positionBaseline: { capturedAtIso: "x", options: {}, equities: {} } };
  const snap = (sss, ttt) => parsePositions([{ instrument_type: "EQUITY", symbol: "SSS", quantity: String(sss) }, { instrument_type: "EQUITY", symbol: "TTT", quantity: String(ttt) }]);
  const w = { SSS: { up: 0, down: 30 }, TTT: { up: 5, down: 0 } };
  // SSS selling 30: 0 to 30 held is explained; TTT buying 5 more: 10 to 15.
  let rc = reconcilePositions(structuredClone(ledger), snap(12, 13), "x", { workingShares: w });
  assert.equal(rc.status, "matched"); assert.deepEqual(rc.blockedTradeIds.sort(), ["A", "B"]); assert.equal(rc.sharesFilling, 2);
  rc = reconcilePositions(structuredClone(ledger), snap(30, 10), "x", { workingShares: w });
  assert.equal(rc.status, "matched"); assert.deepEqual(rc.blockedTradeIds, []); assert.equal(rc.sharesFilling, undefined);
  // A buy fill on the selling symbol, a sale on the buying one, or no working orders: alert.
  for (const [a, b, ws] of [[31, 10, w], [30, 9, w], [12, 10, null]]) {
    rc = reconcilePositions(structuredClone(ledger), snap(a, b), "x", { workingShares: ws });
    assert.equal(rc.status, "attention", `${a}/${b}`); assert.deepEqual(rc.blockedTradeIds.sort(), ["A", "B"]);
  }
});

// --- Cash check: no opening buy may lean on margin (2026-11-19) -------------------
// The balance reply in the shape Webull's US API reference gives
// (developer.webull.com/apis/docs/reference/account-balance; no captured
// sandbox reply yet, so the ledger keeps the live reply's key names).
const balanceOf = (cash, margin = cash * 4) => async () => ({ total_asset_currency: "USD", total_cash_balance: String(cash), total_net_liquidation_value: String(cash),
  account_currency_assets: [{ currency: "USD", cash_balance: String(cash), settled_cash: String(cash), unsettled_cash: "0", buying_power: String(margin), option_buying_power: String(margin), day_buying_power: String(margin) }] });
const cashWb = (balance) => Object.assign(fakeWebull(), { balance });
// 40 shares cost between STOCK x 40 and the 2% cap above it (plus a $0.50 fee).
const LOT_LO = STOCK * 40, LOT_HI = STOCK * 1.02 * 40 + 0.5;
const runCash = (wb, open, ledger = null, nowMs = T0) => run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf(open), ledger, { shares: true }), ledger, nowMs });
await ok("cash: the parser reads USD cash only (settled, then cash balance, then the total), never buying power", () => {
  assert.equal(parseCashPower({ account_currency_assets: [{ currency: "HKD", settled_cash: "9" }, { currency: "USD", settled_cash: "1234.5", cash_balance: "2000", buying_power: "99999" }] }), 1234.5, "settled cash first");
  assert.equal(parseCashPower({ data: { account_currency_assets: [{ currency: "usd", cash_balance: 10 }] } }), 10, "cash balance when settled cash is missing");
  assert.equal(parseCashPower({ account_currency_assets: [{ currency: "USD", settled_cash: "", cash_balance: "77" }] }), 77, "an empty settled cash falls through");
  assert.equal(parseCashPower({ total_asset_currency: "USD", total_cash_balance: "500", account_currency_assets: [{ currency: "USD", buying_power: "100000" }] }), 500, "the top-level total when the row has no cash");
  assert.equal(parseCashPower({ total_net_liquidation_value: "100", account_currency_assets: [{ currency: "USD", buying_power: "100", option_buying_power: "100", margin_excess: "100" }] }), null, "no cash field = unknown, never buying power");
  assert.equal(parseCashPower(null), null);
  assert.equal(parseCashPower({ account_currency_assets: [{ currency: "USD", settled_cash: "-5" }] }), 0, "money owed counts as no cash");
  assert.equal(openingCash({ structure: "shares", contract: { structure: "shares" } }, 150.05, 40, 0.5), 6002.5);
  assert.equal(openingCash({ structure: "long", legs: [{ strike: 100 }] }, 4.08, 3, 0.5), 1224.5);
  assert.equal(openingCash({ structure: "credit_vertical", legs: [{ strike: 240 }, { strike: 235 }] }, 1.2, 2), 760, "a credit spread holds its width less the credit");
});
await ok("cash: a stock buy that fits is sent, and the ledger keeps the reply's key names (no values)", async () => {
  const wb = cashWb(balanceOf(10_000_000));
  const { ledger, summary } = await runCash(wb, [shr("technicals", "CFT", 40)]);
  assert.equal(summary.placed, 1); assert.equal(summary.warnings, undefined);
  assert.ok(ledger.balanceShape.currencyRow.includes("settled_cash"));
  assert.ok(!JSON.stringify(ledger.balanceShape).includes("10000000"), "key names only");
});
await ok("cash: a stock buy that does not fit is logged as not bought and never bought later", async () => {
  const wb = cashWb(balanceOf(r2(LOT_LO / 2), LOT_HI * 100));
  const s = shr("technicals", "CSK", 40);
  let { ledger, summary } = await runCash(wb, [s]);
  assert.equal(wb.placed.length, 0, "margin power never covers a buy");
  const t = ledger.trades[s.tradeId];
  assert.equal(t.state, "skipped"); assert.equal(t.note, CASH_NOTE); assert.ok(t.cashHold.needUsd > LOT_LO / 2);
  assert.deepEqual(summary.warnings, { "opening order held - not enough cash": 1 });
  assert.equal(ledgerToTestTrades(ledger)[0].fillOutcome, "not-bought", "shown like an Owner-control hold");
  // Cash arrives later, and the end-of-day window opens: still never bought.
  wb.balance = balanceOf(10_000_000);
  ({ ledger } = await runCash(wb, [s], ledger, T0 + 5 * MIN));
  ({ ledger } = await runCash(wb, [s], ledger, Date.parse("2026-11-19T20:52:00Z")));
  assert.equal(wb.placed.length, 0); assert.equal(ledger.trades[s.tradeId].state, "skipped");
});
await ok("cash: two buys in one run, only the first fits; the second counts the first's cash", async () => {
  const wb = cashWb(balanceOf(r2(LOT_HI * 1.5)));
  const a = shr("technicals", "CTA", 40), b = shr("momentum", "CTB", 40);
  const { ledger, summary } = await runCash(wb, [a, b]);
  assert.equal(wb.placed.length, 1, "1.5 lots of cash buys one lot, not two");
  const states = [ledger.trades[a.tradeId].state, ledger.trades[b.tradeId].state].sort();
  assert.deepEqual(states, ["entering", "skipped"]);
  assert.deepEqual(summary.warnings, { "opening order held - not enough cash": 1 });
});
await ok("cash: an option buy counts premium x 100 x contracts plus the fee", async () => {
  const opt = (sym) => eng("flow", sym, { contract: { structure: "long", optionType: "call", strike: 100, expiry: EXP, mid: PX, qty: 3 } });
  // The quote sits at the engine price, so the first limit is PX (never above the 2% cap).
  const need = openingCash({ structure: "long", legs: [{ strike: 100 }] }, PX, 3, 0.5);
  const tight = cashWb(balanceOf(r2(need * 0.95), need * 100)), o1 = opt("COA");
  let r = await runCash(tight, [o1]);
  assert.equal(tight.placed.length, 0); assert.equal(r.ledger.trades[o1.tradeId].note, CASH_NOTE);
  const room = cashWb(balanceOf(r2(need * 1.05))), o2 = opt("COB");
  r = await runCash(room, [o2]);
  assert.equal(room.placed.length, 1); assert.equal(room.placed[0].legs[0].quantity, "3");
});
await ok("cash: a negative cash balance (money owed) holds every opening buy", async () => {
  const wb = cashWb(async () => ({ total_asset_currency: "USD", total_cash_balance: "-250", account_currency_assets: [{ currency: "USD", cash_balance: "-250", settled_cash: "-250", buying_power: "500000" }] }));
  const s = shr("technicals", "CNG", 40);
  const { ledger, summary } = await runCash(wb, [s]);
  assert.equal(wb.placed.length, 0, "buying power never covers a buy");
  assert.equal(ledger.trades[s.tradeId].note, CASH_NOTE);
  assert.deepEqual(summary.warnings, { "opening order held - not enough cash": 1 });
});
await ok("cash: a failed or unreadable balance still sends, with a warning in the run summary", async () => {
  const failed = cashWb(async () => { throw new Error("balance down"); });
  let r = await runCash(failed, [shr("technicals", "CFA", 40)]);
  assert.equal(failed.placed.length, 1); assert.deepEqual(r.summary.warnings, { "balance read failed - cash not checked": 1 });
  assert.equal(r.summary.errors, 0, "a warning, not an error");
  const odd = cashWb(async () => ({ total_asset: "5" }));
  r = await runCash(odd, [shr("technicals", "CFB", 40)]);
  assert.equal(odd.placed.length, 1); assert.deepEqual(r.summary.warnings, { "no cash field in the balance reply - cash not checked": 1 });
  assert.deepEqual(r.ledger.balanceShape.top, ["total_asset"]);
});
await ok("cash: exits are never held back, even with no cash at all", async () => {
  const wb = cashWb(balanceOf(10_000_000));
  const s = shr("technicals", "CEX", 40);
  let { ledger } = await runCash(wb, [s]);
  wb.fillOpen();
  ({ ledger } = await runCash(wb, [s], ledger, T0 + 3 * MIN));
  wb.balance = balanceOf(0);
  const er = engOf([], [closedRow(s)], "2026-11-20T16:02:00.000Z");
  const reads = []; const base = wb.balance; wb.balance = async (...x) => { reads.push(1); return base(...x); };
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf([], [], "2026-11-20T16:02:00.000Z"), er, ledger, { shares: true }), ledger, nowMs: T0 + 24 * H }));
  assert.equal(wb.placed.at(-1).side, "SELL"); assert.equal(wb.placed.at(-1).quantity, "40");
  assert.equal(reads.length, 0, "a run with only exits never reads the balance");
});

// --- 8. Engine stock order range (Owner rule, 2026-11-19) ------------------------------
// Every engine stock order at Webull is $2,000 to $25,000 at the engine's
// price unless Owner Settings changes the range; the engine record keeps its
// own share count. Expected counts are worked out here from the rule, not
// read back from the code.
const expectShares = (n, px, lo, hi) => {
  const fit = Math.floor(hi / px + 1e-9);
  if (fit < 1) return null;
  if (n * px > hi) return fit;
  if (n * px < lo) return Math.min(Math.ceil(lo / px - 1e-9), fit);
  return n;
};
const shrAt = (engine, symbol, shares, price, o = {}) => eng(engine, symbol, { tradeId: `${ENGINES[engine].tag}:${symbol}-S-11/19/26-11:00`,
  contract: { structure: "shares", optionType: "call", shares, mid: price, usd: Math.round(shares * price), costPct: 0.1 }, ...o });
const RANGE = { stockMinUsd: SMIN, stockMaxUsd: SMAX };
const runRange = (args, range = RANGE) => runActual({ clock: () => 0, quoteFn: quote, sizing: { ...LIVE_SIZING, riskUsd: RISK, ...range }, ...args });

await ok("stock range: the share count rule at the edges", () => {
  assert.deepEqual(stockOrderShares(20, 150), { qty: 20, basis: "shares" }, "$3,000 is inside the range");
  assert.deepEqual(stockOrderShares(5, 150), { qty: 14, basis: "shares-min" }, "$750 is raised to 14 shares ($2,100)");
  assert.deepEqual(stockOrderShares(100, 600), { qty: 41, basis: "shares-max" }, "$60,000 is cut to 41 shares ($24,600)");
  assert.deepEqual(stockOrderShares(2, 30000), { qty: null, basis: "shares-over-max" }, "one share over the maximum is not bought");
  assert.deepEqual(stockOrderShares(1, 2000), { qty: 1, basis: "shares" }, "exactly the minimum stays");
  assert.deepEqual(stockOrderShares(125, 200), { qty: 125, basis: "shares" }, "exactly the maximum stays");
  assert.deepEqual(stockOrderShares(126, 200), { qty: 125, basis: "shares-max" });
  assert.deepEqual(stockOrderShares(1, 1300, 2000, 2500), { qty: 1, basis: "shares-min" }, "raising stops at the maximum");
  assert.deepEqual(stockOrderShares(3, 100, 0, 25000), { qty: 3, basis: "shares" }, "0 = no minimum");
  assert.deepEqual(stockOrderShares(3, 100, 9000, 5000), { qty: 50, basis: "shares-min" }, "a minimum above the maximum is read as the maximum");
  assert.deepEqual(stockOrderShares(7, null), { qty: 7, basis: "shares" }, "no price = the record's count");
  assert.equal(stockOrderShares(0, 150).qty, null);
  for (const n of [1, 3, 10, 40, 70, 400]) for (const px of [STOCK, 12, 45, 150, 600, 900, 2600]) {
    const want = expectShares(n, px, Math.min(SMIN, SMAX), SMAX), got = stockOrderShares(n, px, SMIN, SMAX).qty;
    assert.equal(got, want, `${n} shares at $${px}`);
    if (got != null) assert.ok(got * px <= SMAX + 1e-6 && (got * px >= Math.min(SMIN, SMAX) - 1e-6 || got === Math.floor(SMAX / px)), `${n} at $${px} lands inside the range`);
  }
});
await ok("stock range: Owner Settings values, Vercel values and bad values", () => {
  assert.deepEqual(stockRangeFromSettings({}, {}), { stockMinUsd: 2000, stockMaxUsd: 25000 }, "nothing saved = the defaults");
  assert.deepEqual(stockRangeFromSettings({ WEBULL_STOCK_MIN_USD: 500, WEBULL_STOCK_MAX_USD: 10000 }, {}), { stockMinUsd: 500, stockMaxUsd: 10000 });
  assert.deepEqual(stockRangeFromSettings({ WEBULL_STOCK_MIN_USD: 500 }, { WEBULL_STOCK_MIN_USD: "3000", WEBULL_STOCK_MAX_USD: " " }), { stockMinUsd: 3000, stockMaxUsd: 25000 }, "a Vercel value wins; a blank one does not");
  assert.deepEqual(stockRangeFromSettings({ WEBULL_STOCK_MIN_USD: "abc", WEBULL_STOCK_MAX_USD: -5 }, {}), { stockMinUsd: 2000, stockMaxUsd: 25000 }, "bad values fall back");
  assert.deepEqual(stockRangeFromSettings({ WEBULL_STOCK_MIN_USD: 0 }, {}), { stockMinUsd: 0, stockMaxUsd: 25000 }, "0 = no minimum");
  assert.deepEqual(stockRangeFromSettings({ WEBULL_STOCK_MIN_USD: 40000, WEBULL_STOCK_MAX_USD: 30000 }, {}), { stockMinUsd: 30000, stockMaxUsd: 30000 });
  const lo = ownerSettingDef("WEBULL_STOCK_MIN_USD"), hi = ownerSettingDef("WEBULL_STOCK_MAX_USD");
  assert.equal(lo.default, 2000); assert.equal(hi.default, 25000); assert.equal(lo.impact, "high"); assert.equal(hi.impact, "high");
  for (const d of [lo, hi]) { assert.equal(d.tab, "Account limits"); assert.equal(d.group, "Webull paper stock orders"); assert.equal(d.kind, "number"); assert.equal(d.scope, "build"); assert.ok(d.warn, "a big-impact setting has a warning"); }
  assert.equal(cleanValue(lo, 2500), 2500); assert.equal(cleanValue(lo, 2550), undefined, "off the $100 step");
  assert.equal(cleanValue(hi, 500), undefined, "the maximum is at least $1,000"); assert.equal(cleanValue(hi, 300000), undefined);
});
await ok("stock range: a small lot is raised, bought, labeled and sold whole", async () => {
  const wb = fakeWebull(), px = 150, s = shrAt("technicals", "SML", 5, px);
  const want = expectShares(5, px, Math.min(SMIN, SMAX), SMAX);
  let { ledger } = await runRange({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([s]), null, { shares: true }), ledger: null, nowMs: T0 });
  const t0 = ledger.trades[s.tradeId];
  assert.equal(t0.recordQty, 5); assert.equal(t0.requestedQty, want);
  assert.equal(wb.placed.length, 1); assert.equal(wb.placed[0].quantity, String(want)); assert.equal(wb.placed[0].side, "BUY");
  wb.fillOpen();
  ({ ledger } = await runRange({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([s]), ledger, { shares: true }), ledger, nowMs: T0 + 3 * MIN }));
  const t1 = ledger.trades[s.tradeId];
  assert.equal(t1.openQty, want); assert.equal(fillOutcome(t1), "filled", "the raised count is the full fill");
  if (want !== 5) {
    assert.equal(t1.qtyBasis, "shares-min"); assert.deepEqual(t1.stockRange, { minUsd: Math.min(SMIN, SMAX), maxUsd: SMAX });
    assert.ok(t1.labels.includes(stockSizeNote(t1)) && /minimum: \d+ shares \(record 5\)/.test(stockSizeNote(t1)), "labeled on the trade");
    assert.equal(ledgerToTestTrades(ledger)[0].stockRange.minUsd, Math.min(SMIN, SMAX), "the page sees the range");
  }
  assert.equal(ledger.reconciliation.status, "matched", "holdings match the raised count");
  const er = engOf([], [closedRow(s, { exitMid: r2(px * 1.02) })], "2026-11-20T16:02:00.000Z");
  ({ ledger } = await runRange({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf([], [], "2026-11-20T16:02:00.000Z"), er, ledger, { shares: true }), ledger, nowMs: T0 + 24 * H }));
  const sell = wb.placed.at(-1);
  assert.equal(sell.side, "SELL"); assert.equal(sell.quantity, String(want), "sells exactly what was bought");
  assert.ok(noShort(wb));
});
await ok("stock range: a big core lot is cut to the maximum and the cash check sees the cut size", async () => {
  const wb = fakeWebull(), px = 600, trd = shrAt("trend", "SPY", 100, px, { setup: "core" });
  const want = expectShares(100, px, Math.min(SMIN, SMAX), SMAX);
  const { ledger } = await runRange({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([trd]), null, { shares: true }), ledger: null, nowMs: T0 });
  const t = ledger.trades[trd.tradeId];
  assert.equal(t.requestedQty, want); assert.equal(t.recordQty, 100);
  if (want != null) { assert.equal(wb.placed[0].quantity, String(want)); assert.ok(want * px <= SMAX); }
  // Cash for the cut lot fits; the record's whole lot would not.
  const cash = r2((want || 1) * (px + HALF) + 50);
  const wb2 = fakeWebull(); wb2.balance = async () => ({ account_currency_assets: [{ currency: "USD", settled_cash: String(cash) }] });
  const r = await runRange({ client: wb2, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([trd]), null, { shares: true }), ledger: null, nowMs: T0 });
  if (want != null) { assert.equal(wb2.placed.length, 1, "the cut lot fits the cash"); assert.equal(r.ledger.trades[trd.tradeId].cashHold, undefined); }
});
await ok("stock range: a share over the maximum is never bought, now or later", async () => {
  const wb = fakeWebull(), s = shrAt("technicals", "DEAR", 2, SMAX + 1000);
  let { ledger } = await runRange({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([s]), null, { shares: true }), ledger: null, nowMs: T0 });
  const t = ledger.trades[s.tradeId];
  assert.equal(t.state, "skipped"); assert.equal(fillOutcome(t), "not-bought"); assert.equal(wb.placed.length, 0);
  assert.match(t.note, /One share costs more than the \$[\d,]+ stock order maximum/);
  ({ ledger } = await runRange({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([s]), ledger, { shares: true }), ledger, nowMs: T0 + 3 * MIN, endOfDayOnly: true }));
  assert.equal(wb.placed.length, 0, "not revived at the end of the day");
});
await ok("stock range: a changed range reaches new trades only; options are untouched", async () => {
  const wb = fakeWebull(), a = shrAt("technicals", "RNA", 5, 150), o = eng("flow", "RNO", { contract: { structure: "long", optionType: "call", strike: 100, expiry: EXP, mid: PX, qty: 3 } });
  let { ledger } = await runRange({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([a, o]), null, { shares: true }), ledger: null, nowMs: T0 },
    { stockMinUsd: 5000, stockMaxUsd: 10000 });
  assert.equal(ledger.trades[a.tradeId].requestedQty, 34, "$5,000 / $150 = 33.3, raised to 34");
  assert.equal(ledger.trades[o.tradeId].requestedQty, 3, "an option trade keeps its own quantity");
  wb.fillOpen();
  const b = shrAt("technicals", "RNB", 5, 150);
  ({ ledger } = await runRange({ client: wb, accountId: "PAPER1", acc: mergeEngineTrades(accOf(), engOf([a, o, b]), ledger, { shares: true }), ledger, nowMs: T0 + 3 * MIN },
    { stockMinUsd: 0, stockMaxUsd: 500 }));
  assert.equal(ledger.trades[a.tradeId].requestedQty, 34, "a trade already sent keeps its size");
  assert.equal(ledger.trades[a.tradeId].openQty, 34);
  assert.equal(ledger.trades[b.tradeId].requestedQty, 3, "the new trade reads the new range ($500 / $150 = 3)");
});

console.log(`Webull quantities and shares: ${passed} checks passed${failed ? `, ${failed} FAILED` : ""} (risk $${RISK}, option $${PX}, stock $${STOCK}, half-spread $${HALF}).`);
