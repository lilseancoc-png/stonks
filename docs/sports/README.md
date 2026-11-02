# Sports (Owner-only)

Private NBA and NFL research for the two site owners. It collects game and
player history and helps judge pick'em lines (PrizePicks- or Betr-style
entries of 1 to 6 picks) **on paper only**. It never places a bet, never
calls a sportsbook or PrizePicks API, never scrapes a line site, and makes no
AI calls. Lines are typed in by hand, or read from a screenshot by Claude or
ChatGPT outside the site.

## Pages

| Page | `?tab=` | What it shows |
|---|---|---|
| NBA | `sports-nba` | Today's and tomorrow's games, player charts and game logs, player and team stats |
| NFL | `sports-nfl` | The same for the NFL |
| Pick Builder | `sports-pick-builder` | A 1 to 6 pick entry with its real payout, the odds, and a paper journal |

The three pages sit in their own **Sports** sidebar group (`SITE_SECTIONS` in
`scripts/render/site-map.mjs`) and in `OWNER_PAGE_IDS`
(`lib/owner-access-policy.mjs`), so they follow the same Owner gate as every
other Owner page: no group, pane, palette entry or request unless
`/api/auth/me` reports both Owner claims. `SPORTS_PAGE_IDS` lists them.

**Today and Tomorrow** are calendar days in `America/Los_Angeles` by default
(`lib/sports/time.mjs`). The picker offers Pacific, Mountain, Central and
Eastern; the choice is a per-browser convenience in localStorage
(`stonks-sports-tz-v1`). A 10:30 p.m. Pacific tip-off is still "today" in Los
Angeles even though it is past midnight in New York.

## Stats

One catalog, `SPORTS_STATS` in `lib/sports/schema.mjs`, lists every stat the
pages, charts, Pick Builder and MCP take, in three groups:

| League | Main | Combos | More |
|---|---|---|---|
| NBA | points\*, rebounds\*, assists, 3-pointers made, steals, blocks, turnovers (plus minutes on the pages) | points + rebounds + assists (PRA), points + rebounds, points + assists, rebounds + assists, blocks + steals, fantasy score | field goals made / attempted, 3-pointers attempted, free throws made / attempted, offensive and defensive rebounds |
| NFL | passing yards\*, receptions\*, rushing yards, receiving yards, rush + receiving TDs | rush + receiving yards, pass + rush yards | pass completions and attempts, passing TDs, interceptions thrown, rush attempts, targets, rushing TDs, receiving TDs |

\* has a model forecast (`model: true`, which must match `MODEL_SPECS`;
`sports-smoke` checks it). Every other stat gets averages, charts, history hit
rates and Pick Builder picks, but no model chance; a pick on one says "no
forecast for this stat; history only", and a same-game pair that includes one
stays unpriced because links are measured only between modeled stats.

Combos are worked out when a row is read (`statValue`): a weighted sum of
stored stats, so no season needs a new download. An NBA combo needs every
part (a blank part means the row cannot give one). An NFL combo counts a blank
part as zero while at least one part is there, because nflverse leaves a
column blank when a player had none of that stat. Defensive rebounds are
rebounds minus offensive rebounds. The fantasy score uses PrizePicks'
published NBA weights: points 1, rebounds 1.2, assists 1.5, steals 3,
blocks 3, turnovers −1. Settlement uses the same sums.

The page gets the catalog's names and groups from `app-js.mjs`
(`statCatalog`); every stat picker is grouped Main / Combos / More, and the
player panel's averages and game log and the Player stats table each have a
**Main / Combos / More / All** switch for their columns.

## Charts and stats views

Each league page has three views: **Games** (the board, a game's players and
player search), **Player stats** and **Team stats**. A player opened from any
of them gets the same panel.

**Player charts** (in the player panel, drawn in the page from the player's
stored games; the page asks the route for every stored game, `CHART_LIMIT`):

