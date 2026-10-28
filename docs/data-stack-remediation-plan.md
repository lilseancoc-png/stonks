# Research repairs and long-term capability plan

October 27, 2026. Follow-up to [the platform review](data-stack-review.md). This is a proposed implementation plan, excluding portfolio work. Application behavior has not been changed by this document.

## The four issues

### 1. Missing debt can be described as no debt

**Observed behavior.** The actual Stock Picks checklist produces the same answer for explicit `totalDebt: null` and observed `totalDebt: 0`: “essentially no debt.” With synthetic positive debt of 500 and annual free cash flow of 100, it correctly says debt is five times annual FCF. These are test inputs, not facts about a real company.

**Root cause.** Optional checklist financials use `pnum`, which calls `Number(x)`. JavaScript converts null to zero. The checklist then reaches a branch that treats a nonpositive debt value as essentially debt-free. Both the input conversion and the wording need attention. Fixing only the sentence would leave other missing financial inputs looking measured. The project already has `pnumN`, a null-preserving variant, with a comment explaining this exact distinction. Other callers rely on the old helper's behavior, so changing `pnum` globally would have a wider scope.

**Effect.** This is a false reassurance problem in company research. It can make an incomplete financial record look more complete and less leveraged than the available evidence supports. It does not, by itself, establish that a trade was entered, a grade changed, or the production page currently displays the bad answer.

**Correction.** Use the existing null-preserving path for optional checklist financial inputs. Build independent clauses for FCF yield and debt coverage. Known FCF and market cap can support an FCF yield while debt remains unavailable. Say “no reported debt” only for an explicitly observed zero, with the reporting period visible. Negative, invalid, or stale debt needs a labeled availability/quality state rather than a debt-free interpretation.

**Proof required.** Missing debt, observed zero debt, positive debt, missing FCF, and partial financial records must produce distinct appropriate answers. Exercise the rendered Stock Picks checklist as well as the pure function. Verify that any nearby quality/scoring gates use the same missing-data meaning without changing their intended policy.

**Owning source.** `scripts/build.mjs`: `pnum`, `pnumN`, `buildStockChecklist`.

### 2. Daily fundamentals history turns missing values into zero

**Observed behavior.** The actual isolated `fundHistoryPoint` function writes explicit null P/E, FCF and debt as zero. Undefined fields are omitted. This affects the compact daily fundamentals snapshot. It is distinct from SEC raw disclosures and the Earnings Forecast archive.

**Root cause.** Another numeric conversion calls `Number(v)` before rejecting missing input. Zero is finite and survives serialization.

**Effect.** A missing observation can become a fake valuation, cash-flow, debt, growth or margin observation. Any chart, comparison or future model using that history could treat a collection gap as a real economic change. The prior review's sampled production AAPL history endpoint returned 404, so affected production records and downstream calculations have not been measured.

**Correction.** Reject absent/invalid inputs before conversion, preserve observed zeros and negative values where meaningful, and version the corrected writer. Inspect consumers before choosing whether absence is represented by an omitted field or explicit null. Keep that representation consistent.

**Historical cleanup.** First produce a read-only inventory of suspect records and their consumers. If retained raw source evidence establishes that a field was missing, correct it with a recorded repair version. If the original source cannot distinguish missing from a genuine zero, label that observation unverified and omit it from calculations needing a known value. Do not delete every zero or backfill old dates with today's values. Preserve an audit trail of any repair.

**Proof required.** Test null, undefined, empty strings, invalid numbers, explicit zero, and valid signed values. Test the complete collect/write/read path, including a partially failed provider response. Reconcile a sample of repaired histories to retained source evidence. New observations must never turn an outage into a zero.

**Owning source.** `scripts/build.mjs`: `fundHistoryPoint`, `collectFundamentalsHistory`, `writeFundamentalsHistory` and consumers of `fundamentals-history/`.

### 3. The full build passes a price representation the evaluator skips

**Observed behavior.** With the actual functions and the same 21 synthetic names, `seriesFromChains` accepts zero names from raw build objects containing `_bars`, and 21 from serialized objects containing `priceSeries`.

**Root cause.** The full build collects raw bars in memory. File serialization creates a separate compact `priceSeries` object. The grade-research step later passes its original objects to a converter that reads only `priceSeries`. The regeneration command reads the saved files and therefore enters through a different representation. Pure tests with already-prepared series can pass while the full-build wiring remains wrong.

**Effect.** The scheduled full-build report can lack the prices needed to evaluate grades even when collection succeeded. This blocks observation of performance; it is not proof the strategy has either positive or negative returns. Authenticated production report contents were not read.

