# Booms & busts (history rhymes)

Added 2026-11-12. Page id `history-rhymes` (Market & economy). Library
`lib/history-rhymes.mjs`; browser code `scripts/render/history-rhymes-client.mjs`
and `history-rhymes-css.mjs`. No AI call and no new serverless function or
workflow; the only new downloads are five keyless FRED series in the shared
long-history cache's existing refresh (see Files).

## What it is

Four case studies of a buildout or credit boom, each set beside today:

| Case | Era | What the page shows |
|---|---|---|
| Railroads | 1840s Britain, 1866–1896 US | Railway Mania, the panics of 1873 and 1893; freight revenue per ton-mile fell 74% (1865–1890) while track tripled |
| Telecom and fiber | 1996–2002 | More than $500 billion of network spending, at most 2–5% of fiber lit by 2002, Global Crossing and WorldCom; private communication construction and the Nasdaq from FRED/index history |
| Housing and the 2008 credit crisis | 2000s | FHFA house prices, the 30-year mortgage rate, bank mortgage delinquencies and the Baa spread, all computed from FRED each build |
| AI data centers (now) | 2023– | CoreWeave's borrowing, Meta's Hyperion project company, server useful-life changes, H100 rent (Silicon Data index rows plus this site's weekly GPU cloud prices) and the October 2026 CDS reports |

Each case has a story, dated timeline, sourced numbers, "how it rhymes" and
"how today is different" boxes, and charts. Every dated fact from outside the
site's own FRED and index history carries a source link (`SOURCES`); timeline
entries computed from that history say "site index history". A timeline entry
whose exact day is not known carries a `when` label ("Summer 1845", "1893–1894")
that the page shows instead of the sort date. The page says plainly that it
describes past patterns and is not a forecast or a timing call; some booms
never busted.

## Two panels (since 2026-11-17)

Until 2026-11-16 the page counted nine signs on one scale ("7 of 9"). The
section audit found three problems: capital spending was counted three times
(three ways of measuring the same spending), boom signs and bust signs were
added together, so a market with every boom sign and no strain read as a late
boom, and every sign described an AI buildout, so the page could not see a
rate-driven or credit-driven decline (1973, 1980, 1987, 2022). The Owner chose
"Add a market-wide panel" on 2026-11-16. The page now has two panels, each
with its own boom and bust counts and its own stage (`HISTORY_RHYMES_VERSION`
2).

Lit counts 1, partial 0.5; unknown (missing input) counts nothing and is never
shown as clear. Each side is a share of its counted signs that have a reading.

### AI buildout panel: six signs

`readSigns` in `lib/history-rhymes.mjs`.

| Side | Sign | Input | Lit | Partial |
|---|---|---|---|---|
| boom | Builders spend far ahead of revenue and cash | three parts (below) | two parts lit | one part lit, or two partly showing |
| boom | Debt and off-balance-sheet deals fund the build | CRWV / ORCL total debt, market value, operating cash flow | both lean on debt (debt at least half of market value, more than 3 years of operating cash flow, or operating cash flow not positive) | one |
| boom | Stock prices run far above trend | Nasdaq Composite (shared long-history cache) | +40% in 250 sessions and +20% over the 200-session average | +20% or +10% |
| bust | The price of what is built keeps falling | `accelerator-prices.json` H100 composite | 30-day −5% or −10% over 60+ days | neither falling nor rising 5%+ over 30 days (the 2024–2025 index fall stands); rising 5%+ is "not showing" |
| bust | The most indebted builder cracks | CRWV / ORCL price vs 52-week high | ≤ −40% | ≤ −25% |
| bust | Supplier stocks fall while spending still rises | SMH vs 52-week high, capex still growing | ≤ −20% | ≤ −10% |

The spending sign's three parts (shown under it, `SPENDING_PARTS`):
spending growth against revenue growth (`ai-capex.json`, gap ≥ 15 points lit,
≥ 5 partly), spending as a share of revenue (≥ 25% and not falling lit, ≥ 15%
partly) and spending against the builders' operating cash flow (≥ 90% of it,
or two builders above it, lit; ≥ 65% or one partly). Market-wide bond sales
moved to the whole-market panel; credit spreads moved there too.

