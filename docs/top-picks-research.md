# Top Picks research: make the engine recognize setups

Research date: October 27, 2026. Branch: `Top-Picks-Research`.

Implementation update: the added Investment outlook and Trading outlook now
exist alongside the current Unified Signal views. See
[`unified-signal-engine.md`](unified-signal-engine.md#additional-perspectives-october-27-2026)
for the implemented coverage, methods, limitations, and checks. The remaining
opportunities below are research proposals, not claims that they were all built.

## Recommendation

**Scope clarified:** the user wants both investing and short-term trading, with separate conclusions. The recommended product is a shared stock assessment inside the existing Unified Signal Engine. It should evaluate price and business expectations for investing, and setups and execution for trading. Top Picks can later become the selective published output of the validated trading assessment. The four-pillar grade remains a baseline during comparison. See the final section for this broader design.

Keep the existing grade as a transparent baseline. Add a parallel way to discover specific trading setups across the covered universe, then evaluate their direction, entry, option economics, and portfolio overlap separately. Start with **a snapped losing streak followed by a confirmed reversal**, conditioned on volatility and peer behavior.

The opportunity is to recognize combinations and changes over time. Adding more isolated points to the four pillars would preserve much of the current rigidity. A reversal can begin while most backward-looking trend inputs remain negative. Conversely, five bullish observations derived from the same rally do not supply five independent reasons to buy.

This document proposes experiments. It does not establish that any proposed signal improves returns. No production scoring, contracts, publication, or execution has changed.

## What the engine already uses

The current path is `scoreAllTickers` → `scoreTicker` → existing score eligibility → bounded AI research and grading → `buildTopPicks` → entry, contract, and roster checks. The ranking remains deterministic. The AI can reject or hold back a candidate and has narrowly bounded entry-promotion authority. It cannot rescue a ticker that never enters its candidate set.

Verified in [the build source](../scripts/build.mjs), especially `scoreTechnicals`, `scoreTicker`, `aiGraderCandidates`, `generateAiTheses`, and `buildTopPicks`:

- **Price:** RSI, MACD, moving averages, basic active streak, support and resistance, 52-week position, and a capped standardized price-and-volume family.
- **Positioning:** aggressive options prints, a seven-day persistence fallback, open-interest skew, conditional short covering, and directional unusual volume.
- **Business and catalysts:** sector-relative growth, earnings, guidance, analyst changes, valuation, cash flow, company CapEx quality, financing and buybacks, and news.
- **Volatility:** own-history IV cost, realized-volatility comparison, a bounded term-inversion penalty, skew-aware strategy routing, and option-payoff stress checks.
- **Market and controls:** cross-asset regime and scenario constraints, event waits, structural vetoes, re-entry suppression, sector and factor caps, and entry readiness.
- **AI context:** Trending IV's one-, five-, and twenty-session changes and rising streak already appear in the final prompt. Earnings history, macro calendar, and options walls also supply context.

Two distinctions matter. Entry Timing already recognizes several reversal and pullback traits, but it is execution-only and does not create candidate conviction. Trending IV already reaches the AI, but it arrives after score-based admission. Neither is equivalent to a dedicated setup-discovery path.

The [Unified Signal Engine](unified-signal-engine.md) already gathers wider evidence and preserves decisions. Its direction and ranking still come from the existing grade. Reusing that evidence contract is useful. Feeding its conclusion back as another independent signal would be circular.

## CBRS: the hypothesis to test

Using the user's reported figures, IV of 89.7% versus a 95% historical average is **5.3 volatility percentage points below the average**, or about **5.6% lower in relative terms**. Those numbers describe a level difference. They do not establish an upward IV trend, a return to the average, or a bullish stock move.

The [Options Industry Council's vega explanation](https://www.optionseducation.org/advancedconcepts/vega) supports separating volatility exposure from stock direction. Rising IV can benefit a purchased call or put with positive vega, all else equal. Time decay, a stock move against the position, spreads, and an event-driven IV decline can offset that benefit. The [OIC's pricing discussion](https://www.optionseducation.org/referencelibrary/faq/option-price-behavior) also describes event-related repricing.

The proposed assessment would ask:

1. **Did a material losing streak actually end?** Read `lastEnded.color`, loss magnitude, same-direction sessions, break reason, reversal size, and sessions since the break. A one-day green move is not sufficient by itself.
2. **Is the reversal holding?** Look for a confirmed support hold or reclaim, an improving momentum slope, constructive volume, and a reachable invalidation level. Compare with similar failed bounces.
3. **What is IV doing now?** Combine its relative level with one-, five-, and twenty-session changes, percentile, dispersion, realized volatility, and event proximity. IV below its mean can still be rising, falling, or flat.
4. **Does the sector confirm?** Distinguish a company reversal from a temporary bounce during a broader industry breakdown.
5. **Which expression survives realistic stresses?** Compare eligible shares, a long call, a debit spread, and cash under a continued IV decline, flat IV, and an IV rise. Use the selected contract's expiry and IV, not just the ticker's interpolated ATM-30-day IV.

An appropriate research label could be “Early bullish reversal; premium below its recent average; IV recovery unconfirmed.” An actionable trade would still need the normal readiness and economics checks. A confirmed break of support should invalidate the reversal thesis even if IV looks inexpensive.

**Current-data limit:** the local Streaks and Trending IV snapshots are dated October 14, 2026. The local CBRS ticker, current grades and picks, IV-history directory, and private outcome files are absent. The user's 89.7% observation and current snapped streak have not been independently verified here. The older local snapshot cannot resolve today's trade.

## Ranked research opportunities

These priorities reflect engineering readiness and fit to the current trading horizon. They are not measured return forecasts.

### 1. Snapped streaks, moving-average reclaims, and reversal confirmation

**Already available:** `computeStreakForTicker` emits `lastEnded`, run magnitude, volume trend, recency, and `maContext` with 20-, 50-, 100-, and 200-session levels, slopes, and reclaim/loss events. `scoreTechnicals` reads only the active run for its streak vote: at least three same-direction sessions yields one point in that direction. Other technical and timing inputs partly overlap.

**Proposed use:** discover a reversal candidate before the old trend fully recovers. Preserve a state sequence: material decline → streak snapped → support held or reclaimed → confirmed reversal → invalidated or expired. Log each transition once rather than count every subsequent day as a new event.

**Test:** compare snapped streaks with otherwise similar declines that did not snap, then ask whether support confirmation adds value beyond the snap. Match on sector, market regime, decline size, prior grade, and volatility. Examine follow-through, adverse excursion, failed-bounce rate, and entry delay. Do not count RSI, MACD, streak, and MA reclaim as independent confirmations merely because they have different labels.

### 2. IV transition and trade expression

**Already available:** `buildIvTrendingPayload`, own-history IV ranks, Quant Lab term and skew history, realized volatility, and [`assessOptionEntryEconomics`](../lib/option-entry-economics.mjs). The latter already models IV down 20%, flat, and up 20%. Those are conditional stresses, not forecasts. Current eligibility relies on the flat-IV target scenario.

**Proposed use:** distinguish inexpensive-and-building premium, expensive-and-building premium, and post-event premium decay. Let this evidence affect vehicle selection and an experimentally validated setup assessment. Rising IV alone supplies no call-versus-put vote. Below-average IV alone earns no “will rebound” bonus.

**Test:** within the same reversal setup, compare low-level/rising IV against low-level/falling IV and ordinary IV. Evaluate actual selected-contract results where historical quotes exist. Otherwise report stock outcomes and modeled sensitivity separately. Test whether a trade requires IV to rise merely to cover time decay and transaction costs.

### 3. Sector and peer recovery

**Already available:** Sector Rotation recovery profiles, peer price series, industry grouping, and the `im21` experimental signal. Top Picks has peer comparisons, macro overlays, and portfolio caps, but those are different from a dedicated peer-recovery setup.

**Proposed use:** distinguish a leader reclaiming while its industry improves from an isolated bounce in a deteriorating group. Use leave-one-out peer returns and breadth so the stock cannot confirm itself. Freeze recovery reference levels at setup formation.

**Test:** same stock setup with and without peer confirmation, against sector-relative returns. Compare continuation and reversal regimes separately. A sector score built from existing grades is not independent business evidence.

### 4. Earnings aftermath and validated peer spillover

**Already available:** session-aware earnings reactions, surprise and guidance history, Quant Lab post-earnings drift, and the [Event Spillover Matrix](event-spillover.md). Upcoming earnings already constrain entries; some history already reaches the AI. The `pg` and `pe14` experimental signals log print guidance and upcoming qualified peer events.

**Proposed use:** recognize a post-earnings continuation after a sustained reaction, or raise event risk when a historically related peer is about to report. Positive read-through requires the event outcome and a validated relationship. An upcoming event count measures exposure, not direction.

**Test:** freeze relationship estimates before the event, respect before-open versus after-close timing, exclude contaminated windows, and report event counts. Small own-company earnings histories should remain low-confidence context. Event correlations do not establish causality.

### 5. Flow persistence and positioning transitions

**Already available:** aggressive flow, seven-day persistence, directional volume, options walls, and short-interest changes. Much of this already participates in the engine.

**Proposed use:** research *changes* in signed positioning around a setup, such as persistent buying after a reclaim, rather than add another copy of today's flow vote. Separate repeated detection of one contract from distinct contracts, new open interest, and distinct sessions.

**Test:** incremental value after existing mechanical signals, with quote and scan times preserved. Open interest does not identify the dealer's position or the buyer's intent. Gamma exposure is a model with positioning assumptions, so initially use it for path risk and nearby barriers rather than a new directional point.

### 6. Historical market regimes and analogs

**Already available:** long index and ETF histories, seasonality, event studies, macro context, and Pattern Lab studies. Individual-stock research history is much shorter. Market history does not supply decades of CBRS observations or historical options chains.

**Proposed use:** condition setup results on the market state and show sample distributions. Prefer “this setup behaved differently in high-volatility declines” over a generic seasonal bullish bonus.

**Test:** choose analogs using information available at the decision time, then evaluate their later outcomes. Recompute every historical feature from its trailing window. The current FRED cache includes revised data. Historical trading tests involving macro releases require publication lags and vintage data such as [ALFRED](https://fred.stlouisfed.org/docs/api/fred/alfred.html). Treat calendar seasonality as descriptive context until it survives independent validation.

### 7. Institutional accumulation and insider purchases

**Already available:** curated managers' latest and prior 13F holdings, share changes, filing/report dates, and Form 4 transactions. These do not currently form a Top Picks pillar. The wider evidence record includes ownership measurements.

**Proposed use:** use genuine, split-adjusted share additions, position-weight changes, and agreement across distinct managers as slow thesis context. For insiders, research clusters of code-P purchases separately from sales, grants, and exercises. A fresh public filing may be a catalyst; its quarter-end holdings are still old.

**Data preparation comes first:** current 13F per-manager tables retain the top 20 rows per side ranked by dollar-value change. A holding's value can increase with no new shares purchased. The evidence record's institutional piece reads `valueChange` from the truncated aggregate and can report zero for an unlisted name. The Form 4 display retains only 120 transactions across the universe. None of these absences is a verified per-stock zero. Preserve complete measured coverage and per-filing provenance before scoring ownership.

The [SEC's Form 13F FAQ](https://www.sec.gov/rules-regulations/staff-guidance/frequently-asked-questions-about-form-13f) explains the quarterly reporting lag of up to 45 days, excludes short positions, and notes that written options are not reported. Holdings therefore reveal an incomplete, delayed portfolio. “Managers increased holdings last quarter” is defensible when supported. “Managers are buying now” is not. Manager additions are not automatically independent and multi-strategy portfolios may be hedged.

**Test:** enter no earlier than actual public availability, compare with a sector and momentum control, and separate longer holding horizons from the roughly two-week Top Picks objective. Never backdate an ownership signal to quarter end.

### 8. Business inflections, transcripts, and supplier/customer evidence

**Already available:** company history and relationships, transcript briefs, company CapEx quality, RAM and GPU pricing, AI spending, commodity exposures, and earnings forecasts. Several existing pillar inputs already reflect the same guidance or news.

**Proposed use:** detect a dated change in outlook, margins, demand, or financing risk. Use supplier/customer relationships only when the mapping and economic sign are supported. RAM or GPU price changes can benefit one company and hurt another.

**Test:** retain original publication and first-seen times, compare against the existing guidance/news/growth signals, and avoid counting a transcript summary and its underlying headline twice. The earnings forecast is uncalibrated and does not establish a stock-price surprise or investable edge. Forward estimates and historical facts need separate identities.

### 9. Portfolio overlap and outcome feedback

**Already available:** sector/factor caps, a trailing-edge governor, open-position suppression, gate traces, modeled track record, and real-fill comparisons. Existing [`shadow-signals.mjs`](../lib/shadow-signals.mjs) logs seven experimental inputs without scoring them.

**Proposed use:** compare several qualified setups by incremental portfolio risk and later measured performance. Record blocked and rejected candidates as well as selected picks. A promising new semiconductor reversal may add little if the book already has the same exposure.

**Test:** distinguish modeled option marks from actual fills. Measure net expectancy, adverse excursion, drawdown, turnover, concentration, and opportunities missed. Win rate alone can reward a system that takes tiny profits and occasional large losses. Do not infer portfolio suitability without current positions and account constraints.

## Proposed decision design

The caller should supply a timestamped evidence snapshot and receive setup assessments, watch triggers, veto reasons, and eligible trade expressions. Each conclusion should identify its underlying observations.

**Evidence adapter:** join raw site observations once by ticker and availability time. Preserve source, unit, observation time, public-availability time, first-seen time, rule version, and common-source identifiers. Distinguish measured zero, unavailable, stale, and invalid inputs. Slow quarterly evidence and current options quotes need different freshness rules.

**Setup detectors:** pure functions over that evidence discover reversal, trend-pullback, and post-earnings continuation candidates across the universe. Initially, these write research-only results. A ticker may have multiple setup records with distinct sides or expiry conditions. Never merge opposing theses into one ambiguous score.

**Candidate union:** compare baseline grade-qualified names with setup-discovered names. A setup can reach research review even while its four-pillar total remains below today's cutoff. Missing or adverse slow context must remain visible. This path must not waive event waits, structural vetoes, readiness, liquidity, invalidation, or payoff requirements. Any future admission rule needs explicit validation rather than an unnoticed relaxation of today's grade threshold.

**Assessment:** evaluate direction, confirmation, contrary evidence, evidence coverage, and failure conditions per setup. Initially use explainable rules and report uncertainty. After sufficient timestamped outcomes accumulate, compare a simple regularized model with the rule baseline. Consider more flexible models only if they improve held-out results. Do not label an uncalibrated rubric as a win probability.

**Entry and expression:** retain a single owner for existing execution checks. Compare allowed instruments using current executable quotes, horizon, IV stresses, and net payoff. Shares and cash are useful comparisons even if the Top Picks roster remains options-only. A modeled conditional payoff is not expected return without a validated distribution.

**Roster and record:** apply portfolio constraints, publish eligible results at the existing decision windows, and archive the entire candidate snapshot before outcomes occur. Use the Unified Signal Engine's evidence and archive patterns, but never treat its grade-derived conclusion as new evidence.

Three approaches were considered:

- **Add points to the four pillars:** cheapest to build, but retains score saturation, correlated votes, and the early-reversal admission problem. Use only for isolated additions that show independent value.
- **Give all site outputs to an AI ranker:** flexible, but duplicate summaries, uncalibrated confidence, unstable ranking, and difficult replay make it a poor default. More prompt content does not solve provenance or validation.
- **Setup discovery with shared evidence and existing execution controls:** recommended. It can discover overlooked candidates while keeping each hypothesis testable. Its main costs are snapshot storage, data alignment, and adequate outcome samples.

## Validation before promotion

1. **Repair semantic inconsistencies in a separate implementation change.** The AI prompt still describes rich IV using legacy z/60th-percentile thresholds, while deterministic IV Cost and strategy routing use the shared richness rule. Make the prompt consume that same rule. Ownership evidence also needs full coverage and share-based semantics before it can vote.
2. **Freeze the baseline and experiments.** Predeclare the reversal detector, a small number of IV interactions, horizons, and primary metrics. Keep a record of every variant tried. [Bailey and colleagues' backtest study](https://sdm.lbl.gov/oapapers/ssrn-id2507040-bailey.pdf) illustrates why selecting the best of many historical variants produces misleading performance.
3. **Archive actual decisions.** Capture both 11:00 and 15:30 ET candidate universes, baseline totals, raw features, source ages, contracts, gates, model versions, and newly admitted candidates. `grades-daily.json` replaces the same date's row and is useful for exploratory diagnostics, but cannot reconstruct both decision windows. Existing unified snapshots extract evidence rather than archive every raw input.
4. **Separate horizons.** Use five and ten trading sessions as initial short-horizon studies and a separately specified fourteen-calendar-day trade simulation. The existing IC script's fourteen-*trading*-day result is different. Measure post-signal executable entries rather than assume a confirmed close could be bought before it was known.
5. **Replay without future knowledge.** Use chronological training, validation, and untouched test blocks. Purge overlapping label windows around boundaries. Cluster uncertainty by date and ticker, check different market regimes, and account for repeated experiments. Reconstruct pivot confirmation at the time it became knowable. Retain covered-universe membership and exclusions to disclose survivorship limits.
6. **Measure incremental value.** Compare baseline, baseline plus snap, plus confirmation, plus IV interaction, and plus peer context. Include newly discovered candidates and blocked candidates. Hold entry, sizing, exit, and transaction-cost assumptions constant so the change being tested is identifiable.
7. **Test options separately.** Stock-direction results do not establish option profitability. Use historical bid/ask and contract availability where retained. Apply fees and conservative slippage. Label theoretical Black-Scholes marks separately and do not synthesize historical IV from future information. Report sample size, uncertainty, failed entries, and sensitivity to costs.
8. **Run prospectively in shadow.** Log outcomes without changing the published roster or broker behavior. A few weeks can verify collection and replay, but may not supply enough independent reversals to establish an edge. Promotion requires stable held-out and prospective evidence across conditions, not a fixed calendar promise or one successful CBRS example.

The existing [`diagnose-grade-ic.mjs`](../scripts/diagnose-grade-ic.mjs) is a useful starting diagnostic: it measures whole-universe forward rank correlation and incremental shadow-signal correlation. It is not a complete executable-strategy backtest. Extend the snapshot and replay substrate rather than interpret its exploratory t-statistics as certification.

## First experiment and deliverables

Start with **snapped-loss reversal × IV state × peer confirmation**. It directly tests the user's example and mostly reuses existing calculations. Keep ownership as a later experiment after correcting its data coverage. Treat long-history macro studies as context until point-in-time reconstruction is available.

The first implementation should produce a private setup watchlist, exact feature snapshots, prospective outcomes, and a baseline-versus-challenger report. Each card should state what changed, the evidence against it, the trigger needed, invalidation, source freshness, and whether IV expansion is observed or merely a scenario. Keep experimental results separate from the public grade and production trade ledger.

Research artifacts in this branch:

- [`audit-top-picks-research.mjs`](../scripts/audit-top-picks-research.mjs): repeatable, provider-free source and local-data inventory.
- [`top-picks-research-evidence.json`](top-picks-research-evidence.json): ten observed source connections, source hashes, and local coverage as of the research date. Pattern checks establish source wiring, not predictive performance.

Reproduce the inventory with `node scripts/audit-top-picks-research.mjs --as-of=2026-10-27`. To save a new report, add `--out=<path>`. No complete historical performance comparison was possible with the private datasets missing locally. No improvement percentage or current CBRS trade recommendation is claimed.

## Broader product decision: assess the stock before selecting a pick

The user clarified that the goal includes both months-to-years investing and days-to-weeks trading. The earlier setup proposal addresses the trading half. It does not answer whether the current share price is attractive relative to the business.

**Recommended direction:** build a shared stock assessment within Unified Signal, with two independent horizon-specific conclusions. Compare it alongside the old grade before using it to power Top Picks. This adds a new decision capability without adding another disconnected navigation destination or prematurely replacing the production engine.

### What changes in the decision

Today, most evidence becomes a contribution to a common grade. The engine does read price: trend, levels, entry timing, valuation ratios, analyst targets, and option economics depend on it. The missing capability is a supported answer to “what assumptions justify this price, and are the plausible outcomes attractive at my horizon?”

For **investing**, begin with business economics: revenue drivers, sustainable margins, reinvestment, cash generation, balance-sheet obligations, and dilution. Estimate present value under explicit scenarios using an appropriate method, then compare it with today's price. A cash-flow valuation, a justified earnings multiple, and a bank valuation do not share interchangeable inputs. The [NYU valuation introduction](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/background/valintro.htm) explains the connection between cash flows, growth, risk, and value, including the uncertainty around estimates.

Also reverse the calculation: under stated margins, discount rates, reinvestment, and other assumptions, what growth would justify today's price? This is an implied requirement conditional on the model. It is not a unique observation of what every investor believes. Compare it with company history, feasible market size, disclosed capacity, and explicit external expectations where available.

For **trading**, estimate whether a defined setup has favorable outcomes at a specified short horizon after realistic costs. Use current price, confirmation, regime, catalyst timing, invalidation, historical follow-through, and option repricing. A long-term valuation gap alone cannot establish a two-week entry or an option payoff.

Never average these conclusions together. The same stock may be an attractive investment with a poor short-term entry, or an expensive investment with a qualified short-term momentum trade. Unavailable valuation or insufficient trade history must remain explicit.

### The user-facing assessment

Show observed price and its timestamp first, followed by:

- **Investment conclusion:** attractive at this price, watch for a lower price, unattractive under the stated assumptions, or insufficient evidence. Display the chosen horizon, scenario assumptions, estimated present-value range, separate future-price scenarios, thesis risks, and what would change the conclusion.
- **Trading conclusion:** qualified setup, wait for a specified trigger, invalidated, no demonstrated opportunity, or insufficient evidence. Display the precise horizon, entry and invalidation, setup outcome sample, contrary evidence, event risks, and eligible expression.
- **Change explanation:** price changed, business assumptions changed, a catalyst occurred, a setup confirmed or failed, or data became stale. A change in one horizon need not change the other.

For example, take a hypothetical company with a supported present-value estimate of $110–$130 under stated assumptions. A price of $90 and a price of $125 should lead to different investment assessments even if business quality is unchanged. Those estimates are not guaranteed liquidation values or price floors. Separately, a strong recent rally can leave a poor short-term entry at either price.

Use price thresholds derived from explicit required returns and uncertainty rather than a new hidden weighted score. Initial bear, base, and bull scenarios carry no invented probabilities. A probability-weighted expected return becomes appropriate only when the probabilities have a defensible empirical basis and calibration is checked.

### Reuse and gaps

[`full-year-valuation.mjs`](../lib/full-year-valuation.mjs) already models annual business sensitivities, EPS, an assumed exit P/E, conditional price returns, and the revenue growth required to support the current price under those assumptions. It is a useful starting workbench. It is not a full cash-flow valuation, a calibrated price forecast, or a general stock-purchase decision model. Its defaults and coverage limits must remain visible.

[`unified-signal.mjs`](../lib/unified-signal.mjs) already joins evidence, quotes, scenarios, and execution. Its current `valuation.intrinsicValue` is null, `valuation.status` is `not-estimated`, and `uncertainty.expectedReturn` is null. Its direction still comes from the existing grade. Extend the shared observations and presentation, but implement the new investing conclusion independently from that grade. Otherwise the feature would simply rename the current system.

The four-pillar grade can remain useful as a transparent signal summary. It should eventually be one diagnostic input rather than the sole admission and ranking authority for both horizons. AI can extract dated evidence, challenge assumptions, and explain changes. The financial calculations, freshness rules, and execution checks should be reproducible.

### Build order

1. Create one assessment prototype with separate investment and trade conclusions for a small, explicit cohort with supported financial history. Reuse the full-year workbench and existing evidence; do not imply whole-universe coverage. Show a case where the two conclusions disagree.
2. Freeze the assessment inputs and scenarios. Evaluate financial forecasts against later reported results, valuation assumptions against later developments and returns, and trading setups against executable outcomes. Keep these evaluation targets separate.
3. Run the new conclusions beside the existing grade. Compare missed opportunities, false positives, net trading outcomes, data coverage, and stability across conditions. Long-horizon conclusions require longer observation; short-term results cannot validate them.
4. If the short-term challenger demonstrates incremental value, migrate Top Picks candidate selection and ranking deliberately. Retain the existing execution controls, archive the model version, and preserve historical comparisons.

Replacing the grade with a larger AI prompt or a new weighted score would not by itself solve the price question. A full rebuild now would also combine valuation, data preparation, and execution migration before the new decision process is proven. The preferred path is a new assessment capability in the current research workflow, followed by evidence-based migration of Top Picks.
