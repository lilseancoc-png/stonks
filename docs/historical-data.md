# Historical Data

Historical Data is an Owner research workspace at `?tab=historical-data`.
It covers US equity seasonality, bonds, commodities, and macro/volatility
conditions. It does not change grades, picks, sizing, or execution.

## Coverage contract

The catalog in `lib/historical-sources.mjs` names every enabled dataset,
provider, original publisher, unit, cadence, source URL, and known limitation.
The current scope contains two index-level histories (the S&P 500 `^GSPC`
since January 1950 and the Nasdaq Composite `^IXIC` since 1971), 17
exchange-traded market proxies and 20 FRED context series. This is an explicit coverage list, not a claim to contain every
vendor, every individual stock, or every possible market saying.

A dataset must have at least ten calendar years in its usable continuous tail.
The minimum observation counts are 2,300 daily, 470 weekly, 110 monthly, or 36
quarterly. Large gaps end the usable earlier history: more than 10 days for
daily data, 24 for weekly, 70 for monthly, or 140 for quarterly. Earlier rows
remain in the raw cache, and the coverage ledger reports the excluded count,
raw first date, and gap count. No missing interval is interpolated or filled
with zero. A long span between two isolated observations cannot pass.

Only qualifying market histories produce seasonal studies. Short, missing, or
failed histories stay visible in Sources & coverage. Macro charts and their
comparative statistics are withheld when coverage fails. Reported zeros,
negative yield spreads, and negative commodity prices remain valid context
values. Freshness is separate from history depth and uses cadence-specific
limits. Original observation dates survive failed refreshes.

## Data checks

`lib/historical-quality.mjs` (`buildQualityChecks`) runs on every build and
ships as `quality` in `historical-data.json`; the Sources view shows it as a
"Data checks" table, failures first. It adds no download. Checks:

- Per market: missing NYSE sessions since 1990 (or the fund's launch),
  closes dated on a weekend or holiday that the cleaner dropped
  (`offCalendarRows`, recorded by the collector from the raw download), and
  one-day moves over 25% (GME, UNG and USO exempt).
- Date labels: SPY against the S&P 500 index and QQQ against the Nasdaq
  Composite. Same-day daily returns must correlate at least 0.95 (0.9 for
  QQQ) and better than the same series shifted one day either way; a
  one-day label slip fails.
- FRED: daily series with weekend dates, monthly or quarterly series not
  dated on the 1st, and staleness against each series' publishing lag.
- Dated lists: FOMC decision days (trading days, sorted, no duplicates, eight
  scheduled meetings a year except 2020, when the March meeting was replaced
  by emergency calls), WWDC keynotes (Mondays), every event-catalog date and
  peak, and the CPI and jobs release dates (no weekends; months without a
  listed date are reported, such as the fall 2025 shutdown gap).

`node scripts/audit-historical-quality.mjs --dir=<folder>` runs the same
checks over raw Yahoo chart JSON and FRED CSV downloads, plus the Fed's FOMC
pages and the Brief playbook figures, without the private store.

## Data flow

The full bake reads `data/historical-source-history.json` before its data wipe.
The collector downloads the listed market histories directly and refreshes
the FRED series when due. Historical Data no longer treats the separate
SPY/QQQ/IWM core cache as confirmation that a price is final. The version-two
source cache records the actual collection time and confirmed-through date,
and discards prices beyond that download's 16:15 ET cutoff before persistence.
A later snapshot cannot promote an old provisional tail. A failed request keeps
the earlier successful download time and confirmed closes. Legacy core reuse
requires a new source download; it cannot establish confirmation retroactively.
The source cache and `data/historical-data.json` retain the current bake stamp
for publication. `analyzedAtIso` records the later analysis time, so a long bake
can include closes confirmed after the bake started. Both files are bake-owned.

This is the site's one long-history cache (site audit C5, 2026-10-26). The
bake refreshes it before Pattern lab and the Bottom tracker run, and both read
it: Pattern lab takes S&P 500 index, SPY, QQQ and IWM closes from it (the old
`index-long-history.json` file is retired), and the Bottom tracker takes SPY,
QQQ and all ten of its FRED series from it instead of downloading them on
every bake. The two ICE credit spreads the Bottom tracker needs
(`BAMLH0A0HYM2`, `BAMLC0A0CM`) ride the same once-a-day refresh as
`SHARED_FRED_EXTRA`; FRED publishes only about three years of them, so they
are kept whenever a download has rows and never appear in the coverage list.
With `FRED_API_KEY` set, FRED downloads use the official API first.

Pattern lab's index seasonality (months, weekdays, turn of month, expiration
week, Santa, midterm years) is computed by `buildIndexSeasonality` in
`lib/historical-data.mjs`, on the same window rules as these studies, so the
two pages show the same numbers for the same index.

