# Earnings Forecast

Owner-only, deterministic quarterly research. No inference calls, paid feeds,
broker writes or changes to the existing ranking engines.

The October 27 research upgrade adds **Company record**, **Full year & value**,
and **Industry evidence** views inside this same Owner workspace. The company
record retains a rolling three-year window for the current twenty-company cohort.
The full-year workbench models the next four fiscal quarters with editable
business sensitivities, dilution, valuation multiples and reverse valuation.
Industry readings link existing memory, GPU and CapEx observations to company
mechanisms and confirmation questions. See [implementation and storage
limits](data-stack-implementation.md) for the exact scope and verification.

These additions reuse the private forecast payload and state, add no provider
or AI calls, and do not update the quarterly model's frozen predictions or
learning scorecards. The production storage account's remaining quota was not
available to this review; the additional vendor-history state is bounded to
500,000 bytes and visibly pauses new history updates rather than truncating
accepted records if that limit is reached.

## Design

An existing bake owns one current UI payload, one compact state file, and
content-addressed source/observation/run objects under `earnings-forecast/`.
The state file is read before the bake wipes `data/`; historical archive keys
are retained remotely and are not downloaded during ordinary hydration.
All keys in the namespace require both signed Owner claims.

Company facts, period normalization and forecast calculations are independent
of transport and UI. The UI reads only the compact current payload, lazily.
The company list is the 20 largest names by market cap in the site's non-ETF
universe, re-ranked once each calendar quarter. Ranking coverage and missing
market caps remain visible.

The chosen design reuses the existing scheduled bake and private publication
boundary. A separate service would add scheduling, credentials and cost;
per-company engines would duplicate accounting and evaluation rules.

## Financial model and company coverage

The list holds the top 20 (`COHORT_SIZE`) and is re-ranked on the first bake
of each calendar quarter (`cohortDue`). A new ranking is accepted when it is
complete, when the list size changed, or once the quarter is more than ten days
old, so one missing market cap cannot hold last quarter's list in place
(`acceptCohort`). Names that join start forecasting on that bake and show a
"New" tag until the next re-rank. Names that leave move below a "Left the list"
divider with their last frozen forecast and record; they get no new forecasts,
but their SEC facts keep refreshing for about four months past that forecast's
target quarter so it can still be scored. A name that returns is current again.
Every change is logged in `cohortHistory` in the state file. Both the
existing sector classification and the provider's `quoteType` exclude ETFs.
This matters for DRAM, which is classified as a semiconductor theme on the
site but is a fund. Adding its quote type reuses the existing fundamentals
request and changes no scoring or trading logic.

Revenue uses the same fiscal quarter last year with the median of up to four
recent year-over-year growth rates. Without a comparable seasonal quarter,
the latest reported revenue is an explicitly labeled run-rate fallback.
The operating/earnings bridge uses recent reported margins, nonoperating
items, tax rates, common-income reconciliation adjustments, and a restrained
projection of reported quarterly diluted shares. Common-income adjustments
remain labeled estimated and causally unresolved. Capital-structure changes,
unreconciled EPS, missing tax/shares and losses with unsupported anti-dilution
handling withhold EPS. Annual/YTD subtraction is restricted to additive
financial amounts; it never subtracts EPS or weighted-average shares.
Quarterly bridge metrics must share the revenue period, accounting basis, and
currency. Growth and margin history also stay within the latest reporting basis.
A basis change therefore starts with the shorter supported history.

SEC company facts supply standardized entity-wide US GAAP financials. TSM's
quarterly TIFRS results come from its SEC 6-K earnings-release exhibits because
the entity-wide API does not contain its current quarterly financial panel.
TSM revenue is TWD; EPS, when available, is TWD per local share. No implicit
conversion to USD per ADR is performed. Missing tax/share inputs currently
leave its modeled EPS unavailable. SPCX's short, changing reporting history
uses the run-rate revenue fallback, with unsupported EPS withheld.

Source publication precision is a filing date, not an asserted first press
release time. A conservative next-day eligibility boundary is used alongside
actual first ingestion. Already-reported periods detected in the existing
fundamentals are not issued as new pre-event forecasts while financial
normalization catches up. Supported actuals resolve on filing collection,
which can lag an earnings release. Forecasts are financial research and do
not imply a surprise versus Street consensus or a stock-price prediction.

Company profiles describe business-specific driver hypotheses. A company with
no written profile (usually a new entrant) gets research prompts built from its
largest reported business lines and regions, each with its share and growth;
`npm run audit:earnings-forecast` lists those names so a written profile can
be added in `lib/earnings-forecast-profiles.mjs`. Disclosed
product/segment and geographic views remain separate. They never invent a
product-by-country matrix. Available existing macro readings are contextual,
not unsupported causal coefficients. Scenario changes are temporary
sensitivities and never edit original forecasts.

