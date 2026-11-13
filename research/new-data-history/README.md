# New data into the engines: history test

A one-off check of the newer inputs on the free history that exists for them
(plan item B, 2026-11-12). The shadow log only started on 2026-11-09, so this
answers early which inputs are worth waiting for. It changes nothing on the
site.

Run it on a machine with open internet (the build sandbox blocks FINRA,
Wikimedia, CFTC and FRED), from the repo root, Node 20+ after `npm install`:

```bash
node research/new-data-history/run.mjs --out research/new-data-history/results
```

Options: `--days 250` (sessions of per-name history), `--cache <dir>` (raw
downloads, reused on a rerun; default `./.new-data-cache`, git-ignored),
`--gauge-from 2010-01-01` (start of the market-gauge history).

It reads only free, keyless public sources (Yahoo daily bars, FINRA daily
short-sale volume files, Wikipedia page views, the CFTC financial futures
report, FINRA margin statistics (the page's 12-month table plus the full
workbook it links, every month since 1997), FRED `BAA10Y`), makes no AI call, never
touches the private store or the Track Record, and writes aggregates only to
`results/latest.json`:

- `perName`: per input (`sv`, `svz`, `wkr`) and horizon (5 and 10 sessions),
  the mean daily cross-sectional rank IC, both halves, t from non-overlapping
  days, the share of positive days, and the partial after 21-session momentum.
- `gauges`: each market gauge's rank correlation with SPY's next 10 sessions on
  non-overlapping windows, with halves.
- `positioning`: SPY's next 10 sessions by the Regime Lab crowd and credit
  labels, on the inputs that have history.
- `notTested`: the inputs with no free history, and why.

Read it against the Evidence tab's pass bar (10-session IC 0.03+, same sign in
both halves, 0.02+ after the control). A pass here is a reason to keep watching
an input in the live shadow log, not a reason to score it.

## Results, 2026-11-13 (`results/latest.json`)

Run on a Mac with open internet; every download came through (291 FINRA
short-sale files, 74 Wikipedia names, CFTC since 2010, FINRA margin history
since 1997, FRED Baa spread).

- **Per-name inputs, one year (83 names, 250 sessions): none passes.** Short
  volume share (`sv`) 10-session IC -0.017, its z-score (`svz`) -0.008,
  Wikipedia views (`wkr`) +0.006, all far under the 0.03 bar and none
  steady in both halves. Keep logging them; nothing to promote.
- **Market gauges vs SPY's next 10 sessions, 2010 on (about 400 windows):**
  asset managers' S&P 500 futures z -0.06 and leveraged funds' z +0.06, each
  with the same sign in both halves; margin debt y/y -0.03 (no read); the Baa
  spread +0.06 (wider spread, slightly better SPY after, stronger in the
  second half). Small, but the two COT reads and the Baa spread are worth
  watching in the live log.
- **Positioning labels (non-overlapping windows):** "washed out" 14 windows,
  SPY +0.87% on average, up 57%; "neutral" 379, +0.50%, up 62%; "crowded" 5,
  -1.04%, up 40%. Credit "stressed" 58 windows, +1.38%, up 69%; "watch" 99,
  +0.11%; "normal" 170, +0.47%; "tight" 97, +0.39%. Stressed credit came
  before better-than-average SPY returns, as expected near lows; the crowd
  extremes are too rare (14 and 5 windows) to read.
- Not testable on free history: implied borrow, the pledge and leverage
  distress keys, insider buying, put/call (Cboe's free archive stops in 2019)
  and Kalshi odds. They wait for the live shadow log (about 40 trading days).
