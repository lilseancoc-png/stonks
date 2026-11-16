// Prediction market odds tracker (2026-11-15): what people are betting on in
// politics, geopolitics, policy, the Fed, the economy, commodities, crypto and
// named companies, from Kalshi's and Polymarket's free public read APIs, and
// whether those odds line up with stock moves.
//
// Three files:
//   prediction-odds.json        PUBLIC. The tracked contracts by theme with
//                               their chance, 1 / 7 / 30-day changes, a 30-day
//                               line, resolve date, venue link and the covered
//                               stocks each one can move; recent big odds
//                               moves; the market's expected number for coming
//                               data releases and how recent ones came out.
//   prediction-odds-owner.json  OWNER. The tests (odds jumps, lead or echo,
//                               run-ups, release surprises), the jump log with
//                               what stocks did next, the run-up watch list,
//                               open Top Picks trades with linked odds moving,
//                               per-name shadow values and untracked candidates.
//   prediction-odds-state.json  OWNER, internal. Every tracked contract with its
//                               daily and hourly price history and the release
//                               guesses. Read before the bake wipes data/.
//
// Cost: none. Both venues' market-data reads are free and keyless; no AI call
// is made; every call is counted against a per-bake budget (BAKE_CALL_BUDGET).
// Measurement first: nothing here changes a grade, a pick, a gate or the
// Track Record. The shadow keys (pmo, pmn, pmCut, pmPol, pmJmp) are logged in
// grades-daily.json and tested like every other candidate input; the AI
// grader sees the odds only with PICKS_ODDS_GRADER=1, locked off until the
// Owner's 2026-12-07 review.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { THEMES, THEME_LABEL, LINK_RULES, linksFor, leaderTerms } from './catalog.mjs';
import { createClient, kalshiSeriesMap, kalshiOpenEvents, polyOpenEvents, kalshiMarketsByTicker, polyMarketsById, kalshiQuote, polyQuote, kalshiHistory, polyHistory } from './venues.mjs';
import { kalshiCandidates, polyCandidates, selectContracts, pairAcrossVenues } from './select.mjs';
import { etParts, etDate, addDays, daysBetween, noteSnapshot, mergeFine, mergeCoarse, dailyAt, dailySeries, changeOver, change24h, sparkDaily, trimHourly } from './history.mjs';
import { analyzeReactions, jumpFollowThrough, trailingMove, familyKey } from './reactions.mjs';
import { snapshotConsensus, settleConsensus, backfillConsensus, consensusRows, consensusTest, consensusPublic, pruneConsensus } from './consensus.mjs';

// Plain names for each link rule (shown beside a stock link).
export const RULE_LABELS = Object.freeze({ ...Object.fromEntries(LINK_RULES.map((r) => [r.id, r.label])), company: 'Names the company' });

export const PREDICTION_KEY = 'prediction-odds.json';
export const PREDICTION_OWNER_KEY = 'prediction-odds-owner.json';
export const PREDICTION_STATE_KEY = 'prediction-odds-state.json';
export const PREDICTION_VERSION = 1;
export const BAKE_CALL_BUDGET = 260;
// The longest one bake's reads may take, in ms. The tracker runs ahead of the
// Top Picks run in the same build, so a decision run (11:00 / 15:30 ET) gets
// the shorter limit. PREDICTION_MAX_SECONDS overrides both. A run that hits
// the limit keeps what it read; the rest stays on its last stored price and
// history fills continue on the next bake.
export const BAKE_MAX_MS = 90000;
export const BAKE_MAX_MS_DECISION = 45000;
export function bakeMaxMs({ decisionRun = false, env = process.env } = {}) {
  const n = Number(env?.PREDICTION_MAX_SECONDS);
  if (Number.isFinite(n) && n >= 5) return Math.round(n * 1000);
  return decisionRun ? BAKE_MAX_MS_DECISION : BAKE_MAX_MS;
}
export const RESOLVED_KEEP_DAYS = 120;
export const BACKFILL_DAYS = 365;
export const BACKFILL_CHUNK_DAYS = 90;
export const TOPUP_LOOKBACK_DAYS = 7;
const DAY = 86400000;

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const pct = (p) => (Number.isFinite(p) ? Math.round(p * 1000) / 10 : null);
const errText = (e) => String(e?.message || e || 'error').split('\n')[0].slice(0, 160);

export function emptyState() {
  return { version: PREDICTION_VERSION, contracts: {}, consensus: { events: {}, settledCheck: {} }, discoveredDate: null, candidates: [], venues: {} };
}

