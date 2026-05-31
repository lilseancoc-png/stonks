# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`stonks` is a single-page **Option Contract Rater**. It is a static site (HTML + CSS + IIFE JS) served from the repo root, with a handful of Vercel serverless functions in `api/` for things the browser cannot do itself (live Yahoo quotes, AI portfolio review, Supabase-backed positions). There is **no bundler** and **no framework** — `index.html`, `app.js`, `styles.css`, and `data/*.json` are committed to the repo and shipped as-is.

Two GitHub Actions workflows (`daily.yml`, `unusual-flow.yml`) re-generate those committed artifacts on a schedule by invoking Node scripts; the resulting commit to `main` is what triggers a Vercel deploy.

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
node scripts/regen-static.mjs

# Regenerate ONLY data/calendar.json (macro releases, FOMC, FedWatch, earnings
# AM/PM sessions) without redoing the per-ticker chain fetches.
node scripts/regen-calendar.mjs

# Hourly unusual-options-flow scan. Writes data/unusual.json (today's flagged
# contracts), data/unusual-history.json (rolling hourly snapshots),
# data/unusual-log.json (7-day flag log), plus the intraday volume + S/R-break
# pass (data/volume-flags.json, data/volume-history.json) and AI flow takes
# (data/flow-explanations.json). Run via the unusual-flow workflow.
node scripts/scan-unusual.mjs

# Hourly heatmap refresh — one batched Yahoo quote call rewrites the live `ch`/`sp`
# fields in data/heatmap.json (sector/industry/market-cap come from the nightly
# bake). No AI cost. Runs as a second step inside the unusual-flow workflow.
node scripts/refresh-heatmap.mjs

# Twice-daily near-term open-interest tracker (pre-market + EOD). Snapshots the
# front two expirations per ticker — top-OI strikes, call/put walls, ΔOI vs the
# prior trading day, gamma-squeeze score. Writes data/oi-tracker.json (current
# snapshot) + data/oi-history.json (rolling). Run via the oi-tracker workflow.
node scripts/scan-oi.mjs

# Regenerate ONLY data/picks.json (+ data/picks-accuracy.json) from existing
# per-ticker data/*.json + streaks/trends/unusual. Use when only the picks
# algorithm changed — no Yahoo, no Gemini.
node scripts/regen-picks.mjs

