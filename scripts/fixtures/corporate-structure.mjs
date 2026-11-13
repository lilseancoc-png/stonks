// Stand-in SEC responses for the corporate-structure tests. Two made-up
// companies: Example Tech (one share class) and Example Social (Class A one
// vote, Class B ten votes, a founder with most of the votes). Names, numbers
// and filings are invented; only the document shapes match the SEC's.

export const TECH_CIK = '0000900001';
export const SOCIAL_CIK = '0000900002';

export function form4Xml({ issuerCik, issuerName = 'Example', symbol = 'EXT', form = '4', ownerCik, ownerName, director = false, officer = false, title = null, tenPct = false, rows = [], holdings = [], extraOwners = [] }) {
  const owner = (cik, name, d, o, t, p) => `<reportingOwner><reportingOwnerId><rptOwnerCik>${cik}</rptOwnerCik><rptOwnerName>${name}</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isDirector>${d ? 1 : 0}</isDirector><isOfficer>${o ? 1 : 0}</isOfficer>${t ? `<officerTitle>${t}</officerTitle>` : ''}<isTenPercentOwner>${p ? 1 : 0}</isTenPercentOwner><isOther>0</isOther></reportingOwnerRelationship></reportingOwner>`;
  const tx = rows.map((r) => `<nonDerivativeTransaction><securityTitle><value>${r.title || 'Common Stock'}</value></securityTitle><transactionDate><value>${r.date}</value></transactionDate>
<transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${r.code}</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>${r.shares}</value></transactionShares><transactionPricePerShare>${r.price != null ? `<value>${r.price}</value>` : '<footnoteId id="F1"/>'}</transactionPricePerShare><transactionAcquiredDisposedCode><value>${r.ad}</value></transactionAcquiredDisposedCode></transactionAmounts>
<postTransactionAmounts><sharesOwnedFollowingTransaction><value>${r.post}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
<ownershipNature><directOrIndirectOwnership><value>${r.di || 'D'}</value></directOrIndirectOwnership>${r.nature ? `<natureOfOwnership><value>${r.nature}</value><footnoteId id="F2"/></natureOfOwnership>` : ''}</ownershipNature></nonDerivativeTransaction>`).join('\n');
  const hold = holdings.map((h) => `<nonDerivativeHolding><securityTitle><value>${h.title || 'Common Stock'}</value></securityTitle>
<postTransactionAmounts><sharesOwnedFollowingTransaction><value>${h.post}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
<ownershipNature><directOrIndirectOwnership><value>${h.di || 'D'}</value></directOrIndirectOwnership>${h.nature ? `<natureOfOwnership><value>${h.nature}</value></natureOfOwnership>` : ''}</ownershipNature></nonDerivativeHolding>`).join('\n');
  return `<?xml version="1.0"?>
<ownershipDocument><schemaVersion>X0508</schemaVersion><documentType>${form}</documentType><periodOfReport>${(rows[0] || {}).date || '2026-01-02'}</periodOfReport>
<issuer><issuerCik>${issuerCik}</issuerCik><issuerName>${issuerName}</issuerName><issuerTradingSymbol>${symbol}</issuerTradingSymbol></issuer>
${owner(ownerCik, ownerName, director, officer, title, tenPct)}
${extraOwners.map((x) => owner(x.cik, x.name, false, false, null, true)).join('\n')}
<nonDerivativeTable>${tx}${hold}</nonDerivativeTable>
<footnotes><footnote id="F1">Restricted stock units settled.</footnote><footnote id="F2">Held by the Reporting Person's family trust.</footnote></footnotes>
</ownershipDocument>`;
}

// EDGAR full-text search: newest first, plus a count per filer across every
// match (aggregations.entity_filter), like the real endpoint.
export function eftsJson(rows, total = rows.length, extraEntities = []) {
  const sorted = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const counts = new Map();
  for (const r of rows) for (const n of r.names) counts.set(n, (counts.get(n) || 0) + 1);
  for (const [n, k] of extraEntities) counts.set(n, (counts.get(n) || 0) + k);
  return {
    hits: { total: { value: total, relation: 'eq' }, hits: sorted.map((r) => ({ _id: `${r.acc}:${r.file}`, _source: { ciks: r.ciks, display_names: r.names, form: r.form, file_date: r.date, adsh: r.acc, root_forms: [r.form] } })) },
    aggregations: { entity_filter: { buckets: [...counts].map(([key, doc_count]) => ({ key, doc_count })) } },
  };
}

