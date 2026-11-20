import { OWNER_PAGE_IDS } from '../../lib/owner-access-policy.mjs';

// The one site map. The sidebar (html.mjs), the page headers, previous/next
// links, Home's "Explore by topic" tiles, the phone tab bar and the command
// palette (app-js.mjs) all read these sections, so a page moves or gets renamed
// in exactly one place. Ids are the page-tab ids every ?tab= link, pin and
// saved choice already uses — never rename an id here, only its label.
//
// label: what the sidebar shows. alias: the older or more technical name, kept
// searchable in the sidebar filter and the command palette. blurb: the plain
// one-line "what this shows" under each page's section header.
// navHidden: in the DOM for links and the palette, not in the visible sidebar.
// hub: pages that answer one question share one sidebar entry (the hub) and
// show as tabs under one page title (2026-11-17 streamline). Every member
// keeps its own page id, loader and Owner gate, so old links, pins and saved
// views open the same content. A hub is all public or all Owner, never mixed,
// and its members sit next to each other in one section.

export const SITE_HUBS = {
  'daily-brief': { label: 'Daily brief', blurb: 'The day in one place: the digest, what changed since the last session, the overnight markets and earlier days.' },
  screener: { label: 'Screener', blurb: 'Every tracked stock in one list or on one map, sorted and filtered on any number.' },
  'price-signals': { label: 'Price signals', blurb: 'Moving averages, up/down streaks and unusual trading volume across every tracked stock.' },
  ownership: { label: 'Ownership & deals', blurb: 'What big funds and insiders bought and sold, and the takeovers still pending.' },
  'earnings-hub': { label: 'Earnings', blurb: 'This season in one place: the week ahead, results, what management said and how peers react.' },
  'commodities-hub': { label: 'Commodities', blurb: 'Raw material prices and the stocks they move, plus central-bank gold buying.' },
  sentiment: { label: 'Sentiment & odds', blurb: 'How investors feel, how traders are positioned, what prediction markets price and what people search for.' },
  'history-hub': { label: 'History', blurb: 'Booms and busts, seasonal patterns and the daily index moves of past months.' },
  'ai-hub': { label: 'AI tracker', blurb: 'What big tech spends on AI and what the AI labs ship.' },
  'chip-prices': { label: 'Chip & AI prices', blurb: 'Memory chip prices and GPU rental prices, two weekly reads on the chip cycle.' },
  guides: { label: 'Guides', blurb: 'Plain-English guides to options, chart patterns, market words and when the data updates.' },
  'owner-brief': { label: 'Owner brief', blurb: 'The private daily read and the market themes behind it.' },
  'market-risk': { label: 'Market risk', blurb: 'Every market risk read in one place, with one line on where they agree and why they can differ.' },
  'idea-desks': { label: 'Idea desks', blurb: 'LEAPS, stock picks, leveraged ETFs and sector rotation, each with its own sizing.' },
  'research-labs': { label: 'Research labs', blurb: 'Quant labs and the Owner Lab research screens, records, tests, Regime Lab and loop.' },
  'company-models': { label: 'Company models', blurb: 'Earnings forecasts and the valuation lab for single companies.' },
  'owner-history': { label: 'Owner history', blurb: 'The stored history behind the private research, and how markets did under each party.' },
  admin: { label: 'Admin', blurb: 'Site switches with history and undo, and build health.' },
};

