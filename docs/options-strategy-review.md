# Top Picks options strategy and risk review

Reviewed on October 22, 2026, on `WeBull-Integration`.

Scope: automatic strategy routing, option-chain selection, payoff calculations,
exits, displayed sizing, portfolio simulation, track-record marks, and the
Webull paper mirror. This is a code and assumptions review, not validation of
every upstream market-data source or proof of investment performance.

## Decision

The supported structures are conventional ways to express a directional view.
The debit-spread rationale is economically coherent when the expected move is
bounded and selling the upper strike meaningfully reduces entry cost. The
current engine does not yet establish that each chosen structure has positive
expected return after execution costs. A research paper account is appropriate
for measuring that gap. The modeled win rate alone does not justify production
capital allocation.

## Correctness changes in this branch

- Missing or stale relative-IV history is `unknown`. It cannot qualify as
  reasonable IV for an automatic single-long recommendation.
- Debit and credit recommendations cannot fall back to a single option when
  spread legs are unavailable. This preserves event, volatility, skew, and
  conviction restrictions. The engine skips a trade without a permitted spread.
- Long-to-debit and credit-to-debit fallbacks remain available. The explicit
  `PICKS_STRATEGY_AUTO=0` legacy single-long mode remains an operator override.

Regression coverage exercises both calls and puts, missing and stale IV,
earnings, macro events, skew, moderate theses, expensive IV, unavailable wings,
and the permitted fallbacks. The findings below describe the pre-change +20%
non-credit target. The subsequently approved implementation changes it to +25%
while retaining the -50% stop (66.67% two-outcome break-even before costs). It
also adds the [broker lifecycle controls](webull-paper-controls.md). Historical
closed trades are not restated, and these changes do not establish expectancy.

## Findings that need further work

### 1. Expiration reward/risk does not describe the managed trade

`pickVerticalForPick` rejects debit spreads whose maximum expiration profit is
less than the debit paid, and its ranking favors 2:1 maximum reward/risk.
`resolvePickOutcome`, however, normally takes profit at +20% of debit and stops
at -50%. Under exactly those two outcomes, the win-rate break-even is
`50 / (20 + 50) = 71.43%` before costs. Fixed round-trip costs of 2% and 5% of
entry debit raise it to 74.29% and 78.57%.

Those figures are sensitivity examples, not the strategy's measured break-even.
Sampled marks can overshoot either threshold, and thesis or underlying stops
can close trades earlier. Use observed average winning and losing returns,
after costs, to estimate realized expectancy. Do not equate a 2:1 expiration
payoff with the +20%/-50% exit plan.

Credit spreads have a different denominator: +50%/-50% is measured against
credit received. At the 34%-of-width credit target, each planned outcome is
about +/-0.258 of maximum loss. A gap to full maximum loss can erase roughly
3.88 planned winners before costs. The stop is an instruction, not a guarantee
that loss will be limited to half the credit.

### 2. Contract selection does not compare trade returns at a thesis horizon

The strategy router uses conviction, thesis tier, relative IV, event windows,
and skew. The chain search uses delta, expiry, liquidity, and expiration
economics. It does not compare a single option against several spread widths
at a specified stock target and holding horizon, with alternative IV outcomes.
The target and entry timing are computed elsewhere and do not set the short
strike in `pickVerticalForPick`.

A debit spread can be a good expression of a moderate move. A single option
can make sense when uncapped upside is worth its extra premium and volatility
exposure. A Strong grade by itself does not establish that tradeoff. The
default +20% profit exit also weakens the stated reason to pay for uncapped
upside, though a single option can still differ in speed, liquidity, and Greeks.

Next evaluation: reprice the actual candidate contracts at the same target,
invalidation level, and holding horizons under IV-up, IV-flat, and IV-down
scenarios. Compare returns at equal initial maximum loss. Include shares and
no trade as benchmarks. Scenario outputs are not expected returns without
calibrated probabilities.

### 3. Historical IV percentile is not a volatility forecast

The 60th-percentile or +1.5-standard-deviation rule establishes that IV is high
relative to its own history. It does not establish that IV exceeds subsequent
realized volatility or that selling this particular spread has positive edge.
A structurally changed business or market regime can sustain higher IV.

Debit and credit labels also do not independently determine attractiveness.
Call and put verticals at matching strikes can have closely related terminal
payoffs after financing and dividends. Compare the actual strikes, prices,
Greeks, liquidity, and assignment obligations.

### 4. Liquidity filters do not bound net-spread execution costs

Single longs require a bid/ask width no greater than 10% of their midpoint.
Vertical legs permit up to 18% each and open interest of 50. Two acceptable
legs can still produce a poor executable bid/ask relative to a small net debit.
The expiration payoff tests use leg midpoints, not confirmed executable prices.