| Chart | What it shows |
|---|---|
| Bars | One bar per game, oldest first, a dashed line at the average of the games shown. Green above it, red below. With a typed line, colors follow the line instead and both lines are drawn |
| Trend | The game-by-game line with a five-game moving average |
| Hit rates | For a ladder of half-point lines around the average (and the typed line): how many of the games went over |
| Spread | How many games landed in each range of values |
| Vs minutes / volume | The stat against minutes (NBA) or pass attempts, targets or carries (NFL), with the per-minute or per-target rate the stat model also uses |
| Splits | Home or away, started or bench (NBA), rest before the game, each opponent and each season |

Every chart takes any stat in the catalog, combos included (and minutes for
the NBA), a window (last 5, 10 or 20 played
games, this season or every stored game) and an optional line. A facts strip
under the chart gives games, average, median, low to high, standard deviation,
how many games cleared the line (or the average) and the last five against the
window. Missed games are left out and counted. Rest days are days since the
team's previous stored game, so NFL players with no stat in a game do not
look rested.

**Player stats** (`?sports=leaders`): every player's per-game averages for one
season, over the whole season or each player's last 10 or 5 played games.
Filter by team, position group (NBA guards / forwards / centers; NFL QB, RB,
WR, TE) and games played; sort any column, or show the top 20 as bars against
the average of the players shown.

**Team stats** (`?sports=teams`): records, home, away and last-10 records,
streak and points per game from final scores, and for any stat what each team
put up per game, what it allowed, and what it allowed to each position group.
Sort any column, or chart one measure for every team against the league
average. Selecting a team opens its players in Player stats.

The game panel can switch every player to one stat and shows each player's
last ten games as small bars around their own average. Each Pick Builder pick
shows its last ten games against its own line (green would have won); those
values are not saved with an entry.

All of it reads stored box scores only. Nothing here is a forecast except the
model section, which is labeled.

## Server route

`GET /api/auth/me?sports=<op>` inside `api/auth/[action].js`
(`lib/sports/http.mjs`). It rides in the existing auth function, like the
Research Lab's `?lab=`, so Sports adds no Vercel function (the Hobby plan caps
the project at 12).

- Needs `PRIVATE_DATA_ENABLED=1` and a signed session carrying both Owner
  claims (`tr` + `tp`) and a subject (`lib/sports/access.mjs`).
- `SPORTS_ENABLED=0` (Vercel env) is the kill switch: the route answers 404 and
  the pages show their error state. Unset means on.
- A non-Owner session gets 403. Every response is `private, no-store`.
- Ops (all `GET`, `lib/sports/read.mjs`):
  - `status`: the day window, time zones, each league's data status and the
    stat catalog.
  - `board&sport=&tz=`: games starting today or tomorrow in that zone, plus
    the next game after the window.
  - `game&sport=&id=`: the players each team used in its last three games this
    season, with averages of every stat from games before this one.
  - `players&sport=&q=`: player search (accents and punctuation ignored).
  - `player&sport=&id=`: a player's latest 40 stored games, with last 5, last
    10, all stored, median, low and high for each stat.
  - `player` also returns `next_game`: the team's next stored game that has
    not started, which a new pick attaches to, and `forecast`: the stat
    model's forecast of each modeled stat for that game (see Stat models).
  - `journal`: every saved paper entry, newest first, settled from the
    stored finals, with the totals (`lib/sports/journal.mjs`).
- Pick Builder ops are `POST` with a JSON body and must come from the site
  itself (same-origin check). Bodies over 16 KB are refused.
  - `evaluate`: read-only. Checks the picks against stored games and
    players, adds each pick's history hit counts and the model's chance for
    the typed line, and prices the entry.
  - `save-entry`: saves a paper entry (only before every game starts).
  - `revise-entry`: `{ entry_id, action: "settle", gross, note }` or
    `{ entry_id, action: "withdraw" }`.
  A request the owner can fix (a bad line, a started game, a missing payout)
  comes back as 400 / 403 / 404 / 409 with a short reason the page shows.
  Anything else is a plain 502 with no detail.

## Storage

JSON files in the private R2 store under `_stonks/sports/v1/`
(`lib/sports/store.mjs`). That prefix is outside the published data
generations: `/data/*` refuses it, `sync-data.mjs` never pushes or deletes it,
and the MCP’s general key filter refuses it (only the Sports MCP tools’ own reader can read Sports records, below). Each read is capped at 24 MB.

