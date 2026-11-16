#!/usr/bin/env node
// Strategy engines x Webull paper mirror (node scripts/engines-mirror-smoke.mjs).
// One paper account, several records: engine trades get their own tagged
// ledger rows, the same contract is never bought twice, the holder and the
// follower are both labeled, an unreadable engine record never disturbs Top
// Picks, and the reports split by record. A fake Webull stands in for the
// API. No network, no store.
import assert from "node:assert/strict";
import {
  runWebullMirror as runActual, mergeEngineTrades, scopeLedger, mirrorTradeId, sourceName,
  ledgerToFillRows, ledgerToTestTrades, fillRowsToCsv, orderAttemptsToCsv,
} from "../lib/webull-mirror.mjs";
import { mirrorHealth } from "../lib/webull-mirror-health.mjs";
import { webullEngineRecord } from "../lib/track-record-reset.mjs";
import { expiryControl } from "../lib/us-equity-calendar.mjs";
import { pickTradeId } from "../lib/pick-trade-text.mjs";
import { stepBook, emptyRecord, emptyState } from "../lib/engines/book.mjs";
import { pickContract, quoteContract, expiryExitDate } from "../lib/engines/contracts.mjs";
import { ENGINES, ENGINE_IDS, engineName } from "../lib/engines/config.mjs";
import { bsPrice } from "../lib/greeks.mjs";

let passed = 0;
const ok = async (name, fn) => { try { await fn(); passed++; } catch (err) { console.error(`FAIL ${name}\n  ${err?.stack || err}`); process.exitCode = 1; } };
const run = (args) => runActual({ clock: () => 0, quoteFn: async (t) => ({ bid: t.engineExitPrice || t.engineEntryPrice, ask: t.engineExitPrice || t.engineEntryPrice }), ...args });

function fakeWebull() {
  const orders = new Map(), placed = [], cancelled = [];
  return {
    orders, placed, cancelled,
    accountList: async () => [{ account_id: "PAPER1" }],
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
      o.status = "CANCELLED"; cancelled.push(id);
      return {};
    },
    fill(id, price) { const o = orders.get(id); o.filled_quantity = String(o.body.quantity); o.status = "FILLED"; o.filled_price = String(price); o.filled_time_at = "2026-11-16T16:12:00.000Z"; },
    fillAll(price = null) { for (const [id, o] of orders) if (o.status === "SUBMITTED") this.fill(id, price ?? Number(o.body.limit_price)); },
  };
}

const EXP = Date.UTC(2026, 11, 18) / 1000;               // Fri Dec 18 2026
const T0 = Date.parse("2026-11-16T16:10:00Z");           // Mon 11:10 ET
const MIN = 60000, H = 60 * MIN;
const BUILT = "2026-11-16T16:02:00.000Z";
const flag = (symbol, o = {}) => ({ symbol, side: "call", entryDate: "2026-11-16T16:00:00.000Z", contract: { structure: "long", strike: 100, expiry: EXP, mid: 4 }, ...o });
const eng = (engine, symbol, o = {}) => {
  const tag = ENGINES[engine].tag;
  return { engine, tag, tradeId: `${tag}:${symbol}-C-11/16/26-11:00`, symbol, side: "call", entryDate: "2026-11-16T16:00:00.000Z",
    contract: { structure: "long", optionType: "call", strike: 100, expiry: EXP, mid: 4 }, optionPnlPct: 0, ...o };
};
const closedRow = (e, o = {}) => ({ ...e, status: "take-profit", exitDate: "2026-11-17T16:00:00.000Z", optionPnlPct: 30, ...o });
const accOf = (open = [], closed = [], builtAtIso = BUILT) => ({ builtAtIso, open, closed });
const engOf = (open = [], closed = [], builtAtIso = BUILT) => ({ version: 1, builtAtIso, open, closed });
const merged = (acc, er, ledger, opts) => mergeEngineTrades(acc, er, ledger, opts);

