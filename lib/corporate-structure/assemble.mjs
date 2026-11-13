// Turns one company's collected SEC data into the compact public read the
// stock page draws: people (board and executives) with roles, tenure,
// holdings, stake value, share of the votes, other companies; the share
// classes and their votes; who controls the vote; board make-up; leadership
// changes; and links to the other covered companies the people sit at.
// Pure and deterministic.
import { samePerson, matchScore, secNameParts, prettySecName, prettyCompanyName, nameTokens, foldName, tidyPersonName, isEntityName, shareClassOf, cleanTitle, TX_CODES, filingIndexUrl } from './forms.mjs';
import { holdingTotals } from './holdings.mjs';
import { roleLabel } from './collector.mjs';

export const CORPORATE_VIEW_VERSION = 3;
const DAY = 86_400_000;
const ACTIVE_DAYS = 460;

// Shares per US-listed depositary share, for valuing ordinary-share holdings
// at the US price. Only listings this site covers; others are left unvalued.
export const ADS_RATIO = Object.freeze({ TSM: 5, BABA: 8, ASML: 1, NVO: 1, ARM: 1 });

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
// Tiny stakes keep two significant digits so the page can say "<0.01%"
// rather than 0 (one director's 10,000 of 26 billion shares).
const r2 = (x) => (Number.isFinite(x) ? (x > 0 && x < 0.01 ? Number(x.toPrecision(2)) : Math.round(x * 100) / 100) : null);
const year = (iso) => (iso ? Number(String(iso).slice(0, 4)) : null);

// Share classes with votes: the proxy's own list, else one class.
export function shareClasses(proxyFacts, fallbackOutstanding) {
  const list = [];
  for (const c of proxyFacts?.classes || []) {
    const key = shareClassOf(c.name);
    if (key === 'preferred' || list.some((x) => x.key === key)) continue;
    list.push({ key, name: String(c.name).charAt(0).toUpperCase() + String(c.name).slice(1), votes: Number.isFinite(c.votesPerShare) ? c.votesPerShare : null, outstanding: Number.isFinite(c.outstanding) ? c.outstanding : null, listed: c.listed });
  }
  if (!list.length && fallbackOutstanding > 0) list.push({ key: 'common', name: 'Common stock', votes: 1, outstanding: Math.round(fallbackOutstanding), listed: true, source: 'quote' });
  else if (list.length === 1 && !(list[0].outstanding > 0) && fallbackOutstanding > 0) { list[0].outstanding = Math.round(fallbackOutstanding); list[0].source = 'quote'; }
  // A single class with no stated vote is one vote per share.
  if (list.length === 1 && list[0].votes == null) list[0].votes = 1;
  return list;
}
// Map a holding's class key onto the company's classes ("common" on a
// one-class company is that class; ADS rows are the listed class).
function classFor(classes, key) {
  if (!classes.length) return null;
  const hit = classes.find((c) => c.key === key);
  if (hit) return hit;
  if (classes.length === 1) return classes[0];
  if (key === 'common' || key === 'ADS') return classes.find((c) => c.listed !== false && c.key === 'A') || classes.find((c) => c.listed) || classes[0];
  return null;
}
// One US depositary share (ADS) is `adsRatio` ordinary shares.
export const ordinaryShares = (key, n, adsRatio) => (key === 'ADS' && adsRatio > 0 ? n * adsRatio : n);
export function voteMath(byClass, classes, adsRatio = null) {
  // A share of the company needs every class's count; a share of the votes
  // needs only the classes that vote (a non-voting class can lack a count).
  const allCounted = classes.length > 0 && classes.every((c) => c.outstanding > 0);
  const totalShares = allCounted ? classes.reduce((s, c) => s + c.outstanding, 0) : null;
  const votesKnown = classes.length > 0 && classes.every((c) => c.votes != null && (c.votes === 0 || c.outstanding > 0));
  const totalVotes = votesKnown ? classes.reduce((s, c) => s + (c.votes > 0 ? c.outstanding * c.votes : 0), 0) : null;
  let shares = 0, votes = 0, mapped = true;
  for (const [key, raw] of Object.entries(byClass || {})) {
    const c = classFor(classes, key);
    if (!c) { mapped = false; continue; }
    const n = ordinaryShares(key, raw, adsRatio);
    shares += n;
    if (c.votes != null) votes += n * c.votes; else mapped = false;
  }
  return {
    pctEconomic: totalShares > 0 && shares > 0 && mapped ? (shares / totalShares) * 100 : null,
    pctVoting: totalVotes > 0 && mapped && shares > 0 ? (votes / totalVotes) * 100 : null,
  };
}

