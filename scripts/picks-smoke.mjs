// Offline synthetic smoke test for the rebuilt Top Picks engine. No Yahoo, no
// data/, no AI — builds fake chains and asserts the engine's behaviour + the
// output shapes the UI/serialization depend on. Run: node scripts/picks-smoke.mjs
import {
  buildTopPicks, buildGradesIndex, pickContractForPick, pickVerticalForPick, markOptionToMarket, computeEntryTiming, computeEntrySignal,
  detectMarketRegime, computeMacroRegime, applyMacroRegimePersistence,
  resolvePickOutcome, gradeTradeCut, buildPicksChanges, buildPicksRoster,
  diffGradesHistory, appendGradesDaily, appendRegimeHistory, applyPickFirstSeen,
  PICKS_MIN_CONVICTION, PICKS_TIER_STRONG, PICKS_TIMING_THRESHOLDS, computeEdgeScale,
  computeFactorTrendHealth, edgeGatedConviction,
  assessThesisQuality, selectStrategy, classifyPick, generateAiTheses, applyAiThesisGrade,
  buildMarketRead, macroKindOf, thesisCacheSig, PICKS_MAX_AI_THESES, buildThesisUserMessage,
  buildMacroCalendarAhead, transcriptGuidanceDirection, impliedMoveFromIvCrush,
  buildDcaPlan, DCA_BASE_USD,
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

// --- 1c. unusual flow is factored in ---------------------------------------
const ufSig = (g) => g.pillars.mechanicals.signals.find((s) => s.key === "unusualFlow");
ok("flow: unavailable without scanner data", ufSig(grades.BULLA) && !ufSig(grades.BULLA).available && ufSig(grades.BULLA).score === 0);
const mkFlag = (symbol, side, hoursAgo = 4) => ({ scannedAt: new Date(Date.now() - hoursAgo * 3600000).toISOString(), symbol, side, strike: 100, expSec: exp30, deltaVol: 800, vol: 1200, premium: 150000 });
const unusualNow = { scannedAt: new Date().toISOString(), tickers: [{ symbol: "BULLA", spot: 120, topDelta: 800, contracts: [mkFlag("BULLA", "call"), mkFlag("BULLA", "call"), mkFlag("BULLA", "call"), mkFlag("BULLA", "call"), mkFlag("BULLA", "call"), mkFlag("BULLA", "put")] }] };
const gradesUF = buildGradesIndex(chains, [], null, unusualNow, null, null, {});
const buf = ufSig(gradesUF.BULLA);
ok("flow: today's >=5-print call-heavy tape scores +1 from unusual.json rows", buf && buf.available && buf.score === 1 && buf.value === "5B/1S");
const flowLog = { updatedAt: new Date().toISOString(), entries: [2, 8, 26, 32, 50, 74].map((h) => mkFlag("BEAR", "put", h)) };
const gradesFP = buildGradesIndex(chains, [], null, null, null, null, { flowLog });
const bfp = ufSig(gradesFP.BEAR);
ok("flow: 7-day put-heavy flow-log persistence scores -1 via data.flowPersist", bfp && bfp.available && bfp.score === -1 && /^persist -1/.test(bfp.value || ""));
const gradesFPthin = buildGradesIndex(chains, [], null, null, null, null, { flowLog: { entries: flowLog.entries.slice(0, 4) } });
ok("flow: thin log (<5 flags in the window) stays unavailable", ufSig(gradesFPthin.BEAR) && !ufSig(gradesFPthin.BEAR).available && ufSig(gradesFPthin.BEAR).score === 0);

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
ok("contract: DTE within band (30-90, the 2026-07-10 hold-longer window)", ctr && ctr.dte >= 30 && ctr.dte <= 90);
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
// A go-timed pick reads buy-now UNLESS an extension band caught it (extended /
// RSI-chase — the volume-confirm go path can bless a stretched name; soft band
// basis "extended", hard band basis "top-guard").
ok("picks: a clean-timing (go) pick reads buy-now (extension bands permitting)", picks.filter((p) => p.entryTiming.state === "go").every((p) => (p.entry.now === true && p.entry.signal === "buy-now") || p.entry.basis === "top-guard" || p.entry.basis === "extended"));
// THE ENTRY GATE (2026-07-10): actionable means "buy it right now" — every
// actionable pick carries a confirmed buy-now entry; wait-entry names demote.
ok("picks: every ACTIONABLE pick is a confirmed buy-now (entry gate)", picks.every((p) => p.group === "actionable" ? (p.entry.now === true && p.entry.signal === "buy-now") : true));
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

// --- 4b2. multi-factor buy-now (entry readiness) ----------------------------
// A steadily-trending name — momentum aligned, right side of the 20D, 20D>50D
// stack, 3-day thrust — is a BUY NOW even without a textbook pullback or a
// volume spike (the old single-path logic parked it behind a dip trigger).
const steady = mkTicker({ spot: 100, technicals: {
  rsi: 60, rsi5d: 58, macd: { hist: 0.5, line: 1.1, signal: 0.6 },
  volume: { rvol: 1.0, priceMove1dPct: 0.4 },                       // NO volume confirmation
  sr: { s20: 93, r20: 108 }, sma: { sma20: 96.5, sma50: 92, sma100: 88 }, // +3.6% past 20D: outside pullback band, not extended
  chartPattern: null, volRegime: { rv30Pctile: 45 } } });
const steadyTiming = computeEntryTiming("call", steady, 100, {});
ok("entry: steady trend w/o pullback/volume -> timing gate is wait (not go)", steadyTiming.state === "wait");
const steadyEntry = computeEntrySignal("call", 100, steady, steadyTiming, { total: 6 });
ok("entry: multi-factor readiness clears the bar -> buy-now (no dip trigger)", steadyEntry.now === true && steadyEntry.signal === "buy-now" && steadyEntry.basis === "multi-factor readiness");
ok("entry: readiness checklist ships (checks + score vs bar)", Array.isArray(steadyEntry.checks) && steadyEntry.checks.length >= 8 && steadyEntry.readiness && steadyEntry.readiness.score >= steadyEntry.readiness.bar);
// Extended past the 20D WITHOUT broad confirmation still waits for the pullback.
const stretched = mkTicker({ spot: 100, technicals: {
  rsi: 64, rsi5d: 60, macd: { hist: 0.4, line: 1.0, signal: 0.6 },
  volume: { rvol: 0.9, priceMove1dPct: 0.3 },
  sr: { s20: 90, r20: 110 }, sma: { sma20: 94.3, sma50: 96, sma100: 90 },  // +6% past 20D, 20D<50D (no stack)
  chartPattern: null, volRegime: { rv30Pctile: 45 } },
  _bars: mkBars(100, 40, 0.002) });                                  // soft drift: no 3-day thrust
const stretchedEntry = computeEntrySignal("call", 100, stretched, computeEntryTiming("call", stretched, 100, {}), { total: 5 });
ok("entry: extended w/o confirmation still waits for the pullback", stretchedEntry.now === false && stretchedEntry.signal === "wait-pullback");
// The wait trigger must be REACHABLE — a ~1.5×ATR dip floored at the 20D, never
// an unreachable mean-reversion target (the old raw-20D trigger).
ok("entry: the pullback trigger is reachable (>= the 20D, < spot)", stretchedEntry.trigger >= 94.3 && stretchedEntry.trigger < 100);
// Extended 4-15% past the 20D is the SOFT band (2026-07-10 rework): the
// deterministic read still waits (keyless builds stay conservative) but the
// basis is "extended" — NOT the hard "top-guard" — so the AI final grader's
// entryVerdict may take it (momentum ride vs chase is the grader's call).
const breakout = mkTicker({ spot: 100, technicals: {
  rsi: 66, rsi5d: 62, macd: { hist: 0.6, line: 1.2, signal: 0.6 },
  volume: { rvol: 1.2, priceMove1dPct: 1.0 },                       // below the go-gate's 1.3 rvol bar
  sr: { s20: 90, r20: 112 }, sma: { sma20: 94.3, sma50: 92, sma100: 88 },
  chartPattern: null, volRegime: { rv30Pctile: 45 } },
  _bars: mkBars(100, 40, 0.006) });
const breakoutTiming = computeEntryTiming("call", breakout, 100, {});
const breakoutEntry = computeEntrySignal("call", 100, breakout, breakoutTiming, { total: 8 });
ok("entry: extended breakout deterministically waits, SOFT basis (AI may take it)", breakoutTiming.state === "wait" && breakoutEntry.now === false && breakoutEntry.signal === "wait-pullback" && breakoutEntry.basis === "extended");
// A PARABOLIC stretch (> PICKS_ENTRY_EXTENDED_HARD 15% past the 20D) is the
// HARD top-guard veto — basis "top-guard", no verdict can bless it.
const parabolic = mkTicker({ spot: 100, technicals: {
  rsi: 66, rsi5d: 62, macd: { hist: 0.6, line: 1.2, signal: 0.6 },
  volume: { rvol: 1.2, priceMove1dPct: 1.0 },
  sr: { s20: 80, r20: 112 }, sma: { sma20: 85, sma50: 82, sma100: 78 },   // +17.6% past the 20D
  chartPattern: null, volRegime: { rv30Pctile: 45 } },
  _bars: mkBars(100, 40, 0.006) });
const parabolicEntry = computeEntrySignal("call", 100, parabolic, computeEntryTiming("call", parabolic, 100, {}), { total: 8 });
ok("entry: parabolic stretch (>15%) is HARD top-guarded", parabolicEntry.now === false && parabolicEntry.signal === "wait-pullback" && parabolicEntry.basis === "top-guard");
ok("entry: even the parabolic trigger is reachable (ATR-scaled, not the far 20D)", parabolicEntry.trigger >= 90 && parabolicEntry.trigger < 100);
// RSI in the chase zone (72-80) is the SOFT band — even on a `go` timing state
// the deterministic read waits, but the basis is overridable.
const hotRsi = mkTicker({ spot: 100, technicals: {
  rsi: 74, rsi5d: 70, macd: { hist: 0.6, line: 1.2, signal: 0.6 },
  volume: { rvol: 1.5, priceMove1dPct: 0.8 },
  sr: { s20: 93, r20: 110 }, sma: { sma20: 99.5, sma50: 95, sma100: 90 },  // +0.5% vs 20D: NOT extended
  chartPattern: null, volRegime: { rv30Pctile: 45 } } });
const hotTiming = computeEntryTiming("call", hotRsi, 100, {});
const hotEntry = computeEntrySignal("call", 100, hotRsi, hotTiming, { total: 8 });
ok("entry: RSI 74 (chase zone) waits even on a go state — SOFT basis", hotTiming.state === "go" && hotEntry.now === false && hotEntry.signal === "wait-pullback" && hotEntry.basis === "extended");
// RSI at the blow-off extreme (>= PICKS_ENTRY_CHASE_RSI_HARD 80) is HARD.
const blowoff = mkTicker({ spot: 100, technicals: {
  rsi: 82, rsi5d: 78, macd: { hist: 0.6, line: 1.2, signal: 0.6 },
  volume: { rvol: 1.5, priceMove1dPct: 0.8 },
  sr: { s20: 93, r20: 110 }, sma: { sma20: 99.5, sma50: 95, sma100: 90 },
  chartPattern: null, volRegime: { rv30Pctile: 45 } } });
const blowoffEntry = computeEntrySignal("call", 100, blowoff, computeEntryTiming("call", blowoff, 100, {}), { total: 8 });
ok("entry: RSI 82 (blow-off) is HARD top-guarded — never buy-now", blowoffEntry.now === false && blowoffEntry.signal === "wait-pullback" && blowoffEntry.basis === "top-guard");
// Hard vetoes survive the checklist: an avoid (knife) state and an imminent
// earnings print never read buy-now, whatever the factors say.
const knifeEntry = computeEntrySignal("call", 50, chains.KNIFE, computeEntryTiming("call", chains.KNIFE, 50, {}), { total: 8 });
ok("entry: an avoid (knife) state never reads buy-now", knifeEntry.now === false && knifeEntry.signal !== "buy-now");
const earnEntry = computeEntrySignal("call", 100, earnSoon, computeEntryTiming("call", earnSoon, 100, {}), { total: 8 });
ok("entry: imminent earnings never a buy-now (checklist can't override)", earnEntry.now === false && earnEntry.signal === "wait-event");
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
// Weighted composite: two LIGHTWEIGHT axes (monthly CPI ×0.5 + put/call positioning
// ×0.75) no longer trip risk-off on count alone — under the flat vote these two
// counted 2 full axes and locked the tape; weighted they sum to 1.25 effective.
const lightOff = { inflation: { yoy: 4.4, yoy3mAgo: 3.0, trend: "rising" }, putCall: { oiRatio: 9.9, volRatio: null, totalVol: 0, oiSum: 1000 } };
const lightRegime = computeMacroRegime(lightOff, null, [], null);
ok("regime: lightweight axes alone (CPI + put/call) stay neutral", lightRegime.state === "neutral");
ok("regime: axis weights ship in thresholds (fed outweighs inflation)",
  lightRegime.thresholds.axisWeights.fed > lightRegime.thresholds.axisWeights.inflation);
ok("regime: detectMarketRegime maps to risk-off", detectMarketRegime({}, riskOff) === "risk-off");
const picksOff = buildTopPicks(chains, [], null, null, riskOff, null, 0.045, {});
const putShareOff = picksOff.length ? picksOff.filter((p) => p.side === "put").length / picksOff.length : 0;
const putShareNeutral = picks.length ? picks.filter((p) => p.side === "put").length / picks.length : 0;
ok("regime: risk-off tilts the book more bearish (put share up or equal)", putShareOff >= putShareNeutral);
ok("regime: risk-off de-grosses", picksOff.length === 0 || picksOff.rosterMeta.deployedGross <= picks.rosterMeta.deployedGross + 1e-9);
// A tactical put is a DEFENSIVE trade — its thin single-name thesis must NOT
// collapse it to a contract-less "no recommendation"; it always carries a structure.
ok("regime: tactical puts carry a real contract (never 'none'), in the watch group",
  picksOff.filter((p) => p.tactical).every((p) => p.contract && p.strategy.type !== "none" && p.group === "watch" && p.classification === "moderate"));
// persistence
const persisted = applyMacroRegimePersistence(computeMacroRegime({ vix: { value: 13, trend: "flat" } }, null, []), { state: "severe-risk-off" });
ok("regime: persistence holds a recovering state one build", persisted.persisted === true);

// --- 6. resolvePickOutcome ------------------------------------------------
// 2026-07-15 exit flip: flat +20% TP / -50% stop, scale-out opt-in (off by default).
ok("exit: -55% option -> hit-stop loss", resolvePickOutcome({ modeledOptPnlPct: -55, entrySec: nowSec - dayMs / 1000, nowSec })?.outcome === "loss");
ok("exit: -35% option -> stays open (stop now -50%)", resolvePickOutcome({ modeledOptPnlPct: -35, entrySec: nowSec - dayMs / 1000, nowSec }) === null);
ok("exit: +25% option -> hard take-profit win (scale-out off by default)", resolvePickOutcome({ modeledOptPnlPct: 25, entrySec: nowSec - dayMs / 1000, nowSec })?.status === "hit-tp-prem");
ok("exit: +5% still open -> null", resolvePickOutcome({ modeledOptPnlPct: 5, entrySec: nowSec - 2 * 86400, nowSec }) === null);
// No time stop: a slightly-red position two weeks in stays open — the trade is
// held for as long as the thesis is intact and the contract hasn't expired.
ok("exit: 14d held, underwater, thesis intact -> stays open (time stop retired)", resolvePickOutcome({ modeledOptPnlPct: -5, entrySec: nowSec - 15 * 86400, nowSec }) === null);
// No pre-earnings exit: an imminent print alone never closes a trade.
ok("exit: earnings tomorrow, thesis intact -> stays open (pre-earnings exit retired)", resolvePickOutcome({ modeledOptPnlPct: -5, earningsAheadDays: 1, entrySec: nowSec - 2 * 86400, nowSec }) === null);
// Thesis invalidation IS an exit: a broken thesis closes at the current mark.
{
  const r = resolvePickOutcome({ modeledOptPnlPct: -5, thesisBroken: true, entrySec: nowSec - 2 * 86400, nowSec });
  ok("exit: thesis broken -> thesis-broken loss", !!r && r.status === "thesis-broken" && r.outcome === "loss");
}
ok("exit: thesis broken while green -> thesis-broken win", resolvePickOutcome({ modeledOptPnlPct: 8, thesisBroken: true, entrySec: nowSec - 2 * 86400, nowSec }).outcome === "win");
// Scale-out + runner trail: banked half at +22, peak +40 -> trail floor 15;
// a fade to +10 closes as trail-stop and the blend (0.5*22 + 0.5*10 = +16) wins.
{
  const r = resolvePickOutcome({ modeledOptPnlPct: 10, scaledOutPnlPct: 22, peakPnlPct: 40, entrySec: nowSec - 2 * 86400, nowSec });
  ok("exit: armed runner fades to the trail -> trail-stop win", !!r && r.status === "trail-stop" && r.outcome === "win");
}
// With the flat TP live (scale-out off by default), an armed runner at/above the
// +20% gate resolves as a hard TP; between the trail floor and the gate it stays open.
ok("exit: armed runner between trail floor and TP -> stays open", resolvePickOutcome({ modeledOptPnlPct: 18, scaledOutPnlPct: 22, peakPnlPct: 40, entrySec: nowSec - 2 * 86400, nowSec }) === null);
ok("exit: armed runner at +30 -> flat TP closes it (scale-out off)", resolvePickOutcome({ modeledOptPnlPct: 30, scaledOutPnlPct: 22, peakPnlPct: 40, entrySec: nowSec - 2 * 86400, nowSec })?.status === "hit-tp-prem");
// An armed trade can't round-trip to a net loss: peak 22, gap to -2 -> the
// breakeven floor closes it, blend 0.5*22 + 0.5*(-2) = +10 -> win.
{
  const r = resolvePickOutcome({ modeledOptPnlPct: -2, scaledOutPnlPct: 22, peakPnlPct: 22, entrySec: nowSec - 2 * 86400, nowSec });
  ok("exit: armed trade gapping red still banks the half -> win", !!r && r.status === "trail-stop" && r.outcome === "win");
}
// The exit ladder's stock stop is enforced: a call whose spot closed through
// the cut level resolves even though the premium never printed -30% at a mark.
{
  const r = resolvePickOutcome({ modeledOptPnlPct: -12, isCall: true, cur: 88, stopUnder: 90, entrySec: nowSec - 2 * 86400, nowSec });
  ok("exit: stock stop breach -> hit-stop-under loss", !!r && r.status === "hit-stop-under" && r.outcome === "loss");
}
ok("exit: spot above the stock stop -> untouched", resolvePickOutcome({ modeledOptPnlPct: -12, isCall: true, cur: 95, stopUnder: 90, entrySec: nowSec - 2 * 86400, nowSec }) === null);

// --- 7. history / churn / roster builders (no runtime errors + shapes) -----
const gh = diffGradesHistory({ latest: {}, changes: [] }, grades, new Date().toISOString());
ok("history: diffGradesHistory returns latest+changes", gh.latest && Array.isArray(gh.changes));
const changes = buildPicksChanges({}, grades, new Date().toISOString(), null);
ok("churn: buildPicksChanges returns events array", Array.isArray(changes));
const roster = buildPicksRoster(picks, [], {}, grades, new Date().toISOString(), false);
ok("roster: buildPicksRoster shape", roster.roster && Array.isArray(roster.roster) && Array.isArray(roster.exited));
// Roster (Top 10 — Picks in & out) tracks ONLY actionable picks — watch/ideas
// are not enrolled, matching the scorecard. A mixed set yields actionable-only.
{
  const mixed = [
    { symbol: "ACTA", side: "put", total: -9, group: "actionable", recommendation: { tier: "Strong put" }, pillars: {} },
    { symbol: "WCHB", side: "call", total: 5, group: "watch", recommendation: { tier: "Call" }, pillars: {} },
  ];
  const r = buildPicksRoster(mixed, [], {}, grades, new Date().toISOString(), false);
  ok("roster: tracks only actionable picks (watch excluded)",
    r.roster.length === 1 && r.roster[0].symbol === "ACTA" && !r.roster.some((x) => x.symbol === "WCHB"));
  // A name demoted actionable→watch leaves the roster (prior actionable filtered too).
  const r2 = buildPicksRoster(mixed.filter((p) => p.group === "actionable"), mixed, {}, grades, new Date().toISOString(), false);
  ok("roster: prior watch picks are not counted as exited", !r2.exited.some((x) => x.symbol === "WCHB"));
}
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
ok("strategy: every pick carries a strategy {type}", picks.length === 0 || picks.every((p) => p.strategy && ["long", "debit", "credit", "none"].includes(p.strategy.type)));
ok("strategy: a recommended pick has a known contract structure", picks.every((p) => p.strategy.type === "none" ? p.contract == null : ["long", "debit_vertical", "credit_vertical"].includes(p.contract.structure)));
ok("strategy: every shipped debit vertical pays >= 1x its risk", picks.every((p) => p.contract?.structure !== "debit_vertical" || (p.contract.rewardRisk >= 1 && p.contract.maxProfit >= p.contract.maxLoss)));
ok("thesis: thesisCard has marketRead/conviction/hasSolidThesis", picks.every((p) => p.thesisCard && p.thesisCard.marketRead && typeof p.thesisCard.hasSolidThesis === "boolean" && !!p.thesisCard.conviction));
ok("thesis: marketRead.support is a known verdict", picks.every((p) => ["supports", "against", "neutral"].includes(p.thesisCard.marketRead.support)));
ok("thesis: thesisCard.strategy mirrors the pick strategy", picks.every((p) => p.thesisCard.strategy && p.thesisCard.strategy.type === p.strategy.type));
ok("thesis: works + invalidators present", picks.every((p) => Array.isArray(p.thesisCard.works) && Array.isArray(p.thesisCard.invalidators) && p.thesisCard.invalidators.length > 0));
// thesis v2 — quality score, the 6-section split, the edge, the matrix classification
ok("thesis: thesisQuality {score,tier,checklist} present", picks.every((p) => { const q = p.thesisCard.thesisQuality; return q && typeof q.score === "number" && ["strong", "moderate", "weak"].includes(q.tier) && Array.isArray(q.checklist) && q.checklist.length === 5; }));
ok("thesis: edge {hasEdge,text} present", picks.every((p) => p.thesisCard.edge && typeof p.thesisCard.edge.hasEdge === "boolean" && !!p.thesisCard.edge.text));
ok("thesis: companyDrivers + confirmation arrays present", picks.every((p) => Array.isArray(p.thesisCard.companyDrivers) && Array.isArray(p.thesisCard.confirmation)));
ok("thesis: classification + group surfaced on the pick", picks.every((p) => ["actionable", "waitEntry", "moderate", "highGradeWeakThesis", "idea"].includes(p.classification) && ["actionable", "watch"].includes(p.group)));
ok("thesis: hasSolidThesis === (tier strong)", picks.every((p) => p.thesisCard.hasSolidThesis === (p.thesisCard.thesisQuality.tier === "strong")));
// the grade × thesis MATRIX invariants must hold for every shipped pick
ok("matrix: actionable ⇔ strong grade + strong thesis + a contract", picks.every((p) => p.group === "actionable" ? (Math.abs(p.total) >= PICKS_TIER_STRONG && p.thesisCard.thesisQuality.tier === "strong" && !!p.contract && p.strategy.type !== "none") : true));
ok("matrix: a weak thesis ⇒ no strategy, no contract, watch group", picks.every((p) => p.thesisCard.thesisQuality.tier === "weak" ? (p.strategy.type === "none" && p.contract == null && p.group === "watch") : true));
ok("roster: rosterMeta.groups counts the two tiers", picks.rosterMeta && picks.rosterMeta.groups && (picks.rosterMeta.groups.actionable + picks.rosterMeta.groups.watch) === picks.length);

// --- 12b. thesis-quality rubric / strategy gate / matrix (unit) -------------
const mkR = (total, p) => ({ sym: "Z", total, data: { ivRank: p.iv || null }, pillars: p.pillars, drivers: p.drivers });
const mrSup = { support: "supports", group: "broad", drivers: [] };
const mrNeu = { support: "neutral", group: "broad", drivers: [] };
// multi-pillar + supportive macro -> strong
const rMulti = mkR(8, { pillars: { fundamentals: { signals: [{ key: "epsGrowth", score: 2 }] }, technicals: { signals: [{ key: "macd", score: 1 }] }, mechanicals: { signals: [{ key: "unusualFlow", score: 1 }] }, narrative: { signals: [] } }, drivers: [{ key: "epsGrowth", label: "EPS growth", score: 2 }, { key: "macd", label: "MACD", score: 1 }, { key: "unusualFlow", label: "Unusual flow", score: 1 }] });
const worksMulti = [{ key: "epsGrowth", pillarKey: "fundamentals" }, { key: "macd", pillarKey: "technicals" }, { key: "unusualFlow", pillarKey: "mechanicals" }];
ok("rubric: multi-pillar + supportive macro → strong", assessThesisQuality(rMulti, "call", mrSup, worksMulti).tier === "strong");
// single-pillar (technicals only) -> weak
const rThin = mkR(5, { pillars: { technicals: { signals: [{ key: "macd", score: 5 }] }, fundamentals: { signals: [] }, mechanicals: { signals: [] }, narrative: { signals: [] } }, drivers: [{ key: "macd", label: "MACD", score: 5 }] });
const qThin = assessThesisQuality(rThin, "call", mrNeu, [{ key: "macd", pillarKey: "technicals" }]);
ok("rubric: single-pillar read → weak", qThin.tier === "weak");
ok("rubric: macro headwind on a multi-factor name stays ≥ moderate (not weak)", assessThesisQuality(rMulti, "call", { support: "against", group: "broad", drivers: [] }, worksMulti).tier !== "weak");
// strategy gate
ok("strategy gate: weak thesis → none", selectStrategy(rThin, "call", { thesisTier: "weak" }).type === "none");
ok("strategy gate: elevated IV (z 1.6) → credit", selectStrategy(mkR(6, { iv: { z: 1.6, pctile: 66 } }), "call", { thesisTier: "moderate" }).type === "credit");
ok("strategy gate: elevated by PCTILE (65th, z null) → credit", selectStrategy(mkR(6, { iv: { pctile: 65 } }), "call", { thesisTier: "moderate" }).type === "credit");
ok("strategy gate: low IV + strong grade + strong thesis → naked", selectStrategy(mkR(8, { iv: { z: 0, pctile: 30 } }), "call", { thesisTier: "strong" }).type === "long");
ok("strategy gate: low IV + only moderate thesis → debit (naked needs strong)", selectStrategy(mkR(8, { iv: { z: 0, pctile: 30 } }), "call", { thesisTier: "moderate" }).type === "debit");
// classification matrix
ok("classify: strong grade + strong thesis → actionable", classifyPick(8, "strong", false).group === "actionable" && classifyPick(8, "strong", false).classification === "actionable");
ok("classify: strong grade + weak thesis → high-grade-weak-thesis / watch", classifyPick(8, "weak", false).classification === "highGradeWeakThesis" && classifyPick(8, "weak", false).group === "watch");
ok("classify: moderate grade + strong thesis → moderate / watch", classifyPick(5, "strong", false).classification === "moderate" && classifyPick(5, "strong", false).group === "watch");
ok("classify: moderate grade + weak thesis → idea / watch", classifyPick(5, "weak", false).classification === "idea" && classifyPick(5, "weak", false).group === "watch");
// actionable gates (the 2026-07-10 rework): direction confluence + a required AI
// grade when the grader is live. Omitted gates (legacy callers) keep old behavior.
{
  const single = classifyPick(8, "strong", false, { pillarsAligned: 1, aiGraded: true, aiActive: true });
  ok("classify: single-pillar strong demotes to watch (confluence gate)", single.group === "watch" && single.demotion === "confluence");
  const ungraded = classifyPick(8, "strong", false, { pillarsAligned: 3, aiGraded: false, aiActive: true });
  ok("classify: AI live but name ungraded → watch (ai-ungraded)", ungraded.group === "watch" && ungraded.demotion === "ai-ungraded");
  const keyless = classifyPick(8, "strong", false, { pillarsAligned: 3, aiGraded: false, aiActive: false });
  ok("classify: keyless build keeps the deterministic actionable", keyless.group === "actionable" && keyless.demotion === null);
  const graded = classifyPick(8, "strong", false, { pillarsAligned: 2, aiGraded: true, aiActive: true });
  ok("classify: AI-graded multi-pillar strong stays actionable", graded.group === "actionable");
  // The entry gate (2026-07-10): an unconfirmed entry demotes a strong+strong
  // name to the "wait for entry" watch tier; a confirmed one stays actionable;
  // legacy callers that omit the field keep the old behavior.
  const waitE = classifyPick(8, "strong", false, { pillarsAligned: 3, aiGraded: true, aiActive: true, entryConfirmed: false });
  ok("classify: entry unconfirmed → waitEntry / watch (entry-wait demotion)", waitE.group === "watch" && waitE.classification === "waitEntry" && waitE.demotion === "entry-wait");
  const buyE = classifyPick(8, "strong", false, { pillarsAligned: 3, aiGraded: true, aiActive: true, entryConfirmed: true });
  ok("classify: entry confirmed → actionable", buyE.group === "actionable" && buyE.demotion === null);
}

// --- 12b2. entry gate through the full roster build --------------------------
// A strong-graded name stretched into the SOFT band (+6.4% past the 20D) with
// NO AI verdict (keyless/offline) keeps the conservative deterministic wait —
// never actionable — and lands in watch (instrumented in entryDemoted when it
// was strong+strong).
{
  const extended = mkTicker({ spot: 100, technicals: {
    rsi: 62, rsi5d: 60, macd: { hist: 0.5, line: 1.1, signal: 0.6 },
    volume: { rvol: 1.5, priceMove1dPct: 1.0 },
    sr: { s20: 92, r20: 110 }, sma: { sma20: 94, sma50: 90, sma100: 86 },  // +6.4% past the 20D (SOFT band)
    chartPattern: { pattern: "Bull Flag", stage: "confirmed" }, volRegime: { rv30Pctile: 45 } } });
  const out = buildTopPicks({ EXTD: extended }, [], null, null, null, null, 0.045, {});
  const p = out.find((x) => x.symbol === "EXTD");
  ok("entry gate: soft-extended + no AI verdict reads wait (basis 'extended'), never buy-now", !p || (p.entry.now === false && p.entry.basis === "extended"));
  ok("entry gate: an extended name w/o a verdict never ships actionable", !p || p.group !== "actionable");
  ok("entry gate: a demoted strong+strong pick is instrumented in entryDemoted", !p || p.classification !== "waitEntry" || out.rosterMeta.entryDemoted.includes("EXTD"));
}

// --- 12b3. AI final entry call (the grader's verdict, not the price read, decides) --
// The AI final grader returns entryVerdict (buy-now/wait) alongside the grade;
// buildTopPicks uses it as the final buy/wait call — overriding a soft price
// trigger in EITHER direction — while the hard risk vetoes (top-guard, event
// defer) bind regardless, and a missing verdict (legacy cache / keyless) falls
// back to the deterministic read.
{
  const mkAi = (verdict) => ({ summary: "x", setup: "x", catalyst: "x", outlook: "x", macroSupport: "neutral", invalidation: ["a"], grade: "strong", score: 90, entryVerdict: verdict, entryReason: "the catalyst is live" });
  // A soft deterministic WAIT (buy-dip): momentum not aligned (RSI 49), no
  // volume/thrust/stack — readiness below the bar — but NOT extended/overbought
  // and no imminent event, so the AI's judgment may take the entry.
  const dipName = mkTicker({ spot: 100,
    fundamentals: { earningsGrowthYoy: 35, revenueGrowthYoy: 28, targetMeanPrice: 122, numberOfAnalystOpinions: 14, analystRevisions: { upgrades: 5, downgrades: 0 }, nextEarningsDate: new Date(Date.now() + 60 * dayMs).toISOString().slice(0, 10) },
    technicals: { rsi: 49, rsi5d: 50, macd: { hist: 0.3, line: 0.5, signal: 0.2 }, volume: { rvol: 0.9, priceMove1dPct: 0.2 }, sr: { s20: 96, r20: 108 }, sma: { sma20: 99, sma50: 103, sma100: 95 }, chartPattern: null, volRegime: { rv30Pctile: 45 } },
    _bars: mkBars(100, 40, 0) });
  const detE = computeEntrySignal("call", 100, dipName, computeEntryTiming("call", dipName, 100, {}), { total: 6 });
  ok("ai-entry: fixture is a soft deterministic wait (buy-dip)", detE.now === false && detE.signal === "buy-dip");
  const up = buildTopPicks({ DIPN: dipName }, [], null, null, null, null, 0.045, { aiThesisMap: { "DIPN:call": mkAi("buy-now") } });
  const pUp = up.find((x) => x.symbol === "DIPN");
  ok("ai-entry: AI buy-now overrides the soft price wait (final call is the grader's)", !!pUp && pUp.entry.now === true && pUp.entry.signal === "buy-now" && pUp.entry.basis === "ai-final-grader" && up.rosterMeta.aiEntryPromoted.includes("DIPN"));
  ok("ai-entry: the AI verdict rides the entry object", !!pUp && pUp.entry.ai && pUp.entry.ai.verdict === "buy-now" && pUp.entry.ai.overrode === true);
  // AI WAIT holds back a price-ready name — never actionable, no price trigger.
  const lead = healthyPicks[0];
  if (lead) {
    const key = lead.symbol + ":" + lead.side;
    const held = buildTopPicks(healthyUniverse, [], null, null, null, null, 0.045, { aiThesisMap: { [key]: mkAi("wait") } });
    const pH = held.find((x) => x.symbol === lead.symbol && x.side === lead.side);
    ok("ai-entry: AI wait holds back a price-ready name (watch, wait-ai, instrumented)", !pH || (pH.group !== "actionable" && pH.entry.now === false && pH.entry.signal === "wait-ai" && held.rosterMeta.aiEntryHeldBack.includes(lead.symbol)));
  }
  // The SOFT extension band is the grader's judgment zone (2026-07-10 rework):
  // an AI buy-now TAKES a +6.4%-extended momentum name (the old 4% hard veto
  // perpetually locked out the engine's strongest names).
  const extg = mkTicker({ spot: 100, technicals: {
    rsi: 62, rsi5d: 60, macd: { hist: 0.5, line: 1.1, signal: 0.6 },
    volume: { rvol: 1.5, priceMove1dPct: 1.0 },
    sr: { s20: 92, r20: 110 }, sma: { sma20: 94, sma50: 90, sma100: 86 },  // +6.4%: SOFT band
    chartPattern: { pattern: "Bull Flag", stage: "confirmed" }, volRegime: { rv30Pctile: 45 } } });
  const tg = buildTopPicks({ EXTG: extg }, [], null, null, null, null, 0.045, { aiThesisMap: { "EXTG:call": mkAi("buy-now") } });
  const pTg = tg.find((x) => x.symbol === "EXTG");
  ok("ai-entry: an AI buy-now takes a SOFT-extended name (momentum ride is the grader's call)", !!pTg && pTg.entry.now === true && pTg.entry.basis === "ai-final-grader" && tg.rosterMeta.aiEntryPromoted.includes("EXTG"));
  // The HARD band binds regardless: an AI buy-now can never bless a parabola.
  const para = mkTicker({ spot: 100, technicals: {
    rsi: 62, rsi5d: 60, macd: { hist: 0.5, line: 1.1, signal: 0.6 },
    volume: { rvol: 1.5, priceMove1dPct: 1.0 },
    sr: { s20: 80, r20: 110 }, sma: { sma20: 85, sma50: 80, sma100: 76 },  // +17.6%: HARD top-guard
    chartPattern: { pattern: "Bull Flag", stage: "confirmed" }, volRegime: { rv30Pctile: 45 } } });
  const tgh = buildTopPicks({ PARA: para }, [], null, null, null, null, 0.045, { aiThesisMap: { "PARA:call": mkAi("buy-now") } });
  const pTgh = tgh.find((x) => x.symbol === "PARA");
  ok("ai-entry: the HARD top-guard binds — an AI buy-now can't bless a parabola", !pTgh || (pTgh.entry.now === false && pTgh.group !== "actionable" && !tgh.rosterMeta.aiEntryPromoted.includes("PARA")));
  // No verdict (legacy cached thesis) → the deterministic read stands.
  const legacy = { summary: "x", setup: "x", catalyst: "x", outlook: "x", macroSupport: "neutral", invalidation: ["a"], grade: "strong", score: 90 };
  const lg = buildTopPicks({ DIPN: dipName }, [], null, null, null, null, 0.045, { aiThesisMap: { "DIPN:call": legacy } });
  const pLg = lg.find((x) => x.symbol === "DIPN");
  ok("ai-entry: no verdict → deterministic read stands (no fabricated buy)", !pLg || (pLg.entry.now === false && pLg.entry.signal === "buy-dip" && !pLg.entry.ai));
}

// --- 12b4. the final-pass prompt carries the FULL evidence table --------------
// Keyless runs never reach buildThesisUserMessage, so exercise it directly: the
// prompt must ship every pillar's scored signals (FOR/AGAINST the trade), the
// technical structure/levels, the earnings track record + implied move, the
// trajectory, capital events, and the deterministic entry read + entry-call ask.
{
  const d = mkTicker({ spot: 100 });
  d.earningsHx = {
    events: [{ date: "2026-04-30", surprisePct: 6.2, movePct: 4.1 }],
    next: { date: "2026-08-05", session: "PM", daysUntil: 26, impliedMovePct: 7.5 },
  };
  d.capitalRaise = { kind: "buyback", title: "Board authorizes $5B buyback" };
  const r = {
    sym: "MSGX", total: 8, side: "call", recommendation: { tier: "Strong Call" },
    pillars: {
      technicals: { score: 3, signals: [{ key: "macd", label: "MACD", score: 1, value: "hist 0.4", available: true }] },
      mechanicals: { score: 1, signals: [{ key: "unusualFlow", label: "Unusual options flow", score: 1, value: "2.4x calls", available: true }] },
      fundamentals: { score: 3, signals: [{ key: "epsGrowth", label: "EPS growth", score: 2, value: "+15%", available: true }], trajectory: { dir: "improving", score: 1, confidence: "medium", reason: "growth accelerating vs trailing rate" } },
      narrative: { score: -1, signals: [{ key: "newsCatalyst", label: "News catalyst", score: -3, value: "bearish", available: true }] },
    },
    drivers: [], timing: computeEntryTiming("call", d, 100, {}),
    streakRow: { current: { color: "green", sameDays: 3, cumulativePct: 4.2 } },
    data: d,
  };
  d.oiTrackerRow = { callWall: { strike: 110, oi: 18400, expSec: exp30 }, putWall: { strike: 90, oi: 9100, expSec: exp30 }, cpRatio: 1.42, callOiTotal: 60000, putOiTotal: 42000, score: 3, flagged: false, scannedAt: "2026-07-16T12:00:00Z" };
  const msg = buildThesisUserMessage(r, "call", null, {
    macroCalendar: [{ label: "CPI", date: "2026-07-22", daysOut: 6 }, { label: "FOMC decision", date: "2026-07-29", daysOut: 13 }],
    ivRow: { symbol: "MSGX", chg1dPct: 2.1, chg5dPct: 11.4, chg20dPct: 18.9, risingStreak: 4, tier: "trending", elevated: true },
  });
  ok("prompt: every pillar's signals ride with FOR/AGAINST votes",
    /PILLAR — Technicals/.test(msg) && /PILLAR — Options flow/.test(msg) && /PILLAR — Fundamentals/.test(msg) && /PILLAR — Narrative/.test(msg) &&
    /MACD \(hist 0\.4\) FOR/.test(msg) && /News catalyst \(bearish\) AGAINST!/.test(msg));
  ok("prompt: technical structure + streak + chart pattern cited",
    /TECHNICAL STRUCTURE:/.test(msg) && /20D SMA \$99\.00/.test(msg) && /Bull Flag/.test(msg) && /3-day green streak/.test(msg));
  ok("prompt: earnings track record + straddle-implied move ride",
    /EARNINGS TRACK RECORD: 2026-04-30: EPS surprise \+6\.2%, stock \+4\.1% next session/.test(msg) && /NEXT EARNINGS: 2026-08-05 \(PM\), 26d out — the straddle already implies a ±7\.5% move/.test(msg));
  ok("prompt: trajectory + capital event + deterministic entry + entry-call ask ride",
    /FUNDAMENTALS TRAJECTORY: improving/.test(msg) && /CAPITAL EVENT \(headline-flagged\): buyback/.test(msg) && /ENTRY TIMING \(deterministic/.test(msg) && /FINAL GRADE \+ ENTRY CALL:/.test(msg));
  ok("prompt: macro calendar inside the trade horizon rides",
    /MACRO CALENDAR/.test(msg) && /CPI 2026-07-22 \(6d\)/.test(msg) && /FOMC decision 2026-07-29 \(13d\)/.test(msg));
  ok("prompt: OI walls + gamma score ride",
    /OI POSITIONING \(front 2 expirations, as of 2026-07-16\)/.test(msg) && /call wall \$110 \(18,400 OI\)/.test(msg) && /put wall \$90 \(9,100 OI\)/.test(msg) && /total OI 1\.42 C\/P/.test(msg) && /gamma-squeeze score 3\/5/.test(msg));
  ok("prompt: IV momentum rides",
    /IV MOMENTUM: 1d \+2\.1%, 5d \+11\.4%, 20d \+18\.9%/.test(msg) && /4 straight rising sessions/.test(msg) && /"trending" trend tier/.test(msg));
  // Omission behavior: no extras / no OI row → the new lines are absent (old
  // 3-arg call shape still works for legacy callers).
  d.oiTrackerRow = null;
  const msgBare = buildThesisUserMessage(r, "call", null);
  ok("prompt: calendar/OI/IV-momentum lines omitted without data",
    !/MACRO CALENDAR/.test(msgBare) && !/OI POSITIONING/.test(msgBare) && !/IV MOMENTUM/.test(msgBare));
  // Pre-earnings drift line: gated on the print being inside ~25d (the block
  // above set daysUntil 26, so it must be absent there).
  ok("prompt: drift line absent when the print is beyond the window", !/PRE-EARNINGS DRIFT/.test(msg));
  d.earningsHx = {
    events: [
      { date: "2025-10-29", pre10Pct: -3.0, pre15Pct: -4.0 },
      { date: "2026-01-28", pre10Pct: 2.0, pre15Pct: 3.1 },
      { date: "2026-04-30", surprisePct: 6.2, movePct: 4.1, pre10Pct: 1.2, pre15Pct: 2.5 },
    ],
    next: { date: "2026-08-05", session: "PM", daysUntil: 12, impliedMovePct: 7.5, pre10Pct: 1.0, pre15Pct: 1.9 },
  };
  const msgDrift = buildThesisUserMessage(r, "call", null);
  ok("prompt: pre-earnings drift rides when the print is inside the window",
    /PRE-EARNINGS DRIFT \(the hold window overlaps the run-up into the 2026-08-05 print\)/.test(msgDrift) &&
    /ran higher into 2 and lower into 1 of its last 3 prints \(avg \+0\.5%/.test(msgDrift) &&
    /current run-up into this print: \+1\.9% so far/.test(msgDrift));
}

// --- 12b5. buildMacroCalendarAhead — the thesis prompt's forward look-ahead ----
{
  const meetings = [{ date: "2026-07-29" }, { date: "2026-09-17" }]; // 2nd beyond horizon
  const reports = [
    { date: "2026-07-22", subtype: "cpi-mom", title: "CPI (MoM)" },
    { date: "2026-07-22", subtype: "cpi-yoy", title: "CPI (YoY)" },              // same family+day → deduped
    { date: "2026-07-24", subtype: "ppi-mom", title: "PPI (MoM)" },
    { date: "2026-07-15", subtype: "nfp", title: "Nonfarm payrolls" },           // past → dropped
    { date: "2026-07-21", subtype: "retail-sales", title: "Retail sales" },      // not a major → dropped
    { date: "2026-07-23", subtype: "cpi-mom", title: "CPI (MoM)", actual: "0.3%" }, // printed → dropped
  ];
  const cal = buildMacroCalendarAhead(meetings, reports, "2026-07-16");
  ok("macro-cal: majors + FOMC inside horizon, deduped, printed/past/minor dropped",
    cal.length === 3 &&
    cal[0].label === "CPI" && cal[0].date === "2026-07-22" && cal[0].daysOut === 6 &&
    cal[1].label === "PPI" && cal[1].daysOut === 8 &&
    cal[2].label === "FOMC decision" && cal[2].daysOut === 13);
  ok("macro-cal: bad todayIso → empty (no throw)", Array.isArray(buildMacroCalendarAhead(meetings, reports, "not-a-date")) && buildMacroCalendarAhead(meetings, reports, "not-a-date").length === 0);
}

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
ok("vertical: debit reward:risk >= 1x (debit never exceeds half the width)", dbt && dbt.rewardRisk >= 1 && dbt.maxProfit >= dbt.maxLoss);
const crd = pickVerticalForPick("call", bsData, 0.045, { type: "credit" });
ok("vertical: credit spread builds as bull-put (puts)", !!crd && crd.structure === "credit_vertical" && crd.optionType === "put");
ok("vertical: credit maxProfit≈credit, maxLoss+maxProfit≈width", crd && Math.abs(crd.maxProfit - crd.mid) < 0.06 && Math.abs((crd.maxLoss + crd.maxProfit) - crd.width) < 0.06);
ok("vertical: credit short strike > long (bull put)", crd && crd.shortStrike > crd.longStrike);
ok("vertical: credit fraction near the 1/3 target (>=floor)", crd && crd.creditFrac >= 0.22);
ok("vertical: credit net delta positive (bullish)", crd && crd.delta > 0);
const crdBear = pickVerticalForPick("put", bsData, 0.045, { type: "credit" });
ok("vertical: bearish credit builds as bear-call (calls)", !!crdBear && crdBear.optionType === "call" && crdBear.delta < 0);

// Structure-aware exit resolution (credit spreads decay → different gates).
ok("exit: credit +55% -> win (hard TP at 50%, no scale-out on credit)", resolvePickOutcome({ modeledOptPnlPct: 55, structure: "credit_vertical", entrySec: nowSec - 2 * 86400, nowSec }).status === "hit-tp-prem");
ok("exit: credit +25% -> still open (below 50% TP)", resolvePickOutcome({ modeledOptPnlPct: 25, structure: "credit_vertical", entrySec: nowSec - 2 * 86400, nowSec }) === null);
ok("exit: credit -60% -> loss (stop tightened to -50% of the credit)", resolvePickOutcome({ modeledOptPnlPct: -60, structure: "credit_vertical", entrySec: nowSec - 2 * 86400, nowSec }).outcome === "loss");
ok("exit: credit -40% -> still open (above the -50% stop)", resolvePickOutcome({ modeledOptPnlPct: -40, structure: "credit_vertical", entrySec: nowSec - 2 * 86400, nowSec }) === null);
ok("exit: credit ignores a stray scale-out field", resolvePickOutcome({ modeledOptPnlPct: 55, scaledOutPnlPct: 22, structure: "credit_vertical", entrySec: nowSec - 2 * 86400, nowSec }).status === "hit-tp-prem");

// --- 12d. AI thesis layer (macro read feeds the gate + narrative ships) -----
// The everything-aware AI thesis, when supplied via opts.aiThesisMap, becomes the
// authority on the macro read (so it FEEDS the quality gate) and ships its
// summary/reasoning/invalidation on the card. Unmapped picks + keyless builds keep
// the deterministic read. (Network-free: we inject a fake map, never call Gemini.)
{
  const lead = healthyPicks[0];
  ok("ai-thesis: a baseline pick exists to test against", !!lead);
  if (lead) {
    const fakeAi = {
      summary: "Bullish on " + lead.symbol + " — momentum and fundamentals align.",
      reasoning: "Earnings momentum plus a supportive macro tape make the upside the path of least resistance into the window.",
      drivers: ["earnings momentum", "supportive tape"],
      macroSupport: "supports",
      macroRead: "The macro backdrop is a tailwind for this kind of name.",
      macroDrivers: ["risk-on tape"],
      invalidation: ["price breaks below the 50D SMA", "guidance is cut on the next print", "the macro tape flips risk-off"],
      confidence: "high",
    };
    const map = { [lead.symbol + ":" + lead.side]: fakeAi };
    const withAi = buildTopPicks(healthyUniverse, [], null, null, null, null, 0.045, { aiThesisMap: map });
    const p = withAi.find((x) => x.symbol === lead.symbol && x.side === lead.side);
    ok("ai-thesis: matching pick carries thesisCard.ai with the summary", !!(p && p.thesisCard.ai && p.thesisCard.ai.summary === fakeAi.summary));
    ok("ai-thesis: the marketRead is sourced from the AI read", !!(p && p.thesisCard.marketRead.source === "ai"));
    ok("ai-thesis: AI macroSupport feeds the marketRead support verdict", !!(p && p.thesisCard.marketRead.support === "supports"));
    ok("ai-thesis: AI invalidation replaces the deterministic triggers", !!(p && p.thesisCard.invalidators.some((iv) => iv.key === "thesis")));
    const other = withAi.find((x) => x.symbol !== lead.symbol);
    ok("ai-thesis: unmapped picks keep the deterministic read", other ? (other.thesisCard.marketRead.source === "deterministic" && !other.thesisCard.ai) : true);
  }
}
// generateAiTheses degrades gracefully: an empty universe returns an empty
// map+cache without ever touching the network.
{
  const gen = await generateAiTheses({ scored: [], regimeBand: "neutral" }, null, {}, {});
  ok("ai-thesis: generateAiTheses returns {map,cache} shape", gen && typeof gen.map === "object" && typeof gen.cache === "object");
  ok("ai-thesis: empty universe → no AI thesis generated", Object.keys(gen.map).length === 0 && Object.keys(gen.cache).length === 0);
}

// --- 12d-cap. Only the BEST PICKS_MAX_AI_THESES gate survivors get a thesis ----
// Many names can clear the data gate; only the top-N by deterministic conviction
// are sent to the AI grader (the rest ship deterministic-only). Verified through
// the cache-reuse path: prime a valid cached thesis for EVERY survivor, then
// assert only the top-N are reused into the map — the cap dropped the lower-
// conviction tail. AI_THESIS=0 forces keyless so a sig mismatch can never call out.
{
  const savedKeyless = process.env.AI_THESIS;
  process.env.AI_THESIS = "0";
  const N = PICKS_MAX_AI_THESES;
  const survivors = N + 4;                 // more gate-passers than the cap
  const scored = [], cache = {};
  for (let i = 0; i < survivors; i++) {
    const sym = "CAP" + i;
    const r = { sym, total: 4 + i, side: "call", drivers: [], timing: { state: "go" }, data: { spot: 100, fundamentals: {} } };
    scored.push(r);
    const sig = thesisCacheSig(r, "call", macroKindOf(sym, r.data), null);
    cache[sym + ":call"] = { sig, ai: { summary: "x", setup: "x", catalyst: "x", outlook: "x", macroSupport: "neutral", invalidation: ["a"], grade: "moderate", score: 50 } };
  }
  const cg = await generateAiTheses({ scored, regimeBand: "neutral" }, null, {}, cache);
  ok("ai-cap: exactly PICKS_MAX_AI_THESES survivors are graded", Object.keys(cg.map).length === N);
  ok("ai-cap: the lowest-conviction survivors are dropped from the AI review",
    scored.slice(0, survivors - N).every((r) => !((r.sym + ":call") in cg.map)));
  ok("ai-cap: the highest-conviction survivors are kept",
    scored.slice(survivors - N).every((r) => (r.sym + ":call") in cg.map));
  if (savedKeyless === undefined) delete process.env.AI_THESIS; else process.env.AI_THESIS = savedKeyless;
}

// --- 12d-final. AI is the FINAL GRADER (grade sets classification + veto) -----
// Once a name clears the deterministic data gate, the AI grade decides whether
// to ACT: 'reject' vetoes; the AI tier drives the execution matrix. The roster
// ORDER stays deterministic (owner directive) — the AI score is confidence only.
{
  const keyFor = (p) => p.symbol + ":" + p.side;
  // 1) reject → vetoed out of the roster (even though it cleared the data gate).
  {
    const tgt = healthyPicks[0];
    const map = { [keyFor(tgt)]: { summary: "x", setup: "x", catalyst: "x", outlook: "x", macroSupport: "neutral", invalidation: ["a"], grade: "reject", score: 5 } };
    const out = buildTopPicks(healthyUniverse, [], null, null, null, null, 0.045, { aiThesisMap: map });
    ok("ai-grade: a 'reject' grade vetoes the name out of the roster", !out.find((x) => keyFor(x) === keyFor(tgt)));
    ok("ai-grade: the veto is recorded in rosterMeta.aiVetoed", out.rosterMeta.aiVetoed.includes(tgt.symbol));
  }
  // 2) AI tier drives the matrix: a 'weak' grade → no strategy / watch group.
  {
    const tgt = healthyPicks[0];
    const map = { [keyFor(tgt)]: { summary: "x", setup: "x", catalyst: "x", outlook: "x", macroSupport: "neutral", invalidation: ["a"], grade: "weak", score: 30, gradeReason: "single-pillar, supports already priced in" } };
    const out = buildTopPicks(healthyUniverse, [], null, null, null, null, 0.045, { aiThesisMap: map });
    const p = out.find((x) => keyFor(x) === keyFor(tgt));
    ok("ai-grade: a 'weak' AI grade lands the pick in the watch group", !p || p.group !== "actionable");
    ok("ai-grade: a 'weak' AI grade recommends no strategy (no contract)", !p || !p.contract);
    ok("ai-grade: finalGrade reflects the AI tier + source", !p || (p.finalGrade && p.finalGrade.tier === "weak" && p.finalGrade.source === "ai" && p.finalGrade.score === 30));
  }
  // 3) The roster order is DETERMINISTIC — a 99 AI score on the lowest-conviction
  // name must NOT lift it over higher deterministic conviction (the AI is the
  // should-we-act check, never the ranker).
  {
    const last = healthyPicks[healthyPicks.length - 1];
    const map = {};
    for (const p of healthyPicks) map[keyFor(p)] = { summary: "x", setup: "x", catalyst: "x", outlook: "x", macroSupport: "supports", invalidation: ["a"], grade: "strong", score: keyFor(p) === keyFor(last) ? 99 : 60 };
    const out = buildTopPicks(healthyUniverse, [], null, null, null, null, 0.045, { aiThesisMap: map });
    const convOf = (p) => p.conviction ?? Math.abs(p.total ?? 0);
    ok("ai-grade: a high AI score does NOT re-rank the roster (order stays deterministic)",
      out.length > 1 ? keyFor(out[0]) !== keyFor(last) : true);
    ok("ai-grade: roster is ordered by deterministic conviction",
      out.every((p, i) => i === 0 || convOf(out[i - 1]) >= convOf(p)));
  }
  // 4) applyAiThesisGrade overlays the tier/score; absent a grade it's a no-op.
  {
    const det = { tier: "strong", score: 6, pillarsAligned: 3, checklist: [] };
    const overlaid = applyAiThesisGrade(det, { grade: "moderate", score: 55, gradeReason: "ok" });
    ok("ai-grade: applyAiThesisGrade overrides tier + carries score/reason", overlaid.tier === "moderate" && overlaid.aiGraded === true && overlaid.aiScore === 55 && overlaid.aiGradeReason === "ok");
    const passthru = applyAiThesisGrade(det, { grade: "reject" });
    ok("ai-grade: a non-{strong,moderate,weak} grade leaves the deterministic tier (reject handled upstream)", passthru.tier === "strong" && passthru.aiGraded === false);
    const none = applyAiThesisGrade(det, null);
    ok("ai-grade: no AI thesis → deterministic tier stands", none.tier === "strong" && none.aiGraded === false);
  }
}

// --- 12e. macro-sensitivity per kind (every name reads ITS OWN drivers) ------
// The deterministic market read must be directionally correct for each macro
// kind, not just consumer names — space reads risk-appetite + cost of capital,
// bonds read yields, long-vol is inverse to risk, energy reads crude, financials
// read the curve, gold reads real yields + the dollar.
{
  const reg = (state, ax) => ({ state, axes: Object.fromEntries(Object.entries(ax).map(([k, v]) => [k, { score: v.s, label: v.l }])) });
  const easing = { s: 1, l: "Long yields -10 bps — easing" }, rising = { s: -1, l: "Long yields +14 bps — rising" };
  const dovish = { s: 1, l: "Fed dovish" }, hawkish = { s: -1, l: "Fed hawkish +12pt" };
  const ixUp = { s: 1, l: "Indexes +1.2% — firm" }, ixDn = { s: -2, l: "Indexes -2.1% — broad sell-off" };
  const hotCPI = { s: -1, l: "CPI 3.8% re-accelerating" }, coolCPI = { s: 1, l: "CPI 2.1% near target" };
  const oilUp = { s: -2, l: "Crude +6.2% — supply/geopolitical shock" }, vixSpike = { s: -2, l: "VIX 31 — acute stress" };
  const weakUSD = { s: 1, l: "DXY -0.5% — dollar easing" };
  const supp = (sym, side, regime) => buildMarketRead(sym, {}, side, regime).support;

  ok("kind: macroKindOf maps space → spaceGrowth", macroKindOf("RKLB", {}) === "spaceGrowth");
  ok("kind: macroKindOf maps the ETFs/staples (TLT→bondProxy, SMH→semiconductors, UVXY→volLong, KWEB→china, WMT→consumerStaples)",
    macroKindOf("TLT", {}) === "bondProxy" && macroKindOf("SMH", {}) === "semiconductors" && macroKindOf("UVXY", {}) === "volLong" && macroKindOf("KWEB", {}) === "china" && macroKindOf("WMT", {}) === "consumerStaples");
  // the big buckets are split by genuine macro driver — no name shares a wrong one
  ok("kind: tech splits megacap/semis/software/aiInfra/enterprise",
    macroKindOf("AAPL", {}) === "megacapTech" && macroKindOf("AVGO", {}) === "semiconductors" && macroKindOf("CRM", {}) === "softwareGrowth" && macroKindOf("VRT", {}) === "aiInfra" && macroKindOf("DELL", {}) === "enterpriseTech");
  ok("kind: financials split banks/brokers/payments/assetManagers",
    macroKindOf("JPM", {}) === "banks" && macroKindOf("SCHW", {}) === "brokers" && macroKindOf("V", {}) === "payments" && macroKindOf("BX", {}) === "assetManagers");
  ok("kind: consumer splits goods/restaurants/media/services",
    macroKindOf("NKE", {}) === "consumerDiscretionaryGoods" && macroKindOf("MCD", {}) === "restaurants" && macroKindOf("DIS", {}) === "mediaEntertainment" && macroKindOf("ABNB", {}) === "consumerServices");
  ok("kind: healthcare splits pharma/insurers/devices",
    macroKindOf("LLY", {}) === "pharma" && macroKindOf("UNH", {}) === "healthInsurers" && macroKindOf("BSX", {}) === "medicalDevices");
  // software (pure duration) reacts to a yield move; cyclical semis (AVGO) barely
  ok("sensitivity: software is more yield-sensitive than semis",
    Math.abs(buildMarketRead("CRM", {}, "call", reg("neutral", { yields: rising })).dir) >= Math.abs(buildMarketRead("AVGO", {}, "call", reg("neutral", { yields: rising })).dir));
  ok("sensitivity: semis read the dollar (a strong dollar is a headwind for a call)",
    buildMarketRead("AVGO", {}, "call", reg("neutral", { dxy: { s: -1, l: "DXY +0.8% — dollar bid" } })).support === "against");
  ok("sensitivity: space call SUPPORTED by risk-on + dovish + easing", supp("RKLB", "call", reg("risk-on", { indexes: ixUp, fed: dovish, yields: easing })) === "supports");
  ok("sensitivity: space call AGAINST in risk-off + hawkish", supp("RKLB", "call", reg("risk-off", { indexes: ixDn, fed: hawkish, yields: rising })) === "against");
  ok("sensitivity: long-bond (TLT) call SUPPORTED by falling yields", supp("TLT", "call", reg("neutral", { yields: easing, fed: dovish })) === "supports");
  ok("sensitivity: long-bond (TLT) call AGAINST when yields rise", supp("TLT", "call", reg("neutral", { yields: rising, fed: hawkish })) === "against");
  ok("sensitivity: long-vol (UVXY) is INVERSE — call SUPPORTED by risk-off + VIX spike", supp("UVXY", "call", reg("risk-off", { vix: vixSpike, indexes: ixDn })) === "supports");
  ok("sensitivity: long-vol (UVXY) call AGAINST in a calm risk-on tape", supp("UVXY", "call", reg("risk-on", { indexes: ixUp })) === "against");
  ok("sensitivity: discretionary (NKE) call AGAINST hot inflation + rising yields", supp("NKE", "call", reg("neutral", { inflation: hotCPI, yields: rising, fed: hawkish })) === "against");
  ok("sensitivity: discretionary (NKE) call SUPPORTED by cooling inflation + easing", supp("NKE", "call", reg("neutral", { inflation: coolCPI, yields: easing, fed: dovish })) === "supports");
  ok("sensitivity: discretionary (NKE) PUT SUPPORTED by hot inflation + rising yields", supp("NKE", "put", reg("neutral", { inflation: hotCPI, yields: rising, fed: hawkish })) === "supports");
  ok("sensitivity: energy (XOM) call SUPPORTED by an oil spike", supp("XOM", "call", reg("neutral", { commodity: oilUp })) === "supports");
  ok("sensitivity: financials (JPM) call SUPPORTED by rising yields (NIM)", supp("JPM", "call", reg("neutral", { yields: rising, indexes: ixUp })) === "supports");
  ok("sensitivity: gold (GLD) call SUPPORTED by easing yields + a weak dollar", supp("GLD", "call", reg("neutral", { yields: easing, dxy: weakUSD, fed: dovish })) === "supports");
  ok("sensitivity: the AI macroSupport overrides the deterministic read", buildMarketRead("NKE", {}, "call", reg("neutral", { inflation: hotCPI }), { macroSupport: "supports", macroDrivers: ["X"] }).support === "supports" && buildMarketRead("NKE", {}, "call", reg("neutral", {}), { macroSupport: "supports" }).source === "ai");
}

// --- 13. strategy routing through the full engine (IV z-score → structure) ---
// mkTicker grades strongly bullish; the IV z-score then drives the structure.
function mkStratTicker(iv, z, pctile, over) { const t = mkTicker({ spot: 120, sector: "Software", ...(over || {}) }); t.chains = mkBsChain(120, iv); t.ivRank = { pctile, n: 120, z }; return t; }
const inDays = (n) => new Date(Date.now() + n * dayMs).toISOString().slice(0, 10);
const routeRich = buildTopPicks({ RICHIV: mkStratTicker(0.95, 2.6, 88) }, [], null, null, null, null, 0.045, {}).find((p) => p.symbol === "RICHIV");
const routeElevated = buildTopPicks({ ELEVIV: mkStratTicker(0.55, 1.6, 65) }, [], null, null, null, null, 0.045, {}).find((p) => p.symbol === "ELEVIV");
// Debit needs a non-elevated IV that ISN'T a naked candidate — force it by putting
// an earnings print in the window (blocks both naked and credit -> defined-risk debit).
const routeDebit = buildTopPicks({ DBTIV: mkStratTicker(0.45, 0.4, 45, { fundamentals: { nextEarningsDate: inDays(10) } }) }, [], null, null, null, null, 0.045, {}).find((p) => p.symbol === "DBTIV");
const routeNaked = buildTopPicks({ LOWIV: mkStratTicker(0.30, 0.0, 25) }, [], null, null, null, null, 0.045, {}).find((p) => p.symbol === "LOWIV");
ok("route: rich IV (z≥2) → credit vertical (highly elevated — sells premium)", routeRich && routeRich.strategy.type === "credit" && routeRich.contract.structure === "credit_vertical" && routeRich.contract.optionType === "put");
ok("route: ELEVATED IV (z≥1.5 / ≥60th pctile) → credit vertical (broadened band)", routeElevated && routeElevated.strategy.type === "credit" && routeElevated.contract.structure === "credit_vertical");
ok("route: low IV + imminent earnings → debit vertical (defined-risk, no naked/credit)", routeDebit && routeDebit.strategy.type === "debit" && routeDebit.contract.structure === "debit_vertical");
ok("route: strong + reasonable IV + strong thesis → naked long", routeNaked && Math.abs(routeNaked.total) >= PICKS_TIER_STRONG && routeNaked.strategy.type === "long" && routeNaked.contract.structure === "long");
ok("route: low IV never sells a credit spread", routeNaked && routeNaked.strategy.type !== "credit");
ok("route: a naked-long pick is always strong-tier", [routeRich, routeElevated, routeDebit, routeNaked].filter(Boolean).filter((p) => p.strategy.type === "long").every((p) => Math.abs(p.total) >= PICKS_TIER_STRONG));
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

// --- 15. earnings-history backfill helpers (guidance from transcripts + IV-crush move) ---
ok("guid: raises only → raised", transcriptGuidanceDirection([{ metric: "Revenue", value: "$1B", change: "raised" }, { metric: "EPS", value: "$2", change: "maintained" }]) === "raised");
ok("guid: cut only → lowered", transcriptGuidanceDirection([{ metric: "FY EPS", value: "$2", change: "lowered" }]) === "lowered");
ok("guid: withdrawn counts as a cut", transcriptGuidanceDirection([{ metric: "FY rev", value: "n/a", change: "withdrawn" }]) === "lowered");
ok("guid: raised AND cut → inline (mixed)", transcriptGuidanceDirection([{ metric: "Rev", value: "$1B", change: "raised" }, { metric: "EPS", value: "$2", change: "lowered" }]) === "inline");
ok("guid: maintained only → inline", transcriptGuidanceDirection([{ metric: "FY", value: "$4", change: "maintained" }]) === "inline");
ok("guid: first-time (new) guidance alone → null", transcriptGuidanceDirection([{ metric: "FY26", value: "$5", change: "new" }]) === null);
ok("guid: empty / missing rows → null", transcriptGuidanceDirection([]) === null && transcriptGuidanceDirection(null) === null);
// IV crush: 0.55 → 0.40 should reconstruct a high-single-digit expected move.
const crushEst = impliedMoveFromIvCrush(0.55, 0.40);
ok("crush: 55→40 vol reconstructs ~10% move", crushEst > 0.08 && crushEst < 0.13);
ok("crush: no crush (post ≥ pre) → null", impliedMoveFromIvCrush(0.40, 0.40) === null && impliedMoveFromIvCrush(0.40, 0.55) === null);
ok("crush: missing sides → null", impliedMoveFromIvCrush(null, 0.4) === null && impliedMoveFromIvCrush(0.5, null) === null);
ok("crush: implausibly tiny diff → null", impliedMoveFromIvCrush(0.30001, 0.3) === null);

// --- 16. daily DCA dial (VOO/QQQ sizing — buildDcaPlan) ---
// Steady uptrend → the baseline 1×, never a skip.
const dcaUp = Array.from({ length: 300 }, (_, i) => 100 * Math.pow(1.0008, i));
const dcaPlanUp = buildDcaPlan(
  { VOO: { closes: dcaUp, spot: dcaUp[dcaUp.length - 1] * 1.001, asOf: "2026-07-16" }, QQQ: { closes: dcaUp, spot: dcaUp[dcaUp.length - 1] * 1.001, asOf: "2026-07-16" } },
  null, "2026-07-16T14:00:00.000Z",
);
ok("dca: uptrend → 1× baseline on both indexes", dcaPlanUp.indexes.length === 2 && dcaPlanUp.indexes.every((x) => x.multiplier === 1 && x.amountUsd === DCA_BASE_USD));
ok("dca: today's history row written with both calls", dcaPlanUp.history.length === 1 && dcaPlanUp.history[0].calls.VOO && dcaPlanUp.history[0].calls.QQQ);
// Bear-market pricing — ramp then a −20% slide plus a red day → the 4× tier.
const dcaCrash = [];
for (let i = 0; i < 260; i++) dcaCrash.push(100 * Math.pow(1.001, i));
const dcaPeak = dcaCrash[dcaCrash.length - 1];
for (let i = 1; i <= 40; i++) dcaCrash.push(dcaPeak * (1 - 0.005 * i));
const dcaCrashSpot = dcaCrash[dcaCrash.length - 1] * 0.98;
const dcaPlanDown = buildDcaPlan(
  { VOO: { closes: dcaCrash, spot: dcaCrashSpot, asOf: "2026-07-16" }, QQQ: { closes: dcaCrash, spot: dcaCrashSpot, asOf: "2026-07-16" } },
  dcaPlanUp, "2026-07-16T15:00:00.000Z",
);
ok("dca: bear-market slide → the 4× deep-discount tier", dcaPlanDown.indexes.every((x) => x.multiplier === 4 && x.tier.key === "max"));
ok("dca: same-ET-day history row upserted, not appended", dcaPlanDown.history.length === 1);
// Structural gate on the 4× tier: a fast −22% slide off a recent blow-off top
// that never breaks the (much lower) 200-day average can score 12 points, but
// it is NOT bear-market pricing — it must ship the 3× correction tier, and
// the "long-term trend broken" note must not render.
const dcaSpike = [];
for (let i = 0; i < 260; i++) dcaSpike.push(100);            // long flat base keeps the 200D low
for (let i = 1; i <= 20; i++) dcaSpike.push(100 + 3 * i);     // blow-off rally to 160
for (let i = 1; i <= 20; i++) dcaSpike.push(160 - 1.6 * i);   // fast slide to 128
const dcaSpikeSpot = dcaSpike[dcaSpike.length - 1] * 0.975;   // red day, dd ≈ 22%
const dcaPlanSpike = buildDcaPlan(
  { VOO: { closes: dcaSpike, spot: dcaSpikeSpot, asOf: "2026-07-16" }, QQQ: { closes: dcaSpike, spot: dcaSpikeSpot, asOf: "2026-07-16" } },
  null, "2026-07-16T15:00:00.000Z",
);
ok("dca: deep slide still above the 200D → capped at the 3× tier (max-tier gate)",
  dcaPlanSpike.indexes.every((x) => x.points >= 12 && x.sma.d200 > 0 && x.multiplier === 3 && x.tier.key === "heavy"));
ok("dca: every read ships label + pts on the card", dcaPlanDown.indexes[0].reads.length === 5 && dcaPlanDown.indexes[0].reads.every((r) => r.label && Number.isFinite(r.pts)));
// A missing symbol carries its prior entry forward stale; today's history row
// keeps the earlier build's fresh call (merge, not replace).
const dcaPlanMiss = buildDcaPlan(
  { QQQ: { closes: dcaUp, spot: dcaUp[dcaUp.length - 1], asOf: "2026-07-16" } },
  dcaPlanDown, "2026-07-16T16:00:00.000Z",
);
const dcaVooStale = dcaPlanMiss.indexes.find((x) => x.symbol === "VOO");
ok("dca: missing bars → prior entry carried stale-marked", dcaVooStale && dcaVooStale.stale === true && dcaVooStale.multiplier === 4);
const dcaLastRow = dcaPlanMiss.history[dcaPlanMiss.history.length - 1];
ok("dca: history merge keeps the earlier fresh call for the missed symbol", dcaLastRow.calls.QQQ && dcaLastRow.calls.QQQ.m === 1 && dcaLastRow.calls.VOO && dcaLastRow.calls.VOO.m === 4);
// No inputs at all → everything carried stale, history untouched.
const dcaPlanNone = buildDcaPlan({}, dcaPlanDown, "2026-07-16T17:00:00.000Z");
ok("dca: no inputs → all entries stale, history unchanged", dcaPlanNone.indexes.every((x) => x.stale) && JSON.stringify(dcaPlanNone.history) === JSON.stringify(dcaPlanDown.history));

console.log(`\n${pass}/${pass + fail} checks passed.`);
process.exit(fail ? 1 : 0);
