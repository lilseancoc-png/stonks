// Walk-forward backtest of the macro / cycle / rotation layer (lib/macro-context.mjs)
// on 25 sector and industry ETFs, 2007-2026. Research only.
//
//   node research/macro-backtest/run.mjs --data <long-history dir> --out <dir>
//
// Every sample is a Friday-ish trading day (every 5 sessions). At each one we
// compute the cycle read from data published by that day, each ETF's playbook +
// measured sensitivities, the rotation map and the systemic check, then ask:
// does the macro fit rank the ETFs by their NEXT 20 / 60 trading-day return
// relative to the group? Weights are learned only from samples whose outcome
// was already known on the sample day (expanding window, refit every 4 weeks).
import fs from "node:fs";
import * as MC from "../../lib/macro-context.mjs";
import { loadLongHistory, ETF_KIND, ETF_LABEL, factorLevelSeries, measuredAt, mean, sd, spearman, nwT, ridge, r2, r3, ranks as ranksOf } from "./common.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg("data", null);
const OUT = arg("out", null);
if (!DATA || !OUT) throw new Error("--data <long-history dir> and --out <results dir> are required");
fs.mkdirSync(OUT, { recursive: true });
const START = arg("start", "2007-07-02");
const STEP = 5, HS = [5, 10, 20, 60], MIN_TRAIN = 156, REFIT = 4, TOPN = 5;

const H = loadLongHistory(DATA);
const { R, CAL, aligned } = H;
const ETFS = Object.keys(ETF_KIND);
const FL = factorLevelSeries(H);
const F = MC.FACTORS;
const FEATS = [...F.map((f) => "L_" + f), ...F.map((f) => "T_" + f), ...F.map((f) => "S_" + f), "rot", "rot5", "party"];
const P = FEATS.length;
const fIdx = Object.fromEntries(FEATS.map((f, i) => [f, i]));

// ---- party tilt, point in time: each ETF's excess return vs SPY while each party held each office ----
const partyCum = {}; // etf -> office -> party -> { s: Float64Array, n: Int32Array } prefix over CAL
const OFFICES = ["president", "house", "senate"];
const partyByDay = CAL.map((d) => MC.partyOnDate(d));
for (const e of ETFS) {
  partyCum[e] = {};
  for (const o of OFFICES) partyCum[e][o] = { D: { s: new Float64Array(CAL.length), n: new Int32Array(CAL.length) }, R: { s: new Float64Array(CAL.length), n: new Int32Array(CAL.length) } };
  const c = aligned[e], m = aligned.SPY;
  for (let i = 0; i < CAL.length; i++) {
    for (const o of OFFICES) for (const p of ["D", "R"]) { const z = partyCum[e][o][p]; z.s[i] = i ? z.s[i - 1] : 0; z.n[i] = i ? z.n[i - 1] : 0; }
    if (i && c[i] > 0 && c[i - 1] > 0 && m[i] > 0 && m[i - 1] > 0) {
      const x = Math.log(c[i] / c[i - 1]) - Math.log(m[i] / m[i - 1]);
      for (const o of OFFICES) { const p = partyByDay[i][o]; if (p === "D" || p === "R") { partyCum[e][o][p].s[i] += x; partyCum[e][o][p].n[i] += 1; } }
    }
  }
}
function partyTiltAt(e, i) {
  const pol = partyByDay[i]; let a = 0, w = 0;
  for (const [o, wt] of [["president", 0.5], ["house", 0.25], ["senate", 0.25]]) {
    const z = partyCum[e][o][pol[o]]; if (!z || z.n[i] < 252) continue;
    a += wt * (z.s[i] / z.n[i]) * 252 * 100; w += wt;
  }
  return w ? a / w : null;
}

