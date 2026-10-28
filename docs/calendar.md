# Calendar sources and coverage

The calendar follows `TICKERS` in `scripts/build.mjs`. Earnings coverage counts
stocks, excluding ETFs. Removed symbols are filtered during generation,
regeneration, browser hydration, and the Events by day chart. Nasdaq can recover
an earnings date even when a ticker's option-chain fetch fails.

## Event sources

- Earnings dates come from Yahoo fundamentals and a Nasdaq sweep over the next
  21 calendar days. Nasdaq also supplies sessions for explicitly known dates
  farther out. A provider date is not an issuer confirmation.
- News-derived company catalysts require the dated-news evidence accepted by
  `currentCachedCatalysts`. The calendar retains the article URL, publication
  time, and date evidence. Identical titles for different stocks stay separate.
- BLS, BEA, Census, and ISM provide official release schedules. Census adds
  retail sales, housing, construction, inventories, trade, and manufacturing
  releases. ISM adds Manufacturing and Services PMI.
- The Federal Reserve Board calendar provides speeches, testimony, press
  conferences, minutes, the Beige Book, and selected statistical releases.
  The live FOMC schedule merges with the existing published baseline.
- ForexFactory's existing weekly feeds also provide explicitly dated jobless
  claims, ADP, confidence, sentiment, flash PMI, housing, energy inventories,
  and selected Treasury auctions. These additions cover this week and next
  week. They do not create long-range recurring dates.
- The existing NYSE session calendar supplies closures and early closes for
  its verified years, 2026–2028. Federal Reserve holidays are labeled separately
  because a Fed holiday need not close the stock market.
