// Offline smoke test for the Webull paper mirror (lib/webull-mirror.mjs,
// lib/webull-client.mjs) and its endpoint (api/auth/[action].js
// "webull-mirror"): request signing, the sandbox-only guard, the entry/exit
// price ladder with the ±10% band, labels, idempotent order ids, the trade
// log rows and the trigger auth. A fake Webull client stands in for the API.
// No network, no data/.
// Run: node scripts/webull-mirror-smoke.mjs
import { signRequest, createWebullClient, quoteAll } from "../lib/webull-client.mjs";
import {
  runWebullMirror, updateQuantities, buildOrder, mirrorLegs, roundTick, clientOrderId, isRegularSession, isMarketClosedError, parseOrderDetail, parsePreviewFee, ledgerToTestTrades,
  ledgerToFillRows, fillRowsToCsv, mirrorTriggerToken, makeQuoteFn, emptyLedger, LEDGER_KEY,
} from "../lib/webull-mirror.mjs";
import { parsePositions, reconcilePositions } from "../lib/webull-reconciliation.mjs";
import { expiryControl, sessionForDate, previousTradingDate } from "../lib/us-equity-calendar.mjs";
import { withObjectLease, describeObjectLease } from "../lib/object-lease.mjs";
import { pickTradeId } from "../lib/pick-trade-text.mjs";

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function throwsAsync(fn) { try { await fn(); return false; } catch { return true; } }

// --- 1. Signing matches the official Python SDK ------------------------------
// Vectors computed with webull-openapi-python-sdk 3.0.4's calc_signature
// (timestamp and nonce pinned).
const base = { appKey: "KEY", appSecret: "SEC!(x)", host: "api.sandbox.webull.com", timestamp: "2026-10-21T14:05:09Z", nonce: "nonce-123" };
ok("sign: GET with query matches the SDK",
  signRequest({ ...base, path: "/trading/assets/balances/get", query: { account_id: "ABC 1/2" } })["x-signature"] === "qaM+QP5jpu0uz5JXNbhQaqdG08spKvJ17nybkl92cxQ=");
ok("sign: POST with body matches the SDK",
  signRequest({ ...base, path: "/trading/orders/place", body: { account_id: "X", new_orders: [{ client_order_id: "id1", limit_price: "5.05", legs: [{ symbol: "NVDA", strike_price: "190" }] }] } })["x-signature"] === "RI0o/gDHT6m2QNax5jyjiuxrN7VQDqeRflLe3PZLcYc=");
ok("sign: quote encodes like Python quote(safe='')", quoteAll("a/b c!*'()~") === "a%2Fb%20c%21%2A%27%28%29~");
ok("client: refuses the live host", (() => { try { createWebullClient({ appKey: "k", appSecret: "s", host: "api.webull.com" }); return false; } catch (e) { return e.code === "NOT_SANDBOX"; } })());
ok("client: refuses missing keys", (() => { try { createWebullClient({ host: "api.sandbox.webull.com" }); return false; } catch (e) { return e.code === "NO_CREDENTIALS"; } })());

// The client sends signed headers, x-version v3 and the option category.
{
  const seen = [];
  const fakeFetch = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, text: async () => "{}" }; };
  const c = createWebullClient({ appKey: "k", appSecret: "s", fetchImpl: fakeFetch });
  await c.placeOrder("A1", [{ client_order_id: "x" }]);
  await c.balance("A1");
  ok("client: posts to the sandbox host", seen[0].url === "https://api.sandbox.webull.com/trading/orders/place");
  ok("client: option orders carry category US_OPTION", seen[0].init.headers.category === "US_OPTION");
  ok("client: x-version v3 + signature", seen[0].init.headers["x-version"] === "v3" && !!seen[0].init.headers["x-signature"]);
  ok("client: GET has the query string and no body", seen[1].url.endsWith("/trading/assets/balances/get?account_id=A1") && seen[1].init.body === undefined);
}

// --- 2. Order bodies -----------------------------------------------------------
const EXP = Date.UTC(2026, 11, 18) / 1000;
const longCall = (o = {}) => ({ symbol: "NVDA", side: "call", entryDate: "2026-10-21T15:00:00.000Z", contract: { structure: "long", strike: 190, expiry: EXP, mid: 5.0 }, ...o });
const creditPut = (o = {}) => ({
  symbol: "AAPL", side: "put", entryDate: "2026-10-21T15:00:00.000Z",
  contract: { structure: "credit_vertical", optionType: "put", expiry: EXP, netCredit: 1.2, longStrike: 230, shortStrike: 240,
    legs: [{ qty: -1, type: "put", strike: 240, expiry: EXP }, { qty: 1, type: "put", strike: 230, expiry: EXP }] },
  ...o,
});
{
  const t = { symbol: "NVDA", structure: "long", legs: mirrorLegs(longCall()) };
  const o = buildOrder(t, "entry", 5, "cid");
  ok("order: single buy to open", o.side === "BUY" && o.option_strategy === "SINGLE" && o.position_intent === "BUY_TO_OPEN" && o.time_in_force === "DAY" && o.order_type === "LIMIT");
  ok("order: leg fields", o.legs[0].option_expire_date === "2026-12-18" && o.legs[0].strike_price === "190" && o.legs[0].option_type === "CALL" && o.legs[0].side === "BUY");
  ok("order: limit as a 2-dp string", o.limit_price === "5.00");
  const x = buildOrder(t, "exit", 6, "cid2");
  ok("order: single sell to close", x.side === "SELL" && x.position_intent === "SELL_TO_CLOSE" && x.legs[0].side === "SELL");
  const ct = { symbol: "AAPL", structure: "credit_vertical", legs: mirrorLegs(creditPut()) };
  const co = buildOrder(ct, "entry", 1.2, "cid3");
  ok("order: credit spread opens as a SELL vertical", co.side === "SELL" && co.option_strategy === "VERTICAL" && co.position_intent === undefined);
  ok("order: credit legs sell 240 / buy 230", co.legs.find((l) => l.strike_price === "240").side === "SELL" && co.legs.find((l) => l.strike_price === "230").side === "BUY");
  const cx = buildOrder(ct, "exit", 0.6, "cid4");
  ok("order: credit spread closes as a BUY with legs flipped", cx.side === "BUY" && cx.legs.find((l) => l.strike_price === "240").side === "BUY");
}
ok("tick: nickel at $3+", Math.abs(roundTick(5.12) - 5.1) < 1e-9 && Math.abs(roundTick(5.13) - 5.15) < 1e-9);
ok("tick: penny under $3 and for spreads", Math.abs(roundTick(1.234) - 1.23) < 1e-9 && Math.abs(roundTick(5.12, { spread: true }) - 5.12) < 1e-9);
ok("order id: deterministic and <= 32 chars", clientOrderId("NVDA-C-10/21/26-11:00", "entry", 1) === clientOrderId("NVDA-C-10/21/26-11:00", "entry", 1) && clientOrderId("a", "entry", 1).length <= 32);
ok("order id: differs by attempt", clientOrderId("a", "entry", 1) !== clientOrderId("a", "entry", 2));

