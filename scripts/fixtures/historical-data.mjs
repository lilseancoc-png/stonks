// Deliberately synthetic close series for deterministic UI/math checks.
// Not a record of actual market performance.
import { isHistoricalTradingDate } from '../../lib/historical-market-calendar.mjs';
export function historicalFixtureBars() {
  const rows = [], end = Date.parse('2026-10-24T00:00:00Z'); let price = 100;
  for (let t = Date.parse('1999-01-01T00:00:00Z'), i = 0; t < end; t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (!isHistoricalTradingDate(day)) continue;
    price *= 1 + .00015 + Math.sin(++i * .17) * .006 + Math.cos(i * .013) * .001;
    rows.push({ t: day, c: price });
  }
  return rows;
}

// Synthetic long histories for the Events & analogs preview: S&P 500-like
// since 1950, Nasdaq-like since 1971 and a few single names, with a handful of
// shocks so every study renders. Not a record of actual market performance.
export function historicalEventFixture(endDay = '2026-10-23') {
  const make = (from, seed, shocks = {}) => {
    const rows = []; let c = 100, i = 0;
    for (let t = Date.parse(from + 'T00:00:00Z'), end = Date.parse(endDay + 'T00:00:00Z'); t <= end; t += 86400000) {
      const day = new Date(t).toISOString().slice(0, 10), dow = new Date(t).getUTCDay();
      if (day >= '1990-01-01' ? !isHistoricalTradingDate(day) : dow === 0 || dow === 6) continue;
      c *= 1 + .0003 + Math.sin(++i * seed) * .008 + Math.cos(i * .011) * .001;
      if (shocks[day] != null) c *= 1 + shocks[day] / 100;
      rows.push({ t: day, c });
    }
    return rows;
  };
  const series = {
    '^GSPC': make('1950-01-03', .19, { '1987-10-19': -20, '2008-10-15': -9, '2020-03-16': -12, '2026-10-23': -1.6 }),
    '^IXIC': make('1971-02-05', .23, { '2000-04-14': -9, '2022-05-05': -5, '2024-08-05': -4.5, '2026-10-21': -4.4 }),
    AAPL: make('1990-01-02', .29), KRE: make('2006-06-01', .17), GME: make('2002-02-13', .31, { '2021-01-13': 57 }),
  };
  series.SPY = series['^GSPC'].filter(r => r.t >= '1993-01-29');
  series.GLD = make('2004-11-18', .13);
  const level = (from, v, s) => make(from, s).map((r, k) => ({ t: r.t, v: v + Math.sin(k * .05) * v * .1 }));
  const context = { VIXCLS: level('1990-01-02', 19, .07), DCOILWTICO: level('1986-01-02', 60, .09), DGS10: level('1962-01-02', 4, .05), STLFSI4: level('1994-01-07', .1, .04) };
  const inputs = { headlineHits: { tariffs: [{ title: 'Synthetic headline: new tariffs announced on imported chips', date: endDay + 'T15:00:00.000Z' }] }, squeezes: [{ sym: 'XYZ', chPct: 21.4, rvol: 5.2 }] };
  return { series, context, inputs, releases: { cpi: { dates: ['2025-01-15', '2025-02-12', '2025-03-12', '2026-11-10'] }, jobs: { dates: ['2025-01-10', '2025-02-07', '2026-11-06'] } } };
}
