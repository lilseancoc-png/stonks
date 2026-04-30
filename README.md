# stonks

A one-stop daily hub for U.S. options traders: earnings, biggest movers,
volatility snapshot, sector performance, and an AI stock assistant.

## What it shows

- **Volatility & Indexes** — VIX, VVIX, SPY, QQQ, IWM, DIA snapshot. Click any
  tile to open its option chain on Yahoo.
- **Call Plays** — top gainers ranked by move size × volume conviction. Only
  liquid names ($500M+ market cap). Each card shows reasoning chips (earnings
  today, active list, big move, etc.) and links directly to the options chain.
- **Put Plays** — top decliners ranked by drop size × volume conviction, same
  scoring and liquidity filter as Call Plays.
- **Earnings Vol Plays** — earnings names already moving on volume. High-IV
  directional or straddle setups. IV typically crushes after the report.
- **Earnings Today** — companies reporting before market open or after close
  (Nasdaq earnings calendar). Each ticker links to its option chain.
- **Upcoming Earnings** — earnings calendar for the next two trading days so
  you can plan trades ahead of time. Chips are colour-coded BMO (before market
  open) and AMC (after market close).
- **Sector Performance** — SPDR sector ETFs (XLK, XLF, XLE, XLV, XLY, XLC,
  XLI, XLP) with daily % change for rotation/strength context.
- **Live Watchlist** — TradingView market overview widget showing live prices
  and mini-charts for SPY, QQQ, IWM, NVDA, AAPL, MSFT, META, AMZN, GOOGL,
  TSLA, AMD, COIN. Quick-link buttons jump straight to each symbol's options
  chain on Yahoo.
- **Top Gainers / Top Losers / Most Active** — full mover tables.
- **AI Stock Assistant** — floating chat button (bottom-right). Powered by
  Pollinations.ai (free, no API key). If that service is unavailable, enter
  your own [Anthropic API key](https://console.anthropic.com/keys) — it is
  stored only in your browser. Today's full market context (call/put plays,
  earnings vol, sector data, movers) is baked into the system prompt.

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
