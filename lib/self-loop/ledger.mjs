// Self-improving loop, step 1 and 2: the prediction ledger (L1) and the
// option outcome joiner (L2). Spec: docs/self-loop.md.
//
// Every 11:00 / 15:30 ET Top Picks run already archives what the engine saw
// for every scored name (lib/picks-run-archive.mjs), and picks-outcomes.json
// already fills in what each name's stock did 1, 5, 10 and 20 sessions later.
// What was missing is the estimate itself, written down BEFORE the market
// answers, as a number that can be scored:
//
//   p5 / p10 / p20  chance the stock moves the trade's way over 5, 10 and 20
//                   sessions (percent, 0-100)
//   em10            expected 10-session move the trade's way (percent)
//   im10            the options' implied 10-session move (percent, ATM IV)
//   pTp             chance the planned single option reaches +25% before
//                   -50% within 20 sessions (percent)
//
// The numbers come from lib/self-loop/calibrate.mjs, fitted only on ledger
// rows whose outcome was already known before the run (walk-forward). Until
// enough rows have resolved, an estimate is the coin-flip prior and says so
// (`pn`, the samples behind it).
//
// The option outcome (`o`) is modeled with the Track Record's exits:
// Black-Scholes at the entry IV on each later daily close, measured against
// the same model's value at the run's spot (so a gap between the model and
// the quoted mid on day one cannot fake a take-profit or a stop), +25% take
// profit, -50% stop, scored after 3.5 points of round-trip cost (the
// 2026-10-20 reality check). It runs on every scored name the run priced, so
// the loop judges about 170 estimates a day instead of a few trades a month.
//
// Pure and synchronous. No network, no AI. Rows are arrays in LEDGER_KEYS
// order to keep the file small.

import { bsPrice, expiryCloseEpochSec } from "../greeks.mjs";
import { dailyClosesOf, marketTypeOf } from "../picks-outcomes.mjs";

// One rule each, shared with the outcome rows: market type (severe pools
// with risk-off) and the daily closes of a bake chain or a stored file.
export { marketTypeOf };
export const dailyCloses = dailyClosesOf;

export const LEDGER_VERSION = 1;
export const LEDGER_KEYS = Object.freeze([
  "d", "et", "s", "side", "tot", "tot0", "out", "ev", "mk", "cell", "ep",
  "p5", "p10", "p20", "em10", "im10", "pTp", "pn", "c", "sig", "o", "px", "pl", "xv",
]);
export const LEDGER_KEEP_DAYS = 90;          // distinct run days kept
export const OPTION_TP = 25;                 // the record's take-profit, percent
export const OPTION_STOP = -50;              // the record's stop, percent
export const OPTION_COST = 3.5;              // round-trip cost, points of premium (single)
export const OPTION_MAX_SESSIONS = 20;       // scoring horizon for the option outcome
export const OPTION_RFR = 0.04;

const I = Object.fromEntries(LEDGER_KEYS.map((k, i) => [k, i]));
export const LEDGER_INDEX = I;
const SYM_RE = /^[A-Z][A-Z0-9.]{0,5}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 + 0 : null); // + 0 turns -0 into 0
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 + 0 : null); // + 0 turns -0 into 0
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 + 0 : null); // + 0 turns -0 into 0

