# Wide tier (market-wide heat map)

Added 2026-11-19 (engine roadmap, thread 5). The site tracks about 80 names in
depth (option chains, grades, AI reads, Top Picks). The wide tier watches the
whole S&P 500 plus the Nasdaq-100, about 530 names, **with rules only**: one
daily close and volume per name, hourly price re-marks in market hours, no AI,
no grade, no trades. Code: `lib/wide-tier.mjs`.

## What it shows

- **Heatmap → Tracked / Wide switch.** Wide draws every listed stock grouped by
  sector and industry, sized by market value and colored by 1d / 5d / 1m or
  **Vs its sector** (the stock's return minus its sector's cap-weighted return
  over the same period). Our tracked names are outlined. Untracked tiles have
  no stock page: a click shows the tooltip (index, vs 52-week high, next
  earnings) instead of opening a page, and the list / bars views link only our
  names. Wide mode never polls `/api/quotes`; the live toggle is off and says
  "Wide list · refreshed hourly in market hours". The choice is remembered per
  device (`heatmap.source` in `stonks-views-v1`).
- **Sector table** under the Wide map: the 11 Select Sector SPDR funds with
  their own 1d / 5d / 1m / 3m returns, plus member breadth (% above the 50-day,
  new 52-week highs minus lows), then an "Our groups" table for the eight broad
  groups (`lib/sector-groups.mjs`).
- **Worth a look**: at most 20 names with earnings within 10 days, volume 3x
  their normal, a 52-week-high breakout, or unusual option volume (from the
  hourly flow scan, tracked names only). Each row says why.
- **Market map → Breadth → Tracked / Wide switch.** Wide draws the same breadth
  charts (above the 50 / 200-day, new highs and lows, up volume) from the wide
  list. Display only: the Top Picks breadth axis keeps reading the tracked
  chains.
- **MCP**: `get_feature` for `heatmap` and `market-map` lists the `wide`
  dataset (`wide-tier.json`).

## Where the list comes from

Two public lists, each with its date, re-read by the bake at most once every
30 days (`MEMBER_SOURCES`, `refreshMembers`):

1. S&P 500: `datasets/s-and-p-500-companies` (`data/constituents.csv`), kept
   from Wikipedia's "List of S&P 500 companies", with GICS sector and
   sub-industry.
2. Nasdaq-100: `jmccarrell/n100tickers` change files (start-of-day membership by
   effective date, checked by that project against Nasdaq's own data).

A read is refused (the prior list is kept) when it fails or its count falls
outside 480–520 (S&P) or 95–110 (Nasdaq-100). In January, before that year's
Nasdaq file exists, the prior year's file is used. The committed copy
`lib/wide-tier-members.json` (518 names, read 2026-11-19) seeds a fresh store;
refresh it by hand with `node scripts/wide-tier-members.mjs`. Second share
classes (GOOG, FOX, NWS) are dropped so a company is not counted twice. The five
names moved out of `TICKERS` (below) stay on the wide map even when no index
lists them (`WIDE_EXTRAS`). Names the S&P file gives no sector get one Yahoo
profile read (up to 40 per bake), mapped to GICS.

## How the data is built

- **Bake** (`scripts/build.mjs`, `writeWideTierFiles`, every bake):
  - tracked names and SPY take their bars from the chains the bake already holds
    (no call);
  - a name with fewer than 260 stored closes (or flagged by the split guard) gets
    about two years of daily bars from Yahoo's chart, up to 150 names per bake
    (`WIDE_BACKFILL_PER_RUN` overrides), so a fresh store fills in 3–4 bakes;
  - the post-close bake (16:10 ET) takes one batched quote pass (50 names a
    call, about 11 calls): today's close and volume, the corrected prior close,
    market value, next earnings date. A stored prior close more than 25% from
    Yahoo's means a split or a bad bar; that name is refetched next bake;
  - in-session bakes add no quote calls and keep the hourly marks already in
    the file (`carryIntraday`), so a 13:30 bake does not roll the map back to
    yesterday's close.
- Session dates come from the site's NYSE calendar (`lib/us-equity-calendar.mjs`,
  published closures for 2026-2028). Like the order and expiry controls, the
  wide tier refuses a year that calendar does not list: no post-close bar is
  added until the next year's closures are added there.
