# AI disruption tracker

Tracks what the frontier AI labs ship, scores how ready each capability is to
take customers from traditional software, and names the companies a launch
targets and how. Roadmap: the "AI disruption tracker roadmap" doc (2026-11-15).

**Status: Phase 1 (live collector), 2026-11-16.** The bake reads the labs'
release notes once a trading day and keeps a live launch log. No pick, grade or
gate reads any of it, and it makes no AI call (owner decision 2026-11-16:
rules-only tagging, $0).

## Public and Owner-only

Owner decision, 2026-11-15:

- **Public:** facts about lab products (the launch log, the capability board)
  and plain descriptions of which companies a launch targets and how.
- **Owner-only:** anything that scores, ranks or tests a stock. That includes
  per-stock rubric grades, the risk ranking, stock reactions after a launch and
  every test result.

This repository is public, so nothing Owner-only may be committed under
`lib/ai-disruption/`. A company row may hold only `id`, `name`, `public`,
`exposures` and `defense`; `validateRegistry` refuses any other field (a
`score`, `grade`, `tier`, `rank`, `rating` or `risk` field by name), and the
smoke test runs every description through `containsInvestmentAdvice`.
Per-stock grades live only in the private store (owner decision, 2026-11-15).

Only the site's covered names (`TICKERS`) can ever get a score. Other public
companies and private ones are mention-only (`coverageOf`): named in the log
with how they could be hurt, never priced, scored or tested.

## Files

| File | Holds |
| --- | --- |
| `lib/ai-disruption/capabilities.json` | The fixed list of capabilities (32) |
| `lib/ai-disruption/labs.json` | Labs and the official pages launches are read from |
| `lib/ai-disruption/launches.json` | One row per launch |
| `lib/ai-disruption/company-map.json` | Which companies sell each capability, as core product, add-on or adjacent, and how a launch could hurt them |
| `lib/ai-disruption/index.mjs` | Scoring and classification rules, pure functions |
| `lib/ai-disruption/collector.mjs` | Reads each lab source (feed, release notes or news page) into dated posts |
| `lib/ai-disruption/tagger.mjs` | Rules-only tagging of a post: capabilities, plans, availability, autonomy |
| `lib/ai-disruption/review.mjs` | The Owner's confirm / fix / reject decisions |
| `lib/ai-disruption/log.mjs` | The bake step: collect, fold, apply decisions, write the files |

## A launch row

