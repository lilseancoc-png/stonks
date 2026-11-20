#!/usr/bin/env node
// Smoke test for the prediction market odds tracker (lib/prediction/).
// Runs offline against a fake Kalshi + Polymarket API built from the venues'
// documented response shapes. node scripts/prediction-smoke.mjs
import assert from 'node:assert/strict';
import { classifyTheme, themeFor, linksFor, companyMatches, leaderTerms, titleSimilarity, THEME_CAPS, withoutDeadlines, isExcludedContract } from '../lib/prediction/catalog.mjs';
import { kalshiProb, polyQuote, kalshiCandleProb, createClient } from '../lib/prediction/venues.mjs';
import { kalshiCandidates, polyCandidates, pickFromEvent, selectContracts } from '../lib/prediction/select.mjs';
import { etCloseMs, etDate, mergeFine, dailyAt, setDaily, noteSnapshot, changeOver, dailySeries } from '../lib/prediction/history.mjs';
import { analyzeReactions, bhAdjust, signFlipP, findJumps, mergeJumps, familyCut, corrP, tTwoSidedP } from '../lib/prediction/reactions.mjs';
import { ladderRead, actualFromSettled, consensusRows, consensusTest, expectedFromSnaps } from '../lib/prediction/consensus.mjs';
import { updatePredictionState, bakeMaxMs, BAKE_MAX_MS, BAKE_MAX_MS_DECISION, buildPredictionPublic, buildPredictionOwner, analyzePrediction, predictionShadow, fedNextDecision, provenSign, predictionContextFor, predictionGraderLines, pricesFromChains, PREDICTION_KEY, PREDICTION_OWNER_KEY, PREDICTION_STATE_KEY } from '../lib/prediction/index.mjs';
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
{
  const set = new Set(UNIVERSE.concat(['PYPL']));
  ok('a takeover question names a covered company: a company bet, not the economy', themeFor({ title: 'Will Stripe acquire any part of Paypal in 2026?', category: 'Finance' }, set) === 'company');
  ok('a takeover of a company the site does not cover is dropped', themeFor({ title: 'Will Lovable be acquired before 2027?', category: 'Finance' }, set) === null);
  ok('a covered company filed only by the venue category is a company bet', themeFor({ title: 'New NVIDIA CEO named by December 31, 2026?', category: 'Economy' }, set) === 'company');
  ok('the Strait of Hormuz reads as geopolitics', themeFor({ title: 'Strait of Hormuz traffic returns to normal by December 31?', category: 'Economy' }, set) === 'geopolitics');
  ok('a government stake reads as policy', themeFor({ title: 'Will the US federal government take a stake in Anduril Industries, Inc.?', category: 'Economy' }, set) === 'policy');
  ok('an economy question with no words of its own keeps the venue category', themeFor({ title: 'Will the US economy be overheating at the end of 2026?', category: 'Economy' }, set) === 'macro');
}
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
{
  // Audit 2026-11-16: one news day is one observation, and one date cut.
  const days = [];
  for (let t = Date.parse('2025-11-03T12:00:00Z'); days.length < 260; t += DAY) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() < 6) days.push(d.toISOString().slice(0, 10)); }
  const spy = days.map((d, i) => [d, 400 * (1 + 0.001 * Math.sin(i))]);
  const tlt = days.map((d, i) => [d, 90 * (1 + 0.002 * Math.cos(i * 1.7))]);
  const mk = (id) => {
    const c = { id, links: [{ sym: 'TLT', sign: 1, rule: 'fed-cut' }] };
    let p = 0.4;
    for (let i = 0; i < days.length; i += 1) { if (i > 0 && i % 6 === 0) p = p < 0.5 ? p + 0.12 : p - 0.12; setDaily(c, days[i], p, true); }
    return c;
  };
  const one = analyzeReactions({ contracts: [mk('L:1')], prices: { SPY: spy, TLT: tlt } }).families[0];
  const five = analyzeReactions({ contracts: ['L:1', 'L:2', 'L:3', 'L:4', 'L:5'].map(mk), prices: { SPY: spy, TLT: tlt } }).families[0];
  ok('five ladder contracts jumping on the same days count once, not five times', five.jumps.n === one.jumps.n && five.flow.n === one.flow.n && five.runup.n === one.runup.n);
  ok('a family carries one fit/test date cut', typeof five.cut === 'string' && five.cut > days[0] && five.cut < days[days.length - 1]);
  const merged = mergeJumps([{ i: 10, date: 'd10', change: 12, dir: 1, id: 'a', same: 1 }, { i: 10, date: 'd10', change: 14, dir: 1, id: 'b', same: 1 }, { i: 12, date: 'd12', change: -11, dir: -1, id: 'c', same: 0 }, { i: 20, date: 'd20', change: 15, dir: 1, id: 'a', same: 0 }]);
  ok('same-day jumps average, and a jump two days later is the same story', merged.length === 2 && merged[0].change === 13 && merged[0].contracts === 2 && merged[1].date === 'd20');
  ok('one cut date across lists', familyCut([{ date: 'a' }, { date: 'b' }], [{ date: 'c' }], [{ date: 'a' }]) === 'c');
}
{
  const set = new Set(UNIVERSE);
  const rules = (title, theme) => new Set(linksFor({ title, theme }, set).map((l) => l.rule));
  ok('deadline wording is removed before rules read the text', withoutDeadlines('Will Trump raise tariffs before the end of 2026?').trim() === 'Will Trump raise tariffs before ?' && withoutDeadlines('Gold above $4,000 by year-end?') === 'Gold above $4,000 by ?');
  ok('"raise tariffs before the end of 2026" reads as higher tariffs, not eased', rules('Will Trump raise tariffs on China before the end of 2026?', 'policy').has('tariff-up') && !rules('Will Trump raise tariffs on China before the end of 2026?', 'policy').has('tariff-ease'));
  ok('"tariffs end by the end of March" still reads as eased', rules('Will tariffs on Canada end by the end of March?', 'policy').has('tariff-ease'));
  ok('"shutdown by year-end" is a shutdown; "shutdown ends" is not', rules('Government shutdown by year-end?', 'policy').has('shutdown') && rules('Will the shutdown last over 30 days?', 'policy').has('shutdown') && !rules('Will the government shutdown end before the end of November?', 'policy').has('shutdown'));
  ok('a gold card visa is not gold the metal', !rules('Will the Trump gold card launch in 2026?', 'policy').has('gold-up') && classifyTheme({ text: 'How many Trump gold cards will be sold?' }) !== 'commodities' && rules('Gold above $4,000 by the end of the year?', 'commodities').has('gold-up'));
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

// ---- time limits: a venue that hangs must not hold up the build ------------
{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hang = () => { let n = 0; const f = async (url, { timeoutMs } = {}) => { n += 1; await sleep(timeoutMs); throw new Error('The operation was aborted due to timeout'); }; f.count = () => n; return f; };
  // Every call times out: three per venue, then no more.
  const f1 = hang();
  const t1 = Date.now();
  const r1 = await updatePredictionState({ prior: null, nowMs: NOW, universe: UNIVERSE, chains: {}, fetchJson: f1, timeoutMs: 20, maxMs: 5000 });
  ok('a venue that never answers gets three calls, then none', f1.count() === 6);
  ok('the run says why it stopped early', /kalshi not answering/.test(r1.status.stopped) && /polymarket not answering/.test(r1.status.stopped));
  ok('hanging venues cost well under a second at a 20 ms timeout', Date.now() - t1 < 1500);
  // The same with tracked contracts: none dropped, no history fill given up.
  const base = await updatePredictionState({ prior: null, nowMs: NOW, universe: UNIVERSE, chains: {}, fetchJson: fakeFetch });
  const kept = Object.keys(base.state.contracts).length;
  const f2 = hang();
  const r2 = await updatePredictionState({ prior: base.state, nowMs: NOW + 3600000, universe: UNIVERSE, chains: {}, fetchJson: f2, timeoutMs: 20, maxMs: 5000 });
  ok('tracked contracts are all kept when both venues hang', kept > 0 && Object.keys(r2.state.contracts).length === kept);
  ok('a timeout never marks a history fill as given up', Object.values(r2.state.contracts).every((c) => !c.backfill?.partial || base.state.contracts[c.id]?.backfill?.partial));
  ok('prices stay on their last stored value', Object.values(r2.state.contracts).every((c) => c.last?.p === base.state.contracts[c.id]?.last?.p));
  // Slow but answering: the overall limit ends the reads.
  let n3 = 0;
  const slow = async () => { n3 += 1; await sleep(40); return { events: [], series: [], markets: [] }; };
  const t3 = Date.now();
  const r3 = await updatePredictionState({ prior: base.state, nowMs: NOW + 3600000, universe: UNIVERSE, chains: {}, fetchJson: slow, timeoutMs: 200, maxMs: 150, forceDiscover: true });
  ok('the overall time limit stops a slow run', r3.status.stopped === 'time limit' && Date.now() - t3 < 900 && n3 < 12);
  ok('the limit is shorter on a decision run and can be overridden', bakeMaxMs({ decisionRun: true, env: {} }) === BAKE_MAX_MS_DECISION && bakeMaxMs({ env: {} }) === BAKE_MAX_MS && BAKE_MAX_MS_DECISION < BAKE_MAX_MS && bakeMaxMs({ env: { PREDICTION_MAX_SECONDS: '30' } }) === 30000);
  // A 4xx is an answer: it never trips the breaker.
  let n4 = 0;
  const c4 = createClient({ fetchJson: async () => { n4 += 1; throw Object.assign(new Error('HTTP 404'), { status: 404 }); } });
  for (let i = 0; i < 6; i += 1) { try { await c4.get('https://gamma-api.polymarket.com/x'); } catch { /* expected */ } }
  ok('a 4xx answer does not stop calls to a venue', n4 === 6 && c4.stopped === null);
  // The limiter: never more than `concurrency` calls at once.
  let act = 0, peak = 0;
  const c5 = createClient({ fetchJson: async () => { act += 1; peak = Math.max(peak, act); await sleep(3); act -= 1; return {}; }, concurrency: 4 });
  await Promise.all(Array.from({ length: 40 }, (_, i) => c5.get(`https://gamma-api.polymarket.com/${i}`)));
  ok('never more than four calls run at once', peak === 4 && c5.active === 0);
}

// ---- rate limits and refused history reads (2026-11-16 builds) -------------
{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const K = 'https://api.elections.kalshi.com/trade-api/v2/markets';
  const tooFast = () => Object.assign(new Error('HTTP 429'), { status: 429, retryAfterMs: 5 });
  // One 429, then an answer: retried once after a pause, two calls counted.
  let n1 = 0;
  const c1 = createClient({ fetchJson: async () => { n1 += 1; if (n1 === 1) throw tooFast(); return { ok: 1 }; }, minGapMs: {} });
  const got = await c1.get(K);
  ok('a 429 is retried once and the answer is kept', got.ok === 1 && n1 === 2 && c1.calls === 2 && c1.rateLimited.kalshi === 1);
  // Always 429: each call tries twice, ends transient, and three in a row leave the venue alone.
  let n2 = 0;
  const c2 = createClient({ fetchJson: async () => { n2 += 1; throw tooFast(); }, minGapMs: {} });
  const errs = [];
  for (let i = 0; i < 5; i += 1) { try { await c2.get(K); } catch (e) { errs.push(e); } }
  ok('a second 429 is marked for a later bake, not a wrong request', errs[0].transient === true && errs[0].rateLimited === true);
  ok('three rate-limited calls in a row stop that venue for the bake', n2 === 6 && /kalshi rate limit/.test(c2.stopped) && errs[4].budget === true);
  // Pacing: Kalshi calls start at least the gap apart; Polymarket is not paced.
  const starts = [];
  const c3 = createClient({ fetchJson: async () => { starts.push(Date.now()); return {}; }, minGapMs: { kalshi: 40 } });
  await Promise.all([1, 2, 3].map(() => c3.get(K)));
  ok('calls to Kalshi start at least the gap apart', starts.length === 3 && starts[2] - starts[0] >= 75);
  // The default fetch keeps a short reason from a JSON error body and the Retry-After header.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: "invalid filters: 'startTs' and 'endTs' interval is too long" }), headers: { get: (h) => (h === 'retry-after' ? '2' : null) } });
  try {
    let e5 = null;
    try { await createClient().get('https://clob.polymarket.com/prices-history?market=x'); } catch (e) { e5 = e; }
    ok('an error names the venue reason', e5?.status === 400 && /HTTP 400 \(invalid filters/.test(e5.message) && e5.retryAfterMs === 2000);
    globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => '<!DOCTYPE html><html>blocked</html>', headers: { get: () => null } });
    try { await createClient().get('https://clob.polymarket.com/x'); } catch (e) { e5 = e; }
    ok('an HTML error page adds nothing to the message', e5?.message === 'HTTP 403');
  } finally { globalThis.fetch = realFetch; }
  await sleep(1);
  // A Polymarket range read refused with 400 falls back to one whole-history read.
  const dayS = 86400;
  const nowS = Math.floor(NOW / 1000);
  const prior = {
    version: 1, discoveredDate: etDate(NOW), candidates: [], venues: {}, consensus: { events: {}, settledCheck: {} },
    contracts: {
      'P:1': { id: 'P:1', venue: 'polymarket', marketId: '1', tokenId: 'tok1', status: 'open', theme: 'macro', title: 'Q', addedAt: new Date(NOW - 2 * DAY).toISOString(), openTime: new Date(NOW - 200 * DAY).toISOString(), last: { p: 0.5 } },
      'P:2': { id: 'P:2', venue: 'polymarket', marketId: '2', tokenId: 'tok2', status: 'open', theme: 'macro', title: 'R', addedAt: new Date(NOW - 9 * DAY).toISOString(), last: { p: 0.4 }, backfill: { done: true, partial: true, errors: 2, lastError: 'HTTP 429' } },
    },
  };
  const urls = [];
  const fetch6 = async (url) => {
    urls.push(url);
    if (/prices-history/.test(url)) {
      if (/interval=max/.test(url)) return { history: [{ t: nowS - 400 * dayS, p: 0.1 }, { t: nowS - 30 * dayS, p: 0.3 }, { t: nowS - 2 * dayS, p: 0.45 }] };
      throw Object.assign(new Error('HTTP 400'), { status: 400 });
    }
    if (/gamma-api/.test(url)) return [];
    return { events: [], markets: [], series: [] };
  };
  const r6 = await updatePredictionState({ prior, nowMs: NOW, universe: UNIVERSE, chains: {}, fetchJson: fetch6 });
  const c6 = r6.state.contracts['P:1'];
  ok('a refused range read falls back to one whole-history read', urls.some((u) => /tok1&interval=max&fidelity=1440/.test(u)) && c6.backfill?.done === true && c6.backfill.coarse === true && !c6.backfill.partial);
  ok('the whole-history read keeps only the last year', dailyAt(c6, etDate((nowS - 30 * dayS) * 1000 - 1000))?.p === 0.3 && !dailyAt(c6, etDate((nowS - 400 * dayS) * 1000 - 1000)));
  const c7 = r6.state.contracts['P:2'];
  ok('a fill given up on a rate limit gets one more go', urls.some((u) => /market=tok2/.test(u)) && c7.backfill?.retried === true && c7.backfill.done === true);
}

