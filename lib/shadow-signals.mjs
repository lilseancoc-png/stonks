// Shadow signals: candidate Top Picks inputs that are logged, not scored.
//
// Each value is computed for every covered name once per ET day and stored
// next to the grade total in grades-daily.json. lib/shadow-research.mjs
// measures each one in the bake against forward 5/10-day returns on the whole
// universe, alone and after controlling for the grade, and against the decided
// Top Picks trades that froze it in their entry snapshot; the Owner Lab
// Evidence tab shows the table (scripts/diagnose-grade-ic.mjs is the CLI
// read). A signal earns a place in the grade only after it passes that test.
// Nothing here changes a grade, a pick, a contract or the track record, and
// nothing calls a provider or a model: every input is already in memory at
// bake time.
//
// Keys (short on purpose; the file keeps ~130 days of rows):
//   r21  own 21-trading-day return, %              (momentum vs reversal baseline)
//   im21 same-industry peers' mean 21-day return, % (leave-one-out, >= 2 peers)
//   vrp  ATM ~30d IV minus 20-day realized vol, vol points
//   cw   largest front-expiry call-OI strike vs spot, % (+ above spot)
//   pw   largest front-expiry put-OI strike vs spot, % (+ below spot)
//   pg   latest print's guidance within 45 days: +1 raised, 0 in line, -1 lowered
//   pe14 validated peer earnings ("driver" prints) in the next 14 calendar days
//   er30 fiscal-year EPS estimate, % change over 30 days (Yahoo earningsTrend)
//   rn30 analysts raising minus lowering the fiscal-year EPS estimate, last 30 days
//   ar30 rating upgrades minus downgrades in the trailing revision window
//   -- crowd & positioning (lib/crowd/, version 3, 2026-11-09) --
//   sv   FINRA daily short-sale volume share of the name's volume, % (latest session)
//   svz  that share's z-score against the name's prior 20 sessions
//   bf   IBKR stock-loan borrow fee, % a year
//   att  retail attention score 0-100 (mean percentile of Reddit mentions,
//        Wikipedia views vs 30-day average and Stocktwits watcher growth)
//   rdv  Reddit mentions today vs the name's 7-day average (ratio)
//   wkr  Wikipedia page views vs the 30-day average (ratio)
//   stw  Stocktwits watchers, 7-day change, %
//   pf   Hyperliquid stock-perp funding, annualized % (+ = longs pay)
//   pgp  perp mark vs the last close at the 09:00 ET pre-open read, %
// er30 / rn30 / ar30 were added 2026-11-08 (version 2); the crowd keys on
// 2026-11-09 (version 3); older rows simply lack them, and every reader uses
// each day's own key list.
//
// The block also carries `mkt`, one row of market-wide crowd gauges for the
// day (the same number for every name, so it is kept once, not per row):
//   pc / pcz / pcp  Cboe equity-only put/call ratio, its 250-session z and percentile
//   pct             Cboe total put/call ratio
//   cotEsZ / cotEsAmZ / cotNqZ / cotVxZ  CFTC COT net positions (leveraged funds in
//                   S&P 500, asset managers in S&P 500, leveraged funds in
//                   Nasdaq-100 and VIX futures), z against three years
//   mdYoy / mdMom   FINRA margin debt, % change y/y and m/m
//   levBull5 / levBear5  leveraged bull / bear ETF share flows, 5 days, $
//   kxWid           Kalshi S&P 500 range market: 80% band width, % of its mean,
//                   per square root of the days left to settle (the implied
//                   mean itself was a price level, not a gauge, until 2026-11-09)
//   kxRec           Kalshi odds of a US recession (NBER), furthest open year, %
//   svm             market-wide FINRA short-volume share, %
// lib/shadow-research.mjs tests each gauge against SPY's forward return.
//
// Insider (Form 4) buying is deliberately absent: 13f.json keeps only the
// latest 120 transactions across the universe, so a name missing from that
// list is not a measured zero.

import { crowdScoresForRow, marketGauges } from "./crowd/index.mjs";

