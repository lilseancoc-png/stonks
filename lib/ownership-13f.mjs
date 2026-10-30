import { closeOnOrBefore, issuerNameKey, splitFactor } from './leverage-distress.mjs';

const finite = n => typeof n === 'number' && Number.isFinite(n);
const sum = (rows, key) => rows.reduce((n, r) => n + (finite(r[key]) ? r[key] : 0), 0);
const decode = s => String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
export function ownershipXmlTag(xml, tag) {
  return decode((String(xml).match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i')) || [])[1]).trim();
}
export function parseOwnershipCover(xml, filingDate) {
  const clean = String(xml).replace(/(<\/?)[\w-]+:/g, '$1');
  const num = tag => { const raw = ownershipXmlTag(clean, tag); return raw && Number.isFinite(Number(raw)) ? Number(raw) : null; };
  const scale = filingDate < '2023-01-03' ? 1000 : 1;
  const noticeBlock = (clean.match(/<otherManagersInfo\b[^>]*>[\s\S]*?<\/otherManagersInfo>/i) || [])[0] || '';
  const reportingManagers = [...noticeBlock.matchAll(/<otherManager\b[^>]*>([\s\S]*?)<\/otherManager>/gi)].map(m => ({
    cik: ownershipXmlTag(m[1], 'cik').replace(/^0+/, ''), name: ownershipXmlTag(m[1], 'name'),
  })).filter(m => /^\d+$/.test(m.cik));
  return { amendmentType: ownershipXmlTag(clean, 'amendmentType').toUpperCase(),
    cik: ownershipXmlTag(clean, 'cik').replace(/^0+/, ''),
    reportPeriod: ownershipXmlTag(clean, 'reportCalendarOrQuarter').replace(/^(\d{2})-(\d{2})-(\d{4})$/, '$3-$1-$2'),
    reportType: ownershipXmlTag(clean, 'reportType'), entries: num('tableEntryTotal'),
    value: num('tableValueTotal') == null ? null : num('tableValueTotal') * scale,
    reportingManagers };
}

export function validateOwnershipTable(rows, cover) {
  if (!Number.isSafeInteger(cover.entries) || cover.entries < 0 || !finite(cover.value) || cover.value < 0) throw new Error('SEC cover totals unavailable');
  if (rows.length !== cover.entries) throw new Error(`SEC cover reports ${cover.entries} rows; parsed ${rows.length}`);
  const value = sum(rows, 'value');
  if (Math.abs(value - cover.value) > 1) throw new Error(`SEC cover value ${cover.value} differs from parsed value ${value}`);
}
export function parseOwnership13FXml(xml, { filingDate, sourceUrl = null, accession = null } = {}) {
  const clean = String(xml).replace(/(<\/?)[\w-]+:/g, '$1');
  const scale = filingDate && filingDate < '2023-01-03' ? 1000 : 1;
  const number = (block, tag) => {
    const raw = ownershipXmlTag(block, tag);
    return raw && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null;
  };
  return (clean.match(/<infoTable\b[^>]*>[\s\S]*?<\/infoTable>/gi) || []).flatMap(block => {
    const cusip = ownershipXmlTag(block, 'cusip').toUpperCase(), value = number(block, 'value');
    if (!cusip || value == null) return [];
    const putCall = ownershipXmlTag(block, 'putCall').toUpperCase() || null;
    const sharesType = ownershipXmlTag(block, 'sshPrnamtType').toUpperCase() || null;
    return [{ cusip, name: ownershipXmlTag(block, 'nameOfIssuer'), titleOfClass: ownershipXmlTag(block, 'titleOfClass'),
      value: value * scale, shares: number(block, 'sshPrnamt'), sharesType, putCall,
      type: putCall === 'CALL' ? 'call' : putCall === 'PUT' ? 'put' : sharesType === 'PRN' ? 'principal' : sharesType === 'SH' ? 'stock' : 'other',
      investmentDiscretion: ownershipXmlTag(block, 'investmentDiscretion') || null,
      otherManager: ownershipXmlTag(block, 'otherManager') || null,
      figi: ownershipXmlTag(block, 'figi') || null,
      votingSole: number(block, 'Sole'), votingShared: number(block, 'Shared'), votingNone: number(block, 'None'),
      sourceUrl, accession, filingDate: filingDate || null }];
  });
}

function collapse(rows, cusipMap) {
  const out = new Map();
  for (const r of rows) {
    // CUSIP identifies the security class. Changes in a filer's class label
    // (COM versus COMMON) must not manufacture a new position and an exit.
    const key = [r.cusip, r.type, r.sharesType].join('|');
    let h = out.get(key);
    if (!h) { h = { ...r, ticker: cusipMap.get(r.cusip) || null, value: 0, shares: 0, disclosures: [] }; out.set(key, h); }
    h.value += r.value;
    h.shares = h.shares == null || r.shares == null ? null : h.shares + r.shares;
    h.disclosures.push(r);
  }
  return out;
}

// Prior-quarter stock weights held constant. Historical closes use the site's
// common split-adjusted basis. Never infer returns from changing portfolio NAV.
function performance(prior, chains, startDate, endDate) {
  const stocks = [...prior.values()].filter(r => r.type === 'stock');
  const total = sum(stocks, 'value');
  let covered = 0, pnl = 0;
  for (const r of stocks) {
    const chain = chains[r.ticker];
    if (!chain || issuerNameKey(chain.fundamentals?.name) !== issuerNameKey(r.name)) continue;
    const currency = chain.currency || chain.fundamentals?.currency;
    if (currency && currency !== 'USD') continue;
    const start = closeOnOrBefore(chain, startDate), end = closeOnOrBefore(chain, endDate);
    if (!start || !end || Date.parse(startDate) - Date.parse(start.date) > 7 * 864e5 || Date.parse(endDate) - Date.parse(end.date) > 7 * 864e5) continue;
    if (!(r.shares > 0) || !splitFactor(r.value / r.shares, start.close)) continue;
    covered += r.value;
    pnl += r.value * (end.close / start.close - 1);
  }
  const coveragePct = total > 0 ? covered / total * 100 : null;
  return { pct: coveragePct >= 80 && covered > 0 ? pnl / covered * 100 : null, coveragePct,
    startDate, endDate, basis: 'Prior-quarter long stock weights held constant; split-adjusted price changes on the covered book. Excludes dividends, trading, fees, shorts and derivatives. Requires 80% coverage by prior stock value. Not a fund return.' };
}

export function buildOwnershipFund(f, cusipMap = new Map(), chains = {}) {
  if (!f.latestFetchOk || !Array.isArray(f.latestDisclosures)) return null;
  const now = collapse(f.latestDisclosures, cusipMap);
  // Without a successfully fetched predecessor, position changes are unknown.
  const comparable = !!f.prior && !f.comparisonUnavailable && f.priorFetchOk && Array.isArray(f.priorDisclosures);
  const prior = comparable ? collapse(f.priorDisclosures, cusipMap) : new Map();
  const stockValue = sum([...now.values()].filter(r => r.type === 'stock'), 'value');
  const rows = [...new Set([...now.keys(), ...prior.keys()])].map(key => {
    const cur = now.get(key), prev = prior.get(key), r = cur || prev;
    const sharesNow = cur ? cur.shares : 0;
    const sharesPrior = comparable ? prev ? prev.shares : 0 : null;
    return { ticker: r.ticker, name: r.name, cusip: r.cusip, titleOfClass: r.titleOfClass, type: r.type, sharesType: r.sharesType,
      valueNow: cur?.value || 0, sharesNow, valuePrior: comparable ? prev?.value || 0 : null, sharesPrior,
      valueChange: comparable ? (cur?.value || 0) - (prev?.value || 0) : null,
      shareChange: comparable && sharesNow != null && sharesPrior != null ? sharesNow - sharesPrior : null,
      isNew: comparable && !prev, isExit: comparable && !cur,
      weightPct: cur?.type === 'stock' && stockValue > 0 ? cur.value / stockValue * 100 : null,
      disclosures: cur?.disclosures || [], priorDisclosures: prev?.disclosures || [] };
  }).sort((a, b) => b.valueNow - a.valueNow || a.cusip.localeCompare(b.cusip));
  const top10 = rows.filter(r => r.type === 'stock' && !r.isExit).slice(0, 10);
  return { cik: f.cik, holdings: rows, holdingsComplete: true, comparable,
    reportedValue: sum([...now.values()], 'value'), stockValue,
    concentrationPct: stockValue > 0 ? sum(top10, 'valueNow') / stockValue * 100 : null,
    filingUrl: f.latestUrl || null,
    performance: comparable ? performance(prior, chains, f.prior.reportDate, f.latest.reportDate) : { pct: null, coveragePct: null } };
}

export function aggregateOwnershipPositions(perFirm) {
  const holdings = new Map();
  for (const f of Object.values(perFirm)) for (const r of f?.holdings || []) {
    if (r.type !== 'stock' || r.isExit) continue;
    const agg = holdings.get(r.cusip) || { ticker: r.ticker, name: r.name, value: 0, funds: 0 };
    agg.value += r.valueNow; agg.funds++;
    holdings.set(r.cusip, agg);
  }
  return [...holdings.values()].sort((a, b) => b.value - a.value).slice(0, 20).map((r, i) => ({
    rank: i + 1, ticker: r.ticker, name: r.name,
    note: '$' + Math.round(r.value).toLocaleString('en-US') + ' reported across ' + r.funds + ' tracked managers',
  }));
}

export function prioritizeOwnershipCusips(weights, attempts = {}) {
  return [...weights.keys()].sort((a, b) => String(attempts[a] || '').localeCompare(String(attempts[b] || '')) || weights.get(b) - weights.get(a));
}
