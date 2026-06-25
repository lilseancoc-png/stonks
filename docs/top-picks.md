# Top Picks

The canonical spec for how a name becomes a **Top Pick**. The engine is a clean
rebuild (it replaced a 263-knob, four-document tangle of nine self-contradicting
reworks). It lives entirely in the `// TOP PICKS ENGINE` block of
[`scripts/build.mjs`](../scripts/build.mjs); every threshold below is a named
constant there. **If the code and this doc disagree, the code wins — fix the doc.**

> **Scope.** "Top Picks" = the ≤10 *actionable* trades the engine will put on
> today (`picks.json`). It is **not** the grade-any-ticker search (`grades.json`,
> the full ~138-name index, a FREE feature). Both share one `scoreTicker()` pass;
> Top Picks then adds gates (a tradeable contract, re-entry suppression, sector
> caps) and ships only the survivors. The roster may honestly ship **fewer than
> 10, or zero** — *cash is a position.*

---

## 1. The one rule

Everything folds into **one number per ticker, `total`** — the grade.

```
total = Trend + Flow + Fundamentals + Narrative + entryTiming + ivCost
        (each pillar clamped to ±5)         (−8..+2)   (−2..+1)

side       = sign(total)        (+ = call, − = put)
conviction = |total|
```

`scoreTicker()` runs this for every ticker. `buildGradesIndex()` keeps them all
(`grades.json`); `buildTopPicks()` keeps the actionable ones and ships a contract.

### The six lessons that shaped it
The only non-obvious rules are the ones real losses taught us (the old engine ran
a ~5–11% win rate). Everything else is deliberately plain:

1. **Direction is what kills you** — 100% of past losses were direction-driven,
   not theta. So the side call matters most, and the engine will **stand down**.
2. **Don't buy the top / catch a knife** — losers had max-favorable-excursion
   ≈ 0% (they fell the instant they were bought). → the **entry-timing** penalty.
3. **Near-the-money contracts** (~0.55Δ), never fragile deep-OTM where an 8%
   adverse move is a −70% wipeout.
4. **One entry per name** until it resolves — 58% of past entries were restacks
   of the same losing thesis. → **re-entry suppression**.
5. **Tight, asymmetric option exits** (+20% take-profit / −30% stop).
6. **Willing to go short and to hold cash** — long-only into a risk-off tape was
   fatal; fewer/zero picks is allowed.

---

## 2. The four pillars (`scoreFundamentals/Technicals/Mechanicals/Narrative`)

Each pillar is the integer sum of a few clearly-motivated signals, then clamped
to **±5** so no single family dominates a thin thesis. Every signal renders as a
chip on the card (`{key,label,score,value,note}`).

**Technicals** (trend & momentum — the core read for a ~2-week option):
RSI movement (±1), RSI extreme reading (contrarian, ±3, reversal-confirmed),
MACD (±1), moving-average trend (±1), streak (±1), support/resistance break
(±2), 52-week position (contrarian, ±1), volume confirmation (±1), confirmed
chart pattern (±1).

**Mechanicals** (order flow leads price short-term):
unusual options flow (±1), open-interest call/put skew (±1), short interest
(squeeze setup / covering, ±1), unusual intraday volume + direction (±1).

**Fundamentals** (slower, but the *event* signals still move fast):
earnings surprise (±2), EPS growth (±1/−2), revenue growth (±1/−2), analyst
price target (±1), analyst rating *changes* (±2), P/E vs sector (±1), guidance
(raised +3 / inline +2 / lowered −3, with a dividend-headline guard), major
contract won/lost (+2/−3), **capital raise / dilution** (a fresh
headline-flagged financing: equity/convertible issuance −2/−3, debt/notes
−1/−2/−3, buyback +2/+3 — magnitude-scaled so a multi-billion bond raise or
dilutive deal is a *dominant* driver, not a footnote; `data.capitalRaise`),
free cash flow (±1), net-margin trend (±1), plus a forward **trajectory** nudge
(±2, `computeFundamentalsTrajectory`) that votes from guidance, growth
acceleration vs the trailing rate, analyst revisions, margin slope and
earnings-surprise momentum — the "is the business improving or declining?" read,
blended into the snapshot score and surfaced as a ↗/↘ arrow
(`pillars.fundamentals.trajectory = { dir, score, confidence, reason }`).

