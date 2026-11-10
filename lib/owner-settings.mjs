// Owner settings (2026-11-10, owner request): the Owner Settings page lets an
// Owner change a short, fixed list of switches and numbers on the site instead
// of in the repo. Everything here is an override on top of the code default:
//
//   build  read by the bake. scripts/owner-settings-env.mjs (loaded with
//          `node --import` before scripts/build.mjs) copies the saved values
//          into process.env, so lib/top-picks-config.mjs and the other
//          switches read them exactly as if a repo variable were set. A value
//          already in the environment (a repo variable Sean set) wins and the
//          setting shows as pinned. Changes apply from the next build; Top
//          Picks changes from the next 11:00 or 15:30 ET run.
//   site   read at request time by api/auth/[action].js. These can only turn
//          a feature OFF. "On" means "follow the Vercel setting", so anything
//          switched off in Vercel stays off.
//
// The list is closed on purpose. Models, AI budgets, exits, grading weights,
// conviction bars, schedules, the stock list, secrets and Robinhood approvals
// stay in the repo; there is no track record reset here.
//
// Stored in owner-settings.json: Owner-only, request-time-owned (written only
// by api/auth/[action].js "owner-settings", never by a workflow). Shape:
//   { version, values: { KEY: value }, updatedAt, by, seq,
//     history: [{ id, at, by, kind, changes: [{ key, from, to }], undone? }] }
// A value missing from `values` is the default. from/to null = the default.

export const OWNER_SETTINGS_KEY = "owner-settings.json";
export const OWNER_SETTINGS_APPLIED_KEY = "owner-settings-applied.json";
export const OWNER_SETTINGS_HISTORY = 50;
export const OWNER_SETTINGS_VERSION = 1;

const DEC7 = "2026-12-07";

