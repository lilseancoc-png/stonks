import assert from "node:assert/strict";
import { buildCorrelationsPayload } from "./build.mjs";

function bars(start, dailyStep, count = 31) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(2026, 6, 1 + i));
    out.push({ t: d.toISOString().slice(0, 10), c: start + dailyStep * i });
  }
  return out;
}

function market(start, dailyStep, currency = null) {
  const series = bars(start, dailyStep);
  const last = series.at(-1).c;
  const prevClose = series.at(-2).c;
  return {
    bars: series,
    last,
    prevClose,
    chPct: ((last - prevClose) / prevClose) * 100,
    asOf: series.at(-1).t,
    currency,
  };
}

const globalMarkets = {
  "^TNX": market(4.0, 0.01, "%"),
  JGB10Y: market(1.4, 0.005, "%"),
  JGB2Y: market(0.8, 0.003, "%"),
  "JPY=X": market(150, -0.08, "JPY"),
  "AUDJPY=X": market(98, 0.04, "JPY"),
  "EURJPY=X": market(163, 0.05, "JPY"),
  "EURUSD=X": market(1.08, 0.001, "USD"),
  "AUDUSD=X": market(0.65, -0.0004, "USD"),
  "GBPUSD=X": market(1.27, 0.0006, "USD"),
};
Object.defineProperty(globalMarkets, "_contextInputs", {
  enumerable: false,
  value: {
    usPolicy: { rate: 3.83, asOf: "2026-07-31", source: "NYFED:EFFR" },
    japanPolicy: { rate: 0.78, asOf: "2026-07-31", source: "BOJ:FM01/STRDCLUCON" },
    usdJpyIv: { valuePct: 10.4, tenorDays: 31, expiry: "2026-08-31", proxy: true },
  },
});

const payload = buildCorrelationsPayload({}, globalMarkets, "2026-07-31T12:00:00.000Z");

assert.equal(payload.markets.JGB2Y.name, "Japan 2Y JGB");
assert.equal(payload.markets.JGB2Y.source, "Japan MOF");
assert.ok(Number.isFinite(payload.markets.JGB10Y.moves["20d"].bp));
assert.ok(payload.regions.some((r) => r.region === "FX & rates" && r.symbols.includes("AUDJPY=X") && r.symbols.includes("EURJPY=X")));
assert.ok(!payload.regions.some((r) => r.symbols.includes("EURUSD=X")), "strength-only USD crosses stay out of the tile grid");
assert.ok(Number.isFinite(payload.context.carry.yieldSpread10y.valueBp));
assert.equal(payload.context.carry.policyDiff.valueBp, 305);
assert.equal(payload.context.carry.usdJpyIv.proxy, true);
for (const h of ["1d", "5d", "20d"]) {
  const row = payload.context.currencyStrength.horizons[h];
  assert.deepEqual(Object.keys(row), ["USD", "JPY", "EUR", "AUD", "GBP"]);
  assert.ok(Object.values(row).every(Number.isFinite));
  assert.ok(Math.abs(Object.values(row).reduce((a, b) => a + b, 0)) < 0.05, `${h} strength should be basket-relative`);
}

console.log("overnight smoke: ok");
