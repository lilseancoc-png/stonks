// Booms & busts: historical buildout and credit-bubble case studies, set next
// to what the same measures read today (2026-11-12).
//
// Deterministic. Every input is already in memory at bake time: the long
// history cache (Nasdaq / S&P 500 closes, FRED series in SHARED_FRED_EXTRA),
// the AI spending file (ai-capex.json), the GPU cloud price file
// (accelerator-prices.json), the corporate bond issuance block of
// ipo-credit.json and the per-stock chains. No provider call, no AI call.
//
// Two outputs:
//   history-rhymes.json        public: case studies, dated facts with sources,
//                              market-wide "warning signs" read today, charts.
//                              No per-stock credit model, no idea or ranking.
//   history-rhymes-owner.json  Owner-only: per-stock buildout role, an
//                              equity-implied (Merton) default read, reported
//                              CDS quotes joined by ticker, leverage and the
//                              history of each role. Research only; it does
//                              not change a grade, a pick or the track record.
//
// Single-name CDS prices are sold by data vendors (S&P Global / Markit, LSEG,
// Bloomberg, ICE). There is no free daily feed, so the page shows CDS levels
// only as dated quotes reported in the press, and the free model next to them
// is labeled as a model.

export const HISTORY_RHYMES_KEY = 'history-rhymes.json';
export const HISTORY_RHYMES_OWNER_KEY = 'history-rhymes-owner.json';
export const HISTORY_RHYMES_VERSION = 1;
// FRED series this page reads from the shared long-history cache
// (SHARED_FRED_EXTRA in lib/historical-sources.mjs). Each is shown with its
// publisher and FRED link.
export const HISTORY_RHYMES_FRED = Object.freeze(['BAA10Y', 'BAMLH0A0HYM2', 'BAMLC0A0CM', 'USSTHPI', 'MORTGAGE30US', 'DRSFRMACBS', 'PRCMUCONS']);

