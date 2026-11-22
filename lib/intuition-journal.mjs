// Intuition journal (Owner only, 2026-11-22): a forward-looking market
// journal the two owners write in a side panel that stays open while they move
// between pages (scripts/render/journal-client.mjs). Every entry is stamped by
// the server with the full date and time, keeps the text it had before each
// edit, and can carry evidence picked from the site's own pages: a value or
// row with its page and as-of time, or a picture of a card or chart.
//
// Storage: ONE raw private-store record (JOURNAL_KEY) plus one raw object per
// picture (SHOT_PREFIX + id), all under `_stonks/journal/v1/`, outside the
// published data generations. The public /data reader cannot serve them,
// sync-data never pushes or deletes them, and the MCP's general store refuses
// `_stonks/` keys; the MCP reads the entries through journalReadOnlyStore
// (lib/mcp/read-only-store.mjs), which can read JOURNAL_KEY and nothing else.
// Only api/auth/[action].js (`journal`, `journal-shot`) writes, under the
// store lease `intuition-journal`.
//
// No AI call and no outside request on the server. The browser adds the
// market numbers at the time of writing from the site's own /api/macro-live
// and /api/quotes (the same calls every visitor's pages already make).
import { randomBytes } from 'node:crypto';

export const JOURNAL_KEY = '_stonks/journal/v1/entries.json';
export const JOURNAL_LEASE = 'intuition-journal';
export const SHOT_PREFIX = '_stonks/journal/v1/shots/';

export const LIMITS = Object.freeze({
  TEXT_MAX: 8000,
  TAGS_MAX: 8,
  TAG_MAX: 24,
  EVIDENCE_MAX: 12,
  SHOTS_PER_ENTRY: 8,
  EV_TEXT_MAX: 600,
  EV_LABEL_MAX: 140,
  EV_URL_MAX: 300,
  EV_ASOF_MAX: 80,
  NOTE_MAX: 1000,
  HISTORY_MAX: 20,
  MAX_ENTRIES: 3000,
  SHOT_BYTES_MAX: 1_500_000,
  LIST_DEFAULT: 500,
  LIST_MAX: 1000,
});

export const DIRECTIONS = ['up', 'down', 'flat'];
export const OUTCOMES = ['right', 'wrong', 'mixed'];
// Market numbers stamped on an entry when it is written (from /api/macro-live).
export const MARKET_KEYS = ['spy', 'qqq', 'vix', 'tenY', 'dxy', 'crude', 'gold'];

