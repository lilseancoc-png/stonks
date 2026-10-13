#!/usr/bin/env node
// Offline checks for the pure LEAPS pricer. No network and no AI calls.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bsPrice, greeks } from "../lib/greeks.mjs";
import {
  LEAPS_BISECTION_ITERS,
  LEAPS_FORWARD_YEARS,
  LEAPS_PASS_MULTIPLE,
  LEAPS_RISK_FREE_RATE,
  LEAPS_TARGET_DELTA,
  LEAPS_TARGET_MOVE,
  LEAPS_YEAR_DAYS,
  filterLeaps,
  leapsDoubles,
  priceLeaps,
  solveLeapsStrike,
} from "../lib/leaps-pricer.mjs";

function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: got ${actual}, expected ${expected} ± ${tolerance}`,
  );
}

function assertFiniteTree(value, path) {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} is not finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertFiniteTree(item, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertFiniteTree(item, `${path}.${key}`);
  }
}

function scenario(quote, move) {
  const row = quote.scenarios.find((item) => Math.abs(item.move - move) <= 1e-12);
  assert.ok(row, `missing scenario ${move}`);
  return row;
}

assert.equal(LEAPS_RISK_FREE_RATE, 0.04);
assert.equal(LEAPS_TARGET_DELTA, 0.25);
assert.equal(LEAPS_TARGET_MOVE, 0.35);
assert.equal(LEAPS_PASS_MULTIPLE, 2);
assert.equal(LEAPS_FORWARD_YEARS, 0.5);
assert.equal(LEAPS_YEAR_DAYS, 365.25);
assert.equal(Number.isInteger(LEAPS_BISECTION_ITERS), true);
assert.ok(LEAPS_BISECTION_ITERS > 0);

const canonical = {
  spot: 100,
  iv: 0.4,
  expirations: [LEAPS_YEAR_DAYS],
  side: "call",
  rate: 0.04,
  targetDelta: 0.25,
};
const [quote] = priceLeaps(canonical);
assert.ok(quote, "12-month call should price");
assert.equal(quote.years, 1);
assert.equal(quote.rate, 0.04);
assert.equal(quote.side, "call");
assert.equal(quote.passes, true);
assert.ok(quote.targetValue >= 2 * quote.premium);
assert.equal(quote.passes, leapsDoubles(quote.targetValue, quote.premium));
assert.equal(quote.iterations, LEAPS_BISECTION_ITERS);
assertNear(quote.strike, 147.7, 1, "strike");
assertNear(quote.delta, 0.25, 1e-3, "delta");
assertNear(scenario(quote, 0).pctChange, -69, 4, "flat");
assertNear(scenario(quote, 0.2).pctChange, 14, 5, "+20%");
assertNear(scenario(quote, 0.35).pctChange, 129, 8, "+35%");
assertNear(scenario(quote, 0.5).pctChange, 290, 15, "+50%");
assertNear(scenario(quote, 0).spot, 100, 1e-6, "flat spot");
assertNear(scenario(quote, 0.2).spot, 120, 1e-6, "+20 spot");
assertNear(scenario(quote, 0.35).spot, 135, 1e-6, "+35 spot");
assertNear(scenario(quote, 0.5).spot, 150, 1e-6, "+50 spot");
for (const row of quote.scenarios) assert.equal(row.years, 0.5);
assertFiniteTree(quote, "quote");

const modelDelta = greeks("call", 100, quote.strike, 1, 0.4, 0.04);
assert.ok(modelDelta && Math.abs(modelDelta.delta - 0.25) < 1e-3);
assertNear(bsPrice("call", 100, quote.strike, 1, 0.4, 0.04), quote.premium, 1e-8, "premium");
assertNear(
  bsPrice("call", 135, quote.strike, 0.5, 0.4, 0.04),
  scenario(quote, 0.35).value,
  1e-6,
  "same-IV forward",
);

const implicit = priceLeaps({ spot: 100, iv: 0.4, expirations: [LEAPS_YEAR_DAYS] });
assert.equal(implicit[0].side, "call");
assert.equal(implicit[0].rate, LEAPS_RISK_FREE_RATE);
assert.equal(implicit[0].strike, quote.strike);

const richerRate = priceLeaps({ spot: 100, iv: 0.4, expirations: [LEAPS_YEAR_DAYS], rate: 0.1 });
assert.ok(richerRate[0].strike > quote.strike);

const dated = priceLeaps({
  spot: 100,
  iv: 0.4,
  side: "call",
  asOf: "2026-01-15",
  expirations: ["2027-01-15"],
  rate: 0.04,
});
assert.equal(dated.length, 1);
assert.equal(dated[0].asOf, "2026-01-15");
assert.equal(dated[0].expiration, "2027-01-15");
assertNear(dated[0].strike, 147.7, 1, "dated strike");
assertNear(scenario(dated[0], 0).pctChange, -69, 4, "dated flat");
assertNear(scenario(dated[0], 0.2).pctChange, 14, 5, "dated +20%");
assertNear(scenario(dated[0], 0.35).pctChange, 129, 8, "dated +35%");
assertNear(scenario(dated[0], 0.5).pctChange, 290, 15, "dated +50%");

const datedObj = priceLeaps({
  spot: 100,
  iv: 0.4,
  asOf: new Date("2026-01-15T00:00:00Z"),
  expirations: [new Date("2027-01-15T00:00:00Z")],
  rate: 0.04,
});
assert.equal(datedObj[0].strike, dated[0].strike);

const put = priceLeaps({
  spot: 100,
  iv: 0.4,
  side: "put",
  expirations: [LEAPS_YEAR_DAYS],
  rate: 0.04,
})[0];
assert.ok(put.strike < 100);
assertNear(put.delta, -0.25, 1e-3, "put delta");
assert.deepEqual(put.scenarios.map((row) => row.move), [0, -0.2, -0.35, -0.5]);
assertNear(scenario(put, 0).spot, 100, 1e-6, "put flat spot");
assertNear(scenario(put, -0.2).spot, 80, 1e-6, "put -20 spot");
assertNear(scenario(put, -0.35).spot, 65, 1e-6, "put -35 spot");
assertNear(scenario(put, -0.5).spot, 50, 1e-6, "put -50 spot");
assert.equal(put.passes, true);
assert.ok(put.targetValue >= 2 * put.premium);
assertFiniteTree(put, "put");

// Exactly 2× passes. Anything short of 2× fails. A zero premium does not score.
assert.equal(leapsDoubles(2, 1), true);
assert.equal(leapsDoubles(2 * 10, 10), true);
assert.equal(leapsDoubles(20 - 1e-9, 10), false);
assert.equal(leapsDoubles(0, 5), false);
assert.equal(leapsDoubles(1, 0), null);
assert.equal(leapsDoubles(0, 0), null);
assert.equal(leapsDoubles(1, -1), null);
assert.equal(leapsDoubles(Infinity, 1), null);
assert.equal(leapsDoubles(1, Infinity), null);
assert.equal(leapsDoubles(NaN, 1), null);

const base = { spot: 100, iv: 0.4, expirations: [LEAPS_YEAR_DAYS] };
for (const iv of [0, -0, -0.2, NaN, Infinity, -Infinity, null, "0.4", true]) {
  assert.equal(priceLeaps({ ...base, iv }), null, `iv ${String(iv)}`);
}
assert.equal(priceLeaps({ spot: 100, expirations: [LEAPS_YEAR_DAYS] }), null, "iv missing");
for (const spot of [0, -0, -10, NaN, Infinity, -Infinity, null, "100"]) {
  assert.equal(priceLeaps({ ...base, spot }), null, `spot ${String(spot)}`);
}
assert.equal(priceLeaps({ iv: 0.4, expirations: [LEAPS_YEAR_DAYS] }), null, "spot missing");
assert.equal(priceLeaps({ ...base, expirations: [0.5 * LEAPS_YEAR_DAYS - 1] }), null, "under 6 months");
assert.equal(priceLeaps({ ...base, expirations: [100, LEAPS_YEAR_DAYS] }), null, "short expiry poisons the list");
assert.equal(
  priceLeaps({ spot: 100, iv: 0.4, asOf: "2026-01-15", expirations: ["2026-04-01"] }),
  null,
  "dated expiry under 6 months",
);
assert.equal(
  priceLeaps({ spot: 100, iv: 0.4, asOf: "2026-06-01", expirations: ["2026-01-01"] }),
  null,
  "expiry before as-of",
);
assert.equal(priceLeaps({ ...base, spot: Number.MIN_VALUE }), null, "premium collapses to 0");
assert.equal(priceLeaps(null), null);
assert.equal(priceLeaps({ ...base, expirations: LEAPS_YEAR_DAYS }), null);
assert.equal(priceLeaps({ ...base, side: "straddle" }), null);
assert.equal(priceLeaps({ ...base, rate: NaN }), null);
assert.equal(priceLeaps({ ...base, rate: Infinity }), null);
assert.equal(priceLeaps({ ...base, targetDelta: 0.19 }), null);
assert.equal(priceLeaps({ ...base, targetDelta: 0.31 }), null);
assert.equal(priceLeaps({ ...base, targetDelta: NaN }), null);
assert.equal(priceLeaps({ ...base, asOf: "2026-02-31", expirations: [LEAPS_YEAR_DAYS] }), null);
assert.equal(priceLeaps({ spot: 100, iv: 0.4, expirations: ["2027-01-15"] }), null, "date without as-of");
assert.equal(priceLeaps({ spot: 100, iv: 0.4, asOf: "2026-01-15", expirations: ["2027-02-31"] }), null);

const nine = 0.75 * LEAPS_YEAR_DAYS;
const twentyFour = 2 * LEAPS_YEAR_DAYS;
const windowed = priceLeaps({
  spot: 100,
  iv: 0.4,
  expirations: [nine - 1, nine, twentyFour, twentyFour + 1, 0.5 * LEAPS_YEAR_DAYS],
});
assert.equal(windowed.length, 2);
assertNear(windowed[0].days, nine, 1e-9, "9-month edge");
assertNear(windowed[1].days, twentyFour, 1e-9, "24-month edge");
assert.deepEqual(priceLeaps({ ...base, expirations: [0.5 * LEAPS_YEAR_DAYS] }), []);
assert.deepEqual(priceLeaps({ ...base, expirations: [] }), []);

const lowDelta = priceLeaps({ ...base, targetDelta: 0.2 });
const highDelta = priceLeaps({ ...base, targetDelta: 0.3 });
assert.equal(lowDelta.length, 1);
assert.equal(highDelta.length, 1);
assert.ok(lowDelta[0].strike > highDelta[0].strike);

const solved = solveLeapsStrike({
  spot: 100,
  iv: 0.4,
  years: 1,
  side: "call",
  rate: 0.04,
  targetDelta: 0.25,
});
const solvedAgain = solveLeapsStrike({
  spot: 100,
  iv: 0.4,
  years: 1,
  side: "call",
  rate: 0.04,
  targetDelta: 0.25,
});
assert.equal(solved.iterations, LEAPS_BISECTION_ITERS);
assert.equal(solvedAgain.iterations, LEAPS_BISECTION_ITERS);
assert.equal(solvedAgain.strike, solved.strike);
assertNear(solved.strike, 147.7, 1, "solver strike");
assert.ok(solved.iterations <= LEAPS_BISECTION_ITERS);
const wide = solveLeapsStrike({
  spot: 100,
  iv: 1.2,
  years: 2,
  side: "call",
  rate: 0.04,
  targetDelta: 0.2,
});
assert.equal(wide.iterations, LEAPS_BISECTION_ITERS);
assert.ok(Number.isFinite(wide.strike) && wide.strike > 0);
assertNear(wide.delta, 0.2, 1e-3, "wide delta");
assert.equal(solveLeapsStrike({ spot: 100, iv: 0, years: 1, side: "call", targetDelta: 0.25 }), null);
assert.equal(solveLeapsStrike({ spot: 100, iv: 0.4, years: 0, side: "call", targetDelta: 0.25 }), null);
assert.equal(solveLeapsStrike({ spot: 100, iv: 0.4, years: 1, side: "call", targetDelta: 0.5 }), null);

const failing = priceLeaps({ spot: 100, iv: 0.8, expirations: [LEAPS_YEAR_DAYS], rate: 0.04 });
assert.equal(failing.length, 1);
assert.equal(failing[0].passes, false);
assert.ok(failing[0].multiple < 2);
assert.equal(failing[0].passes, leapsDoubles(failing[0].targetValue, failing[0].premium));

const book = [...priceLeaps(canonical), ...failing];
assert.equal(filterLeaps(book, "pass").length, 1);
assert.equal(filterLeaps(book, "fail").length, 1);
assert.equal(filterLeaps(book, "pass")[0].passes, true);
assert.equal(filterLeaps(book, "fail")[0].passes, false);
assert.deepEqual(filterLeaps([], "pass"), []);
assert.deepEqual(filterLeaps([], "fail"), []);
assert.equal(filterLeaps(null, "pass"), null);
assert.equal(filterLeaps(book, "maybe"), null);
assert.equal(filterLeaps(priceLeaps({ ...base, iv: 0 }), "pass"), null);

const src = await readFile(new URL("../lib/leaps-pricer.mjs", import.meta.url), "utf8");
assert.doesNotMatch(src, /scripts\/build\.mjs/);
assert.doesNotMatch(src, /\bwhile\b/);
assert.doesNotMatch(src, /Date\.now\s*\(/);
assert.doesNotMatch(src, /\bfetch\s*\(/);
assert.doesNotMatch(src, /node:fs|node:http|node:net/);
assert.match(src, /for \(let i = 0; i < LEAPS_BISECTION_ITERS; i\+\+\)/);
assert.match(src, /value >= LEAPS_PASS_MULTIPLE \* premium/);

console.log("leaps-pricer smoke ok");
