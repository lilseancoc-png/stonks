// Prediction market odds tracker (lib/prediction/, 2026-11-15): which
// contracts are worth tracking, which theme each belongs to, and which covered
// stocks each one can move.
//
// Everything here is deterministic text matching on the contract's own words
// (event title, market question and outcome label). No AI call. A link carries
// a declared sign when the economics are clear before any data is seen (a Fed
// cut is good for bonds, a ceasefire is bad for oil); company and election
// links carry sign 0 and their direction is learned from the data on the fit
// half only (lib/prediction/reactions.mjs).
//
// Kept out on purpose: sports, entertainment, weather, celebrities and the
// "will X say / tweet / mention" markets. They move on things no stock cares
// about, and tracking them would only add noise to the tests.

export const THEMES = Object.freeze([
  { id: 'fed', label: 'Fed and rates', blurb: 'Rate decisions, the number of cuts and who runs the Fed.' },
  { id: 'macro', label: 'Economy', blurb: 'Inflation, jobs, growth and recession odds.' },
  { id: 'policy', label: 'Policy and trade', blurb: 'Tariffs, shutdowns, bills, court rulings and sanctions.' },
  { id: 'politics', label: 'Politics and elections', blurb: 'Elections, nominations and who holds power.' },
  { id: 'geopolitics', label: 'Geopolitics', blurb: 'Wars, ceasefires, invasions and other conflicts.' },
  { id: 'commodities', label: 'Commodities', blurb: 'Oil, gold, silver and other raw materials.' },
  { id: 'crypto', label: 'Crypto', blurb: 'Bitcoin and Ether price levels, crypto laws and ETFs.' },
  { id: 'company', label: 'Companies', blurb: 'Bets that name a covered company or its leaders.' },
  { id: 'markets', label: 'Markets', blurb: 'Index levels, volatility and the largest company.' },
]);
export const THEME_IDS = THEMES.map((t) => t.id);
export const THEME_LABEL = Object.freeze(Object.fromEntries(THEMES.map((t) => [t.id, t.label])));

// How many contracts each theme may track at once (about 160 in all). A new
// contract enters only while its theme has room; a tracked one stays until it
// settles or closes, so a busy day never pushes out a contract with history.
export const THEME_CAPS = Object.freeze({ fed: 12, macro: 16, policy: 25, politics: 20, geopolitics: 25, commodities: 12, crypto: 12, company: 30, markets: 8 });

// Contracts priced under 3% or over 97% when first seen hardly move and carry
// little news; they are not added (a tracked one that drifts there stays).
export const ADD_PROB_MIN = 0.03;
export const ADD_PROB_MAX = 0.97;
// A contract must close at least this many days after it is first seen, so
// daily index ranges and same-day markets never fill the list.
export const ADD_MIN_DAYS_TO_CLOSE = 2;
export const ADD_MAX_DAYS_TO_CLOSE = 800;
// Volume floors when first seen. Kalshi counts contracts (one dollar each at
// settlement), Polymarket counts dollars traded.
export const ADD_MIN_VOLUME = Object.freeze({ kalshi: 2000, polymarket: 50000 });
// From a multi-outcome event (who wins, which month) at most this many
// outcomes are kept, each priced at 3% or more.
export const MAX_OUTCOMES_PER_EVENT = 6;

