# Regime Lab (November 9, 2026)

The Regime Lab answers one question for the Top Picks engine: **which market
are we in, and what works in it?** It is an Owner-only research desk. It
labels every session with a market cell, runs the playbook each cell would use
as paper books beside the live record, scores every open trade's risk, tests
risk-scaled exits, replays "what if we knew tomorrow's headline" as a ceiling,
and keeps a catalog of twenty-two tests (F1-F22) with ten guards (G1-G10)
against fooling ourselves.

Nothing here changes a pick, a grade or the Track Record. The lab adds **no
AI call**, no new fetch, no serverless function and no workflow. Everything
it writes goes to one Owner-only key, `regime-lab.json`, and to the Owner Lab
**Regime Lab** tab.

The brainstorm this builds (ids A1-A10, B1-B8, C1-C10, D1-D8, E1-E9, F1-F22,
G1-G10) is the Claude Doc "Regime research lab" of November 9, 2026. C9 (a
GitHub Actions job) and G10's build were left out on purpose: the research
runner is a manual command, and G10 is a standing rule, not code.

## Where things live

| Piece | File | Items |
|---|---|---|
| Market labels (eras, characters, cells, confirmation, correlation state, event load, stock labels) | `lib/regime-lab/labels.mjs` | A1-A10 |
| Hidden-Markov challenger | `lib/regime-lab/hmm.mjs` | A4 |
| Playbooks and the switch strategy | `lib/regime-lab/playbooks.mjs` | B1-B8 |
| Risk score, stop ladder, continuous and price stops, size-first, targets, time stops, book brakes | `lib/regime-lab/exits.mjs` | E1-E9 |
| Modeled options (Black-Scholes on an IV proxy, event bump and crush, costs) | `lib/regime-lab/options-model.mjs` | C4 |
| Test harness: context, simulate, scorecard, random control books, walk-forward | `lib/regime-lab/harness.mjs` | C1-C8 |
| The headline oracle | `lib/regime-lab/oracle.mjs` | D1-D8 |
| The tests | `lib/regime-lab/tests.mjs` | F1-F22 |
| Guards, the trial ledger, holdout locks | `lib/regime-lab/guards.mjs` | G1-G10 |
| The test catalog and its status join | `lib/regime-lab/catalog.mjs` | C10 |
| Bake-time payload: labels, shadow books, oracle, evidence rows, `regime-lab.json` | `lib/regime-lab/payload.mjs` | C10 |
| Research runner (manual) | `scripts/regime-lab.mjs` | C9 replacement |
| Owner Lab tab | `scripts/render/regime-lab-client.mjs`, `regime-lab-css.mjs` | |
| Tests | `scripts/regime-lab-smoke.mjs`, `scripts/regime-lab-browser.mjs` | |

## The label (A1-A10)

Every session gets a **volatility era** and a **market character**, combined
into one of **six cells**:

| | Calm | Stressed |
|---|---|---|
| Trending up | up-calm | up-stressed |
| Choppy | chop-calm | chop-stressed |
| Trending down | down-calm | down-stressed |

- **Era** (A1): `calm` under VIX 15, `normal` 15-20, `elevated` 20-30, `crisis`
  30+ or VIX above VIX3M with VIX over 24 (term inversion). Without a VIX the
  20-day realized vol's rank in its own year decides (50 / 80 / 95th
  percentile) with absolute floors (12% / 25% / 40%). The cell's stressed
  side is `elevated` or `crisis`.
- **Trend state** (A2): SPY, QQQ and IWM each vote from their close against
  the 50- and 200-day averages; breadth above the 50-day (share of the
  universe) votes once more at 65% / 35%.
- **Trend quality** (A3): a 20-day efficiency ratio, the 40-session
  follow-through rate and a 14-day ADX, combined into one 0-1 quality.
  Trending needs quality 0.5 or better; otherwise the session is choppy.
- **Confirmation** (A5): a raw label becomes the label in force only after
  two sessions agree. The series keeps the raw label, the confirmed label,
  the switch day, how late the switch was, and a hindsight series computed
  only to measure how late the confirmed label runs (0.8 days on the
  2006-2026 replay). A decision made during a session may read only the
  **prior close's** label (G1); the harness refuses a centered series.
- **Correlation state** (A7): average pair correlation of the universe's
  20-day returns, recomputed every five sessions: `macro` over 0.6, `mixed`
  0.4-0.6, `stock-picking` under 0.4; plus return dispersion.
