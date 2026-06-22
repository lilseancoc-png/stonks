// Offline synthetic smoke test for the rebuilt Top Picks engine. No Yahoo, no
// data/, no AI — builds fake chains and asserts the engine's behaviour + the
// output shapes the UI/serialization depend on. Run: node scripts/picks-smoke.mjs
import {
  buildTopPicks, buildGradesIndex, pickContractForPick, computeEntryTiming,
  detectMarketRegime, computeMacroRegime, applyMacroRegimePersistence,
  resolvePickOutcome, gradeTradeCut, buildPicksChanges, buildPicksRoster,
  diffGradesHistory, appendGradesDaily, appendRegimeHistory, applyPickFirstSeen,
  PICKS_MIN_CONVICTION, PICKS_TIER_STRONG, PICKS_TIMING_THRESHOLDS, computeEdgeScale,
  buildDayTrades, pickContractForDay, resolveDayTradeOutcome,
} from "./build.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  ✗ " + name); } };

const dayMs = 86400000;
const nowSec = Math.floor(Date.now() / 1000);
const exp30 = (Math.floor((Date.now() + 32 * dayMs) / dayMs)) * 86400; // ~32 DTE, UTC midnight

// Build an option chain around spot with a delta-friendly strike ladder.
function mkChain(spot, ivCall = 0.4, ivPut = 0.42) {
  const c = [], p = [];
  for (let k = 0.80; k <= 1.20; k += 0.025) {
    const strike = Math.round(spot * k);
    const mid = Math.max(0.5, spot * 0.04 * (1.2 - Math.abs(1 - k)));
    c.push({ s: strike, b: mid * 0.98, a: mid * 1.02, l: mid, iv: ivCall, oi: 800, v: 200 });
    p.push({ s: strike, b: mid * 0.98, a: mid * 1.02, l: mid, iv: ivPut, oi: 800, v: 200 });
  }
  return { [String(exp30)]: { c, p } };
}

// Daily bars: `trend` is per-bar % drift; optional shock on the last CONFIRMED
// bar (index n-2; computeEntryTiming drops the in-progress last bar).
function mkBars(spot, n, trend, lastShockPct = 0) {
  const bars = [];
  let px = spot / (1 + trend * n);
  for (let i = 0; i < n; i++) {
    px = px * (1 + trend);
    const close = i === n - 2 && lastShockPct ? px * (1 + lastShockPct / 100) : px;
    bars.push({ c: close, h: close * 1.01, l: close * 0.99 });
  }
  return bars;
}

function mkTicker(over = {}) {
  const spot = over.spot ?? 100;
  return {
    spot,
    chains: over.chains ?? mkChain(spot),
    fundamentals: {
      sector: over.sector ?? "Software",
      trailingPE: 25, earningsGrowthYoy: 15, revenueGrowthYoy: 12,
      targetMeanPrice: spot * 1.15, numberOfAnalystOpinions: 12,
      analystRevisions: { upgrades: 3, downgrades: 0 },
      freeCashFlow: 1e9, netMarginHistory: [{ value: 18 }, { value: 19 }, { value: 20 }],
      fiftyTwoWeekHigh: spot * 1.4, fiftyTwoWeekLow: spot * 0.7,
      shortPercentOfFloat: 4, nextEarningsDate: new Date(Date.now() + 60 * dayMs).toISOString().slice(0, 10),
      growthEstimateCurY: 18,
      ...(over.fundamentals || {}),
    },
    technicals: {
      rsi: 58, rsi5d: 54, macd: { hist: 0.4, line: 1.0, signal: 0.6 },
      volume: { rvol: 1.4, priceMove1dPct: 0.8 },
      sr: { s20: spot * 0.95, r20: spot * 1.05, s50: spot * 0.9, r50: spot * 1.1, s100: spot * 0.85, r100: spot * 1.2 },
      sma: { sma20: spot * 0.99, sma50: spot * 0.95, sma100: spot * 0.9 },
      chartPattern: { pattern: "Bull Flag", stage: "confirmed" }, volRegime: { rv30Pctile: 40 },
      ...(over.technicals || {}),
    },
    news: { sentiment: over.sentiment ?? "bullish" },
    social: { msgCount24h: 50, bullishPct: 60, bearishPct: 20 },
    ivRank: { pctile: over.ivPctile ?? 45, n: 60 },
    _bars: over._bars ?? mkBars(spot, 40, 0.004),
    aiSignals: { guidance: { direction: "inline" }, majorContract: null },
    catalysts: [],
  };
}

