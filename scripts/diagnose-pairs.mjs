// Read-only diagnostic (no network, no writes — not part of any workflow).
//
// Backtests the headline Quant Lab screens (docs/quant-lab.md) against the
// committed data/ so the pair and VRP z-scores can be judged BEFORE anyone
// treats them as more than an analytical map — this is the go/no-go gate for
// ever promoting a screen toward anything actionable.
//
// 1. PAIR SPREAD CONVERGENCE — for every within-industry pair that clears the
//    live engine's return-correlation gate (same grouping + corr >= 0.60 as
//    buildQuantPairs), walk the aligned close history; each time the 60-day
//    log price-ratio z first crosses ±2 (a fresh entry event), measure:
//      - did |z| revert to <= 0.5 within 20 sessions? (convergence rate)
//      - σ-units captured: |z_entry| − |z_exit| at reversion or the 20-session
//        timeout (positive = the spread actually came in)
//      - split by the AR(1) mean-reversion badge at entry (mrOk), because the
//        live UI tells users to trust the badge — this checks whether it earns
//        that trust.
//      - split by the RETRO REGIME at entry (validates the regime
//        conditioning): vol level from SPY's trailing 20d realized vol and
//        trend/range from SPY's trailing 60d efficiency ratio + monotone
//        thirds — the same bars buildQuantRegime uses, minus VIX (not
//        persisted per-day; disclosed limitation). The conditioning claim —
//        mean-reversion works best calm/range-bound, worst in trends/high
//        vol — must show up here to earn the regime-adjusted bars.
// 1b. HEDGED-SPREAD (Engle-Granger) CONVERGENCE — the same walk on the NEW
//    live spread: lnA − β·lnB with β re-estimated daily from the trailing
//    ≤250 sessions (no lookahead), entries at ±2σ of the trailing 60d z,
//    forward walk with β frozen at entry. Split by the EG cointegration
//    badge at entry (τ vs the MacKinnon 5% bar) — the badge must beat the
//    not-cointegrated cohort to earn its place next to the AR(1) badge.
// 2. VRP COMPRESSION — per name, derive the IV30 − RV30 series exactly like
//    buildQuantVrp (iv-history joined to rolling 30d realized vol from
//    priceSeries). At each day where the TRAILING z (expanding window, no
//    lookahead) is >= +1.5, measure Δvrp over the next 10 sessions (a rich
//    premium should compress, Δ < 0); symmetric for z <= −1.5 (cheap should
//    expand). Hit rates + mean Δ + t-stat.
//
//   node scripts/diagnose-pairs.mjs
//
// Needs a hydrated data/ (node scripts/sync-data.mjs pull). Degrades to
// "insufficient sample" per section until the histories accumulate. All
// windows/thresholds mirror the live engine (QUANT_* in build.mjs).

import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SECTORS,
  INDUSTRY_OF_TICKER,
  arOneHalfLife,
  quantEngleGranger,
  quantEfficiencyRatio,
} from "./build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

// Mirror the live engine's tunables (build.mjs QUANT_*).
const CORR_MIN = 0.6;
const CORR_WIN = 120;
const PXZ_WIN = 60;
const ENTRY_Z = 2;
const EXIT_Z = 0.5;
const CONVERGE_SESSIONS = 20;
const HL_MAX = 30;
const EG_MIN_N = 200; // mirrors QUANT_PAIR_EG_MIN_N
const VRP_MIN_N = 60;
const VRP_Z = 1.5;
const VRP_HORIZON = 10;

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}
function tStat(a) {
  const s = sd(a);
  return s > 0 ? mean(a) / (s / Math.sqrt(a.length)) : null;
}
function meanStd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
  return { mean: m, std: Math.sqrt(v) };
}
const fmt = (v, dp = 2) => (v == null || !isFinite(v) ? "—" : Number(v).toFixed(dp));
const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");

// ---- Load bars + iv-history -------------------------------------------------
async function loadBars(sym) {
  try {
    const raw = await readFile(resolve(DATA_DIR, `${sym}.json`), "utf8");
    const ps = JSON.parse(raw)?.priceSeries;
    if (!ps || !Array.isArray(ps.t) || !Array.isArray(ps.c)) return null;
    const out = [];
    for (let i = 0; i < ps.t.length; i++) if (ps.t[i] && ps.c[i] > 0) out.push({ t: ps.t[i], c: ps.c[i] });
    return out.length > 1 ? out : null;
  } catch { return null; }
}
async function loadIvEntries(sym) {
  try {
    const raw = await readFile(resolve(DATA_DIR, "iv-history", `${sym}.json`), "utf8");
    const entries = JSON.parse(raw)?.entries;
    return Array.isArray(entries) ? entries.filter((e) => e?.date && Number(e.iv) > 0) : [];
  } catch { return []; }
}

