// Synthetic inputs for the engine history checks (lib/engines-history.mjs):
// made-up S&P 500, VIX, 10-year, CPI and NFCI series, joined to the committed
// history-test aggregates. Nothing here is a real market reading.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnginesHistory, ENGINES_HISTORY_RESULTS } from '../../lib/engines-history.mjs';

export const ENGINES_HISTORY_FIXTURE_TIME = '2026-11-16T21:10:00.000Z';
const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

export function enginesHistoryResults() {
  return JSON.parse(readFileSync(resolve(ROOT, ENGINES_HISTORY_RESULTS), 'utf8'));
}

// Business days back from the fixture date, oldest first.
function days(n, end = '2026-11-16') {
  const out = [];
  for (let d = new Date(end + 'T12:00:00Z'); out.length < n; d = new Date(+d - 86400000)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

// opts: trend 'up' | 'down', vix level, cpi year-over-year %, nfci level,
// ten-year change over six months.
export function enginesHistoryInputs({ trend = 'up', vix = 18.4, cpiYoy = 2.9, nfci = -0.48, tenYearMove = 0.1 } = {}) {
  const d = days(320);
  const spx = d.map((t, i) => ({ t, c: trend === 'up' ? 5000 + i * 4 : 6500 - i * 4 }));
  const vixRows = d.map((t) => ({ t, v: vix }));
  // The move happens over the last ~six months (125 sessions).
  const dgs10 = d.map((t, i) => ({ t, v: 4.1 + tenYearMove * Math.max(0, (i - (d.length - 126)) / 125) }));
  const cpi = [];
  for (let m = 0; m < 16; m++) {
    const dt = new Date(Date.UTC(2025, 6 + m, 1)).toISOString().slice(0, 10);
    if (dt > '2026-10-01') break;
    cpi.push({ t: dt, v: 300 * Math.pow(1 + cpiYoy / 100, m / 12) });
  }
  const nfciRows = d.filter((_, i) => i % 5 === 0).map((t) => ({ t, v: nfci }));
  return { spx, vix: vixRows, dgs10, cpi, nfci: nfciRows };
}

export function enginesHistoryFixture(opts = {}) {
  return buildEnginesHistory({ builtAtIso: ENGINES_HISTORY_FIXTURE_TIME, results: enginesHistoryResults(), inputs: enginesHistoryInputs(opts) });
}