await ok("ids: Top Picks rows keep their entry-time ID, engine rows their tagged ID", () => {
  const f = flag("AAA"), e = eng("technicals", "AAA");
  assert.equal(mirrorTradeId(f), pickTradeId(f));
  assert.equal(mirrorTradeId(e), "TEC:AAA-C-11/16/26-11:00");
  assert.notEqual(mirrorTradeId(f), mirrorTradeId(e));
  for (const id of ENGINE_IDS) assert.equal(sourceName(id), engineName(id), id);
  assert.equal(sourceName(null), "Top Picks");
});

await ok("merge: Top Picks first, then engine rows, followers last; malformed rows dropped", () => {
  const acc = accOf([flag("AAA")], []);
  const er = engOf([eng("flow", "CCC", { noMirror: true }), eng("technicals", "BBB"), { engine: "macro", symbol: "X" }], [closedRow(eng("reversion", "DDD"))]);
  const m = merged(acc, er, null);
  assert.deepEqual(m.open.map((e) => e.symbol), ["AAA", "BBB", "CCC"]);
  assert.equal(m.closed.length, 1);
  assert.equal(acc.open.length, 1, "the Top Picks record itself is not changed");
  assert.deepEqual(merged(acc, null, null).open, acc.open);
  assert.equal(merged({ open: null }, er, null).open, null);
});

await ok("one account: Top Picks and three engines open on different contracts, each on its own ledger row", async () => {
  const wb = fakeWebull();
  const acc = accOf([flag("AAA")]);
  const er = engOf([eng("technicals", "BBB"), eng("macro", "SPY"), eng("earnings", "CCC", { side: "put", tradeId: "ERN:CCC-P-11/16/26-11:00", contract: { structure: "long", optionType: "put", strike: 90, expiry: EXP, mid: 2.5 } })]);
  let { ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: merged(acc, er, null), ledger: null, nowMs: T0 });
  assert.equal(summary.placed, 4);
  assert.equal(new Set(wb.placed.map((o) => o.client_order_id)).size, 4);
  assert.deepEqual(Object.keys(ledger.trades).sort(), [pickTradeId(flag("AAA")), "ERN:CCC-P-11/16/26-11:00", "MAC:SPY-C-11/16/26-11:00", "TEC:BBB-C-11/16/26-11:00"].sort());
  assert.equal(ledger.trades["TEC:BBB-C-11/16/26-11:00"].engine, "technicals");
  assert.equal(ledger.trades[pickTradeId(flag("AAA"))].engine, undefined);
  assert.equal(wb.placed.find((o) => o.symbol === "CCC").legs[0].option_type, "PUT");
  wb.fillAll();
  ({ ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: merged(acc, er, ledger), ledger, nowMs: T0 + 3 * MIN }));
  assert.ok(Object.values(ledger.trades).every((t) => t.state === "open" && t.openQty === 1));
  assert.equal(ledger.reconciliation.status, "matched");
  // The Technicals engine closes; only its position is sold.
  const er2 = engOf([er.open[1], er.open[2]], [closedRow(er.open[0])], "2026-11-17T16:02:00.000Z");
  ({ ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf([flag("AAA")], [], "2026-11-17T16:02:00.000Z"), er2, ledger), ledger, nowMs: T0 + 24 * H }));
  const exits = wb.placed.filter((o) => o.position_intent === "SELL_TO_CLOSE");
  assert.equal(exits.length, 1); assert.equal(exits[0].symbol, "BBB");
  const t = ledger.trades["TEC:BBB-C-11/16/26-11:00"];
  assert.equal(t.engineCloseReason, "take-profit"); assert.equal(t.enginePnlPct, 30); assert.equal(t.engineExitPrice, 5.2);
  wb.fillAll();
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf([flag("AAA")], [], "2026-11-17T16:02:00.000Z"), er2, ledger), ledger, nowMs: T0 + 24 * H + 3 * MIN }));
  assert.equal(ledger.trades["TEC:BBB-C-11/16/26-11:00"].state, "closed");
  assert.equal(ledger.trades["TEC:BBB-C-11/16/26-11:00"].paperPnlPct, 30);
  assert.equal(ledger.reconciliation.status, "matched");
  // Reports split by record.
  const flagRows = ledgerToFillRows(scopeLedger(ledger, "flagship")), engRows = ledgerToFillRows(scopeLedger(ledger, "engines"));
  assert.equal(flagRows.length, 1); assert.equal(flagRows[0].engine, "");
  assert.deepEqual(engRows.map((r) => r.engine).sort(), ["earnings", "macro", "technicals"]);
  assert.equal(ledgerToFillRows(scopeLedger(ledger, "all")).length, 4);
  assert.equal(ledgerToTestTrades(scopeLedger(ledger, "engines")).find((x) => x.tradeId.startsWith("TEC:")).engine, "technicals");
  assert.match(fillRowsToCsv(engRows).split("\n")[0], /,engine$/);
  assert.match(orderAttemptsToCsv(scopeLedger(ledger, "engines")).split("\n")[1], /,technicals$|,macro$|,earnings$/);
  // The comparison record for the engines view carries engine rows only.
  const cmp = webullEngineRecord({ builtAtIso: er2.builtAtIso, open: er2.open, closed: er2.closed }, scopeLedger(ledger, "engines"));
  assert.equal(cmp.open.length, 2); assert.equal(cmp.closed.length, 1);
  assert.equal(webullEngineRecord(accOf([flag("AAA")]), scopeLedger(ledger, "flagship")).open.length, 1);
});