// ---- sample loop ----
const startIdx = CAL.findIndex((d) => d >= START);
const samples = [];
const corrHist = [];
for (let i = startIdx; i < CAL.length; i += STEP) {
  const date = CAL[i];
  const avail = ETFS.filter((e) => aligned[e][i] > 0 && i >= 130 && aligned[e][i - 130] > 0);
  // breadth across the ETF universe
  const above = avail.filter((e) => { const w = aligned[e].slice(i - 199, i + 1); if (w.some((x) => !(x > 0))) return false; return aligned[e][i] > mean(w); });
  const breadthPct200 = avail.length ? (above.length / avail.length) * 100 : null;
  const live = { breadthPct200 };
  const f = MC.computeFactors(R, date, live);
  const cycles = MC.classifyCycles(f, R, date, live);
  const groups = {};
  for (const e of avail) groups[e] = { members: [e], closesBySym: { [e]: aligned[e].slice(Math.max(0, i - 130), i + 1) } };
  const map = MC.buildRotationMap(groups);
  // average pairwise 20-day correlation of daily returns
  const rets = avail.map((e) => { const c = aligned[e].slice(i - 20, i + 1); const r = []; for (let k = 1; k < c.length; k++) r.push(c[k] / c[k - 1] - 1); return r; });
  let cs = 0, cn = 0;
  for (let a = 0; a < rets.length; a++) for (let b = a + 1; b < rets.length; b++) { const x = pearsonQuick(rets[a], rets[b]); if (x != null) { cs += x; cn++; } }
  const avgCorr = cn ? cs / cn : null;
  const base = corrHist.slice(-52).filter((x) => x != null).sort((a, b) => a - b);
  const avgCorrBase = base.length >= 20 ? base[base.length >> 1] : null;
  corrHist.push(avgCorr);
  const systemic = MC.systemicState({ map, factors: f, avgCorr, avgCorrBase, breadthPct200 });
  const flowBy = map.flowByGroup;
  const rel5By = Object.fromEntries(map.groups.map((g) => [g.name, g.r5Pct != null ? g.r5Pct - map.base.r5Pct : null]));
  const rows = [];
  for (const e of avail) {
    const meas = measuredAt(aligned[e], aligned.SPY, FL, i);
    const ex = MC.exposuresFor(ETF_KIND[e], meas, 0.5);
    rows.push({ e, ex, meas, flow: flowBy[e], rel5: rel5By[e], party: partyTiltAt(e, i) });
  }
  // forward relative returns (vs the equal-weight average of the ETFs alive at i)
  const y = {};
  for (const h of HS) {
    if (i + h >= CAL.length) { y[h] = null; continue; }
    const raw = rows.map((r) => (aligned[r.e][i + h] > 0 ? (aligned[r.e][i + h] / aligned[r.e][i] - 1) * 100 : null));
    const ok = raw.filter((x) => x != null); const mu = mean(ok);
    y[h] = raw.map((x) => (x == null ? null : x - mu));
  }
  const spy = aligned.SPY;
  const mkt = {};
  for (const h of HS) {
    if (i + h >= CAL.length) { mkt[h] = null; continue; }
    let mdd = 0, pk = spy[i]; for (let k = i + 1; k <= i + h; k++) { pk = Math.max(pk, spy[k]); mdd = Math.min(mdd, spy[k] / pk - 1); }
    let low = 0; for (let k = i + 1; k <= i + h; k++) low = Math.min(low, spy[k] / spy[i] - 1);
    mkt[h] = { ret: (spy[i + h] / spy[i] - 1) * 100, low: low * 100, mdd: mdd * 100 };
  }
  samples.push({ k: samples.length, i, date, f, cycles, systemic, map, avgCorr, avgCorrBase, breadthPct200, rows, y, mkt });
}
function pearsonQuick(a, b) { const n = Math.min(a.length, b.length); if (n < 10) return null; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, z = b[i] - mb; c += x * z; va += x * x; vb += z * z; } return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : null; }
console.error(`samples ${samples.length} ${samples[0].date}..${samples[samples.length - 1].date}`);

// ---- forward-looking environment key (what the market is pricing next, not what already happened) ----
for (const s of samples) {
  const fr = s.f.rates?.detail || {};
  const priced = fr.pricedPct;
  const pol = priced == null ? s.cycles.bucket.policy : priced >= 0.25 ? "tightening" : priced <= -0.25 ? "easing" : "hold";
  const prev = samples[s.k - 13];
  const dc = prev && Number.isFinite(s.f.credit?.score) && Number.isFinite(prev.f.credit?.score) ? s.f.credit.score - prev.f.credit.score : null;
  const cr = dc == null ? s.cycles.bucket.credit : dc >= 0.4 ? "tight" : dc <= -0.4 ? "easy" : s.cycles.bucket.credit;
  const dr = prev && Number.isFinite(s.f.risk?.score) && Number.isFinite(prev.f.risk?.score) ? s.f.risk.score - prev.f.risk.score : null;
  const mk = dr == null ? s.cycles.bucket.market : dr >= 0.75 ? "up" : dr <= -0.75 ? "down" : s.cycles.bucket.market;
  s.fwdKey = `${pol}|${cr}|${mk}`;
  s.envKey = s.cycles.bucket.key;
}

