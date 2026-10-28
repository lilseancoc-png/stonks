// Leverage distress desk: forced-sale events, pledge stress, hot-fund 13F
// screen (zip reader, window planning, implied returns, flags, live move),
// leveraged ETF rebalance math and the cluster selloff shadow signal.
// Synthetic data only; no network.
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liquidationEventFacts, extractLiquidationFiling, collectLiquidationSec } from '../lib/forced-liquidation-sec.mjs';
import { buildForcedLiquidationPayload, pledgeStressScore, LIQUIDATION_EVIDENCE_VERSION } from '../lib/forced-liquidation.mjs';
import { rebalanceTrade, leveragedEtfRebalance, detectClusterSelloff, updateClusterLog, impliedQuarterReturn, bookStats, classifyBook, collapseBookRows,
  hotFundLevel, fundReturnSeries, estimateTopHoldingsMove, updateFundSnapshots, fundPressureState, issuerNameKey, parse13FInfoTableXml, sessionMove,
  LEVERAGE_DISTRESS_KEY, LEVERAGE_DISTRESS_STATE_KEY } from '../lib/leverage-distress.mjs';
import { parse13FDataSetLinks, planHotFundPass, neededPeriods, readZipDirectory, zipEntryStream, tsvRows, parseSecDmy, process13FWindow, selectBooks } from '../lib/hot-funds-sec.mjs';
import { refreshLeverageDistress } from './refresh-leverage-distress.mjs';
import { isPremiumKey, roleClaimForKey } from '../lib/premium-keys.mjs';
import { isBakeOwnedKey } from '../lib/data-ownership.mjs';
import { liquidationFixture, liquidationFixtureBase as b, liquidationFixtureNow as now, liquidationFixtureChain } from './fixtures/forced-liquidation.mjs';

let checks = 0;
const eq = (a, e, msg) => { assert.deepEqual(a, e, msg); checks++; };
const ok = (v, msg) => { assert(v, msg); checks++; };
const near = (a, e, tol, msg) => { assert(Math.abs(a - e) <= tol, `${msg}: ${a} vs ${e}`); checks++; };

// ---------------------------------------------------------------- events
eq(liquidationEventFacts('On October 2, 2026, the lender sold 1,250,000 shares pledged by Mr. Smith following a margin call.').eventType, 'margin-call');
eq(liquidationEventFacts('On October 2, 2026, the lender sold 1,250,000 shares pledged by Mr. Smith following a margin call.').sharesSold, 1250000);
eq(liquidationEventFacts('If the stock price declines, Mr. Smith could receive a margin call and the lender may sell the pledged shares.'), null, 'risk-factor wording is not an event');
eq(liquidationEventFacts('Mr. Smith has not received any margin call on the pledged shares.'), null, 'negated margin call is not an event');
eq(liquidationEventFacts('2,000,000 shares were sold by the pledgee pursuant to the loan agreement.').eventType, 'pledgee-sale');
eq(liquidationEventFacts('The bank foreclosed on 3,000,000 pledged shares of common stock on September 30, 2026.').eventType, 'foreclosure');
const eightK = '<html><body><p>Item 8.01 Other Events.</p><p>On October 20, 2026, Atlas Fabrication was informed that the lender to Anchor Holdings sold 4,000,000 shares of the Company’s common stock that had been pledged as collateral, following a margin call.</p></body></html>';
const filing = { form: '8-K', filingDate: '2026-10-21', accessionNumber: '0000000009-26-000001', url: 'https://www.sec.gov/Archives/edgar/data/9/000000000926000001/ex.htm', cik: '9' };
const ev = extractLiquidationFiling(eightK, filing, { symbol: 'ATLS', company: 'Atlas Fabrication', issuerVerified: true });
eq(ev[0].kind, 'liquidation-event'); eq(ev[0].eventType, 'margin-call'); eq(ev[0].sharesSold, 4000000);
const f144 = `<?xml version="1.0"?><edgarSubmission><formData><issuerInfo><issuerCik>0000000009</issuerCik><issuerName>Atlas Fabrication</issuerName><nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold>Big Bank NA as Pledgee</nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold></issuerInfo><securitiesInformation><noOfUnitsSold>500000</noOfUnitsSold><aggregateMarketValue>11000000</aggregateMarketValue><approxSaleDate>10/22/2026</approxSaleDate></securitiesInformation><securitiesToBeSold><natureOfAcquisitionTransaction>Shares acquired by pledgee upon foreclosure of pledge</natureOfAcquisitionTransaction></securitiesToBeSold></formData></edgarSubmission>`;
const ev144 = extractLiquidationFiling(f144, { ...filing, form: '144' }, { symbol: 'ATLS', company: 'Atlas Fabrication', issuerVerified: true });
eq(ev144.length, 1); eq(ev144[0].sharesSold, 500000); eq(ev144[0].saleValueUsd, 11000000); eq(ev144[0].asOfDate, '2026-10-22'); eq(ev144[0].borrower, 'Big Bank NA as Pledgee');
const plain144 = f144.replace(/Pledgee|pledgee|foreclosure of pledge/g, 'Officer');
eq(extractLiquidationFiling(plain144, { ...filing, form: '144' }, { symbol: 'ATLS', issuerVerified: true }).length, 0, 'an ordinary 144 sale notice is not an event');
const exhibitEvent = extractLiquidationFiling(eightK, { ...filing, exhibitOf: { accessionNumber: 'x' } }, { symbol: 'ATLS', issuerVerified: true });
eq(exhibitEvent.filter(r => r.kind === 'liquidation-event').length, 0, 'loan-agreement exhibits never produce events');

