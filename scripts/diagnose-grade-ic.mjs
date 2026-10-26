// Read-only diagnostic (no network, no writes — not part of any workflow).
//
// Universe-wide information coefficient (IC) for the Top Picks GRADE: does the
// score actually call forward direction? The enrolled track record accrues ~5
// picks per build at best (go-only enrollment), so per-signal/per-grade IC from
// picks-accuracy.json takes quarters to reach a stable n. This script instead
// measures the WHOLE universe: data/grades-daily.json stores every tracked
// name's grade `total` once per ET day (written by build.mjs / regen-picks.mjs),
// and each committed data/<SYM>.json carries ~1yr of daily closes (priceSeries).
// Joining the two gives ~138 (grade, forward-return) pairs per snapshot day —
// thousands of observations per quarter instead of ~10.
//
// For each snapshot day D and horizon h ∈ {5, 10, 14} trading days:
//   - forward return = close[D+h] / close[D] − 1 (close-to-close; the snapshot
//     row is the day's LAST build, post-close once the 16:00 bake lands)
//   - cross-sectional Spearman rank IC between grade total and forward return
//   - top-minus-bottom decile spread (mean fwd return of the highest-graded
//     decile minus the lowest) — the "would a long/short on the grade pay?" read
// Aggregated per horizon: mean IC, t-stat across days, % positive days, mean
// decile spread. A grade that can call 2-week direction should show a reliably
// positive mean IC; ~0 (or negative) says the composite needs fixing/fading
// before any contract/exit machinery can save it (the same verdict logic as
// scripts/diagnose-pick-losses.mjs, measured on a far bigger sample).
//
//   node scripts/diagnose-grade-ic.mjs
//
// Older snapshot days fall off as priceSeries' trailing window rolls; recent
// days without h forward bars yet are reported as pending. Run it any time —
// it degrades to "insufficient sample" until grades-daily.json accumulates.

import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

const HORIZONS = [5, 10, 14];   // trading days
const MIN_NAMES_PER_DAY = 20;   // below this cross-section, skip the day's IC
const MIN_DAYS_FOR_TSTAT = 5;   // below this many resolved days, don't print a t-stat

function spearman(pairs) {
  // Average-rank ties, then Pearson on the ranks.
  const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(vals.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const xs = rank(pairs.map((p) => p[0]));
  const ys = rank(pairs.map((p) => p[1]));
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let k = 0; k < n; k += 1) {
    const dx = xs[k] - mx, dy = ys[k] - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  if (!(vx > 0) || !(vy > 0)) return null;
  return cov / Math.sqrt(vx * vy);
}

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}

// ---- Load the daily grade snapshots ----------------------------------------
let daily;
try {
  daily = JSON.parse(await readFile(resolve(DATA_DIR, "grades-daily.json"), "utf8"));
} catch {
  console.log("No data/grades-daily.json yet — it accumulates one row per ET day once builds run with this change. Re-run after a few sessions.");
  process.exit(0);
}
const days = (Array.isArray(daily?.days) ? daily.days : []).filter((d) => d && d.date && d.totals);
if (!days.length) {
  console.log("data/grades-daily.json has no day rows yet. Re-run after a few sessions.");
  process.exit(0);
}

// ---- Load every per-ticker price series ------------------------------------
const files = await readdir(DATA_DIR);
const symbols = files
  .filter((f) => /^[A-Z][A-Z0-9.]{0,5}\.json$/.test(f))
  .map((f) => f.replace(/\.json$/, ""));
const series = {}; // sym -> { dateIndex: Map(date -> i), closes: [] }
for (const sym of symbols) {
  try {
    const j = JSON.parse(await readFile(resolve(DATA_DIR, `${sym}.json`), "utf8"));
    const ps = j && j.priceSeries;
    if (!ps || !Array.isArray(ps.t) || !Array.isArray(ps.c) || ps.t.length !== ps.c.length) continue;
    const dateIndex = new Map();
    for (let i = 0; i < ps.t.length; i += 1) dateIndex.set(ps.t[i], i);
    series[sym] = { dateIndex, closes: ps.c };
  } catch { /* unreadable ticker file — skip */ }
}
if (!Object.keys(series).length) {
  console.log("No per-ticker priceSeries found under data/ — run from a checkout with committed ticker JSON.");
  process.exit(0);
}

// ---- Per-day, per-horizon cross-sectional IC --------------------------------
console.log("=== Universe-wide grade IC (Spearman: grade total vs forward close-to-close return) ===\n");
console.log(`Snapshot days: ${days.length} (${days[0].date} … ${days[days.length - 1].date}) · universe files: ${Object.keys(series).length}\n`);

