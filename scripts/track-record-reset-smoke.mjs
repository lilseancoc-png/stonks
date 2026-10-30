// Deterministic scope/date matrix. No credentials, broker calls or live data.
import assert from 'node:assert/strict';
import { withPublishedGenerations, store as singleton } from '../lib/datastore.mjs';
import { RESET_KEYS, SITE_RECORD_KEYS, RANGE_DAYS, wipeWindow, parseReset, inWindow,
  readSiteRecord, projectWebullLedger, previewTrackRecord, resetTrackRecord, mergeWindows } from '../lib/track-record-reset.mjs';
import { computePicksAccuracyStats, computeBaselineStats } from '../lib/track-record-stats.mjs';
import { isBakeOwnedKey, isSeedableKey } from '../lib/data-ownership.mjs';
import { isPremiumKey, roleClaimForKey } from '../lib/premium-keys.mjs';
import { signSession, SESSION_COOKIE } from '../lib/session.mjs';
import handler from '../api/auth/[action].js';

const now = new Date('2026-10-29T20:00:00.000Z'), day = 86400000;
const ages = [.5, 1, 1 + 1/day, 7, 7 + 1/day, 30, 30 + 1/day, 90, 90 + 1/day, 400, -1, null];
const trades = ages.map((age, i) => ({ symbol: 'TEST' + i, side: 'call', entryDate: age === null ? null : new Date(+now - age * day).toISOString(),
  exitDate: now.toISOString(), outcome: i % 2 ? 'loss' : 'win', optionPnlPct: i % 2 ? -10 : 20,
  tradeId: 'trade-' + i, contract: { structure: 'long', strike: 100, expiry: 1797552000, mid: 5 } }));
const baselineRows = trades.map(t => ({ ...t, symbol: 'SPY', pairKey: t.symbol + ':' + t.side + ':' + t.entryDate }));
const accuracy = { builtAtIso: now.toISOString(), open: [trades[0]], closed: trades.slice(1, 10), archive: trades.slice(10),
  baseline: { open: [baselineRows[0]], closed: baselineRows.slice(1) }, gateStats: [{ gate: 'research', n: 123 }] };
accuracy.stats = computePicksAccuracyStats(accuracy.open, accuracy.closed, accuracy.builtAtIso);
accuracy.baselineStats = computeBaselineStats(accuracy.baseline, accuracy.closed);
accuracy.allTimeStats = computePicksAccuracyStats([], accuracy.closed.concat(accuracy.archive), accuracy.builtAtIso);
const ledger = { version: 2, accountId: 'synthetic-paper', goLiveIso: '2026-01-01T00:00:00Z', lastRunIso: now.toISOString(),
  trades: Object.fromEntries(trades.map((t, i) => [t.tradeId, { ...t, engineEntryIso: t.entryDate, engineEntryPrice: 5,
    state: i === 0 ? 'open' : 'closed', openQty: i === 0 ? 1 : 0, filledQty: 1, closedQty: i === 0 ? 0 : 1,
    entryAttempts: [{ status: i === 0 ? 'SUBMITTED' : 'FILLED', clientOrderId: 'keep-' + i }], exitAttempts: [] }])),
  reconciliation: { status: 'attention', alerts: ['Preserve broker diagnostics'] },
  runs: trades.map(t => ({ at: t.entryDate, placed: 1 })) };
const untouched = ['picks-fills.json', 'picks-open.json', 'picks.json', 'grades-daily.json', 'grade-research.json',
  'sector-rotation-log.json', 'leaps-paper.json', 'leveraged-etfs-log.json', 'picks-watchlist.json', 'regime-history.json'];

