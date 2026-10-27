# Mingstreet research and data-stack review

Reviewed October 27, 2026, on `Data-Stack-Review` at `5eb1c882d49f544406317edb4564790028c99fbd`.

Follow-up implementation on this branch addresses the four source findings and adds company-history, full-year valuation and industry-evidence views. The review below records the original state; see [implementation status and limits](data-stack-implementation.md).

## Judgment

**Yes, Mingstreet can support serious long-term research, provided the investment case also includes original company disclosures, explicit valuation work, and portfolio-level risk review. Today it is more complete as a research and monitoring workstation than as a system for independently underwriting a multi-year investment.**

The site helps find candidates, assemble context, notice changes, and challenge a thesis. It does not yet reliably answer the central long-term question: what cash will this business produce for each share, what am I paying for it, and what could permanently impair that value?

Compared with the publicly documented capabilities of leading firms, we have useful overlap in the questions our tools ask. The largest differences are depth of company research, data history and normalization, valuation, portfolio construction, and demonstrated predictive value. Faster prices and expensive alternative data would not, by themselves, close those gaps.

I interpret long term as roughly one to five years. A one- to two-year option has additional expiry, volatility, liquidity, and exercise risks even when the underlying company thesis is right. A good business thesis does not establish that a particular option is a good investment.

This is a capability review, not a measured ranking against the industry. There is no defensible percentile or claim that the tool matches a particular fraction of a hedge fund. Public firm descriptions establish advertised capabilities, not access to their private systems or proof of their results.

## Scope and evidence

The current navigation has **53 destinations, including 15 Owner destinations**, covering an **85-symbol curated universe**. These counts include navigation and help pages; they are not 53 independent investment models. Every destination is covered in the companion feature catalogue. Core collection, financial normalization, scoring, history, validation, and publication paths were inspected. This was not a line-by-line audit of every renderer or an authenticated end-to-end test of every page.

The reproducible evidence is in [data-stack-review-evidence.json](data-stack-review-evidence.json). Run:

```sh
node scripts/audit-data-stack.mjs --checks --production --out docs/data-stack-review-evidence.json
```

The collector reads source and local artifacts, executes isolated reproductions and offline checks, and optionally reads six anonymous public-site endpoints. It makes no model, order, or production-storage writes. Its optional output file is the only report it writes directly.

Eight offline behavior suites passed. The separate local history audit reconciled **37 datasets, 11,162 seasonal-window returns, and 20 macro medians** against the retained source cache. Its cutoff was October 24, 2026. This verifies stored calculations, not investment returns or current production freshness. The grade diagnostic could not measure live score performance because `grades-daily.json` and the individual ticker histories were absent from this checkout.

Anonymous production reads found both public manifests and AAPL data available. The manifests reported data built October 26 at 20:13 UTC, and AAPL's regular-session quote was dated October 26 at 20:00 UTC. The sampled AAPL payload had five quarterly revenue observations and six FCF observations. This one company is evidence of limited depth in that sample, not a census of every company. `fundamentals-history/AAPL.json` returned 404. The Earnings Forecast and Unified Signal endpoints returned `401` with `private, no-store`; their signed-in contents, publication status, and realized accuracy were not inspected. A 401 proves the anonymous boundary, not that the underlying Owner payload exists.

## Where we stand

**Research discovery and monitoring are usable now.** The site consolidates prices, business snapshots, earnings, transcripts, ownership, events, macro context, and a handful of industry indicators. Consistent navigation and source-aware summaries save research time. That utility does not depend on the composite grade forecasting returns.

**Company analysis is a starting point.** Cash-flow history, capital allocation, reported segments, debt/cash snapshots, growth trends, and the Stock Picks checklist help identify questions. The checklist explicitly leaves unit economics and several qualitative questions unresolved. Margin and ROE proxies cannot establish a durable moat, pricing power, or management quality. Current peer coverage also excludes many private and untracked competitors.