"Closest past case" is the overlap between today's lit/partial AI signs and
the signs each case showed (`CASE_SIGNS`, written from the history, not
fitted), shared ÷ union.

### Whole-market panel: six signs

`lib/history-rhymes-market.mjs` (`readMarketSigns`). Thresholds were set from
the research and the usual market reading before the history test ran and were
not changed after it.

| Side | Sign | Input | Lit | Partial |
|---|---|---|---|---|
| boom | Borrowed money chases stocks | FINRA margin debt (`crowd.json`) | +30% from a year earlier | +15% |
| boom | Stocks yield less than bonds | SPY P/E (chains) against the 10-year yield, the Bottom tracker's `readValuation` | earnings yield below the 10-year yield | less than 1.5 points above it |
| boom | Companies borrow at a fast pace | SIFMA corporate bond sales (`ipo-credit.json`), last three months vs a year earlier | +25% | +10% |
| bust | The Fed and bond yields push rates up | FRED `DFF`, `DGS10`, `DGS2` | fed funds 1.75+ above its two-year low, the 10-year +1.5 in a year, or fed funds +0.75 with hikes priced (2-year 0.25+ over fed funds) | 0.75 / 0.75 / hikes priced after any 0.25 rise |
| bust | The yield curve inverts | FRED `T10Y2Y` | below zero on any day in the last 24 months | under 0.25 now |
| bust | Credit markets start to charge more | FRED `BAA10Y`, `BAMLH0A0HYM2` | HY +0.75 or Baa +0.35 in 3 months, or HY ≥ 5.5 | HY +0.30 or Baa +0.15 |

### Stage

`stageFor({ boom, boomTotal, bust, bustTotal })`, the same rule for both
panels. The bust side is read first:

| Bust share | Boom share | Stage |
|---|---|---|
| ≥ 2/3 | any | Bust signs showing |
| ≥ 1/3 | ≥ 1/2 | Late boom, strain showing |
| ≥ 1/3 | < 1/2 | Strain without a boom |
| < 1/3 | ≥ 2/3 | Boom |
| < 1/3 | ≥ 1/3 | Early boom |
| < 1/3 | < 1/3 | Quiet |

So a market with every boom sign and no strain reads "Boom", not "Late boom",
and strain with no boom has its own label.

### History test of the whole-market bust signs

`marketHistoryTest` runs every build on the shared long-history cache (no new
download): every month-end since each sign's data starts (fed funds since
1954, the 10-year since 1962, the yield curve since 1976, the Baa spread since
1986) against every S&P 500 bear market since 1950 (`bearMarkets`: a close 20%
or more below the prior high, peak to the lowest close before a new high;
named in `BEAR_NAMES`). A sign "came before" a bear market when it was lit in
the 12 months up to the peak. Its hit rate is the share of lit months followed
by a new bear market peak within 24 months, against the same share for every
month (the ratio is the lift). Months inside a decline are left out, because a
sign that lights during the fall is not a warning; the test stops 24 months
before the data ends. The result rides the public file as `bearTest` (each
bear market with each sign's status before it, each sign's record and a
"two or more of the three" row).

Count rule (`MARKET_COUNT_RULE`): boom signs always count (they describe a
boom; they are not a timing call). A bust sign counts toward the stage only
when its lift is 1.2 or more over 24 or more lit months. A sign that fails is
still shown with its record and a "Not counted" mark; a sign the build cannot
test (history missing) counts.

What the test found on the full download before shipping (2026-11-16, 1950 to
2026; the build recomputes it every time):

- **Yield curve: passes.** Lit before 5 of the 6 bear markets its data covers;
  a bear market followed a lit month within two years 1.68 times as often as
  an average month (1.72 at 12 months, 1.27 at 36).
