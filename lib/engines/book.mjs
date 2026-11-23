// Strategy engines: the book. One step (a) marks every open engine trade and
// shadow trade and closes the ones whose exit rule fired, (b) lets each
// engine learn from what closed, and (c) opens new trades from this run's
// candidates inside each engine's slots. The live bake calls it at the 11:00
// and 15:30 ET decision runs with chain quotes; the history test calls it with
// modeled quotes. Same code, so a rule can't behave differently in the two.
//
// Same-contract rule (owner, 2026-11-15): when the exact contract (ticker,
// expiry, strike, call/put) is already held by another engine or by Top
// Picks, the new trade is still recorded on its own engine's record, labeled
// "held by <engine>", and is not bought a second time in Webull
// (`noMirror`). The holder's trade is labeled "also held by <engine>".
//
// Share trades (2026-11-17): the call side of a setup marked
// `calls: "shares"` buys BOOK.sharesUsd of stock instead of a call
// (sharesContract). It is marked at the stock price, its result is the stock
// move less 0.1% of costs, it exits on stock levels (the setup's own stop or
// 2 ATR under the entry, whichever is higher; Technicals since 2026-11-17: 3
// ATR under the entry and no setup stop; the setup's own target or 3 ATR
// over it), the setup's thesis and event exits, or after 20 sessions. The same-contract
// rule does not apply to it, and the Webull mirror (options only) leaves it
// out: it is a paper record line only.
//
// Core engines (2026-11-17, lib/engines/core.mjs): the Trend follower and the
// Momentum basket keep a standing monthly target. It is brought up to date at
// the top of each step, a holding the new target drops closes as "rotate",
// and the target's names open as share lots of the engine's own size
// (`lotUsd`). They have no stops or targets, never learn, and do not count
// against the book's per-run limit (which exists for the Webull mirror's
// time budget; share trades never reach Webull).
//
// Option size (2026-11-17): an option trade buys about BOOK.optionUsd of
// premium (`contract.qty` contracts, at least one); a trade without `qty` is
// one contract. Results in % are per contract either way.
//
// The Allocator (lib/engines/allocator.mjs) reads each signal-engine
// candidate's record in today's market: a setup that loses there is held
// back (tracked as a shadow trade) and every trade carries the size the
// Allocator would give it (`alloc`).
//
// Honest paper trades (2026-11-19, docs/engines.md "Honest paper trades"):
//   - fill basis: a new option trade (live quotes) books the ask going in and
//     the bid coming out (`fill`, `contract.entryFill`); stops, targets and
//     the trailing exit still fire on the mid (`markPnlPct`), only the booked
//     result (`optionPnlPct`) changes. Trades opened before keep the mid.
//   - risk sizing: 1 to 200 contracts and at most $200,000 of premium (a put 100 and $100,000; Owner Settings ENGINES_MAX_QTY, ENGINES_MAX_PREMIUM_USD, ENGINES_PUT_MAX_QTY, ENGINES_PUT_MAX_PREMIUM_USD; 25 until 2026-11-23, 10 until 2026-11-20) or a share count sized to the risk (at most ENGINES_SHARES_MAX_USD, $250,000)
//     budget, times the conviction multiplier; `size` on the trade says why,
//     `contract.qty` / `contract.flatQty` (shares: `shares` / `flatShares`)
//     keep the conviction size and the flat size apart. A contract dearer
//     than twice the budget is not bought; a call side buys shares instead.
//   - "both": an option trade plus a shares twin (`twinOf`), scored apart,
//     taking one slot between them.
//   - a setup with its own `pool` (the extreme-fear test) has its own slots,
//     run limit and one-trade-per-name rule; `ownFills` keeps it off any
//     contract another trade holds, so it always gets its own Webull fills.
//
// Owner controls (2026-11-19, lib/owner-controls.mjs): the live run passes
// `controls` (the stop, the avoid and watch lists, the risk dial and the
// account limits). Stop and Avoid open nothing (not even a shadow trade),
// Avoid with "close" closes a name's open trades as "owner-avoid" (counted,
// never learned from), Watch moves a name to the front of each engine's
// queue, the dial scales size and moves the entry bar, and the limits hold
// back a trade that would pass them. The history test passes none.
// They come before the pool, twin and sizing steps: Stop and Avoid hold
// every new trade, the dial scales the sized option trade and its twin.
//
// Pure. No network, no AI.

import { ENGINES, ENGINE_IDS, ENGINE_FIXES, BOOK, FLAGSHIP, NOT_COUNTED, engineName, instrumentFor, isSharesTrade, sideMaxQty, sideMaxPremiumUsd, premiumMaxQty, normalizeSharesMaxUsd, newsBlock, tapeRead } from "./config.mjs";
import { EVALUATORS, evalMacro, thesisCheck, withSkips, isRetiredCand } from "./signals.mjs";
import { contractKey, dteOf, expiryExitDate, sharesContract, positionUsd, exitFill, sizeOption, sizeShares, convictionRead } from "./contracts.mjs";
import { newEngineState, observe, adapt, rulesVersion, adoptRules } from "./learn.mjs";
import { standRank } from "./rank.mjs";
import { standCore, evalCore, markCoreViews } from "./core.mjs";
import { allocObserve, allocDecide, allocKey, allocStamp, emptyAlloc } from "./allocator.mjs";
import { tradeUsd } from "./record.mjs";
import { avoidCloses, tradeStamp, scaleContract, LIMIT_LABEL } from "../owner-controls.mjs";
import { brakeObserve, brakeRead, brakeMult, brakeWhy, brakeKeyOf, BRAKE_ENGINES } from "./brake.mjs";
import { etClock } from "../us-equity-calendar.mjs";
import { engineSplitFactor, applyEngineSplit, splitHoldRuns } from "./split.mjs";
import { hedgePauseWhy, bounceSkipWhy } from "./hedge.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);

const ET_ID = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
// TAG:SYMBOL-C|P|S-MM/DD/YY-HH:MM (entry time, ET; S = a share trade). The
// tag keeps two engines that open the same name in the same run apart; the
// rest matches Top Picks.
// A setup with its own pool (the extreme-fear test, 2026-11-19) adds its
// `idSuffix` ("-XF"), so its trades never share an ID with the engine's own
// trade on the same name in the same run.
export function engineTradeId(tag, symbol, side, entryIso, { shares = false, suffix = null } = {}) {
  const p = {};
  for (const x of ET_ID.formatToParts(new Date(entryIso))) p[x.type] = x.value;
  return `${tag}:${symbol}-${shares ? "S" : side === "put" ? "P" : "C"}-${p.month}/${p.day}/${p.year}-${p.hour}:${p.minute}${suffix ? `-${suffix}` : ""}`;
}

export function emptyRecord() { return { version: 1, builtAtIso: null, startedIso: null, open: [], closed: [], archive: {}, flagshipShared: {} }; }
export function emptyState() { return { version: 1, engines: {}, runs: [], lastRunIso: null }; }

export const outcomeOf = (pnl) => { if (!fin(pnl)) return "void"; const p = Math.round(pnl * 10) / 10; return p === 0 ? "flat" : p > 0 ? "win" : "loss"; };

