// Policy and news data layer (2026-11-19, owner request): Federal Register
// rules and orders tagged to covered stocks, and GDELT news volume and tone
// per stock. Both are free with no key and no AI call. It feeds the shadow
// log (lib/shadow-signals.mjs `frn`, `nvr`, `ntn` and the `frp` / `nvs`
// gauges), the Owner MCP, the Owner brief's held-names block, and, since the
// data integration pass (2026-11-19), the strategy engines: the news gate
// (lib/engines/config.mjs newsBlock, every signal engine), Downside's
// souring-news points and the Reversion news tag. It never changes a Top
// Picks pick, a grade or a record. A stock with no fresh read is never
// blocked or scored, so coverage matters: `gdelt.coverage` (written every
// bake) says how many covered stocks have a read from today or yesterday,
// and the source-health list shows "partial" when that is under half.
//
// One Owner-only file, policy-news.json, read before the wipe and written
// after it. Reads happen once per ET trading day, on the first bake after
// 09:00 ET that is not a Top Picks run (the same slot as the AI disruption
// collector, so it never delays a pick). GDELT reads one stock every 5.5 s;
// a pass that runs out of time keeps the stocks it finished and the next
// non-Top-Picks bake the same day reads the rest. A failed read keeps the
// prior block, marked stale.
//
// Kill switches (Owner Settings, Data sources): FEDERAL_REGISTER=0 and
// GDELT_NEWS=0. Off = no request; the prior block is carried forward.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readFederalRegister, FR_LOOKBACK_DAYS } from "./federal-register.mjs";
import { readGdelt, GDELT_QUERIES, GDELT_HISTORY_DAYS, GDELT_SPIKE_RATIO, GDELT_SPIKE_MIN } from "./gdelt.mjs";

export const POLICY_NEWS_KEY = "policy-news.json";
export const POLICY_NEWS_VERSION = 1;
export const FR_KEEP_DAYS = 30;
export const FR_KEEP_MAX = 1500;
export const GDELT_BUDGET_MS = 6 * 60000;
// Under this share of covered stocks with a fresh read, source health shows
// the news feed as partial (2026-11-24: 4 of 64 read while it showed "ok").
export const GDELT_COVERAGE_MIN = 0.5;

const off = (v) => /^(?:0|false|off)$/i.test(String(v ?? "").trim());
const etParts = (ms) => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
};
export const etDate = (ms) => etParts(ms).date;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function emptyPolicyNews() {
  return {
    version: POLICY_NEWS_VERSION, updatedAt: null,
    fr: { lastRunDate: null, lastOkDate: null, stale: false, docs: [], health: null },
    gdelt: { date: null, done: [], lastOkDate: null, stale: false, days: {}, health: null, coverage: null },
  };
}

export function cleanPolicyNews(p) {
  const e = emptyPolicyNews();
  if (!p || typeof p !== "object" || p.version !== POLICY_NEWS_VERSION) return e;
  const fr = p.fr && typeof p.fr === "object" ? p.fr : {};
  const g = p.gdelt && typeof p.gdelt === "object" ? p.gdelt : {};
  return {
    ...e, updatedAt: p.updatedAt || null,
    fr: { ...e.fr, ...fr, docs: Array.isArray(fr.docs) ? fr.docs : [] },
    gdelt: { ...e.gdelt, ...g, done: Array.isArray(g.done) ? g.done : [], days: g.days && typeof g.days === "object" ? g.days : {} },
  };
}

// Is a read due this bake? Once per ET date, first bake after 09:00 ET that is
// not a Top Picks run. GDELT stays due until every stock is done that date.
export function policyNewsDue(prior, { nowMs = Date.now(), decisionRun = false, symbols = [] } = {}) {
  const { date, hour } = etParts(nowMs);
  if (decisionRun) return { fr: false, gdelt: false, why: "Top Picks run" };
  if (hour < 9) return { fr: false, gdelt: false, why: "before 09:00 ET" };
  const p = cleanPolicyNews(prior);
  const fr = p.fr.lastOkDate !== date;
  const doneToday = p.gdelt.date === date ? new Set(p.gdelt.done) : new Set();
  const left = symbols.filter((s) => GDELT_QUERIES[s] && !doneToday.has(s));
  return { fr, gdelt: left.length > 0, left, why: fr || left.length ? "due" : "already read today" };
}

