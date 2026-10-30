# Ownership explorer

Who owns what searches the full collected public 13F books for the existing tracked-manager directory. The explorer does not treat the older top-20 change tables as complete portfolios.

Use **By stock** to search a ticker, an issuer name, or a CUSIP. A resolved ticker or CUSIP matches that identifier exactly. Other searches match words in the issuer name. Results show each reporting manager, the share count or principal amount, the reported quarter-end value, the prior-quarter figures, the stock-book weight, and the SEC source. Calls and puts remain separate from stock holdings.

Use **By fund** to search a manager name, a style, or a CIK. Open a manager to search its portfolio. The directory sorts by AUM estimate, reported 13F value, quarter price-return proxy, position count, top-10 stock concentration, filing date, or name. Unknown values sort last in either direction.

Open **Disclosure details** for the class, the option designation, the investment discretion, the other-manager reference, the voting authority, and the original source rows. **Download results** saves every matching result, including source rows beyond the visible page, as JSON. Stock searches also include matching transactions from the existing collected Form 4 feed.

## Data and calculations

The collector selects one completed reporting window for all tracked managers. Deadlines move past weekends and holidays, and the new quarter becomes active after the deadline day in Eastern time. The collector follows older SEC submissions pages when needed. It reads raw primary XML and every information table, then reconciles the parsed row count and value against the filing cover. Additive amendments retain the preceding book. Restatements replace that book. Missing amendment predecessors make the book unavailable. A failed prior-quarter fetch does not prevent current holdings from appearing, but changes and the price-return proxy remain unknown.

Viking uses SEC CIK `1103804`. Pershing Square Capital's second-quarter 2026 notice refers to its parent, Pershing Square Inc., CIK `2026053`. The collector follows an unambiguous notice reference and labels the result as the parent's reported portfolio. It does not attribute all parent holdings exclusively to the tracked subsidiary or compute changes across different reporting entities.

AUM is an undated estimate from the existing curated directory. Reported 13F value is a separate figure. Option values represent underlying notionals, not option premiums. Manager books can overlap, so sums do not measure unique ownership across institutions.

The quarter price-return proxy holds prior-quarter long stock weights constant and applies historical price changes on a common split-adjusted basis. The proxy requires at least 80% coverage by prior stock value. Issuer identity and the prior reported price must match the historical listing. The proxy excludes dividends, trading, fees, shorts, and derivatives. It is not an actual fund return. Share-count differences remain on the reported basis and can include splits.

Search coverage is limited to successfully collected public books and resolved identifiers. Unresolved tickers remain searchable by issuer name or CUSIP. Existing mappings are reused. The bounded mapping pass prioritizes valuable positions and rotates previously unsuccessful identifiers so they cannot block the remaining queue indefinitely. Mapping coverage is shown in the page. The explorer does not collect all SEC filing types, confidential positions, shorts, or private assets. The Form 4 feed retains its existing 60-day lookback, two filings per issuer per pass, and 120 retained transactions.

## Publication

`lib/ownership-13f.mjs` parses and groups disclosures. `lib/ownership-explorer.mjs` owns search and sorting. `lib/ownership-books.mjs` splits publication into immutable files under `13f-books/`, each below 750 KB. The root `13f.json` contains metrics and references to those files.

The browser reads summary files for searches and loads source rows when a detail is opened or results are downloaded. Reads have a 20-second limit and a complete summary load has a 30-second deadline. Missing or incomplete summary files exclude that manager from search and expose a retry action. Corrupt responses are removed from the cache so retry performs another read. A failed disclosure download produces an error instead of an incomplete export.

A temporary source failure preserves an intact same-quarter book with its original collection date and a retained-data label. Before the data-directory wipe, the build reads the prior files needed for fallback and a 24-hour reader grace window. Old grace entries keep their expiry. The full bake copies the current and unexpired grace files, removes orphan files, and publishes a verified root-to-summary-to-disclosure graph. The freshness check rejects missing references, incorrect hashes, mismatched values, and unbounded retention. Obsolete logical keys become eligible for removal. Intraday scanners do not hydrate the full source books.

The next successful full data build writes the complete books. A code deployment alone cannot populate holdings from an older top-20 payload. No additional model calls are introduced.

## Verification

- Run `npm run test:ownership` for parsing, collection, amendments, exact ticker search, fund sorting, performance coverage, split handling, file-size limits, and partial-file failures. All network responses in this check are synthetic.
- Run `npm run test:ownership-browser` for the shipped page, stock and fund searches, on-demand disclosure rows, pagination, downloads, missing files, and retry behavior. The browser check covers desktop, tablet, and narrow mobile layouts in both themes. Set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` when those dependencies are outside the default installation.
- Run `npm run regen:ownership` after changing the ownership renderer. The command updates the ownership section and asset cache keys while preserving other page sections, research timestamps, and the embedded interest-rate metadata.
- Run `npm run preview:ownership` to open a local preview with synthetic data.
- Run `npm run audit:ownership -- --live --output=/tmp/ownership-audit.json` for a read-only SEC source audit. This command reuses existing ticker mappings and deliberately skips new OpenFIGI lookups. It never publishes data or invokes AI.
- Run `node scripts/ownership-snapshot-check.mjs --input=/absolute/path/to/saved-full-ownership-snapshot.json` to check a saved real snapshot through publication, freshness verification, and the shipped browser. Browser dependencies use the same environment variables as the browser suite.
