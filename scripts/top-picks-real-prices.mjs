#!/usr/bin/env node
// Re-price the Top Picks track record on real option quotes (2026-11-20,
// owner request after the 2026-11-20 site review). Manual research; no
// workflow runs it, and it changes nothing in the record.
//
// The record's headline P&L is a model (Black-Scholes at the entry IV, mid in
// and mid out). Trades opened since 2026-10-21 also carry an ask-in, bid-out
// "real fill" from the chain each run fetches, and the Track Record page
// already shows it beside the model. This script adds two reads the page
// cannot make on its own, from real end-of-day quotes (DoltHub rows, the
// shared lib/option-history shape):
//   same  the record's own entry ask (its real quote at entry; the DoltHub
//         ask that day when the record has none), out at the real bid on the
//         record's exit date. Covers trades opened before 2026-10-21 too.
//   path  the same entry, then the real mids day by day: the record's own
//         take-profit or stop, measured on real prices, closes at that day's
//         bid; otherwise the exit date's bid. This is "what if the exits had
//         fired on real prices instead of the model".
// Only single-leg (long) trades are re-priced; spreads are counted as skipped.
// The output is aggregates only (counts, averages, win rates, profit factor,
// by side): no trade row and no price leaves this script, because the DoltHub
// rows state no license.
//
// Steps, on a machine that can reach DoltHub (the cloud sandbox cannot):
//   1. Save the record: Owner, Track Record, download picks-accuracy.json
//      (or read it from the store), outside the repo.
//   2. node scripts/top-picks-real-prices.mjs --accuracy FILE --symbols
//        prints the symbols and date range to pull.
//   3. node scripts/dolthub-options-pull.mjs --out ~/research/option-history --symbols <list> --from <first entry>
//   4. node scripts/top-picks-real-prices.mjs --accuracy FILE --history ~/research/option-history
//        writes research/top-picks-real-prices/latest.json (--dry: print only).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { historyReader, OPTION_HISTORY_SOURCE_NOTE } from "../lib/option-history/index.mjs";
import { matchContract, expiryIso } from "../lib/option-history/reprice.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const TOP_PICKS_REAL_PRICES_PATH = "research/top-picks-real-prices/latest.json";
const BASELINE_SYMBOL = "SPY";
const DAY = 86400000;
const EXIT_GAP_DAYS = 5;
const QUOTE_GAP_DAYS = 3;

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dms = (d) => Date.parse(`${d}T00:00:00Z`);
const mid = (q) => (fin(q?.bid) && fin(q?.ask) && q.ask >= q.bid ? (q.bid + q.ask) / 2 : null);
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

// A run time (ISO) as its New York trade date.
export function etDate(v) {
  const ms = Date.parse(String(v || ""));
  return Number.isFinite(ms) ? ET_DATE.format(new Date(ms)) : null;
}

// The closed trades the record counts: decided (win / loss), single symbol
// (not the SPY baseline pairs), with a modeled option P&L.
export function recordTrades(acc) {
  const closed = Array.isArray(acc?.closed) ? acc.closed : [];
  return closed.filter((c) => c && (c.outcome === "win" || c.outcome === "loss") && num(c.optionPnlPct) != null && !c.pairKey && c.symbol !== BASELINE_SYMBOL);
}

// Symbols and the date range a DoltHub pull needs for these trades.
export function pullPlan(trades) {
  const symbols = [...new Set(trades.map((t) => String(t.symbol || "").toUpperCase()).filter(Boolean))].sort();
  const dates = trades.map((t) => etDate(t.entryDate)).filter(Boolean).sort();
  const ends = trades.map((t) => etDate(t.exitDate)).filter(Boolean).sort();
  return { symbols, from: dates[0] || null, to: ends.at(-1) || null };
}

function nearDays(date, gap, dir) {
  const out = [date];
  for (let k = 1; k <= gap; k++) {
    if (dir !== "after") out.push(iso(dms(date) - k * DAY));
    if (dir !== "before") out.push(iso(dms(date) + k * DAY));
  }
  return out;
}

