// Wide tier (2026-11-19, engine roadmap thread 5, user decision): a market-wide
// list of about 530 names that the site watches with rules only, beside the
// ~80 tracked names that get option chains, grades and AI reads.
//
//   members   S&P 500 plus Nasdaq-100 members, from two public lists with their
//             dates (lib/wide-tier-members.json is the committed copy; the
//             bake re-reads both lists at most once every 30 days and keeps
//             the prior list when a read fails or looks wrong), plus the names
//             the user moved out of the tracked list (WIDE_EXTRAS).
//   bars      one daily close + volume per name. The first time a name is seen
//             it gets two years of daily bars from Yahoo's chart (capped per
//             bake). After that the post-close bake adds one bar a day from
//             batched quotes (50 names a call) and corrects the prior close
//             from the quote's previous close. Tracked names take their bars
//             from the chains the bake already holds (no extra call).
//   payload   wide-tier.json (public): one row per name for the heat map, the
//             sector table (11 SPDR sector funds plus our groups), a short
//             "worth a look" list and breadth (today plus a daily series in
//             the Market map's breadth shape). The hourly heat-map refresh
//             re-marks prices, moves and the summaries from one batched quote
//             pass (refreshWideIntraday).
//
// Rules only: no AI, no grade, no Top Picks or engine field is read or
// written. Kill switch WIDE_TIER=0 (Owner Settings, Data & desks) writes
// { enabled: false } and the hourly refresh then leaves the file alone.
// Pure functions plus two orchestrators that take their network calls as
// arguments, so the smoke test runs offline.

import { buildBreadth } from "./market-map.mjs";
import { previousTradingDate, sessionForDate, etClock } from "./us-equity-calendar.mjs";

export const WIDE_TIER_VERSION = 1;
export const WIDE_TIER_KEY = "wide-tier.json";
export const WIDE_TIER_STATE_KEY = "wide-tier-state.json";

// Moved out of TICKERS on 2026-11-19 (user decision in the engine roadmap
// thread). They stay on the wide map even when no index lists them.
export const WIDE_EXTRAS = Object.freeze(["SMCI", "ASTS", "DIS", "CBRS", "PYPL"]);

// The 11 Select Sector SPDR funds, one per GICS sector (State Street's fund
// list, https://www.ssga.com/us/en/intermediary/etfs/fund-finder). Their own
// bars give the sector table's fund returns.
export const SECTOR_FUNDS = Object.freeze([
  ["XLK", "Information Technology"],
  ["XLC", "Communication Services"],
  ["XLY", "Consumer Discretionary"],
  ["XLP", "Consumer Staples"],
  ["XLV", "Health Care"],
  ["XLF", "Financials"],
  ["XLI", "Industrials"],
  ["XLE", "Energy"],
  ["XLB", "Materials"],
  ["XLU", "Utilities"],
  ["XLRE", "Real Estate"],
]);
export const GICS_SECTORS = Object.freeze(SECTOR_FUNDS.map(([, s]) => s));

// Both share classes of one company sit in the index lists, and Yahoo gives
// each class the whole company's market value, so showing both would count
// the company twice. The map keeps the class named on the right.
export const SECOND_CLASS = Object.freeze({ GOOG: "GOOGL", FOX: "FOXA", NWS: "NWSA" });
const wideUniverse = (members, tracked) => [...new Set([...members.map((m) => m.t), ...WIDE_EXTRAS, ...tracked])].filter((s) => !SECOND_CLASS[s]);

// Yahoo's profile sector names (Morningstar-style) to the matching GICS sector
// name. Used only for names the S&P 500 list doesn't cover (Nasdaq-100-only
// members and the extras), and shown with its source.
export const YAHOO_TO_GICS = Object.freeze({
  "Technology": "Information Technology",
  "Communication Services": "Communication Services",
  "Consumer Cyclical": "Consumer Discretionary",
  "Consumer Defensive": "Consumer Staples",
  "Healthcare": "Health Care",
  "Financial Services": "Financials",
  "Industrials": "Industrials",
  "Energy": "Energy",
  "Basic Materials": "Materials",
  "Utilities": "Utilities",
  "Real Estate": "Real Estate",
});

export const MEMBER_SOURCES = Object.freeze({
  sp500: {
    label: "S&P 500 members, from Wikipedia's 'List of S&P 500 companies' as kept by the datasets/s-and-p-500-companies project (updated from Wikipedia every few days; GICS sector and sub-industry included)",
    url: "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv",
    page: "https://github.com/datasets/s-and-p-500-companies",
  },
  ndx: {
    label: "Nasdaq-100 members, from the n100tickers project's change files, which are checked against Nasdaq's own index data (start-of-day membership by effective date)",
    url: (year) => `https://raw.githubusercontent.com/jmccarrell/n100tickers/main/src/nasdaq_100_ticker_history/n100-ticker-changes-${year}.yaml`,
    page: "https://github.com/jmccarrell/n100tickers",
  },
});

export const WIDE_LIMITS = Object.freeze({
  maxBars: 520,            // about two years of sessions: 250 days of breadth with a 252-day look-back
  minBars: 260,            // fewer stored closes than this and the name is backfilled
  backfillPerRun: 150,     // chart calls per bake (WIDE_BACKFILL_PER_RUN overrides)
  profilesPerRun: 40,      // Yahoo profile reads per bake, for names with no GICS sector
  quoteChunk: 50,          // names per batched quote call (same as the hourly heat-map refresh)
  membersMaxAgeDays: 30,   // the member lists are re-read at most this often
  spMin: 480, spMax: 520,  // a read outside these counts is refused
  ndxMin: 95, ndxMax: 110,
  earningsDays: 10,
  volumeX: 3,              // "3x normal volume"
  worthMax: 20,
  splitJump: 0.25,         // a stored close this far from the quote's previous close means a split or a bad bar: refetch
});

