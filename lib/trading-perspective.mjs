import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { computeStreakForTicker } from './streaks.mjs';
import { buildStreakMaContext } from './streak-ma-context.mjs';
import { marketSession, previousTradingDate, sessionForDate } from './us-equity-calendar.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const round = value => finite(value) ? Math.round(value * 10000) / 10000 : null;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = values => { const sorted = values.slice().sort((a, b) => a - b); return sorted.length ? (sorted[Math.floor(sorted.length / 2)] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null; };
const DAY = 86400000;
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;

// Validate once at the source boundary. Do not silently align partial OHLCV.
export function perspectiveBars(chain, asOf) {
  const session = marketSession(Date.parse(asOf));
  const through = session.known && session.open && session.minute >= session.closeMinute + 15 ? session.date : previousTradingDate(session.date);
  if (!through) return { bars: [], through: null, error: 'The completed-session calendar is unavailable.' };
  const provenance = chain?.priceHistoryProvenance;
  const requested = Date.parse(provenance?.requestedAt || ''), collected = Date.parse(provenance?.fetchedAt || '');
  if (provenance?.interval !== '1d' || !finite(requested) || !finite(collected) || requested > collected || collected > Date.parse(asOf)) return { bars: [], through, error: 'A dated daily-history request and response collected by the assessment cutoff are required.' };
  // Use the request start conservatively: slow responses/retries or later
  // quote/fundamental work cannot turn a pre-close capture into a final bar.
  const sourceSession = marketSession(requested);
  const sourceClosed = sourceSession.known && sourceSession.open && sourceSession.minute >= sourceSession.closeMinute + 15;
  const raw = [chain?._patternBars, chain?._bars].find(value => Array.isArray(value) && value.length);
  const ps = chain?.priceSeries;
  let series;
  if (Array.isArray(raw) && raw.length) series = raw;
  else if (ps && Array.isArray(ps.t) && ['c', 'h', 'l', 'v'].every(key => Array.isArray(ps[key]) && ps[key].length === ps.t.length)) {
    series = ps.t.map((t, i) => ({ t, c: ps.c[i], h: ps.h[i], l: ps.l[i], v: ps.v[i] }));
  } else return { bars: [], through, error: 'Aligned daily high, low, close, and volume history is unavailable.' };
  const bars = [];
  let previous = null;
  for (const source of series) {
    const t = typeof source?.t === 'string' ? source.t.slice(0, 10) : null;
    if (!validDay(t) || previous && t <= previous) return { bars: [], through, error: 'Daily dates are invalid, duplicated, or out of order.' };
    previous = t;
    // A later wall clock cannot promote a retained provisional candle.
    if (t > through || t > sourceSession.date || t === sourceSession.date && !sourceClosed) continue;
    const { c, h, l, v } = source;
    if (!(finite(c) && c > 0 && finite(h) && h >= c && finite(l) && l > 0 && l <= c && h >= l && finite(v) && v >= 0)) return { bars: [], through, error: 'Daily high, low, close, or volume observations are incomplete or invalid.' };
    const date = new Date(t + 'T12:00:00Z'), day = date.getUTCDay();
    const known = sessionForDate(t);
    if (day === 0 || day === 6 || known && !known.open) return { bars: [], through, error: 'Daily history contains an off-calendar session.' };
    bars.push({ t, c, h, l, v });
  }
  const tail = bars.slice(-520);
  const gap = tail.findLastIndex((bar, i) => {
    if (!i) return false;
    const expected = previousTradingDate(bar.t);
    // Verified calendars distinguish a holiday from a provider omission or halt.
    // Older years retain the explicitly limited seven-day gap fallback.
    return expected ? tail[i - 1].t !== expected : Date.parse(bar.t) - Date.parse(tail[i - 1].t) > 7 * DAY;
  });
  return { bars: gap > 0 ? tail.slice(gap) : tail, through, error: null,
    excludedBeforeGap: gap > 0 ? gap : 0 };
}

