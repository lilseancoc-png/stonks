#!/usr/bin/env node
// Pull real end-of-day option quotes from DoltHub's post-no-preference/options
// database into a local research folder (2026-11-19, owner request).
//
// Manual and research-only: no workflow runs it, nothing goes to the private
// store or data/, and the output folder must be outside the repo (the rows
// are price-level data from a database that states no license; only
// aggregates built from them are ever committed). The rows use the shared
// option-history shape (lib/option-history/index.mjs), so
// scripts/engines-real-prices.mjs and the Webull option-price saver read the
// same files.
//
// Two ways in:
//   API mode (default)  the DoltHub SQL API, one month of one symbol per query,
//                       1,000 rows a page, a pause between calls. Slow but
//                       needs nothing installed. Big queries can time out;
//                       a failed month is logged and retried next run.
//   --dolt DIR          a local clone (`dolt clone post-no-preference/options`),
//                       queried with the dolt CLI. Much faster for many years.
// Progress is kept in <out>/_progress.json, so a stopped run resumes; the
// current month is never marked done.
//
// Usage:
//   node scripts/dolthub-options-pull.mjs --out DIR [--symbols AAPL,MSFT | --covered]
//        [--from 2019-01-01] [--to YYYY-MM-DD] [--dolt DIR] [--gap-ms 1500] [--max-calls N]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeDoltRow, parseDoltApi, doltQueryUrl, writeRows, OPTION_HISTORY_SOURCE_NOTE } from "../lib/option-history/index.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

export function monthsBetween(fromIso, toIso) {
  const out = [];
  let y = Number(fromIso.slice(0, 4)), m = Number(fromIso.slice(5, 7));
  const ey = Number(toIso.slice(0, 4)), em = Number(toIso.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// The SQL for one symbol and month (symbols are checked against a strict
// pattern before they reach the query).
export function monthSql(symbol, month, { limit = null, offset = 0 } = {}) {
  if (!/^[A-Z][A-Z0-9.]{0,5}$/.test(symbol) || !/^\d{4}-\d{2}$/.test(month)) throw new Error("bad symbol or month");
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const base = `SELECT * FROM option_chain WHERE act_symbol = '${symbol}' AND date >= '${month}-01' AND date < '${next}-01' ORDER BY date, expiration, strike, call_put`;
  return limit ? `${base} LIMIT ${limit} OFFSET ${offset}` : base;
}

async function apiMonth(symbol, month, { gapMs, budget }) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    if (budget.left <= 0) throw new Error("call limit reached");
    budget.left -= 1;
    const res = await fetch(doltQueryUrl(monthSql(symbol, month, { limit: PAGE, offset })), { signal: AbortSignal.timeout(60000), headers: { accept: "application/json", "user-agent": "stonks-app research script" } });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseDoltApi(body);
    if (!parsed.ok) throw new Error(parsed.message || "query failed");
    rows.push(...parsed.rows);
    await sleep(gapMs);
    if (parsed.rows.length < PAGE) break;
  }
  return rows;
}

function doltMonth(doltDir, symbol, month) {
  const out = execFileSync("dolt", ["sql", "-r", "json", "-q", monthSql(symbol, month)], { cwd: doltDir, maxBuffer: 1024 * 1024 * 512, encoding: "utf8" });
  const j = out.trim() ? JSON.parse(out) : { rows: [] };
  return Array.isArray(j.rows) ? j.rows : [];
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (typeof flags.out !== "string") throw new Error("--out DIR is required (a folder outside the repo)");
  const out = path.resolve(flags.out);
  if (out === path.resolve(ROOT) || out.startsWith(path.resolve(ROOT) + path.sep)) throw new Error("--out must be outside the repo: these are price rows, never committed");
  let symbols;
  if (typeof flags.symbols === "string") symbols = flags.symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  else if (flags.covered) symbols = (await import("./build.mjs")).TICKERS.slice();
  else throw new Error("pass --symbols AAPL,MSFT or --covered");
  const from = typeof flags.from === "string" ? flags.from : "2019-01-01";
  const to = typeof flags.to === "string" ? flags.to : new Date().toISOString().slice(0, 10);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const gapMs = Number(flags["gap-ms"]) >= 0 ? Number(flags["gap-ms"]) : 1500;
  const budget = { left: Number(flags["max-calls"]) > 0 ? Number(flags["max-calls"]) : Infinity };
  const doltDir = typeof flags.dolt === "string" ? path.resolve(flags.dolt) : null;
  fs.mkdirSync(out, { recursive: true });
  const progFile = path.join(out, "_progress.json");
  const prog = fs.existsSync(progFile) ? JSON.parse(fs.readFileSync(progFile, "utf8")) : { source: OPTION_HISTORY_SOURCE_NOTE, done: {} };
  console.log(`DoltHub option history → ${out} (${doltDir ? "local dolt clone" : "SQL API"}), ${symbols.length} symbols, ${from} to ${to}`);
  console.log(`Source: ${OPTION_HISTORY_SOURCE_NOTE}`);
  let rowsTotal = 0, failed = 0;
  for (const sym of symbols) {
    for (const month of monthsBetween(from, to)) {
      const key = `${sym}|${month}`;
      if (prog.done[key]) continue;
      let raw;
      try {
        raw = doltDir ? doltMonth(doltDir, sym, month) : await apiMonth(sym, month, { gapMs, budget });
      } catch (err) {
        failed += 1;
        console.warn(`  ${key}: ${String(err?.message || err).split("\n")[0]}`);
        if (/call limit/.test(String(err?.message))) { fs.writeFileSync(progFile, JSON.stringify(prog)); console.log("stopped at the call limit; rerun to continue"); return; }
        continue;
      }
      const rows = raw.map(normalizeDoltRow).filter(Boolean);
      if (rows.length) writeRows(out, rows);
      rowsTotal += rows.length;
      if (month < thisMonth) prog.done[key] = rows.length;
      fs.writeFileSync(progFile, JSON.stringify(prog));
      if (rows.length) console.log(`  ${key}: ${rows.length} rows (${raw.length - rows.length} dropped)`);
    }
  }
  console.log(`done: ${rowsTotal} rows written${failed ? `, ${failed} month(s) failed (rerun to retry)` : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message || err); process.exit(1); });