// Mark one trade with a quote. Returns the close reason, or null to hold.
function markAndCheck(t, q, { today, late, nowMs, view }) {
  const entry = Number(t.contract?.mid);
  const exitDay = expiryExitDate(t.contract?.expiry);
  // No quote this run (the name's chain did not load): hold, unless the
  // contract has reached its pre-expiry exit day (the mirror closes the paper
  // position that day whatever the record says) or its last day has passed;
  // then it closes at its last mark.
  if (!(entry > 0) || !q || !(q.mid > 0)) {
    const d0 = dteOf(t.contract?.expiry, nowMs);
    return fin(d0) && d0 <= 0 ? "expired" : exitDay && today >= exitDay ? "dte-exit" : null;
  }
  // A share trade's result is the stock move less its round-trip cost.
  // `pnl` is the mark at the mid: every exit below fires on it.
  const pnl = (q.mid / entry - 1) * 100 - (Number(t.contract?.costPct) || 0);
  t.lastMid = r2(q.mid); t.lastSpot = r2(q.spot); t.markSource = q.source || null;
  // Fill basis (2026-11-19): the booked result is what selling at the bid
  // would get against what the ask cost (`fill.entry`).
  let booked = pnl;
  if (t.fill && Number(t.fill.entry) > 0 && !isSharesTrade(t)) {
    const ex = exitFill(q, t.contract);
    if (ex) { booked = (ex.px / Number(t.fill.entry) - 1) * 100; t.lastBid = r2(ex.px); t.fill.exitBasis = ex.basis; }
    t.markPnlPct = r1(pnl);
  }
  t.optionPnlPct = r1(booked);
  // Best and worst marks stay at the mid (the trailing exit reads them).
  t.hiPct = r1(Math.max(t.hiPct ?? pnl, pnl)); t.loPct = r1(Math.min(t.loPct ?? pnl, pnl));
  if (t.lastMarkDate !== today) { if (today > String(t.entryDate).slice(0, 10)) t.sessions = (t.sessions || 0) + 1; t.lastMarkDate = today; }
  const dte = dteOf(t.contract.expiry, nowMs);
  if (fin(dte) && dte <= 0) return "expired";
  if (exitDay && today >= exitDay) return "dte-exit";
  const x = t.exits || {};
  if (fin(x.tp) && pnl >= x.tp) return "take-profit";
  if (fin(x.stop) && pnl <= x.stop) return "stop";
  // Trailing exit: once the trade has been up `trailArm`, close when it gives
  // back `trailGive` points from its best mark.
  if (fin(x.trailArm) && fin(x.trailGive) && (t.hiPct ?? 0) >= x.trailArm && pnl <= t.hiPct - x.trailGive) return "trail";
  const call = t.side !== "put";
  if (fin(t.stopLevel) && q.spot > 0 && (call ? q.spot <= t.stopLevel : q.spot >= t.stopLevel)) return "stock-stop";
  if (fin(t.targetLevel) && q.spot > 0 && (call ? q.spot >= t.targetLevel : q.spot <= t.targetLevel)) return "target";
  // `exitEarly` (logic audit fix, 2026-11-21, ENGINES_FIX_RUNIN_EARLY): the
  // trade closes at whichever run comes first on its last day, so a late or
  // missed afternoon run never holds it through the report.
  if (t.exitBy && (today > t.exitBy || (today === t.exitBy && (late || t.exitEarly)))) { if (today > t.exitBy) t.exitLate = true; return "event-exit"; }
  const thesis = thesisCheck(t, view);
  if (thesis) return thesis;
  if (fin(x.maxSessions) && (t.sessions || 0) >= x.maxSessions) return "time";
  return null;
}
function closeTrade(t, status, nowIso) {
  t.exitDate = nowIso; t.exitSpot = t.lastSpot ?? null; t.exitMid = t.lastMid ?? null;
  if (t.fill && t.lastBid != null) t.fill.exit = t.lastBid;
  t.status = status; t.outcome = NOT_COUNTED.has(status) ? "void" : outcomeOf(t.optionPnlPct);
  return t;
}

