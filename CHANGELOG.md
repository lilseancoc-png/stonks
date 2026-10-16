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

## 2026-10-15

### Added

- **LEAPS is an Owner desk under Top Picks.** It rescores the pillars Top Picks already computed and shows that score for a one- to two-year hold. A call buy needs 8 and a put buy needs 9. The desk does not name a strike, call Gemini, or fetch a far-dated chain. It runs on the 11:00 and 15:30 ET Top Picks builds; other bakes keep the prior list. `LEAPS_SCORE=0` turns the new score off. `lib/leaps-score.mjs`, `scripts/build.mjs`.
- **Additional views sit under the desks that already own each number.** Heatmap gains the stored closing-breadth log and a grade-total versus return plot. Calendar counts stored events by day. Narratives group stories by the stored lifecycle stage. Trending IV adds a percentile histogram and a 5-session IV change versus 1-week price plot, with both windows labeled. Gamma exposure draws stored spot and walls. Streaks plots length against cumulative move. Spillover bars the sector model, pair model, and priced move as separate series. The MA tracker histograms distance to the stored averages against the existing ±5% band. Earnings plots surprise against the report-day move using the existing ±1% in-line band. Owner Lab adds a link-map lookup, the stored evidence record, and the stored grader log. No score, tier, or model call changes. `js/book-views.js`, `scripts/render/html.mjs`, `scripts/render/styles-css.mjs`.
- **Additional views can be collapsed, searched, and read on hover.** Each added panel is a disclosure under its existing desk. Scatter plots dim every name except a ticker search and list that name’s stored figures. Wall ranges can be sorted by gamma score, nearest wall, or symbol. Breadth cells, calendar days, and histogram columns show the stored count on hover. `js/book-views.js`, `scripts/render/styles-css.mjs`.

### Changed

- **A longer return window plots the average daily grade for that same window.** The one-day view stays on today's grade. Week, month, quarter, year-to-date, and one-year views average the once-a-day total saved after that return's start. The table keeps today's grade, the current call or put, how many saved days cleared the bar, and a sparkline of the path. Clicking a dot selects that name. `grades-daily.json` is public, the same number already published in `grades.json`, and keeps 280 sessions. `js/book-views.js`, `lib/premium-keys.mjs`, `scripts/build.mjs`.
- **The grade-versus-return plot can be filtered and read as a table.** Recommendation, sector, and score narrow the dots. Sort runs by return, grade, ticker, sector, or recommendation, from the menu or the column headers. Circles are calls, squares are puts, and diamonds have no recommendation. Spread scale keeps a very large return visible without packing the rest of the book into one blob. The caption now says the grade total is the four pillars, IV cost, and the regime overlay, and that entry timing is not in that total. `js/book-views.js`, `scripts/render/styles-css.mjs`.

### Fixed

- **The grade chart says what its average, call days, and sample dates are.** A longer window still averages the saved daily grades. The latest bake replaces that day's saved grade so Today and the end of the average match. The labels name the date span actually used, and they say when that span starts after the return. Call days are +4 or higher and put days are -4 or lower. `js/book-views.js`.

## 2026-10-14

### Changed

- **LEAPS ideas start at 5, call buys at 8, and put buys at 9.** The longer hold needs a higher bar than a short-term trade, and a put needs a stronger score than a call. `lib/leaps-score.mjs`.
- **LEAPS fundamentals count fully, and the score leans toward calls.** Fundamentals is weighted 1.0. Every name starts one point higher because a stock is more likely to be up than down over one to two years. The forward path adds up to two more points: a call buy is held back when fundamentals are declining, and a put buy requires that decline. `lib/leaps-score.mjs`.
- **LEAPS recommendations follow the Top Picks decision, with the LEAPS pillar weights.** A buy needs a weighted score of at least 7 on the same scale as Top Picks, at least two pillars on that side, and a confirmed go entry. An avoid is dropped. A score of at least 4 that is still waiting, single-pillar, or missing a listed contract stays a watch. The contract is a long call or long put, 9–24 months out, with delta 0.20–0.40 or 20–50% out of the money. When `LEAPS_SCORE=1`, the bake fetches those far expirations for the decision names. The old “a 35% move doubles the premium” check is not used to choose the contract. `lib/leaps-score.mjs`, `scripts/build.mjs`.

