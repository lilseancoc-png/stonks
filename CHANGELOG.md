# Changelog

All notable changes to **stonks** are recorded here, grouped under the date the
change landed (newest first). This root file carries only the **current month**;
each completed month is archived under [`docs/changelog/`](docs/changelog/) and
linked from the index below, so this file stays small.

Categories: **Added** (new features), **Changed** (changes to existing behavior),
**Fixed** (bug fixes), **Removed** (dropped features), **Perf** (performance),
**Docs** (documentation/CLAUDE.md).

<!-- CONVENTION (also in CLAUDE.md):
     - Add each new entry under a "## YYYY-MM-DD" heading for the day the change
       lands (create the heading + "### Category" subhead if missing — newest
       date first, categories in the order Added / Changed / Fixed / Removed /
       Perf / Docs). One bullet per change, present tense, plain language,
     reference the PR (#NNN) when there is one.
     - MONTHLY ROLLOVER: on the first entry of a new month, move ALL of the
     previous month's "## YYYY-MM-DD" sections into docs/changelog/YYYY-MM.md
     (same format, plus the archive preamble) and add that month to the
     "Older changelogs" index below. -->

## [Unreleased]

### Added

- Add a Mingstreet MCP server at `/mcp` so ChatGPT, Claude and other AI apps can read site research: every page and the extra files behind it (histories, logs, earnings-call transcripts), stock research, price history, grades, live quotes, Top Picks and the track record. It is read-only by construction (tools only get a store that can read, and the Top Picks market check runs as an unsaved preview) with no AI calls, signs in through the Discord owner role (OAuth with PKCE, consent page, role re-checked on every token refresh) and uses no extra Vercel function. Webull, fills and secrets are never exposed. See `docs/mcp.md` (#732).

### Changed

- Market briefs include public streak reversals and moving averages, Pattern lab outcomes with sample limits, saved overnight calls, insider purchases, financing and buybacks, CapEx guidance changes, wholesale memory prices and Rich option premium. Owner research stays excluded; source freshness and public page links have regression checks.

### Fixed

- Stage only the eight required browser assets in Vercel's public output directory and exclude build/scanner sources, documentation, and repository metadata from deployment uploads. (#707)
- Request an uncompressed R2 lock with a strong ETag so a released Webull paper lock can be acquired conditionally; fail closed on malformed locks or repeated conflicts, expose Owner-only diagnostics, and report mirror failures in a separate workflow health job.
- Reconcile Webull grouped option positions using confirmed broker order legs and stable position identities; prepare manual spread adoption without replaying its entry, retain separate overlapping manual holdings, and exclude manual entries from automatic fill timing and slippage.

## 2026-11-02

### Added

- Add an Owner-only **Sports** section with NBA, NFL and Pick Builder pages in its own sidebar group. This first step is the frame: Today and Tomorrow in Pacific time (with a time-zone picker), each league’s data status, and the Pick Builder steps to come. It reads private JSON under `_stonks/sports/v1/` through the existing Owner session (`/api/auth/me?sports=status`), adds no Vercel function, makes no AI or sportsbook calls, and stays out of the Owner Market Brief, Research Lab evidence and the MCP feature list. `SPORTS_ENABLED=0` turns it off. See `docs/sports/README.md`.
- Connect NFL data to the Owner Sports section. A daily job (`sports-data.yml`) reads free nflverse game and player files for the current and previous season into private storage, without the sportsbook lines the schedule file carries. The NFL page shows today's and tomorrow's games, each team's recent players, player search and game logs with recent averages. A finished season is downloaded once; a bad download never replaces stored data. No AI or sportsbook calls.
- Connect NBA data to the Owner Sports section from hoopR's free ESPN box scores (current and previous season), as a second job in the daily Sports data run. The NBA page shows today's and tomorrow's games, each team's recent players (with anyone who sat out last game flagged), player search and game logs with minutes and the reason for missed games. Both leagues now share one ingest, and stored game logs are packed (a full NBA season shrinks from 16 MB to 4 MB).
- Build the Owner Pick Builder: add 1 to 6 picks from a player on the NBA or NFL page or from its own search, type the payout your app shows (power or flex) and your own chance for each pick, and see the breakeven, the chance all hit if the picks are independent (with the range under any link between them), and the expected profit. Picks from the same game are flagged and not priced. Save it as a paper pick before the games; the journal grades it from the final stats, asks for the app's payout after a push or a player who sat out, and totals paper profit next to what was expected at save. Each pick's history hit rate is shown, and can be copied only from 5 or more games. A shared link can fill in an entry for the owner to check and save. No AI, sportsbook or new Vercel function.
- Add stat forecasts to the Owner Sports section for NBA points and rebounds and NFL passing yards and receptions. Each forecast is expected minutes, pass attempts or targets × the player's rate × the opponent × home or away, with a spread fitted on past misses, so a typed line gets its exact over, under and push chances, an 80% range and what happens if the minutes or targets run 10% lower or higher. The daily data job refits it and checks it on later games it never saw against two simple baselines; a stat is marked as passing only with 300+ checked games, a better score than both and chances off by 3 points or less (on real seasons NBA points and rebounds and NFL receptions pass; passing yards just misses). Player pages show the next game's forecast, Pick Builder picks show the model's chance with a button to use it, saved picks keep it, and the journal compares model and used chances with what happened. NFL keeps three older finished seasons for the model only. No AI calls or new Vercel function.
- Price same-game picks in the Owner Sports Pick Builder. The daily model run measures how picks from one game moved together in past games (the same player's two stats, teammates, opponents) and checks each link on later games against treating the picks as unrelated. Same-game entries now get a chance of all hitting, exact-k chances for flex, a range from how sure each link is, the unrelated number for comparison and the expected value, all from the chances entered and a seeded simulation. On real seasons one NBA player's points and rebounds (+0.28) and an NFL quarterback's passing yards with a teammate's catches (+0.24) pass the check. A pair with no measured link still gets no combined number. No AI calls or new Vercel function.
- Add charts and stats views to the Owner Sports pages. A player's panel now has six charts for any stored stat over the last 5, 10 or 20 games, the season or every stored game: bars around the average (green above, red below, or against a typed line), a trend with a five-game average, hit rates at a ladder of lines, the spread of results, the stat against minutes or volume, and splits by home or away, role, rest, opponent and season, with a facts strip under each. New Player stats and Team stats views sort and chart every player's averages (season, last 10 or last 5; by team, position and games played) and each team's record, scoring and what it allows overall and to each position. The game panel shows each player's last ten games as small bars for any stat, and each Pick Builder pick shows its last ten games against its line. Box scores only; no AI calls or new Vercel function.
- Add six Owner-only Sports tools to the Mingstreet MCP: list today's and tomorrow's games, find players, read a game or a player's log and forecast, check a pick'em entry, and read the model check with the paper journal's totals. A screenshot read by Claude or ChatGPT can now become a checked entry: the evaluate tool gives the same answer as the Pick Builder and returns a link that fills the entry on the site, where the owner saves it. Nothing is saved from the MCP, the link never carries chances, and the tools can read only Sports records. `SPORTS_ENABLED=0` hides them.

## Older changelogs

- [2026-10](docs/changelog/2026-10.md)
- [2026-09](docs/changelog/2026-09.md)
- [2026-08](docs/changelog/2026-08.md)
- [2026-07](docs/changelog/2026-07.md)
- [2026-06](docs/changelog/2026-06.md) — 458 entries
