// Regime Lab: market and stock labels (A1-A10, 2026-11-09).
//
// Two answers each session: how wild is the market (volatility era) and does
// it move in runs or chop (market character). The two combine into one of six
// cells (A8: three characters x two volatility eras). Every label is computed
// only from bars up to the close it is stamped with; a label used for a
// decision on day D is the one computed through the prior close (G1). A
// change counts only after it holds for CONFIRM_SESSIONS sessions, and the
// in-between days are a transition state (A9).
//
// Pure functions, no network, no AI, no clock. Shared by the research runner
// (scripts/regime-lab.mjs), the bake (lib/regime-lab/payload.mjs) and the
// smoke test.

export const REGIME_LAB_VERSION = 1;
export const LABEL_RULES_VERSION = "2026-11-09-grid-v1";
export const ERAS = Object.freeze(["calm", "normal", "elevated", "crisis"]);
export const CHARACTERS = Object.freeze(["up", "down", "chop"]);
export const CELLS = Object.freeze(["up-calm", "up-stressed", "down-calm", "down-stressed", "chop-calm", "chop-stressed"]);
export const CELL_LABELS = Object.freeze({
  "up-calm": "Trending up, calm",
  "up-stressed": "Trending up, stressed",
  "down-calm": "Trending down, calm",
  "down-stressed": "Trending down, stressed",
  "chop-calm": "Choppy, calm",
  "chop-stressed": "Choppy, stressed",
});
export const CONFIRM_SESSIONS = 2;

// Thresholds in one place so the doc, the test and the page agree.
export const THRESHOLDS = Object.freeze({
  vixCalm: 15, vixElevated: 20, vixCrisisTerm: 24, vixCrisis: 30,
  rvRankCalm: 50, rvRankElevated: 80, rvRankCrisis: 95,
  rvAbsCalm: 0.12, rvAbsElevated: 0.25, rvAbsCrisis: 0.40,
  erTrending: 0.30, adxTrending: 20, followTrending: 0.55, qualityTrending: 0.5,
  breadthHi: 65, breadthLo: 35,
  corrMacro: 0.6, corrMixed: 0.4,
  eventHeavyMacro: 2, eventHeavyEarningsPct: 20,
});

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Series math
// ---------------------------------------------------------------------------
export function sma(values, n, end = values.length - 1) {
  if (end + 1 < n || n <= 0) return null;
  let s = 0, k = 0;
  for (let i = end - n + 1; i <= end; i++) { const v = values[i]; if (!Number.isFinite(v)) return null; s += v; k++; }
  return k ? s / k : null;
}

export function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(closes[i] > 0 && closes[i - 1] > 0 ? Math.log(closes[i] / closes[i - 1]) : null);
  return out;
}

// Annualized realized volatility of the last n daily closes ending at `end`.
export function realizedVol(closes, n, end = closes.length - 1) {
  if (end < n) return null;
  const r = [];
  for (let i = end - n + 1; i <= end; i++) {
    if (!(closes[i] > 0) || !(closes[i - 1] > 0)) return null;
    r.push(Math.log(closes[i] / closes[i - 1]));
  }
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, r.length - 1);
  return Math.sqrt(v * 252);
}

// Percentile rank (0-100) of `value` within `history` (past values only).
export function pctRank(value, history) {
  const xs = history.filter((v) => Number.isFinite(v));
  if (!Number.isFinite(value) || xs.length < 20) return null;
  let below = 0, equal = 0;
  for (const x of xs) { if (x < value) below++; else if (x === value) equal++; }
  return Math.round(((below + equal / 2) / xs.length) * 1000) / 10;
}

// Efficiency ratio: net move over total path, 0 (pure chop) to 1 (straight line).
export function efficiencyRatio(closes, n = 20, end = closes.length - 1) {
  if (end < n) return null;
  let path = 0;
  for (let i = end - n + 1; i <= end; i++) {
    if (!(closes[i] > 0) || !(closes[i - 1] > 0)) return null;
    path += Math.abs(closes[i] - closes[i - 1]);
  }
  if (!(path > 0)) return 0;
  return clamp(Math.abs(closes[end] - closes[end - n]) / path, 0, 1);
}

