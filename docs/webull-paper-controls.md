# Webull paper execution controls

Sandbox only. Execution policy `2026-10-29-ladder` is implemented on
`Webull-Emergency-Fix`. Local verification uses synthetic broker responses
and does not submit broker orders. Deployment and observed broker behavior
require separate verification after release.

## Prices and the closing deadline

Ordinary entries and signaled exits use a **2% allowance, then 4%** from the
saved Open Pick price. Allowances never compound. Debit buys can pay more,
and debit sells can receive less. Credit-spread entries can receive less,
and credit buybacks can pay more. The current ask or bid is used when better
than the allowance. Tick rounding preserves each ceiling or floor.

The first order has at least two minutes to work before repricing. A quote
that already makes the working order executable does not cause cancellation.
The final 4% DAY order stays working; status polls do not consume attempts.
Cancellation must be confirmed before a replacement can use the remaining
quantity. A fill that wins the cancellation race reduces that quantity.

Ten minutes before the exchange close, a still-open, eligible pick from the
same session gets one final entry attempt with a **5% cap**. A 13:00 ET early
close uses 12:50 ET. The order remains working through close. No unrestricted
entry or automatic next-day catch-up is allowed. A stale unacknowledged intent
requires broker verification instead of replay into a later session.

At the same deadline, a held position with a site close signal or an expiry
close uses **emergency exit pricing**. The normal 4% allowance no longer applies.
A debit spread or long option uses the smallest supported positive SELL limit.
A credit vertical buyback uses the full spread width as its BUY ceiling.
These remain complete-position LIMIT orders, with no separate leg liquidation.
An emergency can give up nearly all remaining value. Broker-confirmed execution
prices, rather than those permissive limits, determine the recorded result.
Positions whose site picks remain open are retained unless expiry controls apply.

Neither permissive prices nor the scheduler guarantee a fill. Missing or
invalid quotes, unsupported broker evidence, uncertain cancellation, changed
holdings, and absent liquidity can leave exposure open. After close, unresolved
orders and signaled exits receive explicit review labels. Later confirmed order
evidence can clear those specific transient labels. Unrelated reviews remain.

Quotes come from Yahoo option quotes or synthetic net prices formed from the
legs. Each attempt records the source and fetch time. Fetch time does not prove
the exchange quote was current; exchange quote timestamps remain unknown.
Negative synthetic bids are not converted into executable zero-price quotes.

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

Every order keeps an append-only sequence of preparation, submission,
cancellation requests, and changed broker observations. Broker order IDs,
cumulative filled quantities, average prices, actual fees, and fill timestamps
remain available for review. Identical polls do not add duplicate fill evidence.
These snapshots do not claim individual execution lots absent from broker data.
The Owner trade log and **Download order attempts (CSV)** expose this history.

An unchanged cumulative fill retains its known price and fees if a later
response omits them. A larger cumulative fill requires new price, fee, and
timestamp evidence. Earlier partial-fill values cannot stand in for the larger
fill. Aggregate completion times remain unknown if any contributing attempt
lacks its fill timestamp. Active and recent terminal orders can refresh missing
metadata; an unavailable optional metadata request does not invalidate confirmed
holdings or block an authorized exit. Only the specific resolved cancellation
or missing-price review clears automatically; unrelated reviews remain.

Decisions blocked by unavailable quotes or invalid net prices remain stored,
even when no broker order was sent. The final missed-entry reason, tracker
history, and trade CSV retain that explanation after the session ends.

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
**up to four follow-up calls two minutes apart**, only while the server reports
pending orders or safe unfinished work. A concurrent reconciliation can also
request this bounded retry. Quiet books stop after the initial check. Unsafe
reconciliation alerts stop ordinary follow-ups. There is no all-day polling.
The dedicated
`.github/workflows/webull-mirror.yml` remains available for manual recovery,
with the same bounded follow-up option. The server still enforces exchange
hours, holidays, and early closes before placing orders.

`.github/workflows/webull-eod.yml` independently monitors the final 20 minutes
of the session with one-minute checks, up to 23 calls. It continues through a
quiet book or transient request failure, acts in the final ten minutes, and
checks broker outcomes after close. The UTC schedules cover regular and early
closes in both ET offsets. Most dispatches skip without contacting the endpoint.
A second dispatch provides a catch-up. A queued dispatch after close performs
an audit and fails if no in-session deadline check was recorded. Invalid or
concurrent final responses get a bounded grace period; a skipped check cannot
count as completed reconciliation. GitHub scheduling can be late, so this is a
best-effort closing window. Its account lease also excludes concurrent build
or manual writers.