export function validDate(d) {
  if (typeof d !== "string" || !DATE_RE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

export function ledgerKey(row) {
  return `${row[I.d]}|${row[I.et]}|${row[I.s]}|${row[I.side]}`;
}

export function outClass(out) {
  const o = String(out || "");
  if (o.startsWith("pick:")) return "pick";
  if (o.startsWith("gate:")) return "gate";
  if (o === "below-bar" || o === "open") return o;
  return "other";
}

// |total| band used by the calibration: whole points, 9 = 9 and up.
export function bandOf(tot) {
  const a = Math.abs(num(tot) ?? 0);
  return Math.min(9, Math.floor(a));
}

// The ATM IV's implied move over `sessions` sessions, in percent.
export function impliedMove(iv, sessions = 10) {
  const sig = num(iv);
  if (!(sig > 0)) return null;
  return r2(sig * Math.sqrt(sessions / 252) * 100);
}

// Compact the run row's signal votes: only votes that are not zero.
function compactSignals(signals) {
  if (!signals || typeof signals !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(signals)) {
    const n = num(v);
    if (n != null && n !== 0 && /^[A-Za-z0-9_]{1,32}$/.test(k)) out[k] = r2(n);
  }
  return Object.keys(out).length ? out : null;
}

// The pillar scores (f, t, m, n, iv, rg) as the run archive keeps them.
const PILLAR_KEYS = ["f", "t", "m", "n", "iv", "rg"];
function compactPillars(p) {
  if (!p || typeof p !== "object") return null;
  const out = {};
  for (const k of PILLAR_KEYS) { const n = num(p[k]); if (n != null && n !== 0) out[k] = r2(n); }
  return Object.keys(out).length ? out : null;
}

// The single option the run would have bought: [strike, expiry epoch, mid, iv].
function compactOption(c) {
  if (!c || typeof c !== "object") return null;
  const k = num(c.k ?? c.strike), exp = num(c.exp ?? c.expiry), iv = num(c.iv);
  let m = num(c.m ?? c.mid);
  const b = num(c.b ?? c.bid), a = num(c.a ?? c.ask);
  if (!(m > 0) && b > 0 && a > 0) m = (a + b) / 2;
  if (!(k > 0) || !(exp > 0) || !(m > 0) || !(iv > 0)) return null;
  return [r2(k), exp, r2(m), r4(iv)];
}

export function emptyLedger() {
  return { v: LEDGER_VERSION, keys: LEDGER_KEYS.slice(), rows: [] };
}

export function parseLedger(raw) {
  const out = emptyLedger();
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.rows)) return out;
  const keys = Array.isArray(raw.keys) ? raw.keys : LEDGER_KEYS;
  const pos = LEDGER_KEYS.map((k) => keys.indexOf(k));
  for (const r of raw.rows) {
    if (!Array.isArray(r)) continue;
    const row = LEDGER_KEYS.map((_, i) => (pos[i] >= 0 && r[pos[i]] !== undefined ? r[pos[i]] : null));
    if (!validDate(row[I.d]) || !SYM_RE.test(String(row[I.s] || ""))) continue;
    if (row[I.side] !== "call" && row[I.side] !== "put") continue;
    out.rows.push(row);
  }
  return out;
}

