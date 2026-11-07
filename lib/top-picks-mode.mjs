// Top Picks market mode (2026-11-07, owner decision). An Owner switch on the
// Top Picks page that holds back new trades by side:
//
//   auto      today's rules, unchanged (the default)
//   no-puts   no new puts open; calls follow the normal rules
//   no-calls  no new calls open; puts follow the normal rules
//   pause     no new trades open
//
// It only governs NEW record trades. Open trades keep their exits, held-back
// names still show as watch ideas, and nothing else in the grade or the
// research changes. The mode is saved in top-picks-mode.json (Owner-only,
// request-time-owned: written only by api/auth/[action].js "top-picks-mode",
// never by a workflow). The 11:00 and 15:30 ET runs read it before the bake
// wipes data/, so a change applies from the next run that starts after it.
//
// Written in ES5 so app-js.mjs can embed the factory with toString(); the
// engine (scripts/build.mjs), the server route and the page share these rules.
export function topPicksModeFactory() {
  var MODES = ['auto', 'no-puts', 'no-calls', 'pause'];
  var LABEL = { 'auto': 'Auto', 'no-puts': 'No new puts', 'no-calls': 'No new calls', 'pause': 'Pause new trades' };
  var HELP = {
    'auto': 'Today’s rules. Calls and puts open when they clear every check.',
    'no-puts': 'New puts are held back. Calls open as usual.',
    'no-calls': 'New calls are held back. Puts open as usual.',
    'pause': 'No new trades open. Open trades keep their exits.'
  };
  function clean(mode) {
    var m = String(mode == null ? '' : mode).trim().toLowerCase();
    return MODES.indexOf(m) >= 0 ? m : 'auto';
  }
  function valid(mode) {
    return typeof mode === 'string' && MODES.indexOf(mode) >= 0;
  }
  // True when the mode keeps a NEW trade on this side from opening.
  function blocks(mode, side) {
    var m = clean(mode);
    if (m === 'pause') return side === 'call' || side === 'put';
    if (m === 'no-puts') return side === 'put';
    if (m === 'no-calls') return side === 'call';
    return false;
  }
  function label(mode) { return LABEL[clean(mode)]; }
  function help(mode) { return HELP[clean(mode)]; }
  // The reason shown on a held-back pick card.
  function heldHeadline(mode, side) {
    return 'Held back — market mode is “' + label(mode) + '”, so new ' + (side === 'put' ? 'puts' : 'calls') +
      ' don’t open. Switch to Auto on Top Picks to allow them.';
  }
  return { MODES: MODES, LABEL: LABEL, HELP: HELP, clean: clean, valid: valid, blocks: blocks, label: label, help: help, heldHeadline: heldHeadline };
}

export const TOP_PICKS_MODE_KEY = 'top-picks-mode.json';
export const TOP_PICKS_MODE_HISTORY = 20;
const M = topPicksModeFactory();
export const marketModeBlocks = M.blocks;
export const marketModeLabel = M.label;

// Stored record: { version, mode, updatedAt, by, history: [{ mode, at, by }] }.
// A missing, unreadable or unknown record reads as Auto, so the engine never
// holds trades back because of a bad file.
export function readTopPicksModeDoc(raw) {
  let doc = null;
  try { doc = raw == null ? null : JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')); } catch { doc = null; }
  if (!doc || typeof doc !== 'object') return { version: 1, mode: 'auto', updatedAt: null, by: null, history: [] };
  const history = Array.isArray(doc.history) ? doc.history.filter((h) => h && M.valid(h.mode)).slice(0, TOP_PICKS_MODE_HISTORY) : [];
  return {
    version: 1,
    mode: M.valid(doc.mode) ? doc.mode : 'auto',
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null,
    by: typeof doc.by === 'string' ? doc.by.slice(0, 64) : null,
    history,
  };
}

// The engine's view of the record: { mode, label, setAt, by }. Auto with no
// timestamp when nothing was ever saved.
export function marketModeForRun(doc) {
  const d = doc && typeof doc === 'object' && M.valid(doc.mode) ? doc : readTopPicksModeDoc(null);
  return { mode: d.mode, label: M.label(d.mode), setAt: d.updatedAt || null, by: d.by || null };
}

// POST body { mode }. Returns { doc } (the new record) or { error }.
export function applyTopPicksModeRequest(current, body, { at = new Date().toISOString(), by = null } = {}) {
  const mode = body && typeof body === 'object' ? body.mode : null;
  if (!M.valid(mode)) return { error: 'bad mode' };
  const cur = readTopPicksModeDoc(current == null ? null : JSON.stringify(current));
  const who = typeof by === 'string' && by ? by.slice(0, 64) : null;
  if (cur.mode === mode && cur.updatedAt) return { doc: cur, unchanged: true };
  const history = [{ mode, at, by: who }, ...cur.history].slice(0, TOP_PICKS_MODE_HISTORY);
  return { doc: { version: 1, mode, updatedAt: at, by: who, history } };
}
