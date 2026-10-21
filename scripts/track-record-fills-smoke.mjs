// Offline smoke test for the track record's real-fill measurement
// (lib/track-record-fills.mjs) and its wiring in scripts/build.mjs: entry
// bid/ask, real-fill marks, exit details, flat closes, the SPY baseline, the
// archive and the Owner trade-log parser. No network, no data/.
// Run: node scripts/track-record-fills-smoke.mjs
import {
  outcomeFromPnl, positionLegs, legQuote, entryFillCost, realFillMark, exitDetailFor,
  compactClosedForArchive, mergeArchive, parseFillsCsv, fillPnlPct, entrySlippagePct,
} from "../lib/track-record-fills.mjs";
import {
  resolvePickOutcome, computePicksAccuracyStats, advancePicksBaseline, computeBaselineStats,
} from "./build.mjs";

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const near = (a, b, tol = 0.11) => a != null && b != null && Math.abs(a - b) <= tol;

const NOW = Date.UTC(2026, 9, 21, 15, 0) / 1000;
const EXP = Date.UTC(2026, 11, 18) / 1000; // Dec 18 2026, Yahoo midnight-UTC epoch
const chainWith = (rows, type = "c") => ({ spot: 100, chains: { [String(EXP)]: { c: type === "c" ? rows : [], p: type === "p" ? rows : [] } } });

// --- 1. Outcome from P&L ----------------------------------------------------
ok("outcome: +0.04% rounds to flat", outcomeFromPnl(0.04) === "flat");
ok("outcome: -0.04% rounds to flat", outcomeFromPnl(-0.04) === "flat");
ok("outcome: +0.1% is a win", outcomeFromPnl(0.1) === "win");
ok("outcome: -0.1% is a loss", outcomeFromPnl(-0.1) === "loss");
ok("outcome: null is void", outcomeFromPnl(null) === "void");
ok("resolve: thesis broken at 0.0% closes flat, not a win",
  resolvePickOutcome({ modeledOptPnlPct: 0, thesisBroken: true, entrySec: NOW - 2 * 86400, nowSec: NOW })?.outcome === "flat");
ok("resolve: take-profit still a win", resolvePickOutcome({ modeledOptPnlPct: 25, entrySec: NOW - 86400, nowSec: NOW })?.outcome === "win");

// --- 2. Legs and entry cost ---------------------------------------------------
const longEntry = { side: "call", contract: { structure: "long", strike: 100, expiry: EXP, mid: 5, iv: 0.4, bid: 4.9, ask: 5.1 } };
const longLegs = positionLegs(longEntry.contract, "call");
ok("legs: single long is one +1 leg", longLegs.length === 1 && longLegs[0].qty === 1 && longLegs[0].type === "call");
ok("cost: single long pays the ask", entryFillCost(longLegs) === 5.1);
ok("cost: missing entry bid/ask -> null (old trades)", entryFillCost(positionLegs({ strike: 100, expiry: EXP, mid: 5, iv: 0.4 }, "call")) == null);
const debitEntry = { side: "call", contract: { structure: "debit_vertical", expiry: EXP, legs: [
  { qty: 1, type: "call", strike: 100, iv: 0.4, expiry: EXP, bid: 4.9, ask: 5.1 },
  { qty: -1, type: "call", strike: 110, iv: 0.38, expiry: EXP, bid: 1.9, ask: 2.1 },
] } };
ok("cost: debit spread = long ask - short bid", near(entryFillCost(positionLegs(debitEntry.contract, "call")), 3.2, 1e-9));
const creditEntry = { side: "call", contract: { structure: "credit_vertical", expiry: EXP, legs: [
  { qty: -1, type: "put", strike: 95, iv: 0.4, expiry: EXP, bid: 3.0, ask: 3.2 },
  { qty: 1, type: "put", strike: 90, iv: 0.42, expiry: EXP, bid: 1.4, ask: 1.6 },
] } };
ok("cost: credit spread is negative (credit received = short bid - long ask)", near(entryFillCost(positionLegs(creditEntry.contract, "call")), -1.4, 1e-9));

