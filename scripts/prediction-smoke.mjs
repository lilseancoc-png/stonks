#!/usr/bin/env node
// Smoke test for the prediction market odds tracker (lib/prediction/).
// Runs offline against a fake Kalshi + Polymarket API built from the venues'
// documented response shapes. node scripts/prediction-smoke.mjs
import assert from 'node:assert/strict';
import { classifyTheme, themeFor, linksFor, companyMatches, leaderTerms, titleSimilarity, THEME_CAPS } from '../lib/prediction/catalog.mjs';
import { kalshiProb, polyQuote, kalshiCandleProb, createClient } from '../lib/prediction/venues.mjs';
import { kalshiCandidates, polyCandidates, pickFromEvent } from '../lib/prediction/select.mjs';
import { etCloseMs, etDate, mergeFine, dailyAt, setDaily, noteSnapshot, changeOver, dailySeries } from '../lib/prediction/history.mjs';
import { analyzeReactions, bhAdjust, signFlipP, findJumps } from '../lib/prediction/reactions.mjs';
import { ladderRead, actualFromSettled, consensusRows, consensusTest, expectedFromSnaps } from '../lib/prediction/consensus.mjs';
import { updatePredictionState, buildPredictionPublic, buildPredictionOwner, analyzePrediction, predictionShadow, provenSign, predictionContextFor, predictionGraderLines, pricesFromChains, PREDICTION_KEY, PREDICTION_OWNER_KEY, PREDICTION_STATE_KEY } from '../lib/prediction/index.mjs';
import { isPremiumKey } from '../lib/premium-keys.mjs';
import { OPTIONAL_BAKE_KEYS } from '../lib/data-ownership.mjs';

let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed += 1; };

// ---- catalog --------------------------------------------------------------
ok('sports are dropped', classifyTheme({ text: 'Who will win the Super Bowl?' }) === null);
ok('a Kalshi Sports category is dropped', classifyTheme({ text: 'Chiefs vs Bills', category: 'Sports' }) === null);
ok('a mention market is dropped', classifyTheme({ text: 'Will Powell say "recession" at the December press conference?' }) === null);
ok('a tweet market is dropped', classifyTheme({ text: 'How many times will Elon Musk tweet this week?' }) === null);
ok('Fed decision reads as fed', classifyTheme({ text: 'Fed decision in December? — 25 bps decrease' }) === 'fed');
ok('CPI reads as macro', classifyTheme({ text: 'CPI above 0.3% in November?' }) === 'macro');
ok('tariffs read as policy, not politics', classifyTheme({ text: 'Will Trump raise tariffs on China?' }) === 'policy');
ok('Ukraine ceasefire reads as geopolitics', classifyTheme({ text: 'Russia x Ukraine ceasefire in 2026?' }) === 'geopolitics');
ok('Senate control reads as politics', classifyTheme({ text: 'Which party will control the Senate after the 2026 midterms?' }) === 'politics');
ok('oil reads as commodities', classifyTheme({ text: 'Will WTI crude oil hit $100 in 2026?' }) === 'commodities');
ok('Bitcoin reads as crypto', classifyTheme({ text: 'Will Bitcoin reach $150,000 by December 31?' }) === 'crypto');
ok('a company question becomes a company bet', themeFor({ eventTitle: 'Will Jensen Huang return as CEO of Nvidia?' }, new Set(UNIVERSE)) === 'company');
ok('company terms match Nvidia, never a bare ambiguous ticker', companyMatches('Will Nvidia be the largest company?').includes('NVDA') && !companyMatches('Will the target rate be cut?').includes('TGT') && !companyMatches('Will he cost the party the seat?').includes('COST'));
ok('leader names from the Leadership collector', leaderTerms({ XYZ: { corporate: { people: [{ name: 'Jane Q. Doe', ceo: true }, { name: 'Bob Roe', ceo: false }] } } }).XYZ?.[0] === 'jane doe');
{
  const set = new Set(UNIVERSE);
  const cut = linksFor({ theme: 'fed', eventTitle: 'Fed decision in December', title: 'Will the Fed cut rates by 25 bps?', outcome: '25 bps decrease' }, set);
  const hold = linksFor({ theme: 'fed', eventTitle: 'Fed decision in December (rate cut?)', title: 'Will the Fed hold?', outcome: 'No change' }, set);
  ok('a cut outcome links SPY and TLT up', cut.find((l) => l.sym === 'TLT')?.sign === 1 && cut.find((l) => l.sym === 'SPY')?.sign === 1);
  ok('a no-change outcome is not read as a cut', !hold.some((l) => l.rule === 'fed-cut'));
  const tariff = linksFor({ theme: 'policy', title: 'Will the US raise tariffs on China above 60%?' }, set);
  ok('new tariffs link importers down', tariff.find((l) => l.sym === 'AAPL')?.sign === -1 && tariff.find((l) => l.sym === 'WMT')?.sign === -1);
  const ease = linksFor({ theme: 'policy', title: 'Will the Supreme Court strike down the tariffs?' }, set);
  ok('tariffs struck down link importers up', ease.find((l) => l.sym === 'AAPL')?.sign === 1 && !ease.some((l) => l.rule === 'tariff-up'));
  const peace = linksFor({ theme: 'geopolitics', title: 'Russia x Ukraine ceasefire in 2026?' }, set);
  ok('a ceasefire links oil down and stocks up', peace.find((l) => l.sym === 'USO')?.sign === -1 && peace.find((l) => l.sym === 'SPY')?.sign === 1);
  const btc = linksFor({ theme: 'crypto', title: 'Will Bitcoin reach $150,000 by December 31?' }, set);
  ok('Bitcoin higher links Robinhood up', btc.find((l) => l.sym === 'HOOD')?.sign === 1);
  const nv = linksFor({ theme: 'company', title: 'Will Jensen Huang step down as CEO of Nvidia?' }, set);
  ok('a company link has no declared sign', nv.find((l) => l.sym === 'NVDA')?.sign === 0);
  const off = linksFor({ theme: 'policy', title: 'Will the US raise tariffs on Mexico?' }, new Set(['SPY']));
  ok('links outside the covered universe are dropped', off.every((l) => l.sym === 'SPY'));
}
ok('the same question on both venues matches', titleSimilarity('Russia Ukraine ceasefire in 2026', 'Russia x Ukraine ceasefire in 2026?') >= 0.5);
ok('theme caps total about 160', Object.values(THEME_CAPS).reduce((a, b) => a + b, 0) === 160);