// Re-price one closed record trade. Returns { ok: true, ... } or { ok: false, skip }.
export function repricePick(e, reader) {
  const c = e?.contract || {};
  if ((c.structure || "long") !== "long") return { ok: false, skip: "spread (not re-priced)" };
  const right = e.side === "put" ? "P" : e.side === "call" ? "C" : null;
  const expiry = expiryIso(c.expiry);
  const strike = num(c.strike);
  const entryDay = etDate(e.entryDate), exitDate = etDate(e.exitDate);
  if (!right || !expiry || !(strike > 0) || !entryDay || !exitDate) return { ok: false, skip: "incomplete trade" };
  // The record's contract is a listed one, so the match is near exact.
  const want = { right, expiry, strike };
  const tight = { expiryGapDays: 1, strikeGapPct: 0.5 };
  let contract = null;
  for (const d of nearDays(entryDay, QUOTE_GAP_DAYS, "both")) {
    const m = matchContract(reader.rowsOn(e.symbol, d), want, tight);
    if (m) { contract = m.symbol; break; }
  }
  if (!contract) {
    for (const d of nearDays(exitDate, EXIT_GAP_DAYS, "before")) {
      const m = matchContract(reader.rowsOn(e.symbol, d), want, tight);
      if (m) { contract = m.symbol; break; }
    }
  }
  if (!contract) return { ok: false, skip: "no quotes for the contract" };
  const quoteOn = (d) => reader.rowsOn(e.symbol, d).find((r) => r.symbol === contract) || null;
  // Entry: the record's own ask at entry when it has one (a real quote at the
  // run), else the DoltHub ask nearest the entry day.
  let entry = num(c.ask), basis = "record ask";
  if (!(entry > 0)) {
    entry = null;
    for (const d of nearDays(entryDay, QUOTE_GAP_DAYS, "both")) { const q = quoteOn(d); if (q && q.ask > 0) { entry = q.ask; break; } }
    basis = "real ask (end of day)";
  }
  if (!(entry > 0)) return { ok: false, skip: "no entry quote" };
  const exitCap = exitDate < expiry ? exitDate : expiry;
  let exitQ = null, exitDay = null;
  for (const d of nearDays(exitCap, EXIT_GAP_DAYS, "before")) {
    if (d < entryDay) break;
    const q = quoteOn(d);
    if (q && fin(q.bid)) { exitQ = q; exitDay = d; break; }
  }
  if (!exitQ) return { ok: false, skip: "no quote at exit" };
  const samePct = (exitQ.bid / entry - 1) * 100;
  const pol = e.exitPolicy || {};
  const tp = num(pol.takeProfitPct), stop = num(pol.stopPct) != null ? -Math.abs(num(pol.stopPct)) : null;
  let pathPct = samePct, pathReason = "record exit date";
  if (tp != null || stop != null) {
    for (const d of reader.datesFor(e.symbol, iso(dms(entryDay) + DAY), exitDay)) {
      const q = quoteOn(d), m = mid(q);
      if (m == null) continue;
      const pnl = (m / entry - 1) * 100;
      if ((tp != null && pnl >= tp) || (stop != null && pnl <= stop)) {
        pathPct = (q.bid / entry - 1) * 100; pathReason = tp != null && pnl >= tp ? "take-profit" : "stop";
        break;
      }
    }
  }
  return {
    ok: true, side: e.side, entryDay, basis, pathReason,
    modeledPct: num(e.optionPnlPct), recordRealFillPct: num(e.realFillPnlPct), samePct, pathPct,
  };
}

function stats(list, key) {
  const xs = list.map((x) => x[key]).filter(fin);
  if (!xs.length) return null;
  const n = xs.length, avg = xs.reduce((s, x) => s + x, 0) / n;
  const sorted = xs.slice().sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const gains = xs.filter((x) => x > 0).reduce((s, x) => s + x, 0), losses = -xs.filter((x) => x < 0).reduce((s, x) => s + x, 0);
  return { n, avg: r1(avg), median: r1(median), win: r2(xs.filter((x) => x > 0).length / n), profitFactor: losses > 0 ? r2(gains / losses) : null };
}