| Kind | Key | Written by |
|---|---|---|
| `status` | `status/{sport}.json` | each league's data job (last run, seasons, counts) |
| `players` | `{sport}/players.json` | data jobs (players plus provider ids) |
| `games` | `{sport}/games/{season}.json` | data jobs |
| `player-games` | `{sport}/player-games/{season}.json` | data jobs (packed rows, below) |
| `model` | `{sport}/model.json` | data jobs (stat model numbers and their check, plus the same-game links as `joint`; about 12 KB) |
| `observations` | `markets/observations.json` | Pick Builder (captured lines, append-only) |
| `journal` | `journal/entries.json` | Pick Builder (paper entries, append-only revisions) |

JSON was chosen over a database for now: the data is small, written by one
scheduled job per league plus two owners, and R2 stays inside its free tier.

Player-game rows are stored packed (`lib/sports/rows.mjs`): one `columns`
list and an array per row, instead of repeating every key. A full NBA season
went from 16 MB to 4 MB. `unpackRows` returns the plain records the schema
defines and can unpack a single player without the rest of the season.

## Data jobs

`.github/workflows/sports-data.yml` runs once a day at 13:20 UTC (early
morning in the US, after the providers' overnight updates and the previous
night's games) and on demand. NFL and NBA are separate jobs, so one provider's
outage never blocks the other. Each runs `npm run test:sports`, then
`node scripts/sports-ingest.mjs --sport=<league>`. Both leagues share one
ingest (`lib/sports/ingest.mjs`) with a small adapter per provider
(`lib/sports/leagues.mjs`):

- Keeps the current and previous season. Sports labels a season by the year
  it starts (NFL 2026 = Sept 2026 to Feb 2027; NBA 2026 = 2026-27). The
  current season refreshes every run. A finished season is stored once with
  `complete: true` and is not downloaded again unless the adapter version
  changes. Postponed games do not hold a season open.
- Stores a player's line only once the schedule marks that game final. A
  line for a game still in progress (or one the schedule has not caught up
  with) waits for the next run, so a partial stat line never reaches the
  logs, averages or charts.
- Writes data first and the status record last. If a refreshed season would
  lose more than 20% of its stored rows, or a download fails, nothing is
  replaced: the status record shows the failure and keeps the last good time.
- The status record also names the latest stored game, so a provider that
  lags shows on the page.
- After the data, the job refits the stat models on the stored seasons and
  writes `<sport>/model.json`; the status record carries the check (see Stat
  models). A failed refit keeps the stored model and is noted; the game data
  still lands. NFL also keeps three older finished seasons for the model only
  (`modelHistory: 3`, about 6,500 rows each, downloaded once); the pages still
  read two seasons. A missing older season is noted and never fails the run.
- Logs counts only, because workflow logs are public.

**NFL** (`lib/sports/nflverse.mjs`) reads three nflverse release files:
`schedules/games.csv`, `stats_player/stats_player_week_<season>.csv` and
`players/players.csv`. It keeps quarterbacks, running backs, receivers and
tight ends, converts kickoff times from US Eastern to UTC, and drops the
sportsbook spreads, totals and moneylines the schedule file carries. nflverse
lists a player only for games where he recorded a stat, so a missed game is
absent from the log rather than a zero. The page says so under every game log.

**NBA** (`lib/sports/hoopr.mjs`) reads the hoopR release files from
`sportsdataverse-data`: `espn_nba_schedules/nba_schedule_<year>.csv` and
`espn_nba_player_boxscores/player_box_<year>.csv`, where hoopR's `<year>` is
the year the season ENDS (Sports season + 1). It keeps regular season,
play-in and playoff games of the 30 NBA teams (All-Star and exhibition teams
are skipped). Did-not-play rows are kept with their reason and null stats, and
are left out of averages. Player names come from the box scores. hoopR's files
usually run a day or two behind the latest games.

Local checks without credentials:

```bash
node scripts/sports-ingest.mjs --sport=nfl --dry-run                  # network, writes nothing
node scripts/sports-ingest.mjs --sport=nba --dry-run --source-dir=DIR # local CSV copies
```

Dry runs on 2026-11-02:

| League | Games | Player games | Players | Stored size |
|---|---|---|---|---|
| NFL (2025, 2026) | 557 | 9,111 | 748 | about 1.4 MB |
| NBA (2025-26, 2026-27) | 2,526 | 37,182 | 655 | about 5.3 MB |

## Pick Builder

Payout math lives in `lib/sports/payout.mjs`; checks, saving and settlement
in `lib/sports/journal.mjs`.

**Payouts are typed in.** The owner enters the gross multiplier the app shows
for this exact entry (stake included: 3× on $10 pays back $30). Power pays only
when every pick hits; flex can pay for fewer. The site never derives a payout
from the number of picks. Payouts clear when the picks or the entry type
change.

**Chances are the owner's.** Each pick shows how often the player cleared the
line in stored games before this one (last 5, last 10, all stored). A rate can
be copied into the chance box only from 5 or more games and when it is not 0%
or 100%, and it is labeled "from history". Nothing fills a chance in by
itself. A shared link never carries chances.

**What the page computes** (roadmap V4 §5):

- Breakeven for power: `1 / M`, the chance all picks must hit together to pay
  back the stake on average.
- Independence baseline: `P(k hit)` from the Poisson-binomial over the
  entered chances, `expected back = stake × Σ P(k) × payout(k)`, expected
  profit and return. Fixture: $1, 9% to hit both, 55× pays +$3.95 expected,
  +395%, breakeven 1.81818%; at 53× it is +$3.77.
- Range under any link between picks (Fréchet bounds):
  `max(0, Σp − (n − 1)) ≤ P(all hit) ≤ min p`.
- Picks from the same game are flagged: their results move together, so
  multiplying chances would be wrong. They are priced with the measured links
  between them (see "Same-game chances" below) once every pick has a chance.
  When a pair has no measured link, or a player's team is not known, the page
  shows the breakeven and the reason, never a combined number.

**Saving.** A paper entry needs the app, the entry type, a stake and the
payout; chances are optional. Every game must still be ahead. The entry keeps
the evaluation it had at save. Each pick is also appended to
`markets/observations.json` as a captured line (`source: "manual"`). Both
files are append-only and written under an R2 lease (`withLease`), so two
saves cannot overwrite each other; a busy lease answers "try again". Entries
carry an owner tag (a hash of the session subject), never the Discord id.

**Settling** happens when the journal is read, from the stored finals:

| Case | Result |
|---|---|
| Final, stat above / below / equal to the line | hit / missed / push |
| NBA player did not play, or has no row once the game's box score is stored | void |
| NBA game final but its box score not stored yet | stays open |
| NFL player has no row (the file leaves out players with no stat) | stays open |
| Game postponed or canceled | void |

A power entry with any miss is lost. Any push or void sends the entry to
"needs your payout", because each app handles those its own way; the owner
types what the app paid. That typed amount can also close an NFL pick with no
row. It is allowed only after every game has started, never overrides an
entry the finals already settled, and can be corrected. **Withdraw** is for an
entry saved by mistake and works only before any game starts. Only the owner
who saved an entry can change it. Outcomes: won (more back than staked),
stake back, partly paid, lost.

The journal totals settled entries (paper profit and return) and, next to
them, the sum of the expected profit those entries had at save, so the
baseline can be checked against what happened.

**Shared links.** `/?tab=sports-pick-builder&entry=<base64url JSON>` fills
the draft (`lib/sports/prefill.mjs`: `encodePrefill` / `decodePrefill`; the
page reads the parameter once and removes it). Fields: `v: 1`, `operator`,
`format`, `stake`, `payouts`, and `legs` of `sport`, `player_id`, `game_id`,
`stat`, `side`, `threshold`. The MCP's `sports_evaluate_entry` hands these
out after Claude or ChatGPT reads a screenshot. The owner still checks and
saves.

**Browser storage.** The unsaved draft lives in sessionStorage
(`stonks-sports-draft-v1`) and is gone when the tab closes. Saved entries are
only in R2.

## Stat models

`lib/sports/models.mjs` (`sports-model-1`). Deterministic and AI-free: the
same stored games always give the same numbers.

**Forecast.** expected stat = expected opportunity × rate per opportunity ×
opponent factor × home/away factor, then a straight-line correction.

| Stat | Opportunity | Who | Curve |
|---|---|---|---|
| NBA points, rebounds | minutes | everyone | negative binomial |
| NFL passing yards | pass attempts | QBs | normal |
| NFL receptions | targets | WR, TE, RB | negative binomial |

- Opportunity: the player's recent games, recency weighted (NBA last 10,
  half-life 5; NFL last 8, half-life 4), pulled toward his own longer average.
