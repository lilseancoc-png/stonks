// 13F ticker labels (QC of builds #123-#172). Lookups before #722 asked
// OpenFIGI for every listing of a CUSIP and kept the first, often a Frankfurt
// or Mexico City code: Target showed as DYH, Morgan Stanley as DWD, Citigroup
// as TRVC. #722 limited new lookups to US listings but reused the saved map
// forever, so those codes never healed and the stock pages for TGT, MS, C,
// GLD and QQQ found no fund moves. Also checks that the 13F page no longer
// copies the Owner-only Market themes. No network.
import assert from 'node:assert/strict';
import { buildPerFirm13FHoldings, build13FPayload, mergeF13CusipMaps, relabelF13Rows } from './build.mjs';
import { ownershipFixture } from './fixtures/ownership.mjs';
import { publicDataPayload } from '../lib/public-data-policy.mjs';
import { OWNER_UI_SELECTORS } from '../lib/owner-access-policy.mjs';
import { renderAppJs } from './render/app-js.mjs';

const TGT = '87612E106', MS = '617446448', C = '172967424', NRG = '629377508', HOLX = '436440101', AAPL = '037833100', MSFT = '594918104';
const fresh = (entries, answered) => Object.assign(new Map(entries), { answeredCusips: new Set(answered) });

// 1. A payload saved before the US-only map: every ticker waits for a US lookup.
const legacy = { perFirm: { A: { collectedAtIso: '2026-11-06T21:12:39Z', topSold: [
  { cusip: TGT, ticker: 'DYH' }, { cusip: NRG, ticker: 'NRA' }, { cusip: HOLX, ticker: 'HO1' }, { cusip: AAPL, ticker: 'AAPL' },
] } } };
assert.equal(mergeF13CusipMaps(legacy).trusted.size, 0, 'nothing saved before the US-only map is trusted');
let out = mergeF13CusipMaps(legacy, fresh([[NRG, 'NRG']], [NRG, HOLX]));
assert.equal(out.map.get(TGT), 'TGT', 'a verified override beats the saved code');
assert.equal(out.map.get(NRG), 'NRG', 'a US answer replaces the Frankfurt code');
assert.equal(out.map.has(HOLX), false, 'an answer with no US listing drops the foreign code');
assert.equal(out.map.get(AAPL), 'AAPL', 'a CUSIP whose lookup did not run keeps its label for now');
assert.deepEqual(out.recheck, [AAPL], 'and is looked up again next build');

// 2. After the switch: books collected since then are trusted, older retained
// books and recheck CUSIPs are not.
const since = '2026-11-09T15:00:00.000Z';
const v2 = { cusipMapVersion: 2, cusipMapSinceIso: since, cusipRecheck: [AAPL], perFirm: {
  Fresh: { collectedAtIso: '2026-11-09T16:00:00.000Z', holdings: [{ cusip: AAPL, ticker: 'AAPL' }, { cusip: MSFT, ticker: 'MSFT' }, { cusip: NRG, ticker: 'NRG' }] },
  Retained: { collectedAtIso: '2026-11-06T20:32:57.001Z', topSold: [{ cusip: C, ticker: 'TRVC' }, { cusip: NRG, ticker: 'NRA' }] },
} };
out = mergeF13CusipMaps(v2);
assert.deepEqual([...out.trusted.keys()].sort(), [MSFT, NRG].sort());
assert.equal(out.trusted.get(NRG), 'NRG', 'a current book wins over an older retained one');
assert.equal(out.sinceIso, since);
out = mergeF13CusipMaps(v2, fresh([], []));
assert.equal(out.map.get(C), 'C');
assert.deepEqual(out.recheck, [AAPL]);
assert.equal(mergeF13CusipMaps({ ...v2, cusipMapVersion: 1 }).trusted.size, 0, 'an old version is never trusted');

// 3. Retained change tables take the current labels.
const map = new Map([[MS, 'MS']]);
assert.deepEqual(relabelF13Rows([{ cusip: MS, ticker: 'DWD' }, { cusip: HOLX, ticker: 'HO1' }, { cusip: 'X', ticker: null }], map),
  [{ cusip: MS, ticker: 'MS' }, { cusip: HOLX, ticker: null }, { cusip: 'X', ticker: null }]);

// 4. End to end: SEC is down, so the book is retained. Its change tables take
// the overrides, its other old labels wait on the recheck list, and the result
// records the switch.
const { data } = ownershipFixture();
const atlas = data.perFirm['Atlas Capital'];
const cached = { ...data, perFirm: { 'Bridgewater Associates': { ...atlas, firm: 'Bridgewater Associates', cik: '1350694',
  topSold: [{ cusip: MS, ticker: 'DWD', name: 'Morgan Stanley', valueChange: -5 }, { cusip: '000000AA1', ticker: 'ATLS', name: 'Atlas Fabrication Inc', valueChange: -1 }] } } };
const asked = [];
const savedFetch = globalThis.fetch;
let result;
try {
  globalThis.fetch = async () => new Response('', { status: 503 });
  result = await buildPerFirm13FHoldings(new Date(data.builtAtIso), { priorPayload: cached,
    cusipMapper: async cusips => { asked.push(...cusips); return fresh([], cusips); } });
} finally { globalThis.fetch = savedFetch; }
const bw = result.perFirm['Bridgewater Associates'];
assert.equal(bw.collectionStatus, 'retained');
assert.equal(bw.topSold.find(r => r.cusip === MS).ticker, 'MS', 'the Morgan Stanley stock page can find this fund again');
assert.equal(bw.topSold.find(r => r.cusip === '000000AA1').ticker, 'ATLS', 'a label whose lookup has not run stays');
assert.equal(asked.length, 0, 'a retained book is not looked up until its filing is collected again');
assert.equal(result.cusipMapVersion, 2);
assert.equal(result.cusipMapSinceIso, new Date(data.builtAtIso).toISOString());
assert(result.cusipRecheck.includes('000000AA1'), 'its old labels wait on the recheck list');
assert.equal(result.cusipRecheck.includes(MS), false, 'an override needs no lookup');
const payload = build13FPayload({}, [{ name: 'GLP-1 Obesity Wave', sentiment: 'bullish', longs: ['LLY'] }], new Date(data.builtAtIso), result);
assert.equal(payload.cusipMapVersion, 2);
assert.equal(payload.cusipMapSinceIso, result.cusipMapSinceIso);
assert.equal(build13FPayload({}, [], new Date(data.builtAtIso), { perFirm: {} }).cusipMapVersion, 1, 'a retained payload keeps its old status');

// 5. Market themes stay off the public 13F page.
assert.equal('mostBought' in payload || 'mostSold' in payload, false, 'the 13F payload no longer copies Market themes');
const stored = publicDataPayload('13f.json', { period: 'Q2 2026', mostBought: ['GLP-1 Obesity Wave — accumulation in LLY, NVO'], mostSold: ['Certain legacy holdings or high-valuation names.'] });
assert.equal(stored.mostBought, undefined, 'a stored copy is hidden from the public at once');
assert.equal(stored.mostSold, undefined);
assert.equal(stored.period, 'Q2 2026');
assert.equal(renderAppJs().includes('Curated filing themes'), false);
assert(OWNER_UI_SELECTORS.includes('[data-f13-tab="narratives"]'), 'the Open Narratives button is Owner-only');

console.log('f13 ticker mapping smoke ok');
