# Macro, cycle and rotation backtest

Research scripts behind `lib/macro-context.mjs` and `lib/macro-weights.json`
(Top Picks, `PICKS_MACRO_CONTEXT`). They read the long-history download
(`research/long-history` on the `backtest-data-long` branch: daily bars and
FRED series since 2007) and never touch the private store or the site.

| Script | What it does | Run time |
|---|---|---|
| `run.mjs` | Walk-forward test on 25 sector and industry ETFs, weekly 2008-2026: same-period fit, 1-12 week forecasts, weights by environment, market-level outcomes by cycle, Fed / rotation / systemic detectors. Writes `etf-results.json`, `states.json`, `walkforward-gammas.json`. | about 30 s |
| `stocks.mjs` | Applies the ETF-learned weights to the covered stocks, weekly 2008-2026, by environment; optional 2026 check against saved daily grades (`--grades`, private, not in the repo). Writes `stock-results.json`. | about 1 min |
| `engine-replay.mjs` | Replays the price half of the grade (technicals and mechanicals the bars can rebuild) every 5th session; `stocks.mjs` then compares the top picks with and without the macro fit. Needs a scratch engine copy (see the file header). | about 10 min |

```bash
node research/macro-backtest/run.mjs --data <long-history dir> --out <dir>
node research/macro-backtest/engine-replay.mjs --eng <scratch engine> --data <long-history dir> --out <dir>
node research/macro-backtest/stocks.mjs --data <long-history dir> --out <dir>
```

Refreshing the shipped weights: rerun `run.mjs`, then copy
`gammas["10"].global` (in `feats` order) into `lib/macro-weights.json` and the
`pointsScale.scalePerPoint` from `stocks.mjs` into `scale`.

Limits: the 85 covered names are today's survivors (the sector ETFs are the
clean universe); FRED values are today's revised vintages with publication
lags applied; the replay covers the price half of the grade only and measures
the stock's move, not option P&L; the sector playbook was written with
hindsight.
