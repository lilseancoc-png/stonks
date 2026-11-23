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
//   Flow           signed unusual flow (bought vs sold, delta dollars), the 7-day flow
//                  balance, OI walls and gamma score, short interest, FINRA
//                  short-sale volume, borrow, the hourly volume read
//   Trend follower month-end closes of SPY, QQQ and TLT, and the fed funds
//                  rate (the T-bill return)
//   Momentum       month-end closes of every covered stock, SPY's 10-month
//                  average, TLT and the fed funds rate
//   Allocator      every finished signal-engine trade (real and shadow) by
//                  market type, plus the history test's record as a prior
// and every engine gets the option chain (its own expiry window and delta),
// the Regime Lab market type and the macro backdrop tags on each trade.
//
// No AI call, no network. The files are Owner-only (lib/premium-keys.mjs).

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ENGINES, ENGINE_IDS, SIGNAL_IDS, ENGINES_VERSION, RECORD_KEY, STATE_KEY, VIEW_KEY, ENGINES_START, FLAGSHIP, BOOK, MACRO_ETFS, CLOSE_LABEL, ENGINE_FIXES, ENGINE_TRIALS, SIZE_WEIGHTS, engineSwitches, engineSpecs, engineName, isSharesTrade, contractFor } from "./config.mjs";
import { precompute, featAt, barDate, monthEnds } from "./features.mjs";
import { buildMacro, fearReading } from "./macro.mjs";
import { prepareReports, earnView, fundCore } from "./earn.mjs";
import { stepBook, emptyRecord, emptyState } from "./book.mjs";
import { pickContract, quoteContract, contractKey, positionUsd, contractsOf, expiryExitDate } from "./contracts.mjs";
import { engineTradePop, stampPopResults, popRows, buildPopCheck, tradePopEnabled, compactPop } from "../trade-pop.mjs";
import { engineStats, summarize, maxDrawdown, tradeUsd, flatTradeUsd } from "./record.mjs";
import { coreView } from "./core.mjs";
import { allocPrior, allocView, allocBook } from "./allocator.mjs";
import { learnView } from "./learn.mjs";
import { HEDGE, auxView } from "./hedge.mjs";
import { rankView } from "./rank.mjs";
import { brakePrior, brakeSeed, brakeView } from "./brake.mjs";
import { buildScorecard } from "./scorecard.mjs";
import { runVariants, variantsView } from "./variants.mjs";
import { runBacktest, publicResult, WINDOWS } from "./backtest.mjs";
import { IV_RICHNESS } from "../iv-richness.mjs";
import { etClock, sessionForDate } from "../us-equity-calendar.mjs";
import { pickTradeId } from "../pick-trade-text.mjs";

export { RECORD_KEY as ENGINES_RECORD_KEY, STATE_KEY as ENGINES_STATE_KEY, VIEW_KEY as ENGINES_VIEW_KEY };
export const ENGINES_RESEARCH_PATH = "research/engines/results/latest.json";
// The 2026-11-20 scorecard review on real option prices (aggregates only):
// the scorecard's history reference and the loser brake's prior.
export const ENGINES_SCORECARD_PATH = "research/engines/scorecard/latest.json";
// The Allocator's starting record on real option prices (2026-11-23,
// scripts/engines-alloc-prior.mjs: the history test's every-setup run with
// options priced on Cboe implied volatility). When present it replaces the
// main history run's modeled-price `allocPrior`.
export const ENGINES_ALLOC_PRIOR_PATH = "research/engines/allocator/latest.json";

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

// The real-price prior file, in the shape the Allocator reads
// (`allocPrior(research)`), or null when it is missing or malformed.
// Each row must be { "*": [n, sum], cell: [n, sum], ... } with finite
// numbers; a row that is not is dropped, so a bad cell can't turn a size into
// NaN.
const priorCellOk = (x) => Array.isArray(x) && x.length >= 2 && Number.isInteger(x[0]) && x[0] >= 0 && fin(x[1]);
export function realAllocPrior(doc) {
  const raw = doc?.rows;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rows = {};
  for (const [key, row] of Object.entries(raw)) {
    if (key.split("|").length !== 4 || !row || typeof row !== "object" || !priorCellOk(row["*"])) continue;
    if (Object.values(row).every(priorCellOk)) rows[key] = row;
  }
  if (!Object.keys(rows).length) return null;
  return { from: doc.from || null, to: doc.to || null, n: Number.isFinite(doc.n) ? doc.n : null, rows, pricing: "real", generatedAt: doc.generatedAt || null };
}

