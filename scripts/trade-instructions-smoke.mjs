// node scripts/trade-instructions-smoke.mjs
// lib/trade-instructions.mjs: the order-ready Top Picks instructions behind
// the MCP's get_trade_instructions and the picks feed's ?format=json.
import assert from "node:assert/strict";
import {
  buildTradeInstructions, feedStatus, nextRunAt, sessionCloseMs, floorTick, ceilTick,
  BLOCK_CODES, RULES, ALLOWANCE_PCT,
} from "../lib/trade-instructions.mjs";
import { buildPicksFeedText } from "../lib/pick-trade-text.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const exp = (y, m, d) => Date.UTC(y, m - 1, d) / 1000;
const Z = (s) => Date.parse(s);

// ---- price steps -------------------------------------------------------------
ok("limits use a step valid on every option: $0.05 under $3, $0.10 from $3", () => {
  assert.equal(floorTick(2.48), 2.45);
  assert.equal(ceilTick(2.48), 2.5);
  assert.equal(floorTick(3.3), 3.3);
  assert.equal(ceilTick(2.98), 3);
  assert.equal(ceilTick(3.01), 3.1);
  assert.equal(floorTick(9.82), 9.8);
  assert.equal(floorTick(0.04), null, "under a nickel is no price");
  assert.equal(floorTick(-1), null);
  assert.equal(floorTick(null), null);
});

// ---- is the feed current? -----------------------------------------------------
ok("feed status follows the 11:00 / 15:30 ET runs", () => {
  // Fri 2026-11-20 (EST): 11:00 ET = 16:00Z, 15:30 ET = 20:30Z.
  assert.equal(feedStatus("2026-11-20T16:04:00Z", Z("2026-11-20T16:20:00Z")).status, "fresh");
  const pending = feedStatus("2026-11-19T20:34:00Z", Z("2026-11-20T16:20:00Z"));
  assert.equal(pending.status, "run_in_progress");
  assert.equal(pending.stale, false);
  assert.equal(pending.last_slot, "11:00");
  assert.equal(pending.check_again_at, "2026-11-20T16:25:00.000Z");
  const missed = feedStatus("2026-11-19T20:34:00Z", Z("2026-11-20T16:46:00Z"));
  assert.equal(missed.status, "missed");
  assert.equal(missed.stale, true);
  assert.equal(feedStatus(null, Z("2026-11-20T16:20:00Z")).status, "unknown");
  assert.equal(feedStatus(null, Z("2026-11-20T16:20:00Z")).stale, true);
  // A stamp from just before the slot (the run starts a few seconds early in
  // the log) still counts.
  assert.equal(feedStatus("2026-11-20T15:59:00Z", Z("2026-11-20T17:00:00Z")).status, "fresh");
  // Before the 11:00 slot the latest due run is the prior session's 15:30.
  assert.equal(feedStatus("2026-11-19T20:34:00Z", Z("2026-11-20T15:00:00Z")).status, "fresh");
  // The weekend reads Friday's 15:30.
  const wk = feedStatus("2026-11-20T20:34:20Z", Z("2026-11-22T17:00:00Z"));
  assert.equal(wk.status, "fresh");
  assert.equal(wk.last_slot, "15:30");
  assert.equal(wk.next_run_at, "2026-11-23T16:00:00.000Z");
  // Thanksgiving (closed) is skipped; the 13:00 early close has no 15:30.
  const early = feedStatus("2026-11-27T16:04:00Z", Z("2026-11-27T21:00:00Z"));
  assert.equal(early.status, "fresh");
  assert.equal(early.last_slot, "11:00");
  assert.equal(feedStatus("2026-11-25T20:34:00Z", Z("2026-11-26T18:00:00Z")).status, "fresh", "a holiday has no run");
  // Outside the known calendar: unknown, stale.
  assert.equal(feedStatus("2029-03-05T16:04:00Z", Z("2029-03-05T17:00:00Z")).status, "unknown");
  assert.equal(nextRunAt(Z("2026-11-20T20:31:00Z")), "2026-11-23T16:00:00.000Z");
  // Summer (EDT): 11:00 ET = 15:00Z.
  assert.equal(feedStatus("2026-07-14T15:04:00Z", Z("2026-07-14T15:20:00Z")).status, "fresh");
});

