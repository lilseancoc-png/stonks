# Strategy engines

Six rules-only paper engines run beside Top Picks. Each has its own idea, its
own data, its own 0 to 100 score and its own track record. All of them trade
in the one Webull paper account that Top Picks uses. Paper tracking starts
2026-11-16.

None of them makes an AI call or a network request, and none can read or
change a Top Pick, a grade, a gate or the Top Picks Track Record. Top Picks
stays the flagship; the engines are the test bed.

Code: `lib/engines/`. Page: **Strategy engines** (`?tab=engines`, Owner ·
Ideas; `scripts/render/engines-client.mjs`). The engines have their own page
since 2026-11-16, so Top picks, Open picks and the Top Picks track record show
Top Picks only; Open picks carries one link with the engines' open-trade
count. `?tab=engines&engine=<id>&ev=<view>` opens one engine and view, and an
old `?tab=picks&engine=...` link lands on the new page. Tests: `node scripts/engines-smoke.mjs`, `node scripts/engines-mirror-smoke.mjs`,
`node scripts/engines-browser.mjs`.

## The engines

| Engine | Tag | Trades | Idea | Contract | Exits | Slots |
|---|---|---|---|---|---|---|
| Earnings & events | ERN | stocks | Drift after a real earnings surprise; the run-in before a report for stocks that usually climb into it (always closed before the report) | 21-60 days, 0.55 delta | +30% / -40%, 10 sessions | 5 |
| Macro | MAC | SPY, QQQ, IWM, TLT, GLD, EWY, KWEB | Rates, the dollar, financial conditions, the VIX curve, and the reaction to Fed, CPI and jobs days | 21-70 days, 0.50 delta | +30% / -40%, 12 sessions | 3 |
| Technicals | TEC | every covered name | Price and volume only: trend pullbacks, range breakouts and breakdowns, squeeze breaks | 30-90 days, 0.70 delta | +30% / -40%, 15 sessions | 5 |
| Fundamentals | FUN | stocks | One standing rank of every covered stock on earnings power, quality and price; calls on the best, puts on the worst, swapped only when a holding leaves its third | 75-200 days, 0.62 delta | +50% / -40%, 60 sessions, or the stock leaves its third of the rank | 5 (3 calls, 2 puts) |
| Flow & positioning | FLO | every covered name | Aggressive option buying at the ask, gamma set-ups near a call wall, short squeezes | 14-50 days, 0.50 delta | +35% / -40%, 7 sessions | 4 |
| Reversion | REV | every covered name | Washouts in long-term uptrends, spikes in long-term downtrends, capitulation days | 14-45 days, 0.60 delta | +30% / -35%, 5 sessions | 4 |

The registry is `lib/engines/config.mjs` (`ENGINES`): every setup, its
plain-language trigger, the entry bar and its limits, the exits and the
contract window. The rule code is `lib/engines/signals.mjs`.

How they differ from Top Picks, on purpose:

- **No shared grade.** Top Picks sums four pillars into one score. Each engine
  reads only its own kind of evidence and scores a named setup from 0 to 100.
- **No AI.** Top Picks has an AI final grader. The engines are rules only.
- **Singles only, different contracts.** One long call or put, one contract.
  Each engine has its own expiry window and delta.
- **Different exits.** Each engine has its own take-profit, stop and time
  limit; some setups carry their own (see the table on the page). Technical
  and reversion trades also carry a stock stop or target.
- **Different universe.** Macro trades funds only; Earnings and Fundamentals
  trade single stocks only.
- **Not all of them use a score and a bar.** Fundamentals enters by rank (see
  below). The engines may each use the system that fits their idea (owner,
  2026-11-16).

### Fundamentals: the standing rank (rules 2, 2026-11-16)

Fundamentals change slowly, so this engine no longer waits for the three
weeks after a report and scores one stock at a time against a bar. It keeps
one rank of every covered stock (`lib/engines/rank.mjs`).

- **What is ranked.** Every covered stock (no funds) with a beat record: three
  of its last four reports on file.
