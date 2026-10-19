// Offline contract check for AI CapEx ticker coverage and SEC taxonomy routing.
import assert from "node:assert/strict";
import { AI_CAPEX_TICKERS, AI_CAPEX_GUIDANCE, buildAiCapexPayload } from "./build.mjs";
import {
  parseCapexGuidanceValue,
  capexGuidancePeriodYear,
  extractCapexGuidanceFromBrief,
  resolveAiCapexGuidance,
  buildGuidanceTotals,
  quarterlyToUsd,
  secSeriesIsStale,
} from "../lib/ai-capex.mjs";

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

// --- Guidance value + period parsing ---
assert.deepEqual(parseCapexGuidanceValue("$130-145 billion"), { low: 130e9, high: 145e9, qualifier: "range" });
assert.deepEqual(parseCapexGuidanceValue("between $60 billion and $64 billion"), { low: 60e9, high: 64e9, qualifier: "range" });
assert.deepEqual(parseCapexGuidanceValue("approximately $220 billion in cash CapEx"), { low: 220e9, high: 220e9, qualifier: "about" });
assert.deepEqual(parseCapexGuidanceValue("US$52B–56B"), { low: 52e9, high: 56e9, qualifier: "range" });
assert.deepEqual(parseCapexGuidanceValue("more than $25 billion"), { low: 25e9, high: null, qualifier: "more than" });
assert.equal(parseCapexGuidanceValue("NT$1.9 trillion"), null);
assert.equal(parseCapexGuidanceValue("grow year-over-year"), null);
assert.equal(parseCapexGuidanceValue("$175"), null, "a bare number without a unit is not trusted");
assert.equal(capexGuidancePeriodYear("FY2026", { calendarFiscal: true }), 2026);
assert.equal(capexGuidancePeriodYear("FY27", { calendarFiscal: false }), null, "a non-calendar fiscal year is not a CY guide");
assert.equal(capexGuidancePeriodYear("calendar year 2026", { calendarFiscal: false }), 2026);
assert.equal(capexGuidancePeriodYear("Q1 FY27", { calendarFiscal: false }), null);
assert.equal(capexGuidancePeriodYear("Q4 2026", { calendarFiscal: true }), null);

// --- Extraction from an earnings-call brief ---
const metaBrief = {
  callDate: "2026-10-28", quarter: "Q3 2026", sourceUrl: "https://example.com/meta-q3", source: "The Motley Fool",
  summary: { guidance: [
    { metric: "Q4 revenue", value: "$58-61 billion", period: "Q4 2026", change: "new" },
    { metric: "Capital expenditures (incl. finance lease principal)", value: "$135-145 billion", period: "FY2026", change: "raised" },
    { metric: "Capital expenditures", value: "$35 billion", period: "Q4 2026", change: "new" },
  ] },
};
const metaGuide = extractCapexGuidanceFromBrief(metaBrief, { calendarFiscal: true, reference: 137.5e9 });
assert.equal(metaGuide.period, "CY2026");
assert.equal(metaGuide.low, 135e9);
assert.equal(metaGuide.high, 145e9);
assert.equal(metaGuide.asOf, "2026-10-28");
assert.equal(metaGuide.auto, true);
const msftBrief = {
  callDate: "2026-10-28", quarter: "Q1 FY2027",
  summary: { guidance: [
    { metric: "Capital expenditures", value: "over $50 billion", period: "Q2 FY2027", change: "new" },
    { metric: "Capital expenditures", value: "grow year-over-year", period: "FY2027", change: "maintained" },
  ] },
};
assert.equal(extractCapexGuidanceFromBrief(msftBrief, { calendarFiscal: false, reference: 175e9 }), null, "MSFT quarterly/fiscal rows must not replace a CY guide");
const wildBrief = { callDate: "2026-10-28", summary: { guidance: [{ metric: "Capex", value: "$14 billion", period: "FY2026" }] } };
assert.equal(extractCapexGuidanceFromBrief(wildBrief, { calendarFiscal: true, reference: 137.5e9 }), null, "implausible figure vs the prior guide is rejected");

// --- Resolution: newer call wins, older guides get flagged, auto guides persist ---
const manual = {
  META: { period: "CY2026", low: 130e9, high: 145e9, qualifier: "range", asOf: "2026-07-29", event: "Q2 2026 earnings", sourceUrl: "x" },
  AMZN: { period: "CY2026", low: 220e9, high: 220e9, qualifier: "about", asOf: "2026-07-30", event: "Q2 2026 earnings", sourceUrl: "y" },
};
const resolved = resolveAiCapexGuidance({
  tickers: ["META", "AMZN", "NVDA"],
  manual,
  briefs: { META: metaBrief },
  lastPrints: { META: "2026-10-28", AMZN: "2026-10-29" },
  calendarFiscal: new Set(["META", "AMZN"]),
  todayIso: "2026-10-30",
});
assert.equal(resolved.META.low, 135e9);
assert.equal(resolved.META.auto, true);
assert.match(resolved.META.change, /^raised from \$130B–\$145B/);
assert.equal(resolved.META.review, undefined);
assert.equal(resolved.AMZN.low, 220e9);
assert.deepEqual(resolved.AMZN.review, { reason: "newer-report", reportDate: "2026-10-29" });
assert.equal(resolved.NVDA, null);
const carried = resolveAiCapexGuidance({
  tickers: ["META"], manual, briefs: {}, prior: { META: resolved.META },
  lastPrints: { META: "2026-10-28" }, calendarFiscal: new Set(["META"]), todayIso: "2026-11-02",
});
assert.equal(carried.META.low, 135e9, "an auto guide survives a missing brief");
const totals = buildGuidanceTotals(resolved);
assert.equal(totals.count, 2);
assert.equal(totals.lowSum, 355e9);
assert.equal(totals.autoCount, 1);
assert.deepEqual(totals.needsReview.map((r) => r.ticker), ["AMZN"]);
for (const [ticker, g] of Object.entries(AI_CAPEX_GUIDANCE)) {
  assert.match(g.period, /^CY\d{4}$/, `${ticker} guide period`);
  assert.match(g.asOf, /^\d{4}-\d{2}-\d{2}$/, `${ticker} guide date`);
  assert.ok(g.low > 0 && (g.high == null || g.high >= g.low), `${ticker} guide range`);
}

