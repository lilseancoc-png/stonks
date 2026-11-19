#!/usr/bin/env node
// Owner controls smoke test (node scripts/owner-controls-smoke.mjs). No
// network, no store, no AI: synthetic bars, chains and a fake Webull only.
//
// Covers lib/owner-controls.mjs (dates on the exchange calendar, saving,
// confirm boxes, undo, expiry, a bad file, the run view, stamps, sizes, the
// account limits and the Webull open gate), the strategy engines' book with
// every control (lib/engines/book.mjs), the Webull mirror's open gate
// (lib/webull-mirror.mjs) and mirror health. Top Picks is covered in
// picks-smoke (the roster) and event-play-smoke (the record).
//
// Reruns with other assumptions (each prints what it used):
//   OC_NOW=2026-12-24T15:00:00Z   the clock for the relative checks (a half day here)
//   OC_OPTION_USD=4000            premium per engine option trade (BOOK.optionUsd by default)
//   OC_NAMES=12                   how many names qualify in the book checks (default 7)
import assert from "node:assert/strict";
import {
  OWNER_CONTROLS_KEY, DIAL, WATCH_SESSIONS, watchUntil, dialUntil, etToIso, emptyControls, readOwnerControlsDoc, activeControls,
  controlsSummary, tradeStamp, avoidCloses, scaleContract, accountLimits, accountLimitsFromSettings, mirrorOpenGate,
  validateControlsRequest, applyOwnerControlsRequest, sweepExpired, controlsView, controlsScorecard, controlsEnabled, controlsEnabledFromSettings,
} from "../lib/owner-controls.mjs";
import { ENGINES, BOOK, CLOSE_LABEL, NOT_COUNTED } from "../lib/engines/config.mjs";
import { stepBook, emptyRecord, emptyState } from "../lib/engines/book.mjs";
import { pickContract, quoteContract, positionUsd } from "../lib/engines/contracts.mjs";
import { runWebullMirror } from "../lib/webull-mirror.mjs";
import { mirrorHealth } from "../lib/webull-mirror-health.mjs";
import { isPremiumKey } from "../lib/premium-keys.mjs";
import { REQUEST_TIME_EXCLUSIVE_KEYS } from "../lib/data-ownership.mjs";
import { OWNER_SETTINGS, ownerSettingDef } from "../lib/owner-settings.mjs";
import { etClock } from "../lib/us-equity-calendar.mjs";
import { bsPrice } from "../lib/greeks.mjs";
import { contractFor as specContract } from "../lib/engines/config.mjs";

let passed = 0;
const ok = async (name, fn) => { try { await fn(); passed++; } catch (err) { console.error(`FAIL ${name}\n  ${err?.stack || err}`); process.exitCode = 1; } };
const NOW = process.env.OC_NOW || "2026-11-23T16:00:00.000Z";   // Mon 11:00 ET
const NOW_MS = Date.parse(NOW);
const OPTION_USD = Number(process.env.OC_OPTION_USD) || BOOK.optionUsd;
const NAMES = Math.max(3, Number(process.env.OC_NAMES) || 7);
console.log(`assumptions: clock ${NOW} (${etClock(NOW_MS).date} ET), option trade $${OPTION_USD}, ${NAMES} qualifying names`);
const later = (min) => new Date(NOW_MS + min * 60000).toISOString();
const apply = (doc, body, min = 0) => applyOwnerControlsRequest(doc, body, { at: later(min), by: "Owner" });
const chain = (...bodies) => { let d = null; bodies.forEach((b, i) => { const r = apply(d, b, i); assert.ok(!r.error, `${b.act}: ${r.error}`); d = r.doc; }); return d; };

// ---- the stored record ---------------------------------------------------
await ok("file: Owner-only, request-time-owned, a bad file reads as no control", () => {
  assert.equal(OWNER_CONTROLS_KEY, "owner-controls.json");
  assert.ok(isPremiumKey(OWNER_CONTROLS_KEY));
  assert.ok(REQUEST_TIME_EXCLUSIVE_KEYS.has ? REQUEST_TIME_EXCLUSIVE_KEYS.has(OWNER_CONTROLS_KEY) : REQUEST_TIME_EXCLUSIVE_KEYS.includes(OWNER_CONTROLS_KEY));
  for (const raw of [null, "", "{nope", "[]", "42", JSON.stringify({ stop: "yes", avoid: [{ sym: "lower case!", at: "x" }], dial: { level: "yolo" } })]) {
    const a = activeControls(readOwnerControlsDoc(raw), NOW_MS);
    assert.equal(a.any, false, String(raw)); assert.equal(a.stop, false); assert.equal(a.avoid.size, 0); assert.equal(a.dial, null);
  }
  assert.deepEqual(readOwnerControlsDoc(Buffer.from(JSON.stringify(emptyControls()))), emptyControls());
});

await ok("dates: watch runs five sessions, the dial ends at Friday's close (holidays and half days)", () => {
  assert.equal(WATCH_SESSIONS, 5);
  // Thanksgiving week 2026: Thu 11/26 closed, Fri 11/27 closes 13:00 ET.
  assert.equal(watchUntil(Date.parse("2026-11-23T15:00:00Z")), "2026-11-30");
  assert.equal(watchUntil(Date.parse("2026-11-23T22:00:00Z")), "2026-12-01", "after the close the next session is the first");
  assert.equal(watchUntil(Date.parse("2026-11-21T15:00:00Z")), "2026-11-30", "a weekend starts on Monday");
  assert.equal(watchUntil(Date.parse("2026-11-27T17:00:00Z")), "2026-12-03", "the half day counts before its 13:00 close");
  assert.equal(watchUntil(Date.parse("2026-11-27T19:00:00Z")), "2026-12-04");
  assert.equal(dialUntil(Date.parse("2026-11-23T15:00:00Z")), "2026-11-27T18:00:00.000Z", "13:00 ET on the half day");
  assert.equal(dialUntil(Date.parse("2026-11-27T19:00:00Z")), "2026-12-04T21:00:00.000Z", "after Friday's close: next Friday 16:00 ET");
  assert.equal(dialUntil(Date.parse("2026-11-18T15:00:00Z")), "2026-11-20T21:00:00.000Z");
  assert.equal(etToIso("2026-07-10", 960), "2026-07-10T20:00:00.000Z", "daylight time");
  assert.equal(etToIso("2026-12-04", 960), "2026-12-04T21:00:00.000Z", "standard time");
  // Any clock: the dial always ends in the future, on or before the next Friday + 7 days.
  for (let h = 0; h < 24 * 14; h += 7) {
    const ms = NOW_MS + h * 3600000, u = Date.parse(dialUntil(ms));
    assert.ok(u > ms && u - ms <= 8 * 86400000, new Date(ms).toISOString());
    assert.ok(watchUntil(ms) >= etClock(ms).date);
  }
});

