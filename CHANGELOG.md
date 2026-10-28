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

### Fixed

- Stage only the eight required browser assets in Vercel's public output directory and exclude build/scanner sources, documentation, and repository metadata from deployment uploads. (#707)
- Request an uncompressed R2 lock with a strong ETag so a released Webull paper lock can be acquired conditionally; fail closed on malformed locks or repeated conflicts, expose Owner-only diagnostics, and report mirror failures in a separate workflow health job.
- Reconcile Webull grouped option positions using confirmed broker order legs and stable position identities; prepare manual spread adoption without replaying its entry, retain separate overlapping manual holdings, and exclude manual entries from automatic fill timing and slippage.

## 2026-10-28

### Added

- Forced Liquidation Tracker reads Form 144 and 8-K filings and flags reported forced sales (margin calls, pledgee or lender sales, foreclosures); risk-factor wording never counts. 13D pledges without margin terms now open up to two loan exhibits.
- Every current pledge gets a 0–100 pledge stress score from the drop since disclosure, the drop from the 52-week high, days of volume, share of float, the modeled trigger and any forced-sale report.
- New Owner views on the tracker: **Hot funds** ($3B+ 13F books up 30% (watch) or 40% (alert) YTD or last quarter, their leverage tells, top 15 holdings priced daily, recent 13D/G and Form 4 filings, and our stocks they hold), **ETF rebalance** (estimated end-of-day trades of single-stock leveraged ETFs) and **Cluster selloffs** (a logged-only Archegos-style detector). No AI calls.