async function readJson(dataDir, key) {
  try { return JSON.parse(await readFile(resolve(dataDir, key), 'utf8')); } catch { return null; }
}
export async function readPredictionPrior(dataDir) {
  const [state, pub, owner] = await Promise.all([readJson(dataDir, PREDICTION_STATE_KEY), readJson(dataDir, PREDICTION_KEY), readJson(dataDir, PREDICTION_OWNER_KEY)]);
  return { state: state && typeof state === 'object' && state.contracts ? state : null, pub, owner };
}
export async function writePredictionFiles(dataDir, { state, pub, owner }) {
  const writes = [];
  if (state) writes.push(writeFile(resolve(dataDir, PREDICTION_STATE_KEY), JSON.stringify(state), 'utf8'));
  if (pub) writes.push(writeFile(resolve(dataDir, PREDICTION_KEY), JSON.stringify(pub), 'utf8'));
  if (owner) writes.push(writeFile(resolve(dataDir, PREDICTION_OWNER_KEY), JSON.stringify(owner), 'utf8'));
  await Promise.all(writes);
}

// The chance before a result: the last day's value before it settled.
function lastPreResult(c, resolvedDate) {
  const rows = dailySeries(c).filter((r) => r[0] < resolvedDate);
  return rows.length ? rows[rows.length - 1][1] : c.last?.p ?? null;
}

function applyQuote(c, q, nowMs) {
  if (!q) return false;
  if (q.closeTime) c.closeTime = q.closeTime;
  if (q.volume != null) c.volume = q.volume;
  if (q.volume24h != null) c.volume24h = q.volume24h;
  if (q.openInterest != null) c.openInterest = q.openInterest;
  if (q.liquidity != null) c.liquidity = q.liquidity;
  if (q.tokenId && !c.tokenId) c.tokenId = q.tokenId;
  if (q.status === 'open' && q.prob != null) {
    c.last = { p: q.prob, bid: q.bid ?? null, ask: q.ask ?? null, at: new Date(nowMs).toISOString() };
    noteSnapshot(c, nowMs, q.prob);
    c.status = 'open';
    return true;
  }
  if (q.status === 'settled' || q.status === 'closed') {
    if (q.result && !c.result) {
      c.result = q.result;
      const resolved = q.closeTime && Date.parse(q.closeTime) < nowMs ? q.closeTime : new Date(nowMs).toISOString();
      c.resolvedAt = resolved;
      c.lastPreResult = lastPreResult(c, etDate(Date.parse(resolved)));
    }
    c.status = q.result ? 'settled' : 'closed';
    if (!c.closedAt) c.closedAt = new Date(nowMs).toISOString();
    return true;
  }
  return false;
}

// Hourly history from the contract's start (or a year back) to now, in
// 90-day pieces, a few per bake; a piece the hourly read refuses is read as
// daily bars instead (coarse, for charts only).
async function backfillOne(client, c, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  // Unknown start (Polymarket leaves it out on some markets): read the full year.
  const open = Date.parse(c.openTime || '');
  const start = Math.max(Number.isFinite(open) ? Math.floor(open / 1000) : nowSec - BACKFILL_DAYS * 86400, nowSec - BACKFILL_DAYS * 86400);
  const b = (c.backfill ||= { done: false });
  let from = b.next || start;
  while (from < nowSec) {
    if (client.left() < 3) return false;
    const to = Math.min(nowSec, from + BACKFILL_CHUNK_DAYS * 86400);
    try {
      const pts = c.venue === 'kalshi'
        ? await kalshiHistory(client, { series: c.series, ticker: c.ticker, startTs: from, endTs: to, period: 60 })
        : await polyHistory(client, { tokenId: c.tokenId, startTs: from, endTs: to, fidelity: 60 });
      if (pts.length) mergeFine(c, pts, nowMs);
      else if (client.left() >= 2) {
        // Polymarket can answer an hourly read on an older stretch with no
        // points and no error; the daily read usually still has them.
        const coarse = c.venue === 'kalshi'
          ? await kalshiHistory(client, { series: c.series, ticker: c.ticker, startTs: from, endTs: to, period: 1440 })
          : await polyHistory(client, { tokenId: c.tokenId, startTs: from, endTs: to, fidelity: 1440 });
        if (coarse.length) mergeCoarse(c, coarse);
      }
    } catch (err) {
      // No answer at all (a timeout, a network error): try again on a later
      // bake, without counting it against this contract.
      if (err?.budget || err?.transient) return false;
      try {
        const pts = c.venue === 'kalshi'
          ? await kalshiHistory(client, { series: c.series, ticker: c.ticker, startTs: from, endTs: to, period: 1440 })
          : await polyHistory(client, { tokenId: c.tokenId, startTs: from, endTs: to, fidelity: 1440 });
        mergeCoarse(c, pts);
      } catch (err2) {
        if (err2?.budget || err2?.transient) return false;
        b.errors = (b.errors || 0) + 1;
        b.lastError = errText(err2);
        client.noteError(c.venue, err2);
        // Two failed pieces in a row: give up on the rest for this contract.
        if (b.errors >= 2) { b.done = true; b.partial = true; return true; }
      }
    }
    from = to;
    b.next = from;
  }
  b.done = true;
  delete b.next;
  return true;
}

