# Changelog

All notable changes to **stonks** are recorded here, grouped under the date the
change landed (newest first). This root file carries only the **current month**;
each completed month is archived under [`docs/changelog/`](docs/changelog/) and
linked from the index below, so this file stays small.

Categories: **Added** (new features), **Changed** (changes to existing behavior),
**Fixed** (bug fixes), **Removed** (dropped features), **Perf** (performance),
**Docs** (documentation/CLAUDE.md).

<!-- CONVENTION (also in CLAUDE.md):
     - Add each new entry under a "## YYYY-MM-DD" heading for the day the change
       lands (create the heading + "### Category" subhead if missing — newest
       date first, categories in the order Added / Changed / Fixed / Removed /
       Perf / Docs). One bullet per change, present tense, plain language,
     reference the PR (#NNN) when there is one.
     - MONTHLY ROLLOVER: on the first entry of a new month, move ALL of the
     previous month's "## YYYY-MM-DD" sections into docs/changelog/YYYY-MM.md
     (same format, plus the archive preamble) and add that month to the
     "Older changelogs" index below. -->

## 2026-10-08

### Perf

- **Gemini cost: fetched article bodies sent to the per-ticker news/fundamentals read are now capped at 1,500 characters (was 3,000).** This matches the existing 1,500-character cap on RSS descriptions, so every article excerpt the model sees is the same length. The lead paragraphs carry most of the substance, and all headlines are still sent. `AI_ARTICLE_BODY_CHARS` is now wired into `daily.yml` as an Actions variable, so the cap can be raised again (e.g. back to 3000) without a code change. `scripts/build.mjs`, `.github/workflows/daily.yml`.

## Older changelogs

- [2026-09](docs/changelog/2026-09.md)
- [2026-08](docs/changelog/2026-08.md)
- [2026-07](docs/changelog/2026-07.md)
- [2026-06](docs/changelog/2026-06.md) — 458 entries