export function submissionsJson({ name, rows, tickers = [] }) {
  const cols = { accessionNumber: [], filingDate: [], form: [], primaryDocument: [], items: [] };
  for (const r of rows) { cols.accessionNumber.push(r.acc); cols.filingDate.push(r.filed); cols.form.push(r.form); cols.primaryDocument.push(r.file || 'doc.htm'); cols.items.push(r.items || ''); }
  return { name, tickers, exchanges: ['Nasdaq'], insiderTransactionForIssuerExists: 1, filings: { recent: cols } };
}

// The proxy document for Example Tech: board, executives and ownership table.
export const TECH_PROXY_HTML = `<html><body>
<p>The record date is February 2, 2026. On the record date there were 1,000,000,000 shares of common stock outstanding. Each share is entitled to one vote.</p>
<h2>Director Nominees</h2>
<p>Ada Example, age 52, Director since 2021. Ada Example is Chief Executive Officer of Example Tech.</p>
<p>Robert Sample, age 67, Director since 2009, Chair of the Board. Mr. Sample is the retired Chief Executive Officer of Sample Industries. He also serves on the board of Other Motors Inc.</p>
<p>Grace Holder, age 59, Director since 2015, Lead Independent Director. Ms. Holder is a partner at Holder Ventures. Member of the Audit Committee and Chair of the Compensation Committee.</p>
<h2>Director Independence</h2><p>The Board has determined that Robert Sample and Grace Holder are independent.</p>
<h2>Executive Officers</h2><p>Ben Money, age 48, Chief Financial Officer since 2020; joined the company in 2012.</p>
<h2>Security Ownership of Certain Beneficial Owners and Management</h2>
<table><tr><td>Name</td><td>Shares</td><td>Percent</td></tr>
<tr><td>Big Index Fund Group</td><td>82,500,000</td><td>8.25%</td></tr>
<tr><td>Ada Example</td><td>1,250,000</td><td>*</td></tr>
<tr><td>Robert Sample</td><td>410,000</td><td>*</td></tr>
<tr><td>All directors and executive officers as a group (4 persons)</td><td>1,912,345</td><td>0.19%</td></tr></table>
</body></html>`;

// What the model returns for it, with two planted mistakes the checker must
// drop: a director the document never names and a share count it never prints.
export const TECH_PROXY_AI = {
  recordDate: 'February 2, 2026',
  classes: [{ name: 'Common stock', votesPerShare: 1, outstanding: 1000000000, listed: true }],
  controlledCompany: false,
  controlNote: null,
  board: [
    { name: 'Ada Example', age: 52, directorSince: 2021, independent: false, roles: [], committees: [], chairOf: [], occupation: 'Chief Executive Officer of Example Tech', otherBoards: [] },
    { name: 'Robert Sample', age: 67, directorSince: 2009, independent: true, boardRole: 'Chair of the Board', committees: [], chairOf: [], occupation: 'Retired Chief Executive Officer of Sample Industries', otherBoards: [{ company: 'Other Motors Inc.', current: true }] },
    { name: 'Grace Holder', age: 59, directorSince: 2015, independent: true, boardRole: 'Lead Independent Director', committees: ['Audit Committee', 'Compensation Committee', 'Audit Committee'], chairOf: ['Compensation Committee'], occupation: 'Partner at Holder Ventures', otherBoards: [] },
    { name: 'Phantom Person', age: 50, directorSince: 2020, independent: true, roles: [], committees: [], chairOf: [], occupation: null, otherBoards: [] },
  ],
  executives: [{ name: 'Ben Money', title: 'Chief Financial Officer', age: 48, since: 2020, joined: 2012 }],
  owners: [
    { name: 'Big Index Fund Group', kind: 'holder', holdings: [{ className: 'Common stock', shares: 82500000, percent: 8.25 }], votingPercent: null },
    { name: 'Ada Example', kind: 'director', holdings: [{ className: 'Common stock', shares: 1250000, percent: null }], votingPercent: null },
    { name: 'Robert Sample', kind: 'director', holdings: [{ className: 'Common stock', shares: 999999, percent: null }], votingPercent: null },
    { name: 'All directors and executive officers as a group (4 persons)', kind: 'group', holdings: [{ className: 'Common stock', shares: 1912345, percent: 0.19 }], votingPercent: null },
  ],
};

