// Strategy engines: macro factors. Turns the FRED series the site already
// caches (yields, financial conditions, the dollar, fed funds, CPI,
// unemployment) plus the VIX curve into the handful of numbers the Macro
// engine trades on, and into the "macro environment" tags every engine's
// record and history test are split by.
//
// Each series is read with its real publication lag, so a decision on day D
// only sees what was public on day D; the live bake and the history test use
// the same lags. Pure. No network, no AI.

import { vixTrack } from "./hedge.mjs";

const DAY = 86400000;
const fin = (x) => typeof x === "number" && Number.isFinite(x);

// Calendar days between an observation's date and the day it is public.
export const SERIES_LAG_DAYS = Object.freeze({
  DGS10: 2, DGS2: 2, T10Y2Y: 2, DFF: 2, VIXCLS: 1,
  NFCI: 6, DTWEXBGS: 7, CPIAUCSL: 45, UNRATE: 40, USREC: 0,
});

function normalize(series) {
  if (!series) return null;
  let t, v;
  if (Array.isArray(series)) { t = series.map((r) => r?.t ?? r?.date); v = series.map((r) => Number(r?.v ?? r?.value ?? r?.c)); }
  else { t = series.t || []; v = (series.v || series.c || []).map(Number); }
  const rows = [];
  for (let i = 0; i < t.length; i++) if (t[i] && fin(v[i])) rows.push([String(t[i]).slice(0, 10), v[i]]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rows.length ? { t: rows.map((r) => r[0]), v: rows.map((r) => r[1]) } : null;
}
function idxAtOrBefore(t, date) {
  let lo = 0, hi = t.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (t[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
const shift = (date, days) => new Date(Date.parse(date + "T12:00:00Z") + days * DAY).toISOString().slice(0, 10);

// fred: { ID: {t,v} | [{t,v}] }, vix / vix3m: daily closes (bars or {t,v}),
// events: [{ date, kind: "fomc" | "cpi" | "jobs" }].
//
// live: { date, vix, vix3m } (2026-11-22, ENGINES_LIVE_VIX): the bake's own
// VIX / VIX3M quote for the decision day. A decision on that date then reads
// VIX through that day (the quote) instead of through the prior close; every
// other date, and the history test (no live), keep the prior-close rule.
export function buildMacro({ fred = {}, vix = null, vix3m = null, events = [], live = null } = {}) {
  const S = {};
  for (const [id, s] of Object.entries(fred || {})) { const n = normalize(s); if (n) S[id] = n; }
  let V = normalize(vix) || S.VIXCLS || null, V3 = normalize(vix3m);
  const liveDate = live?.date && fin(Number(live.vix)) && Number(live.vix) > 0 ? String(live.date).slice(0, 10) : null;
  const withPoint = (s, date, value) => {
    const t = (s?.t || []).filter((d) => d < date), v = (s?.v || []).slice(0, t.length);
    return { t: [...t, date], v: [...v, value] };
  };
  if (liveDate) {
    V = withPoint(V, liveDate, Number(live.vix));
    if (fin(Number(live.vix3m)) && Number(live.vix3m) > 0) V3 = withPoint(V3, liveDate, Number(live.vix3m));
  }
  // The last VIX date a decision during `date` may read.
  const volDate = (date) => (date === liveDate ? date : shift(date, -1));
  const ev = (events || []).filter((e) => e?.date && e?.kind).map((e) => ({ date: String(e.date).slice(0, 10), kind: e.kind })).sort((a, b) => (a.date < b.date ? -1 : 1));
  // The VIX pause and rollover reads (the VIX and rates pack, 2026-11-21),
  // worked out once over the whole series.
  let track = null;
  const vixRead = (date) => {
    if (!V) return null;
    track ||= vixTrack(V);
    return track.at(idxAtOrBefore(V.t, volDate(date)));
  };
  const evDates = new Map();
  for (const e of ev) evDates.set(e.date, evDates.has(e.date) ? `${evDates.get(e.date)}+${e.kind}` : e.kind);

  const at = (id, date, extraLag = 0) => {
    const s = S[id]; if (!s) return null;
    const i = idxAtOrBefore(s.t, shift(date, -((SERIES_LAG_DAYS[id] ?? 2) + extraLag)));
    return i < 0 ? null : s.v[i];
  };
  const chg = (id, date, days) => { const a = at(id, date), b = at(id, date, days); return fin(a) && fin(b) ? a - b : null; };
  const volAt = (s, date, back = 0) => {
    if (!s) return null;
    // The VIX close through the prior session (a decision during D reads
    // D-1), or today's quote on the live date.
    const i = idxAtOrBefore(s.t, volDate(date)) - back;
    return i < 0 ? null : s.v[i];
  };

  // The factor row for a decision made during `date`.
  function factors(date) {
    const y10 = at("DGS10", date), y2 = at("DGS2", date);
    const curve = at("T10Y2Y", date) ?? (fin(y10) && fin(y2) ? y10 - y2 : null);
    const nfci = at("NFCI", date);
    let nfciMed = null;
    if (S.NFCI) {
      const i = idxAtOrBefore(S.NFCI.t, shift(date, -SERIES_LAG_DAYS.NFCI));
      if (i >= 26) { const w = S.NFCI.v.slice(Math.max(0, i - 51), i + 1).slice().sort((a, b) => a - b); nfciMed = w[Math.floor(w.length / 2)]; }
    }
    const usd = at("DTWEXBGS", date), usdPrev = at("DTWEXBGS", date, 28);
    const dff = at("DFF", date), dffPrev = at("DFF", date, 182);
    // The T-bill return over the last 12 months, approximated by the average
    // fed funds rate (sampled every 30 days), in %. The core engines compare
    // a fund's 12-month return with it.
    const dffs = []; for (let k = 0; k < 12; k++) { const v = at("DFF", date, k * 30); if (fin(v)) dffs.push(v); }
    const cash12 = dffs.length >= 9 ? dffs.reduce((a, b) => a + b, 0) / dffs.length : null;
    const cpi = at("CPIAUCSL", date), cpiPrev = at("CPIAUCSL", date, 365);
    const vixNow = volAt(V, date), vix3 = volAt(V3, date);
    const ratio = (b) => { const a = volAt(V, date, b), c = volAt(V3, date, b); return fin(a) && fin(c) && c > 0 ? a / c : null; };
    const r0 = ratio(0), r1 = ratio(1);
    let invertedIn10 = false;
    for (let b = 1; b <= 10; b++) { const r = ratio(b); if (fin(r) && r >= 1) { invertedIn10 = true; break; } }
    const vr = vixRead(date);
    return {
      date,
      y10, y10Chg: fin(chg("DGS10", date, 28)) ? Math.round(chg("DGS10", date, 28) * 100) : null,   // bp over ~20 sessions
      y2, curve, curveChg: fin(chg("T10Y2Y", date, 28)) ? Math.round(chg("T10Y2Y", date, 28) * 100) : null,
      nfci, nfciChg: chg("NFCI", date, 28), nfciMed,
      usd, usdChgPct: fin(usd) && fin(usdPrev) && usdPrev > 0 ? (usd / usdPrev - 1) * 100 : null,
      dff, dffChg: fin(dff) && fin(dffPrev) ? dff - dffPrev : null, cash12,
      cpiYoy: fin(cpi) && fin(cpiPrev) && cpiPrev > 0 ? (cpi / cpiPrev - 1) * 100 : null,
      unrate: at("UNRATE", date),
      vix: vixNow, vixLive: date === liveDate, vix3m: vix3, vixRatio: r0, vixInverted2: fin(r0) && fin(r1) && r0 >= 1 && r1 >= 1, vixInvertedIn10: invertedIn10,
      recession: S.USREC ? at("USREC", date) === 1 : null,
      // The VIX and rates pack (2026-11-21, lib/engines/hedge.mjs): the VIX
      // pause state through the prior close, the 50-day average and the
      // 5-session change, the rollover event, and the 2-year minus fed funds.
      vixAvg50: vr?.avg50 ?? null, vixChg5: vr?.chg5 ?? null, vixHold: vr ? vr.hold : null, vixHoldSince: vr?.since ?? null,
      vixPeak10: vr?.peak10 ?? null, vixRoll: vr?.roll ? vr.date : null,
      hikeGap: fin(y2) && fin(dff) ? Math.round((y2 - dff) * 100) / 100 : null,
    };
  }

  // Tags the records and the history test are split by.
  function env(date, f = factors(date)) {
    return {
      rates: !fin(f.dffChg) ? null : f.dffChg >= 0.25 ? "hiking" : f.dffChg <= -0.25 ? "cutting" : "on hold",
      inflation: !fin(f.cpiYoy) ? null : f.cpiYoy >= 4 ? "high (4%+)" : f.cpiYoy >= 2.5 ? "above target" : "low",
      conditions: !fin(f.nfci) ? null : f.nfci >= 0 ? "tight" : f.nfci <= -0.5 ? "loose" : "normal",
      curve: !fin(f.curve) ? null : f.curve < 0 ? "inverted" : f.curve < 0.5 ? "flat" : "steep",
      vix: !fin(f.vix) ? null : f.vix >= 30 ? "30+" : f.vix >= 20 ? "20-30" : f.vix >= 15 ? "15-20" : "under 15",
      recession: f.recession == null ? null : f.recession ? "recession" : "expansion",
    };
  }

  // The macro event (if any) dated `date`, and the next one after it.
  const eventOn = (date) => evDates.get(date) || null;
  const nextEvent = (date) => ev.find((e) => e.date >= date) || null;
  return { factors, env, eventOn, nextEvent, events: ev, has: (id) => !!S[id], series: S };
}

// The jobs report is the first Friday of the month (BLS rule). Used only by
// the history test when no real release calendar is on hand; the live bake
// reads the real dates.
export function firstFridays(fromYear, toYear) {
  const out = [];
  for (let y = fromYear; y <= toYear; y++) for (let m = 0; m < 12; m++) {
    const d = new Date(Date.UTC(y, m, 1));
    while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// The Fear & Greed reading a run may act on (the index-fear paper trial,
// 2026-11-19): the last two daily closes dated before `today`, so a run
// decides on confirmed numbers only, the way the history test does. `rows`
// are [date, score, ...] arrays (the score is always the second column; a
// row may carry extra columns after it, such as the research kit's
// [date, score, vix]) or { date, score } objects, in any order (the bake's
// fear-greed-history.json snapshots, or a research file). Null when the
// newest close is more than 5 calendar days old or there are not two.
export function fearReading(rows, today) {
  if (!Array.isArray(rows) || !today) return null;
  const pts = [];
  for (const r of rows) {
    const date = Array.isArray(r) ? r[0] : r?.date, score = Number(Array.isArray(r) ? r[1] : r?.score);
    if (typeof date === "string" && date < today && Number.isFinite(score)) pts.push([date.slice(0, 10), score]);
  }
  if (pts.length < 2) return null;
  pts.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const [d1, s1] = pts[pts.length - 1], [d0, s0] = pts[pts.length - 2];
  if ((Date.parse(today + "T12:00:00Z") - Date.parse(d1 + "T12:00:00Z")) / 86400000 > 5) return null;
  return { date: d1, score: s1, prevDate: d0, prev: s0 };
}
