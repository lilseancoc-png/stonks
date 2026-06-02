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
- Macro calendar + Fed Funds rate now fetch from their **source-of-record** first — BLS Public Data API for the CPI/PPI/payrolls/unemployment/JOLTS series and the NY Fed EFFR endpoint for the effective rate — with FRED demoted to a fallback behind both. Takes FRED's frequently-throttled Cloudflare path off every build's hot path (no more ~25–50s of 429/timeout "cascade") while keeping it as a backstop. Adds an optional `BLS_API_KEY` for registered BLS access (500 queries/day, 20yr history; unset still works unauthenticated). `api/fed-rate.js` likewise tries NY Fed EFFR first, FRED CSV as fallback.

### Added
- Top Picks landing cards now show a `⏱ N×` consecutive-build streak chip (how many builds in a row the ticker has held a top-picks spot), mirroring the detail card's existing tenure badge. Shown only when the streak is >1.

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
