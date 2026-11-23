// Offline test for the Webull paper call limits (lib/webull-quota.mjs) and
// how the mirror keeps inside them (2026-11-23, 15 new engine trades a run).
// A fake Webull answers 429 past 30 calls a minute on an endpoint, like the
// sandbox. No network.
// Run: node scripts/webull-quota-smoke.mjs
import assert from "node:assert/strict";
import { makeCallQuota, quotaClient, QUOTA_PER_WINDOW, EXIT_RESERVE } from "../lib/webull-quota.mjs";
import { runWebullMirror, emptyLedger } from "../lib/webull-mirror.mjs";

let pass = 0;
const ok = async (name, fn) => {
  try { await fn(); pass++; }
  catch (err) { console.error(`FAIL ${name}: ${err?.stack || err}`); process.exitCode = 1; }
};

await ok("quota: counts per endpoint over a sliding minute, kept in the log", () => {
  let t = 1000000;
  const log = {};
  const q = makeCallQuota(log, { now: () => t, limit: 3 });
  assert.ok(q.take("placeOrder") && q.take("placeOrder") && q.take("placeOrder"));
  assert.equal(q.take("placeOrder"), false, "fourth call in the minute");
  assert.equal(q.left("previewOrder"), 3, "endpoints count apart");
  assert.equal(log.placeOrder.length, 3, "the log carries the calls (saved with the ledger)");
  // A new run reads the same log: the limit spans runs.
  const q2 = makeCallQuota(log, { now: () => t + 30000, limit: 3 });
  assert.equal(q2.left("placeOrder"), 0);
  assert.equal(q2.fits({ placeOrder: 1 }), false);
  t += 60001;
  const q3 = makeCallQuota(log, { now: () => t, limit: 3 });
  assert.equal(q3.left("placeOrder"), 3, "calls older than a minute drop out");
  assert.equal(log.placeOrder.length, 0, "old calls are pruned from the log");
  assert.ok(q3.fits({ placeOrder: 2, previewOrder: 3 }) && !q3.fits({ placeOrder: 4 }));
});

await ok("quota client: a call with no room is refused before it is sent", async () => {
  let sent = 0;
  const raw = { placeOrder: async () => { sent++; return {}; }, accountList: async () => ["A"] };
  const c = quotaClient(raw, makeCallQuota({}, { now: () => 0, limit: 1 }));
  await c.placeOrder();
  await assert.rejects(c.placeOrder(), (e) => e.code === "RUN_BUDGET" && e.quota === "placeOrder");
  assert.equal(sent, 1);
  assert.deepEqual(await c.accountList(), ["A"], "unlimited calls pass straight through");
});

// A fake sandbox: 30 calls a minute per endpoint, then 429 (not processed).
function fakeSandbox(sim) {
  const orders = new Map(), calls = {}, over = [];
  const limited = (ep, fn) => async (...args) => {
    const list = (calls[ep] ||= []).filter((ms) => ms > sim.t - 60000);
    calls[ep] = list;
    if (list.length >= 30) { over.push(ep); throw Object.assign(new Error(`Webull ${ep}: too many requests`), { status: 429 }); }
    list.push(sim.t);
    return fn(...args);
  };
  return {
    orders, over, calls,
    accountList: async () => [{ account_id: "PAPER1" }],
    positions: limited("positions", async () => {
      const net = new Map();
      for (const order of orders.values()) {
        const qty = Number(order.filled_quantity || 0);
        if (!qty) continue;
        for (const l of order.body.legs) {
          const key = [l.symbol, l.option_expire_date, l.option_type, l.strike_price].join("|");
          const prior = net.get(key) || { instrument_type: "OPTION", symbol: l.symbol, quantity: 0, legs: [{ ...l, quantity: 0 }] };
          prior.legs[0].quantity += (l.side === "BUY" ? qty : -qty);
          prior.quantity = prior.legs[0].quantity; delete prior.legs[0].side;
          net.set(key, prior);
        }
      }
      return [...net.values()].filter((p) => p.quantity);
    }),
    previewOrder: limited("previewOrder", async () => ({ estimated_transaction_fee: "0.65" })),
    placeOrder: limited("placeOrder", async (acct, list) => { const o = list[0]; orders.set(o.client_order_id, { status: "SUBMITTED", body: o }); return {}; }),
    orderDetail: limited("orderDetail", async (acct, id) => { const o = orders.get(id); if (!o) throw new Error("not found"); return { orders: [{ client_order_id: id, status: o.status, filled_quantity: o.filled_quantity || "0", filled_price: o.filled_price ?? null, filled_time_at: o.filled_time_at ?? null }] }; }),
    cancelOrder: limited("cancelOrder", async (acct, id) => { const o = orders.get(id); if (o) o.status = "CANCELLED"; return {}; }),
  };
}
const EXP = Date.UTC(2026, 11, 18) / 1000;
const SYMS = "AAPL MSFT NVDA AMZN GOOGL META TSLA AMD AVGO ORCL CRM ADBE NFLX INTC MU QCOM TXN AMAT LRCX KLAC SNOW PLTR UBER SHOP PANW CRWD ZS NET DDOG OKTA".split(" ");
const trades = (n) => SYMS.slice(0, n).map((s, i) => ({ symbol: s, side: "call", entryDate: "2026-10-21T15:00:00.000Z", contract: { structure: "long", strike: 100 + i, expiry: EXP, mid: 2.0 } }));
const acc = (n) => ({ builtAtIso: "2026-10-21T15:02:00Z", open: trades(n), closed: [] });
const T0 = Date.parse("2026-10-21T15:10:00Z"); // Wed 11:10 ET
const quoteFn = async (t) => ({ bid: t.engineEntryPrice, ask: t.engineEntryPrice });
const stuck = (L) => Object.values(L.trades).flatMap((t) => [...t.entryAttempts, ...t.exitAttempts]).filter((a) => ["PREPARED", "UNKNOWN"].includes(a.status) || a.lookupFailed);
const sentCount = (L) => Object.values(L.trades).filter((t) => t.entryAttempts.some((a) => a.status === "SUBMITTED" || a.status === "SENT")).length;

