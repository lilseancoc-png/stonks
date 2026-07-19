// Read-only diagnostic (no network, no writes — not part of any workflow).
//
// Backtests the two headline Quant Lab screens (docs/quant-lab.md) against the
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
import { SECTORS, INDUSTRY_OF_TICKER, arOneHalfLife } from "./build.mjs";

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
const events = []; // { ind, pair, entryAbsZ, converged, sessions, sigmaCaptured, mrOk }
let pairsTested = 0;
let pairsQualified = 0;
for (const [ind, syms] of groups.entries()) {
  syms.sort();
  for (let i = 0; i < syms.length; i++) {
    for (let j = i + 1; j < syms.length; j++) {
      pairsTested++;
      const a = syms[i]; const b = syms[j];
      const mapB = new Map(bars.get(b).map((x) => [x.t, x.c]));
      const ca = []; const cb = [];
      for (const x of bars.get(a)) {
        const c2 = mapB.get(x.t);
        if (c2 > 0) { ca.push(x.c); cb.push(c2); }
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
          events.push({
            ind, pair: `${a}/${b}`, entryAbsZ: Math.abs(z), converged, sessions,
            sigmaCaptured: zExit != null ? Math.abs(z) - Math.abs(zExit) : null, mrOk,
          });
        } else if (inEvent && Math.abs(z) <= EXIT_Z) {
          inEvent = false; // re-arm for the next distinct excursion
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
  for (const e of entries) {
    const idx = idxByDate.get(e.date);
    if (idx == null) continue;
    const rv = rvAt(idx);
    if (rv == null || !isFinite(rv)) continue;
    series.push(Number(e.iv) - rv);
  }
  if (series.length < VRP_MIN_N + VRP_HORIZON) continue;
  vrpNames++;
  // Trailing (expanding-window) z at each day — no lookahead.
  for (let d = VRP_MIN_N; d < series.length - VRP_HORIZON; d++) {
    const ms = meanStd(series.slice(0, d + 1));
    if (!ms || !(ms.std > 0)) continue;
    const z = (series[d] - ms.mean) / ms.std;
    const delta = series[d + VRP_HORIZON] - series[d];
    if (z >= VRP_Z) richDeltas.push(delta);
    else if (z <= -VRP_Z) cheapDeltas.push(delta);
  }
}

console.log(`\n=== 2. VRP mean reversion (z vs own derived IV30−RV30 history, ${VRP_HORIZON}d horizon) ===`);
console.log(`${vrpNames} names with ≥${VRP_MIN_N + VRP_HORIZON} joined IV+RV sessions`);
if (richDeltas.length < 20 && cheapDeltas.length < 20) {
  console.log("Insufficient sample — iv-history needs more accumulation before this read means anything.");
} else {
  if (richDeltas.length) {
    console.log(
      `  RICH (z ≥ +${VRP_Z}): ${richDeltas.length} obs · compressed (Δ<0): ${pct(richDeltas.filter((d) => d < 0).length / richDeltas.length)}` +
      ` · mean Δvrp ${fmt(mean(richDeltas) * 100, 1)} vol pts (t ${fmt(tStat(richDeltas), 1)})`,
    );
  }
  if (cheapDeltas.length) {
    console.log(
      `  CHEAP (z ≤ −${VRP_Z}): ${cheapDeltas.length} obs · expanded (Δ>0): ${pct(cheapDeltas.filter((d) => d > 0).length / cheapDeltas.length)}` +
      ` · mean Δvrp ${fmt(mean(cheapDeltas) * 100, 1)} vol pts (t ${fmt(tStat(cheapDeltas), 1)})`,
    );
  }
  console.log("  — a real screen shows compression on rich and expansion on cheap; overlapping daily obs inflate t-stats, so read them as directional, not gospel.");
}
