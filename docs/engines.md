# Strategy engines

Eight rules-only paper engines run beside Top Picks: six signal engines and,
since 2026-11-17, two core engines. Each has its own idea, its own data and
its own track record. The signal engines score their own setups 0 to 100 and
trade options (and $5,000 share lots on the slow call setups) in the one
Webull paper account that Top Picks uses. The core engines (Trend follower,
Momentum basket) hold long-only shares picked at a monthly check, on the
record only. The Allocator (2026-11-17) reads every signal setup's record in
today's market type; see [Allocator](#allocator-2026-11-17). Paper tracking
starts 2026-11-16.

None of them makes an AI call or a network request, and none can read or
change a Top Pick, a grade, a gate or the Top Picks Track Record. Top Picks
stays the flagship; the engines are the test bed.

Code: `lib/engines/`. Page: **Strategy engines** (`?tab=engines`, Owner ·
Ideas; `scripts/render/engines-client.mjs`). The engines have their own page
since 2026-11-16, so Top picks and the Top Picks track record show Top Picks
only. Since 2026-11-19 (owner) Open picks lists every open trade in the Webull
paper account: the Top Picks trades, then a "Strategy engine trades" table
(engine, trial and test trades, each with the engine that made it and a Webull
column from `/api/auth/webull-mirror?scope=all`), then any trade still working
at Webull after its record closed (`engOpenPicksHtml`, `opLoadWebull`,
`opWebullOnly` in `engines-client.mjs`). Nothing there changes a record. `?tab=engines&engine=<id>&ev=<view>` opens one engine and view, and an
old `?tab=picks&engine=...` link lands on the new page. The All engines tab
holds the side-by-side scorecards, one running-total chart with a line per
engine that has closed trades (each engine flat at 0 until its first close),
and one table of every engine's open trades (sortable; "Held by" shows a
contract another engine or Top Picks already holds). Tests: `node scripts/engines-smoke.mjs`,
`node scripts/engines-mirror-smoke.mjs` and `node scripts/engines-browser.mjs`;
all three run in the Update checker CI job (no npm scripts, on purpose).

A Fundamentals trade's reasons read "Ranked 3 of 69 stocks with full data":
the count is the ranked stocks (covered stocks with a beat record, no funds),
not all 85 covered names.

## The engines

| Engine | Tag | Trades | Idea | Contract | Exits | Slots |
|---|---|---|---|---|---|---|
| Earnings & events | ERN | stocks | Drift after a real earnings surprise; the run-in before a report for stocks that usually climb into it (always closed before the report) | 21-60 days, 0.55 delta | +30% / -40%, 10 sessions | 5 |
| Macro | MAC | SPY, QQQ, IWM, TLT, GLD, EWY, KWEB | Rates, the dollar, financial conditions, the VIX curve, and the reaction to Fed, CPI and jobs days | 21-70 days, 0.50 delta | +30% / -40%, 12 sessions | 3 |
| Technicals | TEC | every covered name | Price and volume only: trend pullbacks, range breakouts and breakdowns, squeeze breaks | 30-90 days, 0.70 delta | +30% / -40%, 15 sessions | 5 |
| Fundamentals | FUN | stocks | One standing rank of every covered stock on earnings power, quality and price; calls on the best, puts on the worst, swapped only when a holding leaves its third | 75-200 days, 0.62 delta | +50% / -40%, 60 sessions, or the stock leaves its third of the rank | 5 (3 calls, 2 puts) |
| Flow & positioning | FLO | every covered name | One-sided signed option flow (trades bought vs sold, in delta dollars; since 2026-11-16), gamma set-ups near a call wall, short squeezes | 14-50 days, 0.50 delta | +35% / -40%, 7 sessions | 4 |
| Reversion | REV | every covered name | Washouts in long-term uptrends, spikes in long-term downtrends, capitulation days | 14-45 days, 0.60 delta | +30% / -35%, 5 sessions | 4 |
| Trend follower | TRD | SPY, QQQ, TLT | Core: at each monthly check, the stronger of SPY and QQQ over 12 months if it beat T-bills, else TLT if it beat T-bills, else cash | $50,000 of shares | Swapped at the monthly check only | 1 |
| Momentum basket | MOM | every covered stock | Core: the ten strongest by 12-1 momentum, equal weight; TLT with the basket's money while SPY closes a month under its 10-month average | $3,000 of shares each ($30,000 of TLT) | Swapped at the monthly check only | 10 |

The registry is `lib/engines/config.mjs` (`ENGINES`): every setup, its
plain-language trigger, the entry bar and its limits, the exits and the
contract window. The rule code is `lib/engines/signals.mjs`.

### Core engines: Trend follower and Momentum basket (2026-11-17)

The owner's plan for beating the S&P 500 is a long-only stock core that
follows trend and momentum, with the signal engines as a smaller timed
options sleeve. The two core engines are that core, built from the rules that
beat holding the S&P 500 in the 1972-2026 and 2006-2026 research
(`engines/beat-sp500-2026-11-17` in the project files). Code:
`lib/engines/core.mjs`.

