import { parseOwnership13FXml, buildOwnershipFund } from '../../lib/ownership-13f.mjs';
export const ownershipNow = '2026-10-29T16:00:00Z';
export function ownershipCover(rows, { amendmentType = '', reportingManagers = [] } = {}) {
  return '<edgarSubmission><amendmentType>' + amendmentType + '</amendmentType><summaryPage><tableEntryTotal>' + rows.length + '</tableEntryTotal><tableValueTotal>' + rows.reduce((sum, r) => sum + (r.value ?? 100000), 0) + '</tableValueTotal></summaryPage><otherManagersInfo>' + reportingManagers.map(r => '<otherManager><cik>' + r.cik + '</cik><name>' + r.name + '</name></otherManager>').join('') + '</otherManagersInfo></edgarSubmission>';
}
export function ownershipXml(rows) {
  return '<informationTable>' + rows.map(r => '<infoTable><nameOfIssuer>' + (r.name || 'Atlas Fabrication Inc') + '</nameOfIssuer><titleOfClass>' + (r.cls || 'COM') + '</titleOfClass><cusip>' + (r.cusip || '000000AA1') + '</cusip><value>' + (r.value ?? 100000) + '</value><shrsOrPrnAmt><sshPrnamt>' + (r.shares ?? 1000) + '</sshPrnamt><sshPrnamtType>' + (r.sharesType || 'SH') + '</sshPrnamtType></shrsOrPrnAmt>' + (r.putCall ? '<putCall>' + r.putCall + '</putCall>' : '') + '<investmentDiscretion>SOLE</investmentDiscretion><votingAuthority><Sole>900</Sole><Shared>0</Shared><None>100</None></votingAuthority></infoTable>').join('') + '</informationTable>';
}
export function ownershipFixture() {
  const latest = { reportDate: '2026-06-30', filingDate: '2026-08-12', form: '13F-HR', accessionNumber: '0000000001-26-000002' };
  const prior = { reportDate: '2026-03-31', filingDate: '2026-05-12', form: '13F-HR', accessionNumber: '0000000001-26-000001' };
  const currentUrl = 'https://www.sec.gov/Archives/edgar/data/1/000000000126000002/info.xml';
  const priorUrl = 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/info.xml';
  const map = new Map([['000000AA1', 'ATLS'], ['000000BB1', 'EXIT']]);
  const raw = rows => parseOwnership13FXml(ownershipXml(rows), { filingDate: latest.filingDate, sourceUrl: currentUrl, accession: latest.accessionNumber });
  const priorRaw = parseOwnership13FXml(ownershipXml([{ value: 100000, shares: 1000 }, { cusip: '000000BB1', name: 'Exited Company', value: 10000, shares: 100 }]), { filingDate: prior.filingDate, sourceUrl: priorUrl, accession: prior.accessionNumber });
  const chains = { ATLS: { fundamentals: { name: 'Atlas Fabrication Inc' }, priceSeries: [{ t: '2026-03-31', c: 100 }, { t: '2026-06-30', c: 125 }] } };
  const f = { cik: '1', latest, prior, latestFetchOk: true, priorFetchOk: true, latestUrl: currentUrl,
    latestDisclosures: raw([{ value: 125000, shares: 1000 }, { value: 25000, shares: 200, putCall: 'Call' }, { value: 12500, shares: 100, putCall: 'Put' }, { cusip: '000000ZZ1', name: 'Unmapped &amp; Company', cls: 'NOTE', sharesType: 'PRN', value: 25000, shares: 25000 },
      ...Array.from({ length: 90 }, (_, i) => ({ cusip: 'TAIL' + i, name: 'Small unchanged ' + i, value: 10, shares: 1 }))]), priorDisclosures: priorRaw };
  const first = { firm: 'Atlas Capital', filingDate: latest.filingDate, reportDate: latest.reportDate, ...buildOwnershipFund(f, map, chains) };
  const second = { ...first, firm: 'Birch Partners', cik: '2', reportedValue: 20000, performance: { ...first.performance, pct: -5 }, holdings: first.holdings.filter(r => r.ticker === 'ATLS').map(r => ({ ...r, valueNow: r.valueNow / 10, sharesNow: r.sharesNow / 10 })) };
  return { data: { builtAtIso: ownershipNow, period: 'Q2 2026', periodEnd: 'June 30, 2026', periodEndIso: latest.reportDate,
    totalFirms: 3, realFirms: 2, explorerVersion: 1, topFirms: [{ firm: first.firm, cik: '1', aumBillions: 10, kind: 'Value' }, { firm: second.firm, cik: '2', aumBillions: 50, kind: 'Quant' }, { firm: 'Missing Manager', cik: '3', aumBillions: 5, kind: 'Growth' }],
    perFirm: { [first.firm]: first, [second.firm]: second, 'Missing Manager': null }, ownershipCoverage: { fullFunds: 2, unmappedPositions: 91 },
    insiderTransactions: { transactions: [{ ticker: 'ATLS', issuerName: 'Atlas Fabrication', transactionDate: '2026-10-20', ownerName: 'Test Insider', roles: ['Director'], code: 'P', shares: 10, price: 0.4, value: 4, url: currentUrl }] } }, f, map, chains, raw };
}
