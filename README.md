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
- **Premium make-up** — intrinsic value, time (extrinsic) value, breakeven at
  expiry, moneyness %, and a rough probability-ITM estimate from |delta|.
- **Technical signals on the underlying** — when you pick a curated ticker, a
  separate card shows the stock's **RSI(14)**, **MACD(12, 26, 9)** (line,
  signal, histogram), and **20-/50-day support and resistance** levels with
  the % distance to spot. Each indicator carries a plain-English state
  label (Overbought / Bullish cross / etc.) and a one-liner on what it means
  for an options trader. Computed at build time from ~6 months of Yahoo daily
  closes.
- **AI news take** — a 2-4 sentence read on what is driving the stock right
  now, with a sentiment tag that nudges a borderline verdict.
- A **freshness banner** at the top shows how old the embedded quotes are and
  switches to a stale-data warning past 36 h.

### Lazy loading

The first paint ships only a small manifest (ticker list, sectors, spots,
active narratives) — about 30 KB. Per-ticker data — option chain, AI news
take, and the technical indicators — lives in `data/<SYMBOL>.json` and is
fetched **only** when the user picks that ticker from the combobox. The fetch
goes through `force-cache`, so re-selecting the same ticker is free for the
rest of the session.

### Live intraday spot

While the chain, news, and technicals are baked twice a day, the **spot
price** is refreshed on the fly. When you pick a ticker, the page also hits
`/api/quote?symbol=XXX` — a small Vercel serverless function in
`api/quote.js` that proxies Yahoo's quote endpoint server-side (the
consent-cookie / crumb handshake can't run from a browser). A "Live" pill
appears next to the ticker with the current spot + day change, and the
Greeks / breakeven / moneyness / ATM strike pick all recompute against the
live number.

The live fetch is non-blocking: the baked snapshot paints first, then the
live update slides in. If the endpoint or Yahoo is down — or if the market
is closed — the page silently falls back to baked data. A 30-second
in-browser cache plus a 30-second Vercel edge cache prevent rapid re-selects
from re-firing the call.

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

Each run fetches the option chains and ~6 months of daily history per ticker
(with retries on transient Yahoo errors), computes RSI / MACD / 20- and
50-day support and resistance from the closes, writes everything to
`data/<SYMBOL>.json`, regenerates `index.html` with the ticker manifest,
and commits. Vercel picks up the commit and ships the new bundle. If fewer
than 75% of tickers come back, the run fails loud and the previous good
build keeps serving. The technicals step is non-fatal — if the chart
endpoint hiccups for a single ticker, that ticker simply ships without the
indicator card.

The intraday gap between builds is covered by the live-quote endpoint
described above — chain quotes and Greeks recompute against the live spot
the moment you pick a ticker.

## Running locally

```bash
# Refresh the baked per-ticker JSON.
node scripts/build.mjs

# (a) Static-only — chain/news/technicals work; live spot does not.
python3 -m http.server 8000
# then open http://localhost:8000/

# (b) Full stack — also serves the /api/quote function locally.
npx vercel dev
# then open http://localhost:3000/
```

Requires Node 20+. No API keys for the static side; `GEMINI_API_KEY` is
optional and enables the AI news takes during a build.

## Deployment

The site is hosted on **Vercel** — push to `main` and Vercel auto-deploys
both the static files and the `api/quote.js` function. The GitHub Actions
workflow at `.github/workflows/daily.yml` runs the build on a cron, commits
the refreshed `data/`, `index.html`, `app.js`, and `styles.css`, and that
commit triggers the next Vercel deploy.

To set it up on a fork: **vercel.com → Add New → Project → Import Git
Repository → stonks**. Defaults (root directory, no framework preset,
`npm install` as the install command) are correct. No environment variables
are needed for the live-quote endpoint to work.

## Disclaimer

For information only. Not investment advice.
