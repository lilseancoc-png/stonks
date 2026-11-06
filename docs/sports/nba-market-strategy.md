# NBA market research (`nba-market-1`)

NBA uses sportsbook prices to choose its two research candidates, one player
from each team. NFL remains on `props-rank-3`. The existing first-issued prop
record is immutable; NBA also starts a separate prospective cohort so its
results are not mixed with the old ranking. No retrospective accuracy gain
is claimed. New games, recorded before kickoff, test this strategy.

## Quote comparisons

The existing PropLine key makes two bulk NBA requests: PrizePicks and
reference operators DraftKings, FanDuel, BetMGM, Pinnacle, BetRivers and
Fanatics. Current prices are available with the existing free key; the
provider's paid EV endpoint is not used. See the primary
[provider contract](https://prop-line.com/docs), especially timestamps,
bookmakers, full-game periods and the distinction between DFS synthetic
prices and sportsbook payout odds.

- Only pregame, full-game, coherent Over/Under pairs from the same operator,
  market delivery, player and threshold qualify. One-sided N+ ladders,
  withdrawn selections, suspended/boosted markets, contradictory duplicates,
  invalid odds and stale data are excluded. NBA PrizePicks lines must
  explicitly identify their DFS type as standard; unknown types are excluded. No best-price mixing across
  operators or deliveries is used to remove margin.
- Both sides must be offered within five minutes and within thirty seconds
  of each other. An outcome that missed its market's latest delivery is
  excluded. Where a book publishes its own timestamp, it must also be fresh.
  Pinnacle's cached-feed timestamp is required: a fresh scrape cannot refresh
  a source that is already fifteen minutes old. Cache hits recheck age.
- American prices become implied probabilities, then each side is divided by
  the pair's total. Accept overround from 0% through 25%; reject underround or
  extreme-margin pairs. PrizePicks' synthetic +100/+100 values never enter
  this calculation. Normalization is a market estimate, not a guarantee that
  a bookmaker probability is correct.
- Reference prices use half thresholds on integer count stats, avoiding the
  unknown push mass in whole-line two-way odds. For an integer PrizePicks
  threshold T, More T has the same strict win event as sportsbook Over T+0.5,
  and Less T is Under T-0.5. Fantasy scores have no such integer guarantee
  and remain research without a supported comparison.
- For different thresholds, monotonicity gives bounds, with no interpolated
  point estimate. For example, a book's fair Over 25.5 probability is a lower
  bound for More 24.5. A contradictory ladder is excluded. At least three
  distinct reference operators are required for a supported comparison.
  The smallest book lower estimate and largest upper estimate form a quote
  sensitivity range; they are **not statistical confidence intervals**.
- Exact comparisons additionally report the median fair probability. Raw
  last-change times produce a repricing watch when multiple references move
  after PrizePicks; that is a hypothesis, not proof of a lag, and never adds a
  second probability boost for information already in the prices.

Player identity, team stint, recent activity, injury restrictions and eight
usable played games still apply. The history score no longer excludes an
otherwise eligible NBA candidate just because it is below 50: the market
comparison drives selection. Research can still show two ideas when market
coverage is incomplete; that pair displays **Pass**, not a recommendation.

## Role and game context

Minutes use a recency-weighted last ten, with measured teammate-DNP changes
shrunk by n/(n+10). Material absences require a teammate with at least twenty
normal minutes and at least three explicit DNP observations; insufficient
evidence flags unresolved rotation risk. The 10th–90th historical minute
range describes variation, not a confidence interval. Minutes are capped at
48 for this regulation-minute scenario.

Stat production per minute can change in the same measured DNP sample.
Usage is estimated from FGA + 0.44×FTA + turnovers, scaled by team minutes and
team totals. A possessions proxy uses team FGA + 0.44×FTA + turnovers −
offensive rebounds, normalized to 48 minutes. Recent opponent/team tempo
adjusts the scenario, bounded to 0.8–1.2 of the player's team rate. Missing
box inputs remain unavailable. Position defense, player/opponent splits,
location and rest remain visible in the original evidence.

These are **experimental opportunity scenarios**. They do not increase the
market probability or claim a confirmed starting lineup. Unresolved teammate
status, unmeasured material rotation changes and a minute range over fourteen
minutes make the entry screen pass. Prospective snapshots let later models
test whether these inputs improve predictions.

## Pair choice and actual payout

Consider the best ten research candidates on each team and choose the pair
with the strongest conservative pair estimate, favoring resolved role risk.
For supported comparisons, a fresh, previously validated opponent link from
the existing points/rebounds model can provide a Gaussian-copula sensitivity
range. Over/Under direction reverses the correlation sign appropriately.
This transfer to sportsbook marginals is still experimental. An unsupported
or stale link uses Fréchet bounds instead of assuming independence. No
unvalidated same-game correlation estimate silently becomes a precise price.

No 3× payout is assumed. The Owner enters the actual total multiplier shown
for those two players and clicks **Evaluate pair**. A positive screen needs
both props supported, no unresolved role risk and a positive return at the
lower sensitivity estimate: multiplier × probability − 1. The screen always
states its experimental status; a positive screen is not verified alpha.
Changes to entered payout or the board invalidate the displayed result.

**Save paper pair** is an explicit same-origin Owner POST. It freezes one
paper pair per game, with the original snapshot, players, side, threshold and
owner-entered payout. Idempotent repeats are safe; replacing it with a
different pair or payout returns 409. A pass can be saved for research and is
reported separately from positive screens. Source age, snapshot expiry and
both kickoff times are rechecked at use/save time. No wagers are placed.

## Private evidence and replay

The Owner API and collector save the same evidence under
`_stonks/sports/v1/nba/research/`:

- `inputs/<sha256>.json`: immutable, compressed complete stored statistical
  input (players, original season rows/schedules, model and status).
- `<season>/games/<id>.json`: compressed first decision and last fifteen full
  snapshots; snapshots used to issue either frozen leg and the first saved
  paper entry are pinned. Raw PrizePicks/reference boards, normalized quotes,
  injury details, every scored candidate, rejection reasons, role/matchup
  features and chosen pair survive together. There is no outcome-based
  replacement. Intermediate snapshots can be dropped to meet a sixteen-MB
  raw/two-MB compressed per-game limit; first/pinned/latest evidence remains.
- `<season>/index.json`: compact issued/paper summaries and the last supported
  pregame pricing of the **original** thresholds. Started games close without
  incorporating in-game prices. A later scan repairs an index write
  interrupted after its game object was saved.

Content hashes detect corruption; capped decompression prevents oversized
records. These keys never enter the public data generations or reader.
Responses require the signed Owner session and are `private, no-store`.
No API key is included in a response, stored decision or download.

The game and prospective-record UI download a gzip JSON bundle containing
all retained snapshots and their exact statistical inputs. Web downloads
over four MB fail explicitly rather than omitting fields; the private CLI
has no web-response ceiling. Offline replay verifies the decision and input
hashes, then reruns the live scorer/selector using the frozen time, histories,
injuries, prices and model. It cannot silently substitute current data.

```sh
# Read-only statistics from the private store
node --env-file=r2.env scripts/nba-research-report.mjs
# Complete private export, including bundles above the web limit
node --env-file=r2.env scripts/nba-research-report.mjs --season=2026 --game=<id>
# Offline verification; no provider or store calls
node scripts/replay-nba-research.mjs data/nba-research/nba-research-<id>.json.gz
```

## Prospective metrics and collection

The NBA track-record view separately reports all first-issued research
props, both-win pair results, exact-price Brier/calibration bins, indicative
closing value and paper unit returns. Calibration bins with fewer than thirty
samples say so. Closing comparisons require a supported exact price for the
same original threshold, captured within ten minutes before kickoff; they
are not automatically the true closing sportsbook price or proof of profit.

Paper ROI uses the entered payout only on fully resolved win/loss pairs;
push/void pairs are excluded because operator settlement/reboot rules are
not reconstructed. Missing final stats or player rows remain pending; a partial NBA box score
  never supplies an inferred DNP. Observed cancellations/postponements remain
  excluded even if a later schedule reopens the game. Positive screens and
pass entries have separate paper-return breakdowns. Never select new cutoffs
using the already-inspected historical holdout; these new, frozen decisions
provide a fresh prospective sample instead.

The existing half-hour collector remains in place, with NFL unchanged. A
new NBA-only workflow fills five-minute gaps during UTC 17:00–07:59. Baseline
traffic is 144 requests/day from the old job plus 300 from the new one, within
the existing free key's 1,000/day allowance before interactive use. GitHub
schedule delays can leave closing coverage incomplete; timestamps determine
quality, not the scheduled time. Outages preserve old records and produce
pass states; NBA outage evidence can still be retained.

Offline regression coverage: `npm run test:nba-alpha` and
`npm run test:sports-props-browser` (desktop and mobile). Fixtures exercise
freshness, withdrawal, duplicate ladders, margin removal, threshold bounds,
correlation, role risk, exact replay, immutable paper entries, settlement,
CLV/ROI, Owner/CSRF isolation and the unchanged NFL feed contract.