- **Rates rising: fails.** Lit before 8 of 11 bear markets, but lit in 37% of
  all months, so a lit month was followed by a bear market no more often than
  an average month (0.94; 0.89 at 12 months, 1.14 at 36). It is shown and
  marked "Not counted".
- **Credit strain (Baa): decided by the first live build**; the build sandbox
  had no Baa history.
- **Valuation (boom side, not tested in the build):** checked once by hand on
  Shiller's monthly data: lit before 5 of 11 bear markets and lit or partly
  showing before 8, but stocks earned less than bonds for most of 1969 to 1999,
  so its ratio was 0.82. It describes how expensive stocks are, not timing.

## Credit default swaps

Single-name CDS prices are sold by S&P Global Market Intelligence (Markit),
LSEG, Bloomberg and ICE; there is no free daily feed. SEC security-based swap
reporting (since 2022) is trade prints capped at $5 million, not a clean daily
price, and is not wired in. So the page shows:

- **Reported CDS quotes** (`REPORTED_CDS`): dated press quotes with their
  source (CoreWeave above 1,000 bp and about a 63% five-year default chance,
  Oracle 288 bp, SoftBank 424 bp, record highs for Amazon, Alphabet, Meta and
  Nvidia; October 2026, Reuters / S&P Global Market Intelligence). Add a row
  by hand when a new dated quote is published. The Credit tab says how old
  the newest quote is (`credit.reportedNewest` / `reportedAgeDays`) and warns
  once it is more than `REPORTED_CDS_STALE_DAYS` (60) days old
  (`credit.reportedStale`).
- **Free bond-market spreads**: Baa over the 10-year Treasury since 1986,
  ICE BofA high-yield and investment-grade (about three years on FRED).
- **A model stand-in (Owner only)**: Merton (1974). Equity is a call on the
  firm's assets with total reported debt as the strike; the solver finds asset
  value and asset volatility from market value of equity and one-year realized
  stock volatility (option-implied when the history is short), then reports the
  five-year chance assets end below the debt and the matching spread. It is a
  model, not a market quote: it ignores maturities, covenants, customer
  contracts and owner support. Financials (sector group) and ETFs are skipped.
  The page's Model check compares the CoreWeave read with the newest
  CoreWeave row in `REPORTED_CDS` (its `impliedPdPct`, level and date), so a
  new row updates it. Total debt is the quote provider's figure, which
  includes lease obligations and can be larger than the borrowings quoted in
  the press (the table column says so).

## Files

| Key | Access | Writer | Contents |
|---|---|---|---|
| `history-rhymes.json` | public | bake (`OPTIONAL_BAKE_KEYS`) | cases, both panels (`now` is the AI buildout panel: `score` / `total` / `stage` keep their names for older readers; `now.market` is the whole-market panel), boom and bust counts, case matches, `bearTest`, FRED-computed blocks, the Nasdaq then-and-now chart, press CDS quotes, sources, methodology. No per-stock model fields. |
| `history-rhymes-owner.json` | Owner (`PREMIUM_KEYS`, both claims) | bake | each covered stock's buildout role (`ROLES`), the Merton read, debt / cash-flow ratios, rating, flags, press CDS quotes, the model check, both stages (`stage`, `marketStage`) |

Both are built in `main()` after the shared long-history cache loads, from the
prior (pre-wipe) AI CapEx and capital markets files, this bake's crowd payload
(margin debt) and chains, and are written before Historical Data. A failed build carries the prior files
marked `stale: true`. A stale copy still shows on the page (with a note), but
it is not today's reading: Historical Data's "Resembles now" and the shadow
log skip it, the Owner brief drops it to priority 3 and says so, and the MCP
`credit_read` carries `stale: true`. The update checker expects `now` and
`cases`.

