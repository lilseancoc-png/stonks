// Regime Lab: the Owner-only payload the bake writes (regime-lab.json).
//
// One file, read before the wipe and rewritten by every full bake:
//   today        the market's label at the last confirmed close (A1-A9), the
//                hidden-Markov challenger's read beside it (A8), the inputs
//   history      compact label rows (about three years), merged across bakes
//   stocks       each covered name's own trending / choppy label (A10)
//   risk         a 1-10 risk score for every open Track Record trade and the
//                stop the era ladder would set (E1, E2) — display only
//   books        the shadow playbook paper books (B7): every strategy opens
//                its own paper trades at each Top Picks run from the run's
//                scored universe, priced with the engine's own contract picker
//                and marked with the engine's own option model
//   oracle       the known-headline replay built from the earnings store, the
//                FOMC table and the CPI / jobs release dates (D1-D8, G7)
//   catalog      every test F1-F22 with its status, source and price-half tag
//   guards       the G1-G10 report
//   evidence     the lab's rows for the Evidence board (C10)
//   positioning  the positioning and credit labeler (lib/regime-lab/
//                positioning.mjs), computed by the bake from the logged
//                market gauges and passed in; research only
//
// The live engine never reads this file. Deterministic, no AI, no provider
// call; the daily bars and chains are already in memory when it runs.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildLabelSeries, stockLabel, realizedVol, pctRank, CELLS, CELL_LABELS, THRESHOLDS, LABEL_RULES_VERSION, CONFIRM_SESSIONS, eventLoad } from "./labels.mjs";
import { hmmLabelSeries } from "./hmm.mjs";
import { PLAYBOOKS, STRATEGIES, PLAYBOOK_BY_ID, strategyPlaybook, decideEntry, PLAYBOOK_RULES_VERSION } from "./playbooks.mjs";
import { riskScore, ladderStop, bookBrakes, STOP_LADDER, EXIT_RULES_VERSION, EXIT_RULE_SETS, themeOf as defaultThemeOf } from "./exits.mjs";
import { buildHeadlineBook, monthlyReleaseRows, engineVsOracle, oracleCeiling, ORACLE_VERSION } from "./oracle.mjs";
import { oracleSuite, brakesOnRecord, graderByCell, resemblesNow, labelStability, TESTS_VERSION } from "./tests.mjs";
import { catalogStatus, CATALOG_VERSION } from "./catalog.mjs";
import { guardReport, createTrialLedger, sampleStatus, LIVE_CELL_MIN_TRADES, GUARDS_VERSION } from "./guards.mjs";
import { HARNESS_VERSION, REAL_IV_SINCE } from "./harness.mjs";
import { NEEDS, projectDate } from "../evidence-board.mjs";

export const REGIME_LAB_KEY = "regime-lab.json";
export const REGIME_LAB_PAYLOAD_VERSION = 1;
export const REGIME_LAB_START = "2026-11-09";
export const LABEL_SESSIONS = 1300;      // about five years of market labels
export const HMM_SESSIONS = 3000;        // the challenger's fit window
export const HISTORY_KEEP = 760;         // compact label rows kept in the file
export const SHADOW_MAX_CLOSED = 1500;
export const SHADOW_DROPPED_MISSES = 3;
export const SHADOW_NEED_DECIDED = 30;
export const RESEARCH_RESULTS_PATH = "research/regime-lab/results/latest.json";

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const mean = (xs) => { const v = (xs || []).filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SYM_RE = /^[A-Z][A-Z0-9.]{0,5}$/;
const dateKey = (iso) => { const d = typeof iso === "string" ? iso.slice(0, 10) : null; return d && DATE_RE.test(d) ? d : null; };

export function regimeLabEnabled(env = process.env) { return !/^(?:0|false|off)$/i.test(String(env.REGIME_LAB ?? "1")); }

// ---------------------------------------------------------------------------
// State on disk
// ---------------------------------------------------------------------------
export function emptyRegimeLabState() {
  return { v: REGIME_LAB_PAYLOAD_VERSION, history: [], books: { open: [], closed: [], runs: 0, since: null } };
}

export function parseRegimeLabState(body) {
  if (body == null) return null;
  let parsed;
  try { parsed = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body)); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const state = emptyRegimeLabState();
  state.history = Array.isArray(parsed.history) ? parsed.history.filter((r) => r && DATE_RE.test(String(r.d || ""))) : [];
  const b = parsed.books && typeof parsed.books === "object" ? parsed.books : {};
  state.books = {
    open: Array.isArray(b.open) ? b.open.filter((e) => e && SYM_RE.test(e.symbol || "") && typeof e.strategy === "string") : [],
    closed: Array.isArray(b.closed) ? b.closed.filter((e) => e && SYM_RE.test(e.symbol || "") && typeof e.strategy === "string") : [],
    runs: num(b.runs) || 0,
    since: typeof b.since === "string" ? b.since : null,
  };
  return state;
}

export async function loadRegimeLab(dataDir) {
  try {
    const body = await readFile(resolve(dataDir, REGIME_LAB_KEY), "utf8");
    const state = parseRegimeLabState(body);
    return state ? { state, error: null } : { state: emptyRegimeLabState(), error: "unreadable" };
  } catch (err) {
    return { state: emptyRegimeLabState(), error: err?.code === "ENOENT" ? null : String(err?.message || err) };
  }
}

export async function writeRegimeLab(dataDir, payload) {
  const body = JSON.stringify(payload);
  await writeFile(resolve(dataDir, REGIME_LAB_KEY), body, "utf8");
  return { key: REGIME_LAB_KEY, bytes: body.length, cell: payload?.today?.cell || null, books: payload?.books?.summary?.length || 0 };
}

