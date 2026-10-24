# News source policy

Implemented on `news-label`. New feeds provide linked research context. They do not enter ticker AI prompts, contract/guidance extraction, grades, picks, or the trading mirror. This boundary is enforced by adding them only to the News desk collection.

## Scope and sources

Every new adapter intersects its reviewed mapping with `TICKERS` in `scripts/build.mjs`. It does not infer eligibility from sector metadata, article mentions, related tickers, or a model's memory.

- Company announcements: Apple, NVIDIA, AMD, Intel, and Eli Lilly official RSS/Atom feeds. The registry is `ISSUER_NEWS_SOURCES` in `lib/free-news-sources.mjs`. These are company statements, not independent reporting. Accept only recent results, explicit guidance updates, financing, acquisitions/contracts, regulatory actions, reported clinical endpoint outcomes, and selected executive changes. Exclude awards, marketing, attendance, and notices of future earnings/result publication. Unmapped issuers have no official-feed coverage.
- EIA petroleum: the dedicated weekly release server's U.S. commercial crude inventories excluding the Strategic Petroleum Reserve, series `WCESTUS1`, in **thousand barrels**. Associate only with covered `USO`.
- EIA natural gas: the dedicated release server's Lower 48 working storage, series `png.nw2_epg0_swo_r48_bcf.w`, in **billion cubic feet**. Associate only with covered `VST` as energy input context. This association does not establish the direction or size of an earnings effect.
- FDA: Drugs@FDA through openFDA, exact sponsor `ELI LILLY AND CO`, mapped only to covered `LLY`. Accept dated original NDA/BLA approvals. Exclude ANDAs, supplemental changes, other sponsors, and future approval predictions. This is a limited recorded-action reconciliation source. It does not cover all healthcare issuers, all Lilly rights/license relationships, recalls, safety alerts, or future PDUFA dates.
- ClinicalTrials.gov is skipped. No reviewed study-to-covered-issuer/rights map exists. No trial endpoint is queried.

This change adds no SEC corporate-event stream, BEA/Census adapter, broad policy feed, or paid provider. The existing general Yahoo/Google and macro feed paths remain in service.

## Collection and retention

The existing full build owns collection and publication. No new scheduled jobs are introduced. At most eight official-source HTTP requests run in one eligible collection, with two requests in flight, a 10-second per-request timeout, and a 2 MB response limit. No immediate retries. Issuer/EIA cache checks last one hour, FDA six hours, and failed checks wait at least 30 minutes. Conditional requests use ETag/Last-Modified when supplied. Removing a mapped ticker from the universe prevents its adapter from being called and removes its new-source records.

`news-source-evidence.json` is read before the build clears `data/`, then rewritten afterward. It is bake-owned, required by the publication freshness check, and protected by the existing Track Record/Top Picks access policy. The public News payload contains reduced linked event records and source-health summaries, not the complete cache or excerpts.

Events have stable source/application/period identities, original publication dates, first-observed dates, and content revisions. Retain events for 30 days and up to four revisions per event, including a later reversion to an earlier value. Policy changes invalidate parsed caches. Canonical official article URLs provide issuer event identities, with tracking parameters removed. Each source retains its bounded parsed response for conditional-request and outage recovery. The News desk uses its existing seven-day window and item limit. Its official context comes solely from the validated evidence store; an older public feed cannot restore invalidated labels. Failed checks carry earlier context with its original date; they do not become fresh publications. Invalid persisted cache shapes trigger a new bounded collection.

EIA checks exact series and units, nonnegative numeric observations, reporting weeks exactly seven days apart, a plausible reporting-period lag, and a valid recent release date. Suppressed, missing, stale, or malformed observations produce an explicit source error. Preserve actual, previous, change, units, reporting week, and release date separately. A weekly change is not a consensus surprise. Do not infer stock direction. Date-only sources show a date, not a fabricated release time.

FDA queries the exact covered sponsor and recent submission dates, then checks each individual submission locally. A 404 `NOT_FOUND` response means no matching action; other failures mean unavailable. A result count above the bounded response limit marks incomplete coverage. openFDA can lag the original action; collection time is not action time.

## Existing label and scoring safeguards

