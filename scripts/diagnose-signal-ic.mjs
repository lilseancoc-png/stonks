// Read-only diagnostic (no network, no writes — not part of any workflow).
//
// Point-in-time CROSS-SECTIONAL INFORMATION-COEFFICIENT backtest over the
// committed per-ticker price history (`data/<SYM>.json` → `priceSeries`, ~1yr of
// daily bars). It is the offline counterpart to scripts/diagnose-grade-ic.mjs:
// where that one needs LIVE forward outcomes to accumulate (and is empty for
// weeks after a track-record reset), this reconstructs the engine's PRICE /
// TECHNICAL / ENTRY-TIMING signals point-in-time from the bars already on disk
// and measures whether they predict forward returns RIGHT NOW, over thousands of
// name-date observations.
//
// What it answers (the levers the long-horizon rework, #419, changed):
//   1. HOLDING HORIZON — does signal IC persist/grow from 5d → 30d? (validates the
//      DTE band 45-90 + the 30-day measured hold vs the old 14-day force-exit)
//   2. TECHNICALS CAP — is the extreme-momentum tail predictive or mean-reverting?
//      (validates / challenges PICKS_TECH_CAP)
//   3. ENTRY TIMING — do chase / knife / pullback states actually sort forward
//      returns the way computeEntryTiming assumes, and is it regime-dependent?
//
// HARD CAVEATS (read before trusting a number):
//   • UNDERLYING ≠ OPTION. This measures STOCK forward return, not long-option
//     P&L — it is blind to IV/theta/crush, which is exactly why the engine's
//     chase penalty + the tech cap aren't simply "wrong" when they disagree here.
//   • SURVIVORSHIP. The universe is TODAY's curated tickers, so ABSOLUTE forward
//     returns are upward-biased; the cross-sectional RANK IC ("did higher-signal
//     names beat lower-signal names on the SAME day") is far less affected — read
//     the IC/spread, not the absolute level.
//   • ONE REGIME CYCLE. ~12 months of one universe — momentum's dominance is
//     partly period-specific (see the regime split at the end).
//   • Fundamentals / narrative / mechanicals are NOT reconstructable historically
//     (only today's snapshot is on disk), so this validates the FAST pillars only.
//
// Usage: `node scripts/diagnose-signal-ic.mjs` from the repo root.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { computeEntryTiming } from "./build.mjs";

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data");
const syms = readdirSync(DATA).filter((f) => /^[A-Z][A-Z0-9.]*\.json$/.test(f)).map((f) => f.replace(".json", ""));

