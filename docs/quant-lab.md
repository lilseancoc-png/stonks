# Quant Lab — deterministic quant screens (premium tab)

**Status: live.** Feed: `data/quant.json` (rebuilt fresh every bake) +
`data/quant-history.json` (per-ET-day accumulator, read-before-wipe). Both
PREMIUM keys (`lib/premium-keys.mjs`). Engine: the `QUANT LAB` block in
`scripts/build.mjs` (after the Trending-IV section). Tab id `quant`, its own
"Quant" nav group. Backtest harness: `scripts/diagnose-pairs.mjs`.

## 1. Owner directive — analytical screens, never trade signals

Same rule as the Event Spillover Matrix (`docs/event-spillover.md`): every
number this feature ships is a **statistical observation about the tape**, not
a recommendation. No row tells anyone to buy or sell anything; the
situation→action "playbook" table on the tab is a static educational artifact
describing what quants classically do with each situation, prominently
disclaimed. Any future promotion of a screen toward actionability must first
clear the `diagnose-pairs.mjs` backtest (§8).

## 2. What ships, and from what data

Everything below is computed from data the bake already collects — no new
fetches, no AI, no cross-sectional normalization (fixed formulas + documented
windows, the picks-engine philosophy).

| Screen | Inputs | Key math |
|---|---|---|
| Aggregate ideas (confluence) | `unusual.json` + `volume-flags.json` (scanner-owned, preserved across the wipe) + the just-written streaks map + Trending-IV payload | cross-reference of four **independent** flow screens: top-10 unusual prints by this-hour `deltaPremium` (day `premium` fallback — the Unusual tab's "Top print" basis), top-10 genuinely-flagged volume names by best hourly/EOD ratio (confirmed S/R breaks included), fresh streaks (`sameDays ≥ 2 ∧ days ≤ 3`), and rising IV (surging tier ∨ `chg5dPct ≥ 20` ∨ `risingStreak ≥ 5` — the Trending-IV conventions). A name on ≥2 screens ships; ≥3 = the `qualified` badge; `lean` reported only when the directional screens (flow side, streak color, S/R-break direction / volume-day move) unanimously agree, else `mixed`; IV never votes (magnitude-only). Scanner sources carry per-source `asOf` + `stale` stamps (they can lag the bake by an hour, or a session pre-scan) — `buildQuantConfluence` (exported) |
| Sigma deviations | `priceSeries`/`_bars` (252d closes), chain ATM IV | `z20 = (close − SMA20)/σ20` (population σ, Bollinger convention); `retZ = (ln-return − mean)/σ` of the **prior** 20 daily log returns (today's outlier can't inflate its own σ); expected move `k·S·IV·√(days/365)` for 1wk/1mo, k∈{1,2}; earnings move = `0.85 ×` ATM-straddle mid (`computeImpliedMoveForDate`; the 0.85 quick-read convention applies **only here**) |
| Vol risk premium | `iv-history/` (~18mo ATM ~30d IV) × rolling 30d RV from closes | `vrp_d = iv_d − RV30(closes ≤ d)`; series depth ≈ min(iv n, 252−31) ≈ 220 — derived **retroactively**, no new accumulation; today's z + midrank percentile vs that series; requires n ≥ 60 |
| Pairs | within-`INDUSTRY_OF_TICKER` groups (singleton industries pool by fine `SECTORS` label; ETFs excluded), aligned closes + joined iv-history | gate: 120d return corr ≥ 0.60 (no all-vs-all dredging); `pxZ` = 60d log price-ratio z; AR(1) on that window → `halfLife = −ln2/ln(1+φ)`, `mrOk` = φ<0 ∧ half-life ≤ 30 (the **honest substitute for cointegration** — 252 bars is too short for Engle-Granger, and the UI badges rows that fail rather than hiding them); `ivZ` = IV-spread (A−B) z vs its 120d norm, ≥ 60 joined obs |
| Vol surface | today's chain (±50% strikes × 14 expirations, per-row IV) + accumulated `s`/`t` iv-history fields | slope = ATM IV(~90d) − ATM IV(~30d) via `computeAtmIvForDte` (negative = backwardation/near-term stress); `skew25` = IV(25Δ put) − IV(25Δ call) at the ~30d expiry (`computeSkew25`, delta via `lib/greeks.mjs` off each row's own IV, ±10%-moneyness fallback); z-scores vs the name's own accumulated history, null until ≥ 60 sessions — **self-activating, no code change** |
| Dispersion | SPY ATM IV + top-50 tracked non-ETF names by `fundamentals.marketCap` | implied correlation proxy `ρ ≈ σ_SPY² / (Σ wᵢσᵢ)²`, clipped [0,1]. **Labeled a proxy everywhere**: the tracked universe is not the S&P 500 — direction + percentile are the signal, never the level. Percentile activates once quant-history has ≥ 60 days |
| Post-earnings drift | `earnings-history.json` + closes | names within 10 sessions of a print: realized reaction, drift since the reaction close, and the name's own historical week-1 drift split by beat (surprise > +1%) vs miss (< −1%) |