const EXCLUDE_RE = /\b(tweets?|tweet about|post on x|posts on x|mentions?|will .{1,40} say|say the word|said|wear|tiktok|spotify|billboard|oscars?|academy awards?|grammys?|emmys?|golden globes?|box office|movie|film|album|songs?|eurovision|nfl|nba|mlb|nhl|wnba|mls|ncaa|super bowl|world series|stanley cup|world cup|champions league|premier league|ufc|boxing|wrestl|formula 1|\bf1\b|grand prix|nascar|tennis|wimbledon|golf|masters tournament|pga|olympics?|championship|playoffs?|mvp|heisman|draft pick|touchdowns?|temperature|rainfall|snowfall|hurricane|tornado|earthquake|weather|celebrity|kardashian|taylor swift|bachelor|survivor|love island|time person of the year|jeopardy|spelling bee|chess|esports|video game|gta|pope|baby|wedding|dating|divorce)\b/i;
// Kalshi series categories and Polymarket tags that are never tracked.
const EXCLUDE_CATEGORY_RE = /^(sports?|entertainment|climate( and weather)?|weather|culture|social|mentions|pop-culture|music|movies|awards|celebrities|esports|games|gaming|tweets|elon-tweets|nba|nfl|mlb|nhl|soccer|football|basketball|baseball|hockey|tennis|golf|ufc|f1|boxing)$/i;

const THEME_RULES = [
  ['fed', /\b(fed|fomc|federal reserve|interest rates?|rate (cuts?|hikes?)|cut rates|hike rates|powell|fed chair|basis points?|bps|fed funds)\b/i],
  ['macro', /\b(cpi|inflation|pce|gdp|recession|unemployment|jobless|payrolls?|jobs report|nonfarm|retail sales|ism manufacturing|consumer sentiment|treasury yields?|10-year|10y yield|2-year|economic growth|deflation|stagflation)\b/i],
  ['commodities', /\b(oil|crude|wti|brent|gas prices?|gasoline|natural gas|gold(?!\s+(?:card|medal|cup|star))|silver(?!\s+medal)|copper|opec|wheat|lithium|uranium)\b/i],
  ['crypto', /\b(bitcoin|btc|ethereum|ether|eth|solana|xrp|crypto|cryptocurrency|stablecoins?|dogecoin|strategic bitcoin reserve)\b/i],
  ['policy', /\b(tariffs?|trade deal|trade war|trade agreement|shutdown|debt ceiling|debt limit|(spending|funding|crypto|tax|budget|reconciliation|appropriations|stablecoin|immigration|border|farm|defense|omnibus|infrastructure|health ?care|market structure) (bill|act)|bill (pass|passes|passed|signed)|pass(es|ed)? the [\w\s'-]{1,30} (bill|act)|signs? the [\w\s'-]{1,30} (bill|act)|legislation|into law|executive order|supreme court|scotus|court rul\w*|sanctions?|tax cuts?|reconciliation|federal budget|deport|deportations?|immigration|antitrust|ftc|doj|regulat\w*|stimulus|minimum wage|medicare|medicaid|drug prices?|export controls?|chips act|genius act|clarity act|ban on|bans?)\b/i],
  ['geopolitics', /\b(war|wars|ceasefire|cease-fire|truce|invade|invasion|russia|russian|ukraine|putin|zelensky|israel|gaza|hamas|hezbollah|iran|iranian|taiwan|north korea|kim jong|venezuela|maduro|nato|missiles?|nuclear|military|troops|airstrikes?|houthis?|syria|pakistan|peace deal|peace agreement|peace talks|occupy|annex|greenland|panama canal|blockade)\b/i],
  ['politics', /\b(elections?|elected|wins? the|nominee|nomination|primary|presidents?|presidential|senate|house|governor|mayor|congress|democrats?|republicans?|gop|majority|impeach\w*|approval rating|resign\w*|cabinet|speaker|vice president|confirmed|confirmation|midterms?|electoral|ballot|polls?|out as|leave office|trump|vance|newsom|harris|aoc|rubio|desantis)\b/i],
  ['markets', /\b(s&p|s&p 500|spx|nasdaq|dow jones|the dow|russell 2000|vix|stock market|largest company|market cap|ipo|ipos|go public|trillion)\b/i],
];