> **ETFs / funds have no Fundamentals pillar.** For a curated `SECTORS[sym] ===
> "ETF"` (GLD, SLV, USO, SPY, TLT, …) the whole company-fundamentals pillar is
> suppressed (score 0, one "n/a for a fund" chip) — a basket has no earnings,
> guidance, contracts or cash flow, and the AI news reads otherwise hallucinate
> them (a "major contract lost" on a gold ETF). An ETF's grade rests on its
> price action (Technicals), flow (Mechanicals) and the macro Narrative.

**Narrative** (light — one AI read is noisy):
news catalyst (bullish +2 / bearish −3, asymmetric), sector narrative (±2, faded
by lifecycle), social sentiment (±1).

Continuous signals are scored against fixed, documented thresholds — **no
cross-sectional z-scoring, no percentile tiers, no horizon-weight overlays.** One
fixed scale, auditable forever.

---

## 3. Entry timing (`computeEntryTiming`) — the risk control

Reads **confirmed** daily bars (drops the in-progress bar — no look-ahead) for
the implied side and returns a state + a bounded contribution folded into `total`:

| State | When | Contribution |
|---|---|---|
| **avoid** | falling knife (−6% day / −8% over 3d) or chasing an extended top (hot RSI + >8% past the 20D SMA, or a +12% blow-off run) | −5 (to −8 for the egregious) |
| **wait** | earnings within ~7 sessions (IV-crush risk) or an imminent scheduled macro event (FOMC/CPI) or mixed structure | −1 / 0 |
| **go** | clean, aligned entry (momentum + a healthy pullback to the 20D SMA, or confirming volume) | +2 |

When the broad tape **fights the trade** (a call in a risk-off tape), the knife
thresholds tighten ~25%. An `avoid` name is gated out of the roster entirely.

**IV cost** (`computeIvCostContribution`, direction-agnostic): −2 when this name's
own IV percentile is rich (≥80), +1 when cheap (≤20).

---

## 4. Tiers (`tierForScore`) — fixed absolute bars

| `|total|` | Tier | Conviction |
|---|---|---|
| ≥ `PICKS_TIER_STRONG` (7) | Strong Call / Strong Put | Very High |
| ≥ `PICKS_MIN_CONVICTION` (4) | Call / Put | High |
| else | No Trade | — (not shipped) |

Absolute and stable — no percentile recomputation, no recalibration treadmill.

---

## 5. Market regime — the "market tape" (`computeMacroRegime`)

