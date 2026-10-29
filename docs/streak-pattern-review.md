# Streaks and Pattern Lab verification

The review covers the Streak-Expansion changes integrated with main through
`23acc4f23`. It checks calculations, data boundaries, browser behavior, and
compatibility with existing snapshots.

## Data and calculation checks

A read-only Yahoo audit downloaded two years of AAPL and SPY daily prices.
Each returned 500 conservatively confirmed sessions from October 28, 2024,
through October 26, 2026. The scoring window contained 251 sessions.
Independent arithmetic matched the 20-, 50-, 100-, and 200-session averages,
percentage distances, five-session slopes, and direction-adjusted study
baselines. The live audit passed 34 checks. A separate audit of 17 cached
market histories passed 289 checks. These samples do not establish complete
coverage of every tracked stock or production refresh success.

The production adapter receives the longer research series. Existing scoring
and overnight consumers receive the one-year window. Raw research arrays are
excluded from the public per-ticker payload. Coverage lists actual dates,
observation counts, and exclusions from the divergence study. Index
seasonality retains the shared long-history source and the S&P 500 index
option added on main.

The review reproduced and fixed missing sentiment being interpreted as zero,
completed POSTPOST bars being discarded, mismatched peer sample counts in
exports, saved filters returning after Reset, and a race between opening the
snapped panel and changing filters. Earlier regression cases cover flat-day
counter resets, immaterial breaks hiding material snaps, compounded returns,
and pre-market retention of the prior completed close.

## Browser checks

Streaks and Pattern Lab pass at 1440, 768, and 390 pixels in both themes.
The checks exercise filters, numeric table sorting, exports, saved choices,
keyboard controls, vertical snapped scrolling, collapsible panels, MA details,
Grade navigation, failed-request retries, and older payloads. Pattern Lab's
peer tables, charts, and CSV use the same timing-specific sample count.

## Reproduce the checks

Run these commands from the repository root:

```sh
npm run test:streaks
npm run test:pattern-lab
npm run audit:streak-pattern
npm run audit:streak-pattern -- --live
npm run test:streaks-browser
npm run test:pattern-lab-browser
```

Browser checks require Playwright and Chromium. `PLAYWRIGHT_MODULE` and
`CHROMIUM_PATH` select existing installations. The audit writes its JSON
report to the system temporary directory. The `--live` option makes two
read-only chart requests and makes no model or broker calls.

The merge publishes browser assets. New MA fields and two-year research
histories populate on the next full data build. No full paid-data generation
or broker operation was performed during this review.
