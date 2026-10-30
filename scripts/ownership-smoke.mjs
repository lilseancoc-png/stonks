import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ownershipExplorerFactory } from '../lib/ownership-explorer.mjs';
import { packOwnershipBooks, ownershipBookClientFactory } from '../lib/ownership-books.mjs';
import { buildOwnershipFund, parseOwnership13FXml } from '../lib/ownership-13f.mjs';
import { build13FPayload, buildPerFirm13FHoldings, fetchEdgar13FHoldings, findLatestTwo13Fs } from './build.mjs';
import { ownershipFixture, ownershipXml, ownershipCover, ownershipNow } from './fixtures/ownership.mjs';
import { renderAppJs } from './render/app-js.mjs';
import { isPremiumKey } from '../lib/premium-keys.mjs';
import { isBakeOwnedKey } from '../lib/data-ownership.mjs';

const { data, f, map, chains, raw } = ownershipFixture(), model = ownershipExplorerFactory();
const fund = data.perFirm['Atlas Capital'];
assert.equal(fund.holdings.filter(r => !r.isExit).length, 94, 'all holdings retained, beyond top 20');
assert.equal(model.positions(data, { query: 'Small unchanged 89' }).length, 1);
assert.equal(model.positions(data, { query: '$atls', type: 'stock' }).length, 2);
const shortTicker = { perFirm: { Test: { holdings: [{ ticker: 'A', name: 'Agilent', cusip: '1', type: 'stock', valueNow: 1 }, { ticker: 'B', name: 'Atlas', cusip: '2', type: 'stock', valueNow: 1 }] } } };
assert.equal(model.positions(shortTicker, { query: 'A' }).length, 1, 'known short tickers do not match every issuer name');
assert.equal(model.positions(data, { query: 'ATLS', type: 'call' })[0].sharesNow, 200);
assert.equal(model.positions(data, { query: 'unmapped &' })[0].type, 'principal');
assert.equal(model.positions(data, { query: '000000ZZ1' })[0].sharesNow, 25000);
assert.equal(model.positions(data, { query: 'EXIT' }).length, 0, 'exits are not current owners');
assert.equal(model.positions(data, { query: 'EXIT', status: 'all' })[0].sharesNow, 0);
assert.equal(model.positions(data, { query: 'EXIT', status: 'exited' })[0].shareChange, -100);
assert.equal(fund.holdings.find(r => r.type === 'stock' && r.ticker === 'ATLS').shareChange, 0, 'unchanged holdings kept');
assert.equal(fund.performance.pct, 25, 'constant prior stock weights, not change in reported value');
assert(Math.abs(fund.performance.coveragePct - 100 / 110 * 100) < 1e-8);
assert.equal(model.queryFunds(data, 'quant', 'aum', 'desc')[0].firm, 'Birch Partners');
assert.equal(model.queryFunds(data, '1', 'aum', 'desc')[0].firm, 'Atlas Capital');
assert.equal(model.queryFunds(data, '', 'performancePct', 'desc')[0].firm, 'Atlas Capital');
assert.equal(model.queryFunds(data, '', 'performancePct', 'asc')[0].firm, 'Birch Partners');
assert.equal(model.queryFunds(data, '', 'performancePct', 'asc').at(-1).firm, 'Missing Manager');
assert.equal(model.queryFunds(data, '', 'aum', 'desc')[0].aum, 50e9);
assert.equal(model.positions(data, { query: 'ATLS', sort: 'aum' })[0].firm, 'Birch Partners');
assert.equal(model.funds({ perFirm: { Old: { topBought: [{ ticker: 'FAKE' }] } } })[0].complete, false);
assert.equal(model.positions({ perFirm: { Old: { topBought: [{ ticker: 'FAKE' }] } } }).length, 0);

