// Smoke test for the 2026-11-22 flagship review changes: the hold exit, the
// shadow exit, the soft-wait lift, the put skew against the market, the
// losing-streak brake on the newest closes, the AI-vs-rules stamp and the
// hold column in the self-loop ledger. Offline, no network.
//   node scripts/top-picks-review-smoke.mjs
process.env.PICKS_CALL_HOLD = "1";
process.env.PICKS_SOFT_WAITS = "1";
process.env.PICKS_SKEW_RELATIVE = "1";

const B = await import("./build.mjs");
const X = await import("../lib/top-picks-exit-review.mjs");
const L = await import("../lib/self-loop/ledger.mjs");
const SC = await import("../lib/self-loop/scorecard.mjs");

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL " + name); } };

// ---- Hold exit policy ----
const hold = B.pickExitPolicy("long", "call");
ok("hold policy for a new single call", hold.style === "hold" && hold.holdSessions === 10 && hold.stopPct === 60 && hold.takeProfitPct === null);
ok("puts keep today's exits", B.pickExitPolicy("long", "put").style == null && B.pickExitPolicy("long", "put").takeProfitPct === 25);
ok("call spreads keep today's exits", B.pickExitPolicy("debit_vertical", "call").style == null);
ok("no side = today's exits (old trades)", B.pickExitPolicy("long").style == null);

const nowSec = Math.floor(Date.parse("2026-11-20T16:00:00Z") / 1000);
const base = { isCall: true, cur: 100, ref: 100, expSec: nowSec + 40 * 86400, entrySec: nowSec - 5 * 86400, nowSec, inUniverse: true, structure: "long", thetaPctDay: 0.05 };
const R = (o) => B.resolvePickOutcome({ ...base, ...o });
ok("hold: +40% does not take profit", R({ exitPolicy: hold, modeledOptPnlPct: 40, heldSessions: 3 }) === null);
ok("today: +40% takes profit", R({ exitPolicy: B.pickExitPolicy("long"), modeledOptPnlPct: 40 })?.status === "hit-tp-prem");
ok("hold: -55% holds", R({ exitPolicy: hold, modeledOptPnlPct: -55, heldSessions: 3 }) === null);
ok("hold: -61% stops", R({ exitPolicy: hold, modeledOptPnlPct: -61, heldSessions: 3 })?.status === "hit-stop-prem");
ok("hold: stock stop ignored", R({ exitPolicy: hold, modeledOptPnlPct: -10, stopUnder: 105, heldSessions: 3 }) === null);
ok("today: stock stop fires", R({ exitPolicy: B.pickExitPolicy("long"), modeledOptPnlPct: -10, stopUnder: 105 })?.status === "hit-stop-under");
ok("hold: closes at 10 sessions", R({ exitPolicy: hold, modeledOptPnlPct: 12, heldSessions: 10 })?.status === "time-limit");
ok("hold: 9 sessions still open", R({ exitPolicy: hold, modeledOptPnlPct: 12, heldSessions: 9 }) === null);
ok("hold: drivers-quiet thesis does not close", R({ exitPolicy: hold, modeledOptPnlPct: -5, heldSessions: 4, thesisBroken: true, thesisFlip: false }) === null);
ok("hold: grade flip closes", R({ exitPolicy: hold, modeledOptPnlPct: -5, heldSessions: 4, thesisBroken: true, thesisFlip: true })?.status === "thesis-broken");
ok("hold: no theta stop", R({ exitPolicy: hold, modeledOptPnlPct: -20, heldSessions: 8, entrySec: nowSec - 12 * 86400, thetaPctDay: 0.2 }) === null);
ok("hold: expiry still closes", R({ exitPolicy: hold, modeledOptPnlPct: -20, heldSessions: 2, expSec: nowSec - 86400 })?.status === "expired");