// ---- feature matrix ----
for (const s of samples) {
  const prev = samples[s.k - 13], prev4 = samples[s.k - 4];
  for (const r of s.rows) {
    const x = new Array(P).fill(0);
    for (const fk of F) {
      const sc = s.f[fk]?.score; const e = r.ex[fk] ?? 0;
      x[fIdx["L_" + fk]] = Number.isFinite(sc) ? e * sc : 0;
      const ps = prev?.f[fk]?.score, p4 = prev4?.f[fk]?.score;
      x[fIdx["T_" + fk]] = Number.isFinite(sc) && Number.isFinite(ps) ? e * (sc - ps) : 0;
      x[fIdx["S_" + fk]] = Number.isFinite(sc) && Number.isFinite(p4) ? e * (sc - p4) : 0;
    }
    x[fIdx.rot] = Number.isFinite(r.flow) ? r.flow : 0;
    x[fIdx.rot5] = Number.isFinite(r.rel5) ? r.rel5 / 3 : 0;
    x[fIdx.party] = Number.isFinite(r.party) ? r.party / 10 : 0;
    r.x = x;
  }
  // cross-sectional demean of features
  const n = s.rows.length;
  for (let j = 0; j < P; j++) { const mu = s.rows.reduce((a, r) => a + r.x[j], 0) / n; for (const r of s.rows) r.xd = r.xd || new Array(P).fill(0), (r.xd[j] = r.x[j] - mu); }
}
// contributions per sample (X'X, X'y) per horizon, on demeaned data
function contrib(s, h, mask) {
  const A = Array.from({ length: P }, () => new Array(P).fill(0)), b = new Array(P).fill(0);
  if (!s.y[h]) return null;
  const ys = s.y[h]; const ok = s.rows.map((r, j) => (ys[j] != null ? j : -1)).filter((j) => j >= 0);
  if (ok.length < 8) return null;
  // robust target: cross-sectional rank scaled to -1..1, times the day's spread
  // so a calm week and a violent week do not count the same
  const rk = ranksOf(ok.map((j) => ys[j])); const scale = sd(ok.map((j) => ys[j])) || 1;
  const yv = Object.fromEntries(ok.map((j, q) => [j, (rk[q] / (ok.length - 1) - 0.5) * 2 * Math.min(scale, 8)]));
  for (const j of ok) {
    const x = s.rows[j].xd, yy = yv[j];
    for (let a = 0; a < P; a++) { if (mask && !mask[a]) continue; b[a] += x[a] * yy; for (let c = 0; c < P; c++) if (!mask || mask[c]) A[a][c] += x[a] * x[c]; }
  }
  return { A, b };
}
const MASK_L = FEATS.map((f) => f.startsWith("L_"));
for (const s of samples) { s.c = {}; s.cL = {}; for (const h of HS) { s.c[h] = contrib(s, h, null); s.cL[h] = contrib(s, h, MASK_L); } }

function fit(trainSamples, h, useL = false) {
  const A = Array.from({ length: P }, () => new Array(P).fill(0)), b = new Array(P).fill(0);
  let n = 0;
  for (const s of trainSamples) { const c = useL ? s.cL[h] : s.c[h]; if (!c) continue; n++; for (let a = 0; a < P; a++) { b[a] += c.b[a]; for (let k = 0; k < P; k++) A[a][k] += c.A[a][k]; } }
  if (!n) return null;
  if (useL) for (let a = 0; a < P; a++) if (!MASK_L[a]) { A[a] = new Array(P).fill(0); A[a][a] = 1; b[a] = 0; for (let k = 0; k < P; k++) if (k !== a) A[k][a] = 0; }
  const g = ridge(A, b, 0.1);
  return g ? { g, n } : null;
}
function blend(gb, nb, gg, lam) { return gg.map((v, j) => (nb * (gb ? gb[j] : v) + lam * v) / (nb + lam)); }

// ---- walk-forward ----
const VARIANTS = ["prior", "globalL", "global", "env26", "env52", "env104", "fwd52", "envPolicy52", "envCredit52", "envMarket52", "mom", "rev5"];
const preds = {}; for (const h of HS) preds[h] = {};
const gammaLog = { 5: [], 10: [], 20: [], 60: [] };
const keyFns = { env: (s) => s.envKey, fwd: (s) => s.fwdKey, envPolicy: (s) => s.envKey.split("|")[0], envCredit: (s) => s.envKey.split("|")[1], envMarket: (s) => s.envKey.split("|")[2] };
for (const h of HS) {
  const lagS = Math.ceil(h / STEP);
  let model = null;
  for (const s of samples) {
    const trainEnd = s.k - lagS; // last sample whose outcome is known
    if (trainEnd + 1 < MIN_TRAIN) continue;
    if (!model || (s.k - model.at) >= REFIT) {
      const tr = samples.slice(0, trainEnd + 1);
      const gl = fit(tr, h), gL = fit(tr, h, true);
      const byKey = {};
      for (const [kn, fn] of Object.entries(keyFns)) {
        const groups = {}; for (const t of tr) (groups[fn(t)] ||= []).push(t);
        byKey[kn] = {}; for (const [key, ts] of Object.entries(groups)) { const m = fit(ts, h); byKey[kn][key] = { g: m?.g || null, n: ts.length }; }
      }
      model = { at: s.k, gl, gL, byKey, trainedThrough: samples[trainEnd].date };
      gammaLog[h].push({ date: s.date, trainedThrough: model.trainedThrough, g: gl?.g?.map(r3), env: Object.fromEntries(Object.entries(byKey.env).map(([k, v]) => [k, { n: v.n, g: v.g?.map(r3) || null }])), fwd: Object.fromEntries(Object.entries(byKey.fwd).map(([k, v]) => [k, { n: v.n, g: v.g?.map(r3) || null }])) });
    }
    if (!s.y[h]) { // live / unrealized sample: keep the model for the final read
      s.liveModel = s.liveModel || {}; s.liveModel[h] = model;
      continue;
    }
    const out = {};
    const dot = (g, x) => g.reduce((a, v, j) => a + v * x[j], 0);
    const gg = model.gl?.g;
    for (const v of VARIANTS) {
      let g = null;
      if (v === "prior") g = FEATS.map((f) => (f.startsWith("L_") ? 1 : 0));
      else if (v === "mom") g = FEATS.map((f) => (f === "rot" ? 1 : 0));
      else if (v === "rev5") g = FEATS.map((f) => (f === "rot5" ? -1 : 0));
      else if (v === "global") g = gg;
      else if (v === "globalL") g = model.gL?.g;
      else {
        const m = v.match(/^(env|fwd|envPolicy|envCredit|envMarket)(\d+)$/); const kn = m[1], lam = +m[2];
        const key = keyFns[kn](s); const b = model.byKey[kn][key];
        g = gg ? blend(b?.g, b?.n || 0, gg, lam) : null;
      }
      if (!g) continue;
      out[v] = s.rows.map((r) => dot(g, r.x));
    }
    preds[h][s.k] = out;
  }
}

