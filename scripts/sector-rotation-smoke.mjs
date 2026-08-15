// Offline deterministic contract checks for the Sector Rotation recovery
// profile. These fixtures isolate company-quality and recovery eligibility from
// the separate peer-washout, mean-reversion, and live-entry calculations.
import assert from "node:assert/strict";
import {
  buildSectorRotationRebounds,
  buildSectorRotationRecoveryProfile,
  compareSectorRotationCandidates,
  reconcileSectorRotationLog,
  selectBalancedSectorRotationCandidates,
} from "./build.mjs";

const NOW = "2026-08-15T16:00:00.000Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseData() {
  return {
    spot: 70,
    fundamentals: {
      name: "Recovery Test Company",
      sector: "Technology",
      marketCap: 20_000_000_000,
      fiftyTwoWeekHigh: 100,
      forwardPE: 15,
      pegRatio: 1.1,
      profitMargin: 18,
      freeCashFlow: 1_200_000_000,
      fcfHistory: [
        { date: "2025-09-30", value: 240_000_000 },
        { date: "2025-12-31", value: 275_000_000 },
        { date: "2026-03-31", value: 310_000_000 },
        { date: "2026-06-30", value: 375_000_000 },
      ],
      totalCash: 3_000_000_000,
      totalDebt: 1_000_000_000,
      debtToEquity: 45,
      revenueGrowthYoy: 14,
      netMarginHistory: [
        { date: "2025-06-30", value: 12 },
        { date: "2025-09-30", value: 13 },
        { date: "2025-12-31", value: 14 },
        { date: "2026-03-31", value: 15 },
        { date: "2026-06-30", value: 18 },
      ],
      analystRevisions: { upgrades: 3, downgrades: 0, net: 3 },
      judgment: { verdict: "strong" },
    },
    aiSignals: {
      guidance: { direction: "raised" },
      majorContract: { status: "won" },
    },
    news: {
      sentiment: "neutral",
      builtAt: NOW,
      headlines: [],
    },
  };
}

function baseGrade() {
  return {
    pillars: {
      fundamentals: {
        score: 5,
        trajectory: {
          dir: "improving",
          confidence: "high",
          reason: "Guidance raised; net analyst upgrades",
          inputs: 4,
        },
        signals: [
          { key: "guidance", score: 3, contribution: 3, value: "raised", available: true },
          { key: "fcf", score: 1, contribution: 1, value: "positive", available: true },
          { key: "netMargin", score: 1, contribution: 1, value: "+6pp", available: true },
          { key: "trajectory", score: 2, contribution: 2, value: "improving", available: true },
        ],
      },
    },
  };
}

function profile(data = baseData(), grade = baseGrade()) {
  return buildSectorRotationRecoveryProfile(data, grade, NOW, {
    peerForwardPE: 22,
    peerForwardPEN: 8,
    groupKey: "test-group",
    financialSector: false,
  });
}

function statusOf(result) {
  return String(result?.status || result?.state || result?.disposition || "");
}

function assertStatus(result, expected, message) {
  assert.equal(statusOf(result), expected, message);
}

{
  const result = profile();
  assertStatus(result, "qualified-improving", "fully covered improving fundamentals must qualify as improving");
  assert.equal(result.coverage?.complete, true, "the improving fixture must exercise complete core coverage");
  assert.equal(result.trajectory?.dir, "improving");
  assert.ok(result.forward?.positiveEvidence?.length > 0, "qualification needs a positive forward driver");
}

{
  const grade = baseGrade();
  grade.pillars.fundamentals.trajectory = {
    dir: "steady",
    confidence: "medium",
    reason: "Durable fundamentals with mixed acceleration signals",
    inputs: 3,
  };
  assertStatus(profile(baseData(), grade), "qualified-durable",
    "complete durable quality with a real positive driver must qualify exactly as durable");
}

{
  const data = baseData();
  delete data.fundamentals.totalCash;
  delete data.fundamentals.totalDebt;
  delete data.fundamentals.debtToEquity;
  const result = profile(data);
  assertStatus(result, "verify-first", "missing core balance-sheet coverage must remain unverified");
  assert.equal(result.coverage?.complete, false);
}

{
  const data = baseData();
  delete data.fundamentals.profitMargin;
  const result = profile(data);
  assertStatus(result, "verify-first", "missing profitability must remain a visible verify-first case");
  assert.equal(result.coverage?.complete, false);
  assert.ok(result.coverage?.missing?.includes("profitability"), "missing profitability must stay explicit in recovery coverage");
}

