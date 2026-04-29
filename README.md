# stonks

A one-stop daily hub for U.S. stock earnings and the day's biggest movers.

## What it shows

- **Earnings Today** — companies reporting before market open or after close (Nasdaq earnings calendar).
- **Top Gainers / Top Losers / Most Active** — biggest movers of the session (Yahoo Finance predefined screeners).

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

For information only. Not investment advice.
