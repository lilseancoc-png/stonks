# Quant labs

Owner Lab → **Quant labs** (`?tab=quant&lab=labs`). Six measurement labs that
answer plain questions about the site's own numbers: how likely is a market
fall, are the chances the site states honest, what do the grade and the trades
really lean on, are options priced over or under the moves to come, what
changed in each company's annual report, and which results would survive
counting everything that was tried.

Everything here is **Owner-only, deterministic and free**: no AI call, no paid
source. **Nothing changes a pick, a grade, a gate or the Track Record.** The
labs read data the build already holds; the one new download is the annual
report text (two SEC documents per company, a few companies per build).

Added 2026-11-16. Code: `lib/labs/`. Page: `scripts/render/quant-labs-client.mjs`
and `quant-labs-css.mjs`.

## Files and access

| File | Who reads it | What it holds |
|---|---|---|
| `quant-labs.json` | Owner Lab page, the Market odds card, MCP dataset `quant.labs` | The page file: one block per lab plus `card` |
| `quant-labs-state.json` | The build only (never the browser, never the MCP) | Fitted market-odds models, the log of chances stated at past closes (800 rows), the weekly factor panel (60 weeks), factor ranks frozen per trade, the settled prediction-market log (3,000 rows), the annual report text store |

Both are Owner keys in `lib/premium-keys.mjs` (combined `tr` + `tp` claims,
`private, no-store`) and optional bake keys in `lib/data-ownership.mjs`. The
build reads both before it wipes `data/` (`loadQuantLabs`) and writes them
after the self-improving loop. The public Brief, the public manifest and the
public MCP tools never read either file. A public visitor's browser never
requests them (`qlFetch` returns early without the Owner session;
`scripts/quant-labs-browser.mjs` fails if it does).

The repo is public, so `research/quant-labs/results/latest.json` holds
**aggregates only**: no per-stock value and no trade row. The smoke test
checks that it names no covered stock.

## The labs

### 1. Market odds (`drawdown-odds.mjs`)

Turns the staged reads on the Bottom tracker and Booms & busts into stated
chances of events fixed in advance:

- the S&P 500 closes 10% (or 20%) below today's close within 3, 6 or 12 months
- while the index is 10%+ under its high: the low of this decline holds for
  6 months, and the index is back above its old high within 12 months

One small logistic model per event, fitted on S&P 500 month-ends since 1962
(the shared long-history cache; no new fetch). Inputs: the yield curve, the Fed
rate's change over a year, the Baa credit spread and its 3-month change, the
index's swings, the rise in unemployment, the index against its 200-day
average and its 1-year high, factory output, inflation and the 5-year run-up;
the recovery events add the depth of the decline, the bounce off the low,
sessions since the low and the 50-day trend.

Guards against fooling ourselves:

- **Directions are fixed before the fit.** A wider credit spread may only raise
  the chance of a fall. The fit sizes an input; it cannot flip one.
- **Judged only on eras it never saw.** History is cut into eras, one per 10%+
  decline. Each era is predicted by a model fitted on the others, with a gap of
  the event's horizon on both sides so overlapping windows cannot leak.
- **Scored against "always say the average".** Skill is the share of that
  no-skill forecast's squared error removed (Brier skill). An event counts as
  **Working** at 5%+ skill with the low end of its resampled range above zero;
  otherwise **Weak** or **No skill**, and the card says so.
- **One strength setting, chosen first.** The ridge strength (20) was fixed
  before any test; the history run reports 5 and 80 beside it.
- A recalibration curve is kept only when it scores better out of sample.

Today's chance comes with a range (the model refitted on resampled eras) and
the historical rate ("normal"). Each close's stated chances are logged in the
state file and graded once their window has passed, so the lab also checks its
own live record.

History result (2026-11-16 run, month-ends from 1962 to 2026, 21 decline eras): skill of 5.8% for a 10%+ fall
within 6 months, 7.7% within 3 months, 7.3% within 12 months, 30% for "the low
holds" and 13.5% for "back above the old high"; the two 20% events are weak
(3.1%, 0.9%). A breadth add-on was tested and added nothing.

Limits: monthly inputs are the revised values, not the first print, which
flatters the unemployment and factory inputs slightly. Earnings revisions and
valuation (CAPE) have no free point-in-time history and are not inputs.

