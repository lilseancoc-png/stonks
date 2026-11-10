// Self-improving loop, step 4: adjust (S1-S4, A2, K1-K4). Spec: docs/self-loop.md.
//
// The only part of the loop that can change a live pick, and only when
// SELF_TUNE=on, from LIVE_FLOOR (December 7, 2026) on, inside fixed limits:
//
//   S1 stated odds   the count model's chances ride each pick card.
//   S2 EV gate       with the Owner's OK, a name whose stated option value
//                    after costs is below zero does not open.
//   S3 weights       once a week each input's weight drifts toward what its
//                    rank correlation over the last 60 sessions has proven
//                    (40+ sessions, 0.03+, the same sign in both halves),
//                    shrunk toward 1, inside 0.5x-1.5x, at most 0.1 a week.
//   S4 auto-mute     an input that pointed the wrong way in both halves of the
//                    last 60 sessions drops to weight 0 until both halves turn.
//   C3 promotion     a challenger that passed step 3's check applies only with
//                    the Owner's OK (mute, lean 1.5x, trade bar 3.5-6).
//
// A2: S1, S3 and S4 are automatic, logged, with an undo button; S2 and C3 wait
// for the Owner. All weights together move one name's total by at most
// MAX_DELTA points and never flip its side.
//
// K1 SELF_TUNE=off (or LOOP=0) runs the frozen base settings at the next run;
//    unset is "shadow": proposals are computed and shown, nothing applies.
// K2 auto-undo: a version whose first 15 decided trades trail the base rules
//    (replayed on the same runs from the untuned totals) by more than 5
//    points a trade reverts itself, and what it changed is held for 60
//    sessions.
// K3 versioned settings: every version is kept in the loop state with why and
//    by whom it was made; any version can be restored.
// K4 losing-streak freeze: 6 losses in a row, or the last 20 record trades
//    averaging below -10%, since tuning went live, stops new self-changes
//    (trading goes on; the market mode stays the Owner's brake).
//
// Never by the loop: AI model or prompt spend, live money or Webull settings,
// a Track Record reset, the universe, exits, stops or structures.
//
// Pure, no network, no AI.

import { inputIcByRun } from "./diagnose.mjs";
import { bookTrades } from "./challengers.mjs";
import { estimateFor, fitCalibration, MIN_ROWS_FOR_ESTIMATE } from "./calibrate.mjs";
import { joinedRows } from "./ledger.mjs";

export const TUNE_VERSION = 1;
export const LIVE_FLOOR = "2026-12-07";
export const W_MIN = 0.5;
export const W_MAX = 1.5;
export const W_STEP = 0.1;               // a weight moves at most this much a week
export const MAX_DELTA = 2;              // points one name's total may move, all weights together
export const SHRINK_SESSIONS = 60;       // pull of a proven input's target back toward 1
export const INPUT_MIN_SESSIONS = 40;
export const INPUT_IC_BAR = 0.03;
export const INPUT_WINDOW = 60;
export const UNDO_TRADES = 15;
export const UNDO_GAP = -5;
export const FREEZE_STREAK = 6;
export const FREEZE_WINDOW = 20;
export const FREEZE_AVG = -10;
export const BAR_MIN = 3.5;
export const BAR_MAX = 6;
export const HOLD_SESSIONS = 60;         // after an undo or a decline
export const VERSIONS_KEEP = 60;
export const LOG_KEEP = 80;
export const ACTIONS_KEEP = 200;
export const LOOP_CONTROL_KEY = "picks-loop-control.json";

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 + 0 : null); // + 0 turns -0 into 0
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 + 0 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 + 0 : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// K1. LOOP=0 stops everything; SELF_TUNE=0/off/false is the frozen base;
// on/1/true/live applies; anything else (unset) is shadow.
export function tuneMode(env = process.env) {
  if (/^(?:0|false|off)$/i.test(String(env.LOOP ?? "1").trim())) return "off";
  const v = String(env.SELF_TUNE ?? "").trim().toLowerCase();
  if (v === "0" || v === "off" || v === "false") return "off";
  if (v === "1" || v === "on" || v === "true" || v === "live") return "on";
  return "shadow";
}