// --- Stale-SEC roll-forward from Yahoo quarters (TWD → USD) ---
assert.equal(secSeriesIsStale("2024-12-31", "2026-10-19T12:00:00Z"), true);
assert.equal(secSeriesIsStale("2025-12-31", "2026-10-19T12:00:00Z"), false);
const fxBars = [];
for (let t = Date.parse("2025-01-01"); t <= Date.parse("2026-10-16"); t += 86400000) {
  fxBars.push({ t: new Date(t).toISOString().slice(0, 10), c: 32 });
}
const twdQuarters = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]
  .map((date, i) => ({ date, value: (300 + i * 20) * 1e9 })); // NT$ billions
const rolled = quarterlyToUsd(twdQuarters, { currency: "TWD", fxBars, fiscalYearEndMonth: 12 });
assert.equal(rolled.ttm.asOf, "2026-06-30");
assert.equal(rolled.ttm.val, Math.round(((340 + 360 + 380 + 400) * 1e9) / 32));
assert.deepEqual(rolled.annual.map((a) => a.endIso), ["2025-12-31"]);
assert.equal(rolled.annual[0].val, Math.round(((300 + 320 + 340 + 360) * 1e9) / 32));
assert.equal(quarterlyToUsd(twdQuarters, { currency: "TWD", fxBars: null }), null, "no FX, no conversion");

{
  const staleSec = (val) => ({ units: { USD: [
    { start: "2023-01-01", end: "2023-12-31", val: val * 0.9, form: "20-F", fp: "FY" },
    { start: "2024-01-01", end: "2024-12-31", val, form: "20-F", fp: "FY" },
  ] } });
  globalThis.fetch = async (url) => ({ ok: true, json: async () => staleSec(/Revenue/.test(String(url)) ? 88e9 : 29e9) });
  const chains = { TSM: { fundamentals: {
    name: "TSMC", financialCurrency: "TWD", fiscalYearEndMonth: 12,
    capexHistory: twdQuarters,
    revenueHistory: twdQuarters.map((q) => ({ date: q.date, value: q.value * 3 })),
  } } };
  const fxCalls = [];
  const payload = await buildAiCapexPayload(new Map([["TSM", "1046179"]]), chains, "2026-10-19T12:00:00.000Z", null, {
    fetchFxBars: async (cur) => { fxCalls.push(cur); return fxBars; },
  });
  globalThis.fetch = originalFetch;
  const tsm = payload.companies[0];
  assert.deepEqual(fxCalls, ["TWD"]);
  assert.equal(tsm.source, "sec+yahoo");
  assert.equal(tsm.fyLatest.label, "FY2025");
  assert.equal(tsm.fyPrior.label, "FY2024");
  assert.equal(tsm.ttm.asOf, "2026-06-30");
  assert.equal(tsm.rev.fyLatest.label, "FY2025");
  assert.match(tsm.sourceNote, /converted from TWD/);
  assert.equal(tsm.guidance.low, 60e9, "TSM baseline guide attached");
}

// --- Mixed fiscal years are labeled as mixed ---
{
  globalThis.fetch = async (url) => {
    const u = String(url);
    const msft = /CIK0000000001/.test(u);
    const end = msft ? "2026-06-30" : "2025-12-31";
    const start = msft ? "2025-07-01" : "2025-01-01";
    const pend = msft ? "2025-06-30" : "2024-12-31";
    const pstart = msft ? "2024-07-01" : "2024-01-01";
    return { ok: true, json: async () => ({ units: { USD: [
      { start: pstart, end: pend, val: 10e9, form: "10-K", fp: "FY" },
      { start, end, val: 12e9, form: "10-K", fp: "FY" },
    ] } }) };
  };
  const payload = await buildAiCapexPayload(new Map([["MSFT", "1"], ["META", "2"], ["GOOGL", "3"]]), {}, "2026-10-19T12:00:00.000Z");
  globalThis.fetch = originalFetch;
  assert.equal(payload.totals.fyMixed, true);
  assert.equal(payload.totals.fyLatestLabel, "FY2025", "modal year, not the first name processed");
  assert.equal(payload.totals.fyRangeLabel, "FY2025–2026");
  assert.deepEqual(payload.totals.fyByLabel.FY2026, ["MSFT"]);
}

console.log("AI CapEx coverage smoke test passed");
