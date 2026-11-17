# Valuation lab (Owner, 2026-11-17)

Owner · Research → **Valuation lab** (`?tab=valuation-lab`, `&symbol=NVDA` opens one stock).

A stock price is what the last buyer paid. This page asks what a stock is worth under
assumptions the Owner chooses, compares that with the market price, and works backwards
to show what the market price is assuming. It then puts the company next to its own last
year and next to the analysts, and lists what the analysts or the model may be missing.

## Methods

All eight run on one set of inputs (`valuationLabFactory` in `lib/valuation-lab.mjs`,
`VALUATION_LAB_VERSION` 2).

| Method | What it does | Rate-sensitive |
|---|---|---|
| Cash flow (DCF) | Trailing revenue grown for N years (first-year growth fading in a straight line to long-run growth) × a free-cash-flow margin (today's margin plus a drift), discounted at a WACC: cost of equity = 10-year yield + shock + beta × equity risk premium; debt at 10-year + spread, after 21% tax. Terminal value by the Gordon formula. Off for banks and brokers. Refused when the discount rate is within 1 point of long-run growth. | Yes |
| Earnings path | Forward EPS (price / forward P/E, else the analysts' +1y EPS, else trailing) grown 3 years at the EPS growth input, sold at the exit P/E, discounted at the cost of equity, plus dividends at today's payout ratio. | Yes |
| Peer multiples | Peer medians from `valuation-bands.json` (forward P/E, EV/sales, price/sales; EV/sales skipped for banks) × (1 + premium) applied to this company; the median of the three. | No |
| Own-history multiples | The stock's own median forward P/E, EV/sales and price/sales over its saved sessions in `valuation-bands.json` (needs 20+ sessions) applied to today's numbers; the median of the three. | No |
| Growth-adjusted P/E (PEG) | Fair P/E = fair PEG × EPS growth (growth capped at 40), × forward EPS. Off below 3% growth. The peer median PEG (Yahoo) is the default. | No |
| Earnings power | Two-stage payout model: payout = 1 − growth / ROE, discounted at the cost of equity, Gordon terminal. Works for banks. | Yes |
| Book value + excess returns | Residual income: book value per share (price / P/B) plus the discounted excess of ROE over the cost of equity, fading at 0.6 a year. Off when P/B is over 25 (book means little there). | Yes |
| Street target | Analysts' mean target (low to high shown). | No |

The blend is the weighted mean of the methods that produce a positive value (weights
normalize over those). Defaults: DCF 25, earnings 20, peers 20, own history 10, PEG 5,
earnings power 5, book 5, street 10; banks/brokers 0/20/25/5/0/20/20/10; early-stage (no
earnings) 35/0/35/15/0/0/0/15.

## Inputs (30)

- **Rates and risk:** 10-year yield, rate shock, equity risk premium, beta, borrowing spread.
- **Growth:** first-year revenue growth, years of above-normal growth, growth forever after.
- **Earnings:** EPS growth, earnings surprise / recession hit, FCF margin, margin drift, ROE.
- **Multiples:** exit P/E, peer premium, fair PEG.
- **Economy and markets:** S&P 500 move (× the stock's beta), dollar and oil moves (the
  Market Analysis scenario layer's measured sensitivities, `sensitivities[].vector.usd` /
  `.commodity`; the oil one is scaled by 0.35 per 1% of oil, as the scenario layer does,
  `OIL_DAMP`). The market, dollar, oil and party moves together are capped at ±45%.
  A rate shock goes through every discount rate instead, so rates are never counted twice;
  the stock's measured rate response (`rate10y`, % per 10bp) is shown beside it as a check.
- **Policy and politics:** corporate tax change (points off the 21% federal rate, applied to
  the US share of profit), tariff cost (points of revenue, after tax, against today's net
  margin), foreign sales lost to retaliation (applied to the non-US share), party-in-power
  tilt. The US share comes from the SEC geographic split; 60% when unknown, and the page
  says so.
- **Odds for the range:** chance of a recession (Kalshi's recession market from the Crowd
  desk, else 15%). Only the range of outcomes uses it.

## Environments (28)

One click sets several inputs at once (added to the current defaults; the note says what
moved). Quick: defaults, bear, bull, rates ±100bp, recession. Economy: soft landing,
stagflation, boom, deflation scare. Rates and the Fed: cutting cycle, higher for longer,
bond selloff. Market mood: bubble, bear market (S&P −20%), credit crunch. Policy and
politics: tariff escalation, trade deal, tax cut to 15%, tax hike to 28%, Democratic or
Republican sweep, and the two split governments. Oil and the dollar: oil ±40%, dollar ±8%.

The party scenarios read the Party tracker (`party-tracker.json`): the stock's sector ETF
(`KIND_PARTY_ETF`) return against the S&P 500 a year while each party held each branch,
weighted 0.5 president, 0.25 House, 0.25 Senate (`partyTiltFor`). The stock's kind comes
from the grade's macro fit, or from `macroContextKindOf` when the macro context is off. They are history, not a
forecast, and the page says so. They are hidden when the party data is missing.

## Range of outcomes

300 seeded draws (the seed is the symbol, so the same inputs give the same picture) move
growth, margin, the risk premium, rates, the exit P/E and the peer premium by a typical
amount around the inputs; the recession case is applied to the share of draws the
recession odds say. Shown as a histogram with the 10th / 50th / 90th percentiles, the
share of draws worth more than the price, and a comparison with the one-year range option
prices imply (IV from `ivRank`). The table of every covered stock uses 200 draws.

## The story

- **Five views of the same company:** revenue growth, EPS growth and forward P/E as of
  last year (trailing four quarters vs the four before; own median P/E), the analysts
  (next fiscal year; peer median P/E), our Earnings Forecast (the quarter vs a year
  earlier, from filed numbers), what today's price implies and your input.
- **Then vs now:** revenue, net income, net margin, free cash flow, EPS and the own-history
  multiples, last four quarters vs the four before, plus revenue growth by quarter.
- **The analysts' record:** the last four EPS estimates vs actuals, the beat count since
  the first stored print, estimate revisions and raises/cuts, the target range, our
  forecast vs the analysts' same-quarter estimate (within 20 days of the quarter end) and
  the shareholder yield. "Assume the usual surprise" moves the earnings input by the
  average surprise.
- **What the analysts may be missing:** a beat habit, estimates still catching up, our
  forecast vs theirs (our EPS is GAAP, theirs usually adjusted, so revenue is the cleaner
  read), buybacks.
- **What our model may be missing:** the P/E near the top or bottom of its own range, the
  options' implied move, the usual earnings-day move, a model far from the analysts'
  target and which growth input explains it.

## The gap read

- **What today's price assumes** (solved by bisection, everything else held): first-year
  growth, FCF margin and equity risk premium that make the DCF equal the price; the exit
  P/E and EPS growth that make the earnings path equal it; the premium to peers; the PEG
  the price works out to.
- **Where the methods disagree**: the spread, the method closest to the price, the input
  that moves the answer most (each input nudged by a fixed step, ranked by swing).
- **What the market may be seeing**: estimate revisions, the site grade and macro fit,
  short interest, days to earnings, the forward P/E against its own saved range, the
  Earnings Forecast quarter, today's party mix and its sector history.
- **What the model may be missing**: bank / early-stage / cash-burn caveats, terminal
  value share over 75%, thin peers, non-USD reporting, an unknown US share, and what no
  model here sees.

Also on the page: a football field (each method's value and its range across rates
±100bp and growth ±6 points, plus the options' one-year range), a rate × growth grid of
the blend, and a table of every covered stock at defaults with the share of draws worth
more than the price.

## Data and switches

- Bake: `buildValuationLab` in `scripts/build.mjs`, right after the grade index, writes
  the Owner-only `valuation-lab.json` (one row of inputs per non-ETF stock plus the base
  result and story). Inputs: per-ticker fundamentals, quarterly history, earnings history,
  revisions, segments and `ivRank`; `valuation-bands.json` peers and own medians; the
  scenario sensitivities; the grade index; `earnings-forecast.json`; the Party tracker;
  the Crowd desk's Kalshi recession odds; the 10-year / 2-year yields and the 3-month
  bill. No fetch, no AI call.
- Kill switch: `VALUATION_LAB=0` (Owner Settings → Research). Off writes nothing; the
  stored copy stays as it was.
- The page recomputes in the browser with the same factory (pasted with `toString()`, so
  no backslashes, backticks or outside names in it, comments included); input changes
  are kept per device in `stonks-valuation-v1`. An environment button moves the economic
  inputs and keeps the method weights you set. The Inputs panel sits beside the results
  on a wide screen and is folded above them on a phone (its heading counts the changed
  inputs); `?symbol=` follows the stock on screen.
- MCP: `value_stock` (Owner) runs the same code with optional `inputs`, `weights` and
  `scenario`, and returns the range and the story too (`scenario` in the result is null
  when the one asked for does not exist for that stock).
- Display only: nothing here feeds a grade, a gate, a pick or the Track Record.
- Tests: `node scripts/valuation-lab-smoke.mjs` (includes 400 rows with blank, zero,
  negative or junk fields: no throw, no raw values in the text), `node
  scripts/valuation-lab-browser.mjs`.
