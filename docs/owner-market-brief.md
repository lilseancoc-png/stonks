# Owner Market Brief

Open **Owner → Owner Market Brief**, or use `?tab=owner-market-brief`.
The page requires the existing signed Owner session. Its private payload is
`owner-market-brief.json`; both data readers require the two Owner claims and
return `private, no-store`. The public Brief payload and prompt stay separate.

## What the page includes

The complete Market Brief card is the starting point. The page reuses its
renderer and ticker links, then adds:

- Conditional paths from Market Analysis, with confirmation conditions,
  possible outcomes and the original horizon. Relative scenario weights are
  omitted rather than presented as calibrated odds.
- The first eight existing Unified Signal decisions in their source order,
  including support, counterevidence, blockers, technical reference levels,
  invalidators, investment/trading perspectives and source changes.
- Supported quarterly revenue and EPS estimates with fiscal periods,
  currencies, frozen cutoffs and warnings.
- A scan of all Owner destinations, the leverage-distress panels, and the
  public evidence tools. The registry test requires coverage for new Owner pages.
- A finding when cross-asset posture and tracked-stock breadth disagree,
  source links, coverage gaps and changes since the prior assembled brief.

The strategy calculator, political comparisons and historical studies retain
explicit scope limits. They do not create additional market-wide trade signals.
The Risk Analysis link opens its complete browser comparison; this saved brief
uses the baked regime and breadth and does not reproduce its live seven-desk vote.
Leveraged ETF rosters use `ideas` and ETF symbols; LEAPS also retains watch
candidate counts. Owner Lab includes its singleton dispersion observation.
Model trade records do not establish the Owner's live holdings or account fit.

## Assembly and freshness

`scripts/build.mjs` assembles the report after the research publishers and
Unified Signal have finished. `scripts/publish-owner-market-brief.mjs` reads
local snapshots, then calls the pure builder in `lib/owner-market-brief.mjs`.
It writes one optional bake-owned payload. Assembly adds no provider requests,
subscriptions or model calls and never changes upstream inputs or trade policy.

Most Owner snapshots have a 96-hour age limit to accommodate weekends.
Forecast, history, party and pledge snapshots allow 192 hours; leverage distress
allows 48 hours. Invalid, missing, explicitly stale and more-than-five-minute
future timestamps cannot supply Owner findings. Scenario timestamps are
checked independently of their outer market snapshot. Forecasts must be ready
or partial, must belong to a current company and must have a cutoff no more
than 45 days old. Former, awaiting-source, disabled, resolved and unavailable forecasts are
withheld. Missing fiscal periods, currencies or numerical outputs cannot
supply an earnings expectation.

The whole report expires after at most 24 hours, or earlier when a contributing
Owner snapshot, dated public desk, scenario, forecast cutoff or public narrative
reaches its age limit. Source observation dates take precedence over envelope
build times; date-only observations retain their original calendar day. The public narrative has a 36-hour limit. The browser checks the earlier of each quote’s expiry and its source
approval expiry separately and updates the display when it crosses that limit.
Refreshing the page reads the stored report; it does not run the research desks.
An expired report withholds market guidance, saved instructions, scenarios,
forecasts and the shortlist. The foundation requires same-session prose. A
missing narrative uses the current evidence card, including normalized Calendar
earnings, reports and FOMC events.

The server and browser use the same nested payload validator and expiry policy.
An invalid refresh retains the last readable snapshot and offers a retry.
Malformed Unified Signal sources are excluded using that desk’s existing
validator; the brief never creates a new approval rule.

The 08:30 ET public Brief-only job does not assemble an Owner report. The first
populated Owner report arrives after a completed full site build. A failed
optional assembly leaves the existing remote snapshot visibly dated.

A separate private snapshot was chosen over adding fields to `briefs.json` so
private research cannot enter the public cache. Browser-time fan-out was also
avoided: one saved report gives a consistent view without fetching every desk
whenever an Owner opens the page.

## Local verification

Run `npm run test:owner-brief` for adapters, source age, expiry, forecast
withholding, conditional scenarios, conflicts, immutable inputs, publication
and authorization through both data readers. Run `npm run test:owner-brief-browser`
with Playwright installed for desktop, tablet and phone layouts in both themes,
source navigation, approval expiry, role revocation and failure/retry states.
The additional audit suite checks the production Calendar and leveraged-ETF
contracts, quote expiry, observation cutoffs, dispersion, resolved forecasts and
malformed nested payloads. These checks use fictional data and make no market, model or broker calls.

`npm run preview:owner-brief` opens a read-only local fixture server on port
4197. `npm run regen:owner-brief` refreshes the shipped browser assets without
changing research timestamps, the embedded data manifest or rate provenance.