export const SHADOW_SIGNAL_VERSION = 3;
export const SHADOW_KEYS = ['r21', 'im21', 'vrp', 'cw', 'pw', 'pg', 'pe14', 'er30', 'rn30', 'ar30', 'sv', 'svz', 'bf', 'att', 'rdv', 'wkr', 'stw', 'pf', 'pgp'];
export const SHADOW_CROWD_KEYS = ['sv', 'svz', 'bf', 'att', 'rdv', 'wkr', 'stw', 'pf', 'pgp'];
// Plain labels shared by the Evidence tab and the CLI read.
export const SHADOW_LABELS = Object.freeze({
  r21: 'Own 21-day return', im21: "Industry peers' 21-day return", vrp: 'Volatility risk premium (IV minus realized)',
  cw: 'Call wall distance above spot', pw: 'Put wall distance below spot', pg: "Last print's guidance",
  pe14: 'Peer earnings in the next 14 days', er30: 'FY EPS estimate change, 30 days', rn30: 'EPS estimate raises minus cuts, 30 days',
  ar30: 'Rating upgrades minus downgrades',
  sv: 'FINRA short-volume share', svz: 'Short-volume share z (20 sessions)', bf: 'IBKR borrow fee', att: 'Retail attention score',
  rdv: 'Reddit mentions vs 7-day average', wkr: 'Wikipedia views vs 30-day average', stw: 'Stocktwits watchers, 7-day change',
  pf: 'Perp funding, annualized', pgp: 'Perp pre-open gap vs last close',
});
export const SHADOW_MARKET_KEYS = ['pc', 'pcz', 'pcp', 'pct', 'cotEsZ', 'cotEsAmZ', 'cotNqZ', 'cotVxZ', 'mdYoy', 'mdMom', 'levBull5', 'levBear5', 'kxWid', 'kxRec', 'svm'];
export const SHADOW_MARKET_LABELS = Object.freeze({
  pc: 'Cboe equity put/call', pcz: 'Cboe equity put/call, z (250 sessions)', pcp: 'Cboe equity put/call, percentile (250 sessions)', pct: 'Cboe total put/call',
  cotEsZ: 'CFTC S&P 500 leveraged funds net, z (3y)', cotEsAmZ: 'CFTC S&P 500 asset managers net, z (3y)', cotNqZ: 'CFTC Nasdaq-100 leveraged funds net, z (3y)', cotVxZ: 'CFTC VIX leveraged funds net, z (3y)',
  mdYoy: 'Margin debt, y/y %', mdMom: 'Margin debt, m/m %', levBull5: 'Leveraged bull ETF flows, 5 days ($)', levBear5: 'Leveraged bear ETF flows, 5 days ($)',
  kxWid: 'Kalshi S&P 500 80% band width per sqrt(day), %', kxRec: 'Kalshi US recession odds, %', svm: 'Market short-volume share, %',
});
export const SHADOW_GUIDANCE_DAYS = 45;
export const SHADOW_PEER_EVENT_DAYS = 14;

const DAY = 86400000;
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// Bake-time chains carry raw daily bars (_bars); files read back by
// regen-picks carry the compact priceSeries instead.
function closesOf(data) {
  if (Array.isArray(data?._bars) && data._bars.length) return data._bars.map((b) => num(b?.c));
  const c = data?.priceSeries?.c;
  return Array.isArray(c) ? c.map(num) : [];
}

function trailingReturnPct(closes, n) {
  if (closes.length <= n) return null;
  const last = closes[closes.length - 1], base = closes[closes.length - 1 - n];
  return last > 0 && base > 0 ? (last / base - 1) * 100 : null;
}

function realizedVolPct(closes, n = 20) {
  if (closes.length <= n) return null;
  const rets = [];
  for (let i = closes.length - n; i < closes.length; i += 1) {
    const a = closes[i - 1], b = closes[i];
    if (!(a > 0) || !(b > 0)) return null;
    rets.push(Math.log(b / a));
  }
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  const v = rets.reduce((s, x) => s + (x - m) * (x - m), 0) / (rets.length - 1);
  return Math.sqrt(v * 252) * 100;
}

