# Ownership collection audit, October 29, 2026

The public production snapshot inspected during this audit contained quarterly summaries for 12 of 14 tracked managers. It did not yet contain the new full-book search format. The corrected collector read all 14 managers from live SEC sources for the quarter ended June 30, 2026. Every accepted source book reconciled to the filing cover's entry count and reported value.

The saved full snapshot passed the actual local publisher and freshness verifier with 137 immutable files. Its largest file was 749,966 bytes. Desktop and mobile browser checks loaded the full snapshot through the same data URL shape used by production. These checks did not deploy code or publish the collected snapshot.

## Collection defects fixed

- Viking's directory CIK was incorrect. Its verified CIK is `1103804`. [SEC quarterly filing](https://www.sec.gov/Archives/edgar/data/1103804/000110380426000006/primary_doc.xml).
- Pershing Square Capital filed a notice referring to its parent, CIK `2026053`. The collector now follows that reference and labels the parent portfolio. Cross-entity comparisons remain unavailable. [SEC notice](https://www.sec.gov/Archives/edgar/data/1336528/000117266126003777/primary_doc.xml).
- Styled primary-document paths returned HTML instead of raw XML. The collector now reads raw XML, including Citadel's restatement. [SEC amendment](https://www.sec.gov/Archives/edgar/data/1423053/000110465926104387/primary_doc.xml).
- Archived submissions, multiple information tables, cover reconciliation, missing predecessors, and failed same-quarter collections now have explicit handling.
- Reporting windows respect weekend and holiday extensions and wait until the deadline day has finished in Eastern time. [SEC filing guidance](https://www.sec.gov/rules-regulations/staff-guidance/frequently-asked-questions-about-form-13f).

## Publication and interface defects fixed

The freshness policy previously held back the new holdings files while allowing the root file to reference them. The verifier now checks the complete file graph before publication. Current files and a bounded 24-hour grace set remain available, and obsolete logical references can be removed. Intraday scanners skip the full source books.

Browser fixes cover cached corrupt responses, stalled requests, exact ticker matching for Form 4 disclosures, issuer-name and CUSIP joins to the insider feed, and prices below one dollar. Existing searches, sorting, pagination, raw disclosure details, and complete result downloads passed the expanded browser suite at desktop, tablet, and narrow mobile widths in both themes.

## Remaining source limits

The directory is a curated list of 14 reporting managers, not a census of all institutional holders or a list of individual funds within each manager. AUM remains an undated directory estimate. The sortable performance measure remains a covered-stock price proxy, not a verified fund return. Live source collection in this audit omitted price enrichment, so it does not establish live proxy coverage.

Ticker resolution is separate from source-book completeness. The live check reused the production snapshot's existing mappings and deliberately skipped additional lookups. Mapping completeness remains limited by the provider budget. The implementation now retains mappings, rotates unresolved identifiers, prioritizes valuable positions, and displays unresolved coverage. Issuer names and CUSIPs remain searchable. [OpenFIGI limits](https://www.openfigi.com/api/documentation).

13F filings omit shorts, private assets, and confidential positions. Shared reporting can overlap between managers. Form 4 collection remains capped at the existing lookback and transaction limits. These limits are disclosed rather than represented as zero holdings or complete market coverage.

## Rerunnable evidence

`npm run test:ownership` covers source parsing, collection failures, archive history, cover totals, search and sorting, mapping rotation, retries, timeouts, retained-file rollover, and the actual freshness and upload boundary. `npm run test:ownership-browser` exercises the shipped page. `scripts/ownership-snapshot-check.mjs` checks a saved full snapshot at real-manager scale. `npm run audit:ownership -- --live` performs a read-only SEC check.