// ---- venues ---------------------------------------------------------------
ok('Kalshi mid from dollar fields', kalshiProb({ yes_bid_dollars: '0.40', yes_ask_dollars: '0.44' }) === 0.42);
ok('Kalshi wide book falls back to last', kalshiProb({ yes_bid_dollars: '0.01', yes_ask_dollars: '0.99', last_price_dollars: '0.30' }) === 0.3);
ok('Kalshi cents fallback', kalshiProb({ yes_bid: 40, yes_ask: 44 }) === 0.42);
ok('Kalshi candle with only a trade price', kalshiCandleProb({ price: { close_dollars: '0.61' }, yes_bid: {}, yes_ask: {} }) === 0.61);
{
  const q = polyQuote({ outcomes: '["Yes","No"]', outcomePrices: '["0.62","0.38"]', clobTokenIds: '["111","222"]', bestBid: 0.61, bestAsk: 0.63, volumeNum: 1e6 });
  ok('Polymarket yes price and yes token', q.prob === 0.62 && q.tokenId === '111');
  const done = polyQuote({ outcomes: '["Yes","No"]', outcomePrices: '["1","0"]', closed: true });
  ok('a resolved Polymarket market reads its result', done.result === 'yes' && done.status === 'settled');
}

import { NOW, iso, DAY, UNIVERSE, callLog, fakeFetch, crowdKalshi, polyEvents, kalshiEvents } from './prediction-fixture.mjs';