await ok("confirm: Stop, Riskier and Avoid-with-close need the confirm box; bad input is refused", () => {
  const today = "2026-11-23";
  assert.deepEqual(validateControlsRequest({ act: "stop" }, { today }), { error: "confirm required", confirm: "stop" });
  assert.equal(validateControlsRequest({ act: "stop", confirm: true }, { today }).act, "stop");
  assert.equal(validateControlsRequest({ act: "dial", level: "riskier" }, { today }).confirm, "dial:riskier");
  assert.equal(validateControlsRequest({ act: "dial", level: "safer" }, { today }).act, "dial");
  assert.equal(validateControlsRequest({ act: "avoid", sym: "AAPL", close: true }, { today }).confirm, "avoid:close");
  assert.equal(validateControlsRequest({ act: "avoid", sym: "AAPL" }, { today }).act, "avoid");
  for (const bad of [null, {}, { act: "sell-everything" }, { act: "avoid", sym: "" }, { act: "avoid", sym: "<b>" }, { act: "avoid", sym: "AAPL", until: "2026-11-01" },
    { act: "catalyst", text: "", date: today }, { act: "catalyst", text: "CPI", date: "2028-01-01" }, { act: "catalyst", text: "CPI", date: "2026-11-01" }, { act: "dial", level: "max" }, { act: "uncatalyst", id: 0 }])
    assert.ok(validateControlsRequest(bad, { today }).error, JSON.stringify(bad));
  assert.equal(apply(null, { act: "stop" }).error, "confirm required");
});

// ---- changes, the log and undo ------------------------------------------
await ok("changes: every control is logged with who and when; repeats change nothing", () => {
  const d = chain(
    { act: "stop", confirm: true }, { act: "avoid", sym: "tsla", close: true, confirm: true }, { act: "watch", sym: "NVDA" },
    { act: "catalyst", sym: "AAPL", text: "Product event", date: etClock(NOW_MS + 3 * 86400000).date }, { act: "dial", level: "safer" });
  assert.equal(d.log.length, 5); assert.ok(d.log.every((l) => l.by === "Owner" && l.at && l.prev));
  assert.deepEqual(d.log.map((l) => l.act), ["dial", "catalyst", "watch", "avoid", "stop"]);
  assert.equal(d.avoid[0].sym, "TSLA", "symbols are upper-cased");
  const a = activeControls(d, NOW_MS + 10 * 60000);
  assert.ok(a.stop && a.avoid.get("TSLA").close && a.watch.has("NVDA") && a.catalystSyms.has("AAPL") && a.dial.level === "safer" && a.any);
  assert.deepEqual(controlsSummary(a), { stop: true, avoid: ["TSLA"], close: ["TSLA"], watch: ["NVDA"], catalysts: ["AAPL"], dial: "safer" });
  assert.equal(apply(d, { act: "stop", confirm: true }, 9).unchanged, true);
  assert.equal(apply(d, { act: "watch", sym: "NVDA" }, 9).unchanged, true);
  assert.equal(apply(d, { act: "lift", sym: "MSFT" }, 9).unchanged, true);
  assert.equal(apply(null, { act: "dial", level: "normal" }).unchanged, true);
  // The log keeps the newest 40.
  let big = null; for (let i = 0; i < 60; i++) big = apply(big, { act: i % 2 ? "unwatch" : "watch", sym: "AMD" }, i).doc;
  assert.equal(big.log.length, 40);
});

await ok("undo: each Undo restores the state before the newest change, in order", () => {
  const steps = [{ act: "stop", confirm: true }, { act: "avoid", sym: "TSLA" }, { act: "dial", level: "riskier", confirm: true }, { act: "resume" }];
  const states = [readOwnerControlsDoc(null)];
  let d = null;
  steps.forEach((b, i) => { d = apply(d, b, i).doc; states.push(d); });
  const strip = (x) => ({ stop: !!x.stop, avoid: x.avoid.map((a) => a.sym), dial: x.dial?.level || null });
  for (let k = steps.length - 1; k >= 0; k--) {
    const u = apply(d, { act: "undo" }, 10 + k);
    assert.ok(u.changed, u.error);
    d = u.doc;
    assert.deepEqual(strip(d), strip(states[k]), `undo #${steps.length - k}`);
  }
  assert.equal(apply(d, { act: "undo" }, 30).error, "nothing to undo");
  assert.equal(d.log.filter((l) => l.act === "undo").length, steps.length);
  // An undone Resume takes its `past` row back out.
  const r = chain({ act: "stop", confirm: true }, { act: "resume" });
  assert.equal(r.past.length, 1);
  assert.equal(apply(r, { act: "undo" }, 5).doc.past.length, 0);
});

await ok("expiry: watch, catalysts, an end-dated avoid and the dial end on their own", () => {
  const d = chain({ act: "watch", sym: "NVDA" }, { act: "avoid", sym: "TSLA", until: etClock(NOW_MS).date }, { act: "avoid", sym: "AMD" },
    { act: "catalyst", text: "CPI", date: etClock(NOW_MS).date }, { act: "dial", level: "safer" });
  const day = 86400000, until = Date.parse(d.dial.until);
  assert.ok(activeControls(d, until - 1000).dial, "the dial holds until its end");
  assert.equal(activeControls(d, until + 1000).dial, null, "and ends on its own");
  const week = activeControls(d, NOW_MS + 10 * day);
  assert.equal(week.watch.size, 0); assert.equal(week.catalysts.length, 0);
  assert.deepEqual([...week.avoid.keys()], ["AMD"], "an avoid with no end date stays until lifted");
  const swept = sweepExpired(d, NOW_MS + 10 * day);
  assert.equal(swept.swept, 4);
  assert.deepEqual(swept.doc.past.map((p) => p.kind).sort(), ["avoid", "catalyst", "dial", "watch"]);
  // The next save sweeps; the view marks what is no longer in force.
  const v = controlsView(d, NOW_MS + 10 * day, null);
  assert.equal(v.watch[0].active, false); assert.equal(v.dial.level, "normal"); assert.equal(v.avoid.find((a) => a.sym === "TSLA").active, false);
  const saved = apply(d, { act: "watch", sym: "MU" }, 10 * 24 * 60).doc;
  assert.ok(!saved.watch.some((w) => w.sym === "NVDA") && saved.past.some((p) => p.kind === "watch" && p.sym === "NVDA" && p.how === "expired"));
});

