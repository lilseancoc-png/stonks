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

## Older changelogs

- [2026-10](docs/changelog/2026-10.md)
- [2026-09](docs/changelog/2026-09.md)
- [2026-08](docs/changelog/2026-08.md)
- [2026-07](docs/changelog/2026-07.md)
- [2026-06](docs/changelog/2026-06.md) — 458 entries
