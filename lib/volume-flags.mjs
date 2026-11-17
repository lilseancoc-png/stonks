// Intraday volume + support/resistance break classifier.
//
// Pure functions. No IO, no Yahoo/Gemini, no fs. Single source: the hourly
// scanner (scripts/scan-unusual.mjs) precomputes every flag into
// data/volume-flags.json and the browser only renders that file, so there
// is no browser copy to keep in step (CLAUDE.md "Math is duplicated on
// purpose" lists this module as the exception).
//
// Measured curve (2026-11-17 audit): by default the scanner no longer uses
// the fixed curve below. Over 14 sessions of the scanner's own readings the
// median stock had traded 16.7% of its day by the 10:00 ET scan (the fixed
// curve expects 12.5%) and 76% by 15:00 (expected 83%), so a normal stock
// read 1.33x at 10:00 and about 0.7x at 15:00. MEASURED_CURVE_SEED is that
// measurement; the scanner then re-measures it from its own last 20 sessions
// (learnCurveDay / curveFromDays). VOLUME_MEASURED_CURVE=0 restores the
// fixed curve.
//
// Fixed curve (the original spec, kept as the fallback). Empirically the US
// session is U-shaped. Per the spec we use this weighted curve over the
// 390-minute regular session (9:30 - 16:00 ET):
//
//   Hour 1   9:30 - 10:30   25%
//   Hour 2  10:30 - 11:30   14%
//   Hour 3  11:30 - 12:30   11%
//   Hour 4  12:30 - 13:30   11%
//   Hour 5  13:30 - 14:30   14%
//   Hour 6  14:30 - 16:00   25%   (90 minutes)
//
// We don't force the hourly cron to fire at :30 past the hour — instead
// we evaluate a cumulative-fraction curve so the scanner can call from
// any clock time and still compute "expected cumulative volume by now"
// and "expected volume in the last hour" with the correct distribution.

export const SESSION_OPEN_MIN = 0;      // 9:30 ET
export const SESSION_CLOSE_MIN = 390;   // 16:00 ET
export const EARLY_CLOSE_MIN = 210;     // 13:00 ET (NYSE half days)

// NYSE early-close (13:00 ET) sessions, by deterministic rule: July 3 when a
// weekday, the day after Thanksgiving, and Dec 24 when a weekday. (When Jul 4 /
// Dec 25 fall on Saturday the "half day" is actually the observed full-day
// holiday — no session, so a mislabel is vacuous: there's no tape to evaluate.)
// Without this, a 13:00-close afternoon compared ~zero actual volume against a
// full-session expectation — labeling legitimate half-day breakouts "Likely
// Fakeout" and halving every EOD ratio.
export function isEarlyCloseDate(dateKey) {
  if (typeof dateKey !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // date-only → stable
  if (mo === 7 && d === 3) return dow >= 1 && dow <= 5;
  if (mo === 12 && d === 24) return dow >= 1 && dow <= 5;
  if (mo === 11 && dow === 5) {
    // Friday after Thanksgiving: Thanksgiving is the 4th Thursday (Nov 22-28),
    // so the half day is the Friday landing on Nov 23-29.
    return d >= 23 && d <= 29;
  }
  return false;
}
export function sessionCloseMinForDate(dateKey) {
  return isEarlyCloseDate(dateKey) ? EARLY_CLOSE_MIN : SESSION_CLOSE_MIN;
}

export const BUCKETS = [
  { startMin: 0,   endMin: 60,  frac: 0.25, label: "9:30-10:30" },
  { startMin: 60,  endMin: 120, frac: 0.14, label: "10:30-11:30" },
  { startMin: 120, endMin: 180, frac: 0.11, label: "11:30-12:30" },
  { startMin: 180, endMin: 240, frac: 0.11, label: "12:30-13:30" },
  { startMin: 240, endMin: 300, frac: 0.14, label: "13:30-14:30" },
  { startMin: 300, endMin: 390, frac: 0.25, label: "14:30-16:00" },
];

// Flag thresholds (see Volume Comparison & Flagging Rules in the spec).
export const HOUR_VOL_MULT = 1.2;     // hourly flag: actual >= 1.2x expected
export const HOUR_VOL_STRONG = 1.5;   // decision-grade participation
export const EOD_VOL_MULT = 1.3;      // EOD flag: day total >= 1.3x avg20
export const MOVE_BIG_PCT = 1.2;      // fallback when no volatility-scaled bar is available
export const MOVE_VOL_HIGH = 1.2;     // participation-watch multiplier
export const MOVE_VOL_LOW = 1.0;      // below-avg hourly vol multiplier
export const SR_VOL_STRONG = 1.5;     // S/R break vol >= 1.5x = very high conviction
export const SR_VOL_WEAK_MIN = 0.8;   // S/R break vol 0.8-1.5x = medium conviction
export const SR_VOL_FAKEOUT = 0.8;    // S/R break vol < 0.8x = likely fakeout

// Convert a Date to "minutes past 9:30 America/New_York" using the
// system's tz database. Returns negative for pre-open, > 390 for post-close.
// `Intl.DateTimeFormat` is the only stdlib path to ET that survives DST
// correctly without a tz library.
const ET_HM_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export function etMinutesSinceOpen(date) {
  const parts = ET_HM_FMT.formatToParts(date);
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === "hour") h = parseInt(p.value, 10);
    if (p.type === "minute") m = parseInt(p.value, 10);
  }
  // formatToParts returns "24" for midnight under hour12:false in some
  // locales — normalize so the math stays well-defined overnight.
  if (h === 24) h = 0;
  return (h - 9) * 60 + (m - 30);
}