// Words that name a covered company or one of its leaders. Ambiguous
// tickers (V, C, TGT, NOW, TEAM, SNOW, ARM, BE, DIS, HOOD, COST) are matched by
// company name only, never by the bare symbol.
export const COMPANY_TERMS = Object.freeze({
  AAPL: ['apple', 'iphone', 'tim cook'],
  MSFT: ['microsoft', 'satya nadella', 'nadella', 'openai'],
  AMZN: ['amazon', 'aws', 'andy jassy', 'anthropic'],
  META: ['meta', 'meta platforms', 'facebook', 'instagram', 'whatsapp', 'zuckerberg', 'threads app'],
  GOOGL: ['google', 'alphabet', 'sundar pichai', 'pichai', 'waymo', 'deepmind', 'anthropic'],
  TSLA: ['tesla', 'elon musk', 'robotaxi', 'cybertruck', 'cybercab', 'optimus robot'],
  NVDA: ['nvidia', 'jensen huang', 'blackwell', 'rubin gpu'],
  TSM: ['tsmc', 'taiwan semiconductor'],
  AVGO: ['broadcom', 'hock tan'],
  ORCL: ['oracle', 'larry ellison'],
  NFLX: ['netflix'],
  JPM: ['jpmorgan', 'jp morgan', 'jamie dimon', 'dimon'],
  V: ['visa inc'],
  MA: ['mastercard'],
  LLY: ['eli lilly', 'lilly', 'zepbound', 'mounjaro', 'orforglipron'],
  MRNA: ['moderna'],
  MRK: ['merck', 'keytruda'],
  WMT: ['walmart'],
  COST: ['costco'],
  CRWD: ['crowdstrike'],
  ADBE: ['adobe'],
  SHOP: ['shopify'],
  BAC: ['bank of america'],
  SCHW: ['charles schwab', 'schwab'],
  BABA: ['alibaba', 'jack ma'],
  MS: ['morgan stanley'],
  GS: ['goldman sachs'],
  HOOD: ['robinhood', 'vlad tenev'],
  AXP: ['american express'],
  AMD: ['amd', 'advanced micro devices', 'lisa su'],
  C: ['citigroup', 'citibank'],
  UNH: ['unitedhealth', 'unitedhealthcare', 'united healthcare'],
  DELL: ['dell technologies', 'michael dell'],
  ASML: ['asml'],
  VST: ['vistra'],
  NOW: ['servicenow'],
  MDB: ['mongodb'],
  ACN: ['accenture'],
  OKTA: ['okta'],
  SNOW: ['snowflake'],
  RKLB: ['rocket lab', 'neutron rocket'],
  CRM: ['salesforce', 'marc benioff', 'benioff'],
  ASTS: ['ast spacemobile', 'spacemobile'],
  FTNT: ['fortinet'],
  INTU: ['intuit', 'turbotax'],
  TEAM: ['atlassian'],
  NKE: ['nike'],
  PANW: ['palo alto networks'],
  DIS: ['disney', 'bob iger'],
  IBM: ['ibm'],
  QCOM: ['qualcomm'],
  HD: ['home depot'],
  PLTR: ['palantir', 'alex karp'],
  PYPL: ['paypal'],
  DDOG: ['datadog'],
  SBUX: ['starbucks'],
  ANET: ['arista networks'],
  TXN: ['texas instruments'],
  INTC: ['intel', 'lip-bu tan'],
  SMCI: ['supermicro', 'super micro'],
  NVO: ['novo nordisk', 'wegovy', 'ozempic'],
  CRWV: ['coreweave'],
  MRVL: ['marvell'],
  AMAT: ['applied materials'],
  MU: ['micron'],
  BE: ['bloom energy'],
  SNDK: ['sandisk'],
  WDC: ['western digital'],
  SPCX: ['spacex', 'starship', 'starlink'],
  CBRS: ['cerebras'],
  ARM: ['arm holdings'],
  VRT: ['vertiv'],
  TGT: ['target corp', 'target stores'],
  EWY: ['kospi'],
});

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = (t) => new RegExp(`(?:^|[^a-z0-9])${esc(t.toLowerCase())}(?:$|[^a-z0-9])`, 'i');
const COMPANY_RES = Object.entries(COMPANY_TERMS).map(([sym, terms]) => [sym, terms.map(termRe)]);