export async function loadEnginesResearch(root) {
  try {
    const doc = JSON.parse(await readFile(resolve(root, ENGINES_RESEARCH_PATH), "utf8"));
    if (!(doc && typeof doc === "object" && doc.learningOn)) return null;
    try { const sc = JSON.parse(await readFile(resolve(root, ENGINES_SCORECARD_PATH), "utf8")); if (sc && typeof sc === "object" && Array.isArray(sc.sleeves)) doc.scorecard = sc; } catch { /* no scorecard file: no brake prior, no history reference */ }
    try { const ap = realAllocPrior(JSON.parse(await readFile(resolve(root, ENGINES_ALLOC_PRIOR_PATH), "utf8"))); if (ap) doc.allocPrior = ap; } catch { /* no file: the modeled-price prior stays */ }
    return doc;
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

// The Flow engine's read of one name. Since 2026-11-16 the flow numbers are
// signed (lib/flow-direction.mjs, attached as data.signedFlow by the grade's
// scoreAllTickers): bull = calls bought or puts sold, bear = calls sold or puts
// bought, today's prints in delta dollars plus their premium. With
// FLOW_SIGNED=0 (data.flowPersist not marked signed) it keeps the older
// ask-side call vs put premium, put in the same shape.
function flowRead(sym, data, { unusual, crowdRow, nowMs }) {
  const sf = data?.signedFlow || null;
  const signedOn = !!(unusual && (data?.flowPersist?.signed || (sf && data?.flowPersist == null)));
  let flowNums;
  if (signedOn) {
    const t = sf?.today || {};
    flowNums = {
      signed: true, nBull: t.nBull || 0, nBear: t.nBear || 0,
      bullUsd: t.bullUsd || 0, bearUsd: t.bearUsd || 0, bullPrem: t.bullPrem || 0, bearPrem: t.bearPrem || 0,
    };
  } else {
    const uRow = Array.isArray(unusual?.tickers) ? unusual.tickers.find((t) => t?.symbol === sym) : null;
    const tape = Array.isArray(uRow?.contracts) ? uRow.contracts.filter((c) => c && c.flagged !== false && ["ask", "abv"].includes(c.tape)) : [];
    const sum = (side) => tape.filter((c) => c.side === side).reduce((a, c) => a + (num(c.premium) || 0), 0);
    flowNums = {
      signed: false, nBull: tape.filter((c) => c.side === "call").length, nBear: tape.filter((c) => c.side === "put").length,
      bullUsd: sum("call"), bearUsd: sum("put"), bullPrem: sum("call"), bearPrem: sum("put"),
    };
  }
  const f = data?.fundamentals || {}, si = f.shortInterest || null;
  const settle = si?.settlementDate || f.dateShortInterest || null;
  const settleMs = settle ? Date.parse(String(settle).slice(0, 10) + "T12:00:00Z") : NaN;
  // A snapshot older than 45 days is not read; one with no date is taken as is.
  const siCurrent = fin(settleMs) ? nowMs - settleMs <= 45 * DAY : true;
  const sNow = num(si?.sharesShort) ?? num(f.sharesShort), sPrev = num(si?.priorSharesShort) ?? num(f.sharesShortPriorMonth);
  const oi = data?.oiTrackerRow || null;
  const fee = num(crowdRow?.borrowFeePct);
  // The call volume surge trial (2026-11-20): today's flagged contracts 7+
  // days out, read side by call or put only (most prints have no readable
  // bought or sold side). Premium is the contract's traded premium so far today.
  const uRowAll = Array.isArray(unusual?.tickers) ? unusual.tickers.find((t) => t?.symbol === sym) : null;
  const flagged = Array.isArray(uRowAll?.contracts) ? uRowAll.contracts.filter((c) => c && c.flagged !== false && num(c.dte) >= SURGE_MIN_DTE && num(c.premium) > 0) : [];
  const surgePrem = (side) => flagged.filter((c) => c.side === side).reduce((a, c) => a + num(c.premium), 0);
  const surge = flagged.length ? { n: flagged.length, nCall: flagged.filter((c) => c.side === "call").length, callPrem: Math.round(surgePrem("call")), putPrem: Math.round(surgePrem("put")) } : null;
  return {
    hasUnusual: !!unusual, ...flowNums, surge,
    persist: num(data?.flowPersist?.balance),
    gamma: num(oi?.score), callWall: num(oi?.callWall?.strike),
    siPct: siCurrent ? num(si?.percentFloat) ?? num(f.shortPercentOfFloat) : null,
    covering: siCurrent && sNow != null && sPrev > 0 && sNow < sPrev * 0.95,
    rvol: num(data?.hourlyVolume?.volRatio) ?? num(data?.technicals?.volume?.rvol),
    borrowTight: fee != null && fee >= 8, shortVolZ: num(crowdRow?.shortZ20),
  };
}

const SURGE_MIN_DTE = 7;

// How readable today's option prints are for the Flow engine (2026-11-20):
// its own setups count only prints whose bought or sold side can be read,
// and the hourly scan cannot read a side when the last trade is more than 15
// minutes older than the scan (`tapeStale`). Counts only, for the page.
export function flowHealth(unusual, chains = {}) {
  if (!unusual) return { scan: null, prints: 0, readable: 0, stale: 0, noTape: 0, signedNames: 0 };
  const all = (Array.isArray(unusual.tickers) ? unusual.tickers : []).flatMap((t) => (Array.isArray(t?.contracts) ? t.contracts : []).filter((c) => c && c.flagged !== false));
  const readable = all.filter((c) => !c.tapeStale && ["ask", "abv", "bid", "blw"].includes(c.tape)).length;
  const stale = all.filter((c) => c.tapeStale).length;
  const signedNames = Object.values(chains || {}).filter((d) => d?.signedFlow?.today && ((d.signedFlow.today.nBull || 0) + (d.signedFlow.today.nBear || 0)) > 0).length;
  return { scan: unusual.scannedAt || null, prints: all.length, readable, stale, noTape: all.length - readable - stale, signedNames };
}

// input: { today, nowMs, chains, tickers, isEtf(sym), barsOf(sym), earningsStore,
//          groupOf(sym), unusual, crowdRollup, webullFlow, policyNews }
// webullFlow: { SYM: { wfl, wft, wfl5 } } (lib/webull-data/flow.mjs
// flowShadowRows, sessions before today only); policyNews: { SYM: { frn,
// nvr, ntn } } (lib/policy-news policyNewsShadow rows). Both optional; the
// Flow big-order trial reads the first, Reversion's news tag the second.
export function buildEngineViews(input) {
  const { today, nowMs, chains = {}, tickers = [], isEtf = () => false, barsOf, earningsStore = null, groupOf = () => null, unusual = null, crowdRollup = null, earningsBackup = null, webullFlow = null, policyNews = null } = input;
  const universe = [...new Set([...tickers, ...MACRO_ETFS])];
  const crowd = new Map((Array.isArray(crowdRollup) ? crowdRollup : []).map((r) => [r?.symbol, r]));
  const views = {}, P = {}, health = { universe: universe.length, views: 0, noChain: [], thinBars: [], staleBars: [], earnBackup: [], flow: flowHealth(unusual, chains), webullFlowNames: webullFlow ? Object.keys(webullFlow).length : 0, badInput: [] };
  // Sector-group median forward P/E (Fundamentals reads a stock against it).
  const groupPEs = new Map();
  for (const sym of universe) {
    const pe = num(chains[sym]?.fundamentals?.forwardPE), g = groupOf(sym);
    if (!isEtf(sym) && g && pe > 0) { if (!groupPEs.has(g)) groupPEs.set(g, []); groupPEs.get(g).push(pe); }
  }
  for (const sym of universe) {
    // One name's bad input (2026-11-20): a throw while reading one stock
    // leaves that stock out of this run, named in health.badInput, instead of
    // failing every engine's run (which would also skip every stop and
    // target on the open trades).
    try {
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
    const view = { sym, isEtf: etf, spot: Number(data.spot), f, group: groupOf(sym) || null };
    // Month-end closes for the core engines' monthly check, and the last
    // daily closes for the volatility target (2026-11-21; not enumerable, so
    // a view never carries the series into a file).
    view.mo = monthEnds(p, p.n - 1, today, 14);
    Object.defineProperty(view, "closes", { value: (k) => p.S.c.slice(Math.max(0, p.n - k), p.n), enumerable: false });
    if (!etf) {
      const events = earningsStore?.tickers?.[sym]?.events;
      if (Array.isArray(events) && events.length) {
        view.earn = earnView(p, p.n - 1, prepareReports(events), { today, next: data.earningsHx?.next || null });
        const g = groupOf(sym), pes = g ? groupPEs.get(g) || [] : [];
        view.fund = { core: fundCore(view.earn), live: data.fundamentals || null, groupPE: pes.length >= 3 ? median(pes) : null };
      } else if (data.earningsHx?.next?.date) {
        view.earn = earnView(p, p.n - 1, [], { today, next: data.earningsHx.next });
      }
      // Webull earnings-date backup (data integration, 2026-11-19): a stock
      // with no upcoming report from the main source (Yahoo/Nasdaq, through
      // earningsHx and the earnings store) takes Webull's date, session
      // unknown, so the engines' report rules (Reversion stands aside two
      // sessions before a report, Fundamentals holds off six) still see it.
      // It only holds back new entries: the run-in setup never opens on a
      // backup date alone. Same switch as the Top Picks backup
      // (WEBULL_BACKUPS).
      const bk = earningsBackup?.[sym];
      if (bk && !view.earn?.next) {
        const withBk = earnView(p, p.n - 1, Array.isArray(events) && events.length ? prepareReports(events) : [], { today, next: { date: bk, session: "TBD" } });
        if (withBk?.next) {
          withBk.next.source = "webull-backup";
          view.earn = view.earn ? { ...view.earn, next: withBk.next } : withBk;
          health.earnBackup.push(sym);
        }
      }
    }
    const ivr = data.ivRank || null;
    let band = null;
    try { band = ivr && fin(num(ivr.pctile)) ? IV_RICHNESS.classify({ pctile: num(ivr.pctile), iv: num(ivr.iv), rv30: num(data.technicals?.volRegime?.rv30), earningsDays: null })?.band || null : null; } catch { band = null; }
    view.live = { iv: { band, pctile: num(ivr?.pctile) }, flow: flowRead(sym, data, { unusual, crowdRow: crowd.get(sym) || null, nowMs }) };
    const wb = webullFlow?.[sym];
    if (wb && (fin(num(wb.wfl)) || fin(num(wb.wfl5)))) view.live.flow.wb = { wfl: num(wb.wfl), wft: num(wb.wft), wfl5: num(wb.wfl5) };
    const nw = policyNews?.[sym];
    if (nw) view.live.news = { frn: num(nw.frn), nvr: num(nw.nvr), ntn: num(nw.ntn) };
    views[sym] = view;
    health.views++;
    } catch (err) {
      delete views[sym]; delete P[sym];
      health.badInput.push({ symbol: sym, error: String(err?.message || err).split("\n")[0].slice(0, 200) });
    }
  }
  return { views, P, health };
}

// Views for the sector funds (sectorBars: { SYM: [{ t, c }] } from the wide
// tier's bar store, sectorSpot: { SYM: price }), added to `views` (never over
// a covered name). A fund with too little history is left out.
export function auxViews(sectorBars, sectorSpot, today, views = {}) {
  const out = {};
  if (!sectorBars || typeof sectorBars !== "object") return out;
  for (const sym of HEDGE.sectorFunds) {
    if (views[sym] || !Array.isArray(sectorBars[sym])) continue;
    const v = auxView(sym, sectorBars[sym], today, num(sectorSpot?.[sym]));
    if (v) { views[sym] = v; out[sym] = v; }
  }
  return out;
}

// The run's market context (macro factors with their publication lags, the
// event on the last confirmed session, the Regime Lab market type).
// fearGreed: the bake's CNN fear and greed snapshot ({ score, asOf, stale,
// previous }), read by the extreme-fear bounce test (2026-11-19).
export function fearGreedCtx(fg) {
  if (!fg || !fin(num(fg.score))) return null;
  return { score: num(fg.score), prevClose: num(fg.previous?.close), asOf: fg.asOf ? String(fg.asOf) : null, stale: !!fg.stale, source: fg.source === "webull-backup" ? "Webull (backup)" : "CNN" };
}
export function buildEngineContext({ today, views, fred = {}, vix = null, vix3m = null, liveVol = null, macroEvents = [], regime = null, macroState = null, macroGross = null, bubble = null, fearGreed = null, fearHistory = null }) {
  const lib = buildMacro({ fred, vix, vix3m, events: macroEvents, live: liveVol });
  const factors = lib.factors(today), env = lib.env(today, factors);
  const prev = views.SPY?.f?.date || null;
  return {
    ctx: {
      date: today, spy: views.SPY?.f || null, byId: views, macro: factors, env,
      macroEvent: prev ? lib.eventOn(prev) : null,
      regime: regime?.cell ? { cell: regime.cell, era: regime.era || null, stressed: regime.stressed ?? /stressed$/.test(regime.cell) } : null,
      macroState: macroState || null,
      // The tape's own de-gross multiplier (market-risk sizing, 2026-11-20).
      macroGross: fin(num(macroGross)) ? num(macroGross) : null,
      // The bubble tracker (Downside puts, 2026-11-20): stage ids and the
      // covered stocks' AI buildout roles; null when stale or not built.
      bubble: bubble && (bubble.ai || bubble.market) ? { ai: bubble.ai || null, market: bubble.market || null, roles: bubble.roles || {} } : null,
      fearGreed: fearGreedCtx(fearGreed),
      // The last two confirmed Fear & Greed closes (the index-fear paper trial).
      fear: fearReading(fearHistory, today),
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
//   research (the committed history-test results),
//   fearGreed (the bake's CNN fear and greed snapshot, 2026-11-19).
//   fearHistory (the bake's daily Fear & Greed closes, read by the index-fear
//   paper trial), controls (the Owner controls in force with the account
//   limits, lib/owner-controls.mjs; null = none).
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
  const { mode, off, shares, allocator, fixes, trials, optionUsd, sizing, inst, maxQty, putMaxQty, caps, variants, liveVix } = engineSwitches(env);
  // The registry with any rule change the owner switched off put back, any
  // paper trial switched off retired for new trades, and the Owner Settings
  // instrument choice per engine, and the contract cap (rules 5/6, 2026-11-20).
  const specs = engineSpecs(fixes, trials, inst, maxQty, putMaxQty, caps), fixesOff = ENGINE_FIXES.filter((f) => !fixes[f.id]).map((f) => f.id);
  const prior = allocator !== "off" ? allocPrior(research) : null;

  const { views, P, health } = buildEngineViews({ ...input, today, nowMs });
  // The sector funds the Momentum basket can hold (the VIX and rates pack,
  // 2026-11-21): views from the wide tier's stored daily closes and its
  // latest price, for the core engines only (`aux`).
  const aux = auxViews(input.sectorBars, input.sectorSpot, today, views);
  health.sectorFunds = Object.keys(aux).length;
  // Live VIX (2026-11-22): today's quoted VIX / VIX3M, only for today's date.
  const liveVol = liveVix && input.liveVol?.date === today && fin(num(input.liveVol.vix)) ? input.liveVol : null;
  const { ctx } = buildEngineContext({ today, views, fred: input.fred, vix: input.vix, vix3m: input.vix3m, liveVol, macroEvents: input.macroEvents, regime: input.regime, macroState: input.macroState, macroGross: input.macroGross, bubble: input.bubble, fearGreed: input.fearGreed, fearHistory: input.fearHistory });

  const flagshipOpen = (Array.isArray(input.flagshipOpen) ? input.flagshipOpen : [])
    .filter((e) => e?.symbol && e?.contract)
    .map((e) => ({ tradeId: pickTradeId(e), symbol: e.symbol, side: e.side, contract: e.contract }));
  const quote = (t) => (chains[t.symbol] ? quoteContract(chains[t.symbol], t.contract, { nowMs, rfr })
    : aux[t.symbol] ? quoteContract({ spot: aux[t.symbol].spot }, t.contract, { nowMs, rfr }) : null);
  // The setup's own window and delta where it has them (contractFor).
  const pick = (view, side, spec, c, o = {}) => pickContract(chains[view.sym], side, contractFor(spec, c?.setup), { nowMs, rfr, avoid: o.avoid || null, symbol: view.sym });
  // The loser brake (scorecard pack, 2026-11-21): its prior from the
  // committed real-price history, its live table filled once from the record.
  const bprior = brakePrior(research?.scorecard);
  brakeSeed(state, record, specs);
  const stepInput = {
    nowIso: builtAtIso, today, late, views, ctx, quote, pick, flagshipOpen,
    coverage: new Set([...tickers, ...MACRO_ETFS, ...HEDGE.sectorFunds]), mode: mode === "pause" ? "pause" : "on", off, learn: true, shares,
    allocator: { mode: allocator, prior }, specs, optionUsd, fixesOff, sizing, fillBasis: !!fixes.fillBasis, controls: input.controls || null,
    // The stock split guard reads each name's daily history (Yahoo
    // back-adjusts it after a split) and its split list (bars.splitEvents).
    // ENGINES_SPLIT_GUARD=0 (or off/false/no) turns it off.
    splitBars: /^(0|off|false|no)$/.test(String(env.ENGINES_SPLIT_GUARD ?? "").trim().toLowerCase()) ? null : (sym) => (typeof input.barsOf === "function" ? input.barsOf(sym) : null) || [],
    brake: { enabled: !!fixes.loserBrake, prior: bprior },
  };
  // A new variant book starts from its parent's seen signals and cooldowns as
  // they were before this run (lib/engines/variants.mjs).
  const variantSeed = variants ? Object.fromEntries(ENGINE_IDS.map((id) => [id, { seen: { ...(state.engines?.[id]?.seen || {}) }, cooldown: { ...(state.engines?.[id]?.cooldown || {}) } }])) : null;
  const out = stepBook(state, record, stepInput);
  // Variant shadows (2026-11-21, ENGINES_VARIANTS): each one changes one
  // variable and is stepped on the same input, after the live book. Never
  // mirrored, never learned from, never in the live record.
  let variantRun = null;
  if (variants && (mode === "on" || mode === "pause")) {
    try { variantRun = runVariants(state, stepInput, { specs, today, nowIso: builtAtIso, seedFrom: variantSeed }); }
    catch (err) { variantRun = { ran: 0, opened: 0, closed: 0, errors: [`variants: ${firstLine(err)}`] }; }
    if (variantRun.ran || variantRun.errors?.length) state.variantRuns = [{ iso: builtAtIso, ...variantRun, errors: (variantRun.errors || []).slice(0, 8) }, ...(state.variantRuns || [])].slice(0, 20);
  }

  // Chance of profit (lib/trade-pop.mjs, 2026-11-22): each trade this run
  // opened gets its stated chance, frozen at entry, and each close its
  // outcome. Changes nothing the book does. TRADE_POP=0: no new stamps.
  const popOn = tradePopEnabled(env);
  let popStamped = 0;
  if (popOn) {
    const shadowClosed = ENGINE_IDS.map((id) => state.engines?.[id]?.shadow?.closed || []);
    for (const t of record.open) {
      if (t.pop || t.entryDate !== builtAtIso) continue;
      try {
        const chain = chains[t.symbol] || (aux[t.symbol] ? { spot: aux[t.symbol].spot } : null);
        const stamp = engineTradePop(t, { research, closedLists: [record.closed, ...shadowClosed], chain, bars: (typeof input.barsOf === "function" ? input.barsOf(t.symbol) : null)?.length ? input.barsOf(t.symbol) : input.sectorBars?.[t.symbol] || null,
          rfr, nowMs, today, exitDay: isSharesTrade(t) ? null : expiryExitDate(t.contract?.expiry), costUsd: positionUsd(t.contract) });
        if (stamp) { t.pop = stamp; popStamped++; }
      } catch (err) { out.errors = [...(out.errors || []), `chance of profit ${t.tradeId}: ${firstLine(err)}`]; }
    }
  }
  const popClosed = stampPopResults(record.closed);
  let popCheck = null;
  try {
    popCheck = buildPopCheck(popRows({ flagship: [...(input.flagshipOpen || []), ...(input.flagshipClosed || [])], engines: [...record.open, ...record.closed], webull: input.webullClosed || null }), { builtAtIso, enabled: popOn });
  } catch (err) { out.errors = [...(out.errors || []), `chance of profit check: ${firstLine(err)}`]; }

  state.runs = [{ iso: builtAtIso, late, mode, ...(fixesOff.length ? { fixesOff } : {}), opened: out.opened.length, closed: out.closed.length, shadowOpened: out.shadowOpened, shadowClosed: out.shadowClosed, changes: out.changes.length, views: health.views, first: out.order?.[0] || null, skippedPrice: out.skippedPrice || 0, errors: out.errors || [], ...(out.controls ? { controls: out.controls } : {}), ...(out.splits?.length ? { splits: out.splits } : {}) }, ...(state.runs || [])].slice(0, 40);
  state.candidates = out.candidates;
  // Check this stock: every scored row of this run, by name.
  state.checks = { iso: builtAtIso, rows: out.checks || {} };
  state.changesLog = [...out.changes.map((c) => ({ ...c, iso: builtAtIso })), ...(state.changesLog || [])].slice(0, 120);

  // The recent replay: once per ET day, every engine that can be replayed
  // from bars and report dates, over the bars the build holds, with the same
  // rule code. It catches a rule that has drifted from its long-history read.
  if (state.replay?.date !== today) {
    try { state.replay = { date: today, ...recentReplay({ P, input, today, specs, optionUsd, sizing }) }; } catch (err) { state.replay = { date: today, error: firstLine(err) }; }
  }

  const view = buildEnginesView({ record, state, ctx, builtAtIso, mode, off, shares, allocator, prior, spyNow: num(chains.SPY?.spot), health, research, flagshipStats: input.flagshipStats || null, out, specs, fixes, trials, optionUsd, sizing, inst, variants, today, brakePriorRows: bprior });
  view.popCheck = popCheck;
  return {
    record, state, view,
    summary: { pop: { on: popOn, stamped: popStamped, closed: popClosed }, variants: variantRun ? { ran: variantRun.ran, opened: variantRun.opened, closed: variantRun.closed, errors: variantRun.errors.length } : null, opened: out.opened.length, openedCore: out.opened.filter((t) => ENGINES[t.engine]?.core).length, openedTrial: out.opened.filter((t) => t.trial).length, closed: out.closed.length, shadowOpened: out.shadowOpened, shadowClosed: out.shadowClosed, changes: out.changes.length, views: health.views, open: record.open.length, closedTotal: record.closed.length, errors: out.errors || [], late, mode },
  };
}

// Replays the engines over the confirmed bars on hand (about two years; the
// first ten months only warm up the 200-day reads) with real report dates.
function recentReplay({ P, input, today, specs = ENGINES, optionUsd = BOOK.optionUsd, sizing = null }) {
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
  const base = { series, isEtf, fred: input.fred || {}, vix: input.vix, vix3m: input.vix3m, macroEvents: input.macroEvents || [], reports, labels: labels.size ? labels : null, from, to: today, engines: ENGINE_IDS.filter((id) => id !== "flow"), learn: false, control: 8, specs, optionUsd, sizing };
  const slim = (res) => {
    const pub = publicResult(res);
    for (const e of Object.values(pub.engines)) { delete e.byYear; delete e.byScore; delete e.log; delete e.byEnv; if (e.shares) { delete e.shares.byYear; delete e.shares.byEnv; } }
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
  entryDate: t.entryDate, entrySpot: t.entrySpot ?? null, instrument: isSharesTrade(t) ? "shares" : "option",
  contract: !t.contract ? null : isSharesTrade(t) ? { structure: "shares", optionType: "call", shares: t.contract.shares, flatShares: t.contract.flatShares ?? null, mid: t.contract.mid, usd: t.contract.usd ?? null, costPct: t.contract.costPct ?? null }
    : { structure: "long", optionType: t.contract.optionType, strike: t.contract.strike, expiry: t.contract.expiry, dte: t.contract.dte ?? null, mid: t.contract.mid, bid: t.contract.bid ?? null, ask: t.contract.ask ?? null, spreadPct: t.contract.spreadPct ?? null, iv: t.contract.iv ?? null, delta: t.contract.delta ?? null, qty: contractsOf(t.contract), flatQty: t.contract.flatQty ?? null, usd: Math.round(positionUsd(t.contract)) },
  // How the size was set (2026-11-19) and the fill basis (ask in, bid out).
  size: t.contract?.size ? { mode: t.contract.size.mode || null, why: t.contract.size.why || null, mult: t.contract.size.mult ?? null, parts: t.contract.size.parts || [], budget: t.contract.size.budget ?? null,
    cap: t.contract.size.cap ?? null, capped: t.contract.size.capped ?? null, wantQty: t.contract.size.wantQty ?? null, tapeMult: t.contract.size.tapeMult ?? null } : null,
  fill: t.fill ? { basis: t.fill.basis, entry: t.fill.entry ?? null, exit: t.fill.exit ?? null, exitBasis: t.fill.exitBasis || null } : null,
  markPnlPct: t.markPnlPct ?? null, lastBid: t.lastBid ?? null, flatUsd: fin(t.optionPnlPct) ? Math.round(flatTradeUsd(t)) : null,
  test: !!t.test, twinOf: t.twinOf || null, twin: t.twin || null,
  // Stock splits the trade followed (lib/engines/split.mjs), and a big gap
  // marked as a real move after the split hold, for a look.
  splits: (t.corpActions || []).filter((a) => a?.type === "split").map((a) => ({ factor: a.factor, date: a.date })), splitReview: t.splitReview || null, splitUnconfirmed: t.splitUnconfirmed || null,
  exits: t.exits || null, stopLevel: t.stopLevel ?? null, targetLevel: t.targetLevel ?? null, exitBy: t.exitBy || null,
  lastMid: t.lastMid ?? null, lastSpot: t.lastSpot ?? null, markSource: t.markSource || null, optionPnlPct: t.optionPnlPct ?? null, hiPct: t.hiPct ?? null, loPct: t.loPct ?? null, sessions: t.sessions ?? 0,
  status: t.status || "open", statusLabel: t.status ? `${CLOSE_LABEL[t.status] || t.status}${t.exitDate && t.markSource === "model" && !isSharesTrade(t) ? " (on a model price: the contract had no usable quote)" : ""}` : null, exitModel: !!(t.exitDate && t.markSource === "model" && !isSharesTrade(t)), exitDate: t.exitDate || null, exitMid: t.exitMid ?? null, exitSpot: t.exitSpot ?? null, outcome: t.outcome || null, exitLate: !!t.exitLate,
  rulesVersion: t.rulesVersion || null, regime: t.regime || null, env: t.env || null, macroState: t.macroState || null,
  tape: t.tape || null, news: t.news || null,
  noMirror: !!t.noMirror, shared: t.shared || null, sharedWith: t.sharedWith || null,
  alloc: t.alloc || null, fixesOff: t.fixesOff || null, trial: !!t.trial,
  // The stated chance of profit at entry and, once closed, its outcome.
  pop: t.pop || null,
});

// A core engine against the S&P 500: what its holdings made (closed and
// open, in dollars) against the same money put in SPY on the day it first had
// a target. Days in T-bills earn nothing in the record (no interest is
// booked), which the page says.
function coreBench(es, spec, closed, open, spyNow) {
  const b = es?.bench;
  if (!b || !(b.spy > 0)) return null;
  const capital = (spec.lotUsd || 0) * (spec.top || spec.slots || 1);
  const done = closed.filter((t) => t.outcome !== "void").map(tradeUsd).filter(fin).reduce((a, x) => a + x, 0);
  const live = open.map(tradeUsd).filter(fin).reduce((a, x) => a + x, 0);
  const spyPct = fin(spyNow) && spyNow > 0 ? (spyNow / b.spy - 1) * 100 : null;
  return { since: b.date, spyThen: b.spy, spyNow: fin(spyNow) ? spyNow : null, capital, usd: Math.round(done + live), pct: capital ? Math.round(((done + live) / capital) * 1000) / 10 : null,
    spyPct: fin(spyPct) ? Math.round(spyPct * 10) / 10 : null, spyUsd: fin(spyPct) ? Math.round((capital * spyPct) / 100) : null };
}

// Live against the history test, setup by setup (2026-11-17, the money-leak
// fixes): the engine's closed trades under its current hand-made rules (from
// the rules version its newest rules change started) beside the same setup
// in the committed history test ("as it runs"), options and share trades on
// rows of their own. `modelGain` setups carry the caveat that most of their
// history gain came from the option-price model (volatility read from past
// moves, which lags a shock), not from the funds moving their way.
export const LIVE_VS_HISTORY = Object.freeze({ minLive: 10, band: 5 });
const versionNum = (v) => { const m = /-(\d+)$/.exec(String(v || "")); return m ? Number(m[1]) : null; };
export function liveVsHistory(spec, es, closed, open, hist) {
  const rulesLog = es?.rulesFrom || (es?.log || []).find((l) => l.kind === "rules") || null;
  const fromV = versionNum(rulesLog?.v);
  const current = (t) => fromV == null || (versionNum(t.rulesVersion) ?? 0) >= fromV;
  const live = closed.filter(current), liveOpen = open.filter(current);
  const liveStats = engineStats(live);
  const pickRow = (rows, key) => (rows || []).find((r) => r.key === key) || null;
  const out = [];
  for (const [key, s] of Object.entries(spec.setups || {})) {
    if (s.retired) continue;
    // A paper trial is scored apart (engineStats `trials`), on one row.
    for (const inst of s.trial ? ["trial"] : ["option", "shares"]) {
      const block = (x) => (inst === "trial" ? x?.trials : inst === "shares" ? x?.shares : x);
      const L = pickRow(block(liveStats)?.bySetup, key);
      const H = pickRow(block(hist)?.bySetup, key);
      const openN = liveOpen.filter((t) => t.setup === key && (inst === "trial" ? !!t.trial : !t.trial && isSharesTrade(t) === (inst === "shares"))).length;
      if (!L && !H && !openN) continue;
      const n = L?.n || 0, diff = L && H && fin(L.avg) && fin(H.avg) ? Math.round((L.avg - H.avg) * 10) / 10 : null;
      const read = !H ? "no-history" : n < LIVE_VS_HISTORY.minLive ? "too-early" : diff > LIVE_VS_HISTORY.band ? "ahead" : diff < -LIVE_VS_HISTORY.band ? "behind" : "in-line";
      out.push({ key, label: s.label, instrument: inst === "trial" ? "shares" : inst, trial: inst === "trial", modelGain: !!s.modelGain,
        live: { n, open: openN, winRate: L?.winRate ?? null, avg: L?.avg ?? null, usd: L?.usd ?? 0 },
        history: H ? { n: H.n, winRate: H.winRate ?? null, avg: H.avg ?? null } : null, diff, read });
    }
  }
  return { since: rulesLog ? { date: rulesLog.date, v: rulesLog.v } : null, rows: out };
}

// What a setup buys on its up side, for the page: "option", "shares" or "both".
function instrumentOfSetup(spec, key, s, shares) {
  if (spec.core) return "shares";
  if (s.instrument === "both" || s.instrument === "shares") return s.instrument;
  if (s.instrument === "options" || spec.instrument === "options") return "option";
  if (spec.instrument === "shares" || spec.instrument === "both") return spec.instrument;
  return s.calls === "shares" && shares ? "shares" : "option";
}
// Conviction sizing against flat sizing (2026-11-19): closed trades that
// carry a flat size, their dollars at the size taken and at the flat size.
export function sizingCompare(closed, open = []) {
  const sized = (closed || []).filter((t) => t.contract && (Number.isInteger(t.contract.flatQty) || Number.isInteger(t.contract.flatShares)) && t.outcome !== "void" && fin(t.optionPnlPct));
  const half = (rows) => ({ n: rows.length, usd: Math.round(rows.reduce((a, t) => a + (tradeUsd(t) || 0), 0)), flatUsd: Math.round(rows.reduce((a, t) => a + (flatTradeUsd(t) || 0), 0)),
    bigger: rows.filter((t) => sizeOf(t) > flatOf(t)).length, smaller: rows.filter((t) => sizeOf(t) < flatOf(t)).length });
  const opt = sized.filter((t) => !isSharesTrade(t)), shr = sized.filter(isSharesTrade);
  const openSized = (open || []).filter((t) => t.contract && (Number.isInteger(t.contract.flatQty) || Number.isInteger(t.contract.flatShares)));
  return { options: half(opt), shares: half(shr), open: openSized.length, ...sizeBuckets(sized, openSized) };
}
// Does the engine size well on its own? (2026-11-20, owner: "if we give it a
// wide range and our engine makes better decisions and sizes accordingly per
// conviction ... then I'm more confident"). The same closed, risk-sized
// trades split by the conviction multiplier (sized down / about flat / sized
// up) and, for options, by contracts bought, each with its win rate, average
// result in % and dollars. Labeled tests (fixed at one contract) are left
// out. `capped` counts trades whose size the contract cap set (recorded since
// 2026-11-20). A read needs SIZE_READ_MIN closed trades in both the sized-up
// and the sized-down group; until then it says so.
export const SIZE_READ_MIN = 20;
const MULT_BANDS = [["down", "Sized down (under 0.9x)", (m) => m < 0.9], ["flat", "About flat (0.9x to 1.1x)", (m) => m >= 0.9 && m <= 1.1], ["up", "Sized up (over 1.1x)", (m) => m > 1.1]];
const QTY_BANDS = [["1-2", 1, 2], ["3-5", 3, 5], ["6-10", 6, 10], ["11-17", 11, 17], ["18-25", 18, 25], ["26-50", 26, 50], ["51-100", 51, 100], ["over 100", 101, Infinity]];
const multOf = (t) => (fin(Number(t.contract?.size?.mult)) ? Number(t.contract.size.mult) : 1);
function bandStats(rows) {
  const n = rows.length, wins = rows.filter((t) => t.optionPnlPct > 0).length;
  return { n, winRate: n ? Math.round((wins / n) * 1000) / 10 : null, avg: n ? Math.round((rows.reduce((a, t) => a + t.optionPnlPct, 0) / n) * 100) / 100 : null,
    usd: Math.round(rows.reduce((a, t) => a + (tradeUsd(t) || 0), 0)), avgMult: n ? Math.round((rows.reduce((a, t) => a + multOf(t), 0) / n) * 100) / 100 : null };
}
function sizeRead(bands) {
  const up = bands.find((b) => b.key === "up"), down = bands.find((b) => b.key === "down");
  if (!up || !down || up.n < SIZE_READ_MIN || down.n < SIZE_READ_MIN) return { state: "too-few", need: SIZE_READ_MIN, up: up?.n || 0, down: down?.n || 0 };
  const gap = Math.round((up.avg - down.avg) * 100) / 100;
  return { state: gap > 0 ? "helps" : gap < 0 ? "hurts" : "even", gap, need: SIZE_READ_MIN, up: up.n, down: down.n };
}
function sizeBuckets(sized, open) {
  const rows = sized.filter((t) => !t.test && t.contract?.size?.mode === "risk");
  const byMult = (list) => {
    const bands = MULT_BANDS.map(([key, label, test]) => ({ key, label, ...bandStats(list.filter((t) => test(multOf(t)))) }));
    return { bands, read: sizeRead(bands) };
  };
  const opt = rows.filter((t) => !isSharesTrade(t)), shr = rows.filter(isSharesTrade);
  const byQty = QTY_BANDS.map(([label, lo, hi]) => ({ label, lo, hi, ...bandStats(opt.filter((t) => { const q = contractsOf(t.contract); return q >= lo && q <= hi; })) })).filter((b) => b.n || b.hi <= 25);
  const capOf = (list) => list.filter((t) => t.contract?.size?.capped === true).length;
  const openRisk = (open || []).filter((t) => !t.test && t.contract?.size?.mode === "risk");
  return { buckets: { options: byMult(opt), shares: byMult(shr), byQty, capped: { options: capOf(opt), recorded: opt.filter((t) => typeof t.contract?.size?.capped === "boolean").length, open: capOf(openRisk.filter((t) => !isSharesTrade(t))) } } };
}
const sizeOf = (t) => (isSharesTrade(t) ? Number(t.contract.shares) || 0 : contractsOf(t.contract));
const flatOf = (t) => (isSharesTrade(t) ? (Number.isInteger(t.contract.flatShares) ? t.contract.flatShares : Number(t.contract.shares) || 0) : (Number.isInteger(t.contract.flatQty) ? t.contract.flatQty : contractsOf(t.contract)));

// Every hand-made rules step up to the current one, oldest first.
function rulesSteps(r) {
  const out = [];
  for (let x = r; x && (x.n || 1) > 1; x = x.before) out.unshift({ n: x.n, date: x.date || null, note: x.note || "" });
  return out;
}
export function buildEnginesView({ record, state, ctx, builtAtIso, mode = "on", off = new Set(), shares = true, allocator = "off", prior = null, spyNow = null, health = null, research = null, flagshipStats = null, out = null, specs = ENGINES, fixes = null, trials = null, optionUsd = BOOK.optionUsd, sizing = null, inst = null, variants = true, today = null, brakePriorRows = undefined }) {
  const day = today || String(builtAtIso || "").slice(0, 10);
  const CLOSED_SHOWN = 80;
  const engines = ENGINE_IDS.map((id) => {
    const spec = specs[id] || ENGINES[id], es = state.engines?.[id] || null;
    const open = record.open.filter((t) => t.engine === id), closed = record.closed.filter((t) => t.engine === id);
    const stats = engineStats(closed);
    const arch = record.archive?.[id] || null, archShares = record.archiveShares?.[id] || null;
    const lv = es ? learnView(es, spec) : null;
    const openUsdOf = (list) => list.reduce((a, t) => a + (fin(t.optionPnlPct) && t.contract?.mid > 0 ? (t.optionPnlPct / 100) * positionUsd(t.contract) : 0), 0);
    const openOpt = open.filter((t) => !t.trial && !isSharesTrade(t)), openShr = open.filter((t) => !t.trial && isSharesTrade(t)), openTrial = open.filter((t) => t.trial);
    const { shares: shareStats, trials: trialStats, ...optStats } = stats;
    return {
      id, tag: spec.tag, name: spec.name, idea: spec.idea, reads: spec.reads, universe: spec.universe, slots: spec.slots, perRun: spec.perRun,
      contract: spec.contract, exits: spec.exits, test: spec.test, forwardWhy: spec.forwardWhy || null, budgetX: spec.budgetX ?? null, onlySide: spec.onlySide || null,
      sideSlots: spec.sideSlots || null, standing: !!spec.standing, rules: spec.rules ? { n: spec.rules.n, date: spec.rules.date, note: spec.rules.note, steps: rulesSteps(spec.rules) } : null,
      rank: id === "fundamentals" && es ? rankView(es, open) : null,
      // Core engines: the monthly target, its log and the S&P comparison.
      core: !!spec.core, lotUsd: spec.lotUsd || null, top: spec.top || null, funds: spec.funds || null, liveTest: !!spec.liveTest,
      holdings: spec.core ? { ...coreView(es, open), bench: coreBench(es, spec, closed, open, spyNow) } : null,
      switchedOff: off.has(id),
      bar: { now: es?.bar ?? spec.bar.base, base: spec.bar.base, min: spec.bar.min, max: spec.bar.max },
      rulesVersion: lv?.rulesVersion || `${spec.tag}-1`, paused: es?.paused || null,
      setups: Object.entries(spec.setups).map(([key, s]) => {
        const st = es?.setups?.[key] || {}, row = lv?.setups?.find((x) => x.key === key) || null;
        const ins = instrumentOfSetup(spec, key, s, shares);
        return { key, label: s.label, how: s.how, exits: s.exits || null, exitsAll: s.exits ? { ...(spec.exits || {}), ...s.exits } : null, contract: s.contract || null, modelGain: !!s.modelGain,
          calls: ins === "option" ? "option" : ins, instrument: ins, retiredSides: s.retiredSides || [], test: !!s.test, switchedOff: !!s.switchedOff, crashStand: !!s.crashStand, trial: !!s.trial,
          state: s.retired ? (s.switchedOff ? "off" : "retired") : st.muted ? (st.probation ? "shadow" : "muted") : "trading", since: st.since || null, startsOnShadow: !!s.probation, retired: !!s.retired, real: row?.real || null, shadow: row?.shadow || null, realShares: row?.realShares || null, shadowShares: row?.shadowShares || null };
      }),
      vsHistory: spec.core ? null : liveVsHistory(spec, es, closed, open, research?.learningOn?.engines?.[id] || null),
      // Money-leak fixes switched off that reach this engine (the history
      // test always runs with every fix on).
      fixesOff: spec.core || !fixes ? [] : ENGINE_FIXES.filter((f) => fixes[f.id] === false && f.engines.includes(id)).map((f) => f.id),
      sharesStopAtr: fin(spec.sharesStopAtr) ? spec.sharesStopAtr : null, sharesOwnStop: spec.sharesOwnStop !== false,
      instrument: spec.core ? "shares" : inst?.[id] || "default",
      // Conviction size against flat size (2026-11-19): the same closed
      // trades at each size, options and shares, since sizing began.
      sizing: spec.core ? null : sizingCompare(closed, open),
      standDown: lv?.cells || [],
      candidates: state.candidates?.[id] || [],
      open: open.map(tradeRow),
      closed: closed.slice(0, CLOSED_SHOWN).map((t) => ({ ...tradeRow(t), pop: compactPop(t.pop) })), closedTotal: closed.length + (arch?.n || 0),
      // Option trades at the top; share trades scored apart (null until the
      // engine has held one).
      stats: { ...optStats, maxDrawdownUsd: maxDrawdown(optStats.curve), openUsd: Math.round(openUsdOf(openOpt)), archived: arch },
      sharesStats: shareStats || openShr.length || archShares ? { ...(shareStats || summarize([])), maxDrawdownUsd: maxDrawdown(shareStats?.curve), open: openShr.length, openUsd: Math.round(openUsdOf(openShr)), archived: archShares } : null,
      // Paper trials (unproven setups, shares), scored apart from both.
      trialStats: trialStats || openTrial.length ? { ...(trialStats || summarize([])), maxDrawdownUsd: maxDrawdown(trialStats?.curve), open: openTrial.length, openUsd: Math.round(openUsdOf(openTrial)) } : null,
      shadow: { open: (es?.shadow?.open || []).map((t) => ({ symbol: t.symbol, side: t.side, setup: t.setup, score: t.score, entryDate: t.entryDate, optionPnlPct: t.optionPnlPct ?? null, why: t.shadowWhy || null,
        contract: isSharesTrade(t) ? { structure: "shares", shares: t.contract.shares, mid: t.contract.mid, optionType: "call" } : { strike: t.contract?.strike, expiry: t.contract?.expiry, mid: t.contract?.mid, optionType: t.contract?.optionType } })),
        closed: (es?.shadow?.closed || []).slice(0, 40), stats: summarize(es?.shadow?.closed || []) },
      learning: lv ? { log: lv.log, changes: lv.changes, shadowOpen: lv.shadow.open, shadowClosed: lv.shadow.closed } : null,
      history: research ? { raw: research.raw?.engines?.[id] || null, held: research.learningOff?.engines?.[id] || null, live: research.learningOn?.engines?.[id] || null } : null,
      replay: state.replay && !state.replay.error && !state.replay.skipped ? { raw: state.replay.raw?.engines?.[id] || null, held: state.replay.held?.engines?.[id] || null } : null,
    };
  });
  // Same-contract labels, one row per shared contract.
  const shared = [];
  const byKey = new Map();
  for (const t of record.open) { if (isSharesTrade(t)) continue; const k = contractKey(t.symbol, t.contract); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(t); }
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
  const compare = engines.map((e) => ({ id: e.id, name: e.name, tag: e.tag, core: e.core, open: e.open.length, slots: e.slots, n: e.stats.n, winRate: e.stats.winRate, winRange: e.stats.winRange, avg: e.stats.avg, median: e.stats.median, usd: e.stats.usd, openUsd: e.stats.openUsd, profitFactor: e.stats.profitFactor, maxDrawdownUsd: e.stats.maxDrawdownUsd, bar: e.bar.now, rulesVersion: e.rulesVersion, paused: !!e.paused, switchedOff: e.switchedOff, shadowN: e.shadow.stats.n, shadowAvg: e.shadow.stats.avg,
    shares: e.sharesStats ? { open: e.sharesStats.open, n: e.sharesStats.n, winRate: e.sharesStats.winRate, avg: e.sharesStats.avg, usd: e.sharesStats.usd, openUsd: e.sharesStats.openUsd } : null,
    trials: e.trialStats ? { open: e.trialStats.open, n: e.trialStats.n, winRate: e.trialStats.winRate, avg: e.trialStats.avg, usd: e.trialStats.usd, openUsd: e.trialStats.openUsd } : null,
    bench: e.holdings?.bench ? { pct: e.holdings.bench.pct, spyPct: e.holdings.bench.spyPct, usd: e.holdings.bench.usd, spyUsd: e.holdings.bench.spyUsd } : null }));
  // Totals: the signal engines' options and share trades, and the core
  // engines' holdings apart (a monthly fund or basket holding is a third unit).
  const isCore = (t) => !!ENGINES[t.engine]?.core;
  const all = record.closed.filter((t) => !t.trial && !isSharesTrade(t)), allShares = record.closed.filter((t) => !t.trial && isSharesTrade(t) && !isCore(t)), allCore = record.closed.filter(isCore), allTrials = record.closed.filter((t) => t.trial);
  // The Allocator: today's read of every signal-engine setup, and the dollar
  // line of the real trades it stamped (at its size against normal size).
  let alloc = null;
  if (allocator !== "off") {
    try {
      alloc = { ...allocView(state, prior, specs, SIGNAL_IDS, ctx?.regime?.cell || null, { mode: allocator, shares }),
        book: allocBook(record.closed.filter((t) => !isCore(t) && !t.trial), tradeUsd),
        held: SIGNAL_IDS.reduce((a, id) => a + (state.engines?.[id]?.shadow?.open || []).filter((t) => t.alloc && t.alloc.status === "closed").length, 0),
        history: research?.allocator || null, priorFrom: research?.allocPrior ? { from: research.allocPrior.from || null, to: research.allocPrior.to || null, n: research.allocPrior.n || null, pricing: research.allocPrior.pricing || "modeled", builtAt: research.allocPrior.generatedAt || null } : null };
    } catch (err) { alloc = { mode: allocator, error: firstLine(err) }; }
  }
  return {
    version: ENGINES_VERSION, builtAtIso, runIso: state.lastRunIso || builtAtIso, startDate: ENGINES_START, startedIso: record.startedIso || null,
    // Risk and conviction sizing and the fill basis (2026-11-19).
    sizing: sizing ? { mode: sizing.mode, budget: sizing.budget ?? null, conviction: !!sizing.conviction, maxQty: sizing.maxQty ?? BOOK.riskMaxQty, putMaxQty: sizing.mode === "risk" ? Math.min(sizing.maxQty ?? BOOK.riskMaxQty, sizing.putMaxQty ?? BOOK.putMaxQty) : null, maxQtyBefore: BOOK.riskMaxQtyBefore, wholeDte: BOOK.riskWholeDte, stopPad: BOOK.riskStopPad, skipX: BOOK.riskSkipX, sharesMaxUsd: sizing.sharesMaxUsd ?? BOOK.sharesMaxUsd, maxPremiumUsd: sizing.mode === "risk" ? sizing.maxPremiumUsd ?? BOOK.maxPremiumUsd : null, putMaxPremiumUsd: sizing.mode === "risk" ? Math.min(sizing.maxPremiumUsd ?? BOOK.maxPremiumUsd, sizing.putMaxPremiumUsd ?? BOOK.putMaxPremiumUsd) : null, convMin: BOOK.convMin, convMax: BOOK.convMax, weights: SIZE_WEIGHTS, optionUsd: sizing.optionUsd ?? null,
      compare: sizingCompare(record.closed.filter((t) => !ENGINES[t.engine]?.core), record.open.filter((t) => !ENGINES[t.engine]?.core)) } : null,
    fillBasis: fixes ? fixes.fillBasis !== false : false,
    fear: ctx?.fearGreed ? { score: ctx.fearGreed.score, asOf: ctx.fearGreed.asOf, stale: ctx.fearGreed.stale, source: ctx.fearGreed.source, below: BOOK.fearBelow } : null,
    mode, flagship: FLAGSHIP,
    book: { perRunTotal: BOOK.perRunTotal, maxCost: BOOK.maxCost, minMid: BOOK.minMid, maxSpreadPct: BOOK.maxSpreadPct, expiryExitSessions: BOOK.expiryExitSessions, reentrySessions: BOOK.reentrySessions,
      optionUsd: fin(optionUsd) && optionUsd > 0 ? optionUsd : null,
      shares: { on: !!shares, usd: BOOK.sharesUsd, costPct: BOOK.sharesCostPct * 2, stopAtr: BOOK.sharesStopAtr, targetAtr: BOOK.sharesTargetAtr, maxSessions: BOOK.sharesMaxSessions } },
    market: { regime: ctx?.regime || null, env: ctx?.env || null, macroState: ctx?.macroState || null, macroGross: ctx?.macroGross ?? null, macroEvent: ctx?.macroEvent || null,
      macro: ctx?.macro ? { y10: ctx.macro.y10, y10Chg: ctx.macro.y10Chg, nfci: ctx.macro.nfci, nfciChg: ctx.macro.nfciChg, usdChgPct: ctx.macro.usdChgPct, vix: ctx.macro.vix, vixLive: !!ctx.macro.vixLive, vixRatio: ctx.macro.vixRatio, dffChg: ctx.macro.dffChg, cpiYoy: ctx.macro.cpiYoy } : null },
    engines, compare,
    total: { ...summarize(all), open: record.open.filter((t) => !t.trial && !isSharesTrade(t)).length, shares: { ...summarize(allShares), open: record.open.filter((t) => !t.trial && isSharesTrade(t) && !isCore(t)).length },
      core: { ...summarize(allCore), open: record.open.filter(isCore).length },
      trials: { ...summarize(allTrials), open: record.open.filter((t) => t.trial).length } },
    allocator: alloc,
    flagshipStats,
    shared, flagshipShared: record.flagshipShared || {},
    lastRun: out ? { opened: out.opened.map((t) => t.tradeId), closed: out.closed.map((t) => ({ tradeId: t.tradeId, status: t.status, optionPnlPct: t.optionPnlPct })), shadowOpened: out.shadowOpened, shadowClosed: out.shadowClosed, changes: out.changes, errors: out.errors || [] } : null,
    runs: (state.runs || []).slice(0, 20), changes: (state.changesLog || []).slice(0, 60),
    health,
    research: research ? { version: research.version, generatedAt: research.generatedAt, data: research.data, notes: research.notes, windows: research.windows || WINDOWS, engines: research.engines, optionUsd: research.optionUsd ?? null } : null,
    replay: state.replay ? { date: state.replay.date, from: state.replay.from || null, to: state.replay.to || null, error: state.replay.error || null, skipped: state.replay.skipped || null } : null,
    closeLabels: CLOSE_LABEL,
    // The money-leak fixes (2026-11-17) and whether each is on.
    fixes: ENGINE_FIXES.map((f) => ({ id: f.id, label: f.label, engines: f.engines, step: f.step, on: fixes ? fixes[f.id] !== false : true })),
    // The paper trials (2026-11-19, more on 2026-11-20) and whether each is on.
    trialSwitches: ENGINE_TRIALS.map((t) => ({ id: t.id, label: t.label, engine: t.engine, setup: t.setup, date: t.date || null, on: trials ? trials[t.id] !== false : true })),
    liveVsHistory: LIVE_VS_HISTORY,
    // Check this stock (Owner controls): every scored row of the last run.
    checks: state.checks || null,
    // The scorecard pack (2026-11-21): the per-engine scorecard from the live
    // record, the loser brake's table and the variant shadows.
    scorecard: safely(() => buildScorecard(record, { today: day, history: research?.scorecard || null, specs })),
    brake: safely(() => ({ ...brakeView(state, brakePriorRows === undefined ? brakePrior(research?.scorecard) : brakePriorRows, { enabled: fixes ? fixes.loserBrake !== false : true }),
      priorFrom: research?.scorecard ? { from: research.scorecard.from, to: research.scorecard.to } : null })),
    variants: safely(() => ({ ...variantsView(state, record, { today: day, enabled: variants !== false }), runs: (state.variantRuns || []).slice(0, 10) })),
  };
}

// One page block that throws is shown as its error, not the whole page lost.
function safely(fn) { try { return fn(); } catch (err) { return { error: firstLine(err) }; } }

// Compact stats of the flagship record for the "All engines" comparison row.
export function flagshipCompare(acc) {
  if (!acc) return null;
  const closed = (Array.isArray(acc.closed) ? acc.closed : []).filter((t) => fin(num(t?.optionPnlPct)) && (t.outcome === "win" || t.outcome === "loss" || t.outcome === "flat"));
  const p = closed.map((t) => Number(t.optionPnlPct)), wins = p.filter((x) => x > 0).length;
  return { id: FLAGSHIP.id, name: FLAGSHIP.name, open: Array.isArray(acc.open) ? acc.open.length : 0, n: p.length, winRate: p.length ? Math.round((wins / p.length) * 1000) / 1000 : null, avg: p.length ? Math.round((p.reduce((a, b) => a + b, 0) / p.length) * 10) / 10 : null };
}
