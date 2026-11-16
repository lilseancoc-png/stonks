// Strategy engines: the bake hooks. The build calls three things here:
//   loadEngineFiles()   before the data/ wipe (record, state, page file);
//   runEngines()        at the 11:00 and 15:30 ET Top Picks runs, right after
//                       the flagship record is written: mark and close, learn,
//                       open new trades, and build the page file;
//   carryEngineFiles()  on every other bake (the three files are re-written
//                       exactly as they were read).
// The engines act only at the two decision runs because that is when the
// Webull paper mirror is pinged, so the record and the paper account move
// together.
//
// What each engine is fed (nothing here is fetched: every input is something
// the build already holds in memory):
//   Technicals     confirmed daily bars (open, high, low, close, volume)
//   Reversion      the same bars, plus report dates (it stands aside near one)
//   Macro          FRED yields, financial conditions, dollar, fed funds, CPI,
//                  unemployment; the VIX curve from the overnight sweep; Fed,
//                  CPI and jobs dates; fund bars and chains
//   Earnings       the stored report list (dates, sessions, EPS, surprise,
//                  guidance, implied move), reactions and run-ins from bars,
//                  the IV band (no run-in trade into very rich options)
//   Fundamentals   EPS growth and beat record from the report list, estimate
//                  revisions, margins, cash flow, debt, forward P/E against
//                  the sector group, analyst targets
//   Flow           unusual prints at the ask and their premium, the 7-day flow
//                  balance, OI walls and gamma score, short interest, FINRA
//                  short-sale volume, borrow, the hourly volume read
// and every engine gets the option chain (its own expiry window and delta),
// the Regime Lab market type and the macro backdrop tags on each trade.
//
// No AI call, no network. The files are Owner-only (lib/premium-keys.mjs).

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ENGINES, ENGINE_IDS, ENGINES_VERSION, RECORD_KEY, STATE_KEY, VIEW_KEY, ENGINES_START, FLAGSHIP, BOOK, MACRO_ETFS, CLOSE_LABEL, engineSwitches, engineName } from "./config.mjs";
import { precompute, featAt, barDate } from "./features.mjs";
import { buildMacro } from "./macro.mjs";
import { prepareReports, earnView, fundCore } from "./earn.mjs";
import { stepBook, emptyRecord, emptyState } from "./book.mjs";
import { pickContract, quoteContract, contractKey } from "./contracts.mjs";
import { engineStats, summarize, maxDrawdown } from "./record.mjs";
import { learnView } from "./learn.mjs";
import { runBacktest, publicResult, WINDOWS } from "./backtest.mjs";
import { IV_RICHNESS } from "../iv-richness.mjs";
import { etClock, sessionForDate } from "../us-equity-calendar.mjs";
import { pickTradeId } from "../pick-trade-text.mjs";

export { RECORD_KEY as ENGINES_RECORD_KEY, STATE_KEY as ENGINES_STATE_KEY, VIEW_KEY as ENGINES_VIEW_KEY };
export const ENGINES_RESEARCH_PATH = "research/engines/results/latest.json";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const num = (x) => (x == null || x === "" ? null : fin(Number(x)) ? Number(x) : null);
const firstLine = (err) => String(err?.message || err).split("\n")[0];
const DAY = 86400000;

export const enginesEnabled = (env = process.env) => engineSwitches(env).mode !== "off";

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
const validRecord = (d) => !!d && typeof d === "object" && Array.isArray(d.open) && Array.isArray(d.closed);
const validState = (d) => !!d && typeof d === "object" && !!d.engines && typeof d.engines === "object";

async function readBody(dataDir, key) {
  try { return { body: await readFile(resolve(dataDir, key), "utf8") }; } catch (err) {
    return err?.code === "ENOENT" ? { missing: true } : { error: firstLine(err) };
  }
}

