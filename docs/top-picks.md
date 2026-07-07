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
5. **Tight, asymmetric option exits** (−30% stop; the +20% gate has since
   evolved into bank-half-and-trail — see §8).
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
| **wait** | earnings within 7 calendar days (~5 sessions; IV-crush risk — the day-of print counts) or an imminent scheduled macro event (FOMC/CPI) or mixed structure | −1 / 0 |
| **go** | clean, aligned entry (momentum + a healthy pullback to the 20D SMA, or confirming volume) | +2 |

When the broad tape **fights the trade** (a call in a risk-off tape), the knife
thresholds tighten ~25%. An `avoid` name is gated out of the roster entirely.

**IV cost** (`computeIvCostContribution`, direction-agnostic): −2 when this name's
own IV percentile is rich (≥80), +1 when cheap (≤20). Because it is direction-**agnostic**
("long premium is expensive when IV is rich"), `scoreTicker` folds it into `total`
multiplied by `sign(base)` — exactly like `entryTiming` — so a rich-IV long-premium
trade always *reduces* conviction on **both** sides and a cheap-IV one raises it.
(Before #523 it was added unsigned, which made rich IV *inflate* a put's conviction —
backwards: it boosted the long-put trade the IV read should have discouraged.)

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

The composite is **weighted** (`MACRO_AXIS_WEIGHTS` — each axis's −2..+2 vote is
scaled by how directly that factor prices equity risk, in *both* the net-stress
sum and the effective axis counts): the Indexes axis ×1.5 (the market's own read),
Fed path / credit / VIX ×1.25, yields / 2Y / global tape / breadth ×1.0, dollar /
MOVE / commodity / geo / put-call ×0.75, and inflation / sentiment / rotation ×0.5
(monthly CPI transmits via the heavier Fed-path/rates axes; F&G re-aggregates
other axes; rotation is derivative of equity). Override per axis via
`PICKS_MACRO_AXIS_WEIGHTS="fed:1.5,inflation:0.25"`; the weights ship in the
thresholds sidecar so the browser's live re-port weighs identically, and each
axis tile shows its ×w chip. The composite is also **collinearity-aware**
(`macroEffectiveAxisCount` — a coordinated vol/fear or dollar/rates move counts
once, not N times: the heaviest lit axis in a cluster counts at full weight,
extras at the cluster discount × their weight; the **Inflation axis sits in the
rates cluster**, since a hot CPI's equity impact transmits through the Fed
path / yields / dollar the tape already reads live, and the monthly CPI vote
otherwise double-counts that one tightening story for weeks at a time). All three
regime gates use **effective** (weighted, collinearity-discounted) axis counts:
`severe-risk-off` needs ≥3 effective risk-off axes **and** stress ≤ −4; `risk-off`
needs ≥2 effective **and** net stress ≤ 0 (`PICKS_MACRO_RISKOFF_STRESS` — two
marginal −1 votes can't lock the tape defensive against a broadly positive board);
`risk-on` needs ≥2 effective risk-on axes, stress ≥ +2, ≤1 effective dissenting
axis, a non-negative VIX **and Indexes axis**, and no axis at −2 (an acute
reading vetoes at any weight). (The table
above lists the original ten axes; the gauge has since grown to sixteen — 2Y
yields, bond vol/MOVE, breadth, put/call, credit spreads and sector rotation
vote alongside them, same −2..+2 convention.) In a risk-off tape the engine:

- **tilts the whole book bearish** (`PICKS_REGIME_TILT`, −2; −4 severe) so the
  marginal calls fall toward No-Trade / flip to puts;
- **de-grosses** deployed size with the regime's stress-ramped `grossMult`
  (`PICKS_MACRO_GROSS_*` — the same figure the chip displays; the flat
  ×0.6/×0.4 `regimeGrossMult` is only the fallback when no macro regime rode
  into the build);
- **lowers the bar for tactical puts** (a sub-conviction bearish name — total ≤
  −3 with timing not `avoid` — can ship as a reduced-size put).

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

- **DTE** 14–60 (roster: ≥21, for verticals too), ideal 21–45 — short-dated for
  a ~1–2 week hold.
- **|Δ|** 0.45–0.65 (target 0.55) — near-the-money, so an 8% adverse move isn't a
  −70% wipeout. Vertical legs hold a ±0.15 band around their own targets.
- **Spread** ≤ 12% (roster ≤ 10%), **OI** ≥ 100 (lenient/autoPick mode: 50),
  **IV** ≤ 200%. Crossed quotes (bid > ask) are rejected outright.
- **Premium** ≤ max($35/share, 12% of spot) — price-aware.
- Composite quality (delta fit weighted hardest, then spread) must clear
  `PICKS_MIN_QUALITY` (0.45) or the name drops. Ship fewer picks rather than an
  untradeable contract.

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
| 0 | **Thesis tier is `weak`** | **none** | The grade cleared the bar but the case is thin / single-pillar → recommend *no trade*. Ship the grade + thesis as a watch idea (the "high grade but weak thesis → no strategy recommendation" rule). Exception: a tactical-tape put always gets a defined-risk structure. |
| 1 | IV **elevated** — `z ≥ PICKS_IV_CREDIT_Z_ELEVATED` (1.5σ) **OR** `pctile ≥ PICKS_IV_CREDIT_PCTILE` (60th) — **and** no imminent event/earnings | **credit vertical** | Premium is statistically expensive → *sell* it on the bias side (bullish → bull-put, bearish → bear-call); sell near-money, buy a further-OTM wing, targeting a credit ≈ ⅓ of the width. High IV mean-reverts and theta works for you. The **highly-elevated** band (`z ≥ PICKS_IV_CREDIT_Z` 2σ OR `pctile ≥ PICKS_IV_RICH` 80th) is the same structure, labelled as the strongest sell-premium case. The IV read is the spec's **OR** of the two measures (the z-score *or* the percentile — either qualifying counts). The **headline rule** — fires even at strong conviction. |
| 2 | Strong tier (`|total| ≥ 7`) **and** thesis tier `strong` **and** IV **not elevated** (neither z nor pctile in the credit band) + no event | **naked long** | **Rare.** Exceptional, multi-signal conviction *and* a strong thesis with low IV → a single long for max delta/gamma + uncapped upside. |
| 3 | Everything else — moderate conviction/thesis, **or** a strong view into elevated-but-event-blocked IV, **or** an imminent event/earnings | **debit vertical** | The default: long near-money financed by a short OTM wing (same side). Caps theta/vega + the premium at risk; defined-risk into events (a naked long eats the IV crush, a credit spread eats the gap). |

A binary **event/earnings within `PICKS_STRATEGY_EARNINGS_DAYS` (21d)** (or an active macro `eventRisk`) forces row 3 — defined-risk only, no naked long into the IV crush, no credit spread into the gap. A `none` pick carries **no contract** and is never enrolled in the track record (nothing to mark).

> **Why the book skews all-debit (and how to see it).** The active-macro-`eventRisk` half of that gate is the dominant reason the engine rarely actually *sells* premium: a market-wide print (NFP/CPI/FOMC) inside the 5-day window sets `eventRisk.active` for the **whole book**, diverting **every** elevated-IV name from row 1 (credit) to row 3 (a long-premium debit). Since macro prints cluster ~monthly, a large fraction of bakes ship all-debit even when the z-score flags premium as richest. `buildTopPicks` now records this every bake in `rosterMeta.strategyMix` (the structure mix shipped) + `rosterMeta.creditDeferred` (each elevated-IV name that shipped non-credit, tagged `why: "fallback"` vs `"event-defer"`). The **default-OFF** `PICKS_CREDIT_INTO_MACRO_EVENT=1` flag lets a *defined-risk* credit spread fire through a market-wide macro event (it benefits from the post-print IV crush) while still deferring single-name **earnings** and never relaxing the naked-long gate. Validate it on **resolved** picks before flipping — see §11.

`pickVerticalForPick(side, data, rfr, {type})` builds the two-leg contract:
- **debit** legs are the *same* type as the side (bull-call / bear-put): long
  ~0.55Δ near-money + short ~`PICKS_DEBIT_SHORT_DELTA` OTM wing. A candidate
  must clear `PICKS_DEBIT_MIN_RR` (1.0 — **reward:risk ≥ 1x**, i.e. the net
  debit can never exceed half the strike width) or it is rejected; a debit
  spread whose payout is under 1x the risk is never recommended.
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
take profit / stop on % of the credit (`PICKS_CREDIT_TP_PCT` / `_STOP_PCT`,
+50%/−50%), not the premium gates, and neither the theta stop nor the
scale-out/trail applies to them. The enrolled
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
   as the trailing record recovers. Tactical puts (the defensive side) keep the
   `PICKS_RISKOFF_PUT_BAR` and are unaffected. Off via `PICKS_EDGE_GATE=0`; the
   raised bar ships in `rosterMeta.edgeGate`/`tradeCut`.
2. **Drop names with an open tracked position** (re-entry suppression).
3. **Drop `avoid`-timed names.** (Steps 1–3 are the **DATA GATE** — they decide
   which names are *eligible*; the AI then grades only the **top
   `PICKS_MAX_AI_THESES` (10)** of them, ranked by conviction. The rest ship a
   deterministic-only card.)
4. **AI veto** — the AI final grade is `reject` (the thesis doesn't hold up even
   though the data cleared): drop the name (`rosterMeta.aiVetoed`).
5. **Require a tradeable contract** (else drop).
6. **Sector cap** ≤3 per sector + a correlation-factor cap (the tech/AI complex),
   ETFs uncapped; plus a per-side cap so the book isn't wildly one-way.
7. **Factor-trend gate** (`computeFactorTrendHealth`): the resolved track record's
   worst loss was a long-Tech/AI-call book wiped while the *broad* tape barely moved
   (SPY ≈ −1.5%, the picks ≈ −9.6%) — a factor-specific drawdown the broad
   SPY/QQQ/VIX regime can't see. So each correlated factor's **own** trend is
   measured from its members' bars (share below the 20D SMA + median confirmed 5-day
   return); when a factor is actively breaking down (`PICKS_FACTOR_WEAK_SHARE` ≥0.6
   below 20D **and** `PICKS_FACTOR_WEAK_RET5` median 5d ≤ −3%) **new long calls** in
   it are suppressed — only a strong-tier, `go`-timed call earns a reprieve. **Puts
   are unaffected** (a falling factor is fine to be short). Ships
   `rosterMeta.factorTrend` + `factorTrendGated`; off via `PICKS_FACTOR_TREND_GATE=0`.
8. **Rank by the AI final-grade score** (0–100; falls back to deterministic
   conviction when there's no AI grade — keyless/offline), ship up to 10. The rank
   order also governs which names survive the caps in steps 5–7.

**Sizing** (`applyPickSizing`): risk-based and conviction-tilted, normalized to a
gross target that **ramps with roster size** (a 1–2 name roster holds more cash)
and is scaled down by the regime de-gross and a realized-edge governor
(`computeEdgeScale` — cut gross when the trailing record's option expectancy is
negative). Each pick ships a `sizing` block (`weight`, `riskToStopPct`,
`suggestedContracts`) against a display-only `PICKS_DISPLAY_ACCOUNT`.

---

## 8. Exits (`buildExitPlan` / `resolvePickOutcome`)

- **Option-space (primary):** −30% stop on premium. At **+20%** the position
  **banks HALF at the marked price and arms a trailing stop on the runner** —
  floored at breakeven, ratcheting up to (peak − `PICKS_OPT_TRAIL_GIVEBACK_PCT`
  25pts) as the runner extends (`trail-stop`). The closed record blends the two
  halves (`0.5×banked + 0.5×exit`), so an armed trade can't round-trip to a net
  loss *at build-time marks* (an overnight/weekend gap can still print the
  runner below the floor and close the blend red) but the right tail is no
  longer amputated at +20%. Rationale: the old
  flat +20/−30 gates hard-capped every win at ~+20% while overnight/earnings
  gaps routinely marked losses far past −30% (the stop only executes at
  build-time marks) — a payoff needing a >60% win rate to break even.
  `PICKS_OPT_SCALE_OUT=0` restores the flat +20% take-profit. The plan still
  surfaces the **concrete contract price** for each gate off the entry mid
  (`optionStop`/`optionTp` + per-level `optionPrice`/`optionPct`/`entryPrem`):
  e.g. a $5.00 long → stop at **$3.50**, bank half at **$6.00**. Credit
  verticals keep **hard gates on the credit** (no scale-out — decay is the
  edge): +50% take-profit / **−50% stop** (buy-back ≈ 1.5× the credit; the old
  −100% default was a 2:1 inverted payoff vs the +50% TP). The credit exit
  ladder's stock-level rungs (`buildCreditExitPlan`): **cut** anchors at the
  short strike (a close beyond it starts realizing the loss) and **take-profit**
  at the delta-estimated *favorable* move that would collapse the buy-back to
  the +50% target — NOT the expiry breakeven, which sits on the adverse side of
  entry (shortK ∓ credit) and is not a profit target; it ships as an "Also exit
  if" context line instead. The real TP trigger is the SPREAD's buy-back price
  (theta gets there with no move at all).
- **Underlying (enforced):** stop at the deeper of structural support and a
  ~2.5×ATR floor (clamped 5–12%) so routine noise doesn't shake out a good
  entry — and this stock stop is **enforced in the track record**
  (`hit-stop-under`): the enrolled entry freezes `cut` (the short strike for a
  credit spread) and a spot close through it resolves the trade even when the
  modeled premium hasn't printed −30% at a mark. `PICKS_UNDERLYING_STOP=0`
  reverts it to display-only. The structural **take-profit** level stays
  advisory (enforcing it would truncate winners).
- **Thesis-based holding (no time stop, no pre-earnings exit):** a position is
  held — through earnings prints, past two weeks — for as long as its **original
  thesis stays intact and the contract hasn't expired**. The invalidation exit
  (status `thesis-broken`) fires off the per-mark thesis re-score
  (`thesisStatus`, §9): the live grade flips to the opposite actionable side,
  the frozen stop level is breached, or every supporting driver goes quiet.
  The old **14-day time stop** and the **pre-earnings exit** (≤2 days before a
  print) were retired — both force-closed trades whose thesis was still valid.
  A theta stop still cuts a dead-money bleeder (a vehicle failure, not a thesis
  call): ≥2.5%/day bleed, red, after 4 days held, non-credit only.

---

## 9. The feedback loop (accuracy / history / roster)

- `updatePicksAccuracyFile` enrolls every shipped **actionable** pick (`group ===
  "actionable"` — Strong grade + Strong thesis; lower-conviction watch ideas and
  tactical-tape puts are excluded, so the scorecard reflects only the trades the
  engine actually recommends), dedup per `symbol:side`, **capped at
  `PICKS_MAX_OPEN_POSITIONS` (20) concurrently-open positions** — each build ships
  ≤10 picks, but re-entry suppression surfaces NEW names every build while the
  already-enrolled ones stay open until an exit rule fires, so an uncapped book
  compounded past 25 intraweek; the cap enrolls in rank order and the rest wait
  for a freed slot —
  marks each to market on its **contract** every build (Black-Scholes), resolves
  on the exit rules above, and computes stats (`winRate`, option expectancy,
  option peak/dip `avgOptHiPct`/`avgOptLoPct`, `byTier`/`bySector`/`byRegime`).
  Each enrolled entry also **freezes a display snapshot at entry** — the
  `strategy` object (`type`/`label`/`reason`/`ivTier`/`fallback`, i.e. *why* the
  engine shipped this structure) plus the contract's `expiryLabel`, `breakeven`,
  and per-leg `shortMid`/`longMid` on verticals — which powers the Track Record
  tab's per-pick **"Strategy & entry details"** disclosure (`accStrategyBlock` in
  `app-js.mjs`: the trade as taken, per-leg buy-in prices, entry cost per
  contract, greeks/PoP at entry, and the modeled value now / at exit). Legacy
  entries without the snapshot derive a structure name client-side and drop the
  missing rows.
  Two guards protect the marking loop: a **corporate-action guard**
  (`detectSplitFactor` + `applySplitToEntry` — a split between marks would
  reprice the frozen pre-split contract on the post-split tape, marking an ATM
  long −100% and a put +huge, both phantom; a spot gap matching a standard
  split ratio, corroborated by the back-adjusted price history, rescales the
  frozen dollar basis instead, exactly like the OCC adjustment, and stamps
  `corpActions` on the entry) and a **transient-miss guard** (a ticker absent
  from one build's chains — the bake tolerates up to 25% Yahoo fetch misses —
  carries its last mark forward and only resolves `dropped` after
  `PICKS_DROPPED_MIN_MISSES` consecutive misses; an unmarkable resolution is
  `void` on EVERY exit path — never counted as a win or a loss). **There is no
  weekly reset**: the record accumulates and open positions are never
  force-closed at a week boundary — every trade rides until one of the exit
  rules above fires (the old weekly reset, which force-closed the open book at
  its marks with status `reset`, was retired along with the time stop; legacy
  `reset`/`timed-out`/`pre-earnings` rows may still appear in the closed
  history until they age out). To restart the record after a strategy change,
  use `scripts/wipe-history.mjs`. **The Track Record tab shows only this contract (option)
  scorecard** — the win/loss already resolves on the modeled option P&L, and the
  stock-move chips (stock expectancy, vs-SPY, stock peak/dip) were dropped; the
  generic stock win-rate chip remains only as a fallback for legacy pre-snapshot data.
- **Thesis tracking:** each pick ships a structured `thesisCard` (`buildThesisCard`).
  Its core is the **everything-aware AI thesis** (`thesisCard.ai`, from
  `generateAiTheses`), written as a data-woven **narrative arc** (the gold-thesis
  gold standard — it must *complement* the grade, not restate it, and weave the
  actual numbers into the prose): a 1–2-sentence **`summary`**, then the story —
  **`setup`** (the backdrop: what's been driving the name and where price/sentiment
  stand), **`catalyst`** (what is changing *now* that creates the edge today, cause
  → effect), **`confirmation`** (2–4 observable signals the thesis is already
  playing out), **`outlook`** (the forward expectation over the ~1–2-week horizon) —
  plus the **`drivers`** it judged load-bearing, an **`invalidation`** list (3–4
  specific, observable conditions), a **`strategyRationale`** that justifies the
  option structure from the IV environment (elevated IV → sell premium /
  defined-risk; cheap IV → buy a debit; defined-risk into events), a **`macroRead`**
  + **`macroSupport`** verdict, and the AI's own **`confidence`**. The system prompt
  carries two **gold-standard reference theses** (`THESIS_GOLD_EXAMPLES` — a bearish
  oil-producer read and a bearish gold read) plus the *"what makes a good thesis"*
  framework (clear, cause→effect, specific, testable, actionable; complement the
  grade) so every grade is held to that bar — the oil example also models the
  IV→structure logic (debit when IV is reasonable; the gold example sells a credit
  spread because gold IV is rich). (A bumped
  `THESIS_PROMPT_VERSION` in the cache signature re-reads every cached thesis once
  on a schema/prompt change; legacy `reasoning`-only payloads still render.) It is fed the
  WHOLE picture per name — the scored signals, company fundamentals, the AI news
  take + fundamental judgment + headlines + catalysts, the full cross-asset macro
  backdrop (rates / dollar / Fed / inflation / geopolitics) with the name's
  macro-kind sensitivity, and the IV regime — and DECIDES which factors matter (so a
  consumer-discretionary name reads rates + inflation via consumer spending; a
  semi reads long yields + the dollar; an energy name reads crude). It is generated
  for the **top `PICKS_MAX_AI_THESES` (default 10) names that cleared the DATA GATE**
  — ranked by deterministic conviction (the bar + the cheap re-entry / avoid-timing
  screens) so the grader spends tokens only on names that can realistically make the
  actionable roster; lower-conviction survivors ship deterministic-only. From there
  the AI is the **FINAL
  GRADER**: alongside the narrative it returns a final `grade`
  (`strong`/`moderate`/`weak`/`reject`) + a 0–100 `score` + a `gradeReason`. That
  grade is **authoritative** — it sets the execution matrix (§9a), ranks the roster
  by score, and a `reject` **vetoes** a name that cleared the data screen but whose
  thesis doesn't hold up. The deterministic scaffolding remains the keyless/offline
  fallback: the
  **`marketRead`** (`buildMarketRead`) — which the AI read **replaces** when present
  and otherwise falls back to a **`MACRO_PROFILES`** sensitivity table that maps
  every name in the universe (`macroKindOf`) to one of ~30 fine-grained kinds, each
  with the cross-asset axes that genuinely drive it + a plain-English causal note:
  the tech complex splits into mega-cap / semiconductors / software / AI-infra /
  enterprise; financials into banks / brokers / payments / asset-managers; consumer
  into discretionary-goods / restaurants / media / services; healthcare into pharma
  / insurers / devices; plus space (risk-appetite + cost-of-capital), long bonds
  (pure duration), long-vol (inverse to risk), gold, homebuilders, energy, etc. —
  so no name shares a wrong macro read (only the broad-market index ETFs are
  `broad`) — plus the synthesised **`edge`** (`buildEdgeStatement`), the supporting
  `works` split into **`companyDrivers`** / **`confirmation`**, the structural
  `invalidators` (price stop / thesis break / grade-flip — no time stop; the AI's
  thesis-level invalidators lead when present), the **`strategy`** rationale (kept deterministic —
  it is IV-mechanics, not narrative), the **`thesisQuality`** (`{ score, tier,
  checklist }`, §9a) + matrix **`classification` / `group`**, a `conviction` label,
  **`hasSolidThesis`**, and the honest **`disclosure`**. The AI thesis degrades
  gracefully without `GEMINI_API_KEY` (the deterministic `marketRead` + card stand
  alone) and is cached per `symbol:side` in `pick-thesis-cache.json` on a signature
  that turns over with the grade, the drivers, the relevant macro axes, the news
  take, and the IV bucket (read-before-wipe / write-after, **not** written by the
  offline `regen-picks`). The browser renders a **scannable head** (the AI summary
  + classification badge + strategy chip *or* "no recommendation" note + conviction
  + the AI confidence + disclosure) and a collapsed **"Expand for full reasoning"**
  with the detailed thesis + the structured sections + the quality checklist. A
  compact snapshot is frozen on the enrolled `open`
  entry (contract-bearing picks only); every later build re-scores it against the
  **live grade** into `thesisStatus` (on-track / mixed / broken). A `broken`
  verdict is not just display — it fires the track record's `thesis-broken`
  exit (§8): with the time stop and pre-earnings exit retired, the thesis
  re-score is what bounds how long a trade can be held.

### 9a. Thesis quality + the execution matrix

The grade says *how strong the signal is*; the **thesis quality**
(`assessThesisQuality`, exported) says *whether there's a clear, multi-factor,
testable, strategy-coherent case behind it*. It sums an auditable **0..8 points**
rubric — a clear driver (0/1/2), technical/flow confirmation (0/1/2), multi-pillar
alignment (0/1/2), a non-fighting tape (−1/0/+1), and signal-specific invalidation
(0/1) — into a **tier**: `strong` (passes every hard gate **and** `score ≥
PICKS_THESIS_STRONG_SCORE`), `moderate` (a real but not airtight case, `score ≥
PICKS_THESIS_MOD_SCORE` + multi-pillar), or `weak` (thin / single-pillar). This
deterministic rubric is the **keyless/offline fallback**. When an AI thesis exists
(the normal keyed build), the **AI's final `grade` is authoritative** and
`applyAiThesisGrade` overlays it onto the assessment — its tier replaces the
deterministic tier in the matrix below and its 0–100 `score` ranks the roster (a
`reject` grade is handled upstream as a veto and never reaches the matrix). So the
AI is the final grader for which names ship, how they're classified, and in what
order. The **data grade stays AI-free** (deterministic 4-pillar score → direction +
conviction — it is the *entry gate*), as does the **structure** selection.

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

The **data grade is deterministic — no AI** (direction + conviction + the trade
structure). The AI enters **after** the data gate as the **final grader**: it writes
the thesis narrative AND assigns the final grade (`strong`/`moderate`/`weak`/`reject`
+ score) that sets classification, ranks the roster, and vetoes a `reject` (§9 / §9a).
It degrades gracefully without `GEMINI_API_KEY` — the deterministic rubric stands in
as the fallback grade, so the engine still grades, gates, and ships a full card.

---

## 10. The constants you'll reach for

All in the `// TOP PICKS ENGINE` constant block at the top of the engine:

| Knob | Default | Effect |
|---|---|---|
| `PICKS_MIN_CONVICTION` / `PICKS_TIER_STRONG` | 4 / 7 | actionable / strong grade bars |
| `PICKS_THESIS_STRONG_SCORE` / `_MOD_SCORE` | 5 / 3 | thesis-quality bars (strong / moderate tier) |
| `PICKS_EDGE_GATE_SOFT` / `_HARD` / `_MIN_N` | −8 / −15 / 12 | edge-governed bar: raise the actionable cut toward Strong when the realized option edge is this negative (after this many decided closes) |
| `PICKS_COUNT` / `PICKS_WATCH_COUNT` | 10 / 6 | max Actionable / max Ideas·Watch roster size |
| `PICKS_MAX_AI_THESES` | 10 | only the best N data-gate survivors (by conviction) get an AI thesis + final grade; the rest ship deterministic-only |
| `PICKS_MAX_PER_SECTOR` | 3 | correlation cap |
| `PICKS_MAX_PER_FACTOR` | 5 | tech/AI-complex correlation cap |
| `PICKS_FACTOR_WEAK_SHARE` / `PICKS_FACTOR_WEAK_RET5` | 0.6 / −3 | factor-trend gate: suppress new calls in a rolling-over factor |
| `PICKS_OPT_TP_PCT` / `PICKS_OPT_STOP_PCT` | 0.20 / 0.30 | +20% banks half + arms the trail / −30% stop |
| `PICKS_OPT_SCALE_OUT` | on | scale-out + trail at the TP (0 = legacy flat +20% take-profit) |
| `PICKS_OPT_TRAIL_GIVEBACK_PCT` | 0.25 | runner trail: stop = max(breakeven, peak − 25pts) |
| `PICKS_UNDERLYING_STOP` | on | enforce the exit ladder's stock stop in the track record (`hit-stop-under`) |
| `PICKS_MAX_OPEN_POSITIONS` | 20 | hard cap on the concurrently-tracked open book (enrollment walks the roster in rank order; excess picks wait for a slot) |
| `PICKS_SPLIT_RATIOS` / `PICKS_SPLIT_TOL` | 1.5…20 / 0.04 | corporate-action guard: a mark-to-mark spot gap matching a standard split ratio (confirmed against the back-adjusted bars) rescales the frozen entry basis instead of marking a phantom ±100% (`detectSplitFactor`/`applySplitToEntry`; the entry records `corpActions`) |
| `PICKS_DROPPED_MIN_MISSES` | 3 | consecutive builds a ticker must be missing from the chains before an open position resolves `dropped` (a single Yahoo flake carries the last mark forward instead); a drop with no mark at all resolves `void` — excluded from win/loss stats |
| `PICKS_DELTA_MIN/MAX/IDEAL` | 0.45 / 0.65 / 0.55 | contract moneyness |
| `PICKS_MIN_DTE` / `PICKS_MAX_DTE` | 14 / 60 | contract clock |
| `PICKS_STRATEGY_AUTO` | on | structure auto-select (off = always naked long) |
| `PICKS_IV_CREDIT_Z_ELEVATED` / `PICKS_IV_CREDIT_PCTILE` | 1.5 / 60 | **elevated** IV → credit (broadened band: z≥1.5σ OR ≥60th pctile) |
| `PICKS_IV_CREDIT_Z` / `PICKS_IV_RICH` | 2.0 / 80 | **highly-elevated** IV labels (z≥2σ / ≥80th) |
| (naked IV gate) | not elevated | naked needs IV **not** in the credit band (the spec's "IV Rank < 60") **and** a strong grade + strong thesis |
| `PICKS_CREDIT_WIDTH_FRAC` / `_MIN` | 0.34 / 0.22 | credit-spread target / floor (credit ÷ width) |
| `PICKS_CREDIT_TP_PCT` / `_STOP_PCT` | 0.50 / 0.50 | credit-spread exits (% of the credit; stop = buy-back ≈1.5×) |
| `PICKS_GROSS_TARGET` | 0.80 | deployed gross (rest cash) |
| `PICKS_REGIME_TILT` | 2 (4 severe) | risk-off bearish tilt |

---

## 11. Verifying a change

There is no live `data/` in a fresh checkout, so the engine is exercised by a
synthetic smoke test: `node scripts/picks-smoke.mjs` (asserts grades, timing
gates, contract selection, caps, re-entry suppression, the regime tilt, exits,
and every output shape the UI reads). To regenerate from a hydrated `data/`
(`node scripts/sync-data.mjs pull`), run `node scripts/regen-picks.mjs`.

> **Retune gates on *resolved* picks, not day-1 marks.** An open position is marked
> the session it's entered, so its visible P/L is `netDelta × one-session move ÷ a
> cheap debit` — pure leverage of intraday noise, and **symmetric across winners and
> losers** (the same mechanic that shows a −18% red row shows a +17% green one). Do
> **not** tune a scoring/timing/regime/structure constant to shrink a day's red rows:
> it is fitting noise, and the identical mechanic produced that day's green rows.
> Only **correctness** fixes (a wrong sign, a wrong unit) and pure instrumentation are
> safe to ship on a single session; everything tunable waits for ~20–30 **closed**
> picks. When you do A/B a change, diff two `regen-picks` runs on the **same** `data/`
> (stash the edit → run → restore → run), not the bake's `grades.json` (which carries
> AI-thesis overlays + newer data and will mask your change). `scripts/diagnose-pick-losses.mjs`
> decomposes resolved losses into direction vs theta/vol for exactly this purpose —
> note the attribution is **hold-time aware**: a flat-stock loss closed inside
> `MIN_THETA_DAYS` (2 calendar days — roster churn; legacy weekly-reset /
> pre-earnings rows) is bucketed as a **forced early close**, not theta, and excluded from the
> direction-vs-theta verdict (the site's Track Record Summary mirrors this via
> `ACC_MIN_THETA_DAYS` in `app-js.mjs`). The engine's actual theta-stop exit only
> fires after `PICKS_THETA_STOP_MIN_HOLD` (4) days held at a ≥2.5%/day bleed.

---

## 12. Pointers

- Engine: the `// TOP PICKS ENGINE` block in `scripts/build.mjs`.
- Offline rebuild: `scripts/regen-picks.mjs`. Smoke test: `scripts/picks-smoke.mjs`.
- Browser render: `loadPicks`/`renderPicks` + the grade-search + Track-record
  views in `scripts/render/app-js.mjs` (read `picks.json` / `grades.json` /
  `picks-accuracy.json` / `picks-roster.json` / `picks-changes.json`).
