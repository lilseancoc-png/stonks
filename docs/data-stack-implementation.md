# Research-stack changes

Implemented on `Data-Stack-Review`, October 27, 2026. No production deployment or private-store mutation was performed.

## Data and evaluation repairs

- The Stock Picks checklist uses null-preserving optional financial inputs. Unknown or invalid debt remains unavailable; an observed zero alone can support “no reported debt.” Missing FCF does not become measured zero. The generic `pnum` helper is unchanged because other callers rely on its behavior.
- New daily fundamentals snapshots reject absent, blank and boolean values before conversion. Genuine zero and valid negative observations remain valid. Writer version 2 identifies new points. Legacy zero fields are preserved under `unverifiedLegacyZeros`, outside numeric histories; no zero is retroactively asserted to be false or reconstructed using today's data.
- Grade evaluation accepts the raw build `_bars` representation and persisted `priceSeries`. Build and regeneration supply the same normalized contract. Current unfinished sessions are excluded using the existing confirmed-close cutoff. An explicit input-failure state distinguishes missing prices from waiting for future results.
- The primary evaluation gate now requires **30 non-overlapping five-session windows**, positive sector/beta-adjusted spread, and a result above the existing shuffled-grade comparison. Five-, ten- and fourteen-session diagnostics remain available. Existing ten-session paper-book holds are unchanged. The UI calls this a configured threshold rather than proof of persistent predictive skill. This short-horizon test does not validate full-year valuation assumptions.

## Owner workspace

The existing **Earnings Forecast** page now includes three additional views. They use the same signed Owner route, response payload and privacy boundary as the quarterly forecasts.

### Company record

The current ten-company forecast cohort gets a rolling three-year reporting view. SEC financial observations reuse the existing immutable source/observation archive. Already-collected vendor revenue, net income, FCF, CapEx, operating cash flow and explicitly dated debt observations are retained in the existing `earnings-forecast-state.json` under `companyHistory`.

The UI distinguishes SEC facts from vendor-normalized financials. Each has period, currency and source information. Vendor records preserve the first collection time and prior versions when the same reported period changes. Unchanged observations do not mint daily copies. Company records survive the actual state-file write/read cycle and the existing hydrate-before-wipe build path. Short coverage is displayed; three-year retention does not manufacture twelve quarters when the sources supply less.

Undated current cash and outstanding-share snapshots are not mislabeled as historical quarterly observations. The SEC record includes supported reported diluted shares used by the earnings bridge. A complete debt-maturity, stock-compensation or issuer-specific KPI database is outside this implementation.

### Full year & value

“Full year” means the next four fiscal quarters, approximately twelve months. The model requires four consecutive comparable reported quarters and preserves their seasonal revenue composition. Annual growth is applied to that baseline. Disclosed product mix, when reconciled and in the same currency, supplies editable demand and price sensitivities; otherwise the model uses one consolidated line. Historical mix shares are explicitly an assumption for the coming year.

The workbench exposes growth, gross/operating margin, taxes, annual nonoperating items and common-income adjustment, starting diluted shares, dilution, exit P/E and optional dividends. It computes conditional revenue, operating income, EPS, value per share and returns against a comparable dated reference price. Reverse valuation shows the revenue and growth needed to justify that price under the same financial and multiple assumptions.

The initial exit P/E, when available, is the current provider forward multiple used as an editable assumption. It is not an independent valuation conclusion. Annual nonoperating/common-income inputs begin at four times the quarterly bridge assumptions. Missing growth history begins at an explicitly disclosed flat-growth assumption. Missing dividends leave total return unestimated. Operating margin cannot exceed a known assumed gross margin.

Unsupported EPS bridges, losses, missing inputs and incompatible currency/share bases remain unavailable. TWD local-share results are not converted to USD ADR values. Reference-price comparisons expire after 96 hours when evaluated in the browser. Scenario outputs carry no probabilities. Quarterly engine forecasts, training data and accuracy records are unchanged by edits to the full-year workbench.

Working scenarios remain in memory per company, survive company/view switching, reset visibly when their source/reference fingerprint changes, and clear on failed authorization or reload. Local JSON exports preserve inputs, the source fingerprint, evaluation time and recomputed outputs. No scenario writes to the server or model-learning ledger.

### Industry evidence