// --- universe -------------------------------------------------------------
const chains = {
  BULLA: mkTicker({ spot: 120, sector: "Software" }),
  BULLB: mkTicker({ spot: 80, sector: "Semis" }),
  KNIFE: mkTicker({ spot: 50, sector: "Banks", _bars: mkBars(50, 40, 0.003, -8) }), // -8% last bar
  BEAR: mkTicker({ spot: 200, sector: "Energy", sentiment: "bearish",
    fundamentals: { earningsGrowthYoy: -30, revenueGrowthYoy: -22, analystRevisions: { upgrades: 0, downgrades: 4 }, targetMeanPrice: 170, numberOfAnalystOpinions: 10, sector: "Energy", nextEarningsDate: new Date(Date.now() + 60 * dayMs).toISOString().slice(0, 10) },
    technicals: { rsi: 38, rsi5d: 44, macd: { hist: -0.5, line: -1, signal: -0.4 }, volume: { rvol: 1.5, priceMove1dPct: -1.2 }, sr: { s20: 190, r20: 210, s100: 180, r100: 230 }, sma: { sma20: 210, sma50: 220, sma100: 230 }, chartPattern: { pattern: "Double Top", stage: "confirmed" }, volRegime: { rv30Pctile: 55 } },
    _bars: mkBars(200, 40, -0.003) }),
  MEH: mkTicker({ spot: 30, sector: "Pharma", sentiment: "neutral",
    fundamentals: { earningsGrowthYoy: 2, revenueGrowthYoy: 1, analystRevisions: {}, targetMeanPrice: 31, numberOfAnalystOpinions: 6, sector: "Pharma", nextEarningsDate: new Date(Date.now() + 60 * dayMs).toISOString().slice(0, 10), netMarginHistory: [{ value: 10 }, { value: 10 }] },
    technicals: { rsi: 50, rsi5d: 50, macd: { hist: 0, line: 0, signal: 0 }, volume: { rvol: 1.0 }, sr: {}, sma: { sma20: 30, sma50: 30, sma100: 30 }, chartPattern: null, volRegime: { rv30Pctile: 50 } } }),
  SPY: mkTicker({ spot: 500, sector: "ETF" }),
};

// --- 1. grades index ------------------------------------------------------
const grades = buildGradesIndex(chains, [], null, null, null, null, {});
ok("grades: every ticker graded", Object.keys(grades).length === Object.keys(chains).length);
ok("grades: BULLA is a call (positive total)", grades.BULLA.total > 0 && grades.BULLA.side === "call");
ok("grades: BEAR is a put (negative total)", grades.BEAR.total < 0 && grades.BEAR.side === "put");
ok("grades: pillars present w/ signals", grades.BULLA.pillars.fundamentals.signals.length > 0 && grades.BULLA.pillars.technicals.signals.length > 0);
ok("grades: timing pillar has state", !!grades.BULLA.pillars.timing.state);
ok("grades: ivCost pillar present", grades.BULLA.pillars.ivCost && grades.BULLA.pillars.ivCost.signals.length === 1);
ok("grades: recommendation tier/label", !!grades.BULLA.recommendation.tier && !!grades.BULLA.recommendation.label);
ok("grades: tierCutoffs stashed", grades.tierCutoffs && grades.tierCutoffs.tradeCut === PICKS_MIN_CONVICTION);
ok("grades: regimeBand stashed", grades.regimeBand === "neutral");
ok("grades: timing both-sides gate", grades.BULLA.timing && "call" in grades.BULLA.timing && "put" in grades.BULLA.timing);