ok("an OPEN is valid until its own session's close", () => {
  assert.equal(new Date(sessionCloseMs("2026-11-20T16:05:00Z")).toISOString(), "2026-11-20T21:00:00.000Z");
  assert.equal(new Date(sessionCloseMs("2026-11-27T16:05:00Z")).toISOString(), "2026-11-27T18:00:00.000Z", "13:00 ET on the early close");
  assert.equal(new Date(sessionCloseMs("2026-07-14T15:05:00Z")).toISOString(), "2026-07-14T20:00:00.000Z", "16:00 EDT");
  assert.equal(sessionCloseMs("2026-11-22T16:00:00Z"), null, "a Sunday has no session");
  assert.equal(sessionCloseMs("nope"), null);
});

// ---- the record --------------------------------------------------------------
const NOW = Z("2026-11-20T16:20:00Z"); // Fri 11:20 ET
const acc = {
  builtAtIso: "2026-11-20T16:04:00Z",
  open: [
    { symbol: "MSFT", side: "call", entryDate: "2026-11-18T16:05:00Z", optionPnlPct: 10, contract: { structure: "long", strike: 500, mid: 8, expiry: exp(2026, 11, 23) } },
    { symbol: "NVDA", side: "call", entryDate: "2026-11-20T16:05:00Z", optionPnlPct: 0, contract: { structure: "long", strike: 190, mid: 4.35, expiry: exp(2026, 12, 18) } },
    { symbol: "AMZN", side: "put", entryDate: "2026-11-20T16:06:00Z", optionPnlPct: 0, contract: { structure: "debit_vertical", optionType: "put", strike: 260, longStrike: 260, shortStrike: 235, netDebit: 9.82, expiry: exp(2027, 1, 15) } },
    { symbol: "TSLA", side: "call", entryDate: "2026-11-20T16:04:30Z", optionPnlPct: 0, contract: { structure: "credit_vertical", optionType: "put", longStrike: 390, shortStrike: 400, netCredit: 3.1, expiry: exp(2026, 12, 18) } },
    { symbol: "AMD", side: "put", entryDate: "2026-11-20T16:03:00Z", optionPnlPct: 0, contract: { structure: "long", strike: 250, mid: 1.2, expiry: exp(2026, 11, 21) } },
    { symbol: "PLTR", side: "call", entryDate: "2026-11-20T16:02:00Z", optionPnlPct: 0, contract: { structure: "long", strike: 210, mid: 0.03, expiry: exp(2026, 12, 18) } },
    { symbol: "NOCONTRACT", side: "call", entryDate: "2026-11-20T16:02:00Z" },
  ],
  closed: [
    { symbol: "SMCI", side: "call", status: "hit-tp-prem", entryDate: "2026-11-09T20:36:00Z", exitDate: "2026-11-19T20:34:00Z", optionPnlPct: 31.9, contract: { structure: "long", strike: 33, mid: 2.25, expiry: exp(2027, 1, 15) } },
    { symbol: "NKE", side: "put", status: "hit-tp-prem", entryDate: "2026-11-17T20:33:00Z", exitDate: "2026-11-18T20:34:00Z", optionPnlPct: 32.9, contract: { structure: "debit_vertical", longStrike: 35, shortStrike: 32.5, netDebit: 0.99, expiry: exp(2027, 1, 15) } },
    { symbol: "XOM", side: "call", status: "expired", entryDate: "2026-10-01T15:05:00Z", exitDate: "2026-11-19T16:05:00Z", optionPnlPct: -100, contract: { structure: "long", strike: 130, mid: 1.5, expiry: exp(2026, 11, 13) } },
    { symbol: "AAPL", side: "call", status: "hit-stop-prem", entryDate: "2026-10-01T15:05:00Z", exitDate: "2026-11-10T16:05:00Z", optionPnlPct: -50, contract: { structure: "long", strike: 280, mid: 6, expiry: exp(2027, 1, 15) } },
    { symbol: "META", side: "put", status: "trail-stop", entryDate: "2026-11-02T15:05:00Z", exitDate: "2026-11-19T16:06:00Z", contract: { structure: "long", strike: 600, expiry: exp(2027, 1, 15) } },
  ],
};
const out = buildTradeInstructions(acc, { nowMs: NOW });
const by = (kind, sym) => out.instructions.find((x) => x.kind === kind && x.symbol === sym);

