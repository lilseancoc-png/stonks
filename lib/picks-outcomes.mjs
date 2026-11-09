// Top Picks outcomes and the random control book (2026-11-08).
//
// The run archive (lib/picks-run-archive.mjs) keeps what the engine saw at
// each 11:00 / 15:30 ET decision run but never what happened next. This
// module adds the "what happened next" half, so the engine is judged on every
// name it scored (about 85 a run) instead of only the few trades it opened:
//
//   rows     one compact row per run and name: date, run clock, symbol, side,
//            total, spot at the run, what the run did with the name (pick /
//            gate / below-bar / open), the AI grader's entry verdict, the
//            market type, and the underlying's move 1, 5, 10 and 20 trading
//            days after the run day (r1..r20, percent of the run spot). A
//            horizon is filled by the first full bake that has that close;
//            the daily bars are already in memory, so no provider is called.
//   control  a random control book. Every decision run also "opens" a few
//            random names with a random side, priced with the engine's own
//            single-option contract picker, and marks them to market with the
//            same option model, take-profit, stop, theta and expiry rules as
//            the real book (the callers inject markOptionToMarket,
//            resolvePickOutcome and pickExitPolicy from build.mjs). The one
//            difference: a control trade has no ATR underlying stop, because
//            that level comes from the pick's own exit plan.
//
// Nothing here changes a pick, a grade, a contract or the track record. Pure
// and synchronous except the two file helpers. Owner-only on disk
// (picks-outcomes.json, lib/premium-keys.mjs), bake-owned and optional
// (lib/data-ownership.mjs OPTIONAL_BAKE_KEYS), rewritten by every full bake.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const PICKS_OUTCOMES_KEY = "picks-outcomes.json";
export const PICKS_OUTCOMES_VERSION = 1;
export const OUTCOME_HORIZONS = Object.freeze([1, 5, 10, 20]);
// Distinct run days kept. Two runs a day over ~6 months ≈ 20k rows ≈ 1.3 MB.
export const OUTCOME_KEEP_RUN_DAYS = 120;
export const OUTCOME_KEYS = Object.freeze(["d", "et", "s", "side", "tot", "spot", "out", "ev", "mk", "r1", "r5", "r10", "r20"]);
export const CONTROL_PER_RUN_MIN = 2;
export const CONTROL_PER_RUN_MAX = 6;
export const CONTROL_MAX_CLOSED = 600;
export const CONTROL_DROPPED_MISSES = 3;

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const SYM_RE = /^[A-Z][A-Z0-9.]{0,5}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const I = Object.fromEntries(OUTCOME_KEYS.map((k, i) => [k, i]));
const validDate = (d) => {
  if (typeof d !== "string" || !DATE_RE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
};

export function emptyOutcomesState() {
  return { v: PICKS_OUTCOMES_VERSION, keys: OUTCOME_KEYS.slice(), rows: [], control: { open: [], closed: [], drawn: 0, since: null } };
}

export function parseOutcomesState(body) {
  if (body == null) return null;
  let parsed;
  try { parsed = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body)); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rows)) return null;
  const state = emptyOutcomesState();
  // Rows are stored as arrays in OUTCOME_KEYS order; a file written with
  // fewer keys (an older version) is padded, never dropped.
  state.rows = parsed.rows
    .filter((r) => Array.isArray(r) && validDate(r[I.d]) && SYM_RE.test(r[I.s] || ""))
    .map((r) => OUTCOME_KEYS.map((_, i) => (r[i] === undefined ? null : r[i])));
  const c = parsed.control && typeof parsed.control === "object" ? parsed.control : {};
  state.control = {
    open: Array.isArray(c.open) ? c.open.filter((e) => e && SYM_RE.test(e.symbol || "")) : [],
    closed: Array.isArray(c.closed) ? c.closed.filter((e) => e && SYM_RE.test(e.symbol || "")) : [],
    drawn: num(c.drawn) || 0,
    since: typeof c.since === "string" ? c.since : null,
  };
  return state;
}

export async function loadPicksOutcomes(dataDir) {
  let body = null;
  try { body = await readFile(resolve(dataDir, PICKS_OUTCOMES_KEY), "utf8"); } catch (err) {
    if (err?.code === "ENOENT") return { state: emptyOutcomesState(), fresh: true };
    return { state: emptyOutcomesState(), error: String(err?.message || err).split("\n")[0] };
  }
  const state = parseOutcomesState(body);
  return state ? { state } : { state: emptyOutcomesState(), error: "unreadable outcomes file" };
}

