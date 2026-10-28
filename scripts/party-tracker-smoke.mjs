// Offline checks for the Owner Party tracker. No network and no writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HOUSE_CONTROL,
  PRESIDENT_CONTROL,
  SENATE_CONTROL,
  STUDY_START,
  buildPartyTracker,
  controlGaps,
  nextDay,
  partyOn,
  refreshReady,
  sortPartyRows,
} from '../lib/party-tracker.mjs';
import { refreshPartyTracker } from './refresh-party-tracker.mjs';
import { isPremiumKey, roleClaimForKey } from '../lib/premium-keys.mjs';

assert.deepEqual(controlGaps(PRESIDENT_CONTROL, STUDY_START, '2029-01-20'), []);
assert.deepEqual(controlGaps(HOUSE_CONTROL, '2001-01-03', '2027-01-03'), []);
assert.deepEqual(controlGaps(SENATE_CONTROL, STUDY_START, '2027-01-03'), []);
assert.deepEqual(controlGaps(HOUSE_CONTROL, STUDY_START, '2027-01-03'), []);

assert.equal(partyOn(PRESIDENT_CONTROL, '2001-01-20').name, 'George W. Bush');
assert.equal(partyOn(PRESIDENT_CONTROL, '2008-12-31').party, 'R');
assert.equal(partyOn(PRESIDENT_CONTROL, '2009-01-20').name, 'Barack Obama');
assert.equal(partyOn(PRESIDENT_CONTROL, '2017-01-20').name, 'Donald Trump');
assert.equal(partyOn(PRESIDENT_CONTROL, '2021-01-19').name, 'Donald Trump');
assert.equal(partyOn(PRESIDENT_CONTROL, '2021-01-20').name, 'Joe Biden');
assert.equal(partyOn(PRESIDENT_CONTROL, '2025-01-19').name, 'Joe Biden');
assert.equal(partyOn(PRESIDENT_CONTROL, '2025-01-20').name, 'Donald Trump');
assert.equal(partyOn(SENATE_CONTROL, '2001-06-05').party, 'R');
assert.equal(partyOn(SENATE_CONTROL, '2001-06-06').party, 'D');
assert.equal(partyOn(SENATE_CONTROL, '2002-11-11').party, 'D');
assert.equal(partyOn(SENATE_CONTROL, '2002-11-12').party, 'R');
assert.equal(partyOn(SENATE_CONTROL, '2021-01-19').party, 'R');
assert.equal(partyOn(SENATE_CONTROL, '2021-01-20').party, 'D');
assert.equal(partyOn(HOUSE_CONTROL, '2007-01-02').party, 'R');
assert.equal(partyOn(HOUSE_CONTROL, '2007-01-03').party, 'D');
assert.equal(partyOn(HOUSE_CONTROL, '2019-01-03').party, 'D');
assert.equal(partyOn(HOUSE_CONTROL, '2023-01-03').party, 'R');
const now = partyOn(PRESIDENT_CONTROL, '2026-10-28');
assert.equal(now.party, 'R');
assert.equal(partyOn(HOUSE_CONTROL, '2026-10-28').congress, 119);
assert.equal(partyOn(SENATE_CONTROL, '2026-10-28').party, 'R');

function bars(start, end, multiplier) {
  const out = [];
  let price = 100;
  for (let t = start; t <= end; t = nextDay(t)) {
    price *= multiplier(t);
    out.push({ t, v: price });
  }
  return out;
}

