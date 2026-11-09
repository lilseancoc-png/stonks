# Mingstreet MCP server

Mingstreet exposes its research to AI apps (ChatGPT, Claude, Claude Code, Cursor, the MCP Inspector, or any
other MCP client) at:

```
https://mingstreet.app/mcp
```

It is **read-only**, makes **zero AI calls**, and is **Owner-only by default**. The AI app signs in with the
same Discord owner role as the site's Owner login. Code: `lib/mcp/`. Tests: `node scripts/mcp-smoke.mjs` and
`node scripts/sports-mcp-smoke.mjs`.

"Works with any AI app" means any MCP client can connect and sign in, not that anyone can: every client still
goes through the Discord owner check. The server speaks every published MCP protocol version, accepts public
(PKCE-only) and confidential (client secret) OAuth clients, answers OAuth and OpenID discovery at the paths
clients try, accepts browser-based clients from any https origin (auth is a bearer token, never a cookie), and
offers `search`/`fetch` for apps that only use those two tools.

## Connect

You don't need a key. Every client below opens a Mingstreet consent page, then Discord.

- **ChatGPT**: Settings → Apps & Connectors → Advanced → turn on Developer mode, then Create. Use URL
  `https://mingstreet.app/mcp` and authentication **OAuth**. It registers itself (dynamic client
  registration).
- **Claude (claude.ai / desktop)**: Settings → Connectors → Add custom connector → URL
  `https://mingstreet.app/mcp`. Leave the client ID blank.
- **Claude Code**: `claude mcp add --transport http mingstreet https://mingstreet.app/mcp`, then `/mcp` →
  Authenticate.
- **ChatGPT deep research / API connectors**: same URL. They call `search` and `fetch`, which this server
  provides in OpenAI's shape.
- **Le Chat (Mistral), Copilot Studio, Cursor, VS Code, Windsurf, the MCP Inspector**: add a remote/HTTP MCP
  server with the URL above and OAuth. Clients that ask for a client secret get one at registration
  (`client_secret_post` or `client_secret_basic`); leave client ID and secret blank where the app lets you.
- **Others**: any client that speaks Streamable HTTP with MCP OAuth. Point it at the URL above.

After a server update that adds tools, refresh or reconnect the connector so the app re-reads the tool list.

On the consent page, check the app name and the address it will return you to. Press **Continue with Discord**
only if you started the connection yourself.

## Tools

