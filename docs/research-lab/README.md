# Research Lab

An owner-only visual workspace for connected research and historical studies. Numerical work
runs deterministically on the site. Interpretation happens manually in a separate
ChatGPT or Claude chat. There are no Lab AI API calls, new provider fetches,
subscriptions, browser dependencies or scheduled research jobs.

## Build a connected research puzzle

**Research board** opens by default. It works before you capture price history or
register a statistical test. Choose **NVDA & AI spending**, **Election, oil &
bonds**, or start a blank board.

1. Add stocks or ETFs from the site's full coverage list. Add a question,
   assumption or possible outcome from the block shelf.
2. Browse **Every site feature** and add each useful source as its own block.
   Select a block and click **Load site evidence** to read its existing cache.
   Choose a symbol to capture that company's records. Missing company coverage
   remains explicit. Sources without a cached adapter become reference cards.
3. Drag any card body to move it. Drag empty canvas space to pan. Use **Expand
   canvas** for a larger working area. Click a right dot and a left dot, or drag
   between them, to connect blocks. The details panel also has a connection form.
4. Explain the link and choose **Could affect**, **Supports the reasoning**, or
   **Challenges the reasoning**. Click a card or link to select it. Delete or
   Backspace removes the selection; text fields retain normal keyboard editing.
   **Edit** opens a card’s details and brings them into view on smaller screens.
   Undo restores blocks with their links. Arrow keys move focused cards.
5. For a numerical outcome, select its model and use **Add required assumptions**.
   This creates and connects the missing driver blocks. **Go to next missing
   piece** takes you to an unfilled assumption or unloaded source. You can also
   connect assumption blocks directly. Revenue,
   net margin and earnings-multiple changes multiply with shares unchanged.
   Margin changes are relative percentages, not percentage points. Bond stress
   uses an explicitly assumed duration and yield change in basis points. Every
   required driver needs exactly one filled assumption, including explicit zero
   for unchanged. Missing or duplicate drivers withhold the result. Qualitative
   reasoning does not silently become a numeric forecast.
6. Import PDF, Word, CSV, TXT, Markdown or JSON files as document blocks. PDF and
   Word originals are retained; text is not automatically extracted. Use notes
   for relevant passages and interpretations. Text documents accept UTF-8 up to
   50,000 characters. Attachments stay in this browser, up to 4 MB per document
   and 8 MB per board. The board supports 60 blocks and 120 links.
7. Export an **AI review bundle** with the reasoning, graph, evidence excerpts,
   checksums, readable report, editable board and original attachments. JSON
   preserves the whole editable project. Markdown, HTML and CSV are additional
   written exports. **Print / Save PDF** opens the graph and brief in the browser
   print dialog. Written exports do not embed the original binary attachments.
   A persistent link to the latest prepared file lets you download it again if
   the browser blocks or misses the automatic download.

The political example has separate historical evidence blocks for each Senate
alternative. President, House and Senate selectors match the stored Party
tracker's actual joint-control chapters. Captures include those periods' dates
and rounded market returns. They do not infer a tariff change, Iran policy, oil
response or election probability. Change a filter and load its evidence to
compare a different combination.

Boards and attachments autosave to IndexedDB under the signed owner identity.
A damaged saved draft is retained for download and cannot be overwritten by
automatic saving. Replacing it requires the explicit replacement control.
**Save board** waits for the local save. Export JSON for a portable backup; this
board is not a server revision or a cloud-synced record. JSON import previews the
project and checks attachment hashes before opening it. Opening an imported board
or replacing a nonempty board with a starting map downloads the current board as
a backup. Imported source excerpts remain unverified; their checksums do not
establish authenticity. Document content is treated as source material, never
instructions to run. No board action executes AI calls or broker actions.

## Run a historical study

Open **Historical studies** for the existing typed experiment tools. These keep
separate graph, compiler and evaluation-plan rules. A board link does not qualify
as a historical signal or override a study's metrics.

1. Open **Owner → Research Lab** in your existing signed-in Owner session.
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

Research Lab appears under **Owner → Research Lab** with the site's existing
signed-in Owner access. No additional activation flag or account list is needed.
The existing `PRIVATE_DATA_ENABLED=1`, R2 configuration and `SESSION_SECRET` must
be complete. The session must have both existing Owner compatibility claims
(`tr` and `tp`) explicitly true and a signed account identity. Each owner's
research remains isolated. Mutations require the same origin.

The optional `RESEARCH_LAB_ENABLED=0` rollback switch stops API and worker
execution. Owners still see the destination with a temporarily disabled message.

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
npm run test:research-board
npm run test:research-board-browser
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

Live R2 conditional writes, worker recovery with namespace-scoped credentials,
license policy and real cache coverage still need staging verification. To roll
back, set `RESEARCH_LAB_ENABLED=0`, stop standalone workers and retain objects.
The API stops execution and the visible Owner destination explains that the Lab
is temporarily disabled. Existing analytics, brokerage state and research records
are retained. No DB migration is required.