// Fills missing 16:00 ET values in the last week from hourly history.
async function topUpOne(client, c, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  const from = nowSec - TOPUP_LOOKBACK_DAYS * 86400;
  const pts = c.venue === 'kalshi'
    ? await kalshiHistory(client, { series: c.series, ticker: c.ticker, startTs: from, endTs: nowSec, period: 60 })
    : await polyHistory(client, { tokenId: c.tokenId, startTs: from, endTs: nowSec, fidelity: 60 });
  mergeFine(c, pts, nowMs);
}

function missingRecentClose(c, nowMs) {
  const today = etDate(nowMs);
  const { hour } = etParts(nowMs);
  for (let i = hour >= 17 ? 0 : 1; i <= 5; i += 1) {
    const d = addDays(today, -i);
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (Date.parse(c.addedAt || '') > Date.parse(`${d}T21:00:00Z`)) continue;
    const v = dailyAt(c, d);
    if (!v || !v.q) return true;
  }
  return false;
}

// One bake's update: discover (once per ET day), refresh tracked prices,
// backfill new contracts, fill gaps, keep the release guesses, prune.
export async function updatePredictionState({ prior = null, nowMs = Date.now(), universe = [], chains = null, fetchJson, crowdKalshi = null, budget = BAKE_CALL_BUDGET, maxMs = null, timeoutMs, forceDiscover = false, log = () => {} } = {}) {
  const state = prior && prior.contracts ? JSON.parse(JSON.stringify(prior)) : emptyState();
  state.version = PREDICTION_VERSION;
  const client = createClient({ fetchJson, budget, maxMs, ...(timeoutMs ? { timeoutMs } : {}) });
  const nowIso = new Date(nowMs).toISOString();
  const todayEt = etDate(nowMs);
  const set = new Set(universe);
  const extraTerms = leaderTerms(chains);
  const venues = { kalshi: { ok: false, events: 0, refreshed: 0, error: null }, polymarket: { ok: false, events: 0, refreshed: 0, error: null } };
  const touched = new Set();

  // 1. Discovery, once per ET day (and on the first run).
  const discover = forceDiscover || state.discoveredDate !== todayEt || !Object.keys(state.contracts).length;
  if (discover) {
    const seriesMap = await kalshiSeriesMap(client);
    const kEvents = await kalshiOpenEvents(client, { nowMs });
    const pEvents = await polyOpenEvents(client);
    venues.kalshi.events = kEvents.length;
    venues.polymarket.events = pEvents.length;
    const groups = [];
    // With the series list read, an event whose series is not in a tracked
    // category (sports, weather, entertainment) is skipped before any words
    // are read; without it, the words and the event's own category decide.
    for (const ev of kEvents) {
      const info = seriesMap.get(ev?.series_ticker) || null;
      if (seriesMap.size && !info && !(ev?.category && !/sport|entertain|weather|climate|culture|social|mention/i.test(ev.category))) continue;
      groups.push(kalshiCandidates(ev, info));
    }
    for (const ev of pEvents) groups.push(polyCandidates(ev));
    // Tracked contracts seen in the listing take its price now.
    for (const g of groups) for (const cand of g) {
      const c = state.contracts[cand.id];
      if (c && applyQuote(c, cand.quote, nowMs)) touched.add(c.id);
    }
    const sel = selectContracts(state.contracts, groups, { universe: set, extraTerms, nowMs, nowIso });
    for (const g of groups) for (const cand of g) if (sel.added.includes(cand.id)) { applyQuote(state.contracts[cand.id], cand.quote, nowMs); touched.add(cand.id); }
    state.candidates = sel.candidates;
    if (kEvents.length && pEvents.length) state.discoveredDate = todayEt;
    // Rules improve over time: re-link every tracked contract.
    for (const c of Object.values(state.contracts)) c.links = linksFor(c, set, extraTerms);
    log(`  · prediction discovery: ${kEvents.length} Kalshi + ${pEvents.length} Polymarket events, ${sel.added.length} contract(s) added`);
  }

  // 2. Refresh tracked contracts the listing did not cover.
  const needs = Object.values(state.contracts).filter((c) => !touched.has(c.id) && (c.status === 'open' || (c.status === 'closed' && !c.result && nowMs - Date.parse(c.closedAt || nowIso) < 30 * DAY)));
  const kNeed = needs.filter((c) => c.venue === 'kalshi').map((c) => c.ticker);
  const pNeed = needs.filter((c) => c.venue === 'polymarket').map((c) => c.marketId);
  if (kNeed.length) {
    const got = await kalshiMarketsByTicker(client, kNeed);
    for (const [t, m] of got) { const c = state.contracts[`K:${t}`]; if (c && applyQuote(c, kalshiQuote(m), nowMs)) { touched.add(c.id); venues.kalshi.refreshed += 1; } }
  }
  if (pNeed.length) {
    const got = await polyMarketsById(client, pNeed);
    for (const [id, m] of got) { const c = state.contracts[`P:${id}`]; if (c && applyQuote(c, polyQuote(m), nowMs)) { touched.add(c.id); venues.polymarket.refreshed += 1; } }
  }
  for (const v of ['kalshi', 'polymarket']) {
    const tracked = Object.values(state.contracts).filter((c) => c.venue === v && c.status === 'open').length;
    const fresh = Object.values(state.contracts).filter((c) => c.venue === v && touched.has(c.id)).length;
    venues[v].tracked = tracked;
    venues[v].fresh = fresh;
    venues[v].ok = tracked === 0 ? (discover ? venues[v].events > 0 : !!state.venues?.[v]?.ok) : fresh >= Math.ceil(tracked * 0.5);
    const errs = client.errors.filter((e) => e.startsWith(v));
    venues[v].error = errs.length ? errs[0] : null;
    // The last run that delivered from this venue (Source health reads it).
    venues[v].asOf = venues[v].ok ? nowIso : state.venues?.[v]?.asOf || null;
  }

  // 3. History for new contracts (a few per bake until each is done).
  const fresh = Object.values(state.contracts).filter((c) => !c.backfill?.done && (c.venue === 'kalshi' ? c.series && c.ticker : c.tokenId)).sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
  let backfilled = 0;
  for (const c of fresh) {
    if (client.left() < 30) break;
    if (await backfillOne(client, c, nowMs)) backfilled += 1;
  }

  // 4. Gaps in the last week's closes (a missed 16:10 bake, a weekend).
  let toppedUp = 0;
  for (const c of Object.values(state.contracts)) {
    if (c.status !== 'open' || !c.backfill?.done || client.left() < 20) continue;
    if (!missingRecentClose(c, nowMs)) continue;
    if (c.topUpDate === todayEt) continue;
    try { await topUpOne(client, c, nowMs); toppedUp += 1; c.topUpDate = todayEt; } catch (err) {
      client.noteError(c.venue, err);
      // One venue not answering does not stop the other venue's contracts.
      if (err?.budget && !err?.venueDown) break;
      if (!err?.budget && !err?.transient) c.topUpDate = todayEt;
    }
  }

  // 5. Release guesses (test A).
  snapshotConsensus(state, { crowdKalshi, contracts: state.contracts, nowMs });
  await settleConsensus(state, client, { nowMs, contracts: state.contracts });
  if (client.left() > 8) await backfillConsensus(state, client, { maxCalls: Math.min(30, client.left() - 5) });
  pruneConsensus(state);

  // 6. Prune and pair.
  for (const [id, c] of Object.entries(state.contracts)) {
    const close = Date.parse(c.closeTime || '');
    if (c.status === 'open' && Number.isFinite(close) && close < nowMs - 30 * DAY) { c.status = 'closed'; c.closedAt = c.closedAt || nowIso; }
    const ended = Date.parse(c.resolvedAt || c.closedAt || '');
    if (c.status !== 'open' && Number.isFinite(ended) && ended < nowMs - RESOLVED_KEEP_DAYS * DAY) delete state.contracts[id];
    else trimHourly(c, Math.floor(nowMs / 1000));
  }
  pairAcrossVenues(state.contracts);
  state.venues = venues;
  state.updatedAt = nowIso;
  // `stopped` says why the reads ended early (the time limit, a venue not
  // answering), or is null. Contracts not reached keep their last price.
  const status = { venues, calls: client.calls, budget, backfilled, toppedUp, errors: client.errors.slice(0, 10), discovered: discover, stopped: client.stopped };
  state.lastRun = { at: nowIso, calls: client.calls, backfilled, toppedUp, discovered: discover, ...(client.stopped ? { stopped: client.stopped } : {}) };
  return { state, status };
}