| Tool | Access | What it reads |
|---|---|---|
| `list_features` | any | Site catalog (`lib/site-catalog/site-catalog.mjs`), which tool reads each page, covered symbols |
| `get_feature` | per feature | The saved payload behind a page (`lib/site-catalog/feature-sources.mjs`), trimmed; `ticker`/`path`/`max_items` narrow it (`path` takes negative indexes, `entries.-1` is the last row). `dataset` reads a page's other files (`FEATURE_DATASETS` in `lib/mcp/tools.mjs`, listed per page by `list_features` with a note for the non-obvious ones): histories and logs, the Owner Lab files (`quant` → `evidence`, `outcomes`, `regime-lab`, `history`, `source-health`), `crowd` → `owner`, `leaps` → `paper`, `bonds-usd` → `auctions`, `unified-signal-engine` → `link-map`, the Owner Top Picks files (`picks` → `open`, `raw`, `runs`, `mode`; `grade` → `auto-picks`), per-stock files (`calls` → `transcript`, `iv-trend` → `iv-history`, `grade` → `fundamentals-history`) that need `ticker`, and per-day files (`picks` → `runs`, `past-day` → `picks-run`, the Top Picks run archive) that take `date` and default to the newest saved day in the last 8 |
| `get_stock` | owner | `<SYMBOL>.json`: compact sections by default, named `sections` on request |
| `get_price_history` | any | `priceSeries` (daily, ≤252) or `intradaySeries` (30m) from `<SYMBOL>.json` |
| `get_option_chain` | any | `chains` from `<SYMBOL>.json` (the last build's Yahoo chain): every saved expiration, then one expiry's calls and/or puts nearest spot with bid, ask, mid, last, IV, OI, volume and moneyness. Default expiry is the first at least 7 days out |
| `get_stock_grades` | owner | `grades.json`, flattened and sortable |
| `get_live_quotes` | any | Live Yahoo quotes (`lib/yahoo.mjs`), ≤10 covered symbols |
| `get_top_picks` | owner | `approvedTopPicks()`, the same answer as the Top Picks tab, as compact rows (side, scores, AI grade, contract, entry, market approval, macro fit, invalidators), the market check, and the names each gate turned away. `symbol` returns that one pick in full |
| `get_near_misses` | owner | "Why no picks today": the names that came closest in the last run and the first rule that stopped each (`lib/no-picks.mjs` over `rosterMeta.turnedAway`, the approved roster as in `get_top_picks`, topped up from `grades.json` under the score bar), plus how many names each rule stopped |
| `get_track_record` | owner | `readSiteRecord('picks-accuracy.json')`: stats, all-time stats, open trades and recent closes as compact rows (trade ID, contract, entry and model mark, P&L %), trade lines |
| `sports_list_games` | owner | Owner Sports: today's and tomorrow's NBA or NFL games (`leagueView('board')`), in a chosen US time zone |
| `sports_find_players` | owner | Owner Sports: player search by name, for the ids the other Sports tools take |
| `sports_get_game` | owner | Owner Sports: one game, its teams and each team's recent players with averages per measure (`last5`, `last10`, `average`, …), each keyed by stat; main stats unless `stats` names others, combos included; each player's average against this opponent; `matchup` with both teams' records, scoring and what each defense allows by position (league ranks, 1 = fewest allowed) and the stored meetings |
| `sports_get_player` | owner | Owner Sports: game log, averages, next game and the stat model's forecast for it |
| `sports_evaluate_entry` | owner | Owner Sports: a 1-6 pick entry checked by the Pick Builder's own `evaluateEntry` (`hit_history`, model chance, breakeven, joint chance including same-game links, expected value; any catalog stat or combo, with a model chance only for modeled stats) plus `pick_builder_link`, a `?tab=sports-pick-builder&entry=` link that fills the entry on the site. Saves nothing |
| `sports_get_model_check` | owner | Owner Sports: the stat model's and the same-game links' check on later games, and the paper journal's totals and chance calibration |
| `sports_get_prop_record` | owner | Owner Sports: the issued-props record (`propRecordView`, as on the Sports page): totals, win rate, splits by stat, basis, rank and closing-line move, and the newest picks (`recent`, `offset`) as compact rows with result and actual stat; `prop_id` returns one pick in full. `as_of` is the record's own save time |
| `sports_get_league_stats` | owner | Owner Sports: the Leaders view (per-game averages over the season, last 10 or last 5, sorted by any shown stat, `min_games` optional) or the Teams view, for one stored season; both take `team`, `limit` and `offset`. `missed` counts only games where the box score listed the player as not playing |
| `search` | any | Pages (from `list_features`, so only the ones the caller may read) and covered stocks (names and sectors from `heatmap.json`) matching the words; returns `{results: [{id, title, url}]}` |
| `fetch` | any | One `search` id (`feature:<id>` or `stock:<TICKER>`): `{id, title, text, url, metadata}`, where `text` is the JSON the matching tool returns (`get_feature`, the page's dedicated tool, `get_stock` for the Owner, `get_price_history` otherwise) |

**Sports tools** (`lib/mcp/sports-tools.mjs`) call the same functions as the Sports pages, so the same stored
games, model and seed give the same number on the site and here. They are listed only for an Owner token and
disappear with `SPORTS_ENABLED=0`. Their store handle (`sportsReadOnlyStore`) reads only Sports game, player,
model, status, issued-props record and journal records under `_stonks/sports/v1/`; the Pick Builder's captured
lines and every other raw key are refused,
and every write throws. There is deliberately **no save tool**: Claude or ChatGPT reads a slip screenshot, finds
the players (`sports_find_players`), checks the entry (`sports_evaluate_entry`) and hands back the Pick Builder
link; the Owner checks it on the site and saves it. Chances are passed only when the Owner gave them, and
`use_model_chances` copies the model's chance only when asked; the link never carries chances.

Every result is a JSON envelope: `schema_version`, `tool`, `source` (store key and page), `access`, `as_of` (the
payload's build time), `generated_at`, `ai_calls: 0`, `warnings` (stale, expired `validUntil`, trimmed, no match), `limitations`,
`results`. Results are capped at about 48 KB; `search` and `fetch` return OpenAI's plain shape instead. When a
list is cut, histories and logs stored oldest first keep their **newest** rows (with an `…N earlier items` marker),
and `max_items` is a ceiling at every size budget. Payloads without a build stamp (logs, histories, per-stock files)
are dated by their Yahoo fetch time or their newest row.

Readable output (`reduceValue`/`tidyDeep` in `lib/mcp/tools.mjs`): every tool rounds float tails (2 decimals from
1,000 up, 4 from 1, 5 significant digits below 1; rounding alone is not a trim) and turns epoch numbers under
time-named keys (`expSec`, `closeMs`, `exp`) into ISO dates. The size ladder shortens lists, text and key counts
before it cuts depth. In `get_feature` (without `ticker`) every cut names the path that reads the rest:
`{object with 3 keys; read with path "a.b"}`, `…5 more items (paths "x.25" to "x.29", or raise max_items)`, and
`…44 more keys: k1, k2, …; read one with path "thresholds.k1"`. Large series (`history`, `priceSeries`, chains) and
internal bookkeeping (forced-liquidation `inspected`, 13F `mappingAttempts`/`holdingsParts`/`ownershipRetainedParts`)
are left out with a read-with-path note; base64 or compressed blobs become `[encoded data omitted: N characters]`.
`get_stock` lists series and chains with `read_with` (`get_price_history`, `get_option_chain`), and closed
`get_track_record` rows carry `close_reason` in words.

**Never reachable**, even for the Owner: `picks-fills.json`, `webull-paper-ledger.json`,
`picks-watchlist.json`, AI caches and accounting (`ai-usage.json`, `ai-cost-history.json`), the contact inbox
(visitor messages), the Sports captured lines, track-record reset markers,
`_stonks/*` (except the Sports records the Sports tools read), retired keys, and any field whose name looks like a secret. `get_feature` reads only the keys mapped
in `feature-sources.mjs` and `FEATURE_DATASETS`, so no other store key can be named. `scripts/mcp-smoke.mjs`
fails when a page loads a data file (`scripts/render/*` `dataUrl`/`vnJson`/`quantFetchJson`, or
`EXPORT_SOURCES`) that is neither served nor listed in `NOT_SERVED_KEYS`, so a new page can't be left out by
accident.

## Read-only by design

- Tools only ever hold a get-only store (`lib/mcp/read-only-store.mjs`). `put`, `del`, `list`, leases and
  generation publishing all throw `READ_ONLY` before reaching R2, and the handle is frozen.
- `get_top_picks` and `get_near_misses` run the site's live market approval (`approvedTopPicks`) on a throwaway overlay
  (`dryRunStore`). On the site that step saves market holds to `top-picks-approval.json`, which the Webull paper
  mirror reads; through the MCP the agent sees the same answer and nothing is saved.
- No tool places orders, triggers the Webull mirror, uploads fills, edits the watchlist, starts a build or calls AI.
  MCP tokens can't act as the site session cookie, so they can't reach the site's Owner actions either.
- Yahoo-backed tools (`get_live_quotes`, `get_top_picks`, `get_near_misses`) are capped at 20 calls a minute per token, inside the
  120-a-minute overall cap, so an agent can't get the site's shared Yahoo access throttled.
- `scripts/mcp-smoke.mjs` runs every tool against a store whose write methods record any call and asserts none;
  `scripts/sports-mcp-smoke.mjs` does the same for the Sports tools and checks they match the Pick Builder route.

## Access model

- Owner-only payloads follow `lib/premium-keys.mjs`; Owner-only pages follow `lib/owner-access-policy.mjs`.
  `tools/list` is filtered per caller, so an anonymous caller never sees Owner tool names or descriptions. A
  guessed Owner tool name gets the same "unknown tool" answer as a nonexistent one.
- `MCP_PUBLIC_ACCESS=1` (Vercel env, off by default) lets callers without a token use the public tools on
  public pages, with the same public sanitizer as `/api/data`. Leave it off unless you want the site's research
  open to any agent. Each call runs a Vercel function on the Hobby plan.

## OAuth (lib/mcp/oauth.mjs, lib/mcp/tokens.mjs)

Mingstreet acts as both the resource server and a minimal authorization server, and it stores nothing:

- `/.well-known/oauth-protected-resource[/mcp]`: `resource = <origin>/mcp`, authorization server = `<origin>`.
- `/.well-known/oauth-authorization-server` (also served at `/.well-known/openid-configuration`, with or
  without a `/mcp` suffix or prefix): S256 PKCE, `none`, `client_secret_post` and `client_secret_basic` client
  auth, `iss` returned on redirect.
- `POST /oauth/register`: the `client_id` is a signed record of the redirect URIs (https, http on loopback, or a
  native app scheme; no fragments). A client that asks for `client_secret_post` or `client_secret_basic` also
  gets a `client_secret`, an HMAC of its `client_id` under `SESSION_SECRET`, so nothing is stored. PKCE is still
  required for every client.
- `GET /oauth/authorize`: consent page, then Discord through the **already-registered**
  `/api/auth/discord-callback`. The callback runs the normal owner-role check. When a pending MCP request
  (cookie, bound to that Discord `state`) is present, it returns an encrypted 5-minute code instead of a site
  session.
- `POST /oauth/token` (`client_id` in the body, or HTTP Basic): `authorization_code` (PKCE checked, client and
  redirect bound) or `refresh_token`. A secret, when sent (body `client_secret` or the Basic password), must
  match or the call fails with `invalid_client`; public clients send none.
  Access tokens last 1 hour, with audience `<origin>/mcp`. Refresh tokens last 30 days, are encrypted, and carry
  the Discord refresh token, so **every refresh re-checks the owner role with Discord**.

Keys are derived from `SESSION_SECRET` with a per-purpose label. MCP tokens can't act as site cookies, and site
cookies can't act as MCP tokens.

## Operations

| Env (Vercel, all optional) | Effect |
|---|---|
| `MCP_ENABLED=0` | Kill switch: `/mcp`, the metadata and the OAuth endpoints all return 404 |
| `MCP_TOKEN_VERSION` | Change it (e.g. `2`) to revoke every MCP token and client at once; site sessions unaffected |
| `MCP_PUBLIC_ACCESS=1` | Allow tokenless use of public tools (see above) |
| `MCP_PUBLIC_ORIGIN` | Override the issuer/resource origin (normally derived from the request host) |

Required and already set: `PRIVATE_DATA_ENABLED=1`, the R2 keys, `SESSION_SECRET`, the `DISCORD_*` owner
variables. No Discord app change is needed.

- **Routing.** `vercel.json` rewrites `/mcp`, `/mcp/`, `/.well-known/oauth-*`, `/.well-known/openid-configuration`
  and `/oauth/*` to `api/auth/[action].js`
  (`mcp`, `mcp-meta`, `mcp-oauth`), so the MCP uses no extra serverless function (Hobby limit 12). The handler routes by `req.query.action` and falls
  back to the request path (`mcpRouteOf`), so it works whichever form of the URL Vercel passes after a rewrite.
- **Protocol.** Stateless Streamable HTTP with JSON responses and no `Mcp-Session-Id`. It serves 2026-07-28
  (`server/discover`, `Mcp-Method`/`Mcp-Name` checked against the body) and 2024-11-05 / 2025-03-26 /
  2025-06-18 / 2025-11-25 (`initialize` negotiates). `GET /mcp` returns 405 because there is no server push. Batches are
  rejected. Bodies are limited to 64 KB. `resources/list`, `resources/templates/list` and `prompts/list`
  answer empty lists. Browser `Origin`s: any https origin, plus http on localhost (the MCP Inspector); plain
  http from another host is refused. This is safe because auth is a bearer token the client holds, never a
  cookie the browser adds; a page without a token gets 401.
- **Logs.** One JSON line per call (`evt: mcp.call`): tool, outcome, ms, a hashed subject and client. No
  arguments or data.
- **Budget.** 120 calls per minute per token per instance. No AI is called; reads are R2 GETs plus Yahoo for
  live quotes and Top Picks approval.

## Not served

Sports paper-pick saves (by decision: the Pick Builder link instead), live props (they call outside line
sources and write tracking records), the contact inbox, AI cost accounting, and any write or broker action.
The heavy studies are already precomputed by the bake, and Hobby has no job queue.
