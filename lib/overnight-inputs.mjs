// Builds the overnight scorer's inputs (lib/overnight-tone.mjs) from fetched
// price history. Pure: the Yahoo fetch lives in lib/overnight-fetch.mjs, so the
// smoke test can feed fixed bars and the bake can rebuild any past morning.
//
// Every move is measured from the PRIOR US CASH CLOSE (16:00 ET of the last
// completed US session) to the read time ("cutoff", 09:05 ET for the saved
// pre-open call). Rules per market kind:
//   24h      futures, FX, commodities, crypto: 15-minute bars, last bar that
//            ended at or before the prior close vs the last bar that ended at or
//            before the cutoff. No bar after the prior close = stale.
//   asia     Asian cash indexes and stocks: the latest daily session dated after
//            the prior US session and on or before the call date. None = stale
//            (holiday), so a market still showing an older session cannot vote.
//   europe   European cash indexes: today's intraday level at the cutoff vs the
//            previous European close. Only counted for a pre-open cutoff.
//   usx      US cash series that trade outside the bell only sometimes (cash VIX,
//            HYG/SPY pre-market): a print after the prior close is required.
//   level    context levels (VIX3M, VVIX, SKEW, MOVE): latest level, never vote.

import { OVERNIGHT_TONE } from "./overnight-tone.mjs";

export const OVERNIGHT_INTERVAL_MIN = 15;
export const OVERNIGHT_CUTOFF_ET = { h: 9, m: 5 };
export const US_OPEN_ET = { h: 9, m: 30 };
export const SIGMA_SESSIONS = 60;
export const ASIA_ECHO_SESSIONS = 120;

// Symbol registry (kind + name) lives in the shared scorer so the browser's
// snapshot read uses the same kinds.
export const OVERNIGHT_SYMBOLS = OVERNIGHT_TONE.SYMBOLS;
// Which symbols need 15-minute bars (the rest use daily bars only).
export const OVERNIGHT_INTRADAY_KINDS = new Set(["24h", "europe", "usx"]);
// US pre-market context rows (not votes, except HYG inside growth/credit).
export const PREMARKET_CONTEXT = ["SPY", "QQQ", "IWM", "SMH"];

const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

// ---- ET clock helpers --------------------------------------------------------
const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
});
export function etParts(ms) {
  const parts = Object.fromEntries(ET_FMT.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: parts.weekday,
  };
}
// UTC ms of an ET wall-clock time on an ET calendar date.
export function etWallMs(date, h, m = 0) {
  const guess = Date.parse(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  // ET is UTC-4 or UTC-5; try both and keep the one that maps back.
  for (const off of [4, 5]) {
    const ms = guess + off * 3600000;
    const p = etParts(ms);
    if (p.date === date && p.minutes === h * 60 + m) return ms;
  }
  return guess + 5 * 3600000;
}
export function usCloseMs(date) { return etWallMs(date, 16, 0); }
export function preOpenCutoffMs(date) { return etWallMs(date, OVERNIGHT_CUTOFF_ET.h, OVERNIGHT_CUTOFF_ET.m); }
export function isBeforeUsOpen(ms) {
  const p = etParts(ms);
  return p.minutes < US_OPEN_ET.h * 60 + US_OPEN_ET.m;
}

// The last completed US cash session at or before `nowMs`, from SPY daily bars.
export function priorUsSession(spyDaily, nowMs) {
  const bars = (spyDaily || []).filter((b) => b && b.t && Number.isFinite(b.c));
  for (let i = bars.length - 1; i >= 0; i--) {
    if (usCloseMs(bars[i].t) <= nowMs) {
      const prev = bars[i - 1];
      return {
        date: bars[i].t,
        closeMs: usCloseMs(bars[i].t),
        close: bars[i].c,
        pct: prev && prev.c ? round((bars[i].c / prev.c - 1) * 100, 3) : null,
      };
    }
  }
  return null;
}

// ---- statistics --------------------------------------------------------------
function pctChanges(daily) {
  const out = [];
  for (let i = 1; i < daily.length; i++) {
    const a = daily[i - 1]?.c, b = daily[i]?.c;
    if (a > 0 && b > 0) out.push({ t: daily[i].t, r: (b / a - 1) * 100 });
  }
  return out;
}
function stdev(xs) {
  if (xs.length < 2) return null;
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}
// Daily % volatility from bars strictly before `beforeDate` (no look-ahead).
export function sigmaPct(daily, beforeDate = null, n = SIGMA_SESSIONS) {
  const bars = (daily || []).filter((b) => b && b.t && (!beforeDate || b.t < beforeDate));
  const r = pctChanges(bars).slice(-n).map((x) => x.r);
  if (r.length < 15) return null;
  return round(stdev(r), 4);
}

// Asia's broad-index average vs the prior US session's SPY move: Asia mostly
// replays the US day it follows. beta + the residual's volatility let the
// scorer vote only the part of Asia's move the US day did not already explain.
export function fitAsiaEcho(asiaDailyBySym, spyDaily, beforeDate = null, n = ASIA_ECHO_SESSIONS) {
  const spy = pctChanges((spyDaily || []).filter((b) => b && b.t && (!beforeDate || b.t < beforeDate)));
  if (spy.length < 30) return null;
  const byDate = new Map();
  for (const sym of OVERNIGHT_TONE.ASIA_BROAD) {
    for (const x of pctChanges(asiaDailyBySym?.[sym] || [])) {
      if (beforeDate && x.t >= beforeDate) continue;
      const row = byDate.get(x.t) || [];
      row.push(x.r);
      byDate.set(x.t, row);
    }
  }
  const pairs = [];
  const spyDates = spy.map((s) => s.t);
  for (const [d, rs] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (rs.length < 2) continue;
    // Prior US session: the last SPY date strictly before the Asian date.
    let j = -1;
    for (let k = spyDates.length - 1; k >= 0; k--) if (spyDates[k] < d) { j = k; break; }
    if (j < 0) continue;
    // Skip when the US session is more than 4 days back (long holidays).
    if ((Date.parse(d) - Date.parse(spyDates[j])) / 86400000 > 4) continue;
    pairs.push({ x: spy[j].r, y: rs.reduce((s, v) => s + v, 0) / rs.length });
  }
  const use = pairs.slice(-n);
  if (use.length < 30) return null;
  const mx = use.reduce((s, p) => s + p.x, 0) / use.length;
  const my = use.reduce((s, p) => s + p.y, 0) / use.length;
  let sxy = 0, sxx = 0;
  for (const p of use) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; }
  if (!(sxx > 0)) return null;
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  const resid = use.map((p) => p.y - alpha - beta * p.x);
  return { beta: round(beta, 3), residSigmaPct: round(stdev(resid), 4), n: use.length };
}

