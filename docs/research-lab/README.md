# Research Lab

An owner-only visual research workspace on `Research-Labatory`. Numerical work
runs deterministically on the site. Interpretation happens manually in a separate
ChatGPT or Claude chat. There are no Lab AI API calls, new provider fetches,
subscriptions, browser dependencies or scheduled research jobs.

## Use the workspace

1. Open **Owner → Research Lab** in an enabled, allowlisted owner session.
2. Choose a template and hypothesis. Capture 1–12 symbols from the existing
   cache, including a benchmark. Captures freeze inputs; they never fetch prices.
3. Review coverage/provenance and choose the discovery, embargo and final windows.
   The default plan uses next-open execution, a 10-session outcome, an 11-session
   embargo, an explicit benchmark and 5 bps slippage per side.
4. Add blocks, drag nodes, connect named ports and edit typed parameters in the
   inspector. Keyboard connections provide the same type/cycle checks. Undo,
   redo, zoom and the viewport are included in numbered layout revisions.
5. **Check experiment** previews the server compiler, hashes, resources and
   warnings. **Save revision** freezes graph, plan and compiled specification.
   Later edits append revisions. A run's **Open this revision** reopens its exact
   graph. Forks remain in the same multiple-testing family.
6. **Run discovery** queues the frozen revision and advances one node per request.
   Leaving the page pauses browser advancement. Inspect the run and **Resume
   worker** to continue. Cancel prevents official result publication. Completed
   numerical outputs appear only after the whole graph succeeds.
7. Final evaluation requires the holdout acknowledgement. Queueing records an
   inspection even if the run fails or is canceled. Retuning overlapping final
   dates/assets, including in another experiment, marks subsequent evidence
   `HOLDOUT_COMPROMISED`. Do not repeatedly tune the final period.
8. Results expose observations, same-date baselines, next-open costs, approximate
   date-block/issuer intervals, trial correction, time slices, missingness and
   node artifacts. These are associations; no causal or sector-neutral claim.
9. In Journal, select 2–4 successful event studies. First selection is baseline.
   Comparisons use common asset/session observations, report exclusions and
   paired contribution differences. Unselected observations contribute zero.
   Incompatible targets, costs, split windows or revised outcomes are rejected.
10. Replay creates a new run linked to the original and checks retained output
    hashes. Old code must be available; a new deployment cannot silently execute
    an old manifest under a different engine.

## Manual AI research

The **Research shelf** browses every site feature from the shared navigation
catalog. Search by topic/name, filter by topic, sort, and open the complete source
page. Data-backed sources have explicit read-only cached adapters; other pages
can be pinned as references. No source data is read until you capture it.

Cards include source/capture times, checksums, bounded selected derived fields,
and stale/missing-date/sample warnings. They exclude raw quotes, article text,
credentials and account/broker records. Cards are excerpts, not a complete copy
of every source. Open the source page to inspect the full information.

Select up to 12 cards and **Attach selected cards to graph**. They become a typed
evidence puzzle piece wired to the report context port. They appear beside the
computed results and in `site_context.json` when exported. A source update cannot
rewrite an earlier run. Current evidence cannot connect to a historical event
input or change the test's numerical results.

Unfinished graphs and hypotheses save locally in this browser under the signed
owner identity, with an explicit **Save local draft** control as well. Restoring
a draft never runs it. Server revisions still require a successful compilation.

From a successful run, download a compact/full ZIP under **Offsite research**.
Attach it in a new ChatGPT or Claude conversation and follow the embedded
`README_FOR_CHATGPT.md`. The ZIP includes an interpretation JSON Schema and
template, metrics/index, graph, frozen run specification, evaluation plan,
warnings, selection history, provenance, aggregate tables, a PNG diagnostic and
SHA-256 checksums. No credentials or raw price observations are exported.

Paste/upload the returned JSON. **Verify evidence pointers** resolves the stored
export and checks IDs, graph/plan/data hashes, metric IDs, numerical values and
units. Tolerance is max(1e-12 absolute, 1e-9 relative). Unknown fields, HTML,
invalid units/numbers and oversized documents are rejected. ZIP import and
arbitrary code/action fields are not supported.

Approve/reject appends a separate interpretation and reviewer event. Only numeric
pointers are verified. Narrative remains external opinion, visibly labeled.
Creating a follow-up makes an editable draft; it never executes, changes official
metrics, promotes evidence or places a trade.

## Access and activation

Production remains off by default. No deployment or main merge is included.
Use a staging deployment first. Configure:

```text
PRIVATE_DATA_ENABLED=1
RESEARCH_LAB_ENABLED=1
RESEARCH_LAB_OWNER_IDS=<comma-separated signed Discord sub IDs>
```