// ---- evaluation ----
function evalSample(s, h, p) {
  const ys = s.y[h]; const ok = s.rows.map((r, j) => j).filter((j) => ys[j] != null && Number.isFinite(p[j]));
  if (ok.length < 10) return null;
  const pv = ok.map((j) => p[j]), yv = ok.map((j) => ys[j]);
  const ic = spearman(pv, yv);
  const ord = ok.slice().sort((a, b) => p[b] - p[a]);
  const top = mean(ord.slice(0, TOPN).map((j) => ys[j])), bot = mean(ord.slice(-TOPN).map((j) => ys[j]));
  return { ic, spread: top - bot, top, bot };
}
const EPISODES = [
  ["2008 financial crisis", "2007-10-09", "2009-03-09"], ["2010 flash crash / euro", "2010-04-23", "2010-07-02"], ["2011 downgrade / euro", "2011-07-22", "2011-10-03"],
  ["2015-16 oil and China", "2015-08-10", "2016-02-11"], ["2018 Q4 Fed sell-off", "2018-10-03", "2018-12-24"], ["2020 Covid crash", "2020-02-19", "2020-03-23"],
  ["2020 Covid rebound", "2020-03-24", "2020-08-31"], ["2022 hikes bear market", "2022-01-03", "2022-10-12"], ["2023 bank failures", "2023-03-08", "2023-05-04"],
  ["2025 tariff shock", "2025-02-19", "2025-04-08"], ["2026 so far", "2026-01-02", "2026-12-31"],
];
const RATE_CYCLES = [
  ["Cuts 2007-08", "2007-09-18", "2008-12-16"], ["Zero rates 2009-15", "2008-12-17", "2015-12-15"], ["Hikes 2015-18", "2015-12-16", "2018-12-19"],
  ["Cuts 2019-20", "2019-07-31", "2020-03-15"], ["Zero rates 2020-22", "2020-03-16", "2022-03-15"], ["Hikes 2022-23", "2022-03-16", "2023-07-26"],
  ["Hold at the top 2023-24", "2023-07-27", "2024-09-17"], ["Cuts 2024-25", "2024-09-18", "2025-12-31"], ["2026", "2026-01-01", "2026-12-31"],
];
const dims = {
  "All": () => "all",
  "Half": (s) => (s.date < "2018-01-01" ? "2010-2017" : "2018-2026"),
  "Fed policy (cycle read)": (s) => s.cycles.bucket.policy,
  "Fed policy detail": (s) => s.cycles.policy,
  "Credit cycle": (s) => s.cycles.credit,
  "Market cycle": (s) => s.cycles.market,
  "Inflation": (s) => s.cycles.inflation,
  "Growth": (s) => s.cycles.growth,
  "Growth / inflation": (s) => s.cycles.quadrant,
  "Liquidity": (s) => s.cycles.liquidity,
  "President": (s) => s.cycles.politics.president,
  "Congress and White House": (s) => s.cycles.politics.alignment,
  "Party mix (Pres/House/Senate)": (s) => s.cycles.politics.key,
  "Stress check": (s) => s.systemic.state,
  "Rate cycle": (s) => RATE_CYCLES.find(([, a, b]) => s.date >= a && s.date <= b)?.[0] || null,
  "Episode": (s) => EPISODES.find(([, a, b]) => s.date >= a && s.date <= b)?.[0] || null,
  "Year": (s) => s.date.slice(0, 4),
};
function slice(h, variant, filter = () => true) {
  const out = {};
  for (const [dn, fn] of Object.entries(dims)) {
    const g = {};
    for (const s of samples) {
      const p = preds[h][s.k]?.[variant]; if (!p || !filter(s)) continue;
      const ev = evalSample(s, h, p); if (!ev || !Number.isFinite(ev.ic)) continue;
      const key = fn(s); if (key == null) continue;
      (g[key] ||= []).push(ev);
    }
    out[dn] = Object.fromEntries(Object.entries(g).map(([k, evs]) => [k, {
      n: evs.length, ic: r3(mean(evs.map((e) => e.ic))), t: r2(nwT(evs.map((e) => e.ic), Math.ceil(h / STEP))),
      spreadPct: r2(mean(evs.map((e) => e.spread))), hit: r2(evs.filter((e) => e.spread > 0).length / evs.length),
    }]));
  }
  return out;
}
const results = { built: new Date().toISOString(), version: MC.MACRO_CONTEXT_VERSION, start: samples[0].date, end: samples[samples.length - 1].date, nSamples: samples.length, etfs: ETFS, feats: FEATS, variants: {}, singles: {}, contemporaneous: {}, market: {}, detectors: {}, gammas: {} };
for (const h of HS) {
  results.variants[h] = {};
  for (const v of VARIANTS) results.variants[h][v] = slice(h, v);
}