function setupAt(bars, index) {
  if (index < 60) return null;
  const history = bars.slice(0, index + 1), last = bars[index], previous = bars[index - 1];
  const streak = computeStreakForTicker('SETUP', history);
  // A series with no noise-adjusted run still has valid moving averages.
  const levels = (streak?.maContext || buildStreakMaContext(history))?.levels || [];
  const sma20 = levels.find(level => level.period === 20), sma50 = levels.find(level => level.period === 50);
  const atr = mean(bars.slice(index - 13, index + 1).map((bar, i) => {
    const prev = bars[index - 14 + i].c;
    return Math.max(bar.h - bar.l, Math.abs(bar.h - prev), Math.abs(bar.l - prev));
  }));
  if (!(atr > 0) || !sma20 || !sma50) return null;
  const prior20 = bars.slice(index - 20, index), high = Math.max(...prior20.map(bar => bar.h)), low = Math.min(...prior20.map(bar => bar.l));
  const volumeBase = mean(prior20.map(bar => bar.v)), rvol = volumeBase > 0 ? last.v / volumeBase : null;
  const ended = streak?.lastEnded;
  let kind, direction;
  if (ended && ended.sameDays >= 3 && ended.sessionsAgo <= 2 && Math.abs(ended.cumulativePct) >= 3) {
    kind = 'snapped-streak'; direction = ended.color === 'red' ? 1 : -1;
  } else if (last.c > high && rvol >= 1.3 || last.c < low && rvol >= 1.3) {
    kind = 'range-break'; direction = last.c > high ? 1 : -1;
  } else {
    const pullback = (high / last.c - 1) * 100, rebound = (last.c / low - 1) * 100;
    if (sma20.value > sma50.value && sma50.slopePct > 0 && pullback >= 1 && pullback <= 8 && last.c >= sma20.value - atr && last.c > previous.c) {
      kind = 'trend-pullback'; direction = 1;
    } else if (sma20.value < sma50.value && sma50.slopePct < 0 && rebound >= 1 && rebound <= 8 && last.c <= sma20.value + atr && last.c < previous.c) {
      kind = 'trend-pullback'; direction = -1;
    } else return null;
  }
  const momentum = (last.c - previous.c) * direction > 0;
  const reclaimed = (last.c - sma20.value) * direction >= 0;
  const confirmed = momentum && reclaimed && rvol != null && rvol >= 1.1;
  const recent = bars.slice(index - 4, index + 1);
  const invalidation = direction > 0 ? Math.min(...recent.map(bar => bar.l)) : Math.max(...recent.map(bar => bar.h));
  const priorTarget = direction > 0 ? high : low;
  const target = (priorTarget - last.c) * direction > 0 ? priorTarget : last.c + direction * Math.min(3 * atr, high - low);
  return { kind, side: direction > 0 ? 'call' : 'put', direction, confirmed,
    asOf: last.t, close: last.c, atr, rvol, momentum, reclaimed, sma20: sma20.value,
    ended: kind === 'snapped-streak' ? ended : null, target, invalidation,
    targetMethod: target === priorTarget ? 'Prior 20-session range boundary' : 'Prior range projection, capped at three ATR',
    trigger: direction > 0 ? Math.max(last.h, sma20.value) : Math.min(last.l, sma20.value) };
}

function historicalOutcomes(bars, setup) {
  const events = [], matches = [];
  let prior = null;
  for (let i = 60; i < bars.length; i++) {
    const candidate = setupAt(bars, i), key = candidate ? candidate.kind + ':' + candidate.side : null;
    if (candidate?.confirmed && key !== prior && candidate.kind === setup.kind && candidate.side === setup.side) events.push(i);
    prior = candidate?.confirmed ? key : null;
  }
  for (const horizon of [5, 10]) {
    const samples = [], baseline = [];
    let lastExit = -1;
    for (const i of events) {
      if (i <= lastExit || i + horizon >= bars.length) continue;
      const from = bars[i], to = bars[i + horizon];
      const forwardPct = (to.c / from.c - 1) * 100 * setup.direction;
      const adverse = bars.slice(i + 1, i + horizon + 1).map(bar => (setup.direction > 0 ? bar.l / from.c - 1 : 1 - bar.h / from.c) * 100);
      samples.push({ signalDate: from.t, outcomeDate: to.t, signedReturnPct: round(forwardPct), adverseMovePct: round(Math.min(0, ...adverse)) });
      lastExit = i + horizon;
    }
    for (let i = 60; i + horizon < bars.length; i += horizon) baseline.push((bars[i + horizon].c / bars[i].c - 1) * 100 * setup.direction);
    matches.push({ sessions: horizon, n: samples.length, status: samples.length >= 20 ? 'descriptive-sample' : 'limited-sample',
      meanReturnPct: round(mean(samples.map(row => row.signedReturnPct))), medianReturnPct: round(median(samples.map(row => row.signedReturnPct))),
      positiveOutcomePct: samples.length ? round(samples.filter(row => row.signedReturnPct > 0).length / samples.length * 100) : null,
      baselineN: baseline.length, baselineMeanPct: round(mean(baseline)), samples });
  }
  return { horizons: matches, interpretation: 'Past-only setup detection with nonoverlapping resolved windows within each horizon. Observed close-to-close stock outcomes, not executable trade returns, option P&L, or a future win probability. The unconditional same-stock baseline is descriptive, not a matched independent control. Twenty events is a display threshold, not proof of an edge.' };
}

