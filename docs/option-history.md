# Real option history (DoltHub) and the engines' real-price re-test

Added 2026-11-19 (owner request). Research only: manual scripts, no
workflow, nothing in the bake, the private store or `data/`.

## Why

The 2026-11-19 strategy test series found the engines' option edge fails
once implied volatility comes from real Cboe indexes instead of a model. The
next question is what real listed prices (with their real bid-ask spreads)
say. DoltHub's `post-no-preference/options` database has daily end-of-day
bid, ask, implied volatility and greeks for about 2,300 US stocks and funds
since 2019, free and keyless.

**Terms:** the database states no license. Treat it as personal research:
the price rows stay on the machine that pulled them (both scripts refuse an
output folder inside the repo), and only aggregates are committed.

## The shared row shape

`lib/option-history/index.mjs` writes the shape agreed with the Webull
option-price saver (wave 2), so both sources are read by the same code:

```
{ date, symbol, underlying, expiry, strike, right, bid, ask, iv, delta, gamma, vega, theta, source }
```

`symbol` is the unpadded OCC symbol (`AAPL261218C00150000`), `right` is
`C` or `P`, `iv` a decimal, optional numbers may be null. Files:
`<dir>/<UNDERLYING>/<YEAR>.jsonl.gz`.

## Steps

```bash
# 1. The history test's closed option trades (trade-level, so outside the repo)
node scripts/engines-backtest.mjs --long DIR --dry --trades-out ~/research/engine-trades.jsonl
# 2. Real quotes (SQL API, or --dolt DIR for a local `dolt clone post-no-preference/options`)
node scripts/dolthub-options-pull.mjs --covered --from 2019-01-01 --out ~/research/option-history
# 3. Re-price and write the aggregates (research/engines-real-prices/latest.json)
node scripts/engines-real-prices.mjs --trades ~/research/engine-trades.jsonl --history ~/research/option-history
```

The pull keeps `_progress.json` in its output folder, so a stopped run
resumes; the current month is never marked done. The API mode pages 1,000
rows a query with a 1.5 s pause; the local clone is much faster for many
years.

## How a trade is re-priced

`lib/option-history/reprice.mjs`: each closed option trade from 2019 on is
matched to the real contract nearest the modeled one (same right, nearest
expiry within 10 days, nearest strike within 5%), on the entry date or the
nearest quote day within 3 days. Entry is the real **ask**. Two exits:

- **same window:** the real **bid** on the modeled trade's own exit date (or
  the last quote day before it);
- **real path:** the real mids after entry, against the setup's own
  take-profit and stop; a hit closes at that day's bid, otherwise the same
  window's exit.

Output (aggregates only): per engine and per setup (5+ trades), the modeled,
same-window and real-path averages, medians, win rates and t values, dollars
at $2,000 of premium a trade, both halves of the period, the median entry
spread, and the skip counts. Paper trials and test trades are kept apart.

## Tests

`node scripts/option-history-smoke.mjs` (offline). DoltHub was not reachable
from the build sandbox or the Mac VM, so the first real pull needs a machine
with open network (for example a Remote Control session on the Owner's Mac).