// kind: switch (true/false), number, choice. env(v) is the environment string
// for a non-default value. picks: changes which Top Picks trades open, so new
// trades are stamped and the Track Record draws a dated divider.
export const OWNER_SETTINGS = Object.freeze([
  // --- Top Picks switches ---------------------------------------------------
  { key: "PICKS_EVENT_AWARE", scope: "build", group: "Top Picks", kind: "switch", default: true, picks: true,
    label: "Event plays", help: "Trades through macro events and earnings when the evidence agrees, and post-shock puts. Off = the engine waits out events." },
  { key: "PICKS_MACRO_CONTEXT", scope: "build", group: "Top Picks", kind: "switch", default: true, picks: true,
    label: "Macro context block", help: "Keeps calls and puts off when they fight the rates, credit and rotation backdrop." },
  { key: "PICKS_SINGLES_DEFAULT", scope: "build", group: "Top Picks", kind: "switch", default: true, picks: true,
    label: "Single options by default", help: "Single calls and puts unless earnings fall inside the hold or a contract costs more than the cap. Off = the older spread-heavy mix." },
  { key: "AI_THESIS", scope: "build", group: "Top Picks", kind: "switch", default: true, picks: true,
    label: "AI final grader", help: "The AI grade and buy-now/wait call on the top six names. Off saves its AI cost; grades and exits are unchanged and trades are stamped grader off." },
  // --- Top Picks numbers ----------------------------------------------------
  { key: "PICKS_COUNT", scope: "build", group: "Top Picks", kind: "number", default: 6, min: 1, max: 6, step: 1, picks: true,
    label: "Most picks per run", help: "How many actionable picks a run can ship. Capped at 6 so the AI grader never reads more names than today." },
  { key: "PICKS_WATCH_COUNT", scope: "build", group: "Top Picks", kind: "number", default: 6, min: 0, max: 10, step: 1,
    label: "Most watch ideas", help: "How many watch ideas show under the picks. Display only; no AI." },
  { key: "PICKS_SINGLE_MAX_COST", scope: "build", group: "Top Picks", kind: "number", default: 5000, min: 1000, max: 10000, step: 500, unit: "$", picks: true,
    label: "Single option cost cap", help: "One contract of a single costing more than this becomes a debit spread." },
  { key: "PICKS_MACRO_BLOCK_PTS", scope: "build", group: "Top Picks", kind: "number", default: 0.5, min: 0.25, max: 1.5, step: 0.25, picks: true,
    label: "Macro block strength", help: "How strongly the macro read must lean against a trade to block it. Lower blocks more trades." },
  { key: "PICKS_DISPLAY_ACCOUNT", scope: "build", group: "Top Picks", kind: "number", default: 25000, min: 1000, max: 1000000, step: 1000, unit: "$",
    label: "Display account size", help: "The account size used for the suggested position sizes on cards. Display only." },
  // --- Research and measurement ---------------------------------------------
  { key: "PICKS_RUN_ARCHIVE", scope: "build", group: "Research", kind: "switch", default: true,
    label: "Top Picks run archive", help: "Saves every decision run's scored universe for later tests. Measurement only." },
  { key: "REGIME_LAB", scope: "build", group: "Research", kind: "switch", default: true,
    label: "Regime Lab", help: "The Owner Lab regime paper books. Changes no pick." },
  { key: "CROWD", scope: "build", group: "Research", kind: "switch", default: true,
    label: "Crowd & positioning data", help: "The free crowd sources. Off carries the last files forward." },
  { key: "LOOP", scope: "build", group: "Research", kind: "switch", default: true,
    label: "Self-improving loop", help: "Prediction ledger, diagnosis and challengers. Off stops the measurement and keeps the prior files." },
  // --- Locked until Dec 7 -----------------------------------------------------
  { key: "PICKS_CROWD_SQUEEZE_VETO", scope: "build", group: "After Dec 7", kind: "switch", default: false, picks: true, lockedUntil: DEC7, confirm: true,
    label: "Crowd squeeze veto", help: "No new puts on hard-to-borrow names. Turn on only after the Evidence table shows it clearing the bar." },
  { key: "PICKS_CROWD_GRADER", scope: "build", group: "After Dec 7", kind: "switch", default: false, picks: true, lockedUntil: DEC7, confirm: true,
    label: "Crowd lines in the AI grader", help: "Adds the crowd facts to the AI grader's prompt." },
  { key: "PICKS_MACRO_PUTCALL_SRC", scope: "build", group: "After Dec 7", kind: "choice", default: "universe", picks: true, lockedUntil: DEC7, confirm: true,
    options: [["universe", "Covered stocks"], ["cboe", "Cboe equity put/call"]],
    label: "Put/call source for the market tape", help: "Which put/call reading votes on the market tape." },
  { key: "SELF_TUNE", scope: "build", group: "After Dec 7", kind: "choice", default: "shadow", picks: true, lockedUntil: DEC7, lockedValues: ["on"], confirm: true,
    options: [["shadow", "Shadow (proposals only)"], ["off", "Off (frozen base)"], ["on", "On (applies inside the limits)"]],
    label: "Self-tuning", help: "Shadow shows proposals and changes nothing. On applies the tuned weights inside the loop's limits, from Dec 7 only." },
  // --- Live site switches (request time, can only turn off) -------------------
  { key: "CONTACT_ENABLED", scope: "site", group: "Live site", kind: "switch", default: true,
    label: "Message box", help: "The public Send us a message form. Off stops new messages; the inbox keeps every message." },
  { key: "SPORTS_ENABLED", scope: "site", group: "Live site", kind: "switch", default: true,
    label: "Sports section", help: "The Owner NBA, NFL and Pick Builder pages and their MCP tools." },
  { key: "MCP_ENABLED", scope: "site", group: "Live site", kind: "switch", default: true,
    label: "MCP server", help: "The read-only research server for ChatGPT, Claude and other AI clients." },
  { key: "WEBULL_MIRROR", scope: "site", group: "Live site", kind: "switch", default: true,
    label: "Webull paper mirror", help: "Copies Top Picks trades into the Webull paper account. Off pauses it. It only runs when Vercel has it on." },
]);

