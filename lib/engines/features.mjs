// Strategy engines: price features. One O(n) pass per symbol builds every
// rolling array an engine reads; featAt() is then an O(1) lookup for any bar.
// The same code feeds the live bake (confirmed daily bars through the prior
// close) and the history test (bars through day i-1), so a setup can't see
// different numbers in the two.
//
// Pure. No network, no AI.

const fin = (x) => typeof x === "number" && Number.isFinite(x);

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
// A bar's date as YYYY-MM-DD: a date string as it is, an epoch (seconds or
// milliseconds) as its New York date.
export function barDate(t) {
  if (t == null) return null;
  if (typeof t === "string" && /^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return ET_DATE.format(new Date(n < 1e12 ? n * 1000 : n));
}

// bars: [{t,o,h,l,c,v}] or column arrays {t,o,h,l,c,v}. Returns columns with
// bad rows dropped (no close) and missing o/h/l filled from the close.
export function toColumns(bars) {
  const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
  const push = (t, o, h, l, c, v) => {
    const d = barDate(t);
    if (!d || !fin(c) || c <= 0) return;
    // Out-of-order or repeated dates are dropped (the first bar of a date wins).
    if (out.t.length && d <= out.t[out.t.length - 1]) return;
    out.t.push(d); out.c.push(c);
    out.o.push(fin(o) && o > 0 ? o : c);
    out.h.push(fin(h) && h > 0 ? Math.max(h, c) : c);
    out.l.push(fin(l) && l > 0 ? Math.min(l, c) : c);
    out.v.push(fin(v) && v >= 0 ? v : null);
  };
  if (Array.isArray(bars)) for (const b of bars) push(b?.t ?? b?.date, Number(b?.o), Number(b?.h), Number(b?.l), Number(b?.c), b?.v == null ? null : Number(b.v));
  else if (bars && Array.isArray(bars.t)) for (let i = 0; i < bars.t.length; i++) push(bars.t[i], Number(bars.o?.[i]), Number(bars.h?.[i]), Number(bars.l?.[i]), Number(bars.c?.[i]), bars.v?.[i] == null ? null : Number(bars.v[i]));
  return out;
}

function rollingMean(a, n) {
  const out = new Array(a.length).fill(null);
  let sum = 0, cnt = 0;
  for (let i = 0; i < a.length; i++) {
    if (fin(a[i])) { sum += a[i]; cnt++; }
    if (i >= n) { const d = a[i - n]; if (fin(d)) { sum -= d; cnt--; } }
    if (i >= n - 1 && cnt === n) out[i] = sum / n;
  }
  return out;
}
function rollingStd(a, n) {
  const out = new Array(a.length).fill(null);
  let s = 0, s2 = 0, cnt = 0;
  for (let i = 0; i < a.length; i++) {
    if (fin(a[i])) { s += a[i]; s2 += a[i] * a[i]; cnt++; }
    if (i >= n) { const d = a[i - n]; if (fin(d)) { s -= d; s2 -= d * d; cnt--; } }
    if (i >= n - 1 && cnt === n) { const m = s / n; out[i] = Math.sqrt(Math.max(0, s2 / n - m * m)); }
  }
  return out;
}
// Rolling max (sign = 1) or min (sign = -1) over the last n values, O(n).
function rollingExt(a, n, sign) {
  const out = new Array(a.length).fill(null), dq = [];
  for (let i = 0; i < a.length; i++) {
    while (dq.length && dq[0] <= i - n) dq.shift();
    while (dq.length && sign * a[dq[dq.length - 1]] <= sign * a[i]) dq.pop();
    dq.push(i);
    if (i >= n - 1) out[i] = a[dq[0]];
  }
  return out;
}
function wilderRsi(c, n) {
  const out = new Array(c.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = d > 0 ? d : 0, dn = d < 0 ? -d : 0;
    if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
    if (i >= n) out[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
  }
  return out;
}
function wilderAtr(S, n) {
  const out = new Array(S.c.length).fill(null);
  let atr = 0;
  for (let i = 1; i < S.c.length; i++) {
    const tr = Math.max(S.h[i] - S.l[i], Math.abs(S.h[i] - S.c[i - 1]), Math.abs(S.l[i] - S.c[i - 1]));
    if (i <= n) atr += tr / n; else atr = (atr * (n - 1) + tr) / n;
    if (i >= n) out[i] = atr;
  }
  return out;
}

// Every rolling array for one symbol.
export function precompute(bars) {
  const S = toColumns(bars);
  const n = S.c.length, c = S.c;
  const lr = new Array(n).fill(null);
  for (let i = 1; i < n; i++) lr[i] = Math.log(c[i] / c[i - 1]);
  const sd20 = rollingStd(c, 20), sma20 = rollingMean(c, 20);
  const bbw = sma20.map((m, i) => (m && sd20[i] != null ? (4 * sd20[i]) / m : null));
  // Rank of today's band width inside its last 126 readings (0 = tightest).
  const bbwRank = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (bbw[i] == null || i < 60) continue;
    let below = 0, cnt = 0;
    for (let j = Math.max(0, i - 125); j <= i; j++) { if (bbw[j] == null) continue; cnt++; if (bbw[j] < bbw[i]) below++; }
    if (cnt >= 40) bbwRank[i] = below / cnt;
  }
  const rv20 = rollingStd(lr.map((x) => (x == null ? 0 : x)), 20).map((x, i) => (x != null && i >= 20 ? x * Math.sqrt(252) : null));
  const rv60 = rollingStd(lr.map((x) => (x == null ? 0 : x)), 60).map((x, i) => (x != null && i >= 60 ? x * Math.sqrt(252) : null));
  const vol = S.v.map((x) => (fin(x) ? x : null));
  return {
    S, n,
    sma5: rollingMean(c, 5), sma10: rollingMean(c, 10), sma20, sma50: rollingMean(c, 50), sma100: rollingMean(c, 100), sma200: rollingMean(c, 200),
    sd20, atr: wilderAtr(S, 14), rsi14: wilderRsi(c, 14), rsi2: wilderRsi(c, 2),
    hi20: rollingExt(S.h, 20, 1), lo20: rollingExt(S.l, 20, -1), hi55: rollingExt(S.h, 55, 1), lo55: rollingExt(S.l, 55, -1),
    hi252: rollingExt(S.h, 252, 1), lo252: rollingExt(S.l, 252, -1), lo5: rollingExt(S.l, 5, -1), hi5: rollingExt(S.h, 5, 1),
    vavg20: rollingMean(vol, 20), bbw, bbwRank, rv20, rv60,
  };
}

// The feature row at bar i (default: the last bar). Null when there is too
// little history for the core reads (60 bars).
export function featAt(P, i = P.n - 1) {
  if (!P || i < 60 || i >= P.n) return null;
  const { S } = P, c = S.c[i], pc = S.c[i - 1], atr = P.atr[i];
  if (!(c > 0) || !(pc > 0) || !(atr > 0)) return null;
  const ret = (k) => (i - k >= 0 && S.c[i - k] > 0 ? c / S.c[i - k] - 1 : null);
  let up = 0, down = 0;
  for (let j = i; j > 0 && S.c[j] > S.c[j - 1]; j--) up++;
  for (let j = i; j > 0 && S.c[j] < S.c[j - 1]; j--) down++;
  const range = S.h[i] - S.l[i];
  const vavgPrev = P.vavg20[i - 1];
  const rsi2 = P.rsi2[i], r2a = P.rsi2[i - 1], r2b = P.rsi2[i - 2];
  const min3 = [rsi2, r2a, r2b].filter(fin), sd = P.sd20[i];
  return {
    i, date: S.t[i], c, o: S.o[i], h: S.h[i], l: S.l[i], v: S.v[i], pc,
    ret1: ret(1), ret3: ret(3), ret5: ret(5), ret10: ret(10), ret21: ret(21), ret63: ret(63), ret126: ret(126), ret252: ret(252),
    sma5: P.sma5[i], sma10: P.sma10[i], sma20: P.sma20[i], sma50: P.sma50[i], sma100: P.sma100[i], sma200: P.sma200[i],
    sma50Prev: i >= 10 ? P.sma50[i - 10] : null, sma200Prev: i >= 21 ? P.sma200[i - 21] : null,
    sd20: sd, z20: sd > 0 && P.sma20[i] ? (c - P.sma20[i]) / sd : null,
    atr, atrPct: atr / c, rsi14: P.rsi14[i], rsi2,
    rsi2Min3: min3.length ? Math.min(...min3) : null, rsi2Max3: min3.length ? Math.max(...min3) : null,
    hi20p: P.hi20[i - 1], lo20p: P.lo20[i - 1], hi55p: P.hi55[i - 1], lo55p: P.lo55[i - 1],
    hi252: P.hi252[i], lo252: P.lo252[i], lo5: P.lo5[i], hi5: P.hi5[i],
    bbw: P.bbw[i], bbwRank: P.bbwRank[i], bbwRankPrev: P.bbwRank[i - 1],
    volRatio: fin(S.v[i]) && vavgPrev > 0 ? S.v[i] / vavgPrev : null,
    rv20: P.rv20[i], rv60: P.rv60[i],
    upStreak: up, downStreak: down,
    rangePos: range > 0 ? (c - S.l[i]) / range : 0.5,
    gap: S.o[i] / pc - 1, dayAtr: (c - pc) / atr,
    move3Atr: i >= 3 ? (c - S.c[i - 3]) / atr : null, move5Atr: i >= 5 ? (c - S.c[i - 5]) / atr : null,
    distHi252: P.hi252[i] ? c / P.hi252[i] - 1 : null,
  };
}

// Month-end closes as of a decision during `today`, read from bars through i
// (the prior close): the last bar of every calendar month that has ended.
// A bar is a month-end when the next bar is in a later month, or, for the
// newest bar, when `today` is already in a later month. Returns the last
// `count` of them, oldest first: [{ m: "YYYY-MM", d: date, c: close }].
// The core engines (lib/engines/core.mjs) read their monthly signals here.
export function monthEnds(P, i = P.n - 1, today = null, count = 14) {
  if (!P || i < 0 || i >= P.n) return [];
  const t = P.S.t;
  if (!P._me) { const me = []; for (let j = 0; j + 1 < P.n; j++) if (t[j].slice(0, 7) !== t[j + 1].slice(0, 7)) me.push(j); P._me = me; }
  const me = P._me;
  // Month-ends strictly before bar i (their next bar is visible).
  let lo = 0, hi = me.length - 1, k = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (me[mid] < i) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  const idx = me.slice(Math.max(0, k - count + 1), k + 1);
  // Bar i itself closes its month when today is in a later month.
  if (today && t[i].slice(0, 7) < String(today).slice(0, 7)) { idx.push(i); if (idx.length > count) idx.shift(); }
  return idx.map((j) => ({ m: t[j].slice(0, 7), d: t[j], c: P.S.c[j] }));
}

// Index of the last bar dated on or before `date` (binary search), or -1.
export function indexAtOrBefore(P, date) {
  const t = P.S.t;
  let lo = 0, hi = t.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (t[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

export const trendUp = (f) => !!f && f.sma50 != null && f.sma200 != null && f.c > f.sma50 && f.sma50 > f.sma200 && f.sma50Prev != null && f.sma50 > f.sma50Prev;
export const trendDown = (f) => !!f && f.sma50 != null && f.sma200 != null && f.c < f.sma50 && f.sma50 < f.sma200 && f.sma50Prev != null && f.sma50 < f.sma50Prev;
