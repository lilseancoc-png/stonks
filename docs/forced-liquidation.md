# Forced Liquidation Tracker

Forced Liquidation Tracker is an Owner research desk at `?tab=forced-liquidation`. The same dated evidence is available to the Top Picks grader. It tracks disclosed pledges of stocks in our tracked universe, not every secured corporate loan. Collection, retained observations, quote requests and the Owner view are restricted to that universe. Removing a stock from the universe removes it from the next snapshot and from the displayed watchlist, evidence and CSV export.

## Pledge awareness

A verified pledge of a tracked stock is enough for watchlist inclusion. Loan principal, borrower identity, currency, maintenance terms, a current quote and complete facility terms are optional for awareness. The view labels incomplete records **Pledge disclosed** and shows the disclosed quantity, date and source. Initial amounts, additions, upper bounds and unresolved share conversions keep their qualifiers. These disclosed quantities do not replace a model-ready current collateral count. Confirmed stock-pledge records take priority over ordinary corporate debt context at the per-document extraction cap.

The headline counts distinct stocks with pledges. Multiple records for a stock can refer to the same pledge and are never added together. Unverified issuer attribution stays in Filing evidence and All disclosures. Released pledges stay in the history and are excluded from the default watchlist.

## Calculation

`estimated trigger = outstanding principal / (pledged shares * maximum maintenance LTV)`

`distance percent = (stock price - estimated trigger) / stock price * 100`

For a $100 million loan, 10 million pledged shares and 50% maintenance LTV, the estimate is $20. A $25 stock quote is 20% above that threshold on the distance definition. A 25% equity maintenance requirement converts to 75% maximum LTV. Initial LTV is not maintenance LTV.

The loan balance, collateral issuer, borrower, share class and loan facility must describe the same borrowing. Facility capacity, aggregate corporate debt, transaction value and total beneficial holdings do not substitute for outstanding principal or pledged shares. Share extraction stops at another quantity or share-count clause so an unrelated option holding cannot become the pledged stake. Generic maximum LTV and initial, origination or inception limits cannot supply maintenance terms; explicitly named maintenance terms are required. A mixed collateral pool does not have a single-stock threshold in this model.

Disclosed maintenance LTV and explicit sole-stock collateral produce an estimate. Missing maintenance terms produce separate 35%, 50% and 65% LTV sensitivity scenarios when the outstanding balance and pledged count are available. Those scenarios assume sole-stock collateral. They cannot establish a reported trigger or change a Top Picks decision.

## Filing evidence

`lib/forced-liquidation-sec.mjs` discovers Form 4, Form 144, Form 8-K, Schedule 13D and 13G, DEF 14A, annual reports on Forms 10-K, 20-F and 40-F, and Form 424B variants. Annual reports have their own interleaved document lane. Known off-universe issuer reports are excluded before document reads, and tracked-issuer documents are prioritized within each lane so unrelated recent keyword hits cannot crowd out an older tracked annual report. Shareholder schedules still require document-level resolution because the filer can differ from the collateral issuer. It combines a capped 30-day SEC keyword search with rotating tracked-issuer submissions over 400 days. Document families are interleaved so that one type cannot consume the read budget. Search results and issuer metadata do not prove an actual pledge.

The extractor recognizes issuer-report wording such as a facility secured by a pledge of ordinary shares. An initial pledge does not establish the current pledged share count. For an ADS listing, ordinary-share counts need an explicit one-for-one ADS ratio before they can be used with the listed quote, float or volume; other or missing conversion ratios remain unresolved. A collateral holder is not automatically the legal borrower. Facility capacity and an original borrowing do not establish current outstanding principal.

Extraction retains filing links, accession numbers, excerpts, borrower identity when available, dated facts, ambiguous numeric candidates and parser version. Loan quantities must refer to the same local disclosure and facility. A dollar symbol alone does not establish USD. Currency must be explicit locally or in a document-wide dollar-currency declaration. Unresolved currencies, multiple facilities, preferred stock, percentage-only holdings and share-count limits cannot supply a modeled common-stock trigger. The parser does not use an LLM or a paid data feed.

Negated or conditional releases do not close a pledge. A partial release without a disclosed remaining share count leaves the position unresolved. Legacy parser output remains visible for review but cannot establish numeric triggers or automated decisions until the filing is reparsed. A successful reparse replaces that document's prior observations even when the new result is empty.

The SEC's submissions API is a recent-filing index. This collector does not exhaust older archive pages or separately linked exhibits. SEC full-text search is an additional discovery path, not a guaranteed stable public API. The view reports errors, coverage caps and missing terms. An empty result does not establish that no leverage exists.

Default limits per scan are 44 documents, 12 tracked issuers, 80 SEC requests, 3 followed 13D exhibits and a 100-second budget. Requests are serial with a 250 ms gap. Discovered but unread documents persist in a pending queue across issuer rotations. A successful scan is reused for 18 hours only when the parser version is current and the queue is empty. Scan health expires after three days. Failed scans preserve observations and the original last-success timestamp. They cannot authorize a new entry veto.

