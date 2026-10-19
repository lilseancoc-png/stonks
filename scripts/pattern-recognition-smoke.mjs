// Offline checks for the free pattern pieces and the playbook gates. No network and no Gemini.
import assert from "node:assert/strict";
import {
  buildBreadthRecord,
  buildDivergenceStudy,
  buildLeadLag,
  buildPatternRecognition,
  buildSeasonality,
  buildSentimentAnomaly,
  buildVolatilityCluster,
  mergeDailyCloses,
  needsLongIndexFetch,
} from "../lib/pattern-recognition.mjs";
import { detectPlaybookCues } from "./build.mjs";

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function businessDates(start, end) {
  const dates = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const dow = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(cursor);
  }
  return dates;
}

function barsFromReturns(dates, retFor) {
  let price = 100;
  return dates.map((date) => {
    price *= 1 + retFor(date);
    return { t: date, c: price };
  });
}

const dates = businessDates("2008-01-02", "2024-12-31");
const seasonal = buildSeasonality(barsFromReturns(dates, (date) => (date.slice(5, 7) === "09" ? -0.002 : 0.0004)), "2025-01-15");
assert.ok(seasonal.september.avgPct < 0, "September base rate stays negative when every September day falls");
assert.ok(seasonal.months[0].avgPct > 0, "other months stay positive");
assert.equal(seasonal.provisional, false);
assert.equal(needsLongIndexFetch(barsFromReturns(dates, () => 0.0001)), false);
assert.equal(needsLongIndexFetch(barsFromReturns(businessDates("2024-01-02", "2024-12-31"), () => 0.0001)), true);

const santaDates = new Set();
for (const year of [2012, 2014, 2016, 2018, 2020, 2022]) {
  const december = dates.filter((date) => date.startsWith(`${year}-12`));
  const january = dates.filter((date) => date.startsWith(`${year + 1}-01`));
  december.slice(-5).forEach((date) => santaDates.add(date));
  january.slice(0, 2).forEach((date) => santaDates.add(date));
}
const santa = buildSeasonality(barsFromReturns(dates, (date) => (santaDates.has(date) ? 0.01 : 0)), "2025-06-01");
assert.ok(santa.santa.n >= 6 && santa.santa.avgPct > 0, "Santa windows compound positive when those sessions rise");
assert.equal(buildSeasonality(barsFromReturns(dates, () => 0), "2024-12-26").active.inSanta, true);
const october = businessDates("2026-10-01", "2026-10-30");
const octoberBars = barsFromReturns(october, () => 0.0001);
assert.equal(buildSeasonality(octoberBars, "2026-10-16").active.inTurnOfMonth, false);
assert.equal(buildSeasonality(octoberBars, "2026-10-16").active.inOpexWeek, true);
assert.equal(buildSeasonality(octoberBars, "2026-10-30").active.inTurnOfMonth, true);
const spiked = barsFromReturns(businessDates("2014-01-02", "2024-12-31"), (date) => (date === "2018-09-04" ? 0.8 : (date.slice(5, 7) === "09" ? -0.002 : 0.0002)));
const spikedSeason = buildSeasonality(spiked, "2025-01-15");
assert.ok(spikedSeason.droppedExtremeDays >= 1, "a one-day print above 25% is left out of seasonality");
assert.ok(spikedSeason.september.avgPct < 0, "one bad print does not flip September");

const midterm = buildSeasonality(barsFromReturns(dates, (date) => (Number(date.slice(0, 4)) % 4 === 2 ? 0.001 : -0.0004)), "2025-01-15");
assert.ok(midterm.midterm.n >= 4, "midterm bucket has several completed years");
assert.ok(midterm.midterm.avgPct > midterm.midterm.otherAvgPct, "midterm years separate from the other years");

const merged = mergeDailyCloses([{ t: "2024-01-02", c: 10 }, { t: "2024-01-03", c: 11 }], [{ t: "2024-01-03", c: 12 }]);
assert.deepEqual(merged, [{ t: "2024-01-02", c: 10 }, { t: "2024-01-03", c: 12 }]);

const volReturns = [];
for (let block = 0; block < 15; block++) {
  for (let i = 0; i < 18; i++) volReturns.push(0.001);
  for (let i = 0; i < 6; i++) volReturns.push(i % 2 ? -0.03 : 0.03);
}
const volDates = businessDates("2020-01-02", "2030-01-01").slice(0, volReturns.length);
const vol = buildVolatilityCluster(volDates.reduce((bars, date, i) => {
  const prev = bars.length ? bars[bars.length - 1].c : 100;
  bars.push({ t: date, c: prev * (1 + volReturns[i]) });
  return bars;
}, []));
assert.equal(vol.state, "expanding");
assert.equal(vol.clusteringPresent, true);
assert.ok(vol.sample.expanding.nextAbsPct > vol.sample.calm.nextAbsPct);

