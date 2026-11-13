// The yearly proxy statement (DEF 14A), or Item 6-7 of a foreign company's
// 20-F, read once per filing: board, independence, committees, other jobs and
// boards, executive officers, the beneficial ownership table and the votes
// each share class carries. One Gemini Flash-Lite call per new filing (about
// once a year per company). Everything the model returns is checked against
// the filing's own text: a name, number or year that does not appear in the
// document is dropped, so the page never shows a figure the filing lacks.

import { foldName } from './forms.mjs';

export const PROXY_PROMPT_VERSION = 4;
export const PROXY_MAX_CHARS = 170_000;

export function htmlToText(html) {
  const raw = String(html || '');
  // Line breaks in HTML source mean nothing (each table cell is often on its
  // own source line); only the tags below start a new line.
  const flat = /<(html|body|table|div|p)\b/i.test(raw) ? raw.replace(/\s+/g, ' ') : raw;
  return flat
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<ix:header\b[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&(rsquo|lsquo);/g, "'").replace(/&(rdquo|ldquo|quot);/g, '"').replace(/&(mdash|ndash);/g, '-')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&[a-z]+;/gi, ' ')
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    // A cell's paragraph ends in a line break before its divider; join it,
    // so a padded table row ("Leslie Kilgore (9)", then ten lines of empty
    // cells, then "458,671") reads as one line and takes a tenth of the room.
    .replace(/\n[ \t]*(?=\|)/g, ' ')
    .replace(/( ?\| ?){2,}/g, ' | ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
function safeChar(n) {
  try { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; } catch { return ' '; }
}

// Windows of the proxy around the sections we read. The table of contents
// repeats every heading, so each heading can open several windows; the
// windows are merged and the total is capped (ownership and nominees first).
const PROXY_SECTIONS = [
  { re: /security ownership of (certain )?beneficial owners|beneficial ownership of (our )?(common|capital|ordinary)|stock ownership(?! (guidelines?|requirements?|policy|policies))|holdings of (major|principal) (share|stock)holders|principal (stock|share)holders|ownership of (our )?(voting )?securities|shares beneficially owned|5% (beneficial )?(owners|holders|stockholders|shareholders)/gi, after: 26_000, rank: 0, table: true },
  { re: /director nominees|nominees for (election as )?director|election of directors|our (director )?nominees|board nominees|director biographies|director qualifications/gi, after: 42_000, rank: 1 },
  { re: /(our )?executive officers|executive officers of the (company|registrant)|information about our executive officers/gi, after: 9_000, rank: 2 },
  { re: /director independence|independence of (the )?(board|directors)|independent directors|board independence/gi, after: 6_000, rank: 3 },
  { re: /committees? of the board|board committees|committee (membership|composition)/gi, after: 8_000, rank: 3 },
  { re: /record date|votes? per share|entitled to (one|ten|twenty|\d+) votes?|voting power|controlled company/gi, after: 2_500, rank: 4 },
];
export function sliceProxy(text, maxChars = PROXY_MAX_CHARS) {
  const t = String(text || '');
  if (t.length <= maxChars) return t;
  const wins = [];
  for (const s of PROXY_SECTIONS) {
    if (s.table) {
      // The ownership table's heading is named many times before the table
      // itself (contents, cross-references): keep the three places followed
      // by the most share counts and percents.
      // The table's own last row ("All directors and executive officers as
      // a group") is a second anchor: the rows above it are the table.
      const hits = [...t.matchAll(s.re)].slice(0, 80).map((m) => ({ a: m.index - 1200, b: m.index + s.after, score: tableScore(t.slice(m.index, m.index + 8_000)) }))
        .concat([...t.matchAll(/as a group/gi)].slice(0, 40).map((m) => ({ a: m.index - 14_000, b: m.index + 8_000, score: tableScore(t.slice(Math.max(0, m.index - 8_000), m.index + 600)) + 4 })));
      for (const h of hits.sort((x, y) => y.score - x.score).slice(0, 3)) wins.push({ a: Math.max(0, h.a), b: Math.min(t.length, h.b), rank: s.rank });
      continue;
    }
    let n = 0;
    for (const m of t.matchAll(s.re)) {
      if (n++ >= 8) break;
      wins.push({ a: Math.max(0, m.index - 1200), b: Math.min(t.length, m.index + s.after), rank: s.rank });
    }
  }
  return mergeWindows(t, wins, maxChars);
}
// Ownership rows (a share count followed by a percent or "*", the percent
// sign sometimes in a cell of its own), then other big numbers: pay tables
// are full of dollar figures but have few such rows.
function tableScore(s) {
  return 3 * (s.match(/\d{1,3}(?:,\d{3})+\s*(?:\(\d+\))?\s*\|?\s*(?:\*|\d{1,2}(?:\.\d+)?\s*\|?\s*%)/g) || []).length + numberDensity(s) / 4;
}
// Share counts (1,234,567) and percents in a stretch of text.
function numberDensity(s) {
  return (s.match(/\d{1,3}(?:,\d{3}){2,}/g) || []).length + (s.match(/\d(?:\.\d+)?\s?%/g) || []).length;
}
function mergeWindows(t, wins, maxChars) {
  wins.sort((x, y) => x.a - y.a);
  const merged = [];
  for (const w of wins) {
    const last = merged[merged.length - 1];
    if (last && w.a <= last.b) { last.b = Math.max(last.b, w.b); last.rank = Math.min(last.rank, w.rank); } else merged.push({ ...w });
  }
  let total = merged.reduce((s, w) => s + (w.b - w.a), 0);
  // Over the cap: trim the lowest-priority windows first, then shorten.
  const order = [...merged].sort((x, y) => y.rank - x.rank || (y.b - y.a) - (x.b - x.a));
  for (const w of order) {
    if (total <= maxChars) break;
    const cut = Math.min(w.b - w.a, total - maxChars);
    w.b -= cut; total -= cut;
  }
  return merged.filter((w) => w.b > w.a).map((w) => t.slice(w.a, w.b)).join('\n[…]\n');
}
// A 20-F: Item 6 (directors, senior management, share ownership) through
// Item 7 (major shareholders). The table of contents and cross-references
// ("see “Item 6. Directors, Senior Management…”") repeat the heading, so a
// quoted mention never starts the slice and the longest Item 6 → Item 8
// span wins.
export function slice20F(text, maxChars = PROXY_MAX_CHARS) {
  const t = String(text || '');
  const quoted = (i) => /(["“‘’']|\b(see|under|in|to|and|also)\s*["“‘’']?)\s*$/i.test(t.slice(Math.max(0, i - 24), i));
  const item6 = [...t.matchAll(/item\s*6\s*[.:\-–—]?\s*directors,?\s+senior\s+management/gi)].map((m) => m.index).filter((i) => !quoted(i));
  const item8 = [...t.matchAll(/item\s*8\s*[.:\-–—]?\s*financial\s+information/gi)].map((m) => m.index).filter((i) => !quoted(i));
  let best = null;
  for (const a of item6) {
    const b = item8.find((x) => x > a);
    if (b != null && (!best || !best.ends || b - a > best.b - best.a)) best = { a, b, ends: true };
    else if (b == null && !best) best = { a, b: Math.min(t.length, a + 400_000), ends: false };
  }
  if (!best) return sliceProxy(t, maxChars);
  const body = t.slice(best.a, best.b);
  if (body.length <= maxChars) return body;
  const wins = [{ a: 0, b: Math.min(body.length, 110_000), rank: 0 }];
  const major = /major shareholders/gi;
  let n = 0;
  for (const m of body.matchAll(major)) { if (n++ > 3) break; wins.push({ a: Math.max(0, m.index - 800), b: Math.min(body.length, m.index + 22_000), rank: 0 }); }
  for (const m of body.matchAll(/share ownership/gi)) { wins.push({ a: Math.max(0, m.index - 800), b: Math.min(body.length, m.index + 14_000), rank: 1 }); break; }
  return mergeWindows(body, wins, maxChars);
}

// Some 20-Fs (Novo Nordisk) only point to the annual report for the board,
// management and major shareholders ("Reference is made to pages 37-39 of
// our Annual Report"). The annual report is an exhibit of the same filing.
export function refersToAnnualReport(text) {
  return /(reference is made to|refer to|see|included in|set out in|described in)[^.]{0,120}\bannual report\b[^.]{0,200}\b(board of directors|members of the board|executive management|major shareholders|directors)\b/i.test(String(text || ''));
}
// The documents table of a filing's -index.htm page.
export function parseFilingIndex(html) {
  const out = [];
  for (const row of String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    const link = /href="([^"]+)"/i.exec(row[1]);
    if (cells.length < 4 || !link) continue;
    const plain = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const href = link[1].replace(/^\/ix\?doc=/, '');
    out.push({ description: plain(cells[1] || ''), file: href.split('/').pop(), href, type: plain(cells[3] || ''), size: Number(plain(cells[4] || '').replace(/\D/g, '')) || 0 });
  }
  return out;
}
// The exhibit named as the annual report, else the largest EX-15 / EX-99
// web page over 300 KB (Novo files its annual report as EX-15.1 with no
// description).
export function annualReportExhibit(rows) {
  const pages = (rows || []).filter((r) => /^EX-/i.test(r.type) && /\.html?$/i.test(r.file));
  const named = pages.filter((r) => /annual\s*report|annualreport|\bar\s?20\d\d\b/i.test(r.description + ' ' + r.file));
  const big = pages.filter((r) => /^EX-(15|99)\b/i.test(r.type) && r.size >= 300_000);
  return (named.length ? named : big).sort((a, b) => b.size - a.size)[0] || null;
}
// From the annual report: the board and management pages (the ones dense
// with "Born", "Nationality", "Elected") and the shareholder pages.
export function sliceAnnualReport(text, maxChars = 90_000) {
  const t = String(text || '');
  if (t.length <= maxChars) return t;
  const wins = [];
  const bios = (x) => (x.match(/\b(born|nationality|elected|re-elected|independent|member of the board|chair)\b/gi) || []).length;
  const top = (re, score, n, after, rank) => {
    const hits = [...t.matchAll(re)].slice(0, 80).map((m) => ({ i: m.index, s: score(t.slice(m.index, m.index + after)) }));
    for (const h of hits.sort((x, y) => y.s - x.s).slice(0, n)) if (h.s > 0) wins.push({ a: Math.max(0, h.i - 800), b: Math.min(t.length, h.i + after), rank });
  };
  top(/board of directors|executive management|management board|supervisory board/gi, bios, 3, 20_000, 0);
  top(/major shareholders|shareholder structure|shares and capital structure|share capital|ownership structure/gi, numberDensity, 2, 10_000, 1);
  return mergeWindows(t, wins, maxChars);
}

export const PROXY_SYSTEM_PROMPT = [
  'You read one SEC filing (a proxy statement or the directors and shareholders items of an annual report) and return its facts as JSON.',
  'Use ONLY this document. Never use outside knowledge, never guess, never compute a figure the document does not print. Use null or an empty list when the document does not say.',
  'Copy names exactly as the document prints them. Copy numbers exactly (shares as whole numbers, percents as printed, e.g. 0.5 for "0.5%"). An asterisk or "less than 1%" is null.',
  'board: every current director or director nominee. independent: true only if the document calls that person independent, false if it says they are not (an employee or executive is not independent), null if it does not say.',
  'directorSince: the year the document says they joined the board. occupation: their current main job as the document states it. otherBoards: other PUBLIC company boards the document lists, current ones with current=true and past ones with current=false.',
  'boardRole: the one board leadership role the document gives that person, if any: "Chair of the Board" (also Chairman, Chairperson, Non-Executive Chair), "Executive Chair", "Co-Chair", "Vice Chair" or "Lead Independent Director" (also Lead Director, Presiding Director). Leave it out for an ordinary director. Chairing a committee is NOT a board role: put it in chairOf. committees: the board committees they sit on (full names, each once); chairOf: the committees they chair.',
  'executives: the executive officers the document lists with title, age and the year they took the current role and the year they joined the company when stated.',
  'classes: every class of common or capital stock, including classes with no vote (votesPerShare 0), with the shares outstanding on the record date as printed, and whether that class is listed on an exchange. votesPerShare is null when the votes per share vary.',
  'owners: every row of the beneficial ownership table(s): directors, named officers, the "all directors and executive officers as a group" row (kind group) and every 5% holder (kind holder). For each row give shares and percent of class for each class the table shows, and votingPercent only when the table has a separate column for the percent of total voting power.',
  'controlledCompany: true if the document says the company is a "controlled company" under exchange rules. controlNote: one short sentence on who controls the vote if the document says so (for example a founder holding a majority of the voting power), else null.',
].join('\n');

// Every list is capped (maxItems, a string: the API's int64 fields) so a
// reply that starts repeating one row stops at the cap instead of running to
// the output limit. The caps are not always kept, so the board role is one
// value from a fixed list, not a list: a free list of roles is where the
// model looped ("Chair of the Board" hundreds of times) on GS, MDB and SHOP.
export const BOARD_ROLES = ['Chair of the Board', 'Executive Chair', 'Co-Chair', 'Vice Chair', 'Lead Independent Director'];
const S = (type, extra = {}) => ({ type, ...extra });
const NS = (type, extra = {}) => ({ type, nullable: true, ...extra });
export const PROXY_SCHEMA = {
  type: 'object',
  properties: {
    asOfDate: NS('string'),
    recordDate: NS('string'),
    classes: S('array', { maxItems: '8', items: S('object', { properties: { name: S('string'), votesPerShare: NS('number'), outstanding: NS('number'), listed: NS('boolean') }, required: ['name'] }) }),
    controlledCompany: NS('boolean'),
    controlNote: NS('string'),
    board: S('array', { maxItems: '40', items: S('object', { properties: {
      name: S('string'), age: NS('number'), directorSince: NS('number'), independent: NS('boolean'),
      boardRole: S('string', { enum: BOARD_ROLES }), committees: S('array', { maxItems: '10', items: S('string') }), chairOf: S('array', { maxItems: '6', items: S('string') }),
      occupation: NS('string'), otherBoards: S('array', { maxItems: '12', items: S('object', { properties: { company: S('string'), current: NS('boolean') }, required: ['company'] }) }),
    }, required: ['name'] }) }),
    executives: S('array', { maxItems: '40', items: S('object', { properties: { name: S('string'), title: NS('string'), age: NS('number'), since: NS('number'), joined: NS('number') }, required: ['name'] }) }),
    owners: S('array', { maxItems: '60', items: S('object', { properties: {
      name: S('string'), kind: S('string', { enum: ['director', 'officer', 'holder', 'group', 'other'] }),
      holdings: S('array', { maxItems: '6', items: S('object', { properties: { className: NS('string'), shares: NS('number'), percent: NS('number') } }) }),
      votingPercent: NS('number'),
    }, required: ['name', 'kind'] }) }),
  },
  required: ['board', 'owners', 'classes', 'executives'],
};

// The schema with every maxItems removed.
export function uncapped(node) {
  if (Array.isArray(node)) return node.map(uncapped);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) if (k !== 'maxItems') out[k] = uncapped(v);
  return out;
}