// --- 1b. volume is factored in -------------------------------------------
const uvSig = (g) => g.pillars.mechanicals.signals.find((s) => s.key === "unusualVolume");
ok("volume: daily-rvol fallback fires the unusual-volume signal", uvSig(grades.BULLA) && uvSig(grades.BULLA).available && uvSig(grades.BULLA).score === 1);
ok("volume: daily 'Volume confirmation' signal in technicals fires", grades.BULLA.pillars.technicals.signals.find((s) => s.key === "volume")?.score === 1);
const vflags = { etDate: "2026-06-18", tickers: [{ symbol: "BULLA", bucketHits: [{ volRatio: 2.4, priceMovePct: 1.8, bucketLabel: "10-11am" }] }] };
const gradesVF = buildGradesIndex(chains, [], null, null, null, vflags, {});
const bvf = uvSig(gradesVF.BULLA);
ok("volume: hourly volume-flags read is attached + scored", bvf && bvf.available && bvf.score === 1 && /hrly/.test(bvf.value || ""));

// --- 2. entry timing ------------------------------------------------------
const knifeTiming = computeEntryTiming("call", chains.KNIFE, chains.KNIFE.spot, {});
ok("timing: -8% last bar -> avoid (falling knife)", knifeTiming.state === "avoid");
const goTiming = computeEntryTiming("call", chains.BULLA, chains.BULLA.spot, {});
ok("timing: clean uptrend -> go or neutral (not avoid)", goTiming.state !== "avoid");
const earnSoon = mkTicker({ spot: 100, fundamentals: { nextEarningsDate: new Date(Date.now() + 3 * dayMs).toISOString().slice(0, 10) } });
ok("timing: earnings in 3d -> wait", computeEntryTiming("call", earnSoon, 100, {}).state === "wait" && computeEntryTiming("call", earnSoon, 100, {}).deferKind === "earnings");

// --- 3. contract selection ------------------------------------------------
const ctr = pickContractForPick("call", chains.BULLA, 0.045, { requireClean: true });
ok("contract: found a clean call", !!ctr);
ok("contract: near-the-money delta 0.45-0.65", ctr && Math.abs(ctr.delta) >= 0.45 && Math.abs(ctr.delta) <= 0.65);
ok("contract: DTE within band", ctr && ctr.dte >= 14 && ctr.dte <= 60);
ok("contract: shape fields present", ctr && ctr.strike != null && ctr.expiryLabel && ctr.mid != null && ctr.breakeven != null && ctr.contractQuality && ctr.contractQuality.overall);
ok("contract: pop computed", ctr && ctr.pop != null && ctr.pop >= 0 && ctr.pop <= 1);