const ID_RE = /^j[0-9a-z]{6,12}[0-9a-f]{8}$/;
export const SHOT_ID_RE = /^s[0-9a-z]{6,12}[0-9a-f]{8}$/;
const PAGE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SUBJECT_RE = /^[A-Z][A-Z0-9.^=-]{0,9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Strip control and direction-override characters (keep newlines and tabs
// in multi-line text), normalise line endings.
export function cleanText(v, { multiline = false } = {}) {
  let s = typeof v === 'string' ? v : '';
  s = s.replace(/\r\n?/g, '\n').normalize('NFC');
  s = s.replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g
    : /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, multiline ? '' : ' ');
  if (multiline) s = s.replace(/\n{4,}/g, '\n\n\n');
  else s = s.replace(/\s+/g, ' ');
  return s.trim();
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const isoOf = (v) => {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const newId = (prefix, now) => prefix + Math.floor(now).toString(36) + randomBytes(4).toString('hex');
export const newShotId = (now = Date.now()) => newId('s', now);

// A same-site link to the page the evidence came from: a path and query only.
function cleanUrl(v) {
  const s = cleanText(v);
  if (!s || s.length > LIMITS.EV_URL_MAX) return '';
  if (!s.startsWith('/') || s.startsWith('//') || /[\\\s<>"']/.test(s)) return '';
  return s;
}

function cleanTags(raw) {
  let list = raw;
  if (typeof list === 'string') list = list.split(/[,#\n]+/);
  if (list == null) return { tags: [] };
  if (!Array.isArray(list)) return { error: 'Tags could not be read.' };
  const tags = [];
  for (const t of list) {
    const tag = cleanText(typeof t === 'string' ? t : '').replace(/^#/, '').toLowerCase();
    if (!tag) continue;
    if (tag.length > LIMITS.TAG_MAX) return { error: `Keep each tag under ${LIMITS.TAG_MAX} characters.` };
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > LIMITS.TAGS_MAX) return { error: `Use at most ${LIMITS.TAGS_MAX} tags.` };
  return { tags };
}

// The optional call: what the entry expects, so it can be checked later.
// subject: a ticker or MARKET; direction: up / down / flat; target price,
// by-date and a 1-5 confidence are optional.
export function cleanCall(raw) {
  if (raw == null || raw === '') return { call: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The call could not be read.' };
  const subject = cleanText(raw.subject).toUpperCase().replace(/^\$/, '');
  const direction = raw.direction == null || raw.direction === '' ? '' : String(raw.direction);
  if (!subject && !direction) return { call: null };
  if (!subject) return { error: 'Say what the call is on: a ticker, or MARKET.' };
  if (subject !== 'MARKET' && !SUBJECT_RE.test(subject)) return { error: `"${subject.slice(0, 12)}" is not a ticker.` };
  if (!DIRECTIONS.includes(direction)) return { error: 'Pick up, down or flat for the call.' };
  const call = { subject, direction, target: null, by: null, confidence: null };
  if (raw.target != null && raw.target !== '') {
    const t = Number(raw.target);
    if (!finite(t) || t <= 0 || t > 1e7) return { error: 'The target must be a price above 0.' };
    call.target = Math.round(t * 10000) / 10000;
  }
  if (raw.by != null && raw.by !== '') {
    const by = String(raw.by);
    if (!DATE_RE.test(by) || !Number.isFinite(Date.parse(by + 'T00:00:00Z'))) return { error: 'The by-date must be a date (YYYY-MM-DD).' };
    if (by < '2000-01-01' || by > '2100-12-31') return { error: 'The by-date is out of range.' };
    call.by = by;
  }
  if (raw.confidence != null && raw.confidence !== '') {
    const c = Number(raw.confidence);
    if (!Number.isInteger(c) || c < 1 || c > 5) return { error: 'Confidence is 1 to 5.' };
    call.confidence = c;
  }
  return { call };
}

function cleanShotMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!SHOT_ID_RE.test(id)) return null;
  const n = (v, max) => (finite(v) && v > 0 && v <= max ? Math.round(v) : null);
  return { id, w: n(raw.w, 20000), h: n(raw.h, 20000), bytes: n(raw.bytes, LIMITS.SHOT_BYTES_MAX) };
}

// One piece of evidence: a value or row picked from a page ('data'), a
// picture of part of a page or an added image ('shot'), or a note-like
// reference to a page ('page'). -> { item } | { error }
export function cleanEvidence(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Evidence could not be read.' };
  const kind = raw.kind;
  if (!['data', 'shot', 'page'].includes(kind)) return { error: 'Unknown evidence kind.' };
  const text = cleanText(raw.text, { multiline: true }).slice(0, LIMITS.EV_TEXT_MAX);
  const label = cleanText(raw.label).slice(0, LIMITS.EV_LABEL_MAX);
  const page = typeof raw.page === 'string' && PAGE_RE.test(raw.page) ? raw.page : '';
  const pageLabel = cleanText(raw.pageLabel).slice(0, 80);
  const url = cleanUrl(raw.url);
  const asOf = cleanText(raw.asOf).slice(0, LIMITS.EV_ASOF_MAX);
  const capturedAt = isoOf(raw.capturedAt);
  const item = { kind, text, label, page, pageLabel, url, asOf, capturedAt };
  if (kind === 'data' && !text) return { error: 'A picked value needs its text.' };
  if (kind === 'shot') {
    const shot = cleanShotMeta(raw.shot);
    if (!shot) return { error: 'A picture is missing its upload.' };
    item.shot = shot;
  }
  if (kind === 'page' && !page && !url) return { error: 'A page reference needs its page.' };
  return { item };
}

function cleanEvidenceList(raw) {
  if (raw == null) return { evidence: [] };
  if (!Array.isArray(raw)) return { error: 'Evidence could not be read.' };
  if (raw.length > LIMITS.EVIDENCE_MAX) return { error: `Attach at most ${LIMITS.EVIDENCE_MAX} pieces of evidence.` };
  const evidence = [];
  for (const r of raw) {
    const out = cleanEvidence(r);
    if (out.error) return out;
    evidence.push(out.item);
  }
  if (evidence.filter((e) => e.kind === 'shot').length > LIMITS.SHOTS_PER_ENTRY) return { error: `Attach at most ${LIMITS.SHOTS_PER_ENTRY} pictures.` };
  return { evidence };
}

// The price of the call's subject when the entry was written (browser quote).
function cleanRef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const symbol = cleanText(raw.symbol).toUpperCase();
  const price = Number(raw.price);
  if (!SUBJECT_RE.test(symbol) || !finite(price) || price <= 0 || price > 1e7) return null;
  return { symbol, price: Math.round(price * 10000) / 10000, at: isoOf(raw.at) };
}

// Market numbers when the entry was written. Unknown keys are dropped.
function cleanMarket(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of MARKET_KEYS) {
    const v = raw[k];
    if (finite(v) && Math.abs(v) < 1e7) out[k] = Math.round(v * 10000) / 10000;
  }
  if (!Object.keys(out).length) return null;
  out.at = isoOf(raw.at);
  return out;
}

function cleanTz(v) {
  const s = typeof v === 'string' ? v : '';
  return /^[A-Za-z_]{1,20}(\/[A-Za-z0-9_+-]{1,30}){0,2}$/.test(s) ? s : null;
}

// Validate the writable fields of an entry. -> { fields } | { error }
export function validateEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Send the entry as JSON.' };
  const text = cleanText(raw.text, { multiline: true });
  if (!text) return { error: 'Write something first.' };
  if (text.length > LIMITS.TEXT_MAX) return { error: `Keep an entry under ${LIMITS.TEXT_MAX.toLocaleString('en-US')} characters.` };
  const tags = cleanTags(raw.tags);
  if (tags.error) return tags;
  const call = cleanCall(raw.call);
  if (call.error) return call;
  const ev = cleanEvidenceList(raw.evidence);
  if (ev.error) return ev;
  return { fields: { text, tags: tags.tags, call: call.call, evidence: ev.evidence } };
}

// --- stored record ---------------------------------------------------------------
export function readJournalDoc(buf) {
  let doc = null;
  try { doc = buf == null ? null : JSON.parse(Buffer.from(buf).toString('utf8')); } catch { doc = null; }
  if (!doc || doc.version !== 1 || !Array.isArray(doc.entries)) doc = { version: 1, entries: [] };
  doc.entries = doc.entries.filter((e) => e && typeof e === 'object' && ID_RE.test(String(e.id || '')));
  return doc;
}

const authorOf = (session) => ({
  id: session && session.sub != null ? String(session.sub).slice(0, 40) : null,
  name: cleanText(session && session.name).slice(0, 60) || 'Owner',
});
const sameAuthor = (entry, session) => !entry.author || entry.author.id == null || entry.author.id === authorOf(session).id;
const shotIds = (entry) => (entry.evidence || []).filter((e) => e.kind === 'shot' && e.shot).map((e) => e.shot.id);
export const shotsInUse = (doc) => new Set(doc.entries.flatMap(shotIds));

// Owner actions on the record. Every op returns { doc, save, entry?, error?,
// status?, dropShots? } where dropShots lists picture objects no entry uses
// any more (deleted after the record is saved).
//   add      { entry: { text, tags?, call?, evidence?, ref?, market?, tz? } }
//   edit     { id, entry: { text, tags?, call?, evidence? } }   own entries only
//   outcome  { id, outcome: { result: right|wrong|mixed|null, note? } }
//   delete   { id }                                              own entries only
//   discard  { shots: [id] }   pictures uploaded for a draft that was dropped
export function applyJournalOp(doc, body, session, now = Date.now()) {
  const op = body && body.op;
  const at = new Date(now).toISOString();
  const me = authorOf(session);
  if (op === 'add') {
    const v = validateEntry(body.entry);
    if (v.error) return { doc, error: v.error, status: 400 };
    if (doc.entries.length >= LIMITS.MAX_ENTRIES) return { doc, error: `The journal is full (${LIMITS.MAX_ENTRIES.toLocaleString('en-US')} entries).`, status: 409 };
    const src = body.entry;
    const entry = { id: newId('j', now), createdAt: at, updatedAt: at, author: me, tz: cleanTz(src.tz),
      ...v.fields, ref: cleanRef(src.ref), market: cleanMarket(src.market), outcome: null, history: [] };
    if (!refFits(entry.ref, entry.call)) entry.ref = null;
    doc.entries.push(entry);
    return { doc, save: true, entry };
  }
  if (op === 'discard') {
    const inUse = shotsInUse(doc);
    const list = Array.isArray(body.shots) ? body.shots.filter((s) => typeof s === 'string' && SHOT_ID_RE.test(s) && !inUse.has(s)) : [];
    return { doc, save: false, dropShots: [...new Set(list)].slice(0, 50) };
  }
  if (!['edit', 'outcome', 'delete'].includes(op)) return { doc, error: 'unknown action', status: 400 };
  const id = body && typeof body.id === 'string' ? body.id : '';
  if (!ID_RE.test(id)) return { doc, error: 'bad entry id', status: 400 };
  const idx = doc.entries.findIndex((e) => e.id === id);
  if (idx < 0) return { doc, error: 'That entry is gone (deleted elsewhere?). Reload the journal.', status: 404 };
  const entry = doc.entries[idx];
  if (op === 'delete') {
    if (!sameAuthor(entry, session)) return { doc, error: 'Only the person who wrote an entry can delete it.', status: 403 };
    doc.entries.splice(idx, 1);
    const inUse = shotsInUse(doc);
    return { doc, save: true, dropShots: shotIds(entry).filter((s) => !inUse.has(s)) };
  }
  if (op === 'outcome') {
    const raw = body.outcome;
    if (raw == null || raw.result == null || raw.result === '') {
      entry.outcome = null;
    } else {
      if (!OUTCOMES.includes(raw.result)) return { doc, error: 'The result is right, wrong or mixed.', status: 400 };
      const note = cleanText(raw.note, { multiline: true });
      if (note.length > LIMITS.NOTE_MAX) return { doc, error: `Keep the note under ${LIMITS.NOTE_MAX} characters.`, status: 400 };
      entry.outcome = { result: raw.result, note, at, by: me };
    }
    return { doc, save: true, entry };
  }
  // edit: the text, tags, call and evidence change; the time it was first
  // written, the author, the market numbers and the reference price never do.
  // The version before each edit is kept in `history` (newest last).
  if (!sameAuthor(entry, session)) return { doc, error: 'Only the person who wrote an entry can edit it.', status: 403 };
  const v = validateEntry(body.entry);
  if (v.error) return { doc, error: v.error, status: 400 };
  const f = v.fields;
  const same = f.text === entry.text && JSON.stringify(f.tags) === JSON.stringify(entry.tags || [])
    && JSON.stringify(f.call) === JSON.stringify(entry.call || null) && JSON.stringify(f.evidence) === JSON.stringify(entry.evidence || []);
  if (same) return { doc, save: false, entry };
  const before = { at: entry.updatedAt || entry.createdAt, text: entry.text, tags: entry.tags || [], call: entry.call || null, evidence: (entry.evidence || []).length };
  entry.history = [...(entry.history || []), before].slice(-LIMITS.HISTORY_MAX);
  const oldShots = shotIds(entry);
  Object.assign(entry, f, { updatedAt: at, editedBy: me });
  // A changed subject no longer matches the price stamped for the old one.
  if (!refFits(entry.ref, entry.call)) entry.ref = null;
  const inUse = shotsInUse(doc);
  return { doc, save: true, entry, dropShots: oldShots.filter((s) => !inUse.has(s)) };
}

// The stamped price belongs to the call's subject (SPY stands in for MARKET).
const refFits = (ref, call) => !!(ref && call && (call.subject === ref.symbol || (call.subject === 'MARKET' && ref.symbol === 'SPY')));

const byNewest = (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || (a.id < b.id ? 1 : -1);

// What the page reads: newest first, `limit` at a time, older ones with
// `before` (an entry id: the entries written before it).
export function journalView(doc, { limit = LIMITS.LIST_DEFAULT, before = '' } = {}) {
  const all = doc.entries.slice().sort(byNewest);
  let start = 0;
  if (before && ID_RE.test(before)) {
    const i = all.findIndex((e) => e.id === before);
    start = i < 0 ? all.length : i + 1;
  }
  const n = Math.max(1, Math.min(LIMITS.LIST_MAX, Number.isInteger(limit) ? limit : LIMITS.LIST_DEFAULT));
  const entries = all.slice(start, start + n);
  return { version: 1, total: all.length, entries, more: start + n < all.length, limits: { text: LIMITS.TEXT_MAX, evidence: LIMITS.EVIDENCE_MAX, shots: LIMITS.SHOTS_PER_ENTRY, shotBytes: LIMITS.SHOT_BYTES_MAX } };
}

// --- pictures ----------------------------------------------------------------------
// -> 'image/jpeg' | 'image/png' | 'image/webp' | null, from the bytes themselves.
export function imageTypeOf(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// A picture upload: base64 (optionally a data: URL). -> { buf, type } | { error }
export function decodeShot(raw) {
  if (typeof raw !== 'string' || !raw) return { error: 'No picture was sent.' };
  const b64 = raw.replace(/^data:image\/(?:jpeg|png|webp);base64,/, '');
  if (b64.length > Math.ceil(LIMITS.SHOT_BYTES_MAX * 4 / 3) + 8) return { error: 'That picture is too big. Pick a smaller part of the page.' };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { error: 'The picture could not be read.' };
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > LIMITS.SHOT_BYTES_MAX) return { error: 'That picture is too big. Pick a smaller part of the page.' };
  const type = imageTypeOf(buf);
  if (!type) return { error: 'Only JPEG, PNG or WebP pictures can be added.' };
  return { buf, type };
}

// --- reading for the MCP -------------------------------------------------------------
// Filter and shape entries for an AI client. Pure; the MCP tool passes args.
export function queryJournal(doc, args = {}, { origin = '' } = {}) {
  const q = cleanText(args.query).toLowerCase();
  const author = cleanText(args.author).toLowerCase();
  const symbol = cleanText(args.symbol).toUpperCase().replace(/^\$/, '');
  const since = typeof args.since === 'string' && DATE_RE.test(args.since) ? args.since : '';
  const until = typeof args.until === 'string' && DATE_RE.test(args.until) ? args.until : '';
  const outcome = typeof args.outcome === 'string' ? args.outcome : '';
  const direction = typeof args.direction === 'string' ? args.direction : '';
  const tag = cleanText(args.tag).replace(/^#/, '').toLowerCase();
  const all = doc.entries.slice().sort(byNewest);
  const hay = (e) => [e.text, ...(e.tags || []), e.outcome && e.outcome.note, ...(e.evidence || []).map((x) => x.text + ' ' + x.label + ' ' + x.pageLabel)].join(' ').toLowerCase();
  const matched = all.filter((e) => {
    if (args.id && e.id !== args.id) return false;
    if (q && !q.split(/\s+/).every((w) => hay(e).includes(w))) return false;
    if (author && !String(e.author && e.author.name || '').toLowerCase().includes(author)) return false;
    if (symbol && !(e.call && e.call.subject === symbol) && !new RegExp('(^|[^A-Z])\\$?' + symbol.replace(/[.^=-]/g, '\\$&') + '([^A-Z]|$)').test(e.text.toUpperCase())) return false;
    if (since && e.createdAt.slice(0, 10) < since) return false;
    if (until && e.createdAt.slice(0, 10) > until) return false;
    if (direction && !(e.call && e.call.direction === direction)) return false;
    if (tag && !(e.tags || []).includes(tag)) return false;
    if (outcome === 'open' && (e.outcome || !e.call)) return false;
    if (OUTCOMES.includes(outcome) && !(e.outcome && e.outcome.result === outcome)) return false;
    return true;
  });
  const limit = Math.max(1, Math.min(100, Number.isInteger(args.limit) ? args.limit : 25));
  const link = (id) => (origin ? origin + '/?journal=' + id : '/?journal=' + id);
  const shape = (e) => ({
    id: e.id,
    written_at: e.createdAt,
    written_tz: e.tz || undefined,
    author: e.author ? e.author.name : 'Owner',
    edited_at: e.updatedAt !== e.createdAt ? e.updatedAt : undefined,
    text: e.text,
    tags: e.tags && e.tags.length ? e.tags : undefined,
    call: e.call || undefined,
    price_when_written: e.ref || undefined,
    market_when_written: e.market || undefined,
    evidence: (e.evidence || []).length ? e.evidence.map((x) => ({
      kind: x.kind === 'shot' ? 'picture' : x.kind,
      label: x.label || undefined,
      text: x.text || undefined,
      page: x.pageLabel || x.page || undefined,
      link: x.url ? (origin ? origin + x.url : x.url) : undefined,
      as_of: x.asOf || undefined,
      captured_at: x.capturedAt || undefined,
      picture: x.kind === 'shot' ? 'Open the entry on the site to see the picture.' : undefined,
    })) : undefined,
    outcome: e.outcome ? { result: e.outcome.result, note: e.outcome.note || undefined, marked_at: e.outcome.at, marked_by: e.outcome.by ? e.outcome.by.name : undefined } : undefined,
    earlier_versions: args.include_history && (e.history || []).length ? e.history : (e.history || []).length ? (e.history || []).length : undefined,
    open_on_site: link(e.id),
  });
  const counts = (list) => {
    const out = { right: 0, wrong: 0, mixed: 0, open: 0 };
    for (const e of list) if (e.call) out[e.outcome ? e.outcome.result : 'open'] += 1;
    return out;
  };
  const authors = {};
  for (const e of all) { const n = e.author ? e.author.name : 'Owner'; authors[n] = (authors[n] || 0) + 1; }
  return {
    total_entries: all.length,
    matched: matched.length,
    authors,
    calls_scored: counts(all),
    entries: matched.slice(0, limit).map(shape),
    more: matched.length > limit,
  };
}