{
  const data = baseData();
  delete data.fundamentals.totalCash;
  delete data.fundamentals.totalDebt;
  data.fundamentals.debtToEquity = -50;
  const result = profile(data);
  assert.doesNotMatch(statusOf(result), /^qualified(?:-|$)/, "negative equity must not make a negative debt/equity ratio look healthy");
}

{
  const grade = baseGrade();
  grade.pillars.fundamentals.trajectory = {
    dir: "steady",
    confidence: "low",
    reason: "Not enough forward signal",
    inputs: 0,
  };
  grade.pillars.fundamentals.signals = grade.pillars.fundamentals.signals.filter((row) => row.key !== "guidance" && row.key !== "trajectory");
  const data = baseData();
  delete data.aiSignals;
  data.fundamentals.analystRevisions = { upgrades: 0, downgrades: 0, net: 0 };
  assertStatus(profile(data, grade), "verify-first", "low-confidence trajectory without forward evidence must not qualify");
}

{
  const grade = baseGrade();
  grade.pillars.fundamentals.trajectory = {
    dir: "declining",
    confidence: "low",
    reason: "One weak forward input",
    inputs: 1,
  };
  assertStatus(profile(baseData(), grade), "verify-first", "a low-confidence decline is incomplete evidence, not a known failure");
}

{
  const grade = baseGrade();
  grade.pillars.fundamentals.trajectory = {
    dir: "steady",
    confidence: "medium",
    reason: "Mixed forward signals",
    inputs: 3,
  };
  grade.pillars.fundamentals.signals = grade.pillars.fundamentals.signals.filter((row) => row.key !== "guidance" && row.key !== "trajectory");
  const data = baseData();
  delete data.aiSignals;
  data.fundamentals.analystRevisions = { upgrades: 0, downgrades: 0, net: 0 };
  assertStatus(profile(data, grade), "verify-first", "fresh evidence without a positive forward driver must remain verify-first");
}

for (const confidence of ["medium", "high"]) {
  const grade = baseGrade();
  grade.pillars.fundamentals.trajectory = {
    dir: "declining",
    confidence,
    reason: "Guidance lowered; estimates falling",
    inputs: 4,
  };
  assertStatus(profile(baseData(), grade), "reject", `${confidence}-confidence declining trajectory must reject`);
}

{
  const data = baseData();
  data.spot = 90;
  data.fundamentals.fiftyTwoWeekHigh = 100;
  assertStatus(profile(data), "reject", "a known drawdown smaller than 15% must reject");
}

{
  const data = baseData();
  delete data.fundamentals.fiftyTwoWeekHigh;
  assertStatus(profile(data), "verify-first", "a missing 52-week high must remain unverified rather than imply a drawdown");
}

{
  const data = baseData();
  data.news.builtAt = "2026-08-10T16:00:00.000Z";
  assertStatus(profile(data), "verify-first", "stale company-news evidence must not qualify");
}

{
  const data = baseData();
  delete data.news;
  assertStatus(profile(data), "verify-first", "unverified company news must not qualify");
}

{
  const data = baseData();
  data.fundamentals.freeCashFlow = -250_000_000;
  const result = profile(data);
  assert.doesNotMatch(statusOf(result), /^qualified(?:-|$)/, "negative free cash flow cannot masquerade as verified quality");
}

{
  const data = baseData();
  data.fundamentals.totalCash = 1_000_000_000;
  data.fundamentals.totalDebt = 3_000_000_000;
  delete data.fundamentals.debtToEquity;
  const result = profile(data);
  assertStatus(result, "verify-first", "net debt without a usable leverage ratio must remain incomplete, not fail");
  assert.equal(result.quality.balanceSheetStatus, "net-debt-unrated");
}

{
  const data = baseData();
  delete data.news.sentiment;
  assertStatus(profile(data), "verify-first", "a current but polarity-unknown news payload must remain unverified");
}

{
  const data = baseData();
  delete data.aiSignals;
  data.fundamentals.analystRevisions = { upgrades: 0, downgrades: 0, net: 0 };
  data.catalysts = [{ date: "2026-09-15", title: "Investor day", category: "other", confidence: "high" }];
  const grade = baseGrade();
  grade.pillars.fundamentals.trajectory = {
    dir: "steady",
    confidence: "medium",
    reason: "Mixed forward signals",
    inputs: 3,
  };
  const result = profile(data, grade);
  assertStatus(result, "verify-first", "a polarity-free calendar catalyst must not manufacture a recovery driver");
  assert.equal(result.forward.positiveEvidence.length, 0);
}

