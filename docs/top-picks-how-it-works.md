# How Top Picks works (current)

A plain-language summary of the Top Picks engine **after** the cross-asset
macro-stress rework (#362). The canonical, code-mirroring spec lives in
[`top-picks-rubric.md`](./top-picks-rubric.md); this is the readable overview.

> **Top Picks** = the ≤10 *actionable* trades the engine is willing to put on
> today. It's distinct from the **grade-any-ticker** search (the full 138-name
> index in `grades.json`). Both share the same scoring first pass; Top Picks then
> applies extra gates (a tradeable contract, sector/factor caps) and ships only
> the survivors. The roster is allowed to ship **fewer than 10 — or zero** when
> there's little clean to buy ("cash is a position").

---

## 1. The pipeline at a glance

```
score every ticker  ──►  4 pillars + entry-timing + IV-cost + MACRO tilt  =  GRADE (total)
                          (each ticker, ~16 signals)
        │
        ▼
cross-sectional standardize  ──►  per-name signals become robust z-scores vs the
                                  whole universe (sector-neutral); tiers go percentile
        │
        ▼
pick the side       ──►  sign(total): + = call, − = put
        │
        ▼
buildTopPicks:
   ├─ candidates       |total| over the bar  (+ risk-off "tactical puts")
   ├─ GATE: contract   is there a liquid, tight-spread, right-delta option?
   ├─ GATE: caps       ≤3 per sector, ≤5 per correlation factor, severe-tape call cap
   ├─ de-gross         cut deployed size in a risk-off / severe tape
   └─ ship survivors   ranked by conviction; roster may honestly shrink
```

Everything that drives a trade is folded into **one number, `total`** — the grade.
Side is just its sign; conviction is its magnitude.

---

## 2. The grade = 4 pillars + 3 conviction terms

### The four asset-quality pillars (horizon-weighted)
Each pillar is a sum of its signals, then scaled by a **horizon weight** reflecting
how fast it moves price at the ~2-week option horizon the engine actually trades:

| Pillar | Weight | What it reads |
|---|---|---|
| **Fundamentals** | ×0.6 | earnings surprise, EPS/revenue growth, analyst targets **+ rating-change events**, P/E vs sector, guidance, major contracts, FCF, net-margin trend *(slow — discounted)* |
| **Technicals** | ×1.0 | RSI level + movement, MACD, streaks, support/resistance breaks, 52-wk position, volume, MA stack, chart pattern |
| **Mechanicals** | ×1.15 | unusual options flow, OI call/put, short interest, unusual volume, SPY flows, put/call extreme, VIX level/trend *(order flow leads price — boosted)* |
| **Narrative** | ×0.9 | catalysts (±), sector-narrative lifecycle, social sentiment, macro headwinds, DXY-1d, 10Y-1d, **+ the new Macro-Regime tilt (§4)** |

Several signals are **contrarian** (oversold RSI, 52-wk low, put/call fear, VIX
capitulation) — they only score the bullish "buy-the-crash" credit once a
**reversal bar confirms the turn**, so a still-falling knife never earns it.

### The three conviction terms (folded into `total` in parallel)
These don't flip the side; they strengthen or weaken conviction:

1. **Entry timing** (`computeEntryTiming`) — *"is now a good moment?"* Adds **+4** for
   a clean, well-located entry down to **−8 (scaling to −16)** for a falling knife
   or a chase of an extended top. This is what stops the engine buying calls after
   a +30% rip into resistance.
2. **IV cost** (`computeIvCostContribution`) — *"am I overpaying for vol?"* **−3** at
   the richest of a name's own IV history, **+1.5** at the cheapest. Direction-agnostic
   (long premium is expensive either way).
3. **Macro Regime tilt** (NEW, §4) — the cross-asset risk-off lean.

---

## 3. Cross-sectional scoring & tiers (why it's *relative*)

The per-name **continuous** signals (growth %, ratios, RSI, rvol, OI/PC ratios,
sentiment — ~16 of them) are **not** scored against fixed thresholds. Each build they
are standardized to a **robust z-score against the rest of the universe** (sector-neutral
by default). So a "good" grade means *good relative to everything else right now*, not
against a frozen rulebook.

**Tiers are therefore percentile-relative:**

