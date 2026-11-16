# Prediction markets (2026-11-15)

What traders on Kalshi and Polymarket are betting on, tracked once a day, and
whether those odds line up with stock moves. Code: `lib/prediction/`. Page:
**Prediction markets** (`prediction-markets`, Market & economy;
`scripts/render/prediction-client.mjs` + `prediction-css.mjs`).

**Cost: none.** Both venues' market-data reads are free, public and keyless.
No AI call is made. Every venue call counts against a per-bake budget
(`BAKE_CALL_BUDGET`, 260); a bake that runs out stops reading and keeps what it
had. **Measurement first:** nothing here changes a grade, a pick, a gate or the
Track Record.

**Time limits (2026-11-16).** The step can no longer hold up a build when a
venue is slow or down (`lib/prediction/venues.mjs`, `bakeMaxMs` in
`lib/prediction/index.mjs`):

- Each call waits at most 8 seconds (was 20).
- Three failed calls in a row to one venue stop all further calls to that
  venue for the build. A 4xx answer ("no such market") is not a failure.
- The whole step stops after 45 seconds on the 11:00 and 15:30 ET Top Picks
  runs and after 90 seconds on other builds. With both venues hanging the
  step used to be able to run 13 to 15 minutes; now it gives up after about
  six calls.
- A call that timed out is not marked as tried, so a one-day history fill or
  a release's expected value is read again at the next build.
- What was read before the stop is kept and published; the build log line
  says "stopped early" and why, and `state.lastRun.stopped` records it.
- Kalshi calls start at least 120 ms apart (`KALSHI_MIN_GAP_MS`). A 429
  ("too many requests", seen on the 2026-11-16 builds) waits for the
  venue's Retry-After (1 second by default, 3 at most) and tries once more,
  and doubles that venue's gap for the rest of the build. A second 429 is
  treated like a call that got no answer: it is tried again at a later
  build, and three in a row stop that venue ("kalshi rate limit"). Before
  this, two 429s on one contract's history fill gave the fill up for good;
  fills given up on a 429 or a 400 get one more go (`backfill.retried`).
- When Polymarket refuses a history range read (HTTP 400, also seen on
  2026-11-16, hourly and daily alike), the fill reads the market's whole
  history once as daily bars (`interval=max`), keeps the last year and is
  done (`backfill.coarse`). Error lines now carry the venue's own short
  reason from a JSON error body, for example `HTTP 400 (invalid filters)`.

**Kalshi discovery (2026-11-16).** Each day's discovery first reads the core
Kalshi series on their own (`KALSHI_CORE_SERIES`: `KXFEDDECISION`, `KXCPI`,
`KXCPICOREYOY`, `KXPAYROLLS`, `KXU3`, `KXJOBLESSCLAIMS`; six calls), then the
broad listing; an event in both counts once. Contracts from these series are
kept past the topic caps, because the Fed gauge and the Fed rows of the
release test read only the Kalshi Fed decision. A listing that stops early (a
refused page, the time limit) leaves the day unmarked, so the next build reads
it again, up to three tries a day (`state.discoveryTries`). The first live
day (2026-11-16) kept four Kalshi contracts and no Fed decision market.

**Topics from the question's words.** A venue category ("Finance",
"Economy") only files a question when its own words set no topic. A covered
company in such a question makes it a company bet, and a takeover question
about a company the site does not cover is not added (`themeFor`). Tracked
contracts are re-filed at each discovery when their words or a covered
company give a topic.

`PREDICTION_TIMEOUT_MS` and `PREDICTION_MAX_SECONDS` override the two limits
in the build's environment. They are not wired as repo variables; using them
needs a workflow env line.

## Sources