## Scenario assumptions

The Assumptions view keeps a working scenario for each company in browser
memory. Consolidated, product, regional, and custom revenue mixes are separate
choices. Product and regional effects never compound across axes. Disclosed
mixes become available only after their totals match same-period consolidated
revenue within 1%, in the forecast currency. Annual mixes match annual revenue,
not the fourth quarter. The source period stays visible.

Each line allocates the frozen forecast using an assumed starting share, then
applies demand and price changes multiplicatively. Regional scenarios use
local-sales and currency-translation changes. The overall revenue change
applies once after those changes. Starting shares must total 100%. Normalization
is an explicit action. Custom lines are labeled hypothetical.

Line operating margins inherit the consolidated assumption when blank. They
are never presented as reported segment margins. The weighted operating
income must not exceed the assumed consolidated gross profit when available.
Tax, nonoperating items, common-income adjustments, and diluted shares are
editable. Currency amounts and shares use millions. Blank values stay unknown.
Unsupported base earnings bridges remain unsupported after manual overrides;
loss scenarios do not invent tax benefits or diluted EPS.

The summary updates during typing without replacing the focused input.
Displayed assumptions round to four decimals, while calculations retain the
full value until edited. Scenario JSON exports retain those values. Imports
recalculate outputs and require the same issuer, frozen run, and mix snapshot.
A changed forecast or disclosure resets the draft with a visible message.
An authorization or snapshot failure clears all private drafts. Reloading or
closing the page also clears drafts; browser storage contains only the selected
company and view. No scenario writes to the learning ledger or calls a provider.

## Persistence and learning

- `earnings-forecast.json`: small current browser payload, generated by the bake.
- `earnings-forecast-state.json`: compact replay/index/observations state,
  read before and rewritten after the bake replaces `data/`.
- `earnings-forecast/sources/<sha256>.json`: original source bytes wrapped in
  JSON with URL, source hash and first ingestion.
- `earnings-forecast/observations/<sha256>.json`: immutable accepted batches.
- `earnings-forecast/runs/<sha256>.json`: original forecast, assumptions,
  configuration and source/training manifests.

Archives are non-dynamic bake keys and retained in the published manifest.
Normal hydration skips them; explicit archive hydration can retrieve them.
Namespace-wide classification protects even future/malformed archive names
with both signed Owner claims. The browser loads the current payload only
when the page opens, uses `private, no-store`, and saves only view preferences.
It provides a research JSON export, source links and separate forward versus
reconstructed filing-date scorecards.

Signed error is actual minus forecast. The first comparable accepted actual
is scored without rewriting the frozen prediction. Multiple forecast horizons
do not multiply realized-quarter counts. MAE comparisons use matched cases;
revenue WAPE and per-share EPS errors stay separate.

The candidate revenue correction uses up to eight previously resolved unique
quarters, shrinks the mean relative bias by n/(n+8), and caps its adjustment
at +/-10%. Its frozen candidate predictions are scored prospectively. It can
become active only after eight unique forward comparisons show at least 10%
lower MAE than both the base and naive models. When the issuer has a supported
EPS bridge or EPS checks already exist, at least four EPS comparisons from
the matching revenue quarters must exist, and their MAE must not worsen. Training
and promotion evidence IDs travel with the run. This is a conservative
engineering policy, not an empirically established optimal threshold or a
claim that improvement will persist. Failed gates retain the base model.

A second shadow model forecasts revenue from the reported business lines: the
same quarter last year times each line's year-over-year growth weighted by its
latest share, so a fast-growing line counts for more than it did a year ago.
Lines with no year-ago figure are added at their latest-quarter level (they
may already be partly in the year-ago base, so this can overstate; the forward
gate decides whether that matters).
It needs a quarterly breakdown with at least two lines that compares with the
same quarter a year earlier, was public before the cutoff, and adds up to
reported revenue within 1%. It is scored on every resolved quarter and uses the
same promotion gate as the bias candidate (and only when that candidate is not
active). Segment inputs join a run's input key only when they exist, so
forecasts without them keep their original key.

Revenue lines with no figure in the comparison period are tagged "New since
last filing" in the Business view and listed on the forecast as a warning.
The segment parser keeps up to three new lines out of "Other" even under 2% of
revenue. When no line carries over, the company re-labelled its breakdown and
nothing is tagged new. When no standard XBRL product or region axis is found,
the parser tries the company's own axes whose names say what they split
(segment, product, platform, revenue stream; region, geography, country, area),
and keeps only periods whose lines add up to reported revenue within 2%.
Parser changes apply as each company files its next 10-Q or 10-K; cached
filings are not re-parsed.