// ---- public payload -------------------------------------------------------

export function displayTitle(c) {
  if (c.venue === 'kalshi' && c.outcome) return `${c.eventTitle || c.title}: ${c.outcome}`;
  return c.title || c.eventTitle || c.id;
}
const isThin = (c) => (c.venue === 'kalshi' ? !(Number(c.volume24h) >= 200) && !(Number(c.volume) >= 20000) : !(Number(c.volume24h) >= 2000) && !(Number(c.volume) >= 250000));

export function publicContract(c, todayEt, nowMs) {
  const p = c.status === 'open' ? c.last?.p ?? null : c.result === 'yes' ? 1 : c.result === 'no' ? 0 : c.last?.p ?? null;
  const close = Date.parse(c.closeTime || '');
  return {
    id: c.id, venue: c.venue, theme: c.theme, title: displayTitle(c), question: c.title || null, outcome: c.outcome || null,
    p: pct(p), ch1: c.status === 'open' ? change24h(c, c.last?.p, nowMs) ?? changeOver(c, c.last?.p, todayEt, 1) : null,
    ch7: c.status === 'open' ? changeOver(c, c.last?.p, todayEt, 7) : null, ch30: c.status === 'open' ? changeOver(c, c.last?.p, todayEt, 30) : null,
    spark: sparkDaily(c, todayEt, 30),
    closeTime: c.closeTime || null, daysLeft: Number.isFinite(close) ? Math.max(0, Math.round((close - nowMs) / DAY)) : null,
    volume: Number.isFinite(c.volume) ? Math.round(c.volume) : null, volume24h: Number.isFinite(c.volume24h) ? Math.round(c.volume24h) : null,
    status: c.status, result: c.result || null, resolvedAt: c.resolvedAt || null,
    thin: isThin(c), url: c.url, pair: c.pair || null,
    links: (c.links || []).map((l) => ({ s: l.sym, g: l.sign, r: l.rule })),
    asOf: c.last?.at || null,
  };
}

