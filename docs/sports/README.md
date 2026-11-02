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
- There are no write ops yet; a same-origin check is in place for the later
  Pick Builder saves.

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
| `player-games` | `{sport}/player-games/{season}.json` | data jobs |
| `observations` | `markets/observations.json` | Pick Builder (captured lines, append-only) |
| `journal` | `journal/entries.json` | Pick Builder (paper entries, append-only revisions) |

JSON was chosen over a database for now: the data is small, written by one
scheduled job per league plus two owners, and R2 stays inside its free tier.

## NFL data job

`.github/workflows/sports-data.yml` runs once a day at 13:20 UTC (early
morning in the US, after nflverse's overnight update and after Sunday and
Monday night games) and on demand. It runs `npm run test:sports`, then
`node scripts/sports-ingest.mjs --sport=nfl` (`lib/sports/ingest-nfl.mjs`,
adapter `lib/sports/nflverse.mjs`):

- Downloads three nflverse release files: `schedules/games.csv`,
  `stats_player/stats_player_week_<season>.csv` and `players/players.csv`.
- Keeps the current and previous season (seasons are labeled by the year they
  start). The current season refreshes every run. A finished season is
  stored once with `complete: true` and is not downloaded again unless the
  adapter version changes.
- Keeps quarterbacks, running backs, receivers and tight ends. Kickoff times
  are converted from US Eastern to UTC.
- Drops the sportsbook spreads, totals and moneylines that the schedule file
  carries.
- Writes data first and the status record last. If a refreshed season would
  lose more than 20% of its stored rows, or a download fails, nothing is
  replaced: the status record shows the failure and keeps the last good time.
- Logs counts only, because workflow logs are public.

nflverse lists a player only for games where he recorded a stat, so a missed
game is absent from the log rather than a zero. The page says so under every
game log.

Local checks without credentials:

```bash
node scripts/sports-ingest.mjs --sport=nfl --dry-run                  # network, writes nothing
node scripts/sports-ingest.mjs --sport=nfl --dry-run --source-dir=DIR # local CSV copies
```

A full dry run on 2026-11-02 read 557 games, 9,111 player games and 748
players (about 4 MB of JSON across five records).

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
| NBA | [hoopR](https://hoopr.sportsdataverse.org/) / ESPN box scores, plus an owner CSV import | Private research only | `sports-nba-data` |
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
3. `sports-nba-data`: hoopR / ESPN job, CSV import and the NBA games board
4. `sports-pick-builder`: entered payouts, EV and the paper journal
5. `sports-models`: per-stat probability models
6. `sports-joint`: the joint-probability engine for correlated picks
7. `sports-mcp`: read-only MCP tools; evaluate returns a Pick Builder link to
   save from (no MCP save tool)

## Tests

```bash
npm run test:sports           # access, route, time zones, keys, schema, wiring, NFL adapter, ingest and views
npm run test:sports-browser   # Owner / member / signed-out at 1440 and 390, NFL board, game and log
node scripts/regen-sports.mjs # rebuild index.html / app.js / styles.css without data/
```
