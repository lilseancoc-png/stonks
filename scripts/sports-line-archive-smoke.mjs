#!/usr/bin/env node
// The PrizePicks line archive (lib/sports/line-archive.mjs): one entry per
// game, player and stat by game date, written only when a line is new or
// moves, pregame only; and the real lines the daily model check reads back.
// Offline, fake R2 store.
import assert from 'node:assert/strict';
import { archiveLines, loadRealLines, LINE_ARCHIVE_START } from '../lib/sports/line-archive.mjs';
import { sportsKey } from '../lib/sports/store.mjs';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

function fakeR2() {
  const objects = new Map(), leases = new Set();
  let puts = 0;
  return {
    objects, backend: 'r2', get puts() { return puts; },
    rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null),
    rawPut: async (k, v) => { puts++; objects.set(k, String(v)); },
    async withLease(name, fn) { if (leases.has(name)) return { busy: true }; leases.add(name); try { await fn(() => {}); return { busy: false }; } finally { leases.delete(name); } },
  };
}

const NOW = Date.parse('2026-11-12T18:00:00Z');
const start = '2026-11-13T00:30:00Z'; // 19:30 ET on 2026-11-12
const line = (extra = {}) => ({ game_id: '401', player_id: 'p1', stat: 'points', threshold: 24.5, observed_utc: '2026-11-12T17:55:00Z', start_utc: start, ...extra });
const st = fakeR2();
const key = sportsKey('lines', { sport: 'nba', date: '2026-11-12' });
eq(key, '_stonks/sports/v1/nba/lines/2026-11-12.json', 'one file per sport and game date (ET)');
assert.throws(() => sportsKey('lines', { sport: 'nba', date: '2026-11' }), /YYYY-MM-DD/); checks++;
assert.throws(() => sportsKey('lines', { sport: 'nba', date: '../x' }), /YYYY-MM-DD/); checks++;
assert.throws(() => sportsKey('lines', { sport: 'nhl', date: '2026-11-12' }), /nba or nfl/); checks++;

let r = await archiveLines({ store: st, sport: 'nba', now: NOW, lines: [
  line(), line({ observed_utc: '2026-11-12T17:56:00Z' }), // the other side of the same line
  line({ player_id: 'p2', stat: 'rebounds', threshold: 9.5 }),
  line({ game_id: 'started', start_utc: '2026-11-12T17:00:00Z' }), // already started
  line({ game_id: 'after', observed_utc: '2026-11-13T01:00:00Z', start_utc: '2026-11-13T00:30:00Z' }), // seen after the start
  line({ game_id: 'old', start_utc: '2026-11-10T23:00:00Z' }), // before the archive began (and started)
  line({ player_id: 'p3', threshold: 24.3 }), // not a whole or half line
  line({ player_id: '' }),
] });
eq([r.state, r.added, r.moved], ['ok', 2, 0], 'two new lines; started, postgame and malformed lines are skipped');
const file = JSON.parse(st.objects.get(key));
eq(Object.keys(file.lines).sort(), ['401|p1|points', '401|p2|rebounds']);
eq(file.lines['401|p1|points'], [24.5, '2026-11-12T17:55:00Z', 24.5, '2026-11-12T17:55:00Z'], 'first line and current line');
eq(file.fields, ['first_line', 'first_seen_utc', 'line', 'line_since_utc']);
const putsAfterFirst = st.puts;
r = await archiveLines({ store: st, sport: 'nba', now: NOW + 600000, lines: [line({ observed_utc: '2026-11-12T18:05:00Z' })] });
eq([r.added, r.moved, st.puts], [0, 0, putsAfterFirst], 'an unchanged line writes nothing');
r = await archiveLines({ store: st, sport: 'nba', now: NOW + 1200000, lines: [line({ threshold: 25.5, observed_utc: '2026-11-12T18:15:00Z' })] });
eq([r.added, r.moved], [0, 1]);
eq(JSON.parse(st.objects.get(key)).lines['401|p1|points'], [24.5, '2026-11-12T17:55:00Z', 25.5, '2026-11-12T18:15:00Z'], 'a moved line keeps its first value');
r = await archiveLines({ store: st, sport: 'nba', now: NOW + 1200000, lines: [line({ threshold: 23.5, observed_utc: '2026-11-12T18:10:00Z' })] });
eq(r.moved, 0, 'an older sighting never replaces a newer line');
eq((await archiveLines({ store: { rawGet: async () => null }, sport: 'nba', now: NOW, lines: [line()] })).state, 'skipped', 'needs the R2 store');
eq((await archiveLines({ store: st, sport: 'nba', now: NOW, lines: [] })).state, 'skipped');
// A damaged file is left alone.
const bad = fakeR2();
bad.objects.set(key, JSON.stringify({ lines: [] }));
eq((await archiveLines({ store: bad, sport: 'nba', now: NOW, lines: [line()] })).state, 'unavailable');
eq(bad.objects.get(key), JSON.stringify({ lines: [] }), 'and not rewritten');
// Two scans at once: the lease keeps one writer.
const both = fakeR2();
const [a, b] = await Promise.all([archiveLines({ store: both, sport: 'nba', now: NOW, lines: [line()] }), archiveLines({ store: both, sport: 'nba', now: NOW, lines: [line({ player_id: 'p9' })] })]);
ok([a.state, b.state].includes('ok'), 'one of two concurrent scans writes');

// --- what the model check reads back ---------------------------------------------------
st.objects.set(sportsKey('prop-record', { sport: 'nba', season: 2026 }), JSON.stringify({ policy: 'first_pair_per_game', picks: [
  { game_id: '300', player_id: 'p5', stat: 'assists', threshold: 7.5 }, { game_id: 300, player_id: 'p6', stat: 'points', threshold: 'x' },
] }));
st.objects.set(sportsKey('lines', { sport: 'nba', date: '2026-11-01' }), JSON.stringify({ lines: { 'x|y|points': [1.5, '', 1.5, ''] } }));
const real = await loadRealLines({ store: st, sport: 'nba', dates: ['2026-11-01', '2026-11-12', '2026-11-12', '2026-11-20'], seasons: [2025, 2026] });
eq(real, [
  { game_id: '300', player_id: 'p5', stat: 'assists', threshold: 7.5, source: 'issued' },
  { game_id: '401', player_id: 'p1', stat: 'points', threshold: 25.5, source: 'archive' },
  { game_id: '401', player_id: 'p2', stat: 'rebounds', threshold: 9.5, source: 'archive' },
], 'issued picks plus the latest archived line; dates before the archive and bad rows are skipped');
ok(LINE_ARCHIVE_START === '2026-11-11');
eq(await loadRealLines({ store: fakeR2(), sport: 'nfl', dates: ['2026-11-15'], seasons: [2026] }), [], 'nothing stored: no lines');

console.log(`Sports line archive smoke passed (${checks} checks).`);
