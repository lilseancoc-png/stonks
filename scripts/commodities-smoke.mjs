import assert from "node:assert/strict";

import {
  COMMODITY_GROUPS,
  COMMODITY_TRACKERS,
  buildCommoditiesPayload,
} from "./build.mjs";

const byKey = new Map(COMMODITY_TRACKERS.map((item) => [item.key, item]));

assert.equal(COMMODITY_TRACKERS.length, 13, "the commodity desk should expose thirteen trackers");
assert.deepEqual(
  COMMODITY_GROUPS[0],
  { key: "precious", label: "Precious metals" },
  "precious metals should be a first-class display group",
);
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

console.log("commodities smoke: ok");