await ok("view: the page never sees the undo snapshots", () => {
  const d = chain({ act: "stop", confirm: true }, { act: "avoid", sym: "TSLA" });
  const v = controlsView(d, NOW_MS + 60000, accountLimits({ ACCOUNT_LIMIT_OPEN_USD: "50000" }));
  assert.ok(!JSON.stringify(v).includes('"prev"'));
  assert.equal(v.canUndo, true); assert.equal(v.limits.openUsd, 50000); assert.equal(v.limits.dayLossUsd, null);
  assert.deepEqual(v.dials.map((x) => x.level), ["safer", "normal", "riskier"]);
  assert.equal(controlsView(null, NOW_MS, null).canUndo, false);
});

// ---- the pieces the engines, Top Picks and the mirror read ---------------
await ok("stamps, closes and sizes", () => {
  const a = activeControls(chain({ act: "watch", sym: "NVDA" }, { act: "dial", level: "safer" }, { act: "catalyst", sym: "NVDA", text: "Earnings", date: etClock(NOW_MS + 86400000).date }), NOW_MS + 60000);
  assert.deepEqual(tradeStamp(a, "NVDA"), { dial: "safer", watch: true, catalyst: true });
  assert.deepEqual(tradeStamp(a, "NVDA", { dial: false }), { watch: true, catalyst: true });
  assert.deepEqual(tradeStamp(a, "AMD"), { dial: "safer" });
  assert.equal(tradeStamp(activeControls(null, NOW_MS), "AMD"), null);
  const av = activeControls(chain({ act: "avoid", sym: "TSLA", close: true, confirm: true }), NOW_MS + 60000);
  assert.equal(avoidCloses(av, "TSLA", later(-60)), true, "opened before the avoid");
  assert.equal(avoidCloses(av, "TSLA", later(30)), false, "opened after it");
  assert.equal(avoidCloses(av, "AMD", later(-60)), false);
  assert.equal(avoidCloses(activeControls(chain({ act: "avoid", sym: "TSLA" }), NOW_MS + 60000), "TSLA", later(-60)), false, "no close asked");
  assert.equal(scaleContract({ qty: 4, mid: 5 }, 0.5).qty, 2);
  assert.equal(scaleContract({ qty: 1, mid: 5 }, 0.5).qty, 1, "at least one contract");
  assert.equal(scaleContract({ qty: 4, mid: 5 }, 1.5).qty, 6);
  assert.equal(scaleContract({ qty: 9, mid: 5 }, 1.5).qty, 10, "Riskier tops out at 10 contracts");
  assert.equal(scaleContract({ qty: 20, mid: 5 }, 1.5).qty, 20, "never below what it was");
  assert.deepEqual(scaleContract({ structure: "shares", shares: 51, mid: 98 }, 0.5), { structure: "shares", shares: 25, mid: 98, usd: 2450 });
  assert.equal(scaleContract({ structure: "shares", shares: 51, mid: 98 }, 1.5).shares, 76);
  const skip = { skip: "no contract" };
  assert.equal(scaleContract(skip, 0.5), skip);
});

await ok("account limits: off until set, a Vercel value wins over the saved setting", () => {
  assert.deepEqual(accountLimits({}), { openUsd: null, dayLossUsd: null, nameUsd: null, newPerDay: null, any: false });
  assert.equal(accountLimits({ ACCOUNT_LIMIT_OPEN_USD: "0", ACCOUNT_LIMIT_NEW_PER_DAY: "-3", ACCOUNT_LIMIT_NAME_USD: "abc" }).any, false);
  const l = accountLimitsFromSettings({ ACCOUNT_LIMIT_OPEN_USD: 20000, ACCOUNT_LIMIT_NEW_PER_DAY: 3 }, { ACCOUNT_LIMIT_OPEN_USD: "15000" });
  assert.equal(l.openUsd, 15000); assert.equal(l.newPerDay, 3); assert.equal(l.any, true);
  assert.equal(accountLimitsFromSettings({ ACCOUNT_LIMIT_OPEN_USD: 20000 }, { ACCOUNT_LIMIT_OPEN_USD: " " }).openUsd, 20000, "a blank pin does not count");
  // The four Owner Settings: numbers, default 0 (off), marked big impact.
  for (const key of ["ACCOUNT_LIMIT_OPEN_USD", "ACCOUNT_LIMIT_DAY_LOSS_USD", "ACCOUNT_LIMIT_NAME_USD", "ACCOUNT_LIMIT_NEW_PER_DAY"]) {
    const def = ownerSettingDef(key);
    assert.ok(def, key); assert.equal(def.kind, "number"); assert.equal(Number(def.default), 0); assert.equal(def.impact, "high"); assert.equal(def.tab, "Account limits");
  }
  assert.equal(OWNER_SETTINGS.filter((d) => d.tab === "Account limits").length, 5);
});

