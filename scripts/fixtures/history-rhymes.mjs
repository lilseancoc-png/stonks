// Synthetic, roughly true-to-shape inputs for the Booms & busts page, used by
// scripts/history-rhymes-browser.mjs. Index and FRED paths are drawn through a
// few approximate historical anchor points with a seeded wiggle, and the stock
// fundamentals are round illustrative numbers, not live data. Nothing here is
// fetched.
import { buildHistoryRhymes, buildHistoryRhymesOwner } from '../../lib/history-rhymes.mjs';

const DAY = 86400000;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Log-linear path through [date, value] anchors, one row per step (days),
// weekdays only for daily steps, with a small seeded wiggle.
function anchored(anchors, { step = 1, wiggle = 0.01, seed = 1, key = 'v', weekdays = step === 1 } = {}) {
  const r = rng(seed), out = [];
  const pts = anchors.map(([d, v]) => [Date.parse(d + 'T00:00:00Z'), v]);
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [t0, v0] = pts[i], [t1, v1] = pts[i + 1];
    for (let t = t0; t < t1; t += step * DAY) {
      const dow = new Date(t).getUTCDay();
      if (weekdays && (dow === 0 || dow === 6)) continue;
      const f = (t - t0) / (t1 - t0);
      const base = Math.exp(Math.log(v0) + f * (Math.log(v1) - Math.log(v0)));
      out.push({ t: new Date(t).toISOString().slice(0, 10), [key]: +(base * (1 + (r() - 0.5) * 2 * wiggle)).toFixed(4) });
    }
  }
  const [tl, vl] = pts.at(-1);
  out.push({ t: new Date(tl).toISOString().slice(0, 10), [key]: vl });
  return out;
}

export const HISTORY_RHYMES_FIXTURE_TIME = '2026-11-12T21:10:00.000Z';

