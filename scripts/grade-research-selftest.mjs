// Deterministic checks for the grade-edge report and the paper books.
// No network, no writes, no model calls.
import assert from "node:assert/strict";
import { bsPrice } from "../lib/greeks.mjs";
import { buildGradeResearch, prepareSeries, RESEARCH_START } from "../lib/grade-research.mjs";

const dates = Array.from({ length: 80 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 5 + i));
  return d.toISOString().slice(0, 10);
});

function seriesFromReturns(start, dailyRets) {
  const closes = [start];
  for (const r of dailyRets) closes.push(closes[closes.length - 1] * (1 + r));
  return { dates: dates.slice(0, closes.length), closes };
}

function flatSpy() {
  return { dates: dates.slice(), closes: dates.map(() => 100) };
}

// Monotone grade: name i earns a larger 10-day move than name i-1.
function monotoneUniverse() {
  const series = { SPY: flatSpy() };
  const totals = {};
  for (let i = 0; i < 20; i += 1) {
    const symbol = `N${String(i).padStart(2, "0")}`;
    const daily = (i - 9.5) * 0.0008;
    series[symbol] = seriesFromReturns(100, Array.from({ length: 70 }, () => daily));
    totals[symbol] = i - 9.5;
  }
  const days = dates.slice(0, 41).map((date) => ({ date, totals }));
  return { series, days };
}

const mono = monotoneUniverse();
const report = buildGradeResearch({
  ...mono,
  builtAtIso: "2026-03-01T00:00:00.000Z",
  placeboDraws: 40,
  seed: 1337,
});
const h10 = report.horizons["10"];

assert.equal(report.ok, true);
assert.equal(h10.quintileOrdered, true, "higher grade bins must earn a higher forward return");
assert.ok(h10.quintiles[4].meanFwdPct > h10.quintiles[0].meanFwdPct);
assert.ok(h10.overlapping.meanIc > 0.9, `expected a near-perfect IC, got ${h10.overlapping.meanIc}`);
assert.ok(h10.nonOverlapping.days >= 4 && h10.nonOverlapping.days <= 5, `non-overlapping count ${h10.nonOverlapping.days}`);
assert.ok(h10.nonOverlapping.days < h10.overlapping.days);
assert.equal(h10.placebo.above95, true, "a real rank signal must beat the shuffle band");
assert.equal(report.killLine.established, false, "the short fixture has fewer than 30 non-overlapping 5-session windows");
assert.match(report.killLine.reason, /30/);
assert.equal(report.method.evaluationHorizon, 5);

const again = buildGradeResearch({ ...mono, placeboDraws: 40, seed: 1337 });
assert.equal(again.horizons["10"].placebo.p95, h10.placebo.p95, "placebo band is seeded");

// Reversed grades must flip the ladder and the IC.
const flippedDays = mono.days.map((day) => ({
  date: day.date,
  totals: Object.fromEntries(Object.entries(day.totals).map(([symbol, grade]) => [symbol, -grade])),
}));
const flipped = buildGradeResearch({ series: mono.series, days: flippedDays, placeboDraws: 10, seed: 7 });
assert.equal(flipped.horizons["10"].quintileOrdered, false);
assert.ok(flipped.horizons["10"].overlapping.meanIc < -0.9);

// One-day jump only: the same-day 5-day return sees it, the delayed entry does not.
const jumpSeries = { SPY: flatSpy() };
const jumpTotals = {};
for (let i = 0; i < 20; i += 1) {
  const symbol = `J${String(i).padStart(2, "0")}`;
  const closes = dates.map(() => 100);
  closes[1] = 100 * (1 + (i - 9.5) * 0.01);
  for (let k = 2; k < closes.length; k += 1) closes[k] = closes[1];
  jumpSeries[symbol] = { dates: dates.slice(), closes };
  jumpTotals[symbol] = i - 9.5;
}
const jump = buildGradeResearch({
  series: jumpSeries,
  days: [{ date: dates[0], totals: jumpTotals }],
  placeboDraws: 5,
  seed: 1,
});
assert.ok(jump.horizons["5"].overlapping.meanIc > 0.9);
assert.equal(jump.horizons["5"].delay.meanIc, null, "a delayed entry after a one-day jump has no cross-sectional variation");

