// QC of builds #23-#72. (1) The flow scanner read every contract a day
// closer to expiry than it is: Yahoo's expiration epoch is 00:00 UTC of the
// expiry date (the evening before in New York), so a Monday expiry seen on a
// Friday showed 2 DTE and a next-day expiry 0 DTE. (2) The Grade card's
// realized-vol chip called premiums rich or cheap, which is the IV rule's
// call. (3) The OCC paste box rejected the official space-padded symbol.
// No network.
import assert from 'node:assert/strict';
import { flowDte } from './scan-unusual.mjs';
import { renderAppJs } from './render/app-js.mjs';

const at = (expDate, nowIso) => flowDte(Date.parse(`${expDate}T00:00:00Z`) / 1000, Date.parse(nowIso));

// 1. Calendar days from the scan's ET date (EST in November).
assert.equal(at('2026-11-09', '2026-11-06T19:00:45Z'), 3, 'Monday expiry seen Friday 14:00 ET');
assert.equal(at('2026-11-13', '2026-11-06T20:00:31Z'), 7, 'next Friday seen Friday');
assert.equal(at('2026-11-06', '2026-11-06T16:05:59Z'), 0, 'same-day expiry');
assert.equal(at('2026-11-06', '2026-11-05T16:00:35Z'), 1, 'next-day expiry is 1 DTE, not 0');
assert.equal(at('2026-11-06', '2026-11-07T02:00:00Z'), 0, '21:00 ET the same evening is still that ET day');
assert.equal(at('2026-07-17', '2026-07-16T13:45:00Z'), 1, 'summer time, 09:45 EDT');
assert.equal(at('2026-11-06', '2026-11-09T15:00:00Z'), 0, 'an expired contract never reads negative');

// 2 and 3. The browser pieces.
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
const parseOCC = new Function(`${grab('parseOCC')}; return parseOCC;`)();
assert.deepEqual(parseOCC('AAPL250117C00150000'), { root: 'AAPL', type: 'call', strike: 150, expiryISO: '2025-01-17' });
assert.deepEqual(parseOCC('AAPL  250117C00150000'), { root: 'AAPL', type: 'call', strike: 150, expiryISO: '2025-01-17' }, 'the padded OCC form');
assert.deepEqual(parseOCC(' spy   261120p00650500 '), { root: 'SPY', type: 'put', strike: 650.5, expiryISO: '2026-11-20' });
assert.equal(parseOCC('AAPL250230C00150000'), null, 'Feb 30 is not an expiration');
assert.equal(parseOCC('AAPL'), null);

const gradeVolRegime = new Function(`${grab('gradeVolRegime')}; return gradeVolRegime;`)();
for (const p of [10, 50, 90]) {
  const g = gradeVolRegime(p);
  assert.equal(g.cls, 'fair', 'realized vol is not a good/bad grade for the buyer');
  assert.equal(/premiums? (may be|likely)/.test(g.note), false, 'the chip leaves cheap/rich to the IV rule');
}
assert.equal(gradeVolRegime(90).label, 'Elevated');
assert.equal(js.includes('net-new positioning, not closing existing OI'), false, 'vol over OI shows some opening, not all');

console.log('flow dte smoke ok');