function ivContext(ivTrending, symbol, through, asOf) {
  const row = (Array.isArray(ivTrending?.tickers) ? ivTrending.tickers : []).find(item => item?.symbol === symbol);
  const stamp = Date.parse(ivTrending?.builtAtIso || '');
  const sampled = Date.parse(row?.capturedAtIso || ''), cutoff = Date.parse(asOf), session = marketSession(cutoff);
  const currentSample = row && [through, ...(session.open ? [session.date] : [])].includes(row.asOf)
    && finite(sampled) && sampled <= cutoff && cutoff - sampled <= 90 * 60000
    && marketSession(sampled).date === row.asOf;
  if (!currentSample || !finite(stamp) || stamp > cutoff || !(row.n >= 60) || row.provisional === true
    || !finite(row.iv) || !finite(row.mean) || row.iv <= 0 || row.mean <= 0) return { status: 'unavailable', label: 'Current mature IV history unavailable', asOf: row?.asOf || null, iv: null, mean: null, change5dPct: null, note: 'Missing, provisional or stale IV cannot establish premium value or recovery.' };
  const trend = finite(row.chg5dPct) ? row.chg5dPct > 0 ? 'rising' : row.chg5dPct < 0 ? 'falling' : 'flat' : 'unknown';
  return { status: 'available', label: `${row.iv < row.mean ? 'Below' : 'At or above'} its historical average; five-session IV ${trend}`,
    asOf: row.asOf, sampledAt: row.capturedAtIso, iv: row.iv, mean: row.mean, change5dPct: finite(row.chg5dPct) ? row.chg5dPct : null,
    percentile: finite(row.pctile) ? row.pctile : null, n: row.n,
    note: 'Volatility level and momentum describe premium exposure, not stock direction. Below-average IV does not imply an increase. ATM-30-day IV is not the chosen contract’s IV.' };
}

function nearEvent(date, asOf) {
  if (!validDay(date)) return false;
  const today = marketSession(Date.parse(asOf)).date;
  if (date < today) return false;
  let distance = 0;
  for (let ms = Date.parse(today + 'T12:00:00Z'); ms <= Date.parse(date + 'T12:00:00Z'); ms += DAY) {
    const key = new Date(ms).toISOString().slice(0, 10), session = sessionForDate(key);
    if (!session) return false;
    if (key > today && session.open) distance++;
    if (distance > 2) return false;
  }
  return true;
}