// ---- single-feature diagnostics: does each clue, alone, rank next month's winners? ----
for (const h of HS) {
  results.singles[h] = {};
  for (const fname of FEATS) {
    const j = fIdx[fname]; const sign = fname === "rot5" ? -1 : 1;
    const per = {};
    for (const [dn, fn] of Object.entries({ All: () => "all", "Half": dims.Half, "Fed policy (cycle read)": dims["Fed policy (cycle read)"], "Credit cycle": dims["Credit cycle"], "Market cycle": dims["Market cycle"], "Growth / inflation": dims["Growth / inflation"], "Stress check": dims["Stress check"] })) {
      const g = {};
      for (const s of samples) {
        if (s.date < "2010-07-01" || !s.y[h]) continue;
        const ys = s.y[h]; const ok = s.rows.map((r, q) => q).filter((q) => ys[q] != null);
        const xs = ok.map((q) => sign * s.rows[q].x[j]); if (sd(xs) == null || sd(xs) < 1e-9) continue;
        const ic = spearman(xs, ok.map((q) => ys[q])); if (!Number.isFinite(ic)) continue;
        (g[fn(s)] ||= []).push(ic);
      }
      per[dn] = Object.fromEntries(Object.entries(g).map(([k, xs]) => [k, { n: xs.length, ic: r3(mean(xs)), t: r2(nwT(xs, Math.ceil(h / STEP))) }]));
    }
    results.singles[h][fname] = per;
  }
}

// ---- simple, auditable holdout model: pick clues on 2010-2017 only, test on 2018-2026 ----
{
  const chosen = [];
  for (const fname of FEATS) {
    const ic = results.singles[10][fname]?.Half?.["2010-2017"]?.ic;
    if (Number.isFinite(ic) && Math.abs(ic) >= 0.02) chosen.push({ f: fname, w: Math.sign(ic) * (fname === "rot5" ? -1 : 1), icTrain: ic });
  }
  for (const h of HS) for (const s of samples) {
    if (!preds[h][s.k]) continue;
    const n = s.rows.length; const p = new Array(n).fill(0);
    for (const c of chosen) {
      const j = fIdx[c.f]; const xs = s.rows.map((r) => r.x[j]); const mu = mean(xs), sdv = sd(xs) || 0;
      if (sdv < 1e-9) continue;
      for (let q = 0; q < n; q++) p[q] += c.w * (xs[q] - mu) / sdv;
    }
    preds[h][s.k].simple = p;
  }
  results.simple = { chosen, byH: Object.fromEntries(HS.map((h) => [h, slice(h, "simple")])) };
}

// ---- understanding test (same period): when a factor MOVES over the next h days, do sectors react the way the playbook says? ----
for (const h of HS) {
  const lagS = Math.ceil(h / STEP);
  const all = [], byF = Object.fromEntries(F.map((f) => [f, []])), byHalf = {};
  for (const s of samples) {
    const nx = samples[s.k + lagS]; if (!nx || !s.y[h]) continue;
    const ys = s.y[h]; const ok = s.rows.map((r, q) => q).filter((q) => ys[q] != null);
    const pred = ok.map((q) => F.reduce((a, fk) => { const d = (nx.f[fk]?.score ?? NaN) - (s.f[fk]?.score ?? NaN); return a + (Number.isFinite(d) ? (s.rows[q].ex[fk] ?? 0) * d : 0); }, 0));
    const ic = spearman(pred, ok.map((q) => ys[q])); if (Number.isFinite(ic)) { all.push(ic); (byHalf[dims.Half(s)] ||= []).push(ic); }
    for (const fk of F) {
      const d = (nx.f[fk]?.score ?? NaN) - (s.f[fk]?.score ?? NaN); if (!Number.isFinite(d) || Math.abs(d) < 0.25) continue;
      const xs = ok.map((q) => (s.rows[q].ex[fk] ?? 0) * d); if ((sd(xs) ?? 0) < 1e-9) continue;
      const c = spearman(xs, ok.map((q) => ys[q])); if (Number.isFinite(c)) byF[fk].push(c);
    }
  }
  results.contemporaneous[h] = { all: { n: all.length, ic: r3(mean(all)), t: r2(nwT(all, lagS)) }, byHalf: Object.fromEntries(Object.entries(byHalf).map(([k, xs]) => [k, { n: xs.length, ic: r3(mean(xs)) }])), byFactor: Object.fromEntries(Object.entries(byF).map(([k, xs]) => [k, { n: xs.length, ic: r3(mean(xs)), t: r2(nwT(xs, lagS)) }])) };
}