Five FRED series join `SHARED_FRED_EXTRA` (full history, free and keyless,
downloaded by the shared long-history cache's refresh like the others;
`historical-sources-smoke` checks the daily request budget): `BAA10Y`,
`USSTHPI`, `MORTGAGE30US`, `DRSFRMACBS`, `PRCMUCONS`. `BAMLH0A0HYM2` and
`BAMLC0A0CM` were already there for the Bottom tracker. The whole-market
panel's `DFF`, `DGS10`, `DGS2` and `T10Y2Y` were already in the cache
(`HISTORICAL_CONTEXT`), so it adds no download.

## Where it is used

- **Historical Data, "Resembles now"**: a "Buildout boom signs" match at half
  the AI buildout signs or more, when the whole market reads "Late boom" or
  "Bust signs showing", or whenever credit strain is lit, linking to the page
  (`matchNow` in `lib/historical-events.mjs`; a version 1 file still matches
  at 4.5 of 9).
- **Risk analysis**: a context card under the seven desks with both stages,
  labeled "Context, not a vote". It does not change the desk vote.
- **Owner market brief**: a "Buildout warning signs" line with the AI stage,
  the closest case, the whole-market stage and the three highest model default
  chances (priority 1 when either stage is late boom or bust).
- **Regime Lab positioning** (`lib/regime-lab/positioning.mjs`): watch at 4 of
  the 6 AI buildout signs (6 of 9 before, the same two-thirds).
- **Top Picks shadow logging** (`lib/shadow-signals.mjs`): `epd` per name
  (model five-year default chance) and `bsl` / `bsm` / `baa` in the daily
  market row. `bsl` is the AI buildout score: 0 to 9 until 2026-11-16, 0 to 6
  from 2026-11-17, so research on it splits at that date. `bsm` (from
  2026-11-17) is the whole-market score, 0 to 6. Logged and measured by
  `lib/shadow-research.mjs` like the other candidates; nothing scores, gates
  or changes a pick.
- **MCP**: `get_feature` `history-rhymes` (public file) and dataset `owner`;
  `get_stock` adds `credit_read` for an Owner token (`buildout_stage` and
  `market_stage`).
- **Links**: AI CapEx and GPU cloud prices pages point to the page; Export
  covers both files.

## Page behavior

- Tabs: Now vs history, Railroads, Telecom & fiber, Housing & 2008, AI data
  centers, Credit & CDS, and Stocks (Owner). The chosen tab is remembered per
  device and written to the address as `?tab=history-rhymes&view=<tab>`, so a
  copied link opens the same tab (the router keeps `view` only for the stock
  page, so the page reads it when `app.js` loads).
- A missing or failed file shows "Try again", which re-reads it (the shared
  `vnJson` cache keeps a failed answer, so the retry and the ten-minute
  refresh clear that entry first). The Owner Stocks tab has its own retry.
- Charts are drawn at a phone size below 560px wide and redrawn when the
  window crosses that width.

## Not done (needs an Owner decision)

- Letting either panel vote on Risk analysis or the Top Picks tape.
- Scaling the AI buildout drawdown thresholds by each stock's own volatility,
  a credit-spread level test beside the three-month change, and reading GPU
  rent from each provider's own quotes rather than the composite.
- A long history for margin debt, valuation and bond sales inside the build,
  so the boom side can be tested too.
- Using `epd` / `bsl` in a grade, gate or the AI grader (after the shadow
  evidence bar).
- A paid CDS feed.

## Tests

`npm run test:history-rhymes` (model, both panels, the stage rule, the
spending parts, the bear market finder and history test on made-up data, the
count rule, public / Owner split, summary, shadow keys, Owner brief line,
store policy, MCP, client wiring) and
`npm run test:history-rhymes-browser` (every tab at 1440 light and 390 dark,
both panels, the not-counted mark and its reason, the bear market table,
no Owner request from a public visit, missing file and Try again, Owner
Stocks tab, detail rows and Model check, the Risk analysis card, `?view=`
deep link and the address following the tab, the CDS quote age, one-line
quote dates). MCP and Historical
Data checks are in `mcp-smoke.mjs` and `historical-events-smoke.mjs`.
