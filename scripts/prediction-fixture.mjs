// Synthetic Kalshi / Gamma / CLOB API for the prediction-market tests
// (prediction-smoke.mjs, prediction-browser.mjs). Nothing here contacts a
// venue: fakeFetch answers the same URL shapes lib/prediction/venues.mjs asks.
import { updatePredictionState, buildPredictionPublic, buildPredictionOwner, analyzePrediction, pricesFromChains } from '../lib/prediction/index.mjs';

export const UNIVERSE = ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'USO', 'SLV', 'SMH', 'AAPL', 'WMT', 'COST', 'TGT', 'NKE', 'KWEB', 'BABA', 'TSM', 'HD', 'NVDA', 'AMD', 'HOOD', 'TSLA', 'MSFT', 'UVXY', 'ASML', 'AMAT'];
export const NOW = Date.parse('2026-11-13T21:20:00Z'); // Friday 16:20 ET
export const iso = (ms) => new Date(ms).toISOString();
export const DAY = 86400000;
const kMarket = (ticker, title, sub, p, vol, closeMs, extra = {}) => ({ ticker, title, yes_sub_title: sub, yes_bid_dollars: (p - 0.01).toFixed(4), yes_ask_dollars: (p + 0.01).toFixed(4), last_price_dollars: p.toFixed(4), volume_fp: String(vol), volume_24h_fp: String(Math.round(vol / 20)), open_interest_fp: String(vol / 2), close_time: iso(closeMs), open_time: iso(NOW - 200 * DAY), status: 'active', ...extra });
const close30 = NOW + 30 * DAY;
export const kalshiEvents = [
  { event_ticker: 'KXFEDDECISION-26DEC', series_ticker: 'KXFEDDECISION', title: 'Fed decision in Dec 2026', mutually_exclusive: true, markets: [
    kMarket('KXFEDDECISION-26DEC-H0', 'Will the Fed leave rates unchanged?', 'No change', 0.55, 90000, close30),
    kMarket('KXFEDDECISION-26DEC-C25', 'Will the Fed cut 25 bps?', '25 bps decrease', 0.4, 80000, close30),
    kMarket('KXFEDDECISION-26DEC-H25', 'Will the Fed hike 25 bps?', '25 bps increase', 0.05, 10000, close30),
  ] },
  { event_ticker: 'KXTARIFFCN-26', series_ticker: 'KXTARIFFCN', title: 'Tariffs on China', markets: [kMarket('KXTARIFFCN-26-T60', 'Will the US raise tariffs on China above 60% before 2027?', '', 0.35, 12000, NOW + 50 * DAY)] },
  { event_ticker: 'KXNFLGAME-1', series_ticker: 'KXNFLGAME', title: 'Chiefs vs Bills', markets: [kMarket('KXNFLGAME-1-KC', 'Chiefs win?', '', 0.5, 900000, NOW + 3 * DAY)] },
  { event_ticker: 'KXBTCMAX-26DEC', series_ticker: 'KXBTCMAX', title: 'Bitcoin high by Dec 31', markets: [
    kMarket('KXBTCMAX-26DEC-100', 'Will Bitcoin reach $100,000?', '$100,000 or above', 0.8, 30000, close30, { strike_type: 'greater', floor_strike: 100000 }),
    kMarket('KXBTCMAX-26DEC-120', 'Will Bitcoin reach $120,000?', '$120,000 or above', 0.46, 30000, close30, { strike_type: 'greater', floor_strike: 120000 }),
    kMarket('KXBTCMAX-26DEC-150', 'Will Bitcoin reach $150,000?', '$150,000 or above', 0.1, 30000, close30, { strike_type: 'greater', floor_strike: 150000 }),
  ] },
  { event_ticker: 'KXNVDACEO-26', series_ticker: 'KXNVDACEO', title: 'Nvidia CEO', markets: [kMarket('KXNVDACEO-26-JH', 'Will Jensen Huang return to Nvidia as CEO before 2027?', '', 0.8, 5000, NOW + 45 * DAY)] },
  { event_ticker: 'KXMENTION-1', series_ticker: 'KXMENTION', title: 'What will Powell say?', markets: [kMarket('KXMENTION-1-R', 'Will Powell say "recession"?', '', 0.3, 50000, close30)] },
];
const seriesByCat = {
  Economics: [{ ticker: 'KXFEDDECISION', category: 'Economics', tags: ['Fed'] }, { ticker: 'KXCPI', category: 'Economics' }],
  Politics: [{ ticker: 'KXTARIFFCN', category: 'Politics' }],
  Crypto: [{ ticker: 'KXBTCMAX', category: 'Crypto' }],
  Companies: [{ ticker: 'KXNVDACEO', category: 'Companies' }],
};
export const polyEvents = [
  { id: 900, slug: 'russia-x-ukraine-ceasefire-in-2026', title: 'Russia x Ukraine ceasefire in 2026?', tags: [{ slug: 'geopolitics' }], volume: 5e6, markets: [
    { id: 9001, question: 'Russia x Ukraine ceasefire in 2026?', outcomes: '["Yes","No"]', outcomePrices: '["0.25","0.75"]', clobTokenIds: '["tok9001","tok9001n"]', bestBid: 0.24, bestAsk: 0.26, volumeNum: 2e6, volume24hr: 80000, endDate: iso(NOW + 48 * DAY), active: true, closed: false },
  ] },
  { id: 901, slug: 'super-bowl-champion-2027', title: 'Super Bowl Champion 2027', tags: [{ slug: 'sports' }], volume: 9e7, markets: [
    { id: 9011, question: 'Will the Chiefs win Super Bowl 2027?', outcomes: '["Yes","No"]', outcomePrices: '["0.2","0.8"]', clobTokenIds: '["t1","t2"]', volumeNum: 5e6, endDate: iso(NOW + 90 * DAY), active: true, closed: false },
  ] },
  { id: 902, slug: 'which-party-wins-the-house-2026', title: 'Which party wins the House in 2026?', negRisk: true, tags: [{ slug: 'politics' }], volume: 3e7, markets: [
    { id: 9021, question: 'Will the Democrats win the House in 2026?', groupItemTitle: 'Democrats', outcomes: '["Yes","No"]', outcomePrices: '["0.7","0.3"]', clobTokenIds: '["tok9021","x"]', bestBid: 0.69, bestAsk: 0.71, volumeNum: 1e7, volume24hr: 200000, endDate: iso(NOW + 20 * DAY), active: true, closed: false, negRisk: true },
    { id: 9022, question: 'Will the Republicans win the House in 2026?', groupItemTitle: 'Republicans', outcomes: '["Yes","No"]', outcomePrices: '["0.3","0.7"]', clobTokenIds: '["tok9022","y"]', bestBid: 0.29, bestAsk: 0.31, volumeNum: 9e6, volume24hr: 150000, endDate: iso(NOW + 20 * DAY), active: true, closed: false, negRisk: true },
  ] },
];
// Smooth price paths with a few 10+ point jumps so the history and the jump
// finder have something to find.
const path = (key, tSec) => {
  const base = 0.3 + 0.2 * Math.sin(tSec / (86400 * 9) + key.length);
  const step = Math.floor(tSec / (86400 * 17)) % 2 ? 0.15 : 0;
  return Math.max(0.02, Math.min(0.98, Math.round((base + step) * 10000) / 10000));
};
export const callLog = [];
export function fakeFetch(url) {
  callLog.push(url);
  const u = new URL(url);
  const q = u.searchParams;
  if (u.hostname.includes('kalshi')) {
    const p = u.pathname.replace(/^\/trade-api\/v2/, '');
    if (p === '/series') return Promise.resolve({ series: seriesByCat[q.get('category')] || [] });
    if (p === '/events' && q.get('status') === 'open') return Promise.resolve({ events: kalshiEvents, cursor: '' });
    if (p === '/events' && q.get('status') === 'settled') {
      const s = q.get('series_ticker');
      if (s !== 'KXCPI') return Promise.resolve({ events: [] });
      const evs = [];
      for (let k = 1; k <= 3; k += 1) {
        const closeMs = NOW - k * 30 * DAY;
        evs.push({ event_ticker: `KXCPI-26M${k}`, title: `CPI m/m, release ${k}`, markets: [0.1, 0.2, 0.3, 0.4].map((lvl) => ({ ticker: `KXCPI-26M${k}-T${lvl}`, strike_type: 'greater', floor_strike: lvl, result: 0.25 + k * 0.03 > lvl ? 'yes' : 'no', close_time: iso(closeMs), status: 'settled' })) });
      }
      return Promise.resolve({ events: evs });
    }
    if (p === '/markets') {
      const want = (q.get('tickers') || '').split(',');
      const all = kalshiEvents.flatMap((e) => e.markets);
      // The refresh quotes each market 2 cents above its listed price.
      return Promise.resolve({ markets: all.filter((m) => want.includes(m.ticker)).map((m) => { const p = Number(m.last_price_dollars) + 0.02; return { ...m, yes_bid_dollars: (p - 0.01).toFixed(4), yes_ask_dollars: (p + 0.01).toFixed(4) }; }) });
    }
    const cm = p.match(/\/markets\/([^/]+)\/candlesticks$/);
    if (cm) {
      const start = Number(q.get('start_ts')), end = Number(q.get('end_ts')), per = Number(q.get('period_interval')) * 60;
      const out = [];
      for (let t = Math.ceil(start / per) * per; t <= end; t += per) { const v = path(cm[1], t); out.push({ end_period_ts: t, yes_bid: { close_dollars: (v - 0.01).toFixed(4) }, yes_ask: { close_dollars: (v + 0.01).toFixed(4) }, price: { close_dollars: v.toFixed(4) } }); }
      return Promise.resolve({ ticker: cm[1], candlesticks: out });
    }
  }
  if (u.hostname.includes('gamma')) {
    if (u.pathname === '/events') {
      const tag = q.get('tag_slug');
      const off = Number(q.get('offset') || 0);
      if (off > 0) return Promise.resolve([]);
      return Promise.resolve(tag ? polyEvents.filter((e) => e.tags.some((t) => t.slug === tag)) : polyEvents);
    }
    if (u.pathname === '/markets') {
      const ids = q.getAll('id');
      return Promise.resolve(polyEvents.flatMap((e) => e.markets).filter((m) => ids.includes(String(m.id))));
    }
  }
  if (u.hostname.includes('clob')) {
    const start = Number(q.get('startTs')), end = Number(q.get('endTs')), fid = Number(q.get('fidelity')) * 60;
    const out = [];
    for (let t = Math.ceil(start / fid) * fid; t <= end; t += fid) out.push({ t, p: path(q.get('market'), t) });
    return Promise.resolve({ history: out });
  }
  return Promise.reject(Object.assign(new Error('HTTP 404'), { status: 404 }));
}