- **Monthly check.** Both read month-end closes (`monthEnds` in
  `features.mjs`, on each view as `view.mo`; a bar counts as a month-end once
  a later month has started). The target is fixed from one month-end to the
  next (`standCore`, "standing" like the Fundamentals rank), so a day's quote
  cannot reshuffle the book. A holding closes only as `rotate` ("swapped at
  the monthly check") when the next check drops it (`thesisCheck`). No stops,
  no targets, no time limit, no learning, no cooldown.
- **Trend follower (TRD).** Compares SPY's and QQQ's 12-month returns and
  holds the stronger if it beat T-bills; otherwise TLT if TLT beat T-bills;
  otherwise nothing. T-bills = the average fed funds rate over the 12 months
  (`ctx.macro.cash12`). One $50,000 lot.
- **Momentum basket (MOM).** Ranks the covered stocks (needs 20 or more) by
  the rise from 12 months ago to 1 month ago and owns the ten strongest at
  $3,000 each. While SPY's month-end close is under its 10-month average it
  owns $30,000 of TLT instead (nothing when TLT also trails T-bills).
- **Book.** Core trades are exempt from the book's per-run cap and from the
  Allocator, buy shares only, and (since 2026-11-19) are bought as stock in
  the Webull paper account at the record's share count. The
  page shows each core engine as a portfolio: the holdings, the last monthly
  checks, the ranked list (Momentum), and dollars since its first trade
  against the same dollars in SPY bought that day (`coreBench`).
- **History score.** A $1 portfolio that follows the holdings at each open
  and close, idle money earning fed funds, 0.1% costs a round trip, against
  SPY bought the same day (`coreMark` in `backtest.mjs`).

### Real option prices for later history tests (2026-11-19)

The Webull daily data runner (`docs/webull-data.md`) now saves a daily snapshot
of every covered name's option quotes and the daily bars of each contract after
it expires. `scripts/webull-options-export.mjs` writes them as research-kit
files in the same row shape as the DoltHub history pull. Nothing in
`lib/engines/backtest.mjs` reads them yet; using them in place of the
model price is a later step.

### Shares for the slow setups (rules 2, 2026-11-17)

The 1971-2026 history test split every trade into idea, timing and contract.
For most call setups the idea was right more often than not, but the stock
moved too little in the holding time for a 0.5-0.7 delta option to beat its
own decay and spread. Those setups now buy stock on their call side
(`calls: "shares"` in the registry; `instrumentFor`):

| Engine | Buys shares | Stays on options |
|---|---|---|
| Technicals | trend pullback, range breakout | squeeze, every put |
| Reversion | capitulation day | washout in an uptrend, every put |
| Earnings | post-earnings drift (calls) | run-in, drift puts |
| Flow | aggressive flow (bullish), gamma set-up, short squeeze | bearish flow (puts) |
| Macro | gold with yields and the dollar, dollar against Asia funds (both still on shadow) | conditions easing, yields falling, event drift, every put |
| Fundamentals | none | rank-top calls, rank-bottom puts |

A share trade (`sharesContract` in `contracts.mjs`, `BOOK.shares*`):

- $5,000 of stock at the run's price (the same 11:00 and 15:30 ET runs), whole
  shares; a share dearer than $5,000 is not bought.
- Marked at the stock price. Its result (`optionPnlPct`, kept as the field
  name) is the stock move less 0.1% a round trip.
- Exits: the setup's own stock stop or 2 ATR under the entry, whichever is
  higher; the setup's own target or 3 ATR over it, whichever is lower; the
  setup's thesis and event exits; 20 sessions at most. No premium take-profit
  or stop, and no expiry.
- Long only. A put is always an option: the engines never short stock.
- Trade ID marked `S` (`TEC:AAPL-S-11/17/26-11:00`), "Shares" badge on the
  page, `instrument: "shares"` on the page file.
- Scored apart: each engine's `stats` are its option trades, `sharesStats` its
  share trades (% of the share price), and the totals the same way. Learning
  counts a share result 5x (`LEARN.sharesScale`, about the leverage of the
  engines' options) so its thresholds mean the same thing; its change notes
  say so.
- Bought as stock in the Webull paper account since 2026-11-19 (the record's
  whole-share count, moved inside the Owner's $2,000 to $25,000 stock order
  range, long only; Owner Settings `WEBULL_SHARES` off leaves them
  on the record only, as before). Share trades opened before share orders went
  live (`sharesGoLiveIso`) are never bought late. The same-contract rule does
  not apply: each engine buys its own shares. See docs/webull-paper-controls.md.

`ENGINES_SHARES=0` (Owner Settings → Data & desks → "Engines buy shares
for slow setups"; there is no repo variable, so the daily workflow is
unchanged) puts every setup back on calls; open share trades still run to
their exits.

Macro's "VIX curve back to normal" setup (SPY calls) was dropped the same day:
it lost 11.6% a trade over 128 trades in the 1971-2026 test. It stays in the
registry as retired so old shadow rows keep their label.

### Money-leak fixes (rules 3, 2026-11-17)

The owner asked where the signal engines lose money. Every 2007-2026 history
trade was replayed with other entries, exits, contracts and stops, and each
candidate fix was then checked again inside the whole book: the full history
re-run with that one fix switched off, so a trade held longer blocks the next
one the way it does live. Five changes went in (rules 3 on every signal
engine, one logged rules change each):

| Fix | What changed | Full book, as the engine runs | Switch (Owner Settings → Data & desks) |
|---|---|---|---|
| Retire two put setups | Reversion's spike-in-a-downtrend fade and Technicals' range breakdown open nothing (they stay in the registry as `retired`, so old trades keep their labels and checks) | Reversion $72,000 → $136,700, Technicals $49,900 → $52,500 | `ENGINES_FIX_RETIRE_PUTS` |
| Washout-bounce calls | Reversion's `oversold-bounce` buys calls of about 0.3 delta, 14 to 35 days out (ideal 21), with a -60% stop (`contract` and `exits` on the setup; `contractFor` / `exitsFor` in `config.mjs`) | +0.8% → +7.7% a trade (981 → 884 trades), ahead in both halves | `ENGINES_FIX_BOUNCE` |
| $2,000 of premium | Each option trade records the number of contracts nearest $2,000 (`optionQty`, at least one; `qty` on the contract, `positionUsd` / `tradeUsd` count it). Percent results are unchanged; the dollar totals now weigh every trade about the same. Since 2026-11-19 the Webull paper account buys the same `qty` (capped at 10; one contract for trades opened before 2026-11-17) | Dollars only | `ENGINES_FIX_SIZE` |
| Technicals share stop | Share trades stop 3 ATR under the entry instead of at the setup's own tighter stop or 2 ATR (`sharesStopAtr: 3`, `sharesOwnStop: false` on the engine) | +0.5% → +0.9% a trade on 1,158 share trades | `ENGINES_FIX_TEC_SHARES` |
| Live against the test | Each engine's Track record tab shows every setup's live record under the current rules beside the same setup in the history test (`liveVsHistory`, read once a setup has 10 closed trades: in line within 5 points, else ahead or behind). Macro setups whose test gain came mostly from the option price model are marked | Page only | None |

Not made: **no take-profit on Macro's yields-falling TLT calls.** Trade by
trade it looked far better (+29.3% against +11.8% on the same 115 entries),
but in the full book each call sat up to 12 sessions and blocked the next TLT
signal: 72 trades and $17,356 against 115 and $27,060. The owner chose to keep
the +30% take-profit (2026-11-17). Lesson kept for later fixes: score a rule
change inside the book, never on a fixed list of trades.

The bounce's -60% stop is the least settled part: with every setup trading the
engine's -35% stop did a little better, as the engine runs the -60% did, and
no stop beat both in both runs (not adopted: more fitting to the same history).

Each switch is on by default; off puts that part back for new trades only
(open trades keep the exits and size they opened with). `engineSpecs(fixes)`
builds the registry with some fixes off and the rules note rewritten to list
only the fixes on; switching one off or back on is logged as a rules change
on the engines it reaches (`rules.key` / `rules.switchNote`, `adoptRules`), so
the record and the live-against-test table split there, and each new trade
carries `fixesOff` with the switched-off fixes that reach its engine. An
engine still on its first rules gets the rules 2 and rules 3 notes in one
change (`rules.before`). The page's All engines tab lists the fixes with their
state; the Setups and learning tab lists every hand-made rules step. These
fixes were picked from the same history they are scored on, so the live
record is the real test.

### Paper trials (rules 4 on Reversion and Macro, 2026-11-19)

A paper trial is a setup the history test did not prove but that may do
better live. It runs on paper beside the engine, labeled unproven, behind its
own switch, so the live record can decide. Both come from the
2026-11-19 strategy test series (553 variants tried on 2007-2026 bars with
real Cboe implied volatility; no idea cleared the trials-adjusted bar of
t 3.9):

| Trial | Rule | What the history showed | Switch (Owner Settings → Data & desks) |
|---|---|---|---|
| RSI(2) dip in an uptrend (`rsi2-dip`, Reversion) | Above the 200-day with a 2-day RSI under 5. Buys $5,000 of stock (never options: calls on these dips lost money on real option prices) and sells on a close back above the 5-day average, after 10 sessions, or at the usual 2 ATR stop / 3 ATR target | +0.62% a trade, t 3.0 against random days in the same names and t 5.1 against SPY, alike in 2007-16 and 2017-26; weak on sector funds (+0.21%). Through the engine code: 2,439 trades, +0.4%, 64% wins, at or above zero in 18 of 20 years (2008 and 2018 lost) | `ENGINES_TRIAL_RSI2_DIP` |
| Index funds after extreme fear (`fear-index`, Macro) | The day after CNN Fear & Greed first closes under 25 (the last two daily closes before the run, from `fear-greed-history.json`, read by `fearReading` in `macro.mjs`; none older than 5 days), buys $5,000 each of SPY, QQQ and IWM and holds them 20 sessions with no stop or target (`levels: false`), as tested | Through the engine code on our rebuild of Fear & Greed (entry at the next open, `--fg <file>` on the history test, version 4): 216 trades, +1.0% a trade, 63% wins; by period 2008 -1.4%, 2009-12 +0.2%, 2013-17 +2.5%, 2018-19 +2.2%, 2020 -2.9%, 2021 +3.4%, 2022 -2.4%, 2023-24 +5.2%. The first numbers quoted for it (+1.26% over 162 trades, -0.06% / +2.49% by half, and 162 trades at +1.3% through the engine code) read the rebuild file's third column, the VIX, as the score (fixed 2026-11-19 in the merge with #873: the history test reads the second column). Unproven; the owner asked for it on paper (2026-11-19) | `ENGINES_TRIAL_FEAR_INDEX` |

In the engine's own history test (`research/engines/results/latest.json`,
version 3, and version 4 since the merge with #873) each trial is scored
apart and set against 20 books of random $5,000 lots in the names it traded,
each lot held no longer than a real trial trade drawn beside it and with the
same exits. The edge is small: +0.1 points a trade for the RSI(2) dip (2,412
trades, it beat 60 to 75% of the books; 27 fewer than before #873 because it
now leaves a stock the extreme-fear test holds) and +0.1 for index fear on
the Fear & Greed score (65 to 70%). Before version 3 every random share lot rode up to 20
sessions, which made short holds look worse than random; the engines' own
share setups now use matched holds too.

How a trial is kept apart (`trial: true` on the setup, `trial` on each trade):

- **Own slots.** Each trial has its own open trades and new ones a run (RSI(2): 4 and 2; index fear: 3 and 3),
  outside the engine's slots, the per-run cap of five and `bestPerSymbol`, so
  it never takes a place from a proven setup (the history test's option lines
  are unchanged with either trial on). It is offered after every engine's own
  turn.
- **No learning, no Allocator.** Its closes are not fed to the engine's
  learning or the Allocator, a loss starts no cooldown, and the Allocator
  never reads, sizes or holds back a trial, so an unproven rule cannot pause,
  mute or reweight a proven one.
- **Scored apart.** `engineStats` puts trial trades in their own `trials`
  block (live and in the history test), so they never move an engine's
  option or share numbers. The page shows a Paper trial badge on the trade,
  setup and live-against-test rows, a "Paper trials" section on each
  engine's record, and "Paper trials in this test" on its history tab.
- **Shares only.** With `ENGINES_SHARES=0` it opens nothing.
- **Rules version.** Turning a trial on or off is a rules change on its
  engine (`trialRules`, rules 4 with it on), so the record splits there.
  Off marks the setup `retired` for new trades; open trial trades run to
  their exits.
- **Webull.** Since #869 the mirror buys engine share trades as stock, so a
  trial's trades reach the paper account like any engine share trade
  (`ENGINES_MIRROR=0` stops new ones).

The RSI(2) trial survived a test on the same history it came from, and the
stocks are today's names (survivor bias). The index-fear trial did not pass
at all; the live CNN index also differs from the rebuild it was tested on
(six of CNN's seven parts, no put/call history). The live record is the
real test for both. A 10-day-average exit for the RSI(2) trial is not run
beside it: it can be read later from each trade's entry and the daily bars.

### Honest paper trades (rules 4, rules 5 on Reversion and Macro, 2026-11-19)

The owner asked for a paper record a real trader would recognise: fills a
broker would give, a size that depends on the risk and on how good the setup
looks, and the losing option setups moved to shares. Six changes went in,
one logged rules change on every signal engine: rules 4 on Earnings,
Technicals, Fundamentals and Flow, and rules 5 on Reversion and Macro, where
the paper trials above are rules 4 (`fixRules` builds rules 3, then
`trialRules`, then this step, so each gets its own dated divider). Each is an
Owner Settings switch (Data & desks → Strategy engines), on by default; off
puts that part back for new trades only (open trades keep the fill basis, size
and exits they opened with), and a flip is logged as a rules change on the
engines it reaches, like the rules 3 fixes (`ENGINE_FIXES` entries with
`step: 4`).

| Change | What changed | Switch |
|---|---|---|
| Fill basis | A new option trade books the **ask going in and the bid coming out** (`entryFill`, `exitFill`, `basis: "bid"`, or `"est"` = the mark less half the spread the contract had at entry when the chain has no two-sided quote). Stops and targets still fire on the mid; only the booked result changes. The page shows "booked: ask → bid" beside the mid result | `ENGINES_FILL_BASIS` |
| Risk sizing | Each trade risks about `ENGINES_RISK_USD` (default $2,000, 500 to 10,000). An option expiring within 30 days (`BOOK.riskWholeDte`) risks its whole premium, a longer one premium × its stop × 1.25 (`riskStopPad`); 1 to 10 contracts (`riskMaxQty`; 1 to 25 since 2026-11-20, see "Contract cap" below). A contract costing over 2× the budget (`riskSkipX`) is not bought: the call side buys shares instead, a put is skipped. A share trade risks entry minus stop per share, at most $25,000 of stock (`sharesMaxUsd`). Every trade stores `qty` and `flatQty` (`shares` / `flatShares`) and a `size` object with the arithmetic. Off = the rules 3 sizing (about $2,000 of premium, or one contract with `ENGINES_FIX_SIZE=0`; $5,000 share lots) | `ENGINES_RISK_SIZE`, `ENGINES_RISK_USD` |
| Conviction multiplier | The risk size times a multiplier, 0.5× to 2× (`BOOK.convMin` / `convMax`), the product of small parts in `SIZE_WEIGHTS`: the score over the engine's entry bar (0.85× at the bar to 1.25× at 20+ points over), the Allocator's read (held back 0.75×, size 1.5×+ 1.15×, 0.5× or less 0.85×), option IV against the stock's own history (cheap 1.15×, rich 0.85×, very rich 0.75×), the spread (over 8% of the mid 0.9×, over 12% 0.8×), the name already open in another engine or Top Picks 0.75×, two or more open trades in its sector group 0.85×. Each trade shows its parts (`convictionRead`, `size.parts`). Off = the flat risk size | `ENGINES_SIZE_MULTIPLIER` |
| Instrument per engine | Each signal engine can buy options, shares on the up side (puts stay options: the engines never short stock) or both (an option trade plus a shares twin, scored apart) | `ENGINES_INSTRUMENT_EARNINGS`, `_MACRO`, `_TECHNICALS`, `_FUNDAMENTALS`, `_FLOW`, `_REVERSION` (default = the registry) |
| Technicals shares only | Technicals' squeeze calls buy shares, and its squeeze puts and rally fade are retired (they stay in the registry so old trades keep their labels) | `ENGINES_TEC_SHARES_ONLY` |
| Crash stand-aside | Reversion's washout bounce (`oversold-bounce`, `crashStand: true`) stands aside when the prior five sessions held a one-day drop of 7% or more (`BOOK.crashDrop`, feature `worst5`); listed under Now with the reason | `ENGINES_CRASH_STANDASIDE` |
| Extreme-fear bounce test | Reversion's `fear-bounce` (`test: true`): the same washout, only while CNN's fear and greed reading is under 25 (`BOOK.fearBelow`; a reading over 3 days old or marked stale is ignored, `fearRead`), with the crash stand-aside built in. Buys one call of about 0.3 delta 14 to 35 days out (fixed at one contract) plus a shares twin, and never takes a contract another trade holds (`avoid`), so the Webull paper account fills it on its own. Labelled Test on the page; test trades never move learning or the Allocator hold-back | `ENGINES_FEAR_BOUNCE` |

How it sits with the paper trials and the Owner controls (merged
2026-11-19):

- **Owner controls first.** In `consider()` Stop new trades and Avoid run
  before the extreme-fear pool, the shares twin and the sizing, so they hold
  every new trade (a twin and an `-XF` trade included, never shadowed). The
  risk dial's bar change applies to the fear test like any setup, and its
  size (half or 1.5x) multiplies the risk size of the option trade and of its
  shares twin; an account limit is checked on the option trade, then on the
  twin with the option already counted (a twin a limit stops is not opened,
  the option trade stands). The twin counts as a new trade for the
  new-trades-a-day limit.
- **No double opens.** A paper trial is counted in no pool, slot or run
  limit of the engine's own setups (#870's rule), and the extreme-fear test
  and the RSI(2) dip trial, both on Reversion, never hold the same stock:
  whichever opened first keeps it (the fear test runs in the engine's turn,
  the trials after every engine). The two fear rules firing on the same
  reading is intended: the fear bounce buys a washed-out stock (option plus
  shares) on CNN's current reading, the index-fear trial buys SPY, QQQ and
  IWM shares on Macro the day after the first close under 25.
- **Sizing.** A paper trial keeps its tested $5,000 lot: risk sizing and the
  conviction multiplier do not reach it (the dial and the account limits do).

**The Webull paper account buys each trade's size** (since #869, 2026-11-19):
an option trade sends its record `qty` (1 to 10, the same cap as risk
sizing; 1 to 25 since 2026-11-20) and a share trade its whole-share count, so risk sizing and the
conviction multiplier reach the paper account (Owner Settings `WEBULL_QTY` /
`WEBULL_SHARES` turn that off). The fill basis stays on the engine record:
Webull fills at its own prices, and the mirror's exit ladder starts from the
model mid (`markPnlPct`), not the booked bid.

History test (`node scripts/engines-backtest.mjs --long <dir> --fg <fear and
greed file>`, 2007-2026, modeled option prices, version `engines-backtest-4`;
figures below are the shadow-start-held-back run, learning off, with the
research kit's fear and greed rebuild):

- With every rules 4 switch off (`--off fillBasis,riskSize,conviction,tecShares,crashStand,fearBounce`)
  the merged code reproduces main's committed result (rules 3 plus the paper
  trials) exactly, apart from the fields this change adds (`flatUsd`, share
  splits by environment), when it is given the same fear input main's run
  used (see the index-fear note under Paper trials).
- At the old sizing (`--sizing premium`), the rule changes take the option book
  from $124,398 (1,754 trades) to $205,194 (1,590): Reversion 1,029 → 1,039
  trades, +5.3% → +9.2% a trade (the crash stand-aside, and the fear test's
  126 calls at +19.4%), Technicals options to none and 1,600 share trades at
  +1.1%. Side effect: capitulation shares now get through on some crash days.
- Those numbers ran on the 85 names covered before the wide tier (#875). The
  committed result (`research/engines/results/latest.json`, re-run
  2026-11-19 on the 80 tracked names, risk sizing, `--fg` from the research
  kit) reads: Technicals 1,600 share trades at +1.3% a trade, Reversion 1,024
  option trades at +9.6% and 242 share trades at +0.1%, Macro 551 option
  trades at +1.4%, the Momentum basket 540 swaps (11.4% a lot), the Trend
  follower unchanged (33 swaps).
- Risk sizing changes dollar weights, not percent results: options $82,600
  (flat size $79,526, so the multiplier adds about 4%), shares $337K (lots up
  to $25,000 of stock against the old $5,000). The option total falls because
  cheap contracts are capped at 10 and counts round down. By half the
  multiplier is a wash (whole book, learning off: about -1% in 2007-2016, +1%
  in 2017-2026), so it is shown as how a trader would size, with the flat
  result beside it, not as an edge. A $5,000 budget lowers the option total:
  dear contracts get more weight and Macro's dear calls lose.
- The fear test, on a rebuilt fear and greed series (`--fg FILE`): calls 126
  trades at +19.4% a trade on modeled prices, shares twins 172 at +0.2% (fewer
  than before the merge with #870: it now leaves a stock the RSI(2) dip trial
  holds). On
  real implied volatility (Cboe indexes, the 2026-11-19 research) the same
  calls lost 9.3% a trade, which is why it is a labelled test.
- On real implied volatility (Cboe's indexes, a stand-in for names without
  one; learning off) the option book still loses: rules 3 lost 2.2% a trade
  (1,793 trades), rules 4 loses 1.4% a trade (1,519 trades; Reversion -2.7%
  to -1.4%, Technicals' losing options gone). Share trades hold at +1.1% a
  trade either way. The engines' option edge is not proven; the paper record
  is the test.
- The fill basis is not in the history test (the modeled prices have no bid
  or ask; the 3.5% round-trip cost stands in for the spread).

Rerun flags: `--sizing risk|premium|one`, `--budget N`, `--conviction 0`,
`--off <ids>` (`ENGINE_FIXES` ids), `--inst engine=options|shares|both`,
`--fg FILE` (`[date, score, vix]` rows: the score is the second column), `--cost N`, `--iv-ratio N`. Each result lists
`sizing` and the changed `assumptions`, and carries `flatUsd` (the same trades
at the flat size).

Not built (owner, 2026-11-19): fear-state sizing, adding to losing option
trades, black-swan hedges. No leverage and no shorting in any mode.

How they differ from Top Picks, on purpose:

- **No shared grade.** Top Picks sums four pillars into one score. Each engine
  reads only its own kind of evidence and scores a named setup from 0 to 100.
- **No AI.** Top Picks has an AI final grader. The engines are rules only.
- **Singles only, different contracts.** One long call or put (about $2,000
  of premium since 2026-11-17; the Webull paper account buys the same
  `qty`, 1 to 10 since 2026-11-19 and 1 to 25 since 2026-11-20), or
  $5,000 of stock for the slow call setups above. Each engine has its own
  expiry window and delta, and a setup may carry its own (the washout bounce).
- **Different exits.** Each engine has its own take-profit, stop and time
  limit; some setups carry their own (see the table on the page). Technical
  and reversion trades also carry a stock stop or target.
- **Different universe.** Macro trades funds only; Earnings and Fundamentals
  trade single stocks only.
- **Not all of them use a score and a bar.** Fundamentals enters by rank (see
  below). The engines may each use the system that fits their idea (owner,
  2026-11-16).

### Contract cap (rules 5, rules 6 on Reversion and Macro, 2026-11-20)

Owner, 2026-11-20: "both to 25 and we can raise or lower in owner settings".
The point is to see whether the engine sizes well on its own. Under risk
sizing the cap of 10 set the size of about two option trades in three, so
the conviction multiplier could rarely move it.

- **The cap.** A risk-sized option trade buys 1 contract up to
  `ENGINES_MAX_QTY` (Owner Settings → Data & desks, 1 to 25, default 25;
  `BOOK.riskMaxQty`, `normalizeMaxQty`, read by `engineSwitches` into
  `sizing.maxQty`). The Riskier dial stops at the same cap (`scaleContract`
  in `lib/owner-controls.mjs`). Shares are unchanged (at most $25,000).
- **Rules step.** A cap other than the old 10 is the next rules number on
  every signal engine, dated 2026-11-20 (`capRules` in `config.mjs`); the cap
  is in the rules `key` (`|cap:N`), so changing it in Owner Settings later is
  logged as a rule change and the record splits there. Set back to 10, the
  rules stay on the honest-paper step with a key that says so.
- **Why a trade got its size.** Each new option trade's `size` keeps `cap`,
  `wantQty` (what the budget and the multiplier asked for) and `capped` (the
  cap, not the budget, set it); the trade's Size line says "at the cap" and
  the arithmetic names the cap.
- **Does bigger size do better?** The engines page splits closed risk-sized
  trades by the multiplier (sized down under 0.9x, about flat, sized up over
  1.1x) and option trades by contracts bought (1-2, 3-5, 6-10, 11-17, 18-25),
  each with its win rate, average result in % and dollars
  (`sizingCompare` → `buckets`). It reads "helps" or "hurts" only once both
  the sized-up and the sized-down groups have `SIZE_READ_MIN` (20) closed
  trades. Labeled tests (one contract) are left out.
- **Top Picks at Webull** have their own cap, `WEBULL_PICKS_MAX_QTY` (Owner
  Settings → Account limits, 1 to 25, default 25; a Vercel value wins), and
  the mirror never sends more than `MIRROR_MAX_QTY` (25). An engine trade at
  Webull follows its record. See docs/webull-paper-controls.md.

History test, 2007-2026, the 1,265 closed option trades of the learning-on
run, modeled option prices (optimistic: on real implied volatility the option
book loses money), same trades and same % results at both caps:

| | Cap 10 | Cap 25 |
|---|---|---|
| Trades the cap sized | 836 (66%) | 344 (27%) |
| Average contracts, sized down / sized up | 8.4 / 8.7 | 14.3 / 16.8 |
| Option dollars at the size taken | $92,173 | $136,882 |
| Same trades at the flat size | $81,508 | $151,743 |
| What the multiplier added | +$10,664 | −$14,861 |
| Worst single trade | −$2,110 | −$2,531 |

With the room to act, the multiplier sized up the wrong trades: sized-up
trades averaged +4.8% against +7.1% for sized-down ones (194 against 742),
in both halves (2007-2016: +2.7% against +7.1%; 2017-2026: +5.5% against
+7.1%), and the rank correlation between the multiplier and the result is
−0.04. Under the cap of 10 that did not show, because the cap flattened
both groups to about the same size. The multiplier stays on (Owner Settings
`ENGINES_SIZE_MULTIPLIER`), so the live record shows whether it holds up;
the page's size table is the place to judge it.

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
- **After any close** (stop, take-profit, time limit or a swap) the same stock
  is not bought again until it is ranked again (next month or its next
  report).
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

The next report date comes from the stock's earnings history (Yahoo /
Nasdaq). When that has none, the Webull backup date stands in
(`earningsBackup`, same `WEBULL_BACKUPS` switch as Top Picks, 2026-11-19),
session unknown. It only holds back new entries near the report (Reversion's
two-session stand-aside, Fundamentals' six-session hold); the run-in setup
never opens on it. The data check
on the page lists the names that took it.

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
interest 50+ or volume 10+, one contract at most $5,000, delta 0.3 to 0.8
(down to 0.05 under a lower target: the washout bounce's 0.3-delta calls may
take 0.25 to 0.3).

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
`TEC:AAPL-C-11/16/26-11:00` (`-S-` for a share trade).

Results are modeled from option mids at each run, like the Top Picks record.
The Webull paper tab shows what the paper account actually filled: filled,
partly filled or missed per trade, with what was asked and what filled; the
Track record tab's open and closed tables carry the same read as an "At
Webull" column beside the engine's own result.

A file that is missing is a fresh start. A file that is there and cannot be
read skips the engines for that build and keeps the stored copy (an empty
record never replaces a real one).

### Stock splits (2026-11-20)

An engine trade keeps its entry, stop, target and strike in the dollars of
the day it opened, so a split would otherwise read as a loss: Sandisk's
8-for-1 at the open on 2026-11-20 would have marked the Momentum basket's
SNDK lot at about -87%, and an option's old strike prices near zero on the
new tape. Before each open or shadow trade is marked, `lib/engines/split.mjs`
compares the run's price with the trade's last mark. It never acts on the
day of the last mark (a split takes effect at an open; a same-day move is
real, and Yahoo's live bar for today already shows it):

- Yahoo's split list comes with the daily history call (`events.splits`,
  kept as `bars.splitEvents`, no extra request). A listed split between the
  last mark and today confirms its ratio when the gap is within 35% of it.
- Otherwise the gap has to be about one standard ratio (1.5, 2, 2.5, 3, 4, 5, 6, 7, 8,
  10, 20, or the reverse). Yahoo back-adjusts its daily closes after a split,
  so the close on the last mark's date, divided into the last mark, must give
  the same ratio (within 10%); the stock may also have moved up to 35% since.
- Before Yahoo adjusts, only an exact gap (within 4%) of a ratio of 3 or more
  counts. With no dated history at all, an exact gap counts for any ratio
  (the Top Picks rule).
- A 40%+ move within 10% of a ratio that nothing confirms yet is held
  unmarked (no exit fires): four runs (two sessions) for a ratio of 3 or
  more, one run for 1.5, 2 or 2.5 (a real crash that size is not rare).
  Then it is marked as a real move and the trade carries `splitUnconfirmed`
  for a look. Any other gap is never held. Without the hold, the first mark
  would move the last price to the new scale and no later run could see the
  split.

A split divides every dollar level by the ratio and multiplies the share or
contract count by it (the OCC's adjustment; strikes keep three decimals,
775 / 8 = 96.875, and the chain lookup matches to half a cent), so the trade's dollars and its %
result do not move; `corpActions` on the trade and `splits` on the run log say
so. A 3:2 or 5:2 split on an option sets `splitReview` (Webull changes the
deliverable instead). The history test passes no history to the guard (its
bars are split-adjusted). Owner Settings → Data & desks → "Engine trades
follow stock splits" (`ENGINES_SPLIT_GUARD`) turns it off.

The Webull paper mirror does not follow a split by itself: Webull's own
adjustment changes the held shares or contracts, the holdings check sees the
difference and pauses orders for review (`lib/webull-reconciliation.mjs`).
A mirrored trade whose engine trade was rescaled after it was mirrored
(`splitSinceLedger`: option strikes no longer match, or a stock fill before
the split) is flagged `SPLIT_REVIEW` once, before the position check (which
would otherwise read the old strikes as flat and settle it), and is held with
no order, exit or settlement until it is checked by hand and the review is
cleared; an entry with nothing filled or working is abandoned. The engine
page shows "Followed a 8-for-1 split" on the trade (`splits` on each row),
and a gap marked as a real move after the hold (`splitUnconfirmed`). Top
Picks' own split rescale keeps strikes to three decimals too, so a contract
both hold still matches.
Test: `node scripts/engines-split-smoke.mjs` (also run by `engines-smoke.mjs`).

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
when 40+ shadow trades average +5% or better. Five remain since Macro's
VIX-curve-back-to-normal setup was dropped (2026-11-17).

Every change bumps the engine's rules version (`TEC-2`, `TEC-3`, …), goes in
its change log and is stamped on new trades, so the record can be split by it.

Top Picks learns through its own loop (`docs/self-loop.md`), which stays in
shadow until the Owner switches self-tuning on. Nothing here changes that.

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

Result, 2007 to 2026, as each engine runs (learning on, the Allocator
advising), with share trades scored on their own lines. Rerun on 2026-11-17
with the money-leak fixes (rules 3; option trades at about $2,000 of premium,
so the option dollars are not comparable with the rules 2 table below):

| Engine | Kind | Trades | Average trade | Dollars |
|---|---|---|---|---|
| Technicals | options | 92 | +1.4% | +$1,406 |
| Technicals | shares | 1,158 | +0.9% | +$51,096 |
| Reversion | options | 884 | +7.7% | +$135,090 |
| Reversion | shares | 53 | +0.6% | +$1,656 |
| Macro | options | 490 | +2.2% | +$20,071 |

Rules 2 (shares for the slow setups, one contract per option trade), rerun
the same day after a fix to the slot count (a run's own new trades were
counted twice against an engine's free slots):

| Engine | Kind | Trades | Win rate | Average trade | Dollars | Random entries | Beat random |
|---|---|---|---|---|---|---|---|
| Technicals | options | 194 | 42% | -3.6% | -$8,501 | -6.6% | 90% of books |
| Technicals | shares | 1,347 | 46% | +0.8% | +$52,209 | +1.0% | 30% |
| Reversion | options | 1,136 | 46% | -1.7% | -$3,273 | -3.9% | 80% |
| Reversion | shares | 39 | 59% | +1.8% | +$3,419 | +0.6% | 70% |
| Macro | options | 490 | 51% | +2.2% | -$6,311 | -7.9% | 100% |

Before the share change (every call an option): Technicals 1,043 trades,
-2.3% a trade, -$23,675; Reversion -$7,272; Macro -$7,473.

Honest read: buying shares instead of calls turned Technicals from a steady
loser into a winner, but its share trades did no better than random share
buys in the same names (they beat 30% of random books): the gain is the
stocks' own rise, not the timing. Reversion's capitulation shares and Macro
did better than random. No option side shows a reliable profit after costs.
The learning rules worked as a brake, not an edge.

Core engines, 2007-02-01 to 2026-11-06, scored as portfolios against SPY
bought the same day:

| Engine | A year | SPY a year | Total | SPY total | Worst drop | SPY worst drop | Invested | Swaps |
|---|---|---|---|---|---|---|---|---|
| Trend follower | 14.1% | 10.6% | +1,242% | +631% | -30.7% | -55.2% | 94% | 33 |
| Momentum basket | 27.9% | 10.6% | +12,777% | +631% | -40.5% | -55.2% | 93% | 539 |

The Trend follower's edge is mostly sidestepping 2008 (+0.6% against -36.8%)
and 2022 (-11.6% against -18.2%); it trailed in rebounds (2009 -7.3% against
+26.4%, 2019 +12.0% against +31.2%). The Momentum number is the most
flattered result in this test: it picks the ten strongest of today's 85
covered names, which are largely the names that went on to win. On a
1,000-name list of the time the same rule made about 21% a year, not 28%.

What the test cannot see:

- Real spreads and real implied volatility are not in the history.
- The names are today's list, so companies that failed are missing.
- The shadow-start setups were picked with hindsight on this same history.
- Share trades use split-adjusted prices as they are and enter at the open.
- Earnings and Fundamentals need report dates and EPS from the private store,
  so they are not in the long run. Every build replays them over the bars it
  holds (the "Recent replay" on the page). Pass `--earnings FILE` with a
  hydrated `earnings-history.json` to include them.
- Flow has no stored history. It is judged forward only, on its paper record
  and its shadow trades.

## Allocator (2026-11-17)

`lib/engines/allocator.mjs`. The Allocator picks no trades. Before each
signal-engine trade it looks up how that setup has done, keyed by engine,
setup, side and instrument (`allocKey`: `engine|setup|side|o` or `|s`), in
today's Regime Lab market type and everywhere, and blends the two:
expected = cn/(cn+30) x the average here + 30/(cn+30) x the average
everywhere (`allocDecide`). Options count % of premium, shares % of the
share price x 5 (as in the learning rules). Fewer than 30 results: "new",
normal size. Expected at or under zero: "closed". Above zero: a size
w = expected / 4, clamped to 0.1x-2x.

- **Its record.** Every finished signal trade, real and shadow
  (`allocObserve`), on top of a starting record from the history test's
  every-setup run (`research.allocPrior`, counts and sums only).
- **Modes** (`ENGINES_ALLOCATOR`). `advise` (the default): every trade opens
  and carries the read as `alloc` (`{ w, status, ev, n, cn, cell, mode }`);
  the page counts the closed trades it would have held back and what they
  made (`allocBook` `heldUsd`: below zero, holding back would have helped).
  `on`: a "closed" setup's trade is held back and tracked as a shadow trade
  ("held back by the Allocator"), so the setup keeps a record and can earn its
  way back. `off`: not run. In every mode the size is a scored dollar line
  only; no lot is resized. The core engines are not allocated.
- **Why it advises by default.** In the history test (Technicals, Reversion,
  Macro, learning on), holding back lowered the dollar total in both runs:
  starting from nothing, $37,543 without it and $16,471 with it; with the
  2007-2016 record carried into 2017-2026 (the way it runs live), $18,391
  and $7,217. On the same trades, the ones it would have held back made
  money ($10,730 over 919 trades, and $14,165 over 252): its read was right
  on Macro (the Macro trades it would have held back lost money in both runs)
  and wrong on Technicals and Reversion. Its sizes lowered the total starting
  from nothing and were flat with the record. The advising run's live count
  is the test of whether that changes.
- **Page.** Strategy engines → Allocator tab: today's market type, every
  setup's read (size, expected, results here and everywhere, live vs history
  count), the live counts, and the history test with the note read from the
  numbers. Candidates and open trades carry an Allocator line.

## Switches

| Switch | Where | Effect |
|---|---|---|
| `ENGINES` | GitHub repo variable | Unset = on. `pause` = manage open trades, open none. `0` = freeze (files carried forward untouched) |
| Strategy engines | Owner Settings → Data & desks | The same switch on the site: On, Manage open trades only (`pause`), Frozen (`off`). Applies from the next Top Picks run. A repo variable, when set, wins |
| `ENGINES_OFF` | GitHub repo variable | Comma list of engines that open no new trades (`earnings`, `macro`, `technicals`, `fundamentals`, `flow`, `reversion`, `trend`, `momentum`, or their tags) |
| `ENGINES_ALLOCATOR` | Owner Settings → Data & desks → "Engine Allocator" (no repo variable) | Unset / `advise` = the Allocator records its read on every signal trade and holds nothing back. `on` = it holds back setups expected to lose in today's market type (shadow trades). `0` = not run |
| `ENGINES_SHARES` | Owner Settings → Data & desks → "Engines buy shares for slow setups" (no repo variable) | Unset = on. `0` puts every setup back on calls; open share trades run to their exits |
| `ENGINES_MIRROR` | Vercel env | `0` stops new engine trades entering the paper account. Trades already there keep being managed and closed |
| `ENGINES_FIX_RETIRE_PUTS` | Owner Settings → Data & desks | Unset / on = Reversion's spike fade and Technicals' range breakdown open nothing. `0` brings them back for new trades |
| `ENGINES_FIX_BOUNCE` | Owner Settings → Data & desks | Unset / on = the washout bounce buys ~0.3-delta calls about 21 days out with a -60% stop. `0` = the engine's 0.6-delta calls and -35% stop |
| `ENGINES_FIX_SIZE` | Owner Settings → Data & desks | Unset / on = option trades record about $2,000 of premium. `0` = one contract, as before. Webull buys the record's `qty` (1 to 25) unless Owner Settings `WEBULL_QTY` is off |
| `ENGINES_FIX_TEC_SHARES` | Owner Settings → Data & desks | Unset / on = Technicals' share trades stop 3 ATR under the entry. `0` = the setup's own stop or 2 ATR |
| `ENGINES_FILL_BASIS` | Owner Settings → Data & desks | Unset / on = new option trades book the ask going in and the bid coming out (triggers stay on the mid). `0` = the mid both ways |
| `ENGINES_SPLIT_GUARD` | Owner Settings → Data & desks | Unset / on = open trades follow a stock split (levels divided, count multiplied; see "Stock splits"). `0` = old prices marked on the new tape |
| `ENGINES_RISK_SIZE` | Owner Settings → Data & desks | Unset / on = each trade risks about `ENGINES_RISK_USD`, 1 contract up to `ENGINES_MAX_QTY` or up to $25,000 of stock. `0` = the rules 3 sizing |
| `ENGINES_MAX_QTY` | Owner Settings → Data & desks | The most contracts a risk-sized option trade buys, 1 to 25 (default 25 since 2026-11-20; 10 before). A cap other than 10 is a dated rules step; changing it later is logged as a rule change. The Riskier dial stops there too |
| `ENGINES_RISK_USD` | Owner Settings → Data & desks | The risk budget a trade, $500 to $10,000 (default $2,000) |
| `ENGINES_SIZE_MULTIPLIER` | Owner Settings → Data & desks | Unset / on = the conviction multiplier (0.5x to 2x, parts on each trade). `0` = the flat risk size |
| `ENGINES_TEC_SHARES_ONLY` | Owner Settings → Data & desks | Unset / on = Technicals buys shares only (squeeze puts and rally fade retired). `0` = its rules 3 setups |
| `ENGINES_CRASH_STANDASIDE` | Owner Settings → Data & desks | Unset / on = Reversion's washout bounce stands aside after a one-day drop of 7%+ in the prior five sessions. `0` = it buys anyway |
| `ENGINES_FEAR_BOUNCE` | Owner Settings → Data & desks | Unset / on = the extreme-fear bounce test (one call plus a shares twin under fear and greed 25). `0` = not run |
| `ENGINES_INSTRUMENT_<ENGINE>` | Owner Settings → Data & desks | Per signal engine (`EARNINGS`, `MACRO`, `TECHNICALS`, `FUNDAMENTALS`, `FLOW`, `REVERSION`): default (the registry), `options`, `shares` (call signals buy stock; puts stay options) or `both` |
| `ENGINES_TRIAL_RSI2_DIP` | Owner Settings → Data & desks | Unset / on = Reversion's RSI(2) dip paper trial buys shares (own 4 slots, 2 a run, no learning). `0` = retired for new trades. Opens nothing while `ENGINES_SHARES` is `0` |
| `ENGINES_TRIAL_FEAR_INDEX` | Owner Settings → Data & desks | Unset / on = Macro's index-fear paper trial buys SPY, QQQ and IWM shares after Fear & Greed first closes under 25 (own 3 slots, no learning). `0` = retired for new trades. Opens nothing while `ENGINES_SHARES` is `0` |
| Owner controls | Strategy engines page → Controls; kill switch Owner Settings → Account limits → `OWNER_CONTROLS` | Stop new trades, Avoid (optionally closing open trades as `owner-avoid`), Watch closely, Flag a catalyst and the Risk dial, from the next Top Picks run. Off = nothing saved applies. See "Owner controls" below |
| `ACCOUNT_LIMIT_OPEN_USD`, `_DAY_LOSS_USD`, `_NAME_USD`, `_NEW_PER_DAY` | Owner Settings → Account limits | All 0 = off. Caps on open option premium, a daily loss stop, money per stock across engines and new trades a day; a trade a limit holds back is not opened and not shadowed. A limit never closes a trade |

## Owner controls (2026-11-19)

Full spec: [`owner-controls.md`](owner-controls.md). In the book
(`stepBook` input `controls`, built by `readOwnerControlsForRun` in
`build.mjs`):

- **Stop new trades** opens nothing (not even shadow trades); every exit runs.
- **Avoid** opens nothing on the stock in any engine. With "close its open
  trades", a trade opened before the avoid closes as `owner-avoid`: counted on
  the record, but it sets no loss cooldown and learning and the Allocator
  never see it.
- **Watch closely** puts the stock at the front of each engine's queue for
  five sessions. No bar is lowered.
- **Risk dial** (until Friday's close): Safer = half the contracts or shares,
  entry bar +5, one new trade a run across the engines. Riskier = 1.5x the
  contracts or shares (at most the contract cap, 25 unless set in Owner
  Settings, unless a trade already had more; 10 before 2026-11-20),
  bar -3, and back to the normal size when 1.5x would pass an account limit.
  Core engines keep their size and have no bar.
- **Account limits** (above) count signal and core option premium and money
  per stock; core engines are not counted against the daily loss stop or the
  new-trades count.
- Each run keeps every scored row by stock (`state.checks`, `checks` in
  `engines.json`) for the page's read-only **Check this stock**, and the run
  log records `controls`. New trades carry `ownerControls`.
- **Webull mirror:** Stop, Avoid or a limit logs a new record trade
  `skipped` with `ownerHold`; it is never bought later. Mirror health counts
  them as held, never as an issue. Exits are untouched.
- The history test passes no controls, so its result is unchanged.


## Not in scope

- No real money and no broker other than the Webull paper sandbox.
- No spreads, and no short stock.
- Share trades, core-engine holdings included, reach the paper account as
  long-only stock orders since 2026-11-19 (#869); nothing is sold short.
- The Allocator never resizes a lot.
- No engine result feeds a Top Picks grade, gate or record.
