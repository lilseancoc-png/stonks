// Regression cases found by the collection/publication/UI audit. No network.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expandOwnershipSubmissions, ownershipPrimaryUrl, createOwnershipSecReader } from '../lib/ownership-sec.mjs';
import { ownershipExplorerFactory } from '../lib/ownership-explorer.mjs';
import { parseOwnershipCover, validateOwnershipTable, prioritizeOwnershipCusips } from '../lib/ownership-13f.mjs';
import { packOwnershipBooks, ownershipBookClientFactory, retainOwnershipBooks } from '../lib/ownership-books.mjs';
import { findLatestTwo13Fs, fetchEdgar13FHoldings, write13FFile, buildPerFirm13FHoldings, F13_FIRM_DIRECTORY, currentF13Quarter } from './build.mjs';
import { ownershipFixture, ownershipXml, ownershipCover } from './fixtures/ownership.mjs';

const { data, f } = ownershipFixture();
const model = ownershipExplorerFactory();
assert.equal(F13_FIRM_DIRECTORY.find(f => f.firm === 'Viking Global Investors').cik, '1103804');
assert.equal(currentF13Quarter(new Date('2026-11-16T23:00:00Z')).periodEndIso, '2026-06-30', 'weekend extension and the whole deadline day remain in the prior completed window');
assert.equal(currentF13Quarter(new Date('2026-11-17T05:01:00Z')).periodEndIso, '2026-09-30');
assert.equal(currentF13Quarter(new Date('2026-02-17T23:00:00Z')).periodEndIso, '2025-09-30', 'Presidents Day extends the February filing deadline');
assert.equal(currentF13Quarter(new Date('2026-02-18T05:01:00Z')).periodEndIso, '2025-12-31');
const current = { form: ['13F-HR'], filingDate: ['2026-08-14'], reportDate: ['2026-06-30'], accessionNumber: ['0000000001-26-000002'], primaryDocument: ['xslForm13F_X02/primary_doc.xml'] };
const archived = { form: ['13F-HR'], filingDate: ['2026-05-15'], reportDate: ['2026-03-31'], accessionNumber: ['0000000001-26-000001'], primaryDocument: ['primary_doc.xml'] };
const subs = { filings: { recent: current, files: [{ name: 'CIK0000000001-submissions-001.json', filingTo: '2026-05-15' }] } };
const expanded = await expandOwnershipSubmissions(subs, '2026-06-30', async () => archived);
assert.equal(findLatestTwo13Fs(expanded, '2026-06-30').length, 2);
const incomplete = await expandOwnershipSubmissions(subs, '2026-06-30', async () => { throw new Error('Archive offline'); });
assert.equal(incomplete.historyComplete, false);
assert(!ownershipPrimaryUrl('1', findLatestTwo13Fs(expanded)[0]).includes('xslForm'));
assert.deepEqual(prioritizeOwnershipCusips(new Map([['big', 100], ['small', 1]]), { big: '2026-10-28' }), ['small', 'big'], 'unmapped failures cannot starve never-attempted identifiers');
assert.throws(() => validateOwnershipTable([], parseOwnershipCover(ownershipCover([{ value: 100 }]), '2026-08-14')), /rows/);
const insiderData = { ...data, insiderTransactions: { transactions: [{ symbol: 'A', price: 0.4 }, { symbol: 'ATLS', price: 12.49 }, { symbol: 'TSLA', price: 10 }] } };
assert.deepEqual(model.insiders(insiderData, '$A').map(r => r.symbol), ['A']);
assert.deepEqual(model.insiders(insiderData, 'Atlas Fabrication').map(r => r.symbol), ['ATLS']);
assert.deepEqual(model.insiders(insiderData, '000000AA1').map(r => r.symbol), ['ATLS']);
assert.equal(model.valid({}), false);

const packed = packOwnershipBooks(data, 6000);
let corrupt = true;
const client = ownershipBookClientFactory(async key => corrupt ? { version: 1, rows: [] } : JSON.parse(packed.parts.get(key)));
assert.equal((await client.hydrate(packed.payload)).perFirm['Atlas Capital'].holdingsLoadFailed, true);
corrupt = false;
assert.equal((await client.hydrate(packed.payload)).perFirm['Atlas Capital'].holdings.length, 95, 'retry refetches corrupt-but-valid JSON');
const start = Date.now();
const hung = ownershipBookClientFactory(async () => new Promise(() => {}), { readTimeoutMs: 15, hydrateTimeoutMs: 25 });
assert.equal((await hung.hydrate(packed.payload)).perFirm['Atlas Capital'].holdingsLoadFailed, true);
assert(Date.now() - start < 250, 'whole-book deadline bounds queued hung requests');