export async function writePicksOutcomes(dataDir, state) {
  const body = JSON.stringify(state);
  await writeFile(resolve(dataDir, PICKS_OUTCOMES_KEY), body, "utf8");
  return { key: PICKS_OUTCOMES_KEY, bytes: body.length, rows: state.rows.length, controlOpen: state.control.open.length, controlClosed: state.control.closed.length };
}

// Severe and risk-off pool together (too few severe days), as in setup-odds.
export function marketTypeOf(regimeState) {
  const r = String(regimeState || "").toLowerCase();
  if (r === "risk-on") return "risk-on";
  if (r === "risk-off" || r === "severe") return "risk-off";
  if (r === "neutral") return "neutral";
  return null;
}

function outClass(out) {
  const o = String(out || "");
  if (o.startsWith("pick:")) return "pick";
  if (o.startsWith("gate:")) return "gate";
  if (o === "below-bar" || o === "open") return o;
  return "other";
}

export function rowKey(r) {
  return `${r[I.d]}|${r[I.et]}|${r[I.s]}|${r[I.side]}`;
}

// Append one archived run (buildPicksRunRecord's output) as pending rows.
export function appendRunOutcomes(state, run, date) {
  if (!state || !run || !Array.isArray(run.rows) || !validDate(date)) return 0;
  const have = new Set(state.rows.map(rowKey));
  const et = typeof run.et === "string" ? run.et : "";
  const mk = marketTypeOf(run.regime?.st);
  let added = 0;
  for (const r of run.rows) {
    if (!r || !SYM_RE.test(String(r.s || ""))) continue;
    const side = r.side === "put" ? "put" : "call";
    const row = OUTCOME_KEYS.map(() => null);
    row[I.d] = date; row[I.et] = et; row[I.s] = r.s; row[I.side] = side;
    row[I.tot] = r2(num(r.tot)); row[I.spot] = r2(num(r.spot)); row[I.out] = typeof r.out === "string" ? r.out.slice(0, 40) : null;
    row[I.ev] = r.ai && (r.ai.ev === "buy-now" || r.ai.ev === "wait") ? r.ai.ev : null;
    row[I.mk] = mk;
    const key = rowKey(row);
    if (have.has(key)) continue;
    have.add(key);
    state.rows.push(row);
    added++;
  }
  return added;
}

// Bake-time chains carry raw daily bars (_bars, t = YYYY-MM-DD); files read
// back carry the compact priceSeries instead. Dates must be real sessions.
export function dailyClosesOf(data) {
  const out = [];
  if (Array.isArray(data?._bars) && data._bars.length) {
    for (const b of data._bars) {
      const raw = b?.t ?? b?.date, t = typeof raw === "string" ? raw.slice(0, 10) : null, c = num(b?.c);
      if (t && DATE_RE.test(t) && c > 0) out.push({ t, c });
    }
    return out;
  }
  const ps = data?.priceSeries;
  if (ps && Array.isArray(ps.c) && Array.isArray(ps.t)) {
    for (let i = 0; i < ps.c.length; i += 1) {
      const t = typeof ps.t[i] === "string" ? ps.t[i].slice(0, 10) : null, c = num(ps.c[i]);
      if (t && DATE_RE.test(t) && c > 0) out.push({ t, c });
    }
  }
  return out;
}

// Fill the horizons that now have a close. rN = the close N trading days
// after the run day, as a percent of the run's spot. The run day's own bar is
// skipped on purpose: a morning bake carries a partial bar for today.
export function fillOutcomes(state, chains, { today = null } = {}) {
  if (!state || !chains) return 0;
  const closesBySym = new Map();
  const closesFor = (sym) => {
    if (!closesBySym.has(sym)) closesBySym.set(sym, chains[sym] ? dailyClosesOf(chains[sym]) : []);
    return closesBySym.get(sym);
  };
  let filled = 0;
  for (const row of state.rows) {
    if (row[I.r20] != null) continue;
    const spot = num(row[I.spot]);
    if (!(spot > 0)) continue;
    const closes = closesFor(row[I.s]);
    if (!closes.length) continue;
    const d = row[I.d];
    // Only closes of sessions after the run day, and only sessions that are
    // over: a close dated today is still a partial bar during the session.
    const after = closes.filter((b) => b.t > d && (!today || b.t < today));
    for (const h of OUTCOME_HORIZONS) {
      const k = `r${h}`;
      if (row[I[k]] != null) continue;
      const bar = after[h - 1];
      if (!bar) break;
      row[I[k]] = r2((bar.c / spot - 1) * 100);
      filled++;
    }
  }
  return filled;
}

