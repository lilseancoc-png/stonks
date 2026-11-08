// QC of builds #1-#22: the freshness banner's 36-hour "Stale data" warning
// fired every weekend (a Friday 16:10 ET build turns 36 hours old at
// Saturday 04:10 ET) and stayed up until Monday's first build, though no
// session had been missed. It now also needs a missed trading session.
// Runs the browser functions from the generated app.js with a fixed clock.
import assert from 'node:assert/strict';
import { renderAppJs } from './render/app-js.mjs';
import { closureTables } from '../lib/us-equity-calendar.mjs';

const js = renderAppJs();
const grab = (name) => {
  const start = js.indexOf(`function ${name}(`);
  assert(start >= 0, name + ' is in app.js');
  let depth = 0, i = js.indexOf('{', start);
  for (; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}' && --depth === 0) break;
  }
  return js.slice(start, i + 1);
};
const src = ['marketEtDateParts', 'isMarketSessionDay', 'marketSessionGap', 'etNowParts', 'freshnessMissedSessions'].map(grab).join('\n');
const RealDate = Date;
const at = (nowIso) => {
  const nowMs = RealDate.parse(nowIso);
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(nowMs); }
    static now() { return nowMs; }
  }
  return new Function('Date', 'MARKET_HOLIDAYS', `${src}; return freshnessMissedSessions;`)(FakeDate, closureTables().holidays);
};
const missed = (buildIso, nowIso) => at(nowIso)(buildIso);

const friClose = '2026-11-06T21:10:00Z'; // Fri Nov 6, 16:10 ET
assert.equal(missed(friClose, '2026-11-07T15:00:00Z'), 0, 'Saturday');
assert.equal(missed(friClose, '2026-11-08T11:42:00Z'), 0, 'Sunday morning, when the banner said stale');
assert.equal(missed(friClose, '2026-11-09T14:30:00Z'), 0, 'Monday 09:30 ET, before the first build is due');
assert.equal(missed(friClose, '2026-11-09T18:00:00Z'), 1, 'Monday 13:00 ET with no Monday build');
assert.equal(missed(friClose, '2026-11-11T18:00:00Z'), 3, 'Wednesday afternoon: Mon, Tue, Wed missed');
// Thanksgiving: Thu Nov 26, 2026 is a full closure.
const wedClose = '2026-11-25T21:10:00Z';
assert.equal(missed(wedClose, '2026-11-26T20:00:00Z'), 0, 'Thanksgiving Day');
assert.equal(missed(wedClose, '2026-11-27T15:00:00Z'), 0, 'Friday morning after Thanksgiving');
assert.equal(missed(wedClose, '2026-11-27T19:00:00Z'), 1, 'Friday afternoon with no build');

// The banner itself gates both warnings on it.
const banner = grab('renderFreshness');
assert(/ageH > 36 && missedAny/.test(banner));
assert(/ageH > 24\*7 && missedAny/.test(banner));

console.log('freshness banner smoke ok');