const DAY = 86400000;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (n) => (finite(n) ? Math.round(n * 10) / 10 : null);
const joinAnd = (xs) => (xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const ordinal = (n) => { const a = Math.abs(n) % 100, b = Math.abs(n) % 10; return n + (a >= 11 && a <= 13 ? 'th' : b === 1 ? 'st' : b === 2 ? 'nd' : b === 3 ? 'rd' : 'th'); };
const r2 = (n) => (finite(n) ? Math.round(n * 100) / 100 : null);
const pct = (from, to) => (finite(from) && finite(to) && from !== 0 ? (to / from - 1) * 100 : null);
const ms = (t) => Date.parse(`${String(t).slice(0, 10)}T00:00:00Z`);

// ---------------------------------------------------------------------------
// Sources. Every dated fact on the page points at one of these.
export const SOURCES = Object.freeze({
  odlyzko: { label: 'Odlyzko, "Collective hallucinations and inefficient markets: The British Railway Mania of the 1840s" (2010)', url: 'https://www-users.cse.umn.edu/~odlyzko/doc/mania06.pdf' },
  railwayMania: { label: 'Railway Mania (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Railway_Mania' },
  panic1873: { label: 'Panic of 1873 (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Panic_of_1873' },
  panic1893: { label: 'Panic of 1893 (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Panic_of_1893' },
  nberFreight: { label: 'NBER Macrohistory: revenue per freight ton-mile, thirteen railroads (FRED A0303FUSA259NNBR)', url: 'https://fred.stlouisfed.org/series/A0303FUSA259NNBR' },
  brookings: { label: 'Litan, "The Telecommunications Crash: What To Do Now?" Brookings Policy Brief 112 (December 2002)', url: 'https://www.brookings.edu/articles/the-telecommunications-crash-what-to-do-now/' },
  worldcom: { label: 'CNN Money, "WorldCom files for bankruptcy" (July 2002)', url: 'https://money.cnn.com/2002/07/19/news/worldcom_bankruptcy/index.htm' },
  fredComm: { label: 'US Census private construction spending: communication (FRED PRCMUCONS)', url: 'https://fred.stlouisfed.org/series/PRCMUCONS' },
  fredHpi: { label: 'FHFA all-transactions house price index (FRED USSTHPI)', url: 'https://fred.stlouisfed.org/series/USSTHPI' },
  fredMort: { label: 'Freddie Mac 30-year fixed mortgage rate (FRED MORTGAGE30US)', url: 'https://fred.stlouisfed.org/series/MORTGAGE30US' },
  fredDelinq: { label: 'Federal Reserve: delinquency rate on single-family mortgages, all commercial banks (FRED DRSFRMACBS)', url: 'https://fred.stlouisfed.org/series/DRSFRMACBS' },
  fredBaa: { label: "Moody's Baa corporate bond yield minus the 10-year Treasury (FRED BAA10Y)", url: 'https://fred.stlouisfed.org/series/BAA10Y' },
  fredHy: { label: 'ICE BofA US high-yield option-adjusted spread (FRED BAMLH0A0HYM2)', url: 'https://fred.stlouisfed.org/series/BAMLH0A0HYM2' },
  fcic: { label: 'Financial Crisis Inquiry Commission report (2011)', url: 'https://www.govinfo.gov/content/pkg/GPO-FCIC/pdf/GPO-FCIC.pdf' },
  siliconData: { label: 'Silicon Data, "H100 rental price over time" (H100 Rental Price Index)', url: 'https://www.silicondata.com/blog/h100-rental-price-over-time' },
  gpuLife: { label: 'Data Gravity, "How long does a GPU last?"', url: 'https://www.datagravity.dev/p/how-long-does-a-gpu-last' },
  reutersCds: { label: 'Reuters, "AI credit fears push tech default insurance to record highs" (October 15, 2026)', url: 'https://www.businessday.co.za/world/international-companies/2026-10-15-ai-credit-fears-push-tech-default-insurance-to-record-highs/' },
  reutersCrwv: { label: "Reuters factbox, CoreWeave's AI contracts and the lenders financing its build-out (October 15, 2026)", url: 'https://whbl.com/2026/10/15/factbox-coreweaves-ai-contracts-and-the-lenders-financing-its-build-out/' },
  fortuneHyperion: { label: "Fortune, \"Meta's $27 billion bet turns AI compute into Wall Street's hottest new investment\" (October 31, 2025)", url: 'https://fortune.com/2025/10/31/metas-27-billion-bet-turns-ai-compute-into-wall-streets-hottest-new-investment/' },
  spOracle: { label: 'S&P Global Ratings, Oracle Corp. (BBB-, stable), July 8, 2026', url: 'https://www.spglobal.com/ratings/en/regulatory/article/-/view/type/HTML/id/3591397' },
  sbsdr: { label: 'Clarus, "SBSDR: credit derivative volumes" (SEC security-based swap public reports)', url: 'https://www.clarusft.com/sbsdr-credit-derivative-volumes' },
  telecomAct: { label: 'Statement on signing the Telecommunications Act of 1996 (American Presidency Project, February 8, 1996)', url: 'https://www.presidency.ucsb.edu/documents/statement-signing-the-telecommunications-act-1996' },
  globalCrossing: { label: 'Benzinga, "This day in market history: Global Crossing files for bankruptcy" (January 28, 2002)', url: 'https://www.benzinga.com/general/education/21/01/19369738/this-day-in-market-history-global-crossing-files-for-bankruptcy' },
  dotcom: { label: 'Dot-com bubble (Wikipedia): Nasdaq peak of March 10, 2000; Cisco lost 80% of its value', url: 'https://en.wikipedia.org/wiki/Dot-com_bubble' },
  corning: { label: 'ISE Magazine, "The perils of irrational exuberance": Corning from over $100 (October 2000) to around $2 (October 2002)', url: 'https://isemag.com/professional-development-leadership/article/55293922/the-perils-of-irrational-exuberancethe-25th-anniversary-of-the-dot-com-boom' },
  chatgpt: { label: 'OpenAI, "Introducing ChatGPT" (November 30, 2022)', url: 'https://openai.com/index/chatgpt/' },
});

// Revenue per freight ton-mile on thirteen US railroads, cents (NBER
// Macrohistory series a0303f, via FRED). Fixed history, copied from the FRED
// table on 2026-11-12.
export const RAIL_FREIGHT_CENTS = Object.freeze([
  [1865, 3.078], [1866, 2.741], [1867, 2.527], [1868, 2.398], [1869, 2.153], [1870, 1.802], [1871, 1.707], [1872, 1.676],
  [1873, 1.641], [1874, 1.530], [1875, 1.360], [1876, 1.189], [1877, 1.147], [1878, 1.051], [1879, 0.902], [1880, 1.011],
  [1881, 0.942], [1882, 0.945], [1883, 0.991], [1884, 0.915], [1885, 0.827], [1886, 0.857], [1887, 0.817], [1888, 0.775],
  [1889, 0.809], [1890, 0.803],
]);
// British railway mileage in service (Odlyzko 2010, table 1, end points).
export const UK_RAIL_MILES = Object.freeze([[1844, 2240], [1851, 6890]]);
// H100 rental price per GPU-hour, segment medians (Silicon Data). Periods are
// the source's own ranges; `d` is the midpoint used to draw them.
export const H100_RENTAL_HISTORY = Object.freeze([
  { period: 'Aug–Dec 2023', d: '2023-10-15', hyperscaler: 7.76, marketplace: null, neocloud: null },
  { period: 'Jan–May 2024', d: '2024-03-15', hyperscaler: 7.92, marketplace: null, neocloud: null },
  { period: 'Jun–Dec 2024', d: '2024-09-15', hyperscaler: 9.34, marketplace: 2.58, neocloud: 2.99 },
  { period: 'Jan–May 2025', d: '2025-03-15', hyperscaler: 8.96, marketplace: 2.29, neocloud: 3.50 },
  { period: 'Jun 2025', d: '2025-06-15', hyperscaler: 6.94, marketplace: 2.00, neocloud: 3.29 },
  { period: 'Jul–Dec 2025', d: '2025-10-01', hyperscaler: 6.26, marketplace: 1.95, neocloud: 3.33 },
]);

// Credit default swap levels reported in the press. Dated snapshots, not a
// feed: refresh by hand when a new quote is published. The Credit tab says
// how old the newest one is and warns once it is more than
// REPORTED_CDS_STALE_DAYS old (credit.reportedStale in the public file).
export const REPORTED_CDS = Object.freeze([
  { name: 'CoreWeave', symbol: 'CRWV', date: '2026-10-15', bp: 1000, approx: 'above', impliedPdPct: 63, tenor: '5-year', note: 'Above 1,000 basis points (S&P Global Market Intelligence and LSEG). Reuters: about a 63% chance of default over five years, up from about 30% a year earlier. Its 2032 bonds traded near 78 cents, yielding just over 16% (Tradeweb).', source: 'reutersCds' },
  { name: 'SoftBank Group', symbol: null, date: '2026-10-15', bp: 424, tenor: '5-year', note: 'Widened 24 basis points that day (S&P Global Market Intelligence). Not a covered stock; a large AI investor and borrower.', source: 'reutersCds' },
  { name: 'Oracle', symbol: 'ORCL', date: '2026-10-15', bp: 288, tenor: '5-year', note: 'Unchanged on the day, up from 260 a week earlier (S&P Global Market Intelligence). Rated BBB- (S&P, stable, July 2026), the lowest investment grade.', source: 'reutersCds' },
  { name: 'Oracle', symbol: 'ORCL', date: '2026-10-08', bp: 260, tenor: '5-year', note: 'A week before the October 15 reading (same report).', source: 'reutersCds' },
  { name: 'Amazon, Alphabet, Meta, Nvidia', symbol: null, symbols: ['AMZN', 'GOOGL', 'META', 'NVDA'], date: '2026-10-15', bp: null, tenor: '5-year', note: 'At record highs, levels not published in the report. They rose more slowly than Oracle or CoreWeave.', source: 'reutersCds' },
]);
export const REPORTED_CDS_STALE_DAYS = 60;

// ---------------------------------------------------------------------------
// The warning signs. Each is read today from site data and was present (or
// not) in each historical case. `then` is what it looked like in history.
export const SIGNS = Object.freeze([
  { id: 'capex-vs-revenue', label: 'Spending grows faster than revenue', then: 'Telecom carriers poured more than $500 billion into networks in the five years after 1996 (Brookings). Railroads in the 1840s and 1880s built lines ahead of traffic.' },
  { id: 'capex-intensity', label: 'Builders spend a record share of sales', then: 'In each buildout, builders spent a rising share of revenue on new capacity until lenders and shareholders stopped funding it.' },
  { id: 'capex-vs-cash', label: 'Spending outruns operating cash flow', then: 'Telecom upstarts and 1870s and 1880s railroads built with borrowed money, not cash flow. The incumbents that paid from cash flow cut back and survived.' },
  { id: 'price-falls', label: 'The price of what is built keeps falling', then: 'US railroad freight revenue per ton-mile fell 74% from 1865 to 1890 as track tripled. By 2002 no more than 2% of North American long-distance fiber capacity was in use (Brookings).' },
  { id: 'debt-funding', label: 'Debt and off-balance-sheet deals fund the build', then: 'Railroad bonds (Northern Pacific, 1873) and telecom junk bonds (Global Crossing, WorldCom) funded the buildouts. In housing, borrowers took loans they could carry only while prices rose.' },
  { id: 'credit-strain', label: 'Credit markets start to charge more', then: 'Corporate spreads widened through 2000–2002 and from 2007. The Baa spread reached its highs in late 2008.' },
  { id: 'weak-link', label: 'The most indebted builder cracks', then: 'Jay Cooke & Co. failed in September 1873 and the Reading railroad in February 1893. Global Crossing filed in January 2002, WorldCom in July. New Century, a large subprime lender, filed in April 2007, 17 months before Lehman.' },
  { id: 'price-stretch', label: 'Stock prices run far above trend', then: 'The British railway share index peaked in summer 1845. The Nasdaq peaked on March 10, 2000, after more than doubling in a year.' },
  { id: 'leaders-crack', label: 'Supplier stocks fall while spending still rises', then: 'Telecom equipment makers peaked in 2000 while carriers kept building into 2001; Cisco lost about 80% of its value, and Corning fell from over $100 to around $2 by October 2002.' },
]);
const SIGN_IDS = SIGNS.map((s) => s.id);

// Which signs each case showed (written from the history above, not fitted).
const CASE_SIGNS = Object.freeze({
  railroads: ['capex-vs-revenue', 'capex-intensity', 'capex-vs-cash', 'price-falls', 'debt-funding', 'credit-strain', 'weak-link', 'price-stretch'],
  telecom: ['capex-vs-revenue', 'capex-intensity', 'capex-vs-cash', 'price-falls', 'debt-funding', 'credit-strain', 'weak-link', 'price-stretch', 'leaders-crack'],
  housing: ['capex-vs-cash', 'debt-funding', 'credit-strain', 'weak-link', 'price-stretch', 'leaders-crack'],
});

export const CASES = Object.freeze([
  {
    id: 'railroads', name: 'Railroads', era: '1840s Britain, 1866–1896 United States', kind: 'buildout',
    summary: 'A new technology set off a building frenzy. Track tripled, the price of shipping fell year after year, and the companies and lenders that built ahead of demand went bust in waves. The rails themselves stayed and carried the economy for a century.',
    story: [
      'Britain, 1840s. Parliament passed 263 acts for new railway companies in 1846 alone, proposing about 9,500 miles of line. The best-known index of railway shares fell from 167.9 in the summer of 1845 to 60.5 at the end of 1849, a 64% drop. About a third of the authorised lines were never built, yet mileage in service still tripled, from 2,240 miles in 1844 to 6,890 in 1851.',
      'United States, 1868–1873. About 33,000 miles of track were laid in five years, much of it paid for with bonds. Jay Cooke & Co., which could not sell Northern Pacific bonds, failed on September 18, 1873; the New York Stock Exchange closed for ten days, 55 railroads failed by November and 60 more within a year. New construction fell from 7,500 miles in 1872 to 1,600 in 1875.',
      'United States, 1880s–1893. Railroads were overbuilt again in the 1880s. The Philadelphia and Reading went into receivership on February 20, 1893, and one-fourth of all US rail mileage ended up in receivership, including the Northern Pacific, Union Pacific and Santa Fe.',
      'The price of the service kept falling the whole time. Revenue per freight ton-mile on thirteen railroads fell from 3.08 cents in 1865 to 0.80 cents in 1890, down 74%, as competing lines chased the same traffic.',
    ],
    timeline: [
      ['1845-08-01', 'British railway share index peaks at 167.9', 'odlyzko', 'Summer 1845'],
      ['1846-12-31', '263 railway acts passed in the year, about 9,500 miles proposed', 'railwayMania', '1846'],
      ['1849-12-31', 'Railway share index at 60.5, down 64% from the peak', 'odlyzko', 'End of 1849'],
      ['1873-09-18', 'Jay Cooke & Co. fails on Northern Pacific bonds; the NYSE closes for ten days from September 20', 'panic1873'],
      ['1874-09-18', 'About 115 railroads have failed: 55 by November 1873 and 60 more by the first anniversary', 'panic1873', 'By September 1874'],
      ['1893-02-20', 'Philadelphia and Reading Railroad in receivership', 'panic1893'],
      ['1894-06-30', 'One-fourth of US rail mileage in receivership, including the Northern Pacific, Union Pacific and Santa Fe', 'panic1893', '1893–1894'],
    ],
    numbers: [
      { label: 'British railway shares, 1845 peak to 1849', value: '−64%', source: 'odlyzko' },
      { label: 'British mileage in service, 1844 to 1851', value: '2,240 → 6,890 miles', source: 'odlyzko' },
      { label: 'US track laid 1868–1873', value: '≈33,000 miles', source: 'panic1873' },
      { label: 'US freight revenue per ton-mile, 1865 to 1890', value: '3.08¢ → 0.80¢ (−74%)', source: 'nberFreight' },
      { label: 'US rail mileage in receivership after 1893', value: 'one-fourth', source: 'panic1893' },
    ],
    rhyme: 'Today the thing being built is computing capacity, and its price (the hourly rent of an AI chip) has been falling the way freight rates did. Builders that borrow against that capacity are the part of the story that went bust before.',
    differs: 'Railroads were built by many small, thinly funded companies. Most of today\'s data center spending comes from a handful of companies with large cash flows; the borrowed money is concentrated in a few newer builders and in project financing.',
    sources: ['odlyzko', 'railwayMania', 'panic1873', 'panic1893', 'nberFreight'],
  },
  {
    id: 'telecom', name: 'Telecom and fiber', era: '1996–2002', kind: 'buildout',
    summary: 'After the 1996 Telecommunications Act, carriers laid fiber far ahead of traffic. Capacity outran demand, bandwidth prices fell, the most indebted builders failed, and the Nasdaq lost most of its value. The fiber stayed in the ground and later carried broadband, streaming and the cloud.',
    story: [
      'Telecom companies poured more than $500 billion into fiber, switches and wireless networks in the five years after the 1996 act. Much of it was funded with debt by newer carriers competing with the incumbents.',
      'By December 2002, no more than 2% of North American long-distance capacity was in use, about half a million telecom workers had lost their jobs, and shareholders had lost roughly $2 trillion (Brookings).',
      'Global Crossing filed for bankruptcy on January 28, 2002. WorldCom followed on July 21, 2002, then the largest bankruptcy in US history, with about $107 billion of assets.',
      'Equipment makers peaked first. Their stocks topped out in 2000 while carriers were still spending; when orders stopped, Cisco lost about 80% of its value, and Corning fell from over $100 in October 2000 to around $2 two years later.',
    ],
    timeline: [
      ['1996-02-08', 'Telecommunications Act of 1996 signed', 'telecomAct'],
      ['2000-03-10', 'Nasdaq Composite closing high (5,048.62)', 'dotcom'],
      ['2002-01-28', 'Global Crossing files for bankruptcy', 'globalCrossing'],
      ['2002-07-21', 'WorldCom files, about $107 billion of assets', 'worldcom'],
      ['2002-10-09', 'Nasdaq Composite closing low', null],
      ['2002-12-01', 'Brookings: no more than 2% of long-distance capacity in use', 'brookings', 'December 2002'],
    ],
    numbers: [
      { label: 'Telecom spending in the five years after 1996', value: '> $500 billion', source: 'brookings' },
      { label: 'Long-distance capacity in use, late 2002', value: '≤ 2%', source: 'brookings' },
      { label: 'Jobs lost in the industry', value: '≈ 500,000', source: 'brookings' },
      { label: 'WorldCom assets at filing', value: '≈ $107 billion', source: 'worldcom' },
    ],
    rhyme: 'This is the closest match. Big spending on long-lived network gear, financed partly with debt, justified by traffic forecasts. Today\'s version is data centers and chips justified by forecasts of AI demand.',
    differs: 'Fiber lasts decades; an AI chip\'s rental value falls within a few years, which makes the debt riskier, not safer. On the other side, today\'s largest spenders pay mostly from cash flow, and data center use is high rather than 2%.',
    sources: ['brookings', 'telecomAct', 'globalCrossing', 'worldcom', 'dotcom', 'corning', 'fredComm'],
  },
  {
    id: 'housing', name: 'Housing and the 2008 credit crisis', era: '2000–2009', kind: 'credit',
    summary: 'Cheap credit and loose lending let people buy houses with borrowed money they could repay only if prices kept rising. When prices stopped rising, defaults spread from the weakest borrowers to the lenders and then to the banks that held the loans.',
    story: [
      'Lenders made loans with little or no proof of income, often with low starting rates that reset higher. That worked while house prices rose, because a borrower in trouble could sell or refinance.',
      'Prices peaked and the weakest lenders failed first. New Century, one of the largest subprime lenders, filed for bankruptcy on April 2, 2007. Two Bear Stearns hedge funds collapsed that summer, and BNP Paribas froze three funds on August 9, 2007.',
      'The losses reached the banks. Bear Stearns was rescued on March 14, 2008; Lehman Brothers filed on September 15, 2008, and Washington Mutual was seized ten days later.',
      'The numbers on this page come from the FRED history: how far house prices fell, how high mortgage delinquencies went and how wide corporate credit spreads got.',
    ],
    timeline: [
      ['2007-04-02', 'New Century, a large subprime lender, files for bankruptcy', 'fcic'],
      ['2007-08-09', 'BNP Paribas freezes three funds tied to US subprime loans', 'fcic'],
      ['2007-10-09', 'S&P 500 closing high', null],
      ['2008-03-14', 'Bear Stearns rescued', 'fcic'],
      ['2008-09-15', 'Lehman Brothers files for bankruptcy', 'fcic'],
      ['2009-03-09', 'S&P 500 closing low', null],
    ],
    numbers: [],
    rhyme: 'Borrowing to buy an asset whose value you assume will hold. In 2006 it was houses bought with loans the borrower could not carry from income; today it is chips bought with loans repaid from rental contracts with a few customers, several of which do not yet earn a profit.',
    differs: 'Houses mostly kept their value over time; a chip loses rental value every year by design, so the collateral shrinks even without a crash. On the other side, the 2008 losses sat inside banks funded by deposits and short-term money; much of today\'s data center debt sits with private credit funds and bond investors.',
    sources: ['fcic', 'fredHpi', 'fredMort', 'fredDelinq'],
  },
  {
    id: 'ai-buildout', name: 'AI data centers (now)', era: '2023–today', kind: 'now',
    summary: 'The largest technology companies are spending at a record pace on data centers and chips. Most of it is paid from cash flow, but a growing share is borrowed: secured loans backed by chips, high-yield bonds, convertibles and off-balance-sheet project companies. The rent for a GPU-hour has been falling as supply arrives.',
    story: [
      'Spending. The AI spending page tracks the capital spending of the biggest builders from their SEC filings; this page reads its growth against their revenue growth.',
      'Borrowing. CoreWeave had about $50 billion of debt by October 2026, including about $26.6 billion of term loans backed by its chips and customer contracts, and senior notes with coupons of 8.5% to 9.75%. Microsoft was about 67% of its 2025 revenue (Reuters).',
      'Off the balance sheet. Meta\'s $27 billion Hyperion data center in Louisiana is owned 80% by Blue Owl and 20% by Meta through a project company; its bonds yielded 6.58% at issue (Fortune, October 2025).',
      'Depreciation. Microsoft moved servers from four to six years of useful life, Meta to 5.5 years (January 2025); Amazon moved some servers back from six years to five in 2025. A longer life lowers yearly depreciation and raises reported profit; the chips physically run seven to nine years, but their rental value falls much faster.',
      'Credit markets. On October 15, 2026, five-year credit default swaps were about 288 basis points for Oracle and above 1,000 for CoreWeave, and record highs for Amazon, Alphabet, Meta and Nvidia (Reuters).',
    ],
    timeline: [
      ['2022-11-30', 'ChatGPT launches', 'chatgpt'],
      ['2025-01-15', 'Meta extends server life to 5.5 years', 'gpuLife', 'January 2025'],
      ['2025-10-31', 'Meta Hyperion: $27 billion project company, 80% Blue Owl', 'fortuneHyperion', 'October 2025'],
      ['2026-07-08', 'S&P rates Oracle BBB-, the lowest investment grade', 'spOracle'],
      ['2026-10-15', 'CDS: Oracle 288 bp, CoreWeave above 1,000 bp', 'reutersCds'],
    ],
    numbers: [
      { label: 'CoreWeave debt, October 2026', value: '≈ $50 billion', source: 'reutersCrwv' },
      { label: 'CoreWeave secured term loans (chips and contracts)', value: '≈ $26.6 billion', source: 'reutersCrwv' },
      { label: 'Microsoft share of CoreWeave 2025 revenue', value: '≈ 67%', source: 'reutersCrwv' },
      { label: 'Meta Hyperion project financing', value: '$27 billion, 80% Blue Owl', source: 'fortuneHyperion' },
      { label: 'H100 rent, hyperscaler median, late 2023 → late 2025', value: '$7.76 → $6.26 per hour', source: 'siliconData' },
      { label: 'H100 rent, marketplace median, late 2024 → late 2025', value: '$2.58 → $1.95 per hour', source: 'siliconData' },
    ],
    rhyme: 'Spending well ahead of proven revenue, a falling price for the capacity being built, and a growing pile of debt at the weakest builders: the same three ingredients as the railroads and telecom.',
    differs: 'The biggest spenders are far more profitable than telecom carriers were in 2000, and AI capacity is in heavy use today. The page counts the warning signs from current data; it does not predict when or whether a bust comes.',
    sources: ['chatgpt', 'reutersCrwv', 'fortuneHyperion', 'gpuLife', 'siliconData', 'reutersCds', 'spOracle'],
  },
]);

// Buildout roles for the covered stocks (Owner view). Each role carries what
// happened to the same role in past busts.
export const ROLES = Object.freeze({
  spender: { label: 'Cash-funded builder', history: 'In telecom, the incumbents that paid for networks from cash flow cut spending when demand stalled and survived; their shares still fell with the market.', symbols: ['MSFT', 'GOOGL', 'AMZN', 'META'] },
  borrower: { label: 'Debt-funded builder', history: 'The borrowers went first every time: Jay Cooke and the Northern Pacific (1873), the Reading (1893), Global Crossing and WorldCom (2002). Shareholders were mostly wiped out; the assets were sold to new owners.', symbols: ['ORCL', 'CRWV'] },
  supplier: { label: 'Chip and equipment supplier', history: 'Equipment makers peaked before their customers stopped spending. Cisco lost about 80% of its value and Corning fell from over $100 to around $2 after their 2000 highs; Nortel later went bankrupt (2009). Orders fall faster than the build slows.', symbols: ['NVDA', 'AMD', 'AVGO', 'TSM', 'MU', 'MRVL', 'ARM', 'ASML', 'AMAT', 'SMCI', 'DELL', 'ANET', 'SNDK', 'WDC', 'DRAM', 'CBRS', 'INTC', 'QCOM', 'TXN', 'SMH'] },
  power: { label: 'Power and data center infrastructure', history: 'After the 2001 rush to build power plants, merchant generators that had borrowed to build failed as power prices fell: Mirant (2003) and Calpine (2005).', symbols: ['VST', 'VRT', 'BE'] },
  user: { label: 'Software that rents the capacity', history: 'Cheap leftover capacity helped the users: after 2002, idle fiber carried the growth of broadband, streaming and cloud services at falling cost.', symbols: ['PLTR', 'NOW', 'CRM', 'SNOW', 'DDOG', 'MDB', 'ADBE', 'TEAM', 'INTU'] },
});
export function roleOf(sym) {
  for (const [id, r] of Object.entries(ROLES)) if (r.symbols.includes(sym)) return id;
  return null;
}

// ---------------------------------------------------------------------------
// Small series helpers.
function rowsOf(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({ t: r?.t ?? r?.date, v: num(r?.v ?? r?.c ?? r?.value) }))
    .filter((r) => typeof r.t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.t) && r.v != null)
    .sort((a, b) => a.t.localeCompare(b.t));
}
// Last row on or before a date.
function at(rows, t) {
  let lo = 0, hi = rows.length - 1, out = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].t <= t) { out = rows[m]; lo = m + 1; } else hi = m - 1; }
  return out;
}
function between(rows, from, to) { return rows.filter((r) => r.t >= from && r.t <= to); }
function maxRow(rows) { return rows.reduce((a, r) => (!a || r.v > a.v ? r : a), null); }
function minRow(rows) { return rows.reduce((a, r) => (!a || r.v < a.v ? r : a), null); }
// One row per period key (week = ISO Monday date, month = YYYY-MM): the last
// observation in the period. Keeps payloads small.
function thin(rows, unit) {
  const out = new Map();
  for (const r of rows) {
    let k;
    if (unit === 'month') k = r.t.slice(0, 7);
    else { const d = new Date(ms(r.t)); const dow = (d.getUTCDay() + 6) % 7; k = new Date(ms(r.t) - dow * DAY).toISOString().slice(0, 10); }
    out.set(k, r);
  }
  return [...out.values()];
}
function percentileOf(rows, v) {
  const vals = rows.map((r) => r.v).filter(finite);
  if (!vals.length || !finite(v)) return null;
  return Math.round(vals.filter((x) => x <= v).length / vals.length * 100);
}
function sma(rows, n) {
  if (rows.length < n) return null;
  return rows.slice(-n).reduce((s, r) => s + r.v, 0) / n;
}
function changeOver(rows, sessions) {
  if (rows.length <= sessions) return null;
  return pct(rows[rows.length - 1 - sessions].v, rows[rows.length - 1].v);
}
// Value change over a calendar window (for weekly/monthly series).
function deltaOverDays(rows, days) {
  const last = rows.at(-1);
  if (!last) return null;
  const then = at(rows, new Date(ms(last.t) - days * DAY).toISOString().slice(0, 10));
  return then ? last.v - then.v : null;
}