| Venue | Endpoint | Used for |
|---|---|---|
| Kalshi | `https://api.elections.kalshi.com/trade-api/v2` (`/series`, `/events?min_close_ts=…&with_nested_markets=true`, `/markets?tickers=`, `/series/{s}/markets/{t}/candlesticks`, `/historical/markets/{t}/candlesticks` as the fallback for older markets) | Contracts, prices, hourly and daily history, settled release ladders |
| Polymarket | Gamma (`/events`, `/markets`) and CLOB (`/prices-history`) | Contracts, prices, hourly and daily history |

Neither venue is reachable from the build sandbox; the first live bake is the
real check. `lib/source-health.mjs` lists both as sources.

## Files

| Key | Access | What |
|---|---|---|
| `prediction-odds.json` | Public | Tracked contracts by topic with chance, 1 / 7 / 30-day change, a 30-day line, resolve date, venue link, and the covered stocks each can move (with the direction if YES, where the rule sets one); big moves; recently resolved; the market's expected number for coming CPI / jobs / Fed releases and how recent ones came out; `bySymbol` for the stock page strip |
| `prediction-odds-owner.json` | Owner | The odds tests, the jump log with what stocks did next, the run-up watch, open Top Picks trades with linked odds moving, per-name shadow values, untracked candidates |
| `prediction-odds-state.json` | Owner, internal | Every tracked contract's daily (16:00 ET) and hourly history, and the release guesses. Read before the bake wipes `data/` (`OPTIONAL_BAKE_KEYS`). Never served by the MCP |

## What is tracked

- **Topics** (`THEMES` in `catalog.mjs`): the Fed, the economy, policy and
  trade, politics and elections, geopolitics, commodities, crypto, companies,
  and markets. Sports, weather, culture and "will X say Y" markets are dropped
  (`EXCLUDE_RE`, `EXCLUDE_CATEGORY_RE`). Caps per topic: `THEME_CAPS`.
- **Adding a contract** (`select.mjs`): discovery runs once per ET day; a
  contract is added when it is priced 3-97%, closes 2-800 days out, and has
  traded enough (Kalshi 2,000 contracts, Polymarket $50,000). At most six
  outcomes of one event. A contract stays tracked until it resolves; resolved
  contracts are kept 120 days.
- **History**: one value per trading day matched to the 16:00 ET close
  (`dq` = `1`); a day filled from a coarser read is marked and never used by
  the tests. New contracts backfill up to a year in 90-day hourly pieces
  (a piece that errors, or comes back empty, is read again daily). The last
  week is topped up hourly every bake.
- **Stock links** (`LINK_RULES`, 33 rules, plus `COMPANY_TERMS` and the
  Leadership collector's CEO names): each rule names the covered stocks a YES
  would move and which way (a Fed cut lifts SPY / QQQ / IWM / TLT; new tariffs
  hit importers and chip names; a ceasefire lowers oil and gold). Deadline
  wording ("before the end of 2026", "by year-end") is removed before rules
  read the text (`withoutDeadlines`). Company, election and Fed-chair links
  have no preset direction; the tests learn one, and the Owner pages act on a
  learned direction only after a held-out test passes (`provenSign`).
- **Release guesses** (`consensus.mjs`): for CPI (month over month), core CPI
  (year over year), payrolls, unemployment, jobless claims and the Fed decision, the middle of Kalshi's level ladder (the level priced
  at 50%) and its 80% band, kept each bake; the guess used for a release is the
  last one at least 30 minutes before it. Settled ladders backfill past
  releases.

## The tests (Owner)

All on daily data at the 16:00 ET close, seeded and deterministic
(`reactions.mjs`). Single stocks use the move left after the S&P 500; index and
asset ETFs their own move.

- **Odds jumps**: a contract moving 10+ points between two closes. For each
  linked stock: the move that day, the next 1 / 3 / 5 days, and the 3 days
  before (was it already priced?).
- **Lead or echo**: over every day, does the odds move come before the stock
  move, after it, or the same day?
- **Run-ups**: over five-day windows, do rising odds go with the stock moving
  the linked way at the same time or over the next five days; and does the
  stock drift toward a likely result as the close nears?