**The card.** `card` in the page file feeds a "Context, not a vote · Market
odds" card on the Bottom tracker (`#bottom-odds`) and Risk analysis
(`#risk-odds`). It votes on nothing and changes no verdict on either page.

### 2. Calibration (`calibration.mjs`)

Every chance, score and range the site states, graded against what happened:

| Source | Kind |
|---|---|
| Top Picks: chance of profit shown on the contract | chance |
| Top Picks: grade at entry; the AI grader's grade at entry | score |
| Each strategy engine's setup score | score |
| Self-improving loop: 5 / 10 / 20-session direction, +25% before -50% | chance |
| Prediction markets: price the day before settlement | chance |
| Earnings: option-implied move (live stamps only, never the estimates) | range |
| Earnings Forecast: likely (50%) and wide (80%) ranges for revenue and EPS, each built only from earlier results | range |
| Market odds (history test, and live once windows pass) | chance |

A **chance** is honest when events it calls 30% happen about 30% of the time,
and useful when it beats always saying the average. A **score** is not a
chance, so it is judged on ranking only (does a winner outrank a loser more
often than a coin flip). A **range** is judged on how often the result landed
inside against what the range claimed. Under 30 graded rows a source reads
"Collecting".

Other labs and desks can add a source by passing `extraSources` in the build
context. The Earnings Forecast ranges are the first user
(`forecastCalibrationSources` in `lib/earnings-forecast-lab.mjs`).

### 3. Factors (`factors.mjs`)

- **Factor ranks.** Each covered stock's rank (0 to 99) on seven price factors
  (12- and 6-month momentum, 1-month reversal, low volatility, low beta, near
  the 52-week high, above the 200-day average) and six fundamentals read at
  the build (earnings yield, sales yield, margin, return on equity, sales
  growth, low debt).
- **Rank skill.** One snapshot a week is kept, so each factor's link to the
  return that followed (1, 5, 21, 63 sessions) is measured forward on our own
  names, beside the Top Picks grade scored the same way. Price factors are
  backfilled from stored bars; fundamentals have no free point-in-time history
  and start from the first snapshot.
- **What each book leans on.** The daily return of the grade book (top third
  by grade against the bottom third), the Top Picks direction book and each
  engine's, split into the market, small against large, growth against the
  market, and momentum and low volatility inside our names. What is left is
  the book's own return.
- **The grade with the factor part taken out.** How much of today's grade
  ranking four price traits explain, and each stock's grade net of them. A read
  only: the grade and the pick order are unchanged.
- **Trades.** The factor ranks of each open Top Picks trade are frozen in the
  state file the first day the lab sees it, so closed trades can later be
  split by what they leaned on. (A trade already open at the first run is
  marked "after entry".)

History result (74 covered stocks, 2008 to 2026, 28 factor-and-horizon pairs,
so a t value of 3.12 is needed): no price factor passes.

#### The wide history test (`factor-universe.mjs`)

The covered list is 85 names, too few to judge a factor. The wide test asks
the textbook question on the 500 largest US companies: did value, momentum,
profitability, quality, earnings growth, low volatility or smaller size
predict the next month's return, and what was left after trading costs?

- **Companies.** A pool of about 1,000 of today's largest US filers. At each
  month-end the 500 largest by that day's market value are the universe. The
  test starts at the first month with 500 companies that have a market value
  (August 2010 on the current download).
- **Numbers.** SEC company facts, first-filed values only, each with its
  filing date, so a month-end uses only what was public. Prices are Yahoo
  split-adjusted closes with dividends, so returns are total returns.
- **Factors.** 17 in seven families: earnings yield, book to market, sales
  yield, free cash flow yield; 12- and 6-month momentum, 1-month reversal;
  gross profit to assets, return on equity, operating margin; profit backed by
  cash, low debt load, slow asset growth, few new shares; earnings growth
  surprise (the free stand-in for analyst revisions); low volatility; smaller
  size. Bank-unfriendly ratios skip financial companies.
