# Private data migration + Discord-role gating (Path B)

> **Status:** implemented. The historical cutover notes remain below. As of the
> free-public pivot, there is no member or paid premium tier. Most research is
> public; Top Picks, Stock Picks, Sector Rotation, Leveraged ETFs, Track Record,
> Owner Lab, and their backing state require a signed Owner session. The
> existing Top Picks owner role is the single Discord entitlement; after it is
> verified, OAuth mints both internal compatibility claims (`tr` + `tp`).

## 1. Goal

Today the site is a fully static, fully public data product:

- All premium output — per-ticker chains, Top Picks, grades, unusual flow, OI
  tracker, briefs, 13F, correlations — is committed to a **public** GitHub repo
  as `data/*.json` (~29 MB, 171 files) and served by Vercel as static assets.
  Every file is a raw `curl` away, and the whole history is clonable on GitHub.
- The GitHub Actions workflows that regenerate this data run ~16×/weekday. On a
  **public** repo those minutes are free and unlimited; on a **private** repo
  they bill against the 2,000-min Free quota.

**Path B solves all three at once:**

1. **Data privacy** — premium JSON lives in a private store, served only through
   an auth-checked API. Not in the public repo, not directly fetchable.
2. **Actions stay free** — because the *code* repo can remain **public** (the
   secret is the data, not the source), so Actions minutes stay unlimited.
3. **Architectural convergence** — the Discord gate wants premium data behind an
   authenticated API anyway. Path B builds the gate **once, in its final form**,
   instead of an interim middleware-over-static-files gate we'd later throw away.

The entitlement is a Discord role **you assign by hand**. The site only ever
*reads* it (OAuth → "is this user in guild X with role Y?"). No payment code, no
bot, no role-writing.

## 2. Why this is tractable (the structure that already exists)

The migration is a **"wrap the boundaries"** change, not a rewrite, because:

- **Every script funnels through one `DATA_DIR` constant** (`resolve(ROOT, "data")`).
  All 79 reads and 54 writes operate on that single local directory. The build
  never reasons about *where* data lives.
- **The build is already a black box with hydrate/flush boundaries.** Today:
  `git checkout` hydrates the prior `data/`, the build mutates it in place
  (including all the read-before-wipe cross-build accumulation), and
  `git commit/push` flushes it. **All the internal accumulation logic stays
  byte-for-byte identical** — we only change what hydrate / flush / serve mean.
- **The browser has exactly 22 `fetch('data/…')` call sites**, all literal
  `data/` prefixes. A single Vercel rewrite (`/data/(.*) → /api/data/$1`) repoints
  every one of them with **zero browser-code changes**.

## 3. Architecture: before → after

### Data flow today
```
GitHub Actions (build.mjs / scan-*.mjs)
   └─ writes local data/*.json
   └─ git commit + push  ──►  public GitHub repo  ──►  Vercel static deploy
                                                          └─ browser fetch('data/x.json')  (PUBLIC)
```

### Data flow under Path B
```
GitHub Actions (build.mjs / scan-*.mjs)
   ├─ sync-data.mjs pull   ◄── PRIVATE object store   (hydrate local data/)
   ├─ build/scan mutate local data/  (UNCHANGED internals)
   ├─ verify-data-freshness.mjs       (fail closed on stale/partial owned data)
   ├─ sync-data.mjs push   ──► PRIVATE object store    (flush verified owned keys)
   └─ git commit static shell ──► Vercel deploy        (only after data upload)

Browser
   └─ fetch('data/x.json')
        └─ vercel rewrite ──► /api/data/x.json  (serverless)
              ├─ verify Discord session cookie   ◄── set by /api/auth/discord-callback
              ├─ if unauthorized → 401
              └─ else stream bytes from PRIVATE store  (server-side; URL never leaves the server)
```

The public repo now contains **only code** (`scripts/`, `api/`, `lib/`,
`index.html`/`app.js`/`styles.css` render output, workflows). `data/` is gitignored.

## 4. Component design

### 4.1 Storage adapter (backend-agnostic)

A thin module `lib/datastore.mjs` exposing a 4-method interface so the backend is
swappable without touching the pipeline or the API:

```js
// lib/datastore.mjs
export interface DataStore {
  get(key: string): Promise<Buffer | null>;   // null if missing
  put(key: string, body: Buffer): Promise<void>;
  list(prefix: string): Promise<string[]>;     // keys under prefix
  del(key: string): Promise<void>;
}
```