const fin = (v) => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function wideTierEnabled(env = process.env) {
  return String(env?.WIDE_TIER ?? "").trim() !== "0";
}

// Yahoo writes class shares with a dash (BRK-B); the S&P list uses a dot.
export function yahooSymbol(sym) {
  return String(sym || "").trim().toUpperCase().replace(/\./g, "-");
}

// --- member lists -------------------------------------------------------------
function csvLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// datasets/s-and-p-500-companies constituents.csv:
// Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location,Date added,CIK,Founded
export function parseSp500Csv(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const head = csvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const iSym = col("symbol"), iName = col("security"), iSec = col("gics sector"), iInd = col("gics sub-industry");
  if (iSym < 0 || iSec < 0) return [];
  const out = [], seen = new Set();
  for (const line of lines.slice(1)) {
    const c = csvLine(line);
    const raw = String(c[iSym] || "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,6}$/.test(raw)) continue;
    const t = yahooSymbol(raw);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push({ t, n: String(c[iName] || "").trim() || t, sec: String(c[iSec] || "").trim() || null, ind: iInd >= 0 ? (String(c[iInd] || "").trim() || null) : null });
  }
  return out;
}

// n100tickers year file: tickers_on_Jan_1 (a list) and changes keyed by
// effective date, each with union (added) and difference (removed) lists.
// A small reader for exactly that layout; anything else is refused.
export function parseNdxYaml(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  let year = null, section = null, date = null, op = null;
  const start = [], changes = {};
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, "").replace(/^#.*$/, "");
    if (!line.trim() || line.trim() === "---") continue;
    const indent = line.match(/^ */)[0].length;
    const body = line.trim();
    if (indent === 0) {
      const m = body.match(/^([A-Za-z_0-9]+):\s*(.*)$/);
      if (!m) throw new Error(`unexpected line: ${body}`);
      if (m[1] === "year") year = Number(m[2]);
      section = m[1]; date = null; op = null;
      continue;
    }
    if (section === "tickers_on_Jan_1") {
      const m = body.match(/^-\s*([A-Z][A-Z0-9.\-]{0,7})$/);
      if (!m) throw new Error(`unexpected member line: ${body}`);
      start.push(yahooSymbol(m[1]));
      continue;
    }
    if (section === "changes") {
      const d = body.match(/^["']?(\d{4}-\d{2}-\d{2})["']?:$/);
      if (d) { date = d[1]; changes[date] ||= { union: [], difference: [] }; op = null; continue; }
      const o = body.match(/^(union|difference):$/);
      if (o && date) { op = o[1]; continue; }
      const t = body.match(/^-\s*([A-Z][A-Z0-9.\-]{0,7})$/);
      if (t && date && op) { changes[date][op].push(yahooSymbol(t[1])); continue; }
      throw new Error(`unexpected change line: ${body}`);
    }
    throw new Error(`unexpected line in ${section}: ${body}`);
  }
  if (!Number.isInteger(year) || !start.length) throw new Error("no year or no start list");
  return { year, start, changes };
}

// Members on `asOf` (YYYY-MM-DD): the January list with every change whose
// effective date is on or before asOf applied in date order.
export function ndxMembersOn(parsed, asOf) {
  const set = new Set(parsed.start);
  const applied = [];
  for (const date of Object.keys(parsed.changes).sort()) {
    if (date > asOf) break;
    const c = parsed.changes[date];
    for (const t of c.difference) set.delete(t);
    for (const t of c.union) set.add(t);
    applied.push({ date, added: c.union.slice(), removed: c.difference.slice() });
  }
  return { members: [...set].sort(), applied };
}

// One list from both indexes. S&P rows carry GICS sector and sub-industry;
// Nasdaq-100-only rows get theirs from the prior list or, failing that, a
// Yahoo profile read later (profiles in the state).
export function mergeMembers(sp, ndx, prior = []) {
  const priorBy = new Map((prior || []).map((m) => [m.t, m]));
  const by = new Map();
  for (const r of sp) by.set(r.t, { t: r.t, n: r.n, sec: r.sec, ind: r.ind, src: "sp500", idx: "S" });
  for (const t of ndx) {
    const row = by.get(t);
    if (row) row.idx = "SN";
    else {
      const p = priorBy.get(t);
      by.set(t, { t, n: p?.n || t, sec: p?.src === "sp500" ? null : (p?.sec || null), ind: p?.src === "sp500" ? null : (p?.ind || null), src: p?.sec && p?.src !== "sp500" ? p.src : null, idx: "N" });
    }
  }
  return [...by.values()].sort((a, b) => a.t.localeCompare(b.t));
}

// The bake's reader for the two member lists (raw GitHub files, public, no
// key). Called at most twice every 30 days.
export async function fetchWideListText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "stonks-wide-tier/1" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

export function membersAgeDays(members, nowMs) {
  const at = Date.parse(members?.checkedAt || members?.asOf || "");
  return Number.isFinite(at) ? (nowMs - at) / 86400000 : Infinity;
}

// Re-read both lists when the stored copy is older than membersMaxAgeDays.
// fetchText(url) -> string. Any failure, or a count outside the sane range,
// keeps the prior list and records why.
export async function refreshMembers({ prior, nowMs = Date.now(), fetchText, limits = WIDE_LIMITS, force = false, log = () => {} }) {
  const today = etClock(nowMs).date;
  if (!force && prior?.list?.length && membersAgeDays(prior, nowMs) < limits.membersMaxAgeDays) {
    return { members: prior, fetched: 0, refreshed: false };
  }
  if (typeof fetchText !== "function") return { members: prior, fetched: 0, refreshed: false };
  let fetched = 0;
  try {
    const spText = await fetchText(MEMBER_SOURCES.sp500.url); fetched++;
    const sp = parseSp500Csv(spText);
    if (sp.length < limits.spMin || sp.length > limits.spMax) throw new Error(`S&P 500 list has ${sp.length} rows`);
    const year = Number(today.slice(0, 4));
    let ndxParsed = null, ndxYear = year;
    try { ndxParsed = parseNdxYaml(await fetchText(MEMBER_SOURCES.ndx.url(year))); fetched++; }
    catch (err) {
      // Early January the new year's file may not exist yet: use last year's
      // file with all its changes applied.
      fetched++;
      ndxYear = year - 1;
      ndxParsed = parseNdxYaml(await fetchText(MEMBER_SOURCES.ndx.url(ndxYear))); fetched++;
      log(`Nasdaq-100 ${year} file unavailable (${String(err?.message || err).slice(0, 80)}); used ${ndxYear}`);
    }
    const ndx = ndxMembersOn(ndxParsed, ndxYear === year ? today : `${ndxYear}-12-31`);
    if (ndx.members.length < limits.ndxMin || ndx.members.length > limits.ndxMax) throw new Error(`Nasdaq-100 list has ${ndx.members.length} names`);
    const list = mergeMembers(sp, ndx.members, prior?.list || []);
    const lastChange = ndx.applied.length ? ndx.applied[ndx.applied.length - 1] : null;
    return {
      members: {
        asOf: today, checkedAt: new Date(nowMs).toISOString(),
        sources: [
          { id: "sp500", label: MEMBER_SOURCES.sp500.label, url: MEMBER_SOURCES.sp500.page, count: sp.length, read: today },
          { id: "ndx", label: MEMBER_SOURCES.ndx.label, url: MEMBER_SOURCES.ndx.page, count: ndx.members.length, read: today, lastChange: lastChange?.date || null },
        ],
        list,
      },
      fetched, refreshed: true,
    };
  } catch (err) {
    log(`member lists not refreshed, prior list kept: ${String(err?.message || err).slice(0, 160)}`);
    const keep = prior ? { ...prior, checkedAt: new Date(nowMs).toISOString(), lastError: String(err?.message || err).slice(0, 160) } : prior;
    return { members: keep, fetched, refreshed: false, error: String(err?.message || err) };
  }
}

// --- bar store ------------------------------------------------------------------
// Aligned columns: one shared date axis (oldest first, at most maxBars) and,
// per symbol, a close array and a volume array of the same length (null where
// there is no bar).
export function emptyBars() { return { dates: [], c: {}, v: {} }; }

function ensureDate(bars, date) {
  let i = bars.dates.indexOf(date);
  if (i >= 0) return i;
  // Insert in order and widen every column.
  let at = bars.dates.length;
  while (at > 0 && bars.dates[at - 1] > date) at--;
  bars.dates.splice(at, 0, date);
  for (const s of Object.keys(bars.c)) { bars.c[s].splice(at, 0, null); bars.v[s].splice(at, 0, null); }
  return at;
}

export function setBar(bars, sym, date, close, volume) {
  if (!isDate(date) || !(fin(close) > 0)) return false;
  const i = ensureDate(bars, date);
  if (!bars.c[sym]) { bars.c[sym] = new Array(bars.dates.length).fill(null); bars.v[sym] = new Array(bars.dates.length).fill(null); }
  bars.c[sym][i] = Math.round(Number(close) * 10000) / 10000;
  const v = fin(volume);
  if (v != null && v >= 0) bars.v[sym][i] = Math.round(v);
  else if (volume === undefined) { /* keep any stored volume */ }
  return true;
}

export function dropSymbol(bars, sym) { delete bars.c[sym]; delete bars.v[sym]; }

// Keep the newest maxBars dates; drop symbols no longer wanted and dates no
// symbol has a close for.
export function trimBars(bars, keepSyms, maxBars = WIDE_LIMITS.maxBars) {
  const keep = keepSyms ? new Set(keepSyms) : null;
  if (keep) for (const s of Object.keys(bars.c)) if (!keep.has(s)) dropSymbol(bars, s);
  const syms = Object.keys(bars.c);
  const used = bars.dates.map((_, i) => syms.some((s) => bars.c[s][i] != null));
  const idx = bars.dates.map((_, i) => i).filter((i) => used[i]).slice(-maxBars);
  bars.dates = idx.map((i) => bars.dates[i]);
  for (const s of syms) { bars.c[s] = idx.map((i) => bars.c[s][i]); bars.v[s] = idx.map((i) => bars.v[s][i]); }
  return bars;
}

export function barsFor(bars, sym) {
  const c = bars?.c?.[sym], v = bars?.v?.[sym];
  if (!c) return [];
  const out = [];
  for (let i = 0; i < bars.dates.length; i++) if (c[i] != null) out.push({ t: bars.dates[i], c: c[i], v: v?.[i] ?? 0 });
  return out;
}

export function storedCount(bars, sym) {
  const c = bars?.c?.[sym];
  return c ? c.reduce((n, x) => n + (x != null ? 1 : 0), 0) : 0;
}

// Copy the bake's own daily bars for a tracked name (no network).
export function absorbChainBars(bars, sym, chainBars) {
  let n = 0;
  for (const b of chainBars || []) {
    const t = String(b?.t || "").slice(0, 10);
    if (setBar(bars, sym, t, b?.c, b?.v)) n++;
  }
  return n;
}

// --- per-name numbers -----------------------------------------------------------
function shiftDate(dateKey, { days = 0, months = 0, years = 0 } = {}) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  if (days) return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  const mi = y * 12 + (m - 1) + months + years * 12;
  const yy = Math.floor(mi / 12), mm = ((mi % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(yy, mm, Math.min(d, last))).toISOString().slice(0, 10);
}

// Same horizons and baseline rule as the tracked heat map
// (buildHeatmapPerformance in scripts/build.mjs): the last close on or before
// the calendar target; 1W = 7 calendar days back (five sessions).
export function perfFrom(series, endPrice, asOf) {
  const perf = {}, perfStart = {};
  if (!series.length || !(endPrice > 0) || !isDate(asOf)) return { perf, perfStart };
  const targets = { "1w": shiftDate(asOf, { days: -7 }), "1m": shiftDate(asOf, { months: -1 }), "3m": shiftDate(asOf, { months: -3 }), "1y": shiftDate(asOf, { years: -1 }) };
  const at = (target) => { let b = null; for (const r of series) { if (r.t <= target) b = r; else break; } return b; };
  for (const [p, target] of Object.entries(targets)) {
    let b = at(target);
    if (!b && series[0].t > target) {
      const gap = (Date.parse(series[0].t) - Date.parse(target)) / 86400000;
      if (gap >= 0 && gap <= 7) b = series[0];
    }
    if (b && b.c > 0) { perf[p] = r2((endPrice / b.c - 1) * 100); perfStart[p] = b.t; }
  }
  let ytd = null;
  for (const r of series) { if (r.t < `${asOf.slice(0, 4)}-01-01`) ytd = r; else break; }
  if (ytd && ytd.c > 0) { perf.ytd = r2((endPrice / ytd.c - 1) * 100); perfStart.ytd = ytd.t; }
  return { perf, perfStart };
}

// Numbers from the stored daily closes, as of the last stored bar.
// hi52 / lo52 are the highest / lowest close of the 251 sessions BEFORE the
// last bar, so "new 52-week high" means the last close beat them (and the
// hourly refresh can compare a live price with the same levels).
export function seriesStats(series) {
  const n = series.length;
  if (!n) return null;
  const c = series.map((b) => b.c), v = series.map((b) => b.v || 0);
  const last = c[n - 1];
  const avg = (arr, from, to) => { let s = 0, k = 0; for (let i = Math.max(0, from); i < to; i++) if (arr[i] > 0) { s += arr[i]; k++; } return k ? s / k : null; };
  const ma50 = n >= 50 ? avg(c, n - 50, n) : null;
  const ma200 = n >= 200 ? avg(c, n - 200, n) : null;
  let hi = null, lo = null;
  if (n >= 252) { hi = -Infinity; lo = Infinity; for (let i = n - 252; i < n - 1; i++) { if (c[i] > hi) hi = c[i]; if (c[i] < lo) lo = c[i]; } }
  const av50 = n >= 21 ? avg(v, n - 51, n - 1) : null;
  return {
    date: series[n - 1].t,
    close: last,
    prev: n >= 2 ? c[n - 2] : null,
    ch: n >= 2 && c[n - 2] > 0 ? r2((last / c[n - 2] - 1) * 100) : null,
    ma50: ma50 != null ? r2(ma50) : null,
    ma200: ma200 != null ? r2(ma200) : null,
    hi52: hi != null && Number.isFinite(hi) ? r2(hi) : null,
    lo52: lo != null && Number.isFinite(lo) ? r2(lo) : null,
    av50: av50 != null && av50 > 0 ? Math.round(av50) : null,
    rv: av50 > 0 && v[n - 1] > 0 ? r2(v[n - 1] / av50) : null,
  };
}

// --- summaries ------------------------------------------------------------------
const isNewHigh = (r) => r.hi52 > 0 && r.sp > r.hi52;
const isNewLow = (r) => r.lo52 > 0 && r.sp < r.lo52;

function groupStats(rows, name) {
  const periods = ["1d", "1w", "1m", "3m"];
  const out = { name, n: rows.length, ret: {}, above50: null, above200: null, highs: 0, lows: 0, nhnl: null };
  for (const p of periods) {
    let sw = 0, s = 0;
    for (const r of rows) {
      const v = p === "1d" ? r.ch : r.perf?.[p];
      if (v == null || !Number.isFinite(v)) continue;
      const w = r.mc > 0 ? r.mc : 0;
      if (!w) continue;
      sw += w; s += v * w;
    }
    out.ret[p] = sw > 0 ? r2(s / sw) : null;
  }
  let a50 = 0, n50 = 0, a200 = 0, n200 = 0, n52 = 0;
  for (const r of rows) {
    if (r.ma50 > 0 && r.sp > 0) { n50++; if (r.sp > r.ma50) a50++; }
    if (r.ma200 > 0 && r.sp > 0) { n200++; if (r.sp > r.ma200) a200++; }
    if (r.hi52 > 0 && r.lo52 > 0 && r.sp > 0) { n52++; if (isNewHigh(r)) out.highs++; if (isNewLow(r)) out.lows++; }
  }
  out.above50 = n50 ? r1(a50 / n50 * 100) : null;
  out.above200 = n200 ? r1(a200 / n200 * 100) : null;
  out.nhnl = n52 ? out.highs - out.lows : null;
  return out;
}

export function buildSectorTable(rows, funds, ourGroupOrder = []) {
  const stocks = rows.filter((r) => !r.fund);
  const sectors = GICS_SECTORS.map((sec) => {
    const fund = SECTOR_FUNDS.find(([, s]) => s === sec)?.[0];
    const f = funds.find((r) => r.t === fund) || null;
    const g = groupStats(stocks.filter((r) => r.s === sec), sec);
    return { ...g, fund, fundRet: f ? { "1d": f.ch ?? null, "1w": f.perf?.["1w"] ?? null, "1m": f.perf?.["1m"] ?? null, "3m": f.perf?.["3m"] ?? null } : null };
  });
  const unclassified = stocks.filter((r) => !GICS_SECTORS.includes(r.s));
  const ours = ourGroupOrder.map((name) => groupStats(stocks.filter((r) => r.tr && r.g === name), name)).filter((g) => g.n > 0);
  return { sectors, ours, unclassified: unclassified.length };
}

export function buildBreadthToday(rows) {
  const stocks = rows.filter((r) => !r.fund && Number.isFinite(r.ch));
  const g = groupStats(stocks, "all");
  let up = 0, down = 0, flat = 0;
  for (const r of stocks) { if (r.ch > 0.05) up++; else if (r.ch < -0.05) down++; else flat++; }
  return { n: stocks.length, up, down, flat, above50: g.above50, above200: g.above200, highs: g.highs, lows: g.lows, nhnl: g.nhnl, capWeighted: g.ret["1d"] };
}

// Wide names with something happening. Reasons, strongest first: a new 52-week
// closing high, 3x normal volume, unusual option volume (tracked names only,
// from the flow scan), earnings within 10 days. Earnings alone fills a whole
// season, so earnings-only names rank last and the rest are counted.
export function buildWorthALook(rows, { unusual = new Set(), todayIso, limits = WIDE_LIMITS } = {}) {
  const today = isDate(todayIso) ? todayIso : null;
  const end = today ? shiftDate(today, { days: limits.earningsDays }) : null;
  const picks = [];
  let earningsOnlyMore = 0;
  for (const r of rows) {
    if (r.fund) continue;
    const why = [];
    if (isNewHigh(r)) why.push("high");
    if (r.rv != null && r.rv >= limits.volumeX) why.push("volume");
    if (unusual.has(r.t)) why.push("options");
    if (today && isDate(r.er) && r.er >= today && r.er <= end) why.push("earnings");
    if (!why.length) continue;
    const score = (why.includes("high") ? 3 : 0) + (why.includes("volume") ? 3 : 0) + (why.includes("options") ? 2 : 0) + (why.includes("earnings") ? 1 : 0);
    picks.push({ t: r.t, n: r.n, s: r.s, tr: r.tr ? 1 : 0, why, score, ch: r.ch ?? null, rv: r.rv ?? null, er: r.er || null, mc: r.mc || null });
  }
  picks.sort((a, b) => b.score - a.score || (b.rv || 0) - (a.rv || 0) || (b.mc || 0) - (a.mc || 0) || a.t.localeCompare(b.t));
  const list = picks.slice(0, limits.worthMax);
  earningsOnlyMore = picks.slice(limits.worthMax).filter((p) => p.why.length === 1 && p.why[0] === "earnings").length;
  return { list, more: Math.max(0, picks.length - list.length), earningsOnlyMore, counts: {
    high: picks.filter((p) => p.why.includes("high")).length,
    volume: picks.filter((p) => p.why.includes("volume")).length,
    options: picks.filter((p) => p.why.includes("options")).length,
    earnings: picks.filter((p) => p.why.includes("earnings")).length,
  } };
}

export function unusualSymbols(unusual, nowMs = Date.now()) {
  const at = Date.parse(unusual?.scannedAt || "");
  // A scan older than a day and a half is yesterday's news.
  if (!Number.isFinite(at) || nowMs - at > 36 * 3600 * 1000) return new Set();
  return new Set((unusual?.tickers || []).filter((t) => t?.symbol && Array.isArray(t.contracts) && t.contracts.length).map((t) => t.symbol));
}

function summarize(rows, { ourGroupOrder, unusual, todayIso }) {
  const funds = rows.filter((r) => r.fund);
  const stocks = rows.filter((r) => !r.fund);
  return {
    sectorTable: buildSectorTable(rows, funds, ourGroupOrder),
    worth: buildWorthALook(stocks, { unusual, todayIso }),
    today: buildBreadthToday(stocks),
  };
}

// --- quotes ---------------------------------------------------------------------
export async function quoteInChunks(symbols, quoteFn, { chunk = WIDE_LIMITS.quoteChunk, pauseMs = 250, log = () => {} } = {}) {
  const out = {};
  let calls = 0, failed = 0;
  for (let i = 0; i < symbols.length; i += chunk) {
    const part = symbols.slice(i, i + chunk);
    calls++;
    try {
      const r = await quoteFn(part);
      for (const q of Array.isArray(r) ? r : r ? [r] : []) if (q?.symbol) out[q.symbol] = q;
    } catch (err) {
      failed++;
      log(`quote chunk ${part[0]}…${part[part.length - 1]} failed: ${String(err?.message || err).slice(0, 100)}`);
    }
    if (pauseMs && i + chunk < symbols.length) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return { quotes: out, calls, failed };
}

export const WIDE_QUOTE_FIELDS = Object.freeze([
  "regularMarketPrice", "regularMarketPreviousClose", "regularMarketChangePercent", "regularMarketVolume",
  "regularMarketTime", "marketState", "marketCap", "earningsTimestamp", "earningsTimestampStart",
  "isEarningsDateEstimate", "shortName", "longName",
]);

const etDateOf = (d) => { const ms = d instanceof Date ? d.getTime() : (typeof d === "number" ? (d < 1e12 ? d * 1000 : d) : Date.parse(d)); return Number.isFinite(ms) ? etClock(ms).date : null; };

export function earningsDateOf(q, todayIso) {
  for (const k of ["earningsTimestampStart", "earningsTimestamp"]) {
    const d = q?.[k] ? etDateOf(q[k]) : null;
    if (d && (!todayIso || d >= todayIso)) return d;
  }
  return null;
}

// --- the bake -------------------------------------------------------------------
// A full bake. Post-close (an NYSE session day, at or after its close) it adds
// today's bar for every name from one batched quote pass. Any bake backfills
// names with too little history (capped) and fills sectors for names the S&P
// list doesn't cover (capped). Returns the new private state and the public
// payload, plus a count of every outside call.
export async function runWideTier({
  enabled = true, nowMs = Date.now(), builtAtIso = new Date(nowMs).toISOString(),
  priorState = null, seedMembers = null, tracked = [], groupOf = () => null, groupOrder = [],
  chainBarsOf = () => null, chainProfileOf = () => null, unusual = null,
  quote = null, chart = null, profile = null, fetchText = null,
  limits = WIDE_LIMITS, backfillPerRun = limits.backfillPerRun, log = () => {},
} = {}) {
  const started = Date.now();
  const cost = { quoteCalls: 0, quoteFailed: 0, chartCalls: 0, chartFailed: 0, profileCalls: 0, memberReads: 0 };
  if (!enabled) {
    return { state: priorState, payload: { version: WIDE_TIER_VERSION, enabled: false, builtAtIso, note: "Wide tier switched off (WIDE_TIER=0)." }, cost, ms: 0 };
  }
  const clock = etClock(nowMs);
  const session = sessionForDate(clock.date);
  const postClose = !!session?.open && clock.minute >= session.closeMinute;
  const state = {
    version: WIDE_TIER_VERSION,
    members: priorState?.members?.list?.length ? priorState.members : seedMembers,
    profiles: { ...(priorState?.profiles || {}) },
    bars: priorState?.bars?.dates ? priorState.bars : emptyBars(),
    refetch: Array.isArray(priorState?.refetch) ? priorState.refetch.slice() : [],
    lastQuoteAt: priorState?.lastQuoteAt || null,
    tried: priorState?.tried || {},
    quoteSnap: priorState?.quoteSnap || {},
  };
  // 1. Member lists, at most once every 30 days.
  const mem = await refreshMembers({ prior: state.members, nowMs, fetchText, limits, log });
  cost.memberReads = mem.fetched;
  state.members = mem.members || state.members;
  const members = state.members?.list || [];
  const trackedSet = new Set(tracked);
  const memberBy = new Map(members.map((m) => [m.t, m]));
  const universe = wideUniverse(members, tracked);
  const fundSyms = SECTOR_FUNDS.map(([t]) => t);
  const all = [...universe, ...fundSyms];
  const bars = state.bars;
  // 2. Tracked names (and SPY, the breadth series' date axis): the bake's own
  // bars (no call).
  for (const s of [...tracked, "SPY"]) {
    const cb = chainBarsOf(s);
    // An in-session bake's chain ends with today's unfinished bar; only
    // closed sessions go into the store.
    if (Array.isArray(cb) && cb.length) absorbChainBars(bars, s, cb.slice(-limits.maxBars).filter((b) => postClose || String(b?.t || "").slice(0, 10) < clock.date));
  }
  // 3. Backfill or refetch (splits, holes) for names without enough history.
  // A name's old bars are replaced only when its chart read succeeds, so a
  // refetch queue longer than the cap never empties the map. A name already
  // tried today (a recent listing with under 260 sessions, or a failed read)
  // waits for the next day instead of costing a call every bake.
  const refetch = new Set(state.refetch.filter((s) => all.includes(s)));
  const tried = Object.fromEntries(Object.entries(state.tried || {}).filter(([s, d]) => all.includes(s) && d === clock.date));
  state.tried = tried;
  const need = all.filter((s) => !trackedSet.has(s) && (refetch.has(s) || (storedCount(bars, s) < limits.minBars && tried[s] !== clock.date)));
  const cap = Math.max(0, Number(backfillPerRun) || 0);
  const todo = typeof chart === "function" ? need.slice(0, cap) : [];
  const period1 = new Date(nowMs - 740 * 86400000);
  let backfilled = 0;
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (s) => {
      cost.chartCalls++;
      tried[s] = clock.date;
      try {
        const res = await chart(s, { period1, interval: "1d" });
        const rows = (res?.quotes || []).filter((q) => q && q.date && fin(q.close) > 0);
        if (!rows.length) { cost.chartFailed++; return; }
        dropSymbol(bars, s);
        for (const q of rows) {
          const d = etDateOf(q.date);
          // Yahoo can list the live session as a partial bar; only closed days.
          if (!d || (d === clock.date && !postClose)) continue;
          setBar(bars, s, d, q.close, q.volume);
        }
        refetch.delete(s);
        if (storedCount(bars, s) >= limits.minBars) delete tried[s];
        backfilled++;
      } catch (err) {
        cost.chartFailed++;
        log(`chart ${s} failed: ${String(err?.message || err).slice(0, 80)}`);
      }
    }));
  }
  // 4. Sectors for names the S&P list doesn't cover.
  const noSector = universe.filter((s) => !(memberBy.get(s)?.sec) && !state.profiles[s]?.sec);
  let profiled = 0;
  for (const s of noSector) {
    const fromChain = trackedSet.has(s) ? chainProfileOf(s) : null;
    if (fromChain?.sector) { state.profiles[s] = { sec: YAHOO_TO_GICS[fromChain.sector] || fromChain.sector, ind: fromChain.industry || null, n: fromChain.name || null, src: "yahoo", at: clock.date }; continue; }
    if (typeof profile !== "function" || profiled >= limits.profilesPerRun) continue;
    profiled++; cost.profileCalls++;
    try {
      const p = await profile(s);
      if (p?.sector) state.profiles[s] = { sec: YAHOO_TO_GICS[p.sector] || p.sector, ind: p.industry || null, n: p.name || null, src: "yahoo", at: clock.date };
    } catch (err) { log(`profile ${s} failed: ${String(err?.message || err).slice(0, 80)}`); }
  }
  // 5. One batched quote pass after the close (today's bar) or when no quote
  // has ever been taken (first run): market value, earnings dates, names.
  const firstQuote = !state.lastQuoteAt;
  if (typeof quote === "function" && (postClose || firstQuote)) {
    const qr = await quoteInChunks(all, quote, { chunk: limits.quoteChunk, log });
    cost.quoteCalls += qr.calls; cost.quoteFailed += qr.failed;
    const prevDay = previousTradingDate(clock.date);
    for (const [s, q] of Object.entries(qr.quotes)) {
      const snap = { mc: fin(q.marketCap), er: earningsDateOf(q, clock.date), erEst: q.isEarningsDateEstimate === true ? 1 : 0, n: q.longName || q.shortName || null };
      state.quoteSnap[s] = snap;
      if (!postClose) continue;
      const qDate = q.regularMarketTime ? etDateOf(q.regularMarketTime) : null;
      const st = String(q.marketState || "");
      if (qDate !== clock.date || st.startsWith("REGULAR") || st.startsWith("PRE")) continue;
      // Tracked names already took today's bar from their chain.
      const ti = bars.dates.indexOf(clock.date);
      if (trackedSet.has(s) && ti >= 0 && bars.c[s]?.[ti] != null) continue;
      // Split guard: a stored previous close far from Yahoo's previous close
      // means the history is on another share basis; refetch next bake.
      const pc = fin(q.regularMarketPreviousClose);
      const pi = prevDay ? bars.dates.indexOf(prevDay) : -1;
      const stored = pi >= 0 ? bars.c[s]?.[pi] : null;
      if (pc > 0 && stored > 0 && Math.abs(stored / pc - 1) > limits.splitJump) { refetch.add(s); continue; }
      if (pc > 0 && prevDay) setBar(bars, s, prevDay, pc, undefined);
      setBar(bars, s, clock.date, q.regularMarketPrice, q.regularMarketVolume);
      // Hole guard: two or more missed post-close bakes leave a session with
      // no close (one missed bake heals through the previous close above).
      // Refetch the name's history rather than compute averages over a gap.
      const prev2 = prevDay ? previousTradingDate(prevDay) : null;
      const p2 = prev2 ? bars.dates.indexOf(prev2) : -1;
      if (!trackedSet.has(s) && prev2 && storedCount(bars, s) >= limits.minBars && (p2 < 0 || bars.c[s]?.[p2] == null)) refetch.add(s);
    }
    state.lastQuoteAt = builtAtIso;
  }
  state.refetch = [...refetch];
  trimBars(bars, [...all, "SPY"], limits.maxBars);
  // 6. Rows and summaries.
  const payload = buildWidePayload({ state, tracked: trackedSet, groupOf, groupOrder, unusual: unusualSymbols(unusual, nowMs), builtAtIso, todayIso: clock.date, backlog: need.length - backfilled });
  return { state, payload, cost, ms: Date.now() - started, backfilled, backlog: Math.max(0, need.length - backfilled), postClose };
}

