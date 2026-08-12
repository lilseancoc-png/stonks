// Offline contract check for AI CapEx ticker coverage and SEC taxonomy routing.
import assert from "node:assert/strict";
import { AI_CAPEX_TICKERS, buildAiCapexPayload } from "./build.mjs";

for (const symbol of ["ORCL", "TSM", "MU"]) assert.ok(AI_CAPEX_TICKERS.includes(symbol));

const originalFetch = globalThis.fetch;
const urls = [];
const annual = (a, b) => ({
  units: { USD: [
    { start: "2024-01-01", end: "2024-12-31", val: a, form: "10-K", fp: "FY" },
    { start: "2025-01-01", end: "2025-12-31", val: b, form: "10-K", fp: "FY" },
  ] },
});
globalThis.fetch = async (url) => {
  urls.push(String(url));
  const isRevenue = /Revenue/.test(String(url));
  return { ok: true, json: async () => annual(isRevenue ? 100e9 : 10e9, isRevenue ? 120e9 : 14e9) };
};

try {
  const payload = await buildAiCapexPayload(
    new Map([["ORCL", "1"], ["TSM", "2"], ["MU", "3"]]),
    {},
    "2026-08-11T16:00:00.000Z",
  );
  assert.deepEqual(payload.companies.map((row) => row.ticker).sort(), ["MU", "ORCL", "TSM"]);
  assert.ok(urls.some((url) => /\/ifrs-full\/PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities\.json$/.test(url)));
  assert.ok(urls.some((url) => /\/ifrs-full\/Revenue\.json$/.test(url)));
  assert.ok(urls.some((url) => /\/us-gaap\/PaymentsToAcquirePropertyPlantAndEquipment\.json$/.test(url)));
} finally {
  globalThis.fetch = originalFetch;
}

console.log("AI CapEx coverage smoke test passed");
