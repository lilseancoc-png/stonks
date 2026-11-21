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
// are all the inputs they need), and the core engines (Trend follower,
// Momentum basket: month-end closes and the fed funds rate). Earnings and Fundamentals need report dates
// and EPS, which live in the private store: pass --earnings FILE (a hydrated
// data/earnings-history.json) to add them; otherwise the bake replays them
// over the bars it holds. Flow has no stored history and is forward-only.
//
// No AI call, no network, no store access, nothing written into data/.
//
// Usage:
//   node scripts/engines-backtest.mjs [--long DIR] [--public FILE] [--from YYYY-MM-DD]
//        [--to YYYY-MM-DD] [--engines technicals,reversion,macro] [--earnings FILE] [--dry]
//
// Settings for reruns (2026-11-19; each changes the assumptions, so a run
// with any of them is a what-if: write it with --public to a scratch file, or
// --dry, never over the committed result):
//   --sizing risk|premium|one   risk = the live default (risk budget, 1-25
//                               contracts); premium = about $2,000 of premium
//                               (the 2026-11-17 size); one = one contract
//   --budget N                  the risk budget in dollars (default 2000)
//   --conviction 0              risk sizing without the conviction multiplier
//   --max-qty N                 the contract cap under risk sizing, 1 to 25
//                               (default 25 since 2026-11-20; 10 before)
//   --off fillBasis,riskSize,...  switch fixes off (ENGINE_FIXES ids)
//   --inst technicals=options,reversion=both  the per-engine instrument choice
//   --fg FILE                   a fear and greed series ([date, score] pairs or
//                               { date: score }), which turns the extreme-fear
//                               bounce test on (it never fires without one)
//   --cost N                    round-trip option costs in points of premium
//                               (default 3.5)
//   --iv-ratio N                modeled implied volatility as N x realized
//                               (default 1.15)
//   --trades-out FILE           also write the learning-on run's closed option
//                               trades (engine, setup, symbol, side, dates,
//                               modeled contract, modeled P&L) to FILE as
//                               JSON lines, for scripts/engines-real-prices.mjs.
//                               Research only: write it outside the repo (it
//                               is trade-level, so it never gets committed).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLongHistory } from "../research/macro-backtest/common.mjs";
import { TICKERS, SECTORS, sectorGroupOf } from "./build.mjs";
import { buildLabelInputs } from "../lib/regime-lab/payload.mjs";
import { buildLabelSeries, LABEL_RULES_VERSION } from "../lib/regime-lab/labels.mjs";
import { FOMC_DECISIONS } from "../lib/historical-events.mjs";
import { runBacktest, publicResult, WINDOWS, BACKTEST_VERSION } from "../lib/engines/backtest.mjs";
import { firstFridays } from "../lib/engines/macro.mjs";
import { ENGINES, ENGINES_VERSION, MACRO_ETFS, BOOK, ENGINE_FIXES, ENGINE_TRIALS, engineSpecs, INSTRUMENT_CHOICES, normalizeMaxQty } from "../lib/engines/config.mjs";
import { HEDGE } from "../lib/engines/hedge.mjs";
import { allocPriorFrom } from "../lib/engines/allocator.mjs";

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
  // The sector funds the Momentum basket can hold (the VIX and rates pack,
  // 2026-11-21): read by the core engines only.
  const auxSeries = {};
  for (const s of HEDGE.sectorFunds) if (bars[s] && !series[s]) auxSeries[s] = rowsOf(bars[s]);
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
  return { H, series, auxSeries, isEtf, labels, macroEvents, reports, reportNames, vix: vixRows, vix3m: vix3Rows, universe, labelRules: LABEL_RULES_VERSION, cal: inputs.cal };
}

