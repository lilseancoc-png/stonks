// Checks the shared "are the options expensive?" rule (lib/iv-richness.mjs)
// that the grade, Top Picks, the Strategy builder and Trending IV all read.
import assert from "node:assert/strict";
import { IV_RICHNESS, ivRichnessFactory } from "../lib/iv-richness.mjs";
import { buildIvTrendingPayload } from "./build.mjs";

const c = (o) => IV_RICHNESS.classify(o);
assert.equal(c({}).band, "unknown");
assert.equal(c({ pctile: null, iv: 0.5, rv30: 0.3 }).band, "unknown");
assert.equal(c({ pctile: 20 }).band, "cheap");
assert.equal(c({ pctile: 21 }).band, "normal");
assert.equal(c({ pctile: 79, iv: 0.6, rv30: 0.3 }).band, "normal");
assert.equal(c({ pctile: 80, iv: 0.6, rv30: 0.3 }).band, "rich");
assert.equal(c({ pctile: 89, iv: 0.6, rv30: 0.3 }).band, "rich");
assert.equal(c({ pctile: 90, iv: 0.6, rv30: 0.3 }).band, "very-rich");
// IV at or below realized vol is not rich, however high the percentile.
assert.equal(c({ pctile: 95, iv: 0.3, rv30: 0.3 }).band, "normal");
assert.equal(c({ pctile: 95, iv: 0.25, rv30: 0.3 }).ivOverRv, false);
// Missing realized vol: the percentile decides alone.
const noRv = c({ pctile: 92, iv: 0.5 });
assert.equal(noRv.band, "very-rich");
assert.equal(noRv.basis, "percentile-only");
assert.equal(c({ pctile: 92, iv: 0.5, rv30: 0.3 }).basis, "percentile+realized");
// Earnings is a tag only.
assert.equal(c({ pctile: 50, earningsDays: 14 }).earningsSoon, true);
assert.equal(c({ pctile: 50, earningsDays: 15 }).earningsSoon, false);
assert.equal(c({ pctile: 50, earningsDays: -1 }).earningsSoon, false);
assert.equal(c({ pctile: 50, earningsDays: 3 }).band, "normal");
// Flags agree with the band.
const r = c({ pctile: 85, iv: 0.5, rv30: 0.3 });
assert.ok(r.rich && !r.veryRich && !r.cheap && r.label === "Rich");
// Strings and junk are handled.
assert.equal(c({ pctile: "85", iv: "0.5", rv30: "0.3" }).band, "rich");
assert.equal(c({ pctile: true }).band, "unknown");
// The browser embeds the factory with toString(): keep it ES5.
const src = ivRichnessFactory.toString();
assert.ok(!/=>|\bconst\b|\blet\b|`/.test(src), "ivRichnessFactory must stay ES5 for app.js");
const embedded = new Function("return (" + src + ")();")();
assert.equal(embedded.classify({ pctile: 90, iv: 0.6, rv30: 0.3 }).band, "very-rich");
// Trending IV's "elevated" flag is the same Rich band.
const day = (i) => new Date(Date.UTC(2026, 8, 1) + i * 86400000).toISOString().slice(0, 10);
const hist = (last) => ({ entries: [...Array.from({ length: 40 }, (_, i) => ({ date: day(i), iv: 0.30 + (i % 5) * 0.01 })), { date: day(40), iv: last }] });
const trend = buildIvTrendingPayload(new Map([["RICH", hist(0.60)], ["TRACK", hist(0.60)], ["MID", hist(0.32)]]), {
  RICH: { spot: 100, technicals: { volRegime: { rv30: 0.40 } }, fundamentals: {} },
  TRACK: { spot: 100, technicals: { volRegime: { rv30: 0.70 } }, fundamentals: {} },
  MID: { spot: 100, technicals: { volRegime: { rv30: 0.20 } }, fundamentals: {} },
}, day(40) + "T15:00:00Z");
const row = (s) => trend.tickers.find((x) => x.symbol === s);
assert.equal(row("RICH").elevated, true);
assert.equal(row("RICH").band, "very-rich");
assert.equal(row("TRACK").elevated, false, "IV below realized vol is not Rich on Trending IV either");
assert.equal(row("MID").elevated, false);
console.log("iv-richness smoke passed: bands, realized-vol check, earnings tag, ES5 embed, Trending IV flag.");
