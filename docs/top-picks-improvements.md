# Top Picks improvements

Companion critique to [`top-picks-rubric.md`](./top-picks-rubric.md). The rubric
describes how the engine works *today*; this doc is the prioritized list of where
it's most likely wrong and what to do about it. Ordered **P0 → P2** by leverage,
not by effort.

> **Reading this.** Each item is: **Problem** (what's broken) · **Why it matters**
> (the mechanism) · **Fix** (concrete change + code pointers) · **Validation** (how
> you'll know it worked). Constants prefixed *(proposed)* don't exist yet. Code
> pointers assume the same surface as rubric §10 (`computeEntryTiming`,
> `buildExitPlan`, `pickContractForPick`, `updatePicksAccuracyFile`,
> `resolvePickOutcome`, `scoreAllTickers`).

---

## Implementation status (shipped)

The concrete, shippable items below are **implemented** in `scripts/build.mjs` +
render. The pure-measurement items (the 2×2 ablation, signal pruning) ship as the
*substrate + UI* they need; the actual decisions wait on forward, gate-era data.

| Item | Status | Notes |
|---|---|---|
| **P0.1** model option P&L | ✅ shipped | `modelOptionExit` (BS repricer), entry-option snapshot at enroll, `optionExpectancyPct` + win/loss splits, Track Record chip. |
| **P0.2** ablation | ◑ substrate + A/B + label | P0.1 makes the modeled P&L exist; the gate is labelled "research / unproven" in the timing panel. `scripts/diagnose-pick-losses.mjs` now prints the **go-vs-wait modeled-P&L A/B** (the data-available proxy for the 2×2 — a true stop×gate grid needs the intraday path we don't store) + the gate-era sample size. Today: 0 gate-era resolved → "insufficient sample". |
| **P1.1** less-fragile contract | ✅ shipped | Δ target 0.30→0.55 (band 0.45–0.65); OTM band loosened to a sanity bound; **premium cap made price-aware** — see deviation below. |
| **P1.2** kill contrarian↔timing circularity | ✅ shipped | The four bold contrarian credits trend-condition at the source (`bullishReversalConfirmed`). |
| **P1.3** earnings defer 3→8 | ✅ shipped | `PICKS_TIMING_EARNINGS_DEFER_DAYS 3→8`; `earningsBeforeExpiry` flag surfaced. |
| **P1.4** theta-aware time-stop | ✅ shipped | `PICKS_THETA_STOP_PCT 2.5%/day`, gated to held ≥5d + modeled loss; `theta-stop` status. |
| **P2.1** factor/correlation cap | ✅ shipped | `PICKS_MAX_PER_SECTOR 4→3` + `PICKS_MAX_PER_FACTOR 5` (`FACTOR_OF_SECTOR`). |
| **P2.2** fail-open to `wait` | ✅ shipped | Fail-open state go→wait; enrollment is go-only for the headline cohort. |
| **P2.3** prune signals | ◑ substrate | `bySignal.prunable` flag (n≥25 and rate within 0.05 of a coin flip). No auto-drop — it's a hint for the next recalibration. |
| **Feedback-loop unblock** | ✅ shipped | `PICKS_ACCURACY_AB=1` now set in `daily.yml` (the wait arm finally accumulates; entries stamped `waitKind` earnings/event/structure), plus the **universe-IC substrate**: `data/grades-daily.json` (every name's grade total, once per ET day) + `scripts/diagnose-grade-ic.mjs` (cross-sectional Spearman IC + decile spread at 5/10/14d — ~138 obs/day instead of ~5/build). Addresses meta-problem 1's sample starvation directly. |
| **Boundary/regime churn** | ✅ shipped | Tier hysteresis (`PICKS_TIER_HYSTERESIS`, incumbent exits at 0.9×tradeCut), asymmetric macro-regime persistence (`PICKS_REGIME_PERSIST`, recovery needs 2 consecutive builds), continuous macro-tilt ramp (`PICKS_MACRO_TILT_RAMP`, |tilt| scales with stress instead of a −4/−8 step), and a direction-concentration cap (`PICKS_MAX_PER_SIDE 8` — no more 10/10-put books on a borderline regime read). Rubric §4/§6.3/§7. |
| **3-agent correctness audit (13 fixes)** | ✅ shipped | Dead tactical-put window re-anchored to the live cutoff (`max(bar, −0.8·tradeCut)`); `Number.isFinite` guards so a null modeled P&L can't enter the option stats as a fake 0% loss (5 sites); per-pick SPY-excess over the intersection cohort; stale-spot resolutions stamped at `lastDate`; expiry settles at ~16:00 ET on expiry day; AMC earnings parsed post-close (`T21:00:00Z`) for the crush model and `T16:00:00Z` for the contract flag; macro-hysteresis recovery accepts alternating recovered states (no more permanent risk-off wedge); C/P ratio raws floored at 0.02 so a true-zero extreme stays in the z pool; 52-week contrarian dead-band tests distance-from-spot on both scoring paths; vertical sizing nets leg theta/vega; roster timing fallback fails closed to `wait`; bySignal rate/prunable covers IC-minted keys; MFE/MAE averages skip unmarked entries. |
| **Redundant-signal prune + decorrelation ON** | ✅ shipped | `PICKS_PRUNE_REDUNDANT` (default ON): `volConf` dropped (unsigned + double-reads the rvol `unusualVolume` scores signed); `socialSentiment` informational-only (31 bullish / 0 bearish fires across the universe). `PICKS_DECORRELATE` default ON (audited clean; required now that the flow cluster carries 4 signals). |
| **P5.1 execution-cost-aware roster (net-of-cost conviction)** | ✅ shipped | Roster ranking + bar now charge the chosen contract's round-trip spread as a grade-point debit (`executionCostDebit`: 0 ≤3% spread → 1.25 at the 10% clean cap). Marginal picks whose `|total| − debit < tradeCut` drop (`rosterMeta.costGated`); the published grade is untouched. Deterministic at pick time — needs no forward data. Rubric §7. |
| **Scanner-data signals (P4)** | ✅ shipped | The site's own scanner artifacts wired into the grade: `oiDeltaNet` + `gammaSqueeze` from `data/oi-tracker.json`, `flowPersist` from the rolling 7-day `data/unusual-log.json` (all Mechanicals; first two z-converted into the flow cluster), gamma-wall proximity + overnight peer-implied move as soft timing reads, and CNN Fear & Greed as a capped 7th regime axis (`PICKS_MACRO_SENTIMENT`). All staleness-gated, env-flagged, and stamped into `entrySignals[].z` for future IC weighting. Rubric §3/§6/§6.3 + the §9 constants list. |

**Deviation from the doc (P1.1 premium cap).** The doc said "keep the existing
premium filter." Kept literally, the flat `$35/share` cap is incompatible with a
0.55Δ target across this universe: a perfectly reasonable near-the-money contract on
a $300+ name costs more than $35, so the flat cap silently gutted the roster to only
cheap stocks (it dropped CAT/DE/LLY purely on price, while correctly keeping the
earnings-IV-inflated FDX out). We preserved the filter's *intent* (bound premium as a
share of exposure) by making it **price-aware**: `premium ≤ max($35, 12% of spot)`
(`PICKS_MAX_PREMIUM_PCT_OF_SPOT`). Code wins, doc follows.

---

## 0. The two meta-problems

Everything below is downstream of these. Fix the measurement first or you'll keep
tuning blind.

1. **The whole recalibration is fit to N=19 (1 win / 18 losses).** The timing gate's
   ~6+ thresholds (`RSI 70`, `DIST_SMA20 8`, `RET5D 10`, `RET3D 10`, `52W 0.92`,
   knife `RET1D/RET3D/DD_ATR`) were chosen *after* seeing those 19 outcomes. So
   rubric §6.5's "drops 16 of 19" is **in-sample by construction** — it's a fit, not
   a backtest, and is not evidence the gate works. The doc half-acknowledges this in
   §9 but still cites the 16/19 as if it validated something. It doesn't.

2. **The headline metric measures the underlying, not the trade.** `expectancyPct` /
   `excessExpectancyPct` track the *underlying's* side-adjusted move vs SPY. But you
   trade **options**. An 18-loss cohort with max-favorable-excursion ≈ 0% means the
   *premium* bled from theta + IV crush even when the stock barely moved. Underlying
   expectancy can print ~flat while you're down 40% on the contract. The number you
   report is disconnected from the number that empties the account.

---

## P0 — prerequisites (do these before trusting anything else)

### P0.1 Model option P&L in the track record
**Problem.** `resolvePickOutcome` resolves on underlying move (TP / cut / expiry /
14-day stop) and expectancy is computed on the underlying. Per §8 you have "no
options-price history" — so the strategy's actual result is never measured.

**Why it matters.** Theta and IV crush are the dominant P&L drivers for a long
0.30-delta call. The metric is structurally blind to the exact thing that produced
18 losses.

**Fix.** You don't need a live options feed — reprice with Black-Scholes.
- At entry, the `entrySignals` snapshot already exists (§8). Add to it:
  `{spot0, strike, expiry, side, iv0, delta0, premium0}` (all already known at
  pick time from `pickContractForPick`).
- In `resolvePickOutcome`, walk the **actual confirmed underlying path** to the exit
  bar, then reprice the same contract with BS:
  - `T` = remaining DTE at exit,
  - `S` = exit spot from the real path,
  - `σ` = entry IV as a first pass; then a second pass that **decays IV toward HV20**
    over the hold (crude vol-mean-reversion) and applies an **earnings-crush haircut**
    if an earnings date fell inside the hold.
  - emit `optionPnlPct = (premiumExit − premium0) / premium0`.
- Add `optionExpectancyPct` alongside the existing underlying expectancy. Keep both —
  the gap between them *is* the theta/IV-crush tax, and you want to see it.

> **Shipped as:** `modelOptionExit(e, exitSpot, exitSec, rfr)` in `build.mjs` (reprices
> at the exit bar; `S` = real exit spot, `σ` = entry IV decayed toward the name's HV30
> over the hold, earnings-crush haircut `PICKS_OPTION_EARNINGS_CRUSH`). The entry
> snapshot lives on the enrolled entry's `contract.iv` + `entryHv` + `earningsDate`.
> `computePicksAccuracyStats` returns `optionExpectancyPct` (+ win/loss splits);
> rendered as a Track Record chip.

**Validation.** Re-resolve the existing 19 picks under this. If `optionExpectancyPct`
is far more negative than `expectancyPct`, the bleed is theta/IV (→ P1.1, P1.4
matter most). If they track, the bleed is direction/timing (→ the gate's premise
holds). You currently can't tell which.

### P0.2 Ablation: does the ATR-floor stop alone already fix it?
**Problem.** Two fixes shipped together — the **ATR-floor cut** (§5) and the
**timing gate** (§6) — so their individual contributions are entangled. The gate is
the expensive, overfit one; the ATR floor is the cheap, principled one.

**Why it matters.** Your own §1 diagnosis is a *stop-sizing bug*: the flat ~8% cut
sat inside one daily range, so chop = −70% on the option. That's fixed by the ATR
floor with zero timing logic. If the floor alone recovers most of the 18 losses, the
gate is overfit complexity solving an already-solved problem.

**Fix / experiment.** Re-resolve the 19 picks (using P0.1's modeled option P&L)
across the 2×2:

| | no gate | gate on |
|---|---|---|
| **old 8% stop** | baseline (the actual 5% win record) | rubric §6.5's claim |
| **ATR floor** | **← the cell that matters** | current shipped engine |

The decisive comparison is **ATR-floor / no-gate vs ATR-floor / gate-on**. If the
gate's marginal lift over the floor is small, demote the gate from a `−8` score
component to a *soft* `wait` badge and stop tuning its thresholds on N=19.

**Validation.** Marginal `optionExpectancyPct` of the gate, holding the ATR floor
fixed. Report it in `rosterMeta` so it updates as forward picks accumulate.

> **Shipped as:** the modeled-P&L substrate (P0.1) + a "research / unproven" label on
> the Entry-timing panel. The 2×2 itself is a forward-data measurement, not an engine
> path; it runs once enough gate-era picks (which now carry the entry-option snapshot)
> resolve.

---

## P1 — structural

### P1.1 Stop buying fragile contracts (0.30-delta OTM)
**Problem.** `pickContractForPick` targets **0.30 delta, 5–30% OTM** — the
cheap/high-extrinsic/high-leverage end, where an 8% adverse underlying move is −70%.

**Why it matters.** Your stated edge (rubric: "capture delta and IV moves, exit
before expiry") wants a contract that *survives noise*. A slightly-ITM **0.50–0.65
delta** has less theta drag, less IV-crush sensitivity, and won't get shaken out by
one red day. A real slice of the 18 losses is probably **structural** (deep-OTM +
formerly-tight stop), not entry timing.

**Fix.** Add *(proposed)* `PICKS_CONTRACT_DELTA_TARGET 0.55`, band `0.45–0.65`. Keep
the existing liquidity/spread/premium hard filters. Re-pick the 19 entries at the new
target.

> **Shipped as:** `PICKS_DELTA_MIN/IDEAL/MAX 0.45/0.55/0.65`; OTM band relaxed to a
> −20%…+12% sanity bound (delta is the moneyness gate); composite delta divisor
> re-centered on 0.55. The premium cap is now **price-aware** (`max($35, 12%·spot)`)
> — see the deviation note at the top; a flat $35 cap at 0.55Δ would have gutted the
> roster to only cheap stocks.

**Validation.** P0.1 repriced P&L at 0.30 vs 0.55 target on identical entry dates.
If the 0.55 set loses far less with the gate *off*, much of the "timing edge" was
really a contract-fragility artifact.

### P1.2 Kill the contrarian-vs-timing circularity
**Problem.** §3 hands a *crashing* name up to **+8** of contrarian conviction
(RSI≤25 `+3`, 52w-low `+1`, P/C>1.15 `+2`, VIX>35 `+2`); §6 then subtracts up to
**−8** to undo it. You score the same crash twice with opposite signs, and the caps
are symmetric — so a hard crasher can net ~0 on timing while still carrying spurious
conviction from the other pillars.

**Why it matters.** It's two knobs fighting over one phenomenon; the net is an
accident of where the caps landed, not a calibrated read.

**Fix.** Trend-condition the contrarian signals **at the source** instead of
inflate-then-claw-back: RSI-oversold / 52w-low / VIX-capitulation only fire once
there's a confirmation bar (RSI turning up, MACD histogram inflecting, a higher low).
A falling knife then never earns the +8 in the first place, and §6 can shrink to a
genuine *timing/location* read rather than a crash-undo mechanism.

> **Shipped as:** `bullishReversalConfirmed(t)` (RSI ticking up / MACD hist >0 / a
> green session) gates the +3 RSI-oversold, +1 52w-low, +2 P/C-fear and +2
> VIX-capitulation credits in `scoreTechnicals`/`scoreMechanicals`.

**Validation.** Per-signal attribution (`bySignal`, on modeled P&L): does
RSI-oversold predict wins *unconditionally* (current) vs *only with a reversal bar*
(proposed)? The conditioned version should show a higher hit-rate at lower N.

### P1.3 Earnings defer is too tight (3 → ~7–10 sessions)
**Problem.** `EARNINGS_DEFER_DAYS = 3` forces `wait` only inside 3 sessions of
earnings. IV ramps 1–2 **weeks** out; a 21-DTE call bought 4 sessions before a print
still eats the crush.

**Why it matters.** For a long-premium buyer, earnings IV crush is a top-3 loss
source and it's almost entirely avoidable.

**Fix.** `EARNINGS_DEFER_DAYS 3 → 8`. Separately, flag any pick whose **expiry falls
after** an (unconfirmed) earnings date as crush-exposed unless the thesis is
explicitly an IV-expansion play — add an `earningsBeforeExpiry` boolean to the timing
reasons.

> **Shipped as:** `PICKS_TIMING_EARNINGS_DEFER_DAYS 8`; `earningsBeforeExpiry` (from
> `contract.earningsInWindow`) surfaced as a crush-exposure warning on the timing panel.

**Validation.** P0.1 with the IV-crush haircut on — `optionExpectancyPct` of picks
held through earnings vs not.

### P1.4 The 14-day time-stop bleeds theta invisibly
**Problem.** A pick on a ≥21-DTE contract that goes nowhere hits the 14-day time-stop
with ~7 DTE left — the theta cliff — but the underlying-move tracker records it as
~breakeven.

**Why it matters.** Same blind spot as P0.2: a flat *stock* with a −40% *option* is
scored as a non-event. You're rewarding the discipline of cutting while not measuring
the cost of having held.

**Fix.** No new logic needed — P0.1's modeled P&L surfaces it automatically. Once
visible, consider a **theta-aware time-stop**: exit when modeled daily theta exceeds
*(proposed)* `PICKS_THETA_STOP_PCT 2.5%`/day of remaining premium, rather than a flat
14 days.

> **Shipped as:** P0.1's modeled P&L + a `theta-stop` branch in `resolvePickOutcome`
> (`PICKS_THETA_STOP_PCT 0.025`), gated to held ≥ `PICKS_THETA_STOP_MIN_HOLD_DAYS`
> (5) and modeled at a loss so a working trade is never cut early.

**Validation.** Distribution of `optionPnlPct` for time-stopped picks before/after.

---

## P2 — tightening

### P2.1 Sector cap → factor/correlation cap
**Problem.** `PICKS_MAX_PER_SECTOR = 4` is **40%** of a 10-name roster in one GICS
sector — and the actual blowup cluster (semis + software) is a *factor* that spans
GICS lines (Tech, Comm Services, some Industrials).

**Fix.** Tighten to `≤ 3`, and add a sub-industry or pairwise-return-correlation cap
so one beta can't fill the roster through two different GICS labels. Record the
binding constraint in `rosterMeta`.

> **Shipped as:** `PICKS_MAX_PER_SECTOR 3` + `PICKS_MAX_PER_FACTOR 5` via
> `FACTOR_OF_SECTOR`/`factorOfTicker` (the curated tech/AI/data-center complex
> collapsed to one factor). `rosterMeta.factorCapped`/`factorCounts` record the binding
> constraint.

**Validation.** `bySector` / a new `byFactor` cohort — drawdown clustering should
drop.

### P2.2 Fail-open to `wait`, not `go`
**Problem.** §6.4: thin / <15-bar names fail open to **`go` score 0** — an endorsed,
enrolled entry on the names where you have the *least* data and the *most* knife risk.

**Fix.** Fail open to **`wait`** (shown, badged, **not** enrolled). Graceful
degradation without minting a conviction call on missing data. Keeps the §8 win-rate
honest (a fail-open `go` that loses currently dings a number you didn't earn).

> **Shipped as:** `computeEntryTiming` fail-open state go→wait; enrollment filters to
> go-state picks for the headline cohort.

**Validation.** Count of fail-open picks in the enrolled cohort → should go to zero.

### P2.3 Prune signals; don't add them
**Problem.** `total` is a linear sum of ~30 hand-weighted integer signals with the
tier bars (`±12/±16`) fit to the resulting distribution. The decorrelation work is
good, but unvalidated weights + many noisy signals inflate the **variance** of
`total`.

**Fix.** Treat `bySignal` (now on modeled option P&L, P0.1) as the pruning tool:
once a signal passes `PICKS_SIGNAL_MIN_N = 25` decided and shows a hit-rate
indistinguishable from 50%, **drop it** rather than keep it for completeness. Fewer,
validated signals beat more decorrelated ones. Do not ship any *new* signal until the
existing set is attributed.

> **Shipped as:** `bySignal[k].prunable` (n ≥ `PICKS_SIGNAL_MIN_N` and rate within
> `PICKS_SIGNAL_PRUNE_BAND` of 0.50). Measure-only — it flags candidates for the next
> recalibration; it does not auto-drop a signal.

**Validation.** Variance of `total` and the spread between graded and no-trade
cohorts' `optionExpectancyPct`.

---

## P3 — cross-sectional standardization + risk-based sizing

Two institutional-pattern reworks of the scorer (P3.1–P3.3, the scoring half) plus
risk-based sizing (P3.4, the sizing half). The full forward spec lived in the PR
description; this is the shipped summary. **Gated by `PICKS_XSECTIONAL` (default ON);
`PICKS_XSECTIONAL=0` falls back to the legacy absolute scorer in-process** (the legacy
path is what the §9-style validation diffs against). Non-goal: this is **not** a
market-neutral long/short rebuild — sector-neutral z is the long-only-feasible proxy
for beta-neutralization; inverse-vol sizing is the diagonal approximation of a risk
optimizer. Contract filters (§5), exit geometry, and the entry-timing component (§6)
are unchanged.

### P3.1 Cross-sectional robust z-score
**Problem.** The engine was an **absolute** scorer — every name judged against fixed
bars (`EPS growth ≥10% → +1`, `P/E ≤80% of sector median → +1`, …) fit once to a
19-pick sample. Absolute thresholds go stale the moment the regime drifts (the
±16/±20 → ±14/±18 → ±12/±16 treadmill), and equal-weight absolute scoring is long-beta
with extra steps: in a rally every name clears the same bars together and the roster
fills with one correlated cohort (the 18/19-loss Technology cluster).

**Why it matters.** The institutional pattern is **relative, cross-sectional ranking** —
each name scored against the rest of the universe *this build*, so "cheap /
fast-growing / overbought" self-recalibrate every rebuild instead of being chased by
hand.

**Fix.** Convert the **per-name continuous** signals to a **robust z** (median / 1.4826·MAD,
winsorized to ±`PICKS_Z_CLIP`), with a per-signal direction and weight: `contribution =
dir · z · W_s`. The converted set (16 signals): earnings-surprise, EPS/revenue growth,
analyst-target upside, analyst-revision net, P/E-vs-median (dir −1), FCF **yield**
(`FCF/marketCap`, signed-log), net-margin Δ, RSI 5-day momentum, RSI level (contrarian),
52-week range position (contrarian), rvol, unusual-flow ratio, OI C/P ratio, put/call
ratio (contrarian), social sentiment. Ratios are log-transformed before z. **Kept on
fixed logic:** discrete events (guidance, major-contract, MACD, streak, S/R breaks,
SMA-stack, chart pattern, ±2/−3 catalysts, sector narrative, media), market-wide common
factors (SPY/VIX/DXY/10Y/macro — a cross-sectional z of a constant is 0 for everyone),
and the two non-monotonic per-name signals (short interest's squeeze override, unusual
volume's price-set sign). The three contrarian signals (RSI reading, 52-week, P/C) keep
their **extreme-only dead-band + asymmetric bullish-reversal gate** — z grades the
tail magnitude only, never linearized through the middle.

> **Shipped as:** the `raw` channel on `_sig`; the `CONVERTED_SIGNALS` registry +
> `robustZ` (with a secondary-scale fallback when MAD = 0, the common case for sparse
> signals); `computeCrossSectionalScores(scored, …)` runs once in `scoreAllTickers`
> after the per-ticker loop, so `buildTopPicks`, `buildGradesIndex`, and `regen-picks`
> all inherit it. Scale-preserving weights `W_s = oldMax / PICKS_Z_CLIP` (the spec's
> §3.4 conservative option) keep `total` on a roughly-legacy scale so the secondary
> ±12/16 / −8 reads stay valid and `grades.json` doesn't lurch.

**Validation.** Each converted signal's z has median ≈ 0 / robust-scale ≈ 1 across the
universe (verified on the committed build). Spearman(new `|total|` rank, legacy rank) ≈
0.66–0.69 — high but well below 1.0 (it pushes the chased / one-cohort-floated names
down without scrambling).

### P3.2 Distribution-relative tiers
**Problem.** With z-scored inputs the absolute `total` is no longer a fixed-meaning
number, so the ±12/16 cutoffs are arbitrary.

**Fix.** Tier by **cross-sectional percentile of `|total|`** — top
`PICKS_TIER_PCTL_STRONG` (5%) → Strong, top `PICKS_TIER_PCTL_TRADE` (12%) → actionable.
Keep the absolute ±12/16 bars as the **small-universe floor fallback** (universe <
`PICKS_Z_MIN_UNIVERSE`, or the flag off). This retires the recalibrate-the-constant
treadmill — the bar tracks the distribution every build by construction.

> **Shipped as:** `tierForScore(score, {strongCut, tradeCut})` with the cutoffs computed
> in `computeCrossSectionalScores` and threaded out of `scoreAllTickers`;
> `buildTopPicks`'s actionable filter keys on `recommendation.side` (which encodes the
> cut) and `writeGradesFile`'s `minConviction` publishes the trade cutoff. On 138 names
> the percentile tiers yield ≈8 Strong / ≈18 actionable (target ≈7 / ≈16).

**Validation.** Tier counts above; the §7 sector/factor caps bind far less often (see P3.3).

### P3.3 Sector-neutral z *(default on)*
**Problem.** A whole sector rallying lifts every member's grade in lockstep — the
documented one-cohort failure mode — which the §7 sector cap only patches *after* the
score.

**Fix.** When `PICKS_SECTOR_NEUTRAL` is on, run the robust z **within each GICS sector**
(thin sectors < `PICKS_SECTOR_MIN_N`, ETFs, and null-sector names fall back to the
universe pool). A name is then scored on how it ranks *against its sector peers*, so an
entire sector rallying no longer floats every member up together — the long-only-feasible
proxy for the beta-neutralization a pod runs.

> **Shipped as:** the `sectorNeutral` branch in `computeCrossSectionalScores`. With it
> on, the roster's top-sector share stays ≤ 2/10 on the committed build and the §7 caps
> don't bind.

### P3.4 Risk-based position sizing
**Problem.** Sizing was a qualitative tier label ("Standard" / "Load the Boat") — loading
a high-conviction *high-vol* name concentrates risk exactly where it's largest, the
opposite of what a risk desk does.

**Fix.** A numeric per-pick weight, computed **only for roster survivors** (a pure
post-step in `buildTopPicks`): `risk = max(PICKS_SIZE_VOL_FLOOR, option-aware % of
premium lost if the underlying hits the stop)` — `(stopDistFrac·spot·|Δ|)/premium`,
capped at 100% (a long option can't lose more than its premium), ATR%-of-underlying as
the fallback; `tilt = clamp(|total|/strongCut, PICKS_SIZE_TILT_MIN, _MAX)`;
`weight = (1/risk · tilt) / Σ · PICKS_GROSS_TARGET` (Σ weight = gross target, the rest
cash); `suggestedContracts = floor(weight · PICKS_DISPLAY_ACCOUNT / (premium·100))`.

> **Shipped as:** `applyPickSizing(out, chains, strongCut)`; each pick gets a `sizing`
> block `{ weight, riskToStopPct, riskDenom, suggestedContracts }`, rendered as
> "size ~X% of book · ~N contracts at $Y" with the % of premium at the stop in a
> tooltip. `PICKS_DISPLAY_ACCOUNT` (default $25k) is a display input, not a live balance.

**Validation.** Σ weight = `PICKS_GROSS_TARGET`; the highest-risk-to-stop survivor carries
the smallest weight (risk parity), verified on the committed build.

### P3.5 Horizon-aware pillar weighting *(shipped)*
**Problem.** The score is a stock-picker's 4-pillar grade, but the product trades
~14-day long premium. Those horizons don't match: over a fortnight a name's move is
dominated by flow + price structure + the tape, while the **fundamental** pillar
(EPS/revenue growth, P/E, FCF, net-margin) pays off over quarters and is ~fully
priced over the hold — near-zero information at the option's horizon. Equal-weighted,
it was the **largest-magnitude pillar** and dominated the grade, tilting the engine
toward slow factors a 2-week option can't monetize.

**Why it matters.** The loss-attribution diagnostic says losses are *direction*-driven;
all the contract/IV/exit machinery is downstream of "can the score call 2-week
direction?". Leaning that score on the slowest-horizon pillar is the root of the
mismatch.

**Fix.** Scale each asset-quality pillar by a horizon weight before summing
(`PICKS_HW_FUND 0.6` / `PICKS_HW_TECH 1.0` / `PICKS_HW_MECH 1.15` / `PICKS_HW_NARR
0.9`); `timing`/`ivCost` ride ×1. A **principled** microstructure prior (flow ≳
technicals ≫ slow fundamentals at 1–3 weeks), **not** a fit to N=19 — the IC bridge
(§9.6) replaces it with measured weights once forward outcomes accumulate.

> **Shipped as:** `horizonWeight` + `applyHorizonWeight` in `build.mjs`, applied in
> both `scorePillared` and `computeCrossSectionalScores`. The weight is baked into each
> signal's `contribution` (chips stay consistent with the weighted pillar total; raw
> integer `score` and the IC-bridge `z` untouched). Gated by `PICKS_HORIZON_WEIGHTS`
> (default ON); `=0` → byte-identical to the legacy equal-weight sum (verified 0/138
> grades differ). Percentile tiers self-recalibrate, so the actionable count is
> unchanged — it re-ranks (RDDT +8.6→+4.9, LLY +11.0→+8.2, banks pulled down).

**Validation.** `bySignal`/per-pillar IC on modeled option P&L once gate-era picks
resolve: the weighted score should show higher rank-IC vs 2-week option outcomes than
the equal-weight one. Until then it's a labelled prior, same discipline as the gate.

### IC bridge (rubric §9.6)
`computeCrossSectionalScores` stamps the standardized z (mean 0 / unit scale) onto each
converted signal, and the accuracy enroll snapshot (`updatePicksAccuracyFile`) persists
it into `entrySignals[].z` alongside the legacy integer score. Once `bySignal` clears
`PICKS_SIGNAL_MIN_N`, fitting per-signal IC weights `W_s` from realized outcomes is a
literal drop-in (the z is already comparable across signals). Weights stay **equal**
(`W_s = oldMax/clip`, scale-preserving) until then.

---

## 3. Ablation & validation protocol (run order)

All of these resolve on **modeled option P&L (P0.1)**, on the 19-pick set plus every
forward pick as it lands. Run top-to-bottom; each answers a yes/no that gates the
next.

1. **Build P0.1.** Reprice the 19. Report `optionExpectancyPct` vs `expectancyPct`.
   → *Is the bleed theta/IV or direction?*
2. **P0.2 2×2.** ATR-floor/no-gate vs ATR-floor/gate-on.
   → *Does the gate earn its keep over the stop fix alone?*
   *(Shipped proxy: `diagnose-pick-losses.mjs` prints the go-vs-wait modeled-P&L A/B +
   the gate-era sample size. The full stop×gate grid still needs the intraday path.)*
3. **P1.1 delta swap.** 0.30 vs 0.55 target, gate **off**, ATR floor on.
   → *How much "timing edge" is really contract fragility?*
4. **P1.2 conditioning.** Contrarian-unconditional vs reversal-confirmed, via
   `bySignal`.
   → *Do the contrarian signals predict, or only inflate?*
5. **P1.3/P1.4.** Earnings-held and time-stopped cohorts under the IV-crush + theta
   model.
   → *How big is the avoidable premium tax?*

The honest version of rubric §6.5 is: **none of the gate's numbers are validated
until step 2 shows positive marginal expectancy on forward, gate-era picks.** Until
then, label the gate "research / unproven" in the UI the same way `PICKS_ACCURACY_AB`
is labelled.

---

## 4. Proposed constants (summary)

| Constant | Now | Proposed | Shipped | Item |
|---|---|---|---|---|
| `PICKS_DELTA_IDEAL` (`_MIN`/`_MAX`) | 0.30 (0.20/0.40) | **0.55** (0.45–0.65) | ✅ 0.55 (0.45/0.65) | P1.1 |
| `PICKS_MAX_PREMIUM_PCT_OF_SPOT` *(new)* | — | — | ✅ **0.12** (cap = max($35, 12%·spot)) | P1.1 |
| `EARNINGS_DEFER_DAYS` | 3 | **8** | ✅ 8 | P1.3 |
| `PICKS_THETA_STOP_PCT` *(new)* | — | **2.5%/day** | ✅ 0.025 (+ min-hold 5d) | P1.4 |
| `PICKS_MAX_PER_SECTOR` | 4 | **3** + factor cap | ✅ 3 + `PICKS_MAX_PER_FACTOR 5` | P2.1 |
| `PICKS_OPT_TP_PCT` / `PICKS_OPT_STOP_PCT` | 0.6 / 0.35 | **symmetric ±20% snap exit** (instant TP / instant cut) | ✅ **0.20 / 0.20** | exits |
| `PICKS_OPT_TRAIL` | ON | trailing TP — now **default OFF** so +20% is an instant flat TP (`=1` re-arms let-winners-run) | ✅ **OFF** | exits |
| `PICKS_OPT_TRAIL_GIVEBACK` *(new)* | — | exit on this give-back from the peak gain (only when trail re-armed) | ✅ **0.33** | exits |
| `PICKS_SUPPRESS_OPEN_REENTRY` *(new)* | — | don't re-pick a name with an open tracked position until it exits | ✅ **ON** (`=0` reverts) | roster |
| `PICKS_CLEAN_MAX_SPREAD_PCT` | 0.12 (const) | tighten the roster spread gate | ✅ env, **0.10** | spread |
| `PICKS_SPREAD_PEN_REF` *(new)* | — | composite spread-penalty saturation | ✅ **0.10** (weight 0.13→0.24) | spread |
| `PICKS_IVRANK_VETO` *(new)* | — | extreme IV → **gate** (strong con, blocks `go`) | ✅ **90** (ON; 0 disables) | #2 |
| `PICKS_VERT_AUTO` *(new)* | — | auto debit vertical in rich-IV / neg-edge | ✅ wired + sizing-correct, **dark** (`=1` on) | #3 |
| `PICKS_VERT_NEGEDGE_IVRANK` *(new)* | — | neg-edge book → spread at this IV rank | ✅ **50** | #3 |
| gate go-vs-wait A/B *(new)* | — | modeled-P&L marginal + sample size | ✅ in `diagnose-pick-losses.mjs` | #5/P0.2 |
| fail-open verdict | `go` | **`wait`** | ✅ `wait` (+ go-only enroll) | P2.2 |
| `optionExpectancyPct` *(new)* | — | reported alongside underlying | ✅ + win/loss splits | P0.1 |
| `bySignal.prunable` *(new)* | — | n≥25 & ~50% → flag | ✅ band 0.05 | P2.3 |
| `PICKS_XSECTIONAL` *(new)* | — | master flag | ✅ ON (`=0` → legacy scorer) | P3.1 |
| `PICKS_SECTOR_NEUTRAL` *(new)* | — | demean within sector | ✅ ON (`=0` → universe-wide z) | P3.3 |
| `PICKS_Z_CLIP` *(new)* | — | winsorize each z | ✅ 3.0 | P3.1 |
| `PICKS_Z_MIN_UNIVERSE` *(new)* | — | floor below which to skip z | ✅ 20 | P3.1/P3.2 |
| `PICKS_SECTOR_MIN_N` *(new)* | — | thin-sector → universe z | ✅ 8 | P3.3 |
| `PICKS_TIER_PCTL_STRONG` / `_TRADE` *(new)* | — | percentile tiers | ✅ 0.05 / 0.12 | P3.2 |
| `PICKS_MIN_CONVICTION` / `PICKS_TIER_STRONG` | ±12 / ±16 bars | small-universe **floor fallback** | ✅ retained as fallback | P3.2 |
| `W_s` (per signal) *(new)* | — | equal weight | ✅ `oldMax/PICKS_Z_CLIP` (scale-preserving) | P3.1 |
| `PICKS_SIZE_RISK_DENOM` *(new)* | — | `option` \| `atr` | ✅ `option` | P3.4 |
| `PICKS_SIZE_VOL_FLOOR` *(new)* | — | min risk denominator | ✅ 0.05 | P3.4 |
| `PICKS_SIZE_TILT_MIN` / `_MAX` *(new)* | — | conviction tilt band | ✅ 0.6 / 1.4 | P3.4 |
| `PICKS_GROSS_TARGET` *(new)* | — | Σ weight (rest cash) | ✅ 0.80 | P3.4 |
| `PICKS_DISPLAY_ACCOUNT` *(new)* | — | display-only book size | ✅ 25000 | P3.4 |

---

## 5. Pointers
- Score / contract / timing: [`scripts/build.mjs`](../scripts/build.mjs) —
  `pickContractForPick` (P1.1), `computeEntryTiming` (P0.2, P1.2),
  `scoreTechnicals` / `scoreMechanicals` (P1.2 source conditioning), `buildExitPlan`
  (P1.4), `buildTopPicks` (P2.1 caps).
- Accuracy substrate: `updatePicksAccuracyFile`, `resolvePickOutcome`,
  `modelOptionExit`, `entrySignals` snapshot (P0.1, P2.3) — this is where the BS
  repricer lives.
- Render: [`scripts/render/app-js.mjs`](../scripts/render/app-js.mjs) — surfaces the
  "research / unproven" gate label, the modeled option expectancy chip, the
  `earningsBeforeExpiry` warning, and the factor-cap roster note.
- Mirror any shipped change back into [`top-picks-rubric.md`](./top-picks-rubric.md);
  code wins, doc follows.