// Four passes over the same history:
//   raw      every setup traded from day one, learning off, no Allocator
//            ("the rules as written"; its trades are the Allocator's prior)
//   off      shadow-start setups held back, learning off, no Allocator
//   on       shadow-start setups held back, learning on, the Allocator
//            advising with no prior ("as the engines run": advising is the
//            live default, so the trades are exactly those of a run without
//            it, and each carries its read, so the trades it would have held
//            back on that path are counted directly)
//   withAlloc  the signal engines as `on` with the Allocator holding back
//            (what switching it on would have changed)
// plus the Allocator the way it starts live, with a prior: its record from
// the first half (`split` and before, every setup) carried into the second
// half, learning on, against the second half without it (`oos`).
// settings (all optional, for reruns): { sizing, specs, fearGreed, costPts,
// ivRatio } passed straight to runBacktest (see parseSettings). fearGreed
// (`--fg <file>`, [date, score] closes or { date: score }) is read by the
// extreme-fear bounce test and the index-fear paper trial; without it
// neither opens anything in the test.
export function runEnginesResearch(R, { from = "2007-01-03", to = "9999-12-31", engines = null, split = "2016-12-31", settings = {}, keepOnTrades = false } = {}) {
  const ids = engines || ["technicals", "reversion", "macro", ...(R.reports ? ["earnings", "fundamentals"] : []), "trend", "momentum", "rotation"];
  const base = { series: R.series, auxSeries: R.auxSeries || null, isEtf: R.isEtf, fred: R.H.fred, vix: R.vix, vix3m: R.vix3m, macroEvents: R.macroEvents, reports: R.reports, labels: R.labels, from, to, engines: ids,
    groupOf: (s) => { try { return sectorGroupOf(s) || null; } catch { return null; } }, ...settings };
  const raw = runBacktest({ ...base, learn: false, raw: true, keepTrades: true });
  const off = runBacktest({ ...base, learn: false });
  const on = runBacktest({ ...base, learn: true, allocator: "advise", ...(keepOnTrades ? { keepTrades: true } : {}) });
  const onTrades = keepOnTrades ? on.trades || [] : null;
  if (keepOnTrades) delete on.trades;
  const sig = ids.filter((id) => !ENGINES[id]?.core);
  const withAlloc = sig.length ? runBacktest({ ...base, engines: sig, learn: true, control: 0, allocator: "on" }) : null;
  // The Allocator's prior: signal-engine trades, paper trials left out.
  const isSig = (t) => !ENGINES[t.engine]?.core && !t.trial;
  const priorTrades = (raw.trades || []).filter(isSig);
  const allocPrior = { from: raw.from, to: raw.to, n: priorTrades.length, rows: allocPriorFrom(priorTrades) };
  delete raw.trades;
  let oos = null;
  if (sig.length && split > from && split < to) {
    const sb = { ...base, engines: sig, control: 0 };
    const first = runBacktest({ ...sb, to: split, learn: false, raw: true, keepTrades: true });
    const sb2 = { ...sb, from: new Date(Date.parse(split + "T12:00:00Z") + 86400000).toISOString().slice(0, 10) };
    const prior = allocPriorFrom((first.trades || []).filter(isSig));
    const withPrior = runBacktest({ ...sb2, learn: true, allocator: "on", allocPrior: prior });
    const without = runBacktest({ ...sb2, learn: true, allocator: "advise", allocPrior: prior });
    oos = { priorFrom: first.from, priorTo: first.to, ...allocatorSummary(withPrior, without, sig) };
  }
  return { ids, raw, off, on, withAlloc, allocPrior, oos, onTrades };
}

// One closed option trade as a JSON-lines row for the real-price re-test
// (scripts/engines-real-prices.mjs). Share trades are left out (their prices
// are the stock's own closes, already real).
export function tradeOutRow(t) {
  const c = t?.contract;
  if (!c || c.structure === "shares" || !(c.strike > 0) || !c.expiry) return null;
  return {
    engine: t.engine, setup: t.setup || null, symbol: t.symbol, side: t.side, trial: !!t.trial, test: !!t.test,
    entryDate: String(t.entryDate || "").slice(0, 10), exitDate: String(t.exitDate || "").slice(0, 10), status: t.status || null,
    optionType: c.optionType, strike: c.strike, expiry: c.expiry, dte: c.dte ?? null, entryMid: c.mid ?? null, iv: c.iv ?? null,
    exitMid: t.exitMid ?? null, pnlPct: t.optionPnlPct ?? null, outcome: t.outcome || null,
    // The size (the count was read from the trade, where it never is, until
    // 2026-11-20): contracts, the flat risk size, the conviction multiplier,
    // what the budget asked for and whether the cap set it.
    qty: Number.isInteger(c.qty) ? c.qty : null, flatQty: Number.isInteger(c.flatQty) ? c.flatQty : null,
    mult: c.size?.mult ?? null, wantQty: c.size?.wantQty ?? null, capped: c.size?.capped ?? null,
  };
}