// ---- Shadow exit ----
const todayPol = { version: "2026-10-22-tp25", takeProfitPct: 25, stopPct: 50 };
ok("today trade shadows hold", X.shadowPolicyFor({ contract: { structure: "long" }, exitPolicy: todayPol }, todayPol, hold)?.style === "hold");
ok("hold trade shadows today", X.shadowPolicyFor({ contract: { structure: "long" }, exitPolicy: hold }, todayPol, hold) === todayPol);
ok("spreads not shadowed", X.shadowPolicyFor({ contract: { structure: "debit_vertical" } }, todayPol, hold) === null);
let sh = X.stepShadow(null, { policy: hold, res: null, pnlPct: 30, sessions: 2, builtAtIso: "2026-11-20T16:00:00Z" });
ok("shadow open step", sh.closed === false && sh.lastPnlPct === 30 && sh.hiPct === 30 && sh.style === "hold");
sh = X.stepShadow(sh, { policy: hold, res: { status: "time-limit" }, pnlPct: 45, sessions: 10, builtAtIso: "2026-11-27T16:00:00Z" });
ok("shadow closes", sh.closed && sh.status === "time-limit" && sh.pnlPct === 45 && sh.hiPct === 45);
ok("closed shadow is frozen", X.stepShadow(sh, { policy: hold, res: null, pnlPct: -90, sessions: 11 }) === sh);
const closedRow = { symbol: "AAA", side: "call", entryDate: "2026-11-13T16:00:00Z", optionPnlPct: 25, outcome: "win", shadowExit: { closed: false, style: "hold" } };
const carried = { ...X.shadowCarry({ ...closedRow, contract: { structure: "long", strike: 100 } }), shadowExit: sh };
const still = X.settleShadows([carried], [[closedRow], []]);
ok("settled shadow written onto the closed trade", still.length === 0 && closedRow.shadowExit.closed && closedRow.shadowExit.pnlPct === 45);
const stats = X.shadowExitStats([closedRow, { ...closedRow, symbol: "BBB", optionPnlPct: -50, outcome: "loss", shadowExit: { closed: true, style: "hold", pnlPct: -60 } }]);
ok("shadow stats", stats.holdShadow.all.n === 2 && stats.holdShadow.all.diff === 5 && stats.holdShadow.call.n === 2);

// ---- Soft waits ----
const softTiming = { score: -0.5, readiness: { independentFamilies: 1, directionConfirmed: false, structureOk: true, payoffOk: true, crowdedProof: true, countertrendProof: true }, structure: { clear: true } };
ok("soft-only wait blocked today", B.entryPromotionBlocked({ basis: "extended", signal: "wait-pullback" }, softTiming) === true);
ok("soft-only wait is not a hard block", B.entryHardBlocked({ basis: "extended", signal: "wait-pullback" }, softTiming) === false);
ok("gate lifts it with the switch", B.entryGateBlocked({ signal: "wait-pullback" }, softTiming, true) === false && B.entryGateBlocked({ signal: "wait-pullback" }, softTiming, false) === true);
ok("top guard stays hard", B.entryHardBlocked({ basis: "top-guard" }, softTiming) === true);
ok("event defer stays hard", B.entryHardBlocked({ signal: "wait-event" }, softTiming) === true);
ok("reclaim stays hard", B.entryHardBlocked({ signal: "wait-reclaim" }, softTiming) === true);
ok("hard veto stays hard", B.entryHardBlocked({}, { ...softTiming, hardVeto: "knife" }) === true);
ok("unclear stop stays hard", B.entryHardBlocked({}, { ...softTiming, structure: { clear: false } }) === true);
ok("weak payoff stays hard", B.entryHardBlocked({}, { ...softTiming, readiness: { ...softTiming.readiness, payoffOk: false } }) === true);