// Keep the newest OUTCOME_KEEP_RUN_DAYS distinct run days.
export function pruneOutcomes(state, keepDays = OUTCOME_KEEP_RUN_DAYS) {
  if (!state) return 0;
  const days = [...new Set(state.rows.map((r) => r[I.d]))].sort();
  if (days.length <= keepDays) return 0;
  const cut = days[days.length - keepDays];
  const before = state.rows.length;
  state.rows = state.rows.filter((r) => r[I.d] >= cut);
  return before - state.rows.length;
}

// ---- statistics -------------------------------------------------------------

function dirOf(row) { return row[I.side] === "put" ? -1 : 1; }

function group(rows, horizon = "r10") {
  const idx = I[horizon];
  let n = 0, hits = 0, sum = 0, nonzero = 0;
  for (const r of rows) {
    const ret = num(r[idx]);
    if (ret == null) continue;
    const signed = ret * dirOf(r);
    n++; sum += signed;
    if (signed !== 0) { nonzero++; if (signed > 0) hits++; }
  }
  return { n, hit: nonzero ? Math.round((hits / nonzero) * 100) : null, avg: n ? r2(sum / n) : null };
}

function bandOf(tot) {
  const a = Math.abs(num(tot) ?? 0);
  return a >= 7 ? "7+" : a >= 4 ? "4-7" : a >= 2 ? "2-4" : "0-2";
}

function ranks(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = rank;
    i = j + 1;
  }
  return out;
}

