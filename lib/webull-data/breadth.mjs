// Webull whole-market breadth log (build D, 2026-11-19).
//
// Once a day after the close the job (jobs/webull-breadth.mjs) reads Webull's
// screener endpoints (paper keys, official OpenAPI only):
//   - market sectors   GET /market-data/screeners/market-sectors/list
//     (advanced / declined / flat per sector; summed for the whole market)
//   - sector detail    GET /market-data/screeners/market-sectors/get
//     (every stock in a sector with its day's change, paged; bucketed into
//     the breadth chart's % change buckets)
//   - 52-week highs/lows GET /market-data/screeners/week52-high-low/list
//     (NEW_HIGH / NEW_LOW / NEAR_HIGH / NEAR_LOW, top 200 rows each)
//   - gainers / losers GET /market-data/screeners/gainers-losers/list
//     (DAY_1, top 200 by change, DESC and ASC)
//   - most active      GET /market-data/screeners/top-actives/list (top 200)
// Docs: https://developer.webull.com/apis/docs/reference/ (get-market-sectors,
// get-market-sectors-detail, get-week-52-high-low, get-gainers-losers,
// top-actives). The lists stop at 200 rows, so a count of exactly 200 is
// "200 or more" (`capped`), never logged as a full count. "Flat" includes
// names that did not trade that day, so the advance share is read over
// advancers plus decliners only.
//
// Owner-only (Webull's terms of service section 5: no republishing without
// written consent). Context only: nothing here votes in a grade, a pick or
// the Bottom tracker verdict. Pure functions.

export const BREADTH_KEY = "webull-breadth.json";
export const BREADTH_VERSION = 1;
export const BREADTH_MAX_SESSIONS = 400;
export const LIST_CAP = 200;          // rows the screener endpoints return at most
export const LIST_KEEP = 50;          // rows kept per list for the Owner page
// The breadth chart's buckets (the Webull app widget's): % change ranges.
export const BUCKETS = Object.freeze([
  { id: "dn10", label: "≤ -10%" }, { id: "dn5", label: "-10 to -5%" }, { id: "dn2", label: "-5 to -2%" },
  { id: "dn0", label: "-2 to 0%" }, { id: "flat", label: "0%" }, { id: "up0", label: "0 to 2%" },
  { id: "up2", label: "2 to 5%" }, { id: "up5", label: "5 to 10%" }, { id: "up10", label: "≥ 10%" },
]);
export const LISTS = Object.freeze({
  gainers: { path: "/market-data/screeners/gainers-losers/list", query: { category: "US_STOCK", rank_type: "DAY_1", sort_by: "CHANGE_RATIO", direction: "DESC" }, label: "Top gainers" },
  losers: { path: "/market-data/screeners/gainers-losers/list", query: { category: "US_STOCK", rank_type: "DAY_1", sort_by: "CHANGE_RATIO", direction: "ASC" }, label: "Top losers" },
  // The probe (2026-11-19) got 200 rows with category alone; Webull's default
  // ranking for this list is by volume.
  actives: { path: "/market-data/screeners/top-actives/list", query: { category: "US_STOCK" }, label: "Most active" },
  newHigh: { path: "/market-data/screeners/week52-high-low/list", query: { category: "US_STOCK", rank_type: "NEW_HIGH" }, label: "New 52-week highs" },
  newLow: { path: "/market-data/screeners/week52-high-low/list", query: { category: "US_STOCK", rank_type: "NEW_LOW" }, label: "New 52-week lows" },
  nearHigh: { path: "/market-data/screeners/week52-high-low/list", query: { category: "US_STOCK", rank_type: "NEAR_HIGH" }, label: "Near 52-week highs" },
  nearLow: { path: "/market-data/screeners/week52-high-low/list", query: { category: "US_STOCK", rank_type: "NEAR_LOW" }, label: "Near 52-week lows" },
});
export const SECTORS_PATH = "/market-data/screeners/market-sectors/list";
export const SECTOR_DETAIL_PATH = "/market-data/screeners/market-sectors/get";

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// change_ratio (a decimal, 0.0111 = 1.11%) -> bucket index.
export function bucketOf(changeRatio) {
  const c = num(changeRatio);
  if (c == null) return -1;
  const p = c * 100;
  if (p === 0) return 4;
  if (p <= -10) return 0;
  if (p <= -5) return 1;
  if (p <= -2) return 2;
  if (p < 0) return 3;
  if (p < 2) return 5;
  if (p < 5) return 6;
  if (p < 10) return 7;
  return 8;
}

