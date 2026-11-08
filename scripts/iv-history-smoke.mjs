// IV history keeps one sample per trading session (QC 2026-11-08): a forced
// weekend or holiday build re-prices the last session's chain, so its sample
// is dropped when the next build seeds the history. Pure; no network.
import assert from "node:assert/strict";
import { ivHistorySessionDate, ivHistorySessionEntries } from "./build.mjs";

assert.equal(ivHistorySessionDate("2026-11-06"), true, "a Friday session counts");
assert.equal(ivHistorySessionDate("2026-11-07"), false, "Saturday is not a session");
assert.equal(ivHistorySessionDate("2026-11-08"), false, "Sunday is not a session");
assert.equal(ivHistorySessionDate("2026-09-07"), false, "Labor Day is not a session");
assert.equal(ivHistorySessionDate("2026-11-27"), true, "an early-close day is still a session");
assert.equal(ivHistorySessionDate("2031-03-04"), true, "a year the NYSE table lacks falls back to weekdays (Tuesday)");
assert.equal(ivHistorySessionDate("2031-03-08"), false, "fallback still drops weekends");
assert.equal(ivHistorySessionDate("not-a-date"), false, "a bad date is dropped");

const kept = ivHistorySessionEntries([
  { date: "2026-09-04", iv: 0.31 },
  { date: "2026-09-05", iv: 0.31 },
  { date: "2026-09-07", iv: 0.31 },
  { date: "2026-09-08", iv: 0.33 },
  null,
  { iv: 0.4 },
]);
assert.deepEqual(kept.map((e) => e.date), ["2026-09-04", "2026-09-08"], "weekend, holiday and malformed rows are dropped in order");
assert.deepEqual(ivHistorySessionEntries(undefined), [], "missing history is empty");

console.log("iv-history smoke passed");
