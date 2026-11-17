#!/usr/bin/env node
// Strategy engines: the history test runner (manual; there is no workflow).
//
// Replays the engines over the long-history download (daily bars since 2006
// plus the FRED series) with the same rule code and book the live engines
// use, once with learning off and once with learning on, and writes the
// public-safe result (aggregates only: no trade rows, nothing from the
// private store) that the bake joins into engines.json.
//
// What runs here: Technicals, Reversion and Macro (bars, VIX curve and FRED
// are all the inputs they need). Earnings and Fundamentals need report dates
// and EPS, which live in the private store: pass --earnings FILE (a hydrated
// data/earnings-history.json) to add them; otherwise the bake replays them
// over the bars it holds. Flow has no stored history and is forward-only.
//
// No AI call, no network, no store access, nothing written into data/.
//
// Usage:
//   node scripts/engines-backtest.mjs [--long DIR] [--public FILE] [--from YYYY-MM-DD]
//        [--to YYYY-MM-DD] [--engines technicals,reversion,macro] [--earnings FILE] [--dry]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLongHistory } from "../research/macro-backtest/common.mjs";
import { TICKERS, SECTORS } from "./build.mjs";
import { buildLabelInputs } from "../lib/regime-lab/payload.mjs";
import { buildLabelSeries, LABEL_RULES_VERSION } from "../lib/regime-lab/labels.mjs";
import { FOMC_DECISIONS } from "../lib/historical-events.mjs";
import { runBacktest, publicResult, WINDOWS, BACKTEST_VERSION } from "../lib/engines/backtest.mjs";
import { firstFridays } from "../lib/engines/macro.mjs";
import { ENGINES, ENGINES_VERSION, MACRO_ETFS } from "../lib/engines/config.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const ENGINES_RESULTS_PATH = "research/engines/results/latest.json";
const log = (...a) => console.log(...a);

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) { flags[a.slice(2)] = next; i++; } else flags[a.slice(2)] = true;
  }
  return flags;
}
const rowsOf = (b) => b.t.map((t, i) => ({ t, c: b.c[i], h: b.h?.[i], l: b.l?.[i], o: b.o?.[i], v: b.v?.[i] }));
const colsToRows = (s) => (s?.t || []).map((t, i) => ({ t, v: s.v[i] }));

export function buildEnginesResearch({ longDir, earningsFile = null } = {}) {
  const H = loadLongHistory(longDir);
  const bars = H.bars;
  if (!bars.SPY) throw new Error("the long history has no SPY");
  const universe = [...new Set([...TICKERS, ...MACRO_ETFS])].filter((s) => bars[s]);
  const isEtf = (s) => SECTORS[s] === "ETF" || MACRO_ETFS.includes(s);
  const series = {};
  for (const s of universe) series[s] = rowsOf(bars[s]);
  // Market-type labels: the Regime Lab's grid, read through each close.
  const members = {};
  for (const s of TICKERS) if (bars[s] && SECTORS[s] !== "ETF") members[s] = rowsOf(bars[s]);
  const vixRows = bars["^VIX"] ? rowsOf(bars["^VIX"]).map((r) => ({ t: r.t, v: r.c })) : colsToRows(H.fred.VIXCLS);
  const vix3Rows = bars["^VIX3M"] ? rowsOf(bars["^VIX3M"]).map((r) => ({ t: r.t, v: r.c })) : [];
  const inputs = buildLabelInputs({ spy: rowsOf(bars.SPY), spyBars: rowsOf(bars.SPY), qqq: bars.QQQ ? rowsOf(bars.QQQ) : [], iwm: bars.IWM ? rowsOf(bars.IWM) : [], vix: vixRows, vix3m: vix3Rows, members, maxSessions: Infinity });
  const lab = buildLabelSeries({ cal: inputs.cal, spyBars: inputs.spyBars, vix: inputs.vix, vix3m: inputs.vix3m, indexes: inputs.indexes, breadth50: inputs.breadth50, members: inputs.members, start: 60 });
  const labels = new Map();
  for (const r of lab.rows || []) if (r?.date && r.cell) labels.set(r.date, { cell: r.cell, era: r.era || null, stressed: /stressed$/.test(r.cell) });
  // Scheduled macro days. FOMC decisions are the real dates; jobs days follow
  // the first-Friday rule; CPI days are left out (the release calendar is not
  // in the research set).
  const y0 = Number(inputs.cal[0].slice(0, 4)), y1 = Number(inputs.cal[inputs.cal.length - 1].slice(0, 4));
  const macroEvents = [...FOMC_DECISIONS.map((d) => ({ date: d, kind: "fomc" })), ...firstFridays(y0, y1).map((d) => ({ date: d, kind: "jobs" }))];
  let reports = null, reportNames = 0;
  if (earningsFile && fs.existsSync(earningsFile)) {
    const store = JSON.parse(fs.readFileSync(earningsFile, "utf8"));
    reports = {};
    for (const [sym, row] of Object.entries(store?.tickers || {})) if (series[sym] && Array.isArray(row?.events) && row.events.length) { reports[sym] = row.events; reportNames++; }
  }
  return { H, series, isEtf, labels, macroEvents, reports, reportNames, vix: vixRows, vix3m: vix3Rows, universe, labelRules: LABEL_RULES_VERSION, cal: inputs.cal };
}