function fixture() {
  const raw = new Map(), writes = [], locks = [];
  let busy = false, fail = false;
  const backend = {
    get: async key => raw.get(key) ?? null,
    put: async (key, value) => { if (fail) throw new Error('Synthetic store failure'); writes.push(key); raw.set(key, Buffer.from(value)); },
    del: async key => { throw new Error('Wipes must never delete a store object: ' + key); },
    list: async () => [...raw].map(([key, value]) => ({ key, size: value.length })),
    withLease: async (name, fn) => { locks.push(name); return busy ? { busy: true } : { busy: false, result: await fn(() => {}) }; },
  };
  const client = withPublishedGenerations(backend);
  const seed = (key, value) => raw.set(key, Buffer.from(JSON.stringify(value)));
  seed('picks-accuracy.json', accuracy); seed('webull-paper-ledger.json', ledger);
  for (const key of ['picks-changes.json', 'grades-history.json']) seed(key, { latest: { keep: 1 }, changes: trades.map(t => ({ date: t.entryDate, symbol: t.symbol })) });
  seed('picks-roster.json', { builtAtIso: now.toISOString(), roster: [{ symbol: 'CURRENT' }], exited: [], count: 1 });
  for (const key of untouched) seed(key, { sentinel: key, rows: key === 'picks-fills.json' ? [{ trade_id: 'upload', account: 'My CSV' }] : [] });
  return { raw, writes, locks, client, busy: value => { busy = value; }, fail: value => { fail = value; } };
}
const read = async (client, key) => JSON.parse((await client.get(key)).toString());
let cases = 0;
for (const scope of ['onsite', 'webull']) for (const range of Object.keys(RANGE_DAYS)) {
  const f = fixture(), snapshot = new Map(f.raw);
  const preview = await previewTrackRecord({ store: f.client, scope, range, now });
  assert.equal(f.writes.length, 0, 'preview cannot write');
  const selected = t => t.entryDate === null ? range === 'ALL' : Date.parse(t.entryDate) <= +now &&
    (range === 'ALL' || Date.parse(t.entryDate) >= +now - RANGE_DAYS[range] * day);
  assert.equal(preview.tradeCount, trades.filter(selected).length);
  await resetTrackRecord({ store: f.client, preview });
  assert.deepEqual(f.writes, [RESET_KEYS[scope]], 'only the selected reporting marker can be written');
  assert.deepEqual(f.locks, ['track-record-' + scope]);
  for (const [key, value] of snapshot) assert.deepEqual(f.raw.get(key), value, key + ' must be byte-for-byte unchanged');
  const report = await readSiteRecord(f.client, 'picks-accuracy.json');
  const paper = projectWebullLedger(await read(f.client, 'webull-paper-ledger.json'), parseReset(await f.client.get(RESET_KEYS.webull)));
  const siteRows = report.open.concat(report.closed, report.archive);
  if (scope === 'onsite') {
    assert.deepEqual(siteRows.map(t => t.tradeId), trades.filter(t => !selected(t)).map(t => t.tradeId));
    assert.deepEqual(paper, ledger, 'on-site wipe cannot alter the Webull report');
    assert.deepEqual(report.stats, computePicksAccuracyStats(report.open, report.closed, report.builtAtIso));
    assert.deepEqual(report.baselineStats, computeBaselineStats(report.baseline, report.closed));
    assert.equal(report.gateStats[0].n, 123, 'research remains research');
    for (const key of ['picks-changes.json', 'grades-history.json']) {
      const log = await readSiteRecord(f.client, key);
      assert.deepEqual(log.latest, { keep: 1 });
      assert.equal(log.changes.length, trades.filter(t => !selected(t)).length);
    }
    assert.deepEqual((await readSiteRecord(f.client, 'picks-roster.json')).roster, []);
  } else {
    assert.deepEqual(report, accuracy, 'Webull wipe cannot alter the on-site report');
    assert.deepEqual(Object.keys(paper.trades), trades.filter(t => !selected(t)).map(t => t.tradeId));
    assert.equal(paper.runs.length, trades.filter(t => !selected(t)).length);
    assert.deepEqual(paper.reconciliation, ledger.reconciliation, 'broker safety diagnostics survive');
  }
  // Retry the exact signed preview without widening its end time.
  const first = f.raw.get(RESET_KEYS[scope]); await resetTrackRecord({ store: f.client, preview });
  assert.deepEqual(f.raw.get(RESET_KEYS[scope]), first); assert.equal(f.writes.length, 1);
  // Old and fresh engine publications never erase request-owned exclusions.
  await f.client.publishGeneration({ updates: new Map([['picks-accuracy.json', Buffer.from(JSON.stringify(accuracy))]]) });
  assert.equal((await readSiteRecord(f.client, 'picks-accuracy.json')).closed.length, report.closed.length);
  const fresh = { ...trades[0], symbol: 'FRESH', tradeId: 'fresh', entryDate: new Date(+now + 1000).toISOString() };
  await f.client.publishGeneration({ updates: new Map([['picks-accuracy.json', Buffer.from(JSON.stringify({ ...accuracy, open: [...accuracy.open, fresh] }))]]) });
  assert((await readSiteRecord(f.client, 'picks-accuracy.json')).open.some(t => t.tradeId === 'fresh'), 'wipes cannot swallow later enrollments');
  cases++;
}
assert.throws(() => wipeWindow('EVERYTHING', now), /Unknown/);
assert.throws(() => parseReset(Buffer.from('{}')), /Invalid/);
assert.equal(inWindow(null, wipeWindow('1D', now)), false);
assert.equal(inWindow(null, wipeWindow('ALL', now)), true);
assert.deepEqual(mergeWindows([wipeWindow('1D', now), wipeWindow('1W', now)]), [wipeWindow('1W', now)]);
const sparseStats = computePicksAccuracyStats([], [
  { outcome: 'win', underlyingPnlPct: 10, mfePct: 20, maePct: -5, sector: '__proto__' },
  { outcome: 'loss', underlyingPnlPct: null, mfePct: null, maePct: null, sector: 'constructor' },
  { outcome: 'flat', underlyingPnlPct: 0 },
]);
assert.equal(sparseStats.expectancyPct, 10, 'missing observations cannot become zero returns');
assert.equal(sparseStats.avgMfePct, 20); assert.equal(sparseStats.avgMaePct, -5);
assert.equal(sparseStats.bySector.__proto__.n, 1); assert.equal(sparseStats.bySector.constructor.n, 1);
const missingStats = computePicksAccuracyStats([], [{ outcome: 'loss' }]);
assert.equal(missingStats.expectancyPct, null); assert.equal(missingStats.avgMfePct, null);
assert.equal(computePicksAccuracyStats([], [{ outcome: 'win', underlyingPnlPct: 0 }]).expectancyPct, 0);
const paired = computeBaselineStats({ open: [], closed: [
  { pairKey: 'A:call:date', optionPnlPct: 5, realFillPnlPct: 'bad' },
  { pairKey: 'B:call:date', optionPnlPct: 4, realFillPnlPct: 1 },
] }, [
  { symbol: 'A', side: 'call', entryDate: 'date', outcome: 'win', optionPnlPct: 10, realFillPnlPct: 3 },
  { symbol: 'B', side: 'call', entryDate: 'date', outcome: 'win', optionPnlPct: 'bad', realFillPnlPct: 2 },
]);
assert.equal(paired.paired.n, 1); assert.equal(paired.paired.edgePct, 5); assert.equal(paired.paired.realN, 0);
assert.equal(mergeWindows([wipeWindow('1D', now), wipeWindow('1D', new Date(+now - 10 * day))]).length, 2, 'disjoint wipes preserve the gap');
for (const key of Object.values(RESET_KEYS)) {
  assert.equal(isBakeOwnedKey(key), false); assert.equal(isSeedableKey(key), false);
  assert.equal(isPremiumKey(key), true); assert.deepEqual(roleClaimForKey(key), ['tr', 'tp']);
}

