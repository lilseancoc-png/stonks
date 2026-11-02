# Mingstreet MCP server

Mingstreet exposes its research to AI apps (ChatGPT, Claude, Claude Code, Cursor, the MCP Inspector, or any
other MCP client) at:

```
https://mingstreet.app/mcp
```

It is **read-only**, makes **zero AI calls**, and is **Owner-only by default**. The AI app signs in with the
same Discord owner role as the site's Owner login. Code: `lib/mcp/`. Tests: `node scripts/mcp-smoke.mjs`.

## Connect

You don't need a key. Every client below opens a Mingstreet consent page, then Discord.

- **ChatGPT**: Settings → Apps & Connectors → Advanced → turn on Developer mode, then Create. Use URL
  `https://mingstreet.app/mcp` and authentication **OAuth**. It registers itself (dynamic client
  registration).
- **Claude (claude.ai / desktop)**: Settings → Connectors → Add custom connector → URL
  `https://mingstreet.app/mcp`. Leave the client ID blank.
- **Claude Code**: `claude mcp add --transport http mingstreet https://mingstreet.app/mcp`, then `/mcp` →
  Authenticate.
- **Others**: any client that speaks Streamable HTTP with MCP OAuth. Point it at the URL above.

On the consent page, check the app name and the address it will return you to. Press **Continue with Discord**
only if you started the connection yourself.

## Tools

| Tool | Access | What it reads |
|---|---|---|
| `list_features` | any | Site catalog (`lib/research-lab/site-catalog.mjs`), which tool reads each page, covered symbols |
| `get_feature` | per feature | The saved payload behind a page (`lib/research-lab/feature-sources.mjs`), trimmed; `ticker`/`path`/`max_items` narrow it. `dataset` reads a page's other files (`FEATURE_DATASETS` in `lib/mcp/tools.mjs`, listed per page by `list_features`): histories and logs, the Owner Top Picks files, and per-stock files (`calls` → `transcript`, `iv-trend` → `iv-history`, `grade` → `fundamentals-history`) that need `ticker` |
| `get_stock` | owner | `<SYMBOL>.json`: compact sections by default, named `sections` on request |
| `get_price_history` | any | `priceSeries` (daily, ≤252) or `intradaySeries` (30m) from `<SYMBOL>.json` |
| `get_stock_grades` | owner | `grades.json`, flattened and sortable |
| `get_live_quotes` | any | Live Yahoo quotes (`lib/yahoo.mjs`), ≤10 covered symbols |
| `get_top_picks` | owner | `approvedTopPicks()`, the same payload as the Top Picks tab |
| `get_track_record` | owner | `readSiteRecord('picks-accuracy.json')`: stats, all-time stats, open trades and recent closes as compact rows (trade ID, contract, entry and model mark, P&L %), trade lines |

Every result is a JSON envelope: `schema_version`, `tool`, `source` (store key and page), `access`, `as_of` (the
payload's build time), `generated_at`, `ai_calls: 0`, `warnings` (stale, expired `validUntil`, trimmed, no match), `limitations`,
`results`. Results are capped at about 48 KB.

**Never reachable**, even for the Owner: `picks-fills.json`, `webull-paper-ledger.json`,
`picks-watchlist.json`, AI caches and accounting, track-record reset markers, Research Lab records,
`_stonks/*`, retired keys, and any field whose name looks like a secret. `get_feature` reads only the keys mapped
in `feature-sources.mjs`, so no other store key can be named.

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
- `/.well-known/oauth-authorization-server`: S256 PKCE, `none` client auth, `iss` returned on redirect.
- `POST /oauth/register`: the `client_id` is a signed record of the redirect URIs (https, http on loopback, or a
  native app scheme; no fragments).
- `GET /oauth/authorize`: consent page, then Discord through the **already-registered**
  `/api/auth/discord-callback`. The callback runs the normal owner-role check. When a pending MCP request
  (cookie, bound to that Discord `state`) is present, it returns an encrypted 5-minute code instead of a site
  session.
- `POST /oauth/token` (`client_id` in the body, or HTTP Basic with an empty secret): `authorization_code` (PKCE checked, client and redirect bound) or `refresh_token`.
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

- **Routing.** `vercel.json` rewrites `/mcp`, `/.well-known/oauth-*` and `/oauth/*` to `api/auth/[action].js`
  (`mcp`, `mcp-meta`, `mcp-oauth`), so the MCP uses no extra serverless function (Hobby limit 12). The handler routes by `req.query.action` and falls
  back to the request path (`mcpRouteOf`), so it works whichever form of the URL Vercel passes after a rewrite.
- **Protocol.** Stateless Streamable HTTP with JSON responses and no `Mcp-Session-Id`. It serves 2026-07-28
  (`server/discover`, `Mcp-Method`/`Mcp-Name` checked against the body) and 2024-11-05 / 2025-03-26 /
  2025-06-18 / 2025-11-25 (`initialize` negotiates). `GET /mcp` returns 405 because there is no server push. Batches are
  rejected. Bodies are limited to 64 KB. Browser `Origin`s are allowlisted.
- **Logs.** One JSON line per call (`evt: mcp.call`): tool, outcome, ms, a hashed subject and client. No
  arguments or data.
- **Budget.** 120 calls per minute per token per instance. No AI is called; reads are R2 GETs plus Yahoo for
  live quotes and Top Picks approval.

## Not in v1

Research Lab runs and journal writes, option chains, and any write or broker action. These are deferred from the
2026-11-01 blueprint review: the heavy studies are already precomputed by the bake, and Hobby has no job queue.
