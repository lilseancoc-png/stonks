// The daily Webull data runner (2026-11-19, docs/webull-data.md).
//
// The Vercel action `webull-data` (api/auth/[action].js) calls
// runWebullData() once per ping from .github/workflows/webull-data.yml. Each
// call works for at most ~40 seconds, keeps every endpoint group under its
// per-minute cap (24 by default: Webull's paper keys allow 30), saves the
// cursor and returns { more, waitMs, counts }. The workflow pings again until
// `more` is false or 50 minutes pass.
//
// Jobs (lib/webull-data/jobs/<id>.mjs, listed in jobs/index.mjs) share one
// small interface:
//   { id, switchKey, group, rpm?,
//     plan(state, ctx)            -> items for the queue ([] = done for the day)
//     run(item, client, ctx)      -> records, or { records, more: [items] }
//     save(records, store, ctx)   -> optional { more: [items] } }
// One item is one Webull call (item.group overrides job.group; group null =
// local work, no call). `more` goes to the front of the job's queue. `state`
// is the job's own object, kept across days (also ctx.state in run/save);
// mutate it freely. The runner
// keeps each job's queue and the per-group call times in the cursor, so a
// later ping carries on where this one stopped.
import { etClock, sessionForDate, previousTradingDate } from "../us-equity-calendar.mjs";
import { webullDataKeys, readGz, writeGz } from "./store.mjs";
import { WEBULL_DATA_TICKERS, WEBULL_DATA_FUNDS } from "./universe.mjs";

export const RUNNER_VERSION = 1;
export const DEFAULT_RPM = 24;           // per endpoint group per minute (Webull paper: 30)
export const DEFAULT_BUDGET_MS = 40000;  // work per ping; the function's limit is 60 s
const WINDOW_MS = 60000;
const COOL_MS = 60000;                   // after an HTTP 429
const MAX_ATTEMPTS = 3;
const SCAN = 400;                        // queue items scanned for one whose group may call now
const HISTORY_DAYS = 40;

// The ET session date being saved and whether it is the closing read. A run
// before the open or on a closed day saves the previous session.
export function sessionOf(nowMs) {
  const clock = etClock(nowMs), today = sessionForDate(clock.date);
  if (today?.open && clock.minute >= today.openMinute) {
    return { date: clock.date, phase: clock.minute >= today.closeMinute ? "close" : "intraday" };
  }
  const prev = previousTradingDate(clock.date);
  return prev ? { date: prev, phase: "close" } : null;
}

export function emptyState() {
  return { v: RUNNER_VERSION, dayKey: null, date: null, phase: null, startedAtIso: null, updatedAtIso: null, finishedAtIso: null,
    invocations: 0, msUsed: 0, counts: {}, misses: {}, jobs: {}, rate: {}, history: [] };
}

// Per-group call limiter over the saved call times.
export function makeLimiter(rate, rpmOf) {
  const live = (g, now) => {
    const r = rate[g] || (rate[g] = { calls: [], coolUntil: 0 });
    r.calls = r.calls.filter((t) => now - t < WINDOW_MS);
    return r;
  };
  return {
    waitMs(g, now) {
      if (g == null) return 0;
      const r = live(g, now), cap = rpmOf(g);
      if (now < r.coolUntil) return r.coolUntil - now;
      if (r.calls.length < cap) return 0;
      return Math.max(1, WINDOW_MS - (now - r.calls[r.calls.length - cap]));
    },
    record(g, now) { if (g != null) live(g, now).calls.push(now); },
    cool(g, now) { if (g != null) live(g, now).coolUntil = now + COOL_MS; },
  };
}

const isRateLimited = (err) => err?.status === 429 || /rate.?limit|too many/i.test(String(err?.code || "") + " " + String(err?.message || ""));
// Fixed words for the public log and the status block, never Webull's text.
const errorLabel = (err) => err?.status === 429 ? "rate limited" : err?.code === "NETWORK" ? "network" : err?.status === 401 || err?.status === 403 ? "permission" : err?.status === 417 ? "rejected" : err?.status >= 500 ? "webull server" : err?.name === "WebullError" ? "webull" : "code";

