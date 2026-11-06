// Owner watchlist sync (2026-11-06). The stock page's "☆ Watch" list lives in
// localStorage (stonks-watch-v1) for everyone; for a signed-in Owner it is
// also saved privately in the store (owner-watchlist.json, Owner-only,
// request-time-owned) so it follows the Owner across devices. One list per
// Discord account, keyed by a hash of the session's user id.
//
// Written in ES5 so app-js.mjs can embed the factory with toString(); the
// server (api/auth/[action].js, action "owner-watchlist") uses the same rules.
export function ownerWatchlistFactory() {
  var MAX = 40;
  var SYM_RE = /^[A-Z][A-Z0-9.]{0,5}$/;
  function cleanSym(s) {
    var v = String(s == null ? '' : s).trim().toUpperCase();
    return SYM_RE.test(v) ? v : null;
  }
  function clean(list) {
    var out = [];
    if (!list || typeof list.length !== 'number') return out;
    for (var i = 0; i < list.length && out.length < MAX; i++) {
      var s = cleanSym(list[i]);
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  }
  // Three-way merge. base is the list this device and the server last agreed
  // on: symbols added here since then are added to the server's list, symbols
  // removed here are removed from it, and everything else follows the server
  // (so a removal on another device sticks). With no base (first sync on this
  // device) nothing is removed: the result is the server list plus this
  // device's extra names.
  function merge(server, local, base) {
    server = clean(server); local = clean(local);
    if (!base) {
      var u = server.slice();
      for (var i = 0; i < local.length; i++) if (u.indexOf(local[i]) < 0) u.push(local[i]);
      return u.slice(0, MAX);
    }
    base = clean(base);
    var added = local.filter(function (s) { return base.indexOf(s) < 0; });
    var removed = base.filter(function (s) { return local.indexOf(s) < 0; });
    var out = server.filter(function (s) { return removed.indexOf(s) < 0; });
    for (var j = added.length - 1; j >= 0; j--) if (out.indexOf(added[j]) < 0) out.unshift(added[j]);
    return out.slice(0, MAX);
  }
  // op: { op: 'add'|'remove', symbol } -> the new list (newest first).
  function apply(list, op) {
    var out = clean(list);
    var s = cleanSym(op && op.symbol);
    if (!s) return out;
    var i = out.indexOf(s);
    if (op.op === 'remove') { if (i >= 0) out.splice(i, 1); return out; }
    if (op.op === 'add') { if (i >= 0) out.splice(i, 1); out.unshift(s); return out.slice(0, MAX); }
    return out;
  }
  return { MAX: MAX, cleanSym: cleanSym, clean: clean, merge: merge, apply: apply };
}

export const OWNER_WATCHLIST_KEY = 'owner-watchlist.json';

// Server-side record: { version, users: { <userKey>: { symbols, updatedAt } } }.
export function readOwnerWatchlistDoc(raw) {
  let doc = null;
  try { doc = raw == null ? null : JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')); } catch { doc = null; }
  if (!doc || typeof doc !== 'object' || !doc.users || typeof doc.users !== 'object') return { version: 1, users: {} };
  return { version: 1, users: doc.users };
}

// The request body for POST: { op: 'add'|'remove', symbol } or
// { op: 'sync', local: [...], base: [...]|null }. Returns { list } or { error }.
export function applyOwnerWatchlistRequest(current, body) {
  const W = ownerWatchlistFactory();
  const op = body && typeof body === 'object' ? String(body.op || '') : '';
  if (op === 'add' || op === 'remove') {
    if (!W.cleanSym(body.symbol)) return { error: 'bad symbol' };
    return { list: W.apply(current, { op, symbol: body.symbol }) };
  }
  if (op === 'sync') {
    if (!Array.isArray(body.local) || (body.base != null && !Array.isArray(body.base))) return { error: 'bad sync' };
    if (body.local.length > 200 || (body.base && body.base.length > 200)) return { error: 'list too long' };
    return { list: W.merge(current, body.local, body.base || null) };
  }
  return { error: 'bad op' };
}
