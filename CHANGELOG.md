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

### Added
- Top Picks landing cards now show a `⏱ N×` consecutive-build streak chip (how many builds in a row the ticker has held a top-picks spot), mirroring the detail card's existing tenure badge. Shown only when the streak is >1.

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