// --- 3. Session clock ---------------------------------------------------------
ok("session: Wed 11:05 ET is open", isRegularSession(Date.parse("2026-10-21T15:05:00Z")));
ok("session: Wed 16:10 ET is closed", !isRegularSession(Date.parse("2026-10-21T20:10:00Z")));
ok("session: Sat is closed", !isRegularSession(Date.parse("2026-10-24T15:05:00Z")));

// --- 4. Lifecycle against a fake Webull --------------------------------------
function fakeWebull({ accounts = [{ account_id: "PAPER1" }] } = {}) {
  const orders = new Map();
  const placed = [], cancelled = [];
  return {
    orders, placed, cancelled,
    accountList: async () => accounts,
    positions: async () => {
      const net = new Map();
      for (const order of orders.values()) {
        const qty = Number(order.filled_quantity || 0);
        for (const l of order.body.legs) {
          const key = [l.symbol, l.option_expire_date, l.option_type, l.strike_price].join("|");
          const prior = net.get(key) || { instrument_type: "OPTION", symbol: l.symbol, quantity: 0, legs: [{ ...l, quantity: 0 }] };
          prior.legs[0].quantity += (l.side === "BUY" ? qty : -qty);
          prior.quantity = prior.legs[0].quantity; delete prior.legs[0].side;
          net.set(key, prior);
        }
      }
      return [...net.values()].filter((p) => p.quantity);
    },
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
      o.status = "CANCELLED";
      cancelled.push(id);
      return {};
    },
    fill(id, price, qty = null) { const o = orders.get(id); o.filled_quantity = String(qty ?? o.body.quantity); o.status = Number(o.filled_quantity) === Number(o.body.quantity) ? "FILLED" : "PARTIAL_FILLED"; o.filled_price = String(price); o.filled_time_at = "2026-10-21T16:00:00.000Z"; },
  };
}
const T0 = Date.parse("2026-10-21T15:10:00Z"); // Wed 11:10 ET
const H = 3600 * 1000;
const accWith = (open = [], closed = [], builtAtIso = "2026-10-21T15:02:00Z") => ({ builtAtIso, open, closed });

// 4a. Fill, then the engine closes and the paper exit fills.
{
  const wb = fakeWebull();
  const e = longCall();
  const id = pickTradeId(e);
  let { ledger, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0 });
  ok("life: first run places the entry at the engine price", summary.placed === 1 && wb.placed[0].limit_price === "5.00");
  ok("life: go-live covers the trades this bake opened", Date.parse(ledger.goLiveIso) <= Date.parse(e.entryDate));
  wb.fill(wb.placed[0].client_order_id, 5.1);
  ({ ledger, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 2 * H }));
  const t = ledger.trades[id];
  ok("life: fill recorded", t.state === "open" && t.fillPrice === 5.1 && t.entryDiffPct === 2);
  ok("life: entry label", t.labels[0] === "Paper bought 2.0% above engine", t.labels[0]);
  const closedE = { ...e, status: "hit-tp-prem", exitDate: "2026-10-22T15:00:00.000Z", optionPnlPct: 20 };
  ({ ledger, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closedE]), ledger, nowMs: T0 + 24 * H }));
  ok("life: exit placed at the engine exit price", wb.placed[1].limit_price === "6.00" && wb.placed[1].side === "SELL");
  wb.fill(wb.placed[1].client_order_id, 5.8);
  ({ ledger, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closedE]), ledger, nowMs: T0 + 26 * H }));
  const tc = ledger.trades[id];
  ok("life: closed with both labels", tc.state === "closed" && tc.labels.join(" | ") === "Paper bought 2.0% above engine | Paper sold 3.3% below engine", tc.labels.join(" | "));
  ok("life: paper P&L from fills", tc.paperPnlPct === 13.7, String(tc.paperPnlPct));
  ok("life: engine close reason + P&L kept", tc.engineCloseReason === "hit-tp-prem" && tc.enginePnlPct === 20);
  const rows = ledgerToFillRows(ledger);
  ok("rows: one Webull paper row", rows.length === 1 && rows[0].account === "Webull paper" && rows[0].trade_id === id);
  ok("rows: P&L and entry gap computed", rows[0].your_pnl_pct === 13.7 && rows[0].entry_slippage_pct === 2);
  ok("rows: labels in notes", /Paper sold 3\.3% below engine/.test(rows[0].notes));
  const csv = fillRowsToCsv(rows);
  ok("csv: header + 1 row with the template columns", csv.split("\n")[0].startsWith("trade_id,account,symbol") && csv.trim().split("\n").length === 2);
  ok("csv: commas and quotes inside cells are escaped", fillRowsToCsv([{ trade_id: 'a,b', notes: 'say "hi"' }]).split("\n")[1].startsWith('"a,b",') && fillRowsToCsv([{ notes: 'say "hi"' }]).includes('"say ""hi"""'));
}

// 4b. Not filled -> re-price to the mid inside the band -> still not filled -> missed.
{
  const wb = fakeWebull();
  const e = longCall();
  const id = pickTradeId(e);
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0 });
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 2 * H, quoteFn: async () => ({ bid: 5.2, ask: 5.4 }) }));
  ok("band: first order cancelled", wb.cancelled.length === 1);
  ok("band: re-priced to the mid (+6%)", wb.placed[1]?.limit_price === "5.30", wb.placed[1]?.limit_price);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 4 * H, quoteFn: async () => ({ bid: 5.2, ask: 5.4 }) }));
  ok("band: missed after 2 tries", ledger.trades[id].state === "missed" && wb.placed.length === 2);
}

