# Entry policy review, October 23, 2026

## Approved implementation

- Change the strategy earnings window from 21 to 14 calendar days.
- Single-option absolute delta is 0.30–0.50, preferred 0.40. The OTM ceiling is 15%. Spread delta targets stay unchanged.
- Give admission, display and tracking one underlying stock plan.
- Require modeled option economics to support a Buy; keep failures as watch ideas.
- Separate LEAPS research qualification from entry timing. Preserve its current score weights pending a later redesign.

## Shared stock plan

Two designs were considered. Using the existing exit calculator as the admission plan would replace observed nearby invalidation with a 5–12% percentage/ATR stop and would change existing timing eligibility substantially. Using the confirmed-bar entry structure preserves the existing timing evidence and names the actual level whose failure invalidates the setup. The latter is the chosen authority.

The plan uses the nearest eligible price-derived anchor, a 0.25-ATR invalidation buffer, and prior directional resistance/support where available. Without an observed target it retains the explicitly labeled 2.5-ATR projection. The existing 2-ATR structure and 1.5:1 payoff prerequisites remain. A credit spread retains its short-strike defense as an additional, potentially earlier vehicle exit; it does not redefine the underlying thesis.

## Option feasibility check

The first version evaluates the selected contract at the shared stock target and invalidation after 14 calendar days. This is a planning horizon, not a new time stop. Entry crosses current quotes; estimated future liquidation subtracts current half-spread widths. Configurable per-leg fees default to zero and are labeled unestimated. All calculations are per share, with the usual 100 multiplier for displayed dollars.

The flat-IV target scenario must support the existing managed premium profit threshold: 25% for purchased options/debit spreads, 50% of credit for credit spreads. IV at 80% and 120% of its entry value is also shown, without probabilities. Missing plans, quotes or runway cannot produce a Buy. Impossible theoretical spread values remain unavailable rather than being clipped into profit. Vertical direction must match the stock view, and a credit spread cannot begin beyond its own short-strike defense. The existing debit reward/risk and credit share-of-width minimums must also pass after quote costs. This screen measures modeled feasibility, not expected return, calibrated win probability or guaranteed execution. The model assumes European exercise and zero dividends; American exercise, event jumps and future spreads remain limitations.

This check does not impose a new dollar-premium or account-exposure cap. A costly contract can still qualify if the target supports its managed profit exit. Existing premium and sizing limits still apply. Account risk remains trader-controlled and unchanged in this work.

An alternative that required positive expected return was rejected because the engine has no calibrated probabilities for stock targets, timing or IV outcomes. An alternative that optimized every possible structure would exceed this approved feasibility-screen scope. Stress scenarios remain visible rather than silently adding another unvalidated veto.

New enrollments carry the entry policy version and economic audit. Existing recorded trades keep their stored targets, stops and history. No track-record reset is part of this change.

## Permitted contract comparison

The preferred strategy remains authoritative. A long may use another eligible long or a debit spread; a credit spread may use another eligible credit spread or a debit spread; a debit recommendation remains debit-only. Earnings, IV, skew, delta, liquidity, width, quality and 30–90 DTE restrictions still apply. No extra expirations are fetched.

The search checks all qualifying single options in existing quality order. For spreads, it checks up to four anchors nearest the existing delta target and four qualifying wings per anchor per fetched expiration. Original anchor/wing pairs are checked first in quality order, then alternatives. The first feasible contract in the preferred structure wins; only when those fail does a permitted fallback run. If none clears, the best original candidate remains a watch idea with the failed audit. This bounded search does not promise a global optimum.

Actionable and watch rosters retain separate sector, factor and side counters so an economic Wait cannot consume a Buy slot. Account sizing is unchanged.

The economics audit records tested counts, permitted structures, the original and selected contract identities, and why an alternative was used. That compact summary survives archival; the full search grid is never stored or sent to AI.

## Volatility-aware knife and exhaustion policy