// Share of the last n daily moves whose sign matched the prior day's sign.
// 0.5 is a coin; above it, moves follow through; below it, they reverse.
export function followThrough(closes, n = 40, end = closes.length - 1) {
  if (end < n + 1) return null;
  let same = 0, total = 0;
  for (let i = end - n + 1; i <= end; i++) {
    const a = closes[i] - closes[i - 1], b = closes[i - 1] - closes[i - 2];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) continue;
    total++;
    if (Math.sign(a) === Math.sign(b)) same++;
  }
  return total >= Math.floor(n / 2) ? same / total : null;
}

// Wilder ADX on {h,l,c} bars ending at `end`.
export function adx(bars, n = 14, end = bars.length - 1) {
  if (end < 2 * n) return null;
  let trS = 0, pdmS = 0, ndmS = 0;
  const dx = [];
  for (let i = end - 2 * n + 1; i <= end; i++) {
    const b = bars[i], p = bars[i - 1];
    if (!b || !p || !(b.h >= b.l) || !(p.c > 0)) return null;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    const up = b.h - p.h, dn = p.l - b.l;
    const pdm = up > dn && up > 0 ? up : 0, ndm = dn > up && dn > 0 ? dn : 0;
    const k = i - (end - 2 * n + 1);
    if (k < n) { trS += tr; pdmS += pdm; ndmS += ndm; if (k < n - 1) continue; }
    else { trS = trS - trS / n + tr; pdmS = pdmS - pdmS / n + pdm; ndmS = ndmS - ndmS / n + ndm; }
    if (!(trS > 0)) { dx.push(0); continue; }
    const pdi = (pdmS / trS) * 100, ndi = (ndmS / trS) * 100;
    dx.push(pdi + ndi > 0 ? (Math.abs(pdi - ndi) / (pdi + ndi)) * 100 : 0);
  }
  if (dx.length < n) return null;
  let a = dx.slice(0, n).reduce((s, x) => s + x, 0) / n;
  for (let i = n; i < dx.length; i++) a = (a * (n - 1) + dx[i]) / n;
  return a;
}

// Average pairwise correlation of a set of daily return series over their
// common length, through the equal-weight basket identity (O(N), no pairs):
//   rho = (N^2 var(basket) - sum var_i) / ((sum sd_i)^2 - sum var_i).
export function averageCorrelation(returnsBySym) {
  const list = Object.values(returnsBySym).filter((r) => Array.isArray(r) && r.length >= 10 && r.every((x) => Number.isFinite(x)));
  const N = list.length;
  if (N < 5) return null;
  const T = Math.min(...list.map((r) => r.length));
  const basket = new Array(T).fill(0);
  let sumVar = 0, sumSd = 0;
  for (const r of list) {
    const x = r.slice(r.length - T);
    const m = x.reduce((a, b) => a + b, 0) / T;
    const v = x.reduce((a, b) => a + (b - m) ** 2, 0) / (T - 1);
    sumVar += v; sumSd += Math.sqrt(v);
    for (let i = 0; i < T; i++) basket[i] += x[i] / N;
  }
  const bm = basket.reduce((a, b) => a + b, 0) / T;
  const bv = basket.reduce((a, b) => a + (b - bm) ** 2, 0) / (T - 1);
  const denom = sumSd * sumSd - sumVar;
  if (!(denom > 0)) return null;
  return clamp((N * N * bv - sumVar) / denom, -1, 1);
}