// The Allocator holding back (`on`) against the same run with it only
// advising (`noAlloc`, the same trades as a run without it): per signal
// engine, the trades taken, their average and dollars at normal size, and the
// dollars at the Allocator's sizes. The advising run's `held` line is the
// trades it would have held back on that path and what they made (below
// zero: holding back would have helped).
export function allocatorSummary(on, noAlloc, ids) {
  const rows = [];
  const a = { n: 0, usd: 0, sized: 0 }, b = { n: 0, usd: 0, heldN: 0, heldUsd: 0, sized: 0 };
  const both = (e) => ({ n: (e.n || 0) + (e.shares?.n || 0), usd: (e.usd || 0) + (e.shares?.usd || 0) });
  for (const id of ids) {
    const x = on.engines[id], y = noAlloc?.engines?.[id];
    if (!x || !y || ENGINES[id]?.core) continue;
    const xs = both(x), ys = both(y);
    rows.push({ id, name: ENGINES[id].name, on: { n: xs.n, avg: x.avg, sharesAvg: x.shares?.avg ?? null, usd: xs.usd, sizedUsd: x.allocator?.sizedUsd ?? null },
      off: { n: ys.n, avg: y.avg, sharesAvg: y.shares?.avg ?? null, usd: ys.usd, heldN: y.allocator?.heldN ?? null, heldUsd: y.allocator?.heldUsd ?? null, sizedUsd: y.allocator?.sizedUsd ?? null } });
    a.n += xs.n; a.usd += xs.usd; a.sized += x.allocator?.sizedUsd ?? xs.usd;
    b.n += ys.n; b.usd += ys.usd; b.heldN += y.allocator?.heldN || 0; b.heldUsd += y.allocator?.heldUsd || 0; b.sized += y.allocator?.sizedUsd ?? ys.usd;
  }
  return { from: on.from, to: on.to, rows, total: { on: { n: a.n, usd: a.usd, sizedUsd: Math.round(a.sized) }, off: { n: b.n, usd: b.usd, heldN: b.heldN, heldUsd: Math.round(b.heldUsd), sizedUsd: Math.round(b.sized) } } };
}

function line(id, e) {
  const c = e.control ? ` | random same-contract books avg ${e.control.avg}% (beat ${e.control.beat}%)` : "";
  return `  ${id.padEnd(12)} n=${String(e.n).padStart(5)} win ${e.winRate == null ? "n/a" : (e.winRate * 100).toFixed(1) + "%"} avg ${e.avg}% median ${e.median}% $${e.usd} pf ${e.profitFactor} ${e.perYear}/yr${c}`;
}