// ---- per-kind move rules -----------------------------------------------------
const barEnd = (b) => b.ms + OVERNIGHT_INTERVAL_MIN * 60000;

// Last close at or before `atMs` from 15-minute bars (bar END time).
function closeAt(intraday, atMs, notBeforeMs = -Infinity) {
  let out = null;
  for (const b of intraday || []) {
    if (!b || !Number.isFinite(b.c)) continue;
    const end = barEnd(b);
    if (end <= atMs && end > notBeforeMs) out = b;
  }
  return out;
}

function move24h(intraday, priorCloseMs, cutoffMs) {
  const base = closeAt(intraday, priorCloseMs, priorCloseMs - 4 * 86400000);
  const cur = closeAt(intraday, cutoffMs, priorCloseMs);
  if (!base) return { fresh: false, staleWhy: "no price at the prior US close" };
  if (!cur) return { fresh: false, staleWhy: "no trade since the prior US close" };
  return { fresh: true, movePct: round((cur.c / base.c - 1) * 100, 3), level: cur.c };
}

function moveAsia(daily, prior, callDate) {
  const bars = (daily || []).filter((b) => b && b.t && Number.isFinite(b.c));
  let idx = -1;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].t > prior.date && bars[i].t <= callDate) { idx = i; break; }
  }
  if (idx < 1) {
    const last = bars.length ? bars[bars.length - 1].t : null;
    return { fresh: false, staleWhy: last ? `closed since ${last} (holiday or no session yet)` : "no session data" };
  }
  return { fresh: true, movePct: round((bars[idx].c / bars[idx - 1].c - 1) * 100, 3), level: bars[idx].c, sessionDate: bars[idx].t };
}

function moveEurope(daily, intraday, callDate, cutoffMs) {
  if (!isBeforeUsOpen(cutoffMs)) return { fresh: false, staleWhy: "Europe trades with the US morning; counted only before the open" };
  const prev = (daily || []).filter((b) => b && b.t && b.t < callDate && Number.isFinite(b.c)).pop();
  const dayStart = etWallMs(callDate, 0, 0);
  const cur = closeAt(intraday, cutoffMs, dayStart);
  if (!prev || !cur) return { fresh: false, staleWhy: "no European trade yet today" };
  return { fresh: true, movePct: round((cur.c / prev.c - 1) * 100, 3), level: cur.c };
}

