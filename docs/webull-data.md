# Webull daily data (2026-11-19)

The Webull data runner saves option prices from Webull's official OpenAPI once
a day after the close, for the research history tests. It is Owner-only, makes
no AI call, uses no paid feed and changes no pick, grade, gate, engine or track
record. Wave 2 build B ("option price saver") is its first job set; later jobs
(order flow, breadth, backups; W3, below) plug into the same runner.

## How it runs

```
GitHub cron (16:40 ET) -> scripts/webull-data-trigger.mjs
   -> POST /api/auth/webull-data (bearer derived from R2_SECRET_ACCESS_KEY)
      -> lib/webull-data/runner.mjs runWebullData() under the R2 lease "webull-data"
         -> each job: plan -> one Webull call per item -> save to R2
   <- { more, waitMs, counts }   (pings again until more is false or 50 minutes pass)
```

- **Workflow** `.github/workflows/webull-data.yml`: two UTC crons (`40 20` and
  `40 21`, Mon-Fri); `routeRun` keeps only the one that is 16:40 ET and skips
  NYSE holidays (`lib/us-equity-calendar.mjs`). Manual dispatch inputs:
  `backfill` (`auto` / `1` / `0`) and `minutes` (the ping window, default 50).
  The log prints counts and fixed labels only (never a ticker, price or account
  value). Its own concurrency group `stonks-webull-data`, so it never waits on
  or blocks the data workflows. Runs only when the repo variable
  `PRIVATE_DATA_ENABLED` is `1`. No new secret: it reuses `R2_SECRET_ACCESS_KEY`
  to derive the bearer (`lib/webull-data/trigger.mjs`, HMAC label
  `webull-data-trigger:v1`, different from the mirror's).
- **Vercel action** `webull-data` in `api/auth/[action].js` (no new function).
  POST = one ping (at most about 40 seconds of work; the function limit is 60).
  GET with an Owner session = the status view the Webull tab shows. 404 unless
  `PRIVATE_DATA_ENABLED=1`. A second ping while one runs answers
  `{ more: true, reason: "runner already running" }`.
- **Client**: `lib/webull-client.mjs` `get(path, query)`, the same signed,
  host-locked sandbox client as the paper mirror. `get` refuses any path that is
  not under `/market-data/` or `/trading/instruments/`, so the runner can never
  place or cancel an order.
- **Rate**: every endpoint group is kept to 24 calls a minute (Webull's paper
  keys allow 30). A job may lower its group with `rpm`. An HTTP 429 cools the
  group for 60 seconds and retries the item; other errors retry three times
  (a 417 rejection does not retry), then count as a miss with a fixed label.
- **Cursor**: the runner state (`state.json.gz`) keeps each job's queue, the
  per-group call times and 40 days of daily summaries, so a later ping carries
  on where the previous one stopped. A day is `date:phase`; a run before the
  open or on a closed day saves the previous session.

## Job interface

`lib/webull-data/jobs/<id>.mjs`, listed in run order in `jobs/index.mjs`:

```js
{ id, switchKey, group, rpm?,
  plan(state, ctx)          // -> items ([] = done for the day)
  run(item, client, ctx)    // -> records, or { records, more: [items] }
  save(records, store, ctx) // -> optional { more: [items] } }
```

One item is one Webull call (`item.group` overrides `job.group`; group `null` =
local work, no call). `more` goes to the front of the job's queue. `state` is
the job's own object, kept across days (also `ctx.state` in run and save).
`ctx` carries `date`, `phase`, `nowMs`, `store`, `options`, `count(name, n)`,
`miss(label, n)`, `tickers` (the covered names) and `funds`.

## Jobs in this build

1. **option-expiry** (switch `WEBULL_OPTION_SAVER`, group `option-bars`) runs
   first, because its contracts are the ones Webull deletes soonest (the
   2026-11-19 probe: a contract 6 days past expiry still had all its daily
   bars; every contract 13+ days past answered `INVALID_SYMBOL`). For every
   registry contract that expired 1 to 5 sessions ago and is not saved yet, it
   fetches the full daily bar history (1,200 bars, 20 contracts a call) and
   saves one object per contract, oldest expiry and at the money first. A batch
   that answers `INVALID_SYMBOL` is split in halves until the deleted contract
   is found; deleted contracts are remembered and never asked again.
2. **option-snapshots** (switch `WEBULL_OPTION_SAVER`, groups `stock-snapshot`,
   `option-contracts`, `option-snapshot`): for every covered name (`TICKERS`
   plus the Macro engine's funds, `lib/webull-data/universe.mjs`), one stock
   snapshot for the spot, the contract list within 20% of spot, then option
   snapshots (20 contracts a call) for standard 100-share contracts 7 to 400
   days out, nearest the money first (distance scaled by time to expiry), up to
   12,000 contracts a day shared across the names. Every contract an open Top
   Pick or engine trade holds is always included, even outside the band. Each
   saved contract joins the expiry registry, which the expiry saver reads after
   it expires.
   - **First-run backfill** (once, or with `backfill=1`): Webull cannot list
     expired contracts, so the job builds their symbols from today's strikes.
     For every Friday expiry of the last 8 days (every session for SPY, QQQ and
     IWM), it asks one at-the-money contract first; if Webull still answers,
     the rest of that date's strikes are fetched. It also registers this week's
     contracts (under 7 days), so they are saved after they expire.

## W3: order flow, breadth and backups (2026-11-19)

Three more jobs on the same runner, after the two option jobs. Each saves one
Owner-only key under `data/` (request-time-exclusive, so no workflow pushes or
deletes it; `sync-data pull` hydrates it for the bake, which reads it before
the wipe through `readWebullW3` in `lib/webull-data/bake.mjs`). A read or parse
error on the stored key stops the save instead of overwriting the log
(`readKey` in `jobs/w3-shared.mjs`). Webull's terms (section 5) do not allow
republishing, so nothing here reaches a public page, the public Brief, the
public MCP or the Owner MCP; `lib/webull-data/mcp-scrub.mjs` also strips the
Webull values the bake copies into other Owner files (shadow keys, the Bottom
tracker row, a backup street target) before any MCP tool sees them.

### C: order flow (`webull-flow.json`, switch `WEBULL_FLOW_LOG`)

- One call per covered name (`TICKERS`) a day:
  `/market-data/fundamentals/capital-flows/get` (`symbol`, `category=US_STOCK`,
  `count=5`), group `capital-flow`. The last five sessions are upserted by date,
  so a missed day is filled by the next run. About 80 calls a day.
- Kept: `[date, largeIn, largeOut, mediumIn, mediumOut, smallIn, smallOut]` per
  session in dollars, about 400 sessions per name. A name Webull refuses (an
  ETF it has no flow for) is logged as a miss with a fixed reason.
- Shadow keys (`lib/shadow-signals.mjs` version 8): `wfl` (large-order net as a
  % of everything traded, the session before the bake's date), `wft` (all sizes
  net, %), `wfl5` (large net over the last five sessions, %). Nothing scores;
  the Evidence board row "Webull order flow: logging, test after about 3
  months" turns ready after 63 logged sessions (`w3EvidenceTests`).
- Shown on the stock page's Owner tab (Top Picks trades): net money in by order
  size, the last 10 sessions and the five-session line. Not a vote.

### D: breadth (`webull-breadth.json`, switch `WEBULL_BREADTH_LOG`)

- `/market-data/screeners/market-sectors/list` (advancers, decliners and flat
  per Webull sector, paged), then each sector's
  `/market-data/screeners/market-sectors/get` detail pages, each stock's change
  bucketed into the nine breadth-chart ranges (at most `WEBULL_BREADTH_PAGES`,
  default 40, pages a sector; a sector cut short marks the day's histogram
  partial), then seven screener lists: gainers and losers
  (`gainers-losers/list`), most active (`top-actives/list`) and new and near
  52-week highs and lows (`week52-high-low/list`). Group `screeners`. The lists
  stop at 200 rows, so a full list is shown as "200+" and is not used as a
  number in the gauges.
- Kept: today's sectors, buckets and the top 50 rows of each list, plus one
  history row per session (about 400).
- Owner context on Market analysis (the "Whole-market breadth (Webull)" block),
  labeled as a different, wider source than the wide tier's S&P 500 +
  Nasdaq-100 breadth.
- A non-voting Bottom tracker context row (`breadthContextRow`): washout when
  30% or fewer of movers rose or new lows (50+) are at least twice new highs,
  stretched at 70%+ up with highs at least twice lows.
- Market shadow gauges: `wbAdv` (% of movers up), `wbHL` (new highs minus new
  lows, only when neither list is capped), `wbUp5` (share of traded stocks up
  5%+ minus down 5%+, only from a complete histogram). Evidence row
  "Webull breadth".

### E: backups (`webull-backup.json`, switch `WEBULL_BACKUPS`)

- Each covered stock's earnings calendar (every day), analyst ratings and price
  target (a fifth of the names a day, so each refreshes weekly), Webull's Fear
  & Greed reading and the US economic calendar for the next 30 days. Group
  `fundamentals` (Fear & Greed in `screeners`). About 115 calls a day.
- A Webull value is used only when the main source has none, and is labeled
  "backup source":
  - **Earnings date** for the Top Picks decision only (a stock with no Yahoo or
    Nasdaq date and a Webull date in the next 30 days). It is applied on a copy
    of the chains map passed to the Top Picks build, so no public file carries
    it. **This can change which trades open** (the earnings-window rules read
    it), which is why it ships behind its own switch. Since the data
    integration pass (2026-11-19) the strategy engines read the same date
    (`earningsBackupMap`, passed to `runEngines` as `earningsBackup`) for a
    stock whose earnings history has no upcoming report: it only holds back
    new engine entries near the report (Reversion stands aside two sessions
    before it, Fundamentals holds off six), never opens the Earnings engine's
    run-in trade on its own, and is listed on the engines page's data check.
  - **Street target** on the Valuation lab when Yahoo has no mean target
    (source `webull-backup`, shown "backup source (Webull)"; the MCP drops it).
  - **Fear & Greed** stands in for CNN's reading only in the strategy engines,
    only when CNN failed this bake, and only after a check proves Webull's
    index is CNN's (4+ shared dates, every gap within 1.5 points). Until then it
    is shown as context.
  - **Economic calendar** dates are compared with ours, never used.
- Disagreements (earnings dates more than a day apart, release dates that
  differ) and every fill are written to `webull-backup-check.json` (Owner-only,
  bake-written) and shown in the Market analysis block's "Backup sources"
  panel.

### W3 budget (estimates until the first live run)

About 80 flow calls, 9 list calls plus 2+ sector-list pages and one detail page
per 20 stocks a sector (likely 300+ calls, the biggest part, about 14 minutes
at 24 a minute), and about 115 backup calls a day, on top of the option jobs.
The status block on the Track Record's Webull tab counts them
(`flow-names`, `breadth-records`, `backup-records`). Webull's sector lists may
overlap; if they do, a stock in two sectors is counted twice in the
histogram. Both are checked on the first live run.

## Storage

Raw internal records in R2, never synced to `data/`, never served by `/data`,
never read by the MCP:

| Key under `_stonks/webull-data/v1/` | What |
|---|---|
| `state.json.gz` | runner cursor, job states, 40 days of summaries |
| `options/snapshots/<date>/<SYM>.json.gz` | one name-day of option snapshots |
| `options/registry/<expiry>.json.gz` | contracts seen per expiry (`u` underlying, `m` moneyness rank, first / last day seen) |
| `options/expired/<expiry>/<OCC>.json.gz` | one expired contract's daily bars |

Snapshot rows use the shared research row shape (`date, symbol, expiry, strike,
right, bid, ask, iv, delta, gamma, vega, theta, source`) plus `underlying, spot,
last, volume, oi, bid_size, ask_size, rho, quote_time, delay_min, stale, wide`.
`stale` = the quote is 30+ minutes older than the newest quote for that name;
`wide` = no two-sided market or a spread over 50% of the mid. Values are kept
as Webull sent them (15 minutes delayed on the paper keys), never filled in.

## Switches and knobs

- Owner Settings → Live site: **Webull daily data** (`WEBULL_DATA`, the whole
  runner) and **Webull option price saver** (`WEBULL_OPTION_SAVER`, both jobs).
  Unset = on; both are site switches that can only turn the job off.
- Vercel env (optional): `WEBULL_OPTION_MAX_CONTRACTS` (default 12000),
  `WEBULL_OPTION_STRIKE_BAND` (0.20), `WEBULL_OPTION_MIN_DTE` (7),
  `WEBULL_OPTION_MAX_DTE` (400). The runner uses the mirror's
  `WEBULL_APP_KEY` / `WEBULL_APP_SECRET` (and optional `WEBULL_ACCESS_TOKEN`);
  it does not need `WEBULL_MIRROR=on` or the paper account ID.
- Workflow env: `WEBULL_DATA_URL` (default the production site),
  `WEBULL_DATA_MINUTES`, `WEBULL_DATA_BACKFILL`, `WEBULL_DATA_STRICT=1` (fail
  the job when the day did not finish).

## Budget (estimates until the first live runs)

- Webull calls: about 600 option snapshot calls, 150-250 contract-list pages,
  2 stock snapshot calls and 75-450 bar calls a day (more on monthly expiry
  weeks), each group at 24 a minute: about 25-35 minutes a day.
- Vercel: about 30-60 pings a day of up to 40 seconds (Hobby's function hours
  absorb this; the runner stops at the 50-minute workflow window).
- R2: about 2,000-5,000 class A operations a day (the free tier is 1 million a
  month); about 1 MB a day of snapshots, and about 2-3 GB a year with the
  expired bars, under the 10 GB free tier.
- GitHub Actions: one job a trading day of up to 58 minutes (the repo is
  public, so Actions minutes are free).

The status block on the Track Record's Webull tab shows the real counts (calls,
pings, contracts, expired saved and already deleted, misses).

## Export

`scripts/webull-options-export.mjs` (manual, needs the R2 creds, read-only on
the store) writes gzipped JSONL the engine history tests can read later:

```
node --env-file=r2.env scripts/webull-options-export.mjs --out research-kit/webull-options \
  [--from 2026-11-19] [--to 2026-12-31] [--symbols AAPL,SPY] [--no-bars]
```

- `snapshots/<UNDERLYING>/<YEAR>.jsonl.gz` (the row shape above, the same shape
  as the DoltHub history pull, `source: "dolthub"`),
- `expired-bars/<UNDERLYING>/<YEAR>.jsonl.gz` (`date, symbol, expiry, strike,
  right, open, high, low, close, volume, source: "webull-bars"`),
- `manifest.json` (counts, date range).

Wiring these prices into `lib/engines/backtest.mjs` is a later step.

## Assumptions

- Field names and limits come from Webull's developer docs and the 2026-11-19
  probe (`/mnt/project-files/webull-data/probe-2026-11-19/`): option snapshots
  take 20 symbols, bars 20 symbols and 1,200 bars, stock snapshots 100 symbols,
  the contract list pages of 1,000 with `pagination_key`.
- Webull keeps an expired contract's bars about a week; the saver works 1 to 5
  sessions after expiry, so a missed day or two still saves.
- Option data is 15 minutes delayed on the paper keys; the snapshot runs after
  the close, so the saved quote is the closing quote.
- Webull data is licensed for non-display use: research only, never on public
  pages, never through the MCP in this wave.

## Tests

`node scripts/webull-data-smoke.mjs` (offline: a fake Webull with the probe's
response shapes, a fake R2 store and a fake clock; a first run, the backfill,
the next session's expiry saving, deleted contracts, the per-minute cap, the
switches, the export, the trigger token and the cron routing) and
`node scripts/webull-execution-browser.mjs` (the status block on the Webull
tab, desktop and phone, light and dark; needs a regenerated `app.js`).
W3: `node scripts/webull-w3-smoke.mjs` (parsers, logs, gauges, backups, the
jobs against a fake Webull and store, key registration, the MCP scrub) and
`node scripts/webull-w3-browser.mjs` (the Market analysis block and the stock
page order flow as the Owner, and no Webull file asked for by a public visit).