Timing version 4 uses the stock's own prior 14-session true-range average. For a one-, three- or five-session move, the ATR reference ends before the entire tested window. A shock therefore cannot increase its own permitted size. Returns over several sessions scale ATR by the square root of the number of sessions. These are explicit calibration choices for forward evaluation, not statistically proven cutoffs.

- Knife candidate: adverse move ≥ max(3%, 2 × ATR%) in one session, or max(4%, 1.5 × √3 × ATR%) over three. The ordinary veto still needs two breakdown traits.
- Severe knife: adverse move ≥ max(5%, 2.75 × ATR%) in one session, or max(7%, 2.3 × √3 × ATR%) over three.
- Countertrend adjustment: multiply ATR terms by 0.75; retain the percentage floors.
- Emergency veto: adverse 20% one-session or 30% three-session move, even for volatile names. A directional 40% five-session run remains an emergency exhaustion veto.
- SMA20 extension: mild needs ≥2% and ≥1.33 prior ATR; soft ≥4% and ≥2.67 ATR; extreme ≥8% and ≥5 ATR; catastrophic ≥15% and ≥8 ATR.
- Five-session directional run: soft/exreme/catastrophic thresholds are max(5%, 1.2 × √5 × ATR%), max(8%, 1.8 × √5 × ATR%), and max(15%, 3 × √5 × ATR%).
- RSI 72/80 remains soft/extreme evidence. RSI 88 alone no longer creates a catastrophic veto; the normalized extreme extension and run must also be present. The existing two-extremes-plus-rollover/1.8x-volume rule remains, as does the 4-sigma/4-prior-ATR/confirmed-volume catastrophic path.
- Unavailable prior ATR retains the legacy percentage fallback, labeled explicitly. A relaxed knife reading never bypasses momentum, structure, payoff, event or reclaim prerequisites.

## Further review

Fresh reclaim, expiry expansion, account sizing and LEAPS score weights remain unchanged. Countertrend Go still requires a fresh confirmed 20D cross, so a held rebound can miss that prerequisite. No current comparison establishes that relaxing it improves option returns. Historical profit percentages across policy versions cannot establish causal improvement; compare forward outcomes after costs.

## Incremental operating cost check

Run `npm run verify:risk-cost`. The offline check compares the working engine with HEAD, blocks network requests during evaluation, verifies unchanged network/model/write call-site counts, provider model/cap settings, workflow/API/dependency/storage files, and AI prompt construction. It benchmarks ordinary selection, a stressed 14-expiration search and timing, and measures the added audit bytes.

Local measurements on October 23 ranged from approximately 0.3–2.4 ms for ordinary selection and 4–48 ms for a 14-expiration search testing 124 contracts. Timing ranged from approximately 0.08–1.2 ms. Timings varied between runs; these are observed ranges rather than service-level guarantees. The compact comparison was about 451 bytes per serialized copy, and the volatility audit about 508 bytes. Existing payloads carry these fields; there are no new storage operations, providers, scheduled jobs, market-data fetches or model calls per alternative. Runtime measurements vary and are not a billing measurement.

Policy signatures and changed eligibility can refresh existing capped AI slots on rollout or change which names receive them. The existing thesis slot limit, model, prompt construction, retries and daily budget controls remain unchanged. Zero additional provider call sites does not guarantee identical account spending.

## Verification

See [risk-analysis-audit.md](risk-analysis-audit.md) for reproduced defects, repairs and verification limits. Run `npm run test:risk-audit`, `npm run test:risk-selection`, `npm run test:entry-policy`, `npm run test:picks`, `npm run test:leaps-score`, `npm run test:track-record-fills` and `npm run test:render`. The entry-policy test exercises actual roster construction with a strong AI Buy verdict, checks economic demotion, the 14/15-day earnings boundary, single and spread delta independence, shared levels, credit defense through splits and research qualification across Go/Wait/Avoid.

For local screen verification, `node scripts/entry-policy-preview.mjs` serves synthetic pipeline output on `127.0.0.1:4178`. Its fixture server makes no upstream or trading calls. This verifies rendering and decision propagation, not the current six live recommendations or realized investment performance.
