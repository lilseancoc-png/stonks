// Owner controls (2026-11-19, owner request, engine roadmap thread 4): one
// "Stop new trades" switch and five quick controls the Owner sets from the
// site, plus the account limits read from Owner Settings.
//
//   Stop new trades   no new Top Picks record trades, no new engine trades and
//                     no new Webull paper opens. Exits keep running.
//   Avoid             no new entries on a stock in any engine or Top Picks
//                     until lifted (optional end date). Optionally closes the
//                     open trades on it at the next decision run ("owner-avoid").
//   Watch closely     the stock goes to the front of each engine's queue for
//                     the next 5 sessions. No bar is lowered.
//   Flag a catalyst   one line in a catalyst log, shown on the pages until its
//                     date. Display only: it changes no trade.
//   Risk dial         Safer / Normal / Riskier until Friday's close. Safer:
//                     half size, engine entry bar +5, one new trade a run
//                     (engines and Top Picks). Riskier: 1.5x size inside the
//                     account limits, engine entry bar -3. Not tied to fear.
//   Check this stock  read-only, nothing is saved (the page reads the engines'
//                     last run and a live quote).
//
// Every change is logged with who and when and can be undone; every control
// but Avoid ends on its own. Trades a control touches carry `ownerControls`
// (dial, watch, catalyst) so the scorecard can split the record by setting.
//
// Stored in owner-controls.json: Owner-only, request-time-owned (written only
// by api/auth/[action].js "owner-controls", never by a workflow). The bake
// reads its hydrated copy before the wipe, like top-picks-mode.json; the
// Webull mirror reads the store copy on every run.
//
// Account limits are Owner Settings numbers (lib/owner-settings.mjs, tab
// "Account limits"), all 0 = off until the Owner sets them. They are enforced
// in the strategy engines and the Webull paper mirror; Top Picks keeps its
// own book cap.
//
// Pure. No network, no AI.

import { etClock, sessionForDate } from "./us-equity-calendar.mjs";
import { neverTradeView } from "./never-trade.mjs";

export const OWNER_CONTROLS_KEY = "owner-controls.json";
export const OWNER_CONTROLS_VERSION = 1;
export const OWNER_CONTROLS_LOG = 40;
export const OWNER_CONTROLS_PAST = 120;
export const WATCH_SESSIONS = 5;
const MAX_ITEMS = 40;
const SYM_RE = /^[A-Z][A-Z0-9.\-^=]{0,9}$/;

export const DIAL = Object.freeze({
  safer: Object.freeze({ level: "safer", label: "Safer", sizeMult: 0.5, barDelta: 5, perRun: 1, help: "Half size, engine entry bar +5, one new trade a run." }),
  normal: Object.freeze({ level: "normal", label: "Normal", sizeMult: 1, barDelta: 0, perRun: null, help: "Today's rules." }),
  riskier: Object.freeze({ level: "riskier", label: "Riskier", sizeMult: 1.5, barDelta: -3, perRun: null, help: "1.5x size inside the account limits, engine entry bar -3." }),
});

// The Owner Settings keys behind the account limits (0 = off).
export const LIMIT_KEYS = Object.freeze({
  openUsd: "ACCOUNT_LIMIT_OPEN_USD",
  dayLossUsd: "ACCOUNT_LIMIT_DAY_LOSS_USD",
  nameUsd: "ACCOUNT_LIMIT_NAME_USD",
  newPerDay: "ACCOUNT_LIMIT_NEW_PER_DAY",
  sharesUsd: "ACCOUNT_LIMIT_SHARES_USD",
});
export const LIMIT_LABEL = Object.freeze({
  openUsd: "open option premium cap",
  dayLossUsd: "daily loss stop",
  nameUsd: "per-name cap",
  newPerDay: "new trades a day",
  sharesUsd: "open engine stock cap",
});
// The cap on open engine stock (2026-11-23, owner: "a 1m total position at
// any point. But can't exceed that"): on at $1,000,000 unless set; 0 = off.
export const SHARES_LIMIT_DEFAULT_USD = 1000000;

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const dateOk = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T12:00:00Z"));
const isoOk = (d) => typeof d === "string" && !Number.isNaN(Date.parse(d));
export const cleanSymbol = (s) => { const v = String(s ?? "").trim().toUpperCase(); return SYM_RE.test(v) ? v : null; };