function moveUsx(intraday, prior, cutoffMs, closeLagMin = 0) {
  const after = prior.closeMs + closeLagMin * 60000;
  const cur = closeAt(intraday, cutoffMs, after);
  const base = closeAt(intraday, after, prior.closeMs - 4 * 86400000);
  if (!cur) return { fresh: false, staleWhy: "no print since the prior US close" };
  if (!base) return { fresh: false, staleWhy: "no price at the prior US close" };
  return { fresh: true, movePct: round((cur.c / base.c - 1) * 100, 3), level: cur.c };
}

// ES overnight range and volume vs the same window on the previous 5 nights.
export function esOvernightRange(intraday, prior, cutoffMs, history = []) {
  const win = (from, to) => (intraday || []).filter((b) => b && barEnd(b) > from && barEnd(b) <= to);
  const bars = win(prior.closeMs, cutoffMs);
  if (!bars.length) return null;
  const hi = Math.max(...bars.map((b) => b.h ?? b.c));
  const lo = Math.min(...bars.map((b) => b.l ?? b.c));
  const base = closeAt(intraday, prior.closeMs, prior.closeMs - 4 * 86400000)?.c;
  const vol = bars.reduce((s, b) => s + (Number(b.v) || 0), 0);
  const prevVols = [];
  for (const h of history) {
    const v = win(h.fromMs, h.toMs).reduce((s, b) => s + (Number(b.v) || 0), 0);
    if (v > 0) prevVols.push(v);
  }
  const avgPrev = prevVols.length ? prevVols.reduce((s, v) => s + v, 0) / prevVols.length : null;
  return {
    rangePct: base ? round(((hi - lo) / base) * 100, 2) : null,
    high: round(hi, 2), low: round(lo, 2),
    volume: vol || null,
    volumeVsAvg: avgPrev && vol ? round(vol / avgPrev, 2) : null,
  };
}

// Build scorer inputs for the US session `callDate` read at `cutoffMs`.
// series: { [sym]: { daily:[{t,c,o?}], intraday:[{ms,c,h,l,v}] } }
export function buildOvernightInputs({ series, callDate, cutoffMs }) {
  const spyDaily = series?.SPY?.daily || [];
  const prior = priorUsSession(spyDaily.filter((b) => b.t < callDate), cutoffMs);
  if (!prior) return null;
  const inputs = {};
  for (const [sym, meta] of Object.entries(OVERNIGHT_SYMBOLS)) {
    const s = series?.[sym];
    if (!s) continue;
    const daily = (s.daily || []).filter((b) => b && b.t);
    let r;
    if (meta.kind === "24h") r = move24h(s.intraday, prior.closeMs, cutoffMs);
    else if (meta.kind === "asia") r = moveAsia(daily, prior, callDate);
    else if (meta.kind === "europe") r = moveEurope(daily, s.intraday, callDate, cutoffMs);
    else if (meta.kind === "usx") r = moveUsx(s.intraday, prior, cutoffMs, sym === "^VIX" ? 15 : 0);
    else {
      const last = daily.filter((b) => b.t <= callDate).pop();
      r = last ? { fresh: false, staleWhy: "context level", level: last.c } : null;
    }
    if (!r) continue;
    if (r.level == null) {
      const last = daily.filter((b) => b.t <= prior.date).pop();
      if (last) r.level = last.c;
    }
    inputs[sym] = {
      name: meta.name,
      kind: meta.kind,
      ...r,
      sigmaPct: sigmaPct(daily, callDate),
      ...(r.level != null ? { level: round(r.level, 4) } : {}),
    };
  }
  const asiaDaily = {};
  for (const sym of OVERNIGHT_TONE.ASIA_BROAD) asiaDaily[sym] = series?.[sym]?.daily || [];
  const asiaEcho = fitAsiaEcho(asiaDaily, spyDaily, callDate);
  // ES overnight range vs the previous 5 nights.
  const spyDates = spyDaily.filter((b) => b.t < callDate).map((b) => b.t);
  const history = [];
  for (let i = spyDates.length - 1; i >= 1 && history.length < 5; i--) {
    if (spyDates[i] === prior.date) continue;
    if (spyDates[i] > prior.date) continue;
    history.push({ fromMs: usCloseMs(spyDates[i - 1]), toMs: preOpenCutoffMs(spyDates[i]) });
  }
  const esRange = esOvernightRange(series?.["ES=F"]?.intraday, prior, cutoffMs, history);
  return { inputs, prior, asiaEcho, esRange };
}