// 10-point moves between two consecutive daily closes in the last 14 days.
function recentJumps(contracts, todayEt) {
  const out = [];
  for (const c of contracts) {
    const rows = dailySeries(c).filter((r) => daysBetween(r[0], todayEt) <= 14);
    for (let i = 1; i < rows.length; i += 1) {
      if (daysBetween(rows[i - 1][0], rows[i][0]) > 3) continue;
      const ch = (rows[i][1] - rows[i - 1][1]) * 100;
      if (Math.abs(ch) >= 10) out.push({ id: c.id, date: rows[i][0], from: pct(rows[i - 1][1]), to: pct(rows[i][1]), change: r1(ch), title: displayTitle(c), theme: c.theme, links: (c.links || []).map((l) => l.sym), url: c.url });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.change) - Math.abs(a.change)).slice(0, 30);
}

export function buildPredictionPublic(state, status, { nowMs = Date.now(), crowdKalshi = null, consensusRowsWithMoves = null } = {}) {
  const todayEt = etDate(nowMs);
  const all = Object.values(state?.contracts || {});
  const open = all.filter((c) => c.status === 'open' && c.last?.p != null);
  const byTheme = THEMES.map((t) => {
    const list = open.filter((c) => c.theme === t.id).sort((a, b) => (Number(b.volume24h) || 0) - (Number(a.volume24h) || 0) || (Number(b.volume) || 0) - (Number(a.volume) || 0));
    return { id: t.id, label: t.label, blurb: t.blurb, contracts: list.map((c) => publicContract(c, todayEt, nowMs)) };
  });
  const resolved = all.filter((c) => c.status === 'settled' && c.result && daysBetween(String(c.resolvedAt).slice(0, 10), todayEt) <= 30)
    .sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt))).slice(0, 30)
    .map((c) => ({ ...publicContract(c, todayEt, nowMs), before: pct(c.lastPreResult) }));
  const bySymbol = {};
  for (const c of open) for (const l of c.links || []) (bySymbol[l.sym] ||= []).push({ id: c.id, sign: l.sign, rule: l.rule, vol: Number(c.volume24h) || 0 });
  for (const sym of Object.keys(bySymbol)) bySymbol[sym] = bySymbol[sym].sort((a, b) => (b.sign !== 0) - (a.sign !== 0) || b.vol - a.vol).slice(0, 8).map(({ id, sign, rule }) => ({ id, sign, rule }));
  const rows = consensusRowsWithMoves || consensusRows(state);
  const venues = status?.venues || state?.venues || {};
  const fresh = Object.values(venues).some((v) => v?.ok);
  return {
    version: PREDICTION_VERSION,
    builtAt: new Date(nowMs).toISOString(),
    etDate: todayEt,
    ok: fresh,
    stale: !fresh,
    venues: Object.fromEntries(Object.entries(venues).map(([k, v]) => [k, { ok: !!v.ok, stale: !v.ok, asOf: v.asOf || null, tracked: v.tracked ?? null, fresh: v.fresh ?? null, error: v.ok ? null : v.error || null }])),
    counts: { tracked: open.length, themes: Object.fromEntries(byTheme.map((t) => [t.id, t.contracts.length])), resolved30: resolved.length },
    themes: byTheme,
    jumps: recentJumps(all, todayEt),
    resolved,
    consensus: consensusPublic(state, { crowdKalshi, rows, nowMs }),
    bySymbol,
    // Market-wide reads (the same numbers the shadow log keeps): chance of a
    // cut at the next Fed decision, average 1-day policy/politics/geopolitics
    // move, contracts that jumped 10+ points.
    gauges: (() => { const g = predictionShadow(state, { universe: [], nowMs }).mkt; return { cutNext: g.pmCut ?? null, policyChurn: g.pmPol ?? null, jumps: g.pmJmp ?? null }; })(),
    rules: RULE_LABELS,
    sources: [
      { id: 'kalshi', label: 'Kalshi', url: 'https://kalshi.com', note: 'CFTC-regulated US exchange. Public market data, no account.' },
      { id: 'polymarket', label: 'Polymarket', url: 'https://polymarket.com', note: 'Public market data from the Gamma and CLOB read APIs.' },
    ],
    note: 'A price of 62 cents on YES reads as a 62% chance the market puts on that outcome. These are traded prices, not the site\'s forecast. Thin markets (little trading) can move on a single order, so they are marked. Stock links show which covered names a result could move: a + or − link has a direction set in advance, a ? link has one the data must show.',
  };
}

