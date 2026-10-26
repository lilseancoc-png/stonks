# Mingstreet (stonks)

**[mingstreet.app](https://mingstreet.app)** is a free market-research site for
everyday investors. It follows about 85 widely traded, liquid US stocks and
ETFs and explains what is moving them in plain English: the day's market
brief and news, upcoming events, company fundamentals and earnings, options
activity, and the economic backdrop. Data refreshes throughout the trading day.

The code name and repository are **stonks**. For information only; nothing on
the site is investment advice.

## Finding your way around

The site is one page with a sidebar of sections. Each section answers one
question a visitor tends to ask.

| Section | What it answers | Pages |
|---|---|---|
| **Today** | What is happening in the market right now? | Home, Market brief, News, Heatmap, Calendar, Overnight markets |
| **Stocks** | How is a company doing? | All stocks, Look up a stock, Compare stocks, Earnings results, Earnings calls, Who owns what, Pending buyouts, Share sales & buybacks |
| **Market & economy** | What is the big picture? | Market mood (Fear & Greed), Rates & the dollar, Commodities, IPOs & credit, Market themes |
| **Options activity** | Where are traders placing bets? | Unusual options trades, Trading volume, Options walls (gamma exposure), Rising volatility, Strategy builder |
| **Charts & signals** | What do price trends and patterns say? | Moving averages, Up/down streaks, Pattern lab, Earnings ripple effects, Index calendar |
| **Industry trends** | What does real-world data say about the AI and chip trade? | AI spending, Memory chip prices, GPU cloud prices, Central-bank gold, Search trends |
| **Learn & help** | How do I read all this? | Options guide, Chart patterns, When data updates, Privacy Policy, Terms of Use |

An **Owner** section with the private research desks (Top picks, track
record, and others) appears only after an Owner signs in.

Ways to move around:

- **Sidebar** with a filter box. Older page names still work in the filter
  (typing "Fear & Greed" finds Market mood).
- **Search** (⌘K / Ctrl+K, or the magnifier) jumps to any stock, market theme
  or page. With an empty search it lists what you viewed recently.
- **Page header**: every page opens with a "Home / Section / Page" trail, a
  one-line summary of what the page shows, and chips for the other pages in
  its section.
- **Previous / Next** links at the bottom of every page walk through the site
  in sidebar order.
- **Explore by topic** on Home lists every section and its pages.
- **Recently viewed** in the sidebar (kept only in your own browser).
- **Phone tab bar** at the bottom on small screens: Today, Stocks, Market,
  Options and Search. Each button opens the menu at that section.
- **Click any ticker** anywhere on the site to open its full stock report.
- **Pin** pages you use often to the top of the sidebar.

## Reading the charts and numbers

- Green means up and red means down, and every move also carries a ▲ or ▼
  arrow so it reads without colour.
- Sparklines have a soft fill under the line; price charts use round gridline
  values ($200, $210, …).
- Hover or tap any chart for the exact value; on most time-series charts you
  can drag across to measure a change.
- Tables sort by clicking a column header; the Sort menu next to a list always
  takes priority over an earlier header click. Sort, filter and layout choices
  are remembered per device ("Reset saved sorts and views" at the foot of the
  sidebar clears them).
- Each page shows when its data was last updated. A **Stale** tag means the
  data is older than it should be.

## The stock report

Clicking a ticker opens its report (the Grade tab), led by the price chart:

- **Setup**: trend, moving averages, support and resistance, RSI, MACD and
  volume, each with a plain-English label.
- **Contract grade**: pick an expiration and strike (or paste a quote from
  your broker) for a Good / Mixed / Poor read with Greeks, breakeven and
  spread cost.
- **Fundamentals**, **Implied vol** and **News** (an AI-written news take with
  a sentiment tag).
- A live spot price while the market is open, from `/api/quote`.

## How it updates

`.github/workflows/daily.yml` runs `node scripts/build.mjs` on ET-aware
schedules triggered from cron-job.org:

- **08:30 ET weekdays**: pre-market Brief only.
- **09:00 and 19:00 ET weekdays**: earnings-call summaries only.
- **10:00, 11:00, 13:30, 15:30 and 16:10 ET weekdays**: full builds.
- **11:00 and 15:30 ET weekdays**: the Owner decision desks recompute; other
  builds carry them forward.
- **11:00, 13:30 and 16:10 ET weekdays**: Brief refreshes.
- **Friday 11:30 ET**: weekly Alt Data (search trends, memory and GPU prices).

Hourly scans add unusual options flow, volume flags and the heatmap. Data
files live in a private store and are served through `/api/data/*`; the build
commits only the rendered `index.html`, `app.js` and `styles.css`, and that
commit triggers the Vercel deploy. If too few tickers come back from a build,
the run fails and the previous good build keeps serving. The "When data
updates" page on the site lists the full schedule.

## Project layout

- `scripts/build.mjs`: the bake (Yahoo chains and history, technicals,
  Gemini news takes and themes, every data file).
- `scripts/render/`: the page templates. `index.html`, `app.js` and
  `styles.css` are generated from these; never edit the generated files.
  - `site-map.mjs`: the one list of sidebar sections, page names, older names
    and one-line page summaries. The sidebar, page headers, Home tiles, phone
    tab bar and search all read it.
  - `html.mjs`, `app-js.mjs`, `styles-css.mjs`: page shell, browser code and
    styles.
  - `wayfinding-js.mjs` / `wayfinding-css.mjs`: page headers, Previous / Next,
    Explore by topic, Recently viewed, phone tab bar.
  - `data-display-css.mjs`: the shared chart and number styling.
  - `views-client.mjs`: shared sorting, Cards / Table switch and compare tray.
  - `docs.mjs`: the Options guide, Chart patterns, Privacy and Terms pages.
- `api/`: Vercel functions (live quotes and chains, the gated data reader,
  Owner sign-in).
- `lib/`: shared helpers used by the build and the API.
- `scripts/*-smoke.mjs`: test scripts (`npm run test:render`,
  `npm run test:site-map`, and the others listed in `package.json`).

See `CLAUDE.md` for the full architecture notes.

## Running locally

```bash
npm install

# Re-render index.html / app.js / styles.css from an existing data/ folder
# (no Yahoo, no Gemini). Use this after changing anything in scripts/render/.
node scripts/regen-static.mjs

# Full rebuild (fetches from Yahoo; GEMINI_API_KEY is optional).
node scripts/build.mjs

# Serve the static site...
python3 -m http.server 8000
# ...or the full stack, including /api/quote
npx vercel dev
```

Requires Node 20+. With the private data store enabled, run
`node scripts/sync-data.mjs pull` first to hydrate `data/`.

## Deployment

The site is hosted on **Vercel**; a push to `main` deploys it. See
`docs/private-data-migration.md` for the private data store and Owner
sign-in settings.

The Supabase portfolio feature (`js/portfolio.js`, `api/portfolio-review.js`,
`supabase/schema.sql`) is dormant: the code is kept but no page loads it.

## Disclaimer

For information only. Not investment advice. Analysis is AI-generated or
algorithmic and may be wrong; verify independently.