- **What is measured.** Rank skill 1, 3, 6 and 12 months ahead; the top fifth
  minus the bottom fifth per year, its t value, worst fall and monthly
  turnover; the same after 10 basis points a side; the top fifth against the
  average company (the long-only read); both halves; and one regression a
  month of the next return on all seven family scores at once (Fama-MacBeth).
  18 things are tried (17 factors and the combined score), so a pass needs a
  t value of 2.99, the same sign in both halves and a profit after costs.

Market value is the adjusted close times the share count in the newest
filing, and the share counts need cleaning (`sharesSeries`):

- **Units.** Filers scale share tags differently (a count in thousands reads
  1,000 times too small), and now and then the per-share figure or the profit
  is off instead. Each reading (the weighted count, the cover count, profit
  divided by earnings per share) is set against the middle of all three in the
  filings around it; one that is 1,000 or 1,000,000 times away is rescaled and
  one still more than 30 times away is left out.
- **Splits and spin-offs.** The price history books some spin-offs as splits.
  A factor below one is a reverse split; an odd factor above one (2.0842) is a
  spin-off; a round one is read off the filed counts on either side. A
  spin-off factor applies to month-ends before the event only. A filing made
  just before a split that is already restated for it is not doubled again.
- **Which count.** The largest weighted or cover count for the newest period
  (a cover count is newer after a listing or a share issue; a weighted count
  covers every share class). Profit over earnings per share stands in only
  when neither is filed and it agrees with the company's own counts.
- **Today's quote.** The newest count is set against Yahoo's quoted share
  count and quoted value over price. A company more than 1.5 times above or
  under half of it is left out of the test. Past counts are never scaled to
  the quote.
- **Wrong-unit filings.** A filing whose total assets or sales read about 200
  times away from the filings around it is set aside whole.

Cleaning may read later filings to settle units, splits and typos. The
numbers a month-end uses were all filed by then (the smoke test changes every
number filed after a date and checks the months before it do not move).

Result (2026-11-16 download; 500 largest of 992 companies, 194 months, August
2010 to September 2026): **no factor passes.** The closest is few new shares
(rank skill 0.019, t 2.33, +1.1% a year after costs), which misses the bar.
The combined score has a rank skill of 0.014 (t 1.79) and +1.4% a year after
costs. Book to market lost 4.0% a year and low volatility 8.7% a year;
12-month momentum made 3.0% a year after costs with a t value of 0.6. In the
regression, momentum is the largest plus (+0.13% a month per standard step,
t 1.56) and low volatility the largest minus (t -1.72). The share check: 977
of 997 companies match today's quote, 5 are left out and 15 have no usable
count; 247 companies had counts rescaled, 131 spin-offs were told apart from
splits and 71 filings were set aside.

Limits, all on the page: today's survivors only (which lifts small, volatile,
cheap and money-losing companies, so it is too kind to smaller size and value
and too hard on low volatility, profitability and momentum); filings are
machine-readable only from 2009 to 2011; a merger, spin-off or listing can
leave a wrong share count for a month or two; a few very large companies with
several share classes file no total and are missing; no free history of
analyst revisions; flat costs with no borrow fee; equal weights and no
industry balance.

The result file holds aggregates only. No company is named, ranked or scored
in it, and the research download is never merged into `main`.

### 4. Volatility (`vol.mjs`)

Four forecasts of each stock's swings over the next 21 sessions (the last 21
sessions carried forward, EWMA, GARCH(1,1), and a day/week/month mix, HAR),
set beside the option price: implied volatility minus the forecast is the
premium a buyer pays over what the stock is expected to do. The model that won
the history test is the one in use.

The lab then checks, on dates whose 21 sessions have passed, whether each
forecast beat the baseline, and whether a high premium was followed by options
that cost more than the move delivered. That second test is a **paired
comparison** against the plain gap between implied and trailing volatility,
because the option price sits on both sides of the test and any premium looks
predictive on its own.

History result (2026-11-16 run, 144 symbols, forecasts from 2016 to 2026): GARCH cut the baseline's loss by 23.5%
(t 5.4), EWMA by 12%, HAR by 9.9%.

This is a second opinion beside the site's one "are options expensive" rule
(`lib/iv-richness.mjs`). It does not replace it and nothing reads it.

### 5. Annual reports (`filing-text.mjs`)