const BY_KEY = new Map(OWNER_SETTINGS.map((d) => [d.key, d]));
export const ownerSettingDef = (key) => BY_KEY.get(key) || null;

// The environment value that means "off" for each site switch.
const SITE_OFF = { CONTACT_ENABLED: "0", SPORTS_ENABLED: "0", MCP_ENABLED: "0", WEBULL_MIRROR: "off" };

export function etDate(at = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// True when this value may not be set yet (before the lock date).
export function isLocked(def, value, today = etDate()) {
  if (!def || !def.lockedUntil || today >= def.lockedUntil) return false;
  if (sameValue(value, def.default)) return false;
  if (Array.isArray(def.lockedValues)) return def.lockedValues.includes(value);
  return true;
}

function sameValue(a, b) { return a === b; }

// Clean one value for a setting; undefined when it is not allowed.
export function cleanValue(def, raw) {
  if (!def) return undefined;
  if (def.kind === "switch") {
    if (raw === true || raw === "on" || raw === "1" || raw === 1) return true;
    if (raw === false || raw === "off" || raw === "0" || raw === 0) return false;
    return undefined;
  }
  if (def.kind === "number") {
    if (raw === "" || raw == null || typeof raw === "boolean") return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < def.min || n > def.max) return undefined;
    const steps = Math.round((n - def.min) / def.step);
    if (Math.abs(def.min + steps * def.step - n) > 1e-9) return undefined;
    return Math.round(n * 1e6) / 1e6;
  }
  if (def.kind === "choice") {
    const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    return def.options.some((o) => o[0] === v) ? v : undefined;
  }
  return undefined;
}

// The environment string for a value.
export function envValue(def, value) {
  if (def.kind === "switch") {
    if (def.scope === "site") return value ? null : SITE_OFF[def.key];
    return value ? "1" : "0";
  }
  return String(value);
}

function emptyDoc() {
  return { version: OWNER_SETTINGS_VERSION, values: {}, updatedAt: null, by: null, seq: 0, history: [] };
}

function cleanChange(c) {
  const def = c && ownerSettingDef(c.key);
  if (!def) return null;
  const v = (x) => (x == null ? null : cleanValue(def, x) ?? null);
  return { key: def.key, from: v(c.from), to: v(c.to) };
}

// Read the stored record. A missing, unreadable or unknown record reads as
// every default, and unknown keys or out-of-range values are dropped, so a bad
// file can never push a setting outside its range.
export function readOwnerSettingsDoc(raw) {
  let doc = null;
  try {
    if (raw == null) doc = null;
    else if (typeof raw === "string") doc = JSON.parse(raw);
    else if (raw instanceof Uint8Array) doc = JSON.parse(Buffer.from(raw).toString("utf8"));
    else doc = raw;
  } catch { doc = null; }
  if (!doc || typeof doc !== "object") return emptyDoc();
  const values = {};
  const src = doc.values && typeof doc.values === "object" ? doc.values : {};
  for (const def of OWNER_SETTINGS) {
    if (!Object.prototype.hasOwnProperty.call(src, def.key)) continue;
    const v = cleanValue(def, src[def.key]);
    if (v !== undefined && !sameValue(v, def.default)) values[def.key] = v;
  }
  const history = (Array.isArray(doc.history) ? doc.history : []).filter((h) => h && typeof h === "object").slice(0, OWNER_SETTINGS_HISTORY).map((h) => ({
    id: Number.isFinite(Number(h.id)) ? Number(h.id) : 0,
    at: typeof h.at === "string" ? h.at : null,
    by: typeof h.by === "string" ? h.by.slice(0, 64) : null,
    kind: ["set", "reset", "reset-all", "undo"].includes(h.kind) ? h.kind : "set",
    changes: (Array.isArray(h.changes) ? h.changes : []).map(cleanChange).filter(Boolean),
    ...(h.undone ? { undone: true } : {}),
    ...(Number.isFinite(Number(h.of)) ? { of: Number(h.of) } : {}),
  }));
  return {
    version: OWNER_SETTINGS_VERSION,
    values,
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : null,
    by: typeof doc.by === "string" ? doc.by.slice(0, 64) : null,
    seq: Number.isFinite(Number(doc.seq)) ? Number(doc.seq) : history.reduce((m, h) => Math.max(m, h.id), 0),
    history,
  };
}