// 4c. Mid already 15% above the engine -> missed, no chase.
{
  const wb = fakeWebull();
  const e = longCall();
  const id = pickTradeId(e);
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0 });
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 2 * H, quoteFn: async () => ({ bid: 5.65, ask: 5.85 }) }));
  const t = ledger.trades[id];
  ok("band: out of band -> missed with the gap", t.state === "missed" && /15\.0% above/.test(t.note), t.note);
  ok("band: no second order", wb.placed.length === 1);
}

// 4d. Engine closes while the entry is still working -> cancel + missed.
{
  const wb = fakeWebull();
  const e = longCall();
  const id = pickTradeId(e);
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0 });
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [{ ...e, status: "hit-stop-prem", exitDate: "2026-10-21T19:30:00Z", optionPnlPct: -50 }]), ledger, nowMs: T0 + 4 * H }));
  ok("engine closed first: cancelled + missed", wb.cancelled.length === 1 && ledger.trades[id].state === "missed");
}

// 4e. Outside the session nothing is placed; the next session picks it up.
{
  const wb = fakeWebull();
  const e = longCall({ entryDate: "2026-10-21T19:30:00Z" });
  const after = Date.parse("2026-10-21T20:12:00Z");
  let { ledger, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e], [], "2026-10-21T19:31:00Z"), ledger: null, nowMs: after });
  ok("session: no orders after the close", summary.placed === 0 && ledger.trades[pickTradeId(e)].state === "entering");
  ({ summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: Date.parse("2026-10-22T14:05:00Z") }));
  ok("session: placed at the next open", summary.placed === 1);
}

// 4f. Fail closed when the account isn't visible to the keys.
ok("account: unknown paper account throws", await throwsAsync(() => runWebullMirror({ client: fakeWebull({ accounts: [{ account_id: "OTHER" }] }), accountId: "PAPER1", acc: accWith([longCall()]), ledger: null, nowMs: T0 })));

// 4g. Trades opened before go-live are left alone; throttle.
{
  const wb = fakeWebull();
  const ledger0 = { ...emptyLedger(), goLiveIso: "2026-10-21T16:00:00Z" };
  let { ledger, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([longCall()]), ledger: ledger0, nowMs: T0 + H });
  ok("go-live: older trade ignored", summary.placed === 0 && !Object.keys(ledger.trades).length);
  ({ summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([longCall()]), ledger, nowMs: T0 + H + 10000 }));
  ok("throttle: second run within a minute skipped", !!summary.skipped);
}

// 4h. A crash after placing: the rerun adopts the order instead of a duplicate.
{
  const wb = fakeWebull();
  const e = longCall();
  const id = pickTradeId(e);
  const { ledger: l1 } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0 });
  const lost = { ...emptyLedger(), goLiveIso: l1.goLiveIso }; // the save never happened
  const { ledger: l2, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: lost, nowMs: T0 + 5 * 60000 });
  ok("idempotent: no second order placed", wb.placed.length === 1 && summary.errors === 0);
  ok("idempotent: adopted the working order", l2.trades[id].entryAttempts[0].status === "SUBMITTED");
}

// 4i. Exit ladder: engine price, then mid, then bid until it fills.
{
  const wb = fakeWebull();
  const e = longCall();
  const id = pickTradeId(e);
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0 });
  wb.fill(wb.placed[0].client_order_id, 5);
  const closedE = { ...e, status: "hit-stop-prem", exitDate: "2026-10-22T15:00:00Z", optionPnlPct: -50 };
  const q = async () => ({ bid: 2.2, ask: 2.6 });
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closedE]), ledger, nowMs: T0 + 24 * H, quoteFn: q }));
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closedE]), ledger, nowMs: T0 + 26 * H, quoteFn: q }));
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closedE]), ledger, nowMs: T0 + 28 * H, quoteFn: q }));
  const px = wb.placed.slice(1).map((o) => o.limit_price);
  ok("exit ladder: 2.50 -> 2.40 mid -> 2.20 bid", px.join(",") === "2.50,2.40,2.20", px.join(","));
  wb.fill(wb.placed[3].client_order_id, 2.2);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closedE]), ledger, nowMs: T0 + 30 * H, quoteFn: q }));
  ok("exit ladder: closed with the real gap", ledger.trades[id].state === "closed" && ledger.trades[id].labels[1] === "Paper sold 12.0% below engine", ledger.trades[id].labels[1]);
}

// 4j. Expired in the record: nothing to sell.
{
  const wb = fakeWebull();
  const e = longCall();
  const id = pickTradeId(e);
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0 });
  wb.fill(wb.placed[0].client_order_id, 5);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [{ ...e, status: "expired", exitDate: "2026-12-19T15:00:00Z", optionPnlPct: -100 }]), ledger, nowMs: T0 + 24 * H }));
  ok("engine expiry does not pretend broker is flat", ledger.trades[id].state === "exiting" && wb.placed.length === 2);
}

// --- 5. Quotes for spreads ------------------------------------------------------
{
  const book = { 240: { b: 3.0, a: 3.2 }, 230: { b: 1.6, a: 1.8 } };
  const qf = makeQuoteFn(async (sym, exp, side, strike) => book[strike]);
  const t = { symbol: "AAPL", structure: "credit_vertical", legs: mirrorLegs(creditPut()) };
  const q = await qf(t);
  ok("quote: credit spread net credit 1.20-1.60", q.bid === 1.2 && q.ask === 1.6, JSON.stringify(q));
}

// --- 5b. Webull says the market is closed (holiday / early close) ------------
{
  const wb = fakeWebull();
  let shut = true;
  const realPlace = wb.placeOrder;
  wb.placeOrder = async (acct, list) => {
    if (shut) throw Object.assign(new Error("Webull /trading/orders/place: You cannot place orders at this moment. Available trading hours are: 9:30 a.m.- 4:00 p.m. ET."), { status: 417, code: "OPENAPI_OPTION_ONLY_SUPPORT_MARKET_IN_CORE_TIME" });
    return realPlace(acct, list);
  };
  const e = longCall();
  const id = pickTradeId(e);
  let { ledger, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0 });
  const t = ledger.trades[id];
  ok("closed market: no try counted, trade still waiting", t.state === "entering" && t.entryAttempts.filter((a) => !a.marketClosed).length === 0 && summary.errors === 0, JSON.stringify(t.entryAttempts));
  ok("closed market: run says why, ledger still saved", /market is closed/.test(summary.note || "") && !summary.skipped);
  ok("closed market: error is recognized", isMarketClosedError({ code: "OPENAPI_OPTION_ONLY_SUPPORT_MARKET_IN_CORE_TIME" }) && !isMarketClosedError({ code: "OPENAPI_PARAM_ERR" }));
  shut = false;
  ({ ledger, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 24 * H }));
  ok("closed market: next session places at the engine price", summary.placed === 1 && wb.placed[0].limit_price === "5.00" && ledger.trades[id].entryAttempts.filter((a) => !a.marketClosed).length === 1);
}