// ---- one bake -------------------------------------------------------------
const { state, status } = await updatePredictionState({ prior: null, nowMs: NOW, universe: UNIVERSE, chains: {}, fetchJson: fakeFetch, crowdKalshi, budget: 400 });
const ids = Object.keys(state.contracts);
ok('Fed outcomes, tariff, ceasefire, House, Bitcoin and Nvidia contracts are tracked', ['K:KXFEDDECISION-26DEC-H0', 'K:KXFEDDECISION-26DEC-C25', 'K:KXTARIFFCN-26-T60', 'P:9001', 'P:9021', 'K:KXNVDACEO-26-JH'].every((id) => ids.includes(id)));
ok('sports and mention markets are never tracked', !ids.some((id) => /NFL|MENTION|9011/.test(id)));
ok('a ladder keeps the one level nearest 50%', ids.includes('K:KXBTCMAX-26DEC-120') && !ids.includes('K:KXBTCMAX-26DEC-100') && !ids.includes('K:KXBTCMAX-26DEC-150'));
ok('the 5% hike outcome is kept (priced at 3% or more)', ids.includes('K:KXFEDDECISION-26DEC-H25'));
ok('every call stays inside the budget', status.calls <= 400 && callLog.length === status.calls);
ok('new contracts are backfilled with hourly history', state.contracts['K:KXTARIFFCN-26-T60'].backfill.done && dailySeries(state.contracts['K:KXTARIFFCN-26-T60']).length > 150);
ok('backfilled days are exact 16:00 ET closes', dailyAt(state.contracts['P:9001'], '2026-11-12')?.q === 1);
ok('both venues read fresh', status.venues.kalshi.ok && status.venues.polymarket.ok);
ok('the settled CPI ladders give an actual number', state.consensus.events['KXCPI-26M1']?.actual === 0.25);
ok('CPI history guesses come from hourly prices', Number.isFinite(state.consensus.events['KXCPI-26M1']?.expected));
ok('the open CPI release keeps a guess snapshot', state.consensus.events['KXCPI-26DEC']?.snaps?.length === 1);
ok('the Fed decision keeps cut minus hike', Math.abs(state.consensus.events['KXFEDDECISION-26DEC'].snaps[0][2] - 0.4) < 0.02);

// A second bake the same day does not rediscover and stays cheap.
callLog.length = 0;
const second = await updatePredictionState({ prior: state, nowMs: NOW + 3600000, universe: UNIVERSE, chains: {}, fetchJson: fakeFetch, crowdKalshi, budget: 400 });
ok('a later bake the same day skips discovery', !second.status.discovered && !callLog.some((u) => u.includes('/series?') || u.includes('/events?status=open')));
ok('a later bake refreshes tracked prices in batches', callLog.filter((u) => u.includes('/markets?tickers=')).length === 1 && callLog.filter((u) => u.includes('gamma-api.polymarket.com/markets?')).length === 1);
ok('a later bake uses few calls', second.status.calls <= 6);
ok('refreshed Kalshi prices are applied', second.state.contracts['K:KXTARIFFCN-26-T60'].last.p === 0.37);

// A venue outage keeps the prior state, marks the venue and never throws.
const down = await updatePredictionState({ prior: second.state, nowMs: NOW + 7200000, universe: UNIVERSE, chains: {}, fetchJson: () => Promise.reject(new Error('fetch failed')), crowdKalshi: null, budget: 400 });
ok('an outage keeps every contract', Object.keys(down.state.contracts).length === Object.keys(second.state.contracts).length);
ok('an outage marks both venues not fresh', !down.status.venues.kalshi.ok && !down.status.venues.polymarket.ok);

