// Offline synthetic smoke test for the LIVE Day Trades engine in
// scripts/scan-unusual.mjs. No Yahoo, no data/, no AI — feeds synthetic
// volume-flag rows + quotes through the pure helpers and asserts the level
// math, candidate selection, take-profit / stop-loss resolution, P/L
// accounting, and the time helpers. Run: node scripts/day-trades-smoke.mjs
import {
  dtBuildPlan, dtBuildCandidate, dtDirection, dtEvaluateHit, dtCloseTrade,
  dtComputeStats, dtTradingDaysBetween, dtBuildThesis, dtBuildOptionIdea,
  dtPickOptionContract, dtMarkOption,
} from "./scan-unusual.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); } };
const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;

// --- 1. plan builder ------------------------------------------------------
const longScalp = dtBuildPlan("long", 100, { dayLo: 99, dayHi: 100.5, callWall: 103, putWall: null, flip: null, srLevel: null }, "scalp");
ok("plan: long scalp returns levels", !!longScalp);
ok("plan: long scalp entry = spot", longScalp && near(longScalp.entry, 100));
ok("plan: long scalp stop below entry at structure", longScalp && longScalp.stop < 100 && near(longScalp.stop, 99));
ok("plan: long scalp target above entry", longScalp && longScalp.target > 100);
ok("plan: long scalp reward:risk >= 1", longScalp && longScalp.rr >= 1);

const shortScalp = dtBuildPlan("short", 100, { dayLo: 97, dayHi: 101, callWall: null, putWall: 97, flip: null, srLevel: null }, "scalp");
ok("plan: short scalp stop above entry", shortScalp && shortScalp.stop > 100);
ok("plan: short scalp target below entry", shortScalp && shortScalp.target < 100);

// Stop too far for the band → capped within the kind's max risk.
const capped = dtBuildPlan("long", 100, { dayLo: 80, dayHi: 101, callWall: 110, putWall: null, flip: null, srLevel: null }, "scalp");
ok("plan: out-of-band support is capped to the scalp risk band", capped && (100 - capped.stop) <= 100 * 0.015 + 1e-6);

// --- 2. direction read ----------------------------------------------------
const rowBull = { symbol: "AAA", spot: 100, bucketHits: [{ volRatio: 1.8, priceMovePct: 2.0, srBreak: { type: "upper", conviction: "Medium", level: 98 } }], gex: { net: -1, callWall: { strike: 103 }, putWall: { strike: 97 }, flip: null } };
const rowBear = { symbol: "BBB", spot: 100, bucketHits: [{ volRatio: 1.6, priceMovePct: -2.2, srBreak: { type: "lower", conviction: "High", level: 102 } }], gex: { net: -1, callWall: { strike: 104 }, putWall: { strike: 96 }, flip: null } };
const rowQuiet = { symbol: "CCC", spot: 100, bucketHits: [{ volRatio: 1.05, priceMovePct: 0.1, srBreak: null }], gex: null };
ok("direction: resistance break + up move reads bullish", dtDirection(rowBull, 2.0) > 1);
ok("direction: support break + down move reads bearish", dtDirection(rowBear, -2.2) < -1);

// --- 3. candidate selection ----------------------------------------------
const candBull = dtBuildCandidate(rowBull, { spot: 100, dayHi: 101.5, dayLo: 99, changePct: 2.0 });
ok("candidate: hot bullish row yields a long", candBull && candBull.side === "long");
ok("candidate: confirmed break → swing kind", candBull && candBull.kind === "swing");
ok("candidate: ships a tradeable plan (rr>=DT_MIN_RR)", candBull && candBull.plan && candBull.plan.rr >= 1.2);
ok("candidate: basis mentions volume", candBull && /expected volume/.test(candBull.basis));

const candBear = dtBuildCandidate(rowBear, { spot: 100, dayHi: 101, dayLo: 98.5, changePct: -2.2 });
ok("candidate: hot bearish row yields a short", candBear && candBear.side === "short");
// A setup whose nearest structural target pays < 1.2× the stop risk is now
// dropped (bare ~1:1 is break-even on an expired-win-inflated board).
const rowThinRR = { symbol: "TRR", spot: 100, bucketHits: [{ volRatio: 1.8, priceMovePct: 2.0, srBreak: { type: "upper", conviction: "Medium", level: 98 } }], gex: { net: -1, callWall: { strike: 101.1 }, putWall: { strike: 97 }, flip: null } };
ok("candidate: sub-1.2 reward:risk setup is rejected", dtBuildCandidate(rowThinRR, { spot: 100, dayHi: 101.1, dayLo: 99, changePct: 2.0 }) === null);