// --- 5c. Safety guards -----------------------------------------------------------
{
  // No readable record: never treat the book as closed.
  const wb = fakeWebull();
  const e = longCall();
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0 });
  wb.fill(wb.placed[0].client_order_id, 5);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + H }));
  const r = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: {}, ledger, nowMs: T0 + 2 * H });
  ok("guard: missing record -> skipped, nothing sold", r.summary.skipped === "track record unavailable" && wb.placed.length === 1 && r.ledger.trades[pickTradeId(e)].state === "open");
}
{
  // A cancel Webull won't confirm: no second order (could double the position).
  const wb = fakeWebull();
  wb.cancelOrder = async () => { throw new Error("cancel refused"); };
  const e = longCall();
  const id = pickTradeId(e);
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0 });
  for (let i = 1; i <= 3; i++) ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + i * H }));
  ok("guard: unconfirmed cancel blocks a re-price", wb.placed.length === 1, String(wb.placed.length));
  ok("guard: stuck order flagged for a hand check", ledger.trades[id].needsReview && /by hand/.test(ledger.trades[id].note), ledger.trades[id].state);
}
{
  // Webull has no record of the order: re-send without counting a try.
  const wb = fakeWebull();
  const e = longCall();
  const id = pickTradeId(e);
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0 });
  wb.orders.clear();
  wb.orderDetail = async () => { throw new Error("Webull /trading/orders/get: Parameter error, Order not present."); };
  wb.cancelOrder = async () => { throw new Error("Webull /trading/orders/cancel: Parameter error, Order not present."); };
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + H }));
  const t = ledger.trades[id];
  ok("guard: acknowledged order disappearing blocks replacement", wb.placed.length === 1 && t.entryAttempts[0].lookupFailed, JSON.stringify(t.entryAttempts.map((a) => a.status)));
}
{
  // A stale record doesn't drag old opens into the mirror.
  const wb = fakeWebull();
  const { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [], "2026-10-19T15:02:00Z"), ledger: null, nowMs: T0 });
  ok("go-live: at most 3h back", T0 - Date.parse(ledger.goLiveIso) <= 3 * H);
}
{
  // Order detail wrapped in data / order.
  ok("parse: data.orders[]", parseOrderDetail({ data: { orders: [{ status: "FILLED", filled_price: "1.5", filled_quantity: "1" }] } })?.filledPrice === 1.5);
  ok("parse: bare order", parseOrderDetail({ order: { status: "CANCELLED" } })?.status === "CANCELLED");
}

{
  // Cancel accepted, but the order filled first: record the fill, no second order.
  const wb = fakeWebull();
  const e = longCall();
  const id = pickTradeId(e);
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0, sleep: async () => {} });
  const first = wb.placed[0].client_order_id;
  let looks = 0;
  const realDetail = wb.orderDetail;
  wb.orderDetail = async (acct, cid) => { looks++; if (looks === 2) wb.fill(first, 5.05); return realDetail(acct, cid); };
  wb.cancelOrder = async () => ({});
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + H, sleep: async () => {} }));
  ok("guard: fill during a pending cancel is kept, no second order", wb.placed.length === 1 && ledger.trades[id].state === "open" && ledger.trades[id].fillPrice === 5.05, `${wb.placed.length} ${ledger.trades[id].state}`);
}
{
  // Cancel accepted but never confirmed: wait, don't re-price this run.
  const wb = fakeWebull();
  const e = longCall();
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0, sleep: async () => {} });
  wb.cancelOrder = async () => ({});
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + H, sleep: async () => {} }));
  ok("guard: unconfirmed cancel -> no new order", wb.placed.length === 1 && ledger.trades[pickTradeId(e)].entryAttempts[0].status === "CANCEL_FAILED");
}
ok("status: 'PARTIAL FILLED' normalized", parseOrderDetail({ orders: [{ status: "PARTIAL FILLED" }] })?.status === "PARTIAL_FILLED");
ok("tick: nickel after a rejection", Math.abs(roundTick(1.23, { nickel: true }) - 1.25) < 1e-9);
{
  const wb = fakeWebull();
  let rejectOnce = true;
  const realPlace = wb.placeOrder;
  wb.placeOrder = async (acct, list) => { if (rejectOnce) { rejectOnce = false; throw Object.assign(new Error("invalid price increment"), { status: 417 }); } return realPlace(acct, list); };
  const e = { ...longCall(), contract: { ...longCall().contract, mid: 1.23 } };
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0 });
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + H }));
  ok("tick: re-sent in nickels after a price rejection", wb.placed.length === 1 && wb.placed[0].limit_price === "1.25", wb.placed[0]?.limit_price);
}

{
  // Every order records the bid/ask (and stock price) it was priced against.
  const wb = fakeWebull();
  const e = longCall();
  const quoteFn = async () => ({ bid: 4.9, ask: 5.2, spot: 101.5 });
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0, quoteFn });
  const row = ledgerToFillRows(ledger)[0];
  ok("rows: bid/ask/spot at order recorded", row.bid_at_order === 4.9 && row.ask_at_order === 5.2 && row.stock_price_at_order === 101.5, JSON.stringify([row.bid_at_order, row.ask_at_order, row.stock_price_at_order]));
}