// --- Dates (ET) ---------------------------------------------------------------
// The UTC instant of an ET wall-clock minute on an ET date.
export function etToIso(date, minute) {
  for (const off of [4, 5]) {
    const ms = Date.parse(`${date}T00:00:00Z`) + (minute + off * 60) * 60000;
    const c = etClock(ms);
    if (c.date === date && c.minute === minute) return new Date(ms).toISOString();
  }
  return new Date(Date.parse(`${date}T00:00:00Z`) + (minute + 5 * 60) * 60000).toISOString();
}
// "Fri Nov 20, 4:00 PM ET" for the change log.
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (date) => { const d = new Date(date + "T12:00:00Z"); return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
function etText(iso) {
  const c = etClock(Date.parse(iso)), h = Math.floor(c.minute / 60), m = c.minute % 60;
  return `${dayText(c.date)}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} ET`;
}
const addDays = (date, n) => new Date(Date.parse(date + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
// True when the date is a trading day (the exchange calendar where it covers
// the year, else any weekday).
function tradingDay(date) {
  const s = sessionForDate(date);
  if (s) return s.open;
  const d = new Date(date + "T12:00:00Z").getUTCDay();
  return d !== 0 && d !== 6;
}
// The last day of a Watch: the WATCH_SESSIONS-th session counting the current
// one (today while the market has not closed yet, else the next session).
export function watchUntil(nowMs, sessions = WATCH_SESSIONS) {
  const c = etClock(nowMs);
  let d = c.date;
  const s = sessionForDate(d);
  if (!tradingDay(d) || c.minute >= (s?.closeMinute ?? 960)) { d = addDays(d, 1); while (!tradingDay(d)) d = addDays(d, 1); }
  for (let n = 1; n < sessions; n++) { d = addDays(d, 1); while (!tradingDay(d)) d = addDays(d, 1); }
  return d;
}
// Friday's close for the risk dial: this week's last session on or before
// Friday, at its close (13:00 on a half day). After that close, next week's.
export function dialUntil(nowMs) {
  const c = etClock(nowMs);
  for (let week = 0; week < 3; week++) {
    const dow = new Date(c.date + "T12:00:00Z").getUTCDay();
    let fri = addDays(c.date, ((5 - dow + 7) % 7) + week * 7);
    for (let k = 0; k < 5 && !tradingDay(fri); k++) fri = addDays(fri, -1);
    const close = sessionForDate(fri)?.closeMinute ?? 960;
    const iso = etToIso(fri, close);
    if (Date.parse(iso) > nowMs) return iso;
  }
  return etToIso(addDays(c.date, 7), 960);
}

// --- The stored record ----------------------------------------------------------
export function emptyControls() {
  return { version: OWNER_CONTROLS_VERSION, seq: 0, updatedAt: null, by: null, stop: null, avoid: [], watch: [], catalysts: [], dial: null, past: [], log: [] };
}
const by64 = (v) => (typeof v === "string" && v ? v.slice(0, 64) : null);
const px = (v) => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) && n > 0 && n < 1e6 ? Math.round(n * 100) / 100 : null; };
function cleanStop(s) { return s && typeof s === "object" && isoOk(s.at) ? { at: s.at, by: by64(s.by), note: str(s.note, 140) || null } : null; }
function cleanAvoid(a) {
  const sym = cleanSymbol(a?.sym);
  if (!sym || !isoOk(a.at)) return null;
  return { id: Number(a.id) || 0, sym, at: a.at, by: by64(a.by), close: a.close === true, until: dateOk(a.until) ? a.until : null, px: px(a.px), note: str(a.note, 140) || null };
}
function cleanWatch(w) {
  const sym = cleanSymbol(w?.sym);
  if (!sym || !isoOk(w.at) || !dateOk(w.until)) return null;
  return { id: Number(w.id) || 0, sym, at: w.at, by: by64(w.by), until: w.until };
}
function cleanCatalyst(k) {
  const text = str(k?.text, 140);
  if (!text || !dateOk(k.date) || !isoOk(k.at)) return null;
  const sym = k.sym == null || k.sym === "" ? null : cleanSymbol(k.sym);
  if (k.sym && !sym) return null;
  return { id: Number(k.id) || 0, sym, text, date: k.date, at: k.at, by: by64(k.by) };
}
function cleanDial(d) {
  if (!d || typeof d !== "object" || !DIAL[d.level] || d.level === "normal" || !isoOk(d.at) || !isoOk(d.until)) return null;
  return { level: d.level, at: d.at, by: by64(d.by), until: d.until };
}
function cleanPast(p) {
  if (!p || typeof p !== "object" || !["avoid", "watch", "dial", "stop", "catalyst"].includes(p.kind) || !isoOk(p.at)) return null;
  return { kind: p.kind, id: Number(p.id) || 0, sym: cleanSymbol(p.sym), level: DIAL[p.level] ? p.level : undefined, at: p.at, ended: isoOk(p.ended) ? p.ended : null, how: ["lifted", "expired", "replaced"].includes(p.how) ? p.how : null, px: px(p.px), pxEnd: px(p.pxEnd), logId: Number(p.logId) || 0 };
}
const state = (d) => ({ stop: d.stop, avoid: d.avoid, watch: d.watch, catalysts: d.catalysts, dial: d.dial });
function cleanLog(l) {
  if (!l || typeof l !== "object" || !isoOk(l.at)) return null;
  const prev = l.prev && typeof l.prev === "object" ? {
    stop: cleanStop(l.prev.stop),
    avoid: (Array.isArray(l.prev.avoid) ? l.prev.avoid : []).map(cleanAvoid).filter(Boolean),
    watch: (Array.isArray(l.prev.watch) ? l.prev.watch : []).map(cleanWatch).filter(Boolean),
    catalysts: (Array.isArray(l.prev.catalysts) ? l.prev.catalysts : []).map(cleanCatalyst).filter(Boolean),
    dial: cleanDial(l.prev.dial),
  } : null;
  return { id: Number(l.id) || 0, at: l.at, by: by64(l.by), act: str(l.act, 24), text: str(l.text, 200), ...(prev ? { prev } : {}), ...(l.undone ? { undone: true } : {}), ...(Number(l.of) ? { of: Number(l.of) } : {}) };
}
// Read the stored record. Missing, unreadable or unknown parts read as "no
// control", so a bad file can never stop or resize a trade.
export function readOwnerControlsDoc(raw) {
  let doc = null;
  try {
    if (raw == null) doc = null;
    else if (typeof raw === "string") doc = JSON.parse(raw);
    else if (raw instanceof Uint8Array) doc = JSON.parse(Buffer.from(raw).toString("utf8"));
    else doc = raw;
  } catch { doc = null; }
  if (!doc || typeof doc !== "object") return emptyControls();
  const list = (v, f) => (Array.isArray(v) ? v : []).map(f).filter(Boolean).slice(0, MAX_ITEMS);
  const log = (Array.isArray(doc.log) ? doc.log : []).map(cleanLog).filter(Boolean).slice(0, OWNER_CONTROLS_LOG);
  return {
    version: OWNER_CONTROLS_VERSION,
    seq: Number.isFinite(Number(doc.seq)) ? Number(doc.seq) : log.reduce((m, l) => Math.max(m, l.id), 0),
    updatedAt: isoOk(doc.updatedAt) ? doc.updatedAt : null,
    by: by64(doc.by),
    stop: cleanStop(doc.stop),
    avoid: list(doc.avoid, cleanAvoid),
    watch: list(doc.watch, cleanWatch),
    catalysts: list(doc.catalysts, cleanCatalyst),
    dial: cleanDial(doc.dial),
    past: (Array.isArray(doc.past) ? doc.past : []).map(cleanPast).filter(Boolean).slice(0, OWNER_CONTROLS_PAST),
    log,
  };
}

// --- What is in force now ------------------------------------------------------
// The controls in force at `nowMs`, ready for the engines, Top Picks and the
// mirror. Expired items are simply not in force (the stored record keeps them
// until the next save moves them to `past`).
export function activeControls(doc, nowMs = Date.now()) {
  const d = doc && typeof doc === "object" && Array.isArray(doc.avoid) ? doc : readOwnerControlsDoc(doc);
  const today = etClock(nowMs).date;
  const avoid = new Map(), watch = new Set(), catalysts = [];
  for (const a of d.avoid) if (!a.until || today <= a.until) avoid.set(a.sym, { close: a.close, at: a.at, until: a.until });
  for (const w of d.watch) if (today <= w.until) watch.add(w.sym);
  for (const k of d.catalysts) if (today <= k.date) catalysts.push(k);
  const dialOn = d.dial && Date.parse(d.dial.until) > nowMs ? d.dial : null;
  const dial = dialOn ? { ...DIAL[dialOn.level], at: dialOn.at, until: dialOn.until } : null;
  return {
    stop: !!d.stop, stopAt: d.stop?.at || null, stopBy: d.stop?.by || null,
    avoid, watch, catalysts, catalystSyms: new Set(catalysts.filter((k) => k.sym).map((k) => k.sym)),
    dial,
    any: !!d.stop || avoid.size > 0 || watch.size > 0 || catalysts.length > 0 || !!dial,
  };
}
// The compact, JSON-safe summary a run stamps on its payload (picks.json
// rosterMeta, the engines run log): what was in force.
export function controlsSummary(active) {
  if (!active) return null;
  return {
    stop: !!active.stop,
    avoid: [...active.avoid.keys()].sort(),
    close: [...active.avoid.entries()].filter(([, v]) => v.close).map(([k]) => k).sort(),
    watch: [...active.watch].sort(),
    catalysts: [...active.catalystSyms].sort(),
    dial: active.dial ? active.dial.level : "normal",
  };
}
// The stamp a new trade on `sym` carries, or null when no control touches it.
export function tradeStamp(active, sym, { dial = true } = {}) {
  if (!active) return null;
  const s = {};
  if (dial && active.dial && active.dial.level !== "normal") s.dial = active.dial.level;
  if (active.watch.has(sym)) s.watch = true;
  if (active.catalystSyms.has(sym)) s.catalyst = true;
  return Object.keys(s).length ? s : null;
}
// True when an open trade should close because the Owner put its stock on
// Avoid with "close open trades", set after the trade opened.
export function avoidCloses(active, sym, entryIso) {
  const a = active?.avoid?.get(sym);
  if (!a || !a.close) return false;
  const e = Date.parse(entryIso), at = Date.parse(a.at);
  return Number.isFinite(e) && Number.isFinite(at) && e < at;
}
// Contracts or shares after the dial's size step. Options keep at least one
// contract; a Riskier step never goes past the engines' contract cap
// (`maxQty`: Owner Settings ENGINES_MAX_QTY, 200 unless set; 25 until
// 2026-11-23, 10 until 2026-11-20) unless the trade already had more. The
// caller passes the side's contract cap already held under its premium cap.
export const DIAL_MAX_QTY = 200;
// `maxShares` (2026-11-23): the most shares a scale-up may reach (the
// engines' share cap at the entry price), never below what it was; none = no cap.
export function scaleContract(contract, mult, maxQty = DIAL_MAX_QTY, maxShares = null) {
  if (!contract || contract.skip || !fin(mult) || mult === 1) return contract;
  if (contract.structure === "shares") {
    const was = Number(contract.shares) || 1;
    let shares = Math.max(1, Math.floor(was * mult));
    if (mult > 1 && Number.isInteger(maxShares) && maxShares >= 1) shares = Math.min(shares, Math.max(was, maxShares));
    return { ...contract, shares, usd: Math.round(shares * (Number(contract.mid) || 0)) };
  }
  const q = Number.isInteger(contract.qty) && contract.qty > 0 ? contract.qty : 1;
  let qty = Math.max(1, Math.round(q * mult));
  const cap = Number.isInteger(maxQty) && maxQty >= 1 ? maxQty : DIAL_MAX_QTY;
  if (mult > 1) qty = Math.min(qty, Math.max(q, cap));
  return { ...contract, qty };
}

// --- Account limits ---------------------------------------------------------------
// From the environment (the bake, through the Owner Settings preload) or any
// object of KEY -> value. 0, blank or a bad value = off, except the open
// engine stock cap: blank or a bad value = its $1,000,000 default (the
// Owner Settings file drops a value equal to its default), 0 = off.
export function accountLimits(env = process.env) {
  const pos = (v) => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null; };
  const sharesRaw = env?.ACCOUNT_LIMIT_SHARES_USD;
  const sharesSet = sharesRaw != null && String(sharesRaw).trim() !== "" && Number.isFinite(Number(sharesRaw)) && Number(sharesRaw) >= 0;
  const out = {
    openUsd: pos(env?.ACCOUNT_LIMIT_OPEN_USD),
    dayLossUsd: pos(env?.ACCOUNT_LIMIT_DAY_LOSS_USD),
    nameUsd: pos(env?.ACCOUNT_LIMIT_NAME_USD),
    newPerDay: pos(env?.ACCOUNT_LIMIT_NEW_PER_DAY),
    sharesUsd: sharesSet ? pos(String(sharesRaw).trim()) : SHARES_LIMIT_DEFAULT_USD,
  };
  out.any = Object.values(out).some((v) => v != null);
  return out;
}
// The limits at request time (the Webull mirror, the controls page): a value
// in the Vercel environment wins, else the saved Owner Settings value.
export function accountLimitsFromSettings(values = {}, env = process.env) {
  const src = {};
  for (const key of Object.values(LIMIT_KEYS)) {
    const pinned = env?.[key];
    src[key] = pinned != null && String(pinned).trim() !== "" ? pinned : values?.[key];
  }
  return accountLimits(src);
}
// The kill switch (Owner Settings OWNER_CONTROLS, default on). Off = no
// control is in force anywhere (the saved file is kept); the account limits
// have their own 0 = off and are not affected.
const OFF_RE = /^(?:0|false|off|no)$/i;
export function controlsEnabled(env = process.env) {
  const v = env?.OWNER_CONTROLS;
  return !(v != null && OFF_RE.test(String(v).trim()));
}
// At request time: a value in the Vercel environment wins, else the saved
// Owner Settings value (missing = on).
export function controlsEnabledFromSettings(values = {}, env = process.env) {
  const pinned = env?.OWNER_CONTROLS;
  if (pinned != null && String(pinned).trim() !== "") return controlsEnabled(env);
  return values?.OWNER_CONTROLS !== false;
}
const ET_DATE = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? etClock(ms).date : null; };