// ---- settings ------------------------------------------------------------------------------

const INPUT_RE = /^(?:P:(?:f|t|m|n|iv|rg)|[A-Za-z][A-Za-z0-9_]{0,31})$/;
export const isInputKey = (k) => typeof k === "string" && INPUT_RE.test(k);

export function cleanSettings(s) {
  const out = { weights: {}, evGate: false, bar: null };
  if (!s || typeof s !== "object") return out;
  const keys = Object.keys(s.weights && typeof s.weights === "object" ? s.weights : {}).filter(isInputKey).sort();
  for (const k of keys) {
    const w = num(s.weights[k]);
    if (w == null) continue;
    const c = w <= 0 ? 0 : r2(clamp(w, W_MIN, W_MAX));
    if (c !== 1) out.weights[k] = c;
  }
  out.evGate = s.evGate === true;
  const b = num(s.bar);
  if (b != null) out.bar = r2(clamp(b, BAR_MIN, BAR_MAX));
  return out;
}
export const isBaseSettings = (s) => { const c = cleanSettings(s); return !Object.keys(c.weights).length && !c.evGate && c.bar == null; };
export const sameSettings = (a, b) => JSON.stringify(cleanSettings(a)) === JSON.stringify(cleanSettings(b));

// What changed between two settings, as approval-style ids.
function changedIds(a, b) {
  const x = cleanSettings(a), y = cleanSettings(b), out = [];
  for (const k of new Set([...Object.keys(x.weights), ...Object.keys(y.weights)])) if ((x.weights[k] ?? 1) !== (y.weights[k] ?? 1)) out.push(`w:${k}`);
  if (x.evGate !== y.evGate) out.push("ev-gate");
  if (x.bar !== y.bar) out.push("bar");
  return out;
}

export function settingsSummary(s) {
  const c = cleanSettings(s);
  const w = Object.entries(c.weights);
  const parts = [];
  if (w.length) parts.push(`${w.length} input weight${w.length === 1 ? "" : "s"} (${w.filter(([, v]) => v === 0).length} muted)`);
  if (c.evGate) parts.push("expected-value gate on");
  if (c.bar != null) parts.push(`trade bar ${c.bar}`);
  return parts.length ? parts.join(", ") : "base settings";
}

// ---- the live overlay ------------------------------------------------------------------------

// Delta method: each weighted input moves the total by (weight - 1) x its
// vote (a pillar key "P:x" reads the pillar score). Bounded at MAX_DELTA.
export function loopDelta(signals, pillars, weights) {
  let d = 0;
  const parts = {};
  for (const [k, w] of Object.entries(weights || {})) {
    const vote = k.startsWith("P:") ? num(pillars?.[k.slice(2)]) : num(signals?.[k]);
    const ww = num(w);
    if (!vote || ww == null) continue;
    const x = (ww - 1) * vote;
    if (x) { parts[k] = r2(x); d += x; }
  }
  return { delta: r2(clamp(d, -MAX_DELTA, MAX_DELTA)) ?? 0, parts: Object.keys(parts).length ? parts : null };
}

// The tuned total: the delta added, never past zero (the side never flips).
export function tunedTotal(total, delta) {
  const t = num(total);
  if (t == null) return total;
  const d = num(delta) || 0;
  if (!d) return t;
  const n = t + d;
  if (t !== 0 && Math.sign(n) !== Math.sign(t)) return 0;
  return r2(n);
}

// The trade bar at a run: the loop bar when one is set, never under a raised
// edge-governor bar.
export function loopTradeBar(baseBar, loopBar, floorBar = 4) {
  const b = num(baseBar), l = num(loopBar);
  if (l == null) return b;
  if (b != null && b > floorBar) return Math.max(b, l);
  return l;
}

