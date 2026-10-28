import { streaksFixture } from './streaks.mjs';
import { patternLabFixture } from './pattern-lab.mjs';
import { OVERNIGHT_TONE } from '../../lib/overnight-tone.mjs';
import { parseEdgarForm4Xml, buildCommoditiesPayload, buildRamPricesPayload } from '../build.mjs';

export const BRIEF_FIXTURE_NOW = new Date('2026-10-27T19:30:00Z');

export function briefPublicFixture() {
  const builtAtIso = BRIEF_FIXTURE_NOW.toISOString();
  const stamp = (p) => ({ ...p, builtAtIso });
  const streaks = stamp(streaksFixture());
  streaks.tickers[0].current = { color: 'green', sameDays: 6, windowDays: 8, cumulativePct: 12, volumeRatio: 1.4 };
  const pattern = stamp(patternLabFixture());
  const tone = OVERNIGHT_TONE.scoreTone({
    'ES=F': { movePct: 0.9, sigmaPct: 1, fresh: true },
    'NQ=F': { movePct: 1.2, sigmaPct: 1, fresh: true },
    '^VIX': { movePct: -3, sigmaPct: 2, fresh: true },
    'AUDJPY=X': { movePct: 0.8, sigmaPct: 1, fresh: true },
    'HG=F': { movePct: 1, sigmaPct: 1, fresh: true },
  });
  const insiders = parseEdgarForm4Xml(`<ownershipDocument><issuer><issuerTradingSymbol>ACME</issuerTradingSymbol></issuer><reportingOwner><rptOwnerName>Example Officer</rptOwnerName></reportingOwner><nonDerivativeTable><nonDerivativeTransaction><transactionDate><value>2026-10-26</value></transactionDate><transactionCoding><transactionCode>P</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>20000</value></transactionShares><transactionPricePerShare><value>100</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`);
  return {
    overnight: stamp({ tone, preopen: { today: { date: '2026-10-27', cutoffIso: '2026-10-27T13:05:00Z', tone, session: OVERNIGHT_TONE.sessionCall(tone, null) } } }),
    'ma-tracker': stamp({ summary: { topAbove: [{ symbol: 'ACME', period: 50, direction: 'above', absDistancePct: 0.8, score: 82, status: 'likely' }] } }),
    buyouts: stamp({ deals: [{ targetTicker: 'EXM', stage: 'active_talks', statusLabel: 'Reported talks', lastUpdateAtIso: builtAtIso, coverageCount: 3 }] }),
    earnings: stamp({ upcoming: [{ sym: 'ACME', date: '2026-10-28', session: 'PM', pre10Pct: 12, impliedMovePct: 9 }] }),
    calls: stamp({ calls: { ACME: { headline: 'Raised demand outlook', callDate: '2026-10-26', mgmtTone: 'confident', stance: 'hawkish', analystTone: 'skeptical' } } }),
    spillover: stamp({ upcoming: [{ driver: 'ACME', daysUntil: 1, followers: [{ follower: 'EXM', pairQualified: true }] }] }),
    'index-calendar': stamp({ days: [{ date: '2026-10-27', spy: { session: { firstHourComplete: true, firstHourRetPct: 0.9, firstHourRvol: 1.6 } } }] }),
    heatmap: stamp({ sectorRotation: { alerts: [{ sector: 'Technology', days: 3, direction: 'green', pct: 0.8 }] } }),
    'pattern-lab': pattern,
    volume: stamp({ tickers: [{ symbol: 'ACME', eod: { ratio: 3.2 } }] }),
    oi: stamp({ tickers: [{ symbol: 'ACME', flagged: true, score: 10, reasons: [{ label: 'Open-interest concentration' }] }] }),
    streaks,
    commodities: buildCommoditiesPayload({ builtAtIso, fetched: { gold: { symbol: 'GC=F', series: [{ d: '2026-10-26', v: 100 }, { d: '2026-10-27', v: 104 }] } } }),
    raises: stamp({ events: [
      { ticker: 'ACME', kind: 'equity', headline: 'Announces a share offering', headlineAmount: '$2B', publishedAt: '2026-10-27T12:00:00Z' },
      { ticker: 'EXM', kind: 'buyback', headline: 'Authorizes share repurchases', headlineAmount: '$1B', publishedAt: '2026-10-26T12:00:00Z' },
    ] }),
    credit: stamp({ raises: { bonds: { latest: { totalB: 100, m: '2026-09', momPct: 25 } } }, credit: { revolving: { latestB: 1400, yoyPct: 6, asOf: '2026-09-01' } } }),
    capex: stamp({ totals: { fyLatestSum: 350e9, yoyPct: 35, count: 7, fyRangeLabel: 'FY2025', revenue: { yoyPct: 10 }, guidance: { companies: [{ ticker: 'MSFT', period: 'CY2026', asOf: '2026-10-26', low: 130e9, high: 140e9, callChange: 'raised' }] } } }),
    ram: buildRamPricesPayload({ builtAtIso, spot: { sourceName: 'Synthetic DRAM', updatedAt: '2026-10-27', items: [{ name: 'DDR5 16Gb', sessionAvg: 12 }] },
      prior: { spot: { history: { 'DDR5 16Gb': [{ d: '2026-09-26', avg: 10 }] } } },
      retail: { categories: [{ label: 'DDR5 kits', monthPct: 11, series: [] }] } }),
    accelerators: stamp({ summary: { focus: { model: 'H100', change7dPct: -10, spotMedian: 2 } } }),
    'central-bank-gold': stamp({ sources: [{ id: 'demand', ok: true }], summary: { latestTonnes: 200, latestPeriod: '2026 Q2', trailing4QuarterTonnes: 900 } }),
    search: stamp({ summary: { breakouts: [{ label: 'AI', query: 'AI chips' }] } }),
    ownership: stamp({ period: '2026 Q2', periodEndIso: '2026-06-30', overallTopBought: [{ ticker: 'ACME', firmCount: 8 }],
      insiderTransactions: { asOf: builtAtIso, transactions: insiders } }),
  };
}