// which factors move sectors most in each environment (same-period, playbook direction)
results.contemporaneousByEnv = {};
{
  const h = 20, lagS = 4;
  for (const [dn, fn] of Object.entries({ "Fed policy (cycle read)": dims["Fed policy (cycle read)"], "Credit cycle": dims["Credit cycle"], "Market cycle": dims["Market cycle"], "Growth / inflation": dims["Growth / inflation"] })) {
    const g = {};
    for (const s of samples) {
      const nx = samples[s.k + lagS]; if (!nx || !s.y[h]) continue;
      const ys = s.y[h]; const ok = s.rows.map((r, q) => q).filter((q) => ys[q] != null); const key = fn(s);
      g[key] ||= Object.fromEntries(F.map((fk) => [fk, []]));
      for (const fk of F) {
        const d = (nx.f[fk]?.score ?? NaN) - (s.f[fk]?.score ?? NaN); if (!Number.isFinite(d) || Math.abs(d) < 0.25) continue;
        const xs = ok.map((q) => (s.rows[q].ex[fk] ?? 0) * d); if ((sd(xs) ?? 0) < 1e-9) continue;
        const c = spearman(xs, ok.map((q) => ys[q])); if (Number.isFinite(c)) g[key][fk].push(c);
      }
    }
    results.contemporaneousByEnv[dn] = Object.fromEntries(Object.entries(g).map(([k, byF]) => [k, Object.fromEntries(Object.entries(byF).map(([fk, xs]) => [fk, xs.length >= 8 ? { n: xs.length, ic: r3(mean(xs)) } : null]))]));
  }
}

// ---- market-level: does the cycle read see the next one to three months for the whole market? ----
for (const h of HS) {
  const md = {};
  for (const [dn, fn] of Object.entries({ All: () => "all", "Fed policy (cycle read)": dims["Fed policy (cycle read)"], "Credit cycle": dims["Credit cycle"], "Market cycle": dims["Market cycle"], "Growth / inflation": dims["Growth / inflation"], "Liquidity": dims.Liquidity, "Stress check": dims["Stress check"], "President": dims.President, "Congress and White House": dims["Congress and White House"],
    "Credit score tercile": (s) => tercile(s.f.credit?.score, -0.4, 0.4, ["easy", "middle", "tight"]), "Rates score tercile": (s) => tercile(s.f.rates?.score, -0.4, 0.4, ["easing", "middle", "tightening"]), "Market-cycle score": (s) => tercile(s.f.risk?.score, -0.5, 0.5, ["weak", "middle", "strong"]) })) {
    const g = {};
    for (const s of samples) { if (!s.mkt[h]) continue; const k = fn(s); if (k == null) continue; (g[k] ||= []).push(s.mkt[h]); }
    md[dn] = Object.fromEntries(Object.entries(g).map(([k, xs]) => [k, { n: xs.length, retPct: r2(mean(xs.map((x) => x.ret))), medPct: r2(median(xs.map((x) => x.ret))), upShare: r2(xs.filter((x) => x.ret > 0).length / xs.length), fall5Share: r2(xs.filter((x) => x.low <= -5).length / xs.length), worstDdPct: r2(mean(xs.map((x) => x.mdd))) }]));
  }
  results.market[h] = md;
}
function tercile(x, lo, hi, names) { if (!Number.isFinite(x)) return null; return x <= lo ? names[0] : x >= hi ? names[2] : names[1]; }
function median(xs) { const a = xs.slice().sort((p, q) => p - q); return a.length ? a[a.length >> 1] : null; }

