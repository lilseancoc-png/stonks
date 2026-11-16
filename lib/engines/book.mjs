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
// Pure. No network, no AI.

import { ENGINES, ENGINE_IDS, BOOK, FLAGSHIP, NOT_COUNTED, engineName } from "./config.mjs";
import { EVALUATORS, evalMacro, thesisCheck, withSkips } from "./signals.mjs";
import { contractKey, dteOf, expiryExitDate } from "./contracts.mjs";
import { newEngineState, observe, adapt, rulesVersion } from "./learn.mjs";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);

const ET_ID = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
// TAG:SYMBOL-C|P-MM/DD/YY-HH:MM (entry time, ET). The tag keeps two engines
// that open the same name in the same run apart; the rest matches Top Picks.
export function engineTradeId(tag, symbol, side, entryIso) {
  const p = {};
  for (const x of ET_ID.formatToParts(new Date(entryIso))) p[x.type] = x.value;
  return `${tag}:${symbol}-${side === "put" ? "P" : "C"}-${p.month}/${p.day}/${p.year}-${p.hour}:${p.minute}`;
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
  const pnl = (q.mid / entry - 1) * 100;
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
//   closedKept: closed rows kept before folding (the history test keeps all),
//   specs: engine registry override (what-if tests only; live uses ENGINES).
export function stepBook(state, record, input) {
  const { nowIso, today, late = false, views = {}, ctx = {}, quote, pick, flagshipOpen = [], coverage = null,
    mode = "on", off = new Set(), learn = true, engines = ENGINE_IDS, maxTotal = BOOK.perRunTotal, closedKept = BOOK.closedKept, specs = ENGINES } = input;
  const nowMs = Date.parse(nowIso);
  state.engines ||= {}; record.open ||= []; record.closed ||= [];
  const out = { opened: [], closed: [], shadowOpened: 0, shadowClosed: 0, changes: [], candidates: {} };
  for (const id of engines) state.engines[id] ||= newEngineState(specs[id]);

  // (a) Mark and close.
  const stillOpen = [];
  for (const t of record.open) {
    if (!engines.includes(t.engine)) { stillOpen.push(t); continue; }
    let status = null;
    if (coverage && !coverage.has(t.symbol)) status = "left-coverage";
    else status = markAndCheck(t, quote(t), { today, late, nowMs, view: views[t.symbol] });
    if (status) {
      closeTrade(t, status, nowIso); record.closed.unshift(t); out.closed.push(t);
      const es = state.engines[t.engine];
      if (t.outcome === "loss") es.cooldown[t.symbol] = today;
      if (t.outcome !== "void") observe(es, t);
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
        if (t.outcome !== "void") { observe(es, t, { shadow: true }); es.shadow.closed.unshift(compactShadow(t)); }
      } else keep.push(t);
    }
    es.shadow.open = keep;
    if (es.shadow.closed.length > BOOK.shadowClosedKept) es.shadow.closed.length = BOOK.shadowClosedKept;
  }

  // (b) Learn.
  if (learn) for (const id of engines) {
    for (const c of adapt(state.engines[id], specs[id], { today, parts: typeof learn === "object" ? learn : null })) out.changes.push({ engine: id, ...c });
  }

  // A marks-only step (the history test's close-of-day mark) stops here.
  if (input.marksOnly) { record.builtAtIso = nowIso; record.startedIso ||= nowIso; state.lastRunIso = nowIso; return out; }

  // (c) Candidates and entries. Who holds which contract right now.
  const holders = new Map();
  for (const f of flagshipOpen) if (f?.symbol && f?.contract?.strike && (f.contract.structure || "long") === "long") holders.set(contractKey(f.symbol, { ...f.contract, optionType: f.contract.optionType || f.side }), { engine: FLAGSHIP.id, tradeId: f.tradeId });
  for (const t of record.open) if (!t.noMirror) { const k = contractKey(t.symbol, t.contract); if (!holders.has(k)) holders.set(k, { engine: t.engine, tradeId: t.tradeId, trade: t }); }
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
  for (const id of engines) {
    const spec = specs[id], es = state.engines[id];
    let list = [], skips = [];
    try {
      // withSkips also returns the setups that matched but that today's price
      // move ruled out (the chasing filter), so the page can list them.
      ({ skips } = withSkips(() => {
        if (id === "macro") list = evalMacro(ctx);
        else for (const view of Object.values(views)) {
          if (!view || !view.f) continue;
          if (spec.universe === "stocks" && view.isEtf) continue;
          if (spec.universe === "etfs" && !view.isEtf) continue;
          for (const c of EVALUATORS[id](view, ctx)) list.push(c);
        }
      }));
    } catch (err) { out.errors = [...(out.errors || []), `${id}: ${String(err?.message || err).split("\n")[0]}`]; list = []; skips = []; }
    list = list.filter((c) => c.score >= spec.bar.min).sort((a, b) => b.score - a.score || (a.symbol < b.symbol ? -1 : 1));
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
    let why = null, shadowable = true;
    if (mode !== "on") { why = "engines paused by the owner"; shadowable = false; }
    else if (off.has(id)) { why = "engine switched off"; shadowable = false; }
    else if (mine.some((t) => t.symbol === c.symbol)) { why = "already holds this name"; shadowable = false; }
    else if (es.cooldown[c.symbol] && weekdaysSince(es.cooldown[c.symbol], today) < BOOK.reentrySessions) { why = "lost on this name within five sessions"; shadowable = false; }
    else if (es.setups?.[c.setup]?.muted) why = es.setups[c.setup].probation ? "setup on shadow until it proves itself" : "setup muted (learning)";
    else if (es.paused) why = `engine paused: ${es.paused.why}`;
    else if (c.cell && es.cells?.[c.cell]?.off) why = "standing down in this market type";
    else if (ctx.regime?.cell && es.cells?.[ctx.regime.cell]?.off) why = "standing down in this market type";
    else if (c.score < es.bar) why = "below the bar";
    else if (mine.length + q.openedHere >= spec.slots) why = "no free slot";
    else if (q.openedHere >= spec.perRun) why = "run limit";
    else if (total >= maxTotal) why = "book run limit";
    // One shadow per name. A shadow trade never holds back a real one: a
    // setup that clears every rule still opens while another setup on the
    // same name is being tracked.
    if (why && shadowable && es.shadow.open.some((t) => t.symbol === c.symbol)) { row.why = `${why} (this name is already tracked as a shadow trade)`; return false; }
    const contract = why && !shadowable ? null : pick(view, c.side, spec, c);
    if (!why && (!contract || contract.skip)) { why = `no contract: ${contract?.skip || "none"}`; shadowable = false; }
    if (why && !shadowable) { row.why = why; return false; }
    if (why && (!contract || contract.skip)) { row.why = why; return false; }
    const base = {
      engine: id, tag: spec.tag, symbol: c.symbol, side: c.side, setup: c.setup, score: c.score,
      reasons: c.reasons, facts: c.facts, signalKey: c.signalKey, signalDate: c.signalDate || view?.f?.date || null,
      entryDate: nowIso, entrySpot: r2(view?.spot), contract,
      exits: { ...(spec.exits || {}), ...(spec.setups?.[c.setup]?.exits || {}) }, stopLevel: c.stopLevel ?? null, targetLevel: c.targetLevel ?? null, exitBy: c.exitBy || null,
      rulesVersion: rulesVersion(spec, es), bar: es.bar,
      regime: ctx.regime ? { cell: ctx.regime.cell || null } : null, env: ctx.env || null, macroState: ctx.macroState || null,
      lastSpot: r2(view?.spot), lastMid: contract.mid, optionPnlPct: 0, hiPct: 0, loPct: 0, sessions: 0, lastMarkDate: today,
    };
    if (why) {
      if (es.shadow.open.length >= BOOK.shadowOpenMax) { row.why = why; return false; }
      es.shadow.open.push({ ...base, shadow: true, shadowWhy: why.replace(/^engine paused.*/, "engine paused") });
      es.seen[c.signalKey] = "s"; out.shadowOpened++; row.why = `${why} (tracked as a shadow trade)`;
      return false;
    }
    const trade = { ...base, tradeId: engineTradeId(spec.tag, c.symbol, c.side, nowIso) };
    const key = contractKey(c.symbol, contract), holder = holders.get(key);
    if (holder) {
      trade.noMirror = true;
      trade.shared = { role: "follower", heldBy: holder.engine, heldById: holder.tradeId, since: nowIso };
      if (holder.trade) (holder.trade.sharedWith ||= []).push({ engine: id, tradeId: trade.tradeId, since: nowIso });
      else (record.flagshipShared[holder.tradeId] ||= []).push({ engine: id, tradeId: trade.tradeId, engineRole: "follower", since: nowIso });
      row.note = `Same contract is held by ${engineName(holder.engine)}: recorded here, not bought twice`;
    } else holders.set(key, { engine: id, tradeId: trade.tradeId, trade });
    record.open.push(trade); mine.push(trade); out.opened.push(trade);
    es.seen[c.signalKey] = "t"; q.openedHere++; total++;
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
      const a = (record.archive[t.engine] ||= { n: 0, wins: 0, losses: 0, sumPnl: 0, sumUsd: 0 });
      if (t.outcome === "void") continue;
      a.n++; if (t.outcome === "win") a.wins++; if (t.outcome === "loss") a.losses++;
      a.sumPnl = r1(a.sumPnl + (t.optionPnlPct || 0)); a.sumUsd = Math.round(a.sumUsd + ((t.optionPnlPct || 0) / 100) * (t.contract?.mid || 0) * 100);
    }
  }
  record.builtAtIso = nowIso; record.startedIso ||= nowIso;
  state.lastRunIso = nowIso;
  return out;
}

function compactShadow(t) {
  return { engine: t.engine, symbol: t.symbol, side: t.side, setup: t.setup, score: t.score, entryDate: t.entryDate, exitDate: t.exitDate, status: t.status,
    optionPnlPct: t.optionPnlPct, shadowWhy: t.shadowWhy, regime: t.regime, contract: { strike: t.contract.strike, expiry: t.contract.expiry, mid: t.contract.mid, optionType: t.contract.optionType } };
}

function weekdaysSince(from, to) {
  const a = Date.parse(String(from).slice(0, 10) + "T12:00:00Z"), b = Date.parse(String(to).slice(0, 10) + "T12:00:00Z");
  if (!fin(a) || !fin(b) || b <= a) return 0;
  let n = 0;
  for (let ms = a + 86400000; ms <= b; ms += 86400000) { const d = new Date(ms).getUTCDay(); if (d !== 0 && d !== 6) n++; }
  return n;
}