export const SITE_SECTIONS = [
  {
    id: 'today', label: 'Today', short: 'Today', desc: 'What is happening in the market right now',
    items: [
      { id: 'home', label: 'Home', blurb: 'A one-screen overview of the market and every part of the site.' },
      { id: 'brief', hub: 'daily-brief', label: 'Market brief', alias: 'Brief', blurb: 'A short digest of what moved, why, and what is coming up next.' },
      { id: 'whats-changed', hub: 'daily-brief', label: 'What changed', alias: 'Since yesterday diff changes new walls crosses streaks insiders', blurb: 'What is new since the previous trading day: option walls and trades, average crosses, streaks, filings and insider trades.' },
      { id: 'overnight', hub: 'daily-brief', label: 'Overnight markets', blurb: 'How Asian and European markets traded before the US open, and which US stocks they tend to lead.' },
      { id: 'past-day', hub: 'daily-brief', label: 'Past days', alias: 'Time machine history date picker archive replay', blurb: 'Pick an earlier trading day and see the heatmap and index moves as they were.' },
      { id: 'news', label: 'News', alias: 'News desk', blurb: 'Market-moving stock and economic headlines, most important first.' },
      { id: 'heatmap', label: 'Heatmap', blurb: 'Every tracked stock as a tile: size is company value, color is how much it moved.' },
      { id: 'calendar', label: 'Calendar', blurb: 'Upcoming earnings reports, economic releases and Fed meetings.' },
    ],
  },
  {
    id: 'stocks', label: 'Stocks', short: 'Stocks', desc: 'Look up, screen, compare and follow companies',
    items: [
      { id: 'stock', label: 'Look up a stock', alias: 'Stock page quote ticker company chart', blurb: 'One company: its price chart, key numbers, news, earnings, options and who owns it.' },
      // The grade is a tab of the stock page now; this id stays so old links
      // and pins redirect there (selectTab in app-js.mjs).
      { id: 'grade', label: 'Grade a stock', navHidden: true, alias: 'Grade a ticker stock report Look up', blurb: 'One stock in depth: its grade, setup signals, fundamentals and the option contract to trade.' },
      { id: 'tickers', hub: 'screener', label: 'All stocks', alias: 'Tickers', blurb: 'Every stock the site follows, with its price, returns and sector.' },
      { id: 'market-map', hub: 'screener', label: 'Market map', alias: 'Fear map scatter chart wall sparklines correlation crowding breadth short interest crowded shorts', blurb: 'Every tracked stock on one screen: options fear, any two numbers, every chart, what moves together, breadth and short interest.' },
      { id: 'ma-tracker', hub: 'price-signals', label: 'Moving averages', alias: 'MA tracker crossover', blurb: 'Stocks sitting close to their 20, 50, 100 or 200-day average price.' },
      { id: 'streaks', hub: 'price-signals', label: 'Up/down streaks', alias: 'Streaks green red', blurb: 'Stocks on a run of up days or down days in a row.' },
      { id: 'volume', hub: 'price-signals', label: 'Trading volume', alias: 'Volume shares', blurb: 'Days when a stock traded many more or fewer shares than usual.' },
      { id: 'compare', label: 'Compare stocks', alias: 'Compare companies', blurb: 'Line up a few companies side by side on price, growth and valuation.' },
      { id: 'f13', hub: 'ownership', label: 'Who owns what', alias: 'SEC ownership 13F Form 4 insider', blurb: 'What big investment funds bought and sold last quarter, plus recent insider trades.' },
      { id: 'pending-buyouts', hub: 'ownership', label: 'Pending buyouts', alias: 'M&A mergers', blurb: 'Announced and rumored takeovers, and how far along each deal is.' },
    ],
  },
  {
    id: 'earnings', label: 'Earnings', short: 'Earnings', desc: 'Results, what management said, and how peers react',
    items: [
      { id: 'earnings-week', hub: 'earnings-hub', label: 'Earnings week ahead', alias: 'Earnings board implied move expected move straddle this week', blurb: 'Every covered report in the next 10 days: the move options expect next to the stock’s own past moves.' },
      { id: 'earnings', hub: 'earnings-hub', label: 'Earnings results', alias: 'Earnings tracker', blurb: 'Which companies beat or missed expectations this season, and how their stocks reacted.' },
      { id: 'calls', hub: 'earnings-hub', label: 'Earnings calls', blurb: 'What management said on each company’s latest earnings call, and what changed.' },
      { id: 'spillover', hub: 'earnings-hub', label: 'Earnings ripple effects', alias: 'Event spillover', blurb: 'How one company’s earnings tend to move the other stocks in its industry.' },
    ],
  },
  {
    id: 'options', label: 'Options activity', short: 'Options', desc: 'Where traders are placing bets',
    items: [
      { id: 'flow', label: 'Unusual options trades', alias: 'Unusual flow', blurb: 'Option trades far bigger than normal for that stock, a sign someone expects a move.' },
      { id: 'oi', label: 'Options walls', alias: 'Gamma exposure GEX', blurb: 'Price levels where large option positions can slow a stock down or speed it up.' },
      { id: 'iv-trend', label: 'Rising volatility', alias: 'Trending IV implied volatility', blurb: 'Stocks whose options are pricing in a bigger move than usual.' },
    ],
  },
  {
    id: 'market', label: 'Markets & economy', short: 'Market', desc: 'The big picture: rates, commodities, mood, money and history',
    items: [
      { id: 'bonds-usd', label: 'Rates & the dollar', alias: 'Bonds & USD Fed', blurb: 'Treasury yields, the US dollar and what the Fed is expected to do next.' },
      { id: 'commodities', hub: 'commodities-hub', label: 'Commodities', blurb: 'Oil, gold, copper and other raw materials, and the stocks that move with them.' },
      { id: 'central-bank-gold', hub: 'commodities-hub', label: 'Central-bank gold', blurb: 'How much gold the world’s central banks are buying or selling.' },
      { id: 'fear-greed', hub: 'sentiment', label: 'Market mood', alias: 'Fear & Greed', blurb: 'CNN’s Fear & Greed index: whether investors are acting scared or greedy, from 0 to 100.' },
      { id: 'crowd', hub: 'sentiment', label: 'Crowd & positioning', alias: 'Positioning put call ratio COT commitments of traders margin debt short volume borrow fee Reddit mentions Wikipedia Stocktwits Kalshi odds perps Hyperliquid leveraged ETF flows', blurb: 'How traders are positioned and where the crowd is looking: put/call ratios, futures, margin debt, short selling, attention, odds.' },
      { id: 'prediction-markets', hub: 'sentiment', label: 'Prediction markets', alias: 'Kalshi Polymarket odds betting markets election odds Fed cut odds tariffs ceasefire war recession odds event contracts what traders are betting on', blurb: 'What traders on Kalshi and Polymarket bet on: the Fed, policy, elections, wars, crypto and companies, and the stocks each bet could move.' },
      { id: 'search-interest', hub: 'sentiment', label: 'Search trends', alias: 'Search interest Google', blurb: 'Which market themes people are searching for more or less this week.' },
      { id: 'capital-raises', label: 'Capital markets', alias: 'Capital raises share sales buybacks IPOs credit issuance debt', blurb: 'Companies selling stock or debt or buying shares back, upcoming IPOs, and how easily companies and households can borrow.' },
      { id: 'history-rhymes', hub: 'history-hub', label: 'Booms & busts', alias: 'History rhymes historical case studies railroad railway mania panic of 1873 telecom fiber dot-com bubble 2008 financial crisis housing subprime AI data center buildout GPU debt depreciation credit default swaps CDS credit spreads default risk Merton', blurb: 'Railroads, telecom fiber and the 2008 housing crash beside today’s AI data center buildout, and how many of their warning signs show now.' },
      { id: 'pattern-lab', hub: 'history-hub', label: 'Pattern lab', alias: 'Seasonality', blurb: 'Repeating patterns such as seasonality and how stocks behave after big moves.' },
      { id: 'index-cal', hub: 'history-hub', label: 'Daily index moves', alias: 'Index calendar', blurb: 'A month grid of the major index funds’ daily moves, showing which days the whole market joined in.' },
    ],
  },
  {
    id: 'industry', label: 'Industry trends', short: 'Industry', desc: 'Real-world data behind the AI and chip trade',
    items: [
      { id: 'ai-capex', hub: 'ai-hub', label: 'AI spending', alias: 'AI CapEx', blurb: 'How much the biggest tech companies are spending on AI data centers.' },
      { id: 'ai-disruption', hub: 'ai-hub', label: 'AI disruption', alias: 'AI launches labs OpenAI Anthropic Google Gemini Microsoft Copilot Meta xAI Grok release notes software disruption SaaS capture score', blurb: 'What the AI labs ship, how ready each launch is to take customers from traditional software, and which companies it targets.' },
      { id: 'ram-prices', hub: 'chip-prices', label: 'Memory chip prices', alias: 'RAM prices DRAM', blurb: 'Weekly prices for computer memory, a read on the chip cycle.' },
      { id: 'accelerator-prices', hub: 'chip-prices', label: 'GPU cloud prices', alias: 'Accelerator', blurb: 'What it costs to rent AI chips by the hour, a read on AI demand.' },
    ],
  },
  {
    id: 'learn', label: 'Learn & help', short: 'Learn', desc: 'Guides and when the data updates',
    items: [
      { id: 'cheatsheet', hub: 'guides', label: 'Options guide', alias: "Buyer's manual", blurb: 'A plain-English guide to buying options: calls, puts, risk and timing.' },
      { id: 'chart-patterns', hub: 'guides', label: 'Chart patterns', blurb: 'What common chart shapes look like and how traders read them.' },
      { id: 'glossary', hub: 'guides', label: 'Glossary', alias: 'Words terms definitions meaning C/P OI IV percentile gamma', blurb: 'Plain-English meanings for the options and market words used on this site.' },
      { id: 'timeline', hub: 'guides', label: 'When data updates', alias: 'Refresh schedule timeline', blurb: 'When each part of the site refreshes during the trading day.' },
      { id: 'contact', label: 'Send us a message', alias: 'Contact us feedback message email support help question bug report', blurb: 'Send the site owners a question, idea or bug report, with an email or social link if you want a reply.' },
      // Privacy and Terms are linked from the footer, so they stay out of the
      // visible menu but remain searchable and linkable.
      { id: 'privacy', label: 'Privacy Policy', navHidden: true, blurb: 'What this site collects and how it is used.' },
      { id: 'terms', label: 'Terms of Use', navHidden: true, blurb: 'The terms for using this site. Nothing here is investment advice.' },
    ],
  },
  // The Owner pages sit in four groups at the bottom of the sidebar, apart
  // from every public group, so the Owner can always tell what visitors see.
  // Ids never change, only the grouping.
  {
    id: 'owner', label: 'Owner · Desk', short: 'Owner', desc: 'The private daily read', owner: true,
    items: [
      { id: 'owner-market-brief', hub: 'owner-brief', label: 'Owner Market Brief', alias: 'Private digest outlook predictions scenarios research', blurb: 'The full site read, with private research, conditional paths, counterevidence and a curated review shortlist.' },
      { id: 'narratives', hub: 'owner-brief', label: 'Market themes', alias: 'Narratives', blurb: 'The big stories driving money right now, such as AI spending, and which stocks ride them.' },
      { id: 'market', hub: 'market-risk', label: 'Market analysis', blurb: 'The cross-asset tape, risk barometer and regime history.' },
      { id: 'risk', hub: 'market-risk', label: 'Risk analysis', blurb: 'Seven risk desks read together, with the reason when they disagree.' },
      { id: 'bottom-tracker', hub: 'market-risk', label: 'Bottom tracker', blurb: 'Signs the market is washing out and turning.' },
      { id: 'unified-signal-engine', label: 'Unified Signal Engine', blurb: 'Existing decisions with separate investment and trading perspectives.' },
    ],
  },
  {
    id: 'owner-ideas', label: 'Owner · Trades', short: 'Trades', desc: 'Trade ideas and how they worked out', owner: true,
    items: [
      { id: 'picks', label: 'Top picks', blurb: 'The model’s highest-conviction option contracts for today.' },
      { id: 'open-picks', label: 'Open picks', alias: 'Check a position you hold Personal tools', blurb: 'Every open Webull paper trade, Top Picks and the strategy engines, with copy-ready trade lines and a checker for a contract you hold.' },
      { id: 'track', label: 'Top Picks track record', blurb: 'How every closed pick worked out.' },
      { id: 'engines', label: 'Strategy engines', alias: 'Paper engines earnings macro technicals fundamentals flow reversion downside puts trend momentum rotation multi-asset allocator ERN MAC TEC FUN FLO REV DWN TRD MOM ROT', blurb: 'Ten rules-only paper engines beside Top Picks, each with its own trades and record, and the Allocator’s read of every setup.' },
      { id: 'strategies', label: 'Strategy builder', alias: 'Strategies', blurb: 'Pick a stock and build a defined-risk options trade, with its profit and loss at expiry.' },
      { id: 'leaps', hub: 'idea-desks', label: 'LEAPS', blurb: 'Names scored for a one- to two-year options hold.' },
      { id: 'stocks', hub: 'idea-desks', label: 'Stock picks', alias: 'Daily DCA dial VOO QQQ', blurb: 'Quality companies on a dip, as shares rather than options, and your daily VOO and QQQ amount.' },
      { id: 'levetf', hub: 'idea-desks', label: 'Leveraged ETFs', blurb: 'Leveraged ETF setups from the same engine, with sizing for your account.' },
      { id: 'rotation', hub: 'idea-desks', label: 'Sector rotation', blurb: 'Strong names sold with their sector that are now turning back up, with sizing for your account.' },
    ],
  },
  {
    id: 'owner-research', label: 'Owner · Research', short: 'Research', desc: 'Private studies and data', owner: true,
    items: [
      { id: 'quant-labs', hub: 'research-labs', label: 'Quant labs', alias: 'Market odds drawdown chance calibration factors volatility forecast annual report risk factors registry', blurb: 'Chance of a market fall, how honest the site\'s stated chances have been, factor and volatility reads, annual report changes.' },
      { id: 'quant', hub: 'research-labs', label: 'Owner Lab', blurb: 'Research screens, stored records, tests and gates, Regime Lab and the loop.' },
      { id: 'earnings-forecast', hub: 'company-models', label: 'Earnings Forecast', alias: 'Quarterly full-year valuation company history revenue EPS industry model', blurb: 'Quarterly forecasts for the top 20 covered companies, company history, full-year valuation and linked industry evidence.' },
      { id: 'valuation-lab', hub: 'company-models', label: 'Valuation lab', alias: 'Valuation DCF discounted cash flow fair value intrinsic value price discovery multiples peers PEG book value residual income rate sensitivity reverse DCF what is priced in scenarios tariffs taxes election analysts', blurb: 'Value a stock eight ways in 28 environments, then see what the price assumes and what analysts may be missing.' },
      { id: 'historical-data', hub: 'owner-history', label: 'Historical Data', blurb: 'The stored history behind the private research.' },
      { id: 'party-tracker', hub: 'owner-history', label: 'Party tracker', alias: 'Party-Tracker Democrats Republicans president house senate', blurb: 'How the market and each sector did when Democrats or Republicans held the presidency, the House, or the Senate.' },
      { id: 'forced-liquidation', label: 'Forced Liquidation Tracker', alias: 'Pledged shares collateral leverage margin', blurb: 'SEC stock pledges, loan terms and estimated price thresholds, with missing terms kept visible.' },
    ],
  },
  {
    id: 'owner-admin', label: 'Owner · Admin', short: 'Admin', desc: 'Settings and build health', owner: true,
    items: [
      { id: 'owner-settings', hub: 'admin', label: 'Settings', alias: 'Owner settings switches kill switch toggles config controls', blurb: 'Change Top Picks, research and live site switches on the site, with history and undo.' },
      { id: 'update-checker', hub: 'admin', label: 'Update Checker', alias: 'Build status failures feature health stale missing updates', blurb: 'Build failures and checks of published feature outputs.' },
    ],
  },
  // Private, separate from the market research. Owner-only like the sections above.
  {
    id: 'sports', label: 'Sports', short: 'Sports', desc: 'Private NBA and NFL research', owner: true,
    items: [
      { id: 'sports-nba', label: 'NBA', alias: 'Basketball players props points rebounds games win bust track record PrizePicks', blurb: 'NBA games, two-player PrizePicks combinations across the slate, supporting analysis and the prop track record.' },
      { id: 'sports-nfl', label: 'NFL', alias: 'Football players props passing yards receptions games win bust track record PrizePicks', blurb: 'NFL games, the best two PrizePicks props per game, supporting analysis and the prop track record.' },
      { id: 'sports-pick-builder', label: 'Pick Builder', alias: 'Sports picks entry payout paper journal PrizePicks Betr', blurb: 'Build a 1 to 6 pick entry with its real payout, see the odds and save it as a paper pick.' },
    ],
  },
];