// Peak-to-trough read of a window.
function episode(rows, from, to) {
  const w = between(rows, from, to);
  if (w.length < 2) return null;
  const peak = maxRow(w);
  const after = w.filter((r) => r.t >= peak.t);
  const trough = minRow(after);
  return { peak: { t: peak.t, v: r2(peak.v) }, trough: { t: trough.t, v: r2(trough.v) }, changePct: r1(pct(peak.v, trough.v)) };
}

// ---------------------------------------------------------------------------
// Equity-implied credit (Merton 1974). Equity is a call on the firm's assets
// with the debt as strike. Given market value of equity, debt and equity
// volatility, solve for the asset value and asset volatility, then read the
// chance that assets end below the debt at the horizon (risk-neutral, drift r)
// and the matching credit spread. A model, not a market quote: it ignores
// debt maturities, covenants, customer contracts and support from owners, and
// it tends to understate spreads for short horizons.
function ncdf(x) {
  // Abramowitz-Stegun 7.1.26 on erf; max error ~1.5e-7.
  const s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}
export function mertonCredit({ equity, debt, sigmaE, r = 0.04, years = 5 } = {}) {
  const E = num(equity), D = num(debt), sE = num(sigmaE), T = num(years), rf = num(r) ?? 0.04;
  if (!(E > 0) || !(D > 0) || !(sE > 0) || !(T > 0)) return null;
  const DF = D * Math.exp(-rf * T), sqT = Math.sqrt(T);
  let V = E + DF, sV = Math.max(0.01, sE * E / V);
  let d1 = 0, d2 = 0, ok = false;
  for (let i = 0; i < 500; i += 1) {
    d1 = (Math.log(V / D) + (rf + sV * sV / 2) * T) / (sV * sqT);
    d2 = d1 - sV * sqT;
    const N1 = Math.max(ncdf(d1), 1e-9);
    const f = V * N1 - DF * ncdf(d2) - E;
    const Vn = Math.max(V - f / N1, E);
    const sVn = Math.min(5, Math.max(0.005, sE * E / (Vn * N1)));
    const done = Math.abs(Vn - V) / V < 1e-10 && Math.abs(sVn - sV) < 1e-10;
    V = Vn; sV = sVn;
    if (done) { ok = true; break; }
  }
  d1 = (Math.log(V / D) + (rf + sV * sV / 2) * T) / (sV * sqT);
  d2 = d1 - sV * sqT;
  const pd = ncdf(-d2);
  // Risk-neutral yield spread on the zero-coupon debt in the same model.
  const inner = ncdf(d2) + (V / DF) * ncdf(-d1);
  const spread = inner > 0 && inner < 1 ? -Math.log(inner) / T : inner >= 1 ? 0 : null;
  return {
    pdPct: r1(pd * 100), distance: r2(d2), assetVolPct: r1(sV * 100),
    spreadBp: spread == null ? null : Math.round(spread * 10000),
    leveragePct: r1(DF / V * 100), converged: ok, years: T,
  };
}

