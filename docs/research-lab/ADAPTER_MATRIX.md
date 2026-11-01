# Research adapters

- Cached OHLCV: needs wrapper, implemented in `lib/research-lab/adapters.mjs`.
  Source `<SYMBOL>.json.priceSeries`; explicit USD, XNYS session-date convention,
  inherited/unknown Yahoo adjustment. Exploratory only. Owner: Lab data adapter.
- Existing streak signal: reusable pure `lib/streaks.mjs::computeStreakForTicker`.
  Recompute from each trailing prefix, freeze implementation digest. Underlying
  cached prices retain their non-PIT limitations. Owner: Lab registry.
- Breadth: computed fraction of the selected snapshot universe above a trailing
  average. Explicitly sample breadth, not full-exchange market breadth.
- Current model grades and pillar signals: missing historical availability;
  disabled catalog entry. No backfilling today's scores into past dates.
- Pattern/Bottom Tracker: missing audited historical feature snapshots; deferred.
- Fundamentals/macro vintages: missing verified publication/revision/ingestion
  chronology; disabled catalog entries.
- Earnings peer spillover: current event history does not establish historical
  announcement availability and peer membership; template stays blocked.
- Risk/Monte Carlo: seeded conditional paths implemented with explicit assumptions;
  paths never become calibrated forecasts.
- Probability forecast: deferred until a trained, frozen, independently calibrated
  PIT model and calibration scores exist. Compiler rejects probability requests.
- Factor-neutral strategy: disabled until historical sector/factor exposures and
  corporate-action-continuous tradable prices exist. Simpler equity simulation
  stays exploratory and identifies costs, next-open timing and missing fills.
- Options P&L/broker paper fills: deferred; no historical executable quote panel.
  No broker integration, broker mutations or trading credentials in Lab modules.

## Current research-board evidence

`source-projections.mjs` follows the actual saved producer shapes. Capture
adapter version 2 separates these excerpts from earlier generic projections.

- Company fundamentals retain `revenue`, `profitMargin`, `revenueGrowthYoy`,
  currency, debt observation date and ratios. Percentages already scaled by the
  producer stay percentages. Missing financial dates remain unknown; quote time
  does not establish fundamental freshness.
- AI spending projects the selected company's fiscal-year and TTM spending,
  observation dates, intensity and guidance bounds/basis. Open-ended guidance
  keeps its missing upper bound. Fiscal calendars and guidance stay distinct.
- GPU cloud evidence exports model-level rental medians and changes with
  `USD_per_GPU_hour` units. Quotes and histories stay excluded. Partly stale
  provider coverage remains visible.
- Rates/dollar context retains derived yield changes in basis points, other
  market changes in percent and per-leg dates. Quote levels are excluded.
- Reported earnings use the two latest matching resolved rows, with EPS surprise
  in percent and market reaction in decimal returns. Duplicate copies of the
  same issuer/report date are counted once. Missing values remain missing.
- Theme membership follows the source's longs, shorts and mentioned-symbol
  arrays. Scores and categories are labeled source interpretations; source prose
  is excluded. Other site sources keep the bounded read-only generic adapter.

These adapters do not make the data point-in-time eligible or train a causal
model. Native units are exported with every value. An unchanged card remains
reloadable at the retention ceiling, while new captures remain bounded under
concurrent writes.