The existing chain supplies prices, reported float and 20 completed daily volume bars. Zero-volume trading sessions count toward that average. Today's bar enters after the completed-close cutoff. An old or incomplete volume window cannot supply a current liquidity ratio.

Up to eight names without a usable chain quote receive additional Yahoo quote, chart and float reads, rotating by last attempt so deferred names get coverage. Quote, volume and float reads fail independently. A failed volume download does not discard a successful quote. Retained values keep their original timestamps. The market stage has a 45-second budget plus any in-flight call timeout.

## Forced-sale events

Form 144, Form 8-K, Form 4 and Schedule 13D/G amendments are also searched for wording that reports a forced sale that already happened: a margin call, a sale by a pledgee or lender, a foreclosure on pledged stock, or a sale "to satisfy" a margin or loan obligation. Each match is a `liquidation-event` observation with the event type, the sentence, any share count sold and its filing link. Risk-factor language ("could", "may", "if", "in the event") and negations do not count. A Form 144 counts only when its text names a pledge, pledgee, margin call, foreclosure or secured party; ordinary planned 10b5-1 sales are ignored. An 8-K is kept only when the tracked company is the filer.

An event within 30 days shows as **Forced sale reported** at the top of the watchlist and in a callout above it. Older events stay as **Past forced-sale report**. Events never create a modeled trigger and never change a Top Picks decision on their own.

When a Schedule 13D or 13D/A shows a pledge without maintenance terms, the collector opens the filing index and reads up to two loan or pledge exhibits (at most three per scan) to look for the margin terms. Exhibit read failures are counted separately so they do not mark the whole scan partial.

## Pledge stress score

Every current, confirmed pledge gets a 0–100 stress score that does not need loan terms:

| Part | Points |
|---|---|
| Drop since the pledge was disclosed | up to 35 (0.7 per point of drop) |
| Drop from the 52-week high | up to 15 (0.25 per point) |
| Pledged block in days of 20-day volume | up to 20 (30 days = 20) |
| Pledged block as a share of float | up to 10 |
| Modeled trigger | 20 if breached, 10 if within 15% |
| Forced-sale report in 30 days | 20 |

60 and above is **High**, 35 and above **Elevated**. Missing inputs are listed rather than counted as zero risk. Released, stale and unconfirmed records are not scored. The browser drops price parts when the quote goes stale and rescores. The score ranks visible pressure; it is not a probability of a margin call.

## Hot funds

`lib/hot-funds-sec.mjs` and `lib/leverage-distress.mjs` screen every 13F filer with at least $3B in reported value for an unusually strong run, since that kind of run is often built with borrowed money or options.

- **Source:** the SEC's quarterly Form 13F data sets (one zip per three-month filing window). Links are discovered from the SEC data-set page. One window is read per build, newest first, on non-decision builds only (`REFRESH_TOP_PICKS` off, or `LEVERAGE_BULK=1`). A new quarter takes two window reads; the first full year takes about five builds.
- **Implied return:** the book held at the start of a quarter priced at the quarter's end. End prices are the median value-per-share across all filers for each CUSIP, so no outside price feed is needed. Quarters chain into a YTD figure. A "with options" figure adds listed calls and puts at underlying notional (puts count negative) and is a rough upper bound.
- **Flags:** 40%+ YTD or last quarter is **Alert**, 30–40% is **Watch**. Books whose listed options outweigh stock (market-maker hedges), books with under 70% of value priced, and books with more than 600 rows are left out.
- **Leverage tells:** call-heavy (calls 25%+ of stock value), put-heavy, top five holdings at 50%+ of the book, and 25 or fewer stocks.
- **Daily read:** each flagged fund's top 15 holdings are priced with live Yahoo quotes. The page shows the move since the 13F, the estimated book impact and the drawdown from the 30-day high of that daily estimate. Under pressure = top holdings down 12% from the 30-day high or 15% since the 13F; deleveraging risk = 20% or 25%.
- **Filings:** up to 20 flagged funds per day are checked on the SEC submissions API for Schedule 13D/G amendments and Form 4s in the last 30 days, and for a newer 13F filed before the bulk data set catches up.
- **Our stocks:** flagged books are joined to our universe by CUSIP (OpenFIGI through the existing build mapper, plus a name and price match). The **Our stocks held by hot funds** table shows shares held, share of float, days of volume and the shares held by funds under pressure.

13F covers long US stocks and listed options only. It leaves out shorts, swaps, futures, private stakes and borrowing, so a flag is a suspicion, not proof of leverage.

## ETF rebalance

Single-stock leveraged and inverse ETFs from the Leveraged ETFs registry must trade `L × (L − 1) × assets × the stock's daily return` near the close. The **ETF rebalance** view estimates that trade for each tracked stock with a listed product, in dollars, shares and share of 20-day average volume. Fund assets come from one Yahoo summary read per product per ET day, reused for 10 days. During the session the figure is "if it closed here".