// Leaders' full names from the Leadership collector (chains[sym].corporate
// .people with ceo / chair), so a new CEO is matched without a code change.
// Full names only: a last name alone ("Cook", "Tan") is too often someone else.
export function leaderTerms(chains) {
  const out = {};
  for (const [sym, d] of Object.entries(chains || {})) {
    const people = Array.isArray(d?.corporate?.people) ? d.corporate.people : [];
    for (const p of people) {
      if (!(p?.ceo || p?.chair)) continue;
      const name = String(p.name || '').replace(/\b(jr|sr|ii|iii|iv)\.?$/i, '').replace(/\s+[A-Z]\.\s+/g, ' ').replace(/\s+/g, ' ').trim();
      if (name.split(' ').length < 2 || name.length < 7) continue;
      (out[sym] ||= []).push(name.toLowerCase());
    }
  }
  return out;
}

export function companyMatches(text, extraTerms = null) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const hits = [];
  for (const [sym, res] of COMPANY_RES) if (res.some((re) => re.test(t))) hits.push(sym);
  for (const [sym, names] of Object.entries(extraTerms || {})) {
    if (hits.includes(sym)) continue;
    if (names.some((n) => termRe(n).test(t))) hits.push(sym);
  }
  return hits;
}

// Stock links with a sign set before any data is seen. `test` reads the
// contract text (event title + question + outcome); `not` vetoes the rule.
// Only symbols in the covered universe are kept (linksFor drops the rest).
const TARIFF_EASE = /\b(cut|lower|lowers|lowered|reduc\w*|remove\w*|lift\w*|end|ends|pause\w*|delay\w*|exempt\w*|deal|agreement|truce|struck down|strike down|illegal|unconstitutional|refund\w*|repeal\w*|drop\w*|roll ?back)\b/i;
const TARIFF_HIT = ['SMH', 'AAPL', 'WMT', 'COST', 'TGT', 'NKE', 'KWEB', 'BABA', 'TSM', 'HD'];
const ABOVE = /\b(above|over|higher|reach|reaches|hit|hits|exceed\w*|at least|or more|or higher|greater|top|tops|surpass\w*|all[- ]time high|ath|>|≥)\b/i;
const BELOW = /\b(below|under|lower than|less than|or less|or lower|fall\w*|drop\w*|dip\w*|<|≤)\b/i;
// The metal, not a "gold card" visa or an Olympic "gold medal".
const GOLD = /\bgold\b(?!\s+(?:card|medal|cup|star))/i;
const SILVER = /\bsilver\b(?!\s+medal)/i;
// Deadline wording ("before the end of 2026", "by year-end") says when the
// contract settles, not what happens: its "end" must not read as a tariff
// ending or a shutdown ending. Rules judge the text with these removed.
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
const DATE_PHRASE = new RegExp(`\\b(?:the )?end of (?:the )?(?:(?:this|next|calendar|fiscal) )?(?:year|month|week|quarter|day|session|term|q[1-4]|(?:${MONTHS})(?: \\d{1,2})?(?:,? \\d{4})?|\\d{4})\\b|\\b(?:year|month|quarter|week)[- ]end\\b`, 'gi');
export function withoutDeadlines(text) {
  return String(text || '').replace(DATE_PHRASE, ' ').replace(/\s{2,}/g, ' ');
}
export const LINK_RULES = Object.freeze([
  { id: 'fed-cut', label: 'Fed cut', test: /\b(cuts?|decrease|lower|lowers|reduc\w*|ease|easing)\b/i, ctx: /\b(fed|fomc|federal reserve|interest rates?|fed funds|basis points?|bps)\b/i, not: /\b(no (change|cut)|hold|unchanged|pause|hike|increase|raise)\b/i, links: { SPY: 1, QQQ: 1, IWM: 1, TLT: 1 } },
  { id: 'fed-hike', label: 'Fed hike', test: /\b(hikes?|increase|raise|raises|tighten\w*)\b/i, ctx: /\b(fed|fomc|federal reserve|interest rates?|fed funds|basis points?|bps)\b/i, not: /\b(no (change|hike)|hold|unchanged|pause)\b/i, links: { SPY: -1, QQQ: -1, IWM: -1, TLT: -1 } },
  { id: 'recession', label: 'Recession', test: /\b(recession|gdp (contract\w*|negative|shrink\w*)|negative gdp|economic downturn)\b/i, not: /\b(no recession|avoid)\b/i, links: { SPY: -1, QQQ: -1, IWM: -1, TLT: 1, GLD: 1 } },
  { id: 'inflation-up', label: 'Higher inflation', test: /\b(cpi|inflation|pce)\b/i, also: ABOVE, not: BELOW, links: { TLT: -1, IWM: -1 } },
  { id: 'inflation-down', label: 'Lower inflation', test: /\b(cpi|inflation|pce)\b/i, also: BELOW, not: ABOVE, links: { TLT: 1, IWM: 1 } },
  { id: 'jobless-up', label: 'Higher unemployment', test: /\b(unemployment|jobless)\b/i, also: ABOVE, not: BELOW, links: { SPY: -1, IWM: -1, TLT: 1 } },
  { id: 'jobs-strong', label: 'Strong jobs report', test: /\b(payrolls?|jobs added|nonfarm)\b/i, also: ABOVE, not: BELOW, links: { TLT: -1 } },
  { id: 'yields-up', label: 'Higher yields', test: /\b(treasury|10-year|10y|yields?)\b/i, also: ABOVE, not: BELOW, links: { TLT: -1 } },
  { id: 'tariff-ease', label: 'Tariffs eased', test: /\btariffs?\b/i, also: TARIFF_EASE, links: Object.fromEntries(TARIFF_HIT.map((s) => [s, 1])) },
  { id: 'tariff-up', label: 'New or higher tariffs', test: /\btariffs?\b/i, not: TARIFF_EASE, links: Object.fromEntries(TARIFF_HIT.map((s) => [s, -1])) },
  { id: 'china-deal', label: 'US-China trade deal', test: /\b(trade (deal|agreement)|deal with china|china deal)\b/i, ctx: /\bchina|chinese|xi\b/i, links: { KWEB: 1, BABA: 1, SMH: 1 } },
  { id: 'shutdown', label: 'Government shutdown', test: /\b(government )?shut ?down\b/i, not: /\b(end|ends|ended|ending|is over|be over|avert\w*|avoid\w*|reopen\w*)\b/i, links: { SPY: -1 } },
  { id: 'crypto-law', label: 'Crypto law', test: /\b(crypto|stablecoin|digital asset|market structure|clarity act|genius act)\b/i, also: /\b(bill|act|law|pass\w*|sign\w*|enact\w*)\b/i, links: { HOOD: 1 } },
  { id: 'chip-curbs', label: 'Chip export curbs', test: /\b(export controls?|chip (ban|curbs?|restrictions?)|ban .{0,20}chips?)\b/i, not: TARIFF_EASE, links: { NVDA: -1, AMD: -1, SMH: -1, ASML: -1, AMAT: -1 } },
  { id: 'ceasefire', label: 'Ceasefire or peace deal', test: /\b(ceasefire|cease-fire|truce|peace (deal|agreement|talks)|end (of )?the war|war ends?|armistice)\b/i, links: { USO: -1, GLD: -1, SPY: 1 } },
  { id: 'conflict', label: 'War or military strike', test: /\b(invade\w*|invasion|attack\w*|strikes? on|airstrikes?|bomb\w*|missiles?|military (action|strike|operation)|war with|declare war|nuclear test|blockade|troops (enter|into))\b/i, not: /\b(ceasefire|cease-fire|truce|peace|end)\b/i, links: { USO: 1, GLD: 1, SPY: -1 } },
  { id: 'taiwan', label: 'Taiwan conflict', test: /\btaiwan\b/i, also: /\b(invade\w*|invasion|blockade|attack\w*|war|military|quarantine)\b/i, links: { TSM: -1, SMH: -1, NVDA: -1, AAPL: -1 } },
  { id: 'oil-up', label: 'Oil higher', test: /\b(oil|wti|crude|brent)\b/i, also: ABOVE, not: BELOW, links: { USO: 1 } },
  { id: 'oil-down', label: 'Oil lower', test: /\b(oil|wti|crude|brent)\b/i, also: BELOW, not: ABOVE, links: { USO: -1 } },
  { id: 'opec-cut', label: 'OPEC output cut', test: /\bopec\b/i, also: /\b(cut\w*|reduc\w*)\b/i, links: { USO: 1 } },
  { id: 'gold-up', label: 'Gold higher', test: GOLD, also: ABOVE, not: BELOW, links: { GLD: 1 } },
  { id: 'gold-down', label: 'Gold lower', test: GOLD, also: BELOW, not: ABOVE, links: { GLD: -1 } },
  { id: 'silver-up', label: 'Silver higher', test: SILVER, also: ABOVE, not: BELOW, links: { SLV: 1 } },
  { id: 'silver-down', label: 'Silver lower', test: SILVER, also: BELOW, not: ABOVE, links: { SLV: -1 } },
  { id: 'btc-up', label: 'Bitcoin higher', test: /\b(bitcoin|btc|ethereum|ether|eth)\b/i, also: ABOVE, not: BELOW, links: { HOOD: 1 } },
  { id: 'btc-down', label: 'Bitcoin lower', test: /\b(bitcoin|btc|ethereum|ether|eth)\b/i, also: BELOW, not: ABOVE, links: { HOOD: -1 } },
  { id: 'spx-up', label: 'S&P 500 higher', test: /\b(s&p|spx|s&p 500)\b/i, also: ABOVE, not: BELOW, links: { SPY: 1 } },
  { id: 'spx-down', label: 'S&P 500 lower', test: /\b(s&p|spx|s&p 500)\b/i, also: BELOW, not: ABOVE, links: { SPY: -1 } },
  { id: 'ndx-up', label: 'Nasdaq higher', test: /\bnasdaq\b/i, also: ABOVE, not: BELOW, links: { QQQ: 1 } },
  { id: 'ndx-down', label: 'Nasdaq lower', test: /\bnasdaq\b/i, also: BELOW, not: ABOVE, links: { QQQ: -1 } },
  { id: 'vix-up', label: 'Volatility higher', test: /\bvix\b/i, also: ABOVE, not: BELOW, links: { UVXY: 1, SPY: -1 } },
  // Sign learned from the data: who wins an election or the Fed chair seat
  // moves stocks and bonds, but which way depends on who it is.
  { id: 'fed-chair', label: 'Fed chair pick', test: /\b(fed chair|federal reserve chair|chair of the fed|lead the fed)\b/i, links: { SPY: 0, TLT: 0 } },
  { id: 'election', label: 'Election result', test: /\b(wins? the|win|control|majority|elections?|nominee|presidential|senate|house|governor|midterms?)\b/i, themes: ['politics'], links: { SPY: 0, TLT: 0, IWM: 0 } },
]);

