# Policy and news data (Federal Register + GDELT)

Added 2026-11-19 (owner request: "implement all the free providers"). Code in
`lib/policy-news/`. Free, no key, no AI call. This is the data layer the
planned shock detector (engine roadmap wave 2) will read. Today it feeds only
the shadow log and the Owner MCP; **nothing reads it into a pick, a grade, a
gate, an engine or a record.**

## What is read, and when

Once per ET trading day, on the first bake after 09:00 ET that is not a Top
Picks run (normally the 10:00 ET bake), the same slot as the AI disruption
collector, so it never delays a pick. The reads start at the top of `main()`
and run while the option chains load; the result is awaited just before the
shadow signals.

| Source | Calls a day | What we keep |
|---|---|---|
| Federal Register documents API (`federalregister.gov/api/v1/documents.json`) | 1 to 3 (1,000 documents a page, last 3 days) | Rules, proposed rules and presidential documents from a mapped agency; any document whose title or abstract names a covered company or a mapped topic; every presidential document (market wide). 30 days kept, 1,500 at most. |
| Federal Register public inspection (`public-inspection-documents/current.json`) | 1 | Documents filed today for tomorrow's issue, tagged the same way, marked `pending`. The published copy replaces it the next day. |
| GDELT DOC 2.0 (`api.gdeltproject.org/api/v2/doc/doc`) | about 70 to 80 | Per covered stock (funds left out): articles in the last 24 hours, the six-day daily average before it, their ratio, and (only when the ratio is 2+ with 10+ articles, at most 12 a day) the average tone of each window. One row per ET day, 90 days kept. |

GDELT asks for at most about one request every five seconds; the reader waits
5.5 s between calls, stops the pass on a rate-limit answer, and has a 6-minute
budget. Stocks it did not reach stay due and are read on the next
non-Top-Picks bake the same day.

## Tagging rules (Federal Register)

`lib/policy-news/federal-register.mjs`:

- `AGENCY_RULES`: CMS (UnitedHealth, drug makers), FDA (drug makers), BIS
  (chip makers), USTR (importers), SEC (brokers), CFPB (card networks and
  big banks), Fed / OCC / FDIC (banks), FAA (Rocket Lab, SpaceX), FERC / DOE
  (power names). FTC, DOJ Antitrust and ITC add stocks by company name only.
  A notice from a mapped agency counts only when a topic or a name matched.
- `TOPIC_RULES`: chips and export controls, tariffs, drug pricing, GLP-1,
  vaccines, Medicare Advantage, bank capital, card fees, crypto, broker rules,
  commercial space, the power grid and data centers.
- `FR_NAMES`: legal-style, case-sensitive company names, so a farm notice
  about apples never tags Apple.

Each kept document carries `tickers` and `why` (`agency:<id>`, `topic:<id>`,
`name`).

## File

One Owner-only key, `policy-news.json` (`lib/premium-keys.mjs`,
`OPTIONAL_BAKE_KEYS`), read before the wipe and written after it:
`{ version, updatedAt, fr: { lastRunDate, lastOkDate, stale, docs, health },
gdelt: { date, done, lastOkDate, stale, days: { SYM: [{ d, vol24, base,
ratio, tone24?, toneBase? }] }, health } }`. A failed read keeps the prior
block marked `stale`. Source health rows `federal-register` and `gdelt-news`.
MCP: `get_feature quant` dataset `policy-news`.

## Shadow keys (version 9)

`lib/shadow-signals.mjs`: per name `frn` (tagged Register documents, last
three days or filed for tomorrow; 0 when read and nothing matched), `nvr`
(news volume ratio), `ntn` (tone change on a volume spike); market gauges
`frp` (presidential documents, three days) and `nvs` (stocks with a news
spike, when 10+ were read). Measured by `lib/shadow-research.mjs` on the
Evidence board like every other shadow key; nothing scores them.

## Held names on the Owner brief (2026-11-19)

`heldPolicyNews` lists the names with an open Top Picks or strategy-engine
trade that have a tagged Register document in the last three days (or on the
public inspection list) or a news spike (2x usual volume, 10+ articles),
two documents per name at most, from fresh reads only. The bake passes it to
the Owner Market Brief as `desk.policy`, which shows one finding, "News or a
federal rule on a name you hold" (priority 1 when a document is marked
significant or the spike is 4x or more). Context only: no trade rule reads it.

## Switches

Owner Settings, Data & desks, Data sources: `FEDERAL_REGISTER` and
`GDELT_NEWS` (on by default). Off = no request; the prior block is carried.

## Terms

The Federal Register is a US government work (public domain). GDELT is open
for any use with credit ("GDELT Project", gdeltproject.org); the MCP summary
carries the credit line.

## Test

`node scripts/policy-news-smoke.mjs` (offline; fake fetches). Neither host
was reachable from the build sandbox, so the first live 10:00 ET bake is the
first real read; check its log lines `Federal Register:` and `GDELT:`.