// The Webull mirror's open gate: a function (entry, ledger, trade) -> reason or
// null, checked when a record trade first meets the ledger. Stop and Avoid
// hold every new open; the account limits count the paper account's own
// trades (both records share it). `dayLoss` is the realized result of paper
// closes today, from the fill prices.
export function mirrorOpenGate(active, limits, { nowMs = Date.now() } = {}) {
  const today = etClock(nowMs).date;
  const ended = new Set(["skipped", "missed", "settled", "closed"]);
  // Share orders (stock lots) are priced per share; options per contract
  // (x100). Stock stays out of the open option premium cap, as in the engines.
  const isStock = (x) => !!x && (x.instrument === "stock" || x.structure === "shares" || x.contract?.structure === "shares");
  const mult = (x) => (isStock(x) ? 1 : 100);
  const qtyOf = (t) => Math.max(Number(t.openQty) || 0, ["entering"].includes(t.state) ? Number(t.requestedQty) || 1 : 0);
  const money = (t) => (Number(t.fillPrice ?? t.engineEntryPrice) || 0) * mult(t) * qtyOf(t);
  return (e, ledger, t) => {
    if (active?.stop) return "Not bought: new trades are stopped by the owner.";
    if (active?.avoid?.has(e.symbol)) return `Not bought: ${e.symbol} is on the owner's avoid list.`;
    if (!limits?.any) return null;
    const trades = Object.values(ledger?.trades || {}).filter((x) => x && x !== t);
    const live = trades.filter((x) => !ended.has(x.state));
    const stockNew = isStock(t) || isStock(e);
    const cost = (Number(t?.engineEntryPrice) || 0) * (stockNew ? 1 : 100) * (Number(t?.requestedQty) || 1);
    if (limits.newPerDay != null) {
      const n = trades.filter((x) => !["skipped", "missed"].includes(x.state) && ET_DATE(x.engineEntryIso) === today).length;
      if (n >= limits.newPerDay) return `Not bought: account limit of ${limits.newPerDay} new trades a day reached.`;
    }
    if (limits.dayLossUsd != null) {
      let pnl = 0;
      for (const x of trades) {
        if (!x.closeFillIso || ET_DATE(x.closeFillIso) !== today || !(x.fillPrice > 0) || !(x.closeFillPrice >= 0)) continue;
        const sign = x.structure === "credit_vertical" ? -1 : 1;
        pnl += sign * (x.closeFillPrice - x.fillPrice) * mult(x) * (Number(x.closedQty) || Number(x.filledQty) || 1);
      }
      if (pnl <= -limits.dayLossUsd) return `Not bought: daily loss stop of $${Math.round(limits.dayLossUsd).toLocaleString("en-US")} reached.`;
    }
    if (limits.openUsd != null && !stockNew) {
      const open = live.filter((x) => !isStock(x)).reduce((a, x) => a + money(x), 0);
      if (open + cost > limits.openUsd) return `Not bought: the open premium cap of $${Math.round(limits.openUsd).toLocaleString("en-US")} would be passed.`;
    }
    // Open engine stock (2026-11-23): every stock lot in the paper account at
    // cost (engine share trades and core holdings), the new order included.
    if (limits.sharesUsd != null && stockNew) {
      const open = live.filter(isStock).reduce((a, x) => a + money(x), 0);
      if (open + cost > limits.sharesUsd) return `Not bought: the $${Math.round(limits.sharesUsd).toLocaleString("en-US")} cap on open engine stock would be passed.`;
    }
    if (limits.nameUsd != null) {
      const name = live.filter((x) => x.symbol === e.symbol).reduce((a, x) => a + money(x), 0);
      if (name + cost > limits.nameUsd) return `Not bought: the $${Math.round(limits.nameUsd).toLocaleString("en-US")} cap on ${e.symbol} would be passed.`;
    }
    return null;
  };
}

