// Stock-level check of the macro / cycle / rotation fit on the site's 85 names
// (2008-2026, weekly), using ONLY weights learned from sector ETFs before each
// date (walkforward-gammas.json from run.mjs), then a check against this
// year's real Top Picks grades (Jun 24 - Nov 6 2026) with and without the fit.
// Research only. The 85 names are today's survivors, so absolute returns are
// biased up; the test ranks names against each other on each date, which
// limits (does not remove) that bias.
//
//   node research/macro-backtest/stocks.mjs --data <dir> --out <dir> --grades <real-daily-grades.txt>
import fs from "node:fs";
import * as MC from "../../lib/macro-context.mjs";
import * as B from "../../scripts/build.mjs";
import { loadLongHistory, ETF_KIND, factorLevelSeries, measuredAt, mean, sd, spearman, nwT, r2, r3 } from "./common.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg("data", null);
const OUT = arg("out", null);
if (!DATA || !OUT) throw new Error("--data <long-history dir> and --out <results dir> are required");
const GRADES = arg("grades", ""); // optional: a private daily-grades text file ("DATE SYM:grade ..."); the 2026 section is skipped without it
const STEP = 5, HS = [5, 10, 20], TOPN = 10;

const H = loadLongHistory(DATA);
const { R, CAL, aligned } = H;
const FL = factorLevelSeries(H);
const F = MC.FACTORS;
const FEATS = [...F.map((f) => "L_" + f), ...F.map((f) => "T_" + f), ...F.map((f) => "S_" + f), "rot", "rot5", "party"];
const fIdx = Object.fromEntries(FEATS.map((f, i) => [f, i]));
const ETF_SET = new Set(["SPY", "QQQ", "IWM", "SMH", "UVXY", "TLT", "USO", "GLD", "SLV", "KWEB", "EWY", "DRAM", "SPCX"]);
const STOCKS = B.TICKERS.filter((s) => !ETF_SET.has(s) && aligned[s]);
const kindOf = (s) => (MC.CARD_LENDER_SYMS.has(s) ? "cardLender" : B.macroKindOf(s, {}));
const ETFU = Object.keys(ETF_KIND);
const gammaLog = JSON.parse(fs.readFileSync(OUT + "/walkforward-gammas.json"));
const etfRes = JSON.parse(fs.readFileSync(OUT + "/etf-results.json"));
const chosen = etfRes.simple.chosen;
const gammaAt = (h, date) => { const L = gammaLog[h] || []; let g = null; for (const x of L) { if (x.date <= date) g = x; else break; } return g; };

// party tilt per party-tracker ETF, point in time
const partyByDay = CAL.map((d) => MC.partyOnDate(d));
const partyCum = {};
for (const e of new Set(Object.values(MC.KIND_PARTY_ETF).filter(Boolean))) {
  if (!aligned[e]) continue;
  const z = {}; for (const o of ["president", "house", "senate"]) z[o] = { D: [new Float64Array(CAL.length), new Int32Array(CAL.length)], R: [new Float64Array(CAL.length), new Int32Array(CAL.length)] };
  const c = aligned[e], m = aligned.SPY;
  for (let i = 0; i < CAL.length; i++) {
    for (const o of Object.keys(z)) for (const p of ["D", "R"]) { z[o][p][0][i] = i ? z[o][p][0][i - 1] : 0; z[o][p][1][i] = i ? z[o][p][1][i - 1] : 0; }
    if (i && c[i] > 0 && c[i - 1] > 0) { const x = Math.log(c[i] / c[i - 1]) - Math.log(m[i] / m[i - 1]); for (const o of Object.keys(z)) { const p = partyByDay[i][o]; if (z[o][p]) { z[o][p][0][i] += x; z[o][p][1][i] += 1; } } }
  }
  partyCum[e] = z;
}
const partyTilt = (e, i) => { const z = partyCum[e]; if (!z || e === "SPY") return 0; let a = 0, w = 0; for (const [o, wt] of [["president", 0.5], ["house", 0.25], ["senate", 0.25]]) { const q = z[o][partyByDay[i][o]]; if (!q || q[1][i] < 252) continue; a += wt * (q[0][i] / q[1][i]) * 252 * 100; w += wt; } return w ? a / w : 0; };