// The text a contract is judged on.
export function contractText(c) {
  return [c?.eventTitle, c?.title, c?.outcome].filter(Boolean).join(' — ');
}

function ruleHits(rule, text, theme) {
  if (rule.themes && !rule.themes.includes(theme)) return false;
  if (!rule.test.test(text)) return false;
  if (rule.ctx && !rule.ctx.test(text)) return false;
  if (rule.also && !rule.also.test(text)) return false;
  if (rule.not && rule.not.test(text)) return false;
  return true;
}

// An outcome label on a multi-outcome event ("No change", "25 bps decrease",
// "Republicans") is the thing being priced, so rules read it first and fall
// back to the whole text. For the Fed, "No change" must not read as a cut just
// because the event title says "rate cut".
export function linksFor(c, universe, extraTerms = null) {
  const set = universe instanceof Set ? universe : new Set(universe || []);
  const theme = c.theme;
  const text = contractText(c);
  const ruleText = withoutDeadlines(text);
  const own = withoutDeadlines([c.outcome, c.title].filter(Boolean).join(' — '));
  const links = new Map();
  const add = (sym, sign, rule) => {
    if (!set.has(sym)) return;
    const prev = links.get(sym);
    if (!prev) links.set(sym, { sym, sign, rule });
    else if (prev.sign === 0 && sign !== 0) links.set(sym, { sym, sign, rule });
  };
  for (const rule of LINK_RULES) {
    // Multi-outcome events: judge the outcome's own words when it has any.
    const judged = c.outcome && rule.id.startsWith('fed-') ? `${own} ${withoutDeadlines(c.eventTitle || '').replace(/\b(cut|hike|decrease|increase)s?\b/gi, '')}` : ruleText;
    if (!ruleHits(rule, judged, theme)) continue;
    for (const [sym, sign] of Object.entries(rule.links)) add(sym, sign, rule.id);
  }
  for (const sym of companyMatches(text, extraTerms)) add(sym, 0, 'company');
  return [...links.values()].sort((a, b) => a.sym.localeCompare(b.sym));
}

