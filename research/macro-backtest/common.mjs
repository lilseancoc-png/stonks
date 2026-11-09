// Shared loaders and math for the macro / cycle / rotation backtest.
// Research only: reads the long-history download (research/long-history on the
// backtest-data-long branch) and never touches the private store or the site.
import fs from "node:fs";
import zlib from "node:zlib";
import * as MC from "../../lib/macro-context.mjs";

export function loadLongHistory(dir) {
  const bars = JSON.parse(zlib.gunzipSync(fs.readFileSync(dir + "/bars.json.gz")));
  const fred = JSON.parse(zlib.gunzipSync(fs.readFileSync(dir + "/fred.json.gz")));
  // The FRED CSV marks a missing day (bond-market holiday, shutdown month) with
  // ".", which the download stored as 0. Drop a zero that sits between clearly
  // non-zero neighbours; keep series where 0 is a real reading.
  const ZERO_OK = new Set(["DRTSCILM", "DRTSCIS", "USREC", "SAHMREALTIME"]);
  // Bond-market holidays: the 10-year yield is never truly zero.
  const holiday = new Set((fred.DGS10?.t || []).filter((t, i) => fred.DGS10.v[i] === 0));
  for (const [id, s] of Object.entries(fred)) {
    if (ZERO_OK.has(id)) continue;
    const keep = [];
    for (let i = 0; i < s.v.length; i++) {
      if (s.v[i] !== 0 && s.v[i] != null) { keep.push(i); continue; }
      if (s.v[i] == null || holiday.has(s.t[i])) continue;
      let a = i - 1; while (a >= 0 && !s.v[a]) a--;
      let b = i + 1; while (b < s.v.length && !s.v[b]) b++;
      const near = (k) => k >= 0 && k < s.v.length && Math.abs(s.v[k]) <= 0.05;
      if (near(a) || near(b) || a < 0) keep.push(i); // genuine zero (rates at the floor, empty reverse repo)
    }
    fred[id] = { t: keep.map((i) => s.t[i]), v: keep.map((i) => s.v[i]) };
  }
  const series = { ...fred };
  for (const [s, b] of Object.entries(bars)) series[s] = { t: b.t, v: b.c };
  const R = MC.makeSeriesReader(series);
  const CAL = bars.SPY.t.slice();
  const aligned = {};
  for (const [s, b] of Object.entries(bars)) {
    const m = new Map(); b.t.forEach((t, i) => m.set(t, b.c[i]));
    aligned[s] = CAL.map((t) => { const v = m.get(t); return v > 0 ? v : null; });
  }
  // Daily FRED levels forward-filled onto the trading calendar (no lag: these
  // are market series published the same day).
  const ffill = (id, maxStale = 10) => CAL.map((t) => R.at(id, t, maxStale));
  return { bars, fred, series, R, CAL, aligned, ffill };
}

// Equity sector and industry ETFs used as the clean (no survivorship) universe,
// each with the playbook kind it stands for.
export const ETF_KIND = Object.freeze({
  XLK: "megacapTech", XLF: "financials", XLV: "healthcare", XLE: "energy", XLI: "industrials",
  XLY: "consumerDiscretionaryGoods", XLP: "consumerStaples", XLB: "materials", XLU: "utilitiesRate",
  XLRE: "reits", XLC: "mediaEntertainment",
  KRE: "banks", IAI: "brokers", KIE: "insurers", SOXX: "semiconductors", IGV: "softwareGrowth",
  IBB: "biotech", IHI: "medicalDevices", ITB: "homebuilder", XRT: "consumerDiscretionaryGoods",
  IYT: "logistics", XOP: "energy", XME: "materials", ITA: "defense", TAN: "power",
});
export const ETF_LABEL = Object.freeze({
  XLK: "Tech", XLF: "Financials", XLV: "Health care", XLE: "Energy", XLI: "Industrials", XLY: "Consumer discretionary",
  XLP: "Staples", XLB: "Materials", XLU: "Utilities", XLRE: "Real estate", XLC: "Communications", KRE: "Regional banks",
  IAI: "Brokers", KIE: "Insurers", SOXX: "Chips", IGV: "Software", IBB: "Biotech", IHI: "Medical devices", ITB: "Homebuilders",
  XRT: "Retail", IYT: "Transports", XOP: "Oil producers", XME: "Metals and mining", ITA: "Defense", TAN: "Solar",
});

// Daily factor-change proxies for the measured (rolling) sensitivities.
export function factorLevelSeries(H) {
  const { aligned, ffill } = H;
  const hy = aligned.HYG, ief = aligned.IEF;
  return {
    rates: { levels: ffill("DGS2"), kind: "diff", sign: 1 },
    curve: { levels: ffill("T10Y2Y"), kind: "diff", sign: 1 },
    inflation: { levels: ffill("T5YIE"), kind: "diff", sign: 1 },
    credit: { levels: hy.map((x, i) => (x > 0 && ief[i] > 0 ? x / ief[i] : null)), kind: "pct", sign: -1 },
    risk: { levels: aligned.SPY, kind: "pct", sign: 1 },
    dollar: { levels: aligned["DX-Y.NYB"], kind: "pct", sign: 1 },
    oil: { levels: aligned.USO, kind: "pct", sign: 1 },
  };
}

export function measuredAt(closes, spy, flv, i, n = 252) {
  if (i < n) return null;
  const s = closes.slice(i - n, i + 1), m = spy.slice(i - n, i + 1);
  if (s.some((x) => !(x > 0)) || m.some((x) => !(x > 0))) return null;
  const factors = {};
  for (const [fk, spec] of Object.entries(flv)) {
    const lv = spec.levels.slice(i - n, i + 1);
    if (lv.some((x) => !Number.isFinite(x))) continue;
    factors[fk] = { levels: lv, kind: spec.kind, sign: spec.sign };
  }
  return MC.measuredExposures({ stock: s, market: m, factors }, n);
}

// ---- small stats ----
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const sd = (xs) => { if (xs.length < 2) return null; const mu = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1)); };
export function ranks(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1;
  }
  return r;
}
export function pearson(a, b) {
  const n = a.length; if (n < 3) return null;
  const ma = mean(a), mb = mean(b); let c = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
  return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : null;
}
export const spearman = (a, b) => pearson(ranks(a), ranks(b));
// Newey-West t-stat for the mean of an overlapping series.
export function nwT(xs, lag) {
  const n = xs.length; if (n < 10) return null;
  const mu = mean(xs); const e = xs.map((x) => x - mu);
  let s = e.reduce((a, x) => a + x * x, 0) / n;
  for (let L = 1; L <= lag; L++) { let c = 0; for (let i = L; i < n; i++) c += e[i] * e[i - L]; s += 2 * (1 - L / (lag + 1)) * c / n; }
  return s > 0 ? mu / Math.sqrt(s / n) : null;
}
export function solve(A, b) { // Gaussian elimination with partial pivoting
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; if (!f) continue; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export function ridge(XtX, Xty, alpha = 0.1) {
  const p = Xty.length; const tr = XtX.reduce((a, r, i) => a + r[i], 0) / p;
  const A = XtX.map((r, i) => r.map((v, j) => v + (i === j ? alpha * tr : 0)));
  return solve(A, Xty);
}
export const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
export const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
