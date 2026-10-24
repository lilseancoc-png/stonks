// Offline checks for the staged bottom read and the false-positive count.
import assert from "node:assert/strict";
import { buildBottomTracker, summarizeRevisions } from "../lib/bottom-tracker.mjs";

function dates(n, start = "2019-01-01") {
  const out = [];
  let t = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

function series(values, start = "2019-01-01") {
  return dates(values.length, start).map((date, i) => ({ date, value: values[i] }));
}

function fill(n, value) {
  return Array.from({ length: n }, () => value);
}

function ramp(from, to, n) {
  if (n <= 1) return [from];
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

function revisions(patch) {
  return {
    covered: 40,
    unavailable: false,
    downShare30: 0.3,
    downShare90: 0.55,
    upShare30: 0.15,
    netUp30: -6,
    medianPct30: -0.4,
    medianPct90: -2.2,
    ...patch,
  };
}

function breadth(fromPct, toPct, fromLows, toLows) {
  const n = 25;
  return Array.from({ length: n }, (_, i) => ({
    t: dates(n, "2024-01-01")[i],
    pctAbove50: fromPct + ((toPct - fromPct) * i) / (n - 1),
    pctAbove200: 20,
    newHighs: 1,
    newLows: fromLows + ((toLows - fromLows) * i) / (n - 1),
    n: 40,
  }));
}

function crashPrices() {
  return fill(220, 100).concat(ramp(100, 80, 40));
}

function baseInput(patch = {}) {
  const prices = patch.prices || crashPrices();
  // Spreads widen during the price decline, then stop. A widen that finished
  // before the high does not count as stress in this decline.
  const hy = patch.hy || fill(220, 4).concat(ramp(4, 5.5, 20), fill(prices.length - 240, 5.5));
  const ig = patch.ig || fill(220, 1.1).concat(ramp(1.1, 1.6, 20), fill(prices.length - 240, 1.6));
  const vix = patch.vix || fill(220, 16).concat(ramp(16, 40, 20), ramp(40, 24, prices.length - 240));
  return {
    builtAtIso: "2026-10-24T15:00:00.000Z",
    spy: series(prices),
    qqq: series(patch.qqq || prices),
    hy: series(hy),
    ig: series(ig),
    vix: series(vix),
    dgs10: series(fill(prices.length, 4.2)),
    forwardPe: 22,
    revisions: patch.revisions === undefined ? revisions() : patch.revisions,
    breadth: patch.breadth === undefined ? breadth(40, 41, 8, 12) : patch.breadth,
    ...patch.rest,
  };
}

const rising = buildBottomTracker(baseInput({
  prices: ramp(100, 160, 260),
  hy: fill(260, 3.2),
  ig: fill(260, 1.1),
  vix: fill(260, 15),
  revisions: revisions(),
}));
assert.equal(rising.verdict, "no-drawdown");
assert.equal(rising.rule.find((row) => row.id === "potential").pass, false);

const atTheLow = buildBottomTracker(baseInput());
assert.equal(atTheLow.verdict, "slowing", JSON.stringify({
  verdict: atTheLow.verdict,
  blocks: atTheLow.blocks,
  indexes: atTheLow.indexes,
  credit: atTheLow.indicators.find((row) => row.id === "credit")?.stateLabel,
}));
assert.equal(atTheLow.rule.find((row) => row.id === "potential").pass, false);
assert.ok(atTheLow.blocks.some((line) => /low/i.test(line)));
assert.equal(atTheLow.indicators.find((row) => row.id === "valuation").stateLabel, "Still expensive");

const formingPrices = fill(220, 100).concat(ramp(100, 80, 30), ramp(80, 86, 25));
const forming = buildBottomTracker(baseInput({
  prices: formingPrices,
  hy: fill(220, 4).concat(ramp(4, 5.6, 30), ramp(5.6, 5.2, 25)),
  ig: fill(220, 1.1).concat(ramp(1.1, 1.7, 30), ramp(1.7, 1.45, 25)),
  vix: fill(220, 16).concat(ramp(16, 40, 30), ramp(40, 24, 25)),
}));
assert.equal(forming.verdict, "potential", JSON.stringify({
  verdict: forming.verdict,
  blocks: forming.blocks,
  indexes: forming.indexes,
  credit: forming.indicators.find((row) => row.id === "credit")?.stateLabel,
  catalyst: forming.indicators.find((row) => row.id === "catalyst")?.stateLabel,
}));
assert.equal(forming.rule.find((row) => row.id === "potential").pass, true);
assert.equal(forming.indexes.spy.lifted, true);
assert.equal(forming.indexes.qqq.lifted, true);

const fundingStress = buildBottomTracker(baseInput({
  prices: formingPrices,
  hy: fill(220, 4).concat(ramp(4, 5.6, 30), ramp(5.6, 5.2, 25)),
  ig: fill(220, 1.1).concat(ramp(1.1, 1.7, 30), ramp(1.7, 1.45, 25)),
  vix: fill(220, 16).concat(ramp(16, 40, 30), ramp(40, 24, 25)),
  rest: { stress: series(fill(formingPrices.length, 0.2).concat([]).slice(0, formingPrices.length - 8).concat(ramp(0.2, 1.2, 8))) },
}));
assert.notEqual(fundingStress.verdict, "potential");
assert.notEqual(fundingStress.verdict, "emerging");
assert.ok(fundingStress.blocks.some((line) => /funding/i.test(line)) || fundingStress.liquidity || fundingStress.verdict === "slowing" || fundingStress.verdict === "stress");

const noEarnings = buildBottomTracker(baseInput({ revisions: null }));
assert.equal(noEarnings.verdict, "stress");
assert.equal(noEarnings.rule[0].needs.find((need) => need.label === "Earnings downgrades slowing").pass, false);

const wideningIg = buildBottomTracker(baseInput({
  ig: fill(220, 1.1).concat(ramp(1.1, 1.8, 40)),
}));
assert.equal(wideningIg.verdict, "stress");
assert.equal(wideningIg.indicators.find((row) => row.id === "credit").state, "widening");

const calmCredit = buildBottomTracker(baseInput({
  hy: fill(260, 3.2),
  ig: fill(260, 1.05),
}));
assert.equal(calmCredit.verdict, "stress");
assert.equal(calmCredit.indicators.find((row) => row.id === "credit").state, "calm");

const oneSpread = buildBottomTracker(baseInput({ ig: [] }));
assert.equal(oneSpread.rule[0].needs.find((need) => need.label === "Credit stopped widening").pass, false);

const calmRevisions = buildBottomTracker(baseInput({
  revisions: revisions({ downShare30: 0.2, downShare90: 0.22, upShare30: 0.25, netUp30: 2, medianPct30: 0.1, medianPct90: 0.2 }),
}));
assert.equal(calmRevisions.verdict, "stress");
assert.equal(calmRevisions.rule[0].needs.find((need) => need.label === "Earnings downgrades slowing").pass, false);

const longBearPrices = fill(200, 90).concat(fill(80, 160), fill(400, 100), ramp(100, 70, 40), fill(180, 95));
const longBear = buildBottomTracker(baseInput({
  prices: longBearPrices,
  hy: fill(longBearPrices.length, 3.2),
  ig: fill(longBearPrices.length, 1.05),
  vix: fill(longBearPrices.length, 16),
}));
assert.ok(longBear.indexes.spy.drawdown <= -20, JSON.stringify(longBear.indexes.spy));
assert.notEqual(longBear.verdict, "no-drawdown");

const higherLowPrices = fill(180, 100)
  .concat(ramp(99, 76, 30))
  .concat([70])
  .concat(ramp(74, 88, 14))
  .concat(ramp(86, 81, 10))
  .concat([78])
  .concat(ramp(82, 92, 44));
const emergingInput = {
  prices: higherLowPrices,
  hy: fill(180, 4).concat(ramp(4, 5.6, 20), fill(Math.max(0, higherLowPrices.length - 225), 5.6), ramp(5.6, 5.2, 25)),
  ig: fill(180, 1.1).concat(ramp(1.1, 1.7, 20), fill(Math.max(0, higherLowPrices.length - 225), 1.7), ramp(1.7, 1.45, 25)),
  vix: fill(180, 16).concat(ramp(16, 40, 20), ramp(40, 24, higherLowPrices.length - 200)),
  breadth: breadth(30, 42, 16, 7),
  rest: { history: [{ date: shiftDate(dates(higherLowPrices.length).at(-1), -3), verdict: "potential" }] },
};
function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
const emerging = buildBottomTracker(baseInput(emergingInput));
assert.equal(emerging.verdict, "emerging", JSON.stringify({
  verdict: emerging.verdict,
  heldBack: emerging.persistence && emerging.persistence.heldBack,
  indexes: emerging.indexes,
  breadth: emerging.indicators.find((row) => row.id === "breadth")?.stateLabel,
  credit: emerging.indicators.find((row) => row.id === "credit")?.stateLabel,
  catalyst: emerging.indicators.find((row) => row.id === "catalyst")?.stateLabel,
  missing: emerging.missing,
}));
const firstSession = buildBottomTracker(baseInput({ ...emergingInput, rest: {} }));
assert.equal(firstSession.verdict, "potential");
assert.equal(firstSession.persistence.heldBack, "emerging");
const staleSession = buildBottomTracker(baseInput({
  ...emergingInput,
  rest: { history: [{ date: "2018-01-01", verdict: "potential" }] },
}));
assert.equal(staleSession.verdict, "potential");
assert.equal(staleSession.persistence.heldBack, "emerging");
assert.equal(emerging.indexes.spy.higherLow, true);
assert.equal(emerging.indexes.qqq.higherLow, true);
assert.equal(emerging.rule.find((row) => row.id === "confirmed").pass, false);

const thin = summarizeRevisions([{ pct30: -2, pct90: -4 }, { pct30: 1, pct90: -1 }]);
assert.equal(thin.unavailable, true);
const sample = [];
for (let i = 0; i < 12; i++) sample.push({ pct30: i < 4 ? -2 : 0.2, pct90: -3 });
const summed = summarizeRevisions(sample);
assert.equal(summed.unavailable, false);
assert.ok(summed.downShare30 < summed.downShare90);

const priorDates = ["2026-10-20", "2026-10-21", "2026-10-22"];
const persisted = buildBottomTracker({
  ...baseInput(),
  history: priorDates.map((date) => ({ date, verdict: "potential" })),
});
assert.equal(persisted.verdict, "slowing");
assert.equal(persisted.history.at(-1).verdict, "slowing");
assert.equal(persisted.history.filter((row) => row.date === persisted.asOf).length, 1);

function falsePositiveInput() {
  const n = 520;
  const prices = fill(301, 100).concat(ramp(100, 80, 30), fill(40, 80), ramp(80, 70, 40), fill(n - 411, 70));
  const hy = fill(301, 3.5).concat(ramp(3.5, 7, 30), fill(n - 331, 6.9));
  const ig = fill(301, 1.1).concat(ramp(1.1, 1.9, 30), fill(n - 331, 1.85));
  const vix = fill(301, 16).concat(ramp(16, 40, 30), ramp(40, 24, 30), ramp(24, 36, 40), ramp(36, 26, n - 401));
  return buildBottomTracker({
    builtAtIso: "2026-10-24T15:00:00.000Z",
    spy: series(prices, "2018-01-01"),
    qqq: series(prices, "2018-01-01"),
    hy: series(hy, "2018-01-01"),
    ig: series(ig, "2018-01-01"),
    vix: series(vix, "2018-01-01"),
    dgs10: series(fill(n, 4.2), "2018-01-01"),
    forwardPe: 22,
    revisions: revisions(),
    breadth: breadth(40, 41, 10, 12),
  });
}

const timed = falsePositiveInput();
const creditSignal = timed.backtest.signals.find((row) => row.id === "credit-stabilizing");
assert.equal(timed.backtest.status, "ok");
assert.equal(creditSignal.episodes, 1, JSON.stringify(creditSignal));
assert.equal(creditSignal.falsePositiveRate, 1);
assert.equal(creditSignal.timelyRate, 0);
assert.ok(creditSignal.median63 < 0);
assert.equal(["potential", "emerging", "confirmed"].includes(timed.verdict), false);
assert.equal(timed.backtest.note.includes("Earnings revisions"), true);
assert.equal(timed.method.includes("not fit to past bottoms"), true);
assert.equal(timed.bullets.some((row) => row.phase === "early" && row.label.includes("catalyst")), true);
assert.equal(timed.bullets.some((row) => row.phase === "confirm" && row.label.includes("200-day")), true);

console.log("bottom-tracker smoke ok");
