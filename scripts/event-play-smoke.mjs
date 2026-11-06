// Event-aware Top Picks (lib/event-play.mjs + its build.mjs wiring): the
// trade-through rules, the caps, the frozen tag on enrollment, the one
// post-event review and the post-shock time limit. Offline, no network.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EVENT_PLAY_LIMITS, macroEventPlay, earningsEventPlay, ownEarningsRecord, shockLaneState,
  eventPlayCounts, eventPlayCapHit, eventPlayCountAdd, eventResolved, eventPlayExit,
} from '../lib/event-play.mjs';
import { topPicksMarket } from '../lib/top-picks-market.mjs';
import { entryPolicyFixture } from './entry-policy-smoke.mjs';
import { buildTopPicks, etDateKey } from './build.mjs';

let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
const now = new Date().toISOString(), ms = Date.parse(now);
const DAY = 86400000;

await check('macro: the tape must agree with the side', () => {
  const er = { active: true, label: 'FOMC decision', date: '2026-11-10', sessionsOut: 1 };
  assert.equal(macroEventPlay({ side: 'call', regime: 'neutral', eventRisk: er }).ok, true);
  assert.equal(macroEventPlay({ side: 'call', regime: 'risk-on', eventRisk: er }).ok, true);
  assert.equal(macroEventPlay({ side: 'call', regime: 'risk-off', eventRisk: er }).ok, false);
  assert.equal(macroEventPlay({ side: 'put', regime: 'neutral', eventRisk: er }).ok, false);
  assert.equal(macroEventPlay({ side: 'put', regime: 'severe', eventRisk: er }).ok, true);
  assert.equal(macroEventPlay({ side: 'call', regime: 'neutral', eventRisk: er }).releaseEtMin, 840);
  assert.equal(macroEventPlay({ side: 'call', regime: 'neutral', eventRisk: { ...er, label: 'CPI' } }).releaseEtMin, 510);
  assert.equal(macroEventPlay({ side: 'call', regime: 'neutral', eventRisk: { active: false } }), null);
});

const hx = (moves, pre10Pct = 0.01, longRun = null) => ({
  events: moves.map((m, i) => ({ date: `2025-${String(i + 1).padStart(2, '0')}-15`, movePct: m })),
  longRun, next: { date: '2026-11-10', session: 'PM', pre10Pct },
});
await check('earnings: own record, season and run-in vote; thin records wait', () => {
  const up = hx([0.04, 0.03, -0.01, 0.05, 0.02]);
  assert.equal(earningsEventPlay({ side: 'call', earningsHx: up, season: { n: 30, negativeShare: 0.3 } }).ok, true);
  // Season selling prints cancels a good own record.
  assert.equal(earningsEventPlay({ side: 'call', earningsHx: up, season: { n: 30, negativeShare: 0.76 } }).ok, false);
  // A thin season does not count either way; own record alone carries it.
  assert.equal(earningsEventPlay({ side: 'call', earningsHx: up, season: { n: 3, negativeShare: 0.9 } }).ok, true);
  // Crowded run-in on the trade's side costs a vote.
  const crowded = earningsEventPlay({ side: 'call', earningsHx: hx([0.04, 0.03, -0.01, 0.05, 0.02], 0.09), season: { n: 30, negativeShare: 0.5 } });
  assert.equal(crowded.votes.runIn, -1); assert.equal(crowded.ok, false);
  // Own record against the side always waits, whatever the season says.
  assert.equal(earningsEventPlay({ side: 'put', earningsHx: up, season: { n: 30, negativeShare: 0.9 } }).ok, false);
  assert.equal(earningsEventPlay({ side: 'call', earningsHx: hx([0.04, 0.03]), season: null }).ok, false);
  // The long-run count wins when it has at least twice the minimum prints.
  const lr = ownEarningsRecord(hx([0.04, 0.03, 0.02, 0.01], 0, { n: 40, up: 12 }));
  assert.equal(lr.source, 'long-run'); assert.equal(lr.upShare, 0.3);
});

