// Webull as a backup source (build E, 2026-11-19).
//
// Once a day after the close the job (jobs/webull-backup.mjs) saves, for our
// names, Webull's earnings calendar, analyst rating counts and price target,
// plus Webull's Fear & Greed reading and its US economic calendar (official
// OpenAPI, paper keys):
//   GET /market-data/fundamentals/earnings-calendars/list   (symbol)
//   GET /market-data/fundamentals/analysis/ratings/get      (symbol)
//   GET /market-data/fundamentals/analysis/target-prices/get (symbol)
//   GET /market-data/screeners/fear-greed-indexes/get
//   GET /market-data/fundamentals/economic-calendars/list   (paged by 30)
// Docs: https://developer.webull.com/apis/docs/reference/ (earnings-calendar,
// get-analyst-rating, get-analyst-target-price, get-fear-and-greed-index,
// list-economic-calendars).
//
// The bake uses it only where our main source failed or is missing a value,
// labeled "backup source", and flags disagreements on the Owner side:
//   - earnings dates: a covered stock with no upcoming date from Yahoo/Nasdaq
//     gets Webull's expected date for the Top Picks decision only (never the
//     public calendar or the public per-stock files);
//   - the Valuation lab street target when Yahoo has none (the Owner MCP
//     drops a backup target; Webull data stays off the MCP this wave);
//   - Fear & Greed: Webull does not say whose index it is. Its four dated
//     points are compared with CNN's daily history; only when they match
//     (4+ dates, every gap 1.5 points or less) may Webull's reading stand in
//     for the engines' fear trial and fear test when CNN fails. Otherwise it
//     is shown as context only.
//   - econ release dates are only compared (the calendar is public).
// Webull's terms of service (section 5) forbid republishing its content
// without written consent, so no Webull value, a date included, reaches a
// public page. Pure functions.

export const BACKUP_KEY = "webull-backup.json";
export const BACKUP_VERSION = 1;
// The bake's Owner-only report of what the backup filled and where the
// sources disagree (bake-owned; the backup file itself is written by Vercel).
export const BACKUP_CHECK_KEY = "webull-backup-check.json";
export const EARNINGS_DAYS = 30;          // our names' earnings in the next 30 days
export const FG_MATCH_MIN = 4;            // dated points needed to call it the same index
export const FG_MATCH_TOL = 1.5;          // index points
export const FG_HISTORY_MAX = 400;
export const STALE_DAYS = 10;             // a per-name read older than this is not used

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const DATE10 = /^\d{4}-\d{2}-\d{2}$/;
const dateOf = (v) => { const s = String(v ?? "").slice(0, 10); return DATE10.test(s) ? s : null; };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

export function emptyBackupFile() {
  return { v: BACKUP_VERSION, key: BACKUP_KEY, updatedAt: null, earnings: {}, ratings: {}, targets: {}, fearGreed: { history: [], latest: null }, econ: null, misses: {} };
}

// --- parsers (one Webull answer each) -------------------------------------

// Earnings calendar (most recent 6 quarters, per the docs) -> quarters, and
// the next expected date on or after `today` that has no actual EPS yet.
export function parseEarningsCalendar(json, today) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  const quarters = [];
  for (const r of list) {
    const date = dateOf(r?.expected_publish_date);
    if (!date) continue;
    quarters.push({ fy: num(r?.fiscal_year), fp: num(r?.fiscal_period), date, epsEst: num(r?.eps_est), epsAct: num(r?.eps_actual), revEst: num(r?.rev_est), revAct: num(r?.rev_actual) });
  }
  quarters.sort((a, b) => (a.date < b.date ? -1 : 1));
  const next = quarters.find((q) => q.epsAct == null && (!today || q.date >= today)) || null;
  return { quarters: quarters.slice(-6), next: next ? next.date : null };
}

export function parseRating(json) {
  const r = json && typeof json === "object" && !Array.isArray(json) ? json : null;
  if (!r) return null;
  const out = { strongBuy: num(r.strong_buy), buy: num(r.buy), hold: num(r.hold), underperform: num(r.under_perform), sell: num(r.sell), n: num(r.number) };
  return Object.values(out).some((v) => v != null) ? out : null;
}