await ok("same contract, engine follows Top Picks: recorded and labeled, not bought twice", async () => {
  const wb = fakeWebull();
  const f = flag("AAA"), fid = pickTradeId(f);
  const follower = eng("technicals", "AAA", { noMirror: true, shared: { role: "follower", heldBy: "flagship", heldById: fid } });
  let { ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf([f]), engOf([follower]), null), ledger: null, nowMs: T0 });
  assert.equal(summary.placed, 1, "one order for one contract");
  const t = ledger.trades[follower.tradeId];
  assert.equal(t.state, "skipped");
  assert.deepEqual(t.sharedContract, { heldBy: "flagship", heldById: fid });
  assert.match(t.note, /Same contract is held by Top Picks \(AAA-C-11\/16\/26-11:00\): recorded on its own track record, not bought twice\./);
  assert.deepEqual(ledger.trades[fid].sharedWith.map((x) => [x.source, x.tradeId]), [["technicals", follower.tradeId]]);
  wb.fillAll();
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf([f]), engOf([follower]), ledger), ledger, nowMs: T0 + 3 * MIN }));
  assert.equal(wb.placed.length, 1);
  assert.equal(ledger.reconciliation.status, "matched");
  // The follower's row is on the engines report as a labeled skip, never a miss.
  const row = ledgerToFillRows(scopeLedger(ledger, "engines"))[0];
  assert.equal(row.skipped, "yes"); assert.match(row.skip_reason, /held by Top Picks/);
  const h = mirrorHealth({ acc: accOf([f]), ledger, engines: engOf([follower]) }, T0 + 4 * MIN);
  assert.deepEqual(h.engines, { open: 1, mirrored: 0, shared: 1, unfilled: 0, pending: 0, untracked: 0 });
  assert.ok(!h.issues.some((i) => i.code === "ENGINE_TRADES_UNTRACKED"));
});

await ok("same contract, engine follows another engine: holder buys, follower is labeled", async () => {
  const wb = fakeWebull();
  const holder = eng("technicals", "AAA"), follower = eng("flow", "AAA", { noMirror: true, shared: { role: "follower", heldBy: "technicals", heldById: holder.tradeId } });
  const { ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf(), engOf([follower, holder]), null), ledger: null, nowMs: T0 });
  assert.equal(summary.placed, 1);
  assert.equal(ledger.trades[holder.tradeId].state, "entering");
  assert.equal(ledger.trades[follower.tradeId].state, "skipped");
  assert.match(ledger.trades[follower.tradeId].note, /held by Technicals \(TEC:AAA-C-11\/16\/26-11:00\)/);
  assert.equal(ledger.trades[holder.tradeId].sharedWith[0].source, "flow");
});

