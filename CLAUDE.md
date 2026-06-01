# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`stonks` is a single-page **Option Contract Rater**. It is a static site (HTML + CSS + IIFE JS) served from the repo root, with a handful of Vercel serverless functions in `api/` for things the browser cannot do itself (live Yahoo quotes/chains, the live Fed Funds rate; plus a now-**dormant** Supabase-backed portfolio stack — AI portfolio review + positions — that was unwired from the site in #269 but kept in the tree). There is **no bundler** and **no framework** — `index.html`, `app.js`, `styles.css`, and `data/*.json` are committed to the repo and shipped as-is.

Three GitHub Actions workflows (`daily.yml`, `unusual-flow.yml`, `oi-tracker.yml`) re-generate those committed artifacts on a schedule by invoking Node scripts; the resulting commit to `main` is what triggers a Vercel deploy.

## Commands

```bash
# Full rebuild — hits Yahoo for chains + history, optionally calls Gemini, and
# rewrites index.html, app.js, styles.css, and every data/*.json. Requires
# Node >=20. GEMINI_API_KEY is optional (AI narratives + news takes are
# skipped without it). This is the same command the daily-build workflow runs.
node scripts/build.mjs
# or: npm run build

# Regenerate ONLY index.html / app.js / styles.css from existing data/*.json
# (no Yahoo, no Gemini). Use this when you only touched the render layer
# in scripts/render/ (or one of the shared helpers they import from build.mjs).
# Also seeds data/heatmap.json from per-ticker JSON IF (and only if) that file
# is missing; an existing hourly-refreshed heatmap.json is left untouched.
node scripts/regen-static.mjs

# Regenerate ONLY data/calendar.json (macro releases, FOMC, FedWatch, earnings
# AM/PM sessions) without redoing the per-ticker chain fetches. Also rewrites
# data/fedwatch-history.json (the day's FedWatch snapshots + lastKnownFedRate).
node scripts/regen-calendar.mjs

# Hourly unusual-options-flow scan. Writes data/unusual.json (today's flagged
# contracts), data/unusual-history.json (rolling hourly snapshots),
# data/unusual-log.json (7-day flag log), plus the intraday volume + S/R-break
# pass (data/volume-flags.json, data/volume-history.json) and AI flow takes
# (data/flow-explanations.json). Run via the unusual-flow workflow.
node scripts/scan-unusual.mjs

# Hourly heatmap refresh — one batched Yahoo quote call rewrites the live `ch`/`sp`
# fields in data/heatmap.json (sector/industry/name come from the nightly bake;
# market-cap is refreshed hourly from the live quote when present). Intra-session
# runs add no AI cost (pure Yahoo). After the 16:00 ET close the run also makes
# ONE Gemini call (AI_EOD_MODEL, default gemini-2.5-flash-lite) to write the
# per-sector EOD recap (the `eodSummary` block) into heatmap.json, recorded
# against the shared data/ai-usage.json budget; generated at most once per ET
# day and carried forward by later runs. Skipped without GEMINI_API_KEY.
# Runs as a second step inside the unusual-flow workflow.
node scripts/refresh-heatmap.mjs

# Twice-daily near-term open-interest tracker (pre-market + EOD). Snapshots the
# front two expirations per ticker — top-OI strikes, call/put walls, ΔOI vs the
# prior trading day, gamma-squeeze score. Writes data/oi-tracker.json (current
# snapshot) + data/oi-history.json (rolling). Run via the oi-tracker workflow.
node scripts/scan-oi.mjs

# Regenerate ONLY data/picks.json (+ data/picks-accuracy.json + data/grades.json
# + data/grades-history.json, the grade-change log) from existing per-ticker
# data/*.json + streaks/trends/unusual. Use when only the picks/grading algorithm
# changed — no Yahoo, no Gemini. (Unlike the bake, regen-picks doesn't wipe data/,
# so it reads the live accumulating files directly.)
node scripts/regen-picks.mjs

# One-shot maintenance: backfill the `autoPick` field (the best call + best put the
# Top Picks engine would select for each name, scored with the exact same
# pickContractForPick the picks pipeline uses) into every committed data/<SYM>.json
# WITHOUT a network build. Powers the Grade tab's "★ Top-Picks grade" banner. The
# full build writes this in writeChainFiles(); this reproduces it offline because
# regen-static.mjs never touches data/.
node scripts/backfill-autopick.mjs

# Local serving
python3 -m http.server 8000   # static only — /api/* endpoints will 404
npx vercel dev                # full stack including api/quote, api/chain, etc.
```

