# News accuracy and regression evaluation

Evaluation completed on `news-label`, based on `main` at `950672f6d`. This review checked the new source adapters and the existing news-label safeguards; it did not publish a build or call a paid model.

## What the accuracy numbers mean

The reference set contains 72 captured titles from the five official issuer feeds, 32 authored direction cases, 14 scoring-support cases, and 11 catalyst-date cases. Titles span June through October 2026. The issuer test evaluates event classification independently of the seven-day ingestion window. Ten titles meet the narrow material-event policy; 62 fall outside it. Excluded product and generic partnership announcements can still be relevant news through the existing general feeds.

The reference labels were reviewed by this assistant before the fixes, then used to diagnose and repair the implementation. This is a development evaluation, not a blind holdout, independently double-reviewed dataset, provider factual-accuracy rating, or measurement of trading returns. The before figures describe the initial uncommitted `news-label` implementation at the start of this review. They do not describe production or `main`.

The runner also checks 16 energy fields from captured EIA data and four fields from a captured historical FDA original approval. These are extraction/reconciliation checks. The FDA case replays the 2010 AXIRON application at a historical date to exercise the positive parser path. It is not presented as a current approval or proof of historical commercial rights.

## Results

- Issuer event labels improved from **69/72 to 72/72**. The filter previously missed the quantified AMD deployment partnership and Lilly's FDA indication announcement, and mislabeled a clinical result as regulatory. Material-event admission improved from 8/10 to 10/10, with no out-of-policy titles admitted in this set.
- Headline direction agreement improved from **13/32 to 32/32** on the difficult wording cases. These target negation, past-tense verbs, mixed outcomes, primary endpoints, and contract results. Their deliberately difficult mix is not an estimate of the production error rate.
- Scoring-support decisions improved from **6/14 to 14/14**. Citing an article about contracts or guidance no longer validates an invented outcome. A forecast above analyst consensus cannot validate a management-guidance increase.
- Catalyst-date decisions improved from **4/11 to 11/11**. Wrong-year references, historical mentions, cancellations, and unsupported dates are rejected.
- The 16 energy fields and four historical FDA fields passed. The final offline evaluation therefore passes **149/149 reference checks**.

Machine-readable comparison, initial failures, dataset hash, and live check results are in `docs/news-accuracy-results.json`. The full expected labels are in `scripts/fixtures/news/reference.json`. The dataset hash lets another reviewer identify the exact reference set used.

## Source reconciliation

The live check at **2026-10-24 05:41 UTC**, October 23 Pacific time, reached all eight reviewed endpoints successfully. The current eligible events were one Lilly clinical announcement and two EIA releases. No recent qualifying original FDA approval was returned. Four of the five issuer feeds had no fresh in-policy event, which is a valid empty result.