function group(list) {
  if (!list.length) return null;
  const days = list.map((x) => x.entryDay).sort();
  return {
    n: list.length, from: days[0], to: days.at(-1),
    modeled: stats(list, "modeledPct"), sameWindow: stats(list, "samePct"), realPath: stats(list, "pathPct"),
    recordRealFill: stats(list.filter((x) => x.recordRealFillPct != null), "recordRealFillPct"),
    pathExits: list.reduce((o, x) => ((o[x.pathReason] = (o[x.pathReason] || 0) + 1), o), {}),
    entryBasis: list.reduce((o, x) => ((o[x.basis] = (o[x.basis] || 0) + 1), o), {}),
  };
}

// Re-price every counted trade; aggregates only.
export function runTopPicksRealPrices(acc, reader) {
  const trades = recordTrades(acc);
  const priced = [], skips = {};
  for (const t of trades) {
    const r = repricePick(t, reader);
    if (r.ok) priced.push(r);
    else skips[r.skip] = (skips[r.skip] || 0) + 1;
  }
  return {
    trades: trades.length, priced: priced.length, skipped: trades.length - priced.length, skips,
    all: group(priced), calls: group(priced.filter((x) => x.side === "call")), puts: group(priced.filter((x) => x.side === "put")),
    notes: [
      "modeled = the record's own P&L (Black-Scholes marks); sameWindow = the record's entry ask in, the real bid out on the record's exit date; realPath = the record's take-profit and stop fired on real end-of-day mids.",
      "recordRealFill = the record's own ask-in, bid-out lens, on the trades that carry it (opened since 2026-10-21).",
      "Percent of the premium paid per trade. End-of-day quotes, so a path exit can land a day off the twice-daily runs.",
    ],
  };
}

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

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (typeof flags.accuracy !== "string") throw new Error("--accuracy FILE (a saved picks-accuracy.json) is required");
  const acc = JSON.parse(fs.readFileSync(path.resolve(flags.accuracy), "utf8"));
  if (flags.symbols) {
    const plan = pullPlan(recordTrades(acc));
    console.log(`${plan.symbols.length} symbols, ${plan.from} to ${plan.to}`);
    console.log(`node scripts/dolthub-options-pull.mjs --out ~/research/option-history --symbols ${plan.symbols.join(",")} --from ${plan.from}`);
    return;
  }
  if (typeof flags.history !== "string") throw new Error("--history DIR is required (or --symbols to plan the pull)");
  const res = runTopPicksRealPrices(acc, historyReader(path.resolve(flags.history)));
  console.log(`${res.trades} closed trades; ${res.priced} priced, ${res.skipped} skipped (${Object.entries(res.skips).map(([k, v]) => `${k} ${v}`).join(", ") || "none"})`);
  const line = (id, g) => g && console.log(`  ${id.padEnd(6)} n=${String(g.n).padStart(3)} modeled ${g.modeled?.avg ?? "n/a"}% (win ${g.modeled?.win ?? "n/a"}, PF ${g.modeled?.profitFactor ?? "n/a"}) | same window ${g.sameWindow?.avg ?? "n/a"}% (win ${g.sameWindow?.win ?? "n/a"}) | real path ${g.realPath?.avg ?? "n/a"}% (win ${g.realPath?.win ?? "n/a"}, PF ${g.realPath?.profitFactor ?? "n/a"})`);
  line("all", res.all); line("calls", res.calls); line("puts", res.puts);
  const out = { version: 1, builtAt: new Date().toISOString(), recordBuiltAt: acc.builtAtIso || null, source: OPTION_HISTORY_SOURCE_NOTE, ...res };
  if (flags.dry) { console.log("dry run: nothing written"); return; }
  const file = path.resolve(ROOT, typeof flags.public === "string" ? flags.public : TOP_PICKS_REAL_PRICES_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${path.relative(ROOT, file)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message || err); process.exit(1); });
