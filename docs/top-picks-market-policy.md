# Top Picks market policy

Top Picks preserves the stock's four-pillar conviction and publishes a separate
market-adjusted trade score. The policy applies only to options Top Picks.
Shared grades, Market Analysis, Risk Analysis, Stock Picks shares, Sector
Rotation, LEAPS and Leveraged ETFs retain their existing calculations.

## Decision contract

The stock conviction is the existing four-pillar sum. The option-adjusted
conviction includes the existing IV cost. The trade score is its magnitude
times one market multiplier, retaining the stock's original direction.
The policy replaces the old numerical regime grade overlay for Top Picks.
It never changes the shared grade pass. LEAPS still reads the original scoring
pass, before the Top Picks clone is adjusted.

Unified Signal, the Leveraged ETF cross-badge and the Volume pinned group read
the `picks.json.sharedResearch` compatibility snapshot. It is produced from the
unchanged scoring and previous review path. Their existing Top Picks inputs
therefore remain independent of this new policy. The prior thesis cache stays
at its existing keys; new Top Picks reviews use the `__topPicksMarket` namespace
inside that private cache. Each pass retains the configured candidate cap
(default six) and readiness skip. At defaults, cache misses can add up to six
Top Picks AI reviews per decision run,
plus their existing bounded research requests. No live permission check calls AI.

Bullish equity reference multipliers are 1.05 for Risk-on, 1.00 for Neutral,
0.90 for Fragile, 0.75 for Risk-off and 0.60 for Severe risk-off. Existing
stress within an adverse band can reduce its anchor by up to 0.025. The
Risk-on anchor can gain up to 0.025 from stronger constructive stress. The
independent confirmation adjustment ranges from -0.10 to +0.05. The final
multiplier is bounded to 0.50–1.10. These starting settings are uncalibrated.
Support cannot recruit a below-bar idea or promote a sub-Strong option-adjusted
conviction across the Strong threshold. Adverse evidence can demote it.

Bearish equity reference anchors are 0.75 in Risk-on, 1.00 in Neutral or
Fragile, and 1.05 in Risk-off or Severe risk-off. Confirmation reverses with
the exposure direction, inside the same final bounds.
Long-volatility exposure reverses the equity mapping. Gold and bond profiles
receive no generic equity discount; their individual signals and option
economics still decide qualification. No new sector multiplier, side quota,
position limit or portfolio restriction is introduced.

## Evidence

The policy records seven desks, separately from data coverage: Market Analysis,
Index Calendar, Fear & Greed, Heatmap, Volume, Overseas Markets and SPY gamma.
The market regime already includes bonds, credit, rates, USD, overseas and
positioning inputs. The regime, sentiment and overseas desks do not cast
duplicate full confirmation votes. Heatmap and unusual-volume participation
provide independent session confirmation only from same-session observations
no more than two hours old. Earlier participation stays reference evidence.
A confirming month can strengthen
that read. Gamma amplifies a confirmed adverse move; it supplies no independent
directional vote. Tracked-universe participation is not labeled whole-market
breadth. No sector ETF coverage is required.

An expandable Top Picks market-context panel shows the label, trajectory,
coverage, directional counts, source timestamps and cross-asset evidence.
Stock conviction and market trade score remain separate on cards, detail
views, the sortable table and CSV exports. An off-roster saved idea retains
its research, but cannot retain a current market entry permission.

Trajectory uses prior dated market-axis changes, QQQ weakness relative to SPY,
the existing scenario engine's leading warnings, and measured post-earnings
reactions. Earnings require at least four observed company reactions inside
seven days. Future observations, missing outcomes and thin reaction samples
do not supply votes. The scenario weights are risk scores, not probabilities.

## Entry and live permission

The policy requires dated index and VIX evidence. Regular-session core quotes
expire after 30 minutes; closed-session observations can carry for 96 hours.
Unknown core evidence means Wait. Optional missing desks do not blank an
otherwise sufficiently covered assessment.

The original knife, exhaustion, event, structure, payoff, liquidity and contract
quality gates still bind. Top Picks alone accepts a reclaim inside the last
five confirmed bars if every subsequent close continues holding that level.
Momentum, structure and payoff requirements remain independent.

The AI sees all market axes and the same IV classification as the strategy
selector. A cached or fresh AI verdict cannot override market approval or the
entry invariants. Market policy changes invalidate its material decision guard.

