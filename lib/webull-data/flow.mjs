// Webull capital flow log (build C, 2026-11-19).
//
// Webull's capital flow endpoint (GET /market-data/fundamentals/capital-flows/get,
// https://developer.webull.com/apis/docs/reference/capital-flow.md) returns,
// for one stock and up to the last 5 trading days, the dollar value of large,
// medium and small orders that traded on the buy side ("in") and the sell side
// ("out"). It is the data behind the app's "Order Flow" widget. Webull keeps
// only 5 days, so the only way to ever test it is to log it every day; this
// file keeps our own rolling history.
//
// Owner-only (Webull's data license is for programs, and its terms of service
// section 5 forbid republishing without written consent), research only: the
// grade does not read it. The bake logs three numbers per name as shadow
// inputs (lib/shadow-signals.mjs wfl / wft / wfl5) to test after about three
// months. Pure functions; the job (jobs/webull-flow.mjs) does the calls.

export const FLOW_KEY = "webull-flow.json";
export const FLOW_VERSION = 1;
// About 400 sessions (a year and a half) per name. One row is ~60 bytes, so a
// full file for 80 names is ~2 MB; the stock page reads it once per visit.
export const FLOW_MAX_SESSIONS = 400;
// Column order of each stored row (dollars, rounded to whole dollars).
export const FLOW_COLUMNS = Object.freeze(["date", "largeIn", "largeOut", "mediumIn", "mediumOut", "smallIn", "smallOut"]);

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const DATE8 = /^(\d{4})(\d{2})(\d{2})$/;
const DATE10 = /^\d{4}-\d{2}-\d{2}$/;