- **Event load** (A8): the macro dates and the share of the universe
  reporting in the next five sessions: `heavy` at two macro dates or 20% of
  names, `light` with none. The bake stamps it on the latest row only
  (earlier rows keep the read they had); the long-span replay counts FOMC
  weeks only, since CPI, jobs and earnings dates are not in the research set.
- **Transition** (A5): the sessions right after a switch and before
  confirmation carry a `transition` flag, which the transition playbook reads.
- **Stock labels** (A10): each member's own trend state and quality
  (trending up / down / choppy), for the F17 test and the Stocks section.
- **Hidden-Markov challenger** (A4): a two-state Gaussian HMM on SPY log
  returns, refit once a year on data up to that day and **filtered**, never
  smoothed, so it is as causal as the grid. F2 compares the two.

Thresholds are in one place, `THRESHOLDS` in `labels.mjs`, so the page, the
doc and the tests agree.

## Playbooks (B1-B8)

Each cell has a playbook; the **switch** strategy picks the cell's playbook
from the prior close's label. Every playbook is tested against the **null
hypothesis**: one brake, the same rules everywhere (G8).

| Playbook | Cells | Rules |
|---|---|---|
| Same rules (baseline) | all | calls and puts at the grade bar, -50% stop, +25% target, 8 open |
| Ride the trend (B1) | up-calm | calls only, -50% stop, trail winners 25 points off their peak once up 25%, 8 open |
| Size and exits by era (B6) | all | the baseline with era sizing and the stop ladder, book brakes by era |
| Defend (B2) | down-calm, down-stressed | puts only, and only after a bounce back toward the 20-day average, -40% stop, 5 open |
| Fade the edges (B3) | chop-calm | calls within 2% of 20-day support, puts within 2% of resistance, 0.75 size, -40% / +20%, 6 open |
| Mostly cash (B4) | chop-stressed | nothing |
| Transition (B5) | switch days | half size, no new trend trades, close the weakest open trade first, 4 open |

At bake time (every 11:00 and 15:30 ET Top Picks run) `openShadowBooks` opens
one paper book per strategy from the run's raw grades: no AI grader, no
entry-timing gate, the engine's own contract picker and option model, each
playbook's stop and target. `markShadowBooks` marks them with the record's
own marker and exit rules at every later decision run. The books live in
`regime-lab.json` (`books`), and the gap between the same-rules book and the
live record is what the live gates are worth (B7). F3 reads the books at 30
decided trades in each (B8).

## Risk-scaled exits (E1-E9)

- **Risk score** (E1): 1-10 from the structure (stock 0.4, debit spread 0.7,
  credit spread 0.8, straddle 0.9, single 1.0), the era (calm 0.6 to crisis
  1.25), the stock's own 20-day vol rank, days to expiry and an event inside
  the hold. Stamped on every new record trade as `riskScore` with the label as
  `labRegime`, and shown on the Exits and risk section.
- **Stop ladder** (E2): -50% calm, -45% normal, -35% elevated, -30% crisis.
  A **continuous** stop reads the stock's vol percentile instead.
- **Targets and trails** (E3): a target scaled by the expected move; half
  off at +25% with the rest trailed.
- **Price stop** (E4): 1.75 ATR on the stock, translated to the option
  through the model.
- **Size first** (E5): a fixed dollar risk per trade, so a tighter stop means
  a bigger position, not a different one (G9 says this is always the
  comparison).
- **Time stops** (E6): 3, 5 and 8 sessions, or by character.
- **Book brakes** (E7): open positions 8 / 6 / 5 / 3 by era, a theme cap of 2
  (1 in crisis) and a daily loss stop of 3 / 2.5 / 2 / 1.5 stops' worth.
  F10 replays them on the live record, including the October 28 cluster.
- **Grade-fade exit** (E8): test only; the owner has not approved it as a
  live exit.
- F5-F9 compare each of these with the flat -50% stop. A rule wins only
  with a higher average net, no more drawdown and a whipsaw rate within 5
  points (G9).

The live exits are unchanged: +25% / -50% on singles and debit spreads.

## The harness (C1-C8)

`makeContext` takes a trading calendar, columnar bars, grades by day, the
label series, sector and theme maps, events and an IV/RV ratio per name.
`simulate` runs one strategy with one exit rule over one window; `scorecard`
reports count, average and median net (after costs), win rate, profit factor,
drawdown, the worst-five share, the top-three drop, exposure, trades a month,
average hold and the whipsaw rate, with the setup's rank against 500 random
control books (C6). `walkForward` re-fits bar, stop and book size every two
months and stitches the out-of-sample path (F15). Stress mode doubles the
costs and crushes IV 30% after events (G6, F22).