// ---- detectors ----
{
  // systemic episodes
  const eps = []; let cur = null;
  for (const s of samples) {
    if (s.systemic.state === "systemic") { if (!cur) cur = { start: s.date, k0: s.k, n: 0, evidence: s.systemic.evidence }; cur.n++; cur.end = s.date; cur.k1 = s.k; }
    else if (cur && s.k - cur.k1 > 2) { eps.push(cur); cur = null; }
  }
  if (cur) eps.push(cur);
  const spy = aligned.SPY;
  results.detectors.systemicEpisodes = eps.map((e) => {
    const s0 = samples[e.k0]; const i0 = s0.i;
    const back20 = (spy[i0] / spy[i0 - 20] - 1) * 100;
    const f20 = s0.mkt[20]?.ret ?? null, f60 = s0.mkt[60]?.ret ?? null;
    // where was the bottom relative to the first flag?
    let lowI = i0; for (let k = i0; k <= Math.min(CAL.length - 1, i0 + 120); k++) if (spy[k] < spy[lowI]) lowI = k;
    return { start: e.start, end: e.end, weeks: e.n, spyPrior20dPct: r2(back20), spyNext20dPct: r2(f20), spyNext60dPct: r2(f60), lowAfterPct: r2((spy[lowI] / spy[i0] - 1) * 100), lowDate: CAL[lowI], evidence: e.evidence };
  });
  // rotation persistence: into-groups minus out-of-groups, next 20 days
  const rot = { rotation: [], all: [] };
  for (const s of samples) {
    if (!s.y[20]) continue;
    const yBy = Object.fromEntries(s.rows.map((r, q) => [r.e, s.y[20][q]]));
    const inn = s.map.into.map((g) => yBy[g.name]).filter((x) => x != null), out = s.map.outOf.map((g) => yBy[g.name]).filter((x) => x != null);
    if (!inn.length || !out.length) continue;
    const d = mean(inn) - mean(out);
    rot.all.push(d); if (s.systemic.state === "rotation") rot.rotation.push(d);
  }
  results.detectors.rotationPersistence = Object.fromEntries(Object.entries(rot).map(([k, xs]) => [k, { n: xs.length, nextMonthIntoMinusOutPct: r2(mean(xs)), t: r2(nwT(xs, 4)), hit: r2(xs.filter((x) => x > 0).length / xs.length) }]));
  // the live engine's one-day offense-minus-defense read, then the next month for the same baskets
  const OFF = ["NVDA", "AMD", "AVGO", "MRVL", "SMCI", "ARM", "MU", "PLTR", "TSLA", "META", "SHOP", "CRWD", "DDOG"], DEF = ["WMT", "COST", "SBUX", "LLY", "UNH"];
  const bk = (names, i, n) => { const xs = names.map((s) => (aligned[s]?.[i] > 0 && aligned[s]?.[i - n] > 0 ? aligned[s][i] / aligned[s][i - n] - 1 : null)).filter((x) => x != null); return xs.length >= 3 ? mean(xs) : null; };
  const bkF = (names, i, n) => { if (i + n >= CAL.length) return null; const xs = names.map((s) => (aligned[s]?.[i] > 0 && aligned[s]?.[i + n] > 0 ? aligned[s][i + n] / aligned[s][i] - 1 : null)).filter((x) => x != null); return xs.length >= 3 ? mean(xs) : null; };
  const pairs = { oneDay: [], oneMonth: [], threeMonth: [] };
  for (const s of samples) {
    const i = s.i; const fwd = bkF(OFF, i, 20) != null && bkF(DEF, i, 20) != null ? bkF(OFF, i, 20) - bkF(DEF, i, 20) : null; if (fwd == null) continue;
    for (const [k, n] of [["oneDay", 1], ["oneMonth", 20], ["threeMonth", 60]]) { const a = bk(OFF, i, n), b = bk(DEF, i, n); if (a != null && b != null) pairs[k].push([a - b, fwd]); }
  }
  results.detectors.offenseDefense = Object.fromEntries(Object.entries(pairs).map(([k, xs]) => [k, { n: xs.length, corrWithNextMonth: r3(spearman(xs.map((p) => p[0]), xs.map((p) => p[1]))) }]));
  // Fed pricing: does what the market prices (2Y vs fed funds) foresee what the Fed then does?
  const fed = { priced: [], drift: [] };
  for (const s of samples) {
    const i = s.i; const d0 = R.at("DFF", s.date, 10); const j = Math.min(CAL.length - 1, i + 126); if (j - i < 120) continue;
    const d6 = R.at("DFF", CAL[j], 10); if (d0 == null || d6 == null) continue;
    const pr = s.f.rates?.detail?.pricedPct; const y2 = R.at("DGS2", s.date, 10), y2p = R.at("DGS2", CAL[i - 1], 10);
    if (pr != null) fed.priced.push([pr, d6 - d0]);
    if (y2 != null && y2p != null) fed.drift.push([y2 - y2p, d6 - d0]);
  }
  const sgn = (xs, th) => { const f = xs.filter((p) => Math.abs(p[0]) >= th && Math.abs(p[1]) >= 0.125); return { n: f.length, rightDirection: r2(f.filter((p) => Math.sign(p[0]) === Math.sign(p[1])).length / Math.max(1, f.length)) }; };
  results.detectors.fedPricing = { pricedVsNext6m: { corr: r3(spearman(fed.priced.map((p) => p[0]), fed.priced.map((p) => p[1]))), ...sgn(fed.priced, 0.25) }, oneDayDriftVsNext6m: { corr: r3(spearman(fed.drift.map((p) => p[0]), fed.drift.map((p) => p[1]))), ...sgn(fed.drift, 0.02) } };
  // environment forecast: is the forward key a better guess of next quarter's environment than today's?
  let a = 0, b = 0, n = 0, ap = 0, bp = 0;
  for (const s of samples) { const nx = samples[s.k + 13]; if (!nx) continue; n++; if (s.envKey === nx.envKey) a++; if (s.fwdKey === nx.envKey) b++; if (s.envKey.split("|")[0] === nx.envKey.split("|")[0]) ap++; if (s.fwdKey.split("|")[0] === nx.envKey.split("|")[0]) bp++; }
  results.detectors.envForecast = { n, todayKeyMatchesNextQuarter: r2(a / n), forwardKeyMatchesNextQuarter: r2(b / n), todayPolicyMatches: r2(ap / n), forwardPolicyMatches: r2(bp / n) };
  // would blocking new calls in a systemic read have helped? split by whether credit was still worsening
  const sysv = { all: [], systemic: [], systemicCreditWorsening: [], systemicCreditEasing: [], broad: [] };
  for (const s of samples) {
    if (!s.mkt[20]) continue; const r = s.mkt[20];
    sysv.all.push(r);
    const p4 = samples[s.k - 4]; const dc = p4 && Number.isFinite(s.f.credit?.score) && Number.isFinite(p4.f.credit?.score) ? s.f.credit.score - p4.f.credit.score : null;
    if (s.systemic.state === "systemic") { sysv.systemic.push(r); if (dc != null && dc > 0) sysv.systemicCreditWorsening.push(r); else sysv.systemicCreditEasing.push(r); }
    if (s.systemic.state === "broad de-risking") sysv.broad.push(r);
  }
  results.detectors.callBlock = Object.fromEntries(Object.entries(sysv).map(([k, xs]) => [k, { n: xs.length, next20dPct: r2(mean(xs.map((x) => x.ret))), up: r2(xs.filter((x) => x.ret > 0).length / Math.max(1, xs.length)), fall5: r2(xs.filter((x) => x.low <= -5).length / Math.max(1, xs.length)), fall10: r2(xs.filter((x) => x.low <= -10).length / Math.max(1, xs.length)) }]));
  // stress-state counts
  const cnt = {}; for (const s of samples) cnt[s.systemic.state] = (cnt[s.systemic.state] || 0) + 1; results.detectors.stateCounts = cnt;
}

