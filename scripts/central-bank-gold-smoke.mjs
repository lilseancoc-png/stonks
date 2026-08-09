import assert from "node:assert/strict";
import {
  buildCentralBankGoldPayload,
  discoverLatestGoldDemandReport,
  parseGoldDemandChartScript,
  parseGoldHoldingsChart,
} from "../lib/central-bank-gold.mjs";

const cell = (val, rowId) => ({ val, rowId });
const row = (id, country, tonnes, share = 10) => [
  cell(country, id), cell("Test region", id), cell("High income", id),
  cell("100", id), cell("200", id), cell(tonnes, id), cell("100", id), cell(share, id),
];
const holdingsFixture = {
  options: { minDateAvailable: "2024-12-31", maxDateAvailable: "2026-03-31" },
  table: { QTD_FULL: {
    "2026-03-31": { rows: [row("AAA", "Alpha", "AWAITED"), row("BBB", "Beta", "150", "40")] },
    "2025-12-31": { rows: [row("AAA", "Alpha", "100", "20"), row("BBB", "Beta", "125", "35")] },
    "2025-09-30": { rows: [row("AAA", "Alpha", "80", "18"), row("BBB", "Beta", "100", "30")] },
    "2024-12-31": { rows: [row("AAA", "Alpha", "50", "12"), row("BBB", "Beta", "75", "25")] },
  } },
};

// Pad coverage to the production parser's fail-closed minimum.
for (let i = 0; i < 60; i++) {
  const id = `X${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
  for (const snapshot of Object.values(holdingsFixture.table.QTD_FULL)) snapshot.rows.push(row(id, `Country ${i}`, String(10 + i)));
}

const holdings = parseGoldHoldingsChart(holdingsFixture);
const alpha = holdings.countries.find((country) => country.iso3 === "AAA");
const beta = holdings.countries.find((country) => country.iso3 === "BBB");
assert.equal(alpha.dataAsOf, "2025-12-31", "AWAITED must not become a fake latest report");
assert.equal(alpha.change3mTonnes, 20);
assert.equal(alpha.change12mTonnes, 50);
assert.equal(beta.dataAsOf, "2026-03-31");
assert.equal(beta.change3mPct, 20);

const latest = discoverLatestGoldDemandReport(`
  <a href="/goldhub/research/gold-demand-trends/gold-demand-trends-full-year-2025">2025</a>
  <a href="/goldhub/research/gold-demand-trends/gold-demand-trends-q2-2026">Q2</a>
`);
assert.deepEqual({ year: latest.year, quarter: latest.quarter }, { year: 2026, quarter: 2 });

const stackedScript = `(function(){_self._opt = ${JSON.stringify({
  series: [
    { name: "Q1", data: [90, 100, 110] }, { name: "Q2", data: [95, 120, 130] },
    { name: "Q3", data: [98, 140, 0] }, { name: "Q4", data: [99, 160, 0] },
  ],
  xAxis: { categories: [2024, 2025, 2026] },
})};})();`;
const stacked = parseGoldDemandChartScript(stackedScript, { year: 2026, quarter: 2 });
assert.equal(stacked.at(-1).period, "Q2 2026");
assert.equal(stacked.at(-1).tonnes, 130);
assert.equal(stacked.length, 10, "future zero placeholders must be excluded");

const chronologicalScript = `(function(){_self._opt = ${JSON.stringify({
  series: [{ name: "Net purchase", data: [1,2,3,4,5,6,7,8] }],
  xAxis: { categories: ["Q1'24","Q2'24","Q3'24","Q4'24","Q1'25","Q2'25","Q3'25","Q4'25"] },
})};})();`;
assert.equal(parseGoldDemandChartScript(chronologicalScript).at(-1).period, "Q4 2025");

const freshPayload = buildCentralBankGoldPayload({
  sources: {
    holdings: { ok: true, data: holdings },
    demand: { ok: true, data: { report: latest, chartUrl: "https://example.test/chart.js", history: stacked } },
  },
  builtAtIso: "2026-08-08T12:00:00.000Z",
});
assert.equal(freshPayload.sourceState, "fresh");
assert.equal(freshPayload.summary.latestTonnes, 130);

const partialPayload = buildCentralBankGoldPayload({
  sources: {
    holdings: { ok: false, error: "offline" },
    demand: { ok: true, data: { report: latest, chartUrl: "https://example.test/chart.js", history: stacked } },
  },
  prior: freshPayload,
  builtAtIso: "2026-08-09T12:00:00.000Z",
});
assert.equal(partialPayload.sourceState, "partial");
assert.equal(partialPayload.countries.length, freshPayload.countries.length, "holdings last-good must carry forward");
assert.equal(partialPayload.sources.find((source) => source.id === "holdings").stale, true);

console.log("central-bank-gold smoke: passed");
