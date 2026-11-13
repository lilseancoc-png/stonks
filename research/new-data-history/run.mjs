// New data into the engines: the one-off history test (plan item B, 2026-11-12).
//
// The shadow log only started on 2026-11-09, so the new inputs have days of
// history, not months. This script rebuilds what free history exists and
// asks the same questions the Evidence tab asks (lib/shadow-research.mjs),
// so the owners can tell early which inputs are worth waiting for:
//
//   per name (cross-sectional rank IC against the next 5 and 10 sessions,
//   halves, t from non-overlapping days, partial after 21-day momentum):
//     sv / svz  FINRA daily short-volume share and its z against 20 sessions
//     wkr       Wikipedia page views against their prior 30-day average
//   market gauges (rank correlation with SPY's next 10 sessions, non-overlapping
//   days, halves):
//     cotEsAmZ  CFTC asset managers net E-mini S&P 500, z over three years
//     cotEsLevZ CFTC leveraged funds net E-mini S&P 500, z over three years
//     mdYoy     FINRA margin debt, year over year (monthly, known a month late)
//     baa       Baa corporate spread over the 10-year (FRED BAA10Y)
//   the Regime Lab positioning labeler (lib/regime-lab/positioning.mjs) on the
//   inputs that have history: SPY's next 10 sessions by crowd and credit label.
//
// Every signal on session d uses data published by session d-1, and the move
// is measured from d's close. It runs on a machine with open internet (the
// build sandbox blocks FINRA, Wikimedia, CFTC and FRED), reads only free,
// keyless, public sources, makes no AI call, never touches the private store,
// and writes AGGREGATES ONLY (no per-name rows) to --out/latest.json.
//
// Not tested here, with the reason recorded in the output: option-implied
// borrow, pe14 and pw (no free option-chain history), the Merton default
// chance (needs quarterly debt history per name), insider clusters (needs the
// SEC Form 4 parser from the corporate-structure work), pledge / hot-fund /
// rebalance facts (built from filings that only the bake reads), put/call
// (Cboe's free daily archive stops in 2019) and Kalshi recession odds (no
// history).
//
// Run (Node 20+, from the repo root, after npm install):
//   node research/new-data-history/run.mjs --out research/new-data-history/results
// Options: --days 250 (sessions of per-name history), --cache <dir> (raw
// downloads, reused on a rerun; default ./.new-data-cache, git-ignored by
// living outside the results folder), --gauge-from 2010-01-01.

import fs from "node:fs";
import path from "node:path";
import { yahooFinance } from "../../lib/yahoo.mjs";
import { TICKERS, xlsxSheetRows } from "../../scripts/build.mjs";
import { parseShortVolumeFile, SHORT_VOLUME_URL } from "../../lib/crowd/short-volume.mjs";
import { WIKI_TITLES, WIKI_URL, parseWikiRows } from "../../lib/crowd/wikipedia.mjs";
import { COT_URL, COT_CONTRACTS, cotRowRead } from "../../lib/crowd/cot.mjs";
import { MARGIN_DEBT_URL, parseMarginPage } from "../../lib/crowd/margin-debt.mjs";
import { CROWD_USER_AGENT } from "../../lib/crowd/util.mjs";
import { spearman } from "../../lib/grade-research.mjs";
import { partialSpearman } from "../../lib/shadow-research.mjs";
import { positioningLabel, CROWD_LABELS, CREDIT_LABELS } from "../../lib/regime-lab/positioning.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("out", "research/new-data-history/results");
const CACHE = arg("cache", ".new-data-cache");
const DAYS = Math.max(60, Number(arg("days", 250)) || 250);
const GAUGE_FROM = arg("gauge-from", "2010-01-01");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : null; };
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const tStat = (xs) => { const s = sd(xs); return xs.length > 2 && s > 0 ? mean(xs) / (s / Math.sqrt(xs.length)) : null; };
const log = (...a) => console.log("[new-data-history]", ...a);