**Long-term valuation is incomplete.** The current system has valuation multiples, peer comparisons, analyst targets, quarterly earnings sensitivities, and technical objectives. Those are useful inputs. I did not find an integrated multi-year owner valuation connecting business drivers to cash flow, reinvestment, balance-sheet changes, diluted shares, and the return implied by today's price. There is no equivalent integrated reverse valuation showing what growth and margins the price already requires.

**Risk monitoring is broader than portfolio risk management.** Market Analysis has conditional factor sensitivities and scenario ranges; Risk Analysis explains disagreement across desks. Research paper books include position and sector limits, drawdown throttles, and delay/cost stresses. Personal tools have account-budget controls. These are real capabilities. They do not amount to a live, holdings-aware view of aggregate factor exposure, overlapping ETF/company bets, liquidity, concentration, and scenario loss. The old Supabase portfolio application is dormant and excluded from deployment.

**Predictive edge is unproven in this review.** The design includes forward ledgers, grade-ranking tests, beta/sector adjustments, non-overlapping windows, shuffled-grade comparisons, and frozen forecast evaluation. Those are sensible building blocks. Their existence and passing tests do not establish that the site beats a benchmark, that a score is a probability, or that a backtest represents achievable fills.

## Institutional comparisons

### Fundamental managers, illustrated by Capital Group