await ok("same contract, Top Picks opens what an engine already holds: Top Picks' copy is labeled, the engine keeps the position", async () => {
  const wb = fakeWebull();
  const holder = eng("reversion", "AAA", { entryDate: "2026-11-16T16:00:00.000Z" });
  let { ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf(), engOf([holder]), null), ledger: null, nowMs: T0 });
  wb.fillAll();
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf(), engOf([holder]), ledger), ledger, nowMs: T0 + 3 * MIN }));
  // 15:30 ET: Top Picks opens the very same contract. Its own record cannot know.
  const f = flag("AAA", { entryDate: "2026-11-16T20:30:00.000Z" }), fid = pickTradeId(f);
  const T1 = Date.parse("2026-11-16T20:40:00Z"), built = "2026-11-16T20:32:00.000Z";
  let summary;
  ({ ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf([f], [], built), engOf([holder], [], built), ledger), ledger, nowMs: T1 }));
  assert.equal(wb.placed.length, 1, "no second buy");
  assert.equal(ledger.trades[fid].state, "skipped");
  assert.deepEqual(ledger.trades[fid].sharedContract, { heldBy: "reversion", heldById: holder.tradeId });
  assert.match(ledger.trades[fid].note, /held by Reversion/);
  assert.equal(ledger.trades[holder.tradeId].sharedWith[0].source, "flagship");
  assert.equal(ledger.trades[holder.tradeId].openQty, 1);
  assert.equal(ledger.reconciliation.status, "matched");
  // Health: a shared Top Pick is its own line, not "unfilled".
  const h = mirrorHealth({ acc: accOf([f], [], built), ledger, engines: engOf([holder], [], built) }, T1 + MIN);
  assert.equal(h.counts.sharedOpenPicks, 1); assert.equal(h.counts.missedOpenPicks, 0);
  assert.ok(!h.issues.some((i) => i.code === "OPEN_PICKS_UNFILLED"));
  assert.equal(h.engines.mirrored, 1);
  // A spread that shares one leg with a held single is treated the same way.
  const spread = flag("AAA", { entryDate: "2026-11-16T20:31:00.000Z", contract: { structure: "debit_vertical", optionType: "call", expiry: EXP, netDebit: 2, legs: [{ qty: 1, type: "call", strike: 100, expiry: EXP }, { qty: -1, type: "call", strike: 105, expiry: EXP }] } });
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf([f, spread], [], "2026-11-16T20:45:00.000Z"), engOf([holder]), ledger), ledger, nowMs: T1 + 6 * MIN }));
  assert.equal(ledger.trades[pickTradeId(spread)].state, "skipped");
  assert.equal(wb.placed.length, 1);
});

await ok("a holder on its way out is not a holder: the next trade waits for it, then buys", async () => {
  const wb = fakeWebull();
  const a = eng("technicals", "AAA");
  let { ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf(), engOf([a]), null), ledger: null, nowMs: T0 });
  wb.fillAll();
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf(), engOf([a]), ledger), ledger, nowMs: T0 + 3 * MIN }));
  // Next morning Technicals closes it and Flow opens the same contract in the same run.
  const T1 = T0 + 24 * H, built = "2026-11-17T16:02:00.000Z";
  const b = eng("flow", "AAA", { tradeId: "FLO:AAA-C-11/17/26-11:00", entryDate: "2026-11-17T16:00:00.000Z" });
  const er = engOf([b], [closedRow(a)], built);
  let summary;
  ({ ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf([], [], built), er, ledger), ledger, nowMs: T1 }));
  assert.equal(wb.placed.length, 2, "only the exit goes out");
  assert.equal(wb.placed[1].position_intent, "SELL_TO_CLOSE");
  assert.equal(ledger.trades[b.tradeId].state, "entering");
  assert.match(ledger.trades[b.tradeId].note, /^Waiting: Technicals \(TEC:AAA-C-11\/16\/26-11:00\) is closing the same contract first\.$/);
  assert.equal(summary.followUpNeeded, true);
  wb.fillAll();
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf([], [], built), er, ledger), ledger, nowMs: T1 + 3 * MIN }));
  assert.equal(ledger.trades[a.tradeId].state, "closed");
  assert.equal(wb.placed.length, 3);
  assert.equal(wb.placed[2].position_intent, "BUY_TO_OPEN");
  assert.equal(ledger.trades[b.tradeId].note, null);
  wb.fillAll();
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf([], [], built), er, ledger), ledger, nowMs: T1 + 6 * MIN }));
  assert.equal(ledger.trades[b.tradeId].state, "open");
  assert.equal(ledger.reconciliation.status, "matched");
});