Existing R2 configuration and `SESSION_SECRET` must be complete. The session
must have both existing owner compatibility claims (`tr` and `tp`) explicitly
true. A role alone is insufficient without the Lab allowlist. Ordinary owner
tools retain their existing access rules. Mutations require the same origin.

The Lab multiplexes `/api/auth/me?lab=...`, avoiding another Vercel function and
using the cookie boundary already established by the site. Every Lab response,
including errors/ZIPs, is private/no-store. Internal objects live below
`_stonks/research-lab/<owner hash>/`; market data readers, hydration, generation
publication and GC cannot serve or overwrite them.

## Worker and operations

The browser drains jobs only during an explicitly requested run/resume. An
operator can instead advance the same queue in a separate R2-only environment:

```text
npm run worker:research-lab -- --owner=DISCORD_ID
npm run worker:research-lab -- --owner=DISCORD_ID --run=run_ID
```

Provide credentials scoped to the research namespace and read-only source data,
plus access to the Lab lease namespace. Supply no brokerage or AI credentials.
The browser and standalone worker share persisted claims/checkpoints. An
abandoned claim expires after 30 seconds; recovery retries at most three times.
Each node is bounded by 8 seconds, artifact bytes and heap growth; cancellation
is observed between claims and before publication. An in-flight synchronous node
can finish computation, but its result is not published after cancellation.

The operations view shows queue/failure counts, attempt timing/CPU/heap deltas,
artifact bytes, exports, rejections and audit events. Heap deltas are observations,
not isolated-process peak memory. No cross-run cache is used. All failed/canceled
attempts count toward the trial budget. Bonferroni familywise alpha is recorded at
registration; bootstrap tails can be coarse and later attempts invalidate a
winner-only interpretation of earlier intervals.

Ceilings: 24 nodes, 48 edges, 12 assets, 2,600 bars/asset, 40,000 input rows,
81 sensitivity combinations/asset, 4 MiB/object and ZIP, 160 KB/request,
100 KB/interpretation, 3 active jobs, 30 runs/day, 40 experiments, 200 retained
runs, 400 exports/interpretations and 12,000 journal events. The 16 MiB owner
projection ceiling stops new writes; audit artifacts are never silently expired.
CPU, requests and retained storage can cost money; the Lab has no AI inference
charge. No automatic source refresh or retention deletion is introduced.

## Evidence and data limits

Live cached prices have unverified releases, historical ingestion, revision and
corporate-action vintages, plus survivor-only coverage. They remain exploratory.
The existing streak signal is recomputed only from historical prefixes; underlying
cached data keeps the same limitations. Breadth is the selected sample, not an
exchange-wide measure. Next-open adjusted-cache prices are hypothetical fills.

Conditional price/valuation/rate stress and seeded Monte Carlo use explicit
assumptions. Simulation quantiles are not calibrated event probabilities.
Historical grade/pillar comparisons, earnings peer tests, macro/fundamental
vintages, factor-neutral trading, calibrated forecasts and options P&L stay
blocked until their missing inputs/models are audited. The catalog and compiler
give the reason. No provider history or probability is fabricated.

Journal supports explicit human rejection/retirement and gated evidence review.
Historical-validation promotion is never automatic; the final validated status
requires additional independent prospective and factor-control evidence, currently
unavailable. The prospective scorecard freezes owner-written return assumptions
at publication and later records exact-session outcomes separately. It is not a
trained forecast and cannot backdate or edit an earlier prediction.

Raw redistribution licenses are unverified. Exports therefore contain derived
aggregates and permitted scenario outputs. "Full" adds aggregate diagnostics,
not raw market data. Retained server inputs remain available for replay.

## Verification and rollback

```text
npm run test:research-lab
npm run test:research-lab-browser
npm run preview:research-lab
npm run verify:ai-cost
npm run test:private-store
npm run test:owner-restrictions
npm run test:owner-preservation
OWNER_SCOPE_BASE=1a8f450b660b7a889e63e09d90a447afe71d43a2 npm run test:owner-scope
npm run test:site-map
npm run test:render
```

Browser checks require an installed Playwright/Chromium, following the repository
preview convention. Fixtures are fictional, clearly labeled and use the actual
API/compiler/worker with isolated storage. The subprocess recovery test kills a
worker after a persisted claim and resumes it in fresh processes. It proves the
checkpoint protocol with a filesystem fixture, not live R2 service reliability.
The existing conditional-write lease has its own R2 protocol smoke tests.

Before enabling production, verify R2 conditional writes, worker recovery with
namespace-scoped credentials, license policy, real cache coverage, staging and a
rollback drill. To roll back, set `RESEARCH_LAB_ENABLED=0`, stop standalone
workers and retain objects. The API and UI disappear without touching existing
analytics, brokerage state or research records. No DB migration is required.
