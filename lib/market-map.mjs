// Market map (2026-11-07): one public file behind the whole-universe views.
//
//   rows     every tracked name: price moves, valuation, RSI, distance from
//            its 50 / 200-day averages, IV level + percentile, put skew and
//            its z-score, FINRA short interest, and a six-month line. Feeds
//            the Fear map (IV percentile vs put-skew z), the two-number
//            Scatter lens, the Chart wall and the Crowded shorts screen.
//   corr     60-session daily-return correlations between the stocks (ETFs
//            left out), ordered so names that move together sit next to each
//            other (average-linkage clustering), plus the tight clusters.
//   breadth  daily share of stocks above their 50 / 200-day averages, new
//            52-week highs and lows, and the share of volume on up days, for
//            the last ~250 sessions, rebuilt from the bars every bake.
//   zeroDte  option volume by days to expiry from the chains the bake just
//            saved, so the Unusual options page can show when same-day and
//            this-week contracts dominate.
//
// Everything here comes from public per-ticker data the bake already has in
// memory. No grade, Top Picks or other Owner field is read or written; the
// browser adds the Owner layers from Owner-only files after sign-in. Pure;
// no network, no AI.

export const MARKET_MAP_VERSION = 1;
export const MARKET_MAP_FILE = "market-map.json";
export const CORR_WINDOW = 60;
export const BREADTH_SESSIONS = 250;
const SPARK_POINTS = 60;
const SPARK_SESSIONS = 126;

const fin = (v) => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);

function barsOf(data) {
  const raw = Array.isArray(data?._patternBars) && data._patternBars.length > (data?._bars?.length || 0)
    ? data._patternBars : (Array.isArray(data?._bars) ? data._bars : null);
  if (raw) {
    return raw.filter((b) => b && /^\d{4}-\d{2}-\d{2}/.test(String(b.t || "")) && fin(b.c) > 0)
      .map((b) => ({ t: String(b.t).slice(0, 10), c: Number(b.c), v: fin(b.v) || 0 }));
  }
  const ps = data?.priceSeries;
  if (ps && Array.isArray(ps.t) && Array.isArray(ps.c)) {
    const out = [];
    for (let i = 0; i < ps.t.length; i++) {
      const c = fin(ps.c[i]);
      if (c > 0 && ps.t[i]) out.push({ t: String(ps.t[i]).slice(0, 10), c, v: fin(ps.v?.[i]) || 0 });
    }
    return out;
  }
  return [];
}

function pctBack(closes, k) {
  const n = closes.length;
  if (n <= k || !(closes[n - 1 - k] > 0)) return null;
  return r2((closes[n - 1] / closes[n - 1 - k] - 1) * 100);
}

function ytd(bars) {
  if (!bars.length) return null;
  const yr = bars[bars.length - 1].t.slice(0, 4);
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].t.slice(0, 4) !== yr) return r2((bars[bars.length - 1].c / bars[i].c - 1) * 100);
  }
  return null;
}

