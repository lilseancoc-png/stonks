#!/usr/bin/env node
// Regime Lab research runner (C9 stays manual: there is no workflow for this).
//
// Runs the catalog's "now" tests (F1-F9, F11-F13, F15-F19, F22) on the long
// history download and the Owner's grade caches, counts every setup tried
// (G3), keeps the two holdout windows locked unless `holdout` unlocks one
// once (G4), and writes two outputs:
//   --out DIR      the full run (every window, every book) for the Owner's
//                  private research folder; never committed
//   --public FILE  research/regime-lab/results/latest.json: per-test verdicts
//                  and aggregate reads only (no trade rows, no record), which
//                  the bake joins into regime-lab.json's catalog
// No AI call, no network, no store access, nothing written into data/.
//
// Usage:
//   node scripts/regime-lab.mjs labels   [--long DIR] [--out DIR]
//   node scripts/regime-lab.mjs run      [--tests F1,F3] [--windows id,id] [flags]
//   node scripts/regime-lab.mjs holdout  --window 2022-bear [flags]
// Flags:
//   --long DIR          long-history download dir (bars.json.gz + fred.json.gz)
//                       default $REGIME_LAB_LONG or research/long-history
//   --grades FILE       price-half grade cache { days: { date: { SYM: total } } }
//   --daily-grades FILE real daily grades text: "YYYY-MM-DD SYM:total SYM:total ..."
//   --iv FILE           per-name IV samples { SYM: [{ date, iv }] } for the IV/RV ratio
//   --out DIR           private results dir (default $REGIME_LAB_OUT or ./regime-lab-out)
//   --public FILE       public-safe summary (default research/regime-lab/results/latest.json)
//   --dry               compute, print, write nothing
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLongHistory } from "../research/macro-backtest/common.mjs";
import { TICKERS, SECTORS, sectorGroupOf } from "./build.mjs";
import { buildLabelInputs, RESEARCH_RESULTS_PATH } from "../lib/regime-lab/payload.mjs";
import { buildLabelSeries, realizedVol, LABEL_RULES_VERSION } from "../lib/regime-lab/labels.mjs";
import { hmmLabelSeries } from "../lib/regime-lab/hmm.mjs";
import { makeContext, simulate, scorecard, WINDOWS, HOLDOUT_WINDOW_IDS, REAL_IV_SINCE, priceHalfOnly } from "../lib/regime-lab/harness.mjs";
import { icByLabel, labelStability, strategyComparison, exitRuleComparison, oracleSuite, walkForwardTest, resemblesNow, stockLabelTest, correlationEraTest, eventLoadTest, stressRerun, TESTS_VERSION } from "../lib/regime-lab/tests.mjs";
import { buildHeadlineBook, monthlyReleaseRows } from "../lib/regime-lab/oracle.mjs";
import { createTrialLedger, assertCausal, GUARDS_VERSION } from "../lib/regime-lab/guards.mjs";
import { TEST_CATALOG, CATALOG_BY_ID, CATALOG_VERSION } from "../lib/regime-lab/catalog.mjs";
import { EXIT_RULE_SETS } from "../lib/regime-lab/exits.mjs";
import { STRATEGIES } from "../lib/regime-lab/playbooks.mjs";
import { FOMC_DECISIONS, fomcOutcomes } from "../lib/historical-events.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { cmd: null, flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith("--")) { out.flags[k] = next; i++; } else out.flags[k] = true;
    } else if (!out.cmd) out.cmd = a;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
function rowsOf(b) { return b.t.map((t, i) => ({ t, c: b.c[i], h: b.h?.[i], l: b.l?.[i], o: b.o?.[i] })); }

