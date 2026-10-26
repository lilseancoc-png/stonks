// Offline checks for the one broad sector grouping (site audit I1). No network.
import assert from "node:assert/strict";
import { SECTOR_GROUP_ORDER, SECTOR_GROUP_OF_LABEL, sectorGroupOfLabel } from "../lib/sector-groups.mjs";
import { SECTORS, TICKERS, INDUSTRY_OF_TICKER, INDUSTRIES_BY_SECTOR, sectorGroupOf, buildHeatmapPayload } from "./build.mjs";

// Every fine SECTORS label — including the ones that only label dropped names,
// since those still carry old Track Record rows — maps to a declared group.
const labels = [...new Set(Object.values(SECTORS))];
for (const label of labels) {
  assert.ok(SECTOR_GROUP_OF_LABEL[label], `SECTORS label "${label}" has no broad group in lib/sector-groups.mjs`);
  assert.ok(SECTOR_GROUP_ORDER.includes(SECTOR_GROUP_OF_LABEL[label]), `group for "${label}" is not in SECTOR_GROUP_ORDER`);
}
assert.equal(sectorGroupOfLabel(null), null);
assert.equal(sectorGroupOfLabel(undefined), null);
// An unlisted label keeps its own name rather than dropping the stock.
assert.equal(sectorGroupOfLabel("Brand new label"), "Brand new label");
assert.equal(sectorGroupOfLabel("ETF"), "ETF");

// The point of the grouping: no tracked group is one or two stocks. Groups are
// what the Top Picks sector cap, the heatmap blocks, the sector breadth streaks
// and the Compare sector average count.
const byGroup = {};
for (const sym of TICKERS) {
  const group = sectorGroupOf(sym);
  assert.ok(group, `${sym} has no sector group`);
  (byGroup[group] = byGroup[group] || []).push(sym);
}
for (const [group, syms] of Object.entries(byGroup)) {
  if (group === "ETF") continue;
  assert.ok(syms.length >= 5, `group "${group}" holds only ${syms.length} tracked stocks (${syms.join(", ")}) — merge it`);
}
// Every declared group is actually used (no dead entry in the order).
for (const group of SECTOR_GROUP_ORDER) {
  assert.ok(byGroup[group]?.length, `group "${group}" has no tracked stock`);
}
assert.ok(Object.keys(byGroup).length <= SECTOR_GROUP_ORDER.length, "a tracked stock fell outside the declared groups");
assert.equal(sectorGroupOf("NVDA"), "Mega-cap tech");
assert.equal(sectorGroupOf("WDC"), "Semis & hardware");
assert.equal(sectorGroupOf("ANET"), "Semis & hardware");
assert.equal(sectorGroupOf("SBUX"), "Consumer & media");
assert.equal(sectorGroupOf("BABA"), "Consumer & media");
assert.equal(sectorGroupOf("SPY"), "ETF");
assert.equal(sectorGroupOf("NOT_A_TICKER"), null);

// Industries: every tracked non-ETF name has one (ensureTickerCoverage slots
// orphans by industry), and each one belongs to a declared parent sector.
const industrySectors = new Map();
for (const [sector, inds] of Object.entries(INDUSTRIES_BY_SECTOR)) for (const ind of inds) industrySectors.set(ind, sector);
for (const sym of TICKERS) {
  if (SECTORS[sym] === "ETF") continue;
  const ind = INDUSTRY_OF_TICKER[sym];
  assert.ok(ind, `${sym} has no INDUSTRY_OF_TICKER entry`);
  assert.ok(industrySectors.has(ind), `industry "${ind}" (${sym}) is not in INDUSTRIES_BY_SECTOR`);
}
assert.equal(INDUSTRY_OF_TICKER.AAPL, "Consumer Electronics");
assert.equal(INDUSTRY_OF_TICKER.WDC, "Computer Hardware");

// The heatmap treemap blocks by the broad group, so its rows carry one.
const heat = buildHeatmapPayload({
  NVDA: { spot: 100, fundamentals: { name: "NVIDIA", marketCap: 3e12 }, technicals: { volume: { priceMove1dPct: 1.2, avg20: 1e6, rvol: 1.1 } } },
  WDC: { spot: 50, fundamentals: { name: "Western Digital", marketCap: 2e10 }, technicals: { volume: { priceMove1dPct: -0.8, avg20: 1e6, rvol: 0.9 } } },
  SBUX: { spot: 90, fundamentals: { name: "Starbucks", marketCap: 1e11 }, technicals: { volume: { priceMove1dPct: 0.3, avg20: 1e6, rvol: 1 } } },
  SPY: { spot: 500, fundamentals: { name: "SPDR S&P 500", marketCap: 5e11 }, technicals: { volume: { priceMove1dPct: 0.1, avg20: 1e6, rvol: 1 } } },
}, "2026-10-26T20:00:00.000Z");
assert.equal(heat.tickers.length, 3, "ETFs stay out of the heatmap");
for (const row of heat.tickers) assert.ok(SECTOR_GROUP_ORDER.includes(row.s), `heatmap row ${row.t} has fine label "${row.s}"`);
assert.equal(heat.tickers.find((r) => r.t === "WDC").s, "Semis & hardware");
assert.equal(heat.tickers.find((r) => r.t === "WDC").i, "Computer Hardware");

console.log("sector-groups-smoke: ok");