// ---- owner payload --------------------------------------------------------

// prices: { SYM: [[date, close], ...] } from the bake's daily bars.
export function pricesFromChains(chains, syms) {
  const out = {};
  for (const s of syms || Object.keys(chains || {})) {
    const d = chains?.[s];
    let rows = [];
    if (Array.isArray(d?._bars) && d._bars.length) rows = d._bars.map((b) => [String(b?.t || '').slice(0, 10), Number(b?.c)]);
    else if (Array.isArray(d?.priceSeries?.t) && Array.isArray(d?.priceSeries?.c)) rows = d.priceSeries.t.map((t, i) => [String(t || '').slice(0, 10), Number(d.priceSeries.c[i])]);
    rows = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && r[1] > 0);
    if (rows.length > 20) out[s] = rows;
  }
  return out;
}

export const VERDICT_ORDER = { holds: 0, 'odds-lead': 0, 'run-up-follows': 0, 'odds-echo': 1, 'moves-together': 1, 'same-day': 1, echo: 1, 'no-effect': 2, 'no-order': 2, collecting: 3 };

export function analyzePrediction(state, { prices = {}, nowMs = Date.now() } = {}) {
  const todayEt = etDate(nowMs);
  const contracts = Object.values(state?.contracts || {});
  const an = analyzeReactions({ contracts, prices, todayEt });
  const famByKey = new Map(an.families.map((f) => [f.key, f]));
  const rows = consensusRows(state);
  const consensusTests = consensusTest(rows, prices);
  return { ...an, famByKey, consensusRowsWithMoves: rows, consensusTests, todayEt };
}

// The sign to use for one link: declared, else learned on the fit half.
export function linkSign(link, famByKey) {
  if (link.sign) return { sign: link.sign, learned: false };
  const f = famByKey?.get(familyKey(link));
  return f?.sign ? { sign: f.sign, learned: true } : { sign: 0, learned: false };
}

// The sign the Owner pages act on: a declared one, or a learned one only once
// a test on the held-out third passed (FDR). A learned sign that has not
// passed is kept as `pending` and reads as unknown.
const passes = (v) => (VERDICT_ORDER[v] ?? 3) <= 1;
export function provenSign(link, famByKey) {
  const ls = linkSign(link, famByKey);
  if (!ls.learned) return { ...ls, pending: null };
  const f = famByKey?.get(familyKey(link));
  const ok = f && (passes(f.jumps?.verdict) || passes(f.flow?.verdict) || passes(f.runup?.verdict));
  return ok ? { ...ls, pending: null } : { sign: 0, learned: true, pending: ls.sign };
}

