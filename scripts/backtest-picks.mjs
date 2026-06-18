// scripts/backtest-picks.mjs
//
// Read-only PORTFOLIO BACKTEST of the (reworked) Top Picks engine over the last
// ~month, answering the one question the forward track record is too small/young
// to answer yet: "if we had taken the picks the engine actually produced each day,
// would the book be POSITIVE?" No network, no writes — not part of any workflow.
//
// WHY THIS IS POSSIBLE AT ALL (and where it stops):
//   The engine's per-day output is RECORDED. data/grades-daily.json stores every
//   tracked name's signed grade `total` once per ET trading day (+ in = call lean,
//   − = put lean, |total| = conviction). That snapshot already bakes in EVERY
//   pillar — including fundamentals / narrative / unusual-flow, which are NOT
//   reconstructable from price history. So unlike scripts/diagnose-signal-ic.mjs
//   (which rebuilds only the FAST price/technical pillars point-in-time), this
//   replays the engine's ACTUAL composite decisions. We reselect the roster each
//   day from grades-daily exactly as buildTopPicks would (conviction bar + sector
//   cap + top-N), then realize each pick's outcome against the committed
//   per-ticker priceSeries (~1yr of daily closes).
//
// HARD CAVEATS — read before trusting a number:
//   • OPTION P&L IS MODELED. grades-daily stores the grade, NOT the contract the
//     engine shipped, and there is no historical options feed. So each pick is
//     modeled as a representative long option (ATM by default, BT_DTE days to
//     expiry) priced with Black-Scholes; entry IV is the name's TRAILING REALIZED
//     vol × BT_IV_PREM (options usually trade above realized), held CONSTANT to
//     exit. That isolates direction + theta from a vol crush (a real crush only
//     makes option losses worse), the same modeling stance as diagnose-pick-losses.
//   • FIXED HOLD, close-to-close. No intraday stop/target path (the engine has
//     volatility-aware exits this can't see). BT_HOLD trading-day hold; BT_SPREAD
//     charges a round-trip premium haircut on top.
//   • SURVIVORSHIP. The universe is TODAY's curated tickers, so ABSOLUTE returns
//     are upward-biased. The side-adjusted + relative reads (option vs underlying,
//     call vs put, vs SPY) are what to trust.
//   • SMALL / YOUNG SAMPLE. grades-daily only spans days where it has been written,
//     and only the post-rework rows reflect the current scorer. A "month" needs
//     ~21 snapshot days WITH BT_HOLD forward bars realized beyond each — early on
//     it will say "insufficient sample." That is honest, not a bug.
//
// This is a MODEL, not the till. The gold-standard read remains the forward,
// real-contract record in data/picks-accuracy.json (summarized at the end) as it
// accumulates. Treat this as the bigger-sample sanity check while that grows.
//
// Usage:  node scripts/sync-data.mjs pull   # hydrate data/ from the private store
//         node scripts/backtest-picks.mjs    # then run this
//   Tunables (env): BT_HOLD (10) BT_TOPN (10) BT_MIN_CONV (engine bar) BT_SECTOR_CAP
//   (engine cap) BT_DTE (60) BT_RVOL_WIN (20) BT_IV_PREM (1.10) BT_MONEYNESS_PCT (0)
//   BT_SPREAD_PCT (0) BT_START (YYYY-MM-DD lower bound) BT_HORIZONS (5,10,21)

import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bsPrice } from "../lib/greeks.mjs";
// build.mjs is imported DYNAMICALLY (loadEngineConfig below): it pulls the heavy
// @google/genai dep at module load, so a STATIC import would break this read-only
// diagnostic in a thin checkout. The other pure diagnostics avoid it for the same
// reason. When it loads cleanly we single-source the live engine config; otherwise
// we degrade to the printed defaults (sector cap off — see ENGINE_CFG).

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");
const RFR = 0.045;

const num = (v, d) => (v == null || v === "" || !isFinite(Number(v)) ? d : Number(v));
const int = (v, d) => Math.trunc(num(v, d));

// ---- engine-coupled config (defaults mirror the live constants; the real values
// override when build.mjs imports cleanly; BT_* env overrides both) ----
let SECTORS = {};
let MIN_CONV = num(process.env.BT_MIN_CONV, 7);
let SECTOR_CAP = Math.max(1, int(process.env.BT_SECTOR_CAP, 3));
let STRONG = num(process.env.BT_TIER_STRONG, 10);
let ENGINE_CFG = false;