// Three passes over the same history:
//   raw   every setup traded from day one, learning off ("the rules as written")
//   off   shadow-start setups held back, learning off
//   on    shadow-start setups held back, learning on ("as the engines run")
export function runEnginesResearch(R, { from = "2007-01-03", to = "9999-12-31", engines = null } = {}) {
  const ids = engines || ["technicals", "reversion", "macro", ...(R.reports ? ["earnings", "fundamentals"] : [])];
  const base = { series: R.series, isEtf: R.isEtf, fred: R.H.fred, vix: R.vix, vix3m: R.vix3m, macroEvents: R.macroEvents, reports: R.reports, labels: R.labels, from, to, engines: ids };
  const raw = runBacktest({ ...base, learn: false, raw: true });
  const off = runBacktest({ ...base, learn: false });
  const on = runBacktest({ ...base, learn: true });
  return { ids, raw, off, on };
}

function line(id, e) {
  const c = e.control ? ` | random same-contract books avg ${e.control.avg}% (beat ${e.control.beat}%)` : "";
  return `  ${id.padEnd(12)} n=${String(e.n).padStart(5)} win ${e.winRate == null ? "n/a" : (e.winRate * 100).toFixed(1) + "%"} avg ${e.avg}% median ${e.median}% $${e.usd} pf ${e.profitFactor} ${e.perYear}/yr${c}`;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const longDir = flags.long || process.env.ENGINES_LONG || process.env.REGIME_LAB_LONG || path.join(ROOT, "research/long-history");
  const R = buildEnginesResearch({ longDir, earningsFile: flags.earnings || null });
  log(`history: ${R.cal.length} sessions ${R.cal[0]}..${R.cal[R.cal.length - 1]}, ${R.universe.length} names, ${R.labels.size} labeled sessions${R.reports ? `, reports for ${R.reportNames} names` : ""}`);
  const engines = typeof flags.engines === "string" ? flags.engines.split(",").map((s) => s.trim()).filter((s) => ENGINES[s]) : null;
  const t0 = Date.now();
  const { ids, raw, off, on } = runEnginesResearch(R, { from: flags.from || "2007-01-03", to: flags.to || "9999-12-31", engines });
  log(`ran ${ids.join(", ")} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log("every setup, learning off:"); for (const id of ids) log(line(id, raw.engines[id]));
  log("shadow-start setups held back, learning off:"); for (const id of ids) log(line(id, off.engines[id]));
  log("as the engines run (learning on):"); for (const id of ids) log(line(id, on.engines[id]));
  if (flags.verbose) for (const id of ids) {
    const e = on.engines[id];
    log(`\n${id} by setup:`); for (const r of e.bySetup) log(`   ${String(r.key).padEnd(18)} n=${r.n} win ${(r.winRate * 100).toFixed(0)}% avg ${r.avg}%`);
    log(`${id} by market type:`); for (const r of e.byCell) log(`   ${String(r.key).padEnd(18)} n=${r.n} win ${(r.winRate * 100).toFixed(0)}% avg ${r.avg}%`);
    log(`${id} by window:`); for (const r of e.byWindow || []) log(`   ${String(r.label).padEnd(34)} n=${r.n} win ${(r.winRate * 100).toFixed(0)}% avg ${r.avg}%`);
    log(`${id} by side / exit:`); for (const r of [...e.bySide, ...e.byExit]) log(`   ${String(r.key).padEnd(18)} n=${r.n} win ${(r.winRate * 100).toFixed(0)}% avg ${r.avg}%`);
    for (const [k, rows] of Object.entries(e.byEnv || {})) { log(`${id} by ${k}:`); for (const r of rows) log(`   ${String(r.key).padEnd(18)} n=${r.n} win ${(r.winRate * 100).toFixed(0)}% avg ${r.avg}%`); }
    const l = on.engines[id];
    log(`${id} learning: bar ${l.bar}, ${l.changes} changes`); for (const c of l.log || []) log(`   ${c.date} ${c.v} ${c.kind}: ${c.text}`);
  }
  const out = {
    version: BACKTEST_VERSION, enginesVersion: ENGINES_VERSION, generatedAt: new Date().toISOString().slice(0, 10),
    data: { from: off.from, to: off.to, sessions: off.sessions, names: R.universe.length, labelRules: R.labelRules },
    notes: [
      "Option prices are modeled (Black-Scholes at 1.15x realized volatility), with 3.5% of premium taken as costs per round trip. Real spreads and real implied volatility are not in the history.",
      "The names are today's coverage list, so companies that failed or were dropped are missing (the results read better than a live list would have).",
      "Five setups that lost more than 3% a trade in both halves of this same history start on shadow (a sixth, Macro's VIX-curve-back-to-normal call, was dropped on 2026-11-17). The numbers with those held back were picked with hindsight, so they flatter the engines; the 'every setup' run is the unpicked read.",
      "Since 2026-11-17 the call side of the slower setups buys $5,000 of stock instead of a call. Those share trades are priced at the open and close with 0.1% costs a round trip and scored on their own, against random share lots with the same stock exits. Split-adjusted prices are used as they are.",
      "Modeled volatility falls more slowly after a bounce than real implied volatility does, so dip-buying calls look better here than they would live.",
      "FOMC days are the real decision dates. Jobs days follow the first-Friday rule. CPI days are not in the research set.",
      R.reports ? "Earnings and Fundamentals use the stored report dates and EPS." : "Earnings and Fundamentals are not in this run (report dates and EPS live in the private store); the build replays them over the bars it holds. Flow has no stored history and is tracked forward only.",
    ],
    windows: WINDOWS, engines: ids,
    raw: publicResult(raw), learningOff: publicResult(off), learningOn: publicResult(on),
  };
  if (flags.dry) { log("dry run: nothing written"); return; }
  const file = path.resolve(ROOT, typeof flags.public === "string" ? flags.public : ENGINES_RESULTS_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out) + "\n");
  log(`wrote ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err); process.exit(1); });