for (const h of HORIZONS) {
  const perDay = []; // { date, ic, n, spread }
  let pendingDays = 0, thinDays = 0;
  for (const day of days) {
    const pairs = []; // [total, fwdRetPct]
    let anyEntry = false;
    for (const [sym, total] of Object.entries(day.totals)) {
      const t = Number(total);
      const s = series[sym];
      if (!Number.isFinite(t) || !s) continue;
      const i = s.dateIndex.get(day.date);
      if (i == null) continue;        // snapshot day rolled out of the trailing window
      anyEntry = true;
      if (i + h >= s.closes.length) continue; // forward bar not realized yet
      const c0 = Number(s.closes[i]), c1 = Number(s.closes[i + h]);
      // c1 must be a REAL close: priceSeries stores null for a missing bar and
      // Number(null) is 0, which passed isFinite and injected a fake −100%
      // forward return that swamped the day's IC + decile spread.
      if (!(c0 > 0) || !(c1 > 0)) continue;
      pairs.push([t, ((c1 - c0) / c0) * 100]);
    }
    if (!pairs.length) { if (anyEntry) pendingDays += 1; continue; }
    if (pairs.length < MIN_NAMES_PER_DAY) { thinDays += 1; continue; }
    const ic = spearman(pairs);
    if (ic == null) continue;
    // Top-minus-bottom decile spread on the grade.
    const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
    const k = Math.max(1, Math.floor(sorted.length / 10));
    const bottom = mean(sorted.slice(0, k).map((p) => p[1]));
    const top = mean(sorted.slice(-k).map((p) => p[1]));
    perDay.push({ date: day.date, ic, n: pairs.length, spread: top - bottom });
  }

  console.log(`--- Horizon ${h} trading days ---`);
  if (!perDay.length) {
    console.log(`  no resolved days yet (${pendingDays} pending forward bars, ${thinDays} below the ${MIN_NAMES_PER_DAY}-name floor)\n`);
    continue;
  }
  const ics = perDay.map((d) => d.ic);
  const spreads = perDay.map((d) => d.spread);
  const m = mean(ics);
  const s = sd(ics);
  const t = (s != null && s > 0 && perDay.length >= MIN_DAYS_FOR_TSTAT)
    ? m / (s / Math.sqrt(perDay.length)) : null;
  const posShare = ics.filter((x) => x > 0).length / ics.length;
  console.log(`  days resolved : ${perDay.length}${pendingDays ? `  (+${pendingDays} pending)` : ""}`);
  console.log(`  mean IC       : ${m.toFixed(3)}${t != null ? `   t-stat ${t.toFixed(2)}` : "   (t-stat needs ≥" + MIN_DAYS_FOR_TSTAT + " days)"}`);
  console.log(`  IC > 0 days   : ${(posShare * 100).toFixed(0)}%`);
  console.log(`  decile spread : ${mean(spreads) >= 0 ? "+" : ""}${mean(spreads).toFixed(2)}%  (top-graded decile fwd return minus bottom)`);
  if (perDay.length <= 12) {
    for (const d of perDay) {
      console.log(`    ${d.date}  IC ${d.ic >= 0 ? "+" : ""}${d.ic.toFixed(3)}  n=${d.n}  spread ${d.spread >= 0 ? "+" : ""}${d.spread.toFixed(2)}%`);
    }
  }
  console.log("");
}

