# Webull Test review

Track Record → Webull Test has four saved views. Side, structure, engine run,
open/closed status and entry-date range apply to every view.

- **Performance:** cumulative realized paper dollars, a comparison with the
  engine on complete matched price pairs, a matched SPY option comparison,
  closed-trade dollar drawdown and a
  distribution of option returns. Dollar metrics use recorded filled quantities
  when available, with one contract for the original ledger format. These are
  realized trade results, not account equity or open-position marks.
- **Accuracy:** trailing 20-trade option win rate and stock direction accuracy,
  win rates by structure, side, AI grade, conviction tier, sector, entry regime
  or engine run, and entry probability versus realized profitable exits. The
  probability chart is diagnostic because the exit policy can differ from the
  model's probability horizon. A zero-return trade is not a win.
- **Engine:** current execution states, entry/exit price gaps and a model versus
  paper return scatterplot. Price gaps are credit-aware; positive means worse
  execution than the corresponding engine price. Return errors use percentage
  points. Only paired closed returns contribute to model-error metrics.
- **Trade log:** prices and quantities, manual provenance, emergency use, and CSV.
  Each trade has an expandable history of every order attempt. It separates
  modeled reference, limit, actual execution, broker status, cancellation request,
  quotes, and timestamps to the second. An unconfirmed emergency remains labeled
  as an attempt. A partially filled emergency states that exposure remains open.
  A second disclosure shows cumulative broker observations and order actions.
  The order-attempt CSV retains those snapshots separately from trade totals.
  Missing quotes and invalid-price decisions remain visible even without an order.

The view states its closed sample, joins to saved picks and missing fee coverage.
It excludes open, missed, unsettled and broker-review trades from performance
and accuracy. New quantity-aware records must have positive filled quantities
and matching closed quantities. Legacy records without quantity fields retain
the original one-contract interpretation. Time charts require paper close
timestamps, and drawdown remains unavailable if any included closed trade
lacks that timestamp. Undated verified outcomes remain in aggregate totals.
Unknown prices and unmatched model observations do not become zero returns.
Manual fills show their actual price above, below, or equal to the original
model. An earlier automatic miss remains in the automatic fill-rate denominator
after manual recovery, while manual entry prices and timing remain excluded
from automatic-entry statistics. Subsequent automated exits retain their data.
Fee estimates are deducted when recorded. The bid/ask scenarios remain
hypothetical. CSV `entry_slippage_pct` and `exit_slippage_pct` use the same
adverse direction as the screen: positive is worse execution. Separate
`entry_price_difference_pct` and `exit_price_difference_pct` retain literal
above-or-below price changes, including manual fills. Charts expose exact values in expandable data tables; bar labels
include their counts or rates directly.

The Owner-only `/api/auth/webull-mirror` response is joined by normalized trade
ID to the existing accuracy record. `lib/webull-analytics.mjs` owns the derived
metrics; `scripts/render/webull-review-client.mjs` renders the charts. Both are
serialized into the generated `app.js`. No new data fetch, broker mutation, AI
call, database or chart dependency is introduced. The Refresh trades button
re-reads the existing mirror endpoint.

Paper books is retired from the UI, tab registry, renderer and saved controls.
Existing research generation and stored history remain available to other users
of that data. A device with the retired tab saved falls back to Summary.

## Local verification

Run `npm run regen:webull` after editing these templates. It preserves the
published research snapshot and embedded risk-free-rate provenance. Then run `npm run test:webull-analytics`,
`npm run test:render`, `npm run test:webull-mirror` and
`npm run test:track-record-fills`, and `npm run test:webull-browser`.

`npm run preview:webull` serves the generated site at
`http://127.0.0.1:4178/?tab=track` with a persistent synthetic-data banner.
Open Webull Test to exercise the charts, filters and reload persistence. This
read-only preview uses only synthetic API responses, binds to loopback, reads
no credentials and never contacts the broker. It does not verify a deployed
account's current ledger or change production authentication.

The preview also supports `previewCase=execution`, `previewCase=edge`, `previewCase=empty`,
`previewCase=open` and `previewCase=retry` in its URL. The edge case covers
partial fills, broker alerts, missing close dates, archived grades and unusual
cohort names. The execution case derives the displayed trade data and CSV from
a synthetic ledger, with three manual recoveries, an unfilled emergency, and a
confirmed emergency exit. It never represents the account's actual fills.
The retry case fails its first mirror request, then allows the
Retry button to recover. These cases never change production data.