// Fold a Federal Register read into the prior docs: the new read replaces any
// document with the same number, docs older than FR_KEEP_DAYS leave.
export function foldFederalRegister(priorDocs, read, today) {
  const cut = addDays(today, -FR_KEEP_DAYS);
  const byId = new Map();
  for (const d of priorDocs || []) if (d?.id && (d.date || today) >= cut) byId.set(d.id, d);
  for (const d of read?.docs || []) {
    const old = byId.get(d.id);
    if (old && !old.pending && d.pending) continue;
    byId.set(d.id, { ...d, abstract: String(d.abstract || "").slice(0, 300) });
  }
  return [...byId.values()]
    .filter((d) => (d.date || today) >= cut)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.id).localeCompare(String(b.id)))
    .slice(0, FR_KEEP_MAX);
}

// Fold a GDELT pass into the per-stock daily rows (one row per ET date).
export function foldGdelt(priorDays, reads, today) {
  const cut = addDays(today, -GDELT_HISTORY_DAYS);
  const days = {};
  for (const [s, rows] of Object.entries(priorDays || {})) {
    const kept = (Array.isArray(rows) ? rows : []).filter((r) => r?.d && r.d >= cut);
    if (kept.length) days[s] = kept;
  }
  for (const [s, row] of Object.entries(reads || {})) {
    const list = (days[s] || []).filter((r) => r.d !== today);
    list.push({ d: today, ...row });
    days[s] = list.sort((a, b) => a.d.localeCompare(b.d));
  }
  return days;
}

// Run the due reads. Returns { state, ran: { fr, gdelt }, why }. Never throws
// for a source failure: that source's block is carried and marked stale.
export async function updatePolicyNews({ prior, nowMs = Date.now(), decisionRun = false, symbols = [], fetchImpl = globalThis.fetch, env = process.env, gdeltBudgetMs = GDELT_BUDGET_MS, gdeltOpts = {}, log = () => {} } = {}) {
  const state = cleanPolicyNews(prior);
  const today = etDate(nowMs);
  const due = policyNewsDue(state, { nowMs, decisionRun, symbols });
  const ran = { fr: false, gdelt: false };
  const frOn = !off(env.FEDERAL_REGISTER), gdOn = !off(env.GDELT_NEWS);
  const tasks = [];
  if (frOn && due.fr) {
    tasks.push((async () => {
      ran.fr = true;
      state.fr.lastRunDate = today;
      try {
        const read = await readFederalRegister({ todayIso: today, covered: new Set(symbols), fetchImpl, log });
        state.fr.health = { at: new Date(nowMs).toISOString(), calls: read.calls, scanned: read.scanned, kept: read.docs.length, errors: read.errors.slice(0, 5) };
        if (read.ok) {
          state.fr.docs = foldFederalRegister(state.fr.docs, read, today);
          state.fr.lastOkDate = today;
          state.fr.stale = false;
        } else {
          state.fr.stale = true;
        }
      } catch (err) {
        state.fr.stale = true;
        state.fr.health = { at: new Date(nowMs).toISOString(), calls: 0, scanned: 0, kept: 0, errors: [String(err?.message || err).split("\n")[0]] };
      }
    })());
  }
  if (gdOn && due.gdelt) {
    tasks.push((async () => {
      ran.gdelt = true;
      const doneToday = state.gdelt.date === today ? state.gdelt.done.slice() : [];
      try {
        const read = await readGdelt({ ...gdeltOpts, symbols: due.left, nowMs, fetchImpl, budgetMs: gdeltBudgetMs, log });
        state.gdelt.days = foldGdelt(state.gdelt.days, read.reads, today);
        state.gdelt.date = today;
        state.gdelt.done = [...new Set([...doneToday, ...read.done])].sort();
        if (read.done.length) state.gdelt.lastOkDate = today;
        state.gdelt.stale = read.done.length === 0;
        state.gdelt.health = { ranAt: new Date(nowMs).toISOString(), calls: read.calls, read: read.done.length, tones: read.tones, left: due.left.length - read.done.length, stopped: read.stopped, network: read.network || 0, errors: read.errors.slice(0, 5) };
      } catch (err) {
        state.gdelt.stale = true;
        state.gdelt.health = { ranAt: new Date(nowMs).toISOString(), calls: 0, read: 0, tones: 0, left: due.left.length, stopped: null, errors: [String(err?.message || err).split("\n")[0]] };
      }
    })());
  }
  await Promise.all(tasks);
  // A source switched off keeps its block, marked stale once it ages past a day.
  if (!frOn && state.fr.lastOkDate && state.fr.lastOkDate < addDays(today, -1)) state.fr.stale = true;
  if (!gdOn && state.gdelt.lastOkDate && state.gdelt.lastOkDate < addDays(today, -1)) state.gdelt.stale = true;
  state.gdelt.coverage = gdeltCoverage(state, { nowMs, symbols });
  if (ran.fr || ran.gdelt) state.updatedAt = new Date(nowMs).toISOString();
  const why = !frOn && !gdOn ? "both switched off" : (ran.fr || ran.gdelt) ? "read" : due.why;
  return { state, ran, why };
}