await ok("kill switch: OWNER_CONTROLS off means no control is in force anywhere; the limits still apply", async () => {
  const def = ownerSettingDef("OWNER_CONTROLS");
  assert.equal(def.kind, "switch"); assert.equal(def.default, true); assert.equal(def.impact, "high"); assert.equal(def.tab, "Account limits");
  assert.equal(controlsEnabled({}), true, "unset = on");
  for (const v of ["0", "false", "off", " OFF "]) assert.equal(controlsEnabled({ OWNER_CONTROLS: v }), false, v);
  for (const v of ["1", "true", "on", ""]) assert.equal(controlsEnabled({ OWNER_CONTROLS: v }), true, JSON.stringify(v));
  assert.equal(controlsEnabledFromSettings({}, {}), true, "nothing saved = on");
  assert.equal(controlsEnabledFromSettings({ OWNER_CONTROLS: false }, {}), false);
  assert.equal(controlsEnabledFromSettings({ OWNER_CONTROLS: false }, { OWNER_CONTROLS: "1" }), true, "a Vercel value wins");
  assert.equal(controlsEnabledFromSettings({ OWNER_CONTROLS: true }, { OWNER_CONTROLS: "0" }), false, "a Vercel value wins");
  assert.equal(controlsEnabledFromSettings({ OWNER_CONTROLS: false }, { OWNER_CONTROLS: " " }), false, "a blank pin does not count");
  // The bake's read (scripts/build.mjs readOwnerControlsForRun) on a saved Stop.
  const { readOwnerControlsForRun } = await import("./build.mjs");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "oc-ks-"));
  writeFileSync(join(dir, OWNER_CONTROLS_KEY), JSON.stringify(chain({ act: "stop", confirm: true }, { act: "avoid", sym: "AAA" }, { act: "dial", level: "safer" })));
  const atIso = new Date(NOW_MS + 120000).toISOString();
  const on = await readOwnerControlsForRun(atIso, dir, { ACCOUNT_LIMIT_NEW_PER_DAY: "4" });
  assert.equal(on.enabled, true); assert.equal(on.stop, true); assert.ok(on.avoid.has("AAA")); assert.equal(on.dial.level, "safer"); assert.equal(on.limits.newPerDay, 4);
  const off = await readOwnerControlsForRun(atIso, dir, { OWNER_CONTROLS: "0", ACCOUNT_LIMIT_NEW_PER_DAY: "4" });
  assert.equal(off.enabled, false); assert.equal(off.stop, false); assert.equal(off.avoid.size, 0); assert.equal(off.dial, null); assert.equal(off.any, false);
  assert.equal(off.limits.newPerDay, 4, "the account limits are not part of the switch");
  const missing = await readOwnerControlsForRun(atIso, join(dir, "nope"), {});
  assert.equal(missing.any, false); assert.equal(missing.enabled, true);
  // The page view says so.
  assert.equal(controlsView(null, NOW_MS).enabled, true);
  assert.equal(controlsView(null, NOW_MS, null, { enabled: false }).enabled, false);
});

const WEXP = Math.floor(Date.UTC(2026, 11, 18) / 1000);
const ledgerTrade = (o) => ({ tradeId: o.id, symbol: o.symbol || "AAA", state: "open", openQty: 1, fillPrice: 4, engineEntryPrice: 4, engineEntryIso: later(-60 * 24 * 3), ...o });
await ok("mirror gate: Stop, Avoid and each account limit hold a new Webull open with the reason", () => {
  const none = activeControls(null, NOW_MS);
  const e = { symbol: "NEW", side: "call" }, t = { engineEntryPrice: 5, requestedQty: 1 };
  assert.equal(mirrorOpenGate(none, accountLimits({}), { nowMs: NOW_MS })(e, { trades: {} }, t), null);
  assert.match(mirrorOpenGate(activeControls(chain({ act: "stop", confirm: true }), NOW_MS + 60000), null, { nowMs: NOW_MS })(e, { trades: {} }, t), /stopped by the owner/);
  assert.match(mirrorOpenGate(activeControls(chain({ act: "avoid", sym: "NEW" }), NOW_MS + 60000), null, { nowMs: NOW_MS })(e, { trades: {} }, t), /avoid list/);
  const ledger = { trades: {
    a: ledgerTrade({ id: "a", symbol: "NEW" }), b: ledgerTrade({ id: "b", engineEntryIso: later(-30) }),
    c: ledgerTrade({ id: "c", state: "closed", openQty: 0, engineEntryIso: later(-20), closeFillIso: later(-10), closeFillPrice: 1, filledQty: 2 }),
    d: ledgerTrade({ id: "d", state: "skipped", openQty: 0, engineEntryIso: later(-5) }),
  } };
  const gate = (env) => mirrorOpenGate(none, accountLimits(env), { nowMs: NOW_MS })(e, ledger, t);
  assert.match(gate({ ACCOUNT_LIMIT_NEW_PER_DAY: "2" }), /2 new trades a day/, "b and c opened today; the skipped d does not count");
  assert.equal(gate({ ACCOUNT_LIMIT_NEW_PER_DAY: "3" }), null);
  assert.match(gate({ ACCOUNT_LIMIT_DAY_LOSS_USD: "600" }), /daily loss stop/, "c lost $600 on two contracts today");
  assert.equal(gate({ ACCOUNT_LIMIT_DAY_LOSS_USD: "601" }), null);
  assert.match(gate({ ACCOUNT_LIMIT_OPEN_USD: "1299" }), /open premium cap/, "$800 open + $500 new");
  assert.equal(gate({ ACCOUNT_LIMIT_OPEN_USD: "1300" }), null);
  assert.match(gate({ ACCOUNT_LIMIT_NAME_USD: "899" }), /cap on NEW/, "$400 held + $500 new");
  assert.equal(gate({ ACCOUNT_LIMIT_NAME_USD: "900" }), null);
});

await ok("mirror gate: share lots are priced per share, stay out of the option premium cap, count toward the per-stock cap", () => {
  const none = activeControls(null, NOW_MS);
  const lot = (o) => ledgerTrade({ structure: "shares", instrument: "stock", fillPrice: 150, engineEntryPrice: 150, openQty: 20, ...o });
  const ledger = { trades: {
    s1: lot({ id: "s1", symbol: "SSS", engineEntryIso: later(-60 * 24) }),
    o1: ledgerTrade({ id: "o1", symbol: "OOO", engineEntryIso: later(-60 * 24) }),
    s2: lot({ id: "s2", symbol: "XXX", state: "closed", openQty: 0, engineEntryIso: later(-60 * 24), closeFillIso: later(-10), closeFillPrice: 149, filledQty: 20, closedQty: 20 }),
  } };
  const g = (env, e, t) => mirrorOpenGate(none, accountLimits(env), { nowMs: NOW_MS })(e, ledger, t);
  const newShares = { structure: "shares", instrument: "stock", engineEntryPrice: 150, requestedQty: 20 };
  const newOpt = { engineEntryPrice: 5, requestedQty: 1 };
  // $3,000 held in SSS + a new $3,000 lot = $6,000: fits a $10,000 per-stock cap, not $5,999.
  assert.equal(g({ ACCOUNT_LIMIT_NAME_USD: "10000" }, { symbol: "SSS" }, newShares), null, "not x100");
  assert.match(g({ ACCOUNT_LIMIT_NAME_USD: "5999" }, { symbol: "SSS" }, newShares), /cap on SSS/);
  // The option premium cap sees only the $400 option open: a $500 option fits under $900, and a stock lot never meets it.
  assert.equal(g({ ACCOUNT_LIMIT_OPEN_USD: "900" }, { symbol: "NEW" }, newOpt), null, "the stock lot is not option premium");
  assert.match(g({ ACCOUNT_LIMIT_OPEN_USD: "899" }, { symbol: "NEW" }, newOpt), /open premium cap/);
  assert.equal(g({ ACCOUNT_LIMIT_OPEN_USD: "1" }, { symbol: "NEW" }, newShares), null, "a new stock lot is not held by the option cap");
  // A $1 drop on 20 shares closed today is a $20 loss, not $2,000.
  assert.equal(g({ ACCOUNT_LIMIT_DAY_LOSS_USD: "21" }, { symbol: "NEW" }, newOpt), null);
  assert.match(g({ ACCOUNT_LIMIT_DAY_LOSS_USD: "20" }, { symbol: "NEW" }, newOpt), /daily loss stop/);
});