// Annualized volatility of daily log returns over the last n sessions.
export function realizedVol(closes, n = 252) {
  const c = (Array.isArray(closes) ? closes : []).map(num).filter((x) => x > 0);
  if (c.length < 60) return null;
  const s = c.slice(-Math.min(n, c.length - 1) - 1);
  const rets = [];
  for (let i = 1; i < s.length; i += 1) rets.push(Math.log(s[i] / s[i - 1]));
  const m = rets.reduce((a, x) => a + x, 0) / rets.length;
  const v = rets.reduce((a, x) => a + (x - m) * (x - m), 0) / (rets.length - 1);
  return Math.sqrt(v * 252);
}
function closesOf(d) {
  if (Array.isArray(d?._bars) && d._bars.length) return d._bars.map((b) => num(b?.c));
  const c = d?.priceSeries?.c;
  return Array.isArray(c) ? c.map(num) : [];
}
function isEtf(d) {
  const f = d?.fundamentals || {};
  return f.quoteType === 'ETF' || /ETF|FUND/i.test(String(f.quoteType || ''));
}

// One stock's credit read. Financials are skipped: a bank's debt is its raw
// material, and the model is meaningless there. ETFs are skipped.
export function stockCreditRead(sym, d, { r = 0.04, skip = null } = {}) {
  if (!d || isEtf(d) || (typeof skip === 'function' && skip(sym))) return null;
  const f = d.fundamentals || {};
  const equity = num(f.marketCap), debt = num(f.totalDebt);
  const closes = closesOf(d);
  const rv = realizedVol(closes, 252);
  const iv = num(d.ivRank?.iv);
  // Realized one-year volatility first (what the market actually did); the
  // option-implied level is the fallback.
  const sigmaE = rv ?? (iv > 0 ? iv : null);
  const out = { symbol: sym, marketCap: equity, totalDebt: debt, totalCash: num(f.totalCash), sigmaEPct: sigmaE == null ? null : r1(sigmaE * 100), volBasis: rv != null ? 'realized-1y' : iv > 0 ? 'implied' : null };
  out.debtToMcapPct = equity > 0 && debt != null ? r1(debt / equity * 100) : null;
  const capex = num(f.capitalAllocation?.capexTtm), ocf = num(f.operatingCashFlow), fcf = num(f.freeCashFlow);
  out.capexTtm = capex == null ? null : Math.abs(capex);
  out.operatingCashFlow = ocf;
  out.freeCashFlow = fcf;
  out.capexToOcfPct = out.capexTtm != null && ocf > 0 ? r1(out.capexTtm / ocf * 100) : null;
  out.debtToFcfYears = debt > 0 && fcf > 0 ? r1(debt / fcf) : null;
  const spot = num(d.spot), hi = num(f.fiftyTwoWeekHigh);
  out.offHighPct = spot > 0 && hi > 0 ? r1(pct(hi, spot)) : null;
  out.rating = f.creditRating && typeof f.creditRating === 'object' ? { agency: f.creditRating.agency, rating: f.creditRating.rating, outlook: f.creditRating.outlook || null, asOf: f.creditRating.asOf || null } : null;
  out.model = debt > 0 ? mertonCredit({ equity, debt, sigmaE, r, years: 5 }) : null;
  return out;
}