export async function loadResearchResults(repoRoot) {
  try {
    const parsed = JSON.parse(await readFile(resolve(repoRoot, RESEARCH_RESULTS_PATH), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Label inputs from plain series. Every series is [{ t, c }] or [{ t, v }];
// members are { SYM: [{ t, c, h?, l? }] }. The calendar is SPY's sessions.
// ---------------------------------------------------------------------------
function closeMap(rows, key = "c") {
  const m = new Map();
  for (const r of rows || []) { const t = dateKey(r?.t ?? r?.date); const v = num(r?.[key] ?? r?.c ?? r?.v ?? r?.value ?? r?.close); if (t && v != null && v > 0) m.set(t, v); }
  return m;
}

function align(cal, map, { ffill = 0 } = {}) {
  const out = new Array(cal.length).fill(null);
  let last = null, age = 0;
  for (let i = 0; i < cal.length; i++) {
    const v = map.get(cal[i]);
    if (v != null) { out[i] = v; last = v; age = 0; }
    else if (last != null && ffill > 0 && age < ffill) { out[i] = last; age++; }
    else age++;
  }
  return out;
}

export function buildLabelInputs({ spy = [], spyBars = [], qqq = [], iwm = [], vix = [], vix3m = [], members = {}, maxSessions = LABEL_SESSIONS } = {}) {
  const spyMap = closeMap(spy);
  const hl = new Map();
  for (const b of spyBars || []) { const t = dateKey(b?.t ?? b?.date); if (t && num(b?.h) != null && num(b?.l) != null) hl.set(t, { h: num(b.h), l: num(b.l) }); }
  let cal = [...spyMap.keys()].sort();
  if (cal.length > maxSessions) cal = cal.slice(-maxSessions);
  const spyCloses = cal.map((d) => spyMap.get(d));
  const bars = cal.map((d, i) => { const x = hl.get(d); return { c: spyCloses[i], h: x ? x.h : null, l: x ? x.l : null }; });
  const indexes = { SPY: spyCloses };
  const q = closeMap(qqq); if (q.size) indexes.QQQ = align(cal, q, { ffill: 3 });
  const w = closeMap(iwm); if (w.size) indexes.IWM = align(cal, w, { ffill: 3 });
  const vixA = align(cal, closeMap(vix, "v"), { ffill: 5 });
  const vix3 = align(cal, closeMap(vix3m, "v"), { ffill: 5 });
  // Members: aligned closes plus the share above their own 50-day average.
  const memberCloses = {};
  const above = new Array(cal.length).fill(0), counted = new Array(cal.length).fill(0);
  for (const [sym, rows] of Object.entries(members || {})) {
    const m = closeMap(rows);
    if (m.size < 60) continue;
    const a = align(cal, m, { ffill: 3 });
    memberCloses[sym] = a;
    let s = 0, n = 0;
    for (let i = 0; i < cal.length; i++) {
      const c = a[i];
      if (c == null) { s = 0; n = 0; continue; }
      s += c; n++;
      if (n > 50) { s -= a[i - 50]; n = 50; }
      if (n === 50) { counted[i]++; if (c > s / 50) above[i]++; }
    }
  }
  const breadth50 = cal.map((_, i) => (counted[i] >= 20 ? Math.round((above[i] / counted[i]) * 1000) / 10 : null));
  return { cal, spyBars: bars, spyCloses, indexes, vix: vixA.some((v) => v != null) ? vixA : null, vix3m: vix3.some((v) => v != null) ? vix3 : null, breadth50: breadth50.some((v) => v != null) ? breadth50 : null, members: Object.keys(memberCloses).length >= 10 ? memberCloses : null, memberCount: Object.keys(memberCloses).length };
}

export function buildBakeLabels(inputs, { macroEvents = null, earningsDates = null } = {}) {
  const series = buildLabelSeries({ cal: inputs.cal, spyBars: inputs.spyBars, vix: inputs.vix, vix3m: inputs.vix3m, indexes: inputs.indexes, breadth50: inputs.breadth50, members: inputs.members, start: 60 });
  // The event load (A8) is forward-looking, and the bake only knows the
  // calendar ahead of today, so it is stamped on the latest row alone; the
  // history keeps each earlier day's own read (mergeHistory).
  const last = series.rows[series.rows.length - 1];
  if (last?.detail && (macroEvents || earningsDates)) {
    last.detail.eventLoad = eventLoad({
      macroEvents: macroEvents || [], earningsDates: earningsDates || [], universeSize: Object.keys(inputs.members || {}).length || 85,
      sessionDates: nextWeekdays(last.date, 7), today: last.date,
    });
  }
  const rets = inputs.spyCloses.map((c, i) => (i > 0 && c > 0 && inputs.spyCloses[i - 1] > 0 ? Math.log(c / inputs.spyCloses[i - 1]) : null));
  const from = Math.max(0, inputs.cal.length - HMM_SESSIONS);
  let hmm = null;
  try { hmm = hmmLabelSeries({ cal: inputs.cal.slice(from), returns: rets.slice(from), states: 2 }); } catch { hmm = null; }
  // The SPY closes ride on the series so the stability test (F2) can measure
  // forward volatility without a second copy of the bars.
  series.spyCloses = inputs.spyCloses.slice();
  return { series, hmm, hmmOffset: from };
}

// Compact history rows the file keeps: one per session.
export function compactHistory(series, hmm = null, hmmOffset = 0) {
  const out = [];
  const rows = series?.rows || [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r?.date || !r.cell) continue;
    const d = r.detail || {};
    const h = hmm && hmm.rows ? hmm.rows[i - hmmOffset] : null;
    const row = { d: r.date, cell: r.cell, era: d.era || null, ch: d.character || null, raw: r.raw !== r.cell ? r.raw : undefined, tr: r.transition ? 1 : undefined, sw: r.switched ? 1 : undefined, vix: r2(d.inputs?.vix), q: r3(d.quality?.quality), corr: r3(d.corr?.avgCorr), br: r1(d.inputs?.breadth50), ev: d.eventLoad?.level || undefined, hmm: h && h.stressed != null ? (h.stressed ? 1 : 0) : undefined };
    for (const k of Object.keys(row)) if (row[k] === undefined || row[k] === null) delete row[k];
    out.push(row);
  }
  return out;
}

export function mergeHistory(prior, fresh, keep = HISTORY_KEEP) {
  const byDate = new Map();
  for (const r of prior || []) if (r?.d) byDate.set(r.d, r);
  for (const r of fresh || []) {
    if (!r?.d) continue;
    // A recomputed label wins; the event load read on the day itself stays.
    const p = byDate.get(r.d);
    byDate.set(r.d, p?.ev && !r.ev ? { ...r, ev: p.ev } : r);
  }
  return [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d)).slice(-keep);
}

// The next n weekdays after an ISO date (holidays included; the load is a
// count over a week, not a session-exact calendar).
function nextWeekdays(dateIso, n) {
  const out = [];
  const d = new Date(dateIso + "T00:00:00Z");
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Rebuild a label series shape from compact rows (for resemblesNow and the
// grader read when only the file is at hand).
export function seriesFromHistory(history) {
  const rows = (history || []).map((r) => ({ date: r.d, cell: r.cell, raw: r.raw || r.cell, transition: !!r.tr, switched: !!r.sw, era: r.era || null, character: r.ch || null, detail: { era: r.era || null, character: r.ch || null, quality: { quality: r.q ?? null }, inputs: { vix: r.vix ?? null, breadth50: r.br ?? null }, corr: { avgCorr: r.corr ?? null }, eventLoad: r.ev ? { level: r.ev } : null } }));
  return { version: LABEL_RULES_VERSION, rows, centered: false };
}

// ---------------------------------------------------------------------------
// Today's read
// ---------------------------------------------------------------------------
export function todayFromSeries(series, hmm = null, hmmOffset = 0, { cycle = null, leadership = null } = {}) {
  const rows = series?.rows || [];
  let i = rows.length - 1;
  while (i >= 0 && !rows[i]?.cell) i--;
  if (i < 0) return null;
  const r = rows[i], d = r.detail || {};
  const h = hmm && hmm.rows ? hmm.rows[i - hmmOffset] : null;
  const flips = series.stats || {};
  return {
    date: r.date, cell: r.cell, cellLabel: CELL_LABELS[r.cell] || r.cell, era: d.era || null, stressed: !!d.stressed, character: d.character || null, trendState: d.trendState || null,
    transition: !!r.transition, pending: r.transition ? r.raw : null, daysSinceSwitch: r.daysSinceSwitch ?? null, lastSwitch: rows.slice(0, i + 1).reverse().find((x) => x?.switched)?.date || null,
    why: d.why || null, inputs: { ...(d.inputs || {}), quality: d.quality || null, corr: d.corr || null, eventLoad: d.eventLoad || null },
    hmm: h && h.state != null ? { state: h.state, stressed: !!h.stressed, probStressed: h.probs ? h.probs[h.probs.length - 1] : null, agrees: (!!h.stressed) === (!!d.stressed) } : null,
    stats: { flipsPerYear: flips.flipsPerYear ?? null, rawFlipsPerYear: flips.rawFlipsPerYear ?? null, avgLagDays: flips.avgLagDays ?? null, transitionShare: flips.transitionShare ?? null, confirm: flips.confirm ?? CONFIRM_SESSIONS, sessions: flips.sessions ?? null, hindsightLateDays: series.hindsight?.avgLateDays ?? null },
    playbook: strategyPlaybook("switch", { cell: r.cell, transition: r.transition }), ladderStop: ladderStop(d.era || "normal"), brakes: bookBrakes(d.era || "normal"),
    cycle, leadership, thresholds: THRESHOLDS, rulesVersion: LABEL_RULES_VERSION,
  };
}

// Cell occupancy over the history: sessions per cell, the last 60 sessions.
export function cellShares(history) {
  const all = {}, recent = {};
  const rows = history || [];
  for (const c of CELLS) { all[c] = 0; recent[c] = 0; }
  for (const r of rows) if (all[r.cell] != null) all[r.cell]++;
  for (const r of rows.slice(-60)) if (recent[r.cell] != null) recent[r.cell]++;
  return { sessions: rows.length, all, recent60: recent };
}

// ---------------------------------------------------------------------------
// A10. Stock labels from each name's own bars.
// ---------------------------------------------------------------------------
export function stockLabels(members, { sectorOf = () => null } = {}) {
  const out = [];
  for (const [sym, rows] of Object.entries(members || {})) {
    const bars = (rows || []).filter((b) => num(b?.c) > 0).map((b) => ({ c: num(b.c), h: num(b.h) ?? num(b.c), l: num(b.l) ?? num(b.c) }));
    if (bars.length < 60) continue;
    const lab = stockLabel(bars);
    if (!lab.label) continue;
    const closes = bars.map((b) => b.c);
    const hist = []; for (let k = Math.max(60, bars.length - 252); k < bars.length - 1; k += 5) { const v = realizedVol(closes, 20, k); if (v != null) hist.push(v); }
    out.push({ s: sym, sector: sectorOf(sym), label: lab.label, dir: lab.direction, q: lab.quality, er: lab.er, adx: lab.adx, rv20: lab.rv20, rvRank: lab.rv20 != null && hist.length >= 10 ? Math.round(pctRank(lab.rv20, hist)) : null });
  }
  out.sort((a, b) => (b.q ?? 0) - (a.q ?? 0) || a.s.localeCompare(b.s));
  const trending = out.filter((x) => x.label === "trending");
  return { rows: out, counts: { trending: trending.length, up: trending.filter((x) => x.dir === "up").length, down: trending.filter((x) => x.dir === "down").length, choppy: out.length - trending.length, total: out.length } };
}

// ---------------------------------------------------------------------------
// E1 / E2. Risk score for each open Track Record trade. Display only.
// ---------------------------------------------------------------------------
export function riskForOpenTrades(open, { era = "normal", closesOf = () => null, todayIso = null, nextEarningsOf = () => null } = {}) {
  const out = [];
  for (const t of open || []) {
    if (!t?.symbol) continue;
    const c = t.contract || {};
    const closes = closesOf(t.symbol) || [];
    let volRank = null;
    if (closes.length >= 80) {
      const cur = realizedVol(closes, 20, closes.length - 1);
      const hist = []; for (let k = Math.max(60, closes.length - 252); k < closes.length - 1; k += 5) { const v = realizedVol(closes, 20, k); if (v != null) hist.push(v); }
      if (cur != null && hist.length >= 10) volRank = pctRank(cur, hist);
    }
    const expiry = num(c.expiry) ? new Date(num(c.expiry) * 1000).toISOString().slice(0, 10) : null;
    const dteLeft = expiry && todayIso ? Math.max(0, Math.round((Date.parse(expiry + "T00:00:00Z") - Date.parse(todayIso + "T00:00:00Z")) / 86400000)) : num(c.dte);
    const ne = nextEarningsOf(t.symbol);
    const eventInWindow = !!(ne && expiry && ne <= expiry);
    const rs = riskScore({ structure: c.structure || "long", era, stockVolRankPct: volRank ?? 50, dte: dteLeft ?? 60, eventInWindow });
    out.push({ id: t.id || null, symbol: t.symbol, side: t.side, structure: c.structure || "long", score: rs.score, parts: rs.parts, volRank: volRank != null ? Math.round(volRank) : null, dteLeft, eventInWindow, pnl: r1(num(t.optionPnlPct)), stopNow: num(t.exitPolicy?.stopPct) ?? -50, ladderStop: ladderStop(era), tightens: (num(t.exitPolicy?.stopPct) ?? -50) < ladderStop(era) });
  }
  out.sort((a, b) => b.score - a.score);
  return { era, ladder: STOP_LADDER, rows: out, avgScore: r1(mean(out.map((x) => x.score))), maxOpen: bookBrakes(era).maxOpen, openNow: out.length, overCapacity: out.length > bookBrakes(era).maxOpen };
}

// ---------------------------------------------------------------------------
// B7. Shadow playbook books.
// ---------------------------------------------------------------------------
function compactShadowContract(c) {
  if (!c || !(num(c.strike) > 0) || !(num(c.expiry ?? c.expSec) > 0) || !(num(c.mid) > 0)) return null;
  return { structure: "long", strike: r2(num(c.strike)), expiry: num(c.expiry ?? c.expSec), dte: num(c.dte), mid: r2(num(c.mid)), iv: num(c.iv) != null ? Math.round(num(c.iv) * 10000) / 10000 : null, delta: num(c.delta) != null ? Math.round(num(c.delta) * 1000) / 1000 : null, thetaDay: num(c.thetaDay) != null ? Math.round(num(c.thetaDay) * 10000) / 10000 : null };
}

// Open paper trades for every strategy from one Top Picks run.
//   run         buildPicksRunRecord's output (rows: s, tot, side, spot, ne)
//   label       the label row in force (the last confirmed close)
//   barsOf(sym) [{ c, h, l }] recent bars (26+), oldest first
//   contractFor(sym, side) the engine's single-option pick
export function openShadowBooks(state, { run, label, barsOf, contractFor, builtAtIso, sectorOf = () => null, bar = 4, sectorCap = 3, themeOf = null } = {}) {
  if (!state?.books || !run || !Array.isArray(run.rows) || typeof contractFor !== "function") return { opened: 0, byStrategy: {} };
  const books = state.books;
  const theme = themeOf || ((s) => defaultThemeOf(s, sectorOf));
  const era = label?.era || label?.detail?.era || "normal", character = label?.character || label?.detail?.character || null;
  const cands = run.rows.filter((r) => r && SYM_RE.test(String(r.s || "")) && num(r.tot) != null && Math.abs(num(r.tot)) >= bar && num(r.spot) > 0)
    .map((r) => ({ sym: r.s, total: num(r.tot), spot: num(r.spot), side: r.side === "put" ? "put" : "call", ne: r.ne || null }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || a.sym.localeCompare(b.sym));
  const contracts = new Map();
  const contractOf = (sym, side) => { const k = `${sym}:${side}`; if (!contracts.has(k)) { let c = null; try { c = compactShadowContract(contractFor(sym, side)); } catch { c = null; } contracts.set(k, c); } return contracts.get(k); };
  const byStrategy = {};
  let opened = 0;
  for (const s of STRATEGIES) {
    const playbookId = strategyPlaybook(s.id, label) || "same-rules";
    const pb = PLAYBOOK_BY_ID[playbookId];
    const open = books.open.filter((e) => e.strategy === s.id);
    const capacity = pb ? (pb.maxOpen === "brakes" ? bookBrakes(era).maxOpen : num(pb.maxOpen) ?? 8) : 8;
    const openSyms = new Set(open.map((e) => e.symbol));
    let n = 0;
    for (const c of cands) {
      if (open.length + n >= capacity) break;
      if (openSyms.has(c.sym)) continue;
      const bars = barsOf(c.sym) || [];
      let s20 = null, r20 = null;
      if (bars.length >= 21) { s20 = Infinity; r20 = -Infinity; for (let k = bars.length - 21; k < bars.length - 1; k++) { s20 = Math.min(s20, num(bars[k].l) ?? bars[k].c); r20 = Math.max(r20, num(bars[k].h) ?? bars[k].c); } }
      const decision = decideEntry(pb, { sym: c.sym, side: c.side, total: c.total, spot: c.spot, s20, r20, bars, label, era, character });
      if (!decision.take) continue;
      const sector = sectorOf(c.sym);
      if (sector && open.filter((e) => e.sector === sector).length >= sectorCap) continue;
      const contract = contractOf(c.sym, c.side);
      if (!contract) continue;
      const entry = {
        strategy: s.id, playbook: decision.playbook || playbookId, symbol: c.sym, side: c.side, entryDate: builtAtIso, entrySpot: r2(c.spot), lastSpot: r2(c.spot), tot: r2(c.total),
        cell: label?.cell || null, era, character, transition: !!label?.transition, size: decision.size, stopPct: decision.stopPct, tpPct: decision.tpPct, trailPts: decision.trailPts ?? null,
        sector, theme: theme(c.sym), contract, riskScore: riskScore({ structure: "long", era, stockVolRankPct: 50, dte: contract.dte ?? 60, eventInWindow: !!(c.ne && contract.expiry && c.ne <= new Date(contract.expiry * 1000).toISOString().slice(0, 10)) }).score,
        optionPnlPct: 0, optHiPct: 0, optLoPct: 0,
      };
      books.open.push(entry); open.push(entry); openSyms.add(c.sym); n++; opened++;
    }
    byStrategy[s.id] = n;
  }
  books.runs = (books.runs || 0) + 1;
  if (!books.since) books.since = builtAtIso;
  return { opened, byStrategy };
}

// Mark every open shadow trade with the engine's own model and exits.
//   markFn(entry, data) -> option P&L %; resolveFn(opts) -> { status, outcome } | null
export function markShadowBooks(state, { chains, builtAtIso, markFn, resolveFn, outcomeFn = null } = {}) {
  if (!state?.books || !chains || typeof markFn !== "function" || typeof resolveFn !== "function") return { marked: 0, closed: 0 };
  const books = state.books;
  const nowSec = Math.floor(Date.parse(builtAtIso || "") / 1000) || Math.floor(Date.now() / 1000);
  const still = [];
  let marked = 0, closedNow = 0;
  for (const e of books.open) {
    const data = chains[e.symbol] || null;
    const spot = num(data?.spot);
    if (data) delete e.missingBuilds; else e.missingBuilds = (e.missingBuilds || 0) + 1;
    let pnl = null;
    try { pnl = data ? markFn({ side: e.side, contract: e.contract }, data) : null; } catch { pnl = null; }
    if (pnl == null) pnl = num(e.optionPnlPct);
    const optHi = Math.max(num(e.optHiPct) ?? -Infinity, pnl ?? -Infinity), optLo = Math.min(num(e.optLoPct) ?? Infinity, pnl ?? Infinity);
    const m = { ...e, lastSpot: r2(spot ?? e.lastSpot ?? e.entrySpot), optionPnlPct: r1(pnl), optHiPct: Number.isFinite(optHi) ? r1(optHi) : null, optLoPct: Number.isFinite(optLo) ? r1(optLo) : null };
    marked++;
    // A trailing playbook (ride): no fixed take-profit; once the trade has
    // been up tpPct, it closes when it gives back trailPts from its peak.
    const trailing = num(e.trailPts) != null;
    if (trailing && Number.isFinite(optHi) && optHi >= (num(e.tpPct) ?? 25) && pnl != null && pnl <= optHi - num(e.trailPts)) {
      books.closed.unshift({ ...m, exitDate: builtAtIso, exitSpot: m.lastSpot, status: "trail", outcome: pnl > 0 ? "win" : pnl < 0 ? "loss" : "flat" });
      closedNow++; continue;
    }
    let res = null;
    try {
      res = resolveFn({
        exitPolicy: { version: `${PLAYBOOK_RULES_VERSION}:${e.playbook}`, takeProfitPct: trailing ? 10000 : (num(e.tpPct) ?? 25), stopPct: num(e.stopPct) ?? -50 },
        isCall: e.side === "call", cur: spot, ref: e.entrySpot, expSec: e.contract?.expiry, entrySec: Math.floor(Date.parse(e.entryDate) / 1000), nowSec,
        inUniverse: !!data || (e.missingBuilds || 0) < SHADOW_DROPPED_MISSES, modeledOptPnlPct: pnl,
        thetaPctDay: e.contract?.thetaDay && e.contract?.mid ? Math.abs(e.contract.thetaDay) / e.contract.mid : null,
        structure: "long", scaledOutPnlPct: null, peakPnlPct: Number.isFinite(optHi) ? optHi : null, stopUnder: null, vehicleStopUnder: null, thesisBroken: false,
      });
    } catch { res = null; }
    if (res && res.status) {
      const outcome = res.outcome || (typeof outcomeFn === "function" ? outcomeFn(pnl) : (pnl > 0 ? "win" : pnl < 0 ? "loss" : "flat"));
      books.closed.unshift({ ...m, exitDate: builtAtIso, exitSpot: m.lastSpot, status: res.status, outcome });
      closedNow++;
    } else still.push(m);
  }
  books.open = still;
  if (books.closed.length > SHADOW_MAX_CLOSED) books.closed = books.closed.slice(0, SHADOW_MAX_CLOSED);
  return { marked, closed: closedNow };
}

function describeTrades(list) {
  const xs = list.map((t) => num(t.optionPnlPct)).filter((x) => x != null);
  const n = xs.length;
  const sorted = xs.slice().sort((a, b) => a - b);
  return { n, winPct: n ? Math.round((xs.filter((x) => x > 0).length / n) * 100) : null, avgPnl: n ? r1(xs.reduce((a, b) => a + b, 0) / n) : null, medianPnl: n ? r1(sorted[Math.floor(n / 2)]) : null, totalPts: n ? r1(xs.reduce((a, t, i) => a + t * (num(list[i].size) ?? 1), 0)) : null };
}

// Every strategy's book beside the live record since the books started.
export function summarizeShadowBooks(state, liveClosed = [], { since = null } = {}) {
  const books = state?.books || { open: [], closed: [] };
  const start = dateKey(since || books.since) || REGIME_LAB_START;
  const decided = (list) => list.filter((t) => (t.outcome === "win" || t.outcome === "loss") && num(t.optionPnlPct) != null);
  const rows = [];
  for (const s of STRATEGIES) {
    const closed = decided(books.closed.filter((e) => e.strategy === s.id));
    const open = books.open.filter((e) => e.strategy === s.id);
    const byCell = {};
    for (const c of CELLS) { const list = closed.filter((e) => e.cell === c); if (list.length) byCell[c] = describeTrades(list); }
    const byPlaybook = {};
    for (const e of closed) (byPlaybook[e.playbook] = byPlaybook[e.playbook] || []).push(e);
    rows.push({ id: s.id, name: s.name, baseline: !!s.baseline, cash: !!s.cash, playbook: s.playbook, open: open.length, openPnl: r1(mean(open.map((e) => num(e.optionPnlPct)))), ...describeTrades(closed), byCell, byPlaybook: Object.fromEntries(Object.entries(byPlaybook).map(([k, v]) => [k, describeTrades(v)])), need: SHADOW_NEED_DECIDED, judged: closed.length >= SHADOW_NEED_DECIDED });
  }
  const live = decided((liveClosed || []).filter((t) => dateKey(t.entryDate) >= start));
  const base = rows.find((r) => r.id === "same-rules");
  const sw = rows.find((r) => r.id === "switch");
  return { since: start, runs: books.runs || 0, strategies: rows, live: { ...describeTrades(live), label: "Live Top Picks record (same span)" }, switchBeatsBaseline: base?.judged && sw?.judged ? sw.avgPnl > base.avgPnl : null, open: books.open.length, closed: books.closed.length, note: "Paper books from the raw grade at every Top Picks run: no AI grader, no entry-timing gate, the engine's own contract and option model, each playbook's stop and target. The live record keeps its gates, so the gap between the same-rules book and the live record is what the gates are worth." };
}

// ---------------------------------------------------------------------------
// The oracle at bake time (D1-D8).
//   earningsStore  { tickers: { SYM: { events: [{ date, session, epsActual, epsEstimate, surprisePct }] } } }
//   fomc           Map(date -> { type, bp }) or [{ date, outcome, bp }]
//   releases       { cpi: [dates], jobs: [dates] }
//   fred           { CPIAUCSL: { t, v }, PAYEMS: { t, v } }
//   barsOf(sym)    bars as rows [{ t, c, o? }] or columns { t, c, o?, idx } (SPY needs the long series)
// ---------------------------------------------------------------------------
export function buildBakeOracle({ cal = [], earningsStore = null, fomc = null, releases = {}, fred = {}, barsOf, ivRatioOf = () => undefined, liveClosed = [], from = null, to = null } = {}) {
  const earnings = [];
  for (const [sym, rec] of Object.entries(earningsStore?.tickers || {})) {
    for (const e of rec?.events || []) {
      if (!e || !DATE_RE.test(String(e.date || ""))) continue;
      if (num(e.epsActual) == null && num(e.surprisePct) == null) continue;
      earnings.push({ sym, date: e.date, session: e.session || e.time || "TBD", epsActual: num(e.epsActual), epsEstimate: num(e.epsEstimate), surprisePct: num(e.surprisePct) });
    }
  }
  const fomcRows = fomc instanceof Map ? [...fomc.entries()].map(([date, o]) => ({ date, outcome: o?.type, bp: o?.bp })) : Array.isArray(fomc) ? fomc : [];
  const cpi = monthlyReleaseRows(releases?.cpi || [], fred?.CPIAUCSL || null, { kind: "pct" });
  const jobs = monthlyReleaseRows(releases?.jobs || [], fred?.PAYEMS || null, { kind: "diff" });
  const book = buildHeadlineBook({ cal, earnings, fomc: fomcRows, cpi, jobs });
  const suite = oracleSuite({ book, barsOf, ivRatioOf });
  const structures = { rows: suite.structuresRows };
  const replay = { rows: suite.replayRows };
  const vs = engineVsOracle({ trades: liveClosed, waits: [], replay, structures, cal });
  const ceiling = oracleCeiling({ structures, liveTrades: liveClosed, from, to });
  return {
    v: ORACLE_VERSION, neverRecord: true, book: { rows: book.rows.length, byType: Object.fromEntries(["earnings", "fomc", "cpi", "jobs"].map((t) => [t, book.rows.filter((r) => r.type === t).length])), first: book.rows[0]?.date || null, last: book.rows[book.rows.length - 1]?.date || null, caveat: book.caveat },
    types: suite.types, total: suite.total, engineVsOracle: vs, ceiling, modeled: { dte: 30, note: "Modeled options on an implied-volatility proxy (realized volatility x the name's IV/RV ratio), 25% event bump before, 20% crush after; round-trip costs 3.5 points single, 12 debit spread, 7 straddle, 0.1% stock." },
  };
}

// ---------------------------------------------------------------------------
// Evidence board rows (C10): the lab's own tests in the board's shape.
// ---------------------------------------------------------------------------
function statusFor({ have, need, verdict, today, since }) {
  if (verdict === "pass" || verdict === "fail" || verdict === "inconclusive") return verdict;
  if (have >= need) return "ready";
  return have > 0 ? "collecting" : "waiting";
}

export function labEvidenceTests({ today, books, grader, brakes, decidedTrades = 0, cellCounts = null } = {}) {
  const tests = [];
  const base = books?.strategies?.find((r) => r.id === "same-rules"), sw = books?.strategies?.find((r) => r.id === "switch");
  {
    const have = Math.min(base?.n || 0, sw?.n || 0), need = SHADOW_NEED_DECIDED;
    const verdict = base?.judged && sw?.judged ? (sw.avgPnl > base.avgPnl + 2 ? "pass" : sw.avgPnl < base.avgPnl - 2 ? "fail" : "inconclusive") : null;
    tests.push({ id: "regime-switch-books", name: "Regime Lab: playbook switch vs same rules", lane: "regime", question: "Do the shadow playbooks chosen by the market label beat one set of rules, on paper, at the live runs?", start: books?.since ? dateKey(books.since) : REGIME_LAB_START, due: null, projected: projectDate({ have, need, since: dateKey(books?.since) || REGIME_LAB_START, today }), progress: { have, need, unit: "decided paper trades in each book" }, read: base && sw ? { switchAvgPnl: sw.avgPnl, switchWinPct: sw.winPct, baseAvgPnl: base.avgPnl, baseWinPct: base.winPct } : null, rule: "Read at 30 decided trades in both books: the switch book must beat the same-rules book by 2 points of average P&L (G8).", status: statusFor({ have, need, verdict, today }), verdict });
  }
  {
    const judged = Object.values(grader?.byCell || {}).filter((c) => c.judged);
    const have = grader?.graded || 0, need = NEEDS.graderRows;
    const verdict = judged.length ? grader.verdict : null;
    tests.push({ id: "regime-grader-by-cell", name: "Regime Lab: AI grader by market cell", lane: "regime", question: "Does the grader's buy-now beat its wait inside each market cell?", start: "2026-11-08", due: null, projected: projectDate({ have, need, since: "2026-11-08", today }), progress: { have, need, unit: "graded names with a 10-day outcome (per cell)" }, read: grader ? { cellsJudged: judged.length, cells: Object.fromEntries(Object.entries(grader.byCell || {}).filter(([, c]) => c.graderAdds != null).map(([k, c]) => [k, c.graderAdds])) } : null, rule: "Per cell with 40 graded names: buy-now names must do better over 10 sessions than wait names, signed by side.", status: statusFor({ have, need, verdict, today }), verdict });
  }
  {
    const have = brakes?.n || 0, need = 30;
    const verdict = brakes && brakes.verdict !== "insufficient" ? brakes.verdict : null;
    tests.push({ id: "regime-book-brakes", name: "Regime Lab: book brakes on the record", lane: "regime", question: "Would the era brakes (book size, theme cap, daily loss stop) have refused the losers?", start: "2026-10-10", due: null, projected: projectDate({ have, need, since: "2026-10-10", today }), progress: { have, need, unit: "decided trades" }, read: brakes ? { refused: brakes.refused?.n ?? 0, refusedAvg: brakes.refused?.avg ?? null, keptAvg: brakes.kept?.avg ?? null } : null, rule: "Pass: the refused trades averaged less than the kept ones, over 30 decided trades and 5 refusals.", status: statusFor({ have, need, verdict, today }), verdict });
  }
  {
    const counts = cellCounts || {};
    const have = Math.max(0, ...Object.values(counts).map((n) => num(n) || 0)), need = LIVE_CELL_MIN_TRADES;
    tests.push({ id: "regime-live-cells", name: "Regime Lab: live record by cell", lane: "regime", question: "Does the live record make money in every market cell, or only in some?", start: REGIME_LAB_START, due: null, projected: projectDate({ have: decidedTrades, need, since: "2026-10-10", today }), progress: { have: decidedTrades, need, unit: "decided live trades (about 140-240 to judge a cell)" }, read: { byCell: counts }, rule: "Judged per cell on 2006+ price-half replays until a live cell reaches about 140 decided trades (G4).", status: statusFor({ have: decidedTrades, need, verdict: null, today }), verdict: null });
  }
  return tests;
}

// ---------------------------------------------------------------------------
// The whole payload.
// ---------------------------------------------------------------------------
export function buildRegimeLabPayload({
  state, labels, hmm = null, hmmOffset = 0, builtAtIso = null, today = null, members = null, sectorOf = () => null, themeOf = null,
  openTrades = [], closedTrades = [], outcomes = null, oracle = null, research = null, cycle = null, leadership = null, nextEarningsOf = () => null, closesOf = () => null,
  stampedTrades = 0, gradeModelVersion = null, spyCtx = null, positioning = null,
} = {}) {
  const asOf = today || dateKey(builtAtIso) || new Date().toISOString().slice(0, 10);
  const fresh = compactHistory(labels, hmm, hmmOffset);
  const history = mergeHistory(state?.history || [], fresh);
  const todayRow = todayFromSeries(labels, hmm, hmmOffset, { cycle, leadership }) || null;
  const stocks = members ? stockLabels(members, { sectorOf }) : { rows: [], counts: null };
  const era = todayRow?.era || "normal";
  const risk = riskForOpenTrades(openTrades, { era, closesOf, todayIso: asOf, nextEarningsOf });
  const books = summarizeShadowBooks(state, closedTrades);
  const decided = (closedTrades || []).filter((t) => (t.outcome === "win" || t.outcome === "loss") && num(t.optionPnlPct) != null);
  // Live record by cell: trades stamped with a lab label, else the label on their entry date.
  const histIdx = new Map(history.map((r) => [r.d, r]));
  const cellOfTrade = (t) => t.labRegime?.cell || (() => { const d = dateKey(t.entryDate); if (!d) return null; let best = null; for (const r of history) { if (r.d < d) best = r; else break; } return best?.cell || null; })();
  const liveByCell = {};
  for (const c of CELLS) liveByCell[c] = { n: 0, wins: 0, sum: 0 };
  for (const t of decided) { const c = cellOfTrade(t); if (!c || !liveByCell[c]) continue; liveByCell[c].n++; if (t.outcome === "win") liveByCell[c].wins++; liveByCell[c].sum += num(t.optionPnlPct); }
  for (const c of CELLS) { const o = liveByCell[c]; o.winPct = o.n ? Math.round((o.wins / o.n) * 100) : null; o.avgPnl = o.n ? r1(o.sum / o.n) : null; o.sample = sampleStatus(o.n); delete o.sum; }
  const labelSeriesForTests = seriesFromHistory(history);
  const grader = graderByCell(outcomes, labelSeriesForTests, { tradeBar: 4 });
  const eraOf = (d) => histIdx.get(d)?.era || (() => { let best = null; for (const r of history) { if (r.d <= d) best = r; else break; } return best?.era || "normal"; })();
  const brakes = brakesOnRecord(closedTrades, { themeOf: themeOf || ((s) => defaultThemeOf(s, sectorOf)), eraOf, sectorOf });
  const resembles = resemblesNow({ labels: labelSeriesForTests, ctx: spyCtx, k: 5 });
  const spyCloses = Array.isArray(labels?.spyCloses) && labels.spyCloses.length === (labels?.cal || []).length ? labels.spyCloses : (labels?.cal || []).map(() => null);
  const stability = labelStability({ grid: labels, hmm, cal: labels?.cal || [], spyCloses });
  const live = {
    F10: { verdict: brakes.verdict, have: brakes.n, read: { refused: brakes.refused?.n ?? 0, refusedAvg: brakes.refused?.avg ?? null, keptAvg: brakes.kept?.avg ?? null }, ranAt: asOf },
    F11: oracle ? { verdict: oracle.book.rows >= 40 ? "ok" : null, have: oracle.book.rows, read: oracle.total ? { hitClose: oracle.total.hit?.close ?? null, alreadyPricedPct: oracle.total.alreadyPricedPct ?? null } : null, ranAt: asOf, priceHalf: true } : null,
    F12: oracle ? { verdict: oracle.book.rows >= 40 ? "ok" : null, have: oracle.book.rows, read: Object.fromEntries(Object.entries(oracle.types || {}).map(([k, v]) => [k, v.best])), ranAt: asOf, priceHalf: true } : null,
    F13: oracle ? { verdict: oracle.book.rows >= 40 ? "ok" : null, have: oracle.book.rows, read: Object.fromEntries(Object.entries(oracle.types || {}).map(([k, v]) => [k, v.noisy?.long?.breakEvenAccuracyPct ?? null])), ranAt: asOf, priceHalf: true } : null,
    F14: oracle?.engineVsOracle ? { verdict: oracle.engineVsOracle.matched >= NEEDS.eventTrades ? "ok" : null, have: oracle.engineVsOracle.matched, read: oracle.engineVsOracle.byType, ranAt: asOf } : null,
    F16: { verdict: resembles.verdict === "ok" ? "ok" : null, have: history.length, read: resembles.summary || null, ranAt: asOf },
    F20: { verdict: grader.verdict !== "insufficient" ? grader.verdict : null, have: grader.graded, read: Object.fromEntries(Object.entries(grader.byCell || {}).map(([k, c]) => [k, c.graderAdds])), ranAt: asOf },
  };
  for (const k of Object.keys(live)) if (!live[k]) delete live[k];
  const catalog = catalogStatus({ research, live, today: asOf });
  const ledger = createTrialLedger(research ? { holdoutRuns: research.holdoutRuns || {}, started: research.ranAt || null } : null);
  if (research?.trials) ledger.count("research", research.trials);
  const guards = guardReport({ labels, ledger, record: { open: openTrades, closed: closedTrades }, oracleOutputs: oracle ? [oracle] : [], ruleIds: EXIT_RULE_SETS.map((r) => r.id), decidedTrades: decided.length, research: research?.results?.F22 ? { stress: { rerun: research.results.F22.have ?? research.results.F22.read?.rerun ?? null, survived: research.results.F22.read?.survived ?? 0 } } : null });
  const evidence = labEvidenceTests({ today: asOf, books, grader, brakes, decidedTrades: decided.length, cellCounts: Object.fromEntries(CELLS.map((c) => [c, liveByCell[c].n])) });
  return {
    v: REGIME_LAB_PAYLOAD_VERSION, builtAt: builtAtIso, asOf, start: REGIME_LAB_START, realIvSince: REAL_IV_SINCE,
    versions: { labels: LABEL_RULES_VERSION, playbooks: PLAYBOOK_RULES_VERSION, exits: EXIT_RULES_VERSION, harness: HARNESS_VERSION, oracle: ORACLE_VERSION, tests: TESTS_VERSION, catalog: CATALOG_VERSION, guards: GUARDS_VERSION, grade: gradeModelVersion },
    today: todayRow, cells: { ids: CELLS, labels: CELL_LABELS, shares: cellShares(history) }, stability: { grid: stability.grid, hmm: stability.hmm, agreementPct: stability.agreementPct, preferred: stability.preferred, why: stability.why },
    history, stocks, risk, books: { ...books, open: state?.books?.open || [], closed: (state?.books?.closed || []).slice(0, 400) },
    liveByCell, playbooks: PLAYBOOKS.map((p) => ({ id: p.id, name: p.name, item: p.item, cells: p.cells, sides: p.sides, size: p.size, stopPct: p.stopPct, tpPct: p.tpPct, maxOpen: p.maxOpen, note: p.note, baseline: !!p.baseline })),
    resembles, oracle, grader, brakes, catalog, guards, evidence, research: research ? { ranAt: research.ranAt || null, trials: research.trials ?? null, holdoutRuns: research.holdoutRuns || {}, summary: research.summary || null, results: research.results || null } : null,
    stampedTrades,
    ...(positioning ? { positioning } : {}),
    note: "Owner-only research. Labels are computed through the prior close with a two-session confirmation; playbooks and exits run as paper books; nothing here changes a pick, a grade or the Track Record.",
  };
}

// Compact label stamp for a new Track Record trade or an archive record.
export function labStamp(todayRow) {
  if (!todayRow?.cell) return null;
  return { v: LABEL_RULES_VERSION, cell: todayRow.cell, era: todayRow.era, character: todayRow.character, transition: !!todayRow.transition, asOf: todayRow.date };
}