// The `data` array (and next page key) of a paged screener answer. Some
// answers are a bare array.
export function pageOf(json) {
  if (Array.isArray(json)) return { rows: json, next: null };
  const rows = Array.isArray(json?.data) ? json.data : [];
  const k = json?.pagination_key;
  return { rows, next: typeof k === "string" && k ? k : null };
}

// One market-sectors page -> sector rows.
export function parseSectors(json) {
  const { rows, next } = pageOf(json);
  const sectors = [];
  for (const r of rows) {
    const id = r?.id != null ? String(r.id) : null;
    const adv = int(r?.advanced), dec = int(r?.declined), flat = int(r?.flat);
    if (!id || adv == null || dec == null) continue;
    sectors.push({ id, name: String(r?.name || id).slice(0, 80), adv, dec, flat: flat ?? 0, chg: r2((num(r?.change_ratio) ?? NaN) * 100), mv: num(r?.market_value), vol: num(r?.volume) });
  }
  return { sectors, next };
}

// One sector-detail page -> bucket counts for that page plus the names seen.
export function parseSectorPage(json) {
  const { rows, next } = pageOf(json);
  const counts = new Array(BUCKETS.length).fill(0);
  let n = 0;
  for (const r of rows) {
    const b = bucketOf(r?.change_ratio);
    if (b < 0) continue;
    counts[b] += 1; n += 1;
  }
  return { counts, n, next, rows: rows.length };
}

// A screener list row -> the compact row the Owner page shows.
export function compactRow(r) {
  const s = String(r?.symbol || "").toUpperCase().slice(0, 12);
  if (!s) return null;
  const out = { s, n: String(r?.name || "").slice(0, 60), p: num(r?.price ?? r?.close), c: r2((num(r?.change_ratio) ?? NaN) * 100), v: num(r?.volume), mv: num(r?.market_value) };
  const rv = num(r?.relative_volume_10d); if (rv != null) out.rv = r2(rv);
  const c52 = num(r?.change_ratio_52w); if (c52 != null) out.c52 = r2(c52 * 100);
  const tr = num(r?.turnover_rate); if (tr != null) out.tr = r2(tr * 100);
  return out;
}

export function parseList(json) {
  const { rows } = pageOf(json);
  const list = rows.map(compactRow).filter(Boolean);
  return { n: list.length, capped: list.length >= LIST_CAP, rows: list.slice(0, LIST_KEEP) };
}

export function emptyBreadthFile() {
  return { v: BREADTH_VERSION, key: BREADTH_KEY, updatedAt: null, today: null, history: [] };
}

function emptyDay(date, nowIso) {
  return { date, asOf: nowIso, sectors: {}, buckets: { counts: new Array(BUCKETS.length).fill(0), n: 0, pages: {}, sectorsDone: {} }, lists: {}, errors: {} };
}