// Append one archived run (buildPicksRunRecord's output). `estimate(row)`
// returns the walk-forward estimate for a { band, side, mk, cell } setup
// (lib/self-loop/calibrate.mjs estimateFor bound to the current model).
// `baseTotals` optionally maps SYMBOL -> the untuned total when the loop's
// live weights changed the grade (lib/self-loop/tune.mjs); otherwise tot0
// equals tot.
export function appendRunLedger(ledger, run, date, { estimate = null, baseTotals = null } = {}) {
  if (!ledger || !run || !Array.isArray(run.rows) || !validDate(date)) return 0;
  const have = new Set(ledger.rows.map(ledgerKey));
  const et = typeof run.et === "string" ? run.et : "";
  const mk = marketTypeOf(run.regime?.st);
  const cell = typeof run.lab?.cell === "string" ? run.lab.cell.slice(0, 24) : null;
  let added = 0;
  for (const r of run.rows) {
    if (!r || !SYM_RE.test(String(r.s || ""))) continue;
    const side = r.side === "put" ? "put" : "call";
    const row = LEDGER_KEYS.map(() => null);
    row[I.d] = date; row[I.et] = et; row[I.s] = r.s; row[I.side] = side;
    row[I.tot] = r2(num(r.tot));
    const base = baseTotals && Number.isFinite(num(baseTotals[r.s])) ? num(baseTotals[r.s]) : num(r.tot);
    row[I.tot0] = r2(base);
    row[I.out] = typeof r.out === "string" ? r.out.slice(0, 40) : null;
    row[I.ev] = r.ai && (r.ai.ev === "buy-now" || r.ai.ev === "wait") ? r.ai.ev : null;
    row[I.mk] = mk;
    row[I.cell] = cell;
    row[I.ep] = typeof r.tm?.ep === "string" ? r.tm.ep.slice(0, 24) : null;
    const c = compactOption(r.c);
    row[I.c] = c;
    row[I.px] = r2(num(r.spot));
    row[I.sig] = compactSignals(r.signals);
    row[I.pl] = compactPillars(r.pillars);
    const ivAtm = num(r.iv?.atm) ?? (c ? c[3] : null);
    row[I.im10] = impliedMove(ivAtm, 10);
    if (typeof estimate === "function") {
      let est = null;
      // The calibration counts rows by their untuned total, so the estimate
      // reads the same band (identical to tot unless live weights moved it).
      try { est = estimate({ band: bandOf(row[I.tot0] ?? row[I.tot]), side, mk, cell }); } catch { est = null; }
      if (est) {
        row[I.p5] = r1(num(est.p5)); row[I.p10] = r1(num(est.p10)); row[I.p20] = r1(num(est.p20));
        row[I.em10] = r2(num(est.em10)); row[I.pTp] = r1(num(est.pTp)); row[I.pn] = num(est.n);
        row[I.xv] = r1(num(est.ev));
      }
    }
    const key = ledgerKey(row);
    if (have.has(key)) continue;
    have.add(key);
    ledger.rows.push(row);
    added++;
  }
  return added;
}

function closeEpochOf(date) {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) ? expiryCloseEpochSec(t / 1000) : NaN;
}

// Model the planned single option over the closes after the run day.
// Returns [result, net P&L %, sessions] or null when nothing can be said yet:
//   "tp"   reached +25% on a close     "stop"  reached -50% on a close
//   "exp"  expired inside the window   "t20"   neither within 20 sessions
// spot0 + d0 (the run's spot and date) set the entry value from the same
// model; without them the quoted mid is the entry value.
export function simulateOption({ side, opt, closes, spot0 = null, d0 = null, maxSessions = OPTION_MAX_SESSIONS, tp = OPTION_TP, stop = OPTION_STOP, cost = OPTION_COST }) {
  if (!Array.isArray(opt) || !Array.isArray(closes)) return null;
  const [k, exp, mid, iv] = opt;
  if (!(k > 0) || !(mid > 0) || !(iv > 0)) return null;
  const expClose = expiryCloseEpochSec(exp);
  if (!Number.isFinite(expClose)) return null;
  const type = side === "put" ? "put" : "call";
  let entry = mid;
  if (num(spot0) > 0 && d0) {
    const T0 = (expClose - closeEpochOf(d0)) / (365 * 86400);
    const v0 = T0 > 0 ? bsPrice(type, num(spot0), k, T0, iv, OPTION_RFR) : NaN;
    if (Number.isFinite(v0) && v0 > 0.01) entry = v0;
  }
  for (let i = 0; i < closes.length && i < maxSessions; i++) {
    const { t, c } = closes[i];
    const at = closeEpochOf(t);
    if (!Number.isFinite(at)) return null;
    const T = (expClose - at) / (365 * 86400);
    let value;
    if (T <= 0) value = Math.max(0, type === "call" ? c - k : k - c);
    else value = bsPrice(type, c, k, T, iv, OPTION_RFR);
    if (!Number.isFinite(value)) return null;
    const pnl = (value / entry - 1) * 100;
    if (pnl >= tp) return ["tp", r1(pnl - cost), i + 1];
    if (pnl <= stop) return ["stop", r1(pnl - cost), i + 1];
    if (T <= 0) return ["exp", r1(pnl - cost), i + 1];
    if (i + 1 === maxSessions) return ["t20", r1(pnl - cost), i + 1];
  }
  return null;
}