How much a company rewrote the Risk Factors section of its newest annual
report (10-K, or 20-F for foreign filers) against the year before: similarity,
paragraphs added and removed, the change in length, and terms that appear for
the first time. Word counting only; no AI reads or summarizes anything.

The list of filings comes from the Leadership collector's stored submissions
(`sub.annual`), so the only downloads are the two documents, once per new
annual report. Three companies per build (`QUANT_LABS_TEXT_NAMES`), never on a
Top Picks run, `www.sec.gov` only, with the declared `SEC_USER_AGENT`. A failed
read is recorded and retried after a week; nothing throws into the build.

### 6. Registry (`registry.mjs`)

Try enough rules and one will look good by luck. The registry keeps the number
of things tried beside every result (`TRIAL_LOG`, edited by hand when a new
variant is tried) and reports the plain t value, the t value needed once that
many attempts are allowed for, and the deflated Sharpe ratio (the chance the
true average beats what the luckiest of that many attempts would show). A book
"holds up" only at 95%+ with its t value over the bar. Books: Top Picks, the
paired SPY baseline, each strategy engine, plus the history tests on file.

## Build wiring

`main()` in `scripts/build.mjs`:

1. `loadQuantLabs(DATA_DIR)` before the wipe.
2. After the self-improving loop: read the Top Picks record, `grades-daily.json`,
   the engine record and `prediction-odds.json`; on non-Top-Picks builds run
   `refreshFilingText`; then `runQuantLabs(ctx)` (pure: no file, no network) and
   `writeQuantLabs`.
3. Each lab runs inside its own guard: a lab that throws keeps its last good
   block, marked `stale`, and the others still run. The whole step is
   non-fatal; on any failure the prior files are carried (`carryQuantLabs`).

The market-odds fit takes about five seconds and is reused until a new S&P 500
close arrives.

## History tests

`node scripts/quant-labs.mjs run --long DIR --spx FILE --baa FILE` (manual;
there is no workflow) runs the era-held-out market-odds test at three ridge
strengths, the volatility forecast test and the price-factor test on the
long-history download, and writes `research/quant-labs/results/latest.json`.
Every full build joins that file into the page.

`node scripts/quant-labs.mjs universe --data DIR [--from YYYY-MM] [--dry]`
runs the wide factor test and merges its block (`factorUniverse`, plus 18
registry rows) into the same file, leaving the other tests as they are; `run`
keeps the block when it rewrites the file. `DIR` holds `universe.json.gz`,
`prices.json.gz` and `facts.json.gz` from the `research-factor-data` branch
(`research/factor-universe/collect.mjs` there: free SEC and Yahoo reads with
the site's own SEC identity, run by a push to that branch; about 17 MB, never
merged). A company that re-registered with the SEC has its earlier filings
under an old number; the collector's `PREDECESSORS` table joins the two.

## Switches

Both are on the Owner Settings page (no repo variable, no workflow edit):

- **Quant labs** (`QUANT_LABS`, Research tab, big impact): off carries both
  files forward untouched. Days while it is off are missing from the stated
  chance log and the weekly factor panel.
- **Annual report text (SEC)** (`QUANT_LABS_TEXT`, Data & desks): off stops the
  SEC document reads and keeps the comparisons already made.

## Tests

- `node scripts/quant-labs-smoke.mjs`: the statistics, each lab, the build entry
  point on a synthetic market (a hidden risk state the model must find), reuse
  on a second build, a failing lab, file round-trips, the switches and the
  Owner / public split.
- `node scripts/quant-labs-browser.mjs`: every sub-tab at 1440 light and 390
  dark, the wide factor test's tables, the card on both pages, a stale lab, a
  missing file, and a public visit that must not see the view or request
  either file.
- `node scripts/factor-universe-smoke.mjs`: the wide factor test on a made-up
  universe (`scripts/fixtures/factor-universe.mjs`): trailing-year totals,
  share counts (units, splits, spin-offs, an early restatement, a new listing,
  a one-class cover count, the quote check), a planted factor that must be
  found, noise that must not pass, costs, no look-ahead, and a result that
  names no company.

Neither has an npm script (`verify:risk-cost` fails on any `package.json`
change).

## Not built

No hook reads these labs. A market-odds input to the Top Picks market tape and
a factor-adjusted grade order are deliberately left out until the Owner has
seen the evidence and asked for them.