export const SOCIAL_PROXY_HTML = `<html><body>
<p>Record date: March 1, 2026. Class A common stock: 2,200,000,000 shares outstanding, one vote per share. Class B common stock: 340,000,000 shares outstanding, ten votes per share. We are a "controlled company" under Nasdaq rules.</p>
<h2>Nominees for Director</h2><p>Sam Founder, age 41, Director since 2004, Chair and Chief Executive Officer.</p><p>Lee Outside, age 60, Director since 2019, independent.</p>
<h2>Security Ownership of Certain Beneficial Owners and Management</h2>
<table><tr><td>Sam Founder</td><td>Class A 1,000,000</td><td>Class B 300,000,000</td><td>88.2%</td><td>% of total voting power 54.5%</td></tr></table>
<p>Sam Founder controls a majority of the voting power, 54.5%.</p>
</body></html>`;
export const SOCIAL_PROXY_AI = {
  recordDate: 'March 1, 2026',
  classes: [{ name: 'Class A common stock', votesPerShare: 1, outstanding: 2200000000, listed: true }, { name: 'Class B common stock', votesPerShare: 10, outstanding: 340000000, listed: false }],
  controlledCompany: true,
  controlNote: 'Sam Founder controls a majority of the voting power, 54.5%.',
  board: [
    { name: 'Sam Founder', age: 41, directorSince: 2004, independent: false, roles: ['Chair'], committees: [], chairOf: [], occupation: 'Chief Executive Officer', otherBoards: [] },
    { name: 'Lee Outside', age: 60, directorSince: 2019, independent: true, roles: [], committees: [], chairOf: [], occupation: null, otherBoards: [] },
  ],
  executives: [],
  owners: [{ name: 'Sam Founder', kind: 'director', holdings: [{ className: 'Class A', shares: 1000000, percent: null }, { className: 'Class B', shares: 300000000, percent: 88.2 }], votingPercent: 54.5 }],
};