// --- 4. buildTopPicks -----------------------------------------------------
const picks = buildTopPicks(chains, [], null, null, null, null, 0.045, {});
ok("picks: returns an array", Array.isArray(picks));
ok("picks: rosterMeta attached", picks.rosterMeta && picks.rosterMeta.tradeCut === PICKS_MIN_CONVICTION);
ok("picks: KNIFE timing-gated (not shipped)", !picks.some((p) => p.symbol === "KNIFE") );
ok("picks: each pick has contract + sizing", picks.length === 0 || picks.every((p) => p.contract && p.sizing && p.sizing.weight != null));
ok("picks: each pick has pillars + recommendation + thesis", picks.every((p) => p.pillars && p.recommendation && p.analysis));
ok("picks: exitPlan TP/cut present", picks.every((p) => p.exitPlan && p.exitPlan.takeProfit && p.exitPlan.cut));
// entry guidance: every pick has a buy-now / wait-for-price signal
ok("picks: every pick has an entry signal w/ headline", picks.every((p) => p.entry && typeof p.entry.now === "boolean" && p.entry.headline));
ok("picks: a clean-timing (go) pick reads buy-now", picks.filter((p) => p.entryTiming.state === "go").every((p) => p.entry.now === true && p.entry.signal === "buy-now"));
// a below-trend call (spot under the 20D SMA) should wait for a reclaim, not buy now
const belowTrend = mkTicker({ spot: 100, technicals: { rsi: 52, rsi5d: 50, macd: { hist: 0.1, line: 0.2, signal: 0.1 }, volume: { rvol: 1.0, priceMove1dPct: -0.5 }, sr: { s20: 95, r20: 108 }, sma: { sma20: 106, sma50: 104, sma100: 100 }, chartPattern: null, volRegime: { rv30Pctile: 45 } } });
const bg = buildGradesIndex({ X: belowTrend }, [], null, null, null, null, {});
const es = computeEntrySmoke();
ok("entry: below-20D call waits for a reclaim trigger (not buy-now)", es && es.now === false && es.signal === "wait-reclaim" && es.trigger > 100);
function computeEntrySmoke(){
  // drive the engine directly via a single-name pick build
  const pk = buildTopPicks({ X: belowTrend }, [], null, null, null, null, 0.045, {});
  const p = pk.find((x) => x.symbol === "X");
  return p ? p.entry : null;
}
ok("picks: book risk in rosterMeta", picks.rosterMeta.book && picks.rosterMeta.book.account > 0);
ok("picks: deployed gross <= target", picks.rosterMeta.deployedGross <= 0.81);

// sector cap: 4 software names, only <=3 should ship
const manySoftware = {};
for (let i = 0; i < 6; i++) manySoftware["SW" + i] = mkTicker({ spot: 100 + i, sector: "Software" });
const swPicks = buildTopPicks(manySoftware, [], null, null, null, null, 0.045, {});
const swShipped = swPicks.filter((p) => (p.sector === "Software")).length;
ok("picks: sector cap <= 3 (Tech factor cap may make it fewer)", swShipped <= 3);

// re-entry suppression
const withOpen = buildTopPicks(chains, [], null, null, null, null, 0.045, { openPositions: [{ symbol: "BULLA", side: "call" }] });
ok("picks: re-entry suppressed (BULLA has open position)", !withOpen.some((p) => p.symbol === "BULLA"));

// --- 5. regime tilt -------------------------------------------------------
const riskOff = { vix: { value: 26, trend: "rising" }, dxy: { pctChange1d: 0.8 }, tenY: { bpsChange1d: 12 } };
riskOff.macroRegime = computeMacroRegime(riskOff, null, [], { value: 18 });
ok("regime: 3 risk-off axes -> risk-off/severe", ["risk-off", "severe-risk-off"].includes(riskOff.macroRegime.state));
ok("regime: detectMarketRegime maps to risk-off", detectMarketRegime({}, riskOff) === "risk-off");
const picksOff = buildTopPicks(chains, [], null, null, riskOff, null, 0.045, {});
const putShareOff = picksOff.length ? picksOff.filter((p) => p.side === "put").length / picksOff.length : 0;
const putShareNeutral = picks.length ? picks.filter((p) => p.side === "put").length / picks.length : 0;
ok("regime: risk-off tilts the book more bearish (put share up or equal)", putShareOff >= putShareNeutral);
ok("regime: risk-off de-grosses", picksOff.length === 0 || picksOff.rosterMeta.deployedGross <= picks.rosterMeta.deployedGross + 1e-9);
// persistence
const persisted = applyMacroRegimePersistence(computeMacroRegime({ vix: { value: 13, trend: "flat" } }, null, []), { state: "severe-risk-off" });
ok("regime: persistence holds a recovering state one build", persisted.persisted === true);