// Per-name shadow values and market gauges for lib/shadow-signals.mjs.
//   pmo  sum over the name's linked open contracts of sign x 7-day change
//        (points); declared signs, or signs learned on the fit half
//   pmn  number of linked open contracts (0 when the tracker ran and found none)
//   mkt  pmCut (chance of a cut at the next Fed meeting, %), pmPol (mean
//        absolute 1-day move across policy, politics and geopolitics
//        contracts, points), pmJmp (10-point daily moves among tracked
//        contracts on the latest day)
export function predictionShadow(state, { universe = [], famByKey = null, nowMs = Date.now() } = {}) {
  const todayEt = etDate(nowMs);
  const open = Object.values(state?.contracts || {}).filter((c) => c.status === 'open' && c.last?.p != null);
  const rows = {};
  for (const s of universe) rows[s] = { pmn: 0 };
  for (const c of open) {
    const ch7 = changeOver(c, c.last.p, todayEt, 7);
    for (const link of c.links || []) {
      if (!rows[link.sym]) continue;
      rows[link.sym].pmn += 1;
      const { sign } = linkSign(link, famByKey);
      if (sign && ch7 != null) rows[link.sym].pmo = r1((rows[link.sym].pmo || 0) + sign * ch7);
    }
  }
  const fed = open.filter((c) => c.theme === 'fed' && c.venue === 'kalshi' && /KXFEDDECISION/.test(c.series || ''));
  let pmCut = null;
  if (fed.length) {
    const next = fed.map((c) => c.eventTicker).filter(Boolean).sort((a, b) => {
      const ca = fed.find((c) => c.eventTicker === a)?.closeTime || '9', cb = fed.find((c) => c.eventTicker === b)?.closeTime || '9';
      return String(ca).localeCompare(String(cb));
    })[0];
    let cut = 0;
    for (const c of fed.filter((x) => x.eventTicker === next)) {
      const label = `${c.outcome || ''} ${c.title || ''}`.toLowerCase();
      if (/no change|hold|unchanged|hike|increase|raise/.test(label)) continue;
      if (/cut|decrease|lower/.test(label)) cut += c.last.p;
    }
    pmCut = pct(Math.min(1, cut));
  }
  const pol = open.filter((c) => ['policy', 'politics', 'geopolitics'].includes(c.theme)).map((c) => change24h(c, c.last.p, nowMs) ?? changeOver(c, c.last.p, todayEt, 1)).filter(Number.isFinite);
  const pmPol = pol.length >= 5 ? r1(pol.reduce((a, b) => a + Math.abs(b), 0) / pol.length) : null;
  let pmJmp = 0;
  for (const c of open) {
    const a = dailyAt(c, todayEt) || null;
    const v = a ? a.p : c.last.p;
    for (let back = 1; back <= 3; back += 1) {
      const prev = dailyAt(c, addDays(todayEt, -back));
      if (prev) { if (Math.abs((v - prev.p) * 100) >= 10) pmJmp += 1; break; }
    }
  }
  const mkt = {};
  if (pmCut != null) mkt.pmCut = pmCut;
  if (pmPol != null) mkt.pmPol = pmPol;
  if (open.length) mkt.pmJmp = pmJmp;
  return { rows, mkt };
}

// Display-only context for one scored name (r.odds): the linked contracts
// with the biggest weekly moves. Never scored.
export function predictionContextFor(pub, sym, max = 4) {
  const ids = pub?.bySymbol?.[sym];
  if (!Array.isArray(ids) || !ids.length) return null;
  const byId = new Map();
  for (const t of pub.themes || []) for (const c of t.contracts || []) byId.set(c.id, c);
  const list = ids.map((x) => ({ x, c: byId.get(x.id) })).filter((y) => y.c)
    .sort((a, b) => Math.abs(b.c.ch7 || 0) - Math.abs(a.c.ch7 || 0)).slice(0, max)
    .map(({ x, c }) => ({ id: c.id, title: c.title, p: c.p, ch7: c.ch7, sign: x.sign, rule: x.rule, daysLeft: c.daysLeft, venue: c.venue }));
  return list.length ? { asOf: pub.builtAt || null, contracts: list } : null;
}

// Lines for the AI grader prompt (PICKS_ODDS_GRADER=1 only).
export function predictionGraderLines(ctx) {
  if (!ctx?.contracts?.length) return [];
  const out = ['Prediction markets linked to this name (traded odds, not a forecast; + / − = the direction the link was set to move the stock, ? = not known):'];
  for (const c of ctx.contracts) {
    const dir = c.sign > 0 ? '+' : c.sign < 0 ? '−' : '?';
    out.push(`- [${dir}] ${c.title}: ${c.p}%${c.ch7 != null ? `, ${c.ch7 >= 0 ? '+' : ''}${c.ch7} pts in 7 days` : ''}${c.daysLeft != null ? `, resolves in ${c.daysLeft} days` : ''} (${c.venue})`);
  }
  return out;
}

