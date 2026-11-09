// Regime Lab: the timeframe test harness (C1-C8, 2026-11-09).
//
// One call: a window, a strategy and an exit rule set in, one scored row out.
// It replays point-in-time grades (the engine's price half on long history,
// or daily totals) over saved daily bars, opens modeled option positions
// (lib/regime-lab/options-model.mjs), applies a playbook (playbooks.mjs) and
// an exit rule set (exits.mjs), and scores every run the same way (C4):
// average return per trade after costs first, then drawdown, win rate as the
// tie-break, plus the rank against random-name control books.
//
// Guards built in: labels must be causal (G1: a decision on day D reads the
// label computed through the prior close); strategies never see a window's
// name or reason (G2); holdout windows are refused unless unlocked once
// (G3); every window before real option history is tagged "price half only"
// (G5); stress mode doubles costs and crushes IV after events (G6 / F22);
// whipsaw rate is a first-class metric (G9).
//
// Pure given its inputs; no file or network access.

import { labelIndex } from "./labels.mjs";
import { decideEntry, strategyPlaybook, PLAYBOOK_BY_ID, STRATEGIES } from "./playbooks.mjs";
import { resolveExitParams, riskScore, whipsawRate, themeOf as defaultThemeOf, EXIT_RULE_SETS } from "./exits.mjs";
import { ivProxy, openPosition, markPosition, netOfCosts, eventIv, MODEL_DEFAULTS, realizedVol } from "./options-model.mjs";
import { seededRandom } from "../picks-outcomes.mjs";

export const HARNESS_VERSION = "2026-11-09-harness-v1";
// Real implied volatility exists from this date; earlier windows are price half only (G5).
export const REAL_IV_SINCE = "2026-05-25";

// C1. Named windows. `why` is for the report only (G2).
export const WINDOWS = Object.freeze([
  { id: "2026-rally", from: "2026-01-02", to: "2026-06-12", why: "YTD replay first half: the rally where gate-off made +14% a trade" },
  { id: "2026-slide", from: "2026-06-15", to: "2026-11-06", why: "YTD second half: the slide where the same rules lost", holdout: true },
  { id: "2026-midterm-week", from: "2026-11-02", to: "2026-11-06", why: "The Nov 5 midterm drop week" },
  { id: "2008-crisis", from: "2008-01-02", to: "2009-03-31", why: "Financial crisis" },
  { id: "2011-chop", from: "2011-01-03", to: "2011-12-30", why: "Debt-ceiling chop" },
  { id: "2017-calm-trend", from: "2017-01-03", to: "2017-12-29", why: "Lowest-volatility trend year" },
  { id: "2018-vol-spike", from: "2018-01-02", to: "2018-04-30", why: "February 2018 volatility spike" },
  { id: "2020-crash-rebound", from: "2020-02-03", to: "2020-08-31", why: "Covid crash and rebound" },
  { id: "2022-bear", from: "2022-01-03", to: "2022-12-30", why: "Rate-hike bear market", holdout: true },
  { id: "2023-ai-rally", from: "2023-01-03", to: "2023-12-29", why: "AI rally" },
  { id: "2024-2025", from: "2024-01-02", to: "2025-12-31", why: "The two years before the live record" },
  { id: "2008-2025", from: "2008-01-02", to: "2025-12-31", why: "Everything before 2026 at once (training years)" },
]);
export const HOLDOUT_WINDOW_IDS = Object.freeze(WINDOWS.filter((w) => w.holdout).map((w) => w.id));

export const HARNESS_DEFAULTS = Object.freeze({
  bar: 4, maxOpen: 8, sectorCap: 3, structure: "long", dte: MODEL_DEFAULTS.dte, delta: MODEL_DEFAULTS.delta,
  minDteExit: MODEL_DEFAULTS.minDteExit, stress: false, eventBumpSessions: 7, missesToVoid: 3, controlPerDay: 2, controlBooks: 500,
});

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