// ---- the strategy engines' book ------------------------------------------
function chainFor(spot, nowMs, { iv = 0.35 } = {}) {
  const chains = {};
  for (const dte of [9, 16, 23, 30, 37, 44, 58, 72, 100, 128, 156, 191]) {
    const exp = Math.floor((nowMs + dte * 86400000) / 1000);
    const c = [], p = [];
    for (let k = 0.7; k <= 1.3001; k += 0.025) {
      const K = Math.round(spot * k * 2) / 2;
      for (const [type, col] of [["call", c], ["put", p]]) {
        const px = bsPrice(type, spot, K, dte / 365, iv, 0.045);
        if (!(px > 0.05)) continue;
        col.push({ s: K, b: +(px * 0.97).toFixed(2), a: +(px * 1.03).toFixed(2), l: +px.toFixed(2), iv, oi: 800, v: 60 });
      }
    }
    chains[exp] = { c, p };
  }
  return chains;
}
const END = "2026-11-13", BOOK_AM = "2026-11-16T16:00:00.000Z", BOOK_TODAY = "2026-11-16";
function baseF(over = {}) {
  return {
    i: 400, date: END, c: 100, o: 99.5, h: 100.5, l: 99, v: 1.5e6, pc: 99,
    ret1: 0.01, ret3: 0.01, ret5: 0.02, ret10: 0.03, ret21: 0.05, ret63: 0.12, ret126: 0.25, ret252: 0.4,
    sma10: 99, sma20: 98, sma50: 94, sma100: 90, sma200: 85, sma50Prev: 93, sma200Prev: 84,
    sd20: 2, z20: 1, atr: 2, atrPct: 0.02, rsi14: 60, rsi2: 60, rsi2Min3: 50, rsi2Max3: 70,
    hi20p: 101, lo20p: 95, hi55p: 102, lo55p: 88, hi252: 103, lo252: 60, lo5: 97.5, hi5: 101,
    bbw: 0.08, bbwRank: 0.5, bbwRankPrev: 0.5, volRatio: 1, rv20: 0.3, rv60: 0.3,
    upStreak: 1, downStreak: 0, rangePos: 0.7, gap: 0.005, dayAtr: 0.5, move3Atr: 0.5, move5Atr: 1, distHi252: -0.03,
    ...over,
  };
}
const pullF = (over = {}) => baseF({ rsi2Min3: 8, lo5: 98.2, c: 100, pc: 99, volRatio: 1.3, ...over });
const V = (sym, f) => ({ sym, isEtf: false, spot: f.c, f });
const CTX = { date: BOOK_TODAY, spy: baseF({ c: 500, sma50: 480, ret63: 0.05 }), byId: {}, macro: null, env: { rates: "on hold", vix: "15-20" }, macroEvent: null, regime: { cell: "up-calm", era: "normal", stressed: false }, macroState: "neutral" };
const symsN = (n, p = "N") => Array.from({ length: n }, (_, i) => `${p}${String.fromCharCode(65 + i)}`);
const views = (syms) => Object.fromEntries(syms.map((s) => [s, V(s, pullF())]));
function bookInput(vs, { nowIso = BOOK_AM, ...rest } = {}) {
  const ms = Date.parse(nowIso);
  const data = Object.fromEntries(Object.keys(vs).map((s) => [s, { spot: 100, chains: chainFor(100, Date.parse(BOOK_AM)) }]));
  return {
    nowIso, today: nowIso.slice(0, 10), late: false, views: vs, ctx: { ...CTX, byId: vs },
    quote: (t) => (data[t.symbol] ? quoteContract(data[t.symbol], t.contract, { nowMs: ms }) : null),
    pick: (view, side, spec, c) => pickContract(data[view.sym], side, specContract(spec, c?.setup), { nowMs: ms }),
    flagshipOpen: [], coverage: null, shares: false, engines: ["technicals"], optionUsd: OPTION_USD, ...rest,
  };
}
const ctlAt = (doc, nowIso = BOOK_AM, limits = accountLimits({})) => ({ ...activeControls(doc, Date.parse(nowIso)), limits });
const docAt = (...bodies) => { let d = null; bodies.forEach((b, i) => { d = applyOwnerControlsRequest(d, b, { at: new Date(Date.parse(BOOK_AM) - 3600000 + i * 1000).toISOString() }).doc; }); return d; };
const run = (input) => { const state = emptyState(), record = emptyRecord(); const out = stepBook(state, record, input); return { state, record, out }; };
const ids = (out) => out.opened.map((t) => t.tradeId).sort();

await ok("book: no control in force opens exactly what no controls opens (switch off = today)", () => {
  const vs = views(symsN(NAMES));
  const a = run(bookInput(vs)), b = run(bookInput(vs, { controls: ctlAt(null) }));
  assert.ok(a.out.opened.length >= 1);
  assert.deepEqual(ids(b.out), ids(a.out));
  assert.equal(b.out.shadowOpened, a.out.shadowOpened);
  assert.ok(b.out.opened.every((t) => !t.ownerControls));
  assert.deepEqual(b.out.opened.map((t) => t.contract.qty), a.out.opened.map((t) => t.contract.qty));
  assert.ok(a.out.checks && Object.keys(a.out.checks).length >= a.out.opened.length, "Check this stock has rows");
  assert.equal(a.out.controls, undefined); assert.ok(b.out.controls);
});

await ok("book: Stop opens nothing, not even a shadow trade, and says why", () => {
  const r = run(bookInput(views(symsN(NAMES)), { controls: ctlAt(docAt({ act: "stop", confirm: true })) }));
  assert.equal(r.out.opened.length, 0); assert.equal(r.out.shadowOpened, 0);
  assert.ok(r.out.candidates.technicals.every((c) => c.why === "new trades stopped by the owner"));
  assert.ok(Object.values(r.out.checks).flat().every((c) => !c.taken && /stopped/.test(c.why)));
});