ok("candidate: quiet (sub-1.3x) volume is rejected", dtBuildCandidate(rowQuiet, { spot: 100, dayHi: 100.5, dayLo: 99.5, changePct: 0.1 }) === null);
const rowHotNoDir = { symbol: "DDD", spot: 100, bucketHits: [{ volRatio: 2.0, priceMovePct: 0.0, srBreak: null }], gex: null };
ok("candidate: hot but directionless is rejected", dtBuildCandidate(rowHotNoDir, { spot: 100, dayHi: 100.2, dayLo: 99.8, changePct: 0.0 }) === null);

// Anti-chase: a fresh momentum read (no confirmed break) into an over-extended
// aligned day move is rejected (buying the top); the same setup within the cap
// still trades; a confirmed break earns the looser leash.
const rowChase = { symbol: "EEE", spot: 100, bucketHits: [{ volRatio: 2.1, priceMovePct: 5.8, srBreak: null }], gex: { net: -1, callWall: { strike: 105 }, putWall: { strike: 98 }, flip: 99 } };
ok("candidate: extended momentum chase (+5.8%, no break) is rejected", dtBuildCandidate(rowChase, { spot: 100, dayHi: 100.2, dayLo: 94.4, changePct: 5.8 }) === null);
const rowMomOK = { symbol: "FFF", spot: 100, bucketHits: [{ volRatio: 2.1, priceMovePct: 2.5, srBreak: null }], gex: { net: -1, callWall: { strike: 105 }, putWall: { strike: 98 }, flip: 99 } };
ok("candidate: in-band momentum (+2.5%, no break) still trades", dtBuildCandidate(rowMomOK, { spot: 100, dayHi: 100.2, dayLo: 97.4, changePct: 2.5 }) !== null);
const rowBreakHot = { symbol: "GGG", spot: 100, bucketHits: [{ volRatio: 2.4, priceMovePct: 6.0, srBreak: { type: "upper", conviction: "Very High", level: 95 } }], gex: { net: -1, callWall: { strike: 108 }, putWall: { strike: 96 }, flip: 97 } };
ok("candidate: confirmed break tolerates a bigger move (+6%) than momentum", dtBuildCandidate(rowBreakHot, { spot: 100, dayHi: 100.5, dayLo: 94, changePct: 6.0 }) !== null);
// A counter-move long (confirmed bullish break, but RED on the day) is a dip
// entry, not a chase — the cap must not fire on it.
const rowDipBuy = { symbol: "HHH", spot: 100, bucketHits: [{ volRatio: 1.8, priceMovePct: -5.0, srBreak: { type: "upper", conviction: "Very High", level: 99 } }], gex: null };
const dipCand = dtBuildCandidate(rowDipBuy, { spot: 100, dayHi: 106, dayLo: 99.5, changePct: -5.0 });
ok("candidate: counter-move dip-buy (long, -5% day) is NOT chase-rejected", dipCand && dipCand.side === "long");

// --- 4. take-profit / stop-loss resolution -------------------------------
const longT = { side: "long", entry: 100, stop: 98, target: 104, openDayHi: 100.5, openDayLo: 99.5 };
ok("hit: long reaches target", dtEvaluateHit(longT, 104.2, 104.2, 99.9) === "target");
ok("hit: long reaches stop", dtEvaluateHit(longT, 97.9, 100.2, 97.9) === "stop");
ok("hit: long target via NEW intraday high (wick caught)", dtEvaluateHit(longT, 101, 104.5, 99.9) === "target");
ok("hit: long mid-range stays open", dtEvaluateHit(longT, 100.4, 100.6, 99.7) === null);
ok("hit: tie resolves to stop (conservative)", dtEvaluateHit(longT, 97.9, 104.5, 97.9) === "stop");

