// Leverage distress desk: pure math, no network or persistence.
//
// Three research reads sit next to the pledge tracker on the Forced
// Liquidation page. None of them uses an AI model and none of them changes a
// Top Picks decision.
//   1. Hot funds: 13F books worth $3B+ whose implied returns are 30%+ (watch)
//      or 40%+ (alert), their leverage tells, a daily estimate of how their
//      top holdings have moved since the 13F date, and which of our stocks
//      they own.
//   2. Leveraged single-stock ETF rebalance: the close-of-day trade a
//      daily-reset fund must make, L x (L - 1) x AUM x the day's return.
//   3. Cluster selloff (shadow): unrelated tracked stocks falling hard on
//      heavy volume on a calm index day, the footprint of one forced seller.
import { completedCloseCutoff, isHistoricalTradingDate } from './historical-market-calendar.mjs';
import { cumFracExpected, etMinutesSinceOpen } from './volume-flags.mjs';

export const LEVERAGE_DISTRESS_KEY = 'leverage-distress.json';
export const LEVERAGE_DISTRESS_STATE_KEY = 'leverage-distress-state.json';
export const LEVERAGE_DISTRESS_VERSION = 1;
export const HOT_FUND_POLICY = Object.freeze({
  minBookValue: 3e9,        // 13F reported value, the closest public proxy for AUM
  maxEntries: 600,          // info-table rows; larger books are diversified managers, not hot funds
  alertReturnPct: 40, watchReturnPct: 30,
  minPricedCoverage: 0.7,   // share of the stock book with a quarter-end price
  minStockShareForOptions: 0.25,
  maxFlagged: 60, topHoldings: 15,
  pressureDrawdownPct: 12, deleverDrawdownPct: 20, drawdownWindowDays: 30,
  pressureSinceFilingPct: -15, deleverSinceFilingPct: -25,
  quoteMaxAgeHours: 96, minSnapshotPricedPct: 80,
});
export const CLUSTER_POLICY = Object.freeze({
  minDropPct: 4, sigmaMultiple: 2.5, minVolumeRatio: 2.5, minNames: 3, minGroups: 2,
  calmIndexPct: -1.5, earningsGuardDays: 2, logDays: 120,
});

const DAY = 86400000;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const positive = n => finite(n) && n > 0;
const round = (n, d = 2) => finite(n) ? Math.round(n * 10 ** d) / 10 ** d : null;
const etDay = date => new Date(date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// ---------------------------------------------------------------------------
// 13F books

// Information-table rows from an EDGAR 13F XML. Unlike the public 13F page's
// parser this keeps option rows (putCall), because call and put notional are
// the leverage tells this desk needs. Bonds (PRN) are dropped.
export function parse13FInfoTableXml(xml) {
  const clean = String(xml || '').replace(/(<\/?)[a-zA-Z0-9]+:/g, '$1');
  const rows = [];
  for (const block of clean.match(/<infoTable\b[^>]*>[\s\S]*?<\/infoTable>/g) || []) {
    const tag = t => (block.match(new RegExp('<' + t + '\\b[^>]*>([\\s\\S]*?)</' + t + '>')) || [])[1]?.trim() || null;
    const type = String(tag('sshPrnamtType') || 'SH').toUpperCase();
    const value = Number(tag('value')), shares = Number(tag('sshPrnamt'));
    if (type !== 'SH' || !tag('cusip') || !positive(value)) continue;
    rows.push({ cusip: tag('cusip').toUpperCase(), name: decodeEntities(tag('nameOfIssuer') || ''), cls: decodeEntities(tag('titleOfClass') || ''),
      value, shares: positive(shares) ? shares : null, putCall: normalizePutCall(tag('putCall')) });
  }
  return rows;
}
function decodeEntities(s) { return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").trim(); }
export function normalizePutCall(v) { const s = String(v || '').trim().toUpperCase(); return s === 'CALL' ? 'CALL' : s === 'PUT' ? 'PUT' : null; }

// One row per CUSIP and option side. Managers split a position across rows
// for discretion and sub-advisers; those rows describe one holding.
export function collapseBookRows(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r?.cusip || !positive(r.value)) continue;
    const key = r.cusip + '|' + (r.putCall || '');
    const prior = map.get(key);
    if (prior) { prior.value += r.value; prior.shares = positive(prior.shares) && positive(r.shares) ? prior.shares + r.shares : prior.shares ?? r.shares ?? null; }
    else map.set(key, { cusip: r.cusip, name: r.name || '', cls: r.cls || '', value: r.value, shares: positive(r.shares) ? r.shares : null, putCall: r.putCall || null });
  }
  return [...map.values()];
}