async function loadEngineConfig() {
  try {
    const b = await import("./build.mjs");
    if (b && b.SECTORS) SECTORS = b.SECTORS;
    if (process.env.BT_MIN_CONV == null && Number.isFinite(b.PICKS_MIN_CONVICTION)) MIN_CONV = b.PICKS_MIN_CONVICTION;
    if (process.env.BT_SECTOR_CAP == null && Number.isFinite(b.PICKS_MAX_PER_SECTOR)) SECTOR_CAP = b.PICKS_MAX_PER_SECTOR;
    if (process.env.BT_TIER_STRONG == null && Number.isFinite(b.PICKS_TIER_STRONG)) STRONG = b.PICKS_TIER_STRONG;
    ENGINE_CFG = true;
  } catch {
    ENGINE_CFG = false; // thin env: no sector map → sector cap disabled, defaults stand
  }
}

// ---- tunables ----
const HOLD = Math.max(1, int(process.env.BT_HOLD, 10));            // trading-day hold
const TOPN = Math.max(1, int(process.env.BT_TOPN, 10));            // roster size cap
const DTE = Math.max(HOLD + 1, int(process.env.BT_DTE, 60));       // calendar DTE at entry
const RVOL_WIN = Math.max(5, int(process.env.BT_RVOL_WIN, 20));    // trailing days for IV proxy
const IV_PREM = Math.max(0.1, num(process.env.BT_IV_PREM, 1.10));  // entry IV = realizedVol × this
const MONEYNESS = num(process.env.BT_MONEYNESS_PCT, 0);            // % OTM in trade direction (0 = ATM)
const SPREAD = Math.max(0, num(process.env.BT_SPREAD_PCT, 0));     // round-trip premium haircut, % of entry
const START = (process.env.BT_START || "").trim() || null;        // optional lower-bound date
const HORIZONS = (process.env.BT_HORIZONS || "5,10,21").split(",").map((x) => int(x, 0)).filter((x) => x > 0);

const pct = (x) => (x == null || !isFinite(x) ? "  —  " : (x >= 0 ? "+" : "") + x.toFixed(1) + "%");
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function loadJson(name) {
  try { return JSON.parse(await readFile(resolve(DATA_DIR, name), "utf8")); }
  catch { return null; }
}

// Annualized realized vol (close-to-close log returns) over the window ending at i.
// This is the entry-IV proxy — point-in-time and self-contained (no options feed).
function realizedVol(closes, i, win) {
  if (i < win) return null;
  const rets = [];
  for (let k = i - win + 1; k <= i; k += 1) {
    const a = closes[k - 1], b = closes[k];
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 5) return null;
  const m = mean(rets);
  const v = rets.reduce((s, x) => s + (x - m) * (x - m), 0) / (rets.length - 1);
  return Math.sqrt(v * 252);
}

// Model one pick: returns { undRet, optRet } in % (side-adjusted), or null when
// the contract can't be priced (degenerate vol / span). `h` = hold in trading days.
function modelPick(side, closes, i, h) {
  const S0 = Number(closes[i]), S1 = Number(closes[i + h]);
  if (!(S0 > 0) || !(S1 > 0)) return null;
  const sign = side === "put" ? -1 : 1;
  const undRet = ((S1 - S0) / S0) * 100 * sign;
  const rv = realizedVol(closes, i, RVOL_WIN);
  if (!(rv > 0)) return null;
  const sigma = rv * IV_PREM;
  const K = side === "call" ? S0 * (1 + MONEYNESS / 100) : S0 * (1 - MONEYNESS / 100);
  const Tentry = DTE / 365;
  const Texit = (DTE - h) / 365;
  const entry = bsPrice(side, S0, K, Tentry, sigma, RFR);
  if (!(entry > 0)) return null;
  const exit = Texit <= 1 / 365
    ? (side === "call" ? Math.max(0, S1 - K) : Math.max(0, K - S1))
    : bsPrice(side, S1, K, Texit, sigma, RFR);
  if (exit == null || !isFinite(exit)) return null;
  // SPREAD is the full round-trip cost as a % of entry premium, charged once.
  const optRet = ((exit - entry) / entry) * 100 - SPREAD;
  return { undRet, optRet };
}

