// Overnight scorer, saved call and log (overnight review, 2026-10-26).
import assert from "node:assert/strict";
import { OVERNIGHT_TONE } from "../lib/overnight-tone.mjs";
import {
  etParts, etWallMs, usCloseMs, preOpenCutoffMs, priorUsSession, sigmaPct, fitAsiaEcho,
  buildOvernightInputs, buildOvernightCall, overnightEvents, pbocLprDate,
} from "../lib/overnight-inputs.mjs";
import { mergeOvernightLog, overnightLogSummary, OVERNIGHT_LOG_MAX_ENTRIES } from "../lib/overnight-log.mjs";
import { inPreopenWindow } from "./overnight-preopen.mjs";
import { updateOvernightLog, deriveGlobalTapeAxis, overnightSnapshotOpts } from "./build.mjs";
import { fitReport } from "./overnight-fit.mjs";

const T = OVERNIGHT_TONE;

// ---- ET clock ---------------------------------------------------------------
assert.equal(new Date(preOpenCutoffMs("2026-10-27")).toISOString(), "2026-10-27T13:25:00.000Z", "EDT cutoff");
assert.equal(new Date(preOpenCutoffMs("2026-11-02")).toISOString(), "2026-11-02T14:25:00.000Z", "EST cutoff after the DST change");
assert.equal(new Date(usCloseMs("2026-10-26")).toISOString(), "2026-10-26T20:00:00.000Z");
assert.deepEqual(etParts(Date.parse("2026-10-27T13:20:00Z")), { date: "2026-10-27", minutes: 9 * 60 + 20, weekday: "Tue" });
assert.equal(etWallMs("2026-03-08", 9, 25), Date.parse("2026-03-08T13:25:00Z"), "spring-forward day");
assert.equal(inPreopenWindow(Date.parse("2026-10-27T13:20:00Z")), true);
assert.equal(inPreopenWindow(Date.parse("2026-10-27T13:30:00Z")), false, "09:30 ET is the open, not pre-open");
assert.equal(inPreopenWindow(Date.parse("2026-10-27T11:59:00Z")), false, "07:59 ET is before the window");
assert.equal(inPreopenWindow(Date.parse("2026-10-31T13:20:00Z")), false, "Saturday");

// ---- scorer -----------------------------------------------------------------
const fresh = (movePct, sigmaPct, extra = {}) => ({ movePct, sigmaPct, fresh: true, ...extra });
const allOn = {
  "ES=F": fresh(1.0, 1), "NQ=F": fresh(1.2, 1.2), "RTY=F": fresh(1.1, 1.4),
  "^VIX": fresh(-8, 6, { level: 15 }), "^VIX3M": { fresh: false, staleWhy: "context level", level: 18 },
  "AUDJPY=X": fresh(0.6, 0.6), "HG=F": fresh(1.5, 1.3), "BTC-USD": fresh(3, 3), "ETH-USD": fresh(4, 4),
};
let tone = T.scoreTone(allOn, {});
assert.equal(tone.label, "risk-on");
assert.equal(tone.score, 4, "equities, volatility, FX and growth vote risk-on; rates has no input");
assert.equal(tone.present, 4);
assert.equal(tone.gap.call, "up");
assert.equal(T.tapeAxis(tone).score, 2);

// Every move is scaled by that market's own normal day: 1% on a 3%-sigma
// market is noise, on a 0.5%-sigma market it is a vote.
tone = T.scoreTone({ "ES=F": fresh(1, 3), "AUDJPY=X": fresh(1, 0.5), "HG=F": fresh(-0.1, 1) }, {});
assert.equal(tone.buckets.find((b) => b.key === "equities").vote, 0);
assert.equal(tone.buckets.find((b) => b.key === "fx").vote, 1);

// Stale inputs are left out with a reason and never vote.
tone = T.scoreTone({ "^N225": { fresh: false, staleWhy: "closed since 2026-10-23 (holiday or no session yet)", name: "Nikkei 225" }, "ES=F": fresh(0.1, 1) }, {});
assert.equal(tone.label, "insufficient", "fewer than three groups cannot call a tone");
assert.ok(tone.excluded.some((x) => x.sym === "^N225" && /closed since/.test(x.why)));
assert.equal(T.tapeAxis(tone).score, 0);