// ---- public payload -------------------------------------------------------
const pub = buildPredictionPublic(second.state, second.status, { nowMs: NOW + 3600000, crowdKalshi });
ok('public payload carries themes with contracts', pub.themes.find((t) => t.id === 'geopolitics').contracts.some((c) => c.id === 'P:9001'));
ok('public contracts carry a 30-day line and stock links', pub.themes.flatMap((t) => t.contracts).every((c) => c.spark.length === 30 && Array.isArray(c.links)));
ok('bySymbol lists NVDA', pub.bySymbol.NVDA?.some((x) => x.id === 'K:KXNVDACEO-26-JH'));
ok('the upcoming CPI release shows the market guess', pub.consensus.upcoming.some((u) => u.series === 'KXCPI' && Math.abs(u.expected - 0.28) < 0.03));
ok('recent releases show guess and actual', pub.consensus.recent.length === 3 && pub.consensus.recent.every((x) => Number.isFinite(x.actual) && Number.isFinite(x.expected)));
ok('public payload is not an Owner key', !isPremiumKey(PREDICTION_KEY));
ok('owner and state payloads are Owner keys', isPremiumKey(PREDICTION_OWNER_KEY) && isPremiumKey(PREDICTION_STATE_KEY));
ok('all three keys are bake keys', [PREDICTION_KEY, PREDICTION_OWNER_KEY, PREDICTION_STATE_KEY].every((k) => OPTIONAL_BAKE_KEYS.includes(k)));
ok('the public payload has no test verdicts', !JSON.stringify(pub).includes('verdict'));
const ctx = predictionContextFor(pub, 'NVDA');
ok('scoring context lists linked odds', ctx?.contracts?.[0]?.id === 'K:KXNVDACEO-26-JH');
ok('grader lines mark an unknown direction with ?', predictionGraderLines(ctx).some((l) => l.includes('[?]')));

// ---- tests on synthetic data ----------------------------------------------
{
  const days = [];
  for (let t = Date.parse('2025-11-03T12:00:00Z'); days.length < 260; t += DAY) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() < 6) days.push(d.toISOString().slice(0, 10)); }
  const rand = (() => { let a = 7; return () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; }; })();
  const spy = [], tlt = [], gld = [];
  let ps = 400, pt = 90, pg = 180;
  // Odds: jump ±12 points every 6 trading days; TLT moves +0.8% with each
  // up-jump of a "Fed cut" contract (declared +), GLD does nothing.
  const odds = new Map();
  let p = 0.4;
  for (let i = 0; i < days.length; i += 1) {
    let dir = 0;
    if (i > 0 && i % 6 === 0) { dir = p < 0.5 ? 1 : -1; p = Math.max(0.05, Math.min(0.95, p + dir * 0.12)); }
    else p = Math.max(0.05, Math.min(0.95, p + (rand() - 0.5) * 0.01));
    odds.set(days[i], p);
    ps *= 1 + (rand() - 0.5) * 0.01; pt *= 1 + (rand() - 0.5) * 0.004 + dir * 0.008; pg *= 1 + (rand() - 0.5) * 0.01;
    spy.push([days[i], ps]); tlt.push([days[i], pt]); gld.push([days[i], pg]);
  }
  const c = { id: 'X:1', links: [{ sym: 'TLT', sign: 1, rule: 'fed-cut' }, { sym: 'GLD', sign: 1, rule: 'gold-up' }], closeTime: iso(Date.parse('2026-12-01T00:00:00Z')) };
  for (const d of days) setDaily(c, d, odds.get(d), true);
  const an = analyzeReactions({ contracts: [c], prices: { SPY: spy, TLT: tlt, GLD: gld } });
  const tltF = an.families.find((f) => f.sym === 'TLT'), gldF = an.families.find((f) => f.sym === 'GLD');
  ok('jumps are found every six days', tltF.jumps.n >= 40);
  ok('a real same-day effect holds out of sample', tltF.jumps.verdict === 'holds' && tltF.jumps.same.mean > 0.5);
  ok('no effect reads no effect', gldF.jumps.verdict === 'no-effect');
  ok('the same-day day-level link is found', tltF.flow.same > 0.3);
  ok('a coarse day is never used', findJumps([0.1, 0.3], ['a', 'b']).length === 1 && analyzeReactions({ contracts: [{ id: 'Y', links: [{ sym: 'TLT', sign: 1, rule: 'x' }], d0: days[0], dv: days.map(() => 0.5), dq: '0'.repeat(days.length) }], prices: { SPY: spy, TLT: tlt } }).families.every((f) => f.jumps.n === 0 && f.flow.n === 0));
  ok('sign-flip p is small for a clear effect and large for noise', signFlipP([1, 1.2, 0.8, 1.1, 0.9, 1, 1.3, 0.7, 1, 1]) < 0.01 && signFlipP([1, -1, 0.5, -0.6, 0.2, -0.1, 0.3, -0.4]) > 0.2);
  const q = bhAdjust([0.01, 0.04, 0.03, null, 0.5]);
  ok('Benjamini-Hochberg keeps order and nulls', q[3] === null && q[0] <= q[1] && Math.abs(q[4] - 0.5) < 1e-9);
}