export function proxyUserMessage({ company, symbol, form, filed, text }) {
  return `Company: ${company} (${symbol}). Document: SEC ${form} filed ${filed}. Extract the JSON described in the instructions from this text.\n\n<<<DOCUMENT\n${text}\nDOCUMENT>>>`;
}

// --- checking the model's answer against the filing ---------------------------
function normText(text) {
  return foldName(text).toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
}
function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function intPattern(n) {
  const digits = String(Math.round(Math.abs(n)));
  const groups = [];
  for (let i = digits.length; i > 0; i -= 3) groups.unshift(digits.slice(Math.max(0, i - 3), i));
  return new RegExp('(?<![\\d.,])' + groups.join('[,.\\s ]?') + '(?![\\d]|[.,]\\d)');
}
// A count printed in millions or billions ("1,075 million shares", "3.39
// billion") matches when it gives the same number and has three or more
// significant digits ("4.5 billion" is too rough to confirm a count).
const SCALE = { million: 1e6, mn: 1e6, billion: 1e9, bn: 1e9 };
function hasScaled(text, n) {
  if (n < 1e6) return false;
  for (const m of String(text).matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?(million|billion|mn|bn)\b/g)) {
    if ((m[1] + (m[2] || '')).replace(/,/g, '').replace(/^0+/, '').replace(/0+$/, '').length < 3 && !/,/.test(m[1])) continue;
    const v = Number(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : '')) * SCALE[m[3]];
    if (Math.abs(v - n) < 0.5) return true;
  }
  return false;
}
export function hasInteger(text, n) {
  if (!Number.isFinite(n) || n < 0) return false;
  return intPattern(n).test(text) || hasScaled(text, n);
}
export function hasPercent(text, p) {
  if (!Number.isFinite(p) || p < 0 || p > 100) return false;
  const s = String(p);
  const [i, d] = s.split('.');
  const re = new RegExp('(?<![\\d.])' + esc(i) + (d ? '[.,]' + esc(d) + '0*' : '(?:[.,]0+)?') + '(?![\\d])');
  return re.test(text);
}
const WORDNUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
function hasSmallNumber(text, n) {
  if (!Number.isFinite(n)) return false;
  if (Number.isInteger(n) && n >= 0 && n <= 20 && new RegExp('\\b' + WORDNUM[n] + '\\b').test(text)) return true;
  return new RegExp('(?<![\\d.])' + esc(String(n)) + '(?![\\d])').test(text);
}
export function hasName(text, name) {
  // A quoted nickname (R. Martin "Marty" Chavez) is printed in many ways.
  // Degrees ("Noubar Afeyan, Ph.D.") are printed many ways and are not names.
  const toks = foldName(String(name || '').replace(/["“”'‘’][^"“”'‘’]{1,20}["“”'‘’]/g, ' ')).toLowerCase()
    .replace(/,?\s*\b(ph\.?\s?d|m\.?\s?d|d\.?\s?d\.?\s?s|j\.?\s?d|m\.?\s?b\.?\s?a|c\.?\s?p\.?\s?a|esq)\b\.?/g, ' ')
    .replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !/^(jr|sr|ii|iii|iv|dr|mr|ms|mrs|sir)$/.test(t));
  if (!toks.length) return false;
  const last = toks[toks.length - 1], firstTok = toks[0];
  const re = new RegExp(esc(firstTok) + "[^\\n|;]{0,40}?" + esc(last));
  return toks.length === 1 ? text.includes(last) : re.test(text);
}
function wordsPresent(text, s, share = 0.6) {
  const words = normText(s).replace(/[^a-z0-9& ]/g, ' ').split(' ').filter((w) => w.length >= 4);
  if (!words.length) return true;
  return words.filter((w) => text.includes(w)).length / words.length >= share;
}
const clip = (s, n) => { const v = String(s ?? '').replace(/\s+/g, ' ').trim(); return v ? (v.length > n ? v.slice(0, n - 1) + '…' : v) : null; };
const yearOk = (text, y) => Number.isInteger(y) && y >= 1900 && y <= 2100 && new RegExp('(?<!\\d)' + y + '(?!\\d)').test(text);