// Event rows rank first and feed pledge stress.
const fixture = liquidationFixture();
const eventObs = { ...ev[0], filingDate: '2026-10-21' };
const withEvent = buildForcedLiquidationPayload({ observations: [...fixture.observations, eventObs], chains: { ...fixture.chains }, coverage: fixture.coverage, builtAtIso: now });
eq(withEvent.rows[0].state, 'forced-sale-event'); eq(withEvent.summary.events, 1);
const atls = withEvent.rows.find(r => r.symbol === 'ATLS' && r.observation.kind === 'equity-pledge');
ok(atls.stress && atls.stress.parts.some(p => p.key === 'event' && p.points === 20), 'recent forced sale on the same stock adds to stress');
const old = buildForcedLiquidationPayload({ observations: [{ ...eventObs, filingDate: '2026-08-01' }], chains: fixture.chains, coverage: fixture.coverage, builtAtIso: now });
eq(old.rows[0].state, 'past-event');
eq(withEvent.rows.find(r => r.symbol === 'BOND').stress, null, 'corporate debt context has no pledge stress');

// Stress parts and bounds.
const stressRow = { pledge: { confirmed: true }, state: 'needs-terms', pledgedToAdvPct: 3000, pledgedToFloatPct: 12, distancePct: null };
const s1 = pledgeStressScore({ row: stressRow, price: { changeSinceDisclosurePct: -50, fromHighPct: -60 }, recentEvent: '2026-10-20' });
eq(s1.score, 100); eq(s1.band, 'high');
const s2 = pledgeStressScore({ row: { ...stressRow, pledgedToAdvPct: null, pledgedToFloatPct: null }, price: null });
eq(s2.score, 0); eq(s2.band, 'low'); eq(s2.missing.length, 4);
eq(pledgeStressScore({ row: { ...stressRow, state: 'released' } }), null);
const s3 = pledgeStressScore({ row: { ...stressRow, pledgedToAdvPct: 100, pledgedToFloatPct: 2 }, price: { changeSinceDisclosurePct: 10, fromHighPct: -10 } });
eq(s3.band, 'low', 'a rising stock with a small block scores low');