// Theme from the venue's own category / tags first, refined by the words.
export function classifyTheme({ text, category = null, tags = [] } = {}) {
  const t = String(text || '');
  const cats = [category, ...(Array.isArray(tags) ? tags : [])].filter(Boolean).map((x) => String(x).trim());
  if (cats.some((x) => EXCLUDE_CATEGORY_RE.test(x))) return null;
  if (EXCLUDE_RE.test(t)) return null;
  for (const [id, re] of THEME_RULES) if (re.test(t)) {
    // "Trump" alone is politics, but a tariff or a shutdown is policy.
    return id;
  }
  const cat = cats.join(' ').toLowerCase();
  if (/\b(econom|financ)/.test(cat)) return 'macro';
  if (/\bcrypto/.test(cat)) return 'crypto';
  if (/\b(compan|business|tech)/.test(cat)) return 'company';
  if (/\b(world|geopolit)/.test(cat)) return 'geopolitics';
  if (/\b(politic|election)/.test(cat)) return 'politics';
  if (/\bcommodit/.test(cat)) return 'commodities';
  return null;
}

// Final theme for a candidate once its stock links are known: a contract
// that names a covered company but no wider theme is a company bet; one that
// matched nothing and names no company is dropped.
export function themeFor(c, universe, extraTerms = null) {
  const text = contractText(c);
  let theme = classifyTheme({ text, category: c.category, tags: c.tags });
  const companies = companyMatches(text, extraTerms).filter((s) => !universe || (universe instanceof Set ? universe.has(s) : universe.includes(s)));
  if (EXCLUDE_RE.test(text)) return null;
  if (companies.length && (theme == null || theme === 'politics' || theme === 'markets')) theme = 'company';
  return theme;
}

const STOP = new Set(['will', 'the', 'a', 'an', 'of', 'in', 'on', 'by', 'to', 'be', 'at', 'for', 'and', 'or', 'is', 'before', 'after', 'end', 'yes', 'no', 'than', 'more', 'less', '2025', '2026', '2027', '2028']);
export function titleTokens(text) {
  return new Set(String(text || '').toLowerCase().replace(/[^a-z0-9%$.\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
}
// Jaccard overlap of two titles' words, 0..1. Used to show the same question
// on both venues side by side; never used in a test.
export function titleSimilarity(a, b) {
  const A = titleTokens(a), B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}