// ---------------------------------------------------------------------------
// Today's warning signs. Each returns { status: lit | partial | clear |
// unknown, now: plain sentence, value }.
function readSigns({ aiCapex, accelerators, ipoCredit, chains, fred, series }) {
  const out = {};
  const rev = aiCapex?.totals?.revenue || null;
  // 1. Capex growth vs revenue growth for the AI spending group.
  {
    const cy = num(rev?.capexYoyPct), ry = num(rev?.yoyPct);
    if (cy == null || ry == null) out['capex-vs-revenue'] = { status: 'unknown', now: 'The AI spending file has no matched capex and revenue growth for the same fiscal years yet.' };
    else {
      const gap = cy - ry;
      out['capex-vs-revenue'] = { status: gap >= 15 ? 'lit' : gap >= 5 ? 'partial' : 'clear', value: r1(gap),
        now: `The biggest AI spenders grew capital spending ${cy >= 0 ? '+' : ''}${r1(cy)}% in their latest fiscal year against revenue ${ry >= 0 ? '+' : ''}${r1(ry)}% (${rev.count} companies, same fiscal years).` };
    }
  }
  // 2. Capex as a share of revenue: record, and rising.
  {
    const ttm = num(rev?.capexToRevenueTtmPct), prior = num(rev?.capexToRevenueFyPriorPct), fy = num(rev?.capexToRevenueFyPct);
    const nowPct = ttm ?? fy;
    if (nowPct == null) out['capex-intensity'] = { status: 'unknown', now: 'No capex-to-revenue reading in the AI spending file.' };
    else {
      const rise = prior != null ? nowPct - prior : null;
      const fyText = ttm != null && fy != null ? `, ${r1(fy)}% in the latest fiscal year` : '';
      out['capex-intensity'] = { status: nowPct >= 25 && (rise == null || rise >= 0) ? 'lit' : nowPct >= 15 ? 'partial' : 'clear', value: r1(nowPct),
        now: `Capital spending is ${r1(nowPct)}% of revenue for the group ${ttm != null ? 'over the last twelve months' : 'in the latest fiscal year'}${fyText}${prior != null ? ` and ${r1(prior)}% the fiscal year before` : ''}.` };
    }
  }
  // 3. Capex vs operating cash flow for the builders.
  {
    const builders = [...ROLES.spender.symbols, ...ROLES.borrower.symbols];
    let capex = 0, ocf = 0, n = 0; const over = [];
    for (const s of builders) {
      const f = chains?.[s]?.fundamentals; if (!f) continue;
      const c = num(f.capitalAllocation?.capexTtm), o = num(f.operatingCashFlow);
      if (c == null || o == null) continue;
      capex += Math.abs(c); ocf += o; n += 1;
      if (o <= 0 || Math.abs(c) > o) over.push(s);
    }
    if (!n) out['capex-vs-cash'] = { status: 'unknown', now: 'Cash-flow and capex figures are missing for the builders.' };
    else if (ocf <= 0) out['capex-vs-cash'] = {
      status: capex > 0 ? 'lit' : 'unknown', value: null,
      now: `The ${n} builders spend $${r1(capex / 1e9)}B on capital projects while their combined operating cash flow is ${ocf < 0 ? `negative ($${r1(ocf / 1e9)}B)` : 'zero'}; there is no positive cash flow to fund that spending.`,
    };
    else {
      const share = capex / ocf * 100;
      out['capex-vs-cash'] = { status: share >= 90 || over.length >= 2 ? 'lit' : share >= 65 || over.length ? 'partial' : 'clear', value: r1(share),
        now: `The ${n} largest builders spend ${r1(share)}% of their operating cash flow on capital projects${over.length ? `; ${joinAnd(over)} ${over.length === 1 ? 'spends' : 'spend'} more than ${over.length === 1 ? 'its' : 'their'} operating cash flow` : ''}.` };
    }
  }
  // 4. GPU rent: live H100 composite against its own recent history and the
  // dated index readings above.
  {
    const bench = (accelerators?.benchmarks || []).find((b) => b.modelId === 'h100') || null;
    const ch30 = num(bench?.change30dPct), cur = num(bench?.currentMedian);
    const comp = Array.isArray(bench?.compositeHistory) ? bench.compositeHistory : [];
    const first = comp[0], last = comp.at(-1);
    const span = first && last ? (ms(last.d) - ms(first.d)) / DAY : 0;
    const histCh = span >= 60 ? pct(num(first.p), num(last.p)) : null;
    const yrMkt = pct(H100_RENTAL_HISTORY[2].marketplace, H100_RENTAL_HISTORY.at(-1).marketplace);
    // Lit: the tracked rent is falling now. Clear: it is rising now (30 days)
    // and has not fallen over the longer tracked window. Otherwise partial:
    // the 2024-2025 index fall stands, with no strong live move either way.
    const falling = (ch30 != null && ch30 <= -5) || (histCh != null && histCh <= -10);
    const rising = !falling && ch30 != null && ch30 >= 5;
    const status = falling ? 'lit' : rising ? 'clear' : 'partial';
    out['price-falls'] = { status, value: ch30 ?? r1(histCh),
      now: `${cur != null ? `H100 rent today: a median of $${cur.toFixed(2)} per GPU-hour across tracked providers${ch30 != null ? `, ${ch30 >= 0 ? '+' : ''}${r1(ch30)}% over 30 days` : ''}${histCh != null ? ` and ${histCh >= 0 ? '+' : ''}${r1(histCh)}% since ${first.d}` : ''}. ` : ''}The H100 Rental Price Index marketplace median ${yrMkt <= 0 ? 'fell' : 'rose'} ${r1(Math.abs(yrMkt))}% from late 2024 to late 2025 (Silicon Data)${rising ? ', but the rent this site tracks is rising now' : ''}.` };
  }
  // 5. Debt funding: market-wide corporate bond sales vs a year earlier, plus
  // the borrowed money at the debt-funded builders.
  {
    const months = Array.isArray(ipoCredit?.raises?.bonds?.months) ? ipoCredit.raises.bonds.months : [];
    const tot = (r) => (num(r.ig) || 0) + (num(r.hy) || 0) + (num(r.cv) || 0);
    let yoy = null, last3 = null;
    if (months.length >= 15) {
      const a = months.slice(-3), b = months.slice(-15, -12);
      last3 = a.reduce((s, r) => s + tot(r), 0); const prev = b.reduce((s, r) => s + tot(r), 0);
      yoy = prev > 0 ? pct(prev, last3) : null;
    }
    // A debt-funded builder counts as leaning on debt when its total debt is
    // at least half its market value, or more than three years of operating
    // cash flow (or its operating cash flow is not positive).
    const borrowers = ROLES.borrower.symbols.map((s) => {
      const f = chains?.[s]?.fundamentals, debt = num(f?.totalDebt), mcap = num(f?.marketCap), ocf = num(f?.operatingCashFlow);
      if (!(debt > 0)) return null;
      const toMcap = mcap > 0 ? debt / mcap * 100 : null, years = ocf > 0 ? debt / ocf : null;
      const heavy = (toMcap != null && toMcap >= 50) || (ocf != null && (ocf <= 0 || years > 3));
      return { s, debt, toMcap, years, ocf, heavy };
    }).filter(Boolean);
    const heavy = borrowers.filter((b) => b.heavy);
    const describe = (b) => `${b.s} $${(b.debt / 1e9).toFixed(0)}B${b.toMcap != null ? ` (${Math.round(b.toMcap)}% of market value${b.years != null ? `, ${r1(b.years)} years of operating cash flow` : b.ocf != null && b.ocf <= 0 ? ', negative operating cash flow' : ''})` : ''}`;
    const known = yoy != null || borrowers.length;
    out['debt-funding'] = { status: (yoy != null && yoy >= 20) || heavy.length >= 2 ? 'lit' : heavy.length || (yoy != null && yoy >= 5) ? 'partial' : known ? 'clear' : 'unknown', value: r1(yoy),
      now: [yoy != null ? `US corporate bond sales over the last three months ${yoy >= 0 ? '+' : ''}${r1(yoy)}% from a year earlier (SIFMA).` : 'Bond issuance history is too short for a year-over-year read.', borrowers.length ? `Debt-funded builders' total debt: ${borrowers.map(describe).join('; ')}.` : '', 'Off-balance-sheet project companies (such as Meta\'s $27 billion Hyperion) are not in these totals.'].filter(Boolean).join(' ') };
  }
  // 6. Credit strain: Baa spread and high-yield spread changes.
  {
    const baa = rowsOf(fred?.BAA10Y), hy = rowsOf(fred?.BAMLH0A0HYM2);
    const baaUp = deltaOverDays(baa, 91), hyUp = deltaOverDays(hy, 91);
    const hyNow = hy.at(-1)?.v ?? null, baaNow = baa.at(-1)?.v ?? null;
    if (baaNow == null && hyNow == null) out['credit-strain'] = { status: 'unknown', now: 'No corporate spread history in the cache yet.' };
    else {
      const lit = (hyUp != null && hyUp >= 0.75) || (baaUp != null && baaUp >= 0.35) || (hyNow != null && hyNow >= 5.5);
      const partial = (hyUp != null && hyUp >= 0.3) || (baaUp != null && baaUp >= 0.15);
      out['credit-strain'] = { status: lit ? 'lit' : partial ? 'partial' : 'clear', value: r2(baaNow),
        now: [baaNow != null ? `Baa corporate spread ${baaNow.toFixed(2)} points over the 10-year Treasury${baaUp != null ? ` (${baaUp >= 0 ? '+' : ''}${baaUp.toFixed(2)} over three months)` : ''}, ${ordinal(percentileOf(baa, baaNow))} percentile since 1986.` : '', hyNow != null ? `High-yield spread ${hyNow.toFixed(2)} points${hyUp != null ? ` (${hyUp >= 0 ? '+' : ''}${hyUp.toFixed(2)} over three months)` : ''}.` : ''].filter(Boolean).join(' ') };
    }
  }
  // 7. The most indebted builder cracks (52-week drawdowns, public prices).
  {
    const rows = ROLES.borrower.symbols.map((s) => {
      const d = chains?.[s], spot = num(d?.spot), hi = num(d?.fundamentals?.fiftyTwoWeekHigh);
      return spot > 0 && hi > 0 ? { s, off: pct(hi, spot) } : null;
    }).filter(Boolean);
    if (!rows.length) out['weak-link'] = { status: 'unknown', now: 'No price for the debt-funded builders.' };
    else {
      const worst = rows.reduce((a, r) => (r.off < a.off ? r : a));
      out['weak-link'] = { status: worst.off <= -40 ? 'lit' : worst.off <= -25 ? 'partial' : 'clear', value: r1(worst.off),
        now: `${joinAnd(rows.map((r) => `${r.s} ${r1(r.off)}%`))} from ${rows.length === 1 ? 'its 52-week high' : 'their 52-week highs'}.` };
    }
  }
  // 8. Price stretch: Nasdaq vs its one-year change and 200-session average.
  {
    const ixic = rowsOf(series?.['^IXIC']);
    const yr = changeOver(ixic, 250), avg = sma(ixic, 200), last = ixic.at(-1)?.v;
    const above = avg && last ? pct(avg, last) : null;
    if (yr == null || above == null) out['price-stretch'] = { status: 'unknown', now: 'Not enough Nasdaq history in the cache.' };
    else out['price-stretch'] = { status: yr >= 40 && above >= 20 ? 'lit' : yr >= 20 || above >= 10 ? 'partial' : 'clear', value: r1(yr),
      now: `Nasdaq Composite ${yr >= 0 ? '+' : ''}${r1(yr)}% over 250 sessions and ${above >= 0 ? '+' : ''}${r1(above)}% against its 200-session average. In March 2000 it had more than doubled in a year.` };
  }
  // 9. Suppliers fall while spending still rises.
  {
    const smh = chains?.SMH, spot = num(smh?.spot), hi = num(smh?.fundamentals?.fiftyTwoWeekHigh);
    const off = spot > 0 && hi > 0 ? pct(hi, spot) : null;
    const growing = num(rev?.capexYoyPct) != null ? num(rev.capexYoyPct) > 0 : null;
    if (off == null) out['leaders-crack'] = { status: 'unknown', now: 'No semiconductor ETF (SMH) price.' };
    else if (growing == null) out['leaders-crack'] = { status: 'unknown', value: r1(off), now: `Semiconductor ETF (SMH) ${r1(off)}% from its 52-week high, but capital-spending growth is missing, so rising spending cannot be confirmed.` };
    else out['leaders-crack'] = { status: off <= -20 && growing ? 'lit' : off <= -10 && growing ? 'partial' : 'clear', value: r1(off),
      now: `Semiconductor ETF (SMH) ${r1(off)}% from its 52-week high${growing === true ? ' while the builders\' capital spending is still growing' : ''}.` };
  }
  return out;
}