ok("closes first, newest first, then opens newest first; 7-day close window", () => {
  assert.deepEqual(out.instructions.map((x) => `${x.kind}:${x.symbol}`), [
    "CLOSE:SMCI", "CLOSE:META", "CLOSE:XOM", "CLOSE:NKE",
    "OPEN:AMZN", "OPEN:NVDA", "OPEN:TSLA", "OPEN:AMD", "OPEN:PLTR", "OPEN:MSFT",
  ]);
  assert.equal(out.feed.status, "fresh");
  assert.equal(out.as_of, "2026-11-20T16:04:00Z");
  assert.equal(out.counts.listed, 10);
  assert.equal(out.counts.open, 6);
  assert.equal(out.counts.close, 4);
  assert.deepEqual(out.rules, RULES);
  assert.equal(out.quantity_rule, "one_contract");
});

ok("a fresh single-leg OPEN is placeable with an exact contract and a limit range", () => {
  const x = by("OPEN", "NVDA");
  assert.equal(x.agent_placeable, true, JSON.stringify(x.blocked_by));
  assert.deepEqual(x.blocked_by, []);
  assert.equal(x.trade_id, "NVDA-C-11/20/26-11:05");
  assert.equal(x.action, "buy_to_open");
  assert.equal(x.order_type, "limit");
  assert.equal(x.time_in_force, "day");
  assert.equal(x.structure, "single");
  assert.equal(x.option_type, "call");
  assert.equal(x.expiry, "2026-12-18");
  assert.equal(x.strike, 190);
  assert.equal(x.occ_symbol, "NVDA261218C00190000");
  assert.equal(x.quantity, 1);
  assert.deepEqual(x.legs, [{ side: "buy", option_type: "call", expiry: "2026-12-18", strike: 190, occ_symbol: "NVDA261218C00190000" }]);
  assert.deepEqual(x.price, { engine: 4.35, start: 4.3, worst: 4.5, worst_is: "max", allowance_pct: ALLOWANCE_PCT, per_contract_usd: 435 });
  assert.ok(x.price.worst <= 4.35 * 1.05, "never past the allowance");
  assert.equal(x.if_unfilled, "skip");
  assert.equal(x.act_by, "2026-11-20T21:00:00.000Z");
  assert.equal(x.opened_at, "2026-11-20T16:05:00Z");
  assert.equal(x.days_to_expiry, 28);
  assert.equal(x.expiry_warning, null);
});

ok("spreads are listed but blocked as multi-leg, legs in opening order", () => {
  const amzn = by("OPEN", "AMZN");
  assert.equal(amzn.agent_placeable, false);
  assert.deepEqual(amzn.blocked_by, ["multi_leg"]);
  assert.equal(amzn.occ_symbol, null, "a spread has no single symbol");
  assert.equal(amzn.strike, null);
  assert.equal(amzn.long_strike, 260);
  assert.equal(amzn.short_strike, 235);
  assert.deepEqual(amzn.legs.map((l) => `${l.side}:${l.strike}:${l.occ_symbol}`), ["buy:260:AMZN270115P00260000", "sell:235:AMZN270115P00235000"]);
  assert.deepEqual(amzn.price, { engine: 9.82, start: 9.8, worst: 10.3, worst_is: "max", allowance_pct: 5, per_contract_usd: 982 });
  const tsla = by("OPEN", "TSLA");
  assert.equal(tsla.action, "sell_to_open");
  assert.deepEqual(tsla.legs.map((l) => `${l.side}:${l.option_type}:${l.strike}`), ["sell:put:400", "buy:put:390"]);
  assert.equal(tsla.price.worst_is, "min", "a credit is a minimum");
  assert.equal(tsla.price.start, 3.1);
  assert.equal(tsla.price.worst, 2.95);
  assert.deepEqual(tsla.blocked_by, ["multi_leg"]);
});

ok("old, near-expiry and unpriced OPENs are blocked with codes", () => {
  const msft = by("OPEN", "MSFT");
  assert.deepEqual(msft.blocked_by, ["act_by_passed"]);
  assert.equal(msft.expiry_warning, "sell_before_close_on_expiry", "held 3 days from expiry");
  assert.equal(msft.days_to_expiry, 3);
  assert.equal(msft.model_mark, 8.8);
  assert.equal(msft.model_pnl_pct, 10);
  assert.deepEqual(by("OPEN", "AMD").blocked_by, ["expires_soon"]);
  assert.deepEqual(by("OPEN", "PLTR").blocked_by, ["no_price"]);
  assert.equal(by("OPEN", "PLTR").price, null);
  assert.equal(out.instructions.find((x) => x.symbol === "NOCONTRACT"), undefined, "no contract, no instruction");
});

