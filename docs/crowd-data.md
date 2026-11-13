# Crowd & positioning data

Added 2026-11-09. Eleven free, keyless data sources that show how the market is
positioned and where the crowd's attention sits, collected by the existing
daily bake and shown on one public page plus one Owner-only section. Nothing
here calls an AI model, adds a serverless function, a workflow or a key, or
changes a pick, a grade or the Track Record.

## What it is

| Id | Source | What we read | Cadence | Block in `crowd.json` |
|---|---|---|---|---|
| P1 | Hyperliquid HIP-3 stock perpetuals (`api.hyperliquid.xyz/info`, POST `perpDexs` + `metaAndAssetCtxs`) | 24/7 mark vs the last US close, hourly funding (annualized), open interest, day volume, for tracked names and the index perps (SPX, NDX, DJI, RUT) | every bake; a 09:00 ET pre-open snapshot rides `overnight-preopen.json` | `perps` |
| P2 | Kalshi (`api.elections.kalshi.com/trade-api/v2/events`) | S&P 500 and Nasdaq-100 range markets (implied mean, most likely bucket, 80% band, overround) and macro threshold ladders (CPI, core CPI, payrolls and claims in thousands, unemployment, 10-year yield) plus the yes/no NBER recession odds (series `KXU3`, `KXJOBLESSCLAIMS`, `KXRECSSNBER` since 2026-11-09; counts read from `volume_fp` / `open_interest_fp`) | every bake | `kalshi` |
| O1 | FINRA Reg SHO daily short sale volume (`cdn.finra.org/equity/regsho/daily/CNMSshvolYYYYMMDD.txt`) | short volume as % of off-exchange volume per name, 20-day z-score, market average | daily file, at most 6 files backfilled per build | `shortVolume` |
| O2 | Cboe daily market statistics (`cboe.com/us/options/market_statistics/daily/`) | total / equity / index / ETP / VIX / SPX put-call ratios and volumes, 20-day average, 250-day z and percentile | once per ET day (last completed session) | `putCall` |
| O3 | Interactive Brokers stock-loan file (`ftp3.interactivebrokers.com/usa.txt`, read with curl) | borrow fee %, rebate and shares available per name | daily | `borrow` |
| O4 | CFTC Commitments of Traders, Traders in Financial Futures (`publicreporting.cftc.gov/resource/gpe5-46if.json`) | dealer / asset manager / leveraged fund / other net positions, weekly change, % of OI and 3-year z for ES, NQ, RTY, VX, ZN, ZT, DX, 6J, 6E | weekly (read once per ET day) | `cot` |
| R1 | ApeWisdom (`apewisdom.io/api/v1.0/filter/all-stocks`) | Reddit mentions, rank and upvotes, top 50 plus every tracked name, mentions vs 7-day average | every bake, at least 50 minutes apart | `reddit` |
| R2 | Wikimedia page views (per-article daily) | views per tracked company article, 7- and 30-day averages, ratio and z | daily, 60-day backfill | `wikipedia` |
| R3 | Leveraged ETF share flows (one batched Yahoo quote) | shares outstanding × NAV per leveraged fund, 1 / 5 / 20-day flows in shares and dollars, bull vs bear totals | every bake | `levFlows` |
| R4 | Stocktwits (watchers from the existing social call, `api.stocktwits.com/api/2/trending/symbols.json` for trending) | watcher counts, 7- and 30-day % change, trending list | every bake | `stocktwits` |
| S3 | FINRA margin statistics page | debit balances, free credit, month over month, year over year, distance from peak | monthly (read once per ET day) | `marginDebt` |

**S1 (NAAIM Exposure Index) was dropped.** The free public series lags about
three months and the publisher's terms allow tracking only, so a current
reading is not free. Nothing in the code references it.

Every fetcher is fail-soft: a failed read carries the prior block forward,
marked `ok: false, stale: true, carriedForward: true` with the error text, and
`sources[]` on the payload lists each source's state. Histories accumulate
across builds (60 days for most, 250 sessions for put/call, 160 weeks for COT,
60 months for margin debt), so the two files are read before the bake wipes
`data/` and written after the outcomes block.

## Public vs Owner

- **`crowd.json` (public).** Facts, ranks and percentiles only: the eleven
  blocks above plus `rollup`, one row per tracked symbol with each fact and its
  percentile across the universe (`*Pctile`). No recommendation, no
  direction, no field the public-data policy names
  (`lib/public-data-policy.mjs`). The page says "Not investment advice" and
  only describes what the data shows.