// --- 3. Real-fill marks ---------------------------------------------------------
ok("quote: finds the strike row", legQuote(chainWith([{ s: 100, b: 6, a: 6.2 }]), longLegs[0])?.bid === 6);
ok("quote: crossed row is unusable", legQuote(chainWith([{ s: 100, b: 6.3, a: 6.2 }]), longLegs[0]) == null);
ok("quote: 0/0 row is unusable", legQuote(chainWith([{ s: 100, b: 0, a: 0 }]), longLegs[0]) == null);
const rfLong = realFillMark(longEntry, chainWith([{ s: 100, b: 6.0, a: 6.2 }]), { nowSec: NOW });
ok("real fill: long sells at the bid (6.0 / 5.1 - 1 = +17.6%)", rfLong && rfLong.basis === "quote" && near(rfLong.pnlPct, 17.6), JSON.stringify(rfLong));
const rfEntry = realFillMark(longEntry, chainWith([{ s: 100, b: 4.9, a: 5.1 }]), { nowSec: NOW });
ok("real fill: at entry it shows the spread cost (4.9 / 5.1 - 1)", rfEntry && near(rfEntry.pnlPct, -3.9));
const rfModel = realFillMark(longEntry, chainWith([]), { nowSec: NOW });
ok("real fill: no quote falls back to the model less half the entry spread", rfModel && rfModel.basis === "model" && Number.isFinite(rfModel.pnlPct));
ok("real fill: old trade without entry bid/ask -> null", realFillMark({ side: "call", contract: { strike: 100, expiry: EXP, mid: 5, iv: 0.4 } }, chainWith([{ s: 100, b: 6, a: 6.2 }]), { nowSec: NOW }) == null);
const rfDebit = realFillMark(debitEntry, chainWith([{ s: 100, b: 7.0, a: 7.2 }, { s: 110, b: 2.8, a: 3.0 }]), { nowSec: NOW });
ok("real fill: debit spread sells long at bid, buys short at ask ((7.0-3.0)/3.2-1 = +25%)", rfDebit && near(rfDebit.pnlPct, 25), JSON.stringify(rfDebit));
const rfCredit = realFillMark(creditEntry, chainWith([{ s: 95, b: 1.5, a: 1.6 }, { s: 90, b: 0.6, a: 0.7 }], "p"), { nowSec: NOW });
ok("real fill: credit spread buys back short at ask, sells long at bid ((1.4-(1.6-0.6))/1.4 = +28.6%)", rfCredit && near(rfCredit.pnlPct, 28.6), JSON.stringify(rfCredit));
const rfExpired = realFillMark(longEntry, { spot: 108, chains: {} }, { nowSec: EXP + 3 * 86400 });
ok("real fill: after expiry uses intrinsic (8 / 5.1 - 1 = +56.9%)", rfExpired && near(rfExpired.pnlPct, 56.9));

// --- 4. Exit detail -----------------------------------------------------------
const tp = exitDetailFor("hit-tp-prem", 38.6, { tpPct: 20, stopPct: 50 });
ok("exit detail: TP booked late shows the overshoot", tp.triggerPct === 20 && tp.atTriggerPct === 20 && near(tp.overshootPct, 18.6));
const sl = exitDetailFor("hit-stop-prem", -59, { tpPct: 20, stopPct: 50 });
ok("exit detail: stop trigger is -50", sl.triggerPct === -50 && sl.atTriggerPct === -50 && near(sl.overshootPct, -9));
const th = exitDetailFor("thesis-broken", -12, { tpPct: 20, stopPct: 50 });
ok("exit detail: non-trigger exits book as is", th.triggerPct == null && th.atTriggerPct === -12 && th.overshootPct == null);

// --- 5. Stats -------------------------------------------------------------------
const closed = [
  { outcome: "win", optionPnlPct: 38, realFillPnlPct: 33, exitDetail: { atTriggerPct: 20 } },
  { outcome: "loss", optionPnlPct: -59, realFillPnlPct: -62, exitDetail: { atTriggerPct: -50 } },
  { outcome: "flat", optionPnlPct: 0 },
  { outcome: "win", optionPnlPct: 10 },
];
const st = computePicksAccuracyStats([], closed, null);
ok("stats: flat close stays out of decided", st.decided === 3 && st.flat === 1);
ok("stats: real-fill expectancy on trades that have it", st.realFillDecided === 2 && near(st.realFillExpectancyPct, -14.5));
ok("stats: model expectancy on the same real-fill trades", near(st.realFillModelExpectancyPct, -10.5));
ok("stats: at-trigger expectancy ((20-50+10)/3)", near(st.atTriggerExpectancyPct, -6.7));
ok("stats: option win rate counts only > 0", near(st.optionWinRate, 2 / 3, 1e-9));

