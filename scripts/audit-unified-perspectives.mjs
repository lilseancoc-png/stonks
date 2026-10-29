// Reproducible size/performance check, using fictional prices and financials.
// No provider, private-store, AI, or broker access. Prints a compact report.
import assert from 'node:assert/strict';
import { unifiedSignalFixture } from './fixtures/unified-signal.mjs';
import { buildUnifiedSignalEngine } from '../lib/unified-signal.mjs';
import { sessionForDate } from '../lib/us-equity-calendar.mjs';
import { unifiedSignalDisplayFactory } from '../lib/unified-signal-display.mjs';

const fixture = unifiedSignalFixture(), template = structuredClone(fixture), dates = [];
for (let ms = Date.parse('2024-01-01T12:00:00Z'); ms <= Date.parse('2026-10-22T12:00:00Z'); ms += 86400000) {
  const day = new Date(ms).toISOString().slice(0, 10), session = sessionForDate(day);
  if (session ? session.open : ![0, 6].includes(new Date(ms).getUTCDay())) dates.push(day);
}
const bars = dates.slice(-520).map((t, i) => {
  const c = 90 + i * .03 + Math.sin(i / 4) * 2;
  return { t, c, h: c + .777777777777, l: c - .66666666666, v: 10003261 + i * 20 };
});
for (const [offset, c] of [105, 103, 101, 97, 100].entries()) Object.assign(bars[bars.length - 5 + offset], { c, h: c + .777777777777, l: c - .66666666666, v: offset === 4 ? 22000000 : 10000000 });
fixture.chains = {}; fixture.grades = {}; fixture.picks.picks = []; fixture.forecast.companies = [];
for (let i = 0; i < 85; i++) {
  const symbol = 'T' + String(i).padStart(4, '0');
  fixture.chains[symbol] = { ...template.chains.BULL, _bars: bars };
  fixture.grades[symbol] = template.grades.BULL;
  if (i < 20) fixture.forecast.companies.push({ ...template.forecast.companies[0], symbol });
}
const started = performance.now(), payload = buildUnifiedSignalEngine(fixture);
const snapshotBytes = Buffer.byteLength(JSON.stringify(payload));
assert(unifiedSignalDisplayFactory().valid(payload), 'Full fictional coverage must pass the real payload boundary');
assert.equal(payload.decisions.length, 85);
assert(payload.decisions.every(row => row.perspectives.trading.inputs.rows === 520));
assert(payload.decisions.filter(row => row.perspectives.investment.model).length === 20);
assert(snapshotBytes < 4000000, 'The fictional full-universe snapshot must fit the research publication budget');
console.log(JSON.stringify({ basis: 'Fictional 85-company universe with 520 full-precision OHLCV sessions per company and 20 supported financial records. Not a production coverage or investment-performance audit.',
  companies: payload.decisions.length, snapshotBytes, elapsedMs: Math.round(performance.now() - started),
  archivalEncoding: 'Lossless deflate-raw JSON; base64', output: 'passed' }, null, 2));
