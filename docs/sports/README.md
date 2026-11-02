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
| NBA | `sports-nba` | Today's and tomorrow's games, player game logs, captured lines |
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
    enabled stats.
  - `board&sport=&tz=`: games starting today or tomorrow in that zone, plus
    the next game after the window.
  - `game&sport=&id=`: the players each team used in its last three games this
    season, with averages from games before this one.
  - `players&sport=&q=`: player search (accents and punctuation ignored).
  - `player&sport=&id=`: a player's latest 40 stored games, with last 5, last
    10, all stored, median, low and high for each stat.
  - `player` also returns `next_game`: the team's next stored game that has
    not started, which a new pick attaches to.
  - `journal`: every saved paper entry, newest first, settled from the
    stored finals, with the totals (`lib/sports/journal.mjs`).
- Pick Builder ops are `POST` with a JSON body and must come from the site
  itself (same-origin check). Bodies over 16 KB are refused.
  - `evaluate`: read-only. Checks the picks against stored games and
    players, adds each pick's history hit counts and prices the entry.
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
and the MCP key filter refuses it. Each read is capped at 24 MB.

| Kind | Key | Written by |
|---|---|---|
| `status` | `status/{sport}.json` | each league's data job (last run, seasons, counts) |
| `players` | `{sport}/players.json` | data jobs (players plus provider ids) |
| `games` | `{sport}/games/{season}.json` | data jobs |
| `player-games` | `{sport}/player-games/{season}.json` | data jobs (packed rows, below) |
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
- Picks from the same game are flagged and **not priced**: their results move
  together, so multiplying chances would be wrong. The page shows the
  breakeven only, until the joint engine (`sports-joint`) exists.

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
| NBA player did not play, or has no row | void |
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
`stat`, `side`, `threshold`. The MCP (`sports-mcp`) will hand these out after
Claude or ChatGPT reads a screenshot. The owner still checks and saves.

**Browser storage.** The unsaved draft lives in sessionStorage
(`stonks-sports-draft-v1`) and is gone when the tab closes. Saved entries are
only in R2.

## Schema

`lib/sports/schema.mjs` (version 1) holds the sports, stats, statuses and
validators. Enabled stats today: NBA points and rebounds; NFL passing yards and
receptions. Others are listed and switched off until their models exist.
`marketSeriesKey` names one line series (operator, game, player, stat, period,
contract family); the threshold and side are left out so a line that moves
stays in the same series.

## Kept apart from market research

Sports is not market evidence. The Owner Market Brief, Research Lab evidence
(`sourceCatalog` drops the `Sports` category) and the MCP feature list do not
read it. The Update Checker lists the pages as on-demand.

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
5. `sports-models`: per-stat probability models
6. `sports-joint`: the joint-probability engine for correlated picks
7. `sports-mcp`: read-only MCP tools; evaluate returns a Pick Builder link to
   save from (no MCP save tool)

## Tests

```bash
npm run test:sports           # access, route, time zones, keys, schema, wiring, both adapters, ingest, views, payout math and the journal
npm run test:sports-browser   # Owner / member / signed-out at 1440 and 390, boards, games, logs, and the Pick Builder flow
node scripts/regen-sports.mjs # rebuild index.html / app.js / styles.css without data/
```
