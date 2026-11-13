// The yearly proxy statement (DEF 14A), or Item 6-7 of a foreign company's
// 20-F, read once per filing: board, independence, committees, other jobs and
// boards, executive officers, the beneficial ownership table and the votes
// each share class carries. One Gemini Flash-Lite call per new filing (about
// once a year per company). Everything the model returns is checked against
// the filing's own text: a name, number or year that does not appear in the
// document is dropped, so the page never shows a figure the filing lacks.

export const PROXY_PROMPT_VERSION = 3;
export const PROXY_MAX_CHARS = 170_000;

export function htmlToText(html) {
  return String(html || '')
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
  { re: /security ownership of (certain )?beneficial owners|beneficial ownership of (our )?(common|capital|ordinary)|stock ownership (information|of)|principal (stock|share)holders|ownership of (our )?securities/gi, after: 26_000, rank: 0 },
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
    let n = 0;
    for (const m of t.matchAll(s.re)) {
      if (n++ >= 8) break;
      wins.push({ a: Math.max(0, m.index - 1200), b: Math.min(t.length, m.index + s.after), rank: s.rank });
    }
  }
  return mergeWindows(t, wins, maxChars);
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

export const PROXY_SYSTEM_PROMPT = [
  'You read one SEC filing (a proxy statement or the directors and shareholders items of an annual report) and return its facts as JSON.',
  'Use ONLY this document. Never use outside knowledge, never guess, never compute a figure the document does not print. Use null or an empty list when the document does not say.',
  'Copy names exactly as the document prints them. Copy numbers exactly (shares as whole numbers, percents as printed, e.g. 0.5 for "0.5%"). An asterisk or "less than 1%" is null.',
  'board: every current director or director nominee. independent: true only if the document calls that person independent, false if it says they are not (an employee or executive is not independent), null if it does not say.',
  'directorSince: the year the document says they joined the board. occupation: their current main job as the document states it. otherBoards: other PUBLIC company boards the document lists, current ones with current=true and past ones with current=false.',
  'roles: board leadership roles only: "Chair of the Board", "Executive Chair", "Co-Chair", "Vice Chair", "Lead Independent Director". Chairing a committee is NOT a board role: put it in chairOf. Leave roles empty for an ordinary director. committees: the board committees they sit on (full names); chairOf: the committees they chair.',
  'executives: the executive officers the document lists with title, age and the year they took the current role and the year they joined the company when stated.',
  'classes: every class of common or capital stock, including classes with no vote (votesPerShare 0), with the shares outstanding on the record date as printed, and whether that class is listed on an exchange. votesPerShare is null when the votes per share vary.',
  'owners: every row of the beneficial ownership table(s): directors, named officers, the "all directors and executive officers as a group" row (kind group) and every 5% holder (kind holder). For each row give shares and percent of class for each class the table shows, and votingPercent only when the table has a separate column for the percent of total voting power.',
  'controlledCompany: true if the document says the company is a "controlled company" under exchange rules. controlNote: one short sentence on who controls the vote if the document says so (for example a founder holding a majority of the voting power), else null.',
].join('\n');

const S = (type, extra = {}) => ({ type, ...extra });
const NS = (type, extra = {}) => ({ type, nullable: true, ...extra });
export const PROXY_SCHEMA = {
  type: 'object',
  properties: {
    asOfDate: NS('string'),
    recordDate: NS('string'),
    classes: S('array', { items: S('object', { properties: { name: S('string'), votesPerShare: NS('number'), outstanding: NS('number'), listed: NS('boolean') }, required: ['name'] }) }),
    controlledCompany: NS('boolean'),
    controlNote: NS('string'),
    board: S('array', { items: S('object', { properties: {
      name: S('string'), age: NS('number'), directorSince: NS('number'), independent: NS('boolean'),
      roles: S('array', { items: S('string') }), committees: S('array', { items: S('string') }), chairOf: S('array', { items: S('string') }),
      occupation: NS('string'), otherBoards: S('array', { items: S('object', { properties: { company: S('string'), current: NS('boolean') }, required: ['company'] }) }),
    }, required: ['name'] }) }),
    executives: S('array', { items: S('object', { properties: { name: S('string'), title: NS('string'), age: NS('number'), since: NS('number'), joined: NS('number') }, required: ['name'] }) }),
    owners: S('array', { items: S('object', { properties: {
      name: S('string'), kind: S('string', { enum: ['director', 'officer', 'holder', 'group', 'other'] }),
      holdings: S('array', { items: S('object', { properties: { className: NS('string'), shares: NS('number'), percent: NS('number') } }) }),
      votingPercent: NS('number'),
    }, required: ['name', 'kind'] }) }),
  },
  required: ['board', 'owners', 'classes', 'executives'],
};

export function proxyUserMessage({ company, symbol, form, filed, text }) {
  return `Company: ${company} (${symbol}). Document: SEC ${form} filed ${filed}. Extract the JSON described in the instructions from this text.\n\n<<<DOCUMENT\n${text}\nDOCUMENT>>>`;
}