// Fill the option outcome on every row that can be decided now. Only
// sessions after the run day that are over count (a close dated today is a
// partial bar during the session).
export function fillOptionOutcomes(ledger, chains, { today = null } = {}) {
  if (!ledger || !chains) return 0;
  const cache = new Map();
  const closesFor = (sym) => {
    if (!cache.has(sym)) cache.set(sym, chains[sym] ? dailyCloses(chains[sym]) : []);
    return cache.get(sym);
  };
  let filled = 0;
  for (const row of ledger.rows) {
    if (row[I.o] != null || !Array.isArray(row[I.c])) continue;
    const closes = closesFor(row[I.s]);
    if (!closes.length) continue;
    const d = row[I.d];
    const after = closes.filter((b) => b.t > d && (!today || b.t < today));
    if (!after.length) continue;
    const res = simulateOption({ side: row[I.side], opt: row[I.c], closes: after, spot0: row[I.px], d0: d });
    if (res) { row[I.o] = res; filled++; }
  }
  return filled;
}

export function pruneLedger(ledger, keepDays = LEDGER_KEEP_DAYS) {
  if (!ledger) return 0;
  const days = [...new Set(ledger.rows.map((r) => r[I.d]))].sort();
  if (days.length <= keepDays) return 0;
  const cut = days[days.length - keepDays];
  const before = ledger.rows.length;
  ledger.rows = ledger.rows.filter((r) => r[I.d] >= cut);
  return before - ledger.rows.length;
}

// Join the stock outcomes picks-outcomes.json already fills (r1..r20, percent
// of the run spot) onto each ledger row, signed to the trade's side.
// Returns rows as objects for the scorers; nothing is stored.
export function joinedRows(ledger, outcomesState) {
  const oKeys = Array.isArray(outcomesState?.keys) ? outcomesState.keys : [];
  const oi = Object.fromEntries(oKeys.map((k, i) => [k, i]));
  const byKey = new Map();
  for (const r of outcomesState?.rows || []) {
    if (!Array.isArray(r)) continue;
    byKey.set(`${r[oi.d]}|${r[oi.et]}|${r[oi.s]}|${r[oi.side]}`, r);
  }
  const out = [];
  for (const row of ledger?.rows || []) {
    const o = byKey.get(ledgerKey(row)) || null;
    const dir = row[I.side] === "put" ? -1 : 1;
    const sgn = (k) => { const v = o ? num(o[oi[k]]) : null; return v == null ? null : r2(v * dir); };
    const opt = Array.isArray(row[I.o]) ? row[I.o] : null;
    out.push({
      d: row[I.d], et: row[I.et], s: row[I.s], side: row[I.side], tot: num(row[I.tot]), tot0: num(row[I.tot0]),
      band: bandOf(row[I.tot]), out: row[I.out], cls: outClass(row[I.out]), ev: row[I.ev], mk: row[I.mk], cell: row[I.cell], ep: row[I.ep],
      p5: num(row[I.p5]), p10: num(row[I.p10]), p20: num(row[I.p20]), em10: num(row[I.em10]), im10: num(row[I.im10]), pTp: num(row[I.pTp]), pn: num(row[I.pn]),
      sig: row[I.sig] && typeof row[I.sig] === "object" ? row[I.sig] : null,
      pl: row[I.pl] && typeof row[I.pl] === "object" ? row[I.pl] : null,
      xv: num(row[I.xv]),
      y1: sgn("r1"), y5: sgn("r5"), y10: sgn("r10"), y20: sgn("r20"),
      opt: opt ? { res: opt[0], net: num(opt[1]), days: num(opt[2]) } : null,
    });
  }
  return out;
}
