// Offline synthetic smoke test for the rebuilt Top Picks engine. No Yahoo, no
// data/, no AI — builds fake chains and asserts the engine's behaviour + the
// output shapes the UI/serialization depend on. Run: node scripts/picks-smoke.mjs
import {
  buildTopPicks, buildGradesIndex, pickContractForPick, pickVerticalForPick, markOptionToMarket, computeEntryTiming,
  detectMarketRegime, computeMacroRegime, applyMacroRegimePersistence,
  resolvePickOutcome, gradeTradeCut, buildPicksChanges, buildPicksRoster,
  diffGradesHistory, appendGradesDaily, appendRegimeHistory, applyPickFirstSeen,
  PICKS_MIN_CONVICTION, PICKS_TIER_STRONG, PICKS_TIMING_THRESHOLDS, computeEdgeScale,
  computeFactorTrendHealth, edgeGatedConviction,
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
// every pick exposes a concrete CONTRACT stop-loss price (and take-profit price)
// off the entry mid, plus the structured optionStop/optionTp summary
ok("picks: exitPlan cut carries an option (contract) stop price", picks.every((p) => p.exitPlan.cut.optionPrice != null && isFinite(p.exitPlan.cut.optionPrice) && p.exitPlan.cut.optionPrice > 0));
ok("picks: exitPlan TP carries an option (contract) target price", picks.every((p) => p.exitPlan.takeProfit.optionPrice != null && isFinite(p.exitPlan.takeProfit.optionPrice) && p.exitPlan.takeProfit.optionPrice > 0));
ok("picks: exitPlan optionStop summary present", picks.every((p) => p.exitPlan.optionStop && p.exitPlan.optionStop.price > 0 && p.exitPlan.optionStop.pct > 0));
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

// --- 4c. factor-trend gate (the real-loss lesson: don't pile long calls into a -----
// correlated factor that's rolling over while the broad tape barely moves) --------
// Direct unit: a Tech/AI factor mostly below its 20D SMA with a falling median 5d
// return is flagged weak; an above-20D, rising one is not; too few members can't judge.
const facRow = (sym, sma20, trend) => ({ sym, data: { spot: 100, technicals: { sma: { sma20 } }, _bars: mkBars(100, 40, trend) } });
const weakTech = ["NVDA", "AVGO", "AMD", "AMAT"].map((s) => facRow(s, 106, -0.01));   // below 20D, ~-5% 5d
const fhWeak = computeFactorTrendHealth(weakTech);
ok("factor-trend: broadly-below-20D, falling Tech/AI factor flagged weak", fhWeak["Tech/AI growth"]?.weak === true && fhWeak["Tech/AI growth"].members === 4);
const healthyTech = ["NVDA", "AVGO", "AMD", "AMAT"].map((s) => facRow(s, 94, 0.008));   // above 20D, rising
ok("factor-trend: above-20D, rising Tech/AI factor NOT weak", computeFactorTrendHealth(healthyTech)["Tech/AI growth"]?.weak === false);
ok("factor-trend: < min members -> not weak (insufficient breadth)", computeFactorTrendHealth(["NVDA", "AVGO"].map((s) => facRow(s, 106, -0.01)))["Tech/AI growth"]?.weak === false);

// Roster: a universe of actionable bullish Tech/AI CALLS whose factor is rolling
// over should have its non-strong/non-go calls factor-trend-gated, while the SAME
// names in a healthy factor are not — and a non-factor (Pharma) call is never gated.
function mkWeakTechCall(sym) {
  return mkTicker({
    spot: 100, sector: SECTORS_FOR_SYM(sym),
    // strong fundamentals keep the grade an actionable CALL despite the soft trend
    fundamentals: { earningsGrowthYoy: 35, revenueGrowthYoy: 28, targetMeanPrice: 122, numberOfAnalystOpinions: 14, analystRevisions: { upgrades: 5, downgrades: 0 }, nextEarningsDate: new Date(Date.now() + 60 * dayMs).toISOString().slice(0, 10) },
    // soft, below-20D trend (a -4% 5d slide) — weak enough to roll the factor, not a knife
    technicals: { rsi: 48, rsi5d: 50, macd: { hist: -0.1, line: 0.1, signal: 0.2 }, volume: { rvol: 1.0, priceMove1dPct: -0.6 }, sr: { s20: 96, r20: 110, s50: 92, r50: 115 }, sma: { sma20: 103, sma50: 99, sma100: 95 }, chartPattern: null, volRegime: { rv30Pctile: 45 } },
    _bars: mkBars(100, 40, -0.008),
  });
}
// SECTORS isn't re-exported here; map our synthetic symbols to Tech/AI sectors by hand.
function SECTORS_FOR_SYM(sym) { return ({ NVDA: "Mega-cap tech", AVGO: "Semis", AMD: "Semis", AMAT: "Semis" })[sym] || "Software"; }
const weakUniverse = { NVDA: mkWeakTechCall("NVDA"), AVGO: mkWeakTechCall("AVGO"), AMD: mkWeakTechCall("AMD"), AMAT: mkWeakTechCall("AMAT"), MEHP: mkTicker({ spot: 40, sector: "Pharma" }) };
const weakPicks = buildTopPicks(weakUniverse, [], null, null, null, null, 0.045, {});
ok("factor-trend: rosterMeta ships the factor-health snapshot", weakPicks.rosterMeta.factorTrend && weakPicks.rosterMeta.factorTrend["Tech/AI growth"]?.weak === true);
ok("factor-trend: weak-factor calls are gated (some suppressed)", weakPicks.rosterMeta.factorTrendGated.length >= 1);
ok("factor-trend: no gated name also shipped", weakPicks.every((p) => !weakPicks.rosterMeta.factorTrendGated.includes(p.symbol)));
ok("factor-trend: any shipped Tech/AI call is strong-tier + go-timed (reprieve only)", weakPicks.filter((p) => p.side === "call" && FACTOR_TECH(p.symbol)).every((p) => Math.abs(p.total) >= PICKS_TIER_STRONG && p.entryTiming.state === "go"));
function FACTOR_TECH(sym) { return ["NVDA", "AVGO", "AMD", "AMAT"].includes(sym); }
// control: the identical names in a HEALTHY (rising, above-20D) factor are not gated
function mkHealthyTechCall(sym) {
  const t = mkWeakTechCall(sym);
  t.technicals.sma = { sma20: 97, sma50: 93, sma100: 90 };
  t.technicals.rsi = 58; t.technicals.macd = { hist: 0.4, line: 1.0, signal: 0.6 };
  t._bars = mkBars(100, 40, 0.006);
  return t;
}
const healthyUniverse = { NVDA: mkHealthyTechCall("NVDA"), AVGO: mkHealthyTechCall("AVGO"), AMD: mkHealthyTechCall("AMD"), AMAT: mkHealthyTechCall("AMAT") };
const healthyPicks = buildTopPicks(healthyUniverse, [], null, null, null, null, 0.045, {});
ok("factor-trend: a healthy factor gates nothing", healthyPicks.rosterMeta.factorTrend["Tech/AI growth"]?.weak === false && healthyPicks.rosterMeta.factorTrendGated.length === 0);
ok("factor-trend: a healthy factor ships more calls than the weak one", healthyPicks.length >= weakPicks.filter((p) => FACTOR_TECH(p.symbol)).length);

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
// Edge-governed selection bar: no/insufficient/positive history keeps the base
// bar; a materially negative realized edge (the live ~33%-win-rate state) stands
// the bar up so the roster ships only higher-conviction names.
const mkClosed = (n, pnl) => Array.from({ length: n }, () => ({ outcome: pnl >= 0 ? "win" : "loss", optionPnlPct: pnl }));
ok("edge gate: null / too-few-decided keep base bar",
  edgeGatedConviction(null).bar === PICKS_MIN_CONVICTION && edgeGatedConviction(mkClosed(5, -30)).bar === PICKS_MIN_CONVICTION);
ok("edge gate: positive edge keeps base bar", edgeGatedConviction(mkClosed(20, 12)).bar === PICKS_MIN_CONVICTION);
ok("edge gate: realistic 33% WR (edge≈−13%) raises the bar",
  edgeGatedConviction([...mkClosed(8, 20), ...mkClosed(16, -30)]).bar > PICKS_MIN_CONVICTION);
ok("edge gate: deeply negative edge stands down to Strong", edgeGatedConviction(mkClosed(20, -20)).bar === PICKS_TIER_STRONG);
// The gate flows through buildTopPicks via opts.priorClosed and is surfaced in meta.
const gatedPicks = buildTopPicks(chains, [], null, null, null, null, 0.045, { priorClosed: mkClosed(20, -20) });
ok("edge gate: buildTopPicks raises rosterMeta.tradeCut on a losing book",
  gatedPicks.rosterMeta.tradeCut === PICKS_TIER_STRONG && gatedPicks.rosterMeta.edgeGate && gatedPicks.rosterMeta.edgeGate.bar === PICKS_TIER_STRONG);

// --- 12. strategy selection + thesis enrichment + verticals ----------------
ok("strategy: every pick carries a strategy {type}", picks.length === 0 || picks.every((p) => p.strategy && ["long", "debit", "credit"].includes(p.strategy.type)));
ok("strategy: contract structure is a known kind", picks.every((p) => ["long", "debit_vertical", "credit_vertical"].includes(p.contract.structure)));
ok("thesis: thesisCard has marketRead/conviction/hasSolidThesis", picks.every((p) => p.thesisCard && p.thesisCard.marketRead && typeof p.thesisCard.hasSolidThesis === "boolean" && !!p.thesisCard.conviction));
ok("thesis: marketRead.support is a known verdict", picks.every((p) => ["supports", "against", "neutral"].includes(p.thesisCard.marketRead.support)));
ok("thesis: thesisCard.strategy mirrors the pick strategy", picks.every((p) => p.thesisCard.strategy && p.thesisCard.strategy.type === p.strategy.type));
ok("thesis: works + invalidators present", picks.every((p) => Array.isArray(p.thesisCard.works) && Array.isArray(p.thesisCard.invalidators) && p.thesisCard.invalidators.length > 0));

// Vertical builder — needs a BS-priced chain (the linear mkChain mids give a flat
// ~4% credit fraction that never clears the 1/3-width floor; fine for debit).
function bsNcdf(x) { return (1 + bsErf(x / Math.SQRT2)) / 2; }
function bsErf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
function bsPx(type, S, K, T, iv, r) { const d1 = (Math.log(S / K) + (r + iv * iv / 2) * T) / (iv * Math.sqrt(T)); const d2 = d1 - iv * Math.sqrt(T); return type === "call" ? S * bsNcdf(d1) - K * Math.exp(-r * T) * bsNcdf(d2) : K * Math.exp(-r * T) * bsNcdf(-d2) - S * bsNcdf(-d1); }
function mkBsChain(spot, iv = 0.6) {
  const T = (exp30 - nowSec) / (365 * 86400);
  const c = [], p = [];
  for (let k = 0.6; k <= 1.4; k += 0.025) { const K = Math.round(spot * k); for (const [arr, type] of [[c, "call"], [p, "put"]]) { const mid = Math.max(0.05, bsPx(type, spot, K, T, iv, 0.045)); arr.push({ s: K, b: +(mid * 0.98).toFixed(2), a: +(mid * 1.02).toFixed(2), l: +mid.toFixed(2), iv, oi: 800, v: 200 }); } }
  return { [String(exp30)]: { c, p } };
}
const bsData = { spot: 100, chains: mkBsChain(100, 0.6), fundamentals: {} };
const dbt = pickVerticalForPick("call", bsData, 0.045, { type: "debit" });
ok("vertical: debit spread builds", !!dbt && dbt.structure === "debit_vertical");
ok("vertical: debit has 2 legs (+1 long / -1 short)", dbt && Array.isArray(dbt.legs) && dbt.legs.length === 2 && dbt.legs.some((l) => l.qty === 1) && dbt.legs.some((l) => l.qty === -1));
ok("vertical: debit economics consistent (maxLoss+maxProfit≈width)", dbt && dbt.maxLoss > 0 && dbt.maxProfit > 0 && Math.abs((dbt.maxLoss + dbt.maxProfit) - dbt.width) < 0.06 && dbt.mid > 0);
ok("vertical: debit long strike < short (bull call)", dbt && dbt.longStrike < dbt.shortStrike);
ok("vertical: debit net delta positive (bullish)", dbt && dbt.delta > 0);
const crd = pickVerticalForPick("call", bsData, 0.045, { type: "credit" });
ok("vertical: credit spread builds as bull-put (puts)", !!crd && crd.structure === "credit_vertical" && crd.optionType === "put");
ok("vertical: credit maxProfit≈credit, maxLoss+maxProfit≈width", crd && Math.abs(crd.maxProfit - crd.mid) < 0.06 && Math.abs((crd.maxLoss + crd.maxProfit) - crd.width) < 0.06);
ok("vertical: credit short strike > long (bull put)", crd && crd.shortStrike > crd.longStrike);
ok("vertical: credit fraction near the 1/3 target (>=floor)", crd && crd.creditFrac >= 0.22);
ok("vertical: credit net delta positive (bullish)", crd && crd.delta > 0);
const crdBear = pickVerticalForPick("put", bsData, 0.045, { type: "credit" });
ok("vertical: bearish credit builds as bear-call (calls)", !!crdBear && crdBear.optionType === "call" && crdBear.delta < 0);

// Structure-aware exit resolution (credit spreads decay → different gates).
ok("exit: credit +55% -> win (TP at 50%)", resolvePickOutcome({ modeledOptPnlPct: 55, structure: "credit_vertical", entrySec: nowSec - 2 * 86400, nowSec }).outcome === "win");
ok("exit: credit +25% -> still open (below 50% TP)", resolvePickOutcome({ modeledOptPnlPct: 25, structure: "credit_vertical", entrySec: nowSec - 2 * 86400, nowSec }) === null);
ok("exit: credit -120% -> loss (stop at -100%)", resolvePickOutcome({ modeledOptPnlPct: -120, structure: "credit_vertical", entrySec: nowSec - 2 * 86400, nowSec }).outcome === "loss");
ok("exit: naked +25% -> win (TP still 20%)", resolvePickOutcome({ modeledOptPnlPct: 25, entrySec: nowSec - 2 * 86400, nowSec }).outcome === "win");

// --- 13. strategy routing through the full engine (IV z-score → structure) ---
// mkTicker grades strongly bullish; the IV z-score then drives the structure.
function mkStratTicker(iv, z, pctile) { const t = mkTicker({ spot: 120, sector: "Software" }); t.chains = mkBsChain(120, iv); t.ivRank = { pctile, n: 120, z }; return t; }
const routeRich = buildTopPicks({ RICHIV: mkStratTicker(0.95, 2.6, 88) }, [], null, null, null, null, 0.045, {}).find((p) => p.symbol === "RICHIV");
const routeDebit = buildTopPicks({ DBTIV: mkStratTicker(0.55, 1.5, 60) }, [], null, null, null, null, 0.045, {}).find((p) => p.symbol === "DBTIV");
const routeNaked = buildTopPicks({ LOWIV: mkStratTicker(0.30, 0.0, 25) }, [], null, null, null, null, 0.045, {}).find((p) => p.symbol === "LOWIV");
ok("route: rich IV (z≥2) → credit vertical (sells premium, even at strong conviction)", routeRich && routeRich.strategy.type === "credit" && routeRich.contract.structure === "credit_vertical" && routeRich.contract.optionType === "put");
ok("route: elevated-but-sub-2σ IV → debit vertical (don't pay naked)", routeDebit && routeDebit.strategy.type === "debit" && routeDebit.contract.structure === "debit_vertical");
ok("route: strong + reasonable IV → naked long", routeNaked && Math.abs(routeNaked.total) >= PICKS_TIER_STRONG && routeNaked.strategy.type === "long" && routeNaked.contract.structure === "long");
ok("route: low IV never sells a credit spread", routeNaked && routeNaked.strategy.type !== "credit");
ok("route: a naked-long pick is always strong-tier", [routeRich, routeDebit, routeNaked].filter(Boolean).filter((p) => p.strategy.type === "long").every((p) => Math.abs(p.total) >= PICKS_TIER_STRONG));
// A credit spread must be sized by its capital at risk (maxLoss = width − credit),
// NOT the small credit it collects (which would suggest far too many contracts).
if (routeRich && routeRich.strategy.type === "credit" && routeRich.sizing) {
  const ACCT = 25000; // PICKS_DISPLAY_ACCOUNT default (tests don't override the env)
  const byLoss = Math.max(1, Math.round((routeRich.sizing.weight * ACCT) / (routeRich.contract.maxLoss * 100)));
  const byCredit = Math.max(1, Math.round((routeRich.sizing.weight * ACCT) / (routeRich.contract.mid * 100)));
  ok("sizing: credit spread sized by maxLoss, not the credit", routeRich.sizing.suggestedContracts === byLoss && byLoss <= byCredit);
}

// --- 14. structure-aware mark-to-market (P/L sign: + always = making money) ---
const mkLegSnap = (v) => ({ ...v, legs: v.legs.map((l) => ({ qty: l.qty, type: l.type, strike: l.strike, iv: l.iv, expiry: l.expiry })) });
const dEntry = { side: "call", contract: { structure: "debit_vertical", expiry: exp30, mid: dbt.mid, netDebit: dbt.netDebit, ...mkLegSnap(dbt) } };
ok("mark: debit ~flat at entry spot", Math.abs(markOptionToMarket(dEntry, { spot: 100 })) < 8);
ok("mark: debit profits as price rises (bull call)", markOptionToMarket(dEntry, { spot: 112 }) > 5);
ok("mark: debit loses as price falls", markOptionToMarket(dEntry, { spot: 90 }) < 0);
const cEntry = { side: "call", contract: { structure: "credit_vertical", expiry: exp30, mid: crd.mid, netCredit: crd.netCredit, shortStrike: crd.shortStrike, ...mkLegSnap(crd) } };
ok("mark: credit ~flat at entry spot", Math.abs(markOptionToMarket(cEntry, { spot: 100 })) < 14);
ok("mark: credit profits as it decays (price up, away from short put)", markOptionToMarket(cEntry, { spot: 115 }) > 5);
ok("mark: credit loses when short strike is breached", markOptionToMarket(cEntry, { spot: crd.shortStrike - 1 }) < 0);
ok("mark: legacy single-long still marks (+ when ITM move)", (() => { const e = { side: "call", contract: { strike: 100, expiry: exp30, mid: 5, iv: 0.4 } }; return markOptionToMarket(e, { spot: 110 }) > markOptionToMarket(e, { spot: 100 }); })());

console.log(`\n${pass}/${pass + fail} checks passed.`);
process.exit(fail ? 1 : 0);