- **How.** Up to eleven numbers in three parts. Each number becomes the
  stock's place among the covered stocks that have it (0 worst, 100 best), so
  one outlier cannot dominate. *Earnings power* (40%): EPS against a year
  earlier, beats minus misses in the last four reports, whether growth is
  speeding up, the 30-day change in the full-year EPS estimate, revenue
  growth. *Quality* (30%): operating margin, return on equity, free cash flow
  against market value, debt against equity. *Price* (30%): forward P/E
  against its sector group's, the analysts' average target against the price.
  A part with no numbers is left out and the others carry its weight.
- **Standing.** A stock's number is fixed until the calendar month changes or
  the stock reports again, so one day's quote cannot reshuffle the book.
- **Entry.** A new call comes only from the 8 best-ranked stocks and a new put
  only from the 8 worst, best first. Not inside six sessions of the stock's
  report, not on its reaction day, not a call more than 8% under its 200-day
  or a put more than 5% above it, and not when today's price already ran
  (the same price filter every engine uses). The 0 to 100 number shown is
  the distance from the end of the rank; it orders the candidates and is not
  compared with an entry bar. The bar does not move for this engine.
- **Book.** At most three calls and two puts, one new trade a run.
- **Exit.** +50% / -40% on the option, 60 sessions (was 45), two sessions
  before expiry, or **the stock leaves its third**: a call closes when the
  stock is no longer in the top third of the rank, a put when it is no longer
  in the bottom third (close reason `rank-out`). With fewer than 12 ranked
  stocks there is no rank: nothing opens and nothing closes on it.
- **After a stop, take-profit or time limit** the same stock is not bought
  again until it is ranked again (next month or its next report).
- **Shadow trades.** A ranked name with no free slot is looked at again next
  run. It is not parked as a shadow trade. Muted setups, a stand-down and the
  brake still make shadow trades, as for every engine.
- **Old trades.** Trades opened under the first rules (`compounder`,
  `deteriorating`, now marked retired) keep their own exits and checks.
- **Version.** A running engine goes from `FUN-1` to `FUN-2` at its first run
  under these rules, with a note in its change log (`adoptRules` in
  `learn.mjs`, driven by `rules: { n, date, note }` in the registry). Split
  the record there.
- **Not tested on history.** The long history test has no fundamentals. The
  build's own two-year replay has only the report numbers, so it ranks on
  earnings power alone. This engine is judged forward.

### What each engine is fed

Everything is data the build already holds in memory at a Top Picks run.

| Engine | Data |
|---|---|
| Technicals | Confirmed daily bars (open, high, low, close, volume) |
| Reversion | The same bars, plus report dates (it stands aside near a report) |
| Macro | FRED 10-year and 2-year yields, the curve, fed funds, Chicago Fed financial conditions, the trade-weighted dollar, CPI, unemployment, the recession flag; the VIX curve; Fed, CPI and jobs dates; fund bars and chains |
| Earnings | The stored report list (dates, sessions, EPS, surprise, guidance, implied move), reactions and run-ins from bars, the shared IV band |
| Fundamentals | EPS growth and the beat record from the report list, estimate revisions, margins, cash flow, debt, forward P/E against the sector group, analyst targets |
| Flow | Unusual prints at the ask and their premium, the 7-day flow balance, OI walls and the gamma score, short interest, FINRA short-sale volume, borrow, the hourly volume read |

Every engine also gets the option chain, and every trade is stamped with the
Regime Lab market type and the macro backdrop (Fed policy, inflation,
financial conditions, yield curve, VIX level, economy) on the day it opened.

Only confirmed bars are read: nothing dated today reaches a signal, live or
in the history test.

## When they act

At the 11:00 and 15:30 ET Top Picks runs, right after the Top Picks record is
written. That is when the Webull mirror is pinged, so the record and the paper
account move together. Every other build re-writes the three files exactly as
it read them.

Each run, in order (`stepBook` in `lib/engines/book.mjs`):

1. Mark every open trade and shadow trade on the chain and close the ones
   whose exit fired: take-profit, premium stop, trailing stop, stock stop,
   price target, time limit, event exit, setup no longer valid, two sessions
   before expiry, or the name left coverage (not counted).
2. Let each engine learn from what closed.
3. Score this run's candidates and open new trades inside each engine's slots
   and per-run limit, five new engine trades a run at most.

