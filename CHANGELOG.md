# Changelog

All notable changes to **stonks** are recorded here, grouped under the date the
change landed (newest first). This root file carries only the **current month**;
each completed month is archived under [`docs/changelog/`](docs/changelog/) and
linked from the index below, so this file stays small.

Categories: **Added** (new features), **Changed** (changes to existing behavior),
**Fixed** (bug fixes), **Removed** (dropped features), **Perf** (performance),
**Docs** (documentation/CLAUDE.md).

<!-- CONVENTION (also in CLAUDE.md):
     - Add each new entry under a "## YYYY-MM-DD" heading for the day the change
       lands (create the heading + "### Category" subhead if missing — newest
       date first, categories in the order Added / Changed / Fixed / Removed /
       Perf / Docs). One bullet per change, present tense, plain language,
     reference the PR (#NNN) when there is one.
     - MONTHLY ROLLOVER: on the first entry of a new month, move ALL of the
     previous month's "## YYYY-MM-DD" sections into docs/changelog/YYYY-MM.md
     (same format, plus the archive preamble) and add that month to the
     "Older changelogs" index below. -->

## 2026-11-08

### Added

- Add a language picker beside the day/night switch: English, 简体中文, 繁體中文, 日本語 and 한국어. The choice is saved per browser and split-view panes follow it. Translations are fixed files in `i18n/` served from the site itself, so a page visit makes no AI call and loads no outside service; numbers, tickers, prices and charts stay as they are. Menus, headings, buttons and short labels are translated (about 5,100 strings per language); longer explanations stay in English. No AI is used, so the feature adds no running cost. Traditional Chinese is made from Simplified with OpenCC.
- Add a macro, cycle and rotation read for Top Picks, on by default since the owner approved it (`PICKS_MACRO_CONTEXT=0` turns it off): where the Fed path, inflation, growth, credit, market, liquidity, dollar, oil and party control stand, which groups money is rotating into and out of with a plain-English reason, a rotation vs systemic stress check, and each stock's macro fit (at most ±1.5 points) from weights learned on 2008-2026 sector history. A trade the fit points against by 0.5 points or more is kept off the open list (new gate "Fights the macro backdrop"; `PICKS_MACRO_BLOCK_PTS`, and `PICKS_MACRO_POINTS=1` also adds the points to the grade, off by default), the Fed axis also reads the hikes already priced, the rotation axis reads one month instead of one day, and the AI grader sees the read. The grade version moves to `2026-11-macro-context`, so the Track Record shows a dated divider; the market tape's help text describes the new Fed and rotation reads. Card issuers such as AXP read as lenders, not card networks. Six free FRED series join the shared history cache. Research scripts and results are in `research/macro-backtest/` (#773).

### Changed

- Commodities: the Potash card now reads the World Bank's monthly potassium chloride price (US dollars per metric ton, from the free Pink Sheet workbook, through October 2026) instead of the BLS potash-mining PPI, which stopped in December 2022. The World Bank page is checked at most once a day and the workbook downloaded only when a new monthly release appears; a failed first read shows "no data yet" rather than the old index under the new unit (#774).

### Fixed

- Funds (SPY, QQQ and the other tracked ETFs) no longer carry an earnings history: the earnings lookups skip them and any stored rows are dropped, since SPY showed a made-up 2005 "print". Nasdaq earnings rows older than the ten-year window are also no longer kept.
- Market Analysis no longer lists the geopolitics input as missing when the news layer was checked and found no risk-off story; a quiet read now counts as checked.
- Brief standouts read as plain English: the saved pre-open time shows as "Nov 6, 09:01 ET" instead of a raw timestamp, "an up opening gap", "~1 session", a streak "ended today", and a headline amount as "$7.5B" instead of 7500000000. The IV line in the Brief prompt rounds the implied move.
- Track Record's $100k backtest no longer shows an always-zero "ladder adds" chip; ladder adds and winner rotation are skipped on purpose (they would need each trade's path).
- Stock Picks rounds the planned-entry price in its payload.
- Buyer's manual: an option no longer reads as worthless after expiration; one in the money is usually exercised automatically, and only an out-of-the-money one expires worthless (#772).
- Market Analysis premarket leaders and laggards measure each gap from the last close. Before the bell Yahoo's "previous close" is two sessions back, so a stock that fell the day before could show as a premarket decliner while it was trading higher (SNDK on Nov 6 read -14% at 09:00 ET when it was about +10%).
- The 16:10 ET bake no longer saves the day's settled option expiration (Yahoo keeps listing it after the close). The stock page's expiration list, IV term structure and max pain no longer show a dead same-day chain overnight, and the slot goes to a live expiration.
- Options walls drops an expiration once it settles at 16:00 ET, the same test the server-side gamma read uses; it had kept the settled 0DTE chain in the walls and gamma flip until about 04:00 ET.
- The Brief's closing heatmap standout states the cap-weighted move once instead of twice.
- Options walls' "Heavy call OI" reason names the heaviest qualifying strike, so it matches the call wall more often.
- October 2026 CPI (out Tue Nov 10) has no 12-month change, because BLS never published an October 2025 index after the shutdown. The Rates inflation tile and the market tape's inflation input now keep the newest month that has one (September) and say why, instead of dropping the whole read; the Calendar's CPI year-over-year rows say the figure is missing and why.
- The unemployment Sahm read lines its three-month averages up by date, so the missing October 2025 jobs-survey month no longer pulls an older month into the average.
- Calendar: the "Next FOMC" and "Next report" cards count down past four weeks ("In 31 days") instead of going blank, and the earnings card reads "Earnings, next 7 days".
- Stock links' hover text tells public visitors they open the stock page; only Owners are told about the Grade tab.
- Market holidays no longer count as trading sessions in the freshness labels. On Thanksgiving the flow, volume, open interest and Trending IV pages had called the day-before data one session old, and the heatmap read a session too many after a holiday Monday. Unusual options trades also treats a holiday as closed and ends the regular session at 13:00 ET on a half day.
- The live 2-year yield reads last December's close in early January, when Treasury's new-year feed has no row or one row, so the tile keeps its day change on the year's first sessions.
- The Calendar's FOMC odds read Kalshi again. Kalshi now quotes its markets as dollar strings (`last_price_dollars`) with counts in `volume_fp`, and the old cent fields the build read are gone, so every Kalshi market came back empty and only the futures and Polymarket lines showed. The old cent fields still read as a fallback.
- The MCP dates the flow, volume and open interest pages by their scan time instead of warning that they are undated.
- Narrative cards no longer show a "Next" stage written for a stage the story has left. When the risk checks move a story to Challenges or Collapse, the outlook says so, shows the model's own reasoning as the earlier read, and drops its next step.
- The Track Record roster says a name was "out-ranked off the top 6" (the real list size) instead of "top 10", and its empty note no longer mentions a Top-10 snapshot.
- The Grade tab's Execute now? card counts earnings and FOMC in market sessions, not calendar days. A Monday print seen on a Friday now gets the "next session" warning (it got none before), holidays are skipped, and an FOMC day stops reading as "today" once the 15:30 ET press conference is over.
- Target's and Home Depot's fundamentals charts label quarters by the companies' own fiscal year (they name a year by the year it starts in), so the quarter Target reports on Nov 18 reads Q3 '26, not Q3 '27.
- Who owns what and the stock pages' fund moves no longer show foreign listing codes as tickers. Lookups before #722 kept the first listing OpenFIGI returned, often a Frankfurt code (Target as DYH, Morgan Stanley as DWD, Citigroup as TRVC), and the saved map was reused forever, so the TGT, MS, C, GLD and QQQ pages found no fund moves. Every saved ticker is now looked up again under the US-only rule, and those five are pinned.
- Who owns what no longer shows "Curated filing themes": its "most bought / most sold" lists came from the Owner-only Market themes (or fixed filler text), not from the filings. The stored copy is hidden from public readers at once, and the page's Open Narratives button is Owner-only.
- Earnings reactions for companies that report before the open are measured on the announcement day. Older prints filled in without a report time were all read as after-the-close, so the move counted was the next day's: Datadog's 23% jump on 2025-11-06 showed as +0.2%. Merck, Moderna, American Express, Vistra, Datadog, Shopify, Vertiv, TSMC, ASML, Alibaba, Disney and PayPal join the before-open list (Disney and PayPal from their 2024 switch, American Express from 2019), and stored prints of those names are re-read once on the next build.
- The Stocktwits chatter count says what it is: how many of the newest 30 posts came in the last 24 hours ("of 30 sampled posts within 24h"), not a day's message total.

### Docs

- CLAUDE.md and `api/watchlist.js`: the shared watchlist needs a signed Owner session with both claims and fails closed (the old wording said fail-open and called picks.json public); the FedWatch live line says it tracks CME between bakes, not hourly builds.
- CLAUDE.md: the Sports rule now names PropLine's read-only odds feed (PrizePicks lines, plus sportsbook reference prices for NBA) as the one allowed outside line source, which the owners chose to keep, replacing the old "no sportsbook or PrizePicks API calls" line (#772).

## 2026-11-07

### Added

- Add a "Send us a message" box in Learn & help: anyone can send a title, message and optional emails or social links; only the Owner can read, mark and delete them in an inbox under the form. Messages stay in the private store, with spam limits and no IP addresses kept (#770).
- Owner: a **Top Picks missed-run watchdog**. After every Daily build, and from its own GitHub schedule as a backup, `scripts/top-picks-watchdog.mjs` checks whether today's 11:00 and 15:30 ET Top Picks runs published. A run that failed, or a dispatch that never arrived, gets one retry (a forced Daily build titled "Top Picks retry <slot> ET <date>") while the session allows, and one GitHub issue labeled `top-picks-run` opens (which emails the repo's watchers), refreshes on later checks and closes once the latest run publishes. The issue carries only slot times, run states and run links. `TOP_PICKS_WATCHDOG=alert` keeps the issue without the retry; `off` turns it off. Planner in `lib/top-picks-watchdog.mjs`; new workflow `top-picks-watchdog.yml`, which the Update Checker also watches. A Daily build run now takes its title from a new `reason` input.
- Owner: **"Do we have an edge yet?"** at the top of the Track Record Scorecard: the average P&L per closed trade with a resampled 95% range, the same for real fills and for the picks minus a SPY option on the same entries, the win rate against the rate the win and loss sizes need to break even, the newest rule set on its own, a running-average chart with its band, and about how many more closed trades it would take to settle. Reads the current window plus the archive.
- Owner: **similar-setup odds** on every Top Picks card and open trade: how past closed Top Picks trades with the same side, grade band and market type at entry turned out (wins of matched trades, likely win-rate range, average P&L), loosened one step at a time until at least 8 trades match and marked "few" under 10. Built once per Top Picks run by `lib/setup-odds.mjs` and saved as `setupOdds` in `picks-open.json` and `picks-accuracy.json`; the Open picks table gains a "Like this" column.
- Owner: Home's "Next Top Picks run" tile says when the last run published, and Open picks shows a note when the latest 11:00 / 15:30 ET run has not published (or published late), read from the run's own timestamp.

- New ways to see the data, all public unless marked Owner. **Market map** page (Stocks): a fear map (each stock's IV percentile against its put-skew z-score), a two-number scatter lens (Owners can put the grade on an axis), a chart wall of small price lines, a crowding map of which stocks move together (Owners see their open-trade pairs highlighted), a breadth panel (share of stocks above their 50/200-day lines, new 52-week highs and lows, up-day volume) and a crowded-shorts screen from FINRA short interest. **What changed** page (Today): what differs from the previous trading day's last build (new options walls, new unusual trades, 50/200-day crosses, streaks started or broken, IV turning rich or cheap, new 13F filings and insider trades); Owners also see grade moves of 2 points or more. **Past days** page (Today): the heatmap, movers and SPY/QQQ/IWM for any of the last ~252 sessions; Owners also get that day's briefs. Built by `lib/market-map.mjs`, `lib/site-changes.mjs` and `lib/market-days.mjs`; `market-days-briefs.json` is Owner-only.
- The stock page gains an expected-move cone on the price chart (one and two standard deviations to each listed expiry, with the next earnings report marked), small charts of the last eight earnings reactions, an option-chain heat grid (open interest and volume by strike and expiry), a **Story** tab that lines up price, news, earnings and flow on one timeline (Owners also see grade changes and Top Picks trades), FINRA short interest with days to cover, and a chatter-vs-price chart.
- Market-structure dates on the Calendar and in the .ics feed: monthly and quarterly option expirations, VIX expiration, the S&P 500 quarterly rebalance, the Nasdaq-100 reconstitution, and estimated IPO lockup ends (`lib/market-dates.mjs`). A **Market dates** filter chip groups them.
- Fed liquidity line on Rates & the dollar: Fed assets minus the Treasury's cash account minus reverse repo, weekly from FRED, with 4-week, 13-week and one-year changes (`lib/fed-liquidity.mjs`, stored in `macro-history.json`).
- Unusual options trades shows how short-dated the trading is: the share of contracts expiring the same day, within a week, within a month and later, overall and per stock.
- Owner: a grade calibration chart and a daily rank-correlation (IC) line on the Track Record's Grade edge tab, from the stored daily grades (`gradeCalibration` in `lib/grade-research.mjs`).
- Owner: each open-pick rule in "What each open-pick rule turned away" gets a plain **Did it help?** verdict (Helped / Cost trades / No clear difference / Too few yet) against the trades that opened.
- Owner: a **Book risk** panel on Open picks with net and gross stock exposure (delta dollars), daily time decay, the largest name, exposure by sector group, and an expiry ladder that flags earnings and Fed, CPI and jobs dates before each expiry.
- Owner: a trade journal. A note and tags (from a fixed list) per trade and per ticker, on Open picks (cards and the table's expand row), the Track Record's closed trades and the stock page's Top Picks tab. Saved in the Owner's `picks-fills.json` under `notes` (`applyTradeNote` in `lib/track-record-fills.mjs`); a CSV upload keeps them.
- Owner Sports: each model stat's check now draws a calibration chart (what the model said against how often it happened), passed through the status route.
- Every Top Picks decision run (11:00 and 15:30 ET) now saves the whole scored universe to an Owner-only day file, `picks-run-YYYY-MM-DD.json`: each name's total, pillars, signal votes, entry timing, the AI grader's verdict, the single option it would buy with bid and ask, and what the run did with it, plus each shipped pick's real contract. Measurement only; picks are unchanged. `PICKS_RUN_ARCHIVE=0` turns it off.

### Changed

- Top Picks buys a single call or put by default. A debit spread is used only when earnings fall inside the hold, one contract would cost more than $5,000, very rich IV can't go to a credit spread because an event is close, IV history is missing, or skew is adverse; macro events, Rich IV and a moderate grade no longer force a spread, and credit spreads are unchanged. New trades carry a structure-rule version, so the Track Record shows a dated divider (no reset), and the Scorecard adds a "Singles vs spreads" table. Debit spreads use a width that costs $5,000 or less a contract when one exists. The AI grader's instructions and its two worked examples describe the same rule. `PICKS_SINGLES_DEFAULT=0` restores the earlier mix; `PICKS_SINGLE_MAX_COST` sets the cap.

### Fixed

- Bottom tracker: the valuation card reads SPY's trailing P/E (labeled) when Yahoo reports no forward P/E for the ETF, which it never does, so the card no longer says "Unavailable" every day. The high-yield and investment-grade spreads are checked again every three hours while they are behind the last completed session, so the tracker no longer runs a day behind Market analysis (3.32% vs 3.48% on Nov 5).
- Historical Data checks: the effective fed funds rate (`DFF`) is published for every calendar day, so its weekend rows are no longer a "fail"; an old weekend date in FRED's CPI or jobs release calendar is a warning (the release study already skips it), and only one since 2000 fails. The check names the weekend dates it found.
- Risk analysis scenarios: a jobs headline or "Unemployment Rate" row no longer reads as an inflation surprise or a Fed event. The calendar files every BLS release under one data-release type, and the scenario engine now matches the title instead.
- Market analysis premarket leaders: "Soared" needs a day move of at least 2%; a +0.1% premarket gap that reached +0.6% (COST on Nov 6) now reads "Held".
- The hot-fixes browser test matches the site again: the Owner sign-in check from #723, the Top Picks endpoint from #724, the Market value column, the grade chart's 170px height and the stock page's Grade tab. It also runs without a hydrated `data/` folder.
- "Why no picks today" names the rule that really stopped a name when the AI review was skipped because nothing could open (waiting for an economic release, waiting for earnings, the score or losing-streak bar, a cap, no contract) instead of "No AI review slot". Release and earnings waits get their own labels in the Track Record's rule table too.
- Overnight markets shows its gap call and session call again; the UI overhaul's styles had hidden them.
- Opening Compare no longer pins its four starter companies to a tray at the bottom of every other page. The tray appears once you add or change names, and "+ Compare" on another page starts your own list.
- Public visits no longer ask for the Owner-only trends history on every page load (Market themes has been Owner-only since #723).
- What changed says a stock "moved back above" or "dropped below" its 50- or 200-day average; daytime builds read the current price, not a close.
- A failed sports prop refresh logs why (its own reason and each feed's state, never lines, names or keys).
- Browser tests for Overnight markets, Pattern lab and the earlier hot fixes match the Owner-only Overnight desk, the stock page's Grade tab and renamed columns.
- Line charts no longer print the last date label on top of the one before it.
- Rates & the dollar draws the one-year history and the Fed liquidity line even when the build has no live macro snapshot.
- The Calendar keeps a VIX expiration that falls before that month's option expiration when the window ends between the two.
- The stock page's Timeline and Past days read Top Picks trades and grade changes through the Track Record's copy, so a period the Owner wiped from the record stays out of them too.
- Unusual options trades shows "—" (with a hover note) for a stock with no option expiring that day, and 0% when one is listed but barely traded.
- The Owner Market Brief stays readable through the evening. A short-lived public source (the hourly Volume scan, gamma) now hides only its own line when it lapses, instead of blanking the whole brief three hours after the last scan.
- The Owner Market Brief says "No open model positions" when the model book is flat, writes "1 observation", and ends the market drivers with a full stop before the scenario note.
- The Market brief's site scan reads upcoming-earnings run-ups and implied moves in the right units, so a large run-up into a report is flagged again ("±18.7% implied", not "±0.1873%"). It also rounds the earnings ripple move and writes "an upper break".
- The earnings calendar no longer asks Nasdaq about market holidays such as Thanksgiving, which marked the Calendar's earnings lookup incomplete and flagged it in the Update Checker.
- Owner Market Brief, Update Checker and Research Lab show their title once. The page header carries it, and the intro moves under "About this page".
- The Owner Market Brief stays readable over weekends and market holidays. Its age limits count open market days only, so the Friday 16:10 brief lasts until Monday's builds replace it, and its sources no longer turn "stale" on a Sunday. The brief is now built on market days only; a weekend or holiday build leaves the last one in place.
- The fear map tags only upcoming earnings, What changed no longer colors a streak that ended on a flat close as a drop and writes "an 8-day", Past days leaves ETFs out of its stock map and labels a trade's P&L as "now" or "closed at", and percentiles read 1st / 2nd / 3rd / 82nd instead of "82th" (stock page, fear map and the VIX rank lines).
- `npm run verify:risk-cost` runs again. Since the Top Picks settings moved to their own file on Nov 6, it pasted that file into the old build it compares against and stopped with a duplicate-import error on every branch.
- Market holidays no longer run a full build. The Daily build router reads the NYSE holiday table (the one the Top Picks watchdog uses) and skips the build, Brief, Top Picks and Webull mirror on a weekday holiday (Labor Day ran the bakes and both Top Picks runs); the earnings-call transcript slots still run, and `force=true` still builds on purpose. The close-bake fallback no longer forces a holiday bake. On a 13:00 ET half day there is no 15:30 Top Picks run after the bell (#771).
- AM earnings reports use the real 09:30 ET open as their print time in both seasons. In summer the old fixed time was 10:30 ET, so the 10:00 ET bake re-stamped the "going in" IV and implied move after the open, which made summer AM implied moves too small (AXP Oct 23: 1.7%) and the Earnings results "beat the implied move" count too high. A one-time pass drops those post-open stamps (only where the "pre" IV is no higher than the post-print IV) and rebuilds an estimate from the IV crush (#771).
- The Calendar shows the stored pre-print implied move for a report that already came out, instead of the post-print straddle (MRNA's Nov 6 row read 1.3%) (#771).
- Calendar market-odds chips on CPI and PPI rows show the most likely outcome of the busiest matching market, not its busiest bucket ("≤0.1% · 8%" on October CPI MoM) (#771).
- Overnight markets no longer lists CSI 300 as "Closed overnight" every morning. The feed sends it as one bar with no prior close; that now reads "no prior close in the data feed" and raises no holiday event (#771).

- Pending Buyouts no longer borrows another listing's quote for a foreign target (Ausgold "AUC" showed a US stock's $6.56 against a 1.36 offer, with that company's market cap and a made-up equity value). A quote far from the deal table's own price is ignored, and a row with no matched quote shows its price with no currency sign instead of "$", noted under the table.
- Commodities flags a reading the source stopped updating as "aged" even when the fetch succeeds (the potash PPI series ended in December 2022 but counted as current), with the date in the badge's tooltip on both cards and the table.
- IV history keeps one sample per trading session: a forced weekend or holiday build re-prices the last session's chain, and that repeat is dropped when the next build seeds the history, so it no longer counts twice in the IV percentile or shortens a 5-session change.
- The "next update" line follows the router on market holidays and early closes: the earnings-call runs still show on a weekday holiday, and an early-close day shows no 15:30 Top Picks run. The browser's holiday and half-day tables now come from `lib/us-equity-calendar.mjs` (the workflows' table), which adds 2028.
- What changed, Market map, Past days and the Calendar's coverage line show build times in the header's time-zone setting, like the rest of the site, instead of always ET (the Calendar line also drops the seconds).

### Removed

- Drop Eli Lilly's investor news feed. It and its mirror returned HTTP 403 to every build, so News was always flagged in the Update Checker. Drugs@FDA still covers LLY.

### Docs

- The undated "Unreleased" changelog entries now sit under the dates they landed (November in this file, October in `docs/changelog/2026-10.md`).
- CLAUDE.md describes the new pages, files, Owner/public split and the `test:views-next` / `test:views-next-browser` checks.
- CLAUDE.md and `docs/top-picks.md` describe the missed-run watchdog, similar-setup odds and the edge panel, with their checks (`test:top-picks-watchdog`, `test:setup-odds`, `test:edge-odds-browser`).

## 2026-11-06

### Added

- Every Top Picks trade now saves what the engine saw at entry (`entrySnapshot`, under 1 KB): each pillar, every signal's vote, the retired MACD and 52-week votes, RSI, distance from the 20/50/200-day averages, the prior 20-day range, the streak and its read, the heavy-volume move, the last earnings reaction and the logged candidate signals. It stays with the trade in the archive, so any input can be tested on real trades later without a separate log (#757).
- The AI grader gets two more lines when they apply: validated ripple peers that report inside the hold, with their typical move on this stock (Earnings ripple effects), and the site's own revenue and EPS forecast when the stock reports inside the hold (Earnings Forecast) (#757).
- The Streaks page reads each 3+ day run with its 20/50/100-day averages: a chip on each card, a "Trend read" column and sort, a Read filter, and four tiles with how each read did over the next 10 sessions in a 135-stock replay. Owners also see the Top Picks vote and a decision desk led by the runs that carry one; "Just snapped" is now "Recently ended", because ended runs usually kept their old direction (#757).
- The Track Record shows a likely range next to every win rate (95% Wilson range, with a "few" tag under 10 trades), a "36 of ~140 trades needed to judge the record" chip, the win rate by market regime on the Scorecard, and one table with a row per rule set (each dated divider) so grade and rule versions can be compared side by side.
- Each Top Picks trade on the Track Record and Open picks can be marked "I took it" or "I skipped it" with a reason. Marks are saved privately in `picks-fills.json`, and Real fills compares the trades you took with the ones you skipped.
- Every sortable table shows a small "Reset sort" link (naming the sorted column) while a header sort is on; it puts the rows back in the page's own order and forgets that table's saved sort.
- An **Earnings week ahead** page (Earnings section) lists every covered report in the next 10 days: the move options price for the print next to the stock's own usual move over its last 8 reports (Pricey / Cheap / About usual at ±15%), how often it beat the priced move, how often it rose, the 10-day run-in, and this season's beat rate and reactions. Owners also see a Top Picks plan column from the same event rule the live engine runs (`earnings-week-plan.json`, Owner-only). Built from the chains and earnings history the bake already holds; no new fetches or AI calls.
- Every page's freshness line now says when it updates next ("Updated 14 min ago · next update 15:30 ET"), from one schedule in `lib/refresh-schedule.mjs` that the Update checker timeline also reads; holidays and weekends are skipped.
- Tap-to-define words: dotted terms such as Calls per put, OI change, Squeeze score, IV percentile and Implied move open a short plain-English meaning, and a new **Words used on this site** page (Learn & help) lists them all, from one list in `lib/glossary.mjs`.
- Compact one-line rows on phones: All stocks, Up/down streaks, Options walls and Moving averages open on a phone as a table with one line per row (sub-lines hidden), so the longest card pages shrink to a scrollable list; a "Compact rows" button turns it off and Cards stays one tap away.
- Press ? (or the footer's "Keyboard shortcuts" link) for a list of the site's shortcuts: ⌘K / Ctrl K and / for search, arrow keys and Enter in results and table headers, Esc to close.
- Open picks trade lines carry a two-leg close ticket for each spread: buy back the short leg and sell the long leg, one line and Copy button each, with limits at the live mid (read from `/api/contract` when the ticket opens) and the net credit or debit; it advises one spread order, or the short leg first when legging out. The copied feed text is unchanged.
- Owners' stock watchlist (☆ Watch on a stock page) now syncs across devices: it is saved privately per Discord account in `owner-watchlist.json` (Owner-only, request-time-owned, never readable through the MCP) through `/api/auth/owner-watchlist`, with a three-way merge so a removal on one device sticks (`lib/owner-watchlist.mjs`). Public visitors keep their list in the browser as before.
- Owner-only watchlist alerts on Home ("Your desk") and the stock picker: a watched name that crossed its 50- or 200-day average since the prior close, reached or passed its options call or put wall, or printed unusual option trades today. Rules in `lib/watchlist-alerts.mjs`, read from the public moving-average, options-wall and unusual-trade files plus live regular-session prices; no AI and nothing is sent anywhere.
- Calendar subscribe: a Subscribe / Download .ics / Copy link box on the Calendar page adds watchlist earnings, CPI, jobs reports and FOMC decisions to a phone or computer calendar (`lib/calendar-ics.mjs`, `/api/auth/calendar-ics`). Owners get a private signed link that follows their saved watchlist; everyone else gets a link for the names on their device.
- Friday recap: a Week recap tab on the Owner Track Record (`lib/week-recap.mjs`, no AI) shows the trades opened and closed Monday to Friday, win rate by entry type this week and to date, the biggest miss (the losing close with the highest entry score), the best close and the rule that turned away the most names, with week back/forward and Copy recap. Home's Your desk links to it from Friday 4 PM ET through the weekend.
- "Why no picks today": when nothing is ready to buy, the Owner Top Picks tab leads with the five names that came closest in the last run, the rule that stopped each and what it would take to get through (`lib/no-picks.mjs`, read from the run's own gate trace, topped up from the grades under the score bar). The same read is the Owner MCP tool `get_near_misses`, and the rule labels now come from one place for the card, the Track Record and the Week recap.
- Home-screen app: the site can be added to a phone's home screen (`manifest.webmanifest`, icons in `icons/`, drawn by `scripts/make-app-icons.mjs`) and opens with no connection, showing the last public copy with an offline note. The service worker (`sw.js`) keeps only the page shell, code, icons and the two public manifest sidecars, always tries the network first, and never stores `/api/` answers or other `/data/` files, so no Owner data stays on the device.
- Earnings week ahead is readable through the MCP (get_feature earnings-week, Owner dataset plan) and Research Lab evidence; new browser check scripts/site-next-browser.mjs (npm run test:site-next-browser) (#760).
- Anchor NBA research pairs to fresh sportsbook prices, show minutes/usage/absence scenarios and explicit pass states, evaluate owner-entered payouts, and retain private reproducible decision snapshots with prospective calibration, closing comparisons and frozen paper returns (#758).
- Add a reproducible walk-forward replay of archived PrizePicks lines, with separate validation/test dates, team-constrained pairs, coverage and uncertainty reporting, and checks against future-data leakage (#756).
- Show each NBA/NFL game's two strongest eligible PrizePicks player props using a free PropLine feed, current injuries, player form, workload, defense, splits and rest; preserve the first issued pair in a private win/bust track record with original lines, saved reasoning, stat breakdowns and a research-data export (#753).

### Changed

- The technicals pillar's price signals are fixed (`GRADE_MODEL_VERSION` `2026-11-price-pillar`, a dated Track Record divider): the support/resistance break now compares the close with the prior 20- and 100-day range (it could never fire before, because the range included the same day); the streak vote reads the run with its moving averages (+1 for an up run above them on steady volume, −1 for a bounce or a slide below them, no vote for a dip in an uptrend); the MACD and 52-week votes are dropped (no effect, and the 52-week vote pointed the wrong way). Open trades whose only entry drivers were MACD or 52-week no longer close as thesis-broken when those votes disappear (#757).
- No new post-shock puts open while the Bottom tracker reads a potential bottom or later; the Top Picks meta says why the lane is shut (#757).
- Top Picks now trades events instead of always waiting them out. An open pick can enter through an FOMC decision or a CPI, PPI or jobs report inside two sessions when the market tape agrees with its side (calls in a risk-on or neutral tape, puts in a risk-off one), and through the stock's own earnings when its reaction record, this season's reactions and the run-in add up on its side. After a confirmed index break (risk-off tape, SPY/QQQ axis at -2, both under their 20-day average) puts can open at the regular put bar instead of the Strong bar. Event trades stay on defined-risk spreads, are capped at 2 per macro event, 4 a week and 2 post-shock puts at once, carry an event tag in the record, close at a post-event review when the grade on their side falls below 4, and post-shock puts close after 10 sessions. `PICKS_EVENT_AWARE=0` turns it off. The Track Record shows a dated divider (entry timing v5), an "event play" split, and an event line on each open pick; the AI grader is told not to wait only because an event is ahead.
- Top Picks opens at most 2 new trades per run from one stock group (the tech/AI group: semis, software, mega-cap tech, storage, data-center power). On Oct 28 one run opened WDC, TSM, MU and ORCL together and all four were stopped. Names held back show as "Same-group limit" in the gate log; watch ideas keep the wider 5-per-group cap. The caps now live in `lib/top-picks-caps.mjs`, and new trades carry `capsVersion` for a dated Track Record divider (no reset).
- The Compare list now survives a reload: the tray and the "✓ Compare" buttons come back with the names this browser last queued or compared, even if Compare was never opened.
- Options walls uses plain names: "Calls per put" for C/P, "OI change" for ΔOI and "Squeeze score" for the gamma squeeze score, in headings, sorts and chips.
- The Top Picks settings (every PICKS_* value: roster shape, conviction bars, entry timing, exits, sizing, IV cost) move from scripts/build.mjs to lib/top-picks-config.mjs with no change in any value; build.mjs imports them and keeps every export it had.
- The owner-scope check compares the guarded producer, storage, broker and calculator code with a saved list of fingerprints (scripts/owner-scope-baseline.json, refreshed with --update) instead of failing on every branch that touches build.mjs.

### Fixed

- The Webull end-of-day closing check runs on time again: the 15:30 ET Top Picks build now starts it and it waits for the final 20 minutes. GitHub's own schedule had been starting it 1.5 to 4.5 hours late, after the close, so every day's last run failed (#761).
- The public Streaks table lost its ticker column, and the cards their Open buttons, because the Owner gate strips Grade links; they now open the public stock page (owners still land on the Grade view). The Grade column and Grade sort show only for owners (#757).
- A table's third header click (original order) now restores the page's own order exactly; rows with a missing value in the sorted column no longer stay at the bottom.
- Main's failing checks pass again: the link-map, evidence-record and LEAPS paper tests read the current owner-only grades rule and the shared output lists; the cost check compares against the branch point and counts new AI or network calls, not data writes; the browser tests sign in the way the site now checks (authed), serve Top Picks from its owner route, pin dated fixtures to their own clock, wait for the new equity chart, and skip the cached-data pass when no data folder is present.
- Owner watchlist: a save now runs under the store lease, and the browser sends one save at a time and keeps only the newest reply, so two quick clicks or two devices can't drop a name (#760).
- Watchlist alerts say "today" only when the flow scan ran today (else they name the date), and show the trade's real expiry date (#760).
- Earnings week ahead: a report that printed this morning shows as Reported with its move and the move options priced going in, no longer counts in its own history, and gets no Top Picks plan; the Owner plan reads open trades from before the bake clears data/ (#760).
- Week recap to-date rates include archived trades; a second took / skipped tap while one is saving now waits its turn instead of being dropped (#760).
- The calendar feed keeps tonight's events until midnight in New York, not 8 PM; the no-picks card reuses the cached grade index; the Glossary has no refresh time; the Options walls card no longer nests a button in a button (#760).
- Replay NBA source-outage snapshots through the original no-pick gate, preserving exact research verification when a feed is unavailable (#759).
- Keep NBA collection in its own workflow queue and defer busy writes safely so frequent NBA scans cannot displace pending NFL updates (#759).
- Require each game’s two recommended props to include one player from each team, including later track record slot fills (#756).
- Match Rams props to nflverse’s team id, close cached picks at the earliest known kickoff, use the prop’s actual workload, honor explicit injury clearances and stable athlete ids, and download complete prop records in bounded consistent pages.
- Refresh sports prop lines and track record results when returning to a hidden browser tab.

### Docs

- CLAUDE.md lists the new alert, recap, calendar-feed and app-install pieces, and now says the grade index and daily grade totals are Owner-only, as lib/premium-keys.mjs has had them.

## 2026-11-05

### Added

- Add a stop, spot and target bar to each Top pick card and each open pick (stop on the left, target on the right, entry and now marked), and show when each open pick was opened in ET ("Opened 3d ago · Jun 13, 3:43 PM ET"). The Open picks table gains "Opened (ET)" and "Stop → target" columns.
- Add a "Watching" list to Top picks on days with no pick: the names that came closest and the rule that held each one back.
- Add a Fed path strip to Rates & the dollar: cut, hold and hike odds as one stacked bar for each of the next three meetings.
- Add charts to the Rates & the dollar page: the full Treasury yield curve today against a month and a year ago (from the Treasury par-yield feed the build already reads, `lib/rates-history.mjs`), and about a year of daily 2-year and 10-year yields with the dollar index on its own axis (1M / 3M / 6M / 1Y). Both ride in `macro-history.json`; a failed feed keeps the last good copy, marked stale.
- Add a running total to the Track Record: daily paper equity at $10,000 per trade with a "below the high" drawdown pane under it and dated marks where the grade, entry or exit rules changed (1M / 3M / 6M / All). The Site equity view uses the same chart.
- Add an event path to each Historical Data event study: the median move over the 60 sessions after the event, with the middle half of past episodes shaded.
- Add a "Beat or miss, and how the stock reacted" scatter to Earnings results, with counts for beat and rose, beat but fell, missed but rose and missed and fell.
- Add "Who bought and who sold" to Who owns what: each manager's biggest adds and cuts last quarter as bars, valued as shares changed × the quarter-end price so a holding that only rose in price doesn't count as buying.
- Add a table view to Options walls (one row per stock, with a bar showing where the price sits between its put wall and call wall; the strike ladder opens under the row) and to Unusual options trades (the flagged trades themselves: stock, contract, time, tape, premium, contracts this hour, volume vs open interest and repeats).
- Add "Every stock against its averages" to Moving averages: each stock's distance from its 20, 50, 100 and 200-day averages as small bars on one centred axis.
- Add "Your desk" to Home for the Owner: open trades, the time of the next Top Picks run (11:00 or 15:30 ET) and what changed in the Owner brief. Public visitors never see it.
- Add a weekly timeline to Capital markets: debt, convertibles, share sales, buybacks and IPOs by week as stacked bars, with filters and a list of each week's events (two-line rows on phones).
- Add a shared table to LEAPS, Stock picks, Sector rotation and Leveraged ETFs (idea, side, horizon, risk note, record) and a track-record chip under each title. The LEAPS chip reads the LEAPS paper record; Stock picks says it has no record yet.
- Add "What changed vs last call" to Earnings calls: guidance, tone and risks next to the previous call's brief. The bake keeps a compact copy of the prior brief in each transcript file (`prior`); it fills in as each name reports its next quarter.
- Add the last four earnings-day moves to each Calendar earnings row, next to the implied move (`lastMoves`, read from the stored earnings history).
- Add a "New" badge to News stories published since your last visit (kept per browser, `stonks-news-seen`), and group stories into Market-moving, Company and market, and Macro and economy.
- Add a month-by-year heatmap to Pattern lab (30 years of monthly returns) and a year strip to the index calendar.
- Add a ripple table to Event spillover: each peer's average move after the lead stock's event, in one sortable list.
- Add a trend strip with a small history line to AI CapEx, RAM prices, GPU cloud prices and Search interest, and a timeline of one trading day's site updates (08:00 to 20:00 ET, one row per job) to the Update checker.
- Add a top strip to Market Analysis, Risk Analysis and the Bottom tracker with the few numbers each page is about, and a contents list to the long Learn & help guides.
- Add a forecast-against-actual chart to Earnings Forecast, a table view with the deal spread to Pending buyouts, and a table view to Commodities.
- Add the average win and average loss to the Track Record scorecard.

### Changed

- Regroup the menu so each section answers one question: a new **Earnings** section (Earnings results, Earnings calls, Earnings ripple effects), "Charts & signals" becomes **Price signals** and takes Trading volume, the Index calendar is renamed **Daily index moves**, and Privacy and Terms leave the menu (they stay in the footer and in search). Page ids, pins and old links are unchanged, and the old names still find each page in search.
- Fold "Grade a stock" into the stock page: Owners get a **Grade** tab next to Overview (the full grade tool, with its live prices and contract picker), the separate menu item goes away, and old `?tab=grade` links, the Calendar, the heatmap and the "Jump to a ticker" chips open that tab for the chosen stock. The Owner tab on the stock page is now "Top Picks trades". Public visitors see the stock page as before.
- Show one search box on desktop: the header search stays and the sidebar's "Search the site" button only appears in the menu drawer on smaller screens.
- Home "Explore by topic": a topic left alone on the last row spans the full row.

- Home index tiles show the price, the day change and a small line of the last session (the bake now saves each index's 30-minute closes and last month of daily closes), "At a glance" fills whole rows, the News tile shows the top story, and "Explore by topic" starts folded on wide screens.
- Market brief: ticker mentions in the summary and takeaways are chips that open the stock page, and the stat strip sits under the headline as context.
- Heatmap tiles use the sans font and seven colour steps clipped at the period's scale, so small moves on large tiles show a clear tint.
- Calendar opens on an agenda of the next 14 days grouped by day; the month grid is the other layout and the choice is remembered.
- Overnight markets puts US futures first and open, adds one table of every market with region chips (default on wider screens), and moves the correlation note behind an ⓘ.
- Who owns what puts the stock and fund search after the summary and the buy-sell chart, and turns the five research sections at the bottom into tabs.
- Rates & the dollar tiles show the value, the change and a 1-month line; the weekly change and the prior reading move into the tooltip, and the "normal" badge is hidden.
- Options walls opens on the first default name whose chain has open interest (SPY, then QQQ, NVDA, AAPL, MSFT) instead of an empty chart.
- Up/down streaks cards label their stats "run move" and "8/10 days up" on one line.
- Compare stocks opens with the last set you compared (or the four largest companies the first time), keeps the set in the link (`?tab=compare&cmp=AAPL,MSFT`) with a Copy link button, and labels the chart axis in round steps.
- Market mood leads with the gauge, the past year against the Fear and Greed bands, and the seven parts as small bars; the playbook and part explanations follow.
- Central-bank gold shows net tonnes bought each quarter on round tonne steps with year labels, the latest quarter highlighted, a dashed average line and 5Y / 10Y / All.
- The Owner Grade page shows the price chart at the top, above the grade. Grade score over time uses the full width, labels the call and put zones on the chart, and opens on the last month (1M / 3M / All).
- Long lists open as a table on wider screens: Up/down streaks, Leveraged ETFs, Open picks, Options walls and Unusual options trades join All stocks (phones keep cards, and a saved choice still wins). Long tables keep their header in view, and on phones the first column stays put while the rest scrolls sideways.
- Rising volatility shows each stock's IV percentile as a bar and the shared Cheap / Rich / Very rich label.
- The Owner Grade page shows its indicators as one grouped table (momentum, moving averages, volume, support and resistance) instead of eleven tiles, with shorter notes.
- Narratives show compact cards with up to eight long and short names as chips; the full thesis, names and evidence open on click.
- The weekly Alt Data pages (RAM prices, GPU cloud prices, Search interest) say "weekly data, updated Fridays 11:30 ET" with the date of the next run, instead of a daily-build age.
- Trading volume puts each chart's legend in its header, uses blue for below-average days (the hint already said blue), and uses one type scale for the page.
- Sector rotation draws each sector as a point on the strength-vs-momentum map without tails (there is no weekly history to draw them from).
- Owner pages share one sub-tab style (Historical Data, Forced Liquidation, Earnings Forecast, Sports, Owner brief). The Unified Signal Engine lays its signals out as a matrix, and the Owner brief labels each change by kind and since when.
- Forced Liquidation leads with compact headline numbers; Sports shows when its data last updated and draws a break-even bar on Pick Builder entries; the Strategy builder shows the payoff chart first; the Heatmap toolbar sits on one row; Update checker statuses are pills; the sector split bars open by default.

### Fixed

- On phones, the Home index tiles sit two to a row instead of overlapping, and the Market themes summary card (market tilt, story counts, leading stories) fits the screen instead of running off the right edge.
- Restore regex escapes that the generated app.js was silently dropping. GPU cloud prices now drop the "NVIDIA" prefix from model names and Commodities driver notes show their first sentence again; three other spots (RAM price text, Pending buyouts dates, export file names) happened to work and are fixed for safety. `npm run test:charts` fails on any new single-backslash escape in the generated scripts.

## 2026-11-04

### Added

- Add a public stock page (`?tab=stock&s=NVDA`, sidebar "Look up a stock"). It shows the name, price and day change (live while the market is open), a price chart (line or candles, volume, 50- and 200-day lines, 5D to 1Y), key numbers with a 52-week range bar, and tabs for Overview, News, Earnings (last 8 reports and the latest call), Options (IV percentile, expected move, walls, unusual trades), Ownership (13F fund moves, Form 4 insider trades) and Similar stocks. Owners also get an Owner desk tab with the grade and the stock's Top Picks trades. A Watch button keeps a watchlist in this browser.
- Add one chart kit (`scripts/render/chart-kit-js.mjs`) built on TradingView Lightweight Charts 4.2.3, vendored in `js/vendor/` and loaded on first use. Every chart gets the same crosshair readout, range buttons, source line, loading skeleton and theme colours.

### Changed

- Send public stock links, search results and recently viewed stocks to the stock page instead of the Heatmap. Owners keep the Grade tool for desk links; the search shows a separate Grade row for them.
- Group search results under Stocks, Pages and Themes, with company names beside each ticker.
- Open All stocks as a table on desktop (cards on phones; a saved choice wins), with company names, 1W / 1M / YTD returns, market value and one industry label. Cards show the company name, one label instead of "SEMIS · SEMICONDUCTORS", a dash when there is no day change, and "+ Compare" only on hover.
- Rename the Owner Grade page in the sidebar to "Grade a stock".

- Put every page on one design system: text sizes snap to one 15-step scale (feature pages read one step larger), corners to 4 / 8 / 12 px or a pill, plain drop shadows to three elevations, and numbers use the interface font (its digits are equal width). JetBrains Mono stays for code, keyboard hints and trade lines. Upper-case labels lose the wide letter spacing (`scripts/render/design-system.mjs`).
- Give every page one header: crumb, title, one line of description and the freshness chip on one row. The card title and "How to read" notes that repeated it move behind an "About this page" button, and the bottom Previous / Next links are a thin row on desktop.
- Split the Owner sidebar into Daily desk, Ideas, Research and Admin, so each Owner page shows only its own group's sibling links.
- Merge the sidebar page filter into the site search: the sidebar button opens the same ⌘K search as the header. "Workspace" now reads "Pages" / "Pin this page".
- Make the header quieter: Discord and Support are plain links that drop their words on narrower screens, the time-zone picker no longer truncates, and the footer uses one link colour.
- Show the Update Checker status as a row in the sidebar instead of a toast over the page.
- Hide the repeated "Confirms when / Invalidates when / Required before acting / Do not infer" boxes; each page keeps its status line and the footer disclaimer.
- Use plain words on public pages: "last close" for "baked close", "dealer gamma (est.)" for "GEX proxy", "tends to damp / amplify moves" for "stabilizing / amplifying bias", and clearer Streaks labels.

## 2026-11-03

### Changed

- Re-read a stock's AI news read after 4 new ordinary headlines instead of 2 (`AI_TICKER_CACHE_NEWS_TOLERANCE` default 1 → 3). Material headlines (earnings, guidance, analyst, deals, legal, management), a price move over 2% and fundamentals changes still trigger an immediate re-read. Cuts routine headline re-reads to lower daily Gemini spend.
- A "material" headline (earnings, outlook, deal and similar words) now forces an early news re-read only when it names the stock: its company name, a brand alias, or the ticker. Off-topic results from the Google News search, such as another company's earnings under COST, count toward the 4-headline bar instead. Funds and names without a company name keep the old rule.

## 2026-11-02

### Added

- Add an Owner-only **Sports** section with NBA, NFL and Pick Builder pages in its own sidebar group. This first step is the frame: Today and Tomorrow in Pacific time (with a time-zone picker), each league’s data status, and the Pick Builder steps to come. It reads private JSON under `_stonks/sports/v1/` through the existing Owner session (`/api/auth/me?sports=status`), adds no Vercel function, makes no AI or sportsbook calls, and stays out of the Owner Market Brief, Research Lab evidence and the MCP feature list. `SPORTS_ENABLED=0` turns it off. See `docs/sports/README.md`.
- Connect NFL data to the Owner Sports section. A daily job (`sports-data.yml`) reads free nflverse game and player files for the current and previous season into private storage, without the sportsbook lines the schedule file carries. The NFL page shows today's and tomorrow's games, each team's recent players, player search and game logs with recent averages. A finished season is downloaded once; a bad download never replaces stored data. No AI or sportsbook calls.
- Connect NBA data to the Owner Sports section from hoopR's free ESPN box scores (current and previous season), as a second job in the daily Sports data run. The NBA page shows today's and tomorrow's games, each team's recent players (with anyone who sat out last game flagged), player search and game logs with minutes and the reason for missed games. Both leagues now share one ingest, and stored game logs are packed (a full NBA season shrinks from 16 MB to 4 MB).
- Build the Owner Pick Builder: add 1 to 6 picks from a player on the NBA or NFL page or from its own search, type the payout your app shows (power or flex) and your own chance for each pick, and see the breakeven, the chance all hit if the picks are independent (with the range under any link between them), and the expected profit. Picks from the same game are flagged and not priced. Save it as a paper pick before the games; the journal grades it from the final stats, asks for the app's payout after a push or a player who sat out, and totals paper profit next to what was expected at save. Each pick's history hit rate is shown, and can be copied only from 5 or more games. A shared link can fill in an entry for the owner to check and save. No AI, sportsbook or new Vercel function.
- Add stat forecasts to the Owner Sports section for NBA points and rebounds and NFL passing yards and receptions. Each forecast is expected minutes, pass attempts or targets × the player's rate × the opponent × home or away, with a spread fitted on past misses, so a typed line gets its exact over, under and push chances, an 80% range and what happens if the minutes or targets run 10% lower or higher. The daily data job refits it and checks it on later games it never saw against two simple baselines; a stat is marked as passing only with 300+ checked games, a better score than both and chances off by 3 points or less (on real seasons NBA points and rebounds and NFL receptions pass; passing yards just misses). Player pages show the next game's forecast, Pick Builder picks show the model's chance with a button to use it, saved picks keep it, and the journal compares model and used chances with what happened. NFL keeps three older finished seasons for the model only. No AI calls or new Vercel function.
- Price same-game picks in the Owner Sports Pick Builder. The daily model run measures how picks from one game moved together in past games (the same player's two stats, teammates, opponents) and checks each link on later games against treating the picks as unrelated. Same-game entries now get a chance of all hitting, exact-k chances for flex, a range from how sure each link is, the unrelated number for comparison and the expected value, all from the chances entered and a seeded simulation. On real seasons one NBA player's points and rebounds (+0.28) and an NFL quarterback's passing yards with a teammate's catches (+0.24) pass the check. A pair with no measured link still gets no combined number. No AI calls or new Vercel function.
- Add charts and stats views to the Owner Sports pages. A player's panel now has six charts for any stored stat over the last 5, 10 or 20 games, the season or every stored game: bars around the average (green above, red below, or against a typed line), a trend with a five-game average, hit rates at a ladder of lines, the spread of results, the stat against minutes or volume, and splits by home or away, role, rest, opponent and season, with a facts strip under each. New Player stats and Team stats views sort and chart every player's averages (season, last 10 or last 5; by team, position and games played) and each team's record, scoring and what it allows overall and to each position. The game panel shows each player's last ten games as small bars for any stat, and each Pick Builder pick shows its last ten games against its line. Box scores only; no AI calls or new Vercel function.
- Add six Owner-only Sports tools to the Mingstreet MCP: list today's and tomorrow's games, find players, read a game or a player's log and forecast, check a pick'em entry, and read the model check with the paper journal's totals. A screenshot read by Claude or ChatGPT can now become a checked entry: the evaluate tool gives the same answer as the Pick Builder and returns a link that fills the entry on the site, where the owner saves it. Nothing is saved from the MCP, the link never carries chances, and the tools can read only Sports records. `SPORTS_ENABLED=0` hides them.
- Cover every stored stat and the common combo lines in the Owner Sports section: NBA assists, threes, steals, blocks, turnovers, shooting and rebound splits, PRA, points + rebounds, points + assists, rebounds + assists, blocks + steals and fantasy score; NFL rushing and receiving yards, touchdowns, completions, attempts, interceptions, carries, targets, rush + receiving yards and pass + rush yards. Each one has averages, charts, hit rates, Player and Team stats columns and Pick Builder picks, which also settle from the summed final stats. Stat pickers are grouped Main / Combos / More, and the game log and Player stats table switch their columns between those groups. Model forecasts still cover NBA points and rebounds and NFL passing yards and receptions; other picks say they are history only. Combos are summed from stored box scores, so nothing is downloaded again. A pick from a player's page starts on that player's main stat (rushing yards for a running back) instead of the first stat in the list.
- Add a Matchup section to each game on the Owner Sports pages: both teams side by side before the game (record, home and away, last 10, streak, points scored and allowed, point difference and the chosen stat scored and allowed, each with its league rank), what each defense allows to guards, forwards and centers or to QBs, RBs, WRs and TEs next to the league average (the toughest and softest fifth tagged), and the last 10 stored meetings with the series record and average total (NFL meetings also reach into the three older seasons kept for the model, since most NFL teams do not meet every season; with only two seasons about half of this week's NFL games had none). Each player in the game panel also gets their average against tonight's opponent over this season and last. The player tables fit beside the board on a desktop (an NBA team's shared main stat moves into its heading, and "Games" becomes "GP"), and the matchup tables follow their own width, so they fit on a small laptop as well as a phone. The MCP game tool returns the same. Box scores only; no AI calls or new Vercel function.
- Add a Mingstreet MCP server at `/mcp` so ChatGPT, Claude and other AI apps can read site research: every page and the extra files behind it (histories, logs, earnings-call transcripts), stock research, price history, grades, live quotes, Top Picks and the track record. It is read-only by construction (tools only get a store that can read, and the Top Picks market check runs as an unsaved preview) with no AI calls, signs in through the Discord owner role (OAuth with PKCE, consent page, role re-checked on every token refresh) and uses no extra Vercel function. Webull, fills and secrets are never exposed. See `docs/mcp.md` (#732).

### Fixed

- The Sports MCP game tool returned each player's averages as "{object with 7 keys}" and the evaluate tool dropped each pick's history hit counts, both cut by the MCP's size limit. Averages now come back per measure keyed by stat, and history as `hit_history`.

## Older changelogs

- [2026-10](docs/changelog/2026-10.md)
- [2026-09](docs/changelog/2026-09.md)
- [2026-08](docs/changelog/2026-08.md)
- [2026-07](docs/changelog/2026-07.md)
- [2026-06](docs/changelog/2026-06.md) — 458 entries