// Asia is net of the prior US day it echoes.
const asiaOnly = { "^N225": fresh(2, 1.2), "^KS11": fresh(2, 1.2) };
const echo = T.scoreTone(asiaOnly, { asiaEcho: { beta: 0.8, residSigmaPct: 0.8 }, priorUsPct: 2.5 });
const asiaPart = echo.buckets[0].parts.find((p) => p.key === "asia");
assert.equal(asiaPart.movePct, 0, "a 2% Asia day after a 2.5% US day at beta 0.8 is no news");
assert.equal(asiaPart.z, 0);

// Rates: only a shock votes, and falling yields with falling stocks are a
// flight to safety, not risk-on.
tone = T.scoreTone({ "ES=F": fresh(-1, 1), "ZN=F": fresh(0.6, 0.4), "AUDJPY=X": fresh(-0.6, 0.6) }, {});
const rates = tone.buckets.find((b) => b.key === "rates");
assert.ok(rates.z >= 1 && rates.vote === 0, "flight-to-safety bond rally does not vote risk-on");
tone = T.scoreTone({ "ES=F": fresh(0.1, 1), "ZN=F": fresh(-0.6, 0.4), "AUDJPY=X": fresh(0, 0.6) }, {});
assert.equal(tone.buckets.find((b) => b.key === "rates").vote, -1, "a yield spike votes risk-off");
tone = T.scoreTone({ "ES=F": fresh(0.1, 1), "ZN=F": fresh(-0.2, 0.4), "AUDJPY=X": fresh(0, 0.6) }, {});
assert.equal(tone.buckets.find((b) => b.key === "rates").vote, 0, "a small yield move is not a shock");

// Volatility: an inverted VIX curve is stress even when the VIX move is stale;
// a calm curve with no fresh VIX print is not evidence and stays absent.
tone = T.scoreTone({ "^VIX": { fresh: false, staleWhy: "no print", level: 30 }, "^VIX3M": { fresh: false, level: 25 } }, {});
assert.equal(tone.buckets.find((b) => b.key === "volatility").vote, -1);
tone = T.scoreTone({ "^VIX": { fresh: false, staleWhy: "no print", level: 14 }, "^VIX3M": { fresh: false, level: 17 } }, {});
assert.equal(tone.buckets.find((b) => b.key === "volatility").present, false);

// Gap call flat band.
assert.equal(T.gapCall({ "ES=F": fresh(0.1, 1) }).call, "flat");
assert.equal(T.gapCall({ "ES=F": fresh(-0.2, 1), "NQ=F": fresh(-0.3, 1) }).call, "down");
assert.equal(T.gapCall({}).call, "none");

// Session call: no edge until proven on enough days AND beyond the base rate.
const on = T.scoreTone(allOn, {});
assert.equal(T.sessionCall(on, null).call, "no-edge");
assert.equal(T.sessionCall(on, { toneSession: { n: 80, hitRate: 0.6 }, base: { sessionUp: 0.5 } }).call, "up");
assert.equal(T.sessionCall(on, { toneSession: { n: 80, hitRate: 0.6 }, base: { sessionUp: 0.59 } }).call, "no-edge", "60% is no edge when SPY rose on 59% of sessions");
assert.equal(T.sessionCall(on, { toneSession: { n: 40, hitRate: 0.7 } }).call, "no-edge", "too few graded days");

// Snapshot freshness rules match the saved call.
const snapIn = T.inputsFromSnapshot({
  "^N225": { chPct: 1, sigma1d: 1, asOf: "2026-10-26" },
  "^KS11": { chPct: 1, sigma1d: 1, asOf: "2026-10-27" },
  "^VIX": { chPct: 2, sigma1d: 6, quoteTimeIso: "2026-10-26T19:00:00Z" },
  "^GDAXI": { chPct: 0.5, sigma1d: 1 },
}, { priorUsDate: "2026-10-26", priorUsCloseMs: usCloseMs("2026-10-26"), preOpen: false });
assert.equal(snapIn["^N225"].fresh, false);
assert.equal(snapIn["^KS11"].fresh, true);
assert.equal(snapIn["^VIX"].fresh, false, "a VIX print before the prior close is yesterday's move");
assert.equal(snapIn["^GDAXI"].fresh, false, "Europe counts only before the open");

