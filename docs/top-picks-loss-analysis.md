# Top Picks loss analysis — why the resolved book lost

A post-mortem on the resolved Top Picks track record, run to answer one question:
**why did the picks lose, and what do we change in the model?** The findings drove
two concrete engine changes (re-entry suppression + the +20% TP / −30% snap exit);
the rest is a watch-list for the next recalibration.

> **Data.** The live `data/` is private (Path B), so this analysis was run against
> the last fully-committed snapshot recoverable from git history (`chore: daily
> refresh 2026-06-06`): **38 closed picks + 69 open**. That snapshot predates the
> later scoring reworks (it carries old ±16-scale scores and 0.26–0.39Δ OTM
> contracts), so several failure modes below are *already* mitigated by shipped work
> — but the **repeat-entry** and **stop-asymmetry** findings were not, and are what
> the two new changes fix. Re-run `node scripts/diagnose-pick-losses.mjs` against a
> hydrated `data/` (after `node scripts/sync-data.mjs pull`) once the live store has
> re-accumulated to refresh these numbers.

---

## The headline numbers

`scripts/diagnose-pick-losses.mjs` (models each closed pick's option P&L with
Black-Scholes, entry IV implied from the stored mid, held to exit):

| Metric | Value |
|---|---|
| Modeled option win rate | **11%** (4 W / 34 L) |
| Underlying expectancy (side-adjusted) | **−7.6%** |
| **Modeled option expectancy** | **−39.1%** |
| Avg live round-trip spread (charged on top) | **25.4%** |
| Loss attribution | **100% direction-driven** (0% theta/vol) |
| Sides in the closed book | **38 / 38 calls** (zero puts) |

The 4 wins were all LLY (×3) and one OKTA call. Everything else was a long call
that fell.

---

## Why they lost (root causes)

1. **Pure long-bias into a broad risk-off tape.** Every closed pick was a *call*.
   The window the book resolved in (2026-06-01 → 06-05) was a coordinated tech/semis
   drawdown — QQQ −5.5% / 3d, SPY −2.9% / 3d, and the high-beta names led it down
   (AVGO −20% / 3d, PLTR −13%, NVDA −8%, AMAT −10% / 1d). The engine had **no put
   exposure** and kept buying calls into the decline. *Mitigation status:* the
   cross-sectional rework + macro-regime gauge + risk-off tactical puts now let the
   book go net-short; the recovered snapshot's own regen already grades the tape
   risk-off and ships puts.

2. **Direction was wrong, not the vehicle.** 100% of losses are classed
   direction-driven (the stock moved against the trade), *not* theta/vol bleed on a
   flat stock. So verticals/structure only *shrink* a wrong-side loss — the leverage
   is in the **signal** (don't buy the top) and in **standing down**. *Mitigation:*
   entry-timing folded into the grade, the confluence gate, require-`go`.

3. **Bought the top — MFE ≈ 0.** Most losers had a max-favorable-excursion near
   **0%** (FDX, MSFT, CRM, MDB, ADBE all ≈ 0): they fell the instant they were
   bought. Classic chasing-extended / falling-knife entries. *Mitigation:* the
   `computeEntryTiming` chasing-top / falling-knife penalty (§6).

4. **Fragile OTM contracts.** 0.26–0.39Δ, 5–28% OTM, so a routine ~8% adverse
   underlying move = **−40% to −97%** on the option. *Mitigation:* P1.1 moved the
   target to ~0.55Δ near-the-money.

5. **The same losing thesis, restacked over and over (NOT previously mitigated).**
   Across the open+closed record there were **107 tracked entries on just 45 distinct
   symbols** — **~58% were repeats** of an already-tracked name: **CRM ×7, AMAT ×6,
   TSM ×6, LLY ×5, PLTR ×5, OKTA ×5**. Exactly **half (17 of 34)** of the resolved
   losses were repeat entries. The engine re-shipped a high-grade name every hourly
   build (and `pickContractForPick` churned the strike into a fresh enrollment), so
   one bad macro window on a correlated set of names became a *pile* of correlated
   losses. → **Fixed by re-entry suppression.**

6. **Asymmetric stop the moves blew through (NOT previously mitigated).** The
   modeled option loss averaged **−63%** even though the underlying only moved ~−9.6%
   — symmetric on the stock, wildly asymmetric on the option, and the old −35%
   premium stop + +60% trailing TP let the loss run far past −35% between build
   samples while rarely banking a gain. → **Fixed by the +20% TP / −30% snap exit.**

---

## What changed in the model (this PR)

- **Re-entry suppression** (`PICKS_SUPPRESS_OPEN_REENTRY`, default ON). A ticker with
  an open tracked position is dropped from candidacy before ranking — it enters
  **once**, is tracked to resolution, then becomes eligible again. Directly removes
  root cause #5 (and the correlated-restacking amplifier on #1). Rubric §7.
- **+20% take-profit / −30% snap stop** (`PICKS_OPT_TP_PCT`/`PICKS_OPT_STOP_PCT` = 0.20/0.30,
  trailing default OFF). Take profit the instant the modeled mark hits +20%, cut the
  loss the instant it hits −30%. Caps root cause #6's left tail (well inside the old −35%)
  and banks gains before a high-beta name round-trips them, while giving the thesis a bit
  more room on the downside than the upside. Rubric §5.

## Watch-list (no change yet — needs forward, gate-era data)

- **Direction-driven losses dominate** → the highest-leverage future work is the
  *score* (calibrate the side) and the *edge governor* (de-gross when realized option
  edge is negative), not more structure. Re-run `diagnose-pick-losses.mjs` after a
  forward sample to confirm the mix once the post-rework book resolves.
- **Spreads are a first-order tax** (25% avg round-trip on the legacy OTM picks). The
  P5.1 execution-cost debit + tightened roster spread gate address it; verify the
  realized round-trip on the near-the-money roster is materially lower.
- **The timing gate's edge is still unproven** — gate-era resolved sample is ~0; the
  go-vs-wait A/B (`PICKS_ACCURACY_AB=1`) needs ≥25 decided per arm before the gate's
  thresholds can be trusted as a backtest rather than an in-sample fit.
