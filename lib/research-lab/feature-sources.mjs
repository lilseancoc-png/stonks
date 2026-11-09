// Shared feature-to-published-output map. No storage access or provider calls.
export const SOURCE_KEYS = Object.freeze({
  'owner-market-brief': 'owner-market-brief.json', brief: 'briefs.json', news: 'news-feed.json',
  market: 'market-analysis.json', risk: 'market-analysis.json', 'unified-signal-engine': 'unified-signal.json',
  'bottom-tracker': 'bottom-tracker.json', 'historical-data': 'historical-data.json', 'party-tracker': 'party-tracker.json',
  'earnings-forecast': 'earnings-forecast.json', 'forced-liquidation': 'forced-liquidation.json', grade: 'grades.json',
  narratives: 'trends.json', picks: 'picks.json', leaps: 'leaps-picks.json', stocks: 'stock-picks.json',
  rotation: 'sector-rotation.json', levetf: 'leveraged-etfs.json', quant: 'quant.json',
  heatmap: 'heatmap.json', calendar: 'calendar.json', 'pending-buyouts': 'pending-buyouts.json', earnings: 'earnings-tracker.json', 'earnings-week': 'earnings-week.json',
  calls: 'earnings-calls.json', spillover: 'spillover-pairs.json', 'index-cal': 'index-calendar.json',
  'pattern-lab': 'pattern-recognition.json', 'ma-tracker': 'ma-tracker.json', flow: 'unusual.json',
  volume: 'volume-flags.json', oi: 'oi-tracker.json', 'iv-trend': 'iv-trending.json', streaks: 'streaks.json',
  f13: '13f.json', 'ai-capex': 'ai-capex.json',
  'ram-prices': 'ram-prices.json', 'accelerator-prices': 'accelerator-prices.json', 'central-bank-gold': 'central-bank-gold.json',
  'search-interest': 'search-interest.json', commodities: 'commodities.json', 'capital-raises': 'capital-raises.json',
  'bonds-usd': 'macro.json', 'fear-greed': 'fear-greed.json', overnight: 'correlations.json',
  'market-map': 'market-map.json', 'whats-changed': 'site-changes.json', 'past-day': 'market-days.json',
  crowd: 'crowd.json',
});