// factor state at a calendar index (breadth across the ETF universe, as in run.mjs)
const stateCache = new Map();
function stateAt(i) {
  if (stateCache.has(i)) return stateCache.get(i);
  const date = CAL[i];
  const avail = ETFU.filter((e) => aligned[e][i] > 0 && aligned[e][i - 199] > 0);
  const above = avail.filter((e) => aligned[e][i] > mean(aligned[e].slice(i - 199, i + 1)));
  const live = { breadthPct200: avail.length ? (above.length / avail.length) * 100 : null };
  const f = MC.computeFactors(R, date, live);
  const cycles = MC.classifyCycles(f, R, date, live);
  const st = { f, cycles, date };
  stateCache.set(i, st);
  return st;
}

function rowsAt(i) {
  const st = stateAt(i), p13 = stateAt(i - 65), p4 = stateAt(i - 20);
  const avail = STOCKS.filter((s) => aligned[s][i] > 0 && aligned[s][i - 260] > 0);
  // rotation map over macro-kind groups of the stocks themselves
  const groups = {};
  for (const s of avail) { const k = kindOf(s); (groups[k] ||= { members: [], closesBySym: {} }).members.push(s); groups[k].closesBySym[s] = aligned[s].slice(i - 130, i + 1); }
  const map = MC.buildRotationMap(groups);
  const rel5 = Object.fromEntries(map.groups.map((g) => [g.name, g.r5Pct != null ? g.r5Pct - map.base.r5Pct : null]));
  const rows = avail.map((s) => {
    const kind = kindOf(s);
    const meas = measuredAt(aligned[s], aligned.SPY, FL, i);
    const ex = MC.exposuresFor(kind, meas, 0.5);
    const x = new Array(FEATS.length).fill(0);
    for (const fk of F) {
      const sc = st.f[fk]?.score, e = ex[fk] ?? 0;
      x[fIdx["L_" + fk]] = Number.isFinite(sc) ? e * sc : 0;
      const a = p13.f[fk]?.score, b = p4.f[fk]?.score;
      x[fIdx["T_" + fk]] = Number.isFinite(sc) && Number.isFinite(a) ? e * (sc - a) : 0;
      x[fIdx["S_" + fk]] = Number.isFinite(sc) && Number.isFinite(b) ? e * (sc - b) : 0;
    }
    x[fIdx.rot] = Number.isFinite(map.flowByGroup[kind]) ? map.flowByGroup[kind] : 0;
    x[fIdx.rot5] = Number.isFinite(rel5[kind]) ? rel5[kind] / 3 : 0;
    x[fIdx.party] = partyTilt(MC.KIND_PARTY_ETF[kind] || "SPY", i) / 10;
    return { s, kind, ex, x };
  });
  rows.envKey = st.cycles.bucket.key;
  return { st, rows, map };
}
const dot = (g, x) => g.reduce((a, v, j) => a + v * x[j], 0);
function predsFor(rows, date) {
  const out = { prior: rows.map((r) => F.reduce((a, fk) => a + r.x[fIdx["L_" + fk]], 0)) };
  for (const h of HS) { const g = gammaAt(h, date)?.g; if (g) out["learned" + h] = rows.map((r) => dot(g, r.x)); }
  // environment-specific weights (current cycle bucket), shrunk toward the global set
  { const gl = gammaAt(10, date); const key = rows.envKey; const b = gl?.env?.[key];
    if (gl?.g) { const lam = 52, n = b?.n || 0; const g = gl.g.map((v, j) => (n * (b?.g ? b.g[j] : v) + lam * v) / (n + lam)); out.env10 = rows.map((r) => dot(g, r.x)); } }
  const p = new Array(rows.length).fill(0);
  for (const c of chosen) { const j = fIdx[c.f]; const xs = rows.map((r) => r.x[j]); const mu = mean(xs), sv = sd(xs) || 0; if (sv < 1e-9) continue; rows.forEach((r, q) => (p[q] += c.w * (r.x[j] - mu) / sv)); }
  out.simple = p;
  return out;
}