# Local serving
python3 -m http.server 8000   # static only — /api/* endpoints will 404
npx vercel dev                # full stack including api/quote, api/chain, etc.
```

There is **no test suite, no linter, and no type checker** wired into `package.json`. The only npm script is `build`. Verify changes by re-running the relevant generator and diffing the committed artifacts, or by loading the page locally.

### Required / optional environment variables

| Var | Used by | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `scripts/build.mjs`, `scripts/scan-unusual.mjs`, `api/portfolio-review.js` | Narratives, per-ticker AI news takes, unusual-flow explanations, portfolio review. Without it the build skips AI steps and degrades gracefully. |
| `AI_MODEL`, `NARRATIVES_MODEL`, `AI_FLOW_MODEL` | build / scan scripts | Override the default Gemini model per call site. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `api/config.js`, `js/auth.js` | Browser auth client. Anon key is safe to ship — RLS gates access. |
| `SUPABASE_SERVICE_ROLE_KEY` | `api/portfolio-review.js`, `api/close-position.js`, `api/delete-trade.js` | Server-side JWT verification only. Never sent to the browser. |
| `FRED_API_KEY` | `scripts/build.mjs` (`fetchFredSeries`) | Optional. When set, FRED fetches go through `api.stlouisfed.org` (the official JSON API, not Cloudflare-fronted) as the primary path, with the public CSV endpoint as fallback. Without it the build degrades gracefully — but the GH Actions runner IPs intermittently get every CSV attempt blocked for minutes, blanking the macro calendar + Fed Funds rate + FedWatch. Free key at <https://fred.stlouisfed.org/docs/api/api_key.html>. |
| `SEC_USER_AGENT` | `scripts/build.mjs` (`fetchRevenueSegments`, 13F pipeline) | Optional. Overrides the default User-Agent sent to SEC EDGAR (`data.sec.gov`). Revenue segment breakdowns (product + geographic) are fetched from SEC XBRL filings — no API key needed. Powers the donut charts in the Grade tab's fundamentals section. Without SEC access the segment charts are hidden — the rest of fundamentals still works. |

## High-level architecture

### Two halves: bake-time vs. request-time

The site is built around a strict split:

1. **Bake time** (`scripts/build.mjs`, run by `.github/workflows/daily.yml` ~3×/day): fetches every curated ticker's option chain + ~1yr of daily bars from Yahoo, computes technicals (RSI/MACD/SMA/S&R/IV regime), asks Gemini for per-ticker news takes and the global narratives view, then writes every artifact the page needs into the repo:
   - `index.html` — page shell with a `~30 KB` `window.STONKS_MANIFEST` JSON blob inlined (ticker list, sectors, narratives, sector overviews, spots, unusual flow snapshot, build timestamp).
   - `app.js` — generated single IIFE that runs the Tickers / Narratives / Calendar / Grade / etc. tabs. **Never edit `app.js` directly.** Its source is the template string returned by `renderAppJs()` in [`scripts/render/app-js.mjs`](scripts/render/app-js.mjs). Same applies to `styles.css` ([`scripts/render/styles-css.mjs`](scripts/render/styles-css.mjs)) and the page shell in [`scripts/render/html.mjs`](scripts/render/html.mjs).
   - `data/<SYMBOL>.json` — per-ticker option chain + technicals + AI news take. Loaded lazily by the browser when a ticker is picked.
   - `data/{calendar,picks,picks-accuracy,trends,trends-history,streaks,13f,ai-usage}.json`, the macro/rate series (`macro,macro-history,rfr-history,fedwatch-history,iv-history/*`), and the bake-written `heatmap.json` + CNN Fear & Greed (`fear-greed,fear-greed-history`) — every other tab's data.
   - `data/{unusual,unusual-history,unusual-log,volume-flags,volume-history,flow-explanations,oi-tracker,oi-history}.json` — **scanner-owned**, written by the intraday `scan-unusual.mjs` / `scan-oi.mjs`, NOT regenerated by the bake. The bake *preserves* them across its `data/` wipe (it reads each in so the tab keeps showing the last scan), and `daily.yml` additionally restores them from the remote after its `reset --mixed` so a concurrent scan isn't clobbered (`SCANNER_FILES`). Losing one blanks its tab and resets the scanner's ΔOI / flag baseline.
2. **Request time** (Vercel serverless functions in `api/`): only used for things that genuinely need a server — live spot/chain proxies (`/api/quote`, `/api/chain`; Yahoo's consent/crumb handshake doesn't work from the browser), the batched-quote proxy the Heatmap tab polls (`/api/quotes?symbols=…`, up to 150 in one upstream call), the off-band single-contract pricer for far-OTM/ITM portfolio holdings (`/api/contract`, bypasses `STRIKE_BAND`), the live Fed Funds rate (`/api/fed-rate`), Supabase-authenticated portfolio reads/writes, and the AI portfolio review.

When you change a tab's rendering logic, you almost always edit one of `scripts/render/app-js.mjs` (browser IIFE), `scripts/render/html.mjs` (page shell + per-tab section helpers), or `scripts/render/styles-css.mjs` (stylesheet), and then run `node scripts/regen-static.mjs` to refresh `index.html` / `app.js` / `styles.css` without touching the data pipeline. `scripts/build.mjs` only needs editing when you change the data pipeline itself or one of the shared constants the render files import (`SECTORS`, `INDUSTRY_OF_TICKER`, `FALLBACK_RISK_FREE_RATE`, `htmlEscape`, etc.).

### `scripts/build.mjs` is large (~11k lines) — orient via exports

The three big render template-strings (`renderAppJs`, `renderHtml`, `renderStylesCss`) used to live inline here but were extracted to `scripts/render/` — `build.mjs` re-exports them so existing `import` sites in `regen-static.mjs` etc. keep working unchanged.

The file is one big module. The reusable surface (also imported by `regen-static.mjs`, `regen-calendar.mjs`, `regen-picks.mjs`, `scan-unusual.mjs`, and `scan-oi.mjs`) is the `export`ed identifiers near the top and bottom. Key exports:

- `TICKERS` — the curated ~138-symbol list. Adding a ticker here adds it to every workflow and bumps the bake-time wall clock by ~2–3s.
- `ensureTickerCoverage`, `renderHtml`, `renderAppJs`, `renderStylesCss` — the page generators.
- `writeCalendarFile`, `buildPerFirm13FHoldings`, `build13FPayload`, `write13FFile` — calendar + 13F pipelines.
- `fetchMacroReleases`, `fetchEffectiveFedFundsRate`, `fetchNasdaqEarningsSessions`, `fetchFedwatchSnapshot`, `readFedwatchHistory`, `writeFedwatchHistory`, `pickFedwatchBuckets` — calendar data sources.
- `fetchCnnFearGreed`, `readFearGreedHistory`, `writeFearGreedHistory`, `writeFearGreedFile`, `appendFearGreedHistory` — CNN Fear & Greed index (`data/fear-greed.json` + history).
- `buildTopPicks`, `PICKS_MIN_CONVICTION`, `updatePicksAccuracyFile` — top-picks engine + its accuracy tracker (imported by `regen-picks.mjs`).
- `loadAiUsageState`, `recordAiUsage`, `writeAiUsageState` — shared AI budget tracker (`data/ai-usage.json`). The unusual-flow scanner shares this so per-day Gemini totals are accurate across both scripts.
- `FOMC_MEETINGS_BASELINE` — baseline FOMC schedule merged with the live Fed calendar fetch (`mergeFomcMeetings`).

The bottom-of-file `main()` orchestrates the whole bake (fetch chains → narratives → write HTML/CSS/JS → write each data/*.json → calendar → top picks → 13F). It only runs when `build.mjs` is the entry point — sibling tools can import its functions without triggering Yahoo/Gemini.

Bake-time tunables to know about:
- `MIN_SUCCESS_RATE = 0.75` — if fewer than 75% of tickers come back, the run throws and the workflow keeps the last-good `index.html` + `data/`.
- `FALLBACK_RISK_FREE_RATE = 0.045` — used when the 3M T-bill fetch fails. The fetched rate is plumbed into the generated `app.js` as `RFR`.
- `CALENDAR_DAYS_AHEAD = 30`.

### Browser runtime layers

`index.html` ships three scripts:
- `app.js` (classic, not a module) — the IIFE generated by `renderAppJs()`. Reads `window.STONKS_MANIFEST`, handles every tab except Portfolio + Streaks, lazily fetches `data/<SYMBOL>.json` when the user picks a ticker, and polls `/api/quote` + `/api/chain` for live data on the Grade tab.
- `js/portfolio.js` (ES module) — the Portfolio tab. Uses `js/auth.js` for Supabase auth and `lib/greeks.mjs` for client-side Black-Scholes.
- `js/streaks.js` (ES module) — the Streaks tab. Renders `data/streaks.json`.

`js/auth.js` reads Supabase config two ways: build-time inlined `window.STONKS_SUPABASE`, then falls back to `/api/config` at runtime. This is the path that "just works" when env vars are only set in Vercel, not in the GitHub Actions runner. The portfolio tab silently shows "sign-in not configured" if neither path returns a key — the rest of the site keeps working.

### Math is duplicated on purpose

Black-Scholes greeks live in **three** places: inlined in `app.js` (~line 92, generated), `lib/greeks.mjs` (used by `js/portfolio.js`, `api/portfolio-review.js`), and the per-pricing-engine call sites. This is intentional — `app.js` is a generated single IIFE and can't `import` an ES module. If you change one, change the others. The header comment on `lib/greeks.mjs` says so explicitly.

The same rule applies to `lib/volume-flags.mjs` — the intraday volume + support/resistance break classifier (pure functions, U-shaped intraday-volume curve) shared by `scan-unusual.mjs` and mirrored by hand into the generated `app.js`. Change the math in one, change it in both.

### Yahoo / Gemini quirks the code already handles — don't undo them

- Yahoo's `query1.finance.yahoo.com` rejects raw fetches with `401 Host not in allowlist`. All calls go through `yahoo-finance2` with a desktop `User-Agent` header so the consent-cookie + crumb handshake works. The shared client lives in `lib/yahoo.mjs` for serverless functions and is duplicated at the top of `scripts/build.mjs` for the build.
- The symbol allowlist `/^[A-Z][A-Z0-9.]{0,5}$/` (`lib/yahoo.mjs::SYMBOL_RE`) is what keeps `/api/quote` and `/api/chain` from being used as an open Yahoo proxy. Keep it.
- FRED's Cloudflare WAF requires a browser-shaped `User-Agent` + `Referer` (see `api/fed-rate.js`). Bare Node fetches return 403.
- Strikes are filtered to ±50% of spot at bake time (`STRIKE_BAND` in both `build.mjs` and `lib/yahoo.mjs`). `fetchContract()` in `lib/yahoo.mjs` deliberately bypasses that band — portfolio positions may sit far OTM/ITM and we need to price them.
- AI calls go through a shared rate-limiter + `data/ai-usage.json` tracker. Don't bypass it from `scan-unusual.mjs` — it shares the same per-day budget as the narratives extraction in `build.mjs`.

### Supabase: RLS is the security boundary

Schema lives in `supabase/schema.sql` (run once via the Supabase SQL editor). Three tables: `positions`, `trades`, `portfolio_snapshots`. Two RPCs: `close_position(uuid, int, numeric)` and `delete_trade(uuid)`.

- **Every table has RLS policies scoped to `auth.uid() = user_id`. Never disable RLS** — the anon key is shipped to the browser, so RLS is the only thing separating users.
- The RPCs run `security invoker` so policies apply to them too. `close_position` takes a `for update` row lock before validating, so concurrent closes can't over-sell.
- Serverless endpoints use **two** clients: a service-role client for JWT verification (`supabase.auth.getUser(token)`) and a JWT-scoped anon client (with the user's bearer token in `Authorization`) for the actual RPC call, so RLS enforces ownership even server-side. See `api/close-position.js` for the pattern.
- `api/portfolio-review.js` loads positions server-side from the DB rather than trusting client-supplied positions — a previous version let users poison their own equity snapshot.
- The `trades_update_own` policy uses `using = own row` but `with check = false` because `select ... for update` against an RLS table requires the row to pass the UPDATE policy; we need the lock but want trades to stay append-only. See the comment in `schema.sql`.

### Workflow scheduling

There are three data-generating workflows, all triggered **only** by `workflow_dispatch` (no `schedule:` block). An external cron service (cron-job.org) POSTs to the dispatch endpoint at the right ET times. **cron-job.org runs in ET, so it is the single authority on the ET slots and DST** — never replace it with GitHub's `schedule:` (which only speaks UTC and fires twice during DST shifts). The workflows used to re-check the ET hour themselves, but with a `workflow_dispatch`-only trigger that code was unreachable (every firing is a `workflow_dispatch` event), so it was removed; the workflows now proceed on dispatch and trust cron-job.org for timing.

- `daily.yml` — the full bake (`build.mjs`), ~3×/day (9:00 / 12:00 / 17:00 ET).
- `unusual-flow.yml` — hourly 9:00–16:00 ET; runs **two** steps: `scan-unusual.mjs` then `refresh-heatmap.mjs` (the heatmap's live `ch`/`sp` go stale within a session). Then `regen-static.mjs`.
- `oi-tracker.yml` — twice on weekdays (pre-market ~08:30 ET when overnight T+1 OI lands, EOD ~19:00 ET to light up volume-based signals); runs `scan-oi.mjs`.

All three workflows share one `concurrency` group (`stonks-data-commit`, `cancel-in-progress: false`) so they queue instead of committing concurrently — that removes the races on files written by more than one of them (`ai-usage.json`, `heatmap.json`). They still handle landing on a moved `main` differently:
- `daily.yml` does a `fetch + reset --mixed` retry loop because the build wipes and regenerates `data/` wholesale — there's nothing local worth merging from the remote. It restores scanner-owned files (`SCANNER_FILES`) from the remote after the reset so a concurrent scan's output isn't clobbered.
- `unusual-flow.yml` does `stash + pull --rebase + stash pop` because its scanner writes only a few files; a concurrent push from the daily build needs to be preserved.

### Vercel caching

`vercel.json` sets cache headers per route. The two patterns worth knowing:
- `data/unusual*.json` gets a short edge cache (60s) because the unusual-flow workflow runs hourly during market hours.
- Everything else under `data/` gets `max-age=300, s-maxage=600, stale-while-revalidate=86400` — the daily build only runs 3×/day, so longer caches are fine.

The `/api/quote`, `/api/chain`, and `/api/fed-rate` endpoints set their own `Cache-Control` (20–30s edge for live data, 1h for the Fed rate).

## Conventions worth knowing

- **Generated files are committed.** `index.html`, `app.js`, `styles.css`, every `data/*.json`. Don't add them to `.gitignore`; the workflows commit and push them. Direct hand-edits to `app.js` or `styles.css` will be overwritten on the next build — edit the template strings in `scripts/render/app-js.mjs` / `scripts/render/styles-css.mjs` instead.
- **Per-ticker JSON keys are compressed.** Each option row is `{ s, b, a, l, iv, oi, v }` (strike, bid, ask, last, IV, OI, volume). See `compressContract()` in `lib/yahoo.mjs` and `scripts/build.mjs`. The browser code expects this shape.
- **Expirations are epoch seconds.** Used as keys throughout (`data/<SYM>.json`, `positions.expiry`, `/api/chain?exp=...`).
- **Graceful degradation is everywhere.** Yahoo flake → skip that ticker, don't fail the build. Gemini flake → reuse last-good narratives and mark them stale. FRED flake → fall back to `FALLBACK_RISK_FREE_RATE`. Single-position pricing error in the portfolio review → that row degrades, the rest of the review still ships. Preserve this pattern.
- **No bundler.** All browser ESM imports use jsdelivr CDN URLs (`https://cdn.jsdelivr.net/npm/<pkg>/+esm`). Adding a new browser dependency means importing it from the CDN, not adding to `package.json` (which is for build/server deps only).