function wallPct(wall, spot, side) {
  const k = num(wall?.strike);
  if (!(k > 0) || !(spot > 0)) return null;
  return side === 'call' ? (k / spot - 1) * 100 : (1 - k / spot) * 100;
}

function printGuidance(data, nowMs) {
  const events = Array.isArray(data?.earningsHx?.events) ? data.earningsHx.events : [];
  let latest = null, latestMs = -Infinity;
  for (const ev of events) {
    const ms = Date.parse(ev?.date || '');
    if (Number.isFinite(ms) && ms <= nowMs && ms > latestMs) { latest = ev; latestMs = ms; }
  }
  if (!latest || nowMs - latestMs > SHADOW_GUIDANCE_DAYS * DAY) return null;
  const g = latest.guidance;
  return g === 'raised' ? 1 : g === 'lowered' ? -1 : g === 'inline' ? 0 : null;
}

function peerEventsBySymbol(spillover, nowMs) {
  const out = {};
  for (const ev of Array.isArray(spillover?.upcoming) ? spillover.upcoming : []) {
    const ms = Date.parse(`${ev?.date || ''}T12:00:00Z`);
    if (!Number.isFinite(ms) || ms < nowMs - DAY || ms > nowMs + SHADOW_PEER_EVENT_DAYS * DAY) continue;
    for (const f of Array.isArray(ev.followers) ? ev.followers : []) {
      if (f && f.follower && f.pairQualified) out[f.follower] = (out[f.follower] || 0) + 1;
    }
  }
  return out;
}

// Crowd & positioning facts for one name, from the public crowd.json rollup
// row (lib/crowd/index.mjs buildSymbolRollup) plus the Owner attention score.
function crowdRow(rows, sym) {
  const row = rows?.[sym];
  if (!row) return {};
  const out = {};
  if (num(row.shortPct) != null) out.sv = r2(num(row.shortPct));
  if (num(row.shortZ20) != null) out.svz = r2(num(row.shortZ20));
  if (num(row.borrowFeePct) != null) out.bf = r2(num(row.borrowFeePct));
  const att = num(crowdScoresForRow(row).attention);
  if (att != null) out.att = Math.round(att);
  if (num(row.redditVsAvg7) != null) out.rdv = r2(num(row.redditVsAvg7));
  if (num(row.wikiRatio30) != null) out.wkr = r2(num(row.wikiRatio30));
  if (num(row.watchersPct7d) != null) out.stw = r2(num(row.watchersPct7d));
  if (num(row.perpFundingAnnualPct) != null) out.pf = r2(num(row.perpFundingAnnualPct));
  // pgp is the 09:00 ET pre-open perp read (a fixed time of day, so every
  // day's value means the same thing); rollups from before that field existed
  // fall back to the vs-close figure.
  const pgp = row.perpPreopenPct !== undefined ? num(row.perpPreopenPct) : num(row.perpVsClosePct);
  if (pgp != null) out.pgp = r2(pgp);
  return out;
}

// The day's market-wide crowd gauges (lib/crowd/index.mjs marketGauges), kept
// once per shadow block. A missing gauge is left out.
export function shadowMarketGauges(crowd) {
  if (!crowd || typeof crowd !== 'object') return null;
  const g = marketGauges(crowd);
  const pc = crowd.putCall?.stats?.equity || null;
  const map = {
    pc: g.putCallEquity, pcz: g.putCallEquityZ, pcp: num(pc?.pct250), pct: g.putCallTotal,
    cotEsZ: g.cotEsLevZ, cotEsAmZ: g.cotEsAmZ, cotNqZ: g.cotNqLevZ, cotVxZ: g.cotVxLevZ,
    mdYoy: g.marginDebtYoyPct, mdMom: g.marginDebtMomPct, levBull5: g.levBullUsd5d, levBear5: g.levBearUsd5d,
    kxWid: g.kalshiSpxBandPerDayPct, kxRec: g.kalshiRecessionPct, svm: g.shortVolumeMarketPct,
  };
  const out = {};
  for (const k of SHADOW_MARKET_KEYS) if (num(map[k]) != null) out[k] = r2(num(map[k]));
  return Object.keys(out).length ? out : null;
}