export function buildWidePayload({ state, tracked = new Set(), groupOf = () => null, groupOrder = [], unusual = new Set(), builtAtIso, todayIso }) {
  const members = state?.members?.list || [];
  const memberBy = new Map(members.map((m) => [m.t, m]));
  const bars = state?.bars || emptyBars();
  const universe = wideUniverse(members, [...tracked]);
  const rows = [];
  const barsBySym = {};
  const asOf = bars.dates.length ? bars.dates[bars.dates.length - 1] : null;
  const make = (s, fund) => {
    const series = barsFor(bars, s);
    if (series.length) barsBySym[s] = series;
    const st = seriesStats(series);
    if (!st) return null;
    const m = memberBy.get(s), p = state?.profiles?.[s], q = state?.quoteSnap?.[s] || {};
    const { perf } = perfFrom(series, st.close, st.date);
    const row = {
      t: s,
      n: m?.n && m.n !== s ? m.n : (q.n || p?.n || s),
      s: fund ? "Sector funds" : (m?.sec || p?.sec || "Unclassified"),
      i: fund ? fund : (m?.ind || p?.ind || null),
      x: fund ? "" : (m?.idx || ""),
      ...(!fund && !m?.sec && p?.sec ? { ss: "yahoo" } : {}),
      mc: q.mc > 0 ? Number(q.mc.toPrecision(4)) : null,
      sp: st.close, pc: st.close, ch: st.ch, perf,
      ma50: st.ma50, ma200: st.ma200, hi52: st.hi52, lo52: st.lo52, av50: st.av50, rv: st.rv,
      er: q.er || null, ...(q.erEst ? { erEst: 1 } : {}),
      d: st.date,
    };
    if (fund) row.fund = 1;
    if (tracked.has(s)) { row.tr = 1; const g = groupOf(s); if (g) row.g = g; }
    if (asOf && st.date < asOf) row.stale = 1;
    return row;
  };
  for (const s of universe) { const r = make(s, false); if (r) rows.push(r); }
  for (const [s] of SECTOR_FUNDS) { const r = make(s, true); if (r) rows.push(r); }
  rows.sort((a, b) => (b.mc || 0) - (a.mc || 0) || a.t.localeCompare(b.t));
  const sum = summarize(rows, { ourGroupOrder: groupOrder, unusual, todayIso });
  const stockSyms = rows.filter((r) => !r.fund).map((r) => r.t);
  const spy = barsFor(bars, "SPY");
  // Breadth series in the Market map's shape; SPY's dates set the axis.
  const breadth = spy.length ? buildBreadth({ ...barsBySym, SPY: spy }, stockSyms) : null;
  const have = new Set(rows.map((r) => r.t));
  const missing = universe.filter((s) => !have.has(s));
  // Every row's baselines fall on the same sessions, so the dates are stored
  // once (from SPY, the axis every row shares).
  const perfStart = spy.length ? perfFrom(spy, spy[spy.length - 1].c, spy[spy.length - 1].t).perfStart : {};
  return {
    version: WIDE_TIER_VERSION,
    enabled: true,
    builtAtIso,
    refreshedAtIso: builtAtIso,
    asOf,
    members: {
      asOf: state?.members?.asOf || null,
      sources: state?.members?.sources || [],
      count: members.length,
      sp500: members.filter((m) => m.idx.includes("S")).length,
      ndx: members.filter((m) => m.idx.includes("N")).length,
      extras: WIDE_EXTRAS.slice(),
      lastError: state?.members?.lastError || null,
    },
    perfStart,
    counts: { names: rows.filter((r) => !r.fund).length, tracked: rows.filter((r) => r.tr).length, missing: missing.length },
    missing: missing.slice(0, 60),
    tickers: rows,
    sectorTable: sum.sectorTable,
    worth: sum.worth,
    today: sum.today,
    breadth,
    notes: {
      sources: "Members: S&P 500 (Wikipedia's list, GICS sector and sub-industry) and Nasdaq-100 (Nasdaq's index data via n100tickers). Prices: Yahoo daily closes and batched quotes. Names outside the S&P list take Yahoo's profile sector, mapped to the GICS sector name. Second share classes (GOOG, FOX, NWS) are left out so a company counts once.",
      highs: "New 52-week high or low = the price beat the highest or lowest close of the 251 sessions before the last one.",
      volume: "Relative volume = the last session's volume against its 50-session average (intraday: against the share of a normal day expected by that time).",
      earnings: "Earnings dates are Yahoo's and can be off by a day or two; an estimated date is marked.",
      options: "Unusual option volume exists only for tracked names (the hourly flow scan).",
    },
  };
}