- **Chosen backend (v1): Vercel Blob** (`@vercel/blob`) — **decided**. Least friction — same
  platform as the deploy, `BLOB_READ_WRITE_TOKEN` auto-injected into functions and
  available to Actions as a secret. **Critical correctness rule:** the gated API
  must always `get()` blob bytes **server-side** and stream them; never hand a blob
  URL to the browser (Vercel Blob URLs are unguessable but capability-based — a
  leaked URL is an open door). The adapter hides the URL inside the server.
- **Swap target (at scale): Cloudflare R2** (S3-compatible, **zero egress fees**,
  true private buckets + optional signed URLs). When bandwidth cost shows up, R2 is
  a one-file adapter swap. Keys/paths stay identical.
- **As-built: R2 is now the DEFAULT backend; Blob is the fallback.** The Blob free
  tier counts every `put`/`copy`/`list` as an **"advanced operation"** and caps it at
  **2,000/month** — but the bake re-uploads the whole `data/` dir (~150–300 objects)
  on every run, ×8 runs/day, so the cap was exhausted in **~one day** (and hitting
  100% **locks the store for 30 days**, which would take the entire site's gated data
  offline). `lib/datastore.mjs` now picks the backend by env: **R2** (SigV4 over its
  S3 API via the dependency-free `aws4fetch`) when `R2_ACCOUNT_ID` +
  `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET` are set, else **Blob**
  (`BLOB_READ_WRITE_TOKEN`) when none of those four R2 variables is present. A
  partial R2 credential set fails immediately instead of silently selecting Blob.
  R2's free tier — **1M class-A ops/mo, 10 GB, zero
  egress** — absorbs the ~40k ops/mo this pattern generates. Cutover is a pure
  env-var flip (set the four R2 vars in Vercel project env **and** GitHub Actions
  secrets, then `node scripts/sync-data.mjs seed` to copy the current `data/` into
  the bucket); rollback is unsetting them. Optional `R2_ENDPOINT` overrides the
  default `https://<account>.r2.cloudflarestorage.com` for any S3-compatible store.

Keys mirror today's paths exactly: `picks.json`, `NVDA.json`, `iv-history/NVDA.json`,
etc. — a 1:1 map from `DATA_DIR` relative paths, so nothing else has to learn new names.

### 4.2 `sync-data.mjs` (the hydrate/flush tool)

```
node scripts/sync-data.mjs pull                 # store → local data/  (hydrate)
node scripts/sync-data.mjs push --owner=bake    # local data/ → store (flush owned keys)
node scripts/sync-data.mjs push --owner=unusual
node scripts/sync-data.mjs push --owner=oi
node scripts/sync-data.mjs push --owner=daytrading
node scripts/sync-data.mjs seed                  # one-time: upload current data/ wholesale
```

- **pull**: `list("")` → validate every key as a relative path contained by
  `DATA_DIR` → `get` each key → write locally (mkdir -p as needed). Validation
  completes before the existing directory is removed, so an unsafe or corrupt
  object fails closed without overwriting checkout files or leaving partial data.
  This makes the prior accumulated state available to the build, replacing
  `git checkout`.
- **push --owner=X**: upload the producer's owned keyset (§4.3), with delete-stale
  **only** inside the prefixes that producer exclusively owns. Upsert single-files.
- Robustness: bounded concurrency (e.g. 8), per-key retry w/ backoff, and a content
  hash so unchanged files are skipped on push (most per-ticker files change every
  bake, but skipping the unchanged ones still trims op count + bandwidth).

### 4.3 Concurrency & ownership model — **the load-bearing piece**

Today the data workflows share a `concurrency: stonks-data-commit` group
(serialized, never concurrent) and rely on **Git's merge/restore semantics** so a
wholesale `data/` rebuild by the bake doesn't clobber a concurrent scanner's
output. A blob store has no merge, so we replicate that ownership explicitly.

**Two invariants make it safe** (both already true / easy to keep):

1. **Keep the shared `concurrency` group** — runs stay serialized, so every run's
   `pull` at start sees the previous run's `push`. No simultaneous writers.