- Rate: recency weighted over a longer window and shrunk toward the league
  rate for his position group.
- Opponent: what that team allowed in its recent games against the league
  average, shrunk hard by sample size (NBA 30 games, NFL 20).
- Correction: `x ≈ a + b × forecast`, fitted on past forecasts (slope held to
  0.6-1.2). It pulls back forecasts that ran high.
- Spread: variance = `a + b × forecast`, fitted on past misses. Counts use the
  negative binomial with that variance (a Poisson when it is not above the
  mean); passing yards are not skewed like a count, so they use a normal curve
  on whole-yard bands. A whole-number line gets a push chance.
- Fewer than 5 stored games with the stat, a player not on either team, or a
  position outside the table: no forecast, and the page says why.

**Check.** `buildModel` walks the stored seasons day by day and forecasts
each game from earlier days only. The first 60% of days fit the correction and
spread; the last 40% are held out and scored against the last-10 hit rate
(smoothed) and the plain average. Only regular-role games are scored (20+
expected minutes; 20+ attempts; 3+ targets), the players lines are posted for.
No past lines are stored, so each check uses the player's last-10 average
rounded to a half point as a stand-in line. A stat is `validated` only with
300+ held-out games, a lower Brier score than both baselines and chances off
by 3 points or less on average (expected calibration error, 10 bins);
otherwise `experimental`, with the reason. A forecast for a smaller role than
the check covers is always shown as experimental.