Units convention: **all vol numbers ship as percentage points** (24.1 =
24.1%), z-scores as plain 2dp numbers — the client never guesses units.

## 3. The iv-history `s`/`t` extension (surface accumulation)

`collectIvHistory` now stamps two optional fields into each day's entry:
`s` = 25Δ skew, `t` = term slope (~90d − ~30d ATM). Additive by design —
`attachIvRanks`, `buildIvTrendingPayload`, and every other reader touch only
`.iv`. Zero new store objects (rides the existing per-ticker files). After
~60 sessions (~3 months) the surface screen's `slopeZ`/`skewZ` and the UI's
"collecting (n/60)" placeholders flip to live z-scores automatically.

## 4. Feed shapes

`data/quant.json` (premium, ~60–120 KB at full universe):
`{ builtAtIso, date, minHist, confluence:{minSignals,qualifiedMin,sources,rows},
sigma:{showZ,retZ,rows}, vrp:{minN,mktVrp,rows},
pairs:{window,corrMin,halfLifeMax,tested,rows}, surface:{farDte,skewDelta,rows},
dispersion, ped:{windowSessions,rows}, coverage:{notFeasible,existing} }` —
row shapes in `buildQuant*` (build.mjs). Only names at/near an extreme ship in
`sigma`; `pairs` ships rows with max(|pxZ|,|ivZ|) ≥ 1, capped at 80. Confluence
rows: `{ t, sector, spot, count, qualified, lean, flow, volume, streak, iv }`
(per-signal detail objects, null when that screen didn't fire), capped at 40;
`sources` carries each feed's availability/`asOf`/`stale` stamp so the UI never
pretends the four reads are simultaneous. The bake threads the sources in via
`buildQuantPayload`'s trailing `confluenceSources` param — offline callers
(diagnose harness) omit it and get an empty-rows confluence block.

`data/quant-history.json` (premium, read-before-wipe, cap 500 days):
`{ days: [{ d, impliedCorr, idxIv, basketIv, mktVrp }] }` — upserted per ET
day; powers the dispersion percentile.

## 5. Overlap policy — link, don't duplicate

Event read-through pair betas → **Event spillover** tab. Season-wide earnings
stats → **Earnings tracker**. IV momentum/elevation → **Trending IV**. Price-dip
shares screen → **Stock Picks**. The Quant Lab's coverage card points at each.
The Aggregate-ideas screen is the deliberate exception: it does not re-derive
any of those signals — it *joins* the already-computed flow/volume/streak/IV
outputs by ticker and reports only the cross-reference (each row's cells link
back to the numbers the source tabs already show).

## 6. Honestly out of scope (no data source)

Surfaced in the tab's coverage card rather than faked: M&A / spin-off screens
(no deal data), index add/delete prediction (no committee/flow data),
gamma-scalping simulation (needs intraday hedging data), formal cointegration
(252-bar history), alt-data earnings nowcasts (no satellite/card/web feeds).
Adding any of these requires a new data source first.

## 7. Client

`loadQuant`/`renderQuant` in `scripts/render/app-js.mjs` (spillover-loader
pattern; one fetch of `quant.json`); section chrome + the static playbook and
coverage cards in `html.mjs` (`quantSection`); `.quant-*` styles. Premium
wiring: `PREMIUM_TABS.quant`, lock-card copy, `PAGE_TAB_IDS`, aliases
(`quant-lab`, `pairs`, `pair-trading`, `sigma`, `vrp`, `dispersion`), the
selectTab lazy-load hook, and `.quant-sym` in the `bindBriefChips` selector so
every ticker deep-links to Grade.

## 8. Validation — `scripts/diagnose-pairs.mjs`

Read-only, mirrors the live tunables exactly. (1) **Pair convergence**: every
fresh ±2σ excursion of the 60d ratio z → did it revert to ≤0.5σ within 20
sessions, σ-units captured, split by the `mrOk` badge (the badge must beat the
no-MR cohort to earn its place) + per-industry breakdown. (2) **VRP
reversion**: expanding-window (no-lookahead) z; 10-session Δvrp after rich/cheap
readings, hit rates + t-stats (overlapping daily observations inflate the
t-stats — read directionally). Degrades to "insufficient sample". **This
harness is the gate**: no screen graduates past "analytical map" without it.

## 9. Known limitations

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