| percentile of `|total|` | tier | meaning |
|---|---|---|
| top ~5% | **Strong Call / Strong Put** | very high conviction |
| next, to top ~12% | **Call / Put** | actionable |
| else | **No Trade** | not shipped |

…with an **absolute floor** under the percentile (≈ ±16 strong / ±12 trade), so on a
uniformly weak tape the engine can't mint a full roster of mediocre names — it ships
fewer, or none. Because standardization **demeans** a long-biased universe, the
actionable set can carry materially more outright **puts** than the old absolute engine.

---

## 4. ⭐ The cross-asset macro-stress regime (the #362 rework)

This is the big recent change: the engine now reacts to a **coordinated risk-off /
tightening tape** — VIX, the dollar, long-end yields, and the Fed path all rising
together — *before* the S&P itself capitulates.

### The four-axis gauge (`computeMacroRegime`)
Each axis scores **−2…0…+2** (negative = risk-off / tightening):

| Axis | Source | Risk-off when… |
|---|---|---|
| **VIX** | `^VIX` level / trend / term-structure | elevated (≥20), rising, or curve inverted |
| **DXY** | dollar index 1d / 5d | up ≥0.6% on the day (≥0.9% = −2) — global tightening / flight to USD |
| **Long yields** | 10Y/30Y 1d bps | up ≥10 bps (≥16 = −2) — duration/risk headwind |
| **Fed path** | FedWatch hike-odds drift | hike-minus-cut odds repricing **hawkish** ≥5 pt across the front meetings |

Composite states:
- **`risk-off`** — ≥2 axes firing.
- **`severe-risk-off`** — ≥3 axes firing **and** total stress ≤ −4.
- **`risk-on`** — ≥2 risk-on axes and zero risk-off axes.

### What it does to the picks
1. **Broadens the regime.** `detectMarketRegime` now returns **risk-off on the
   cross-asset signal alone** — no S&P −1% day required (the old gate). A lone green
   S&P print can't read risk-on while the macro is stressed.
2. **Tilts the whole book bearish — beta-weighted (the re-ranking lever).** A
   `Macro Regime` signal is added to the Narrative pillar: **−4** (risk-off) / **−8**
   (severe) / **+2** (risk-on), **× the name's beta** (real beta, clamped 0.5–1.6).
   High-beta growth gets discounted hardest, defensives least — so the highest-beta
   marginal **calls flip to puts**, and weak names go clearly negative. (A *uniform*
   macro nudge can't re-rank a percentile engine — it demeans away. Beta-weighting is
   what makes it differential and survive standardization.)
3. **Cuts size (de-grosses).** Deployed gross is scaled **×0.6** in risk-off, **×0.4**
   in severe — a desk cuts size in a tightening tape, not just direction.
4. **Severe-tape guards.** Caps calls at **3** (rest fill with puts/cash) and **relaxes
   the tactical-put bar** (−8 → −5) so more weak names become shortable.

The gauge — state, the four axes, drivers, and the gross multiplier — shows in the
**Top Picks summary chip** (`⚠ Risk-off · VIX ↑ · DXY +0.66% · Fed hawkish +6pt`).

### Worked example — the 2026-06-07 tape
VIX 21.5 (rising +40%), DXY +0.66%, Fed repricing +6 pt hawkish, 10Y +5.9 bps →
**risk-off** (3 of 4 axes). Result, verified offline:

| | roster | puts | deployed gross |
|---|---|---|---|
| Old engine (regime off) | **1 pick** | 1 | full |
| New engine (risk-off) | **10 picks** | **10** | ~41% (0.80 × 0.6 × edge governor) |

That's the "puts get recommended when everything's rising together" behavior.

---

## 5. Entry-timing gate (location & tape)

Before a graded name ships, `computeEntryTiming` reads **confirmed daily bars** (no
look-ahead) and returns **go / wait / avoid**:

- **`avoid`** → falling knife (a −6% day, a −8%/3d slide on volume, or a deep
  adverse excursion) or chasing an extended top (hot RSI + stretched above the 20D
  SMA, or a +10% multi-day blow-off). Penalty scales with how egregious it is.
