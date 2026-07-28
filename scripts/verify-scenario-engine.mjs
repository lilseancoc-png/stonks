// Synthetic verification for lib/scenario-engine.mjs.
// Read-only by default; --write-ui-fixture emits a gitignored local payload for browser QA.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { buildScenarioEngine } from "../lib/scenario-engine.mjs";

const AXES = [
  "indexes", "vix", "dxy", "yields", "fed", "commodity", "geo", "inflation",
  "sentiment", "globalTape", "twoY", "bondVol", "breadth", "putCall", "credit", "rotation",
];

function priceSeries(start, dailyMoves) {
  const t = [], c = [];
  let value = start;
  for (let i = 0; i < dailyMoves.length; i++) {
    const d = new Date(Date.UTC(2026, 4, 1 + i));
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    value *= 1 + dailyMoves[i] / 100;
    t.push(d.toISOString().slice(0, 10));
    c.push(Math.round(value * 100) / 100);
  }
  return { t, c };
}

const moves = Array.from({ length: 70 }, (_, i) => Math.sin(i / 4) * 0.5 + (i % 9 === 0 ? -0.8 : 0.2));
const chains = {
  SPY: { priceSeries: priceSeries(600, moves), technicals: { volRegime: { rv30: 0.16 } }, fundamentals: { name: "SPY" } },
  USO: { priceSeries: priceSeries(80, moves.map((x, i) => x * 0.4 + Math.cos(i / 3))), technicals: { volRegime: { rv30: 0.3 } }, fundamentals: { name: "USO" } },
  NVDA: { priceSeries: priceSeries(180, moves.map((x, i) => 1.8 * x + Math.sin(i) * 0.5)), technicals: { volRegime: { rv30: 0.42 } }, fundamentals: { name: "NVIDIA", beta: 1.8 } },
  WMT: { priceSeries: priceSeries(100, moves.map((x) => -0.1 * x + 0.05)), technicals: { volRegime: { rv30: 0.18 } }, fundamentals: { name: "Walmart", beta: 0.4 } },
  GD: { priceSeries: priceSeries(300, moves.map((x) => 0.2 * x)), technicals: { volRegime: { rv30: 0.2 } }, fundamentals: { name: "General Dynamics", beta: 0.6 } },
};

const currentScores = {
  indexes: 0, vix: -1, dxy: -1, yields: -1, fed: 0, commodity: -1, geo: 0,
  inflation: 0, sentiment: 1, globalTape: 0, twoY: -1, bondVol: -1,
  breadth: -1, putCall: 1, credit: -1, rotation: -1,
};
const regime = {
  state: "neutral",
  stress: -4,
  axes: Object.fromEntries(AXES.map((key) => [key, { score: currentScores[key], label: `${key} fixture` }])),
};
const regimeHistory = {
  days: Array.from({ length: 6 }, (_, i) => ({
    date: `2026-07-${String(21 + i).padStart(2, "0")}`,
    state: "neutral",
    stress: -i / 2,
    axisScores: Object.fromEntries(AXES.map((key) => [key, i < 5 ? Math.min(2, currentScores[key] + 1) : currentScores[key]])),
  })),
};
const macroHistory = {
  entries: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    twoY: 4.2 - i * 0.006,
    tenY: 4.35 + i * 0.004,
    dxy: 100 + i * 0.03,
    vix: 16 + i * 0.08,
  })),
};
const calendar = {
  events: [
    { type: "fomc", date: "2026-07-29", time: "14:00 ET", title: "FOMC rate decision", source: "Federal Reserve" },
    { type: "report", subtype: "CPI YoY", date: "2026-07-30", title: "CPI YoY", source: "BLS" },
    { type: "earnings", date: "2026-07-31", symbol: "NVDA", session: "PM", title: "NVDA earnings", source: "Yahoo Finance" },
  ],
};
const kind = { SPY: "broad", USO: "energy", NVDA: "semiconductors", WMT: "consumerStaples", GD: "defense" };
const profiles = {
  broad: { axes: [{ key: "indexes", w: 1 }] },
  energy: { axes: [] },
  semiconductors: { axes: [{ key: "indexes", w: 0.6 }, { key: "yields", w: 0.3 }, { key: "dxy", w: 0.7 }] },
  consumerStaples: { axes: [{ key: "yields", w: 0.3 }] },
  defense: { axes: [] },
};

const out = buildScenarioEngine({
  builtAtIso: "2026-07-28T15:00:00Z",
  asOfDate: "2026-07-28",
  chains,
  macroBackdrop: {
    vixTerm: { state: "backwardation", ratio: 1.05 },
    credit: { oasChg5d: 0.22 },
  },
  macroRegime: regime,
  regimeHistory,
  macroHistory,
  calendar,
  sectors: { SPY: "ETF", USO: "ETF", NVDA: "Semis", WMT: "Retail", GD: "Defense" },
  kindOf: (symbol) => kind[symbol] || "broad",
  profiles,
  spilloverMatrix: { pairs: [{ leader: "MSFT", follower: "NVDA", bShrunk: 0.72 }] },
});

assert.equal(out.scenarios.length, 5, "rotating scenario set");
assert.equal(out.scenarios.reduce((sum, row) => sum + row.probability.mid, 0), 100, "scenario probability midpoints sum to 100");
assert.ok(out.scenarios.every((row) => row.paths.length === 3), "every driver has stress/base/alternate paths");
assert.equal(Object.keys(out.transition.axisVelocity).length, 16, "all 16 axes carry velocity");
assert.equal(out.transition.fragility.state, "fragile", "synthetic warning cluster is fragile");
assert.ok(out.transition.probabilities.riskOffShiftPct >= 50, "risk-off transition estimate responds to deterioration");
assert.ok(out.decision.grossMultiplier < 1, "fragility produces a gross cap");
assert.equal(out.catalysts[0].importance, 5, "FOMC is top importance");
assert.ok(out.catalysts.some((row) => row.symbol === "NVDA" && row.channels.includes("event spillover")), "stock event keeps spillover channel");
assert.equal(out.sensitivities.length, 5, "ticker sensitivity vector for every instrument");
assert.ok(out.sensitivities.every((row) => Object.keys(row.scenarios).length === 5), "every ticker maps to every active scenario");
assert.ok(out.scenarios.some((row) => row.key === "ai-capex-cycle"), "AI CapEx scenario rotates in around a major AI event");
const nvda = out.sensitivities.find((row) => row.symbol === "NVDA");
const wmt = out.sensitivities.find((row) => row.symbol === "WMT");
assert.equal(nvda.vector.aiCapex.value, 1, "AI exposure map applied");
assert.equal(nvda.vector.eventSpillover.value, 0.72, "Event Spillover strength applied");
assert.ok(wmt.vector.growthDefensive.value < 0, "defensive profile applied");
assert.ok(nvda.decision.sizeMultiplier <= 1 && nvda.decision.sizeMultiplier >= 0.5, "per-name size overlay is bounded");

if (process.argv.includes("--write-ui-fixture")) {
  await writeFile(
    new URL("../data/market-analysis.json", import.meta.url),
    JSON.stringify({ builtAtIso: "2026-07-28T15:00:00Z", macroRegime: regime, scenarioEngine: out }, null, 2) + "\n",
  );
}

console.log(
  `scenario-engine verification passed: ${out.scenarios.length} scenarios, ` +
  `${out.catalysts.length} catalysts, ${out.sensitivities.length} sensitivities, ` +
  `risk-off ${out.transition.probabilities.riskOffShiftPct}%, gross ${out.decision.grossMultiplier}x`,
);