Next evaluation: measure net spread width, likely price improvement, commissions,
and fees relative to the planned profit. Reject or report trades whose execution
cost consumes the economic advantage. Do not assume a fill at mid or infer a
fill from a limit submission.

### 5. The three sizing systems describe different portfolios

`applyPickSizing` deploys up to 80% of its display account as maximum-loss
budget, with conviction and regime adjustments. Five equal Strong picks at
full regime sizing receive 16% maximum-loss budget each. With $10 premium and
the default $25,000 display account, this suggests four contracts per pick.

The browser simulator instead caps per-trade maximum loss at 2% of equity and
total open maximum loss at 20%. Webull submits one contract or spread unit
without consulting account equity or current broker positions. These cannot
be treated as equivalent performance tests. Whether the risk is acceptable
depends on the mandate, but the display sizing is aggressive for a diversified
portfolio and is not enforced by the broker mirror.

Next evaluation: use one account-aware risk policy for execution and report
backtests under that same policy. Include sector/factor concentration, existing
positions, net delta/vega, aggregate loss stress, and assignment liquidity.

### 6. Modeled wins do not establish executable expectancy

The headline record marks positions with Black-Scholes using entry IV. It does
not update its headline valuation for changing implied volatility, dividends,
American exercise behavior, or transaction costs. Quotes-based fill estimates
are separate and can fall back to a model when quotes are missing. A model
take-profit can therefore trigger when no equivalent executable profit exists.

The source records grade-model versions on new enrollments; older entries may
lack that version. Stratify forward results by version and avoid assuming old
outcomes validate the currently changed decision rules. Multiple variants,
overlapping positions, and correlated sector exposure reduce the evidential
value of a small sample.

### 7. Execution and expiry need operational risk controls

The mirror reconciles on full bakes, not continuously. Its DAY limit exits are
sent after the record closes a position; there are no resting protective stops
created by the mirror. Fill recognition and repricing wait for another run.
It can mark expiry without reconciling settlement, assignment, or resulting
stock positions. It also stops retrying failed exits after a bounded number
of attempts and asks for a manual close.

Before relying on this as an unattended portfolio, add order/position
reconciliation, visible error and stale-run alerts, and an explicit expiry and
assignment policy. A defined terminal payoff assumes both legs remain managed;
it does not remove funding and exercise obligations on a short leg.

## What a portfolio review would require

My assessment is that a manager could reasonably choose these structures for
specific theses, but the current evidence does not support approving every
automatic recommendation. The approval case needs:

- Positive forward expectancy after actual execution costs, by model version
  and structure, against a relevant baseline.
- Contract choices tied to a target, holding horizon, IV scenarios, and
  invalidation, with estimates calibrated separately from market-implied PoP.
- Consistent, enforced portfolio risk limits and stress tests.
- Reliable position lifecycle management, including expirations and assignment.

A high win rate is compatible with either positive or negative expectancy.
Lower win-rate strategies can also be sound when their average gains exceed
their average losses sufficiently. Neither changing a target to make the
reward/risk ratio look better nor selecting the best historical settings proves
an improvement. Freeze the current experiment and evaluate proposed changes
prospectively or on held-out data.

## Reproduce the calculations

Run `node scripts/strategy-risk-audit.mjs` for active exit-gate sensitivities and
the display-sizing example. An optional path to an owner-downloaded
`picks-accuracy.json` adds modeled statistics by structure, quote coverage, and
a Wilson interval for win rate. The script reads local data only, places no
orders, and writes no files. Keep owner snapshots and generated results outside
the public repository.

The interval assumes independent, identically distributed outcomes. It does
not validate payoff estimates, exclude selection bias, or account for changing
models and correlated picks. The reported mean return on maximum loss is an
equal-risk trade statistic, not a portfolio return.

## Sources

- `scripts/build.mjs`: `selectStrategy`, `buildPickContract`,
  `pickContractForPick`, `pickVerticalForPick`, `applyPickSizing`,
  `markOptionToMarket`, `resolvePickOutcome`.
- `scripts/render/app-js.mjs`: `BT_RISK_MAX`, `BT_HEAT_CAP`, portfolio simulator.
- `lib/webull-mirror.mjs`: `buildOrder`, `runWebullMirror`.
- `lib/track-record-fills.mjs`: `realFillMark`, `entryFillCost`.
- [OIC: Bull call spread](https://www.optionseducation.org/strategies/all-strategies/bull-call-spread-debit-call-spread).
- [OIC: Option pricing and strategy mechanics](https://www.optionseducation.org/news/february-office-hours-faqs-option-pricing-strategies-and-market-mechanics).
- [Cboe: Volatility risk premium](https://www.cboe.com/us/indices/dashboard/svrpo/).
- [FINRA: Understanding assignment](https://www.finra.org/investors/insights/trading-options-understanding-assignment).