Retrospective checks use documented filing dates with conservative cutoffs
at filing-minus-30/14/7/1 days. They explicitly do not reconstruct original
ingestion or an earnings schedule known at the time. They never enter the
live learning/promotion sample. The History test below is a separate replay
with its own promotion rule.

## History test (2026-11-16)

The **History test** view replays every stored quarter of every listed company
and scores eight revenue rules on it. No AI call, no paid source and no new
download: it reads the filed numbers the forecast already stores, plus two
free FRED series from the shared long-history cache (factory output `INDPRO`,
the broad dollar `DTWEXBGS`). Code: `lib/earnings-forecast-lab.mjs` (pure),
called from `scripts/refresh-earnings-forecast.mjs`.

**How a quarter is replayed.** For each reported quarter, the forecast is made
from what was public 7 days before that result was filed (filing dates with a
next-day cutoff, the "reconstructed" reading of `quarterlyFacts`). A miss is
the gap to reported revenue as a share of it, capped at 100%. Stored history
is the last 11 fiscal years (`HISTORY_YEARS`; it was 8), which each company
picks up at its next weekly SEC re-check.

**The rules.**

| Rule | Kind | What it does |
|---|---|---|
| Last quarter again | Simple baseline | Repeats the newest reported quarter |
| Same quarter last year | Simple baseline | Repeats the quarter a year earlier |
| Current rule | Current | Same quarter last year times the middle of the last four yearly growth rates |
| Latest growth | Candidate | The newest yearly growth rate |
| Recent growth weighted | Candidate | The last four rates, newest counted most |
| Growth trend | Candidate | The newest rate plus the change from the one before |
| Current rule plus drivers | Candidate | The current rule moved by three numbers known before the result: how companies that already reported that quarter came in against their own forecasts, the change in factory output, and the dollar against a year ago. Weights are refitted before every quarter on earlier quarters only |
| Pick the best so far | Check only | Before each quarter, uses whichever rule had the smallest miss so far. It tests the choosing itself and is never used |

**When a candidate replaces the current rule.** It needs 100 or more
company-quarters over 12 or more calendar quarters, a smaller average miss than
the current rule on the same quarters, a t value (quarters as the unit, so one
bad season counts once) at or above the bar for four tries (2.50), and a
smaller miss in both halves of the history. Among the rules that pass, the one
with the largest improvement is used. Once in use it stays while it is still
ahead with t at or above 1, so it does not flip back and forth. With too
little history the view reads "Collecting" and nothing changes.

**What a winner changes.** Only the Owner Earnings Forecast page: the revenue
forecast (and the EPS that follows from it) for each listed company, as one new
frozen run per company. The Forecast view names the rule in use, and the Track
record view keeps the earlier numbers beside it. Each company's new forecasts
are then scored forward against the current rule, and after eight results the
company steps back to the current rule if the winner did worse there. The
forward-tested bias and business-line models keep priority when they are
active. **The Top Picks AI grader keeps reading the earlier numbers**
(`graderContextBuilder` in `scripts/build.mjs` substitutes them), so no pick or
grade input changes. Switch: Owner Settings → Data & desks → "Earnings
Forecast: use the history test winner" (`EARNINGS_FORECAST_WINNER`, on by
default). Off keeps the current rule and still shows the test.

This is a change of policy for this desk: until now a rule could only be
promoted on forward results. The history test promotes on replayed history
because eight forward quarters per company take two years; the forward
step-back above is the guard.

**Ranges.** The Forecast view shows where the result is likely to land: a range
that held half the time and one that held four times in five, for revenue and
diluted EPS. Each is built from signed past misses of the rule in use: the
company's own misses shrunk toward every company's (weight n / (n + 8)), with
cut points placed for the next result, not the sample (position q x (n + 1)),
so a short history does not produce a range that is too narrow. The History
test view reports how often results landed inside ranges built only from
earlier results, and the Calibration lab grades the same four ranges
(`forecastCalibrationSources`). Ranges need 40 pooled results; before that the
Forecast view keeps its "Uncalibrated point forecast" line. They are not
scenario outputs and the scenario workbench is unchanged.

**EPS and analysts.** EPS is scored for last quarter again, same quarter last
year and the current margin, tax and share bridge. Analyst EPS estimates come
from the stored earnings history (estimate against actual, on the analysts'
own adjusted basis, so the two misses are each measured against their own
actual). Free sources keep no past analyst revenue estimates, so from this
build on the current-quarter and next-quarter revenue and EPS estimates are
saved whenever they change (`consensus` in the state file, 240 rows per
company) and the comparison starts with the first saved quarter that reports.

**Storage.** The replay per company is cached in the state file and redone
only when that company's filed numbers change. The page file carries the
summary (about 7 KB) and each company's ranges; the scored rows stay in the
Owner-only state file. A failed test keeps the last good copy and marks it
stale; it never blocks the forecast.