function sma(closes, n) {
  if (closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}

// Six months downsampled to ~60 points, each in tenths of a percent from the
// first point (small ints keep the file compact).
function spark(closes) {
  const tail = closes.slice(-SPARK_SESSIONS);
  if (tail.length < 10) return null;
  const step = Math.max(1, Math.ceil(tail.length / SPARK_POINTS));
  const base = tail[0];
  const out = [];
  for (let i = 0; i < tail.length; i += step) out.push(Math.round((tail[i] / base - 1) * 1000));
  const last = Math.round((tail[tail.length - 1] / base - 1) * 1000);
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function rowFor(sym, data, ctx) {
  const bars = barsOf(data);
  if (bars.length < 30) return null;
  const closes = bars.map((b) => b.c);
  const f = data?.fundamentals || {};
  const tech = data?.technicals || {};
  const last = closes[closes.length - 1];
  const s50 = fin(tech?.sma?.sma50) ?? sma(closes, 50);
  const s200 = fin(tech?.sma?.sma200) ?? sma(closes, 200);
  const year = closes.slice(-252);
  const hi = Math.max(...year), lo = Math.min(...year);
  const iv = data?.ivRank || {};
  const surf = data?.ivSurface || {};
  const si = f.shortInterest || null;
  const rv30 = fin(tech?.volRegime?.rv30);
  const band = ctx.ivBand ? ctx.ivBand({ pctile: fin(iv.pctile), iv: fin(iv.iv), rv30 }) : null;
  return {
    s: sym,
    n: String(f.shortName || f.name || data?.name || "").slice(0, 48) || null,
    g: ctx.groupOf ? ctx.groupOf(sym) : null,
    sec: ctx.sectorOf ? ctx.sectorOf(sym) : null,
    etf: ctx.isEtf ? !!ctx.isEtf(sym) : false,
    mc: fin(f.marketCap),
    px: r2(last),
    r1d: pctBack(closes, 1),
    r5d: pctBack(closes, 5),
    r1m: pctBack(closes, 21),
    r3m: pctBack(closes, 63),
    r6m: pctBack(closes, 126),
    rytd: ytd(bars),
    r1y: pctBack(closes, Math.min(252, closes.length - 1)),
    pe: fin(f.trailingPE) != null ? r1(fin(f.trailingPE)) : null,
    fpe: fin(f.forwardPE) != null ? r1(fin(f.forwardPE)) : null,
    rsi: fin(tech.rsi) != null ? r1(fin(tech.rsi)) : null,
    d50: s50 > 0 ? r2((last / s50 - 1) * 100) : null,
    d200: s200 > 0 ? r2((last / s200 - 1) * 100) : null,
    dHi: hi > 0 ? r2((last / hi - 1) * 100) : null,
    dLo: lo > 0 ? r2((last / lo - 1) * 100) : null,
    iv: fin(iv.iv) != null ? r4(fin(iv.iv)) : null,
    ivp: fin(iv.pctile) != null ? Math.round(fin(iv.pctile)) : null,
    ivb: band ? band.band : null,
    rv: rv30 != null ? r4(rv30) : null,
    skew: fin(surf.skew25) != null ? r4(fin(surf.skew25)) : null,
    skz: fin(surf.skewZ) != null ? r2(fin(surf.skewZ)) : null,
    term: fin(surf.termSlope) != null ? r4(fin(surf.termSlope)) : null,
    si: si && fin(si.percentFloat) != null ? r2(fin(si.percentFloat)) : null,
    dtc: si && fin(si.daysToCover) != null ? r2(fin(si.daysToCover)) : null,
    siChg: si && fin(si.changePct) != null ? r1(fin(si.changePct)) : null,
    siDate: si?.settlementDate || null,
    ne: typeof f.nextEarningsDate === "string" ? f.nextEarningsDate.slice(0, 10) : null,
    sp: spark(closes),
  };
}

// --- correlation ----------------------------------------------------------
function returnsOn(bars, dates) {
  const byDate = new Map(bars.map((b) => [b.t, b.c]));
  const out = [];
  for (let i = 1; i < dates.length; i++) {
    const a = byDate.get(dates[i - 1]), b = byDate.get(dates[i]);
    out.push(a > 0 && b > 0 ? Math.log(b / a) : null);
  }
  return out;
}

function corr(x, y) {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i], b = y[i];
    if (a == null || b == null) continue;
    n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
  }
  if (n < 20) return null;
  const vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
  if (!(vx > 0 && vy > 0)) return null;
  return (sxy - sx * sy / n) / Math.sqrt(vx * vy);
}

// Average-linkage agglomerative clustering on 1 - rho; returns the leaf order
// and every merge (for cutting into clusters).
export function clusterOrder(m) {
  const n = m.length;
  let clusters = Array.from({ length: n }, (_, i) => ({ members: [i] }));
  const dist = (a, b) => {
    let s = 0, k = 0;
    for (const i of a.members) for (const j of b.members) {
      const v = m[i][j];
      if (v != null) { s += 1 - v; k++; }
    }
    return k ? s / k : 1.5;
  };
  const merges = [];
  while (clusters.length > 1) {
    let best = null;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = dist(clusters[i], clusters[j]);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    const a = clusters[best.i], b = clusters[best.j];
    const merged = { members: a.members.concat(b.members), d: best.d };
    merges.push({ members: merged.members.slice(), d: best.d });
    clusters = clusters.filter((_, k) => k !== best.i && k !== best.j);
    clusters.push(merged);
  }
  return { order: clusters.length ? clusters[0].members : [], merges };
}

