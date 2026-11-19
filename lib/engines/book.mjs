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
// Owner controls (2026-11-19, lib/owner-controls.mjs): the live run passes
// `controls` (the stop, the avoid and watch lists, the risk dial and the
// account limits). Stop and Avoid open nothing (not even a shadow trade),
// Avoid with "close" closes a name's open trades as "owner-avoid" (counted,
// never learned from), Watch moves a name to the front of each engine's
// queue, the dial scales size and moves the entry bar, and the limits hold
// back a trade that would pass them. The history test passes none.
//
// Pure. No network, no AI.

import { ENGINES, ENGINE_IDS, ENGINE_FIXES, BOOK, FLAGSHIP, NOT_COUNTED, engineName, instrumentFor, isSharesTrade } from "./config.mjs";
import { EVALUATORS, evalMacro, thesisCheck, withSkips } from "./signals.mjs";
import { contractKey, dteOf, expiryExitDate, sharesContract, positionUsd, optionQty } from "./contracts.mjs";
import { newEngineState, observe, adapt, rulesVersion, adoptRules } from "./learn.mjs";
import { standRank } from "./rank.mjs";
import { standCore, evalCore, markCoreViews } from "./core.mjs";
import { allocObserve, allocDecide, allocKey, allocStamp, emptyAlloc } from "./allocator.mjs";
import { tradeUsd } from "./record.mjs";
import { avoidCloses, tradeStamp, scaleContract, LIMIT_LABEL } from "../owner-controls.mjs";
import { etClock } from "../us-equity-calendar.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);