{
  // Fee estimate from Webull's preview, carried to the rows and the test view.
  const wb = fakeWebull();
  wb.previewOrder = async () => ({ estimated_cost: "500", estimated_transaction_fee: "0.06", currency: "USD" });
  const e = longCall();
  const id = pickTradeId(e);
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: null, nowMs: T0, quoteFn: async () => ({ bid: 4.9, ask: 5.1, spot: 100 }) });
  wb.fill(wb.placed[0].client_order_id, 5);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + H }));
  const closedE = { ...e, status: "hit-tp-prem", exitDate: "2026-10-22T15:00:00.000Z", optionPnlPct: 20 };
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closedE]), ledger, nowMs: T0 + 24 * H, quoteFn: async () => ({ bid: 5.9, ask: 6.1, spot: 104 }) }));
  wb.fill(wb.placed[1].client_order_id, 6);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closedE]), ledger, nowMs: T0 + 26 * H }));
  ok("fees: entry + exit preview fees summed", ledger.trades[id].fees === 0.12, String(ledger.trades[id].fees));
  ok("fees: preview response parsed", parsePreviewFee({ estimated_transaction_fee: "0.13" }) === 0.13 && parsePreviewFee({ data: { estimated_transaction_fee: "0.05" } }) === 0.05 && parsePreviewFee({}) == null);
  const row = ledgerToFillRows(ledger)[0];
  ok("fees: rows carry the fee total", row.fees === 0.12 && row.your_pnl_pct === 20, `${row.fees} ${row.your_pnl_pct}`);
  const tt = ledgerToTestTrades(ledger)[0];
  ok("test view: one compact trade", tt.tradeId === id && tt.entryHow === "first" && tt.entryBid === 4.9 && tt.exitBid === 5.9 && tt.paperPnlPct === 20 && tt.enginePnlPct === 20 && tt.fees === 0.12, JSON.stringify(tt));
}

// --- 6. Endpoint auth -------------------------------------------------------------
{
  process.env.PRIVATE_DATA_ENABLED = "1";
  process.env.R2_SECRET_ACCESS_KEY = "test-r2-secret";
  delete process.env.WEBULL_MIRROR;
  const { default: handler } = await import("../api/auth/[action].js");
  const mk = () => { const r = { statusCode: 0, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end(b) { this.body = b; } }; return r; };
  let res = mk();
  await handler({ query: { action: "webull-mirror" }, method: "POST", headers: {} }, res);
  ok("api: POST without the trigger token is 404", res.statusCode === 404);
  res = mk();
  await handler({ query: { action: "webull-mirror" }, method: "POST", headers: { authorization: "Bearer nope" } }, res);
  ok("api: wrong token is 404", res.statusCode === 404);
  res = mk();
  await handler({ query: { action: "webull-mirror" }, method: "POST", headers: { authorization: `Bearer ${mirrorTriggerToken("test-r2-secret")}` } }, res);
  ok("api: right token, mirror off -> not run", res.statusCode === 200 && res.body?.ran === false && res.body?.reason === "mirror off");
  res = mk();
  await handler({ query: { action: "webull-mirror" }, method: "GET", headers: { host: "example.test" } }, res);
  ok("api: GET needs an Owner session", res.statusCode === 401);
  ok("ledger key is private", LEDGER_KEY === "webull-paper-ledger.json");
}