// YYYY-MM-DD in America/New_York — used to decide whether a stored
// snapshot belongs to the same trading session as the current scan,
// so cumulative-volume deltas don't cross session boundaries.
const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function etDateKey(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return ET_DATE_FMT.format(d);
}

// ---------------------------------------------------------------------------
// Measured curve (2026-11-17). Knots are [minutes past 9:30 ET, share of the
// day's full volume traded by then], straight lines between knots. The inner
// knots sit at the hourly scans (10:00 ... 15:00 ET), where the scanner
// actually reads volume, so they can be re-measured from its own snapshots.
export const VOLUME_CURVE_VERSION = "2026-11-17";
export const CURVE_SLOTS = [30, 90, 150, 210, 270, 330];
// Median share of the day traded by each scan, May 26 - June 12, 2026 (14
// sessions, about 130 names a scan), scaled to the full day's volume.
export const MEASURED_CURVE_SEED = Object.freeze([
  [0, 0], [30, 0.16], [90, 0.32], [150, 0.45], [210, 0.55], [270, 0.64], [330, 0.74], [390, 1],
].map((k) => Object.freeze(k)));
export const CURVE_KEEP_DAYS = 20;        // sessions of learned points kept
export const CURVE_MIN_DAYS = 5;          // sessions a knot needs before it moves off the seed
export const CURVE_SLOT_TOLERANCE_MIN = 15; // a scan this close to a knot counts for it
export const CURVE_MIN_NAMES = 20;        // names a scan needs to give a day's point
// The grade's session read needs this much trading before it means anything.
export const SESSION_READ_MIN_MIN = 20;

// The two switches, one parse for the scanner and the build. Both default on;
// "0" (a repo variable or the Owner Settings page) turns one off.
export function volumeSwitches(env = process.env) {
  const on = (v) => String(v ?? "").trim() !== "0";
  return { measuredCurve: on(env?.VOLUME_MEASURED_CURVE), sessionRead: on(env?.VOLUME_SESSION_READ) };
}
// Stamped on new Top Picks trades so the Track Record splits where the volume
// vote's rules changed. "" = both switches off (the rules before 2026-11-17).
export function volumeReadVersion(env = process.env) {
  const s = volumeSwitches(env);
  if (s.measuredCurve && s.sessionRead) return VOLUME_CURVE_VERSION;
  if (s.measuredCurve) return `${VOLUME_CURVE_VERSION}-curve`;
  if (s.sessionRead) return `${VOLUME_CURVE_VERSION}-read`;
  return "";
}

// Share of the day expected by `etMin` on a knot curve (straight lines).
export function cumFracFromKnots(etMin, knots) {
  if (etMin <= SESSION_OPEN_MIN) return 0;
  if (etMin >= SESSION_CLOSE_MIN) return 1;
  for (let i = 1; i < knots.length; i++) {
    const [m1, f1] = knots[i];
    if (etMin <= m1) {
      const [m0, f0] = knots[i - 1];
      return m1 > m0 ? f0 + (f1 - f0) * (etMin - m0) / (m1 - m0) : f1;
    }
  }
  return 1;
}