// Cross-sectional standard deviation of the names' n-day returns (dispersion).
export function dispersion(nDayReturns) {
  const xs = nDayReturns.filter((v) => Number.isFinite(v));
  if (xs.length < 5) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

// ---------------------------------------------------------------------------
// A1 Volatility era
// ---------------------------------------------------------------------------
export function volatilityEra({ vix = null, vix3m = null, rv20 = null, rvRankPct = null } = {}) {
  const T = THRESHOLDS;
  const v = num(vix), v3 = num(vix3m), rv = num(rv20), rank = num(rvRankPct);
  const termRatio = v != null && v3 > 0 ? v / v3 : null;
  const inverted = termRatio != null && termRatio >= 1;
  let era, why;
  if (v != null) {
    if (v >= T.vixCrisis || (inverted && v >= T.vixCrisisTerm)) { era = "crisis"; why = v >= T.vixCrisis ? `VIX ${v.toFixed(1)} at or above ${T.vixCrisis}` : `VIX ${v.toFixed(1)} with the term structure inverted`; }
    else if (v >= T.vixElevated || inverted || (rank != null && rank >= T.rvRankElevated)) { era = "elevated"; why = v >= T.vixElevated ? `VIX ${v.toFixed(1)} at or above ${T.vixElevated}` : inverted ? "VIX above its 3-month" : `SPY realized vol in its top ${100 - T.rvRankElevated}%`; }
    else if (v < T.vixCalm && (rank == null || rank <= T.rvRankCalm)) { era = "calm"; why = `VIX ${v.toFixed(1)} under ${T.vixCalm}`; }
    else { era = "normal"; why = `VIX ${v.toFixed(1)}`; }
  } else if (rank != null) {
    era = rank >= T.rvRankCrisis ? "crisis" : rank >= T.rvRankElevated ? "elevated" : rank <= 35 ? "calm" : "normal";
    why = `SPY realized vol rank ${rank.toFixed(0)} (no VIX)`;
  } else if (rv != null) {
    era = rv >= T.rvAbsCrisis ? "crisis" : rv >= T.rvAbsElevated ? "elevated" : rv < T.rvAbsCalm ? "calm" : "normal";
    why = `SPY 20-day realized vol ${(rv * 100).toFixed(0)}% (no VIX, no history)`;
  } else {
    return { era: null, stressed: null, why: "no volatility input", inputs: { vix: v, vix3m: v3, termRatio: null, rv20: rv, rvRankPct: rank } };
  }
  return { era, stressed: era === "elevated" || era === "crisis", why, inputs: { vix: r2(v), vix3m: r2(v3), termRatio: r3(termRatio), rv20: r3(rv), rvRankPct: rank } };
}

// ---------------------------------------------------------------------------
// A2 Trend state: indexes vs their 50/200-day averages plus breadth.
// ---------------------------------------------------------------------------
export function trendState({ indexes = {}, breadth50 = null } = {}) {
  const T = THRESHOLDS;
  const votes = {};
  let sum = 0, n = 0;
  for (const [name, ix] of Object.entries(indexes)) {
    const c = num(ix?.close), s50 = num(ix?.sma50), s200 = num(ix?.sma200);
    if (c == null || s50 == null) continue;
    let v = 0;
    if (s200 != null) v = c > s50 && c > s200 ? 1 : c < s50 && c < s200 ? -1 : 0;
    else v = c > s50 ? 1 : c < s50 ? -1 : 0;
    votes[name] = v; sum += v; n++;
  }
  const b = num(breadth50);
  if (b != null) { const v = b >= T.breadthHi ? 1 : b <= T.breadthLo ? -1 : 0; votes.breadth = v; sum += v; n++; }
  if (!n) return { state: null, votes, sum: 0 };
  const state = sum >= 2 || (n <= 2 && sum === n && n > 0) ? "up" : sum <= -2 || (n <= 2 && sum === -n && n > 0) ? "down" : "mixed";
  return { state, votes, sum, breadth50: b };
}

// ---------------------------------------------------------------------------
// A3 Trend quality: does today's direction tend to continue?
// ---------------------------------------------------------------------------
export function trendQuality(bars, end = bars.length - 1) {
  const closes = bars.map((b) => (b && Number.isFinite(b.c) ? b.c : NaN));
  const er = efficiencyRatio(closes, 20, end);
  const follow = followThrough(closes, 40, end);
  const a = adx(bars, 14, end);
  if (er == null && follow == null && a == null) return { quality: null, trending: null, er: null, follow: null, adx: null, direction: null };
  const parts = [];
  if (er != null) parts.push([0.5, clamp(er / 0.4, 0, 1)]);
  if (follow != null) parts.push([0.25, clamp((follow - 0.45) / 0.2, 0, 1)]);
  if (a != null) parts.push([0.25, clamp((a - 12) / 20, 0, 1)]);
  const w = parts.reduce((s, [k]) => s + k, 0);
  const quality = w > 0 ? parts.reduce((s, [k, v]) => s + k * v, 0) / w : null;
  const trending = quality != null ? quality >= THRESHOLDS.qualityTrending : null;
  const c = closes[end], c20 = closes[end - 20];
  const direction = Number.isFinite(c) && Number.isFinite(c20) ? (c > c20 ? "up" : c < c20 ? "down" : "flat") : null;
  return { quality: r3(quality), trending, er: r3(er), follow: r3(follow), adx: a != null ? r2(a) : null, direction };
}

// Market character from trend quality and trend state. A trending market
// takes its direction from the 20-day move unless the 50/200-day state
// clearly disagrees; anything that does not trend is chop.
export function marketCharacter(quality, state) {
  if (!quality || quality.trending == null) return { character: null, why: "no bars" };
  if (!quality.trending) return { character: "chop", why: `efficiency ${quality.er ?? "—"}, ADX ${quality.adx ?? "—"}: moves do not carry` };
  let dir = quality.direction;
  if (state?.state === "up" && dir !== "down") dir = "up";
  if (state?.state === "down" && dir !== "up") dir = "down";
  if (dir === "up") return { character: "up", why: `efficiency ${quality.er}, ADX ${quality.adx}, 20-day move up` };
  if (dir === "down") return { character: "down", why: `efficiency ${quality.er}, ADX ${quality.adx}, 20-day move down` };
  return { character: "chop", why: "trending by quality but no direction" };
}

// ---------------------------------------------------------------------------
// A4 Correlation and spread
// ---------------------------------------------------------------------------
export function correlationState(returnsBySym, nDayReturns = null) {
  const avg = averageCorrelation(returnsBySym);
  const disp = nDayReturns ? dispersion(nDayReturns) : null;
  const T = THRESHOLDS;
  const regime = avg == null ? null : avg >= T.corrMacro ? "macro" : avg >= T.corrMixed ? "mixed" : "stock-picking";
  return { avgCorr: r3(avg), dispersion: r3(disp), regime, n: Object.keys(returnsBySym || {}).length };
}

// ---------------------------------------------------------------------------
// A7 Event load over the next `sessions` trading sessions.
// ---------------------------------------------------------------------------
export function eventLoad({ macroEvents = [], earningsDates = [], universeSize = 85, sessionDates = [], today = null, sessions = 5 } = {}) {
  const horizon = sessionDates.filter((d) => today == null || d > today).slice(0, sessions);
  const last = horizon.length ? horizon[horizon.length - 1] : null;
  const inWindow = (d) => DATE_RE.test(String(d || "")) && (today == null || d > today) && (last == null || d <= last);
  const macro = macroEvents.filter((e) => inWindow(e?.date || e)).map((e) => ({ label: e?.label || "macro", date: e?.date || e }));
  const earnings = earningsDates.filter((d) => inWindow(d)).length;
  const earningsPct = universeSize > 0 ? Math.round((earnings / universeSize) * 1000) / 10 : null;
  const T = THRESHOLDS;
  const heavy = macro.length >= T.eventHeavyMacro || (earningsPct != null && earningsPct >= T.eventHeavyEarningsPct) || (macro.length >= 1 && earningsPct != null && earningsPct >= T.eventHeavyEarningsPct / 2);
  const light = macro.length === 0 && (earningsPct == null || earningsPct < 5);
  return { level: heavy ? "heavy" : light ? "light" : "normal", macro: macro.length, macroEvents: macro.slice(0, 6), earnings, earningsPct, sessions: horizon.length, through: last };
}

// ---------------------------------------------------------------------------
// A8 The combined cell
// ---------------------------------------------------------------------------
export function combinedCell(era, character) {
  if (!era || !character) return null;
  const ch = character === "up" || character === "down" ? character : "chop";
  const stressed = era === "elevated" || era === "crisis";
  return `${ch}-${stressed ? "stressed" : "calm"}`;
}

// ---------------------------------------------------------------------------
// A10 Stock-level label from its own bars.
// ---------------------------------------------------------------------------
export function stockLabel(bars, end = bars.length - 1) {
  const q = trendQuality(bars, end);
  if (q.trending == null) return { label: null, direction: null, quality: null, er: null, adx: null, follow: null, rv20: null };
  const closes = bars.map((b) => b.c);
  const rv20 = realizedVol(closes, 20, end);
  return { label: q.trending ? "trending" : "choppy", direction: q.direction, quality: q.quality, er: q.er, adx: q.adx, follow: q.follow, rv20: r3(rv20) };
}

// ---------------------------------------------------------------------------
// A9 Switch rule. `raw` is [{ date, cell }] in date order. A new cell becomes
// the label after `confirm` consecutive sessions; the sessions in between are
// a transition. Returns rows plus flip statistics. `lagDays` on a switch row
// is how many sessions after the raw flip the label caught up.
// ---------------------------------------------------------------------------
export function confirmLabels(raw, { confirm = CONFIRM_SESSIONS } = {}) {
  const rows = [];
  let label = null, pendingCell = null, pendingSince = -1, pendingCount = 0, lastSwitch = -1, flips = 0, rawFlips = 0, transitionDays = 0;
  const lags = [];
  for (let i = 0; i < raw.length; i++) {
    const cell = raw[i]?.cell || null;
    if (i > 0 && cell !== (raw[i - 1]?.cell || null)) rawFlips++;
    let transition = false, switched = false, lag = null;
    if (label == null) { label = cell; lastSwitch = i; }
    else if (cell && cell !== label) {
      if (cell === pendingCell) pendingCount++; else { pendingCell = cell; pendingSince = i; pendingCount = 1; }
      if (pendingCount >= confirm) { label = cell; switched = true; flips++; lag = i - pendingSince; lags.push(lag); lastSwitch = i; pendingCell = null; pendingCount = 0; }
      else { transition = true; transitionDays++; }
    } else { pendingCell = null; pendingCount = 0; }
    rows.push({ date: raw[i]?.date || null, raw: cell, cell: label, transition, switched, lagDays: lag, daysSinceSwitch: lastSwitch >= 0 ? i - lastSwitch : null });
  }
  const years = raw.length / 252;
  return {
    rows,
    stats: {
      sessions: raw.length, flips, rawFlips,
      flipsPerYear: years > 0 ? r2(flips / years) : null, rawFlipsPerYear: years > 0 ? r2(rawFlips / years) : null,
      avgLagDays: lags.length ? r2(lags.reduce((a, b) => a + b, 0) / lags.length) : null,
      transitionShare: raw.length ? r3(transitionDays / raw.length) : null,
      confirm,
    },
  };
}

// Days late against hindsight: a centered reading of the same cells (the raw
// cell that holds for `confirm` sessions, known on its first day). RESEARCH
// ONLY: the centered series is marked so the harness refuses it (G1).
export function hindsightLag(raw, confirmed, { confirm = CONFIRM_SESSIONS } = {}) {
  const lateDays = [];
  for (let i = 0; i + confirm <= raw.length; i++) {
    const cell = raw[i]?.cell;
    if (!cell || (i > 0 && raw[i - 1]?.cell === cell)) continue;
    let holds = true;
    for (let k = 1; k < confirm; k++) if (raw[i + k]?.cell !== cell) { holds = false; break; }
    if (!holds) continue;
    // The hindsight segmentation knows the switch on day i; find when the
    // confirmed series shows it.
    let j = i;
    while (j < confirmed.length && confirmed[j]?.cell !== cell) j++;
    if (j < confirmed.length) lateDays.push(j - i);
  }
  return { centered: true, switches: lateDays.length, avgLateDays: lateDays.length ? r2(lateDays.reduce((a, b) => a + b, 0) / lateDays.length) : null };
}

// ---------------------------------------------------------------------------
// One session's label from a prepared view of the market. Every input is a
// value known at that session's close.
// ---------------------------------------------------------------------------
export function labelMarketDay(view = {}) {
  const era = volatilityEra(view.vol || {});
  const state = trendState({ indexes: view.indexes || {}, breadth50: view.breadth50 ?? null });
  const quality = view.quality || (Array.isArray(view.spyBars) ? trendQuality(view.spyBars) : null);
  const character = marketCharacter(quality, state);
  const cell = combinedCell(era.era, character.character);
  return {
    date: view.date || null, cell, era: era.era, stressed: era.stressed, character: character.character,
    trendState: state.state, quality: quality ? { quality: quality.quality, er: quality.er, follow: quality.follow, adx: quality.adx, direction: quality.direction } : null,
    why: { era: era.why, character: character.why },
    inputs: { ...era.inputs, breadth50: state.breadth50 ?? null, trendVotes: state.votes },
    corr: view.corr || null, eventLoad: view.eventLoad || null, cycle: view.cycle || null, leadership: view.leadership || null,
  };
}

// ---------------------------------------------------------------------------
// A label series over a trading calendar from aligned arrays. Each entry of
// `aligned.<name>` is the close on cal[i] or null. The label at index i uses
// only indexes <= i, so a decision on cal[i+1] may read row i (G1).
//   spyBars: [{h,l,c}] aligned to cal (for ADX)
//   vix, vix3m: aligned closes (may be null before 2007 for VIX3M)
//   indexes: { SPY: closes, QQQ: closes, RSP: closes }   (aligned)
//   breadth50: aligned share of names above their 50-day (optional)
//   members: { SYM: aligned closes } for the correlation read (optional)
// ---------------------------------------------------------------------------
export function buildLabelSeries({ cal, spyBars, vix = null, vix3m = null, indexes = {}, breadth50 = null, members = null, macroEvents = null, earningsDates = null, start = 0, confirm = CONFIRM_SESSIONS, corrEvery = 5 } = {}) {
  if (!Array.isArray(cal) || !Array.isArray(spyBars) || spyBars.length !== cal.length) throw new Error("buildLabelSeries needs cal and spyBars of equal length");
  const spyCloses = spyBars.map((b) => (b && Number.isFinite(b.c) ? b.c : NaN));
  const rvHist = [];
  const raw = [];
  const details = [];
  const indexCloses = Object.entries(indexes).filter(([, arr]) => Array.isArray(arr) && arr.length === cal.length);
  const memberKeys = members ? Object.keys(members).filter((k) => Array.isArray(members[k]) && members[k].length === cal.length) : [];
  let lastCorr = null;
  for (let i = 0; i < cal.length; i++) {
    const rv20 = i >= 20 ? realizedVol(spyCloses, 20, i) : null;
    const rank = rv20 != null ? pctRank(rv20, rvHist) : null;
    if (rv20 != null) { rvHist.push(rv20); if (rvHist.length > 252) rvHist.shift(); }
    if (i < start || i < 60) { raw.push({ date: cal[i], cell: null }); details.push(null); continue; }
    const ix = {};
    for (const [name, closes] of indexCloses) {
      if (!Number.isFinite(closes[i])) continue;
      ix[name] = { close: closes[i], sma50: sma(closes, 50, i), sma200: i >= 199 ? sma(closes, 200, i) : null };
    }
    let corr = lastCorr;
    if (memberKeys.length && (i % corrEvery === 0 || lastCorr == null) && i >= 21) {
      const rets = {}, r20 = [];
      for (const k of memberKeys) {
        const c = members[k];
        const r = [];
        for (let j = i - 19; j <= i; j++) { if (!(c[j] > 0) || !(c[j - 1] > 0)) { r.length = 0; break; } r.push(Math.log(c[j] / c[j - 1])); }
        if (r.length === 20) { rets[k] = r; r20.push(c[i] / c[i - 20] - 1); }
      }
      corr = correlationState(rets, r20);
      lastCorr = corr;
    }
    const ev = macroEvents || earningsDates ? eventLoad({ macroEvents: macroEvents || [], earningsDates: earningsDates || [], universeSize: memberKeys.length || 85, sessionDates: cal.slice(i + 1, i + 8), today: cal[i] }) : null;
    const row = labelMarketDay({
      date: cal[i],
      vol: { vix: vix ? vix[i] : null, vix3m: vix3m ? vix3m[i] : null, rv20, rvRankPct: rank },
      indexes: ix, breadth50: breadth50 ? breadth50[i] : null, quality: trendQuality(spyBars, i), corr, eventLoad: ev,
    });
    raw.push({ date: cal[i], cell: row.cell });
    details.push(row);
  }
  const confirmed = confirmLabels(raw, { confirm });
  const rows = confirmed.rows.map((r, i) => ({ ...r, era: details[i]?.era || null, character: details[i]?.character || null, detail: details[i] }));
  return { version: LABEL_RULES_VERSION, cal, rows, stats: confirmed.stats, centered: false, hindsight: hindsightLag(raw, confirmed.rows, { confirm }) };
}

// Lookup helpers for a label series: the row for a date, and the row that a
// decision made during `date` may use (the prior session's close, G1).
export function labelIndex(series) {
  const byDate = new Map();
  series.rows.forEach((r, i) => { if (r.date) byDate.set(r.date, i); });
  return {
    at: (date) => { const i = byDate.get(date); return i == null ? null : series.rows[i]; },
    priorClose: (date) => {
      const i = byDate.get(date);
      if (i == null) {
        // A date off the calendar: the last row strictly before it.
        let best = null;
        for (const r of series.rows) { if (r.date && r.date < date) best = r; else if (r.date >= date) break; }
        return best;
      }
      return i > 0 ? series.rows[i - 1] : null;
    },
  };
}
