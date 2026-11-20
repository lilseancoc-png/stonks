#!/usr/bin/env node
// Offline checks for lib/sports-on-time.mjs (no network).
import assert from "node:assert/strict";
import { sportsDispatchPlan, latestSlotMs } from "../lib/sports-on-time.mjs";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`); }
const at = (iso) => Date.parse(iso);
const byFile = (plan) => Object.fromEntries(plan.map((r) => [r.file, r]));

check("latest slot honors the grace window and rolls back a day", () => {
  const slots = [[13, 20], [22, 30]];
  assert.equal(latestSlotMs(at("2026-11-20T13:30:00Z"), slots, 20), at("2026-11-19T22:30:00Z"));
  assert.equal(latestSlotMs(at("2026-11-20T13:45:00Z"), slots, 20), at("2026-11-20T13:20:00Z"));
  assert.equal(latestSlotMs(at("2026-11-21T01:00:00Z"), slots, 20), at("2026-11-20T22:30:00Z"));
});

check("hourly jobs are due only inside their hours and when stale", () => {
  const now = at("2026-11-20T15:05:00Z");
  const p = byFile(sportsDispatchPlan({ nowMs: now, runs: {
    "sports-props.yml": ["2026-11-20T14:37:00Z"], // 28 min ago: fresh
    "nba-prop-research.yml": [], // 15 UTC is outside its hours
    "sports-data.yml": ["2026-11-20T13:22:00Z"],
  } }));
  assert.equal(p["sports-props.yml"].due, false);
  assert.equal(p["nba-prop-research.yml"].due, false);
  assert.equal(p["nba-prop-research.yml"].reason, "outside its hours");
  assert.equal(p["sports-data.yml"].due, false);
});

check("a late or missing props run is dispatched", () => {
  const now = at("2026-11-20T18:02:00Z");
  const p = byFile(sportsDispatchPlan({ nowMs: now, runs: {
    "sports-props.yml": ["2026-11-20T15:51:00Z", "bad-date"],
    "nba-prop-research.yml": null,
    "sports-data.yml": [],
  } }));
  assert.equal(p["sports-props.yml"].due, true);
  assert.match(p["sports-props.yml"].reason, /last run 131 min ago/);
  assert.equal(p["nba-prop-research.yml"].due, true);
  assert.equal(p["nba-prop-research.yml"].reason, "no recent run");
});

check("the data refresh slot is dispatched once until a run lands", () => {
  const now = at("2026-11-20T14:05:00Z");
  const missed = byFile(sportsDispatchPlan({ nowMs: now, runs: { "sports-data.yml": ["2026-11-19T22:41:00Z"] } }));
  assert.equal(missed["sports-data.yml"].due, true);
  assert.match(missed["sports-data.yml"].reason, /13:20 UTC slot/);
  const ran = byFile(sportsDispatchPlan({ nowMs: now, runs: { "sports-data.yml": ["2026-11-20T14:01:00Z"] } }));
  assert.equal(ran["sports-data.yml"].due, false);
  // 13 hours after the 22:30 slot nothing is due (window 12 h) before the next slot is ready.
  const stale = byFile(sportsDispatchPlan({ nowMs: at("2026-11-21T13:35:00Z"), runs: { "sports-data.yml": [] } }));
  assert.equal(stale["sports-data.yml"].due, false);
});

console.log(`${passed} passed`);