const f = fixture(), originalMethods = Object.fromEntries(['get', 'put', 'withLease'].map(k => [k, singleton[k]]));
const oldSecret = process.env.SESSION_SECRET, oldGate = process.env.PRIVATE_DATA_ENABLED;
process.env.SESSION_SECRET = 'synthetic-track-record-secret'; process.env.PRIVATE_DATA_ENABLED = '1';
Object.assign(singleton, { get: f.client.get, put: f.client.put, withLease: f.client.withLease });
try {
  const owner = await signSession({ tr: true, tp: true }), partial = await signSession({ tr: true, tp: false });
  async function request({ token = owner, method = 'POST', origin = 'https://example.test', action = 'track-record-reset',
    query = {}, body = { operation: 'preview', scope: 'onsite', range: 'ALL' } } = {}) {
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method, query: { action, ...query }, headers: { host: 'example.test', origin, cookie: token ? `${SESSION_COOKIE}=${token}` : '' }, body }, response);
    assert.equal(response.headers['Cache-Control'], 'private, no-store'); return response;
  }
  for (const token of [null, partial]) assert.equal((await request({ token })).code, 401);
  for (const token of [null, partial]) assert.equal((await request({ token, method: 'GET', action: 'track-record-data', query: { key: 'picks-accuracy.json' } })).code, 401);
  assert.equal((await request({ method: 'GET' })).code, 405);
  for (const origin of ['', 'https://attacker.test']) assert.equal((await request({ origin })).code, 403);
  for (const body of [{}, { scope: 'both', range: 'ALL', operation: 'wipe' }, { scope: 'onsite', range: '1Y', operation: 'preview' }]) assert.equal((await request({ body })).code, 400);
  const preview = (await request()).body;
  assert.equal((await request({ token: preview.previewToken, method: 'GET', action: 'track-record-data', query: { key: 'picks-accuracy.json' } })).code, 401, 'a preview token cannot substitute for an Owner session');
  const wipe = { operation: 'wipe', scope: 'onsite', range: 'ALL', previewToken: preview.previewToken, confirmation: 'WIPE ONSITE ALL RECORD' };
  assert.equal((await request({ body: { ...wipe, range: '1D' } })).code, 400);
  assert.equal((await request({ body: { ...wipe, scope: 'webull' } })).code, 400);
  assert.equal((await request({ body: { ...wipe, previewToken: owner } })).code, 400);
  assert.equal((await request({ body: { ...wipe, previewToken: 'forged' } })).code, 400);
  const expired = await signSession(preview, { ttlSec: -1 });
  assert.equal((await request({ body: { ...wipe, previewToken: expired } })).code, 400);
  assert.equal(f.writes.length, 0, 'all rejected and canceled confirmations leave storage untouched');
  f.busy(true); assert.equal((await request({ body: wipe })).code, 409); f.busy(false);
  f.fail(true); assert.equal((await request({ body: wipe })).code, 502); f.fail(false);
  assert.equal(f.writes.length, 0);
  const competing = (await request()).body;
  assert.equal((await request({ body: wipe })).code, 200);
  assert.equal((await request({ body: wipe })).code, 200, 'exact retry is idempotent');
  assert.equal((await request({ body: { ...wipe, previewToken: competing.previewToken } })).code, 409);
  const report = await request({ method: 'GET', action: 'track-record-data', query: { key: 'picks-accuracy.json' } });
  assert.equal(report.code, 200); assert(report.body.closed.length < accuracy.closed.length);
  assert.deepEqual(await read(f.client, 'picks-accuracy.json'), accuracy, 'raw engine state survives the HTTP wipe');
  for (const key of ['../picks.json', 'grades-daily.json', 'webull-paper-ledger.json']) assert.equal((await request({ method: 'GET', action: 'track-record-data', query: { key } })).code, 400);
  const webull = await request({ method: 'GET', action: 'webull-mirror' });
  assert.equal(webull.code, 200); assert.deepEqual(webull.body.engineRecord.open, accuracy.open, 'on-site exclusions cannot remove Webull comparison metadata');
  const paperPreview = (await request({ body: { operation: 'preview', scope: 'webull', range: 'ALL' } })).body;
  assert.equal((await request({ body: { operation: 'wipe', scope: 'webull', range: 'ALL', previewToken: paperPreview.previewToken, confirmation: 'WIPE WEBULL ALL RECORD' } })).code, 200);
  const paperAfter = await request({ method: 'GET', action: 'webull-mirror' });
  // Future-dated synthetic rows are outside every bounded confirmation.
  assert.equal(paperAfter.body.trades.length, 1);
  assert.equal(paperAfter.body.engineRecord.closed.length, 0, 'no wiped comparison rows may leak back through the report');
  const fills = await request({ method: 'GET', action: 'picks-fills' });
  assert(fills.body.rows.some(r => r.trade_id === 'upload'), 'uploaded fills survive both wipe buttons');
  assert.deepEqual(await read(f.client, 'webull-paper-ledger.json'), ledger, 'even active orders and exposure stay byte-for-byte intact');
  process.env.PRIVATE_DATA_ENABLED = '0'; assert.equal((await request()).code, 404);
} finally {
  Object.assign(singleton, originalMethods);
  if (oldSecret == null) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret;
  if (oldGate == null) delete process.env.PRIVATE_DATA_ENABLED; else process.env.PRIVATE_DATA_ENABLED = oldGate;
}
console.log('Track Record log wipe passed: ' + cases + ' scope/period cases, exact boundaries, undated/future preservation, correct stats, independent trackers, unchanged live state, stale builds, auth/origin/token checks, failure, concurrency and idempotent retries.');