const STAGES = [
  [0, 'early', 'Early buildout', 'Few of the warning signs that came before past busts are showing.'],
  [3, 'boom', 'Boom', 'Spending and prices show boom signs; credit and the weakest builders are holding.'],
  [5, 'late', 'Late boom, strain showing', 'Most boom signs are showing and some strain has reached credit or the weakest builders.'],
  [7, 'bust', 'Bust pattern', 'Nearly every sign that came before past busts is showing, including credit and the weakest builders.'],
];
// The two later stages also need strain where past busts showed it: "late"
// needs credit strain or a cracking builder (lit or partial), "bust" needs
// credit strain lit and the weakest builder at least partly cracking. Without
// `signs` (old callers) the score alone decides.
export function stageFor(score, signs = null) {
  let i = 0;
  STAGES.forEach((s, k) => { if (score >= s[0]) i = k; });
  if (signs) {
    const on = (id) => signs[id]?.status === 'lit' || signs[id]?.status === 'partial';
    const strain = on('credit-strain') || on('weak-link');
    const bust = signs['credit-strain']?.status === 'lit' && on('weak-link');
    if (i === 3 && !bust) i = 2;
    if (i === 2 && !strain) i = 1;
  }
  const out = STAGES[i];
  return { id: out[1], label: out[2], note: out[3] };
}

// How closely today's lit signs match each case (lit = 1, partial = 0.5).
function caseMatches(signs) {
  const lit = SIGN_IDS.filter((id) => signs[id]?.status === 'lit' || signs[id]?.status === 'partial');
  return Object.entries(CASE_SIGNS).map(([id, list]) => {
    const both = lit.filter((s) => list.includes(s)).length;
    const union = new Set([...lit, ...list]).size;
    return { id, name: CASES.find((c) => c.id === id).name, shared: both, caseSigns: list.length, nowSigns: lit.length, similarity: union ? Math.round(both / union * 100) : 0 };
  }).sort((a, b) => b.similarity - a.similarity);
}

// ---------------------------------------------------------------------------
// Charts (compact rows the page draws).
function analogChart(series) {
  const ixic = rowsOf(series?.['^IXIC']);
  if (!ixic.length) return null;
  // Aligned on the start of each buildout's public moment: Netscape's IPO
  // (August 9, 1995) and ChatGPT's launch (November 30, 2022). The choice of
  // start date changes the picture; it is a case study, not a model.
  const path = (from, to) => {
    const w = thin(between(ixic, from, to), 'week');
    if (!w.length) return [];
    const base = w[0].v;
    return w.map((r, i) => [i, r1(r.v / base * 100), r.t]);
  };
  return {
    unit: 'weeks since start, index = 100 at start',
    then: { label: 'Nasdaq from Netscape IPO (Aug 1995)', start: '1995-08-09', rows: path('1995-08-09', '2003-03-31') },
    now: { label: 'Nasdaq from ChatGPT launch (Nov 2022)', start: '2022-11-30', rows: path('2022-11-30', '2100-01-01') },
    marks: [{ t: '2000-03-10', label: 'Nasdaq peak' }, { t: '2002-01-28', label: 'Global Crossing files' }, { t: '2002-07-21', label: 'WorldCom files' }],
  };
}
function series2(rows, unit, from) { return thin(rows.filter((r) => !from || r.t >= from), unit).map((r) => [r.t, r2(r.v)]); }

