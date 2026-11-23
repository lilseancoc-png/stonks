#!/usr/bin/env node
// Rebuild lib/book-risk-crashes.mjs: what each covered stock and fund did in
// four past sell-offs, for the Owner Book risk panel's crash replays
// (lib/book-risk.mjs). Run by hand on a file of adjusted daily bars
// ({ SYM: { t: ["YYYY-MM-DD", ...], c: [...] } }, gzipped or not), for
// example the bench snapshot the owner pulls from Yahoo:
//
//   node scripts/book-risk-crashes.mjs --bars <bars.json.gz> [--out lib/book-risk-crashes.mjs]
//
// Each window is a fixed peak and low of the S&P 500's close, chosen before
// the table was built. A stock's move is close to close (adjusted for splits
// and dividends); a stock that did not trade on both dates has no row, and the
// panel moves it by its market beta times SPY's move instead. The VIX closes
// on both dates set the volatility rise the replay adds to every option. The
// average pairwise correlation of the single stocks' daily returns inside the
// window is the "stocks move together" level the panel's crisis estimate uses.
// Public price facts only; no grade, pick or trade.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { TICKERS, SECTORS } from "./build.mjs";
import { HEDGE } from "../lib/engines/hedge.mjs";
import { ENGINES } from "../lib/engines/config.mjs";

export const CRASH_WINDOWS = [
  { id: "covid-2020", label: "Covid crash, 2020", from: "2020-02-19", to: "2020-03-23", note: "The S&P 500's close from its February 19 peak to its March 23 low." },
  { id: "bear-2022", label: "Rate-hike bear market, 2022", from: "2022-01-03", to: "2022-10-12", note: "The S&P 500's close from its January 3 peak to its October 12 low, as the Fed raised rates." },
  { id: "unwind-2024", label: "August 2024 carry unwind", from: "2024-07-16", to: "2024-08-05", note: "The S&P 500's close from its July 16 peak to the August 5 yen carry-trade unwind." },
  { id: "tariff-2025", label: "April 2025 tariff shock", from: "2025-04-02", to: "2025-04-08", note: "The S&P 500's close from the April 2 tariff announcement to the April 8 low." },
];

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const r4 = (x) => Math.round(x * 10000) / 10000;
const r2 = (x) => Math.round(x * 100) / 100;

function closeOn(bar, date) {
  // The close on the date itself; no carrying a stale close across a gap.
  const i = bar.t.indexOf(date);
  return i >= 0 && Number(bar.c[i]) > 0 ? Number(bar.c[i]) : null;
}

function dailyReturns(bar, from, to) {
  const out = new Map();
  for (let i = 1; i < bar.t.length; i++) {
    const d = bar.t[i];
    if (d <= from || d > to) continue;
    const a = Number(bar.c[i - 1]), b = Number(bar.c[i]);
    if (a > 0 && b > 0) out.set(d, Math.log(b / a));
  }
  return out;
}

function avgPairCorr(seriesList, days) {
  const cols = seriesList.map((m) => days.map((d) => m.get(d))).filter((xs) => xs.every((x) => Number.isFinite(x)));
  const z = cols.map((xs) => {
    const mu = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1));
    return sd > 0 ? xs.map((x) => (x - mu) / sd) : null;
  }).filter(Boolean);
  let sum = 0, n = 0;
  for (let i = 0; i < z.length; i++) for (let j = i + 1; j < z.length; j++) {
    let s = 0; for (let k = 0; k < days.length; k++) s += z[i][k] * z[j][k];
    sum += s / (days.length - 1); n++;
  }
  return n ? { corr: r2(sum / n), stocks: z.length } : null;
}

export function buildCrashTable(bars, { symbols, stocks, windows = CRASH_WINDOWS } = {}) {
  const spy = bars.SPY, vix = bars["^VIX"];
  if (!spy || !vix) throw new Error("bars need SPY and ^VIX");
  return windows.map((w) => {
    const s0 = closeOn(spy, w.from), s1 = closeOn(spy, w.to);
    const v0 = closeOn(vix, w.from), v1 = closeOn(vix, w.to);
    if (!(s0 && s1 && v0 && v1)) throw new Error(`${w.id}: SPY or VIX has no close on ${w.from} / ${w.to}`);
    const moves = {};
    for (const sym of symbols) {
      const b = bars[sym]; if (!b) continue;
      const a = closeOn(b, w.from), c = closeOn(b, w.to);
      if (a && c) moves[sym] = r4(c / a - 1);
    }
    const days = spy.t.filter((d) => d > w.from && d <= w.to);
    const corr = avgPairCorr(stocks.filter((s) => bars[s] && moves[s] != null).map((s) => dailyReturns(bars[s], w.from, w.to)), days);
    return { ...w, sessions: days.length, spy: r4(s1 / s0 - 1), vix: { from: r2(v0), to: r2(v1) }, corr: corr?.corr ?? null, corrStocks: corr?.stocks ?? 0, moves };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = arg("--bars");
  if (!path) { console.error("usage: node scripts/book-risk-crashes.mjs --bars <bars.json[.gz]> [--out FILE]"); process.exit(2); }
  const raw = readFileSync(path);
  const bars = JSON.parse((path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
  const funds = [...new Set([...HEDGE.sectorFunds, ...(ENGINES.rotation?.funds || [])])];
  const symbols = [...new Set([...TICKERS, ...funds])].sort();
  const stocks = TICKERS.filter((s) => SECTORS[s] !== "ETF");
  const windows = buildCrashTable(bars, { symbols, stocks });
  const out = arg("--out") || new URL("../lib/book-risk-crashes.mjs", import.meta.url).pathname;
  const text = "// Generated by scripts/book-risk-crashes.mjs; do not edit by hand.\n" +
    "// What each covered stock and fund did in four past sell-offs (close to close,\n" +
    "// adjusted), the VIX on both dates, and the stocks' average pairwise daily\n" +
    "// correlation inside each window. Public price facts; read by the Owner Book\n" +
    "// risk panel (lib/book-risk.mjs).\n" +
    `export const BOOK_CRASHES = ${JSON.stringify({ version: 1, builtFrom: path.split("/").slice(-2).join("/"), windows }, null, 1)};\n`;
  writeFileSync(out, text);
  for (const w of windows) console.log(`${w.id}: SPY ${(w.spy * 100).toFixed(1)}%, VIX ${w.vix.from} -> ${w.vix.to}, ${Object.keys(w.moves).length} names, avg corr ${w.corr} (${w.corrStocks} stocks, ${w.sessions} sessions)`);
  console.log(`wrote ${out}`);
}