// A missing file is a fresh start. A file that is there but cannot be read or
// parsed sets `skip`: the engines do nothing this build and the stored copy
// is left alone (an empty record must never replace a real one).
export async function loadEngineFiles(dataDir) {
  const out = { record: null, state: null, raw: {}, fresh: false, skip: false, error: null, partial: null };
  const parts = [[RECORD_KEY, "record", validRecord, emptyRecord], [STATE_KEY, "state", validState, emptyState]];
  for (const [key, name, valid, empty] of parts) {
    const r = await readBody(dataDir, key);
    if (r.missing) { out[name] = empty(); if (name === "record") out.fresh = true; continue; }
    if (r.error) { out.skip = true; out.error = `${key}: ${r.error}`; continue; }
    let doc = null;
    try { doc = JSON.parse(r.body); } catch { doc = null; }
    if (!valid(doc)) { out.skip = true; out.error = `${key} does not parse as engine ${name}`; continue; }
    out[name] = doc; out.raw[key] = r.body;
  }
  // One file present without the other (a part-written run, or a file removed
  // by hand): carry on with a fresh copy of the missing one rather than freeze.
  // "Already holds this name" still stops a duplicate of any open trade.
  if (!out.skip && !!out.raw[RECORD_KEY] !== !!out.raw[STATE_KEY]) out.partial = out.raw[RECORD_KEY] ? `${STATE_KEY} was missing: learning state starts over` : `${RECORD_KEY} was missing: the record starts over`;
  const v = await readBody(dataDir, VIEW_KEY);
  if (v.body) out.raw[VIEW_KEY] = v.body;
  if (out.skip) { out.record = null; out.state = null; }
  return out;
}

// Re-write the files exactly as they were read (bakes that are not decision
// runs, and decision runs where the engines could not run).
export async function carryEngineFiles(dataDir, loaded) {
  let n = 0;
  for (const key of [RECORD_KEY, STATE_KEY, VIEW_KEY]) {
    const body = loaded?.raw?.[key];
    if (typeof body === "string" && body.length) { await writeFile(resolve(dataDir, key), body, "utf8"); n++; }
  }
  return n;
}

export async function writeEngineFiles(dataDir, { record, state, view }) {
  const bodies = { [RECORD_KEY]: JSON.stringify(record), [STATE_KEY]: JSON.stringify(state), [VIEW_KEY]: JSON.stringify(view) };
  // The record goes last: if a write fails part-way, the next build still
  // reads the previous record from the store with a state that is at worst
  // one run ahead (extra "seen" signals), never a record ahead of its state.
  for (const key of [STATE_KEY, VIEW_KEY, RECORD_KEY]) await writeFile(resolve(dataDir, key), bodies[key], "utf8");
  return { recordBytes: bodies[RECORD_KEY].length, stateBytes: bodies[STATE_KEY].length, viewBytes: bodies[VIEW_KEY].length };
}