function housingBlock(fred, series) {
  const hpi = rowsOf(fred?.USSTHPI), mort = rowsOf(fred?.MORTGAGE30US), dq = rowsOf(fred?.DRSFRMACBS), spx = rowsOf(series?.['^GSPC']);
  const hp = episode(hpi, '2005-01-01', '2013-12-31');
  const dqPeak = maxRow(between(dq, '2007-01-01', '2014-12-31'));
  const spxEp = episode(spx, '2007-01-01', '2009-12-31');
  const facts = [];
  if (hp) facts.push({ label: 'House prices, peak to trough (FHFA all-transactions)', value: `${hp.changePct}%`, detail: `${hp.peak.t.slice(0, 7)} to ${hp.trough.t.slice(0, 7)}`, source: 'fredHpi' });
  if (dqPeak) facts.push({ label: 'Mortgage delinquency rate at its peak (banks)', value: `${dqPeak.v.toFixed(2)}%`, detail: dqPeak.t.slice(0, 7), source: 'fredDelinq' });
  if (spxEp) facts.push({ label: 'S&P 500, 2007 high to 2009 low', value: `${spxEp.changePct}%`, detail: `${spxEp.peak.t} to ${spxEp.trough.t}`, source: null });
  const m06 = at(mort, '2006-07-31'), mNow = mort.at(-1);
  if (m06) facts.push({ label: '30-year mortgage rate, mid-2006', value: `${m06.v.toFixed(2)}%`, detail: m06.t, source: 'fredMort' });
  if (mNow) facts.push({ label: '30-year mortgage rate, latest', value: `${mNow.v.toFixed(2)}%`, detail: mNow.t, source: 'fredMort' });
  return {
    facts, peak: hp,
    chart: { hpi: series2(hpi, 'month', '1995-01-01'), mortgage: series2(mort, 'month', '1995-01-01'), delinquency: series2(dq, 'month', '1995-01-01') },
  };
}
function telecomBlock(fred, series) {
  const comm = rowsOf(fred?.PRCMUCONS), ixic = rowsOf(series?.['^IXIC']);
  const cEp = episode(comm, '1998-01-01', '2004-12-31');
  const nEp = episode(ixic, '1999-01-01', '2002-12-31');
  const facts = [];
  if (nEp) facts.push({ label: 'Nasdaq Composite, 2000 high to 2002 low', value: `${nEp.changePct}%`, detail: `${nEp.peak.t} to ${nEp.trough.t}`, source: null });
  if (cEp) facts.push({ label: 'Private communication construction spending, peak to low', value: `${cEp.changePct}%`, detail: `${cEp.peak.t.slice(0, 7)} to ${cEp.trough.t.slice(0, 7)}`, source: 'fredComm' });
  return { facts, chart: { communication: series2(comm, 'month', '1993-01-01') } };
}
function creditBlock(fred, asOf) {
  const baa = rowsOf(fred?.BAA10Y), hy = rowsOf(fred?.BAMLH0A0HYM2), ig = rowsOf(fred?.BAMLC0A0CM);
  const p = (from, to) => { const r = maxRow(between(baa, from, to)); return r ? { t: r.t, v: r2(r.v) } : null; };
  const now = baa.at(-1) || null;
  return {
    baa: { now: now ? { t: now.t, v: r2(now.v) } : null, pctile: now ? percentileOf(baa, now.v) : null, since: baa[0]?.t || null,
      peaks: [{ label: 'Telecom bust high (2001–2002)', ...p('2001-01-01', '2003-06-30') }, { label: '2008 crisis high', ...p('2008-01-01', '2009-12-31') }, { label: '2020 pandemic high', ...p('2020-02-01', '2020-06-30') }].filter((x) => x.t),
      chart: series2(baa, 'week') },
    hy: hy.length ? { now: { t: hy.at(-1).t, v: r2(hy.at(-1).v) }, chg3m: r2(deltaOverDays(hy, 91)), since: hy[0].t, chart: series2(hy, 'week') } : null,
    ig: ig.length ? { now: { t: ig.at(-1).t, v: r2(ig.at(-1).v) }, chg3m: r2(deltaOverDays(ig, 91)), since: ig[0].t } : null,
    cdsAccess: 'Single-name credit default swap prices are sold by data vendors (S&P Global Market Intelligence / Markit, LSEG, Bloomberg, ICE). There is no free daily feed. SEC rules have required public reports of security-based swap trades since 2022, but those are trade prints with the size capped at $5 million, not a clean daily price per company, and they are not wired here. So this page shows CDS levels only as dated quotes reported in the press, and uses free bond-market spreads for the daily read.',
    reported: REPORTED_CDS.map((q) => ({ ...q, sourceUrl: SOURCES[q.source]?.url || null })),
    ...reportedAge(asOf),
  };
}
// How old the newest press CDS quote is on the build date.
function reportedAge(asOfIso) {
  const newest = REPORTED_CDS.map((q) => q.date).sort().at(-1) || null;
  const now = ms(String(asOfIso || '').slice(0, 10));
  const days = newest && Number.isFinite(now) ? Math.max(0, Math.round((now - ms(newest)) / DAY)) : null;
  return { reportedNewest: newest, reportedAgeDays: days, reportedStale: days != null && days > REPORTED_CDS_STALE_DAYS };
}
function gpuBlock(accelerators) {
  const bench = (accelerators?.benchmarks || []).find((b) => b.modelId === 'h100') || null;
  const live = bench ? { median: num(bench.currentMedian), spotMedian: num(bench.spot?.median), onDemandMedian: num(bench.onDemand?.median), change30dPct: num(bench.change30dPct),
    history: (bench.compositeHistory || []).map((r) => [r.d, num(r.p)]).filter((r) => r[1] != null) } : null;
  const asOf = accelerators?.builtAtIso || accelerators?.updatedAt || null;
  return { index: H100_RENTAL_HISTORY, live, asOf, note: 'Index rows are Silicon Data\'s segment medians for each period. The live line is this site\'s weekly median across tracked providers (Vast.ai, CoreWeave, Runpod, Lambda), which mixes marketplace and on-demand quotes, so compare its trend, not its level.' };
}
// Collateral decay: a GPU's rent falls every year by design; a house's price
// fell in the worst US housing crash on record.
function collateralBlock(housing) {
  const mk = H100_RENTAL_HISTORY, a = mk[2], b = mk.at(-1);
  const years = (ms(b.d) - ms(a.d)) / (365.25 * DAY);
  const mktYr = (Math.pow(b.marketplace / a.marketplace, 1 / years) - 1) * 100;
  const hypYears = (ms(b.d) - ms(mk[0].d)) / (365.25 * DAY);
  const hypYr = (Math.pow(b.hyperscaler / mk[0].hyperscaler, 1 / hypYears) - 1) * 100;
  let houseYr = null, houseTotal = null, houseYears = null;
  if (housing?.peak) {
    houseYears = (ms(housing.peak.trough.t) - ms(housing.peak.peak.t)) / (365.25 * DAY);
    houseTotal = housing.peak.changePct;
    houseYr = houseYears > 0 ? (Math.pow(1 + houseTotal / 100, 1 / houseYears) - 1) * 100 : null;
  }
  return {
    gpuMarketplacePerYearPct: r1(mktYr), gpuHyperscalerPerYearPct: r1(hypYr),
    houseCrashTotalPct: houseTotal, houseCrashYears: r1(houseYears), houseCrashPerYearPct: r1(houseYr),
    text: `${houseTotal != null ? `In the worst US housing crash on record, the FHFA index fell ${Math.abs(houseTotal)}% over ${r1(houseYears)} years (about ${r1(Math.abs(houseYr))}% a year), then recovered.` : 'House prices fell for several years in the 2006–2011 crash, then recovered (the FHFA history is not in the cache yet).'} An H100's rent fell about ${r1(Math.abs(mktYr))}% a year on marketplaces and ${r1(Math.abs(hypYr))}% a year at the big clouds from 2023 to 2025, with no crash at all, as newer chips arrived. A house loan is backed by an asset that usually holds its value; a GPU loan is backed by one that loses value every year, so lenders depend on the customer contract more than the collateral.`,
  };
}