export function parseTarget(json) {
  const r = json && typeof json === "object" && !Array.isArray(json) ? json : null;
  const mean = num(r?.mean);
  if (!(mean > 0)) return null;
  return { mean, median: num(r.median), low: num(r.low), high: num(r.high), currency: r.currency ? String(r.currency).slice(0, 6) : null };
}

// Fear & Greed -> dated points (current, previous day, a week and a month ago).
export function parseFearGreed(json) {
  const points = [];
  for (const k of ["current", "previous_day", "one_week_ago", "one_month_ago"]) {
    const p = json?.[k];
    const date = dateOf(p?.date), value = num(p?.fear_greed_index);
    if (date && value != null) points.push({ date, value, grade: p?.grade ? String(p.grade).slice(0, 20) : null, which: k });
  }
  return points;
}

// "2026-11-25T19:00:00.000+0000" (the probe's form, UTC) -> "19:00Z"; a bare
// "HH:MM" passes through.
const timeOf = (v) => {
  const t = String(v ?? "");
  const m = /T(\d{2}:\d{2})/.exec(t);
  return m ? `${m[1]}Z` : /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : null;
};

export function parseEconPage(json) {
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const events = [];
  for (const r of rows) {
    const date = dateOf(r?.publish_date);
    if (!date || !r?.event_name) continue;
    events.push({ name: String(r.event_name).slice(0, 80), date, time: timeOf(r.publish_time), period: r.period ? String(r.period).slice(0, 20) : null, unit: r.unit ? String(r.unit).slice(0, 8) : null, prior: r.prior_value != null ? String(r.prior_value).slice(0, 16) : null, fed: r.is_fed_related === true, type: r.indicator_type ? String(r.indicator_type).slice(0, 24) : null });
  }
  const k = json?.pagination_key;
  return { events, next: typeof k === "string" && k ? k : null };
}

// --- folding job records into the file -------------------------------------
// Records: { kind: "earnings"|"rating"|"target", sym, value }, { kind:
// "fearGreed", points }, { kind: "econ", first, from, to, events, last },
// { kind: "miss", part, sym, reason }.
export function applyBackupRecord(file, rec, { nowIso = new Date().toISOString() } = {}) {
  const f = file && typeof file === "object" && file.earnings ? file : emptyBackupFile();
  if (!rec) return f;
  const at = nowIso;
  if (rec.kind === "earnings" && rec.sym && rec.value) f.earnings[rec.sym] = { ...rec.value, at };
  else if (rec.kind === "rating" && rec.sym && rec.value) f.ratings[rec.sym] = { ...rec.value, at };
  else if (rec.kind === "target" && rec.sym && rec.value) f.targets[rec.sym] = { ...rec.value, at };
  else if (rec.kind === "fearGreed" && Array.isArray(rec.points) && rec.points.length) {
    const fg = f.fearGreed && Array.isArray(f.fearGreed.history) ? f.fearGreed : { history: [], latest: null };
    const by = new Map(fg.history.map((p) => [p.date, p]));
    for (const p of rec.points) by.set(p.date, { date: p.date, value: p.value, grade: p.grade });
    fg.history = [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-FG_HISTORY_MAX);
    const cur = rec.points.find((p) => p.which === "current") || rec.points[0];
    fg.latest = { ...cur, at };
    f.fearGreed = fg;
  } else if (rec.kind === "econ") {
    if (rec.first || !f.econ || f.econ.from !== rec.from) f.econ = { from: rec.from || null, to: rec.to || null, events: [], complete: false, at };
    const seen = new Set(f.econ.events.map((e) => `${e.date}|${e.name}|${e.period}`));
    for (const e of rec.events || []) { const k = `${e.date}|${e.name}|${e.period}`; if (!seen.has(k)) { seen.add(k); f.econ.events.push(e); } }
    f.econ.events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.time) < String(b.time) ? -1 : 1));
    if (rec.last) f.econ.complete = true;
    f.econ.at = at;
  } else if (rec.kind === "miss") {
    f.misses = f.misses || {};
    f.misses[`${rec.part}:${rec.sym || "-"}`] = { reason: String(rec.reason || "error").slice(0, 60), at };
  }
  f.updatedAt = at;
  return f;
}