await check('shock lane needs a risk-off tape, the index axis at -2 and both indexes below the 20-day', () => {
  const mr = (state, score) => ({ state, axes: { indexes: { score } } });
  const below = { spy: { aboveSma20: false }, qqq: { aboveSma20: false } };
  assert.equal(shockLaneState(mr('severe-risk-off', -2), below).active, true);
  assert.equal(shockLaneState(mr('risk-off', -2), below).active, true);
  assert.equal(shockLaneState(mr('neutral', -2), below).active, false);
  assert.equal(shockLaneState(mr('risk-off', -1), below).active, false);
  assert.equal(shockLaneState(mr('risk-off', -2), { spy: { aboveSma20: false }, qqq: { aboveSma20: true } }).active, false);
});

await check('shock lane closes once the Bottom tracker reads a potential bottom or later', () => {
  const mr = { state: 'risk-off', axes: { indexes: { score: -2 } } };
  const below = { spy: { aboveSma20: false }, qqq: { aboveSma20: false } };
  for (const verdict of ['potential', 'emerging', 'confirmed']) {
    const s = shockLaneState(mr, below, { verdict });
    assert.equal(s.active, false, verdict);
    assert.equal(s.bottomHeld, verdict);
    assert.match(s.reason, /Bottom tracker/);
  }
  for (const verdict of ['stress', 'slowing', 'pullback', null]) assert.equal(shockLaneState(mr, below, { verdict }).active, true, String(verdict));
  assert.equal(shockLaneState(mr, below, null).active, true, 'no tracker read keeps the lane as before');
  assert.equal(shockLaneState({ state: 'neutral', axes: { indexes: { score: 0 } } }, below, { verdict: 'potential' }).bottomHeld, null, 'no break, nothing to hold');
});

await check('caps: per event, per week and post-shock puts at once', () => {
  const key = 'macro:FOMC decision:2026-11-10';
  const rows = [
    { entryDate: now, eventPlay: { kind: 'macro', key } },
    { entryDate: now, eventPlay: { kind: 'macro', key } },
  ];
  const c = eventPlayCounts(rows, now);
  assert.equal(eventPlayCapHit({ kind: 'macro', key }, c), 'event');
  assert.equal(eventPlayCapHit({ kind: 'macro', key: 'macro:CPI:2026-11-12' }, c), null);
  eventPlayCountAdd({ kind: 'earnings', key: 'earnings:X:1' }, c);
  eventPlayCountAdd({ kind: 'earnings', key: 'earnings:Y:1' }, c);
  assert.equal(c.week, EVENT_PLAY_LIMITS.perWeek);
  assert.equal(eventPlayCapHit({ kind: 'earnings', key: 'earnings:Z:1' }, c), 'week');
  // Closed rows count toward the week but not the per-event open count; old rows count for nothing.
  const c2 = eventPlayCounts([
    { entryDate: now, exitDate: now, status: 'hit-tp-prem', eventPlay: { kind: 'macro', key } },
    { entryDate: new Date(ms - 9 * DAY).toISOString(), eventPlay: { kind: 'shock', key: 'shock:x' } },
  ], now);
  assert.equal(c2.week, 1); assert.equal(c2.perKey[key], undefined); assert.equal(c2.shockOpen, 1);
  assert.equal(eventPlayCapHit({ kind: 'shock', key: 'shock:x' }, { ...c2, shockOpen: EVENT_PLAY_LIMITS.shockOpen }), 'shock');
});

await check('resolution: release times, AM vs PM prints', () => {
  assert.equal(eventResolved({ kind: 'macro', date: '2026-11-10', releaseEtMin: 840 }, '2026-11-10', 870), true);
  assert.equal(eventResolved({ kind: 'macro', date: '2026-11-10', releaseEtMin: 840 }, '2026-11-10', 660), false);
  assert.equal(eventResolved({ kind: 'macro', date: '2026-11-10', releaseEtMin: 510 }, '2026-11-10', 660), true);
  assert.equal(eventResolved({ kind: 'earnings', date: '2026-11-10', session: 'PM' }, '2026-11-10', 950), false);
  assert.equal(eventResolved({ kind: 'earnings', date: '2026-11-10', session: 'PM' }, '2026-11-11', 660), true);
  assert.equal(eventResolved({ kind: 'earnings', date: '2026-11-10', session: 'AM' }, '2026-11-10', 660), true);
  assert.equal(eventResolved({ kind: 'macro', date: '2026-11-10' }, '2026-11-09', 900), false);
});

