#!/usr/bin/env node
// Closing line value for the Sports prop record (2026-11-08): every pregame
// scan notes the current PrizePicks line for each saved pick; the last one
// before the start is the closing line. Offline, fake store, no network.
import assert from 'node:assert/strict';
import { capturePropPicks, propRecordView, closingLineFor, closingValue, CLOSING_LEAD_MAX_SECONDS } from '../lib/sports/prop-record.mjs';
import { sportsKey } from '../lib/sports/store.mjs';

const start = '2026-11-10T00:00:00.000Z';
const now = Date.parse(start) - 2 * 3600000;
const at = new Date(now - 60000).toISOString();
const line = (over) => ({ event_id: 'ev1', espn_event_id: null, home_team: 'BOS', away_team: 'NYK', start_utc: start, player_name: 'Test One', provider_player_id: 'pp-1',
  stat: 'points', side: over ? 'over' : 'under', threshold: 24.5, observed_utc: at, projection_id: null });
const pick = { ...line(true), sport: 'nba', game_id: 'g1', player_id: 'p1', team: 'BOS', opponent: 'NYK', rank_score: 61, basis: 'history_only', model: null, evidence: [], history: { games: 20 } };
const pick2 = { ...line(false), player_name: 'Test Two', provider_player_id: 'pp-2', sport: 'nba', game_id: 'g1', player_id: 'p2', team: 'NYK', opponent: 'BOS', rank_score: 58, basis: 'history_only', model: null, evidence: [], history: { games: 20 }, threshold: 7.5, stat: 'assists' };
const game = { game_id: 'g1', start_utc: start, season: 2026, home_team: 'BOS', away_team: 'NYK', picks: [pick, pick2], state: 'ok' };
const view = { sport: 'nba', rank_version: 'props-rank-3', sources: { lines: { provider: 'fixture' }, injuries: { observed_utc: at } }, games: [game] };

// closingLineFor: same event, stat and player; same side preferred.
const lines = [line(true), line(false), { ...line(true), player_name: 'Other Guy', provider_player_id: 'pp-9' }, { ...line(true), stat: 'rebounds', threshold: 6.5 }];
assert.equal(closingLineFor(pick, lines).side, 'over');
assert.equal(closingLineFor({ ...pick, side: 'under' }, lines).side, 'under');
assert.equal(closingLineFor({ ...pick, provider_player_id: null }, [{ ...line(true), provider_player_id: null, player_name: 'TEST ONE' }]).threshold, 24.5, 'folded name match without provider ids');
assert.equal(closingLineFor(pick, [{ ...line(true), event_id: 'ev2' }]), null, 'another game never matches');
assert.equal(closingLineFor(pick, []), null);
assert.equal(closingValue(pick), null, 'no closing line yet');
assert.deepEqual(closingValue({ ...pick, closing: { threshold: 25.5, observed_utc: at, lead_seconds: 120 } }).points, 1, 'over: the line moving up is in the pick’s favor');
assert.deepEqual(closingValue({ ...pick, side: 'under', closing: { threshold: 25.5, observed_utc: at, lead_seconds: 120 } }).points, -1, 'under: the line moving up is against');
assert.equal(closingValue({ ...pick, closing: { threshold: 24.5, observed_utc: at } }).beat, null);
assert.equal(closingValue({ ...pick, closing: { threshold: 24.5, observed_utc: at, lead_seconds: 120 } }).stale, false);
assert.equal(closingValue({ ...pick, closing: { threshold: 24.5, observed_utc: at, lead_seconds: 6 * 3600 } }).stale, true, 'a line seen six hours out is kept but not counted');

// Fake R2 store with leases.
const objects = new Map(), leases = new Set();
const store = { backend: 'r2', rawGet: async (key) => objects.has(key) ? Buffer.from(objects.get(key)) : null,
  rawPut: async (key, value) => { objects.set(key, String(value)); },
  withLease: async (key, fn) => { if (leases.has(key)) return { busy: true }; leases.add(key); try { await fn(() => {}); return { busy: false }; } finally { leases.delete(key); } } };
const recordKey = sportsKey('prop-record', { sport: 'nba', season: 2026 });

// First scan: two picks recorded, closing lines noted at once (same line).
let r = await capturePropPicks({ store, view, lines: [line(true), { ...line(false), player_name: 'Test Two', provider_player_id: 'pp-2', stat: 'assists', threshold: 7.5 }], now });
assert.equal(r.added, 2);
assert.equal(r.closings, 2, 'the first scan notes the current line as the closing line too');
let saved = JSON.parse(objects.get(recordKey)).picks;
assert.equal(saved[0].threshold, 24.5); assert.equal(saved[0].closing.threshold, 24.5);
assert.equal(saved[0].closing.lead_seconds, Math.round((Date.parse(start) - Date.parse(at)) / 1000));

// Later scan, no new picks: the line moved to 25.5; the saved line stays.
const later = now + 3600000, laterAt = new Date(later - 30000).toISOString();
r = await capturePropPicks({ store, view: { ...view, games: [{ ...game, picks: [] }] }, lines: [{ ...line(true), threshold: 25.5, observed_utc: laterAt }], now: later });
assert.equal(r.added, 0); assert.equal(r.closings, 1);
saved = JSON.parse(objects.get(recordKey)).picks;
assert.equal(saved[0].threshold, 24.5, 'the saved line never changes');
assert.equal(saved[0].closing.threshold, 25.5);
assert.equal(saved[1].closing.threshold, 7.5, 'a pick without a fresh line keeps its last closing line');
const frozen = objects.get(recordKey);