// ---- Kalshi discovery: core series first, a cut-short listing read again ----
{
  // The listing's second page is refused: discovery is tried again next build.
  const cutShort = (url) => {
    const u = new URL(url);
    if (u.hostname.includes('kalshi') && u.pathname.endsWith('/events') && u.searchParams.get('status') === 'open' && !u.searchParams.get('series_ticker')) {
      callLog.push(url);
      if (u.searchParams.get('cursor')) return Promise.reject(Object.assign(new Error('HTTP 400'), { status: 400 }));
      return Promise.resolve({ events: kalshiEvents, cursor: 'page2' });
    }
    return fakeFetch(url);
  };
  const before = callLog.length;
  const d1 = await updatePredictionState({ prior: null, nowMs: NOW, universe: UNIVERSE, chains: {}, fetchJson: cutShort });
  const calls = callLog.slice(before);
  const coreAt = calls.findIndex((u) => /series_ticker=KXFEDDECISION&status=open/.test(u));
  const listAt = calls.findIndex((u) => /\/events\?status=open/.test(u));
  ok('the core Kalshi series are read before the broad listing', coreAt >= 0 && listAt > coreAt);
  const fedIds = Object.keys(d1.state.contracts).filter((id) => id.startsWith('K:KXFEDDECISION-26DEC'));
  ok('an event found by both reads is kept once', fedIds.length === new Set(fedIds).size && fedIds.length >= 2);
  ok('a Kalshi listing cut short is not marked as read for the day', d1.state.discoveredDate !== etDate(NOW) && d1.state.discoveryTries?.n === 1);
  const d2 = await updatePredictionState({ prior: d1.state, nowMs: NOW + 3600000, universe: UNIVERSE, chains: {}, fetchJson: cutShort });
  const d3 = await updatePredictionState({ prior: d2.state, nowMs: NOW + 7200000, universe: UNIVERSE, chains: {}, fetchJson: cutShort });
  ok('after three tries in a day the cut-short listing stands', d2.state.discoveredDate !== etDate(NOW) && d3.state.discoveredDate === etDate(NOW + 7200000) && !d3.state.discoveryTries);
  const full = await updatePredictionState({ prior: null, nowMs: NOW, universe: UNIVERSE, chains: {}, fetchJson: fakeFetch });
  ok('a complete listing is read once a day', full.state.discoveredDate === etDate(NOW) && !full.state.discoveryTries);
  // The Fed decision is kept even when the Fed topic list is full.
  const busy = {};
  for (let i = 0; i < 12; i += 1) busy[`P:f${i}`] = { id: `P:f${i}`, venue: 'polymarket', theme: 'fed', status: 'open' };
  const sel = selectContracts(busy, [kalshiCandidates(kalshiEvents[0])], { universe: new Set(UNIVERSE), nowMs: NOW });
  ok('the Kalshi Fed decision is kept past a full Fed topic list', sel.added.some((id) => id.startsWith('K:KXFEDDECISION-')));
}