await ok("ENGINES_MIRROR off: no new engine trade enters; ones already mirrored are still closed", async () => {
  const wb = fakeWebull();
  const a = eng("technicals", "AAA");
  let { ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf(), engOf([a]), null), ledger: null, nowMs: T0 });
  wb.fillAll();
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf(), engOf([a]), ledger), ledger, nowMs: T0 + 3 * MIN }));
  const T1 = T0 + 24 * H, built = "2026-11-17T16:02:00.000Z";
  const b = eng("macro", "SPY", { tradeId: "MAC:SPY-C-11/17/26-11:00", entryDate: "2026-11-17T16:00:00.000Z" });
  const off = merged(accOf([], [], built), engOf([b], [closedRow(a)], built), ledger, { mirrorNew: false });
  assert.deepEqual(off.open, []); assert.equal(off.closed.length, 1);
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: off, ledger, nowMs: T1 }));
  assert.equal(ledger.trades[b.tradeId], undefined);
  assert.equal(wb.placed.at(-1).position_intent, "SELL_TO_CLOSE");
  assert.equal(ledger.trades[a.tradeId].state, "exiting");
  assert.ok(!ledger.trades[a.tradeId].needsReview);
});

await ok("an unreadable engine record never disturbs Top Picks or flags engine positions", async () => {
  const wb = fakeWebull();
  const a = eng("technicals", "AAA"), f = flag("BBB");
  let { ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf([f]), engOf([a]), null), ledger: null, nowMs: T0 });
  wb.fillAll();
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf([f]), engOf([a]), ledger), ledger, nowMs: T0 + 3 * MIN }));
  // Next run: the engine file cannot be read. Top Picks adds a trade.
  const g = flag("CCC", { entryDate: "2026-11-16T20:30:00.000Z" });
  const T1 = Date.parse("2026-11-16T20:40:00Z"), built = "2026-11-16T20:32:00.000Z";
  let summary;
  ({ ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf([f, g], [], built), null, ledger), ledger, nowMs: T1, enginesUnavailable: true }));
  const t = ledger.trades[a.tradeId];
  assert.equal(t.state, "open"); assert.ok(!t.needsReview, "not read as missing from its record");
  assert.match(summary.note, /Engine record unavailable/);
  assert.equal(wb.placed.at(-1).symbol, "CCC", "Top Picks' new trade still goes out");
  // Without the flag the same situation is (correctly) a review item.
  const wb2 = fakeWebull();
  let r = await run({ client: wb2, accountId: "PAPER1", acc: merged(accOf(), engOf([a]), null), ledger: null, nowMs: T0 });
  wb2.fillAll();
  r = await run({ client: wb2, accountId: "PAPER1", acc: merged(accOf(), engOf([a]), r.ledger), ledger: r.ledger, nowMs: T0 + 3 * MIN });
  r = await run({ client: wb2, accountId: "PAPER1", acc: accOf([], [], built), ledger: r.ledger, nowMs: T1 });
  assert.equal(r.ledger.trades[a.tradeId].needsReview, true);
});

await ok("an engine trade opened and closed between mirror runs is logged as missed, once", async () => {
  const wb = fakeWebull();
  const a = eng("reversion", "AAA");
  let { ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf(), engOf([], [closedRow(a, { exitDate: "2026-11-16T20:30:00.000Z" })]), null), ledger: null, nowMs: T0 });
  assert.equal(ledger.trades[a.tradeId].state, "missed"); assert.equal(summary.placed, 0);
  ({ ledger } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf(), engOf([], [closedRow(a)]), ledger), ledger, nowMs: T0 + 3 * MIN }));
  assert.equal(Object.keys(ledger.trades).length, 1);
});