`api/auth/top-picks` authorizes both Owner claims before any data/provider read.
It reviews the persisted publication against latest existing market data and
the fixed-symbol macro quote provider. Indexes, VIX, dollar, long and front-end
yields, MOVE and the crude/gold shock read refresh from that request using the
published market thresholds. Slow policy, credit spreads, sentiment and the
saved overnight lead retain their dated published evidence. No extra overseas
or CNN request is added to this permission path. Ordinary adverse live changes require
two distinct observations at least 30 seconds apart. Exceptional index/VIX
shocks in either direction and missing or expired core evidence act immediately. Live checks can
suspend, not promote, a recommendation. A durable hold under the publication's
timestamp clears only with a fresh coherent stock/contract publication.
Stock publications expire after 26 hours. A market headwind is compared with
the original stock publication even when a newer market report was loaded first.

`top-picks-approval.json` is request-owned and private. A conditional object
lease protects concurrent reviews. The bake cannot overwrite or hydrate it.
Failure to obtain durable permission returns an unavailable review and the
browser holds new entries. The existing R2 lease backend is required for these
durable approvals; a backend without conditional leases cannot silently allow
entries. The browser polls only the visible Top Picks pane at one-minute
intervals, with a 30-second throttle and no overlapping review requests.

Off-cadence full bakes can suspend the existing roster and advance research
outcomes without enrolling a new trade or rewriting the position ledger.
Offline `regen-picks.mjs` also computes the new policy, but holds every new
entry for the next scheduled stock/contract review and cannot create study
decision cohorts from persisted prices.
The mirror checks this permission for new, unmirrored admissions only. Already
mirrored positions retain every existing execution, reconciliation and exit rule.

## Measurement in Track Record

The Market policy tab reads compact reports in `picks-accuracy.json.marketStudy`.
Frozen candidates and source assessments live in the separate private,
bake-owned `top-picks-market-study.json` file. The normal Track Record response
does not grow with those raw rows. Missing or malformed saved history pauses
measurement and preserves previous reports. On a full bake, the optional archive
is left out of that publication so the existing remote object stays intact; other features
and the trading ledger continue. Missed measurement publications are counted,
and no replacement historical cohort is invented after recovery.
Each publication
freezes the input assessment, stock-side candidate snapshots, three policies'
independent entry eligibility, and the actual selected roster. The policies are
the previous rules, market labels alone, and market plus confirmation.
AI review availability is recorded. Eligibility shadows are not reconstructed
AI approvals or exact counterfactual portfolios. Measurement adds no AI calls.

All three policies share the same opportunity set. Confirmed subsequent daily
closes score 5, 10 and 20 sessions, never the decision day's later close.
Dates are unique and aligned to SPY's confirmed market sessions when available;
a missing stock session cannot slide an outcome to a later close.
Directional underlying returns, worst adverse close, held-back losers and
missed winners can be measured for candidates without contracts. Where a
frozen contract exists, a separate fixed-entry-IV option scenario is expressed
per maximum loss. This assumes no intraday managed exit, fees or broker fill.
Large price discontinuities are flagged for corporate-action review instead
of becoming performance observations.
Expiry-day options use intrinsic payoff. A later stock close is never used
as an expired contract's expiry price; its option comparison is unavailable.

The recorded Top Picks cohort remains separate, with its existing modeled P&L.
Verified broker fills remain in Real fills. Old trade scores and exits are not
backfilled or rewritten. Market-policy enrollment evidence survives archival.
The study is research, retained across on-site report exclusion windows like
Grade edge; it is never fed back into broker execution.

Frequency, direction mix, empty runs, runs with missing core evidence,
eligibility changes, returns, worst adverse daily closes and regime breakdowns
are retained. Win rates
require twenty mature snapshots. Repeated names and sessions are correlated.
A chronological first-70%/later-30% monitoring split begins at ten observed
dates. This is not an untouched validation sample or evidence of predictive
improvement. No multipliers automatically tune themselves from results.

Historical analysis requires actual point-in-time decision records. Today's
fundamentals or market states cannot be projected backward. The study starts
prospectively at the next decision run. Collection pauses at 20,000 stock-side
snapshots instead of silently truncating them; existing outcomes continue to
advance and the pause is visible.

## Verification

- `npm run test:top-picks-market`: policy, roster, missing data, safeguards,
  source adapters, permission, Owner access and measurement checks.
- `npm run verify:top-picks-isolation`: compare representative existing feature
  outputs against this branch's main base with a fixed clock and no network.
- `npm run test:top-picks-market-browser`: desktop/mobile, light/dark card and
  Track Record checks with synthetic data and no broker connection.
- `npm run regen:top-picks-market`: regenerate affected assets offline,
  preserving manifest and risk-free-rate provenance.
- `npm run audit:top-picks-market -- --input data/top-picks-market-study.json --output <report.json>`:
  rerun the chronological measurement from saved decision evidence.