2. **Each producer pushes ONLY its own keyset.** Scanner pushes are **upsert-only**
   (never delete). Only the bake does delete-stale, and only within the per-ticker
   + `iv-history/` prefixes (the only place keys disappear, when a ticker leaves the
   universe). This is the exact ownership the Git workflows already encode via
   `SCANNER_FILES` / per-workflow `DATA_PATHS`.

**Ownership map** (derived from the current workflows):

| Key set | Producer | Push rule |
|---|---|---|
| `<SYM>.json` (per-ticker, dynamic) | bake | upload + **delete-stale** within prefix |
| `iv-history/<SYM>.json` (dynamic) | bake | upload + **delete-stale** within prefix |
| picks\*, grades\*, calendar, macro\*, correlations, trends\*, streaks, 13f, fear-greed\*, fedwatch-history, rfr-history, earnings-history, chart-pattern-cache, ticker-judgment-cache, prediction-history | bake | upsert |
| unusual\*, volume-flags, volume-history, flow-explanations | unusual-flow scan | upsert (no delete); explanations are rebuilt deterministically from current scan metrics and spend no AI |
| oi-tracker, oi-history | oi-tracker scan | upsert (no delete) |
| search-interest | weekly theme search-interest refresh | upsert (no delete) |
| day-trading, day-trading-history | 15-minute owner paper engine | upsert (no delete) |
| **heatmap.json** | bake (seed/rebuild) **+** unusual (refresh) | upsert by whichever ran; serialized |
| **market-analysis.json** | bake (macro regime) **+** unusual (premarket cohort + hourly marks) | read-modify-write; serialized |
| **briefs.json** | bake (`buildMarketBriefs`, re-minted hourly) | upsert; once-per-ET-hour gating already in code |
| **ai-usage.json** | bake + unusual-flow (shared daily accounting; unusual carries other producers' totals) | read-modify-write; serialized so increments don't race |
| **picks-watchlist.json** | **request time** (`api/watchlist.js` — the shared Top Picks watchlist, written on user clicks) | **no workflow may push or delete it** (`REQUEST_TIME_EXCLUSIVE` in `sync-data.mjs`): the copy `pull` hydrates locally is stale the moment a user toggles mid-run, so re-uploading it would silently revert their change |

The **shared read-modify-write** files (`heatmap`, `market-analysis`, `ai-usage`) are
safe because: every run `pull`s latest first, the in-code once-per-window gating
already prevents double-generation, and the shared `concurrency` group serializes
the push. No producer deletes another's keys (upsert-only outside the bake's two
dynamic prefixes), so cross-clobbering is structurally impossible.

> Net: the concurrency model is a faithful re-encoding of the Git ownership we
> already run, with "push only your keyset, delete-stale only your dynamic prefixes,
> stay in the serialized concurrency group" as the contract.

### 4.4 Gated read API + rewrite

`api/data/[...path].js` (Vercel catch-all):

1. Parse + **validate** the path: must match `^[A-Za-z0-9_./-]+\.json$`, reject
   `..`, leading `/`, and anything outside the known key shape (defense vs. store
   traversal / open-proxy).
2. **Verify the session** (shared helper, §4.5): valid `stonks_session` cookie →
   continue; else `401 { error: "auth required" }`.
3. `store.get(key)` → `200` stream with `Content-Type: application/json` and
   **`Cache-Control: private, no-store`** (gated content must never hit a shared
   edge cache — that would leak premium data to unauthenticated users).
4. Missing key → `404`.

`vercel.json` rewrite so the browser is untouched:
```json
{ "rewrites": [{ "source": "/data/(.*)", "destination": "/api/data/$1" }] }
```
Remove the old `public, max-age=…` cache headers on `/data/*` (they'd be wrong for
gated content). Register `api/data/[...path].js` (and the auth fns) under `functions`.

### 4.5 Discord auth layer

New endpoints (repurpose the dormant auth slot; raw Discord OAuth, no Supabase):

| File | Purpose |
|---|---|
| `api/auth/discord-login.js` | Set short-lived `state` cookie (CSRF), 302 → Discord authorize (`scope=identify guilds.members.read`). |
| `api/auth/discord-callback.js` | Validate `state`; exchange `code` → access token; `GET /users/@me/guilds/{GUILD_ID}/member`; check `roles` includes `REQUIRED_ROLE_ID`; on success set signed httpOnly session cookie, 302 `/`; else 302 `/welcome.html?denied=1`. |
| `api/auth/logout.js` | Clear cookie, 302 `/welcome.html`. |
| `api/auth/me.js` *(optional)* | `{ authed, name, avatar }` for a "signed in as … · log out" chip. |
| `lib/session.mjs` | Shared HS256 sign/verify (`jose`, works in both Node fns and Edge middleware). Used by `api/data/*`, `api/auth/*`, and `middleware.js`. |