// ---- weekly cross-sectional test ----
const start = CAL.findIndex((d) => d >= "2008-01-02");
const recs = [];
const axp = [];
for (let i = start; i < CAL.length; i += STEP) {
  const { st, rows } = rowsAt(i);
  if (rows.length < 25) continue;
  const P = predsFor(rows, CAL[i]);
  const ys = {}, yraw = {};
  for (const h of HS) {
    if (i + h >= CAL.length) continue;
    const raw = rows.map((r) => (aligned[r.s][i + h] > 0 ? (aligned[r.s][i + h] / aligned[r.s][i] - 1) * 100 : null));
    const mu = mean(raw.filter((x) => x != null)); ys[h] = raw.map((x) => (x == null ? null : x - mu)); yraw[h] = raw;
  }
  recs.push({ i, date: CAL[i], st, rows: rows.map((r) => ({ s: r.s, kind: r.kind })), P, ys, yraw });
  const ai = rows.findIndex((r) => r.s === "AXP");
  if (ai >= 0) axp.push({ date: CAL[i], learned10: r2(P.learned10?.[ai]), simple: r2(P.simple[ai]), prior: r2(P.prior[ai]), rankLearned10: P.learned10 ? r2(rankPct(P.learned10, ai)) : null, fwd20Rel: ys[20]?.[ai] != null ? r2(ys[20][ai]) : null, cycles: st.cycles.bucket.key });
}
function rankPct(arr, j) { let b = 0; for (const v of arr) if (v < arr[j]) b++; return b / (arr.length - 1); }
console.error(`stock weeks ${recs.length}`);

const states = JSON.parse(fs.readFileSync(OUT + "/states.json"));
const stateOn = (d) => { let lo = 0, hi = states.length - 1, r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (states[m].date <= d) { r = states[m]; lo = m + 1; } else hi = m - 1; } return r; };
const EPISODES = [
  ["2008 financial crisis", "2007-10-09", "2009-03-09"], ["2011 downgrade / euro", "2011-07-22", "2011-10-03"], ["2015-16 oil and China", "2015-08-10", "2016-02-11"],
  ["2018 Q4 Fed sell-off", "2018-10-03", "2018-12-24"], ["2020 Covid crash", "2020-02-19", "2020-03-23"], ["2020 Covid rebound", "2020-03-24", "2020-08-31"],
  ["2022 hikes bear market", "2022-01-03", "2022-10-12"], ["2023 bank failures", "2023-03-08", "2023-05-04"], ["2025 tariff shock", "2025-02-19", "2025-04-08"], ["2026 so far", "2026-01-02", "2026-12-31"],
];
const RATE_CYCLES = [
  ["Cuts 2007-08", "2007-09-18", "2008-12-16"], ["Zero rates 2009-15", "2008-12-17", "2015-12-15"], ["Hikes 2015-18", "2015-12-16", "2018-12-19"],
  ["Cuts 2019-20", "2019-07-31", "2020-03-15"], ["Zero rates 2020-22", "2020-03-16", "2022-03-15"], ["Hikes 2022-23", "2022-03-16", "2023-07-26"],
  ["Hold at the top 2023-24", "2023-07-27", "2024-09-17"], ["Cuts 2024-25", "2024-09-18", "2025-12-31"], ["2026", "2026-01-01", "2026-12-31"],
];
const dims = {
  All: () => "all",
  "Stress check": (r) => stateOn(r.date)?.systemic || null,
  "Rate cycle": (r) => RATE_CYCLES.find(([, a, b]) => r.date >= a && r.date <= b)?.[0] || null,
  Episode: (r) => EPISODES.find(([, a, b]) => r.date >= a && r.date <= b)?.[0] || null,
  Inflation: (r) => r.st.cycles.inflation,
  Liquidity: (r) => r.st.cycles.liquidity,
  "Congress and White House": (r) => r.st.cycles.politics.alignment,
  Half: (r) => (r.date < "2018-01-01" ? "2008-2017" : "2018-2026"),
  "Fed policy (cycle read)": (r) => r.st.cycles.bucket.policy,
  "Credit cycle": (r) => r.st.cycles.credit,
  "Market cycle": (r) => r.st.cycles.market,
  "Growth / inflation": (r) => r.st.cycles.quadrant,
  President: (r) => r.st.cycles.politics.president,
  Year: (r) => r.date.slice(0, 4),
};
const res = { built: new Date().toISOString(), universe: STOCKS.length, weeks: recs.length, start: recs[0].date, end: recs[recs.length - 1].date, models: {}, byKind: {}, axp: axp.slice(-60) };
for (const m of ["prior", "learned5", "learned10", "learned20", "simple", "env10"]) {
  res.models[m] = {};
  for (const h of HS) {
    const out = {};
    for (const [dn, fn] of Object.entries(dims)) {
      const g = {};
      for (const r of recs) {
        const p = r.P[m]; const y = r.ys[h]; if (!p || !y) continue;
        const ok = p.map((_, q) => q).filter((q) => y[q] != null);
        const ic = spearman(ok.map((q) => p[q]), ok.map((q) => y[q])); if (!Number.isFinite(ic)) continue;
        const key = fn(r); if (key == null) continue;
        const ord = ok.slice().sort((a, b) => p[b] - p[a]);
        const spread = mean(ord.slice(0, TOPN).map((q) => y[q])) - mean(ord.slice(-TOPN).map((q) => y[q]));
        (g[key] ||= []).push({ ic, spread });
      }
      out[dn] = Object.fromEntries(Object.entries(g).map(([k, xs]) => [k, { n: xs.length, ic: r3(mean(xs.map((x) => x.ic))), t: r2(nwT(xs.map((x) => x.ic), Math.ceil(h / STEP))), spreadPct: r2(mean(xs.map((x) => x.spread))), hit: r2(xs.filter((x) => x.spread > 0).length / xs.length) }]));
    }
    res.models[m][h] = out;
  }
}
// within financials: does it rank banks / card lenders / payments / brokers correctly against each other?
{
  const fin = new Set(["banks", "cardLender", "payments", "brokers"]);
  for (const m of ["prior", "learned10", "simple"]) {
    const xs = [];
    for (const r of recs) {
      const p = r.P[m], y = r.ys[10]; if (!p || !y) continue;
      const q = r.rows.map((x, j) => j).filter((j) => fin.has(r.rows[j].kind) && y[j] != null);
      if (q.length < 6) continue;
      const ic = spearman(q.map((j) => p[j]), q.map((j) => y[j])); if (Number.isFinite(ic)) xs.push(ic);
    }
    res.byKind[m] = { financialsOnly10d: { n: xs.length, ic: r3(mean(xs)), t: r2(nwT(xs, 2)) } };
  }
}