const shortT = { side: "short", entry: 100, stop: 102, target: 96, openDayHi: 100.5, openDayLo: 99.5 };
ok("hit: short reaches target (down)", dtEvaluateHit(shortT, 95.9, 100.2, 95.9) === "target");
ok("hit: short reaches stop (up)", dtEvaluateHit(shortT, 102.1, 102.1, 99.9) === "stop");

// --- 5. P/L accounting ----------------------------------------------------
const wonLong = dtCloseTrade({ id: "x", sym: "AAA", side: "long", kind: "swing", entry: 100, stop: 98, target: 104, riskPct: 2, openedAt: "2024-01-02T15:00:00Z", openEtDate: "2024-01-02", basis: "", pace: 1.8 }, "target", 104, "2024-01-03T15:00:00Z", "2024-01-03");
ok("pnl: long target = +4% win", wonLong.win === true && near(wonLong.pnlPct, 4));
ok("pnl: long +4% on 2% risk = +2R", near(wonLong.pnlR, 2));
const lostShort = dtCloseTrade({ id: "y", sym: "BBB", side: "short", kind: "scalp", entry: 100, stop: 102, target: 96, riskPct: 2, openedAt: "2024-01-02T15:00:00Z", openEtDate: "2024-01-02", basis: "", pace: 1.6 }, "stop", 102, "2024-01-02T19:00:00Z", "2024-01-02");
ok("pnl: short stopped = -2% loss", lostShort.win === false && near(lostShort.pnlPct, -2));
ok("pnl: no option snapshot -> stock-move fallback (legacy path)", wonLong.optModeled === false && lostShort.optModeled === false);

// --- 5b. option-tracked P/L (score the recommended CONTRACT, not the stock) ---
const dteSec = (d) => Math.floor(Date.now() / 1000) + d * 86400;
const mkRow = (K) => ({ strike: K, bid: Math.max(0.1, 3 - Math.abs(100 - K) * 0.25), ask: Math.max(0.2, 3 - Math.abs(100 - K) * 0.25) + 0.1, impliedVolatility: 0.6, openInterest: 500, volume: 100 });
const optChain = { spot: 100, exp: dteSec(7), calls: [90, 95, 100, 105, 110].map(mkRow), puts: [90, 95, 100, 105, 110].map(mkRow) };
const optCall = dtPickOptionContract(optChain, "call", 100, 97);
ok("opt: picks an ATM ~0.50Δ call w/ entry premium + iv + 1R risk", optCall && optCall.side === "call" && near(optCall.strike, 100, 0.01) && optCall.entryPrem > 0 && optCall.iv === 0.6 && optCall.riskPct > 0);
ok("opt: a short trade snapshots the put side", (() => { const p = dtPickOptionContract(optChain, "put", 100, 103); return !!p && p.side === "put"; })());
ok("opt: illiquid chain (no OI) -> no snapshot (stock fallback)", dtPickOptionContract({ spot: 100, exp: dteSec(7), calls: [{ ...mkRow(100), openInterest: 0 }], puts: [] }, "call", 100, 97) === null);
const optUp = dtMarkOption(optCall, 106, dteSec(0) + 3600);
ok("opt: a favorable stock move is LEVERAGED on the option (>> the 6% share move)", optUp != null && optUp > 6);
ok("opt: theta erodes the same move later in the hold", dtMarkOption(optCall, 106, dteSec(5)) < optUp);
const optBase = { id: "o", sym: "CCC", side: "long", kind: "swing", entry: 100, stop: 97, target: 106, riskPct: 3, openedAt: new Date().toISOString(), openEtDate: "2026-06-24", opt: optCall, optHiPct: 50, optLoPct: -10, basis: "", pace: 1.9 };
const optWin = dtCloseTrade(optBase, "target", 106, new Date(Date.now() + 3600e3).toISOString(), "2026-06-24");
ok("opt: target close reports the OPTION P/L (not the +6% stock), win = option sign", optWin.optModeled === true && optWin.win === true && optWin.pnlPct > 6 && near(optWin.stockPnlPct, 6));
ok("opt: option R uses the option's 1R risk denominator", optWin.pnlR != null && optWin.pnlR > 0);
const optStop = dtCloseTrade({ ...optBase, id: "o2" }, "stop", 97, new Date(Date.now() + 3600e3).toISOString(), "2026-06-24");
ok("opt: a stop close is an OPTION loss (win=false)", optStop.optModeled === true && optStop.win === false && optStop.pnlPct < 0);
ok("opt: stats aggregate the option P/L (win one / loss one)", dtComputeStats([optWin, optStop]).wins === 1 && dtComputeStats([optWin, optStop]).losses === 1);