ok("CLOSEs carry the exit action and a floor, expired ones say none", () => {
  const smci = by("CLOSE", "SMCI");
  assert.equal(smci.agent_placeable, true);
  assert.equal(smci.action, "sell_to_close");
  assert.equal(smci.trade_id, "SMCI-C-11/09/26-15:36");
  assert.equal(smci.reason, "hit-tp-prem");
  assert.equal(smci.closed_at, "2026-11-19T20:34:00Z");
  assert.equal(smci.act_by, null, "a close never expires while listed");
  assert.deepEqual(smci.price, { engine: 2.97, start: 3, worst: 2.85, worst_is: "min", allowance_pct: 5, per_contract_usd: 297 });
  assert.equal(smci.if_unfilled, "lower_to_bid_before_close");
  const xom = by("CLOSE", "XOM");
  assert.equal(xom.action, "none");
  assert.deepEqual(xom.blocked_by, ["expired"]);
  assert.equal(xom.price, null);
  assert.equal(xom.order_type, null);
  assert.deepEqual(by("CLOSE", "NKE").blocked_by, ["multi_leg"]);
  const meta = by("CLOSE", "META");
  assert.equal(meta.price, null, "no model price");
  assert.equal(meta.agent_placeable, true, "it still closes, from the mid");
});

ok("a credit spread closes as buy_to_close with a ceiling", () => {
  const credit = { ...acc, open: [], closed: [{ symbol: "TSLA", side: "call", status: "hit-tp-prem", entryDate: "2026-11-10T16:05:00Z", exitDate: "2026-11-19T20:34:00Z", optionPnlPct: 50, contract: { structure: "credit_vertical", optionType: "put", longStrike: 390, shortStrike: 400, netCredit: 3.1, expiry: exp(2026, 12, 18) } }] };
  const x = buildTradeInstructions(credit, { nowMs: NOW }).instructions[0];
  assert.equal(x.action, "buy_to_close");
  assert.equal(x.price.engine, 1.55);
  assert.equal(x.price.worst_is, "max");
  assert.equal(x.price.start, 1.55);
  assert.equal(x.price.worst, 1.6);
  assert.equal(x.if_unfilled, "raise_to_ask_before_close");
});

ok("a missed or pending run blocks OPENs but never CLOSEs", () => {
  const late = buildTradeInstructions({ ...acc, builtAtIso: "2026-11-19T20:34:00Z" }, { nowMs: Z("2026-11-20T17:00:00Z") });
  assert.equal(late.feed.status, "missed");
  assert.deepEqual(late.instructions.find((x) => x.symbol === "NVDA").blocked_by, ["feed_stale"]);
  assert.equal(late.instructions.find((x) => x.symbol === "SMCI").agent_placeable, true);
  const pend = buildTradeInstructions({ ...acc, builtAtIso: "2026-11-19T20:34:00Z" }, { nowMs: NOW });
  assert.equal(pend.feed.status, "run_in_progress");
  assert.deepEqual(pend.instructions.find((x) => x.symbol === "NVDA").blocked_by, ["run_in_progress"]);
  assert.equal(pend.instructions.find((x) => x.symbol === "SMCI").agent_placeable, true);
});

ok("the Owner controls hold OPENs: stop, avoid-and-close, avoid", () => {
  const stopped = buildTradeInstructions(acc, { nowMs: NOW, controls: { stop: true, avoid: [], close: [] } });
  assert.equal(stopped.new_trades_stopped, true);
  assert.deepEqual(stopped.instructions.find((x) => x.symbol === "NVDA").blocked_by, ["new_trades_stopped"]);
  assert.equal(stopped.instructions.find((x) => x.symbol === "SMCI").agent_placeable, true, "closes keep coming");
  const avoided = buildTradeInstructions(acc, { nowMs: NOW, controls: { stop: false, avoid: ["NVDA", "AMZN"], close: ["NVDA"] } });
  assert.deepEqual(avoided.instructions.find((x) => x.symbol === "NVDA").blocked_by, ["owner_closing"]);
  assert.deepEqual(avoided.instructions.find((x) => x.symbol === "AMZN").blocked_by, ["multi_leg", "owner_avoid"]);
  assert.equal(avoided.new_trades_stopped, false);
});