export function buildCorrelation(barsBySym, symbols, window = CORR_WINDOW) {
  const ref = barsBySym.SPY || barsBySym[symbols[0]] || [];
  const dates = ref.slice(-(window + 1)).map((b) => b.t);
  if (dates.length < 25) return null;
  const syms = symbols.filter((s) => (barsBySym[s] || []).length >= window * 0.8);
  const rets = syms.map((s) => returnsOn(barsBySym[s], dates));
  const n = syms.length;
  const m = Array.from({ length: n }, () => new Array(n).fill(null));
  for (let i = 0; i < n; i++) {
    m[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const v = corr(rets[i], rets[j]);
      m[i][j] = m[j][i] = v;
    }
  }
  const { order, merges } = clusterOrder(m);
  const ordered = order.map((i) => syms[i]);
  const matrix = order.map((i) => order.map((j) => (m[i][j] == null ? null : Math.round(m[i][j] * 100))));
  // Tight clusters: the largest merges whose average correlation is >= 0.6,
  // without overlapping a bigger one already kept.
  const kept = [];
  const used = new Set();
  merges.filter((g) => g.d <= 0.4 && g.members.length >= 3)
    .sort((a, b) => b.members.length - a.members.length || a.d - b.d)
    .forEach((g) => {
      if (g.members.some((i) => used.has(i))) return;
      g.members.forEach((i) => used.add(i));
      kept.push({ syms: g.members.map((i) => syms[i]).sort(), avg: Math.round((1 - g.d) * 100) });
    });
  let pairs = 0, sum = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (m[i][j] != null) { pairs++; sum += m[i][j]; }
  return {
    window, from: dates[0], to: dates[dates.length - 1],
    syms: ordered, m: matrix,
    avg: pairs ? Math.round(sum / pairs * 100) : null,
    clusters: kept.slice(0, 8),
  };
}

// --- breadth ----------------------------------------------------------------
export function buildBreadth(barsBySym, symbols, sessions = BREADTH_SESSIONS) {
  const ref = barsBySym.SPY || [];
  const dates = ref.slice(-sessions).map((b) => b.t);
  if (dates.length < 20) return null;
  const idx = new Map(dates.map((d, i) => [d, i]));
  const L = dates.length;
  const above50 = new Array(L).fill(0), above200 = new Array(L).fill(0);
  const n50 = new Array(L).fill(0), n200 = new Array(L).fill(0);
  const highs = new Array(L).fill(0), lows = new Array(L).fill(0), n52 = new Array(L).fill(0);
  const upVol = new Array(L).fill(0), dnVol = new Array(L).fill(0);
  for (const s of symbols) {
    const bars = barsBySym[s] || [];
    if (bars.length < 60) continue;
    const c = bars.map((b) => b.c);
    let sum50 = 0, sum200 = 0;
    for (let i = 0; i < bars.length; i++) {
      sum50 += c[i]; if (i >= 50) sum50 -= c[i - 50];
      sum200 += c[i]; if (i >= 200) sum200 -= c[i - 200];
      const k = idx.get(bars[i].t);
      if (k == null) continue;
      if (i >= 49) { n50[k]++; if (c[i] > sum50 / 50) above50[k]++; }
      if (i >= 199) { n200[k]++; if (c[i] > sum200 / 200) above200[k]++; }
      if (i >= 251) {
        let hi = -Infinity, lo = Infinity;
        for (let j = i - 251; j < i; j++) { if (c[j] > hi) hi = c[j]; if (c[j] < lo) lo = c[j]; }
        n52[k]++;
        if (c[i] > hi) highs[k]++;
        if (c[i] < lo) lows[k]++;
      }
      if (i >= 1) {
        const v = bars[i].v || 0;
        if (c[i] > c[i - 1]) upVol[k] += v; else if (c[i] < c[i - 1]) dnVol[k] += v;
      }
    }
  }
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 1000) / 10 : null);
  return {
    dates,
    spy: ref.slice(-sessions).map((b) => r2(b.c)),
    a50: dates.map((_, k) => pct(above50[k], n50[k])),
    a200: dates.map((_, k) => pct(above200[k], n200[k])),
    hi: highs.map((v, k) => (n52[k] ? v : null)),
    lo: lows.map((v, k) => (n52[k] ? v : null)),
    upv: dates.map((_, k) => pct(upVol[k], upVol[k] + dnVol[k])),
    n: dates.map((_, k) => n50[k] || null),
  };
}

