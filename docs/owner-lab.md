# Owner Lab

Owner Lab uses the existing signed Owner session and the existing data feeds.
Its three internal views serve different tasks:

- **Personal tools** opens by default. It contains the held-contract checker,
  index DCA baseline, and the two account-risk sizing panels. Sector Rotation
  and leveraged ETF data load when their sizing panel opens.
- **Research screens** loads `quant.json` when opened. It shows a compact
  overview, unusual price moves, and volatility-premium readings. Peer pairs,
  option-surface readings, dispersion, and earnings drift sit in an advanced
  disclosure. Qualified pairs are the default; the watched-pair filter keeps
  the remaining rows accessible. Definitions and the static playbook are help.
- **Diagnostics** prepares three closed panels. Evidence Record, Company
  relationships, and AI Grader Log fetch their existing files on first open.

## Pricing and sizing

The position checker requires a positive, uncrossed bid/ask midpoint, a
regular-session response, and a fetch timestamp within five minutes before
issuing a hold/sell verdict. Missing prices produce **Price unavailable**.
Last-trade, stored-build, closed-market, and stale or undated responses produce
**Reference only**. The output names its price basis and fetch/build date.
Fetch time is response provenance; the upstream last-trade time is unavailable.
The existing contract endpoint, profit target, and stop remain in use.

Both sizing tools withhold share caps for Pass setups. Waiting setups label
any displayed cap hypothetical. The existing quote requirements and cash caps
remain in force.

## Evidence meanings

Version 2 daily records retain the existing piece fields and add one version
number at the record root. `dir: "pending"` means fewer than 20 prior
observations of that metric in the existing 60-day window. It does not mean
measured neutral. A neutral piece in an older record has unknown baseline
readiness and is labeled accordingly.

Metric identifiers separate quantities that previously shared a history:

- `sr-pos`: support-to-resistance range position, percent of the range.
- `sma-gap`: percent distance from the 20-day moving average.
- `earn-pre`: ten-session price move before upcoming earnings.
- `earn-eps`: reported EPS surprise, percent.
- `earn-run`: pre-report price run-up when surprise is unavailable.
- `earn-tone`: categorical management tone, independently labeled.
- `iv-z`: own-history implied-volatility z-score.
- `iv-5d`: five-session implied-volatility percentage change.

Legacy `structure`, `earnings`, and `iv` readings remain readable in old files.
They do not populate the new identifiers' baselines. Old archives are not
rewritten or backfilled. The field historically called `gamma` is displayed
as a call/put open-interest ratio, which is what its source records.

Company selection shows one company's measurements, definitions, source dates,
baseline readiness, and links to source research. Raw fields stay optional.
Descriptions live in the browser code, not in every stored piece.

Company relationships translates the stored industry, sector, peer, narrative,
and input edges into readable labels. The displayed returns belong to the
company; they do not measure relationship strength or causation.

The grader log combines a company's side-specific thesis and timing records
only when their recorded timestamps match. Different runs and undated records
stay separate so an earlier rejection cannot hide a later pass or borrow its
price. Each row shows its recorded time in Eastern Time. Passing thesis quality
can coexist with waiting for entry. The original daily JSON remains available
in a disclosure. Group-only relationship edges do not show company returns.

## Research integrity

Each volatility-premium row uses a single matched IV/price-history date for
IV, realized volatility, premium, and its z-score. The observation date is
visible. An IV percentile is omitted when its source date differs.
Post-earnings averages show separate beat and miss counts; older payloads with
no separate counts say that sample information is unavailable. Partial payloads
keep their available screens visible rather than claiming no build exists.

## Request and storage limits

This change adds no AI calls, data-provider calls, scheduled runs, services,
history-read windows, or storage-key families. Evidence still uses the existing
61-key bounded read and two writes. Compact metric identifiers and a root
version identify meanings without storing repeated descriptions. Matched-date
and sample-count metadata slightly increase the existing overwritten quant
payload; they do not create another accumulating archive.

Diagnostics retains a loaded snapshot until the user clicks **Refresh opened
records** or retries a failed panel. Only opened records refresh. Search and
filter changes reuse loaded data. Research has its own explicit refresh button.
Repeated clicks while a request is pending do not start another request batch.
There is no new automatic polling or automatic archive-history browsing.

These controls limit added usage; they do not guarantee a fixed provider bill.
Automatic freshness probes, expanded historical browsing, richer persisted
evidence, and any new external source require a separate cost review.

## Verification

Run `npm run test:owner-lab` for offline behavior checks, including missing and
reference prices, rejected sizing, legacy/collecting evidence, matched VRP dates,
partial research payloads, and explicit-refresh request counts. Also run the
existing evidence, Link Map, AI rejection, renderer, private-store, AI-cost, and
workflow-schedule checks. Preview the generated page with fixture data to check
the three views, keyboard navigation, record selection, filters, and narrow layouts.