// --- Changes from the page ------------------------------------------------------
// POST body { act, ... }. Returns { doc, changed } or { error }.
//   stop            { note? }                 resume
//   avoid           { sym, close?, until?, px?, note? }   lift { sym, px? }
//   watch           { sym }                   unwatch { sym }
//   catalyst        { sym?, text, date }      uncatalyst { id }
//   dial            { level: safer|normal|riskier }
//   undo            {}                        (the newest change not undone)
export const ACTS = Object.freeze(["stop", "resume", "avoid", "lift", "watch", "unwatch", "catalyst", "uncatalyst", "dial", "undo"]);
// Settings that need the "are you sure" box before the server accepts them.
export const CONFIRM_ACTS = Object.freeze(["stop", "dial:riskier", "avoid:close"]);

export function validateControlsRequest(body, { today = etClock(Date.now()).date } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const act = typeof b.act === "string" ? b.act : "";
  if (!ACTS.includes(act)) return { error: "bad act" };
  if (["avoid", "lift", "watch", "unwatch"].includes(act) && !cleanSymbol(b.sym)) return { error: "bad symbol" };
  if (act === "avoid" && b.until != null && b.until !== "" && (!dateOk(b.until) || b.until < today)) return { error: "bad end date" };
  if (act === "catalyst") {
    if (!str(b.text, 140)) return { error: "catalyst needs a line of text" };
    if (!dateOk(b.date) || b.date < today || b.date > addDays(today, 366)) return { error: "catalyst date must be today or within a year" };
    if (b.sym != null && b.sym !== "" && !cleanSymbol(b.sym)) return { error: "bad symbol" };
  }
  if (act === "uncatalyst" && !(Number(b.id) > 0)) return { error: "bad id" };
  if (act === "dial" && !DIAL[b.level]) return { error: "bad level" };
  const needs = act === "stop" ? "stop" : act === "dial" && b.level === "riskier" ? "dial:riskier" : act === "avoid" && b.close === true ? "avoid:close" : null;
  if (needs && b.confirm !== true) return { error: "confirm required", confirm: needs };
  return { act };
}

