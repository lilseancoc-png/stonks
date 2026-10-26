# Forced Liquidation Tracker

Forced Liquidation Tracker is an Owner research desk at `?tab=forced-liquidation`. The same dated evidence is available to the Top Picks grader. It tracks disclosed pledges of listed stock, not every secured corporate loan.

## Calculation

`estimated trigger = outstanding principal / (pledged shares * maximum maintenance LTV)`

`distance percent = (stock price - estimated trigger) / stock price * 100`

For a $100 million loan, 10 million pledged shares and 50% maintenance LTV, the estimate is $20. A $25 stock quote is 20% above that threshold on the distance definition. A 25% equity maintenance requirement converts to 75% maximum LTV. Initial LTV is not maintenance LTV.

The loan balance, collateral issuer, borrower, share class and loan facility must describe the same borrowing. Facility capacity, aggregate corporate debt, transaction value and total beneficial holdings do not substitute for outstanding principal or pledged shares. Share extraction stops at another quantity or share-count clause so an unrelated option holding cannot become the pledged stake. Generic maximum LTV and initial, origination or inception limits cannot supply maintenance terms; explicitly named maintenance terms are required. A mixed collateral pool does not have a single-stock threshold in this model.

Disclosed maintenance LTV and explicit sole-stock collateral produce an estimate. Missing maintenance terms produce separate 35%, 50% and 65% LTV sensitivity scenarios when the outstanding balance and pledged count are available. Those scenarios assume sole-stock collateral. They cannot establish a reported trigger or change a Top Picks decision.

## Filing evidence

`lib/forced-liquidation-sec.mjs` discovers Form 4, Schedule 13D and 13G, DEF 14A and Form 424B variants. It combines a capped 30-day SEC keyword search with rotating tracked-issuer submissions over 400 days. Document families are interleaved so that one type cannot consume the read budget. Search results and issuer metadata do not prove an actual pledge.

Extraction retains filing links, accession numbers, excerpts, borrower identity when available, dated facts, ambiguous numeric candidates and parser version. Loan quantities must refer to the same local disclosure and facility. A dollar symbol alone does not establish USD. Currency must be explicit locally or in a document-wide dollar-currency declaration. Unresolved currencies, multiple facilities, preferred stock, percentage-only holdings and share-count limits cannot supply a modeled common-stock trigger. The parser does not use an LLM or a paid data feed.

Negated or conditional releases do not close a pledge. A partial release without a disclosed remaining share count leaves the position unresolved. Legacy parser output remains visible for review but cannot establish numeric triggers or automated decisions until the filing is reparsed. A successful reparse replaces that document's prior observations even when the new result is empty.

The SEC's submissions API is a recent-filing index. This collector does not exhaust older archive pages or separately linked exhibits. SEC full-text search is an additional discovery path, not a guaranteed stable public API. The view reports errors, coverage caps and missing terms. An empty result does not establish that no leverage exists.

Default limits per scan are 36 documents, 12 tracked issuers, 65 SEC requests and a 100-second budget. Requests are serial with a 250 ms gap. Discovered but unread documents persist in a pending queue across issuer rotations. A successful scan is reused for 18 hours only when the parser version is current and the queue is empty. Scan health expires after three days. Failed scans preserve observations and the original last-success timestamp. They cannot authorize a new entry veto.

The existing chain supplies prices, reported float and 20 completed daily volume bars. Zero-volume trading sessions count toward that average. Today's bar enters after the completed-close cutoff. An old or incomplete volume window cannot supply a current liquidity ratio.

Up to eight names without a usable chain quote receive additional Yahoo quote, chart and float reads, rotating by last attempt so deferred names get coverage. Quote, volume and float reads fail independently. A failed volume download does not discard a successful quote. Retained values keep their original timestamps. The market stage has a 45-second budget plus any in-flight call timeout.

## Pressure signals

