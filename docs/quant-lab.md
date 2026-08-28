# Owner Lab — private controls and deterministic quant screens

**Status: live.** Feed: `data/quant.json` (rebuilt fresh every bake) +
`data/quant-history.json` (per-ET-day accumulator, read-before-wipe). Both
PREMIUM keys (`lib/premium-keys.mjs`). Engine: the `QUANT LAB` block in
`scripts/build.mjs` (after the Trending-IV section). Tab id `quant`, its own
"Owner" nav group. Backtest harness: `scripts/diagnose-pairs.mjs`.

The combined-role workspace also houses every Owner control that consumes a
real holding, dollar baseline, account value, or max-loss budget: the live
held-option checker, personalized VOO/QQQ DCA dollars, Sector Rotation share
caps, and Leveraged ETF share caps. Their standardized research remains in the
broader Owner workspace; account-specific application remains isolated here.

The same owner-only workspace also keeps a parked **paper** Day Trading Engine
in-tree (`docs/day-trading-engine.md`). It is retired from the live Owner UI
and its 15-minute schedule is disabled; it does not change the analytical-only
contract of `quant.json` or any screen documented below.

## 1. Owner directive — analytical screens, never trade signals

Same rule as the Event Spillover Matrix (`docs/event-spillover.md`): every
number this feature ships is a **statistical observation about the tape**, not
a recommendation. No row tells anyone to buy or sell anything; the
situation→action "playbook" table on the tab is a static educational artifact
describing what quants classically do with each situation, prominently
disclaimed. Any future promotion of a screen toward actionability must first
clear the `diagnose-pairs.mjs` backtest (§9).

## 2. Regime conditioning (2026-07-20)

Every bake first classifies the tape on **four regimes** (`buildQuantRegime`,
exported; all from data already in memory — no new fetches):

| Regime | Inputs | States |
|---|---|---|
| Volatility | VIX level + trend + term structure (macroBackdrop) AND SPY 20d realized vol — either half alone suffices (`vol.basis` discloses which), so the read degrades to RV-only when the macro fetch flaked | `low` / `normal` / `high` (VIX ≥ 25 ∨ RV ≥ 20) / `crisis` (VIX ≥ 30 ∨ RV ≥ 30 ∨ VIX ≥ 25 with an inverted term structure) / `unknown` |
| Trend vs range | SPY 60-session Kaufman efficiency ratio (≥ 0.35 = trending, `quantEfficiencyRatio` exported) OR monotone higher-highs+higher-lows (or lower/lower) across the window's three 20-session thirds, close-based | `trending` (+direction) / `range` / `unknown` |
| Risk-on/off | `macroBackdrop.macroRegime.state` — the Market Analysis tape, threaded in from `main()` (the quant step MOVED after `computeMacroRegime` for this) | the tape's states / `unknown` offline |
| Earnings-heavy | share of tracked non-ETF names with `nextEarningsDate` inside 14 calendar days (≥ 20% = heavy) | `heavy` / `quiet` / `unknown` |

The regime selects each screen's **badge bars from a fixed per-regime table**
(`thresholds` in the payload — never continuous adaptive scaling, and rows are
NEVER hidden by regime, only badged/re-ordered):

- **Sigma**: both inclusion and the `priority` ("extreme") badge require a
  fixed absolute z20 or return z-score of at least 3.0 in every regime. The
  screen intentionally stays sparse rather than filling with lower-sigma
  context rows.
- **VRP**: the rich/cheap badge bar `richZ` is 2.0 in high/crisis vol (a fat
  premium is normal there), 1.5 otherwise.
- **Pairs**: the "stretched" read bar `showZ` is 2.5 in high/crisis vol
  (spreads are mechanically noisier), 1.75 in low-vol + range-bound tape,
  2.0 otherwise. Rows still ship from 1σ regardless.
- **Surface**: inversions are down-weighted (a client-side note) when the
  regime is earnings-heavy or high/crisis vol; independently, each row inside
  35 days of its OWN print carries `eventSoon` + `evtDate` — the client badges
  it "earnings" and sorts it after unexplained inversions.

The whole regime block ships in `quant.json` (`regime`) so the UI's strip can
show the states, the inputs and the bars in force — auditable, like the rest.

## 3. What ships, and from what data

Everything below is computed from data the bake already collects — no new
fetches, no AI, no cross-sectional normalization (fixed formulas + documented
windows, the picks-engine philosophy).

