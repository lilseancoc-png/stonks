# Valuation lab (Owner, 2026-11-17)

Owner · Research → **Valuation lab** (`?tab=valuation-lab`, `&symbol=NVDA` opens one stock).

A stock price is what the last buyer paid. This page asks what a stock is worth under
assumptions the Owner chooses, compares that with the market price, and works backwards
to show what the market price is assuming.

## Methods

All five run on one set of inputs (`valuationLabFactory` in `lib/valuation-lab.mjs`).

| Method | What it does | Rate-sensitive |
|---|---|---|
| Cash flow (DCF) | Trailing revenue grown for N years (first-year growth fading in a straight line to long-run growth) × a free-cash-flow margin (today's margin plus a drift), discounted at a WACC: cost of equity = 10-year yield + shock + beta × equity risk premium; debt at 10-year + spread, after 21% tax. Terminal value by the Gordon formula. Off for banks and brokers. Refused when the discount rate is within 1 point of long-run growth. | Yes |
| Earnings path | Forward EPS (price / forward P/E, else the analysts' +1y EPS, else trailing) grown 3 years at the EPS growth input, sold at the exit P/E, discounted at the cost of equity, plus dividends at today's payout ratio. | Yes |
| Peer multiples | Peer medians from `valuation-bands.json` (forward P/E, EV/sales, price/sales; EV/sales skipped for banks) × (1 + premium) applied to this company; the median of the three. | No |
| Earnings power | Two-stage payout model: payout = 1 − growth / ROE, discounted at the cost of equity, Gordon terminal. Works for banks. | Yes |
| Street target | Analysts' mean target (low to high shown). | No |

The blend is the weighted mean of the methods that produce a positive value (weights
normalize over those). Defaults: DCF 30, earnings 25, peers 25, earnings power 10,
street 10; banks/brokers 0/30/30/30/10; early-stage (no earnings) 40/0/45/0/15.

**Macro dials.** Dollar and oil moves shift the blend by the stock's measured response
from the Market Analysis scenario layer (`sensitivities[].vector.usd` / `.commodity`),
capped at ±30%. A 10-year yield shock goes through every discount rate instead, so rates
are never counted twice; the stock's measured rate response (`rate10y`, % per 10bp) is
shown beside it as a check.

## The gap read

- **What today's price assumes** (solved by bisection, everything else held): first-year
  growth, FCF margin and equity risk premium that make the DCF equal the price; the exit
  P/E and EPS growth that make the earnings path equal it; the premium to peers.
- **Where the methods disagree**: the spread, the method closest to the price, the input
  that moves the answer most (each input nudged by a fixed step, ranked by swing).
- **What the market may be seeing**: estimate revisions, the site grade and macro fit,
  short interest, days to earnings, the forward P/E against its own saved range, the
  Earnings Forecast quarter.
- **What the model may be missing**: bank / early-stage / cash-burn caveats, terminal
  value share over 75%, thin peers, non-USD reporting, and what no model here sees.

Also on the page: a football field (each method's value and its range across rates
±100bp and growth ±6 points), a rate × growth grid of the blend, scenario buttons
(bear, bull, rates ±100bp, recession), and a table of every covered stock at defaults.

## Data and switches

- Bake: `buildValuationLab` in `scripts/build.mjs`, right after the grade index, writes
  the Owner-only `valuation-lab.json` (one row of inputs per non-ETF stock plus the base
  result). Inputs: per-ticker fundamentals, `valuation-bands.json` peers, the scenario
  sensitivities, the grade index, `earnings-forecast.json`, the 10-year / 2-year yields
  and the 3-month bill. No fetch, no AI call.
- Kill switch: `VALUATION_LAB=0` (Owner Settings → Research). Off writes nothing; the
  stored copy stays as it was.
- The page recomputes in the browser with the same factory (pasted with `toString()`);
  input changes are kept per device in `stonks-valuation-v1`.
- MCP: `value_stock` (Owner) runs the same code with optional `inputs` and `weights`.
- Display only: nothing here feeds a grade, a gate, a pick or the Track Record.
- Tests: `node scripts/valuation-lab-smoke.mjs`, `node scripts/valuation-lab-browser.mjs`.