const missingPrior = buildOwnershipFund({ ...f, priorFetchOk: false }, map, chains);
assert.equal(missingPrior.comparable, false);
assert.equal(missingPrior.performance.pct, null);
assert(missingPrior.holdings.every(r => r.shareChange === null && !r.isNew && !r.isExit));
assert.equal(buildOwnershipFund({ ...f, latestFetchOk: false }, map), null);
assert.equal(buildOwnershipFund({ ...f, prior: null }, map, chains).performance.pct, null);
assert.equal(buildOwnershipFund(f, map, {}).performance.pct, null);
assert.equal(buildOwnershipFund(f, map, { ATLS: { ...chains.ATLS, fundamentals: { name: 'Different Issuer' } } }).performance.pct, null);
const splitChains = { ATLS: { ...chains.ATLS, priceSeries: [{ t: '2026-03-31', c: 50 }, { t: '2026-06-30', c: 62.5 }] } };
assert.equal(buildOwnershipFund(f, map, splitChains).performance.pct, 25, 'same adjusted basis handles split');
const duplicate = buildOwnershipFund({ ...f, latestDisclosures: raw([{ value: 100, shares: 1 }, { value: 200, shares: 2 }]) }, map, chains);
assert.equal(duplicate.holdings.find(r => !r.isExit).disclosures.length, 2);
assert.equal(duplicate.holdings.find(r => !r.isExit).sharesNow, 3);
const relabeled = buildOwnershipFund({ ...f, latestDisclosures: raw([{ cls: 'COMMON', value: 125000, shares: 1000 }]) }, map, chains);
assert.equal(relabeled.holdings.find(r => r.ticker === 'ATLS').isNew, false);
const parsed = parseOwnership13FXml(ownershipXml([{ value: 10, putCall: 'Call' }, { sharesType: 'PRN', cls: 'NOTE' }]), { filingDate: '2022-08-01' });
assert.equal(parsed[0].value, 10000, 'pre-2023 filings normalized from thousands');
assert.equal(parsed[0].votingSole, 900); assert.equal(parsed[0].votingShared, 0);
assert.equal(parsed[0].type, 'call'); assert.equal(parsed[1].type, 'principal');
assert.equal(parseOwnership13FXml('<infoTable><cusip>123</cusip><value>3</value></infoTable>')[0].shares, null);
const payload = build13FPayload({}, [], new Date(ownershipNow), { perFirm: data.perFirm, targetReportDate: '2026-06-30' });
assert.equal(payload.ownershipCoverage.fullFunds, 2);
assert.equal(payload.explorerVersion, 1);
assert.equal(payload.perFirm['Atlas Capital'].holdings.length, 95);
new vm.Script(renderAppJs({}));

const packed = packOwnershipBooks(data, 6000);
assert(!packed.payload.perFirm['Atlas Capital'].holdings, 'manifest holds metrics, not entire books');
for (const body of packed.parts.values()) assert(Buffer.byteLength(body) <= 6000);
for (const key of packed.parts.keys()) {
  assert.equal(isPremiumKey(key), false, 'new parts carry only public SEC disclosures');
  assert.equal(isBakeOwnedKey(key), true, 'full data build publishes every ownership part');
}
const reads = [], bookClient = ownershipBookClientFactory(async key => { reads.push(key); return JSON.parse(packed.parts.get(key)); });
const hydrated = await bookClient.hydrate(packed.payload);
assert.equal(model.positions(hydrated).length, model.positions(data).length);
assert(reads.every(key => key.includes('/summary-')), 'search does not fetch heavy source rows');
const matched = model.positions(hydrated, { query: 'ATLS', type: 'call' })[0];
const detailed = await bookClient.details(matched);
assert.equal(detailed.disclosures[0].putCall, 'CALL');
const count = reads.length; await bookClient.details(matched); assert.equal(reads.length, count, 'source parts cached');
const failedClient = ownershipBookClientFactory(async () => { throw new Error('Synthetic missing part'); });
const unavailable = await failedClient.hydrate(packed.payload);
assert.equal(unavailable.perFirm['Atlas Capital'].holdingsLoadFailed, true);
assert.equal(model.positions(unavailable).length, 0, 'missing part cannot become a complete partial book');
const corrupt = await ownershipBookClientFactory(async () => ({ version: 1, rows: [] })).hydrate(packed.payload);
assert.equal(corrupt.perFirm['Atlas Capital'].holdingsLoadFailed, true, 'valid JSON with lost rows is incomplete');
await assert.rejects(() => failedClient.details(matched), /Synthetic/);
await assert.rejects(() => failedClient.details({ disclosurePart: '../credentials.json' }), /Invalid ownership part/);
const large = packOwnershipBooks({ perFirm: { Large: { ...fund, holdings: Array.from({ length: 10000 }, (_, i) => ({ ...fund.holdings[0], cusip: String(i) })) } } });
assert(Buffer.byteLength(JSON.stringify(large.payload)) < 5000);
for (const body of large.parts.values()) assert(Buffer.byteLength(body) < 750000);