// chains: { SYM: chain data } for the covered universe (ETFs included; the
// research decides what to score). opts: { builtAtIso, groupOf(sym) -> key,
// oiTracker, spillover, crowd (the day's crowd.json payload) }. Every input is
// optional; a missing input leaves that key out rather than writing a zero.
export function buildShadowSignals(chains, opts = {}) {
  const nowMs = Number.isFinite(Date.parse(opts.builtAtIso || '')) ? Date.parse(opts.builtAtIso) : Date.now();
  const syms = Object.keys(chains || {}).filter((s) => chains[s] && num(chains[s].spot) > 0);
  const oiBySym = {};
  for (const row of Array.isArray(opts.oiTracker?.tickers) ? opts.oiTracker.tickers : []) if (row?.symbol) oiBySym[row.symbol] = row;
  const peers = opts.spillover ? peerEventsBySymbol(opts.spillover, nowMs) : null;
  const crowdRows = {};
  for (const row of Array.isArray(opts.crowd?.rollup) ? opts.crowd.rollup : []) if (row?.symbol) crowdRows[row.symbol] = row;

  const r21 = {};
  for (const s of syms) r21[s] = trailingReturnPct(closesOf(chains[s]), 21);
  const groups = {};
  if (typeof opts.groupOf === 'function') {
    for (const s of syms) {
      const g = opts.groupOf(s);
      if (g && r21[s] != null) (groups[g] ||= []).push(s);
    }
  }

  const out = {};
  for (const s of syms) {
    const d = chains[s];
    const spot = num(d.spot);
    const closes = closesOf(d);
    const row = {};
    if (r21[s] != null) row.r21 = r2(r21[s]);
    const g = typeof opts.groupOf === 'function' ? opts.groupOf(s) : null;
    const peerRets = g && groups[g] ? groups[g].filter((p) => p !== s).map((p) => r21[p]) : [];
    if (peerRets.length >= 2) row.im21 = r2(peerRets.reduce((a, x) => a + x, 0) / peerRets.length);
    const iv = num(d.ivRank?.iv), rv = realizedVolPct(closes, 20);
    if (iv > 0 && rv != null) row.vrp = r2(iv * 100 - rv);
    const oi = oiBySym[s];
    if (oi) {
      const cw = wallPct(oi.callWall, spot, 'call'), pw = wallPct(oi.putWall, spot, 'put');
      if (cw != null) row.cw = r2(cw);
      if (pw != null) row.pw = r2(pw);
    }
    const pg = printGuidance(d, nowMs);
    if (pg != null) row.pg = pg;
    if (peers) row.pe14 = peers[s] || 0;
    const f = d.fundamentals || {};
    const er30 = num(f.fyEpsRevision?.pct30);
    if (er30 != null) row.er30 = r2(er30);
    const rev = f.epsRevisions?.y || null;
    const up30 = num(rev?.up30), down30 = num(rev?.down30);
    if (up30 != null && down30 != null) row.rn30 = up30 - down30;
    const ar = f.analystRevisions || null;
    if (num(ar?.upgrades) != null && num(ar?.downgrades) != null) row.ar30 = num(ar.upgrades) - num(ar.downgrades);
    Object.assign(row, crowdRow(crowdRows, s));
    if (Object.keys(row).length) out[s] = SHADOW_KEYS.map((k) => (k in row ? row[k] : null));
  }
  const mkt = shadowMarketGauges(opts.crowd);
  return { v: SHADOW_SIGNAL_VERSION, keys: SHADOW_KEYS.slice(), rows: out, ...(mkt ? { mkt } : {}) };
}

// Read one key off a stored shadow block for one symbol (any version).
export function shadowValue(shadow, sym, key) {
  const i = Array.isArray(shadow?.keys) ? shadow.keys.indexOf(key) : -1;
  const row = shadow?.rows?.[sym];
  return i >= 0 && Array.isArray(row) && row[i] != null && Number.isFinite(Number(row[i])) ? Number(row[i]) : null;
}
