import assert from "node:assert/strict";

import {
  COMMODITY_GROUPS,
  COMMODITY_TRACKERS,
  buildCommoditiesPayload,
  commoditySeriesFromSweep,
} from "./build.mjs";

const byKey = new Map(COMMODITY_TRACKERS.map((item) => [item.key, item]));

assert.equal(COMMODITY_TRACKERS.length, 16, "the commodity desk should expose sixteen trackers");
assert.deepEqual(
  COMMODITY_GROUPS.slice(0, 2),
  [{ key: "energy", label: "Energy" }, { key: "precious", label: "Precious metals" }],
  "energy and precious metals should be first-class display groups",
);
for (const [key, symbol] of [["crude", "CL=F"], ["natgas", "NG=F"], ["copper", "HG=F"]]) {
  assert.equal(byKey.get(key)?.symbol, symbol, `${key} should use the ${symbol} series the overnight sweep already fetches`);
}
assert.deepEqual(
  { symbol: byKey.get("gold")?.symbol, group: byKey.get("gold")?.group, kind: byKey.get("gold")?.kind },
  { symbol: "GC=F", group: "precious", kind: "futures" },
  "gold should use the COMEX futures series",
);
assert.deepEqual(
  { symbol: byKey.get("silver")?.symbol, group: byKey.get("silver")?.group, kind: byKey.get("silver")?.kind },
  { symbol: "SI=F", group: "precious", kind: "futures" },
  "silver should use the COMEX futures series",
);

const series = [
  { d: "2026-07-15", v: 100 },
  { d: "2026-08-14", v: 110 },
];
const payload = buildCommoditiesPayload({
  builtAtIso: "2026-08-16T12:00:00.000Z",
  fetched: {
    gold: { symbol: "GC=F", series },
    silver: { symbol: "SI=F", series },
  },
});

for (const key of ["gold", "silver"]) {
  const item = payload.items.find((candidate) => candidate.key === key);
  assert.ok(item, `${key} should be emitted into commodities.json`);
  assert.equal(item.stale, false, `${key} should be current after a successful fetch`);
  assert.equal(item.last, 110, `${key} should use the latest settle`);
  assert.equal(item.changes.find((change) => change.label === "30d")?.pct, 10, `${key} should include a 30-day move`);
  assert.ok(item.watch.length >= 3, `${key} should include linked equity handoffs`);
}

const yearBars = [{ t: "2025-08-14", c: 66 }, { t: "2026-02-13", c: 69 }, { t: "2026-08-14", c: 71.5 }];
const swept = commoditySeriesFromSweep(byKey.get("crude"), { "CL=F": { bars: yearBars } });
assert.deepEqual(swept, { symbol: "CL=F", series: [{ d: "2025-08-14", v: 66 }, { d: "2026-02-13", v: 69 }, { d: "2026-08-14", v: 71.5 }] }, "the overnight sweep's bars should be reused as the crude series");
assert.equal(commoditySeriesFromSweep(byKey.get("crude"), {}), null, "a symbol the sweep missed falls back to its own fetch");
assert.equal(
  commoditySeriesFromSweep(byKey.get("crude"), { "CL=F": { bars: [{ t: "2026-08-13", c: 70 }, { t: "2026-08-14", c: 71.5 }] } }),
  null,
  "a truncated sweep slice falls back to the card's own one-year fetch",
);

// A fetch that succeeds but returns an old reading is flagged aged, not
// current: the potash PPI series ended Dec 2022 yet came back "fresh".
const aged = buildCommoditiesPayload({
  builtAtIso: "2026-11-06T21:12:42.187Z",
  fetched: {
    potash: { symbol: "PCU212391212391P", series: [{ d: "2022-11-01", v: 377 }, { d: "2022-12-01", v: 378 }] },
    "palm-oil": { symbol: "PPOILUSDM", series: [{ d: "2026-08-01", v: 1132 }, { d: "2026-09-01", v: 1133 }] },
    gold: { symbol: "GC=F", series: [{ d: "2026-10-20", v: 4000 }, { d: "2026-10-23", v: 4100 }] },
    silver: { symbol: "SI=F", series: [{ d: "2026-11-05", v: 52 }, { d: "2026-11-06", v: 52.5 }] },
  },
});
const agedItem = (key) => aged.items.find((item) => item.key === key);
assert.equal(agedItem("potash").aged, true, "a monthly series years behind is aged");
assert.match(agedItem("potash").agedWhy, /2022-12-01/);
assert.equal(agedItem("potash").stale, false, "aged is not the same as a failed fetch (last-good)");
assert.equal(agedItem("palm-oil").aged, undefined, "a two-month-old monthly print is current");
assert.equal(agedItem("gold").aged, true, "a daily series two weeks behind is aged");
assert.equal(agedItem("silver").aged, undefined);

console.log("commodities smoke: ok");