// "20261113" -> "2026-11-13"; a YYYY-MM-DD value passes through.
export function flowDate(v) {
  const s = String(v ?? "").trim();
  if (DATE10.test(s)) return s;
  const m = DATE8.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// One response (an array, oldest first, per the docs) -> stored rows, oldest
// first. A row needs a date and all six amounts; anything else is dropped.
// Webull sends amounts as strings, sometimes in exponent form ("1.78E8").
export function parseCapitalFlow(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  const out = new Map();
  for (const r of list) {
    const date = flowDate(r?.date);
    const vals = ["large_in", "large_out", "medium_in", "medium_out", "small_in", "small_out"].map((k) => num(r?.[k]));
    if (!date || vals.some((v) => v == null || v < 0)) continue;
    out.set(date, [date, ...vals.map((v) => Math.round(v))]);
  }
  return [...out.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

export function emptyFlowFile() {
  return { v: FLOW_VERSION, key: FLOW_KEY, updatedAt: null, lastDate: null, columns: FLOW_COLUMNS.slice(), rows: {}, misses: {} };
}

// Upsert one name's rows into the file (a newer read of the same date wins:
// a read after the close replaces an intraday one). Keeps the newest
// FLOW_MAX_SESSIONS rows. Returns the file (mutated in place).
export function mergeFlow(file, sym, rows, { nowIso = new Date().toISOString(), max = FLOW_MAX_SESSIONS } = {}) {
  const f = file && typeof file === "object" && file.rows ? file : emptyFlowFile();
  const byDate = new Map((Array.isArray(f.rows[sym]) ? f.rows[sym] : []).map((r) => [r[0], r]));
  for (const r of rows || []) if (Array.isArray(r) && r.length === FLOW_COLUMNS.length && flowDate(r[0])) byDate.set(r[0], r);
  const merged = [...byDate.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-max);
  if (merged.length) f.rows[sym] = merged;
  if (f.misses) delete f.misses[sym];
  const last = merged.length ? merged[merged.length - 1][0] : null;
  if (last && (!f.lastDate || last > f.lastDate)) f.lastDate = last;
  f.updatedAt = nowIso;
  return f;
}

// A name the API refused (an ETF, a symbol Webull does not know). Logged with
// a fixed reason; the public workflow log never prints the symbol.
export function noteFlowMiss(file, sym, reason, nowIso = new Date().toISOString()) {
  const f = file && typeof file === "object" && file.rows ? file : emptyFlowFile();
  f.misses = f.misses || {};
  f.misses[sym] = { reason: String(reason || "error").slice(0, 40), at: nowIso };
  return f;
}

// Per-session read of one stored row: large, medium, small and all-size net
// (in minus out), the total traded (every in and out), and the large net as a
// share of that total, %.
//
// What the numbers are (checked 2026-11-24 against the Owner's probe sample,
// /mnt/project-files/engine-roadmap/webull-probe-samples): Webull splits each
// session's traded value by order size and by which side started the trade,
// so "in" and "out" are Webull's own buy-side and sell-side estimates, not
// exchange data, and they need not match (NVDA 2026-11-16: $5.4B in, $10.1B
// out). Large net as a share of everything Webull classified swings a lot
// from day to day (NVDA +1.4% on 11-13, -24.1% on 11-16), so a reading of
// 40-50% (AAPL and WMT in the Nov 23 engine run) is within what this measure does, not a
// unit error. Labels say "of the value Webull classified", never "of
// everything traded".
export function flowSession(row) {
  if (!Array.isArray(row)) return null;
  const [date, li, lo, mi, mo, si, so] = row;
  const total = li + lo + mi + mo + si + so;
  if (!(total > 0)) return null;
  const large = li - lo, medium = mi - mo, small = si - so, all = large + medium + small;
  return { date, large, medium, small, all, total, largePct: (large / total) * 100, allPct: (all / total) * 100 };
}

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// The three shadow numbers (and the session date) for one name from its stored rows, read as of
// `beforeDate` (only sessions strictly before it count, so a grade row dated
// D never sees D's own flow): wfl = large net / total traded, latest session,
// %; wft = all-size net / total, same session, %; wfl5 = large net over the
// last five sessions / their total, %. The latest session must be within
// `maxGapDays` calendar days of beforeDate, or nothing is returned (a stale
// log is never logged as today's).
export function flowShadowRow(rows, beforeDate, { maxGapDays = 5 } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => Array.isArray(r) && (!beforeDate || r[0] < beforeDate));
  if (!list.length) return null;
  const last = flowSession(list[list.length - 1]);
  if (!last) return null;
  if (beforeDate) {
    const gap = (Date.parse(`${beforeDate}T12:00:00Z`) - Date.parse(`${last.date}T12:00:00Z`)) / 86400000;
    if (!(gap >= 0) || gap > maxGapDays) return null;
  }
  const five = list.slice(-5).map(flowSession).filter(Boolean);
  const bigNet = five.reduce((s, x) => s + x.large, 0), tot = five.reduce((s, x) => s + x.total, 0);
  // `date` is the session the latest numbers are from (for labels; the
  // shadow log keeps only the three number keys).
  const out = { wfl: r2(last.largePct), wft: r2(last.allPct), date: last.date };
  if (five.length === 5 && tot > 0) out.wfl5 = r2((bigNet / tot) * 100);
  return out;
}

// { SYM: { wfl, wft, wfl5 } } for every name in the file, as of beforeDate.
export function flowShadowRows(file, beforeDate, opts) {
  const out = {};
  for (const [sym, rows] of Object.entries(file?.rows || {})) {
    const r = flowShadowRow(rows, beforeDate, opts);
    if (r) out[sym] = r;
  }
  return out;
}

// Small summary for status lines and the Owner panel.
export function flowSummary(file) {
  const names = Object.keys(file?.rows || {});
  let sessions = 0;
  for (const s of names) sessions = Math.max(sessions, file.rows[s].length);
  return { names: names.length, sessions, lastDate: file?.lastDate || null, misses: Object.keys(file?.misses || {}).length, updatedAt: file?.updatedAt || null };
}