**Tuning (2026-11-02, real seasons).** The first cut shrank minutes and
targets toward the position-group average, which pulled stars down and lost
to both baselines. Dropping that, pulling toward the player's own longer
average, harder opponent shrink, the correction line, the straight-line
spread and the normal curve for passing yards gave:

| Stat | Seasons | Held out | Brier: model / last-10 / average | Off by |
|---|---|---|---|---|
| NBA points | 2025-26 + 2026-27 to date | 5,200 | 0.242 / 0.255 / 0.254 | 1.6 pts |
| NBA rebounds | same | 5,200 | 0.237 / 0.253 / 0.242 | 0.9 pts |
| NFL passing yards | 2022-2026 | 890 | 0.247 / 0.261 / 0.251 | 3.0 pts (just over the bar) |
| NFL receptions | 2022-2026 | 3,867 | 0.234 / 0.249 / 0.252 | 1.3 pts |

The structural choices were made looking at these holdouts, so the numbers
flatter the model a little; the daily refit re-checks it on new games. With
only two NFL seasons, passing yards had 239 held-out games, which is why NFL
keeps older seasons. Forecasts know nothing about injuries, rest or news.

**Where it shows.** Player pages: the next game's forecast for each enabled
stat (expected, 80% range, chance of the over at five lines). Pick Builder:
each pick's model chance for the typed line, with its range and the ±10%
opportunity check, and a button to use it (`probability_source: "model"`,
kept only when the number is exactly the model's). Saved picks keep a small
snapshot of the model's read. The journal shows, for settled picks, the model
chances and the chances used against what happened (count, average chance,
hit rate, Brier). Each league page has a Model check card, which also lists the same-game links and their check.

## Same-game chances

`lib/sports/joint.mjs` (`sports-joint-1`, method `gaussian-copula`), with the
normal-curve helpers in `lib/sports/normal.mjs`. Deterministic and AI-free.

**What it measures.** Every scored forecast in the stat-model check leaves a
miss. Each miss becomes a normal score: where the result fell on that
forecast's own curve (the middle of its whole-number step). For every kind of
pair in one game (the same player's two stats, teammates, opponents; for each
two stats) the **link** is the correlation of those scores. That one number
already holds the shared conditions roadmap §5.3 lists (pace, minutes, game
script, shared targets), measured from the stored games instead of simulated
play by play. A link needs 30+ games; its 95% interval uses Fisher's z and
counts games, not pairs (pairs from one game share players, so this errs
wide). Links are refit with the model every day and stored in `model.json` as
`joint.pairs["<stat>|<stat>|<relation>"]`.

**How an entry is priced.** Each pick wins when its own normal score lands
past the point that gives the chance the owner entered (over: the top `p`;
under: the bottom `p`). The scores of picks from one game are drawn together
with the measured links, 100,000 seeded draws per game (Cholesky; links that
do not fit together are pulled toward 0 and the page says so). That gives the
chance all picks hit and the chance of exactly k hits for flex. Picks from
different games are independent, so the games' results are combined by
convolution. The **range** re-runs the same draws with every link at the low
and the high end of its 95% interval (a higher link between two winning
directions always raises the all-hit chance) and stays inside the any-link
bounds. The page also shows the chance with the picks treated as unrelated.
The result carries `joint_probability`, `range`, `independent_probability`,
`bounds`, `distribution`, the expected payback, `links`, `model_version`,
`as_of_date` and `simulation: { draws, seed }` (the seed is a hash of the
picks, chances and links, so the same entry always gives the same number).

**Check.** Links are fitted on the earlier 60% of days and scored on the later
40% (the same split as each stat's check). For each later pair, the copula's
four outcomes (both cleared their stand-in line, only one, neither) are scored
(Brier) against treating the two as unrelated. A link is `validated` only with
300+ later pairs, a score no worse than independence, and a both-cleared rate
within 2 points of what happened; otherwise `experimental` with the reason. A
link near 0 can pass: then the check says treating that kind of pair as
unrelated was right. An entry is `validated` only when every link in it is
and every same-game pick has a regular-role forecast (the links were measured
on regular-role players).

**Real seasons (2026-11-02).** The links that matter:

| Pair | Seasons | Link | Later pairs: both cleared / link said / unrelated said | Check |
|---|---|---|---|---|
| NBA one player's points and rebounds | 2025-26 + 2026-27 to date | +0.28 | 5,200: 24.7% / 23.8% / 20.0% | passed |
| NFL QB passing yards and a teammate's receptions | 2022-2026 | +0.24 | 3,759: 25.0% / 23.5% / 20.0% | passed |
| NFL opposing QBs' passing yards | 2022-2026 | +0.11 | 424 pairs, scored worse than unrelated | experimental |
| NBA teammates' or opponents' points | 2025-26 + 2026-27 to date | about 0 (−0.01, +0.02) | treating them as unrelated was about right | mixed |

Two QBs on one team (a mid-game change) show −0.72 but have too few pairs to
check. The link is one number per kind of pair: a particular star duo may move
together more or less than teammates in general.

**Limits.** No play-by-play game simulation, no pace or injury inputs beyond
what the links already carry, and the check uses stand-in lines because past
lines are not stored. The joint chance is only as good as the chances typed in.

## Schema

`lib/sports/schema.mjs` (version 1) holds the sports, stats, statuses and
validators, and the stat catalog (see Stats). Every catalog stat can be shown
and picked; `statIds(sport, { modeledOnly: true })` gives the ones with a
model: NBA points and rebounds, NFL passing yards and receptions.
`marketSeriesKey` names one line series (operator, game, player, stat, period,
contract family); the threshold and side are left out so a line that moves
stays in the same series.

## MCP tools

The Mingstreet MCP (`/mcp`, docs/mcp.md) has six Owner-only Sports tools in
`lib/mcp/sports-tools.mjs`: `sports_list_games`, `sports_find_players`,
`sports_get_game`, `sports_get_player`, `sports_evaluate_entry` and
`sports_get_model_check`. They call the same functions as the pages
(`leagueView`, `evaluateEntry`, `journalView`, `modelSummary`), so the same
stored games, model and seed give the same answer. `SPORTS_ENABLED=0` hides
them. `sports_get_game` returns each player's averages as one map per
measure (`last5`, `last10`, `average`, `median`, `low`, `high`,
`stat_games`), each keyed by stat, for the league's main stats or the
`stats` named; `sports_evaluate_entry` returns each pick's history as
`hit_history`. Both shapes keep the numbers inside the MCP's size limit,
which shortens deep objects and drops keys named `history`.

The intended flow: send a slip screenshot to Claude or ChatGPT; it reads the
players, lines and payout, finds each player (`sports_find_players`), checks
the entry (`sports_evaluate_entry`, which can leave out `game_id` to use the
player's next stored game and says so) and gives back `pick_builder_link`. The
owner opens it, checks every pick and payout against the app, enters or copies
chances and saves. There is no save tool, the link never carries chances, a
chance is passed only when the owner gave one, and `use_model_chances` copies
the model's chance only when asked.

Their store handle reads only the Sports game, player, model, status and
journal records; captured lines and anything outside `_stonks/sports/v1/` are
refused, and every write throws (`sportsReadOnlyStore`).

## Kept apart from market research

Sports is not market evidence. The Owner Market Brief, Research Lab evidence
(`sourceCatalog` drops the `Sports` category) and the MCP feature list
(`list_features`) do not read it; Sports has its own MCP tools above. The
Update Checker lists the pages as on-demand.

## Data sources

| League | Source | Terms | Branch |
|---|---|---|---|
| NFL | [nflverse](https://github.com/nflverse/nflverse-data) releases, daily scheduled job | CC BY 4.0 (FTN charting is CC BY-SA and is not used) | `sports-nfl-data` |
| NBA | [hoopR](https://hoopr.sportsdataverse.org/) / ESPN box scores (sportsdataverse-data releases), daily scheduled job | Private research only | `sports-nba-data` |
| Lines | Typed in, or read from a screenshot by Claude/ChatGPT | — | `sports-pick-builder` |

NBA.com's terms bar gambling use. This section is private research for the
owners and places no bets.

## Cost

$0 added: no new Vercel function, no AI calls, no paid feeds. R2 storage and
GitHub Actions minutes stay inside their free tiers.

## Build plan

One branch and pull request each, from `main`:

1. `sports-shell`: pages, Owner gate, route, storage keys, schema
2. `sports-nfl-data`: nflverse job, the NFL games board, game players, player
   search and game logs
3. `sports-nba-data`: hoopR / ESPN job, the NBA board, players and game logs,
   one shared ingest for both leagues, packed row storage. An owner CSV import
   was planned here; hoopR covers the data, so it is left for later if a
   source goes missing.
4. `sports-pick-builder`: entered payouts, breakeven, the independence
   baseline with its range, same-game flags, the paper journal with
   settlement from final stats, and shared prefill links
5. `sports-models`: per-stat forecasts with a dated holdout check, on the
   player pages and Pick Builder picks
6. `sports-joint`: same-game chances from measured links (Gaussian copula,
   seeded simulation, held-out check per kind of pair)
7. `sports-mcp`: six read-only Owner MCP tools; evaluate returns a Pick
   Builder link to save from (no MCP save tool)
8. `sports-charts`: player charts (bars around the average, trend, hit rates,
   spread, vs minutes or volume, splits), Player stats and Team stats views,
   game-panel and Pick Builder mini charts
9. `sports-combos`: one stat catalog with every stored stat and the combos
   (PRA, P+R, P+A, R+A, B+S, fantasy, rush + receiving yards, pass + rush
   yards) on every page, chart and the Pick Builder

## Tests

```bash
npm run test:sports           # access, route, time zones, keys, schema, wiring, both adapters, ingest, views, payout math, the journal, the stat models, same-game chances, the MCP tools and the player / team stats
npm run test:sports-browser   # Owner / member / signed-out at 1440 and 390, boards, games, logs, forecasts, every chart, the stats views, the model check, the Pick Builder flow and a same-game estimate
node scripts/regen-sports.mjs # rebuild index.html / app.js / styles.css without data/
```
