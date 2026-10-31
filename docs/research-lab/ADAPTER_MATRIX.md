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
