// scripts/diagnose-pick-losses.mjs
//
// READ-ONLY loss-attribution diagnostic for the resolved Top Picks track record.
// Answers the one question that decides the structure roadmap (rubric P1.x / the
// options-trader playbook): are the realized losses DIRECTION-driven (the stock
// went the wrong way — the signal was wrong) or THETA/VOL-driven (the stock was
// flat/favorable but the long premium bled anyway — the vehicle is the problem)?
//
//   - If losses are mostly DIRECTION → debit spreads + premium stops only make a
//     wrong signal smaller; the real work is the score (fix/fade it) + standing
//     down (the P0.4 absolute floor + an edge governor).
//   - If losses are mostly THETA/VOL on a flat/up stock → verticals (sell the
//     expensive wing) + premium-space exits are the highest-leverage fixes.
//
// No network, no writes. We have no options-price feed, so the option P&L is
// MODELED with Black-Scholes: entry IV is implied from the stored entry mid, then
// the contract is repriced at the exit spot/time with IV held constant. Holding
// IV constant is deliberate — it isolates direction + theta from vega so the
// decomposition is clean; the headline magnitude is therefore a floor on the real
// option loss (a vol crush would only make it worse).
//
// Usage:  node scripts/diagnose-pick-losses.mjs

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bsPrice } from "../lib/greeks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");
const RFR = 0.045;
const YEAR_SECS = 365.25 * 24 * 3600;
const FAVORABLE_MOVE = 1.0;   // |stock move| ≤ this% counts as "flat"
const ADVERSE_MOVE = 3.0;     // stock move ≤ -this% against the trade = clearly direction-driven

const pct = (x) => (x == null || !isFinite(x) ? "  —  " : (x >= 0 ? "+" : "") + x.toFixed(1) + "%");
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

// Implied vol from a target premium via bisection (BS price is monotonic in σ).
function impliedVol(side, S, K, T, target) {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(target > 0)) return null;
  const intrinsic = side === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
  if (target <= intrinsic) return null; // all-intrinsic / arbitrage-y mark — can't imply σ
  let lo = 0.01, hi = 5.0;
  if (bsPrice(side, S, K, T, hi, RFR) < target) return hi; // target above even 500% vol → clamp
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const p = bsPrice(side, S, K, T, mid, RFR);
    if (p == null || !isFinite(p)) return null;
    if (p > target) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

function yearsBetween(expirySec, refSec) {
  return Math.max(0, (expirySec - refSec) / YEAR_SECS);
}

async function loadJson(name) {
  try { return JSON.parse(await readFile(resolve(DATA_DIR, name), "utf8")); }
  catch { return null; }
}

// Best-effort live spread for the contract (entry-quote bid/ask aren't stored on
// legacy entries) — look the strike/expiry up in the committed chain so we can
// estimate the round-trip fill cost the modeled P&L above omits.
function liveSpreadPct(chains, sym, side, strike, expiry) {
  const ch = chains?.[sym]?.chains?.[String(expiry)];
  const rows = ch ? (side === "call" ? ch.c : ch.p) : null;
  if (!Array.isArray(rows)) return null;
  const row = rows.find((r) => Number(r.s) === Number(strike));
  if (!row || !(row.b > 0) || !(row.a > 0)) return null;
  const mid = (row.b + row.a) / 2;
  return mid > 0 ? (row.a - row.b) / mid : null;
}