await check('exits: one post-event review and the shock time limit', () => {
  const rec = (side, ep) => ({ side, eventPlay: ep });
  const ep = { kind: 'macro', date: '2026-11-10', releaseEtMin: 840 };
  assert.equal(eventPlayExit(rec('call', ep), { todayIso: '2026-11-09', gradeNow: 1 }), null, 'before the event, nothing happens');
  assert.equal(eventPlayExit(rec('call', ep), { todayIso: '2026-11-11', gradeNow: 3 }).status, 'event-review');
  assert.equal(eventPlayExit(rec('put', ep), { todayIso: '2026-11-11', gradeNow: -3 }).status, 'event-review');
  assert.deepEqual(eventPlayExit(rec('put', ep), { todayIso: '2026-11-11', gradeNow: -5 }).reviewed, { at: '2026-11-11', sideGrade: 5 });
  assert.equal(eventPlayExit(rec('call', { ...ep, reviewed: { at: '2026-11-11', sideGrade: 6 } }), { todayIso: '2026-11-12', gradeNow: 1 }), null, 'only one review');
  assert.equal(eventPlayExit(rec('call', ep), { todayIso: '2026-11-11', gradeNow: null }), null, 'no grade, no review yet');
  assert.equal(eventPlayExit(rec('put', { kind: 'shock' }), { heldSessions: 9 }), null);
  assert.equal(eventPlayExit(rec('put', { kind: 'shock' }), { heldSessions: 10 }).status, 'shock-time');
});

// --- Roster wiring -----------------------------------------------------------
const macro = (state = 'neutral') => ({ state, stress: 0, dataQuality: { sufficient: true }, axes: { indexes: { score: 0, available: true }, vix: { score: 0, available: true } },
  inputs: { indexes: { asOf: now, spy: { pctChange1d: 0 }, qqq: { pctChange1d: 0 } }, vix: { asOf: now, value: 18 } } });
const assess = () => topPicksMarket.assess({ macroRegime: macro(), asOf: now });
const { data, row, aiThesis } = entryPolicyFixture();
const eventDate = etDateKey(new Date(ms + DAY));
const fomc = { active: true, label: 'FOMC decision', date: eventDate, daysOut: 1, sessionsOut: 1, alwaysDefer: true };
const roster = (extra = {}) => buildTopPicks({ FIXTURE: data }, [], null, null, { macroRegime: macro(), eventRisk: fomc }, null, .045,
  { preScored: { scored: [structuredClone(row)], peerIndex: {}, regimeBand: 'neutral' }, marketAssessment: assess(), aiThesisMap: { 'FIXTURE:call': aiThesis }, builtAtIso: now, ...extra });

await check('roster: a confirmed call trades through FOMC on a debit spread and carries the tag', () => {
  const p = roster();
  assert.equal(p[0].group, 'actionable');
  assert.equal(p[0].eventPlay.kind, 'macro');
  assert.equal(p[0].eventPlay.key, `macro:FOMC decision:${eventDate}`);
  assert.equal(p[0].strategy.type, 'debit');
  assert.equal(p[0].entryTiming.hardWait, null);
  assert.equal(p.rosterMeta.eventPlays.length, 1);
});

await check('roster: the per-event cap holds the third pick back as a wait', () => {
  const key = `macro:FOMC decision:${eventDate}`;
  const openPositions = ['AAA', 'BBB'].map((symbol) => ({ symbol, side: 'call', entryDate: now, eventPlay: { kind: 'macro', key } }));
  const p = roster({ openPositions });
  assert.equal(p.filter((x) => x.group === 'actionable').length, 0);
  assert.equal(p[0].entry.signal, 'wait-event-cap');
  assert.deepEqual(p.rosterMeta.eventCapped, ['FIXTURE']);
  assert(p.rosterMeta.turnedAway.some((t) => t.gate === 'event-cap'));
});