// --- 6. resolvePickOutcome ------------------------------------------------
ok("exit: -35% option -> hit-stop loss", resolvePickOutcome({ modeledOptPnlPct: -35, entrySec: nowSec - dayMs / 1000, nowSec }).outcome === "loss");
ok("exit: +25% option -> hit-tp win", resolvePickOutcome({ modeledOptPnlPct: 25, entrySec: nowSec - dayMs / 1000, nowSec }).outcome === "win");
ok("exit: +5% still open -> null", resolvePickOutcome({ modeledOptPnlPct: 5, entrySec: nowSec - 2 * 86400, nowSec }) === null);
ok("exit: 14d timeout, underwater -> loss", resolvePickOutcome({ modeledOptPnlPct: -5, entrySec: nowSec - 15 * 86400, nowSec }).outcome === "loss");

// --- 7. history / churn / roster builders (no runtime errors + shapes) -----
const gh = diffGradesHistory({ latest: {}, changes: [] }, grades, new Date().toISOString());
ok("history: diffGradesHistory returns latest+changes", gh.latest && Array.isArray(gh.changes));
const changes = buildPicksChanges({}, grades, new Date().toISOString(), null);
ok("churn: buildPicksChanges returns events array", Array.isArray(changes));
const roster = buildPicksRoster(picks, [], {}, grades, new Date().toISOString(), false);
ok("roster: buildPicksRoster shape", roster.roster && Array.isArray(roster.roster) && Array.isArray(roster.exited));
const gd = appendGradesDaily({ days: [] }, grades, new Date().toISOString());
ok("daily: appendGradesDaily upserts a day", gd.days.length === 1 && gd.days[0].totals.BULLA != null);
const rh = appendRegimeHistory({ days: [] }, riskOff.macroRegime, "put", new Date().toISOString());
ok("regime-history: appendRegimeHistory upserts a day", rh.days.length === 1 && rh.days[0].state);
applyPickFirstSeen(picks, [], new Date().toISOString());
ok("tenure: applyPickFirstSeen stamps firstSeen", picks.length === 0 || picks.every((p) => p.firstSeen));
ok("edge: computeEdgeScale handles empty/negative", computeEedge());
function computeEedge() { return computeEdgeScale(null) === 1 && computeEdgeScale([{ outcome: "loss", optionPnlPct: -40 }, { outcome: "loss", optionPnlPct: -40 }]) < 1; }

// --- 8. day trades (0DTE / short-term engine) -----------------------------
// A near-expiry chain (~1 DTE) so the day engine has a tradeable nearest contract;
// the 32-DTE smoke chains above are out of the 0-5 DTE window by design.
const exp1 = (Math.floor((Date.now() + 1 * dayMs) / dayMs)) * 86400;
function mkNearChain(spot, ivCall = 0.5, ivPut = 0.52) {
  const c = [], p = [];
  for (let k = 0.90; k <= 1.10; k += 0.01) {
    const strike = Math.round(spot * k);
    const mid = Math.max(0.3, spot * 0.02 * (1.2 - Math.abs(1 - k)));
    c.push({ s: strike, b: mid * 0.97, a: mid * 1.03, l: mid, iv: ivCall, oi: 600, v: 400 });
    p.push({ s: strike, b: mid * 0.97, a: mid * 1.03, l: mid, iv: ivPut, oi: 600, v: 400 });
  }
  return { [String(exp1)]: { c, p } };
}
const dayUniverse = {
  DBULL: mkTicker({ spot: 120, sector: "Software", chains: mkNearChain(120) }),
  DBEAR: mkTicker({ spot: 200, sector: "Energy", sentiment: "bearish", chains: mkNearChain(200),
    fundamentals: { earningsGrowthYoy: -30, revenueGrowthYoy: -22, analystRevisions: { upgrades: 0, downgrades: 4 }, targetMeanPrice: 170, numberOfAnalystOpinions: 10, sector: "Energy", nextEarningsDate: new Date(Date.now() + 60 * dayMs).toISOString().slice(0, 10) },
    technicals: { rsi: 38, rsi5d: 44, macd: { hist: -0.5, line: -1, signal: -0.4 }, volume: { rvol: 1.5, priceMove1dPct: -1.2 }, sr: { s20: 190, r20: 210, s100: 180, r100: 230 }, sma: { sma20: 210, sma50: 220, sma100: 230 }, chartPattern: { pattern: "Double Top", stage: "confirmed" }, volRegime: { rv30Pctile: 55 } },
    _bars: mkBars(200, 40, -0.003) }),
  DFAR: mkTicker({ spot: 90, sector: "Pharma" }), // only the 32-DTE chain -> no day contract
};
const dctr = pickContractForDay("call", dayUniverse.DBULL, 0.045);
ok("day-contract: found a nearest-expiry call", !!dctr);
ok("day-contract: DTE within 0-5 window", dctr && dctr.dte >= 0 && dctr.dte <= 5);
ok("day-contract: delta in day band 0.35-0.72", dctr && Math.abs(dctr.delta) >= 0.35 && Math.abs(dctr.delta) <= 0.72);
ok("day-contract: shape fields present", dctr && dctr.strike != null && dctr.expiryLabel && dctr.mid != null && dctr.contractQuality && dctr.contractQuality.overall);
ok("day-contract: 32-DTE-only name yields no day contract", pickContractForDay("call", dayUniverse.DFAR, 0.045) === null);

