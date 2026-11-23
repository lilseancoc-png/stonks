# Owner controls (kill switch and quick controls)

Added 2026-11-19 (engine roadmap, thread 4). Owner only. Code:
`lib/owner-controls.mjs` (rules, pure), `api/auth/[action].js` action
`owner-controls` (read and save), `scripts/render/owner-controls-client.mjs`
(banner, panel, scorecard). Tests: `node scripts/owner-controls-smoke.mjs`,
`node scripts/owner-controls-browser.mjs`, plus the owner-control checks in
`picks-smoke`, `event-play-smoke` and `api-smoke`.

## What the Owner can do

| Control | What it does | Ends |
|---|---|---|
| **Stop new trades** | No new Top Picks record trades, no new strategy-engine trades (not even shadow trades), no new Webull paper opens. Every exit keeps running. The LEAPS, Leveraged ETFs and Sector rotation paper logs keep logging (they never trade). Confirm box. | When the Owner resumes |
| **Avoid** a stock | No new entry on it in any engine or in Top Picks. With "close its open trades" (confirm box), every open trade on it opened before the avoid closes at the next 11:00 or 15:30 ET run, as the counted status `owner-avoid`. | When lifted, or on an optional end date |
| **Watch closely** | The stock goes to the front of each signal engine's queue and first among the ready names for Top Picks' six AI review slots. No bar is lowered. | Five sessions, counting today until the close (`watchUntil`) |
| **Flag a catalyst** | One line (optional stock, text, date) shown on Top Picks, Open picks, the engines page and Owner Settings until its date. Display only. Trades on that stock are stamped `catalyst` for the scorecard. | Its date |
| **Risk dial** | Safer: signal-engine trades buy half the contracts or shares, their entry bar is 5 points higher, and the whole run opens one new trade (engines and Top Picks each). Riskier (confirm box): 1.5x the contracts or shares (at most the engines' contract and premium caps, `ENGINES_MAX_QTY` / `ENGINES_MAX_PREMIUM_USD`, 200 contracts and $200,000 unless set (a put 100 and $100,000; 25 contracts before 2026-11-23, 10 before 2026-11-20), and a share trade at most `ENGINES_SHARES_MAX_USD`, $250,000, unless a trade already had more), entry bar 3 points lower, and back to the normal size when 1.5x would pass an account limit. Not tied to fear. Top Picks' bar and size are unchanged by either setting (its grade is on a different scale). | Friday's close (13:00 on a half day; after that close, the next Friday) (`dialUntil`) |
| **Check this stock** | Read-only: every engine row for the stock at the last run (setup, side, score against the bar, opened or why not), its open engine trades and a live quote. | Nothing saved |

Every change is logged (who, when, what), and the change log has **Undo**,
which puts back the state before the newest change not yet undone, one step
at a time. Expired items move to `past` on the next save; they stop applying
at their end whether or not anything is saved.

The **never-trade list** (`lib/never-trade.mjs`, 2026-11-23: VIX products
and USO, plus the shares-only names DRAM, KWEB and EWY) sits beside Avoid on the card but is not a control: it is locked in code,
always on (also with `OWNER_CONTROLS` off) and read-only here and in Owner
Settings. See `docs/engines.md` "Never-trade list".

## Account limits

Five Owner Settings numbers (Owner Settings → **Account limits**, beside the
kill switch), the first four 0 = off until the Owner sets them, the open
engine stock cap on at $1,000,000 unless set (0 = off; added 2026-11-23,
owner: "a 1m total position at any point"), each a "Big impact" setting with
its own confirm box:

| Setting | Engines | Webull paper mirror |
|---|---|---|
| `ACCOUNT_LIMIT_OPEN_USD` | open option premium (signal and core option trades, at cost) plus the new trade must stay under it | open premium in the paper account (both records) plus the new order |
| `ACCOUNT_LIMIT_DAY_LOSS_USD` | signal engines: today's closed results plus the open book's move since the day's first run; at or past it, no new signal trade that day | today's realized result from paper close fills |
| `ACCOUNT_LIMIT_NAME_USD` | money in one stock across every engine's open trades (options and shares, at cost) plus the new trade | the same in the paper account |
| `ACCOUNT_LIMIT_NEW_PER_DAY` | new signal-engine trades opened today (ET) | new paper opens today (skipped and missed ones not counted) |
| `ACCOUNT_LIMIT_SHARES_USD` | open engine stock at cost (every share trade, core holding and paper trial) plus the new share trade; option trades are not held by it | live stock lots in the paper account at fill price plus the new stock order (held at the default even when the saved settings cannot be read) |

The bake reads them through the Owner Settings preload (a repo variable,
when set, wins). The mirror and the page read the saved setting from the
store, and a Vercel value wins. A trade a limit holds back is not opened and
not tracked as a shadow trade; its reason names the limit. In the engines,
the core engines (Trend follower, Momentum basket) are not counted against
the daily loss stop or the new-trades count, since they hold a standing
monthly book. In the Webull paper account every order is real, so every open
counts toward the day's count and every close toward the day's loss there,
core engine share lots included (unless Webull share orders are off). Share lots
are priced per share (options per contract, x100); they count toward the per
stock cap but not the open option premium cap. Top Picks keeps its own book
cap. A limit never closes an open trade.

## Where it acts

- **Bake** (`scripts/build.mjs`): `readOwnerControlsForRun` reads the
  hydrated `owner-controls.json` before the wipe (like `top-picks-mode.json`)
  and passes the controls in force, with the limits, to Top Picks
  (`writeTopPicksFile` → `generateAiTheses` and `buildTopPicks`),
  `updatePicksAccuracyFile` and `runEngines`. `regen-picks.mjs` reads it the
  same way.
- **Top Picks roster:** `openPickPrecheck` returns `owner-control` for a
  stopped run or an avoided stock, so it takes no AI slot;
  `prioritizeAiSlots` moves watched ready names first; in `buildTopPicks` a
  held name gets `entry.signal` `wait-owner` (watch list, traced as gate
  `owner-control`, listed in `rosterMeta.ownerControlHeld`);
  `rosterMeta.ownerControls` records what was in force.
- **Top Picks record:** never enrolls under Stop or for an avoided stock;
  Safer enrolls one trade a run; an Avoid with close shuts a trade opened
  before it as `owner-avoid` (checked after the price exits, before the event
  exits); new trades carry `ownerControls` `{ dial?, watch?, catalyst? }`.
- **Engines** (`stepBook` in `lib/engines/book.mjs`, input `controls`): as in
  the table above. An `owner-avoid` close is counted on the record but sets no
  loss cooldown, and learning and the Allocator never see it. Each run keeps
  every scored row by stock (`state.checks`, in `engines.json` as `checks`)
  for Check this stock, and the run log records `controls`. The history test
  passes no controls, so it is unchanged.
- **Webull mirror** (`runWebullMirror` input `openGate`, built from
  `mirrorOpenGate`): when a record trade first meets the ledger, Stop, Avoid
  or a limit logs it `skipped` with `ownerHold` and the reason, and it is never
  bought later. Mirror health counts these as `ownerHeldOpenPicks` (Top Picks)
  and `engines.held` (inside unfilled), never as an issue. Exits are untouched.
- **Track Record:** an `owner-avoid` close reads "closed by your Avoid"; the
  `dial` rule dimension splits the record only on Safer (the one setting that
  changes Top Picks).

## The scorecard

`GET /api/auth/owner-controls?scorecard=1` reads `engines-record.json` and
`picks-accuracy.json` and splits closed trades by dial setting (an unstamped
trade opened since the first control counts as Normal), watched, flagged
catalyst and closed by Avoid (count, win rate, average result per contract or
share lot), and lists each avoided stock with its price when avoided (the
page's live quote, else the last bake's spot from the stock's own file) and
when lifted, or a live quote while it is still avoided. It says "early" until
30 days of controls.

## Where the Owner sees them

Besides the Strategy engines panel and the banners: Home's "Your desk" has an
Owner controls tile (live from the controls route) and a "Filled at Webull"
tile (last seven days, from the Owner brief's `desk.webull`, counted by
`fillOutcome`; a trade the controls held counts as held); the stock page has a
"Your controls" section (`#stp-oc`: Watch closely / Stop watching, Avoid,
Lift avoid; Avoid from there never closes trades); active catalysts show on the
Calendar as "Your flag" rows (`calWithOwnerCatalysts`, browser only). The
Owner brief (`lib/owner-desk-state.mjs`, read before the wipe) adds findings for
a stop, controls in force, an engine account limit reached today and missed
Webull fills; the private picks feed adds a `Status:` line; the MCP's
`get_top_picks` returns `owner_controls` and a `NEW_TRADES_STOPPED` warning. A
public visitor never requests the controls. Tests: `node
scripts/owner-desk-smoke.mjs`, `node scripts/owner-desk-browser.mjs`.

## Storage and access

`owner-controls.json`: Owner-only (`lib/premium-keys.mjs`),
request-time-owned (`REQUEST_TIME_EXCLUSIVE_KEYS`), written only by `POST
/api/auth/owner-controls` (Owner session, same-origin, store lease
`owner-controls`; a change that needs the confirm box is refused without
`confirm: true`). The page reads `GET` on the same route; the undo snapshots
stay on the server. The MCP lists it as `picks` dataset `controls`. A missing
or unreadable file reads as no control, so a bad file can never stop or
resize a trade.

## Cost

No AI call, no new serverless function, no new workflow, no new outside
download. Added store reads: one `owner-controls.json` and one
`owner-settings.json` read per Webull mirror run, one per page load and save,
one stock file read on an Avoid or Lift click, and two record reads when the
scorecard is opened. The bake reads its already-hydrated copy (and the
Webull ledger once, before the wipe, for the Owner brief). The picks feed and
the MCP's `get_top_picks` each add two small reads (`owner-controls.json`,
`owner-settings.json`) per call.

## Kill switch

Owner Settings → Account limits → **Owner controls** (`OWNER_CONTROLS`, a
"Big impact" switch, default on). Off: nothing saved on the controls applies
anywhere (Top Picks, every engine, the Webull paper mirror), the saved file is
kept as it is, and the banner and panel say "Owner controls are off". The bake
reads it through the Owner Settings preload (`controlsEnabled`, a repo
variable wins); the mirror and the page read the saved setting
(`controlsEnabledFromSettings`, a Vercel value wins). The account limits are
not part of it: each is off at 0.

Every control is also off by default, and Resume, Lift, Stop watching,
Remove, Normal and Undo turn each one off.
