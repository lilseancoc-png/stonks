// Exercise the shipped order lifecycle with an in-memory broker and store.
// Never loads credentials or contacts Webull, Yahoo, or the production ledger.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runWebullMirror, ledgerToTestTrades, ledgerToFillRows, fillRowsToCsv, emptyLedger, newTrade, buildOrder, updateQuantities, orderAttemptsToCsv } from "../lib/webull-mirror.mjs";
import { executionPrice, endOfDayWindow } from "../lib/webull-execution-policy.mjs";
import { runEndOfDayWindow } from "../lib/webull-mirror-window.mjs";
import { pickTradeId } from "../lib/pick-trade-text.mjs";

const EXP = Date.UTC(2026, 11, 18) / 1000;
const pick = { symbol: "TEST", side: "call", entryDate: "2026-10-28T19:33:00Z", contract: { structure: "debit_vertical", netDebit: 1, expiry: EXP,
  legs: [{ qty: 1, strike: 100, type: "call", expiry: EXP }, { qty: -1, strike: 110, type: "call", expiry: EXP }] } };
const id = pickTradeId(pick), start = Date.parse("2026-10-28T19:35:00Z");
function fixture() {
  const orders = new Map(), submitted = [], cancelled = [];
  let ledger, saved, delayCancel = false, quote = { bid: 0.9, ask: 1.15 };
  const client = {
    accountList: async () => [{ account_id: "PAPER" }],
    positions: async () => {
      const net = new Map();
      for (const o of orders.values()) for (const l of o.body.legs) {
        const key = l.strike_price, qty = (l.side === "BUY" ? 1 : -1) * o.filledQty;
        net.set(key, { leg: l, qty: (net.get(key)?.qty || 0) + qty });
      }
      return [...net.values()].filter(v => v.qty).map(v => ({ instrument_type: "OPTION", symbol: "TEST", quantity: v.qty,
        legs: [{ ...v.leg, quantity: v.qty, side: undefined }] }));
    },
    placeOrder: async (_, list) => {
      const body = list[0];
      const intent = [...saved.trades[id].entryAttempts, ...saved.trades[id].exitAttempts].find(a => a.clientOrderId === body.client_order_id);
      assert.equal(intent.status, "PREPARED", "intent must be persisted before a broker mutation");
      assert(!orders.has(body.client_order_id), "never submit a new duplicate order");
      orders.set(body.client_order_id, { body, status: "SUBMITTED", filledQty: 0 }); submitted.push(body);
    },
    orderDetail: async (_, coid) => {
      const o = orders.get(coid); if (!o) throw new Error("not found");
      return { orders: [{ client_order_id: coid, status: o.status, filled_quantity: String(o.filledQty),
        filled_price: o.fillPrice ?? null, filled_time_at: o.fillIso ?? null, order_id: o.brokerOrderId,
        ...(o.feeActual != null ? { fees: [{ actual_value: String(o.feeActual) }], commission: {} } : {}) }] };
    },
    cancelOrder: async (_, coid) => {
      const o = orders.get(coid); cancelled.push(coid); o.cancelRequested = true;
      if (!delayCancel) o.status = "CANCELLED";
    },
  };
  const acc = { builtAtIso: pick.entryDate, open: [pick], closed: [] };
  return { orders, submitted, cancelled, client, acc,
    get ledger() { return ledger; }, get saved() { return saved; },
    quote(q) { quote = q; }, delay(v) { delayCancel = v; },
    fill(index, price, quantity = 1) { const o = orders.get(submitted[index].client_order_id); o.status = quantity === Number(o.body.quantity) ? "FILLED" : "PARTIAL_FILLED"; o.filledQty = quantity; o.fillPrice = price; o.fillIso = "2026-10-28T19:52:00Z"; },
    async run(nowMs, extra = {}) {
      const r = await runWebullMirror({ client, accountId: "PAPER", acc, ledger, nowMs, quoteFn: async () => quote,
        checkpoint: async l => { saved = structuredClone(l); }, clock: () => 0, ...extra });
      ledger = r.ledger; return r;
    },
  };
}

