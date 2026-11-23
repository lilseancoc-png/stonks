# Chance of profit on the Webull trades

Added 2026-11-22. Owner only. Code: `lib/trade-pop.mjs` (rules, pure),
`scripts/render/trade-pop-client.mjs` + `trade-pop-css.mjs` (page). Test:
`node scripts/trade-pop-smoke.mjs`.

Every trade the Webull paper mirror takes, from Top Picks, the strategy
engines, their paper trials and tests, options and shares, gets a stated
chance of closing with a gain. The chance is set once when the trade opens
and is never changed. When the record closes the trade, its outcome is
written next to it, and the Owner check compares what we said with what
happened.

Nothing here changes which trades open, their size or their exits. No AI
call, no new download, no new function or workflow. CPU is about 13 ms a
trade.

## The estimate

`pop.p` blends two reads:

1. **Market model** (`pop.m`, `modelChance`). 2,000 seeded paths of the
   stock (geometric Brownian motion at the option's own implied volatility,
   drifting at the risk-free rate, so no edge is assumed), one step a
   session. Each session the contract is repriced with Black-Scholes
   (`lib/greeks.mjs`) and the trade's real exits are applied in the order the
   record applies them: take-profit and stop on the mid P&L, the trailing exit
   where a setup has one, then the stock stop and stock target. The horizon is the shortest of the session limit,
   an event exit (`exitBy`), the pre-expiry exit day (`expiryExitDate`) and
   expiry. A path wins when its booked result is above zero:
   - Engine options: ask in, bid out, as the engine record books them
     (entry / mid from `entryFill`, half the quoted spread given up on exit).
   - Top Picks: the mid, as the Track Record marks it. Long singles, debit and
     credit verticals are priced leg by leg. A single on the call hold exit
     (`exitPolicy.style: "hold"`) is held its sessions with the premium stop
     only, no take-profit and no stock stop, as the record closes it.
   - Shares: the stock's move less the round-trip `costPct`; volatility from
     the at-the-money IV of the nearest month, else 20-day realized. A core
     holding with no limit is held to the next monthly check (21 sessions).
2. **Track record** (`pop.r`, `recordChance`).
   - Engines: the history test's win rate for that engine, setup and
     instrument (`research/engines/results/latest.json`, the rules-as-written
     run), counted as at most 20 trades (it is a replay, and its options were
     priced from a model), pooled with the live and shadow closes of the same kind of trade
     that closed before this one opened.
   - Top Picks: the self-improving loop's chance of +25% before -50% once it
     has stopped learning; until then (it reads a 50% prior until about
     December 9) the Similar-setup odds.

Blend weight on the record = trades counted / (trades counted + 40). With no
usable volatility the record alone is used, pulled toward a coin flip by the
same weight. The stamp also keeps the textbook held-to-expiry chance of
finishing past breakeven, for reference only.

## The expected gain

Added 2026-11-22 (owner: "if we are entering into the options strategy we
should have a rough idea on what we could make"). The chance of profit
assumes no edge, so its average result (`pop.mod.avg`) is only the cost of
the vehicle. `pop.eg` (`expectedGain`) runs the same simulation, same exits
and same fills, with a forecast:

- **Forecast move** (`eg.fc`), the trade's way, applied over the forecast's
  sessions (the drift after them is the risk-free rate):
  - Top Picks: the self-improving loop's expected 10-session move (`em10` on
    this run's ledger row, `loopForecastFor`; fitted on rows resolved before
    the run; `learning` below 200 model rows). No row: zero, labeled.
  - Engines (`engineForecast`): the setup's history-test **share** result
    (`shares.bySetup`, or `trials.bySetup` for a paper trial; real stock
    prices, counted as at most 200 trades) pooled with the stock moves of
    earlier live and shadow closes of the same engine, setup and side, then
    shrunk toward zero by n / (n + 20). The history test's option average
    rides along as a reference only (`fc.ref`), because its prices came from a
    model. Nothing known: zero.