- Match normalized publisher names exactly. Strings containing `AP` or `FT` no longer inherit those identities. Publisher classes describe origin/editorial type; they are not measured factual-accuracy ratings.
- Preserve useful summaries with their own source attribution. Google link lists and repeated titles are not article bodies. Prompts distinguish summaries from extracted article excerpts.
- Drop stale, missing-date, and implausibly future-dated ticker inputs. Expire cached judgments after one day. Summary corrections invalidate reuse even when a title is unchanged. Retain original judgment timestamps.
- A failed AI refresh marks the prior news interpretation stale and does not restore the earlier combined fundamentals judgment into current scoring. Stale, fallback, unknown, or uncertain sentiment does not earn directional news points. Unknown sentiment is absent from numeric evidence records, rather than zero.
- Contract and guidance claims are filtered before being attached or restored from cache. Points require a matching, dated, relevant supporting headline, an explicit outcome consistent with the claim, and an evidence string. Guidance above analyst expectations is not a raise versus prior company guidance. Contract support expires after 30 days; guidance after 14 days. An unrelated guidance headline cannot validate a contract. These conservative checks establish textual support, not independent verification of a model's interpretation or the commercial size of a deal.
- Catalyst dates require a linked supplied headline and an explicit date in its title/summary/excerpt. The supporting date clause must match the event words, year, and active schedule. Historical, cancelled, postponed, ambiguous, or unsupported dates are omitted. No model-memory dates or fabricated dates selected from vague windows. Old uncited cached catalysts are dropped.
- Repeated publisher distribution earns no independent-corroboration bonus. Headline direction handles explicit approval denial, recalls, and dismissed lawsuits before keyword counting. Keyword labels remain triage hints and can still be wrong.

## Adding coverage

1. Verify an issuer-controlled feed endpoint, official article hosts, date semantics, and useful material events. Add an explicit symbol/feed/host mapping. Do not generate URLs or entities from ticker names.
2. For FDA, verify the exact legal applicant plus parent, licensing, and commercialization relationship for the covered issuer. Add only reviewed mappings. Do not substring-match sponsor names or treat a drug brand as a ticker.
3. Add captured fixtures for accepted events, routine noise, wrong issuers, old/future dates, duplicate IDs, corrections, outages, and changed universe membership. Keep numeric units and periods explicit for every new series.
4. Run the opt-in live check and inspect rejection reasons as well as accepted rows. Zero qualifying events can be correct. Do not broaden a filter simply to populate the page.

## Validation and scoring promotion

Run `npm run test:news` and `npm run test:news-accuracy`. The accuracy runner is offline and uses versioned reference labels and captured public source fields. Relevant regressions also include picks, calendar, capital raises, evidence records, render, private-store, data hydration, and freshness checks. `node scripts/news-source-check.mjs --live` makes bounded free requests and writes a report only to the OS temporary directory. It does not run a bake, call AI, or write application data. `node scripts/regen-news.mjs` updates the generated News section and browser script while preserving the shell's manifest, other desks, and risk-free-rate provenance. `scripts/news-browser.mjs` exercises the real generated page with offline fixtures and requires an installed Playwright/Chromium runtime.

New-source scoring stays disabled. Before a separate promotion change, collect a human-reviewed sample of both accepted and rejected rows across multiple releases and corrections. Measure ticker attribution, event type, publication versus event date, duplicate rate, materiality precision/recall, and label agreement separately. Require zero observed wrong-universe routing and unit/period confusion; inspect all disagreement and missed-material-event cases. Evaluate guidance per metric/period/accounting basis and preserve conflicting results rather than forcing one direction. Use a held-out sample before enabling any grading effect. A successful HTTP response, green fixture tests, or source reputation does not establish measured factual accuracy or trading value.

## Local verification record

The live check on October 23, 2026 Pacific time reached all eight endpoints successfully. It parsed crude inventories of 412,517 thousand barrels, down 3,060 from the previous week, and gas storage of 3,644 billion cubic feet, up 77. Both report the week ending October 16. The first captured scan admitted no company events; review then found an overly broad scheduling exclusion hiding Lilly's already reported clinical endpoint result. A regression fixture now covers that case. No qualifying original FDA approval was present in that check. This snapshot proves endpoint/schema compatibility at that time, not ongoing availability or a source-accuracy percentage.

The initial implementation verification passed 106 news checks and 524 Top Picks checks. The subsequent accuracy review passed 135 news regression checks, 149 reference checks, 524 Top Picks checks, the affected calendar/capital-raises/narrative/story/sector-rotation/evidence/render/data-access/freshness suites, and the actual generated News page at 1366 px and 390 px. Browser checks cover light/dark themes, source badges, date-only values across time zones, filters, sorting, resize transitions, source outages, incomplete coverage, malformed payloads, changing categories, distinct releases sharing a URL, and refresh recovery. No paid AI calls, full bake, production publication, or broker action was performed.

The previously reported options entry-policy assertion was a clock-sensitive test-fixture bug: a UTC date used against an Eastern market-date boundary. The fixture now uses the Eastern date and passes at both pinned clocks across that boundary. Production option-selection logic was not changed. See `docs/news-accuracy-evaluation.md` for the evaluation method and limits.
