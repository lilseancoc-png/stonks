# Risk-Analysis correctness review

Reviewed October 23, 2026 against main at `0bd3188b620f811178e8fdacdc3f6f6d4bec8bbb`. Changes remain local on `Risk-Analysis`.

This review covers the changed entry engine, option selection, exits, published explanations, LEAPS research labels and downstream tracking. It separates reproducible bugs from thresholds that still need investment-performance evidence. The approved policy and exact thresholds are in [risk-analysis-policy.md](risk-analysis-policy.md).

## Bugs found and corrected

- **Impossible spread profit.** Different leg IVs could imply a theoretical vertical worth more than its strike width. The economics screen clipped that value to maximum payout, which could fabricate a passing Buy. It now marks the scenario unavailable. An invalid flat-IV target or invalidation scenario cannot qualify an entry. The screen also validates leg direction, expiry and structure.
- **A credit trade could begin beyond its own defense.** A high-IV candidate could have a bull-put short strike above spot, so an unchanged stock immediately triggered its frozen short-strike exit. The screen rejects that candidate and continues the permitted-contract comparison. The bearish rule mirrors it.
- **Midpoint gates could hide execution costs.** A debit could meet the existing 1:1 maximum reward/risk minimum at mid but fail it when buying the ask and selling the bid. A credit could similarly fall below the existing 22% share-of-width minimum. Both minimums now also apply after entry quote costs. These are existing thresholds, not new calibration values.
- **Wait ideas could consume Buy roster limits.** Contract-bearing watch ideas shared sector, factor and side counters with actionable trades. Several failed economic candidates could exclude a lower-ranked eligible trade. Each roster now has separate counters, with the same limits. This does not change account sizing.
- **Fallback explanation could name the wrong trade.** A debit fallback inherited the original single-option or credit label. It now carries the correct bull/bear debit-spread label. If no preferred contract qualified, the comparison records it as absent instead of calling the fallback the preferred contract.
- **Stock plan could use the wrong entry price.** The exit-plan helper ignored an explicit spot argument when reconstructing structure. It now uses that spot. An extreme put projection could also produce a negative stock target; such a target and its reward/risk now remain unavailable.
- **Contradictory saved data could display Buy.** A payload with actionable membership and `entry.now=true` could render Entry confirmed despite a failed economic audit. The shared display decision rejects failed or conflicting audits. A versioned entry requires a passing audit. Tracking applies the same rejection at enrollment and never labels an unaudited legacy entry as reviewed. Existing recorded trades are not reenrolled or reset. Published timing now retains its hard-Wait flag.
- **Unavailable scenarios could crash the card.** Scenario rendering now handles unavailable target or invalidation prices and explains why pricing could not be verified.
- **Explanations used obsolete or overstated rules.** The grader's candidate banner still listed the old delta, expiry and liquidity criteria. It now describes its actual candidate screen and distinguishes that screen from Top Picks entry approval. Fallback labels match the selected structure. Purchased options are labeled accordingly, and spread descriptions avoid promising lower theta or vega in every scenario.
- **Reference exit prices were ambiguous.** The ladder uses the published midpoint for continuity with the model record. Cards now identify that basis and show the quote-cost profit/stop prices separately. Both must be recalculated from an actual fill. A stock-target touch does not guarantee the option profit exit.
- **Missing LEAPS evidence could look observed.** Missing forward trajectory is now labeled unverified without changing its zero score contribution. Missing numeric values remain missing when sorting. Research qualification remains separate from Go/Wait/Avoid.

## Evidence

`npm run test:risk-audit` reproduces spread-bound failures, absent preferred contracts, credit defense already breached, contradictory saved decisions, explicit-spot geometry, negative targets, roster-cap interference, execution-cost thresholds and malformed inputs. It also runs the shipped economic-detail renderer with unavailable scenarios, fallback audits and legacy cards. An isolated copy of the actual enrollment function writes only to a temporary directory, verifies failed/missing/hard-Wait exclusions and legacy policy labels, and confirms a prior recorded outcome remains unchanged.

The existing suites pass for 524 pick checks, 54 track-record fill checks and 145 paper-mirror checks. Entry policy, permitted selection, volatility symmetry, confirmed-bar handling, frozen audits, LEAPS, render, private-store and paper-mirror recovery/view/window checks also pass. The cost comparison verifies unchanged stock-quality grades across 32 synthetic cases spanning four market regimes.

Browser verification used the generated app and synthetic pipeline output. It covered accepted and economic-Wait entries, permitted-alternative explanations, Grade/Recommendation switching, timing thresholds, reopening a detail, desktop-to-mobile resizing, LEAPS Go/Wait/Avoid labels and sort/layout persistence after reload. The 390-pixel mobile detail had no page-level horizontal overflow. These fixtures do not verify the current six live recommendations.

## Cost findings

`npm run verify:risk-cost` makes zero upstream requests during the check and verifies no added provider calls, market-data fetches, storage operations, workflows or dependency changes. The existing AI model, budgets and prompt construction remain unchanged. A local 14-expiration stress fixture evaluated 124 candidates in approximately 4.3 ms on average, with a 6.0 ms 95th percentile in the review run. Measurements vary by run and machine.

The work adds local computation and small audit fields to existing payloads. Changed eligibility or a policy signature can refresh existing capped AI slots on rollout. This is an incremental architecture check, not a provider invoice comparison or a promise of identical spending.

## What remains an investment question

The 14-calendar-day stock-target scenario is a feasibility test. Its stock target is not assigned a probability, and a 2.5-ATR projection is not a return forecast. Flat IV, zero dividends and European pricing are explicit approximations. IV stresses have no calibrated probabilities. American exercise, event jumps, fees and future liquidity can change actual results.

The volatility thresholds, fresh-reclaim requirement and LEAPS score weights still need forward evaluation. This review does not establish that stricter entry rules cause the historical profit percentage or that these changes generate alpha. Compare policy-version cohorts after costs, with missing and unresolved outcomes retained. No wider expiration window, fresh-reclaim relaxation, account-sizing change or LEAPS weighting overhaul was introduced.

## Follow-up verification

A second pass reproduced two additional persisted-data cases. A reviewed pick with a passing economics audit but a missing entry decision could enroll despite rendering Wait. A stale no-strategy pick could also enroll if it still carried a contract. Reviewed enrollment now uses the same final readiness function as the card, and no-strategy picks cannot enroll. Live roster and market-summary counts also use that readiness decision. Legacy entries retain their existing compatibility behavior.

The economics screen also compared a rounded return with the 25% threshold. A 24.99999% scenario could round up and qualify. Thresholds now use full precision, with rounding reserved for serialized display values. The same correction applies to the debit reward/risk comparison.

The follow-up test sweeps 324 combinations across calls/puts, single/debit/credit structures, 30/60/90-day expirations, IV, stock targets and fees. It checks contractual payoff bounds, complete scenarios and that adding fees cannot improve or rescue the same contract. Actual isolated enrollment and live-roster rendering tests cover the new consistency cases.