// Fold one job record into the file. Record kinds:
//   { kind: "sectors", date, sectors: [...] }
//   { kind: "sector-page", date, sectorId, page, counts, n, last }
//   { kind: "list", date, list: "gainers" | ..., n, capped, rows }
//   { kind: "error", date, part, reason }
export function applyBreadthRecord(file, rec, { nowIso = new Date().toISOString(), max = BREADTH_MAX_SESSIONS } = {}) {
  const f = file && typeof file === "object" && Array.isArray(file.history) ? file : emptyBreadthFile();
  if (!rec || typeof rec.date !== "string") return f;
  if (!f.today || f.today.date !== rec.date) {
    if (f.today && f.today.date > rec.date) return f; // an older day never replaces a newer one
    f.today = emptyDay(rec.date, nowIso);
  }
  const d = f.today;
  d.asOf = nowIso;
  if (rec.kind === "sectors") {
    for (const s of rec.sectors || []) d.sectors[s.id] = s;
  } else if (rec.kind === "sector-page") {
    const k = `${rec.sectorId}:${rec.page}`;
    if (!d.buckets.pages[k]) {
      d.buckets.pages[k] = 1;
      (rec.counts || []).forEach((c, i) => { d.buckets.counts[i] += Number(c) || 0; });
      d.buckets.n += Number(rec.n) || 0;
    }
    if (rec.last) d.buckets.sectorsDone[rec.sectorId] = 1;
  } else if (rec.kind === "list" && LISTS[rec.list]) {
    d.lists[rec.list] = { n: rec.n, capped: !!rec.capped, rows: Array.isArray(rec.rows) ? rec.rows.slice(0, LIST_KEEP) : [] };
  } else if (rec.kind === "error") {
    d.errors[String(rec.part || "unknown").slice(0, 40)] = String(rec.reason || "error").slice(0, 60);
  }
  // Keep the history row for this date current after every record.
  const row = historyRow(d);
  const i = f.history.findIndex((h) => h.date === row.date);
  if (i >= 0) f.history[i] = row; else f.history.push(row);
  f.history.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (f.history.length > max) f.history = f.history.slice(-max);
  f.updatedAt = nowIso;
  return f;
}

// Whole-market totals of a day (summed over sectors).
export function dayTotals(day) {
  const s = Object.values(day?.sectors || {});
  if (!s.length) return null;
  const adv = s.reduce((a, x) => a + x.adv, 0), dec = s.reduce((a, x) => a + x.dec, 0), flat = s.reduce((a, x) => a + (x.flat || 0), 0);
  return { adv, dec, flat, sectors: s.length, advPct: adv + dec > 0 ? r2((adv / (adv + dec)) * 100) : null };
}

// Bucket coverage: complete when every sector's pages were read to the end.
export function bucketCoverage(day) {
  const total = Object.keys(day?.sectors || {}).length;
  const done = Object.keys(day?.buckets?.sectorsDone || {}).length;
  return { done, total, complete: total > 0 && done >= total };
}

function listCount(day, id) {
  const l = day?.lists?.[id];
  return l ? { n: l.n, capped: !!l.capped } : null;
}

export function historyRow(day) {
  const t = dayTotals(day) || {};
  const cov = bucketCoverage(day);
  const row = { date: day.date, adv: t.adv ?? null, dec: t.dec ?? null, flat: t.flat ?? null, advPct: t.advPct ?? null };
  for (const id of ["newHigh", "newLow", "nearHigh", "nearLow"]) {
    const c = listCount(day, id);
    if (c) { row[id] = c.n; if (c.capped) row[`${id}Capped`] = true; }
  }
  if (day.buckets?.n) { row.buckets = day.buckets.counts.slice(); row.bucketsN = day.buckets.n; row.bucketsComplete = cov.complete; }
  return row;
}

// The Owner page view of the file (what the browser draws). Drops the page
// bookkeeping; adds totals and coverage.
export function breadthView(file) {
  const d = file?.today;
  if (!d) return null;
  const totals = dayTotals(d);
  const cov = bucketCoverage(d);
  const sectors = Object.values(d.sectors).sort((a, b) => (b.adv + b.dec) - (a.adv + a.dec));
  return {
    date: d.date, asOf: d.asOf, totals, sectors,
    buckets: { labels: BUCKETS.map((b) => b.label), counts: d.buckets.counts.slice(), n: d.buckets.n, ...cov },
    lists: d.lists, errors: d.errors,
  };
}