// Today's overnight events: US data before the open, FOMC, and Asian/Australian
// central bank decisions that land in the overnight session before this US day.
// Asian holidays come from the stale-market list.
// Official schedules: BOJ (boj.or.jp, Statement on Monetary Policy dates; the
// decision is announced on the second day around 12:00 JST, the night before
// in ET), RBA 2026 (rba.gov.au media release 25-02; 14:30 AEST on the second
// day). PBOC sets the Loan Prime Rate on the 20th of each month (next business
// day when the 20th is a weekend), 09:15 Beijing time. Extend these lists when
// the banks publish new years.
export const BOJ_DECISION_DATES = [
  "2026-10-30", "2026-12-18",
  "2027-01-22", "2027-03-18", "2027-04-28", "2027-06-11", "2027-07-22", "2027-09-22", "2027-10-29", "2027-12-17",
];
export const RBA_DECISION_DATES = [
  "2026-02-03", "2026-03-17", "2026-05-05", "2026-06-16", "2026-08-11", "2026-09-29", "2026-11-03", "2026-12-08",
];
export const CB_SCHEDULE_THROUGH = { boj: "2027-12-17", rba: "2026-12-08" };
export function pbocLprDate(year, month) {
  const d = new Date(Date.UTC(year, month - 1, 20));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const EARLY_US_REPORTS = /^(nfp|unrate|cpi-|core-cpi-|ppi-|gdp|core-pce|durable-goods|retail|jobless|claims)/;
export function overnightEvents({ callDate, calendar = null, excluded = [] } = {}) {
  const out = [];
  if (BOJ_DECISION_DATES.includes(callDate)) out.push({ kind: "central-bank", label: "Bank of Japan decision overnight" });
  if (RBA_DECISION_DATES.includes(callDate)) out.push({ kind: "central-bank", label: "RBA decision overnight" });
  const [y, m] = callDate.split("-").map(Number);
  if (pbocLprDate(y, m) === callDate) out.push({ kind: "central-bank", label: "PBOC loan prime rate set overnight" });
  for (const ev of calendar?.events || []) {
    if (!ev || String(ev.date) !== callDate) continue;
    if (ev.type === "fomc") out.push({ kind: "us-event", label: "FOMC decision today (2:00 PM ET)" });
    else if (ev.type === "report" && EARLY_US_REPORTS.test(String(ev.subtype || ""))) {
      out.push({ kind: "us-data", label: `${ev.title || ev.subtype} before the open (8:30 AM ET)` });
    }
  }
  const closed = excluded.filter((x) => OVERNIGHT_SYMBOLS[x.sym]?.kind === "asia" && /^closed since/.test(x.why || ""));
  if (closed.length) out.push({ kind: "holiday", label: `Closed overnight: ${closed.map((x) => x.name).join(", ")}` });
  const seen = new Set();
  return out.filter((e) => (seen.has(e.label) ? false : (seen.add(e.label), true)));
}

// One pre-open call for `callDate`, read at `cutoffMs`. reconstructed=true
// when the bake rebuilt it later from bars rather than the live 09:00 ET job.
export function buildOvernightCall({ series, callDate, cutoffMs, calendar = null, stats = null, capturedAtIso = null, reconstructed = false, premarket = null }) {
  const built = buildOvernightInputs({ series, callDate, cutoffMs });
  if (!built) return null;
  const { inputs, prior, asiaEcho, esRange } = built;
  const tone = OVERNIGHT_TONE.scoreTone(inputs, { asiaEcho, priorUsPct: prior.pct });
  const events = overnightEvents({ callDate, calendar, excluded: tone.excluded });
  const pre = {};
  for (const sym of PREMARKET_CONTEXT) {
    const i = inputs[sym];
    if (i && i.fresh) pre[sym] = i.movePct;
  }
  const context = {};
  for (const sym of OVERNIGHT_TONE.CONTEXT) {
    const i = inputs[sym];
    if (i) context[sym] = { level: i.level ?? null, movePct: i.fresh ? i.movePct : null };
  }
  const compactInputs = {};
  for (const [sym, i] of Object.entries(inputs)) {
    compactInputs[sym] = { m: i.fresh ? i.movePct : null, s: i.sigmaPct, f: !!i.fresh, ...(i.level != null ? { l: i.level } : {}) };
  }
  return {
    date: callDate,
    version: OVERNIGHT_TONE.VERSION,
    capturedAtIso: capturedAtIso || new Date(cutoffMs).toISOString(),
    cutoffIso: new Date(cutoffMs).toISOString(),
    reconstructed: !!reconstructed,
    prior: { date: prior.date, spyPct: prior.pct },
    asiaEcho,
    tone,
    session: OVERNIGHT_TONE.sessionCall(tone, stats),
    events,
    esRange,
    premarket: { indexes: pre, ...(premarket || {}) },
    context,
    inputs: compactInputs,
  };
}