// input:
//   nowIso, today (ET date), late (afternoon run), views { SYM: view }, ctx,
//   quote(trade) -> { mid, spot, source } | null,
//   pick(view, side, spec, candidate) -> contract | { skip },
//   flagshipOpen: [{ tradeId, symbol, contract }], coverage: Set | null,
//   mode: "on" | "pause", off: Set of engine ids that open nothing,
//   learn: bool, engines: ids to run (default all), maxTotal: per-run cap,
//   shares: false puts every setup on options (ENGINES_SHARES=0),
//   closedKept: closed rows kept before folding (the history test keeps all),
//   specs: the engine registry (live: engineSpecs() with the Owner Settings
//     fixes; what-if tests pass their own),
//   allocator: { mode: "on" | "advise" | "off", prior } (the Allocator; its
//     prior is the history test's record, null in the history test itself).
//     Not passed: off (the live run passes the ENGINES_ALLOCATOR switch).
//   optionUsd: premium an option trade buys (BOOK.optionUsd; null = one
//     contract, the size before 2026-11-17), used when `sizing` is not given,
//   sizing: { mode: "risk", budget, conviction } (2026-11-19) or
//     { mode: "premium", optionUsd } / { mode: "one" },
//   fillBasis: true books new option trades at the ask and the bid (needs
//     quotes with a bid and ask: the history test's modeled prices have
//     none and keep their own cost),
//   fearGreed: { score, asOf, source, stale } for the extreme-fear test (also
//     read from ctx.fearGreed),
//   fixesOff: ids of the money-leak fixes switched off (each new trade is
//     stamped with the ones that reach its engine).
//   controls: the Owner controls in force (activeControls() plus `limits`
//     from accountLimits()); null = none (the history test).
//   splitBars: (symbol) -> daily bars [{ t, c }] turns on the stock split
//     guard (lib/engines/split.mjs, 2026-11-20); the live run passes it, the
//     history test (split-adjusted bars, no gaps) does not.
export function stepBook(state, record, input) {
  const { nowIso, today, late = false, views = {}, ctx = {}, quote, pick, flagshipOpen = [], coverage = null,
    mode = "on", off = new Set(), learn = true, engines = ENGINE_IDS, maxTotal = BOOK.perRunTotal, closedKept = BOOK.closedKept, specs = ENGINES, shares = true,
    allocator = { mode: "off", prior: null }, optionUsd = BOOK.optionUsd, fixesOff = [], fillBasis = false, controls = null, splitBars = null,
    brake = null, gate = null } = input;
  const sizing = input.sizing || (optionUsd > 0 ? { mode: "premium", optionUsd } : { mode: "one" });
  const ctl = controls || null, lim = ctl?.limits || null, dial = ctl?.dial && ctl.dial.level !== "normal" ? ctl.dial : null;
  // Safer: one new trade a run across the book.
  const runCap = dial?.perRun ? Math.min(maxTotal, dial.perRun) : maxTotal;
  const allocMode = allocator?.mode || "off", allocPriorRows = allocator?.prior || null;
  const nowMs = Date.parse(nowIso);
  state.engines ||= {}; record.open ||= []; record.closed ||= [];
  if (allocMode !== "off") state.alloc ||= emptyAlloc(today);
  const out = { opened: [], closed: [], shadowOpened: 0, shadowClosed: 0, changes: [], candidates: {} };
  for (const id of engines) {
    state.engines[id] ||= newEngineState(specs[id]);
    // A rule change made by hand (not by the learning layer) bumps the
    // engine's rules version once, with a note in its change log.
    const made = adoptRules(state.engines[id], specs[id], today);
    if (made) out.changes.push({ engine: id, ...made });
  }
  // Fundamentals: bring the standing rank up to date and put each stock's
  // place on its view, before any trade is marked (a holding that left its
  // third closes this run) or opened.
  if (engines.includes("fundamentals")) {
    try {
      const rk = standRank(state.engines.fundamentals, views, { today, coverage });
      for (const sym of rk.order) { const v = views[sym]; if (v?.fund) v.fund.rank = { ...rk.rows[sym], n: rk.n }; }
    } catch (err) { out.errors = [...(out.errors || []), `fundamentals rank: ${String(err?.message || err).split("\n")[0]}`]; }
  }
  // Core engines: the monthly target, and each name's place in it on its view
  // (a holding the new month's target drops closes this run as "rotate").
  for (const id of engines) {
    if (!specs[id]?.core) continue;
    try {
      const es = state.engines[id];
      standCore(es, id, views, ctx, { today, spec: specs[id] }); markCoreViews(views, id, es);
      // The S&P 500 price the day the engine first had a target: its live
      // record is read against the same money left in SPY from that day.
      if (es.core && !es.bench && views.SPY?.spot > 0) es.bench = { date: today, spy: r2(views.SPY.spot) };
    }
    catch (err) { out.errors = [...(out.errors || []), `${id} target: ${String(err?.message || err).split("\n")[0]}`]; }
  }
  // The Allocator counts every finished signal-engine trade, real or shadow.
  // The loser brake (2026-11-21) keeps its own table of the same closes
  // (with the sum of squares, for its t value), whether or not it is on.
  const allocCount = (t) => {
    if (allocMode !== "off" && !specs[t.engine]?.core && !t.trial && t.outcome !== "void") allocObserve(state, t);
    if (brake) brakeObserve(state, t, specs);
  };

  // The open book's result at the start of the day (the last marks before
  // today's first run), for the daily loss stop.
  if (ctl && state.day?.date !== today) state.day = { date: today, start: Object.fromEntries(record.open.map((t) => [t.tradeId, Math.round(tradeUsd(t) || 0)])) };

  // Stock split guard: rescale a trade's dollar levels before it is marked
  // when the tape moved by a split ratio since its last mark, so a split
  // never reads as a loss (or trips a stop). The quote is taken again after
  // the rescale (an option's strike changed).
  out.splits = [];
  const markQuote = (t) => {
    const q = quote(t);
    if (!splitBars || !q || !(q.spot > 0)) return q;
    const prev = t.lastSpot ?? t.entrySpot;
    const lastDate = t.lastSpot != null && t.lastMarkDate ? t.lastMarkDate : String(t.entryDate || "").slice(0, 10);
    let k = null, bars = null;
    try { bars = splitBars(t.symbol); k = engineSplitFactor({ lastSpot: prev, lastDate, spot: q.spot, bars, today }); }
    catch { k = null; }
    if (!k) {
      // A gap of about a split ratio that nothing confirms yet: hold the
      // trade unmarked for a few runs (split.mjs splitHoldRuns), then mark it.
      const max = splitHoldRuns(prev, q.spot, { lastDate, today });
      if (max > 0 && (t.splitHold || 0) < max) {
        t.splitHold = (t.splitHold || 0) + 1;
        out.splits.push({ tradeId: t.tradeId || null, symbol: t.symbol, factor: null, held: t.splitHold, of: max, shadow: !!t.shadow });
        return null;
      }
      if (max > 0) {
        // Marked as a real move after the hold: flagged for a look.
        t.splitUnconfirmed = { date: today, from: prev, to: q.spot };
        out.splits.push({ tradeId: t.tradeId || null, symbol: t.symbol, factor: null, marked: true, shadow: !!t.shadow });
      }
      delete t.splitHold;
      return q;
    }
    delete t.splitHold;
    applyEngineSplit(t, k, nowIso);
    out.splits.push({ tradeId: t.tradeId || null, symbol: t.symbol, factor: Math.round(k * 10000) / 10000, shadow: !!t.shadow });
    return quote(t);
  };

  // (a) Mark and close.
  const stillOpen = [];
  for (const t of record.open) {
    if (!engines.includes(t.engine)) { stillOpen.push(t); continue; }
    let status = null;
    if (coverage && !coverage.has(t.symbol)) status = "left-coverage";
    else {
      // A trade whose mark throws stays open untouched this run (named in
      // out.errors) so the other trades still get their stops and targets.
      try { status = markAndCheck(t, markQuote(t), { today, late, nowMs, view: views[t.symbol] }); }
      catch (err) { out.errors = [...(out.errors || []), `mark ${t.tradeId}: ${String(err?.message || err).split("\n")[0]}`]; stillOpen.push(t); continue; }
    }
    // The Owner put the stock on Avoid with "close open trades" after this
    // trade opened: it closes at this run's mark.
    if (!status && ctl && avoidCloses(ctl, t.symbol, t.entryDate)) status = "owner-avoid";
    if (status) {
      closeTrade(t, status, nowIso); record.closed.unshift(t); out.closed.push(t);
      const es = state.engines[t.engine];
      // An Owner close is not the engine's rule: no cooldown, no learning. A
      // paper trial is kept apart from the engine's learning and its re-entry
      // pause, so it can't hold back the engine's own setups.
      if (status !== "owner-avoid") {
        if (!t.trial && t.outcome === "loss") es.cooldown[t.symbol] = today;
        if (!t.trial && t.outcome !== "void") observe(es, t);
        allocCount(t);
      }
    } else stillOpen.push(t);
  }
  record.open = stillOpen;
  for (const id of engines) {
    const es = state.engines[id]; es.shadow ||= { open: [], closed: [] };
    const keep = [];
    for (const t of es.shadow.open) {
      const status = coverage && !coverage.has(t.symbol) ? "left-coverage" : markAndCheck(t, markQuote(t), { today, late, nowMs, view: views[t.symbol] });
      if (status) {
        closeTrade(t, status, nowIso); out.shadowClosed++;
        if (t.outcome !== "void") { observe(es, t, { shadow: true }); es.shadow.closed.unshift(compactShadow(t)); allocCount(t); }
      } else keep.push(t);
    }
    es.shadow.open = keep;
    if (es.shadow.closed.length > BOOK.shadowClosedKept) es.shadow.closed.length = BOOK.shadowClosedKept;
  }

  // (b) Learn. A core engine runs a fixed monthly rule and does not learn.
  if (learn) for (const id of engines) {
    if (specs[id]?.core) continue;
    for (const c of adapt(state.engines[id], specs[id], { today, parts: typeof learn === "object" ? learn : null })) out.changes.push({ engine: id, ...c });
  }

  // A marks-only step (the history test's close-of-day mark) stops here.
  if (input.marksOnly) { record.builtAtIso = nowIso; record.startedIso ||= nowIso; state.lastRunIso = nowIso; return out; }

  // (c) Candidates and entries. Who holds which contract right now.
  const holders = new Map();
  for (const f of flagshipOpen) if (f?.symbol && f?.contract?.strike && (f.contract.structure || "long") === "long") holders.set(contractKey(f.symbol, { ...f.contract, optionType: f.contract.optionType || f.side }), { engine: FLAGSHIP.id, tradeId: f.tradeId });
  for (const t of record.open) if (!t.noMirror && !isSharesTrade(t)) { const k = contractKey(t.symbol, t.contract); if (!holders.has(k)) holders.set(k, { engine: t.engine, tradeId: t.tradeId, trade: t }); }
  // A Top Picks trade opened on a contract an engine already held: label the
  // engine's trade (the mirror keeps the engine's position and skips the copy).
  record.flagshipShared ||= {};
  for (const f of flagshipOpen) {
    if (!f?.symbol || !f?.contract?.strike) continue;
    const k = contractKey(f.symbol, { ...f.contract, optionType: f.contract.optionType || f.side });
    for (const t of record.open) {
      if (contractKey(t.symbol, t.contract) !== k) continue;
      const fl = (record.flagshipShared[f.tradeId] ||= []);
      // engineRole: "holder" = the engine bought it first (Webull holds the
      // engine's position and skips the Top Picks copy); "follower" = Top
      // Picks holds it and the engine's trade is recorded without a second buy.
      if (!fl.some((x) => x.tradeId === t.tradeId)) fl.push({ engine: t.engine, tradeId: t.tradeId, engineRole: t.noMirror ? "follower" : "holder", since: nowIso });
      if (!t.noMirror && !(t.sharedWith || []).some((x) => x.tradeId === f.tradeId)) (t.sharedWith ||= []).push({ engine: FLAGSHIP.id, tradeId: f.tradeId, since: nowIso });
    }
  }
  const liveFlag = new Set(flagshipOpen.map((f) => f.tradeId));
  for (const id of Object.keys(record.flagshipShared)) if (!liveFlag.has(id)) delete record.flagshipShared[id];

  // The book's per-run limit (BOOK.perRunTotal) is shared by all engines, so
  // the new trades are handed out in turns: each engine takes at most one per
  // pass, and the engine that goes first moves on by one every run
  // (state.turn). Until 2026-11-16 the engines ran to completion in registry
  // order, which left the last ones (Flow, Reversion) nothing on a busy run.
  let total = 0, trialRun = 0;
  const queues = {};
  // Account limits (Owner Settings, all off until set): what is already used.
  const etDay = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? etClock(ms).date : null; };
  let newToday = lim?.newPerDay != null ? [...record.open, ...record.closed].filter((t) => !specs[t.engine]?.core && etDay(t.entryDate) === today).length : 0;
  let dayPnl = null;
  if (lim?.dayLossUsd != null) {
    const start = state.day?.date === today ? state.day.start || {} : {};
    dayPnl = 0;
    // Signal engines only: the core engines' standing monthly book is not counted.
    for (const t of record.closed) { if (specs[t.engine]?.core || etDay(t.exitDate) !== today || t.outcome === "void") continue; dayPnl += (tradeUsd(t) || 0) - (start[t.tradeId] || 0); }
    for (const t of record.open) { if (!specs[t.engine]?.core) dayPnl += (tradeUsd(t) || 0) - (start[t.tradeId] || 0); }
    dayPnl = Math.round(dayPnl);
  }
  const limitWhy = (spec, c, contract) => {
    if (!lim?.any) return null;
    const usd = positionUsd(contract), shr = contract?.structure === "shares";
    if (!spec.core && lim.dayLossUsd != null && dayPnl <= -lim.dayLossUsd) return `account limit: ${LIMIT_LABEL.dayLossUsd} reached ($${Math.abs(dayPnl).toLocaleString("en-US")} down today)`;
    if (!spec.core && lim.newPerDay != null && newToday >= lim.newPerDay) return `account limit: ${lim.newPerDay} ${LIMIT_LABEL.newPerDay} reached`;
    if (!shr && lim.openUsd != null) {
      const open = record.open.filter((t) => !isSharesTrade(t)).reduce((a, t) => a + positionUsd(t.contract), 0);
      if (open + usd > lim.openUsd) return `account limit: ${LIMIT_LABEL.openUsd} ($${Math.round(lim.openUsd).toLocaleString("en-US")}) would be passed`;
    }
    // Open engine stock (2026-11-23, on at $1,000,000 unless set): every open
    // share trade at cost, core holdings and paper trials included.
    if (shr && lim.sharesUsd != null) {
      const open = record.open.filter((t) => isSharesTrade(t)).reduce((a, t) => a + positionUsd(t.contract), 0);
      if (open + usd > lim.sharesUsd) return `account limit: ${LIMIT_LABEL.sharesUsd} ($${Math.round(lim.sharesUsd).toLocaleString("en-US")}) would be passed`;
    }
    if (lim.nameUsd != null) {
      const name = record.open.filter((t) => t.symbol === c.symbol).reduce((a, t) => a + positionUsd(t.contract), 0);
      if (name + usd > lim.nameUsd) return `account limit: ${LIMIT_LABEL.nameUsd} on ${c.symbol} ($${Math.round(lim.nameUsd).toLocaleString("en-US")}) would be passed`;
    }
    return null;
  };
  for (const id of engines) {
    const spec = specs[id], es = state.engines[id];
    let list = [], skips = [];
    // A retired setup opens nothing and is not listed (its open trades still
    // run to their exits above). The rule code drops it before it can cancel
    // or add to another setup on the same name.
    // A retired side ("squeeze|put", 2026-11-19) is kept out the same way.
    const retired = new Set(Object.entries(spec.setups || {}).flatMap(([k, s]) => [...(s.retired ? [k] : []), ...(s.retiredSides || []).map((side) => `${k}|${side}`)]));
    // Can a call signal be swapped for shares (the run-in's `buyShares`)? Only
    // with share trades on and no instrument chosen by hand for the engine or
    // the setup: "options" means options, and "both" already buys a twin.
    const swapToShares = canSwapToShares(spec, shares);
    const ectx = { ...ctx, ...(retired.size ? { retired } : {}), setups: spec.setups || {}, swapToShares };
    try {
      // withSkips also returns the setups that matched but that today's price
      // move ruled out (the chasing filter), so the page can list them.
      ({ skips } = withSkips(() => {
        if (id === "macro") list = evalMacro(ectx);
        else if (spec.core) list = evalCore(id, views, es, spec);
        else for (const view of Object.values(views)) {
          // A fund outside coverage (the sector funds Momentum can hold,
          // 2026-11-21) is for the core engines only.
          if (!view || !view.f || view.aux) continue;
          if (spec.universe === "stocks" && view.isEtf) continue;
          if (spec.universe === "etfs" && !view.isEtf) continue;
          // One name that throws is left out of this engine's run, not the
          // whole engine (2026-11-20).
          let found;
          try { found = EVALUATORS[id](view, ectx); }
          catch (err) { out.errors = [...(out.errors || []), `${id} ${view.sym}: ${String(err?.message || err).split("\n")[0]}`]; continue; }
          for (const c of found) list.push(c);
        }
      }));
    } catch (err) { out.errors = [...(out.errors || []), `${id}: ${String(err?.message || err).split("\n")[0]}`]; list = []; skips = []; }
    list = list.filter((c) => !isRetiredCand(c, { retired }));
    skips = skips.filter((k) => !isRetiredCand(k, { retired }));
    list = list.filter((c) => c.score >= spec.bar.min).sort((a, b) => b.score - a.score || (a.symbol < b.symbol ? -1 : 1));
    // Watch closely: watched names go to the front of the queue (score order
    // kept inside each part). No bar is lowered.
    if (ctl?.watch?.size && !spec.core) list = [...list.filter((c) => ctl.watch.has(c.symbol)), ...list.filter((c) => !ctl.watch.has(c.symbol))];
    // Shown only: not scored, not traded, not tracked as a shadow trade, and
    // not marked as seen, so the same setup can still open at a later run if
    // the price comes back.
    const listed = new Set(list.map((c) => `${c.symbol}|${c.side}`)), once = new Set();
    const skipped = [];
    for (const k of skips) {
      const key = `${k.symbol}|${k.side}|${k.setup}`;
      if (!k.symbol || once.has(key) || listed.has(`${k.symbol}|${k.side}`)) continue;
      once.add(key);
      skipped.push({ symbol: k.symbol, side: k.side, setup: k.setup, score: null, reasons: [], taken: false, skipped: k.why ? "rule" : "price",
        why: k.why || (k.ran ? `price already ran ${k.moveAtr} ATR its way today (not chased)` : `price moved ${k.moveAtr} ATR against it today`) });
    }
    skipped.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
    // Paper trials (config.mjs ENGINE_TRIALS) are taken after every engine's
    // own setups, in their own slots, so a trial never takes a slot, a run
    // place or a name from the setups it sits beside.
    const isTrial = (c) => !!spec.setups?.[c.setup]?.trial;
    const trials = list.filter(isTrial); list = list.filter((c) => !isTrial(c));
    queues[id] = { id, spec, es, list, trials, skipped, next: 0, shown: [], openedHere: 0, openedPool: {}, openedTrial: {}, mine: record.open.filter((t) => t.engine === id) };
  }
  // One candidate through every entry rule. True when a real trade opened.
  // Positioning for conviction sizing: open trades (every engine, twins
  // counted once) by name and by sector group, plus Top Picks' names.
  const flagNames = new Set(flagshipOpen.map((f) => f?.symbol).filter(Boolean));
  // The same by name and side (logic audit fix, 2026-11-21: the name-held
  // cut counts only same-side trades and leaves out the core engines' fund
  // holdings). Top Picks' side is call or put (a bearish pick is a put).
  const sideOfFlag = (f) => (/^(put|bear)/i.test(String(f?.side || "")) ? "put" : "call");
  const flagSides = new Set(flagshipOpen.filter((f) => f?.symbol).map((f) => `${f.symbol}|${sideOfFlag(f)}`));
  const groupOf = (sym) => views[sym]?.group || null;
  const fg = input.fearGreed || ctx.fearGreed || null;
  const consider = (q, c) => {
    const { id, spec, es, shown, mine } = q;
    const view = views[c.symbol];
    const row = { symbol: c.symbol, side: c.side, setup: c.setup, score: c.score, reasons: c.reasons, taken: false, why: null };
    shown.push(row);
    // "w" (logic audit fix, 2026-11-21, ENGINES_FIX_SLOT_RETRY): the signal
    // was turned away only for a slot or the run limit and is tracked as a
    // shadow trade; it may still open for real when room frees up, but is
    // never shadowed twice.
    const waited = es.seen[c.signalKey] === "w";
    if (es.seen[c.signalKey] && !waited) { row.why = es.seen[c.signalKey] === "t" ? "already traded this signal" : "already tracked this signal"; return false; }
    // A variant shadow's own entry rule (lib/engines/variants.mjs): it opens
    // nothing and is not tracked as a shadow trade.
    const gateWhy = gate ? gate(c, id, ctx) : null;
    if (gateWhy) { row.why = gateWhy; return false; }
    const sdef = spec.setups?.[c.setup] || {};
    // A setup with its own pool (the extreme-fear test) counts only its own
    // trades for slots, the run limit and one trade per name. Twins
    // (`twinOf`) ride on their option trade and take no slot of their own.
    // Paper trials have their own slots and count in no pool.
    const pool = sdef.pool || null;
    const inPool = mine.filter((t) => !t.twinOf && !t.trial && (spec.setups?.[t.setup]?.pool || null) === pool);
    const slots = pool ? (sdef.slots ?? spec.slots) : spec.slots, perRun = pool ? (sdef.perRun ?? spec.perRun) : spec.perRun;
    const openedHere = q.openedPool[pool || ""] || 0;
    let inst = instrumentFor(spec, c.setup, c.side, { shares });
    // Live data pack (2026-11-20): a candidate marked `buyShares` (the
    // earnings run-in when its options are rich) buys shares instead of an
    // option, unless share trades are off (ENGINES_SHARES=0).
    if (c.buyShares && c.side === "call" && canSwapToShares(spec, shares) && !sdef.instrument && inst === "option") inst = "shares";
    // A paper trial buys shares only ("both" on its engine still means shares).
    if (sdef.trial && inst === "both") inst = "shares";
    // The Allocator's read of this setup in today's market (signal engines).
    // A paper trial is outside the Allocator: never read, sized or held back.
    const ad = !spec.core && !sdef.trial && allocMode !== "off" ? allocDecide(state, allocPriorRows, allocKey(id, c.setup, c.side, inst === "shares" ? "shares" : "option"), ctx.regime?.cell || null) : null;
    if (ad) row.alloc = { status: ad.status, w: ad.w, ev: ad.ev };
    // An option trade with a shares twin ("both", the extreme-fear bounce
    // test): the shares half reads its own row (2026-11-23; it used to carry
    // the option row's read). The hold-back above stays one call per signal.
    const adS = ad && inst === "both" ? allocDecide(state, allocPriorRows, allocKey(id, c.setup, c.side, "shares"), ctx.regime?.cell || null) : null;
    const readFor = (isShares) => (isShares && adS ? adS : ad);
    let why = null, shadowable = true;
    // The news gate (downtrend pack, 2026-11-20; ENGINES_NEWS_GATE): a news
    // spike on the name with a souring tone holds back a new long, a
    // brightening one a new put. Signal engines only (a core engine checks
    // its holdings once a month, so a one-day block would leave a slot empty
    // for the month).
    const newsWhy = !spec.core && spec.newsGate !== false ? newsBlock(view?.live?.news, c.side) : null;
    // The VIX and rates pack (2026-11-21; ENGINES_VIX_PAUSE, ENGINES_HIKE_PAUSE):
    // no new tech or index-fund long while VIX is rising or while hikes are
    // priced with QQQ under its 200-day. Signal engines only, never a put or
    // a paper trial; the skipped trade is tracked as a shadow trade.
    const pauseWhy = hedgePauseWhy(ctx, view, c, spec, sdef);
    // The bounce skip rule (2026-11-22; ENGINES_BOUNCE_SKIP): no new washout
    // bounce or RSI(2) dip while VIX is under 30 and the market is grinding
    // lower. The washout bounce is tracked as a shadow
    // trade; the dip trial, like every trial, is not.
    const bounceWhy = bounceSkipWhy(ctx, c, spec);
    // The Owner's Stop and Avoid come first for every new trade (a pool
    // test, a shares twin and a paper trial included): nothing below runs.
    if (sdef.trial) {
      // A paper trial: shares only, its own slots and run limit, no learning,
      // no entry bar (its score only orders the candidates), never a shadow.
      // Under the Safer dial (one new trade a run) it opens only when the
      // run has opened nothing else.
      const tpool = mine.filter((t) => t.trial && t.setup === c.setup);
      if (mode !== "on") why = "engines paused by the owner";
      else if (ctl?.stop) why = "new trades stopped by the owner";
      else if (inst !== "shares") why = "paper trial buys shares only (share trades are off)";
      else if (off.has(id)) why = "engine switched off";
      else if (ctl?.avoid?.has(c.symbol)) why = "on the owner's avoid list";
      // One trial lot per name in an engine, across its trials (Flow has two).
      else if (mine.some((t) => t.trial && t.symbol === c.symbol)) why = "already holds this name";
      // No double opens: a name the extreme-fear test holds (option or its
      // shares twin) in this engine is left to it.
      else if (mine.some((t) => !t.trial && t.symbol === c.symbol && spec.setups?.[t.setup]?.pool)) why = "the extreme-fear test already holds this name";
      else if (newsWhy) why = newsWhy;
      else if (bounceWhy) why = bounceWhy;
      else if (tpool.length >= (sdef.slots ?? spec.slots)) why = "no free slot";
      else if ((q.openedTrial[c.setup] || 0) >= (sdef.perRun ?? spec.perRun)) why = "run limit";
      else if (dial?.perRun && total + trialRun >= runCap) why = `book run limit (risk dial ${dial.label}: one new trade a run)`;
      if (why) { row.why = why; return false; }
    } else if (mode !== "on") { why = "engines paused by the owner"; shadowable = false; }
    else if (ctl?.stop) { why = "new trades stopped by the owner"; shadowable = false; }
    else if (off.has(id)) { why = "engine switched off"; shadowable = false; }
    else if (ctl?.avoid?.has(c.symbol)) { why = "on the owner's avoid list"; shadowable = false; }
    else if (inPool.some((t) => t.symbol === c.symbol)) { why = "already holds this name"; shadowable = false; }
    // No double opens: the extreme-fear test leaves a name a paper trial in
    // this engine holds (the regular setups keep #870's rule: a trial never
    // takes a name from them).
    else if (pool && mine.some((t) => t.trial && t.symbol === c.symbol)) { why = "a paper trial already holds this name"; shadowable = false; }
    else if (!spec.core && es.cooldown[c.symbol] && weekdaysSince(es.cooldown[c.symbol], today) < BOOK.reentrySessions) { why = "lost on this name within five sessions"; shadowable = false; }
    else if (es.setups?.[c.setup]?.muted) why = es.setups[c.setup].probation ? "setup on shadow until it proves itself" : "setup muted (learning)";
    else if (es.paused) why = `engine paused: ${es.paused.why}`;
    else if (c.cell && es.cells?.[c.cell]?.off) why = "standing down in this market type";
    else if (ctx.regime?.cell && es.cells?.[ctx.regime.cell]?.off) why = "standing down in this market type";
    // Tracked as a shadow trade, so the gate can be scored against the trades
    // it held back.
    else if (newsWhy) why = newsWhy;
    else if (pauseWhy) why = pauseWhy;
    else if (bounceWhy) why = bounceWhy;
    // A standing engine enters by rank; its score only orders the candidates.
    else if (!spec.standing && c.score < es.bar + (dial && !spec.core ? dial.barDelta : 0)) why = dial && !spec.core && c.score >= es.bar ? `below the bar (risk dial ${dial.label}: +${dial.barDelta})` : "below the bar";
    else if (!pool && fin(spec.sideSlots?.[c.side]) && inPool.filter((t) => t.side === c.side).length >= spec.sideSlots[c.side]) why = `no free ${c.side} slot`;
    // `mine` already holds the trades opened this run (until 2026-11-17 they
    // were counted twice, which left slots empty on a busy run).
    else if (inPool.length >= slots) why = "no free slot";
    else if (openedHere >= perRun) why = "run limit";
    // Core engines are not counted: share trades never reach Webull, whose
    // time budget the limit is for.
    else if (!spec.core && total >= runCap) why = runCap < maxTotal ? `book run limit (risk dial ${dial.label}: one new trade a run)` : "book run limit";
    // The Allocator holds back a setup whose record in today's market is at or
    // under zero ("advise" only records what it would have done). A labeled
    // test (the extreme-fear bounce) is never held back: it is there to
    // gather its own record; the Allocator only stamps its read.
    else if (ad && !ad.open && allocMode === "on" && !sdef.test) why = ad.why;
    // A standing engine (Fundamentals) re-reads the same rank every run: a
    // name with no room today is simply looked at again next run, not parked
    // as a shadow trade (which would mark the signal as used).
    // The same for a news-gated name: the rank is read again next run.
    if (why && spec.standing && (/slot$|run limit$/.test(why) || why === newsWhy || why === pauseWhy)) shadowable = false;
    // One shadow per name. A shadow trade never holds back a real one: a
    // setup that clears every rule still opens while another setup on the
    // same name is being tracked.
    if (why && shadowable && es.shadow.open.some((t) => t.symbol === c.symbol && (spec.setups?.[t.setup]?.pool || null) === pool)) { row.why = `${why} (this name is already tracked as a shadow trade)`; return false; }
    if (why && waited) { row.why = `${why} (this signal is already tracked as a shadow trade)`; return false; }
    if (why && !shadowable) { row.why = why; return false; }
    // The option side. `ownFills` (the extreme-fear test): never a contract
    // another trade already holds, so the test always has its own fills.
    const wantOption = inst === "option" || inst === "both";
    let contract = null, sizeNote = null;
    const lotUsd = c.lotUsd ?? spec.lotUsd ?? BOOK.sharesUsd;
    const exitsOpt = { ...(spec.exits || {}), ...(sdef.exits || {}) };
    // Conviction (2026-11-19): conviction, opportunity and positioning, each
    // a stated small multiplier (SIZE_WEIGHTS in config.mjs).
    // A put is held under the put cap too (2026-11-20, ENGINES_PUT_MAX_QTY).
    const capHere = sideMaxQty(sizing, c.side);
    // The premium cap on this side (2026-11-23: $200,000, a put $100,000).
    const premHere = sizing.mode === "risk" ? sideMaxPremiumUsd(sizing, c.side) : null;
    // The most contracts a size step may reach for one leg: the contract cap,
    // held under the premium cap at the leg's own price (shares: the cap is
    // not used).
    const capFor = (ct) => (premHere == null || ct?.structure === "shares" ? capHere : Math.min(capHere, premiumMaxQty((Number(ct?.entryFill) > 0 ? Number(ct.entryFill) : Number(ct?.mid) || 0) * 100, premHere)));
    // A share leg: the most shares the share cap ($250,000 unless set) buys
    // at its price, so a size step never takes it past the cap (2026-11-23).
    const sharesFor = (ct) => (sizing.mode === "risk" && ct?.structure === "shares" && Number(ct.mid) > 0 ? Math.max(1, Math.floor(normalizeSharesMaxUsd(sizing.sharesMaxUsd) / Number(ct.mid) + 1e-9)) : null);
    // An engine on part of the budget (Downside puts: half) and a candidate
    // that asks for less (its extreme-fear half size) scale the risk budget.
    const budgetX = (fin(spec.budgetX) ? spec.budgetX : 1) * (fin(c.budgetX) ? c.budgetX : 1);
    // The too-dear check reads the full budget (logic audit fix, 2026-11-21,
    // ENGINES_FIX_DEAR_FULL): the half sizes set only the count, so Downside
    // puts are not all skipped in extreme fear.
    const fullBudget = Number(sizing.budget) > 0 ? Number(sizing.budget) : BOOK.riskUsd;
    const sizedFor = sizing.mode === "risk" ? { ...sizing, maxQty: capHere, maxPremiumUsd: premHere, ...(budgetX !== 1 ? { budget: fullBudget * budgetX, ...(spec.dearFull !== false ? { dearBudget: fullBudget } : {}) } : {}) } : sizing;
    const conv = (option, ct) => spec.core || sdef.trial || sizing.mode !== "risk" || !sizing.conviction ? null : convictionRead({
      // While the Allocator only advises, its read is recorded on the trade
      // but no longer moves the size (logic audit fix, 2026-11-21,
      // ENGINES_FIX_ALLOC_ADVISE).
      score: c.score, bar: es.bar, scorePart: spec.convScore !== false, alloc: allocMode === "on" || spec.allocAdvise === false ? readFor(!option) : null, ivBand: option ? view?.live?.iv?.band || null : null, spreadPct: option ? ct?.spreadPct : null,
      nameHeld: spec.heldSameSide === false
        ? record.open.some((t) => t.symbol === c.symbol && !t.twinOf) || flagNames.has(c.symbol)
        : record.open.some((t) => t.symbol === c.symbol && !t.twinOf && !specs[t.engine]?.core && (t.side === "put" ? "put" : "call") === (c.side === "put" ? "put" : "call")) || flagSides.has(`${c.symbol}|${c.side === "put" ? "put" : "call"}`),
      groupOpen: groupOf(c.symbol) ? record.open.filter((t) => !t.twinOf && !specs[t.engine]?.core && groupOf(t.symbol) === groupOf(c.symbol)).length : null,
      option });
    if (wantOption) {
      const avoid = sdef.ownFills ? new Set(holders.keys()) : null;
      const picked = pick(view, c.side, spec, c, { avoid });
      if (!picked || picked.skip) {
        // "both" keeps its shares half when no option can be bought.
        if (inst === "both") { inst = "shares"; sizeNote = `no option: ${picked?.skip || "none"}; shares only`; }
        else if (!why) { row.why = `no contract: ${picked?.skip || "none"}`; return false; }
        else { row.why = why; return false; }
      } else {
        const sz = sizeOption(picked, { sizing: sizedFor, exits: exitsOpt, fixedQty: Number.isInteger(sdef.qty) ? sdef.qty : null, conviction: conv(true, picked), fillBasis });
        if (sz.skip) {
          // A contract dearer than twice the budget: the up side buys shares
          // instead (long only; a put has no shares side and is skipped).
          // Only where shares are allowed: not with ENGINES_SHARES=0, and
          // not when the engine or the setup is set to options only (logic
          // audit, 2026-11-21).
          if (sz.dear && c.side !== "put" && !spec.core && shares !== false && spec.instrument !== "options" && sdef.instrument !== "options") { inst = "shares"; sizeNote = `${sz.skip}: shares instead`; }
          else if (!why) { row.why = `no contract: ${sz.skip}`; return false; }
          else { row.why = why; return false; }
        } else {
          contract = { ...picked, qty: sz.qty, flatQty: sz.flatQty };
          if (fillBasis && Number(picked.ask) > 0) contract.entryFill = picked.ask;
          contract.size = sz.size;
        }
      }
    }
    // A share trade: no premium exits, a session limit (the setup's own when
    // it sets one: the RSI(2) dip trial, 10), and stock levels from the ATR
    // (the setup's own stop or target where it is tighter).
    const sharesLeg = () => {
      const lot = sharesContract(view?.spot, { usd: lotUsd });
      if (lot.skip) return { skip: lot.skip };
      let exits = { maxSessions: sdef.exits?.maxSessions ?? BOOK.sharesMaxSessions }, stopLevel = c.stopLevel ?? null, targetLevel = c.targetLevel ?? null;
      if (spec.core) return { contract: lot, exits: {}, stopLevel: null, targetLevel: null };
      const atr = Number(view?.f?.atr), px = Number(lot.mid);
      // An engine may set its own stop distance and drop the setup's own
      // stock stop (Technicals since 2026-11-17: 3 ATR, `sharesOwnStop: false`).
      const stopAtr = fin(spec.sharesStopAtr) ? spec.sharesStopAtr : BOOK.sharesStopAtr, ownStop = spec.sharesOwnStop !== false;
      // A setup with `levels: false` holds for its sessions only (the
      // index-fear trial, tested that way).
      if (sdef.levels === false) { stopLevel = null; targetLevel = null; }
      else if (atr > 0 && px > 0) {
        const lo = px - stopAtr * atr, hi = px + BOOK.sharesTargetAtr * atr;
        stopLevel = r2(ownStop && fin(stopLevel) ? Math.max(stopLevel, lo) : lo);
        targetLevel = r2(fin(targetLevel) ? Math.min(targetLevel, hi) : hi);
      }
      // A paper trial keeps the fixed lot it was tested with.
      if (sdef.trial) return { contract: { ...lot, size: { mode: "lot", why: `$${Number(lotUsd).toLocaleString("en-US")} of stock (paper trial lot)` } }, exits, stopLevel, targetLevel };
      // Risk sizing: budget / (entry - stop) shares, times conviction.
      const sz = sizeShares(px, stopLevel, { sizing: sizedFor, conviction: conv(false, null) });
      const ct = sz ? { ...lot, shares: sz.shares, flatShares: sz.flatShares, usd: Math.round(sz.shares * px), size: sz.size }
        : { ...lot, flatShares: lot.shares, size: { mode: sizing.mode === "risk" ? "lot" : sizing.mode, why: `$${Number(lotUsd).toLocaleString("en-US")} of stock${sizing.mode === "risk" ? " (no stop to size from)" : ""}` } };
      return { contract: ct, exits, stopLevel, targetLevel };
    };
    let main = null, twin = null;
    if (inst === "shares" || spec.core) {
      const leg = sharesLeg();
      if (leg.skip) { if (!why) { row.why = `no contract: ${leg.skip}`; return false; } row.why = why; return false; }
      main = leg;
      if (sizeNote) main.contract.size = { ...main.contract.size, why: `${sizeNote}. ${main.contract.size.why}` };
    } else {
      main = { contract, exits: exitsOpt, stopLevel: c.stopLevel ?? null, targetLevel: c.targetLevel ?? null };
      if (inst === "both" && !why) { const leg = sharesLeg(); if (!leg.skip) twin = leg; }
    }
    // A core holding has none of these: it is held until a monthly check drops it.
    if (spec.core) { main.exits = {}; main.stopLevel = null; main.targetLevel = null; }
    // Market-risk sizing (downtrend pack, 2026-11-20; ENGINES_TAPE_SIZE): a
    // new long on a signal engine (calls and shares, a shares twin too) is
    // scaled by the Top Picks market tape's own de-gross multiplier; a put
    // keeps its size. A paper trial keeps the fixed lot it was tested with.
    const tape = !spec.core ? tapeRead(ctx.macroState, ctx.macroGross) : null;
    const tapeMult = tape && !sdef.trial && spec.tapeSize !== false && c.side !== "put" ? tape.mult : 1;
    const taped = (leg) => {
      if (!leg || tapeMult === 1) return leg;
      const ct = scaleContract(leg.contract, tapeMult, capFor(leg.contract), sharesFor(leg.contract));
      if (ct === leg.contract) return leg;
      return { ...leg, contract: { ...ct, ...(ct.size ? { size: { ...ct.size, tapeMult, why: `${ct.size.why}; market tape ${tape.state} ${tapeMult}x` } } : {}) } };
    };
    main = taped(main); twin = taped(twin);
    // The loser brake (scorecard pack, 2026-11-21; ENGINES_LOSER_BRAKE): a
    // setup whose own record (history prior plus live) has 30+ closes and t
    // under -1 is sized at half, never under a quarter with the tape's step,
    // never skipped (at least one contract or share). Each leg reads its own
    // instrument's record (an option and its shares twin are scored apart).
    // Signal engines only; a paper trial keeps its fixed lot.
    const braked = (leg) => {
      if (!leg || !brake?.enabled || !BRAKE_ENGINES.has(id) || spec.core || sdef.trial || spec.loserBrake === false) return leg;
      const rd = brakeRead(state, brake.prior, brakeKeyOf({ engine: id, setup: c.setup, side: c.side, contract: leg.contract }));
      const bm = brakeMult(rd, tapeMult);
      if (bm >= 1) return leg;
      const ct = scaleContract(leg.contract, bm, capFor(leg.contract), sharesFor(leg.contract));
      const stamp = { mult: bm, t: rd.t, n: rd.n, priorN: rd.priorN, avg: rd.avg };
      return { ...leg, brake: stamp, contract: { ...ct, ...(ct.size ? { size: { ...ct.size, brakeMult: bm, why: `${ct.size.why}; ${brakeWhy(rd, bm)}` } } : {}) } };
    };
    main = braked(main); twin = braked(twin);
    // Risk dial size (signal engines), on top of the sizing above: half or
    // 1.5x the contracts or shares, the option trade and its twin alike.
    const dialed = (leg) => {
      if (!leg || !dial || spec.core) return leg;
      const ct = scaleContract(leg.contract, dial.sizeMult, capFor(leg.contract), sharesFor(leg.contract));
      if (ct === leg.contract) return leg;
      return { ...leg, unscaled: leg.contract, contract: { ...ct, ...(ct.size ? { size: { ...ct.size, why: `${ct.size.why}; risk dial ${dial.label} ${dial.sizeMult}x` } } : {}) } };
    };
    main = dialed(main); twin = dialed(twin);
    // Account limits: a trade that would pass one is not opened (and not
    // tracked as a shadow trade). Riskier stays inside them: when 1.5x would
    // pass a limit, the normal size is tried before the trade is held back.
    const fitLimits = (leg) => {
      let lw = limitWhy(spec, c, leg.contract);
      if (lw && leg.unscaled && dial.sizeMult > 1 && !limitWhy(spec, c, leg.unscaled)) { leg.contract = leg.unscaled; lw = null; }
      delete leg.unscaled;
      return lw;
    };
    if (!why) { const lw = fitLimits(main); if (lw) { row.why = lw; return false; } }
    else { delete main.unscaled; if (twin) delete twin.unscaled; }
    const mkBase = (leg) => ({
      engine: id, tag: spec.tag, symbol: c.symbol, side: c.side, setup: c.setup, score: c.score,
      reasons: c.reasons, facts: c.facts, signalKey: c.signalKey, signalDate: c.signalDate || view?.f?.date || null,
      entryDate: nowIso, entrySpot: r2(view?.spot), contract: leg.contract,
      exits: leg.exits, stopLevel: leg.stopLevel, targetLevel: leg.targetLevel, exitBy: c.exitBy || null, ...(c.exitBy && spec.runInEarly !== false ? { exitEarly: true } : {}),
      // A paper trial's trades say so on the record (config.mjs ENGINE_TRIALS).
      ...(sdef.trial ? { trial: true } : {}),
      rulesVersion: rulesVersion(spec, es), bar: es.bar,
      regime: ctx.regime ? { cell: ctx.regime.cell || null } : null, env: ctx.env || null, macroState: ctx.macroState || null,
      // The downtrend pack's reads (2026-11-20), on every signal trade so the
      // record can be split by them: the tape and the size multiplier it set
      // (1 for a put, a trial or with the switch off), and the name's news read.
      ...(tape?.state ? { tape: { state: tape.state, mult: tapeMult } } : {}),
      ...(!spec.core && view?.live?.news ? { news: { frn: view.live.news.frn ?? null, nvr: view.live.news.nvr ?? null, ntn: view.live.news.ntn ?? null } } : {}),
      lastSpot: r2(view?.spot), lastMid: leg.contract.mid, optionPnlPct: 0, hiPct: 0, loPct: 0, sessions: 0, lastMarkDate: today,
      ...(sdef.test ? { test: true } : {}),
      ...(leg.brake ? { brake: leg.brake } : {}),
    });
    const base = mkBase(main);
    // Fill basis: what the ask cost going in (option trades with a live quote).
    if (!isSharesTrade(base) && Number(base.contract.entryFill) > 0) {
      base.fill = { basis: "ask-bid", entry: base.contract.entryFill, entryMid: base.contract.mid };
      // Booked at open as if sold back at the bid right away (the mid when
      // the quote has no bid); the mid result starts at zero.
      const bid0 = Number(base.contract.bid) > 0 ? Number(base.contract.bid) : Number(base.contract.mid);
      base.optionPnlPct = r1((bid0 / base.contract.entryFill - 1) * 100);
      base.markPnlPct = 0;
      if (Number(base.contract.bid) > 0) base.lastBid = base.contract.bid;
    }
    if (ad) base.alloc = allocStamp(readFor(base.contract?.structure === "shares"), allocMode);
    const offHere = spec.core ? [] : fixesOff.filter((f) => (ENGINE_FIXES.find((x) => x.id === f)?.engines || []).includes(id));
    if (offHere.length) base.fixesOff = offHere;
    // Which Owner controls touched this trade (scorecard).
    const stamp = ctl ? tradeStamp(ctl, c.symbol, { dial: !spec.core }) : null;
    if (stamp) base.ownerControls = stamp;
    if (why) {
      if (es.shadow.open.length >= BOOK.shadowOpenMax) { row.why = why; return false; }
      es.shadow.open.push({ ...base, shadow: true, shadowWhy: why.replace(/^engine paused.*/, "engine paused").replace(/^Allocator:.*/, "held back by the Allocator") });
      es.seen[c.signalKey] = spec.slotRetry !== false && /no free (\w+ )?slot$|run limit/.test(why) ? "w" : "s"; out.shadowOpened++; row.why = `${why} (tracked as a shadow trade)`;
      return false;
    }
    const isShr = isSharesTrade(base);
    const trade = { ...base, tradeId: engineTradeId(spec.tag, c.symbol, c.side, nowIso, { shares: isShr, suffix: sdef.idSuffix || null }) };
    // Stock is not bought in the paper account, so the same-contract rule
    // (one Webull position per contract) has nothing to share.
    const key = isShr ? null : contractKey(c.symbol, trade.contract), holder = key ? holders.get(key) : null;
    if (holder) {
      trade.noMirror = true;
      trade.shared = { role: "follower", heldBy: holder.engine, heldById: holder.tradeId, since: nowIso };
      if (holder.trade) (holder.trade.sharedWith ||= []).push({ engine: id, tradeId: trade.tradeId, since: nowIso });
      else (record.flagshipShared[holder.tradeId] ||= []).push({ engine: id, tradeId: trade.tradeId, engineRole: "follower", since: nowIso });
      row.note = `Same contract is held by ${engineName(holder.engine)}: recorded here, not bought twice`;
    } else if (key) holders.set(key, { engine: id, tradeId: trade.tradeId, trade });
    record.open.push(trade); mine.push(trade); out.opened.push(trade);
    es.seen[c.signalKey] = "t";
    // A waiting signal that opens for real drops its shadow copy, so its
    // close is not counted twice by learning, the Allocator and the brake.
    if (waited) es.shadow.open = es.shadow.open.filter((t) => t.signalKey !== c.signalKey);
    if (sdef.trial) { q.openedTrial[c.setup] = (q.openedTrial[c.setup] || 0) + 1; trialRun++; }
    else { q.openedHere++; q.openedPool[pool || ""] = openedHere + 1; if (!spec.core) total++; }
    // Every new non-core trade, a paper trial's too, counts toward the
    // Owner's new-trades-a-day limit.
    if (!spec.core) newToday++;
    // The shares twin ("both"): the same signal in stock, scored apart. It is
    // its own position, so it is checked against the account limits on its
    // own (with the option trade already counted) and counts as a new trade.
    if (twin) {
      const lw = fitLimits(twin);
      if (lw) row.twinWhy = `shares twin not opened: ${lw}`;
      else {
        const tw = { ...mkBase(twin), tradeId: engineTradeId(spec.tag, c.symbol, c.side, nowIso, { shares: true, suffix: sdef.idSuffix || null }), twinOf: trade.tradeId };
        if (ad) tw.alloc = allocStamp(readFor(true), allocMode);
        if (offHere.length) tw.fixesOff = offHere;
        if (stamp) tw.ownerControls = stamp;
        trade.twin = tw.tradeId;
        record.open.push(tw); mine.push(tw); out.opened.push(tw);
        row.twin = tw.tradeId;
        if (!spec.core) newToday++;
      }
    }
    row.taken = true; row.tradeId = trade.tradeId;
    if (trade.contract.size) row.size = trade.contract.size.why;
    return true;
  };
  const turn = engines.length ? (((Number.isInteger(state.turn) ? state.turn : -1) + 1) % engines.length) : 0;
  state.turn = turn;
  const order = [...engines.slice(turn), ...engines.slice(0, turn)];
  out.order = order;
  for (let moved = true; moved;) {
    moved = false;
    for (const id of order) {
      const q = queues[id];
      // This engine's turn: its candidates in score order until one opens.
      while (q.next < q.list.length) {
        moved = true;
        if (consider(q, q.list[q.next++])) break;
      }
    }
  }
  // Then the paper trials, in score order, inside their own limits.
  for (const id of order) for (const c of queues[id].trials) consider(queues[id], c);
  // Check this stock (the Owner page): every scored row of this run by name
  // (a paper trial's rows are in `shown`, since consider() records them there).
  out.checks = {};
  for (const id of engines) for (const r of [...queues[id].shown, ...queues[id].skipped]) {
    (out.checks[r.symbol] ||= []).push({ engine: id, setup: r.setup, side: r.side, score: r.score ?? null, taken: !!r.taken, why: r.why || null, ...(r.skipped ? { skipped: r.skipped } : {}) });
  }
  if (ctl) out.controls = { dial: dial ? dial.level : "normal", stop: !!ctl.stop, avoid: ctl.avoid ? ctl.avoid.size : 0, watch: ctl.watch ? ctl.watch.size : 0, dayPnl, newToday };
  for (const id of engines) {
    const { es, shown, skipped } = queues[id];
    // Scored candidates first; up to BOOK.skippedKept price-ruled-out rows after them.
    const sk = skipped.slice(0, BOOK.skippedKept);
    out.candidates[id] = [...shown.slice(0, BOOK.candidatesKept), ...sk];
    if (skipped.length) out.skippedPrice = (out.skippedPrice || 0) + skipped.length;
    // Forget signals older than 40 days (keys end in a date).
    for (const k of Object.keys(es.seen)) { const d = k.slice(-10); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && weekdaysSince(d, today) > 30) delete es.seen[k]; }
    for (const [sym, d] of Object.entries(es.cooldown)) if (weekdaysSince(d, today) > BOOK.reentrySessions + 2) delete es.cooldown[sym];
  }

  // Fold the oldest closed rows into per-engine totals once the list is long.
  if (record.closed.length > closedKept) {
    record.archive ||= {};
    for (const t of record.closed.splice(closedKept)) {
      // Share trades fold into their own totals (archiveShares).
      const box = isSharesTrade(t) ? (record.archiveShares ||= {}) : record.archive;
      const a = (box[t.engine] ||= { n: 0, wins: 0, losses: 0, sumPnl: 0, sumUsd: 0 });
      if (t.outcome === "void") continue;
      a.n++; if (t.outcome === "win") a.wins++; if (t.outcome === "loss") a.losses++;
      a.sumPnl = r1(a.sumPnl + (t.optionPnlPct || 0)); a.sumUsd = Math.round(a.sumUsd + ((t.optionPnlPct || 0) / 100) * positionUsd(t.contract));
    }
  }
  record.builtAtIso = nowIso; record.startedIso ||= nowIso;
  state.lastRunIso = nowIso;
  return out;
}