- **Path volatility** (`eg.vol`, `pathVolOf`): the stock's own realized
  volatility, the 20- and 60-session average, else the option's IV. The
  option is still priced at its own IV, so IV above the stock's moves shows up
  as a cost (`vol.gap`).
- **IV drift** (`ivShiftOf`): each leg's IV moves toward the stock's own
  ~18-month ATM IV mean (`ivRank.mean`), half the gap within 20 sessions;
  flat with no history. `eg.ivEnd` is the IV at the horizon.
- Paths come in antithetic pairs on shared draws (`crn`), so runs that differ
  only in the move are compared on the same paths.

Fields: `ev` (average booked result, % of the money put in), `evUsd` and
`costUsd` (one contract at the mid for Top Picks; the trade's own size for
engines), `ev0` (no move: the vehicle's cost), `pop` (chance of a gain under
the forecast), `down` (average loss), `perRisk` (`ev` / `down`), `hurdle`
(the move the trade's way over the forecast's sessions at which `ev` is zero,
by bisection on 800 paths; `hurdleWhy` when it is outside -25% to +40%),
`twin` (option trades: the same forecast on shares the same way, short for a
put, 0.1% round trip, the trade's stock stop and target), `better` (option /
shares / about even / neither, by `perRisk`; neither when both expect a loss).
About 40 to 100 ms a trade.

Measure only: nothing reads it into a trade, a size or an exit.

## The outcome

`pop.res` = `{ y, pnl, at, status }`, written once when the record closes the
trade (`stampPopResults`, every Top Picks run and every engine run). `y` is 1
for a gain, 0 for a loss or a flat close, and null for a close the record does
not count (left coverage, split, data fault). The Webull paper fill is graded
too: the ledger's `paperPnlPct` (read before the wipe) is joined by trade ID at
check time, so the same chance is scored against the account's own fills.

The expected gain is graded at the same close (`buildEgCheck`, `popCheck.eg`):
stated against made (% of the money put in) overall, by group and in bands of
the stated result (under -10%, -10 to 0, 0 to 10, 10%+), the rank skill of
the stated result on win / loss and the rank correlation with the P&L, the
chance of a gain under the forecast graded like the chance of profit, and the
better-vehicle counts. The verdict needs 30 closes: Close within 5 points,
else Too hopeful or Too cautious.

## Where it shows

- Open picks: a **Chance** column on the Top Picks table, the Strategy engine
  trades table and each engine's open table; a row's expand button opens the
  Why. Top Picks cards carry a "Chance of profit" line that opens in place.
- Open picks → **Chance of profit check** (Owner): counts, the stated average
  against the share that won, a table by group (Top Picks, engine options,
  engine shares, paper trials) and method (our estimate, the model alone, the
  record alone) with Brier skill against the base rate, a stated-against-won
  bucket table, the Webull fill line and the latest closes. Built every engine
  run into `engines.json` as `popCheck`.
- Quant labs → Calibration: three sources (`trade-pop`, `trade-pop-model`,
  `trade-pop-record`), graded with every other chance the site states, plus
  the expected gain as a ranked score (`trade-eg`) and its chance under the
  forecast (`trade-eg-pop`).
- Open picks and every engine table: an **Exp. gain** column (the expected
  result and the move it needs); the Why has an Expected gain part; the Top
  Picks card line shows it; the check has an Expected gain check.
- MCP: `get_track_record` rows carry `chance_of_profit` and `expected_gain`;
  the engines record dataset carries `pop.eg`.

## Files

The stamps live on the records that already exist: `picks-accuracy.json`
(Top Picks; the archive keeps a slim copy), `engines-record.json` (engines),
`engines.json` (page rows and the check). All Owner-only.

## Switch

Owner Settings → Research → "Chance of profit on Webull trades"
(`TRADE_POP`, on). Off: new trades get no chance; the stamps already written
are still graded and shown.