// How many covered stocks (those with a GDELT query) have a fresh read
// (today's or yesterday's, the same rule the shadow log and the engines use)
// and how many of those have a volume ratio. `status` is "ok" at
// GDELT_COVERAGE_MIN or more, "low" under it, "none" at zero.
export function gdeltCoverage(state, { nowMs = Date.now(), symbols = [] } = {}) {
  const p = cleanPolicyNews(state);
  const today = etDate(nowMs);
  const want = (symbols.length ? symbols : Object.keys(GDELT_QUERIES)).filter((s) => GDELT_QUERIES[s]);
  let fresh = 0, ratio = 0;
  for (const s of want) {
    const list = p.gdelt.days[s];
    const last = Array.isArray(list) ? list[list.length - 1] : null;
    if (!last || last.d < addDays(today, -1)) continue;
    fresh += 1;
    if (Number.isFinite(last.ratio)) ratio += 1;
  }
  const of = want.length;
  const status = !of ? "none" : fresh === 0 ? "none" : fresh / of >= GDELT_COVERAGE_MIN ? "ok" : "low";
  // `checkedOn`, not an observation date: source health dates the block by
  // `lastOkDate` (the last day any stock was read), never by this check.
  return { checkedOn: today, fresh, withRatio: ratio, of, status };
}

// Shadow-log inputs per name and the market gauges for one bake.
//   frn  Federal Register documents tagged to the name, published in the last
//        three days or filed for tomorrow (0 when the Register was read in the
//        last two days and nothing matched; absent when it was not)
//   nvr  GDELT news volume, last 24 hours vs the six days before (ratio;
//        today's or yesterday's read only)
//   ntn  GDELT news tone over those 24 hours, minus the six days before
//        (read only on a volume spike, so absent on most days)
// mkt: frp (presidential documents in the last three days), nvs (stocks whose
// news volume was at least twice their usual on the latest read).
export function policyNewsShadow(state, { nowMs = Date.now(), symbols = [] } = {}) {
  const p = cleanPolicyNews(state);
  const today = etDate(nowMs);
  const rows = {};
  const mkt = {};
  const frFresh = p.fr.lastOkDate && p.fr.lastOkDate >= addDays(today, -2);
  if (frFresh) {
    const cut = addDays(today, -FR_LOOKBACK_DAYS);
    const counts = {};
    let pres = 0;
    for (const d of p.fr.docs) {
      if (!d.pending && (!d.date || d.date < cut)) continue;
      if (d.type === "Presidential Document") pres += 1;
      for (const s of d.tickers || []) counts[s] = (counts[s] || 0) + 1;
    }
    for (const s of symbols) if (GDELT_QUERIES[s] || counts[s]) rows[s] = { frn: counts[s] || 0 };
    mkt.frp = pres;
  }
  const gFresh = p.gdelt.lastOkDate && p.gdelt.lastOkDate >= addDays(today, -1);
  if (gFresh) {
    let spikes = 0, seen = 0;
    for (const s of symbols) {
      const list = p.gdelt.days[s];
      const last = Array.isArray(list) ? list[list.length - 1] : null;
      if (!last || last.d < addDays(today, -1)) continue;
      seen += 1;
      const row = rows[s] || (rows[s] = {});
      if (Number.isFinite(last.ratio)) row.nvr = last.ratio;
      if (Number.isFinite(last.ratio) && last.ratio >= GDELT_SPIKE_RATIO) spikes += 1;
      if (Number.isFinite(last.tone24) && Number.isFinite(last.toneBase)) row.ntn = Math.round((last.tone24 - last.toneBase) * 100) / 100;
    }
    if (seen >= 10) mkt.nvs = spikes;
  }
  return { rows, mkt };
}