export function bookStats(rows) {
  let stockValue = 0, callNotional = 0, putNotional = 0, positions = 0;
  const stock = [];
  for (const r of rows || []) {
    if (r.putCall === 'CALL') callNotional += r.value;
    else if (r.putCall === 'PUT') putNotional += r.value;
    else { stockValue += r.value; positions++; stock.push(r.value); }
  }
  stock.sort((a, b) => b - a);
  const top5 = stock.slice(0, 5).reduce((t, v) => t + v, 0);
  const total = stockValue + callNotional + putNotional;
  return { reportedValue: total, stockValue, callNotional, putNotional, positions,
    top5Pct: stockValue > 0 ? round(top5 / stockValue * 100, 1) : null,
    callPct: stockValue > 0 ? round(callNotional / stockValue * 100, 1) : null,
    putPct: stockValue > 0 ? round(putNotional / stockValue * 100, 1) : null };
}

// Labels that explain a book. "Options-hedged" is a market-maker-style book
// (large calls and puts against each other); its implied return is not a
// leverage read, so it never raises an alert.
export function classifyBook(stats) {
  const tells = [];
  const optionNotional = (stats.callNotional || 0) + (stats.putNotional || 0);
  const hedged = optionNotional > (stats.stockValue || 0) && stats.putNotional >= 0.5 * stats.callNotional && stats.callNotional > 0;
  if (hedged) tells.push('options-hedged');
  if (!hedged && stats.callPct >= 25) tells.push('call-heavy');
  if (stats.top5Pct >= 50) tells.push('concentrated');
  if (stats.positions > 0 && stats.positions <= 25) tells.push('few-positions');
  if (!hedged && stats.putPct >= 25) tells.push('put-heavy');
  return { hedged, tells };
}

// Return of the book held at the start of a quarter, priced at its end:
// sum(shares x end price) / sum(shares x start price). Both prices are the
// all-filer consensus for the CUSIP (startPrices / endPrices), so a filer
// that reports VALUE in the wrong unit or misprices a row cannot distort its
// own return; only its share counts matter. Options count at the
// underlying's move on their share amount (calls +, puts -) for the
// "with listed options" figure, which is a rough upper bound on how a
// call-heavy book amplified its stock moves.
export function impliedQuarterReturn(rows, endPrices, startPrices = null) {
  let stockStart = 0, stockPriced = 0, stockEnd = 0, optionPnl = 0;
  for (const r of rows || []) {
    const end = endPrices?.[r.cusip];
    const own = positive(r.shares) ? r.value / r.shares : null;
    const start = positive(startPrices?.[r.cusip]) ? startPrices[r.cusip] : own;
    if (!r.putCall) {
      const startValue = positive(r.shares) && positive(start) ? r.shares * start : r.value;
      stockStart += startValue;
      if (positive(end) && positive(r.shares) && positive(start)) { stockPriced += startValue; stockEnd += r.shares * end; }
    } else if (positive(end) && positive(start) && positive(r.shares)) {
      optionPnl += (r.putCall === 'CALL' ? 1 : -1) * r.shares * (end - start);
    }
  }
  if (!(stockPriced > 0)) return { stockPct: null, withOptionsPct: null, coverage: stockStart > 0 ? 0 : null };
  const stockPnl = stockEnd - stockPriced;
  return { stockPct: round((stockEnd / stockPriced - 1) * 100, 2),
    withOptionsPct: round((stockPnl + optionPnl) / stockPriced * 100, 2),
    coverage: round(stockPriced / stockStart, 4) };
}

// Value every row on the consensus quarter-end price. Option rows become
// share amount x price (filers differ on whether VALUE is the premium or the
// underlying), and a stock row whose VALUE is more than 50% away from
// shares x price (a thousands-for-dollars slip) is revalued. The filer's own
// figure stays in reportedValue.
export function normalizeBookRows(rows, prices) {
  return (rows || []).map(r => {
    const px = prices?.[r.cusip];
    if (!positive(px) || !positive(r.shares)) return { ...r, price: positive(r.shares) ? r.value / r.shares : null };
    const consensus = r.shares * px;
    const off = Math.abs(r.value / consensus - 1) > 0.5;
    return { ...r, reportedValue: r.value, value: r.putCall || off ? consensus : r.value, price: px, revalued: !r.putCall && off };
  });
}

// Forward and reverse split ratios. A 13F price that differs from a
// split-adjusted close by one of these is the same stock before a split.
export const SPLIT_RATIOS = Object.freeze([2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 100, 1.5, 2.5]);
const SPLIT_FACTORS = [...SPLIT_RATIOS, ...SPLIT_RATIOS.map(k => 1 / k)];
// rawPrice / adjustedPrice: 1 within 12% (same basis), a split ratio within
// 4% (price predates a split), else null (wrong stock or bad data).
export function splitFactor(rawPrice, adjustedPrice, sameBasisTolerance = 0.12) {
  if (!positive(rawPrice) || !positive(adjustedPrice)) return null;
  const ratio = rawPrice / adjustedPrice;
  if (Math.abs(ratio - 1) <= sameBasisTolerance) return 1;
  const k = SPLIT_FACTORS.find(f => Math.abs(ratio / f - 1) <= 0.04);
  return k ?? null;
}