// ---- inputs from bars ---------------------------------------------------------
function weekdays(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const days = weekdays("2026-06-01", "2026-10-27");
// Deterministic wiggle so sigma is ~1%.
const wiggle = (i, k = 1) => ((((i * 7919 + k * 104729) % 200) - 100) / 100);
function dailyPath(start, dates = days, k = 1) {
  let c = start;
  return dates.map((t, i) => { const o = c; c = c * (1 + wiggle(i, k) / 100); return { t, o, c }; });
}
// 15-minute bars every quarter hour across a window, flat at `level` except a
// jump to `level * (1 + jumpPct/100)` after `jumpAfterMs`.
function intraday(fromMs, toMs, level, jumpAfterMs = Infinity, jumpPct = 0) {
  const out = [];
  for (let ms = fromMs; ms < toMs; ms += 15 * 60000) {
    const c = ms >= jumpAfterMs ? level * (1 + jumpPct / 100) : level;
    out.push({ ms, c, h: c, l: c, v: 100 });
  }
  return out;
}
const callDate = "2026-10-27", priorDate = "2026-10-26";
const priorClose = usCloseMs(priorDate);
const cutoff = preOpenCutoffMs(callDate);
const winFrom = priorClose - 2 * 86400000;
const spyDaily = dailyPath(600, days, 2);
const series = {
  SPY: { daily: spyDaily.filter((b) => b.t <= callDate) },
  QQQ: { daily: dailyPath(500, days, 3) },
  "ES=F": { daily: dailyPath(6000, days, 4), intraday: intraday(priorClose - 4 * 86400000, cutoff + 3600000, 6000, priorClose + 3600000, 0.8) },
  "NQ=F": { daily: dailyPath(21000, days, 5), intraday: intraday(winFrom, cutoff + 3600000, 21000, priorClose + 3600000, 1.0) },
  "AUDJPY=X": { daily: dailyPath(98, days, 6), intraday: intraday(winFrom, cutoff, 98, priorClose + 7200000, 0.7) },
  "HG=F": { daily: dailyPath(4.5, days, 7), intraday: intraday(winFrom, cutoff, 4.5, priorClose + 7200000, 1.2) },
  "^N225": { daily: dailyPath(38000, days, 8) },
  "^HSI": { daily: dailyPath(20000, days.filter((t) => t <= priorDate), 9) },
  "^GDAXI": { daily: dailyPath(19000, days.filter((t) => t < callDate), 10), intraday: intraday(etWallMs(callDate, 3, 0), cutoff, 19000) },
  "^VIX": { daily: dailyPath(16, days, 11), intraday: intraday(priorClose - 3600000, priorClose + 900000, 16) },
};
const built = buildOvernightInputs({ series, callDate, cutoffMs: cutoff });
assert.equal(built.prior.date, priorDate);
assert.ok(Math.abs(built.inputs["ES=F"].movePct - 0.8) < 1e-9, "ES move from the 16:00 ET bar to the 09:25 cutoff");
assert.equal(built.inputs["ES=F"].fresh, true);
assert.ok(built.inputs["ES=F"].sigmaPct > 0.3 && built.inputs["ES=F"].sigmaPct < 1.5);
assert.equal(built.inputs["^N225"].fresh, true);
assert.equal(built.inputs["^N225"].sessionDate, callDate);
assert.equal(built.inputs["^HSI"].fresh, false, "Hang Seng with no session after the prior US day is stale");
assert.match(built.inputs["^HSI"].staleWhy, /closed since 2026-10-26/);
assert.equal(built.inputs["^VIX"].fresh, false, "no VIX print after 16:15 ET");
assert.equal(built.inputs["^GDAXI"].fresh, true);
const call = buildOvernightCall({ series, callDate, cutoffMs: cutoff, calendar: { events: [{ date: callDate, type: "fomc" }] } });
assert.equal(call.date, callDate);
assert.equal(call.tone.gap.call, "up");
assert.equal(call.session.call, "no-edge");
assert.ok(call.events.some((e) => e.kind === "us-event"));
assert.ok(call.events.some((e) => e.kind === "holiday" && /Hang Seng/.test(e.label)));
assert.ok(call.inputs["ES=F"].f === true && call.inputs["^HSI"].f === false);

// No look-ahead: the read uses nothing after the cutoff.
const later = { ...series, "ES=F": { ...series["ES=F"], intraday: [...series["ES=F"].intraday, { ms: cutoff + 60000, c: 1, h: 1, l: 1, v: 1 }] } };
assert.equal(buildOvernightInputs({ series: later, callDate, cutoffMs: cutoff }).inputs["ES=F"].movePct, built.inputs["ES=F"].movePct);

assert.ok(sigmaPct(spyDaily, "2026-10-01") > 0);
assert.equal(sigmaPct(spyDaily.slice(0, 10)), null, "too short for a sigma");
assert.equal(priorUsSession(spyDaily, Date.parse("2026-10-27T13:00:00Z")).date, priorDate);
const echoFit = fitAsiaEcho({ "^N225": series["^N225"].daily, "^KS11": dailyPath(2600, days, 12) }, spyDaily, callDate);
assert.ok(echoFit && Number.isFinite(echoFit.beta) && echoFit.n >= 30);

// ---- events --------------------------------------------------------------------
assert.ok(overnightEvents({ callDate: "2026-10-30" }).some((e) => /Bank of Japan/.test(e.label)));
assert.ok(overnightEvents({ callDate: "2026-11-03" }).some((e) => /RBA/.test(e.label)));
assert.equal(pbocLprDate(2026, 12), "2026-12-21", "the 20th is a Sunday, so the next business day");
assert.ok(overnightEvents({ callDate: "2026-11-06", calendar: { events: [{ date: "2026-11-06", type: "report", subtype: "nfp", title: "Jobs report" }] } })
  .some((e) => e.kind === "us-data" && /Jobs report/.test(e.label)));

// ---- log merge and grading ---------------------------------------------------
const mk = (date, extra = {}) => ({ date, tone: { label: "risk-on", score: 3, gap: { call: "up", movePct: 0.5 }, buckets: [{ key: "equities", present: true, vote: 1, z: 1 }] }, inputs: { "ES=F": { m: 0.5 } }, ...extra });
const spyBars = [{ t: "2026-10-23", o: 99, c: 100 }, { t: "2026-10-26", o: 101, c: 102 }, { t: "2026-10-27", o: 101, c: 100 }];
let log = mergeOvernightLog(null, { calls: [mk("2026-10-26", { reconstructed: true, capturedAtIso: "2026-10-26T15:00:00Z" })], spyBars, qqqBars: spyBars });
assert.equal(log.entries[0].outcome.gapCallHit, true, "SPY opened 1% above the prior close");
assert.equal(log.entries[0].outcome.toneSessionHit, true);
log = mergeOvernightLog(log, { calls: [mk("2026-10-26", { reconstructed: false, capturedAtIso: "2026-10-26T13:20:00Z", tone: { label: "risk-off", score: -3, gap: { call: "down" }, buckets: [] } })], spyBars, qqqBars: spyBars });
assert.equal(log.entries[0].tone.label, "risk-off", "a live call replaces a rebuilt one");
assert.equal(log.entries[0].outcome.gapCallHit, false, "and is graded on its own call");
log = mergeOvernightLog(log, { calls: [mk("2026-10-26", { reconstructed: true, capturedAtIso: "2026-10-26T18:00:00Z" })], spyBars, qqqBars: spyBars });
assert.equal(log.entries[0].tone.label, "risk-off", "a rebuilt call never replaces a live one");
log = mergeOvernightLog(log, { calls: [mk("2026-10-27", { reconstructed: false, capturedAtIso: "2026-10-27T13:05:00Z" })], spyBars, qqqBars: spyBars });
log = mergeOvernightLog(log, { calls: [mk("2026-10-27", { reconstructed: false, capturedAtIso: "2026-10-27T13:20:00Z", tone: { label: "mixed", score: 0, gap: { call: "flat" }, buckets: [] } })], spyBars, qqqBars: spyBars });
const oct27 = log.entries.find((e) => e.date === "2026-10-27");
assert.equal(oct27.tone.label, "mixed", "the later of two live pre-open captures wins");
assert.equal(oct27.outcome.toneSessionHit, null, "a mixed tone is not graded as a hit or miss");
assert.equal(log.stats.base.n, 2);
const many = Array.from({ length: 40 }, (_, i) => mk(`2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, "0")}`));
const big = mergeOvernightLog(null, { calls: many });
assert.equal(big.entries.filter((e) => e.inputs).length, 30, "inputs kept only on the last 30 entries");
assert.ok(OVERNIGHT_LOG_MAX_ENTRIES >= 250);
const summary = overnightLogSummary(log, 5);
assert.equal(summary.n, 2);
assert.equal(summary.recent[0].date, "2026-10-27");

// ---- bake: fold the live call in, rebuild missing days, grade -------------------
const nowMs = Date.parse("2026-10-27T15:00:00Z"); // 11:00 ET
const fullSeries = { ...series, SPY: { daily: spyDaily } };
const fetchArgs = [];
const fetcher = async (opts) => {
  fetchArgs.push(opts);
  return { series: fullSeries, failed: [] };
};
const liveCall = { ...call, capturedAtIso: "2026-10-27T13:20:00.000Z" };
let res = await updateOvernightLog({ priorLog: null, preopenFile: { call: liveCall }, nowMs, fetcher });
assert.equal(res.todayCall?.date, callDate);
assert.equal(res.todayCall.reconstructed, false, "the live call is the day's call");
const rebuilt = res.log.entries.filter((e) => e.reconstructed);
assert.ok(rebuilt.length >= 1, "a missing prior day is rebuilt from 15-minute bars");
assert.ok(rebuilt.every((e) => e.date >= "2026-10-26"), "only days with a full night of 15-minute bars are rebuilt");
assert.ok(res.log.entries.find((e) => e.date === priorDate)?.outcome, "a completed session is graded");
assert.equal(res.todayCall.outcome, undefined, "today is not graded before the close");
assert.equal(fetchArgs.at(-1).intradayDays, 58, "an empty log backfills ~8 weeks");
// A log that is long enough, has today's call and no missed days only needs
// SPY/QQQ daily bars to grade.
const longLog = { ...res.log, entries: [...days.filter((t) => t < "2026-10-01").slice(-45).map((t) => mk(t)), ...res.log.entries.filter((e) => e.date >= "2026-10-01")] };
const light = await updateOvernightLog({ priorLog: longLog, preopenFile: { call: liveCall }, nowMs: Date.parse("2026-10-27T20:30:00Z"), fetcher });
assert.deepEqual(fetchArgs.at(-1).symbols, ["SPY", "QQQ"]);
assert.equal(fetchArgs.at(-1).intradayDays, 0);
assert.equal(light.fetched, "grading");
assert.ok(light.log.entries.find((e) => e.date === callDate)?.outcome, "today is graded once the session has closed");
res = await updateOvernightLog({ priorLog: null, preopenFile: { call: { ...liveCall, forced: true } }, nowMs, fetcher });
assert.equal(res.todayCall.reconstructed, true, "a --force test call is never the day's call");

// ---- regime axis --------------------------------------------------------------------
let axis = deriveGlobalTapeAxis({}, { todayCall: call });
assert.equal(axis.source, "preopen");
assert.ok(axis.score >= 1);
axis = deriveGlobalTapeAxis({}, { snapshotOpts: { preOpen: false } });
assert.equal(axis.source, "none");
assert.equal(axis.score, 0, "after the open with no saved call the axis does not vote");
const snapOpts = overnightSnapshotOpts(spyDaily.filter((b) => b.t <= priorDate), Date.parse("2026-10-27T12:00:00Z"));
assert.equal(snapOpts.preOpen, true);
assert.equal(snapOpts.priorUsDate, priorDate);
assert.equal(overnightSnapshotOpts(spyDaily, Date.parse("2026-10-27T21:00:00Z")).preOpen, false);

// ---- fit report ------------------------------------------------------------------------
const fit = fitReport(res.log.entries);
assert.ok(fit.n >= 1 && Array.isArray(fit.sweep) && fit.sweep.length === 12);

console.log("overnight tone smoke: ok");