The collector runs within the existing full build. It adds no schedule, model
call, account, paid API, or subscription. Context sources get one automatic
attempt per UTC day. Markets can also refresh after a newly completed trading
session, so a morning check cannot suppress the confirmed evening close. Failed
attempts at the same session wait until the next UTC day. The upper bound is
58 logical downloads per UTC day: 20 context sources plus up to two checks for
each of 19 markets. Two concurrent downloads, a 15-second per-request abort
signal, and a 60-second total refresh budget remain in force. Deferred sources
resume in a later bake. A warm build in the same UTC day at the same confirmation cutoff makes zero
additional downloads. Yahoo consent handling can involve additional HTTP
requests. `--force` is an explicit local diagnostic override.

Free access does not imply blanket redistribution rights. Attribution and the
original publisher's terms still apply. FRED is the distributor; the ledger
identifies BLS, BEA, Census, Treasury, the Federal Reserve, EIA, NBER, and Cboe
as appropriate. CPI/GDP/employment histories are latest revised observations,
not the values originally known at each historical date. The macro view does
not condition the return analogs or claim a point-in-time trading backtest.

`lib/historical-data.mjs` owns windows, returns, coverage exclusions, path
statistics, and analog ranking. The browser factory owns display, CSV export,
and view preferences. The wire payload stores annual observations once and
reconstructs the 10/20-year subsets without changing their sample membership.
The publisher rejects responses above 4,150,000 bytes. A local live-data sample
produced a roughly 7.3 MB source cache and 2.9 MB browser snapshot. These are
snapshot sizes, not a production invoice or a performance guarantee.

The browser fetches only when an Owner opens or explicitly refreshes the
workspace. `serveDataKey` requires both signed claims, `tr` and `tp`, and sends
`private, no-store`. There is no static-file fallback. The legacy commit-data
workflow excludes both new objects, and `.vercelignore` excludes local data.
The feature requires the deployed private-store route.

The chosen design computes studies in the bake. Client-side calculation from
public history would duplicate cohort rules and bypass the Owner data boundary.
A separate scheduled collector would duplicate the existing build trigger.

## Study definitions and interpretation

The library contains 17 named studies: Santa Rally, January, September, all
four quarters, December, Thanksgiving week, May–October, November–April, and
six presidential/midterm-cycle windows. Separate overviews cover all 12 months,
all five weekdays, turn of month, and the monthly expiration calendar week.

- Returns are `(last close / prior-window close - 1) * 100`, in percentage
  points. The first session's move is included. Cash-distribution reinvestment, separately modeled transaction costs, taxes,
  and inflation are not included. Ongoing fund expenses already affect observed
  prices. Yahoo's own historical close adjustments are inherited.
- Bond fund prices are not yields or total bond returns. Commodity funds are
  distinct from physical spot prices and may contain futures-roll effects.
  Equity market sayings are calendar comparisons when applied to other assets.
- Today's price bar is excluded until 16:15 New York time, including on half
  days. That rule applies at the source collection time as well as analysis.
  Weekends, known exchange holidays, future bars, invalid dates, and invalid
  prices are rejected. Confirmed source histories take precedence over core
  histories, including when the latter are empty or short.