// Consensus end prices restated to the start quarter's share basis. A CUSIP
// whose price ratio matches a split ratio while the total shares all filers
// hold moved by the inverse of that ratio split during the quarter; its end
// price is multiplied back so the split does not read as a loss.
export function splitAdjustedEndPrices(startPrices, startShares, endPrices, endShares) {
  if (!endPrices) return { prices: null, splits: {} };
  const prices = { ...endPrices }, splits = {};
  for (const [cusip, end] of Object.entries(endPrices)) {
    const start = startPrices?.[cusip], s0 = startShares?.[cusip], s1 = endShares?.[cusip];
    if (!positive(start) || !positive(end) || !positive(s0) || !positive(s1)) continue;
    const priceRatio = end / start, shareRatio = s1 / s0;
    if (shareRatio < 1.4 && shareRatio > 1 / 1.4) continue;
    const k = SPLIT_FACTORS.find(f => Math.abs(shareRatio / f - 1) <= 0.12 && Math.abs(priceRatio * f - 1) <= 0.2);
    if (k) { prices[cusip] = Number((end * k).toPrecision(7)); splits[cusip] = k; }
  }
  return { prices, splits };
}

export function topBookRows(rows, n = HOT_FUND_POLICY.topHoldings) {
  return [...(rows || [])].sort((a, b) => b.value - a.value || a.cusip.localeCompare(b.cusip)).slice(0, n)
    .map(r => ({ cusip: r.cusip, name: r.name, cls: r.cls, putCall: r.putCall, value: Math.round(r.value), shares: r.shares,
      price: positive(r.price) ? round(r.price, 4) : positive(r.shares) ? round(r.value / r.shares, 4) : null }));
}

// 13F issuer names ("NVIDIA CORPORATION", "META PLATFORMS INC CL A") and
// SEC/Yahoo company names reduce to the same key. A key match still has to
// pass a quarter-end price check before a CUSIP is tied to one of our stocks.
const NAME_NOISE = new Set(['INC','INCORPORATED','CORP','CORPORATION','CO','COMPANY','LTD','LIMITED','PLC','LLC','LP','HLDGS','HLDG','HOLDINGS','HOLDING','GROUP','GRP','CL','CLASS','A','B','C','COM','COMMON','STOCK','NEW','SHS','SHARES','ORD','ORDINARY','ADR','ADS','SPONSORED','SPON','SPONS','NV','N','V','SA','AG','SE','THE','DEL','DE','NPV','PAR','USD','VALUE','REGISTERED','REG','TH']);
const NAME_SYNONYMS = { MFG: 'MANUFACTURING', INTL: 'INTERNATIONAL', TECH: 'TECHNOLOGY', TECHNOLOGIES: 'TECHNOLOGY', SYS: 'SYSTEMS', SVCS: 'SERVICES', PHARMACEUTICALS: 'PHARMA', PHARMACEUTICAL: 'PHARMA', SEMICONDUCTORS: 'SEMICONDUCTOR', LABS: 'LABORATORIES', COMMUNICATIONS: 'COMMUNICATION', ENTMT: 'ENTERTAINMENT', FINL: 'FINANCIAL' };
export function issuerNameKey(name) {
  return String(name || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/)
    .map(w => NAME_SYNONYMS[w] || w).filter(w => w && !NAME_NOISE.has(w)).join(' ');
}

// ---------------------------------------------------------------------------
// Hot-fund view

function periodsOf(state) { return Object.keys(state?.periods || {}).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p)).sort(); }

// Calendar-year return through the latest 13F quarter, chained from each
// quarter's implied return. A missing quarter leaves YTD unknown rather than
// silently skipping it.
export function fundReturnSeries(state, cik) {
  const periods = periodsOf(state);
  const latest = periods.at(-1);
  if (!latest) return { latestPeriod: null, ytdYear: null, quarters: [], ytd: null, qoq: null };
  const year = Number(latest.slice(0, 4));
  const quarters = periods.filter(p => Number(p.slice(0, 4)) === year).map(p => ({ period: p, ...(state.periods[p].returns?.[cik] || {}) }));
  const ends = quarters.map(q => q.period);
  const expected = ['03-31', '06-30', '09-30', '12-31'].map(m => `${year}-${m}`).filter(p => p <= latest);
  const complete = expected.length > 0 && expected.every(p => ends.includes(p)) && quarters.every(q => finite(q.stockPct));
  const chain = key => quarters.reduce((acc, q) => acc == null || !finite(q[key]) ? null : acc * (1 + q[key] / 100), 1);
  const ytdStock = complete ? chain('stockPct') : null, ytdOpt = complete ? chain('withOptionsPct') : null;
  const last = quarters.find(q => q.period === latest) || {};
  const ytdCoverage = complete ? Math.min(...quarters.map(q => finite(q.coverage) ? q.coverage : 0)) : null;
  return { latestPeriod: latest, ytdYear: year, ytdCoverage, quarters: quarters.map(q => ({ period: q.period, stockPct: q.stockPct ?? null, withOptionsPct: q.withOptionsPct ?? null, coverage: q.coverage ?? null })),
    ytd: ytdStock == null ? null : round((ytdStock - 1) * 100, 2), ytdWithOptions: ytdOpt == null ? null : round((ytdOpt - 1) * 100, 2),
    qoq: last.stockPct ?? null, qoqWithOptions: last.withOptionsPct ?? null, coverage: last.coverage ?? null };
}