- Historical Data and Pattern lab measure seasonal and election-cycle windows on the S&P 500 index since 1950 (18 midterm years, 1954–2022, instead of SPY's 8) and the Nasdaq Composite since 1971; both are now the default market.
- Historical Data runs data checks every build (missing sessions, off-calendar dates, SPY-vs-index date-label alignment, FRED dating, FOMC/WWDC/event/release date lists) and shows them in Sources as "Data checks"; `scripts/audit-historical-quality.mjs` runs the same checks on raw downloads.
- The Grade tab's earnings history adds a long-run line over up to ten years of stored prints; a one-time backfill per ticker fills the older years.

### Changed

- The FOMC decision list goes back to 1994 (was 2015), checked against the Federal Reserve's historical pages; the event study and Event Spillover use it.
- Event Spillover uses ten years of bars, the full FOMC list and the real jobs-report dates instead of first-Friday guesses.

### Fixed

- The Brief's historical playbook quotes figures measured on our own data (Santa Rally since 1950: average +1.2%, up 76% of years; about 90% of Nasdaq -4% days since 1984 retest the low within five sessions) instead of "per some studies".
- The after-midterm study no longer skips 1954–1966: the NYSE closed for Election Day then, so those windows start from the last close before the vote.
- The earnings deep backfill retries the next day when its long price download fails, and its long-run line counts EPS beats over the same reports as the price figures.
- Event Spillover no longer invents a first-Friday jobs report in a month the BLS calendar skipped (the 2025 shutdown).
- Historical Data names the index ("S&P 500 index") in its conditions header instead of the raw "^GSPC" symbol.

## 2026-10-27

### Added

- Historical Data gains an **Events & analogs** view (Owner): dated event studies for war, pandemics, oil disruptions, tariffs, mania peaks, short squeezes and bank runs; every S&P 500 close down 5% or more since 1950 with 1987 Black Monday; every Nasdaq 4% drop since 1971 (bounce, then lower close); triple witching against other expirations; AAPL around every WWDC keynote; and S&P 500 moves on FOMC, CPI and jobs days. A "Resembles now" panel matches the latest close against these patterns with deterministic price, calendar and headline-plus-reaction checks. New free inputs (S&P 500 since 1950, Nasdaq since 1971, AAPL, KRE, GME, FRED release dates) ride the existing daily refresh; no AI calls. `lib/historical-events.mjs`, `scripts/historical-events-smoke.mjs`.
- The Brief's Historical playbook adds pandemic, tariff and bank-run cues (fresh headline plus a risk-off tape) and its WWDC cue follows the keynote date. `scripts/build.mjs`.
- Earnings Forecast now covers the 20 largest covered companies (was 10) and re-ranks the list once each calendar quarter. New names get a "New" tag; names that leave move under a "Left the list" divider with their frozen forecast and record, and their filings keep refreshing until that forecast can be scored.
- Earnings Forecast adds a shadow business-line model (each reported line's year-over-year growth weighted by its latest share, plus any brand-new line at its latest-quarter level). It is scored on every resolved quarter and only replaces the base revenue after passing the same forward gate as the bias candidate.
- Revenue lines with no prior-period figure are tagged "New since last filing" and named in a forecast warning; companies without a written profile get research prompts built from their reported lines and regions, and the audit script lists them.

### Changed

- Open picks unstick: the 3–7 session macro-event drag is shown but no longer holds back an open pick (the 0–2 session wait before FOMC/CPI/PPI/jobs stays; `PICKS_EVENT_SOFT_BLOCKS=1` restores it), the AI final grader is skipped when no candidate could become an open pick, and the losing-record gate reads only closes from the last 10 days (`PICKS_EDGE_GATE_WINDOW_DAYS`). (#706)
- The SEC segment parser keeps up to three new revenue lines out of "Other" even under 2% (still at most eight named slices plus Other), and falls back to a company's own XBRL segment or region axis when no standard one exists, keeping only periods that add up to reported revenue within 2%. Applies as each company files its next 10-Q or 10-K.
- Earnings Forecast's free SEC source cap rises from 24 requests / 60 MB to 48 / 120 MB per day for the larger list. Still no AI calls. (#703)

- Add an Owner-only Export menu beside split view and the light / dark switch. It saves the open page, Top picks cards (all, or one group such as the six actionable picks), an opened pick's Grade view, a Track record panel, sections and tables as a PNG, picture PDF, print of only that part, CSV, Excel, or JSON, plus the page's source data files. Pictures use the site fonts; nothing calls AI. (#702)

### Fixed

- The Webull paper mirror stopped pausing on every run since 2026-10-22: an entry filled before broker legs were recorded now reads those legs from Webull's own order detail to bind its spread, and positions opened outside the mirror no longer block it (a new pick that shares one of their contracts is logged as missed). Every mirrored entry now ends with a logged reason: a pick waiting on paused orders says so, and one the engine closes before an order goes out is logged as missed with that reason; a positions-parse failure names the check that failed. (#708)
- The fallback FOMC calendar had four wrong 2027 dates (June, September, October/November and December); it now matches the Fed's published 2027 schedule, so the calendar no longer shows phantom meetings next to the live dates. `scripts/build.mjs` (#704)
- Earnings Forecast's "Left the list" section keeps at most 20 former names, and the phone company list uses three columns so it no longer fills the screen. (#703)
- Show the Track record's "Inspect resolved picks" button, which drew with no colour and was invisible. (#702)

## 2026-10-26

### Added

- Rebuild the overnight risk-on / risk-off call. One shared scorer (`lib/overnight-tone.mjs`) now drives the Overnight tab, the Top Picks global tape axis and the live pre-open read. Moves are measured from the prior US close, scaled by each market's normal daily range, and grouped into five one-vote groups (equities, volatility, rates, FX/carry, growth/credit); stale markets are left out with a reason, and Asia is scored net of the prior US day it echoes.
- Save a pre-open overnight call every weekday at about 09:00 ET, inside the existing 09:00 transcripts run (`scripts/overnight-preopen.mjs`, private-store owner `overnight`). Each bake keeps a graded log (`overnight-log.json`), rebuilds missed days from 15-minute bars, and the Overnight tab shows a gap call, a session call that says "no edge" until proven, overnight events, and a track record against SPY with base rates. Free Yahoo data only; no AI calls.
- Add CSI 300, ASX 200, Euro Stoxx 50, USD/CNH, USD/KRW, Russell 2000 and 10Y T-note futures, VIX3M, VVIX, SKEW, MOVE, HYG and Ether to the overnight sweep and the live quote.
- Add `scripts/overnight-fit.mjs`, a read-only report of per-group hit rates and threshold sweeps from the saved log.

### Changed

- The Top Picks global tape axis is now the day's saved pre-open call and stays fixed through the session; with no saved call after the open it votes 0 instead of re-reading the US session. The `PICKS_MACRO_GLOBAL_*` thresholds are removed (`PICKS_MACRO_GLOBAL=0` still turns the axis off).
- Foreign daily bars are dated in the exchange's own time zone, which fixes ASX sessions landing on the previous day.

- Add split view: a button next to the light/dark switch shows two pages side by side (stacked on phones), each with its own page picker, a draggable divider, Swap and Full page. `vercel.json` now allows same-site framing so the panes can load; other sites still cannot frame the app (#691).
- Add plain-English wayfinding on every page: a "Home / Section / Page" trail, a one-line "what this shows" summary, chips for the other pages in the section, and Previous / Next links at the bottom (`scripts/render/wayfinding-js.mjs`).
- Add "Explore by topic" tiles on Home, a "Recently viewed" list in the sidebar and at the top of the empty command palette (this browser only), and a phone tab bar (Today, Stocks, Market, Options, Search).
- Show each stock's day move with an arrow on the All stocks cards, read from the existing public heatmap snapshot.
- Give AAPL and WDC the industries they were missing (Consumer Electronics, Computer Hardware), so every covered stock has one. A new smoke test fails the build if a stock has no industry, if a sector label has no group, or if a group ends up holding fewer than five stocks.
- Log seven candidate Top Picks inputs (21-day return, industry 21-day return, implied minus realized volatility, call and put OI walls, latest print guidance, peer earnings in the next 14 days) beside each day's grade in `grades-daily.json`, and report each one's forward-return IC, with and without the grade, in `diagnose-grade-ic.mjs`. They are logged only and change no grade or pick; no new AI or data calls (`lib/shadow-signals.mjs`, #694).
- Track Record dividers now mark every rule change, not only grade-formula changes: the take-profit move to +25% (Oct 22), the option-price entry check and the volatility-aware entry timing (both Oct 23). New trades also record their entry-timing version.
- Stock picks, Sector rotation, LEAPS and Leveraged ETF cards show a chip when Top Picks holds an open trade on the same name, or when the site grade points the other way.
- Add a Company record view to the Unified Signal Engine: pick a ticker to see its grade breakdown, stored evidence record, company relationships and AI grader log together. Owner Lab Diagnostics links to it, and Owner data stays off the public Look up a stock page.
- Add WTI crude, natural gas and copper to Commodities (sixteen trackers, energy first). Crude, gas, gold and silver reuse price bars the build already fetches, so no new Yahoo calls.
- Add an "At a glance" row of live readings on Home in place of the older grid of links (Explore by topic stays).

### Changed

- One rule now decides whether a stock's options are expensive, in place of four different ones. The grade, Top Picks, the Strategy builder and Trending IV all read it: cheap at or below the 20th percentile of the stock's own history, rich at or above the 80th, very rich at or above the 90th, and rich needs IV to be above the stock's 30-day realized moves as well, so high IV on a stock that is genuinely moving that much no longer counts as expensive. Rich costs the grade 2 points and cheap earns 1. Top Picks sells premium (a credit spread) only when options are very rich, where the old rule fired at the 60th percentile; the Strategy builder moves from the 65th to the same 80th, and its earnings window from 7 to 14 days. Trending IV's "Elevated" tag is now the same rich band and is labelled Rich, on the cards, the chart legend and the page hint. The grade breakdown's "IV cost" panel names the band in its heading, shows the realized-vol check it turned on and explains the rule in place of the retired universe-relative description. Grade version `2026-10-iv-rule` with a Track Record divider (`lib/iv-richness.mjs`).
- Seasonality is computed once and read twice: Pattern lab's months, weekdays, turn of month, expiration week, Santa and midterm rows now come from the same engine as Owner Historical Data, so the two pages cannot disagree about the same bars. Long history also comes from one cache instead of two — Pattern lab and the Bottom tracker both read `historical-source-history.json` (which now carries the two credit spreads the tracker needs), and the separate index long-history file is gone.
- Sector grouping is one map of eight groups (Mega-cap tech, Semis & hardware, Software & IT services, Financials, Consumer & media, Healthcare, Industrials & energy, ETF). After the cut to 85 names, 12 of the 24 detailed labels held a single stock, which made the Top Picks "max 3 per sector" cap, the heatmap sector blocks and streaks, and Compare's sector average meaningless for those names. Every feature that groups stocks now uses the broad group — the cap, the heatmap, Compare, the Volume and Flow sector splits, the All stocks and Streaks sector filters, and the Track Record's accuracy by sector (which regroups old trades too). Each stock keeps its detailed label on its card and in search. Sector rotation, Event spillover and the leveraged-ETF routing keep their own baskets, because each is paired with its own ETF; the semis basket now includes hardware and networking, so DELL and ANET are no longer left out of every basket (`lib/sector-groups.mjs`).
- LEAPS scores are weighted for the one- to two-year hold they are for: Fundamentals 2.0, Trend 1.25, Narrative 1.0, Flow 0.75. The old mix led with Narrative (1.5) and counted the business least (1.0), which fits a one- to two-week trade. The four still add to 5, so the score bars mean what they did. A qualified idea now also needs the business or the trend on its side, not just a story and some option flow, and the fundamentals pillar may not point the other way.
- Regroup the sidebar into seven sections a new visitor can scan (Today, Stocks, Market & economy, Options activity, Charts & signals, Industry trends, Learn & help) plus the unchanged Owner group, each with a one-line description. Pages get plainer names (for example Fear & Greed is now Market mood and Unusual flow is Unusual options trades); old names still match in the sidebar filter and command palette, and every page id and `?tab=` link is unchanged. One site map (`scripts/render/site-map.mjs`) drives the sidebar, page headers, Home tiles, tab bar and palette.
- Give charts one shared finish: soft area fills under sparklines and the Grade price line, round price gridlines ($200, $210, …), a larger hover readout, ▲/▼ arrows next to coloured moves, even-width digits, banded shared tables and a width cap on scatter charts (`scripts/render/data-display-css.mjs`).
- Rewrite README.md around the new site structure.
- Make text on the feature pages about 10% larger (sizes 18px and under; headlines, chart labels, the header and the sidebar keep their size). Small fixed tiles and badges keep their size so labels still fit (`scripts/render/text-scale.mjs`, #692).
- Trim the sidebar: it runs to the top of the window on desktop instead of leaving an empty block above Workspace, shows 4 Recently viewed pages instead of 5 (the command palette still shows more), and drops the one-line description under each section name (#692).
- Top Picks no longer opens a trade on a stock under a signed takeover (its price is pinned to the deal); rumored deals are listed only. A call blocked by the forced-liquidation veto or a signed deal no longer takes one of the six AI grader slots. Blocks show in the Scorecard as "Signed takeover target" (`lib/pending-buyout-guard.mjs`, #694).
- Strategy builder takes its direction from the stock's grade. The chart tape shows as agreeing or conflicting and only decides when the stock has no grade.
- Options walls, the GEX strip and the Brief label gamma walls and OI walls separately, and the Brief uses the shared GEX code instead of its own copy.
- Merge Capital raises and IPOs & credit into one Capital markets page (old links redirect).
- Owner Lab drops the multi-screen overlap, 3-sigma and post-earnings drift screens that repeat public pages, links to those pages, and counts term-structure stress on its desk instead.
- Track Record links to Open picks instead of repeating the open trade cards. The Webull test sub-tab is now Real fills and holds the real-trading comparison and the trade-log upload; the Scorecard keeps a one-line summary.
- The heatmap's closing summary is a numbers-only line and points to the 16:10 Brief for the written closing story.
- News calls its direction filter "Headline wording", the option grader says Pin contract / Pinned contracts, and the "When data updates" timeline matches the current schedule.

### Fixed

- Keep the data-age dot beside its text on screens 380px wide or narrower instead of on a row of its own (#691).
- Keep initial lending limits out of forced-liquidation thresholds, attach pledged-share counts to their own disclosure clauses, and require older extractions to be reparsed before entry decisions use them. Expire volume warnings on open tracker pages and make stalled snapshot reads time out with a working retry.

- Stop the News filters and the Streaks columns from pushing the page sideways when the sidebar is open on laptop and tablet widths, keep the freshness dot beside its text on phones, and keep the LONG · BULLISH badge on one line (#692).

### Removed

- Remove the backtest-picks workflow, which printed the private record to public logs (the local script stays).
- Remove the unused AI_SIGNALS_COMBINED switch and its A/B script. Cached AI reads keep the same key, so nothing is re-read.
- Remove the heatmap's after-close AI recap (one Gemini call a day).

### Docs

- Bring CLAUDE.md and docs/site-logic.md up to date: 14 Owner pages, how the grade total and exits work today, Commodities, Capital markets, who spends AI budget, and how the Owner desks cross-reference each other.
- Document the four single-sourced rules in CLAUDE.md ("One rule per idea"): the IV band, the one seasonality engine and long-history cache, the broad sector grouping and the LEAPS weights. `docs/top-picks.md` now describes the IV band instead of the retired universe-relative IV cohort and the old credit-spread thresholds.

## 2026-10-24

### Added

- **Bottom tracker.** An Owner desk separates a decline from a bottom. A 10% drop only opens the checklist. Damage slowing means the catalyst is easing, both credit spreads have stopped widening, and earnings downgrades are less severe. That is not a bottom. A bottom may be forming only after both spreads have started narrowing, funding stress is not rising, and SPY and QQQ are at least 3% off the decline low with that low at least 10 sessions old. A close under either low cancels it. Emerging recovery and stronger confirmation come only after that forming read persists, with breadth, higher lows, a 200-day hold, and improving earnings. The history counts false positives. No reading claims the final low is in.

### Fixed

- A bottom is no longer called because price is down from the high, or because spreads merely stopped rising while the indexes are still making lows. The decline is measured from the three-year high. Both credit spreads must have widened in that decline. Earnings revisions that were never negative do not count. A higher low has to come off the decline's own low.

## 2026-10-23

### Added

- Owner **Risk analysis**, next to Market analysis, reads Volume, Gamma Exposure (SPY), the Index calendar, Overnight markets, Fear & Greed, the regime, and the Heatmap together. When one desk is severe and another is neutral, the page names the evidence each one is using and what that split means. The read does not average the desks into a new score or change position limits.

### Fixed

- The market-position headline names every severe desk and every confirming desk, and it leaves the gamma structure out of that direction call. Extreme greed without a confirming tape stays a crowded-sentiment warning. A pinning SPY gamma book stays dampening. A live tape refresh keeps keyboard focus and an open disagreement list. A failed heatmap load shows unavailable instead of spinning.

## 2026-10-22

### Added

- Expand Webull Test with Performance, Accuracy, Engine and Trade log views: realized P&L and drawdown curves, matched model comparisons, return distributions, rolling win and direction rates, cohort and entry-probability comparisons, execution states and price gaps. Share and save filters across views, show sample coverage and missing-data states, and provide chart data tables plus a local synthetic preview. Uses the existing Owner-only ledger and pick records without additional broker, market-data or AI calls.

### Changed

- Top Picks takes profit at +25% on single longs and debit spreads, retaining the -50% premium stop and the credit-spread +50%/-50% rules. Newly evaluated open trades store versioned exit thresholds; completed historical results stay intact.
- **Owner Lab separates personal tools, research screens, and diagnostics.** Personal tools opens first. Research summarizes the current snapshot and defaults to qualified pairs; advanced screens and methodology remain optional. Evidence Record explains one company at a time, Company relationships translates the stored joins, and the grader log separates thesis quality from entry timing. Optional records load only on open and refresh on request. No new AI calls, provider calls, workflows, or storage-key families.

### Fixed

- Keep unverified fills and inconsistent quantities out of Webull outcomes, withhold drawdown when paper close dates are missing, preserve archived AI grades, and display broker reconciliation warnings. Preserve keyboard focus during filtering, show all comparison values in chart tooltips, calculate quote-scenario fees against each scenario entry price, and keep compact chart labels readable.

- Owner Lab keeps grader decisions from different runs separate with their recorded times, and omits company returns from relationship edges that contain no company.
- Webull paper execution reconciles confirmed order fills with broker holdings, tracks requested/filled/closed quantities and weighted prices, and replaces only the remaining contracts. Durable order intents and an R2 conditional lease protect retries and overlapping runs. Expiry controls start closes before expiration using exchange holidays and early closes; unresolved expiry or stock changes appear for Owner review without invented fills or automatic stock liquidation. Automatic reconciliation follows publication of the 11:00 / 15:30 ET Top Picks builds, with up to two two-minute follow-ups only for pending work; no all-day polling or AI calls. See `docs/webull-paper-controls.md` for activation and verification limits.
- Automatic options routing treats absent/stale relative IV as unknown and preserves spread restrictions when a leg is unavailable.
- **Owner Lab validates prices and sizing before showing a decision.** Missing prices withhold position verdicts, old or last-trade prices are reference only, and Pass setups receive no leveraged ETF size. Evidence distinguishes collecting history from neutral and separates incompatible metric histories. Volatility-premium rows share one observation date, partial research remains visible, and earnings averages show separate sample counts.

### Removed

- Remove Paper books from Track Record navigation, rendering and saved controls; retain the underlying research history.


## 2026-10-21

### Added

- **More ways to sort, view and compare.** Every table on the site sorts by clicking a column header (click again to reverse, a third time to restore). Every Sort menu gets a flip-order button, and each tab remembers its sort, filters and view on this device; "Reset saved sorts and views" at the foot of the sidebar clears them. New sort options: Tickers (day move, grade score, sector, market cap, 1-month move), Top Picks (probability of profit, delta, IV, open interest, max loss, grade score), Open picks (new Sort menu), the Track Record resolved list (ticker, sector, side, structure, conviction, $ P&L, real-fill P&L), Unusual flow, Volume, Gamma exposure and Streaks (sector, grade, calls/puts first, soonest expiry, nearest walls, up/down first), plus new Sort menus on Stock picks, LEAPS, Earnings calls and Capital raises. Tickers, Top Picks, Open picks, Stock picks, LEAPS, Sector rotation, Leveraged ETFs and Streaks get a Cards/Table switch. Uses only data the site already loads; no AI or data cost.
- **New Track Record charts and a slice comparison.** The Equity tab adds cumulative P&L curves split by side, structure or sector, a histogram of per-trade contract P&L, and a calendar of daily realized P&L. Breakdowns opens with "Compare two slices" (calls vs puts, singles vs spreads, one sector vs another, or before vs after the latest grade-formula change): trades, win rate, average P&L, expectancy, totals, real-fill P&L and both curves side by side, with a warning when either side has fewer than 10 trades. Display only; the record is unchanged.
- **Compare companies upgrades.** Compare now takes up to 6 names, adds a YTD range, switches the chart between return, drawdown from high, 20-day volatility, implied volatility and grade score, and can add a benchmark line (SPY, QQQ, IWM, SMH, the average of the selected names, or the reference name's sector average). It reads the existing per-ticker, IV-history and daily-grade files; no AI cost.
- **"+ Compare" everywhere, plus a compare tray.** Ticker cards, the Tickers table and Grade a ticker get a "+ Compare" button. Picked names collect in a small tray at the foot of the page that opens the Compare tab with them loaded.
- **New charts and views.** Tickers gets a Scatter view (grade score, day move, 1-month move or market cap on either axis). Top Picks gets a Risk map (max loss per contract against chance of profit). Trending IV adds an "IV now vs its own average" chart and a 30-day IV sparkline on every ranked row. Grade a ticker shows the grade score over time. Unusual flow and Volume show flagged premium and flagged names by sector.
- **Heatmap: ranked bars, two periods and new colours.** The heatmap can colour by grade score or by IV against each name's own average. A new View menu switches between the map, ranked bars (by sector and by ticker) and two periods side by side (for example 1D next to 1M, with names whose direction turned marked).
- **Compare: grade pillars and sectors.** Compare shows each name's grade split into its pillars side by side. A new "Compare sectors" panel puts up to 6 sectors next to each other: returns for 1D to 1Y (cap-weighted or equal weight), average grade, share leaning call or put, and IV against its own average.
- **More sort options.** News adds oldest, biggest price reaction, ticker, sector and source. Sector rotation adds sector group and ticker A to Z. Leveraged ETFs add most leverage, underlying A to Z and ETF ticker A to Z. Trending IV adds most unusual, 20-day rising, cheapest against its own average, sector and A to Z.
- All of these use files the site already publishes. The only data change is a 30-number IV series per name in `iv-trending.json` for the new sparklines (a few KB). No AI or paid-data cost.

- **Track Record compared with real trading.** New Top Picks trades store their entry bid/ask (each leg on spreads), and every run also records a real-fill P&L (pay the ask to open, take the bid to close) next to the modeled mark. Each close records its exit trigger next to the mark it was booked at. A paired SPY option opens with every new pick (same side, ~0.55 delta) as a no-skill baseline. The Scorecard shows these in a new "Compared with real trading" row. The model mark and the exit rules are unchanged, and there is no new data or AI cost.
- **Webull paper mirror.** After every full bake, Mingstreet copies the Top Picks record's new trades into the Owner's Webull paper account (1 contract each; spreads as one 2-leg order) and closes them when the record closes them. Entries use a limit at the engine's price, re-try once at the mid while it is within 10%, and are otherwise logged as missed; exits step from the engine's price to the mid to the bid until filled. Every trade is logged by trade ID with labels like "Paper bought 4.0% above engine", shows up under "Your fills vs the record" as "Webull paper", and downloads as CSV. It only talks to Webull's paper (sandbox) servers, stays off until `WEBULL_MIRROR=on` and the Webull keys are set in Vercel, and adds no AI cost.
- **Manual Webull mirror ping.** A new hand-run workflow, "Webull mirror ping" (`webull-mirror.yml`), makes the same mirror call the bake makes, so a Vercel env fix can be checked right away instead of at the next bake. Outside market hours it places no orders. (#676)
- **Webull test view in Track Record.** A new "Webull test" sub-tab compares every mirrored Webull paper trade with the in-house record, with no file upload needed (it reads the mirror's log directly). Six panels: how orders fill against the engine's price (gap buckets, misses, re-prices, time to fill, fill vs mid); a real-money estimate from the bid/ask recorded at each order, less Webull's fee estimate; pick accuracy (win rate, direction hit, vs the paired SPY option, by AI grade, tier, side, structure, sector and regime, plus probability-of-profit calibration); a model check scatter of engine vs paper P&L; a paper vs engine vs SPY curve; and a full trade log. Filters for side, structure, run, status and date range. Each paper order now also records Webull's fee estimate from an order preview, and the bake log's mirror line now says whether the mirror ran or why not (for example "mirror off"), never order or account details. No AI cost and no new serverless function (#675).
- **Your fills vs the record.** The Scorecard takes an upload of your own paper or real trade log (CSV, one row per trade ID) and shows your entry price against the record's mid and your P&L against the record's, per account. Old-style trade IDs (TICKER-C-YYMMDD-HHMM) and any letter case still match. Stored privately (`/api/auth/picks-fills`, Owner only).

### Changed

- **Webull mirror failures name their cause in the bake log.** When the mirror errors, the bake's "Webull mirror:" line now prints the error code, HTTP status and error type (and, for a code bug, its message) instead of a bare "HTTP 502". Webull's own error text, orders and account details stay out of the public log. The mirror also trims its Vercel env values, so a key pasted with a trailing newline or space still works.

- **A 0.0% close is now "flat", not a win,** so it no longer lifts the win rate.
- **Old closed trades are archived instead of dropped.** Trades past the 120-day / 250-trade window move to a slim archive in the same file, and the Scorecard shows an all-time figure once it has any.

## 2026-10-20

### Added

- **Trade lines for copy and paste on Open picks.** A collapsible block below the open pick cards (closed by default) lists every open trade as one plain sentence, for example "OPEN NOW-C-261020-1102: buy to open NOW Dec 18 2026 $450 call at about $6.50 per share ($650 per contract)…", with its latest model price and a warning when it expires within 5 days (Mingstreet only books an expiry after the contract is gone), plus a CLOSE line (reason and model price) for every trade closed in the last 7 days, with a Copy all button. Expired closes say there is nothing left to sell. Each trade keeps the same id from OPEN to CLOSE. Two-leg spreads say Robinhood agents can't place them. No new data or AI cost.
- **Private picks feed link.** `/api/auth/picks-feed?key=<PICKS_FEED_KEY>` serves the same trade lines as plain text with no Discord sign-in, so an outside agent (e.g. a scheduled ChatGPT task) can read them. It shows only these lines, never other Owner data, is `no-store`/`noindex`, and stays off until `PICKS_FEED_KEY` (24+ characters) is set in Vercel; change the value to reset the link. Runs inside the existing auth function, so no new serverless slot.
- **New Owner tab: Open picks.** It sits right above Top Picks track record and lists only the Top Picks trades that are open now, using the same cards as the Track Record's Picks view (contract, modeled P&L, open time, days left, targets), with a short summary of how many are open, the call/put split and the average open mark. It reads the existing track record file, so it adds no new data or AI cost. Reach it at `?tab=open-picks`.

### Changed

- **Trade IDs in the picks feed and Open picks copy block read as dates.** IDs are now `TICKER-C/P-MM/DD/YY-HH:MM` (e.g. `SPOT-C-10/09/26-15:32`, ET, 24-hour) instead of `SPOT-C-261009-1532`, and the header carries a legend for the format plus how older IDs map to it, so a CLOSE can still be matched to a position copied under the old format.
- **The private picks feed and the Open picks copy block are easier to read.** Each trade is now its own labeled block (Action, Contract, Entry or Price, Latest, Opened or Closed, Order, plus Expiry and Note when they apply) with a blank line between trades and ruled section headers, instead of one long line per trade. The Open picks tab's copy block uses the same layout: each trade shows as a small labeled card, and Copy all copies exactly the text the feed link serves. Same ids, prices and dates as before. #671

- **A Top Picks trade on a stock that leaves coverage now closes instead of disappearing.** At the next Top Picks run it closes at its last mark as "name left coverage", which is not counted in the win rate or averages (same as before), but it now produces a CLOSE line so anyone mirroring the book knows to exit.

- **Top Picks grades judge revenue and EPS growth against the company's sector norm.** A retailer growing revenue 7% now scores like a software company growing 20%: each sector has an in-line band from long-run industry history (for example retail 2–7%, software 12–20%, memory 10–25%), +1 above it, +2 well above it, −1 below it and −2 well below it. A below-norm penalty is waived when growth jumped at least 10 points on the quarter before (20 for memory and early-stage names), so a company climbing from −40% to −10% is not scored as shrinking, and a single weak EPS quarter only counts when revenue is weak too or the quarter before was also weak. The Grade tab shows each name's norm and verdict. Quarterly net income now accumulates across builds for that check. The grade formula version is now `2026-10-sector-growth`, so the Track Record gets a dated divider and nothing is reset. No new AI or data calls.

### Fixed

- The Open picks intro now says the trade lines below the cards list the last 7 days of closes, instead of saying closed trades are only on the Track Record. Commodities "watch" chips no longer link names that left coverage (LULU, DE, FDX, UPS, CAT); cotton and ocean freight point at covered retailers instead.

- **Missing EPS growth no longer reads as "0%".** When Yahoo sends no EPS growth figure, the Fundamentals pillar shows it as no data instead of a 0% reading.

### Docs

- CLAUDE.md lists all nine Owner tabs (LEAPS and Open picks were missing), the 85-name `TICKERS` list and how removed names are handled, the smoke-test scripts, and the current size of `build.mjs`.

## 2026-10-19

### Added

- **The Track Record shows what each open-pick rule turned away.** Every Top Picks run logs the first rule that kept each candidate from opening (score below 7, the losing-streak bar, pillars not agreeing, timing checks, the AI saying wait, caps and so on) plus the names that opened, then follows each stock in the trade direction 5, 10 and 20 trading days later. A new table on the Scorecard compares each rule with the trades that opened. Stock moves, not option P&L; no AI calls. A name the same rule keeps blocking is logged again only after a week, and moves use completed sessions only. The log lives in `picks-accuracy.json`, and finished rows fold into running totals so the file stays small (#666).
- The morning Brief now reads live pre-market prices: index ETF moves, the biggest single-stock gaps, and every name that reported earnings after the last close or before the open, with the EPS result and the pre-market reaction. The closing Brief does the same for after-hours trading and tonight's reporters, and its calendar now lists names reporting after today's close instead of skipping them. One batched Yahoo quote call per Brief, no extra AI calls (#661).

### Changed

- **The 6 AI review slots go first to names that can still become open picks.** Before the AI grader runs, every open-pick test that doesn't need the AI (score 7+, 2 pillars agreeing, the timing checks, a buildable contract, the sector / factor / side caps) is checked. Names that pass are graded first; leftover slots go to the rest in rank order. Same number of AI calls, same roster order (#666).
- **A losing record now raises the open-pick bar from 7 to 8.** The losing-streak gate used to raise only the watch-list bar, which open picks already cleared. While it is engaged, a name needs a score of 8 or more to open; a 7 stays on the watch list, and the Top Picks note says how many were held back (#666).
- Open Top Picks trades on names that left coverage are removed from the Track Record on the next Top Picks run instead of sitting on a frozen mark and closing three runs later as a win or loss. Earlier "dropped" closes on names no longer covered stay visible as "NOT COUNTED" and no longer count toward the win rate, averages or the edge gate (#665).
- Track Record Picks cards now show the exact date and time each trade was opened and closed (in the site's display time zone) instead of the date only, and the card text is a notch larger (#664).
- **AI CapEx guidance keeps itself current.** Each bake reads the latest earnings-call brief for the ten tracked names and replaces a hand-entered full-year CapEx guide when a newer call states one. It flags a guide that predates the company's latest report so the tab never shows an old figure as current. This adds no AI calls, because the call briefs are already minted once per quarter. Guidance is also refreshed now: MSFT about $175B (after the lease reclassification), AMZN about $220B, META $130–145B, and TSMC $60–64B added. `scripts/build.mjs`, `lib/ai-capex.mjs`, `scripts/render/app-js.mjs`.

- **Strategies' "Setup timing" now uses the engine's entry-timing call (go / wait / avoid) from `grades.json`** for the side the tape points to, instead of the AI chart pattern. Wait or avoid holds the contract cap at zero. The cap also stays at zero while that read is still loading or if it fails to load. A mixed tape, or a ticker outside the graded set, shows no timing block.
- **The grade formula version moves to `2026-10-no-chart-pattern`.** The Track Record keeps every past trade and shows a dated divider labeled "Chart-pattern vote removed" between trades picked by the new formula and older ones. Closed trades keep their recorded exit reasons.

### Fixed

- **TSMC on AI CapEx is no longer stuck on 2024.** SEC's XBRL feed has no TSMC data after FY2024, so when a filer's SEC series is more than about 14 months old, the tab rolls it forward from the quarterly cash-flow rows the bake already pulls from Yahoo. The rows are converted from NT$ at each quarter's average exchange rate, and a unit check rejects anything more than 3x off the last SEC year. `scripts/build.mjs`, `lib/ai-capex.mjs`.
- **The AI CapEx headline no longer calls a mix of years "FY2026".** The total adds each company's own latest fiscal year, so it is now labeled with the range of years and says which companies are in each. The TTM run-rate shows the dates it runs through. `scripts/build.mjs`, `scripts/render/app-js.mjs`.
- A Sector Rotation trade on a name that left coverage now closes as "left coverage" at its latest price. Before, it had no daily bars, so its 20-session time limit never fired and it could stay open for months. These closes show in the ledger but stay out of the scored record.
- The hourly Heatmap refresh drops names that are no longer covered, so a removed name no longer shows between a coverage change and the next full build.

### Removed

- **The AI chart-pattern read is gone.** The daily 11:00 ET chart-image call to Gemini 3.6 Flash (one per ticker, about $0.81 per trading day at 85 names), its cache (`chart-pattern-cache.json`) and `lib/chart-image.mjs` are removed. Over 37 trading days its confirmed calls beat the cross-section only 46–52% of the time. Everything that read it is updated: the ±1 chart-pattern vote leaves the Technicals pillar, the Top Picks grader prompt no longer cites a pattern, the "chart pattern fails to follow through" exit reason is dropped for new trades, the Grade tab's chart verdict no longer blocks or waits on a pattern, the Setup card's pattern banner becomes a link to the Chart patterns reference page, the Compare table loses its pattern row, the ticker directory's timing chip no longer overrides on a pattern, and the position checker's news-plus-chart "trim" nudge is removed (news alone never triggered it). The Chart patterns reference page keeps all eight drawings and now says it is reference only.

## 2026-10-18

### Changed

- **A Sector Rotation basket needs 3 names instead of 4.** `SECTOR_ROTATION_MIN_GROUP` is now 3, so Consumer cyclicals (NKE, DIS, SBUX) and Power & data center (VST, BE, VRT) still form after the coverage cut, and Space (RKLB, ASTS, SPCX) can form too. Industrials & logistics has no names left and does not form. `scripts/build.mjs`, `docs/site-logic.md`.

### Fixed

- **A leveraged-ETF trade closes when its underlying or group leaves coverage.** The log read a missing grade as a one-build data gap and kept the entry open, so an entry on a removed name would never close. It now closes with the reason `left-universe`. A data gap on a name that is still covered keeps the entry open as before. `scripts/build.mjs`.
- **The Earnings tracker and the post-earnings recovery screen show only covered names.** The earnings history is never pruned, so recent prints by removed names stayed in the season scoreboard, and the recovery screen then tried to open data files that no longer exist. `scripts/build.mjs`.
- **A forced "dropped" close no longer moves the Top Picks edge gate.** These trades still count on the Track Record, but the gate that raises the conviction bar after losses (and the sizing that follows the same edge) now ignores them, so a batch of removals can't raise the bar. `scripts/build.mjs`.
- **Chart tooltips keep their text inside the box.** A long line in the shared chart tooltip (for example "Analyst price target … P/E vs sector" on the Heatmap's grade scatter) now wraps inside the tooltip instead of running past its edge, and the box stays on screen on phones. Scatter plots now snap the tooltip to the dot nearest the pointer instead of the nearest column. `scripts/render/app-js.mjs`, `scripts/render/styles-css.mjs`, `js/book-views.js`.
- **Hidden tooltips and readouts no longer leave empty boxes on screen.** Several readouts (Fear & Greed history, Grade fundamentals charts and segment donuts, the Grade contract result bar, Strategies, Owner Lab position check) set their own display style, which beat the browser's `hidden` rule; a global `[hidden]` rule now wins. Fifteen rules that read an undefined `--surface-1` color (tooltips, chips, strips) now get a real background. `scripts/render/styles-css.mjs`.
- **The Grade price chart is readable on phones.** Axis, RSI and spot labels rendered at about 4px on a phone; a narrower phone layout now draws them at about 10px. The spot label gets a halo so the price line no longer runs through it. `scripts/render/app-js.mjs`, `scripts/render/styles-css.mjs`.
- **Wide charts no longer blow up their text, and stretched charts keep round dots.** The RAM prices history chart draws at its card's real width, so its axis labels stay small, and its hover readout sits on the chart instead of the top of the page. Scatter dots on Earnings, Trending IV and Streaks and the GPU price end markers stay round at any width. The Heatmap grade scatter uses a phone-sized layout so its ticks and guide labels are readable. `scripts/render/app-js.mjs`, `scripts/render/styles-css.mjs`, `js/book-views.js`.
- **Phone layouts no longer push content off the side.** Pattern lab, the Owner Lab filters, the Home pulse strip, the 13F firm summaries, the Brief headline sources, the AI CapEx guidance total, the IPO and bond bars and tables, the score-bucket columns and the sector-breadth header all fit a 390px screen. Heatmap tiles no longer stretch past their sector box, and the Compare tooltip is opaque. `scripts/render/styles-css.mjs`, `scripts/render/app-js.mjs`.
- **Smaller chart fixes.** The Fear & Greed gauge no longer clips its score, the central-bank gold axis labels sit on their gridlines, the IV term-structure hover label has a halo, the header time-zone picker shows "Local" in full, and `?tab=leaps` deep links open LEAPS for the owner. `scripts/render/app-js.mjs`, `scripts/render/styles-css.mjs`, `scripts/render-smoke.mjs`.
- **Tapping a chart on a phone shows its value.** On the small line charts that also support drag-to-compare (Commodities, Stock Picks, Leveraged ETFs, Trending IV, IPOs & credit, GPU cloud prices, central-bank gold and others), a tap started a compare and then cancelled it, so nothing appeared. A tap or click without a drag now shows the point readout; dragging still compares two dates. `scripts/render/app-js.mjs`.

### Removed

- **Coverage drops 39 names: SWKS, NXPI, TSEM, ON, COHR, ALAB, GLW, LRCX, LITE, STX, APP, ZS, NET, TWLO, WDAY, CLS, UBS, APO, IBKR, COF, LOW, LULU, MCD, EBAY, LEN, GD, DE, FDX, UPS, CAT, CI, TMO, BSX, CSCO, U, RDDT, BX, DASH, and ABNB.** Coverage goes from 124 names to 85. They leave the ticker list, the industry map, the overnight peer map, the before-open earnings list, the market tape's offense and defense baskets, the APPX and RDTL leveraged pairs, the scenario exposure map, and the RAM supplier lens. Asset Management, Farm & Heavy Construction Machinery, Integrated Freight & Logistics, Medical Devices, Residential Construction, and Travel Services leave the Narratives taxonomy because they have no names left. The sector map keeps their labels so old Track Record rows still show a sector. Open Top Picks trades on these names close as "dropped" after 3 builds. `scripts/build.mjs`, `lib/scenario-engine.mjs`, `lib/link-map.mjs`, `scripts/render/app-js.mjs`, `js/book-views.js`.

## 2026-10-16

### Added

- **Briefs can mention a firing Pattern lab read and a sector breadth streak.** Both ride the existing cross-tool standout rows. A quiet Pattern lab emits nothing. A streak appears only after at least 70% of a sector has closed the same way for two or more sessions, and the line says it is participation rather than fund flow. `scripts/build.mjs`.
- **Compare companies can limit the ticker list to one sector.** The sector menu sits next to the ticker box and the suggestions stay inside that sector, so a same-sector set is easier to build. `scripts/render/app-js.mjs`, `scripts/render/html.mjs`, `scripts/render/styles-css.mjs`.
- **Pattern lab keeps six free reads separate.** Volatility clustering, index seasonality, cross-asset lead and correlation breaks, RSI and MACD divergences, the breadth-versus-index record, and Fear & Greed disagreements each show their own sample. None of them changes a grade, a pick, or a contract. SPY, QQQ, and IWM store a longer daily history and the bake downloads it with the existing Yahoo chart only when a symbol has less than 12 years saved. No Gemini call and no new data vendor. `lib/pattern-recognition.mjs`, `scripts/build.mjs`, `scripts/render/app-js.mjs`, `scripts/render/html.mjs`, `scripts/render/styles-css.mjs`.

### Changed

- **Top Picks ships at most 6 actionable names, and the final grader reviews those 6.** `PICKS_COUNT` now defaults to 6, and the AI thesis cap follows it. The watch list stays at 6. Both the 11:00 and 15:30 ET runs still refresh the book. `scripts/build.mjs`, `scripts/render/app-js.mjs`, `scripts/render/html.mjs`, `docs/top-picks.md`.

### Fixed

- **The daily bake can publish valuation history again, and one unknown file no longer blocks the rest of the tape.** Compare companies writes `fundamentals-history/<ticker>.json`. The freshness check treated that folder as bake-owned with no publication rule, so every bake since 10:00 ET failed before upload. `iv-history/` and `fundamentals-history/` now share one prefix list: a tracked name is allowed, and a valuation file must be rewritten this run with a dated snapshot. The self-test reads the bake's writers and fails if a new file or folder has no publication rule. The daily workflow runs that check before the Yahoo and Gemini build. A file that still has no rule is held out of the upload, and the rest of the bake can publish. A retired `transcripts/` path still fails the run. `lib/data-ownership.mjs`, `scripts/verify-data-freshness.mjs`, `scripts/sync-data.mjs`, `.github/workflows/daily.yml`.
- **The grade-versus-return chart labels a ticker only after it is selected.** The two names with the furthest returns, such as ASTS and MRNA, were drawn on the plot even when the ticker box was empty. Other names already waited for a hover. A search or a click still pins that name. `js/book-views.js`.
- **IV percentile and IV rank are no longer the same label.** The Grade IV panel and Strategies were calling a percentile “IV rank,” and the Grade panel counted every day at or below a nearest-expiration IV. IV percentile is now the midrank of today’s constant-maturity ~30-day ATM IV inside the name’s own daily history. IV rank is the min-to-max position of that same reading, and the Grade panel shows both. A breakeven chip that said the chain “prices” a move now says that figure is one standard deviation from the contract’s implied vol. Absolute delta is described as a rough chance of finishing in the money, not the chance of profit. `scripts/render/app-js.mjs`, `scripts/render/html.mjs`, `scripts/build.mjs`.
- **Pattern lab labels each figure with its unit and sample, and does not call a link usable.** Seasonality states that the number is a price change without dividends, and separates a full-month figure from a one-day figure. A one-day print larger than 25% is left out of the seasonal average. A name with a one-day move larger than 40% is left out of the divergence record. Cross-asset rows say the link is large in-sample rather than ready to trade. `lib/pattern-recognition.mjs`, `scripts/render/app-js.mjs`, `scripts/render/html.mjs`, `scripts/render/styles-css.mjs`.
- **Narratives no longer keeps an empty Basic Materials tab.** MP was the only covered name in that sector, so the sector and its industry leave the taxonomy with it. `scripts/build.mjs`.

### Removed

- **Coverage drops KULR, BKSY, PLAB, LUNR, RDW, FLY, PL, OKLO, and MP.** They leave the ticker list, the sector and industry maps, the overnight peer map, the OKLO leveraged-ETF pair, and the scenario exposure map. A renderer-only regen follows that list, so a previous page shell cannot put a removed name back. `scripts/build.mjs`, `scripts/regen-static.mjs`, `lib/scenario-engine.mjs`.
- **Coverage also drops HUBS, ETSY, AMKR, AAOI, and FIG.** They leave the ticker list, the sector and industry maps, and the overnight peer map. `scripts/build.mjs`, `js/book-views.js`.
- **Coverage also drops SPOT, EL, and RBLX.** They leave the ticker list and the sector and industry maps. Electronic Gaming and Household & Personal Products leave with them, because each was the only name in that industry. `scripts/build.mjs`.
- **Coverage also drops HIMS.** It leaves the ticker list and the sector and industry maps. Consumer Health Products leaves with it, because HIMS was the only name in that industry. `scripts/build.mjs`.

## 2026-10-15

### Added

- **Track Record gains a grade-edge report and four paper books, and stops annualizing short windows.** Grade edge ranks the stored grade against the stock 5, 10, and 14 trading days later: quintile ladder, sector-neutral beta-neutral residual, non-overlapping windows, a seeded within-day grade shuffle, and a one-session delayed entry. Paper books are a $100,000 stock account you can switch between: top-versus-bottom decile, the enrolled picks at equal weight, a 0.5% risk budget with drawdown and sector caps, and that same budget entered at the next close with an option IV and spread-cap stress. CAGR on the equity curve and on these books stays blank until the first entry and the last close are 365 days apart; the window return is the figure before that. The report is written from grades and daily closes already on disk. No Gemini call and no new quote. `lib/grade-research.mjs`, `scripts/build.mjs`, `scripts/regen-picks.mjs`, `scripts/render/app-js.mjs`, `scripts/render/html.mjs`, `scripts/render/styles-css.mjs`, `lib/premium-keys.mjs`.
- **Compare companies follows the chart window for the series it already has, and starts saving valuation snapshots.** Price return, realized volatility, average volume, turnover, and the high-low position recompute for 1M, 3M, 6M, and 1Y from the stored daily bars. Implied-vol change uses the stored IV history once it covers the window. Trailing P/E, forward P/E, PEG, market cap, and price-to-sales changes appear once `fundamentals-history/` has a point at the window start. Those changes read in points, and implied-vol change reads in percentage points. That file is one small public snapshot per ticker per ET day from numbers the bake already fetched, and it keeps only the rolling year: a point older than the same calendar date last year is dropped on the next bake. No extra quote call and no Gemini call. `scripts/build.mjs`, `lib/data-ownership.mjs`, `scripts/render/app-js.mjs`, `scripts/render/html.mjs`, `scripts/research-display-smoke.mjs`.
- **Compare companies measures every company reading against a named reference.** Up to four names keep the chart colors in the table. A control picks which company the gaps use, and each other cell says “vs” that ticker with the number gap and the percent gap. Valuation, growth, margins, the balance sheet, shorts, analysts, news, implied vol, and technicals are included. Option contracts stay out. Reporting-currency mismatches skip a dollar gap. `scripts/render/app-js.mjs`, `scripts/render/html.mjs`, `scripts/render/styles-css.mjs`.
- **LEAPS is an Owner desk under Top Picks.** It rescores the pillars Top Picks already computed and shows that score for a one- to two-year hold. A call buy needs 8 and a put buy needs 9. The desk does not name a strike, call Gemini, or fetch a far-dated chain. It runs on the 11:00 and 15:30 ET Top Picks builds; other bakes keep the prior list. `LEAPS_SCORE=0` turns the new score off. `lib/leaps-score.mjs`, `scripts/build.mjs`.
- **Additional views sit under the desks that already own each number.** Heatmap gains the stored closing-breadth log and a grade-total versus return plot. Calendar counts stored events by day. Narratives group stories by the stored lifecycle stage. Trending IV adds a percentile histogram and a 5-session IV change versus 1-week price plot, with both windows labeled. Gamma exposure draws stored spot and walls. Streaks plots length against cumulative move. Spillover bars the sector model, pair model, and priced move as separate series. The MA tracker histograms distance to the stored averages against the existing ±5% band. Earnings plots surprise against the report-day move using the existing ±1% in-line band. Owner Lab adds a link-map lookup, the stored evidence record, and the stored grader log. No score, tier, or model call changes. `js/book-views.js`, `scripts/render/html.mjs`, `scripts/render/styles-css.mjs`.
- **Additional views can be collapsed, searched, and read on hover.** Each added panel is a disclosure under its existing desk. Scatter plots dim every name except a ticker search and list that name’s stored figures. Wall ranges can be sorted by gamma score, nearest wall, or symbol. Breadth cells, calendar days, and histogram columns show the stored count on hover. `js/book-views.js`, `scripts/render/styles-css.mjs`.

### Changed

- **A longer return window plots the average daily grade for that same window.** The one-day view stays on today's grade. Week, month, quarter, year-to-date, and one-year views average the once-a-day total saved after that return's start. The table keeps today's grade, the current call or put, how many saved days cleared the bar, and a sparkline of the path. Clicking a dot selects that name. `grades-daily.json` is public, the same number already published in `grades.json`, and keeps 280 sessions. `js/book-views.js`, `lib/premium-keys.mjs`, `scripts/build.mjs`.
- **The grade-versus-return plot can be filtered and read as a table.** Recommendation, sector, and score narrow the dots. Sort runs by return, grade, ticker, sector, or recommendation, from the menu or the column headers. Circles are calls, squares are puts, and diamonds have no recommendation. Spread scale keeps a very large return visible without packing the rest of the book into one blob. The caption now says the grade total is the four pillars, IV cost, and the regime overlay, and that entry timing is not in that total. `js/book-views.js`, `scripts/render/styles-css.mjs`.

### Fixed

- **Track Record days-left, score signs, activity order, and the option-mark description match the stored math.** Days left use the 4:00 p.m. New York close, so an expiry-day contract is not marked expired at midnight UTC. A missing score no longer shows a plus. Grade changes and conviction crossings are ordered newest first, and a row without a direction is not counted as a downgrade. The contract tooltip says the mark uses the entry mid with entry IV held constant. The equity-curve year count ignores a missing entry date instead of measuring from 1970. The grade-edge report does not write the picks, activity, or roster files. `scripts/render/app-js.mjs`, `lib/grade-research.mjs`.
- **The grade chart says what its average, call days, and sample dates are.** A longer window still averages the saved daily grades. The latest bake replaces that day's saved grade so Today and the end of the average match. The labels name the date span actually used, and they say when that span starts after the return. Call days are +4 or higher and put days are -4 or lower. `js/book-views.js`.

## 2026-10-14

### Changed

- **LEAPS ideas start at 5, call buys at 8, and put buys at 9.** The longer hold needs a higher bar than a short-term trade, and a put needs a stronger score than a call. `lib/leaps-score.mjs`.
- **LEAPS fundamentals count fully, and the score leans toward calls.** Fundamentals is weighted 1.0. Every name starts one point higher because a stock is more likely to be up than down over one to two years. The forward path adds up to two more points: a call buy is held back when fundamentals are declining, and a put buy requires that decline. `lib/leaps-score.mjs`.
- **LEAPS recommendations follow the Top Picks decision, with the LEAPS pillar weights.** A buy needs a weighted score of at least 7 on the same scale as Top Picks, at least two pillars on that side, and a confirmed go entry. An avoid is dropped. A score of at least 4 that is still waiting, single-pillar, or missing a listed contract stays a watch. The contract is a long call or long put, 9–24 months out, with delta 0.20–0.40 or 20–50% out of the money. When `LEAPS_SCORE=1`, the bake fetches those far expirations for the decision names. The old “a 35% move doubles the premium” check is not used to choose the contract. `lib/leaps-score.mjs`, `scripts/build.mjs`.

### Fixed

- **Buyer's manual and Chart patterns: the scope line wraps on a phone.** The gold scope strip was a flex row, so "long calls & puts only" sat in its own column beside the rest of the sentence. It is now one wrapping line. `scripts/render/docs.mjs`.

## 2026-10-13

### Added

- **Link map: a private, Owner-only map of how names, themes and inputs connect.** The build writes `link-map.json` from the existing sector, industry and spillover groups, overnight peers, commodities, AI capex, RAM, GPU rent and narrative longs/shorts (365 nodes and 777 edges on Oct 13 data). Every edge carries its source and an `asOf` date. It makes no AI calls. Search-interest themes (no ticker lists yet) and central-bank gold (tracks countries, not tickers) are skipped. Requests without an Owner session get a 401 (`LINK_MAP_OWNER_ONLY`). `lib/link-map.mjs`, `scripts/build.mjs`, `lib/data-ownership.mjs`, `lib/premium-keys.mjs`.

### Fixed

- **Branch review repair:** The link-map privacy toggle check resolves shared policy imports from a temporary file module, so it works alongside the evidence and rejection branches.
### Fixed

- **Narratives: story extraction no longer collapses onto the single name in the latest history snapshot.** Previous names now come from the real stories in the last five snapshots, and the prompt reuses a name only when today's evidence still supports it. When a fresh read finds fewer than four real stories from 30 or more headlines, it retries once (a single attempt). The retry runs only if the daily AI reserve still covers the Brief's worst case in both calls and tokens, counting input tokens (the first read's recorded input plus 10%, or characters divided by 3 when none was recorded). It is also capped at 2 retries per UTC day (`COLLAPSED_STORY_RETRY_DAILY_CAP`, counted in the AI ledger when a retry starts, so failed retries count too). The post-close carry (`REFRESH_NARRATIVES=false`) extracts fresh instead of reusing a stale read or one with fewer than four real stories. AI caps are unchanged. `lib/story-detection.mjs`, `scripts/build.mjs`, `scripts/story-detection-smoke.mjs`.
- **AI rejection log and scoring: every name the final grader rejects or tells to wait is recorded and later scored.** The bake writes one record per name, side and day (first time seen, spot price, grade, entry reason, total and market regime) to `ai-rejections/YYYY-MM-DD.json` plus `ai-rejections-latest.json`, tagging waits that overrode a ready price read separately; names the grader passed are kept as the comparison baseline. Tactical names and builds without a grader are skipped, logging never fails the bake, and nothing is added to `picks.json`. `backtest-picks.mjs` scores rejects on the move in the pick's direction at 5, 10 and 21 trading days against that day's passed names, and waits on whether a better entry came within 5 days. All files are Owner-only and private; the scorecard stays on the backtest runner and is excluded from the bake push. No AI calls. `lib/ai-rejections.mjs`, `scripts/build.mjs`, `scripts/backtest-picks.mjs`, `lib/data-ownership.mjs`, `lib/premium-keys.mjs`.
### Fixed

- **Branch review repair:** Wait promotions count only within the five trading-session score window. The scorecard stays local, and normal runs download only the required record history.
- **Data sync: `sync-data seed` now skips the same keys `push` excludes.** Seed (the one-time full upload of local `data/` into the private store) skips request-time keys and the shared `LOCAL_ONLY_KEYS` list, including the backtest-only AI rejection scorecard via `isSeedableKey`, and still uploads Owner-only keys so a re-seed keeps the private history. `lib/data-ownership.mjs`, `scripts/sync-data.mjs`, plus a smoke test.
- **Branch review repair:** Bake, seed, and hydration exclude the local AI rejection scorecard. Normal pulls bound dated record downloads; historical backtests explicitly request full archives.
- **Data sync: `sync-data seed` now skips the same keys `push` excludes.** Seed (the one-time full upload of local `data/` into the private store) skips request-time keys and the shared `LOCAL_ONLY_KEYS` list, including the local AI rejection scorecard via `isSeedableKey`, and still uploads Owner-only keys so a re-seed keeps the private history. `lib/data-ownership.mjs`, `scripts/sync-data.mjs`, plus a smoke test.
- **Evidence record: a private, Owner-only daily record of the evidence behind each name.** The bake writes `evidence/YYYY-MM-DD.json` plus a small `evidence-latest.json` pointer, covering 17 evidence pieces per name (Trends, RAM, GPU rent and capex are skipped because they have no per-name daily data). Every piece carries `asOf` (when the source data was known) and `firstSeen`, neither later than the bake date, so later tests can't use future information. `firstSeen` carries over across gaps of up to 5 trading days when the direction is unchanged and resets otherwise (holidays count as missing days). Each bake loads the last 60 days for the compare-to-its-own-normal rule, using the store access the daily pull already has. No AI calls. `lib/evidence-record.mjs`, `scripts/build.mjs`, `lib/data-ownership.mjs`, `lib/premium-keys.mjs`.
### Fixed

- **Evidence records preserve missing readings and closing-volume direction, and publish only through the verified sync step.** Normal runs download only the history window the producers need; backtests retain access to full remote archives.
- **LEAPS expirations, private and off by default.** For up to 5 LEAPS shortlist names, the bake can fetch up to 4 extra expirations 9 to 24 months out, in parallel, using the existing Yahoo timeout. If a fetch fails, the bake carries on without it. The extra expirations stay in a private `_leapsChains` field that's removed before files are written, so the public per-ticker files never show the LEAPS shortlist. A name makes the shortlist when it's above its 200-day average, has an RSI between 20 and 80, and its IV is cheap: under the 60th percentile, with an IV z-score under `LEAPS_IV_Z_MAX = 1.5` when there's enough IV history to compute one. The fetch stays switched off until LEAPS scoring lands. Other names still keep 14 expirations, and short-term picks are unchanged. It makes no AI calls.

### Fixed

- **Branch review repair:** The LEAPS shortlist rejects missing trend and IV readings instead of treating them as zero.
- **LEAPS contract pricer (`lib/leaps-pricer.mjs`).** This is a pure function with no file or network access. For each expiration 9 to 24 months out, it finds the strike with a delta between 0.20 and 0.30, using a bounded 64-step bisection and a named 4% rate. It then prices the option 6 months out if the stock is flat, up 20%, up 35% or up 50%. A contract passes only if the target move at least doubles the premium. An optional `catalystDate` drops expirations that end less than 3 months after the catalyst. Expirations that are short, unreadable or fail to solve are skipped one at a time. The function returns null only for bad top-level inputs. It makes no AI calls.
### Fixed

- **Branch review repair:** All earlier bulk AI passes preserve 40 attempts for final Top Picks research and grading. The narrative reserve and daily ceilings remain in force.
### Fixed

- **Branch review repair:** LEAPS paper rolls reject an occupied underlying before closing the original position; marks and mandatory exits continue.
### Fixed


## 2026-10-10

### Changed

- **Grade formula: several signals are re-weighted so the grade leans bullish on purpose, since a bearish call should need more evidence.** All changes are deterministic and cost no AI.
  - Fundamentals:
    - EPS growth earns +2 at 30% or more, and revenue growth earns +2 at 20% or more.
    - The analyst price target needs 20% upside to earn +1 (it was 10%).
    - In-line guidance earns +1 (it was +2). With no guidance read, the full-year estimate earns +1 only at 10% growth or more (it was +2 at 10% and +1 at any growth).
    - An earnings surprise is not scored when the EPS estimate is under $0.10.
    - Net margin trend and the forward trajectory no longer add points. The trajectory is still computed and shown, and Stock Picks, Sector Rotation and the Top Picks prompt still read it.
  - Technicals:
    - A reversal-confirmed RSI extreme scores +2 when oversold and −1 when overbought (it was ±3).
    - A falling wedge reads +1 and a rising wedge −1.
  - Mechanicals:
    - Unusual flow and the open-interest call/put ratio need a ratio of 0.5 or less to read bearish (it was 0.67).
    - Short interest earns +1 only when at least 15% of the float is short, shorts are covering, and the 5-session return is positive. Rising short interest still scores −1.
  - Files: `scripts/build.mjs`, `scripts/render/app-js.mjs`, `scripts/render/html.mjs`. (#650)
- **A won or lost major contract now expires after 30 days.** It only scores while a contract or deal headline from the last 30 days is still in the name's news (`freshMajorContractStatus`). Before, the undated AI flag could be reused and keep scoring for months. Stock Picks and Sector Rotation use the same check. (#650)
- **Narratives: the autogenerated "Watchlist" filler names are left out of the AI prompt's "previous narratives" list.** Feeding about 37 filler names back as "reuse verbatim" had collapsed extraction to one real story since late September. Filler cards are now labeled neutral instead of bullish, so they no longer appear as 13F "most bought" themes or as "LONG · Bullish" chips on the Grade tab. (#650)
- **AI budget: the daily caps hold back headroom (300k tokens, 30 calls) for the market-narrative and Brief calls.** Bulk per-ticker calls stop at the cap minus the reserve, so the afternoon narrative read and the Brief still run on heavy days. The overall ceilings are unchanged. The reserve is set by `AI_RESERVED_TOKENS` / `AI_RESERVED_CALLS`, and 0 disables it. (#650)

- **Top Picks: a non-destructive grade-model version (`GRADE_MODEL_VERSION = "2026-10-pillar-review"`) is stamped on `picks.json` `rosterMeta`, `grades.json`, and each new track-record enrollment.** The scorecard can now split results before and after the grade change without wiping the record. `PICKS_ACCURACY_RESET_EPOCH` is unchanged. Split point: trades enrolled from the first Top Picks run (11:00 or 15:30 ET) after this PR deploys carry the new version, and older trades have none. (#650)

- **Track Record: a dated bar now separates trades picked by the updated grade formula from earlier trades** in both the Open and Resolved lists ("Updated grade formula from YYYY-MM-DD"; newer trades above, older below). It uses the `gradeModelVersion` stamp, so the record is kept rather than reset, and any future formula change adds its own bar. `scripts/render/app-js.mjs`, `scripts/render/styles-css.mjs`. (#650)

### Perf

- **The post-close 16:10 ET bake carries the 15:30 narrative read forward instead of making a new AI call** (`REFRESH_NARRATIVES=false`, set by `daily.yml`). Nothing trades on that build. (#650)

## 2026-10-08

### Perf

- **Gemini cost: fetched article bodies sent to the per-ticker news/fundamentals read are now capped at 1,500 characters (was 3,000).** This matches the existing 1,500-character cap on RSS descriptions, so every article excerpt the model sees is the same length. The lead paragraphs carry most of the substance, and all headlines are still sent. `AI_ARTICLE_BODY_CHARS` is now wired into `daily.yml` as an Actions variable, so the cap can be raised again (e.g. back to 3000) without a code change. `scripts/build.mjs`, `.github/workflows/daily.yml`.

## Older changelogs

- [2026-09](docs/changelog/2026-09.md)
- [2026-08](docs/changelog/2026-08.md)
- [2026-07](docs/changelog/2026-07.md)
- [2026-06](docs/changelog/2026-06.md) — 458 entries
