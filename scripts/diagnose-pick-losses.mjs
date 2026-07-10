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
// A flat-stock loss held under this many calendar days is a FORCED EARLY CLOSE
// (weekly reset / roster churn / pre-earnings), not a theta read — ~0 days of
// decay can't explain the loss, and counting it as theta/vol steered the
// structure roadmap off a phantom signal. Mirrored by ACC_MIN_THETA_DAYS in
// scripts/render/app-js.mjs (the Track Record Summary tab).
const MIN_THETA_DAYS = 2;

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

// Model one resolved pick's option P&L (IV implied from the entry mid, held to exit)
// and the direction/theta counterfactuals. Returns null when the entry lacks the
// strike/expiry/mid/spots to model. Shared by the attribution table and the gate
// A/B below so the two can never drift.
function modelClosedPick(e) {
  if (!e || (e.outcome !== "win" && e.outcome !== "loss")) return null;
  const c = e.contract || {};
  // Defined-risk verticals don't decompose with this single-leg model (the short
  // wing offsets theta/vega) — skip them so the direction-vs-theta attribution
  // stays honest for naked longs. (Spread P/L lives in picks-accuracy already.)
  if (c.structure === "debit_vertical" || c.structure === "credit_vertical") return null;
  const side = e.side === "put" ? "put" : "call";
  const K = Number(c.strike), exp = Number(c.expiry), entryPrem = Number(c.mid);
  // Older closed records predate the exitSpot field — the tracker's lastSpot
  // (the mark that produced the close) is the same quantity.
  const S0 = Number(e.entrySpot), S1 = Number(e.exitSpot ?? e.lastSpot);
  const entrySec = Math.floor((Date.parse(e.entryDate) || 0) / 1000);
  const exitSec = Math.floor((Date.parse(e.exitDate) || 0) / 1000);
  if (!(K > 0 && exp > 0 && entryPrem > 0 && S0 > 0 && S1 > 0 && entrySec > 0 && exitSec > 0)) return null;
  const Tentry = yearsBetween(exp, entrySec);
  const Texit = yearsBetween(exp, exitSec);
  if (!(Tentry > 0)) return null;
  const iv = impliedVol(side, S0, K, Tentry, entryPrem);
  if (iv == null) return null;
  const priceAt = (S, T) => (T <= 1 / 365
    ? (side === "call" ? Math.max(0, S - K) : Math.max(0, K - S))
    : bsPrice(side, S, K, T, iv, RFR));
  const exitPrem = priceAt(S1, Texit);   // direction + theta
  const dirOnly = priceAt(S1, Tentry);   // spot moves, time frozen
  const thetaOnly = priceAt(S0, Texit);  // time passes, spot frozen
  return {
    sym: e.symbol, side, outcome: e.outcome, cohort: e.cohort || null, K, exp,
    heldDays: (exitSec - entrySec) / 86400,
    optPnl: ((exitPrem - entryPrem) / entryPrem) * 100,
    dirContrib: ((dirOnly - entryPrem) / entryPrem) * 100,
    thetaContrib: ((thetaOnly - entryPrem) / entryPrem) * 100,
    undMove: ((S1 - S0) / S0) * 100 * (side === "put" ? -1 : 1), // side-adjusted
  };
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
    if (e.cohort === "wait") continue; // attribution = the endorsed set; wait handled in the A/B below
    const m = modelClosedPick(e);
    if (!m) continue;
    let cls;
    if (m.optPnl >= 0) cls = "win";
    else if (m.undMove <= -ADVERSE_MOVE || m.dirContrib <= m.thetaContrib) cls = "direction";
    else if (m.heldDays < MIN_THETA_DAYS) cls = "churn";
    else cls = "theta/vol";
    // The most damning sub-case: the stock moved WITH the trade (or was flat) yet
    // the option still lost — pure vehicle bleed the underlying metric is blind to.
    // (Forced early closes excluded — nothing had time to bleed.)
    const flatButLost = m.optPnl < 0 && m.undMove >= -FAVORABLE_MOVE && cls !== "churn";

    rows.push({
      sym: m.sym, side: m.side, undMove: m.undMove, optPnl: m.optPnl, heldDays: m.heldDays,
      dirContrib: m.dirContrib, thetaContrib: m.thetaContrib, cls, flatButLost,
      spread: liveSpreadPct(chains, m.sym, m.side, m.K, m.exp),
      undExpectancy: m.undMove,
      outcome: m.outcome,
    });
  }

  if (!rows.length) {
    console.error("No closed picks carried enough contract data (strike/expiry/mid/spots) to model. Nothing to attribute.");
    process.exit(1);
  }

  // ---- Per-pick table -------------------------------------------------------
  console.log("\n=== Modeled option-P&L attribution for resolved picks (IV held at entry-implied) ===\n");
  console.log(pad("SYM", 7) + pad("SIDE", 6) + padL("stock", 8) + padL("OPTION", 9) + padL("dir", 8) + padL("theta", 8) + padL("spread", 8) + padL("held", 7) + "  class");
  console.log("-".repeat(79));
  for (const r of rows.sort((a, b) => a.optPnl - b.optPnl)) {
    console.log(
      pad(r.sym, 7) + pad(r.side, 6) + padL(pct(r.undMove), 8) + padL(pct(r.optPnl), 9) +
      padL(pct(r.dirContrib), 8) + padL(pct(r.thetaContrib), 8) +
      padL(r.spread == null ? "—" : (r.spread * 100).toFixed(0) + "%", 8) +
      padL(r.heldDays < 1 ? Math.round(r.heldDays * 24) + "h" : r.heldDays.toFixed(1) + "d", 7) +
      "  " + r.cls + (r.flatButLost ? "  ⚠ flat-but-lost" : "")
    );
  }

  // ---- Aggregates -----------------------------------------------------------
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const losses = rows.filter((r) => r.optPnl < 0);
  const wins = rows.filter((r) => r.optPnl >= 0);
  const dirLosses = losses.filter((r) => r.cls === "direction");
  const thetaLosses = losses.filter((r) => r.cls === "theta/vol");
  const churnLosses = losses.filter((r) => r.cls === "churn");
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
  console.log("    forced early close: " + churnLosses.length + "  (held <" + MIN_THETA_DAYS + "d — reset/churn/pre-earnings; too short to attribute to theta)");
  console.log("    flat/up but lost : " + flatButLost.length + "  (stock moved with the trade or ≤" + FAVORABLE_MOVE + "% against, option still red)");

  // ---- Verdict (over the ATTRIBUTABLE losses — forced early closes excluded) --
  const attributable = dirLosses.length + thetaLosses.length;
  const dirShare = attributable ? dirLosses.length / attributable : 0;
  if (churnLosses.length) console.log("\n  NOTE: " + churnLosses.length + " forced-early-close loss" + (churnLosses.length === 1 ? " is" : "es are") + " excluded from the direction-vs-theta verdict below.");
  console.log("\n=== Verdict ===\n");
  if (!attributable) {
    console.log("  NO ATTRIBUTABLE LOSSES — every loss was a forced early close (held <" + MIN_THETA_DAYS + "d).");
    console.log("  No direction-vs-theta read yet; let the book hold positions to a real exit.");
  } else if (dirShare >= 0.6) {
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
  // ---- Timing-gate A/B (go vs wait), modeled option P&L (rubric P0.2 / #5) -----
  // The decisive "does the timing gate earn its keep?" read. A true 2×2 across
  // {flat-8% stop × ATR-floor stop} needs the intraday PATH we don't store, so the
  // data-available proxy is the gate's own go-vs-wait split on modeled option P&L:
  // if endorsed (go) picks don't out-expect deferred (wait) picks, the gate isn't
  // adding value. Gate-era only (picks carrying a cohort tag) — and the honest
  // gate-era sample size, which is the #1 prerequisite for trusting ANY of this.
  const NEED = 25; // per-arm decided needed for a stable read
  const gateRows = acc.closed.map(modelClosedPick).filter((m) => m && m.cohort);
  const goRows = gateRows.filter((m) => m.cohort === "go");
  const waitRows = gateRows.filter((m) => m.cohort === "wait");
  console.log("\n=== Timing-gate A/B (go vs wait), modeled option P&L ===\n");
  console.log("  gate-era resolved : " + gateRows.length + "  (go " + goRows.length + " / wait " + waitRows.length + ")");
  const armStat = (rs) => (rs.length ? { exp: mean(rs.map((r) => r.optPnl)), win: rs.filter((r) => r.optPnl >= 0).length / rs.length * 100, n: rs.length } : null);
  const goS = armStat(goRows), waitS = armStat(waitRows);
  if (goS) console.log("  go   : option exp " + pct(goS.exp) + " · win " + goS.win.toFixed(0) + "% (n=" + goS.n + ")");
  if (waitS) console.log("  wait : option exp " + pct(waitS.exp) + " · win " + waitS.win.toFixed(0) + "% (n=" + waitS.n + ")");
  if (goS && waitS) {
    console.log("  marginal (go − wait) : " + pct(goS.exp - waitS.exp) + "   <- the gate's value-add; > 0 means endorsing helped");
  }
  if (goRows.length < NEED || waitRows.length < NEED) {
    console.log("  INSUFFICIENT gate-era sample — need ≥ " + NEED + " decided per arm for a stable read.");
    console.log("  The gate's edge stays UNPROVEN until forward, gate-era picks accumulate; re-run");
    console.log("  this as the open book resolves. (Since 2026-07-10 EVERY actionable pick enrolls");
    console.log("  cohort-tagged go/wait, so both arms populate by default.)");
  }

  console.log("\n  NOTE: modeled (no options feed). Entry IV implied from the stored entry mid;");
  console.log("  IV held constant to exit, so a real vol crush would make option losses worse,");
  console.log("  and the spread cost above is charged on top. Treat magnitudes as a floor.\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
