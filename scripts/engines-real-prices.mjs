#!/usr/bin/env node
// Re-test the strategy engines' option trades on real option prices
// (2026-11-19, owner request). Manual research; no workflow runs it.
//
// 1. Write the history test's closed option trades (outside the repo):
//      node scripts/engines-backtest.mjs --long DIR --dry --trades-out ~/research/engine-trades.jsonl
// 2. Pull real quotes for those symbols (outside the repo):
//      node scripts/dolthub-options-pull.mjs --covered --from 2019-01-01 --out ~/research/option-history
// 3. Re-price:
//      node scripts/engines-real-prices.mjs --trades ~/research/engine-trades.jsonl --history ~/research/option-history
//
// Each trade from --from on (default 2019-01-01, where the DoltHub history
// starts) is matched to the nearest real contract and priced at the real ask
// in and the real bid out, on the modeled exit date and on the real price
// path with the setup's own take-profit and stop (lib/option-history/
// reprice.mjs). The result is aggregates only (by engine and by setup, both
// halves of the period) and is written to research/engines-real-prices/
// latest.json unless --dry or --public FILE says otherwise. No AI, no
// network, no store access.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { historyReader, OPTION_HISTORY_SOURCE_NOTE } from "../lib/option-history/index.mjs";
import { repriceTrade, summarizeReprice } from "../lib/option-history/reprice.mjs";
import { exitsFor } from "../lib/engines/config.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const REAL_PRICES_PATH = "research/engines-real-prices/latest.json";

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

export function readTrades(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// Re-price a list of trade rows. Paper trials and test trades are kept apart
// from the engines' own trades, as on the engines page.
export function runRealPrices(trades, reader, { from = "2019-01-01", to = "9999-12-31" } = {}) {
  const own = [], extra = [];
  const skips = {}, extraSkips = {};
  for (const t of trades) {
    if (!t?.entryDate || t.entryDate < from || t.entryDate > to) continue;
    const side = t.trial || t.test;
    const r = repriceTrade(t, reader, exitsFor(t.engine, t.setup));
    if (r.ok) (side ? extra : own).push(r);
    else { const s = side ? extraSkips : skips; s[r.skip] = (s[r.skip] || 0) + 1; }
  }
  return { engines: summarizeReprice(own, skips), trialsAndTests: extra.length ? summarizeReprice(extra, extraSkips) : null };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (typeof flags.trades !== "string" || typeof flags.history !== "string") throw new Error("--trades FILE and --history DIR are required");
  const from = typeof flags.from === "string" ? flags.from : "2019-01-01";
  const to = typeof flags.to === "string" ? flags.to : "9999-12-31";
  const trades = readTrades(flags.trades);
  const res = runRealPrices(trades, historyReader(path.resolve(flags.history)), { from, to });
  const e = res.engines;
  console.log(`${trades.length} trades read; ${e.priced} priced, ${e.skipped} skipped (${Object.entries(e.skips).map(([k, v]) => `${k} ${v}`).join(", ") || "none"})`);
  const line = (id, g) => g && console.log(`  ${id.padEnd(28)} n=${String(g.n).padStart(5)} modeled ${g.modeled?.avg ?? "n/a"}% | same window ${g.sameWindow?.avg ?? "n/a"}% | real path ${g.realPath?.avg ?? "n/a"}% (t ${g.realPath?.t ?? "n/a"}, halves ${g.halves.map((h) => h?.avg ?? "n/a").join(" / ")})`);
  line("all", e.all);
  for (const [id, g] of Object.entries(e.engines)) line(id, g);
  const out = {
    version: 1, builtAt: new Date().toISOString(), from, to, source: OPTION_HISTORY_SOURCE_NOTE,
    method: "Each history-test option trade matched to the nearest real listed contract (same right, expiry within 10 days, strike within 5%); entry at the real ask, exit at the real bid. Aggregates only.",
    ...res,
  };
  if (flags.dry) { console.log("dry run: nothing written"); return; }
  const file = path.resolve(ROOT, typeof flags.public === "string" ? flags.public : REAL_PRICES_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${path.relative(ROOT, file)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message || err); process.exit(1); });