- The comparison occurrence is held out even after it completes. Older
  unfinished windows or windows without boundary coverage are omitted.
- Santa uses the last five December sessions and first two January sessions.
  Every expected close is required, including the known January 2, 2007
  closure. November–April crosses the year boundary.
- Calendar windows finish at their expected final trading session, including
  periods ending on weekends or holidays. The expected first session, prior
  baseline close, and final close must exist. A missing final price makes the
  completed period unavailable. The research-only calendar includes ordinary
  NYSE holidays and exceptional closures since 1990. Before 1990 (the two
  index histories only) the provider's own list of sessions is the calendar,
  so the 1968 Wednesday closures and other old exchange closings are not
  counted as missing. It does not alter the separately verified order/expiry
  calendar.
- Midterms are years with `year % 4 === 2`. Election day is the Tuesday after
  the first Monday in November. The post-midterm window is 252 observed
  sessions after the election-day close, not exactly twelve calendar months.
  The NYSE closed for Election Day through 1968, so in those years the window
  starts from the last close before the vote.
- The path band is the pointwise 25th–75th percentile of prior outcomes. It is
  not a forecast band or a confidence interval. Calendar windows align by
  calendar progress; fixed-session windows align by sessions.
- Rough normal mean intervals appear only with ten observations. They are not
  adjusted for multiple comparisons or dependence between overlapping studies.
  Ten years of market prices does not supply ten midterm-election observations;
  that is why the seasonal and election-cycle studies default to the S&P 500
  index (18 midterm years, 1954–2022; Yahoo has no 1949 close, so 1950 can't be
  measured) instead of SPY (8, 1994–2022).
- Typical-window returns use non-overlapping blocks of the sample's median
  session length before the comparison starts. They are a descriptive drift
  reference that can include seasonal windows, not an independent control.
- Similar dates use the same month/day in earlier years. Ranking uses only
  differences in 63-session return and 20-session annualized log-return
  volatility, each scaled by ten percentage points. Forward outcomes do not
  influence ranking and must already be complete.
- Weekday and recurring-window counts are sessions or months, not independent
  years. Expiration week is a third-Friday calendar proxy. It does not supply
  historical option-chain or open-interest observations.

The selected-study lookback changes its statistics, chart, table, and export.
Monthly and recurring overviews and similar-date comparisons use full usable
history and say so. Super Bowl and lunar indicators remain untested lore.
Macro medians average the two middle observations for even samples. Bar-chart
axis labels use the actual plotted domain, including ranges below one percent
and all-zero samples. Freshness is recomputed against the viewer's current
New York date when loading, switching views, or returning focus to the tab.
While visible, the view also updates at the next 16:15 ET boundary and when its
snapshot becomes old, using a local timer without fetching data. An old
snapshot gets a separate age warning. Refresh checks for a newer
published snapshot; freshness updates do not poll private data or providers.

