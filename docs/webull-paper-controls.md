# Webull paper execution controls

Implemented on `WeBull-Integration`, October 22, 2026. Sandbox only. Release
verification uses offline broker responses and does not submit broker orders.
Deployment status and the merge revision are recorded in the release PR.

## Quantities and order recovery

New mirror trades still request **one contract** (one per leg for a vertical).
Conviction does not increase size. The ledger now supports a positive integer
`requestedQty`; future approved sizing can supply that field without replacing
the execution lifecycle. Ratio spreads and nonstandard deliverables are refused.

Each attempt stores requested quantity, cumulative filled quantity, execution
price, and exact order contents. Entry replacements request only the unfilled
remainder; exits request only the remaining held quantity. Cancel acceptance is
insufficient: broker detail must confirm a terminal status before replacement.
A partial entry that exhausts its entry attempts remains an open holding. A
partial exit stays open until every filled contract closes. After 12 exit
attempts in a session the last DAY limit remains monitored and an Owner alert
is raised; the next session restores the retry budget. Prices are weighted
by filled quantity across attempts. Fee estimates are pro-rated to fills and
recomputed, not repeatedly added on every poll. Missing execution prices or fee
estimates remain unknown. CSV returns stay blank until the entire position closes.

Before any submission the ledger persists an intent with a deterministic
`client_order_id` and exact order body. An unacknowledged submission is looked up
and, where appropriate, replayed with that same identifier and contents. It is
never replaced under a new identifier because of a timeout. An acknowledged
order that later disappears requires review. Unverified orders pause new entries.

The endpoint acquires an account-wide R2 lease with conditional ETag writes
before reading the ledger, then checkpoints before broker mutations and after
state transitions. Overlapping build/manual calls cannot both mutate the
account. The 120-second lease exceeds the endpoint's 60-second runtime; guards
stop mutations before lease expiry. Blob-only configurations fail closed with
`LEASE_UNSUPPORTED`. No extra database or always-running service is introduced.

## Reconciliation and expiry

Each run refreshes tracked orders and reads broker positions before new orders.
A first snapshot preserves unrelated holdings as a baseline only when owned
contracts agree with confirmed fills. Legacy disagreement requires review.
Expected holdings equal that baseline plus confirmed entries minus exits.
Missing wings, mismatched quantities, unsupported snapshots, ambiguous short-leg
direction, and stock changes on mirrored symbols pause entries. Known pending
orders can be cancelled to reduce risk. Unsafe replacement or combo closes are
blocked; unrelated holdings are never automatically liquidated. Stock changes
are labeled possible exercise, assignment, or manual trading, not asserted to be
assignment. An Owner reviews those cases in Webull; automatic stock unwind and
assignment cash/P&L reconciliation are not implemented.

The published NYSE calendar covers **2026–2028**, including early closes. Unknown
years block new orders and require renewing the calendar. Without verified
last-trading-date metadata, the mirror begins closing **two trading sessions
before expiration**, with the first build-linked mirror on that cutoff date.
The morning build can therefore request the exit without waiting for an
unattended afternoon timer. This conservative buffer leaves time for AM
settlement and retries. A known last-trading date uses the prior session. Close signals
cancel unfilled entries and close only confirmed holdings. Expiry exits use the
available bid for longs/debits or ask for credit buybacks. No usable quote means
review is required, not a promise of liquidation. Early assignment can still
occur before the cutoff; the holdings comparison detects resulting discrepancies.

Expired positions remain `settlement-pending`. A position disappearing outside
tracked fills also enters this review state, covering manual closes. Two broker snapshots at least a
minute apart must show all owned legs flat, no live tracked orders, and unchanged
stock holdings before the mirror records `settled`. That proves observed flat
exposure; it does **not** fabricate execution prices, settlement cash, or realized
P&L. Such trades remain outside closed-fill performance statistics.

## Build-linked execution and activation

Automatic reconciliation runs immediately **after the 11:00 and 15:30 ET
Top Picks builds publish verified results** to the private store. It follows
actual completion, not a separate timer that might precede a delayed build.
Other full bakes carry the Track Record forward and no longer trigger Webull.
A forced manual build with `refresh_top_picks=true` also triggers the mirror.

Each publication starts one bounded execution window: an initial call, then
**up to two follow-up calls two minutes apart**, only while the server reports
pending orders or safe unfinished work. A concurrent reconciliation can also
request this bounded retry. Quiet books stop after the initial check. Unsafe
reconciliation alerts stop automatic follow-ups. There is **no five-minute
polling cron**, and no automatic hourly/all-day polling. The dedicated
`.github/workflows/webull-mirror.yml` remains available for manual recovery,
with the same bounded follow-up option. The server still enforces exchange
hours, holidays, and early closes before placing orders.