There is **no test suite, no linter, and no type checker** wired into `package.json`. The only npm script is `build`. Verify changes by re-running the relevant generator and diffing the committed artifacts, or by loading the page locally.

### Required / optional environment variables

| Var | Used by | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `scripts/build.mjs`, `scripts/scan-unusual.mjs`, `scripts/refresh-heatmap.mjs`, `api/portfolio-review.js` | Narratives, per-ticker AI news takes, unusual-flow explanations, the post-close EOD heatmap recap, portfolio review (dormant). Without it the build skips AI steps and degrades gracefully. |
| `AI_MODEL`, `NARRATIVES_MODEL`, `AI_FLOW_MODEL`, `AI_EOD_MODEL`, … | build / scan / refresh scripts | Override the default model per call site. The default is **not** a single "Gemini" model — it's a mix: `AI_MODEL` (and narratives) default to the Gemma model `gemma-4-26b-a4b-it`, most per-ticker call sites to `gemini-2.5-flash-lite`, `api/portfolio-review.js` to `gemini-2.5-flash`. There are ~14 such overrides (`AI_NEWS_MODEL`, `AI_TICKER_MODEL`, `AI_CHART_MODEL`, `AI_EXIT_MODEL`, `AI_SIGNALS_MODEL`, `PORTFOLIO_REVIEW_MODEL`, `AI_RPM`, …) — `grep process.env.AI_` in `scripts/` for the full set. |
| `OPENFIGI_API_KEY` | `scripts/build.mjs` | Optional. Authenticates the CUSIP→ticker OpenFIGI lookups in the 13F pipeline; an authenticated key lifts the 25 req/min unauth cap (`OPENFIGI_MAX_BATCHES_UNAUTH` bounds the no-key path). Set in `daily.yml`. |
| `OI_SCAN_LIMIT` | `scripts/scan-oi.mjs` | Optional. Caps the OI scan to the first N tickers for local/CI smoke tests. Unset in production. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `api/config.js`, `js/auth.js` | Browser auth client for the **dormant** portfolio stack (see below — the Portfolio tab was removed from the site in #269). Anon key is safe to ship — RLS gates access. |
| `SUPABASE_SERVICE_ROLE_KEY` | `api/portfolio-review.js`, `api/close-position.js`, `api/delete-trade.js` | Server-side JWT verification (+ the snapshot write) for the **dormant** portfolio endpoints. Never sent to the browser. |
| `FRED_API_KEY` | `scripts/build.mjs` (`fetchFredSeries`) | Optional. When set, FRED fetches go through `api.stlouisfed.org` (the official JSON API, not Cloudflare-fronted) as the primary path, with the public CSV endpoint as fallback. Without it the build degrades gracefully — but the GH Actions runner IPs intermittently get every CSV attempt blocked for minutes, blanking the macro calendar + Fed Funds rate + FedWatch. Free key at <https://fred.stlouisfed.org/docs/api/api_key.html>. |
| `SEC_USER_AGENT` | `scripts/build.mjs` (`fetchRevenueSegments`, 13F pipeline) | Optional. Overrides the default User-Agent sent to SEC EDGAR (`data.sec.gov`). Revenue segment breakdowns (product + geographic) are fetched from SEC XBRL filings — no API key needed. Powers the donut charts in the Grade tab's fundamentals section. Without SEC access the segment charts are hidden — the rest of fundamentals still works. |

> Note: `FMP_API_KEY` is wired into `daily.yml` but read nowhere in `scripts/`/`api/` — dead config. Don't rely on it.

## High-level architecture

### Two halves: bake-time vs. request-time

The site is built around a strict split:

1. **Bake time** (`scripts/build.mjs`, run by `.github/workflows/daily.yml` ~3×/day): fetches every curated ticker's option chain + ~1yr of daily bars from Yahoo, computes technicals (RSI/MACD/SMA/S&R/IV regime), asks Gemini for per-ticker news takes and the global narratives view, then writes every artifact the page needs into the repo:
   - `index.html` — page shell with a `~30 KB` `window.STONKS_MANIFEST` JSON blob inlined (ticker list, sectors, narratives, sector overviews, spots, unusual flow snapshot, build timestamp).
   - `app.js` — generated single IIFE that runs the Tickers / Narratives / Calendar / Grade / etc. tabs. **Never edit `app.js` directly.** Its source is the template string returned by `renderAppJs()` in [`scripts/render/app-js.mjs`](scripts/render/app-js.mjs). Same applies to `styles.css` ([`scripts/render/styles-css.mjs`](scripts/render/styles-css.mjs)) and the page shell in [`scripts/render/html.mjs`](scripts/render/html.mjs).
   - `data/<SYMBOL>.json` — per-ticker option chain + technicals + AI news take. Loaded lazily by the browser when a ticker is picked.
   - `data/{calendar,picks,picks-accuracy,grades,grades-history,trends,trends-history,streaks,13f,ai-usage}.json`, the macro/rate series (`macro,macro-history,rfr-history,fedwatch-history,iv-history/*`), and the bake-written `heatmap.json` + CNN Fear & Greed (`fear-greed,fear-greed-history`) — every other tab's data. (`grades.json` is the all-tickers 4-pillar grade index — every tracked symbol's score/conviction/pillars, not just the actionable top picks — powering the Top Picks tab's "grade any ticker" search. `grades-history.json` is the whole-universe grade-change log; like `picks-accuracy.json` it accumulates across builds, so `main()` pre-reads it BEFORE `writeChainFiles` wipes `data/` — same trap.)
   - `data/heatmap.json` carries one extra AI-written block: after 16:00 ET, `refresh-heatmap.mjs` writes an `eodSummary` (headline + per-sector EOD recap from one `AI_EOD_MODEL` call) into it, generated at most once per ET trading day and carried forward by later hourly runs until the ET date rolls.
   - `data/{unusual,unusual-history,unusual-log,volume-flags,volume-history,flow-explanations,oi-tracker,oi-history}.json` — **scanner-owned**, written by the intraday `scan-unusual.mjs` / `scan-oi.mjs`, NOT regenerated by the bake. The bake *preserves* them across its `data/` wipe (it reads each in so the tab keeps showing the last scan), and `daily.yml` additionally restores them from the remote after its `reset --mixed` so a concurrent scan isn't clobbered (`SCANNER_FILES`). Losing one blanks its tab and resets the scanner's ΔOI / flag baseline.
2. **Request time** (Vercel serverless functions in `api/`): only used for things that genuinely need a server. The **live** endpoints the shipped site calls are: live spot/chain proxies (`/api/quote`, `/api/chain`; Yahoo's consent/crumb handshake doesn't work from the browser), the batched-quote proxy the Heatmap tab polls (`/api/quotes?symbols=…`, up to 150 in one upstream call), and the live Fed Funds rate (`/api/fed-rate`). The remaining endpoints — `/api/contract` (off-band single-contract pricer that bypasses `STRIKE_BAND`), `/api/config`, and the Supabase-authenticated `/api/portfolio-review` / `/api/close-position` / `/api/delete-trade` — are part of the **dormant** portfolio stack (the Portfolio tab was removed from the site in #269; see "Browser runtime layers" and "Supabase" below). They still deploy but nothing in the current page loads them.

When you change a tab's rendering logic, you almost always edit one of `scripts/render/app-js.mjs` (browser IIFE), `scripts/render/html.mjs` (page shell + per-tab section helpers), or `scripts/render/styles-css.mjs` (stylesheet), and then run `node scripts/regen-static.mjs` to refresh `index.html` / `app.js` / `styles.css` without touching the data pipeline. `scripts/build.mjs` only needs editing when you change the data pipeline itself or one of the shared constants the render files import (`SECTORS`, `INDUSTRY_OF_TICKER`, `FALLBACK_RISK_FREE_RATE`, `htmlEscape`, etc.).

### `scripts/build.mjs` is large (~11k lines) — orient via exports

The three big render template-strings (`renderAppJs`, `renderHtml`, `renderStylesCss`) used to live inline here but were extracted to `scripts/render/` — `build.mjs` re-exports them so existing `import` sites in `regen-static.mjs` etc. keep working unchanged.

The file is one big module. The reusable surface (also imported by `regen-static.mjs`, `regen-calendar.mjs`, `regen-picks.mjs`, `scan-unusual.mjs`, and `scan-oi.mjs`) is the `export`ed identifiers near the top and bottom. Key exports:

- `TICKERS` — the curated ~138-symbol list. Adding a ticker here adds it to every workflow and bumps the bake-time wall clock by ~2–3s.
- `ensureTickerCoverage`, `renderHtml`, `renderAppJs`, `renderStylesCss` — the page generators.
- `writeCalendarFile`, `buildPerFirm13FHoldings`, `build13FPayload`, `write13FFile` — calendar + 13F pipelines.
- `fetchMacroReleases`, `fetchEffectiveFedFundsRate`, `fetchNasdaqEarningsSessions`, `fetchFedwatchSnapshot`, `readFedwatchHistory`, `writeFedwatchHistory`, `pickFedwatchBuckets` — calendar data sources.
- `fetchCnnFearGreed`, `readFearGreedHistory`, `writeFearGreedHistory`, `writeFearGreedFile`, `appendFearGreedHistory` — CNN Fear & Greed index (`data/fear-greed.json` + history).
- `buildTopPicks`, `buildGradesIndex`, `writeGradesFile`, `PICKS_MIN_CONVICTION`, `updatePicksAccuracyFile` — top-picks engine, the all-tickers grade index (`data/grades.json`), + the accuracy tracker (imported by `regen-picks.mjs`). `buildTopPicks` and `buildGradesIndex` share a `scoreAllTickers` first pass — every ticker gets the full 4-pillar score; picks keep only the actionable names, grades keep them all. `main()` builds the grade index **once** via `buildGradesIndex(...)` and reuses that single object for `writeGradesFile`, `diffGradesHistory`, and `updatePicksAccuracyFile`'s checkpoint scores — don't re-score per consumer.
- `readGradesHistory`, `diffGradesHistory`, `writeGradesHistory` — the whole-universe grade-change log (`data/grades-history.json`), also driven by `regen-picks.mjs`. Like `picks-accuracy`, `main()` MUST `readGradesHistory()` BEFORE `writeChainFiles` wipes `data/` or the change log resets every build (the in-code comment near the export says so).
- `buildHeatmapPayload` (shared heatmap-payload builder, also used by `refresh-heatmap.mjs`), `pickContractForPick` (per-pick option-contract selector central to the picks engine, also used by `backfill-autopick.mjs`), `fetchRevenueSegments` (SEC XBRL product/geographic segment breakdowns powering the Grade-tab donut charts).
- `loadAiUsageState`, `recordAiUsage`, `writeAiUsageState` — shared AI budget tracker (`data/ai-usage.json`), written by **three** scripts: `build.mjs` (narratives + news takes), `scan-unusual.mjs` (flow explanations), and `refresh-heatmap.mjs` (post-close EOD recap). They all import these helpers from `build.mjs` so per-day Gemini totals stay accurate across scripts; note the unusual-flow workflow touches `ai-usage.json` twice per run (scan, then heatmap).
- `FOMC_MEETINGS_BASELINE` — baseline FOMC schedule merged with the live Fed calendar fetch (`mergeFomcMeetings`).

The bottom-of-file `main()` orchestrates the whole bake (fetch chains → narratives → write HTML/CSS/JS → write each data/*.json → calendar → top picks → grades + grade-change history → picks-accuracy → AI-usage flush → 13F). It only runs when `build.mjs` is the entry point — sibling tools can import its functions without triggering Yahoo/Gemini.

Bake-time tunables to know about:
- `MIN_SUCCESS_RATE = 0.75` — if fewer than 75% of tickers come back, the run throws and the workflow keeps the last-good `index.html` + `data/`.
- `FALLBACK_RISK_FREE_RATE = 0.045` — used when the 3M T-bill fetch fails. The fetched rate is plumbed into the generated `app.js` as `RFR`.
- `CALENDAR_DAYS_AHEAD = 30`.
- `MAX_EXPIRATIONS = 10` — per-ticker option expirations fetched from Yahoo, fetched **sequentially** with a 150ms politeness gap, so this is the biggest single chain-fetch wall-clock lever. 10 covers the picks engine's ideal 30-60 DTE window (and its `PICKS_MAX_DTE=120` cap) for liquid names; the far-dated LEAPS tail beyond slot 10 is dropped from the baked IV term-structure chart + expiration dropdown, but the Grade tab live-fetches any specific expiration via `/api/chain`. Chain fetch runs at `TICKER_CONCURRENCY=4` — raising it cuts wall clock but increases the aggregate Yahoo request rate, so tune concurrency **or** the politeness gaps, not both at once (`MIN_SUCCESS_RATE` degrades a throttled run to last-good data, not a corrupt one).

### Cross-build AI caches (token conservation)

The bake runs ~3×/weekday, but several Gemini outputs change far more slowly. Two caches cut repeat token spend:
- `data/chart-pattern-cache.json` — keyed per ticker on a hash of the **confirmed** daily-bar series (the trailing window the model sees, **minus** the last/in-progress bar). The midday + evening builds reuse the morning's pattern when that signature is unchanged, skipping the Gemini call entirely; a new *closed* bar the next session busts the key and forces a fresh read. Deliberate trade-off: a pattern can lag the current session by ~1 trading day — acceptable for daily-timeframe formations, and the price of real same-day cache hits. Follows the same **read-before-wipe / write-after-wipe** rule as the histories below (`readChartPatternCache()` before `writeChainFiles`, `writeChartPatternCache()` after). A keyless build returns the prior cache unchanged rather than clobbering it. Only successfully-detected names are cached, so a failure retries next build.
- The unusual-flow scanner's `data/flow-explanations.json` is the analogous per-contract cache (see `scan-unusual.mjs`) — a contract flagged once is explained once and reused free for the rest of the session.

`AI_RPM` (default 100, the per-minute AI pacer in `build.mjs`) is set to `300` in `daily.yml` for the funded Tier-1 project — Flash/Flash-Lite carry 1K-4K RPM quotas, so 300 keeps a wide cushion while shrinking the RPM-paced floor of the per-ticker AI passes. **Leave it unset on a free-tier fork** (Gemma free = 15 RPM; even the default 100 is too high there).

### Browser runtime layers

`index.html` ships **two** scripts (the page shell template, `scripts/render/html.mjs`, emits exactly these plus the inlined `window.STONKS_MANIFEST`):
- `app.js` (classic, not a module) — the IIFE generated by `renderAppJs()`. Reads `window.STONKS_MANIFEST`, handles every tab except Streaks, lazily fetches `data/<SYMBOL>.json` when the user picks a ticker, and polls `/api/quote` + `/api/chain` for live data on the Grade tab.
- `js/streaks.js` (ES module) — the Streaks tab. Renders `data/streaks.json`.

**Dormant portfolio stack — don't "fix" the missing script tag.** The Portfolio tab, landing card, pane, and its script/style loads were removed from the page templates in commit #269 ("Remove portfolio from site"). `js/portfolio.js`, `js/auth.js`, `portfolio.css`, `lib/greeks.mjs`'s client import, and the `api/{portfolio-review,close-position,delete-trade,contract,config}` endpoints + `supabase/schema.sql` are all still tracked but **nothing in the current page loads them**. The intentional design is to preserve the backend so the tab can be re-enabled later — treat these files as dormant unless you deliberately re-add a `<script type="module" src="js/portfolio.js">` tag in `scripts/render/html.mjs`. (For reference: `js/portfolio.js` used `js/auth.js` for Supabase auth — config from build-time inlined `window.STONKS_SUPABASE`, falling back to `/api/config` at runtime — and `lib/greeks.mjs` for client-side Black-Scholes.)

### Math is duplicated on purpose

Black-Scholes greeks live in **three** places: (1) the inlined `greeks`/`ncdf`/`npdf` near the top of generated `app.js` (~line 230; source at `scripts/render/app-js.mjs:~249`), (2) a second inlined Black-Scholes pricer `stratBsPrice` in the Entry-Strategy engine (`app-js.mjs:~6535`, reusing the same top-of-file `ncdf`), and (3) `lib/greeks.mjs` (imported by `api/portfolio-review.js` — and formerly `js/portfolio.js`, now dormant since #269). This is intentional — `app.js` is a generated single IIFE and can't `import` an ES module. If you change one, change the others. (Note: the "line ~92" reference in `lib/greeks.mjs`'s header comment is itself stale — line 92 of `app.js` is `escapeHtml`.)

`lib/volume-flags.mjs` is **not** duplicated the same way — it is a single-source module. The intraday volume + support/resistance-break classifier (pure functions, U-shaped intraday-volume curve) is owned by `scan-unusual.mjs`, which precomputes its results into `data/volume-flags.json`. The browser only **renders** that JSON via `MANIFEST.volumeFlags` (`app-js.mjs:~5837` reads it and points back to `lib/volume-flags.mjs` for the rules) — it does not re-implement the classifier. So there is no "change it in both" obligation here; change the math in `lib/volume-flags.mjs` only.

### Yahoo / Gemini quirks the code already handles — don't undo them

- Yahoo's `query1.finance.yahoo.com` rejects raw fetches with `401 Host not in allowlist`. All calls go through `yahoo-finance2` with a desktop `User-Agent` header so the consent-cookie + crumb handshake works. The shared client lives in `lib/yahoo.mjs` for serverless functions and is duplicated at the top of `scripts/build.mjs` for the build.
- The symbol allowlist `/^[A-Z][A-Z0-9.]{0,5}$/` (`lib/yahoo.mjs::SYMBOL_RE`) is what keeps `/api/quote` and `/api/chain` from being used as an open Yahoo proxy. Keep it.
- Beyond `SYMBOL_RE`, the live endpoints clamp numeric inputs as part of the same cheap-allowlist defense — keep these, they stop garbage reaching Yahoo / the RPC: `exp` must be `0..4102444800` epoch-sec (`api/chain.js`, `api/contract.js`), `strike` in `(0, 1e6]` and `side` exactly `call|put` (`api/contract.js`), and `api/close-position` caps quantity `1..100000` / price `0..1e6` before the `close_position` RPC re-validates DB-side.
- `/api/quotes` returns **partial** results: symbols with no Yahoo spot are silently dropped from the `quotes` array (not a 502), because partial data beats failing the whole batch when one obscure ticker disappears from Yahoo. It dedupes + uppercases input and caps at `MAX_SYMBOLS=150` via `.slice(0,150)` (symbols past 150 are dropped, not rejected). Contrast `/api/quote`, which **does** 502 when its single symbol has no spot.
- When Yahoo's `regularMarketPrice` is null and spot falls back to a pre/post-market price, the quote helpers re-derive `change`/`changePct` off `regularMarketPreviousClose` so the displayed spot and the % move share one baseline (`lib/yahoo.mjs::fetchQuote`, duplicated in `api/quotes.js`). Don't pair Yahoo's regular-session delta with a pre/post spot, and keep the two copies in sync.
- FRED's Cloudflare WAF requires a browser-shaped `User-Agent` + `Referer` (see `api/fed-rate.js`). Bare Node fetches return 403.
- Strikes are filtered to ±50% of spot at bake time (`STRIKE_BAND` in both `build.mjs` and `lib/yahoo.mjs`). `fetchContract()` in `lib/yahoo.mjs` deliberately bypasses that band — portfolio positions may sit far OTM/ITM and we need to price them (the `/api/contract` consumer is part of the now-dormant portfolio path, but keep the bypass: it's a property of `fetchContract`, not the tab).
- AI calls go through a shared rate-limiter + `data/ai-usage.json` tracker. Don't bypass it from `scan-unusual.mjs` or `refresh-heatmap.mjs` — all three (with `build.mjs`) share the same per-day Gemini budget.

### Supabase: RLS is the security boundary

> **Dormant since #269.** This whole stack backs the Portfolio tab, which was removed from the site (see "Browser runtime layers"). The schema + endpoints are preserved and the rules below remain correct — they matter if/when the tab is re-enabled — but nothing in the shipped page currently exercises them.

Schema lives in `supabase/schema.sql` (run once via the Supabase SQL editor). Three tables: `positions`, `trades`, `portfolio_snapshots`. Two RPCs: `close_position(uuid, int, numeric)` and `delete_trade(uuid)`.

- **Every table has RLS policies scoped to `auth.uid() = user_id`. Never disable RLS** — the anon key is shipped to the browser, so RLS is the only thing separating users.
- The RPCs run `security invoker` so policies apply to them too. `close_position` takes a `for update` row lock before validating, so concurrent closes can't over-sell. `delete_trade` likewise takes `for update` locks — on **both** the trade row and its parent position — to stay race-free against concurrent `close_position` calls.
- Serverless endpoints use **two** clients: a service-role client for JWT verification (`supabase.auth.getUser(token)`) and a JWT-scoped anon client (with the user's bearer token in `Authorization`) for the actual RPC/read, so RLS enforces ownership even server-side. See `api/close-position.js` for the pattern. **Exception:** `portfolio_snapshots` has *only* a `SELECT` policy (`snapshots_select_own`) — equity is server-computed and intentionally not user-writable — so `api/portfolio-review.js` keeps the service-role client past JWT verification and writes the daily snapshot through it (`writeSnapshot(auth.svc, …)`), bypassing RLS. Reads of `positions`/`trades` still go through the JWT-scoped client.
- `api/portfolio-review.js` loads positions server-side from the DB rather than trusting client-supplied positions — a previous version let users poison their own equity snapshot.
- `trades` has **both** a `trades_update_own` policy (`using = own row`, `with check = false` — so `select ... for update` can take the lock while keeping trades append-only) **and** a `trades_delete_own` policy (`using = own row`), the latter added so `delete_trade`'s `delete from trades` passes RLS while running as the caller. See the comments in `schema.sql`.

### Workflow scheduling

There are three data-generating workflows, all triggered **only** by `workflow_dispatch` (no `schedule:` block). An external cron service (cron-job.org) POSTs to the dispatch endpoint at the right ET times. **cron-job.org runs in ET, so it is the single authority on the ET slots and DST** — never replace it with GitHub's `schedule:` (which only speaks UTC and fires twice during DST shifts). The workflows used to re-check the ET hour themselves, but with a `workflow_dispatch`-only trigger that code was unreachable (every firing is a `workflow_dispatch` event), so it was removed; the workflows now proceed on dispatch and trust cron-job.org for timing.

- `daily.yml` — the full bake (`build.mjs`), ~3×/day (9:00 / 12:00 / 17:00 ET).
- `unusual-flow.yml` — hourly 9:00–16:00 ET; runs **two** steps: `scan-unusual.mjs` then `refresh-heatmap.mjs` (the heatmap's live `ch`/`sp` go stale within a session). Then `regen-static.mjs`.
- `oi-tracker.yml` — twice on weekdays (pre-market ~08:30 ET when overnight T+1 OI lands, EOD ~19:00 ET to light up volume-based signals); runs `scan-oi.mjs` then `regen-static.mjs`.

All three workflows share one `concurrency` group (`stonks-data-commit`, `cancel-in-progress: false`) so they queue instead of committing concurrently — that removes the races on files written by more than one of them (`ai-usage.json`, `heatmap.json`). They still handle landing on a moved `main` differently:
- `daily.yml` does a `fetch + reset --mixed` retry loop because the build wipes and regenerates `data/` wholesale — there's nothing local worth merging from the remote. It restores scanner-owned files (`SCANNER_FILES`) from the remote after the reset so a concurrent scan's output isn't clobbered.
- `unusual-flow.yml` does `stash + pull --rebase + stash pop` because its scanner writes only a few files; a concurrent push from the daily build needs to be preserved.

### Vercel caching

`vercel.json` sets cache headers per route. The three patterns worth knowing:
- `data/unusual*.json` gets a short edge cache (`max-age=60, s-maxage=60, stale-while-revalidate=3600`) because the unusual-flow workflow runs hourly during market hours.
- `data/heatmap.json` gets that **same** short edge cache — its live `ch`/`sp` fields are refreshed hourly by `refresh-heatmap.mjs` (the unusual-flow workflow's second step), so it needs the same freshness as `unusual*`.
- Everything else under `data/` gets `max-age=300, s-maxage=600, stale-while-revalidate=86400` — the daily build only runs 3×/day, so longer caches are fine.

The `/api/quote`, `/api/chain`, and `/api/fed-rate` endpoints set their own `Cache-Control` (20–30s edge for live data, 1h for the Fed rate).

## Conventions worth knowing

- **Keep `CHANGELOG.md` current.** Every substantive change (feature, fix, perf, removal, behavior change) gets a one-line bullet at the **top of the `## [Unreleased]` section** in [`CHANGELOG.md`](CHANGELOG.md) as part of the same change — not a separate follow-up. Use the existing categories (Added / Changed / Fixed / Removed / Perf / Docs), present tense, plain language, and reference the PR (`#NNN`) when there is one. This is bookkeeping the daily/scanner workflows do **not** automate — scheduled `chore:` refresh commits are not changelog-worthy; only human/Claude-authored changes are. Don't skip it.
- **Generated files are committed.** `index.html`, `app.js`, `styles.css`, every `data/*.json`. Don't add them to `.gitignore`; the workflows commit and push them. Direct hand-edits to `app.js` or `styles.css` will be overwritten on the next build — edit the template strings in `scripts/render/app-js.mjs` / `scripts/render/styles-css.mjs` instead.
- **Per-ticker JSON keys are compressed.** Each option row is `{ s, b, a, l, iv, oi, v }` (strike, bid, ask, last, IV, OI, volume). See `compressContract()` in `lib/yahoo.mjs` and `scripts/build.mjs`. The browser code expects this shape. The container around the rows is `data/<SYM>.json.chains` — an object keyed by the **stringified epoch-second expiration**, each value `{ c: [...calls], p: [...puts] }` whose elements are those compressed rows (`build.mjs` ~2295). The browser reads `chain.c` / `chain.p` throughout `app-js.mjs`.
- **Expirations are epoch seconds.** Used as keys throughout (`data/<SYM>.json`, `positions.expiry`, `/api/chain?exp=...`).
- **Graceful degradation is everywhere.** Yahoo flake → skip that ticker, don't fail the build. Gemini flake → reuse last-good narratives and mark them stale. FRED flake → fall back to `FALLBACK_RISK_FREE_RATE`. Single-position pricing error in the portfolio review → that row degrades, the rest of the review still ships. Preserve this pattern.
- **No bundler.** All browser ESM imports use jsdelivr CDN URLs (`https://cdn.jsdelivr.net/npm/<pkg>/+esm`). Adding a new browser dependency means importing it from the CDN, not adding to `package.json` (which is for build/server deps only).
