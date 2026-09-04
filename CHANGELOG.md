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

## 2026-09-04

### Added

- **Pinned workspaces and direct retries.** Save up to eight accessible workspaces in this browser; retry failed Volume, Gamma Exposure, and Sector Rotation requests directly without resetting filters.

### Changed

- **Mobile research is easier to reach.** Display and account controls move into a compact settings menu; Calendar puts month navigation before the selected day's events and keeps the full risk overview expandable. Navigation adds a skip link, drawer focus containment, and focus restoration.

- **The research workspace is easier to scan.** Home uses compact cards, clearer index metrics, readable shortcuts, and restrained header actions; shared card headings, secondary text, and focus states work across light and dark themes. The sidebar adds topic filtering with keyboard selection, empty-result guidance, and a mobile close control while preserving Owner access restrictions and disclosure choices.

### Fixed

- **Close-bake recovery verifies publication (#638).** A successful router-only run no longer suppresses the watchdog; recovery stops only after the latest build attempt completes and publishes private-store or legacy data.
- **Grade resumes live pricing across market sessions (#638).** Paused polling rechecks the session, retries quote failures, and refreshes expired session state when returning to Grade or the browser.
- **Heatmap failures restore baked values (#638).** A failed live poll clears the old overlay and repaints returns and breadth before labeling the display as the baked close.

## 2026-09-02

### Fixed

- **Delayed Friday jobs no longer silently skip the weekly Alt Data refresh.** The DST-safe route now chooses the valid 11:30 ET cron expression from New York's UTC offset instead of combining the scheduled hour with the runner's eventual execution date, so a GitHub delay past midnight UTC cannot turn both Search Interest / RAM / GPU-price jobs into green no-ops. A workflow-schedule smoke guard covers the weekly route, Daily dispatch-time routing, and close-bake watchdog; the Overnight regression smoke test also accepts both LF and CRLF renderer sources, restoring reliable Windows verification without changing shipped UI behavior. `.github/workflows/{search-interest,daily}.yml`, `scripts/{workflow-schedule,overnight}-smoke.mjs`, `package.json`.

- **Transient Yahoo chart errors no longer discard an otherwise complete build without retrying.** Required daily history and optional intraday chart requests now retry transport-shaped failures three times with bounded backoff, recognize Yahoo's legacy HTML `HTTP 400` response as transient, and keep failure logs concise; deterministic schema errors still fail immediately and the pre-AI freshness gate remains fail-closed after retries are exhausted. The close-bake watchdog now distinguishes successful, active, and failed Daily runs, dispatches one recovery bake after a failed close attempt, adds a later cross-DST verification slot, and tolerates GitHub cron delays through 20:30 ET. `lib/yahoo-retry.mjs`, `scripts/{build,yahoo-retry-smoke}.mjs`, `.github/workflows/{daily,close-bake-fallback}.yml`, `package.json`.

## Older changelogs

- [2026-08](docs/changelog/2026-08.md)
- [2026-07](docs/changelog/2026-07.md)
- [2026-06](docs/changelog/2026-06.md) — 458 entries