// What the Top Picks run uses. Null unless SELF_TUNE=on and the date is past
// LIVE_FLOOR: then the current version's settings and a count model fitted on
// rows resolved before today (for the stated odds and the EV gate).
export function loopLivePlan(state, { mode = "shadow", today = null, outcomes = null } = {}) {
  if (mode !== "on" || !state?.tune || !today || today < LIVE_FLOOR) return null;
  const t = state.tune;
  const cur = t.versions.find((v) => v.n === t.current) || t.versions[0];
  const settings = cleanSettings(cur?.settings);
  const rows = joinedRows(state.ledger, outcomes);
  const model = fitCalibration(rows, { before: today, useBase: true });
  return { version: cur?.n ?? 0, settings, model, frozen: !!t.frozen, tuned: !isBaseSettings(settings) };
}

export function planEstimate(plan, setup) {
  return plan?.model ? estimateFor(plan.model, setup) : null;
}

// ---- S3 / S4 ---------------------------------------------------------------------------------

// Per input over the newest INPUT_WINDOW run dates: days with a read, the
// average per-run rank correlation with the 5-session move, each half, and
// whether it is proven up (0.03+, both halves positive) or down.
export function inputEvidence(rows, { window = INPUT_WINDOW } = {}) {
  const runs = inputIcByRun(rows, "y5");
  const dates = [...new Set(runs.map((r) => r.d))].sort().slice(-window);
  const keep = new Set(dates);
  const recent = runs.filter((r) => keep.has(r.d));
  const mid = dates[Math.floor(dates.length / 2)] || null;
  const keys = new Set();
  for (const r of recent) for (const k of Object.keys(r.ic)) if (isInputKey(k)) keys.add(k);
  const out = {};
  for (const k of [...keys].sort()) {
    const list = recent.filter((r) => r.ic[k] != null);
    const days = new Set(list.map((r) => r.d)).size;
    const avg = mean(list.map((r) => r.ic[k]));
    const h1 = mean(list.filter((r) => r.d < mid).map((r) => r.ic[k]));
    const h2 = mean(list.filter((r) => r.d >= mid).map((r) => r.ic[k]));
    let proven = null;
    if (days >= INPUT_MIN_SESSIONS && avg != null && h1 != null && h2 != null) {
      if (avg >= INPUT_IC_BAR && h1 > 0 && h2 > 0) proven = "up";
      else if (avg <= -INPUT_IC_BAR && h1 < 0 && h2 < 0) proven = "down";
    }
    out[k] = { days, avg: r3(avg), h1: r3(h1), h2: r3(h2), proven };
  }
  return out;
}

// One week's step for every weight. pins: approved settings (they win);
// held: inputs held after an undo (left where they are).
export function proposeWeights(current, evidence, { pins = {}, held = new Set() } = {}) {
  const next = {};
  const changes = [];
  const keys = new Set([...Object.keys(current || {}), ...Object.keys(evidence || {}), ...Object.keys(pins || {})].filter(isInputKey));
  for (const k of [...keys].sort()) {
    const w = num(current?.[k]) ?? 1;
    const e = evidence?.[k] || null;
    let to = w, why = null;
    if (pins[k] != null && !held.has(k)) { to = pins[k]; why = "approved by the Owner"; }
    else if (held.has(k)) { to = w; }
    else if (e?.proven === "down") { to = 0; why = `pointed the wrong way in both halves of the last ${e.days} sessions (rank correlation ${e.avg})`; }
    else if (w === 0) {
      if (e && e.days >= INPUT_MIN_SESSIONS && e.h1 != null && e.h2 != null && e.h1 >= 0 && e.h2 >= 0) { to = W_MIN; why = "neither half points the wrong way any more: back at 0.5"; }
    } else {
      const target = e?.proven === "up" ? clamp(1 + 5 * e.avg * (e.days / (e.days + SHRINK_SESSIONS)), 1, W_MAX) : 1;
      to = r2(clamp(w + clamp(target - w, -W_STEP, W_STEP), W_MIN, W_MAX));
      if (to !== w) why = e?.proven === "up"
        ? `lined up with the move in both halves of the last ${e.days} sessions (rank correlation ${e.avg}); heading for ${r2(target)}`
        : "no longer proven: easing back toward 1";
    }
    if (to !== 1) next[k] = to;
    if (to !== w) changes.push({ key: k, from: w, to, why });
  }
  return { weights: next, changes };
}

// ---- K2 / K4 ---------------------------------------------------------------------------------

