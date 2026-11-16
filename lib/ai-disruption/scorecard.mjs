// lib/ai-disruption/scorecard.mjs — Phase 3 of the AI disruption tracker:
// the Owner scorecard. Pure functions; the bake hands in daily closes it
// already fetched (the Event spillover sweep: every covered stock plus IGV,
// about ten years) and the earnings store, and the result rides in the
// Owner-only ai-disruption-owner.json. It tests a stock, so nothing here may
// be written to a public file or committed (owner rule, 2026-11-15).
//
// Two questions, stated before the data was looked at:
//  1. Do the covered stocks a launch targets move against the software ETF
//     (IGV) around the launch, by more than they do on ordinary days? Each
//     launch-and-stock pair is compared with the same stock on placebo dates
//     drawn from its own history away from any launch (seeded, so the same
//     data gives the same answer), over three windows: the launch day and the
//     next, five days, and the five days before (a clean "before" window is
//     what separates a reaction from a trend already under way).
//  2. Does launch pressure predict a company's next results? Pressure is the
//     capture score of the launches aimed at it in the 90 days before a
//     report, weighted by how central the capability is to what it sells. It
//     is ranked against the EPS surprise, the next-day reaction and the
//     change in revenue growth at that report, each measured against the
//     company's own usual so a big or small company does not drive it.
//
// Every test reports how many cases it rests on; below the floor it says
// "collecting". p values from the placebo or shuffle draws are adjusted for
// the number of tests (Benjamini-Hochberg). Nothing here feeds a pick, a
// grade or a gate; Phase 4 (a Top Picks input) waits for `phase4` to pass and
// the Owner's OK.

export const SCORECARD_VERSION = 1;
export const SCORECARD_BENCHMARK = "IGV";
export const WINDOWS = Object.freeze([
  { id: "d2", label: "Launch day and the next", from: -1, to: 1 },
  { id: "d5", label: "Five days after", from: -1, to: 5 },
  { id: "pre", label: "Five days before", from: -6, to: -1 },
]);
const PATH_FROM = -5, PATH_TO = 10;
const MERGE_DAYS = 3;          // same stock, launches this close count once
const PLACEBO_GAP = 10;        // trading days kept clear of any launch
const PLACEBO_DRAWS = 2000;
const MIN_EVENTS = 15;         // below this a group is "collecting"
const MIN_REPORTS = 60;        // results test floor
const Q_BAR = 0.10;
const PRESSURE_DAYS = 91;
export const ROLE_WEIGHT = Object.freeze({ core: 1, addon: 0.6, adjacent: 0.3 });
const OUTCOMES = ["obsolescence", "business-model", "commoditization", "watch"];

function rng(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quant = (s, p) => s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e3) / 1e3);
const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

function prep(series) {
  if (!series || !Array.isArray(series.rows)) return null;
  if (series.idx instanceof Map) return series;
  const idx = new Map();
  series.rows.forEach((r, i) => idx.set(r.t, i));
  return { rows: series.rows, idx };
}
// First row on or after the date (launch posts on a weekend land on Monday).
function dayIndex(s, iso) {
  const rows = s.rows;
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].t < iso) lo = mid + 1; else hi = mid; }
  return lo < rows.length ? lo : -1;
}
// Stock return minus IGV return between two of the stock's rows; the
// benchmark is read on the same dates, so a missing benchmark day drops it.
function excess(s, b, i0, i1) {
  if (i0 < 0 || i1 >= s.rows.length || i1 < 0 || i0 >= s.rows.length) return null;
  const d0 = s.rows[i0].t, d1 = s.rows[i1].t;
  const j0 = b.idx.get(d0), j1 = b.idx.get(d1);
  if (j0 == null || j1 == null) return null;
  const sr = s.rows[i1].c / s.rows[i0].c - 1, br = b.rows[j1].c / b.rows[j0].c - 1;
  return Number.isFinite(sr) && Number.isFinite(br) ? sr - br : null;
}
function windowsAt(s, b, i) {
  const out = {};
  for (const w of WINDOWS) {
    const x = excess(s, b, i + w.from, i + w.to);
    if (x == null) return null;
    out[w.id] = x;
  }
  return out;
}
function pathAt(s, b, i) {
  const out = [];
  for (let o = PATH_FROM; o <= PATH_TO; o += 1) out.push(o === -1 ? 0 : excess(s, b, i - 1, i + o));
  return out.some((v) => v == null) ? null : out;
}