// Same line again: no write. Older observation: no write.
r = await capturePropPicks({ store, view: { ...view, games: [{ ...game, picks: [] }] }, lines: [{ ...line(true), threshold: 25.5, observed_utc: laterAt }], now: later + 1000 });
assert.equal(r.closings, 0); assert.equal(objects.get(recordKey), frozen);
r = await capturePropPicks({ store, view: { ...view, games: [{ ...game, picks: [] }] }, lines: [{ ...line(true), threshold: 23.5, observed_utc: at }], now: later + 2000 });
assert.equal(r.closings, 0, 'an older observation never replaces a newer closing line');

// Stale lines (older than the freshness window) are ignored; no lines passed = no closing writes.
r = await capturePropPicks({ store, view: { ...view, games: [{ ...game, picks: [] }] }, lines: [{ ...line(true), threshold: 30.5, observed_utc: new Date(later - 3 * 3600000).toISOString() }], now: later + 3000 });
assert.equal(r.closings, 0);
r = await capturePropPicks({ store, view: { ...view, games: [{ ...game, picks: [] }] }, now: later + 4000 });
assert.equal(r.closings, 0); assert.equal(objects.get(recordKey), frozen);

// After the start nothing moves (no hindsight closing line).
r = await capturePropPicks({ store, view: { ...view, games: [{ ...game, picks: [] }] }, lines: [{ ...line(true), threshold: 29.5, observed_utc: new Date(Date.parse(start) + 60000).toISOString() }], now: Date.parse(start) + 120000 });
assert.equal(r.closings, 0); assert.equal(objects.get(recordKey), frozen);
assert.ok(CLOSING_LEAD_MAX_SECONDS >= 3600);

// The view carries the CLV per pick, the summary and the split by line move.
const final = Date.parse(start) + 4 * 3600000;
const load = async (kind) => {
  if (kind === 'prop-record') return JSON.parse(objects.get(recordKey));
  if (kind === 'games') return { games: [{ game_id: 'g1', start_utc: start, season: 2026, home_team: 'BOS', away_team: 'NYK', status: 'final' }] };
  if (kind === 'player-games') return { rows: [{ game_id: 'g1', player_id: 'p1', played: true, stats: { points: 30 } }, { game_id: 'g1', player_id: 'p2', played: true, stats: { assists: 9 } }] };
  return null;
};
const record = await propRecordView({ load, sport: 'nba', seasons: [2026], now: final, all: true });
const one = record.records.find((p) => p.player_id === 'p1'), two = record.records.find((p) => p.player_id === 'p2');
assert.equal(one.result, 'win'); assert.equal(one.clv.points, 1); assert.equal(one.clv.beat, true); assert.equal(one.clv.stale, false);
assert.equal(two.result, 'loss'); assert.equal(two.clv.points, 0); assert.equal(two.clv.beat, null);
const CL = record.summary.closing_line;
assert.equal(CL.n, 2); assert.equal(CL.too_early, 0); assert.equal(CL.beat, 1); assert.equal(CL.worse, 0); assert.equal(CL.unchanged, 1);
assert.equal(CL.beat_rate, 1); assert.equal(CL.average_points, 0.5);
assert.deepEqual(CL.histogram, { '+1.0': 1, '0.0': 1 });
assert.equal(CL.when_beat.win_rate, 1); assert.equal(CL.when_unchanged.win_rate, 0);
assert.ok(CL.median_lead_seconds > 0 && /closing line/i.test(CL.note));
assert.deepEqual(Object.keys(record.by_line_move).sort(), ['moved for us', 'unchanged']);
assert.equal(record.by_line_move['moved for us'].wins, 1);
assert.ok(/^[a-f0-9]{24}$/.test(record.snapshot));

// A closing line seen too early stays on the pick but is left out of the counts.
const early = await propRecordView({ load: async (kind) => kind === 'prop-record' ? { picks: JSON.parse(objects.get(recordKey)).picks.map((p) => p.player_id === 'p1' ? { ...p, closing: { ...p.closing, lead_seconds: 5 * 3600 } } : p) } : load(kind), sport: 'nba', seasons: [2026], now: final, all: true });
assert.equal(early.summary.closing_line.n, 1); assert.equal(early.summary.closing_line.too_early, 1);
assert.deepEqual(Object.keys(early.by_line_move).sort(), ['no closing line', 'unchanged']);

// A record without closing lines still reads cleanly.
const bare = await propRecordView({ load: async (kind) => kind === 'prop-record' ? { picks: JSON.parse(objects.get(recordKey)).picks.map(({ closing, ...p }) => p) } : load(kind), sport: 'nba', seasons: [2026], now: final, all: true });
assert.equal(bare.summary.closing_line.n, 0); assert.equal(bare.records[0].clv, null);
assert.deepEqual(Object.keys(bare.by_line_move), ['no closing line']);

console.log('sports-clv-smoke: ok');
