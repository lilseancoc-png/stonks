// Shared UI policy. Data authorization lives independently in premium-keys.mjs.
// Keep private pages in their existing navigation sections.
export const OWNER_PAGE_IDS = Object.freeze([
  'owner-market-brief', 'grade', 'strategies', 'narratives',
  'earnings-forecast', 'unified-signal-engine', 'market', 'risk', 'bottom-tracker',
  'historical-data', 'party-tracker', 'forced-liquidation', 'picks', 'leaps',
  'stocks', 'rotation', 'levetf', 'open-picks', 'track', 'quant',
]);

// Mixed public pages keep their factual tables and charts. These panels contain
// stock selection, model scores, trade posture, entry instructions or exits.
export const OWNER_UI_SELECTORS = Object.freeze([
  '[data-owner-only]', '#book-grade-return',
  '.flow-decision', '.heatmap-decision', '.heatmap-eod-decision',
  '#news-feed-summary', '.news-posture-triggers',
  '.news-feed-decision', '.news-decision',
  '.brief-decision', '.brief-analog', '.ers-posture', '.ers-search-signal',
  '.ecl-decision', '.ecl-plan-posture', '.cmd-posture', '.cx-posture',
  '.rp-posture', '.ic-posture', '.bonds-ctx-posture', '.fng-decision', '.idx-cal-decision',
  '.ma-track-summary', '.ma-track-desk', '.ma-track-leaders', '.ma-track-note',
  '#tickers-decision', '#tickers-model-summary', '#tickers-model-note',
  '#tickers-ready', '.ticker-grade', '#tickers-scatter .sc-legend',
  '#cmp-pillars', '#cmp-summary',
  '[data-ers-view="recovery"]', '.recovery-screen',
  'option[value="grade"]', '#tickers-sort option[value="score"]',
  '#tickers-sc-x option[value="score"]', '#tickers-sc-y option[value="score"]',
  '#tickers-sort option[value="conviction"]', '#tickers-sort option[value="ready"]',
  '#cmp-sec-metric option[value="call"]', '#cmp-sec-metric option[value="put"]',
  '[data-grade]', '[data-scn-grade]', '[data-f13-grade]', '.flow-grade-btn',
  '[data-go="grade"]', '[data-go="strategies"]', '[data-go="narratives"]',
]);

export function ownerOnlyCss() {
  const selectors = [...OWNER_UI_SELECTORS, ...OWNER_PAGE_IDS.flatMap(id => [
    '[data-page-tab="' + id + '"]', '#page-pane-' + id,
  ])];
  return selectors.map(s => 'body:not(.is-owner) ' + s).join(',\n') + '{display:none!important;}\nbody.is-owner [data-public-only]{display:none!important;}';
}
