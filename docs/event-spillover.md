# Event Spillover Matrix — Build Spec (repo-native)

> **Status: ALL THREE PHASES BUILT (2026-07-19), then EXPANDED TO THE FULL
> UNIVERSE the same day (Phase 4, §15)** — the offline backtest
> (`scripts/diagnose-spillover.mjs`), the bake integration (the `EVENT SPILLOVER MATRIX`
> block in `scripts/build.mjs` → `data/spillover-pairs.json` + `data/spillover-log.json`,
> premium keys), and the Event Spillover tab (nav group 1, after Earnings calls). §15 has
> the per-phase detail. **Coverage is no longer the banks pilot: every tracked non-ETF
> ticker joins exactly one sector group (derived from `SECTORS` — see §3), pairs are
> measured within groups, and the banks are now simply the `banks` group.** This is the canonical reference for the feature (the role
> `docs/top-picks.md` plays for the picks engine). It supersedes the original Finnhub-based
> draft: this repo has **zero Finnhub** — every data need below is mapped onto the existing
> Yahoo / Nasdaq / BLS-FRED infrastructure, and most of it already exists in
> `scripts/build.mjs`. Read §14 (reusable assets) before writing any new code.
>
> **Scope (owner directive): this is an analytical correlation matrix, NOT a trade-signal
> engine.** The system finds, validates, and displays event read-through — it never suggests
> a trade, picks a contract, or sizes a position. Any trade decision is the user's, made off
> the matrix. (Contrast with the Top Picks engine, which *does* emit actionable trades.)

## 1. Objective

Given **an upcoming event** (an earnings date attached to a ticker), map the **read-through
structure** around it: which same-sector peers historically move with the event stock through
its event window, how strongly, how consistently in direction — and whether each peer's
options currently price that spillover or not.

Terminology used throughout:
- **Driver** = the stock that has the scheduled event (exogenous; comes from the earnings calendar).
- **Follower** = a same-sector peer whose read-through we measure.
- **Event window** = **session-aware**, not a fixed `T-1 close → T+0 close`:
  - **AM (BMO) driver:** window = `T-1 close → T+0 close`.
  - **PM (AMC) or TBD driver:** the reaction lands the *next* session, so window =
    `T+0 close → T+1 close`.
  This is the same convention `computeEarningsReaction` (build.mjs:4492) already uses to
  measure earnings reactions — AM prints react on the announce-day bar, PM/TBD on the next
  bar. The backtest and the live matrix MUST both use it; a fixed `T-1→T+0` window would
  capture an AMC driver's *pre*-announcement session and measure noise.

Runtime question the system answers:
> "`<DRIVER>` reports on `<DATE>`. Which same-sector followers have the highest, cleanest
> read-through, how big a move does the driver's own straddle imply for each of them — and
> is there any overlapping macro/sector event that would contaminate the read?"

## 2. Runtime flow (live path)

1. **Ingest event.** Upcoming earnings already exist in the bake: `fundamentals.nextEarningsDate`
   per ticker + `data/calendar.json` earnings events, with AM/PM/TBD sessions from
   `fetchNasdaqEarningsSessions` (build.mjs:10187) → `(driver, event_date, session)`.
2. **Resolve sector.** Driver → sector group → sector ETF (§3). Pilot: the `SECTORS` "Bank"
   label → XLF (or KBE, configurable).
3. **Isolation gate (§8).** Scan `[window_start−1, window_end+1]` for conflicts (macro prints,
   other same-sector earnings, follower's own earnings). A conflict **marks the event's
   matrix as contaminated** (with the reason) rather than suppressing it — the matrix is
   informational, so it ships with the caveat attached.
4. **Qualified followers.** Same-sector names passing the correlation + significance +
   direction-consistency gates (§7).
5. **Rank by realized-vs-priced edge (§6).** Not by raw correlation and not by raw IV
   discount — by `realized_spillover_move − priced_move`.
6. **Translate the driver's implied move (§9, informational).** Driver's options-implied
   expected move (`computeImpliedMoveForDate`, build.mjs:3775) → expected follower move via
   Engine A **and** Engine B, both displayed.
7. **Emit the matrix**, per `(driver event × follower)`: betas + stats from both engines,
   historical hit rate, expected follower move (A and B), the follower's own priced move,
   edge, and the isolation status/reason. **No direction call, no contract, no size.**

> **Critical separation:** the *backtest* measures accuracy using **realized** event moves
> (known only ex-post). The *live matrix* displays expected moves derived from the driver's
> **options-implied expected move** (known before the print, priced into the driver's own
> straddle). Do not mix these two.

## 3. Universe & scope (full universe since 2026-07-19; pilot history below)

- **Coverage: the FULL tracked universe.** Every non-ETF ticker in `TICKERS` joins exactly
  ONE sector group, derived from the `SECTORS` label map at module load
  (`buildSpilloverGroups` in build.mjs) — so a new ticker auto-enrolls the day it's added.
  Drivers *and* followers are drawn from a group's members (~2,000 ordered pairs across
  ~14 groups at the current 128-name universe); **pairs are never measured across groups**
  (read-through is a same-sector concept — the gates would drown in spurious cross-sector
  regressions otherwise).