let files;
try {
  files = await readdir(DATA_DIR);
} catch {
  console.log("No data/ directory — hydrate it first: node scripts/sync-data.mjs pull");
  process.exit(0);
}
const symbols = files
  .filter((f) => /^[A-Z][A-Z0-9.]{0,5}\.json$/.test(f))
  .map((f) => f.replace(/\.json$/, ""))
  .filter((s) => SECTORS[s] !== "ETF")
  .sort();
if (!symbols.length) {
  console.log("No per-ticker JSON in data/ — hydrate it first: node scripts/sync-data.mjs pull");
  process.exit(0);
}
const bars = new Map();
for (const s of symbols) {
  const b = await loadBars(s);
  if (b) bars.set(s, b);
}
console.log(`Loaded ${bars.size}/${symbols.length} price series from data/`);

// ---- Retro regime classification (SPY, no lookahead) ------------------------
// Mirrors buildQuantRegime's RV + efficiency-ratio halves (VIX isn't persisted
// per-day, so the retro vol read is RV-only — disclosed in the section notes).
const REG_RV_HIGH = 20; // vol pts, mirrors QUANT_REGIME_RV_HIGH
const REG_RV_LOW = 12;
const REG_TREND_WIN = 60;
const REG_TREND_ER = 0.35;
const spyBars = await loadBars("SPY");
const spyIdxByDate = spyBars ? new Map(spyBars.map((b, i) => [b.t, i])) : new Map();
const spyCloses = spyBars ? spyBars.map((b) => b.c) : [];
function regimeAt(dateStr) {
  const idx = spyIdxByDate.get(dateStr);
  if (idx == null) return { vol: null, trend: null };
  let vol = null;
  if (idx >= 21) {
    const tail = spyCloses.slice(idx - 20, idx + 1);
    const rets = [];
    for (let k = 1; k < tail.length; k++) rets.push(Math.log(tail[k] / tail[k - 1]));
    const m = mean(rets);
    const v = rets.reduce((s, r) => s + (r - m) * (r - m), 0) / (rets.length - 1);
    const rv = Math.sqrt(v) * Math.sqrt(252) * 100;
    vol = rv >= REG_RV_HIGH ? "high" : rv <= REG_RV_LOW ? "low" : "normal";
  }
  let trend = null;
  if (idx >= REG_TREND_WIN - 1) {
    const w = spyCloses.slice(idx - REG_TREND_WIN + 1, idx + 1);
    const er = quantEfficiencyRatio(w);
    const third = Math.floor(REG_TREND_WIN / 3);
    const hi = (a) => Math.max(...a);
    const lo = (a) => Math.min(...a);
    const t1 = w.slice(0, third);
    const t2 = w.slice(third, 2 * third);
    const t3 = w.slice(2 * third);
    const hhhl = hi(t1) < hi(t2) && hi(t2) < hi(t3) && lo(t1) < lo(t2) && lo(t2) < lo(t3);
    const lllh = hi(t1) > hi(t2) && hi(t2) > hi(t3) && lo(t1) > lo(t2) && lo(t2) > lo(t3);
    trend = (er != null && er >= REG_TREND_ER) || hhhl || lllh ? "trending" : "range";
  }
  return { vol, trend };
}
if (!spyBars) console.log("No SPY series in data/ — regime splits will be skipped.");

// ---- Pair grouping (mirrors buildQuantPairs) --------------------------------
const groups = new Map();
for (const sym of bars.keys()) {
  const key = INDUSTRY_OF_TICKER[sym] || SECTORS[sym] || null;
  if (!key) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(sym);
}
const singles = [];
for (const [key, syms] of Array.from(groups.entries())) {
  if (syms.length < 2) { singles.push(...syms); groups.delete(key); }
}
const bySector = new Map();
for (const sym of singles) {
  const sec = SECTORS[sym];
  if (!sec) continue;
  if (!bySector.has(sec)) bySector.set(sec, []);
  bySector.get(sec).push(sym);
}
for (const [sec, syms] of bySector.entries()) if (syms.length >= 2) groups.set(sec, syms);