- Leverage velocity is the percent change in debt per pledged share, normalized to 30 days between comparable dated observations.
- A possible collateral top-up requires more than a 1% increase in pledged shares with outstanding debt unchanged within 0.5%. Both observations must have the same borrower, facility, share class, USD currency and current share basis. It does not prove a lender demand or newly issued stock.
- Pledged shares above 20% of 20-session average daily volume trigger a liquidity warning. Pledged shares divided by reported float is a separate measure. Neither ratio predicts executable liquidity or a stock-price gap.
- Reflexivity watch requires distance shrinking by more than one percentage point per day, the liquidity warning, and either a possible top-up or rising leverage. Snapshots use quote dates, so weekend rebuilds cannot invent new market observations. Comparisons require unchanged loan evidence. A collateral top-up that changes terms cannot itself create apparent price acceleration.

Overlapping observations are not summed. Identified facilities have a history. Unidentified facilities remain separate research leads. Known unresolved split language blocks modeling and comparisons. Undisclosed corporate actions and incomplete matching remain limitations.

## Top Picks

`scoreAllTickers` attaches `forcedLiquidationContext` to its internal scored records when the caller supplies the private payload. It does not add the research to public ticker files, public grades or conviction points.

At decision time, the context recalculates from the underlying observations and the current chain. Persisted `engineEligible`, distance and veto flags are not trusted. A fresh, attributable, explicitly dated, sole-stock loan with disclosed maintenance terms can block a new bullish candidate within 15% of its estimated threshold. Eligible fact dates must be within 90 days. Quotes must be within 96 hours. These are screening policies, not calibrated default probabilities.

Only qualifying evidence reaches the existing final grader for either trade direction. Incomplete, stale and assumed terms stay in the Owner research view and cannot influence automated grading or invalidate its cache. A bearish trade must still clear the existing grade, thesis, contract, economics and entry checks. The roster exposes `collateralGated` and the `collateral-stress` gate trace. Its collateral watch links back to the tracker. Offline pick regeneration uses the same context and reevaluation.

New collateral evidence, changed terms or a changed threshold state invalidate the normal thesis-cache reuse window for the affected name. Names without collateral evidence keep their prior cache signatures. Existing AI call caps remain in place.

A threshold crossing is not evidence of an actual margin call, forced sale, or an immediate short entry. Cure periods, other collateral, interest, private amendments, lender discretion, refinancing and short-squeeze risk can change the outcome.

## Storage and access

`forced-liquidation.json` contains observations, facility histories, dated market snapshots and scan coverage. The full bake owns it. It is read before the `data/` wipe, rewritten afterward, classified for freshness verification, hydrated and published by the existing private-store flow. The legacy commit-data path explicitly excludes it.

`lib/premium-keys.mjs` requires both signed Owner claims. The browser loads only `/api/auth/me?data=forced-liquidation.json`, has no static fallback, and does not fetch it for anonymous or incomplete sessions. Snapshot reads time out after 15 seconds and expose Retry. Scenario selections stay in local browser preferences and never change server evidence. Known quote, volume, scan and disclosure expiry deadlines update an open page without polling providers; returning to a visible page also checks freshness. Failed freshness reads show an unassessed count rather than zero risk. Sorting and CSV export share one ordering, and exports include observation dates, freshness flags, scan state and missing terms.

## Commands

- `npm run collect:forced-liquidation` reads public SEC and Yahoo data and writes the local snapshot. It does not publish, trade or call an AI model.
- `npm run preview:forced-liquidation` starts a loopback preview with clearly labeled synthetic facilities and a simulated Owner session. `LIQUIDATION_PAYLOAD_FILE` selects a collected local snapshot.
- `npm run regen:forced-liquidation` regenerates the tracker shell and shared browser files from their sources while preserving published data and rate provenance.
- `npm run test:forced-liquidation` checks the model, extraction, collection, outages, decision-time reassessment, publication policy, actual Owner authorization and adversarial audit cases. An offline child process exercises the real collection command to catch module-startup failures. The daily build runs these checks before provider or model calls.
- `npm run test:forced-liquidation-browser` checks responsive layouts, resizing, themes, navigation, persistence, scenario selection, CSV export, failures, stale data and the Top Picks connection. It accepts the same `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` options as the other browser checks.

## Sources

- [SEC public data APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC access policy and fair-access limits](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [FINRA explanation of securities-backed credit](https://www.finra.org/investors/insights/securities-backed-lines-credit)