- **`crowd-owner.json` (Owner-only, `lib/premium-keys.mjs`).** The same facts
  joined to the Owner's open Top Picks trades: an attention score (0-100,
  average percentile of Reddit mentions, Wikipedia ratio and watcher growth),
  a short-pressure score (short-volume z and borrow fee), flags
  (`reddit-top10`, `reddit-spike`, `wiki-spike`, `watchers-surge`,
  `short-volume-high/low`, `hard-to-borrow`, `perp-longs-crowded`,
  `perp-shorts-crowded`, `perp-gap-up/down`), per-trade warnings (for example
  "hard to borrow: squeeze risk on a put"), the ten most and least crowded
  names, market gauges and one row per ET day (about 130 kept) so the reads
  can be tested against trade outcomes later. Measurement only: nothing feeds
  the grade or any gate.

## Where it shows

- **Crowd & positioning** page (`?tab=crowd`, Market & economy section,
  `scripts/render/crowd-client.mjs` + `crowd-css.mjs`): five tabs,
  Positioning (put/call, COT, margin debt, leveraged ETF flows), Short selling
  (short volume, borrow), Attention (Reddit, Wikipedia, Stocktwits), Odds
  (Kalshi) and Perps (Hyperliquid), with a source list and each source's
  freshness. The chosen tab is remembered through `VIEWS` (`crowd.tab`).
  Public visitors never request `crowd-owner.json`.
- **Owner Lab → Regime Lab → Crowd** (`scripts/render/regime-lab-client.mjs`,
  `#rgl-crowd-body`): the open book with each trade's attention,
  short-pressure, flags and warnings, the most and least crowded names, and a
  link to the public page.
- Source health lists each block as `crowd-*` (`lib/source-health.mjs`); the
  Update checker expects `sources` and `rollup`; the site catalog's feature map
  (`lib/site-catalog/feature-sources.mjs`) has `crowd`.

## Into the engine (2026-11-09)

The crowd facts reach the Top Picks engine as logged-then-measured shadow
signals, with three switch-guarded hooks that stay off until the read clears
the bar after the Dec 7 freeze; docs/top-picks.md, "Crowd signals", has the
detail. In short: `lib/shadow-signals.mjs` (version 3) logs `sv`, `svz`,
`bf`, `att`, `rdv`, `wkr`, `stw`, `pf`, `pgp` per name and a `mkt` row of
market gauges per day in `grades-daily.json`, every new trade's entry
snapshot and the run archive; `lib/shadow-research.mjs` measures them in
every bake (Owner Lab Evidence tab, "Shadow signals: candidate inputs");
`PICKS_CROWD_SQUEEZE_VETO`, `PICKS_MACRO_PUTCALL_SRC=cboe` and
`PICKS_CROWD_GRADER` are the hooks (`lib/top-picks-config.mjs`, repo
variables in `daily.yml`). FINRA short volume backfills 60 sessions.

Since 2026-11-12 (shadow version 5): Yahoo stopped sending share counts for the
leveraged funds, so `lib/crowd/lev-flows.mjs` falls back to the change in net
assets net of the NAV move (`assetFlowUsd`), reports `withFlow` (funds with a
measured flow) and totals a side with no measured fund as null, not $0. The
IBKR borrow file times out on the GitHub runner, so the option-implied borrow
rate from each chain (`ibr`) is logged beside `bf` as a stand-in.

## Switches

| Env | Where | Effect |
|---|---|---|
| `CROWD=0` | bake | skips every fetch and carries both files forward unchanged |
| `CROWD_BORROW=1` | bake | turns the IBKR borrow read on. **Off by default since 2026-11-13**: the FTP file never loaded from the GitHub runner, and the option-implied borrow (`ibr`) covers each name. Off writes an empty `borrow` block (`disabled: true`), carries nothing, and the source is not in the source-health list. `CROWD_BORROW=0` keeps it off even where a test injects a reader. |
| `CROWD_BORROW_URL` | bake | another location for the IBKR `usa.txt` file (default FTP) |

None of these are passed by `daily.yml`. `CROWD` defaults on and the borrow
read defaults off; Owner Settings can flip either (a repo variable wins).

## Untested from the build sandbox

The parsers were written against fetched samples, but these reads could not
be exercised end to end from the sandbox and prove out on the first live
build: Wikimedia page views, the IBKR FTP file, the Hyperliquid POST calls and
the Kalshi series other than `KXINX`. Each is marked `untested: true` in its
block until then; a failure only carries the block forward.

## Tests

- `npm run test:crowd` (`scripts/crowd-smoke.mjs`): every parser on a stored
  sample, carry-forward, the once-a-day guards, the orchestrator with injected
  fetchers, the public policy and the Owner/public key split, the rollup and
  the Owner scores.
- `npm run test:crowd-browser` (`scripts/crowd-browser.mjs`): the public page
  at 1440 light and 390 dark (all five tabs, no advice wording, the tab
  remembered across a reload, `crowd-owner.json` never requested), the
  missing-file hint, and the Owner Lab section with open trades.
- `scripts/crowd-fixture.mjs` builds full fixture payloads for both.