const dayPicks = buildDayTrades(dayUniverse, [], null, null, null, null, 0.045);
ok("day-trades: returns an array w/ rosterMeta", Array.isArray(dayPicks) && dayPicks.rosterMeta && dayPicks.rosterMeta.horizon === "0dte");
ok("day-trades: DBULL ships a call", dayPicks.some((p) => p.symbol === "DBULL" && p.side === "call"));
ok("day-trades: DBEAR ships a put", dayPicks.some((p) => p.symbol === "DBEAR" && p.side === "put"));
ok("day-trades: DFAR (no near contract) excluded", !dayPicks.some((p) => p.symbol === "DFAR"));
ok("day-trades: pick shape matches Top Picks (pillars/contract/exitPlan)", dayPicks.every((p) => p.pillars && p.contract && p.exitPlan && Array.isArray(p.exitPlan.triggers)));
ok("day-trades: exit plan carries the close-before-bell time stop", dayPicks.every((p) => p.exitPlan.triggers.some((t) => /before the bell/i.test(t))));

// Day-trades win-rate resolution — the calculated +30% TP / −40% stop govern.
ok("day-outcome: +30% take-profit -> win", resolveDayTradeOutcome({ modeledOptPnlPct: 32, entrySec: nowSec - 3600, nowSec }).outcome === "win" && resolveDayTradeOutcome({ modeledOptPnlPct: 32, entrySec: nowSec - 3600, nowSec }).status === "hit-tp-prem");
ok("day-outcome: −40% stop -> loss", resolveDayTradeOutcome({ modeledOptPnlPct: -42, entrySec: nowSec - 3600, nowSec }).outcome === "loss" && resolveDayTradeOutcome({ modeledOptPnlPct: -42, entrySec: nowSec - 3600, nowSec }).status === "hit-stop-prem");
ok("day-outcome: +10% intraday still open (no gate hit, <1 session)", resolveDayTradeOutcome({ modeledOptPnlPct: 10, entrySec: nowSec - 3600, nowSec }) === null);
ok("day-outcome: 1-session backstop, up -> win", resolveDayTradeOutcome({ modeledOptPnlPct: 8, entrySec: nowSec - 2 * 86400, nowSec }).outcome === "win" && resolveDayTradeOutcome({ modeledOptPnlPct: 8, entrySec: nowSec - 2 * 86400, nowSec }).status === "timed-out");
ok("day-outcome: dropped from universe resolves by sign", resolveDayTradeOutcome({ inUniverse: false, modeledOptPnlPct: -5 }).outcome === "loss");

console.log(`\n${pass}/${pass + fail} checks passed.`);
process.exit(fail ? 1 : 0);