function validKnots(curve) {
  if (!Array.isArray(curve) || curve.length < 2) return false;
  let prevM = -Infinity, prevF = -Infinity;
  for (const k of curve) {
    if (!Array.isArray(k) || !Number.isFinite(k[0]) || !Number.isFinite(k[1])) return false;
    if (k[0] <= prevM || k[1] < prevF || k[1] < 0 || k[1] > 1) return false;
    prevM = k[0]; prevF = k[1];
  }
  return curve[0][0] === 0 && curve[0][1] === 0 && curve[curve.length - 1][0] === SESSION_CLOSE_MIN && curve[curve.length - 1][1] === 1;
}

const medianOf = (values) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};

// One finished session's points for learning: at each of that day's
// in-session scans, the median (across names) of volume so far divided by the
// day's full volume. `dayVolOf(symbol)` returns the completed daily-bar volume
// from the bake (the same basis as the 20-day average). A name whose daily bar
// is smaller than the last reading the scanner saw (a bar still trading when
// the bake ran) is left out. Returns null on a half day or when no scan had
// enough names.
export function learnCurveDay(snapshots, date, dayVolOf) {
  // A 13:00 ET half day trades a different shape; it would skew the curve.
  if (sessionCloseMinForDate(date) < SESSION_CLOSE_MIN) return null;
  const day = (snapshots || []).filter((s) => s && s.etDate === date && Number.isFinite(s.etMin) &&
    s.etMin > SESSION_OPEN_MIN && s.etMin < SESSION_CLOSE_MIN);
  if (!day.length) return null;
  const lastSeen = new Map();
  for (const s of (snapshots || [])) {
    if (!s || s.etDate !== date || !(s.etMin > SESSION_OPEN_MIN)) continue;
    for (const t of s.tickers || []) {
      if (t?.symbol && Number.isFinite(t.cumVol)) lastSeen.set(t.symbol, Math.max(lastSeen.get(t.symbol) || 0, t.cumVol));
    }
  }
  const pts = [];
  let names = 0;
  for (const s of day.sort((a, b) => a.etMin - b.etMin)) {
    const fracs = [];
    for (const t of s.tickers || []) {
      const dv = Number(dayVolOf(t?.symbol));
      if (!(dv > 0) || !Number.isFinite(t?.cumVol) || t.cumVol < 0) continue;
      if (dv < (lastSeen.get(t.symbol) || 0) * 0.98) continue;
      const f = t.cumVol / dv;
      if (f <= 1.02) fracs.push(Math.min(1, f));
    }
    if (fracs.length < CURVE_MIN_NAMES) continue;
    names = Math.max(names, fracs.length);
    pts.push([s.etMin, Math.round(medianOf(fracs) * 10000) / 10000]);
  }
  return pts.length ? { date, names, pts } : null;
}

// The curve in use: each inner knot is the median of the learned days' points
// near it (shifted to the knot along the seed's slope), once CURVE_MIN_DAYS
// days have one; otherwise the seed's value. Kept strictly rising from 0 to 1.
export function curveFromDays(days, seed = MEASURED_CURVE_SEED) {
  const recent = (Array.isArray(days) ? days : []).filter((d) => d && Array.isArray(d.pts)).slice(-CURVE_KEEP_DAYS);
  const knots = seed.map(([m, f]) => [m, f]);
  let learnedSlots = 0;
  for (const slot of CURVE_SLOTS) {
    const idx = knots.findIndex((k) => k[0] === slot);
    if (idx < 0) continue;
    const vals = [];
    for (const d of recent) {
      let best = null;
      for (const p of d.pts) {
        if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        if (Math.abs(p[0] - slot) > CURVE_SLOT_TOLERANCE_MIN) continue;
        if (!best || Math.abs(p[0] - slot) < Math.abs(best[0] - slot)) best = p;
      }
      if (best) vals.push(best[1] - (cumFracFromKnots(best[0], seed) - cumFracFromKnots(slot, seed)));
    }
    if (vals.length >= CURVE_MIN_DAYS) {
      knots[idx][1] = medianOf(vals);
      learnedSlots++;
    }
  }
  const STEP = 0.005;
  for (let i = 1; i < knots.length - 1; i++) knots[i][1] = Math.max(knots[i][1], knots[i - 1][1] + STEP);
  for (let i = knots.length - 2; i > 0; i--) knots[i][1] = Math.min(knots[i][1], knots[i + 1][1] - STEP);
  for (const k of knots) k[1] = Math.round(k[1] * 10000) / 10000;
  return { knots, learnedSlots, days: recent.length };
}