- **Hole guard**: one missed post-close bake heals itself (the next one writes
  the missed close from Yahoo's previous close). Two or more leave a session
  with no close, so those names are queued for a fresh chart read. A queued
  name keeps its old bars until its own read succeeds, and a name tried today
  that is still short of 260 sessions (a recent listing) or failed waits until
  the next day.
- **Hourly** (`scripts/refresh-heatmap.mjs`, inside the unusual-flow workflow,
  9–16 ET): one batched quote pass over the wide names not already in the
  tracked heat map (about 10 extra calls) re-marks price, day move, market
  value, 1w–1y returns, relative volume and the 52-week range
  (`refreshWideIntraday`). A name with no quote keeps its last mark and is
  counted stale. The file is left alone when the switch is off or no file
  exists yet.

## Files

| Key | Access | Owner | What |
|---|---|---|---|
| `wide-tier.json` | public | bake + hourly refresh (co-owned) | one row per name, sector table, worth-a-look, breadth today and a daily series in the Market map shape, sources, notes (~186 KB, ~48 KB gzipped) |
| `wide-tier-state.json` | Owner-internal (`lib/premium-keys.mjs`) | bake | bar store (520 sessions × ~545 names), member list, sector profiles (~3.9 MB, ~1.7 MB gzipped) |

Both are read before the bake's wipe. A failed wide step keeps the prior pair.
The page file never carries a grade, a pick or an engine field.

## Switch

`WIDE_TIER=0` (Owner Settings → Data & desks → Data sources) writes
`{ enabled: false }` from the next bake; the Heatmap's Wide view and the Market
map's wide breadth then say the wide list is turned off, the hourly refresh
leaves the file alone, and the stored bars are kept for when it is turned back
on. A missing file says "has not been built yet"; a file two or more trading
sessions old shows a stale warning.

## Cost

No AI call, no new serverless function, no new workflow, no new paid service,
no new dependency. All reads are free Yahoo and GitHub raw reads.

| Item | Calls per trading day |
|---|---|
| Post-close quote pass | ~11 batched quote calls |
| Hourly re-marks | ~10 batched quote calls × ~8 runs ≈ 80 |
| First 3–4 bakes only | 150 chart calls per bake (backfill) + up to 40 profile reads once |
| Member lists | 2 GitHub raw reads every 30 days |

Bake time: about 3 s per bake once backfilled (the quote pass with its 250 ms
pauses); about 40 s on the first few bakes while backfilling (150 chart calls,
4 at a time). R2: two extra objects, a handful of writes a day, ~5 MB stored,
well inside the free tier. Vercel: one ~48 KB gzipped public file, fetched only
when someone picks Wide, edge-cached like other public files.
**Total: $0/day.**

## Moved out of TICKERS

SMCI, ASTS, DIS, CBRS and PYPL left `TICKERS` on 2026-11-19 (85 → 80; user
decision) and now live on the wide map. They keep their `SECTORS` labels so old
Track Record rows still group. What that does at the next runs:

- open Top Picks and strategy-engine trades on them close as not-counted
  `left-coverage` (as for the 2026-10-18 cut); the Webull mirror follows engine
  closes;
- leveraged-ETF log entries on SMCI / ASTS close as retired
  (`levEtfEntryInUniverse`);
- ROTATION_OFFENSE skips SMCI's missing chain;
- LEAPS paper does not run on this branch (`leapsPicksForBake` is empty);
- their stock pages, grades, AI reads, option chains and flow scans stop.

Every broad group keeps five or more stocks (`sector-groups-smoke.mjs`).

## Tests

- `node scripts/wide-tier-smoke.mjs` (offline, synthetic seeded market,
  `scripts/fixtures/wide-tier.mjs`): parsers, member refresh (fresh, old,
  short, offline, January), the bar store, returns vs the tracked heat map,
  sector table, worth-a-look, breadth shape, sizes, call caps, the split guard,
  the switch, empty / stale / partial stores, hourly re-marks and the carry
  across in-session bakes, wiring. Rerun with other data:
  `WIDE_SMOKE_SEED=<text>` and `WIDE_SMOKE_ASOF=YYYY-MM-DD`.
- `node scripts/wide-tier-browser.mjs` (Playwright; `WIDE_BROWSER_SHOTS=<dir>`
  saves screenshots): public and Owner at 1440 light and 390 dark, the switch,
  tiles, outlines, no live polling, untracked tiles, Vs its sector, the panel,
  Market map wide breadth, no Owner file asked for by a public visitor, and the
  off / missing / stale files.