**Turns (2026-11-16).** The five are handed out in turns: each engine opens at
most one trade per pass, in order, and passes repeat until the five are used
or no engine has a candidate left. The engine that goes first moves on by one
every run (`state.turn`; the run log's "Went first" column),
so no engine keeps first call on the shared limit. Before this the engines
were served in a fixed order and the first ones could use all five.

**Price filter rows.** A setup that matches but whose price already ran more
than 1.5 ATR its way today, or moved more than 0.9 ATR against it, is not
scored and not traded (this rule is unchanged). Since 2026-11-16 those rows
are listed under Now with no score and the reason ("price already ran X ATR
its way today (not chased)"), up to six per engine. They are never traded,
never tracked as shadow trades and never count as seen.

**Reversion and earnings.** Reversion stands aside from two sessions before a
report through the first full session after it. A report after the close on
the last confirmed bar counts too (`earnView().reacting`): the stock is
trading on that report during today's run, so Reversion opens nothing in it.

The engines act only while the market is open. A forced build on a weekend, a
holiday, before the open or after the close carries the files forward: no
marks, no session counted, no trades.

Contract screen: mid at least $0.30, spread at most 18% of the mid, open
interest 50+ or volume 10+, one contract at most $5,000.

## The record

Three Owner-only files (`lib/premium-keys.mjs`), read before the build wipes
`data/` and written after:

| File | Holds |
|---|---|
| `engines-record.json` | Every engine's open and closed trades. The track record. |
| `engines-state.json` | Each engine's learning state: outcome log, shadow trades, entry bar, rules version, change log |
| `engines.json` | The page file: candidates, open trades, scorecards, the history test |

The Top Picks Track Record (`picks-accuracy.json`) is never read into these
and never written by this code. Trade IDs carry the engine tag:
`TEC:AAPL-C-11/16/26-11:00`.

Results are modeled from option mids at each run, like the Top Picks record.
The Webull paper tab shows what the paper account actually filled.

A file that is missing is a fresh start. A file that is there and cannot be
read skips the engines for that build and keeps the stored copy (an empty
record never replaces a real one).

## Same contract on two engines

When two engines, or an engine and Top Picks, pick the exact same contract
(ticker, expiry, strike, call or put):

- Whoever held it first owns the one paper position.
- The other still records the trade on its own track record, labeled "Held by
  <engine>". It is not bought a second time.
- The holder's trade is labeled "Also on <engine>".
- Open picks shows a note when a Top Picks trade shares a contract.

The engines flag this themselves when they open a trade. The mirror also
checks, which catches Top Picks opening a contract an engine already holds.

Limits to know:

- The follower's result is tracked on option mids, not on a fill, because it
  has no fill.
- When the holder closes first, the paper position is sold. The follower's
  trade carries on in its own record on mids until its own exit.
- A different strike or expiry on the same stock is a different contract and
  is bought normally.

## Webull paper mirror

`lib/webull-mirror.mjs` reads both records at each mirror run: Top Picks rows
first, then engine rows. Every ledger trade carries `engine`, so reports split
cleanly:

- `/api/auth/webull-mirror` returns Top Picks trades only, as before.
- `?scope=engines` returns engine trades, `?scope=all` both. CSV downloads
  take the same parameter.
- The Top Picks Real fills tab never shows an engine trade.

If the engines' record cannot be read, the Top Picks mirror still runs and
engine trades already in the ledger are held as they are for that run.

**Which engine made a trade (2026-11-16).** Four labels, all from the same
stored `engine` field:

- The trade ID starts with the engine's tag (`TEC:AAPL-C-...`).
- The order ID sent to Webull starts with `ms` plus the tag in lower case
  (`mstec...`, `msrev...`), 30 characters as before. A Top Picks order is `ms`
  plus 28 hex characters, which can never spell a tag. Orders sent before this
  change keep the ID they were sent with (plain `ms`). Whether the Webull app's
  own order screen shows this ID has not been checked; the API and exports do.
- Both CSV downloads have a `made_by` column (the engine's name, or "Top
  Picks"; never blank), and the orders CSV has `webull_order_prefix`.
- The Strategy engines page shows "Made by" and the order prefix per trade.
  The full order ID is never sent to the browser.

## Learning

Each engine checks its own results and tightens itself, inside fixed limits
(`lib/engines/learn.mjs`):

- **Brake.** Five losses in a row, or the last eight trades averaging -20% or
  worse, pauses new trades for five sessions.
- **Setup mute.** A setup whose 40+ results are clearly losing stops trading.
- **Market-type stand-down.** A market type whose last results are clearly
  losing is skipped.
- **Entry bar.** Moves up when trades just over the bar lose and higher scores
  did better; down when setups just under it would have won. It stays inside
  the engine's limits. Fundamentals enters by rank and has no bar to
  move.

A mute, a stand-down and a bar move each need a result unlikely to be luck.
Learning can only hold an engine back. It never adds size, slots, setups or
data, and it never touches Top Picks.

**Shadow trades.** A setup the engine saw and did not buy (muted, under the
bar, standing down, no free slot) is tracked as a shadow trade: priced like a
real one, never sent to the paper account. Shadow trades are how a muted
setup earns its way back, and they show what each limit costs. A shadow trade
never blocks a real one.

**Starts on shadow.** Six setups lost more than 3% a trade in both halves of
the first history test. They are tracked from day one and start trading only
when 40+ shadow trades average +5% or better.

Every change bumps the engine's rules version (`TEC-2`, `TEC-3`, …), goes in
its change log and is stamped on new trades, so the record can be split by it.

Top Picks learns through its own loop (`docs/self-loop.md`), which stays in
shadow until 2026-12-07. Nothing here changes that.

## History test

`node scripts/engines-backtest.mjs --long <dir>` replays Technicals, Reversion
and Macro day by day through the same `stepBook` code over the long-history
download, with modeled option prices (Black-Scholes at 1.15x realized
volatility) and 3.5% of premium taken as costs per round trip. It writes
`research/engines/results/latest.json` (aggregates only), which the page shows
split by time period, Regime Lab market type and macro environment.

Three versions of each test: every setup with no learning, shadow-start setups
held back with no learning, and the engine as it runs (learning on). Each is
compared with books that bought the same kind of contract on random days.

Result, 2007 to 2026, as each engine runs:

| Engine | Trades | Win rate | Average trade | Random entries | Beat random |
|---|---|---|---|---|---|
| Technicals | 1,043 | 45% | -2.3% | -1.7% | 35% of books |
| Reversion | 1,134 | 47% | -1.1% | -4.0% | 85% |
| Macro | 473 | 50% | +1.8% | -6.8% | 100% |

Honest read: no engine shows a reliable profit after costs. Reversion and
Macro did better than random entries; Technicals did not. The learning rules
worked as a brake, not an edge: they roughly halved the largest drop for
Technicals and Reversion and did not improve the average trade.

What the test cannot see:

- Real spreads and real implied volatility are not in the history.
- The names are today's list, so companies that failed are missing.
- The six shadow-start setups were picked with hindsight on this same history.
- Earnings and Fundamentals need report dates and EPS from the private store,
  so they are not in the long run. Every build replays them over the bars it
  holds (the "Recent replay" on the page). Pass `--earnings FILE` with a
  hydrated `earnings-history.json` to include them.
- Flow has no stored history. It is judged forward only, on its paper record
  and its shadow trades.

## Switches

| Switch | Where | Effect |
|---|---|---|
| `ENGINES` | GitHub repo variable | Unset = on. `pause` = manage open trades, open none. `0` = freeze (files carried forward untouched) |
| Strategy engines | Owner Settings → Data & desks | The same switch on the site: On, Manage open trades only (`pause`), Frozen (`off`). Applies from the next Top Picks run. A repo variable, when set, wins |
| `ENGINES_OFF` | GitHub repo variable | Comma list of engines that open no new trades (`earnings`, `macro`, `technicals`, `fundamentals`, `flow`, `reversion`, or their tags) |
| `ENGINES_MIRROR` | Vercel env | `0` stops new engine trades entering the paper account. Trades already there keep being managed and closed |

## Not in scope

- No real money and no broker other than the Webull paper sandbox.
- No spreads.
- No engine result feeds a Top Picks grade, gate or record.
