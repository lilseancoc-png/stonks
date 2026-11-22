// Intuition journal (Owner only): validation, server time stamps, edits that
// keep the earlier text, author-only edit / delete, results, pictures, the
// kill switch, the Owner Settings switch and the read-only MCP tool. Driven
// through the real api/auth handler with an in-memory store.
// Run: node scripts/journal-smoke.mjs
import assert from 'node:assert/strict';
process.env.PRIVATE_DATA_ENABLED = '1';
process.env.SESSION_SECRET = 'journal-smoke-secret-0123456789';
delete process.env.JOURNAL_ENABLED;

const { store } = await import('../lib/datastore.mjs');
const J = await import('../lib/intuition-journal.mjs');
const { default: authHandler } = await import('../api/auth/[action].js');
const { SESSION_COOKIE, signSession } = await import('../lib/session.mjs');
const { TOOLS, toolsFor, validateArgs } = await import('../lib/mcp/tools.mjs');
const { journalReadOnlyStore, readOnlyStore } = await import('../lib/mcp/read-only-store.mjs');
const settings = await import('../lib/owner-settings.mjs');
const { isPremiumKey } = await import('../lib/premium-keys.mjs');

const mem = new Map();
store.rawGet = async (k) => (mem.has(k) ? Buffer.from(mem.get(k)) : null);
store.rawPut = async (k, v) => { mem.set(k, Buffer.isBuffer(v) ? Buffer.from(v) : Buffer.from(String(v))); };
store.rawDel = async (k) => { mem.delete(k); };
store.get = async () => null; // Owner Settings (none saved)
Object.defineProperty(store, 'backend', { value: 'memory', configurable: true });

