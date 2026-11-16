#!/usr/bin/env node
// Quant labs research runner (manual: there is no workflow for this).
//
// Runs the history tests behind the Owner Lab "Quant labs" tab on the
// long-history download and writes research/quant-labs/results/latest.json,
// which every full build joins into quant-labs.json:
//   market odds  the drawdown and recovery models with each era held out, at
//                three ridge strengths, plus one candidate input (breadth)
//   volatility   four forecasts of the next 21 sessions against what happened,
//                and the HAR coefficients the bake then uses
//   factors      seven price factors on the covered stocks at four horizons
// The output is aggregates only: no per-stock value, no trade row, nothing
// from the private record. No AI call, no network, nothing written to data/.
//
// Usage:
//   node scripts/quant-labs.mjs run --long DIR [--spx FILE] [--baa FILE] [--public FILE] [--dry]
// Flags:
//   --long DIR     long-history download dir (bars.json.gz + fred.json.gz);
//                  default $QUANT_LABS_LONG, $REGIME_LAB_LONG or research/long-history
//   --spx FILE     S&P 500 daily closes since 1950: a Yahoo chart JSON for ^GSPC
//                  or [{ t, c }] (the bake reads the same series from the shared
//                  long-history cache). Without it the market-odds test is skipped.
//   --baa FILE     FRED BAA10Y as CSV text (or JSON-encoded CSV)
//   --public FILE  output (default research/quant-labs/results/latest.json)
//   --dry          compute and print, write nothing
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLongHistory } from "../research/macro-backtest/common.mjs";
import { TICKERS, SECTORS } from "./build.mjs";
import { buildDrawdownOdds, buildDrawdownFrame, declineEras, fitTarget, DD_TARGETS, DD_DEFAULTS, DRAWDOWN_ODDS_VERSION } from "../lib/labs/drawdown-odds.mjs";
import { evaluateVolModels, VOL_VERSION } from "../lib/labs/vol.mjs";
import { evaluateFactors, publicFactorRows, FACTORS_VERSION } from "../lib/labs/factors.mjs";
import { brierSkill, round } from "../lib/labs/stats.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const VOL_LABEL = { ewma: "weighted recent moves (EWMA)", garch: "GARCH", har: "day, week and month mix (HAR)" };
const log = (...a) => console.log(...a);

function parseArgs(argv) {
  const out = { cmd: null, flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const next = argv[i + 1]; if (next == null || next.startsWith("--")) out.flags[k] = true; else { out.flags[k] = next; i++; } }
    else if (!out.cmd) out.cmd = a;
  }
  return out;
}
function readSpx(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(j)) return j.map((b) => ({ t: String(b.t).slice(0, 10), c: Number(b.c) })).filter((b) => b.c > 0);
  const r = j.chart?.result?.[0] || j;
  const ts = r.timestamp || [], c = r.indicators?.quote?.[0]?.close || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) if (Number.isFinite(c[i]) && c[i] > 0) out.push({ t: new Date(ts[i] * 1000).toISOString().slice(0, 10), c: c[i] });
  return out;
}
function readCsvSeries(file) {
  let text = fs.readFileSync(file, "utf8");
  if (text.trim().startsWith('"')) { try { text = JSON.parse(text); } catch { /* plain text */ } }
  return String(text).split(/\r?\n/).slice(1).map((l) => l.split(",")).filter((p) => p.length >= 2 && p[1] !== "" && p[1] !== ".")
    .map(([t, v]) => ({ t, v: Number(v) })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.t) && Number.isFinite(r.v));
}
const dayOf = (t) => (typeof t === "number" ? new Date(t * (t < 1e11 ? 1000 : 1)).toISOString().slice(0, 10) : String(t).slice(0, 10));
const toBars = (b) => (b ? b.t.map((t, i) => ({ t: dayOf(t), c: b.c[i] })).filter((x) => x.c > 0) : null);

