# Top Picks rubric

The canonical, auditable spec for how a name becomes a **Top Pick**. Every
threshold here is a named constant in [`scripts/build.mjs`](../scripts/build.mjs);
this doc is the human-readable mirror. If the code and this doc disagree, the
code wins — fix the doc.

> **Scope.** "Top Picks" = the ~10 *actionable* names the engine is willing to
> trade today. It is **not** the grade-any-ticker search (that's `data/grades.json`,
> the full 138-name 4-pillar index). Both share the same scoring first pass
> (`scoreAllTickers`); Top Picks then applies the extra gates (contract quality,
> execution timing, sector cap) and ships only the survivors.

---

## 1. Why this exists (the problem it fixes)

The engine used to ship picks on **asset quality alone** — the 4-pillar score —
with no check on whether *now* was a good moment to enter. The result was a 5%
win rate (1 win / 18 losses; every loss a stopped-out call):

- The engine kept buying calls **after** a name had ripped +15–50% in a few days,
  while it was stretched far above its 20-day moving average and pressed into
  overhead resistance — the top of the move. It then mean-reverted, and the ~8%
  underlying stop (≈ −70% on a deep-OTM call) fired. Most losers had a max
  favorable excursion near **0%** — they fell the instant they were bought.
- During a clear risk-off tape it **never shorted** — the universe is long-biased
  (persistent fundamentals + narrative keep quality names green through a fast
  selloff), so no name reached the −16 put bar.

The fix folds **entry timing into the grade itself** (§6) as a 5th scoring
component: a chasing-top / falling-knife read subtracts from `total` (−8 at the
trigger, scaling deeper toward −16 the more egregious the setup, §6), so badly-timed
names fall below the conviction bar on their own — no separate veto, one number. A
confirmed risk-off tape still opens a tactical put
path.

---

## 2. Pipeline overview

```
scoreAllTickers()            every ticker → 6 components → total  (= the GRADE)
   └─ scorePillared()        Fundamentals + Technicals + Mechanicals + Narrative
                             + Entry timing (computeEntryTiming, +4..−16, §6)
                             + IV cost   (computeIvCostContribution, −3..+1.5, §6.7)
tierForScore(total)          ±12 = Call/Put, ±16 = Strong, else No-Trade
buildTopPicks()
   ├─ candidate set          |total| ≥ 12  (+ risk-off "tactical puts", §6)
   ├─ ranked by |total|      conviction (entry timing already inside it)
   ├─ GATE 1: contract       pickContractForPick(requireClean) — a tradeable contract
   ├─ GATE 2: sector cap     ≤ 3 per sector + ≤ 5 per factor (§7) — caps correlation
   └─ ship survivors         up to 10; roster may honestly shrink
```

Entry timing is now part of the grade itself (§6) — a poorly-timed name simply
scores below the bar. Two gates then decide whether a high-grade name ships:

1. **Contract-quality gate** (`pickContractForPick`, §5) — is there a *tradeable
   contract* (liquidity, spread, delta, DTE)? No → drop.
2. **Sector + factor cap** (§7) — already 3 picks from this GICS sector, or 5 from
   this correlation factor? → skip.

Ranking is by **conviction** (`|total|`), which already folds in entry timing,
so a well-timed name outscores a chased one directly.

---

## 3. The 4-pillar score (with decorrelation reworks)

Pillar score = sum of its signals, **scaled by the pillar's horizon weight (§3.5)**;
`total` = sum of the four (weighted) pillars **plus the entry-timing component (§6)**,
which adds a bounded contribution (−8..+4 pre-scale, halved by `PICKS_TIMING_FOLD_SCALE` — see §3.7) to conviction in the implied direction (without ever flipping the
side), **plus the IV-cost component (§6.7)**.

> **Cross-sectional standardization (P3.1/P3.3, default on via `PICKS_XSECTIONAL`).**
> The per-name **continuous** signals below (growth %, ratios, RSI level, rvol, the
> OI/PC ratios, social sentiment — 16 in all) are no longer scored against fixed
> thresholds. `computeCrossSectionalScores` standardizes each to a **robust z**
> (median / 1.4826·MAD, winsorized to ±`PICKS_Z_CLIP`) against the rest of the universe
> *this build* — **within each GICS sector** when `PICKS_SECTOR_NEUTRAL` is on — and the
> signal's contribution becomes `dir · z · W_s` (`W_s = oldMax/PICKS_Z_CLIP`, so the
> scale stays roughly legacy). The fixed-threshold columns below are the **legacy
> reference**; the card's per-signal chip shows the actual standardized contribution.
> **Discrete/event signals** (guidance, major-contract, MACD, streak, S/R breaks,
> SMA-stack, chart pattern, ±2/−3 catalysts, sector narrative, media), **market-wide
> common factors** (SPY/VIX/DXY/10Y/macro), and the two **non-monotonic** per-name
> signals (short interest, unusual volume) keep their fixed integer scores. The three
> contrarian signals (RSI reading, 52-week, P/C) keep their extreme-only dead-band +
> asymmetric bullish-reversal gate around the z. Full spec:
> [`top-picks-improvements.md`](./top-picks-improvements.md) §P3. Below the universe
> floor (`PICKS_Z_MIN_UNIVERSE`) or with the flag off, every signal uses its fixed
> threshold and tiers fall back to the absolute ±7/10 bars (recalibrated from ±12/16 to the compressed scale — §3.7).

### Fundamentals (`scoreFundamentals`)
| Signal | Scoring |
|---|---|
| Earnings Surprise (latest qtr) | beat/miss >25% ±2, 10–24% ±1, in-line 0; stale >180d → 0 |
| EPS Growth YoY | ≥10% +1, <−25% −2 |
| Revenue Growth YoY | ≥8% +1, <−20% −2 |
| Analyst Price Target | ≥+10% upside +1, ≤−10% −1 (needs ≥5 analysts) |
| **Analyst Rating Changes** | net of recent **upgrades − downgrades** over the trailing ~90d (Yahoo `upgradeDowngradeHistory`, `ANALYST_REVISION_WINDOW_DAYS=90`): ≥3 net upgrades **+2**, 1–2 **+1**, −1/−2 **−1**, ≤−3 **−2**. Only actual up/down *actions* count — the constant "maintain"/"reiterate" stream is ignored. Distinct from the Price Target above: a target is a *level*, a rating change is an *event* (and events move stocks). Most names have no recent change → 0 |
| P/E vs Sector median | ≤80% of median +1; ≥150% of median with no growth (EPS growth YoY < 5%, or unavailable) −1 |
| Guidance | AI-read: raised +3, in-line +2, lowered −3. **FY-growth proxy (fallback) is now graded** — ≥10% +2, 0–10% +1, ≤−10% −3 (was a flat +2 for *any* positive estimate, which gave ~the whole universe the same +2 and barely discriminated). **Capital-return guard** (`sanitizeGuidanceDirection`): a dividend/buyback headline is NOT guidance — when the AI's own cited evidence is a capital-return announcement with no guidance language, the direction is downgraded to "none" (→ proxy). Applied at extraction (both AI paths, plus the prompts say so explicitly) *and* at scoring time, so pre-guard committed payloads are also caught (live misfire: "GD Increases Quarterly Dividend" → raised +3) |
| **Major Contract / Deal** | won +2, lost −3 (AI-read from news). "Won" now also covers, **for a bank/broker/adviser, a lead-underwriter / bookrunner / lead-adviser mandate on a marquee IPO, M&A, or capital raise** (e.g. leading the SpaceX IPO). This is a **discrete** signal (not the holistic `news.sentiment` behind Positive Catalyst), so one concrete win lifts the grade even when the day's coverage nets to neutral — and it is scored **only here**, never also as a Positive Catalyst, to avoid double-counting |
| Free Cash Flow TTM | positive +1, negative −1 |
| Net Margin Growth | expanding +1, contracting −1 — **YoY** (vs the same quarter last year) when ≥5 quarters of history, else QoQ (YoY removes the seasonal noise in a QoQ margin compare) |

### Technicals (`scoreTechnicals`)
| Signal | Scoring |
|---|---|
| RSI Movement | >50 & rising +1, <50 & falling −1 |
| **RSI Reading** | ≥75 **−3** (overbought); ≤25 **+3** (oversold) — *contrarian, trend-conditioned (P1.2): the +3 oversold credit fires only with a reversal-confirmation bar (RSI ticking up, MACD hist >0, or a green session), so a still-falling knife scores 0* |
| MACD | line>signal & hist>0 +1, line<signal & hist<0 −1 |
| Streak | ≥3 green days +1, ≥3 red −1 |
| Support/Resistance | confirmed break: 20D ±1, 50D ±1, 100D ±2 |
| **52-week H/L** | within 5% of high **−1**; within 5% of low **+1** — *contrarian; the +1 near-low credit is trend-conditioned (P1.2) on the same reversal bar* |
| Volume Confirmation | rvol ≥1.3 +1, <0.8 −1 |
| **MA Stack (20/50/100D)** | **±1** total — above the majority of the SMAs +1, below −1 (**decorrelated**: was ±1 *each* = ±3, which triple-counted one collinear trend read and over-weighted momentum; the 20/50/100D SMAs are almost always on the same side of price at once) |
| Chart Pattern | confirmed bullish +1, bearish −1 (forming = 0) |