export async function loadEnginesResearch(root) {
  try {
    const doc = JSON.parse(await readFile(resolve(root, ENGINES_RESEARCH_PATH), "utf8"));
    return doc && typeof doc === "object" && doc.learningOn ? doc : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Views: what each engine sees for one name
// ---------------------------------------------------------------------------
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Confirmed bars only: nothing dated today or later (a decision during the
// session reads through the prior close, exactly like the history test).
function confirmedBars(bars, today) {
  if (!Array.isArray(bars)) return [];
  const out = [];
  for (const b of bars) { const d = barDate(b?.t ?? b?.date); if (d && d < today) out.push({ t: d, o: num(b.o), h: num(b.h), l: num(b.l), c: num(b.c), v: num(b.v) }); }
  return out;
}

// The Flow engine's read of one name.
function flowRead(sym, data, { unusual, crowdRow, nowMs }) {
  const uRow = Array.isArray(unusual?.tickers) ? unusual.tickers.find((t) => t?.symbol === sym) : null;
  const tape = Array.isArray(uRow?.contracts) ? uRow.contracts.filter((c) => c && c.flagged !== false && ["ask", "abv"].includes(c.tape)) : [];
  const sum = (side) => tape.filter((c) => c.side === side).reduce((a, c) => a + (num(c.premium) || 0), 0);
  const f = data?.fundamentals || {}, si = f.shortInterest || null;
  const settle = si?.settlementDate || f.dateShortInterest || null;
  const settleMs = settle ? Date.parse(String(settle).slice(0, 10) + "T12:00:00Z") : NaN;
  // A snapshot older than 45 days is not read; one with no date is taken as is.
  const siCurrent = fin(settleMs) ? nowMs - settleMs <= 45 * DAY : true;
  const sNow = num(si?.sharesShort) ?? num(f.sharesShort), sPrev = num(si?.priorSharesShort) ?? num(f.sharesShortPriorMonth);
  const oi = data?.oiTrackerRow || null;
  const fee = num(crowdRow?.borrowFeePct);
  return {
    hasUnusual: !!unusual, nCall: tape.filter((c) => c.side === "call").length, nPut: tape.filter((c) => c.side === "put").length,
    callPrem: sum("call"), putPrem: sum("put"),
    persist: num(data?.flowPersist?.balance),
    gamma: num(oi?.score), callWall: num(oi?.callWall?.strike),
    siPct: siCurrent ? num(si?.percentFloat) ?? num(f.shortPercentOfFloat) : null,
    covering: siCurrent && sNow != null && sPrev > 0 && sNow < sPrev * 0.95,
    rvol: num(data?.hourlyVolume?.volRatio) ?? num(data?.technicals?.volume?.rvol),
    borrowTight: fee != null && fee >= 8, shortVolZ: num(crowdRow?.shortZ20),
  };
}

// input: { today, nowMs, chains, tickers, isEtf(sym), barsOf(sym), earningsStore,
//          groupOf(sym), unusual, crowdRollup }
export function buildEngineViews(input) {
  const { today, nowMs, chains = {}, tickers = [], isEtf = () => false, barsOf, earningsStore = null, groupOf = () => null, unusual = null, crowdRollup = null } = input;
  const universe = [...new Set([...tickers, ...MACRO_ETFS])];
  const crowd = new Map((Array.isArray(crowdRollup) ? crowdRollup : []).map((r) => [r?.symbol, r]));
  const views = {}, P = {}, health = { universe: universe.length, views: 0, noChain: [], thinBars: [], staleBars: [] };
  // Sector-group median forward P/E (Fundamentals reads a stock against it).
  const groupPEs = new Map();
  for (const sym of universe) {
    const pe = num(chains[sym]?.fundamentals?.forwardPE), g = groupOf(sym);
    if (!isEtf(sym) && g && pe > 0) { if (!groupPEs.has(g)) groupPEs.set(g, []); groupPEs.get(g).push(pe); }
  }
  for (const sym of universe) {
    const data = chains[sym];
    if (!data || !(Number(data.spot) > 0)) { health.noChain.push(sym); continue; }
    const p = precompute(confirmedBars(barsOf(sym), today));
    const f = featAt(p);
    if (!f) { health.thinBars.push(sym); continue; }
    // Bars that stop well before today (a failed history fetch reused an old
    // copy) would make every read stale: skip the name this run.
    if ((Date.parse(today + "T12:00:00Z") - Date.parse(f.date + "T12:00:00Z")) / DAY > 5) { health.staleBars.push(sym); continue; }
    P[sym] = p;
    const etf = !!isEtf(sym) || MACRO_ETFS.includes(sym);
    const view = { sym, isEtf: etf, spot: Number(data.spot), f };
    if (!etf) {
      const events = earningsStore?.tickers?.[sym]?.events;
      if (Array.isArray(events) && events.length) {
        view.earn = earnView(p, p.n - 1, prepareReports(events), { today, next: data.earningsHx?.next || null });
        const g = groupOf(sym), pes = g ? groupPEs.get(g) || [] : [];
        view.fund = { core: fundCore(view.earn), live: data.fundamentals || null, groupPE: pes.length >= 3 ? median(pes) : null };
      } else if (data.earningsHx?.next?.date) {
        view.earn = earnView(p, p.n - 1, [], { today, next: data.earningsHx.next });
      }
    }
    const ivr = data.ivRank || null;
    let band = null;
    try { band = ivr && fin(num(ivr.pctile)) ? IV_RICHNESS.classify({ pctile: num(ivr.pctile), iv: num(ivr.iv), rv30: num(data.technicals?.volRegime?.rv30), earningsDays: null })?.band || null : null; } catch { band = null; }
    view.live = { iv: { band, pctile: num(ivr?.pctile) }, flow: flowRead(sym, data, { unusual, crowdRow: crowd.get(sym) || null, nowMs }) };
    views[sym] = view;
    health.views++;
  }
  return { views, P, health };
}

// The run's market context (macro factors with their publication lags, the
// event on the last confirmed session, the Regime Lab market type).
export function buildEngineContext({ today, views, fred = {}, vix = null, vix3m = null, macroEvents = [], regime = null, macroState = null }) {
  const lib = buildMacro({ fred, vix, vix3m, events: macroEvents });
  const factors = lib.factors(today), env = lib.env(today, factors);
  const prev = views.SPY?.f?.date || null;
  return {
    ctx: {
      date: today, spy: views.SPY?.f || null, byId: views, macro: factors, env,
      macroEvent: prev ? lib.eventOn(prev) : null,
      regime: regime?.cell ? { cell: regime.cell, era: regime.era || null, stressed: regime.stressed ?? /stressed$/.test(regime.cell) } : null,
      macroState: macroState || null,
    },
    lib,
  };
}

// ---------------------------------------------------------------------------
// The decision-run step
// ---------------------------------------------------------------------------
// input:
//   loaded { record, state }, builtAtIso, chains, tickers, isEtf, barsOf,
//   earningsStore, groupOf, unusual, crowdRollup, fred { ID: rows }, vix,
//   vix3m, macroEvents, regime (today's Regime Lab label), labelRows (the
//   label history, for the replay), macroState, flagshipOpen (the Top Picks
//   record's open trades, just written), flagshipStats, rfr, env,
//   research (the committed history-test results).
export function runEngines(input) {
  const { loaded, builtAtIso, chains = {}, tickers = [], rfr = 0.045, env = process.env, research = null } = input;
  const record = loaded.record, state = loaded.state;
  const nowMs = Date.parse(builtAtIso);
  const clock = etClock(nowMs), today = clock.date;
  const sess = sessionForDate(today);
  // The engines act only while the market is open. A forced build on a
  // weekend, a market holiday, before the open or after the close has stale
  // quotes and nothing the paper account could fill: the build carries the
  // stored files forward instead (no marks, no session counted, no trades).
  const closedWhy = !sess ? null : !sess.open ? "the market is closed today" : clock.minute < sess.openMinute ? "the market has not opened yet" : clock.minute >= sess.closeMinute ? "the market has closed for the day" : null;
  if (closedWhy && !input.anyTime) return { skipped: closedWhy };
  // The afternoon run, or any run on a half day (the only one that day).
  const late = clock.minute >= 13 * 60 || (sess ? sess.closeMinute < 960 : false);
  const { mode, off } = engineSwitches(env);

  const { views, P, health } = buildEngineViews({ ...input, today, nowMs });
  const { ctx } = buildEngineContext({ today, views, fred: input.fred, vix: input.vix, vix3m: input.vix3m, macroEvents: input.macroEvents, regime: input.regime, macroState: input.macroState });

  const flagshipOpen = (Array.isArray(input.flagshipOpen) ? input.flagshipOpen : [])
    .filter((e) => e?.symbol && e?.contract)
    .map((e) => ({ tradeId: pickTradeId(e), symbol: e.symbol, side: e.side, contract: e.contract }));
  const quote = (t) => (chains[t.symbol] ? quoteContract(chains[t.symbol], t.contract, { nowMs, rfr }) : null);
  const pick = (view, side, spec) => pickContract(chains[view.sym], side, spec.contract, { nowMs, rfr });
  const out = stepBook(state, record, {
    nowIso: builtAtIso, today, late, views, ctx, quote, pick, flagshipOpen,
    coverage: new Set([...tickers, ...MACRO_ETFS]), mode: mode === "pause" ? "pause" : "on", off, learn: true,
  });

  state.runs = [{ iso: builtAtIso, late, mode, opened: out.opened.length, closed: out.closed.length, shadowOpened: out.shadowOpened, shadowClosed: out.shadowClosed, changes: out.changes.length, views: health.views, errors: out.errors || [] }, ...(state.runs || [])].slice(0, 40);
  state.candidates = out.candidates;
  state.changesLog = [...out.changes.map((c) => ({ ...c, iso: builtAtIso })), ...(state.changesLog || [])].slice(0, 120);

  // The recent replay: once per ET day, every engine that can be replayed
  // from bars and report dates, over the bars the build holds, with the same
  // rule code. It catches a rule that has drifted from its long-history read.
  if (state.replay?.date !== today) {
    try { state.replay = { date: today, ...recentReplay({ P, input, today }) }; } catch (err) { state.replay = { date: today, error: firstLine(err) }; }
  }

  const view = buildEnginesView({ record, state, ctx, builtAtIso, mode, off, health, research, flagshipStats: input.flagshipStats || null, out });
  return {
    record, state, view,
    summary: { opened: out.opened.length, closed: out.closed.length, shadowOpened: out.shadowOpened, shadowClosed: out.shadowClosed, changes: out.changes.length, views: health.views, open: record.open.length, closedTotal: record.closed.length, errors: out.errors || [], late, mode },
  };
}

// Replays the engines over the confirmed bars on hand (about two years; the
// first ten months only warm up the 200-day reads) with real report dates.
function recentReplay({ P, input, today }) {
  const series = {};
  for (const [sym, p] of Object.entries(P)) series[sym] = p.S;
  const spy = P.SPY?.S?.t || [];
  if (spy.length < 300) return { skipped: `only ${spy.length} SPY sessions on hand` };
  const from = spy[Math.min(spy.length - 1, 215)];
  const reports = {};
  for (const [sym, row] of Object.entries(input.earningsStore?.tickers || {})) if (series[sym] && Array.isArray(row?.events) && row.events.length) reports[sym] = row.events;
  const labels = new Map();
  for (const r of Array.isArray(input.labelRows) ? input.labelRows : []) if (r?.date && r.cell) labels.set(r.date, { cell: r.cell, era: r.era || null, stressed: /stressed$/.test(r.cell) });
  const isEtf = (s) => !!input.isEtf?.(s) || MACRO_ETFS.includes(s);
  const base = { series, isEtf, fred: input.fred || {}, vix: input.vix, vix3m: input.vix3m, macroEvents: input.macroEvents || [], reports, labels: labels.size ? labels : null, from, to: today, engines: ENGINE_IDS.filter((id) => id !== "flow"), learn: false, control: 8 };
  const slim = (res) => {
    const pub = publicResult(res);
    for (const e of Object.values(pub.engines)) { delete e.byYear; delete e.byScore; delete e.log; delete e.byEnv; }
    return pub;
  };
  return { from, to: today, raw: slim(runBacktest({ ...base, raw: true })), held: slim(runBacktest(base)) };
}

// ---------------------------------------------------------------------------
// The page file (engines.json, Owner-only)
// ---------------------------------------------------------------------------
const tradeRow = (t) => ({
  tradeId: t.tradeId, engine: t.engine, tag: t.tag, symbol: t.symbol, side: t.side, setup: t.setup, score: t.score, bar: t.bar ?? null,
  reasons: t.reasons || [], facts: t.facts || null,
  entryDate: t.entryDate, entrySpot: t.entrySpot ?? null,
  contract: t.contract ? { structure: "long", optionType: t.contract.optionType, strike: t.contract.strike, expiry: t.contract.expiry, dte: t.contract.dte ?? null, mid: t.contract.mid, bid: t.contract.bid ?? null, ask: t.contract.ask ?? null, spreadPct: t.contract.spreadPct ?? null, iv: t.contract.iv ?? null, delta: t.contract.delta ?? null } : null,
  exits: t.exits || null, stopLevel: t.stopLevel ?? null, targetLevel: t.targetLevel ?? null, exitBy: t.exitBy || null,
  lastMid: t.lastMid ?? null, lastSpot: t.lastSpot ?? null, markSource: t.markSource || null, optionPnlPct: t.optionPnlPct ?? null, hiPct: t.hiPct ?? null, loPct: t.loPct ?? null, sessions: t.sessions ?? 0,
  status: t.status || "open", statusLabel: t.status ? CLOSE_LABEL[t.status] || t.status : null, exitDate: t.exitDate || null, exitMid: t.exitMid ?? null, exitSpot: t.exitSpot ?? null, outcome: t.outcome || null, exitLate: !!t.exitLate,
  rulesVersion: t.rulesVersion || null, regime: t.regime || null, env: t.env || null, macroState: t.macroState || null,
  noMirror: !!t.noMirror, shared: t.shared || null, sharedWith: t.sharedWith || null,
});

export function buildEnginesView({ record, state, ctx, builtAtIso, mode = "on", off = new Set(), health = null, research = null, flagshipStats = null, out = null }) {
  const CLOSED_SHOWN = 80;
  const engines = ENGINE_IDS.map((id) => {
    const spec = ENGINES[id], es = state.engines?.[id] || null;
    const open = record.open.filter((t) => t.engine === id), closed = record.closed.filter((t) => t.engine === id);
    const stats = engineStats(closed);
    const arch = record.archive?.[id] || null;
    const lv = es ? learnView(es, spec) : null;
    const openUsd = open.reduce((a, t) => a + (fin(t.optionPnlPct) && t.contract?.mid > 0 ? (t.optionPnlPct / 100) * t.contract.mid * 100 : 0), 0);
    return {
      id, tag: spec.tag, name: spec.name, idea: spec.idea, reads: spec.reads, universe: spec.universe, slots: spec.slots, perRun: spec.perRun,
      contract: spec.contract, exits: spec.exits, test: spec.test,
      switchedOff: off.has(id),
      bar: { now: es?.bar ?? spec.bar.base, base: spec.bar.base, min: spec.bar.min, max: spec.bar.max },
      rulesVersion: lv?.rulesVersion || `${spec.tag}-1`, paused: es?.paused || null,
      setups: Object.entries(spec.setups).map(([key, s]) => {
        const st = es?.setups?.[key] || {}, row = lv?.setups?.find((x) => x.key === key) || null;
        return { key, label: s.label, how: s.how, exits: s.exits || null, state: st.muted ? (st.probation ? "shadow" : "muted") : "trading", since: st.since || null, startsOnShadow: !!s.probation, real: row?.real || null, shadow: row?.shadow || null };
      }),
      standDown: lv?.cells || [],
      candidates: state.candidates?.[id] || [],
      open: open.map(tradeRow),
      closed: closed.slice(0, CLOSED_SHOWN).map(tradeRow), closedTotal: closed.length + (arch?.n || 0),
      stats: { ...stats, maxDrawdownUsd: maxDrawdown(stats.curve), openUsd: Math.round(openUsd), archived: arch },
      shadow: { open: (es?.shadow?.open || []).map((t) => ({ symbol: t.symbol, side: t.side, setup: t.setup, score: t.score, entryDate: t.entryDate, optionPnlPct: t.optionPnlPct ?? null, why: t.shadowWhy || null, contract: { strike: t.contract?.strike, expiry: t.contract?.expiry, mid: t.contract?.mid, optionType: t.contract?.optionType } })),
        closed: (es?.shadow?.closed || []).slice(0, 40), stats: summarize(es?.shadow?.closed || []) },
      learning: lv ? { log: lv.log, changes: lv.changes, shadowOpen: lv.shadow.open, shadowClosed: lv.shadow.closed } : null,
      history: research ? { raw: research.raw?.engines?.[id] || null, held: research.learningOff?.engines?.[id] || null, live: research.learningOn?.engines?.[id] || null } : null,
      replay: state.replay && !state.replay.error && !state.replay.skipped ? { raw: state.replay.raw?.engines?.[id] || null, held: state.replay.held?.engines?.[id] || null } : null,
    };
  });
  // Same-contract labels, one row per shared contract.
  const shared = [];
  const byKey = new Map();
  for (const t of record.open) { const k = contractKey(t.symbol, t.contract); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(t); }
  for (const [k, list] of byKey) {
    const flag = Object.entries(record.flagshipShared || {}).filter(([, rows]) => rows.some((r) => list.some((t) => t.tradeId === r.tradeId)));
    if (list.length < 2 && !flag.length) continue;
    const holder = list.find((t) => !t.noMirror) || null;
    const flagHolds = flag.length && list.every((t) => t.noMirror);
    shared.push({
      key: k, symbol: list[0].symbol, contract: { optionType: list[0].contract.optionType, strike: list[0].contract.strike, expiry: list[0].contract.expiry },
      heldBy: flagHolds ? { engine: FLAGSHIP.id, name: FLAGSHIP.name, tradeId: flag[0][0] } : holder ? { engine: holder.engine, name: engineName(holder.engine), tradeId: holder.tradeId } : null,
      alsoOn: [
        ...list.filter((t) => t !== holder || flagHolds).map((t) => ({ engine: t.engine, name: engineName(t.engine), tradeId: t.tradeId })),
        ...(flagHolds ? [] : flag.map(([id]) => ({ engine: FLAGSHIP.id, name: FLAGSHIP.name, tradeId: id }))),
      ],
    });
  }
  const compare = engines.map((e) => ({ id: e.id, name: e.name, tag: e.tag, open: e.open.length, slots: e.slots, n: e.stats.n, winRate: e.stats.winRate, winRange: e.stats.winRange, avg: e.stats.avg, median: e.stats.median, usd: e.stats.usd, openUsd: e.stats.openUsd, profitFactor: e.stats.profitFactor, maxDrawdownUsd: e.stats.maxDrawdownUsd, bar: e.bar.now, rulesVersion: e.rulesVersion, paused: !!e.paused, switchedOff: e.switchedOff, shadowN: e.shadow.stats.n, shadowAvg: e.shadow.stats.avg }));
  const all = record.closed;
  return {
    version: ENGINES_VERSION, builtAtIso, runIso: state.lastRunIso || builtAtIso, startDate: ENGINES_START, startedIso: record.startedIso || null,
    mode, flagship: FLAGSHIP,
    book: { perRunTotal: BOOK.perRunTotal, maxCost: BOOK.maxCost, minMid: BOOK.minMid, maxSpreadPct: BOOK.maxSpreadPct, expiryExitSessions: BOOK.expiryExitSessions, reentrySessions: BOOK.reentrySessions },
    market: { regime: ctx?.regime || null, env: ctx?.env || null, macroState: ctx?.macroState || null, macroEvent: ctx?.macroEvent || null,
      macro: ctx?.macro ? { y10: ctx.macro.y10, y10Chg: ctx.macro.y10Chg, nfci: ctx.macro.nfci, nfciChg: ctx.macro.nfciChg, usdChgPct: ctx.macro.usdChgPct, vix: ctx.macro.vix, vixRatio: ctx.macro.vixRatio, dffChg: ctx.macro.dffChg, cpiYoy: ctx.macro.cpiYoy } : null },
    engines, compare,
    total: { ...summarize(all), open: record.open.length },
    flagshipStats,
    shared, flagshipShared: record.flagshipShared || {},
    lastRun: out ? { opened: out.opened.map((t) => t.tradeId), closed: out.closed.map((t) => ({ tradeId: t.tradeId, status: t.status, optionPnlPct: t.optionPnlPct })), shadowOpened: out.shadowOpened, shadowClosed: out.shadowClosed, changes: out.changes, errors: out.errors || [] } : null,
    runs: (state.runs || []).slice(0, 20), changes: (state.changesLog || []).slice(0, 60),
    health,
    research: research ? { version: research.version, generatedAt: research.generatedAt, data: research.data, notes: research.notes, windows: research.windows || WINDOWS, engines: research.engines } : null,
    replay: state.replay ? { date: state.replay.date, from: state.replay.from || null, to: state.replay.to || null, error: state.replay.error || null, skipped: state.replay.skipped || null } : null,
    closeLabels: CLOSE_LABEL,
  };
}

// Compact stats of the flagship record for the "All engines" comparison row.
export function flagshipCompare(acc) {
  if (!acc) return null;
  const closed = (Array.isArray(acc.closed) ? acc.closed : []).filter((t) => fin(num(t?.optionPnlPct)) && (t.outcome === "win" || t.outcome === "loss" || t.outcome === "flat"));
  const p = closed.map((t) => Number(t.optionPnlPct)), wins = p.filter((x) => x > 0).length;
  return { id: FLAGSHIP.id, name: FLAGSHIP.name, open: Array.isArray(acc.open) ? acc.open.length : 0, n: p.length, winRate: p.length ? Math.round((wins / p.length) * 1000) / 1000 : null, avg: p.length ? Math.round((p.reduce((a, b) => a + b, 0) / p.length) * 10) / 10 : null };
}