// --- Quantity accounting, recovery, reconciliation and expiry -----------------
{
  const t = { symbol: "AAPL", structure: "credit_vertical", legs: mirrorLegs(creditPut()) };
  const o = buildOrder(t, "exit", 0.6, "quantity", 4);
  ok("quantity: vertical order and every leg use 4 contracts", o.quantity === "4" && o.legs.every((l) => l.quantity === "4"));
  ok("quantity: required option-level instrument fields", o.symbol === "AAPL" && o.instrument_type === "OPTION" && o.market === "US");
  ok("quantity: rejects fractional contracts", await throwsAsync(() => buildOrder(t, "entry", 1, "bad", 1.5)));
  const bad = creditPut(); bad.contract.legs[0].qty = -2;
  ok("quantity: unsupported ratio spread refused", mirrorLegs(bad) === null);
}
{
  const wb = fakeWebull(), e = longCall(), id = pickTradeId(e);
  wb.previewOrder = async () => ({ estimated_transaction_fee: "3" });
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0, placeOrders: false });
  ledger.trades[id].requestedQty = 3;
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 60000 }));
  ok("partial entry: target quantity is submitted", wb.placed[0].quantity === "3");
  wb.fill(wb.placed[0].client_order_id, 5, 1);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 120000, quoteFn: async () => ({ bid: 5.1, ask: 5.3 }) }));
  let t = ledger.trades[id];
  ok("partial entry: one fill is not a filled three-contract order", t.entryAttempts[0].status === "CANCELLED" && t.entryAttempts[0].filledQty === 1 && t.filledQty === 1 && t.openQty === 1);
  ok("partial entry: replacement is only the remaining two", wb.placed[1].quantity === "2");
  ok("partial entry: fees pro-rated to actual fills", t.fees === 1);
  wb.fill(wb.placed[1].client_order_id, 5.2, 2);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 180000 }));
  t = ledger.trades[id];
  ok("partial entry: weighted average across attempts", t.state === "open" && Math.abs(t.fillPrice - 15.4 / 3) < 1e-10 && t.filledQty === 3);
  ok("partial entry: fees counted once", t.fees === 4);
  const closed = { ...e, status: "hit-tp-prem", exitDate: "2026-10-21T15:14:00Z", optionPnlPct: 25 };
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closed]), ledger, nowMs: T0 + 240000 }));
  ok("partial exit: closes the actual three contracts", wb.placed[2].quantity === "3");
  wb.fill(wb.placed[2].client_order_id, 6.25, 1);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closed]), ledger, nowMs: T0 + 300000, quoteFn: async () => ({ bid: 6.1, ask: 6.3 }) }));
  t = ledger.trades[id];
  ok("partial exit: position remains open until all contracts close", t.state === "exiting" && t.closedQty === 1 && t.openQty === 2 && t.paperPnlPct === null);
  ok("partial exit: replacement cannot oversell", wb.placed[3].quantity === "2");
  ok("partial exit: CSV has no completed trade P&L", ledgerToFillRows(ledger)[0].your_pnl_pct === null);
  wb.fill(wb.placed[3].client_order_id, 6.2, 2);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closed]), ledger, nowMs: T0 + 360000 }));
  t = ledger.trades[id];
  ok("partial exit: weighted closing price, zero remaining", t.state === "closed" && t.openQty === 0 && Math.abs(t.closeFillPrice - 18.65 / 3) < 1e-10);
  const fees = t.fees, pnl = t.paperPnlPct;
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closed]), ledger: structuredClone(ledger), nowMs: T0 + 420000 }));
  ok("partial exit: restart does not double-count fills/fees", ledger.trades[id].fees === fees && ledger.trades[id].paperPnlPct === pnl && wb.placed.length === 4);
  const view = ledgerToTestTrades(ledger)[0];
  ok("partial exit: owner view and CSV expose actual quantities", view.requestedQty === 3 && view.filledQty === 3 && view.closedQty === 3 && ledgerToFillRows(ledger)[0].qty === 3);
}
{
  const wb = fakeWebull(), e = longCall(), id = pickTradeId(e);
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0, placeOrders: false });
  ledger.trades[id].requestedQty = 3;
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 60000 }));
  wb.fill(wb.placed[0].client_order_id, 5, 1);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 120000, quoteFn: async () => ({ bid: 8, ask: 9 }) }));
  ok("partial entry outside band retains the held contract", ledger.trades[id].state === "open" && ledger.trades[id].filledQty === 1 && wb.placed.length === 1);
  const closed = { ...e, status: "thesis-broken", optionPnlPct: -10 };
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closed]), ledger, nowMs: T0 + 180000 }));
  ok("partial entry closes only what actually filled", wb.placed[1].quantity === "1" && wb.placed[1].side === "SELL");
}
{
  const wb = fakeWebull(), e = longCall(), id = pickTradeId(e);
  let saved = null, journalSeen = false;
  const checkpoint = async (l) => { saved = structuredClone(l); };
  const original = wb.placeOrder;
  wb.placeOrder = async (account, orders) => {
    const a = saved.trades[id].entryAttempts.at(-1);
    journalSeen = a.status === "PREPARED" && a.order.client_order_id === orders[0].client_order_id && a.quantity === 1;
    await original(account, orders);
    throw Object.assign(new Error("timeout after acceptance"), { status: 504 });
  };
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0, checkpoint });
  ok("journal: intent is saved before order submission", journalSeen);
  ok("journal: accepted timeout is adopted without replacement", wb.placed.length === 1 && ledger.trades[id].entryAttempts[0].status === "SUBMITTED");
  wb.fill(wb.placed[0].client_order_id, 5);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: saved, nowMs: T0 + 60000, checkpoint }));
  ok("journal: recovered fill does not create another order", wb.placed.length === 1 && ledger.trades[id].state === "open");
}
{
  const wb = fakeWebull(), e = longCall(), id = pickTradeId(e);
  const original = wb.placeOrder; let networkFails = true, sentIds = [];
  wb.placeOrder = async (a, orders) => { sentIds.push(orders[0].client_order_id); if (networkFails) throw Object.assign(new Error("timeout before acceptance"), { status: 0 }); return original(a, orders); };
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0 });
  ok("unknown submission is retained rather than rejected", ledger.trades[id].entryAttempts[0].status === "UNKNOWN");
  networkFails = false;
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: structuredClone(ledger), nowMs: T0 + 60000 }));
  ok("unknown submission replays identical intent and ID", ledger.trades[id].entryAttempts.length === 1 && sentIds.length === 2 && sentIds[0] === sentIds[1] && wb.placed.length === 1);
}
{
  const wb = fakeWebull(), e = longCall(), id = pickTradeId(e);
  let mutations = 0; wb.placeOrder = async () => { mutations++; };
  ok("journal: checkpoint failure prevents the order", await throwsAsync(() => runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0, checkpoint: async () => { throw new Error("store down"); } })) && mutations === 0);
  let { ledger } = await runWebullMirror({ client: fakeWebull(), accountId: "PAPER1", acc: accWith([e]), nowMs: T0, placeOrders: false });
  ok("account identity cannot change underneath a ledger", await throwsAsync(() => runWebullMirror({ client: wb, accountId: "OTHER", acc: accWith([e]), ledger, nowMs: T0 + 60000 })));
  const budget = await runWebullMirror({ client: fakeWebull(), accountId: "PAPER1", acc: accWith([e]), nowMs: T0, budgetMs: 0 });
  ok("budget exhaustion checkpoints and alerts without ordering", budget.summary.placed === 0 && budget.summary.alerts > 0 && budget.ledger.reconciliation.status === "incomplete");
}
{
  const e = longCall(), id = pickTradeId(e), wb = fakeWebull();
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0 });
  wb.fill(wb.placed[0].client_order_id, 5);
  const positions = wb.positions;
  wb.positions = async () => [...await positions(), { instrument_type: "EQUITY", symbol: "NVDA", quantity: "100" }];
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [{ ...e, status: "expired", optionPnlPct: -100 }]), ledger, nowMs: T0 + 60000 }));
  ok("assignment: changed stock exposure pauses entries and unsafe exits", ledger.reconciliation.status === "attention" && ledger.reconciliation.alerts.some((a) => /assignment/.test(a)) && wb.placed.length === 1);
  ok("assignment: never submits an unsolicited stock liquidation", wb.placed.every((o) => o.instrument_type === "OPTION"));
  wb.positions = async () => { throw new Error("positions down"); };
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 120000 }));
  ok("reconciliation: unavailable broker snapshot fails closed", ledger.reconciliation.status === "unavailable" && wb.placed.length === 1);
  wb.positions = async () => ({});
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 180000 }));
  ok("reconciliation: malformed positions cannot mean flat", ledger.reconciliation.status === "unavailable" && ledger.trades[id].openQty === 1);
}
{
  const e = creditPut(), id = pickTradeId(e), wb = fakeWebull();
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0 });
  wb.fill(wb.placed[0].client_order_id, 1.2);
  const positions = wb.positions;
  wb.positions = async () => (await positions()).filter((p) => Number(p.legs[0].strike_price) === 240);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [{ ...e, status: "hit-tp-prem", optionPnlPct: 50 }]), ledger, nowMs: T0 + 60000 }));
  ok("reconciliation: missing spread wing blocks a blind combo close", ledger.reconciliation.status === "attention" && wb.placed.length === 1 && ledger.trades[id].openQty === 1);
}
{
  ok("calendar: Thanksgiving is closed", !isRegularSession(Date.parse("2026-11-26T16:00:00Z")));
  ok("calendar: Black Friday closes at 13 ET", isRegularSession(Date.parse("2026-11-27T17:59:00Z")) && !isRegularSession(Date.parse("2026-11-27T18:00:00Z")));
  ok("calendar: observed July 3 holiday skipped", previousTradingDate("2026-07-06") === "2026-07-02");
  ok("calendar: unknown years and invalid dates fail closed", sessionForDate("2029-01-02") === null && sessionForDate("2026-99-99") === null);
  const t = { legs: [{ expiry: "2026-12-18" }] };
  ok("expiry: first mirror on Wednesday closes ahead of Friday expiry", !expiryControl(t, Date.parse("2026-12-15T20:00:00Z")).due && expiryControl(t, Date.parse("2026-12-16T15:00:00Z")).due);
  ok("expiry: holiday shifts two-session cutoff", expiryControl({ legs: [{ expiry: "2026-11-30" }] }, Date.parse("2026-11-25T19:30:00Z")).due);
  ok("expiry: early close cutoff is 11:30 ET", expiryControl({ legs: [{ expiry: "2026-12-01" }] }, Date.parse("2026-11-27T16:30:00Z")).due);
  ok("expiry: verified last trading date keeps a session buffer", expiryControl({ legs: [{ expiry: "2026-12-18", lastTradingDate: "2026-12-18" }] }, Date.parse("2026-12-17T19:30:00Z")).due);
}
{
  const e = longCall(), id = pickTradeId(e), wb = fakeWebull();
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0 });
  wb.fill(wb.placed[0].client_order_id, 5);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: Date.parse("2026-12-16T16:00:00Z"), quoteFn: async () => ({ bid: 1.1, ask: 1.3 }) }));
  ok("expiry: morning build closes on cutoff date while engine stays open", wb.placed.length === 2 && wb.placed[1].side === "SELL" && wb.placed[1].limit_price === "1.10" && ledger.trades[id].mirrorCloseReason === "expiry-control");
  // The DAY exit expires without filling; broker later reports flat. This is
  // exposure settlement, not an execution at our hoped-for limit.
  wb.orders.get(wb.placed[1].client_order_id).status = "EXPIRED";
  wb.positions = async () => [];
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: Date.parse("2026-12-18T21:05:00Z") }));
  ok("expiry: one flat snapshot waits for settlement confirmation", ledger.trades[id].state === "settlement-pending" && ledger.trades[id].paperPnlPct === null);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: Date.parse("2026-12-18T21:10:00Z") }));
  ok("expiry: confirmed flat has no invented closing fill or profit", ledger.trades[id].state === "settled" && ledger.trades[id].openQty === 0 && ledger.trades[id].paperPnlPct === null && ledger.trades[id].closeFillPrice === null && wb.placed.length === 2);
}
{
  const e = longCall({ entryDate: "2026-12-16T19:30:00Z" }), wb = fakeWebull();
  const result = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e], [], e.entryDate), nowMs: Date.parse(e.entryDate) });
  ok("expiry: no entry opened at the expiry cutoff", wb.placed.length === 0 && result.ledger.trades[pickTradeId(e)].state === "missed");
}
{
  const unrelated = { options: { "MSFT|2026-12-18|CALL|300": 2 }, equities: { AAPL: 5 }, unsigned: {} };
  const ledger = emptyLedger();
  const check = reconcilePositions(ledger, unrelated, "now");
  ok("baseline: unrelated holdings are preserved", check.status === "matched" && ledger.positionBaseline.equities.AAPL === 5 && ledger.positionBaseline.options["MSFT|2026-12-18|CALL|300"] === 2);
  ok("positions: OCC contract parsing", parsePositions([{ instrument_type: "OPTION", symbol: "NVDA261218C00190000", quantity: "2" }]).options["NVDA|2026-12-18|CALL|190"] === 2);
  ok("positions: pagination refuses an incomplete snapshot", await throwsAsync(() => parsePositions({ data: [], pagination_key: "more" })));
  ok("positions: adjusted contracts require review", await throwsAsync(() => parsePositions([{ instrument_type: "OPTION", symbol: "NVDA261218C00190000", quantity: "1", option_contract_multiplier: "10" }])));
}
{
  // Conditional writes model the R2 ETag contract under racing owners.
  let value = null, etag = null, sequence = 0, time = 0;
  const options = { now: () => time, read: async () => value && ({ value: structuredClone(value), etag }),
    write: async (next, match) => { if (match !== etag) return null; value = structuredClone(next); etag = String(++sequence); return etag; } };
  let entered = 0, release;
  const gate = new Promise((r) => { release = r; });
  const first = withObjectLease(options, async () => { entered++; await gate; return "done"; });
  await new Promise((r) => setImmediate(r));
  const second = await withObjectLease(options, async () => { entered++; });
  ok("lease: competing writer cannot enter", second.busy && entered === 1);
  release(); await first;
  const third = await withObjectLease(options, async () => "next");
  ok("lease: a released lease can be acquired", !third.busy && third.result === "next");
  await withObjectLease(options, async (guard) => { time = 110000; ok("lease: guard stops before expiry", await throwsAsync(guard)); });
  time = 200000;
  await withObjectLease(options, async () => {
    time += 130000;
    await withObjectLease(options, async () => { value = { owner: "successor", expiresAt: 999999 }; etag = String(++sequence); });
  });
  ok("lease: stale owner release cannot erase successor", value.owner === "successor" && value.expiresAt === 999999);
  value = { owner: "broken" }; etag = String(++sequence);
  let invalidCode;
  try { await withObjectLease(options, async () => { throw new Error("must not run"); }); }
  catch (err) { invalidCode = err.code; }
  ok("lease: corrupt expiry fails closed with a specific error", invalidCode === "LEASE_INVALID");
  ok("lease: Owner diagnostics omit ownership tokens", !JSON.stringify(describeObjectLease({ value, etag }, time)).includes("broken"));
  value = { owner: "expired", expiresAt: time - 1 }; etag = String(++sequence);
  let conflicts = 0;
  const raced = await withObjectLease({ ...options, write: async (next, match) => {
    if (conflicts++ === 0) { etag = String(++sequence); return null; }
    return options.write(next, match);
  } }, async () => "recovered");
  ok("lease: re-reads and acquires after a conditional-write race", raced.result === "recovered");
  let conflictCode;
  try { await withObjectLease({ ...options, write: async () => null }, async () => { throw new Error("must not run"); }); }
  catch (err) { conflictCode = err.code; }
  ok("lease: repeated conflicts report a fault, not an active writer", conflictCode === "LEASE_CONFLICT");
}