- **The grouping registry** (`SPILLOVER_LABEL_GROUPS` + `SPILLOVER_GROUP_META` in
  build.mjs): SECTORS labels merge into trader-recognizable complexes — Semis ∪ Storage
  (`SMH`), Software ∪ IT/Tech services (`IGV`), Mega-cap tech ∪ Social (`QQQ`),
  Hardware ∪ Networking ∪ Data center (`XLK`), Power ∪ Clean energy ∪ Nuclear (`XLU`),
  Bank (`XLF`), Broker ∪ Asset mgmt ∪ Fintech ∪ Crypto (`XLF`), Payments (`XLF`),
  Retail ∪ E-commerce ∪ Apparel ∪ Beauty ∪ Restaurants ∪ Homebuilder ∪ Consumer (`XRT`),
  Media ∪ Cable ∪ Telecom (`XLC`), Industrial ∪ Defense ∪ Materials ∪ Logistics (`XLI`),
  Pharma ∪ Insurance ∪ Medical ∪ Telehealth ∪ Pharmacy (`XLV`), Energy (`XLE`),
  China tech (`KWEB`), Space (`ARKX`). One per-symbol override: **NVDA is grouped with
  the semis** (its label is "Mega-cap tech" but NVDA→AMD/AVGO/… is the most-watched
  read-through in the market). An unmapped future label becomes its own slugified
  auto-group (no ETF → Engine B only), so nothing ever silently drops out. **Groups with
  a single member (currently `china`: BABA) ship as explicit no-peer coverage** — the tab
  lists them honestly instead of hiding them.
- **Sector ETFs are price-only, module-private fetches** — build-time `chart()` calls
  bypass the `/api` proxies' `SYMBOL_RE` allowlist entirely (same mechanism the
  `GLOBAL_MARKETS` foreign sweep uses), so no universe change is needed. **No ETF IV
  history is collected**: the ETFs serve only as Engine A's regression leg and the
  driver-implied-move → sector-move translation; a missing/unfetchable ETF degrades its
  group to Engine B (never blocks the matrix). All follower priced-move / IV data comes
  from the tracked names' existing `data/iv-history/` files.
- **Pilot history:** the feature shipped 2026-07-19 as a five-bank pilot
  (`JPM, BAC, C, GS, MS` vs `XLF`, 20 ordered pairs) and was expanded to the full
  universe the same day after the pilot validated the method (§15 Phase-1 findings:
  read-through real and stable, 8/12 measurable pairs qualified). The banks are now
  simply the `banks` group. `scripts/diagnose-spillover.mjs` (the deep 5-year offline
  backtest) intentionally **stays banks-scoped** — it's the validation tool, and its
  Nasdaq back-walk is too slow to sweep 128 names.

## 4. Data requirements — mapped to the actual stack

| Data | Needed for | Source in this repo | Status |
|---|---|---|---|
| Daily OHLC (drivers, followers, ETFs, SPY) | betas, backtest | Yahoo via `chart()` (`yahoo-finance2`), arbitrary `period1/period2` — precedents: 800-day earnings backfill (build.mjs:4469), 420-day sector history | **available; 5y fetch is trivial** (the 252-bar `priceSeries` cap is a persistence choice, not a fetch limit) |
| Earnings calendar (dates + AM/PM) | driver events, isolation gate | `fundamentals.nextEarningsDate` + `fetchNasdaqEarningsSessions` (build.mjs:10187) → `calendar.json` | **available** |
| Economic calendar (FOMC/CPI/PPI/NFP/PCE) | isolation gate | `FOMC_MEETINGS_BASELINE` (build.mjs:9217, decisions through 2027) + `computeReleaseSchedule` (build.mjs:9440, deterministic current+next year); overlap primitive: `buildMacroCalendarAhead` (build.mjs:11544) | **available** — for backtest-era dates, run the deterministic schedule generator for past years; pre-2025 FOMC dates need a small hardcoded list |
| Historical ATM IV (followers) | priced-move column, IV read-through | `data/iv-history/<SYM>.json` — one 30d-ATM sample per ET day, ~18-month cap (`IV_HISTORY_MAX_ENTRIES=400`, build.mjs:3763), tracked tickers only | **available going forward** (not 5y deep; bounds §10b, not §10a) |
| **Historical driver earnings dates (5y)** | event-window betas (Engine B), backtest depth | `earnings-history.json` caps at 12 prints ≈ 3y (`EARNINGS_HISTORY_MAX_EVENTS`, build.mjs:4274); Yahoo's deep backfill endpoint **froze mid-2025**; Nasdaq surprise table ≈ 4 quarters | **THE weak point** — see below |