// Calendar handles ordinary close, early close, DST, holidays and unknown years.
assert.equal(endOfDayWindow(Date.parse("2026-10-28T19:49:59Z")).due, false);
assert.equal(endOfDayWindow(Date.parse("2026-10-28T19:50:00Z")).due, true);
assert.equal(endOfDayWindow(Date.parse("2026-11-27T17:50:00Z")).due, true);
assert.equal(endOfDayWindow(Date.parse("2026-11-27T18:00:00Z")).trading, false);
assert.equal(endOfDayWindow(Date.parse("2026-12-01T20:50:00Z")).due, true);
assert.equal(endOfDayWindow(Date.parse("2026-11-26T20:50:00Z")).due, false);
assert.equal(endOfDayWindow(Date.parse("2029-01-02T20:50:00Z")).due, false);

const t = { engineEntryPrice: 1, engineExitPrice: 1.25, structure: "debit_vertical", legs: [{ strike: 100 }, { strike: 110 }] };
assert.equal(executionPrice(t, { phase: "entry", stage: 0, quote: { bid: 1, ask: 1.01 } }).limit, 1.01);
assert.equal(executionPrice(t, { phase: "entry", stage: 1, quote: { bid: 1, ask: 1.12 } }).limit, 1.04);
assert.equal(executionPrice(t, { phase: "entry", stage: "eod-entry", quote: { bid: 1, ask: 1.12 } }).limit, 1.05);
assert.equal(executionPrice(t, { phase: "exit", stage: 0, quote: { bid: 1.1, ask: 1.4 } }).limit, 1.23);
assert.equal(executionPrice(t, { phase: "exit", stage: 1, quote: { bid: 1.1, ask: 1.4 } }).limit, 1.2);
assert.equal(executionPrice(t, { phase: "exit", emergency: true, quote: { bid: 0.1, ask: 1.4 } }).limit, 0.01);
assert.equal(executionPrice(t, { phase: "entry", stage: 0, quote: null }), null);
assert.equal(executionPrice(t, { phase: "exit", emergency: true, quote: { bid: -1, ask: 1 } }), null);
const credit = { ...t, structure: "credit_vertical" };
assert.equal(executionPrice(credit, { phase: "entry", stage: 0, quote: { bid: 0.9, ask: 1.1 } }).limit, 0.98);
assert.equal(executionPrice(credit, { phase: "exit", emergency: true, quote: { bid: 0.9, ask: 1.1 } }).limit, 10);
for (const reference of [0.17, 0.99, 1.01, 9.67, 14.18, 26.42, 50.65]) for (const stage of [0, 1, "eod-entry"]) {
  const p = stage === "eod-entry" ? 5 : stage ? 4 : 2;
  const plan = executionPrice({ ...t, engineEntryPrice: reference, legs: [{ strike: 0 }, { strike: 200 }] }, { phase: "entry", stage, quote: { bid: 0.01, ask: reference * 2 } });
  assert(plan.limit <= reference * (1 + p / 100) + 1e-9, "tick rounding must preserve the buy ceiling");
  if (stage !== "eod-entry") {
    const sell = executionPrice({ ...t, engineExitPrice: reference }, { phase: "exit", stage, quote: { bid: 0.01, ask: reference * 2 } });
    assert(sell.limit >= reference * (1 - p / 100) - 1e-9, "tick rounding must preserve the sell floor");
  }
}
assert.equal(executionPrice({ ...t, engineEntryPrice: 3, legs: [{ strike: 100 }] }, { phase: "entry", stage: 0, quote: { bid: 3, ask: 3.33 } }).limit, 3.05, "nickel rounding cannot overspend the cap");