// ---- consensus ------------------------------------------------------------
{
  const read = ladderRead([{ floor: 0.2, strikeType: 'greater', prob: 0.9 }, { floor: 0.3, strikeType: 'greater', prob: 0.5 }, { floor: 0.4, strikeType: 'greater', prob: 0.1 }]);
  ok('ladder median and 80% band', Math.abs(read.median - 0.3) < 1e-6 && Math.abs(read.lo - 0.2) < 1e-6 && Math.abs(read.hi - 0.4) < 1e-6);
  ok('actual from expiration value, scaled', actualFromSettled([{ expiration_value: '143000', result: 'yes' }], { scale: 1000 }) === 143);
  ok('actual from yes / no levels', actualFromSettled([{ strike_type: 'greater', floor_strike: 0.2, result: 'yes' }, { strike_type: 'greater', floor_strike: 0.3, result: 'no' }]) === 0.25);
  ok('expected value is the last guess 30+ minutes before the close', expectedFromSnaps({ closeTime: iso(NOW), snaps: [[NOW - 7200000, 0.3, 0.2, 0.4], [NOW - 600000, 0.35, 0.2, 0.4]] }).value === 0.3);
  const fake = { consensus: { events: {} } };
  for (let k = 0; k < 40; k += 1) fake.consensus.events[`E${k}`] = { series: 'KXCPI', kind: 'macro', closeTime: iso(Date.parse('2024-01-10T13:30:00Z') + k * 14 * DAY), expected: 0.3, actual: 0.3 + ((k % 5) - 2) * 0.1, snaps: [] };
  const rows = consensusRows(fake);
  ok('release surprises are standardized', rows.length === 40 && rows.every((x) => Number.isFinite(x.z)));
  const prices = { TLT: [], SPY: [] };
  for (const x of rows.slice().reverse()) {
    const d = x.release, prev = new Date(Date.parse(`${d}T12:00:00Z`) - DAY).toISOString().slice(0, 10);
    prices.TLT.push([prev, 100], [d, 100 * (1 - 0.004 * x.hawkZ)]);
    prices.SPY.push([prev, 400], [d, 400]);
  }
  for (const k of Object.keys(prices)) prices[k].sort((a, b) => a[0].localeCompare(b[0]));
  const tests = consensusTest(rows, prices);
  const tl = tests.find((t) => t.group === 'macro' && t.sym === 'TLT');
  ok('a hot print pushing bonds down holds', tl.verdict === 'holds' && tl.slope < 0);
}

