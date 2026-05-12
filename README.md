# stonks

Single-page **Option Contract Rater**: pick a curated ticker (or paste numbers
from your broker) and get a plain-English grade on whether the contract is
worth trading.

## What it does

Two ways to grade a contract:

- **From a curated ticker** — choose a name, an expiration, and a strike from
  ~50 high-volume US options. We pull each chain server-side at build time and
  ship them as static `data/<SYMBOL>.json` files alongside the page; the
  browser fetches one only when you pick a ticker (and caches it in memory).
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

Above the grader, an **Active market narratives** card surfaces the themes
currently driving the curated tickers — AI capex, GLP-1, tariffs, election
trades, geopolitical defense plays, etc. Each narrative shows a one-sentence
thesis, the longs and shorts from the curated list that ride it, a confidence
tag, and a lifespan badge (how many days the story has been live). When you
load a ticker, chips show which narratives that ticker sits inside. A
"recently cooled off" line tracks themes that dropped out of the feed so you
can see trends come and go. The list is rebuilt each daily refresh from the
per-ticker AI news takes, persisted to `data/trends.json`, with a rolling
90-day snapshot archive in `data/trends-history.json`.

## How it updates

`.github/workflows/daily.yml` runs `node scripts/build.mjs` on a schedule:

- **09:00 ET (13:00 UTC) weekdays** — pre-market refresh.
- **17:30 ET (21:30 UTC) daily** — end-of-day refresh.

Each run fetches the option chains (with retries on transient Yahoo errors),
writes them to `data/<SYMBOL>.json`, regenerates `index.html` with the
ticker manifest, commits both, and deploys to GitHub Pages. If fewer than 75%
of tickers come back, the run fails loud and the previous good build keeps
serving.

## Running locally

```bash
node scripts/build.mjs
# Serve over HTTP so the page can fetch data/<SYMBOL>.json
# (browsers block fetch() on file:// URLs).
python3 -m http.server 8000
# then open http://localhost:8000/
```

Requires Node 20+. No API keys.

## Enabling GitHub Pages

In the repo settings → Pages → Source: **GitHub Actions**. The first workflow
run will publish the site.

## Disclaimer

For information only. Not investment advice.