// ---- math helpers ----
function ema(arr, n) {
  const k = 2 / (n + 1); const out = new Array(arr.length).fill(null); let prev = null;
  for (let i = 0; i < arr.length; i++) { prev = prev == null ? arr[i] : arr[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
function rsiSeries(c, n = 14) {
  const out = new Array(c.length).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1], g = Math.max(0, ch), l = Math.max(0, -ch);
    if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
    else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  return out;
}
function smaAt(c, i, n) { if (i + 1 < n) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += c[j]; return s / n; }
function spearman(xs, ys) {
  const n = xs.length; if (n < 8) return null;
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); let i = 0;
    while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const ax = rx[i] - mx, ay = ry[i] - my; num += ax * ay; dx += ax * ax; dy += ay * ay; }
  return dx === 0 || dy === 0 ? null : num / Math.sqrt(dx * dy);
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// ---- build point-in-time observations, indexed by date (the cross-section) ----
const HOR = [5, 10, 20, 30];
const MINLB = 60; // need RSI14 + SMA50 + 20/60d momentum before the first obs
const byDate = new Map();
let tk = 0;
for (const s of syms) {
  let d; try { d = JSON.parse(readFileSync(`${DATA}/${s}.json`, "utf8")); } catch { continue; }
  const ps = d.priceSeries; if (!ps || !Array.isArray(ps.c) || ps.c.length < MINLB + 35) continue;
  const { t, c, h, l, v } = ps; const N = c.length;
  const rsi = rsiSeries(c, 14);
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const ml = e12.map((x, i) => (x == null || e26[i] == null) ? null : x - e26[i]);
  const sig9 = ema(ml.map((x) => (x == null ? 0 : x)), 9);
  tk++;
  for (let i = MINLB; i < N - 5; i++) {
    const sma20 = smaAt(c, i, 20), sma50 = smaAt(c, i, 50), sma100 = smaAt(c, i, 100);
    if (sma20 == null || sma50 == null) continue;
    const w0 = Math.max(0, i - 251); let lo = Infinity, hi = -Infinity;
    for (let j = w0; j <= i; j++) { if (l[j] < lo) lo = l[j]; if (h[j] > hi) hi = h[j]; }
    const rangePos = hi > lo ? (c[i] - lo) / (hi - lo) : 0.5;
    const stack = (c[i] > sma20 ? 1 : 0) + (c[i] > sma50 ? 1 : 0) + (sma100 != null && c[i] > sma100 ? 1 : 0);
    const distSma20 = (c[i] / sma20 - 1) * 100;
    const mom20 = c[i] / c[i - 20] - 1, mom60 = c[i - 60] ? c[i] / c[i - 60] - 1 : null;
    const ret5 = c[i] / c[i - 5] - 1;
    const macdHist = (ml[i] != null && sig9[i] != null) ? ml[i] - sig9[i] : 0;
    const r = rsi[i] != null ? rsi[i] : 50;
    let st = 0; for (let j = i; j > 0; j--) { const up = c[j] > c[j - 1]; if (j === i) st = up ? 1 : -1; else { if (up && st > 0) st++; else if (!up && st < 0) st--; else break; } }
    // reconstructed "technicals pillar" proxy (engine-style discrete ±1 sum)
    let tech = 0;
    tech += stack >= 2 ? 1 : (stack <= 1 ? -1 : 0);
    tech += macdHist > 0 ? 1 : (macdHist < 0 ? -1 : 0);
    tech += st > 0 ? 1 : (st < 0 ? -1 : 0);
    tech += (r > 50 && rsi[i - 5] != null && r > rsi[i - 5]) ? 1 : ((r < 50 && rsi[i - 5] != null && r < rsi[i - 5]) ? -1 : 0);
    tech += rangePos >= 0.95 ? -1 : (rangePos <= 0.05 ? 1 : 0);
    tech += mom20 > 0.05 ? 1 : (mom20 < -0.05 ? -1 : 0);
    // Run the production v2 gate point-in-time. Element i+1 is deliberately
    // included as the synthetic in-progress bar that computeEntryTiming drops,
    // leaving session i as the latest confirmed observation.
    const pointData = {
      spot: c[i],
      fundamentals: {},
      priceSeries: {
        t: t.slice(0, i + 2), c: c.slice(0, i + 2),
        h: h.slice(0, i + 2), l: l.slice(0, i + 2),
        v: Array.isArray(v) ? v.slice(0, i + 2) : [],
      },
    };
    const timingCall = computeEntryTiming("call", pointData, c[i], { regime: "neutral" });
    const timingPut = computeEntryTiming("put", pointData, c[i], { regime: "neutral" });
    const fwd = {}, maeCall = {}, maePut = {}; let ok = false;
    for (const hh of HOR) {
      if (i + hh < N) {
        const path = c.slice(i + 1, i + hh + 1).map((x) => x / c[i] - 1);
        fwd[hh] = path[path.length - 1];
        maeCall[hh] = Math.min(0, ...path);
        maePut[hh] = Math.min(0, ...path.map((x) => -x));
        ok = true;
      }
    }
    if (!ok) continue;
    if (!byDate.has(t[i])) byDate.set(t[i], []);
    byDate.get(t[i]).push({ sym: s, tech, mom20, mom60, rsi: r, stack, distSma20, rangePos, macdHist, streak: st, timingCall, timingPut, fwd, maeCall, maePut });
  }
}

function ic(key, hh, sign = 1) {
  const ics = [];
  for (const [, recs] of byDate) {
    const xs = [], ys = [];
    for (const r of recs) { const sv = r[key]; if (sv == null || r.fwd[hh] == null) continue; xs.push(sign * sv); ys.push(r.fwd[hh]); }
    if (xs.length >= 20) { const v = spearman(xs, ys); if (v != null) ics.push(v); }
  }
  if (ics.length < 10) return null;
  const m = mean(ics), sd = Math.sqrt(mean(ics.map((x) => (x - m) ** 2)));
  return { mean: m, t: sd === 0 ? 0 : m / sd * Math.sqrt(ics.length), nDays: ics.length };
}

let totalObs = 0; for (const [, r] of byDate) totalObs += r.length;
const pad = (s, n) => String(s).padEnd(n);
console.log(`Universe: ${tk} tickers · ${byDate.size} dates · ${totalObs} name-date observations`);
console.log(`Forward windows (trading days): ${HOR.join(", ")}`);
console.log(`(UNDERLYING return, not option P&L; survivorship-biased absolute levels — read the rank IC + spreads.)\n`);

console.log("=== 1. Cross-sectional rank IC (mean | t-stat) — does the signal predict forward return? ===");
console.log(pad("signal", 30) + HOR.map((h) => pad(h + "d", 16)).join(""));
for (const [label, key] of [["tech (reconstructed pillar)", "tech"], ["mom20 (20d momentum)", "mom20"], ["mom60 (60d momentum)", "mom60"], ["stack (SMA structure)", "stack"], ["rsi14", "rsi"], ["rangePos (52w position)", "rangePos"], ["macdHist", "macdHist"], ["distSma20 (extension)", "distSma20"]]) {
  let row = pad(label, 30);
  for (const hh of HOR) { const r = ic(key, hh); row += pad(r ? `${r.mean >= 0 ? "+" : ""}${r.mean.toFixed(4)} (t${r.t >= 0 ? "+" : ""}${r.t.toFixed(1)})` : "—", 16); }
  console.log(row);
}

console.log("\n=== 2. TECH CAP: forward return by reconstructed-tech bucket (does the extreme tail roll over?) ===");
for (const hh of [10, 20, 30]) {
  const b = new Map();
  for (const [, recs] of byDate) for (const r of recs) { if (r.fwd[hh] == null) continue; if (!b.has(r.tech)) b.set(r.tech, []); b.get(r.tech).push(r.fwd[hh]); }
  const rows = [...b.entries()].filter(([, a]) => a.length >= 200).sort((x, y) => x[0] - y[0]);
  console.log(`  h=${hh}d:  ` + rows.map(([k, a]) => `tech${k >= 0 ? "+" : ""}${k}:${(mean(a) * 100).toFixed(2)}%(n${a.length})`).join("  "));
}

console.log("\n=== 3. ENTRY TIMING V2: side-aware mean directional return by production state ===");
for (const hh of [10, 20, 30]) {
  const call = { go: [], wait: [], avoid: [] }, put = { go: [], wait: [], avoid: [] };
  const callMae = { go: [], wait: [], avoid: [] }, putMae = { go: [], wait: [], avoid: [] };
  for (const [, recs] of byDate) for (const r of recs) {
    if (r.fwd[hh] == null) continue;
    call[r.timingCall.state].push(r.fwd[hh]);
    put[r.timingPut.state].push(-r.fwd[hh]);
    callMae[r.timingCall.state].push(r.maeCall[hh]);
    putMae[r.timingPut.state].push(r.maePut[hh]);
  }
  const fmt = (a) => `${(mean(a) * 100).toFixed(2)}% (n${a.length})`;
  console.log(`  h=${hh}d CALL: GO ${fmt(call.go)} | WAIT ${fmt(call.wait)} | AVOID ${fmt(call.avoid)}`);
  console.log(`        PUT : GO ${fmt(put.go)} | WAIT ${fmt(put.wait)} | AVOID ${fmt(put.avoid)}`);
  if (hh === 10) {
    console.log(`        MAE : CALL go ${(mean(callMae.go) * 100).toFixed(2)}% / wait ${(mean(callMae.wait) * 100).toFixed(2)}% / avoid ${(mean(callMae.avoid) * 100).toFixed(2)}% · PUT go ${(mean(putMae.go) * 100).toFixed(2)}% / wait ${(mean(putMae.wait) * 100).toFixed(2)}% / avoid ${(mean(putMae.avoid) * 100).toFixed(2)}%`);
  }
}
const setupGroups = { healthy: [], knife: [], exhaustion: [], other: [] };
for (const [, recs] of byDate) for (const r of recs) {
  if (r.fwd[10] == null) continue;
  for (const [timing, ret] of [[r.timingCall, r.fwd[10]], [r.timingPut, -r.fwd[10]]]) {
    const k = timing.setupKind === "healthy-pullback" ? "healthy"
      : timing.hardVeto === "knife" ? "knife"
        : timing.hardVeto === "exhaustion" ? "exhaustion" : "other";
    setupGroups[k].push(ret);
  }
}
console.log("  10d setup detail: " + Object.entries(setupGroups).map(([k, a]) => `${k} ${(mean(a) * 100).toFixed(2)}% (n${a.length})`).join(" | "));

console.log("\n=== 4. HOLDING HORIZON: top-minus-bottom-decile fwd-return spread of `tech`, by horizon ===");
for (const hh of HOR) {
  const top = [], bot = [];
  for (const [, recs] of byDate) {
    const arr = recs.filter((r) => r.fwd[hh] != null).map((r) => [r.tech, r.fwd[hh]]);
    if (arr.length < 30) continue;
    arr.sort((a, b) => a[0] - b[0]); const q = Math.floor(arr.length / 10);
    for (let i = 0; i < q; i++) bot.push(arr[i][1]); for (let i = arr.length - q; i < arr.length; i++) top.push(arr[i][1]);
  }
  console.log(`  h=${hh}d:  top decile ${(mean(top) * 100).toFixed(2)}%  -  bottom ${(mean(bot) * 100).toFixed(2)}%  =  spread ${((mean(top) - mean(bot)) * 100).toFixed(2)}%  (n/side ~${top.length})`);
}

console.log("\n=== 5. REGIME SPLIT (h=20d): production GO/WAIT/AVOID directional returns ===");
console.log("(tape per date = sign of the cross-sectional median trailing-20d return)");
const U = { go: [], wait: [], avoid: [], top: [], bot: [] }, D = { go: [], wait: [], avoid: [], top: [], bot: [] };
let upDates = 0, downDates = 0;
for (const [, recs] of byDate) {
  const valid = recs.filter((r) => r.fwd[20] != null); if (valid.length < 30) continue;
  const up = median(valid.map((r) => r.mom20)) > 0; up ? upDates++ : downDates++;
  const G = up ? U : D;
  for (const r of valid) {
    G[r.timingCall.state].push(r.fwd[20]);
    G[r.timingPut.state].push(-r.fwd[20]);
  }
  const arr = valid.map((r) => [r.tech, r.fwd[20]]).sort((a, b) => a[0] - b[0]); const q = Math.floor(arr.length / 10);
  for (let i = 0; i < q; i++) G.bot.push(arr[i][1]); for (let i = arr.length - q; i < arr.length; i++) G.top.push(arr[i][1]);
}
console.log(`  UP   tapes (${upDates} dates): GO ${(mean(U.go) * 100).toFixed(2)}%  WAIT ${(mean(U.wait) * 100).toFixed(2)}%  AVOID ${(mean(U.avoid) * 100).toFixed(2)}%  |  tech decile spread ${((mean(U.top) - mean(U.bot)) * 100).toFixed(2)}%`);
console.log(`  DOWN tapes (${downDates} dates): GO ${(mean(D.go) * 100).toFixed(2)}%  WAIT ${(mean(D.wait) * 100).toFixed(2)}%  AVOID ${(mean(D.avoid) * 100).toFixed(2)}%  |  tech decile spread ${((mean(D.top) - mean(D.bot)) * 100).toFixed(2)}%`);