await ok("mirror: 15 engine trades plus 6 Top Picks go out in one run, inside the limit", async () => {
  const sim = { t: T0 }, wb = fakeSandbox(sim);
  const { ledger: L, summary } = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: acc(21), nowMs: T0, clock: () => 0, quoteFn });
  assert.equal(sentCount(L), 21);
  assert.deepEqual(wb.over, [], "no call past Webull's limit");
  assert.equal(summary.alerts, 0);
  assert.equal(stuck(L).length, 0);
  assert.equal(summary.webullCalls.placeOrder, 21);
  assert.equal(L.webullCalls.placeOrder.length, 21, "the calls are kept in the ledger for the next run");
});

await ok("mirror: past the limit, the rest waits for the follow-up run (no 429, no paused entries)", async () => {
  const sim = { t: T0 }, wb = fakeSandbox(sim);
  const r1 = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: acc(30), nowMs: T0, clock: () => 0, quoteFn });
  const first = QUOTA_PER_WINDOW - EXIT_RESERVE;
  assert.equal(sentCount(r1.ledger), first, "entries stop with orders left over for exits");
  assert.deepEqual(wb.over, []);
  assert.equal(stuck(r1.ledger).length, 0, "no unsent or unconfirmed order");
  assert.equal(r1.summary.alerts, 0, "waiting is not an alert");
  assert.equal(r1.summary.followUpNeeded, true, "the build window follows up");
  assert.ok(r1.summary.warnings["entry waiting for the next run - Webull call limit"] >= 30 - first);
  assert.ok(Object.values(r1.ledger.trades).filter((t) => !t.entryAttempts.length).every((t) => /call limit/.test(t.note)));
  // The build window's follow-up, two minutes later.
  sim.t = T0 + 120000;
  const r2 = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: acc(30), ledger: r1.ledger, nowMs: sim.t, clock: () => 0, quoteFn });
  assert.equal(sentCount(r2.ledger), 30, "the rest went out");
  assert.deepEqual(wb.over, []);
  assert.equal(stuck(r2.ledger).length, 0);
  assert.equal(r2.summary.alerts, 0);
  assert.ok(Object.values(r2.ledger.trades).every((t) => !/call limit/.test(t.note || "")), "the waiting note clears once sent");
});

await ok("mirror: the limit spans runs a minute apart", async () => {
  const sim = { t: T0 }, wb = fakeSandbox(sim);
  const r1 = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: acc(20), nowMs: T0, clock: () => 0, quoteFn });
  assert.equal(sentCount(r1.ledger), 20);
  // 30 s later (a manual run): the 20 orders still count.
  sim.t = T0 + 61000 - 31000;
  const more = { ...acc(30), builtAtIso: "2026-10-21T15:02:00Z" };
  const r2 = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: more, ledger: r1.ledger, nowMs: sim.t + 31000, clock: () => 0, quoteFn });
  assert.deepEqual(wb.over, []);
  assert.equal(stuck(r2.ledger).length, 0);
});