// Which return crosses the line. Option-adjusted returns only count when the
// stock book is a real share of the reported value; a tiny stock book makes
// the ratio meaningless.
export function hotFundLevel(series, stats, classification, policy = HOT_FUND_POLICY) {
  if (classification?.hedged) return { level: null, reason: 'options-hedged' };
  // Each figure needs every quarter in it priced well enough.
  const qoqOk = series.coverage >= policy.minPricedCoverage, ytdOk = series.ytdCoverage >= policy.minPricedCoverage;
  if (!qoqOk && !ytdOk) return { level: null, reason: finite(series.qoq) || finite(series.ytd) ? 'low-price-coverage' : 'no-return' };
  const optionsUsable = stats.reportedValue > 0 && stats.stockValue / stats.reportedValue >= policy.minStockShareForOptions;
  const candidates = [...(ytdOk ? [['ytd', series.ytd]] : []), ...(qoqOk ? [['qoq', series.qoq]] : []),
    ...(optionsUsable ? [...(ytdOk ? [['ytd-with-options', series.ytdWithOptions]] : []), ...(qoqOk ? [['qoq-with-options', series.qoqWithOptions]] : [])] : [])].filter(([, v]) => finite(v));
  if (!candidates.length) return { level: null, reason: 'no-return' };
  const [basis, best] = candidates.sort((a, b) => b[1] - a[1])[0];
  return { level: best >= policy.alertReturnPct ? 'alert' : best >= policy.watchReturnPct ? 'watch' : null, basis, bestReturnPct: best };
}

// Is a 13F quarter-end price on the same basis as today's quote? For our own
// stocks the split-adjusted close on that date answers it exactly (and
// gives the split factor). For other holdings the quote's 52-week range
// must contain the 13F price, which catches a split or a CUSIP mapped to the
// wrong listing. Quotes in another currency are never compared.
export function priceBasisCheck(row, quote, { chain = null, anchorPeriod = null, now } = {}) {
  if (!positive(row?.price)) return { ok: false, reason: 'no-13f-price' };
  if (quote?.currency && String(quote.currency).toUpperCase() !== 'USD') return { ok: false, reason: 'currency' };
  const ref = chain && anchorPeriod ? closeOnOrBefore(chain, anchorPeriod) : null;
  if (ref && anchorPeriod && Date.parse(anchorPeriod) - Date.parse(ref.date) <= 7 * DAY) {
    const factor = splitFactor(row.price, ref.close);
    return factor ? { ok: true, factor, basis: 'close' } : { ok: false, reason: 'price-basis' };
  }
  const lo = quote?.low52, hi = quote?.high52;
  const ageDays = anchorPeriod ? (Date.parse(now) - Date.parse(anchorPeriod)) / DAY : null;
  if (positive(lo) && positive(hi) && ageDays != null && ageDays <= 330) {
    const inRange = px => px >= lo * 0.9 && px <= hi * 1.1;
    if (inRange(row.price)) return { ok: true, factor: 1, basis: 'range' };
    // Only an unambiguous split ratio is accepted. When the padded range
    // fits several ratios, a single one inside the unpadded 52-week range
    // wins. Picking the ratio nearest today's quote is deliberately not done:
    // it would choose whichever ratio makes the move smallest.
    const fits = SPLIT_FACTORS.filter(f => inRange(row.price / f));
    if (fits.length === 1) return { ok: true, factor: fits[0], basis: 'range' };
    const strict = fits.filter(f => row.price / f >= lo && row.price / f <= hi);
    if (strict.length === 1) return { ok: true, factor: strict[0], basis: 'range' };
    return { ok: false, reason: 'price-basis' };
  }
  return { ok: false, reason: 'unverified' };
}