// Cancellation acknowledgement lag does not consume the second price stage.
{
  const f = fixture(), t = newTrade(pick, id); t.requestedQty = 3;
  await f.run(start, { ledger: { ...emptyLedger(), accountId: "PAPER", goLiveIso: pick.entryDate, trades: { [id]: t } } });
  f.fill(0, 1.01, 1); f.orders.get(f.submitted[0].client_order_id).fillIso = "2026-10-28T19:35:10Z";
  f.orders.get(f.submitted[0].client_order_id).feeActual = 0.03;
  f.quote({ bid: 1, ask: 1.01 });
  await f.run(start + 60000);
  const o = f.orders.get(f.submitted[0].client_order_id);
  o.fillPrice = null; o.fillIso = null; o.feeActual = null;
  await f.run(start + 120000);
  assert.equal(f.ledger.trades[id].fillPrice, 1.01, "an unchanged cumulative fill retains its confirmed price when a later response omits it");
  assert.equal(f.ledger.trades[id].entryAttempts[0].feeActual, 0.03);
  f.fill(0, 1.015, 2); o.fillIso = null;
  await f.run(start + 180000);
  assert.equal(f.ledger.trades[id].fillIso, null, "a larger fill without a broker timestamp cannot reuse the earlier partial-fill time");
  assert.equal(f.ledger.trades[id].entryAttempts[0].feeActual, null, "a larger cumulative fill cannot reuse the earlier partial fee total");
  f.fill(0, 1.02, 3); o.fillIso = null; o.brokerOrderId = "broker-evidence-1";
  await f.run(start + 240000);
  const a = f.ledger.trades[id].entryAttempts[0];
  assert.equal(a.observations.filter(o => o.kind === "broker-detail").at(-1).filledQty, 3);
  assert(a.observations.some(o => o.filledQty === 1 && o.filledPrice === 1.01));
  assert(a.observations.some(o => o.filledQty === 2 && o.filledPrice === 1.015));
  o.fillIso = "2026-10-28T19:38:30Z"; o.feeActual = 0.12;
  await f.run(start + 360000);
  assert.equal(f.ledger.trades[id].fillIso, o.fillIso, "terminal fills can backfill their actual broker time and fees");
  const count = a.observations.length;
  await f.run(start + 420000);
  assert.equal(a.observations.length, count, "identical confirmed totals are not duplicated after another check");
  assert.match(orderAttemptsToCsv(f.ledger), /broker-evidence-1/);
  assert.match(orderAttemptsToCsv(f.ledger), /observations_json/);
  const dto = ledgerToTestTrades(f.ledger)[0];
  assert.equal(dto.attempts[0].observations.length, count);
  const mixed = structuredClone(f.ledger.trades[id]);
  mixed.entryAttempts = [{ quantity: 1, filledQty: 1, filledPrice: 1, filledIso: o.fillIso }, { quantity: 1, filledQty: 1, filledPrice: 1.01, filledIso: null }];
  updateQuantities(mixed); assert.equal(mixed.fillIso, null, "completion time requires timestamps for every contributing fill");
}
const f = fixture();
await f.run(start); assert.equal(f.submitted[0].limit_price, "1.02");
await f.run(start + 60000); assert.equal(f.submitted.length, 1);
f.delay(true);
await f.run(start + 120000); assert.equal(f.submitted.length, 1); assert.equal(f.ledger.trades[id].entryAttempts.length, 1);
f.orders.get(f.submitted[0].client_order_id).status = "CANCELLED";
await f.run(start + 180000); assert.equal(f.submitted[1].limit_price, "1.04");
await f.run(start + 300000); assert.equal(f.submitted.length, 2); assert.equal(f.cancelled.length, 1, "final normal order keeps working");
f.delay(false);
await f.run(Date.parse("2026-10-28T19:50:00Z"), { endOfDayOnly: true });
assert.equal(f.submitted[2].limit_price, "1.05");
assert.equal(f.ledger.trades[id].entryEndOfDayUsed, true);
await f.run(Date.parse("2026-10-28T19:51:00Z"), { endOfDayOnly: true });
assert.equal(f.submitted.length, 3, "EOD entry is attempted once and monitored");
f.fill(2, 1.03);
await f.run(Date.parse("2026-10-28T19:52:00Z"), { endOfDayOnly: true });
assert.equal(f.ledger.trades[id].fillPrice, 1.03);
assert.match(f.ledger.trades[id].labels.join(" "), /3.0% above engine/);
assert.equal(f.ledger.trades[id].state, "open");

