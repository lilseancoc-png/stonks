import { randomUUID } from 'node:crypto';
import { computePicksAccuracyStats, computeBaselineStats } from './track-record-stats.mjs';
import { pickTradeId } from './pick-trade-text.mjs';

// These are reporting exclusions only. Neither key replaces an engine input
// or the durable broker ledger. A wipe never calls a broker API.
export const RESET_KEYS = Object.freeze({ onsite: 'track-record-reset.json', webull: 'webull-track-record-reset.json' });
export const SITE_RECORD_KEYS = Object.freeze(['picks-accuracy.json', 'picks-changes.json', 'picks-roster.json', 'grades-history.json']);
export const RANGE_DAYS = Object.freeze({ '1D': 1, '1W': 7, '1M': 30, '3M': 90, ALL: null });

export function wipeWindow(range, now = new Date()) {
  if (!Object.hasOwn(RANGE_DAYS, range)) throw new Error('Unknown wipe period');
  return { fromIso: range === 'ALL' ? null : new Date(now.getTime() - RANGE_DAYS[range] * 86400000).toISOString(), toIso: now.toISOString() };
}

export function parseReset(buf) {
  if (buf == null) return { version: 1, id: null, windows: [] };
  const value = JSON.parse(buf.toString());
  if (value?.version !== 1 || typeof value.id !== 'string' || !Array.isArray(value.windows) ||
      value.windows.some(w => !w || !Number.isFinite(Date.parse(w.toIso)) ||
        w.fromIso !== null && (!Number.isFinite(Date.parse(w.fromIso)) || Date.parse(w.fromIso) > Date.parse(w.toIso)))) {
    throw new Error('Invalid Track Record log exclusions');
  }
  return value;
}

export function inWindow(date, window) {
  const ms = typeof date === 'string' && date ? Date.parse(date) : NaN;
  // Undated rows are preserved by a partial wipe and included by Wipe ALL.
  if (!Number.isFinite(ms)) return window.fromIso === null;
  return (window.fromIso === null || ms >= Date.parse(window.fromIso)) && ms <= Date.parse(window.toIso);
}
const hidden = (date, reset) => reset.windows.some(w => inWindow(date, w));
const rows = value => Array.isArray(value) ? value : [];
const visible = (value, reset, field) => rows(value).filter(row => !hidden(row?.[field], reset));

export function projectSiteRecord(key, source, reset) {
  if (!reset.windows.length || !SITE_RECORD_KEYS.includes(key)) return source;
  if (key === 'picks-accuracy.json') {
    const open = visible(source.open, reset, 'entryDate'), closed = visible(source.closed, reset, 'entryDate');
    const archive = visible(source.archive, reset, 'entryDate');
    const baseline = { ...source.baseline, open: visible(source.baseline?.open, reset, 'entryDate'), closed: visible(source.baseline?.closed, reset, 'entryDate') };
    return { ...source, open, closed, archive, baseline,
      stats: computePicksAccuracyStats(open, closed, source.builtAtIso),
      allTimeStats: archive.length ? computePicksAccuracyStats([], closed.concat(archive), source.builtAtIso) : null,
      baselineStats: computeBaselineStats(baseline, closed),
      // Folded gate totals have no dated constituents. They are research,
      // kept intact like Grade edge rather than pretending to filter them.
    };
  }
  if (key === 'picks-roster.json') return hidden(source.builtAtIso, reset)
    ? { ...source, count: 0, roster: [], exited: [], swaps: [] } : source;
  return { ...source, changes: visible(source.changes, reset, 'date') };
}

export function projectWebullLedger(ledger, reset) {
  if (!reset.windows.length) return ledger;
  return { ...ledger,
    trades: Object.fromEntries(Object.entries(ledger.trades || {}).filter(([, trade]) => !hidden(trade?.engineEntryIso, reset))),
    runs: visible(ledger.runs, reset, 'at'),
  };
}