async function main() {
  const acc = await loadJson("picks-accuracy.json");
  if (!acc || !Array.isArray(acc.closed)) {
    console.error("No data/picks-accuracy.json with a closed[] array — nothing to diagnose.");
    process.exit(1);
  }
  // Per-ticker chains are only needed for the (optional) live-spread estimate.
  const tickers = [...new Set(acc.closed.map((e) => e.symbol))];
  const chains = {};
  for (const sym of tickers) {
    const d = await loadJson(`${sym}.json`);
    if (d) chains[sym] = d;
  }

  const rows = [];
  for (const e of acc.closed) {
    if (e.outcome !== "win" && e.outcome !== "loss") continue;
    if (e.cohort === "wait") continue;
    const c = e.contract || {};
    const side = e.side === "put" ? "put" : "call";
    const K = Number(c.strike), exp = Number(c.expiry), entryPrem = Number(c.mid);
    const S0 = Number(e.entrySpot), S1 = Number(e.exitSpot);
    const entrySec = Math.floor((Date.parse(e.entryDate) || 0) / 1000);
    const exitSec = Math.floor((Date.parse(e.exitDate) || 0) / 1000);
    if (!(K > 0 && exp > 0 && entryPrem > 0 && S0 > 0 && S1 > 0 && entrySec > 0 && exitSec > 0)) continue;

    const Tentry = yearsBetween(exp, entrySec);
    const Texit = yearsBetween(exp, exitSec);
    if (!(Tentry > 0)) continue;

    const iv = impliedVol(side, S0, K, Tentry, entryPrem);
    if (iv == null) continue;

    // Exit value (IV held constant) and the two counterfactuals isolating each greek.
    const priceAt = (S, T) => (T <= 1 / 365
      ? (side === "call" ? Math.max(0, S - K) : Math.max(0, K - S))
      : bsPrice(side, S, K, T, iv, RFR));
    const exitPrem = priceAt(S1, Texit);          // direction + theta
    const dirOnly = priceAt(S1, Tentry);          // spot moves, time frozen
    const thetaOnly = priceAt(S0, Texit);         // time passes, spot frozen

    const optPnl = ((exitPrem - entryPrem) / entryPrem) * 100;
    const dirContrib = ((dirOnly - entryPrem) / entryPrem) * 100;
    const thetaContrib = ((thetaOnly - entryPrem) / entryPrem) * 100;
    const undMove = ((S1 - S0) / S0) * 100 * (side === "put" ? -1 : 1); // side-adjusted

    let cls;
    if (optPnl >= 0) cls = "win";
    else if (undMove <= -ADVERSE_MOVE || dirContrib <= thetaContrib) cls = "direction";
    else cls = "theta/vol";
    // The most damning sub-case: the stock moved WITH the trade (or was flat) yet
    // the option still lost — pure vehicle bleed the underlying metric is blind to.
    const flatButLost = optPnl < 0 && undMove >= -FAVORABLE_MOVE;

    rows.push({
      sym: e.symbol, side, undMove, optPnl, dirContrib, thetaContrib, cls, flatButLost,
      spread: liveSpreadPct(chains, e.symbol, side, K, exp),
      undExpectancy: undMove,
      outcome: e.outcome,
    });
  }

  if (!rows.length) {
    console.error("No closed picks carried enough contract data (strike/expiry/mid/spots) to model. Nothing to attribute.");
    process.exit(1);
  }

  // ---- Per-pick table -------------------------------------------------------
  console.log("\n=== Modeled option-P&L attribution for resolved picks (IV held at entry-implied) ===\n");
  console.log(pad("SYM", 7) + pad("SIDE", 6) + padL("stock", 8) + padL("OPTION", 9) + padL("dir", 8) + padL("theta", 8) + padL("spread", 8) + "  class");
  console.log("-".repeat(72));
  for (const r of rows.sort((a, b) => a.optPnl - b.optPnl)) {
    console.log(
      pad(r.sym, 7) + pad(r.side, 6) + padL(pct(r.undMove), 8) + padL(pct(r.optPnl), 9) +
      padL(pct(r.dirContrib), 8) + padL(pct(r.thetaContrib), 8) +
      padL(r.spread == null ? "—" : (r.spread * 100).toFixed(0) + "%", 8) +
      "  " + r.cls + (r.flatButLost ? "  ⚠ flat-but-lost" : "")
    );
  }

  // ---- Aggregates -----------------------------------------------------------
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const losses = rows.filter((r) => r.optPnl < 0);
  const wins = rows.filter((r) => r.optPnl >= 0);
  const dirLosses = losses.filter((r) => r.cls === "direction");
  const thetaLosses = losses.filter((r) => r.cls === "theta/vol");
  const flatButLost = rows.filter((r) => r.flatButLost);
  const spreads = rows.map((r) => r.spread).filter((x) => x != null);

  const undExp = mean(rows.map((r) => r.undMove));
  const optExp = mean(rows.map((r) => r.optPnl));

  console.log("\n=== Summary (" + rows.length + " modeled / " + acc.closed.length + " closed) ===\n");
  console.log("  Modeled option win rate : " + (wins.length / rows.length * 100).toFixed(0) + "%  (" + wins.length + "W / " + losses.length + "L)");
  console.log("  Underlying expectancy   : " + pct(undExp) + "   (side-adjusted stock move)");
  console.log("  MODELED option expectancy: " + pct(optExp) + "   <- the premium tax the stock-move headline hides");
  if (spreads.length) {
    console.log("  Avg live round-trip spread: " + (mean(spreads) * 100).toFixed(1) + "%   (cost charged ON TOP, not in the modeled P&L above)");
  }
  console.log("");
  console.log("  Loss attribution (" + losses.length + " losses):");
  console.log("    direction-driven : " + dirLosses.length + "  (" + (losses.length ? (dirLosses.length / losses.length * 100).toFixed(0) : 0) + "%)   avg stock " + pct(mean(dirLosses.map((r) => r.undMove))) + " · avg option " + pct(mean(dirLosses.map((r) => r.optPnl))));
  console.log("    theta/vol-driven : " + thetaLosses.length + "  (" + (losses.length ? (thetaLosses.length / losses.length * 100).toFixed(0) : 0) + "%)   avg stock " + pct(mean(thetaLosses.map((r) => r.undMove))) + " · avg option " + pct(mean(thetaLosses.map((r) => r.optPnl))));
  console.log("    flat/up but lost : " + flatButLost.length + "  (stock moved with the trade or ≤" + FAVORABLE_MOVE + "% against, option still red)");

  // ---- Verdict --------------------------------------------------------------
  const dirShare = losses.length ? dirLosses.length / losses.length : 0;
  console.log("\n=== Verdict ===\n");
  if (dirShare >= 0.6) {
    console.log("  DIRECTION-DRIVEN losses dominate (" + (dirShare * 100).toFixed(0) + "%). The signal is picking the");
    console.log("  wrong side, not the vehicle bleeding. Verticals + premium stops shrink the");
    console.log("  loss but don't fix it — prioritize the SCORE (fix or fade it) and STANDING DOWN");
    console.log("  (the P0.4 absolute floor + an edge governor). Structure work is secondary.");
  } else if (dirShare <= 0.4) {
    console.log("  THETA/VOL losses dominate (" + ((1 - dirShare) * 100).toFixed(0) + "%). The stock often went the right way");
    console.log("  (or nowhere) and the long premium still bled. Debit verticals (sell the rich");
    console.log("  wing) + premium-space exits (P0.3) are the highest-leverage fixes here.");
  } else {
    console.log("  MIXED (" + (dirShare * 100).toFixed(0) + "% direction / " + ((1 - dirShare) * 100).toFixed(0) + "% theta-vol). Both the signal and the vehicle are");
    console.log("  costing money. Sequence the cheap measurement/policy fixes (P0) first, then");
    console.log("  re-run this after a forward sample to see which lever moved the needle.");
  }
  console.log("\n  NOTE: modeled (no options feed). Entry IV implied from the stored entry mid;");
  console.log("  IV held constant to exit, so a real vol crush would make option losses worse,");
  console.log("  and the spread cost above is charged on top. Treat magnitudes as a floor.\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
