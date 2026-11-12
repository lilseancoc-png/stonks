// Self-improving loop, step 3: test a fix before anything changes (C1-C4).
// Spec: docs/self-loop.md.
//
// A challenger is one small, named change to how the engine picks names,
// drawn from a FIXED menu (C1), never searched for: mute an input that points
// the wrong way, lean harder on one that works, raise or lower the trade bar,
// take only names whose stated option value is positive, switch off a rule
// that costs the book, or skip a side in a market type that keeps losing. At
// most three run at once, and at most one new one starts a week (when the
// weekly report is written), so the count of things tried stays small.
//
// Every challenger is judged only on runs AFTER it started (walk-forward), on
// the same modeled option outcomes as a replica of the current rules (C2,
// same contracts, same exits, same costs: lib/self-loop/ledger.mjs). The
// promotion check (C3) asks for all of:
//   30+ sessions and 40+ decided trades since the start,
//   at least 2 points better than the replica after costs,
//   better in both halves of its time and in the newest fifth (the holdout),
//   still better with its best three trades dropped,
//   still positive with the costs doubled,
//   a t value (5-session blocks, Newey-West corrected for overlapping
//   holds) above the Student-t bar for the blocks and the trials run.
// A challenger that passes is a recommendation (C4), never a change: step 4
// applies the live-adjustable ones only when switched on, within its limits;
// the rest name the code change or the Owner switch they point to.
//
// Pure, no network, no AI.

import { inputLabel } from "./diagnose.mjs";
import { afterMark } from "./ledger.mjs";
import { SHADOW_LABELS, SHADOW_KEYS } from "../shadow-signals.mjs";

const shadowLabel = (key) => SHADOW_LABELS[key] || key;