// Reselect the day's roster from a grade snapshot exactly as buildTopPicks does:
// conviction bar → conviction-desc → sector cap (ETF/null uncapped) → top-N.
function rosterForDay(totals) {
  const cands = [];
  for (const [sym, raw] of Object.entries(totals || {})) {
    const total = Number(raw);
    if (!Number.isFinite(total) || Math.abs(total) < MIN_CONV) continue;
    cands.push({ sym, total, conv: Math.abs(total), side: total > 0 ? "call" : "put", sector: SECTORS[sym] || null });
  }
  cands.sort((a, b) => b.conv - a.conv);
  const counts = {};
  const roster = [];
  for (const c of cands) {
    if (roster.length >= TOPN) break;
    const capped = c.sector && c.sector !== "ETF";
    if (capped && (counts[c.sector] || 0) >= SECTOR_CAP) continue;
    if (capped) counts[c.sector] = (counts[c.sector] || 0) + 1;
    roster.push(c);
  }
  return roster;
}

async function main() {
  await loadEngineConfig();
  const daily = await loadJson("grades-daily.json");
  const days = (daily && Array.isArray(daily.days) ? daily.days : [])
    .filter((d) => d && typeof d.date === "string" && d.totals && (!START || d.date >= START))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!days.length) {
    console.log("No data/grades-daily.json day rows (run `node scripts/sync-data.mjs pull` first; it");
    console.log("accumulates one row per ET day, so a fresh post-rework history needs a few sessions).");
    process.exit(0);
  }

  // Load every per-ticker priceSeries → { dateIndex, closes }.
  const files = await readdir(DATA_DIR);
  const series = {};
  for (const f of files) {
    if (!/^[A-Z][A-Z0-9.]{0,5}\.json$/.test(f)) continue;
    const sym = f.replace(/\.json$/, "");
    const j = await loadJson(f);
    const ps = j && j.priceSeries;
    if (!ps || !Array.isArray(ps.t) || !Array.isArray(ps.c) || ps.t.length !== ps.c.length) continue;
    const dateIndex = new Map();
    for (let k = 0; k < ps.t.length; k += 1) dateIndex.set(ps.t[k], k);
    series[sym] = { dateIndex, closes: ps.c };
  }
  if (!Object.keys(series).length) {
    console.log("No per-ticker priceSeries under data/ — run from a hydrated checkout (sync-data.mjs pull).");
    process.exit(0);
  }

  console.log("\n=== Top Picks portfolio backtest (modeled) ===\n");
  console.log(`Grade snapshots : ${days.length} ET day(s)  (${days[0].date} … ${days[days.length - 1].date})`);
  console.log(`Universe files  : ${Object.keys(series).length}`);
  console.log(`Roster rule     : |grade| ≥ ${MIN_CONV} · ${ENGINE_CFG ? "≤ " + SECTOR_CAP + "/sector (ETF uncapped)" : "sector cap OFF (build.mjs config not loadable here)"} · top ${TOPN}`);
  console.log(`Option model    : ${MONEYNESS === 0 ? "ATM" : (MONEYNESS > 0 ? "+" : "") + MONEYNESS + "% OTM"} long, ${DTE} DTE, IV = realizedVol(${RVOL_WIN}d)×${IV_PREM}, flat to exit` + (SPREAD ? `, −${SPREAD}% round-trip` : ""));
  console.log(`Primary hold    : ${HOLD} trading days   (horizon sweep: ${HORIZONS.join(", ")})\n`);

  // ---- Horizon sweep: expectancy of the roster at each hold ----
  console.log("=== Expectancy by holding window (mean per-trade return) ===\n");
  console.log(pad("hold", 8) + padL("trades", 8) + padL("UND win", 9) + padL("UND exp", 9) + padL("OPT win", 9) + padL("OPT exp", 10) + padL("OPT med", 9));
  console.log("-".repeat(62));
  const sweep = {};
  for (const h of HORIZONS) {
    const und = [], opt = [];
    for (const day of days) {
      for (const p of rosterForDay(day.totals)) {
        const s = series[p.sym];
        if (!s) continue;
        const i = s.dateIndex.get(day.date);
        if (i == null || i + h >= s.closes.length) continue; // unrealized / rolled out
        const m = modelPick(p.side, s.closes, i, h);
        if (!m) continue;
        und.push(m.undRet); opt.push(m.optRet);
      }
    }
    sweep[h] = { n: opt.length };
    if (!opt.length) { console.log(pad(h + "d", 8) + padL("0", 8) + "   (no realized forward bars yet)"); continue; }
    const uWin = und.filter((x) => x > 0).length / und.length * 100;
    const oWin = opt.filter((x) => x > 0).length / opt.length * 100;
    console.log(
      pad(h + "d", 8) + padL(opt.length, 8) +
      padL(uWin.toFixed(0) + "%", 9) + padL(pct(mean(und)), 9) +
      padL(oWin.toFixed(0) + "%", 9) + padL(pct(mean(opt)), 10) + padL(pct(median(opt)), 9)
    );
  }
  console.log("\n  UND = side-adjusted underlying move · OPT = modeled long-option P&L. OPT − UND nets the");
  console.log("  option's leverage against its theta/vega drag: OPT < UND ⇒ the premium tax is winning.\n");

  // ---- Detailed roster + equity curve at the primary hold ----
  const trades = [];            // every modeled pick at HOLD
  const dayBasket = [];         // { date, optRet:meanOfDay, n }
  for (const day of days) {
    const rets = [];
    for (const p of rosterForDay(day.totals)) {
      const s = series[p.sym];
      if (!s) continue;
      const i = s.dateIndex.get(day.date);
      if (i == null || i + HOLD >= s.closes.length) continue;
      const m = modelPick(p.side, s.closes, i, HOLD);
      if (!m) continue;
      const tier = p.conv >= STRONG ? "strong" : "normal";
      trades.push({ date: day.date, sym: p.sym, side: p.side, conv: p.conv, tier, sector: p.sector, ...m });
      rets.push(m.optRet);
    }
    if (rets.length) dayBasket.push({ date: day.date, optRet: mean(rets), n: rets.length });
  }

  if (!trades.length) {
    console.log(`No picks have ${HOLD} realized forward bars yet at the primary hold — the window is too`);
    console.log("young to score. Re-run after a few more sessions (or lower BT_HOLD for a shorter read).\n");
    await summarizeForwardRecord();
    process.exit(0);
  }

  const opt = trades.map((t) => t.optRet);
  const und = trades.map((t) => t.undRet);
  const wins = trades.filter((t) => t.optRet > 0);
  const optExp = mean(opt);

  console.log(`=== Headline @ ${HOLD}-day hold (${trades.length} modeled trades) ===\n`);
  console.log(`  Option WIN RATE     : ${(wins.length / trades.length * 100).toFixed(0)}%   (${wins.length}W / ${trades.length - wins.length}L)`);
  console.log(`  Option EXPECTANCY   : ${pct(optExp)} per trade   <- the "are we positive?" number`);
  console.log(`  Option median trade : ${pct(median(opt))}`);
  console.log(`  Underlying expectancy: ${pct(mean(und))}   (side-adjusted; option − underlying = ${pct(optExp - mean(und))}, leverage net of theta drag)`);

  // by side / tier / sector
  const grp = (key) => {
    const m = new Map();
    for (const t of trades) { const k = t[key] || "—"; if (!m.has(k)) m.set(k, []); m.get(k).push(t.optRet); }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  };
  const line = (k, a) => `    ${pad(k, 10)} n=${padL(a.length, 3)}  win ${padL((a.filter((x) => x > 0).length / a.length * 100).toFixed(0) + "%", 4)}  exp ${pct(mean(a))}`;
  console.log("\n  By side:");      for (const [k, a] of grp("side")) console.log(line(k, a));
  console.log("  By tier:");        for (const [k, a] of grp("tier")) console.log(line(k, a));
  const sect = grp("sector").slice(0, 8);
  console.log("  By sector (top 8 by count):"); for (const [k, a] of sect) console.log(line(k, a));

  // ---- Equity curve: NON-OVERLAPPING cohorts spaced HOLD snapshot-days apart ----
  // grades-daily is one row per trading day, so every HOLD-th basket is a fresh,
  // non-overlapping equal-weight deployment; compounding them is a clean book curve.
  const cohorts = dayBasket.filter((_, idx) => idx % HOLD === 0);
  let equity = 1;
  console.log(`\n=== Equity curve — non-overlapping ${HOLD}-day cohorts (equal-weight basket / cohort) ===\n`);
  console.log("    " + pad("entry", 12) + padL("picks", 7) + padL("basket", 9) + padL("equity", 10));
  for (const c of cohorts) {
    equity *= (1 + c.optRet / 100);
    console.log("    " + pad(c.date, 12) + padL(c.n, 7) + padL(pct(c.optRet), 9) + padL("×" + equity.toFixed(3), 10));
  }
  console.log(`\n  Compounded over ${cohorts.length} non-overlapping cohort(s): ×${equity.toFixed(3)}  (${pct((equity - 1) * 100)} on the book)`);

  // ---- Worst / best modeled trades (where the damage/edge concentrates) ----
  const sorted = [...trades].sort((a, b) => a.optRet - b.optRet);
  const show = (t) => `    ${pad(t.date, 12)}${pad(t.sym, 7)}${pad(t.side, 6)}conv ${padL(t.conv.toFixed(1), 5)}  und ${padL(pct(t.undRet), 7)}  opt ${padL(pct(t.optRet), 8)}`;
  console.log("\n  Worst 5 modeled trades:"); for (const t of sorted.slice(0, 5)) console.log(show(t));
  console.log("  Best 5 modeled trades:");  for (const t of sorted.slice(-5).reverse()) console.log(show(t));

  // ---- Verdict ----
  console.log("\n=== Verdict (MODELED — read with the caveats) ===\n");
  if (optExp > 0.5 && wins.length / trades.length >= 0.45) {
    console.log(`  POSITIVE in this window: +${optExp.toFixed(1)}% modeled per trade at a ${(wins.length / trades.length * 100).toFixed(0)}% hit rate.`);
    console.log("  The reworked grade's directional edge survived the theta tax here. Confirm it forward");
    console.log("  in data/picks-accuracy.json before sizing up — this is one short, modeled window.");
  } else if (optExp < -0.5) {
    console.log(`  NEGATIVE in this window: ${optExp.toFixed(1)}% modeled per trade. Even where the underlying`);
    console.log(`  edge is ${pct(mean(und))}, long premium bled it to red. That points at the VEHICLE`);
    console.log("  (debit verticals / shorter DTE / tighter entries), not necessarily the score —");
    console.log("  cross-check scripts/diagnose-pick-losses.mjs (direction vs theta attribution).");
  } else {
    console.log(`  ~FLAT in this window (${pct(optExp)} per trade). Inconclusive at this sample — the edge,`);
    console.log("  if any, is inside the noise. Let grades-daily / picks-accuracy accumulate and re-run.");
  }

  await summarizeForwardRecord();

  console.log("\n  NOTE: modeled, no options feed. Entry IV = trailing realized vol × " + IV_PREM + ", held flat to");
  console.log("  exit; ATM/" + DTE + "-DTE representative contract; close-to-close, no stop path. Treat magnitudes");
  console.log("  as indicative — the real, real-contract record is data/picks-accuracy.json.\n");
}