await ok("book: Avoid holds back only its stock; Avoid-with-close closes earlier trades as owner-avoid without learning", () => {
  const syms = symsN(NAMES), vs = views(syms);
  const base = run(bookInput(vs));
  const target = base.out.opened[0].symbol;
  const av = run(bookInput(vs, { controls: ctlAt(docAt({ act: "avoid", sym: target })) }));
  assert.ok(!av.out.opened.some((t) => t.symbol === target));
  assert.equal(av.out.candidates.technicals.find((c) => c.symbol === target).why, "on the owner's avoid list");
  // A trade opened at 11:00, Avoid-with-close set later, the 15:30 run closes it.
  const { state, record } = base;
  const pm = "2026-11-16T20:30:00.000Z";
  const doc = applyOwnerControlsRequest(null, { act: "avoid", sym: target, close: true, confirm: true }, { at: "2026-11-16T18:00:00.000Z" }).doc;
  const before = JSON.stringify(state.engines.technicals.setups || {});
  const out = stepBook(state, record, bookInput(vs, { nowIso: pm, late: true, controls: ctlAt(doc, pm) }));
  const shut = out.closed.find((t) => t.symbol === target);
  assert.ok(shut, "closed at the next run"); assert.equal(shut.status, "owner-avoid");
  assert.ok(!NOT_COUNTED.has?.("owner-avoid") && !(Array.isArray(NOT_COUNTED) && NOT_COUNTED.includes("owner-avoid")), "counted like any close");
  assert.ok(CLOSE_LABEL["owner-avoid"]);
  assert.ok(!state.engines.technicals.cooldown[target], "no loss cooldown from an Owner close");
  assert.equal(JSON.stringify(state.engines.technicals.setups || {}), before, "learning does not see it");
  assert.ok(record.open.every((t) => t.symbol !== target));
  assert.ok(out.closed.filter((t) => t.status === "owner-avoid").length === base.out.opened.filter((t) => t.symbol === target).length);
});

await ok("book: Watch puts watched names first in the queue and lowers no bar", () => {
  const syms = symsN(NAMES), vs = views(syms);
  const base = run(bookInput(vs));
  const notTaken = base.out.candidates.technicals.filter((c) => !c.taken).map((c) => c.symbol);
  assert.ok(notTaken.length, "the run limit leaves names out");
  const w = notTaken.at(-1);
  const r = run(bookInput(vs, { controls: ctlAt(docAt({ act: "watch", sym: w })) }));
  assert.ok(r.out.opened.some((t) => t.symbol === w), "the watched name opens");
  assert.equal(r.out.opened.length, base.out.opened.length, "same number of trades");
  assert.deepEqual(r.out.opened.find((t) => t.symbol === w).ownerControls, { watch: true });
  // A watched name under the bar stays out.
  const low = { ...vs, LOW: V("LOW", baseF()) };
  const r2 = run(bookInput(low, { controls: ctlAt(docAt({ act: "watch", sym: "LOW" })) }));
  assert.ok(!r2.out.opened.some((t) => t.symbol === "LOW"));
});

await ok("book: Safer halves size, adds 5 to the bar and opens one trade a run; Riskier is 1.5x and the bar -3", () => {
  const syms = symsN(NAMES), vs = views(syms);
  const multi = { engines: ["technicals", "reversion"], maxTotal: 5 };
  const base = run(bookInput(vs, multi));
  const safer = run(bookInput(vs, { ...multi, controls: ctlAt(docAt({ act: "dial", level: "safer" })) }));
  assert.ok(base.out.opened.length >= 2);
  assert.equal(safer.out.opened.length, 1, "one new trade a run");
  const t = safer.out.opened[0], same = base.out.opened.find((x) => x.tradeId === t.tradeId);
  if (same) assert.equal(t.contract.qty, Math.max(1, Math.round(same.contract.qty * 0.5)));
  assert.deepEqual(t.ownerControls, { dial: "safer" });
  assert.ok(safer.out.candidates.technicals.concat(safer.out.candidates.reversion || []).some((c) => /risk dial Safer/.test(c.why || "")), "the reason names the dial");
  const risk = run(bookInput(vs, { ...multi, controls: ctlAt(docAt({ act: "dial", level: "riskier", confirm: true })) }));
  assert.ok(risk.out.opened.length >= base.out.opened.length);
  for (const x of risk.out.opened) {
    const b = base.out.opened.find((y) => y.tradeId === x.tradeId);
    if (b) assert.equal(x.contract.qty, Math.min(Math.max(1, Math.round(b.contract.qty * 1.5)), Math.max(b.contract.qty, 10)));
    assert.deepEqual(x.ownerControls, { dial: "riskier" });
  }
  // The bar: a setup just under today's bar opens under Riskier, one just over it waits under Safer.
  const es = base.state.engines.technicals, bar = es.bar;
  assert.ok(Number.isFinite(bar));
  const scored = base.out.candidates.technicals.filter((c) => Number.isFinite(c.score));
  const nearOver = scored.filter((c) => c.score >= bar && c.score < bar + 5);
  const saferBar = run(bookInput(vs, { controls: ctlAt(docAt({ act: "dial", level: "safer" })) }));
  for (const c of nearOver) assert.match(saferBar.out.candidates.technicals.find((x) => x.symbol === c.symbol).why || "", /below the bar \(risk dial Safer: \+5\)|book run limit/);
});

await ok("book: each account limit holds back the trade that would pass it, and core engines keep their monthly book", () => {
  const syms = symsN(NAMES), vs = views(syms);
  const base = run(bookInput(vs));
  const n = base.out.opened.length;
  const lim = (env) => run(bookInput(vs, { controls: ctlAt(null, BOOK_AM, accountLimits(env)) }));
  assert.equal(lim({ ACCOUNT_LIMIT_NEW_PER_DAY: "1" }).out.opened.length, 1);
  assert.ok(lim({ ACCOUNT_LIMIT_NEW_PER_DAY: "1" }).out.candidates.technicals.some((c) => /1 new trades a day reached/.test(c.why || "")));
  const one = positionUsd(base.out.opened[0].contract);
  assert.equal(lim({ ACCOUNT_LIMIT_OPEN_USD: String(Math.ceil(one)) }).out.opened.length, 1, "room for one trade's premium");
  assert.equal(lim({ ACCOUNT_LIMIT_OPEN_USD: String(Math.floor(one) - 1) }).out.opened.length, 0);
  assert.equal(lim({ ACCOUNT_LIMIT_NAME_USD: String(Math.floor(one) - 1) }).out.opened.length, 0);
  assert.equal(lim({ ACCOUNT_LIMIT_NAME_USD: "1000000" }).out.opened.length, n);
  // No shadow trade is made for a limit.
  const held = lim({ ACCOUNT_LIMIT_NEW_PER_DAY: "1" });
  // (the run limit never comes into play: one trade opened, under the engine's two).
  assert.ok(base.out.shadowOpened > 0 && held.out.shadowOpened === 0);
  assert.equal(held.out.candidates.technicals.filter((c) => /account limit/.test(c.why || "")).length, held.out.candidates.technicals.length - 1);
  // Riskier inside the limits: 1.5x would pass the open cap, so the normal size opens.
  const r = run(bookInput(vs, { controls: ctlAt(docAt({ act: "dial", level: "riskier", confirm: true }), BOOK_AM, accountLimits({ ACCOUNT_LIMIT_OPEN_USD: String(Math.ceil(one)) })) }));
  assert.equal(r.out.opened.length, 1); assert.equal(r.out.opened[0].contract.qty, base.out.opened[0].contract.qty);
});