const uniq = (list) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
// The board role from the fixed list (boardRole), or an older reply's free
// list (roles). A fixed-list role must have its word in the document.
const ROLE_WORDS = { 'Chair of the Board': /chair/, 'Executive Chair': /executive chair/, 'Co-Chair': /co-? ?chair/, 'Vice Chair': /vice[- ]?chair/, 'Lead Independent Director': /lead (independent )?director|presiding director|lead independent/ };
function boardRolesOf(d, text) {
  const out = [];
  if (BOARD_ROLES.includes(d?.boardRole) && ROLE_WORDS[d.boardRole].test(text)) out.push(d.boardRole);
  for (const r of uniq(d?.roles)) { const v = clip(r, 50); if (v && wordsPresent(text, v, 0.5) && !out.includes(v)) out.push(v); }
  return out.slice(0, 4);
}

// Returns the cleaned facts plus a count of what was kept and dropped.
export function checkProxyFacts(raw, docText) {
  const text = normText(docText);
  const dropped = [];
  const drop = (what) => { dropped.push(what); return null; };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(/,/g, ''))) ? Number(v.replace(/,/g, '')) : null));
  const out = { classes: [], board: [], executives: [], owners: [], controlledCompany: null, controlNote: null, recordDate: null, asOfDate: null };
  out.recordDate = clip(raw?.recordDate, 40);
  out.asOfDate = clip(raw?.asOfDate, 40);
  for (const c of Array.isArray(raw?.classes) ? raw.classes.slice(0, 6) : []) {
    if (!c?.name) continue;
    const votes = num(c.votesPerShare), outs = num(c.outstanding);
    out.classes.push({
      name: clip(c.name, 60),
      votesPerShare: votes == null ? null : (hasSmallNumber(text, votes) ? votes : drop('class votes ' + c.name)),
      outstanding: outs == null ? null : (hasInteger(text, outs) ? Math.round(outs) : drop('class outstanding ' + c.name)),
      listed: typeof c.listed === 'boolean' ? c.listed : null,
    });
  }
  out.controlledCompany = raw?.controlledCompany === true ? (/controlled company/.test(text) ? true : drop('controlled company')) : (raw?.controlledCompany === false ? false : null);
  if (raw?.controlNote) {
    const note = clip(raw.controlNote, 260);
    const nums = (note.match(/\d+(?:\.\d+)?%/g) || []).map((x) => Number(x.replace('%', '')));
    out.controlNote = nums.every((p) => hasPercent(text, p)) && wordsPresent(text, note, 0.5) ? note : drop('control note');
  }
  const seen = new Set();
  for (const d of Array.isArray(raw?.board) ? raw.board.slice(0, 30) : []) {
    if (!d?.name || seen.has(normText(d.name))) continue;
    if (!hasName(text, d.name)) { drop('director ' + d.name); continue; }
    seen.add(normText(d.name));
    const age = num(d.age), since = num(d.directorSince);
    out.board.push({
      name: clip(d.name, 80),
      age: age == null ? null : (age >= 25 && age <= 105 && hasSmallNumber(text, age) ? age : drop('age ' + d.name)),
      since: since == null ? null : (yearOk(text, since) ? since : drop('director since ' + d.name)),
      independent: typeof d.independent === 'boolean' ? d.independent : null,
      roles: boardRolesOf(d, text),
      committees: uniq(d.committees).map((r) => clip(r, 60)).filter((r) => r && wordsPresent(text, r, 0.5)).slice(0, 6),
      chairOf: uniq(d.chairOf).map((r) => clip(r, 60)).filter((r) => r && wordsPresent(text, r, 0.5)).slice(0, 4),
      occupation: d.occupation ? (wordsPresent(text, d.occupation, 0.6) ? clip(d.occupation, 160) : drop('occupation ' + d.name)) : null,
      otherBoards: (Array.isArray(d.otherBoards) ? d.otherBoards : []).filter((b) => b?.company).map((b) => ({ company: clip(b.company, 70), current: b.current !== false }))
        .filter((b) => wordsPresent(text, b.company, 0.5) || drop('other board ' + b.company)).slice(0, 8),
    });
  }
  const seenEx = new Set();
  for (const e of Array.isArray(raw?.executives) ? raw.executives.slice(0, 25) : []) {
    if (!e?.name || seenEx.has(normText(e.name))) continue;
    if (!hasName(text, e.name)) { drop('executive ' + e.name); continue; }
    seenEx.add(normText(e.name));
    const age = num(e.age), since = num(e.since), joined = num(e.joined);
    out.executives.push({
      name: clip(e.name, 80),
      title: e.title ? (wordsPresent(text, e.title, 0.5) ? clip(e.title, 110) : drop('title ' + e.name)) : null,
      age: age == null ? null : (age >= 21 && age <= 105 && hasSmallNumber(text, age) ? age : drop('age ' + e.name)),
      since: since == null ? null : (yearOk(text, since) ? since : drop('role since ' + e.name)),
      joined: joined == null ? null : (yearOk(text, joined) ? joined : drop('joined ' + e.name)),
    });
  }
  // Now and then the model gives every percent as a fraction (0.015 for the
  // printed 1.5%): when every one of them appears in the document only times
  // 100, they are read as percents.
  const pctList = (Array.isArray(raw?.owners) ? raw.owners : []).flatMap((o) => (Array.isArray(o?.holdings) ? o.holdings : []).map((h) => num(h?.percent)).concat([num(o?.votingPercent)])).filter((v) => v != null && v > 0);
  const asPct = (v) => Math.round(v * 100 * 1e6) / 1e6;
  const fractions = pctList.length >= 2 && pctList.every((v) => v <= 1 && !hasPercent(text, v) && hasPercent(text, asPct(v)));
  const pctOf = (v) => (v != null && fractions ? asPct(v) : v);
  for (const o of Array.isArray(raw?.owners) ? raw.owners.slice(0, 60) : []) {
    if (!o?.name) continue;
    const isGroup = o.kind === 'group' || /as a group/i.test(o.name);
    if (!isGroup && !hasName(text, o.name) && !wordsPresent(text, o.name, 0.6)) { drop('owner ' + o.name); continue; }
    const holdings = [];
    for (const h of Array.isArray(o.holdings) ? o.holdings.slice(0, 4) : []) {
      const sh = num(h?.shares), pc = pctOf(num(h?.percent));
      const shares = sh == null ? null : (hasInteger(text, sh) ? Math.round(sh) : drop('shares ' + o.name));
      const percent = pc == null ? null : (hasPercent(text, pc) ? pc : drop('percent ' + o.name));
      if (shares != null || percent != null) holdings.push({ className: clip(h.className, 60), shares, percent });
    }
    const vp = pctOf(num(o.votingPercent));
    const votingPercent = vp == null ? null : (hasPercent(text, vp) ? vp : drop('voting ' + o.name));
    if (!holdings.length && votingPercent == null) continue;
    out.owners.push({ name: clip(o.name, 120), kind: isGroup ? 'group' : (['director', 'officer', 'holder', 'other'].includes(o.kind) ? o.kind : 'other'), holdings, votingPercent });
  }
  return { facts: out, kept: out.board.length + out.executives.length + out.owners.length + out.classes.length, dropped };
}

