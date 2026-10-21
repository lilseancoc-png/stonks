// Offline smoke test for the Webull paper mirror (lib/webull-mirror.mjs,
// lib/webull-client.mjs) and its endpoint (api/auth/[action].js
// "webull-mirror"): request signing, the sandbox-only guard, the entry/exit
// price ladder with the ±10% band, labels, idempotent order ids, the trade
// log rows and the trigger auth. A fake Webull client stands in for the API.
// No network, no data/.
// Run: node scripts/webull-mirror-smoke.mjs
import { signRequest, createWebullClient, quoteAll } from "../lib/webull-client.mjs";
import {
  runWebullMirror, buildOrder, mirrorLegs, roundTick, clientOrderId, isRegularSession, isMarketClosedError, parseOrderDetail,
  ledgerToFillRows, fillRowsToCsv, mirrorTriggerToken, makeQuoteFn, emptyLedger, LEDGER_KEY,
} from "../lib/webull-mirror.mjs";
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
      return { orders: [{ client_order_id: id, status: o.status, filled_price: o.filled_price ?? null, filled_quantity: o.status === "FILLED" ? "1" : "0", filled_time_at: o.filled_time_at ?? null }] };
    },
    cancelOrder: async (acct, id) => {
      const o = orders.get(id);
      if (!o || o.status === "FILLED") throw new Error("cannot cancel");
      o.status = "CANCELLED";
      cancelled.push(id);
      return {};
    },
    fill(id, price) { const o = orders.get(id); o.status = "FILLED"; o.filled_price = String(price); o.filled_time_at = "2026-10-21T16:00:00.000Z"; },
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
  ok("expired: no sell order, state expired", ledger.trades[id].state === "expired" && wb.placed.length === 1);
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
  ok("closed market: no try counted, trade still waiting", t.state === "entering" && t.entryAttempts.length === 0 && summary.errors === 0, JSON.stringify(t.entryAttempts));
  ok("closed market: run says why, ledger still saved", /market is closed/.test(summary.note || "") && !summary.skipped);
  ok("closed market: error is recognized", isMarketClosedError({ code: "OPENAPI_OPTION_ONLY_SUPPORT_MARKET_IN_CORE_TIME" }) && !isMarketClosedError({ code: "OPENAPI_PARAM_ERR" }));
  shut = false;
  ({ ledger, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: accWith([e]), ledger, nowMs: T0 + 24 * H }));
  ok("closed market: next session places at the engine price", summary.placed === 1 && wb.placed[0].limit_price === "5.00" && ledger.trades[id].entryAttempts.length === 1);
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
  ok("guard: stuck order flagged for a hand check", ledger.trades[id].state === "error" && /by hand/.test(ledger.trades[id].note), ledger.trades[id].state);
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
  ok("guard: order not present -> re-sent at the engine price", wb.placed.length === 2 && wb.placed[1].limit_price === "5.00" && t.entryAttempts[0].status === "REJECTED", JSON.stringify(t.entryAttempts.map((a) => a.status)));
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

console.log(`\n${pass}/${pass + fail} checks passed.`);
if (fail) process.exit(1);