function compactShadow(t) {
  return { engine: t.engine, symbol: t.symbol, side: t.side, setup: t.setup, score: t.score, entryDate: t.entryDate, exitDate: t.exitDate, status: t.status,
    optionPnlPct: t.optionPnlPct, shadowWhy: t.shadowWhy, regime: t.regime, alloc: t.alloc || undefined, ...(t.fill ? { fill: { basis: t.fill.basis } } : {}), ...(t.test ? { test: true } : {}),
    contract: isSharesTrade(t) ? { structure: "shares", shares: t.contract.shares, mid: t.contract.mid, optionType: "call" } : { strike: t.contract.strike, expiry: t.contract.expiry, mid: t.contract.mid, optionType: t.contract.optionType, ...(t.contract.qty ? { qty: t.contract.qty } : {}) } };
}

function weekdaysSince(from, to) {
  const a = Date.parse(String(from).slice(0, 10) + "T12:00:00Z"), b = Date.parse(String(to).slice(0, 10) + "T12:00:00Z");
  if (!fin(a) || !fin(b) || b <= a) return 0;
  let n = 0;
  for (let ms = a + 86400000; ms <= b; ms += 86400000) { const d = new Date(ms).getUTCDay(); if (d !== 0 && d !== 6) n++; }
  return n;
}

// The run-in's `buyShares` swap (live data pack, 2026-11-20): only with share
// trades on and no instrument chosen by hand for the engine ("options" means
// options; "both" already buys a shares twin).
function canSwapToShares(spec, shares) {
  return !!shares && !spec?.core && (!spec?.instrument || spec.instrument === "default");
}
