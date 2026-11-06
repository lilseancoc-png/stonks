# PrizePicks two-prop selector backtest — November 5, 2026

The required **one player from each team** rule is implemented as
`props-rank-3`, in both live ranking and frozen-record slot fills. An open
opponent slot cannot be filled by another teammate. Earlier issued records
remain unchanged and retain their original ranking version.

A retrospective replay of **1,017 NBA games and 207 NFL games** found no
additional filter that justified changing the production scoring weights.
The final date holdout for the team-constrained selector produced:

| League | Test window | Games with two picks / covered games | Wins / losses | Prop hit rate | 95% interval | Both props won |
| --- | --- | --- | --- | --- | --- | --- |
| NBA | May 2–Nov 4, 2026 | 131 / 153 (85.6%) | 145 / 105 | **58.0%** | 51.6–65.3% | 42 / 119 resolved pairs (35.3%) |
| NFL | Oct 11–Nov 2, 2026 | 54 / 56 (96.4%) | 57 / 48 | **54.3%** | 44.1–69.3% | 16 / 51 resolved pairs (31.4%) |

These are **partial-board statistical replays, not a validation of the full
injury-aware live system or a profit estimate**. Historical injury reports
are missing; the archive omits combined props and does not preserve side
restrictions. The NBA interval crosses the offseason and includes playoffs
and the beginning of the next season. All data and grading stop at Nov 4.

## What the replay uses