// The one model call. Everything it needs is passed in, so the bake's AI
// budget, retry ladder and usage ledger apply exactly as for every other call.
export async function extractProxyFacts({ message, deps, model }) {
  const { GoogleGenAI, apiKey, acquireAiSlot, recordAiUsage, aiModelForAttempt, classifyAiError, maxAttempts = 4, timeoutMs = 120_000, symbol, onReply = null } = deps;
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
  // A model that refuses the list caps (400 invalid argument) gets the same
  // schema without them, once; the rest of the run keeps that choice.
  let schema = PROXY_SCHEMA;
  // One call, with retries for passing API errors.
  const call = async (temperature, maxOutputTokens) => {
    let response, lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const m = aiModelForAttempt ? aiModelForAttempt(model, attempt) : model;
      try {
        if (acquireAiSlot) await acquireAiSlot();
        response = await ai.models.generateContent({
          model: m,
          config: { systemInstruction: PROXY_SYSTEM_PROMPT, temperature, maxOutputTokens, responseMimeType: 'application/json', responseSchema: schema, thinkingConfig: { thinkingBudget: 0 } },
          contents: message,
        });
        if (recordAiUsage) recordAiUsage({ model: m, callType: 'corporate-structure', symbol, usage: response?.usageMetadata });
        break;
      } catch (err) {
        lastErr = err;
        if (schema === PROXY_SCHEMA && /INVALID_ARGUMENT|\b400\b/.test(String(err?.message || err))) { schema = uncapped(PROXY_SCHEMA); attempt--; continue; }
        const wait = classifyAiError ? classifyAiError(err, attempt, m) : null;
        if (wait == null || attempt === maxAttempts - 1) throw err;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    if (!response) throw lastErr || new Error('no response from Gemini');
    return response;
  };
  const replyText = (response) => (typeof response.text === 'string' ? response.text : (response?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
  const parse = (response) => {
    const text = replyText(response);
    // The manual live audit keeps each raw reply (to see why one failed).
    if (onReply) onReply(symbol, text, response?.candidates?.[0]?.finishReason || null);
    if (!text) throw new Error('empty Gemini response');
    if (response?.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new Error('Gemini response cut off at the output limit');
    const s = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    return JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
  };
  // At temperature 0 the model now and then repeats itself until the output
  // limit (broken JSON); one more read at a little temperature fixes it.
  const first = await call(0, 12_000);
  try {
    return { json: parse(first), usage: first?.usageMetadata || null, calls: 1 };
  } catch (err) {
    const second = await call(0.4, 16_000);
    const firstError = String(err?.message || err).slice(0, 160);
    try {
      return { json: parse(second), usage: second?.usageMetadata || null, calls: 2, firstError };
    } catch (err2) {
      // Both cut off: keep what each reply finished before the cut (the larger
      // one), marked partial, rather than nothing.
      const saved = [first, second].map((r) => salvageJson(replyText(r))).filter((j) => j && typeof j === 'object' && !Array.isArray(j))
        .sort((x, y) => JSON.stringify(y).length - JSON.stringify(x).length)[0];
      if (!saved) throw err2;
      return { json: saved, usage: second?.usageMetadata || null, calls: 2, firstError, partial: true };
    }
  }
}

// A JSON reply cut off part way: every value finished before the cut, with
// the open brackets closed. Null when nothing parses.
export function salvageJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  const stack = [];
  const cuts = [];
  let inStr = false, escNext = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (escNext) escNext = false; else if (ch === '\\') escNext = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (!stack.length) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
      cuts.push([i + 1, stack.slice().reverse().join('')]);
    } else if (ch === ',') cuts.push([i, stack.slice().reverse().join('')]);
  }
  for (let k = cuts.length - 1; k >= 0 && k >= cuts.length - 400; k--) {
    try { return JSON.parse(s.slice(start, cuts[k][0]) + cuts[k][1]); } catch { /* try an earlier cut */ }
  }
  return null;
}
