# Top Picks market policy validation

Validated locally on `Top-Picks-Forward`, based on main
`0e03bb90309494b920b8a3cd67762390f76150da`, on 2026-10-30.
The [policy contract](top-picks-market-policy.md) describes the settings,
evidence, permissions, storage and measurement limits.

## Scope evidence

`npm run verify:top-picks-isolation` compares actual outputs against that
main base using a fixed clock, synthetic source evidence and disabled network.
Market Analysis, shared grades, default timing, shares Stock Picks, Sector
Rotation, LEAPS, Leveraged ETFs and Risk Analysis match. Seventeen existing
browser calculators, the published research manifest and risk-free-rate
provenance also match.

The new policy operates on a Top Picks scoring copy. Unified Signal, the
Leveraged ETF cross-badge and Volume's pinned group receive the prior policy's
separate research snapshot. A test exercises the actual Unified Signal
publisher with that snapshot. Existing position exits, broker reconciliation
and previously recorded outcomes retain their rules.

## Passing checks

- New policy suite: 32 check groups, including multiplier bounds, both trade
  directions, inverse and haven exposure, no duplicate desk votes, dated
  source evidence, recent held reclaims, roster construction and AI limits.
- Live review: the existing macro thresholds and weighted gauge agree on
  ordinary, stressed and rallying price fixtures; bond, dollar and commodity
  shocks participate. Missing evidence, publication races, durable holds,
  recovery, two-observation confirmation and malformed permissions are covered.
- Measurement: actual file enrollment, separate frozen history, compact Track
  Record reports, idempotent prospective cohorts, missing-session handling,
  no future closes, expiry-day long/debit/credit payoffs and unavailable
  post-expiry option comparisons pass. Whole-cohort capture at the storage
  cap, exclusion of incomplete comparisons, immutable publication replays,
  missing credit-spread maximum loss and back-adjusted split history have
  regression cases. Missing or corrupt history cannot
  silently start a new study. A history failure pauses only measurement and
  preserves the existing trading ledger and saved evidence.
- Existing Top Picks: 552/552; Top Picks guards: 21/21; track-record fills:
  54/54; sector growth: 131/131. Entry policy, risk selection, Track Record
  reset and research-consistency suites pass. The risk audit includes its
  324-case call/put and option-economics sweep.
- Existing Market Analysis: 25 check groups, including 2,000 scoring cases
  and refresh simulations. Risk Stack: 11 check groups.
- Webull mirror and its execution, grouped-position, recovery, legacy-fill,
  shipped-view and build-window suites pass offline, including the 150-case
  mirror checks. No broker connection or order is used.
- Render, shared views, IV richness, sector groups, Owner restrictions,
  private-store access, data hydration and publish-freshness checks pass.
  LEAPS scoring, Unified Signal perspectives, AI cost limits and workflow
  schedules pass. The old LEAPS test's public-grades assertion was corrected
  to the current Owner policy; the calculation itself is unchanged.
  The deployment packaging command stages the expected eight browser assets.
- Browser checks exercise generated assets at 1440px and 390px in light and
  dark themes: cards, expandable market evidence, sortable table, CSV fields,
  Market policy horizons and methodology. A saved off-roster idea stays on
  Wait; an unavailable review also updates an already-open detail view.
  Additional checks cover score arithmetic, Risk map, Grade/detail tabs,
  keyboard table sorting, watch-only entry labels, open evidence during live
  refreshes, retained focus/scroll across horizons and paused measurement
  retaining its previous reports.
  Pages fit the viewport, the measurement table scrolls within its container,
  and no browser exception occurs.

## Existing check limitations

`test:owner-scope` is a source-freeze audit for the earlier Owner access
migration. It requires the entire build producer and ownership file to equal
`origin/main`, so a Top Picks feature change deliberately fails that assertion.
Its useful calculator, manifest and rate-preservation checks are retained in
the new semantic scope verifier above. The old test is not weakened to hide
the authorized behavior change.

`test:owner-preservation` also compares the current data producer byte for
byte against `HEAD`; its source-freeze assertion requires a committed tree.
Its response checks verify nine unchanged stored snapshots, both routes and
zero storage mutations. The semantic scope comparison above separately
checks actual feature outputs against the pre-feature main base.
These targeted checks are not an all-repository test-suite claim.

## Runtime limits and first measurement

The local checks use synthetic data and local storage adapters. They do not
verify production credentials, a deployed Owner session, current private
source data, provider availability or actual broker fills. No production data
is collected or changed by these checks. Release verification separately
checks the deployed generated assets and anonymous Owner-data protection.

Durable live permissions require the existing R2 conditional-lease backend;
failure leaves new entries on Wait. At default caps, preserving other desks'
old review path can add up to six cached-or-fresh Top Picks AI reviews per
decision run, with the existing bounded research requests. Live permission
and measurement make no AI calls.

After release, the next scheduled Top Picks decision starts prospective
measurement. Outcomes mature after 5, 10 and 20 subsequent confirmed sessions.
The initial multipliers are uncalibrated settings. The paired eligibility
comparisons and chronological monitoring split do not establish a forward
investment edge, execution performance or an untouched validation holdout.
