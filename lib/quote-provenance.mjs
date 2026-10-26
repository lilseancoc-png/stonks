// Preserve the source clock independently from the time the request completed.
export function yahooQuoteProvenance(quote, { optionSpot = false, fetchedAt = new Date().toISOString() } = {}) {
  const q = quote || {}, state = String(q.marketState || '').toUpperCase();
  const selected = !optionSpot && state.startsWith('PRE') && q.preMarketPrice != null ? 'preMarketPrice'
    : !optionSpot && state.startsWith('POST') && q.postMarketPrice != null ? 'postMarketPrice'
      : q.regularMarketPrice != null ? 'regularMarketPrice'
        : q.postMarketPrice != null ? 'postMarketPrice' : q.preMarketPrice != null ? 'preMarketPrice' : null;
  const timeField = selected === 'regularMarketPrice' ? 'regularMarketTime' : selected === 'postMarketPrice' ? 'postMarketTime' : selected === 'preMarketPrice' ? 'preMarketTime' : null;
  const raw = timeField ? q[timeField] : null;
  const ms = raw instanceof Date ? raw.getTime() : typeof raw === 'number' ? raw * (raw < 1e12 ? 1000 : 1) : raw ? Date.parse(raw) : NaN;
  return { provider: 'Yahoo Finance', field: selected, timeField, asOf: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
    fetchedAt, marketState: q.marketState || null, currency: typeof q.currency === 'string' ? q.currency : null,
    exchange: typeof q.exchange === 'string' ? q.exchange : null,
    fallback: optionSpot && selected !== 'regularMarketPrice' ? 'Regular-session option spot unavailable; selected an extended-session fallback.'
      : !optionSpot && /^(PRE|POST)/.test(state) && selected === 'regularMarketPrice' ? 'Active extended-session price unavailable; selected the regular-session reference.' : null };
}
