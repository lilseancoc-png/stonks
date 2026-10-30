// Apply the current public policy at read time, including older store objects.
// Owner projections are authenticated separately in data-response.mjs.
export const BRIEF_ACCESS_POLICY_VERSION = 1;
const TICKER_KEY_RE = /^[A-Z][A-Z0-9.-]*\.json$/;

// These are site judgments, recommendations or third-party price targets,
// rather than reported prices, accounts, filings or observed market activity.
const OWNER_FIELDS = new Set([
  'autoPick', '_grade', 'grade', 'grades', 'gradeTotal', 'gradeScore',
  'industryGrades', 'recommendation', 'recommendations', 'recommendationKey',
  'recommendationMean', 'judgment', 'aiSignals', 'entryTiming', 'entryVerdict',
  'tradePlan', 'tradePosture', 'strategyRecommendation', 'buyDecision',
  'targetMeanPrice', 'targetMedianPrice', 'targetHighPrice', 'targetLowPrice',
  'analystRevisions',
]);

export function containsInvestmentAdvice(text) {
  return /\b(?:[Bb]uy|[Ss]ell|[Ss]hort)\s+[A-Z][A-Z0-9.]{0,5}\b/.test(String(text)) ||
    /\b(?:stocks?|tickers?|ETFs?)\s+to\s+(?:buy|sell|short)\b|\b(?:go|stay)\s+(?:long|short)\b|\b(?:buy now|sell now|take profit|entry price|price target|strong buy|strong sell|our grade|top picks|highest.conviction|ready to enter)\b/i.test(String(text));
}

export function publicDataPayload(key, payload) {
  // JSON serialization clones the payload and strips known judgment fields at
  // any depth. It must never mutate a stored object used by Owner consumers.
  const out = JSON.parse(JSON.stringify(payload, (name, value) => OWNER_FIELDS.has(name) ? undefined : value));
  if (!out || typeof out !== 'object') return out;
  if (TICKER_KEY_RE.test(key)) {
    // Free-form AI takes and catalysts can include suggested entries or exits.
    // Public news remains available through the sourced news-feed endpoint.
    for (const name of ['news', 'catalysts', 'investingQuestions', 'investmentPerspective', 'tradingPerspective']) delete out[name];
  }
  if (key === 'manifest-free.json' || key === 'trends.json' || key === 'trends-history.json') {
    for (const name of ['narratives', 'sectorOverviews', 'recentlyEnded']) delete out[name];
  }
  if (key === 'ma-tracker.json') { delete out.summary; delete out.methodology; }
  if (key === 'briefs.json') {
    if (out.current?.accessPolicyVersion !== BRIEF_ACCESS_POLICY_VERSION) delete out.current;
    for (const name of ['morning', 'afternoon']) delete out[name];
    if (out.current) {
      // Owner-derived AI prose can paraphrase grades or a trade thesis even
      // without explicit buy/sell words. Hide those fields rather than change
      // the prompts, model inputs, or stored research that Owners receive.
      for (const name of ['headline', 'summary', 'highlights', 'watchlist', 'playbook', 'analog']) delete out.current[name];
      const scan = out.current.toolScan;
      if (scan && typeof scan === 'object') {
        const privateSource = label => label === 'Narratives';
        const hadNarratives = [...(scan.checked || []), ...(scan.missing || [])].some(privateSource);
        for (const name of ['checked', 'missing']) if (Array.isArray(scan[name])) scan[name] = scan[name].filter(label => !privateSource(label));
        if (Array.isArray(scan.coreChecked)) scan.coreChecked = scan.coreChecked.map(label => label === 'Ticker tracker & Grade' ? 'Stock prices & fundamentals' : label);
        if (hadNarratives && Number.isFinite(scan.total)) scan.total = Math.max(0, scan.total - 1);
        if (Array.isArray(scan.standouts)) scan.standouts = scan.standouts.filter(row => row?.tab !== 'narratives' && row?.tab !== 'grade' && row?.tab !== 'strategies' && row?.tab !== 'ma-tracker' && !containsInvestmentAdvice(row?.text));
      }
    }
  }
  if (key === 'news-feed.json' && Array.isArray(out.items)) {
    out.items = out.items.filter(item => !containsInvestmentAdvice([item?.title, item?.summary, item?.body, item?.description].filter(Boolean).join(' ')));
    if (out.counts) out.counts = {
      total: out.items.length,
      high: out.items.filter(item => item.impact === 'high').length,
      notable: out.items.filter(item => item.impact === 'notable').length,
      company: out.items.filter(item => item.scope === 'company').length,
      market: out.items.filter(item => item.scope === 'market').length,
      macro: out.items.filter(item => item.desk === 'macro').length,
      marketPulse: out.items.filter(item => item.desk === 'market').length,
      activeTape: out.items.filter(item => item.reaction?.active && item.impact !== 'context').length,
    };
  }
  if (key === 'regime-history.json' && Array.isArray(out.days)) {
    for (const day of out.days) if (day && typeof day === 'object') {
      delete day.lean;
      delete day.picks;
    }
  }
  return out;
}

export function sanitizePublicJsonText(key, text) {
  const source = String(text);
  const clean = JSON.stringify(publicDataPayload(key, JSON.parse(source)));
  // The null contract tells the caller it can retain the original bytes.
  return clean === source ? null : clean;
}
