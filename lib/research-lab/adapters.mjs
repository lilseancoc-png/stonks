import { contracts } from './contracts.mjs';
import { sha } from './canonical.mjs';

export const isSymbol = s => typeof s === 'string' && /^[A-Z][A-Z0-9.]{0,5}$/.test(s);
// Conservative completed-session policy, also safe on early-close sessions.
export const closeKnownAt = date => date + 'T21:15:00.000Z';
export function openAt(date) {
  const summer = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' })
    .format(new Date(date + 'T13:30:00Z')) === '09';
  return date + (summer ? 'T13:30:00.000Z' : 'T14:30:00.000Z');
}
export async function captureSnapshot(store, symbols, now = new Date().toISOString()) {
  if (!Array.isArray(symbols) || !symbols.length || symbols.length > contracts.LIMITS.assets || !symbols.every(isSymbol)) contracts.fail('SCHEMA_INVALID', 'Choose 1..12 valid symbols including a benchmark');
  const assets = {}, missing = [];
  for (const symbol of [...new Set(symbols)].sort()) {
    const buf = await store.get(symbol + '.json');
    if (buf == null) { missing.push(symbol); continue; }
    if (buf.length > 8000000) contracts.fail('RESOURCE_LIMIT', symbol + ' source file exceeds the adapter limit');
    const file = JSON.parse(buf.toString('utf8')), ps = file.priceSeries;
    if (!Array.isArray(ps?.t) || !Array.isArray(ps.c) || ps.t.length !== ps.c.length) { missing.push(symbol); continue; }
    const bars = ps.t.map((date, i) => ({ date, close: ps.c[i], open: ps.o?.[i] ?? null, volume: ps.v?.[i] ?? null,
      first_published_at: null, ingested_at: null, available_at: null, tradable_at: null, revised_at: null, vintage: null }))
      .filter(b => /^\d{4}-\d\d-\d\d$/.test(b.date || '') && closeKnownAt(b.date) <= now && Number.isFinite(b.close) && b.close > 0);
    if (bars.length < 40) { missing.push(symbol); continue; }
    assets[symbol] = { bars, source_key: symbol + '.json', source_sha256: sha(buf), source_built_at: file.builtAtIso || null };
  }
  if (missing.length) contracts.fail('DATA_UNAVAILABLE', 'Missing usable cached history: ' + missing.join(', ') + '. No provider request was made.');
  const snapshot = { schema: 'mingstreet.research-snapshot.v2', captured_at: now, assets,
    source_id: 'mingstreet.cached-yahoo-daily', history_class: 'EXPLORATORY_NON_PIT',
    calendar: 'XNYS', timezone: 'America/New_York', currency: 'USD', adjustment: 'provider_inherited_unverified',
    universe_policy: 'selected_current_symbols_survivorship_unverified', license: { raw_export: false, derived_export: true },
    warnings: ['PIT_INELIGIBLE: historical publication, ingestion and revisions are unavailable.',
      'SURVIVORSHIP: current selected symbols do not include verified historical constituents/delistings.',
      'CORPORATE_ACTIONS: rounded provider-adjusted prices are not verified executable raw prices.',
      'CALENDAR: existing observed sessions only; missing/holiday/early-close coverage is not independently verified.',
      'LICENSE: raw observations excluded from offsite exports; derived aggregates only.'] };
  snapshot.id = 'snap_' + sha(snapshot); validateSnapshot(snapshot); return snapshot;
}
export function validateSnapshot(snapshot) {
  const { fail, LIMITS } = contracts;
  if (!snapshot || snapshot.schema !== 'mingstreet.research-snapshot.v2' || !snapshot.assets || !['EXPLORATORY_NON_PIT', 'OBSERVED_ARCHIVE', 'RECONSTRUCTED_PIT'].includes(snapshot.history_class)) fail('SNAPSHOT_INVALID', 'Invalid frozen snapshot');
  const { id, ...body } = snapshot;
  if (id !== 'snap_' + sha(body)) fail('HASH_MISMATCH', 'Snapshot checksum mismatch');
  const symbols = Object.keys(snapshot.assets);
  if (!symbols.length || symbols.length > LIMITS.assets || !symbols.every(isSymbol)) fail('RESOURCE_LIMIT', 'Snapshot asset limit exceeded');
  let rows = 0;
  for (const [symbol, asset] of Object.entries(snapshot.assets)) {
    if (!Array.isArray(asset.bars) || asset.bars.length > LIMITS.bars) fail('RESOURCE_LIMIT', 'Snapshot bars exceed limit');
    rows += asset.bars.length; let prev = '';
    for (const b of asset.bars) {
      if (!/^\d{4}-\d\d-\d\d$/.test(b.date || '') || b.date <= prev || !Number.isFinite(b.close) || b.close <= 0) fail('SNAPSHOT_INVALID', symbol + ': invalid or duplicate price session');
      if (snapshot.history_class !== 'EXPLORATORY_NON_PIT') {
        if (![b.available_at, b.first_published_at, b.ingested_at, b.tradable_at].every(t => typeof t === 'string' && Number.isFinite(Date.parse(t)) && new Date(t).toISOString() === t) || !b.vintage) fail('PIT_INELIGIBLE', 'Verified history requires canonical UTC publication, ingestion, tradability and vintage on every record');
        if (b.available_at < b.first_published_at || (snapshot.history_class === 'OBSERVED_ARCHIVE' && b.available_at < b.ingested_at)) fail('TEMPORAL_LEAKAGE', 'Availability precedes publication/ingestion');
      }
      prev = b.date;
    }
  }
  if (rows > LIMITS.rows || Buffer.byteLength(JSON.stringify(snapshot)) > LIMITS.artifact_bytes) fail('RESOURCE_LIMIT', 'Snapshot exceeds row/byte ceiling');
  return snapshot;
}
export function snapshotSummary(snapshot) {
  const dates = (snapshot.assets.SPY || Object.values(snapshot.assets)[0]).bars.map(b => b.date);
  return { id: snapshot.id, captured_at: snapshot.captured_at, history_class: snapshot.history_class, warnings: snapshot.warnings,
    assets: Object.fromEntries(Object.entries(snapshot.assets).map(([s, a]) => [s, { first: a.bars[0]?.date, last: a.bars.at(-1)?.date, rows: a.bars.length }])),
    license: snapshot.license, adjustment: snapshot.adjustment,
    suggested_windows: { discovery: [dates[0], dates[Math.floor(dates.length * 0.5)]], holdout: [dates[Math.floor(dates.length * 0.7)], dates.at(-1)] } };
}
