// Offline checks for the chart data added in the UI overhaul: the Rates
// page's yield curve and daily yields (lib/rates-history.mjs + the Treasury
// feed parser), the Historical Data event-path band, and a guard against
// regex escapes that a template literal would silently drop in app.js.
// Synthetic numbers only; no network and no AI.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRatesHistory } from '../lib/rates-history.mjs';
import { eventPathBand } from '../lib/historical-events.mjs';
import { parseTreasuryParXml, TREASURY_TENORS } from './build.mjs';

// --- Treasury par-yield feed -------------------------------------------
const entry = (date, base, skip = []) => '<entry><content><m:properties>' +
  `<d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE>` +
  TREASURY_TENORS.map(([label, tag, years], i) => skip.includes(label) ? `<d:${tag} m:null="true"></d:${tag}>` : `<d:${tag} m:type="Edm.Double">${(base + years * 0.02 + i * 0.001).toFixed(3)}</d:${tag}>`).join('') +
  '</m:properties></content></entry>';
const xml = '<feed>' + entry('2026-11-03', 3.9) + entry('2026-11-04', 3.95, ['4M', '20Y']) + '<entry><content>no date</content></entry></feed>';
const parsed = parseTreasuryParXml(xml);
assert.equal(parsed.length, 2, 'two dated rows; the undated entry is skipped');
assert.equal(parsed[0].date, '2026-11-03');
assert.equal(Object.keys(parsed[0].curve).length, 13, 'all 13 tenors read');
assert.equal(Object.keys(parsed[1].curve).length, 11, 'null tenors are left out, not zero');
assert.equal(parsed[1].value, parsed[1].curve['2Y'], '2Y stays the row value for the 2Y tile');
assert.equal(parsed[1].value10y, parsed[1].curve['10Y']);
assert.equal(parseTreasuryParXml('').length, 0);

// --- Rates history ------------------------------------------------------
const DAY = 86400000;
function treasuryRows(days) {
  const rows = [];
  const end = Date.parse('2026-11-04T00:00:00Z');
  for (let i = days - 1; i >= 0; i--) {
    const t = end - i * DAY, dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const date = new Date(t).toISOString().slice(0, 10);
    const curve = {};
    TREASURY_TENORS.forEach(([label, , years]) => { curve[label] = 4 + years * 0.01 - i * 0.001; });
    rows.push({ date, curve });
  }
  return rows;
}
const tre = treasuryRows(400);
const dxyBars = tre.map((r, i) => ({ t: r.date, c: 100 + i * 0.01 }));
const built = buildRatesHistory({ treasury: tre.concat([tre[tre.length - 1]]), tenors: TREASURY_TENORS, dxyBars, builtAtIso: '2026-11-04T21:00:00Z' });
assert.ok(built && built.curve && built.daily, 'curve and daily series built');
assert.equal(built.curve.tenors.length, 13);
assert.deepEqual(built.curve.lines.map(l => l.key), ['today', 'month', 'year']);
assert.equal(built.curve.lines[0].date, '2026-11-04');
assert.ok(built.curve.lines[1].date <= '2026-10-05' && built.curve.lines[1].date >= '2026-09-25', '"1 month ago" is the last row on or before 30 days back');
assert.ok(built.curve.lines[2].date <= '2025-11-04', '"1 year ago" is on or before 365 days back');
assert.equal(built.daily.dates.length, 260, 'daily series keeps the last 260 sessions');
assert.equal(new Set(built.daily.dates).size, built.daily.dates.length, 'duplicate dates collapse');
assert.ok(built.daily.dates.every((d, i, a) => !i || a[i - 1] < d), 'dates ascend');
assert.equal(built.daily.twoY.length, 260);
assert.ok(built.daily.dxy.every(v => v != null), 'dollar index lines up with the Treasury dates');

// A short feed: the year-ago line is dropped rather than invented.
const short = buildRatesHistory({ treasury: treasuryRows(50), tenors: TREASURY_TENORS });
assert.deepEqual(short.curve.lines.map(l => l.key), ['today', 'month']);

// A failed feed keeps the last good copy, marked stale; nothing at all returns the prior.
const carried = buildRatesHistory({ treasury: [], tenors: TREASURY_TENORS, prior: built });
assert.equal(carried.curve.stale, true);
assert.equal(carried.daily.stale, true);
assert.equal(carried.curve.lines.length, 3);
assert.equal(buildRatesHistory({ treasury: [], tenors: TREASURY_TENORS }), null);
// Fewer than four tenors is not a curve.
const thin = buildRatesHistory({ treasury: [{ date: '2026-11-04', curve: { '2Y': 4, '10Y': 4.2 } }], tenors: TREASURY_TENORS });
assert.equal(thin, null);

// --- Event path band ------------------------------------------------------
const paths = [0, 1, 2, 3, 4].map(k => ({ path: Array.from({ length: 61 }, (_, d) => d * (k - 2) * 0.1) }));
const band = eventPathBand(paths);
assert.equal(band.sessions, 60);
assert.equal(band.p50[0], 0);
assert.ok(band.p25[60] < band.p50[60] && band.p50[60] < band.p75[60], 'quartiles ordered');
assert.equal(band.n[60], 5);
assert.equal(eventPathBand(paths.slice(0, 2)), null, 'fewer than three episodes gives no band');
const ragged = eventPathBand([{ path: [0, 1, 2] }, { path: [0, 2, 3] }, { path: [0, 3] }]);
assert.equal(ragged.p50[2], null, 'a step with fewer than three episodes is left blank');

// --- Template-literal escapes ------------------------------------------------
// app.js and its sibling scripts are template literals: a single backslash
// before d, s, w, b, ., (, ), [, ], /, +, * or ? is dropped when the page is
// generated, so a regex like /\d+/ silently becomes /d+/. They must be written
// doubled (\\d). Factory modules pasted in with toString() are exempt.
const LOST = /(?<!\\)\\[dswDSWb.()[\]/+*?]/;
for (const file of ['app-js', 'chart-kit-js', 'export-js', 'recovery-js', 'split-view-js', 'stock-page-js', 'wayfinding-js']) {
  const lines = readFileSync(new URL(`./render/${file}.mjs`, import.meta.url), 'utf8').split('\n');
  const bad = lines.map((l, i) => LOST.test(l) ? `${file}.mjs:${i + 1}: ${l.trim().slice(0, 100)}` : null).filter(Boolean);
  assert.deepEqual(bad, [], 'single-backslash escapes in a template literal');
}

console.log('charts-smoke: ok');