**Correction.** Have both build and regeneration paths create the same explicit normalized evaluation series before calling `buildGradeResearch`. Two shapes were considered: make the build reread serialized files, or normalize the already available raw/persisted prices at the evaluation boundary. Prefer the latter because each caller can supply valid prices without depending on a previous file-write side effect. The next issue still requires a durable historical store; this small wiring repair alone is insufficient.

**Failure behavior.** When grades are present but no evaluable price series exists, publish a clear failed/degraded research state. Do not present the missing input as evidence that the system merely needs more time or that a strategy failed.

**Proof required.** Feed identical prices through raw-build and persisted-file paths and assert identical accepted dates, names and research results. Exercise the real build call boundary with providers replaced by local captured inputs, then confirm an authenticated published report has nonzero expected coverage and correct dates.

**Owning source.** `scripts/build.mjs`: `fetchTickerChain`, `publicChainFilePayload`, full-build `buildGradeResearch` call. `lib/grade-research.mjs`: `seriesFromChains`. `scripts/regen-picks.mjs`: research caller.

### 4. The validation rule needs more history than the system retains

**Observed behavior.** The system requires 60 non-overlapping ten-session windows. Ordinary company payloads retain 252 closes; daily grades retain 280 rows. The correctly serialized probe yields 25 qualifying windows. Sixty complete ten-session windows require roughly 600 sessions, with additional boundary and estimation history. At about 252 trading sessions per year, that is roughly 2.4 years of observations. This is a scale calculation, not a promise about an exact completion date.

**Root cause.** History intended for a small, fast browser payload also supplies a longer-lived research test. The evaluator computes its sample again from the rolling data. It does not accumulate an independent permanent total of resolved windows.

**Effect.** Waiting longer cannot make the current retained sample satisfy the rule. This also prevents meaningful long-horizon tests when their outcomes lie beyond the retained window.

**Correction.** Separate compact display data from durable research history. Keep source-linked prices and corporate-action treatment, dated universe membership, original decision time, score components, rule version, and input availability. Retain resolved outcomes and their evaluation version. The existing immutable archive patterns in Earnings Forecast and Unified Signal are starting points, but their coverage must be checked before reusing them as a complete universe-wide research record.

Two storage shapes were considered: expand every public ticker and daily-grade payload for all readers, or retain an Owner research archive and serve a compact report. Prefer the archive and compact report. It avoids making every ordinary page download years of evaluation data and makes retention independent of chart display requirements. Use the existing scheduled build and generation publication mechanism; a new service or large database is not a prerequisite.

**Evidence discipline.** Preserve the current minimum unless research justifies changing it. A model-version label does not make old grades comparable to a new scoring rule. Historical reconstruction must be distinguished from forecasts actually frozen before outcomes. Large counts of names on the same market date do not create that many independent market periods. Surviving the sample threshold alone still does not prove persistent predictive value.

**Proof required.** Run more than the complete required span through the actual retention/publication/read/evaluation cycle. Confirm old eligible records survive, repeated runs do not duplicate them, corrections retain their lineage, policy changes form separate cohorts, and outcomes start after the original decision is actionable. Show sample counts, date ranges, costs and missing-data exclusions in the resulting report.

**Owning source.** `scripts/build.mjs`: `PRICE_SERIES_BARS`, `GRADES_DAILY_MAX_DAYS`, daily-grade accumulation. `lib/grade-research.mjs`: non-overlapping windows and `RESEARCH_KILL_DAYS`. Publication/hydration ownership must also cover the archive.

## Delivery order and completion criteria

### Phase 1: trustworthy measurements and evaluation

Deliver the missing-data repairs together with their direct checks. Inventory old records before any historical cleanup. Repair evaluation wiring. Add durable evaluation history in a separate, reviewable change with retention and publication checks.

The visible product should distinguish **missing data**, **collection failed**, **collecting outcomes**, and **evaluated results**. Show source observation time, financial reporting period, publication date and method version separately where relevant.

Completion means the four reproductions no longer fail under the relevant corrected behavior, the scheduled path actually evaluates its supplied names, and the archive can retain the span needed for the configured test. It does not mean the strategy has already collected years of forward evidence or has become profitable.

The first numeric and wiring repairs reuse existing inputs. The durable archive adds storage and processing, so measure bytes, reads and writes before expanding retention. Provider subscriptions and extra AI calls are not intrinsically required for those repairs.

### Phase 2: a durable company research file

Start with the existing ten-company forecast cohort or another explicit small priority list. Build a common historical record before expanding all 85 names.

