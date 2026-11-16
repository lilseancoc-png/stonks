// Signed option flow (lib/flow-direction.mjs): tag, stale check, delta, the
// next-morning OI join and the per-stock read. Run: node scripts/flow-direction-smoke.mjs
import assert from "node:assert/strict";
import {
  tapeTag, printSide, flowSign, stalePrint, etCloseMs, contractDelta, eligiblePrint, printWeightUsd,
  oiConfirmation, joinNextDayOi, signedFlowBySymbol, signedFlowVote, legacyFlowVote, legacyPersistBySymbol,
  flowVotesBySymbol, flowSignedEnabled,
} from "../lib/flow-direction.mjs";

let n = 0;
const ok = (name, fn) => { fn(); n++; };

ok("tag: a print at the bid on a 1-cent market is bid, not ask (the old bug)", () => {
  assert.equal(tapeTag(0.05, 0.06, 0.05), "bid");
  assert.equal(tapeTag(0.05, 0.06, 0.06), "ask");
  assert.equal(tapeTag(1.20, 1.21, 1.20), "bid");
  // Float noise around whole cents does not move the tag.
  assert.equal(tapeTag(0.1 + 0.2, 0.31, 0.3), "bid");
});
ok("tag: at or past each side, around the midpoint, and junk quotes", () => {
  assert.equal(tapeTag(1.00, 1.20, 1.25), "ask");
  assert.equal(tapeTag(1.00, 1.20, 0.95), "bid");
  assert.equal(tapeTag(1.00, 1.20, 1.10), "mid");
  assert.equal(tapeTag(1.00, 1.20, 1.15), "abv");
  assert.equal(tapeTag(1.00, 1.20, 1.04), "blw");
  assert.equal(tapeTag(1.00, 1.00, 1.00), null);
  assert.equal(tapeTag(1.10, 1.00, 1.05), null);
  assert.equal(tapeTag(null, 1.00, 1.05), null);
});
ok("sign: call bought +1, call sold -1, put bought -1, put sold +1, midpoint 0", () => {
  assert.equal(printSide("abv"), "buy"); assert.equal(printSide("blw"), "sell"); assert.equal(printSide("mid"), null);
  assert.equal(flowSign("call", "ask"), 1); assert.equal(flowSign("call", "bid"), -1);
  assert.equal(flowSign("put", "ask"), -1); assert.equal(flowSign("put", "bid"), 1);
  assert.equal(flowSign("call", "mid"), 0); assert.equal(flowSign("call", null), 0);
});
ok("stale: a last trade 15+ minutes before the scan (or the close) can't be read", () => {
  const scan = Date.parse("2026-11-16T16:00:00Z"); // 11:00 ET
  assert.equal(stalePrint(new Date(scan - 5 * 60000), scan), false);
  assert.equal(stalePrint(new Date(scan - 20 * 60000), scan), true);
  assert.equal(stalePrint(null, scan), false);
  assert.equal(stalePrint((scan - 20 * 60000) / 1000, scan), true); // epoch seconds
  // A 16:05 ET scan reads a 15:58 ET print against the 16:00 close.
  const close = etCloseMs(Date.parse("2026-11-16T21:05:00Z"));
  assert.equal(new Date(close).toISOString(), "2026-11-16T21:00:00.000Z");
  assert.equal(stalePrint(Date.parse("2026-11-16T20:58:00Z"), Date.parse("2026-11-16T21:05:00Z")), false);
  // Summer time: 16:00 ET is 20:00 UTC.
  assert.equal(new Date(etCloseMs(Date.parse("2026-07-15T18:00:00Z"))).toISOString(), "2026-07-15T20:00:00.000Z");
  // The 09:00 ET pre-open scan: yesterday's last print is stale.
  assert.equal(stalePrint(Date.parse("2026-11-13T20:59:00Z"), Date.parse("2026-11-16T14:00:00Z")), true);
});
ok("delta: Black-Scholes from the contract's IV; junk IV gives none", () => {
  const now = Date.parse("2026-11-16T16:00:00Z"), exp = Date.parse("2026-12-18T00:00:00Z") / 1000;
  const c = contractDelta("call", 100, 110, exp, 0.4, now), p = contractDelta("put", 100, 90, exp, 0.4, now);
  assert.ok(c > 0.1 && c < 0.5 && p < -0.05 && p > -0.5);
  assert.equal(contractDelta("call", 100, 110, exp, 0.00001, now), null);
  assert.equal(contractDelta("call", 100, 110, exp, null, now), null);
});
const base = { symbol: "AAA", side: "call", strike: 110, expSec: 1797292800, tape: "ask", delta: 0.3, spot: 100, last: 1.5, dte: 20, deltaVol: 2000, vol: 2500, oi: 400 };
ok("eligible: same-day expiry, under $0.10, stale, midpoint and missing delta are left out", () => {
  assert.equal(eligiblePrint(base), true);
  assert.equal(eligiblePrint({ ...base, dte: 0 }), false);
  assert.equal(eligiblePrint({ ...base, last: 0.09 }), false);
  assert.equal(eligiblePrint({ ...base, tapeStale: true }), false);
  assert.equal(eligiblePrint({ ...base, tape: "mid" }), false);
  assert.equal(eligiblePrint({ ...base, delta: null }), false);
  assert.equal(eligiblePrint({ ...base, tape: undefined }), false); // log rows from before the change
  assert.equal(printWeightUsd(base), 2000 * 0.3 * 100 * 100);
});
ok("OI read: opened from a quarter of the volume, closed when OI fell", () => {
  assert.equal(oiConfirmation(1000, 2500), "opened");
  assert.equal(oiConfirmation(300, 2500), "mixed");
  assert.equal(oiConfirmation(0, 2500), "mixed");
  assert.equal(oiConfirmation(-50, 2500), "closed");
  assert.equal(oiConfirmation(null, 2500), null);
});
ok("OI join: stamps the next trading morning's settled OI on the flag day's prints", () => {
  const entries = [
    { ...base, scannedAt: "2026-11-13T16:00:00Z", vol: 1500, oi: 400 },
    { ...base, scannedAt: "2026-11-13T18:00:00Z", vol: 2500, oi: 400 },
    { ...base, strike: 115, scannedAt: "2026-11-13T18:00:00Z", vol: 3000, oi: 900 },
    { ...base, strike: 120, scannedAt: "2026-11-16T15:00:00Z", vol: 3000, oi: 900 }, // today: no next morning yet
  ];
  const filler = Array.from({ length: 60 }, (_, i) => ({ symbol: "ZZZ", side: "call", strike: i, expSec: 1, oi: 100 }));
  const oiHistory = { snapshots: [
    { etDate: "2026-11-13", scanType: "premarket", scannedAt: "2026-11-13T13:30:00Z", contracts: [
      ...filler, { symbol: "AAA", side: "call", strike: 110, expSec: base.expSec, oi: 400 }, { symbol: "AAA", side: "call", strike: 115, expSec: base.expSec, oi: 900 }] },
    { etDate: "2026-11-13", scanType: "eod", scannedAt: "2026-11-13T22:00:00Z", contracts: [] },
    { etDate: "2026-11-16", scanType: "premarket", scannedAt: "2026-11-16T13:30:00Z", contracts: [
      ...filler.map((c) => ({ ...c, oi: c.oi + 1 })), { symbol: "AAA", side: "call", strike: 110, expSec: base.expSec, oi: 1900 }, { symbol: "AAA", side: "call", strike: 115, expSec: base.expSec, oi: 700 }] },
  ] };
  assert.equal(joinNextDayOi(entries, oiHistory), 3);
  assert.equal(entries[0].oiRead, "opened"); assert.equal(entries[0].oiChg, 1500); assert.equal(entries[0].oiDate, "2026-11-16");
  assert.equal(entries[1].oiRead, "opened");
  assert.equal(entries[2].oiRead, "closed"); assert.equal(entries[2].oiChg, -200);
  assert.equal(entries[3].oiRead, undefined);
  // Already stamped: not stamped again.
  assert.equal(joinNextDayOi(entries, oiHistory), 0);
});
ok("OI join: a morning snapshot the provider has not rolled forward is skipped", () => {
  const entries = [{ ...base, scannedAt: "2026-11-13T18:00:00Z" }];
  const contracts = Array.from({ length: 60 }, (_, i) => ({ symbol: "ZZZ", side: "call", strike: i, expSec: 1, oi: 100 }));
  const same = [...contracts, { symbol: "AAA", side: "call", strike: 110, expSec: base.expSec, oi: 400 }];
  const hist = { snapshots: [
    { etDate: "2026-11-13", scanType: "premarket", contracts: same },
    { etDate: "2026-11-16", scanType: "premarket", contracts: same },
  ] };
  assert.equal(joinNextDayOi(entries, hist), 0);
  assert.equal(entries[0].oiRead, undefined);
});
ok("read: opened trades count in full, today's half, closed a quarter; old prints fade", () => {
  const now = Date.parse("2026-11-16T19:00:00Z");
  const log = { entries: [
    { ...base, scannedAt: "2026-11-16T16:00:00Z" },                                     // today, bullish, pending
    { ...base, strike: 115, scannedAt: "2026-11-13T17:00:00Z", oiRead: "opened" },      // bullish, opened
    { ...base, side: "put", strike: 90, delta: -0.3, scannedAt: "2026-11-16T17:00:00Z", tape: "bid" }, // put sold: bullish
    { ...base, side: "call", strike: 120, scannedAt: "2026-11-14T17:00:00Z", tape: "bid", oiRead: "closed" }, // call sold, closed: small bear
    { ...base, strike: 125, scannedAt: "2026-11-01T17:00:00Z" },                         // outside the 7 days
  ] };
  const r = signedFlowBySymbol(log, now).AAA;
  assert.equal(r.n, 4); assert.equal(r.contracts, 4); assert.equal(r.opened, 1); assert.equal(r.closed, 1); assert.equal(r.pending, 2);
  assert.ok(r.balance > 0.8 && r.bearUsd > 0);
  assert.equal(r.today.nBull, 2); assert.equal(r.today.nBear, 0);
  assert.equal(r.today.bullPrem, 2 * 2000 * 1.5 * 100);
  const v = signedFlowVote(r);
  assert.equal(v.vote, 1); assert.equal(v.ok, true); assert.match(v.value, /^\+0\.\d\d · \$[\d.]+M bull \/ \$[\d.]+[MK] bear · 4 contracts, 1 opened$/);
});
ok("vote: bearish needs -0.40, thin evidence does not vote", () => {
  const mk = (balance, contracts = 4, usd = 5e6) => ({ balance, contracts, bullUsd: usd * (1 + balance) / 2, bearUsd: usd * (1 - balance) / 2, opened: 0 });
  assert.equal(signedFlowVote(mk(0.3)).vote, 1);
  assert.equal(signedFlowVote(mk(-0.35)).vote, 0);
  assert.equal(signedFlowVote(mk(-0.4)).vote, -1);
  assert.equal(signedFlowVote(mk(0.9, 2)).ok, false);
  assert.equal(signedFlowVote(mk(0.9, 4, 5e5)).ok, false);
  assert.equal(signedFlowVote(null).ok, false);
});
ok("older rule: ask-side counts, then the side-blind 7-day balance", () => {
  const cs = (c, p) => [...Array(c).fill({ side: "call", tape: "ask" }), ...Array(p).fill({ side: "put", tape: "abv" })];
  assert.equal(legacyFlowVote(cs(5, 1)).vote, 1);
  assert.equal(legacyFlowVote(cs(1, 5)).vote, -1);
  assert.equal(legacyFlowVote(cs(1, 1), -0.5).vote, -1);
  assert.equal(legacyFlowVote(null, 0.1).ok, false);
  const now = Date.parse("2026-11-16T19:00:00Z");
  const log = { entries: Array.from({ length: 6 }, (_, i) => ({ symbol: "BBB", side: "put", scannedAt: new Date(now - i * 3600000).toISOString() })) };
  assert.equal(legacyPersistBySymbol(log, now).BBB.balance, -1);
});
ok("side by side: old and new votes for the shadow log", () => {
  const now = Date.parse("2026-11-16T19:00:00Z");
  // Calls written at the bid: the old rule reads a call-heavy week as bullish,
  // the signed rule reads it bearish.
  const entries = Array.from({ length: 6 }, (_, i) => ({ ...base, strike: 100 + i, tape: "bid", scannedAt: new Date(now - (i + 1) * 3600000).toISOString() }));
  const v = flowVotesBySymbol({ tickers: [] }, { entries }, now).AAA;
  assert.equal(v.ufo, 1); assert.equal(v.ufn, -1); assert.equal(v.ufb, -1);
});
ok("switch: FLOW_SIGNED=0 turns the signed read off", () => {
  assert.equal(flowSignedEnabled({}), true);
  assert.equal(flowSignedEnabled({ FLOW_SIGNED: "1" }), true);
  assert.equal(flowSignedEnabled({ FLOW_SIGNED: "0" }), false);
});

console.log(`${n} flow-direction checks passed`);