// ---- 1. Pair spread convergence --------------------------------------------
const events = []; // { ind, pair, entryAbsZ, converged, sessions, sigmaCaptured, mrOk, regVol, regTrend }
const egEvents = []; // hedged-spread walk: { converged, sessions, sigmaCaptured, egOk }
let pairsTested = 0;
let pairsQualified = 0;
for (const [ind, syms] of groups.entries()) {
  syms.sort();
  for (let i = 0; i < syms.length; i++) {
    for (let j = i + 1; j < syms.length; j++) {
      pairsTested++;
      const a = syms[i]; const b = syms[j];
      const mapB = new Map(bars.get(b).map((x) => [x.t, x.c]));
      const ca = []; const cb = []; const dt = [];
      for (const x of bars.get(a)) {
        const c2 = mapB.get(x.t);
        if (c2 > 0) { ca.push(x.c); cb.push(c2); dt.push(x.t); }
      }
      if (ca.length < PXZ_WIN + CONVERGE_SESSIONS + 2) continue;
      // Correlation gate over the trailing window (same as live).
      const ra = []; const rb = [];
      for (let k = 1; k < ca.length; k++) { ra.push(Math.log(ca[k] / ca[k - 1])); rb.push(Math.log(cb[k] / cb[k - 1])); }
      const wr = Math.min(CORR_WIN, ra.length);
      const raW = ra.slice(-wr); const rbW = rb.slice(-wr);
      const ms1 = meanStd(raW); const ms2 = meanStd(rbW);
      if (!ms1 || !ms2 || !(ms1.std > 0) || !(ms2.std > 0)) continue;
      let cov = 0;
      for (let k = 0; k < wr; k++) cov += (raW[k] - ms1.mean) * (rbW[k] - ms2.mean);
      const corr = cov / ((wr - 1) * ms1.std * ms2.std);
      if (!(corr >= CORR_MIN)) continue;
      pairsQualified++;
      // Walk the ratio; z at D uses the trailing PXZ_WIN window ending at D.
      const ratio = ca.map((c, k) => Math.log(c / cb[k]));
      const zAt = (d) => {
        const w = ratio.slice(d - PXZ_WIN + 1, d + 1);
        const ms = meanStd(w);
        return ms && ms.std > 0 ? (ratio[d] - ms.mean) / ms.std : null;
      };
      let inEvent = false;
      for (let d = PXZ_WIN; d < ratio.length; d++) {
        const z = zAt(d);
        if (z == null) continue;
        if (!inEvent && Math.abs(z) >= ENTRY_Z) {
          inEvent = true;
          // Skip events whose forward window falls off the series edge.
          if (d + CONVERGE_SESSIONS >= ratio.length) break;
          const hl = arOneHalfLife(ratio.slice(d - PXZ_WIN + 1, d + 1));
          const mrOk = !!(hl && hl.phi < 0 && hl.halfLife != null && hl.halfLife <= HL_MAX);
          let converged = false; let sessions = CONVERGE_SESSIONS; let zExit = null;
          for (let f = 1; f <= CONVERGE_SESSIONS; f++) {
            const zf = zAt(d + f);
            if (zf == null) continue;
            zExit = zf;
            if (Math.abs(zf) <= EXIT_Z) { converged = true; sessions = f; break; }
          }
          const reg = regimeAt(dt[d]);
          events.push({
            ind, pair: `${a}/${b}`, entryAbsZ: Math.abs(z), converged, sessions,
            sigmaCaptured: zExit != null ? Math.abs(z) - Math.abs(zExit) : null, mrOk,
            regVol: reg.vol, regTrend: reg.trend,
          });
        } else if (inEvent && Math.abs(z) <= EXIT_Z) {
          inEvent = false; // re-arm for the next distinct excursion
        }
      }
      // --- 1b. Hedged-spread walk (mirrors the reworked live spread) --------
      // β re-estimated daily from the trailing ≤250 sessions (no lookahead);
      // entries at ±ENTRY_Z of the trailing PXZ_WIN z; forward walk with β
      // FROZEN at entry (the position you'd actually hold). EG badge stamped
      // from the same trailing window at entry.
      const lnA = ca.map((c) => Math.log(c));
      const lnB2 = cb.map((c) => Math.log(c));
      const hedgedZAt = (d, beta) => {
        if (d - PXZ_WIN + 1 < 0) return null;
        const w = [];
        for (let k = d - PXZ_WIN + 1; k <= d; k++) w.push(lnA[k] - beta * lnB2[k]);
        const ms = meanStd(w);
        return ms && ms.std > 0 ? (w[w.length - 1] - ms.mean) / ms.std : null;
      };
      let inEg = false;
      for (let d = EG_MIN_N; d < lnA.length; d++) {
        const eg = quantEngleGranger(lnA.slice(Math.max(0, d - 249), d + 1), lnB2.slice(Math.max(0, d - 249), d + 1));
        if (!eg || !(eg.beta > 0)) { inEg = false; continue; }
        const z = hedgedZAt(d, eg.beta);
        if (z == null) continue;
        if (!inEg && Math.abs(z) >= ENTRY_Z) {
          inEg = true;
          if (d + CONVERGE_SESSIONS >= lnA.length) break;
          let converged = false; let sessions = CONVERGE_SESSIONS; let zExit = null;
          for (let f = 1; f <= CONVERGE_SESSIONS; f++) {
            const zf = hedgedZAt(d + f, eg.beta); // frozen entry β
            if (zf == null) continue;
            zExit = zf;
            if (Math.abs(zf) <= EXIT_Z) { converged = true; sessions = f; break; }
          }
          egEvents.push({
            converged, sessions,
            sigmaCaptured: zExit != null ? Math.abs(z) - Math.abs(zExit) : null,
            egOk: eg.ok,
          });
        } else if (inEg && Math.abs(z) <= EXIT_Z) {
          inEg = false;
        }
      }
    }
  }
}