await ok("mirror: a time-budget stop never leaves a written but unsent order", async () => {
  const sim = { t: T0 }, wb = fakeSandbox(sim);
  // The budget runs out the moment the third order's intent is saved (the
  // worst spot: after the intent, before the order call).
  let now = 0, prepared = 0;
  const checkpoint = async (L) => {
    const n = Object.values(L.trades).flatMap((t) => t.entryAttempts).filter((a) => a.status === "PREPARED").length;
    if (n && ++prepared === 3) now = 50000;
  };
  const r = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: acc(12), nowMs: T0, clock: () => now, budgetMs: 40000, quoteFn, checkpoint });
  assert.match(r.summary.note || "", /Time budget/);
  assert.ok(sentCount(r.ledger) > 0 && sentCount(r.ledger) < 12, `sent ${sentCount(r.ledger)}`);
  assert.equal(stuck(r.ledger).length, 0, "every written order was sent");
  assert.equal(r.summary.alerts, 1, "only the incomplete-run alert");
  assert.equal(r.summary.followUpNeeded, true);
  // A second stopped run in a row is still one alert, so the window keeps going.
  now = 0; prepared = 0;
  const r2 = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: acc(12), ledger: r.ledger, nowMs: T0 + 120000, clock: () => now, budgetMs: 40000, quoteFn, checkpoint });
  assert.equal(r2.summary.alerts, 1);
  assert.equal(stuck(r2.ledger).length, 0);
  assert.equal(r2.summary.followUpNeeded, true);
});

await ok("mirror: an exit never waits behind entries", async () => {
  const sim = { t: T0 }, wb = fakeSandbox(sim);
  // Fill one order, then open 26 more and close the filled one in the same run.
  const r1 = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: acc(1), nowMs: T0, clock: () => 0, quoteFn });
  const [id] = Object.keys(r1.ledger.trades), t = r1.ledger.trades[id];
  const o = wb.orders.get(t.entryAttempts[0].clientOrderId); o.status = "FILLED"; o.filled_quantity = String(o.body.quantity); o.filled_price = "2.00"; o.filled_time_at = "2026-10-21T15:10:30.000Z";
  sim.t = T0 + 120000;
  const all = acc(28);
  const closedRow = { ...all.open[0], exitDate: "2026-10-21T15:11:00.000Z", status: "hit-tp-prem", optionPnlPct: 25 };
  const next = { ...all, open: all.open.slice(1), closed: [closedRow] };
  const r2 = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: next, ledger: r1.ledger, nowMs: sim.t, clock: () => 0, quoteFn: async (x) => (x.tradeId === id ? { bid: 2.5, ask: 2.55 } : { bid: x.engineEntryPrice, ask: x.engineEntryPrice }) });
  const closing = r2.ledger.trades[id];
  assert.ok(closing.exitAttempts.length === 1, `exit sent (state ${closing.state}, note ${closing.note})`);
  assert.deepEqual(wb.over, []);
  assert.equal(stuck(r2.ledger).length, 0);
});

await ok("mirror: with more working orders than the limit reads in a minute, positions and exits still run", async () => {
  // Audit 2026-11-23: the opening pass read every working order first; past
  // 27 of them every run stopped there, before positions and exits.
  const sim = { t: T0 }, wb = fakeSandbox(sim);
  let a = acc(30), L;
  for (let i = 0; i < 2; i++) { sim.t = T0 + i * 120000; L = (await runWebullMirror({ client: wb, accountId: "PAPER1", acc: a, ledger: L, nowMs: sim.t, clock: () => 0, quoteFn })).ledger; }
  assert.equal(sentCount(L), 30, "30 orders working");
  const [id] = Object.keys(L.trades), t0 = L.trades[id];
  const o = wb.orders.get(t0.entryAttempts[0].clientOrderId); o.status = "FILLED"; o.filled_quantity = String(o.body.quantity); o.filled_price = "2.00"; o.filled_time_at = "2026-10-21T15:13:00.000Z";
  a = { ...a, builtAtIso: "2026-10-21T15:15:00Z", open: a.open.slice(1), closed: [{ ...a.open[0], exitDate: "2026-10-21T15:15:00.000Z", status: "hit-tp-prem", optionPnlPct: 25 }] };
  sim.t = T0 + 240000;
  const r = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: a, ledger: L, nowMs: sim.t, clock: () => 0, quoteFn });
  assert.equal(r.summary.note, null, "the run finished: no call-limit stop");
  assert.ok(r.summary.readsDeferred > 0, "some order reads wait for the next run");
  assert.equal(r.ledger.trades[id].exitAttempts.length, 1, "the exit went out");
  assert.deepEqual(wb.over, []);
  assert.equal(r.summary.alerts, 0); assert.equal(r.summary.followUpNeeded, true);
  // The next run reads the orders this one skipped first.
  sim.t = T0 + 360000;
  const r2 = await runWebullMirror({ client: wb, accountId: "PAPER1", acc: a, ledger: r.ledger, nowMs: sim.t, clock: () => 0, quoteFn });
  assert.deepEqual(wb.over, []); assert.equal(r2.summary.note, null);
  const stale = Object.values(r2.ledger.trades).filter((t) => t.lastRefreshedIso && Date.parse(t.lastRefreshedIso) < T0 + 240000);
  assert.equal(stale.length, 0, "every order has been read within two runs");
});

console.log(`Webull call limits: ${pass} checks passed (${QUOTA_PER_WINDOW} calls a minute per endpoint, ${EXIT_RESERVE} kept for exits).`);