// ---- Losing-streak brake on the newest closes ----
const closes = [];
for (let i = 0; i < 15; i++) closes.push({ symbol: "S" + i, side: "call", outcome: "loss", status: "hit-stop-prem", optionPnlPct: -50, exitPolicy: { takeProfitPct: 25, stopPct: 50 }, exitDate: new Date(Date.parse("2026-09-01T20:00:00Z") + i * 86400000).toISOString() });
const now = "2026-11-20T16:00:00Z";
ok("day window: old closes do not count", B.edgeGateWindow(closes, now, 0).length === 0);
ok("last 12: newest 12 decided closes", B.edgeGateWindow(closes, now, 12).length === 12 && B.edgeGateWindow(closes, now, 12)[0].symbol === "S14");
const eg = B.edgeGatedConviction(closes, now, { lastN: 12 });
ok("brake engages on 12 losing closes", eg.n === 12 && eg.bar > 4 && eg.windowDays === null);
ok("brake idle on the day window", B.edgeGatedConviction(closes, now, { lastN: 0 }).bar === 4);

// ---- Put skew against the market ----
const mkR = (skewZ) => ({ sym: "XYZ", total: -8, data: { spot: 100, ivRank: { pctile: 50, z: 0, n: 200 }, ivSurface: { skewZ, skew25: 0.08 }, technicals: { volRegime: { rv30: 0.3 } } } });
const sAbs = B.selectStrategy(mkR(2.0), "put", { thesisTier: "strong", marketSkewZ: null });
const sRel = B.selectStrategy(mkR(2.0), "put", { thesisTier: "strong", marketSkewZ: 1.8 });
const sRelHi = B.selectStrategy(mkR(3.5), "put", { thesisTier: "strong", marketSkewZ: 1.8 });
ok("no SPY read: absolute skew test", sAbs.adverseSkew === true && sAbs.skewBasis === "history-z");
ok("put skew like SPY's is not adverse", sRel.adverseSkew === false && sRel.type === "long");
ok("put skew well above SPY's is adverse", sRelHi.adverseSkew === true && sRelHi.skewBasis === "vs-market-z" && /SPY/.test(sRelHi.reason));
ok("calls keep the absolute test", B.selectStrategy({ ...mkR(-2.0), total: 8 }, "call", { thesisTier: "strong", marketSkewZ: -1.9 }).adverseSkew === true);

// ---- Ledger hold column + AI vs rules ----
const keys = L.LEDGER_KEYS;
ok("ledger keys gained rl and oh", keys.includes("rl") && keys.includes("oh"));
const closesUp = [];
for (let i = 1; i <= 12; i++) closesUp.push({ t: `2026-10-${String(i + 1).padStart(2, "0")}`, c: 100 + i * 1.5 });
const exp = Math.floor(Date.parse("2026-12-18T21:00:00Z") / 1000);
const today = L.simulateOption({ side: "call", opt: [100, exp, 4, 0.4], closes: closesUp, spot0: 100, d0: "2026-10-01" });
const held = L.simulateOption({ side: "call", opt: [100, exp, 4, 0.4], closes: closesUp, spot0: 100, d0: "2026-10-01", maxSessions: L.OPTION_HOLD_SESSIONS, tp: Infinity, stop: L.OPTION_HOLD_STOP });
ok("today exit takes the first +25%", today && today[0] === "tp");
ok("hold exit rides 10 sessions", held && held[0] === "t20" && held[2] === 10 && held[1] > today[1]);
const rows = [
  { side: "call", opt: { net: 20 }, optHold: { net: 40 }, rl: "soft-wait", ev: "buy-now", y10: 1 },
  { side: "call", opt: { net: -50 }, optHold: { net: -60 }, rl: "buy-now", ev: "wait", y10: -1 },
];
const xc = SC.exitCompare(rows);
ok("exit compare", xc.all.n === 2 && xc.all.diff === 5 && xc.call.n === 2 && xc.put.n === 0);
const avr = SC.aiVsRules(rows);
ok("ai vs rules split", avr.length === 2 && avr.some((g) => g.key === "ai buy-now / rules soft-wait"));

console.log(`${pass}/${pass + fail} checks passed.`);
if (fail) process.exit(1);