function res() {
  return { headers: {}, statusCode: 200, body: null,
    setHeader(n, v) { this.headers[String(n).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return v; }, end(v) { this.body = v; return v; } };
}
const host = 'mingstreet.test';
const sameOrigin = { host, origin: 'https://' + host, 'x-forwarded-proto': 'https' };
const minime = { cookie: `${SESSION_COOKIE}=${await signSession({ sub: '111', name: 'MiniMe', tr: true, tp: true })}` };
const lilsean = { cookie: `${SESSION_COOKIE}=${await signSession({ sub: '222', name: 'LilSean', tr: true, tp: true })}` };
const partial = { cookie: `${SESSION_COOKIE}=${await signSession({ sub: '333', tr: true, tp: false })}` };
async function call(action, { method = 'GET', body, headers = {}, query = {} } = {}) {
  const r = res();
  await authHandler({ query: { action, ...query }, method, body, headers: { ...sameOrigin, ...headers } }, r);
  return r;
}
const post = (body, who = minime, extra = {}) => call('journal', { method: 'POST', body, headers: { ...who, ...extra } });

// --- pure checks -------------------------------------------------------------------
assert.ok(isPremiumKey(J.JOURNAL_KEY) || J.JOURNAL_KEY.startsWith('_stonks/'), 'the record lives outside published data');
assert.ok(J.JOURNAL_KEY.startsWith('_stonks/journal/') && J.SHOT_PREFIX.startsWith('_stonks/journal/'));
assert.equal(J.validateEntry({ text: '   ' }).error, 'Write something first.');
assert.ok(J.validateEntry({ text: 'x'.repeat(8001) }).error);
assert.ok(J.validateEntry({ text: 'hi', call: { subject: 'NVDA' } }).error, 'a call needs a direction');
assert.ok(J.validateEntry({ text: 'hi', call: { subject: 'not a ticker!', direction: 'up' } }).error);
assert.ok(J.validateEntry({ text: 'hi', call: { subject: 'NVDA', direction: 'up', by: '2026-13-40' } }).error);
assert.ok(J.validateEntry({ text: 'hi', call: { subject: 'NVDA', direction: 'up', confidence: 9 } }).error);
assert.ok(J.validateEntry({ text: 'hi', tags: Array.from({ length: 9 }, (_, i) => 't' + i) }).error);
assert.ok(J.validateEntry({ text: 'hi', evidence: [{ kind: 'shot', shot: { id: 'nope' } }] }).error, 'a picture needs a real upload id');
assert.ok(J.validateEntry({ text: 'hi', evidence: Array.from({ length: 13 }, () => ({ kind: 'data', text: 'v' })) }).error);
const okv = J.validateEntry({ text: ' Market peaks after the‮ IPOs \r\n\r\n\r\n\r\n\r\nline ', tags: '#AI, ipo, ai', call: { subject: '$spy', direction: 'down', target: '1,000'.replace(',', ''), by: '2027-06-30', confidence: '4' },
  evidence: [{ kind: 'data', text: 'NVDA · Grade: +7.5', label: 'Top picks', page: 'picks', pageLabel: 'Top picks', url: '/?tab=picks', asOf: 'site data built Nov 22, 2026', capturedAt: '2026-11-22T06:00:00Z', extra: 'dropped' },
    { kind: 'data', text: 'x', url: 'https://evil.test/x' }, { kind: 'data', text: 'y', url: '//evil.test' }] });
assert.equal(okv.fields.text, 'Market peaks after the IPOs \n\n\nline');
assert.deepEqual(okv.fields.tags, ['ai', 'ipo']);
assert.deepEqual(okv.fields.call, { subject: 'SPY', direction: 'down', target: 1000, by: '2027-06-30', confidence: 4 });
assert.equal(okv.fields.evidence[0].extra, undefined, 'unknown evidence fields are dropped');
assert.equal(okv.fields.evidence[1].url, '', 'only same-site links are kept');
assert.equal(okv.fields.evidence[2].url, '');
assert.equal(J.imageTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
assert.equal(J.decodeShot('PHN2Zz48L3N2Zz4=').error, 'Only JPEG, PNG or WebP pictures can be added.', 'SVG and other types are refused');
assert.ok(J.decodeShot('a'.repeat(2_100_000)).error.includes('too big'));

// --- access ------------------------------------------------------------------------
let r = await call('journal');
assert.equal(r.statusCode, 401, 'anonymous visitors cannot read');
r = await call('journal', { headers: partial });
assert.equal(r.statusCode, 401, 'a partial role cannot read');
r = await call('journal', { headers: minime });
assert.equal(r.statusCode, 200); assert.deepEqual(r.body.entries, []); assert.equal(r.body.me.name, 'MiniMe');
assert.equal(r.headers['cache-control'], 'private, no-store');
r = await post({ op: 'add', entry: { text: 'hello' } }, minime, { origin: 'https://evil.test' });
assert.equal(r.statusCode, 403, 'cross-site writes are refused');

// --- pictures ------------------------------------------------------------------------
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]);
r = await call('journal-shot', { method: 'POST', body: { data: 'data:image/jpeg;base64,' + jpeg.toString('base64') }, headers: minime });
assert.equal(r.statusCode, 200); const shotId = r.body.shot.id;
assert.match(shotId, J.SHOT_ID_RE); assert.ok(mem.has(J.SHOT_PREFIX + shotId));
r = await call('journal-shot', { query: { id: shotId }, headers: minime });
assert.equal(r.statusCode, 200); assert.equal(r.headers['content-type'], 'image/jpeg'); assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.ok(Buffer.isBuffer(r.body));
r = await call('journal-shot', { query: { id: shotId } });
assert.equal(r.statusCode, 401, 'pictures are Owner-only');
r = await call('journal-shot', { query: { id: '../x' }, headers: minime });
assert.equal(r.statusCode, 400);
r = await call('journal-shot', { method: 'POST', body: { data: Buffer.from('<svg/>').toString('base64') }, headers: minime });
assert.equal(r.statusCode, 400);

// --- add / edit / outcome / delete ---------------------------------------------------
const t0 = Date.now();
r = await post({ op: 'add', entry: { text: 'Calling it now: the market peaks after the OpenAI and Anthropic IPOs.', tags: ['ipo'], tz: 'America/Los_Angeles',
  call: { subject: 'MARKET', direction: 'down', by: '2027-12-31', confidence: 3 },
  ref: { symbol: 'SPY', price: 671.25, at: new Date().toISOString() }, market: { spy: 671.25, vix: 17.1, tenY: 4.1, bogus: 5 },
  evidence: [{ kind: 'data', text: 'VIX 17.1', page: 'risk', pageLabel: 'Risk analysis', url: '/?tab=risk', asOf: 'as of 1:05 PM', capturedAt: new Date().toISOString() },
    { kind: 'shot', label: 'Top picks card', page: 'picks', pageLabel: 'Top picks', url: '/?tab=picks', capturedAt: new Date().toISOString(), shot: { id: shotId, w: 800, h: 400, bytes: jpeg.length } }] } });