Options are modeled (C4): Black-Scholes on an IV proxy (realized vol times
the name's IV/RV ratio, 1.15 by default), a 25% bump into an event and a 20%
crush after, round-trip costs of 3.5 points on a single, 12 on a debit
spread, 7 on a straddle and 0.1% on stock. Every window before May 25, 2026
(the first real IV history) carries a **price-half** tag (G5).

Named windows (C3): 2026 rally, 2026 midterm week, 2008 crisis, 2011 chop,
2017 calm trend, 2018 vol spike, 2020 crash and rebound, 2023 AI rally,
2024-2025 and 2008-2025 as the training years. **2022 bear and the 2026
slide are holdouts** (G3): locked, run once, and recorded in the trial ledger.

## The oracle (D1-D8, G7)

If the engine knew tomorrow's headline, how much could it make, with what
structure and what risk? The answer is a **ceiling**, never a strategy. The
book holds only events a **rule** can tag before any price is read: earnings
beat / miss / in line from EPS against the estimate (±1% in line), FOMC cut /
hike / hold from the decision table, CPI cooler / hotter than the prior
month-over-month print, jobs stronger / weaker than the prior change.
Consensus is not stored, so the prior print stands in for it. Headline text
never enters the book, every output carries `neverRecord`, and the guard
report fails if an oracle row is ever found in the record.

The replay (D2-D3) measures the open, close and three-session move on the
headline's side, how often the move was already priced, and the best exit by
type. Structures (D4) price stock, a single, a debit spread and a straddle
with the modeled options, by type and IV level, with gap risk past the stop,
size as the stop (D5) and the accuracy the oracle needs to break even at each
noise level (D6). `engineVsOracle` (D7, F14) and `oracleCeiling` (D8) compare
the record's event trades and waits with the oracle once about 20 archived
runs exist.

At bake time the oracle reads the earnings store, the FOMC table and the real
CPI and jobs release dates. The research runner has no earnings store and
approximates release days (jobs the first Friday of the next month; CPI the
12th), so its hit rates read low.

## The tests (F1-F22) and the guards (G1-G10)

`TEST_CATALOG` lists every test with what it asks, what it reads, where it
runs and what it needs. `catalogStatus` joins the rows with the research
summary and the bake's live results, so the Tests section always shows every
test with a status: not run, waiting, collecting, ready, passed, failed, no
clear answer.

- **Research runner** (`node scripts/regime-lab.mjs run`): F1-F9, F11-F13,
  F15, F17-F19, F22 on the 2006+ long history and the Owner's grade caches.
- **Every full build**: F10 (book brakes on the record), F16 (resembles now),
  F20 (the AI grader by cell, from `picks-outcomes.json`) and the live
  shadow-book read of F3.
- **With the run archive** (about 20 runs, early December): F14 (engine vs
  oracle) and F21 (input skill by cell).

Four of the lab's tests also ride the Owner Lab Evidence board under the
"Regime Lab" lane (`regime-switch-books`, `regime-grader-by-cell`,
`regime-book-brakes`, `regime-live-cells`).

The guards are listed on the page with a status each: G1 labels never peek
(checked by `assertCausal`), G2 eras named for reporting only, G3 the trial
ledger and holdout locks, G4 live conclusions wait for about 140-240 closed
trades, G5 the price-half tag, G6 the stress rerun, G7 the oracle is
isolated, G8 the same-rules null, G9 whipsaw and size-first, and G10 the
standing rules (never run the backtest-picks workflow, never reset the Track
Record, no engine change before the archive test, $0 AI for the lab).

## What the first research run found (November 9, 2026)

Run on 5,245 sessions (2006-01-03 to 2026-11-06), 85 names, with the engine's
price-half grades one day a week from 2008 and real daily grades from June 24,
2026; 1,534 setups tried. Summary in
`research/regime-lab/results/latest.json`; the full run in the Owner's
private research folder.

- **F1** the price-half grade has no rank skill at 10 sessions in any cell
  (IC 0.003 trending, -0.005 chop): inconclusive. The direction-skill test
  on the real grade (November 23 / December 7) stands.
- **F2** the grid flips 23 times a year with a one-day lag and its stressed
  label precedes 1.84x the calm label's volatility; the HMM flips 16.5 times
  a year at 1.87x. The two agree 98% of the time; the grid is preferred for
  readable thresholds. Pass.
- **F3** the switch strategy averaged +0.6 net per trade against -2.3 for
  the same rules everywhere and beat it in 6 of 10 windows; ride-the-trend
  alone averaged +4.7 (6 of 8). Pass, but every book loses under stress.
- **F4** standing aside beat the baseline in all six cells: the price-half
  baseline loses after costs everywhere.
- **F5-F7, F9** the ladder (-4.5), continuous (-3.7) and price (-3.5) stops
  and every time stop (-2.0 to -2.7) lost less than the flat stop (-5.5);
  none made money. **F8** fixed-risk sizing did not beat the stop change.
- **F11** 663 rule-tagged macro headlines: with the headline known, the
  close was on its side 55% of the time (FOMC 60%, jobs 57%, CPI 52%) and
  44% of moves were already priced the other way. Stock was the best
  structure; a single's break-even accuracy is on the Oracle section.
- **F15** walk-forward re-fitting lost less than fixed rules (-4.8 vs -6.0)
  but still lost: fail.
- **F17** stock-level labels beat one rule in 7 of 10 windows. Pass.
- **F18** the grade ranks names better when they move apart (IC 0.013) than
  when they move together (-0.058). Pass.
- **F22** none of the 11 survivors made money at double costs: fail.

The honest read: the price-half replay confirms the YTD backtest (the raw
grade loses after costs, exits only change how much) and gives the shadow
books and the archive test their baselines. No engine change follows from
it (G10).

## Positioning and credit labeler (November 12, 2026)

`lib/regime-lab/positioning.mjs` is a second, slower read beside the grid and
the hidden-Markov check. It labels each day logged in `grades-daily.json` from
the market gauge row the bake already keeps (`shadow.mkt`), so it adds no
download:

- **Crowd**: fear votes are the Cboe equity put/call in its top fifth of 250
  sessions, asset managers light on S&P 500 futures (CFTC z -1 or lower) and
  margin debt shrinking 10%+ a year; crowding votes are the mirror (bottom
  fifth, z +1.5 or higher, +25% a year). Two more fear votes read **washed
  out**, two more crowding votes **crowded**, else **neutral**; under two
  inputs reads nothing.
- **Credit**: Baa spread over the 10-year (stressed at 3 points, watch at 2.5,
  tight at 1.8), Kalshi recession odds (stressed at 40%, watch at 25%) and the
  Booms & busts warning-sign count (watch at 6 of 9). Any stressed vote or two
  watch votes read **stressed**, one **watch**, a tight spread with no worry
  **tight**, else **normal**.

The payload's `positioning` block carries today's labels with the votes, the
last 60 days, and SPY's next-10-session move by label beside the all-days
average ("collecting" until a label has 20 days). Days overlap, so it
describes; it does not test. Research only.

## The Owner Lab tab

Owner Lab → **Regime Lab**: today's cell on the six-cell grid with the
playbook in force, the era stop ladder and the book brakes; a label history
strip (era and character bands, VIX, switch marks) with the F2 stability
table; sessions that resemble now (F16); positioning and credit; stock labels (A10); the playbooks
and the shadow books against the live record, by cell; exits and risk (the
ladder, every open trade's risk score); book brakes on the record (F10); the
oracle by headline type with the engine-vs-oracle and ceiling reads; the AI
grader by cell (F20); the F1-F22 catalog; the G1-G10 guards; and the last
research run. "Refresh lab" re-reads the file. A public visitor never sees the
tab and never requests the file.

## Data and cost

`regime-lab.json` is written by every full build (`writeRegimeLab`), read
before the wipe (`loadRegimeLab`), Owner-only in `lib/premium-keys.mjs`, bake-owned
in `lib/data-ownership.mjs`, under about 600 KB (760 compact label rows, 400
closed shadow trades, the oracle by type). New record trades carry
`labRegime` and `riskScore`; each run archive record carries `lab`. No AI
call, no new fetch (labels read the shared long-history cache, VIX from the
global sweep, FRED CPI and payrolls already cached), no new serverless
function or workflow. Kill switch: `REGIME_LAB=0`.

## Commands

```bash
node scripts/regime-lab-smoke.mjs                 # npm run test:regime-lab
node scripts/regime-lab-browser.mjs               # npm run test:regime-lab-browser
node scripts/regime-lab.mjs labels --long <dir>   # label the long history
node scripts/regime-lab.mjs run --long <dir> --grades <price-half.json> --daily-grades <txt> --iv <iv-all.json> --out <private dir>
node scripts/regime-lab.mjs holdout --window 2022-bear ...   # runs a holdout once, then locks it
```

The long-history download is the `research/long-history` set from the
`backtest-data-long` branch (bars and FRED series since 2006); the grade
caches are the Owner's private research files. The runner writes the full
run to `--out` and the public-safe summary (verdicts and aggregate reads, no
trade rows, no record) to `research/regime-lab/results/latest.json`, which
the next build joins into the catalog.