const dir = await mkdtemp(resolve(tmpdir(), 'ownership-rollover-'));
try {
  // Publish, pre-read before wipe, and publish again with a retained same-period
  // book. The actual writer must preserve both summary and source bytes.
  await write13FFile({}, [], data.builtAtIso, { perFirm: data.perFirm, targetReportDate: data.periodEndIso }, { dataDir: dir });
  const prior = JSON.parse(await readFile(resolve(dir, '13f.json'), 'utf8'));
  const retained = await retainOwnershipBooks(prior, key => readFile(resolve(dir, key), 'utf8'), new Date(data.builtAtIso));
  await rm(dir, { recursive: true });
  await write13FFile({}, [], data.builtAtIso, { perFirm: retained.payload.perFirm, targetReportDate: data.periodEndIso }, { dataDir: dir, retainedParts: retained.parts });
  const root = JSON.parse(await readFile(resolve(dir, '13f.json'), 'utf8'));
  const restoredClient = ownershipBookClientFactory(async key => JSON.parse(await readFile(resolve(dir, key), 'utf8')));
  const restored = await restoredClient.hydrate(root);
  assert.equal(restored.perFirm['Atlas Capital'].holdings.length, 95);
  assert.equal((await restoredClient.details(restored.perFirm['Atlas Capital'].holdings[0])).disclosures.length, 1);
} finally { await rm(dir, { recursive: true, force: true }); }

const savedFetch = globalThis.fetch;
try {
  const latest = { ...f.latest, primaryDocument: 'xslForm13F_X02/primary_doc.xml' };
  const cancelled = new AbortController(); cancelled.abort();
  let cancelledReads = 0;
  globalThis.fetch = async () => { cancelledReads++; return new Response(''); };
  assert.equal((await fetchEdgar13FHoldings('1', latest, { signal: cancelled.signal })).ok, false);
  assert.equal(cancelledReads, 0, 'a cancelled manager cannot continue issuing SEC requests');
  const rows = [{ cusip: 'FIRST', value: 100 }, { cusip: 'SECOND', value: 200 }];
  let badCover = false;
  globalThis.fetch = async url => {
    assert(!String(url).includes('xslForm'), 'read raw XML rather than the styled HTML document');
    if (String(url).endsWith('primary_doc.xml')) return new Response(ownershipCover(badCover ? rows.slice(0, 1) : rows));
    if (String(url).endsWith('index.json')) return Response.json({ directory: { item: [{ name: 'table1.xml' }, { name: 'table2.xml' }] } });
    return new Response(ownershipXml([String(url).endsWith('table1.xml') ? rows[0] : rows[1]]));
  };
  assert.equal((await fetchEdgar13FHoldings('1', latest)).disclosures.length, 2, 'all information tables are retained');
  badCover = true;
  assert.equal((await fetchEdgar13FHoldings('1', latest)).ok, false, 'cover mismatch cannot be labeled complete');
  // A source outage keeps an intact same-quarter book with its original date.
  globalThis.fetch = async () => new Response('', { status: 503 });
  const cached = { ...data, perFirm: { 'Bridgewater Associates': { ...data.perFirm['Atlas Capital'], firm: 'Bridgewater Associates', cik: '1350694' } } };
  const out = await buildPerFirm13FHoldings(new Date(data.builtAtIso), { priorPayload: cached, cusipMapper: async () => new Map() });
  assert.equal(out.perFirm['Bridgewater Associates'].collectionStatus, 'retained');
  assert.equal(out.perFirm['Bridgewater Associates'].collectedAtIso, data.builtAtIso);
} finally { globalThis.fetch = savedFetch; }

const starts = [], paced = createOwnershipSecReader({ spacingMs: 8, fetchImpl: async () => { starts.push(Date.now()); return Response.json({}); } });
await Promise.all(Array.from({ length: 4 }, () => paced('https://data.sec.gov/test')));
assert(starts[3] - starts[0] >= 15, 'concurrent manager reads are paced');
console.log('Ownership audit regressions passed: archive history, raw XML, totals, mapping rotation, source retention, timeouts, retries, exact insider search and publication rollover.');
