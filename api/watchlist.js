// Vercel serverless function: the SHARED Top Picks watchlist.
//
// One list for everyone: any signed-in member (holding the Top Picks role,
// when that tier is configured) can save a pick or remove a saved one, and
// every member sees the same list. Stored in the private data store
// (lib/datastore.mjs) under REQUEST_TIME key "picks-watchlist.json" — a key
// the workflows never push or delete (REQUEST_TIME_EXCLUSIVE in
// scripts/sync-data.mjs), because a pulled copy is stale the moment a user
// clicks mid-bake.
//
//   GET  /api/watchlist                                  -> { items, updatedAt }
//   POST /api/watchlist { action: "add"|"remove", symbol, side }
//                                                        -> the updated list
//
// The pick snapshot is sourced SERVER-SIDE from the store's picks.json (the
// client sends only symbol+side) — a client can never inject payload into a
// document rendered to every other user. Each write also refreshes every
// saved entry against the current roster (adopt the fresh pick / mark the
// dropped ones stale) while picks.json is in hand, so snapshots stay current
// without a cron. Writes are last-writer-wins: fine at this scale, and the
// worst case is a lost toggle, not corruption.
//
// Access mirrors the picks.json data it snapshots (see api/data/[...path].js):
// hard-404 unless PRIVATE_DATA_ENABLED, valid Discord-role session required,
// and the stricter Top Picks `tp` claim honored the same fail-open way (401
// only when the mint explicitly set it false). Never shared-cacheable. When
// this endpoint is unreachable (gate off / signed out) the client falls back
// to its original per-browser localStorage list, so local/dev keeps working.

import { store } from "../lib/datastore.mjs";
import { getSession } from "../lib/session.mjs";

const KEY = "picks-watchlist.json";
const MAX_ITEMS = 30;
// Same cheap symbol allowlist shape as lib/yahoo.mjs::SYMBOL_RE.
const SYM_RE = /^[A-Z][A-Z0-9.]{0,5}$/;

const sideOf = (side) => (side === "put" ? "put" : "call");
const keyOf = (sym, side) => `${sym}|${sideOf(side)}`;

async function readJson(key) {
  const buf = await store.get(key);
  if (buf == null) return null;
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
}

async function readItems() {
  const j = await readJson(KEY);
  const items = j && Array.isArray(j.items) ? j.items : [];
  // Drop malformed entries defensively — the file is only ever written here,
  // but a bad deploy mustn't wedge the list forever.
  return items.filter((it) => it && it.pick && typeof it.pick.symbol === "string");
}

export default async function handler(req, res) {
  // Gate disabled → endpoint does not exist (mirrors api/data: no
  // unauthenticated store access; the client falls back to localStorage).
  if (process.env.PRIVATE_DATA_ENABLED !== "1") {
    return res.status(404).json({ error: "not found" });
  }
  // The list is derived from the role-hidden picks.json — never cacheable
  // across users. Set FIRST so no error branch can be edge-cached either.
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req).catch(() => null);
  if (!session) {
    return res.status(401).json({ error: "auth required" });
  }
  // Top Picks role claim — same fail-open contract as api/data: 401 only when
  // the mint explicitly set `tp` false (legacy sessions + env-unset pass).
  if (session.tp === false) {
    return res.status(401).json({ error: "role required" });
  }

  if (req.method === "GET") {
    try {
      const items = await readItems();
      return res.status(200).json({ items });
    } catch (err) {
      console.error("watchlist read failed", { message: String(err?.message || err) });
      return res.status(502).json({ error: "watchlist unavailable" });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const action = body.action;
  const symbol = String(body.symbol || "").toUpperCase();
  const side = sideOf(body.side);
  if ((action !== "add" && action !== "remove") || !SYM_RE.test(symbol)) {
    return res.status(400).json({ error: "bad request" });
  }

  try {
    const items = await readItems();
    // Current roster — the server-side source for snapshots + freshness.
    const picksJson = await readJson("picks.json");
    const picks = picksJson && Array.isArray(picksJson.picks) ? picksJson.picks : [];
    const byKey = {};
    for (const p of picks) {
      if (p && p.symbol) byKey[keyOf(p.symbol, p.side)] = p;
    }

    const today = new Date().toISOString().slice(0, 10);
    const idx = items.findIndex((it) => keyOf(it.pick.symbol, it.pick.side) === keyOf(symbol, side));
    if (action === "remove") {
      if (idx >= 0) items.splice(idx, 1);
    } else if (idx < 0) {
      const p = byKey[keyOf(symbol, side)];
      if (!p) {
        // Only picks in the CURRENT roster can be added (that's where the
        // snapshot comes from) — matches the UI, where the star only renders
        // on a live pick card.
        return res.status(404).json({ error: "not in the current picks" });
      }
      // savedGrade/savedSpot freeze the add-time baseline ON THE ITEM (the
      // pick payload itself is adopted fresh each build), so the client can
      // show "grade was X when you saved it → Y now" and price progress since
      // the save — the thesis-health read the watchlist cards render.
      items.unshift({
        pick: p, addedAt: today, lastSeen: today, stale: false,
        savedGrade: typeof p.total === "number" ? p.total : null,
        savedSpot: typeof p.spot === "number" ? p.spot : null,
      });
      if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;
    }
    // Freshness pass while picks.json is in hand: entries still shipping adopt
    // the fresh payload; dropped ones freeze (stale) at their last snapshot.
    for (const it of items) {
      const cur = byKey[keyOf(it.pick.symbol, it.pick.side)];
      if (cur) {
        it.pick = cur;
        it.stale = false;
        it.lastSeen = today;
      } else {
        it.stale = true;
      }
      // One-time migration for entries saved before the baseline existed:
      // stamp it from the best snapshot in hand so the delta reads start
      // accumulating from here instead of staying blank forever.
      if (it.savedGrade == null && typeof it.pick?.total === "number") it.savedGrade = it.pick.total;
      if (it.savedSpot == null && typeof it.pick?.spot === "number") it.savedSpot = it.pick.spot;
    }
    const out = { items, updatedAt: new Date().toISOString() };
    await store.put(KEY, JSON.stringify(out));
    return res.status(200).json(out);
  } catch (err) {
    console.error("watchlist write failed", { message: String(err?.message || err) });
    return res.status(502).json({ error: "watchlist unavailable" });
  }
}