// ---- shadow and owner payload ---------------------------------------------
{
  const chains = { SPY: { _bars: [] }, TLT: { _bars: [] }, NVDA: { _bars: [] } };
  for (let i = 0; i < 300; i += 1) {
    const d = new Date(Date.parse('2025-09-01T14:30:00Z') + i * DAY);
    if (!(d.getUTCDay() && d.getUTCDay() < 6)) continue;
    const t = d.toISOString();
    chains.SPY._bars.push({ t, c: 400 + i }); chains.TLT._bars.push({ t, c: 90 + Math.sin(i) }); chains.NVDA._bars.push({ t, c: 100 + i / 2 });
  }
  const prices = pricesFromChains(chains, Object.keys(chains));
  ok('prices come from the bake bars by date', prices.SPY.length > 150 && /^\d{4}-\d{2}-\d{2}$/.test(prices.SPY[0][0]));
  const an = analyzePrediction(second.state, { prices, nowMs: NOW + 3600000 });
  const owner = buildPredictionOwner(second.state, an, { nowMs: NOW + 3600000, openTrades: [{ id: 'NVDA-C-1', symbol: 'NVDA', side: 'call' }], pub, universe: UNIVERSE });
  ok('owner payload has families, a run-up list and alerts arrays', Array.isArray(owner.families) && Array.isArray(owner.runUp) && Array.isArray(owner.alerts));
  ok('owner run-up list includes the Nvidia contract', owner.runUp.some((x) => x.sym === 'NVDA' && x.id === 'K:KXNVDACEO-26-JH'));
  // A sign learned on the fit half is not acted on until a test passes.
  const fakeFam = (verdict) => new Map([['company|NVDA', { sign: 1, jumps: { verdict }, flow: { verdict: 'no-order' }, runup: { verdict: 'collecting' } }]]);
  const link = { sym: 'NVDA', sign: 0, rule: 'company' };
  ok('an untested learned sign stays pending', provenSign(link, fakeFam('no-effect')).sign === 0 && provenSign(link, fakeFam('no-effect')).pending === 1);
  ok('a learned sign that passed is used', provenSign(link, fakeFam('holds')).sign === 1 && provenSign(link, fakeFam('holds')).pending === null);
  ok('a declared sign is used as is', provenSign({ sym: 'TLT', sign: -1, rule: 'fed-hike' }, fakeFam('no-effect')).sign === -1);
  ok('alerts and run-up never read helps/hurts from an unproven sign', [...owner.alerts, ...owner.runUp].every((a) => !a.pending || a.sign === 0) && owner.alerts.filter((a) => a.pending).every((a) => a.reads === 'unknown'));
  const sh = predictionShadow(second.state, { universe: UNIVERSE, nowMs: NOW + 3600000 });
  ok('shadow counts linked contracts per name', sh.rows.NVDA.pmn >= 1 && sh.rows.TLT.pmn >= 1 && sh.rows.MSFT.pmn === 0);
  ok('the NVDA company link logs no pmo without a learned sign', sh.rows.NVDA.pmo === undefined);
  ok('market gauge: chance of a cut at the next meeting', Math.abs(sh.mkt.pmCut - 42) < 1.5);
}

// ---- history helpers ------------------------------------------------------
{
  ok('16:00 ET in winter is 21:00 UTC', etCloseMs('2026-12-01') === Date.parse('2026-12-01T21:00:00Z'));
  ok('16:00 ET in summer is 20:00 UTC', etCloseMs('2026-07-01') === Date.parse('2026-07-01T20:00:00Z'));
  const c = {};
  mergeFine(c, [[Date.parse('2026-11-10T20:00:00Z') / 1000, 0.4], [Date.parse('2026-11-10T21:30:00Z') / 1000, 0.6]], NOW);
  ok('the close is the last price at or before 16:00 ET', dailyAt(c, '2026-11-10').p === 0.4);
  const snap = {};
  noteSnapshot(snap, Date.parse('2026-11-12T21:15:00Z'), 0.55);
  noteSnapshot(snap, Date.parse('2026-11-12T15:15:00Z'), 0.45);
  ok('a 16:15 ET bake read counts as the close, a 10:15 ET one does not', dailyAt(snap, '2026-11-12').p === 0.55 && dailyAt(snap, '2026-11-12').q === 1);
  ok('7-day change in points', changeOver({ d0: '2026-11-06', dv: [0.4, null, null, null, null, null, null, null], dq: '1-------' }, 0.5, '2026-11-13', 7) === 10);
  ok('ET date helper', etDate(Date.parse('2026-11-14T03:00:00Z')) === '2026-11-13');
}
{
  const client = createClient({ fetchJson: () => Promise.resolve({}), budget: 2 });
  await client.get('a'); await client.get('b');
  let threw = false;
  try { await client.get('c'); } catch (e) { threw = !!e.budget; }
  ok('the client refuses calls past its budget', threw && client.calls === 2);
}
{
  const ev = { event_ticker: 'E', series_ticker: 'S', title: 'T', markets: [{ ticker: 'A', yes_sub_title: 'a', yes_bid_dollars: '0.6', yes_ask_dollars: '0.62' }, { ticker: 'B', yes_sub_title: 'b', yes_bid_dollars: '0.02', yes_ask_dollars: '0.03' }] };
  const cands = kalshiCandidates({ ...ev, mutually_exclusive: true });
  ok('an outcome under 3% is not kept', pickFromEvent(cands).map((c) => c.id).join() === 'K:A');
  ok('Polymarket candidates carry the yes token', polyCandidates(polyEvents[0])[0].tokenId === 'tok9001');
}

console.log(`prediction-smoke: ${passed} checks passed`);