export const CHALLENGERS_VERSION = 1;
export const MAX_ACTIVE = 3;
export const MIN_SESSIONS = 30;
export const MIN_TRADES = 40;
export const MIN_EDGE = 2;               // points of premium after costs, per trade
export const RETIRE_SESSIONS = 60;       // no verdict by then: retired as "no edge"
export const RETRY_AFTER_SESSIONS = 60;  // the same change is not tried again sooner
export const BLOCK_SESSIONS = 5;
export const DONE_KEEP = 40;
export const COST = 3.5;
export const ADD_WEIGHT = 1;              // most points an added input moves a name
// An "add an input" challenger starts from a shadow key whose 10-session read
// (lib/shadow-research.mjs) has this many days, this rank IC and the same
// sign in both halves. Lighter than the promotion bar on purpose: the
// challenger's own forward test is the real check.
export const ADD_MIN_DAYS = 20;
export const ADD_MIN_IC = 0.03;

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 + 0 : null); // + 0 turns -0 into 0
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 + 0 : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Inverse standard normal (Acklam), for the trials-adjusted bar.
export function normInv(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425, hi = 1 - lo;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > hi) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
// log Gamma (Lanczos) and the regularized incomplete beta (continued
// fraction, Lentz), for the Student t distribution.
function lnGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5, ser = 1.000000000190015;
  tmp -= (x + 0.5) * Math.log(tmp);
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betacf(a, b, x) {
  const EPS = 3e-14, FPMIN = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function betaInc(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
// Student t: P(T <= t) with df degrees of freedom, and its inverse.
export function tCdf(t, df) {
  if (!(df > 0) || !Number.isFinite(t)) return NaN;
  const tail = 0.5 * betaInc(df / 2, 0.5, df / (df + t * t));
  return t >= 0 ? 1 - tail : tail;
}
export function tInv(p, df) {
  if (!(p > 0 && p < 1) || !(df > 0)) return NaN;
  let lo = -1e3, hi = 1e3;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid; else hi = mid;
    if (hi - lo < 1e-9) break;
  }
  return (lo + hi) / 2;
}
// One-sided 5% split over every challenger ever started (Bonferroni), on a
// Student t with (blocks - 1) degrees of freedom: 30 sessions are only six
// 5-session blocks, where the normal bar passes a no-edge challenger too
// often. Without a block count the normal bar is the floor.
export function tBar(trials, blocks = null) {
  const n = Math.max(1, Math.floor(trials || 1));
  const p = 1 - 0.05 / n;
  const b = Math.floor(num(blocks) ?? 0);
  return r2(b >= 3 ? tInv(p, b - 1) : normInv(p));
}
// t value of the block differences with a Newey-West (lag 1) variance: a
// trade held past its block makes neighbouring blocks move together, which
// the plain t counts as independent. The correction only ever lowers t.
export function tStatHac(xs) {
  const n = xs?.length || 0;
  if (n < 3) return null;
  const m = mean(xs);
  const g0 = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
  let g1 = 0;
  for (let i = 1; i < n; i++) g1 += (xs[i] - m) * (xs[i - 1] - m);
  g1 /= n - 1;
  const v = Math.max(g0, g0 + g1);
  return v > 0 ? m / Math.sqrt(v / n) : null;
}

// ---- the menu (C1) --------------------------------------------------------------------------

// What each kind changes, and whether step 4 can apply it live.
export const KINDS = Object.freeze({
  mute: { live: true, setting: "weight 0" },
  up: { live: true, setting: "weight 1.5" },
  bar: { live: true, setting: "trade bar" },
  "ev-gate": { live: true, setting: "expected-value gate" },
  "rule-off": { live: false, setting: "code change: switch the rule off" },
  // Adds one logged-not-scored shadow input (lib/shadow-signals.mjs) at most
  // ADD_WEIGHT points, in the direction the Evidence tab measured. Paper
  // only: adding an input to the grade is the owners' decision.
  add: { live: false, setting: "owners' call: add the input to the grade" },
  skip: { live: false, setting: "Owner market mode or a code change" },
});

export function specLabel(spec) {
  const k = spec?.kind;
  if (k === "mute") return `Mute ${inputLabel(spec.key)}`;
  if (k === "up") return `Lean harder on ${inputLabel(spec.key)} (x1.5)`;
  if (k === "bar") return `Trade bar at ${spec.value}`;
  if (k === "ev-gate") return "Only names whose stated option value is positive";
  if (k === "rule-off") return `Switch off the ${spec.key} rule`;
  if (k === "skip") return `Skip ${spec.key.replace("/", " in ")} markets`;
  if (k === "add") return `Add ${shadowLabel(spec.key)} (${spec.value < 0 ? "lower is better" : "higher is better"}, up to ${ADD_WEIGHT} point)`;
  return String(spec?.id || "challenger");
}

const specId = (spec) => (spec.kind === "add" ? `add:${spec.key}:${spec.value < 0 ? "-" : "+"}` : `${spec.kind}:${spec.key ?? spec.value ?? ""}`);

// The vote a row carries for an input key ("P:f" reads the pillar).
function voteOf(row, key) {
  if (!key) return 0;
  if (key.startsWith("P:")) return num(row.pl?.[key.slice(2)]) ?? 0;
  return num(row.sig?.[key]) ?? 0;
}

// The score a challenger would give this row, or null when it would not trade
// it at all. Delta method: muting an input takes its vote out of the total,
// leaning harder adds half again; a vote that would flip the side drops the
// name (the modeled option is the run's side).
// The base rules' bar is the run's own (an edge governor raise included,
// the loop's bar not); `bar` is the fallback for rows without one. Only
// names the run made actionable or held under its bar are trade
// candidates: a watch idea held back by a rule is not, unless the
// challenger switches that rule off.
export function challengerTakes(row, spec, { bar = 4 } = {}) {
  const tot0 = num(row.tot0 ?? row.tot);
  if (tot0 == null) return false;
  const gateOff = spec?.kind === "rule-off" && (row.out === `gate:${spec.key}` || row.out === `held:${spec.key}`);
  if (!(row.cls === "pick" || row.cls === "below-bar" || gateOff)) return false;
  let score = tot0, useBar = num(row.bar0) ?? bar;
  if (spec?.kind === "mute") score = tot0 - voteOf(row, spec.key);
  else if (spec?.kind === "up") score = tot0 + 0.5 * voteOf(row, spec.key);
  else if (spec?.kind === "bar") useBar = num(spec.value) ?? useBar;
  else if (spec?.kind === "add") {
    // The row's rank score for the key (-1..1 within its run), in the
    // measured direction; a row without the key is left as the base rules
    // have it.
    const rk = num(row.sh?.[spec.key]);
    if (rk != null) score = tot0 + ADD_WEIGHT * (num(spec.value) < 0 ? -1 : 1) * rk;
  }
  if (Math.sign(score) !== Math.sign(tot0) || Math.abs(score) < useBar) return false;
  if (spec?.kind === "ev-gate" && !(num(row.xv) != null && row.xv >= 0)) return false;
  if (spec?.kind === "skip") { const [side, mk] = String(spec.key).split("/"); if (row.side === side && row.mk === mk) return false; }
  return true;
}

// A book: the trades a selection rule takes over the rows, one name and side
// at a time (no new trade while the last one is still open, as the engine
// does), each with its modeled option result. `since` keeps runs from that
// date on; `mark` ({ d, et }, lib/self-loop/ledger.mjs afterMark) keeps runs
// after a point in run time (`incl` counts the run at the mark).
export function bookTrades(rows, takes, { since = null, mark = null, incl = false } = {}) {
  const dates = [...new Set((rows || []).map((r) => r.d))].sort();
  const idx = new Map(dates.map((d, i) => [d, i]));
  const sorted = (rows || []).filter((r) => (!since || r.d >= since) && (!mark || afterMark(r, mark, { incl }))).slice().sort((a, b) => a.d.localeCompare(b.d) || String(a.et).localeCompare(String(b.et)));
  const busyUntil = new Map();
  const out = [];
  for (const r of sorted) {
    if (!takes(r)) continue;
    const k = `${r.s}|${r.side}`;
    const i = idx.get(r.d);
    if (busyUntil.has(k) && i <= busyUntil.get(k)) continue;
    const hold = r.opt && r.opt.days != null ? r.opt.days : 20;
    busyUntil.set(k, i + hold);
    out.push({ d: r.d, et: r.et ?? null, s: r.s, side: r.side, net: r.opt && r.opt.net != null ? r.opt.net : null, days: r.opt?.days ?? null });
  }
  return out;
}

const decided = (trades) => trades.filter((t) => t.net != null);

// Per-block (BLOCK_SESSIONS dates) average of challenger minus replica.
function blockDiffs(ch, base, dates) {
  const block = new Map(dates.map((d, i) => [d, Math.floor(i / BLOCK_SESSIONS)]));
  const sum = (trades) => { const m = new Map(); for (const t of trades) { const b = block.get(t.d); if (b == null) continue; if (!m.has(b)) m.set(b, []); m.get(b).push(t.net); } return m; };
  const a = sum(ch), z = sum(base);
  const out = [];
  for (const [b, xs] of a) if (z.has(b)) out.push(mean(xs) - mean(z.get(b)));
  return out;
}

// The promotion check (C3) for one challenger, on runs strictly after the
// build that started it (a start without a clock: from the next day).
export function judgeChallenger(rows, spec, { bar = 4, trials = 1 } = {}) {
  const since = spec.start;
  const mark = { d: spec.start, et: typeof spec.startEt === "string" ? spec.startEt : null };
  const dates = [...new Set((rows || []).filter((r) => afterMark(r, mark)).map((r) => r.d))].sort();
  const ch = decided(bookTrades(rows, (r) => challengerTakes(r, spec, { bar }), { mark }));
  const base = decided(bookTrades(rows, (r) => challengerTakes(r, { kind: "base" }, { bar }), { mark }));
  const avg = mean(ch.map((t) => t.net)), baseAvg = mean(base.map((t) => t.net));
  const diff = avg != null && baseAvg != null ? avg - baseAvg : null;
  const half = dates[Math.floor(dates.length / 2)] || null;
  const hold = dates[Math.floor(dates.length * 0.8)] || null;
  const part = (lo, hi) => {
    const a = ch.filter((t) => (!lo || t.d >= lo) && (!hi || t.d < hi)), b = base.filter((t) => (!lo || t.d >= lo) && (!hi || t.d < hi));
    return a.length && b.length ? mean(a.map((t) => t.net)) - mean(b.map((t) => t.net)) : null;
  };
  const halves = half ? [part(null, half), part(half, null)] : [null, null];
  const holdout = hold ? part(hold, null) : null;
  const top3 = ch.length > 3 ? mean(ch.map((t) => t.net).sort((x, y) => y - x).slice(3)) : null;
  const dropTop3 = top3 != null && baseAvg != null ? top3 - baseAvg : null;
  const doubleCost = avg != null ? avg - COST : null;
  const blocks = blockDiffs(ch, base, dates);
  const t = tStatHac(blocks);
  const need = tBar(trials, blocks.length);
  const checks = {
    sessions: dates.length >= MIN_SESSIONS,
    trades: ch.length >= MIN_TRADES,
    edge: diff != null && diff >= MIN_EDGE,
    halves: halves.every((h) => h != null && h > 0),
    holdout: holdout != null && holdout > 0,
    dropTop3: dropTop3 != null && dropTop3 > 0,
    doubleCost: doubleCost != null && doubleCost > 0,
    t: t != null && t >= need,
  };
  const enough = checks.sessions && checks.trades;
  let status = "running";
  if (enough && Object.values(checks).every(Boolean)) status = "ready";
  else if (dates.length >= RETIRE_SESSIONS || (enough && diff != null && diff <= 0)) status = "no-edge";
  return {
    id: spec.id, kind: spec.kind, key: spec.key ?? null, value: spec.value ?? null, label: specLabel(spec), start: since,
    sessions: dates.length, trades: ch.length, baseTrades: base.length,
    avg: r1(avg), baseAvg: r1(baseAvg), diff: r1(diff), halves: halves.map(r1), holdout: r1(holdout), dropTop3: r1(dropTop3), doubleCost: r1(doubleCost),
    t: r2(t), tNeed: need, blocks: blocks.length, checks, status,
    live: !!KINDS[spec.kind]?.live, setting: KINDS[spec.kind]?.setting || null,
  };
}

// The menu entries the diagnosis points to, best first.
// Shadow keys worth an "add an input" challenger (lib/shadow-research.mjs
// output `shadow`), strongest 10-session read first.
export function addCandidates(shadow) {
  const out = [];
  for (const k of Array.isArray(shadow?.keys) ? shadow.keys : []) {
    if (!SHADOW_KEYS.includes(k.key)) continue;
    const r = k.read?.["10"];
    const ic = num(r?.ic), h1 = num(r?.half1), h2 = num(r?.half2);
    if (!r || (r.days || 0) < ADD_MIN_DAYS || ic == null || Math.abs(ic) < ADD_MIN_IC) continue;
    if (h1 == null || h2 == null || Math.sign(h1) !== Math.sign(ic) || Math.sign(h2) !== Math.sign(ic)) continue;
    out.push({ key: k.key, value: ic < 0 ? -1 : 1, ic, days: r.days });
  }
  return out.sort((a, b) => Math.abs(b.ic) - Math.abs(a.ic));
}

export function candidateSpecs({ diagnosis, scorecard, modelRows = 0, bar = 4, shadow = null } = {}) {
  const out = [];
  const add = (spec, why) => { spec.id = specId(spec); out.push({ ...spec, why }); };
  for (const x of (diagnosis?.inputs || []).filter((i) => i.status === "against")) add({ kind: "mute", key: x.key }, `${inputLabel(x.key)} has pointed the wrong way over the last ${x.w20.days} sessions`);
  for (const g of (scorecard?.gates?.gates || []).filter((x) => x.verdict === "costing")) add({ kind: "rule-off", key: g.gate }, `the ${g.gate} rule turned away names that did better`);
  for (const p of (diagnosis?.losses?.worst || []).filter((w) => w.feature === "side x market")) add({ kind: "skip", key: p.value.replace(" / ", "/") }, `${p.value} lost ${p.lossRate}% of the time`);
  if (modelRows >= 200) add({ kind: "ev-gate" }, "the count model is past its learning bar");
  for (const c of addCandidates(shadow)) add({ kind: "add", key: c.key, value: c.value }, `${shadowLabel(c.key)} has a 10-session rank IC of ${c.ic > 0 ? "+" : ""}${c.ic.toFixed(3)} over ${c.days} days, same sign in both halves`);
  for (const x of (diagnosis?.inputs || []).filter((i) => i.status === "working")) add({ kind: "up", key: x.key }, `${inputLabel(x.key)} has lined up with the move over the last ${x.w20.days} sessions`);
  for (const x of (diagnosis?.inputs || []).filter((i) => i.status === "fading")) add({ kind: "mute", key: x.key }, `${inputLabel(x.key)} is fading`);
  add({ kind: "bar", value: bar + 1 }, "fewer, stronger names");
  add({ kind: "bar", value: bar - 0.5 }, "more names, a little weaker");
  const seen = new Set();
  return out.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

export function emptyChallengers() {
  return { v: CHALLENGERS_VERSION, active: [], done: [], trials: 0 };
}
export function parseChallengers(raw) {
  const out = emptyChallengers();
  if (!raw || typeof raw !== "object") return out;
  const ok = (s) => s && typeof s.id === "string" && KINDS[s.kind] && typeof s.start === "string";
  out.active = Array.isArray(raw.active) ? raw.active.filter(ok).slice(0, MAX_ACTIVE) : [];
  out.done = Array.isArray(raw.done) ? raw.done.filter((s) => s && typeof s.id === "string").slice(-DONE_KEEP) : [];
  out.trials = Number.isFinite(raw.trials) ? raw.trials : out.active.length + out.done.length;
  return out;
}

// Every bake: judge the running challengers, retire finished ones, and when
// this build wrote a weekly report start at most one new challenger from the
// menu. Returns the block the view shows.
export function stepChallengers(book, { rows, diagnosis, scorecard, modelRows = 0, bar = 4, today, nowEt = null, startNew = false, shadow = null } = {}) {
  if (!book) return null;
  const dates = [...new Set((rows || []).map((r) => r.d))].sort();
  const judged = [];
  const still = [];
  for (const spec of book.active) {
    const j = judgeChallenger(rows, spec, { bar, trials: book.trials });
    // Finished: no edge, or its time is up (a ready one keeps its verdict).
    if (j.status === "no-edge" || j.sessions >= RETIRE_SESSIONS) book.done.push({ ...spec, end: today, result: j });
    else still.push(spec);
    judged.push(j);
  }
  book.active = still;
  book.done = book.done.slice(-DONE_KEEP);
  let started = null;
  if (startNew && book.active.length < MAX_ACTIVE && today) {
    const recent = new Set(book.done.filter((s) => {
      const i = dates.indexOf(s.end), now = dates.length - 1;
      return i < 0 || now - i < RETRY_AFTER_SESSIONS;
    }).map((s) => s.id).concat(book.active.map((s) => s.id)));
    const next = candidateSpecs({ diagnosis, scorecard, modelRows, bar, shadow }).find((s) => !recent.has(s.id));
    if (next) {
      started = { id: next.id, kind: next.kind, key: next.key ?? null, value: next.value ?? null, why: next.why, start: today, ...(typeof nowEt === "string" ? { startEt: nowEt } : {}) };
      book.active.push(started);
      book.trials += 1;
    }
  }
  const replica = decided(bookTrades(rows, (r) => challengerTakes(r, { kind: "base" }, { bar })));
  return {
    v: CHALLENGERS_VERSION, trials: book.trials, tNeed: tBar(book.trials, Math.floor(MIN_SESSIONS / BLOCK_SESSIONS)), started,
    replica: { trades: replica.length, avg: r1(mean(replica.map((t) => t.net))) },
    running: judged.filter((j) => book.active.some((s) => s.id === j.id)),
    // Passed the check: still running, or finished with the verdict kept.
    ready: judged.filter((j) => j.status === "ready").concat(book.done.slice(-10).map((s) => s.result).filter((r) => r && r.status === "ready" && !judged.some((j) => j.id === r.id)))
      .map((j) => ({ id: j.id, kind: j.kind, key: j.key, value: j.value, label: j.label, live: j.live, setting: j.setting, diff: j.diff, start: j.start })),
    done: book.done.slice(-10).reverse().map((s) => ({ id: s.id, label: specLabel(s), start: s.start, end: s.end, status: s.result?.status ?? null, diff: s.result?.diff ?? null, trades: s.result?.trades ?? null, sessions: s.result?.sessions ?? null })),
    menu: Object.keys(KINDS),
  };
}
