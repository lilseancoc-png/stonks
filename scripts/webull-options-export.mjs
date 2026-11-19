// Export the saved Webull option prices to a research-kit folder (manual,
// read-only on the store; docs/webull-data.md "Export").
//
// Reads _stonks/webull-data/v1/ (needs the same R2_* store creds as
// sync-data.mjs / wipe-history.mjs) and writes gzipped JSONL files the engine
// history tests can read later:
//   <out>/snapshots/<UNDERLYING>/<YEAR>.jsonl.gz      daily snapshot rows
//     {date, symbol, expiry, strike, right, bid, ask, iv, delta, gamma, vega,
//      theta, source:"webull", underlying, spot, last, volume, oi, bid_size,
//      ask_size, rho, quote_time, delay_min, stale, wide}
//     (the row shape shared with the DoltHub history pull, source "dolthub")
//   <out>/expired-bars/<UNDERLYING>/<YEAR>.jsonl.gz   expired contracts' daily bars
//     {date, symbol, expiry, strike, right, open, high, low, close, volume, source:"webull-bars"}
//   <out>/manifest.json                                counts, date range, run time
// YEAR is the row's date year for snapshots and the expiry year for bars.
// Wiring these prices into lib/engines/backtest.mjs is a later step.
//
//   node --env-file=r2.env scripts/webull-options-export.mjs --out research-kit/webull-options
//   ... --from 2026-11-19 --to 2026-12-31 --symbols AAPL,SPY --no-bars
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { webullDataKeys, readGz } from "../lib/webull-data/store.mjs";

const args = process.argv.slice(2);
const flag = (name, def = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def; };
const has = (name) => args.includes(name);
const out = resolve(flag("--out", "research-kit/webull-options"));
const from = flag("--from", "0000-00-00"), to = flag("--to", "9999-99-99");
const only = flag("--symbols") ? new Set(flag("--symbols").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)) : null;

const SHARED = ["date", "symbol", "expiry", "strike", "right", "bid", "ask", "iv", "delta", "gamma", "vega", "theta", "source",
  "underlying", "spot", "last", "volume", "oi", "bid_size", "ask_size", "rho", "quote_time", "delay_min", "stale", "wide"];
const pick = (row) => Object.fromEntries(SHARED.map((k) => [k, row[k] ?? null]));

function addTo(files, dir, sym, year, line) {
  const k = `${dir}/${sym}/${year}`;
  (files.get(k) || files.set(k, []).get(k)).push(line);
}

export async function exportWebullOptions({ store, outDir, fromDate = from, toDate = to, symbols = only, bars = !has("--no-bars") }) {
  const files = new Map();
  const counts = { snapshotObjects: 0, snapshotRows: 0, expiredContracts: 0, barRows: 0 };
  let first = null, last = null;
  const snaps = (await store.rawList(webullDataKeys.snapshotsRoot())).map((o) => o.key).filter((k) => /\/(\d{4}-\d{2}-\d{2})\/[A-Z0-9.]+\.json\.gz$/.test(k)).sort();
  for (const key of snaps) {
    const [date, file] = key.split("/").slice(-2);
    const sym = file.replace(/\.json\.gz$/, "");
    if (date < fromDate || date > toDate || (symbols && !symbols.has(sym))) continue;
    const doc = await readGz(store, key);
    counts.snapshotObjects++;
    for (const row of doc?.rows || []) { addTo(files, "snapshots", sym, date.slice(0, 4), JSON.stringify(pick({ ...row, date: row.date || date }))); counts.snapshotRows++; }
    first = first == null || date < first ? date : first; last = last == null || date > last ? date : last;
  }
  if (bars) {
    const expired = (await store.rawList(webullDataKeys.expiredRoot())).map((o) => o.key).filter((k) => k.endsWith(".json.gz")).sort();
    for (const key of expired) {
      const [expiry] = key.split("/").slice(-2);
      if (expiry < fromDate || expiry > toDate) continue;
      const doc = await readGz(store, key);
      if (!doc || (symbols && !symbols.has(doc.underlying))) continue;
      counts.expiredContracts++;
      for (const b of doc.bars || []) {
        addTo(files, "expired-bars", doc.underlying, expiry.slice(0, 4), JSON.stringify({ date: b.date, symbol: doc.symbol, expiry: doc.expiry, strike: doc.strike, right: doc.right,
          open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, source: "webull-bars" }));
        counts.barRows++;
      }
    }
  }
  for (const [k, lines] of files) {
    const [dir, sym, year] = k.split("/");
    mkdirSync(join(outDir, dir, sym), { recursive: true });
    writeFileSync(join(outDir, dir, sym, `${year}.jsonl.gz`), gzipSync(lines.join("\n") + "\n"));
  }
  mkdirSync(outDir, { recursive: true });
  const manifest = { exportedAtIso: new Date().toISOString(), from: first, to: last, files: files.size, ...counts,
    rowShape: { snapshots: SHARED, expiredBars: ["date", "symbol", "expiry", "strike", "right", "open", "high", "low", "close", "volume", "source"] },
    notes: "Webull option data is 15 minutes delayed on the paper keys; daily bars are traded OHLCV. Webull data is licensed non-display: research use only, never on public pages." };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { createStore } = await import("../lib/datastore.mjs");
  const store = createStore();
  if (store.backend !== "r2") { console.error("webull-options-export: needs the R2_* store creds (the saver writes to R2 only)."); process.exit(1); }
  const m = await exportWebullOptions({ store, outDir: out });
  console.log(`webull-options-export: ${m.snapshotRows} snapshot rows from ${m.snapshotObjects} name-days (${m.from || "none"} to ${m.to || "none"}), ${m.barRows} bars from ${m.expiredContracts} expired contracts, ${m.files} files in ${out}`);
}