await ok("book: the daily loss stop counts today's change from the first run's marks", () => {
  const syms = symsN(NAMES), vs = views(syms);
  const st = emptyState(), rec = emptyRecord();
  stepBook(st, rec, bookInput(vs, { controls: ctlAt(null, BOOK_AM, accountLimits({ ACCOUNT_LIMIT_DAY_LOSS_USD: "100" })) }));
  assert.equal(st.day.date, BOOK_TODAY);
  assert.ok(rec.open.length >= 1);
  // Mark everything down 60% by the afternoon: the stop holds back new trades.
  const pm = "2026-11-16T20:30:00.000Z", ms = Date.parse(pm);
  const fresh = Object.fromEntries(symsN(NAMES, "M").map((s) => [s, V(s, pullF())]));
  const input = bookInput({ ...vs, ...fresh }, { nowIso: pm, late: true, controls: ctlAt(null, pm, accountLimits({ ACCOUNT_LIMIT_DAY_LOSS_USD: "100" })) });
  input.quote = (t) => ({ mid: t.contract.mid * 0.4, source: "chain", spot: 100 });
  const out = stepBook(st, rec, input);
  assert.ok(out.controls.dayPnl <= -100, String(out.controls.dayPnl));
  assert.equal(out.opened.filter((t) => !ENGINES[t.engine]?.core).length, 0);
  assert.ok(out.candidates.technicals.some((c) => /daily loss stop reached/.test(c.why || "")));
  // Core engine trades (the standing monthly book) are not counted: a big
  // core loss closed today does not move the signal engines' day.
  const coreId = Object.keys(ENGINES).find((id) => ENGINES[id].core);
  const before = out.controls.dayPnl;
  rec.closed.unshift({ tradeId: "core-x", engine: coreId, symbol: "TLT", exitDate: pm, outcome: "loss", status: "rotate", optionPnlPct: -50, contract: { structure: "shares", shares: 500, mid: 100, usd: 50000 } });
  const again = stepBook(st, rec, { ...input, nowIso: "2026-11-16T20:40:00.000Z" });
  assert.equal(again.controls.dayPnl, before, "a core close is left out of the day's result");
});

// ---- the Webull mirror ---------------------------------------------------
function fakeWebull() {
  const orders = new Map(), placed = [];
  return {
    placed,
    accountList: async () => [{ account_id: "PAPER1" }],
    positions: async () => [],
    placeOrder: async (acct, list) => { const o = list[0]; orders.set(o.client_order_id, { status: "SUBMITTED", body: o }); placed.push(o); return { client_order_id: o.client_order_id }; },
    orderDetail: async (acct, id) => { const o = orders.get(id); return { orders: [{ client_order_id: id, status: o.status, filled_price: null, filled_quantity: "0", filled_time_at: null }] }; },
    cancelOrder: async (acct, id) => { const o = orders.get(id); if (o) o.status = "CANCELLED"; return {}; },
  };
}
const T0 = Date.parse("2026-11-16T16:10:00Z");
const flag = (symbol, o = {}) => ({ symbol, side: "call", entryDate: "2026-11-16T16:00:00.000Z", contract: { structure: "long", strike: 100, expiry: WEXP, mid: 4 }, ...o });
const mirror = (acc, gate, ledger = null) => runWebullMirror({ client: fakeWebull(), accountId: "PAPER1", acc, ledger, nowMs: T0, clock: () => 0, quoteFn: async (t) => ({ bid: t.engineEntryPrice, ask: t.engineEntryPrice }), openGate: gate });
await ok("mirror: no gate buys as before; Stop and Avoid log the trade as not bought, never buy it later, and health calls it expected", async () => {
  const acc = { builtAtIso: "2026-11-16T16:02:00.000Z", open: [flag("AAA"), flag("BBB")], closed: [] };
  const plain = await mirror(acc, null);
  assert.equal(plain.summary.placed, 2);
  const none = await mirror(acc, mirrorOpenGate(activeControls(null, T0), accountLimits({}), { nowMs: T0 }));
  assert.equal(none.summary.placed, 2, "no control in force: same orders");
  const avoid = activeControls(applyOwnerControlsRequest(null, { act: "avoid", sym: "BBB" }, { at: "2026-11-16T16:05:00.000Z" }).doc, T0);
  let { ledger, summary } = await mirror(acc, mirrorOpenGate(avoid, null, { nowMs: T0 }));
  assert.equal(summary.placed, 1);
  const held = Object.values(ledger.trades).find((t) => t.symbol === "BBB");
  assert.equal(held.state, "skipped"); assert.match(held.ownerHold, /avoid list/); assert.equal(held.note, held.ownerHold);
  // Lifting the avoid later does not buy it after the fact.
  ({ summary } = await mirror(acc, null, ledger));
  assert.equal(summary.placed, 0);
  const stop = activeControls(applyOwnerControlsRequest(null, { act: "stop", confirm: true }, { at: "2026-11-16T16:05:00.000Z" }).doc, T0);
  ({ ledger, summary } = await mirror(acc, mirrorOpenGate(stop, null, { nowMs: T0 })));
  assert.equal(summary.placed, 0);
  assert.ok(Object.values(ledger.trades).every((t) => t.state === "skipped" && /stopped by the owner/.test(t.ownerHold)));
  // Health: held trades are counted apart, never as an issue.
  const h = mirrorHealth({ acc, ledger, enabled: true }, T0 + 5 * 60000);
  if (h && h.counts) {
    assert.equal(h.counts.ownerHeldOpenPicks, 2);
    assert.ok(!(h.issues || []).some((i) => i.code === "OPEN_PICKS_UNFILLED" || i.code === "OPEN_PICKS_UNTRACKED"));
  }
});

