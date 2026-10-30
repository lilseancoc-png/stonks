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

- New policy suite: 27 check groups, including multiplier bounds, both trade
  directions, inverse and haven exposure, no duplicate desk votes, dated
  source evidence, recent held reclaims, roster construction and AI limits.
- Live review: the existing macro thresholds and weighted gauge agree on
  ordinary, stressed and rallying price fixtures; bond, dollar and commodity
  shocks participate. Missing evidence, publication races, durable holds,
  recovery, two-observation confirmation and malformed permissions are covered.
- Measurement: actual file enrollment, separate frozen history, compact Track
  Record reports, idempotent prospective cohorts, missing-session handling,
  no future closes, expiry-day long/debit/credit payoffs and unavailable
  post-expiry option comparisons pass. Missing or corrupt history cannot
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
  The deployment packaging command stages the expected eight browser assets.
- Browser checks exercise generated assets at 1440px and 390px in light and
  dark themes: cards, expandable market evidence, sortable table, CSV fields,
  Market policy horizons and methodology. A saved off-roster idea stays on
  Wait; an unavailable review also updates an already-open detail view.
  Pages fit the viewport, the measurement table scrolls within its container,
  and no browser exception occurs.

## Existing check limitations

`test:owner-scope` is a source-freeze audit for the earlier Owner access
migration. It requires the entire build producer and ownership file to equal
`origin/main`, so a Top Picks feature change deliberately fails that assertion.
Its useful calculator, manifest and rate-preservation checks are retained in
the new semantic scope verifier above. The old test is not weakened to hide
the authorized behavior change.

`test:leaps-score` fails at line 153 because it expects `grades.json` to be
public. The current Owner policy makes it private. The identical failure is
reproduced in an isolated checkout of unchanged main `0e03bb903`; this feature
does not change LEAPS scoring or that access rule. This is not an all-suite
green claim.

## Runtime limits and first measurement

The checks use synthetic data and local storage adapters. They do not verify
production credentials, a deployed Owner session, provider availability or
actual broker fills. No production data is collected or changed, and this
branch has not been deployed.

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