// --- 6. SPY baseline ------------------------------------------------------------
const spyRows = [];
for (let k = 560; k <= 640; k += 5) spyRows.push({ s: k, b: Math.max(0.5, 600 - k + 18) - 0.1, a: Math.max(0.5, 600 - k + 18) + 0.1, iv: 0.16, oi: 5000, v: 100 });
const spyChain = (spot) => ({ spot, chains: { [String(Date.UTC(2026, 11, 18) / 1000)]: { c: spyRows, p: spyRows.map((r) => ({ ...r, b: Math.max(0.5, r.s - 600 + 18) - 0.1, a: Math.max(0.5, r.s - 600 + 18) + 0.1 })) } } });
const builtA = "2026-10-21T15:00:00.000Z";
const pickA = { symbol: "NVDA", side: "call", entryDate: builtA };
const b1 = advancePicksBaseline({ open: [], closed: [] }, {
  chains: { SPY: spyChain(600) }, nowSec: Date.parse(builtA) / 1000, builtAtIso: builtA,
  enrolled: [pickA], openPairKeys: new Set(["NVDA:call:" + builtA]),
});
ok("baseline: a new pick opens one paired SPY trade", b1.open.length === 1 && b1.open[0].pairKey === "NVDA:call:" + builtA && b1.open[0].symbol === "SPY");
ok("baseline: SPY trade stores entry bid/ask and a real-fill entry cost", b1.open[0].contract.ask > b1.open[0].contract.bid && b1.open[0].realFillPnlPct < 0);
const builtB = "2026-10-22T15:00:00.000Z";
const b2 = advancePicksBaseline(b1, { chains: { SPY: spyChain(601) }, nowSec: Date.parse(builtB) / 1000, builtAtIso: builtB, enrolled: [], openPairKeys: new Set() });
ok("baseline: closes when its paired pick closes", b2.open.length === 0 && b2.closed.length === 1 && b2.closed[0].status === "pair-closed");
const bs = computeBaselineStats(b2, [{ symbol: "NVDA", side: "call", entryDate: builtA, outcome: "win", optionPnlPct: 30, realFillPnlPct: 26 }]);
ok("baseline stats: paired edge = pick minus SPY", bs && bs.paired.n === 1 && near(bs.paired.edgePct, 30 - b2.closed[0].optionPnlPct, 0.06), JSON.stringify(bs?.paired));
ok("baseline stats: none without any baseline trades", computeBaselineStats({ open: [], closed: [] }, []) == null);

// --- 7. Archive -----------------------------------------------------------------
const full = { symbol: "AAPL", side: "put", entryDate: "2026-06-01T15:00:00Z", exitDate: "2026-06-05T15:00:00Z", outcome: "loss", optionPnlPct: -51, thesis: { aiGrade: "strong", summary: "long text" }, strategy: { reason: "x" }, contract: { structure: "long", strike: 200, mid: 4, bid: 3.9, ask: 4.1 } };
const slim = compactClosedForArchive(full);
ok("archive: slim copy keeps the numbers and drops the narrative", slim.optionPnlPct === -51 && slim.aiGrade === "strong" && slim.thesis === undefined && slim.strategy === undefined && slim.archived === true);
const merged = mergeArchive([slim], [full, { ...full, entryDate: "2026-06-10T15:00:00Z", exitDate: "2026-06-12T15:00:00Z" }]);
ok("archive: dedupes by symbol:side:entryDate and sorts newest first", merged.length === 2 && merged[0].entryDate === "2026-06-10T15:00:00Z");
ok("archive: respects the cap", mergeArchive([], [full, { ...full, entryDate: "2026-06-10T15:00:00Z" }], 1).length === 1);

// --- 8. Owner trade log -----------------------------------------------------------
const csv = [
  "trade_id,account,symbol,side,structure,legs,qty,mingstreet_entry_mid,fill_price,close_fill_price,fees,notes",
  'NVDA-C-10/21/26-11:00,webull-paper,NVDA,call,long,"C 190, Dec 18",1,8.40,8.45,10.35,0.65,',
  "MSFT-P-10/21/26-11:00,rh-real,MSFT,put,credit_vertical,,1,1.40,1.35,0.70,,",
  "NVDA-C-10/20/26-11:00,webull-paper,NVDA,call,long,,1,8,8,9,,example row - delete",
  ",webull-paper,AAPL,call,long,,1,5,5,6,,",
  "AMD-C-10/21/26-11:00,rh-real,AMD,call,long,,1,abc,5,6,,",
].join("\r\n");
const parsed = parseFillsCsv(csv);
ok("fills: keeps valid rows, skips example and no-id rows", parsed.rows.length === 3, JSON.stringify(parsed.rows.map((r) => r.trade_id)));
ok("fills: quoted field with a comma stays one field", parsed.rows[0].legs === "C 190, Dec 18");
ok("fills: your P&L after fees ((10.35/8.45-1) - 0.65/845)", near(parsed.rows[0].your_pnl_pct, 22.5 - 0.1, 0.11), String(parsed.rows[0].your_pnl_pct));
ok("fills: credit P&L ((1.35-0.70)/1.35)", near(parsed.rows[1].your_pnl_pct, 48.1));
ok("fills: entry slippage vs the record mid", near(parsed.rows[0].entry_slippage_pct, 0.6, 0.01) && near(parsed.rows[1].entry_slippage_pct, 3.57, 0.01));
ok("fills: a bad number is reported", parsed.errors.some((e) => /mingstreet_entry_mid/.test(e)));
ok("fills: missing trade_id column is rejected", parseFillsCsv("symbol,fill_price\nNVDA,1").errors[0] === "missing trade_id column");
ok("fills: control characters are stripped", parseFillsCsv("trade_id,notes\nX-1,a\u0007b").rows[0].notes === "a b");
ok("fills: slippage falls back to the record mid", near(entrySlippagePct({ fill_price: 5.2, structure: "long" }, 5), 4));
ok("fills: no close price -> no P&L yet", fillPnlPct({ fill_price: 5 }) == null);

console.log(`\n${pass}/${pass + fail} checks passed.`);
if (fail) process.exit(1);