// Owner payload: tests, jump log, run-up watch, open-trade alerts, shadow.
export function buildPredictionOwner(state, analysis, { nowMs = Date.now(), openTrades = [], pub = null, universe = [] } = {}) {
  const todayEt = etDate(nowMs);
  const byId = state?.contracts || {};
  const an = analysis || analyzePrediction(state, { nowMs });
  const fams = an.families.filter((f) => f.jumps.n || f.flow.n || f.runup.n).map((f) => ({
    key: f.key, rule: f.rule, sym: f.sym, sign: f.sign, declaredSign: f.declaredSign, learned: f.learned, contracts: f.contracts,
    jumps: f.jumps, flow: f.flow, runup: f.runup,
  }));
  fams.sort((a, b) => (VERDICT_ORDER[a.jumps.verdict] ?? 3) - (VERDICT_ORDER[b.jumps.verdict] ?? 3) || b.jumps.n - a.jumps.n || b.flow.n - a.flow.n);
  const jumps = jumpFollowThrough(an.jumpLog, byId, an.rets, an.days, an.famByKey).map((j) => ({ ...j, title: displayTitle(byId[j.id]), theme: byId[j.id]?.theme || null, url: byId[j.id]?.url || null }));
  // Run-up watch: open contracts closing within 90 days that are moving or
  // lean one way, with each linked stock's own 10-day move.
  const runUp = [];
  for (const c of Object.values(byId)) {
    if (c.status !== 'open' || c.last?.p == null || !(c.links || []).length) continue;
    const close = Date.parse(c.closeTime || '');
    const daysLeft = Number.isFinite(close) ? Math.round((close - nowMs) / DAY) : null;
    if (daysLeft != null && (daysLeft < 0 || daysLeft > 90)) continue;
    const ch7 = changeOver(c, c.last.p, todayEt, 7);
    const leaning = c.last.p >= 0.65 || c.last.p <= 0.35;
    if (!(Math.abs(ch7 || 0) >= 8 || (leaning && daysLeft != null && daysLeft <= 30))) continue;
    for (const link of c.links) {
      const { sign, learned, pending } = provenSign(link, an.famByKey);
      const move10 = trailingMove(an.rets, an.days, link.sym, 10);
      const fam = an.famByKey.get(familyKey(link));
      // Lined up: the stock has moved the way the odds point. With an unknown
      // sign nothing can be said yet.
      const expected = sign ? sign * Math.sign((ch7 || 0) !== 0 ? ch7 : c.last.p - 0.5) : 0;
      runUp.push({
        id: c.id, title: displayTitle(c), theme: c.theme, sym: link.sym, rule: link.rule, sign, learned, pending,
        p: pct(c.last.p), ch7, daysLeft, move10,
        lined: expected && move10 != null ? (Math.sign(move10) === expected ? 'with' : 'against') : null,
        runupVerdict: fam?.runup?.verdict || 'collecting', jumpVerdict: fam?.jumps?.verdict || 'collecting', url: c.url,
      });
    }
  }
  runUp.sort((a, b) => Math.abs(b.ch7 || 0) - Math.abs(a.ch7 || 0) || (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
  // Open Top Picks trades with a linked contract that moved 5+ points in a
  // day or 10+ in a week.
  const alerts = [];
  for (const t of openTrades || []) {
    const sym = t.symbol;
    for (const c of Object.values(byId)) {
      if (c.status !== 'open' || c.last?.p == null) continue;
      const link = (c.links || []).find((l) => l.sym === sym);
      if (!link) continue;
      const ch1 = change24h(c, c.last.p, nowMs) ?? changeOver(c, c.last.p, todayEt, 1);
      const ch7 = changeOver(c, c.last.p, todayEt, 7);
      if (!(Math.abs(ch1 || 0) >= 5 || Math.abs(ch7 || 0) >= 10)) continue;
      const { sign, learned, pending } = provenSign(link, an.famByKey);
      const move = Math.abs(ch1 || 0) >= 5 ? ch1 : ch7;
      const side = t.side === 'put' ? -1 : 1;
      alerts.push({
        tradeId: t.id || null, symbol: sym, side: t.side, id: c.id, title: displayTitle(c), p: pct(c.last.p), ch1, ch7, sign, learned, pending,
        reads: sign ? (sign * Math.sign(move) === side ? 'helps' : 'hurts') : 'unknown', url: c.url,
      });
    }
  }
  const shadow = predictionShadow(state, { universe, famByKey: an.famByKey, nowMs });
  const verdictCounts = {};
  for (const f of fams) for (const k of ['jumps', 'flow', 'runup']) { const v = f[k].verdict; verdictCounts[`${k}:${v}`] = (verdictCounts[`${k}:${v}`] || 0) + 1; }
  return {
    version: PREDICTION_VERSION,
    builtAt: new Date(nowMs).toISOString(),
    etDate: todayEt,
    families: fams.slice(0, 200),
    verdictCounts,
    jumps,
    runUp: runUp.slice(0, 60),
    alerts: alerts.slice(0, 40),
    consensus: { rows: an.consensusRowsWithMoves.slice(0, 80), tests: an.consensusTests },
    shadow: { mkt: shadow.mkt, rows: Object.fromEntries(Object.entries(shadow.rows).filter(([, v]) => v.pmn > 0)) },
    candidates: state?.candidates || [],
    run: state?.lastRun || null,
    tracked: pub?.counts?.tracked ?? null,
    rules: {
      jumpPoints: 10, minEvents: 30, minTest: 10, fdrQ: 0.1,
      note: 'Each family is one link rule and one stock. Contracts in a family that move on the same day count as one observation, so a Fed ladder never counts one news day several times. The first two thirds of the family\'s dates are the fit half and the last third the test half; a link without a declared sign learns its sign on the fit half only, and every verdict reads the test half. p-values are one-sided sign-flip tests (seeded; the jump test checks two horizons, so its smaller p is doubled), corrected across families with Benjamini-Hochberg at q 0.10. Only prices matched to the 16:00 ET close are used.',
    },
  };
}

export { THEME_LABEL };
