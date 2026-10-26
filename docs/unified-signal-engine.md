# Unified Signal Engine

The Owner navigation opens Unified Signal Engine at `?tab=unified-signal-engine`.
This first release is a 14-calendar-day swing research view over existing
evidence and entry policies. It does not establish a new predictive edge.

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
Predictive calibration, independent valuation, broader horizons, and new
instrument optimization remain future work. No new AI calls, scheduled jobs,
provider subscriptions, or order-submission paths are added by this release.