console.log("\n=== 1. Pair spread convergence (±2σ entries on the 60d log price ratio) ===");
console.log(`${pairsQualified}/${pairsTested} candidate pairs clear the corr ≥ ${CORR_MIN} gate`);
if (events.length < 10) {
  console.log(`Insufficient sample (${events.length} entry events) — needs more price history or more qualified pairs.`);
} else {
  const report = (label, evs) => {
    if (!evs.length) { console.log(`  ${label}: no events`); return; }
    const caps = evs.map((e) => e.sigmaCaptured).filter((v) => v != null);
    const conv = evs.filter((e) => e.converged);
    console.log(
      `  ${label}: ${evs.length} events · converged ≤0.5σ within ${CONVERGE_SESSIONS}d: ${pct(conv.length / evs.length)}` +
      ` · median sessions ${conv.length ? conv.map((e) => e.sessions).sort((x, y) => x - y)[Math.floor(conv.length / 2)] : "—"}` +
      ` · mean σ captured ${fmt(mean(caps))} (t ${fmt(tStat(caps), 1)})`,
    );
  };
  report("ALL", events);
  report("mrOk (AR(1) badge)", events.filter((e) => e.mrOk));
  report("no-MR", events.filter((e) => !e.mrOk));
  console.log("  — the mrOk row must beat the no-MR row for the badge to earn its keep.");
  if (events.some((e) => e.regVol || e.regTrend)) {
    console.log("  By retro regime at entry (SPY RV20 + ER60 — no VIX per-day history, so vol is RV-only):");
    report("  vol low", events.filter((e) => e.regVol === "low"));
    report("  vol normal", events.filter((e) => e.regVol === "normal"));
    report("  vol high", events.filter((e) => e.regVol === "high"));
    report("  range-bound", events.filter((e) => e.regTrend === "range"));
    report("  trending", events.filter((e) => e.regTrend === "trending"));
    report("  calm+range (regime-tightened bar)", events.filter((e) => e.regVol === "low" && e.regTrend === "range"));
    report("  trend or high-vol (regime-raised bar)", events.filter((e) => e.regTrend === "trending" || e.regVol === "high"));
    console.log("  — the conditioning earns its bars if calm/range converges better than trend/high-vol.");
  }
  const byInd = new Map();
  for (const e of events) {
    if (!byInd.has(e.ind)) byInd.set(e.ind, []);
    byInd.get(e.ind).push(e);
  }
  console.log("  Per industry (n ≥ 5):");
  [...byInd.entries()].filter(([, v]) => v.length >= 5)
    .sort((x, y) => y[1].length - x[1].length)
    .forEach(([ind, evs]) => {
      const conv = evs.filter((e) => e.converged).length;
      console.log(`    ${ind}: ${evs.length} events, ${pct(conv / evs.length)} converged, mean σ captured ${fmt(mean(evs.map((e) => e.sigmaCaptured).filter((v) => v != null)))}`);
    });
}