// --- what the bake reads --------------------------------------------------

const fresh = (rec, todayEt, maxDays = STALE_DAYS) => {
  const d = dateOf(rec?.at);
  return !!d && (!todayEt || (daysBetween(d, todayEt) >= -1 && daysBetween(d, todayEt) <= maxDays));
};

// Webull's next earnings date for one name, when it is on or after today and
// within EARNINGS_DAYS (wider dates are too unsure to stand in).
export function backupEarningsDate(backup, sym, todayEt, days = EARNINGS_DAYS) {
  const e = backup?.earnings?.[sym];
  if (!e?.next || !fresh(e, todayEt)) return null;
  const gap = daysBetween(todayEt, e.next);
  return gap >= 0 && gap <= days ? e.next : null;
}

// The main source's upcoming earnings date (Yahoo fundamentals, already
// cross-checked with Nasdaq by the bake), or null when it has none on or
// after today.
export function mainEarningsDate(data, todayEt) {
  const d = dateOf(data?.fundamentals?.nextEarningsDate);
  return d && (!todayEt || d >= todayEt) ? d : null;
}

// Copy-on-write view of `chains` for the Top Picks decision: a stock with no
// upcoming date from the main source gets Webull's, labeled. Only the names
// filled are new objects; every other entry is the same object, so nothing
// public (which keeps reading `chains`) ever sees a Webull date.
export function chainsWithEarningsBackup(chains, backup, todayEt, { isEtf = () => false } = {}) {
  const filled = [];
  if (!backup?.earnings || !chains) return { chains, filled };
  let out = null;
  for (const [sym, data] of Object.entries(chains)) {
    if (!data || isEtf(sym) || mainEarningsDate(data, todayEt)) continue;
    const b = backupEarningsDate(backup, sym, todayEt);
    if (!b) continue;
    out = out || { ...chains };
    out[sym] = { ...data, fundamentals: { ...(data.fundamentals || {}), nextEarningsDate: b, nextEarningsSource: "webull-backup" } };
    filled.push({ symbol: sym, date: b });
  }
  return { chains: out || chains, filled };
}

// Names where the main source and Webull both have a date in the window and
// the two are more than `tolDays` apart.
export function earningsDisagreements(chains, backup, todayEt, { tolDays = 1, isEtf = () => false } = {}) {
  const out = [];
  for (const [sym, data] of Object.entries(chains || {})) {
    if (!data || isEtf(sym)) continue;
    const main = mainEarningsDate(data, todayEt), b = backupEarningsDate(backup, sym, todayEt);
    if (!main || !b) continue;
    const gap = daysBetween(main, b);
    if (Math.abs(gap) > tolDays && daysBetween(todayEt, main) <= EARNINGS_DAYS) out.push({ symbol: sym, main, backup: b, days: gap });
  }
  return out.sort((a, b) => (a.main < b.main ? -1 : 1));
}

// { SYM: { mean, median, low, high } } for names with a fresh Webull target.
export function streetTargetBackup(backup, todayEt) {
  const out = {};
  for (const [sym, t] of Object.entries(backup?.targets || {})) {
    if (t?.mean > 0 && fresh(t, todayEt, 21)) out[sym] = { mean: t.mean, median: t.median ?? null, low: t.low ?? null, high: t.high ?? null };
  }
  return out;
}