export function historyRhymesFixture() {
  const builtAtIso = HISTORY_RHYMES_FIXTURE_TIME;
  const ixic = anchored([
    ['1994-01-03', 770], ['1995-08-09', 1005], ['1998-10-08', 1420], ['2000-03-10', 5048], ['2001-04-04', 1638], ['2001-05-22', 2313], ['2002-10-09', 1114],
    ['2007-10-31', 2859], ['2009-03-09', 1268], ['2015-03-02', 5008], ['2020-02-19', 9817], ['2020-03-23', 6860], ['2021-11-19', 16057],
    ['2022-11-30', 11468], ['2022-12-28', 10213], ['2024-07-10', 18647], ['2025-04-08', 15268], ['2025-10-29', 23950], ['2026-06-30', 22600], ['2026-11-12', 23400],
  ], { wiggle: 0.012, seed: 7, key: 'c' });
  const gspc = anchored([
    ['1994-01-03', 466], ['2000-03-24', 1527], ['2002-10-09', 777], ['2007-10-09', 1565], ['2009-03-09', 677], ['2020-02-19', 3386], ['2020-03-23', 2237],
    ['2022-01-03', 4797], ['2022-10-12', 3577], ['2025-04-08', 4983], ['2026-11-12', 6800],
  ], { wiggle: 0.008, seed: 11, key: 'c' });
  const fred = {
    BAA10Y: anchored([['1986-01-02', 2.1], ['1998-10-01', 2.4], ['2001-10-01', 3.2], ['2002-10-10', 3.6], ['2007-06-01', 1.6], ['2008-12-05', 6.1], ['2009-12-01', 2.7], ['2016-02-11', 3.6], ['2020-03-23', 4.3], ['2021-06-01', 1.7], ['2025-04-08', 2.1], ['2026-08-12', 1.55], ['2026-11-11', 1.72]], { wiggle: 0.02, seed: 3 }),
    BAMLH0A0HYM2: anchored([['2023-11-13', 4.2], ['2024-11-11', 2.7], ['2025-04-08', 4.5], ['2025-12-31', 2.9], ['2026-08-12', 2.85], ['2026-11-11', 3.3]], { wiggle: 0.02, seed: 4 }),
    BAMLC0A0CM: anchored([['2023-11-13', 1.2], ['2025-04-08', 1.1], ['2026-11-11', 0.82]], { wiggle: 0.02, seed: 5 }),
    USSTHPI: anchored([['1975-01-01', 60], ['1980-01-01', 100], ['1990-01-01', 167], ['2000-01-01', 237], ['2007-01-01', 383], ['2011-10-01', 300], ['2020-01-01', 465], ['2022-07-01', 640], ['2026-07-01', 720]], { step: 91, wiggle: 0.002, seed: 6 }),
    MORTGAGE30US: anchored([['1971-04-02', 7.3], ['1981-10-09', 18.6], ['1993-10-15', 6.8], ['2000-05-19', 8.6], ['2003-06-13', 5.2], ['2006-07-21', 6.8], ['2012-11-21', 3.3], ['2021-01-07', 2.65], ['2023-10-26', 7.8], ['2026-11-12', 6.2]], { step: 7, wiggle: 0.01, seed: 8 }),
    DRSFRMACBS: anchored([['1991-01-01', 3.1], ['2005-07-01', 1.5], ['2010-01-01', 11.3], ['2019-10-01', 2.4], ['2026-07-01', 1.8]], { step: 91, wiggle: 0.01, seed: 9 }),
    PRCMUCONS: anchored([['1993-01-01', 9500], ['2000-12-01', 29000], ['2003-06-01', 14500], ['2008-06-01', 22000], ['2015-01-01', 17000], ['2026-09-01', 26000]], { step: 30, wiggle: 0.03, seed: 10 }),
  };
  const aiCapex = { builtAtIso: '2026-11-11T21:00:00Z', totals: { revenue: { capexYoyPct: 58, yoyPct: 14, count: 7, capexToRevenueTtmPct: 24, capexToRevenueFyPct: 22, capexToRevenueFyPriorPct: 16 } } };
  const accelerators = { builtAtIso: '2026-11-06T16:35:00Z', benchmarks: [{ modelId: 'h100', currentMedian: 2.08, change30dPct: -3.1, compositeHistory: anchored([['2026-03-06', 2.42], ['2026-11-06', 2.08]], { step: 7, wiggle: 0.01, seed: 12 }).map((r) => ({ d: r.t, p: r.v })) }] };
  const months = [];
  for (let i = 0; i < 18; i += 1) {
    const d = new Date(Date.UTC(2025, 4 + i, 1));
    months.push({ m: d.toISOString().slice(0, 7), ig: 120 + (i >= 15 ? 55 : i * 2), hy: 24 + (i % 3), cv: 9 + (i >= 15 ? 4 : 0) });
  }
  const ipoCredit = { raises: { bonds: { latest: { m: months.at(-1).m }, months } } };
  const r = rng(99);
  const bars = (spot, vol, n = 260) => {
    const out = []; let p = spot;
    for (let i = 0; i < n; i += 1) { out.unshift({ c: +p.toFixed(2) }); p = p / Math.exp((r() - 0.5) * 2 * vol * Math.sqrt(3 / 252)); }
    return out;
  };
  const stock = (sym, spot, vol, f) => ({ symbol: sym, spot, _bars: bars(spot, vol), fundamentals: { quoteType: 'EQUITY', ...f } });
  const B = 1e9;
  const chains = {
    CRWV: stock('CRWV', 82, 0.95, { marketCap: 42 * B, totalDebt: 29 * B, totalCash: 3 * B, fiftyTwoWeekHigh: 187, operatingCashFlow: 3.5 * B, freeCashFlow: -9 * B, capitalAllocation: { capexTtm: -12.5 * B } }),
    ORCL: stock('ORCL', 215, 0.48, { marketCap: 610 * B, totalDebt: 112 * B, totalCash: 11 * B, fiftyTwoWeekHigh: 345, operatingCashFlow: 21 * B, freeCashFlow: -11 * B, capitalAllocation: { capexTtm: -32 * B }, creditRating: { agency: 'S&P', rating: 'BBB-', outlook: 'stable', asOf: '2026-07' } }),
    MSFT: stock('MSFT', 505, 0.24, { marketCap: 3750 * B, totalDebt: 60 * B, totalCash: 95 * B, fiftyTwoWeekHigh: 555, operatingCashFlow: 150 * B, freeCashFlow: 72 * B, capitalAllocation: { capexTtm: -78 * B } }),
    GOOGL: stock('GOOGL', 280, 0.29, { marketCap: 3400 * B, totalDebt: 32 * B, totalCash: 98 * B, fiftyTwoWeekHigh: 300, operatingCashFlow: 145 * B, freeCashFlow: 65 * B, capitalAllocation: { capexTtm: -80 * B } }),
    AMZN: stock('AMZN', 235, 0.31, { marketCap: 2500 * B, totalDebt: 135 * B, totalCash: 95 * B, fiftyTwoWeekHigh: 258, operatingCashFlow: 125 * B, freeCashFlow: 15 * B, capitalAllocation: { capexTtm: -110 * B } }),
    META: stock('META', 640, 0.36, { marketCap: 1610 * B, totalDebt: 49 * B, totalCash: 45 * B, fiftyTwoWeekHigh: 796, operatingCashFlow: 108 * B, freeCashFlow: 38 * B, capitalAllocation: { capexTtm: -70 * B } }),
    NVDA: stock('NVDA', 188, 0.46, { marketCap: 4580 * B, totalDebt: 10 * B, totalCash: 56 * B, fiftyTwoWeekHigh: 212, operatingCashFlow: 92 * B, freeCashFlow: 84 * B, capitalAllocation: { capexTtm: -6 * B } }),
    AVGO: stock('AVGO', 340, 0.5, { marketCap: 1600 * B, totalDebt: 66 * B, totalCash: 10 * B, fiftyTwoWeekHigh: 386, operatingCashFlow: 27 * B, freeCashFlow: 26 * B, capitalAllocation: { capexTtm: -0.6 * B } }),
    AMD: stock('AMD', 225, 0.6, { marketCap: 365 * B, totalDebt: 3 * B, totalCash: 6 * B, fiftyTwoWeekHigh: 267, operatingCashFlow: 6 * B, freeCashFlow: 4.5 * B, capitalAllocation: { capexTtm: -1 * B } }),
    VRT: stock('VRT', 170, 0.55, { marketCap: 65 * B, totalDebt: 3 * B, totalCash: 1.8 * B, fiftyTwoWeekHigh: 202, operatingCashFlow: 1.9 * B, freeCashFlow: 1.6 * B, capitalAllocation: { capexTtm: -0.25 * B } }),
    VST: stock('VST', 172, 0.5, { marketCap: 58 * B, totalDebt: 17 * B, totalCash: 0.6 * B, fiftyTwoWeekHigh: 219, operatingCashFlow: 4.5 * B, freeCashFlow: 2.4 * B, capitalAllocation: { capexTtm: -2.1 * B } }),
    PLTR: stock('PLTR', 178, 0.62, { marketCap: 420 * B, totalDebt: 0.2 * B, totalCash: 6 * B, fiftyTwoWeekHigh: 207, operatingCashFlow: 2 * B, freeCashFlow: 1.9 * B, capitalAllocation: { capexTtm: -0.05 * B } }),
    AAPL: stock('AAPL', 272, 0.26, { marketCap: 4030 * B, totalDebt: 98 * B, totalCash: 55 * B, fiftyTwoWeekHigh: 288, operatingCashFlow: 112 * B, freeCashFlow: 99 * B, capitalAllocation: { capexTtm: -12 * B } }),
    TSLA: stock('TSLA', 430, 0.6, { marketCap: 1430 * B, totalDebt: 13 * B, totalCash: 41 * B, fiftyTwoWeekHigh: 488, operatingCashFlow: 15 * B, freeCashFlow: 5 * B, capitalAllocation: { capexTtm: -10 * B } }),
    NKE: stock('NKE', 64, 0.38, { marketCap: 95 * B, totalDebt: 11 * B, totalCash: 8 * B, fiftyTwoWeekHigh: 82, operatingCashFlow: 3 * B, freeCashFlow: 2.5 * B, capitalAllocation: { capexTtm: -0.5 * B } }),
    SMH: { symbol: 'SMH', spot: 342, fundamentals: { quoteType: 'ETF', fiftyTwoWeekHigh: 398 } },
    JPM: stock('JPM', 305, 0.22, { marketCap: 840 * B, totalDebt: 520 * B, fiftyTwoWeekHigh: 330 }),
  };
  const series = { '^IXIC': ixic, '^GSPC': gspc };
  const rhymes = buildHistoryRhymes({ builtAtIso, series, fred, aiCapex, accelerators, ipoCredit, chains });
  const owner = buildHistoryRhymesOwner({ builtAtIso, rhymes, chains, r: 0.039, skip: (s) => s === 'JPM' });
  return { rhymes, owner };
}