// ---- Shadow signals (lib/shadow-signals.mjs) ---------------------------------
// Candidate inputs logged next to the grade but never scored. For each one and
// each horizon: the mean daily Spearman IC against the forward return, the
// same IC after removing what the grade already explains (rank partial
// correlation), and a t-stat on NON-overlapping days only (every h-th day), so
// the 5/10/14-day windows don't count the same move many times. Sparse signals
// (guidance, peer events) rarely reach 20 names a day, so they also get a
// pooled read: the day-demeaned forward return (and its absolute size) by value.
function fwdReturn(sym, date, h) {
  const s = series[sym];
  if (!s) return null;
  const i = s.dateIndex.get(date);
  if (i == null || i + h >= s.closes.length) return null;
  const c0 = Number(s.closes[i]), c1 = Number(s.closes[i + h]);
  return c0 > 0 && c1 > 0 ? ((c1 - c0) / c0) * 100 : null;
}
function partial(rxy, rxz, rzy) {
  const d = Math.sqrt((1 - rxz * rxz) * (1 - rzy * rzy));
  return d > 0 ? (rxy - rxz * rzy) / d : null;
}
function tNonOverlap(rows, h) {
  const picked = rows.filter((_, i) => i % h === 0).map((r) => r.v).filter((v) => v != null);
  const m = mean(picked), s = sd(picked);
  return { n: picked.length, t: picked.length >= MIN_DAYS_FOR_TSTAT && s > 0 ? m / (s / Math.sqrt(picked.length)) : null };
}
const shadowDays = days.filter((d) => d.shadow && Array.isArray(d.shadow.keys) && d.shadow.rows);
if (shadowDays.length) {
  console.log("=== Shadow signals (logged, not scored) ===\n");
  console.log(`Days with shadow rows: ${shadowDays.length} (${shadowDays[0].date} … ${shadowDays[shadowDays.length - 1].date})\n`);
  const keys = [...new Set(shadowDays.flatMap((d) => d.shadow.keys))];
  for (const key of keys) {
    console.log(`--- ${key} ---`);
    for (const h of HORIZONS) {
      const perDay = [];
      const pooled = new Map(); // value bucket -> { ex: [], abs: [] }
      for (const day of shadowDays) {
        const ki = day.shadow.keys.indexOf(key);
        if (ki < 0) continue;
        const trip = []; // [signal, grade, fwd]
        for (const [sym, vals] of Object.entries(day.shadow.rows)) {
          const v = Array.isArray(vals) ? Number(vals[ki]) : NaN;
          if (vals?.[ki] == null || !Number.isFinite(v)) continue;
          const f = fwdReturn(sym, day.date, h);
          const g = Number(day.totals?.[sym]);
          if (f == null || !Number.isFinite(g)) continue;
          trip.push([v, g, f]);
        }
        if (!trip.length) continue;
        // Demean against the whole covered universe that day, not just the
        // names carrying this signal (a sparse signal's own mean is itself).
        const dayRets = Object.keys(day.totals || {}).map((sym) => fwdReturn(sym, day.date, h)).filter((f) => f != null);
        const dayMean = mean(dayRets);
        if (key === "pg" || key === "pe14") {
          for (const [v, , f] of trip) {
            const b = key === "pe14" ? (v >= 1 ? "1+" : "0") : String(v);
            if (!pooled.has(b)) pooled.set(b, { ex: [], abs: [] });
            pooled.get(b).ex.push(f - dayMean);
            pooled.get(b).abs.push(Math.abs(f - dayMean));
          }
        }
        if (trip.length < MIN_NAMES_PER_DAY) continue;
        const rsy = spearman(trip.map((t) => [t[0], t[2]]));
        const rsg = spearman(trip.map((t) => [t[0], t[1]]));
        const rgy = spearman(trip.map((t) => [t[1], t[2]]));
        if (rsy == null) continue;
        perDay.push({ date: day.date, v: rsy, p: rsg != null && rgy != null ? partial(rsy, rsg, rgy) : null, n: trip.length });
      }
      if (perDay.length) {
        const ic = mean(perDay.map((d) => d.v));
        const pc = mean(perDay.map((d) => d.p).filter((x) => x != null));
        const t = tNonOverlap(perDay, h);
        console.log(`  ${h}d: IC ${ic >= 0 ? "+" : ""}${ic.toFixed(3)} · after grade ${pc == null ? "n/a" : (pc >= 0 ? "+" : "") + pc.toFixed(3)} · ${perDay.length} days${t.t != null ? ` · t ${t.t.toFixed(2)} on ${t.n} non-overlapping days` : ` (t-stat needs ≥${MIN_DAYS_FOR_TSTAT} non-overlapping days)`}`);
      } else {
        console.log(`  ${h}d: no day with ≥${MIN_NAMES_PER_DAY} names and resolved forward bars yet`);
      }
      if (pooled.size) {
        const parts = [...pooled.entries()].sort().map(([b, a]) => `${b}: ${mean(a.ex) >= 0 ? "+" : ""}${mean(a.ex).toFixed(2)}% (|${mean(a.abs).toFixed(2)}%|, n=${a.ex.length})`);
        console.log(`       pooled vs day mean: ${parts.join(" · ")}`);
      }
    }
    console.log("");
  }
  console.log("Promotion bar for a shadow signal: the right sign at 5 and 10 days, still positive");
  console.log("after the grade, and t ≳ 2 on non-overlapping days (~40-60 trading days of rows).");
  console.log("pe14 is about move SIZE, not direction: compare the |…| column, not the sign.\n");
}

console.log("Reading: a reliably positive mean IC (t-stat ≳ 2 over ≥ ~30 days) says the grade");
console.log("ranks forward direction; ~0 says re-weight (the IC bridge, rubric §9.6) or fade the");
console.log("composite before tuning contracts/exits. Spearman on the cross-section is scale-free,");
console.log("so the standardizer/horizon-weight reworks don't distort the comparison across builds.");