// Names the Owner holds (open Top Picks and strategy-engine trades) with a
// federal rule or notice tagged to them in the last three days (or on the
// public inspection list) or a news spike (2x the usual volume). Display
// only: the Owner brief's desk block (data integration, 2026-11-19). It never
// reaches a pick, grade, gate or engine. Fresh reads only, like the shadow keys.
export function heldPolicyNews(state, held = [], { nowMs = Date.now(), max = 8 } = {}) {
  const p = cleanPolicyNews(state);
  const today = etDate(nowMs);
  const names = [...new Set((held || []).map((s) => String(s || "").toUpperCase()).filter(Boolean))];
  if (!names.length) return [];
  const frFresh = p.fr.lastOkDate && p.fr.lastOkDate >= addDays(today, -2);
  const gFresh = p.gdelt.lastOkDate && p.gdelt.lastOkDate >= addDays(today, -1);
  const cut = addDays(today, -FR_LOOKBACK_DAYS);
  const out = [];
  for (const sym of names) {
    const docs = frFresh ? p.fr.docs.filter((d) => (d.pending || (d.date && d.date >= cut)) && (d.tickers || []).includes(sym))
      .sort((a, b) => (b.significant === true) - (a.significant === true) || String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, 2).map((d) => ({ title: d.title, type: d.type, date: d.date || null, pending: !!d.pending, significant: d.significant === true, url: d.url || null })) : [];
    let spike = null;
    if (gFresh) {
      const list = p.gdelt.days[sym];
      const last = Array.isArray(list) ? list[list.length - 1] : null;
      if (last && last.d >= addDays(today, -1) && Number.isFinite(last.ratio) && last.ratio >= GDELT_SPIKE_RATIO && (last.vol24 ?? 0) >= GDELT_SPIKE_MIN) {
        spike = { ratio: last.ratio, date: last.d, tone: Number.isFinite(last.tone24) && Number.isFinite(last.toneBase) ? Math.round((last.tone24 - last.toneBase) * 100) / 100 : null };
      }
    }
    if (docs.length || spike) out.push({ symbol: sym, docs, spike });
  }
  return out.sort((a, b) => (b.spike?.ratio || 0) - (a.spike?.ratio || 0) || b.docs.length - a.docs.length).slice(0, max);
}

// A compact Owner view (MCP, source health).
export function policyNewsSummary(state, { nowMs = Date.now() } = {}) {
  const p = cleanPolicyNews(state);
  const today = etDate(nowMs);
  const recent = p.fr.docs.filter((d) => d.pending || (d.date && d.date >= addDays(today, -FR_LOOKBACK_DAYS)));
  const spikes = [];
  for (const [s, list] of Object.entries(p.gdelt.days)) {
    const last = list[list.length - 1];
    if (last && last.d >= addDays(today, -1) && Number.isFinite(last.ratio) && last.ratio >= GDELT_SPIKE_RATIO) spikes.push({ symbol: s, ...last });
  }
  spikes.sort((a, b) => b.ratio - a.ratio);
  return {
    updatedAt: p.updatedAt,
    federalRegister: { lastOkDate: p.fr.lastOkDate, stale: !!p.fr.stale, health: p.fr.health, recent: recent.slice(0, 60) },
    gdelt: { lastOkDate: p.gdelt.lastOkDate, stale: !!p.gdelt.stale, health: p.gdelt.health, coverage: gdeltCoverage(p, { nowMs }), stocksReadToday: p.gdelt.date === today ? p.gdelt.done.length : 0, spikes: spikes.slice(0, 20) },
    credit: "Federal Register (federalregister.gov); news counts and tone from the GDELT Project (gdeltproject.org).",
  };
}

export async function readPolicyNewsPrior(dataDir) {
  try { return cleanPolicyNews(JSON.parse(await readFile(resolve(dataDir, POLICY_NEWS_KEY), "utf8"))); } catch { return null; }
}
export async function writePolicyNewsFile(dataDir, state) {
  if (!state) return;
  await writeFile(resolve(dataDir, POLICY_NEWS_KEY), JSON.stringify(state), "utf8");
}
