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

**Size of a new trade (2026-11-19).** `mirrorQty` in `lib/webull-mirror.mjs`
sets `requestedQty` once, when a trade first enters the ledger; a later switch
change never resizes a trade already there.

| Trade | Webull asks for | Ledger `qtyBasis` |
|---|---|---|
| Strategy-engine option trade | the record's `contract.qty` (1 to 200 since 2026-11-23, 1 to 25 from 2026-11-20, 1 to 10 before; the engines' own caps `ENGINES_MAX_QTY` / `ENGINES_MAX_PREMIUM_USD` and the put caps already hold it; a missing value is 1, as on every trade before 2026-11-17; above 200 is capped at 200, `MIRROR_MAX_QTY`). `flatQty`, where present, is comparison only and is never read | `record`, `record-capped` or `one` |
| Top Picks option trade | `picksRiskQty`: the risk budget (`ENGINES_RISK_USD` from Owner Settings or env, else $2,000) divided by one contract's risk, rounded down, 1 to the Top Picks cap (`WEBULL_PICKS_MAX_QTY`, Owner Settings → Account limits, 1 to 200, default 200 since 2026-11-23, 25 from 2026-11-20, 10 before; a Vercel value wins; `picksCapFromSettings`) and at most the premium cap (`WEBULL_PICKS_MAX_PREMIUM_USD`, $200,000: contracts x price x 100, a credit spread its width less the credit), whichever comes first; a put (side `put`) also stays under `WEBULL_PICKS_PUT_MAX_QTY` (100) and `WEBULL_PICKS_PUT_MAX_PREMIUM_USD` ($100,000) (`picksCapsFor`). When the cap sets the size the ledger trade keeps `qtyCap` and `qtyWanted` (what the budget asked for), plus `qtyCapBy: "premium"` and `premiumCapUsd` when the premium cap set it. Risk is the whole premium under 30 days to expiry (or an unknown expiry), else premium × the trade's stop (50%) × 1.25 for gaps, never more than the premium; a credit spread risks width minus credit. A Top Pick is never skipped for size: at least one contract | `risk` |
| Either, with **Webull quantities above one** off | one contract | `one` |
| Top Picks, with **Webull Top Picks risk sizing** off | one contract | `one` |
| Engine share trade, Trend follower, Momentum basket and Multi-asset rotation holdings | the record's whole-share count (`contract.shares`), as stock, moved inside the stock order range (below) | `shares`, `shares-min`, `shares-max` or `shares-over-max` |