- The [FEC's published 2026 calendar](https://www.fec.gov/documents/5910/2026pdates.pdf)
  supplies the November 3 midterm election date. It does not infer special
  elections or fiscal deadlines.

Published report dates take precedence over cadence estimates when a report
family has one unambiguous date in that month. Figures attached to a displaced
date are cleared. Baseline dates without live confirmation are labeled
Estimated date. Macro headlines represent observed publications, not future
scheduled events.

## Failures and limits

The coverage panel shows missing earnings dates, missing ticker inputs, source
failures, incomplete Nasdaq requests, weekly-feed failures, recent catalyst-review coverage, cached report
series, and snapshots older than 96 hours. Missing earnings dates can mean
already reported, not announced, outside the horizon, or unavailable input.

Failed official schedules retain their upcoming prior rows as stale. Missing
detailed report series retain prior rows and chart history independently, so
a successful weekly feed cannot erase a failed monthly series. Prior rows
cannot override a changed official date.

ISM can return an HTTP-200 CAPTCHA. In that case the calendar uses its
[published 2026 table](https://www.ismworld.org/supply-management-news-and-reports/reports/rob-report-calendar/),
verified October 28, 2026, and labels those rows stale. The source status still
reports failure. The baseline does not extend into unverified years.

The calendar does not claim exhaustive coverage of unscheduled policy news,
corporate filings, dividends, splits, shareholder meetings, options expirations,
foreign central banks, every Treasury auction, or every company catalyst.
News-derived catalysts can disappear when their evidence ages out. An empty
day cannot establish that no material event will occur.

## Verification commands

`npm run test:calendar` runs offline ingestion, universe, date, recovery, and
generated-JavaScript checks. The daily workflow runs this before the bake.

`npm run test:calendar-browser` checks desktop and mobile filters, catalyst
links, export, coverage warnings, stale snapshots, and load failures with
synthetic events. `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` select an existing
browser installation when needed.

`npm run audit:calendar -- --live --sources --output=/tmp/calendar-audit.json`
reads the published calendar and exercises official source adapters. It does
not publish data, call AI, or change schedules. Without `--live`, the audit
reads `data/calendar.json`; `--input=PATH` selects another snapshot.

`node scripts/regen-calendar.mjs` rebuilds calendar data from hydrated ticker
inputs. It rejects a directory with no current-universe inputs. Regeneration
also updates the existing FedWatch and prediction histories.

## October 28, 2026 verification

The published snapshot, built October 27 at 20:12 UTC, covered the current
85-symbol universe with no removed symbols. It contained 55 earnings events,
one company catalyst, detailed reports, Fed events, FOMC decisions, and macro
headlines. The local September snapshot was older than the published
store and was not evidence of a live outage.

The official-source audit retrieved BLS, BEA, Census, and Fed schedules. Census
returned 30 upcoming rows through year-end before cross-source deduplication.
ISM's Node response was a CAPTCHA; its published HTML parsed as 24 PMI rows
when retrieved separately. The dated fallback supplies the remaining
November and December Manufacturing and Services events while preserving the
failure warning. Browser checks use synthetic data and do not establish a
production deployment. No new paid feed, AI request, or schedule was added.

A second live check at 19:02 UTC found 52 upcoming earnings events, 45 report
rows, eight Fed or FOMC events, three macro headlines, and zero company
catalysts. The [17:30 UTC build](https://github.com/lilseancoc-png/stonks/actions/runs/40736316018)
completed ticker judgments for 85 of 85 symbols and reported healthy AI calls.
That establishes the extraction pass ran; it does not establish that every
upcoming company event was present in the supplied news or passed date
validation. New coverage metadata distinguishes a recent successful review
with an empty result from a missing review or fallback news.

## Published company schedules

`lib/company-events.mjs` supplies 12 verified milestones across seven tracked
companies, independently of short-lived news. Dates were checked October 28,
2026 against issuer pages:

- [Oracle AI World](https://www.oracle.com/ai-world/): October 25–28 in Las Vegas.
  The current page takes precedence over an older Oracle PDF with different dates.
- [Apple iPhone Duo](https://www.apple.com/newsroom/2026/09/apple-unveils-iphone-duo/):
  September 9 announcement, October 16 pre-orders, October 23 initial release,
  and October 30 availability in 28 additional markets.
- [Microsoft Ignite](https://sponsor.microsoft.com/): November 17–20.
- [AWS re:Invent](https://aws.amazon.com/events/reinvent/faqs/): November 30
  through December 4, plus the separately published December 1 CEO keynote.
- [NVIDIA GTC Washington](https://www.nvidia.com/gtc/dc/faq/): December 1–3
  conference and expo, plus the December 1 keynote at 14:00 ET. Workshops on
  November 30 are not presented as the conference's first day.
- [Snowflake Expedition](https://www.snowflake.com/en/expedition/): November 3–6
  regional livestreams.
- [Salesforce Dreamforce](https://www.salesforce.com/dreamforce/register/):
  September 15–17.

These are selected schedules, not full issuer-calendar coverage for every
stock. Existing news extraction continues across the full tracked universe.
Company events retain 90 days of history. An ongoing conference remains
visible after its first day, and past launches are labeled Past. No next-year
date is inferred from an annual pattern.

The existing bake and calendar regeneration check the registered issuer pages
with four concurrent requests and a ten-second limit per page. Successful
checks reuse their state for 24 hours. Explicit Schema.org Event metadata can
update dates or cancel/postpone an event. Those changes persist through cache
reuse and network failures. HTML without structured event dates does not
reconfirm or modify the manually verified dates. Source access failures are
shown; they do not erase the last published schedule. Adding or correcting a
manually verified edition requires updating the registry and its version.

Company events remain under Catalysts. Detail chips wrap full titles, identify
past/ongoing/upcoming status, show the published span, and link to the issuer.
CSV export includes only the viewed month and active event type, with date
ranges and source links. The activity chart counts every day of a multi-day
event and labels its totals as event appearances. Phone filters wrap instead
of clipping, and the dense activity chart scrolls instead of overlapping labels.

The company-source check retrieved seven of eight registered pages. Snowflake's
page was unavailable to the Node request; its manually verified schedule was
retained with a source-check warning. Browser QA passed at 1440px and 390px in
light and dark themes, including the Oracle span, iPhone release history,
month navigation, readable titles, issuer links and month-scoped CSV exports.
Calendar, render, export, Owner Lab, news and brief regression checks passed.
`node scripts/calendar-preview.mjs` opens a read-only local company-schedule
preview using the published dates, with no production data publication.
