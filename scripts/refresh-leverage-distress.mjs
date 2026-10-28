// Collection for the leverage distress desk (hot funds, leveraged ETF
// rebalance, cluster selloffs). Reads public SEC and Yahoo data only. No AI.
// Every stage has its own budget and keeps the prior figures when it fails.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CLUSTER_POLICY, HOT_FUND_POLICY, LEVERAGE_DISTRESS_KEY, LEVERAGE_DISTRESS_STATE_KEY, LEVERAGE_DISTRESS_VERSION, buildHotFundsView, closeOnOrBefore,
  detectClusterSelloff, hotFundStockLinks, issuerNameKey, leveragedEtfRebalance, updateClusterLog } from '../lib/leverage-distress.mjs';
import { F13_DATA_SETS_PAGE, HOT_FUND_PARSER_VERSION, applyHotFundPass, checkFundSubmissions, parse13FDataSetLinks, planHotFundPass, pruneHotFundState, run13FWindowPass } from '../lib/hot-funds-sec.mjs';

const DAY = 86400000;
const etDay = date => new Date(date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;

export async function readLeverageDistress(dataDir) {
  const read = async key => { try { return JSON.parse(await readFile(resolve(dataDir, key), 'utf8')); } catch { return null; } };
  return { payload: await read(LEVERAGE_DISTRESS_KEY), state: await read(LEVERAGE_DISTRESS_STATE_KEY) };
}
export async function writeLeverageDistress(dataDir, { payload, state }) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(resolve(dataDir, LEVERAGE_DISTRESS_KEY), JSON.stringify(payload), 'utf8');
  await writeFile(resolve(dataDir, LEVERAGE_DISTRESS_STATE_KEY), JSON.stringify(state), 'utf8');
}

// Our stocks' names (SEC title and Yahoo name) and their closes on a quarter
// end, for tying 13F CUSIPs to tracked tickers.
export function universeMatchers(universe, chains, directory, period) {
  const titles = new Map(Object.values(directory || {}).map(e => [String(e?.ticker || '').toUpperCase(), e?.title]));
  return (universe || []).map(symbol => {
    const f = chains[symbol]?.fundamentals || {};
    const keys = new Set([titles.get(symbol), f.name, f.longName, f.shortName].filter(Boolean).map(issuerNameKey).filter(k => k.length >= 2));
    return { symbol, keys, close: period ? closeOnOrBefore(chains[symbol], period)?.close ?? null : null };
  }).filter(u => u.keys.size);
}

async function quoteBatch(quoteClient, symbols, deadline) {
  const out = {}, errors = [];
  const list = [...new Set(symbols.filter(s => /^[A-Z][A-Z0-9.-]{0,9}$/.test(s)))];
  for (let i = 0; i < list.length; i += 50) {
    if (Date.now() > deadline) { errors.push({ stage: 'quotes', message: 'Quote budget reached' }); break; }
    try {
      const got = await quoteClient.quote(list.slice(i, i + 50), { fields: ['symbol', 'regularMarketPrice', 'regularMarketTime', 'fiftyTwoWeekLow', 'fiftyTwoWeekHigh', 'currency'] }, { validateResult: false });
      for (const q of Array.isArray(got) ? got : got ? [got] : []) {
        const t = q?.regularMarketTime ? new Date(q.regularMarketTime) : null;
        if (q?.symbol && positive(q.regularMarketPrice) && t && Number.isFinite(t.getTime())) out[String(q.symbol).toUpperCase()] = { price: q.regularMarketPrice, asOf: t.toISOString(),
          low52: positive(q.fiftyTwoWeekLow) ? q.fiftyTwoWeekLow : null, high52: positive(q.fiftyTwoWeekHigh) ? q.fiftyTwoWeekHigh : null, currency: q.currency || null };
      }
    } catch (e) { errors.push({ stage: 'quotes', message: e.message }); }
  }
  return { quotes: out, errors };
}

// Fund assets change slowly. One read per product per ET day; a failed read
// keeps the prior figure with its own date (used for up to ten days).
async function refreshEtfAum({ singles, prior = {}, quoteClient, now, deadline, maxSymbols = 70 }) {
  const aum = { ...prior }, errors = [];
  const today = etDay(now);
  const symbols = Object.values(singles || {}).flatMap(d => [d?.bull?.sym, d?.bear?.sym]).filter(Boolean);
  let reads = 0;
  for (const sym of symbols) {
    if (aum[sym]?.checkedDay === today || reads >= maxSymbols) continue;
    if (Date.now() > deadline) { errors.push({ stage: 'etf-aum', message: 'ETF asset budget reached' }); break; }
    reads++;
    try {
      const s = await quoteClient.quoteSummary(sym, { modules: ['summaryDetail', 'defaultKeyStatistics'] }, { validateResult: false });
      const value = s?.summaryDetail?.totalAssets ?? s?.defaultKeyStatistics?.totalAssets;
      aum[sym] = positive(value) ? { aum: value, asOf: now, checkedDay: today } : { ...(aum[sym] || {}), checkedDay: today };
    } catch (e) { errors.push({ stage: 'etf-aum', symbol: sym, message: e.message }); aum[sym] = { ...(aum[sym] || {}), checkedDay: today }; }
  }
  const usable = Object.fromEntries(Object.entries(aum).filter(([, a]) => positive(a?.aum) && Date.parse(now) - Date.parse(a.asOf) <= 10 * DAY));
  return { aum, usable, reads, errors };
}