// --- checking the model's answer against the filing ---------------------------
function normText(text) {
  return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
}
function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function intPattern(n) {
  const digits = String(Math.round(Math.abs(n)));
  const groups = [];
  for (let i = digits.length; i > 0; i -= 3) groups.unshift(digits.slice(Math.max(0, i - 3), i));
  return new RegExp('(?<![\\d.,])' + groups.join('[,.\\s ]?') + '(?![\\d]|[.,]\\d)');
}
export function hasInteger(text, n) {
  if (!Number.isFinite(n) || n < 0) return false;
  return intPattern(n).test(text);
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
  const toks = String(name || '').replace(/["“”'‘’][^"“”'‘’]{1,20}["“”'‘’]/g, ' ').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !/^(jr|sr|ii|iii|iv|dr|mr|ms|mrs|sir)$/.test(t));
  if (!toks.length) return false;
  const last = toks[toks.length - 1], firstTok = toks[0];
  const re = new RegExp(esc(firstTok) + "[a-z.'\"“”()\\- ]{0,40}" + esc(last));
  return toks.length === 1 ? text.includes(last) : re.test(text);
}
function wordsPresent(text, s, share = 0.6) {
  const words = normText(s).replace(/[^a-z0-9& ]/g, ' ').split(' ').filter((w) => w.length >= 4);
  if (!words.length) return true;
  return words.filter((w) => text.includes(w)).length / words.length >= share;
}
const clip = (s, n) => { const v = String(s ?? '').replace(/\s+/g, ' ').trim(); return v ? (v.length > n ? v.slice(0, n - 1) + '…' : v) : null; };
const yearOk = (text, y) => Number.isInteger(y) && y >= 1900 && y <= 2100 && new RegExp('(?<!\\d)' + y + '(?!\\d)').test(text);

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
      roles: (Array.isArray(d.roles) ? d.roles : []).map((r) => clip(r, 50)).filter((r) => r && wordsPresent(text, r, 0.5)).slice(0, 4),
      committees: (Array.isArray(d.committees) ? d.committees : []).map((r) => clip(r, 60)).filter((r) => r && wordsPresent(text, r, 0.5)).slice(0, 6),
      chairOf: (Array.isArray(d.chairOf) ? d.chairOf : []).map((r) => clip(r, 60)).filter((r) => r && wordsPresent(text, r, 0.5)).slice(0, 4),
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
  for (const o of Array.isArray(raw?.owners) ? raw.owners.slice(0, 60) : []) {
    if (!o?.name) continue;
    const isGroup = o.kind === 'group' || /as a group/i.test(o.name);
    if (!isGroup && !hasName(text, o.name) && !wordsPresent(text, o.name, 0.6)) { drop('owner ' + o.name); continue; }
    const holdings = [];
    for (const h of Array.isArray(o.holdings) ? o.holdings.slice(0, 4) : []) {
      const sh = num(h?.shares), pc = num(h?.percent);
      const shares = sh == null ? null : (hasInteger(text, sh) ? Math.round(sh) : drop('shares ' + o.name));
      const percent = pc == null ? null : (hasPercent(text, pc) ? pc : drop('percent ' + o.name));
      if (shares != null || percent != null) holdings.push({ className: clip(h.className, 60), shares, percent });
    }
    const vp = num(o.votingPercent);
    const votingPercent = vp == null ? null : (hasPercent(text, vp) ? vp : drop('voting ' + o.name));
    if (!holdings.length && votingPercent == null) continue;
    out.owners.push({ name: clip(o.name, 120), kind: isGroup ? 'group' : (['director', 'officer', 'holder', 'other'].includes(o.kind) ? o.kind : 'other'), holdings, votingPercent });
  }
  return { facts: out, kept: out.board.length + out.executives.length + out.owners.length + out.classes.length, dropped };
}

// The one model call. Everything it needs is passed in, so the bake's AI
// budget, retry ladder and usage ledger apply exactly as for every other call.
export async function extractProxyFacts({ message, deps, model }) {
  const { GoogleGenAI, apiKey, acquireAiSlot, recordAiUsage, aiModelForAttempt, classifyAiError, maxAttempts = 4, timeoutMs = 120_000, symbol } = deps;
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
  let response, lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const m = aiModelForAttempt ? aiModelForAttempt(model, attempt) : model;
    try {
      if (acquireAiSlot) await acquireAiSlot();
      response = await ai.models.generateContent({
        model: m,
        config: { systemInstruction: PROXY_SYSTEM_PROMPT, temperature: 0, maxOutputTokens: 12_000, responseMimeType: 'application/json', responseSchema: PROXY_SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
        contents: message,
      });
      if (recordAiUsage) recordAiUsage({ model: m, callType: 'corporate-structure', symbol, usage: response?.usageMetadata });
      break;
    } catch (err) {
      lastErr = err;
      const wait = classifyAiError ? classifyAiError(err, attempt, m) : null;
      if (wait == null || attempt === maxAttempts - 1) throw err;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (!response) throw lastErr || new Error('no response from Gemini');
  const text = typeof response.text === 'string' ? response.text : (response?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error('empty Gemini response');
  const s = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  return { json: JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s), usage: response?.usageMetadata || null };
}