assert.equal(r.statusCode, 200, JSON.stringify(r.body));
const e1 = r.body.entry;
assert.ok(Date.parse(e1.createdAt) >= t0 - 5 && Date.parse(e1.createdAt) <= Date.now() + 5, 'the server stamps the time');
assert.match(e1.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'full date and time, year included');
assert.equal(e1.author.name, 'MiniMe'); assert.equal(e1.author.id, '111'); assert.equal(e1.tz, 'America/Los_Angeles');
assert.deepEqual(e1.ref, { symbol: 'SPY', price: 671.25, at: e1.ref.at }, 'SPY price stands in for a MARKET call');
assert.equal(e1.market.bogus, undefined); assert.equal(e1.market.vix, 17.1);
r = await post({ op: 'add', entry: { text: 'NVDA keeps going', call: { subject: 'NVDA', direction: 'up', target: 250 }, ref: { symbol: 'AMD', price: 100 } } });
const e2 = r.body.entry;
assert.equal(e2.ref, null, 'a price for another stock is not kept');
r = await post({ op: 'add', entry: { text: 'LilSean: rates fall, small caps rip', call: { subject: 'IWM', direction: 'up' } } }, lilsean);
const e3 = r.body.entry;
assert.equal(e3.author.name, 'LilSean');

r = await call('journal', { headers: lilsean });
assert.equal(r.body.total, 3); assert.equal(r.body.entries[0].id, e3.id, 'newest first');
r = await call('journal', { headers: lilsean, query: { limit: '1', before: e3.id } });
assert.equal(r.body.entries.length, 1); assert.equal(r.body.entries[0].id, e2.id); assert.equal(r.body.more, true);

// Only the writer edits or deletes; both can mark a result.
r = await post({ op: 'edit', id: e1.id, entry: { text: 'changed' } }, lilsean);
assert.equal(r.statusCode, 403);
r = await post({ op: 'delete', id: e1.id }, lilsean);
assert.equal(r.statusCode, 403);
r = await post({ op: 'edit', id: e1.id, entry: { text: e1.text, tags: e1.tags, call: e1.call, evidence: e1.evidence } });
assert.equal(r.statusCode, 200); assert.equal(r.body.entry.history.length, 0, 'an unchanged save is not an edit');
await new Promise((ok) => setTimeout(ok, 5));
r = await post({ op: 'edit', id: e1.id, entry: { text: 'Calling it now: the market peaks after the IPOs, then a bear market.', tags: ['ipo', 'bear'], call: { subject: 'MARKET', direction: 'down', by: '2027-12-31', confidence: 4 }, evidence: [e1.evidence[0]] } });
assert.equal(r.statusCode, 200);
const e1b = r.body.entry;
assert.equal(e1b.createdAt, e1.createdAt, 'the first time never changes');
assert.notEqual(e1b.updatedAt, e1.updatedAt);
assert.equal(e1b.history.length, 1); assert.equal(e1b.history[0].text, e1.text, 'the earlier text is kept');
assert.deepEqual(e1b.ref, e1.ref, 'the stamped price never changes');
assert.ok(!mem.has(J.SHOT_PREFIX + shotId), 'a picture removed in an edit is deleted');
r = await post({ op: 'outcome', id: e1.id, outcome: { result: 'right', note: 'peaked in March' } }, lilsean);
assert.equal(r.statusCode, 200); assert.equal(r.body.entry.outcome.result, 'right'); assert.equal(r.body.entry.outcome.by.name, 'LilSean');
r = await post({ op: 'outcome', id: e1.id, outcome: { result: 'maybe' } });
assert.equal(r.statusCode, 400);
r = await post({ op: 'outcome', id: e2.id, outcome: null });
assert.equal(r.statusCode, 200); assert.equal(r.body.entry.outcome, null);

// A changed subject drops the old stamped price.
r = await post({ op: 'edit', id: e1.id, entry: { text: 'now on QQQ', tags: ['ipo', 'bear'], call: { subject: 'QQQ', direction: 'down' }, evidence: [e1.evidence[0]] } });
assert.equal(r.body.entry.ref, null);

// Discard pictures from a dropped draft, never one an entry uses.
r = await call('journal-shot', { method: 'POST', body: { data: jpeg.toString('base64') }, headers: minime });
const orphan = r.body.shot.id;
r = await call('journal-shot', { method: 'POST', body: { data: jpeg.toString('base64') }, headers: minime });
const kept = r.body.shot.id;
await post({ op: 'edit', id: e2.id, entry: { text: e2.text, call: e2.call, evidence: [{ kind: 'shot', label: 'p', shot: { id: kept } }] } });
r = await post({ op: 'discard', shots: [orphan, kept, 'bad'] });
assert.equal(r.statusCode, 200);
assert.ok(!mem.has(J.SHOT_PREFIX + orphan) && mem.has(J.SHOT_PREFIX + kept), 'only unused pictures are dropped');
r = await post({ op: 'delete', id: e2.id });
assert.equal(r.statusCode, 200); assert.equal(r.body.total, 2);
assert.ok(!mem.has(J.SHOT_PREFIX + kept), 'deleting an entry deletes its pictures');
r = await post({ op: 'delete', id: e2.id });
assert.equal(r.statusCode, 404);