// Move expired items into `past` (kept for the scorecard).
export function sweepExpired(doc, nowMs) {
  const today = etClock(nowMs).date;
  const at = new Date(nowMs).toISOString();
  const past = [];
  const keepA = [], keepW = [], keepK = [];
  for (const a of doc.avoid) if (a.until && today > a.until) past.push({ kind: "avoid", id: a.id, sym: a.sym, at: a.at, ended: at, how: "expired", px: a.px, pxEnd: null }); else keepA.push(a);
  for (const w of doc.watch) if (today > w.until) past.push({ kind: "watch", id: w.id, sym: w.sym, at: w.at, ended: at, how: "expired" }); else keepW.push(w);
  for (const k of doc.catalysts) if (today > k.date) past.push({ kind: "catalyst", id: k.id, sym: k.sym, at: k.at, ended: at, how: "expired" }); else keepK.push(k);
  let dial = doc.dial;
  if (dial && Date.parse(dial.until) <= nowMs) { past.push({ kind: "dial", level: dial.level, at: dial.at, ended: dial.until, how: "expired" }); dial = null; }
  if (!past.length) return { doc, swept: 0 };
  return { doc: { ...doc, avoid: keepA, watch: keepW, catalysts: keepK, dial, past: [...past, ...doc.past].slice(0, OWNER_CONTROLS_PAST) }, swept: past.length };
}

