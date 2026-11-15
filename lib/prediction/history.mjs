// Prediction market odds tracker: how each contract's price history is kept.
//
// Two grids per contract, both compact arrays so ~160 contracts stay well under
// a megabyte:
//   d0 / dv / dq  one value per ET calendar day: the YES chance at 16:00 ET,
//                 the stock market's close. dq holds one character per day:
//                 '1' = read from hourly data or a bake inside 16:00-17:30 ET
//                 (exact enough to line up with that day's stock close),
//                 '0' = from a daily bar only (good for charts and multi-day
//                 windows, not for same-day or next-day tests), '-' = none.
//   h0 / hv       one value per hour for the last HOURLY_KEEP_HOURS, for the
//                 24-hour change and the recent chart.
// Tests read only '1' days (see lib/prediction/reactions.mjs), so a value
// that may include news after the bell is never matched to that day's close.

import { round } from '../crowd/util.mjs';

export const DAILY_KEEP_DAYS = 400;
export const HOURLY_KEEP_HOURS = 24 * 8;
export const CLOSE_WINDOW_MIN = 90; // a bake up to 17:30 ET still counts as the close

const ET_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function etParts(ms) {
  const parts = Object.fromEntries(ET_FMT.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}
export const etDate = (ms) => etParts(ms).date;

// 16:00 ET on an ET calendar date, as epoch ms.
export function etCloseMs(date) {
  for (const utcHour of [20, 21]) {
    const ms = Date.parse(`${date}T${utcHour}:00:00Z`);
    const p = etParts(ms);
    if (p.date === date && p.hour === 16 && p.minute === 0) return ms;
  }
  return Date.parse(`${date}T21:00:00Z`);
}

export function addDays(date, n) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

// ---- daily grid -----------------------------------------------------------

export function dailyAt(c, date) {
  if (!c?.d0 || !Array.isArray(c.dv)) return null;
  const i = daysBetween(c.d0, date);
  if (i < 0 || i >= c.dv.length || c.dv[i] == null) return null;
  return { p: c.dv[i], q: (c.dq || '')[i] === '1' ? 1 : 0 };
}

// precise: true for a value matched to 16:00 ET. A coarse value never
// replaces a precise one.
export function setDaily(c, date, p, precise) {
  if (p == null || !Number.isFinite(p)) return;
  if (!c.d0) { c.d0 = date; c.dv = []; c.dq = ''; }
  let i = daysBetween(c.d0, date);
  if (i < 0) {
    const pad = -i;
    c.dv = Array(pad).fill(null).concat(c.dv);
    c.dq = '-'.repeat(pad) + (c.dq || '');
    c.d0 = date;
    i = 0;
  }
  while (c.dv.length <= i) c.dv.push(null);
  let dq = (c.dq || '').padEnd(c.dv.length, '-');
  if (dq[i] === '1' && !precise) return;
  c.dv[i] = round(p, 4);
  dq = dq.slice(0, i) + (precise ? '1' : '0') + dq.slice(i + 1);
  c.dq = dq;
  trimDaily(c);
}

export function trimDaily(c) {
  if (!Array.isArray(c.dv) || c.dv.length <= DAILY_KEEP_DAYS) return;
  const cut = c.dv.length - DAILY_KEEP_DAYS;
  c.dv = c.dv.slice(cut);
  c.dq = (c.dq || '').slice(cut);
  c.d0 = addDays(c.d0, cut);
}

// [[date, p, q], ...] oldest first, missing days left out.
export function dailySeries(c) {
  const out = [];
  if (!c?.d0 || !Array.isArray(c.dv)) return out;
  for (let i = 0; i < c.dv.length; i += 1) {
    if (c.dv[i] == null) continue;
    out.push([addDays(c.d0, i), c.dv[i], (c.dq || '')[i] === '1' ? 1 : 0]);
  }
  return out;
}

// ---- hourly grid ----------------------------------------------------------

const HOUR = 3600;
export function setHourly(c, tsSec, p, nowSec) {
  if (p == null || !Number.isFinite(p) || !Number.isFinite(tsSec)) return;
  const h = Math.floor(tsSec / HOUR) * HOUR;
  if (nowSec != null && h < nowSec - HOURLY_KEEP_HOURS * HOUR) return;
  if (!c.h0) { c.h0 = h; c.hv = []; }
  let i = Math.round((h - c.h0) / HOUR);
  if (i < 0) {
    c.hv = Array(-i).fill(null).concat(c.hv);
    c.h0 = h;
    i = 0;
  }
  while (c.hv.length <= i) c.hv.push(null);
  c.hv[i] = round(p, 4);
}

export function trimHourly(c, nowSec) {
  if (!c.h0 || !Array.isArray(c.hv)) return;
  const keepFrom = Math.floor(nowSec / HOUR) * HOUR - HOURLY_KEEP_HOURS * HOUR;
  if (c.h0 >= keepFrom) return;
  const cut = Math.round((keepFrom - c.h0) / HOUR);
  c.hv = c.hv.slice(cut);
  c.h0 = keepFrom;
  while (c.hv.length && c.hv[0] == null) { c.hv.shift(); c.h0 += HOUR; }
  if (!c.hv.length) { delete c.h0; delete c.hv; }
}

export function hourlySeries(c) {
  const out = [];
  if (!c?.h0 || !Array.isArray(c.hv)) return out;
  for (let i = 0; i < c.hv.length; i += 1) if (c.hv[i] != null) out.push([c.h0 + i * HOUR, c.hv[i]]);
  return out;
}

// ---- merging fetched history ----------------------------------------------

// Folds [[unixSec, p], ...] (hourly or finer) into both grids. The day's
// value is the last point at or before 16:00 ET (a price stands until it
// trades again), set only for days the points actually span.
export function mergeFine(c, points, nowMs) {
  const pts = (points || []).filter((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1])).sort((a, b) => a[0] - b[0]);
  if (!pts.length) return 0;
  const nowSec = Math.floor(nowMs / 1000);
  for (const [t, p] of pts) setHourly(c, t, p, nowSec);
  const first = etDate(pts[0][0] * 1000), last = etDate(Math.min(pts[pts.length - 1][0] * 1000, nowMs));
  let j = 0, prev = null, n = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const closeSec = etCloseMs(d) / 1000;
    if (closeSec * 1000 > nowMs) break;
    while (j < pts.length && pts[j][0] <= closeSec) { prev = pts[j][1]; j += 1; }
    if (prev != null) { setDaily(c, d, prev, true); n += 1; }
  }
  trimHourly(c, nowSec);
  return n;
}

