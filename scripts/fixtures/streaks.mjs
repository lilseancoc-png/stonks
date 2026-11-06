// Synthetic runs with deliberately different active and ended metrics.
export function streaksFixture() {
  const tickers = Array.from({length: 24}, (_, i) => ({
    symbol: 'SN' + String(i).padStart(2, '0'), lastClose: 50 + i,
    current: {color: i % 2 ? 'green' : 'red', days: 2, sameDays: 2, windowDays: 2,
      cumulativePct: i % 2 ? 2 : -2, volumeRatio: 0.7, tolerancePct: 0, counterDays: 0},
    lastEnded: {color: i % 2 ? 'red' : 'green', days: 3 + i % 9, sameDays: 3 + i % 9,
      windowDays: 5 + i % 9, cumulativePct: (i % 2 ? -1 : 1) * (5 + i),
      sessionsAgo: i % 3, reversalPct: i % 2 ? 3 : -3, brokeBy: 'big counter day',
      volumeRatio: i === 23 ? null : 1 + i / 10, tolerancePct: i / 100, toleranceBreakPct: 2},
    maContext: {asOf: '2026-10-27', close: 50 + i, nearestPeriod: 20, levels: [
      {period:20, value:49+i, distancePct:1, slopePct:0.5, slope:'rising', event:'reclaimed'},
      {period:50, value:45+i, distancePct:5, slopePct:-0.5, slope:'falling', event:null},
      {period:100, value:40+i, distancePct:10, slopePct:0, slope:'flat', event:null},
      {period:200, value:35+i, distancePct:20, slopePct:0.8, slope:'rising', event:null}]},
    history: [{date: '2026-10-27', changePct: 1, close: 50 + i}, {date: '2026-10-26', changePct: 1, close: 49 + i}],
  }));
  return {builtAtIso: '2026-10-28T00:00:00.000Z', tickers};
}

// The same desk with four active 4-day runs, one per trend read, so the
// read chips, the "what a run usually means" tiles and the read filter have
// something to show.
export function streaksReadsFixture() {
  const base = streaksFixture();
  const reads = [['SN01', 'green', 'uptrend-run', 1, 1], ['SN03', 'green', 'bear-rally', -1, -1],
    ['SN04', 'red', 'downtrend-slide', -1, -1], ['SN06', 'red', 'uptrend-dip', 0, 1]];
  for (const [sym, color, kind, vote, trend] of reads) {
    const t = base.tickers.find((x) => x.symbol === sym);
    t.current = {...t.current, color, days: 4, sameDays: 4, windowDays: 4,
      cumulativePct: color === 'green' ? 4.2 : -4.2, volumeTrend: kind === 'uptrend-run' ? 'rising' : 'steady'};
    t.trendRead = {kind, vote, trend};
  }
  return base;
}