// The real EDGAR adapter, using synthetic HTTP documents. Additive amendments
// must preserve the original book; restatements must replace it.
const originalFetch = globalThis.fetch;
try {
  const originals = { form: '13F-HR', filingDate: '2026-08-10', reportDate: '2026-06-30', accessionNumber: '0000000001-26-000001', primaryDocument: 'primary_doc.xml' };
  const amendment = { ...originals, form: '13F-HR/A', filingDate: '2026-08-12', accessionNumber: '0000000001-26-000002', previousFilings: [originals] };
  let amendmentType = 'NEW HOLDINGS', failBase = false;
  globalThis.fetch = async url => {
    const isAmendment = String(url).includes('000000000126000002');
    if (failBase && !isAmendment) return new Response('', { status: 503 });
    if (String(url).endsWith('index.json')) return Response.json({ directory: { item: [{ name: 'infoTable.xml' }] } });
    if (String(url).endsWith('primary_doc.xml')) return new Response(ownershipCover([{ value: 100 }], { amendmentType: isAmendment ? amendmentType : '' }));
    return new Response(ownershipXml([{ cusip: isAmendment ? 'AMEND' : 'BASE', value: 100, shares: 1 }]));
  };
  let fetched = await fetchEdgar13FHoldings('1', amendment);
  assert.equal(fetched.ok, true); assert.deepEqual(fetched.disclosures.map(r => r.cusip), ['BASE', 'AMEND']);
  assert.match(fetched.disclosures[0].sourceUrl, /000000000126000001/);
  amendmentType = 'RESTATEMENT'; fetched = await fetchEdgar13FHoldings('1', amendment);
  assert.deepEqual(fetched.disclosures.map(r => r.cusip), ['AMEND']);
  amendmentType = 'NEW HOLDINGS'; failBase = true;
  assert.equal((await fetchEdgar13FHoldings('1', amendment)).ok, false, 'cannot call an incomplete additive book complete');
  const chosen = findLatestTwo13Fs({ filings: { recent: {
    form: ['13F-HR/A', '13F-HR', '13F-HR'], filingDate: ['2026-08-12', '2026-08-10', '2026-05-12'],
    reportDate: ['2026-06-30', '2026-06-30', '2026-03-31'], accessionNumber: ['b', 'a', 'c'], primaryDocument: ['p.xml', 'p.xml', 'p.xml'],
  } } }, '2026-06-30');
  assert.equal(chosen[0].previousFilings[0].accessionNumber, 'a');
  assert.equal(chosen[1].reportDate, '2026-03-31');
  // Exercise the actual collection -> complete book -> published payload path.
  // Reusing the prior ticker map also avoids any OpenFIGI request here.
  globalThis.fetch = async url => {
    const u = new URL(url);
    if (u.hostname === 'data.sec.gov') return Response.json({ filings: { recent: {
      form: ['13F-HR', '13F-HR'], filingDate: ['2026-08-12', '2026-05-12'],
      reportDate: ['2026-06-30', '2026-03-31'], accessionNumber: ['0000000001-26-000002', '0000000001-26-000001'], primaryDocument: ['primary_doc.xml', 'primary_doc.xml'],
    } } });
    assert.equal(u.hostname, 'www.sec.gov', 'cached CUSIPs do not need OpenFIGI');
    if (u.pathname.endsWith('index.json')) return Response.json({ directory: { item: [{ name: 'infoTable.xml' }] } });
    const current = u.pathname.includes('000000000126000002');
    const rows = [{ value: current ? 125000 : 100000, shares: 1000 }, { value: 20000, shares: 200, putCall: 'Call' }];
    if (u.pathname.endsWith('primary_doc.xml')) return new Response(ownershipCover(rows));
    return new Response(ownershipXml(rows));
  };
  const collected = await buildPerFirm13FHoldings(new Date(ownershipNow), { priorPayload: data, chains });
  assert.equal(Object.values(collected.perFirm).filter(f => f?.holdings?.length).length, 14);
  assert.equal(collected.perFirm['Bridgewater Associates'].holdings.length, 2);
  assert.equal(collected.perFirm['Bridgewater Associates'].performance.pct, 25);
  assert.equal(collected.perFirm['Bridgewater Associates'].topBought.length, 1, 'legacy stock deltas still available');
  assert.equal(build13FPayload({}, [], new Date(ownershipNow), collected).ownershipCoverage.fullFunds, 14);
} finally { globalThis.fetch = originalFetch; }
console.log('Ownership explorer checks passed: full books, stock/fund queries, null-safe sorts, raw disclosures, performance coverage, splits and amendments.');