export async function refreshLeverageDistress({ prior = null, priorState = null, universe = [], chains = {}, now = new Date().toISOString(), fetchImpl = fetch, quoteClient = null,
  cusipMapper = null, levEtfSingles = {}, groupOf = () => null, allowBulk = true, userAgent = process.env.SEC_USER_AGENT || 'stonks-app build-pipeline contact@example.com',
  bulkBudgetMs = 150000, submissionsBudgetMs = 30000, quoteBudgetMs = 25000, aumBudgetMs = 30000, directory = null }) {
  const errors = [];
  let state = priorState?.version === LEVERAGE_DISTRESS_VERSION ? { ...priorState } : { version: LEVERAGE_DISTRESS_VERSION };
  state.hotFunds = { ...(state.hotFunds || {}) };
  let hf = state.hotFunds;
  const coverage = { bulk: { status: 'skipped' }, submissions: null, quotes: null, aum: null };

  // 1. Discover the SEC's 13F windows (once per ET day).
  const today = etDay(now);
  if (hf.windowsCheckedDay !== today) {
    try {
      const res = await fetchImpl(F13_DATA_SETS_PAGE, { headers: { 'User-Agent': userAgent, Accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
      const windows = parse13FDataSetLinks(await res.text());
      if (!windows.length) throw new Error('No 13F data sets found on the SEC page');
      hf = { ...hf, windows, windowsCheckedDay: today };
    } catch (e) { errors.push({ stage: '13f-discovery', message: e.message }); }
  }
  // 2. At most one window per build, never on a Top Picks decision run.
  const plan = hf.windows?.length ? planHotFundPass(hf, hf.windows) : null;
  if (plan && allowBulk) {
    const started = Date.now();
    try {
      let titles = directory;
      if (!titles) {
        try { const res = await fetchImpl('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); if (res.ok) titles = await res.json(); }
        catch (e) { errors.push({ stage: 'sec-directory', message: e.message }); }
      }
      const universeForPass = universeMatchers(universe, chains, titles, plan.period);
      const result = await run13FWindowPass({ plan, state: hf, universe: universeForPass, fetchImpl, userAgent, deadline: started + bulkBudgetMs });
      hf = pruneHotFundState(applyHotFundPass(hf, plan, result, now), hf.windows);
      coverage.bulk = { status: 'ok', period: plan.period, nextPeriod: plan.nextPeriod, window: plan.window.label, bytes: result.bytes, rows: result.rows, filers: result.filers, large: result.large, candidates: result.candidates, seconds: Math.round((Date.now() - started) / 1000) };
    } catch (e) { errors.push({ stage: '13f-window', period: plan.period, message: e.message }); coverage.bulk = { status: 'failed', period: plan.period, message: e.message }; }
  } else coverage.bulk = { status: plan ? 'deferred' : 'current', period: plan?.period || null };
  const pending = hf.windows?.length ? planHotFundPass(hf, hf.windows) : null;
  hf.pendingPass = pending ? { period: pending.period, nextPeriod: pending.nextPeriod } : null;

  // 3. Flagged funds from the current figures, then their own recent filings.
  let view = buildHotFundsView({ state: hf, quotes: {}, priorFunds: prior?.hotFunds?.funds || [], now, chains });
  try {
    const sub = await checkFundSubmissions({ funds: view.funds, state: hf, now, fetchImpl, userAgent, deadline: Date.now() + submissionsBudgetMs, universeCusips: hf.universeCusips || {} });
    hf = { ...hf, early13F: sub.early13F, recentFilings: sub.recentFilings, submissionChecks: sub.submissionChecks };
    coverage.submissions = { requests: sub.requests, errors: sub.errors.slice(0, 10) };
  } catch (e) { errors.push({ stage: 'fund-filings', message: e.message }); }

  // 4. Tickers for top holdings outside our universe (cached; misses retried
  // after two weeks), then live quotes.
  const cusipTickers = { ...(hf.cusipTickers || {}) }, misses = { ...(hf.cusipMisses || {}) };
  const tops = view.funds.flatMap(f => { const e = hf.early13F?.[f.cik]; return (e?.period > f.period ? e.top : hf.latest?.funds?.[f.cik]?.top) || []; });
  const unmapped = [...new Set(tops.map(r => r.cusip).filter(c => !cusipTickers[c] && !hf.universeCusips?.[c] && !(misses[c] && Date.parse(now) - Date.parse(misses[c]) < 14 * DAY)))];
  if (cusipMapper && unmapped.length) {
    try {
      // US listings only; OpenFIGI writes share classes as BRK/B, Yahoo as BRK-B.
      const mapped = await cusipMapper(unmapped.slice(0, 300), { exchCode: 'US' });
      for (const c of unmapped.slice(0, 300)) { const t = String(mapped?.get?.(c) || '').toUpperCase().replace(/[/ ]/g, '-'); if (t && /^[A-Z][A-Z0-9.-]{0,9}$/.test(t)) cusipTickers[c] = t; else misses[c] = now; }
    } catch (e) { errors.push({ stage: 'cusip-map', message: e.message }); }
  }
  hf = { ...hf, cusipTickers, cusipMisses: misses };
  const chainQuotes = Object.fromEntries(universe.filter(s => positive(chains[s]?.spot) && chains[s]?.quoteAsOf).map(s => [s, { price: chains[s].spot, asOf: chains[s].quoteAsOf }]));
  const wanted = [...new Set(tops.map(r => cusipTickers[r.cusip] || hf.universeCusips?.[r.cusip]).filter(t => t && !chainQuotes[t]))];
  let quotes = { ...chainQuotes };
  if (quoteClient && wanted.length) {
    const q = await quoteBatch(quoteClient, wanted, Date.now() + quoteBudgetMs);
    quotes = { ...quotes, ...q.quotes };
    coverage.quotes = { requested: wanted.length, received: Object.keys(q.quotes).length, errors: q.errors.slice(0, 5) };
  }
  view = buildHotFundsView({ state: hf, quotes, priorFunds: prior?.hotFunds?.funds || [], now, chains });
  const links = hotFundStockLinks(view.funds, universe, chains);

  // 5. Leveraged ETF assets and the close-of-day rebalance estimate.
  let aum = { usable: {}, aum: state.etfAum || {} };
  if (quoteClient) {
    aum = await refreshEtfAum({ singles: levEtfSingles, prior: state.etfAum || {}, quoteClient, now, deadline: Date.now() + aumBudgetMs });
    coverage.aum = { reads: aum.reads, errors: aum.errors.slice(0, 5) };
  } else aum.usable = Object.fromEntries(Object.entries(state.etfAum || {}).filter(([, a]) => positive(a?.aum) && Date.parse(now) - Date.parse(a.asOf) <= 10 * DAY));
  const rebalance = leveragedEtfRebalance({ singles: Object.fromEntries(Object.entries(levEtfSingles).filter(([u]) => universe.includes(u))), chains, aum: aum.usable, now });

  // 6. Cluster selloff, logged as a shadow signal.
  const cluster = detectClusterSelloff({ chains, universe, now, groupOf, hotFunds: view.funds });
  const clusterLog = updateClusterLog(prior?.clusters?.log, cluster);

  state = { ...state, version: LEVERAGE_DISTRESS_VERSION, hotFunds: hf, etfAum: aum.aum };
  const payload = { version: LEVERAGE_DISTRESS_VERSION, builtAtIso: now, parserVersion: HOT_FUND_PARSER_VERSION,
    hotFunds: { ...view, stockLinks: links, coverage: { ...coverage, windows: (hf.windows || []).slice(-6).map(w => ({ period: w.period, label: w.label })), pendingPass: hf.pendingPass,
      periods: Object.keys(hf.periods || {}).sort(), early13F: Object.keys(hf.early13F || {}).length, universeCusips: Object.keys(hf.universeCusips || {}).length } },
    rebalance: { asOf: now, rows: rebalance, note: 'Estimate from each fund’s last known assets and today’s move. Covers the most liquid listed product per side; other issuers add more flow.' },
    clusters: { today: cluster, log: clusterLog, policy: CLUSTER_POLICY, shadow: true },
    errors: errors.slice(0, 20) };
  return { payload, state };
}

// Minimal payload for a build that cannot collect (keeps the page honest).
export function emptyLeverageDistress(now, message) {
  return { version: LEVERAGE_DISTRESS_VERSION, builtAtIso: now, parserVersion: HOT_FUND_PARSER_VERSION,
    hotFunds: { asOf: now, latestPeriod: null, funds: [], stockLinks: [], counts: { screened: 0, flagged: 0, shown: 0, alert: 0, watch: 0, hedgedExcluded: 0, lowCoverage: 0, pressure: 0, deleveraging: 0 }, benchmark: {}, policy: HOT_FUND_POLICY, coverage: { bulk: { status: 'failed', message } } },
    rebalance: { asOf: now, rows: [] }, clusters: { today: null, log: [], policy: CLUSTER_POLICY, shadow: true }, errors: [{ stage: 'collect', message }] };
}