| Screen | Inputs | Key math |
|---|---|---|
| Aggregate ideas (confluence) | `unusual.json` + `volume-flags.json` (scanner-owned, preserved across the wipe) + the just-written streaks map + Trending-IV payload | cross-reference of four **independent** flow screens: top-10 unusual prints by this-hour `deltaPremium` (day `premium` fallback — the Unusual tab's "Top print" basis), top-10 genuinely-flagged volume names by best hourly/EOD ratio (confirmed S/R breaks included), fresh streaks (`sameDays ≥ 2 ∧ days ≤ 3`), and rising IV (surging tier ∨ `chg5dPct ≥ 20` ∨ `risingStreak ≥ 5` — the Trending-IV conventions). A name on ≥2 screens ships; ≥3 = the `qualified` badge; `lean` reported only when the directional screens (flow side, streak color, S/R-break direction / volume-day move) unanimously agree, else `mixed`; IV never votes (magnitude-only). Scanner sources carry per-source `asOf` + `stale` stamps (they can lag the bake by an hour, or a session pre-scan) — `buildQuantConfluence` (exported) |
| Sigma deviations | `priceSeries`/`_bars` (252d closes), chain ATM IV | `z20 = (close − SMA20)/σ20` (population σ, Bollinger convention); `retZ = (ln-return − mean)/σ` of the **prior** 20 daily log returns (today's outlier can't inflate its own σ); a row ships only when `|z20| ≥ 3` or `|retZ| ≥ 3`; expected move `k·S·IV·√(days/365)` for 1wk/1mo, k∈{1,2}; earnings move = `0.85 ×` ATM-straddle mid (`computeImpliedMoveForDate`; the 0.85 quick-read convention applies **only here**) |
| Vol risk premium | `iv-history/` (~18mo ATM ~30d IV) × rolling 30d RV from closes | `vrp_d = iv_d − RV30(closes ≤ d)`; series depth ≈ min(iv n, 252−31) ≈ 220 — derived **retroactively**, no new accumulation; today's z + midrank percentile vs that series; requires n ≥ 60 |
| Pairs (2026-07-20 methodology rework) | within-`INDUSTRY_OF_TICKER` groups (singleton industries pool by fine `SECTORS` label; ETFs excluded), aligned closes + joined iv-history | gate: 120d return corr ≥ 0.60 (no all-vs-all dredging, unchanged). **Hedge ratio + cointegration**: `quantEngleGranger` (exported) on the FULL joined window (~252 bars) — OLS lnA = α + β·lnB, ADF(1) on the residual, τ vs the MacKinnon 5% bar −3.34 → the `eg.ok` badge; needs ≥ 200 joined closes, and a non-positive β is treated as no usable hedge. **The spread is now lnA − β·lnB** (`hedged:true`; raw log ratio = the honest fallback below 200 obs): `pxZ`/`halfLife`/`mrOk` = the 60d z + AR(1) read on that spread (half-life bar 30), `pxZ1y`/`halfLife1y`/`mrOk1y` = the same on the full ~1y window (bar 60) — some pairs only mean-revert on one horizon. **β drift**: β re-estimated on the trailing 120d (`beta120`, `betaDriftPct` — client warns ≥ 25%). **Stability**: `stable` = return corr ≥ 0.5 on the 60d AND full windows too (null until ~200 obs). **Match quality** (`match`, informational only): SPY-beta gap (120d) ≤ 0.4/0.8, log10-mcap gap ≤ 1/1.7, 120d momentum gap ≤ 25/50pp, both legs ≥ $25M avg daily dollar volume → good/fair/poor (`quantPairFactors` computes the per-name snapshot once per build). `ivZ` = IV-spread (A−B) z vs its 120d norm, ≥ 60 joined obs (unchanged). The "stretched" read wording uses the regime `showZ` |
| Vol surface | today's chain (±50% strikes × 14 expirations, per-row IV) + accumulated `s`/`t` iv-history fields | slope = ATM IV(~90d) − ATM IV(~30d) via `computeAtmIvForDte` (negative = backwardation/near-term stress); `skew25` = IV(25Δ put) − IV(25Δ call) at the ~30d expiry (`computeSkew25`, delta via `lib/greeks.mjs` off each row's own IV, ±10%-moneyness fallback); z-scores vs the name's own accumulated history, null until ≥ 60 sessions — **self-activating, no code change** |
| Dispersion | SPY ATM IV + top-50 tracked non-ETF names by `fundamentals.marketCap` | implied correlation proxy `ρ ≈ σ_SPY² / (Σ wᵢσᵢ)²`, clipped [0,1]. **Labeled a proxy everywhere**: the tracked universe is not the S&P 500 — direction + percentile are the signal, never the level. Percentile activates once quant-history has ≥ 60 days |
| Post-earnings drift | `earnings-history.json` + closes | names within 10 sessions of a print: realized reaction, drift since the reaction close, and the name's own historical week-1 drift split by beat (surprise > +1%) vs miss (< −1%) |

