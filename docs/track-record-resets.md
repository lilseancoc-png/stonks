# Track Record log wipes

Track Record has separate red **Wipe Webull record** and **Wipe on-site record** controls. Each confirmation offers 1D, 1W, 1M, 3M and Wipe ALL. The default is 1D. A server preview shows exact UTC bounds and matching log counts. Changing the tracker or period clears the required “100% sure” checkbox. Cancel and Escape before submission leave storage untouched. Success reloads the page; failures retain the dialog and require confirmation again.

The periods are rolling elapsed windows of 24 hours, 7 days, 30 days and 90 days, inclusive at both ends. All covers entries through the preview's end time. Trades are selected by their saved entry timestamp, activity by its event timestamp, roster snapshots by their snapshot timestamp, and Webull runs by their run timestamp. A selected trade's reporting entry is removed as a whole, including its displayed order attempts and fills. Date-only activity is interpreted at UTC midnight. Undated entries are kept by partial wipes and included by All. Entries dated after the confirmed end time remain available, so a delayed confirmation cannot wipe newly enrolled trades.

Only reporting logs change:

- **Webull** excludes selected trades from Real fills, Webull Equity, Webull Breakdown, merged paper-fill rows and the Webull CSV downloads. Run logs use their own timestamps. Live broker diagnostics remain visible.
- **On-site** excludes selected modeled open, closed and archived trade entries, matching SPY rows, activity events and roster snapshots from Track Record and its data exports. Stats, all-time stats, comparisons, equity, breakdowns and simulations use the retained sample.

The other tracker, uploaded CSV fills, watchlists, market history, other strategy books, Grade edge and rule research, engine inputs, broker positions, orders, account identity and account balance remain intact. Raw execution bookkeeping is retained privately because it controls exits, holdings reconciliation and duplicate-order prevention. These controls clear the active reporting log; they do not erase that execution journal or purge backups. Open Picks reads the intact engine book. Webull comparison metadata also comes from the engine book, narrowed to trades still in the Webull report, so an on-site wipe cannot change Webull's analysis.

## Implementation and safety boundary

The Owner-only POST `/api/auth/track-record-reset` accepts one tracker, one supported period and an explicit operation. `preview` is read-only. It returns a signed ten-minute token binding the tracker, period, exact dates and reporting revision. `wipe` requires that token and a matching confirmation string. Expired, forged, changed-scope and changed-period confirmations are rejected. A stale reporting revision requires a fresh preview. Retrying the same successful operation is idempotent and never advances the cutoff.

Each scope has its own request-time marker, `track-record-reset.json` or `webull-track-record-reset.json`, and a separate `track-record-onsite` or `track-record-webull` conditional lease. Wipes only write the selected marker. They never import a broker client, submit/cancel orders, delete storage objects, write the Webull execution ledger, or rewrite the bake's data. They can be used while positions are open.

The markers hold merged, bounded reporting exclusions. They are Owner-only and excluded from workflow publication and seeding. Old builds cannot remove them or restore wiped reporting entries. New enrollments beyond the cutoff remain visible. The existing datastore and sync behavior are unchanged.

`GET /api/auth/track-record-data?key=...` exposes only four allowlisted on-site reporting keys and requires both Owner claims. Engine consumers continue using the original data paths. Webull GETs and CSVs apply only the Webull marker. Track Record data exports fetch the reporting endpoint afresh rather than reusing raw or cached engine data. Shared pure stats functions keep the build and filtered reports consistent. Missing observations remain unknown rather than becoming zero; incomplete SPY pairs are excluded from comparison counts.

## Repeatable checks

`npm run test:track-record-reset` runs the two-tracker/five-period matrix, millisecond boundaries, undated/future entries, archive/baseline filtering, fresh enrollments, exact source-byte preservation, stale publications, auth/origin checks, signed-token scope/expiry, storage failure, concurrent wipes and retries against fake storage.

`npm run test:track-record-reset-browser` exercises the shipped page and real authenticated handlers with synthetic records. It checks all periods, checkbox reset, cancel/Escape, failure/retry, duplicate protection, CSV output, unchanged live source state, Open Picks independence and all thirteen Track Record panes at desktop/mobile sizes in light/dark mode. It supports `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` overrides.

The existing picks, fills, Webull lifecycle/execution/recovery, Webull analytics, Grade edge research, rendering, private-store and export suites cover the surrounding paths. `npm run regen:track-record` regenerates browser code and the Track Record markup/styles while preserving published research, data timestamps and embedded rate provenance. No verification invokes a production wipe or broker mutation.