{
  const data = baseData();
  data.aiSignals = { guidance: { direction: "inline" }, majorContract: { status: "none" } };
  data.fundamentals.analystRevisions = { upgrades: 0, downgrades: 0, net: 0 };
  const grade = baseGrade();
  grade.pillars.fundamentals.trajectory = {
    dir: "steady",
    confidence: "medium",
    reason: "Guidance maintained with otherwise mixed signals",
    inputs: 3,
  };
  const result = profile(data, grade);
  assertStatus(result, "verify-first", "inline guidance alone is maintenance, not a positive recovery driver");
  assert.equal(result.forward.positiveEvidence.length, 0);
  assert.ok(result.warnings.some((row) => row.key === "no-positive-forward-driver"));
}

{
  const rows = [
    { symbol: "PASS", score: 99, phase: "confirmed", plan: { state: "pass" }, recoveryProfile: { status: "qualified-improving" } },
    { symbol: "WAIT", score: 60, phase: "first-thrust", plan: { state: "wait-pullback" }, recoveryProfile: { status: "qualified-improving" } },
    { symbol: "READY", score: 55, phase: "washed-out", plan: { state: "ready" }, recoveryProfile: { status: "qualified-improving" } },
  ].sort(compareSectorRotationCandidates);
  assert.deepEqual(rows.map((row) => row.symbol), ["READY", "WAIT", "PASS"],
    "execution state must outrank phase and score inside the same recovery status");
}

const candidates = [
  { symbol: "A1", group: { key: "alpha" }, score: 99 },
  { symbol: "A2", group: { key: "alpha" }, score: 98 },
  { symbol: "A3", group: { key: "alpha" }, score: 97 },
  { symbol: "B1", group: { key: "beta" }, score: 80 },
  { symbol: "C1", group: { key: "gamma" }, score: 70 },
];
const selected = selectBalancedSectorRotationCandidates(clone(candidates), 4);
const symbols = selected.map((row) => row.symbol);
assert.deepEqual(symbols.slice(0, 3), ["A1", "B1", "C1"], "balanced selection must represent each group before filling from the global order");
assert.equal(symbols[3], "A2", "remaining slots must return to the strongest unselected candidate");
const capped = selectBalancedSectorRotationCandidates(clone(candidates), 5, { maxPerGroup: 2 });
assert.deepEqual(capped.map((row) => row.symbol), ["A1", "B1", "C1", "A2"],
  "a two-per-group cap must omit the third alpha row even when total capacity remains");
assert.equal(capped.some((row) => row.symbol === "A3"), false);

{
  const symbols = ["AAPL", "MSFT", "AMZN", "GOOGL"];
  const start = Date.parse("2026-03-01T12:00:00Z");
  const dates = Array.from({ length: 160 }, (_, index) => new Date(start + index * 86400000))
    .filter((date) => ![0, 6].includes(date.getUTCDay()))
    .slice(0, 100)
    .map((date) => date.toISOString().slice(0, 10));
  const washedOutCloses = () => dates.map((_, index) => index < 92 ? 80 + index * 0.22
    : index === 92 ? 100 : index === 93 ? 94 : index === 94 ? 88
      : index === 95 ? 79 : index === 96 ? 70 : 72 + (index - 97) * 1.5);
  const tickerData = (symbol, closes) => ({
    spot: closes[closes.length - 1],
    quoteAsOf: dates[dates.length - 1],
    priceSeries: {
      t: dates,
      c: closes,
      h: closes.map((value) => value * 1.01),
      l: closes.map((value) => value * 0.99),
      v: closes.map(() => 1_000_000),
    },
    technicals: { rsi: 46, rsi5d: 38, sma: { sma20: 78, sma50: 88, sma200: 82 }, volume: { rvol: 1.2 } },
    fundamentals: {
      name: symbol,
      marketCap: 100_000_000_000,
      fiftyTwoWeekHigh: 100,
      forwardPE: 15,
      profitMargin: 15,
      freeCashFlow: 10_000_000_000,
      fcfHistory: [1, 2, 3, 4].map((value, index) => ({ date: String(index), value: value * 1_000_000_000 })),
      totalCash: 30_000_000_000,
      totalDebt: 10_000_000_000,
      debtToEquity: 40,
      revenueGrowthYoy: 8,
      netMarginHistory: [{ value: 12 }, { value: 15 }],
      analystRevisions: { net: 2 },
      judgment: { verdict: "strong" },
    },
    aiSignals: { guidance: { direction: "raised" } },
    news: { sentiment: "neutral", builtAt: NOW, headlines: [] },
  });
  const chains = Object.fromEntries(symbols.map((symbol) => [symbol, tickerData(symbol, washedOutCloses())]));
  chains.SPY = tickerData("SPY", dates.map((_, index) => 100 + index * 0.05));
  delete chains.AAPL.fundamentals.profitMargin;
  delete chains.AAPL.fundamentals.freeCashFlow;
  delete chains.AAPL.fundamentals.fcfHistory;
  const grades = Object.fromEntries(symbols.map((symbol) => [symbol, {
    pillars: { fundamentals: { score: 5, trajectory: { dir: "improving", confidence: "high", reason: "Guidance raised", inputs: 4 } } },
  }]));
  const payload = buildSectorRotationRebounds(chains, grades, NOW, { appendAsOfRow: false });
  const aapl = payload.candidates.find((row) => row.symbol === "AAPL");
  assert.ok(aapl, "a high-scoring incomplete-quality name should remain on the research board");
  assert.equal(aapl.recoveryProfile.status, "verify-first");
  assert.equal(aapl.plan.state, "research");
  assert.ok(aapl.blockedBy.includes("quality"), "the legacy quality failure remains visible for audit");
}