{
  // Recovery after a manual TSLA entry must neither buy it again nor invent
  // a fill from a holdings snapshot. Exercise the actual mirror runner.
  const e = { symbol: "TSLA", side: "put", entryDate: "2026-10-23T15:03:00Z", contract: {
    structure: "debit_vertical", expiry: EXP, netDebit: 20.38,
    legs: [{ qty: 1, type: "put", strike: 390, expiry: EXP }, { qty: -1, type: "put", strike: 345, expiry: EXP }],
  } };
  const wb = fakeWebull();
  wb.positions = async () => [
    { instrument_type: "OPTION", symbol: "TSLA261218P00390000", quantity: "1", position_side: "LONG" },
    { instrument_type: "OPTION", symbol: "TSLA261218P00345000", quantity: "1", position_side: "SHORT" },
  ];
  const nowMs = Date.parse("2026-10-23T19:00:00Z"), id = pickTradeId(e);
  const ledger = { ...emptyLedger(), goLiveIso: "2026-10-21T19:04:00Z", positionBaseline: { options: {}, equities: {} } };
  const result = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e], [], e.entryDate), ledger, nowMs });
  ok("manual TSLA: existing spread blocks duplicate submission", result.summary.placed === 0 && wb.placed.length === 0 && result.ledger.reconciliation.status === "attention");
  ok("manual TSLA: holdings do not fabricate execution data", result.ledger.trades[id].filledQty === 0 && result.ledger.trades[id].fillPrice == null);
}


