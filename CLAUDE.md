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
# (no Yahoo, no Gemini). Use this when you only touched renderHtml /
# renderAppJs / renderStylesCss in scripts/build.mjs.
node scripts/regen-static.mjs

# Regenerate ONLY data/calendar.json (macro releases, FOMC, FedWatch, earnings
# AM/PM sessions) without redoing the per-ticker chain fetches.
node scripts/regen-calendar.mjs

# Hourly unusual-options-flow scan. Writes data/unusual.json (today's flagged
# contracts), data/unusual-history.json (rolling hourly snapshots), and
# data/unusual-log.json (7-day flag log). Run via the unusual-flow workflow.
node scripts/scan-unusual.mjs

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

## High-level architecture

### Two halves: bake-time vs. request-time

The site is built around a strict split:

1. **Bake time** (`scripts/build.mjs`, run by `.github/workflows/daily.yml` ~3×/day): fetches every curated ticker's option chain + ~6mo of daily bars from Yahoo, computes technicals (RSI/MACD/S&R/IV regime), asks Gemini for per-ticker news takes and the global narratives view, then writes every artifact the page needs into the repo:
   - `index.html` — page shell with a `~30 KB` `window.STONKS_MANIFEST` JSON blob inlined (ticker list, sectors, narratives, sector overviews, spots, unusual flow snapshot, build timestamp).
   - `app.js` — generated single IIFE that runs the Tickers / Narratives / Calendar / Grade / etc. tabs. **Never edit `app.js` directly.** Its source is the string returned by `renderAppJs()` in `scripts/build.mjs` (line ~1670). Same applies to `styles.css` (`renderStylesCss()`).
   - `data/<SYMBOL>.json` — per-ticker option chain + technicals + AI news take. Loaded lazily by the browser when a ticker is picked.
   - `data/{calendar,picks,trends,trends-history,streaks,unusual,unusual-history,unusual-log,13f,fedwatch-history,iv-history/*,ai-usage}.json` — every other tab's data.
2. **Request time** (Vercel serverless functions in `api/`): only used for things that genuinely need a server — live spot/chain proxies (Yahoo's consent/crumb handshake doesn't work from the browser), the live Fed Funds rate, Supabase-authenticated portfolio reads/writes, and the AI portfolio review.

When you change a tab's rendering logic, you almost always edit `scripts/build.mjs` (which contains the entire `renderHtml` / `renderAppJs` / `renderStylesCss` payload as template literals) and then run `node scripts/regen-static.mjs` to refresh `index.html` / `app.js` / `styles.css` without touching the data pipeline.

### `scripts/build.mjs` is huge (~14k lines) — orient via exports

The file is one big module. The reusable surface (also imported by `regen-static.mjs`, `regen-calendar.mjs`, and `scan-unusual.mjs`) is the `export`ed identifiers near the top and bottom. Key exports:

- `TICKERS` — the curated ~119-symbol list. Adding a ticker here adds it to every workflow and bumps the bake-time wall clock by ~2–3s.
- `ensureTickerCoverage`, `renderHtml`, `renderAppJs`, `renderStylesCss` — the page generators.
- `writeCalendarFile`, `buildPerFirm13FHoldings`, `build13FPayload`, `write13FFile` — calendar + 13F pipelines.
- `fetchMacroReleases`, `fetchEffectiveFedFundsRate`, `fetchNasdaqEarningsSessions`, `fetchFedwatchSnapshot`, `readFedwatchHistory`, `writeFedwatchHistory`, `pickFedwatchBuckets` — calendar data sources.
- `loadAiUsageState`, `recordAiUsage`, `writeAiUsageState` — shared AI budget tracker (`data/ai-usage.json`). The unusual-flow scanner shares this so per-day Gemini totals are accurate across both scripts.
- `FOMC_MEETINGS_2026` — baseline FOMC schedule merged with the live Fed calendar fetch.

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

`.github/workflows/daily.yml` and `unusual-flow.yml` are triggered only by `workflow_dispatch` — there is no `schedule:` block. An external cron service (cron-job.org) POSTs to the dispatch endpoint at the right ET times and the workflow itself **double-checks the current ET hour** before proceeding. This is the DST guard — never replace it with GitHub's `schedule:` (which only speaks UTC and fires twice during DST shifts).

Both workflows commit back to `main`. They handle concurrent commits differently:
- `daily.yml` does a `fetch + reset --mixed` retry loop because the build wipes and regenerates `data/` wholesale — there's nothing local worth merging from the remote.
- `unusual-flow.yml` does `stash + pull --rebase + stash pop` because its scanner writes only three files; a concurrent push from the daily build needs to be preserved.

### Vercel caching

`vercel.json` sets cache headers per route. The two patterns worth knowing:
- `data/unusual*.json` gets a short edge cache (60s) because the unusual-flow workflow runs hourly during market hours.
- Everything else under `data/` gets `max-age=300, s-maxage=600, stale-while-revalidate=86400` — the daily build only runs 3×/day, so longer caches are fine.

The `/api/quote`, `/api/chain`, and `/api/fed-rate` endpoints set their own `Cache-Control` (20–30s edge for live data, 1h for the Fed rate).

## Conventions worth knowing

- **Generated files are committed.** `index.html`, `app.js`, `styles.css`, every `data/*.json`. Don't add them to `.gitignore`; the workflows commit and push them. Direct hand-edits to `app.js` or `styles.css` will be overwritten on the next build — edit the `renderAppJs` / `renderStylesCss` template strings in `scripts/build.mjs` instead.
- **Per-ticker JSON keys are compressed.** Each option row is `{ s, b, a, l, iv, oi, v }` (strike, bid, ask, last, IV, OI, volume). See `compressContract()` in `lib/yahoo.mjs` and `scripts/build.mjs`. The browser code expects this shape.
- **Expirations are epoch seconds.** Used as keys throughout (`data/<SYM>.json`, `positions.expiry`, `/api/chain?exp=...`).
- **Graceful degradation is everywhere.** Yahoo flake → skip that ticker, don't fail the build. Gemini flake → reuse last-good narratives and mark them stale. FRED flake → fall back to `FALLBACK_RISK_FREE_RATE`. Single-position pricing error in the portfolio review → that row degrades, the rest of the review still ships. Preserve this pattern.
- **No bundler.** All browser ESM imports use jsdelivr CDN URLs (`https://cdn.jsdelivr.net/npm/<pkg>/+esm`). Adding a new browser dependency means importing it from the CDN, not adding to `package.json` (which is for build/server deps only).