// ---- small-sample p-values --------------------------------------------------
{
  const near = (a, b, tol = 0.0006) => Math.abs(a - b) <= tol;
  ok('a correlation of 0.6 over 10 pairs reads p 0.067, not the normal tail 0.034', near(corrP(0.6, 10), 0.0667));
  ok('the t tail matches the table (2.228 on 10 df is 0.05)', near(tTwoSidedP(2.228, 10), 0.05));
  ok('with many pairs it meets the normal tail', near(tTwoSidedP(1.96, 1e6), 0.05));
  ok('no correlation reads p 1, and under four pairs reads none', near(corrP(0, 20), 1) && corrP(0.9, 3) === null);
}

// ---- audit 2026-11-16: gossip contracts, next-meeting Fed read -------------
{
  ok('a CEO affairs bet is dropped', classifyTheme({ text: 'Will 3 Jensen Huang affairs be reported by December 31?' }) === null);
  ok('a tracked affairs bet is flagged for removal', isExcludedContract({ title: 'Fourth Jensen Huang affair reported by December 31?', eventTitle: 'Jensen Huang affairs' }));
  ok('foreign affairs is not gossip', !isExcludedContract({ title: 'Will the Minister of Foreign Affairs of Japan resign in 2026?' }));
  // A search-ranking bet only names Google; it was linked to GOOGL (2026-11-20 audit).
  ok('a search-ranking bet is flagged for removal', isExcludedContract({ title: 'Will Lindsay Clancy be the #1 searched person on Google this year?' }));
  ok('a company bet that names Google stays', !isExcludedContract({ title: 'Will Google be fined by the EU in 2026?' }));
  const NOW2 = Date.parse('2026-11-16T21:00:00Z');
  const pm = (id, title, p, slug, close) => ({ id, venue: 'polymarket', theme: 'fed', status: 'open', title, eventSlug: slug, closeTime: close, last: { p } });
  const open = [
    pm('P:1', 'Will the Fed increase interest rates by 50+ bps after the December 2026 meeting?', 0.047, 'fed-dec', '2026-12-09T19:00:00Z'),
    pm('P:2', 'Will there be no change in Fed interest rates after the December 2026 meeting?', 0.031, 'fed-dec', '2026-12-09T19:00:00Z'),
    pm('P:3', 'Will the Fed increase interest rates by 25 bps after the December 2026 meeting?', 0.915, 'fed-dec', '2026-12-09T19:00:00Z'),
    pm('P:4', 'Will the Fed increase interest rates by 25 bps after the January 2027 meeting?', 0.625, 'fed-jan', '2027-01-28T19:00:00Z'),
    pm('P:5', 'Will the Fed Pause-Hike-Hike in the next three decisions (Oct-Dec-Jan)?', 0.63, 'fed-path', '2026-12-01T19:00:00Z'),
    pm('P:6', 'Will the Bank of Canada make no change to the target for the overnight rate at the December interest rate announcement?', 0.6, 'boc', '2026-12-08T19:00:00Z'),
  ];
  const f = fedNextDecision(open, NOW2);
  ok('Polymarket gives the next Fed meeting when Kalshi has none', f && f.venue === 'polymarket' && f.meeting === 'December 2026');
  ok('next-meeting hike sums the 25 and 50+ contracts', f && Math.abs(f.hike - 96.2) < 0.05 && Math.abs(f.hold - 3.1) < 0.05 && f.cut === 0);
  const kx = [{ id: 'K:KXFEDDECISION-26DEC-H25', venue: 'kalshi', theme: 'fed', status: 'open', series: 'KXFEDDECISION', eventTicker: 'KXFEDDECISION-26DEC', outcome: 'Hike 25bps', title: 'Fed decision', closeTime: '2026-12-09T19:00:00Z', last: { p: 0.9 } },
    { id: 'K:KXFEDDECISION-26DEC-C25', venue: 'kalshi', theme: 'fed', status: 'open', series: 'KXFEDDECISION', eventTicker: 'KXFEDDECISION-26DEC', outcome: 'Cut 25bps', title: 'Fed decision', closeTime: '2026-12-09T19:00:00Z', last: { p: 0.02 } }];
  const fk = fedNextDecision([...open, ...kx], NOW2);
  ok('Kalshi wins when its ladder is tracked', fk && fk.venue === 'kalshi' && fk.hike === 90 && fk.cut === 2);
  ok('no Fed contracts reads null', fedNextDecision([], NOW2) === null);
}

console.log(`prediction-smoke: ${passed} checks passed`);