A multi-axis cross-asset gauge that **resets every build** from the live factors
(no cross-build persistence — the chip reflects *this* build's tape). Each axis
votes −2..+2 (negative = risk-off); the composite sets the state ∈ `risk-on` /
`neutral` / `risk-off` / `severe-risk-off`. The axes:

| Axis | Reads |
|---|---|
| **Indexes** | SPY + QQQ — the overall market (1d move, 5d, 20D trend). Its own un-clustered axis. |
| **VIX** | level + trend + term-structure backwardation |
| **Yields** | 10Y / 30Y 1d bps (bonds) |
| **Dollar** | DXY 1d/5d (USD) |
| **Fed path** | FedWatch hawkish drift **+ an imminent FOMC decision** (≤3 sessions → cautious) |
| **Commodity** | crude spike + gold haven bid (supply / war shock) |
| **Geopolitics** | war / tariffs / Iran / sanction headlines + the AI narrative layer |
| **Inflation** | CPI YoY momentum + unemployment (Sahm) |
| **Fear & Greed** | CNN equity internals (confirming vote; also raises a `fragile` flag) |
| **Global tape** | overnight cross-asset breadth (futures / Asia-EU / yen / copper / BTC) |

The composite is **collinearity-aware** (`macroEffectiveAxisCount` — a coordinated
vol/fear or dollar/rates move counts once, not N times). `severe-risk-off` needs
≥3 raw risk-off axes **and** stress ≤ −4; `risk-off` needs ≥2 effective; `risk-on`
needs ≥2 effective risk-on axes, positive stress, a calm VIX **and a non-negative
Indexes axis**. In a risk-off tape the engine:

- **tilts the whole book bearish** (`PICKS_REGIME_TILT`, −2; −4 severe) so the
  marginal calls fall toward No-Trade / flip to puts;
- **de-grosses** deployed size (×0.6 risk-off, ×0.4 severe);
- **lowers the bar for tactical puts** (a sub-conviction bearish name with a clean
  breakdown can ship as a reduced-size put).

The engine ships a per-axis breakdown + the raw inputs + a threshold snapshot in
`picks.json`'s `rosterMeta.macroRegime`, so the browser's **live market tape**
(`computeLiveMacroRegime` in `scripts/render/app-js.mjs`) recomputes the *price*
axes (Indexes/VIX/yields/dollar/commodity/Fear & Greed/global) intraday from
`/api/macro-live` while the Top Picks tab is open — the slow axes (Fed path,
geopolitical news, inflation) carry from the last build. Keep the two in sync.
(`applyMacroRegimePersistence` / `detectMarketRegime` remain exported for the SPY+VIX
fallback chip + tests, but the build no longer persists — it resets each bake.)

---

## 6. Contract selection (`pickContractForPick`)

A single near-the-money long on the graded side. Hard filters, then a composite
quality score picks the best survivor:

- **DTE** 14–60 (roster: ≥21), ideal 21–45 — short-dated for a ~1–2 week hold.
- **|Δ|** 0.45–0.65 (target 0.55) — near-the-money, so an 8% adverse move isn't a
  −70% wipeout.
- **Spread** ≤ 12% (roster ≤ 10%), **OI** ≥ 100, **IV** ≤ 200%.
- **Premium** ≤ max($35/share, 12% of spot) — price-aware.
- Composite quality (spread weighted hardest) must clear `PICKS_MIN_QUALITY`
  (0.45) or the name drops. Ship fewer picks rather than an untradeable contract.

The contract payload carries the fields the card renders (greeks, breakeven,
expected move, R/R, probability-of-profit, `contractQuality`).

---

## 6.5 Strategy selection (`selectStrategy` + `pickVerticalForPick`)

The grade decides the **side + conviction**; the strategy layer decides the
**structure** — none, naked long, debit vertical, or credit vertical — so the
engine stops reflexively buying a single long into every setup *and* never
recommends a trade when the **thesis** is too thin to justify one. It is
**deterministic** and keyed on the IV regime + conviction + the **thesis tier**
(`assessThesisQuality`, §9). The IV read is a **z-score of the current ATM-30d IV
vs the name's own ~18-month mean** (`ivRank.z`, computed in `attachIvRanks`;
falls back to the percentile when history is thin).

The decision tree is checked top-down (first match wins):