await ok("scorecard: splits closed trades by setting and lists avoided names once", () => {
  const d = chain({ act: "avoid", sym: "TSLA", px: 200 }, { act: "lift", sym: "TSLA", px: 180 }, { act: "avoid", sym: "AMD", px: 100 });
  const eng = [{ optionPnlPct: 20, ownerControls: { dial: "safer" } }, { optionPnlPct: -50, ownerControls: { dial: "safer", watch: true } }, { optionPnlPct: 10, entryDate: later(5) }, { optionPnlPct: 5, entryDate: "2020-01-01" }];
  const pk = [{ optionPnlPct: 30, ownerControls: { catalyst: true } }, { optionPnlPct: -10, status: "owner-avoid", entryDate: later(5) }];
  const s = controlsScorecard(d, { engines: eng, picks: pk });
  const g = Object.fromEntries(s.groups.map((x) => [x.key, x]));
  assert.equal(g["dial:safer"].n, 2); assert.equal(g["dial:safer"].avg, -15); assert.equal(g["dial:safer"].winRate, 0.5);
  assert.equal(g["dial:normal"].n, 3, "unstamped trades since the first control count as Normal; older ones are left out");
  assert.equal(g.watch.n, 1); assert.equal(g.catalyst.n, 1); assert.equal(g["owner-avoid"].n, 1);
  assert.deepEqual(s.avoided.map((a) => [a.sym, a.open, a.px, a.pxEnd]), [["AMD", true, 100, null], ["TSLA", false, 200, 180]]);
  assert.equal(s.ready, false);
});

// ---- the Owner action, end to end ------------------------------------------
// api/auth/[action].js "owner-controls" against an in-memory stand-in for R2
// (GET / PUT with If-Match, so the lease runs as in production).
await ok("route: read, confirm box, save under the lease, price from the stock's file, undo, scorecard", async () => {
  const objects = new Map();
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    if (url.hostname !== "fake-r2.test") return realFetch(input, init);
    const key = decodeURIComponent(url.pathname.replace(/^\/[^/]+\//, ""));
    const m = req.method;
    const cur = objects.get(key);
    if (m === "GET" || m === "HEAD") {
      if (url.searchParams.has("list-type")) return new Response("<ListBucketResult></ListBucketResult>", { status: 200 });
      if (!cur) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
      return new Response(m === "HEAD" ? null : cur.body, { status: 200, headers: { etag: cur.etag, "content-type": "application/json" } });
    }
    if (m === "PUT") {
      const im = req.headers.get("if-match"), inm = req.headers.get("if-none-match");
      if (inm === "*" && cur) return new Response("", { status: 412 });
      if (im && (!cur || cur.etag !== im)) return new Response("", { status: 412 });
      const body = Buffer.from(await req.arrayBuffer());
      const etag = `"e${++n}"`;
      objects.set(key, { body, etag });
      return new Response("", { status: 200, headers: { etag } });
    }
    if (m === "DELETE") { objects.delete(key); return new Response(null, { status: 204 }); }
    return new Response("", { status: 400 });
  };
  Object.assign(process.env, { PRIVATE_DATA_ENABLED: "1", R2_ACCOUNT_ID: "x", R2_ACCESS_KEY_ID: "x", R2_SECRET_ACCESS_KEY: "x", R2_BUCKET: "b", R2_ENDPOINT: "http://fake-r2.test", SESSION_SECRET: "s".repeat(40) });
  const { default: handler } = await import("../api/auth/[action].js");
  const sess = await import("../lib/session.mjs");
  const token = await sess.signSession({ sub: "1", name: "Owner A", tr: true, tp: true }, process.env.SESSION_SECRET);
  const cookie = `${sess.SESSION_COOKIE}=${token}`;
  const call = async (method, body, q = {}) => {
    const res = { headers: {}, statusCode: 200, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return v; }, end(v) { this.body = v; } };
    await handler({ query: { action: "owner-controls", ...q }, method, headers: { host: "example.test", "x-forwarded-proto": "https", origin: "https://example.test", cookie }, body }, res);
    return res;
  };
  objects.set("TSLA.json", { body: Buffer.from(JSON.stringify({ spot: 321.5 })), etag: '"t"' });
  objects.set("owner-settings.json", { body: Buffer.from(JSON.stringify({ version: 1, values: { ACCOUNT_LIMIT_OPEN_USD: 25000 } })), etag: '"s"' });
  let r = await call("GET");
  assert.equal(r.statusCode, 200, JSON.stringify(r.body)); assert.equal(r.body.stop, null); assert.equal(r.body.dial.level, "normal");
  assert.equal(r.body.limits.openUsd, 25000, "limits from the saved Owner Settings");
  r = await call("POST", { act: "stop" }); assert.equal(r.statusCode, 400); assert.equal(r.body.confirm, "stop");
  r = await call("POST", { act: "stop", confirm: true }); assert.equal(r.statusCode, 200, JSON.stringify(r.body)); assert.ok(r.body.stop); assert.equal(r.body.changed, true);
  assert.equal(r.body.stop.by, "Owner A");
  r = await call("POST", { act: "avoid", sym: "TSLA" }); assert.equal(r.body.avoid[0].px, 321.5, "px from the stock's own file");
  r = await call("POST", { act: "stop", confirm: true }); assert.equal(r.body.changed, false);
  r = await call("POST", { act: "undo" }); assert.equal(r.statusCode, 200); assert.equal(r.body.avoid.length, 0);
  r = await call("GET", null, { scorecard: "1" }); assert.ok(r.body.scorecard && Array.isArray(r.body.scorecard.groups));
  const saved = JSON.parse(objects.get("owner-controls.json").body.toString());
  assert.ok(saved.log.length === 3 && saved.log[1].prev && saved.log[2].prev, "the stored log keeps the undo snapshots");
  assert.ok(!JSON.stringify(r.body).includes('"prev"'), "the page never gets them");
  assert.equal(r.body.enabled, true);
  objects.set("owner-settings.json", { body: Buffer.from(JSON.stringify({ version: 1, values: { OWNER_CONTROLS: false } })), etag: '"s2"' });
  r = await call("GET"); assert.equal(r.body.enabled, false, "the kill switch reaches the page"); assert.ok(r.body.stop, "the saved Stop is kept, only not applied");
  globalThis.fetch = realFetch;
});

console.log(`${passed} owner controls checks passed`);