// --- the hourly refresh ----------------------------------------------------------
// Re-mark every row from one batched quote pass (already fetched by the
// caller), using the stored levels: the 1-day move from the quote, longer
// moves re-marked from their baselines, relative volume against the share of
// a normal day by now, and the summaries recomputed. Breadth's daily series is
// left as the bake wrote it.
export function refreshWideIntraday(prior, quotes, { nowIso = new Date().toISOString(), expectedFrac = 1, unusual = new Set(), groupOrder = [] } = {}) {
  if (!prior || prior.enabled === false || !Array.isArray(prior.tickers)) return { payload: prior, refreshed: 0, stale: 0 };
  let refreshed = 0, stale = 0;
  const marketStates = {};
  const rows = prior.tickers.map((row) => {
    const q = quotes?.[row.t];
    if (!q) { stale++; return row; }
    const reg = fin(q.regularMarketPrice);
    let ch = fin(q.regularMarketChangePercent);
    if (!(reg > 0) || ch == null) { stale++; return row; }
    const st = String(q.marketState || "");
    if (st) marketStates[st] = (marketStates[st] || 0) + 1;
    const next = { ...row, sp: r2(reg), ch: r2(ch) };
    const mc = fin(q.marketCap); if (mc > 0) next.mc = Number(mc.toPrecision(4));
    if (row.perf && row.sp > 0) {
      const perf = {};
      for (const [p, val] of Object.entries(row.perf)) {
        const f = 1 + Number(val) / 100;
        perf[p] = Number.isFinite(f) && f > 0 ? r2((reg / (row.sp / f) - 1) * 100) : val;
      }
      next.perf = perf;
    }
    // A quote for the session after the stored one (its previous close is our
    // last stored close): that close joins the 52-week window, so a new high
    // or low is measured against the 251 sessions before today.
    const qpc = fin(q.regularMarketPreviousClose);
    if (row.pc > 0 && qpc > 0 && Math.abs(qpc / row.pc - 1) < 0.005) {
      if (row.hi52 > 0) next.hi52 = Math.max(row.hi52, row.pc);
      if (row.lo52 > 0) next.lo52 = Math.min(row.lo52, row.pc);
    }
    const vol = fin(q.regularMarketVolume);
    if (!st.startsWith("PRE") && vol > 0 && row.av50 > 0) next.rv = r2(vol / (row.av50 * (st.startsWith("REGULAR") ? Math.max(0.05, expectedFrac) : 1)));
    delete next.stale;
    refreshed++;
    return next;
  });
  rows.sort((a, b) => (b.mc || 0) - (a.mc || 0) || a.t.localeCompare(b.t));
  const todayIso = etClock(Date.parse(nowIso)).date;
  const sum = summarize(rows, { ourGroupOrder: groupOrder, unusual, todayIso });
  const marketState = Object.keys(marketStates).sort((a, b) => marketStates[b] - marketStates[a])[0] || prior.marketState || null;
  return { payload: { ...prior, refreshedAtIso: nowIso, marketState, tickers: rows, sectorTable: sum.sectorTable, worth: sum.worth, today: sum.today }, refreshed, stale };
}