// ---------------------------------------------------------------------------
export function buildHistoryRhymes({ builtAtIso, series = {}, fred = {}, aiCapex = null, accelerators = null, ipoCredit = null, chains = {} } = {}) {
  const signs = readSigns({ aiCapex, accelerators, ipoCredit, chains, fred, series });
  const score = SIGN_IDS.reduce((s, id) => s + (signs[id]?.status === 'lit' ? 1 : signs[id]?.status === 'partial' ? 0.5 : 0), 0);
  const known = SIGN_IDS.filter((id) => signs[id]?.status && signs[id].status !== 'unknown').length;
  const stage = stageFor(score, signs);
  const matches = caseMatches(signs);
  const housing = housingBlock(fred, series);
  const telecom = telecomBlock(fred, series);
  const credit = creditBlock(fred, builtAtIso);
  const asOf = [rowsOf(series?.['^IXIC']).at(-1)?.t, rowsOf(fred?.BAA10Y).at(-1)?.t].filter(Boolean).sort().at(-1) || null;
  const inputs = {
    aiCapex: aiCapex?.builtAtIso || null, accelerators: accelerators?.builtAtIso || accelerators?.updatedAt || null,
    bonds: ipoCredit?.raises?.bonds?.latest?.m || null,
    fred: Object.fromEntries(HISTORY_RHYMES_FRED.map((id) => [id, rowsOf(fred?.[id]).at(-1)?.t || null])),
    nasdaq: rowsOf(series?.['^IXIC']).at(-1)?.t || null,
  };
  return {
    version: HISTORY_RHYMES_VERSION, builtAtIso, asOf,
    now: {
      score, known, total: SIGN_IDS.length, stage,
      lit: SIGN_IDS.filter((id) => signs[id]?.status === 'lit'),
      partial: SIGN_IDS.filter((id) => signs[id]?.status === 'partial'),
      mostLike: matches[0] || null, matches,
      signs: SIGNS.map((s) => ({ ...s, ...(signs[s.id] || { status: 'unknown', now: 'No reading.' }), cases: Object.entries(CASE_SIGNS).filter(([, l]) => l.includes(s.id)).map(([id]) => id) })),
    },
    cases: CASES.map((c) => ({ ...c, timeline: c.timeline.map(([d, text, src, when]) => ({ date: d, when: when || null, text, source: src, sourceUrl: src ? SOURCES[src]?.url || null : null })), numbers: c.numbers.map((n) => ({ ...n, sourceUrl: n.source ? SOURCES[n.source]?.url || null : null })) })),
    railroads: { freight: RAIL_FREIGHT_CENTS.map(([y, v]) => [y, v]), ukMiles: UK_RAIL_MILES.map(([y, v]) => [y, v]) },
    telecom, housing, credit,
    gpu: gpuBlock(accelerators),
    collateral: collateralBlock(housing),
    analog: analogChart(series),
    sources: Object.entries(SOURCES).map(([id, s]) => ({ id, ...s })),
    inputs,
    methodology: [
      'Case studies are fixed history written into the code with a source for each dated fact. Numbers marked as computed (house prices, delinquencies, spreads, index drawdowns) are measured each build from the FRED and index history the site already keeps.',
      'Warning signs are read from data the site already collects: SEC capital spending and revenue (AI spending page), GPU rental quotes (GPU cloud prices page), SIFMA bond issuance (Capital markets page), FRED credit spreads, and stock prices. Lit counts 1, partial counts 0.5; the stage label comes from the total.',
      'The stage and the "most like" case are descriptions of how many past warning signs are present. They are not a forecast, a timing signal or advice. Past busts took months to years to unfold after the first signs, and some booms never busted.',
      'Credit default swap quotes appear only as dated press reports, because single-name CDS prices are not freely available.',
    ],
    stale: false,
  };
}

// Owner view: per-stock role and credit read.
export function buildHistoryRhymesOwner({ builtAtIso, rhymes, chains = {}, r = 0.04, skip = null } = {}) {
  const rows = [];
  const cdsBy = {};
  for (const q of REPORTED_CDS) {
    for (const s of q.symbol ? [q.symbol] : q.symbols || []) (cdsBy[s] ||= []).push({ date: q.date, bp: q.bp, approx: q.approx || null, note: q.note, sourceUrl: SOURCES[q.source]?.url || null });
  }
  for (const sym of Object.keys(chains || {}).sort()) {
    const read = stockCreditRead(sym, chains[sym], { r, skip });
    if (!read) continue;
    const role = roleOf(sym);
    const flags = [];
    if (read.model?.pdPct >= 20) flags.push('Model five-year default chance 20% or more');
    else if (read.model?.pdPct >= 5) flags.push('Model five-year default chance 5% or more');
    if (read.debtToMcapPct >= 50) flags.push('Debt at least half of market value');
    if (read.capexToOcfPct >= 100) flags.push('Capital spending above operating cash flow');
    if (read.freeCashFlow != null && read.freeCashFlow < 0 && read.totalDebt > 0) flags.push('Negative free cash flow with debt');
    if (read.offHighPct != null && read.offHighPct <= -40) flags.push('40% or more below its 52-week high');
    rows.push({ ...read, role, roleLabel: role ? ROLES[role].label : null, cds: (cdsBy[sym] || []).sort((a, b) => b.date.localeCompare(a.date)), flags });
  }
  // Buildout names first (by role), then everyone else by model default chance.
  const roleOrder = ['borrower', 'spender', 'supplier', 'power', 'user'];
  const buildout = rows.filter((x) => x.role).sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || (b.model?.pdPct ?? -1) - (a.model?.pdPct ?? -1));
  const others = rows.filter((x) => !x.role).sort((a, b) => (b.model?.pdPct ?? -1) - (a.model?.pdPct ?? -1));
  const highest = rows.filter((x) => x.model?.pdPct != null).sort((a, b) => b.model.pdPct - a.model.pdPct).slice(0, 5).map((x) => ({ symbol: x.symbol, pdPct: x.model.pdPct, spreadBp: x.model.spreadBp }));
  // Check the model against the one reported quote with an implied default
  // chance (CoreWeave, October 2026: about 63% over five years).
  const crwv = rows.find((x) => x.symbol === 'CRWV');
  // The model check compares CoreWeave's model read with its newest press
  // CDS quote, so adding a newer REPORTED_CDS row updates it.
  const crwvQuote = REPORTED_CDS.filter((q) => q.symbol === 'CRWV' && q.bp != null).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  const check = crwv?.model && crwvQuote ? {
    symbol: 'CRWV', modelPdPct: crwv.model.pdPct, modelSpreadBp: crwv.model.spreadBp,
    reportedPdPct: crwvQuote.impliedPdPct ?? null, reportedBp: crwvQuote.bp, reportedApprox: crwvQuote.approx || null, reportedDate: crwvQuote.date,
    reportedSource: SOURCES[crwvQuote.source]?.label || null, reportedSourceUrl: SOURCES[crwvQuote.source]?.url || null,
    note: 'The model reads today\'s prices, so the two dates differ.',
  } : null;
  return {
    version: HISTORY_RHYMES_VERSION, builtAtIso, asOf: rhymes?.asOf || null,
    stage: rhymes?.now?.stage || null, score: rhymes?.now?.score ?? null, total: rhymes?.now?.total ?? null, mostLike: rhymes?.now?.mostLike || null,
    roles: Object.entries(ROLES).map(([id, x]) => ({ id, label: x.label, history: x.history, symbols: x.symbols })),
    buildout, others, highest, check,
    model: { name: 'Merton (1974) equity-implied credit', horizonYears: 5, riskFree: r, notes: [
      'Equity is treated as an option on the company\'s assets with the total reported debt as the strike. The model solves for the asset value and its volatility from the market value of equity and one-year realized stock volatility (option-implied volatility when the price history is short).',
      'Total debt is the figure the quote provider reports, which includes lease obligations, so it can be larger than the borrowings quoted in the press (CoreWeave: about $50 billion of debt in the October 2026 Reuters factbox).',
      'The default chance is the model chance that assets end below total debt in five years; the spread is the model\'s yield premium on that debt. A model, not a market quote: it ignores debt maturities, covenants, customer contracts and owner support, and it usually understates spreads for short horizons.',
      'Banks, brokers, payment networks and other financials are skipped: borrowed money is their raw material. ETFs are skipped.',
      'Research only. Nothing here changes a grade, a pick, a gate or the track record; Top Picks logs the default chance as a shadow input (epd) for later testing.',
    ] },
  };
}

// Compact summary for Historical Data's "Resembles now" and the Owner brief.
export function historyRhymesSummary(rhymes) {
  const n = rhymes?.now;
  if (!n) return null;
  return {
    score: n.score, total: n.total, stage: n.stage, lit: n.lit, partial: n.partial,
    mostLike: n.mostLike ? { id: n.mostLike.id, name: n.mostLike.name, similarity: n.mostLike.similarity } : null,
    signs: n.signs.filter((s) => s.status === 'lit' || s.status === 'partial').map((s) => ({ id: s.id, label: s.label, status: s.status, now: s.now })),
    credit: rhymes.credit?.baa?.now ? { baa: rhymes.credit.baa.now.v, baaPctile: rhymes.credit.baa.pctile, hy: rhymes.credit.hy?.now?.v ?? null, hyChg3m: rhymes.credit.hy?.chg3m ?? null } : null,
    asOf: rhymes.asOf, stale: !!rhymes.stale,
  };
}