// Benjamini-Hochberg q values, in the input order.
export function bhQ(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => p != null).sort((a, b) => a[0] - b[0]);
  const q = ps.map(() => null);
  let prev = 1;
  for (let k = idx.length - 1; k >= 0; k -= 1) {
    const v = Math.min(prev, (idx[k][0] * idx.length) / (k + 1));
    q[idx[k][1]] = v;
    prev = v;
  }
  return q;
}
function ranks(a) {
  const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = Array(a.length);
  for (let k = 0; k < o.length;) {
    let j = k;
    while (j + 1 < o.length && o[j + 1][0] === o[k][0]) j += 1;
    const avg = (k + j) / 2 + 1;
    for (let m = k; m <= j; m += 1) r[o[m][1]] = avg;
    k = j + 1;
  }
  return r;
}
export function spearman(x, y) {
  if (x.length < 3) return null;
  const rx = ranks(x), ry = ranks(y);
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i += 1) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}
const twoSided = (draws, actual) => {
  let le = 0, ge = 0;
  for (const d of draws) { if (d <= actual) le += 1; if (d >= actual) ge += 1; }
  return Math.min(1, (2 * (Math.min(le, ge) + 1)) / (draws.length + 1));
};

// ---- 1. Launch moves against IGV ------------------------------------------------
export function launchEvents({ launches, series, benchmark = SCORECARD_BENCHMARK, asOf = null }) {
  const b = prep(series?.[benchmark]);
  if (!b || !b.rows.length) return { events: [], pools: {}, b: null };
  const end = asOf || b.rows[b.rows.length - 1].t;
  const byStock = new Map();
  for (const l of launches || []) {
    if (!l?.date || l.date > end) continue;
    for (const t of l.targets || []) {
      if (t.coverage !== "covered" || !series[t.company]) continue;
      if (!byStock.has(t.company)) byStock.set(t.company, []);
      byStock.get(t.company).push({ launch: l, target: t });
    }
  }
  const events = [];
  const pools = {};
  for (const [sym, list] of byStock) {
    const s = prep(series[sym]);
    if (!s || s.rows.length < 40) continue;
    list.sort((x, y) => (x.launch.date < y.launch.date ? -1 : x.launch.date > y.launch.date ? 1 : (y.launch.score || 0) - (x.launch.score || 0)));
    const kept = [];
    for (const it of list) {
      const i = dayIndex(s, it.launch.date);
      if (i < 0) continue;
      const last = kept[kept.length - 1];
      if (last && i - last.i <= MERGE_DAYS) {
        last.ids.push(it.launch.id);
        if ((it.launch.score || 0) > last.score) Object.assign(last, { score: it.launch.score || 0, id: it.launch.id, title: it.launch.title, lab: it.launch.lab, outcome: it.target.outcome, role: it.target.role });
        continue;
      }
      kept.push({ i, sym, date: s.rows[i].t, id: it.launch.id, ids: [it.launch.id], title: it.launch.title, lab: it.launch.lab, score: it.launch.score || 0, outcome: it.target.outcome, role: it.target.role });
    }
    const evIdx = [];
    for (const e of kept) {
      const w = windowsAt(s, b, e.i);
      if (!w) continue;
      evIdx.push(e.i);
      events.push({ ...e, x: w, path: pathAt(s, b, e.i) });
    }
    if (!evIdx.length) continue;
    // Placebo pool: the stock's own days from a year before its first launch
    // to the last bar, kept clear of every launch aimed at it.
    const start = dayIndex(s, addDays(kept[0].date, -365));
    const pool = { d2: [], d5: [], pre: [], path: [] };
    const allIdx = kept.map((e) => e.i);
    for (let i = Math.max(start, 7); i < s.rows.length - PATH_TO; i += 1) {
      if (allIdx.some((k) => Math.abs(k - i) <= PLACEBO_GAP)) continue;
      const w = windowsAt(s, b, i);
      if (!w) continue;
      pool.d2.push(w.d2); pool.d5.push(w.d5); pool.pre.push(w.pre);
      pool.path.push(pathAt(s, b, i));
    }
    if (pool.d2.length >= 30) pools[sym] = pool;
  }
  return { events: events.filter((e) => pools[e.sym]), pools, b };
}

