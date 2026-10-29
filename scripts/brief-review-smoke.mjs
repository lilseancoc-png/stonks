import assert from 'node:assert/strict';
import { collectBriefSiteTools, gatherBriefSignals, briefUserMessage } from './build.mjs';
const now = new Date('2026-10-27T19:30:00Z');
const dataDir = new URL('./fixtures/no-brief-review-data', import.meta.url).pathname;
const seasonal = await collectBriefSiteTools({ now, dataDir, payloads: {
  'pattern-lab': { builtAtIso: now.toISOString(), pieces: { seasonality: {
    '^GSPC': { provisional: false, active: { inSanta: true }, santa: { provisional: false, avgPct: 5.5, n: 75 } },
    SPY: { provisional: false, active: { inSanta: false }, santa: { provisional: false, avgPct: 9.9, n: 30 } },
  } } },
} });
assert.match(JSON.stringify(seasonal.facts), /S&P 500.*5\.5%/, 'brief uses the same long-history S&P 500 series as Pattern lab');
assert.doesNotMatch(JSON.stringify(seasonal.facts), /9\.9%/);

const richRow = { symbol: 'RICH', iv: 0.5, mean: 0.4, pctile: 95, elevated: true, tier: null, chg5dPct: -2 };
const percentileOnly = gatherBriefSignals('intraday', { chains: {}, ivTrending: { tickers: [richRow] } });
assert.equal(percentileOnly.ivTrend[0].richnessBasis, 'percentile-only');
assert.match(percentileOnly.ivTrend[0].richnessNote, /realized volatility is unavailable/);
const prompt = briefUserMessage('intraday', '2026-10-27', percentileOnly);
assert.match(prompt, /realized volatility is unavailable/);
const confirmed = gatherBriefSignals('intraday', { chains: { RICH: { technicals: { volRegime: { rv30: 0.3 } } } }, ivTrending: { tickers: [richRow] } });
assert.equal(confirmed.ivTrend[0].richnessBasis, 'percentile+realized');
assert.match(confirmed.ivTrend[0].richnessNote, /above its 30-day realized moves/);
const noPremium = gatherBriefSignals('intraday', { chains: { RICH: { technicals: { volRegime: { rv30: 0.6 } } } }, ivTrending: { tickers: [richRow] } });
assert.equal(noPremium.ivTrend, undefined, 'a carried elevated flag cannot override the current shared IV band');

const malformed = await collectBriefSiteTools({ now, dataDir, payloads: {
  'pattern-lab': { builtAtIso: now.toISOString(), pieces: { divergences: {
    rows: [{ symbol: 'BROKEN', direction: 'bullish' }], record: { undefinedBullish: { n: 40, avgPct: 1, baselineAvgPct: 0.5 } },
  } } },
  volume: { builtAtIso: now.toISOString(), tickers: [{ symbol: 'ACME', eod: { ratio: 3 } }] },
} });
assert(malformed.facts.some((f) => f.source === 'Volume'));
assert(!malformed.facts.some((f) => f.text.includes('undefined')));
console.log('brief review regressions: long-history seasonality, IV confirmation and carried flags, malformed divergence rows passed');