// --- kill switch and Owner Settings -------------------------------------------------
process.env.JOURNAL_ENABLED = '0';
r = await call('journal', { headers: minime });
assert.equal(r.statusCode, 404); assert.equal(r.body.off, true);
delete process.env.JOURNAL_ENABLED;
const def = settings.ownerSettingDef('JOURNAL_ENABLED');
assert.equal(def.scope, 'site'); assert.equal(def.default, true);
assert.deepEqual(settings.runtimeEnvOverrides({ values: { JOURNAL_ENABLED: false } }), { JOURNAL_ENABLED: '0' }, 'the switch can only turn it off');
assert.deepEqual(settings.runtimeEnvOverrides({ values: { JOURNAL_ENABLED: true } }), {});

// --- MCP ------------------------------------------------------------------------------
const tool = TOOLS.find((t) => t.name === 'get_journal');
assert.ok(tool && tool.audience === 'owner');
assert.ok(!toolsFor({ owner: false }).some((t) => t.name === 'get_journal'), 'public MCP clients never see it');
assert.ok(toolsFor({ owner: true }).some((t) => t.name === 'get_journal'));
assert.ok(!toolsFor({ owner: true }, { JOURNAL_ENABLED: '0' }).some((t) => t.name === 'get_journal'), 'the switch hides the tool');
const jro = journalReadOnlyStore(store);
await assert.rejects(jro.rawGet('_stonks/contact/v1/messages.json'), /read-only/);
await assert.rejects(jro.rawGet(J.SHOT_PREFIX + 'sabc'), /read-only/, 'pictures are not readable through the MCP');
await assert.rejects(jro.rawPut(J.JOURNAL_KEY, '{}'), /read-only/);
await assert.rejects(readOnlyStore(store).rawGet?.(J.JOURNAL_KEY) ?? Promise.reject(new Error('read-only: no rawGet')), /read-only/, 'the general MCP store has no raw reads');
const fail = (code, msg) => { const e = new Error(msg); e.code = code; throw e; };
const ctx = { principal: { owner: true }, journalStore: jro, env: {}, origin: 'https://mingstreet.app', now: () => Date.now() };
let out = await tool.run(ctx, validateArgs(tool.inputSchema, {}));
assert.equal(out.tool, 'get_journal'); assert.equal(out.access, 'owner'); assert.equal(out.ai_calls, 0);
assert.equal(out.results.total_entries, 2); assert.equal(out.results.entries.length, 2);
assert.deepEqual(out.results.authors, { MiniMe: 1, LilSean: 1 });
const m1 = out.results.entries.find((e) => e.id === e1.id);
assert.equal(m1.author, 'MiniMe'); assert.equal(m1.written_at, e1.createdAt); assert.equal(m1.earlier_versions, 2);
assert.equal(m1.outcome.result, 'right'); assert.equal(m1.open_on_site, 'https://mingstreet.app/?journal=' + e1.id);
assert.equal(m1.evidence[0].link, 'https://mingstreet.app/?tab=risk'); assert.equal(m1.evidence[0].as_of, 'as of 1:05 PM');
out = await tool.run(ctx, validateArgs(tool.inputSchema, { author: 'lil', outcome: 'open' }));
assert.deepEqual(out.results.entries.map((e) => e.id), [e3.id]);
out = await tool.run(ctx, validateArgs(tool.inputSchema, { symbol: 'IWM' }));
assert.deepEqual(out.results.entries.map((e) => e.id), [e3.id]);
out = await tool.run(ctx, validateArgs(tool.inputSchema, { query: 'qqq', tag: 'bear', include_history: true }));
assert.equal(out.results.entries.length, 1); assert.ok(Array.isArray(out.results.entries[0].earlier_versions));
out = await tool.run(ctx, validateArgs(tool.inputSchema, { since: '2099-01-01' }));
assert.equal(out.results.entries.length, 0);
await assert.rejects(tool.run({ ...ctx, principal: { owner: false } }, {}), /Owner sign-in/);
await assert.rejects(tool.run({ ...ctx, env: { JOURNAL_ENABLED: '0' } }, {}), /switched off/);
await assert.rejects(tool.run(ctx, validateArgs(tool.inputSchema, { id: 'j' + 'a'.repeat(8) + '00000000' })), /No journal entry/);
assert.throws(() => validateArgs(tool.inputSchema, { outcome: 'great' }));
void fail;
console.log('journal smoke passed: validation, Owner-only access, server time stamps, edits keep earlier text, author-only edit/delete, results, pictures, kill switch, Owner Settings switch, read-only MCP tool');