export const crowdKalshi = { series: { KXCPI: { ok: true, events: [{ eventTicker: 'KXCPI-26DEC', title: 'CPI m/m, December release', closeTime: iso(NOW + 12 * DAY), markets: [
  { ticker: 'KXCPI-26DEC-T0.2', floor: 0.2, cap: null, strikeType: 'greater', prob: 0.85 },
  { ticker: 'KXCPI-26DEC-T0.3', floor: 0.3, cap: null, strikeType: 'greater', prob: 0.4 },
  { ticker: 'KXCPI-26DEC-T0.4', floor: 0.4, cap: null, strikeType: 'greater', prob: 0.08 },
] }] } } };

// Daily bars for the fixture names, so the tests have prices to read.
export function fixtureChains(syms = ['SPY', 'TLT', 'NVDA', 'GLD', 'TSM', 'WMT']) {
  const chains = {};
  for (const s of syms) chains[s] = { _bars: [] };
  for (let i = 0; i < 420; i += 1) {
    const d = new Date(Date.parse('2025-09-01T14:30:00Z') + i * DAY);
    if (!(d.getUTCDay() && d.getUTCDay() < 6) || d.getTime() > NOW) continue;
    const t = d.toISOString();
    syms.forEach((s, k) => chains[s]._bars.push({ t, c: 100 + k * 20 + i / (3 + k) + 3 * Math.sin(i / (4 + k)) }));
  }
  return chains;
}

// Two bakes (discover, then refresh) and the public and Owner payloads.
export async function predictionFixture() {
  const first = await updatePredictionState({ prior: null, nowMs: NOW, universe: UNIVERSE, chains: {}, fetchJson: fakeFetch, crowdKalshi, budget: 400 });
  const second = await updatePredictionState({ prior: first.state, nowMs: NOW + 3600000, universe: UNIVERSE, chains: {}, fetchJson: fakeFetch, crowdKalshi, budget: 400 });
  const chains = fixtureChains();
  const prices = pricesFromChains(chains, Object.keys(chains));
  const an = analyzePrediction(second.state, { prices, nowMs: NOW + 3600000 });
  const pub = buildPredictionPublic(second.state, second.status, { nowMs: NOW + 3600000, crowdKalshi, consensusRowsWithMoves: an.consensusRowsWithMoves });
  const owner = buildPredictionOwner(second.state, an, { nowMs: NOW + 3600000, openTrades: [{ id: 'NVDA-C-11/13/26-11:00 ET', symbol: 'NVDA', side: 'call' }, { id: 'TLT-P-11/13/26-11:00 ET', symbol: 'TLT', side: 'put' }], pub, universe: UNIVERSE });
  return { state: second.state, status: second.status, pub, owner };
}