| # | Condition | Structure | Why |
|---|---|---|---|
| 0 | **Thesis tier is `weak`** | **none** | The grade cleared the bar but the case is thin / single-pillar → recommend *no trade*. Ship the grade + thesis as a watch idea (the "high grade but weak thesis → no strategy recommendation" rule). |
| 1 | IV **elevated** — `z ≥ PICKS_IV_CREDIT_Z_ELEVATED` (1.5σ) **OR** `pctile ≥ PICKS_IV_CREDIT_PCTILE` (60th) — **and** no imminent event/earnings | **credit vertical** | Premium is statistically expensive → *sell* it on the bias side (bullish → bull-put, bearish → bear-call); sell near-money, buy a further-OTM wing, targeting a credit ≈ ⅓ of the width. High IV mean-reverts and theta works for you. The **highly-elevated** band (`z ≥ PICKS_IV_CREDIT_Z` 2σ OR `pctile ≥ PICKS_IV_RICH` 80th) is the same structure, labelled as the strongest sell-premium case. The IV read is the spec's **OR** of the two measures (the z-score *or* the percentile — either qualifying counts). The **headline rule** — fires even at strong conviction. |
| 2 | Strong tier (`|total| ≥ 7`) **and** thesis tier `strong` **and** IV **not elevated** (neither z nor pctile in the credit band) + no event | **naked long** | **Rare.** Exceptional, multi-signal conviction *and* a strong thesis with low IV → a single long for max delta/gamma + uncapped upside. |
| 3 | Everything else — moderate conviction/thesis, **or** a strong view into elevated-but-event-blocked IV, **or** an imminent event/earnings | **debit vertical** | The default: long near-money financed by a short OTM wing (same side). Caps theta/vega + the premium at risk; defined-risk into events (a naked long eats the IV crush, a credit spread eats the gap). |

A binary **event/earnings within `PICKS_STRATEGY_EARNINGS_DAYS` (21d)** (or an active macro `eventRisk`) forces row 3 — defined-risk only, no naked long into the IV crush, no credit spread into the gap. A `none` pick carries **no contract** and is never enrolled in the track record (nothing to mark).

`pickVerticalForPick(side, data, rfr, {type})` builds the two-leg contract:
- **debit** legs are the *same* type as the side (bull-call / bear-put): long
  ~0.55Δ near-money + short ~`PICKS_DEBIT_SHORT_DELTA` OTM wing.
- **credit** legs are the *opposite* type (a bull-put on a bullish name): short
  ~`PICKS_CREDIT_SHORT_DELTA` near-money + a long wing chosen by
  `pickCreditWing` to collect ≈ `PICKS_CREDIT_WIDTH_FRAC` of the width (rejecting
  anything under `PICKS_CREDIT_WIDTH_FRAC_MIN`).

The payload carries `structure` (`long` / `debit_vertical` / `credit_vertical`),
`legs[]` (`{qty,type,strike,iv,delta,thetaDay,vega,mid,…}`), `shortStrike` /
`longStrike`, `mid` (net debit/credit), `maxLoss` / `maxProfit` / `width`,
breakeven, net greeks, PoP, and `contractQuality`. `buildPickContract` falls back
down the defined-risk → naked ladder if the preferred structure has no liquid
wing (and stamps `strategy.fallback`). Off via `PICKS_STRATEGY_AUTO=0` (always
naked long, legacy). Each pick ships `strategy = {type,label,reason,ivZ,…}`.

**Track-record marking is structure-aware** (`markOptionToMarket` /
`resolvePickOutcome`): a spread is repriced leg-by-leg (Black-Scholes) and the
P/L is normalized so **+ always = the trade making money**; credit verticals
take profit / stop on % of the credit (`PICKS_CREDIT_TP_PCT` / `_STOP_PCT`), not
the +20/−30 premium gates, and a theta stop never applies to them. The enrolled
accuracy entry stores the legs so later builds can mark it. (`diagnose-pick-losses`
skips spreads — its single-leg model would mislead.)

---

## 7. Roster construction (`buildTopPicks`)

