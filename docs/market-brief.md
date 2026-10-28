# Market brief public coverage

The morning, intraday and closing briefs use public research inputs. Owner
rosters, positions, forecasts, liquidation research, trade records and internal
evidence stores cannot feed the public scan. The payload allowlist in
`scripts/build.mjs` rejects any source classified as private by
`lib/premium-keys.mjs`.

## What each update reads

The core fact sheet covers ticker prices and technicals, index moves, news,
economic releases, the calendar, options activity, volatility, sentiment and
rates. The additional scan covers 21 public payloads plus Market themes.
Reference pages and tools that operate on a visitor's selections do not produce
separate market-wide observations.

Recent public features contribute the following evidence:

- Streaks separate active runs from recently ended runs. They include the
  reversal, volume ratio and completed-close moving-average context.
- Pattern lab uses the S&P 500 long-history seasonality series when available
  and includes divergence outcomes with the ten-session horizon,
  direction-matched baseline and observation count. Limited samples omit the
  numerical outcome. Observations overlap and remain exploratory.
- Overnight markets retain today's saved pre-open call and its timestamp,
  distinguish opening gaps from open-to-close performance, and preserve the
  no-edge session limit. Morning movers use the Overnight page's freshness rules.
- SEC ownership separates delayed quarterly 13F holdings from recent Form 4
  open-market purchases. Insider refreshes older than 48 hours cannot supply
  current purchase highlights.
- Capital markets can show both financing announcements and buyback
  authorizations. Headline amounts are separate from filed cash flows;
  authorization does not establish completed repurchases.
- AI spending separates reported fiscal-year CapEx from recent management
  guidance changes. Fiscal periods and company definitions can differ.
- Memory prices distinguish wholesale DRAM from retail kits. A stale subsection
  cannot contribute a highlight when its sibling refreshed successfully.
- Commodities retain the observation date and proxy context. Related stocks
  are exposure links, without an assertion about their price reaction.
- Earnings calls include the call date, management stance and analyst tone.
- Volatility includes both rising trend flags and Rich premium. Rich means
  top-fifth historical percentile and IV above realized volatility when that
  comparison is available. Missing realized volatility uses percentile alone
  and is labeled explicitly. The Rich label is visible on mobile and does not
  establish a rising trend or stock direction.

## Selection and freshness

Each source keeps its existing freshness window. Invalid timestamps and clocks
more than five minutes ahead are unavailable. Legacy accumulated payloads that
have no timestamp retain their previous handling. Missing Market themes count
as unavailable rather than a successful empty check.

The fact sheet takes one material finding per source before repeat findings,
with a maximum of 32 facts and 320 characters per fact. The visible panel keeps
ten standouts. Quiet tools add no filler. Public page links follow the current
site map, including Index calendar and the combined Capital markets page.
These changes reuse existing data and the scheduled Brief model call.

## Verification

Run `npm run test:brief` for all public-page coverage, production payload
adapters, private-source sentinels, freshness limits, sample limits and the three
brief fact sheets. A new public evidence page fails this check until its Brief
coverage is added or it receives a reference-page exemption.

Run `npm run test:brief-browser` with Playwright available to verify the morning,
intraday and closing cards on desktop and mobile, the Rich-premium explanation,
and navigation to public research pages. Fixtures are synthetic and make no
model calls. They do not establish the quality of a newly generated live brief.
