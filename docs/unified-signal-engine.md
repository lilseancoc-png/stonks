# Unified Signal Engine

The Owner navigation opens Unified Signal Engine at `?tab=unified-signal-engine`.
The existing Decision view is 14-calendar-day swing research over the current
evidence and entry policies. Investment outlook and Trading outlook add
separate perspectives alongside it. They do not change the grade, Top Picks
ranking, contracts, entry qualification, position sizing, or execution.

The view answers direction, horizon, supporting and opposing evidence,
uncertainty, trade feasibility, and price provenance. It also shows added,
changed, and removed evidence since the previous saved assessment, plus thesis
invalidation conditions.

## Decision ownership

`lib/unified-signal.mjs` builds a pure assessment from existing grade, ticker,
Top Picks, Market Analysis, Evidence Record, Quant Lab, relationship-map, and
Sector Rotation inputs. It makes no network, model, or broker calls.
`scripts/publish-unified-signal.mjs` reads the completed local bake artifacts
and writes the result.

The directional side and ranking come from the existing grade rubric. Raw
measurements and summaries from related desks remain context. In particular,
an Evidence Record measurement labeled `up` is not treated as a bullish
stock prediction. Syndicated headlines with the same normalized title appear
once. Supporting rubric families are not claimed to be statistically independent.

Policy eligibility requires a matching owner trade from the same decision
timestamp, the current option-entry policy, the shared `pickDisplayDecision`
readiness result, complete deterministic readiness, valid stock structure,
and a current regular-session price with verified currency. AI reject vetoes
remain binding. A bounded AI entry promotion already admitted by the owner
pipeline remains usable when the deterministic prerequisites hold.
The reward/risk admission check uses full precision before display rounding.

This release does not choose new contracts outside the existing owner
strategy path. Bullish stock payoffs and the current selected option are
compared with cash. Short shares remain unassessed because borrow, margin,
and short-sale risk are not connected. Portfolio suitability is unassessed.

## Price and uncertainty boundaries

The quote keeps its selected Yahoo field, matching market observation time,
retrieval time, session, currency, and exchange when available. The bake uses
the regular-session option-analytics basis. The live stock endpoint keeps its
active-session selection and now exposes the matching source provenance.

Entry qualification expires at the earliest of the snapshot limit, one hour
from the source quote, or the regular-session close. The browser recomputes
this status on entry, visibility changes, and the expiry deadline. A failed
refresh makes a retained snapshot reference only. An authorization failure
clears the loaded decisions.
A request that stalls for 15 seconds is aborted and can be retried. Failed or
expired entry checks also appear inside the selected ticker assessment.
Automatic expiry preserves expanded evidence and keyboard focus.

Before the next trading session opens, the preceding trading close is valid
reference data. It cannot qualify a new entry. During the next regular
session, that preceding close is no longer treated as a current-session price.

The view distinguishes observed price, stock entry reference, technical
objective, conditional macro stress range, analyst consensus, and modeled
option liquidation values. Independent business valuation and calibrated
stock-price forecasts are not estimated. Scenario weights, rubric scores,
and AI grades never become win probabilities or expected returns.

Stock return percentages use invested capital before unestimated costs.
Option scenario percentages use maximum quoted loss, including the correct
width-minus-credit denominator for credit spreads. Both bases are labeled.
Theoretical option marks retain the existing pricing-model limitations.

## Publication and privacy

The full bake writes a new assessment after the evidence step at the existing
11:00 and 15:30 ET Top Picks decision windows. Other full bakes copy the exact
prior current payload after the data-directory wipe. They do not advance the
decision timestamp. The first deployment can land between windows without
a payload. The UI explains when the first snapshot will appear.

The current view is `unified-signal.json`. Each decision build also creates
`signal-decisions/<timestamp>-<content-hash>.json`. The archive is written
before the current pointer payload, verifies its content identity, and refuses
different content at an existing key. Snapshots contain the extracted
observations, interpretations, source/rule versions, and decisions used by
the view. They do not archive every raw upstream response or constitute an
independent backtest dataset.

Both the current view and the entire archive namespace require the signed
`tr` and `tp` Owner claims and use private no-store responses. No decision
payload is embedded in public HTML or stored in browser local storage. Local
storage holds only the chosen symbol, policy filter, and focused view.

Archive keys are bake-owned and excluded from dynamic stale deletion. Normal
hydration skips archive downloads. Explicit research hydration with
`--include-archives` can retrieve them. No scanner or request-time trade ledger
is changed. A research-publication error does not alter the existing trade
pipeline; any previously published assessment remains dated and expires.

## Verification and local preview