export function applyOwnerControlsRequest(current, body, { at = new Date().toISOString(), by = null } = {}) {
  const nowMs = Date.parse(at);
  const today = etClock(nowMs).date;
  const ok = validateControlsRequest(body, { today });
  if (ok.error) return ok;
  const b = body;
  let doc = sweepExpired(readOwnerControlsDoc(current), nowMs).doc;
  const who = by64(by);
  const prev = JSON.parse(JSON.stringify(state(doc)));
  const id = doc.seq + 1;
  const sym = cleanSymbol(b.sym);
  let text = "", past = [];
  const next = { ...doc };
  switch (ok.act) {
    case "stop":
      if (doc.stop) return { doc, unchanged: true };
      next.stop = { at, by: who, note: str(b.note, 140) || null };
      text = "Stopped new trades";
      break;
    case "resume":
      if (!doc.stop) return { doc, unchanged: true };
      past.push({ kind: "stop", at: doc.stop.at, ended: at, how: "lifted", logId: id });
      next.stop = null;
      text = "Resumed new trades";
      break;
    case "avoid": {
      const until = dateOk(b.until) ? b.until : null, close = b.close === true;
      const old = doc.avoid.find((a) => a.sym === sym);
      if (old && old.close === close && old.until === until) return { doc, unchanged: true };
      if (!old && doc.avoid.length >= MAX_ITEMS) return { error: "avoid list is full" };
      const row = { id, sym, at: old ? old.at : at, by: who, close, until, px: old ? old.px : px(b.px), note: str(b.note, 140) || null };
      next.avoid = old ? doc.avoid.map((a) => (a.sym === sym ? row : a)) : [row, ...doc.avoid];
      text = `Avoid ${sym}${close ? " and close its open trades" : ""}${until ? ` through ${dayText(until)}` : " until lifted"}`;
      break;
    }
    case "lift": {
      const old = doc.avoid.find((a) => a.sym === sym);
      if (!old) return { doc, unchanged: true };
      past.push({ kind: "avoid", id: old.id, sym, at: old.at, ended: at, how: "lifted", px: old.px, pxEnd: px(b.px), logId: id });
      next.avoid = doc.avoid.filter((a) => a.sym !== sym);
      text = `Lifted avoid on ${sym}`;
      break;
    }
    case "watch": {
      const until = watchUntil(nowMs);
      const old = doc.watch.find((w) => w.sym === sym);
      if (old && old.until === until) return { doc, unchanged: true };
      if (!old && doc.watch.length >= MAX_ITEMS) return { error: "watch list is full" };
      const row = { id, sym, at, by: who, until };
      next.watch = old ? doc.watch.map((w) => (w.sym === sym ? row : w)) : [row, ...doc.watch];
      text = `Watch ${sym} closely through ${dayText(until)}`;
      break;
    }
    case "unwatch": {
      const old = doc.watch.find((w) => w.sym === sym);
      if (!old) return { doc, unchanged: true };
      past.push({ kind: "watch", id: old.id, sym, at: old.at, ended: at, how: "lifted", logId: id });
      next.watch = doc.watch.filter((w) => w.sym !== sym);
      text = `Stopped watching ${sym}`;
      break;
    }
    case "catalyst": {
      if (doc.catalysts.length >= MAX_ITEMS) return { error: "catalyst log is full" };
      const row = { id, sym, text: str(b.text, 140), date: b.date, at, by: who };
      next.catalysts = [row, ...doc.catalysts].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : y.id - x.id));
      text = `Catalyst ${dayText(b.date)}${sym ? ` on ${sym}` : ""}: ${row.text}`;
      break;
    }
    case "uncatalyst": {
      const old = doc.catalysts.find((k) => k.id === Number(b.id));
      if (!old) return { doc, unchanged: true };
      past.push({ kind: "catalyst", id: old.id, sym: old.sym, at: old.at, ended: at, how: "lifted", logId: id });
      next.catalysts = doc.catalysts.filter((k) => k.id !== old.id);
      text = `Removed catalyst ${dayText(old.date)}${old.sym ? ` on ${old.sym}` : ""}`;
      break;
    }
    case "dial": {
      const level = b.level;
      const cur = doc.dial ? doc.dial.level : "normal";
      if (level === cur && level === "normal") return { doc, unchanged: true };
      if (doc.dial) past.push({ kind: "dial", level: doc.dial.level, at: doc.dial.at, ended: at, how: level === "normal" ? "lifted" : "replaced", logId: id });
      next.dial = level === "normal" ? null : { level, at, by: who, until: dialUntil(nowMs) };
      text = level === "normal" ? "Risk dial back to Normal" : `Risk dial ${DIAL[level].label} until ${etText(next.dial.until)}`;
      break;
    }
    case "undo": {
      const target = doc.log.find((l) => !l.undone && l.act !== "undo" && l.prev);
      if (!target) return { error: "nothing to undo" };
      Object.assign(next, JSON.parse(JSON.stringify(target.prev)));
      next.past = doc.past.filter((p) => p.logId !== target.id);
      next.log = doc.log.map((l) => (l.id === target.id ? { ...l, undone: true } : l));
      text = `Undid: ${target.text}`;
      next.seq = id; next.updatedAt = at; next.by = who;
      next.log = [{ id, at, by: who, act: "undo", text, of: target.id }, ...next.log].slice(0, OWNER_CONTROLS_LOG);
      return { doc: readOwnerControlsDoc(next), changed: true, text };
    }
    default:
      return { error: "bad act" };
  }
  next.past = [...past, ...doc.past].slice(0, OWNER_CONTROLS_PAST);
  next.seq = id; next.updatedAt = at; next.by = who;
  next.log = [{ id, at, by: who, act: ok.act, text, prev }, ...doc.log].slice(0, OWNER_CONTROLS_LOG);
  return { doc: readOwnerControlsDoc(next), changed: true, text };
}