The UTC coverage includes 16:40 and 16:50 for summer early closes, as well as
winter early closes and ordinary sessions. A run interrupted by its time budget
cannot mark the closing-deadline check complete. The final audit records that
gap in the Owner view, and both ordinary and delayed closing jobs fail visibly
when no completed deadline check exists. Final grace retries also cover broker
failures inside an otherwise successful HTTP response.

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
account mismatch and unsafe replacement of existing order intents. Review and refresh
that evidence before an explicitly approved conditional-lease checkpoint.
An untouched entering row can be adopted with no exposure or prior execution
state. A previous automatic miss or entering row can also be adopted when fresh
broker detail proves every prior entry order terminal with zero fills. Previous
intents remain in history, and the automatic miss remains in fill-rate statistics.
An uncertain or partially filled prior entry cannot be replaced by recovery.
Preparing the proposal does not advance the saved last-run timestamp.

The operator command is `scripts/recover-webull-manual.mjs`, with a private
`--config=<path>` JSON containing `manualClientOrderIds` and
`externalClientOrderIds` arrays. The older singular `manualClientOrderId` is
also accepted. One batch can adopt the three MU, TSM, and WDC manual fills
after their real broker orders fill. It defaults to read-only, fetches actual order details
and the complete positions/open-order snapshots, and can save a private proposal
with `--output=<path>`. Only an explicitly approved `--apply` acquires the
account-wide lease and checkpoints the freshly verified adoption. It refuses
any open broker orders or a ledger/record that changes during inspection. It
also refuses changed or unavailable stock holdings in an existing baseline,
requiring separate review rather than silently accepting a new equity baseline. It
never submits, previews or cancels orders; the normal mirror handles authorized
future exits after release.

Run the read-only proposal with actual client order IDs in a private config:

```
node --env-file=r2.env scripts/recover-webull-manual.mjs --config=/private/path/manual-orders.json --output=/private/path/recovery-plan.json
```

Match each proposed trade to its broker fill, published legs, quantities,
execution time, and fees. Include any unmanaged positions in
`externalClientOrderIds`; use an empty array only when none exist. After that
review, the same command with `--apply` instead of `--output` performs the
ledger checkpoint. No fill is imported from a planned manual trade or a
holdings cost. Until this verified adoption completes, those entries do not
have managed mirror exits.

An adopted spread retains its real broker order ID, requested/filled quantity,
net execution price, placement/fill timestamps, actual fees and manual provenance.
The mirror cannot submit or replay its entry. Only remaining spread quantities
can be closed through the existing deterministic, durable exit intents. A
separate manual single option remains in a group-aware external baseline, even
if it shares a strike with the spread. External-group changes require review;
they are never silently adopted or liquidated. Leg-level execution prices absent
from broker order detail remain unknown rather than being allocated from costs.

Track Record labels the manual entry and actual price above, below, or equal
to the saved model. It retains the real execution record and fees, and excludes
manual prices and timing from automatic-entry statistics. An earlier automatic
miss remains a miss in the automatic fill-rate denominator after manual adoption.
Both manual and automatic paper fills are excluded from uploaded real-money
comparisons, using explicit source metadata with legacy account-label support.
Subsequent automated exits retain their execution statistics. Actual cumulative
order fees replace preview estimates when available and are not pro-rated or
counted twice. Estimated and missing fees retain their prior behavior.

Normally there are two initial build-linked checks per trading day, with at most
eight conditional follow-ups across those windows, up to ten calls. The separate
closing window, forced builds, and manual recovery add their own bounded checks. Calls add
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
`npm run test:render`. Run `npm run regen:webull` to regenerate only browser
assets while preserving the published research snapshot and embedded rate.
`npm run test:webull-browser` checks the generated tracker with synthetic ledger
exports, including desktop, mobile, keyboard controls, and CSV. Tests use fake broker responses and a conditional object
store, never real or paper orders. They prove the tested lifecycle paths, not
live Webull schema compatibility, liquidity, scheduler punctuality, or profits.

Primary references: [Webull options orders](https://developer.webull.com/apis/docs/trade-api/options/),
[account positions](https://developer.webull.com/apis/docs/reference/account-position/),
[NYSE calendar](https://www.nyse.com/trade/hours-calendars), and
[R2 conditional writes](https://developers.cloudflare.com/r2/api/s3/extensions/).