function runMarketOdds(spx, fredOf, bars) {
  const out = { version: DRAWDOWN_ODDS_VERSION, ridge: [], breadth: null };
  for (const l2 of [5, 20, 80]) {
    const r = buildDrawdownOdds({ bars: spx, fred: fredOf, opts: { l2, draws: 40 } });
    if (r.status !== "ok") { out.status = r.status; return out; }
    if (l2 === DD_DEFAULTS.l2) {
      out.sampleFrom = r.sampleFrom; out.through = r.asOf; out.samples = r.samples; out.eras = r.eras;
      out.targets = r.targets.map((t) => ({
        id: t.id, label: t.label, status: t.status, n: t.n, events: t.events, base: t.base, eras: t.eras, tested: t.tested, skill: t.skill, skillRange: t.skillRange,
        auc: t.auc, ece: t.ece, recalibrated: t.recalibrated, bins: t.bins, eraSkill: t.eraSkill, weights: t.weights,
      }));
    }
    out.ridge.push({ l2, skill: Object.fromEntries(r.targets.map((t) => [t.id, t.skill])) });
    log(`  market odds, ridge ${l2}: ${r.targets.map((t) => `${t.id} ${t.skill}`).join(", ")}`);
  }
  // Candidate input: breadth (share of the nine oldest sector funds above
  // their 200-day average). The funds' history here starts in 2006, so the
  // comparison is scored only on months that have a reading.
  const sectors = ["XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP", "XLB", "XLU"].map((s) => toBars(bars[s])).filter((b) => b && b.length > 400);
  if (sectors.length >= 7) {
    const share = new Map();
    const maps = sectors.map((b) => { const m = new Map(); let sum = 0; for (let i = 0; i < b.length; i++) { sum += b[i].c; if (i >= 200) sum -= b[i - 200].c; if (i >= 199) m.set(b[i].t, b[i].c > sum / 200 ? 1 : 0); } return m; });
    for (const d of maps[0].keys()) { const vs = maps.map((m) => m.get(d)).filter((v) => v != null); if (vs.length >= 7) share.set(d, vs.reduce((a, v) => a + v, 0) / vs.length); }
    const extra = [{ key: "breadth", label: "Share of sector funds above their 200-day average", fall: -1, at: (t) => share.get(t) ?? null }];
    const rows = [];
    for (const target of DD_TARGETS.filter((t) => t.kind === "fall" && t.drop === 0.1)) {
      const score = (withExtra) => {
        const frame = buildDrawdownFrame({ bars: spx, fred: fredOf, opts: withExtra ? { extra } : {} });
        const res = fitTarget(frame, declineEras(frame), target, frame.opts);
        const sub = (res.oof || []).filter((r) => share.has(r.t));
        return { n: sub.length, skill: sub.length >= 60 ? brierSkill(sub.map((r) => r.p), sub.map((r) => r.y), sub.map((r) => r.base)) : null, w: withExtra ? res.block.weights?.find((w) => w.key === "breadth")?.w ?? null : null };
      };
      const a = score(false), b = score(true);
      rows.push({ id: target.id, months: a.n, base: round(a.skill, 3), withBreadth: round(b.skill, 3), weight: b.w });
      log(`  breadth add-on, ${target.id}: skill ${round(a.skill, 3)} -> ${round(b.skill, 3)} on ${a.n} months (weight ${b.w})`);
    }
    out.breadth = { from: [...share.keys()].sort()[0], funds: sectors.length, rows, read: rows.every((r) => !(r.withBreadth > r.base + 0.01)) ? "Breadth added nothing on the months it covers, so it is not an input." : "Breadth helped on the months it covers; too few eras to add it yet." };
  }
  out.status = "ok";
  return out;
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  if (cmd !== "run") { log("usage: node scripts/quant-labs.mjs run --long DIR [--spx FILE] [--baa FILE] [--public FILE] [--dry]"); process.exit(cmd ? 1 : 0); }
  const longDir = flags.long || process.env.QUANT_LABS_LONG || process.env.REGIME_LAB_LONG || path.join(ROOT, "research/long-history");
  const L = loadLongHistory(longDir);
  const fredRows = {};
  for (const [id, s] of Object.entries(L.fred)) fredRows[id] = s.t.map((t, i) => ({ t, v: s.v[i] }));
  if (flags.baa) fredRows.BAA10Y = readCsvSeries(flags.baa);
  const fredOf = (id) => fredRows[id] || [];
  const ran = new Date().toISOString().slice(0, 10);
  const result = { v: 1, ran, note: null, registry: [] };

  log("market odds");
  if (flags.spx) {
    result.marketOdds = runMarketOdds(readSpx(flags.spx), fredOf, L.bars);
    for (const t of result.marketOdds.targets || []) result.registry.push({ id: `dd-${t.id}`, label: `Market odds: ${t.label}`, family: "drawdown-odds", result: `${round(t.skill * 100, 1)}% less error than always saying the average, each era held out`, verdict: t.status, ran });
  } else log("  skipped: pass --spx FILE (S&P 500 closes since 1950)");

  log("volatility");
  const optionable = {};
  for (const [s, b] of Object.entries(L.bars)) if (!s.startsWith("^") && !/[=.]/.test(s) && b?.t?.length > 600) optionable[s] = toBars(b);
  const vol = evaluateVolModels(optionable, { step: 5 });
  result.vol = { version: VOL_VERSION, har: vol.har, best: vol.best, models: vol.models, rows: vol.rows, symbols: vol.symbols, from: vol.from };
  for (const m of vol.models) {
    log(`  ${m.model}: QLIKE ${m.qlike}, ${m.vsBase}% lower loss than trailing, error ${m.rmse} pts (t ${m.t})`);
    if (m.model !== "trailing") result.registry.push({ id: `vol-${m.model}`, label: `Volatility forecast: ${VOL_LABEL[m.model] || m.model}`, family: "vol", result: `${m.vsBase}% lower loss than carrying the last 21 sessions forward (t ${m.t})`, verdict: m.t >= 2.5 && m.vsBase > 0 ? "holds" : "unproven", ran });
  }

  log("factors");
  const stocks = {};
  for (const s of TICKERS) if (SECTORS[s] !== "ETF" && L.bars[s]) stocks[s] = toBars(L.bars[s]);
  const ev = evaluateFactors(stocks, toBars(L.bars.SPY), { from: "2008-01-01" });
  result.factors = {
    version: FACTORS_VERSION, names: ev.names, trials: ev.trials, tBar: ev.tBar, calendar: ev.calendar, rows: publicFactorRows(ev),
    caveat: "Today's covered stocks traced back in time, so names that failed or were dropped are missing; that flatters momentum and punishes low volatility.",
  };
  for (const f of result.factors.rows) {
    const m = f.ic.find((r) => r.h === 21);
    log(`  ${f.key}: 21-session rank skill ${m?.ic} (t ${m?.t}), spread ${f.spread?.perYear}% a year, ${f.spread?.net}% after costs [${f.verdict}]`);
    result.registry.push({ id: `factor-${f.key}`, label: `Factor: ${f.label}`, family: "factors", result: `21-session rank skill ${m?.ic} (t ${m?.t}; needs ${ev.tBar}), top minus bottom ${f.spread?.net}% a year after costs`, verdict: f.verdict, ran });
  }

  const outFile = flags.public && flags.public !== true ? flags.public : path.join(ROOT, "research/quant-labs/results/latest.json");
  if (flags.dry) { log(`dry run: ${JSON.stringify(result).length} bytes not written`); return; }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 1) + "\n");
  log(`wrote ${path.relative(ROOT, outFile)} (${fs.statSync(outFile).size} bytes)`);
}
main().catch((err) => { console.error(err); process.exit(1); });