// The rerun flags as runBacktest options, plus a one-line description of
// each assumption that differs from the committed run.
export function parseSettings(flags) {
  const settings = {}, changed = [];
  const off = typeof flags.off === "string" ? flags.off.split(",").map((x) => x.trim()).filter((x) => ENGINE_FIXES.some((f) => f.id === x)) : [];
  // Switching risk sizing (or the multiplier) off sizes the run as the live
  // engines would with that switch off, unless --sizing says otherwise.
  const mode = typeof flags.sizing === "string" ? flags.sizing : off.includes("riskSize") ? (off.includes("size") ? "one" : "premium") : "risk";
  const budget = Number(flags.budget) > 0 ? Number(flags.budget) : BOOK.riskUsd;
  const conviction = !(flags.conviction === "0" || flags.conviction === "off" || off.includes("conviction"));
  if (mode === "premium") { settings.sizing = { mode: "premium", optionUsd: BOOK.optionUsd }; changed.push(`sizing: about $${BOOK.optionUsd} of premium a trade`); }
  else if (mode === "one") { settings.sizing = { mode: "one" }; changed.push("sizing: one contract a trade"); }
  else {
    const maxQty = normalizeMaxQty(flags["max-qty"] ?? flags.maxQty);
    settings.sizing = { mode: "risk", budget, conviction, maxQty };
    if (budget !== BOOK.riskUsd) changed.push(`risk budget $${budget}`);
    if (maxQty !== BOOK.riskMaxQty) changed.push(`contract cap ${maxQty}`);
    if (!conviction) changed.push("no conviction multiplier");
  }
  const inst = {};
  if (typeof flags.inst === "string") for (const kv of flags.inst.split(",")) { const [k, v] = kv.split("=").map((x) => x.trim()); if (ENGINES[k] && INSTRUMENT_CHOICES.includes(v)) inst[k] = v; }
  // --trials-off vixRollover,...: paper trials left out of the run.
  const trialsOff = typeof flags["trials-off"] === "string" ? flags["trials-off"].split(",").map((x) => x.trim()).filter((x) => ENGINE_TRIALS.some((t) => t.id === x)) : [];
  if (trialsOff.length) changed.push(`paper trials off: ${trialsOff.join(", ")}`);
  if (off.length || trialsOff.length || Object.keys(inst).length || (settings.sizing?.maxQty ?? BOOK.riskMaxQty) !== BOOK.riskMaxQty) {
    settings.specs = engineSpecs(Object.fromEntries(off.map((id) => [id, false])), trialsOff.length ? Object.fromEntries(trialsOff.map((id) => [id, false])) : undefined, inst, settings.sizing?.maxQty);
    if (off.length) changed.push(`fixes off: ${off.join(", ")}`);
    if (Object.keys(inst).length) changed.push(`instrument: ${Object.entries(inst).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  if (typeof flags.fg === "string") {
    const raw = JSON.parse(fs.readFileSync(flags.fg, "utf8"));
    const m = new Map();
    if (Array.isArray(raw)) { for (const r of raw) if (Array.isArray(r) && typeof r[0] === "string" && Number.isFinite(Number(r[1]))) m.set(r[0], Number(r[1])); }
    else if (raw && typeof raw === "object") for (const [d, v] of Object.entries(raw)) if (Number.isFinite(Number(v))) m.set(d, Number(v));
    settings.fearGreed = m;
    changed.push(`fear and greed series: ${m.size} days from ${path.basename(flags.fg)}`);
  }
  if (typeof flags.cost === "string" && Number.isFinite(Number(flags.cost))) { settings.costPts = Number(flags.cost); changed.push(`option costs ${settings.costPts} points a round trip`); }
  if (typeof flags["iv-ratio"] === "string" && Number.isFinite(Number(flags["iv-ratio"]))) { settings.ivRatio = Number(flags["iv-ratio"]); changed.push(`modeled IV ${settings.ivRatio}x realized`); }
  return { settings, changed };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const { settings, changed } = parseSettings(flags);
  if (changed.length) log(`settings: ${changed.join("; ")}`);
  const longDir = flags.long || process.env.ENGINES_LONG || process.env.REGIME_LAB_LONG || path.join(ROOT, "research/long-history");
  const R = buildEnginesResearch({ longDir, earningsFile: flags.earnings || null });
  log(`history: ${R.cal.length} sessions ${R.cal[0]}..${R.cal[R.cal.length - 1]}, ${R.universe.length} names, ${R.labels.size} labeled sessions${R.reports ? `, reports for ${R.reportNames} names` : ""}`);
  const engines = typeof flags.engines === "string" ? flags.engines.split(",").map((s) => s.trim()).filter((s) => ENGINES[s]) : null;
  const t0 = Date.now();
  const tradesOut = typeof flags["trades-out"] === "string" ? path.resolve(flags["trades-out"]) : null;
  if (tradesOut && tradesOut.startsWith(path.resolve(ROOT) + path.sep)) throw new Error("--trades-out writes trade-level rows: point it outside the repo");
  const { ids, raw, off, on, withAlloc, allocPrior, oos, onTrades } = runEnginesResearch(R, { from: flags.from || "2007-01-03", to: flags.to || "9999-12-31", engines, settings, keepOnTrades: !!tradesOut });
  if (tradesOut) {
    const rows = (onTrades || []).map(tradeOutRow).filter(Boolean);
    fs.mkdirSync(path.dirname(tradesOut), { recursive: true });
    fs.writeFileSync(tradesOut, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    log(`wrote ${rows.length} closed option trades (learning on) to ${tradesOut}`);
  }
  log(`ran ${ids.join(", ")} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const sig = ids.filter((id) => !ENGINES[id]?.core), coreIds = ids.filter((id) => ENGINES[id]?.core);
  log("every setup, learning off:"); for (const id of sig) log(line(id, raw.engines[id]));
  log("shadow-start setups held back, learning off:"); for (const id of sig) log(line(id, off.engines[id]));
  log("as the engines run (learning on, Allocator advising: the same trades as without it):"); for (const id of sig) log(line(id, on.engines[id]));
  if (withAlloc) { log("learning on, Allocator holding back:"); for (const id of sig) log(line(id, withAlloc.engines[id])); }
  const alloc = withAlloc ? { ...allocatorSummary(withAlloc, on, sig), oos } : null;
  if (alloc) log("Allocator, no prior:", JSON.stringify(alloc.total));
  if (oos) log(`Allocator, prior ${oos.priorFrom}..${oos.priorTo}, tested ${oos.from}..${oos.to}:`, JSON.stringify(oos.total));
  for (const id of coreIds) {
    const c = on.engines[id]?.core;
    if (c) log(`  ${id.padEnd(12)} from ${c.from} (${c.years} yrs): ${c.cagr}%/yr vs SPY ${c.spyCagr}%/yr; total ${c.total}% vs ${c.spyTotal}%; worst drop ${c.maxDrawdown}% vs ${c.spyMaxDrawdown}%; ${c.invested}% invested; ${c.swaps} swaps`);
  }
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
    // Premium per option trade when sizing by premium (null = one contract),
    // and the sizing these runs used (2026-11-19) with any changed assumption.
    optionUsd: BOOK.optionUsd, sizing: settings.sizing || null, assumptions: changed,
    notes: [
      "Option prices are modeled (Black-Scholes at 1.15x realized volatility), with 3.5% of premium taken as costs per round trip. Real spreads and real implied volatility are not in the history.",
      "The names are today's coverage list, so companies that failed or were dropped are missing (the results read better than a live list would have).",
      "Four setups that lost more than 3% a trade in both halves of this same history start on shadow. Three more were dropped on 2026-11-17 and are left out of every run, the 'every setup' one included: Macro's VIX-curve-back-to-normal call, Reversion's spike-in-a-downtrend put and Technicals' range-breakdown put. The numbers with those held back or dropped were picked with hindsight, so they flatter the engines; the 'every setup' run is the least picked read.",
      "The other money-leak fixes of 2026-11-17 were also picked from this same history, so this run flatters them too: 0.3-delta calls about 21 days out with a -60% stop for Reversion's washout bounce, and a 3 ATR stop on Technicals' share trades. The live record against this test, setup by setup on each engine's Record tab, is the check.",
      settings.sizing?.mode === "risk"
        ? `Since 2026-11-19 each trade is sized to risk about $${settings.sizing.budget.toLocaleString("en-US")}${settings.sizing.conviction ? " times a conviction multiplier (0.5x to 2x)" : ""}: an option expiring within ${BOOK.riskWholeDte} days risks its whole premium, a longer one its premium x its stop x ${BOOK.riskStopPad}, 1 to ${settings.sizing.maxQty ?? BOOK.riskMaxQty} contracts (10 until 2026-11-20); a share trade risks entry minus stop per share, at most $${BOOK.sharesMaxUsd.toLocaleString("en-US")} of stock. So a share trade now holds far more stock than the $5,000 lot of 2026-11-17, and a cheap contract is capped at ${settings.sizing.maxQty ?? BOOK.riskMaxQty}: compare dollar totals with a run sized the old way (--sizing premium), and results in % (which size does not change) across runs. Each result also carries flatUsd, the same trades at the flat size (no multiplier).`
        : `This run sizes option trades the 2026-11-17 way (${settings.sizing?.mode === "one" ? "one contract each" : "about $2,000 of premium each"}) and share trades at $5,000 of stock.`,
      "The call side of the slower setups buys stock instead of a call (since 2026-11-17; Technicals' squeeze too since 2026-11-19). Those share trades are priced at the open and close with 0.1% costs a round trip and scored on their own, against random share lots with the same stock exits. Split-adjusted prices are used as they are.",
      "The ask-in, bid-out fill basis of 2026-11-19 is not in this test: the modeled prices have no bid or ask, so the 3.5% round-trip cost stands in for the spread.",
      settings.fearGreed ? "The extreme-fear bounce test ran on a rebuilt fear and greed series (the decision on each day reads the prior day's value)." : "The extreme-fear bounce test opens nothing here: no fear and greed history ships with the repo (pass --fg FILE to run it on a rebuild).",
      "Reversion's washout bounce stands aside when the prior five sessions held a one-day drop of 7% or more (2026-11-19). The rule came from research on this same history, so this run flatters it.",
      "Modeled volatility falls more slowly after a bounce than real implied volatility does, so dip-buying calls look better here than they would live.",
      "Two paper trials (2026-11-19) run beside Reversion and Macro, scored apart from the engines' own trades: the RSI(2) dip in an uptrend and index funds after extreme fear, both buying shares. They came from a 553-variant test on real option prices and did not clear its bar. The index-fear trial (and the extreme-fear bounce test) is read here on our rebuild of Fear & Greed (six of CNN's seven parts, no put/call history; the score is the file's second column, the third is the VIX); live it reads CNN's own index. Since this run every random share book is matched trade by trade to the real trade's hold and exits, so a setup that sells after a few sessions is not judged against random lots held for 20.",
      "FOMC days are the real decision dates. Jobs days follow the first-Friday rule. CPI days are not in the research set.",
      "The core engines (Trend follower, Momentum basket) are scored as a portfolio: $1 that follows the holdings at every open and close, idle money earning the fed funds rate, 0.1% costs a round trip, against SPY bought the same day. Prices are split- and dividend-adjusted as downloaded, the same for both.",
      "The Momentum basket's number is the most flattered here: it picks the ten strongest of today's 85 covered names, which are largely the names that went on to win. On a 1,000-name list of the time (the 2026-11-17 research) the same rule made about 21% a year, not 28%.",
      "The Allocator ran with no prior in the main runs (it judged each setup only on trades finished before each decision). The 'with a prior' line is how it starts live: its record from 2007-2016 carried into 2017-2026. The main runs have it advising (its live default since 2026-11-17), so their trades are exactly those of a run without it and the trades it would have held back on that path are counted directly; a separate run has it holding back. Its sizes are scored as a dollar line only; no lot is resized.",
      R.reports ? "Earnings and Fundamentals use the stored report dates and EPS." : "Earnings and Fundamentals are not in this run (report dates and EPS live in the private store); the build replays them over the bars it holds. Flow has no stored history and is tracked forward only.",
    ],
    windows: WINDOWS, engines: ids,
    raw: publicResult(raw), learningOff: publicResult(off), learningOn: publicResult(on),
    // The Allocator: what it changed in this history (it ran with no prior),
    // and the record the live Allocator starts from (the raw run's results by
    // setup, side, instrument and market type: counts and sums only).
    allocator: alloc, allocPrior,
  };
  if (flags.dry) { log("dry run: nothing written"); return; }
  const file = path.resolve(ROOT, typeof flags.public === "string" ? flags.public : ENGINES_RESULTS_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out) + "\n");
  log(`wrote ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err); process.exit(1); });