export const currentValue = (doc, def) => (Object.prototype.hasOwnProperty.call(doc.values, def.key) ? doc.values[def.key] : def.default);

// Apply one Owner request:
//   { act: "set", values: { KEY: value, ... }, confirm? }
//   { act: "reset", key }        one setting back to its default
//   { act: "reset-all" }         every setting back to its default
//   { act: "undo" }              reverse the newest change not yet undone
// Returns { doc } | { doc, unchanged: true } | { error }.
export function applyOwnerSettingsRequest(current, body, { at = new Date().toISOString(), by = null } = {}) {
  const cur = readOwnerSettingsDoc(current);
  const who = typeof by === "string" && by ? by.slice(0, 64) : null;
  const today = etDate(at);
  const act = body && typeof body === "object" ? body.act : null;
  let target = null; // { KEY: value|null(default) }
  let kind = act;
  let undoOf = null;
  if (act === "set") {
    const vals = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values : null;
    const keys = vals ? Object.keys(vals) : [];
    if (!keys.length || keys.length > OWNER_SETTINGS.length) return { error: "nothing to change" };
    target = {};
    for (const k of keys) {
      const def = ownerSettingDef(k);
      if (!def) return { error: `unknown setting ${String(k).slice(0, 40)}` };
      const v = cleanValue(def, vals[k]);
      if (v === undefined) return { error: `${def.label}: value out of range` };
      if (isLocked(def, v, today)) return { error: `${def.label} can't be turned on before ${def.lockedUntil}` };
      if (def.confirm && !sameValue(v, def.default) && body.confirm !== true) return { error: `${def.label} needs confirmation`, needsConfirm: true };
      target[k] = sameValue(v, def.default) ? null : v;
    }
  } else if (act === "reset") {
    const def = ownerSettingDef(body.key);
    if (!def) return { error: "unknown setting" };
    target = { [def.key]: null };
  } else if (act === "reset-all") {
    target = Object.fromEntries(OWNER_SETTINGS.map((d) => [d.key, null]));
  } else if (act === "undo") {
    const last = cur.history.find((h) => h.kind !== "undo" && !h.undone);
    if (!last) return { error: "nothing to undo" };
    target = {};
    for (const c of last.changes) {
      const def = ownerSettingDef(c.key);
      // An undo may never turn a locked value back on early.
      if (c.from != null && isLocked(def, c.from, today)) return { error: `${def.label} can't be turned on before ${def.lockedUntil}` };
      target[c.key] = c.from;
    }
    undoOf = last.id;
  } else return { error: "bad request" };

  const changes = [];
  const values = { ...cur.values };
  for (const [k, v] of Object.entries(target)) {
    const def = ownerSettingDef(k);
    const from = Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null;
    if (sameValue(from, v)) continue;
    if (v == null) delete values[k]; else values[k] = v;
    changes.push({ key: def.key, from, to: v });
  }
  if (!changes.length && undoOf == null) return { doc: cur, unchanged: true };
  const id = cur.seq + 1;
  const history = cur.history.map((h) => (undoOf != null && h.id === undoOf ? { ...h, undone: true } : h));
  const entry = { id, at, by: who, kind, changes, ...(undoOf != null ? { of: undoOf } : {}) };
  return { doc: { version: OWNER_SETTINGS_VERSION, values, updatedAt: at, by: who, seq: id, history: [entry, ...history].slice(0, OWNER_SETTINGS_HISTORY) } };
}

