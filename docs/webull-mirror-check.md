# Check the Open Picks mirror

The execution source is the raw Open Picks trade record in
`picks-accuracy.json`. A recommendation on Top Picks is not an order.
The mirror follows the trade ID from entry through its close signal.
Existing market approval still governs automatic entries that have not filled.

## Run the offline audit

Run `npm run audit:webull-mirror` on the branch you intend to release.
The runner removes inherited broker, storage, and AI credentials from its
child processes. Its checks use synthetic broker responses and temporary
stores. It does not run a build, order trigger, or production reconciliation.

The audit covers entry and close orders, price limits, partial fills,
cancellation races, durable intents, holdings reconciliation, manual recovery,
expiry, reporting, input hydration, publication freshness, and schedules.
A passing result verifies those tested paths. It does not certify live fills.

## Inspect saved production readiness

Use the existing private R2 environment file:

```sh
node --env-file=/private/path/r2.env scripts/diagnose-webull-mirror.mjs --strict
```

The diagnostic makes three store reads. It never acquires a lease, saves a
ledger, requests quotes, or contacts Webull. It outputs timestamps, counts,
and fixed explanations. It omits account IDs, trade IDs, broker order IDs,
credentials, lock owner tokens, and private reconciliation text.

`health.status` has three values:

- `saved-checks-current`: the saved checks have no identified gap.
- `pending`: an entry or working order still needs another observation.
- `attention`: a source, entry, exit, reconciliation, lock, or closing check
  needs review.

`--strict` exits unsuccessfully for both pending work and attention.
`brokerVerified` always remains false because this diagnostic reads saved state.
Pre-go-live picks are counted separately and require verified adoption.
The diagnostic cannot identify a manual holding that was never imported.

Open Picks freshness follows the 11:00 and 15:30 Eastern decision windows,
with a 20-minute allowance for publication. It accounts for weekends, market
holidays, daylight saving time, and early closes. A newer general site build
does not refresh an old Open Picks publication.

The closing check requires a completed observation during the final ten
minutes of the latest completed exchange session. An HTTP 200 response or a
successful run after the close cannot substitute for that observation.
The Owner mirror endpoint also returns this diagnostic as `health`, calculated
from raw execution state before any reporting-log exclusions.

## Resolve a failed live check

For missed entries, verify whether you hold the exact contracts in Webull.
Use [verified manual recovery](webull-paper-controls.md#grouped-positions-and-manual-recovery)
to prepare an adoption proposal when appropriate. An older missed pick cannot
be bought automatically in a later session.

For stale Open Picks, inspect the last 11:00 or 15:30 full build. Verify that
collection, freshness validation, private publication, and the mirror step
all ran. A green general build can intentionally carry the prior trade record.

For a missing closing observation, inspect the actual job start time and
`WEBULL_EOD_SCHEDULE`. GitHub schedule delivery can be late. A timely external
dispatch of `webull-eod.yml` must start during the final twenty minutes,
at 15:40 Eastern for a regular close or 12:40 Eastern for an early close.
An additional dispatcher requires configuring the external service.
The server still enforces the exchange calendar, lease, quote, and fill checks.

After a release, compare the saved ledger against authenticated sandbox
positions and broker order details. Verify actual open and close fills.
The existing limit policy and broker liquidity can still leave entries or
exits unfilled. Tests and saved-state diagnostics do not guarantee execution.
