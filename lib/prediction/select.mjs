// Prediction market odds tracker: turning the venues' open events into the
// list of tracked contracts.
//
// A contract is one YES/NO market. From each event at most a few are kept:
//   - a multi-outcome event (who wins, which decision) keeps its outcomes
//     priced at 3% or more, up to six;
//   - a ladder of levels (Bitcoin above 100k / 110k / 120k) keeps the one
//     level nearest 50% when first seen, and keeps that same level after;
//   - a single question keeps that market.
// A tracked contract stays until it settles or closes, so a busy news day
// never pushes out a contract that already has history.

import { THEME_CAPS, ADD_PROB_MIN, ADD_PROB_MAX, ADD_MIN_DAYS_TO_CLOSE, ADD_MAX_DAYS_TO_CLOSE, ADD_MIN_VOLUME, MAX_OUTCOMES_PER_EVENT, themeFor, linksFor, titleSimilarity } from './catalog.mjs';
import { kalshiQuote, polyQuote, venueUrl } from './venues.mjs';

const DAY = 86400000;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ---- normalizing ----------------------------------------------------------

// Kalshi event (with nested markets) → candidate contracts, all markets.
export function kalshiCandidates(ev, seriesInfo = null) {
  const info = seriesInfo || {};
  const markets = Array.isArray(ev?.markets) ? ev.markets : [];
  const multi = markets.length > 1;
  const ladder = multi && !ev?.mutually_exclusive && markets.some((m) => m?.floor_strike != null || m?.cap_strike != null || /greater|less|between/.test(String(m?.strike_type || '')));
  const kind = !multi ? 'single' : ev?.mutually_exclusive ? 'outcomes' : ladder ? 'ladder' : 'outcomes';
  const eventTitle = clean([ev?.title, ev?.sub_title].filter(Boolean).join(' · '));
  return markets.filter((m) => m?.ticker).map((m) => {
    const q = kalshiQuote(m);
    const outcome = multi ? clean(m.yes_sub_title || m.subtitle || '') || null : null;
    return {
      id: `K:${m.ticker}`, venue: 'kalshi', ticker: m.ticker, series: ev.series_ticker || null, eventTicker: ev.event_ticker || null,
      eventTitle, title: clean(m.title || ev.title), outcome, kind,
      category: info.category || ev.category || null, tags: info.tags || [], frequency: info.frequency || null,
      strike: Number.isFinite(Number(m.floor_strike)) ? Number(m.floor_strike) : Number.isFinite(Number(m.cap_strike)) ? Number(m.cap_strike) : null,
      quote: q,
    };
  });
}

// Polymarket event → candidate contracts.
export function polyCandidates(ev) {
  const markets = (Array.isArray(ev?.markets) ? ev.markets : []).filter((m) => m && (m.active !== false) && m.closed !== true);
  const multi = markets.length > 1;
  const negRisk = !!(ev?.negRisk || ev?.enableNegRisk || markets.some((m) => m?.negRisk));
  const numericGroups = markets.filter((m) => /\d/.test(String(m?.groupItemTitle || ''))).length;
  const kind = !multi ? 'single' : negRisk ? 'outcomes' : numericGroups >= Math.max(2, markets.length / 2) ? 'ladder' : 'outcomes';
  const tags = (Array.isArray(ev?.tags) ? ev.tags : []).map((t) => t?.slug || t?.label).filter(Boolean);
  const eventTitle = clean(ev?.title);
  return markets.map((m) => {
    const q = polyQuote(m);
    return {
      id: `P:${m.id}`, venue: 'polymarket', marketId: String(m.id), tokenId: q.tokenId, eventSlug: ev?.slug || null, eventId: ev?.id != null ? String(ev.id) : null,
      eventTitle, title: clean(m.question || ev?.title), outcome: multi ? clean(m.groupItemTitle || '') || null : null, kind,
      category: ev?.category || null, tags,
      strike: (() => { const x = String(m.groupItemTitle || '').replace(/[,$]/g, '').match(/-?\d+(\.\d+)?/); return x ? Number(x[0]) * (/k\b/i.test(m.groupItemTitle) ? 1000 : 1) : null; })(),
      quote: q,
      eventVolume: Number(ev?.volume) || null,
    };
  });
}

// ---- choosing -------------------------------------------------------------

const vol = (c) => Number(c.quote?.volume) || 0;
const vol24 = (c) => Number(c.quote?.volume24h) || 0;
export const candidateScore = (c) => 2 * Math.log10(1 + vol24(c)) + Math.log10(1 + vol(c)) + (c.venue === 'kalshi' ? 0.3 : 0);

function liveEnough(c, nowMs) {
  const p = c.quote?.prob;
  if (p == null || p < ADD_PROB_MIN || p > ADD_PROB_MAX) return false;
  if (c.quote?.status && c.quote.status !== 'open') return false;
  const close = Date.parse(c.quote?.closeTime || '');
  if (!Number.isFinite(close)) return c.venue === 'polymarket'; // some Polymarket questions have no end date set yet
  const days = (close - nowMs) / DAY;
  return days >= ADD_MIN_DAYS_TO_CLOSE && days <= ADD_MAX_DAYS_TO_CLOSE;
}

