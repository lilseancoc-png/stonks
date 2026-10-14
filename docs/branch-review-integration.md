# Reviewed branch integration

This candidate combines all ten branches in the October 13 screenshot against main at `9c59eead014a0fae85df30db6bf9946f41e64341`. It resolves overlapping build hooks, ownership and privacy policies, freshness checks, package scripts, and changelog entries. Main is unchanged until this candidate is explicitly merged.

## Repairs by branch

- `feat/evidence-record`: reject missing numeric readings, use the closing move written by the volume producer, and publish through the verified sync boundary. Bound normal history hydration.
- `feat/ai-rejection-scoring`: bound wait promotions to five actual trading sessions; keep the generated scorecard local. Bound normal history hydration.
- `fix/sync-data-seed-owner-keys`: use the same local-scorecard exclusion for bake, seed, and pull; route scanner pulls without dated archives and backtests with full archives.
- `feat/leaps-expirations`: reject unavailable trend and IV fields before shortlist selection.
- `feat/leaps-paper-track`: reject occupied roll destinations before closing the original position; normal marks and required exits continue.
- `perf/ai-call-efficiency`: protect final research and grading call reserves from charts and universe-wide extraction. Existing daily limits remain.
- `feat/link-map`: resolve the privacy-toggle test through a temporary file module so shared policy imports work.
- `fix/story-detection-collapse`, `feat/leaps-contract-pricer`, `feat/leaps-pillar-weights`: no additional defect confirmed in the review; original implementations retained.

## Verification

Run `npm run test:branches` for 35 offline check commands, including the 461-assertion Top Picks check and the freshness self-test. Credentials are removed from the child test environment. Fake stores prove that a normal bake reads only 121 dated archive records, scanners read none of these archives, and full backtests can still download all retained records. Traversal and incomplete snapshot checks preserve the last-good local data.

A separate real-handler fixture passed 40 Owner-session and cache cases across eight private keys. Rendered HTML, JavaScript, and CSS match current main for identical story fixtures. The prior desktop and phone browser review found existing Narratives clipping at 390 pixels on both main and the candidate. This candidate does not alter the renderer.

## Limits

No paid Gemini build, production storage write, real trade, or workflow dispatch was used for verification. Real invoices and account allowances were not inspected. Call/token limits do not guarantee a specific dollar bill. Dated archives remain retained remotely, so manifest size and long-term storage still need monitoring. LEAPS modules remain separate foundations: the current setup hook yields unknown and the paper ideas hook is empty; this change does not turn them into a complete live LEAPS desk.