// Filing titles often come in capitals ("EVP: CHIEF OPERATING OFFICER").
const ACRONYM = /^(ceo|cfo|coo|cto|cio|clo|cao|cso|cmo|cpo|cro|cco|cdo|chro|ciso|cob|pao|evp|svp|vp|gc|gm|us|usa|uk|eu|ai|it|hr|ip|r&d|esg|emea|apac|ii|iii|iv|llc|lp)$/;
const SMALL = /^(and|of|the|for|to|in|on|at|&)$/;
const SMALL_WORDS = /^(and|of|the|for|to|in|on|at|a|an|with|by|per|&)$/;
// A title can carry past roles ("Executive Chair & Former CEO", "Current
// CEO and Former COO"): the part before "former" is the current title.
export function splitFormer(t) {
  const s = String(t || '');
  const m = /(?:\s*[,;(]\s*|\s+(?:and|&)\s+|^\s*)\b(former(?:ly)?|previously|retired)\b/i.exec(s);
  if (!m) return { current: s.replace(/^\s*current\s+/i, '').trim(), former: '' };
  return { current: s.slice(0, m.index).replace(/[\s,;(&]+$/, '').replace(/^\s*current\s+/i, '').trim(), former: s.slice(m.index).replace(/^[\s,;(&]+|^\s*and\s+/i, '').trim() };
}
// Short words Form 4 titles use ("EVP, Corp Strategy and Dev", "Chf Ppl &
// Corp Aff", "Gen. Counsel & Corp. Sec.").
const TITLE_SHORT = [
  [/\bOfcr\b\.?/gi, 'Officer'], [/\bOfc\b\.?/gi, 'Officer'], [/\bChf\b\.?/gi, 'Chief'], [/\bPpl\b\.?/gi, 'People'], [/\bAff\b\.?/gi, 'Affairs'],
  [/\bCorp\b\.?(?=\s+[A-Za-z])/gi, 'Corporate'], [/\bDev\b\.?/gi, 'Development'], [/\bGen\b\.?(?=\s+Counsel)/gi, 'General'], [/\bGen\.(?=\s)/gi, 'General'],
  [/\bSec\.(?=\s|,|$)/gi, 'Secretary'], [/\bSecy\b\.?/gi, 'Secretary'], [/\bProd\b\.?/gi, 'Product'], [/\bFin\b\.?(?=\s+Officer)/gi, 'Financial'], [/\bFin\b\.?/gi, 'Finance'],
  [/\bAdmin\b\.?(?=\s+Officer)/gi, 'Administrative'], [/\bAdmin\b\.?/gi, 'Administration'], [/\bStrat\b\.?/gi, 'Strategy'], [/\bAcctg?\b\.?/gi, 'Accounting'],
  [/\bTreas\b\.?/gi, 'Treasurer'], [/\bEngr?g?\b\.?/gi, 'Engineering'], [/\bMfg\b\.?/gi, 'Manufacturing'], [/\bGovt\b\.?/gi, 'Government'], [/\bPres\b\.?(?=\s|,|$)/gi, 'President'],
  [/\bOps\b/gi, 'Operations'], [/\bMktg\b/gi, 'Marketing'], [/\bMgmt\b/gi, 'Management'], [/\bSvcs\b/gi, 'Services'], [/\bIntl\b/gi, 'International'],
  [/\bMgr\b/gi, 'Manager'], [/\bOp\b\.?(?=\s+Officer)/gi, 'Operating'], [/\bGrp\b/gi, 'Group'], [/\bTech\b(?=\.?\s|$)/gi, 'Technology'],
  [/\bGbl\b\.?/gi, 'Global'], [/\bGlbl\b\.?/gi, 'Global'], [/\bSol\.(?=\s|,|$)/gi, 'Solutions'], [/\bSols\b\.?/gi, 'Solutions'], [/\bComms\b\.?/gi, 'Communications'],
];
export function tidyTitle(t) {
  let s = cleanTitle(t);
  if (!s) return null;
  s = splitFormer(s).current;
  if (!s) return null;
  if (s === s.toUpperCase() && /[A-Z]{2}/.test(s)) {
    s = s.toLowerCase().split(' ').map((w, i) => w.split('-').map((part, j) => {
      const core = part.replace(/[^a-z&]/g, '');
      if (ACRONYM.test(core)) return part.toUpperCase();
      if ((i > 0 || j > 0) && SMALL.test(core) && core === part) return part;
      const k = part.search(/[a-z]/);
      return k < 0 ? part : part.slice(0, k) + part.charAt(k).toUpperCase() + part.slice(k + 1);
    }).join('-')).join(' ');
  }
  // Short Form 4 titles ("Chief Inn,prod&dsg Ofcr") read out in full.
  if (/\bofcr\b/i.test(s)) {
    s = s.replace(/\binn\b/gi, 'Innovation').replace(/\bdsg\b/gi, 'Design').replace(/\s*,\s*/g, ', ').replace(/\s*&\s*/g, ' & ');
  }
  for (const [re, word] of TITLE_SHORT) s = s.replace(re, word);
  s = s.replace(/\bBus\.? Development\b/gi, 'Business Development').replace(/\bSr\.?(?= )/g, 'Senior').replace(/\bExec\.?(?= )/g, 'Executive');
  // Sentence-case titles ("president and chief executive officer", "svp,
  // corporate finance"): capitalise the plain lower-case words.
  if (/(?:^|[\s,;(\/])(?!(?:and|of|the|for|to|in|on|at|a|an|with|by|per)\b)[a-z]+(?=[\s,;)\/]|$)/.test(s)) {
    s = s.replace(/(^|[\s,;(\/-])([A-Za-z][A-Za-z&'’]*)/g, (m, pre, w, off) => {
      const lw = w.toLowerCase();
      if (ACRONYM.test(lw)) return pre + lw.toUpperCase();
      if (!/^[a-z][a-z'’&]*$/.test(w)) return m;
      if (off > 0 && SMALL_WORDS.test(lw)) return m;
      return pre + w.charAt(0).toUpperCase() + w.slice(1);
    });
  }
  // "COB" on a Form 4 is Chairman of the Board.
  return s.replace(/\bCOB\b/gi, 'Chair of the Board').replace(/^co-/, 'Co-').replace(/\s{2,}/g, ' ').trim();
}
const KEY_ROLES = [/chief executive|\bceo\b/i, /chief financ(ial|e)|\bcfo\b/i, /chief operating|\bcoo\b/i, /(?<!vice[ -])\bpresident\b/i, /\bchair/i];
const roleKeys = (t) => KEY_ROLES.map((re) => re.test(t || '')).join('');
// "Chief of Staff to the CEO" and "CEO-elect" are not the CEO.
const isCeoText = (t) => {
  const s = String(t || '').replace(/\b(to|of|for)\s+(the\s+)?(ceo|chief executive(\s+officer)?)\b/gi, ' ');
  return /chief executive|\bceo\b/i.test(s) && !/former|deputy|designate|\belect\b/i.test(s);
};
const isCoCeoText = (t) => /\bco-?\s?(ceo|chief executive)/i.test(t || '');
// Chair of the board, not of a committee and not vice chair.
const isChairText = (t) => /\bchair(man|woman|person)?\b/i.test(t || '') && !/vice|committee|\(|emeritus|former/i.test(t || '');
const isLeadText = (t) => /\blead\b/i.test(t || '') && /director/i.test(t || '');

// Covered companies by a plain form of their name, to spot a proxy's
// "other public boards" that are on this site.
const CO_SUFFIX = /\b(the|inc|incorporated|corp|corporation|co|company|companies|ltd|limited|plc|holdings?|group|sa|nv|ag|se|llc|lp|platforms|technologies|technology)\b/g;
export function companyKey(name) {
  return String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(CO_SUFFIX, ' ').replace(/\s+/g, ' ').trim().replace(/( and)+$/, '').replace(/^and /, '');
}

// Each filer gets at most one board row and one executive row, and each row
// one filer: the closest name fits are paired first (JIANG FAN is "Fan
// Jiang", JIANG FANG is "Jane Fang Jiang").
function assignProxy(owners, list, namesOf) {
  const pairs = [];
  for (const o of owners) for (const p of list || []) {
    const sc = Math.max(0, ...namesOf(o).map((n) => matchScore(n, p.name)));
    if (sc > 0) pairs.push({ o, p, sc });
  }
  pairs.sort((a, b) => b.sc - a.sc);
  const byOwner = new Map(), taken = new Set();
  for (const { o, p } of pairs) if (!byOwner.has(o.cik) && !taken.has(p)) { byOwner.set(o.cik, p); taken.add(p); }
  return byOwner;
}
function nameKey(n) {
  return foldName(n).toLowerCase().replace(/[^a-z]/g, '');
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// "September 21, 2026" or "2026-09-21" as YYYY-MM-DD; anything else null.
export function isoDate(v) {
  const t = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  const i = m ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) : -1;
  return i >= 0 && Number(m[2]) >= 1 && Number(m[2]) <= 31 ? `${m[3]}-${String(i + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

export function buildCompanyView(c, { people = {}, price = null, sharesOutstanding = null, displayName = null, coveredByCik = new Map(), coveredByName = new Map(), nowMs = Date.now(), symbol = c?.symbol } = {}) {
  if (!c || !c.cik) return null;
  const facts = c.proxy?.status === 'ok' ? c.proxy.facts : null;
  const proxyFiled = facts ? c.proxy.filed || null : null;
  const proxyFresh = !!(proxyFiled && nowMs - Date.parse(proxyFiled) <= ACTIVE_DAYS * DAY);
  const classes = shareClasses(facts, sharesOutstanding);
  const adsRatio = ADS_RATIO[symbol] || null;
  const unitPrice = Number.isFinite(price) && price > 0 ? (adsRatio ? price / adsRatio : price) : null;
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const nowYear = Number(today.slice(0, 4));
  const usedProxyBoard = new Set(), usedProxyExec = new Set(), usedOwnerRows = new Set();
  const out = [], args = [];
  const proxyNewer = (iso) => proxyFiled && (!iso || proxyFiled > iso);
  const proxyChairs = resolveProxyChairs(facts?.board);
  // Foreign filers' insiders first filed Forms 3/4/5 when the 2026 rule began
  // (March 18, 2026). Those first Form 3s, in the company's first 120 days of
  // filings, mark the rule, not the day someone joined.
  const ruleFirst = c.sub?.foreign ? Object.values(c.owners || {}).map((o) => c.form3?.[o.cik] || o.form3 || o.first).filter((d) => d && d >= FPI_RULE_START).sort()[0] || null : null;
  const ruleUntil = ruleFirst ? new Date(Date.parse(ruleFirst) + 120 * DAY).toISOString().slice(0, 10) : null;
  const ruleFiling = (d) => !!(ruleUntil && d && d <= ruleUntil);
  const coveredOf = (name) => coveredByName.get(companyKey(name)) || null;

  // A filing director whose surname alone matches one board member nobody
  // else matched, when no other filing director shares that surname (a short
  // name the matcher does not know, such as "Dara" for Oluwadara).
  const surnameOf = (sec) => secNameParts(sec).last;
  const owners = Object.values(c.owners || {});
  // The search index and the filing itself can spell a filer differently
  // ("Vojvodich Radakovich Lynn" / "Radakovich Lynn Vojvodich"): try both.
  const namesOf = (o) => [...new Set([c.names?.[o.cik], o.sec].filter(Boolean))];
  const boardOf = assignProxy(owners, facts?.board, namesOf);
  const execOf = assignProxy(owners, facts?.executives, namesOf);
  const matchedBoard = new Set(boardOf.values());
  const matchedExec = new Set(execOf.values());
  const directorSurnames = new Map();
  for (const o of owners) {
    const sec = c.names?.[o.cik] || o.sec;
    if (o.roles?.director) directorSurnames.set(surnameOf(sec), (directorSurnames.get(surnameOf(sec)) || 0) + 1);
  }
  const boardBySurname = (sec) => {
    const k = surnameOf(sec);
    if (!k || k.length < 3 || directorSurnames.get(k) !== 1) return null;
    const hits = (facts?.board || []).filter((b) => { const t = nameTokens(b.name); return !matchedBoard.has(b) && (t[t.length - 1] === k || t.slice(-2).join('') === k); });
    if (hits.length !== 1) return null;
    matchedBoard.add(hits[0]);
    return hits[0];
  };
  // The same person's board row and executive row (an English first name in
  // one list, a legal name on the filings: "Eddie Wu" / WU YONGMING).
  const pairOf = (row, list, used) => (row ? (list || []).find((x) => !used.has(x) && (nameKey(x.name) === nameKey(row.name) || samePersonLoose(x.name, row.name))) || null : null);
  const afterProxy = (days) => (proxyFiled ? new Date(Date.parse(proxyFiled) + days * DAY).toISOString().slice(0, 10) : null);

  // Section 16 insiders first: they carry filed roles and holdings.
  for (const o of owners) {
    const sec = c.names?.[o.cik] || o.sec;
    const entity = isEntityName(sec) || isEntityName(o.sec);
    let pb = entity ? null : boardOf.get(o.cik) || (o.roles?.director ? boardBySurname(sec) : null);
    let pe = entity ? null : execOf.get(o.cik) || null;
    if (pb && !pe) { pe = pairOf(pb, facts?.executives, matchedExec); if (pe) matchedExec.add(pe); }
    if (pe && !pb) { pb = pairOf(pe, facts?.board, matchedBoard); if (pb) matchedBoard.add(pb); }
    const po = entity ? null : (facts?.owners || []).find((x) => x.kind !== 'group' && (namesOf(o).some((n) => samePerson(n, x.name)) || (pb && samePersonLoose(x.name, pb.name)))) || null;
    const recent = o.last && nowMs - Date.parse(o.last) <= ACTIVE_DAYS * DAY;
    // A director missing from the proxy's board list has left the board: one
    // who last filed before that proxy, or (a director not put up for
    // re-election) one who has filed nothing since the months around the
    // annual meeting. Someone whose Form 3 came after the proxy joined later.
    const joinedAfterProxy = !!proxyFiled && [c.form3?.[o.cik], o.form3].some((d) => d && d > proxyFiled);
    const quietSinceMeeting = proxyFresh && facts?.board?.length >= 3 && !!o.last && o.last <= afterProxy(120);
    // A read cut short (partial) may miss board members, so it ends nobody.
    const leftBoard = !!(o.roles?.director && facts?.board?.length && !c.proxy?.partial && !pb && !joinedAfterProxy && (proxyNewer(o.last) || (quietSinceMeeting && !o.roles?.officer)));
    // The proxy's executive list names past officers too; a newer filing that
    // no longer says officer, or a title that is only "former", ends it.
    const rolesAt = o.rolesFiled || o.last || null;
    const peCurrent = !!pe && !(pe.title && !tidyTitle(pe.title) && /former|retired|previously/i.test(pe.title)) && !(rolesAt && proxyFiled && rolesAt > proxyFiled && !o.roles?.officer);
    const active = !!pb || peCurrent || (recent && !leftBoard);
    if (pb) usedProxyBoard.add(nameKey(pb.name));
    if (pe) usedProxyExec.add(nameKey(pe.name));
    if (po) usedOwnerRows.add(nameKey(po.name));
    args.push({ o, sec, pb, pe: peCurrent ? pe : null, po, active, entity, offBoard: leftBoard ? proxyFiled : null });
    out.push(personRow(args[args.length - 1]));
  }
  // Proxy people with no Section 16 filings (new nominees, foreign filers).
  for (const pb of facts?.board || []) if (!usedProxyBoard.has(nameKey(pb.name)) && !matchedBoard.has(pb)) {
    const pe = (facts.executives || []).find((e) => !matchedExec.has(e) && (nameKey(e.name) === nameKey(pb.name) || samePersonLoose(e.name, pb.name)));
    if (pe) usedProxyExec.add(nameKey(pe.name));
    const po = (facts.owners || []).find((x) => x.kind !== 'group' && samePersonLoose(x.name, pb.name));
    if (po) usedOwnerRows.add(nameKey(po.name));
    args.push({ o: null, pb, pe, po, active: true, entity: false });
    out.push(personRow(args[args.length - 1]));
  }
  for (const pe of facts?.executives || []) if (!usedProxyExec.has(nameKey(pe.name)) && !matchedExec.has(pe)) {
    // An executive listed only as a former officer is not current.
    if (pe.title && !tidyTitle(pe.title) && /former|retired|previously/i.test(pe.title)) continue;
    const po = (facts.owners || []).find((x) => x.kind !== 'group' && samePersonLoose(x.name, pe.name));
    if (po) usedOwnerRows.add(nameKey(po.name));
    args.push({ o: null, pb: null, pe, po, active: true, entity: false });
    out.push(personRow(args[args.length - 1]));
  }

  function personRow({ o, sec = o?.sec, pb, pe, po, active, entity, offBoard = null }) {
    const roles = o?.roles || {};
    // The newer of the last ownership filing and the proxy decides the role.
    const filedAt = o?.rolesFiled || o?.last || null;
    const filingNewer = !!(o && filedAt && (!proxyFiled || filedAt > proxyFiled));
    // A filing with no usable title ("See Remarks") leaves the proxy's.
    const filingTitle = roles.officer ? tidyTitle(roles.title) : null;
    // The proxy's title, unless it only says "Executive Officer".
    const peTitle = pe ? tidyTitle(pe.title) : null;
    // A newer filing that repeats a role the proxy calls past ("Executive Vice
    // Chair and former CEO") carries a stale title: the proxy's stands.
    const peFormer = pe ? splitFormer(pe.title).former : '';
    const staleFiling = !!(filingNewer && filingTitle && peTitle && peFormer && KEY_ROLES.some((re) => re.test(filingTitle) && re.test(peFormer) && !re.test(peTitle)));
    let officer, title, titleAt;
    if (staleFiling) {
      officer = true; title = peTitle; titleAt = proxyFiled;
    } else if (filingNewer) {
      officer = !!roles.officer;
      title = officer ? (peTitle && (!filingTitle || roleKeys(peTitle) === roleKeys(filingTitle)) ? peTitle : filingTitle || peTitle || 'Officer (no title filed)') : null;
      titleAt = filingTitle || !pe ? filedAt : proxyFiled;
    } else {
      officer = !!(pe || roles.officer);
      title = peTitle || filingTitle || (officer ? 'Officer (no title filed)' : null);
      titleAt = peTitle ? proxyFiled : filedAt;
    }
    // The proxy's board list stands until the next proxy: Form 4s often tick
    // only "officer" for a director who is also an executive.
    const director = !!(pb || roles.director);
    const boardRoles = cleanBoardRoles(pb?.roles, pb && proxyChairs.has(pb.name));
    const proxyChair = boardRoles.some(isChairText);
    const filingChair = isChairText(filingTitle) || isChairText(tidyTitle(roles.otherText));
    // Form 4 titles often leave out "chair", so the proxy's chair stands
    // until a newer filing names someone else (settled below).
    const chair = director && (proxyChair || filingChair);
    const ceo = officer && (isCeoText(title) || ((!filingNewer || !filingTitle) && !staleFiling && (pb?.roles || []).some(isCeoText)));
    const totals = o ? holdingTotals(o) : { byClass: {}, total: 0, direct: 0, indirect: 0, asOf: null };
    // Holdings: the latest Form 3/4/5 lines, unless the proxy table shows a
    // share class those filings have not reported (a Form 4 lists only the
    // classes traded that day), or there are no filings (foreign filers).
    const proxyBy = {};
    for (const h of po?.holdings || []) if (h.shares > 0) { const k = shareClassOf(h.className || ''); proxyBy[k] = (proxyBy[k] || 0) + h.shares; }
    const mapKey = (k) => (classFor(classes, k) || { key: k }).key;
    const filingKeys = new Set(Object.keys(totals.byClass).map(mapKey));
    const missingClass = Object.keys(proxyBy).some((k) => !filingKeys.has(mapKey(k)));
    let byClass = totals.byClass, holdSource = totals.total > 0 ? 'filings' : null, holdAsOf = totals.asOf;
    if (Object.keys(proxyBy).length && (!(totals.total > 0) || (proxyFresh && missingClass))) {
      byClass = proxyBy; holdSource = 'proxy'; holdAsOf = isoDate(facts?.asOfDate) || proxyFiled || null;
    }
    // Totals and value count each ADS as its ordinary shares.
    const sharesTotal = Object.entries(byClass).reduce((s, [k, n]) => s + ordinaryShares(k, n, adsRatio), 0);
    const adsHeld = byClass.ADS > 0 && adsRatio > 1 ? byClass.ADS : null;
    const vm = voteMath(byClass, classes, adsRatio);
    const link = o ? people[o.cik] : null;
    const here = link?.links?.[c.cik];
    // Start dates: a Form 3 is the day someone became an insider; any other
    // first filing only shows they were one by then.
    const form3Filed = [c.form3?.[o?.cik], here?.form3, o?.form3].filter(Boolean).sort()[0] || null;
    const seenFiled = [form3Filed, here?.first, o?.first].filter(Boolean).sort()[0] || null;
    const form3 = ruleFiling(form3Filed) ? null : form3Filed;
    const seenSince = ruleFiling(seenFiled) ? null : seenFiled;
    const other = link ? Object.values(link.links || {})
      .filter((l) => l.cik !== c.cik && !l.coFiler && (l.ticker || l.issuer || (isEntityName(l.name) && !FUND_LIKE.test(l.name))))
      .map((l) => ({
        name: prettyCompanyName(l.name), ticker: l.ticker || coveredByCik.get(l.cik) || null, cik: l.cik, role: l.role ? l.role.split(' · ').map((r) => (/^(Director|10% owner|Insider|Officer)$/.test(r) ? r : tidyTitle(r) || r)).join(' · ') : null, since: l.form3 || l.first || null, last: l.last || null, before: l.before || null,
        active: !!l.last && nowMs - Date.parse(l.last) <= ACTIVE_DAYS * DAY, covered: coveredByCik.get(l.cik) || null, source: 'filings',
      })).sort((a, b) => Number(b.active) - Number(a.active) || String(b.last || b.before || '').localeCompare(String(a.last || a.before || ''))).slice(0, 12) : [];
    const otherBoards = (pb?.otherBoards || []).map((b) => ({ ...b, covered: coveredOf(b.company) }));
    const name = tidyPersonName(pb?.name || pe?.name || (o ? prettySecName(sec) : po?.name)) || 'Unknown';
    const boardSince = pb?.since ?? null;
    const startYear = boardSince ?? pe?.joined ?? pe?.since ?? year(form3);
    const filedName = o ? prettySecName(sec) : null;
    return {
      id: o?.cik || 'p-' + nameKey(name).slice(0, 24),
      name,
      // The filed name only when it is not just the same name in SEC order.
      alsoKnownAs: filedName && nameKey(filedName) !== nameKey(name) && !samePersonLoose(filedName, name) && !samePerson(sec, name) && !samePerson(o.sec, name) ? filedName : null,
      cik: o?.cik || null,
      entity,
      active,
      director,
      officer,
      tenPct: !!roles.tenPct,
      title,
      titleAt,
      ceo,
      chair,
      chairAt: chair ? (filingChair && (filingNewer || !proxyChair) ? filedAt : proxyFiled) : null,
      leadIndependent: boardRoles.some(isLeadText),
      // Left off the board list of the proxy filed on this day.
      offBoard,
      // Joined after the newest proxy, so no proxy has described them yet.
      newSinceProxy: director && !pb && !!proxyFiled && !!form3Filed && form3Filed > proxyFiled,
      // An executive on the board is never an independent director.
      independent: director && officer ? false : pb ? (pb.independent ?? null) : null,
      age: pb?.age ?? pe?.age ?? null,
      boardSince,
      roleSince: pe?.since ?? null,
      joined: pe?.joined ?? null,
      insiderSince: form3,
      seenSince,
      tenureYears: tenure(startYear, nowYear),
      tenureFrom: boardSince != null ? 'board' : pe?.joined != null ? 'joined' : pe?.since != null ? 'role' : form3 ? 'form3' : null,
      committees: pb?.committees || [],
      chairOf: pb?.chairOf || [],
      boardRoles,
      occupation: pb?.occupation || null,
      otherBoards,
      holdings: sharesTotal > 0 ? {
        byClass, total: sharesTotal, ads: adsHeld, adsRatio: adsHeld ? adsRatio : null,
        direct: holdSource === 'filings' && !adsHeld ? totals.direct : null, indirect: holdSource === 'filings' && !adsHeld ? totals.indirect : null,
        asOf: holdAsOf, source: holdSource,
        lines: o ? Object.values(o.lines || {}).filter((l) => l.shares > 0).sort((a, b) => b.shares - a.shares).slice(0, 6).map((l) => ({ cls: l.cls, di: l.di, how: l.di === 'I' ? (l.nature || 'Indirect') : 'Direct', note: l.note || null, shares: l.shares, asOf: l.asOf })) : [],
      } : null,
      value: sharesTotal > 0 && unitPrice ? Math.round(sharesTotal * unitPrice) : null,
      // Filed, but no shares on any line (a Form 3 with nothing to report).
      noShares: !(sharesTotal > 0) && !!o?.last && !po?.holdings?.length,
      pctEconomic: r2(vm.pctEconomic),
      pctVoting: r2(vm.pctVoting ?? (Number.isFinite(po?.votingPercent) ? po.votingPercent : null)),
      proxy: po ? { holdings: po.holdings, votingPercent: po.votingPercent } : null,
      other,
      tx: (o?.tx || []).slice(0, 6).map((t) => ({ date: t.date, code: t.code, what: TX_CODES[t.code] || 'Other', shares: t.shares, price: t.price, ad: t.ad, post: t.post })),
      lastFiled: o?.last || null,
      lastUrl: o?.lastUrl || (o?.lastAcc ? filingIndexUrl(c.cik, o.lastAcc) : null),
      filingRole: o ? tidyTitle(roleLabel({ ...roles, title: tidyTitle(roles.title) })) : null,
      joint: o?.joint || null,
    };
  }

  // One person listed under two names (an English name in the proxy, the
  // legal name on the filings: "Wendell Huang" / HUANG JEN-CHAU): same last
  // name, same seat, one only in the proxy and one only in the filings.
  mergeSamePeople(out, args, personRow);
  // Leadership: directors and officers. Funds and pure 10% owners are holders.
  const current = out.filter((p) => p.active && !p.entity && (p.director || p.officer));
  // Heads of a division ("CEO, Amazon Web Services") are not the CEO when
  // someone holds the plain title.
  const ceos = current.filter((p) => p.ceo);
  if (ceos.some((p) => !divisionCeo(p.title))) for (const p of ceos) if (divisionCeo(p.title)) p.ceo = false;
  // One CEO and one chair: when sources disagree, the newest dated one wins
  // (a new CEO's Form 4 beats an older proxy that named the last one).
  const notes = [];
  // Co-CEOs (Netflix, Oracle) share the seat. A CEO who was replaced and has
  // no board seat has left; one who stays on the board keeps only that seat
  // (and a chair title, if any).
  settleRole(current, 'ceo', 'titleAt', (p, w) => {
    notes.push(`${p.name} was named CEO in the ${p.titleAt} filing; a newer filing (${w.titleAt}) names ${w.name}.`);
    p.replacedBy = { name: w.name, role: 'CEO', at: w.titleAt };
    if (!p.director) p.active = false;
    else if (!/\bchair/i.test(p.title || '')) { p.officer = false; p.title = null; }
  }, (p, winners) => isCoCeoText(p.title) && winners.some((w) => isCoCeoText(w.title)));
  settleRole(current, 'chair', 'chairAt', (p, w) => {
    notes.push(`${p.name} was listed as chair in the ${p.chairAt} filing; a newer filing (${w.chairAt}) names ${w.name}.`);
    p.boardRoles = (p.boardRoles || []).filter((r) => !isChairText(r) || /vice|co-?chair/i.test(r));
  });
  // A company has one CFO, one chief legal officer and so on: when two
  // people carry the same such title, the newer filing's holder has it.
  settleOneOfficeEach(current, (p, w, label) => {
    notes.push(`${p.name} was listed as ${label} in the ${p.titleAt} filing; a newer filing (${w.titleAt}) names ${w.name}.`);
    p.replacedBy = { name: w.name, role: label, at: w.titleAt };
    if (p.director) { p.officer = false; p.title = null; p.ceo = false; } else p.active = false;
  });
  for (let i = current.length - 1; i >= 0; i--) if (!current[i].active) current.splice(i, 1);
  const former = out.filter((p) => !p.active && !p.entity && (p.director || p.officer)).sort((a, b) => String(b.replacedBy?.at || b.lastFiled).localeCompare(String(a.replacedBy?.at || a.lastFiled))).slice(0, 15)
    .map((p) => ({ name: p.name, role: p.replacedBy ? (p.replacedBy.role === 'CEO' ? p.title || 'CEO' : p.title) : p.filingRole || p.title, lastFiled: p.lastFiled, lastUrl: p.lastUrl, insiderSince: p.insiderSince, seenSince: p.seenSince, replacedBy: p.replacedBy || null, offBoard: p.offBoard || null }));
  current.sort(sortPeople);

  // Large holders: the proxy's 5% rows, then 10% owners that file Form 4s
  // (filers on one joint filing are one holder).
  // Preferred stock (a fixed-dividend class, no say in the vote) is left out.
  const holderRow = (name, holdingsAll, votingPercent, extra = {}) => {
    const holdingsList = (holdingsAll || []).filter((h) => shareClassOf(h.className || '') !== 'preferred');
    if (!holdingsList.length && !Number.isFinite(votingPercent)) return null;
    const byClass = {};
    for (const h of holdingsList) if (h.shares > 0) byClass[shareClassOf(h.className || '')] = (byClass[shareClassOf(h.className || '')] || 0) + h.shares;
    const vm = voteMath(byClass, classes, adsRatio);
    const pctClass = holdingsList.map((h) => h.percent).filter(Number.isFinite);
    // No printed percent: the shares over the class's outstanding count.
    if (!pctClass.length) for (const [k, n] of Object.entries(byClass)) { const cl = classFor(classes, k); if (cl?.outstanding > 0) pctClass.push(ordinaryShares(k, n, adsRatio) / cl.outstanding * 100); }
    let pctOfClass = pctClass.length ? r2(Math.max(...pctClass)) : null;
    let pctVoting = Number.isFinite(votingPercent) ? votingPercent : vm.pctVoting;
    // One class: its percent of the class is its percent of the votes.
    if (classes.length <= 1) { if (pctOfClass == null && Number.isFinite(pctVoting)) pctOfClass = r2(pctVoting); if (pctVoting == null && pctOfClass != null) pctVoting = pctOfClass; }
    const shares = Object.entries(byClass).reduce((s, [k, n]) => s + ordinaryShares(k, n, adsRatio), 0);
    return { name, holdings: holdingsList, votingPercent, pctEconomic: r2(vm.pctEconomic ?? (classes.length <= 1 ? pctOfClass : null)), pctVoting: r2(pctVoting), pctOfClass, shares: shares || null, value: unitPrice && shares ? Math.round(shares * unitPrice) : null, ...extra };
  };
  const holders = (facts?.owners || []).filter((x) => x.kind === 'holder' && !usedOwnerRows.has(nameKey(x.name)) && !current.some((p) => samePersonLoose(p.name, x.name)))
    .map((x) => holderRow(x.name, x.holdings, x.votingPercent, { source: 'proxy' })).filter(Boolean);
  const filers = out.filter((p) => p.active && (p.entity || !(p.director || p.officer)) && (p.tenPct || p.entity));
  const groups = new Map();
  for (const p of filers) {
    const k = c.owners?.[p.cik]?.lastAcc || p.id;
    (groups.get(k) || groups.set(k, []).get(k)).push(p);
  }
  for (const list of groups.values()) {
    const lead = list.find((p) => p.holdings?.total > 0) || list[0];
    const match = holders.find((h) => list.some((p) => sameHolder(h.name, p.name)));
    const members = list.map((p) => p.name);
    if (match) { match.alsoFiles = true; match.filers = members; match.lastFiled = lead.lastFiled; match.lastUrl = lead.lastUrl; continue; }
    const hl = lead.holdings ? Object.entries(lead.holdings.byClass).map(([k, n]) => ({ className: (classFor(classes, k) || {}).name || k, shares: n, percent: null })) : [];
    const row = holderRow(lead.name, hl, null, { source: 'filings', filers: members, lastFiled: lead.lastFiled, lastUrl: lead.lastUrl, tenPct: true });
    // A 10% owner whose filed lines come to under 1% is a partial read (a
    // fund's last Form 4 listed one small line), not its stake.
    const pct = row ? row.pctVoting ?? row.pctOfClass : null;
    if (row && !(Number.isFinite(pct) && pct < 1)) holders.push(row);
  }
  holders.sort((a, b) => (b.pctVoting ?? b.pctOfClass ?? 0) - (a.pctVoting ?? a.pctOfClass ?? 0));
  holders.splice(12);
  const groupRow = (facts?.owners || []).find((x) => x.kind === 'group') || null;

  const insiderVotes = current.reduce((s, p) => s + (p.pctVoting || 0), 0);
  const insiderEcon = current.reduce((s, p) => s + (p.pctEconomic || 0), 0);
  const control = controlRead({ current, holders, groupRow, classes, facts, insiderVotes, insiderEcon });
  const board = boardRead(current, nowYear);
  const interlocks = interlockRead(current, c.cik, symbol);
  const changes = changeRead(c, out, nowMs);
  // Leadership-change 8-Ks filed after the proxy: roles taken from the proxy
  // may be out of date until the next proxy or Form 4.
  const lateEvents = (c.sub?.events || []).filter((e) => proxyFiled && e.date > proxyFiled);
  const asOf = [c.sweep?.through, proxyFiled].filter(Boolean).sort().pop() || null;
  return {
    v: CORPORATE_VIEW_VERSION,
    asOf,
    // The site's own name for the stock (Yahoo's: "JPMorgan Chase & Co.",
    // "Novo Nordisk A/S") reads better than EDGAR's capitals.
    name: cleanDisplayName(displayName) || prettyCompanyName(c.name) || symbol,
    cik: c.cik,
    foreign: !!c.sub?.foreign,
    section16: c.sub?.section16 !== false,
    collecting: !c.sweep?.at || (c.sweep?.pending || []).some((p) => !c.read?.[p.acc] && !(c.owners?.[p.owners[0]]?.last)) || (c.sub?.doc && (!c.proxy || c.proxy.acc !== c.sub.doc.acc) ? true : false),
    source: {
      doc: c.proxy?.status === 'ok' ? { form: c.proxy.form, filed: c.proxy.filed, url: c.proxy.url, recordDate: isoDate(facts?.recordDate), kept: c.proxy.kept, dropped: (c.proxy.dropped || []).length, partial: !!c.proxy.partial } : null,
      docPending: c.sub?.doc && (!c.proxy || c.proxy.acc !== c.sub.doc.acc || c.proxy.status !== 'ok') ? { form: c.sub.doc.form, filed: c.sub.doc.filed } : null,
      filingsThrough: c.sweep?.through || null,
      insiders: Object.keys(c.owners || {}).length,
      edgar: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.cik}&type=&dateb=&owner=include&count=40`,
      unitPriceNote: adsRatio && adsRatio !== 1 ? `Ordinary shares valued at the US share price ÷ ${adsRatio} (one US share = ${adsRatio} ordinary shares).` : null,
      lateChanges: lateEvents.length ? { count: lateEvents.length, latest: lateEvents[0].date, url: lateEvents[0].url } : null,
      notes: (c.proxy?.status === 'ok' && c.proxy.partial ? [`Only part of the ${c.proxy.form} was read (the reply was cut short), so some of its people or holders may be missing.`] : []).concat(notes).slice(0, 4),
    },
    classes: classes.map((x) => ({ key: x.key, name: x.name, votes: x.votes, outstanding: x.outstanding, listed: x.listed, source: x.source || 'filing' })),
    people: current,
    former,
    holders,
    group: groupRow ? { name: groupRow.name, holdings: groupRow.holdings, votingPercent: groupRow.votingPercent } : null,
    control,
    board,
    interlocks,
    changes,
  };
}

const FPI_RULE_START = '2026-03-18';
function settleRole(list, flag, dateKey, onDrop, keep = null) {
  const holders = list.filter((p) => p[flag]);
  if (holders.length < 2) return;
  const newest = holders.map((p) => p[dateKey] || '').sort().pop();
  const winners = holders.filter((p) => (p[dateKey] || '') === newest);
  for (const p of holders) if (!winners.includes(p) && !keep?.(p, winners)) { onDrop(p, winners[0]); p[flag] = false; p['was' + flag[0].toUpperCase() + flag.slice(1)] = p[dateKey] || true; }
}
// Board leadership roles only; committee seats the model put here are dropped,
// as are contradictions ("Chair" and "Vice Chair" on one person).
const BOARD_ROLE = /chair|lead (independent )?director|presiding director/i;
function cleanBoardRoles(roles, keepChair) {
  let list = [...new Set((roles || []).map((r) => String(r || '').trim()).filter((r) => r && BOARD_ROLE.test(r) && !/committee|\(/i.test(r)))];
  if (!keepChair) list = list.filter((r) => !isChairText(r) || /vice|co-?chair/i.test(r));
  const top = list.some((r) => isChairText(r) && !/co-?chair/i.test(r));
  if (top) list = list.filter((r) => !/vice|co-?chair/i.test(r));
  if (list.some((r) => /executive chair/i.test(r))) list = list.filter((r) => !/^chair(man|woman|person)? of the board$/i.test(r));
  return list;
}
// The model sometimes reads a director's past chair of another company as a
// chair role here. When the proxy names more than one board chair, keep the
// one the document supports best: their main job says chair (not "former"),
// an executive chair, a director who is not independent.
function resolveProxyChairs(board) {
  const list = (board || []).filter((b) => (b.roles || []).some((r) => isChairText(r) && !/co-?chair/i.test(r)));
  if (list.length <= 1) return new Set(list.map((b) => b.name));
  const score = (b) => (/\bchair/i.test(b.occupation || '') && !/former|retired|emerit/i.test(b.occupation || '') ? 3 : 0)
    + ((b.roles || []).some((r) => /executive chair/i.test(r)) ? 2 : 0) + (b.independent === false ? 1 : 0);
  const best = Math.max(...list.map(score));
  const top = list.filter((b) => score(b) === best);
  return new Set(top.length === 1 ? top.map((b) => b.name) : []);
}
// "CEO, TSMC Arizona" / "CEO Worldwide Amazon Stores": a qualifier after the
// title that is not another role.
function divisionCeo(t) {
  return /(chief executive officer|\bceo\b)(?:\s*(?:,|-|–|—|\bof\b|\bfor\b|\bat\b)\s*|\s+)(?!and\b|&|president|chair|director|co-?founder|secretary|treasurer)[a-z0-9]/i.test(t || '');
}
function lastNameOf(name) {
  const t = nameTokens(name);
  return t[t.length - 1] || '';
}
function mergeSamePeople(out, args, personRow) {
  const idx = out.map((p, i) => i);
  const proxyOnly = idx.filter((i) => !args[i].o && out[i].active);
  const filedOnly = idx.filter((i) => args[i].o && !args[i].pb && !args[i].pe && out[i].active && !out[i].entity);
  const seat = (p) => [p.director ? 'director' : null, p.ceo ? 'ceo' : null, ...ONE_EACH.filter(([, re]) => p.officer && re.test(p.title || '')).map(([k]) => k)].filter(Boolean);
  const plainOfficer = (p) => p.officer && !p.director;
  const drop = new Set(), taken = new Set();
  for (const i of proxyOnly) {
    const p = out[i], seats = seat(p);
    const same = filedOnly.filter((j) => !taken.has(j) && sameSurname(p.name, out[j].name));
    let hits = seats.length ? same.filter((j) => seat(out[j]).some((k) => seats.includes(k))) : [];
    // Officers below the top seats (TSMC's 20-F lists "Lora Ho"; her Form 3
    // says HO LI-MEI): one each side with that surname, or one each side at
    // the same rank (SVP, VP).
    if (hits.length !== 1 && plainOfficer(p)) {
      const peers = proxyOnly.filter((k) => !drop.has(k) && plainOfficer(out[k]) && sameSurname(p.name, out[k].name));
      const cands = same.filter((j) => plainOfficer(out[j]));
      const r = officerRank(p.title);
      hits = peers.length === 1 && cands.length === 1 ? cands
        : r && peers.filter((k) => officerRank(out[k].title) === r).length === 1 ? cands.filter((j) => officerRank(out[j].title) === r) : [];
    }
    if (hits.length !== 1) continue;
    const j = hits[0];
    const merged = { ...args[j], pb: args[i].pb, pe: args[i].pe, po: args[j].po || args[i].po };
    args[j] = merged;
    out[j] = personRow(merged);
    drop.add(i); taken.add(j);
  }
  for (const i of [...drop].sort((a, b) => b - a)) { out.splice(i, 1); args.splice(i, 1); }
}
// Same surname, or one letter apart with the same first initial
// ("Y.P. Chyn" in the 20-F, CHIN YUNG-PEI on the Form 3).
function sameSurname(a, b) {
  const la = lastNameOf(a), lb = lastNameOf(b);
  if (!la || !lb) return false;
  if (la === lb) return true;
  return la.length >= 4 && lb.length >= 4 && oneEditApart(la, lb) && nameTokens(a)[0]?.[0] === nameTokens(b)[0]?.[0];
}
function oneEditApart(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
function officerRank(t) {
  const s = String(t || '');
  return /executive vice president|\bevp\b/i.test(s) ? 3 : /senior vice president|\bsvp\b/i.test(s) ? 2 : /vice president|\bvp\b/i.test(s) ? 1 : 0;
}
const ONE_EACH = [
  ['CFO', /chief financ(ial|e)\b.*officer|\bcfo\b/i],
  ['chief accounting officer', /chief accounting officer|principal accounting officer|\bcao\b|\bpao\b/i],
  ['chief legal officer', /chief legal officer|general counsel|\bclo\b|\bgc\b/i],
  ['chief operating officer', /chief operating officer|\bcoo\b/i],
  ['controller', /\b(corporate )?controller\b|\bcomptroller\b/i],
];
function settleOneOfficeEach(list, onDrop) {
  for (const [label, re] of ONE_EACH) {
    const holders = list.filter((p) => p.active && p.officer && re.test(p.title || '') && !/deputy|assistant|interim|associate|\bco-|divisional|segment|designate|elect\b/i.test(p.title || ''));
    if (holders.length < 2) continue;
    const newest = holders.map((p) => p.titleAt || '').sort().pop();
    const winner = holders.find((p) => (p.titleAt || '') === newest);
    for (const p of holders) if ((p.titleAt || '') < newest) onDrop(p, winner, label);
  }
}
// Private funds and partnerships a person co-files with are not companies
// they work at; public companies carry a ticker or are confirmed issuers.
const FUND_LIKE = /\b(fund|funds|l\.?\s?p\.?|llc|l\.l\.c|partners|partnership|ventures|capital|investors|associates|advisors|advisers|management|trust|foundation|family|holdings?)\b/i;
const HOLDER_STOP = new Set(['funds', 'fund', 'accounts', 'managed', 'advised', 'entities', 'entity', 'affiliated', 'affiliates', 'with', 'llc', 'inc', 'group', 'capital', 'management', 'partners', 'holdings', 'trust', 'the', 'and', 'corporation', 'corp', 'company', 'limited', 'ltd', 'by', 'or', 'its', 'certain']);
function holderWords(n) {
  return String(n || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !HOLDER_STOP.has(w));
}
function sameHolder(a, b) {
  const wa = holderWords(a), wb = new Set(holderWords(b));
  return wa.length > 0 && wa.some((w) => wb.has(w)) && (samePersonLoose(a, b) || wa.filter((w) => wb.has(w)).length >= Math.min(2, wa.length, wb.size));
}

function samePersonLoose(a, b) {
  const ta = nameTokens(a).filter((t) => t.length > 1);
  const tb = nameTokens(b).filter((t) => t.length > 1);
  if (!ta.length || !tb.length) return false;
  return ta[ta.length - 1] === tb[tb.length - 1] && (ta[0] === tb[0] || ta[0].slice(0, 3) === tb[0].slice(0, 3));
}
function tenure(startYear, nowYear) {
  return Number.isFinite(startYear) && startYear > 1900 && startYear <= nowYear ? nowYear - startYear : null;
}
function rankOf(p) {
  if (p.ceo) return 0;
  if (p.chair) return 1;
  if (p.officer && /president|chief operating|\bcoo\b/i.test(p.title || '')) return 2;
  if (p.officer && /chief financial|\bcfo\b/i.test(p.title || '')) return 3;
  if (p.officer && /chief/i.test(p.title || '')) return 4;
  if (p.officer) return 5;
  if (p.leadIndependent) return 6;
  if (p.director) return 7;
  return 8;
}
function sortPeople(a, b) {
  return rankOf(a) - rankOf(b) || (b.pctVoting || 0) - (a.pctVoting || 0) || (b.value || 0) - (a.value || 0) || a.name.localeCompare(b.name);
}

export function controlRead({ current, holders, groupRow, classes, facts, insiderVotes, insiderEcon }) {
  const cands = [
    ...current.map((p) => ({ name: p.name, kind: 'insider', pctVoting: p.proxy?.votingPercent ?? p.pctVoting, pctEconomic: p.pctEconomic, id: p.id })),
    ...holders.map((h) => ({ name: h.name, kind: 'holder', pctVoting: h.pctVoting, pctEconomic: h.pctEconomic })),
  ].filter((x) => Number.isFinite(x.pctVoting) && x.pctVoting > 0).sort((a, b) => b.pctVoting - a.pctVoting);
  const top = cands[0] || null;
  const dual = classes.length > 1 && new Set(classes.map((c) => c.votes)).size > 1;
  const groupVote = Number.isFinite(groupRow?.votingPercent) ? groupRow.votingPercent : null;
  const insiders = groupVote ?? (insiderVotes > 0 ? r1(insiderVotes) : null);
  let level, summary;
  if (top && top.pctVoting >= 50) { level = 'controlled'; summary = `${top.name} controls the company, with about ${r1(top.pctVoting)}% of the votes.`; }
  else if (insiders != null && insiders >= 50) { level = 'insiders'; summary = `Directors and officers together hold about ${r1(insiders)}% of the votes, a majority.`; }
  else if (top && top.pctVoting >= 20) { level = 'sway'; summary = `${top.name} has the most sway, with about ${r1(top.pctVoting)}% of the votes. No one holds a majority.`; }
  else if (top) { level = 'spread'; summary = `No single holder controls the vote. The largest is ${top.name} with about ${r1(top.pctVoting)}%.`; }
  else { level = 'unknown'; summary = 'The filings read so far do not show who holds the most votes.'; }
  const gap = top && Number.isFinite(top.pctEconomic) && top.pctVoting - top.pctEconomic >= 5
    ? `${top.name} owns about ${r1(top.pctEconomic)}% of the shares but about ${r1(top.pctVoting)}% of the votes.` : null;
  const votesNote = dual ? classes.filter((c) => c.votes != null).map((c) => `${c.name}: ${c.votes === 0 ? 'no vote' : c.votes + (c.votes === 1 ? ' vote' : ' votes')} per share`).join(' · ') : null;
  return {
    level, summary, gap, dual, votesNote,
    controlledCompany: facts?.controlledCompany === true,
    filingNote: facts?.controlNote || null,
    insidersVotingPct: insiders,
    insidersEconomicPct: insiderEcon > 0 ? r1(insiderEcon) : null,
    top: cands.slice(0, 8).map((x) => ({ name: x.name, kind: x.kind, id: x.id || null, pctVoting: r2(x.pctVoting), pctEconomic: r2(x.pctEconomic) })),
  };
}

export function boardRead(current, nowYear) {
  const dirs = current.filter((p) => p.director);
  const known = dirs.filter((p) => p.independent != null);
  const indep = known.filter((p) => p.independent).length;
  const ten = dirs.map((p) => p.boardSince ? nowYear - p.boardSince : null).filter(Number.isFinite);
  const ages = dirs.map((p) => p.age).filter(Number.isFinite);
  const ceo = current.find((p) => p.ceo) || null;
  const chair = dirs.find((p) => p.chair) || null;
  const committees = {};
  for (const d of dirs) for (const cm of d.committees) {
    const k = cm.replace(/\s+committee$/i, '').trim();
    (committees[k] ||= { name: k, members: [], chair: null }).members.push(d.id);
    if (d.chairOf.some((x) => x.toLowerCase().includes(k.toLowerCase().slice(0, 6)))) committees[k].chair = d.id;
  }
  return {
    size: dirs.length,
    independent: known.length ? indep : null,
    independentPct: known.length ? Math.round((indep / known.length) * 100) : null,
    avgTenure: ten.length ? r1(ten.reduce((s, x) => s + x, 0) / ten.length) : null,
    avgAge: ages.length ? r1(ages.reduce((s, x) => s + x, 0) / ages.length) : null,
    ceo: ceo ? ceo.id : null,
    chair: chair ? chair.id : null,
    ceoIsChair: !!(ceo && chair && ceo.id === chair.id),
    leadIndependent: (dirs.find((p) => p.leadIndependent) || {}).id || null,
    withOtherBoards: dirs.filter((p) => p.other.some((o) => o.active) || p.otherBoards.some((b) => b.current)).length,
    committees: Object.values(committees).sort((a, b) => b.members.length - a.members.length).slice(0, 8),
  };
}

function interlockRead(current, selfCik, selfSym) {
  // Covered companies that share a person with this one: from their own
  // Form 4s at both, or the proxy's list of their other public boards.
  const by = new Map();
  const add = (sym, name, p, role, via) => {
    if (!sym || sym === selfSym) return;
    const e = by.get(sym) || { symbol: sym, name, people: [] };
    if (!e.people.some((x) => x.id === p.id)) e.people.push({ id: p.id, name: p.name, role: role || null, via });
    by.set(sym, e);
  };
  for (const p of current) {
    for (const o of p.other) if (o.covered && o.active && o.cik !== selfCik) add(o.covered, o.name, p, o.role, 'filings');
    for (const b of p.otherBoards || []) if (b.covered && b.current) add(b.covered, b.company, p, 'Director', 'proxy');
  }
  return [...by.values()].sort((a, b) => b.people.length - a.people.length).slice(0, 12);
}

function changeRead(c, all, nowMs) {
  const out = [];
  const cut = new Date(nowMs - 550 * DAY).toISOString().slice(0, 10);
  for (const p of all) {
    if (p.entity || !(p.director || p.officer)) continue;
    if (p.insiderSince && p.insiderSince >= cut) out.push({ date: p.insiderSince, kind: 'joined', name: p.name, id: p.id, role: p.title || p.filingRole || (p.director ? 'Director' : 'Officer') });
    if (!p.active && p.lastFiled && p.lastFiled >= cut) out.push({ date: p.lastFiled, kind: 'last-filing', name: p.name, role: p.filingRole || p.title, offBoard: p.offBoard || null, replacedBy: p.replacedBy || null });
  }
  for (const e of c.sub?.events || []) out.push({ date: e.date, kind: '8-K', url: e.url });
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 30);
}

// The whole state → { SYMBOL: view } for the per-ticker files.
const cleanDisplayName = (s) => { const v = String(s || '').replace(/\s+/g, ' ').trim(); return v && v.length <= 80 ? v : null; };
export function buildCorporateViews(state, { prices = {}, sharesOut = {}, names = {}, nowMs = Date.now(), onError = null } = {}) {
  const coveredByCik = new Map(Object.values(state?.companies || {}).filter((c) => c.cik).map((c) => [c.cik, c.symbol]));
  const coveredByName = new Map();
  for (const c of Object.values(state?.companies || {})) { const k = companyKey(c.name); if (k && !coveredByName.has(k)) coveredByName.set(k, c.symbol); }
  const views = {};
  for (const [sym, c] of Object.entries(state?.companies || {})) {
    try {
      const v = buildCompanyView(c, { people: state.people || {}, price: prices[sym], sharesOutstanding: sharesOut[sym], displayName: names[sym], coveredByCik, coveredByName, nowMs, symbol: sym });
      if (v && (v.people.length || v.holders.length)) views[sym] = v;
    } catch (err) { onError?.(sym, err); /* one company's odd data never blocks the rest */ }
  }
  crossCheckCovered(views);
  // Searched EDGAR and found no insider filings and no proxy or annual report
  // to read (a company that reports its board to a home regulator instead):
  // say so rather than "still collecting" forever.
  for (const [sym, c] of Object.entries(state?.companies || {})) {
    if (views[sym] || !c?.cik || !c.sweep?.at || c.sub?.doc || Object.keys(c.owners || {}).length) continue;
    views[sym] = { v: CORPORATE_VIEW_VERSION, empty: true, name: cleanDisplayName(names[sym]) || prettyCompanyName(c.name) || sym, cik: c.cik, asOf: c.sweep.through || null, foreign: !!c.sub?.foreign,
      source: { filingsThrough: c.sweep.through || null, edgar: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.cik}&type=&dateb=&owner=include&count=40` } };
  }
  return views;
}

// A link to another covered company counts as current only when that
// company's own view lists the person as current (a filing link stays
// "active" for a while after someone leaves). Then each pair of companies
// shows the same shared people from both sides.
export function crossCheckCovered(views) {
  const isCurrentAt = (sym, p) => {
    const v = views[sym];
    if (!v) return null;
    return v.people.some((q) => (p.cik && q.cik === p.cik) || samePersonLoose(q.name, p.name));
  };
  for (const [sym, v] of Object.entries(views)) {
    for (const p of v.people) {
      for (const o of p.other || []) if (o.covered && o.active && o.covered !== sym && isCurrentAt(o.covered, p) === false) { o.active = false; o.left = true; }
      for (const b of p.otherBoards || []) if (b.covered && b.current && b.covered !== sym && isCurrentAt(b.covered, p) === false) { b.current = false; b.left = true; }
    }
    v.interlocks = interlockRead(v.people, v.cik, sym);
    v.board.withOtherBoards = v.people.filter((p) => p.director && ((p.other || []).some((o) => o.active) || (p.otherBoards || []).some((b) => b.current))).length;
  }
  // Same people on both sides of each pair.
  for (const [sym, v] of Object.entries(views)) {
    for (const link of v.interlocks) {
      const back = views[link.symbol];
      if (!back) continue;
      let e = back.interlocks.find((x) => x.symbol === sym);
      for (const lp of link.people) {
        const there = v.people.find((q) => q.id === lp.id);
        const here = back.people.find((q) => (there?.cik && q.cik === there.cik) || samePersonLoose(q.name, lp.name));
        if (!here) continue;
        if (!e) { e = { symbol: sym, name: v.name, people: [] }; back.interlocks.push(e); }
        if (!e.people.some((x) => x.id === here.id)) e.people.push({ id: here.id, name: here.name, role: there ? roleShort(there) : null, via: lp.via });
      }
    }
  }
  for (const v of Object.values(views)) v.interlocks.sort((a, b) => b.people.length - a.people.length).splice(12);
}
function roleShort(p) {
  return p.ceo ? 'CEO' : p.chair ? 'Chair' : p.officer ? p.title || 'Officer' : p.director ? 'Director' : null;
}