function placeboMeans(evs, pools, win, seed, draws = PLACEBO_DRAWS) {
  const rand = rng(seed);
  const out = new Array(draws);
  for (let k = 0; k < draws; k += 1) {
    let sum = 0;
    for (const e of evs) { const p = pools[e.sym][win]; sum += p[Math.floor(rand() * p.length)]; }
    out[k] = sum / evs.length;
  }
  return out;
}
function groupTest(id, label, evs, pools) {
  const row = { id, label, n: evs.length, stocks: new Set(evs.map((e) => e.sym)).size, windows: {} };
  for (const w of WINDOWS) {
    const xs = evs.map((e) => e.x[w.id]);
    const cell = { mean: r4(mean(xs)), median: r4(median(xs)), down: xs.length ? r3(xs.filter((x) => x < 0).length / xs.length) : null };
    if (evs.length >= 2) {
      const draws = placeboMeans(evs, pools, w.id, `${id}|${w.id}`).sort((a, b) => a - b);
      cell.placebo = { mean: r4(mean(draws)), lo: r4(quant(draws, 0.05)), hi: r4(quant(draws, 0.95)) };
      cell.p = r4(twoSided(draws, mean(xs)));
    }
    row.windows[w.id] = cell;
  }
  return row;
}
function verdictFor(cell, n) {
  if (n < MIN_EVENTS || cell.q == null) return "collecting";
  if (cell.q <= Q_BAR) return cell.mean < 0 ? "falls" : "rises";
  return "no-effect";
}

export function launchMoveTests({ launches, series, benchmark = SCORECARD_BENCHMARK, asOf = null }) {
  const { events, pools, b } = launchEvents({ launches, series, benchmark, asOf });
  if (!b) return null;
  const groups = [["all", "Every launch", events]];
  for (const o of OUTCOMES) groups.push([`outcome:${o}`, o, events.filter((e) => e.outcome === o)]);
  // Role is not tested on its own: each outcome already follows from it
  // (core splits into obsolescence and business-model, add-on is
  // commoditization, adjacent is watch), so it would only add tests.
  groups.push(["score:high", "Score 75 or more", events.filter((e) => e.score >= 75)]);
  groups.push(["score:low", "Score under 75", events.filter((e) => e.score < 75)]);
  const rows = groups.filter(([, , evs]) => evs.length).map(([id, label, evs]) => groupTest(id, label, evs, pools));
  // One correction across every group and window.
  const cells = [];
  for (const r of rows) for (const w of WINDOWS) cells.push([r, w.id]);
  const qs = bhQ(cells.map(([r, w]) => r.windows[w].p ?? null));
  cells.forEach(([r, w], k) => { r.windows[w].q = qs[k] == null ? null : r4(qs[k]); r.windows[w].verdict = verdictFor(r.windows[w], r.n); });

  // Does a higher score go with a bigger move? Rank match across events.
  let scoreLink = null;
  if (events.length >= 3) {
    const sc = events.map((e) => e.score), x5 = events.map((e) => e.x.d5);
    const rho = spearman(sc, x5);
    const rand = rng("score-link");
    const draws = [];
    for (let k = 0; k < PLACEBO_DRAWS; k += 1) {
      const sh = [...sc];
      for (let i = sh.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
      draws.push(spearman(sh, x5) ?? 0);
    }
    scoreLink = { n: events.length, rho: r3(rho), p: rho == null ? null : r4(twoSided(draws, rho)), verdict: events.length < MIN_EVENTS || rho == null ? "collecting" : twoSided(draws, rho) <= 0.05 ? (rho < 0 ? "higher-falls-more" : "higher-rises-more") : "no-link" };
  }

  // Both halves of the history, split at the middle event date.
  let halves = null;
  if (events.length >= 2 * 8) {
    const sorted = [...events].sort((a, b) => (a.date < b.date ? -1 : 1));
    const mid = sorted.length >> 1;
    halves = [sorted.slice(0, mid), sorted.slice(mid)].map((evs, k) => {
      const xs = evs.map((e) => e.x.d5);
      const draws = placeboMeans(evs, pools, "d5", `half${k}`, 1000);
      return { from: evs[0].date, to: evs[evs.length - 1].date, n: evs.length, mean: r4(mean(xs)), p: r4(twoSided(draws, mean(xs))) };
    });
  }

  // Average path from five days before to ten after, with the placebo band.
  let path = null;
  const withPath = events.filter((e) => e.path);
  if (withPath.length >= 2) {
    const len = PATH_TO - PATH_FROM + 1;
    const avg = Array.from({ length: len }, (_, o) => r4(mean(withPath.map((e) => e.path[o]))));
    const rand = rng("path");
    const bandDraws = Array.from({ length: len }, () => []);
    for (let k = 0; k < 400; k += 1) {
      const acc = new Array(len).fill(0);
      for (const e of withPath) {
        const pp = pools[e.sym].path;
        const row = pp[Math.floor(rand() * pp.length)];
        for (let o = 0; o < len; o += 1) acc[o] += row[o];
      }
      for (let o = 0; o < len; o += 1) bandDraws[o].push(acc[o] / withPath.length);
    }
    path = { offsets: Array.from({ length: len }, (_, o) => PATH_FROM + o), mean: avg, lo: bandDraws.map((d) => r4(quant(d.sort((a, b) => a - b), 0.05))), hi: bandDraws.map((d) => r4(quant(d, 0.95))), n: withPath.length };
  }

  // Per stock (Owner-only).
  const bySym = new Map();
  for (const e of events) { if (!bySym.has(e.sym)) bySym.set(e.sym, []); bySym.get(e.sym).push(e); }
  const stocks = [...bySym].map(([sym, evs]) => {
    const worst = evs.reduce((m, e) => (e.x.d5 < m.x.d5 ? e : m), evs[0]);
    return { symbol: sym, n: evs.length, d2: r4(mean(evs.map((e) => e.x.d2))), d5: r4(mean(evs.map((e) => e.x.d5))), pre: r4(mean(evs.map((e) => e.x.pre))), down5: r3(evs.filter((e) => e.x.d5 < 0).length / evs.length), last: evs[evs.length - 1].date, worst: { date: worst.date, title: worst.title, d5: r4(worst.x.d5) } };
  }).sort((a, b) => b.n - a.n || (a.d5 ?? 0) - (b.d5 ?? 0));

  const recent = [...events].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40)
    .map((e) => ({ date: e.date, symbol: e.sym, id: e.id, title: e.title, lab: e.lab, score: e.score, outcome: e.outcome, role: e.role, merged: e.ids.length, d2: r4(e.x.d2), d5: r4(e.x.d5), pre: r4(e.x.pre) }));
  return {
    benchmark, asOf: asOf || b.rows[b.rows.length - 1].t, from: events.length ? events.reduce((m, e) => (e.date < m ? e.date : m), events[0].date) : null,
    events: events.length, stocks: stocks.length, placeboDays: Object.values(pools).reduce((n, p) => n + p.d2.length, 0),
    windows: WINDOWS.map((w) => ({ id: w.id, label: w.label })), groups: rows, scoreLink, halves, path, perStock: stocks, recent,
  };
}