function busyEnough(c) {
  const floor = ADD_MIN_VOLUME[c.venue] || 0;
  if (vol(c) >= floor) return true;
  // An outcome inside a big Polymarket event can trade less on its own.
  return c.venue === 'polymarket' && (c.eventVolume || 0) >= floor * 5 && vol(c) >= floor / 5;
}

// From one event's candidates, the ones worth tracking (see top).
export function pickFromEvent(cands, trackedIds = new Set()) {
  if (!cands.length) return [];
  const tracked = cands.filter((c) => trackedIds.has(c.id));
  const kind = cands[0].kind;
  if (kind === 'ladder') {
    if (tracked.length) return [];
    const priced = cands.filter((c) => c.quote?.prob != null);
    priced.sort((a, b) => Math.abs(a.quote.prob - 0.5) - Math.abs(b.quote.prob - 0.5) || vol(b) - vol(a));
    return priced.slice(0, 1);
  }
  if (kind === 'outcomes') {
    const room = MAX_OUTCOMES_PER_EVENT - tracked.length;
    if (room <= 0) return [];
    return cands.filter((c) => !trackedIds.has(c.id) && c.quote?.prob != null && c.quote.prob >= ADD_PROB_MIN)
      .sort((a, b) => b.quote.prob - a.quote.prob).slice(0, room);
  }
  return cands.filter((c) => !trackedIds.has(c.id)).slice(0, 1);
}

// The new contract record kept in the state file.
export function contractRecord(c, { theme, links, nowIso }) {
  const rec = {
    id: c.id, venue: c.venue, theme, links,
    eventTitle: c.eventTitle || null, title: c.title || null, outcome: c.outcome || null, kind: c.kind,
    addedAt: nowIso, openTime: c.quote?.openTime || null, closeTime: c.quote?.closeTime || null,
    status: c.quote?.status || 'open', result: null,
  };
  if (c.venue === 'kalshi') Object.assign(rec, { ticker: c.ticker, series: c.series, eventTicker: c.eventTicker });
  else Object.assign(rec, { marketId: c.marketId, tokenId: c.tokenId, eventSlug: c.eventSlug, eventId: c.eventId });
  rec.url = venueUrl[c.venue](rec);
  rec.backfill = { done: false };
  return rec;
}

// Adds new contracts to `contracts` (mutated) under the theme caps and
// returns { added, candidates } where candidates are the best relevant
// contracts that did not fit (for the Owner "Finder" tab).
export function selectContracts(contracts, events, { universe, extraTerms = null, nowMs = Date.now(), nowIso = new Date(nowMs).toISOString() } = {}) {
  const tracked = new Set(Object.keys(contracts));
  const openByTheme = {};
  for (const c of Object.values(contracts)) if (c.status === 'open') openByTheme[c.theme] = (openByTheme[c.theme] || 0) + 1;
  const pool = [];
  for (const cands of events) {
    const picks = pickFromEvent(cands, tracked);
    for (const c of picks) {
      const theme = themeFor(c, universe, extraTerms);
      if (!theme) continue;
      c.theme = theme;
      c.links = linksFor(c, universe, extraTerms);
      if (theme === 'company' && !c.links.length) continue;
      pool.push(c);
    }
  }
  pool.sort((a, b) => candidateScore(b) - candidateScore(a));
  const added = [];
  const left = [];
  const perEvent = {};
  for (const c of pool) {
    const ok = liveEnough(c, nowMs) && busyEnough(c);
    const cap = THEME_CAPS[c.theme] || 0;
    const evKey = c.eventTicker || c.eventId || c.id;
    if (ok && (openByTheme[c.theme] || 0) < cap) {
      contracts[c.id] = contractRecord(c, { theme: c.theme, links: c.links, nowIso });
      openByTheme[c.theme] = (openByTheme[c.theme] || 0) + 1;
      perEvent[evKey] = (perEvent[evKey] || 0) + 1;
      added.push(c.id);
      c._added = true;
    } else if (c.quote?.prob != null && vol(c) > 0) {
      left.push({ id: c.id, venue: c.venue, theme: c.theme, title: c.outcome ? `${c.eventTitle} — ${c.outcome}` : c.title, p: Math.round(c.quote.prob * 1000) / 10, volume: vol(c), volume24h: vol24(c), why: !ok ? (busyEnough(c) ? 'closes too soon, too late or priced near 0 or 100' : 'too little trading') : 'theme list full', links: c.links.map((l) => l.sym) });
    }
  }
  return { added, candidates: left.slice(0, 25) };
}

// Links the same question on the two venues, for side-by-side display.
export function pairAcrossVenues(contracts) {
  const open = Object.values(contracts).filter((c) => c.status === 'open');
  const k = open.filter((c) => c.venue === 'kalshi');
  const p = open.filter((c) => c.venue === 'polymarket');
  for (const c of open) delete c.pair;
  for (const a of k) {
    let best = null, bestS = 0;
    const ta = Date.parse(a.closeTime || '');
    for (const b of p) {
      if (b.theme !== a.theme || b.pair) continue;
      const tb = Date.parse(b.closeTime || '');
      if (Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) > 10 * DAY) continue;
      const s = titleSimilarity([a.eventTitle, a.outcome].join(' '), [b.title, b.outcome].join(' '));
      if (s > bestS) { bestS = s; best = b; }
    }
    if (best && bestS >= 0.5) { a.pair = best.id; best.pair = a.id; }
  }
}