function addMonths(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Context: everything a simulation reads, prepared once per data set.
// ---------------------------------------------------------------------------
export function makeContext({ cal, bars, grades, labels = null, sectorOf = () => null, themeOf = null, isEtf = () => false, events = null, ivRatio = null } = {}) {
  if (!Array.isArray(cal) || !cal.length) throw new Error("makeContext needs a trading calendar");
  if (labels && labels.centered) throw new Error("G1: a centered label series cannot drive a strategy");
  const calIdx = new Map(cal.map((d, i) => [d, i]));
  const syms = {};
  for (const [sym, b] of Object.entries(bars || {})) {
    if (!b || !Array.isArray(b.t) || !Array.isArray(b.c) || b.t.length !== b.c.length) continue;
    const idx = new Map(b.t.map((t, i) => [t, i]));
    syms[sym] = { t: b.t, c: b.c, h: b.h || b.c, l: b.l || b.c, idx };
  }
  const gradeDays = Object.keys(grades || {}).filter((d) => calIdx.has(d)).sort();
  const lab = labels ? labelIndex(labels) : null;
  const earningsOf = (sym) => (events?.earnings?.[sym]) || [];
  return {
    cal, calIdx, syms, grades: grades || {}, gradeDays, gradeDaySet: new Set(gradeDays), labels, lab,
    sectorOf, themeOf: themeOf || ((s) => defaultThemeOf(s, sectorOf)), isEtf, earningsOf, macroEvents: events?.macro || [],
    ivRatioOf: (sym) => (ivRatio && Number.isFinite(ivRatio[sym]) ? ivRatio[sym] : MODEL_DEFAULTS.ivRvRatio),
    // Per-symbol helpers.
    barAt(sym, date) { const s = this.syms[sym]; if (!s) return null; const i = s.idx.get(date); return i == null ? null : { i, c: s.c[i], h: s.h[i], l: s.l[i] }; },
    atrPct(sym, i) { const s = this.syms[sym]; if (!s || i < 15) return null; let a = 0; for (let k = i - 13; k <= i; k++) a += Math.max(s.h[k] - s.l[k], Math.abs(s.h[k] - s.c[k - 1]), Math.abs(s.l[k] - s.c[k - 1])); return (a / 14 / s.c[i]) * 100; },
    volRank(sym, i) { const s = this.syms[sym]; if (!s || i < 80) return null; const cur = realizedVol(s.c, 20, i); if (cur == null) return null; let below = 0, n = 0; for (let k = Math.max(60, i - 252); k < i; k += 5) { const v = realizedVol(s.c, 20, k); if (v == null) continue; n++; if (v < cur) below++; } return n >= 10 ? (below / n) * 100 : null; },
    nextEarnings(sym, date) { for (const d of this.earningsOf(sym)) if (d >= date) return d; return null; },
  };
}

// Index range of a window on the calendar (inclusive).
export function windowRange(ctx, from, to) {
  let a = ctx.cal.findIndex((d) => d >= from);
  if (a < 0) return null;
  let b = ctx.cal.length - 1;
  while (b > a && ctx.cal[b] > to) b--;
  return a <= b ? { a, b, from: ctx.cal[a], to: ctx.cal[b] } : null;
}

export function priceHalfOnly(from) { return from < REAL_IV_SINCE; }

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------
export function simulate(ctx, cfg = {}) {
  const c = { ...HARNESS_DEFAULTS, ...cfg };
  if (!c.window || !c.window.from || !c.window.to) throw new Error("simulate needs cfg.window {from,to}");
  const rng = windowRange(ctx, c.window.from, c.window.to);
  if (!rng) return { trades: [], days: 0, config: c, empty: true };
  const strategyId = typeof c.strategy === "string" ? c.strategy : (c.strategy?.id || "same-rules");
  const customDecide = typeof c.strategy === "object" && typeof c.strategy?.decide === "function" ? c.strategy.decide : null;
  const exits = c.exits || "flat-50";
  const open = [];
  const trades = [];
  const equity = [];
  let cum = 0, exposureDays = 0, dailyLossBlocks = 0;
  const rnd = seededRandom(`sim|${strategyId}|${exits}|${c.window.from}|${c.seed ?? 0}`);

  const ivAt = (sym, i, date, pos = null) => {
    const s = ctx.syms[sym];
    let iv = ivProxy(s.c, i, ctx.ivRatioOf(sym));
    if (iv == null) return null;
    const next = ctx.nextEarnings(sym, date);
    if (next) {
      const ni = ctx.calIdx.get(next), ci = ctx.calIdx.get(date);
      if (ni != null && ci != null && ni - ci >= 0 && ni - ci <= c.eventBumpSessions) iv = eventIv(iv, { phase: "before" });
    }
    if (pos && c.stress && pos.eventCrossed) iv = eventIv(iv, { phase: "after" });
    return iv;
  };

  const closeTrade = (pos, i, date, why, gross, extra = {}) => {
    const net = netOfCosts(gross, pos.structure, { stress: c.stress });
    const s = ctx.syms[pos.sym];
    const bi = s.idx.get(date);
    const spotNow = bi != null ? s.c[bi] : pos.lastSpot;
    const t = {
      sym: pos.sym, side: pos.side, structure: pos.structure, entry: pos.entryDate, exit: date, why, held: pos.held,
      gross: r1(gross), net, size: pos.size, total: pos.total, cell: pos.cell, era: pos.era, character: pos.character, transition: pos.transition,
      playbook: pos.playbook, exits: pos.exitsId, stopPct: pos.stopPct, tpPct: pos.tpPct, riskScore: pos.riskScore, eventInWindow: pos.eventInWindow,
      stockMovePct: r2(pos.dir * (spotNow / pos.spot0 - 1) * 100), peakPct: r1(pos.peak), troughPct: r1(pos.trough), ...extra,
    };
    trades.push(t);
    cum += net * pos.size;
    return t;
  };

  // Would a stopped trade have reached its target within five sessions? A
  // metric only (E9/G9); it reads forward closes after the exit decision.
  const wouldHaveHitTp = (pos, i, date) => {
    const s = ctx.syms[pos.sym];
    const bi = s.idx.get(date);
    if (bi == null) return false;
    for (let k = 1; k <= 5 && bi + k < s.c.length; k++) {
      const g = markPosition(pos.model, { spot: s.c[bi + k], iv: pos.model.iv0, sessionsHeld: pos.held + k });
      if (g != null && g >= pos.tpPct) return true;
    }
    return false;
  };

  for (let i = rng.a; i <= rng.b; i++) {
    const date = ctx.cal[i];
    const isLast = i === rng.b;
    const label = ctx.lab ? ctx.lab.priorClose(date) : null;
    const era = label?.era || "normal", character = label?.character || null;
    let stopsToday = 0;
    // 1. Mark and exit.
    for (let k = open.length - 1; k >= 0; k--) {
      const pos = open[k];
      const s = ctx.syms[pos.sym];
      const bi = s.idx.get(date);
      pos.held++;
      if (bi == null) { pos.misses++; if (pos.misses >= c.missesToVoid) { closeTrade(pos, i, date, "void", 0, { void: true }); open.splice(k, 1); } continue; }
      pos.misses = 0;
      const spot = s.c[bi];
      pos.lastSpot = spot;
      if (pos.nextEvent && date >= pos.nextEvent) pos.eventCrossed = true;
      const iv = ivAt(pos.sym, bi, date, pos) ?? pos.model.iv0;
      let gross = markPosition(pos.model, { spot, iv, sessionsHeld: pos.held });
      if (gross == null) continue;
      pos.peak = Math.max(pos.peak, gross); pos.trough = Math.min(pos.trough, gross);
      // Partial take-profit: bank half at the target, trail the rest.
      if (pos.partial && !pos.banked && gross >= pos.tpPct) { pos.banked = true; pos.bankedPnl = gross; pos.trailFloor = Math.max(0, gross - (pos.trailPts || 25)); }
      if (pos.banked) pos.trailFloor = Math.max(pos.trailFloor, gross - (pos.trailPts || 25));
      else if (pos.trailPts != null && pos.peak >= pos.tpPct) pos.trailFloor = Math.max(pos.trailFloor ?? -Infinity, pos.peak - pos.trailPts);
      const daysLeft = pos.model.dte - pos.held * (365 / 252);
      let why = null;
      if (daysLeft <= c.minDteExit) why = "expiry";
      else if (pos.banked && gross <= pos.trailFloor) why = "trail";
      else if (!pos.banked && pos.trailFloor != null && pos.trailFloor > -Infinity && gross <= pos.trailFloor && pos.peak >= pos.tpPct) why = "trail";
      else if (!pos.partial && pos.trailPts == null && gross >= pos.tpPct) why = "tp";
      else if (gross <= pos.stopPct) why = "stop";
      else if (pos.timeStop != null && pos.held >= pos.timeStop && gross < 5) why = "time";
      else if (pos.gradeFade && ctx.grades[date] && num(ctx.grades[date][pos.sym]) != null && (pos.dir * ctx.grades[date][pos.sym]) < c.bar) why = "grade-fade";
      else if (isLast) why = "window-end";
      if (why) {
        if (pos.banked) gross = 0.5 * pos.bankedPnl + 0.5 * gross;
        const extra = {};
        if (why === "stop") { stopsToday++; extra.wouldHaveHitTp = wouldHaveHitTp(pos, i, date); }
        closeTrade(pos, i, date, why, gross, extra);
        open.splice(k, 1);
      }
    }
    if (open.length) exposureDays++;
    // 2. Entries, only on days with grades.
    const today = ctx.grades[date];
    if (today && !isLast) {
      const playbookId = customDecide ? null : strategyPlaybook(strategyId, label) || "same-rules";
      const pb = playbookId ? PLAYBOOK_BY_ID[playbookId] : null;
      const exitTemplate = resolveExitParams(exits, { era, character, premium: 1 });
      let capacity = Math.min(c.maxOpen, pb ? (pb.maxOpen === "brakes" ? resolveExitParams("brakes", { era }).maxOpen : num(pb.maxOpen) ?? c.maxOpen) : c.maxOpen, exitTemplate.maxOpen ?? Infinity);
      if (pb?.closeWeakest && label?.transition && open.length > Math.max(1, Math.floor(capacity / 2))) {
        // Close the weakest open trade first (B5).
        let worst = null;
        for (const pos of open) { const s = ctx.syms[pos.sym]; const bi = s.idx.get(date); if (bi == null) continue; const g = markPosition(pos.model, { spot: s.c[bi], iv: pos.model.iv0, sessionsHeld: pos.held }); if (g != null && (!worst || g < worst.g)) worst = { pos, g }; }
        if (worst) { closeTrade(worst.pos, i, date, "transition-trim", worst.g); open.splice(open.indexOf(worst.pos), 1); }
      }
      const blocked = exitTemplate.dailyLossLimitTrades != null && stopsToday >= exitTemplate.dailyLossLimitTrades;
      if (blocked) dailyLossBlocks++;
      const openSyms = new Set(open.map((p) => p.sym));
      const cands = Object.entries(today)
        .map(([sym, tot]) => ({ sym, total: num(tot) }))
        .filter((x) => x.total != null && Math.abs(x.total) >= c.bar && !openSyms.has(x.sym) && ctx.syms[x.sym])
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || a.sym.localeCompare(b.sym));
      for (const cand of cands) {
        if (blocked || open.length >= capacity) break;
        const s = ctx.syms[cand.sym];
        const bi = s.idx.get(date);
        if (bi == null || bi < 60) continue;
        const spot = s.c[bi];
        const side = cand.total > 0 ? "call" : "put";
        const bars = []; for (let k = Math.max(0, bi - 25); k <= bi; k++) bars.push({ c: s.c[k], h: s.h[k], l: s.l[k] });
        let s20 = Infinity, r20 = -Infinity; for (let k = bi - 20; k < bi; k++) { s20 = Math.min(s20, s.l[k]); r20 = Math.max(r20, s.h[k]); }
        let decision;
        if (customDecide) decision = customDecide({ sym: cand.sym, side, total: cand.total, spot, s20, r20, bars, label, era, character });
        else decision = decideEntry(pb, { sym: cand.sym, side, total: cand.total, spot, s20, r20, bars, label, era, character });
        if (!decision?.take) continue;
        // Caps: sector and theme.
        const sector = ctx.sectorOf(cand.sym);
        if (sector && c.sectorCap && open.filter((p) => p.sector === sector).length >= c.sectorCap) continue;
        const theme = ctx.themeOf(cand.sym);
        if (theme && exitTemplate.themeCap != null && open.filter((p) => p.theme === theme).length >= exitTemplate.themeCap) continue;
        const iv = ivAt(cand.sym, bi, date);
        if (iv == null) continue;
        const model = openPosition({ structure: c.structure, side, spot, iv, dte: c.dte, delta: c.delta });
        if (!model) continue;
        const nextEvent = ctx.nextEarnings(cand.sym, date);
        const ni = nextEvent ? ctx.calIdx.get(nextEvent) : null;
        const eventInWindow = ni != null && ni - i <= Math.round(c.dte * 252 / 365);
        const rv20 = realizedVol(s.c, 20, bi);
        const ex = resolveExitParams(exits, {
          era, character, volRankPct: ctx.volRank(cand.sym, bi), atrPct: ctx.atrPct(cand.sym, bi), leverage: model.leverage,
          expectedMove5dPct: rv20 != null ? (rv20 / Math.sqrt(252)) * Math.sqrt(5) * 100 : null, premium: model.entryPremium, riskBudgetUsd: c.riskBudgetUsd ?? 500,
        });
        // A flat stop or target in cfg (the walk-forward grid, F15) overrides
        // the playbook's; a rule set that sets its own stop or target keeps it.
        const stopPct = ex.stopMode !== "flat" ? ex.stopPct : (num(c.stopPct) ?? decision.stopPct ?? ex.stopPct);
        const tpPct = ex.id !== "flat-50" && (ex.partial || ex.tpPct !== 25) ? ex.tpPct : (num(c.tpPct) ?? decision.tpPct ?? ex.tpPct);
        const size = r2((decision.size ?? 1) * (ex.sizeMult ?? 1));
        if (!(size > 0)) continue;
        open.push({
          sym: cand.sym, side, dir: side === "put" ? -1 : 1, structure: c.structure, model, spot0: spot, lastSpot: spot, entryDate: date, entryIdx: i, held: 0, misses: 0,
          total: cand.total, cell: label?.cell || null, era: label?.era || null, character, transition: !!label?.transition, playbook: decision.playbook || playbookId || "custom",
          exitsId: ex.id, stopPct, tpPct, partial: ex.partial, trailPts: decision.trailPts ?? ex.trailPts ?? null, trailFloor: null, banked: false, bankedPnl: 0,
          timeStop: ex.timeStop, gradeFade: ex.gradeFade, size, sector, theme, nextEvent, eventCrossed: false, eventInWindow,
          riskScore: riskScore({ structure: c.structure, era, stockVolRankPct: ctx.volRank(cand.sym, bi), dte: c.dte, eventInWindow }).score,
          peak: 0, trough: 0,
        });
      }
    }
    equity.push({ date, cum: r1(cum), open: open.length });
  }
  // Anything still open at the end of the window closes at the last mark.
  const lastDate = ctx.cal[rng.b];
  for (const pos of open.splice(0)) {
    const s = ctx.syms[pos.sym]; const bi = s.idx.get(lastDate);
    const g = bi != null ? markPosition(pos.model, { spot: s.c[bi], iv: pos.model.iv0, sessionsHeld: pos.held }) : 0;
    closeTrade(pos, rng.b, lastDate, "window-end", g ?? 0);
  }
  return { trades, days: rng.b - rng.a + 1, exposureDays, equity, dailyLossBlocks, config: { ...c, strategy: strategyId, exits }, window: { from: rng.from, to: rng.to }, priceHalfOnly: priceHalfOnly(rng.from), rngSeed: rnd() };
}

