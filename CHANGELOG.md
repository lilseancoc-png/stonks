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

## [Unreleased]

### Added

- Add a reproducible walk-forward replay of archived PrizePicks lines, with separate validation/test dates, team-constrained pairs, coverage and uncertainty reporting, and checks against future-data leakage (#756).

- Show each NBA/NFL game's two strongest eligible PrizePicks player props using a free PropLine feed, current injuries, player form, workload, defense, splits and rest; preserve the first issued pair in a private win/bust track record with original lines, saved reasoning, stat breakdowns and a research-data export (#753).

- Add a Mingstreet MCP server at `/mcp` so ChatGPT, Claude and other AI apps can read site research: every page and the extra files behind it (histories, logs, earnings-call transcripts), stock research, price history, grades, live quotes, Top Picks and the track record. It is read-only by construction (tools only get a store that can read, and the Top Picks market check runs as an unsaved preview) with no AI calls, signs in through the Discord owner role (OAuth with PKCE, consent page, role re-checked on every token refresh) and uses no extra Vercel function. Webull, fills and secrets are never exposed. See `docs/mcp.md` (#732).

### Changed

- Market briefs include public streak reversals and moving averages, Pattern lab outcomes with sample limits, saved overnight calls, insider purchases, financing and buybacks, CapEx guidance changes, wholesale memory prices and Rich option premium. Owner research stays excluded; source freshness and public page links have regression checks.

### Fixed

- Require each game’s two recommended props to include one player from each team, including later track record slot fills (#756).

- Match Rams props to nflverse’s team id, close cached picks at the earliest known kickoff, use the prop’s actual workload, honor explicit injury clearances and stable athlete ids, and download complete prop records in bounded consistent pages.

- Refresh sports prop lines and track record results when returning to a hidden browser tab.

- Stage only the eight required browser assets in Vercel's public output directory and exclude build/scanner sources, documentation, and repository metadata from deployment uploads. (#707)
- Request an uncompressed R2 lock with a strong ETag so a released Webull paper lock can be acquired conditionally; fail closed on malformed locks or repeated conflicts, expose Owner-only diagnostics, and report mirror failures in a separate workflow health job.
- Reconcile Webull grouped option positions using confirmed broker order legs and stable position identities; prepare manual spread adoption without replaying its entry, retain separate overlapping manual holdings, and exclude manual entries from automatic fill timing and slippage.

## 2026-11-06

### Changed

- Top Picks now trades events instead of always waiting them out. An open pick can enter through an FOMC decision or a CPI, PPI or jobs report inside two sessions when the market tape agrees with its side (calls in a risk-on or neutral tape, puts in a risk-off one), and through the stock's own earnings when its reaction record, this season's reactions and the run-in add up on its side. After a confirmed index break (risk-off tape, SPY/QQQ axis at -2, both under their 20-day average) puts can open at the regular put bar instead of the Strong bar. Event trades stay on defined-risk spreads, are capped at 2 per macro event, 4 a week and 2 post-shock puts at once, carry an event tag in the record, close at a post-event review when the grade on their side falls below 4, and post-shock puts close after 10 sessions. `PICKS_EVENT_AWARE=0` turns it off. The Track Record shows a dated divider (entry timing v5), an "event play" split, and an event line on each open pick; the AI grader is told not to wait only because an event is ahead.

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

### Fixed

- The Sports MCP game tool returned each player's averages as "{object with 7 keys}" and the evaluate tool dropped each pick's history hit counts, both cut by the MCP's size limit. Averages now come back per measure keyed by stat, and history as `hit_history`.

## Older changelogs

- [2026-10](docs/changelog/2026-10.md)
- [2026-09](docs/changelog/2026-09.md)
- [2026-08](docs/changelog/2026-08.md)
- [2026-07](docs/changelog/2026-07.md)
- [2026-06](docs/changelog/2026-06.md) — 458 entries