// A fake fetch serving both companies, plus each person's own filings.
export function fakeSec({ now = '2026-11-12', failOnce = [] } = {}) {
  const docs = new Map();
  const calls = [];
  const failed = new Set();
  const put = (url, body) => docs.set(url, typeof body === 'string' ? body : JSON.stringify(body));
  // Example Tech
  put(`https://data.sec.gov/submissions/CIK${TECH_CIK}.json`, submissionsJson({ name: 'Example Tech Inc.', tickers: ['EXT'], rows: [
    { form: 'DEF 14A', filed: '2026-02-20', acc: '0000900001-26-000010', file: 'proxy2026.htm' },
    { form: '10-K', filed: '2025-11-01', acc: '0000900001-25-000090', file: 'ext10k.htm' },
    { form: '8-K', filed: '2026-08-28', acc: '0000900001-26-000050', file: 'ext8k.htm', items: '5.02,9.01' },
    { form: '4', filed: '2026-10-05', acc: '0000900009-26-000101', file: 'xslF345X05/form4.xml' },
  ] }));
  const techRows = [
    { acc: '0000900009-26-000101', file: 'form4.xml', form: '4', date: '2026-10-05', ciks: ['0002000001', TECH_CIK], names: ['Example Ada  (CIK 0002000001)', 'Example Tech Inc.  (EXT)  (CIK 0000900001)'] },
    { acc: '0000900009-26-000090', file: 'form3.xml', form: '3', date: '2026-09-01', ciks: ['0002000001', TECH_CIK], names: ['Example Ada  (CIK 0002000001)', 'Example Tech Inc.  (EXT)  (CIK 0000900001)'] },
    { acc: '0000900009-26-000080', file: 'form4.xml', form: '4', date: '2026-03-02', ciks: ['0002000002', TECH_CIK], names: ['SAMPLE ROBERT J  (CIK 0002000002)', 'Example Tech Inc.  (EXT)  (CIK 0000900001)'] },
    { acc: '0000900009-26-000070', file: 'form4.xml', form: '4', date: '2026-04-15', ciks: ['0002000003', TECH_CIK], names: ['Money Ben  (CIK 0002000003)', 'Example Tech Inc.  (EXT)  (CIK 0000900001)'] },
    { acc: '0000900009-24-000010', file: 'form4.xml', form: '4', date: '2025-06-10', ciks: ['0002000004', TECH_CIK], names: ['GONE GORDON  (CIK 0002000004)', 'Example Tech Inc.  (EXT)  (CIK 0000900001)'] },
  ];
  docsForEfts(TECH_CIK, techRows);
  const techUrl = (acc, file) => `https://www.sec.gov/Archives/edgar/data/900001/${acc.replace(/-/g, '')}/${file}`;
  put(techUrl('0000900009-26-000101', 'form4.xml'), form4Xml({ issuerCik: TECH_CIK, ownerCik: '0002000001', ownerName: 'Example Ada', director: true, officer: true, title: 'CEO',
    rows: [{ date: '2026-10-01', code: 'M', shares: 50000, ad: 'A', post: 120000, di: 'I', nature: 'By Trust' }, { date: '2026-10-02', code: 'S', shares: 20000, price: 300.5, ad: 'D', post: 100000, di: 'I', nature: 'By Trust' }],
    holdings: [{ post: 25000, di: 'D' }] }));
  put(techUrl('0000900009-26-000090', 'form3.xml'), form4Xml({ issuerCik: TECH_CIK, form: '3', ownerCik: '0002000001', ownerName: 'Example Ada', director: false, officer: true, title: 'SVP Hardware', holdings: [{ post: 70000, di: 'I', nature: 'By Trust' }] }));
  put(techUrl('0000900009-26-000080', 'form4.xml'), form4Xml({ issuerCik: TECH_CIK, ownerCik: '0002000002', ownerName: 'SAMPLE ROBERT J', director: true, rows: [{ date: '2026-02-27', code: 'A', shares: 1200, price: 0, ad: 'A', post: 410000 }] }));
  put(techUrl('0000900009-26-000070', 'form4.xml'), form4Xml({ issuerCik: TECH_CIK, ownerCik: '0002000003', ownerName: 'Money Ben', officer: true, title: 'Chief Financial Officer', rows: [{ date: '2026-04-14', code: 'P', shares: 1000, price: 250, ad: 'A', post: 61000 }] }));
  put(techUrl('0000900009-24-000010', 'form4.xml'), form4Xml({ issuerCik: TECH_CIK, ownerCik: '0002000004', ownerName: 'GONE GORDON', director: true, rows: [{ date: '2025-06-09', code: 'S', shares: 500, price: 200, ad: 'D', post: 9000 }] }));
  put(`https://www.sec.gov/Archives/edgar/data/900001/000090000126000010/proxy2026.htm`, TECH_PROXY_HTML);
  // Example Social (dual class)
  put(`https://data.sec.gov/submissions/CIK${SOCIAL_CIK}.json`, submissionsJson({ name: 'Example Social Inc.', tickers: ['EXS'], rows: [
    { form: 'DEF 14A', filed: '2026-04-10', acc: '0000900002-26-000020', file: 'social-proxy.htm' },
    { form: '4', filed: '2026-09-15', acc: '0000900008-26-000201', file: 'xslF345X05/form4.xml' },
  ] }));
  const socialRows = [
    { acc: '0000900008-26-000201', file: 'form4.xml', form: '4', date: '2026-09-15', ciks: ['0002000010', SOCIAL_CIK], names: ['FOUNDER SAM  (CIK 0002000010)', 'Example Social Inc.  (EXS)  (CIK 0000900002)'] },
    { acc: '0000900008-26-000150', file: 'form4.xml', form: '4', date: '2026-05-20', ciks: ['0002000002', SOCIAL_CIK], names: ['SAMPLE ROBERT J  (CIK 0002000002)', 'Example Social Inc.  (EXS)  (CIK 0000900002)'] },
  ];
  docsForEfts(SOCIAL_CIK, socialRows);
  const socialUrl = (acc, file) => `https://www.sec.gov/Archives/edgar/data/900002/${acc.replace(/-/g, '')}/${file}`;
  put(socialUrl('0000900008-26-000201', 'form4.xml'), form4Xml({ issuerCik: SOCIAL_CIK, ownerCik: '0002000010', ownerName: 'FOUNDER SAM', director: true, officer: true, title: 'Chair and CEO', tenPct: true,
    rows: [{ date: '2026-09-12', code: 'S', title: 'Class A Common Stock', shares: 50000, price: 600, ad: 'D', post: 950000 }],
    holdings: [{ title: 'Class B Common Stock', post: 300000000, di: 'I', nature: 'By Founder Trust' }] }));
  put(socialUrl('0000900008-26-000150', 'form4.xml'), form4Xml({ issuerCik: SOCIAL_CIK, ownerCik: '0002000002', ownerName: 'SAMPLE ROBERT J', director: true, rows: [{ date: '2026-05-19', code: 'A', title: 'Class A Common Stock', shares: 900, price: 0, ad: 'A', post: 15000 }] }));
  put(`https://www.sec.gov/Archives/edgar/data/900002/000090000226000020/social-proxy.htm`, SOCIAL_PROXY_HTML);
  // People: Robert Sample sits on both boards; Ada joined Example Tech in 2026.
  put('person:0002000002', eftsJson([
    { acc: '0000900008-26-000150', file: 'form4.xml', form: '4', date: '2026-05-20', ciks: ['0002000002', SOCIAL_CIK], names: ['SAMPLE ROBERT J  (CIK 0002000002)', 'Example Social Inc.  (EXS)  (CIK 0000900002)'] },
    { acc: '0000900009-26-000080', file: 'form4.xml', form: '4', date: '2026-03-02', ciks: ['0002000002', TECH_CIK], names: ['SAMPLE ROBERT J  (CIK 0002000002)', 'Example Tech Inc.  (EXT)  (CIK 0000900001)'] },
    { acc: '0000900007-10-000001', file: 'form3.xml', form: '3', date: '2009-05-01', ciks: ['0002000002', TECH_CIK], names: ['SAMPLE ROBERT J  (CIK 0002000002)', 'Example Tech Inc.  (EXT)  (CIK 0000900001)'] },
    { acc: '0000900006-19-000001', file: 'form3.xml', form: '3', date: '2019-02-01', ciks: ['0002000002', SOCIAL_CIK], names: ['SAMPLE ROBERT J  (CIK 0002000002)', 'Example Social Inc.  (EXS)  (CIK 0000900002)'] },
    { acc: '0000900005-26-000001', file: 'form4.xml', form: '4', date: '2026-06-01', ciks: ['0002000002', '0000777777'], names: ['SAMPLE ROBERT J  (CIK 0002000002)', 'Other Motors Inc.  (OTM)  (CIK 0000777777)'] },
  ], 160, [['OLD RAIL CO  (ORC)  (CIK 0000666666)', 12]]));
  put('https://www.sec.gov/Archives/edgar/data/777777/000090000526000001/form4.xml', form4Xml({ issuerCik: '0000777777', ownerCik: '0002000002', ownerName: 'SAMPLE ROBERT J', director: true, rows: [{ date: '2026-05-30', code: 'A', shares: 100, price: 0, ad: 'A', post: 5000 }] }));
  function docsForEfts(cik, rows) { put('issuer:' + cik, eftsJson(rows)); }

  async function fetchImpl(url) {
    calls.push(url);
    // A passing server error, once per matching URL.
    const flaky = failOnce.find((re) => re.test(url));
    if (flaky && !failed.has(url)) { failed.add(url); return new Response('busy', { status: 500 }); }
    const u = new URL(url);
    let key = url;
    if (u.hostname === 'efts.sec.gov') {
      const cik = u.searchParams.get('ciks');
      // The real search returns nothing when "4/A" is in the forms filter.
      if (/\//.test(u.searchParams.get('forms') || '')) return new Response(JSON.stringify(eftsJson([])), { status: 200 });
      key = (cik === TECH_CIK || cik === SOCIAL_CIK ? 'issuer:' : 'person:') + cik;
      if (!docs.has(key)) return new Response(JSON.stringify(eftsJson([])), { status: 200 });
      if (key.startsWith('person:') && /^3/.test(u.searchParams.get('forms') || '') && !u.searchParams.get('forms').includes('4')) {
        const all = JSON.parse(docs.get(key));
        all.hits.hits = all.hits.hits.filter((h) => h._source.form === '3');
        return new Response(JSON.stringify(all), { status: 200 });
      }
    }
    if (!docs.has(key)) return new Response('not found', { status: 404 });
    return new Response(docs.get(key), { status: 200 });
  }
  return { fetchImpl, calls, now };
}

export function fakeAi(map) {
  class FakeGenAI {
    constructor() { this.models = { generateContent: async ({ contents }) => {
      const hit = Object.entries(map).find(([k]) => contents.includes(k));
      if (!hit) throw new Error('no fixture for this document');
      return { text: JSON.stringify(hit[1]), usageMetadata: { promptTokenCount: Math.round(contents.length / 4), candidatesTokenCount: 800 } };
    } }; }
  }
  return FakeGenAI;
}