await ok("health: an engine trade with no mirror record is flagged only once the mirror has seen its build", () => {
  const a = eng("technicals", "AAA");
  const ledger = { goLiveIso: "2026-11-16T15:00:00.000Z", trades: {}, engineSnapshotIso: "2026-11-16T15:30:00.000Z", reconciliation: { status: "matched", alerts: [], checkedAtIso: BUILT } };
  const behind = mirrorHealth({ acc: accOf(), ledger, engines: engOf([a]) }, T0);
  assert.equal(behind.engines.untracked, 1);
  assert.ok(!behind.issues.some((i) => i.code === "ENGINE_TRADES_UNTRACKED"));
  const seen = mirrorHealth({ acc: accOf(), ledger: { ...ledger, engineSnapshotIso: BUILT }, engines: engOf([a]) }, T0);
  assert.ok(seen.issues.some((i) => i.code === "ENGINE_TRADES_UNTRACKED"));
  assert.ok(!mirrorHealth({ acc: accOf(), ledger: { ...ledger, engineSnapshotIso: BUILT }, engines: engOf([a]), enginesMirror: false }, T0).issues.some((i) => i.code === "ENGINE_TRADES_UNTRACKED"));
  assert.equal(mirrorHealth({ acc: accOf(), ledger }, T0).engines, undefined);
});

await ok("expiry: the engines close on the day the mirror's own expiry control starts", () => {
  for (const exp of ["2026-12-18", "2026-11-27", "2027-01-15", "2026-12-28"]) {
    const sec = Date.parse(exp + "T00:00:00Z") / 1000;
    const ctl = expiryControl({ legs: [{ expiry: exp }] }, T0);
    assert.equal(expiryExitDate(sec), ctl.closeDate, exp);
  }
  assert.equal(expiryExitDate(Date.parse("2026-12-18T00:00:00Z") / 1000), "2026-12-16");
  // Thanksgiving week: Friday Nov 27 expiry -> Wednesday Nov 25, then Tuesday Nov 24.
  assert.equal(expiryExitDate(Date.parse("2026-11-27T00:00:00Z") / 1000), "2026-11-24");
  // Years the exchange calendar does not cover (the history test) fall back to weekdays.
  assert.equal(expiryExitDate(Date.parse("2015-06-19T00:00:00Z") / 1000), "2015-06-17");
  assert.equal(expiryExitDate(null), null);
});

// ---- the engines' own record rows, end to end --------------------------------
function chainFor(spot, nowMs, iv = 0.35) {
  const chains = {};
  for (const dte of [16, 23, 30, 37, 44, 58, 72, 100, 128, 156]) {
    const exp = Math.floor((nowMs + dte * 86400000) / 1000), c = [], p = [];
    for (let k = 0.7; k <= 1.3001; k += 0.025) {
      const K = Math.round(spot * k * 2) / 2;
      for (const [type, col] of [["call", c], ["put", p]]) {
        const px = bsPrice(type, spot, K, dte / 365, iv, 0.045);
        if (px > 0.05) col.push({ s: K, b: +(px * 0.97).toFixed(2), a: +(px * 1.03).toFixed(2), l: +px.toFixed(2), iv, oi: 800, v: 60 });
      }
    }
    chains[exp] = { c, p };
  }
  return chains;
}
const featRow = (over = {}) => ({
  i: 400, date: "2026-11-13", c: 100, o: 99.5, h: 100.5, l: 99, v: 1.5e6, pc: 99,
  ret1: 0.01, ret3: 0.01, ret5: 0.02, ret10: 0.03, ret21: 0.05, ret63: 0.12, ret126: 0.25, ret252: 0.4,
  sma10: 99, sma20: 98, sma50: 94, sma100: 90, sma200: 85, sma50Prev: 93, sma200Prev: 84,
  sd20: 2, z20: 1, atr: 2, atrPct: 0.02, rsi14: 60, rsi2: 60, rsi2Min3: 8, rsi2Max3: 70,
  hi20p: 101, lo20p: 95, hi55p: 102, lo55p: 88, hi252: 103, lo252: 60, lo5: 98.2, hi5: 101,
  bbw: 0.08, bbwRank: 0.5, bbwRankPrev: 0.5, volRatio: 1.3, rv20: 0.3, rv60: 0.3,
  upStreak: 1, downStreak: 0, rangePos: 0.7, gap: 0.005, dayAtr: 0.5, move3Atr: 0.5, move5Atr: 1, distHi252: -0.03, ...over,
});