1. Candidates = grade actionable (`|total| ≥ 4`), or a tactical put in a confirmed
   risk-off tape. **The actionable bar is edge-governed** (`edgeGatedConviction`):
   when the trailing resolved book's realized option edge is materially negative
   (the live record has run a ~33% win rate against the +20/−30 exits, an
   expectancy that needs >60% to break even), the bar steps **up** — to
   `min(Strong, 4+2)=6` at ≤ −8%, all the way to the **Strong tier (7)** at ≤ −15%
   — so a losing book ships only its highest-conviction reads (genuinely standing
   down, lesson #1/#6) instead of trading the same breadth smaller. It needs
   `PICKS_EDGE_GATE_MIN_N` (12) decided closes to engage and relaxes automatically
   as the weekly-reset record recovers. Tactical puts (the defensive side) keep the
   `PICKS_RISKOFF_PUT_BAR` and are unaffected. Off via `PICKS_EDGE_GATE=0`; the
   raised bar ships in `rosterMeta.edgeGate`/`tradeCut`.
2. **Drop names with an open tracked position** (re-entry suppression).
3. **Drop `avoid`-timed names.**
4. **Require a tradeable contract** (else drop).
5. **Sector cap** ≤3 per sector + a correlation-factor cap (the tech/AI complex),
   ETFs uncapped; plus a per-side cap so the book isn't wildly one-way.
6. **Factor-trend gate** (`computeFactorTrendHealth`): the resolved track record's
   worst loss was a long-Tech/AI-call book wiped while the *broad* tape barely moved
   (SPY ≈ −1.5%, the picks ≈ −9.6%) — a factor-specific drawdown the broad
   SPY/QQQ/VIX regime can't see. So each correlated factor's **own** trend is
   measured from its members' bars (share below the 20D SMA + median confirmed 5-day
   return); when a factor is actively breaking down (`PICKS_FACTOR_WEAK_SHARE` ≥0.6
   below 20D **and** `PICKS_FACTOR_WEAK_RET5` median 5d ≤ −3%) **new long calls** in
   it are suppressed — only a strong-tier, `go`-timed call earns a reprieve. **Puts
   are unaffected** (a falling factor is fine to be short). Ships
   `rosterMeta.factorTrend` + `factorTrendGated`; off via `PICKS_FACTOR_TREND_GATE=0`.
7. Rank by conviction, ship up to 10.

**Sizing** (`applyPickSizing`): risk-based and conviction-tilted, normalized to a
gross target that **ramps with roster size** (a 1–2 name roster holds more cash)
and is scaled down by the regime de-gross and a realized-edge governor
(`computeEdgeScale` — cut gross when the trailing record's option expectancy is
negative). Each pick ships a `sizing` block (`weight`, `riskToStopPct`,
`suggestedContracts`) against a display-only `PICKS_DISPLAY_ACCOUNT`.

---

## 8. Exits (`buildExitPlan` / `resolvePickOutcome`)

- **Option-space (primary):** +20% take-profit / −30% stop on premium — flat and
  asymmetric. The instant the modeled mark hits a gate, the pick resolves. The
  plan also surfaces the **concrete contract price** for each gate off the entry
  mid (`optionStop`/`optionTp` + per-level `optionPrice`/`optionPct`/`entryPrem`):
  e.g. a $5.00 long → stop at **$3.50**, take-profit at **$6.00**. Credit
  verticals express these as the **buy-back** price (stop ≈ 2× the credit, target
  ≈ half the credit). Rendered as `opt stop $X.XX` / `opt target $X.XX` chips on
  the exit-ladder cut/TP levels.
- **Underlying:** take-profit at the nearest structural level; stop at the deeper
  of structural support and a ~2.5×ATR floor (clamped 5–12%) so routine noise
  doesn't shake out a good entry.
- **Time stop:** force-close after **14 sessions** — *down at two weeks = a loss*
  (scored by the option-P&L sign). A theta stop cuts a dead-money bleeder sooner;
  an earnings exit closes ~2 sessions before a print.

---

## 9. The feedback loop (accuracy / history / roster)

- `updatePicksAccuracyFile` enrolls every shipped pick (dedup per `symbol:side`),
  marks each to market on its **contract** every build (Black-Scholes), resolves
  on the exit rules above, and computes stats (`winRate`, option expectancy,
  option peak/dip `avgOptHiPct`/`avgOptLoPct`, `byTier`/`bySector`/`byRegime`). The
  record **resets weekly** so the numbers reflect the current engine, not a tail of
  pre-tuning outcomes. **The Track Record tab shows only this contract (option)
  scorecard** — the win/loss already resolves on the modeled option P&L, and the
  stock-move chips (stock expectancy, vs-SPY, stock peak/dip) were dropped; the
  generic stock win-rate chip remains only as a fallback for legacy pre-snapshot data.