// ---- 1b. Hedged-spread (Engle-Granger) convergence --------------------------
console.log(`\n=== 1b. Hedged-spread convergence (lnA − β·lnB, trailing-window EG, ±${ENTRY_Z}σ entries) ===`);
if (egEvents.length < 10) {
  console.log(`Insufficient sample (${egEvents.length} entry events) — needs ≥${EG_MIN_N} aligned sessions per pair before the walk starts.`);
} else {
  const egReport = (label, evs) => {
    if (!evs.length) { console.log(`  ${label}: no events`); return; }
    const caps = evs.map((e) => e.sigmaCaptured).filter((v) => v != null);
    const conv = evs.filter((e) => e.converged);
    console.log(
      `  ${label}: ${evs.length} events · converged ≤${EXIT_Z}σ within ${CONVERGE_SESSIONS}d: ${pct(conv.length / evs.length)}` +
      ` · median sessions ${conv.length ? conv.map((e) => e.sessions).sort((x, y) => x - y)[Math.floor(conv.length / 2)] : "—"}` +
      ` · mean σ captured ${fmt(mean(caps))} (t ${fmt(tStat(caps), 1)})`,
    );
  };
  egReport("ALL", egEvents);
  egReport("cointegrated (EG badge)", egEvents.filter((e) => e.egOk));
  egReport("not cointegrated", egEvents.filter((e) => !e.egOk));
  console.log("  — the EG-badge row must beat the not-cointegrated row for the badge to earn its place beside the AR(1) read.");
}

// ---- 2. VRP compression -----------------------------------------------------
const richDeltas = []; const cheapDeltas = [];
let vrpNames = 0;
for (const sym of bars.keys()) {
  const entries = await loadIvEntries(sym);
  if (entries.length < VRP_MIN_N) continue;
  const b = bars.get(sym);
  const closes = b.map((x) => x.c);
  const idxByDate = new Map(b.map((x, i) => [x.t, i]));
  // Derive the vrp series exactly like buildQuantVrp (30d log-return RV).
  const rvAt = (idx) => {
    if (idx < 31) return null;
    const tail = closes.slice(idx - 30, idx + 1);
    const rets = [];
    for (let k = 1; k < tail.length; k++) rets.push(Math.log(tail[k] / tail[k - 1]));
    const m = mean(rets);
    const v = rets.reduce((s, r) => s + (r - m) * (r - m), 0) / (rets.length - 1);
    return Math.sqrt(v) * Math.sqrt(252);
  };
  const series = [];
  const seriesDates = [];
  for (const e of entries) {
    const idx = idxByDate.get(e.date);
    if (idx == null) continue;
    const rv = rvAt(idx);
    if (rv == null || !isFinite(rv)) continue;
    series.push(Number(e.iv) - rv);
    seriesDates.push(e.date);
  }
  if (series.length < VRP_MIN_N + VRP_HORIZON) continue;
  vrpNames++;
  // Trailing (expanding-window) z at each day — no lookahead.
  for (let d = VRP_MIN_N; d < series.length - VRP_HORIZON; d++) {
    const ms = meanStd(series.slice(0, d + 1));
    if (!ms || !(ms.std > 0)) continue;
    const z = (series[d] - ms.mean) / ms.std;
    const delta = series[d + VRP_HORIZON] - series[d];
    const vol = regimeAt(seriesDates[d]).vol;
    if (z >= VRP_Z) richDeltas.push({ delta, vol });
    else if (z <= -VRP_Z) cheapDeltas.push({ delta, vol });
  }
}

console.log(`\n=== 2. VRP mean reversion (z vs own derived IV30−RV30 history, ${VRP_HORIZON}d horizon) ===`);
console.log(`${vrpNames} names with ≥${VRP_MIN_N + VRP_HORIZON} joined IV+RV sessions`);
if (richDeltas.length < 20 && cheapDeltas.length < 20) {
  console.log("Insufficient sample — iv-history needs more accumulation before this read means anything.");
} else {
  const vrpLine = (label, obs, wantSign) => {
    if (!obs.length) return;
    const ds = obs.map((o) => o.delta);
    const hits = wantSign < 0 ? ds.filter((d) => d < 0) : ds.filter((d) => d > 0);
    console.log(
      `  ${label}: ${ds.length} obs · ${wantSign < 0 ? "compressed (Δ<0)" : "expanded (Δ>0)"}: ${pct(hits.length / ds.length)}` +
      ` · mean Δvrp ${fmt(mean(ds) * 100, 1)} vol pts (t ${fmt(tStat(ds), 1)})`,
    );
  };
  vrpLine(`RICH (z ≥ +${VRP_Z})`, richDeltas, -1);
  vrpLine(`CHEAP (z ≤ −${VRP_Z})`, cheapDeltas, +1);
  if (richDeltas.some((o) => o.vol)) {
    console.log("  RICH split by retro vol regime (validates the regime-raised rich bar):");
    for (const lvl of ["low", "normal", "high"]) {
      vrpLine(`  vol ${lvl}`, richDeltas.filter((o) => o.vol === lvl), -1);
    }
    console.log("  — if high-vol rich readings compress less reliably, the raised bar is earning its keep.");
  }
  console.log("  — a real screen shows compression on rich and expansion on cheap; overlapping daily obs inflate t-stats, so read them as directional, not gospel.");
}