// Live move of the fund's top holdings since its 13F date. Stock rows count
// long; calls count long and puts short on their share amount. The
// percentage is over the gross value of the priced top rows; bookImpactPct
// spreads the same dollar move over the whole stock book (the rest assumed
// flat). A row whose 13F price fails the basis check is shown without a move
// and left out of both figures. Both are estimates of a book that has
// certainly changed since.
export function estimateTopHoldingsMove(top, quotes, now, policy = HOT_FUND_POLICY, { chains = {}, anchorPeriod = null } = {}) {
  let gross = 0, pnl = 0, priced = 0, total = 0;
  const rows = (top || []).map(r => {
    total += r.value;
    const q = r.ticker ? quotes?.[r.ticker] : null;
    const age = q?.asOf ? (Date.parse(now) - Date.parse(q.asOf)) / 3600000 : null;
    const fresh = positive(q?.price) && age != null && age >= -0.1 && age <= policy.quoteMaxAgeHours;
    const check = fresh ? priceBasisCheck(r, q, { chain: chains[r.ticker] || null, anchorPeriod, now }) : null;
    const basePrice = check?.ok ? r.price / check.factor : null;
    const move = basePrice ? (q.price / basePrice - 1) * 100 : null;
    if (move != null && positive(r.shares)) {
      const sign = r.putCall === 'PUT' ? -1 : 1;
      gross += r.value; priced += r.value; pnl += sign * r.shares * check.factor * (q.price - basePrice);
    }
    return { ...r, livePrice: fresh ? q.price : null, liveAsOf: fresh ? q.asOf : null, movePct: round(move, 2),
      splitFactor: check?.ok && check.factor !== 1 ? check.factor : null, priceCheck: !r.ticker ? 'no-ticker' : !fresh ? 'no-quote' : check.ok ? 'ok' : check.reason };
  });
  return { rows, movePct: gross > 0 ? round(pnl / gross * 100, 2) : null, pnl: Math.round(pnl), pricedPct: total > 0 ? round(priced / total * 100, 1) : null };
}

// Daily snapshots of the estimated move, one per ET day, reset when the
// anchoring 13F changes. Drawdown is measured from the best level in the
// window, so a fund that ran up and then gave it back still shows pressure.
// A day whose quotes priced under 80% of the top rows is not recorded: a
// changing mix of priced rows would read as a move.
export function updateFundSnapshots(prior = [], { period, movePct, pricedPct = 100, now }, policy = HOT_FUND_POLICY) {
  const day = etDay(now);
  const kept = (Array.isArray(prior) ? prior : []).filter(s => s.period === period && s.date !== day && Date.parse(s.date) >= Date.parse(now) - 60 * DAY);
  if (finite(movePct) && pricedPct >= policy.minSnapshotPricedPct) kept.push({ date: day, period, index: round(1 + movePct / 100, 5) });
  kept.sort((a, b) => a.date.localeCompare(b.date));
  const windowStart = new Date(Date.parse(now) - policy.drawdownWindowDays * DAY).toISOString().slice(0, 10);
  const recent = kept.filter(s => s.date >= windowStart);
  const peak = Math.max(1, ...recent.map(s => s.index));
  const current = recent.at(-1)?.index ?? null;
  const drawdownPct = current == null ? null : round((current / peak - 1) * 100, 2);
  return { snapshots: kept, drawdownPct, peak: round(peak, 5) };
}

export function fundPressureState(drawdownPct, movePct, policy = HOT_FUND_POLICY) {
  if (drawdownPct == null && movePct == null) return 'unpriced';
  if ((drawdownPct != null && -drawdownPct >= policy.deleverDrawdownPct) || (movePct != null && movePct <= policy.deleverSinceFilingPct)) return 'deleveraging-risk';
  if ((drawdownPct != null && -drawdownPct >= policy.pressureDrawdownPct) || (movePct != null && movePct <= policy.pressureSinceFilingPct)) return 'under-pressure';
  return 'steady';
}

