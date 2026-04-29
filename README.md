# stonks

A one-stop daily hub for U.S. options traders: earnings, biggest movers,
volatility snapshot, and an in-page Black-Scholes calculator.

## What it shows

- **Volatility & Indexes** — VIX, VVIX, SPY, QQQ, IWM, DIA snapshot. Click any
  tile to open its option chain on Yahoo.
- **Earnings Today** — companies reporting before market open or after close
  (Nasdaq earnings calendar). Each ticker links to its option chain.
- **Top Gainers / Top Losers / Most Active** — biggest movers of the session.
  Each row has a `→ calc` button that loads the symbol + spot into the pricer.
- **Black-Scholes Options Calculator** — client-side pricer for calls and puts
  with continuous dividend yield. Outputs price, delta, gamma, theta (per day),
  vega (per 1% IV), rho (per 1% rate), 1σ expected move, and break-even.

The page is a static `index.html` regenerated daily.

## How it updates

`.github/workflows/daily.yml` runs `node scripts/build.mjs` on a schedule
(21:30 UTC daily, just after the U.S. market close), commits the refreshed
`index.html`, and deploys the page to GitHub Pages.

You can also trigger it manually from the Actions tab (`workflow_dispatch`).

## Running locally

```bash
node scripts/build.mjs
open index.html
```

Requires Node 20+. No API keys, no dependencies.

## Enabling GitHub Pages

In the repo settings → Pages → Source: **GitHub Actions**. The first run of the
workflow will publish the site.

## Disclaimer

For information only. Not investment advice. The Black-Scholes calculator is a
theoretical pricing model — real option prices reflect supply/demand, skew,
and discrete dividends, and may diverge from model output.