// Daily bars ([[unixSec, p], ...] at one per day): coarse values only, each
// filed under the ET date its bar ends on.
export function mergeCoarse(c, points) {
  let n = 0;
  for (const [t, p] of points || []) {
    if (!Number.isFinite(t) || !Number.isFinite(p)) continue;
    // A bar ending at 00:00 UTC belongs to the ET evening before.
    setDaily(c, etDate(t * 1000 - 1000), p, false);
    n += 1;
  }
  return n;
}

// A bake's own read of the current price: always an hourly point; also the
// day's close when the bake runs within 16:00-17:30 ET.
export function noteSnapshot(c, ms, p) {
  if (p == null || !Number.isFinite(p)) return;
  setHourly(c, Math.floor(ms / 1000), p, Math.floor(ms / 1000));
  const { date, hour, minute } = etParts(ms);
  const mins = hour * 60 + minute;
  if (mins >= 16 * 60 && mins <= 16 * 60 + CLOSE_WINDOW_MIN) setDaily(c, date, p, true);
  trimHourly(c, Math.floor(ms / 1000));
}

// Change in points (0..100 scale) against the value `days` ago (calendar
// days, falling back up to 3 more days when that one is missing).
export function changeOver(c, nowP, todayEt, days) {
  if (nowP == null) return null;
  for (let back = days; back <= days + 3; back += 1) {
    const v = dailyAt(c, addDays(todayEt, -back));
    if (v) return round((nowP - v.p) * 100, 1);
  }
  return null;
}

export function change24h(c, nowP, nowMs) {
  if (nowP == null || !c?.h0 || !Array.isArray(c.hv)) return null;
  const target = Math.floor(nowMs / 1000) - 24 * HOUR;
  let best = null;
  for (let i = 0; i < c.hv.length; i += 1) {
    const t = c.h0 + i * HOUR;
    if (c.hv[i] == null) continue;
    if (t <= target) best = c.hv[i];
    else break;
  }
  return best != null ? round((nowP - best) * 100, 1) : null;
}

// The last `n` daily values (nulls for gaps), oldest first, for a spark.
export function sparkDaily(c, todayEt, n = 30) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const v = dailyAt(c, addDays(todayEt, -i));
    out.push(v ? Math.round(v.p * 1000) / 10 : null);
  }
  return out;
}
