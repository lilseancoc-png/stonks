# Research Lab integration audit

G0, October 30, 2026. Base: `1a8f450b660b7a889e63e09d90a447afe71d43a2` on
`Research-Labatory`. Source: owner-provided Implementation Blueprint v2.

## Verified integration points

- Frontend: buildless HTML/CSS/IIFE JavaScript. `scripts/render/{html,app-js,styles-css}.mjs`
  generate committed browser assets. `scripts/render/site-map.mjs` owns navigation.
  No React, ORM, graph library or application worker queue is installed.
- API: Vercel Node functions. `api/auth/[action].js` multiplexes endpoints to stay
  within the function limit. Its `/api/auth/me` path receives the signed cookie
  reliably. Lab requests use its `lab` query parameter.
- Authentication: `lib/session.mjs`, signed Discord `sub` identity, both `tr` and
  `tp` explicitly true. `lib/owner-access-policy.mjs` controls UI visibility.
- Storage: `lib/datastore.mjs`, private R2 with atomic conditional-write leases
  from `lib/object-lease.mjs`. Immutable generation publication owns market data.
  Request-time research uses `_stonks/research-lab/`, outside that publication,
  excluded from `store.get/list`, API data reads, bake hydration and generation GC.
- No active transactional application DB. The Supabase portfolio tables are dormant
  and excluded from deployments. Do not activate them for research.
- Testing: Node assert smoke scripts and Playwright browser scripts. Browser
  previews run actual render assets against synthetic, isolated API/storage.

## Data and engine evidence

- `scripts/build.mjs::buildPriceSeries` persists 252 rounded OHLCV bars per ticker.
  `publicChainFilePayload` writes these to `<SYMBOL>.json`. Cached data does not
  preserve historical ingestion, source releases, adjustment vintages or delistings.
- `lib/streaks.mjs::computeStreakForTicker(symbol,bars)` is a pure existing signal.
  A wrapper can replay each prefix without future bars. This proves read-only
  signal integration; it does not turn today's revised prices into PIT archives.
- Grade/pillar snapshots, Bottom Tracker and forecasts lack a verified full
  as-of historical panel. They remain unavailable for historical validation.
- Historical macro series are latest revised observations. `lib/historical-data.mjs`
  explicitly documents non-PIT semantics. No vintage inference is permitted.
- `lib/webull-*.mjs`, fills, portfolio and all trade ledgers remain outside the Lab.
  Modeled equity backtests are separate research artifacts, never orders or fills.
- Research Lab is an interactive workspace, not a bake-owned decision feed. It is
  explicitly excluded from Owner Market Brief synthesis and AI inputs. The brief
  coverage test checks this exclusion instead of requiring a fictional adapter.

## Availability and license policy

Cached prices are `EXPLORATORY_NON_PIT`, observed at snapshot capture, with
unknown historical release timing, provider adjustment continuity and survivor
coverage. Do not synthesize publication/ingestion timestamps. Verified PIT
fixtures exist only in tests. Current provider licenses have not been established
for redistribution: production export allows derived aggregate metrics, and
excludes raw prices, source text, ticker/date observation tables and credentials.
No new historical data subscription or provider fetch is introduced.

## Verification and remaining production gates

Use `npm run test:research-lab`, `npm run test:research-lab-browser`,
`npm run verify:ai-cost`, `npm run test:private-store`, `npm run test:owner-scope`,
`npm run test:owner-restrictions`, `npm run test:render`, `npm run test:site-map`.
`npm run preview:research-lab` uses fictional data and no remote services.
Live R2 conditional-write/restart behavior, namespace-scoped worker credentials,
provider licensing, staging deployment and rollback must be verified before
production activation. The flag and owner allowlist default to disabled.