// The base rules replayed from the untuned totals: what the run let through
// or held under the bar, plus what the loop's own gate stopped.
const baseTakes = (bar) => (r) => {
  const t0 = num(r.tot0 ?? r.tot);
  if (t0 == null || Math.abs(t0) < bar) return false;
  if (r.cls === "pick" || r.cls === "below-bar") return true;
  return r.cls === "gate" && /^gate:loop-/.test(String(r.out || ""));
};

export function undoRead(rows, version, { bar = 4 } = {}) {
  if (!version?.liveAt) return null;
  const since = version.liveAt;
  const tuned = bookTrades(rows, (r) => r.cls === "pick", { since }).filter((t) => t.net != null);
  if (tuned.length < UNDO_TRADES) return { status: "watching", trades: tuned.length, need: UNDO_TRADES };
  const first = tuned.slice(0, UNDO_TRADES);
  const until = first[first.length - 1].d;
  const base = bookTrades((rows || []).filter((r) => r.d <= until), baseTakes(bar), { since }).filter((t) => t.net != null);
  const a = mean(first.map((t) => t.net)), b = mean(base.map((t) => t.net));
  const gap = a != null && b != null ? a - b : null;
  return { status: gap != null && gap < UNDO_GAP ? "undo" : "kept", trades: first.length, baseTrades: base.length, avg: r1(a), baseAvg: r1(b), gap: r1(gap) };
}

// Decided Track Record trades (counted wins and losses with an option P&L),
// oldest exit first.
export function freezeRead(closed, { since = null } = {}) {
  const list = (closed || [])
    .filter((c) => c && (c.outcome === "win" || c.outcome === "loss") && c.counted !== false && num(c.optionPnlPct) != null)
    .filter((c) => !since || String(c.exitDate || "").slice(0, 10) >= since)
    .sort((a, b) => String(a.exitDate || "").localeCompare(String(b.exitDate || "")));
  let streak = 0;
  for (let i = list.length - 1; i >= 0 && list[i].outcome === "loss"; i--) streak++;
  const last = list.slice(-FREEZE_WINDOW).map((c) => num(c.optionPnlPct));
  const avg = last.length >= FREEZE_WINDOW ? mean(last) : null;
  const hit = streak >= FREEZE_STREAK ? `${streak} losses in a row` : avg != null && avg < FREEZE_AVG ? `the last ${FREEZE_WINDOW} record trades averaged ${r1(avg)}%` : null;
  return { trades: list.length, streak, avg20: r1(avg), hit };
}

// ---- Owner actions (A2) ----------------------------------------------------------------------

const TARGET_RE = /^(?:ev-gate|(?:mute|up):(?:P:(?:f|t|m|n|iv|rg)|[A-Za-z][A-Za-z0-9_]{0,31})|bar:\d(?:\.\d{1,2})?)$/;
export const isTarget = (t) => typeof t === "string" && TARGET_RE.test(t) && (!t.startsWith("bar:") || (Number(t.slice(4)) >= BAR_MIN && Number(t.slice(4)) <= BAR_MAX));
const ACTS = new Set(["approve", "decline", "undo", "restore"]);