Definitions and limitations draw on [NYSE holiday rules](https://www.nyse.com/trade/hours-calendars),
[Fidelity's midterm discussion](https://www.fidelity.com/learning-center/trading-investing/the-surprising-truth-about-midterms-and-stocks),
[ALFRED vintage documentation](https://fred.stlouisfed.org/docs/api/fred/alfred.html),
[the weekly H.10 publication cadence](https://www.federalreserve.gov/releases/h10/),
and [SEC performance guidance](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-47).
No published return statistics are copied into the feature.

## Events & analogs

The **Events & analogs** view (`lib/historical-events.mjs`, built in the same
bake step, no AI) covers the market-event list the owner asked for on
2026-10-27. It has three kinds of study:

- **Dated episodes** — a fixed catalog of dates written before measuring:
  war and geopolitical shocks, pandemics and outbreaks, oil supply
  disruptions, tariffs, mania peaks, short squeezes (GME) and bank runs. Each
  episode is measured on the S&P 500 index (`^GSPC`, since 1950) unless it
  names another market (Nasdaq `^IXIC` since 1971 for the dot-com and 2021
  peaks; GME for squeezes): day 1, 1 week, 1 month, 3 months and 1 year from
  the close before the first session, worst close within 60 sessions, and
  sessions until the pre-event close is regained. Oil episodes add the WTI
  spot move over 20 sessions; bank episodes add regional banks (KRE). Mania
  episodes are measured from each boom's closing high; the data checks that
  each date really was the highest close of the prior three years and next 60
  sessions (`peakConfirmed`, flagged in the table when it is not), and a peak
  date that is not a trading session is shown as unavailable, not shifted.
  When a category mixes markets (manias: S&P 500 and Nasdaq peaks) the
  summary says so.
- **Rule studies over every qualifying day** — S&P 500 closes down 5% or
  more (`CRASH_DROP_PCT`, the same threshold the "resembles now" check uses)
  since the first bar in the data (with 1987 Black Monday called out; a drop
  more than 20 sessions after the previous one starts a new cluster, and the
  summary uses the first drop of each cluster); Nasdaq closes down 4% or more since
  1971 (next-day bounce, "slight bounce then a lower close within five
  sessions", 1- and 3-month follow-through); triple witching against the other
  monthly expirations and ordinary Fridays since 1984; AAPL into and out of
  every WWDC keynote since 2003, alone and against the Nasdaq; and S&P 500
  moves on FOMC, CPI and jobs-report days against sessions with none of the
  three releases (CPI and jobs keep one FRED-listed date per month, the
  latest; dropped dates and dates on market holidays are counted in the row).
- **Resembles now** — deterministic checks on the latest completed close:
  Nasdaq −4% or S&P 500 −5% in the last five sessions; a 1987-style setup (S&P
  500 up 20%+ over 250 sessions with the 10-year yield up 1 point over 126
  readings; the card shows the same two measures on 1987-10-16, computed from
  the data rather than quoted);
  VIX 30+ or +25% in a day; WTI +10% in 5 sessions or +25% in 20; gold +2%
  with crude or VIX jumping; KRE −12% in 10 sessions; Nasdaq up 40%+ on the
  year and 20%+ above its 200-day average; squeeze-style single-name moves
  (+15% on 4x volume); triple witching week; the WWDC window (14 days before to 7 after the keynote,
  `WWDC_WINDOW_DAYS`, shared with the Brief cue); FOMC/CPI/jobs in
  the next three days; and open Santa / Sell in May / September windows (those
  link back to the seasonal studies). War, tariff, pandemic and bank-run
  headlines from the last 48 hours count only with a risk-off reaction on the
  same session (S&P 500 −1% or VIX +10%); relief headlines (pause, deal,
  ceasefire) are ignored. Each match shows its trigger and the matching
  study's headline numbers.

New free inputs ride the existing once-a-day refresh: AAPL, KRE and GME closes
from Yahoo (`HISTORICAL_EVENT_MARKETS`; the two index histories are part of
the market list above, and pre-1990 sessions use the provider's session list,
`cleanLongBars`), and CPI / jobs-report
release dates from the FRED API using the existing `FRED_API_KEY`, checked
once a week (`HISTORICAL_RELEASES`). Without the key the release study shows
FOMC days only. Scheduled FOMC decision days since 1994 are listed in code. These inputs
appear in Sources & coverage under their own headings and are not part of the
19 + 20 ten-year ledger count. The bake passes the headline hits and squeeze
moves in as `inputs`; they are stored in the snapshot (`events.inputs`) so
`npm run audit:historical` rebuilds it byte for byte.

The Brief's Historical playbook gained pandemic, tariff and bank-run cues on
the same headline-plus-reaction rule, and its WWDC cue now follows the actual
keynote date. No Owner numbers flow into the public Brief.

Hard-coded dates: every scheduled FOMC decision day 1994–2027 was checked
against federalreserve.gov (1994–2020 on 2026-10-28 from the Fed's historical
pages, conference calls and unscheduled moves excluded; 2021–2027 on
2026-10-27) (that check found four wrong 2027 dates in
the build's `FOMC_MEETINGS_BASELINE`, now fixed), and the 2026 WWDC keynote
against Apple's announcement. Earlier WWDC keynotes and the episode dates are
well-documented public dates written into the code; mania peaks are also
checked against the data, and the 1987 setup numbers are computed from it.

Limits: event lists are short case-study sets of well-known events, not
statistical samples, and mania peaks are chosen as tops by construction;
indexes exclude dividends; daily lows, volume, consensus forecasts and
surprises are not in the data, so "tested the low" means a lower close and
release-day studies cannot condition on the surprise.

Run `node scripts/historical-events-smoke.mjs` (also part of
`npm run test:historical-data`).

## Costs and approval boundary

Enabled adapters use publicly accessible downloads with $0 new provider
subscription fees. Existing Actions runtime, R2 storage/operations, and Vercel
traffic remain metered under the owner's current plans. The feature adds two
objects per full bake, not another generation or scheduled job. Existing store
garbage collection has a 26-hour grace period; no retention setting was changed.
Actual account-wide charges were not measured.

Sources & coverage lists optional paid data and keeps every option disabled:

- [Massive Developer](https://massive.com/pricing): $79/month for ten-year US
  stock API history and corporate actions. Individual/non-professional pricing
  does not establish rights for a two-owner website or redistribution.
- [Massive Advanced](https://massive.com/pricing): $199/month for 20+ years of
  stock history and additional trades/quotes. Business/display use needs
  licensing confirmation and potentially a separate quote.
- [Norgate Platinum](https://norgatedata.com/stockmarketpackages.php): $630/year
  or $346.50 per six months for delisted stocks and historical index constituents
  back to 1990. Desktop updater and server/display licensing need review.
- [Cboe DataShop](https://datashop.cboe.com/): specialist historical options,
  intraday, and other datasets require a product-specific quote. Nothing is
  connected. Original analyst-consensus surprises are a separate data need.

Prices were checked October 24, 2026 and exclude taxes or additional licenses.
No paid implementation or subscription is authorized by the source catalog.
It contains no paid adapter, credentials, purchase action, or automatic upgrade.

## Verification and local preview

Run `npm run test:historical-data` for window math, ten-year density/gap rules,
source parsing, negative/zero values, cache cadence, concurrency, refresh budgets,
failed-fetch provenance, packed payload membership, and signed-session checks.
Regressions cover provisional tails, post-close retries, failed confirmations,
legacy-cache migration, short-core fallback, even medians, and holiday/weekend
completion with missing-terminal-price rejection. The modern research calendar
is compared with all dates in the verified 2026–2028 execution calendar.
Run `npm run test:render`, `npm run test:private-store`, and
`node scripts/verify-data-freshness.mjs --self-test` for integration checks.

`npm run collect:historical` collects the free catalog into ignored local data.
`npm run audit:historical` verifies every actual collected dataset, reconciles
each stored study return against its underlying closes, and checks the serialized
snapshot against a fresh calculation from those same source files.
`node scripts/refresh-historical-data.mjs` rebuilds the snapshot offline.
`node scripts/regen-historical-data.mjs` updates the new pane/navigation and
shared browser assets while preserving other desks and data/rate provenance.

`npm run test:historical-browser` uses Playwright and an installed Chromium.
`PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` can select existing installs. Set
`HISTORICAL_HISTORY_FILE` to an existing core close cache to combine it with
local collected sources; otherwise the browser checks use labeled synthetic
closes. Checks cover both themes, desktop/mobile, source and macro views,
resize, saved selections, CSV, retry/error cases, and denied access.
They also inspect the actual narrow-range bar positions and advance the browser
clock to verify stale warnings on load and focus without extra data requests.

`npm run preview:historical` starts a localhost-only preview on port 4187 with
a simulated Owner session. It cannot authenticate a real user, alter production,
or trade. Browser fixtures never become production data.

The publication self-test also exposed an existing unclassified Bottom Tracker
writer. Its key is registered as optional, matching the writer's existing
non-fatal behavior. Its calculations, access policy, and schedule are unchanged.
