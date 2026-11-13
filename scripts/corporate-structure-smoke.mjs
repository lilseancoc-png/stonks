// Offline checks for the stock page's Leadership data (lib/corporate-structure/).
// Run: node scripts/corporate-structure-smoke.mjs
import assert from 'node:assert/strict';
import { parseOwnershipXml, samePerson, prettySecName, shareClassOf, parseDisplayName, parseEftsHits, officerTitle, prettyCompanyName, isEntityName, matchScore, foldName, tidyPersonName } from '../lib/corporate-structure/forms.mjs';
import { foldFiling, holdingTotals } from '../lib/corporate-structure/holdings.mjs';
import { htmlToText, sliceProxy, slice20F, checkProxyFacts, hasInteger, hasPercent, hasName, PROXY_SCHEMA, extractProxyFacts, refersToAnnualReport, parseFilingIndex, annualReportExhibit, sliceAnnualReport, salvageJson, BOARD_ROLES } from '../lib/corporate-structure/proxy.mjs';
import { refreshCorporateStructure, readSubmissions, chooseFilings } from '../lib/corporate-structure/collector.mjs';
import { buildCorporateViews, buildCompanyView, voteMath, shareClasses, tidyTitle, companyKey, crossCheckCovered, isoDate } from '../lib/corporate-structure/assemble.mjs';
import { insiderFromStructure } from '../lib/shadow-signals.mjs';
import { form4Xml, fakeSec, fakeAi, TECH_CIK, SOCIAL_CIK, TECH_PROXY_HTML, TECH_PROXY_AI, SOCIAL_PROXY_AI } from './fixtures/corporate-structure.mjs';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

// --- names --------------------------------------------------------------------
ok(samePerson('COOK TIMOTHY D', 'Tim Cook'), 'nickname Tim = Timothy');
ok(samePerson('Ternus John', 'John Ternus'), 'plain match');
ok(samePerson("O'BRIEN DEIRDRE", "Deirdre O'Brien"), 'apostrophe last name');
ok(samePerson('LEVINSON ARTHUR D', 'Arthur D. Levinson, Ph.D.'), 'suffix ignored');
ok(!samePerson('COOK TIMOTHY D', 'Tom Cook'), 'different first name');
ok(!samePerson('SMITH JOHN', 'John Smithers'), 'different last name');
ok(samePerson('ZUCKERBERG MARK', 'Mark Zuckerberg'), 'simple');
assert.equal(prettySecName('COOK TIMOTHY D'), 'Timothy D. Cook'); n++;
assert.equal(prettySecName("O'BRIEN DEIRDRE"), "Deirdre O'Brien"); n++;
assert.equal(prettySecName('SoftBank Group Corp.'), 'Softbank Group Corp.'); n++;
assert.equal(shareClassOf('Class A Common Stock'), 'A'); n++;
assert.equal(shareClassOf('Class C Capital Stock'), 'C'); n++;
assert.equal(shareClassOf('Common Stock, $0.00001 par value'), 'common'); n++;
assert.equal(shareClassOf('American Depositary Shares'), 'ADS'); n++;
assert.deepEqual(parseDisplayName('Apple Inc.  (AAPL)  (CIK 0000320193)'), { name: 'Apple Inc.', ticker: 'AAPL', cik: '0000320193' }); n++;
assert.deepEqual(parseDisplayName('COOK TIMOTHY D  (CIK 0001214156)'), { name: 'COOK TIMOTHY D', ticker: null, cik: '0001214156' }); n++;
assert.throws(() => parseEftsHits({ nope: 1 })); n++;

// --- Form 4 parsing and folding ------------------------------------------------
const xml = form4Xml({ issuerCik: TECH_CIK, ownerCik: '0002000001', ownerName: 'Example Ada', director: true, officer: true, title: 'CEO',
  rows: [{ date: '2026-10-01', code: 'M', shares: 50000, ad: 'A', post: 120000, di: 'I', nature: 'By Trust' }, { date: '2026-10-02', code: 'S', shares: 20000, price: 300.5, ad: 'D', post: 100000, di: 'I', nature: 'By Trust' }],
  holdings: [{ post: 25000, di: 'D' }] });
const parsed = parseOwnershipXml(xml);
ok(parsed && parsed.owners[0].title === 'CEO' && parsed.owners[0].director && parsed.owners[0].officer, 'roles parsed');
ok(parsed.rows.length === 3 && parsed.rows[1].price === 300.5 && parsed.rows[0].price === null, 'rows parsed, footnoted price is null');
ok(parsed.rows[0].natureNote === "Held by the Reporting Person's family trust.", 'nature footnote resolved');
ok(parseOwnershipXml('<html>not a filing</html>') === null, 'non-filing returns null');
const co = { owners: {} };
foldFiling(co, parsed, { acc: 'A1', filed: '2026-10-05', form: '4' });
let t = holdingTotals(co.owners['0002000001']);
ok(t.total === 125000 && t.indirect === 100000 && t.direct === 25000, 'latest trust line + direct holding');
// An older Form 3 read afterwards must not overwrite newer lines or roles.
const f3 = parseOwnershipXml(form4Xml({ issuerCik: TECH_CIK, form: '3', ownerCik: '0002000001', ownerName: 'Example Ada', officer: true, title: 'SVP Hardware', holdings: [{ post: 70000, di: 'I', nature: 'By Trust' }] }));
foldFiling(co, f3, { acc: 'A0', filed: '2026-09-01', form: '3' });
t = holdingTotals(co.owners['0002000001']);
ok(t.total === 125000, 'older filing does not overwrite newer holdings');
ok(co.owners['0002000001'].roles.title === 'CEO' && co.owners['0002000001'].form3 === '2026-09-01', 'role stays newest; form 3 date kept');
ok(co.owners['0002000001'].tx.length === 2 && co.owners['0002000001'].tx[0].code === 'S', 'transactions newest first');

// --- proxy text and the fact checker -------------------------------------------
const text = htmlToText(TECH_PROXY_HTML);
ok(/Ada Example \| 1,250,000 \| \*/.test(text), 'table cells kept apart');
ok(hasInteger(text.toLowerCase(), 82500000) && !hasInteger(text.toLowerCase(), 999999), 'integer check');
ok(hasPercent(text, 8.25) && hasPercent(text, 0.19) && !hasPercent(text, 8.2), 'percent check is exact');
ok(hasName(text.toLowerCase(), 'Grace Holder') && !hasName(text.toLowerCase(), 'Phantom Person'), 'name check');
const checked = checkProxyFacts(TECH_PROXY_AI, text);
ok(checked.facts.board.length === 3 && !checked.facts.board.some((d) => d.name === 'Phantom Person'), 'invented director dropped');
const rs = checked.facts.owners.find((o) => o.name === 'Robert Sample');
ok(!rs, 'a share count the filing never prints is dropped (row with nothing left is removed)');
ok(checked.dropped.some((d) => /Phantom/.test(d)) && checked.dropped.some((d) => /shares Robert Sample/.test(d)), 'drops are listed');
ok(checked.facts.board.find((d) => d.name === 'Robert Sample').otherBoards[0].company === 'Other Motors Inc.', 'other board kept');
const big = 'x'.repeat(200_000) + ' Security Ownership of Certain Beneficial Owners ' + 'y'.repeat(50_000);
ok(sliceProxy(big).length <= 170_100 && sliceProxy(big).includes('Security Ownership'), 'long proxy sliced around the sections');
const twentyF = 'Item 6. Directors, Senior Management and Employees ... Item 8. Financial Information TOC ' + 'z'.repeat(1000) + ' ITEM 6. DIRECTORS, SENIOR MANAGEMENT AND EMPLOYEES real section ' + 'w'.repeat(5000) + ' ITEM 8. FINANCIAL INFORMATION';
ok(slice20F(twentyF).startsWith('ITEM 6. DIRECTORS') && slice20F(twentyF).includes('real section'), '20-F slices the real Item 6');

// --- vote math ---------------------------------------------------------------------
const classes = shareClasses(SOCIAL_PROXY_AI, null);
const vm = voteMath({ A: 1000000, B: 300000000 }, classes);
ok(Math.abs(vm.pctVoting - (3001000000 / (2200000000 + 3400000000)) * 100) < 1e-9, 'dual-class voting power');
ok(Math.abs(vm.pctEconomic - (301000000 / 2540000000) * 100) < 1e-9, 'economic share across classes');
ok(voteMath({ common: 10 }, shareClasses(null, 1000)).pctVoting === 1, 'one class from the quote');
// A non-voting class with no count: votes still add up, the share of the
// company does not (it would be overstated).
const abc = [{ key: 'A', votes: 1, outstanding: 5800 }, { key: 'B', votes: 10, outstanding: 840 }, { key: 'C', votes: 0, outstanding: null }];
const vmc = voteMath({ B: 389 }, abc);
ok(Math.abs(vmc.pctVoting - (3890 / (5800 + 8400)) * 100) < 1e-9 && vmc.pctEconomic === null, 'non-voting class without a count');
ok(tidyTitle('EVP: CHIEF OPERATING OFFICER') === 'EVP: Chief Operating Officer' && tidyTitle('PRESIDENT & CEO') === 'President & CEO' && tidyTitle('Senior Vice President') === 'Senior Vice President', 'capitals in filed titles tidied');
ok(companyKey('NIKE, Inc.') === companyKey('NIKE INC') && companyKey('JPMorgan Chase & Co.') === companyKey('JPMORGAN CHASE & CO'), 'company names match across spellings');