Units convention: **all vol numbers ship as percentage points** (24.1 =
24.1%), z-scores as plain 2dp numbers — the client never guesses units.

## 4. The iv-history `s`/`t` extension (surface accumulation)

`collectIvHistory` now stamps two optional fields into each day's entry:
`s` = 25Δ skew, `t` = term slope (~90d − ~30d ATM). Additive by design —
`attachIvRanks`, `buildIvTrendingPayload`, and every other reader touch only
`.iv`. Zero new store objects (rides the existing per-ticker files). After
~60 sessions (~3 months) the surface screen's `slopeZ`/`skewZ` and the UI's
"collecting (n/60)" placeholders flip to live z-scores automatically.

## 5. Feed shapes

`data/quant.json` (premium, ~60–120 KB at full universe):
`{ builtAtIso, date, minHist, regime:{asOf,vol,trend,risk,earnings,thresholds},
confluence:{minSignals,qualifiedMin,sources,rows},
sigma:{showZ,retZ,priZ20,priRetZ,rows}, vrp:{minN,richZ,mktVrp,rows},
pairs:{window,corrMin,halfLifeMax,halfLifeMaxLong,showZ,egMinN,egCrit,stableCorr,tested,rows},
surface:{farDte,skewDelta,eventDays,downweightInversions,rows},
dispersion, ped:{windowSessions,rows}, coverage:{notFeasible,existing} }` —
row shapes in `buildQuant*` (build.mjs). Only names at/near an extreme ship in
`sigma` (each row carries `priority`, the regime-adjusted extreme flag);
`pairs` ships rows with max(|pxZ|,|ivZ|) ≥ 1, capped at 80 (each row now also
carries `corr60/corrFull/stable`, `hedged/hedgeBeta/beta120/betaDriftPct`,
`eg:{tau,ok,n,crit}`, `pxZ1y/halfLife1y/mrOk1y` and
`match:{betaGap,sizeGap,momGap,liqOk,grade}`). Confluence
rows: `{ t, sector, spot, count, qualified, lean, flow, volume, streak, iv }`
(per-signal detail objects, null when that screen didn't fire), capped at 40;
`sources` carries each feed's availability/`asOf`/`stale` stamp so the UI never
pretends the four reads are simultaneous. The bake threads the sources in via
`buildQuantPayload`'s trailing `confluenceSources` param, and macroBackdrop via
the param after it (which is why the quant step in `main()` sits AFTER
`computeMacroRegime`) — offline callers (diagnose harness) omit both and get an
empty-rows confluence block + a degraded per-axis regime with base thresholds.

`data/quant-history.json` (premium, read-before-wipe, cap 500 days):
`{ days: [{ d, impliedCorr, idxIv, basketIv, mktVrp }] }` — upserted per ET
day; powers the dispersion percentile.

## 6. Overlap policy — link, don't duplicate

Event read-through pair betas → **Event spillover** tab. Season-wide earnings
stats → **Earnings tracker**. IV momentum/elevation → **Trending IV**. Price-dip
shares screen → **Stock Picks**. The Quant Lab's coverage card points at each.
The Aggregate-ideas screen is the deliberate exception: it does not re-derive
any of those signals — it *joins* the already-computed flow/volume/streak/IV
outputs by ticker and reports only the cross-reference (each row's cells link
back to the numbers the source tabs already show).

## 7. Honestly out of scope (no data source)

Surfaced in the tab's coverage card rather than faked: M&A / spin-off screens
(no deal data), index add/delete prediction (no committee/flow data),
gamma-scalping simulation (needs intraday hedging data), Johansen / multi-year
cointegration (priceSeries carries ~1 year of bars — Engle-Granger runs on a
single 1-year window, labeled as such, and Johansen adds nothing for 2-asset
pairs), stock-borrow availability / borrow-fee screens (no borrow data
source), alt-data earnings nowcasts (no satellite/card/web feeds). Adding any
of these requires a new data source first.

## 8. Client

`loadQuant`/`renderQuant` in `scripts/render/app-js.mjs` (spillover-loader
pattern; one fetch of `quant.json`); section chrome + the static playbook and
coverage cards in `html.mjs` (`quantSection`); `.quant-*` styles. Owner
wiring: `OWNER_TABS.quant`, the Top Picks owner role (minting combined `tr` +
`tp` compatibility claims), `PAGE_TAB_IDS`, aliases
(`quant-lab`, `pairs`, `pair-trading`, `sigma`, `vrp`, `dispersion`), the
selectTab lazy-load hook, and `.quant-sym` in the `bindBriefChips` selector so
every ticker deep-links to Grade. The regime renders as a chip strip at the
top (`.quant-regime`, tooltips carry the inputs, `.quant-reg-bars` lists the
bars in force); regime-adjusted badges: `.quant-pri` (sigma extreme / VRP
rich/cheap), `.quant-deprio` rows, `.quant-eg-ok`/`.quant-eg-no`,
`.quant-stab-*`, `.quant-match-*`, `.quant-evt` (surface earnings flag). A
payload from BEFORE this rework (no `regime`/`hedged` fields) renders without
the strip and with fallback column values — no crash window across the
cutover bake.

## 9. Validation — `scripts/diagnose-pairs.mjs`

Read-only, mirrors the live tunables exactly. (1) **Pair convergence**: every
fresh ±2σ excursion of the 60d ratio z → did it revert to ≤0.5σ within 20
sessions, σ-units captured, split by the `mrOk` badge (the badge must beat the
no-MR cohort to earn its place) + per-industry breakdown — and now ALSO split
by the **retro regime at entry** (SPY trailing RV20 for the vol level and
ER60 + monotone thirds for trend/range — the same bars `buildQuantRegime`
uses, minus VIX, which isn't persisted per-day; the conditioning claim —
mean-reversion works best calm/range-bound — must show up in these buckets to
earn the regime-adjusted bars). (1b) **Hedged-spread convergence**: the same
walk on the reworked live spread — β re-estimated daily from the trailing
≤250 sessions (no lookahead), ±2σ entries on the trailing 60d z, forward walk
with β frozen at entry — split by the EG cointegration badge at entry (the
badge must beat the not-cointegrated cohort). (2) **VRP reversion**:
expanding-window (no-lookahead) z; 10-session Δvrp after rich/cheap readings,
hit rates + t-stats (overlapping daily observations inflate the t-stats —
read directionally), with the rich side also split by retro vol regime (does
rich-in-high-vol compress less reliably, as the raised bar assumes?).
Degrades to "insufficient sample". **This harness is the gate**: no screen
graduates past "analytical map" without it.

## 10. Known limitations

- The VRP z uses the full derived series (matches `attachIvRanks`' convention)
  while the diagnose harness uses expanding windows — the live read has mild
  in-sample bias by construction; acceptable for a screen, disclosed here.
- Pair candidates never cross industry groups, so genuinely correlated
  cross-industry pairs (e.g. a supplier/customer link) are invisible by design
  — deliberate dredging control, revisit only with a stronger multiple-testing
  correction (the spillover engine's BH-FDR machinery is available).
- `impliedMovePct` elsewhere in the site stays the RAW straddle number; the
  0.85× quick-read applies only inside the Quant Lab's expected-move cells and
  is labeled (`~±`).
- Weekend/holiday builds: today's iv entry may not match a bar date, so the
  VRP "current" read is the last joined session — by design (stale quotes
  would otherwise fabricate a fresh spread).
- The Engle-Granger test runs on ONE year of closes (all priceSeries
  carries) — short for EG, which is why `eg.ok` is a badge beside the AR(1)
  read, never a row gate, and why the τ bar is the n≈250 MacKinnon value.
  The EG regression β also anchors the shipped spread, so a regime where the
  hedge ratio genuinely moved mid-year shows up as `betaDriftPct` rather
  than a re-estimated spread.
- The diagnose harness's retro regime classification has no VIX half (VIX
  isn't persisted per-day) — its vol buckets are SPY-RV-only, slightly
  laggier than the live regime's VIX+RV read. Disclosed in the section
  output.
- The regime's risk axis resets every build with `computeMacroRegime` (no
  persistence) and reads "unknown" offline — thresholds then fall back to
  base values, so the offline harness always validates against the
  unconditioned bars.