{
  const e = longCall(), id = pickTradeId(e), wb = fakeWebull();
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0 });
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], []), ledger, nowMs: T0 + 60000 }));
  ok("orphan: missing engine row cancels queued entry without replacing it", wb.placed.length === 1 && wb.cancelled.length === 1 && ledger.trades[id].state === "missed");
}
{
  const e = longCall(), id = pickTradeId(e), wb = fakeWebull();
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0 });
  wb.fill(wb.placed[0].client_order_id, 5);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 60000 }));
  const realPositions = wb.positions; wb.positions = async () => [];
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 120000 }));
  ok("manual close: first flat snapshot cannot create profit", ledger.trades[id].state === "settlement-pending" && ledger.trades[id].paperPnlPct === null);
  wb.positions = realPositions;
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 180000 }));
  ok("position lag: recovered holdings reset the flat observation", ledger.trades[id].state === "open" && !ledger.trades[id].flatSinceIso);
  wb.positions = async () => [];
  for (const offset of [240000, 300000]) ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + offset }));
  ok("manual close: verified flat clears exposure without an invented price", ledger.trades[id].state === "settled" && ledger.trades[id].openQty === 0 && ledger.trades[id].closeFillPrice === null && ledger.reconciliation.status === "matched");
}
{
  const e = longCall(), id = pickTradeId(e), wb = fakeWebull(); let saved = null, crash = true;
  const checkpoint = async (l) => {
    const a = l.trades[id]?.entryAttempts?.[0];
    if (crash && a?.status === "SENT") { crash = false; throw new Error("process died after broker acceptance"); }
    saved = structuredClone(l);
  };
  ok("crash: post-submit save failure propagates", await throwsAsync(() => runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0, checkpoint })));
  ok("crash: durable snapshot retains the prepared intent", saved.trades[id].entryAttempts[0].status === "PREPARED" && wb.placed.length === 1);
  wb.fill(wb.placed[0].client_order_id, 5);
  const { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger: saved, nowMs: T0 + 60000, checkpoint });
  ok("crash: restart adopts the fill using the saved ID", ledger.trades[id].state === "open" && wb.placed.length === 1);
}
{
  const ledger = { trades: { legacy: { tradeId: "legacy", state: "closed", fillPrice: 5, closeFillPrice: 6, structure: "long", entryAttempts: [], exitAttempts: [] } } };
  ok("legacy: owner CSV retains closed fills before migration", ledgerToFillRows(ledger)[0].your_pnl_pct === 20 && ledgerToFillRows(ledger)[0].qty === 1);
}


{
  const e = longCall(), id = pickTradeId(e), wb = fakeWebull();
  let { ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0 });
  wb.fill(wb.placed[0].client_order_id, 5);
  const closed = { ...e, status: "hit-tp-prem", optionPnlPct: 25 };
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closed]), ledger, nowMs: T0 + 60000 }));
  const last = ledger.trades[id].exitAttempts[0];
  ledger.trades[id].exitAttempts = [...Array.from({ length: 11 }, (_, i) => ({ ...last, n: i + 1, status: "CANCELLED", clientOrderId: "old-" + i })), { ...last, n: 12 }];
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closed]), ledger, nowMs: T0 + 120000 }));
  ok("exit budget: last DAY order remains working, not cancelled", wb.cancelled.length === 0 && wb.placed.length === 2 && ledger.trades[id].needsReview);
  ({ ledger } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([], [closed]), ledger, nowMs: T0 + 24 * H, quoteFn: async () => ({ bid: 6, ask: 6.2 }) }));
  ok("exit budget: next session resumes remaining-quantity protection", wb.placed.length === 3 && wb.placed[2].quantity === "1" && wb.placed[2].side === "SELL");
}


{
  const e = longCall(), wb = fakeWebull();
  let { ledger, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), nowMs: T0 });
  ok("build window: initial submitted entry requests a follow-up", summary.followUpNeeded === true);
  wb.fill(wb.placed[0].client_order_id, 5);
  ({ ledger, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 120000 }));
  ok("build window: fully filled quiet book ends follow-ups", summary.followUpNeeded === false);
  const e2 = longCall({ symbol: "MSFT", entryDate: new Date(T0 + 130000).toISOString() });
  const newSnapshot = new Date(T0 + 140000).toISOString();
  ({ ledger, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e, e2], [], newSnapshot), ledger, nowMs: T0 + 150000 }));
  ok("build window: fresh publication bypasses same-snapshot minute throttle", !summary.skipped && wb.placed.some((o) => o.symbol === "MSFT") && ledger.engineSnapshotIso === newSnapshot);
}

console.log(`\n${pass}/${pass + fail} checks passed.`);
if (fail) process.exit(1);