async function cached(name, fn) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const v = await fn();
  fs.writeFileSync(file, JSON.stringify(v));
  return v;
}
// Wikimedia and FINRA's margin page refuse a browser-shaped agent from a
// script (429 / 403), so those two send the same descriptive agent the bake
// uses (CROWD_USER_AGENT); FRED wants the browser shape. A 429 or 5xx waits
// (Retry-After when given) and tries again, up to five times.
async function getText(url, headers = {}, { ua = UA, binary = false } = {}) {
  const tries = 5;
  for (let attempt = 0; attempt < tries; attempt++) {
    let retryMs = 1500 * (attempt + 1);
    try {
      const res = await fetch(url, { headers: { "user-agent": ua, accept: "*/*", ...headers }, signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return null;
      if (res.ok) return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
      const err = new Error(`HTTP ${res.status}`);
      if (res.status !== 429 && res.status < 500) { err.final = true; throw err; }
      const after = Number(res.headers.get("retry-after"));
      retryMs = Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : 5000 * 2 ** attempt;
      throw err;
    } catch (err) {
      if (err.final || attempt === tries - 1) throw err;
      await sleep(retryMs);
    }
  }
  return null;
}

// FINRA's full margin-statistics workbook, linked from the margin page.
const MARGIN_HISTORY_PATH = "/sites/default/files/2021-03/margin-statistics.xlsx";
function parseMarginHistory(buf) {
  const out = [];
  for (const cells of xlsxSheetRows(buf, /margin/i).values()) {
    const month = String(cells.A || "").trim();
    const debit = Number(cells.B);
    if (/^\d{4}-\d{2}$/.test(month) && debit > 1000) out.push({ month, debit: Math.round(debit) });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

// ---- prices ----------------------------------------------------------------
async function bars(sym, from) {
  return cached(`bars-${sym}-${from}.json`, async () => {
    const r = await yahooFinance.chart(sym, { period1: from, interval: "1d" });
    return (r?.quotes || []).filter((q) => Number.isFinite(q?.close) && q.close > 0).map((q) => [new Date(q.date).toISOString().slice(0, 10), q.close]);
  });
}

// ---- stats -----------------------------------------------------------------
// One key: per day, the cross-sectional rank IC with the forward move, and the
// partial after the control. Mean over days, halves in date order, t from
// days at least `h` sessions apart.
function keyRead(days, h) {
  const stats = days.map((d) => {
    const rows = d.rows.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y[h]));
    if (rows.length < 20 || new Set(rows.map((r) => r.x)).size < 3) return null;
    const ic = spearman(rows.map((r) => [r.x, r.y[h]]));
    const withZ = rows.filter((r) => Number.isFinite(r.z)).map((r) => ({ x: r.x, y: r.y[h], z: r.z }));
    return ic == null ? null : { i: d.i, ic, partial: withZ.length >= 20 ? partialSpearman(withZ) : null, n: rows.length };
  }).filter(Boolean);
  const ics = stats.map((s) => s.ic);
  const half = Math.floor(stats.length / 2);
  const non = []; let next = -Infinity;
  for (const s of stats) if (s.i >= next) { non.push(s.ic); next = s.i + h; }
  const parts = stats.map((s) => s.partial).filter((v) => v != null);
  return {
    days: stats.length, names: stats.length ? Math.round(mean(stats.map((s) => s.n))) : 0,
    ic: r4(mean(ics)), half1: r4(mean(ics.slice(0, half))), half2: r4(mean(ics.slice(half))),
    t: r2(tStat(non)), nonOverlapDays: non.length, positiveShare: ics.length ? r2(ics.filter((v) => v > 0).length / ics.length) : null,
    partialAfterMomentum: r4(mean(parts)),
  };
}
// A market gauge against SPY's next h sessions on non-overlapping days.
function gaugeRead(cal, spy, valueAt, h = 10) {
  const pairs = [];
  for (let i = 1; i + h < cal.length; i += h) {
    const v = valueAt(cal[i - 1]);
    const a = spy[i], b = spy[i + h];
    if (v == null || !(a > 0) || !(b > 0)) continue;
    pairs.push([v, (b / a - 1) * 100, cal[i]]);
  }
  const half = Math.floor(pairs.length / 2);
  const rho = (xs) => (xs.length >= 8 ? r4(spearman(xs.map((p) => [p[0], p[1]]))) : null);
  return { n: pairs.length, from: pairs[0]?.[2] || null, to: pairs.at(-1)?.[2] || null, rho: rho(pairs), half1: rho(pairs.slice(0, half)), half2: rho(pairs.slice(half)) };
}
// Value on or before a date in a sorted [[date, value]] list (with a lag in days).
function stepReader(rows, lagDays = 0) {
  const list = rows.filter((r) => Number.isFinite(r[1])).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return (date) => {
    const cut = lagDays ? new Date(Date.parse(date + "T00:00:00Z") - lagDays * 86400000).toISOString().slice(0, 10) : date;
    let lo = 0, hi = list.length - 1, found = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][0] <= cut) { found = m; lo = m + 1; } else hi = m - 1; }
    return found >= 0 ? list[found][1] : null;
  };
}
function rollingZ(rows, window) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const prior = rows.slice(Math.max(0, i - window), i).map((r) => r[1]).filter(Number.isFinite);
    const s = sd(prior);
    out.push([rows[i][0], prior.length >= Math.min(52, window / 2) && s > 0 ? (rows[i][1] - mean(prior)) / s : null]);
  }
  return out;
}