- `npm run test:unified-signal` checks semantic interpretation, both directions,
  entry gates, quote age, session close, risk denominators, archive identity,
  publication, and the actual signed-session data-serving boundary.
- `npm run test:unified-signal-browser` checks owner navigation, focused views,
  search, filters, preference persistence, responsive resizing, failures, and
  expiry in Chromium. Set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` when the runtime
  is provided outside this repository.
- `npm run preview:unified-signal` opens a read-only loopback preview on port
  4191 with fictional data and a simulated owner. It makes no provider or
  broker calls. Its October 23, 2026 fixture is intentionally dated.
- `node scripts/regen-static.mjs` regenerates the shipped HTML, JavaScript,
  and stylesheet after source renderer edits.

Production behavior still requires a fresh authenticated decision bake.
Predictive calibration, independent cash-flow valuation, multi-year financial
models, and new instrument optimization remain future work. No new AI calls, scheduled jobs,
provider subscriptions, or order-submission paths are added by this release.

## Additional perspectives, October 27, 2026

The new views share the observed price and existing source artifacts, but
their conclusions do not consume the four-pillar total. A bullish setup can
coexist with an unattractive investment scenario, a mixed grade, or an owner
Wait. The Decision, Evidence, Price explanations, Trade comparison, and
Company record views retain their existing roles. The Decision view links to
both added perspectives without averaging their conclusions.

Each perspective evaluates its quote at the recorded assessment cutoff, which
can follow the start of the bake as financial sources finish collecting. The
existing Decision retains its original quote cutoff and entry rules.

### Investment outlook

`lib/investment-perspective.mjs` reuses `fullYearValuationFactory` and the
already-collected `earnings-forecast.json` company records. It requires four
consecutive, nonoverlapping USD financial quarters, a supported positive
earnings bridge, source availability by the assessment cutoff, and a usable
comparable USD price. The latest reporting period must be at most 180 days
old. Future-ingested facts, former cohort members, currencies or ADR bases
that require conversion, and unsupported financial-sector methods are
withheld. Missing coverage is not a negative business judgment.

The base growth, margin, tax, common-income adjustment, and diluted-share
assumptions come from the accepted financial bridge. The starting exit P/E
uses the median of at least three other covered companies with the same
reported industry and sufficiently recent quote snapshots. Without that
cohort it uses the issuer's observed forward P/E, explicitly labeled as a
market-derived assumption. It does not become independent evidence of cheapness.
Forward P/E uses vendor estimates, while modeled EPS uses the financial
bridge; the multiple is a reference assumption rather than a claim that the
two earnings definitions are identical.

The model shows three sensitivities:

- Lower assumptions: annual revenue growth minus 5 percentage points,
  operating margin minus 2 points, and exit P/E multiplied by 0.8.
- Base assumptions: the displayed growth, margin, and exit P/E.
- Higher assumptions: growth plus 5 points, margin plus 2 points, and exit
  P/E multiplied by 1.2. Margins respect the supported gross-margin ceiling,
  and bounded growth, margin, and multiple inputs remain explicit.

The annual earnings bridge prices each scenario as EPS times the exit
multiple. A 12-month scenario price is discounted once by the selected
required annual return, initially 12%, to produce a conditional present value.
The future-price and present-value columns remain distinct. Comparing the
recorded price with the range yields Below, Within, or Above the scenario
range. These labels are not automatic Buy or Sell instructions.

Reverse valuation holds margin, taxes, shares, and multiple fixed and solves
for revenue growth sufficient to reach today's price plus the selected annual
return. This is a model-implied requirement, not a unique measurement of
market expectations. The default return hurdle and scenario shifts are
research assumptions, not estimated probabilities or personalized account advice.
Dividends and transaction costs are unestimated. This earnings-multiple view
does not claim a full intrinsic cash-flow valuation or a calibrated price forecast.

The browser runs the exact same pure calculation for temporary changes to
growth, operating margin, multiple, and return hurdle. Edits remain in page
memory per ticker, reset when the source identity changes, and never write
back to financial forecasts, saved snapshots, the grade, or trades. Blank,
invalid, or unreconciled assumptions withhold prices instead of treating a
missing value as zero or preserving a prior successful result.

### Trading outlook

`lib/trading-perspective.mjs` discovers price hypotheses independently of
the grade. It requires at least 80 aligned completed OHLCV sessions, retains
at most 520, and excludes history before a gap over seven calendar days.
Dates, prices, volume, and ordering are validated at the input boundary.
The chart request and response must have completed by the assessment cutoff.
The dedicated chart request time, rather than a later quote download, determines
which daily bars can be confirmed. A later assessment or slow chart response
cannot promote an intraday bar retained from an earlier request. Same-day
confirmation requires the request to start after the verified session close
plus 15 minutes, including half-days. Histories without that collection
provenance withhold this view until a fresh bake. Stale histories cannot
present a current setup.

The three experimental definitions are:

- Snapped streak: the existing noise-aware Streaks calculation identifies a
  material run of at least three same-direction sessions, at least a 3%
  cumulative move, and a break within the last two sessions. A snapped red
  run creates bullish research; a snapped green run creates bearish research.
- Range break: a confirmed close beyond the previous 20-session high or low
  on at least 1.3 times the preceding volume average.
- Trend pullback: aligned 20- and 50-session averages, a direction-matched
  50-session slope, a 1–8% retreat from the preceding range extreme, proximity
  to the 20-session average, and a latest close turning with the trend.

Confirmation requires a close moving with the setup, the correct side of the
20-session average, and at least 1.1 times prior average volume. The current
price must retain that side of the average, have positive reference payoff
of at least 1.5:1, and put invalidation within two 14-session ATR. The stop
uses the most recent five-session extreme. The objective uses the preceding
20-session range boundary, or a range projection capped at three ATR when
that boundary has already been crossed. These are technical references,
not business value or guaranteed fills. Known earnings inside the next two
trading sessions and an existing macro-event wait withhold confirmation.

An own-history IV level, five-session direction, source date, and capture time
are shown only for a mature history of at least 60 observations captured by
the assessment cutoff and at most 90 minutes old. Today's intraday IV may
accompany the preceding completed price session; its separate date remains
visible. Missing, future, or stale capture timestamps withhold this context.
Below-average
and falling IV remains different from below-average and rising IV. Neither
creates stock direction. Peer context is a leave-one-out five-session return
among aligned covered companies in the same reported industry; fewer than
three peers cannot produce a comparison mean. It is shared price evidence,
not another statistically independent vote.

Historical replay applies the detector to each trailing prefix and reports
resolved five- and ten-trading-session stock outcomes for the current setup
kind and side. Consecutive confirmed detections form one occurrence; resolved
samples within each horizon do not overlap. The latest unresolved occurrence
does not enter the results. Signed mean and median stock returns, positive
outcome frequency, and the unconditional same-stock baseline are descriptive.
The baseline is not a matched independent control. The 20-event display
threshold is not proof of an edge. Returns start at an observed signal close,
so they do not establish executable entry, net trade returns, options P&L,
or a calibrated future win probability.

The Streaks algorithm moved unchanged to `lib/streaks.mjs`. The build imports
and re-exports it, so the existing site and the historical replay use the
same calculation. Moving averages remain available even when all daily moves
fall inside the streak noise floor and no meaningful streak exists.

### Publication, compatibility, and verification

Both perspectives are part of the existing private, immutable Unified Signal
snapshot. The trading input manifest retains losslessly compressed confirmed
OHLCV, its column order, row count, and original hash. Decode its base64 data
with Node's `inflateRawSync` to recover the exact JSON rows for offline replay;
the browser never inflates it. The investment view retains its financial assumptions, source fact IDs,
dates, and source snapshot identity. No additional storage key, source fetch,
model call, schedule, or broker operation is introduced. Archive storage grows
with retained research inputs; account-level storage headroom is unverified.
Publication enforces a 4 MB snapshot budget before writing either the archive
or current pointer. An oversized research result retains the prior dated view
and does not affect the trading pipeline. `npm run audit:unified-perspectives`
checks an 85-company, 520-session fictional universe with 20 financial records
against that budget. It measures size and processing, not predictive accuracy.

The publication call records a separate perspective assessment time because
the bake's initial decision timestamp can precede financial collection. Source
availability is checked against that later assessment cutoff. The original
decision timestamp, quote expiry, owner entry gates, and ranking retain their
existing meaning. Each view displays its own horizon and calculation time.

Retained version-one snapshots without the additional perspectives remain
readable. Their new tabs explain that a newer published snapshot is required.
Malformed added payloads fail validation before rendering. Authorization
revocation clears the loaded snapshot and temporary investment inputs. Browser
storage still contains only display preferences, never private financial or
decision payloads.

`npm run test:unified-signal` includes `unified-perspectives-smoke.mjs`, which
checks price sensitivity, arithmetic reconciliation, grade independence,
opposing directions, source and candle cutoffs, missing and malformed data,
nonoverlapping historical outcomes, publication, archival identity, and
execution isolation. The existing browser command also covers both new views,
editable assumptions and reset, missing values, policy preservation, and
responsive layouts in both themes. All fixture results are fictional and
offline. Actual company coverage and predictive value require fresh
authenticated production snapshots and prospective outcomes.