The [public PrizePicks mirror](https://github.com/enkday/prizepicks-data-mirror)
contains timestamped daily standard-line snapshots. Source history is fixed
at commit [`116358bc8a695a296665624354384176fbaa92f1`](https://github.com/enkday/prizepicks-data-mirror/tree/116358bc8a695a296665624354384176fbaa92f1),
using `data/prizepicks-nba-today.json` and `data/prizepicks-nfl.json`.
The run includes 291 accepted NBA file revisions and 260 NFL revisions;
empty and out-of-season files do not add games. The mirror's
[scraper](https://github.com/enkday/prizepicks-data-mirror/blob/116358bc8a695a296665624354384176fbaa92f1/scraper.js)
excludes goblins, demons, fantasy scores and combination markets. This does
not establish complete coverage of the app's current PropLine feed.

NBA outcomes/history come from the app's stored hoopR/ESPN rows for
2025–26 and 2026–27. NFL outcomes/history come from its nflverse rows,
with 2022–26 used to refit models. The replay windows are Dec 6, 2025–Nov 4,
2026 for NBA and Dec 7, 2025–Nov 2, 2026 for NFL. At extraction, the app's
own prospective track record had 12 NBA and 2 NFL picks, **none resolved**;
it cannot yet independently confirm these findings.

Raw store exports, source revision manifests, SHA-256 hashes, every replayed
selection and full numeric results remain in ignored `data/sports-backtest/`.
Only this aggregate report and the reproducible research code are committed.
No provider key or raw private dataset is included in the repository.

## Time and selection controls

1. Accept a source snapshot only when its scrape time is no later than one
   minute after its Git commit and no more than ten minutes before it.
   Check the per-prop fetch time too when available. Git capture provenance
   cannot independently certify that the upstream source had no errors.
2. Match scheduled home/away identities and kickoff within ten minutes,
   just as the live selector does. Only full-game stat labels explicitly
   mapped to the live catalog are eligible. Reject conflicting thresholds
   for the same player's stat rather than choosing the easier one.
3. Use the first accepted snapshot within 24 hours before the game. The
   mirror generally records a morning board; the live system can instead
   issue its first pick at another time and later fill an empty slot.
4. Identify players by normalized names and their **prior** team history.
   Current catalog team/position and the eventual game participants do not
   choose the candidate universe. Team and position come from earlier rows.
   Canonical name coverage can still omit a player or miss a renamed athlete.
5. Cut every statistical input before the capture's Eastern calendar date.
   Refit corrections, variance and validation status from those earlier
   rows for each capture date. Never load the current fitted model into a
   historical forecast. Defense and rest also use earlier games only.
6. Run the exact production candidate scorer, then compare selectors using
   the same eligible candidates. The history-only ablation reruns the scorer
   without a model, so it is not restricted to model-approved candidates.
7. Historical injury, starting-lineup, restriction and news snapshots are
   unavailable. The research caller supplies an explicitly empty injury
   context; this is an **ablation**, not evidence those players were healthy.
   It never treats final DNPs as known pregame injury information. Readable
   live-scorer availability text in raw replay output must not be interpreted
   as an archived ESPN report.
8. Grade after selection using final stored stats. Equality is a push;
   explicit DNPs are void. A missing NBA player row with a populated game
   box is void; a missing NFL row remains awaiting stats. Operator reboot
   rules are not reproduced. NBA test pairs include 3 pushes and 9 voids;
   NFL test pairs include 1 push and 2 awaiting-stats selections.

The archive preserves a standard threshold but not allowed wager sides;
the replay assumes both More and Less were offered. This is a material
limitation, especially for unusual low thresholds. Original box publication
times and subsequent corrections are also unavailable: prior calendar-day
final stats are assumed available by the morning capture. The current model
specification was originally developed using some of these seasons, so this
retrospective exercise is weaker than a new prospective test, even though
fitted parameters and inputs are reconstructed from the past.

## Comparing selection rules

The first 50% of covered game dates are development, the next 25% validation,
and the last 25% final test. Games and both selections stay together. NBA
validation starts Mar 16 and test starts May 2; NFL validation starts Sep 14
and test starts Oct 11. These are date shares, not equal game counts.

Before scoring, the script defines six alternatives to the one-per-team
baseline: stable workload (last 5 / last 10 between 0.90 and 1.10), rank at
least 60, historical hit rate at least 70%, omit rare-event markets, require
a supported stat model, and omit model contributions. To be selected on
validation, a rule needs at least 100 graded props and at least 75% as many
complete pairs as the baseline. Highest validation hit rate wins; ties keep
the earlier declared rule. Neither league selects an alternative. **The
final test does not choose a rule.** Its alternative rows below are
descriptive and cannot be used for a second round of tuning this holdout.

| Rule | NBA validation hit rate | NBA test hit rate / pair coverage | NFL validation hit rate | NFL test hit rate / pair coverage |
| --- | --- | --- | --- | --- |
| One from each team | 52.0% | **58.0% / 85.6%** | 52.7% | **54.3% / 96.4%** |
| Stable workload | 50.5% | 57.0% / 80.4% | 50.7% | 47.9% / 64.3% |
| Rank ≥60 | 52.3% | 50.5% / 35.9% | 45.6% | 57.9% / 69.6% |
| History ≥70% | 51.6% | 55.8% / 69.9% | 53.2% | 55.6% / 82.1% |
| Omit rare events | 50.4% | 55.6% / 80.4% | 53.8% | 55.8% / 96.4% |
| Modeled stats only | 55.2% | 57.1% / 74.5% | 59.5% | 54.3% / 44.6% |
| History only | 51.7% | 55.1% / 84.3% | 55.1% | 53.8% / 94.6% |

The NBA modeled-only rule misses the validation coverage floor (169 pairs
versus 226 baseline pairs; 75% requires at least 170). No NFL rule has 100
graded validation props. Picking the most attractive final-test row after
seeing it would turn the holdout into another tuning set.

Compared on **the same games with two eligible picks**, the old two-distinct-
players rule hit 55.2% for NBA and 52.9% for NFL; the team rule hit 58.0% and
54.3%. The estimated differences are +2.8 and +1.4 percentage points, but
their day-clustered 95% intervals are **−0.6 to +7.1** and **−4.1 to +7.4**
points. The team rule is required for valid pairs; this sample does not
establish that it reliably improves accuracy by itself.

Hit-rate intervals resample whole calendar days with replacement, preserving
both picks and same-day games (2,000 replicates, fixed seed 7637). They
describe sampling uncertainty in this dataset, not missing-source bias or
future season drift. No individual-pick independence assumption is used for
the observed both-win rate.

## Improvements supported by this work

- **Enforce team eligibility in selection and recording.** This ships now,
  including delayed slot fills. Preserve previous issued records so an
  apparent improvement cannot come from replacing historical losers.
- **Keep scoring weights unchanged for now.** Higher ranks are not observed
  to be consistently more accurate: NBA test picks in the 50–59 band went
  54–29, while 60–69 went 64–53. NFL 60–69 went 31–17, while 70–79 went
  13–17. These small, retrospective slices do not justify new cutoffs or
  treating a rank score as a probability.
- **Capture the complete pregame decision input next.** Save the full offered
  board, restricted sides, injury/restriction details, source times and all
  scored/rejected candidates at issue time, alongside the frozen selected
  pair. The existing track record preserves the selected picks and their
  analysis, but cannot compare alternatives that were never saved. This is
  the main missing substrate for testing the full live system.
- **Calibrate on new prospective games before retuning.** Compare observed
  win rates by sport, market, side and history/model basis using shrinkage
  rather than treating a short hot streak as an edge. Test any new workload
  or injury-role adjustment on later games and report coverage alongside
  accuracy. The tested blanket stable-workload filter did not help.
- **Evaluate pairs as pairs.** The observed both-win rates are only 35.3%
  and 31.4% on resolved test pairs. Improving two individual ranks does not
  automatically improve a pair when game outcomes are linked. Joint-model
  work needs calibrated individual chances and its own later-game test.

## Reproduce

Run from the repository root with Node 20+. The first command reads private
R2 records into ignored files; it does not mutate the store. An existing
`data/sports-backtest/raw/{nba,nfl}.json` export can be replayed without creds
by omitting `--refresh-data`. Keep an immutable copy to reproduce the same
box-score version after future upstream corrections.

```sh
mkdir -p data/sports-backtest
git clone https://github.com/enkday/prizepicks-data-mirror.git data/sports-backtest/mirror
git -C data/sports-backtest/mirror checkout 116358bc8a695a296665624354384176fbaa92f1
node --env-file=r2.env scripts/sports-props-backtest.mjs --refresh-data --until=2026-11-04
npm run test:sports-props
```

Outputs: `data/sports-backtest/report.json`, `nba-replay.json`, and
`nfl-replay.json`. The report contains input hashes, exact accepted source
commits, rejection counts, development/validation/test metrics, paired
comparisons, and market/side/rank breakdowns. Offline regression fixtures
verify that changing future outcomes, team or position cannot alter an
earlier selection or its forecast, plus team restrictions, DNP/push/missing
stat grading, reproducible uncertainty and unchanged model fits when skipping
the unused joint estimator.
