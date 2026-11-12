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
"how today is different" boxes, and charts. Every dated fact carries a source
link (`SOURCES`). The page says plainly that it describes past patterns and is
not a forecast or a timing call; some booms never busted.

## Nine warning signs

`readSigns` reads each sign from data the site already collects. Lit counts 1,
partial 0.5; unknown (missing input) counts nothing and is never shown as clear.

| Sign | Input | Lit | Partial |
|---|---|---|---|
| Spending grows faster than revenue | `ai-capex.json` totals (capex YoY vs revenue YoY, same fiscal years) | gap ≥ 15 pts | ≥ 5 |
| Builders spend a record share of sales | `ai-capex.json` capex / revenue (TTM, else FY) | ≥ 25% and not falling | ≥ 15% |
| Spending outruns operating cash flow | per-stock fundamentals of the cash- and debt-funded builders | ≥ 90% of OCF, or 2+ builders above OCF | ≥ 65%, or one |
| The price of what is built keeps falling | `accelerator-prices.json` H100 composite | 30-day −5% or −10% over 60+ days | otherwise (the 2024–2025 index fall stands) |
| Debt and off-balance-sheet deals fund the build | `ipo-credit.json` SIFMA bond months (last 3 vs a year earlier) + CRWV / ORCL debt | YoY ≥ 20% or both builders borrowed | one, or YoY ≥ 5% |
| Credit markets start to charge more | FRED `BAA10Y`, `BAMLH0A0HYM2` | HY +0.75 or Baa +0.35 in 3 months, or HY ≥ 5.5 | HY +0.30 or Baa +0.15 |
| The most indebted builder cracks | CRWV / ORCL price vs 52-week high | ≤ −40% | ≤ −25% |
| Stock prices run far above trend | Nasdaq Composite (shared long-history cache) | +40% in 250 sessions and +20% over the 200-session average | +20% or +10% |
| Supplier stocks fall while spending still rises | SMH vs 52-week high, capex still growing | ≤ −20% | ≤ −10% |

Stage from the total: 0 early buildout, 3 boom, 5 late boom with strain
showing, 7 bust pattern. "Closest past case" is the overlap between today's
lit/partial signs and the signs each case showed (`CASE_SIGNS`, written from
the history, not fitted), shared ÷ union.

## Credit default swaps

Single-name CDS prices are sold by S&P Global Market Intelligence (Markit),
LSEG, Bloomberg and ICE; there is no free daily feed. SEC security-based swap
reporting (since 2022) is trade prints capped at $5 million, not a clean daily
price, and is not wired in. So the page shows:

- **Reported CDS quotes** (`REPORTED_CDS`): dated press quotes with their
  source (CoreWeave above 1,000 bp and about a 63% five-year default chance,
  Oracle 288 bp, SoftBank 424 bp, record highs for Amazon, Alphabet, Meta and
  Nvidia; October 2026, Reuters / S&P Global Market Intelligence). Add a row
  by hand when a new dated quote is published.
- **Free bond-market spreads**: Baa over the 10-year Treasury since 1986,
  ICE BofA high-yield and investment-grade (about three years on FRED).
- **A model stand-in (Owner only)**: Merton (1974). Equity is a call on the
  firm's assets with total reported debt as the strike; the solver finds asset
  value and asset volatility from market value of equity and one-year realized
  stock volatility (option-implied when the history is short), then reports the
  five-year chance assets end below the debt and the matching spread. It is a
  model, not a market quote: it ignores maturities, covenants, customer
  contracts and owner support. Financials (sector group) and ETFs are skipped.
  The page's Model check compares the CoreWeave read with the October 2026
  reported quote.

## Files

| Key | Access | Writer | Contents |
|---|---|---|---|
| `history-rhymes.json` | public | bake (`OPTIONAL_BAKE_KEYS`) | cases, signs, stage, case matches, FRED-computed blocks, the Nasdaq then-and-now chart, press CDS quotes, sources, methodology. No per-stock model fields. |
| `history-rhymes-owner.json` | Owner (`PREMIUM_KEYS`, both claims) | bake | each covered stock's buildout role (`ROLES`), the Merton read, debt / cash-flow ratios, rating, flags, press CDS quotes, the model check |

Both are built in `main()` after the shared long-history cache loads, from the
prior (pre-wipe) AI CapEx and capital markets files and this bake's chains, and
are written before Historical Data. A failed build carries the prior files
marked `stale: true`. The update checker expects `now` and `cases`.

Five FRED series join `SHARED_FRED_EXTRA` (full history, free and keyless,
downloaded by the shared long-history cache's refresh like the others;
`historical-sources-smoke` checks the daily request budget): `BAA10Y`,
`USSTHPI`, `MORTGAGE30US`, `DRSFRMACBS`, `PRCMUCONS`. `BAMLH0A0HYM2` and
`BAMLC0A0CM` were already there for the Bottom tracker.

## Where it is used

- **Historical Data, "Resembles now"**: a "Buildout boom signs" match at 4.5 of
  9 or more, or whenever credit strain is lit, linking to the page
  (`matchNow` in `lib/historical-events.mjs`).
- **Risk analysis**: a context card under the seven desks, labeled "Context,
  not a vote". It does not change the desk vote.
- **Owner market brief**: a "Buildout warning signs" line with the stage, the
  closest case and the three highest model default chances (priority 1 at 5+
  signs).
- **Top Picks shadow logging** (`lib/shadow-signals.mjs` version 4): `epd`
  per name (model five-year default chance) and `bsl` / `baa` in the daily
  market row. Logged and measured by `lib/shadow-research.mjs` like the other
  candidates; nothing scores, gates or changes a pick.
- **MCP**: `get_feature` `history-rhymes` (public file) and dataset `owner`;
  `get_stock` adds `credit_read` for an Owner token.
- **Links**: AI CapEx and GPU cloud prices pages point to the page; Export
  covers both files.

## Not done (needs an Owner decision)

- Letting the sign count vote on Risk analysis or the Top Picks tape.
- Using `epd` / `bsl` in a grade, gate or the AI grader (after the shadow
  evidence bar, and not before 2026-12-07).
- A paid CDS feed.

## Tests

`npm run test:history-rhymes` (model, signs, public / Owner split, summary,
shadow keys, Owner brief line, store policy, MCP, client wiring) and
`npm run test:history-rhymes-browser` (every tab at 1440 light and 390 dark,
no Owner request from a public visit, missing file, Owner Stocks tab and
detail rows, the Risk analysis card, `?view=` deep link). MCP and Historical
Data checks are in `mcp-smoke.mjs` and `historical-events-smoke.mjs`.