// Stock that copies SPY has a residual near zero. An idiosyncratic name does not.
const betaSeries = {
  SPY: seriesFromReturns(100, Array.from({ length: 50 }, () => 0.002)),
};
const idio = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.008));
betaSeries.CLONE = { dates: betaSeries.SPY.dates.slice(), closes: betaSeries.SPY.closes.slice() };
betaSeries.IDIO = seriesFromReturns(100, idio);
for (let i = 0; i < 18; i += 1) {
  betaSeries[`F${i}`] = seriesFromReturns(50 + i, Array.from({ length: 50 }, (_, k) => ((i + k) % 5 - 2) * 0.001));
}
const betaDay = dates[40];
const betaTotals = Object.fromEntries(Object.keys(betaSeries).filter((s) => s !== "SPY").map((s, i) => [s, i - 10]));
const betaReport = buildGradeResearch({
  series: betaSeries,
  days: [{ date: betaDay, totals: betaTotals }],
  sectors: { CLONE: "Index", IDIO: "Index", ...Object.fromEntries(Object.keys(betaSeries).filter((s) => s.startsWith("F")).map((s) => [s, "Other"])) },
  placeboDraws: 1,
  seed: 1,
});
const clone = prepareSeries(betaSeries.CLONE);
const spy = prepareSeries(betaSeries.SPY);
assert.ok(Math.abs(clone.closes.at(-1) / clone.closes[0] - spy.closes.at(-1) / spy.closes[0]) < 1e-9);

// Grade-scale book: top decile +10% over 10 days, bottom decile -10%.
const scaleSeries = { SPY: { dates: dates.slice(0, 21), closes: dates.slice(0, 21).map(() => 100) } };
const scaleTotals = {};
for (let i = 0; i < 20; i += 1) {
  const symbol = `S${String(i).padStart(2, "0")}`;
  const ret = i < 2 ? -0.10 : i >= 18 ? 0.10 : 0;
  const closes = [100];
  for (let k = 1; k <= 20; k += 1) closes.push(k === 10 ? 100 * (1 + ret) : closes[k - 1]);
  // Hold the post-move price so the 10-day return is exactly ret.
  closes[10] = 100 * (1 + ret);
  for (let k = 11; k < closes.length; k += 1) closes[k] = closes[10];
  scaleSeries[symbol] = { dates: dates.slice(0, closes.length), closes };
  scaleTotals[symbol] = i - 10;
}
const scale = buildGradeResearch({
  series: scaleSeries,
  days: [{ date: dates[0], totals: scaleTotals }],
  placeboDraws: 1,
  seed: 1,
});
const scaleBook = scale.books.find((book) => book.id === "scale");
assert.equal(scaleBook.trades, 1);
assert.equal(scaleBook.returnPct, 10);
assert.equal(scaleBook.final, 110000);
assert.equal(scaleBook.cagr, null, "a 10-day book must not print a CAGR");

// Risk budget: 10% stop, +10% stock move, one contract of risk.
const riskDates = dates.slice(0, 21);
const riskSeries = {
  SPY: { dates: riskDates, closes: riskDates.map(() => 100) },
  AAA: { dates: riskDates, closes: riskDates.map((_, i) => 100 + Math.min(i, 10)) },
};
const riskPicks = {
  closed: [{
    symbol: "AAA", side: "call", entryDate: riskDates[0], entrySpot: 100, cut: 90, sector: "Tech", score: 8,
    contract: { structure: "long", strike: 100, iv: 0.3, dte: 60, mid: 5 },
  }],
};
const riskReport = buildGradeResearch({
  series: riskSeries,
  days: [{ date: riskDates[0], totals: { AAA: 8, ...Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`Z${i}`, 0])) } }],
  picks: riskPicks,
  placeboDraws: 1,
  seed: 1,
});
// The extra Z names have no prices, so the grade cross-section is thin. The book still uses the pick.
const riskBook = riskReport.books.find((book) => book.id === "risk");
const expectedPnl = RESEARCH_START * 0.05 * 0.10;
assert.ok(Math.abs(riskBook.final - (RESEARCH_START + expectedPnl)) < 1, `risk final ${riskBook.final} vs ${RESEARCH_START + expectedPnl}`);
assert.equal(riskBook.trades, 1);
assert.ok(Math.abs(riskBook.avgR - 1) < 0.02, `expected about 1R, got ${riskBook.avgR}`);

const putSeries = {
  SPY: { dates: riskDates, closes: riskDates.map(() => 100) },
  PUT: { dates: riskDates, closes: riskDates.map((_, i) => 100 - Math.min(i, 10)) },
};
const putReport = buildGradeResearch({
  series: putSeries,
  days: [],
  picks: { closed: [{ symbol: "PUT", side: "put", entryDate: riskDates[0], cut: 110, sector: "Tech", score: 8, contract: { structure: "long", strike: 100, iv: 0.3, dte: 60, mid: 5 } }] },
  placeboDraws: 1,
  seed: 1,
});
const putBook = putReport.books.find((book) => book.id === "risk");
assert.ok(Math.abs(putBook.final - 100500) < 1, `put final ${putBook.final}`);
const frozen = JSON.parse(JSON.stringify(riskPicks));
buildGradeResearch({ series: riskSeries, days: [], picks: riskPicks, placeboDraws: 1, seed: 1 });
assert.deepEqual(riskPicks, frozen, "research must not rewrite the stored picks");