// ---- points scale: stock predictions before 2026, for converting to grade points ----
const allP = []; for (const r of recs) if (r.date < "2026-01-01" && r.P.learned10) for (const v of r.P.learned10) allP.push(Math.abs(v));
allP.sort((a, b) => a - b);
const p90 = allP[Math.floor(allP.length * 0.9)];
const SCALE = p90 / 1.5; // the 90th-percentile fit becomes 1.5 points (the cap)
res.pointsScale = { learned10AbsP90: r3(p90), scalePerPoint: r3(SCALE) };

// ---- the engine's price-half grade, 2008-2026, with and without the macro points ----
const ENG_FILE = OUT + "/engine-price-half.json";
if (fs.existsSync(ENG_FILE)) {
  const E = JSON.parse(fs.readFileSync(ENG_FILE)).days;
  const clampP = (x) => Math.max(-1.5, Math.min(1.5, x));
  const rules = {
    grade: { v: (g) => g },
    gradePlusMacro: { v: (g, p) => g + p },
    macroVeto: { v: (g) => g, drop: (g, p) => (g > 0 && p <= -0.75) || (g < 0 && p >= 0.75) },
    macroVeto50: { v: (g) => g, drop: (g, p) => (g > 0 && p <= -0.5) || (g < 0 && p >= 0.5) },
    gradePlusMacroVeto: { v: (g, p) => g + p, drop: (g, p) => (g > 0 && p <= -0.75) || (g < 0 && p >= 0.75) },
    gradePlusMacroVeto50: { v: (g, p) => g + p, drop: (g, p) => (g > 0 && p <= -0.5) || (g < 0 && p >= 0.5) },
    gradePlusMacroNoSystemicCalls: { v: (g, p) => g + p, drop: (g, p, r) => g + p > 0 && stateOn(r.date)?.systemic === "systemic" },
    gradeNoSystemicCalls: { v: (g) => g, drop: (g, p, r) => g > 0 && stateOn(r.date)?.systemic === "systemic" },
  };
  const perRule = {};
  for (const [rn, rule] of Object.entries(rules)) {
    const picks = [], ics = { 10: [], 20: [] };
    for (const r of recs) {
      const day = E[r.date]; if (!day || !r.P.learned10) continue;
      const items = r.rows.map((x, q) => ({ s: x.s, g: day[x.s], p: clampP(r.P.learned10[q] / SCALE), q })).filter((x) => Number.isFinite(x.g));
      for (const h of [10, 20]) {
        const ok = items.filter((x) => r.yraw[h]?.[x.q] != null); if (ok.length < 20) continue;
        const ic = spearman(ok.map((x) => rule.v(x.g, x.p, r)), ok.map((x) => r.yraw[h][x.q])); if (Number.isFinite(ic)) ics[h].push({ r, ic });
      }
      const cands = items.filter((x) => Math.abs(rule.v(x.g, x.p, r)) >= 4 && !(rule.drop && rule.drop(x.g, x.p, r)))
        .sort((a, b) => Math.abs(rule.v(b.g, b.p, r)) - Math.abs(rule.v(a.g, a.p, r))).slice(0, 6);
      for (const c of cands) {
        const side = Math.sign(rule.v(c.g, c.p, r)); const f10 = r.yraw[10]?.[c.q], f20 = r.yraw[20]?.[c.q];
        if (f10 == null) continue;
        picks.push({ r, side, m10: side * f10, m20: f20 != null ? side * f20 : null });
      }
    }
    const byDim = {};
    for (const [dn, fn] of Object.entries(dims)) {
      const g = {};
      for (const pk of picks) { const k = fn(pk.r); if (k == null) continue; (g[k] ||= []).push(pk); }
      const gi = {}; for (const x of ics[10]) { const k = fn(x.r); if (k == null) continue; (gi[k] ||= []).push(x.ic); }
      byDim[dn] = Object.fromEntries(Object.entries(g).map(([k, xs]) => [k, {
        picks: xs.length, calls: xs.filter((x) => x.side > 0).length, puts: xs.filter((x) => x.side < 0).length,
        avgMove10Pct: r2(mean(xs.map((x) => x.m10))), rightWay10: r2(xs.filter((x) => x.m10 > 0).length / xs.length),
        avgMove20Pct: r2(mean(xs.filter((x) => x.m20 != null).map((x) => x.m20))),
        callsMove10Pct: r2(mean(xs.filter((x) => x.side > 0).map((x) => x.m10))), putsMove10Pct: r2(mean(xs.filter((x) => x.side < 0).map((x) => x.m10))),
        ic10: r3(mean(gi[k] || [])),
      }]));
    }
    perRule[rn] = byDim;
  }
  res.engine = { note: "price-half grade only (no fundamentals/news/flow), top 6 by |grade| among |grade|>=4 every 5th session; move = stock move in the trade's direction, not option P&L", rules: perRule };
}