// Only include comparison metadata for trades still in this Webull report.
// Reading raw engine state keeps on-site wipes independent; narrowing it here
// prevents the response/export from carrying unrelated or wiped trade rows.
export function webullEngineRecord(record, ledger) {
  const ids = new Set(Object.entries(ledger.trades || {}).map(([id, t]) => t.tradeId || id));
  const keep = list => rows(list).filter(t => t?.symbol && t.entryDate && (ids.has(t.tradeId) || ids.has(pickTradeId(t))));
  const open = keep(record.open), closed = keep(record.closed), archive = keep(record.archive);
  const pairs = new Set([...open, ...closed, ...archive].map(t => `${t.symbol}:${t.side}:${t.entryDate}`));
  return { builtAtIso: record.builtAtIso, open, closed, archive,
    baseline: { open: rows(record.baseline?.open).filter(b => pairs.has(b.pairKey)), closed: rows(record.baseline?.closed).filter(b => pairs.has(b.pairKey)) } };
}

export async function readSiteRecord(store, key) {
  if (!SITE_RECORD_KEYS.includes(key)) throw new Error('Unknown Track Record log');
  const [buf, marker] = await Promise.all([store.get(key), store.get(RESET_KEYS.onsite)]);
  const source = buf == null ? {} : JSON.parse(buf.toString());
  return projectSiteRecord(key, source, parseReset(marker));
}

export function mergeWindows(windows) {
  const sorted = windows.slice().sort((a, b) => (a.fromIso === null ? -Infinity : Date.parse(a.fromIso)) - (b.fromIso === null ? -Infinity : Date.parse(b.fromIso)));
  const out = [];
  for (const w of sorted) {
    const last = out.at(-1);
    if (last && (w.fromIso === null || Date.parse(w.fromIso) <= Date.parse(last.toIso))) {
      if (Date.parse(w.toIso) > Date.parse(last.toIso)) last.toIso = w.toIso;
    } else out.push({ ...w });
  }
  return out;
}

export async function previewTrackRecord({ store, scope, range, now = new Date() }) {
  if (!Object.hasOwn(RESET_KEYS, scope)) throw new Error('Unknown tracker');
  const window = wipeWindow(range, now), reset = parseReset(await store.get(RESET_KEYS[scope]));
  let trades = [], events = [], runs = [], snapshotCount = 0;
  if (scope === 'webull') {
    const buf = await store.get('webull-paper-ledger.json');
    const ledger = projectWebullLedger(buf == null ? {} : JSON.parse(buf.toString()), reset);
    trades = Object.values(ledger.trades || {}); runs = rows(ledger.runs);
  } else {
    const record = await readSiteRecord(store, 'picks-accuracy.json');
    trades = [...rows(record.open), ...rows(record.closed), ...rows(record.archive)];
    for (const key of ['picks-changes.json', 'grades-history.json']) events.push(...rows((await readSiteRecord(store, key)).changes));
    const roster = await readSiteRecord(store, 'picks-roster.json');
    snapshotCount = (rows(roster.roster).length || rows(roster.exited).length) && inWindow(roster.builtAtIso, window) ? 1 : 0;
  }
  const field = scope === 'webull' ? 'engineEntryIso' : 'entryDate';
  return { kind: 'track-record-wipe', operationId: randomUUID(), scope, range, ...window, revision: reset.id,
    tradeCount: trades.filter(t => inWindow(t?.[field], window)).length,
    activityCount: events.filter(e => inWindow(e?.date, window)).length,
    runCount: runs.filter(r => inWindow(r?.at, window)).length,
    snapshotCount,
  };
}

export async function resetTrackRecord({ store, preview }) {
  const { scope } = preview;
  if (!Object.hasOwn(RESET_KEYS, scope)) throw new Error('Unknown tracker');
  // Separate reporting lock. Never acquire, rewrite or release broker state.
  return store.withLease('track-record-' + scope, async guard => {
    const reset = parseReset(await store.get(RESET_KEYS[scope]));
    if (reset.operationId === preview.operationId) return { scope, range: preview.range, resetAtIso: preview.toIso };
    if (reset.id !== preview.revision) throw Object.assign(new Error('This log changed after the confirmation opened. Select the period again to refresh it.'), { code: 'RESET_STALE' });
    const next = { version: 1, id: randomUUID(), operationId: preview.operationId,
      windows: mergeWindows([...reset.windows, { fromIso: preview.fromIso, toIso: preview.toIso }]) };
    guard();
    await store.put(RESET_KEYS[scope], JSON.stringify(next));
    return { scope, range: preview.range, resetAtIso: preview.toIso };
  });
}