// Site closes: 2% then 4%, and the close deadline removes the normal floor.
f.acc.open = []; f.acc.closed = [{ ...pick, exitDate: "2026-10-28T19:52:00Z", status: "hit-tp-prem", optionPnlPct: 25 }];
f.quote({ bid: 0.9, ask: 1.3 });
await f.run(Date.parse("2026-10-28T19:53:00Z"));
assert.equal(f.submitted[3].limit_price, "0.01", "a new close signal inside the final ten minutes goes straight to emergency pricing");
assert.equal(f.ledger.trades[id].emergencyExitUsed, true);
assert.equal(f.ledger.trades[id].emergencyExitFilled, false);
assert.equal(f.ledger.trades[id].state, "exiting");
await f.run(Date.parse("2026-10-28T19:54:00Z"), { endOfDayOnly: true });
assert.equal(f.submitted.length, 4, "a pending emergency is polled, not duplicated");
f.fill(3, 0.92);
await f.run(Date.parse("2026-10-28T19:55:00Z"), { endOfDayOnly: true });
const done = f.ledger.trades[id];
assert.equal(done.state, "closed"); assert.equal(done.emergencyExitFilled, true);
assert.equal(done.closeFillPrice, 0.92); assert.equal(done.exitDiffPct, -26.4);
assert.equal(ledgerToFillRows(f.ledger)[0].exit_slippage_pct, 26.4, "debit adverse slippage matches the screen");
assert.equal(ledgerToFillRows(f.ledger)[0].exit_price_difference_pct, -26.4);
assert.equal(ledgerToFillRows({ trades: { x: { ...done, structure: "credit_vertical" } } })[0].exit_slippage_pct, -26.4, "credit buyback signs retain their economic direction");
const view = ledgerToTestTrades(f.ledger)[0];
assert.equal(view.attempts.length, 4); assert.equal(view.emergencyExitFilled, true);
assert(!JSON.stringify(view).includes("clientOrderId"));
assert.match(fillRowsToCsv(ledgerToFillRows(f.ledger)), /emergency_exit_filled/);
assert.match(view.labels.join(" "), /Emergency end-of-day exit: broker-confirmed fill/);
const partialEmergency = structuredClone(done);
partialEmergency.state = "exiting";
partialEmergency.requestedQty = partialEmergency.entryAttempts.at(-1).quantity = partialEmergency.entryAttempts.at(-1).filledQty = 2;
updateQuantities(partialEmergency);
assert.equal(partialEmergency.openQty, 1);
assert.match(partialEmergency.labels.join(" "), /broker-confirmed partial fill; exposure remains open/);

// Ordinary exits preserve price boundaries, then the deadline supersedes them.
const n = fixture(); await n.run(start); n.fill(0, 1.01);
n.acc.open = []; n.acc.closed = [{ ...pick, exitDate: "2026-10-28T19:36:00Z", status: "hit-tp-prem", optionPnlPct: 25 }];
n.quote({ bid: 1.1, ask: 1.4 });
await n.run(start + 60000); assert.equal(n.submitted[1].limit_price, "1.23");
await n.run(start + 180000); assert.equal(n.submitted[2].limit_price, "1.20");
await n.run(start + 300000); assert.equal(n.submitted.length, 3);
await n.run(Date.parse("2026-10-28T19:50:00Z")); assert.equal(n.submitted[3].limit_price, "0.01");