// ---------------------------------------------------------------------------
// C4. Scorecard
// ---------------------------------------------------------------------------
export function scorecard(result, { pool = null, books = HARNESS_DEFAULTS.controlBooks, seed = "score" } = {}) {
  const trades = (result?.trades || []).filter((t) => !t.void && Number.isFinite(t.net));
  const n = trades.length;
  const nets = trades.map((t) => t.net);
  const sum = nets.reduce((a, b) => a + b, 0);
  const wins = nets.filter((x) => x > 0), losses = nets.filter((x) => x < 0);
  const sumW = wins.reduce((a, b) => a + b, 0), sumL = Math.abs(losses.reduce((a, b) => a + b, 0));
  const sorted = nets.slice().sort((a, b) => a - b);
  const worst5 = sorted.slice(0, 5).reduce((a, b) => a + b, 0);
  const best3 = sorted.slice(-3).reduce((a, b) => a + b, 0);
  const months = result?.days ? result.days / 21 : null;
  let cum = 0, peak = 0, dd = 0;
  for (const t of trades.slice().sort((a, b) => a.exit.localeCompare(b.exit))) { cum += t.net * (t.size ?? 1); peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  const out = {
    n, avgNet: n ? r1(sum / n) : null, medianNet: n ? r1(sorted[Math.floor(n / 2)]) : null, winPct: n ? Math.round((wins.length / n) * 100) : null,
    profitFactor: sumL > 0 ? r2(sumW / sumL) : (sumW > 0 ? null : null), maxDrawdownPts: r1(dd),
    worst5SharePct: sumW > 0 ? Math.round((Math.abs(worst5) / sumW) * 100) : null,
    avgNetDropTop3: n > 3 ? r1((sum - best3) / (n - 3)) : null,
    exposurePct: result?.days ? Math.round((result.exposureDays / result.days) * 100) : null,
    tradesPerMonth: months ? r1(n / months) : null,
    avgHold: n ? r1(trades.reduce((a, t) => a + (t.held || 0), 0) / n) : null,
    whipsawPct: whipsawRate(trades),
    totalPts: r1(sum),
    controlRankPct: null, controlAvgNet: null, controlN: pool ? pool.length : 0,
  };
  if (pool && pool.length >= 20 && n >= 5) {
    const rnd = seededRandom(`${seed}|${pool.length}|${n}`);
    let beaten = 0;
    for (let b = 0; b < books; b++) { let s = 0; for (let j = 0; j < n; j++) s += pool[Math.floor(rnd() * pool.length)].net; if (out.avgNet > s / n) beaten++; }
    out.controlRankPct = Math.round((beaten / books) * 100);
    out.controlAvgNet = r1(pool.reduce((a, t) => a + t.net, 0) / pool.length);
  }
  return out;
}

// Random-name control pool for a window: on every grade day, `perDay` random
// (name, side) pairs with the baseline exits, each as a standalone position.
export function controlPool(ctx, cfg = {}, { perDay = HARNESS_DEFAULTS.controlPerDay, seed = "control" } = {}) {
  const c = { ...HARNESS_DEFAULTS, ...cfg };
  const rng = windowRange(ctx, c.window.from, c.window.to);
  if (!rng) return [];
  const rnd = seededRandom(`${seed}|${c.window.from}|${c.window.to}`);
  const names = Object.keys(ctx.syms);
  const pool = [];
  for (let i = rng.a; i < rng.b; i++) {
    const date = ctx.cal[i];
    if (!ctx.grades[date]) continue;
    for (let k = 0; k < perDay; k++) {
      const sym = names[Math.floor(rnd() * names.length)];
      const side = rnd() < 0.5 ? "call" : "put";
      const s = ctx.syms[sym];
      const bi = s.idx.get(date);
      if (bi == null || bi < 60) continue;
      const iv = ivProxy(s.c, bi, ctx.ivRatioOf(sym));
      if (iv == null) continue;
      const model = openPosition({ structure: c.structure, side, spot: s.c[bi], iv, dte: c.dte, delta: c.delta });
      if (!model) continue;
      let held = 0, gross = 0, why = "window-end";
      for (let j = bi + 1; j < s.c.length; j++) {
        held++;
        if (ctx.cal[i + held] == null || ctx.cal[i + held] > c.window.to) break;
        gross = markPosition(model, { spot: s.c[j], iv: model.iv0, sessionsHeld: held });
        if (gross == null) continue;
        if (model.dte - held * (365 / 252) <= c.minDteExit) { why = "expiry"; break; }
        if (gross >= 25) { why = "tp"; break; }
        if (gross <= -50) { why = "stop"; break; }
      }
      pool.push({ sym, side, entry: date, held, net: netOfCosts(gross ?? 0, c.structure, { stress: c.stress }), why });
    }
  }
  return pool;
}

// ---------------------------------------------------------------------------
// Slices: by regime cell, by half of the window.
// ---------------------------------------------------------------------------
export function byCell(trades) {
  const out = {};
  for (const t of trades || []) {
    if (t.void || !Number.isFinite(t.net)) continue;
    const k = t.cell || "unlabeled";
    (out[k] = out[k] || { n: 0, sum: 0, wins: 0 });
    out[k].n++; out[k].sum += t.net; if (t.net > 0) out[k].wins++;
  }
  for (const k of Object.keys(out)) { const o = out[k]; o.avgNet = r1(o.sum / o.n); o.winPct = Math.round((o.wins / o.n) * 100); delete o.sum; }
  return out;
}

export function midpoint(from, to) {
  const a = Date.parse(from + "T12:00:00Z"), b = Date.parse(to + "T12:00:00Z");
  return new Date((a + b) / 2).toISOString().slice(0, 10);
}

export function byHalf(trades, from, to) {
  const mid = midpoint(from, to);
  const first = (trades || []).filter((t) => t.entry < mid), second = (trades || []).filter((t) => t.entry >= mid);
  const desc = (list) => { const xs = list.filter((t) => !t.void && Number.isFinite(t.net)); return { n: xs.length, avgNet: xs.length ? r1(xs.reduce((a, t) => a + t.net, 0) / xs.length) : null }; };
  return { mid, first: desc(first), second: desc(second) };
}

// ---------------------------------------------------------------------------
// C5. Three verdicts per setup.
// ---------------------------------------------------------------------------
export function verdicts(result, { pool = null, minCellTrades = 5 } = {}) {
  const trades = (result?.trades || []).filter((t) => !t.void && Number.isFinite(t.net));
  const { from, to } = result.window;
  const mid = midpoint(from, to);
  const halves = [trades.filter((t) => t.entry < mid), trades.filter((t) => t.entry >= mid)];
  const poolHalves = pool ? [pool.filter((t) => t.entry < mid), pool.filter((t) => t.entry >= mid)] : [null, null];
  const halfRanks = halves.map((h, i) => scorecard({ trades: h, days: result.days / 2, exposureDays: 0 }, { pool: poolHalves[i], books: 300, seed: `half${i}` }).controlRankPct);
  const beatRandomBothHalves = halfRanks.every((r) => r != null) ? halfRanks.every((r) => r >= 60) : null;
  const card = scorecard(result);
  const survivesTop3 = card.n >= 8 ? card.avgNetDropTop3 > 0 : null;
  const cells = byCell(trades);
  const judged = Object.entries(cells).filter(([k, v]) => k !== "unlabeled" && v.n >= minCellTrades);
  const positive = judged.filter(([, v]) => v.avgNet > 0).length;
  const cellsPositive = judged.length >= 4 ? positive >= 4 : null;
  const passes = [beatRandomBothHalves, survivesTop3, cellsPositive];
  return {
    beatRandomBothHalves, halfRanks, survivesTop3, avgNetDropTop3: card.avgNetDropTop3, cellsPositive, cellsJudged: judged.length, cellsPositiveCount: positive,
    verdict: passes.some((p) => p === null) ? "insufficient" : passes.every(Boolean) ? "pass" : "fail",
  };
}

// ---------------------------------------------------------------------------
// C6. Walk-forward: fit on `fitMonths`, test on the next `testMonths`, slide.
// Only the stitched out-of-sample path is reported.
// ---------------------------------------------------------------------------
export function walkForward(ctx, baseCfg, { grid, from, to, fitMonths = 6, testMonths = 2, minTrades = 8 } = {}) {
  if (!Array.isArray(grid) || !grid.length) throw new Error("walkForward needs a parameter grid");
  const steps = [];
  const oos = [];
  let fitFrom = from;
  let tried = 0;
  while (true) {
    const fitTo = addMonths(fitFrom, fitMonths);
    const testTo = addMonths(fitTo, testMonths);
    if (fitTo >= to) break;
    let best = null;
    for (const params of grid) {
      tried++;
      const res = simulate(ctx, { ...baseCfg, ...params, window: { from: fitFrom, to: fitTo } });
      const card = scorecard(res);
      if (card.n < minTrades) continue;
      if (!best || card.avgNet > best.card.avgNet || (card.avgNet === best.card.avgNet && card.maxDrawdownPts < best.card.maxDrawdownPts)) best = { params, card };
    }
    const testWindow = { from: addDaysIso(fitTo, 1), to: testTo < to ? testTo : to };
    let outCard = null;
    if (best) {
      const res = simulate(ctx, { ...baseCfg, ...best.params, window: testWindow });
      outCard = scorecard(res);
      for (const t of res.trades) oos.push({ ...t, step: steps.length, params: best.params });
    }
    steps.push({ fit: { from: fitFrom, to: fitTo }, test: testWindow, chosen: best?.params || null, inSample: best?.card || null, outSample: outCard });
    fitFrom = addMonths(fitFrom, testMonths);
  }
  const oosCard = scorecard({ trades: oos, days: steps.length * testMonths * 21, exposureDays: 0 });
  return { steps, oosTrades: oos, oosScorecard: oosCard, trials: tried, fitMonths, testMonths };
}

function addDaysIso(iso, n) { return new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10); }

export const STRATEGY_IDS = Object.freeze(STRATEGIES.map((s) => s.id));
export const EXIT_RULE_IDS = Object.freeze(EXIT_RULE_SETS.map((r) => r.id));