**Stock order range** (2026-11-19, Owner rule; $10,000 to $250,000 since
2026-11-23, $2,000 to $25,000 before). Every engine stock order costs
between $10,000 and $250,000 at the engine's entry price, unless the Owner
changes the range in Owner Settings → Account limits ("Smallest engine stock
order" `WEBULL_STOCK_MIN_USD`, "Largest engine stock order"
`WEBULL_STOCK_MAX_USD`; a Vercel value wins; `stockRangeFromSettings`). A lot
under the smallest order is raised to the fewest whole shares that reach it
(`shares-min`), a lot over the largest is cut to the most whole shares that fit
(`shares-max`), and a
stock whose single share costs more than the largest order is not bought
(`shares-over-max`, logged as not bought and never bought later). Since
2026-11-23 a stock order that would take the account's live stock lots (at
fill price) past the open engine stock cap (Owner Settings → Account limits
`ACCOUNT_LIMIT_SHARES_USD`, $1,000,000 unless set, 0 = off; `mirrorOpenGate`)
is not bought either, logged with the reason and never bought later; the cap
holds at its default even when the saved settings cannot be read. 0 for the
smallest = no minimum; a smallest above the largest reads as the largest. The
range is applied at the engine price; the entry ladder may pay up to its price
allowance (2%, 4%, 5% at the end of the day) above that. The engine records
keep their own share counts, and paper results are in percent, so the record
and paper P&L compare as before. A trade already sent keeps its size when the
range changes. The ledger trade carries `stockRange` and a label ("Cut to the
$25,000 stock order maximum: 41 shares (record 100)"), shown on the Strategy
engines page's Webull fill cell. Rule: `stockOrderShares` in
`lib/webull-mirror.mjs`.

The Top Picks Track Record stays in percent per contract; only the paper order
changes. Each ledger trade keeps `recordQty` (what the record asked for) and,
for risk-sized trades, `riskPerContract` / `riskUsd`. Ratio spreads and
nonstandard deliverables are still refused.

**Stock orders.** A share trade is sent as one Webull v3 stock limit order with
exactly the fields of the official stock order docs and SDK sample
(`developer.webull.com/apis/docs/trade-api/stock`, `samples/order/order_stock_client.py`):
`client_order_id`, `combo_type: NORMAL`, `symbol`, `instrument_type: EQUITY`,
`market: US`, `order_type: LIMIT`, `limit_price`, `quantity`, `side`,
`time_in_force: DAY`, `support_trading_session: CORE`, `entrust_type: QTY`.
Entries are `BUY` and exits `SELL` only: the client refuses any other stock
side (`SHORT` exists in Webull's enum and is never sent), a quantity that is
not a positive whole number, and an order with no category, before any network
call. The place request carries the SDK's category header (`US_EQUITY` for
stock, `US_OPTION` for options; `orderCategory` in `lib/webull-client.mjs`);
the preview sends it for options only, as the SDK does. Stock prices use the
same 2% / 4% / 5% allowances in pennies (no nickel rule), from the stock's
live bid and ask (`fetchQuote` in `lib/yahoo.mjs`, the call `/api/quote`
already makes; a zero or crossed quote sends nothing). An end-of-day emergency
stock exit sells at 5% under the bid, never a market order. Share trades have
no expiry, so the expiry and settlement controls skip them. Share orders start
for trades opened from the first mirror run with the switch on
(`sharesGoLiveIso`, set like `goLiveIso`); older share holdings stay on the
engine record only.

**Fill outcome.** `fillOutcome(t)` reads each trade as `filled` (every contract
or share asked for), `partial` (some; the label reads "Partly filled: 1 of 4
contracts"), `missed` (none, and the entry is over), `pending`, `shared` (the
contract is held by another engine) or `not-bought`. It is on the JSON trades,
both CSVs (`requested_qty`, `fill_outcome`, `instrument`), the Real fills tab
and the Strategy engines page (the Webull paper tab and an "At Webull" column
beside each engine's own result on its Track record tab).

**Labels and the run log (2026-11-19).** Each engine trade also stores the
`setup` that opened it (filled in from the engine record for older trades), on
the JSON trades and both CSVs (`setup`, before `engine` and `made_by`). A share
trade's exit reference is the stock's own closing price on the record
(`exitMid`), not the after-cost result. Each run's summary counts errors by a
fixed kind (`errorKinds`: order status unavailable, positions unavailable,
positions not readable, cancel unconfirmed, submission not acknowledged) and
says why a window is still pending (`pendingKinds`). The build-window and
end-of-day trigger scripts print these labels, never a ticker or an ID. "Entry
order working inside its price allowance" is the normal state of the ladder:
the last limit stays live until it fills or the end-of-day window raises it to
the 5% ceiling; the log says so in plain words. A window left with only that
state (or an exit order still working), and no error or alert, no longer fails
the workflow; any other pending kind still does.

**Cancels and cash (2026-11-19).** Webull answers a cancel request before it
applies it, so after asking the mirror reads the order again after 1 s and 2 s
(`CANCEL_SETTLE_MS`, skipped when the run's time budget is close) before it
marks the cancel unconfirmed; an unconfirmed cancel is read again at the start
of the next run, and three in a row on one order become an Owner review.
Before each opening order the mirror checks cash so no buy uses margin: it
reads `GET /trading/assets/balances/get` once a run (on the first opening
order) and takes the USD row of `account_currency_assets`: its `settled_cash`,
else its `cash_balance`, else the top-level `total_cash_balance`
(`parseCashPower`, field names from Webull's US API reference,
developer.webull.com/apis/docs/reference/account-balance; `buying_power`,
`option_buying_power` and every margin field include margin and are never
read; a negative cash figure counts as none), less what that run's earlier
opening orders tie up (`openingCash`: shares x price, premium x 100 x
contracts, a credit spread's width less the credit, plus the previewed fee). A
buy that does not fit is logged as not bought (`cashHold`, note "Not enough
cash; no margin is used.", shown like an Owner-control hold) and is never
bought later; a partly filled entry keeps what filled. Exits never read cash.
A failed balance read, or a reply with none of those cash fields, sends the
order anyway and adds a warning to the run summary (`summary.warnings`,
printed by both trigger scripts, never a failure). The fields have not yet
been seen in a live sandbox reply: the ledger keeps the reply's key names
(never values) as `balanceShape` to confirm them.

**Switches** (Owner Settings → live site switches; each can only turn its part
off, `0` in Vercel env does the same): `WEBULL_SHARES` (share orders),
`WEBULL_QTY` (quantities above one; off = one contract for every option
trade), `WEBULL_PICKS_SIZING` (Top Picks risk sizing). All three are on by
default. Test: `node scripts/webull-shares-smoke.mjs` (also run by
`npm run test:webull-mirror`; reruns take `WB_RISK_USD`, `WB_PRICE`,
`WB_STOCK`, `WB_SPREAD`).

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
assignment. One exception: a stock difference that the mirror's own
still-working share orders on that symbol can explain (up to the shares an
entry has left to buy, or down to the shares an exit has left to sell) is an
order filling during the run. Only that symbol's share trades wait while the
mirror refreshes them; nothing else pauses (`sharesFilling` on the
reconciliation). A difference outside that range is still an account-wide alert. An Owner reviews those cases in Webull; automatic stock unwind and
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

Since 2026-11-16 the window runs in its own workflow,
`.github/workflows/webull-mirror.yml` (queue `stonks-webull-mirror`): the
build's "Mirror published Top Picks to Webull paper" step only dispatches it
(`gh workflow run webull-mirror.yml -f follow_ups=4`) after verified
publication. Run inside the build, the window held the shared
`stonks-data-commit` queue (the 15:30 ET build waited 8.5 minutes on
2026-11-16) and started the end-of-day window 5 minutes late. The same
workflow is the manual recovery path (`follow_ups` 0, 2 or 4). The server
still enforces exchange hours, holidays, and early closes before placing
orders.

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
`continue-on-error` on its dispatch step so the verified research can publish.
A failed mirror, errors, alerts, or orders still pending after the window (other
than an order still working inside its price allowance) fail
the `Webull paper reconciliation` run itself (strict mode), so the build stays
green for the close-bake watchdog while the Webull failure stays visible; a
final check that finds the end-of-day window holding the account lease
("mirror already running") is not a failure.

When a run needs review, the public log names only the kind of review and the
engine, from fixed labels (`REVIEW_KIND_LABELS` / `describeReviewKinds` in
`lib/webull-mirror.mjs`), for example
`review required (1 order outcome unconfirmed at the close (Fundamentals); Owner Webull test view)`.
Kinds: order outcome unconfirmed at the close (`EOD_ORDER_UNCONFIRMED`, clears
itself once the order is final), signaled exit unfilled at the close, cancel
unconfirmed, fill price not confirmed, order status unverified, and account
holdings check. No ticker, order, price or quantity reaches the log.
Review the Owner trade log for the trade itself. GitHub
notification preferences govern notifications; this code sends no external
messages.

Read [Check the Open Picks mirror](webull-mirror-check.md) for the complete offline audit and read-only saved-state readiness check.

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

## Strategy engines in the same account

The six signal engines (`docs/engines.md`) trade in this paper account too, and since 2026-11-19 so do their share trades and the two core engines' holdings (Trend follower, Momentum basket), as stock (see "Stock orders" above).
At each mirror run the engines' record (`engines-record.json`) joins the Top
Picks record: Top Picks rows first, then engine rows. Every ledger trade
carries `engine`, and an engine trade's ID starts with its tag
(`TEC:AAPL-C-11/16/26-11:00`), so the same entry, exit, quantity, expiry and
reconciliation controls above apply to it unchanged.

- **One position per contract.** A trade whose exact contract another tracked
  trade already holds is recorded as `skipped` with `sharedContract` (who
  holds it) and is never bought twice; the holder gets `sharedWith`. A trade
  whose contract is being sold by its holder waits for that exit to finish.
  Stock is not covered by this rule: two engines holding the same stock each
  buy their own shares, and reconciliation checks the account's shares in each
  symbol against the starting holdings plus every open share trade's filled
  shares (`expectedEquities`). Any other stock change in a mirrored symbol
  (a manual trade, an exercise or assignment) pauses the whole account for
  review, as it always has for options.
- **Reports stay apart.** `/api/auth/webull-mirror` and the Real fills tab are
  Top Picks only. `?scope=engines` and `?scope=all` return the rest; both CSV
  downloads take the same parameter and carry an `engine` column.
- **Failure.** If the engines' record cannot be read, the Top Picks mirror
  runs as usual and engine trades already in the ledger are held for that run.
- **Switch.** `ENGINES_MIRROR=0` in Vercel stops new engine trades entering
  the account; trades already there keep being managed and closed.
- **Load.** The engines open at most 20 new trades a run in total (five
  before 2026-11-23; the engines' own limits add up to 17). With Top Picks
  that can be more entries than one mirror run sends inside its time budget
  and Webull's call limit; the rest go out at the build window's two-minute
  follow-ups (see "Call limits").

Test: `node scripts/engines-mirror-smoke.mjs` (fake broker).

Primary references: [Webull options orders](https://developer.webull.com/apis/docs/trade-api/options/),
[account positions](https://developer.webull.com/apis/docs/reference/account-position/),
[NYSE calendar](https://www.nyse.com/trade/hours-calendars), and
[R2 conditional writes](https://developers.cloudflare.com/r2/api/s3/extensions/).

## Call limits (2026-11-23)

Webull counts calls per app key and per endpoint. On the sandbox host, the
only one the mirror may use, each trading endpoint the mirror calls (place,
preview, cancel, order detail, balance, positions) allows 30 calls a minute;
a call over the limit is answered 429 and not processed
([rate limits](https://developer.webull.com/apis/docs/rate-limits)). A 429 on
an order or an order read leaves the order unconfirmed, which pauses every
entry until a person checks it, so the mirror keeps its own count
(`lib/webull-quota.mjs`):

- Each limited call is logged in the ledger (`webullCalls`, epoch ms per
  endpoint, the last minute only), so the count carries across runs.
- The mirror stops at 27 a minute per endpoint (three spare for clock skew).
  A call with no room is never sent: the run stops before it, the same way
  it stops at its time budget (code `RUN_BUDGET`), and the work waits for the
  next run.
- An entry goes out only when its whole first step fits (preview, place, one
  order read, and the balance read if the run has not read cash yet) with
  four place calls kept back for exits; a re-price also needs the cancel and
  its reads. An entry that does not fit is logged "Waiting: Webull's call
  limit for this minute is used up; the entry goes out at the next run." and
  is sent by the next follow-up. Exits never wait behind entries.
- A cancel is checked first for its cancel, its settle reads and the
  positions read, so a cancel is never left without its confirmation reads.
  Entries also leave room for one exit's cancel, reads and positions check.
- The opening pass that re-reads every tracked order keeps back the reads
  the run's own orders and exits need (`READ_RESERVE`, room for two
  re-prices, which in practice lets a busy run re-price several entries); an
  order it skips is read first at the next run (`summary.readsDeferred`), so
  a book with more working orders than a minute's reads still reaches
  positions and exits. The spread leg proof (`proveLegs`) follows the same
  rule.
- A skipped order can fill before it is read again. Like a share order
  filling mid-run, an option holding that the mirror's own still-working
  option orders can explain (up to the contracts an entry has left to buy,
  or down to what an exit has left to sell) is an order filling, not a
  missing leg: no alert and nothing pauses (`optionsFilling` on the
  reconciliation). Every order is re-read before a new one replaces it, and
  the next run's read books the fill. A difference outside that range is
  still an alert. Webull's sandbox reports a new fill as a position group
  whose legs carry no side or quantity, which the mirror can bind only from
  that order's own read: before parsing positions, the mirror reads the
  unread orders on any contract such a group holds (and the run stops at the
  call limit, cancelling nothing, if those reads don't fit).
- An exit order goes out only with room for its order call and one read.
- An unacknowledged order whose replay the limit holds back, or that a
  stopped run never reached, is replayed at the next run, not raised as an
  alert, and an entry held by the limit is logged "entry waiting for the
  Webull call limit", which the build window treats as a planned wait.
- The run summary carries `webullCalls` (calls used per endpoint).

The same change fixed a time-budget stop between the "prepared" save and the
order submission: the stop is now checked before the save, so a stopped run
never leaves a prepared order that was not sent (`webull-quota-smoke`).

Test: `node scripts/webull-quota-smoke.mjs` (a fake sandbox that answers 429
past 30 calls a minute: 21 trades go out in one run; 30 trades go out over a
run and a follow-up two minutes later, with no alert).

## Webull's own data (2026-11-19)

Three reads from Webull's official OpenAPI, all GET calls on the sandbox host
through the same signed client (`lib/webull-client.mjs`, host lock unchanged).
Each one is an Owner Settings live site switch (Live site tab, on by default;
`0` in Vercel does the same). Nothing here reaches a public page or the MCP.

### Contract check (`WEBULL_CONTRACT_CHECK`, `lib/webull-contracts.mjs`)

Before the first entry order of an option trade, the mirror looks every leg up
in Webull's option contract list
(`GET /trading/instruments/options/contracts/list`,
developer.webull.com/apis/docs/reference/option-contract-list) by its OCC
symbol, 20 symbols a call, all the run's new trades in one prefetch (at most
12 calls a run; usually 1). A leg Webull does not list, lists as closing-only
(`tradable_status` `CO`) or not tradable (`NT`), is being delisted, is
non-standard, or does not cover 100 shares gets **no order**: the trade is
logged missed with the note "Not tradable at Webull: <reason>; no order sent."
and the check is saved on the trade (`contractCheck`, also on the Real fills
tab and in the CSV column `webull_contract_check`). A failed or
over-budget lookup never blocks an order: the trade is sent as before and the
run log warns "contract list unavailable - contract not checked".

"Not listed" needs proof that the lookup worked. A leg the symbol lookup
misses gets one more call for its underlying's whole expiry (no type or
strike filter). The leg is blocked as "contract not listed" only when that
answer holds other rows of the same underlying and expiry (Webull lists the
expiry but not this strike). An empty answer sends the order as before and
warns "contract list unconfirmed - contract not checked"; the run summary
counts it under that warning. Positive evidence
(`CO`, `NT`, delisting, non-standard, not 100 shares) still blocks.

The same reply's Penny Pilot flag (`ppind`) sets the price step: in the
program $0.01 under $3 and $0.05 from $3; outside it $0.05 under $3 and
$0.10 from $3 (Cboe penny interval rules); spreads keep $0.01; a rejected
order's retry still uses at least a nickel. With no flag the old rule stands
($0.01 / $0.05), so nothing changes for a trade the check did not see.

This changes which trades the mirror places (a contract Webull would refuse
now logs a labeled miss instead of a rejected order), so it gets one check
with the Owner before it merges.

### Real fees (`WEBULL_REAL_FEES`, `lib/webull-fees.mjs`)

Each order keeps its preview estimate (`feeEst`). After every mirror run that
was not skipped, one read of Webull's order history
(`GET /trading/orders/historical-orders/list`, last 7 days, at most 2 pages,
only when a filled order still lacks a real fee) fills `feeActual` from the
order's `commission.actual_commission` plus `fees[].actual_value` (the fields
the order-detail page documents and `parseOrderDetail` already reads), marked
`feeSource: "order-history"` with the fee lines. A row whose filled quantity
differs from ours is skipped. Trade fees already prefer a real fee over the
pro-rated estimate (`updateQuantities`). The Real fills tab shows "$real vs
$estimate, real fees vs preview estimate" and each trade's fee cell says real,
part real or estimate; the CSVs carry `fees_actual`, `fees_estimated`,
`fee_basis` and per attempt `fee_source`. The first history reply's key names
(no values) are saved as `orderHistoryShape` so the first live run shows
whether the fields are there. A failed sweep is a warning, never a failed run.

### Stock quotes (`WEBULL_STOCK_QUOTES`, `lib/webull-quotes.mjs`)

Share orders price off Webull's stock snapshot
(`GET /market-data/stocks/snapshots/list`, US_STOCK, then US_ETF once if the
symbol answered nothing; real time on the paper keys, the 2026-11-19 probe saw
the last trade 0.0 to 0.1 minutes old). Yahoo is still fetched as the check
and the backup: the order prices off Yahoo when Webull fails, its last trade
is over 5 minutes old, or the two mids differ by more than 1%. Since
2026-11-22 Yahoo's own last price referees that last case: Yahoo's bid/ask
carries no time and can sit far from the last trade (QQQ bid 717 against a
608 last after the 2026-11-20 close), so when Yahoo's mid is more than 1%
from Yahoo's last price the order keeps the fresh Webull quote and the run
log says "share order priced off Webull - Yahoo bid/ask away from its last
price". The Yahoo backup passes the same check (code quality review,
2026-11-22): when the order would price off Yahoo (Webull failed or stale, or
`WEBULL_STOCK_QUOTES` off) and Yahoo's book sits more than 1% from Yahoo's
last price, it prices at that last price (bid = ask = last,
`yahooLastPriceQuote`), so an exit still gets a price that window; the
`quoteSource` ends "priced at the last price". Each attempt's
`quoteSource` says which ("Webull stock snapshot" or "Yahoo stock quote
(<why>)"). Option orders keep Yahoo quotes: Webull's free option quotes are 15
minutes late. At most two snapshot calls per share symbol a run.

### Watchlist sync (not built)

Build F planned to mirror the Owner watchlist into Webull's watchlists. The
paper keys answer `GET /market-data/watchlists/list` with an empty list, so
they do not reach the Webull app's watchlists, and nothing was built.

Test: `node scripts/webull-data-mirror-smoke.mjs` (no npm script), plus the
fee and contract chips in `webull-view-smoke` and `webull-execution-browser`.