// --- 6. stats -------------------------------------------------------------
const stats = dtComputeStats([wonLong, lostShort]);
ok("stats: decided counts both", stats.decided === 2);
ok("stats: one win one loss", stats.wins === 1 && stats.losses === 1);
ok("stats: 50% win rate", near(stats.winRate, 0.5, 0.001));
ok("stats: avg P/L = +1%", near(stats.avgPnlPct, 1, 0.001));
ok("stats: kind tallies", stats.swings === 1 && stats.scalps === 1);

// --- 7. trading-day clock -------------------------------------------------
ok("clock: Fri → Mon = 1 trading day", dtTradingDaysBetween("2024-01-05", "2024-01-08") === 1);
ok("clock: Mon → Thu = 3 trading days", dtTradingDaysBetween("2024-01-08", "2024-01-11") === 3);
ok("clock: same day = 0", dtTradingDaysBetween("2024-01-08", "2024-01-08") === 0);

// --- thesis + option idea (mirrors the Top Picks thesis discipline) --------
ok("thesis: candidate carries a structured thesis", candBull && candBull.thesis && Array.isArray(candBull.thesis.works) && Array.isArray(candBull.thesis.invalidators) && !!candBull.thesis.conviction);
ok("thesis: confirmed-break swing reads as a solid thesis", candBull && candBull.thesis.hasSolidThesis === true && candBull.thesis.disclosure == null);
ok("thesis: marketRead present w/ support verdict", candBull && candBull.thesis.marketRead && ["supports", "neutral", "against"].includes(candBull.thesis.marketRead.support));
ok("thesis: candidate carries an option idea", candBull && candBull.optionIdea && candBull.optionIdea.label && ["naked", "debit_spread"].includes(candBull.optionIdea.structure));
ok("thesis: long candidate's option idea is a call", candBull && candBull.optionIdea.side === "call");
ok("thesis: short candidate's option idea is a put", candBear && candBear.optionIdea && candBear.optionIdea.side === "put");
// thesis v2 — quality score, the edge, and the option-idea gate
ok("thesis: confirmed-break swing has a quality {score,tier,checklist}", candBull && candBull.thesis.quality && typeof candBull.thesis.quality.score === "number" && candBull.thesis.quality.tier === "strong" && Array.isArray(candBull.thesis.quality.checklist) && candBull.thesis.quality.checklist.length === 4);
ok("thesis: candidate carries an edge {hasEdge,text}", candBull && candBull.thesis.edge && candBull.thesis.edge.hasEdge === true && !!candBull.thesis.edge.text);
ok("thesis: companyDrivers empty (a day trade has no fundamentals)", candBull && Array.isArray(candBull.thesis.companyDrivers) && candBull.thesis.companyDrivers.length === 0);
// A weak (momentum-only, no confirmed break) read discloses + recommends NOTHING.
const weakTh = dtBuildThesis("long", "scalp", 1.4, null, 1.1, 1.5);
ok("thesis: momentum scalp w/o break is NOT solid (discloses)", weakTh.hasSolidThesis === false && !!weakTh.disclosure);
ok("thesis: that read grades a WEAK thesis tier with no edge", weakTh.quality.tier === "weak" && weakTh.edge.hasEdge === false);
ok("thesis: weak thesis → NO option idea (structure none)", dtBuildOptionIdea("long", "scalp", 1.1, null, "weak").structure === "none");
const modOpt = dtBuildOptionIdea("long", "scalp", 1.1, null, "moderate");
ok("thesis: a non-weak low-conviction idea is a defined-risk debit spread", modOpt.structure === "debit_spread");
const strongOpt = dtBuildOptionIdea("long", "swing", 2.4, { conviction: "High", type: "upper", level: 100 }, "strong");
ok("thesis: strong+confirmed option idea is a naked long", strongOpt.structure === "naked");

console.log(`\n${pass}/${pass + fail} checks passed.`);
process.exit(fail ? 1 : 0);