// What the page shows: the catalog with each setting's value.
export function ownerSettingsView(doc, { today = etDate(), applied = null, env = null } = {}) {
  const d = readOwnerSettingsDoc(doc);
  const pinned = new Set(Array.isArray(applied?.pinned) ? applied.pinned : []);
  return {
    version: d.version,
    updatedAt: d.updatedAt,
    by: d.by,
    today,
    settings: OWNER_SETTINGS.map((def) => {
      const value = currentValue(d, def);
      // A site switch is held off by Vercel when its env already says off.
      const vercelOff = def.scope === "site" && env ? siteEnvOff(def.key, env) : false;
      return {
        key: def.key, scope: def.scope, group: def.group, kind: def.kind, label: def.label, help: def.help,
        default: def.default, value, changed: !sameValue(value, def.default),
        ...(def.kind === "number" ? { min: def.min, max: def.max, step: def.step, unit: def.unit || null } : {}),
        ...(def.kind === "choice" ? { options: def.options } : {}),
        ...(def.picks ? { picks: true } : {}),
        ...(def.confirm ? { confirm: true } : {}),
        ...(def.lockedUntil && today < def.lockedUntil ? { lockedUntil: def.lockedUntil, lockedValues: def.lockedValues || null } : {}),
        ...(pinned.has(def.key) ? { pinned: true } : {}),
        ...(vercelOff ? { vercelOff: true } : {}),
      };
    }),
    history: d.history,
    applied: applied || null,
  };
}

function siteEnvOff(key, env) {
  const v = String(env[key] ?? "").trim().toLowerCase();
  if (key === "WEBULL_MIRROR") return v !== "on";
  return v === "0";
}

// --- build side ---------------------------------------------------------------
// Copy saved build values into env. A key already set (non-empty) in env is a
// repo variable and wins (pinned). Locked values are skipped again here, so a
// hand-edited file can't switch one on early. Returns the report the build
// writes to owner-settings-applied.json and stamps on new trades.
export function applyOwnerSettingsToEnv(doc, env = process.env, { at = new Date() } = {}) {
  const d = readOwnerSettingsDoc(doc);
  const today = etDate(at);
  const applied = {}, pinned = [], skipped = [];
  for (const def of OWNER_SETTINGS) {
    if (def.scope !== "build") continue;
    const envNow = env[def.key];
    const has = envNow != null && String(envNow).trim() !== "";
    if (has) pinned.push(def.key);
    if (!Object.prototype.hasOwnProperty.call(d.values, def.key)) continue;
    const value = d.values[def.key];
    if (has) { skipped.push({ key: def.key, reason: "repo variable" }); continue; }
    if (isLocked(def, value, today)) { skipped.push({ key: def.key, reason: `locked until ${def.lockedUntil}` }); continue; }
    env[def.key] = envValue(def, value);
    applied[def.key] = value;
  }
  return { appliedAt: new Date(at).toISOString(), settingsUpdatedAt: d.updatedAt, seq: d.seq, applied, pinned, skipped, picksTag: picksTag(applied) };
}

// Short stable tag of the applied Top Picks settings, e.g.
// "PICKS_COUNT=4,PICKS_EVENT_AWARE=off". Empty when every one is the default.
export function picksTag(applied) {
  return Object.keys(applied || {}).filter((k) => ownerSettingDef(k)?.picks).sort().map((k) => {
    const v = applied[k];
    return `${k}=${v === true ? "on" : v === false ? "off" : v}`;
  }).join(",");
}

// Plain words for a tag, for the Track Record divider.
export function describePicksTag(tag) {
  if (!tag) return "";
  return String(tag).split(",").map((part) => {
    const [k, v] = part.split("=");
    const def = ownerSettingDef(k);
    return def ? `${def.label} ${v}` : part;
  }).join("; ");
}

// --- request side ---------------------------------------------------------------
// Site switches the Owner turned off, as env overrides for this request.
export function runtimeEnvOverrides(doc) {
  const d = readOwnerSettingsDoc(doc);
  const out = {};
  for (const def of OWNER_SETTINGS) {
    if (def.scope !== "site") continue;
    if (Object.prototype.hasOwnProperty.call(d.values, def.key) && d.values[def.key] === false) out[def.key] = SITE_OFF[def.key];
  }
  return out;
}