- **Release surprises**: actual minus the market's guess against SPY / QQQ /
  IWM / TLT that day.

Rules that keep them honest:

- Links group into families (rule x stock). Contracts in one family that move
  on the same day are one observation, and family jumps closer than three
  trading days are dropped, so a Fed ladder or five tariff markets never count
  one news day five times.
- Each family has one date cut: the first two thirds of its dates fit a learned
  direction, the last third is the test. Verdicts read the test third.
- p-values come from a seeded sign-flip test (jumps) or a correlation test
  (Student's t on n − 2 degrees of freedom since 2026-11-16; the earlier
  normal approximation called small samples significant too easily);
  the jump test reads two horizons, so its smaller p is doubled; then
  Benjamini-Hochberg across families at q 0.10. Under 30 events a family is
  "collecting", not "no effect".

Verdicts: `holds`, `odds-lead`, `run-up-follows` (pass); `odds-echo`,
`moves-together`, `same-day`, `echo` (real but not a lead); `no-effect`,
`no-order`; `collecting`.

## Where it shows

- **Prediction markets page**: public tabs By topic, Big moves, Data releases,
  By stock; Owner tabs Odds tests, Run-up watch, Open trades, Finder.
  `?view=<tab>&s=<SYMBOL>` deep links.
- **Stock page**: an odds strip (`#stp-odds`, `predictionStockStripHtml`) when
  a tracked contract links to the stock; hidden otherwise.
- **Calendar**: macro release rows show the market's guess
  (`renderCalPmLine`).
- **MCP**: `get_prediction_markets` (public tool when `MCP_PUBLIC_ACCESS=1`,
  else Owner) and `get_odds_reactions` (Owner; rows carry `direction_proven`).
- **Shadow log** (`lib/shadow-signals.mjs` version 6): per name `pmn` (linked
  open contracts) and `pmo` (sign x 7-day odds change, points); market gauges
  `pmCut`, `pmPol`, `pmJmp`. Measured by `lib/shadow-research.mjs` like every
  other candidate input. Nothing scores.
- **AI grader**: the linked odds lines reach the Top Picks grader only with
  `PICKS_ODDS_GRADER=1`, off by default (an Owner Settings engine hook; the
  2026-12-07 lock was lifted on 2026-11-16).

## Sports: win-by bands and Kalshi prices

`lib/sports/win-by.mjs`, run by the sports data job:

- **Margin bands**: each game's team bets carry the chance of each winning
  margin band and a win-by-X+ ladder from the team game model.
- **Live record**: forecasts are frozen before each game and graded after the
  final (`<sport>/win-by-record/<season>.json`): favorite won vs the model's
  chance, Brier vs a coin, the chance on the band that happened, how often the
  final fell in the 50% / 80% ranges, margin miss vs the books' spread.
- **Kalshi prices**: the newest read of Kalshi's open game-winner and spread
  markets (`<sport>/kalshi-games.json`; NFL `KXNFLGAME` / `KXNFLSPREAD`,
  confirmed; NBA `KXNBAGAME` / `KXNBASPREAD`, not yet seen live), shown beside
  the model and scored on the same games in the live record. Read only; no
  PropLine call.

## Switches

| Switch | Where | Effect |
|---|---|---|
| `PREDICTION_TRACKER=0` | repo variable (`daily.yml`), Owner Settings | No venue reads; the prior files carry forward (public file marked stale) |
| `PICKS_ODDS_GRADER=1` | repo variable, Owner Settings (Engine hooks, off by default, needs a confirm) | Adds linked odds lines to the AI grader prompt |
| `SPORTS_KALSHI=0` | repo variable (`sports-data.yml`) | Skips the Kalshi sports reads |

## Tests

`npm run test:prediction` (offline fake venues), `npm run test:prediction-browser`
(page, Owner and public, desktop and phone), `node scripts/sports-win-by-smoke.mjs`,
`node scripts/mcp-smoke.mjs`, `node scripts/sports-mcp-smoke.mjs`.