// --- submissions -------------------------------------------------------------------
const sub = readSubmissions({ filings: { recent: { form: ['8-K', 'DEF 14A', '20-F'], filingDate: ['2026-08-01', '2023-01-01', '2026-03-01'], accessionNumber: ['a', 'b', 'c'], primaryDocument: ['x.htm', 'y.htm', 'z.htm'], items: ['5.02', '', ''] } } }, TECH_CIK, Date.parse('2026-11-12'));
ok(sub.doc && sub.doc.form === '20-F' && sub.events.length === 1 && sub.foreign, 'old proxy skipped, 20-F read, 5.02 event kept');

// --- whole collector with a fake SEC and a fake model --------------------------------
const sec = fakeSec();
const FakeAI = fakeAi({ 'Example Tech Inc.': TECH_PROXY_AI, 'Example Social Inc.': SOCIAL_PROXY_AI });
const nowMs = Date.parse('2026-11-12T15:00:00Z');
const cikMap = new Map([['EXT', TECH_CIK], ['EXS', SOCIAL_CIK], ['ETFX', '0000900003']]);
const usage = [];
const state = await refreshCorporateStructure({
  universe: ['EXT', 'EXS', 'ETFX'], skip: (s) => s === 'ETFX', cikMap, fetchImpl: sec.fetchImpl, nowMs, gapMs: 0,
  ai: { enabled: true, model: 'gemini-3.1-flash-lite', deps: { GoogleGenAI: FakeAI, apiKey: 'test', recordAiUsage: (u) => usage.push(u) } },
});
ok(!state.lastRun.errors.length, 'no errors: ' + JSON.stringify(state.lastRun.errors));
ok(!state.companies.ETFX, 'funds skipped');
ok(sec.calls.every((u) => /^https:\/\/(data|www|efts)\.sec\.gov\//.test(u)), 'only SEC hosts');
ok(state.companies.EXT.proxy.status === 'ok' && state.companies.EXS.proxy.status === 'ok', 'both proxies read');
ok(usage.length === 2 && usage.every((u) => u.callType === 'corporate-structure'), 'AI usage recorded under its own call type');
ok(state.companies.EXT.completeFrom === '2026-11-12', 'complete-from stamped after the first sweep');
ok(state.people['0002000002']?.links?.['0000777777']?.role === 'Director', 'other company role read from its filing');
const views = buildCorporateViews(state, { prices: { EXT: 300, EXS: 600 }, sharesOut: {}, nowMs });
const ext = views.EXT, exs = views.EXS;
ok(ext && exs, 'views built');
const ada = ext.people.find((p) => p.name === 'Ada Example');
ok(ada && ada.ceo && ada.director && ada.independent === false, 'CEO matched across filing and proxy');
ok(ada.holdings.total === 125000 && ada.value === 125000 * 300 && ada.insiderSince === '2026-09-01', 'holdings, value and insider-since');
ok(ext.people[0].name === 'Ada Example', 'CEO listed first');
const sample = ext.people.find((p) => p.name === 'Robert Sample');
ok(sample.chair && sample.boardSince === 2009 && sample.tenureYears === 17 && sample.independent === true, 'chair, tenure, independence');
ok(sample.other.some((o) => o.covered === 'EXS') && sample.other.some((o) => o.name === 'Other Motors Inc.' && o.role === 'Director'), 'other boards from filings');
ok(ext.interlocks.length === 1 && ext.interlocks[0].symbol === 'EXS', 'board interlock with another covered company');
ok(ext.former.some((p) => p.name === 'Gordon Gone'), 'director missing from a newer proxy and with no recent filing is former');
ok(!ext.people.some((p) => p.name === 'Gordon Gone'), 'former director not in current people');
ok(ext.people.some((p) => p.name === 'Ben Money' && p.officer && p.title === 'Chief Financial Officer' && p.roleSince === 2020), 'officer with proxy years');
ok(ext.holders[0].name === 'Big Index Fund Group' && ext.holders[0].pctOfClass === 8.25, 'large holder from the proxy table');
ok(ext.control.level === 'spread', 'no controller at Example Tech: ' + ext.control.summary);
ok(ext.board.size === 3 && ext.board.independent === 2 && ext.board.chair && !ext.board.ceoIsChair, 'board make-up');
ok(ext.changes.some((c) => c.kind === 'joined' && c.name === 'Ada Example') && ext.changes.some((c) => c.kind === '8-K'), 'changes list');
const sam = exs.people.find((p) => p.name === 'Sam Founder');
ok(sam && sam.ceo && sam.chair, 'founder is CEO and chair');
ok(Math.abs(sam.pctVoting - 53.59) < 0.01 && sam.proxy.votingPercent === 54.5, 'voting from latest filings beside the proxy figure: ' + sam.pctVoting);
ok(exs.control.level === 'controlled' && /Sam Founder controls/.test(exs.control.summary), 'founder control: ' + exs.control.summary);
ok(exs.control.dual && /10 votes per share/.test(exs.control.votesNote) && exs.control.controlledCompany, 'dual class and controlled-company notes');
ok(exs.control.gap && /owns about/.test(exs.control.gap), 'economic vs voting gap sentence');
ok(JSON.stringify(views).length < 60_000, 'views stay small');
const oldRail = state.people['0002000002'].links['0000666666'];
ok(oldRail && oldRail.last === null && oldRail.before && oldRail.ticker === 'ORC', 'older companies come from the search counts, marked as past');
ok(sample.other.some((o) => o.ticker === 'ORC' && !o.active), 'past company listed as not active');
ok(state.companies.EXT.form3?.['0002000001'] === '2026-09-01', 'Form 3 dates kept from the sweep');

// --- a new CEO after the proxy, committee chairs, funds as holders -------------------
const coAt = (date) => ({ lines: {}, tx: [], filings: 1, first: date, last: date, rolesFiled: date, lastAcc: 'acc-' + date });
const handoff = {
  symbol: 'APX', cik: '0000555555', name: 'Apex Devices Inc.',
  sub: { events: [{ date: '2026-09-01', acc: 'e1', url: 'https://www.sec.gov/x' }] },
  sweep: { at: '2026-11-12T10:00:00Z', through: '2026-11-12', pending: [] },
  proxy: { status: 'ok', form: 'DEF 14A', filed: '2026-01-08', acc: 'p1', kept: 9, dropped: [], facts: {
    classes: [{ name: 'Common Stock', votesPerShare: 1, outstanding: 15_000_000_000, listed: true }],
    board: [
      { name: 'Tim Cook', roles: ['CEO'], independent: false, since: 2011, committees: [], chairOf: [], otherBoards: [{ company: 'Example Social Inc.', current: true }] },
      { name: 'Art Levinson', roles: ['Chair of the Board'], independent: true, since: 2000, committees: [], chairOf: [], otherBoards: [] },
      { name: 'Nina Audit', roles: ['Director', 'Chairperson (AC)'], independent: true, since: 2015, committees: ['Audit Committee'], chairOf: ['Audit Committee'], otherBoards: [] },
      { name: 'Lee Lead', roles: ['Lead Director'], independent: true, since: 2012, committees: [], chairOf: [], otherBoards: [] },
    ],
    executives: [{ name: 'Tim Cook', title: 'Chief Executive Officer' }, { name: 'John Ternus', title: 'Senior Vice President, Hardware Engineering' }],
    owners: [{ name: 'The Vanguard Group', kind: 'holder', holdings: [], votingPercent: 9.6 }, { name: 'Funds managed by Magnetar Financial LLC', kind: 'holder', holdings: [{ className: 'Common Stock', shares: 900_000_000, percent: 6 }], votingPercent: null }],
  } },
  owners: {
    '0001000001': { cik: '0001000001', sec: 'TERNUS JOHN', roles: { officer: true, director: true, title: 'CHIEF EXECUTIVE OFFICER' }, ...coAt('2026-09-05') },
    '0001000002': { cik: '0001000002', sec: 'COOK TIMOTHY D', roles: { director: true, officer: false }, ...coAt('2026-10-05') },
    '0001000003': { cik: '0001000003', sec: 'MAGNETAR FINANCIAL LLC', roles: { tenPct: true }, ...coAt('2026-10-01'), lastAcc: 'joint', lines: { 'common|D|': { cls: 'common', di: 'D', shares: 1000, asOf: '2026-10-01' } } },
    '0001000004': { cik: '0001000004', sec: 'SNYDERMAN DAVID J', roles: { tenPct: true }, ...coAt('2026-10-01'), lastAcc: 'joint' },
    '0001000005': { cik: '0001000005', sec: 'NEWFUND CAPITAL LP', roles: { tenPct: true }, ...coAt('2026-10-02'), lastAcc: 'solo', lines: { 'common|D|': { cls: 'common', di: 'D', shares: 1_600_000_000, asOf: '2026-10-02' } } },
  },
};
const hv = buildCompanyView(handoff, { nowMs, price: 100, coveredByName: new Map([[companyKey('Example Social Inc.'), 'EXS']]) });
const ternus = hv.people.find((p) => /Ternus/.test(p.name)), cook = hv.people.find((p) => /Cook/.test(p.name));
ok(ternus.ceo && ternus.title === 'Chief Executive Officer' && hv.people[0] === ternus, 'a newer Form 4 makes the new CEO: ' + ternus.title);
ok(!cook.ceo && !cook.officer && cook.director, 'the old CEO, now a director only, is no longer CEO');
ok(hv.people.filter((p) => p.chair).map((p) => p.name).join() === 'Art Levinson', 'committee chairs are not board chairs');
ok(hv.people.find((p) => p.name === 'Lee Lead').leadIndependent, '"Lead Director" is the lead independent director');
ok(!hv.people.some((p) => /magnetar|snyderman|newfund/i.test(p.name)), 'funds and 10% owners are not leadership');
const mag = hv.holders.find((h) => /Magnetar/.test(h.name));
ok(mag && mag.alsoFiles && mag.filers.length === 2, 'joint 10% filers merged into the proxy holder');
const nf = hv.holders.find((h) => /Newfund/i.test(h.name));
ok(nf && nf.source === 'filings' && Math.abs(nf.pctVoting - (1.6e9 / 15e9) * 100) < 0.01, '10% owner from Form 4s alone becomes a holder');
ok(hv.holders.find((h) => /Vanguard/.test(h.name)).pctOfClass === 9.6, 'one class: percent of votes is percent of the class');
ok(hv.source.lateChanges?.count === 1, 'leadership 8-K after the proxy flagged');
ok(hv.interlocks.some((i) => i.symbol === 'EXS' && i.people[0].via === 'proxy'), 'interlock from the proxy list of other boards');

// A second run the same day re-reads nothing it has.
const sec2 = fakeSec();
const again = await refreshCorporateStructure({ prior: state, universe: ['EXT', 'EXS'], cikMap, fetchImpl: sec2.fetchImpl, nowMs: nowMs + 3_600_000, gapMs: 0, ai: { enabled: true, model: 'm', deps: { GoogleGenAI: FakeAI, apiKey: 'k' } } });
ok(sec2.calls.length === 0, 'same-day rerun makes no requests (' + sec2.calls.length + ')');
ok(chooseFilings(again.companies.EXT).length === 0, 'nothing left to read');
// Budget stop keeps what it has and says why.
const sec3 = fakeSec();
const capped = await refreshCorporateStructure({ universe: ['EXT', 'EXS'], cikMap, fetchImpl: sec3.fetchImpl, nowMs, gapMs: 0, maxRequests: 3 });
ok(capped.lastRun.stoppedBy === 'build request budget' && sec3.calls.length === 3, 'stops at the request budget');
// Keyless: no AI call, the document stays pending.
const sec4 = fakeSec();
const keyless = await refreshCorporateStructure({ universe: ['EXT'], cikMap, fetchImpl: sec4.fetchImpl, nowMs, gapMs: 0, ai: { enabled: false } });
ok(keyless.companies.EXT.proxy?.pending && !sec4.calls.some((u) => /proxy2026/.test(u)), 'keyless build leaves the proxy pending without downloading it');
const kv = buildCorporateViews(keyless, { prices: { EXT: 300 }, sharesOut: { EXT: 1e9 }, nowMs });
ok(kv.EXT.people.some((p) => p.ceo) && kv.EXT.source.docPending, 'filings alone still give a view');


// --- fixes from the live run on real filings ------------------------------------
ok(samePerson('SHRIRAM KAVITARK RAM', 'K. Ram Shriram'), 'an initial for the first name');
ok(samePerson('Mahoney Curtis J', 'C.J. Mahoney'), 'two initials');
ok(samePerson('POWELL DINA H', 'Dina Powell McCormick'), 'a married name added after the filing name');
ok(samePerson('Sergey Brin', 'Sergey Brin'), 'a filer name in first-last order');
ok(!samePerson('POWELL DINA H', 'Colin Powell Smith'), 'an added name still needs the first name');
ok(!samePerson('MAGNETAR FINANCIAL LLC', 'Funds managed by Magnetar Financial LLC'), 'entities are never matched as people');
assert.equal(tidyTitle('COB AND CEO'), 'Chair of the Board and CEO'); n++;
ok(tidyTitle('See Remarks') === null && officerTitle('See Remarks', 'Chief Executive Officer') === 'Chief Executive Officer' && officerTitle('See Remarks', 'Exhibit 24 - Power of Attorney') === null, '"See Remarks" titles');
assert.equal(shareClassOf('Cumulative preference shares'), 'preferred'); n++;
const gClasses = shareClasses({ classes: [{ name: 'Class A Common Stock', votesPerShare: 1, outstanding: 100 }, { name: 'Class B Common Stock', votesPerShare: 10, outstanding: 10 }, { name: 'Class C Capital Stock', votesPerShare: 0, outstanding: null }] });
ok(voteMath({ C: 1000 }, gClasses).pctVoting === 0, 'a holder of only non-voting shares has 0% of the votes, not unknown');
ok(shareClasses({ classes: [{ name: 'common stock', votesPerShare: 1, outstanding: null }] }, 7.4e9)[0].outstanding === 7.4e9, 'one class with no printed count takes the quote count');
const fx = '2026-11-12';
const at = (date, extra = {}) => ({ lines: {}, tx: [], filings: 1, first: date, last: date, rolesFiled: date, lastAcc: 'a-' + date + (extra.k || ''), ...extra });
const roll = {
  symbol: 'RLL', cik: '0000444444', name: 'Roll Corp',
  names: { '0003000009': 'NEWDIRECTOR NORA' },
  sweep: { at: fx + 'T10:00:00Z', through: fx, pending: [] },
  proxy: { status: 'ok', form: 'DEF 14A', filed: '2026-03-01', acc: 'p', kept: 9, dropped: [], facts: {
    classes: [{ name: 'Class A', votesPerShare: 1, outstanding: 900_000_000, listed: true }, { name: 'Class B', votesPerShare: 10, outstanding: 10_000_000, listed: false }],
    board: [{ name: 'Mark Founder', roles: [], independent: false, committees: [], chairOf: [], otherBoards: [] }, { name: 'Ann Board', roles: [], independent: true, committees: [], chairOf: [], otherBoards: [] }],
    executives: [{ name: 'Mark Founder', title: 'Chief Executive Officer' }, { name: 'Pat Old', title: 'Chief Financial Officer' }, { name: 'Alex Karp', title: 'Chief Technology Officer' }],
    owners: [
      { name: 'Preferred Holder Corp', kind: 'holder', holdings: [{ className: 'Series A Preferred Stock', shares: 1000, percent: 100 }], votingPercent: null },
      { name: 'Big Holder LP', kind: 'holder', holdings: [{ className: 'Class A', shares: 90_000_000, percent: 10.004 }], votingPercent: null },
    ],
  } },
  owners: {
    '0003000001': { cik: '0003000001', sec: 'FOUNDER MARK', roles: { director: true, officer: true, title: 'COB AND CEO' }, ...at('2026-09-01') },
    '0003000002': { cik: '0003000002', sec: 'OLD PAT', roles: { officer: true, title: 'EVP, CFO' }, ...at('2026-02-01') },
    '0003000003': { cik: '0003000003', sec: 'NEW QUINN', roles: { officer: true, title: 'Chief Financial Officer' }, ...at('2026-10-01') },
    '0003000004': { cik: '0003000004', sec: 'KARP ALEX', roles: { officer: true, title: null }, ...at('2026-10-02') },
    '0003000009': { cik: '0003000009', sec: 'Nora Newdirector', roles: { director: true }, ...at('2026-10-03') },
  },
};
const rlPeople = { '0003000001': { cik: '0003000001', links: {
  '0009000001': { cik: '0009000001', name: 'Ah Bio Fund II, L.P.', ticker: null, first: '2025-01-01', last: '2026-08-01' },
  '0009000002': { cik: '0009000002', name: 'Old Widgets Inc', ticker: null, first: '2010-01-01', last: '2014-01-01' },
} } };
const rl = buildCompanyView(roll, { nowMs, price: 10, people: rlPeople });
const mark = rl.people.find((p) => p.name === 'Mark Founder');
ok(mark.chair && mark.ceo && rl.board.ceoIsChair, '"COB" on a Form 4 makes the board chair');
ok(rl.people.filter((p) => /CFO|Chief Financial/.test(p.title || '')).map((p) => p.name).join() === 'Quinn New', 'one CFO: the newer filing wins');
const pat = rl.former.find((p) => /Pat/.test(p.name));
ok(pat && pat.replacedBy?.name === 'Quinn New' && rl.source.notes.some((x) => /Pat Old was listed as CFO/.test(x)), 'the replaced CFO moves to former with who replaced them');
ok(rl.people.find((p) => p.name === 'Alex Karp').title === 'Chief Technology Officer', 'a filing with no usable title keeps the proxy title');
ok(rl.people.some((p) => p.name === 'Nora Newdirector'), "EDGAR's own name order decides the display name");
ok(!mark.other.some((o) => /Fund/.test(o.name)) && mark.other.some((o) => /Widgets/.test(o.name)), 'private funds dropped from other companies, old public companies kept');
ok(!rl.holders.some((h) => /Preferred/.test(h.name)) && !/Preferred/.test(rl.control.summary), 'preferred stock is not a stake in the vote');
const bigH = rl.holders.find((h) => /Big Holder/.test(h.name));
ok(bigH.pctOfClass === 10 && Math.abs(bigH.pctVoting - 9) < 0.01, 'two classes: class share and vote share kept apart, rounded: ' + bigH.pctOfClass + ' / ' + bigH.pctVoting);
// Other covered companies: only where the person is current there too.
const xv = {
  AAA: { cik: '1', name: 'A Co', board: {}, interlocks: [], people: [
    { id: 'p1', cik: 'p1', name: 'Jen Legal', officer: true, title: 'CLO', other: [{ covered: 'BBB', active: true, cik: '2', name: 'B Co' }], otherBoards: [] },
    { id: 'p2', cik: null, name: 'Bo Both', director: true, other: [], otherBoards: [{ company: 'B Co', covered: 'BBB', current: true }] },
  ] },
  BBB: { cik: '2', name: 'B Co', board: {}, interlocks: [], people: [{ id: 'p9', cik: 'p9', name: 'Someone Else', director: true, other: [], otherBoards: [] }, { id: 'p8', cik: null, name: 'Bo Both', director: true, other: [], otherBoards: [] }] },
};
crossCheckCovered(xv);
ok(xv.AAA.people[0].other[0].active === false && xv.AAA.people[0].other[0].left, 'a link to a covered company where the person is no longer current is not active');
ok(xv.AAA.interlocks.length === 1 && xv.AAA.interlocks[0].people.map((p) => p.name).join() === 'Bo Both', 'only the confirmed shared person links the two');
ok(xv.BBB.interlocks.some((i) => i.symbol === 'AAA' && i.people[0].id === 'p8'), 'the link shows from both sides');
// A 20-F cross-reference is not the start of Item 6.
const pad = (k) => 'x '.repeat(k);
const f20 = 'Item 6. Directors, Senior Management and Employees 70 Item 8. Financial Information 90 ' + pad(40000) + ' see “Item 6. Directors, Senior Management and Employees – Share Ownership” ' + pad(500) + ' Item 6. Directors, Senior Management and Employees BOARD LIST ' + pad(2000) + ' Item 8. Financial Information ' + pad(200000);
ok(/^Item 6\. Directors, Senior Management and Employees BOARD LIST/.test(slice20F(f20, 110000)), '20-F slice starts at the real heading');
// A passing EDGAR 500 is retried once.
const sec5 = fakeSec({ failOnce: [/efts\.sec\.gov.*ciks=0000900001/] });
const retried = await refreshCorporateStructure({ universe: ['EXT'], cikMap, fetchImpl: sec5.fetchImpl, nowMs, gapMs: 0, retryMs: 0 });
ok(!retried.lastRun.errors.some((e) => e.stage === 'sweep') && Object.keys(retried.companies.EXT.owners).length > 0, 'an EDGAR 500 is retried and the sweep completes');
// Patterns from the live filings: a past chair read as a chair role, a CEO
// whose Form 4 leaves out "chair", a division CEO, one person under two
// names, committee seats in the board roles.
const div = {
  symbol: 'DIV', cik: '0000555555', name: 'Div Corp',
  sweep: { at: fx + 'T10:00:00Z', through: fx, pending: [] },
  proxy: { status: 'ok', form: 'DEF 14A', filed: '2026-03-01', acc: 'p', kept: 9, dropped: [], facts: {
    classes: [{ name: 'Common Stock', votesPerShare: 1, outstanding: 1_000_000_000, listed: true }],
    board: [
      { name: 'Andy Boss', roles: ['President and Chief Executive Officer', 'Chair of the Board'], occupation: 'President and CEO, Div Corp', independent: false, committees: [], chairOf: [], otherBoards: [] },
      { name: 'Jeff Former', roles: ['Chair of the Board'], occupation: 'Former Chair and CEO, Widget Inc.', independent: true, committees: [], chairOf: [], otherBoards: [] },
      { name: 'Jo Committee', roles: ['Audit Committee Chair', 'Lead Independent Director', 'Director'], occupation: 'Retired partner', independent: true, committees: ['Audit'], chairOf: ['Audit'], otherBoards: [] },
    ],
    executives: [{ name: 'Andy Boss', title: 'President and Chief Executive Officer' }, { name: 'Matt Cloud', title: 'CEO, Div Web Services' }, { name: 'Wendell Huang', title: 'Chief Financial Officer' }],
    owners: [],
  } },
  owners: {
    '0005000001': { cik: '0005000001', sec: 'BOSS ANDY', roles: { director: true, officer: true, title: 'President and CEO' }, ...at('2026-09-01') },
    '0005000002': { cik: '0005000002', sec: 'CLOUD MATT', roles: { officer: true, title: 'CEO Div Web Services' }, ...at('2026-08-01') },
    '0005000003': { cik: '0005000003', sec: 'HUANG JEN-CHAU', roles: { officer: true, title: 'Chief Financial Officer' }, ...at('2026-08-02') },
    '0005000004': { cik: '0005000004', sec: 'FORMER JEFF', roles: { director: true }, ...at('2026-05-01') },
  },
};
const dv = buildCompanyView(div, { nowMs, price: 50 });
const dp = (re) => dv.people.find((p) => re.test(p.name));
ok(dp(/Boss/).chair && dp(/Boss/).ceo && dv.board.ceoIsChair, 'a CEO-chair keeps the chair when the Form 4 title leaves it out');
ok(!dp(/Former/).chair && dv.people.filter((p) => p.chair).length === 1, 'a director whose past chair job was read as a role is not the chair');
ok(!dp(/Cloud/).ceo && dv.people.filter((p) => p.ceo).map((p) => p.name).join() === 'Andy Boss', 'a division CEO is not the CEO');
const hu = dv.people.filter((p) => /Huang/.test(p.name));
ok(hu.length === 1 && hu[0].name === 'Wendell Huang' && hu[0].alsoKnownAs === 'Jen-Chau Huang' && hu[0].cik === '0005000003' && !dv.former.some((p) => /Huang/.test(p.name)), 'one person under an English name and a legal name is one row: ' + hu.map((p) => p.name + '/' + p.alsoKnownAs).join());
const jo = dp(/Committee/);
ok(jo.leadIndependent && !jo.chair && !jo.boardRoles.some((r) => /committee/i.test(r)), 'committee seats are not board roles');
assert.equal(prettyCompanyName('WELLS FARGO & COMPANY/MN'), 'Wells Fargo & Company'); n++;
ok(isEntityName('Upon A. Farm, PBC') && !samePerson('UPON A FARM PBC', 'Upon A. Farm'), 'a public benefit corporation is a company, not a person');
// A foreign filer: English names in the 20-F, legal names on the Form 3s.
const twn = {
  symbol: 'TWN', cik: '0000666666', name: 'Twn Co', sub: { foreign: true },
  sweep: { at: fx + 'T10:00:00Z', through: fx, pending: [] },
  proxy: { status: 'ok', form: '20-F', filed: '2026-04-16', acc: 'p', kept: 9, dropped: [], facts: {
    classes: [{ name: 'Common Shares', votesPerShare: 1, outstanding: 1_000_000_000, listed: true }],
    board: [{ name: 'C.C. Boss', roles: ['Chairman'], independent: false, committees: [], chairOf: [], otherBoards: [] }],
    executives: [
      { name: 'C.C. Boss', title: 'Chairman and Chief Executive Officer' },
      { name: 'Lora Ho', title: 'Senior Vice President, Corporate Strategy' },
      { name: 'Michael Wu', title: 'Senior Vice President, Research & Development' },
      { name: 'Y.P. Chyn', title: 'Executive Vice President; Co-Chief Operating Officer' },
      { name: 'Arthur Chuang', title: 'Vice President, Facility' }, { name: 'Ray Chuang', title: 'Vice President, Fab Operations' },
      { name: 'Ann Exec', title: 'Executive Officer' },
    ],
    owners: [],
  } },
  owners: {
    '0006000001': { cik: '0006000001', sec: 'Boss Che-Chia', roles: { director: true, officer: true, title: 'Chairman; CEO' }, ...at('2026-05-01') },
    '0006000002': { cik: '0006000002', sec: 'Ho Li-Mei', roles: { officer: true, title: 'SVP' }, ...at('2026-05-01') },
    '0006000003': { cik: '0006000003', sec: 'Wu Shien-Yang', roles: { officer: true, title: 'SVP' }, ...at('2026-05-01') },
    '0006000004': { cik: '0006000004', sec: 'Wu Yi-Huang', roles: { officer: true, title: 'VP' }, ...at('2026-05-01') },
    '0006000005': { cik: '0006000005', sec: 'Chin Yung-Pei', roles: { officer: true, title: 'EVP and Co-COO' }, ...at('2026-05-01') },
    '0006000006': { cik: '0006000006', sec: 'Chuang Tzu-Sou', roles: { officer: true, title: 'VP' }, ...at('2026-05-01') },
    '0006000007': { cik: '0006000007', sec: 'Chuang Juiping', roles: { officer: true, title: 'VP' }, ...at('2026-05-01') },
    '0006000008': { cik: '0006000008', sec: 'EXEC ANN', roles: { officer: true, title: 'Senior Vice President' }, ...at('2026-01-01') },
  },
};
const tw = buildCompanyView(twn, { nowMs, price: 50 });
const tn = (re) => tw.people.filter((p) => re.test(p.name + ' ' + (p.alsoKnownAs || '')));
ok(tn(/Ho\b/).length === 1 && tn(/Ho\b/)[0].name === 'Lora Ho' && tn(/Ho\b/)[0].alsoKnownAs === 'Li-Mei Ho' && /Corporate Strategy/.test(tn(/Ho\b/)[0].title), 'one officer each side with a surname is one person, with the fuller title');
ok(tn(/Michael Wu/).length === 1 && tn(/Michael Wu/)[0].alsoKnownAs === 'Shien-Yang Wu' && tn(/Yi-Huang/).length === 1 && !tn(/Yi-Huang/)[0].alsoKnownAs, 'two candidates: the one at the same rank');
ok(tn(/Chyn/).length === 1 && tn(/Chyn/)[0].alsoKnownAs === 'Yung-Pei Chin', 'a surname spelled one letter apart, same initial and seat');
ok(tn(/Chuang/).length === 4, 'two and two at the same rank stay apart');
ok(tw.people.find((p) => /Ann Exec/.test(p.name)).title === 'Senior Vice President', '"Executive Officer" is not a title');
ok(tn(/Lora/)[0].insiderSince === null && tn(/Lora/)[0].tenureYears == null && !tw.changes.some((x) => x.kind === 'joined'), "a foreign filer's first Form 3s under the 2026 rule are not start dates");
assert.equal(prettySecName('NORA JOHNSON SUZANNE M'), 'Suzanne M. Nora Johnson'); n++;
assert.equal(prettySecName('DE LA CRUZ JOSE A'), 'Jose A. De La Cruz'); n++;
assert.equal(prettySecName('SMITH JOHN PAUL JR'), 'John Paul Smith Jr.'); n++;
assert.equal(tidyTitle('EVP: Chief Inn,prod&dsg Ofcr'), 'EVP: Chief Innovation, Product & Design Officer'); n++;
const handoff2 = structuredClone(handoff);
handoff2.owners['0001000002'].roles = { director: true, officer: true, title: 'Executive Chair' };
const hv2 = buildCompanyView(handoff2, { nowMs, price: 100 });
const lev = hv2.people.find((p) => p.name === 'Art Levinson');
ok(hv2.people.find((p) => /Cook/.test(p.name)).chair && !lev.chair && !lev.boardRoles.some((r) => /chair/i.test(r)), 'the chair a newer filing replaced keeps no chair role');

// --- audit fixes (2026-11-13) --------------------------------------------------------
// Names: a surname with a particle, a short form from the end of the name,
// a two-word surname before an initial.
ok(samePerson('Di Sibio Carmine', 'Carmine Di Sibio'), 'surname with a particle');
ok(samePerson('Treseder Oluwadara Johnson', 'Dara Treseder'), 'short form from the end of a first name');
ok(samePerson('NORA JOHNSON SUZANNE M', 'Suzanne M. Nora Johnson'), 'two-word surname before an initial');
ok(!samePerson('HENRY PETER B', 'Maria Henry') && !samePerson('WU MICHAEL', 'Yi-Huang Wu'), 'same surname, other person');
assert.equal(tidyTitle('EVP, Worldwide Field Ops'), 'EVP, Worldwide Field Operations'); n++;
assert.equal(tidyTitle('Sr VP, Intl Svcs'), 'Senior VP, International Services'); n++;

// US depositary shares count as their ordinary shares in totals, value and votes.
ok(Math.abs(voteMath({ ADS: 1000 }, [{ key: 'common', votes: 1, outstanding: 1e6 }], 5).pctVoting - 0.5) < 1e-9, 'ADS votes at the ratio');
const adsCo = {
  symbol: 'TSM', cik: '0000555555', name: 'Ads Co', sub: { foreign: true },
  proxy: { status: 'ok', form: '20-F', filed: '2026-04-16', acc: 'p', facts: {
    classes: [{ name: 'Common Shares', votesPerShare: 1, outstanding: 1_000_000, listed: true }],
    board: [{ name: 'Mike Splint', roles: ['Independent Director'], independent: true, committees: [], chairOf: [], otherBoards: [] },
      { name: 'C.C. Lead', roles: ['Chairman'], independent: null, committees: [], chairOf: [], otherBoards: [] }],
    executives: [{ name: 'C.C. Lead', title: 'Chairman and Chief Executive Officer' }], owners: [] } },
  owners: {
    '0007000001': { cik: '0007000001', sec: 'SPLINT MIKE', roles: { director: true }, ...at('2026-05-01'), lines: { a: { cls: 'ADS', di: 'D', shares: 1000, asOf: '2026-05-01' } } },
    '0007000002': { cik: '0007000002', sec: 'Lead C C', roles: { director: true, officer: true, title: 'Chairman; CEO' }, ...at('2026-05-01'), lines: { a: { cls: 'common', di: 'D', shares: 2000, asOf: '2026-05-01' }, b: { cls: 'ADS', di: 'D', shares: 10, asOf: '2026-05-01' } } },
    '0007000003': { cik: '0007000003', sec: 'QUIET QUINN', roles: { director: true }, ...at('2026-05-02') },
  },
};
const adsView = buildCompanyView(adsCo, { nowMs, price: 400 });
const splint = adsView.people.find((p) => /Splint/.test(p.name));
ok(splint.holdings.total === 5000 && splint.holdings.ads === 1000 && splint.value === 400_000 && splint.pctVoting === 0.5, 'ADS-only holder: 1,000 ADS = 5,000 shares worth 1,000 × the US price: ' + JSON.stringify([splint.holdings.total, splint.value, splint.pctVoting]));
const lead = adsView.people.find((p) => /Lead/.test(p.name));
ok(lead.holdings.total === 2050 && lead.value === 2050 * 80 && lead.independent === false, 'mixed holder, and an executive on the board is not independent even when the 20-F says nothing');
const tiny = buildCompanyView({ ...adsCo, symbol: 'TNY', owners: { x: { ...adsCo.owners['0007000003'], lines: { a: { cls: 'common', di: 'D', shares: 2, asOf: '2026-05-01' } } } } }, { nowMs, price: 10 });
ok(tiny.people.some((p) => p.pctEconomic > 0 && p.pctEconomic < 0.01), 'a tiny stake is not rounded to 0');
const quinn = adsView.people.find((p) => /Quinn/.test(p.name)) || adsView.former.find((p) => /Quinn/.test(p.name));
ok(quinn && quinn.noShares, 'a filer with no shares is listed as holding none');

// A director left off a fresh proxy's board list who has filed nothing since
// the months around the meeting has left; one whose Form 3 came after the
// proxy has just joined; a surname-only match catches a short name.
const renom = {
  symbol: 'RNM', cik: '0000555556', name: 'Renom Co',
  proxy: { status: 'ok', form: 'DEF 14A', filed: '2026-04-16', acc: 'p', facts: {
    classes: [{ name: 'Common Stock', votesPerShare: 1, outstanding: 1_000_000, listed: true }],
    board: [{ name: 'Stay Put', roles: ['Director'], independent: true, committees: [], chairOf: [], otherBoards: [] },
      { name: 'Dara Treseder', roles: ['Director'], independent: true, committees: [], chairOf: [], otherBoards: [] },
      { name: 'Carmine Di Sibio', roles: ['Director'], independent: true, committees: [], chairOf: [], otherBoards: [] }],
    executives: [], owners: [] } },
  form3: { '0008000004': '2026-09-09' },
  owners: {
    '0008000001': { cik: '0008000001', sec: 'PUT STAY', roles: { director: true }, ...at('2026-10-01') },
    '0008000002': { cik: '0008000002', sec: 'TRAVIS TRACEY', roles: { director: true }, ...at('2026-05-19'), first: '2025-05-19' },
    '0008000003': { cik: '0008000003', sec: 'Treseder Oluwadara Johnson', roles: { director: true }, ...at('2026-10-02') },
    '0008000004': { cik: '0008000004', sec: 'MANDIA KEVIN', roles: { director: true }, ...at('2026-10-06'), first: '2026-09-09' },
    '0008000005': { cik: '0008000005', sec: 'Di Sibio Carmine', roles: { director: true }, ...at('2026-03-11'), first: '2025-06-12' },
  },
};
const rv = buildCompanyView(renom, { nowMs, price: 10 });
const cur = (re) => rv.people.find((p) => re.test(p.name));
ok(!cur(/Travis/) && rv.former.some((p) => /Travis/.test(p.name) && p.offBoard === '2026-04-16') && rv.changes.some((x) => x.kind === 'last-filing' && x.offBoard === '2026-04-16'), 'director not put up for re-election is former, with the proxy that left them off');
ok(cur(/Mandia/) && cur(/Mandia/).newSinceProxy && cur(/Mandia/).independent == null, 'director who joined after the proxy stays, marked as not yet in a proxy');
ok(rv.people.filter((p) => /Treseder/.test(p.name)).length === 1 && cur(/Treseder/).independent === true, 'Dara Treseder is one person, with the proxy facts');
ok(rv.people.filter((p) => /Sibio/.test(p.name)).length === 1 && cur(/Sibio/).cik === '0008000005', 'Di Sibio is one person');
ok(cur(/Stay Put/) && rv.board.size === 4, 'board: three on the proxy plus one who joined later: ' + rv.board.size);

// The company itself filing as an owner of another issuer is skipped after
// the first read shows it.
const ownSt = { companies: { EXT: { symbol: 'EXT', cik: TECH_CIK, read: {}, ownerOf: { '0000123456': '2026-10-01' },
  sweep: { pending: [{ acc: 'x1', file: 'f.xml', form: '4', date: '2026-10-02', owners: ['0000123456'] }, { acc: 'x2', file: 'f.xml', form: '4', date: '2026-10-02', owners: ['0002000099'] }] } } } };
ok(chooseFilings(ownSt.companies.EXT).map((x) => x.acc).join() === 'x2', 'filings where the company owns another issuer are not read again');

// A person checked again reuses each role read from the same filing, and a
// budget stop part way through a check leaves the person as they were.
const aged = structuredClone(state);
for (const p of Object.values(aged.people)) p.at = '2026-09-01T00:00:00Z';
const sec6 = fakeSec();
const recheck = await refreshCorporateStructure({ prior: aged, universe: ['EXT', 'EXS'], cikMap, fetchImpl: sec6.fetchImpl, nowMs, gapMs: 0, ai: { enabled: false } });
ok(recheck.lastRun.peopleChecked > 0 && recheck.people['0002000002'].links['0000777777'].role === 'Director' && !sec6.calls.some((u) => /edgar[/]data[/]777777[/]/.test(u)), 'role reused from the same filing, not read again');
const sec7 = fakeSec();
const cut = await refreshCorporateStructure({ prior: aged, universe: ['EXT', 'EXS'], cikMap, fetchImpl: sec7.fetchImpl, nowMs, gapMs: 0, maxRequests: 1, ai: { enabled: false } });
ok(cut.lastRun.stoppedBy && Object.keys(aged.people).every((k) => Object.keys(cut.people[k]?.links || {}).length === Object.keys(aged.people[k].links).length), 'a budget stop mid-check keeps the earlier links');

// The shadow log's insider key reads this collector's state as it is stored.
ok(insiderFromStructure(state, new Date(nowMs).toISOString(), 60) === null, 'insider key waits until the Form 4 record covers the window');
const covered = structuredClone(state);
for (const c of Object.values(covered.companies)) c.completeFrom = '2026-01-01';
const ins = insiderFromStructure(covered, new Date(nowMs).toISOString(), 60);
ok(ins?.EXT?.sellers === 1 && ins.EXT.buyers === 0, 'insider key counts the sale in the window: ' + JSON.stringify(ins));

// --- live-data audit fixes (2026-11-13) ----------------------------------------------
// Names: a two-word surname with no initial, the best of two fits, Danish
// letters, degrees, capitals, entities with dotted suffixes.
ok(samePerson('MONTGOMERY RICE VALERIE', 'Valerie Montgomery Rice') && samePerson('VOJVODICH RADAKOVICH LYNN', 'Lynn Vojvodich Radakovich'), 'two-word surname with no initial');
ok(!samePerson('MONTGOMERY RICE VALERIE', 'Valerie Smith Rice'), 'only the last word of a two-word surname is not enough');
ok(matchScore('JIANG FAN', 'Fan Jiang') > matchScore('JIANG FAN', 'Jane Fang Jiang') && matchScore('JIANG FANG JANE', 'Jane Fang Jiang') > matchScore('JIANG FANG JANE', 'Fan Jiang'), 'JIANG FAN fits Fan Jiang best, JIANG FANG JANE fits Jane Fang Jiang');
ok(foldName('Bøjer Ærø Straße Łódź') === 'Bojer Aero Strasse Lodz' && samePerson('JORGENSEN LARS FRUERGAARD', 'Lars Fruergaard Jørgensen'), 'letters that do not decompose fold: ' + foldName('Bøjer Ærø Straße Łódź'));
ok(prettySecName('DOE JANE MD') === 'Jane Doe' && prettySecName('ROE RICHARD PHD') === 'Richard Roe', 'degree words are not names');
ok(tidyPersonName('Ambassador Susan Rice') === 'Susan Rice' && tidyPersonName('Admiral Mike Mullen') === 'Mike Mullen' && tidyPersonName('Dr. Lisa T. Su') === 'Lisa T. Su' && tidyPersonName('General Smith') === 'General Smith', 'honorifics are not part of the name');
ok(tidyPersonName('Eddie Yongming WU') === 'Eddie Yongming Wu' && tidyPersonName('KC McClure') === 'KC McClure' && tidyPersonName('JAMES MCNERNEY JR') === 'James McNerney Jr.' && tidyPersonName('John Smith III') === 'John Smith III', 'names printed in capitals read normally, initials and suffixes kept');
ok(isEntityName('Foo Holdings L.L.C.') && isEntityName('Sequoia Capital GP') && isEntityName('Bar Partners S.a r.l.') && !isEntityName('SMITH JOHN G'), 'dotted entity suffixes are entities');
ok(hasName('noubar afeyan, ph.d. is a director', 'Noubar Afeyan, Ph.D.') && hasName('lars fruergaard jorgensen was ceo', 'Lars Fruergaard Jørgensen'), 'the fact checker finds names with degrees and Danish letters');
// Titles: only the current part, short Form 4 words in full.
assert.equal(tidyTitle('Former CEO'), null); n++;
assert.equal(tidyTitle('Executive Vice Chair and former CEO'), 'Executive Vice Chair'); n++;
assert.equal(tidyTitle('Current Chief Operating Officer'), 'Chief Operating Officer'); n++;
assert.equal(tidyTitle('Chf Fin Ofcr'), 'Chief Financial Officer'); n++;
assert.equal(tidyTitle('EVP, Gen Counsel & Corp Sec.'), 'EVP, General Counsel & Corporate Secretary'); n++;
assert.equal(tidyTitle('COB'), 'Chair of the Board'); n++;
assert.equal(tidyTitle('co-CEO'), 'Co-CEO'); n++;
assert.equal(tidyTitle('president and chief executive officer'), 'President and Chief Executive Officer'); n++;
ok(isoDate('March 3, 2026') === '2026-03-03' && isoDate('2026-03-03T00:00:00Z') === '2026-03-03' && isoDate('soon') === null, 'record dates read as days');

const doc = (board, executives, extra = {}) => ({ status: 'ok', form: 'DEF 14A', filed: '2026-04-16', acc: 'p', facts: {
  classes: [{ name: 'Common Stock', votesPerShare: 1, outstanding: 1_000_000, listed: true }],
  board: board.map((b) => ({ roles: ['Director'], independent: true, committees: [], chairOf: [], otherBoards: [], ...(typeof b === 'string' ? { name: b } : b) })),
  executives, owners: [], ...extra } });
const find = (v, re) => v.people.find((p) => re.test(p.name));
const gone = (v, re) => v.former.find((p) => re.test(p.name));

// Two people with one surname are two rows, each matched to their own name.
const two = buildCompanyView({ symbol: 'TWO', cik: '0000555561', name: 'Two Co', proxy: doc(['Fan Jiang', 'Jane Fang Jiang', 'Pat Third'], []),
  owners: { '0009100001': { cik: '0009100001', sec: 'JIANG FANG JANE', roles: { director: true }, ...at('2026-06-01') },
    '0009100002': { cik: '0009100002', sec: 'JIANG FAN', roles: { director: true }, ...at('2026-06-02') } } }, { nowMs, price: 10 });
ok(two.people.length === 3 && find(two, /^Fan Jiang$/)?.cik === '0009100002' && find(two, /Jane Fang Jiang/)?.cik === '0009100001', 'Fan Jiang and Jane Fang Jiang: ' + two.people.map((p) => p.name + ':' + p.cik).join(', '));
// An English name in the proxy and the legal name on the filings: one person,
// on the board and in charge.
const alias = buildCompanyView({ symbol: 'ALI', cik: '0000555562', name: 'Alias Co', proxy: doc([{ name: 'Eddie Yongming WU', roles: ['Director'], independent: false }, 'Pat One', 'Pat Two'], [{ name: 'Eddie Wu', title: 'Chief Executive Officer' }]),
  owners: { '0009200001': { cik: '0009200001', sec: 'WU YONGMING', roles: { director: true, officer: true, title: 'CEO' }, ...at('2026-06-01') } } }, { nowMs, price: 10 });
const eddie = alias.people.filter((p) => /Wu/.test(p.name));
ok(eddie.length === 1 && eddie[0].name === 'Eddie Yongming Wu' && eddie[0].ceo && eddie[0].director && eddie[0].cik === '0009200001', 'Eddie Wu is one person: ' + JSON.stringify(eddie.map((p) => [p.name, p.ceo, p.director, p.cik])));

// Co-CEOs share the seat; the CEO they replaced stays on as a director only.
const coCeo = buildCompanyView({ symbol: 'COC', cik: '0000555563', name: 'Co Ceo Co', proxy: doc([{ name: 'Old Boss', roles: ['Chairman'] }, 'Pat One', 'Pat Two'], [{ name: 'Old Boss', title: 'Chief Executive Officer' }]),
  owners: {
    '0009300001': { cik: '0009300001', sec: 'BOSS OLD', roles: { director: true, officer: true, title: 'Chairman and CEO' }, ...at('2026-05-01') },
    '0009300002': { cik: '0009300002', sec: 'ALPHA ANN', roles: { officer: true, title: 'Co-Chief Executive Officer' }, ...at('2026-09-01') },
    '0009300003': { cik: '0009300003', sec: 'BETA BEN', roles: { officer: true, title: 'Co-CEO' }, ...at('2026-08-15') },
    '0009300004': { cik: '0009300004', sec: 'GAMMA GIL', roles: { officer: true, title: 'Chief Executive Officer' }, ...at('2026-03-01') },
  } }, { nowMs, price: 10 });
ok(find(coCeo, /Ann Alpha/)?.ceo && find(coCeo, /Ben Beta/)?.ceo && coCeo.people.filter((p) => p.ceo).length === 2, 'two co-CEOs: ' + coCeo.people.filter((p) => p.ceo).map((p) => p.name));
const oldBoss = find(coCeo, /Old Boss/);
ok(oldBoss && oldBoss.director && !oldBoss.ceo && oldBoss.chair && oldBoss.replacedBy?.role === 'CEO', 'the replaced CEO keeps the board seat and the chair: ' + JSON.stringify(oldBoss && [oldBoss.title, oldBoss.ceo, oldBoss.chair, oldBoss.replacedBy]));
ok(!find(coCeo, /Gil Gamma/) && gone(coCeo, /Gil Gamma/)?.replacedBy?.role === 'CEO', 'a replaced CEO with no board seat has left');

// A newer Form 4 that repeats a role the proxy calls past keeps the proxy's
// title; a past executive whose newer filing no longer says officer has left;
// a director whose Form 4 ticks only officer stays on the board.
const stale = buildCompanyView({ symbol: 'STL', cik: '0000555564', name: 'Stale Co', proxy: doc(['Vic Chair', 'Dee Officer', 'Pat One'], [
  { name: 'Vic Chair', title: 'Executive Vice Chair and former CEO' }, { name: 'Ned Newceo', title: 'Chief Executive Officer' },
  { name: 'Paul Past', title: 'Executive Vice President' }, { name: 'Dee Officer', title: 'President' }, { name: 'Fred Former', title: 'Former Chief Financial Officer' }]),
  owners: {
    '0009400001': { cik: '0009400001', sec: 'CHAIR VIC', roles: { director: true, officer: true, title: 'CEO' }, ...at('2026-07-01') },
    '0009400002': { cik: '0009400002', sec: 'NEWCEO NED', roles: { officer: true, title: 'Chief Executive Officer' }, ...at('2026-07-02') },
    '0009400003': { cik: '0009400003', sec: 'PAST PAUL', roles: { tenPct: false }, ...at('2026-08-01') },
    '0009400004': { cik: '0009400004', sec: 'OFFICER DEE', roles: { officer: true, title: 'President' }, ...at('2026-08-02') },
  } }, { nowMs, price: 10 });
const vic = find(stale, /Vic Chair/);
ok(vic && vic.title === 'Executive Vice Chair' && !vic.ceo && find(stale, /Ned Newceo/)?.ceo, 'stale Form 4 title: ' + JSON.stringify(vic && [vic.title, vic.ceo]));
ok(!find(stale, /Paul Past/), 'a past executive with a newer non-officer filing is not current');
ok(find(stale, /Dee Officer/)?.director && find(stale, /Dee Officer/)?.officer, 'a director whose Form 4 ticks only officer is still a director');
ok(!find(stale, /Fred Former/) && !gone(stale, /Fred Former/), 'an executive listed only as former is left out');

// A 10% owner whose filed lines come to under 1% is a partial read, not its stake.
const small = buildCompanyView({ symbol: 'SML', cik: '0000555565', name: 'Small Co', proxy: doc(['Pat One', 'Pat Two', 'Pat Three'], []),
  owners: { '0009500001': { cik: '0009500001', sec: 'BIG FUND LP', roles: { tenPct: true }, ...at('2026-08-01'), lines: { a: { cls: 'common', di: 'D', shares: 5000, asOf: '2026-08-01' } } },
    '0009500002': { cik: '0009500002', sec: 'REAL FUND LLC', roles: { tenPct: true }, ...at('2026-08-02'), lines: { a: { cls: 'common', di: 'D', shares: 150_000, asOf: '2026-08-02' } } } } }, { nowMs, price: 10 });
ok(small.holders.length === 1 && /Real Fund/.test(small.holders[0].name) && small.holders[0].pctVoting === 15, 'holders under 1% dropped: ' + JSON.stringify(small.holders.map((h) => [h.name, h.pctVoting])));
ok(!small.people.some((p) => /Fund/.test(p.name)), 'funds are holders, not leaders');

// Trusts reported only as "See Footnote" are separate holdings, told apart
// by their footnotes (Broadcom's chair holds through several).
const fnXml = (posts, notes) => `<?xml version="1.0"?><ownershipDocument><documentType>4</documentType><periodOfReport>2026-09-23</periodOfReport>
<issuer><issuerCik>0000555567</issuerCik><issuerName>Fn Co</issuerName><issuerTradingSymbol>FNC</issuerTradingSymbol></issuer>
<reportingOwner><reportingOwnerId><rptOwnerCik>0009600001</rptOwnerCik><rptOwnerName>TRUSTEE TED</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isDirector>1</isDirector></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable>${posts.map((n, i) => `<nonDerivativeHolding><securityTitle><value>Common Stock</value></securityTitle><postTransactionAmounts><sharesOwnedFollowingTransaction><value>${n}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
<ownershipNature><directOrIndirectOwnership><value>I</value></directOrIndirectOwnership><natureOfOwnership><value>See Footnote</value><footnoteId id="F${i + 1}"/></natureOfOwnership></ownershipNature></nonDerivativeHolding>`).join('')}</nonDerivativeTable>
<footnotes>${notes.map((t, i) => `<footnote id="F${i + 1}">${t}</footnote>`).join('')}</footnotes></ownershipDocument>`;
const fnCo = {};
foldFiling(fnCo, parseOwnershipXml(fnXml([35_000_000, 4_600_000, 40_000_000], ['Held by the Samueli Family Trust (1).', 'Held by the Ted 2012 Trust.', 'Held by Fn Investments LP.'])), { acc: 'fn-1', filed: '2026-09-25', form: '4' });
ok(holdingTotals(fnCo.owners['0009600001']).total === 79_600_000, 'three footnoted trusts are three lines: ' + holdingTotals(fnCo.owners['0009600001']).total);
// The next filing renumbers the footnotes and reports one trust again.
foldFiling(fnCo, parseOwnershipXml(fnXml([34_000_000], ['Held by the Samueli Family Trust (2).'])), { acc: 'fn-2', filed: '2026-10-25', form: '4' });
ok(holdingTotals(fnCo.owners['0009600001']).total === 78_600_000, 'a later filing updates the same trust, not a new line: ' + holdingTotals(fnCo.owners['0009600001']).total);

// The ownership table is found by its numbers, not the first mentions of
// its heading (contents pages and cross-references come first).
const lorem = (k) => 'Lorem ipsum dolor sit amet. '.repeat(k);
let longProxy = 'Contents. Security Ownership of Certain Beneficial Owners and Management 45. ' + lorem(2000);
for (let i = 0; i < 10; i++) longProxy += 'see Security Ownership of Certain Beneficial Owners and Management. ' + lorem(800);
longProxy += 'SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT Name | Shares | Percent The Vanguard Group 1,234,567,890 | 9.1% BlackRock 987,654,321 | 7.2% ' + lorem(9000);
ok(sliceProxy(longProxy, 60_000).includes('The Vanguard Group 1,234,567,890'), 'the ownership table is in the slice even after ten earlier mentions');
ok(sliceProxy('Stock Ownership Guidelines ' + lorem(8000) + 'Stock Ownership Holdings of Major Shareholders Walton Enterprises 3,567,890,123 44.8% ' + lorem(8000), 60_000).includes('Walton Enterprises 3,567,890,123'), 'a "Stock Ownership" heading counts, the guidelines do not crowd it out');
// A table whose heading sits far above it (or is crowded out by number-heavy
// pay tables named "stock ownership") is still found by its group row.
let payHeavy = 'Security Ownership of Certain Beneficial Owners and Management 63. ' + lorem(3000);
for (let i = 0; i < 6; i++) payHeavy += 'Stock Ownership table ' + Array.from({ length: 120 }, (_, k) => '$' + ((k + 1) * 1_234_567).toLocaleString('en-US') + ' |').join(' ') + ' ' + lorem(600);
payHeavy += 'Principal holders The Vanguard Group 345,557,491 | 8.21 | % | BlackRock, Inc. 308,989,260 | 7.34 | % | ' + lorem(40) + Array.from({ length: 14 }, (_, k) => 'Director Number' + k + ' (' + (k + 4) + ') | ' + ((k + 2) * 101_313).toLocaleString('en-US') + ' | * |').join('\n ') + ' All current directors and executive officers as a group (16 persons) 52,413,364 | 1.24% ' + lorem(6000);
ok(sliceProxy(payHeavy, 60_000).includes('The Vanguard Group 345,557,491') && sliceProxy(payHeavy, 60_000).includes('as a group (16 persons) 52,413,364'), 'the ownership table is found by its group row');
// Line breaks in the HTML source do not split a table row.
ok(htmlToText('<table>\n<tr>\n<td>Reed Hastings (6)</td>\n<td>37,759,062</td>\n<td>*</td>\n</tr>\n</table>\n<p>Next\nline</p>') === 'Reed Hastings (6) | 37,759,062 | * | \n Next line', 'HTML source line breaks are spaces: ' + JSON.stringify(htmlToText('<table>\n<tr>\n<td>Reed Hastings (6)</td>\n<td>37,759,062</td>\n<td>*</td>\n</tr>\n</table>\n<p>Next\nline</p>')));
ok(htmlToText('Plain text\nfiling\nlines') === 'Plain text\nfiling\nlines', 'a plain-text document keeps its lines');
// Every list in the reply is capped.
const schemaCapped = (o) => Object.values(o.properties || {}).every((x) => (x.type !== 'array' || Number(x.maxItems) > 0) && (x.type !== 'array' || !x.items?.properties || schemaCapped(x.items)) && (x.type !== 'object' || schemaCapped(x)));
ok(schemaCapped(PROXY_SCHEMA), 'every array in the reply schema has maxItems');
// A model that refuses the caps gets the same schema without them.
let capCalls = 0;
class CapRefuser { constructor() { this.models = { generateContent: async (req) => { capCalls++; if (JSON.stringify(req.config.responseSchema).includes('maxItems')) throw new Error('{"error":{"code":400,"status":"INVALID_ARGUMENT"}}'); return { text: '{"board":[],"owners":[],"classes":[],"executives":[]}', candidates: [{ finishReason: 'STOP' }] }; } }; } }
const capRead = await extractProxyFacts({ message: 'x', model: 'test', deps: { GoogleGenAI: CapRefuser, apiKey: 'k', maxAttempts: 2 } });
ok(capCalls === 2 && capRead.calls === 1 && Array.isArray(capRead.json.board), 'a 400 on the list caps retries once without them');
// A 20-F that points to its annual report: the exhibit's board pages are added.
ok(refersToAnnualReport('Reference is made to pages 37-39 of our Annual Report 2025 for name, position and period of service as director for members of the Board of Directors as of the date hereof.') && !refersToAnnualReport('Our annual report on Form 20-F is filed with the SEC.'), 'a cross-reference to the annual report is spotted');
const idx = parseFilingIndex(`<table class="tableFile"><tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th><th>Size</th></tr>
<tr><td scope="row">1</td><td scope="row">20-F</td><td scope="row"><a href="/ix?doc=/Archives/edgar/data/353278/000035327826000006/nvo-20251231.htm">nvo-20251231.htm</a></td><td scope="row">20-F</td><td scope="row">6012345</td></tr>
<tr><td scope="row">2</td><td scope="row">ANNUAL REPORT 2025</td><td scope="row"><a href="/Archives/edgar/data/353278/000035327826000006/nvo-ex15_1.htm">nvo-ex15_1.htm</a></td><td scope="row">EX-15.1</td><td scope="row">4123456</td></tr>
<tr><td scope="row">3</td><td scope="row">CONSENT</td><td scope="row"><a href="/Archives/edgar/data/353278/000035327826000006/nvo-ex23_1.htm">nvo-ex23_1.htm</a></td><td scope="row">EX-23.1</td><td scope="row">4567</td></tr></table>`);
ok(idx.length === 3 && idx[0].file === 'nvo-20251231.htm' && annualReportExhibit(idx)?.file === 'nvo-ex15_1.htm', 'the annual report exhibit is found in the filing index: ' + JSON.stringify(annualReportExhibit(idx)));
ok(annualReportExhibit([{ type: 'EX-15.1', description: 'EX-15.1', file: 'nvo-20251231_d2.htm', size: 10_592_851 }, { type: 'EX-15.2', description: 'EX-15.2', file: 'consent.htm', size: 2547 }, { type: 'EX-2.1', description: 'EX-2.1', file: 'big.htm', size: 900_000 }])?.file === 'nvo-20251231_d2.htm', 'an unnamed large EX-15 page is taken as the annual report');
const annual = lorem(4000) + 'Board of Directors ' + lorem(200) + 'Board of Directors Lars Rebien Sorensen Chair. Born 1954. Nationality Danish. Elected 2025. Independent. Cees de Jong Vice chair. Born 1961. Elected 2025. ' + lorem(5000) + 'Shares and capital structure Novo Holdings A/S 107,487,200 A shares 77.1% of votes ' + lorem(5000);
const aSlice = sliceAnnualReport(annual, 30_000);
ok(aSlice.length <= 30_100 && aSlice.includes('Lars Rebien Sorensen Chair. Born 1954') && aSlice.includes('Novo Holdings A/S 107,487,200'), 'the annual report slice keeps the board biographies and the major shareholders');
// No proxy, but a 10-K/A (Part III) is read; a proxy is still preferred.
const subK = readSubmissions({ filings: { recent: { form: ['10-K/A', '10-K', '4'], filingDate: ['2026-04-29', '2026-02-11', '2026-08-31'], accessionNumber: ['k2', 'k1', 'f4'], primaryDocument: ['shop-20251231.htm', 'shop-20251231.htm', 'x.xml'], items: ['', '', ''] } } }, '0001594805', Date.parse('2026-11-12'));
ok(subK.doc?.form === '10-K/A' && subK.doc.acc === 'k2' && !subK.foreign, 'a 10-K/A with Part III is the document when there is no proxy');
const subP = readSubmissions({ filings: { recent: { form: ['10-K/A', 'DEF 14A'], filingDate: ['2026-06-01', '2026-03-01'], accessionNumber: ['k2', 'p1'], primaryDocument: ['a.htm', 'b.htm'], items: ['', ''] } } }, '0001594805', Date.parse('2026-11-12'));
ok(subP.doc?.form === 'DEF 14A', 'a proxy beats a newer 10-K/A');

// The site's own company name wins over EDGAR's capitals; A/S keeps its slash.
const named = buildCorporateViews({ companies: { SHP: { symbol: 'SHP', cik: '0000555566', name: 'SHOP CO INC', sub: { foreign: true, doc: null }, owners: {}, sweep: { at: '2026-11-12T00:00:00Z', through: '2026-11-12', pending: [] } } }, people: {} }, { nowMs, names: { SHP: 'Shop Co.,  Inc.' } });
ok(named.SHP.name === 'Shop Co., Inc.' && prettyCompanyName('NOVO NORDISK A S') === 'Novo Nordisk A/S' && prettyCompanyName('JPMORGAN CHASE & CO') === 'Jpmorgan Chase & Co', 'display name: ' + named.SHP.name);
// A padded table row (each cell its own paragraph, many empty cells) reads
// as one line (Netflix's ownership table took a tenth of the room after this).
ok(htmlToText('<table><tr><td><p>Leslie Kilgore (9)</p></td><td></td><td></td><td><p>458,671</p></td><td></td><td><p>*</p></td></tr><tr><td><p>Strive Masiyiwa</p></td><td><p>41,641</p></td></tr></table><p>Next</p>') === 'Leslie Kilgore (9) | 458,671 | * | \n Strive Masiyiwa | 41,641 | \n Next', 'padded table rows read as one line each');
// A count printed in millions (Novo Nordisk's "1,075 million shares").
ok(hasInteger('consisting of 1,075 million shares and 3.39 billion b shares; 4.5 billion in all; 120 million', 1_075_000_000) && hasInteger('3.39 billion b', 3_390_000_000) && !hasInteger('4.5 billion', 4_500_000_000) && !hasInteger('120 million', 120_000_000) && !hasInteger('1,075 million', 1_076_000_000), 'counts printed in millions or billions');
// The board role is one value from a fixed list (a free list looped on the
// live GS, MDB and SHOP proxies), mapped back to roles; lists are deduped.
const boardItem = PROXY_SCHEMA.properties.board.items.properties;
ok(!boardItem.roles && boardItem.boardRole?.type === 'string' && JSON.stringify(boardItem.boardRole.enum) === JSON.stringify(BOARD_ROLES), 'board role is one value from a fixed list');
const gh = checked.facts.board.find((d) => d.name === 'Grace Holder');
const rsb = checked.facts.board.find((d) => d.name === 'Robert Sample');
ok(rsb.roles.join() === 'Chair of the Board' && gh.roles.join() === 'Lead Independent Director' && gh.committees.join('|') === 'Audit Committee|Compensation Committee', 'board role mapped to roles, committees once each: ' + JSON.stringify(gh));
const roleText = 'mary one serves as chairman. joe two is a director. pat three is vice chair.';
const roleCheck = checkProxyFacts({ board: [{ name: 'Mary One', boardRole: 'Chair of the Board' }, { name: 'Joe Two', boardRole: 'Lead Independent Director' }, { name: 'Pat Three', boardRole: 'Supreme Leader' }, { name: 'Pat Three', boardRole: 'Vice Chair' }], owners: [], classes: [], executives: [] }, roleText);
ok(roleCheck.facts.board[0].roles.join() === 'Chair of the Board' && !roleCheck.facts.board[1].roles.length && !roleCheck.facts.board[2].roles.length, 'a role the document never names, or one off the list, is dropped: ' + JSON.stringify(roleCheck.facts.board.map((b) => b.roles)));
const legacy = checkProxyFacts({ board: [{ name: 'Mary One', roles: ['Chair of the Board', 'Chair of the Board', 'Chair of the Board'] }], owners: [], classes: [], executives: [] }, roleText);
ok(legacy.facts.board[0].roles.length === 1, 'an older reply with repeated roles keeps one');
// A reply cut off part way: every finished value is kept, brackets closed.
ok(JSON.stringify(salvageJson('{"board":[{"name":"A B","roles":["Chair","Chair","Ch')) === '{"board":[{"name":"A B","roles":["Chair","Chair"]}]}', 'cut-off reply salvaged');
ok(JSON.stringify(salvageJson('{"a":"x\\"y,z","b":[1,2')) === '{"a":"x\\"y,z","b":[1]}' && salvageJson('no json') === null && salvageJson('{"a":1}').a === 1, 'salvage keeps quoted commas and escapes');
// Both replies cut off: the larger salvage is kept, marked partial.
let cutCalls = 0;
class CutOff { constructor() { this.models = { generateContent: async () => { cutCalls++; const t = cutCalls === 1 ? '{"board":[{"name":"A One"},{"name":"B Two"},{"na' : '{"board":[{"name":"A One"},{"name":"B Two"},{"name":"C Three","roles":["Chair","Chair","Ch'; return { text: t, candidates: [{ finishReason: 'MAX_TOKENS' }] }; } }; } }
const cutRead = await extractProxyFacts({ message: 'x', model: 'test', deps: { GoogleGenAI: CutOff, apiKey: 'k', maxAttempts: 1 } });
ok(cutRead.partial === true && cutRead.calls === 2 && cutRead.json.board.length === 3 && /cut off/.test(cutRead.firstError), 'two cut-off replies: the larger salvage, marked partial');
// A partial read ends nobody's board seat and says it is partial.
const partialState = (partial) => ({ companies: { PRT: { symbol: 'PRT', cik: '0000777001', name: 'PART CO', sub: { doc: { acc: 'p1', form: 'DEF 14A', filed: '2026-04-01' } }, sweep: { at: '2026-11-12T00:00:00Z', through: '2026-11-12', pending: [] },
  proxy: { status: 'ok', v: 4, acc: 'p1', form: 'DEF 14A', filed: '2026-04-01', partial, facts: { board: [{ name: 'Ann One', roles: [], committees: [], chairOf: [], otherBoards: [] }, { name: 'Ben Two', roles: [], committees: [], chairOf: [], otherBoards: [] }, { name: 'Cat Three', roles: [], committees: [], chairOf: [], otherBoards: [] }], executives: [], owners: [], classes: [] }, kept: 3, dropped: [] },
  owners: { '0000777101': { cik: '0000777101', sec: 'FOUR DAN', roles: { director: true }, lines: {}, tx: [], filings: 1, first: '2026-01-05', last: '2026-01-05', rolesFiled: '2026-01-05', lastAcc: 'd4' } } } }, people: {} });
const fullV = buildCorporateViews(partialState(false), { nowMs }).PRT, partV = buildCorporateViews(partialState(true), { nowMs }).PRT;
ok(fullV.former.some((p) => /Dan/.test(p.name)) && partV.people.some((p) => /Dan/.test(p.name)) && partV.source.doc.partial && /Only part/.test(partV.source.notes[0]), 'a partial read ends no board seat and says so: ' + JSON.stringify({ full: fullV.former.map((p) => p.name), part: partV.people.map((p) => p.name), notes: partV.source.notes }));

// A swept company with no filings and no document gets an empty view that
// says so (a foreign filer that files neither a proxy nor Forms 3/4/5).
const emptyViews = buildCorporateViews({ companies: { SHP: { symbol: 'SHP', cik: '0000555566', name: 'SHOP CO INC', sub: { foreign: true, doc: null }, owners: {}, sweep: { at: '2026-11-12T00:00:00Z', through: '2026-11-12', pending: [] } } }, people: {} }, { nowMs });
ok(emptyViews.SHP?.empty === true && emptyViews.SHP.name === 'Shop Co Inc' && emptyViews.SHP.source?.edgar && !emptyViews.SHP.people, 'empty view: ' + JSON.stringify(emptyViews.SHP));

console.log(`corporate-structure-smoke: ${n} checks passed`);