{
  const v2OpenKey = "2|AAPL|mega-tech|2026-08-01";
  const priorV2 = {
    resetEpoch: "rotation-v2-record-v1",
    recordVersion: 1,
    modelVersion: 2,
    pending: [{ signalKey: "2|MSFT|mega-tech|2026-08-01", symbol: "MSFT", modelVersion: 2, recordVersion: 1, active: true }],
    open: [{
      signalKey: v2OpenKey,
      symbol: "AAPL",
      modelVersion: 2,
      recordVersion: 1,
      status: "open",
      openedIso: "2026-08-14T16:00:00.000Z",
      openedDate: "2026-08-14",
      lastDate: "2026-08-14",
      entryPx: 100,
      invalidation: 90,
      target1: 120,
      maxPx: 101,
      minPx: 99,
      sessionsHeld: 0,
    }],
    closed: [{
      signalKey: "2|MSFT|mega-tech|2026-07-01",
      symbol: "MSFT",
      modelVersion: 2,
      recordVersion: 1,
      status: "closed",
      outcome: "target",
      entryPx: 100,
      invalidation: 90,
      target1: 120,
      exitPx: 120,
    }],
  };
  const tracked = (symbol, closes, highs) => ({
    spot: closes[closes.length - 1],
    quoteAsOf: "2026-08-15",
    marketState: "REGULAR",
    _bars: [
      { t: "2026-08-14", o: 100, c: closes[0], h: highs[0], l: 99, v: 1_000_000 },
      { t: "2026-08-15", o: 100, c: closes[1], h: highs[1], l: 100, v: 1_000_000 },
    ],
    fundamentals: { name: symbol },
  });
  const payload = {
    modelVersion: 3,
    dataAsOfDate: "2026-08-15",
    candidates: [{
      signalKey: "3|AAPL|mega-tech|2026-08-01",
      symbol: "AAPL",
      name: "Apple",
      group: { key: "mega-tech" },
      phase: "confirmed",
      score: 90,
      spot: 121,
      plan: { state: "ready", invalidation: 110, target1: 140, trigger: 121, entryZone: [120, 122], liveRewardRisk: 1.7 },
    }],
  };
  const { log, record } = reconcileSectorRotationLog(payload, priorV2, {
    AAPL: tracked("AAPL", [100, 121], [101, 121]),
    SPY: tracked("SPY", [100, 101], [101, 102]),
  }, NOW, {
    AAPL: { price: 121, asOfIso: NOW, marketState: "REGULAR" },
  });
  assert.equal(log.modelVersion, 3);
  assert.equal(log.pending.length, 0, "v2 pending observations must be dropped during migration");
  assert.equal(log.open.length, 0, "the v2 open row should continue through its real target exit");
  assert.equal(log.closed.filter((row) => row.modelVersion === 2).length, 2, "prior and newly resolved v2 rows must remain in raw history");
  assert.equal(log.closed.some((row) => row.signalKey === v2OpenKey && row.outcome === "target"), true);
  assert.equal(log.open.some((row) => row.modelVersion === 3), false, "a v2 open symbol must not re-enter v3 in the same reconciliation");
  assert.equal(record.modelVersion, 3);
  assert.equal(record.summary.openCount, 0);
  assert.equal(record.summary.closedCount, 0, "browser metrics must exclude retained v2 outcomes");
  assert.deepEqual(record.closedRecent, []);
}

console.log("sector rotation recovery-profile smoke test passed");