// Collection: new families are searched and off-universe hits are skipped
// before a document is read.
{
  const hits = { '144,144/A': [{ _id: '0000000009-26-000002:primary_doc.xml', _source: { adsh: '0000000009-26-000002', form: '144', file_date: '2026-10-22', ciks: ['0000000077', '0000000009'] } },
    { _id: '0000000055-26-000002:primary_doc.xml', _source: { adsh: '0000000055-26-000002', form: '144', file_date: '2026-10-22', ciks: ['0000000055'] } }] };
  const reads = [];
  const fetchImpl = async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('company_tickers.json')) return Response.json({ 0: { cik_str: 9, ticker: 'ATLS', title: 'Atlas Fabrication' }, 1: { cik_str: 55, ticker: 'OFFU', title: 'Off Universe' } });
    if (u.hostname === 'efts.sec.gov') return Response.json({ hits: { total: { value: (hits[u.searchParams.get('forms')] || []).length }, hits: hits[u.searchParams.get('forms')] || [] } });
    if (u.hostname === 'data.sec.gov') return Response.json({ filings: { recent: { form: [], filingDate: [], accessionNumber: [], primaryDocument: [] } } });
    reads.push(url); return new Response(f144);
  };
  const out = await collectLiquidationSec({ universe: ['ATLS'], now, fetchImpl, delayMs: 0 });
  eq(reads.length, 1, 'only the tracked company’s Form 144 is read');
  eq(out.observations.filter(r => r.kind === 'liquidation-event').length, 1);
  ok(out.coverage.forms.includes('144') && out.coverage.forms.includes('8-K'));
}

// ---------------------------------------------------------------- 13F math
const xml = `<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable"><infoTable><nameOfIssuer>ATLAS FABRICATION INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>000000AA1</cusip><value>1000000</value><shrsOrPrnAmt><sshPrnamt>10000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable><infoTable><nameOfIssuer>ATLAS FABRICATION INC</nameOfIssuer><titleOfClass>CALL</titleOfClass><cusip>000000AA1</cusip><value>500000</value><shrsOrPrnAmt><sshPrnamt>5000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><putCall>Call</putCall></infoTable><infoTable><nameOfIssuer>SOME BOND</nameOfIssuer><titleOfClass>NOTE</titleOfClass><cusip>000000BB1</cusip><value>900</value><shrsOrPrnAmt><sshPrnamt>900</sshPrnamt><sshPrnamtType>PRN</sshPrnamtType></shrsOrPrnAmt></infoTable></informationTable>`;
const parsed = parse13FInfoTableXml(xml);
eq(parsed.length, 2); eq(parsed[1].putCall, 'CALL');
const book = collapseBookRows([...parsed, { ...parsed[0] }]);
eq(book.find(r => !r.putCall).value, 2000000, 'split rows of one holding are combined');
const stats = bookStats(book);
eq(stats.stockValue, 2000000); eq(stats.callNotional, 500000); eq(stats.callPct, 25);
ok(classifyBook(stats).tells.includes('call-heavy'));
ok(classifyBook({ ...stats, callNotional: 3e6, putNotional: 2e6 }).hedged, 'large offsetting calls and puts read as a market-maker book');
const r = impliedQuarterReturn(book, { '000000AA1': 150 });
eq(r.stockPct, 50); eq(r.withOptionsPct, 62.5); eq(r.coverage, 1);
eq(impliedQuarterReturn(book, {}).stockPct, null);
eq(issuerNameKey('TAIWAN SEMICONDUCTOR MFG LTD'), issuerNameKey('Taiwan Semiconductor Manufacturing Co., Ltd.'));
eq(issuerNameKey('META PLATFORMS INC CL A'), issuerNameKey('Meta Platforms, Inc.'));
eq(parseSecDmy('31-DEC-2025'), '2025-12-31');