For five to ten years where available, collect income, balance-sheet, cash-flow, and share-count history. Track operating cash generation, CapEx, stock compensation, dilution, net debt, debt maturities and capital allocation. Keep debt/lease definitions explicit and avoid double counting obligations. New issuers and changed accounting bases retain shorter, labeled histories.

Reuse the forecast system's source hashes, filing identifiers, period normalization, original versus first-collected dates, and immutable observations. A corrected filing may update the current view while preserving what earlier research actually used. Keep reported, mathematically derived, vendor-estimated and manually assumed values visibly distinct.

The SEC provides public company facts and submission history without an API key, but its aggregated facts cover standardized entity-wide concepts. Custom company KPIs and segment detail may require the underlying filing or investor-relations disclosure. See [the SEC API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).

Completion means every displayed financial point traces to a disclosure, reporting period, currency, accounting basis and availability date; material subtotals reconcile; unsupported facts remain unknown; and a current view and an earlier research snapshot can both be reproduced. Do not subtract annual EPS or weighted-average shares to invent quarterly values.

### Phase 3: business drivers and long-term valuation

Use one common financial record and scenario interface, with business-specific driver definitions. The alternative of a single growth-rate slider for every company is simpler but cannot explain different economics.

Examples of model inputs, selected only when disclosed or explicitly assumed:

- Subscription software: customers, revenue per customer, retention, margins and stock compensation.
- Semiconductors: shipments, selling prices, product mix, gross margins, inventory and reinvestment.
- Cloud/infrastructure: contracted and realized demand, utilization, pricing, power/lease costs, CapEx and depreciation.
- Retail: stores, comparable sales, gross margin, inventory and working capital.
- Banks: earning assets, net interest margin, credit losses and capital requirements, with valuation suited to a financial institution.

Build three- to five-year revenue, operating profit, cash flow and per-share outcomes. Feed those into suitable cash-flow or valuation-multiple methods. Show bear/base/bull sensitivities without assigning unsupported probabilities. Show a reverse valuation answering what growth, margins and eventual multiple today's price requires.

Keep consensus and management guidance separate. Use existing dated estimates where available; if historical consensus is absent, say so. The model should distinguish disagreement with an explicit analyst estimate from disagreement with assumptions implied by the price.

Completion means a user can change a business assumption and trace its effect through statements, per-share results, value and conditional return. It must handle buybacks versus dilution, currencies, losses and financial-sector exceptions consistently. Technical targets and analyst price targets remain separate reference values.

### Phase 4: thesis records and quarterly monitoring

Save why the company is interesting, why the valuation is attractive under stated assumptions, the strongest opposing case, source-linked evidence, three to five falsifiable metrics, and the next review event. Freeze that version.

When new results arrive, compare them with the original model and thesis. Separate a missed assumption, a missing disclosure and a changed business definition. Record revisions with reasons so the original thesis remains visible. Human judgment owns whether new facts invalidate the case; AI can summarize the documented changes.

Completion means the workspace can explain what changed since the original decision and whether it met the prewritten review criteria. It must not quietly rewrite the old assumptions to agree with new results.

### Phase 5: targeted industry evidence and selective purchases

Attach existing alternative indicators to explicit company hypotheses. For example, falling GPU rental offers might suggest supply pressure, but that hypothesis needs compatible hardware, service terms and utilization evidence. Memory spot prices need a bridge to product mix and realized company pricing. Buyer CapEx needs a bridge to supplier orders, shipment timing and margins.

Freeze the proposed relationship and test it on later observations against a simple baseline. An explanation written after an earnings result is not a prospective forecast. For historical macro tests, use original vintages and release availability, rather than revised data; [ALFRED documents that distinction](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html).

Purchase normalized financial history, estimates or a narrow alternative dataset only after documenting a coverage/reliability bottleneck and checking its current entitlements. Each adapter should have a source policy, budget, cache, retry bounds and visible outage status. No specific subscription or price is proposed here.

Completion means the extra data measurably improves coverage, saves verified research work, or adds information to a prespecified future test. More panels or more agreeing descriptions are not sufficient evidence.

## What becomes usable before predictive proof exists

Source-linked financial histories, explicit assumptions, reverse valuation and frozen thesis monitoring can improve the discipline and auditability of research as soon as they work correctly. They do not require a claim that the grade predicts returns. Predictive claims remain a separate, slower evaluation task at the horizon actually being claimed.

The recommended starting package is Phase 1 plus the company file for a small priority universe. Then complete the valuation and monitoring workflow for that same group before broadening coverage.