// `switchOn(key)` says whether a job's switch is on. `jobs` in run order.
export async function runWebullData({ client, store, jobs, switchOn = () => true, nowFn = Date.now, budgetMs = DEFAULT_BUDGET_MS, options = {}, guard = () => {}, reset = false } = {}) {
  const t0 = nowFn();
  const session = sessionOf(t0);
  if (!session) return { ran: false, reason: "calendar unknown" };
  let state = (reset ? null : await readGz(store, webullDataKeys.state()).catch(() => null)) || emptyState();
  if (state.v !== RUNNER_VERSION) state = { ...emptyState(), history: Array.isArray(state.history) ? state.history : [] };
  const dayKey = `${session.date}:${session.phase}`;
  // A new session (or the closing read after an intraday one) starts a new
  // day: the old day's summary goes to the history, queues start empty.
  if (state.dayKey !== dayKey) {
    if (state.dayKey) state.history = [summaryOf(state), ...(state.history || []).filter((h) => h.dayKey !== state.dayKey)].slice(0, HISTORY_DAYS);
    const keepJobs = Object.fromEntries(Object.entries(state.jobs || {}).map(([id, j]) => [id, { state: j?.state || {} }]));
    state = { ...emptyState(), history: state.history || [], rate: state.rate || {}, jobs: keepJobs,
      dayKey, date: session.date, phase: session.phase, startedAtIso: new Date(t0).toISOString() };
  }
  state.invocations += 1;
  const counts = {};
  const count = (name, n = 1) => { counts[name] = (counts[name] || 0) + n; state.counts[name] = (state.counts[name] || 0) + n; };
  const miss = (label, n = 1) => { state.misses[label] = (state.misses[label] || 0) + n; count("misses", n); };
  // The covered names (options.tickers narrows them for a test or a manual run).
  const tickers = Array.isArray(options.tickers) && options.tickers.length ? options.tickers.filter((s) => WEBULL_DATA_TICKERS.includes(s) || options.anyTicker) : WEBULL_DATA_TICKERS;
  const ctx = { date: session.date, phase: session.phase, nowMs: t0, store, options, count, miss, tickers, funds: WEBULL_DATA_FUNDS };
  const rpmOf = (g) => Math.max(1, Math.min(DEFAULT_RPM, ...jobs.filter((j) => j.group === g && j.rpm).map((j) => j.rpm)));
  const limiter = makeLimiter(state.rate, rpmOf);
  const enabled = jobs.filter((j) => switchOn(j.switchKey));
  for (const j of jobs) {
    const js = state.jobs[j.id] || (state.jobs[j.id] = { state: {} });
    js.queue = Array.isArray(js.queue) ? js.queue : [];
    if (!enabled.includes(j)) js.off = true; else delete js.off;
  }
  let lastSave = nowFn(), sinceSave = 0;
  const persist = async () => { guard(); state.updatedAtIso = new Date(nowFn()).toISOString(); await writeGz(store, webullDataKeys.state(), state); lastSave = nowFn(); sinceSave = 0; };
  let waitMs = 0;
  while (nowFn() - t0 < budgetMs) {
    let pick = null, minWait = Infinity;
    for (const job of enabled) {
      const js = state.jobs[job.id];
      if (js.done) continue;
      if (!js.queue.length) {
        const items = await job.plan(js.state, { ...ctx, nowMs: nowFn(), state: js.state });
        if (!Array.isArray(items) || !items.length) { js.done = true; continue; }
        js.queue = items;
      }
      const now = nowFn();
      const n = Math.min(js.queue.length, SCAN);
      for (let i = 0; i < n; i++) {
        const g = js.queue[i]?.group !== undefined ? js.queue[i].group : job.group;
        const w = limiter.waitMs(g, now);
        if (w === 0) { pick = { job, js, i, group: g }; break; }
        minWait = Math.min(minWait, w);
      }
      if (pick) break;
    }
    if (!pick) { waitMs = Number.isFinite(minWait) ? minWait : 0; break; }
    const { job, js, i, group } = pick;
    const [item] = js.queue.splice(i, 1);
    const now = nowFn();
    limiter.record(group, now);
    if (group != null) count("calls"), count(`calls:${group}`);
    let out;
    try {
      out = await job.run(item, client, { ...ctx, nowMs: now, state: js.state });
    } catch (err) {
      if (isRateLimited(err)) { limiter.cool(group, nowFn()); js.queue.unshift(item); count("rate-limited"); continue; }
      const attempts = (item.attempts || 0) + 1;
      if (attempts < MAX_ATTEMPTS && err?.status !== 417) js.queue.push({ ...item, attempts });
      else miss(`${job.id}: ${errorLabel(err)}`);
      count("errors");
      continue;
    }
    const records = out && typeof out === "object" && !Array.isArray(out) && ("records" in out || "more" in out) ? out.records : out;
    if (out && Array.isArray(out.more) && out.more.length) js.queue.unshift(...out.more);
    const saved = await job.save(records, store, { ...ctx, nowMs: nowFn(), state: js.state });
    if (saved && Array.isArray(saved.more) && saved.more.length) js.queue.unshift(...saved.more);
    sinceSave++;
    if (sinceSave >= 25 || nowFn() - lastSave > 15000) await persist();
  }
  const finished = enabled.every((j) => state.jobs[j.id].done);
  if (finished && !state.finishedAtIso) state.finishedAtIso = new Date(nowFn()).toISOString();
  state.msUsed += nowFn() - t0;
  await persist();
  return { ran: true, more: !finished, waitMs: finished ? 0 : Math.min(waitMs, 60000), date: session.date, phase: session.phase, counts,
    day: { counts: state.counts, invocations: state.invocations, msUsed: state.msUsed, misses: state.misses } };
}

export function summaryOf(state) {
  return { dayKey: state.dayKey, date: state.date, phase: state.phase, startedAtIso: state.startedAtIso, finishedAtIso: state.finishedAtIso,
    updatedAtIso: state.updatedAtIso, invocations: state.invocations, msUsed: state.msUsed, counts: state.counts || {}, misses: state.misses || {},
    pending: Object.fromEntries(Object.entries(state.jobs || {}).map(([id, j]) => [id, j.off ? "off" : j.done ? 0 : (j.queue || []).length])) };
}

// The Owner status block's view: today, the last 40 days, totals.
export function statusView(state, { switches = {} } = {}) {
  const s = state && state.v === RUNNER_VERSION ? state : emptyState();
  const today = s.dayKey ? summaryOf(s) : null;
  const days = [today, ...(s.history || [])].filter(Boolean);
  const total = (k) => days.reduce((a, d) => a + (Number(d.counts?.[k]) || 0), 0);
  return {
    switches,
    lastRunIso: s.updatedAtIso,
    today,
    days: days.slice(0, HISTORY_DAYS),
    totals: { days: new Set(days.filter((d) => (d.counts?.["snapshot-names"] || 0) > 0).map((d) => d.date)).size,
      contracts: total("snapshot-contracts"), expired: total("expired-saved"), gone: total("expired-gone"), misses: total("misses"), calls: total("calls") },
  };
}