// ---- 2026: real grades with and without the macro points ----
{
  const txt = fs.existsSync(GRADES) ? fs.readFileSync(GRADES, "utf8") : "";
  const days = txt.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [d, ...rest] = l.split(/\s+/); return { d, g: Object.fromEntries(rest.map((x) => { const [s, v] = x.split(":"); return [s, +v]; })) }; });
  const calIdx = new Map(CAL.map((d, i) => [d, i]));
  const recs26 = [];
  for (const day of days) {
    const i = calIdx.get(day.d); if (i == null) continue;
    const { rows } = rowsAt(i);
    const P = predsFor(rows, day.d);
    const pts = Object.fromEntries(rows.map((r, q) => [r.s, P.learned10 ? Math.max(-1.5, Math.min(1.5, P.learned10[q] / SCALE)) : 0]));
    const simplePts = (() => { const v = P.simple; const s0 = sd(v) || 1; return Object.fromEntries(rows.map((r, q) => [r.s, Math.max(-1.5, Math.min(1.5, (v[q] / s0) * 0.5))])); })();
    const names = Object.keys(day.g).filter((s) => !ETF_SET.has(s) && aligned[s]?.[i] > 0 && pts[s] != null);
    const fwd = {}; for (const h of HS) fwd[h] = Object.fromEntries(names.map((s) => [s, i + h < CAL.length && aligned[s][i + h] > 0 ? (aligned[s][i + h] / aligned[s][i] - 1) * 100 : null]));
    recs26.push({ d: day.d, names, g: day.g, pts, simplePts, fwd });
  }
  const variants = { grade: (r, s) => r.g[s], gradePlusMacro: (r, s) => r.g[s] + r.pts[s], gradePlusSimple: (r, s) => r.g[s] + r.simplePts[s], macroOnly: (r, s) => r.pts[s], gradeVeto50: (r, s) => r.g[s] };
  const blocked50 = (r, s) => (r.g[s] > 0 && r.pts[s] <= -0.5) || (r.g[s] < 0 && r.pts[s] >= 0.5);
  const out = {};
  for (const [vn, fn] of Object.entries(variants)) {
    out[vn] = {};
    for (const h of HS) {
      const ics = [], trade = [];
      for (const r of recs26) {
        const ok = r.names.filter((s) => r.fwd[h][s] != null); if (ok.length < 15) continue;
        const ic = spearman(ok.map((s) => fn(r, s)), ok.map((s) => r.fwd[h][s])); if (Number.isFinite(ic)) ics.push(ic);
        // trade-like: names that clear the actionable bar of 4 on this variant
        for (const s of ok) { const v = fn(r, s); if (vn === "gradeVeto50" && blocked50(r, s)) continue; if (vn !== "macroOnly" && Math.abs(v) >= 4) trade.push(Math.sign(v) * r.fwd[h][s]); }
      }
      out[vn][h] = { days: ics.length, ic: r3(mean(ics)), t: r2(nwT(ics, h)), trades: trade.length, avgSignedMovePct: r2(mean(trade)), rightWay: r2(trade.filter((x) => x > 0).length / Math.max(1, trade.length)) };
    }
  }
  // how often the macro points would move a name across the bar of 4, and AXP on each day
  let crossIn = 0, crossOut = 0, flips = 0, n = 0;
  for (const r of recs26) for (const s of r.names) { const a = r.g[s], b = a + r.pts[s]; n++; if (Math.abs(a) < 4 && Math.abs(b) >= 4) crossIn++; if (Math.abs(a) >= 4 && Math.abs(b) < 4) crossOut++; if (Math.sign(a) !== Math.sign(b) && a !== 0) flips++; }
  res.grades2026 = { days: recs26.length, from: recs26[0]?.d, to: recs26[recs26.length - 1]?.d, variants: out, barMoves: { nameDays: n, crossIntoActionable: crossIn, crossOutOfActionable: crossOut, sideFlips: flips }, axp: recs26.filter((r) => r.g.AXP != null).map((r) => ({ d: r.d, grade: r.g.AXP, macroPts: r2(r.pts.AXP), simplePts: r2(r.simplePts.AXP), fwd10: r2(r.fwd[10].AXP) })) };
}
// latest read for each name (the most recent sample)
{
  const i = CAL.length - 1; const { st, rows, map } = rowsAt(i); const P = predsFor(rows, CAL[i]);
  res.latest = { date: CAL[i], cycles: st.cycles, rotationByKind: map.groups.sort((a, b) => (b.flow ?? 0) - (a.flow ?? 0)).map((g) => ({ kind: g.name, n: g.n, flow: g.flow, r20Pct: g.r20Pct, rel60Pct: g.rel60Pct })), names: rows.map((r, q) => ({ s: r.s, kind: r.kind, points: r2(P.learned10 ? Math.max(-1.5, Math.min(1.5, P.learned10[q] / SCALE)) : null), exposures: Object.fromEntries(Object.entries(r.ex).map(([k, v]) => [k, r2(v)])) })).sort((a, b) => (b.points ?? 0) - (a.points ?? 0)) };
}
fs.writeFileSync(OUT + "/stock-results.json", JSON.stringify(res, null, 1));
console.log("done", OUT);
