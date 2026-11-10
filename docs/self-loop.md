# Self-improving Top Picks loop (November 9, 2026)

The loop turns the Top Picks engine into something that checks itself:
**gather -> estimate -> compare -> diagnose -> test a fix -> change -> repeat.**
At every 11:00 and 15:30 ET Top Picks run it writes down, for every scored
name, a chance that can be proved wrong. Once the moves happen it grades those
chances, finds where the engine is wrong, tests fixes on paper, and (only when
switched on and only inside fixed limits) applies the ones that pass.

The design and its options (ids L, D, S, C, A, K) are the Claude Doc
"Self-improving Top Picks loop: design and options" of November 9, 2026. The
owner asked for all of it, built in four steps, each its own pull request:

| Step | What it adds | Ids | Changes picks? |
|---|---|---|---|
| 1. Measure | prediction ledger, option outcomes, honest odds, scorecard, rule audit | L1-L4 | No |
| 2. Diagnose | input decay, market-type splits, loss patterns, weekly report | D1-D4 | No |
| 3. Challenge | shadow challenger books with a promotion check | C1-C4 | No |
| 4. Adjust | bounded live weights, mutes, the expected-value gate, auto-undo | S1-S4, A2, K1-K4 | Only when switched on |

Steps 1-3 are measurement only. Nothing in them changes a pick, a grade, a
gate or the Track Record. The loop adds **no AI call**, no new fetch, no
serverless function and no workflow.

Rollback: the branch `backup/pre-self-loop-2026-11-09` holds `main` as it was
before step 1 (commit d557b0a). Each step is one squash merge, so `git revert`
of that merge undoes it. The kill switch `LOOP=0` (repo variable, passed by
`daily.yml`) stops the loop on the next build and leaves its files in place.

## Where things live

| Piece | File |
|---|---|
| Prediction ledger, option replay, join to the stock outcomes | `lib/self-loop/ledger.mjs` |
| The count model behind every stated chance, reliability scoring | `lib/self-loop/calibrate.mjs` |
| Scorecard and rule audit | `lib/self-loop/scorecard.mjs` |
| The two bake hooks, the files, the evidence rows | `lib/self-loop/index.mjs` |
| Owner Lab "Loop" tab | `scripts/render/self-loop-client.mjs`, `self-loop-css.mjs` |
| Tests | `scripts/self-loop-smoke.mjs` (`npm run test:self-loop`), `scripts/self-loop-browser.mjs` (`npm run test:self-loop-browser`) |

## Files

Both keys are Owner-only (`lib/premium-keys.mjs`), bake-owned and optional
(`lib/data-ownership.mjs`), never delete-staled.

- `picks-loop-state.json`: the loop's memory. The ledger (one row per scored
  name per run, kept for the newest 90 run days, about 5 MB when full), the
  daily score history (400 days), the run count. Read **before** the bake's
  wipe like every accumulating file. A missing file is a fresh start; a file
  that cannot be read this time skips the loop for that build and leaves the
  stored copy alone; a file that reads but is not loop state starts over.
- `picks-loop.json`: what the Owner Lab Loop tab draws (about 50-100 KB). The
  browser never asks for the state file.

The MCP serves the view as the Owner Lab dataset `quant.loop`.

## Step 1: measure (L1-L4)

### The prediction ledger (L1)

`loopOnRun` runs right after each Top Picks run, after the run archive and the
outcome rows are written. For every scored name it stores:

| Field | Meaning |
|---|---|
| `d`, `et`, `s`, `side` | run date, run time, symbol, call or put (the same key as `picks-outcomes.json`) |
| `tot`, `tot0` | the grade total, and the untuned total (equal unless step 4's live weights moved it) |
| `out`, `ev`, `mk`, `cell`, `ep` | what the run did (`pick:` / `gate:` / `open` / `below-bar`), the AI entry call, market type, Regime Lab cell, event play |
| `p5`, `p10`, `p20` | stated chance (percent) the stock moves the trade's way over 5, 10 and 20 sessions |
| `em10`, `im10` | expected 10-session move the trade's way, and the move the options price (ATM IV, one standard deviation) |
| `pTp` | stated chance the planned single option reaches +25% before -50% |
| `pn` | graded rows behind the finest group the estimate came from (0 = the 50% starting point) |
| `c`, `px` | the planned contract `[strike, expiry, mid, iv]` and the run spot |
| `sig` | the non-zero signal votes (for step 2's input decay read) |
| `o` | the modeled option outcome, filled later |

The stock moves are not stored twice: `joinedRows` joins them from
`picks-outcomes.json` (r1/r5/r10/r20, signed to the trade's side).

### The option outcome (L2)

Every full bake replays the planned contract of every ledger row that can be
decided: Black-Scholes at the entry IV on each later daily close, measured
against the same model's value at the run spot (so a gap between the model and
the quoted mid on day one cannot fake an exit), with the record's exits: +25%
take-profit, -50% stop, at most 20 sessions, scored after 3.5 points of
round-trip cost. A close dated today is a partial bar and is skipped. This
covers about 170 names a day, picked or not, instead of a few trades a month.
It is a model, not fills; the Track Record stays the real book.

### Honest odds (L3)

Every stated chance comes from a count table, not a fitted curve
(`lib/self-loop/calibrate.mjs`). Resolved rows are counted into four nested
groups: all, grade band (whole points of |total|, 9 = 9 and up), band x side,
band x side x market type. An estimate starts at the coin-flip and is pulled
toward each finer group with 20 pseudo-rows (`SHRINK_K`), so a group with 5
rows says almost what its parent says and a group with 300 mostly speaks for
itself.

Walk-forward: the model used at a run is fitted only on rows whose run date is
before that day, and it counts rows by their untuned total (`tot0`), so a live
weight change in step 4 cannot grade itself. Until the model holds 200 graded
rows (`MIN_ROWS_FOR_ESTIMATE`) every chance is labeled "learning".

The scorecard (`buildScorecard`) grades the chances once the moves are in:

- **Honesty:** Brier score per horizon (the average squared miss; always
  saying 50% scores 0.250) against the base rate's score on the same rows,
  plus ten stated-vs-happened bins. Only estimates with real rows behind them
  count.
- **Direction:** how often the move went the grade's way (flat moves left
  out), for any lean and for trade-grade names, at 5/10/20 sessions.
- **Rank skill:** the Spearman correlation of the grade total with the move
  across every name in a run, averaged over runs; its t value uses one run per
  horizon length so overlapping windows are not counted as independent.
- **Size of moves:** realized 10-session move against the implied move, and
  how far off the stated expected move was.
- **Option outcomes:** trade-grade names (4+ either way) by side, market
  type, Regime Lab cell, event play, AI entry call, what the run did, and
  grade band.

### Rule audit (L4)

For every rule that turned a trade-grade name away (`gate:` in the run row),
the modeled option result of the names it stopped against the names the run
let through. `saved` = let-through average minus stopped average, in points
after costs. With 20+ names on each side a rule reads **paying** (saved over
+2), **costing** (under -2) or no clear effect.

### Evidence board

Two rows in the lane "Self-improving loop":

- `loop-honest-odds`: pass when 400+ fitted 10-session estimates beat the base
  rate's Brier score by more than 1%, fail when they score worse.
- `loop-gate-audit`: ready once 20 let-through names have a modeled outcome.

### Bake order

1. Before the wipe: `loadLoopState`.
2. Top Picks run (11:00 / 15:30 ET only): archive, outcome rows, control
   draws, then `loopOnRun`.
3. Every full bake, before the evidence board: `loopOnBake` (fill option
   outcomes, prune to 90 run days, score, build the view), then
   `writeLoopFiles`, then the board with the loop rows.

Each step is wrapped so a failure logs a warning and the build goes on.
`regen-picks.mjs` does not run the loop (it is an offline maintenance tool).

## What to expect

The loop's first stated chances are the 50% starting point. Ten-session
outcomes start to land about two weeks after the first run, the model crosses
200 graded rows within a few more days, and the honesty test needs 400 graded
estimates (roughly three to four weeks of runs). The early look at direction
skill is November 23 and the full test December 7, as already planned.
Better-calibrated odds do not by themselves mean more winners: the loop's job
is to say how good the engine is, honestly, and to find the parts worth
changing.