// What the page reads (GET and every POST reply): the record plus what is in
// force now. The log's undo snapshots stay on the server.
export function controlsView(doc, nowMs = Date.now(), limits = null, { enabled = true } = {}) {
  const d = readOwnerControlsDoc(doc);
  const act = activeControls(d, nowMs);
  return {
    version: OWNER_CONTROLS_VERSION, updatedAt: d.updatedAt, by: d.by, now: new Date(nowMs).toISOString(),
    stop: d.stop,
    avoid: d.avoid.map((a) => ({ ...a, active: act.avoid.has(a.sym) })),
    watch: d.watch.map((w) => ({ ...w, active: act.watch.has(w.sym) })),
    catalysts: d.catalysts.map((k) => ({ ...k, active: act.catalysts.includes(k) })),
    dial: act.dial ? { level: act.dial.level, label: act.dial.label, help: act.dial.help, at: act.dial.at, until: act.dial.until, by: d.dial?.by || null } : { level: "normal", label: DIAL.normal.label, help: DIAL.normal.help },
    dials: Object.values(DIAL).map((x) => ({ level: x.level, label: x.label, help: x.help })),
    watchSessions: WATCH_SESSIONS,
    nextDialUntil: dialUntil(nowMs), nextWatchUntil: watchUntil(nowMs),
    past: d.past.slice(0, 60),
    log: d.log.map((l) => ({ id: l.id, at: l.at, by: l.by, act: l.act, text: l.text, ...(l.undone ? { undone: true } : {}), ...(l.of ? { of: l.of } : {}) })),
    canUndo: d.log.some((l) => !l.undone && l.act !== "undo" && l.prev),
    limits: limits ? { openUsd: limits.openUsd, dayLossUsd: limits.dayLossUsd, nameUsd: limits.nameUsd, newPerDay: limits.newPerDay, sharesUsd: limits.sharesUsd ?? null } : null,
    any: act.any,
    enabled: enabled !== false,
    // The never-trade list (lib/never-trade.mjs): locked in code, shown beside
    // Avoid; the kill switch above does not reach it.
    neverTrade: neverTradeView(),
  };
}