// Assemble the Owner view from the collector's state plus live quotes.
export function buildHotFundsView({ state, quotes = {}, priorFunds = [], now, chains = {}, policy = HOT_FUND_POLICY }) {
  const periods = periodsOf(state);
  const latest = periods.at(-1) || null;
  const latestFunds = latest ? state.periods[latest].funds || {} : {};
  const priorByCik = new Map((priorFunds || []).map(f => [f.cik, f]));
  const benchmark = fundReturnSeries({ periods: Object.fromEntries(periods.map(p => [p, { returns: { all: state.periods[p].benchmark || {} } }])) }, 'all');
  const funds = [];
  let screened = 0, hedged = 0, lowCoverage = 0;
  for (const [cik, fund] of Object.entries(latestFunds)) {
    screened++;
    const stats = fund.stats || {};
    const classification = classifyBook(stats);
    if (classification.hedged) hedged++;
    const series = fundReturnSeries(state, cik);
    const flag = hotFundLevel(series, stats, classification, policy);
    if (flag.reason === 'low-price-coverage') lowCoverage++;
    if (!flag.level) continue;
    funds.push({ cik, name: fund.name, period: latest, filingDate: fund.filingDate, accession: fund.accession, stats, tells: classification.tells,
      ...series, level: flag.level, basis: flag.basis, bestReturnPct: flag.bestReturnPct });
  }
  funds.sort((a, b) => (a.level === b.level ? 0 : a.level === 'alert' ? -1 : 1) || b.bestReturnPct - a.bestReturnPct || a.name.localeCompare(b.name));
  const shown = funds.slice(0, policy.maxFlagged);
  for (const f of shown) {
    const detail = state.latest?.funds?.[f.cik] || {};
    const early = state.early13F?.[f.cik];
    const useEarly = early?.period && early.period > f.period;
    const top = (useEarly ? early.top : detail.top || []).map(r => ({ ...r, ticker: r.ticker || state.cusipTickers?.[r.cusip] || state.universeCusips?.[r.cusip] || null }));
    const anchor = useEarly ? early.period : f.period;
    const move = estimateTopHoldingsMove(top, quotes, now, policy, { chains, anchorPeriod: anchor });
    const snaps = updateFundSnapshots(priorByCik.get(f.cik)?.snapshots, { period: anchor, movePct: move.movePct, pricedPct: move.pricedPct, now }, policy);
    f.anchorPeriod = anchor;
    f.early13F = useEarly ? { period: early.period, filingDate: early.filingDate, accession: early.accession, stats: early.stats, tells: classifyBook(early.stats || {}).tells } : null;
    // The book the live figures describe: the newer 13F when there is one.
    f.anchorStats = useEarly && early.stats ? early.stats : f.stats;
    f.top = move.rows;
    f.topMovePct = move.movePct; f.topPricedPct = move.pricedPct;
    f.bookImpactPct = positive(f.anchorStats.stockValue) ? round(move.pnl / f.anchorStats.stockValue * 100, 2) : null;
    f.snapshots = snaps.snapshots; f.drawdownPct = snaps.drawdownPct;
    f.pressure = fundPressureState(snaps.drawdownPct, move.movePct, policy);
    f.universe = (useEarly ? early.universe : detail.universe) || [];
    f.recentFilings = state.recentFilings?.[f.cik] || [];
  }
  return { asOf: now, latestPeriod: latest, ytdYear: benchmark.ytdYear, policy,
    benchmark: { ytd: benchmark.ytd, qoq: benchmark.qoq, label: 'All $3B+ 13F stock books, value-weighted' },
    counts: { screened, flagged: funds.length, shown: shown.length, alert: funds.filter(f => f.level === 'alert').length, watch: funds.filter(f => f.level === 'watch').length,
      hedgedExcluded: hedged, lowCoverage, pressure: shown.filter(f => f.pressure === 'under-pressure').length, deleveraging: shown.filter(f => f.pressure === 'deleveraging-risk').length },
    funds: shown };
}

// Our stocks held by flagged funds. Shares held by funds under pressure are
// the supply that could come to market if they cut leverage.
export function hotFundStockLinks(funds, universe, chains = {}) {
  const tracked = new Set(universe || []);
  const bySymbol = new Map();
  for (const f of funds || []) for (const h of f.universe || []) {
    if (!tracked.has(h.symbol)) continue;
    // Restate the 13F share count to today's basis with the stock's own
    // split-adjusted close on the 13F date; a price that matches neither the
    // close nor a split is a bad match and is left out.
    const ref = f.anchorPeriod || f.period ? closeOnOrBefore(chains[h.symbol], f.anchorPeriod || f.period) : null;
    const factor = ref && positive(h.shares) && positive(h.value) ? splitFactor(h.value / h.shares, ref.close) : ref ? null : 1;
    if (factor == null) continue;
    const stats = f.anchorStats || f.stats;
    const list = bySymbol.get(h.symbol) || [];
    list.push({ cik: f.cik, fund: f.name, level: f.level, pressure: f.pressure, putCall: h.putCall || null, shares: positive(h.shares) ? Math.round(h.shares * factor) : h.shares, value: h.value,
      pctOfBook: positive(stats?.stockValue) ? round(h.value / stats.stockValue * 100, 2) : null });
    bySymbol.set(h.symbol, list);
  }
  const rows = [];
  for (const [symbol, holders] of bySymbol) {
    const chain = chains[symbol] || {};
    const stockHolders = holders.filter(h => !h.putCall);
    const shares = stockHolders.reduce((t, h) => t + (h.shares || 0), 0);
    const stressedShares = stockHolders.filter(h => h.pressure === 'under-pressure' || h.pressure === 'deleveraging-risk').reduce((t, h) => t + (h.shares || 0), 0);
    const float = chain.fundamentals?.floatShares;
    const adv = averageDailyVolume(chain);
    const distinct = list => new Set(list.map(h => h.cik)).size;
    rows.push({ symbol, funds: distinct(holders), alertFunds: distinct(holders.filter(h => h.level === 'alert')),
      pressureFunds: distinct(holders.filter(h => h.pressure === 'under-pressure' || h.pressure === 'deleveraging-risk')),
      sharesHeld: shares, stressedShares, pctFloat: positive(float) ? round(shares / float * 100, 2) : null,
      daysOfVolume: positive(adv) ? round(shares / adv, 2) : null, stressedDaysOfVolume: positive(adv) ? round(stressedShares / adv, 2) : null,
      holders: holders.sort((a, b) => (b.pctOfBook || 0) - (a.pctOfBook || 0)) });
  }
  return rows.sort((a, b) => b.pressureFunds - a.pressureFunds || b.funds - a.funds || (b.pctFloat || 0) - (a.pctFloat || 0) || a.symbol.localeCompare(b.symbol));
}