// Cumulative fraction of daily volume expected by `etMin` minutes past 9:30 ET.
// 0 at the open, 1 at the close. With a knot `curve` (the measured curve),
// straight lines between its knots; without one, the fixed U-curve, linear
// inside each bucket.
export function cumFracExpected(etMin, curve = null) {
  if (curve && validKnots(curve)) return cumFracFromKnots(etMin, curve);
  if (etMin <= SESSION_OPEN_MIN) return 0;
  if (etMin >= SESSION_CLOSE_MIN) return 1;
  let cum = 0;
  for (const b of BUCKETS) {
    if (etMin >= b.endMin) {
      cum += b.frac;
    } else {
      const span = b.endMin - b.startMin;
      cum += b.frac * (etMin - b.startMin) / span;
      break;
    }
  }
  return cum;
}

// Which spec-defined hour bucket contains `etMin`. Returns null before the
// open. Anything at or past the close (etMin >= SESSION_CLOSE_MIN) maps to
// the last bucket so the EOD scan re-evaluates it with the full-day cumVol —
// otherwise a 16:00 ET scan only runs the EOD branch and leaves the last
// bucket pinned to whatever the prior mid-bucket scan captured. This must be
// a RANGE, not just the exact closing tick: the 16:00 dispatch routinely
// lands minutes late (cron-job → GitHub dispatch → runner boot, plus
// queueing behind the bake in the shared concurrency group), and
// cumFracExpected already clamps at the close so the expected-window math
// stays correct for any post-close minute.
export function bucketForMinute(etMin) {
  if (etMin < SESSION_OPEN_MIN) return null;
  if (etMin >= SESSION_CLOSE_MIN) return BUCKETS[BUCKETS.length - 1];
  for (const b of BUCKETS) {
    if (etMin >= b.startMin && etMin < b.endMin) return b;
  }
  return null;
}

// Four-quadrant move classification from the spec's Move Classification
// table. Returns one of:
//   { conviction: "High",   action: "Important Move" }
//   { conviction: "Medium", action: "Watch" }
//   { conviction: "Low",    action: "Caution - Weak Move" }
//   { conviction: "None",   action: "Ignore" }
// volRatio is hourly actual / hourly expected.
export function classifyMove(priceMovePct, volRatio, moveThresholdPct = MOVE_BIG_PCT) {
  if (priceMovePct == null || volRatio == null) {
    return { conviction: "None", action: "Ignore" };
  }
  const moveAbs = Math.abs(priceMovePct);
  const threshold = Number.isFinite(moveThresholdPct) && moveThresholdPct > 0
    ? moveThresholdPct
    : MOVE_BIG_PCT;
  const bigMove = moveAbs >= threshold;
  const heavyVol = volRatio >= MOVE_VOL_HIGH;
  const strongVol = volRatio >= HOUR_VOL_STRONG;
  if (bigMove && strongVol) return { conviction: "High", action: "Important Move" };
  if (!bigMove && heavyVol) return { conviction: "Medium", action: "Watch" };
  if (bigMove && heavyVol) return { conviction: "Medium", action: "Watch" };
  // Any real move that is NOT on heavy volume is a weak/unconfirmed move.
  // This deliberately catches the 1.0–1.2x middle band too: with separate
  // MOVE_VOL_HIGH (1.2) and MOVE_VOL_LOW (1.0) thresholds, a big move on,
  // say, 1.1x volume used to match neither the heavy nor the strict-light
  // branch and silently fell through to "Ignore" — i.e. it was treated as
  // LESS noteworthy than the same move on 0.9x volume. A big move is always
  // worth at least a caution.
  if (bigMove) return { conviction: "Low", action: "Caution - Weak Move" };
  return { conviction: "None", action: "Ignore" };
}

// Did `spot` cross s20 or r20 since `prevSpot`? Returns the break shape
// or null. The prior side is inclusive (prevSpot AT the level counts as
// "was at/inside"), the new side strict — sitting exactly on the level is
// not a break. Caller is responsible for confirming same-session-ness.
export function detectSrBreak(prevSpot, spot, s20, r20, bufferPct = 0) {
  if (prevSpot == null || spot == null) return null;
  const buffer = Number.isFinite(bufferPct) && bufferPct > 0 ? bufferPct : 0;
  if (r20 != null && prevSpot <= r20 && spot > r20 * (1 + buffer)) {
    return { type: "upper", level: r20 };
  }
  if (s20 != null && prevSpot >= s20 && spot < s20 * (1 - buffer)) {
    return { type: "lower", level: s20 };
  }
  return null;
}