// --- option volume by expiry --------------------------------------------------
const DTE_BUCKETS = [["d0", "Same day"], ["w", "1–7 days"], ["m", "8–30 days"], ["l", "31+ days"]];
export function buildExpiryVolume(chains, builtAtIso) {
  const today = new Date(builtAtIso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const total = { d0: 0, w: 0, m: 0, l: 0 };
  const rows = [];
  for (const [sym, data] of Object.entries(chains || {})) {
    const ch = data?.chains;
    if (!ch || typeof ch !== "object") continue;
    const b = { d0: 0, w: 0, m: 0, l: 0 };
    let any = false, sameDay = false;
    for (const [exp, side] of Object.entries(ch)) {
      const expDate = new Date(Number(exp) * 1000).toISOString().slice(0, 10);
      const days = Math.round((Date.parse(`${expDate}T00:00:00Z`) - todayMs) / 86400000);
      if (!Number.isFinite(days) || days < 0) continue;
      if (days === 0) sameDay = true;
      const key = days === 0 ? "d0" : days <= 7 ? "w" : days <= 30 ? "m" : "l";
      for (const row of [...(side?.c || []), ...(side?.p || [])]) {
        const v = fin(row?.v);
        if (v > 0) { b[key] += v; any = true; }
      }
    }
    if (!any) continue;
    const sum = b.d0 + b.w + b.m + b.l;
    for (const k of Object.keys(b)) total[k] += b[k];
    // d0Pct stays null when the stock has no option expiring that day, so the
    // page can tell "none listed" from "listed but barely traded".
    rows.push({ s: sym, ...b, all: sum, d0Pct: sum && sameDay ? r1(b.d0 / sum * 100) : null, nearPct: sum ? r1((b.d0 + b.w) / sum * 100) : null });
  }
  rows.sort((a, b) => b.all - a.all);
  const all = total.d0 + total.w + total.m + total.l;
  return {
    asOf: builtAtIso,
    date: today,
    buckets: DTE_BUCKETS.map(([key, label]) => ({ key, label })),
    total: { ...total, all, d0Pct: all ? r1(total.d0 / all * 100) : null, nearPct: all ? r1((total.d0 + total.w) / all * 100) : null },
    rows: rows.slice(0, 85),
    note: "Contracts traded so far in the session at the time of the build, across the 14 nearest expirations and strikes within 50% of the price.",
  };
}

export function buildMarketMap({ chains, symbols, sectorOf, groupOf, isEtf, ivBand, builtAtIso }) {
  const syms = (symbols || Object.keys(chains || {})).filter((s) => chains?.[s]);
  const ctx = { sectorOf, groupOf, isEtf, ivBand };
  const rows = [];
  const barsBySym = {};
  for (const s of syms) {
    const data = chains[s];
    const bars = barsOf(data);
    if (bars.length) barsBySym[s] = bars;
    const row = rowFor(s, data, ctx);
    if (row) rows.push(row);
  }
  if (!barsBySym.SPY && chains?.SPY) barsBySym.SPY = barsOf(chains.SPY);
  const stocks = syms.filter((s) => !(isEtf && isEtf(s)));
  return {
    version: MARKET_MAP_VERSION,
    builtAtIso,
    asOf: barsBySym.SPY?.length ? barsBySym.SPY[barsBySym.SPY.length - 1].t : null,
    rows,
    corr: buildCorrelation(barsBySym, stocks),
    breadth: buildBreadth(barsBySym, stocks),
    zeroDte: buildExpiryVolume(Object.fromEntries(syms.map((s) => [s, chains[s]])), builtAtIso),
    notes: {
      spark: "Six months of closes, each point in tenths of a percent from the first.",
      corr: "Daily log returns over the last 60 sessions; ETFs left out. Values are correlation × 100.",
      breadth: "Tracked stocks only (ETFs left out).",
    },
  };
}
