# Leadership: who runs and controls each company

Added 2026-11-12. A **Leadership** tab on the stock page (`?tab=stock&s=AAPL&view=leadership`)
for every covered stock that is not an ETF. Library `lib/corporate-structure/`;
browser code `scripts/render/leadership-client.mjs` and `leadership-css.mjs`.
Public: everything shown comes from public SEC filings. No new serverless
function or workflow.

## What the tab shows

- **Who controls the vote**: one plain sentence (controlled, insiders hold a
  majority, one holder has the most sway, or spread out), the gap between a
  holder's share of the company and share of the votes, the votes per share of
  each class, and whether the company calls itself a "controlled company".
- **Seven views** of the same people, switched with one row of buttons:
  - *People*: a card per director and officer: role, independence, chair /
    lead independent director, tenure, shares, stake value, share of the votes,
    other companies.
  - *Org chart*: board on top (chair, lead independent director, committees),
    then the CEO and the officers under them.
  - *Web*: the company in the middle, its people around it, and the other
    public companies those people work at or sit on the board of. Other
    covered stocks are links.
  - *Voting power*: bars of each holder's and insider's share of the votes,
    beside their share of the shares.
  - *Tenure*: a timeline bar per person from the year they joined the board,
    took the role or first filed as an insider. A bar drawn from a first
    filing (not a stated start) is marked as approximate.
  - *Table*: every field in one sortable table.
  - *Changes*: new insiders, people who stopped filing, leadership 8-Ks
    (item 5.02) of the last 18 months, and the former insiders list.
- **Person detail** (click anyone): main job, committees, holdings by line
  (direct, trust, family), the proxy's ownership row beside the filing count,
  latest trades, other public companies with dates, and links to the filings.
- **Large holders**: the proxy's 5% table plus 10% owners that file Form 4s
  (filers on one joint filing are one holder; preferred stock is left out).

## Sources (all free, SEC only)

