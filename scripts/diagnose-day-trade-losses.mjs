// scripts/diagnose-day-trade-losses.mjs
//
// READ-ONLY loss diagnostic for the LIVE Day Trades board (the volume-driven
// swing/scalp roster in data/day-trades-history.json). The sibling of
// scripts/diagnose-pick-losses.mjs, but Day Trades are on the UNDERLYING with
// fixed entry/stop/target — so there's nothing to model: the realized % and R
// are stored on each closed trade. This script just decomposes them along the
// axes that map to engine knobs in scan-unusual.mjs, so a tuning decision is
// grounded in the record instead of a hunch.
//
// The headline `winRate` in the file counts an "expired" close at any positive
// P/L as a win — even a +0.05% scratch — which flatters the number. So this
// reports the DECISIVE win rate (target vs stop only) and, more importantly, the
// R-multiple EXPECTANCY (the only figure that says whether the board makes money
// after the stops). It also splits losses by kind (scalp/swing), side
// (long/short), exit (stop vs expired-negative), and reward:risk bucket, and
// reads the day-move out of each trade's `basis` to separate chases from dips.
//
// Usage:  node scripts/sync-data.mjs pull   # hydrate data/ first
//         node scripts/diagnose-day-trade-losses.mjs

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

const pct = (x) => (x == null || !isFinite(x) ? "  —  " : (x >= 0 ? "+" : "") + x.toFixed(1) + "%");
const rmult = (x) => (x == null || !isFinite(x) ? "  —  " : (x >= 0 ? "+" : "") + x.toFixed(2) + "R");
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// Pull the "+X.X% today" the candidate builder stamps into basis so we can tell a
// trade entered WITH the day's move (a chase/continuation) from one entered
// against it (a counter-move dip). Returns null when the basis has no move tag.
function dayMoveFromBasis(basis) {
  const m = /([+-]?\d+(?:\.\d+)?)%\s*today/.exec(String(basis || ""));
  return m ? Number(m[1]) : null;
}

async function loadJson(name) {
  try { return JSON.parse(await readFile(resolve(DATA_DIR, name), "utf8")); }
  catch { return null; }
}

function bucketStat(rows, keyFn) {
  const out = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}

function reportGroup(label, groups) {
  console.log("\n  " + label + ":");
  const keys = [...groups.keys()].sort();
  for (const k of keys) {
    const rs = groups.get(k);
    const wins = rs.filter((r) => r.win).length;
    const expR = mean(rs.map((r) => r.pnlR).filter((x) => x != null && isFinite(x)));
    const expPct = mean(rs.map((r) => r.pnlPct).filter((x) => x != null && isFinite(x)));
    console.log(
      "    " + pad(k, 18) + padL(rs.length + "n", 6) + "  win " + padL(Math.round((wins / rs.length) * 100) + "%", 5) +
      "  exp " + padL(rmult(expR), 8) + " / " + padL(pct(expPct), 8),
    );
  }
}

