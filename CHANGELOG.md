# Changelog

All notable changes to **stonks** are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project does not cut tagged releases — it deploys continuously from `main` —
so entries are grouped under dated headings. Newest first.

Categories: **Added** (new features), **Changed** (changes to existing behavior),
**Fixed** (bug fixes), **Removed** (dropped features), **Perf** (performance),
**Docs** (documentation/CLAUDE.md).

<!-- Add new entries to the TOP of the "Unreleased" section as you make changes.
     One bullet per change, present tense, plain language. Reference the PR (#NNN)
     when there is one. -->

## [Unreleased]

### Changed
- Top Picks grader: realigned four signal weights to the source scoring spec. **Mechanical · Put/Call Ratio Extreme** now scores ±2 (was ±1) — an extreme P/C reading is a heavier contrarian signal. **Narrative · Media** now scores a bearish coverage surge -2 (was -1; bullish stays +1) — negative media weighs twice as heavy as positive. **Technicals · 100D SMA** now scores ±1 (was ±2) — flat with the 20D/50D rungs per spec (the 100D *S/R* rung stays ±2, unchanged). **Technicals · Chart Pattern** now scores a flat ±1 regardless of model confidence (was ±2 on high-confidence reads) — drops the high-confidence doubling. Net effect: P/C-extreme and bearish-media names shift more, high-100D-SMA and high-confidence-pattern names shift less; some Top Picks grades move.
- Top Picks tenure/streak chips now count **trading days** a name has held its spot, not builds survived. Both the detail card's ⏱ badge and the landing-card chip derive the count from each pick's `firstSeen` as U.S. market sessions between then and now (weekends + full-day holidays excluded via the existing `MARKET_HOLIDAYS` calendar, so the streak doesn't inflate over a weekend; half-days still count), replacing the old per-build tally (`buildCount`, now dropped). Shown once a name carries over into a 2nd session. `firstSeen` stamping is now a shared `applyPickFirstSeen` helper so `regen-picks.mjs` preserves the streak across a render-only regen (previously it dropped `firstSeen`, hiding the chips until the next full build).
- Market narratives: a sector's grade (stance + strength) is now **computed**, not AI-guessed — a two-level rollup where each industry group's grade is the signed-strength average of its narratives (bullish +strength / bearish −strength) and the sector grade is the average of its industry-group grades. The AI keeps the qualitative `thesis`/`watchFor`; the math owns the number (`computeSectorGrades`). The sector overview now exposes the per-industry-group breakdown so the rollup is visible.
- Top Picks grader: the Narrative pillar's `sectorNarrative` ±2 signal now **fades by lifecycle + hype** — Peak halves the conviction, Challenges neutralizes it, Collapse flips a former tailwind to a fade, and a fundamentals-vs-hype score ≥70 halves the signal. Late-stage / hyped stories are treated as exhaustion risk rather than fresh tailwinds, so some Top Picks grades shift.
- Top Picks grader: split the single RSI 14 technical signal into **two** signals (technicals goes 12 → 13). **RSI Movement** (±1) is the 50-centerline momentum read — RSI above 50 and rising over the prior 5 sessions +1, below 50 and falling -1, otherwise 0. **RSI Reading** (±3, the heaviest single technical signal) is the contrarian extreme read — 75+ overbought -3, 25 or below oversold +3, otherwise 0. Replaces the old composite (oversold <35 +1 / overbought >70 -1 / mid-range ±5pt momentum). Reads the already-computed `rsi`/`rsi5d` fields; the browser's separate per-contract YES/NO "aligned score" RSI conviction is unchanged.
- Macro calendar + Fed Funds rate now fetch from their **source-of-record** first — BLS Public Data API for the CPI/PPI/payrolls/unemployment/JOLTS series and the NY Fed EFFR endpoint for the effective rate — with FRED demoted to a fallback behind both. Takes FRED's frequently-throttled Cloudflare path off every build's hot path (no more ~25–50s of 429/timeout "cascade") while keeping it as a backstop. Adds an optional `BLS_API_KEY` for registered BLS access (500 queries/day, 20yr history; unset still works unauthenticated). `api/fed-rate.js` likewise tries NY Fed EFFR first, FRED CSV as fallback.

### Added
- **Top 10 — picks in & out roster** — the Track record tab's "Picks in & out" section is rebuilt around a new `data/picks-roster.json` snapshot: the current 10-name Top Picks list, each row badged IN (new this refresh) / HELD / NEW-coverage, with the prior→current **per-pillar deltas** (all four pillars, not just the top two), the names that **dropped out** of the Top 10 (paired to the entrant that took their slot, flagged "out-ranked" vs "below the ±16 bar"), and a per-pick **upgrade/downgrade forecast**. The roster diff runs on the prior visible top-N plus the pre-wipe whole-universe grade snapshot (`gradesHistoryPrev.latest`), so it's immune to the pre-market pick collapse and catches a name that leaves the Top 10 by being out-ranked while still above the bar (which the ±16 crossing log can't). The forecast is deterministic — it reads each pick's pre-computed pillar signal scores (RSI extreme, 52-week proximity, RSI momentum, guidance, analyst-target headroom, narrative lifecycle stage, IV percentile), normalizes every read to the trade's direction, and flags an earnings-before-expiry binary catalyst — with an optional **AI one-liner** gloss (`AI_PICKS_FORECAST_MODEL`, hybrid — self-skips without `GEMINI_API_KEY`, capped at 10/build, on the shared AI budget). Clicking any row reveals the full 4-pillar grading rubric (reusing the Grade tab's `pickPillarPanel`) with the pillar deltas and forecast factors. The old chronological ±16-bar log is kept below as a collapsed "Recent crossings". `regen-picks.mjs` writes the roster too (deterministic, AI-free).
- Market narratives now carry a **lifecycle outlook** alongside the existing 6-stage stepper: each narrative gets a `lifecycleOutlook` `{rationale, nextStage, trigger}` from the AI — *why* the story sits at its current stage right now (the evidence), *what stage* it most likely enters next, and the *specific signal + rough timing* that would confirm that transition. Rendered as a "Why here / Next / Watch for" block under the stepper on every narrative card; the Next chip is tinted red when the story is advancing toward collapse and green when recovering up the arc. The sector-overview banner reuses its dominant active narrative's outlook (the same narrative that already sets the sector's computed lifecycle stage). New `nextLifecycleStage` helper defaults `nextStage` to the next stage along the arc when the model omits it; older cached narratives without the field render nothing (graceful degrade). `NARRATIVES_MODEL` prompt + schema extended; 32768-token cap unchanged (thinking budget is zeroed, ample headroom).
- **Picks in & out tracker** — a new `data/picks-changes.json` rolling log records *why* a name crossed the ±16 conviction bar onto (entered) or off (exited) the actionable Top Picks set each build, surfaced as a "Picks in & out" section on the Top Picks → Track record tab. Detection runs on the grade index (the same pre-wipe `gradesHistoryPrev.latest` snapshot the grade-change log uses), so it's immune to the pre-market quote collapse that transiently empties the visible picks list. Each event carries a deterministic pillar-delta reason (e.g. "Cleared the ±16 conviction bar — Technicals +4, Narrative +2") plus an optional **AI one-liner** that folds in the per-ticker news take (`AI_PICKS_CHANGE_MODEL`, hybrid — self-skips without `GEMINI_API_KEY`, capped at 12 events/build, routed through the shared AI budget). A **hysteresis dead-band** (enter at ≥16, exit only below 14, with per-symbol in/out state read from the rolling log) stops a score parked at the bar from spamming entered/exited every build — the analogue of the grade-change log's min-delta guard. `regen-picks.mjs` writes the deterministic events too (no AI). Pre-read before the `data/` wipe like the other accumulating logs; pruned to 30 days / 200 events.
- Market narratives now carry a **6-stage lifecycle** (`lifecycleStage`: catalysts → amplification → validation → peak → challenges → collapse) on every sector and sub-industry narrative, kept alongside the existing active/building/fading `status`. The Narratives tab renders it as a stepper (rising stages read accent, the post-peak downslope reads red). The narratives AI prompt gained a lifecycle primer; the 3-state status default backfills the stage on older cached data.
- Market narratives now answer the **six-question framework**: each sector and narrative carries a **bull / base / bear case** and a 0–100 **fundamentals-vs-hype** gauge (`hype: {score, label, rationale}`), surfaced on the cards as a scenario block + a fundamentals→hype meter. ("Dominant narrative" reuses the existing thesis; "what would shift it" reuses the existing watchFor.) `NARRATIVES_MODEL` output cap raised 16384 → 32768 for the richer schema.
- Top Picks landing cards now show a `⏱ Nd` day-streak chip (how many trading days in a row the ticker has held a top-picks spot), mirroring the detail card's existing tenure badge. Shown only when the streak is >1 day.

### Perf
- Daily build: raise chain-fetch `TICKER_CONCURRENCY` 4 → 6. Measured Yahoo options latency is ~104ms p50 (under the 150ms inter-expiration gap), so workers are gap-paced, not latency-bound, and six probed clean (0 errors / 0 quoteless, no latency degradation) at ~18 req/s — ~27% faster on the chain phase (~87s → ~64s for 138 tickers). Single lever (gaps unchanged); the 3× backoff retry + `MIN_SUCCESS_RATE=0.75` floor keep an occasional runner-IP throttle non-breaking.
- Daily build: 13F enrichment (SEC EDGAR per-firm holdings + OpenFIGI) now runs **concurrently** with the narratives/calendar/scoring phases instead of serially at the end — its ~60-80s comes off the critical path. Kicked off right before `attachMarketNarratives` (after all per-ticker SEC XBRL has drained, so SEC load is not doubled) and awaited where the 13F files are written.
- Daily build: raise the Gemini AI pacer `AI_RPM` 300 → 600 in `daily.yml`. The per-ticker passes run on Flash-Lite (4K RPM / 4M TPM) and peaked at 279 RPM / 890K TPM, so the pacer was the binding floor; 600 keeps peak-minute TPM at ~53% of quota while halving the RPM-paced floor. Together with the 13F overlap this projects the ~4m20s node build down to ~2m45s.

### Fixed
- Calendar macro-report salvage now actually fires: `writeCalendarFile`'s FRED/BLS-outage fallback read `data/calendar.json` *after* the build wiped `data/`, so it always missed and shipped a blank macro calendar on a feed outage. `main()` now pre-reads it before the wipe and threads it in (`readPriorCalendar` / `extras.priorCalendar`).
- Unusual-flow **Export CSV** no longer leaves Side/Strike/Expiry/Volume blank — it read `c.type`/`c.s`/`c.expDate`/`c.v` but the scanner writes `c.side`/`c.strike`/`c.expSec`/`c.vol`.
- Earnings AM/PM session is now derived from America/New_York wall-clock instead of a fixed UTC-hour cut, so winter (EST) pre-open releases are no longer mislabeled PM.
- `regen-calendar.mjs` now prunes `fedwatch-history.json` (past meetings + per-meeting snapshot cap) before writing, matching the full build so the regen path can't grow it unbounded.
- Revenue-segment donut QoQ/YoY header no longer biases upward when a segment exits — the prior-period total now counts all prior segments (`previousTotal`), not just surviving slices.
- Entry-Strategy summary now flags long-put (down-tail) max gain as "unlimited" like long calls, instead of showing a misleading capped sampled-band number.
- Grade-tab live `/api/chain` poll no longer wipes the day-change off the live-quote pill — it carries forward the prior quote's `change`/`changePct` instead of nulling them.
- `scan-oi.mjs` hardens `OI_SCAN_LIMIT`: a `0`/non-numeric value now means "no cap" instead of collapsing to zero tickers, and the success-rate guard also aborts on an empty universe so it can't commit an empty tracker or poison the ΔOI baseline.
- Portfolio equity-chart "1D" range now anchors its cutoff on a UTC day boundary instead of a sliding 24h instant, so the range returns ≥2 points and the chart renders (dormant portfolio stack).

### Docs
- Add this `CHANGELOG.md` and a convention in `CLAUDE.md` to log every change going forward.

---

## 2026-06-01

### Added
- Live market-status badge + Top-Picks closed-market note (#305).

### Perf
- Speed up the daily build + unusual-flow scan and conserve Gemini tokens (#304).

### Fixed
- Track record: don't resolve picks on transient fetch misses; flat ≠ loss (#302).
