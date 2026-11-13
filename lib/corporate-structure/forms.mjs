// SEC Section 16 ownership filings (Forms 3, 4 and 5) parsed into plain rows,
// plus the small helpers the rest of lib/corporate-structure/ shares: name
// handling, share-class labels, EDGAR full-text search hits and URLs.
// Pure: no network, no clock. Every number comes straight from the filing.

export function decodeXml(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function stripNs(xml) {
  return String(xml || '').replace(/(<\/?)[a-zA-Z0-9]+:/g, '$1');
}
function blocks(xml, tag) {
  return String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi')) || [];
}
function first(xml, tag) {
  return blocks(xml, tag)[0] || '';
}
// Text of a tag. Section 16 XML wraps most values as <tag><value>x</value></tag>.
function val(xml, tag) {
  const b = first(xml, tag);
  if (!b) return null;
  const inner = b.replace(new RegExp(`^<${tag}\\b[^>]*>|<\\/${tag}>$`, 'gi'), '');
  const v = /<value\b[^>]*>([\s\S]*?)<\/value>/i.exec(inner);
  const text = decodeXml((v ? v[1] : inner).replace(/<footnoteId\b[^>]*\/?>(?:<\/footnoteId>)?/gi, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}
function footnoteIds(xml, tag) {
  const b = first(xml, tag);
  return [...b.matchAll(/<footnoteId\b[^>]*\bid="([^"]+)"/gi)].map((m) => m[1]);
}
function num(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function flag(v) {
  return /^(1|true|y|yes)$/i.test(String(v ?? '').trim());
}

// One Form 3, 4 or 5 (or amendment). Returns null when the document is not an
// ownership filing. Rows keep document order, which is the order of events.
export function parseOwnershipXml(xml) {
  const clean = stripNs(xml);
  if (!/<ownershipDocument\b/i.test(clean)) return null;
  const footnotes = {};
  for (const f of clean.matchAll(/<footnote\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/footnote>/gi)) {
    footnotes[f[1]] = decodeXml(f[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 400);
  }
  const issuer = first(clean, 'issuer');
  const owners = blocks(clean, 'reportingOwner').map((b) => {
    const id = first(b, 'reportingOwnerId');
    const rel = first(b, 'reportingOwnerRelationship');
    return {
      cik: padCik(val(id, 'rptOwnerCik')),
      name: val(id, 'rptOwnerName'),
      director: flag(val(rel, 'isDirector')),
      officer: flag(val(rel, 'isOfficer')),
      title: val(rel, 'officerTitle'),
      tenPct: flag(val(rel, 'isTenPercentOwner')),
      other: flag(val(rel, 'isOther')),
      otherText: val(rel, 'otherText'),
    };
  }).filter((o) => o.cik || o.name);
  const rows = [];
  const nd = first(clean, 'nonDerivativeTable');
  const scan = (block, kind) => {
    const amounts = first(block, 'transactionAmounts');
    const post = first(block, 'postTransactionAmounts');
    const nature = first(block, 'ownershipNature');
    const natureText = val(nature, 'natureOfOwnership');
    const natureNotes = footnoteIds(nature, 'natureOfOwnership').map((id) => footnotes[id]).filter(Boolean);
    rows.push({
      kind,
      title: val(block, 'securityTitle'),
      date: (val(block, 'transactionDate') || '').slice(0, 10) || null,
      code: kind === 'tx' ? (val(first(block, 'transactionCoding'), 'transactionCode') || null) : null,
      shares: num(val(amounts, 'transactionShares')),
      price: num(val(amounts, 'transactionPricePerShare')),
      ad: val(amounts, 'transactionAcquiredDisposedCode'),
      post: num(val(post, 'sharesOwnedFollowingTransaction')),
      di: (val(nature, 'directOrIndirectOwnership') || 'D').toUpperCase().slice(0, 1),
      nature: natureText,
      natureNote: natureNotes[0] || null,
    });
  };
  // Holdings and transactions interleave in the table; keep their order.
  for (const m of nd.matchAll(/<(nonDerivativeTransaction|nonDerivativeHolding)\b[^>]*>[\s\S]*?<\/\1>/gi)) {
    scan(m[0], /Transaction$/i.test(m[1]) ? 'tx' : 'hold');
  }
  return {
    form: val(clean, 'documentType'),
    period: (val(clean, 'periodOfReport') || '').slice(0, 10) || null,
    issuer: { cik: padCik(val(issuer, 'issuerCik')), name: val(issuer, 'issuerName'), symbol: val(issuer, 'issuerTradingSymbol') },
    owners,
    rows,
    noSecurities: flag(val(clean, 'noSecuritiesOwned')),
    remarks: val(clean, 'remarks'),
  };
}

export function padCik(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d ? d.padStart(10, '0') : null;
}

// "Class A Common Stock" -> "A"; plain common, ordinary shares and ADSs -> "common".
export function shareClassOf(title) {
  const t = String(title || '').toLowerCase();
  if (/preferred|preference/.test(t)) return 'preferred';
  // "Class A", "Series B common", and the Danish style "A shares" / "B-aktier".
  const m = /\bclass\s+([a-z])\b/.exec(t) || /\bseries\s+([a-z])\b(?=.*(?:common|stock|share))/.exec(t) || /^\s*([a-z])[- ]?(?:shares|ordinary shares|aktier)\b(?!\s+of\b)/.exec(t);
  if (m) return m[1].toUpperCase();
  if (/american depositary|\bads\b|\badr\b/.test(t)) return 'ADS';
  // One-off control shares (Shopify's Founder Share) are their own class.
  if (/founder share|special voting share|golden share/.test(t)) return 'special';
  return 'common';
}

// What a transaction code means, in plain words (SEC Form 4 instructions).
export const TX_CODES = Object.freeze({
  P: 'Bought on the open market', S: 'Sold on the open market', A: 'Granted or awarded', M: 'Exercised or converted an award',
  F: 'Shares withheld for tax', G: 'Gift', C: 'Converted', D: 'Returned to the company', J: 'Other', X: 'Exercised options',
  W: 'Inherited', I: 'Discretionary', V: 'Voluntary report', K: 'Equity swap', L: 'Small acquisition', Z: 'Plan transaction', E: 'Expired', H: 'Expired', O: 'Exercised options', U: 'Tendered',
});

// --- names -------------------------------------------------------------------
const SUFFIX = /^(jr|sr|ii|iii|iv|v|phd|md|esq|cpa|dr|mr|mrs|ms|sir|dame|prof)$/i;
const NICK = {
  tim: 'timothy', art: 'arthur', bill: 'william', will: 'william', bob: 'robert', rob: 'robert', jim: 'james', jamie: 'james',
  mike: 'michael', dave: 'david', dan: 'daniel', tom: 'thomas', joe: 'joseph', chris: 'christopher', steve: 'steven', ed: 'edward',
  ted: 'edward', rick: 'richard', dick: 'richard', rich: 'richard', andy: 'andrew', tony: 'anthony', alex: 'alexander', sam: 'samuel',
  ben: 'benjamin', greg: 'gregory', jeff: 'jeffrey', ken: 'kenneth', larry: 'lawrence', matt: 'matthew', nick: 'nicholas', pat: 'patrick',
  pete: 'peter', ron: 'ronald', sue: 'susan', liz: 'elizabeth', beth: 'elizabeth', kate: 'katherine', kathy: 'katherine', meg: 'margaret',
  peggy: 'margaret', jen: 'jennifer', jenny: 'jennifer', jon: 'jonathan', chuck: 'charles', charlie: 'charles', fred: 'frederick',
  frank: 'francis', gerry: 'gerald', jerry: 'gerald', hank: 'henry', harry: 'henry', jack: 'john', johnny: 'john', ray: 'raymond',
  stan: 'stanley', vince: 'vincent', walt: 'walter', zach: 'zachary', dee: 'deirdre', sandy: 'sandra', cathy: 'catherine', abby: 'abigail',
};
// Letters that do not decompose (Danish ø, German ß, Polish ł) folded to
// plain ones, so "Bøjer" in a filing matches "Bojer" or "Bøjer" elsewhere.
export function foldName(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[øØ]/g, (c) => (c === 'ø' ? 'o' : 'O')).replace(/æ/g, 'ae').replace(/Æ/g, 'Ae').replace(/œ/g, 'oe').replace(/Œ/g, 'Oe')
    .replace(/ß/g, 'ss').replace(/[łŁ]/g, (c) => (c === 'ł' ? 'l' : 'L')).replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D')).replace(/ı/g, 'i');
}
export function nameTokens(name) {
  return foldName(name).toLowerCase()
    .replace(/\b(ph\.?\s?d|m\.?\s?d|j\.?\s?d|m\.?\s?b\.?\s?a|c\.?\s?p\.?\s?a)\b\.?/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z\s'-]/g, ' ').replace(/['-]/g, '').split(/\s+/).filter((t) => t && !SUFFIX.test(t));
}
// SEC filer names are "LAST FIRST MIDDLE"; proxy names are "First M. Last".
// A surname that starts with a particle ("DI SIBIO CARMINE") keeps both words.
const SURNAME_PARTICLE = /^(de|del|della|la|le|van|von|der|den|da|di|dos|du|st|san|ter|ten)$/;
export function secNameParts(name) {
  const t = nameTokens(name);
  let n = 1;
  while (n < t.length - 1 && SURNAME_PARTICLE.test(t[n - 1])) n++;
  return { last: t.slice(0, n).join(''), first: t[n] || '', rest: t.slice(n + 1) };
}
export function displayNameParts(name) {
  const t = nameTokens(name);
  return { last: t[t.length - 1] || '', first: t[0] || '', rest: t.slice(1, -1) };
}
function firstMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const na = NICK[a] || a, nb = NICK[b] || b;
  if (na === nb) return true;
  if (a.length >= 3 && b.length >= 3 && (na.startsWith(nb.slice(0, 3)) && nb.startsWith(na.slice(0, 3)))) return true;
  // A short form made from the end of the name ("Dara" for Oluwadara, "Beth"
  // for Elizabeth).
  return a.length >= 4 && b.length >= 4 && (a.endsWith(b) || b.endsWith(a));
}
// Does an SEC filer name and a proxy name refer to the same person? Last
// names must match (allowing a compound last name), first names must match
// or be a known short form. A middle name used as a first name also matches,
// as do initials ("K. Ram Shriram" for SHRIRAM KAVITARK RAM) and a married
// name added after the filing name ("Dina Powell McCormick" for POWELL DINA).
// A few filers sign in "First Last" order, so that order is tried too.
export function samePerson(secName, proxyName) {
  if (isEntityName(secName) || isEntityName(proxyName)) return false;
  if (sameOrdered(secNameParts(secName), proxyName) || sameOrdered(displayNameParts(secName), proxyName)) return true;
  // Four or more words ending in an initial can be a two-word surname
  // ("NORA JOHNSON SUZANNE M" is Suzanne M. Nora Johnson).
  const t = nameTokens(secName);
  if (t.length >= 4 && t[t.length - 1].length === 1 && t[t.length - 2].length > 1
    && sameOrdered({ last: t.slice(0, t.length - 2).join(''), first: t[t.length - 2], rest: [t[t.length - 1]] }, proxyName)) return true;
  // A two-word surname with no initial ("MONTGOMERY RICE VALERIE" is Valerie
  // Montgomery Rice): only when the other name ends in the same two words.
  const p = nameTokens(proxyName);
  return t.length >= 3 && p.length >= 3 && t[0] + t[1] === p[p.length - 2] + p[p.length - 1]
    && firstMatch(t[2], p[0]);
}
// How closely a filer name fits a listed name, for choosing between two
// people who both match (JIANG FAN is "Fan Jiang", not "Jane Fang Jiang"):
// 3 = same first name, 2 = a listed middle name is the filed first name,
// 1 = a short form or initial, 0 = no match.
export function matchScore(secName, proxyName) {
  if (!samePerson(secName, proxyName)) return 0;
  const s = secNameParts(secName), p = displayNameParts(proxyName);
  if (s.first && s.first === p.first) return 3;
  if (s.first && (p.rest.includes(s.first) || s.rest.includes(p.first))) return 2;
  return 1;
}
// Proxy names sometimes print the surname in capitals ("Eddie Yongming WU").
const NAME_CAPS_KEEP = /^(II|III|IV|VI|JR|SR|MD|PHD|CPA|JD|MBA|ESQ)$/;
// Honorifics are not part of the name ("Ambassador Susan Rice").
const HONORIFIC = /^(ambassador|amb\.|admiral|adm\.|general|gen\.|governor|gov\.|senator|sen\.|the honou?rable|honou?rable|hon\.|dr\.?|professor|prof\.|sir|dame|lord|mr\.?|mrs\.?|ms\.?)\s+(?=\S+\s+\S)/i;
export function tidyPersonName(name) {
  let s = String(name || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2 && HONORIFIC.test(s); i++) s = s.replace(HONORIFIC, '');
  const words = s.split(' ');
  // Two capitals are initials ("KC McClure") unless they end the name.
  return words.map((w, i) => (/^[A-Z][A-Z'’-]+$/.test(w) && !NAME_CAPS_KEEP.test(w) && (w.length >= 3 || i === words.length - 1)
    ? (w.charAt(0) + w.slice(1).toLowerCase().replace(/(['’-])([a-z])/g, (m, a, b) => a + b.toUpperCase())).replace(/^Mc([a-z])/, (m, c) => 'Mc' + c.toUpperCase()) : w)).join(' ').replace(/ (JR|SR)\.?$/, (m, x) => ' ' + x[0] + x[1].toLowerCase() + '.');
}
function sameOrdered(s, proxyName) {
  const p = displayNameParts(proxyName);
  if (!s.last || !p.last || !s.first) return false;
  const pAll = nameTokens(proxyName);
  const lastOk = s.last === p.last || pAll.slice(1).join('') === s.last || (pAll.length > 2 && pAll.slice(-2).join('') === s.last);
  const addedName = !lastOk && pAll.length > 2 && pAll.slice(1, -1).includes(s.last);
  if (!lastOk && !addedName) return false;
  if (firstMatch(s.first, p.first)) return true;
  if (addedName) return false;
  if (p.first.length === 1 && s.first[0] === p.first) return true;
  return s.rest.some((r) => firstMatch(r, p.first)) || p.rest.some((r) => r.length > 1 && firstMatch(s.first, r));
}
// An officer title that only points elsewhere ("See Remarks") says nothing.
const VAGUE_TITLE = /^\s*(see|refer to)\b.*\b(remarks?|explanation|footnotes?|attached|below|exhibit)\b|^\s*(n\/?a|none|-+|officer|(named )?executive officers?)\s*$/i;
export function cleanTitle(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s && !VAGUE_TITLE.test(s) ? s : null;
}
// A Form 4 whose title says "See Remarks" usually puts the title there.
export function officerTitle(title, remarks) {
  const own = cleanTitle(title);
  if (own || !title) return own;
  const r = String(remarks || '').replace(/\s+/g, ' ').trim();
  if (!r || r.length > 120 || /exhibit|power of attorney|footnote|signature|\bpursuant\b/i.test(r)) return null;
  return r.replace(/^(title|officer title)\s*:\s*/i, '');
}
// "COOK TIMOTHY D" -> "Timothy D. Cook". Entities keep their own words.
const ENTITY = /\b(inc|llc|l\.l\.c|l\.?p|lp|lllp|ltd|limited|corp|corporation|company|co|trust|fund|partners|holdings|group|capital|management|foundation|plc|pbc|n\.?v|s\.?a|ag|gmbh|bank|associates|advisors|investments|ventures|kk|k\.k|gp|s\.?a\.?r\.?l|b\.?v|pte)\b\.?/i;
export function isEntityName(name) {
  return ENTITY.test(String(name || ''));
}
export function prettySecName(name) {
  const raw = String(name || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (isEntityName(raw)) return titleCase(raw);
  // Degrees ("MONTGOMERY RICE VALERIE MD") are not names.
  const parts = raw.split(' ').filter((w, i) => i === 0 || !/^(m\.?d|ph\.?d|d\.?d\.?s|esq|cpa|j\.?d|mba)\.?,?$/i.test(w));
  if (parts.length < 2) return titleCase(raw);
  // Surnames of more than one word: a leading particle ("DE LA CRUZ JOSE"),
  // or four or more words ending in a middle initial ("NORA JOHNSON
  // SUZANNE M" is Suzanne M. Nora Johnson).
  let n = 1;
  while (n < parts.length - 1 && /^(de|del|della|la|le|van|von|der|den|da|di|dos|du|st\.?|san|ter|ten)$/i.test(parts[n - 1])) n++;
  if (n === 1 && parts.length >= 4 && /^[A-Za-z]\.?$/.test(parts[parts.length - 1]) && !/^[A-Za-z]\.?$/.test(parts[parts.length - 2])) n = parts.length - 2;
  const last = parts.slice(0, n).join(' '), rest = parts.slice(n);
  const firstNames = rest.map((p) => (/^[A-Za-z]$/.test(p) ? p.toUpperCase() + '.' : titleCase(p)));
  const suffix = firstNames.length > 1 && /^(Jr|Sr|Ii|Iii|Iv)\.?$/i.test(firstNames[firstNames.length - 1]) ? firstNames.pop() : null;
  return [...firstNames, titleCase(last)].join(' ') + (suffix ? ' ' + suffix.toUpperCase().replace('JR', 'Jr.').replace('SR', 'Sr.') : '');
}
// Company names from EDGAR ("WELLS FARGO & COMPANY/MN"): never reordered.
export function prettyCompanyName(name) {
  const raw = String(name || '').replace(/\s+/g, ' ').replace(/\s*\/[A-Z]{2,3}\/?$/, '').trim();
  // EDGAR drops the slash of A/S ("NOVO NORDISK A S").
  return (raw === raw.toUpperCase() ? titleCase(raw).replace(/ (Of|And|The|For) /g, (m, w) => ' ' + w.toLowerCase() + ' ') : raw).replace(/ A S$/i, ' A/S');
}
function titleCase(s) {
  return String(s).toLowerCase().replace(/(^|[\s\-'(/&.])([a-z])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase())
    .replace(/\b(Llc|Lp|Ltd|Inc|Plc|Nv|Sa|Ag|Ii|Iii|Iv)\b/g, (m) => ({ Llc: 'LLC', Lp: 'LP', Plc: 'PLC', Nv: 'NV', Sa: 'SA', Ag: 'AG', Ii: 'II', Iii: 'III', Iv: 'IV' }[m] || m));
}

// --- EDGAR full-text search ---------------------------------------------------
// display_names look like "Apple Inc.  (AAPL)  (CIK 0000320193)" or
// "COOK TIMOTHY D  (CIK 0001214156)".
export function parseDisplayName(s) {
  const text = String(s || '');
  const cik = /\(CIK\s*(\d+)\)/i.exec(text);
  const tick = /\(([A-Z0-9.\-, ]{1,24})\)\s*\(CIK/i.exec(text);
  const name = text.replace(/\s*\(CIK\s*\d+\)\s*$/i, '').replace(/\s*\([A-Z0-9.\-, ]{1,24}\)\s*$/, '').replace(/\s+/g, ' ').trim();
  return { name, ticker: tick ? tick[1].split(',')[0].trim() : null, cik: cik ? padCik(cik[1]) : null };
}
export function parseEftsHits(json) {
  const hits = json?.hits?.hits;
  if (!Array.isArray(hits)) throw new Error('Unrecognized SEC search response');
  const total = typeof json.hits.total === 'number' ? json.hits.total : Number(json.hits.total?.value) || hits.length;
  return {
    total,
    rows: hits.map((h) => {
      const s = h?._source || {};
      const id = String(h?._id || '');
      const acc = s.adsh || id.split(':')[0];
      const file = id.split(':').slice(1).join(':') || null;
      const names = Array.isArray(s.display_names) ? s.display_names.map(parseDisplayName) : [];
      const ciks = Array.isArray(s.ciks) ? s.ciks.map(padCik) : names.map((n) => n.cik);
      return { acc, file, form: s.form || (Array.isArray(s.root_forms) ? s.root_forms[0] : null), date: s.file_date || null, period: s.period_ending || null, ciks, names };
    }).filter((r) => r.acc),
    // Every filer across ALL matching filings (not only this page), merged by
    // CIK: EDGAR lists one bucket per spelling of the name.
    entities: entityBuckets(json?.aggregations?.entity_filter?.buckets),
  };
}

function entityBuckets(buckets) {
  const by = new Map();
  for (const b of Array.isArray(buckets) ? buckets : []) {
    const d = parseDisplayName(b?.key);
    if (!d.cik) continue;
    const e = by.get(d.cik) || { cik: d.cik, name: d.name, ticker: null, n: 0 };
    e.n += Number(b.doc_count) || 0;
    if (d.ticker && !e.ticker) e.ticker = d.ticker;
    // Prefer a mixed-case spelling ("NIKE, Inc.") over the all-caps one.
    if (d.name && d.name !== d.name.toUpperCase() && e.name === e.name.toUpperCase()) e.name = d.name;
    by.set(d.cik, e);
  }
  return [...by.values()];
}

export function archiveUrl(cik, acc, file) {
  const c = String(Number(String(cik).replace(/\D/g, '')));
  const a = String(acc).replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${c}/${a}/${file ? String(file).split('/').map(encodeURIComponent).join('/') : ''}`;
}
export function filingIndexUrl(cik, acc) {
  return archiveUrl(cik, acc, String(acc) + '-index.htm');
}
// The raw XML behind an ownership filing: EDGAR lists the rendered copy as
// "xslF345X05/form4.xml"; the raw file is the same name at the top level.
export function rawOwnershipFile(file) {
  return String(file || '').split('/').pop();
}