export function spearman(xs, ys) {
  if (xs.length !== ys.length || xs.length < 5) return null;
  const rx = ranks(xs), ry = ranks(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length, my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < rx.length; i++) { const dx = rx[i] - mx, dy = ry[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

// The whole read of the outcome rows. tradeBar = the grade a name needs to be
// a trade (PICKS_MIN_CONVICTION, 4 by default); the grader comparison uses
// only names at or above it, so graded and ungraded names are alike.
export function summarizeOutcomes(state, { tradeBar = 4 } = {}) {
  const rows = state?.rows || [];
  const days = [...new Set(rows.map((r) => r[I.d]))].sort();
  const runs = new Set(rows.map((r) => `${r[I.d]}|${r[I.et]}`));
  const complete = rows.filter((r) => r[I.r10] != null);
  const signal = rows.filter((r) => Math.abs(num(r[I.tot]) ?? 0) >= 1);
  const horizons = {};
  for (const h of OUTCOME_HORIZONS) horizons[`r${h}`] = group(signal, `r${h}`);
  const bands = {};
  for (const b of ["0-2", "2-4", "4-7", "7+"]) bands[b] = group(rows.filter((r) => bandOf(r[I.tot]) === b));
  const markets = {};
  for (const m of ["risk-on", "neutral", "risk-off"]) markets[m] = group(signal.filter((r) => r[I.mk] === m));
  const outcomes = {};
  for (const o of ["pick", "gate", "below-bar", "open"]) outcomes[o] = group(rows.filter((r) => outClass(r[I.out]) === o));
  // AI grader: buy-now vs wait vs not graded, names at or above the trade bar.
  const graded = rows.filter((r) => Math.abs(num(r[I.tot]) ?? 0) >= tradeBar);
  const evGroup = (list) => ({ "buy-now": group(list.filter((r) => r[I.ev] === "buy-now")), wait: group(list.filter((r) => r[I.ev] === "wait")), none: group(list.filter((r) => r[I.ev] == null)) });
  const mid = days.length >= 2 ? days[Math.floor(days.length / 2)] : null;
  const grader = {
    bar: tradeBar,
    groups: evGroup(graded),
    halves: mid ? { first: evGroup(graded.filter((r) => r[I.d] < mid)), second: evGroup(graded.filter((r) => r[I.d] >= mid)), split: mid } : null,
    gradedRows: graded.filter((r) => r[I.ev] != null && r[I.r10] != null).length,
  };
  // Rank skill: Spearman between the total and the 10-day move, per run.
  const byRun = new Map();
  for (const r of complete) {
    const k = `${r[I.d]}|${r[I.et]}`;
    if (!byRun.has(k)) byRun.set(k, []);
    byRun.get(k).push(r);
  }
  const ics = [];
  for (const list of byRun.values()) {
    const ic = spearman(list.map((r) => num(r[I.tot]) ?? 0), list.map((r) => num(r[I.r10])));
    if (ic != null) ics.push(ic);
  }
  const ic = ics.length ? { runs: ics.length, avg: Math.round((ics.reduce((a, b) => a + b, 0) / ics.length) * 1000) / 1000, positiveShare: Math.round((ics.filter((x) => x > 0).length / ics.length) * 100) } : { runs: 0, avg: null, positiveShare: null };
  return {
    rows: rows.length, complete: complete.length, runs: runs.size, days: days.length,
    first: days[0] || null, last: days[days.length - 1] || null,
    horizons, bands, markets, outcomes, grader, ic,
  };
}

// ---- random control book ---------------------------------------------------

function hash32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function seededRandom(seedText) {
  let a = hash32(String(seedText || "seed")) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function compactControlContract(c) {
  if (!c || !(num(c.strike) > 0) || !(num(c.expiry ?? c.expSec) > 0) || !(num(c.mid) > 0)) return null;
  return {
    structure: "long", strike: r2(num(c.strike)), expiry: num(c.expiry ?? c.expSec), dte: num(c.dte),
    bid: r2(num(c.bid)), ask: r2(num(c.ask)), mid: r2(num(c.mid)), iv: num(c.iv) != null ? Math.round(num(c.iv) * 10000) / 10000 : null,
    delta: num(c.delta) != null ? Math.round(num(c.delta) * 1000) / 1000 : null,
    thetaDay: num(c.thetaDay) != null ? Math.round(num(c.thetaDay) * 10000) / 10000 : null,
  };
}

// Draw k random (name, side) pairs from the run's scored universe, skipping
// the names the run shipped and the names already open in either book. The
// contract comes from the engine's own picker; a name it cannot price is
// skipped and another is drawn.
export function drawControlEntries({ run, chains, contractFor, exclude = new Set(), k = CONTROL_PER_RUN_MIN, builtAtIso, exitPolicy = null } = {}) {
  if (!run || !Array.isArray(run.rows) || !chains || typeof contractFor !== "function") return [];
  const rnd = seededRandom(`control|${builtAtIso || run.builtAtIso || ""}`);
  const pool = run.rows
    .filter((r) => r && SYM_RE.test(String(r.s || "")) && !exclude.has(r.s) && chains[r.s] && num(chains[r.s].spot) > 0)
    .map((r) => r.s);
  // Fisher-Yates on the pool, then take the first k that price.
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const want = Math.max(0, Math.min(CONTROL_PER_RUN_MAX, Math.round(num(k) ?? CONTROL_PER_RUN_MIN)));
  const out = [];
  const totBySym = new Map(run.rows.map((r) => [r.s, num(r.tot)]));
  for (const sym of pool) {
    if (out.length >= want) break;
    const side = rnd() < 0.5 ? "call" : "put";
    let c = null;
    try { c = compactControlContract(contractFor(sym, side)); } catch { c = null; }
    if (!c) continue;
    out.push({
      symbol: sym, side, entryDate: builtAtIso || run.builtAtIso || null, entrySpot: r2(num(chains[sym].spot)),
      tot: r2(totBySym.get(sym)), contract: c, exitPolicy: exitPolicy || null,
      optionPnlPct: 0, optHiPct: 0, optLoPct: 0, lastSpot: r2(num(chains[sym].spot)),
    });
  }
  return out;
}

export function addControlEntries(control, entries) {
  if (!control || !Array.isArray(entries) || !entries.length) return 0;
  const have = new Set([...control.open, ...control.closed].map((e) => `${e.symbol}:${e.side}:${e.entryDate}`));
  let added = 0;
  for (const e of entries) {
    const key = `${e.symbol}:${e.side}:${e.entryDate}`;
    if (have.has(key)) continue;
    have.add(key);
    control.open.push(e);
    added++;
  }
  control.drawn = (control.drawn || 0) + added;
  if (!control.since && added) control.since = entries[0].entryDate;
  return added;
}

// Mark every open control trade with the engine's own model and exits.
//   markFn(entry, data)   -> option P&L % (markOptionToMarket)
//   resolveFn(opts)       -> { status, outcome } | null (resolvePickOutcome)
//   outcomeFn(pnlPct)     -> win / loss / flat / void
export function markControlBook(control, { chains, builtAtIso, markFn, resolveFn, outcomeFn, exitPolicy } = {}) {
  if (!control || !chains || typeof markFn !== "function" || typeof resolveFn !== "function") return { marked: 0, closed: 0 };
  const nowSec = Math.floor(Date.parse(builtAtIso || "") / 1000) || Math.floor(Date.now() / 1000);
  const still = [];
  let marked = 0, closedNow = 0;
  for (const e of control.open) {
    const data = chains[e.symbol] || null;
    const spot = num(data?.spot);
    if (data) delete e.missingBuilds; else e.missingBuilds = (e.missingBuilds || 0) + 1;
    let pnl = null;
    try { pnl = data ? markFn(e, data) : null; } catch { pnl = null; }
    if (pnl == null) pnl = num(e.optionPnlPct);
    const optHi = Math.max(num(e.optHiPct) ?? -Infinity, pnl ?? -Infinity);
    const optLo = Math.min(num(e.optLoPct) ?? Infinity, pnl ?? Infinity);
    const m = { ...e, lastSpot: r2(spot ?? e.lastSpot ?? e.entrySpot), optionPnlPct: r1(pnl), optHiPct: Number.isFinite(optHi) ? r1(optHi) : null, optLoPct: Number.isFinite(optLo) ? r1(optLo) : null };
    const policy = e.exitPolicy || exitPolicy || null;
    let res = null;
    try {
      res = resolveFn({
        exitPolicy: policy, isCall: e.side === "call", cur: spot, ref: e.entrySpot, expSec: e.contract?.expiry,
        entrySec: Math.floor(Date.parse(e.entryDate) / 1000), nowSec, inUniverse: !!data || (e.missingBuilds || 0) < CONTROL_DROPPED_MISSES,
        modeledOptPnlPct: pnl, thetaPctDay: e.contract?.thetaDay && e.contract?.mid ? Math.abs(e.contract.thetaDay) / e.contract.mid : null,
        structure: "long", scaledOutPnlPct: null, peakPnlPct: Number.isFinite(optHi) ? optHi : null, stopUnder: null, vehicleStopUnder: null, thesisBroken: false,
      });
    } catch { res = null; }
    marked++;
    if (res && res.status) {
      const outcome = res.outcome || (typeof outcomeFn === "function" ? outcomeFn(pnl) : null);
      control.closed.unshift({ ...m, exitDate: builtAtIso, exitSpot: m.lastSpot, status: res.status, outcome });
      closedNow++;
    } else still.push(m);
  }
  control.open = still;
  if (control.closed.length > CONTROL_MAX_CLOSED) control.closed = control.closed.slice(0, CONTROL_MAX_CLOSED);
  return { marked, closed: closedNow };
}

function describe(list) {
  const n = list.length;
  if (!n) return { n: 0, wins: 0, winPct: null, avgPnl: null, medianPnl: null };
  const wins = list.filter((t) => t.win).length;
  const pnls = list.map((t) => t.pnl).sort((a, b) => a - b);
  return { n, wins, winPct: Math.round((wins / n) * 100), avgPnl: r1(pnls.reduce((a, b) => a + b, 0) / n), medianPnl: r1(pnls[Math.floor(n / 2)]) };
}

// Decided control trades vs decided picks opened since the control started.
// beatsPct: the share of 2,000 same-size random books (resampled from the
// control trades) whose average P&L the picks' average beats.
export function summarizeControl(control, decidedPicks = []) {
  const since = control?.since || null;
  // Compared by ET date: the control's start is a build stamp, a pick's
  // entryDate may be a stamp or a date.
  const sinceDay = since ? String(since).slice(0, 10) : null;
  const ctrl = (control?.closed || [])
    .filter((e) => (e.outcome === "win" || e.outcome === "loss") && num(e.optionPnlPct) != null)
    .map((e) => ({ pnl: num(e.optionPnlPct), win: e.outcome === "win" }));
  const picks = (Array.isArray(decidedPicks) ? decidedPicks : [])
    .filter((t) => t && num(t.pnl) != null && (!sinceDay || !t.entryDate || String(t.entryDate).slice(0, 10) >= sinceDay))
    .map((t) => ({ pnl: num(t.pnl), win: t.win === true || (t.win == null && num(t.pnl) > 0) }));
  const c = describe(ctrl), p = describe(picks);
  let beatsPct = null;
  if (ctrl.length >= 10 && picks.length >= 5) {
    const rnd = seededRandom(`beats|${ctrl.length}|${picks.length}`);
    let beaten = 0;
    const draws = 2000;
    for (let i = 0; i < draws; i++) {
      let s = 0;
      for (let j = 0; j < picks.length; j++) s += ctrl[Math.floor(rnd() * ctrl.length)].pnl;
      if (p.avgPnl > s / picks.length) beaten++;
    }
    beatsPct = Math.round((beaten / draws) * 100);
  }
  return { since, open: control?.open?.length || 0, drawn: control?.drawn || 0, control: c, picks: p, beatsPct };
}
