// "Send us a message" box: validation, spam guards, storage and Owner-only
// inbox, driven through the real api/auth handler with an in-memory store.
import assert from 'node:assert/strict';
process.env.PRIVATE_DATA_ENABLED = '1';
process.env.SESSION_SECRET = 'contact-smoke-secret-0123456789';

const { store } = await import('../lib/datastore.mjs');
const contact = await import('../lib/contact-messages.mjs');
const { default: authHandler } = await import('../api/auth/[action].js');
const { SESSION_COOKIE, signSession } = await import('../lib/session.mjs');
const { renderAppJs } = await import('./render/app-js.mjs');
const { renderHtml } = await import('./render/html.mjs');
const { SITE_SECTIONS } = await import('./render/site-map.mjs');
const { OWNER_PAGE_IDS } = await import('../lib/owner-access-policy.mjs');
const { isPremiumKey } = await import('../lib/premium-keys.mjs');

// In-memory raw store (the handler only uses rawGet/rawPut and, on R2, withLease).
const mem = new Map();
store.rawGet = async (k) => (mem.has(k) ? Buffer.from(mem.get(k)) : null);
store.rawPut = async (k, v) => { mem.set(k, String(v)); };
Object.defineProperty(store, 'backend', { value: 'memory', configurable: true });

function res() {
  return { headers: {}, statusCode: 200, body: null,
    setHeader(n, v) { this.headers[String(n).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return v; }, end(v) { this.body = v; return v; } };
}
const host = 'mingstreet.test';
const sameOrigin = { host, origin: 'https://' + host, 'x-forwarded-proto': 'https' };
async function call(action, { method = 'GET', body, headers = {}, ip = '203.0.113.5' } = {}) {
  const r = res();
  await authHandler({ query: { action }, method, body, headers: { ...sameOrigin, 'x-vercel-forwarded-for': ip, ...headers } }, r);
  return r;
}
let now = Date.now();
const oldTicket = () => contact.issueTicket(now - 10_000);
const send = (fields, opts) => call('contact', { method: 'POST', body: { ticket: oldTicket(), title: 'Hello', message: 'A useful message', ...fields }, ...opts });

// --- unit checks ---------------------------------------------------------------
assert.equal(contact.checkTicket(contact.issueTicket(now), now + 500), 'too-fast');
assert.equal(contact.checkTicket(contact.issueTicket(now), now + 4000), null);
assert.equal(contact.checkTicket(contact.issueTicket(now), now + 7 * 3600e3), 'expired');
const t = contact.issueTicket(now);
assert.equal(contact.checkTicket(t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'), now + 4000), 'ticket');
assert.equal(contact.checkTicket('junk'), 'ticket');
assert.deepEqual(contact.parseContact('Me@Example.com'), { kind: 'email', value: 'Me@Example.com' });
assert.deepEqual(contact.parseContact('mailto:a@b.co'), { kind: 'email', value: 'a@b.co' });
assert.equal(contact.parseContact('x.com/someone').kind, 'link');
assert.equal(contact.parseContact('x.com/someone').value, 'https://x.com/someone');
assert.equal(contact.parseContact('@handle_1').kind, 'handle');
for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'https://user:pw@evil.com', 'ftp://x.com', '<script>', 'a b c d']) assert.equal(contact.parseContact(bad), null, bad);
assert.ok(contact.validateSubmission({ title: '', message: 'hello there' }).error);
assert.ok(contact.validateSubmission({ title: 'x'.repeat(121), message: 'hello there' }).error);
assert.ok(contact.validateSubmission({ title: 'Hi', message: 'x'.repeat(4001) }).error);
assert.ok(contact.validateSubmission({ title: 'Hi', message: 'see https://a.com https://b.com https://c.com https://d.com' }).error);
assert.ok(contact.validateSubmission({ title: 'Hi', message: 'hello there', contacts: ['a@b.co', 'b@b.co', 'c@b.co', 'd@b.co', 'e@b.co', 'f@b.co'] }).error);
assert.ok(contact.validateSubmission({ title: 'Hi', message: 'hello there', contacts: ['javascript:alert(1)'] }).error);
const okv = contact.validateSubmission({ title: ' Hi‮ ', message: 'line one\r\nline two\u0000', contacts: 'a@b.co\nhttps://x.com/me\na@b.co' });
assert.deepEqual(okv.message, { title: 'Hi', body: 'line one\nline two', name: '', contacts: [{ kind: 'email', value: 'a@b.co' }, { kind: 'link', value: 'https://x.com/me' }] });

// --- storage stays private -------------------------------------------------------
assert.ok(contact.CONTACT_KEY.startsWith('_stonks/'), 'raw internal prefix, never published or synced');
assert.ok(isPremiumKey(contact.CONTACT_KEY) || contact.CONTACT_KEY.startsWith('_stonks/'));

// --- public submit ---------------------------------------------------------------
let r = await call('contact');
assert.equal(r.statusCode, 200); assert.match(r.body.ticket, /^[0-9a-z]+\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{32}$/);
assert.equal(r.headers['cache-control'], 'private, no-store');
r = await call('contact', { method: 'POST', body: { ticket: r.body.ticket, title: 'Hi', message: 'Too quick to be human' } });
assert.equal(r.statusCode, 429, 'a form sent within seconds of loading is refused');
r = await send({}, { headers: { origin: 'https://evil.test' } });
assert.equal(r.statusCode, 403, 'cross-site POST refused');
r = await call('contact', { method: 'POST', body: { title: 'Hi', message: 'no ticket here' } });
assert.equal(r.statusCode, 400); assert.equal(r.body.reload, true);
r = await send({ website: 'http://spam.example' });
assert.equal(r.statusCode, 200); assert.equal(mem.size, 0, 'honeypot hit is accepted but not stored');
r = await send({ title: 'Feature idea', message: 'Please add <b>dark</b> charts', name: 'Sam', contacts: ['sam@example.com', 'https://x.com/sam'] });
assert.equal(r.statusCode, 200); assert.deepEqual(r.body, { ok: true });
const stored = JSON.parse(mem.get(contact.CONTACT_KEY));
assert.equal(stored.messages.length, 1);
assert.ok(!JSON.stringify(stored).includes('203.0.113.5'), 'IP address never stored');
r = await send({ title: 'Feature idea', message: 'Please add <b>dark</b> charts' });
assert.equal(r.statusCode, 200); assert.equal(JSON.parse(mem.get(contact.CONTACT_KEY)).messages.length, 1, 'duplicate dropped');
r = await send({ message: 'second message' });
r = await send({ message: 'third message' });
assert.equal(JSON.parse(mem.get(contact.CONTACT_KEY)).messages.length, 3);
r = await send({ message: 'fourth message, too many' });
assert.equal(r.statusCode, 429, 'per-sender 10-minute limit');
r = await send({ message: 'another sender' }, { ip: '198.51.100.9' });
assert.equal(r.statusCode, 200);
r = await call('contact', { method: 'DELETE' });
assert.equal(r.statusCode, 405);

// Site-wide daily cap and full inbox (pure).
let doc = { version: 1, messages: [], recent: Array.from({ length: contact.LIMITS.SITE_DAY }, (_, i) => ({ s: 's' + i, at: now, d: 'd' + i })) };
assert.equal(contact.addMessage(doc, { title: 'a', body: 'hello', name: '', contacts: [] }, { sender: 'new', now }).status, 'site-cap');
const tied = { version: 1, messages: [], recent: [] };
for (const title of ['first', 'second', 'third']) contact.addMessage(tied, { title, body: 'same millisecond', contacts: [] }, { sender: 'tie', now });
assert.deepEqual(contact.inboxView(tied).messages.map(m => m.title), ['third', 'second', 'first'], 'timestamp ties preserve newest append first');
assert.deepEqual(tied.messages.map(m => m.title), ['first', 'second', 'third'], 'reading the inbox does not reorder storage');
doc = { version: 1, recent: [], messages: Array.from({ length: contact.LIMITS.MAX_STORED }, (_, i) => ({ id: 'm' + i, at: new Date(now - i * 1000).toISOString(), title: 't', body: 'b', contacts: [], read: false })) };
assert.equal(contact.addMessage(doc, { title: 'a', body: 'hello', name: '', contacts: [] }, { sender: 'x', now }).status, 'full');
doc.messages[5].read = true;
const roomy = contact.addMessage(doc, { title: 'a', body: 'hello', name: '', contacts: [] }, { sender: 'x', now });
assert.equal(roomy.status, 'saved'); assert.equal(doc.messages.length, contact.LIMITS.MAX_STORED); assert.ok(!doc.messages.some((m) => m.id === 'm5'), 'oldest read message made room');

// --- Owner-only inbox --------------------------------------------------------------
r = await call('contact-inbox');
assert.equal(r.statusCode, 401, 'anonymous visitors cannot read');
const partial = await signSession({ sub: 'u1', tr: true, tp: false });
r = await call('contact-inbox', { headers: { cookie: `${SESSION_COOKIE}=${partial}` } });
assert.equal(r.statusCode, 401, 'partial role cannot read');
const owner = await signSession({ sub: 'owner', tr: true, tp: true });
const oc = { cookie: `${SESSION_COOKIE}=${owner}` };
r = await call('contact-inbox', { headers: oc });
assert.equal(r.statusCode, 200); assert.equal(r.body.messages.length, 4); assert.equal(r.body.unread, 4);
assert.equal(r.body.messages[0].title, 'Hello', 'newest first');
assert.ok(!('recent' in r.body) && !JSON.stringify(r.body).includes('"s":'), 'no sender hashes leave the server');
const sam = r.body.messages.find((m) => m.name === 'Sam');
assert.deepEqual(sam.contacts, [{ kind: 'email', value: 'sam@example.com' }, { kind: 'link', value: 'https://x.com/sam' }]);
r = await call('contact-inbox', { method: 'POST', body: { op: 'read', id: sam.id }, headers: { ...oc, origin: 'https://evil.test' } });
assert.equal(r.statusCode, 403, 'cross-site Owner action refused');
r = await call('contact-inbox', { method: 'POST', body: { op: 'read', id: sam.id }, headers: oc });
assert.equal(r.statusCode, 200); assert.equal(r.body.unread, 3);
r = await call('contact-inbox', { method: 'POST', body: { op: 'delete', id: sam.id }, headers: oc });
assert.equal(r.body.messages.length, 3);
r = await call('contact-inbox', { method: 'POST', body: { op: 'delete', id: 'mzzzz00000000' }, headers: oc });
assert.equal(r.statusCode, 400);
r = await call('contact-inbox', { method: 'POST', body: { op: 'read-all' }, headers: oc });
assert.equal(r.body.unread, 0);
r = await call('contact-inbox', { method: 'POST', body: { op: 'read', id: '../x' }, headers: { cookie: `${SESSION_COOKIE}=${partial}` } });
assert.equal(r.statusCode, 401);

// Kill switch.
process.env.CONTACT_ENABLED = '0';
r = await call('contact'); assert.equal(r.statusCode, 404);
delete process.env.CONTACT_ENABLED;

// --- page wiring -------------------------------------------------------------------
const learn = SITE_SECTIONS.find((s) => s.id === 'learn');
assert.ok(learn.items.some((i) => i.id === 'contact'), 'the box sits in Learn & help');
assert.ok(!OWNER_PAGE_IDS.includes('contact'), 'the form page is public');
const app = renderAppJs();
assert.ok(app.includes("if (name === 'contact') contactBox.load();"));
const { readFile } = await import('node:fs/promises');
const manifest = JSON.parse((await readFile(new URL('../index.html', import.meta.url), 'utf8')).match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1]);
const html = renderHtml({ ...manifest, volumeFlags: manifest.volumeFlagsMeta, oi: manifest.oiMeta });
assert.match(html, /id="page-pane-contact"/);
assert.match(html, /id="contact-inbox"[^>]*data-owner-only/);
assert.match(html, /name="website" tabindex="-1"/);
console.log('contact smoke passed: validation, ticket timing, honeypot, rate/duplicate/site caps, private storage, Owner-only inbox, page wiring');