export function emptyLoopControl() {
  return { v: 1, seq: 0, actions: [], updatedAt: null };
}
function validAction(a) {
  if (!a || typeof a !== "object" || !ACTS.has(a.act) || !Number.isInteger(a.seq) || a.seq < 1) return false;
  if ((a.act === "approve" || a.act === "decline") && !isTarget(a.target)) return false;
  if (a.act === "restore" && !(Number.isInteger(a.version) && a.version >= 0 && a.version < 100000)) return false;
  return true;
}
export function readLoopControlDoc(raw) {
  let doc = raw;
  if (typeof raw === "string" || raw instanceof Uint8Array) {
    try { doc = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8")); } catch { doc = null; }
  }
  const out = emptyLoopControl();
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return out;
  out.actions = (Array.isArray(doc.actions) ? doc.actions : []).filter(validAction).slice(-ACTIONS_KEEP).map((a) => ({
    seq: a.seq, at: typeof a.at === "string" ? a.at.slice(0, 40) : null, act: a.act,
    ...(a.target != null ? { target: a.target } : {}), ...(a.act === "restore" ? { version: a.version } : {}),
    by: typeof a.by === "string" ? a.by.slice(0, 40) : null,
  }));
  out.seq = Math.max(Number.isInteger(doc.seq) ? doc.seq : 0, ...out.actions.map((a) => a.seq), 0);
  out.updatedAt = typeof doc.updatedAt === "string" ? doc.updatedAt : null;
  return out;
}
// The request-time write (api/auth/[action].js "picks-loop"): validate first,
// then append one action. The bake applies actions newer than the last one it
// saw, so a click lands at the next build.
export function applyLoopControlRequest(doc, body, { at = new Date().toISOString(), by = null } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const act = typeof b.act === "string" ? b.act : "";
  if (!ACTS.has(act)) return { error: "bad action" };
  const entry = { act };
  if (act === "approve" || act === "decline") {
    if (!isTarget(b.target)) return { error: "bad target" };
    entry.target = b.target;
  }
  if (act === "restore") {
    const v = Number(b.version);
    if (!Number.isInteger(v) || v < 0 || v >= 100000) return { error: "bad version" };
    entry.version = v;
  }
  if (!doc) return { ok: true };
  const cur = readLoopControlDoc(doc);
  const seq = cur.seq + 1;
  const next = { v: 1, seq, actions: cur.actions.concat([{ seq, at, act, ...entry, by: typeof by === "string" ? by.slice(0, 40) : null }]).slice(-ACTIONS_KEEP), updatedAt: at };
  return { doc: next };
}

// ---- the tuning state ------------------------------------------------------------------------

// A version's weight moves, kept for the Loop tab: [{ key, from, to }].
function cleanChanges(list) {
  return (Array.isArray(list) ? list : []).filter((c) => c && INPUT_RE.test(String(c.key)) && num(c.from) != null && num(c.to) != null).slice(0, 40).map((c) => ({ key: String(c.key), from: num(c.from), to: num(c.to) }));
}

const BASE_VERSION = () => ({ n: 0, d: null, why: "base settings", by: "base", settings: cleanSettings(null), prev: null, liveAt: null, check: null });

export function emptyTune() {
  return { v: TUNE_VERSION, versions: [BASE_VERSION()], current: 0, liveSince: null, frozen: null, held: {}, approvals: {}, lastSeq: 0, shadow: null, log: [] };
}

export function parseTune(raw) {
  const out = emptyTune();
  if (!raw || typeof raw !== "object") return out;
  const versions = (Array.isArray(raw.versions) ? raw.versions : [])
    .filter((v) => v && Number.isInteger(v.n) && v.n >= 0)
    .map((v) => ({ n: v.n, d: typeof v.d === "string" ? v.d : null, why: typeof v.why === "string" ? v.why : "", by: typeof v.by === "string" ? v.by : null, settings: cleanSettings(v.settings), prev: Number.isInteger(v.prev) ? v.prev : null, liveAt: typeof v.liveAt === "string" ? v.liveAt : null, check: v.check && typeof v.check === "object" ? v.check : null, checked: v.checked === true, ...(cleanChanges(v.changes).length ? { changes: cleanChanges(v.changes) } : {}) }));
  if (!versions.some((v) => v.n === 0)) versions.unshift(BASE_VERSION());
  out.versions = versions.sort((a, b) => a.n - b.n);
  out.current = out.versions.some((v) => v.n === raw.current) ? raw.current : 0;
  out.liveSince = typeof raw.liveSince === "string" ? raw.liveSince : null;
  out.frozen = raw.frozen && typeof raw.frozen === "object" && typeof raw.frozen.since === "string" ? { since: raw.frozen.since, why: String(raw.frozen.why || "") } : null;
  out.held = {};
  for (const [k, d] of Object.entries(raw.held && typeof raw.held === "object" ? raw.held : {})) if (typeof d === "string") out.held[k] = d;
  out.approvals = {};
  for (const [k, a] of Object.entries(raw.approvals && typeof raw.approvals === "object" ? raw.approvals : {})) {
    if (isTarget(k) && a && (a.state === "approved" || a.state === "declined") && typeof a.d === "string") out.approvals[k] = { state: a.state, d: a.d, by: typeof a.by === "string" ? a.by : null };
  }
  out.lastSeq = Number.isInteger(raw.lastSeq) ? raw.lastSeq : 0;
  out.shadow = raw.shadow && typeof raw.shadow === "object" ? { d: raw.shadow.d || null, settings: cleanSettings(raw.shadow.settings), changes: Array.isArray(raw.shadow.changes) ? raw.shadow.changes.slice(0, 40) : [] } : null;
  out.log = Array.isArray(raw.log) ? raw.log.filter((x) => x && typeof x.msg === "string").slice(-LOG_KEEP) : [];
  return out;
}

// Sessions from `from` to `to` on the ledger's run dates (calendar weekdays
// when a date is older than the ledger).
function sessionsBetween(dates, from, to) {
  if (!from || !to) return Infinity;
  const inLedger = dates.filter((d) => d > from && d <= to).length;
  if (dates.length && from >= dates[0]) return inLedger;
  const ms = Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`);
  return Number.isFinite(ms) ? Math.round((ms / 86400000) * 5 / 7) : Infinity;
}

// Items waiting on the Owner (A2): the EV gate once the count model is past
// its learning bar, and every challenger that passed step 3's check and that
// step 4 can apply (mute, lean, trade bar).
export function waitingItems(tune, { challengers = null, modelRows = 0, dates = [], today = null } = {}) {
  const out = [];
  const open = (id) => {
    const a = tune.approvals[id];
    if (!a) return true;
    return a.state === "declined" && sessionsBetween(dates, a.d, today) >= HOLD_SESSIONS;
  };
  if (modelRows >= MIN_ROWS_FOR_ESTIMATE && open("ev-gate")) {
    out.push({ id: "ev-gate", label: "Expected-value gate", why: `the count model is past its ${MIN_ROWS_FOR_ESTIMATE}-row learning bar`, setting: "only names whose stated option value after costs is zero or better can open" });
  }
  for (const r of challengers?.ready || []) {
    if (!r?.live) continue;
    const id = r.kind === "ev-gate" ? "ev-gate" : r.id;
    if (!isTarget(id) || out.some((x) => x.id === id) || !open(id)) continue;
    out.push({ id, label: r.label, why: `passed the challenger check (${r.diff != null ? `${r.diff > 0 ? "+" : ""}${r.diff} points a trade over the replica` : "every check"})`, setting: r.setting || null });
  }
  return out;
}

// Every full bake, after step 3. Applies the Owner's new actions, checks the
// freeze and the current version's undo test, and (on the weekly-report
// build) takes one step on the weights. In shadow the steps build a shadow
// path that never applies. Returns the view block.
export function stepTune(tune, { mode = "shadow", today = null, rows = [], challengers = null, modelRows = 0, closed = null, control = null, weekly = false, bar = 4 } = {}) {
  if (!tune || !today) return null;
  const dates = [...new Set((rows || []).map((r) => r.d))].sort();
  const log = (msg) => { tune.log.push({ d: today, msg }); tune.log = tune.log.slice(-LOG_KEEP); };
  const live = mode === "on" && today >= LIVE_FLOOR;
  const byN = (n) => tune.versions.find((v) => v.n === n) || null;
  const newVersion = (settings, why, by, changes = null) => {
    const n = Math.max(...tune.versions.map((v) => v.n)) + 1;
    const ch = cleanChanges(changes);
    tune.versions.push({ n, d: today, why, by, settings: cleanSettings(settings), prev: tune.current, liveAt: null, check: null, checked: false, ...(ch.length ? { changes: ch } : {}) });
    tune.current = n;
    if (tune.versions.length > VERSIONS_KEEP) tune.versions = [tune.versions[0], ...tune.versions.slice(-(VERSIONS_KEEP - 1))];
    log(`v${n} (${by}): ${why}`);
    return n;
  };
  const revert = (cur, by) => {
    const prev = byN(cur.prev ?? 0) || byN(0);
    for (const id of changedIds(prev.settings, cur.settings)) tune.held[id] = today;
    // An approval the undone version carried goes back to declined.
    for (const [id, a] of Object.entries(tune.approvals)) {
      if (a.state !== "approved") continue;
      const touched = id === "ev-gate" ? changedIds(prev.settings, cur.settings).includes("ev-gate")
        : id.startsWith("bar:") ? changedIds(prev.settings, cur.settings).includes("bar")
        : changedIds(prev.settings, cur.settings).includes(`w:${id.split(":").slice(1).join(":")}`);
      if (touched) tune.approvals[id] = { state: "declined", d: today, by };
    }
    newVersion(prev.settings, `${by === "auto-undo" ? "auto-undo" : "undo"} of v${cur.n}, back to v${prev.n}'s settings`, by);
  };

  // 1. The Owner's new actions.
  let undo = false, restore = null;
  for (const a of readLoopControlDoc(control).actions) {
    if (!(a.seq > tune.lastSeq)) continue;
    tune.lastSeq = a.seq;
    if (a.act === "approve" || a.act === "decline") {
      tune.approvals[a.target] = { state: a.act === "approve" ? "approved" : "declined", d: today, by: a.by || null };
      log(`${a.act === "approve" ? "approved" : "declined"} ${a.target}${a.by ? ` by ${a.by}` : ""}`);
    } else if (a.act === "undo") undo = true;
    else if (a.act === "restore") restore = a.version;
  }

  // 2. K4: the freeze reads the record since tuning went live.
  if (live && !tune.liveSince) tune.liveSince = today;
  const fr = freezeRead(closed, { since: tune.liveSince });
  if (tune.liveSince && fr.hit && !tune.frozen) { tune.frozen = { since: today, why: fr.hit }; log(`frozen: ${fr.hit}; no new self-changes until it clears`); }
  else if (tune.frozen && !fr.hit) { log(`freeze lifted (set ${tune.frozen.since}: ${tune.frozen.why})`); tune.frozen = null; }

  // 3. K2: the current version's undo test, once its first 15 trades decide.
  let cur = byN(tune.current) || byN(0);
  if (cur.n > 0 && cur.liveAt && !cur.checked && !isBaseSettings(cur.settings)) {
    const u = undoRead(rows, cur, { bar });
    cur.check = u;
    if (u?.status === "undo") revert(cur, "auto-undo");
    else if (u?.status === "kept") cur.checked = true;
  }
  cur = byN(tune.current) || byN(0);

  // 4. The Owner's undo and restore (they change the stored settings; they
  // apply at the next run only while self-tuning is live).
  if (undo && cur.n > 0) { revert(cur, "owner"); cur = byN(tune.current); }
  if (restore != null) {
    const v = byN(restore);
    if (v && v.n !== cur.n) {
      // The approvals follow the restored settings, so the next step keeps them.
      const rs = cleanSettings(v.settings);
      for (const [id, a] of Object.entries(tune.approvals)) {
        if (a.state !== "approved") continue;
        const keep = id === "ev-gate" ? rs.evGate
          : id.startsWith("bar:") ? rs.bar === Number(id.slice(4))
          : (rs.weights[id.split(":").slice(1).join(":")] ?? 1) === (id.startsWith("mute:") ? 0 : W_MAX);
        if (!keep) tune.approvals[id] = { state: "declined", d: today, by: "restore" };
      }
      if (rs.evGate) tune.approvals["ev-gate"] = { state: "approved", d: today, by: "restore" };
      if (rs.bar != null) tune.approvals[`bar:${rs.bar}`] = { state: "approved", d: today, by: "restore" };
      // A restore is the Owner's explicit choice: it lifts the hold on what it brings back.
      for (const id of changedIds(cur.settings, v.settings)) delete tune.held[id];
      newVersion(v.settings, `restored v${v.n}'s settings`, "owner");
      cur = byN(tune.current);
    } else if (!v) log(`restore of v${restore} skipped: that version is no longer kept`);
  }

  // 5. Approved items become pins; held items stay where they are.
  const held = new Set();
  for (const [id, d] of Object.entries(tune.held)) {
    if (sessionsBetween(dates, d, today) >= HOLD_SESSIONS) { delete tune.held[id]; continue; }
    if (id.startsWith("w:")) held.add(id.slice(2));
  }
  const pins = {};
  let evGate = false, barSet = null;
  const approved = Object.entries(tune.approvals).filter(([, a]) => a.state === "approved").sort((a, b) => a[1].d.localeCompare(b[1].d));
  for (const [id] of approved) {
    if (id === "ev-gate") { if (!tune.held["ev-gate"]) evGate = true; }
    else if (id.startsWith("bar:")) { if (!tune.held.bar) barSet = Number(id.slice(4)); }
    else if (id.startsWith("mute:")) pins[id.slice(5)] = 0;
    else if (id.startsWith("up:")) pins[id.slice(3)] = W_MAX;
  }

  // 6. The week's step (S3/S4). Live: on the current version, applied from
  // the next run (a freeze skips the self-made part; the Owner's approvals
  // still land). Otherwise a shadow path that never applies; going live
  // starts again from the base settings.
  const evidence = weekly ? inputEvidence(rows) : null;
  const stepFrom = (start) => {
    const b = cleanSettings(start);
    let weights = { ...b.weights }, changes = [];
    if (weekly && !tune.frozen) ({ weights, changes } = proposeWeights(b.weights, evidence, { pins, held }));
    else for (const [k, w] of Object.entries(pins)) if (!held.has(k)) weights[k] = w;
    return { next: cleanSettings({ weights, evGate, bar: barSet }), changes };
  };
  if (live) {
    const { next, changes } = stepFrom(cur.settings);
    if (!sameSettings(next, cur.settings)) {
      const why = changes.length ? changes.map((c) => `${c.key} ${c.from} -> ${c.to}`).join(", ") : settingsSummary(next);
      newVersion(next, why, changes.length ? "loop" : "owner", changes);
    }
  } else if (mode !== "off") {
    const { next, changes } = stepFrom(tune.shadow?.settings);
    if (weekly || !tune.shadow || !sameSettings(next, tune.shadow.settings)) tune.shadow = { d: today, settings: next, changes: weekly ? changes : tune.shadow?.changes || [] };
  }
  cur = byN(tune.current) || byN(0);

  const waiting = waitingItems(tune, { challengers, modelRows, dates, today });
  return {
    v: TUNE_VERSION,
    mode, live, floor: LIVE_FLOOR, frozen: tune.frozen, liveSince: tune.liveSince,
    current: { n: cur.n, d: cur.d, why: cur.why, by: cur.by, settings: cur.settings, summary: settingsSummary(cur.settings), liveAt: cur.liveAt, check: cur.check },
    shadow: tune.shadow ? { ...tune.shadow, summary: settingsSummary(tune.shadow.settings) } : null,
    evidence: evidence ? Object.entries(evidence).filter(([, e]) => e.proven).map(([key, e]) => ({ key, ...e })) : null,
    waiting,
    approvals: Object.entries(tune.approvals).map(([id, a]) => ({ id, ...a })).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 20),
    versions: tune.versions.slice(-12).reverse().map((v) => ({ n: v.n, d: v.d, why: v.why, by: v.by, summary: settingsSummary(v.settings), changes: v.changes || null, liveAt: v.liveAt, check: v.check, current: v.n === tune.current })),
    held: Object.entries(tune.held).map(([id, d]) => ({ id, d })),
    freeze: fr,
    log: tune.log.slice(-20).reverse(),
    limits: { wMin: W_MIN, wMax: W_MAX, wStep: W_STEP, maxDelta: MAX_DELTA, inputSessions: INPUT_MIN_SESSIONS, inputIc: INPUT_IC_BAR, undoTrades: UNDO_TRADES, undoGap: UNDO_GAP, freezeStreak: FREEZE_STREAK, freezeAvg: FREEZE_AVG, barMin: BAR_MIN, barMax: BAR_MAX, holdSessions: HOLD_SESSIONS },
  };
}

// The run hook marks the first run a version is used live.
export function markVersionLive(tune, version, date) {
  if (!tune || !Number.isInteger(version) || !date) return;
  const v = tune.versions.find((x) => x.n === version);
  if (v && v.n > 0 && !v.liveAt) v.liveAt = date;
  if (!tune.liveSince) tune.liveSince = date;
}