export function buildTradingPerspective({ symbol, chain, quote, chains, ivTrending, picks, asOf, legacyStatus, legacySide }) {
  const parsed = perspectiveBars(chain, asOf), bars = parsed.bars;
  // Retain exact replay inputs without forcing every page load to download
  // hundreds of uncompressed OHLCV rows per company. Inflation is offline only.
  const inputs = bars.length ? { sourceHash: createHash('sha256').update(JSON.stringify(bars)).digest('hex'),
    columns: ['date', 'high', 'low', 'close', 'volume'], rows: bars.length, encoding: 'deflate-raw-json-base64',
    data: deflateRawSync(Buffer.from(JSON.stringify(bars.map(bar => [bar.t, bar.h, bar.l, bar.c, bar.v])))).toString('base64') } : null;
  const result = { version: 1, asOf, horizon: '5–10 trading sessions; separate from the existing 14-calendar-day decision', inputs,
    status: 'insufficient-data', label: 'Trading assessment unavailable', direction: 'mixed', setup: null, plan: null,
    confirmation: [], blocks: [], history: null, peers: null, volatility: ivContext(ivTrending, symbol, parsed.through, asOf),
    coverage: { sessions: bars.length, firstDate: bars[0]?.t || null, lastDate: bars.at(-1)?.t || null, through: parsed.through, excludedBeforeGap: parsed.excludedBeforeGap || 0 },
    execution: { qualified: false, reason: 'Research only. Existing owner entry checks retain execution authority.' },
    limitations: ['Experimental setup rules; no validated incremental predictive edge.', 'Historical frequencies are not calibrated forecast probabilities.', 'No options P&L, borrowing, fees, slippage or account sizing is inferred from stock outcomes.'] };
  if (bars.some(bar => !sessionForDate(bar.t))) result.limitations.push('Some older dates lack a verified exchange calendar; only weekday and seven-calendar-day gap checks apply to those dates.');
  if (parsed.error || bars.length < 80 || bars.at(-1)?.t !== parsed.through) return { ...result, blocks: [parsed.error || (bars.length < 80 ? 'At least 80 aligned completed OHLCV sessions are required.' : 'The price history does not end at the latest completed trading session.')] };
  const setup = setupAt(bars, bars.length - 1);
  if (!setup) return { ...result, status: 'no-setup', label: 'No defined setup detected', blocks: ['The completed bars do not currently meet the reversal, range-break or trend-pullback definitions.'] };
  const current = quote.value, dir = setup.direction;
  const invalidated = finite(current) && (current - setup.invalidation) * dir <= 0;
  const risk = finite(current) ? (current - setup.invalidation) * dir : null, reward = finite(current) ? (setup.target - current) * dir : null;
  const plan = { entry: current, target: round(setup.target), invalidation: round(setup.invalidation), trigger: round(setup.trigger),
    rewardRisk: risk > 0 && reward > 0 ? round(reward / risk) : null, riskAtr: risk > 0 ? round(risk / setup.atr) : null,
    targetMethod: setup.targetMethod, warning: 'Technical levels are research references, not business value. A gap can exceed the planned invalidation loss.' };
  const blocks = [];
  if (!setup.confirmed) blocks.push('Wait for direction-matched participation and a confirmed close on the setup side of the 20-session average.');
  const currentQuote = quote.current && quote.usable && quote.currency && Date.parse(quote.asOf) <= Date.parse(asOf)
    && Date.parse(asOf) < Date.parse(quote.validUntil || '') && marketSession(Date.parse(asOf)).trading;
  if (!currentQuote) blocks.push('A current regular-session quote and verified currency are required before any entry.');
  if (invalidated) blocks.push('The observed price has crossed this setup’s invalidation.');
  if (finite(current) && (current - setup.sma20) * dir < 0) blocks.push('The observed price has lost the setup side of the confirmed 20-session average.');
  if (!(risk > 0 && risk <= 2 * setup.atr && reward / risk >= 1.5)) blocks.push('At the observed price, the setup needs positive payoff of at least 1.5:1 and invalidation within two ATR.');
  if (nearEvent(chain?.fundamentals?.nextEarningsDate, asOf)) blocks.push('A scheduled earnings event is inside the next two trading sessions.');
  if (picks?.rosterMeta?.eventRisk?.active === true) blocks.push('The existing decision snapshot records an active macro event wait.');
  const peers = [];
  const industry = chain?.fundamentals?.industry;
  if (industry) for (const [peer, data] of Object.entries(chains || {})) {
    if (peer === symbol || data?.fundamentals?.industry !== industry) continue;
    const other = perspectiveBars(data, asOf).bars;
    if (other.length >= 6 && other.at(-1).t === bars.at(-1).t && other.at(-6).t === bars.at(-6).t) peers.push({ symbol: peer, return5Pct: round((other.at(-1).c / other.at(-6).c - 1) * 100) });
  }
  const qualified = setup.confirmed && blocks.length === 0 && legacyStatus === 'eligible' && legacySide === setup.side;
  const names = { 'snapped-streak': 'Snapped-streak reversal', 'range-break': 'Confirmed range break', 'trend-pullback': 'Trend pullback' };
  return { ...result, status: invalidated ? 'invalidated' : blocks.length ? 'wait' : 'setup',
    label: invalidated ? 'Setup invalidated' : blocks.length ? 'Setup needs confirmation or a better entry' : 'Research setup confirmed',
    direction: dir > 0 ? 'bullish' : 'bearish', setup: { kind: setup.kind, name: names[setup.kind], asOf: setup.asOf,
      side: setup.side, confirmed: setup.confirmed, snapped: setup.ended, atr: round(setup.atr), rvol: round(setup.rvol), sma20: round(setup.sma20) }, plan,
    confirmation: [{ label: 'Latest confirmed close agrees with the setup direction', pass: setup.momentum },
      { label: 'Confirmed close holds the setup side of the 20-session average', pass: setup.reclaimed },
      { label: 'Confirmed volume is at least 1.1× the prior 20-session average', pass: setup.rvol >= 1.1 }],
    blocks, history: historicalOutcomes(bars, setup),
    peers: { n: peers.length, meanReturn5Pct: peers.length >= 3 ? round(mean(peers.map(peer => peer.return5Pct))) : null,
      status: peers.length >= 3 ? 'available' : 'limited-coverage', members: peers,
      note: 'Leave-one-out covered peers in the same reported industry. Shared price evidence, not an independent vote.' },
    execution: { qualified, reason: qualified ? 'A matching existing owner trade separately qualified at build time. This perspective adds no execution authority.'
      : 'This independent setup does not qualify a new entry. Existing owner gates, side and policy remain binding.' } };
}