await check('roster: a call into FOMC against a risk-off tape keeps the event wait', () => {
  const p = buildTopPicks({ FIXTURE: data }, [], null, null, { macroRegime: macro('risk-off'), eventRisk: fomc }, null, .045,
    { preScored: { scored: [structuredClone(row)], peerIndex: {}, regimeBand: 'risk-off' }, marketAssessment: topPicksMarket.assess({ macroRegime: macro('risk-off'), asOf: now }), aiThesisMap: { 'FIXTURE:call': aiThesis }, builtAtIso: now });
  assert.equal(p.filter((x) => x.group === 'actionable').length, 0);
  assert(!p[0] || !p[0].eventPlay);
});

// --- Track record: enrollment tag, review exit, shock limit ------------------
const storage = await mkdtemp(join(tmpdir(), 'event-play-'));
try {
  await mkdir(join(storage, 'data'));
  let source = await readFile(new URL('./build.mjs', import.meta.url), 'utf8');
  source = source.replace(/^(import(?:\s*\{[^}]*\}|\s+[^\n;]+?)\s+from\s+|export\s*\{[^}]*\}\s*from\s+)(["'])([^"']+)\2/gm, (whole, prefix, quote, specifier) => specifier.startsWith('node:') ? whole : prefix + quote + (specifier.startsWith('.') ? new URL(specifier, new URL('./build.mjs', import.meta.url)).href : import.meta.resolve(specifier)) + quote);
  source = source.replace('const ROOT = resolve(__dirname, "..");', 'const ROOT = ' + JSON.stringify(storage) + ';');
  await writeFile(join(storage, 'engine.mjs'), source);
  const engine = await import(pathToFileURL(join(storage, 'engine.mjs')).href);
  const built = roster();
  const yesterday = etDateKey(new Date(ms - DAY));
  const picks = built.map((p) => ({ ...p, symbol: 'AAPL', eventPlay: { ...p.eventPlay, date: yesterday } }));
  await writeFile(join(storage, 'data/picks.json'), JSON.stringify({ builtAtIso: now, rosterMeta: built.rosterMeta, picks }));
  const chains = { AAPL: data, FIXTURE: data };
  await engine.updatePicksAccuracyFile(chains, now, { open: [], closed: [] });
  const first = await engine.readPicksAccuracyState();
  await check('record: the event tag is frozen on enrollment with the new timing version', () => {
    assert.equal(first.open.length, 1);
    assert.equal(first.open[0].eventPlay.kind, 'macro');
    assert.equal(first.open[0].entryTimingVersion, 5);
  });
  const driverKeys = first.open[0].thesis?.driverKeys || [];
  const grade = (total) => ({ AAPL: { total, drivers: driverKeys.map((key) => ({ key, score: 1 })) } });
  const later = new Date(ms + 60000).toISOString();

  const passState = structuredClone(first);
  await engine.updatePicksAccuracyFile(chains, later, passState, grade(6), { enrollNewPicks: false });
  const passed = JSON.parse(await readFile(join(storage, 'data/picks-accuracy.json'), 'utf8'));
  await check('record: a grade still clearing 4 its way passes the review and is stamped', () => {
    assert.equal(passed.open.length, 1);
    assert.equal(passed.open[0].eventPlay.reviewed.sideGrade, 6);
  });

  const failState = structuredClone(first);
  await engine.updatePicksAccuracyFile(chains, later, failState, grade(2), { enrollNewPicks: false });
  const failed = JSON.parse(await readFile(join(storage, 'data/picks-accuracy.json'), 'utf8'));
  await check('record: a grade that faded below 4 after the event closes as event-review', () => {
    assert.equal(failed.open.length, 0);
    assert.equal(failed.closed[0].status, 'event-review');
  });

  const shockState = structuredClone(first);
  shockState.open[0].eventPlay = { kind: 'shock', key: 'shock:risk-off', date: etDateKey(new Date(ms - 20 * DAY)) };
  shockState.open[0].entryDate = new Date(ms - 20 * DAY).toISOString();
  await engine.updatePicksAccuracyFile(chains, later, shockState, grade(6), { enrollNewPicks: false });
  const shocked = JSON.parse(await readFile(join(storage, 'data/picks-accuracy.json'), 'utf8'));
  await check('record: a post-shock put closes at the 10-session limit', () => {
    assert.equal(shocked.open.length, 0);
    assert.equal(shocked.closed[0].status, 'shock-time');
  });
} finally { await rm(storage, { recursive: true, force: true }); }

console.log(`${checks} event-play checks passed.`);