- **`wait`** → mixed structure, earnings within 8 sessions (IV-crush risk), an
  imminent *uncertain* macro print (FOMC/CPI the crowd can't call), or extreme own-IV.
- **`go`** → a clean, well-located entry (confirmed breakout on volume, momentum
  aligned, or a healthy pullback to the 20D SMA with buyers stepping in).

When the **broad tape fights the trade** (a call into risk-off), the knife thresholds
tighten ~25% so a borderline name is dropped, not just deferred.

---

## 6. Contract selection (`pickContractForPick`)

Once a name is actionable, the engine picks one option on the graded side:

- **DTE** ≥ 21 (roster), standard monthlies only.
- **|Delta|** 0.45–0.65 (target ~0.55) — near-the-money, so an ~8% adverse move
  isn't a −70% wipeout like the old deep-OTM picks.
- **Spread** ≤ 10% (roster), **OI** ≥ 100, **IV** ≤ 200%.
- **Premium** ≤ max($35/share, 12% of spot) — price-aware.
- Refuses anything the live grader would call "bad" (heavy theta, near-expiry,
  mostly-extrinsic).

**Exits:** a hard option stop at **−40%** of premium; a **trailing** take-profit that
arms at **+60%** and locks in a runner (let winners run, since long-premium P&L is
right-tail-driven). The underlying cut is the deeper of structural support and a
~2.5×ATR floor (clamped 5–12%), so routine noise doesn't shake out a good entry.

---

## 7. Roster construction & sizing

- **Ranked by conviction** (`|total|`), which already folds in timing, IV cost, and the
  macro tilt — so a well-timed, cheap-vol, macro-aligned name outranks a chased one.
- **Sector cap** ≤3 per GICS sector; **factor cap** ≤5 per correlation factor (the
  semis/software/mega-cap-tech complex is one beta across several sectors).
- **Tactical puts**: in a confirmed risk-off tape, bearish-leaning names that sit just
  below the bar are added as reduced-size "Tactical Put" entries — but only on a clean
  `go` breakdown.
- **Risk-based sizing**: each pick is weighted **inverse to its risk-to-stop** and
  tilted by conviction, normalized so the weights sum to the (regime-adjusted, edge-
  governed) gross target — the rest is cash. Highest-vol name → smallest position.
- **Honest roster note** explains a short list: *"only N clean setups · M gated ·
  K sector-capped · L calls capped (severe tape)."*

---

## 8. Accuracy tracking (the feedback loop)

Every shipped `go` pick is enrolled and marked-to-market each build. The Track-record
tab leads with the **modeled option win-rate / expectancy** (the engine trades options,
so it's graded on the option — entering at the ask, exiting at the bid), with the
underlying move and a SPY benchmark as context. Outcomes are broken out by tier,
**sector**, and **regime at entry**, and a per-signal hit-rate accumulates as the
substrate for eventually replacing the equal-weight scoring with measured weights.

---

## 9. The knobs you'll reach for

Everything is a named, env-overridable constant. The macro layer:

| Knob | Default | Effect |
|---|---|---|
| `PICKS_MACRO_REGIME` | on | master flag — `0` reverts to the legacy S&P+VIX regime |
| `PICKS_MACRO_TILT` | on | the bearish book tilt — `0` keeps regime detection but no tilt |
| `PICKS_MACRO_TILT_BASE` / `_SEVERE` | 4 / 8 | tilt strength (risk-off / severe) |
| `PICKS_MACRO_RISKOFF_AXES` / `_SEVERE_AXES` / `_SEVERE_STRESS` | 2 / 3 / −4 | how readily it flips to risk-off / severe |
| `PICKS_MACRO_GROSS_RISKOFF` / `_GROSS_SEVERE` | 0.6 / 0.4 | de-grossing multipliers |
| `PICKS_MACRO_SEVERE_CALL_CAP` / `_SEVERE_PUT_BAR` | 3 / −5 | severe-tape call cap & relaxed put bar |
| `PICKS_MACRO_DXY_1D` / `_YIELD_BPS_1D` / `_FED_DRIFT_PT` | 0.6 / 10 / 5 | per-axis trigger thresholds |

If the roster ever looks too aggressive, dial `PICKS_MACRO_TILT_BASE` down or raise
`PICKS_MACRO_RISKOFF_AXES`; too timid, do the reverse.

---

## 10. One-line mental model

> *Grade every name relative to the universe (4 pillars), fold in whether now is a
> good entry, whether vol is cheap, and whether the cross-asset macro tape is risk-off;
> the sign is the side, the magnitude is the conviction. In a tightening tape the whole
> long book is discounted hardest on high-beta names, puts surface, and size comes down.*
