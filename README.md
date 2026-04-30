# stonks

A one-stop daily hub for U.S. options traders: earnings, biggest movers,
volatility snapshot, sector performance, and an AI stock assistant.

## What it shows

- **Volatility & Indexes** — VIX, VVIX, SPY, QQQ, IWM, DIA snapshot. Click any
  tile to open its option chain on Yahoo.
- **Sector Performance** — SPDR sector ETFs (XLK, XLF, XLE, XLV, XLY, XLC,
  XLI, XLP) with daily % change to spot rotation and relative strength.
- **Live Watchlist** — TradingView market overview widget showing live prices
  and mini-charts for SPY, QQQ, IWM, NVDA, AAPL, MSFT, META, AMZN, GOOGL,
  TSLA, AMD, COIN. Quick-link buttons below each symbol jump straight to its
  Yahoo options chain.
- **Momentum Plays** — top gainers ranked by move size × volume conviction.
  Highest-scoring stocks are shown as cards that link directly to their options
  chain.
- **Earnings Today** — companies reporting before market open or after close
  (Nasdaq earnings calendar). Each ticker links to its option chain.
- **Upcoming Earnings** — earnings calendar for the next two trading days so
  you can plan trades ahead of time. Chips are colour-coded BMO (before market
  open) and AMC (after market close).
- **Top Gainers / Top Losers / Most Active** — biggest movers of the session.
- **AI Stock Assistant** — floating chat button (bottom-right). Free, no API
  key required. Powered by Pollinations.ai. Today's full market context (earnings,
  movers, volatility) is baked into the system prompt.

The page is a static `index.html` regenerated twice daily.

## How it updates

`.github/workflows/daily.yml` runs `node scripts/build.mjs` on a schedule:

- **09:00 ET (13:00 UTC) weekdays** — pre-market snapshot before the open.
- **17:30 ET (21:30 UTC) daily** — end-of-day refresh after the US market close.

The workflow commits the refreshed `index.html` and deploys to GitHub Pages.
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

For information only. Not investment advice.