### Mechanicals (`scoreMechanicals`)
| Signal | Scoring |
|---|---|
| Unusual Flow | aggressive bull vs bear prints, ±1 (≥5 prints, ≥1.5×) |
| Open Interest C/P | >1.5× calls +1, <0.67× (puts) −1 |
| Short Interest % | squeeze setup +1, SI rising −1, SI falling +1 |
| Unusual Volume | hourly ≥1.3× 20D-avg, ±1 by move direction |
| SPY flows | **Dropped (`PICKS_TAPE_DEDUPE`, default ON)** — would be ≥+0.6% +1 / ≤−0.6% −1, but the broad tape is now read once by the macro-regime gauge (§6.3) and expressed per-name by the beta-weighted Macro Regime tilt. A flat, same-direction, non-z-scored copy here just double-counted it; removed from the per-name breakdown entirely (legacy path scores it) |
| **Put/Call Ratio Extreme** | >1.15 **+2** (fear, contrarian bullish), <0.65 **−2** (greed) — *contrarian; the +2 fear credit is trend-conditioned (P1.2) on a per-name reversal bar*. **Liquidity floor** (`PICKS_PCR_MIN_VOLUME`, default 3,000 contracts/day across the signal's nearest-4 expirations, ≈ universe p8): a crowd-positioning read needs a crowd — below the floor one institutional hedge flips the ratio (live misfire: GD "extreme fear" +1.3 on <1,000 contracts), so the signal goes unavailable and drops out of the z pool |
| VIX Tracking | **Dropped (`PICKS_TAPE_DEDUPE`, default ON)** — would be rising & >25 −2 / falling & ≥20 +1, but VIX (level/trend) is the regime's own VIX axis (§6.3); a same-direction non-z-scored copy here double-counted it. Removed from the per-name breakdown entirely (legacy path scores it). (Distinct from **VIX Spot** below, which is *contrarian* and stays scored.) |
| **VIX Spot** | **Dropped (`PICKS_TAPE_DEDUPE`, default ON)** — would be <15 −1 / >35 +2 (contrarian capitulation, gated on a per-name reversal), but the VIX is market-wide → owned by the regime gauge (§6.3), not the per-name grade. Removed from the per-name breakdown entirely (legacy path scores it) |

### Narrative (`scoreNarrative`)
| Signal | Scoring |
|---|---|
| Positive Catalyst | bullish news **+2** (asymmetric — deliberately lighter than the −3 Negative Catalyst, since one AI sentiment read is noisy and weighting good news as heavily as bad fed the long-bias) |
| Sector Narrative | rides an active strong narrative ±2, faded by lifecycle/hype |
| Social Sentiment | net ≥±35% ±1 (≥5 msgs/24h) |
| Media Coverage | **0 (informational only)** — it used to add bullish +1 / bearish −2, but its only directional input was the *same* `news.sentiment` the Catalyst signals already score, and it fired only as a subset of them, so it double-counted one AI sentiment read. Kept in the breakdown for transparency; sentiment is owned solely by the Catalyst signals |
| Negative Catalyst | bearish news −3 (asymmetric) |
| Macro Tail/Headwinds | **Dropped (`PICKS_TAPE_DEDUPE`, default ON)** — would be bullish macro +1 / bearish −2, but a macro narrative is market-wide (the same score for every name) → owned by the regime gauge (§6.3), not the per-name grade. Removed from the per-name breakdown entirely (legacy path scores it) |
| DXY (1D) | **Dropped (`PICKS_TAPE_DEDUPE`, default ON)** — would be ≥+0.9% −2 / ≤−0.9% +1, but the dollar is the regime's own DXY axis (§6.3); a same-direction non-z-scored copy here double-counted it. Removed from the per-name breakdown entirely (legacy path scores it) |
| 10Y Yield (1D) | **Dropped (`PICKS_TAPE_DEDUPE`, default ON)** — would be ≥+13 bps −2 / ≤−13 bps +1, but long yields are the regime's own yield axis (§6.3); a same-direction non-z-scored copy here double-counted it. Removed from the per-name breakdown entirely (legacy path scores it) |

> **Long-bias / falling-knife defense (two layers).** The *contrarian* signals in
> **bold** above (RSI-oversold, 52w-low, P/C-fear, VIX-capitulation) used to turn
> **more bullish as a quality name crashed** — so the grade could keep a name at
> "Strong Call" purely on the buy-the-crash signals. Two layers now defend against
> that: (1) **trend-conditioning at the source (P1.2)** — each bold buy-the-crash
> credit only fires once a reversal bar confirms the turn (RSI ticking up, MACD
> histogram >0, or a green session), so a still-falling knife never earns the credit
> in the first place; and (2) the **entry-timing component (§6), part of `total`**,
> which still subtracts for a knife-catch / chase (−8 at the trigger, scaling deeper
> toward −16 for the worst, §6; and tightening its knife thresholds in a confirmed
> risk-off tape, §6.3). Layer 1 stops the double
> book-keeping the old design had (score the crash +8, then claw it back −8); layer
> 2 remains as the *location/timing* read.

### 3.5 Horizon-aware pillar weighting (`PICKS_HORIZON_WEIGHTS`, default ON)

The engine grades like a **stock-picker** (the four pillars are *asset quality*) but
**trades ~14-day long premium** on 30–60 DTE contracts. Those two horizons don't
match. Over a fortnight a single name's move is dominated by order flow, price
structure and the broad tape; the **slow fundamental factors** (EPS/revenue growth,
P/E-vs-sector, FCF, net-margin trend) pay off over *quarters-to-years* and are ~fully
priced over the hold — they carry near-zero information at the option's horizon, yet
equal-weighted they were the **largest-magnitude pillar** and dominated the grade.

So before the pillars are summed, each is scaled by a **horizon weight** reflecting
how fast its signals move price:

| Pillar | Weight | Why |
|---|---|---|
| Fundamentals | **0.6** (`PICKS_HW_FUND`) | slowest — quarterly/annual factors, mostly priced over a 2-week hold (discounted, not gutted: it still holds the faster *event* signals — analyst revisions, guidance, major contracts) |
| Technicals | **1.0** (`PICKS_HW_TECH`) | RSI/MACD/S&R/momentum — natively the days-to-weeks horizon; the **reference** weight |
| Mechanicals | **1.15** (`PICKS_HW_MECH`) | options flow / OI / unusual volume / put-call — **order flow leads price** at the shortest horizon (modest boost) |
| Narrative | **0.9** (`PICKS_HW_NARR`) | catalysts move fast but are one noisy AI sentiment read, and sector-narrative is slow (slight discount) |

This is a **principled** re-weight from market-microstructure priors (flow ≳
technicals ≫ slow fundamentals at a 1–3 week horizon), **not** a fit to the 19-pick
sample — the per-signal **IC bridge** (§9.6) is the path to *replacing* these priors
with measured weights once forward, gate-era outcomes accumulate. Mechanics:

- Applied in **both** scoring paths — `scorePillared` (legacy/pre-standardization)
  and `computeCrossSectionalScores` (the cross-sectional recompute, §3) — via
  `applyHorizonWeight`, which **bakes the weight into each signal's `contribution`**
  so the card's per-signal chips stay consistent with the weighted pillar total
  *and* the pillars keep summing to `total` (both invariants hold). The raw integer
  `score` on each signal is left untouched (so `buildPickForecast`'s by-key reads are
  unchanged), and the standardized `z` (the IC-bridge feature) is never scaled.
- `timing` and `ivCost` ride at **×1** — they are bounded *conviction* terms folded
  into `total` in parallel (§6/§6.7), not asset-quality reads.
- **Percentile tiers (§4) self-recalibrate** to the re-weighted distribution, so this
  **re-ranks** the roster without changing how many names ship. Measured on the
  committed universe: the slow-fundamental-floated names fall (RDDT +8.6→+4.9, LLY
  +11.0→+8.2, the big banks pulled down), names whose bearish grade rested on weak
  fundamentals are pulled toward zero, and the actionable count is unchanged.
- Gated by `PICKS_HORIZON_WEIGHTS`; set `=0` (or any pillar weight to `1`) to revert.
  With it off the output is **byte-identical** to the legacy equal-weight sum
  (verified: 0/138 grades differ). Expect a **one-time grade/roster shift** on the
  first bake after this ships, like every other scoring rework here.

### 3.5.1 Regime-aware overlay (`PICKS_HW_REGIME`, default ON)

The base weights above are calibrated for a **normal/calm** tape, where single-name
fundamentals and narrative *can* carry a 2-week option. But when the macro tape is
**imploding** that stops being true: cross-asset correlation runs to 1, dispersion
compresses, and the whole universe trades on macro / flow / vol — idiosyncratic
fundamentals & narrative carry near-zero information at the option's horizon. So the
two **slow** pillars (Fundamentals + Narrative) flex with the **regime band**
(`picksRegimeBand` — the macro-stress state from §6.3, with the `severe` distinction
`detectMarketRegime` collapses restored):

| Regime band | Fund + Narr multiplier | Effect |
|---|---|---|
| `risk-on` (clean) | **×1.2** (`PICKS_HW_SLOW_RISKON`) | dispersion returns — stories carry a touch more |
| `neutral` | **×1** | base weights (the common case — **dormant**, byte-identical) |
| `risk-off` | **×0.67** (`PICKS_HW_SLOW_RISKOFF`) | discount the slow pillars; lean on tech/flow/timing/IV |
| `severe` (imploding) | **×0.5** (`PICKS_HW_SLOW_SEVERE`) | halve them — only fast factors carry in a crisis |

So Fundamentals runs 0.6 in a calm tape but **0.4 in risk-off / 0.3 in a severe
tape**; Narrative runs 0.9 → **0.6 / 0.45**. Cutting the slow pillars re-tilts the
**relative** weight of the whole grade toward technicals, flow, entry-timing and IV
cost (the percentile tiers self-recalibrate, §4), without touching their absolute
magnitudes.

- **The macro-regime tilt is exempt** (`HORIZON_WEIGHT_EXEMPT`). The beta-weighted
  bearish `Macro Regime` tilt (§6.3) is a *fixed* signal living in the Narrative
  pillar, but it is a regime **conviction lever**, not an asset-quality read — so it
  rides at **×1** like `timing`/`ivCost`, never discounted by the (regime-cut)
  narrative weight. This is essential in risk-off: cutting the narrative pillar must
  **not** also cut the bearish tilt it carries. (The tilt only fires in a non-neutral
  regime, so neutral output stays byte-identical.)
- **IV cost flexes too** (§6.7) — the richness *penalty* scales **×1.4 in risk-off /
  ×1.7 in severe** (`PICKS_IV_SCORE_RISKOFF_MULT` / `_SEVERE_MULT`): buying long
  premium into a vol spike is far more punishing. Cheap-side credit unchanged.
- **Dormant in neutral.** Because most days are neutral, this is a *conditional
  overlay*, not a blanket re-tune — it activates only when the tape is genuinely
  stressed or euphoric. Gated by `PICKS_HW_REGIME`; `=0` reverts to the flat §3.5
  weights (and re-applies the legacy ×0.9 to the macro tilt). Measured on the
  committed risk-off universe: the roster re-ranks within the bearish set and top
  conviction compresses (NKE 15.9→13.8), as put theses resting on slow
  fundamentals/narrative (e.g. OKLO) are discounted under put theses with
  technical/flow/timing confirmation.
- **Surfaced on the card.** The active band rides on `picks.json`
  (`rosterMeta.regimeBand`) and the `grades.json` payload, and the score-breakdown
  panel renders a one-line banner (`regimeWeightNote` / `.pick-pillars-regime`,
  read via `activeRegimeBand`) when it's non-neutral — so a grade that moved
  because the *tape* turned (not the name) is self-explanatory. Hidden in neutral.

---

### 3.6 Reliability weighting, narrative cap & confluence (the v2 determination layer)

The GD post-mortem (#398) showed a "Strong Call" can be assembled almost entirely
from the **low-evidence end** of the signal set: one AI sentiment pass (+1.8), one AI
sector-story read (+1.8), an AI guidance extraction that misread a dividend hike
(+1.8), and a thin-chain contrarian P/C read (+1.3) — while the well-evidenced
signals (trend structure, revisions, surprise) contributed less than the story did.
§3.5 grades signals by **speed**; this layer grades them by **trustworthiness**.
Three pieces, each independently revertable:

1. **`SIGNAL_RELIABILITY`** (`PICKS_RELIABILITY`, default ON) — a per-signal
   multiplier folded into `applyHorizonWeight` (so both scoring paths get it and the
   chips keep summing to the pillar totals). Single-pass AI reads over headlines are
   demoted hardest — they are volatile across reruns and prone to misclassification:
   `positiveCatalyst` / `sectorNarrative` / `socialSentiment` ×0.5, `guidance` ×0.7,
   `majorContract` ×0.8 (AI-extracted but concrete), `putCallRatio` ×0.75 (contrarian
   even with its liquidity floor). Deterministic price/flow/fundamental measurements
   ride ×1. **`negativeCatalyst` deliberately stays ×1** — a false bullish credit
   costs money, a false bearish read just skips a name (asymmetric prudence).
2. **Narrative cap** (`PICKS_NARR_CAP`, default ±2) — post-weight clamp on the
   narrative pillar's magnitude, contributions rescaled proportionally (chips still
   sum). A story can corroborate a trade; it can never outweigh a confirmed trend.
3. **Confluence gate** (`buildTopPicks`): a graded pick must have ≥
   `PICKS_CONFLUENCE_MIN` (2) of the four asset pillars aligned with its side at
   magnitude ≥ `PICKS_CONFLUENCE_PILLAR_MIN` (0.5), and the technicals pillar must
   not **oppose** the side by ≥ `PICKS_TREND_OPPOSE_FLOOR` (0.5) — a 30–60 DTE long
   needs the move to start soon, and fighting the tape is how theta wins. Skips are
   recorded in `rosterMeta.confluenceSkipped` (`single-family` / `fights-tape`).
   Tactical puts are exempt: their thesis IS the tape (regime + timing `go`), not
   single-name pillar strength.

Like §3.5 these are **priors, not fits** — the IC bridge (§9.6) is the path to
replacing them with measured per-signal weights once forward outcomes accumulate.
Percentile tiers self-recalibrate to the compressed distribution. Known watch item:
`timing`'s +4 `go` ceiling is now a proportionally larger slice of a shipped pick's
total — if forward data shows go-state picks underperforming, that ceiling is the
next candidate to recalibrate. Revert: `PICKS_RELIABILITY=0 PICKS_NARR_CAP=0
PICKS_CONFLUENCE_MIN=0 PICKS_TREND_OPPOSE_FLOOR=0`.

---

### 3.7 Scale-coherence recalibration (post-v2)

Each scoring rework (cross-sectional `W_s` weights, horizon weighting, the §3.6
reliability/narrative-cap compression) shrank the live `|total|` distribution, but a
family of ABSOLUTE thresholds designed against the legacy ±12/±16 bars was never
rescaled with it. Audit findings + fixes (one coordinated pass, #399):

| Threshold | Was | Now | Why |
|---|---|---|---|
| Timing contribution (§6) | −8(−16 floor)..+4 | ×`PICKS_TIMING_FOLD_SCALE` (0.5) at the single exit | timing had silently doubled to 33–61% of shipped picks' totals (one pick was 4.0 timing on 6.5 total — a timing trade wearing a thesis); the fold scale restores the designed ~⅓-of-bar share with the severity structure untouched |
| IV-cost maxes (§6.7) | −3 / +1.5 | −1.5 / +0.75 | same doubling, same fix |
| Abs tier floors (§4) | 9 / 6 | **7.5 / 5** | the 9 strong floor sat ABOVE the post-rescale universe max (~8) — the Strong tier was unreachable in any neutral tape; 6 bound at ~top-7% instead of the documented top-decile backstop |
| Legacy fallback bars | ±12 / ±16 | ±7 / ±10 | above the achievable max — a small-universe build degrading off the percentile path would have shipped ZERO picks |
| Entry-plan strong reads | `absTotal ≥ 16` (dead) | live `strongCut` threaded into `buildEntryPlan` | "full" stance + the 50D-SMA alert were dead code on the compressed scale |
| `GRADE_CHANGE_MIN_DELTA` | 3 | 2 | a 3-point move is now a whole median nonzero grade — the change log would go mute |

The percentile tiers and the `putBar = max(−8, −0.8·tradeCut)` guard already
self-scale and were left alone. Verified post-fix: timing share 0–29% across the
roster, Strong tier reachable (2 names), pillar-sum invariant 0/138 violations, and
the book ships both sides again (puts re-entered the top 10).

### 3.8 Long-horizon + tape-aware rework

A coordinated pass to make the grade read as a **durable, climate-aware thesis**
rather than a short-horizon momentum chase. Diagnosed against the live roster (the
technicals pillar ran as much as ~6× fundamentals on pure-momentum names; entry
timing carried a large share of some shipped totals; the macro gauge was blind to
the breadth/credit deterioration the headline F&G composite masks). All knobs
env-overridable; tiers are percentile-relative so roster *size* is preserved while
*composition* shifts — expect a one-time grade/roster shift on the first bake.

| Lever | Was | Now | Why |
|---|---|---|---|
| Technicals pillar cap (`PICKS_TECH_CAP`) | uncapped | **4.5** | the fastest, ~100%-momentum pillar could dominate a thin thesis (e.g. tech +4.66 vs fund +0.82); same "a family corroborates, never dominates" clamp as the narrative cap. Shipped at 3.5, then **loosened to 4.5** after the IC backtest (below) showed 3.5 was clipping real directional signal — now caps only a degenerate single-pillar reading |
| Timing fold — positive side (`PICKS_TIMING_FOLD_SCALE_POS`) | 0.5 (symmetric) | **0.35** | a clean `go` was manufacturing conviction; demote the entry-credit so the grade reflects the *thesis*, while the knife/chase **penalty** keeps the full `PICKS_TIMING_FOLD_SCALE` (the risk control stays) |
| Fundamentals horizon weight (`PICKS_HW_FUND`) | 0.6 | **0.8** | lift the durable share — but only **paired** with the longer hold below (re-weighting fundamentals on a 2-week-held option just sizes bets on signals that don't move price in 2 weeks) |
| Ideal DTE band (`PICKS_IDEAL_DTE_LO/HI`) | 30–60 | **45–90** | give a durable thesis contract runway instead of buying the theta cliff |
| Measured hold (`PICKS_ACCURACY_MAX_HOLD_DAYS`) | 14 | **30** | the tracker measures the (now longer-DTE) thesis on a horizon it can resolve on; the theta-stop still cuts a position bleeding with no progress |
| **Thesis Durability** signal (`PICKS_DURABILITY_SIGNAL`) | — | **new** | the one multi-period read the fundamentals pillar lacked: earnings-beat consistency over ~4 quarters + net-margin trend, z-scored cross-sectionally and clustered with the growth family (1/√K) |

**Tape-internals → "fragile" graded sub-state (`PICKS_MACRO_FG_INTERNALS`, §6.3).**
The cross-asset gauge's sentiment axis read only the headline Fear & Greed
*composite* at its 25/75 extremes — so a 33.5 "fear" reading with **breadth 20.8 and
junk-bond credit 7.8 in extreme fear** (the late-cycle "index holding, internals
bleeding" tape), and a month-long 65→33 slide, cast a **zero** vote and left the
neutral branch applying *zero* risk management. The gauge now reads the F&G
**components** (breadth + credit) and its multi-day trend — but, because breadth and
credit can stay washed-out for weeks in a grind-higher tape, these do **not** vote
into the binary state machine (that would manufacture a near-permanent bear lean).
Instead an otherwise-neutral tape with washed-out internals (or a ≥20pt composite
collapse vs a month ago, now < 45) is flagged **`fragile`**: a graded middle that
trims deployed gross to `PICKS_MACRO_GROSS_FRAGILE` (~0.8) and tightens the per-side
cap to `PICKS_MAX_PER_SIDE_FRAGILE` (6), so the roster stops stacking maximally long
into weakening internals — *without* the bearish tilt / tactical puts a **confirmed**
risk-off applies (price/vol aren't confirming the break yet). Surfaced as the amber
"⚠ Fragile" market-tape chip. On 2026-06-12 this took the roster from 8 calls / 2
puts to 6 / 2 at 80% gross.

**Offline validation (`scripts/diagnose-signal-ic.mjs`).** Because #416 reset the live
track record, this rework was validated against the committed `priceSeries` instead:
a point-in-time cross-sectional IC backtest over ~25k name-date observations. It
**strongly validated the horizon lengthening** — every trend/momentum signal's IC and
t-stat grow monotonically from 5d → 30d (the reconstructed tech pillar goes t≈1.3 @5d
→ t≈8.0 @30d; 60-day momentum and 52-week position reach t≈19–20 @30d), i.e. the engine
had been trading at the horizon where its own signals are *weakest*. It **supported the
timing demotion** (pullback-`go` setups had the lowest forward returns, so the `go`
credit was over-rewarding weak-forward-return entries) but showed the chase *penalty*
is direction-wrong on the underlying (chasing strength beat buying dips), defensible
only on the option IV/crush grounds the backtest can't see. And it **contradicted the
3.5 technicals cap** on direction (extreme-momentum names kept outperforming), which is
why the cap was loosened to 4.5. The reads are regime-dependent — chasing wins in up
tapes, knife/buy-the-dip wins in down tapes — so regime-aware capping/timing is the
natural follow-up. Caveats (in the script header): it measures *underlying* return, not
option P&L; absolute levels are survivorship-biased (read the rank IC); one ~12-month
cycle. Re-run it (and `diagnose-grade-ic.mjs` once the live store re-accumulates) before
pushing the Phase-2 knobs further.

---

## 4. Tiers (`tierForScore`)

Tiers are **percentile-relative** (P3.2 — see [`top-picks-improvements.md`](./top-picks-improvements.md)),
the necessary consequence of the cross-sectional scoring in §3. Each build:

| percentile of `|total|` across the universe | Tier | Conviction | Sizing |
|---|---|---|---|
| top `PICKS_TIER_PCTL_STRONG` (5%) | Strong Call / Strong Put (by sign) | Very High | §4.1 |
| next, to top `PICKS_TIER_PCTL_TRADE` (12%) | Call / Put (by sign) | High | §4.1 |
| else | No Trade | — | Skip (not shipped) |

`tierForScore(score, {strongCut, tradeCut})` takes the cutoffs computed in
`computeCrossSectionalScores` (the `|total|` at the top-5% / top-12% ranks). On the
**small-universe / flag-off** path (`scored.length < PICKS_Z_MIN_UNIVERSE`, or
`PICKS_XSECTIONAL=0`) it falls back to the legacy **absolute** bars
`PICKS_MIN_CONVICTION = 12` / `PICKS_TIER_STRONG = 16`. Those bars were themselves
recalibrated twice (±16/±20 → ±14/±18 → ±12/±16) as the scoring was de-inflated — a
treadmill the percentile tiers now retire: the bar tracks the distribution every build
by construction. On 138 names the percentile tiers yield ≈8 Strong / ≈18 actionable.
Scores stay on a roughly-legacy scale via the scale-preserving weights
`W_s = oldMax/PICKS_Z_CLIP` (§3), so the secondary ±12/16 / −8 reads elsewhere stay valid.

> **Absolute floor under the percentile (P0.4 — "cash is a position").** Percentile
> tiers alone pass ~the same count *every* build, so on a uniformly weak/expensive
> tape the engine still mints a full roster — it can never say "nothing worth buying
> today." The cutoffs are therefore **floored** at an absolute bar:
> `strongCut = max(pctl 5%, PICKS_ABS_STRONG_FLOOR)`, `tradeCut = max(pctl 12%,
> PICKS_ABS_TRADE_FLOOR)` (defaults **7.5 / 5**, re-derived from 9/6 after the v2 + fold-scale compression — §3.7; env-set to 0 to disable).
> A name must clear **both** the rank **and** the floor, so when the top-12% `|total|`
> sits below the floor the actionable set shrinks — the roster honestly ships **fewer
> than 10, or 0**.
>
> The floor lives on the standardizer's compressed `|total|` scale (§3.4), **not**
> the legacy ±12/±16 conviction bars. Horizon weighting (Fund ×0.6 …) + the z-clip
> weight (`W = oldMax/PICKS_Z_CLIP`) pull the achievable `|total|` well below the old
> absolute scale: on the live ~138-name universe the natural top-12% runs **~4
> (neutral) / ~7 (risk-off) / ~12 (severe)**. The original defaults (= the legacy
> `PICKS_MIN_CONVICTION` 12 / `PICKS_TIER_STRONG` 16) therefore sat *above* the
> achievable max outside a severe tape and bound in **every** regime — zeroing the
> graded roster (not merely shrinking it) and bypassing the percentile tiers except
> under severe stress (graded picks only shipped when the macro tilt inflated
> magnitudes to ~12). Recalibrated to **6 / 9** (decoupled from the conviction bars):
> the floor now backstops only the calmest tapes (neutral ~top-decile clears 6), the
> percentile takes over as dispersion rises (risk-off top-12% ~7 > 6 → graded puts,
> not just sub-bar tactical ones), and severe is unchanged (floor < its ~12 cutoff).
> Measured on the committed universe: **neutral 0 → 5 graded calls, risk-off 7
> tactical puts → 10 graded puts, severe 10 graded puts (unchanged)**.

The universe is curated long, but **cross-sectional standardization demeans it** (§3),
so the actionable set — selected by percentile of `|total|` regardless of sign — can
carry materially more outright puts than the old absolute engine (a relatively-weak
name now goes clearly negative rather than sitting near 0). The timing gate's risk-off
**tactical put** path (§6) still adds sub-bar puts on a confirmed-risk-off tape.

> **Tier hysteresis (`PICKS_TIER_HYSTERESIS`, default ON) — the boundary-churn fix.**
> The percentile cutoffs are recomputed from scratch every build, so a name sitting
> AT the top-12% boundary flipped in/out of the actionable set hourly (the churn log
> showed names entering and exiting within one build) — noise for a ~14-day-hold
> product. The boundary is now a **Schmitt trigger**: a name ENTERS at the full
> `tradeCut`, but an incumbent (actionable in the prior build's grade snapshot, same
> side) only EXITS once `|total|` falls below `tradeCut × PICKS_TIER_EXIT_FRAC`
> (0.9). A sign flip re-qualifies at the full bar. Prior state is the same pre-wipe
> `grades-history.json` `latest` snapshot the churn log diffs against (threaded as
> `opts.priorGrades` through `buildTopPicks` / `buildGradesIndex` →
> `scoreAllTickers`); absent (first run / small-universe fallback) → no hysteresis.
> The published bar (`rosterMeta.tradeCut` / `minConviction`) stays the ENTRY bar.

### 4.1 Sizing (`applyPickSizing`, P3.4)
Sizing is **numeric and risk-based**, not the old "Standard / Load the Boat" label.
For each roster survivor: a per-name risk denominator (the option-aware % of premium
lost if the underlying hits the stop — `(stopDistFrac·spot·|Δ|)/premium`, capped at
100%, ATR%-of-underlying fallback, floored at `PICKS_SIZE_VOL_FLOOR`), a conviction
`tilt = clamp(|total|/strongCut, PICKS_SIZE_TILT_MIN, _MAX)`, then a normalized
`weight = (1/risk · tilt)/Σ · grossTarget` (Σ weight = the gross target, rest
cash). Each pick ships a `sizing` block `{weight, riskToStopPct, riskDenom,
suggestedContracts}`, rendered "size ~X% of book · ~N contracts at $Y" against a
display-only `PICKS_DISPLAY_ACCOUNT`. Highest-vol survivor → smallest weight (risk parity).

**Thin-roster guard (P0.4).** Now that the absolute floor lets the roster honestly
shrink, the deployed gross is **ramped**: `grossTarget = PICKS_GROSS_TARGET ·
min(1, n/PICKS_SIZE_FULL_ROSTER_N)` (n = roster size, full at 5). A 1–2 name roster
therefore holds proportionally more cash instead of dumping the whole 80% into one
position (a 1-name roster caps at 0.80/5 = 16%). This caps **concentration**, not
leverage-vs-edge — the edge governor (scale gross by realized option expectancy) is a
separate, still-pending fix.

---

## 5. Contract selection (`pickContractForPick`)

Once a name is actionable, the engine picks one contract on the graded side. Hard
filters (drop the contract if any fails), then a composite quality score picks the
best survivor:

- **DTE** ≥ 14 (roster path: ≥ 21); standard monthlies only (third Friday).
- **|Delta|** 0.45–0.65 (target 0.55) — **near-the-money** (P1.1). Moved off the
  old cheap/fragile 0.20–0.40Δ OTM band, where an ~8% adverse underlying move was
  ≈ −70% on the option; a slightly-ITM contract carries less theta drag and
  IV-crush sensitivity and survives one red day. Delta is the primary moneyness gate.
- **Moneyness sanity bound** −20% (ITM) … +12% (OTM) from spot — a loose bound now
  that delta gates moneyness, not the old 5–30% OTM rule.
- **Bid/ask spread** ≤ 18% (roster: ≤ **10%**, `PICKS_CLEAN_MAX_SPREAD_PCT`, tightened from 12% — a wide spread is a first-order tax on a single-leg long, ~25% round-trip on the legacy OTM picks). The composite also **weights spread hard** (0.24) and saturates its penalty at `PICKS_SPREAD_PEN_REF` (10%), so the tightest-spread survivor wins.
- **Open interest** ≥ 50 (roster: ≥ 100); needs a real two-sided quote.
- **IV** ≤ 200%; **premium** ≤ **max($35/share, 12% of spot)** — price-aware
  (P1.1, `PICKS_MAX_PREMIUM_PCT_OF_SPOT`). A flat $35 cap fit the old cheap OTM
  contract; at 0.55Δ it would gut the roster to only cheap stocks, so the cap scales
  with spot (premium bounded as a share of exposure) while still rejecting a
  genuinely overpriced (e.g. earnings-IV-inflated) ATM.
- **Roster (`requireClean`)** additionally refuses any contract the live Grade-tab
  grader would call "bad" (theta >2.5%/day, dte ≤3, ≥80%-extrinsic with <14 DTE).
- **Roster composite-quality floor** (`PICKS_CLEAN_MIN_QUALITY`, default 0.5): the
  winning contract's composite quality (`qualityScore = 1 − composite penalty`)
  must clear the floor or the selector returns null and the name drops at the
  P1.4 candidacy gate. The per-gate filters are each pass/fail, so on a thin
  chain a contract that squeaks under *every* line at once (spread at the 10%
  cap, OI barely 100+, zero volume, DTE far past the 30–60d sweet spot) used to
  ship as the chain's sole survivor with nothing to out-rank it — the GD Sep-99d
  vol-2 contract that motivated this scored 0.40 while legitimate roster picks
  score 0.61–0.78 (universe p10 ≈ 0.61). Ship fewer picks rather than a
  structurally untradeable one.

**Structure — single long, or an auto debit vertical in rich IV.** The default
structure is a single long (`structure:'long'`, `netDebit = mid`). When
`PICKS_VERT_AUTO` (or the master `PICKS_VERTICALS`) is on **and** IV rank ≥
`PICKS_VERT_IVRANK` (70; or ≥ `PICKS_VERT_NEGEDGE_IVRANK` = 50 on a measured-negative-edge
book), the long is financed by **selling an OTM wing** on the same expiry — a debit
vertical that cuts net vega/theta so you're not buying naked premium when it's
expensive (the structural complement to the §6 IV gate). `contract.mid`/`breakeven`/
sizing all repoint to the **net debit** and the modeled-exit repricer nets both legs
(`modelVerticalExit`). **`PICKS_VERT_AUTO` is DARK by default**: enabling it live needs
the pick *card* to render two legs (it shows the net debit + breakeven today but not
the spread structure / capped max-profit), and the loss-attribution diagnostic
(`scripts/diagnose-pick-losses.mjs`) still shows losses are **direction-driven** (a
vertical only shrinks a wrong-side loss). Ship the policy wired + sizing-correct;
flip it on after the card render + forward validation — same discipline as
`PICKS_VERTICALS`.

**Exit geometry — volatility-aware stop.** `buildExitPlan` sets the take-profit at
the nearest meaningful S/R (≥ ~half the chain's 1σ move). The cut used to be a flat
~8% on the underlying — which, on a high-beta name, sits *inside* one average daily
range, so routine chop stopped the trade out (≈ −70% on a deep-OTM option). The cut
is now the **deeper of nearest structural support and a ~2.5×ATR floor** (clamped
5–12%), so it sits *outside* the daily noise band: a real broken level still exits,
but ordinary volatility doesn't. Null ATR (thin history) → the prior 8% behavior
(graceful). This is the structural complement to the timing gate — the gate stops us
*entering* badly, the ATR floor stops a good entry from being *shaken out* on noise.

**Premium-space exits — hard stop + a TRAILING take-profit (let winners run).**
`resolvePickOutcome` resolves on the MODELED option P&L before the underlying-level
TP/cut. The downside is a flat hard stop at `−PICKS_OPT_STOP_PCT` (−40% of entry
premium). The upside is **not** a flat cap: long-premium P&L is right-tail-driven (a
few big winners pay for the losers), so capping every win at +60% truncates exactly
those. Instead, once the **peak** modeled gain arms at `PICKS_OPT_TP_PCT` (+60%), the
exit floor ratchets to `max(peak·(1−PICKS_OPT_TRAIL_GIVEBACK), +60%)` — it locks **at
least** the old flat TP and trails a runner upward, exiting only on a `giveback` (33%)
pullback from the peak. Strictly Pareto over the flat TP (never locks less than +60%);
the recorded outcome is by the **sign** of the modeled P&L at the trigger, so a violent
gap back through the floor between build samples is booked as an honest give-back, not
a phantom win. Peak is tracked as `optMfePct` (the constant-entry-IV mark, same basis
as the +60/−40 levels). `PICKS_OPT_TRAIL=0` reverts to the legacy flat take-profit.

---

## 6. Entry timing as the 5th score component (`computeEntryTiming`)

A pure, server-side function (no AI, no network) called by `scorePillared` for
**every** ticker. It reads **confirmed daily bars** (the last/in-progress candle is
dropped — same convention as the chart-pattern cache, so a mid-session print can't
fake a signal) plus the already-computed technicals, and returns a state plus a
bounded **`contribution` (−8..+4)**. That contribution is **folded into `total`**
as a 5th component (alongside the four pillars), so `grades.json`, the ±12/±16
tiers, the grade-change log, the churn log, the roster snapshot and the Top Picks
ranking all reflect entry timing through the one score. It weakens or strengthens
conviction in the grade's implied direction but never flips the side.

It is the server-side sibling of the browser's live `buildExecuteNowCard`
(`scripts/render/app-js.mjs`): that card reads *live intraday* structure on the
Grade tab; this gate reads *confirmed daily* bars and adds the multi-day
extension / falling-knife reads the card lacks.

### Inputs (all already on disk — zero new Yahoo calls)
Direction-normalized so the same code handles calls and puts (a put's "good" move
is down): multi-day returns `ret1d/ret3d/ret5d`, drawdown from the 20-bar extreme
in ATR units, extension beyond the 20D SMA, RSI + 5-day RSI change, MACD, relative
volume, position in the 52-week range, the 20D S/R levels, the broad-market regime
(SPY day move + VIX level **and term-structure slope**, §6.3), days-to-earnings,
and a **prediction-market macro-event-risk read** (§6.6).

### States → score contribution
The state is informational; what feeds the grade is the `contribution`:
- **`avoid`** → falling knife or chasing an extended top → **−8, scaled deeper by
  severity** (`PICKS_TIMING_AVOID_SCALE`, default ON). A *flat* −8 let the most
  egregious blow-offs survive a high four-pillar grade (`|subtotal| − 8` can stay
  above the bar), and those extreme chases/knives are the biggest historical losers.
  So the penalty scales with how far past its trigger the worst firing read is —
  `severity = max overshoot ratio` (a +50% 5-day run is 5× the 10% chase trigger; a
  −15% 1-day drop is 2.5× the −6% knife trigger) → `penalty = max(PICKS_TIMING_AVOID_FLOOR,
  −8 · severity)`, floored at **−16**. A borderline chase (severity 1, right at the
  trigger) still gets exactly −8, so it's a strict superset of the old flat penalty.
  Still **one number** folded into `total` (no separate veto, no backfill); the worst
  setups are simply neutralized to a no-trade on their own.
- **`wait`** → no clean entry yet (mixed structure / catalyst imminent / tape
  fighting it) → a small negative from the pro/con tally (clamped to −8..+4).
- **`go`** → a clean, well-located entry → up to **+4**, strengthening conviction.

Every shipped pick is enrolled in the track record (§8): entry timing is already
in the score, so the roster *is* the set of well-timed, endorsed entries.

### 6.1 Hard vetoes → `avoid`

**Falling knife** (don't catch it; also neutralizes the contrarian §3 "buy-the-crash"
signals at entry time) — any of:
- `ret1d ≤ −6%` against the trade (a 1-day collapse), or
- `ret3d ≤ −8%` against the trade **and** rvol ≥ 1.3 (a slide on volume), or
- adverse excursion ≤ −2.5 ATRs from the 20-bar extreme **and** RSI still moving
  against the trade.

**Chasing an extended top** (the dominant historical failure) — any of:
- **A** — RSI ≥ 70 in the trade's direction **and** (≥ 8% beyond the 20D SMA **or**
  ≥ 92% of the way to the 52-week extreme), or
- **B** — a ≥ +10% 5-day run **and** ≥ 7% beyond the 20D SMA, or
- **C** — a ≥ +10% 3-day blow-off **and** ≥ 7% beyond the 20D SMA.

(Resistance proximity is intentionally *not* required — a vertical run to a fresh
high is a chase even when it's nowhere near a prior 20D ceiling.)

A confirmed break of the *wrong* level (below 20D support for a call, above 20D
resistance for a put) with no offsetting strong positive also → `avoid`.

### 6.2 `go` vs `wait`
Structure / momentum / **volume** / location accumulate as signed pros & cons:
- **Strong pros:** a confirmed breakout on ≥1.3× volume; RSI + MACD aligned with the
  trade; a **healthy pullback to the 20D SMA in an intact trend with momentum turning
  back up** (this is the dip-buy we *want* — the one historical winner, OKTA entered
  at a local low, fit this).
- **Strong cons:** momentum against the trade; a wrong-side 20D break; the broad tape
  fighting it (§6.3); earnings within `PICKS_TIMING_EARNINGS_DEFER_DAYS` = **8**
  sessions (P1.3 — IV ramps 1–2 weeks out, so 3 was too tight; IV-crush risk →
  forces `wait`). A pick whose contract **expiry falls after** an earnings date is
  additionally flagged `earningsBeforeExpiry` (crush-exposed) on the timing panel.
  - **Earnings-eve entry veto (hard, roster-level).** The `wait` alone is only one
    strong con in the tally — a couple of aligned pros cancel it, so a name reporting
    *tonight* could still grade onto the roster. Since the tracker force-exits
    ≤`PICKS_EARNINGS_EXIT_DAYS` pre-print (§8), `buildTopPicks` now hard-drops any
    candidate with earnings ≤`PICKS_EARNINGS_VETO_DAYS` (default = the exit window, 2)
    — don't *open* what the exit rule would immediately *close*. No backfill; logged
    to `rosterMeta.earningsEve`. The 3–8d defer band still ships, surfaced as a ⏳ WAIT
    chip on the card/grid with the entry ladder labelled a post-event playbook.
  - **Session-aware crush anchor.** Earnings-day math anchors at the moment the
    crush is *realized* (`earningsAnchorMs`: AM print → the open ~14:30Z, PM/TBD →
    the close ~21:00Z), not the old 16:00Z (= noon ET in summer) — that anchor
    cleared a PM print's defer/`earningsInWindow` flags hours **before** the print,
    and its −1-day tolerance kept "earnings in 0d" deferring the morning **after**
    the crush had already passed. Mirrored in the browser (`earningsAnchorMsLive`).
- **Vol-surface gate (strong con) — IV rank as a gate, not a nudge.** The own-history
  IV-rank read is a *soft* con at the rich threshold (`PICKS_IVRANK_RICH` = 80, −1) but
  upgrades to a **strong** con at an extreme percentile (`PICKS_IVRANK_VETO` = **90**,
  default ON; set 0 to disable). A strong con blocks `go` → `wait` (not enrolled) and
  shaves the contribution, so the engine won't endorse a **naked long bought at the
  90th+ percentile of a name's own vol** — including a risk-off "tactical put" bought
  into a VIX/IV spike (long vol *after* the move). Side-aware (weakens conviction for
  whichever side, never flips it). The structural complement is §5's auto-vertical: at
  rich IV the contract is financed as a debit spread rather than bought outright.
- **Volume confirmation (soft, ±1).** Volume tells you whether to believe the move.
  Beyond the breakout/knife reads above: a move the trade's way on **≥1.3× rvol**
  (`PICKS_TIMING_VOL_CONFIRM`) that isn't already a clean break is real participation
  (+); the same move on **<0.8× rvol** (`PICKS_TIMING_VOL_LIGHT`) is a low-conviction
  drift that tends to fade (−). On a pullback the read **inverts**: light volume into
  support is sellers drying up (+), while **≥1.5× rvol** (`PICKS_TIMING_VOL_HEAVY`)
  into it looks like distribution (−).
- **Defined-risk entry (soft, +1) — an "other factor".** An entry sitting within
  `PICKS_TIMING_NEAR_LEVEL_PCT` (1.5%) of the 20D level it can lean on (support for a
  call, resistance for a put) earns credit for a tight, well-defined stop — the
  structural complement to the ATR-floor cut (§5). Not credited while chasing or
  breaking the wrong way.
- **Ex-dividend nudge (soft, ±1, side-aware).** A long *call* held across the
  ex-dividend date eats the open gap-down by the dividend (plus early-assignment risk
  on a slightly-ITM strike) → −1; a long *put* benefits from the same gap → +1. The
  drop is already priced into the option via the forward, so this is a small nudge,
  **not** a hard defer like earnings (ex-div is not an IV-crush event), and it only
  fires for a real dividend payer (`PICKS_TIMING_EXDIV_MIN_YIELD` = 1.0% annual) with
  the ex-date within `PICKS_TIMING_EXDIV_DEFER_DAYS` (2) sessions — so the no-yield
  majority never trips it. Reads `fundamentals.exDivDate` (Yahoo `calendarEvents`).
- **Holiday/weekend theta drag (soft, −1, side-agnostic).** A long debit decays on
  calendar days but the underlying only moves on trading days, so entering right
  before a long weekend / holiday-shortened stretch is dead premium bleed. Counts
  non-trading calendar days (weekend or NYSE holiday) in the next
  `PICKS_TIMING_DEADDAYS_WINDOW` (5); a normal Mon–Fri week peaks at 2, so only a
  market holiday in the window pushes it to `PICKS_TIMING_DEADDAYS_CON` (3) → a −1 con
  that pulls borderline names below the absolute floor (don't pay a long weekend's
  theta on a thin thesis). Direction-agnostic — theta is a long-debit cost either way.

The soft volume/defined-risk/ex-div/dead-days reads tune the bounded `contribution` (and thus `total`)
without by themselves flipping the verdict — `go` = a strong pro with no strong con;
otherwise `wait`.

### 6.3 Market overlay & risk-off puts (`detectMarketRegime`)
The **base** regime is conservative — **risk-off requires both** a ≥1% SPY drop
**and** an elevated/rising VIX; risk-on requires a firm SPY up day with a calm VIX.

- **Cross-asset macro-stress override (`PICKS_MACRO_REGIME`, default ON).** A
  coordinated risk-off / financial-conditions-**tightening** tape shows up across
  many assets at once — equity vol (VIX), the dollar (DXY), the long end (10Y/30Y
  yields), the **Fed path** (FedWatch hike-odds repricing hawkish), plus a **commodity
  / geopolitical-shock** axis and a **geopolitical-news** axis — usually
  *before* the S&P prints a −1% day. `computeMacroRegime(macroBackdrop, fedwatchHistory, narratives)`
  fuses those eight axes (each **−2..+2**, negative = risk-off) into one gauge.
  **The fast axes vote symmetrically** — VIX, the dollar, yields, news and
  sentiment can all flip a tape risk-ON (or back to neutral) as fast as they
  flip it off, not just confirm stress:
    - **VIX** — level / trend / term-structure backwardation (reuses the reads below). Risk-ON: < 14 calm → +1, **or** a sharp same-day crush (1d ≤ `PICKS_MACRO_VIX_REVERSAL_1D`, −8%) below the risk-off band (< 18, no inversion) → +1 — vol unwinding is one of the fastest tells the tape flipped.
    - **DXY** — 1d ≥ `PICKS_MACRO_DXY_1D` (0.6%) or a rising-trend 5d ≥ `PICKS_MACRO_DXY_5D` → −1; ≥ `PICKS_MACRO_DXY_1D_STRONG` (0.9%) → −2. Symmetric easing: 1d ≤ −0.6% or a falling-trend 5d ≤ −1.0% → +1.
    - **Long yields** — worst of 10Y/30Y: 1d ≥ `PICKS_MACRO_YIELD_BPS_1D` (10 bps) or a confirmed rising trend → −1; ≥ `PICKS_MACRO_YIELD_BPS_1D_STRONG` (16 bps) → −2. Symmetric easing: 1d ≤ −10 bps or a confirmed falling trend → +1.
    - **Fed path** — net hawkish drift `(hike−cut)` averaged over the nearest `PICKS_MACRO_FED_MEETINGS` (3) meetings vs `PICKS_MACRO_FED_LOOKBACK` (5) snapshots back: ≥ `PICKS_MACRO_FED_DRIFT_PT` (5 pt) → −1; 2× → −2 (reads `data/fedwatch-history.json`).
    - **Commodity / geopolitical shock** (`PICKS_MACRO_COMMODITY`, default ON) — a war / supply shock spikes crude (and bids gold) within *minutes*, usually before VIX/yields react. **Stress-only & asymmetric** (only a sharp spike counts — a gradual demand-driven grind, or a drop, is **not** risk-off): crude 1d ≥ `PICKS_MACRO_OIL_1D` (4%) or 5d ≥ `PICKS_MACRO_OIL_5D` (12%) → −1; ≥ `PICKS_MACRO_OIL_1D_STRONG` (8%) **or** a crude spike *with* a gold safe-haven bid (gold 1d ≥ `PICKS_MACRO_GOLD_1D` 3% / 5d ≥ `PICKS_MACRO_GOLD_5D` 6%) → −2. Reads the `CL=F`/`GC=F` legs now on `macroBackdrop`.
    - **Geopolitical news** (`PICKS_MACRO_NEWS`, default ON) — a strong active war/conflict narrative from the AI narrative layer flags systemic risk before it fully prices in. A `GEO_CONFLICT_RE` theme (war/invasion/missile/…) scores regardless of the narrative's equity sentiment; a softer `GEO_THEME_RE` flashpoint (sanctions/OPEC/named region) only when **bearish**. Strength ≥ `PICKS_MACRO_GEO_MIN_STR` (45) → −1; ≥ `PICKS_MACRO_GEO_STRONG_STR` (65) → −2. (`computeGeoNewsStress`, pure — no extra AI/network.) On top of the narrative read, the axis nets a deterministic **headline tone** from the fresh slice (≤ `PICKS_MACRO_HEADLINE_AGE_H`, 36h) of the press/wire macro headline slate (`trends.json` `macroHeadlines`): a de-escalation slate (`GEO_DEESCALATION_RE` — ceasefire / peace or nuclear or trade deal / tariff relief / tensions easing) **lifts the axis one notch** (a −2 war read eases to −1; a calm tape reads **+1** — the one media path that can vote risk-ON before prices react); an escalation slate (`GEO_ESCALATION_RE` — strikes / invasion / new sanctions or tariffs / talks collapsing) flags −1 even before a narrative forms (`computeHeadlineGeoTone`, pure, exported).

  > **Geopolitical shocks need ~no VIX move to register.** The two new axes are the
  > direct, fast tells of a war / supply shock (oil + headlines), so one event can put
  > the gauge at 2 risk-off axes → **risk-off** on an otherwise calm VIX/yields tape —
  > exactly the "an Iran war should tilt the book" case. Both fire only on a genuine
  > spike / strong narrative, so they're dormant in normal conditions.

  **Breadth is collinearity-aware (`PICKS_MACRO_AXIS_DECORR`, default ON).** The eight
  axes are not independent: in a real risk-off the dollar/rates complex (DXY + long
  yields + Fed path) moves together and the fear/vol complex (VIX + the F&G-driven
  sentiment axis) moves together, so one macro shock can light up four or five axes
  at once. Counting those as independent confirmations made the raw "≥2 axes →
  risk-off" trigger fire on a single double/triple-counted move. The gauge therefore
  splits the axes into correlated **clusters** — `rates` = {DXY, yields, Fed},
  `vol` = {VIX, sentiment}; commodity / geopolitics / the slow monthly inflation
  print stay singletons — and counts breadth with diminishing weight: the strongest
  lit axis in a cluster counts 1, each additional same-direction axis counts
  `PICKS_MACRO_CLUSTER_DISCOUNT` (0.5). This **effective** count (`effRiskOffAxes` /
  `effRiskOnAxes`, surfaced in the payload) drives the plain risk-off / risk-on
  triggers, so a same-cluster-only shock (a dollar bid + rising yields with nothing
  else) reads ~1.5 effective axes → **neutral**, where the legacy raw count (2) read
  risk-off. This is a **breadth** correction only — `stress` stays the raw additive
  DEPTH composite (a −2 VIX and a −2 DXY genuinely is more stress than either alone),
  and **`severe-risk-off` keeps its RAW-count gate** (it's break-glass, already
  double-gated on a deep `stress ≤ −4` a single mild shock can't reach). Set the flag
  =0 to restore the legacy independent-axes count byte-for-byte.

  `riskOffAxes` = raw axes at ≤ −1 (the effective count above is `effRiskOffAxes`).
  **`risk-off`** when `effRiskOffAxes ≥ PICKS_MACRO_RISKOFF_AXES`
  (2); **`severe-risk-off`** when raw `riskOffAxes ≥ PICKS_MACRO_SEVERE_AXES` (3) **and** the composite
  `stress ≤ PICKS_MACRO_SEVERE_STRESS` (−4); `risk-on` when `effRiskOnAxes ≥
  PICKS_MACRO_RISKON_AXES` (2) **and** `stress ≥ PICKS_MACRO_RISKON_STRESS` (+2)
  **and** raw `riskOffAxes ≤ PICKS_MACRO_RISKON_MAX_OFF` (1) — the old rule demanded
  *zero* dissenting axes across eight, which made risk-on nearly unreachable; a
  clearly positive composite can now carry one dissenter (e.g. a vol crush +
  dollar/yields easing reads risk-on through a still-hot CPI). The carve-out is
  for MILD dissent only: risk-on additionally requires the VIX axis itself
  unstressed (score ≥ 0 — an elevated/rising/backwardated VIX can never be the
  carried dissenter, mirroring the base path's block-risk-on-while-inverted
  rule) and no axis at −2 (acute stress). A risk-on read's `drivers`/`summary`
  list the POSITIVE axes (the stress-axis `drivers` list was always empty under
  the old zero-dissent rule; naming the lone dissenter as the "driver" of a
  bullish lean would invert the attribution). `detectMarketRegime` returns **risk-off** whenever the composite
  is (severe-)risk-off — *independent of the SPY day move* — so the engine positions
  into the building stress before the index capitulates, and never reads risk-on while
  the macro is stressed. Attached to `macroBackdrop.macroRegime` upstream (`main()` +
  `regen-picks.mjs`); absent (flag off / no FedWatch on a regen) → the pure SPY+VIX
  behavior, byte-identical.
- **Differential book tilt (`PICKS_MACRO_TILT`, default ON) — the re-ranking lever.**
  A *uniform* macro nudge can't re-rank a cross-sectional engine (it demeans away, §3).
  So in a (severe-)risk-off tape `computeMacroTilt` adds a **beta-weighted bearish
  tilt** as a **fixed** `Macro Regime` signal in the Narrative pillar (fixed signals
  aren't z-scored, so the differential survives the demean and folds into the
  directional subtotal in **both** scoring paths). Magnitude **ramps continuously
  with the stress composite** (`PICKS_MACRO_TILT_RAMP`, default ON): `|tilt| =
  PICKS_MACRO_TILT_BASE × |stress| / PICKS_MACRO_TILT_FULL_STRESS` (4 × |stress|/4),
  capped at `PICKS_MACRO_TILT_SEVERE` (8) — so a just-triggered stress-−2 tape tilts
  −2, the old −4 base is reached at stress −4, and the −8 severe magnitude only at
  stress −8; risk-on ramps the same way toward `+PICKS_MACRO_TILT_RISKON` (2). (The
  old behavior was a **step** on the state label — −4 in *any* risk-off, −8 in severe
  — which was as large as the rest of the grade, so one borderline 2-axis regime read
  flipped the entire book to puts; `PICKS_MACRO_TILT_RAMP=0` restores the step.) All
  **× the name's beta** (real `fundamentals.beta`, else a factor-cluster /
  defensive-sector proxy, clamped `[PICKS_MACRO_TILT_BETA_FLOOR 0.5, _CAP 1.6]`). So the
  whole long book is discounted, hardest on high-beta growth, and the highest-beta
  marginal **calls flip to puts** while weak names go clearly negative (more graded +
  tactical puts).
- **Regime persistence (`PICKS_REGIME_PERSIST`, default ON) — the whipsaw fix.** The
  discrete state fed every consumer (tilt, knife thresholds, de-gross, slow-pillar
  weights) the instant it flipped, so a tape hovering AT a trigger (VIX ~20, Fed
  drift ~5pt) whipsawed the whole book between long-leaning and all-puts build to
  build. `applyMacroRegimePersistence` adds **asymmetric hysteresis**: a move toward
  MORE risk-off applies immediately (never delay defense); de-hedging OUT of a
  defensive state (risk-off/severe recovering toward neutral / risk-on) must be
  read on **two consecutive builds** before it takes effect — but an upgrade FROM
  neutral (→ risk-on) carries no put-book flip, so it applies the same build:
  the tape turns risk-on fast and the gauge follows. The prior state comes from the previous
  `picks.json` `rosterMeta.macroRegime` (read pre-wipe by `main()`, directly by
  `regen-picks`); the instantaneous read rides on `rawState` + a `persisted` flag so
  the UI/logs can show "holding risk-off pending confirmation". Absent prior →
  the raw read stands (graceful).
- **De-grossing + severe-tape guards.** A desk cuts *size* in a tightening tape, not
  just side. `applyPickSizing` scales the deployed gross by `PICKS_MACRO_GROSS_RISKOFF`
  (0.6) / `PICKS_MACRO_GROSS_SEVERE` (0.4). In a **severe** tape the roster also **caps
  calls** at `PICKS_MACRO_SEVERE_CALL_CAP` (3, the rest fill with puts / cash) and
  **relaxes the tactical-put bar** to `PICKS_MACRO_SEVERE_PUT_BAR` (−5, vs the −8 below).
  The gauge (state, four axes, drivers, gross multiplier) rides on
  `rosterMeta.macroRegime` and renders in the Top Picks summary chip.
- **VIX term-structure backwardation.** `detectMarketRegime` also reads the VIX
  curve (`^VIX9D` / `^VIX` / `^VIX3M`, fetched in `fetchMacroBackdrop` →
  `macroBackdrop.vixTerm`; `ratio` = 30-day ÷ 3-month, `state` = **backwardation**
  when ratio ≥ 1). An **inverted** curve (near-term fear richer than longer-dated
  = acute stress) **confirms risk-off at a lower absolute VIX** (≥ 16, vs the ≥ 18
  rising / ≥ 20 level paths) and **blocks risk-on** while inverted. Degrades to the
  VIX-level-only regime if the 9-day / 3-month legs fail to fetch (`buildVixTerm`
  returns null without the 3-month leg).
- A tape **against** the trade is a strong con (single names rarely fight the index);
  a tape **with** it is a soft pro.
- **Knife-threshold tightening (against the tape).** A long bought *into* a confirmed
  risk-off tape (or a short into risk-on) is exactly the contrarian-inflated grade the
  score can't catch (§3). So when the tape fights the trade, the falling-knife
  thresholds tighten ~25% (`RET1D` −6→−4.5, `RET3D` −8→−6, `DD_ATR` ×0.8) — a
  borderline name is **dropped** rather than merely deferred. The score is never
  touched; the gate just gets stricter when the tape disagrees.
- **Risk-off put path:** because graded puts are rare (§4), in a *confirmed*
  risk-off tape the candidate set is widened to **tactical puts** — names that
  don't clear the live trade cutoff but are still bearish-leaning. The sub-bar
  window is RELATIVE to the live cutoff: `total ∈ (−tradeCut, max(bar, −0.8·tradeCut)]`
  (bar = `PICKS_RISKOFF_PUT_BAR` −8 plain / `PICKS_MACRO_SEVERE_PUT_BAR` −5 severe) —
  the `Math.max` clamp keeps the window non-empty under the compressed
  cross-sectional scale (a fixed −8 vs a tradeCut of ~6 was an EMPTY window, the
  audit's dead-branch finding) while leaving the legacy ±12 path byte-identical.
  A tactical put must additionally pass the gate with a **`go`** (a real,
  well-timed breakdown) before it ships, and is labelled **"Tactical Put" / reduced size**.
  Its `total` stays its true (negative) grade score, so it ranks below every graded
  pick and only fills slots the vetoed calls leave behind.

### 6.4 Fail-open
Missing spot / technicals / fewer than 15 confirmed bars → **`wait`** with score 0
(P2.2). The name still **ships** (badged) so it's never silently dropped, and a
fail-open read no longer mints an endorsed `go` on the names with the *least* data
and the *most* knife risk. (Under full-roster enrollment, §8, such a name — if it
clears the grade bar — still enrolls in the track record as a `cohort:'wait'` entry,
separable from `go` in the `byCohort` A/B.) The contribution stays 0, so the grade
isn't dinged either — pure graceful degradation, just not endorsed.

### 6.5 Worked examples (from the loss data)
- **CRM** calls bought $205–210 (+18% in 3 days, +16% above the 20D SMA) → chase B →
  `avoid`.
- **PANW** +21% / 3d, +28% above 20D, RSI 84 → chase A → `avoid`.
- **MDB / CLS** +24–27% / 5d, +25–30% above 20D → chase B → `avoid`.
- **OKTA** at $139–140 (+52% / 5d, RSI 88) → chase → `avoid`. *Also* drops the lone
  winner (OKTA at $123 was the same +52% rip mid-flight) — an accepted cost: the
  gate trades away the occasional momentum-continuation winner to avoid the far
  larger chase-loss cohort. Net strongly positive on the sample.
- Backtested at each pick's actual entry date, the gate **drops 16 of 19** resolved
  picks and, with §8's go-only tracking, would have enrolled ~2 of the 18 losses
  instead of all 18.

### 6.6 Macro event-risk defer (prediction-market-driven)
`computeMacroEventRisk` reads the Kalshi/Polymarket FOMC + macro-release odds (the
same overlay the Calendar tab shows) and flags an **imminent, market-uncertain**
event: an FOMC decision or a CPI / jobs print within `PICKS_TIMING_EVENT_DEFER_DAYS`
(**3**) sessions whose **top outcome is priced below `PICKS_EVENT_RISK_MAX_PROB`
(70%)** — a coin-flip the crowd can't call. When it fires, `computeEntryTiming` adds
a **soft con** and forces the verdict to **`wait`** (a hard defer, mirroring the
earnings defer in §6.2): you don't buy a debit option straight into a two-sided macro
print. A *confident* event (e.g. a 98%-hold FOMC) does **not** fire, so the roster
only stands down ahead of genuinely uncertain prints. Computed once per build from
the prediction-market overlay and threaded via `macroBackdrop.eventRisk`; gated by
`PICKS_EVENT_RISK` (default ON). Because it rides the timing contribution it is part
of `total`, so a build where it fires shifts grades + the roster, then clears once
the event passes. (Uses whichever platforms returned odds — currently Polymarket;
see the Kalshi caveat in §9.)

### 6.7 IV cost as a 6th score component (`computeIvCostContribution`, `PICKS_IV_SCORE`)
The engine grades like a stock-picker (the 4 pillars are asset quality) but **trades
short-dated long premium**, where **IV richness is first-order**: you can be right on
direction and still lose to a vol crush. The own-history IV rank was already read in
§6.2, but only as a *soft con/pro inside the bounded −8..+4 timing budget* — so it
rarely re-ranked: two names with the same direction/quality but very different own-IV
ranks scored ~the same and sat next to each other. The IV-rank **veto** (≥90th pctile)
gated `go`, but nothing let a cheap-vol name **outrank** a rich-vol one of equal grade.

`computeIvCostContribution(data)` fixes that by folding a **dedicated, continuous,
direction-AGNOSTIC conviction cost** into `total`, in parallel with timing (the 6th
component, a non-`PILLAR_KEYS` sibling of `timing`, folded through the same `dirSign`
clamp). It reads the name's **own** IV rank (real own-history percentile, the same
source as §6.2; no IV history → 0, no RV proxy since realized vol isn't the premium you
pay) and centers at the name's **own median IV (rank 50)**:

| own-IV rank | contribution | meaning |
|---|---|---|
| 100 (richest of its own history) | −`PICKS_IV_SCORE_MAX` (**−1.5**, halved from 3 — §3.7) | paying up — penalize conviction |
| 50 (its median) | 0 | neutral |
| 0 (cheapest of its own history) | +`PICKS_IV_SCORE_CHEAP_MAX` (**+1.5**) | cheap premium — small credit |

Linear between, **asymmetric** (richness costs more than cheapness rewards — one cheap
entry doesn't fix a bad trade, the same long-bias defense as the +2/−3 catalyst split).
The richness penalty additionally **scales with the regime** (§3.5.1, gated by
`PICKS_HW_REGIME`): ×1.4 in risk-off, ×1.7 in a severe/imploding tape (`PICKS_IV_SCORE_RISKOFF_MULT`
/ `_SEVERE_MULT`) — paying up for premium into a vol spike is the worst time to do it.
Cheap-side credit and the neutral/risk-on tape are unchanged (×1).
Direction-agnostic: a long call or put is long premium either way, so the cost
**weakens or strengthens conviction for whichever side, never flips it** (for a put,
`total < 0`, a rich-IV penalty pushes `total` *toward zero* = less bearish conviction).
So of two otherwise-equal setups the one whose vol is cheap relative to its own history
ranks ahead — you're not paying up into a crush.

**No double-counting.** When `PICKS_IV_SCORE` is on it **owns** the rich/cheap
magnitude: the legacy §6.2 in-timing soft con/pro is suppressed, and the ≥90th-pctile
veto stays as a **pure go-block** (it demotes `go → wait` without also subtracting the
timing −2 that the dedicated term now carries). Set `PICKS_IV_SCORE=0` to revert to the
legacy in-timing nudge. Like `timing`, `ivCost` rides into `total` and renders as its
own breakdown row, but is **excluded from the per-pillar grade-change / roster delta
accounting** (`GRADE_PILLAR_KEYS`), so the "why it moved" strings are unchanged. The
structural complement is §5's auto-vertical (finance the long as a debit spread when IV
is rich) — that's still dark; this term is the always-on **ranking** expression of the
same "don't overpay for vol" principle. Expect a one-time grade/roster shift on the
first bake.

---

## 7. Ranking & roster construction

- **Order:** by **net-of-cost conviction** — `|total|` minus the P5.1
  execution-cost debit — ties broken by entry-timing score.
- **Execution-cost debit (P5.1, `executionCostDebit`).** The chosen contract's
  round-trip spread (`spreadPct`, (ask−bid)/mid) is a known, deterministic tax
  charged on every trade whether or not the signal is right — the modeled track
  record charges it on top of option P&L — but ranking ignored it: a pick whose
  best contract cost an 8% round-trip out-ranked an equal-signal name with a 2%
  spread. The debit converts fill cost into grade points: 0 at/below
  `PICKS_COST_FREE_SPREAD` (3%), ramping linearly to `PICKS_COST_DEBIT_MAX`
  (1.25) at the clean cap (`PICKS_CLEAN_MAX_SPREAD_PCT`, 10%). It adjusts roster
  **order** and the roster **bar** only — never the published grade
  (`grades.json` is contract-free by design). A marginal, non-tactical pick whose
  `|total| − debit` falls below `tradeCut` is dropped (no backfill) →
  `rosterMeta.costGated`; the per-pick `costDebit`/`netConviction` ship on
  `picks.json` and surface as a "−0.7 spread" chip on the ranked card.
  `PICKS_COST_DEBIT=0` disables.
- **Sector-concentration cap** (`PICKS_MAX_PER_SECTOR = 3`, tightened from 4 in
  P2.1). The equal-weight score systematically over-loads correlated names (the
  failing record was 18/19 losses in Technology), so no more than 3 picks (30% of
  the roster) may come from one GICS sector; ETFs (null sector) are uncapped. Skips
  are recorded in `rosterMeta.sectorCapped`.
- **Factor / correlation cap** (`PICKS_MAX_PER_FACTOR = 5`, P2.1). The real blowup
  cluster — semis + software + the mega-cap-tech / data-center-power complex — is
  **one beta that spans several GICS sectors** (Technology, Comm Services, even some
  Utilities/Industrials), so the per-sector cap alone can't stop it filling the
  roster through two labels. `FACTOR_OF_SECTOR`/`factorOfTicker` collapse the curated
  `SECTORS` of that complex into one factor and cap it on top of the sector cap;
  unmapped names (banks, pharma, energy, …) rely on the sector cap. Skips →
  `rosterMeta.factorCapped`.
- **Direction-concentration cap** (`PICKS_MAX_PER_SIDE = 8`). The sector/factor caps
  bound correlated longs, but nothing bounded a **one-way book**: a marginal 2-axis
  risk-off could ship the roster 10/10 puts (100% short delta) on one borderline
  regime read. Either side is now capped at 8 of the `PICKS_COUNT` slots — the
  remaining slots go to the other side or stay cash (no backfill). The severe-tape
  call cap (`PICKS_MACRO_SEVERE_CALL_CAP = 3`) still applies on top (stricter for
  calls in a severe tape). Skips → `rosterMeta.sideCapped`; counts →
  `rosterMeta.sideCounts`. `0` disables.
- **No knife backfill.** When the gate drops a candidate, nothing pads its slot
  with a worse-timed name. The roster may ship **fewer than 10** picks — a short
  list is the honest signal that there's little clean to buy today. `rosterMeta`
  (`{vetoed, sectorCapped, sectorCounts, factorCapped, factorCounts}`) rides on
  `picks.json` so the UI shows an honest "only N clean setups · M gated ·
  K sector-capped · L factor-capped" note.
- `go` picks are the endorsed entries; `wait` picks are shown (badged) with their
  entry levels so the user can act on confirmation.

---

## 8. Accuracy tracking (`updatePicksAccuracyFile`) — the feedback substrate

The track record is the report card AND the substrate for ever closing the loop, so
it has to be trustworthy. The fixes:

- **Per-thesis enrollment dedup.** Enrollment keyed on the contract
  (`symbol:side:strike:expiry`) let the *same* thesis re-enroll 2–6× as
  `pickContractForPick` re-picked a slightly different strike/expiry each build (the
  open list had ballooned to 79 across 34 theses — TSM×6, AMAT×6 — silently
  re-weighting every cohort toward whichever names churned contracts most). Now a
  `symbol:side` that already has an **open** entry is skipped; the contract-level key
  still governs the **closed** set, so genuinely distinct realized trades stay
  distinct.
- **Full-roster enrollment — every pick, the moment it lists.** Every shipped pick
  is enrolled the second it appears on the Top Picks list: the whole roster, calls
  **and** puts, `go` **and** `wait`, not just the top-5 endorsed `go` subset the old
  gate tracked. The track record grades the *contract the user actually saw*, so it
  has to cover the whole list. The per-thesis dedup above is the only enrollment
  gate now (one open entry per `symbol:side`, so a churning strike can't re-enroll a
  live thesis); the retired `PICKS_ACCURACY_ENROLL_TOP_N` cap no longer bounds it.
  Headline win-rate/expectancy therefore reflect **every** name the engine put on
  the list, endorsed or deferred — the go-vs-wait split stays visible as the
  `byCohort` A/B so the timing gate's marginal edge is still measurable.
- **Live contract mark-to-market (open picks).** An open pick is repriced on its
  **option** every build (`modelOptionExit`, the SAME Black-Scholes repricer used at
  resolution — enter at ask, exit at bid, entry IV decayed toward HV, earnings
  crush), and the live `optionPnlPct` + running peak/dip persist on the entry. So the
  Track-record open rows and the Top Picks cards now **lead with the modeled contract
  P&L since the pick first appeared** (the underlying move demoted to context), and
  the Scorecard carries a live "open book · contract" aggregate across the current
  positions. The open mark flows continuously into the closed record (resolution just
  stamps its own exit mark over it). A day-0 debut shows ≈ the round-trip spread cost —
  honest: a single-leg long is down the bid/ask the instant you'd flip it.
- **Resolution** (`resolvePickOutcome`): TP (win), cut (loss), expiry (vs breakeven),
  the **theta-stop** (P1.4 — cut when modeled daily theta > `PICKS_THETA_STOP_PCT`
  = 2.5%/day of remaining premium, gated to held ≥ 5d and modeled at a loss), or the
  14-day time-stop.
- **Honest cohorts.** Win-rate is reported overall and broken down by `byTier`,
  **`bySector`** (the old `byTier` was degenerate — all picks were "strong-call" —
  while losses were 18/19 Technology, hidden by the global rate), and **`byRegime`**
  (risk-on/off/neutral at entry, stamped via `entryRegime`).
- **Expectancy + SPY benchmark.** Beyond win-rate: `expectancyPct` (mean side-adjusted
  realized *underlying* move — does the average pick make money?) and
  `excessExpectancyPct` (vs SPY over each pick's actual hold). These are the honest
  "is the engine adding value vs buy-and-hold?" headline.
- **Modeled option expectancy + win rate (P0.1/P0.2).** We still have no options-price
  feed, so the tracker reprices the *same* contract with Black-Scholes (`modelOptionExit`:
  remaining DTE, the real spot, entry IV decayed toward realized HV over the hold, an
  earnings-crush haircut if a print fell inside the hold) — **both live on every open
  pick each build** (the unrealized mark the open rows / cards lead with) **and** at
  exit → per-pick `optionPnlPct` and a cohort `optionExpectancyPct` + `optionWinRate`
  (the **headline** the Track-record tab now leads with — the engine trades options, so
  it's graded on the option, with the underlying win rate demoted to context). **Honest
  fills (P0.1):** the repricer **enters at the ASK and exits at the BID** (haircutting
  the BS fair value by the stamped `spreadPct`), charging the 12–18% bid/ask the
  contract selector admits instead of a free mid-to-mid round trip. The **gap between
  `optionExpectancyPct` and the underlying `expectancyPct` is the theta / IV-crush /
  spread tax** — a stock that drifts ~flat can still print a deeply negative option
  result, which the underlying metric is structurally blind to. Needs the entry-option
  snapshot stamped at enroll (`contract.iv`/`bid`/`ask`/`spreadPct`, `entryHv`,
  `earningsDate`), so it populates as gate-era picks resolve. *Offline check:*
  `scripts/diagnose-pick-losses.mjs` models the existing resolved set and attributes
  each loss (direction vs theta/vol) — on the current record, 100% direction-driven,
  modeled option expectancy −39.1% vs the −7.6% stock-move headline.
- **Per-signal attribution** (`bySignal`, measure-only). Each enrolled pick stores a
  flat `entrySignals` snapshot; the stats then ask, per signal, "when it pointed the
  pick's way, did the pick win?" Raw counts always; a `rate` only past
  `PICKS_SIGNAL_MIN_N = 25` decided (guards against reading signal into noise). This
  is the substrate for *eventually* validating the equal-weight score — it does
  **not** feed weights today.
- **Gate A/B (research, now always-on).** Full-roster enrollment means the `wait`
  arm populates organically (no `PICKS_ACCURACY_AB` flag required), so the go-vs-wait
  comparison is always live — but, unlike before, `wait` picks are now **included** in
  the headline (every name the engine showed is graded), with the split surfaced as
  the `byCohort` A/B rather than hidden from the headline. Each wait entry is stamped
  `waitKind` (`earnings` / `event` — a scheduled-catalyst defer — vs `structure` — no
  clean setup; from `computeEntryTiming`'s `deferKind`), and `byCohort.wait.byKind`
  sub-splits the arm so "stood down for CPI" is separable from "the chart wasn't there".
- **Universe-wide IC substrate (`data/grades-daily.json` + `scripts/diagnose-grade-ic.mjs`).**
  The enrolled roster accrues ~5 picks/build at best, so per-signal/per-grade IC from
  the track record alone takes quarters to stabilize. Every build now upserts one row
  per ET day with EVERY tracked name's grade `total` (~138 names; the day's last —
  post-close — build wins; ~400-day retention via `GRADES_DAILY_MAX_DAYS`; same
  read-before-wipe rule as the other accumulating files). The read-only diagnostic
  joins those snapshots with the committed `priceSeries` closes and reports the
  grade's cross-sectional **Spearman IC** + **top-vs-bottom-decile forward-return
  spread** at 5/10/14-trading-day horizons — thousands of observations per quarter,
  the fast answer to "can the score call 2-week direction?" that gates everything
  else. Measure-only; it feeds no weights (same discipline as `bySignal`).
- **Clean slate.** When full-roster + live-contract grading shipped, the entire
  track record was **wiped** (`picks-accuracy.json`, `grades-history.json`,
  `picks-changes.json`, `picks-roster.json`) so the contract-graded record starts
  fresh — the prior open book was the retired go-only-top-5, stock-move-led tracker
  and would have polluted the new headline. The record rebuilds from the first bake
  after the wipe, enrolling the current roster on its contracts.

---

## 9. Tuning & caveats

- Every threshold is a named constant in `scripts/build.mjs`:
  - **Cross-sectional (P3.x, §3/§4):** `PICKS_XSECTIONAL` (master flag, default ON),
    `PICKS_SECTOR_NEUTRAL` (default ON), `PICKS_Z_CLIP 3.0`, `PICKS_Z_MIN_UNIVERSE 20`,
    `PICKS_SECTOR_MIN_N 8`, `PICKS_TIER_PCTL_STRONG 0.05`, `PICKS_TIER_PCTL_TRADE 0.12`;
    per-signal `W_s = oldMax/PICKS_Z_CLIP` (`CONVERTED_SIGNALS` registry).
  - **Horizon-aware pillar weights (§3.5):** `PICKS_HORIZON_WEIGHTS` (master flag,
    default ON), `PICKS_HW_FUND 0.6`, `PICKS_HW_TECH 1.0`, `PICKS_HW_MECH 1.15`,
    `PICKS_HW_NARR 0.9` (`horizonWeight`/`applyHorizonWeight`; `timing`/`ivCost` ride
    at ×1). Set the master flag `=0` to revert to the legacy equal-weight pillar sum.
  - **Regime-aware overlay (§3.5.1):** `PICKS_HW_REGIME` (master flag, default ON),
    slow-pillar (Fund+Narr) multipliers `PICKS_HW_SLOW_RISKOFF 0.67` / `PICKS_HW_SLOW_SEVERE 0.5`
    / `PICKS_HW_SLOW_RISKON 1.2`; macro-tilt exemption `HORIZON_WEIGHT_EXEMPT` (rides ×1);
    IV-cost richness regime scale `PICKS_IV_SCORE_RISKOFF_MULT 1.4` / `PICKS_IV_SCORE_SEVERE_MULT 1.7`
    (`picksRegimeBand`). Dormant (byte-identical) in the neutral regime; `=0` reverts.
  - **Sizing (P3.4, §4.1):** `PICKS_SIZE_RISK_DENOM 'option'`, `PICKS_SIZE_VOL_FLOOR 0.05`,
    `PICKS_SIZE_TILT_MIN/MAX 0.6/1.4`, `PICKS_GROSS_TARGET 0.80`, `PICKS_DISPLAY_ACCOUNT 25000`,
    `PICKS_SIZE_FULL_ROSTER_N 5` (P0.4 thin-roster gross ramp).
  - **Absolute floor (P0.4, §4):** `PICKS_ABS_STRONG_FLOOR` / `PICKS_ABS_TRADE_FLOOR`
    (default 9 / 6 on the compressed standardizer scale; env-set to 0 to disable) — the
    absolute bar the percentile cutoffs are `Math.max`'d against so the roster can honestly ship 0.
  - **Tiers (legacy floor fallback):** `PICKS_MIN_CONVICTION 12`, `PICKS_TIER_STRONG 16`,
    `PICKS_COUNT 10`, `PICKS_MAX_PER_SECTOR 3`, `PICKS_MAX_PER_FACTOR 5` (`FACTOR_OF_SECTOR`),
    `PICKS_MAX_PER_SIDE 8` (direction-concentration cap, §7; 0 disables).
  - **Tier hysteresis (§4):** `PICKS_TIER_HYSTERESIS` (default ON), `PICKS_TIER_EXIT_FRAC 0.9`
    (incumbent exit bar = tradeCut × frac; `=0`/frac 1 → no hysteresis).
  - **Universe-IC substrate (§8):** `GRADES_DAILY_MAX_DAYS 400` (`data/grades-daily.json`
    retention; read by `scripts/diagnose-grade-ic.mjs`).
  - **Contract (`pickContractForPick`):** `PICKS_DELTA_MIN/IDEAL/MAX 0.45/0.55/0.65`,
    `PICKS_OTM_MIN/MAX_PCT −0.20/0.12`, `PICKS_MAX_PREMIUM 35` +
    `PICKS_MAX_PREMIUM_PCT_OF_SPOT 0.12` (cap = max of the two); spread gate
    `PICKS_CLEAN_MAX_SPREAD_PCT 0.10` (roster) / `PICKS_MAX_SPREAD_PCT 0.18` (loose),
    composite spread penalty saturates at `PICKS_SPREAD_PEN_REF 0.10` (weight 0.24).
  - **Exits / accuracy:** `PICKS_ACCURACY_MAX_HOLD_DAYS 14`, `PICKS_THETA_STOP_PCT
    0.025` + `PICKS_THETA_STOP_MIN_HOLD_DAYS 5` (theta-stop); modeled-option repricer
    `PICKS_OPTION_IV_DECAY_DAYS 30`, `PICKS_OPTION_EARNINGS_CRUSH 0.70`.
  - **Premium-space exits (P0.3):** `PICKS_OPT_EXITS` (default ON), `PICKS_OPT_TP_PCT 0.6`,
    `PICKS_OPT_STOP_PCT 0.4` — resolve on modeled option P&L before the underlying TP/cut.
    Trailing take-profit: `PICKS_OPT_TRAIL` (default ON), `PICKS_OPT_TRAIL_GIVEBACK 0.33`
    (arm at +60%, lock ≥+60%, trail a runner up, exit on a 33%-of-peak give-back; `=0` →
    legacy flat TP). Tracked via the per-pick `optMfePct` peak.
  - **Earnings-eve exit (P2):** `PICKS_EARNINGS_EXIT` (default ON), `PICKS_EARNINGS_EXIT_DAYS 2`.
  - **Edge governor (P1.3):** `PICKS_EDGE_GOVERNOR` (default ON), `PICKS_EDGE_MIN_N 15`,
    `PICKS_EDGE_SCALE_DEFAULT 0.6`, `PICKS_EDGE_SCALE_MIN 0.25`, `PICKS_EDGE_FULL_CUT_EXP −40`.
  - **Premium-at-risk sizing (P1.5):** `PICKS_SIZE_PREMIUM_RISK` (default ON),
    `PICKS_SIZE_HOLD_DAYS 10`, `PICKS_SIZE_IV_DROP_CAP 0.10`.
  - **IV rank (P1.6):** `PICKS_IVRANK_SIGNAL` (default ON), `PICKS_IVRANK_MIN_N 10`,
    `PICKS_IVRANK_RICH 80`, `PICKS_IVRANK_CHEAP 20` (legacy in-timing con/pro — suppressed
    when the dedicated IV-cost term is on), and `PICKS_IVRANK_VETO 90` (default ON; extreme
    IV → blocks `go`; set 0 to disable the gate).
  - **IV cost in `total` (§6.7):** `PICKS_IV_SCORE` (default **ON**; the dedicated
    direction-agnostic IV-cost component folded into `total`), `PICKS_IV_SCORE_MAX 1.5`
    (max penalty at the richest own-IV), `PICKS_IV_SCORE_CHEAP_MAX 1.5` (max credit at the
    cheapest), regime richness scale `PICKS_IV_SCORE_RISKOFF_MULT 1.4` / `PICKS_IV_SCORE_SEVERE_MULT 1.7`
    (§3.5.1). Reuses `PICKS_IVRANK_MIN_N` for the history floor. Set `PICKS_IV_SCORE=0` to
    revert to the legacy in-timing IV-rank nudge.
  - **Term structure (P2):** `PICKS_TIMING_BACKWARDATION 0.05` (computeEntryTiming soft con).
  - **Scanner-data signals (Mechanicals §3):** `PICKS_OI_TRACKER_SIGNALS` (default ON) —
    `oiDeltaNet` (net call−put ΔOI / total OI over the OI tracker's front-two-expiration
    top strikes; continuous → z pool, legacy ±1 at `PICKS_OI_DELTA_NET_BAR 0.015` ≈ p85)
    + `gammaSqueeze` (the tracker's 0-5 rule score: ≥4 → +2, 3 → +1; call-side-only by
    construction, fixed signal, deliberately NOT clustered); `PICKS_FLOW_PERSIST`
    (default ON) — `flowPersist` (rolling 7-day `unusual-log.json`: premium-weighted
    side balance × ln(1+days), where entries are first **deduped to one row per
    contract-day at the day's max premium** — the log appends per hourly scan with
    cumulative session notional, so raw sums would pass the noise floor by repetition —
    and **days counts the DOMINANT side's distinct sessions** only; ≥60% balance over
    2+/4+ days → ±1/±2; raw rides the z pool; `PICKS_FLOW_PERSIST_MIN_PREMIUM 250000`
    noise floor, `PICKS_FLOW_LOG_WINDOW_DAYS 7`). All three read scanner-owned files staleness-gated
    (`PICKS_OI_TRACKER_MAX_AGE_DAYS 4`) and degrade to "no data". `oiDeltaNet`/`flowPersist`
    join the **flow** decorrelation cluster (one positioning beta read four ways —
    today's prints, OI level, overnight build, multi-day persistence; the 1/√K collapse
    is what lets the engine carry all four).
  - **Scanner-data timing reads (§6):** `PICKS_TIMING_WALL` (default ON) — spot within
    `PICKS_TIMING_WALL_PCT 2.0`% under the call wall / above the put wall → side-aware
    soft ±1 (dealer supply overhead / support underfoot; only when the wall is on its
    expected side of spot — a broken wall is the gammaSqueeze signal's regime);
    `PICKS_TIMING_OVERNIGHT` (default ON) — the overnight sweep's peer-implied move
    (|corr|-weighted Σ β·peer-move from `data/correlations.json`, server-side sibling of
    the Grade tab's live overnight widget) → soft ±1 when |implied| ≥
    `PICKS_TIMING_OVERNIGHT_MIN_PCT 0.5`% (top-peer |corr| floor
    `PICKS_TIMING_OVERNIGHT_MIN_CORR 0.15`, staleness gate `PICKS_OVERNIGHT_MAX_AGE_HOURS 36`).
  - **Equity-internals sentiment axis (regime, §6.3):** `PICKS_MACRO_SENTIMENT`
    (default ON) — CNN Fear & Greed (`data/fear-greed.json`; the live fetch in a full
    build) votes as a 7th macro axis: composite ≤ `PICKS_MACRO_FG_FEAR 25` → −1,
    ≥ `PICKS_MACRO_FG_GREED 75` → +1; mid-range, a fast 1-day swing |Δ| ≥
    `PICKS_MACRO_FG_DELTA 10` votes the swing's direction (sentiment turns in hours —
    the extremes-only read missed the turn until it was priced). Capped ±1 (its
    volatility component overlaps the VIX axis, so it confirms but can never drive
    severe alone). Reads equity INTERNALS (breadth/strength/momentum) no other axis covers.
  - **Redundant-signal prune (audit, §3):** `PICKS_PRUNE_REDUNDANT` (default ON) —
    `volConf` dropped from Technicals (double-read the same 20D rvol `unusualVolume`
    scores SIGNED, and unsigned volume credits a crash day like a rally);
    `socialSentiment` informational-only (score 0, raw out of the z pool — it fired
    31 bullish / 0 bearish across the live universe, a structural long bias). `=0`
    restores both as scored signals. `PICKS_DECORRELATE` is now default **ON**
    (1/√K cluster collapse; flip with `=0`).
  - **Debit verticals (P1.2, DARK):** `PICKS_VERTICALS` (default **OFF**), `PICKS_VERT_IVRANK 70`,
    `PICKS_VERT_SHORT_DELTA_MIN/MAX 0.20/0.38`, `PICKS_VERT_MIN_CREDIT 0.20`; auto-engage
    `PICKS_VERT_AUTO` (default **OFF**) + `PICKS_VERT_NEGEDGE_IVRANK 50` (rich-IV / negative-edge
    default structure — wired + sizing-correct, dark pending the 2-leg card render).
  - **Decorrelation (audit #1, DARK):** `PICKS_DECORRELATE` (default **OFF**) — collapse
    correlated converted-signal clusters (`SIGNAL_CLUSTER`) by 1/√K so a beta isn't N-weighted.
  - **IC bridge (research, measure-only):** `gradeIc`/`gradeIcN`/`gradeIcOption` + per-signal
    `bySignal[].ic` in `picks-accuracy.json` (Pearson; the substrate to refit `W_s` from realized IC, §9.6).
  - **Timing gate (`PICKS_TIMING_*`):** knife `RET1D −6`, `RET3D −8`, `DD_ATR −2.5`;
    chase `RSI 70`, `DIST_SMA20 8`, `DIST_SMA20_SOFT 7`, `52W 0.92`, `RET5D 10`,
    `RET3D 10`; **avoid-penalty scaling** `AVOID_SCALE` (default ON) + `AVOID_FLOOR −16`
    (knife/chase penalty = `max(AVOID_FLOOR, −8·severity)`, severity = max overshoot
    ratio vs the trigger; `AVOID_SCALE=0` → flat −8); volume `VOL_CONFIRM 1.3`,
    `VOL_LIGHT 0.8`, `VOL_HEAVY 1.5`, `NEAR_LEVEL_PCT 1.5`; **ex-div nudge**
    `EXDIV_DEFER_DAYS 2` + `EXDIV_MIN_YIELD 1.0` (side-aware soft ±1, payers only);
    **holiday/weekend theta** `DEADDAYS_WINDOW 5` + `DEADDAYS_CON 3` (side-agnostic
    soft −1, NYSE holiday calendar 2025–2027); regime `RISKOFF_VIX 20`,
    `RISKOFF_SPY −1.0`, `RISKON_SPY 0.6`;
    `EARNINGS_DEFER_DAYS 8`; `MIN_BARS 15` (fail-open → `wait`); risk-off put bar
    `PICKS_RISKOFF_PUT_BAR −8`. **Macro event-risk defer (§6.6):** `PICKS_EVENT_RISK`
    (default ON), `PICKS_TIMING_EVENT_DEFER_DAYS 3`, `PICKS_EVENT_RISK_MAX_PROB 0.70`.
  - **Cross-asset macro regime (§6.3):** `PICKS_MACRO_REGIME` (master flag, default ON),
    axes `PICKS_MACRO_DXY_1D 0.6` / `_1D_STRONG 0.9` / `_5D 1.0`, `PICKS_MACRO_YIELD_BPS_1D 10`
    / `_1D_STRONG 16`, `PICKS_MACRO_FED_DRIFT_PT 5` / `_LOOKBACK 5` / `_MEETINGS 3`; commodity
    axis `PICKS_MACRO_COMMODITY` (default ON), `PICKS_MACRO_OIL_1D 4` / `_OIL_1D_STRONG 8` /
    `_OIL_5D 12`, `PICKS_MACRO_GOLD_1D 3` / `_GOLD_5D 6` (reads `macroBackdrop.crude`/`.gold`,
    the `CL=F`/`GC=F` legs); geopolitical-news axis `PICKS_MACRO_NEWS` (default ON),
    `PICKS_MACRO_GEO_MIN_STR 45` / `_GEO_STRONG_STR 65` (`computeGeoNewsStress`, `GEO_CONFLICT_RE`/`GEO_THEME_RE`), headline tone `PICKS_MACRO_HEADLINE_AGE_H 36` (`computeHeadlineGeoTone`, `GEO_DEESCALATION_RE`/`GEO_ESCALATION_RE`);
    inflation/labor axis `PICKS_MACRO_INFLATION` (default ON) — monthly CPI YoY + unemployment
    (BLS `CUUR0000SA0`/`LNS14000000`, FRED `CPIAUCNS`/`UNRATE` fallback, attached to
    `macroBackdrop.inflation`/`.unemployment` by `fetchInflationLabor`): −1 when CPI YoY ≥
    `PICKS_MACRO_CPI_HOT 4.0` or re-accelerating (≥ `_CPI_WARM 3.0` and up ≥ `_CPI_REACCEL 0.3`pp
    vs 3 months ago), −1 when the Sahm read (3-month-avg unemployment vs its 12-month low) ≥
    `PICKS_MACRO_UE_SAHM 0.5`pp (both → −2, the stagflation tape), +1 only when CPI ≤
    `_CPI_COOL 2.5` and not rising — slow monthly prints, so a confirming vote like sentiment; states
    `PICKS_MACRO_RISKOFF_AXES 2`, `PICKS_MACRO_SEVERE_AXES 3` + `PICKS_MACRO_SEVERE_STRESS −4`,
    `PICKS_MACRO_RISKON_AXES 2` + `PICKS_MACRO_RISKON_STRESS 2` + `PICKS_MACRO_RISKON_MAX_OFF 1`,
    sentiment fast-swing `PICKS_MACRO_FG_DELTA 10`; book tilt `PICKS_MACRO_TILT` (default ON), `_TILT_BASE 4` /
    `_TILT_SEVERE 8` / `_TILT_RISKON 2`, beta clamp `_TILT_BETA_FLOOR 0.5` / `_TILT_BETA_CAP 1.6`,
    continuous ramp `PICKS_MACRO_TILT_RAMP` (default ON) + `PICKS_MACRO_TILT_FULL_STRESS 4`
    (|tilt| = BASE × |stress|/4, capped at SEVERE; `=0` → legacy step);
    regime persistence `PICKS_REGIME_PERSIST` (default ON; asymmetric — defensive moves
    and neutral→risk-on immediate, de-hedging out of risk-off/severe needs 2 consecutive
    builds; `applyMacroRegimePersistence`, prior
    state from `rosterMeta.macroRegime.{state,rawState}`);
    de-gross `PICKS_MACRO_GROSS_RISKOFF 0.6` / `_GROSS_SEVERE 0.4`; severe guards
    `PICKS_MACRO_SEVERE_CALL_CAP 3`, `PICKS_MACRO_SEVERE_PUT_BAR −5`. (`computeMacroRegime` /
    `computeMacroTilt` / `fedHawkishDrift` / `macroBetaWeight`.)
  - **Tape de-duplication (§3 Mechanicals/Narrative):** `PICKS_TAPE_DEDUPE` (default ON) —
    **drops all six** market-wide per-name pillar signals from the breakdown entirely (not
    pushed into the pillar): **SPY flows, VIX Tracking, VIX Spot** (Mechanicals) and **DXY,
    10Y, Macro Tail/Headwinds** (Narrative). Market-wide factors (the tape, vol, the dollar,
    yields, macro narratives) belong to the regime gauge (§6.3), which expresses them per-name
    via the beta-weighted Macro Regime tilt; a fixed (non-z-scored) copy in the per-name grade
    is a uniform offset that double-counts the tape and re-ranks nothing. So the grade is
    purely the ticker's own merits. **Score-neutral** — those rows already contributed 0, so
    this removes the rows without changing any grade. The **beta-weighted Macro Regime tilt**
    stays (it's not a uniform read). `=0` restores the legacy per-name market-wide signals.
  - **VIX index term structure (regime, §6.3):** `^VIX9D` / `^VIX3M` fetched alongside
    `^VIX` in `fetchMacroBackdrop` → `macroBackdrop.vixTerm` (`ratio` = `^VIX`/`^VIX3M`,
    `state` backwardation/contango); backwardation (ratio ≥ 1) confirms risk-off at
    VIX ≥ 16 in `detectMarketRegime`. No env knob — degrades to VIX-level-only if the
    9-day / 3-month legs fail. *(Distinct from the per-ticker IV `PICKS_TIMING_BACKWARDATION`
    above — that's a single name's own option curve; this is the market-wide VIX curve.)*
  - **Prediction-market overlay (Calendar + event-risk source):** `KALSHI_API_BASE`,
    `POLYMARKET_GAMMA_BASE`, `POLYMARKET_TAGS`, `PM_FOMC_MEETINGS 3`,
    `PM_KALSHI_MIN_VOL`/`PM_POLY_MIN_VOL` (liquidity floors → `thin`), `PREDICTION_MARKETS=0`
    to disable. **Caveat: Kalshi is not resolving in production** (the public host/ticker
    guess returns nothing — Polymarket alone is feeding the odds + event-risk); see §9 note.
  - **Analyst rating changes:** `ANALYST_REVISION_WINDOW_DAYS 90` (Fundamentals §3).
  - **Accuracy:** `PICKS_ACCURACY_ENROLL_TOP_N 5` (**retired** as the enroll gate —
    full-roster enrollment now tracks every shipped pick; the per-thesis dedup bounds
    the open list), `PICKS_SIGNAL_MIN_N 25`, `PICKS_SIGNAL_PRUNE_BAND 0.05` (prunable
    flag). `PICKS_ACCURACY_AB` is now moot (the `wait` arm always enrolls).
- Numbers are tuned to a **19-pick sample** and should be revisited once
  `picks-accuracy.json` carries gate-era outcomes. **`bySignal` is the path to that
  recalibration — it does not feed weights until the sample is large.**
- **No look-ahead:** confirmed bars only — the gate reads as of the last *closed*
  session, so it can lag the current session by ~1 trading day (an accepted
  trade-off, same as the chart-pattern cache).
- Graceful degradation throughout — a missing input never throws and never silently
  drops a pick (fail-open → `wait`, shown but not enrolled; P2.2).
- **Gate is research / unproven.** Its thresholds were fit to that ~19-pick
  in-sample set, and its *marginal* edge over the volatility-aware stop alone is not
  validated until forward, gate-era picks accumulate (the 2×2 ablation — ATR-floor /
  no-gate vs ATR-floor / gate-on — needs the modeled option P&L of P0.1). The Grade
  tab's Entry-timing panel labels it "research / unproven" accordingly.

### 9.6 IC bridge — from standardized z to per-signal weights
The cross-sectional pass (§3) produces a standardized z (mean 0 / unit scale) per
converted signal per name. `updatePicksAccuracyFile` persists it into the accuracy
enroll snapshot — `entrySignals[].z` alongside the legacy integer `score` and the
`contribution` — so it accumulates into `picks-accuracy.json` `closed[]` as outcomes
resolve. Today signal **weights stay equal** (`W_s = oldMax/PICKS_Z_CLIP`,
scale-preserving) and `bySignal` is sign-only hit-rate (§8). Once `bySignal` clears
`PICKS_SIGNAL_MIN_N`, fitting per-signal IC weights from the realized outcomes is a
**drop-in**: correlate each signal's stored z-vector against the realized win/loss (or
`optionPnlPct`) and set `W_s ∝ IC_s`. No rescaling needed — the persisted z is already
cross-sectionally comparable at entry. This is the substrate; it does not turn weights
on (same discipline as the gate: measure on forward, gate-era data first).

---

## 10. Pointers
- Code: [`scripts/build.mjs`](../scripts/build.mjs) — `computeEntryTiming`,
  `computeIvCostContribution` / `buildIvCostPillar` (§6.7 IV-cost component),
  `horizonWeight` / `applyHorizonWeight` (§3.5 horizon-aware pillar weighting),
  `detectMarketRegime`, `timingBarsFrom`, `buildTopPicks`, `scorePillared`,
  `pickContractForPick`, `buildExitPlan`, `updatePicksAccuracyFile`,
  `resolvePickOutcome`, `modelOptionExit` (P0.1 BS repricer),
  `bullishReversalConfirmed` (P1.2), `factorOfTicker`/`FACTOR_OF_SECTOR` (P2.1),
  `buildVixTerm` (§6.3 VIX term structure), `computeMacroEventRisk` (§6.6),
  `computeMacroRegime` / `computeMacroTilt` / `fedHawkishDrift` / `macroBetaWeight`
  (§6.3 cross-asset macro-stress regime + differential book tilt),
  `applyMacroRegimePersistence` (§6.3 regime hysteresis),
  `readGradesDaily` / `appendGradesDaily` / `writeGradesDaily` (§8 universe-IC
  substrate, measured offline by [`scripts/diagnose-grade-ic.mjs`](../scripts/diagnose-grade-ic.mjs)).
- Render: [`scripts/render/app-js.mjs`](../scripts/render/app-js.mjs) —
  `pickTimingBanner` / `pickTimingBadge` (the card) and `buildExecuteNowCard` (the
  live Grade-tab sibling). The expandable score breakdown is `pickPillarPanel`,
  whose per-category explainers live in `PILLAR_INFO` and whose Entry-timing
  panel (`pickTimingPanelBody`) renders the verdict + classified `reasons` from
  `pillars.timing`.
- Changelog: [`CHANGELOG.md`](../CHANGELOG.md).