// An in-session bake rebuilds rows from stored closes only, which would wipe
// the hourly job's intraday marks until its next run. When the prior file was
// re-marked today (ET) on the same closing base, keep its marks for the rows
// whose last close is unchanged and recompute the summaries.
export function carryIntraday(next, prior, { nowMs = Date.now(), groupOrder = [], unusual = new Set() } = {}) {
  if (!next || next.enabled === false || !prior || prior.enabled === false || !Array.isArray(prior.tickers)) return { payload: next, carried: 0 };
  const today = etClock(nowMs).date;
  const at = Date.parse(prior.refreshedAtIso || "");
  const built = Date.parse(prior.builtAtIso || "");
  if (!Number.isFinite(at) || etClock(at).date !== today || prior.asOf !== next.asOf || next.asOf >= today) return { payload: next, carried: 0 };
  // Only a real re-mark (an hourly run after the bake that built the file).
  if (!(at > built) && !prior.carriedIntraday) return { payload: next, carried: 0 };
  const byT = new Map(prior.tickers.map((r) => [r.t, r]));
  let carried = 0;
  const rows = next.tickers.map((row) => {
    const p = byT.get(row.t);
    if (!p || p.d !== row.d || p.stale) return row;
    carried++;
    const out = { ...row, sp: p.sp, ch: p.ch, perf: p.perf, rv: p.rv, hi52: p.hi52, lo52: p.lo52 };
    if (p.mc > 0) out.mc = p.mc;
    return out;
  });
  if (!carried) return { payload: next, carried: 0 };
  rows.sort((a, b) => (b.mc || 0) - (a.mc || 0) || a.t.localeCompare(b.t));
  const sum = summarize(rows, { ourGroupOrder: groupOrder, unusual, todayIso: today });
  return { payload: { ...next, refreshedAtIso: prior.refreshedAtIso, marketState: prior.marketState || null, carriedIntraday: true, tickers: rows, sectorTable: sum.sectorTable, worth: sum.worth, today: sum.today }, carried };
}

export function wideSymbols(payload) {
  return Array.isArray(payload?.tickers) ? payload.tickers.map((r) => r.t).filter(Boolean) : [];
}