Capital Group describes multi-year investing based on company fundamentals and valuation, with research extending to company relationships and site visits. Our comparable surfaces are Stock Picks, financials, transcripts, ownership, industry indicators, and Earnings Forecast. Our missing work is deeper: operating models, competitive research, management assessment, and an explicit differentiated view versus expectations. See [Capital Group's investment process](https://www.capitalgroup.com/individual-investors/associates/eua/about-us/philosophy.html) and [research beliefs](https://www.capitalgroup.com/institutions/it/it/about-us/our-beliefs.html).

For this user's goal, that is the most relevant comparison. The aim should be a rigorous small research practice covering a manageable set of companies. It need not reproduce every function of a large firm.

### Fundamental research with alternative data, illustrated by T. Rowe Price

T. Rowe Price describes combining alternative datasets with analyst questions, company meetings, and industry work. Importantly for our approach, its examples include public-web product pricing and inventory. Our AI-spending, memory, and GPU-price collection is therefore a legitimate research category. The gap is granularity and interpretation: advertised rental prices are not realized utilization or revenue; memory spot prices are not a company's blended contract pricing; total buyer CapEx is not a supplier's order book. See [T. Rowe Price's research discussion](https://www.troweprice.com/institutional/us/en/insights/articles/2026/q3/how-alternative-data-drive-investment-insight-and-alpha-potential-na.html).

The useful next step is to connect a few well-understood series to company-specific hypotheses and test what they add. More datasets without that connection can increase noise and confidence at the same time.

### Systematic firms, illustrated by Two Sigma

Two Sigma publicly describes data sourcing and preparation, quantitative modeling, large-scale simulations, and portfolio construction. Our quant screens, evidence records, grade research, and shadow-signal evaluation have conceptual overlap. We do not have comparable verified data breadth, long point-in-time history, research scale, or demonstrated out-of-sample performance. See [Two Sigma's investment-management process](https://www.twosigma.com/businesses/investment-management/).

A screen that identifies an unusual event has completed an observation task. Demonstrating profitable prediction requires a separate experiment with a fixed rule, realistic implementation, appropriate controls, and future outcomes.

### Portfolio platforms, illustrated by BlackRock Aladdin

Aladdin describes integrating positions with factor exposures, portfolio construction, stress tests, and performance analysis across asset classes. Our market-regime pages answer whether conditions look supportive or stressed. They do not quantify the loss of the user's actual portfolio under those conditions. See [Aladdin Risk](https://www.blackrock.com/aladdin/platforms/products/aladdin-risk).

For a personal portfolio, a much smaller holdings-based risk layer would capture part of this benefit. For example, NVDA, a semiconductor ETF, QQQ, and data-center infrastructure stocks may represent several instruments but one large AI-spending exposure.

### Data vendors are another comparison

Bloomberg and FactSet are infrastructure vendors, not substitutes for the investment judgment of a fund. Bloomberg documents integrated data access and reproducible analysis through BQuant; FactSet documents long normalized financial histories and point-in-time estimate products. Their advantage includes consistent identities, histories, definitions, and support, beyond price latency. See [BQuant](https://professional.bloomberg.com/products/bloomberg-terminal/research/bquant/), [FactSet Fundamentals](https://insight.factset.com/resources/at-a-glance-factset-fundamental-datafeed), and [point-in-time estimate methodology](https://www.insight.factset.com/hubfs/Resources%20Section/White%20Papers/ID11996_point_in_time.pdf?hsLang=en-us).

## The data stack

The working flow is scheduled collection, calculation and selective Gemini synthesis, JSON publication to private object storage, a static Vercel interface, and request-time quote/chain overlays. Cloudflare R2 and Vercel Blob are supported storage backends. The active account configuration and bills were not inspected. JSON and scheduled jobs are a reasonable architecture for a small research universe. Replacing them with a large database would not supply missing financial facts or improve an investment thesis by itself.

**Prices and options.** Yahoo Finance, through `yahoo-finance2`, supplies the main quote, chain, daily-bar, and intraday inputs. Full builds are configured five times per weekday; the slower decision desks refresh at 11:00 and 15:30 ET. Hourly scans and request-time endpoints supplement them. This is adequate cadence for many long-horizon questions, subject to correct corporate actions and source dates. It is weaker for trade reconstruction, execution analysis, and measuring rapid option flows. A request-time response is not a guaranteed exchange-real-time feed.

**Financials and expectations.** Broad company coverage uses Yahoo snapshot modules and quarterly time series. Selected income charts keep eight quarters; revenue, net-income, FCF, CapEx, and OCF accumulators retain up to twelve quarters. The separate daily fundamentals snapshot keeps one rolling year. Historical corrections replace same-period values in these accumulators. This is not a platform-wide as-originally-known financial archive. Current forward estimates and recent estimate changes exist, but they do not provide a full historical broker-consensus distribution.

**Original company disclosures.** SEC EDGAR supplies revenue segments, institutional and insider filings, CapEx facts, pledge evidence, and the new financial-forecast inputs. This is one of the strongest parts of the source strategy. Forecast normalization takes fiscal periods, additive versus nonadditive facts, currency, and unsupported EPS seriously. Coverage is narrower than the whole site, and SEC standardized entity-wide facts do not capture every business-specific KPI. The [SEC API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) explains the available company facts and submissions.

**Earnings and language.** Yahoo/Nasdaq earnings data and Motley Fool/MarketBeat transcript discovery feed event analysis and AI summaries. Source links, claim validation, and date checks help. Summaries are reading aids; they do not replace checking management's actual wording, accounting basis, or missing disclosures. The official issuer-news adapter covers five named issuers, not all 85 symbols. The general feed has wider coverage.

**Macro.** FRED, Treasury and official release calendars supply substantial public information. Historical Data includes 17 market proxies and 20 macro-context series, plus shared extra credit series outside its 37-dataset coverage contract. The history audit passed. However, macro observations are generally the latest revised values. The source code explicitly discloses this. Historical causal or trading tests need the values and publication timing available then. [ALFRED supports that distinction](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html).

**Ownership and positioning.** SEC 13F and Form 4 data are useful leads. A 13F is a delayed, partial view of a manager, not a current portfolio or their rationale; the SEC describes the quarterly deadlines and omitted short positions in its [13F FAQ](https://www.sec.gov/rules-regulations/staff-guidance/frequently-asked-questions-about-form-13f). Option open interest does not identify who owns the long or short side. Our GEX calculation applies a conventional call-positive/put-negative assumption. Unusual flow measures changes in cumulative option volume; its last-price-versus-current-spread tag cannot reconstruct aggressor direction, opening versus closing activity, or a multi-leg trade.

**Industry and alternative indicators.** SEC/Yahoo CapEx, public memory pricing, public GPU offers, World Gold Council gold data, and theme-level Google Trends provide useful context. Search collection uses a SerpApi adapter when configured, so it is inaccurate to describe every potential data path as free. Gemini also has usage cost. No current spending totals were measured. The important gaps are representativeness, changing source definitions, collection reliability, and validation against company outcomes.

## Concrete findings to address

### 1. Missing debt can become a reassuring checklist answer

Passing `freeCashFlow: 100`, `marketCap: 10000`, and `totalDebt: null` into the actual `buildStockChecklist` function returns an **answered** row containing “essentially no debt.” The branch permits a known market cap and then treats unavailable debt like zero. This is especially relevant to long-term research because it can hide balance-sheet uncertainty. The reproduction is synthetic and makes no claim about AAPL's actual debt.

Fix the debt clause independently: unknown debt must remain unknown, and a zero-debt statement must require an explicitly observed zero. Source: `scripts/build.mjs`, `buildStockChecklist`.

### 2. Explicit null financial snapshots become zero

`fundHistoryPoint` calls `Number(v)` before rejecting missing values. Explicit null P/E, FCF, and debt become `0` and survive the output filter. That can make missing coverage look like a real historical observation. Undefined values follow a different path. The actual isolated function reproduces the problem. Affected production records were not established; the sampled AAPL history endpoint was unavailable.

Preserve null semantics and review existing retained observations before using daily ratio histories in research. Source: `scripts/build.mjs`, `fundHistoryPoint`.

### 3. The full build's grade-research input shape is skipped

`fetchTickerChain` returns raw daily prices in `_bars`. `publicChainFilePayload` creates `priceSeries` on a new serialized object. The full build later passes its original in-memory chains into `seriesFromChains`, which reads only `priceSeries`. Executing the actual functions with 21 synthetic names produced **zero accepted names for the raw shape and 21 for the serialized shape**. The regeneration path reads persisted data and therefore has a different input shape.

Give the evaluator a single explicit price-series contract and verify the full build's call, not only prepared test inputs. This finding establishes the source wiring problem, not the current contents of an authenticated production report. Sources: `scripts/build.mjs` and `lib/grade-research.mjs`.

### 4. The validation threshold exceeds retained history

The evaluator requires 60 non-overlapping ten-session windows. The ordinary per-company price payload retains 252 closes, and daily grades retain 280 rows. Even the correctly serialized synthetic path produced only **25 qualifying ten-session windows**. Sixty windows need roughly 600 sessions plus boundary and estimation history. Waiting longer with the same rolling retention does not solve this.

Retain a separate durable evaluation dataset with dated universe membership, prices and policy versions. Preserve the threshold unless research justifies changing it. Sources: `PRICE_SERIES_BARS`, `GRADES_DAILY_MAX_DAYS`, and `RESEARCH_KILL_DAYS`.

These four findings are documented and reproduced. Application behavior was not changed as part of this review.

## Why the horizon matters

Top Picks and the shared grade explicitly target roughly one- to two-week directional options trades. Unified Signal currently has a 14-calendar-day research horizon. Stock Picks is a quality-and-dip screen; Sector Rotation targets rebound structure. LEAPS reweights the shared pillars toward fundamentals and trend, but it remains a research qualification score. Its published desk does not itself select an executable long-dated contract.

Earnings Forecast is the closest foundation for deeper underwriting: source bytes, immutable runs, fiscal normalization, temporary sensitivities, and forward evaluation are useful controls. Its base revenue forecast extrapolates recent year-over-year growth from the comparable seasonal quarter, with recent financial-margin assumptions. It covers a ten-company launch cohort and the next quarter. That is a transparent baseline, not yet a multi-year company-specific operating model. It explicitly does not establish a surprise versus Street consensus or a price forecast.

A simple illustration shows the missing valuation link. Assume a stock costs $150, earns $5 per share, and grows EPS 10% annually for five years. EPS reaches about $8.05. If the eventual multiple is 20 times earnings, the stock is worth about $161, only about **1.4% annual price appreciation**, before dividends, costs and taxes. The company can grow well while the investment disappoints. This is arithmetic under assumed inputs, not a stock forecast.

## Highest-value next steps

1. **Restore research trust.** Correct the missing-debt answer and null-history coercion. Repair full-build grade-research wiring and preserve enough evaluation history. Add a compact coverage view separating last collection, financial reporting period, source publication, missing inputs, and calculation version. Keep current forward outcomes separate from reconstructed history and from earlier policy versions.
2. **Build a long-term company file for a small priority universe.** Retain at least five to ten years where available of reconciled income, cash flow, balance-sheet and share-count history, plus the actual filing versions and publication times. Handle new issuers and accounting changes explicitly rather than filling gaps. Track dilution and stock compensation, debt maturities, cash runway, reinvestment and returns on capital. Choose the KPIs that matter to each business, such as retention, backlog, units, pricing or utilization.
3. **Connect business assumptions to value and expectations.** Add a three- to five-year operating and per-share model, bear/base/bull sensitivities, valuation methods suited to the business, and reverse valuation. Separate GAAP and adjusted estimates. Explain the disagreement with consensus or with the assumptions embedded in price. DCF is useful for some businesses; sector-appropriate alternatives are needed for banks, early-stage companies and other special cases.
4. **Make thesis monitoring explicit.** Store the original reason to own, source-linked evidence, the strongest opposing case, the few metrics that would disprove it, and the next review date. Compare each quarter with the frozen assumptions. A news-tone change or technical stop should not silently become a change to business value.
5. **Add holdings-aware risk.** Start with positions and weights, ETF look-through where available, common business drivers, sector/factor concentration, and a handful of transparent stress cases. Show loss in portfolio dollars and percent. Extend to derivatives only with the required instrument data and limitations visible.
6. **Buy data only for an identified research bottleneck.** A reliable normalized financial-history and estimate source is likely more useful for this goal than a faster tape. If systematic historical claims become central, prioritize corporate actions, delistings, dated universe membership and original macro/estimate vintages. Buy a narrow alternative dataset only when it answers a specific business question and its incremental value can be tested. Current vendor entitlements, server use and display rights would need checking before purchase; the review makes no price or subscription commitment.

The first improvements can use existing public disclosures. Public SEC and economic data are substantial inputs, though obtaining them still has engineering and operating costs. There is no need to recreate a high-frequency firm's infrastructure to improve this tool's long-term research quality.

## How I would use it today

Use the site to find a candidate and gather the evidence. Verify the decisive financial and management claims in the original filings and call material. Write a separate business and valuation case, including what the price already assumes and what would disprove the thesis. Check the proposed position against the whole portfolio. Then use Mingstreet to monitor that case over time.

That is a credible use of the current tool. Treating a high grade, a bullish narrative, an analyst target, or a long option expiry as a substitute for that work is not supported by this review.

## Source map

- Navigation: [site-map.mjs](../scripts/render/site-map.mjs).
- Primary collection, scores, company checklists and orchestration: [build.mjs](../scripts/build.mjs).
- Source clocks and publication controls: [quote-provenance.mjs](../lib/quote-provenance.mjs), [freshness-policy.mjs](../lib/freshness-policy.mjs), [datastore.mjs](../lib/datastore.mjs).
- Financial model: [earnings-forecast.mjs](../lib/earnings-forecast.mjs), [forecast collector](../scripts/refresh-earnings-forecast.mjs), [forecast design](earnings-forecast.md).
- Long-dated and combined scores: [leaps-score.mjs](../lib/leaps-score.mjs), [unified-signal.mjs](../lib/unified-signal.mjs).
- Evaluation: [grade-research.mjs](../lib/grade-research.mjs), [track-record-fills.mjs](../lib/track-record-fills.mjs), [backtest caveats](../scripts/backtest-picks.mjs).
- History: [source catalogue](../lib/historical-sources.mjs), [history calculations](../lib/historical-data.mjs).
- Full destination assessments: [data-stack-feature-review.json](data-stack-feature-review.json). Each assessment is a review judgment about its role in long-term research, not a measured forecast-accuracy score.
