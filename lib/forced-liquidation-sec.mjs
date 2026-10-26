// Conservative SEC keyword discovery. Extraction is deliberately narrower than
// discovery: ambiguous loan amounts and ordinary secured bonds stay in review.
import { LIQUIDATION_VERSION, LIQUIDATION_EVIDENCE_VERSION, mergeLiquidationObservations } from './forced-liquidation.mjs';

export const LIQUIDATION_PARSER_VERSION = LIQUIDATION_EVIDENCE_VERSION;
export const LIQUIDATION_FORMS = ['4','4/A','SC 13D','SC 13D/A','SC 13G','SC 13G/A','SCHEDULE 13D','SCHEDULE 13D/A','SCHEDULE 13G','SCHEDULE 13G/A','DEF 14A','DEFA14A','424B1','424B2','424B3','424B4','424B5','424B7','424B8'];
const DAY = 86400000;
const numberToken = '(\\d[\\d,]*(?:\\.\\d+)?)\\s*(million|billion|thousand)?';
function amount(n, unit) { return Number(n.replace(/,/g,'')) * ({thousand:1e3,million:1e6,billion:1e9}[String(unit).toLowerCase()] || 1); }
function unique(values) { return [...new Set(values.filter(v=>Number.isFinite(v) && v>0))]; }
function xmlText(s, tag) { return String(s).match(new RegExp('<(?:\\w+:)?'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?'+tag+'>','i'))?.[1]?.replace(/<[^>]*>/g,' ').trim() || null; }
export function secFilingText(raw) {
  return String(raw).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<ix:hidden\b[^>]*>[\s\S]*?<\/ix:hidden>/gi,' ')
    .replace(/<\/(?:p|div|tr|li|footnote|remarks)>/gi,'\n').replace(/<(?:br|hr)\b[^>]*\/?\s*>/gi,'\n')
    .replace(/<[^>]+>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v<=0x10ffff?String.fromCodePoint(v):' ';})
    .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/[\u00a0\u200b\u200c\ufeff]/g,' ').replace(/[\t\r ]+/g,' ').replace(/ *\n */g,'\n').trim();
}
function companyNameKey(s) { return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/(?:incorporated|inc|corporation|corp|limited|ltd)$/,''); }
export function resolveCollateralIssuer(raw, filing, directory) {
  const entries = Object.values(directory || {});
  const cik = xmlText(raw, 'issuerCik');
  const symbol = xmlText(raw,'issuerTradingSymbol');
  if (cik || symbol) {
    const matched=entries.filter(e=>cik ? Number(e.cik_str)===Number(cik) : e.ticker===symbol?.toUpperCase());
    const issuer=matched.length===1?matched[0]:matched.find(e=>e.ticker===symbol?.toUpperCase());
    return issuer ? {symbol:issuer.ticker,company:issuer.title,issuerVerified:true} : {symbol:symbol?.toUpperCase()||null,company:xmlText(raw,'issuerName'),issuerVerified:false};
  }
  const text = secFilingText(raw);
  const cover = text.slice(0,22000);
  // 13D/G filer CIKs can identify the borrower rather than the stock. Resolve
  // the cover's Name of Issuer, not an arbitrary CIK returned by SEC search.
  if (/13[DG]/i.test(filing.form)) {
    const marker = cover.search(/name of issuer/i);
    if(marker>=0) {
      const window = companyNameKey(cover.slice(Math.max(0,marker-240),marker+240));
      const found = entries.filter(e=>{const k=companyNameKey(e.title);return k.length>=5 && window.includes(k);});
      if(found.length===1) return {symbol:found[0].ticker,company:found[0].title,issuerVerified:true};
    }
    return {symbol:null,company:null,issuerVerified:false};
  }
  const matched=entries.filter(e=>Number(e.cik_str)===Number(filing.cik));
  const issuer = matched.length===1?matched[0]:null;
  return {symbol:issuer?.ticker || null,company:issuer?.title || filing.company || null,issuerVerified:!!issuer};
}
function extractShares(text) {
  const patterns = [
    new RegExp(numberToken+'\\s+(?:shares(?: of (?:our |the )?(?:Class [A-Z] )?(?:common|ordinary) stock)?)[^.;]{0,100}?\\b(?:are |were |have been |had been |is |was )?pledged\\b','gi'),
    new RegExp('\\bpledged\\s+(?:an? (?:additional|aggregate|total) (?:of )?|a total of |approximately |over |about )?'+numberToken+'\\s+(?:shares|common shares)','gi'),
    new RegExp('\\b'+numberToken+'\\s+shares[^.;]{0,80}?(?:held|maintained) in (?:a |an? )?margin account','gi'),
  ];
  return unique(patterns.flatMap(re=>[...text.matchAll(re)].map(m=>amount(m[1],m[2]))));
}
function extractPrincipal(text) {
  const patterns = [
    new RegExp('(?:outstanding principal(?: (?:amount|balance))?(?: (?:of|was|is))?|principal (?:amount|balance) outstanding(?: (?:of|was|is))?|borrowings? outstanding(?: (?:of|was|is))?|outstanding borrowings?(?: (?:of|was|is))?)\\s*[:=]?\\s*(?:US\\s*)?\\$\\s*'+numberToken,'gi'),
    new RegExp('\\$\\s*'+numberToken+'(?:\\s+(?:in|of))?\\s+(?:outstanding principal|outstanding (?:under|on) (?:the |a )?(?:margin |stock.secured )?loan)','gi'),
  ];
  return unique(patterns.flatMap(re=>[...text.matchAll(re)].map(m=>amount(m[1],m[2]))));
}
function extractMaintenance(text) {
  const ltvs = [...text.matchAll(/(?:maintenance|maximum permitted|maximum allowable|maximum)\s+(?:loan[- ]to[- ]value(?:\s+ratio)?|LTV)(?:[^\d.;]{0,45})(\d+(?:\.\d+)?)\s*%/gi)].map(m=>Number(m[1])/100);
  // Equity maintenance margin is equity / collateral, the complement of LTV.
  const margins = [...text.matchAll(/maintenance (?:equity )?margin(?: requirement)?[^\d.;]{0,35}(\d+(?:\.\d+)?)\s*%/gi)].map(m=>1-Number(m[1])/100);
  return unique([...ltvs,...margins]).filter(n=>n<1);
}
function explicitAsOf(text) {
  const m = text.match(/\bas of\s+([A-Z][a-z]+ \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})\b/i);
  if(!m) return null;
  const raw=m[1],parts=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const named=raw.match(/^([A-Za-z]+) (\d{1,2}),? (\d{4})$/);
  const month=parts?Number(parts[2])-1:['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(named?.[1].toLowerCase());
  const year=Number(parts?.[1]||named?.[3]),day=Number(parts?.[3]||named?.[2]);
  if(month<0||month>11)return null;
  const date=new Date(Date.UTC(year,month,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month&&date.getUTCDate()===day?date.toISOString().slice(0,10):null;
}
function pledgeReleaseStatus(text){
  let status='disclosed';
  for(const clause of text.split(/[.;]\s+/)){
    if(!/releas(?:e|ed)|terminated|discharged|no longer/i.test(clause))continue;
    if(!/pledge|(?:shares?|stock)[^.;]{0,100}collateral|collateral[^.;]{0,100}(?:shares?|stock)/i.test(clause))continue;
    if(/\b(?:not|never|may|might|could|would|will|shall|can|if)\b/i.test(clause))continue;
    const partial=/partial|a portion|part of|some of|certain of/i.test(clause)||(!/\ball\b/i.test(clause)&&/\b[\d,]+\s+shares?\s+(?:were|was|have been|has been)?\s*released/i.test(clause));
    if(partial)return 'partial-release';
    if(/\b(?:released|terminated|discharged|no longer pledged)\b/i.test(clause))status='released';
  }
  return status;
}
export function extractLiquidationFiling(raw, filing, issuer = {}) {
  const text = secFilingText(raw), observations = [];
  const documentUsd=/(?:all dollar amounts|dollar amounts|amounts (?:are|shown|presented|expressed))[^\n]{0,100}(?:U\.?S\.? dollars|United States dollars|\bUSD\b)/i.test(text);
  const reporters=[...String(raw).matchAll(/<(?:\w+:)?reportingPersonName\b[^>]*>([\s\S]*?)<\/(?:\w+:)?reportingPersonName>/gi)].map(m=>secFilingText(m[1]));
  const form4Owners=[...String(raw).matchAll(/<(?:\w+:)?rptOwnerName\b[^>]*>([\s\S]*?)<\/(?:\w+:)?rptOwnerName>/gi)].map(m=>secFilingText(m[1]));
  const owner = form4Owners.length===1?form4Owners[0]:reporters.length===1?reporters[0]:null;
  const footnotes = [...String(raw).matchAll(/<(?:\w+:)?footnote\b[^>]*>([\s\S]*?)<\/(?:\w+:)?footnote>/gi)].map(m=>secFilingText(m[1]));
  const blocks = footnotes.length ? footnotes : text.split(/\n+/);
  const proxyOwners=new Map();
  const ownershipStart=blocks.findIndex(line=>/following table[^.]{0,500}beneficial/i.test(line));
  const ownershipDate=ownershipStart>=0?explicitAsOf(blocks[ownershipStart]):null;
  const ownerTable=ownershipStart>=0?blocks.slice(ownershipStart,ownershipStart+200):[];
  if(/^DEF/.test(filing.form))for(const line of ownerTable){
    if(/^\(\d{1,3}\)$/.test(line.trim()))break;
    const m=line.trim().match(/^([A-Z][A-Za-z .'-]{2,70}?)\s+\((\d{1,3})\)\s*$/);
    if(!m || m[1].split(' ').length>6)continue;
    const names=proxyOwners.get(m[2])||new Set();names.add(m[1]);proxyOwners.set(m[2],names);
  }
  let fragment = 0;
  for (let blockIndex=0;blockIndex<blocks.length;blockIndex++) {
    const original=blocks[blockIndex];
    const marker=blocks.slice(Math.max(0,blockIndex-3),blockIndex).map(s=>s.trim()).reverse().find(s=>/^\(\d{1,3}\)$/.test(s));
    const ownerCandidates=marker?proxyOwners.get(marker.replace(/[()]/g,'')):null;
    const proxyOwner=blockIndex>=ownershipStart&&blockIndex<ownershipStart+200&&ownerCandidates?.size===1?[...ownerCandidates][0]:null;
    // Very long prose blocks are split into sentence neighborhoods, preserving
    // the local relationship between a share amount and its loan.
    const chunks = original.length > 2400 ? original.match(/[^.!?]+[.!?]?(?:\s|$)/g) || [original] : [original];
    for (const chunk of chunks) {
      if (!/pledge|pledging|margin account|collateral|secured notes|secured bonds/i.test(chunk)) continue;
      const excerpt = chunk.trim().slice(0,2400);
      const releaseStatus=pledgeReleaseStatus(excerpt),released=releaseStatus==='released',partialRelease=releaseStatus==='partial-release';
      if(/for example|hypothetical|illustrat(?:ion|ive)|assuming that|if (?:the |a )?(?:holder|shareholder|borrower) (?:were to |has )?pledge/i.test(excerpt)) continue;
      if(!released&&/\bno\b[^.;]{0,600}\bshall be pledged|\b(?:shall not|may not|prohibit(?:s|ed|ing)?|not permitted|prohibition)\b[^.;]{0,500}(?:pledge|pledging|margin account)/i.test(excerpt)) continue;
      if (!excerpt || !released&&/(?:may|could|permitted to|right to|policy (?:prohibits|restricts))\s+(?:be )?pledge|(?:no|none|not|never|prohibit(?:s|ed)?)\b[^.;]{0,100}\b(?:pledged|pledging|margin account)/i.test(excerpt)) continue;
      const statedShares=extractShares(excerpt);
      const currentPledge=/\b(?:has|have|had)\s+pledged\b[^.;]{0,120}(?:shares|stock)|(?:shares|stock)[^.;]{0,80}\b(?:are|were|have been|had been|is|was)\s+pledged\b|(?:shares|stock)[^.;]{0,80}(?:held|maintained) in (?:a |an )?margin account/i.test(excerpt);
      const equity=statedShares.length>0||(currentPledge&&!/\bpolicy|compliance|each of our directors\b/i.test(excerpt))||((released||partialRelease)&&/shares?|stock/i.test(excerpt));
      const debtFunding=/(?:issued|issuance|offering|borrowed|outstanding principal|principal amount of)/i.test(excerpt)&&/(?:notes|bonds|loan|credit facility)/i.test(excerpt)&&/(?:fund|finance|working capital|general corporate|operating|repay|refinanc)/i.test(excerpt);
      if(!equity&&!debtFunding)continue;
      const kind = equity ? 'equity-pledge' : 'debt-context';
      // Corporate debt secured by subsidiary equity is not necessarily a
      // shareholder's margin loan against this listed stock.
      const namedCollateral=excerpt.match(/\b(?:shares|stock) of ([A-Z][A-Za-z0-9 &.'-]{2,80}?)(?=\s+(?:are|were|held|pledged|as collateral|to secure)|[;,]|$)/)?.[1];
      const namedMismatch=namedCollateral&&!/^(?:the issuer|our company|common stock|ordinary stock|Class [A-Z])/i.test(namedCollateral)&&!companyNameKey(namedCollateral).includes(companyNameKey(issuer.company))&&!companyNameKey(issuer.company).includes(companyNameKey(namedCollateral));
      const thirdParty = !!namedMismatch || /(?:shares|stock) of (?:our |the |its )?(?:subsidiar|affiliate)|(?:subsidiar|affiliate)[^.;]{0,45}(?:stock|shares)/i.test(excerpt);
      const shareValues = equity && !thirdParty ? statedShares : [];
      const loanValues = equity ? extractPrincipal(excerpt) : [];
      const maintenanceValues = equity ? extractMaintenance(excerpt) : [];
      const borrowerMatches=[...excerpt.matchAll(/(?:borrower|pledgor|reporting person)\s*[:=]\s*([^;\n.]{2,100})/gi)];
      const borrowers=[...new Set(borrowerMatches.map(m=>m[1].trim().toLowerCase()))];
      const borrowerMatch = borrowers.length===1?borrowerMatches[0]:null;
      const namedPledgor=excerpt.match(/^([A-Z][A-Za-z .,'-]{3,90}?)\s+(?:has|had|have)\s+pledged\b/);
      const borrower = borrowers.length>1?null:borrowerMatch?.[1]?.trim() || owner || proxyOwner || namedPledgor?.[1] || null;
      const facilityMatches=[...excerpt.matchAll(/(?:facility|loan agreement)\s*(?:id|identifier|name)\s*[:=]\s*([^;\n.]{2,100})/gi)];
      const facilities=[...new Set(facilityMatches.map(m=>m[1].trim().toLowerCase()))];
      const facilityMatch=facilities.length===1?facilityMatches[0]:null;
      const agreement=excerpt.match(/(?:margin loan|credit|loan|pledge) agreement[^.;]{0,60}?dated(?: as of)?\s+([A-Z][a-z]+ \d{1,2},? \d{4})/i);
      const lender=excerpt.match(/(?:with|from)\s+([A-Z][A-Za-z &.'-]{2,65}?(?:Bank|N\.A\.|Securities|Capital|Lending|Credit))\b/);
      const naturalFacility=agreement && lender ? `${lender[1]}|${agreement[1]}` : null;
      const facilityKey = borrower && facilities.length<=1 && (facilityMatch || naturalFacility) ? `${borrower.toLowerCase()}|${(facilityMatch?.[1] || naturalFacility).trim().toLowerCase()}` : null;
      const sole = /(?:secured (?:solely|exclusively) by|sole collateral[^.;]{0,40}(?:is|are|consists)|collateral consists (?:solely|only) of)[^.;]{0,180}(?:shares|common stock|ordinary stock)/i.test(excerpt);
      const mixed = /(?:other|additional) (?:assets|securities|collateral)|(?:shares|stock)[^.;]{0,80}(?:and cash|and other|together with)/i.test(excerpt);
      const notUsd = /(?:C|A|HK|NZ|SG|NT|MX)\$|\b(?:CAD|AUD|HKD|RMB|EUR|GBP|JPY|CHF|SGD|NZD|CNY|CNH|INR|KRW|TWD|NTD|MXN|BRL|euros?|yen|pounds sterling)\b/i.test(excerpt);
      const usd=!notUsd&&(documentUsd||/US\s*\$|\bUSD\b|U\.?S\.? dollars|United States dollars/i.test(excerpt));
      const capacity = /(?:credit (?:line|facility)|loan (?:facility|commitment)|borrowing capacity|up to)\b[^.;]{0,70}\$/i.test(excerpt);
      const incremental=/pledged\s+(?:an?\s+)?additional|additional\s+[\d,.]+\s*(?:million\s+)?shares[^.;]{0,70}pledged/i.test(excerpt);
      const maximumShares=/(?:up to|may pledge|can pledge|a maximum of|not to exceed|as many as)[^.;]{0,60}(?:shares|stock)/i.test(excerpt);
      const percentageHolding=/\d+(?:\.\d+)?\s*%\s+of\s+(?:the\s+)?[\d,.]+\s*(?:million|billion|thousand)?\s+shares/i.test(excerpt);
      const preferredStock=/\bpreferred (?:stock|shares)\b/i.test(excerpt);
      const asOfDate = explicitAsOf(excerpt) || (proxyOwner?ownershipDate:null);
      const unresolved = shareValues.length>1 || loanValues.length>1 || maintenanceValues.length>1 || borrowers.length>1 || facilities.length>1;
      const r = { ...issuer, accessionNumber:filing.accessionNumber, fragmentId:fragment++,
        filingDate:filing.filingDate, asOfDate, form:filing.form, url:filing.url,
        kind, status:releaseStatus, borrower, facilityKey,
        securityClass:preferredStock?'Preferred stock':/class\s+[a-z]/i.exec(excerpt)?.[0]?.toUpperCase() || 'Common stock',
        principalBorrowed:loanValues.length===1 && !unresolved ? loanValues[0] : null,
        principalBasis:loanValues.length===1 && !unresolved ? 'outstanding' : capacity ? 'capacity' : 'undisclosed',
        sharesPledged:shareValues.length===1 && !unresolved && !incremental && !maximumShares && !percentageHolding && !partialRelease ? shareValues[0] : null,
        shareBasis:partialRelease?'unresolved-after-release':percentageHolding?'percentage-only':incremental ? 'incremental-only' : maximumShares ? 'capacity-only' : shareValues.length===1 && !unresolved ? 'stated-current' : 'undisclosed',
        maintenanceLtv:maintenanceValues.length===1 && !unresolved ? maintenanceValues[0] : null,
        collateralBasis:mixed ? 'mixed' : sole ? 'sole-listed-equity' : 'unspecified',
        currency:usd?'USD':'unresolved',currencyBasis:usd?'disclosed-dollar-currency':'needs-review', issuerVerified:!!issuer.issuerVerified && !thirdParty && !preferredStock,
        splitUnresolved:/stock split|reverse split|pre.split|post.split/i.test(excerpt),
        extractionStatus:unresolved || thirdParty ? 'ambiguous' : 'local-explicit-facts',
        excerpt, parserVersion:LIQUIDATION_PARSER_VERSION,
        fieldEvidence:{ shares:shareValues, principal:loanValues, maintenanceLtv:maintenanceValues },
      };
      // Footnote date must not be later than the disclosure that contains it.
      if(r.asOfDate && r.asOfDate>r.filingDate) { r.asOfDate=null; r.extractionStatus='ambiguous'; r.principalBorrowed=null; }
      observations.push(r);
    }
  }
  return observations.slice(0,30);
}

export function secArchiveUrl(cik, accessionNumber, document) {
  const primary = String(document || '').replace(/^xsl[^/]*\//,'');
  if(!/^\d{1,10}$/.test(String(cik)) || !/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber) || !/^[A-Za-z0-9_.-]+\.(?:htm|html|xml|txt)$/i.test(primary)) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNumber.replace(/-/g,'')}/${primary}`;
}
export function liquidationRecentFilings(submissions, cik, cutoff) {
  const r=submissions?.filings?.recent; if(!r) return [];
  return (r.form||[]).flatMap((form,i)=>{
    const filingDate=r.filingDate?.[i], accessionNumber=r.accessionNumber?.[i];
    const url=secArchiveUrl(cik,accessionNumber,r.primaryDocument?.[i]);
    return LIQUIDATION_FORMS.includes(form) && filingDate>=cutoff && url ? [{form,filingDate,accessionNumber,url,cik}] : [];
  });
}

export async function collectLiquidationSec({ prior = null, universe = [], cikMap = null, now = new Date().toISOString(),
  fetchImpl = fetch, userAgent = process.env.SEC_USER_AGENT || 'stonks-app build-pipeline contact@example.com',
  delayMs = 250, maxDocuments = 36, maxIssuers = 12, maxRequests = 65, deadlineMs = 100000,
} = {}) {
  const priorObs = prior?.version===LIQUIDATION_VERSION && Array.isArray(prior.observations) ? prior.observations : [];
  const previous = prior?.coverage || {};
  const cacheAge=Date.parse(now)-Date.parse(previous.lastSuccessAt);
  if(previous.status==='ok' && previous.parserVersion===LIQUIDATION_PARSER_VERSION && !(previous.pendingFilings||[]).length && cacheAge>=0 && cacheAge<18*3600000) {
    return { observations:priorObs, coverage:{...previous,requestsThisRun:0,documentsThisRun:0,reusedDailyScan:true} };
  }
  const started=Date.now(), errors=[], fresh=[], inspected={...(previous.inspected || {})}, issuerChecks={...(previous.issuerChecks||{})}, reparsedUrls=new Set();
  let requests=0, documents=0, discovered=0, discoveryTotal=0, issuersChecked=0, capped=false;
  const cutoff=new Date(Date.parse(now)-400*DAY).toISOString().slice(0,10);
  const get=async(url,json=false)=>{
    if(requests>=maxRequests || Date.now()-started>=deadlineMs) { capped=true; throw new Error('SEC scan budget reached'); }
    requests++;
    if(delayMs) await new Promise(resolve=>setTimeout(resolve,delayMs));
    const response=await fetchImpl(url,{headers:{'User-Agent':userAgent,Accept:json?'application/json':'text/html,application/xml,text/plain'},signal:AbortSignal.timeout(Math.min(12000,Math.max(1,deadlineMs-(Date.now()-started))))});
    if(!response.ok) throw new Error(`SEC HTTP ${response.status}`);
    if(json) return response.json();
    if(Number(response.headers?.get('content-length'))>12*1024*1024) throw new Error('SEC document exceeds 12 MB limit');
    const body=await response.text(); if(body.length>12*1024*1024) throw new Error('SEC document exceeds 12 MB limit'); return body;
  };
  let directory={};
  try {
    directory=await get('https://www.sec.gov/files/company_tickers.json',true);
    if(!directory || !Object.values(directory).length || !Object.values(directory).every(e=>typeof e?.ticker==='string' && typeof e?.title==='string' && Number(e?.cik_str)>0))throw new Error('Unrecognized SEC issuer directory');
  }
  catch(e) { directory={};errors.push({stage:'directory',message:e.message}); }
  const targets = Object.values(directory).filter(e=>universe.includes(e.ticker));
  const filings = new Map();
  const add = f=>{
    const match=String(f?.url||'').match(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/(\d+)\/\d+\/([^/?#]+)$/);
    if(!match || !LIQUIDATION_FORMS.includes(f.form) || typeof f.filingDate!=='string' || f.filingDate<cutoff || f.filingDate>now.slice(0,10))return;
    if(secArchiveUrl(match[1],f.accessionNumber,match[2])!==f.url)return;
    const record={accessionNumber:f.accessionNumber,form:f.form,filingDate:f.filingDate,cik:match[1],url:f.url};
    filings.set(record.accessionNumber+':'+record.url,record);
  };
  // Keep work discovered before a cap, even after its issuer rotates out of the
  // next submissions sweep. Reparse prior positive evidence on an upgrade.
  for(const filing of previous.pendingFilings||[])add(filing);
  const needsReparse=new Set();
  for(const r of priorObs)if(r.parserVersion!==LIQUIDATION_PARSER_VERSION){add(r);needsReparse.add(r.url);}
  if(Object.keys(directory).length) {
    // Broad keyword discovery supplements issuer submissions, particularly for
    // schedules filed by shareholders. Search is capped and explicitly reported.
    const families = ['4,4/A','SC 13D,SC 13D/A,SC 13G,SC 13G/A,SCHEDULE 13D,SCHEDULE 13D/A,SCHEDULE 13G,SCHEDULE 13G/A','DEF 14A,DEFA14A','424B1,424B2,424B3,424B4,424B5,424B7,424B8'];
    for(const forms of families) {
      if(requests>=maxRequests || Date.now()-started>=deadlineMs) break;
      try {
        const url=new URL('https://efts.sec.gov/LATEST/search-index');
        for(const [k,v] of Object.entries({q:'"pledged as collateral" OR "pledged as security" OR "margin account" OR "pledged to secure"',forms,dateRange:'custom',startdt:new Date(Date.parse(now)-30*DAY).toISOString().slice(0,10),enddt:now.slice(0,10),from:'0',size:'25'}))url.searchParams.set(k,v);
        const result=await get(url.toString(),true), hits=result.hits?.hits;
        if(!Array.isArray(hits)) throw new Error('Unrecognized SEC search response');
        const total=typeof result.hits.total==='number'?result.hits.total:result.hits.total?.value;
        discoveryTotal+=Number(total)||0;
        if(total>Math.min(25,hits.length))capped=true;
        for(const hit of hits.slice(0,25)) {
          const s=hit._source || {}, accessionNumber=s.adsh || String(hit._id).split(':')[0], document=String(hit._id).split(':').slice(1).join(':');
          const cik=String(s.ciks?.[0]||'').replace(/^0+/,'');
          const f={accessionNumber,form:s.form || s.root_forms?.[0],filingDate:s.file_date,cik,url:secArchiveUrl(cik,accessionNumber,document)};
          if(LIQUIDATION_FORMS.includes(f.form))add(f);
        }
      } catch(e) { errors.push({stage:'keyword-search',forms,message:e.message}); }
    }
    // Rotate the least recently checked tracked issuers. Each form family gets
    // representation before repeated Form 4s can consume the document budget.
    const rotation=[...targets].sort((a,b)=>String(issuerChecks[a.ticker]||'').localeCompare(String(issuerChecks[b.ticker]||'')) || a.ticker.localeCompare(b.ticker)).slice(0,maxIssuers);
    for(const issuer of rotation) {
      if(requests>=maxRequests-1 || Date.now()-started>=deadlineMs) {capped=true;break;}
      try {
        const cik=String(cikMap?.get?.(issuer.ticker) || issuer.cik_str).padStart(10,'0');
        const subs=await get(`https://data.sec.gov/submissions/CIK${cik}.json`,true);
        if(!Array.isArray(subs.filings?.recent?.form)) throw new Error('Unrecognized SEC submissions response');
        const recent=liquidationRecentFilings(subs,String(issuer.cik_str),cutoff);
        const selected=[];
        for(const family of [/^DEF|^DEFA/,/13[DG]/,/^424B/,/^4(?:\/A)?$/])selected.push(...recent.filter(f=>family.test(f.form)).slice(0,2));
        selected.forEach(add); issuerChecks[issuer.ticker]=now;issuersChecked++;
      } catch(e) { errors.push({stage:'issuer-submissions',symbol:issuer.ticker,message:e.message}); }
    }
  }
  const sorted=[...filings.values()].sort((a,b)=>Number(needsReparse.has(b.url))-Number(needsReparse.has(a.url))||b.filingDate.localeCompare(a.filingDate)||a.url.localeCompare(b.url));
  const family=f=>/13[DG]/.test(f.form)?0:/^4(?:\/A)?$/.test(f.form)?1:/^DEF/.test(f.form)?2:3;
  const lanes=[0,1,2,3].map(n=>sorted.filter(f=>family(f)===n)),todo=[];
  // Interleave document families. A surge of generic prospectuses must not
  // consume the entire read budget before a shareholder amendment is read.
  for(let i=0;i<Math.max(...lanes.map(a=>a.length),0);i++)for(const lane of lanes)if(lane[i])todo.push(lane[i]);
  discovered=todo.length;
  for(const filing of todo) {
    if(!Object.keys(directory).length)break;
    const cacheKey=filing.accessionNumber+':'+filing.url;
    if(inspected[cacheKey]?.parserVersion===LIQUIDATION_PARSER_VERSION&&!needsReparse.has(filing.url))continue;
    if(documents>=maxDocuments || requests>=maxRequests || Date.now()-started>=deadlineMs) {capped=true;break;}
    try {
      const raw=await get(filing.url); documents++;
      if(!/<(?:html|XML|ownershipDocument|edgarSubmission|\?xml)|<SEC-DOCUMENT|<DOCUMENT/i.test(raw))throw new Error('Unrecognized SEC filing content');
      if(/Your Request Originates from an Undeclared Automated Tool|Request Rate Threshold Exceeded/i.test(raw))throw new Error('SEC access page returned instead of a filing');
      const issuer=resolveCollateralIssuer(raw,filing,directory);
      fresh.push(...extractLiquidationFiling(raw,filing,issuer));
      reparsedUrls.add(filing.url);
      inspected[cacheKey]={parserVersion:LIQUIDATION_PARSER_VERSION,checkedAt:now};
    } catch(e) { errors.push({stage:'document',accessionNumber:filing.accessionNumber,message:e.message}); }
  }
  const status=errors.length ? Object.keys(directory).length ? 'partial' : 'unavailable' : 'ok';
  const pendingFilings=todo.filter(f=>inspected[f.accessionNumber+':'+f.url]?.parserVersion!==LIQUIDATION_PARSER_VERSION);
  return { observations:mergeLiquidationObservations(priorObs.filter(r=>!reparsedUrls.has(r.url)),fresh), coverage:{ status,
    checkedAt:now,lastSuccessAt:status==='ok'?now:previous.lastSuccessAt || null,
    requestsThisRun:requests,documentsThisRun:documents,discoveredFilings:discovered,keywordMatches:discoveryTotal,
    capped, maxDocuments,maxIssuers,universeSize:universe.length,issuersCheckedThisRun:issuersChecked,
    inspected,issuerChecks,pendingFilings,errors:errors.slice(0,25),
    scope:'30-day capped SEC keyword discovery plus rotating tracked-issuer submissions over 400 days. Recent submissions only; exhibits and older archive pages are not exhaustively scanned. No match does not establish absence of leverage.',
    forms:LIQUIDATION_FORMS,parserVersion:LIQUIDATION_PARSER_VERSION,
  } };
}
