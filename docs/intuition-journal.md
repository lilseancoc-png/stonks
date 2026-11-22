# Intuition journal (Owner only)

A private, forward-looking market journal for the two Owners (MiniMe and
LilSean). It opens like a notepad on the right side of the screen and stays
there while you move from page to page, so you can write what you think the
market will do and pin what you see on the site as evidence.

Added 2026-11-22. No AI call, no new serverless function, workflow, download
or dependency. Storage is the existing private R2 store.

## What it does

- **Journal button** in the header (notebook icon, beside the settings
  button; `Alt+J` opens and closes it). Shown only with the signed Owner
  session (both `tr` and `tp` claims), never on a public visit and never
  inside a split-view pane.
- **Panel on the right.** On screens wider than a phone the page shrinks
  beside it (body `padding-right: var(--jr-w)`), so it works as a split view
  that follows you across every page. Drag its left edge (or focus it and
  press ←/→) to resize, 320 to 760 px; the page always keeps at least 480 px,
  and the header switches to its compact form while the panel is open. Split
  view (two pages side by side) sits to the left of the panel. On a phone it
  is a full-screen sheet.
- **Write.** A text box (Ctrl/Cmd+Enter saves; paste a picture to attach
  it), optional tags, and an optional **call**: subject (a ticker or
  `MARKET`), direction (up / down / flat), target price, by-date and
  confidence 1–5. The draft is kept in this browser until you save
  (`stonks-journal-draft-v1`).
- **Evidence from the site.**
  - *Pick a value*: click any number, table row, card or chart point. A row
    is logged with its column names ("Ticker: NVDA · Premium: $4.2M"), a
    chart point with its hover label. Each item records the page, a link
    back to it, the nearest "as of / updated" time on the card (else the
    site build time) and when you logged it. ↑/↓ grow or shrink the
    selection, Enter takes it, Esc stops. On a touch screen the first tap
    selects and **Log it** confirms. Works inside split-view panes too.
  - *Snap a card*: saves a picture of a card, chart or table
    (html-to-image, already used by Export), JPEG under 1.4 MB.
  - *Add image*: a picture from your device (JPEG, PNG or WebP).
- **Saved with the time.** The server stamps each entry with the exact time
  (UTC, shown in your display time zone with the year), the author and the
  browser's time zone. Saving also records the market at that moment
  (SPY, QQQ, VIX, 10-year yield, dollar, oil, gold from `/api/macro-live`)
  and the subject's price (`/api/quotes`; SPY for `MARKET`).
- **Review.** Entries newest first, grouped by month; search, filter by
  owner and by calls (open, due, right, wrong, mixed), tags as filters, a
  tally of calls marked right / wrong / mixed, and for each call the live
  move since it was written ("NVDA 190.00 then, 199.50 now: +5.00% (with
  the call)", "target reached"). Pictures open full size.
- **Edits keep the record honest.** Editing keeps the original time and
  the market snapshot; the earlier text, tags, call and evidence are
  kept as "Earlier versions" (up to 20; loaded when you open them), and a
  picture removed in an edit stays for the version that had it. Only the person who wrote an entry can edit
  or delete it. Either Owner can **mark the result** (right / wrong / mixed
  with a note).
- **Links.** "Copy link" gives `/?journal=<id>`, which opens the panel on
  that entry.

## MCP

`get_journal` (Owner only, read-only, `lib/mcp/journal-tools.mjs`) returns
entries with every field above except the picture bytes, plus an
`open_on_site` link. Filters: `id`, `query`, `author`, `symbol`, `tag`,
`direction`, `outcome` (`right`, `wrong`, `mixed`, `open`), `since` /
`until`, `limit` (≤ 100), `include_history`. The tool reads through
`journalReadOnlyStore`, which can read only the journal record. A connected
AI client needs to refresh its tool list to see it.

## Storage and access

| Piece | Where |
| --- | --- |
| Entries | `_stonks/journal/v1/entries.json` (raw private key, outside published data: never synced, never served by `/data`), written under the R2 lease `intuition-journal` |
| Pictures | `_stonks/journal/v1/shots/<id>` (one object each, ≤ 1.5 MB, JPEG / PNG / WebP checked by their first bytes) |
| API | `api/auth/[action].js` actions `journal` (GET list, POST add / edit / outcome / delete / discard) and `journal-shot` (GET a picture, POST upload). Owner session required; POSTs must be same-origin; responses are `private, no-store`. |
| Rules | `lib/intuition-journal.mjs` (pure: validation, edits, history, queries) |
| Page | `scripts/render/journal-client.mjs` + `journal-css.mjs`, pasted into `app.js` |

Limits: 8,000 characters of text, 8 tags, 12 evidence items and 8 pictures
an entry, 3,000 entries. Deleting an entry deletes its picture objects
(inside the save lock, so no other save can pick one up meanwhile); a
picture uploaded for a draft that is cleared is discarded. The `symbol`
filter of `get_journal` accepts only a ticker or `MARKET`.

## Switch

Owner Settings → Live site → **Intuition journal** (`JOURNAL_ENABLED`, on by
default; `0` in Vercel does the same). Off hides the button and turns the
API and the MCP tool off for both Owners; every entry and picture is kept.

## Tests

`node scripts/journal-smoke.mjs` (server rules, access, pictures, switch,
MCP tool) and `node scripts/journal-browser.mjs` (Playwright: desktop light
and dark as both Owners, split view, phone, public visitor; no npm script).