## Cluster selloffs (shadow)

The **Cluster selloffs** view logs days that look like Archegos: at least three tracked stocks in at least two sector groups each fall at least 4% (or 2.5× their usual daily move) on at least 2.5× normal volume (pro-rated for the time of day) while SPY holds above −1.5%. Stocks with earnings within two days are left out. Hot funds holding two or more of the names are listed. The read is logged for 120 days and is not used by any desk; macro days and sector news will produce false alarms.

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

`leverage-distress.json` holds the hot-fund view, ETF rebalance rows and cluster log; `leverage-distress-state.json` holds the 13F price tables, fund snapshots, CUSIP map and ETF assets carried between builds. The full bake owns both, reads them before the `data/` wipe and rewrites them after. Both are Owner-only (`tr` + `tp`), are excluded from the legacy commit path, and are listed in the freshness check. The page loads `/api/auth/me?data=leverage-distress.json` only for Owner sessions. A failure in this stage keeps the prior payload and never fails the build. It makes no AI calls.

## Commands

- `npm run collect:forced-liquidation` reads public SEC and Yahoo data and writes the local snapshot. It does not publish, trade or call an AI model.
- `npm run preview:forced-liquidation` starts a loopback preview with clearly labeled synthetic facilities and a simulated Owner session. `LIQUIDATION_PAYLOAD_FILE` selects a collected local snapshot.
- `npm run regen:forced-liquidation` regenerates the tracker shell and shared browser files from their sources while preserving published data and rate provenance.
- `npm run test:forced-liquidation` checks the model, extraction, collection, outages, decision-time reassessment, publication policy, actual Owner authorization and adversarial audit cases. An offline child process exercises the real collection command to catch module-startup failures. The daily build runs these checks before provider or model calls.
- `npm run test:leverage-distress` checks forced-sale events, Form 144 rules, exhibit follows, the stress score, 13F parsing and return math, zip reading, amendments, a four-build collection against fake SEC and Yahoo responses, live moves, the ETF rebalance, cluster detection and access keys. It also runs inside `test:forced-liquidation`.
- `npm run test:liquidation-universe` verifies broad-search filtering, cache reuse, outages, universe changes, quote calls and annual-report extraction. Set `ARM_FILING_FILE` to a downloaded Arm 2026 20-F to replay its real disclosure through collection and assessment.
- `npm run test:forced-liquidation-browser` checks responsive layouts, resizing, themes, navigation, persistence, scenario selection, CSV export, failures, stale data and the Top Picks connection. It accepts the same `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` options as the other browser checks.

## Sources

- [SEC public data APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC access policy and fair-access limits](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [SEC Form 13F data sets](https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets)
- [FINRA explanation of securities-backed credit](https://www.finra.org/investors/insights/securities-backed-lines-credit)

## ARM investigation, October 26, 2026

ARM is in `TICKERS`; ADUR is outside it. Broad SEC keyword hits previously bypassed this membership check, including when retained across scans. The collector also excluded annual reports and treated any inline-XBRL accounting footnote as the whole document's evidence. Both annual-report discovery and full-document extraction are now included.

[Arm's May 26, 2026 20-F](https://www.sec.gov/Archives/edgar/data/1973239/000197323926000097/arm-20260331.htm) discloses a pledge of 769,029,000 ordinary shares for the SoftBank Group Facility, with facts dated May 21, 2026. The original parser returned zero observations from the complete report. The updated parser retains the pledge for awareness without requiring a complete loan model. That disclosure does not establish current outstanding principal or a maintenance LTV, so it cannot establish a trigger or automated entry veto.

[The September 18 report of a $25 billion facility](https://au.finance.yahoo.com/news/softbank-raises-arm-margin-loan-054546224.html) describes a facility expansion attributed to people familiar with the matter. It is not loaded into numeric evidence as $25 billion outstanding. [SoftBank's June 2026 quarterly financial report](https://group.softbank/media/Project/sbg/sbg/pdf/ir/financials/financial_reports/financial-report_q1fy2026_01_en.pdf) is a separate dated parent-company source. Its balance and collateral scope need separate verification before any combination with Arm's May pledge disclosure.

Verification included a live scan using all 85 tracked symbols with 12 issuer-index reads and a 20-document cap. It reached ARM and retained no off-universe rows. The scan remained partial because one filing exceeded the existing 12 MB document limit; 84 documents remained pending. A separate ARM-only scan completed its requested reads without source errors. The actual universe snapshot rendered ARM's share count and missing terms at desktop and phone widths. These checks confirm discovery and display, not exhaustive collateral coverage or a liquidation trigger.

Pledge-awareness verification also covers ambiguous loan balances with a known share count, unknown ADS conversions, initial and incremental amounts, zero-share statements, unique stock counts, issuer attribution, released and stale pressure signals, CSV amounts and basis, and company/share sorting. The interface shows the same disclosed amount in the watchlist and disclosure history.
