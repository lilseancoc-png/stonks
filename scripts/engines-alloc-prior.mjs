#!/usr/bin/env node
// Strategy engines: the Allocator's starting record on real option prices
// (2026-11-23, owner: "yes" to rebuilding the Allocator's history with real
// option prices). Manual research; no workflow runs it.
//
// The Allocator blends each setup's live record with a record from the
// 2007-2026 history test. Until now that record came from the main history
// run (research/engines/results/latest.json `allocPrior`), which prices every
// option on modeled volatility (1.15x realized). Modeled volatility moves the
// wrong way after a drop, so dip-buying calls read far better than they did
// on real prices (the 2026-11-19 real-price check and the 2026-11-20
// scorecard). This script reruns the same "every setup" run the prior comes
// from, with the engines as they run today, but prices each option on real
// 30-day implied volatility:
//   - a Cboe volatility index where one exists for the name (VIX for SPY, VXN
//     for QQQ, RVX for IWM, VXAPL for AAPL, VXTLT for TLT, GVZ for GLD, ...);
//   - elsewhere the stand-in k x VIX^0.7, where k is the trailing 120-session
//     average of modeled volatility over VIX^0.7 (it tracked real single-stock
//     implied volatility with a correlation of 0.49-0.69 in the 2026-11-19
//     check). This is the same pricing as the loser brake's prior
//     (research/engines/scorecard/latest.json).
// Share trades are priced on the stock either way.
//
// It writes research/engines/allocator/latest.json (counts and sums only, by
// setup, side, instrument and market type; no trade rows), which the bake
// reads in place of the modeled-price prior. No AI, no network, no store.
//
// Usage:
//   node scripts/engines-alloc-prior.mjs --long DIR --cboe DIR [--fg FILE] [--dry] [--public FILE]
//     --long  the long-history download (bars.json.gz, fred.json.gz), as for
//             scripts/engines-backtest.mjs
//     --cboe  a folder of Cboe index histories (VIX.csv, VXN.csv, ...: DATE then
//             the close in the last column), from cdn.cboe.com
//     --fg    a fear and greed series, as for scripts/engines-backtest.mjs (the
//             extreme-fear bounce test opens nothing without one)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEnginesResearch, researchBase, allocPriorOfRaw, parseSettings } from "./engines-backtest.mjs";
import { runBacktest, BACKTEST_VERSION } from "../lib/engines/backtest.mjs";
import { ENGINES_VERSION } from "../lib/engines/config.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const ALLOC_PRIOR_PATH = "research/engines/allocator/latest.json";
const fin = (x) => typeof x === "number" && Number.isFinite(x);

// Covered names and funds with their own Cboe 30-day implied volatility index.
export const CBOE_IV_INDEX = Object.freeze({ SPY: "VIX", QQQ: "VXN", IWM: "RVX", DIA: "VXD", AAPL: "VXAPL", AMZN: "VXAZN", GOOGL: "VXGOG", GS: "VXGS", IBM: "VXIBM", TLT: "VXTLT", GLD: "GVZ", SLV: "VXSLV", USO: "OVX", EEM: "VXEEM", EWZ: "VXEWZ", FXI: "VXFXI" });
export const STAND_IN = Object.freeze({ beta: 0.7, window: 120, minWindow: 60 });

// One Cboe history: Map(YYYY-MM-DD -> volatility as a fraction).
export function readCboeCsv(text) {
  const m = new Map();
  for (const line of String(text).split(/\r?\n/).slice(1)) {
    const p = line.split(","); if (p.length < 2) continue;
    const [mm, dd, yy] = p[0].split("/"); const v = Number(p[p.length - 1]);
    if (yy && mm && dd && fin(v) && v > 1) m.set(`${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`, v / 100);
  }
  return m;
}

