# Owner Settings page

Owner · Admin → **Settings** (`?tab=owner-settings`) lets an Owner change a
short, fixed list of switches and numbers on the site instead of in the repo.
Source: `lib/owner-settings.mjs` (catalog, validation, history, build and
request-time application), `scripts/render/owner-settings-client.mjs` (page),
`api/auth/[action].js` action `owner-settings`, `scripts/owner-settings-env.mjs`
(build preload). Test: `npm run test:owner-settings`.

## What can change

| Group | Settings | Applies |
|---|---|---|
| Top Picks | Event plays, macro context block, singles by default, AI final grader (on/off); most picks per run (1-6), most watch ideas (0-10), single option cost cap ($1,000-$10,000), macro block strength (0.25-1.5), display account size | next build; Top Picks from the next 11:00 / 15:30 ET run |
| Research | Run archive, Regime Lab, crowd data, self-improving loop | next build |
| After Dec 7 | Crowd squeeze veto, crowd lines in the grader, Cboe put/call source, SELF_TUNE on | refused before 2026-12-07, then need a confirmation |
| Live site | Message box, Sports, MCP server, Webull paper mirror | within 30 seconds; these can only turn a feature OFF on top of Vercel |

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
  (`ACC_RULE_DIMS` key `settings`). The record is never reset.
- Live site switches: the auth function reads the file (30-second cache per
  warm instance) for `contact`, `contact-inbox`, `webull-mirror`, the MCP
  routes and `me?sports=`, and sets the env value to off for that request.

No AI call, no new fetch, serverless function, workflow or env variable.
