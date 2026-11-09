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
| Input decay, market splits, loss patterns, weekly report | `lib/self-loop/diagnose.mjs` |
| Paper challengers, the promotion check | `lib/self-loop/challengers.mjs` |
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
| `sig`, `pl` | the non-zero signal votes and pillar scores (for step 2's input decay read) |
| `xv` | the stated value of the planned option after costs, in points (for step 3's expected-value challenger) |
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

Rows in the lane "Self-improving loop":

- `loop-honest-odds`: pass when 400+ fitted 10-session estimates beat the base
  rate's Brier score by more than 1%, fail when they score worse.
- `loop-gate-audit`: ready once 20 let-through names have a modeled outcome.
- `loop-challengers` (step 3): see the promotion check below.

### Bake order

1. Before the wipe: `loadLoopState`.
2. Top Picks run (11:00 / 15:30 ET only): archive, outcome rows, control
   draws, then `loopOnRun`.
3. Every full bake, before the evidence board: `loopOnBake` (fill option
   outcomes, prune to 90 run days, score, build the view), then
   `writeLoopFiles`, then the board with the loop rows.

Each step is wrapped so a failure logs a warning and the build goes on.
`regen-picks.mjs` does not run the loop (it is an offline maintenance tool).

## Step 2: diagnose (D1-D4)

`loopOnBake` adds `diagnosis` and `reports` to the view
(`lib/self-loop/diagnose.mjs`). Still measurement only.

### Which inputs still work (D1)

For every input the grade uses (each signal vote, and each pillar score as
`P:f`, `P:t`, `P:m`, `P:n`, `P:iv`, `P:rg`), per run: the Spearman
correlation between the vote (bullish positive; a name with no vote counts
as 0) and the stock's own 5-session move across every name in the run. Read
over the newest 20 sessions, the newest 60 and all of it, plus all of it on
10-session moves. Status:

| Status | Rule |
|---|---|
| collecting | under 10 sessions in the newest 20-session window |
| pointing the wrong way | newest 20 average -0.03 or worse, and 35% or fewer runs positive |
| fading | newest 60 average +0.02 or better, newest 20 at or under 0 |
| working | newest 20 average +0.03 or better, and 60% or more runs positive |
| no clear read | anything else |

### Where the engine works (D2)

Direction hit rate (grade 4+), rank skill, Brier against the base rate and
the modeled option average, split by market type at the run and by Regime
Lab cell. Each input's 10-session IC is also read per market type; an input
averaging +0.03 or better in one market type and -0.03 or worse in another
(10+ sessions each) is listed as changing sign with the market.

### How losses happen (D3)

Over trade-grade names with a modeled option result: how the losses ended
(stopped within 3 sessions, stopped later, ran out of time or expired), and
whether the stock went the wrong way or went the trade's way and the option
still lost (time decay, a move too small or too slow). Then every value of
side, market type, cell, event play, AI call, grade band (4-5, 6-7, 8+),
implied move (under 5%, 5-8%, 8-12%, 12%+), what the run did, and the pairs
side x market / side x cell / side x grade, with 15+ names: the setups at
least 3 points worse than the book after costs (and losing at least 1.1x as
often) and the ones at least 3 points better.

### Weekly report (D4)

Written once per week into the state (`reports`, 26 weeks kept, the newest 8
in the view): at the first build after the Friday close (16:00 ET), or at the
next build when that one was missed (a Friday holiday, a failed build), for the
newest finished week. Never for a week that ended before the loop started. It
carries the headline reads (10-session Brier and its skill over the base rate,
hit rate at grade 4+, rank skill, option average and win rate), their change
since the last report, and a plain-language "what to look at" list: inputs
pointing the wrong way or fading, inputs that change sign with the market, the
worst setups, rules that cost the book, the shape of the losses, and stated
odds that score worse than the base rate. Each item names the step-3
challenger or step-4 setting it points to; nothing is changed by the report.

## Step 3: challenge (C1-C4)

`loopOnBake` adds `challengers` to the view and keeps the book in the state
(`lib/self-loop/challengers.mjs`). Still measurement only: a challenger is a
paper book, never a change.

### The menu (C1)

A challenger is one small, named change taken from a fixed menu, never searched
for:

| Kind | What it does | Step 4 can apply it live |
|---|---|---|
| `mute` | take one input's vote out of the total | yes (weight 0) |
| `up` | count one input's vote half again | yes (weight 1.5) |
| `bar` | trade bar one point higher, or half a point lower | yes |
| `ev-gate` | take only names whose stated option value after costs is zero or better | yes |
| `rule-off` | switch off one open-pick rule | no, it names the code change |
| `skip` | skip one side in one market type | no, it names the Owner market mode or a code change |

The diagnosis picks what to try, in this order: inputs pointing the wrong way
(mute), rules that cost the book (rule-off), the worst side x market setup
(skip), the expected-value gate once the count model is past 200 rows, inputs
that work (up), fading inputs (mute), then the bar one point up and half a
point down. At most **three** run at once and at most **one** new one starts a
week (only on the build that writes the weekly report), so the number of things
tried stays small. The same change is not tried again within 60 sessions of its
end.

### Judged forward on the same trades (C2)

A challenger is judged only on runs **after** it started, against a replica of
the current rules over the same runs: the same planned contracts, the same
modeled option outcomes, exits and costs (step 1). Both books take one trade
per name and side at a time, as the engine does (no new trade while the last
one is still open). The replica takes the names the run let through; a
challenger starts from those plus the names under the bar, re-scores each one
(delta method: muting takes the vote out of the untuned total, `up` adds half
of it again; a re-score that flips the side drops the name), and applies its
own bar, gate or skip.

Two simplifications, both in the challenger's favor and so worth knowing when a
result looks good:

- A below-bar name a challenger lifts over the bar is treated as if it had
  passed every other open-pick rule (those rules were never run on it).
- Votes are added straight to the total; the real grade clamps each pillar at
  ±5, so a mute on a name whose pillar sat at the clamp moves the score less in
  practice than here.

### The promotion check (C3)

A challenger reads **ready** only when all of these hold:

| Check | Bar |
|---|---|
| Sessions since the start | 30+ (`MIN_SESSIONS`) |
| Decided trades in its book | 40+ (`MIN_TRADES`) |
| Edge over the replica, after costs | 2+ points a trade (`MIN_EDGE`) |
| Both halves of its time | better than the replica in each |
| The newest fifth (holdout) | better than the replica |
| Best three trades dropped | still better than the replica |
| Costs doubled | its own average still above zero |
| t value of its edge, 5-session blocks | above the bar for the number of trials |

The t bar is a one-sided 5% test split over every challenger ever started
(Bonferroni: 1.64 with one trial, 2.33 with five, 2.58 with ten), so trying more
things raises the bar for all of them. A challenger with enough sessions and
trades that is not ahead, or one that reaches 60 sessions, is retired as **no
edge**; a ready one keeps its verdict in the finished list.

### What passing means (C4)

A ready challenger is a recommendation. The Loop tab lists it under "Passed the
check" with the setting it points to. `mute`, `up`, `bar` and `ev-gate` are the
ones step 4 can apply, only when switched on and only inside its limits; a
`rule-off` or `skip` that passes names the code change or the Owner market mode
to consider, and nothing changes until someone makes it.

The Evidence board gains `loop-challengers`: pass once a challenger passes the
check, collecting while one runs, waiting before the first starts.

## What to expect

The loop's first stated chances are the 50% starting point. Ten-session
outcomes start to land about two weeks after the first run, the model crosses
200 graded rows within a few more days, and the honesty test needs 400 graded
estimates (roughly three to four weeks of runs). The early look at direction
skill is November 23 and the full test December 7, as already planned.
The first challenger can start with the first weekly report, and none can read
ready before 30 sessions (about six weeks) after it started. Better-calibrated
odds do not by themselves mean more winners: the loop's job is to say how good
the engine is, honestly, and to find the parts worth changing.