// Sector cap keeps the fourth same-sector name out.
const capSeries = { SPY: { dates: riskDates, closes: riskDates.map(() => 100) } };
const capPicks = [];
for (let i = 0; i < 4; i += 1) {
  const symbol = `C${i}`;
  capSeries[symbol] = { dates: riskDates, closes: riskDates.map(() => 100) };
  capPicks.push({ symbol, side: "call", entryDate: riskDates[0], cut: 90, sector: "Same", score: 10 - i, contract: { structure: "long", strike: 100, iv: 0.3, dte: 60, mid: 4 } });
}
const cap = buildGradeResearch({ series: capSeries, days: [], picks: { closed: capPicks }, placeboDraws: 1, seed: 1 });
const capBook = cap.books.find((book) => book.id === "risk");
assert.equal(capBook.trades, 3);
assert.equal(capBook.skipped.sector, 1);

// Delay enters the next close. A jump on the signal day is missed; the later drift is kept.
const delayDates = dates.slice(0, 21);
const delayCloses = delayDates.map((_, i) => (i === 0 ? 100 : 110));
const delaySeries = {
  SPY: { dates: delayDates, closes: delayDates.map(() => 100) },
  DLY: { dates: delayDates, closes: delayCloses },
};
const delayPicks = { closed: [{ symbol: "DLY", side: "call", entryDate: delayDates[0], cut: 90, sector: "Tech", score: 9, contract: { structure: "long", strike: 100, iv: 0.25, dte: 45, mid: 3 } }] };
const delay = buildGradeResearch({ series: delaySeries, days: [], picks: delayPicks, placeboDraws: 1, seed: 1 });
const listBook = delay.books.find((book) => book.id === "list");
const costBook = delay.books.find((book) => book.id === "cost");
assert.ok(listBook.returnPct > 0, "the signal-close book collects the jump");
assert.equal(costBook.returnPct, 0, "the next-close book buys after the jump");
assert.equal(costBook.optionStress.n, 1);
assert.ok(costBook.optionStress.spreadCapPct < costBook.optionStress.unchangedPct);

// Flat stock, lower exit IV, long call is worth less.
const flatDates = dates.slice(0, 16);
const flatSeries = {
  SPY: { dates: flatDates, closes: flatDates.map(() => 100) },
  FLT: { dates: flatDates, closes: flatDates.map(() => 100) },
};
const flat = buildGradeResearch({
  series: flatSeries,
  days: [],
  picks: { closed: [{ symbol: "FLT", side: "call", entryDate: flatDates[0], cut: 90, sector: "Tech", score: 7, contract: { structure: "long", strike: 100, iv: 0.4, dte: 60, mid: bsPrice("call", 100, 100, 60 / 365.25, 0.4, 0.045) } }] },
  placeboDraws: 1,
  seed: 1,
});
const stress = flat.books.find((book) => book.id === "cost").optionStress;
assert.ok(stress.ivDown20Pct < stress.unchangedPct, "an IV cut must reduce a long call when the stock is flat");
assert.ok(stress.spreadCapPct < stress.unchangedPct);

// A 20% drawdown blocks the next entry. One oversized loser, then a later winner.
const ddDates = dates.slice(0, 31);
const ddSeries = { SPY: { dates: ddDates, closes: ddDates.map(() => 100) } };
ddSeries.LOSE = { dates: ddDates, closes: ddDates.map((_, i) => (i < 10 ? 100 - i * 5 : 50)) };
ddSeries.WIN = { dates: ddDates, closes: ddDates.map((_, i) => (i < 12 ? 100 : 130)) };
const dd = buildGradeResearch({
  series: ddSeries,
  days: [],
  picks: { closed: [
    { symbol: "LOSE", side: "call", entryDate: ddDates[0], cut: 99, sector: "A", score: 9, contract: { structure: "long", strike: 100, iv: 0.3, dte: 40, mid: 2 } },
    { symbol: "WIN", side: "call", entryDate: ddDates[12], cut: 90, sector: "B", score: 9, contract: { structure: "long", strike: 100, iv: 0.3, dte: 40, mid: 2 } },
  ] },
  placeboDraws: 1,
  seed: 1,
});
const ddBook = dd.books.find((book) => book.id === "risk");
assert.equal(ddBook.trades, 1, "the winner must stay out after a 20% drawdown");
assert.equal(ddBook.skipped.flat, 1);
assert.ok(ddBook.returnPct < -20);

console.log("grade-research self-test ok");