`date`, `lab`, `product`, `title`, `capabilities` (ids), `how` (`direct`
replacement, `workflow` displacement, `platform` consolidation), `plans`
(`free`, `consumer`, `business`, `enterprise`, `api`), `availability`
(`preview`, `beta`, `ga`), `autonomy` (`draft`, `approve`, `unattended`),
`coverage` (0 to 5: how much of the incumbent product's core job it does),
optional `coverageBy` (a different 0-to-5 coverage for one capability of a
bundled launch), `source` (a page on one of the lab's listed sources), `sourceChecked` (the day the dated entry was read on the source page;
`null` means the date is from memory and still needs checking) and `status`
(`auto` until the Owner confirms, then `confirmed`).

## Customer-capture score

`captureScore(launch)` is 0 to 100 from seven 0-to-5 grades:

| Grade | Weight | Draft (Phase 0) | Comes from |
| --- | --- | --- | --- |
| Task coverage | 25% | 25% | `coverage` on the row |
| Reach | 10% | 20% | The widest plan it ships in |
| Autonomy | 15% | 15% | `autonomy` |
| Availability | 20% | 10% | `availability` |
| Enterprise readiness | 20% | 10% | Enterprise or business plan present |
| Integration | 5% | 10% | Connectors, or a platform launch |
| Price gap | 5% | 10% | Bundled in a plan people already pay for, or free |

A row may override any derived grade under `grades`. A launch with no plan
listed (shown or announced only) gets 0 for reach, enterprise readiness and
price gap. `capabilityBoard()` keeps, for each capability and lab, the best
score shipped so far and the launch that set it, using `coverageBy` where a
bundled launch grades that capability apart.

Weights retuned 2026-11-16 (`CAPTURE_WEIGHTS_VERSION`): on the 88-launch log,
reach and price gap averaged 4.0 and 4.1 of 5 and integration barely moved, so
together they added a near-constant that bunched scores at 60 to 75. Their
weight moved to availability and enterprise readiness, which do separate
launches. Spread 10.8 to 12.6 points, middle half 60-72 to 55-72, rank order
kept (Spearman 0.95 with the draft). This tunes separation only; whether the
score predicts anything is Phase 3's question. `node scripts/ai-disruption-tune.mjs
[ai-disruption.json]` reprints the report, on a saved live log when given one.

## What a hit does to a company

`hitsForLaunch(launch)` lists every company whose map entry shares a capability
with the launch. The outcome comes from the launch's `how` and the company's
role for that capability (`outcomeFor`):

| Role | Direct | Workflow or platform |
| --- | --- | --- |
| Core product | Obsolescence risk (flag for review) | Business-model disruption |
| Add-on | Feature commoditization | Feature commoditization |
| Adjacent | Watch | Watch |

The result is descriptive and carries no score.

## Backfill

88 launches from November 2022 to November 2026, across all six labs. 58 were read
on the lab's own pages on 2026-11-15 (Claude release notes and Anthropic news
posts, Gemini release notes, ChatGPT release notes) or, for the two newest
ChatGPT rows, on a release-notes mirror; 30 rows carry dates from memory and
`sourceChecked: null`. Known gap: OpenAI launches from December 2025 to early
February 2026 (the official page read from the build sandbox starts on
2026-02-09). The validator also checks that every capability is used by a
launch and sold by a company, that every lab has a launch, that each source
is one of the lab's listed pages, and that no date is in the future.

## Check

`node scripts/ai-disruption-smoke.mjs`

## Phase 1: the live collector

Once a trading day, on the first bake after 09:00 ET that is not a Top Picks
run (10:00, 13:30 or 16:10 ET), `updateDisruptionState` reads every source in
`labs.json` that has a `read` block, four at a time, 10 seconds each and 45
seconds for the whole read. Posts from the last 21 days that were not read
before are tagged by rules:

| Reader | Sources |
| --- | --- |
| `feed` (RSS / Atom) | OpenAI news, Google Workspace updates, the Microsoft 365 blog, the GitHub changelog (Copilot posts only), Meta newsroom (AI posts only) |
| `dated` (release-notes page) | ChatGPT, Claude and Gemini release notes |
| `cards` (news index) | Anthropic news, xAI news |

Each source fails on its own (timed out, refused, layout changed) and shows in
the health list; the rest carry on. Only Claude release notes, Anthropic news
and the Microsoft blog feed were reachable from the build sandbox when this
was written; the others prove out on the first live run.

**Tagging (`tagger.mjs`), rules only.** One keyword rule per capability (title
first, the post body only when the title names none), plus rules for plans,
availability, autonomy and how it hits. A post goes:

- **into the log** with `status: "auto"` when it names a capability, a product
  and a plan, has launch words, and does not read as company news;
- **to the Owner review queue** with the rules' best guess and the reasons when
  any of those is missing;
- **nowhere** (listed under skipped) when it is company news with no capability
  (funding, the IPO, hires, policy, papers), not about AI on a general
  newsroom, or not a Copilot post on the GitHub changelog.

Coverage is the one judgment rules cannot make: auto rows get a cautious 2,
plus 1 when sold (GA) and 1 when it works unattended. A post matching a launch
already in the log (same lab, within three days, same link or titles sharing
half their words) is dropped as a duplicate. Collected rows cite the lab's
listed page in `source` and the post itself in `link`.

On the backfill's own titles the capability rules agree with the hand tags on
at least 90% of the titles they tag (the smoke test holds this).

**Review.** The Owner confirms a row, fixes its tags (the fix confirms it) or
rejects it, for any launch including the 88 backfilled ones, and confirms or
fixes a queue item into the log. Decisions live in `ai-disruption-review.json`
(Owner-only, request-time-owned, `POST /api/auth/ai-disruption-review`
`{ act: confirm|edit|reject|undo, id, fields? }`, same-origin, under the
`ai-disruption-review` lease). Every bake applies them; a fix that leaves a
row incomplete keeps the item in the queue with what it still needs. The
Owner file reports how often the rules' tags were kept as they were
(`review.rulesKept`), the measure of whether rules-only tagging is good enough.

**Files.**

| Key | Access | Holds |
| --- | --- | --- |
| `ai-disruption.json` | public | the merged log (registry + collected, decisions applied) with each launch's score and the companies it targets, the capability board, capabilities, labs, the company map (facts only), source health |
| `ai-disruption-owner.json` | Owner | the review queue, skipped posts, run log, decision counts and history, launch pressure per capability |
| `ai-disruption-state.json` | Owner internal | every post read, the collected rows, the queue, source health; read before the wipe, never served |
| `ai-disruption-review.json` | Owner, request-time | the Owner's decisions |

**Switch.** `AI_DISRUPTION=0` (repo variable in `daily.yml`, or Owner Settings,
Data & desks) stops the reads; the log is rebuilt from the last state, marked
stale, and decisions still apply.

Test: `node scripts/ai-disruption-collector-smoke.mjs` (made-up pages, a
stand-in fetch; no network).