**Limits.** The page lists these: facts are joined by filing date with a
next-day cutoff, so the time this site first saw each number is not rebuilt and
a press release can come out before the filing; each forecast is made seven
days before the filing, not on a date known in advance; the companies are the
ones on the list today plus recent leavers, so companies that shrank out of the
top of the market long ago are missing; a miss is capped at 100%. Also true:
factory output and the dollar are today's revised series, not the first print
(noted under the drivers table); twenty large companies are a small, similar
group, so a rule that wins here may not win elsewhere; and four candidates were
tried on one history, which the raised bar allows for but does not remove.

**First run on real filings (2026-11-16, research run, no build).** The test
was run once on the public SEC company-facts files of the listed companies:
632 company-quarters from 17 companies over 42 calendar quarters (mid 2016 to
September 2026). Typical revenue miss: same quarter last year 14.3%, last
quarter again 7.6%, the current rule 5.5%, recent growth weighted 4.8%, latest
growth 4.0%, growth trend 3.9%, the drivers rule 6.6% (it did not help). Latest
growth passed every check (t 7.5 against the 2.5 bar, ahead in both halves), so
the first build after this ships is expected to put it in use. The ranges
held: the 50% revenue range caught 52% of results and the 80% range 82%; for
EPS 48% and 81%. Free sources had no past analyst estimates, as expected. The
run also showed that a bank filing only net revenue
(`RevenuesNetOfInterestExpense`) had no forecast at all; that tag is now read
last in the revenue list, so total revenue still wins when both are filed.

Tests: `node scripts/earnings-forecast-lab-smoke.mjs` (logic, 120 checks) and
`node scripts/earnings-forecast-history-browser.mjs` (page, 76 checks), both on
made-up companies from `scripts/fixtures/earnings-forecast-history.mjs`.

## Cost and controls

No new AI calls, subscriptions, services, browser polling, schedules or broker
actions. Existing public data remains under its current source policy; SEC
facts/source bytes and the new forecasts are Owner-only and are excluded from
Git and deployment archives by existing `data/` rules. Issuer IR links are
research references, not a transcript scraping or paid-consensus adapter.

There is a 48-request and 120 MB source cap per UTC day (raised from 24 / 60 MB
when the list grew to 20), 12 MB per document,
15-second timeout and no automatic retry loop. Source accessions and a seven-
day safety refresh control US company-facts downloads; TSM checks its filing
index at most once per day. The CIK map already used by the bake is reused.
Unchanged inputs and forecast horizon reuse a frozen run. Collection errors
retain prior accepted inputs and show warnings. Set `EARNINGS_FORECAST_ENABLED=0`
to stop collection and display its disabled state. The user's explicit build
authorization enables this Owner-only feature by default. The existing daily
workflow also excludes every forecast/state/archive path from its legacy
public-data fallback. No new workflow, schedule or deployed configuration
was added.

The measured local bootstrap used 23 free requests / about 31 MB. A warm
refresh uses zero downloads. This is request evidence, not a billing audit;
shared storage and hosting quota headroom still depend on the deployed account.

Requests are paced at least 150 ms apart. Immutable source keys cover the
complete source record, including metadata; run IDs cover the input fingerprint
and original freeze cutoff. Repeated successful runs reuse the input
fingerprint. A retry after a failed index write can create a distinct later
freeze without colliding with an earlier orphan artifact. Local archive
pathnames are published by exclusive hard link only after all bytes are
complete; state/index JSON is replaced atomically.

## Commands

```sh
npm run collect:earnings-forecast
npm run audit:earnings-forecast
npm run test:earnings-forecast
npm run test:earnings-forecast-browser
EARNINGS_PAYLOAD_FILE=data/earnings-forecast.json npm run preview:earnings-forecast
```

Browser checks accept `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` when those tools
are provided by the desktop runtime. With `EARNINGS_PAYLOAD_FILE` set, the
browser test additionally exercises the actual cached payload.
The preview is localhost-only and explicitly simulates an Owner session.
It does not bypass production authentication.
The raw-source audit requires the locally collected source/run archives.
After ordinary production hydration, request full archives explicitly with
`node scripts/sync-data.mjs pull --owner=bake --include-archives` before that
audit. Ordinary bakes deliberately avoid those extra downloads. The existing
daily workflow runs the offline forecast contracts before its network build.

## Implementation and validation

The implementation includes runnable offline and browser checks. Forecast accuracy is unproven until sufficient forward results
exist. Reconstructed historical checks are reported separately from live
forecasts, and conditional scenarios are never labeled confidence intervals. The ranges on
the Forecast view come from past misses (History test), not from scenarios.
