# Research Lab implementation decisions

## Shape and usage

Owner captures cached data, edits a graph and numbered revision, registers an
evaluation plan, compiles, queues a run, inspects results, compares, exports,
and previews/approves external commentary. Every step is an explicit owner action.

The registry owns typed contracts; compiler owns canonicalization; pure research
functions own numerical outputs; repository owns immutable records and trial/
holdout events; worker owns persisted attempts; exchange owns export allowlists
and evidence-pointer verification. Browser owns only editable graph/layout state.

## Canvas

Use native HTML node controls and SVG edges with an accessible keyboard connection
form, zoom, minimap and undo/redo. React Flow would require a new frontend stack.
A JSON-only editor would miss the blueprint's visual workflow. No new browser CDN
or graph dependencies. Graph/layout saves are explicit numbered revisions.

## Persistence and queue

Reuse R2 raw objects under an internal owner-hashed namespace. Immutable objects
are content-addressed; a bounded per-owner state projection is published under an
R2 conditional-write lease. The event list is append-only in that projection.
No market publication manifest, broker state or Supabase migration is changed.
Each mutation checks lease validity immediately before the projection commit.

Jobs checkpoint one bounded node per advance request, persisting RUNNING attempts
before computation and publishing outputs before the next checkpoint. Explicit
browser advancement or the standalone CLI worker drains the durable queue.
Closing the browser pauses advancement; reopening resumes. There is no new cron,
always-on process or paid queue service. R2 is required; Blob does not silently
fall back to a process-local lock. Abandoned attempts retry with a bounded limit.
No cache is claimed across code/data/permission changes. Replays require exact
frozen manifests or fail with CODE_VERSION_UNAVAILABLE.

An external DB/queue would improve throughput and transaction scale but introduces
services and cost beyond this owner-only bounded workload. An in-memory queue
would lose jobs on restart. Limits cap state, runs, rows, node/grid counts, bytes
and runtime; hitting a retention quota stops new work rather than deleting audit.

## Cost, rollout and rollback

No Lab AI SDK, inference call, provider call or scheduled workflow. Interpretation
is manual in ChatGPT or Claude. CPU, R2 storage and request usage still exist.
The initial default-off rollout was superseded by the owner's visibility
requirement. Existing signed Owner access and `PRIVATE_DATA_ENABLED=1` enable
the Lab without a second flag or account list. R2 remains required for records.
Setting `RESEARCH_LAB_ENABLED=0` stops API/worker execution while keeping the
Owner destination visible with a disabled message. Retain internal records.
Live R2 recovery and operational rollback still need staging verification.
Additive objects need no DB DDL.

## Connected board upgrade, October 31, 2026

Two shapes were sketched against the NVDA workflow before implementation:

- One expanded execution graph: `evidence -> signal -> study -> report`. Every
  narrative link would require a typed execution meaning. Letting today's
  earnings or a political assumption drive a historical event would undermine
  the compiler's existing time and unit checks.
- A separate reasoning board: `dated evidence -> owner assumption -> possible
  outcome -> stock`, with supporting and challenging links. Explicit numeric
  assumptions feed small conditional models. Historical studies remain separate.

The second shape owns the new default experience. A plain list of notes was
also considered, but does not express the connected puzzle the owner requested.
The board and execution graph share the existing signed Owner API boundary and
cached evidence adapter. They keep different schemas and persistence rules.

`lib/research-lab/board.mjs` owns the board schema, templates, link validity,
conditional calculations and written research brief. The browser client owns
interaction, owner-scoped IndexedDB drafts, attachments and portable exports.
The existing evidence service owns read-only, bounded source captures. Its
company selector filters issuer records before truncation. Its Party tracker
adapter selects joint-control chapters before projecting fields. Both retain
source time, capture time, checksum and missingness information.

The board does not require an execution run, price history, an evaluation plan
or R2 to edit and export local reasoning. Dated site capture still requires the
existing API/storage service. Local file content is never sent to that API.
Original PDFs and Word documents remain attachments; automatic extraction would
require a parser and a separate text/coverage contract. The export says this
explicitly. Browser print provides PDF output without a new rendering service.

The main risks are loss of browser-local data and overreading a drawn link as
causation. Portable JSON/ZIP backups address the first. Distinct observed-source,
assumption and outcome blocks, explicit driver units, missing-input withholding,
and written relationship explanations address the second. No probabilities or
political market responses are generated from a connection alone.