// ---------------------------------------------------------------------------
// Daily bars helpers

function dailyRows(chain) {
  const bars = chain?._bars || chain?.priceSeries || chain?.bars;
  let rows = [];
  if (Array.isArray(bars)) rows = bars.map(b => ({ t: b?.t ?? b?.date, c: b?.c, v: b?.v }));
  else if (Array.isArray(bars?.t)) rows = bars.t.map((t, i) => ({ t, c: bars.c?.[i], v: bars.v?.[i] }));
  const out = new Map();
  for (const r of rows) {
    const stamp = typeof r.t === 'number' ? new Date(r.t < 1e12 ? r.t * 1000 : r.t) : null;
    const date = stamp ? (Number.isFinite(stamp.getTime()) ? stamp.toISOString().slice(0, 10) : '') : String(r.t || '').slice(0, 10);
    if (isHistoricalTradingDate(date)) out.set(date, { date, c: positive(r.c) ? r.c : null, v: finite(r.v) && r.v >= 0 ? r.v : null });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function closeOnOrBefore(chain, date) {
  const row = dailyRows(chain).filter(r => r.date <= date && r.c != null).at(-1);
  return row ? { date: row.date, close: row.c } : null;
}
function averageDailyVolume(chain, before = null) {
  const rows = dailyRows(chain).filter(r => r.v != null && (!before || r.date < before)).slice(-20);
  return rows.length >= 10 ? rows.reduce((t, r) => t + r.v, 0) / rows.length : null;
}

// Today's move from the last completed close, the session's volume so far,
// and that volume against the 20-day average scaled to the elapsed session.
export function sessionMove(chain, now) {
  const rows = dailyRows(chain);
  if (!rows.length) return null;
  const today = etDay(now), cutoff = completedCloseCutoff(now);
  const prior = rows.filter(r => r.date < today && r.c != null);
  const prev = prior.at(-1);
  if (!prev) return null;
  const todayRow = rows.find(r => r.date === today);
  const closed = cutoff === today && todayRow?.c != null;
  const price = closed ? todayRow.c : positive(chain.spot) ? chain.spot : null;
  if (!positive(price)) return null;
  // Share of a normal day's volume expected by now, on the same U-shaped
  // intraday curve the volume scanner uses (heavy open and close).
  const elapsed = todayRow ? (closed ? 1 : Math.max(0.05, cumFracExpected(etMinutesSinceOpen(new Date(now))))) : null;
  const adv = averageDailyVolume(chain, today);
  const returns = prior.slice(-21).map((r, i, a) => i ? Math.log(r.c / a[i - 1].c) : null).filter(finite);
  const sigma = returns.length >= 10 ? Math.sqrt(returns.reduce((t, x) => t + x * x, 0) / returns.length) * 100 : null;
  return { date: today, closed, price, prevClose: prev.c, prevDate: prev.date, movePct: round((price / prev.c - 1) * 100, 3),
    volume: todayRow?.v ?? null, adv, volumeRatio: positive(adv) && finite(todayRow?.v) && elapsed ? round(todayRow.v / (adv * elapsed), 2) : null,
    sigmaPct: round(sigma, 3), quoteAsOf: chain.quoteAsOf || null };
}

// ---------------------------------------------------------------------------
// Leveraged single-stock ETF rebalance

// A fund with daily leverage L and assets A must trade L x (L - 1) x A x r of
// the underlying at the close after a move r. That is a buy after an up day
// and a sale after a down day for 2x bulls and every inverse fund alike.
export function rebalanceTrade(lev, aum, returnPct) {
  if (!finite(lev) || !positive(aum) || !finite(returnPct)) return null;
  return lev * (lev - 1) * aum * returnPct / 100;
}

export function leveragedEtfRebalance({ singles = {}, chains = {}, aum = {}, now }) {
  const rows = [];
  for (const [underlying, def] of Object.entries(singles)) {
    const chain = chains[underlying];
    const move = chain ? sessionMove(chain, now) : null;
    const products = [def?.bull, def?.bear].filter(p => p?.sym).map(p => {
      const a = aum[p.sym];
      const trade = move ? rebalanceTrade(p.lev, a?.aum, move.movePct) : null;
      return { sym: p.sym, lev: p.lev, aum: a?.aum ?? null, aumAsOf: a?.asOf ?? null, tradeUsd: trade == null ? null : Math.round(trade) };
    });
    const known = products.filter(p => p.tradeUsd != null);
    const tradeUsd = known.length ? known.reduce((t, p) => t + p.tradeUsd, 0) : null;
    const shares = tradeUsd != null && positive(move?.price) ? tradeUsd / move.price : null;
    rows.push({ underlying, movePct: move?.movePct ?? null, closed: move?.closed ?? false, price: move?.price ?? null, quoteAsOf: move?.quoteAsOf ?? null,
      products, tradeUsd, shares: shares == null ? null : Math.round(shares), pctOfAdv: shares != null && positive(move?.adv) ? round(Math.abs(shares) / move.adv * 100, 2) : null,
      side: tradeUsd == null ? null : tradeUsd > 0 ? 'buy' : tradeUsd < 0 ? 'sell' : 'none', missingAum: products.filter(p => p.aum == null).map(p => p.sym) });
  }
  return rows.sort((a, b) => (b.pctOfAdv ?? -1) - (a.pctOfAdv ?? -1) || Math.abs(b.tradeUsd || 0) - Math.abs(a.tradeUsd || 0) || a.underlying.localeCompare(b.underlying));
}

// ---------------------------------------------------------------------------
// Cluster selloff (shadow signal)

export function detectClusterSelloff({ chains = {}, universe = [], now, groupOf = () => null, indexSymbols = ['SPY', 'QQQ'], hotFunds = [], policy = CLUSTER_POLICY }) {
  const today = etDay(now);
  const names = [];
  let indexMovePct = null;
  for (const sym of indexSymbols) { const m = chains[sym] ? sessionMove(chains[sym], now) : null; if (m?.movePct != null && m.date === today) { indexMovePct = m.movePct; break; } }
  for (const symbol of universe) {
    // Funds are not single companies; a basket ETF falling is not a forced
    // seller's footprint.
    if (indexSymbols.includes(symbol) || groupOf(symbol) === 'ETF') continue;
    const chain = chains[symbol];
    const m = chain ? sessionMove(chain, now) : null;
    if (!m || m.date !== today || m.movePct == null) continue;
    const threshold = Math.max(policy.minDropPct, positive(m.sigmaPct) ? policy.sigmaMultiple * m.sigmaPct : policy.minDropPct);
    if (m.movePct > -threshold || !(m.volumeRatio >= policy.minVolumeRatio)) continue;
    // Earnings reactions are excluded: the next print within the guard, or a
    // print in the last few calendar days (an after-close report reacts the
    // next session, a Friday one on Monday). Once a print passes, Yahoo's
    // next date moves a quarter out, so the recent print comes from earningsHx.
    const prints = [chain.fundamentals?.nextEarningsDate, chain.earningsHx?.next?.date, ...(chain.earningsHx?.events || []).slice(-2).map(e => e?.date)]
      .filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)).map(d => (Date.parse(d.slice(0, 10)) - Date.parse(today)) / DAY);
    if (prints.some(d => (d >= 0 && d <= policy.earningsGuardDays) || (d < 0 && d >= -(policy.earningsGuardDays + 2)))) continue;
    names.push({ symbol, movePct: m.movePct, thresholdPct: round(threshold, 2), volumeRatio: m.volumeRatio, group: groupOf(symbol) || 'Other' });
  }
  const groups = [...new Set(names.map(n => n.group))];
  const calm = indexMovePct == null ? null : indexMovePct > policy.calmIndexPct;
  const flagged = names.length >= policy.minNames && groups.length >= policy.minGroups && calm === true;
  const symbols = new Set(names.map(n => n.symbol));
  const commonHolders = (hotFunds || []).map(f => ({ cik: f.cik, fund: f.name, level: f.level, pressure: f.pressure,
    held: [...new Set((f.universe || []).filter(h => symbols.has(h.symbol) && !h.putCall).map(h => h.symbol))] }))
    .filter(h => h.held.length >= 2).sort((a, b) => b.held.length - a.held.length || a.fund.localeCompare(b.fund)).slice(0, 10);
  return { date: today, asOf: now, names: names.sort((a, b) => a.movePct - b.movePct), groups, indexMovePct, calmIndex: calm, flagged,
    reason: flagged ? 'Unrelated names fell hard on heavy volume while the index was calm.' : names.length < policy.minNames ? 'Fewer than three tracked names fell hard on heavy volume.' : groups.length < policy.minGroups ? 'The heavy-volume drops are in one sector group.' : calm === false ? 'The index itself fell, so this looks like a market move.' : 'Index move unavailable.',
    commonHolders };
}

// One log row per ET day, latest run wins, only days with any candidate.
export function updateClusterLog(prior = [], today, policy = CLUSTER_POLICY) {
  const kept = (Array.isArray(prior) ? prior : []).filter(r => r?.date && r.date !== today?.date);
  if (today?.names?.length) kept.push({ date: today.date, asOf: today.asOf, flagged: today.flagged, indexMovePct: today.indexMovePct,
    names: today.names.map(n => ({ symbol: n.symbol, movePct: n.movePct, volumeRatio: n.volumeRatio, group: n.group })), commonHolders: today.commonHolders.map(h => ({ fund: h.fund, held: h.held })) });
  return kept.sort((a, b) => b.date.localeCompare(a.date)).slice(0, policy.logDays);
}