const ET_ID = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
// TAG:SYMBOL-C|P|S-MM/DD/YY-HH:MM (entry time, ET; S = a share trade). The
// tag keeps two engines that open the same name in the same run apart; the
// rest matches Top Picks.
export function engineTradeId(tag, symbol, side, entryIso, { shares = false } = {}) {
  const p = {};
  for (const x of ET_ID.formatToParts(new Date(entryIso))) p[x.type] = x.value;
  return `${tag}:${symbol}-${shares ? "S" : side === "put" ? "P" : "C"}-${p.month}/${p.day}/${p.year}-${p.hour}:${p.minute}`;
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
  const pnl = (q.mid / entry - 1) * 100 - (Number(t.contract?.costPct) || 0);
  t.lastMid = r2(q.mid); t.lastSpot = r2(q.spot); t.markSource = q.source || null;
  t.optionPnlPct = r1(pnl);
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
  if (t.exitBy && (today > t.exitBy || (today === t.exitBy && late))) { if (today > t.exitBy) t.exitLate = true; return "event-exit"; }
  const thesis = thesisCheck(t, view);
  if (thesis) return thesis;
  if (fin(x.maxSessions) && (t.sessions || 0) >= x.maxSessions) return "time";
  return null;
}
function closeTrade(t, status, nowIso) {
  t.exitDate = nowIso; t.exitSpot = t.lastSpot ?? null; t.exitMid = t.lastMid ?? null;
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
//     contract, the size before 2026-11-17),
//   fixesOff: ids of the money-leak fixes switched off (each new trade is
//     stamped with the ones that reach its engine).
//   controls: the Owner controls in force (activeControls() plus `limits`
//     from accountLimits()); null = none (the history test).
export function stepBook(state, record, input) {
  const { nowIso, today, late = false, views = {}, ctx = {}, quote, pick, flagshipOpen = [], coverage = null,
    mode = "on", off = new Set(), learn = true, engines = ENGINE_IDS, maxTotal = BOOK.perRunTotal, closedKept = BOOK.closedKept, specs = ENGINES, shares = true,
    allocator = { mode: "off", prior: null }, optionUsd = BOOK.optionUsd, fixesOff = [], controls = null } = input;
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
      standCore(es, id, views, ctx, { today }); markCoreViews(views, id, es);
      // The S&P 500 price the day the engine first had a target: its live
      // record is read against the same money left in SPY from that day.
      if (es.core && !es.bench && views.SPY?.spot > 0) es.bench = { date: today, spy: r2(views.SPY.spot) };
    }
    catch (err) { out.errors = [...(out.errors || []), `${id} target: ${String(err?.message || err).split("\n")[0]}`]; }
  }
  // The Allocator counts every finished signal-engine trade, real or shadow.
  const allocCount = (t) => { if (allocMode !== "off" && !specs[t.engine]?.core && t.outcome !== "void") allocObserve(state, t); };

  // The open book's result at the start of the day (the last marks before
  // today's first run), for the daily loss stop.
  if (ctl && state.day?.date !== today) state.day = { date: today, start: Object.fromEntries(record.open.map((t) => [t.tradeId, Math.round(tradeUsd(t) || 0)])) };

  // (a) Mark and close.
  const stillOpen = [];
  for (const t of record.open) {
    if (!engines.includes(t.engine)) { stillOpen.push(t); continue; }
    let status = null;
    if (coverage && !coverage.has(t.symbol)) status = "left-coverage";
    else status = markAndCheck(t, quote(t), { today, late, nowMs, view: views[t.symbol] });
    // The Owner put the stock on Avoid with "close open trades" after this
    // trade opened: it closes at this run's mark.
    if (!status && ctl && avoidCloses(ctl, t.symbol, t.entryDate)) status = "owner-avoid";
    if (status) {
      closeTrade(t, status, nowIso); record.closed.unshift(t); out.closed.push(t);
      const es = state.engines[t.engine];
      // An Owner close is not the engine's rule: no cooldown, no learning.
      if (status !== "owner-avoid") {
        if (t.outcome === "loss") es.cooldown[t.symbol] = today;
        if (t.outcome !== "void") observe(es, t);
        allocCount(t);
      }
    } else stillOpen.push(t);
  }
  record.open = stillOpen;
  for (const id of engines) {
    const es = state.engines[id]; es.shadow ||= { open: [], closed: [] };
    const keep = [];
    for (const t of es.shadow.open) {
      const status = coverage && !coverage.has(t.symbol) ? "left-coverage" : markAndCheck(t, quote(t), { today, late, nowMs, view: views[t.symbol] });
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
  let total = 0;
  const queues = {};
  // Account limits (Owner Settings, all off until set): what is already used.
  const etDay = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? etClock(ms).date : null; };
  let newToday = lim?.newPerDay != null ? [...record.open, ...record.closed].filter((t) => !specs[t.engine]?.core && etDay(t.entryDate) === today).length : 0;
  let dayPnl = null;
  if (lim?.dayLossUsd != null) {
    const start = state.day?.date === today ? state.day.start || {} : {};
    dayPnl = 0;
    for (const t of record.closed) { if (etDay(t.exitDate) !== today || t.outcome === "void") continue; dayPnl += (tradeUsd(t) || 0) - (start[t.tradeId] || 0); }
    for (const t of record.open) dayPnl += (tradeUsd(t) || 0) - (start[t.tradeId] || 0);
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
    const retired = new Set(Object.entries(spec.setups || {}).filter(([, s]) => s.retired).map(([k]) => k));
    const ectx = retired.size ? { ...ctx, retired } : ctx;
    try {
      // withSkips also returns the setups that matched but that today's price
      // move ruled out (the chasing filter), so the page can list them.
      ({ skips } = withSkips(() => {
        if (id === "macro") list = evalMacro(ectx);
        else if (spec.core) list = evalCore(id, views, es);
        else for (const view of Object.values(views)) {
          if (!view || !view.f) continue;
          if (spec.universe === "stocks" && view.isEtf) continue;
          if (spec.universe === "etfs" && !view.isEtf) continue;
          for (const c of EVALUATORS[id](view, ectx)) list.push(c);
        }
      }));
    } catch (err) { out.errors = [...(out.errors || []), `${id}: ${String(err?.message || err).split("\n")[0]}`]; list = []; skips = []; }
    list = list.filter((c) => !retired.has(c.setup));
    skips = skips.filter((k) => !retired.has(k.setup));
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
      skipped.push({ symbol: k.symbol, side: k.side, setup: k.setup, score: null, reasons: [], taken: false, skipped: "price",
        why: k.ran ? `price already ran ${k.moveAtr} ATR its way today (not chased)` : `price moved ${k.moveAtr} ATR against it today` });
    }
    skipped.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
    queues[id] = { id, spec, es, list, skipped, next: 0, shown: [], openedHere: 0, mine: record.open.filter((t) => t.engine === id) };
  }
  // One candidate through every entry rule. True when a real trade opened.
  const consider = (q, c) => {
    const { id, spec, es, shown, mine } = q;
    const view = views[c.symbol];
    const row = { symbol: c.symbol, side: c.side, setup: c.setup, score: c.score, reasons: c.reasons, taken: false, why: null };
    shown.push(row);
    if (es.seen[c.signalKey]) { row.why = es.seen[c.signalKey] === "t" ? "already traded this signal" : "already tracked this signal"; return false; }
    // The Allocator's read of this setup in today's market (signal engines).
    const inst = instrumentFor(spec, c.setup, c.side, { shares });
    const ad = !spec.core && allocMode !== "off" ? allocDecide(state, allocPriorRows, allocKey(id, c.setup, c.side, inst), ctx.regime?.cell || null) : null;
    if (ad) row.alloc = { status: ad.status, w: ad.w, ev: ad.ev };
    let why = null, shadowable = true;
    if (mode !== "on") { why = "engines paused by the owner"; shadowable = false; }
    else if (ctl?.stop) { why = "new trades stopped by the owner"; shadowable = false; }
    else if (off.has(id)) { why = "engine switched off"; shadowable = false; }
    else if (ctl?.avoid?.has(c.symbol)) { why = "on the owner's avoid list"; shadowable = false; }
    else if (mine.some((t) => t.symbol === c.symbol)) { why = "already holds this name"; shadowable = false; }
    else if (!spec.core && es.cooldown[c.symbol] && weekdaysSince(es.cooldown[c.symbol], today) < BOOK.reentrySessions) { why = "lost on this name within five sessions"; shadowable = false; }
    else if (es.setups?.[c.setup]?.muted) why = es.setups[c.setup].probation ? "setup on shadow until it proves itself" : "setup muted (learning)";
    else if (es.paused) why = `engine paused: ${es.paused.why}`;
    else if (c.cell && es.cells?.[c.cell]?.off) why = "standing down in this market type";
    else if (ctx.regime?.cell && es.cells?.[ctx.regime.cell]?.off) why = "standing down in this market type";
    // A standing engine enters by rank; its score only orders the candidates.
    else if (!spec.standing && c.score < es.bar + (dial && !spec.core ? dial.barDelta : 0)) why = dial && !spec.core && c.score >= es.bar ? `below the bar (risk dial ${dial.label}: +${dial.barDelta})` : "below the bar";
    else if (fin(spec.sideSlots?.[c.side]) && mine.filter((t) => t.side === c.side).length >= spec.sideSlots[c.side]) why = `no free ${c.side} slot`;
    // `mine` already holds the trades opened this run (until 2026-11-17 they
    // were counted twice, which left slots empty on a busy run).
    else if (mine.length >= spec.slots) why = "no free slot";
    else if (q.openedHere >= spec.perRun) why = "run limit";
    // Core engines are not counted: share trades never reach Webull, whose
    // time budget the limit is for.
    else if (!spec.core && total >= runCap) why = runCap < maxTotal ? `book run limit (risk dial ${dial.label}: one new trade a run)` : "book run limit";
    // The Allocator holds back a setup whose record in today's market is at or
    // under zero ("advise" only records what it would have done).
    else if (ad && !ad.open && allocMode === "on") why = ad.why;
    // A standing engine (Fundamentals) re-reads the same rank every run: a
    // name with no room today is simply looked at again next run, not parked
    // as a shadow trade (which would mark the signal as used).
    if (why && spec.standing && /slot$|run limit$/.test(why)) shadowable = false;
    // One shadow per name. A shadow trade never holds back a real one: a
    // setup that clears every rule still opens while another setup on the
    // same name is being tracked.
    if (why && shadowable && es.shadow.open.some((t) => t.symbol === c.symbol)) { row.why = `${why} (this name is already tracked as a shadow trade)`; return false; }
    let contract = why && !shadowable ? null : inst === "shares" ? sharesContract(view?.spot, { usd: c.lotUsd ?? spec.lotUsd ?? BOOK.sharesUsd }) : pick(view, c.side, spec, c);
    if (!why && (!contract || contract.skip)) { why = `no contract: ${contract?.skip || "none"}`; shadowable = false; }
    // An option trade buys about `optionUsd` of premium (2026-11-17).
    if (contract && !contract.skip && inst !== "shares" && optionUsd > 0) contract = { ...contract, qty: optionQty(contract.mid, optionUsd) };
    // Risk dial size (signal engines): half or 1.5x the contracts or shares.
    const unscaled = contract;
    if (dial && !spec.core && contract && !contract.skip) contract = scaleContract(contract, dial.sizeMult);
    // Account limits: a trade that would pass one is not opened (and not
    // tracked as a shadow trade). Riskier stays inside them: when 1.5x would
    // pass a limit, the normal size is tried before the trade is held back.
    if (!why && contract && !contract.skip) {
      let lw = limitWhy(spec, c, contract);
      if (lw && contract !== unscaled && dial.sizeMult > 1 && !limitWhy(spec, c, unscaled)) { contract = unscaled; lw = null; }
      if (lw) { why = lw; shadowable = false; }
    }
    if (why && !shadowable) { row.why = why; return false; }
    if (why && (!contract || contract.skip)) { row.why = why; return false; }
    // A share trade: no premium exits, a session limit, and stock levels from
    // the ATR (the setup's own stop or target where it is tighter).
    let exits = { ...(spec.exits || {}), ...(spec.setups?.[c.setup]?.exits || {}) }, stopLevel = c.stopLevel ?? null, targetLevel = c.targetLevel ?? null;
    // A core holding has none of these: it is held until a monthly check drops it.
    if (spec.core) { exits = {}; stopLevel = null; targetLevel = null; }
    else if (inst === "shares") {
      exits = { maxSessions: BOOK.sharesMaxSessions };
      const atr = Number(view?.f?.atr), px = Number(contract.mid);
      // An engine may set its own stop distance and drop the setup's own
      // stock stop (Technicals since 2026-11-17: 3 ATR, `sharesOwnStop: false`).
      const stopAtr = fin(spec.sharesStopAtr) ? spec.sharesStopAtr : BOOK.sharesStopAtr, ownStop = spec.sharesOwnStop !== false;
      if (atr > 0 && px > 0) {
        const lo = px - stopAtr * atr, hi = px + BOOK.sharesTargetAtr * atr;
        stopLevel = r2(ownStop && fin(stopLevel) ? Math.max(stopLevel, lo) : lo);
        targetLevel = r2(fin(targetLevel) ? Math.min(targetLevel, hi) : hi);
      }
    }
    const base = {
      engine: id, tag: spec.tag, symbol: c.symbol, side: c.side, setup: c.setup, score: c.score,
      reasons: c.reasons, facts: c.facts, signalKey: c.signalKey, signalDate: c.signalDate || view?.f?.date || null,
      entryDate: nowIso, entrySpot: r2(view?.spot), contract,
      exits, stopLevel, targetLevel, exitBy: c.exitBy || null,
      rulesVersion: rulesVersion(spec, es), bar: es.bar,
      regime: ctx.regime ? { cell: ctx.regime.cell || null } : null, env: ctx.env || null, macroState: ctx.macroState || null,
      lastSpot: r2(view?.spot), lastMid: contract.mid, optionPnlPct: 0, hiPct: 0, loPct: 0, sessions: 0, lastMarkDate: today,
    };
    if (ad) base.alloc = allocStamp(ad, allocMode);
    const offHere = spec.core ? [] : fixesOff.filter((f) => (ENGINE_FIXES.find((x) => x.id === f)?.engines || []).includes(id));
    if (offHere.length) base.fixesOff = offHere;
    // Which Owner controls touched this trade (scorecard).
    const stamp = ctl ? tradeStamp(ctl, c.symbol, { dial: !spec.core }) : null;
    if (stamp) base.ownerControls = stamp;
    if (why) {
      if (es.shadow.open.length >= BOOK.shadowOpenMax) { row.why = why; return false; }
      es.shadow.open.push({ ...base, shadow: true, shadowWhy: why.replace(/^engine paused.*/, "engine paused").replace(/^Allocator:.*/, "held back by the Allocator") });
      es.seen[c.signalKey] = "s"; out.shadowOpened++; row.why = `${why} (tracked as a shadow trade)`;
      return false;
    }
    const trade = { ...base, tradeId: engineTradeId(spec.tag, c.symbol, c.side, nowIso, { shares: inst === "shares" }) };
    // Stock is not bought in the paper account, so the same-contract rule
    // (one Webull position per contract) has nothing to share.
    const key = inst === "shares" ? null : contractKey(c.symbol, contract), holder = key ? holders.get(key) : null;
    if (holder) {
      trade.noMirror = true;
      trade.shared = { role: "follower", heldBy: holder.engine, heldById: holder.tradeId, since: nowIso };
      if (holder.trade) (holder.trade.sharedWith ||= []).push({ engine: id, tradeId: trade.tradeId, since: nowIso });
      else (record.flagshipShared[holder.tradeId] ||= []).push({ engine: id, tradeId: trade.tradeId, engineRole: "follower", since: nowIso });
      row.note = `Same contract is held by ${engineName(holder.engine)}: recorded here, not bought twice`;
    } else if (key) holders.set(key, { engine: id, tradeId: trade.tradeId, trade });
    record.open.push(trade); mine.push(trade); out.opened.push(trade);
    es.seen[c.signalKey] = "t"; q.openedHere++; if (!spec.core) { total++; newToday++; }
    row.taken = true; row.tradeId = trade.tradeId;
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
  // Check this stock (the Owner page): every scored row of this run by name.
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
    optionPnlPct: t.optionPnlPct, shadowWhy: t.shadowWhy, regime: t.regime, alloc: t.alloc || undefined,
    contract: isSharesTrade(t) ? { structure: "shares", shares: t.contract.shares, mid: t.contract.mid, optionType: "call" } : { strike: t.contract.strike, expiry: t.contract.expiry, mid: t.contract.mid, optionType: t.contract.optionType, ...(t.contract.qty ? { qty: t.contract.qty } : {}) } };
}

function weekdaysSince(from, to) {
  const a = Date.parse(String(from).slice(0, 10) + "T12:00:00Z"), b = Date.parse(String(to).slice(0, 10) + "T12:00:00Z");
  if (!fin(a) || !fin(b) || b <= a) return 0;
  let n = 0;
  for (let ms = a + 86400000; ms <= b; ms += 86400000) { const d = new Date(ms).getUTCDay(); if (d !== 0 && d !== 6) n++; }
  return n;
}