await ok("end to end: the book's own rows go through the mirror; a shared contract is one order and two labels", async () => {
  const nowIso = "2026-11-16T16:00:00.000Z", ms = Date.parse(nowIso);
  // One name that is both a Technicals pullback and a Reversion washout, with
  // a chain that has a single expiry so both engines must land on one contract.
  const both = featRow({ rsi2: 4, z20: -2.3, move5Atr: -3, downStreak: 4 });
  const views = { AAA: { sym: "AAA", isEtf: false, spot: 100, f: both }, BBB: { sym: "BBB", isEtf: false, spot: 100, f: featRow() } };
  const oneExpiry = Object.fromEntries(Object.entries(chainFor(100, ms)).filter(([e]) => { const d = (Number(e) * 1000 - ms) / 86400000; return d > 34 && d < 40; })
    .map(([e, v]) => [e, { c: v.c.filter((r) => r.s === 100), p: v.p.filter((r) => r.s === 100) }]));
  const data = { AAA: { spot: 100, chains: oneExpiry }, BBB: { spot: 100, chains: chainFor(100, ms) } };
  const spy = featRow({ c: 500, sma50: 480, ret63: 0.05, rsi2Min3: 50 });
  const state = emptyState(), record = emptyRecord();
  const out = stepBook(state, record, {
    nowIso, today: "2026-11-16", late: false, views, engines: ["technicals", "reversion"],
    ctx: { date: "2026-11-16", spy, byId: views, macro: null, env: { rates: "on hold" }, macroEvent: null, regime: { cell: "up-calm" }, macroState: "neutral" },
    quote: (t) => quoteContract(data[t.symbol], t.contract, { nowMs: ms }),
    pick: (view, side, spec) => pickContract(data[view.sym], side, { ...spec.contract, dteMin: 14, dteMax: 90 }, { nowMs: ms }),
    flagshipOpen: [], coverage: null,
  });
  const onAAA = out.opened.filter((t) => t.symbol === "AAA");
  assert.equal(onAAA.length, 2, "both engines open AAA");
  const holder = onAAA.find((t) => !t.noMirror), follower = onAAA.find((t) => t.noMirror);
  assert.ok(holder && follower, "one holds, one follows");
  assert.equal(follower.shared.heldBy, holder.engine); assert.equal(follower.shared.heldById, holder.tradeId);
  assert.deepEqual(holder.sharedWith.map((x) => x.tradeId), [follower.tradeId]);
  record.builtAtIso = "2026-11-16T16:02:00.000Z";
  const wb = fakeWebull();
  let { ledger, summary } = await run({ client: wb, accountId: "PAPER1", acc: merged(accOf(), record, null), ledger: null, nowMs: T0 });
  assert.equal(summary.placed, out.opened.length - 1);
  for (const t of out.opened) {
    const l = ledger.trades[t.tradeId];
    assert.ok(l, t.tradeId); assert.equal(l.engine, t.engine); assert.equal(l.engineEntryPrice, t.contract.mid);
    assert.equal(l.legs.length, 1); assert.equal(l.legs[0].strike, t.contract.strike); assert.equal(l.legs[0].type, "CALL");
    assert.equal(l.state, t.noMirror ? "skipped" : "entering");
  }
  const order = wb.placed.find((o) => o.symbol === "AAA");
  assert.equal(order.legs[0].strike_price, String(holder.contract.strike));
  assert.equal(order.legs[0].option_expire_date, new Date(holder.contract.expiry * 1000).toISOString().slice(0, 10));
  assert.equal(Number(order.limit_price) > 0, true);
});

console.log(`${passed} engine mirror checks passed${process.exitCode ? " (with failures)" : ""}`);
