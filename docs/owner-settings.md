# Owner Settings page

Owner · Admin → **Settings** (`?tab=owner-settings`) lets an Owner change a
short, fixed list of switches and numbers on the site instead of in the repo.
Source: `lib/owner-settings.mjs` (catalog, validation, history, build and
request-time application), `scripts/render/owner-settings-client.mjs` (page),
`api/auth/[action].js` action `owner-settings`, `scripts/owner-settings-env.mjs`
(build preload). Test: `npm run test:owner-settings`.

## What can change

The page is laid out like a game's settings menu: tabs down the side (a
scrolling row on phones) with a count of changed settings on each, folding
sections inside each tab, a search box across every tab and a "Changed only"
filter. The chosen tab is remembered on the device.

| Tab | Settings | Applies |
|---|---|---|
| Top Picks | Engine: event plays, macro context block + strength (0.25-1.5), singles by default, pick the option structure, raise the bar after losses. Book and sizes: most picks per run (1-6), most open trades (5-30), new trades per stock group per run (1-4), most watch ideas (0-10), single option cost cap ($1,000-$10,000), display account size. Events: wait out Fed/CPI/PPI/jobs days, event risk check, no single options into an event, earnings window for spreads (0-30 days), credit spreads into macro events | next build; Top Picks from the next 11:00 / 15:30 ET run |
| Market tape | The tape on the picks, and one switch per input: indexes, credit, breadth, put/call, bond volatility, Fear & Greed, inflation and jobs, oil and gold shocks, geopolitical headlines, overnight markets, sector rotation | next Top Picks run |
| AI & cost | AI final grader, web search before grading (both can only be turned off from their default, so AI spend can only fall) | next Top Picks run |
| Data & desks | Prediction-market odds, crowd data, IBKR borrow fees, LEAPS desk, stock picks shown (1-24), Earnings Forecast refresh | next build |
| Research | Run archive, Regime Lab, self-improving loop | next build |
| After Dec 7 | Crowd squeeze veto, crowd lines in the grader, Cboe put/call source, SELF_TUNE on | refused before 2026-12-07, then need a confirmation |
| Live site | Message box, public MCP tools, Sports, MCP server, Webull paper mirror | within 30 seconds; these can only turn a feature OFF on top of Vercel |
| Display (this device) | Theme, text size, layout density, motion, start page | at once, this browser only (`stonks-display-v1` + `stonks-theme` in localStorage, applied by `ownerDisplayBoot` at the top of app.js) |
| History | The newest 50 changes | |

`npm run test:owner-settings` fails if a setting's key is not read from
`process.env` anywhere in `lib/`, `api/` or `scripts/build.mjs`, so a dead
switch can't look like it works. `daily.yml` passes
`EARNINGS_FORECAST_ENABLED` as the plain repo variable (it used to default to
`'1'`, which pinned it).

Market mode stays on Top Picks (the page links to it).

Not here on purpose: AI models, AI budgets and caps, exits, grading weights,
conviction bars (they also set the public Call/Put grade labels), schedules,
the stock list, secrets, Robinhood approvals, and any Track Record reset.
Picks per run is capped at today's 6 so the AI grader never reads more names.

## How it works

- `owner-settings.json` (Owner-only, request-time-exclusive: no workflow pushes
  or deletes it) holds only values that differ from the default, plus the
  newest 50 changes (`{ id, at, by, kind, changes: [{ key, from, to }] }`).
  Saves run under the R2 lease `owner-settings`.
- Requests: `{ act: "set", values, confirm? }`, `{ act: "reset", key }`,
  `{ act: "reset-all" }`, `{ act: "undo" }` (reverses the newest change not yet
  undone; repeat to walk back further). Out-of-range values, unknown keys and
  locked values are refused; a tampered file is cleaned on read.
- Build: daily.yml runs `node --import ./scripts/owner-settings-env.mjs
  scripts/build.mjs`. The preload copies saved build values into
  `process.env` before `lib/top-picks-config.mjs` and the other switches read
  them. A non-empty env value (a repo variable) wins and the page shows the
  setting as pinned. Locked values are skipped again here. No file = defaults.
- The bake writes `owner-settings-applied.json` (Owner-only) with what it used,
  what was pinned and what it skipped; the page shows it as "Last build to read
  them" and flags a newer change that has not reached a build.
- New Top Picks record trades carry `ownerSettings` (e.g.
  `PICKS_COUNT=4,PICKS_EVENT_AWARE=off`) while a Top Picks setting differs from
  its default, and the Track Record draws a dated divider when it changes
  (`ACC_RULE_DIMS` key `settings`). Once any Top Picks setting has been
  changed here, trades opened back on the defaults carry `ownerSettings:
  "default"`, so a revert starts its own segment instead of folding into the
  trades from before this page. The record is never reset.
- Live site switches: the auth function reads the file (30-second cache per
  warm instance) for `contact`, `contact-inbox`, `webull-mirror`, the MCP
  routes and `me?sports=`, and forces the env value off on that warm
  instance. The forced value stays in place between requests and is put back
  only when the saved settings change (or on a save), so two requests running
  at once never see a half-restored env.

No AI call, no new fetch, serverless function, workflow or env variable.