const end = '2026-10-27';
const spy = bars('2001-01-19', end, (t) => partyOn(PRESIDENT_CONTROL, t)?.party === 'D' ? 1.001 : 1.0002);
const xlv = bars('2001-01-19', end, (t) => {
  const base = partyOn(PRESIDENT_CONTROL, t)?.party === 'D' ? 1.001 : 1.0002;
  return partyOn(PRESIDENT_CONTROL, t)?.party === 'D' ? base * 1.0003 : base;
});
const payload = buildPartyTracker({
  series: { SPY: spy, QQQ: spy, XLV: xlv, XLE: spy },
  builtAtIso: '2026-10-28T12:00:00.000Z',
});
assert.equal(refreshReady(payload), true);
assert.equal(payload.asOf, end);
assert.equal(payload.window.start, STUDY_START);
assert.equal(payload.current.alignment, 'unified');
assert.match(payload.current.read, /Donald Trump/);
assert.match(payload.current.read, /119th Congress/);
const president = payload.offices.find((office) => office.id === 'president');
const demAnn = (Math.pow(1.001, 365.2425) - 1) * 100;
const repAnn = (Math.pow(1.0002, 365.2425) - 1) * 100;
assert.ok(Math.abs(president.parties.D.annPct - demAnn) < 0.2, `Democratic annualized ${president.parties.D.annPct} vs ${demAnn}`);
assert.ok(Math.abs(president.parties.R.annPct - repAnn) < 0.2, `Republican annualized ${president.parties.R.annPct} vs ${repAnn}`);
assert.equal(president.leader, 'D');
assert.match(president.read, /Democratic president periods compounded/);
const health = payload.rows.find((row) => row.id === 'XLV');
assert.ok(health.offices.president.D.excessAnnPct > 5);
assert.match(payload.highlights.president.health, /Health care compounded/);
assert.match(payload.highlights.president.energy, /Energy compounded/);
assert.ok(payload.timeline.every((term) => term.chapters.length > 0));
assert.ok(payload.timeline.some((term) => term.name === 'George W. Bush' && term.party === 'R' && term.chapters.length > 1));
const trumpIds = payload.timeline.filter((term) => term.name === 'Donald Trump').map((term) => term.id);
assert.equal(trumpIds.length, 2);
assert.notEqual(trumpIds[0], trumpIds[1]);
for (const term of payload.timeline) {
  const last = term.path.at(-1);
  assert.ok(last, term.name);
  assert.ok(Math.abs((last.level - 1) * 100 - term.totalPct) < 0.06, `${term.name} path ${last.level} vs ${term.totalPct}`);
  assert.ok(term.sectors.some((row) => row.id === 'XLV' && typeof row.excessTotalPct === 'number'));
  let cursor = term.start;
  for (const chapter of term.chapters) {
    assert.equal(chapter.start, cursor, term.name);
    cursor = chapter.measureEnd;
    const chapterLast = chapter.path.at(-1);
    assert.ok(Math.abs((chapterLast.level - 1) * 100 - chapter.totalPct) < 0.06, chapter.id);
  }
  assert.equal(cursor, term.open ? nextDay(term.end) : term.end);
}
const fullLast = payload.path.at(-1);
assert.ok(fullLast && fullLast.t === end);
const sampleRows = [
  { label: 'Health care', offices: { president: { D: { annPct: 1 }, R: { annPct: 9 }, gapAnnPct: -8 } } },
  { label: 'Energy', offices: { president: { D: { annPct: 4 }, R: { annPct: 2 }, gapAnnPct: 2 } } },
  { label: 'Utilities', offices: { president: { D: { annPct: null }, R: { annPct: 3 }, gapAnnPct: null } } },
];
assert.deepEqual(sortPartyRows(sampleRows, { key: 'D', dir: 'desc', office: 'president' }).map((row) => row.label), ['Energy', 'Health care', 'Utilities']);
assert.deepEqual(sortPartyRows(sampleRows, { key: 'D', dir: 'asc', office: 'president' }).map((row) => row.label), ['Health care', 'Energy', 'Utilities']);
assert.deepEqual(sortPartyRows(sampleRows, { key: 'name', dir: 'asc', office: 'president' }).map((row) => row.label), ['Energy', 'Health care', 'Utilities']);
assert.deepEqual(sortPartyRows(sampleRows, { key: 'name', dir: 'desc', office: 'president' }).map((row) => row.label), ['Utilities', 'Health care', 'Energy']);
assert.ok(payload.timeline.some((term) => term.name === 'Donald Trump' && term.open));
assert.equal(payload.timeline.filter((term) => term.name === 'Donald Trump').length, 2);
assert.ok(payload.periods.some((row) => row.office === 'senate' && row.start === '2001-06-06' && row.party === 'D'));
assert.equal(payload.stale, undefined);

const lateSpy = bars('2001-01-19', end, (t) => t >= '2010-01-01' && t < '2011-01-01' ? 1.01 : 1);
const lateSector = bars('2018-06-19', end, () => 1.001);
const late = buildPartyTracker({
  series: { SPY: lateSpy, XLC: lateSector, XLV: spy, XLE: spy },
  builtAtIso: '2026-10-28T12:00:00.000Z',
});
const comms = late.rows.find((row) => row.id === 'XLC');
assert.equal(comms.partial, true);
assert.ok(Math.abs(comms.offices.president.D.annPct - demAnn) < 1, `late sector annualized ${comms.offices.president.D.annPct}`);
assert.ok(comms.offices.president.D.excessAnnPct > 30, `late sector excess ${comms.offices.president.D.excessAnnPct}`);
assert.ok(late.offices.find((office) => office.id === 'president').parties.D.annPct > 5);

const carried = await refreshPartyTracker({
  prior: payload,
  builtAtIso: '2026-10-28T13:00:00.000Z',
  fetchSeries: async () => { throw new Error('down'); },
});
assert.equal(carried.carriedForward, true);
assert.equal(carried.builtAtIso, '2026-10-28T13:00:00.000Z');
assert.equal(carried.asOf, payload.asOf);
assert.equal(carried.stale, undefined);
assert.equal(carried.errors.length, 15);

const partialFetch = await refreshPartyTracker({
  prior: payload,
  builtAtIso: '2026-10-28T13:00:00.000Z',
  fetchSeries: async (id) => {
    if (id === 'XLV') throw new Error('missing health care');
    return id === 'SPY' ? spy : id === 'XLE' ? spy : [];
  },
});
assert.equal(partialFetch.carriedForward, undefined);
assert.ok(partialFetch.errors.some((item) => item.id === 'XLV'));
assert.equal(partialFetch.rows.some((row) => row.id === 'XLV'), false);

assert.equal(isPremiumKey('party-tracker.json'), true);
assert.deepEqual(roleClaimForKey('party-tracker.json'), ['tr', 'tp']);

const sources = await Promise.all([
  readFile(new URL('./render/app-js.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./render/site-map.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./render/html.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./build.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./verify-data-freshness.mjs', import.meta.url), 'utf8'),
]);
for (const source of sources) assert.match(source, /party-tracker/);
assert.match(sources[0], /'party-tracker':1/);
assert.match(sources[1], /id: 'party-tracker'/);

console.log('party tracker smoke ok');