// ---- 2. Launch pressure vs the next results ---------------------------------------
export function pressureAt(launches, sym, reportDate) {
  const from = addDays(reportDate, -PRESSURE_DAYS);
  let p = 0, n = 0;
  for (const l of launches || []) {
    if (!l?.date || l.date < from || l.date >= reportDate) continue;
    const t = (l.targets || []).find((x) => x.company === sym);
    if (!t) continue;
    p += ((l.score || 0) / 100) * (ROLE_WEIGHT[t.role] ?? 0.3);
    n += 1;
  }
  return { pressure: Math.round(p * 1000) / 1000, launches: n };
}
const METRICS = [
  { id: "eps", label: "EPS surprise", pick: (e) => (typeof e.surprisePct === "number" && Number.isFinite(e.surprisePct) ? e.surprisePct : null) },
  { id: "reaction", label: "Next-day reaction", pick: (e) => (typeof e.movePct === "number" && Number.isFinite(e.movePct) ? e.movePct : null) },
  { id: "revenue", label: "Change in revenue growth", pick: (e, list, k) => {
    const g = (j) => {
      const now = list[j], ago = list[j - 4];
      if (!now || !ago || !(now.revenueActual > 0) || !(ago.revenueActual > 0)) return null;
      const gap = (Date.parse(now.date) - Date.parse(ago.date)) / 86400000;
      return gap >= 320 && gap <= 410 ? now.revenueActual / ago.revenueActual - 1 : null;
    };
    const a = g(k), b = g(k - 1);
    return a == null || b == null ? null : a - b;
  } },
];
export function resultsTests({ launches, earnings, companies, asOf }) {
  const firstLaunch = (launches || []).reduce((m, l) => (l?.date && (!m || l.date < m) ? l.date : m), null);
  if (!firstLaunch) return null;
  const start = addDays(firstLaunch, 30);
  const tests = METRICS.map((m) => {
    const rows = [];
    for (const sym of companies) {
      const list = (earnings?.tickers?.[sym]?.events || []).filter((e) => e?.date).sort((a, b) => (a.date < b.date ? -1 : 1));
      list.forEach((e, k) => {
        if (e.date < start || (asOf && e.date > asOf)) return;
        const v = m.pick(e, list, k);
        if (v == null) return;
        rows.push({ sym, date: e.date, v, ...pressureAt(launches, sym, e.date) });
      });
    }
    // Against each company's own usual: subtract its averages first.
    const by = new Map();
    for (const r of rows) { if (!by.has(r.sym)) by.set(r.sym, []); by.get(r.sym).push(r); }
    const used = [];
    for (const list of by.values()) {
      if (list.length < 3) continue;
      const mp = mean(list.map((r) => r.pressure)), mv = mean(list.map((r) => r.v));
      for (const r of list) used.push({ ...r, rp: r.pressure - mp, rv: r.v - mv });
    }
    const pressured = used.filter((r) => r.launches > 0).length;
    const rho = used.length >= 3 ? spearman(used.map((r) => r.rp), used.map((r) => r.rv)) : null;
    let p = null;
    if (rho != null) {
      // Shuffle pressure inside each company, keeping its results in place.
      const rand = rng(`results|${m.id}`);
      const groups = [...new Set(used.map((r) => r.sym))].map((s) => used.map((r, i) => [r, i]).filter(([r]) => r.sym === s).map(([, i]) => i));
      const draws = [];
      for (let k = 0; k < PLACEBO_DRAWS; k += 1) {
        const rp = used.map((r) => r.rp);
        for (const g of groups) {
          const vals = g.map((i) => used[i].rp);
          for (let i = vals.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [vals[i], vals[j]] = [vals[j], vals[i]]; }
          g.forEach((i, j) => { rp[i] = vals[j]; });
        }
        draws.push(spearman(rp, used.map((r) => r.rv)) ?? 0);
      }
      p = twoSided(draws, rho);
    }
    return { id: m.id, label: m.label, n: used.length, companies: new Set(used.map((r) => r.sym)).size, pressured, rho: r3(rho), p: p == null ? null : r4(p) };
  });
  const qs = bhQ(tests.map((t) => t.p));
  tests.forEach((t, k) => {
    t.q = qs[k] == null ? null : r4(qs[k]);
    t.verdict = t.n < MIN_REPORTS || t.pressured < 10 || t.q == null ? "collecting" : t.q <= Q_BAR ? (t.rho < 0 ? "worse-after-pressure" : "better-after-pressure") : "no-link";
  });
  return { from: start, pressureDays: PRESSURE_DAYS, roleWeight: ROLE_WEIGHT, tests };
}