// The runBacktest ivAdj hook: real implied volatility for bar i of a symbol.
// `real`: { SYM: Map(date -> iv) }; `vix`: Map(date -> VIX as a fraction).
// Bar i's read is the close of day i, as the modeled read is.
export function realIvAdj({ real, vix }) {
  const kCache = new WeakMap(), used = { index: 0, standIn: 0, modeled: 0 };
  const modelAt = (P, j) => { const a = P.rv20[j], b = P.rv60[j]; const rv = fin(a) && fin(b) ? 0.6 * a + 0.4 * b : null; return rv == null ? null : Math.min(2.5, Math.max(0.1, rv * 1.15)); };
  // k at bar i: the trailing average of modeled / VIX^beta over the sessions
  // before i (never day i itself).
  const anchorOf = (P) => {
    if (kCache.has(P)) return kCache.get(P);
    const n = P.S.t.length, k = new Array(n).fill(null), win = []; let sum = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) { const m = modelAt(P, i - 1), v = vix.get(P.S.t[i - 1]); if (m && v) { const x = m / Math.pow(v, STAND_IN.beta); win.push(x); sum += x; if (win.length > STAND_IN.window) sum -= win.shift(); } }
      if (win.length >= STAND_IN.minWindow) k[i] = sum / win.length;
    }
    kCache.set(P, k); return k;
  };
  const adj = (sym, P, i, iv) => {
    const date = P.S.t[i];
    const own = sym && real[sym] ? real[sym].get(date) : null;
    if (fin(own)) { used.index++; return Math.min(2.5, Math.max(0.05, own)); }
    const k = anchorOf(P)[i], v = vix.get(date);
    if (fin(k) && fin(v)) { used.standIn++; return Math.min(2.5, Math.max(0.05, k * Math.pow(v, STAND_IN.beta))); }
    used.modeled++; return iv;
  };
  adj.used = used;
  return adj;
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) { flags[a.slice(2)] = next; i++; } else flags[a.slice(2)] = true;
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (typeof flags.long !== "string" || typeof flags.cboe !== "string") throw new Error("usage: --long DIR --cboe DIR [--fg FILE] [--dry] [--public FILE]");
  const { settings, changed } = parseSettings(flags);
  const R = buildEnginesResearch({ longDir: flags.long });
  const real = {}, names = [];
  for (const [sym, idx] of Object.entries(CBOE_IV_INDEX)) {
    const f = path.join(flags.cboe, `${idx}.csv`);
    if (!R.series[sym] || !fs.existsSync(f)) continue;
    const m = readCboeCsv(fs.readFileSync(f, "utf8"));
    if (m.size) { real[sym] = m; names.push(`${sym} (${idx})`); }
  }
  const vixBars = R.H.bars["^VIX"];
  if (!vixBars) throw new Error("the long history has no ^VIX");
  const vix = new Map(); vixBars.t.forEach((t, i) => { const v = vixBars.c[i]; if (fin(v) && v > 1) vix.set(t, v / 100); });
  const ivAdj = realIvAdj({ real, vix });
  const t0 = Date.now();
  const raw = runBacktest({ ...researchBase(R, { settings }), learn: false, raw: true, keepTrades: true, ivAdj });
  const prior = allocPriorOfRaw(raw);
  console.log(`ran in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${prior.n} signal-engine trades ${prior.from}..${prior.to}, ${Object.keys(prior.rows).length} rows; volatility reads: ${JSON.stringify(ivAdj.used)}`);
  for (const [k, row] of Object.entries(prior.rows).sort()) { const [n, s] = row["*"] || [0, 0]; console.log(`  ${k.padEnd(36)} n=${String(n).padStart(4)} avg ${n ? (s / n).toFixed(1) : "-"}`); }
  const out = {
    version: 1, generatedAt: new Date().toISOString().slice(0, 10), backtestVersion: BACKTEST_VERSION, enginesVersion: ENGINES_VERSION,
    source: "The engines' 2007-2026 history test, every setup, learning off, with the engines' rules as they run today. Options are priced on real 30-day implied volatility: the Cboe index for " + names.join(", ") + ", and k x VIX^0.7 elsewhere (k = the trailing 120-session average of modeled volatility over VIX^0.7). Share trades are priced on the stock. Counts and sums only.",
    assumptions: changed,
    from: prior.from, to: prior.to, n: prior.n, rows: prior.rows,
  };
  if (flags.dry) { console.log("dry run: nothing written"); return; }
  const file = path.resolve(ROOT, typeof flags.public === "string" ? flags.public : ALLOC_PRIOR_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out) + "\n");
  console.log(`wrote ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err); process.exit(1); });
