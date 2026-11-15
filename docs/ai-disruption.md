# AI disruption tracker

Tracks what the frontier AI labs ship, scores how ready each capability is to
take customers from traditional software, and names the companies a launch
targets and how. Roadmap: the "AI disruption tracker roadmap" doc (2026-11-15).

**Status: Phase 0 (registry and backfill).** Nothing reads this yet. No build
step, page, MCP tool, pick or grade uses it, and it makes no network or AI call.

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

| Grade | Weight | Comes from |
| --- | --- | --- |
| Task coverage | 25% | `coverage` on the row |
| Reach | 20% | The widest plan it ships in |
| Autonomy | 15% | `autonomy` |
| Availability | 10% | `availability` |
| Enterprise readiness | 10% | Enterprise or business plan present |
| Integration | 10% | Connectors, or a platform launch |
| Price gap | 10% | Bundled in a plan people already pay for, or free |

A row may override any derived grade under `grades`. A launch with no plan
listed (shown or announced only) gets 0 for reach, enterprise readiness and
price gap. `capabilityBoard()` keeps, for each capability and lab, the best
score shipped so far and the launch that set it, using `coverageBy` where a
bundled launch grades that capability apart.

Known limit: most shipped launches land between 60 and 75, so the board ranks
better than it separates. The weights are a first draft and get tuned in
Phase 1, once the live log has enough rows to test them.

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