for (const section of SITE_SECTIONS) for (const item of section.items) item.owner = OWNER_PAGE_IDS.includes(item.id);

// Hub rules, checked when this module loads so a bad edit fails every build
// and test: a known hub, members side by side in one section, and one access
// level per hub (all public or all Owner), so merging pages never mixes
// Owner content into a public page.
for (const section of SITE_SECTIONS) {
  let prev = null;
  const seen = new Set();
  for (const item of section.items) {
    if (item.hub) {
      if (!SITE_HUBS[item.hub]) throw new Error(`site-map: unknown hub ${item.hub} on ${item.id}`);
      if (item.hub !== prev && seen.has(item.hub)) throw new Error(`site-map: hub ${item.hub} members must sit together`);
      if (item.navHidden) throw new Error(`site-map: hub member ${item.id} cannot be navHidden`);
      seen.add(item.hub);
    }
    prev = item.hub || null;
  }
}
for (const hubId of Object.keys(SITE_HUBS)) {
  const members = SITE_SECTIONS.flatMap((s) => s.items.filter((it) => it.hub === hubId).map((it) => ({ it, s })));
  if (members.length < 2) throw new Error(`site-map: hub ${hubId} needs two or more pages`);
  if (new Set(members.map((m) => m.s.id)).size !== 1) throw new Error(`site-map: hub ${hubId} spans sections`);
  if (new Set(members.map((m) => !!m.it.owner)).size !== 1) throw new Error(`site-map: hub ${hubId} mixes Owner and public pages`);
  if (!!members[0].it.owner !== !!members[0].s.owner) throw new Error(`site-map: hub ${hubId} sits in a section of the other access level`);
}

// The pages of one hub, in sidebar order.
export function hubMembers(hubId) {
  return SITE_SECTIONS.flatMap((s) => s.items.filter((it) => it.hub === hubId).map((it) => it.id));
}

// Phone tab bar: four sections plus the existing search.
export const TAB_BAR_SECTIONS = ['today', 'stocks', 'market', 'options'];

// Compact copy for the browser: [sectionId, label, short, desc, owner, items[[id,label,alias,blurb,navHidden,hub]]].
export function siteMapForClient() {
  return SITE_SECTIONS.map((s) => [
    s.id, s.label, s.short, s.desc, s.owner ? 1 : 0,
    s.items.map((it) => [it.id, it.label, it.alias || '', it.blurb || '', it.navHidden ? 1 : 0, it.hub || '']),
  ]);
}

// Compact hub copy for the browser: { hubId: [label, blurb] }.
export function siteHubsForClient() {
  return Object.fromEntries(Object.entries(SITE_HUBS).map(([id, h]) => [id, [h.label, h.blurb]]));
}