// Classify a detected S/R break given the hourly vol ratio + price move.
// Mirrors the Resistance & Support Break Tracker table in the spec.
// Returns { conviction, action } or null if the break doesn't qualify.
export function classifySrBreak(breakType, volRatio, priceMovePct, moveThresholdPct = MOVE_BIG_PCT) {
  if (!breakType || volRatio == null) return null;
  const moveAbs = priceMovePct == null ? 0 : Math.abs(priceMovePct);
  const threshold = Number.isFinite(moveThresholdPct) && moveThresholdPct > 0
    ? moveThresholdPct
    : MOVE_BIG_PCT;
  const bigMove = moveAbs >= threshold;
  const directionalLabel = breakType === "upper" ? "Bullish" : "Bearish";
  if (volRatio < SR_VOL_FAKEOUT && bigMove) {
    return { conviction: "Low", action: "Likely Fakeout" };
  }
  if (volRatio >= SR_VOL_STRONG && bigMove) {
    return { conviction: "Very High", action: `Strong ${directionalLabel} Alert` };
  }
  if (volRatio >= SR_VOL_WEAK_MIN && volRatio < SR_VOL_STRONG && bigMove) {
    return { conviction: "Medium", action: "Watch / Weak Break" };
  }
  return null;
}

// Composed per-ticker evaluation. Given the current cumulative-volume
// snapshot, produces a flag record. Returns null when there isn't enough
// state to evaluate (pre-open, missing avg20).
//
//   now:              Date of this scan
//   spot:             current price
//   cumVol:           current intraday cumulative volume (regularMarketVolume)
//   prevClose:        yesterday's regular-session close (for EOD day-move %)
//   avg20:            20D daily avg volume
//   sr:               { s20, r20 } — 20D support/resistance from technicals
//   prev:             { etDate, etMin, spot, cumVol } prior same-session
//                     snapshot — used for S/R break detection + price move
//   bucketStartCumVol: cumulative volume at the start of the current hour
//                     bucket. For bucket 1 (9:30-10:30) this is always 0.
//                     For later buckets, the caller resolves it from the
//                     snapshot history.
//
// Hourly comparison: compares the volume traded since the bucket-start snapshot
// against the volume EXPECTED over that same elapsed window, read off the
// cumulative U-shaped curve (cumFracExpected). The hourly cron fires on the hour
// — 30 min off the :30 bucket boundaries — so comparing a partial-bucket actual
// against a full-bucket expectation (avg20 * bucket.frac) systematically under-
// or over-counts. Matching the windows makes the ratio cadence-independent (the
// original design intent) and self-correcting when a scan slot is missed.
//
// EOD evaluation is gated by `now`'s position in the session: when
// etMin >= SESSION_CLOSE_MIN we compare cumVol against `EOD_VOL_MULT * avg20`.
export function evaluateTicker({
  now,
  spot,
  cumVol,
  prevClose,
  avg20,
  sr,
  prev,
  bucketStartCumVol,
  bucketStartEtMin,
  moveThresholdPct = MOVE_BIG_PCT,
  srBufferPct = 0,
  // Knot curve for "normal volume by now" (the measured curve); null = the
  // fixed U-curve.
  curve = null,
}) {
  if (avg20 == null || avg20 <= 0) return null;
  if (spot == null || cumVol == null) return null;
  const etMin = etMinutesSinceOpen(now);
  const todayKey = etDateKey(now);
  if (etMin < SESSION_OPEN_MIN) return null;

  const hourBucket = bucketForMinute(etMin);
  // Half days close at 13:00 ET: the EOD check fires from the early close, and
  // every expectation below is capped at the early close so the shortened
  // session isn't judged against a full session's worth of expected volume.
  const closeMin = sessionCloseMinForDate(todayKey);
  const isAtOrAfterClose = etMin >= closeMin;
  const cumFracCapped = (min) => cumFracExpected(Math.min(min, closeMin), curve);

  // EOD flag — fires at/after the close, compares the day's vol to the 20D avg
  // scaled to the session actually traded (×1 on a full day, ×~0.56 on a half
  // day — the U-curve mass through 13:00).
  let eod = null;
  if (isAtOrAfterClose) {
    const expectedDayVol = avg20 * cumFracExpected(closeMin, curve); // = avg20 on a full day
    const ratio = expectedDayVol > 0 ? cumVol / expectedDayVol : cumVol / avg20;
    const dayMovePct = prevClose != null && prevClose > 0
      ? ((spot - prevClose) / prevClose) * 100
      : null;
    eod = {
      dayVol: cumVol,
      avg20,
      ratio: Math.round(ratio * 100) / 100,
      flagged: ratio >= EOD_VOL_MULT,
      dayMovePct: dayMovePct == null ? null : Math.round(dayMovePct * 100) / 100,
    };
  }

  // Hourly: compare volume since the window start against expected-over-the-same-
  // window. Bucket 1's window starts at the open (etMin 0, cumVol 0); later
  // buckets resolve bucketStartCumVol + bucketStartEtMin from snapshot history.
  let hourly = null;
  let moveClass = null;
  let srBreak = null;
  const startVol = hourBucket
    ? (hourBucket.startMin === 0 ? 0 : bucketStartCumVol)
    : null;
  const startEtMin = hourBucket
    ? (hourBucket.startMin === 0 ? SESSION_OPEN_MIN : bucketStartEtMin)
    : null;
  if (hourBucket && startVol != null && startEtMin != null) {
    // Expected volume for exactly the [startEtMin, etMin] window the actual
    // covers — not the whole bucket — so an on-the-hour scan compares like-for-
    // like. cumFracExpected is clamped at the session close, so a post-close
    // (etMin >= 390) scan caps at the full day.
    const expectedBucketVol = avg20 * Math.max(0, cumFracCapped(etMin) - cumFracCapped(startEtMin));
    const actualBucketVol = Math.max(0, cumVol - startVol);
    const volRatio = expectedBucketVol > 0 ? actualBucketVol / expectedBucketVol : null;
    const priceMovePct = prev?.spot > 0
      ? ((spot - prev.spot) / prev.spot) * 100
      : (prevClose != null && prevClose > 0
        ? ((spot - prevClose) / prevClose) * 100
        : null);
    hourly = {
      bucketLabel: hourBucket.label,
      actualHourVol: Math.round(actualBucketVol),
      expectedHourVol: Math.round(expectedBucketVol),
      volRatio: volRatio == null ? null : Math.round(volRatio * 100) / 100,
      priceMovePct: priceMovePct == null ? null : Math.round(priceMovePct * 100) / 100,
      moveThresholdPct: Math.round(moveThresholdPct * 100) / 100,
      srBufferPct: Math.round(srBufferPct * 10000) / 10000,
      prevSpot: prev?.spot ?? null,
      flagged: volRatio != null && volRatio >= HOUR_VOL_MULT,
    };
    moveClass = classifyMove(hourly.priceMovePct, hourly.volRatio, moveThresholdPct);
  }

  // Session so far: all of today's volume against what a normal day has
  // traded by now, with the move from yesterday's close. One reading per
  // scan, so it does not reward the noisiest hour the way "best window of
  // the day" does. The grade's unusual-volume vote reads this
  // (VOLUME_SESSION_READ).
  let session = null;
  const sessionMin = Math.min(etMin, closeMin);
  if (sessionMin >= SESSION_READ_MIN_MIN) {
    const expectedSoFar = avg20 * cumFracCapped(sessionMin);
    if (expectedSoFar > 0) {
      const movePct = prevClose != null && prevClose > 0 ? ((spot - prevClose) / prevClose) * 100 : null;
      session = {
        vol: Math.round(cumVol),
        expected: Math.round(expectedSoFar),
        ratio: Math.round((cumVol / expectedSoFar) * 100) / 100,
        movePct: movePct == null ? null : Math.round(movePct * 100) / 100,
      };
    }
  }

  // S/R break detection uses prior same-session spot for the crossing check.
  if (
    prev &&
    prev.etDate === todayKey &&
    prev.spot != null &&
    hourly
  ) {
    const breakInfo = detectSrBreak(
      prev.spot,
      spot,
      sr?.s20 ?? null,
      sr?.r20 ?? null,
      srBufferPct,
    );
    if (breakInfo) {
      const verdict = classifySrBreak(
        breakInfo.type,
        hourly.volRatio,
        hourly.priceMovePct,
        moveThresholdPct,
      );
      if (verdict) {
        srBreak = {
          ...breakInfo,
          ...verdict,
        };
      } else {
        srBreak = { ...breakInfo, conviction: "None", action: "No confirmation" };
      }
    }
  }

  const flagged =
    (hourly && hourly.flagged) ||
    (eod && eod.flagged) ||
    (srBreak && srBreak.conviction !== "None");

  if (!flagged && !hourly && !eod) return null;
  return {
    etDate: todayKey,
    etMin,
    spot,
    cumVol,
    avg20,
    hourly,
    eod,
    srBreak,
    moveClass,
    session,
    flagged: !!flagged,
  };
}