// ---- learned weights: full sample (for lib/macro-weights.json) and how they moved ----
results.gammas = {};
for (const h of [5, 10, 20]) {
  const tr = samples.filter((s) => s.y[h]);
  const gl = fit(tr, h);
  const byBucket = {}; const groups = {}; for (const t of tr) (groups[t.envKey] ||= []).push(t);
  for (const [k, ts] of Object.entries(groups)) { const m = fit(ts, h); if (m) byBucket[k] = { g: m.g, n: ts.length }; }
  const byFwd = {}; const gf = {}; for (const t of tr) (gf[t.fwdKey] ||= []).push(t);
  for (const [k, ts] of Object.entries(gf)) { const m = fit(ts, h); if (m) byFwd[k] = { g: m.g, n: ts.length }; }
  // in-sample prediction spread for the points scale
  const predsAll = []; for (const s of tr) for (const r of s.rows) predsAll.push(Math.abs(r.x.reduce((a, v, j) => a + v * gl.g[j], 0)));
  predsAll.sort((p, q) => p - q);
  const p90 = predsAll[Math.floor(predsAll.length * 0.9)], p50 = predsAll[predsAll.length >> 1];
  results.gammas[h] = { h, global: Object.fromEntries(FEATS.map((f, j) => [f, r3(gl.g[j])])), byBucket: Object.fromEntries(Object.entries(byBucket).map(([k, v]) => [k, { n: v.n, ...Object.fromEntries(FEATS.map((f, j) => [f, r3(v.g[j])])) }])), byFwd: Object.fromEntries(Object.entries(byFwd).map(([k, v]) => [k, { n: v.n, ...Object.fromEntries(FEATS.map((f, j) => [f, r3(v.g[j])])) }])), predAbsP50: r2(p50), predAbsP90: r2(p90), trainedThrough: tr[tr.length - 1].date, history: gammaLog[h].filter((x, q, arr) => q === arr.length - 1 || x.date.slice(0, 4) !== arr[q + 1].date.slice(0, 4)).map((x) => ({ date: x.date, trainedThrough: x.trainedThrough, ...Object.fromEntries(FEATS.map((f, j) => [f, x.g?.[j] ?? null])) })) };
}

// ---- the latest read (what it says now) ----
{
  const s = samples[samples.length - 1];
  const fwdLast = samples.filter((x) => x.y[20]).slice(-1)[0];
  results.latest = { date: s.date, cycles: s.cycles, factors: Object.fromEntries(F.map((fk) => [fk, { score: s.f[fk]?.score, detail: s.f[fk]?.detail }])), systemic: s.systemic, rotation: { into: s.map.into, outOf: s.map.outOf, dispersionPct: s.map.dispersionPct, hypothesis: MC.rotationHypothesis(withLabels(s.map), s.f, s.cycles) }, envKey: s.envKey, fwdKey: s.fwdKey, lastRealized: fwdLast?.date };
}
function withLabels(map) { const lab = (g) => ({ ...g, name: ETF_LABEL[g.name] || g.name }); return { ...map, into: map.into.map(lab), outOf: map.outOf.map(lab), groups: map.groups.map(lab) }; }

fs.writeFileSync(OUT + "/etf-results.json", JSON.stringify(results, null, 1));
// compact per-sample state for the stock test and the report
fs.writeFileSync(OUT + "/states.json", JSON.stringify(samples.map((s) => ({ date: s.date, i: s.i, envKey: s.envKey, fwdKey: s.fwdKey, cycles: { policy: s.cycles.policy, credit: s.cycles.credit, market: s.cycles.market, inflation: s.cycles.inflation, growth: s.cycles.growth, quadrant: s.cycles.quadrant, liquidity: s.cycles.liquidity, politics: s.cycles.politics.key }, f: Object.fromEntries(F.map((fk) => [fk, s.f[fk]?.score ?? null])), systemic: s.systemic.state, into: s.map.into.map((g) => g.name), outOf: s.map.outOf.map((g) => g.name), mkt20: s.mkt[20]?.ret ?? null }))));
// walk-forward weights at every refit, for the stock test
fs.writeFileSync(OUT + "/walkforward-gammas.json", JSON.stringify(gammaLog));
console.log("done", OUT);