function loadGrades({ gradesFile, dailyFile, calSet }) {
  const grades = {};
  let weekly = 0, daily = 0;
  if (gradesFile && fs.existsSync(gradesFile)) {
    const parsed = JSON.parse(fs.readFileSync(gradesFile, "utf8"));
    for (const [d, row] of Object.entries(parsed.days || parsed || {})) {
      if (!DATE_RE.test(d) || !calSet.has(d) || !row || typeof row !== "object") continue;
      const g = {};
      for (const [sym, v] of Object.entries(row)) { const t = num(v); if (t != null) g[sym] = t; }
      if (Object.keys(g).length) { grades[d] = g; weekly++; }
    }
  }
  if (dailyFile && fs.existsSync(dailyFile)) {
    for (const line of fs.readFileSync(dailyFile, "utf8").split(/\r?\n/)) {
      const m = line.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(.*)$/);
      if (!m || !calSet.has(m[1])) continue;
      const g = {};
      for (const tok of m[2].split(/\s+/)) { const mm = tok.match(/^([A-Z][A-Z0-9.-]{0,6}):(-?\d+(?:\.\d+)?)$/); if (mm) g[mm[1]] = Number(mm[2]); }
      if (Object.keys(g).length) { grades[m[1]] = g; daily++; }
    }
  }
  return { grades, weekly, daily, days: Object.keys(grades).length };
}

function loadIvRatios(ivFile, bars) {
  if (!ivFile || !fs.existsSync(ivFile)) return { ratios: null, names: 0 };
  const parsed = JSON.parse(fs.readFileSync(ivFile, "utf8"));
  const ratios = {};
  for (const [sym, rows] of Object.entries(parsed || {})) {
    const b = bars[sym];
    if (!b || !Array.isArray(rows)) continue;
    const idx = new Map(b.t.map((t, i) => [t, i]));
    const xs = [];
    for (const r of rows) {
      const i = idx.get(String(r?.date || "").slice(0, 10));
      const iv = num(r?.iv);
      if (i == null || iv == null || i < 21) continue;
      const rv = realizedVol(b.c, 20, i);
      if (rv > 0) xs.push(iv / rv);
    }
    if (xs.length >= 10) { xs.sort((a, b2) => a - b2); ratios[sym] = r2(xs[Math.floor(xs.length / 2)]); }
  }
  return { ratios, names: Object.keys(ratios).length };
}

// Build the research context once: long bars, labels, grades, events.
export function buildResearchContext({ longDir, gradesFile = null, dailyFile = null, ivFile = null, quiet = false } = {}) {
  const H = loadLongHistory(longDir);
  const bars = H.bars;
  if (!bars.SPY) throw new Error("the long history has no SPY");
  const cal = bars.SPY.t.slice();
  const calSet = new Set(cal);
  const universe = TICKERS.filter((s) => bars[s]);
  const members = {};
  for (const sym of universe) { if (SECTORS[sym] === "ETF") continue; members[sym] = rowsOf(bars[sym]); }
  const vix = (H.fred.VIXCLS?.t || []).map((t, i) => ({ t, v: H.fred.VIXCLS.v[i] }));
  const inputs = buildLabelInputs({ spy: rowsOf(bars.SPY), spyBars: rowsOf(bars.SPY), qqq: bars.QQQ ? rowsOf(bars.QQQ) : [], iwm: bars.IWM ? rowsOf(bars.IWM) : [], vix, vix3m: [], members, maxSessions: Infinity });
  // Scheduled macro dates the label's event load may count ahead of time:
  // FOMC decisions are announced a year out. CPI, jobs and earnings dates are
  // not in the research set, so the long-span event load reads FOMC weeks only.
  const macroEvents = FOMC_DECISIONS.map((d) => ({ label: "FOMC", date: d }));
  const series = buildLabelSeries({ cal: inputs.cal, spyBars: inputs.spyBars, vix: inputs.vix, vix3m: inputs.vix3m, indexes: inputs.indexes, breadth50: inputs.breadth50, members: inputs.members, macroEvents, start: 60 });
  assertCausal(series);
  series.spyCloses = inputs.spyCloses.slice();
  const rets = inputs.spyCloses.map((c, i) => (i > 0 && c > 0 && inputs.spyCloses[i - 1] > 0 ? Math.log(c / inputs.spyCloses[i - 1]) : null));
  let hmm = null;
  try { hmm = hmmLabelSeries({ cal: inputs.cal, returns: rets, states: 2 }); } catch (err) { if (!quiet) log(`hmm skipped: ${err.message}`); }
  const g = loadGrades({ gradesFile, dailyFile, calSet });
  const iv = loadIvRatios(ivFile, bars);
  const ctxBars = {};
  for (const sym of [...universe, "SPY", "QQQ", "IWM"]) if (bars[sym]) ctxBars[sym] = bars[sym];
  const ctx = makeContext({
    cal: inputs.cal, bars: ctxBars, grades: g.grades, labels: series, sectorOf: sectorGroupOf,
    isEtf: (s) => SECTORS[s] === "ETF", events: { earnings: {}, macro: FOMC_DECISIONS.slice() }, ivRatio: iv.ratios,
  });
  const meta = {
    sessions: inputs.cal.length, from: inputs.cal[0], to: inputs.cal[inputs.cal.length - 1], names: universe.length, members: Object.keys(inputs.members || {}).length,
    gradeDays: g.days, weeklyGradeDays: g.weekly, dailyGradeDays: g.daily, ivRatioNames: iv.names, labelRules: LABEL_RULES_VERSION,
    note: "Grades before 2026-06-24 are the engine's price half (no option or news inputs), one day a week; real daily grades cover 2026-06-24 onward. Modeled options throughout (real IV history starts " + REAL_IV_SINCE + "). Earnings dates are not in the research set: no trade is flagged as crossing a print.",
  };
  if (!quiet) log(`context: ${meta.sessions} sessions ${meta.from}..${meta.to}, ${meta.names} names (${meta.members} members), ${meta.gradeDays} grade days (${meta.weeklyGradeDays} weekly + ${meta.dailyGradeDays} daily), IV ratios for ${meta.ivRatioNames}`);
  return { ctx, series, hmm, inputs, H, meta };
}