async function main() {
  const hist = await loadJson("day-trades-history.json");
  if (!hist || !Array.isArray(hist.closed) || !hist.closed.length) {
    console.error("No data/day-trades-history.json with a closed[] array — run `node scripts/sync-data.mjs pull` first.");
    process.exit(1);
  }
  const closed = hist.closed.filter((c) => c && (c.outcome === "target" || c.outcome === "stop" || c.outcome === "expired"));

  // ---- Per-trade table (worst first) ---------------------------------------
  console.log("\n=== Day Trades — closed P/L (" + closed.length + " trades) ===\n");
  console.log(pad("SYM", 7) + pad("SIDE", 6) + pad("KIND", 7) + pad("EXIT", 9) + padL("day", 8) + padL("P/L", 9) + padL("R", 8));
  console.log("-".repeat(62));
  for (const c of [...closed].sort((a, b) => (a.pnlR ?? a.pnlPct ?? 0) - (b.pnlR ?? b.pnlPct ?? 0))) {
    console.log(
      pad(c.sym, 7) + pad(c.side, 6) + pad(c.kind, 7) + pad(c.outcome, 9) +
      padL(pct(dayMoveFromBasis(c.basis)), 8) + padL(pct(c.pnlPct), 9) + padL(rmult(c.pnlR), 8),
    );
  }

  // ---- Headline expectancy --------------------------------------------------
  const wins = closed.filter((c) => c.win);
  const losses = closed.filter((c) => !c.win);
  // Decisive = a real target or stop touch (drops the expired scratches that
  // inflate the headline win rate).
  const decisive = closed.filter((c) => c.outcome === "target" || c.outcome === "stop");
  const decisiveWins = decisive.filter((c) => c.outcome === "target");
  const rVals = closed.map((c) => c.pnlR).filter((x) => x != null && isFinite(x));
  const expR = mean(rVals);
  const expPct = mean(closed.map((c) => c.pnlPct).filter((x) => x != null && isFinite(x)));
  const avgWinR = mean(wins.map((c) => c.pnlR).filter((x) => x != null && isFinite(x)));
  const avgLossR = mean(losses.map((c) => c.pnlR).filter((x) => x != null && isFinite(x)));

  console.log("\n=== Summary ===\n");
  console.log("  headline win rate   : " + Math.round((wins.length / closed.length) * 100) + "%  (" + wins.length + "W / " + losses.length + "L, expired-positive counts as a win)");
  if (decisive.length) {
    console.log("  DECISIVE win rate   : " + Math.round((decisiveWins.length / decisive.length) * 100) + "%  (target vs stop only, n=" + decisive.length + ")  <- the honest hit rate");
  }
  console.log("  R-multiple expectancy: " + rmult(expR) + "   <- > 0 means the board makes money after stops");
  console.log("  avg P/L per trade   : " + pct(expPct));
  console.log("  avg win / avg loss  : " + rmult(avgWinR) + " / " + rmult(avgLossR) + (avgWinR != null && avgLossR != null && avgLossR !== 0 ? "  (payoff ratio " + Math.abs(avgWinR / avgLossR).toFixed(2) + ")" : ""));

  // ---- Breakdowns -----------------------------------------------------------
  reportGroup("by kind", bucketStat(closed, (c) => c.kind || "?"));
  reportGroup("by side", bucketStat(closed, (c) => c.side || "?"));
  reportGroup("by exit", bucketStat(closed, (c) => c.outcome || "?"));
  reportGroup("by reward:risk at entry", bucketStat(closed, (c) => {
    const risk = Math.abs((c.entry ?? 0) - (c.stop ?? 0));
    const reward = Math.abs((c.target ?? 0) - (c.entry ?? 0));
    const rr = risk > 0 ? reward / risk : null;
    return rr == null ? "?" : rr < 1.2 ? "<1.2  (sub-floor)" : rr < 1.6 ? "1.2-1.6" : rr < 2.2 ? "1.6-2.2" : ">=2.2";
  }));
  reportGroup("by entry vs day move", bucketStat(closed, (c) => {
    const mv = dayMoveFromBasis(c.basis);
    if (mv == null) return "unknown";
    const aligned = (c.side === "long" && mv > 0) || (c.side === "short" && mv < 0);
    return Math.abs(mv) < 0.5 ? "flat entry" : aligned ? "with-trend (chase)" : "counter (dip)";
  }));

  // ---- Verdict --------------------------------------------------------------
  console.log("\n=== Verdict ===\n");
  if (expR == null) {
    console.log("  No R data on the closed trades — can't judge expectancy.");
  } else if (expR > 0.1) {
    console.log("  POSITIVE expectancy (" + rmult(expR) + "/trade). The board is net-profitable in R.");
    console.log("  Push the EDGE: the weakest by-kind / by-side / by-RR bucket above is where to");
    console.log("  tighten (raise DT_MIN_RR, DT_DIR_MIN, or the chase caps on the losing slice).");
  } else if (expR < -0.1) {
    console.log("  NEGATIVE expectancy (" + rmult(expR) + "/trade). The kept trades lose after stops.");
    console.log("  The worst bucket above is the first lever — if it's a low reward:risk or a");
    console.log("  with-trend (chase) slice, raise DT_MIN_RR / tighten the chase caps; if a whole");
    console.log("  side/kind is red, gate it. A decisive win rate well under the 1/(1+avgRR) break-");
    console.log("  even line means the direction read (dtDirection), not the exits, is the problem.");
  } else {
    console.log("  ~BREAK-EVEN (" + rmult(expR) + "/trade). Marginal. The sample is likely small —");
    console.log("  re-run as the board resolves more trades; lean on the by-bucket table to decide");
    console.log("  which slice to prune first (the negative-expectancy buckets are the candidates).");
  }
  console.log("\n  NOTE: underlying P/L (no options). The headline win rate counts an expired");
  console.log("  scratch as a win — trust the DECISIVE win rate + the R expectancy above.\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
