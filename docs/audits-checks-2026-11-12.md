# Last-ten-branch audit, November 12, 2026

The audit runs on `Audits-checks`, based on current `origin/main` at
`5187aa091aabc1b7cdf8296ce6aef8ea2e7c2370`. The local `main` was older, so the
audit branch was fast-forwarded before testing. Other worktrees were unchanged.

## Branch scope

These are the ten newest remote feature branches by tip commit date after a
fresh fetch. Each is already integrated into the audited main revision.

1. `sports-bet-types`, [PR #814](https://github.com/lilseancoc-png/stonks/pull/814): game bets, parlays, odds formats, shared-number pricing, and settlement.
2. `history-rhymes`, [PR #813](https://github.com/lilseancoc-png/stonks/pull/813): Booms & busts, credit estimates, warning signs, and connected research.
3. `sports-team-bets`, [PR #812](https://github.com/lilseancoc-png/stonks/pull/812): team forecasts, player pages, and separate sportsbook requests.
4. `audit-everything`, [PR #811](https://github.com/lilseancoc-png/stonks/pull/811): publication, issuer attribution, and source health.
5. `fix-dead-buttons`, [PR #810](https://github.com/lilseancoc-png/stonks/pull/810): refresh and retry feedback.
6. `sports-data-integrity`, [PR #808](https://github.com/lilseancoc-png/stonks/pull/808): snaps, injuries, box scores, lines, and data checks.
7. `sports-audit`, [PR #807](https://github.com/lilseancoc-png/stonks/pull/807): availability, absence adjustments, and missing stat lines.
8. `sports-player-layout`, [PR #806](https://github.com/lilseancoc-png/stonks/pull/806): chart width and label spacing.
9. `sports-model-more-stats`, [PR #805](https://github.com/lilseancoc-png/stonks/pull/805): stat models, combinations, teammates out, and real-line checks.
10. `sports-odds-honesty`, [PR #804](https://github.com/lilseancoc-png/stonks/pull/804): book prices, margin removal, and probability ranges.

## Confirmed repairs

- **Parlay profit ranges:** a $10 shared-number example returned $5.39 expected profit but a range of $4.44 to $4.44. The range now prices the complete outcome tables at both correlation endpoints, including reduced payouts after pushes. Missing links no longer produce an all-win-only profit bound when pushes can pay. Existing player-only point estimates and simulation seeds remain covered by the comparison tests.
- **Push wording:** the Pick Builder explains that expected return includes push refunds while the all-win fair odds and break-even line exclude them. A phone and desktop browser regression exercises a whole-point spread.
- **Rounded inputs:** the server rejects a sub-cent stake that would save as $0. It also validates chances after rounding, so accepted values cannot become 0% or 100%.
- **Booms & busts missing growth:** a falling semiconductor ETF no longer establishes that suppliers are falling while spending rises when spending growth is unavailable.
- **Booms & busts negative cash flow:** known positive capital spending with negative aggregate operating cash flow lights the funding-strain sign. It no longer reads as missing data or divides by a nonpositive denominator.
- **Inbox ordering:** when messages share a millisecond, the latest append appears first. Reading the inbox preserves the stored order.
- **Dependency security:** `undici` moves from 6.28.0 to 6.29.1 and `zod` from 4.1.11 to 4.6.7. An exact scoped override selects the patched Zod release for `@vercel/cli-config`. The second audit removed an unnecessary storage SDK upgrade: `@vercel/blob` remains at 2.6.1. A fresh registry audit still reports zero vulnerabilities, down from five high-severity findings.
- **Audit reliability:** the isolation and market-cost checks use the current remote integration base. The research inventory checks the shared streak rule instead of its retired inline implementation. The cached Streaks browser preview supplies the Owner role it tests. The earnings-call font check resolves the current control atomically rather than reading a detached element during a redraw.

The second audit found the first dependency-cost exception was too broad: an
unrelated override could pass because overrides were omitted from comparison.
The replacement permits only the exact two reviewed version transitions and
the exact scoped Zod override. Package paths, direct ranges, and every other
configuration and dependency metadata field must match. New regressions reject
unrelated overrides, loose override ranges, unreviewed minor upgrades, additions,
major changes, downgrades, alternate download sites, and installation scripts.
The guards for schedules, provider budgets, serverless functions, and storage
changes remain in place.

## Second audit: reproduced failures and additional repairs

`scripts/audit-fix-proof.mjs` archives the unchanged integration base above and
runs the same probes against that source and the working tree, using the same
installed dependencies. It asserts all twelve before-and-after outcomes and
prints machine-readable evidence. The original seven failing scenarios all
reproduce; none was inferred only from a passing new test.

The second pass also repaired five additional product defects:

- **Quarter-point suggestions:** the live NBA game `401909977` carried a 221.25 total and -10.25 home margin. Medians across books can produce quarter points, while Pick Builder accepts whole or half lines. The old suggested value failed its own entry validation. Suggestions now use the nearest half point; source consensus values remain unchanged. A phone and desktop browser test exercises the add button with a 221.25 consensus.
- **Impossible player ranges:** over 10 points and under 11 points previously passed, although no integer score wins both. Validation now checks for an attainable value strictly between the lines.
- **Fractional fantasy ranges:** over 10 and under 10.5 fantasy points previously failed, despite valid fractional scores such as 10.2. Fantasy scoring uses tenths; other supported player counts use whole numbers.
- **Separate games:** the same player's same stat in two different games was rejected as a duplicate. Both server and page duplicate checks now include the game id.
- **Push and edge consistency:** a chosen 99.99% win chance plus a model's 1.36% push chance previously made the leg total exceed 100%. The outcome pricer already capped pushes, but the leg's edge used the uncapped value. Both now use the same feasible push chance, and the original model forecast remains separately available. A one-leg parlay's displayed edge equals its entry return calculation.

Each new regression failed before its repair and passes after it. The audit
runner also rejects a filter that matches no checks, preventing a misleading
successful run with zero tests.

## Verification results

- 170 distinct non-browser regression commands pass on the second full run. Discovery covers the constituent tests from `test:*` and `verify:*`, environment variants, standalone smoke tests, the research self-test, the market-cost check, and the original-code proof. The older branch aggregator also runs separately.
- All 35 browser commands pass after the two failing test setups were repaired and rerun. A second full browser run covers the additional fixes.
- 644 tracked and new JavaScript modules pass syntax checks on the second full run. The final edited modules also pass their direct runtime checks.
- The layout sweep checks 138 page loads at 390 and 1440 pixels. This sweep uses empty-state data. Separate feature suites exercise populated synthetic data, including light and dark themes, retry failures, charts, filters, tables, exports, and navigation.
- The Owner access browser suite passes 564 route and access checks. The Sports browser suite passes 350 checks for anonymous visitors, members, and Owners. Pick Builder passes 195 checks, the team model and calculator suite 109, and the joint-pricing suite 128.
- The offline Webull audit passes all 22 commands. The older fixed branch-review runner passes all 36 commands. These repeat some suites already counted above.
- The current schema, API, publication, source-health, workflow, isolation, and incremental-cost checks pass. Regenerated browser assets preserve the embedded data manifest and risk-free-rate provenance. `git diff --check` passes.
- Screenshots of the Sports player page, phone Pick Builder odds, and phone Booms & busts page were visually inspected.
- A six-pick, 100,000-draw local comparison takes 60 ms after the repair versus 41 ms before it. The all-win chance and central expected profit match; the return range now includes push payouts. This is one local timing sample.

The audit runner writes individual logs and `results.json` under
`$TMPDIR/stonks-audits-checks/`. `AUDIT_OUTPUT` selects another directory and
`AUDIT_FILTER` restricts the commands. `--list` prints the discovered inventory.

```sh
node scripts/audit-checks.mjs --unit
node scripts/audit-checks.mjs --syntax
node scripts/audit-checks.mjs --browser
node scripts/audit-fix-proof.mjs
npm audit --omit=dev
```

Browser checks require Playwright and Chromium. `PLAYWRIGHT_MODULE` can point to
an external installation. `PLAYWRIGHT_BROWSERS_PATH` selects its browser cache.
The runner removes provider, broker, session, and storage credentials from
child environments. It does not run a full build or a collection job.
Second-pass logs are in `/private/tmp/stonks-second-audit/`; the original-code
comparison is also saved as `$TMPDIR/stonks-fix-proof.json`.

## Data observations and remaining limits

Live Owner MCP reads on November 12 confirm that NBA and NFL model summaries,
upcoming games, game lines, and team-bet prices are readable. Both model records
were generated around 03:10 UTC. NBA consensus lines carried a 09:44 UTC
observation. The NFL example gives complementary win-by-3 yes and no chances
of 52.39% and 47.61%, and the equivalent -2.5 spread agrees. These checks verify
the saved data paths and calculation consistency, not independent forecast
accuracy.

A second read at 10:35 UTC confirms the same saved NBA and NFL model records
remain readable. Both team models report `ok`; the NBA spread check correctly
reports `no_data` because its saved training set has no historical market lines.
These are the system's saved checks, not an independent forecast validation.

At the live read, Booms & busts had no saved payload yet. Its code had just
merged; the first scheduled full build still needed to generate that file.
Its populated and missing-file UI paths pass the local browser suite.

The local historical source cache is dated October 25 and its derived payload
October 27. The exact snapshot rebuild audit fails against today's code because
the old cache predates the expanded index catalog and corrected election-window
definitions. This is a dated local-data limitation, not evidence that current
production has the same defect. The local calendar, streak calculations,
research inventory, data-stack inventory, synthetic full-universe research
audit, and strategy-risk audit run successfully.

The earnings forecast's source documents and state, the point-in-time Top Picks
market study, a full SEC ownership snapshot, raw historical provider downloads,
and saved transcript workflow logs are unavailable locally. Their dedicated
artifact audits remain unverified. Their fixture-based regression suites pass.
No missing artifact was replaced with synthetic data and described as live.

No paid full build, authenticated production-browser session, workflow
dispatch, production storage write, broker mutation, or order placement was
performed. These results were captured on `Audits-checks` before publication;
the audit did not verify a production deployment of the fixes.