Unresolved orders after the window remain visible in the Owner view and fail
the mirror step visibly; the next build or a manual reconciliation checks them
again. A delayed afternoon build can finish after the market closes, in which
case no new order is sent. Fills, assignment changes, or settlement that happen
between execution windows are not detected until the next check. This cadence
is not a real-time stop or guaranteed expiry service. Expiry controls therefore
start on the first mirror of the conservative cutoff date rather than waiting
until 90 minutes before close.

Public workflow logs contain only status/counts, not account holdings or trade
details. The Owner-only Webull test view shows reconciliation alerts, last
check time, and requested/filled/closed/open quantities. Its freshness notice
compares the last inspected engine snapshot with the latest Track Record
build; a quiet interval between builds is not treated as a stale monitor.
The runner checkpoints at its time budget, prioritizes held positions, and
rotates refresh work to continue in the next bounded check.

Activation requires publishing the server, generated assets, and workflow
changes. Existing settings remain required: `PRIVATE_DATA_ENABLED=1` in
Vercel and the GitHub variable, `WEBULL_MIRROR=on`, Webull **sandbox**
credentials/account ID, and complete R2 configuration. Validate a manual run
and inspect broker holdings/ledger before relying on automatic operation.
Nothing in local tests activates broker execution. The research build retains
`continue-on-error` for its mirror step so the verified research can publish.
A separate `webull-health` job fails the overall workflow when that step fails,
without making the close-bake watchdog repeat a successful research publication.
Review the mirror step and Owner trade log. GitHub
notification preferences govern notifications; this code sends no external
messages.

### Diagnosing an execution lock

Owner `GET /api/auth/webull-mirror` also reads the execution lock without
acquiring it or contacting the broker. `executionLock.state` distinguishes
`absent`, `released`, `held`, `expired`, `invalid`, `unsupported`, and
`unavailable`; a held lock includes its expiry and remaining time. Ownership
tokens and ETags are never returned. The command below performs the same
read-only store inspection and compares the saved mirror snapshot with the
published engine, returning only timestamps, status, and counts:

```
node --env-file=r2.env scripts/diagnose-webull-mirror.mjs
```

A valid expired lock can be acquired through a conditional write. Acquisition
re-reads after a conditional-write race, up to three attempts. Malformed locks
fail with `LEASE_INVALID`, and repeated write conflicts with `LEASE_CONFLICT`;
neither is silently called "already running". These errors still block broker
mutations. Do not delete a lock based only on a stale ledger timestamp: inspect
the lock and running executions first.

R2 can compress a JSON lock read and return a weak `W/"..."` ETag. `If-Match`
uses strong comparison, so passing that weak validator to the conditional PUT
always conflicts, even for a released lock with numeric `expiresAt: 0`.
Lease reads request `Accept-Encoding: identity` and require a strong quoted
ETag. Unexpected weak/missing validators fail with `LEASE_ETAG_INVALID`; the
code never manufactures a strong tag by stripping the weak prefix. Conditional
acquisition and release, the account-wide lease, and durable broker intents
remain in force. Offline tests reproduce the compressed response at the signed
R2 adapter boundary. A read-only conditional GET can verify validator behavior
without acquiring or deleting a production lock.

If a pick was entered manually, reconcile its exact broker contracts,
quantities, order IDs, fill prices, execution times and fees before resuming.
The holdings comparison blocks an untracked position in the same contracts
from being bought again. Holdings alone do not prove execution prices or
timing, so the mirror does not adopt them as fills. Keep manual entries labeled
separately from automated fills when measuring execution delay and slippage.

### Grouped positions and manual recovery

Sandbox v3 vertical positions can omit quantities and directions on individual
legs. A parent quantity alone is insufficient evidence of a short leg. Groups
are bound to exact contract descriptors and leg IDs using confirmed broker order
legs, then checked against the stable broker position ID on every snapshot.
New groups require an unambiguous match to actual confirmed fill evidence;
engine legs, leg ordering, holding costs and quote marks are not direction or
fill evidence. Missing/changed groups, ratios, identities or directions continue
to pause execution. API failures and schema failures are reported separately.

