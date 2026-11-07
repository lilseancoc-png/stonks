// "Send us a message" box (Learn & help → Contact us).
//
// Anyone can send a message; only the Owner can read them. Messages live in
// ONE raw private-store record under `_stonks/contact/v1/`, outside the
// published data generations: the public /data reader cannot serve it,
// sync-data never pushes or deletes it, and the MCP key filter refuses
// `_stonks/` keys. Only api/auth/[action].js (`contact`, `contact-inbox`)
// reads or writes it, under the store lease `contact-messages`.
//
// Spam and abuse protection, all deterministic and free (no CAPTCHA vendor,
// no AI, no new env):
//   - same-origin POST only (a cross-site page cannot submit the form)
//   - a hidden honeypot field; a filled one is accepted and silently dropped
//   - a signed form ticket (HMAC with SESSION_SECRET): the form must have been
//     open at least MIN_FILL_MS and the ticket is good for TICKET_TTL_MS
//   - per-sender limits (salted hash of the IP, never the IP itself) and a
//     site-wide daily cap
//   - duplicate messages from one sender within a day are dropped
//   - length limits, at most MAX_BODY_LINKS links in the message text, and
//     contact links restricted to emails and http(s) addresses
//   - the inbox keeps at most MAX_STORED messages; when full, the oldest
//     already-read messages make room, and new messages are refused only when
//     every stored message is still unread.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CONTACT_KEY = '_stonks/contact/v1/messages.json';
export const CONTACT_LEASE = 'contact-messages';

export const LIMITS = Object.freeze({
  TITLE_MAX: 120,
  MESSAGE_MIN: 5,
  MESSAGE_MAX: 4000,
  CONTACTS_MAX: 5,
  CONTACT_MAX: 200,
  NAME_MAX: 80,
  MAX_BODY_LINKS: 3,
  MIN_FILL_MS: 3000,
  TICKET_TTL_MS: 6 * 60 * 60 * 1000,
  PER_SENDER_10MIN: 3,
  PER_SENDER_DAY: 8,
  SITE_DAY: 150,
  MAX_STORED: 1000,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;

function secret() {
  const s = process.env.SESSION_SECRET || '';
  return s.length >= 16 ? s : '';
}

// --- form ticket ---------------------------------------------------------------
export function issueTicket(now = Date.now()) {
  const key = secret();
  if (!key) return null;
  const body = Math.floor(now).toString(36) + '.' + randomBytes(9).toString('base64url');
  return body + '.' + createHmac('sha256', key).update('contact-ticket:' + body).digest('base64url').slice(0, 32);
}

// -> null when good, else a reason code.
export function checkTicket(ticket, now = Date.now()) {
  const key = secret();
  if (!key) return 'unconfigured';
  const m = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{32})$/.exec(String(ticket || ''));
  if (!m) return 'ticket';
  const expected = createHmac('sha256', key).update('contact-ticket:' + m[1] + '.' + m[2]).digest('base64url').slice(0, 32);
  const a = Buffer.from(m[3]), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return 'ticket';
  const issued = parseInt(m[1], 36);
  if (!Number.isFinite(issued)) return 'ticket';
  const age = now - issued;
  if (age < LIMITS.MIN_FILL_MS) return 'too-fast';
  if (age > LIMITS.TICKET_TTL_MS) return 'expired';
  return null;
}

// Salted, truncated hash so the inbox never stores a sender's IP address.
export function senderHash(ip) {
  return createHash('sha256').update('contact-sender:' + (secret() || 'x') + ':' + String(ip || 'unknown')).digest('hex').slice(0, 20);
}

export function clientIp(req) {
  const h = req?.headers || {};
  const first = (v) => String(v || '').split(',')[0].trim();
  return first(h['x-vercel-forwarded-for']) || first(h['x-real-ip']) || first(h['x-forwarded-for']) || 'unknown';
}

// --- validation ----------------------------------------------------------------
// Strip control characters (keep newlines and tabs), normalise line endings.
function cleanText(v, { multiline = false } = {}) {
  let s = typeof v === 'string' ? v : '';
  s = s.replace(/\r\n?/g, '\n').normalize('NFC');
  s = s.replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g
    : /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '');
  if (multiline) s = s.replace(/\n{4,}/g, '\n\n\n');
  return s.trim();
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;

// One contact entry -> { kind: 'email' | 'link' | 'handle', value } or null.
export function parseContact(raw) {
  const s = cleanText(raw);
  if (!s || s.length > LIMITS.CONTACT_MAX) return null;
  const bare = s.replace(/^mailto:/i, '');
  if (EMAIL_RE.test(bare)) return { kind: 'email', value: bare };
  let candidate = s;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate) && /^(www\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(\/\S*)?$/.test(candidate)) candidate = 'https://' + candidate;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const u = new URL(candidate);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') && !u.username && !u.password && !/\s/.test(candidate)) {
        return { kind: 'link', value: u.toString() };
      }
    } catch { /* fall through */ }
    return null;
  }
  // A social handle such as @mingstreet or discord name#1234.
  if (/^@?[A-Za-z0-9_.#-]{2,40}$/.test(s)) return { kind: 'handle', value: s };
  return null;
}

function countLinks(text) {
  return (String(text).match(/(https?:\/\/|www\.)\S+/gi) || []).length;
}

// Validate a submission body. -> { error } or { message: { title, body, name, contacts } }.
export function validateSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send the form as JSON.' };
  const title = cleanText(body.title);
  const text = cleanText(body.message, { multiline: true });
  const name = cleanText(body.name);
  if (!title) return { error: 'Add a title.' };
  if (title.length > LIMITS.TITLE_MAX) return { error: `Keep the title under ${LIMITS.TITLE_MAX} characters.` };
  if (text.length < LIMITS.MESSAGE_MIN) return { error: 'Write a message.' };
  if (text.length > LIMITS.MESSAGE_MAX) return { error: `Keep the message under ${LIMITS.MESSAGE_MAX} characters.` };
  if (name.length > LIMITS.NAME_MAX) return { error: `Keep your name under ${LIMITS.NAME_MAX} characters.` };
  if (countLinks(text) + countLinks(title) > LIMITS.MAX_BODY_LINKS) return { error: `Put at most ${LIMITS.MAX_BODY_LINKS} links in the message. Add your own links in the contact box instead.` };
  let rawContacts = body.contacts;
  if (typeof rawContacts === 'string') rawContacts = rawContacts.split(/[\n,]+/);
  if (rawContacts == null) rawContacts = [];
  if (!Array.isArray(rawContacts)) return { error: 'Contact links could not be read.' };
  const entries = rawContacts.map((c) => (typeof c === 'string' ? c.trim() : '')).filter(Boolean);
  if (entries.length > LIMITS.CONTACTS_MAX) return { error: `Add at most ${LIMITS.CONTACTS_MAX} emails or links.` };
  const contacts = [];
  for (const entry of entries) {
    const parsed = parseContact(entry);
    if (!parsed) return { error: `"${entry.slice(0, 60)}" is not an email, web link or @handle.` };
    if (!contacts.some((c) => c.value.toLowerCase() === parsed.value.toLowerCase())) contacts.push(parsed);
  }
  return { message: { title, body: text, name, contacts } };
}

