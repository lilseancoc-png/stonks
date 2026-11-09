# Owner Update Checker

**Owner → Update Checker** accounts for all 57 site destinations, all 11 GitHub
workflows, workflow log diagnostics, and the published data/log inventory.
Owner-only notices appear throughout the site and refresh every five minutes
while the browser is visible. Notices stay in-app, as requested. No email,
Discord, GitHub issue, or chat notifications are sent by this feature.

## Independent monitoring

`update-checker.yml` runs after existing producers finish and independently at
17 and 47 minutes past every hour. It does not depend on a successful market
build. It detects failed, cancelled, timed-out, queued and running jobs; missed
full-build slots; a stale monitor heartbeat; degraded diagnostics inside green
runs; and GitHub's Vercel deployment status for the current `main` revision.

The five full-build slots are 10:00, 11:00, 13:30, 15:30 and 16:10 ET. A missing
successful publication becomes overdue 45 minutes after its slot. The shared
exchange calendar handles weekends, holidays and DST. A job queued/running for
90 minutes is stuck. A report without an observation for 90 minutes is stale.
A successful routing, Brief-only or transcript run cannot clear a failed full
build. A successful generation without successful publication is insufficient.

Each workflow is queried directly, so a rarely used maintenance job cannot be
lost behind the latest 100 hourly scanner runs. The collector retains 20 Daily
runs, eight runs for each other workflow, and the last successful full build.
Completed run/attempt diagnostics are reused rather than downloading the same
logs every half hour. Active runs are observed again. Retries cannot regress to
an older attempt. The monitor ignores its own currently running collection.

Workflow logs are scanned for error annotations, program exceptions, explicit
publication failures, known producer failures, AI DOWN/DEGRADED reports, and
unresolved execution diagnostics. Logs are bounded to 8 MiB per job. Missing,
expired or oversized logs are explicitly unverified. Only fixed descriptions,
categories and counts are stored. Raw log lines, credentials and payload
values never enter the checker report. A log warning is a diagnostic finding,
not a claim that the monitor has independently reproduced its cause.

## Feature and stored-log checks

The feature catalog is derived from the actual site map and shares source-key
mappings with the MCP server (`lib/site-catalog/`). Tests fail if a new feature or workflow is omitted.
Manifest-backed pages validate the sidecar metadata; the symbol list deliberately stays in the HTML shell.
Every destination has an output contract or an explicit reference, monitor, or
request-driven designation. Those designations are not automatic evidence that
every interactive behavior works. Release tests exercise the renderer, API,
Owner access and browser behavior.

Scheduled output checks cover missing/unreadable JSON, required field types,
missing or future timestamps, output age, declared producer errors, incomplete
coverage and significant scanner failure rates. Empty valid result sets are
allowed. Brief freshness uses the saved narrative timestamp, not a freshly
stamped wrapper. Per-feature cadence checks catch a desk carried forward from
an older build inside an otherwise green publication. Swing, hourly, OI and
weekly desks have their own deadlines.

The collector enumerates the entire logical published inventory, including
history, caches, archives, request-time trackers and logs. It validates JSON
and root shape, checks manifest byte counts, and uses the pinned immutable
publication objects for its reads. Company artifacts also require a positive
spot, option chains, technicals, quote provenance and compact published price history. The publication verifier and monitor share this contract; internal build-time bars are intentionally absent from published files. Request-time records
are optional before first use. Stored broker reconciliation flags are read
without contacting a broker.

The inventory limit is 4,000 logical artifacts per pass. Oversized inventories
are explicitly incomplete, not green. At most 200 artifact findings appear in a report. These bounds keep
the monitor from silently truncating work or growing without limit.

Default content windows are 96 hours, 192 hours for selected historical desks,
and 240 hours for weekly data, in addition to applicable cadence checks. These
are operational checks of saved outputs. They cannot establish every source
fact, calculation, runtime API result, trading eligibility, or broker fill.

## Privacy and ownership

The existing signed Owner session must contain both `tr` and `tp`, with
`PRIVATE_DATA_ENABLED=1`. The auth function serves `?checker=status|summary`;
responses are `private, no-store`. The generic data routes cannot read the
internal report at `_stonks/update-checker/status.json`. Anonymous, partial-role,
revoked and disabled sessions cannot access it. No extra serverless slot is
added. The collector checks out default-branch code, never triggering artifacts
or log contents as code. Its GitHub token has only Actions/contents read access.

R2 leases serialize the report write. Only the checker report is written.
Market publications, broker state, uploads, checkpoints and research journals
are never changed. The feature adds no AI/provider requests or subscriptions;
existing Actions, R2 and function usage still apply.

## Verify and release

`npm run test:update-checker` exercises feature/workflow coverage, diagnostic
redaction, publisher integrity, cadence and DST, missing/stuck jobs, heartbeat,
retry ordering, read-only collection, and the actual signed-cookie dispatcher.
`npm run test:update-checker-browser` exercises desktop/mobile, both themes,
multiple failures, notices away from this page, unknown/stale/stuck states,
revocation, refresh failure, timeouts and recovery. Set `PLAYWRIGHT_MODULE` to an
external Playwright install. The preview is fictional and cannot call providers
or brokers.

`update-checker-tests.yml` runs these and the related access/publication tests
on pull requests and pushes to `main` and `Update-Checker`. The independent
collector uses the existing `R2_*` Actions secrets. After merging, dispatch only
**Update checker** once on `main` to populate its first report, then check the
workflow summary and the Owner page. No broker job is needed for activation.

`node scripts/collect-update-status.mjs --dry-run` reads GitHub metadata and log
diagnostics using `GITHUB_REPOSITORY` and `GH_TOKEN`. It does not read or write
private storage. Keep its report local; never commit authentication tokens.

## Repaired full-build blocker

On November 1, six recent full Daily builds were confirmed to fail at **Verify
party control history**. The test expected literal renderer source text
`'party-tracker':1` after Owner access had moved to a shared policy. The repaired
test checks the shared policy and the generated access object. It preserves
the Owner requirement without depending on source formatting. Site generation
and publication were skipped in the affected attempts, including
[41146561078](https://github.com/lilseancoc-png/stonks/actions/runs/41146561078).
The latest successful full build found in the original sample was
[40946591930](https://github.com/lilseancoc-png/stonks/actions/runs/40946591930).