// A site-closed pick cannot receive a late entry; a previous day's missed pick
// cannot become a new automatic entry tomorrow (manual adoption is separate).
const closedFirst = fixture(); await closedFirst.run(start);
closedFirst.acc.open = []; closedFirst.acc.closed = [{ ...pick, exitDate: "2026-10-28T19:40:00Z", optionPnlPct: 0 }];
await closedFirst.run(Date.parse("2026-10-28T19:50:00Z"));
assert.equal(closedFirst.submitted.length, 1); assert.equal(closedFirst.ledger.trades[id].state, "missed");
const stale = fixture(); await stale.run(start);
stale.orders.get(stale.submitted[0].client_order_id).status = "CANCELLED";
await stale.run(Date.parse("2026-10-29T15:00:00Z"));
assert.equal(stale.submitted.length, 1, "yesterday's cancelled order cannot become a new automatic entry");
assert.match(ledgerToFillRows(stale.ledger)[0].notes, /no automatic next-day entry/, "CSV retains the actual missed-entry reason across checks");
const staleIntent = fixture(); await staleIntent.run(start);
staleIntent.ledger.trades[id].entryAttempts[0].status = "UNKNOWN";
staleIntent.orders.clear();
await staleIntent.run(Date.parse("2026-10-29T13:30:00Z"));
assert.equal(staleIntent.submitted.length, 1, "yesterday's unacknowledged intent cannot replay into tomorrow's manual entry");
assert(staleIntent.ledger.trades[id].needsReview, "uncertain prior order needs broker evidence, not an invented cancellation");
const unavailable = fixture(); unavailable.quote(null); await unavailable.run(start);
assert.equal(unavailable.submitted.length, 0, "missing quotes are explicit, not fabricated execution");
await unavailable.run(Date.parse("2026-10-28T20:00:10Z"), { endOfDayOnly: true });
assert.match(ledgerToFillRows(unavailable.ledger)[0].skip_reason, /Quote unavailable/);
assert.equal(ledgerToTestTrades(unavailable.ledger)[0].decisions[0].phase, "entry");
const preCutoff = fixture(); await preCutoff.run(Date.parse("2026-10-28T19:45:00Z"), { endOfDayOnly: true });
assert.equal(preCutoff.submitted.length, 0);
{
  const enriched = fixture(); await enriched.run(start); enriched.fill(0, 1.01);
  await enriched.run(start + 60000);
  enriched.client.orderDetail = async () => { throw Error("fee/time enrichment temporarily unavailable"); };
  enriched.acc.open = []; enriched.acc.closed = [{ ...pick, exitDate: "2026-10-28T19:37:00Z", optionPnlPct: 25 }];
  await enriched.run(start + 180000);
  assert.equal(enriched.submitted.length, 2, "unavailable optional metadata must not block a confirmed holding's exit");
  assert.equal(enriched.ledger.trades[id].entryAttempts[0].lookupFailed, false);
}

// Fill/cancel races must close only the remaining quantity.
const race = fixture(); await race.run(start);
race.client.cancelOrder = async (_, coid) => { const o = race.orders.get(coid); o.status = "FILLED"; o.filledQty = 1; o.fillPrice = 1.01; };
await race.run(start + 120000);
assert.equal(race.submitted.length, 1); assert.equal(race.ledger.trades[id].state, "open");

// No fabricated overnight close when the emergency never executes.
await n.run(Date.parse("2026-10-28T20:00:01Z"), { endOfDayOnly: true });
assert.equal(n.ledger.trades[id].state, "exiting"); assert(n.ledger.trades[id].needsReview);
assert.equal(n.ledger.trades[id].closeFillPrice, null);