// --- stored record ---------------------------------------------------------------
export function readContactDoc(buf) {
  let doc = null;
  try { doc = buf == null ? null : JSON.parse(Buffer.from(buf).toString('utf8')); } catch { doc = null; }
  if (!doc || doc.version !== 1 || !Array.isArray(doc.messages)) doc = { version: 1, messages: [], recent: [] };
  if (!Array.isArray(doc.recent)) doc.recent = [];
  return doc;
}

function digest(message) {
  return createHash('sha256').update(message.title.toLowerCase() + '\n' + message.body.toLowerCase().replace(/\s+/g, ' ')).digest('hex').slice(0, 20);
}

// Add one validated message. -> { doc, status: 'saved' | 'duplicate' | 'rate' | 'site-cap' | 'full', id? }
export function addMessage(doc, message, { sender, now = Date.now() } = {}) {
  const cutoff = now - DAY_MS;
  doc.recent = doc.recent.filter((r) => r && Number(r.at) > cutoff);
  const mine = doc.recent.filter((r) => r.s === sender);
  if (mine.length >= LIMITS.PER_SENDER_DAY || mine.filter((r) => r.at > now - TEN_MIN_MS).length >= LIMITS.PER_SENDER_10MIN) return { doc, status: 'rate' };
  if (doc.recent.length >= LIMITS.SITE_DAY) return { doc, status: 'site-cap' };
  const d = digest(message);
  if (mine.some((r) => r.d === d)) return { doc, status: 'duplicate' };
  if (doc.messages.length >= LIMITS.MAX_STORED) {
    // Make room by dropping the oldest messages already read.
    const readOldest = doc.messages.map((m, i) => ({ m, i })).filter((x) => x.m.read).sort((a, b) => Date.parse(a.m.at) - Date.parse(b.m.at));
    const drop = new Set(readOldest.slice(0, doc.messages.length - LIMITS.MAX_STORED + 1).map((x) => x.i));
    if (doc.messages.length - drop.size >= LIMITS.MAX_STORED) return { doc, status: 'full' };
    doc.messages = doc.messages.filter((_, i) => !drop.has(i));
  }
  const id = 'm' + Math.floor(now).toString(36) + randomBytes(4).toString('hex');
  doc.messages.push({ id, at: new Date(now).toISOString(), title: message.title, body: message.body, name: message.name || '', contacts: message.contacts, read: false });
  doc.recent.push({ s: sender, at: now, d });
  return { doc, status: 'saved', id };
}

// What the Owner sees: newest first, no sender hashes.
export function inboxView(doc) {
  const messages = doc.messages.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map(({ id, at, title, body, name, contacts, read }) => ({ id, at, title, body, name, contacts, read: !!read }));
  return { version: 1, messages, unread: messages.filter((m) => !m.read).length, max: LIMITS.MAX_STORED };
}

// Owner actions. -> { doc, error? }
export function applyInboxOp(doc, body) {
  const op = body && body.op;
  const id = body && typeof body.id === 'string' ? body.id : '';
  if (op === 'read-all') { doc.messages.forEach((m) => { m.read = true; }); return { doc }; }
  if (!['read', 'unread', 'delete'].includes(op)) return { doc, error: 'unknown action' };
  if (!/^m[0-9a-z]{1,12}[0-9a-f]{8}$/.test(id)) return { doc, error: 'bad message id' };
  const idx = doc.messages.findIndex((m) => m.id === id);
  if (idx < 0) return { doc, error: 'message not found' };
  if (op === 'delete') doc.messages.splice(idx, 1);
  else doc.messages[idx].read = op === 'read';
  return { doc };
}