### Fixed

- **Buyer's manual and Chart patterns: the scope line wraps on a phone.** The gold scope strip was a flex row, so "long calls & puts only" sat in its own column beside the rest of the sentence. It is now one wrapping line. `scripts/render/docs.mjs`.

## 2026-10-13

### Added

- **Link map: a private, Owner-only map of how names, themes and inputs connect.** The build writes `link-map.json` from the existing sector, industry and spillover groups, overnight peers, commodities, AI capex, RAM, GPU rent and narrative longs/shorts (365 nodes and 777 edges on Oct 13 data). Every edge carries its source and an `asOf` date. It makes no AI calls. Search-interest themes (no ticker lists yet) and central-bank gold (tracks countries, not tickers) are skipped. Requests without an Owner session get a 401 (`LINK_MAP_OWNER_ONLY`). `lib/link-map.mjs`, `scripts/build.mjs`, `lib/data-ownership.mjs`, `lib/premium-keys.mjs`.

### Fixed

- **Branch review repair:** The link-map privacy toggle check resolves shared policy imports from a temporary file module, so it works alongside the evidence and rejection branches.
### Fixed

- **Narratives: story extraction no longer collapses onto the single name in the latest history snapshot.** Previous names now come from the real stories in the last five snapshots, and the prompt reuses a name only when today's evidence still supports it. When a fresh read finds fewer than four real stories from 30 or more headlines, it retries once (a single attempt). The retry runs only if the daily AI reserve still covers the Brief's worst case in both calls and tokens, counting input tokens (the first read's recorded input plus 10%, or characters divided by 3 when none was recorded). It is also capped at 2 retries per UTC day (`COLLAPSED_STORY_RETRY_DAILY_CAP`, counted in the AI ledger when a retry starts, so failed retries count too). The post-close carry (`REFRESH_NARRATIVES=false`) extracts fresh instead of reusing a stale read or one with fewer than four real stories. AI caps are unchanged. `lib/story-detection.mjs`, `scripts/build.mjs`, `scripts/story-detection-smoke.mjs`.
- **AI rejection log and scoring: every name the final grader rejects or tells to wait is recorded and later scored.** The bake writes one record per name, side and day (first time seen, spot price, grade, entry reason, total and market regime) to `ai-rejections/YYYY-MM-DD.json` plus `ai-rejections-latest.json`, tagging waits that overrode a ready price read separately; names the grader passed are kept as the comparison baseline. Tactical names and builds without a grader are skipped, logging never fails the bake, and nothing is added to `picks.json`. `backtest-picks.mjs` scores rejects on the move in the pick's direction at 5, 10 and 21 trading days against that day's passed names, and waits on whether a better entry came within 5 days. All files are Owner-only and private; the scorecard stays on the backtest runner and is excluded from the bake push. No AI calls. `lib/ai-rejections.mjs`, `scripts/build.mjs`, `scripts/backtest-picks.mjs`, `lib/data-ownership.mjs`, `lib/premium-keys.mjs`.
### Fixed

- **Branch review repair:** Wait promotions count only within the five trading-session score window. The scorecard stays local, and normal runs download only the required record history.
- **Data sync: `sync-data seed` now skips the same keys `push` excludes.** Seed (the one-time full upload of local `data/` into the private store) skips request-time keys and the shared `LOCAL_ONLY_KEYS` list, including the backtest-only AI rejection scorecard via `isSeedableKey`, and still uploads Owner-only keys so a re-seed keeps the private history. `lib/data-ownership.mjs`, `scripts/sync-data.mjs`, plus a smoke test.
- **Branch review repair:** Bake, seed, and hydration exclude the local AI rejection scorecard. Normal pulls bound dated record downloads; historical backtests explicitly request full archives.
- **Data sync: `sync-data seed` now skips the same keys `push` excludes.** Seed (the one-time full upload of local `data/` into the private store) skips request-time keys and the shared `LOCAL_ONLY_KEYS` list, including the local AI rejection scorecard via `isSeedableKey`, and still uploads Owner-only keys so a re-seed keeps the private history. `lib/data-ownership.mjs`, `scripts/sync-data.mjs`, plus a smoke test.
- **Evidence record: a private, Owner-only daily record of the evidence behind each name.** The bake writes `evidence/YYYY-MM-DD.json` plus a small `evidence-latest.json` pointer, covering 17 evidence pieces per name (Trends, RAM, GPU rent and capex are skipped because they have no per-name daily data). Every piece carries `asOf` (when the source data was known) and `firstSeen`, neither later than the bake date, so later tests can't use future information. `firstSeen` carries over across gaps of up to 5 trading days when the direction is unchanged and resets otherwise (holidays count as missing days). Each bake loads the last 60 days for the compare-to-its-own-normal rule, using the store access the daily pull already has. No AI calls. `lib/evidence-record.mjs`, `scripts/build.mjs`, `lib/data-ownership.mjs`, `lib/premium-keys.mjs`.
### Fixed

- **Evidence records preserve missing readings and closing-volume direction, and publish only through the verified sync step.** Normal runs download only the history window the producers need; backtests retain access to full remote archives.
- **LEAPS expirations, private and off by default.** For up to 5 LEAPS shortlist names, the bake can fetch up to 4 extra expirations 9 to 24 months out, in parallel, using the existing Yahoo timeout. If a fetch fails, the bake carries on without it. The extra expirations stay in a private `_leapsChains` field that's removed before files are written, so the public per-ticker files never show the LEAPS shortlist. A name makes the shortlist when it's above its 200-day average, has an RSI between 20 and 80, and its IV is cheap: under the 60th percentile, with an IV z-score under `LEAPS_IV_Z_MAX = 1.5` when there's enough IV history to compute one. The fetch stays switched off until LEAPS scoring lands. Other names still keep 14 expirations, and short-term picks are unchanged. It makes no AI calls.

### Fixed

- **Branch review repair:** The LEAPS shortlist rejects missing trend and IV readings instead of treating them as zero.
- **LEAPS contract pricer (`lib/leaps-pricer.mjs`).** This is a pure function with no file or network access. For each expiration 9 to 24 months out, it finds the strike with a delta between 0.20 and 0.30, using a bounded 64-step bisection and a named 4% rate. It then prices the option 6 months out if the stock is flat, up 20%, up 35% or up 50%. A contract passes only if the target move at least doubles the premium. An optional `catalystDate` drops expirations that end less than 3 months after the catalyst. Expirations that are short, unreadable or fail to solve are skipped one at a time. The function returns null only for bad top-level inputs. It makes no AI calls.
### Fixed

- **Branch review repair:** All earlier bulk AI passes preserve 40 attempts for final Top Picks research and grading. The narrative reserve and daily ceilings remain in force.
### Fixed

- **Branch review repair:** LEAPS paper rolls reject an occupied underlying before closing the original position; marks and mandatory exits continue.
### Fixed


## 2026-10-10

### Changed

- **Grade formula: several signals are re-weighted so the grade leans bullish on purpose, since a bearish call should need more evidence.** All changes are deterministic and cost no AI.
  - Fundamentals:
    - EPS growth earns +2 at 30% or more, and revenue growth earns +2 at 20% or more.
    - The analyst price target needs 20% upside to earn +1 (it was 10%).
    - In-line guidance earns +1 (it was +2). With no guidance read, the full-year estimate earns +1 only at 10% growth or more (it was +2 at 10% and +1 at any growth).
    - An earnings surprise is not scored when the EPS estimate is under $0.10.
    - Net margin trend and the forward trajectory no longer add points. The trajectory is still computed and shown, and Stock Picks, Sector Rotation and the Top Picks prompt still read it.
  - Technicals:
    - A reversal-confirmed RSI extreme scores +2 when oversold and −1 when overbought (it was ±3).
    - A falling wedge reads +1 and a rising wedge −1.
  - Mechanicals:
    - Unusual flow and the open-interest call/put ratio need a ratio of 0.5 or less to read bearish (it was 0.67).
    - Short interest earns +1 only when at least 15% of the float is short, shorts are covering, and the 5-session return is positive. Rising short interest still scores −1.
  - Files: `scripts/build.mjs`, `scripts/render/app-js.mjs`, `scripts/render/html.mjs`. (#650)
- **A won or lost major contract now expires after 30 days.** It only scores while a contract or deal headline from the last 30 days is still in the name's news (`freshMajorContractStatus`). Before, the undated AI flag could be reused and keep scoring for months. Stock Picks and Sector Rotation use the same check. (#650)
- **Narratives: the autogenerated "Watchlist" filler names are left out of the AI prompt's "previous narratives" list.** Feeding about 37 filler names back as "reuse verbatim" had collapsed extraction to one real story since late September. Filler cards are now labeled neutral instead of bullish, so they no longer appear as 13F "most bought" themes or as "LONG · Bullish" chips on the Grade tab. (#650)
- **AI budget: the daily caps hold back headroom (300k tokens, 30 calls) for the market-narrative and Brief calls.** Bulk per-ticker calls stop at the cap minus the reserve, so the afternoon narrative read and the Brief still run on heavy days. The overall ceilings are unchanged. The reserve is set by `AI_RESERVED_TOKENS` / `AI_RESERVED_CALLS`, and 0 disables it. (#650)

- **Top Picks: a non-destructive grade-model version (`GRADE_MODEL_VERSION = "2026-10-pillar-review"`) is stamped on `picks.json` `rosterMeta`, `grades.json`, and each new track-record enrollment.** The scorecard can now split results before and after the grade change without wiping the record. `PICKS_ACCURACY_RESET_EPOCH` is unchanged. Split point: trades enrolled from the first Top Picks run (11:00 or 15:30 ET) after this PR deploys carry the new version, and older trades have none. (#650)

- **Track Record: a dated bar now separates trades picked by the updated grade formula from earlier trades** in both the Open and Resolved lists ("Updated grade formula from YYYY-MM-DD"; newer trades above, older below). It uses the `gradeModelVersion` stamp, so the record is kept rather than reset, and any future formula change adds its own bar. `scripts/render/app-js.mjs`, `scripts/render/styles-css.mjs`. (#650)

### Perf

- **The post-close 16:10 ET bake carries the 15:30 narrative read forward instead of making a new AI call** (`REFRESH_NARRATIVES=false`, set by `daily.yml`). Nothing trades on that build. (#650)

## 2026-10-08

### Perf

- **Gemini cost: fetched article bodies sent to the per-ticker news/fundamentals read are now capped at 1,500 characters (was 3,000).** This matches the existing 1,500-character cap on RSS descriptions, so every article excerpt the model sees is the same length. The lead paragraphs carry most of the substance, and all headlines are still sent. `AI_ARTICLE_BODY_CHARS` is now wired into `daily.yml` as an Actions variable, so the cap can be raised again (e.g. back to 3000) without a code change. `scripts/build.mjs`, `.github/workflows/daily.yml`.

## Older changelogs

- [2026-09](docs/changelog/2026-09.md)
- [2026-08](docs/changelog/2026-08.md)
- [2026-07](docs/changelog/2026-07.md)
- [2026-06](docs/changelog/2026-06.md) — 458 entries
