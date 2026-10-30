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
export const SITE_SECTIONS = [
  {
    id: 'today', label: 'Today', short: 'Today', desc: 'What is happening in the market right now',
    items: [
      { id: 'home', label: 'Home', blurb: 'A one-screen overview of the market and every part of the site.' },
      { id: 'brief', label: 'Market brief', alias: 'Brief', blurb: 'A short digest of what moved, why, and what is coming up next.' },
      { id: 'news', label: 'News', alias: 'News desk', blurb: 'Market-moving stock and economic headlines, most important first.' },
      { id: 'heatmap', label: 'Heatmap', blurb: 'Every tracked stock as a tile: size is company value, color is how much it moved.' },
      { id: 'calendar', label: 'Calendar', blurb: 'Upcoming earnings reports, economic releases and Fed meetings.' },
      { id: 'overnight', label: 'Overnight markets', blurb: 'How Asian and European markets traded before the US open, and which US stocks they tend to lead.' },
    ],
  },
  {
    id: 'stocks', label: 'Stocks', short: 'Stocks', desc: 'Look up, compare and follow companies',
    items: [
      { id: 'tickers', label: 'All stocks', alias: 'Tickers', blurb: 'Every stock the site follows, with its price, returns and sector.' },
      { id: 'grade', label: 'Look up a stock', alias: 'Grade a ticker stock report', blurb: 'One stock in depth: its chart, grade, fundamentals, options and news.' },
      { id: 'compare', label: 'Compare stocks', alias: 'Compare companies', blurb: 'Line up a few companies side by side on price, growth and valuation.' },
      { id: 'earnings', label: 'Earnings results', alias: 'Earnings tracker', blurb: 'Which companies beat or missed expectations this season, and how their stocks reacted.' },
      { id: 'calls', label: 'Earnings calls', blurb: 'What management said on each company’s latest earnings call, and what changed.' },
      { id: 'f13', label: 'Who owns what', alias: 'SEC ownership 13F Form 4 insider', blurb: 'What big investment funds bought and sold last quarter, plus recent insider trades.' },
      { id: 'pending-buyouts', label: 'Pending buyouts', alias: 'M&A mergers', blurb: 'Announced and rumored takeovers, and how far along each deal is.' },
    ],
  },
  {
    id: 'market', label: 'Market & economy', short: 'Market', desc: 'The big picture: mood, rates, money and themes',
    items: [
      { id: 'fear-greed', label: 'Market mood', alias: 'Fear & Greed', blurb: 'CNN’s Fear & Greed index: whether investors are acting scared or greedy, from 0 to 100.' },
      { id: 'bonds-usd', label: 'Rates & the dollar', alias: 'Bonds & USD Fed', blurb: 'Treasury yields, the US dollar and what the Fed is expected to do next.' },
      { id: 'commodities', label: 'Commodities', blurb: 'Oil, gold, copper and other raw materials, and the stocks that move with them.' },
      { id: 'central-bank-gold', label: 'Central-bank gold', blurb: 'How much gold the world’s central banks are buying or selling.' },
      { id: 'capital-raises', label: 'Capital markets', alias: 'Capital raises share sales buybacks IPOs credit issuance debt', blurb: 'Companies selling stock or debt or buying shares back, upcoming IPOs, and how easily companies and households can borrow.' },
      { id: 'narratives', label: 'Market themes', alias: 'Narratives', blurb: 'The big stories driving money right now, such as AI spending, and which stocks ride them.' },
    ],
  },
  {
    id: 'options', label: 'Options activity', short: 'Options', desc: 'Where traders are placing bets',
    items: [
      { id: 'flow', label: 'Unusual options trades', alias: 'Unusual flow', blurb: 'Option trades far bigger than normal for that stock, a sign someone expects a move.' },
      { id: 'volume', label: 'Trading volume', alias: 'Volume', blurb: 'Days when a stock traded much more or less than usual.' },
      { id: 'oi', label: 'Options walls', alias: 'Gamma exposure GEX', blurb: 'Price levels where large option positions can slow a stock down or speed it up.' },
      { id: 'iv-trend', label: 'Rising volatility', alias: 'Trending IV implied volatility', blurb: 'Stocks whose options are pricing in a bigger move than usual.' },
      { id: 'strategies', label: 'Strategy builder', alias: 'Strategies', blurb: 'Pick a stock and build a defined-risk options trade, with its profit and loss at expiry.' },
    ],
  },
  {
    id: 'signals', label: 'Charts & signals', short: 'Signals', desc: 'Price trends and repeating patterns',
    items: [
      { id: 'ma-tracker', label: 'Moving averages', alias: 'MA tracker crossover', blurb: 'Stocks sitting close to their 20, 50, 100 or 200-day average price.' },
      { id: 'streaks', label: 'Up/down streaks', alias: 'Streaks green red', blurb: 'Stocks on a run of up days or down days in a row.' },
      { id: 'pattern-lab', label: 'Pattern lab', alias: 'Seasonality', blurb: 'Repeating patterns such as seasonality and how stocks behave after big moves.' },
      { id: 'spillover', label: 'Earnings ripple effects', alias: 'Event spillover', blurb: 'How one company’s earnings tend to move the other stocks in its industry.' },
      { id: 'index-cal', label: 'Index calendar', blurb: 'A month view of the major index funds, showing which days the whole market joined in.' },
    ],
  },
  {
    id: 'industry', label: 'Industry trends', short: 'Industry', desc: 'Real-world data behind the AI and chip trade',
    items: [
      { id: 'ai-capex', label: 'AI spending', alias: 'AI CapEx', blurb: 'How much the biggest tech companies are spending on AI data centers.' },
      { id: 'ram-prices', label: 'Memory chip prices', alias: 'RAM prices DRAM', blurb: 'Weekly prices for computer memory, a read on the chip cycle.' },
      { id: 'accelerator-prices', label: 'GPU cloud prices', alias: 'Accelerator', blurb: 'What it costs to rent AI chips by the hour, a read on AI demand.' },
      { id: 'search-interest', label: 'Search trends', alias: 'Search interest Google', blurb: 'Which market themes people are searching for more or less this week.' },
    ],
  },
  {
    id: 'learn', label: 'Learn & help', short: 'Learn', desc: 'Guides, definitions and site info',
    items: [
      { id: 'cheatsheet', label: 'Options guide', alias: "Buyer's manual", blurb: 'A plain-English guide to buying options: calls, puts, risk and timing.' },
      { id: 'chart-patterns', label: 'Chart patterns', blurb: 'What common chart shapes look like and how traders read them.' },
      { id: 'timeline', label: 'When data updates', alias: 'Refresh schedule timeline', blurb: 'When each part of the site refreshes during the trading day.' },
      { id: 'privacy', label: 'Privacy Policy', blurb: 'What this site collects and how it is used.' },
      { id: 'terms', label: 'Terms of Use', blurb: 'The terms for using this site. Nothing here is investment advice.' },
    ],
  },
  {
    id: 'owner', label: 'Owner', short: 'Owner', desc: 'Private research', owner: true,
    items: [
      { id: 'unified-signal-engine', label: 'Unified Signal Engine', blurb: 'Existing decisions with separate investment and trading perspectives.' },
      { id: 'market', label: 'Market analysis', blurb: 'The cross-asset tape, risk barometer and regime history.' },
      { id: 'risk', label: 'Risk analysis', blurb: 'Seven risk desks read together, with the reason when they disagree.' },
      { id: 'bottom-tracker', label: 'Bottom tracker', blurb: 'Signs the market is washing out and turning.' },
      { id: 'historical-data', label: 'Historical Data', blurb: 'The stored history behind the private research.' },
      { id: 'party-tracker', label: 'Party tracker', alias: 'Party-Tracker Democrats Republicans president house senate', blurb: 'How the market and each sector did when Democrats or Republicans held the presidency, the House, or the Senate.' },
      { id: 'earnings-forecast', label: 'Earnings Forecast', alias: 'Quarterly full-year valuation company history revenue EPS industry model', blurb: 'Quarterly forecasts for the top 20 covered companies, company history, full-year valuation and linked industry evidence.' },
      { id: 'forced-liquidation', label: 'Forced Liquidation Tracker', alias: 'Pledged shares collateral leverage margin', blurb: 'SEC stock pledges, loan terms and estimated price thresholds, with missing terms kept visible.' },
      { id: 'picks', label: 'Top picks', blurb: 'The model’s highest-conviction option contracts for today.' },
      { id: 'leaps', label: 'LEAPS', blurb: 'Names scored for a one- to two-year options hold.' },
      { id: 'stocks', label: 'Stock picks', blurb: 'Quality companies on a dip, as shares rather than options.' },
      { id: 'rotation', label: 'Sector rotation', blurb: 'Strong names sold with their sector that are now turning back up.' },
      { id: 'levetf', label: 'Leveraged ETFs', blurb: 'Leveraged ETF setups from the same engine.' },
      { id: 'open-picks', label: 'Open picks', blurb: 'Every open trade, with lines ready to copy to a broker.' },
      { id: 'track', label: 'Top Picks track record', blurb: 'How every closed pick worked out.' },
      { id: 'quant', label: 'Owner Lab', blurb: 'Research tools and diagnostics.' },
    ],
  },
];

for (const section of SITE_SECTIONS) for (const item of section.items) item.owner = OWNER_PAGE_IDS.includes(item.id);

// Phone tab bar: four sections plus the existing search.
export const TAB_BAR_SECTIONS = ['today', 'stocks', 'market', 'options'];

// Compact copy for the browser: [sectionId, label, short, desc, owner, items[[id,label,alias,blurb,navHidden]]].
export function siteMapForClient() {
  return SITE_SECTIONS.map((s) => [
    s.id, s.label, s.short, s.desc, s.owner ? 1 : 0,
    s.items.map((it) => [it.id, it.label, it.alias || '', it.blurb || '', it.navHidden ? 1 : 0]),
  ]);
}
