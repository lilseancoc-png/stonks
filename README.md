# stonks

Single-page **Option Contract Rater**: pick a curated ticker (or paste numbers
from your broker) and get a plain-English grade on whether the contract is
worth trading.

## What it does

Two ways to grade a contract:

- **From a curated ticker** — choose a name, an expiration, and a strike from
  ~50 high-volume US options. We pull the chain server-side at build time so
  the page itself does zero network calls.
- **Grade your own contract** — paste bid / ask / IV straight off Robinhood,
  Schwab, etc. Symbols like `$3.15`, `3.15 × 55`, `100.81%`, `1,251` are
  cleaned automatically before grading.

For each contract you get:

- **Verdict pill** — Good / Mixed / Poor — and a short "what this means" note.
- **Spread / Delta / Theta chips** with hoverable explainers so the metrics
  aren't gatekept jargon.
- **Greeks** computed locally with Black-Scholes from the implied vol.
- A **freshness banner** at the top shows how old the embedded quotes are and
  switches to a stale-data warning past 36 h.

## How it updates

`.github/workflows/daily.yml` runs `node scripts/build.mjs` on a schedule:

- **09:00 ET (13:00 UTC) weekdays** — pre-market refresh.
- **17:30 ET (21:30 UTC) daily** — end-of-day refresh.

Each run fetches the option chains (with retries on transient Yahoo errors),
embeds them into `index.html`, commits the refreshed file, and deploys to
GitHub Pages. If fewer than 75% of tickers come back, the run fails loud and
the previous good `index.html` keeps serving.

## Running locally

```bash
node scripts/build.mjs
open index.html
```

Requires Node 20+. No API keys.

## Enabling GitHub Pages

In the repo settings → Pages → Source: **GitHub Actions**. The first workflow
run will publish the site.

## Disclaimer

For information only. Not investment advice.