// Windows and planning.
const page = ['01dec2025-28feb2026', '01mar2026-31may2026', '01jun2026-31aug2026', '01sep2025-30nov2025', '01jan2024-31mar2024'].map(l => `<a href="/files/structureddata/data/form-13f-data-sets/${l}_form13f.zip">x</a>`).join('');
const windows = parse13FDataSetLinks(page);
eq(windows.map(w => w.period), ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30']);
eq(neededPeriods(windows), ['2025-12-31', '2026-03-31', '2026-06-30']);
eq(planHotFundPass({}, windows).period, '2026-06-30');

// Synthetic zipped windows. HOT doubles its main holding in Q1 and gains 30%
// in Q2 with calls; STEADY is flat; MM is an options-hedged book; BIG has too
// many rows to be a hot fund but counts in the benchmark.
function zip(files) {
  const locals = [], central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, data); central.push(ch, nameBuf); offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const dmy = iso => `${iso.slice(8)}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}`;
const PRICES = { '2025-12-31': { A: 100, B: 50, C: 20, N: 10 }, '2026-03-31': { A: 200, B: 50, C: 20, N: 10 }, '2026-06-30': { A: 260, B: 50, C: 20, N: 10 } };
const CUSIP = { A: '000000AA1', B: '000000BB2', C: '000000CC3', N: '000000NN4' };
function windowZip(period) {
  const p = PRICES[period], rows = [];
  const add = (acc, key, shares, putCall = '') => rows.push([acc, rows.length, key === 'A' ? 'ATLAS FABRICATION INC' : `ISSUER ${key}`, putCall ? putCall.toUpperCase() : 'COM', CUSIP[key], '', Math.round(shares * p[key]), shares, 'SH', putCall, 'SOLE', '', shares, 0, 0].join('\t'));
  const acc = c => `000000000${c}-26-00000${Object.keys(PRICES).indexOf(period)}`;
  add(acc(1), 'A', 30e6); add(acc(1), 'B', 1e6); add(acc(1), 'A', 5e6, 'Call');                      // HOT: $3B+ stock book
  add(acc(2), 'B', 70e6); add(acc(2), 'C', 10e6);                                                    // STEADY
  add(acc(3), 'C', 150e6); add(acc(3), 'C', 400e6, 'Call'); add(acc(3), 'C', 300e6, 'Put');          // MM
  for (let i = 0; i < 700; i++) add(acc(4), 'N', 1e6);                                               // BIG (700 rows)
  const header = 'ACCESSION_NUMBER\tINFOTABLE_SK\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tFIGI\tVALUE\tSSHPRNAMT\tSSHPRNAMTTYPE\tPUTCALL\tINVESTMENTDISCRETION\tOTHERMANAGER\tVOTING_AUTH_SOLE\tVOTING_AUTH_SHARED\tVOTING_AUTH_NONE';
  const subs = ['ACCESSION_NUMBER\tFILING_DATE\tSUBMISSIONTYPE\tCIK\tPERIODOFREPORT', ...[1, 2, 3, 4].map(c => [acc(c), dmy(period), '13F-HR', String(c).padStart(10, '0'), dmy(period)].join('\t'))].join('\n');
  const names = { 1: 'HOT CAPITAL LP', 2: 'STEADY ADVISORS LLC', 3: 'MARKET MAKER LLC', 4: 'BIG INDEX CO' };
  const cover = ['ACCESSION_NUMBER\tREPORTCALENDARORQUARTER\tISAMENDMENT\tAMENDMENTNO\tAMENDMENTTYPE\tCONFDENIEDEXPIRED\tDATEDENIEDEXPIRED\tDATEREPORTED\tREASONFORNONCONFIDENTIALITY\tFILINGMANAGER_NAME\tREPORTTYPE', ...[1, 2, 3, 4].map(c => [acc(c), dmy(period), 'N', '', '', '', '', '', '', names[c], '13F HOLDINGS REPORT'].join('\t'))].join('\n');
  const value = c => rows.filter(x => x.startsWith(acc(c))).reduce((t, x) => t + Number(x.split('\t')[6]), 0);
  const count = c => rows.filter(x => x.startsWith(acc(c))).length;
  const summary = ['ACCESSION_NUMBER\tOTHERINCLUDEDMANAGERSCOUNT\tTABLEENTRYTOTAL\tTABLEVALUETOTAL\tISCONFIDENTIALOMITTED', ...[1, 2, 3, 4].map(c => [acc(c), 0, count(c), value(c), 'N'].join('\t'))].join('\n');
  return zip({ 'SUBMISSION.tsv': subs, 'COVERPAGE.tsv': cover, 'SUMMARYPAGE.tsv': summary, 'INFOTABLE.tsv': [header, ...rows].join('\r\n') });
}
const dir = await mkdtemp(join(tmpdir(), 'lev-smoke-'));
try {
  const file = join(dir, 'w.zip');
  await writeFile(file, windowZip('2026-06-30'));
  const entries = await readZipDirectory(file);
  eq(entries.map(e => e.name), ['SUBMISSION.tsv', 'COVERPAGE.tsv', 'SUMMARYPAGE.tsv', 'INFOTABLE.tsv']);
  let n = 0; for await (const row of tsvRows(zipEntryStream(file, entries[3]))) { if (!n) eq(row.CUSIP, CUSIP.A); n++; }
  eq(n, 708, 'every info-table row streams out of the zip');
} finally { await rm(dir, { recursive: true, force: true }); }

// Amendment handling.
{
  const subs = [{ accession: 'a1', cik: '1', type: '13F-HR', filingDate: '2026-08-01', period: '2026-06-30' }, { accession: 'a2', cik: '1', type: '13F-HR/A', filingDate: '2026-08-05', period: '2026-06-30' }, { accession: 'a3', cik: '1', type: '13F-HR/A', filingDate: '2026-08-09', period: '2026-06-30' }];
  const covers = new Map([['a1', { name: 'X' }], ['a2', { isAmendment: true, amendmentType: 'NEW HOLDINGS' }], ['a3', { isAmendment: true, amendmentType: 'RESTATEMENT' }]]);
  eq(selectBooks(subs, covers, new Map(), '2026-06-30').get('1').accessions, ['a3'], 'a restatement replaces the original and earlier additions');
  covers.set('a3', { isAmendment: true, amendmentType: 'NEW HOLDINGS' });
  eq(selectBooks(subs, covers, new Map(), '2026-06-30').get('1').accessions, ['a1', 'a2', 'a3']);
}

// Full collection over three builds with a fake SEC and Yahoo.
const chain = (price, dates) => ({ spot: price, quoteAsOf: '2026-10-27T19:00:00Z', fundamentals: { name: 'Atlas Fabrication', floatShares: 200e6 },
  _bars: dates.map(([t, c]) => ({ t, c, v: 1e6 })) });
const atlasChain = chain(130, [['2025-12-31', 100], ['2026-03-31', 200], ['2026-06-30', 260], ['2026-10-26', 140], ['2026-10-27', 130]]);
const zips = Object.fromEntries(Object.keys(PRICES).map(p => [p, windowZip(p)]));
const secFetch = async url => {
  const u = new URL(url);
  if (u.pathname.includes('form-13f-data-sets') && !u.pathname.endsWith('.zip')) return new Response(page);
  const m = u.pathname.match(/(\d{2}[a-z]{3}\d{4})-(\d{2}[a-z]{3}\d{4})_form13f\.zip$/);
  if (m) { const w = windows.find(w => w.label === `${m[1]}-${m[2]}`); return new Response(zips[w.period] || 'missing', { status: zips[w.period] ? 200 : 404 }); }
  if (u.hostname === 'data.sec.gov') return Response.json({ filings: { recent: { form: ['SC 13D/A'], filingDate: ['2026-10-20'], accessionNumber: ['0000000001-26-000099'], primaryDocument: ['d.htm'], reportDate: [''] } } });
  return new Response('not found', { status: 404 });
};
const quoteClient = { quote: async syms => syms.map(s => ({ symbol: s, regularMarketPrice: 25, regularMarketTime: new Date('2026-10-27T19:00:00Z') })),
  quoteSummary: async sym => ({ summaryDetail: { totalAssets: sym === 'ATLL' ? 2e9 : 5e8 } }) };
let prior = null, priorState = null, out = null;
const builds = ['2026-10-27T19:30:00Z', '2026-10-27T19:40:00Z', '2026-10-27T19:50:00Z', '2026-10-27T20:00:00Z'];
for (const t of builds) {
  out = await refreshLeverageDistress({ prior, priorState, universe: ['ATLS'], chains: { ATLS: atlasChain }, now: t, fetchImpl: secFetch, quoteClient,
    cusipMapper: async cs => new Map(cs.map(c => [c, 'ISS' + c.slice(6, 8)])), levEtfSingles: { ATLS: { bull: { sym: 'ATLL', lev: 2 }, bear: { sym: 'ATLD', lev: -1 } } },
    directory: { 0: { ticker: 'ATLS', title: 'Atlas Fabrication Inc', cik_str: 9 } }, groupOf: () => 'Tech' });
  prior = out.payload; priorState = out.state;
}
const hf = out.payload.hotFunds;
eq(hf.latestPeriod, '2026-06-30');
eq(out.state.hotFunds.pendingPass, null, 'three windows read newest first finish in three builds');
eq(Object.keys(out.state.hotFunds.priceTables || {}).length, 0, 'no price table is kept once every return exists');
const hot = hf.funds.find(f => f.name === 'HOT CAPITAL LP');
ok(hot, 'the hot fund is flagged');
eq(hf.funds.some(f => f.name === 'MARKET MAKER LLC'), false, 'options-hedged books never alert');
eq(hf.funds.some(f => f.name === 'STEADY ADVISORS LLC'), false);
eq(hf.funds.some(f => f.name === 'BIG INDEX CO'), false, 'books with too many rows are not hot-fund candidates');
near(hot.quarters.find(q => q.period === '2026-03-31').stockPct, (30e6 * 200 + 1e6 * 50) / (30e6 * 100 + 1e6 * 50) * 100 - 100, 0.05, 'Q1 implied return');
ok(hot.ytd > 100 && hot.level === 'alert');
ok(hot.tells.includes('concentrated') && hot.tells.includes('few-positions'));
eq(hot.top[0].ticker, 'ATLS', 'the 13F CUSIP is tied to our stock by name and price');
ok(hot.topMovePct < -40, 'the live move since the 13F date uses our own quote');
eq(hot.pressure, 'deleveraging-risk');
eq(hot.recentFilings[0].form, 'SC 13D/A');
const link = hf.stockLinks.find(l => l.symbol === 'ATLS');
eq(link.funds >= 1, true); eq(link.pressureFunds, 1); eq(link.sharesHeld, 30e6); eq(link.pctFloat, 15);
ok(Number.isFinite(hf.benchmark.qoq));
ok(out.payload.rebalance.rows.length === 1 && out.payload.rebalance.rows[0].products.length === 2);
eq(out.payload.clusters.shadow, true);

// Live move and snapshots.
const top = [{ cusip: 'x', ticker: 'AAA', value: 1000, shares: 10, price: 100 }, { cusip: 'y', ticker: 'BBB', value: 1000, shares: 10, price: 100, putCall: 'PUT' }];
const mv = estimateTopHoldingsMove(top, { AAA: { price: 80, asOf: '2026-10-27T19:00:00Z' }, BBB: { price: 80, asOf: '2026-10-27T19:00:00Z' } }, '2026-10-27T20:00:00Z');
eq(mv.movePct, 0, 'a put offsets the same move in the stock');
const stale = estimateTopHoldingsMove(top, { AAA: { price: 80, asOf: '2026-10-01T19:00:00Z' } }, '2026-10-27T20:00:00Z');
eq(stale.movePct, null, 'stale quotes do not price a move');
let snaps = updateFundSnapshots([], { period: 'p', movePct: 10, now: '2026-10-20T20:00:00Z' });
snaps = updateFundSnapshots(snaps.snapshots, { period: 'p', movePct: -15, now: '2026-10-27T20:00:00Z' });
near(snaps.drawdownPct, (0.85 / 1.1 - 1) * 100, 0.01, 'drawdown from the window peak');
eq(fundPressureState(snaps.drawdownPct, -15), 'deleveraging-risk');
eq(fundPressureState(-5, -3), 'steady');
eq(updateFundSnapshots(snaps.snapshots, { period: 'new', movePct: 1, now: '2026-10-28T20:00:00Z' }).snapshots.length, 1, 'a new 13F resets the history');
eq(hotFundLevel({ ytd: 35, qoq: 5, coverage: 0.9 }, { reportedValue: 10, stockValue: 10 }, { hedged: false }).level, 'watch');
eq(hotFundLevel({ ytd: 35, qoq: 5, coverage: 0.5 }, { reportedValue: 10, stockValue: 10 }, { hedged: false }).level, null, 'thin price coverage cannot flag');
eq(hotFundLevel({ ytd: 10, qoq: 5, ytdWithOptions: 60, coverage: 0.9 }, { reportedValue: 100, stockValue: 10 }, { hedged: false }).level, null, 'a tiny stock book cannot carry an option-adjusted flag');

// ---------------------------------------------------------------- rebalance
eq(rebalanceTrade(2, 1e9, 5), 1e8); eq(rebalanceTrade(-1, 1e9, 5), 1e8); eq(rebalanceTrade(-2, 1e9, -5), -3e8); eq(rebalanceTrade(2, null, 5), null);
{
  const t = '2026-10-27T20:30:00Z';
  const c = { spot: 110, quoteAsOf: t, _bars: [...Array(25)].map((_, i) => ({ t: new Date(Date.UTC(2026, 8, 20 + i)).toISOString().slice(0, 10), c: 100, v: 1e6 })).filter(r => ![0, 6].includes(new Date(r.t).getUTCDay())).concat([{ t: '2026-10-27', c: 110, v: 3e6 }]) };
  const m = sessionMove(c, t);
  eq(m.closed, true); near(m.movePct, 10, 1e-9, 'closed session move');
  const rows = leveragedEtfRebalance({ singles: { ZZZ: { bull: { sym: 'ZZL', lev: 2 }, bear: { sym: 'ZZD', lev: -1 } } }, chains: { ZZZ: c }, aum: { ZZL: { aum: 1e9, asOf: t }, ZZD: { aum: 5e8, asOf: t } }, now: t });
  eq(rows[0].tradeUsd, 2e8 + 1e8); eq(rows[0].side, 'buy'); near(rows[0].pctOfAdv, 3e8 / 110 / 1e6 * 100, 0.01, 'rebalance as a share of daily volume');
}

// ---------------------------------------------------------------- clusters
{
  const t = '2026-10-27T20:30:00Z';
  const mk = (last, vol, earnings = null) => ({ spot: last, quoteAsOf: t, fundamentals: { nextEarningsDate: earnings },
    _bars: [...Array(30)].map((_, i) => new Date(Date.UTC(2026, 8, 25 + i)).toISOString().slice(0, 10)).filter(d => ![0, 6].includes(new Date(d).getUTCDay()) && d < '2026-10-27').map((d, i) => ({ t: d, c: 100 + (i % 2 ? 0.5 : -0.5), v: 1e6 })).concat([{ t: '2026-10-27', c: last, v: vol }]) });
  const chains = { AAA: mk(90, 4e6), BBB: mk(88, 5e6), CCC: mk(91, 3e6), DDD: mk(85, 6e6, '2026-10-27'), SPY: mk(99.6, 1e6), EEE: mk(99, 1e6) };
  const groups = { AAA: 'Tech', BBB: 'Health', CCC: 'Energy', DDD: 'Tech' };
  const res = detectClusterSelloff({ chains, universe: Object.keys(chains), now: t, groupOf: s => groups[s], hotFunds: [{ cik: '1', name: 'Hot', level: 'alert', universe: [{ symbol: 'AAA' }, { symbol: 'BBB' }] }] });
  eq(res.flagged, true); eq(res.names.map(n => n.symbol).sort(), ['AAA', 'BBB', 'CCC']);
  eq(res.names.some(n => n.symbol === 'DDD'), false, 'an earnings reaction is excluded');
  eq(res.commonHolders[0].held, ['AAA', 'BBB']);
  const marketDay = detectClusterSelloff({ chains: { ...chains, SPY: mk(96, 1e6) }, universe: Object.keys(chains), now: t, groupOf: s => groups[s] });
  eq(marketDay.flagged, false, 'a falling index is a market move, not a cluster');
  const log = updateClusterLog(updateClusterLog([], res), { ...res, flagged: false });
  eq(log.length, 1); eq(log[0].flagged, false, 'one row per day; the latest run wins');
}

// ---------------------------------------------------------------- access
for (const key of [LEVERAGE_DISTRESS_KEY, LEVERAGE_DISTRESS_STATE_KEY]) { eq(isPremiumKey(key), true); eq(roleClaimForKey(key), ['tr', 'tp']); eq(isBakeOwnedKey(key), true); }

console.log(`Leverage distress desk: ${checks} checks passed (forced-sale events, pledge stress, 13F hot funds, ETF rebalance, cluster selloffs, access).`);