**The named gap: historical driver event dates, not IV.** The original draft called
historical IV the weak point; the repo already collects that. What is *not* sitting in the
repo is 5 years of driver earnings dates+sessions. How Phase 1 resolves it (all verified
2026-07-19, implemented in `scripts/diagnose-spillover.mjs`):

1. **Nasdaq per-date calendar back-walk — VERIFIED: the endpoint serves past dates** (at
   least back to 2021), but two caveats surfaced: historical rows omit the session
   (`"time-not-supplied"` — the pilot banks are all stable BMO reporters, so they're stamped
   AM), and **Nasdaq's WAF blocks bursts hard** (a concurrency-8 walk earned an hours-long
   IP-wide Access-Denied). The back-walk is therefore sequential, ~1.2s-paced, gives up
   after a run of consecutive blocks, and caches successes under `os.tmpdir()` — coverage
   fills **incrementally across runs**.
2. **Yahoo's visualization earnings archive** (the unexported `fetchYahooEarningsDates`
   pattern, ported locally) — real BMO/AMC sessions, ~20 prints/name through its mid-2025
   upstream freeze. Crumb-gated: it fails on networks where Yahoo's cookie/crumb handshake
   breaks, and the script degrades with a note.
3. **`data/earnings-history.json`** (hydrated checkouts) — authoritative recent sessions,
   merged last with override priority.

Shrinkage (§5) stays mandatory regardless — even at full coverage the per-pair n is ~20,
and partial-coverage runs sit well below that.

(Historical option bid/ask was a requirement of the retired trade-signal framing — with the
matrix informational, it is no longer needed at all.)

## 5. Two beta engines (build both, keep separate, live-test head-to-head)

Both engines produce a `predicted_follower_move`. Store their outputs in separate columns so
the forward validation (§11) can compare which one actually predicts.

The only reusable regression code in the repo is `corrBetaReturns` (build.mjs:18347) —
date-paired simple daily returns → Pearson correlation + OLS slope, used by the overnight
correlations engine (which is US-vs-*foreign* only; there is no US-vs-US or name-vs-ETF
regression anywhere today, and no Newey-West / t-stats / R² — only `corr, beta, n`). Use it
as the seed; **Newey-West SEs, R², event-window regressions, and shrinkage are new pure
functions** (~20 lines for NW; hand-roll — the repo is deliberately dependency-light and no
stats library exists).

### Engine A — Sector-routed beta (two-stage; strips driver's private news)

The problem it fixes: part of the driver's move is its own private news, which does **not**
transmit to the follower — a direct `β × driver_move` over-predicts. Routing through the
sector ETF filters that out, because the driver's idiosyncratic news barely moves the ETF.

- **Stage 1 (fit, rolling 63–126 trading days):**
  `r_follower,t = α + β_(f→sector) · r_sectorETF,t + ε_t`, Newey-West SEs (lag ≈ 5).
- **Backtest prediction (ex-post):**
  `predicted_follower_move = β_(f→sector) · (sectorETF realized event-window return)`.