// A broker fill reported tomorrow must clear only the transient EOD status
// review and bind the real v3 group, so the mirror can manage future exits.
{
  const t = newTrade(pick, id), body = buildOrder(t, "entry", 1.05, "late-entry");
  t.entryAttempts = [{ phase: "entry", n: 1, clientOrderId: "late-entry", quantity: 1, filledQty: 0, status: "SENT",
    sentIso: "2026-10-28T19:59:00Z", limit: 1.05, policyStage: "eod-entry", order: body }];
  const initial = { ...emptyLedger(), accountId: "PAPER", goLiveIso: pick.entryDate, trades: { [id]: t } };
  let filled = false;
  const client = { accountList: async () => [{ account_id: "PAPER" }],
    orderDetail: async () => ({ orders: [{ client_order_id: "late-entry", status: filled ? "FILLED" : "SUBMITTED", total_quantity: "1", filled_quantity: filled ? "1" : "0",
      filled_price: filled ? "1.03" : null, filled_time_at: filled ? "2026-10-28T19:59:30Z" : null, legs: body.legs }] }),
    positions: async () => filled ? [{ position_id: "late-position", symbol: "TEST", instrument_type: "OPTION", quantity: "1", option_strategy: "VERTICAL",
      legs: body.legs.map((l, i) => ({ symbol: l.symbol, leg_id: "late-leg-" + i, option_type: l.option_type, option_expire_date: l.option_expire_date,
        option_exercise_price: l.strike_price, option_contract_multiplier: "100", option_contract_deliverable: "100" })) }] : [],
    placeOrder: async () => { throw Error("no new orders expected"); } };
  const args = { client, accountId: "PAPER", acc: { builtAtIso: pick.entryDate, open: [pick], closed: [] } };
  const ended = await runWebullMirror({ ...args, ledger: initial, nowMs: Date.parse("2026-10-28T20:00:10Z"), endOfDayOnly: true });
  assert.equal(ended.ledger.trades[id].reviewCode, "EOD_ORDER_UNCONFIRMED");
  const unrelated = structuredClone(ended.ledger);
  unrelated.trades[id].reviewCode = null; unrelated.trades[id].note = "Unrelated exposure requires review";
  const preOpen = structuredClone(initial); preOpen.trades[id].needsReview = false; preOpen.trades[id].reviewCode = null;
  const morning = await runWebullMirror({ ...args, ledger: preOpen, nowMs: Date.parse("2026-10-29T12:00:00Z"), endOfDayOnly: true });
  assert.equal(morning.ledger.trades[id].needsReview, false, "a pre-open read is not an end-of-day failure");
  filled = true;
  const late = await runWebullMirror({ ...args, ledger: ended.ledger, nowMs: Date.parse("2026-10-29T15:00:00Z") });
  assert.equal(late.ledger.trades[id].needsReview, false); assert.equal(late.ledger.trades[id].state, "open");
  assert.equal(late.ledger.trades[id].brokerPosition.positionId, "late-position"); assert.equal(late.ledger.reconciliation.status, "matched");
  const stillReviewed = await runWebullMirror({ ...args, ledger: unrelated, nowMs: Date.parse("2026-10-29T15:00:00Z") });
  assert.equal(stillReviewed.ledger.trades[id].needsReview, true, "unrelated review flags cannot be erased by a late fill");
  for (const code of ["CANCEL_UNCONFIRMED", null]) {
    const cancelled = structuredClone(initial), t = cancelled.trades[id];
    cancelled.lastRunIso = "2026-10-28T19:40:00Z";
    t.state = "entering"; t.brokerPosition = null;
    Object.assign(t.entryAttempts[0], { status: "SENT", filledQty: 0, lastEvidenceCheckIso: null });
    t.entryAttempts[0].cancelFails = 3; t.needsReview = true; t.reviewCode = code;
    t.note = "couldn't confirm the entry order was cancelled; check Webull by hand";
    let exits = 0;
    const closedAcc = { ...args.acc, open: [], closed: [{ ...pick, exitDate: "2026-10-28T19:48:00Z", optionPnlPct: 25 }] };
    const emergency = await runWebullMirror({ ...args, acc: closedAcc, ledger: cancelled, nowMs: Date.parse("2026-10-28T19:50:00Z"),
      client: { ...client, placeOrder: async (_, orders) => { exits++; assert.equal(orders[0].limit_price, "0.01"); } }, quoteFn: async () => ({ bid: 1, ask: 1.1 }) });
    assert.equal(exits, 1, "terminal broker fill clears only cancellation review and permits the emergency exit");
    assert.equal(emergency.ledger.trades[id].needsReview, false);
  }
}

// End-of-day runner remains bounded, waits through a quiet pre-cutoff book,
// and performs a final status read after close. No real sleeps or requests.
let now = Date.parse("2026-11-27T17:48:00Z"), calls = 0;
const w = await runEndOfDayWindow({ now: () => now, session: endOfDayWindow, sleep: async ms => { now += ms; },
  trigger: async () => { calls++; return { ok: true, body: { ran: true, summary: { followUpNeeded: false } } }; } });
assert.equal(w.checks, 13); assert.equal(calls, 13);
assert.equal(w.afterCloseChecked, true);
assert.equal((await runEndOfDayWindow({ now: () => Date.parse("2026-11-26T17:50:00Z"), session: endOfDayWindow, trigger: async () => { throw Error("holiday must skip"); } })).checks, 0);
now = Date.parse("2026-11-27T17:59:00Z"); calls = 0;
const retried = await runEndOfDayWindow({ now: () => now, session: endOfDayWindow, sleep: async ms => { now += ms; },
  trigger: async () => { calls++; return calls <= 2 ? { ok: false, body: null } : calls === 3 ? { ok: true, body: { ran: false, reason: "mirror already running" } } : { ok: true, body: { ran: true, summary: {} } }; } });
