# Earnings Forecast

Owner-only, deterministic quarterly research. No inference calls, paid feeds,
broker writes or changes to the existing ranking engines.

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
live learning/promotion sample.

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
forecasts, and conditional scenarios are never labeled confidence intervals.