// Market shadow gauges as of `beforeDate` (only sessions strictly before it):
//   wbAdv  advancers / (advancers + decliners), %, whole US market
//   wbHL   new 52-week highs minus new lows (left out when either list hit
//          the 200-row cap, since the count is then unknown)
//   wbUp5  share of traded names up 5%+ minus the share down 5%+, % (only
//          from a complete bucket read; untraded "0%" names left out)
// The session must be within maxGapDays calendar days of beforeDate.
export function breadthGauges(file, beforeDate, { maxGapDays = 5 } = {}) {
  const rows = (file?.history || []).filter((h) => h && (!beforeDate || h.date < beforeDate));
  const h = rows[rows.length - 1];
  if (!h) return {};
  if (beforeDate) {
    const gap = (Date.parse(`${beforeDate}T12:00:00Z`) - Date.parse(`${h.date}T12:00:00Z`)) / 86400000;
    if (!(gap >= 0) || gap > maxGapDays) return {};
  }
  const out = {};
  if (h.advPct != null) out.wbAdv = h.advPct;
  if (h.newHigh != null && h.newLow != null && !h.newHighCapped && !h.newLowCapped) out.wbHL = h.newHigh - h.newLow;
  if (Array.isArray(h.buckets) && h.bucketsComplete) {
    const traded = h.buckets.reduce((a, x, i) => (i === 4 ? a : a + x), 0);
    if (traded > 0) out.wbUp5 = r2(((h.buckets[7] + h.buckets[8] - h.buckets[0] - h.buckets[1]) / traded) * 100);
  }
  return out;
}

// One non-voting Bottom tracker context row (lib/bottom-tracker.mjs
// buildBottomContext reads it). Lean: "washout" when decliners swamp
// advancers (advance share 30% or less) or new lows are at least twice new
// highs (50+ lows); "stretched" when the advance share is 70%+ with highs at
// least twice lows; otherwise neutral.
export const BREADTH_CONTEXT = Object.freeze({ washAdvPct: 30, stretchAdvPct: 70, lowsMin: 50 });
export function breadthContextRow(file, asOf = null, T = BREADTH_CONTEXT) {
  const rows = (file?.history || []).filter((h) => h && h.advPct != null && (!asOf || h.date <= asOf));
  const h = rows[rows.length - 1];
  if (!h) return null;
  const hi = h.newHigh, lo = h.newLow;
  const fmt = (n, capped) => (n == null ? "—" : `${n}${capped ? "+" : ""}`);
  const hl = hi != null && lo != null ? `${fmt(hi, h.newHighCapped)} new highs, ${fmt(lo, h.newLowCapped)} new lows` : null;
  const lowsHeavy = lo != null && lo >= T.lowsMin && (hi == null || lo >= 2 * hi);
  const highsHeavy = hi != null && (lo == null || hi >= 2 * lo);
  const lean = h.advPct <= T.washAdvPct || lowsHeavy ? "washout" : h.advPct >= T.stretchAdvPct && highsHeavy ? "stretched" : "neutral";
  return {
    id: "webull-breadth", title: "Whole-market breadth (Webull)",
    value: `${h.adv} up / ${h.dec} down (${Math.round(h.advPct)}% up)`, lean,
    read: lean === "washout" ? "Broad selling" : lean === "stretched" ? "Broad buying" : "Mixed",
    detail: `Every US stock Webull lists, summed over its market sectors${hl ? `; ${hl} (lists stop at 200, so 200+ means at least that many)` : ""}. Broad selling and a pile of new lows tend to come with lows. A different, whole-market source from the S&P 500 + Nasdaq-100 breadth on the heat map.`,
    source: "Webull OpenAPI screeners (Owner only)", asOf: h.date,
  };
}

export function breadthSummary(file) {
  const v = breadthView(file);
  return { sessions: file?.history?.length || 0, lastDate: v?.date || null, bucketsComplete: !!v?.buckets?.complete, lists: Object.keys(v?.lists || {}).length, updatedAt: file?.updatedAt || null };
}