// Is Webull's Fear & Greed the same index as CNN's? Compares every dated
// Webull point with CNN's daily history ([{ date, score }]). Same when at
// least FG_MATCH_MIN dates match and the largest gap is FG_MATCH_TOL or less.
export function fearGreedCheck(backup, cnnHistory) {
  const cnn = new Map((Array.isArray(cnnHistory) ? cnnHistory : []).filter((p) => p && dateOf(p.date) && num(p.score ?? p.value) != null).map((p) => [dateOf(p.date), num(p.score ?? p.value)]));
  const pts = Array.isArray(backup?.fearGreed?.history) ? backup.fearGreed.history : [];
  const gaps = [];
  for (const p of pts) if (cnn.has(p.date)) gaps.push({ date: p.date, webull: p.value, cnn: cnn.get(p.date), gap: r2(Math.abs(p.value - cnn.get(p.date))) });
  const maxGap = gaps.length ? Math.max(...gaps.map((g) => g.gap)) : null;
  const meanGap = gaps.length ? r2(gaps.reduce((a, g) => a + g.gap, 0) / gaps.length) : null;
  const same = gaps.length >= FG_MATCH_MIN && maxGap <= FG_MATCH_TOL;
  return { matched: gaps.length, maxGap, meanGap, sameIndex: same, verdict: gaps.length < FG_MATCH_MIN ? "not-enough-dates" : same ? "same-index" : "different-index", recent: gaps.slice(-8) };
}

// When CNN failed this bake (snapshot stale or missing) and the check says
// Webull's index is CNN's, the engines may read Webull's latest value instead
// of the stale copy. Returns a stand-in snapshot or null.
export function fearGreedStandIn(backup, check, { cnnFresh = false, lastGoodDate = null, todayEt = null } = {}) {
  if (cnnFresh || !check?.sameIndex) return null;
  const l = backup?.fearGreed?.latest;
  if (!l || num(l.value) == null || !dateOf(l.date)) return null;
  if (lastGoodDate && l.date <= lastGoodDate) return null;
  if (todayEt && daysBetween(l.date, todayEt) > 4) return null;
  const v = num(l.value);
  const rating = v < 25 ? "extreme fear" : v < 45 ? "fear" : v <= 55 ? "neutral" : v <= 75 ? "greed" : "extreme greed";
  return { asOf: `${l.date}T21:00:00Z`, score: v, rating, previous: {}, components: {}, history: [], stale: false, source: "webull-backup" };
}

// Our calendar's macro report rows vs Webull's economic calendar. A report
// group (CPI, PPI, jobs, JOLTS, PCE, GDP, durable goods, ISM) we list on a date
// that Webull lists on a different date within 10 days is a disagreement.
export const ECON_GROUPS = Object.freeze([
  ["cpi", /\bCPI\b|consumer price/i], ["ppi", /\bPPI\b|producer price/i], ["employment", /nonfarm|non-farm|unemployment rate/i],
  ["jolts", /JOLTS|job openings/i], ["pce", /\bPCE\b|personal (income|spending)/i], ["gdp", /\bGDP\b/i],
  ["durables", /durable goods/i], ["ism-mfg", /ISM.*manufacturing/i], ["ism-services", /ISM.*(services|non-manufacturing)/i],
]);
export function econGroupOf(name) {
  for (const [g, re] of ECON_GROUPS) if (re.test(String(name || ""))) return g;
  return null;
}
export function econDisagreements(ourReports, backup, { window = 10 } = {}) {
  const wb = (backup?.econ?.events || []).map((e) => ({ ...e, group: econGroupOf(e.name) })).filter((e) => e.group);
  if (!wb.length) return [];
  const out = [];
  const seen = new Set();
  for (const r of ourReports || []) {
    if (!r?.group || !dateOf(r.date)) continue;
    const k = `${r.group}|${r.date}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const same = wb.filter((e) => e.group === r.group);
    if (!same.length || same.some((e) => e.date === r.date)) continue;
    const near = same.filter((e) => Math.abs(daysBetween(r.date, e.date)) <= window).sort((a, b) => Math.abs(daysBetween(r.date, a.date)) - Math.abs(daysBetween(r.date, b.date)))[0];
    if (near) out.push({ group: r.group, ours: r.date, webull: near.date, name: near.name });
  }
  return out;
}

export function backupSummary(file) {
  return {
    earnings: Object.keys(file?.earnings || {}).length, ratings: Object.keys(file?.ratings || {}).length, targets: Object.keys(file?.targets || {}).length,
    fearGreed: file?.fearGreed?.latest ? { date: file.fearGreed.latest.date, value: file.fearGreed.latest.value } : null,
    econ: file?.econ ? { events: file.econ.events.length, complete: !!file.econ.complete } : null,
    misses: Object.keys(file?.misses || {}).length, updatedAt: file?.updatedAt || null,
  };
}