The full build and standalone forecast publisher compile the same already-collected memory, GPU-rental and CapEx snapshots. This adds no source scans or AI calls. Each observation retains its date or reporting period, unit, source and current/stale/missing state. The compiled relationships include relevant covered names outside the forecast cohort, with links to their stock report and the source feature.

Examples:

- Memory prices connect to MU's realized-pricing/mix questions, hardware buyers' input costs, and AI silicon's memory-supply constraints. SNDK/NAND and WDC/storage relationships explicitly distinguish their products from commodity DRAM.
- GPU offers connect to CRWV/ORCL/MSFT/AMZN/GOOGL operating economics and NVDA/AMD/DELL/SMCI customer-demand questions. Posted prices are not treated as utilization or realized transactions.
- Infrastructure CapEx connects spending companies to cash generation, depreciation and returns on capacity, and potential suppliers to orders, backlog, shipments and margins. Aggregate CapEx is not allocated into supplier revenue or multiplied automatically into EPS.

These are source-linked business relationships with confirmation questions. No unvalidated causal coefficient or stock-direction score was added.

## Storage and plan check

The connected Vercel account lists other projects but does not expose the Mingstreet deployment. No R2 or Blob credentials were available in this checkout. The owner of the hosting/storage account, its current consumption and remaining quota could not be verified. The user explicitly authorized implementing what could be established and reporting this uncertainty.

The implementation reuses the existing private object store and the existing two forecast files. It provisions no service, subscription, bucket, table, storage key family or schedule. It does not require a paid-plan change by design. That is not a guarantee of spare capacity or unchanged billing on the actual account.

The extra retained vendor-history state has a **500,000-byte hard limit**. A synthetic ten-company history with three years of five quarterly metrics measured approximately **251 KB**. This is a representative fixture measurement, not an audit of account usage. If new vendor observations would exceed the limit, their update pauses with a visible warning and the accepted in-window history remains intact. Other forecasts can still publish. Records are not silently discarded to fit the budget. The existing 3 MB UI-payload publication guard remains in place. SEC raw sources and the original forecast archive already exist and are not duplicated for the company view.

Generation publication temporarily retains earlier versions, so current-file size is not total billed storage. Larger existing files can also increase transfer/processing even when operation counts and key counts do not change. The account owner should confirm storage headroom before release and observe the first production build's measured bytes. No live data was uploaded to test capacity.

For context, current [R2 pricing](https://developers.cloudflare.com/r2/pricing/) separates stored bytes from read/write operations, and [Vercel Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) also depends on usage and plan. Neither public pricing page establishes this account's remaining allowance.

## Verification

`npm run test:research-stack` exercises the actual fixed functions, legacy ambiguity retention, raw/persisted evaluation equivalence, unfinished-session exclusion, the 29/30-window gate boundary, three-year expiry, observation deduplication and revisions, actual state-file persistence, full-year financial math, operating/gross-margin consistency, missing inputs, currency and quote-age exclusions, dilution, reverse valuation, business-line effects and immutability. Its assertions use synthetic financial data and do not measure forecast accuracy.

`npm run test:earnings-forecast-browser` exercises the generated site in desktop/phone and light/dark modes. It covers company records, full-year controls and exports, source-change resets, focus retention, industry links, HTML escaping, authorization loss, lazy loading and existing quarterly behavior. The preview simulates an Owner and labels its fictional data.

The existing forecast, grade-research, renderer, private-store, Owner Lab, picks, track-record, news, CapEx, sector-growth, freshness and workflow checks provide adjacent regression coverage. The new offline research checks are wired into the existing full-build workflow before provider/model collection. There is no new scheduled job.

## Remaining limits

- No account-level storage/usage confirmation, live publication, authenticated production UI test or paid subscription was performed.
- Three-year history is currently scoped to the existing forecast cohort. Other stocks appear in industry connections but do not automatically get a complete financial model.
- Existing source depth and accounting support limit the initial history. Missing periods are not backfilled with assumed values.
- The full-year workbench is a conditional financial/multiple sensitivity model. It does not add a complete business-specific operating model, calibrated target-price probabilities, a DCF engine, or independent market-consensus history.
- Historical data repairs preserve ambiguous evidence rather than asserting every old zero was an error. Forward performance must still be measured separately.
