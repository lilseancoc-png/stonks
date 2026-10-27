import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCorrelationsPayload, GLOBAL_QUOTE_TYPES } from "./build.mjs";
import { OVERNIGHT_TONE } from "../lib/overnight-tone.mjs";

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

const overnightCss = readFileSync(new URL("./render/styles-css.mjs", import.meta.url), "utf8");
const overnightApp = readFileSync(new URL("./render/app-js.mjs", import.meta.url), "utf8");
assert.match(overnightCss, /grid-template-areas:"label label" "value move" "note note"/);
assert.match(overnightCss, /minmax\(min\(100%,190px\),1fr\)/);
assert.doesNotMatch(overnightCss, /\.ovn-carry-card>span\{[^}]*text-overflow:ellipsis/);
assert.ok(GLOBAL_QUOTE_TYPES.has("index"), "foreign cash indices must use latest-session quotes");
assert.ok(GLOBAL_QUOTE_TYPES.has("equity"), "foreign bellwethers must use latest-session quotes");
assert.match(overnightApp, /fetch\('api\/macro-live\?tape=1'/);
assert.match(overnightApp, /d\.tone = deriveOvernightTone\(d\)/);
assert.match(overnightApp, /var OVERNIGHT = \(\$\{overnightToneFactory\.toString\(\)\}\)\(\);/);
assert.match(overnightApp, /latest-session overlays/);
assert.match(overnightApp, /if \(baked\.type === 'rate' && prev != null\) out\.chgBp/);

const overlaySrc = overnightApp.match(/function overlayOvernightMarket\(baked, live\)\{[\s\S]*?\r?\n  \}\r?\n  function applyOvernightLive/)?.[0] || "";
assert.ok(overlaySrc.includes("function overlayOvernightMarket"), "live overlay helper must exist");
const overlayOvernightMarket = new Function(`${overlaySrc.replace(/\r?\n  function applyOvernightLive[\s\S]*$/, "")}\nreturn overlayOvernightMarket;`)();
const liveTenYear = overlayOvernightMarket(
  { type: "rate", last: 4.00, chgBp: 2, asOf: "2026-08-25", moves: { "1d": { pct: 0.05, bp: 2 } } },
  { value: 4.25, prevClose: 4.00, asOf: "2026-08-26T20:00:00.000Z" },
);
assert.equal(liveTenYear.chgBp, 25);
assert.equal(liveTenYear.moves["1d"].bp, 25);

// The tab headline: today's saved call wins; otherwise the shared scorer runs
// on the snapshot with the same freshness rules as the saved call.
const toneSrc = overnightApp.match(/  function ovnEtNow\(ms\)\{[\s\S]*?\r?\n  \}\r?\n  function overlayOvernightMarket/)?.[0] || "";
assert.ok(toneSrc.includes("function deriveOvernightTone(d)"), "tone helper must exist");
const toneFns = new Function("OVERNIGHT", `${toneSrc.replace(/\r?\n  function overlayOvernightMarket[\s\S]*$/, "")}\nreturn { deriveOvernightTone, ovnTodayCall, ovnEtNow };`)(OVERNIGHT_TONE);
const todayEt = toneFns.ovnEtNow().date;
const savedTone = { label: "risk-off", score: -3, buckets: [], present: 4, excluded: [], gap: { call: "down" } };
const fromCall = toneFns.deriveOvernightTone({ markets: {}, preopen: { today: { date: todayEt, tone: savedTone, reconstructed: false } } });
assert.equal(fromCall.label, "risk-off");
assert.equal(fromCall.source, "preopen");
const oldCall = toneFns.deriveOvernightTone({ markets: {}, preopen: { latest: { date: "2020-01-02", tone: savedTone } } });
assert.equal(oldCall.source, "snapshot", "a prior day's saved call must not be today's headline");
assert.equal(oldCall.label, "insufficient", "an empty snapshot cannot call a tone");
const snap = toneFns.deriveOvernightTone({
  markets: {
    "ES=F": { chPct: 1.2, sigma1d: 1 }, "NQ=F": { chPct: 1.5, sigma1d: 1.3 },
    "AUDJPY=X": { chPct: 0.8, sigma1d: 0.6 }, "HG=F": { chPct: 1.6, sigma1d: 1.4 }, "BTC-USD": { chPct: 4, sigma1d: 3 },
  },
  context: { priorUs: { date: "2020-01-02", closeMs: Date.parse("2020-01-02T21:00:00Z"), pct: 0 } },
});
assert.equal(snap.source, "snapshot");
assert.ok(snap.present >= 3 && snap.score >= 3, `aligned futures/FX/growth should read risk-on (got ${snap.label} ${snap.score})`);

console.log("overnight smoke: ok");