`middleware.js` (Edge) gates the **page shell** only — `/`, `index.html`,
`cheatsheet.html`, `chart-patterns.html`, `app.js`, `styles.css`, `js/*` — so a
non-member never gets the app (and its inlined `STONKS_MANIFEST` narratives). The
data path enforces auth itself in `api/data/*`. Public: `welcome.html` (hand-made
landing + "Login with Discord", like `cheatsheet.html`), `favicon.svg`, `/api/auth/*`.

- Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200` (12 h). Lax is
  required so the post-OAuth top-level redirect carries it.
- Session length is the **role-revocation latency**: removing a role by hand takes
  effect within ≤ session length. 12 h is the v1 default; shorten or add periodic
  `me.js` re-validation later if instant kick matters.
- CSP needs **no change** — OAuth hops are top-level navigations, `me.js` is a
  `self` fetch; both already allowed.

### 4.6 Workflow changes

Each of `daily.yml`, `unusual-flow.yml`, `oi-tracker.yml`,
`search-interest.yml`, and `day-trading.yml`:

- **Add** a step before build/scan: `node scripts/sync-data.mjs pull`
  (env: store token). Replaces the data that `git checkout` used to supply.
- **Replace** the entire `git stash/commit/push data` block with
  `node scripts/sync-data.mjs push --owner=<bake|unusual|oi|search-interest|daytrading>`.
- Mark the run start, regenerate the final manifest sidecars, and run
  `node scripts/verify-data-freshness.mjs --owner=<owner>` before any external
  write. The verifier is ownership-aware: it requires current-run stamps for the
  producer's outputs; the bake additionally requires ≥95% ticker coverage,
  non-empty option chains, confirmed price history/technicals, current-session
  quote provenance while the market is regular, coherent decision-artifact
  stamps, and no explicit top-level `stale:true`. It also requires every
  declared bake output/history/cache to have been rewritten, matches current IV
  ranks to current-run, two-sided-quote-backed `iv-history/` samples (with at
  least 90% coverage required during regular trading), and rejects any
  bake-owned local key without an explicit publication policy. Flow and OI history files
  must contain the exact current scan represented by their headline payload.
  Ownership rules are single-sourced in `lib/data-ownership.mjs`, imported by
  both the verifier and `sync-data.mjs`.
- In private mode, **push verified data before committing the static shell**.
  The static commit triggers Vercel, so this order prevents a new deployment
  from pointing at an upload that has not finished (or failed). Also re-check
  that the source branch SHA has not moved during a long build; if it has, abort
  and let the next run rebuild with the new code.
- `close-bake-fallback.yml` watches the two possible UTC equivalents of 16:05
  ET and dispatches `daily.yml` only when no external close-slot dispatch exists
  since 15:55 ET. This is a zero-AI DST-safe backstop for a missed
  cron-job.org close slot, not a second normal bake.
- `daily.yml` rejects ordinary dispatches outside weekdays 09:15-17:00 ET
  before checkout or API use, which prevents a misconfigured 08:30 job from
  spending a full build. An intentional off-hours manual recovery uses the
  workflow's `force=true` input.
- **Keep** committing the *render output* `index.html`/`app.js`/`styles.css`? →
  **No** — under Path B those are gated too, but they're still static code, not
  data. Decision: keep regenerating + committing them to the (public) repo as today
  (they carry no premium data once the manifest's premium fields move to a gated
  fetch — see §7 open item), **or** move them behind the store too. Simplest v1:
  keep them in the repo (they're useless without gated data), and let `middleware.js`
  gate the page. Revisit if the inlined manifest is deemed too revealing.
- Keep the shared `concurrency` group (still required, §4.3).
- Keep `GEMINI_API_KEY`, `AI_*`, `BLS_/FRED_/OPENFIGI_` envs unchanged.

## 5. Migration & cutover (phased, reversible)

1. **Provision** store + token; add Discord app + role (§9 checklist).
2. **Seed**: `node scripts/sync-data.mjs seed` uploads the current `data/` wholesale.
3. **Deploy gate to PREVIEW** (this branch): `api/data/*` + rewrite + auth + middleware.
   Verify on the preview URL (test plan §8) while production still serves static.
4. **Cut production over**: merge → prod serves data through the gate.
5. **Flip workflows** to pull/push; stop committing `data/`.
6. **Stop tracking data**: `git rm -r --cached data/`, add `data/` to `.gitignore`.
   (Existing history still contains the data — a one-time `git filter-repo` purge is
   optional and only matters if un-leaking the *past* matters; going forward is
   protected regardless.)
7. **Make the repo private only if you still want to** — under Path B you no longer
   *need* to (code-only public repo keeps Actions free). If you privatise anyway,
   re-check Actions minutes per the earlier analysis.
8. Update `CLAUDE.md` (the "generated files are committed / data/ committed" sections
   change materially) and `CHANGELOG.md`.

Rollback at any step before 6 is trivial (re-enable static serving / revert the
rewrite). After step 6 the store is the source of truth.

## 6. Local dev & sibling scripts

`regen-static.mjs`, `regen-picks.mjs`, `regen-calendar.mjs`,
`backfill-autopick.mjs`, `diagnose-*.mjs`, `scan-*.mjs` all read local `DATA_DIR`.
Add `npm run data:pull` (= `sync-data.mjs pull`) and document "run it once before
local regen/diagnose." `npx vercel dev` exercises the real gated API locally.

## 7. Security checklist

- [ ] `api/data/*` path validation (regex allowlist, no `..`, `.json` only).
- [ ] All gated responses `Cache-Control: private, no-store` (no shared edge cache).
- [ ] Blob URLs **never** sent to the client — server-side `get` + stream only.
- [ ] OAuth `state` CSRF cookie validated in the callback.
- [ ] Session cookie `HttpOnly; Secure; SameSite=Lax`; HS256 via `jose`.
- [ ] Store token (`BLOB_READ_WRITE_TOKEN` / R2 keys) only in Actions secrets +
      Vercel env — never inlined, never client-side.
- [ ] `SESSION_SECRET`, `DISCORD_CLIENT_SECRET` server-only.
- [ ] **Open item:** the inlined `STONKS_MANIFEST` in `index.html` carries premium
      narratives/sector overviews. `middleware.js` gating the page covers it for
      non-members; if `index.html` is ever served publicly (e.g. for SEO) those
      fields must move to a gated `fetch` first (a `scripts/render/html.mjs` change).

## 8. Test plan (on the preview deploy)

- Logged-out `curl <preview>/data/picks.json` → **401**.
- Logged-out browser → redirected to `/welcome.html`.
- Discord account **not** in guild → callback denies → `welcome.html?denied=1`.
- Account in guild **without** role → denied.
- Account **with** role → cookie set → full app, all 22 data fetches `200`.
- Expired/old cookie → bounced to `welcome.html`.
- Workflow dry-run: `pull` hydrates, build runs unchanged, `push --owner=bake`
  uploads + delete-stales correctly; a simulated concurrent scanner push doesn't
  clobber bake keys and vice-versa.

## 9. What only you can provision (blockers for implementation)

1. **Object store + token.** Recommended v1: **Vercel Blob** — in the Vercel
   dashboard, create a Blob store, copy `BLOB_READ_WRITE_TOKEN`; add it as a GitHub
   Actions secret *and* it's auto-available to functions. (Alt: Cloudflare R2 —
   bucket + access key/secret + account id; better at scale, slightly more setup.)
   **→ Decided: Vercel Blob** (R2 remains a drop-in adapter swap if bandwidth cost appears).
2. **Discord application.** discord.com/developers → New Application → OAuth2: add
   redirect `https://<your-domain>/api/auth/discord-callback`; copy `CLIENT_ID` +
   `CLIENT_SECRET`.
3. **Guild + role IDs.** Enable Developer Mode in Discord; right-click your server →
   Copy Server ID (`DISCORD_GUILD_ID`); Server Settings → Roles → your gating role →
   Copy Role ID (`DISCORD_REQUIRED_ROLE_ID`).
4. **`SESSION_SECRET`** — generate 32+ random bytes (`openssl rand -hex 32`).

Set 1–4 as Vercel env vars (and the store token + `GEMINI_API_KEY` etc. as Actions
secrets). I'll wire everything to read these names.

## 10. Implementation order (once provisioned)

1. `lib/datastore.mjs` (Vercel Blob adapter) + `scripts/sync-data.mjs` + `seed`.
2. `lib/session.mjs` + `api/auth/*` + `welcome.html`.
3. `api/data/[...path].js` + `vercel.json` rewrite/headers + `middleware.js`.
4. Workflow edits (pull/push) — one workflow first, validate, then the other two.
5. Cutover steps §5.4–5.8 + `CLAUDE.md`/`CHANGELOG.md`.

Estimated ~1.5–2.5 focused days; §4.3 concurrency is the main risk and is now
specified up front to de-risk it.

---

## 11. As-built notes (steps 1–3 shipped on the branch)

Refinements made while implementing (supersede the sketch above where they differ):

- **Activation flag `PRIVATE_DATA_ENABLED`** (default off). Instead of a static
  `vercel.json` rewrite, the `/data/*` → `/api/data/*` routing **and** the page-shell
  gating both live in `middleware.js` and only engage when the flag is `"1"`. Flag
  off = today's behavior byte-for-byte (middleware `next()`s immediately, `api/data`
  hard-404s so a seeded store can't leak pre-cutover). **The whole cutover is a single
  env-var flip** — no code change — and is reversible. The static `data/*.json` keep
  serving until the flag flips.
- **Storage prefix.** `lib/datastore.mjs` namespaces every blob under a prefix derived
  from `sha256(BLOB_READ_WRITE_TOKEN)` (override `BLOB_PREFIX`) so URLs aren't guessable
  from the store host; the gate only ever fetches server-side.
- **Vercel Hobby 12-function limit.** The 4 Discord endpoints are consolidated into one
  dynamic-route function `api/auth/[action].js` (URLs unchanged), and the 4 dormant
  portfolio functions are excluded from the deploy via `.vercelignore` (kept in the
  tree). Deployed serverless count: **9** (7 live + auth + `api/data/[...path].js`).
- **Edge-safety.** `middleware.js` imports only `lib/session.mjs` (jose + TextEncoder,
  no `node:crypto`); `lib/datastore.mjs` (node:crypto) is imported only by the Node
  `api/data` function, never the Edge middleware.

**Still to do (steps 4–5, post-merge):** seed the store (`sync-data.mjs seed` via a
workflow_dispatch, which must be on `main` to appear), flip the bake/scan workflows to
`pull`/`push`, then on the preview deploy set `PRIVATE_DATA_ENABLED=1` + test §8, then
flip it on production, then `git rm --cached data/` + `.gitignore data/`.

## 12. Freemium pivot (the gate became a tier, not a wall)

The original design gated the **whole** site. It was later changed to **freemium**:
most tabs are free, a premium subset stays gated. The wiring:

- **Tier table — `lib/premium-keys.mjs`.** `isPremiumKey(key)` is the single source of
  truth for which `data/` keys require a session. `roleClaimForKey()` then separates
  ordinary member Premium from internal Owner. Only `earnings-tracker.json` is
  ordinary Premium. Actionable payloads require both `tr` and
  `tp`, including `manifest.json`, picks/briefs/grades/flow/volume/OI/IV/streak files,
  uppercase per-ticker JSON, and `iv-history/*`. General calendars, heatmap, filings,
  macro, fear/greed, correlations, transcripts, and `manifest-free.json` remain public.
  Both classifiers are Edge-safe and shared by the data handlers.
- **Sector Rotation accountability is bake-owned.** `sector-rotation-log.json`
  accumulates observed setups, timestamped model entries, and resolved outcomes;
  `sector-rotation.json` carries only its browser projection. Offline `regen-picks`
  reattaches that projection without manufacturing price events. An official
  entry requires the first baked `ready` signal plus an in-zone `REGULAR`-market
  quote no more than 10 minutes old; post-close signals remain pending rather
  than backdating a fill to the closing print. To reset only
  this strategy, run `node scripts/wipe-history.mjs --sector-rotation` (dry-run by
  default, add `--apply` to mutate the private store). The command leaves the
  screen payload intact; its embedded record refreshes on the next full bake.
- **`api/data` is tiered**, not all-or-nothing: free keys → `public, s-maxage` (edge
  cacheable); premium keys → session-or-401 + `private, no-store`.
- **The browser uses the proven auth-function boundary when the gate is on.**
  Production showed `/api/auth/me` recognizing a signed-in member while an adjacent
  `/api/data/quant.json` invocation received no session cookie and returned a false
  `401`. After the plain `/me` probe reports `enabled: true`, `dataUrl()` therefore
  routes store reads to `/api/auth/me?data=<key>` — the exact function already known
  to receive `stonks_session`. That data mode lazily imports
  `lib/data-response.mjs`, which is also used by `/api/data/*`, so key validation,
  free/premium classification, stricter `tr`/`tp` role claims, store access, and
  cache headers remain single-sourced. Ordinary `/me` and OAuth requests do not
  initialize the datastore SDKs. Flag-off deployments retain static `data/*`.
  `middleware.js` sends legacy `/data/*` callers (including already-open cached
  bundles) through the same auth data mode with a browser-followed same-origin
  `307`. The shell + live `/api/*` remain open.
- **Manifest split by tier.** Supersedes §7's open item: the premium fields go to the
  gated `data/manifest.json`, the free fields (macro/fear-greed/backdrop/spots/headlines)
  to a new public `data/manifest-free.json`. `app.js` fetches both before first paint.
  Keeping `manifest.json` as the *premium* key means the pre-cutover combined file stays
  gated — no leak window when the flag flips before the first split-aware bake.
- **Client UI half** (`scripts/render/app-js.mjs`): `PREMIUM_TABS` + `IS_MEMBER` (from
  `/api/auth/me`'s new `enabled`+`authed`) render a `.premium-lock` upsell card on premium
  tabs for non-members, a 🔒 on premium nav items, and a "Log in" header chip. Fail-open:
  ungated or a failed `/me` ⇒ no locks.
- **`welcome.html`** is no longer a forced wall — it's the login/denied lander, linking
  back to the free site at `/`.
- **All actionable surfaces are combined-role hidden.** Market Analysis, Brief,
  Narratives, Tickers, Grade, Compare, Strategies, Stock Picks, Sector Rotation,
  Leveraged ETFs, Event Spillover, Unusual Flow, Volume, Gamma Exposure, Trending IV, Streaks,
  Top Picks, Track Record, and Owner Lab require both `tr` and `tp`. The client
  removes their nav, landing, palette, pane, and deep-link surfaces for nonowners;
  server data independently enforces the same requirement. Both special role env
  settings are required and fail closed, but may point to the same owner-only role.
  They must never point to the paid membership role.

## 13. Free-public pivot (supersedes the freemium entitlement notes)

The private-store architecture remains in place, but it is now a storage and
Owner-isolation boundary rather than a membership paywall:

- `lib/premium-keys.mjs` retains its legacy export names for compatibility, but
  `isPremiumKey()` returns true only for the Owner idea/record payloads and raw
  logs (including `auto-picks.json`), `quant*.json`, `day-trading*.json`, the shared owners'
  `picks-watchlist.json`, and browser-inaccessible pipeline cache/accounting
  keys. Ticker/grade, brief, narrative, flow, volume, OI, IV, earnings, and
  manifest payloads remain public.
- The client has no premium tabs or signed-out login CTA. All public navigation,
  ticker links, deep links, loaders, and command-palette entries work without a
  session. `picks`, `stocks`, `rotation`, `levetf`, `track`, and `quant` are
  physically removed until the Owner session resolves.
- Discord OAuth reuses the existing `DISCORD_TOPPICKS_ROLE_ID(S)` owner role as
  the single entitlement, mints both signed compatibility claims, then redirects
  directly to `/?tab=quant`. `DISCORD_TRACKRECORD_ROLE_ID(S)` is no longer read.
  `welcome.html` is an unlinked Owner entry page, not a membership landing page.
- `middleware.js` only routes `/data/*` into the private-store reader. The old
  first-visit pricing/membership redirect was removed.
- Public data remains edge-cacheable. Owner/internal responses remain
  `private, no-store` and are enforced server-side, independently of the UI.
- Public Brief generation excludes all Owner-only idea/record sources so it
  cannot republish their facts through `briefs.json`.
- The public response boundary sanitizes pre-cutover store objects immediately:
  legacy per-ticker `autoPick` fields, old-policy Brief content, and Top-Picks
  lean/count fields in `regime-history.json` are stripped before public caching.