// The gold-standard cross-check: the actual forward, real-contract resolved record.
async function summarizeForwardRecord() {
  const acc = await loadJson("picks-accuracy.json");
  const closed = acc && Array.isArray(acc.closed) ? acc.closed.filter((e) => e && (e.outcome === "win" || e.outcome === "loss")) : [];
  console.log("\n=== Cross-check: REAL forward record (data/picks-accuracy.json) ===\n");
  if (!closed.length) {
    console.log("  No resolved real picks yet (or file not hydrated). This is the gold standard once it");
    console.log("  fills — the modeled backtest above is the bigger-sample stand-in until then.");
    return;
  }
  const w = closed.filter((e) => e.outcome === "win").length;
  const realRets = closed.map((e) => Number(e.optionPnlPct)).filter((x) => isFinite(x));
  console.log(`  Resolved real picks : ${closed.length}  (${w}W / ${closed.length - w}L · win ${(w / closed.length * 100).toFixed(0)}%)`);
  if (realRets.length) console.log(`  Modeled option expectancy : ${pct(mean(realRets))} per pick  (engine-stamped optionPnlPct on resolved picks)`);
  console.log("  (Small/young + weekly-reset — see scripts/diagnose-pick-losses.mjs for the attribution.)");
}

main().catch((err) => { console.error(err); process.exit(1); });