// ---- Whole scorecard + the Phase 4 gate ---------------------------------------------
export function phase4Gate(moves) {
  const reasons = [];
  const all = moves?.groups?.find((g) => g.id === "all");
  if (!all) return { ready: false, reasons: ["No launch could be measured yet."] };
  const d5 = all.windows.d5, pre = all.windows.pre;
  if (all.n < 40) reasons.push(`${all.n} launch-and-stock events; the bar is 40.`);
  if (d5.verdict !== "falls") reasons.push("Targeted stocks do not fall against IGV in the five days after a launch by more than on placebo days (adjusted).");
  if (pre.p != null && pre.p <= Q_BAR) reasons.push("They were already moving in the five days before, so the move may not be the launch.");
  if (!moves.halves || moves.halves.some((h) => !(h.mean < 0))) reasons.push("The five-day move does not point down in both halves of the history.");
  return { ready: reasons.length === 0, reasons };
}

export function buildScorecard({ launches, series, earnings, companies, builtAt = new Date().toISOString(), benchmark = SCORECARD_BENCHMARK } = {}) {
  const moves = launchMoveTests({ launches, series, benchmark });
  if (!moves) return null;
  const covered = companies || [...new Set((launches || []).flatMap((l) => (l.targets || []).filter((t) => t.coverage === "covered").map((t) => t.company)))];
  const results = resultsTests({ launches, earnings, companies: covered, asOf: moves.asOf });
  return { version: SCORECARD_VERSION, builtAt, moves, results, phase4: phase4Gate(moves) };
}
