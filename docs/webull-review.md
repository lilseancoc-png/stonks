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
- **Trade log:** the existing ledger details and CSV download.

The view states its closed sample, joins to saved picks and missing fee coverage.
It excludes open, missed, unsettled and broker-review trades from performance
and accuracy. New quantity-aware records must have positive filled quantities
and matching closed quantities. Legacy records without quantity fields retain
the original one-contract interpretation. Time charts require paper close
timestamps, and drawdown remains unavailable if any included closed trade
lacks that timestamp. Undated verified outcomes remain in aggregate totals.
Unknown prices and unmatched model observations do not become zero returns.
Fee estimates are deducted when recorded. The bid/ask scenarios remain
hypothetical. Charts expose exact values in expandable data tables; bar labels
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

Run `node scripts/regen-static.mjs` after editing templates, with the existing
local data hydrate available. Then run `npm run test:webull-analytics`,
`npm run test:render`, `npm run test:webull-mirror` and
`npm run test:track-record-fills`.

`npm run preview:webull` serves the generated site at
`http://127.0.0.1:4178/?tab=track` with a persistent synthetic-data banner.
Open Webull Test to exercise the charts, filters and reload persistence. This
read-only preview uses only synthetic API responses, binds to loopback, reads
no credentials and never contacts the broker. It does not verify a deployed
account's current ledger or change production authentication.

The preview also supports `previewCase=edge`, `previewCase=empty`,
`previewCase=open` and `previewCase=retry` in its URL. The edge case covers
partial fills, broker alerts, missing close dates, archived grades and unusual
cohort names. The retry case fails its first mirror request, then allows the
Retry button to recover. These cases never change production data.