Fills confirmed before broker legs were recorded (the MRVL spread of
2026-10-22) carry no leg proof. Each run re-reads the broker's own order detail
for such an open, unbound fill and stores its confirmed legs only when they
match the tracked contract and direction; a mismatch flags the trade for review.
An unbound group whose contracts the mirror neither holds nor has ordered is
held outside the mirror: it is counted (`externalGroups`) and left alone rather
than pausing the account, and a new pick that shares one of its contracts is
logged as missed. A pick that waits while orders are paused carries a
"Waiting" note; if the engine closes it first it is logged as missed with that
reason. A positions-parse failure records the failed check (`failure.reason`,
a fixed string with no broker data). An outside group that shares a mirror contract, or whose legs are not
fully described, still pauses execution.

`prepareManualRecovery` in `lib/webull-manual-recovery.mjs` prepares a local
ledger proposal from complete broker order details, positions and the published
record. It performs no store writes or broker calls. It refuses partial or
ambiguous fills, mismatched contracts, missing timestamps, duplicate allocations,
account mismatch and replacement of existing order intents. Review and refresh
that evidence before an explicitly approved conditional-lease checkpoint.
An entering row checkpointed by a paused mirror can be adopted only if it has
no order attempts, exposure, broker binding, provenance or review flag. Queuing
the pick before recovery does not authorize replay or replacement of an order.
Preparing the proposal does not advance the saved last-run timestamp.

The operator command is `scripts/recover-webull-manual.mjs`, with a private
`--config=<path>` JSON containing `manualClientOrderId` and
`externalClientOrderIds`. It defaults to read-only, fetches actual order details
and the complete positions/open-order snapshots, and can save a private proposal
with `--output=<path>`. Only an explicitly approved `--apply` acquires the
account-wide lease and checkpoints the freshly verified adoption. It refuses
any open broker orders or a ledger/record that changes during inspection. It
also refuses changed or unavailable stock holdings in an existing baseline,
requiring separate review rather than silently accepting a new equity baseline. It
never submits, previews or cancels orders; the normal mirror handles authorized
future exits after release.

An adopted spread retains its real broker order ID, requested/filled quantity,
net execution price, placement/fill timestamps, actual fees and manual provenance.
The mirror cannot submit or replay its entry. Only remaining spread quantities
can be closed through the existing deterministic, durable exit intents. A
separate manual single option remains in a group-aware external baseline, even
if it shares a strike with the spread. External-group changes require review;
they are never silently adopted or liquidated. Leg-level execution prices absent
from broker order detail remain unknown rather than being allocated from costs.

Track Record labels the manual entry, retains its execution record and actual
fees, and excludes it from automatic-entry fill rate, timing and slippage.
Both manual and automatic paper fills are excluded from uploaded real-money
comparisons, using explicit source metadata with legacy account-label support.
Subsequent automated exits retain their execution statistics. Actual cumulative
order fees replace preview estimates when available and are not pro-rated or
counted twice. Estimated and missing fees retain their prior behavior.

Normally there are two initial automatic checks per trading day, with at most
four conditional follow-ups across those build windows (up to six calls).
Forced builds and manual recovery add their own bounded windows. Calls add
function invocations, broker/quote requests, and R2 reads/writes; no AI calls
or paid subscription requirement is introduced in code. Actual billing depends
on account plans, request volumes, and existing allowances.

## Exit policy and verification

The engine's default take-profit for long options and debit spreads changes from
+20% to **+25%**; its -50% stop stays unchanged. Credit targets remain +50%/-50%
of credit received. Existing unversioned open positions adopt the new defaults
at their next evaluation. Each evaluated open position/new enrollment stores
`exitPolicy` version `2026-10-22-tp25`, take-profit, and stop thresholds. Subsequent
marks use the stored policy. Closed history is not reprocessed. The paired SPY
baseline and position-check tool use +25% as well. Optional modeled scale-out
remains optional and is not broker-native bracket execution.

Run `npm run test:webull-mirror`, `npm run test:picks` (or
`node scripts/picks-smoke.mjs`), `npm run test:track-record-fills`,
`npm run test:private-store`, `npm run test:workflow-schedules`, and
`npm run test:render`. Tests use fake broker responses and a conditional object
store, never real or paper orders. They prove the tested lifecycle paths, not
live Webull schema compatibility, liquidity, scheduler punctuality, or profits.

Primary references: [Webull options orders](https://developer.webull.com/apis/docs/trade-api/options/),
[account positions](https://developer.webull.com/apis/docs/reference/account-position/),
[NYSE calendar](https://www.nyse.com/trade/hours-calendars), and
[R2 conditional writes](https://developers.cloudflare.com/r2/api/s3/extensions/).