- Gas storage was 3,644 billion cubic feet versus 3,567 previously, a change of +77, for the week ending October 16, released October 22. Those values match the [EIA table and summary](https://ir.eia.gov/ngs/ngs.html).
- Crude inventories excluding the Strategic Petroleum Reserve were 412,517 thousand barrels versus 415,577, a change of -3,060, for the week ending October 16, released October 21. They agree with the [EIA summary](https://ir.eia.gov/wpsr/summary.txt) after its rounding to millions: 412.5 million and a decrease of 3.1 million. The JSON fields retain their original precision.
- FDA's [Drugs@FDA documentation](https://open.fda.gov/apis/drug/drugsfda/) states that this API updates daily on weekdays. It is a reconciliation source and cannot establish a guaranteed real-time alert or every future decision date. The positive parser replay checks the exact sponsor/application/date/status fields from the captured original-approval record.

This reconciles published values and field meanings. It does not independently establish the factual truth of issuer announcements, drug efficacy, economic causation, or publisher-wide accuracy.

## Bugs and logic repaired

1. **Unsupported scoring claims.** Headline topic and word overlap could validate a nonexistent contract win or guidance raise. Claims now require an explicit compatible outcome before attachment, cache restoration, and scoring. Guidance versus prior management guidance stays separate from analyst expectations. Failed combined refreshes cannot restore earlier structured claims.
2. **Unsupported catalyst dates.** A month/day match accepted a date from another year or a cancelled event. Validation now checks the year, active schedule, supporting event words, publication age, and quoted date clause. Old cached entries that predate this validation are dropped.
3. **Negated and mixed headlines.** Denied approvals, negated recalls/investigations, contractions, past-tense guidance, and a dismissal alongside a recall could be mislabeled. Independent clauses retain mixed outcomes; negated actions are not treated as realized events. Keyword labels still describe wording, not predicted stock direction.
4. **Issuer event type and materiality.** Clinical outcomes have their own class. Explicit FDA indication announcements, quantified deployment partnerships, selected executive changes, and dividend changes are retained. Routine product, attendance, and generic partnership noise remains excluded by the narrow policy.
5. **Durable event history.** A correction that reverted to an earlier value disappeared from the revision trail. Reversions are now recorded. Canonical issuer URLs remove tracking variants and duplicate entries. Future cached rows cannot survive as historical evidence. Label-policy changes invalidate older parsed caches, and official context is restored solely from that validated store.
6. **Numeric/date boundaries.** Old EIA periods behind a fresh header, malformed observation dates, negative inventories, malformed FDA dates, and missing submission identifiers cannot become current records. Healthy unchanged responses clear earlier outage errors. Missing or stale headline support cannot create numeric neutral evidence.
7. **UI error and filter states.** Empty results with unavailable/incomplete sources now show a coverage warning. Invalid payloads produce an error instead of a quiet slate. Earlier data remains visibly dated after refresh failure and recovers on retry. Distinct release events sharing a landing-page URL stay visible under either sort. A removed category cannot remain an invisible active filter. Per-source check status and timestamps are available in the News page.
8. **Stale presentation and a flaky test.** Remaining recommendation sections no longer display stale or unknown sentiment as a current directional read. The older options-entry assertion was reproduced at an Eastern evening clock and traced to its UTC-based test date. The fixture now uses the Eastern market date; both pinned clocks pass. No production options thresholds changed.

## Validation

- 135 dedicated news regression checks and 149 offline reference checks passed.
- 524 Top Picks checks passed. Entry-policy checks passed normally and at pinned clocks `2026-10-24T01:25:00Z` and `2026-10-24T05:41:00Z`.
- Calendar, capital raises, sector rotation, narrative risk, story detection, evidence records, rendering, AI-call efficiency, private-store access, data hydration, and freshness checks passed.
- The generated page passed browser interaction at 1366 px and 390 px in light and dark themes. Checks include search, macro/category filters, sorting, resize transitions, date-only values in Eastern and Pacific/Kiritimati time zones, source-health details, same-link releases, unavailable/partial/empty/malformed states, and refresh recovery.
- Generated browser JavaScript passed syntax checks. Only the News HTML section and app asset hash changed in the shell; embedded data and other HTML desks were preserved. The original dirty checkout was kept separate.

## Remaining limits and release decision

Keep the new feeds context-only. This review does not justify promoting them into grading or trading. Five official issuer mappings and one FDA sponsor mapping do not establish coverage of the whole universe. No current positive FDA sample was available to measure live approval precision/recall.

No per-ticker production news snapshots were available in the local checkout for independently comparing actual model-generated paragraphs and sentiment labels. The paid model was not rerun. This evaluation measures deterministic safeguards and reference-label agreement, not production model accuracy. Headline grammar, entity attribution, financial materiality, and event dates can remain ambiguous. Conservative validation can omit a legitimate claim when only an article body supports it.

Before grading promotion, use a larger independently annotated sample of accepted and rejected records, preserve a blind holdout, and measure per-source ticker attribution, event type, dates, duplicates, materiality and claim agreement separately. Retain a separate production-model sentiment benchmark. Do not turn this development set's perfect agreement into an accuracy percentage shown to users.

## Reproduce

Run `npm run test:news`, `npm run test:news-accuracy`, and the affected regression commands in `package.json` with the project's normal dependencies installed. The accuracy runner itself needs no paid service or network. The existing full-build workflow runs both news checks before the data build; no new schedule is added.

`node scripts/news-source-check.mjs --live` performs the bounded free source check and writes its report to the operating system's temporary directory. `node scripts/regen-news.mjs` regenerates the News shell and browser script. `scripts/news-browser.mjs` requires an installed Playwright/browser runtime; `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` can select existing installations.