// --- Scorecard ----------------------------------------------------------------------
// How trades did under each dial setting and on watched / catalyst names,
// from both records (closed trades stamped `ownerControls`; trades opened
// since the controls started with no stamp count as Normal), and the avoided
// names' move from the price when they were avoided (`nowPx` from the page's
// live quote, or the price when lifted).
export function controlsScorecard(doc, { engines = [], picks = [], since = null } = {}) {
  const d = readOwnerControlsDoc(doc);
  const first = since || [...d.log].map((l) => l.at).sort()[0] || null;
  const rows = [];
  const add = (src, t) => {
    const p = Number(t?.optionPnlPct);
    if (!t || !Number.isFinite(p) || t.status === "left-coverage" || t.outcome === "void" || t.outcome === "left-coverage") return;
    if (!t.ownerControls && (!first || !(String(t.entryDate) >= first))) return;
    rows.push({ src, dial: t.ownerControls?.dial || "normal", watch: !!t.ownerControls?.watch, catalyst: !!t.ownerControls?.catalyst, pnl: p, ownerClose: t.status === "owner-avoid" });
  };
  for (const t of engines) add("engines", t);
  for (const t of picks) add("picks", t);
  const stat = (list) => {
    if (!list.length) return { n: 0, wins: 0, winRate: null, avg: null };
    const wins = list.filter((r) => r.pnl > 0).length;
    return { n: list.length, wins, winRate: Math.round((wins / list.length) * 1000) / 1000, avg: Math.round((list.reduce((a, r) => a + r.pnl, 0) / list.length) * 10) / 10 };
  };
  const out = { since: first, groups: [] };
  for (const level of ["safer", "normal", "riskier"]) out.groups.push({ key: `dial:${level}`, label: `Risk dial ${DIAL[level].label}`, ...stat(rows.filter((r) => r.dial === level)) });
  out.groups.push({ key: "watch", label: "Watched closely", ...stat(rows.filter((r) => r.watch)) });
  out.groups.push({ key: "catalyst", label: "Flagged catalyst", ...stat(rows.filter((r) => r.catalyst)) });
  out.groups.push({ key: "owner-avoid", label: "Closed by Avoid", ...stat(rows.filter((r) => r.ownerClose)) });
  const avoided = [], seen = new Set();
  // One row per avoid (an undo can put an expired one back for a moment).
  const push = (r) => { const k = r.sym + "|" + r.at; if (!seen.has(k)) { seen.add(k); avoided.push(r); } };
  for (const a of d.avoid) push({ sym: a.sym, at: a.at, px: a.px, pxEnd: null, open: true });
  for (const p of d.past) if (p.kind === "avoid") push({ sym: p.sym, at: p.at, ended: p.ended, px: p.px, pxEnd: p.pxEnd, open: false });
  out.avoided = avoided.slice(0, 40);
  out.days = first ? Math.max(0, Math.round((Date.now() - Date.parse(first)) / 86400000)) : 0;
  out.ready = out.days >= 30;
  return out;
}