| Source | What it gives | How often |
|---|---|---|
| Submissions JSON (`data.sec.gov/submissions`) | which document to read (newest DEF 14A within 20 months, else a 10-K/A that carries Part III, else a 20-F / 40-F, else a recent 424B4), leadership 8-Ks | once a day per company |
| EDGAR full-text search (`efts.sec.gov`) | every Form 3/4/5 filed for the company in the last ~18 months, then new ones each day; each person's filings at other companies | once a day per company; people every 45 days |
| Form 3/4/5 XML | roles, officer title, holdings by line, trades | each new filing once |
| Proxy (DEF 14A), 10-K/A Part III or 20-F (plus the annual report exhibit a 20-F points to) | board list with independence, committees, director-since years, other public boards, executive officers, share classes and votes, the beneficial ownership table | one Gemini Flash-Lite read per new document |
| Filing index (`-index.htm`) | the annual report exhibit of a 20-F that refers to it for the board (Novo Nordisk's EX-15.1) | with that 20-F |

Gotchas found on the live filings:

- The search's `forms` filter must be `3,4,5`. Adding `4/A` returns nothing;
  amendments match under their root form.
- EDGAR's search answers a passing HTTP 500 now and then: one retry.
- Filer names in the XML are sometimes "First Last"; the search's own names are
  always "LAST FIRST", so those win (`c.names`).
- Proxy names use initials ("K. Ram Shriram") and married names added after
  the filing name ("Dina Powell McCormick" files as POWELL DINA); `samePerson`
  handles both, and never matches an entity.
- A Form 4 title of "See Remarks" points to the remarks field; a usable short
  remark becomes the title, else the proxy title stands. "COB" is chair of the board.
- Shopify files a 10-K and puts Part III (board, officers, ownership table)
  in a later 10-K/A, so a 10-K/A is read when there is no proxy; a proxy
  still wins over a newer 10-K/A.
- Novo Nordisk's 20-F says only "reference is made to the Annual Report" for
  the board and shareholders; the annual report is an exhibit (EX-15.1) with
  no description, so the largest EX-15 / EX-99 page of 300 KB or more is
  taken, and its board biographies and shareholder pages are added to the
  slice (`sliceAnnualReport`).
- The ownership table heading is printed in many ways ("Stock Ownership",
  "Holdings of Principal Shareholders", "5% Owners", "Shares Beneficially
  Owned") and mentioned dozens of times before the table; the table's own
  "as a group" row is a second anchor. The slice keeps the three places
  followed (or, for the group row, preceded) by the most ownership rows (a
  share count then a percent or "*"); pay tables full of dollar figures do
  not crowd it out, and "stock ownership guidelines" is skipped.
- Line breaks in the HTML source are spaces (a padded table put every cell on
  its own line, so Netflix's ownership table did not fit the slice and its
  5% holders were missing). Table rows read as one line each.
- Counts printed in millions ("1,075 million shares") match a share count
  when they have three or more significant digits. A table the model gives
  as fractions (0.015 for the printed 1.5%) is read as percents only when
  every value appears in the document times 100.
- Danish-style classes ("A shares", "B shares") are classes of their own, and
  a founder share (Shopify) is a class of its own, not common stock.
- The reply schema caps every list (`maxItems`, sent as a string: the API's
  int64 fields reject a number with 400 INVALID_ARGUMENT; a 400 retries once
  without the caps). The model does not always keep a cap: a free list of
  board roles looped ("Chair of the Board" hundreds of times) on Goldman
  Sachs, MongoDB and Shopify, so the board role is one value from a fixed
  list (`BOARD_ROLES`).
- A 20-F repeats the "Item 6. Directors, Senior Management" heading in the
  contents and in quoted cross-references; the slice starts at the unquoted
  heading with the longest span to Item 8.
- Since 2026-03-18 insiders of foreign private issuers file Forms 3/4/5 too, so
  TSMC's officers all filed a first Form 3 that spring. A Form 3 filed within
  120 days of a foreign company's first filing under that rule is not a start
  date; those people show no tenure until a document gives one.
- A 20-F gives English names ("Lora Ho", "Y.P. Chyn") while the Form 3s give
  legal names ("HO LI-MEI", "CHIN YUNG-PEI"). An officer named only in the
  document and one named only in the filings are merged when they are the only
  pair with that surname (or a surname one letter apart), or, among several,
  the only pair at the same rank (EVP, SVP, VP). Anything less certain stays
  apart.
- Form 4 titles are often cut short ("EVP, Chief Inn & Prod Dsg Ofcr"); a
  title with "Ofcr" has its abbreviations spelled out, and a few short words
  are spelled out in any title (Ops, Mktg, Mgmt, Svcs, Intl, Sr, Exec). "Vice
  President" never counts as the President role.
- Filer names with a surname particle ("DI SIBIO CARMINE"), a first name
  shortened from its end ("Dara" for Oluwadara) or a two-word surname before
  an initial ("NORA JOHNSON SUZANNE M") all match their proxy names. A filing
  director whose surname alone matches one board member nobody else matched,
  with no other filing director of that surname, is that board member.
- Ownership filings list every party, so a bank's own stakes in other
  companies (the bank as a 10% owner) turn up in its search. After one read
  shows the other issuer, its filings are skipped (`ownerOf`).
- Banks that issue notes daily have very large submissions files; up to 80 MB
  is read (the body is already downloaded when its size is known).

## Rules

- **Current people**: on the newest proxy's board or executive list, or filed
  in the last ~15 months and not dropped from a newer proxy's board.
- **Left the board**: a director (not an officer) missing from the proxy's
  board list who last filed before that proxy, or who has filed nothing since
  120 days after it (not put up for re-election at the annual meeting). A
  director whose Form 3 came after the proxy joined since and stays, marked
  "Not stated yet" for independence until the next proxy.
- **One row per person**: a filer is matched to the proxy's board and
  executive lists by name. When two filers fit one listed name, the closest
  fit wins (the same first name, then a middle name used as the first name,
  then a short form or an initial), so JIANG FAN is Fan Jiang and JIANG FANG
  JANE is Jane Fang Jiang. Two-word surnames with no initial (MONTGOMERY RICE
  VALERIE), letters that do not decompose (Danish ø, German ß) and degree
  words (MD, PhD) are handled. A board row and an executive row with two
  spellings of one person ("Eddie Yongming Wu" / "Eddie Wu") are paired, and
  the filed legal name shows as "aka" only when it really differs. Names the
  proxy prints in capitals are shown in normal case (McX, Jr. and Sr. kept),
  and honorifics (Ambassador, Admiral, Dr., Sir and so on) are dropped. The
  company is named as the site names it (Yahoo's "JPMorgan Chase & Co."), else
  EDGAR's name in normal case with A/S kept.
- **Funds and companies are not people**: a filer whose name is an entity
  (LLC, L.L.C., LP, GP, S.à r.l., B.V., Pte and so on) is a holder, never
  matched to a director or officer.
- **Independence**: an executive on the board is never independent; otherwise
  the proxy's word.
- **Newest filing wins** for a role: a Form 4 filed after the proxy decides
  the title, so a new CEO shows before the next proxy. One CEO, one chair, one
  CFO, chief accounting officer, chief legal officer, COO and controller: when
  two people carry one of these, the newer filing's holder keeps it and the
  other moves to former (a director keeps the board seat) with a note.
- **Co-CEOs**: when both titles say co-CEO (Netflix, Oracle), both keep it,
  and the header and org chart name both. A CEO replaced by a newer filing
  who still sits on the board keeps the seat (and a chair title) and loses
  the CEO title; one with no seat moves to former, "replaced by" the new CEO.
- **Past roles**: a title keeps only its current part ("Executive Vice Chair
  and former CEO" is Executive Vice Chair). A newer Form 4 that still says a
  role the proxy calls past (the old CEO box ticked again) keeps the proxy's
  title. An executive the proxy lists only as former, or whose filing after
  the proxy no longer says officer, is not current. A director whose Form 4
  ticks only "officer" stays a director until the next proxy.
- **Titles**: Form 4 short words are spelled out (Chf Fin Ofcr is Chief
  Financial Officer; Corp, Gen, Sec., Ops, Intl, Svcs and so on), sentence-case
  titles are capitalised and COB reads Chair of the Board.
- **Holdings**: the latest Form 3/4/5 line per class and holding (direct,
  each trust; a holding filed only as "See Footnote" is told apart by its
  footnote text, so Broadcom's Henry Samueli shows all of his trusts), unless the proxy table shows a class those filings have not
  reported, or there are no filings (foreign issuers).
- **US depositary shares (ADS)**: totals, value and votes count each ADS as
  its ordinary shares (`ADS_RATIO`: TSMC 5, Alibaba 8; ASML, Novo Nordisk and
  Arm 1), and the detail says so. Value is ordinary shares × the US price ÷
  the ratio.
- **No shares**: someone whose filings report no shares shows "None" rather
  than a blank.
- **10% owners**: a fund that files as a 10% owner but whose filed lines come
  to under 1% of the votes is left out of large holders (its last Form 4
  listed one small line, not its stake).
- **Votes**: shares × votes per share over the votes of every voting class.
  Stakes under 0.01% keep two significant digits, so the page shows "<0.01%"
  rather than 0.
  A holder of only a non-voting class has 0% of the votes. When the votes per
  share vary (Palantir's Class F), the proxy's voting-power column is used.
- **Other companies**: from the person's own filings at other issuers (public
  companies with a ticker, or confirmed by reading their filing there; private
  funds they co-file with are left out), plus the proxy's list of other public
  boards. A link to another covered stock counts only while that stock's own
  view lists the person as current, and shows from both sides.
- **Tenure label**: the number says what it counts from: "On board" (proxy
  director-since year), "In role", "At company", or "Insider" / "Filing" when
  only the first filing is known. A start drawn from a first filing that is
  under a year old shows "—", not "<1", because it may be much older.
- **Display**: long titles are shortened in the org chart and web (EVP, SVP,
  CFO and so on, cut at a word with "…"); the full title is on the card and in
  the detail. On a phone the web scrolls sideways at a readable size instead
  of shrinking, and the detail tables scroll inside their own box. A holding's
  footnote gets its own row under the line, and the "as of" column is left out
  when every line has the same date. A company where nobody has a start year
  (a 20-F gives none) shows no years on the cards. Card contents stay inside
  the card however long a chip or title is. The large holders table shows one
  "Stake" column for a one-class company and both "Of its class" and "Of all
  votes" when there are several classes.
- **Departures**: the Changes list and the former table say why someone left
  (not on the board list in a given proxy, or someone else holds the role).
- **Proxy check**: every name, share count and percent the AI returns must
  appear in the document text (`checkProxyFacts`); anything not found is
  dropped and counted on the tab. A reply cut off at the token limit or not
  valid JSON is asked once more with a larger limit (counted as a second AI
  call in the day's budget). If that one is cut off too, what either reply
  finished before the cut is kept and marked partial (`salvageJson`): the tab
  says so, a partial board list ends nobody's seat, and the document gets one
  more read on a later day.
- **Funds and empty pages**: covered funds that are listed like stocks
  (`CORP_FUND_SYMS` in `build.mjs`: DRAM) show a short note instead of the
  tab. A company that files no proxy or 20-F and whose insiders file no Forms
  3/4/5 (a foreign filer whose insiders are exempt) gets an empty view that
  says so and links to its EDGAR page.

## Files and switches

- `corporate-structure.json`: the collector state (Owner-only internal cache,
  read before the wipe, `OPTIONAL_BAKE_KEYS`). The public read is the
  `corporate` block in each `data/<SYM>.json` (`buildCorporateViews`).
- Budgets per bake: decision runs (11:00, 15:30 ET) 60 SEC requests, 25 s,
  2 AI reads; other bakes 450 requests, 150 s, 6 AI reads; at most 3,000 SEC
  requests and 15 AI reads a day. The first week fills the universe; after
  that a quiet day is a few dozen requests.
- Cost: about $0.003 per document read with Flash-Lite, roughly once a year
  per company (about 80 reads a year), plus re-reads when a proxy is amended.
- `CORP_STRUCTURE=0` keeps the prior data and makes no SEC requests;
  `CORP_STRUCTURE_AI=0` stops the document reads (filings still update).
  Both are repo variables passed by `daily.yml` and switches on the Owner
  Settings page. `AI_CORP_MODEL` overrides the model.
- Manual audit against the live SEC: `node scripts/corporate-structure-live.mjs AAPL META [--ai]`
  (writes only to `out/corporate-live/`).
- Tests: `npm run test:corporate-structure` (offline, fixtures in
  `scripts/fixtures/corporate-structure.mjs`) and `npm run test:corporate-structure-browser`
  (every view at 1440 light and 390 dark on the same fixture).
