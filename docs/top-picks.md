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

## 7. Roster construction (`buildTopPicks`)

1. Candidates = grade actionable (`|total| ≥ 4`), or a tactical put in a confirmed
   risk-off tape.
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
  asymmetric. The instant the modeled mark hits a gate, the pick resolves.
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
  `byTier`/`bySector`/`byRegime`). The record **resets weekly** so the numbers
  reflect the current engine, not a tail of pre-tuning outcomes.
- **Thesis tracking:** each pick ships a structured `thesisCard` (`buildThesisCard`)
  — `works` (the supporting drivers + their pillar/reading), `invalidators` (each
  lead driver reversing, plus the ATR price stop, the 14-day time stop, and a
  grade-flip trigger for marginal scores), and the `target` plan. A compact
  snapshot is frozen on the enrolled `open` entry; every later build re-scores it
  against the **live grade** into `thesisStatus` (`verdict` on-track / mixed /
  broken from direction-adjusted price progress + how many entry drivers are
  still firing + a grade-flip / stop-breach check). The pick card renders the
  thesis and, for an open position, the playing-out status.
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
| `PICKS_MIN_CONVICTION` / `PICKS_TIER_STRONG` | 4 / 7 | actionable / strong bars |
| `PICKS_COUNT` | 10 | max roster size |
| `PICKS_MAX_PER_SECTOR` | 3 | correlation cap |
| `PICKS_MAX_PER_FACTOR` | 5 | tech/AI-complex correlation cap |
| `PICKS_FACTOR_WEAK_SHARE` / `PICKS_FACTOR_WEAK_RET5` | 0.6 / −3 | factor-trend gate: suppress new calls in a rolling-over factor |
| `PICKS_OPT_TP_PCT` / `PICKS_OPT_STOP_PCT` | 0.20 / 0.30 | option exits |
| `PICKS_MAX_HOLD_DAYS` | 14 | time stop (two weeks) |
| `PICKS_DELTA_MIN/MAX/IDEAL` | 0.45 / 0.65 / 0.55 | contract moneyness |
| `PICKS_MIN_DTE` / `PICKS_MAX_DTE` | 14 / 60 | contract clock |
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