- **Live prediction (ex-ante, for the matrix's expected-move column):**
  driver implied move (from `computeImpliedMoveForDate` on the driver's own chain)
  → expected sectorETF move (driver's beta-to-ETF — same regression code, driver as y)
  → `× β_(f→sector)` = expected follower move.
- Store per `(follower, sector, asof_date)`: `β_(f→sector), R², t_stat_NW, n`.

### Engine B — Direct-pair event-window beta (measures actual read-through on event days)

The problem it fixes: rolling all-day betas are estimated on ordinary days, but events are
what we care about. Event-window betas measure the contaminated regime the matrix describes.

- For each `(driver, follower)` pair, gather all past driver-event dates (§4 gap applies).
- Compute **session-aware** event-window returns (§1) for driver and follower.
- Regress across events: `ret_follower,event = α + β_event · ret_driver,event + ε`, NW SEs.
- **Small-sample shrinkage (not optional — at n≈12–20 events it carries the estimate):**
  shrink each pair's `β_event` toward a **pooled sector event-beta** estimated from *all*
  driver/follower event pairs in the sector. Store the shrinkage weight.
- Store per `(driver, follower, asof_date)`: `β_event_raw, β_event_shrunk, R², t_stat_NW, n_events`.

> Also keep the **lagged variant** (driver at `t-1` vs follower at `t`, both directions) so
> you can see which name tends to lead. And keep the **residual/"pure" beta**: regress both
> names on SPY, then run the spillover regression on residuals to remove the common market
> factor. For the residual beta, **do not gate on R²** — stripping the market factor
> deliberately removes the co-movement, so residual R² is *supposed* to be low; gate on
> t-stat and sign stability instead. (SPY history is already fetched throughout the build.)

## 6. Follower ranking — realized-vs-priced edge (NOT raw IV discount)

Ranking on "biggest IV discount" is a trap: the follower's IV is often low *because the
market correctly expects it to move less* on someone else's earnings. Cheap ≠ underpriced.
The matrix's headline sort key is the gap between what the follower **realizes** and what
its options **charge**:

```
edge = realized_spillover_move  −  priced_move
```

- `realized_spillover_move` = historical average follower event-window move **in the
  driver's direction** (from backtest).
- `priced_move` = follower's options-implied move for the window ≈ `ATM_IV / √252` (1-day),
  from `data/iv-history/` (historical) or `computeAtm30dIv` (build.mjs:3820, live); or the
  ATM straddle ÷ spot for the window.
- `edge > 0` = the follower historically moves more on this driver's prints than its options
  currently price — the matrix's most interesting cell. `edge ≤ 0` rows still display (the
  market pricing spillover correctly is itself information), just ranked lower.
- Correlation and IV discount are **first-pass qualification filters only**; edge is the
  ranking key.
- Precedent to reuse: the earnings tracker already computes realized-vs-implied per print
  (`exceededImplied`, build.mjs:5237-5259, with the `impliedMovePct` live-straddle /
  `impliedMoveEstPct` IV-crush-fallback convention via `impliedMoveFromIvCrush`,
  build.mjs:4631). Keep those field conventions.

## 7. Gates a pair must pass to qualify for the matrix

- **Correlation / beta threshold:** meaningful `|β|`, `R² > 0.25–0.30` (pair regression
  only — see residual-beta note in §5).
- **Significance:** Newey-West `p < 0.05`.
- **Direction consistency (hit rate):** fraction of past events where
  `sign(follower move) == sign(predicted)` must clear a threshold (default **60%**).
  Same-sector names sometimes move *opposite* on shared news (one bank's beat = a rival
  lost share); magnitude alone hides this. A coinflip on direction isn't a read-through —
  it's noise, and displaying it as a correlation would mislead.
- **Multiple-testing control:** marginal at pilot scale (20 ordered pairs) but mandatory at
  the 138-name scale-up — thousands of pair regressions at `p<0.05` guarantees ~5% false
  positives from noise, i.e. fake correlations in the matrix. Apply **Benjamini-Hochberg
  FDR** across all pairs, and/or a **split-sample gate**: fit betas on the first half of
  history, require the pair to still work out-of-sample on the second half. OOS survival
  beats any in-sample p-value.
- Pairs failing the gates are excluded from the qualified matrix (optionally listed in a
  collapsed "unqualified" section with the failing stat, so absence is explainable).
- (Option liquidity/contract filters from the original draft are dropped — no contract is
  ever selected. The priced-move column needs only ATM IV.)

## 8. Isolation gate (the "no overlapping event" constraint)

Mostly assembly, not construction. For each `(driver, event)`, scan
`[window_start−1, window_end+1]` (session-aware window per §1):

- **Macro conflict:** FOMC, CPI, PPI, NFP, PCE. Reuse `buildMacroCalendarAhead`
  (build.mjs:11544) + `ALWAYS_DEFER_REPORT_SUBTYPES` (build.mjs:11423) — this is exactly the
  "is a major macro print near date X?" primitive the picks engine already uses.
- **Same-sector earnings** overlapping the window: scan `calendar.json` earnings events /
  `fundamentals.nextEarningsDate` across the sector (contaminates the sector move).
- **Follower's own earnings inside the window** → that follower's row is flagged
  **self-event** (its own print, not the driver's, will dominate its move and its IV).
- **Sector halt / index-level news** (optional, harder to detect).

Because the matrix is informational rather than trade-emitting, conflicts **flag and
annotate** rather than suppress: the matrix ships with `isolation_status` +
`isolation_reason` per event (and per follower row for self-events). For **beta
estimation**, Phase 1 established the working contamination policy (dirty events would
poison the regressions, but bank prints cluster so hard that a blanket exclusion leaves
n=0 — the pilot's first structural finding):

- **FOMC** (exact dates: `FOMC_MEETINGS_BASELINE` + a hardcoded 2021–24 list) and **NFP**
  (first-Friday rule) → **hard-exclude** the event from estimation.
- **Follower's own print in the window** (self-event) → always excludes that pair-event.
- **CPI/PPI** → **flag-only, approximate** (a weekday day-of-month 9–16 window). BLS blocks
  schedule scraping (403 even with browser headers), exact historical dates aren't
  available deterministically, and hard-excluding on an approximate flag would wrongly
  erase most mid-month bank prints. The **residual (SPY-stripped) variant is the
  principled control** for the shared macro shock instead.
- **Same-sector shared prints** → reported under **two variants side by side**: STRICT
  (shared-print + CPI-flagged events excluded — the doc-pure read, honestly n≈0 for
  banks) and SHARED (only hard excludes; flags annotated — the read that reflects how
  bank mornings actually work; treat its magnitudes as upper bounds where the variants
  disagree).

Every flag writes its reason so "clean read" vs "contaminated read" is always
distinguishable.

## 9. Expected-move translation (informational, not sizing)

For each upcoming driver event, the matrix displays per follower:

1. The driver's options-implied expected move from its ATM straddle
   (`computeImpliedMoveForDate` — already stamped hourly by the bake).
2. The expected follower move via Engine A **and** Engine B, side by side (they will
   disagree; the disagreement itself is displayed, and §11 tracks which engine is right).
   **Engine A's live translation uses the REVERSE regression** for the driver→ETF leg:
   `expected ETF move = implied × β_(ETF on driver)` (the conditional-expectation
   direction), then `× β_(follower on ETF)`. Inverting the follower-style
   driver-on-ETF beta instead over-attributes the driver's idiosyncratic move to the
   sector channel — it made every expected follower move ≈ the driver's own implied
   move (caught and fixed in the Phase-2 smoke test).
3. The follower's own priced move (§6) next to it — so the realized-vs-priced tension is
   visible per row.

No position sizing, no delta targets, no vega accounting — those belonged to the retired
trade-signal framing.

## 10. Backtest — validating the correlation, not simulating trades

### 10a. Price read-through backtest

For every historical driver event (isolation-clean only) and every qualified follower:

- Compute the session-aware event-window return for driver, sector ETF, and follower.
- Score each engine's prediction against the realized follower move.
- Metrics, per pair and per engine: **directional hit rate** (did the follower move the
  predicted way), **MAE** of predicted-vs-realized follower move, **average realized
  spillover move in the driver's direction** (feeding §6's edge), and beta stability across
  time (first-half vs second-half betas — the split-sample gate's substrate).
- No option fills, no spread modeling, no P&L — the question is "is the read-through real
  and predictable," not "would a trade have made money."

### 10b. IV read-through (forward-leaning)

Separate question: does the follower's **ATM IV rise** into the driver's event — i.e. does
the options market anticipate spillover? Measure the follower's IV change from a few days
before the window through the window. `data/iv-history/` gives ~18 months of daily samples —
enough to *start* this historically for recent events, but the leg is primarily
**forward-collected in §11**. Don't fake older IV from mids.

## 11. Forward validation (compare Engine A vs Engine B)

Before trusting the matrix's expected-move columns, run both engines in parallel on upcoming
events and log, per event: `predicted_follower_move_A`, `predicted_follower_move_B`,
`realized_follower_move` (filled in after the window closes), `driver_implied_move`,
`isolation_status`, and the follower's IV change through the window. Accumulate until one
engine clearly predicts better; surface each engine's running forward hit-rate/MAE in the
matrix itself so the displayed expected moves carry their own credibility score.

Mechanically this maps onto the existing accumulating-file machinery —
`updatePicksAccuracyFile` (build.mjs:17701) is the pattern template (enroll a prediction on
event detection, resolve it after the window closes, accumulate in a store file under the
**read-before-wipe** rule: pre-read in `main()` before `writeChainFiles` wipes `data/`,
write back after — same as `picks-accuracy.json`, `earnings-history.json`). Only predictions
and realizations are logged; there is no position, no marking-to-market, no fills.

This also collects forward the follower-IV-behavior data that history can't give you (§10b).

## 12. Storage — flat JSON in the private store (no SQL)

The repo's storage model is `data/*.json` in the private store (R2), pushed/pulled by
`sync-data.mjs`. Map the schema onto two flat bake-owned files:

- **`data/spillover-pairs.json`** (the matrix substrate): per
  `(driver, follower, sector, asof_date, engine)` row — `beta, beta_shrunk, r2, t_stat_nw,
  n, hit_rate, avg_realized_move, priced_move, edge, lag, is_residual`, plus the pooled
  sector beta + shrinkage weight. Recomputed **once per ET day** inside the scheduled bake
  (the `grades-daily.json` upsert pattern), rolling window = "current regime".
- **`data/spillover-log.json`** (event + forward-validation log, accumulating): events
  `(driver, event_date, session, isolation_status, isolation_reason)` and per-event
  predictions `(follower, predicted_A, predicted_B, driver_implied_move, priced_move,
  realized ← filled post-window, iv_change ← filled post-window)`. Follows read-before-wipe.

New flat bake-written keys are **auto-owned** by `sync-data.mjs push` (only the per-ticker /
`iv-history/` prefixes get delete-staled) — no sync changes needed. If/when the feature gets
a site tab, add the keys to `lib/premium-keys.mjs` as **premium** (same tier logic as the
other analysis tabs).

## 13. Acceptance criteria (pilot)

- Banks-only (5 tracked names), read-through backtest runs end-to-end on repo-native data —
  **5 years of driver events where the Nasdaq calendar back-walk verifies, else ≥3 years
  (~12 events/driver) with shrinkage carrying Engine B**.
- Isolation gate correctly flags events overlapping FOMC/CPI and same-sector earnings
  (spot-check: bank prints in known FOMC weeks), with reasons logged; contaminated events
  are excluded from beta estimation.
- Report shows, per pair and per engine: hit rate, MAE, average realized spillover move,
  priced move, and edge — **no trade recommendations anywhere in the output**.
- Matrix ranked by `edge`, not raw correlation or IV discount; unqualified pairs excluded
  (or listed with the failing gate).
- Engine A and Engine B outputs stored side by side, with the forward-validation log ready
  to accumulate their head-to-head record.

## 14. Reusable assets (start here, don't rewrite)

| Asset | Where | Provides |
|---|---|---|
| `fetchNasdaqEarningsSessions` | build.mjs:10187 | BMO/AMC sessions; candidate endpoint for the historical back-walk |
| `computeEarningsReaction` / `computeEarningsRunup` | build.mjs:4492 / 4537 | session-aware event windows + pre-event drift |
| `computeImpliedMoveForDate` | build.mjs:3775 | driver straddle-implied move (expected-move translation input) |
| `impliedMoveFromIvCrush` / `impliedMoveEstPct` | build.mjs:4631 | historical implied-move estimate convention |
| `computeAtm30dIv` + `data/iv-history/` | build.mjs:3820 | follower priced move (live + ~18mo history) |
| `buildMacroCalendarAhead` + `ALWAYS_DEFER_REPORT_SUBTYPES` | build.mjs:11544 / 11423 | isolation-gate macro primitive |
| `FOMC_MEETINGS_BASELINE` / `computeReleaseSchedule` | build.mjs:9217 / 9440 | dated FOMC through 2027; deterministic CPI/PPI/NFP schedules (runnable for past years) |
| `corrBetaReturns` | build.mjs:18347 | date-paired returns → Pearson corr + OLS slope (regression seed) |
| `updatePicksAccuracyFile` | build.mjs:17701 | accumulating enroll/resolve pattern template (read-before-wipe) for the forward-validation log |
| `chart()` (`yahoo-finance2`) | throughout build.mjs | daily OHLC at arbitrary ranges, unconstrained by `SYMBOL_RE` at build time |
| `earnings-history.json` / `attachEarningsHx` | build.mjs:4922 | per-print reactions, sessions, implied moves (~3y/ticker) |

New code required: Newey-West SEs + R² + t-stats, event-window regression + pooled-sector
shrinkage, the driver-beta-to-ETF link, BH-FDR, the isolation-gate windowing/logging, and
the two storage files. All pure functions plus one orchestrator.

## 15. Build phases

- **Phase 1 — `scripts/diagnose-spillover.mjs` — BUILT (2026-07-19).** Offline, read-only
  (the `diagnose-pick-losses.mjs` / `diagnose-grade-ic.mjs` mold — no workflow, no writes
  to `data/` or the store; its only write is the Nasdaq back-walk cache in `os.tmpdir()`).
  Fetches 5y daily bars via `chart()`, discovers driver events per §4 (Nasdaq back-walk +
  Yahoo viz archive + hydrated store, merged), applies the §8 contamination policy, runs
  Engines A+B (Newey-West, pooled-sector shrinkage, split-half stability, residual and
  lagged variants), evaluates the §7 gates + BH-FDR, and prints the §13 report with the
  edge ranking. Every network dependency is crumb-free except the optional live-IV and
  viz-archive calls, which degrade gracefully (IV falls back Yahoo → CBOE delayed-quotes →
  `data/iv-history/`).
  `node scripts/diagnose-spillover.mjs [--years=5] [--etf=XLF|KBE] [--roll=90] [--shrink-k=6] [--no-cache]`
  Re-run after a WAF-blocked walk — event coverage fills incrementally from the cache.
- **Phase 2 — bake integration — BUILT (2026-07-19, owner directive to proceed despite the
  negative-edge pilot; the matrix ships as analytics).** The `EVENT SPILLOVER MATRIX`
  block in `scripts/build.mjs` (after the correlations engine):
  - `buildSpilloverArtifacts(chains, earningsHxStore, prior, builtAtIso)` — the main()
    entry. The DEEP half (module-private 5.2y bar fetch for pilot ∪ ETF ∪ SPY via
    `fetchSpilloverBars`, then `buildSpilloverMatrix`) recomputes **once per ET day** and
    carries forward intra-day; a Yahoo miss carries the prior matrix forward stale-marked.
    The CHEAP half (`spillUpcoming` — §9 expected-move translation off current straddles/
    IV, with the reverse-regression driver→ETF leg — and the log refresh) runs every bake.
  - Events = `spillCollectEvents`: earnings-history store ∪ the log's own accumulated
    events (depth grows past the store's 12-print cap over time).
  - `updateSpilloverLog` — §11 forward validation: enroll upcoming events, refresh
    predictions until the session-aware entry point (AM = last build before the print
    date; PM = last build on it), freeze, then resolve realized moves + follower IV
    change from bars; rolling cap `SPILLOVER_LOG_MAX_EVENTS` (60); per-engine running
    direction-hit/MAE ship on `matrix.forward`.
  - Wiring: `readPriorSpillover()` pre-read in the read-before-wipe block; compute+write
    after the earnings-history write; non-fatal try/catch. Both keys are public;
    `sync-data.mjs` auto-owns them (flat bake-written keys).
  - The stat/window/isolation core (`olsNeweyWest`, `bhFdrThreshold`, `spillPrepSeries`,
    `spilloverWindowReturn`, `spillRollingBeta`, `buildSpilloverMacroSets`,
    `spillIsolate`, `FOMC_MEETINGS_HISTORICAL`) is exported and **imported by
    `diagnose-spillover.mjs`** — one implementation, verified to reproduce the Phase-1
    numbers exactly after the refactor.
- **Phase 3 — site tab — BUILT (2026-07-19).** "Event spillover", public and
  available without login. Wired like
  Trending IV: `spilloverSection()` in `scripts/render/html.mjs`,
  `loadSpillover`/`renderSpillover` + `?tab=spillover` aliases in
  `scripts/render/app-js.mjs`, `.spill-*` styles in `scripts/render/styles-css.mjs`.
  Renders: upcoming driver events (isolation chip + per-follower expected A/B vs priced),
  the Engine A-vs-B forward-accuracy strip, and the full pair matrix sorted by edge
  (β shrunk, hit, R², p + FDR ✓, avg aligned move, priced, edge, split-half βs, residual
  β, gate status). Ticker symbols are Grade-tab deep links. Committed artifacts
  (`index.html`/`app.js`/`styles.css`) hand-synced (app.js/styles.css regenerated from
  the templates after verifying byte-parity with the committed files; index.html
  hand-inserted). Verified in-browser against a real smoke payload: full render, empty
  state, deep link, and the fail-open ungated path.

- **Phase 4 — full-universe expansion — BUILT (2026-07-19, owner directive: "event
  spillover should cover every ticker we have not just the banks").** What changed in the
  `EVENT SPILLOVER MATRIX` block:
  - `SPILLOVER_PILOT`/`SPILLOVER_ETF` replaced by the **sector-group registry** (§3):
    `SPILLOVER_LABEL_GROUPS` (label merges) + `SPILLOVER_GROUP_META` (label + ETF per
    group) + `buildSpilloverGroups()` → `SPILLOVER_GROUPS` derived from `TICKERS` ∩
    `SECTORS` at module load (128 names / 14 groups at build time; verified by the smoke
    test: every non-ETF ticker in exactly one group).
  - `buildSpilloverMatrix` is group-aware: pair regressions and **pooled-shrinkage
    targets are per group** (doc §5B "pooled sector event-beta"), same-sector
    contamination (`reportersByDate`) is per group, the ETF window is the driver's
    group's, and **BH-FDR runs across ALL groups' rows per variant** (the §7 clause that
    was "mandatory at scale-up" is now active). Engine A per-(follower, as-of-date)
    rolling fits are memoized (drivers in a group share the grid). Pairs with zero
    measurable events are no longer emitted (the pilot shipped n=0 stubs); payload rows
    are null-stripped (`spillStrip`). Payload shape: `groups` replaces `pilot`/`etf`;
    `pooled` is keyed by group; pair rows carry `group`.
  - Bar fetch: ~143 symbols (universe ∪ 13 ETFs ∪ SPY) × 5.2y once per ET day, four
    paced workers (~300ms gap each, ~7-8 req/s — under the chain fetch's measured-safe
    rate, ~20-35s wall clock). Deep recompute proceeds when SPY + ≥80% of the universe
    fetched (`SPILLOVER_MIN_BAR_COVERAGE`) — a thin sweep carries last-good stale
    instead; a missing sector ETF only degrades its group to Engine B. `barCoverage`
    ships in the payload. A pilot-era prior (no `groups`) never short-circuits the deep
    half, so the first bake after deploy recomputes immediately.
  - Events: `spillCollectEvents` walks the whole universe from the earnings-history
    store ∪ the log; the session default follows doc §1 (only explicit `AM` is AM —
    PM/TBD react next session; the pilot's banks-are-BMO default is gone).
  - Upcoming/log: every tracked name with a print inside 30d enrolls; follower rows per
    event are capped at `SPILLOVER_UPCOMING_FOLLOWERS` (12; qualified pairs first, then
    deepest n, `followersOmitted` count shipped); `SPILLOVER_LOG_MAX_EVENTS` 60 → 300
    (~2 full earnings seasons at 128 names).
  - Tab: eyebrow shows `N names · M sector groups`; upcoming events carry a sector
    chip and an honest "no same-sector peer tracked" row; the matrix renders a
    **qualified-pairs roll-up** (all sectors, ranked by edge) above **per-sector
    collapsible tables**; singleton groups are listed as no-peer coverage. Legacy
    pilot payloads still render (flat table fallback).
  - `diagnose-spillover.mjs` unchanged (banks-scoped by design, §3); it imports only
    the stat/window/isolation core, which did not change.

- **Tab usability (2026-07-20):** the tab gained a **ticker filter** (a query narrows
  the upcoming events — driver OR follower match, prefix — plus the qualified roll-up
  and the per-sector tables, which auto-open while filtering; emptied sectors hide,
  match counts show per section) and the upcoming-events list renders only the first
  6 events by default with a "Show all N" toggle (full-universe earnings weeks ship
  dozens of events, each with a follower table — the page was unmanageably long).
  Client-only: `renderSpillover` in `scripts/render/app-js.mjs` (`spilloverState.query`
  / `.showAllEvents`), `.spill-tools`/`.spill-search`/`.spill-btn` styles.

### Phase-1 findings (2026-07-19, FULL coverage — 20 events/driver, 2021-10 → 2026-07)

1. **STRICT isolation yields n=0 for every pair** — across five years, not one bank event
   window is free of both a shared sector print and the CPI-week flag. The banks pilot
   *is* the SHARED variant plus the residual control; that's a property of the sector, not
   a bug. (Same-morning clustering also makes JPM↔C and GS↔BAC nearly unmeasurable as
   pairs — the follower prints inside the driver's window almost every quarter, so those
   pair-events are self-events.)
2. **Read-through is real, stable, and survives every control**: 8 of the 12 measurable
   pairs (n≥6) pass all §7 gates + BH-FDR — JPM→BAC/GS/MS, BAC→JPM/C, C→BAC/GS/MS — with
   event betas ~0.2–0.5, hit rates 63–89%, split-half betas that barely move (0.3/0.3,
   0.4/0.4, 0.6/0.6), and residual (SPY-stripped) betas that keep sign and significance.
   JPM and C are the informative drivers; **MS-as-driver fails** (its Thursday print is
   already priced through peers — consistent with the lead/lag table, where GS and C lead
   MS).
3. **But the options market already prices it**: edge is negative for every qualified pair
   except C→BAC (+0.14%) — followers' priced moves (1.3–2.2%/day ATM-IV baseline) exceed
   their realized aligned spillover moves (0.3–1.5%). The §6 "cheap follower" premise
   fails for banks, and plausibly *must* fail within this sector: because the whole group
   reports in the same week, a follower's IV at a peer-print entry is already carrying its
   own imminent print — the "follower has no event, so its IV stays low" assumption doesn't
   hold intra-sector for banks. The matrix is still valuable as an *analytical* read-through
   map (which is its stated purpose), but any future edge-hunting should look at
   cross-sector followers (suppliers/customers) or sectors whose reporters don't cluster,
   before Phase 2 is considered.