// ---------------------------------------------------------------------------
// The oracle book from the research set: FOMC (decision table), CPI and
// jobs (FRED monthly series dated by their reference month; the release
// lands the next month, so the reaction session is the first session on or
// after the 10th of the following month, a stand-in for the true release
// day). Earnings need the Owner's store and are added at bake time.
// ---------------------------------------------------------------------------
function monthlyReleaseDates(series, { dayOfMonth = null, firstWeekday = null } = {}) {
  const out = [];
  for (const t of series?.t || []) {
    const d = new Date(t + "T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(1);
    if (firstWeekday != null) { while (d.getUTCDay() !== firstWeekday) d.setUTCDate(d.getUTCDate() + 1); }
    else d.setUTCDate(dayOfMonth || 12);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function researchOracle(R) {
  const fred = R.H.fred;
  // Release days are approximated (jobs: the first Friday of the next month;
  // CPI: the 12th), so a reaction can land a session or two off and the
  // long-span hit rates read low. The bake's oracle uses the real release
  // calendar and the Owner's earnings store.
  const cpi = monthlyReleaseRows(monthlyReleaseDates(fred.CPIAUCSL, { dayOfMonth: 12 }), fred.CPIAUCSL ? { t: fred.CPIAUCSL.t, v: fred.CPIAUCSL.v } : null, { kind: "pct" });
  const jobs = monthlyReleaseRows(monthlyReleaseDates(fred.PAYEMS, { firstWeekday: 5 }), fred.PAYEMS ? { t: fred.PAYEMS.t, v: fred.PAYEMS.v } : null, { kind: "diff" });
  const fomc = [...fomcOutcomes().byDate.entries()].map(([date, o]) => ({ date, outcome: o?.type, bp: o?.bp })).filter((r) => r.date >= R.meta.from);
  const book = buildHeadlineBook({ cal: R.ctx.cal, earnings: [], fomc, cpi: cpi.filter((r) => r.date >= R.meta.from), jobs: jobs.filter((r) => r.date >= R.meta.from) });
  const suite = oracleSuite({ book, barsOf: (sym) => R.H.bars[sym] || null, ivRatioOf: (sym) => R.ctx.ivRatioOf(sym) });
  return { book, suite };
}

// ---------------------------------------------------------------------------
// Per-test summaries for the public file: verdict, sample, aggregate read.
// ---------------------------------------------------------------------------
function summarize(id, res, extra = {}) {
  const ranAt = new Date().toISOString().slice(0, 10);
  const base = { verdict: res?.verdict || null, have: 0, priceHalf: true, ranAt, read: null, note: null, ...extra };
  if (!res) return { ...base, verdict: null, note: "not run" };
  switch (id) {
    case "F1": return { ...base, have: res.days, read: { allIc: res.all?.ic, trendingIc: res.trending?.ic, chopIc: res.chop?.ic, transitionIc: res.transition?.ic, trendingDays: res.trending?.days, chopDays: res.chop?.days, firstHalf: res.trending?.firstHalfIc, secondHalf: res.trending?.secondHalfIc } };
    case "F2": return { ...base, have: extra.sessions || 0, read: { gridSwitchesPerYear: res.grid?.flipsPerYear, gridLagDays: res.grid?.avgLagDays, gridRatio: res.grid?.separation?.ratio, hmmSwitchesPerYear: res.hmm?.flipsPerYear, hmmRatio: res.hmm?.separation?.ratio, agreementPct: res.agreementPct, preferred: res.preferred } };
    case "F3": return { ...base, have: res.windows?.length || 0, read: Object.fromEntries(Object.entries(res.summary || {}).map(([k, v]) => [k, { avgNet: v.avgNet, winPct: v.avgWinPct, beatBaseline: v.beatBaseline, trades: v.trades }])) };
    case "F4": {
      const cells = Object.entries(res.cash?.byCell || {}).filter(([, v]) => v.cashBetter != null);
      return { ...base, verdict: cells.length ? (cells.some(([, v]) => v.cashBetter) ? "pass" : "fail") : "insufficient", have: cells.length, read: Object.fromEntries(cells.map(([k, v]) => [k, { n: v.n, avg: v.avg, cashBetter: v.cashBetter, bestSide: v.bestSide }])) };
    }
    case "F5": case "F6": case "F7": case "F8": case "F9": return { ...base, have: res.windows?.length || 0, read: Object.fromEntries((res.ranked || []).slice(0, 8).map((id) => { const s = res.summary?.[id] || {}; return [id, { avgNet: s.avgNet, winPct: s.winPct, drawdown: s.avgDrawdown, whipsawPct: s.whipsawPct, beatBaselineNet: s.beatBaselineNet ?? null, better: (res.better || []).includes(id) }]; })) };
    case "F11": return { ...base, have: res.rows, read: { hitClose: res.total?.hit?.close ?? null, hitClose3: res.total?.hit?.close3 ?? null, alreadyPricedPct: res.total?.alreadyPricedPct ?? null, byType: Object.fromEntries(Object.entries(res.types || {}).map(([k, v]) => [k, { n: v.n, hitClose: v.hit?.close ?? null, bestExit: v.bestExit }])) }, verdict: res.rows >= 40 ? "ok" : "insufficient", note: "FOMC, CPI and jobs only, with CPI and jobs release days approximated (the 12th; the first Friday), which dilutes their hit rates; earnings and the real release calendar join at bake time." };
    case "F12": return { ...base, have: res.rows, read: Object.fromEntries(Object.entries(res.types || {}).map(([k, v]) => [k, { best: v.best, stressBest: v.stress?.best ?? null }])), verdict: res.rows >= 40 ? "ok" : "insufficient" };
    case "F13": return { ...base, have: res.rows, read: Object.fromEntries(Object.entries(res.types || {}).map(([k, v]) => [k, { breakEvenAccuracyPct: v.noisy?.long?.breakEvenAccuracyPct ?? null, gapRiskPct: v.risk?.gapPastStopPct ?? null }])), verdict: res.rows >= 40 ? "ok" : "insufficient" };
    case "F15": return { ...base, have: res.oos?.n ?? 0, read: { oosAvgNet: res.oos?.avgNet, oosWinPct: res.oos?.winPct, fixedAvgNet: res.fixed?.avgNet, fixedWinPct: res.fixed?.winPct, steps: res.steps?.length, parameterStability: res.parameterStability, trials: res.trials } };
    case "F16": return { ...base, have: res.neighbors?.length || 0, verdict: res.neighbors?.length ? "ok" : "insufficient", read: { today: res.today?.date, cell: res.today?.cell, avgSpyFwdPct: res.summary?.avgSpyFwdPct, upShare: res.summary?.upShare } };
    case "F17": return { ...base, have: res.windows?.length || 0, read: { beatBaseline: res.beatBaseline, avgNet: res.avgNet, baselineAvgNet: res.baselineAvgNet } };
    case "F18": return { ...base, have: Math.min(res.byRegime?.macro?.days ?? 0, res.byRegime?.["stock-picking"]?.days ?? 0), read: Object.fromEntries(Object.entries(res.byRegime || {}).map(([k, v]) => [k, { days: v.days, ic: v.ic, tradesAvg: v.trades?.avg ?? null, tradesN: v.trades?.n ?? 0 }])) };
    case "F19": return { ...base, have: res.groups?.heavy?.n ?? 0, read: { heavy: res.groups?.heavy ? { n: res.groups.heavy.n, avg: res.groups.heavy.avg, winPct: res.groups.heavy.winPct } : null, rest: res.rest ? { n: res.rest.n, avg: res.rest.avg } : null, halfSizeHelps: res.halfSize?.helps ?? null }, note: "Event load on the long span counts FOMC weeks only (no CPI, jobs or earnings dates in the research set)." };
    case "F22": return { ...base, have: res.rerun, read: { rerun: res.rerun, survived: res.survived, rows: (res.rows || []).map((r) => ({ window: r.window?.from + ".." + r.window?.to, strategy: r.strategy, exits: r.exits, baseAvgNet: r.base?.avgNet, stressAvgNet: r.stress?.avgNet, survived: r.survived })) } };
    default: return base;
  }
}

function headline(results) {
  const v = (id) => results[id]?.verdict || "not run";
  const f1 = results.F1?.read, f3 = results.F3?.read, f5 = results.F5?.read;
  const lines = [];
  if (f1) lines.push(`F1: grade IC ${f1.trendingIc ?? "—"} in trending cells vs ${f1.chopIc ?? "—"} in chop (${v("F1")}).`);
  if (results.F2?.read) lines.push(`F2: grid flips ${results.F2.read.gridSwitchesPerYear ?? "—"}/yr, forward-vol ratio ${results.F2.read.gridRatio ?? "—"}; HMM ${results.F2.read.hmmSwitchesPerYear ?? "—"}/yr, ratio ${results.F2.read.hmmRatio ?? "—"} (${v("F2")}).`);
  if (f3) lines.push(`F3: switch ${f3.switch?.avgNet ?? "—"} vs same rules ${f3["same-rules"]?.avgNet ?? "—"} avg net per trade, beat ${f3.switch?.beatBaseline ?? "—"} windows (${v("F3")}).`);
  if (results.F4) lines.push(`F4: ${results.F4.have} cells judged; cash better in ${Object.values(results.F4.read || {}).filter((c) => c.cashBetter).length} (${v("F4")}).`);
  for (const id of ["F5", "F6", "F7", "F8", "F9"]) if (results[id]?.read) { const base = results[id].read["flat-50"]; const better = Object.entries(results[id].read).filter(([, r]) => r.better).map(([k, r]) => `${k} ${r.avgNet}`); lines.push(`${id}: ${better.length ? better.join(", ") + " beat the flat stop at " + (base?.avgNet ?? "—") : "nothing beat the flat -50 stop at " + (base?.avgNet ?? "—")} avg net (${v(id)}).`); }
  if (results.F11?.read) lines.push(`F11: ${results.F11.have} headlines; with the headline known the close was on its side ${results.F11.read.hitClose ?? "—"}% of the time, already priced ${results.F11.read.alreadyPricedPct ?? "—"}%.`);
  if (results.F15?.read) lines.push(`F15: walk-forward out of sample ${results.F15.read.oosAvgNet ?? "—"} vs fixed ${results.F15.read.fixedAvgNet ?? "—"} avg net (${v("F15")}).`);
  if (results.F17?.read) lines.push(`F17: stock labels beat one rule in ${results.F17.read.beatBaseline ?? "—"} windows (${v("F17")}).`);
  if (results.F18?.read) lines.push(`F18: IC ${results.F18.read["stock-picking"]?.ic ?? "—"} when names move apart vs ${results.F18.read.macro?.ic ?? "—"} when together (${v("F18")}).`);
  if (results.F22?.read) lines.push(`F22: ${results.F22.read.survived}/${results.F22.read.rerun} setups survived double costs and a 20% crush (${v("F22")}).`);
  const passes = Object.values(results).filter((r) => r?.verdict === "pass").length, fails = Object.values(results).filter((r) => r?.verdict === "fail").length;
  return { headline: `${Object.keys(results).length} tests run on the 2006+ replay: ${passes} passed, ${fails} failed, the rest inconclusive or reads. Price-half grades before 2026-06-24; nothing here changes the live engine.`, lines };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
const NOW_TESTS = TEST_CATALOG.filter((t) => t.when === "now" && t.runBy !== "bake").map((t) => t.id);

async function cmdRun(flags, { holdout = null } = {}) {
  const longDir = flags.long || process.env.REGIME_LAB_LONG || path.join(ROOT, "research/long-history");
  const outDir = flags.out || process.env.REGIME_LAB_OUT || path.join(ROOT, "regime-lab-out");
  const publicFile = flags.public || path.join(ROOT, RESEARCH_RESULTS_PATH);
  const want = holdout ? ["F3", "F5", "F6", "F7", "F8", "F9", "F17"] : flags.tests ? String(flags.tests).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : NOW_TESTS;
  const windowIds = holdout ? [holdout] : flags.windows ? String(flags.windows).split(",").map((s) => s.trim()).filter(Boolean) : null;
  const prior = fs.existsSync(publicFile) ? JSON.parse(fs.readFileSync(publicFile, "utf8")) : null;
  const ledger = createTrialLedger(prior ? { holdoutRuns: prior.holdoutRuns || {}, started: prior.ranAt || null } : null);
  if (holdout) {
    if (!HOLDOUT_WINDOW_IDS.includes(holdout)) throw new Error(`${holdout} is not a holdout window (${HOLDOUT_WINDOW_IDS.join(", ")})`);
    const ok = ledger.holdoutAllowed(holdout, { unlock: "once" });
    if (!ok.ok) throw new Error(ok.reason);
    log(`holdout ${holdout}: unlocked for this one run (G4). It will be recorded as run and locked afterwards.`);
  }
  const t0 = Date.now();
  const R = buildResearchContext({ longDir, gradesFile: flags.grades || null, dailyFile: flags["daily-grades"] || null, ivFile: flags.iv || null });
  const { ctx, series, hmm, meta } = R;
  const full = { v: 1, ranAt: new Date().toISOString(), versions: { catalog: CATALOG_VERSION, tests: TESTS_VERSION, guards: GUARDS_VERSION, labels: LABEL_RULES_VERSION }, meta, windows: WINDOWS.map((w) => ({ ...w })), tests: {} };
  const results = { ...(prior?.results || {}) };
  const run = (id, fn) => {
    const t = Date.now();
    try { const res = fn(); full.tests[id] = res; log(`  ${id}: ${res?.verdict || "ok"} (${((Date.now() - t) / 1000).toFixed(1)}s)`); return res; }
    catch (err) { log(`  ${id}: error — ${err.message}`); full.tests[id] = { error: String(err.message) }; return null; }
  };
  const unlock = holdout ? "once" : false;
  const trainFrom = "2008-01-02", trainTo = "2025-12-31";
  let f3 = null, exitsRes = {};
  if (want.includes("F1")) { const res = run("F1", () => icByLabel(ctx, { horizon: 10 })); if (res) results.F1 = summarize("F1", res); }
  if (want.includes("F2")) { const res = run("F2", () => labelStability({ grid: series, hmm, cal: ctx.cal, spyCloses: series.spyCloses })); if (res) results.F2 = summarize("F2", res, { sessions: ctx.cal.length }); }
  if (want.includes("F3") || want.includes("F4")) {
    f3 = run("F3", () => strategyComparison(ctx, { windowIds, ledger, unlock }));
    if (f3) { results.F3 = summarize("F3", f3, { holdoutLocked: f3.locked?.length > 0 }); results.F4 = summarize("F4", f3); if (f3.locked?.length) log(`  locked: ${f3.locked.map((l) => l.id).join(", ")}`); }
  }
  for (const id of ["F5", "F6", "F7", "F8", "F9"]) {
    if (!want.includes(id)) continue;
    const exitIds = ["flat-50", ...(CATALOG_BY_ID[id].exitIds || [])];
    const res = run(id, () => exitRuleComparison(ctx, { windowIds, exitIds, ledger, unlock }));
    if (res) { exitsRes[id] = res; results[id] = summarize(id, res, { holdoutLocked: res.locked?.length > 0 }); }
  }
  if (!holdout && ["F11", "F12", "F13"].some((id) => want.includes(id))) {
    const res = run("F11", () => researchOracle(R).suite);
    if (res) { results.F11 = summarize("F11", res); results.F12 = summarize("F12", res); results.F13 = summarize("F13", res); ledger.count("F11-F13", 1); }
  }
  if (want.includes("F15")) { const res = run("F15", () => walkForwardTest(ctx, { from: trainFrom, to: trainTo, ledger })); if (res) results.F15 = summarize("F15", res); }
  if (want.includes("F16")) { const res = run("F16", () => resemblesNow({ labels: series, ctx })); if (res) results.F16 = summarize("F16", res); }
  if (want.includes("F17")) { const res = run("F17", () => stockLabelTest(ctx, { windowIds, ledger, unlock })); if (res) results.F17 = summarize("F17", res, { holdoutLocked: res.locked?.length > 0 }); }
  let baseTrades = null;
  if (want.includes("F18") || want.includes("F19")) {
    const base = run("baseline-2008-2025", () => simulate(ctx, { strategy: "same-rules", exits: "flat-50", window: { from: trainFrom, to: trainTo } }));
    baseTrades = base?.trades || [];
    ledger.count("baseline", 1);
    full.tests["baseline-2008-2025"] = base ? { n: base.trades.length, card: scorecard(base) } : null;
  }
  if (want.includes("F18")) { const res = run("F18", () => correlationEraTest(ctx, { horizon: 10, trades: baseTrades })); if (res) results.F18 = summarize("F18", res); }
  if (want.includes("F19")) { const res = run("F19", () => eventLoadTest(ctx, baseTrades)); if (res) results.F19 = summarize("F19", res); }
  if (want.includes("F22")) {
    // Survivors: the strategies that beat the baseline in F3 and the exit
    // rules that beat the flat stop in F5-F9, each on the training years.
    // With nothing to rerun, the baseline itself is stress-tested so the
    // read is never empty.
    const setups = [];
    const survivorStrategies = Object.entries(f3?.summary || {}).filter(([id, s]) => id !== "same-rules" && s.beatBaseline && Number(s.beatBaseline.split("/")[0]) * 2 > Number(s.beatBaseline.split("/")[1]) && s.avgNet > (f3.summary["same-rules"]?.avgNet ?? 0)).map(([id]) => id);
    for (const sid of survivorStrategies) setups.push({ strategy: sid, exits: "flat-50", window: { from: trainFrom, to: trainTo } });
    for (const res of Object.values(exitsRes)) for (const b of res.better || []) setups.push({ strategy: "same-rules", exits: b.id || b, window: { from: trainFrom, to: trainTo } });
    if (!setups.length) setups.push({ strategy: "same-rules", exits: "flat-50", window: { from: trainFrom, to: trainTo } });
    const res = run("F22", () => stressRerun(ctx, setups, { ledger }));
    if (res) results.F22 = summarize("F22", res, { note: survivorStrategies.length || Object.values(exitsRes).some((r) => r.better?.length) ? null : "No setup beat the baseline, so the baseline itself was stress-tested." });
  }
  const ledgerSummary = ledger.summary();
  const pub = {
    v: 1, ranAt: full.ranAt, versions: full.versions, trials: (prior?.trials || 0) + ledgerSummary.trials, holdoutRuns: ledgerSummary.holdoutRuns, meta: { sessions: meta.sessions, from: meta.from, to: meta.to, names: meta.names, gradeDays: meta.gradeDays, note: meta.note },
    summary: headline(results), results,
  };
  full.ledger = ledgerSummary;
  full.public = pub;
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${Object.keys(full.tests).length} runs, ${ledgerSummary.trials} setups tried this run`);
  log(pub.summary.headline);
  for (const l of pub.summary.lines) log("  " + l);
  if (flags.dry) return pub;
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = full.ranAt.slice(0, 19).replace(/[:T]/g, "-");
  const fullPath = path.join(outDir, `run-${stamp}${holdout ? "-holdout-" + holdout : ""}.json`);
  fs.writeFileSync(fullPath, JSON.stringify(full));
  fs.mkdirSync(path.dirname(publicFile), { recursive: true });
  fs.writeFileSync(publicFile, JSON.stringify(pub, null, 1) + "\n");
  log(`wrote ${fullPath} (full) and ${publicFile} (public summary)`);
  return pub;
}

async function cmdLabels(flags) {
  const longDir = flags.long || process.env.REGIME_LAB_LONG || path.join(ROOT, "research/long-history");
  const outDir = flags.out || process.env.REGIME_LAB_OUT || path.join(ROOT, "regime-lab-out");
  const R = buildResearchContext({ longDir });
  const rows = R.series.rows.filter((r) => r.cell);
  const counts = {};
  for (const r of rows) counts[r.cell] = (counts[r.cell] || 0) + 1;
  log(`labels: ${rows.length} labeled sessions; ${JSON.stringify(R.series.stats)}; hindsight ${JSON.stringify(R.series.hindsight)}`);
  for (const [c, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) log(`  ${c}: ${n} (${Math.round((n / rows.length) * 100)}%)`);
  if (flags.dry) return;
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "labels-long.json");
  fs.writeFileSync(file, JSON.stringify({ v: 1, rules: LABEL_RULES_VERSION, meta: R.meta, rows: rows.map((r) => ({ d: r.date, cell: r.cell, raw: r.raw, era: r.era, ch: r.character, tr: r.transition ? 1 : 0, vix: r2(r.detail?.inputs?.vix), q: r2(r.detail?.quality?.quality), corr: r2(r.detail?.corr?.avg) })), hmm: R.hmm ? { states: R.hmm.states, stats: R.hmm.stats } : null }));
  log(`wrote ${file}`);
}

const { cmd, flags } = parseArgs(process.argv.slice(2));
try {
  if (cmd === "labels") await cmdLabels(flags);
  else if (cmd === "run") await cmdRun(flags);
  else if (cmd === "holdout") { if (!flags.window) throw new Error("holdout needs --window <id>"); await cmdRun(flags, { holdout: String(flags.window) }); }
  else { log("usage: node scripts/regime-lab.mjs <labels|run|holdout> [--tests F1,F3] [--windows ids] [--window id] [--long DIR] [--grades FILE] [--daily-grades FILE] [--iv FILE] [--out DIR] [--public FILE] [--dry]"); process.exit(cmd ? 1 : 0); }
} catch (err) {
  console.error(`regime-lab: ${err.message}`);
  process.exit(1);
}