assert.equal(retried.checks, 4, "transient failures and a concurrent final writer get a bounded final grace period");
assert.equal(retried.response.body.ran, true);
assert.equal(retried.afterCloseChecked, true);
now = Date.parse("2026-11-27T17:59:00Z");
const invalid = await runEndOfDayWindow({ now: () => now, session: endOfDayWindow, sleep: async ms => { now += ms; }, trigger: async () => ({ ok: true, body: null }) });
assert.equal(invalid.checks, 4, "invalid JSON cannot be accepted as the final reconciliation");
assert.equal(invalid.afterCloseChecked, false);
now = Date.parse("2026-11-27T18:00:10Z"); calls = 0;
const brokerRetry = await runEndOfDayWindow({ now: () => now, allowPostClose: true, session: endOfDayWindow, sleep: async ms => { now += ms; },
  trigger: async () => ({ ok: true, body: { ran: true, summary: ++calls === 1 ? { errors: 1, alerts: 1 } : {} } }) });
assert.equal(brokerRetry.checks, 2, "server-internal broker failures also receive final grace retries");
const interrupted = fixture(); let tick = 0;
const cutoffRun = await interrupted.run(Date.parse("2026-10-28T19:59:00Z"), { endOfDayOnly: true, budgetMs: 1, clock: () => tick++ * 100 });
assert.equal(cutoffRun.summary.endOfDayDeadlineObserved, false, "a budget-exhausted run cannot claim deadline processing completed");
await interrupted.run(Date.parse("2026-10-28T20:00:10Z"), { endOfDayOnly: true });
assert.equal(interrupted.ledger.lastEndOfDayAudit.deadlineObserved, false, "a clean post-close audit cannot hide the missing deadline");

// Execute the actual workflow entry point with a virtual clock and fake fetch.
// This verifies exit status and delayed-dispatch reporting without credentials.
function eodCli(at, schedule = "40,50 19 * * 1-5", summary = { endOfDayDeadlineObserved: true }) {
  const code = `
    let at = Date.parse(process.env.FAKE_NOW), calls = 0;
    Date.now = () => at;
    globalThis.setTimeout = (fn, ms) => { at += ms; fn(); return 0; };
    globalThis.fetch = async (url, options) => {
      if (url.searchParams.get("mode") !== "eod" || options.method !== "POST" || !options.headers.Authorization.startsWith("Bearer ")) throw Error("invalid trigger");
      calls++;
      return { ok: true, status: 200, json: async () => ({ ran: true, summary: JSON.parse(process.env.FAKE_SUMMARY) }) };
    };
    await import("./scripts/webull-eod-trigger.mjs");
    console.log(JSON.stringify({ calls }));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: new URL("../", import.meta.url), encoding: "utf8",
    env: { ...process.env, R2_SECRET_ACCESS_KEY: "offline-test-secret", WEBULL_EOD_SCHEDULE: schedule, FAKE_NOW: at, FAKE_SUMMARY: JSON.stringify(summary) } });
  return { ...r, calls: JSON.parse(r.stdout.trim().split("\n").at(-1)).calls };
}
const closingRun = eodCli("2026-10-28T19:59:00Z");
assert.equal(closingRun.status, 0); assert.equal(closingRun.calls, 2);
const lateRun = eodCli("2026-10-28T20:04:00Z", undefined, {});
assert.equal(lateRun.status, 1); assert.equal(lateRun.calls, 1, "a missed deadline still performs the final broker audit");
assert.equal(eodCli("2026-10-28T20:04:00Z", undefined, { endOfDayDeadlineObserved: true }).status, 0, "queued catch-up after a completed deadline is not a false failure");
assert.equal(eodCli("2026-10-28T19:59:00Z", undefined, { alerts: 1 }).status, 1, "unresolved exposure is visible to the scheduler");
assert.equal(eodCli("2026-10-28T19:59:00Z", undefined, {}).status, 1, "a run started before close still requires a completed deadline check");
assert.equal(eodCli("2028-07-03T16:59:00Z", "40,50 16 * * 1-5").status, 0);
assert.equal(eodCli("2026-11-26T20:50:00Z", "40,50 20 * * 1-5").calls, 0);
assert.equal(eodCli("2026-10-28T18:50:00Z", "40,50 18 * * 1-5").calls, 0);
console.log("Webull execution policy: caps, quote clipping, cancellation lag/races, EOD entry/exit, real fill provenance, stale entries, and early-close monitoring passed offline.");