const leadDates = businessDates("2022-01-03", "2024-12-31");
let foreignPrice = 100;
let usPrice = 100;
let previousForeign = 0;
const foreignBars = [];
const usBars = [];
leadDates.forEach((date, i) => {
  const foreignRet = Math.sin(i / 3) * 0.01;
  foreignPrice *= 1 + foreignRet;
  usPrice *= 1 + previousForeign;
  foreignBars.push({ t: date, c: foreignPrice });
  usBars.push({ t: date, c: usPrice });
  previousForeign = foreignRet;
});
const lead = buildLeadLag([{ us: "XLE", peer: "CL=F", sessionClass: "24h", usBars, peerBars: foreignBars }]);
assert.equal(lead.rows[0].read, "prior-session link is large in-sample");
assert.ok(lead.rows[0].lag1Beta > 0.8 && Math.abs(lead.rows[0].lag1T) >= 2);

const breakDates = businessDates("2021-01-04", "2024-12-31");
let shared = 100;
let usBreak = 100;
let foreignBreak = 100;
const sharedUs = [];
const sharedForeign = [];
breakDates.forEach((date, i) => {
  const common = Math.sin(i / 4) * 0.01;
  if (i < breakDates.length - 70) {
    shared *= 1 + common;
    sharedUs.push({ t: date, c: shared });
    sharedForeign.push({ t: date, c: shared });
  } else {
    usBreak *= 1 + Math.sin(i / 2.2) * 0.008;
    foreignBreak *= 1 + Math.cos(i / 5) * 0.012;
    sharedUs.push({ t: date, c: usBreak });
    sharedForeign.push({ t: date, c: foreignBreak });
  }
});
const broken = buildLeadLag([{ us: "NVDA", peer: "000660.KS", sessionClass: "leading", usBars: sharedUs, peerBars: sharedForeign }]);
assert.equal(broken.rows[0].broken, true);

let crash = 100;
const divCloses = [];
const divDates = businessDates("2024-01-02", "2024-12-31").slice(0, 82);
for (let i = 0; i < divDates.length; i++) {
  let ret = 0.0002;
  if (i >= 26 && i <= 36) ret = -0.025;
  else if (i >= 37 && i <= 40) ret = 0.004;
  else if (i >= 41 && i <= 48) ret = 0.008;
  else if (i >= 49 && i <= 70) ret = -0.011;
  else if (i >= 71) ret = 0.004;
  crash *= 1 + ret;
  divCloses.push(crash);
}
const divergence = buildDivergenceStudy([{ symbol: "TEST", closes: divCloses, dates: divDates }]);
assert.ok(divergence.rows.some((row) => row.symbol === "TEST" && row.direction === "bullish"), "a lower price low with a milder second drop is a bullish divergence");

const spyUp = barsFromReturns(businessDates("2024-01-02", "2024-06-28"), () => 0.003);
const fear = buildSentimentAnomaly(spyUp.map((row) => ({ date: row.t, score: 10 })), spyUp);
assert.equal(fear.state, "fear while price is up");
assert.ok(fear.fear.n >= 20 && fear.fear.avgPct > 0);

const regimeDays = spyUp.filter((_row, i) => i % 3 === 0).map((row) => ({
  date: row.t,
  axisScores: { indexes: 1, breadth: -1 },
}));
const breadth = buildBreadthRecord(regimeDays, spyUp);
assert.equal(breadth.active, true);
assert.ok(breadth.forward5.n >= 20 && breadth.forward5.avgPct > 0);

const payload = buildPatternRecognition({
  asOf: "2024-06-28",
  builtAtIso: "2024-06-28T20:00:00.000Z",
  indexBars: { SPY: spyUp, QQQ: spyUp, IWM: spyUp },
  spyBars: spyUp,
  peers: [],
  divergences: [],
  regimeDays,
  fearGreed: spyUp.map((row) => ({ date: row.t, score: 80 })),
  extraYahooCharts: 0,
});
assert.equal(payload.cost.gemini, false);
assert.equal(payload.cost.serpApi, false);
assert.equal(payload.cost.newVendor, false);
assert.equal(payload.separate, true);
assert.equal(payload.pieces.sentiment.state, "aligned");

function cueIds(iso) {
  return detectPlaybookCues({ chains: {}, calendar: { releases: [] } }, new Date(iso)).map((cue) => cue.id);
}
assert.ok(cueIds("2025-12-26T16:00:00Z").includes("santa"));
assert.ok(cueIds("2025-09-15T16:00:00Z").includes("septemberWeak"));
assert.ok(cueIds("2025-05-06T16:00:00Z").includes("sellInMay"));
assert.ok(cueIds("2025-09-17T16:00:00Z").includes("tripleWitching"));
assert.equal(cueIds("2025-07-15T16:00:00Z").some((id) => ["santa", "septemberWeak", "sellInMay", "tripleWitching"].includes(id)), false);

console.log("pattern-recognition-smoke: ok");