- **Thesis tracking:** each pick ships a structured **six-section** `thesisCard`
  (`buildThesisCard`) — a synthesised **`edge`** (the one-line "why this trade has
  an advantage now", `buildEdgeStatement`), the supporting `works` split into
  **`companyDrivers`** (Fundamentals/Narrative) and **`confirmation`**
  (Technicals/Flow), a deterministic **`marketRead`** (does the cross-asset macro
  tape *support / work against / stay neutral to* the trade — from the name's
  sector → macro-axis sensitivity via `buildMarketRead`, e.g. rate-sensitive
  homebuilders vs the Fed path + long yields), `invalidators` (each lead driver
  reversing, a macro-read reversal, the price stop — the short-strike breach for a
  credit spread — the 14-day time stop, a grade-flip trigger), and the
  **`strategy`** rationale. It also carries a **`thesisQuality`** (`{ score, tier,
  checklist }`, §9a) and the matrix **`classification` / `group`**, a `conviction`
  label, a back-compat **`hasSolidThesis`** (= `tier === "strong"`) + an honest
  **`disclosure`** wording the thin / moderate case, and an optional AI **`prose`**
  gloss (hybrid: deterministic thesis is the source of truth, `attachPickThesisProse`
  adds one natural causal paragraph when `GEMINI_API_KEY` is set — cached per
  thesis-signature in `pick-thesis-cache.json`, read-before-wipe / write-after,
  skipped by `regen-picks`). The browser renders a **scannable head** (the edge +
  classification badge + strategy chip *or* "no recommendation" note + conviction +
  disclosure) and a collapsed **"Expand for full reasoning"** with the six sections
  + the quality checklist. A compact snapshot is frozen on the enrolled `open`
  entry (contract-bearing picks only); every later build re-scores it against the
  **live grade** into `thesisStatus` (on-track / mixed / broken).

### 9a. Thesis quality + the execution matrix

The grade says *how strong the signal is*; the **thesis quality**
(`assessThesisQuality`, exported) says *whether there's a clear, multi-factor,
testable, strategy-coherent case behind it*. It sums an auditable **0..8 points**
rubric — a clear driver (0/1/2), technical/flow confirmation (0/1/2), multi-pillar
alignment (0/1/2), a non-fighting tape (−1/0/+1), and signal-specific invalidation
(0/1) — into a **tier**: `strong` (passes every hard gate **and** `score ≥
PICKS_THESIS_STRONG_SCORE`), `moderate` (a real but not airtight case, `score ≥
PICKS_THESIS_MOD_SCORE` + multi-pillar), or `weak` (thin / single-pillar). A macro
headwind keeps a multi-factor name out of `strong` but **not** out of `moderate`.

The grade tier (Strong `|total| ≥ 7` / Moderate `4–6`) **crosses** the thesis tier
in `classifyPick` to set `classification` + `group`:

| grade ＼ thesis | strong | moderate | weak |
|---|---|---|---|
| **Strong (≥7)** | `actionable` — **Actionable top pick**, full strategy | `moderate` — watch idea, strategy shown | `highGradeWeakThesis` — grade shown, **no strategy** |
| **Moderate (4–6)** | `moderate` — **Moderate conviction**, strategy shown | `moderate` — watch idea, strategy | `idea` — grade-only, **no strategy** |

`group = "actionable"` only for the top-left cell; everything else is `"watch"`.
`buildTopPicks` partitions the roster into the two groups (capped at `PICKS_COUNT`
/ `PICKS_WATCH_COUNT`), and the Top Picks tab renders them as **Actionable top
picks** vs **Ideas · Watch**. A `weak`-thesis pick is shown (grade + thesis + the
honest disclosure) but carries no strategy and no contract — *cash is a position.*
- `diffGradesHistory` / `buildPicksChanges` / `buildPicksRoster` log whole-universe
  grade changes, the actionable-bar in/out churn, and the Top-10 roster snapshot.
- `appendGradesDaily` / `appendRegimeHistory` keep the IC substrate + risk-on/off
  calendar.

Scoring is **deterministic — no AI in the grade.** (The optional AI prose-polish
the old engine ran was removed.)

---

## 10. The constants you'll reach for

All in the `// TOP PICKS ENGINE` constant block at the top of the engine:

| Knob | Default | Effect |
|---|---|---|
| `PICKS_MIN_CONVICTION` / `PICKS_TIER_STRONG` | 4 / 7 | actionable / strong grade bars |
| `PICKS_THESIS_STRONG_SCORE` / `_MOD_SCORE` | 5 / 3 | thesis-quality bars (strong / moderate tier) |
| `PICKS_EDGE_GATE_SOFT` / `_HARD` / `_MIN_N` | −8 / −15 / 12 | edge-governed bar: raise the actionable cut toward Strong when the realized option edge is this negative (after this many decided closes) |
| `PICKS_COUNT` / `PICKS_WATCH_COUNT` | 10 / 6 | max Actionable / max Ideas·Watch roster size |
| `PICKS_MAX_PER_SECTOR` | 3 | correlation cap |
| `PICKS_MAX_PER_FACTOR` | 5 | tech/AI-complex correlation cap |
| `PICKS_FACTOR_WEAK_SHARE` / `PICKS_FACTOR_WEAK_RET5` | 0.6 / −3 | factor-trend gate: suppress new calls in a rolling-over factor |
| `PICKS_OPT_TP_PCT` / `PICKS_OPT_STOP_PCT` | 0.20 / 0.30 | option exits |
| `PICKS_MAX_HOLD_DAYS` | 14 | time stop (two weeks) |
| `PICKS_DELTA_MIN/MAX/IDEAL` | 0.45 / 0.65 / 0.55 | contract moneyness |
| `PICKS_MIN_DTE` / `PICKS_MAX_DTE` | 14 / 60 | contract clock |
| `PICKS_STRATEGY_AUTO` | on | structure auto-select (off = always naked long) |
| `PICKS_IV_CREDIT_Z_ELEVATED` / `PICKS_IV_CREDIT_PCTILE` | 1.5 / 60 | **elevated** IV → credit (broadened band: z≥1.5σ OR ≥60th pctile) |
| `PICKS_IV_CREDIT_Z` / `PICKS_IV_RICH` | 2.0 / 80 | **highly-elevated** IV labels (z≥2σ / ≥80th) |
| (naked IV gate) | not elevated | naked needs IV **not** in the credit band (the spec's "IV Rank < 60") **and** a strong grade + strong thesis |
| `PICKS_CREDIT_WIDTH_FRAC` / `_MIN` | 0.34 / 0.22 | credit-spread target / floor (credit ÷ width) |
| `PICKS_CREDIT_TP_PCT` / `_STOP_PCT` | 0.50 / 1.00 | credit-spread exits (% of the credit) |
| `PICKS_GROSS_TARGET` | 0.80 | deployed gross (rest cash) |
| `PICKS_REGIME_TILT` | 2 (4 severe) | risk-off bearish tilt |

---

## 11. Verifying a change

There is no live `data/` in a fresh checkout, so the engine is exercised by a
synthetic smoke test: `node scripts/picks-smoke.mjs` (asserts grades, timing
gates, contract selection, caps, re-entry suppression, the regime tilt, exits,
and every output shape the UI reads). To regenerate from a hydrated `data/`
(`node scripts/sync-data.mjs pull`), run `node scripts/regen-picks.mjs`.

---

## 12. Pointers

- Engine: the `// TOP PICKS ENGINE` block in `scripts/build.mjs`.
- Offline rebuild: `scripts/regen-picks.mjs`. Smoke test: `scripts/picks-smoke.mjs`.
- Browser render: `loadPicks`/`renderPicks` + the grade-search + Track-record
  views in `scripts/render/app-js.mjs` (read `picks.json` / `grades.json` /
  `picks-accuracy.json` / `picks-roster.json` / `picks-changes.json`).