ok("filters: kind, since, placeable only", () => {
  assert.deepEqual(buildTradeInstructions(acc, { nowMs: NOW, kind: "close" }).instructions.map((x) => x.kind), ["CLOSE", "CLOSE", "CLOSE", "CLOSE"]);
  assert.ok(buildTradeInstructions(acc, { nowMs: NOW, kind: "open" }).instructions.every((x) => x.kind === "OPEN"));
  const since = buildTradeInstructions(acc, { nowMs: NOW, since: "2026-11-20T16:04:00Z" });
  assert.deepEqual(since.instructions.map((x) => x.symbol), ["AMZN", "NVDA", "TSLA"]);
  const only = buildTradeInstructions(acc, { nowMs: NOW, placeableOnly: true });
  assert.deepEqual(only.instructions.map((x) => `${x.kind}:${x.symbol}`), ["CLOSE:SMCI", "CLOSE:META", "OPEN:NVDA"]);
  assert.equal(only.counts.matched, 10);
  assert.equal(only.counts.listed, 3);
  assert.equal(only.counts.placeable, 3);
  assert.throws(() => buildTradeInstructions(acc, { nowMs: NOW, since: "not a time" }), /since/);
  assert.throws(() => buildTradeInstructions(acc, {}), /nowMs/);
  assert.equal(buildTradeInstructions({}, { nowMs: NOW }).instructions.length, 0, "an empty record is an empty list");
});

ok("no free text: every string is a code, a date, a symbol or an id", () => {
  const strings = [];
  const walk = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(out);
  walk(buildTradeInstructions(acc, { nowMs: NOW, controls: { stop: true, avoid: ["NVDA"], close: [] } }));
  const bad = strings.filter((s) => /\s/.test(s) || s.length > 40);
  assert.deepEqual(bad, []);
  for (const x of out.instructions) for (const b of x.blocked_by) assert.ok(BLOCK_CODES.includes(b), b);
});

ok("the plain-text feed is unchanged", () => {
  const text = buildPicksFeedText(acc, { nowMs: NOW });
  assert.ok(text.startsWith("MINGSTREET TOP PICKS: TRADE LINES"));
  assert.ok(text.includes("OPEN  NVDA-C-11/20/26-11:05"));
  assert.ok(!text.includes("agent_placeable"));
});

// ---- the picks feed's ?format=json, end to end -------------------------------
// A fake R2 bucket behind a mocked fetch, set up before the store is imported.
{
  const objects = {
    "picks-accuracy.json": JSON.stringify({ ...acc, builtAtIso: new Date(Date.now() - 60_000).toISOString() }),
  };
  const seen = [];
  const realFetch = globalThis.fetch;
  Object.assign(process.env, {
    PRIVATE_DATA_ENABLED: "1", PICKS_FEED_KEY: "f".repeat(30),
    R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "bucket",
  });
  globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/bucket\//, ""));
    seen.push(`${req.method} ${key}`);
    if (req.method !== "GET") return new Response("no", { status: 403 });
    return key in objects ? new Response(objects[key], { status: 200 }) : new Response("", { status: 404 });
  };
  try {
    const { default: handler } = await import("../api/auth/[action].js");
    const call = async (query) => {
      const res = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        status(c) { this.statusCode = c; return this; }, json(b) { this.body = JSON.stringify(b); return this; }, end(b) { this.body = b ?? ""; return this; } };
      await handler({ method: "GET", query: { action: "picks-feed", key: "f".repeat(30), ...query }, headers: { host: "example.test" } }, res);
      return res;
    };
    const j = await call({ format: "json" });
    assert.equal(j.statusCode, 200, j.body);
    assert.equal(j.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(j.headers["cache-control"], "private, no-store");
    const body = JSON.parse(j.body);
    assert.equal(body.version, 1);
    assert.equal(body.source, "top_picks");
    assert.ok(body.instructions.some((x) => x.kind === "OPEN" && x.symbol === "NVDA"));
    assert.ok(body.instructions.every((x) => typeof x.agent_placeable === "boolean"));
    const closes = JSON.parse((await call({ format: "json", kind: "close" })).body);
    assert.ok(closes.instructions.length > 0 && closes.instructions.every((x) => x.kind === "CLOSE"));
    const junk = JSON.parse((await call({ format: "json", kind: "everything", since: "garbage", placeable: "yes" })).body);
    assert.equal(junk.counts.matched, body.counts.matched, "bad filters fall back to the whole list");
    const text = await call({});
    assert.equal(text.headers["content-type"], "text/plain; charset=utf-8");
    assert.ok(String(text.body).startsWith("MINGSTREET TOP PICKS: TRADE LINES"), "no format = the text feed as before");
    assert.ok(seen.every((x) => x.startsWith("GET ")), "the feed only reads: " + seen.join(", "));
    passed++; console.log("ok - the picks feed serves ?format=json from the store, read-only");
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(`trade-instructions-smoke: ${passed} passed`);