async function main() {
  const startedAt = new Date().toISOString();
  const names = TICKERS.filter((s) => /^[A-Z]{1,5}$/.test(s));
  // ---- calendar and prices ------------------------------------------------
  const spyLong = await bars("SPY", GAUGE_FROM);
  const cal = spyLong.map((b) => b[0]);
  const spyClose = spyLong.map((b) => b[1]);
  const startIdx = Math.max(31, cal.length - DAYS - 10);
  const sessions = cal.slice(startIdx - 31);
  const nameFrom = sessions[0];
  log(`calendar ${cal[0]} to ${cal.at(-1)}, per-name window ${sessions[31]} onward (${sessions.length - 31} sessions)`);
  const closes = {};
  for (const s of names) {
    try {
      const b = await bars(s, nameFrom);
      const m = new Map(b);
      closes[s] = sessions.map((d) => m.get(d) ?? null);
    } catch (err) { log(`price ${s} skipped: ${err.message}`); }
    await sleep(120);
  }
  // ---- FINRA short volume (one file per session) ---------------------------
  const sv = {};
  for (const d of sessions) {
    const body = await cached(`finra-${d}.json`, async () => {
      const text = await getText(SHORT_VOLUME_URL(d));
      if (!text) return null;
      const p = parseShortVolumeFile(text, names);
      return Object.fromEntries(Object.entries(p.bySymbol).map(([s, v]) => [s, [v.short, v.total]]));
    }).catch((err) => { log(`FINRA ${d}: ${err.message}`); return null; });
    sv[d] = body;
    await sleep(80);
  }
  log(`FINRA files: ${Object.values(sv).filter(Boolean).length} of ${sessions.length}`);
  // ---- Wikipedia page views (one request per name) --------------------------
  const wiki = {};
  const ymd = (d) => d.replaceAll("-", "");
  for (const s of names) {
    const title = WIKI_TITLES[s];
    if (!title) continue;
    try {
      const body = await cached(`wiki-${s}-${sessions[0]}.json`, async () => JSON.parse(await getText(WIKI_URL(title, ymd(sessions[0]), ymd(sessions.at(-1))), {}, { ua: CROWD_USER_AGENT })));
      wiki[s] = new Map(parseWikiRows(body));
    } catch (err) { log(`wiki ${s} skipped: ${err.message}`); }
    await sleep(400);
  }
  log(`Wikipedia: ${Object.keys(wiki).length} names`);

  // ---- per-name rows ----------------------------------------------------------
  const keys = { sv: [], svz: [], wkr: [] };
  const horizons = [5, 10];
  for (let k = 31; k < sessions.length; k++) {
    const d = sessions[k], prev = sessions[k - 1];
    const rowsBy = { sv: [], svz: [], wkr: [] };
    for (const s of names) {
      const c = closes[s];
      if (!c || !(c[k] > 0)) continue;
      const y = {}; for (const h of horizons) y[h] = c[k + h] > 0 ? (c[k + h] / c[k] - 1) * 100 : NaN;
      const z = c[k - 21] > 0 ? (c[k] / c[k - 21] - 1) * 100 : NaN; // control: 21-session momentum
      const pct = (day) => { const v = sv[day]?.[s]; return v && v[1] > 0 ? (v[0] / v[1]) * 100 : null; };
      const now = pct(prev);
      if (now != null) {
        rowsBy.sv.push({ x: now, y, z });
        const hist = sessions.slice(Math.max(0, k - 21), k - 1).map(pct).filter((v) => v != null);
        const s20 = sd(hist);
        if (hist.length >= 10 && s20 > 0) rowsBy.svz.push({ x: (now - mean(hist)) / s20, y, z });
      }
      const w = wiki[s];
      if (w) {
        // Views through the prior session against the 30 days before it.
        const dayKeys = []; for (let t = Date.parse(prev + "T00:00:00Z"), j = 0; j < 31; j++, t -= 86400000) dayKeys.push(new Date(t).toISOString().slice(0, 10));
        const latest = w.get(dayKeys[0]);
        const prior = dayKeys.slice(1).map((x) => w.get(x)).filter(Number.isFinite);
        if (Number.isFinite(latest) && prior.length >= 20 && mean(prior) > 0) rowsBy.wkr.push({ x: latest / mean(prior), y, z });
      }
    }
    for (const key of Object.keys(keys)) keys[key].push({ i: k, d, rows: rowsBy[key] });
  }
  const perName = {};
  for (const [key, days] of Object.entries(keys)) {
    perName[key] = Object.fromEntries(horizons.map((h) => [String(h), keyRead(days.map((x) => ({ i: x.i, rows: x.rows })), h)]));
  }

  // ---- market gauges ---------------------------------------------------------------
  const gauges = {};
  // CFTC: E-mini S&P 500, every week since GAUGE_FROM; positions are Tuesday's,
  // published Friday, so a 4-day lag.
  try {
    const es = COT_CONTRACTS.find((c) => c.id === "ES");
    const rows = await cached(`cot-es-${GAUGE_FROM}.json`, async () => {
      const q = `${COT_URL}?$where=${encodeURIComponent(`cftc_contract_market_code='${es.code}' AND report_date_as_yyyy_mm_dd >= '${GAUGE_FROM}T00:00:00'`)}&$limit=5000&$order=report_date_as_yyyy_mm_dd`;
      return JSON.parse(await getText(q, { accept: "application/json" }));
    });
    const reads = rows.map(cotRowRead).filter((r) => r.date).sort((a, b) => (a.date < b.date ? -1 : 1));
    const am = rollingZ(reads.map((r) => [r.date, r.assetMgr]), 156);
    const lev = rollingZ(reads.map((r) => [r.date, r.levFund]), 156);
    gauges.cotEsAmZ = { label: "CFTC asset managers net E-mini S&P 500, z (3y)", weeks: reads.length, ...gaugeRead(cal, spyClose, stepReader(am, 4)) };
    gauges.cotEsLevZ = { label: "CFTC leveraged funds net E-mini S&P 500, z (3y)", weeks: reads.length, ...gaugeRead(cal, spyClose, stepReader(lev, 4)) };
    gauges._am = stepReader(am, 4);
  } catch (err) { gauges.cotEsAmZ = { error: err.message }; }
  // FINRA margin debt: month-end balances, published about three weeks later.
  // The page table holds only the latest 12 months, so the full history comes
  // from the workbook the page links (every month since 1997-01, newest first,
  // month text "YYYY-MM" in column A and debit balances, $ millions, in B);
  // the page rows win for any month both carry.
  try {
    let html;
    const pageHtml = async () => (html ??= await getText(MARGIN_DEBT_URL, { accept: "text/html" }, { ua: CROWD_USER_AGENT }));
    const page = await cached("margin.json", async () => parseMarginPage(await pageHtml()));
    const xlsxFile = path.join(CACHE, "finra-margin.xlsx");
    if (!fs.existsSync(xlsxFile)) {
      const linked = await pageHtml().catch(() => "");
      const href = (String(linked || "").match(/href="([^"]*margin-statistics[^"]*\.xlsx)"/i) || [])[1] || MARGIN_HISTORY_PATH;
      const buf = await getText(new URL(href, MARGIN_DEBT_URL).href, {}, { ua: CROWD_USER_AGENT, binary: true });
      if (buf) fs.writeFileSync(xlsxFile, buf);
    }
    const history = fs.existsSync(xlsxFile) ? parseMarginHistory(fs.readFileSync(xlsxFile)) : [];
    const merged = new Map(history.map((m) => [m.month, m]));
    for (const m of page) merged.set(m.month, m);
    const months = [...merged.values()].sort((a, b) => a.month.localeCompare(b.month));
    const byMonth = new Map(months.map((m) => [m.month, m.debit]));
    const yoy = months.map((m) => { const [y, mo] = m.month.split("-").map(Number); const prev = byMonth.get(`${y - 1}-${String(mo).padStart(2, "0")}`); return [`${m.month}-28`, prev > 0 ? (m.debit / prev - 1) * 100 : null]; });
    const read = stepReader(yoy, 25);
    gauges.mdYoy = { label: "FINRA margin debt, y/y %", months: months.length, historyMonths: history.length, ...gaugeRead(cal, spyClose, read) };
    gauges._md = read;
  } catch (err) { gauges.mdYoy = { error: err.message }; }
  // FRED BAA10Y (keyless CSV; FRED wants a browser-shaped request).
  try {
    const csv = await cached("baa10y.json", async () => getText("https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAA10Y", { referer: "https://fred.stlouisfed.org/series/BAA10Y" }));
    const rows = String(csv || "").split(/\r?\n/).slice(1).map((l) => l.split(",")).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p[0]) && Number.isFinite(Number(p[1]))).map((p) => [p[0], Number(p[1])]);
    const read = stepReader(rows, 1);
    gauges.baa = { label: "Baa corporate spread over the 10-year", days: rows.length, ...gaugeRead(cal, spyClose, read) };
    gauges._baa = read;
  } catch (err) { gauges.baa = { error: err.message }; }

  // ---- the positioning labeler on the inputs with history ---------------------------
  const lab = { crowd: {}, credit: {} };
  for (const id of Object.keys(CROWD_LABELS)) lab.crowd[id] = [];
  for (const id of Object.keys(CREDIT_LABELS)) lab.credit[id] = [];
  for (let i = 1; i + 10 < cal.length; i += 10) {
    const d = cal[i - 1];
    const mkt = { cotEsAmZ: gauges._am?.(d) ?? null, mdYoy: gauges._md?.(d) ?? null, baa: gauges._baa?.(d) ?? null };
    const l = positioningLabel(mkt);
    const fwd = spyClose[i] > 0 && spyClose[i + 10] > 0 ? (spyClose[i + 10] / spyClose[i] - 1) * 100 : null;
    if (!l || fwd == null) continue;
    if (l.crowd) lab.crowd[l.crowd].push(fwd);
    if (l.credit) lab.credit[l.credit].push(fwd);
  }
  const sumUp = (xs) => ({ n: xs.length, avgPct: r2(mean(xs)), upPct: xs.length ? Math.round((xs.filter((v) => v > 0).length / xs.length) * 100) : null });
  const positioning = {
    note: "Crowd label from asset managers and margin debt only (no put/call history); credit from the Baa spread only. Non-overlapping 10-session windows.",
    crowd: Object.fromEntries(Object.entries(lab.crowd).map(([k, xs]) => [k, sumUp(xs)])),
    credit: Object.fromEntries(Object.entries(lab.credit).map(([k, xs]) => [k, sumUp(xs)])),
  };
  for (const k of Object.keys(gauges)) if (k.startsWith("_")) delete gauges[k];

  const out = {
    v: 1,
    ranAt: startedAt,
    finishedAt: new Date().toISOString(),
    sample: { perNameFrom: sessions[31], perNameTo: sessions.at(-1), perNameSessions: sessions.length - 31, names: Object.keys(closes).length, gaugesFrom: cal[0], gaugesTo: cal.at(-1), finraFiles: Object.values(sv).filter(Boolean).length, wikiNames: Object.keys(wiki).length },
    bar: { note: "The Evidence tab's pass bar: 10-session IC 0.03+ with the same sign in both halves and 0.02+ after the control. Here the control is 21-session momentum, not the grade.", ic: 0.03, partial: 0.02 },
    perName,
    gauges,
    positioning,
    notTested: {
      ibr: "no free option-chain history", pe14: "no free option-chain history", pw: "no free option-chain history",
      epd: "needs quarterly debt history per name", ins: "needs the SEC Form 4 parser (corporate-structure work)",
      fls: "built from filings only the bake reads", hfp: "built from 13F filings only the bake reads", lrb: "needs leveraged-ETF holdings history", csh: "needs hot-fund history",
      putCall: "Cboe's free daily archive stops in 2019", kxRec: "no Kalshi history",
    },
    privacy: "Aggregates only: no per-name rows, no private store, no Track Record.",
  };
  fs.writeFileSync(path.join(OUT, "latest.json"), JSON.stringify(out, null, 1) + "\n");
  log(`wrote ${path.join(OUT, "latest.json")}`);
  for (const [k, r] of Object.entries(perName)) log(`${k}: 10-session IC ${r["10"].ic} (halves ${r["10"].half1} / ${r["10"].half2}, t ${r["10"].t}, partial ${r["10"].partialAfterMomentum}) over ${r["10"].days} days`);
  for (const [k, g] of Object.entries(gauges)) log(`${k}: rho ${g.rho ?? g.error} (halves ${g.half1} / ${g.half2}) n ${g.n}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
