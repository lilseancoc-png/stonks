// Intraday volume + support/resistance break classifier.
//
// Pure functions. No IO, no Yahoo/Gemini, no fs. Shared between the
// hourly scanner (scripts/scan-unusual.mjs) and the browser IIFE
// (inlined into scripts/render/app-js.mjs) so flag logic stays in one
// place. If you change the math here, mirror it in the generated app.js
// (same pattern as lib/greeks.mjs — see CLAUDE.md "Math is duplicated
// on purpose").
//
// Distribution: empirically the US session is U-shaped. Per the
// spec we use this weighted curve over the 390-minute regular session
// (9:30 - 16:00 ET):
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
export const EOD_VOL_MULT = 1.3;      // EOD flag: day total >= 1.3x avg20
export const MOVE_BIG_PCT = 1.2;      // |move| >= 1.2% is a "real" move
export const MOVE_VOL_HIGH = 1.2;     // above-avg hourly vol multiplier
export const MOVE_VOL_LOW = 1.0;      // below-avg hourly vol multiplier
export const SR_VOL_STRONG = 1.3;     // S/R break vol >= 1.3x = very high conviction
export const SR_VOL_WEAK_MIN = 0.8;   // S/R break vol 0.8-1.3x = medium conviction
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

// Cumulative fraction of daily volume expected by `etMin` minutes past 9:30 ET.
// 0 at the open, 1 at the close, linear inside each bucket.
export function cumFracExpected(etMin) {
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

// Which spec-defined hour bucket contains `etMin`. Returns null when
// outside the session window. The closing tick (etMin === SESSION_CLOSE_MIN)
// maps to the last bucket so the EOD scan re-evaluates it with the full-day
// cumVol — otherwise a 16:00 ET scan only runs the EOD branch and leaves the
// last bucket pinned to whatever the prior mid-bucket scan captured.
export function bucketForMinute(etMin) {
  if (etMin < SESSION_OPEN_MIN || etMin > SESSION_CLOSE_MIN) return null;
  if (etMin === SESSION_CLOSE_MIN) return BUCKETS[BUCKETS.length - 1];
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
export function classifyMove(priceMovePct, volRatio) {
  if (priceMovePct == null || volRatio == null) {
    return { conviction: "None", action: "Ignore" };
  }
  const moveAbs = Math.abs(priceMovePct);
  const bigMove = moveAbs >= MOVE_BIG_PCT;
  const heavyVol = volRatio >= MOVE_VOL_HIGH;
  if (bigMove && heavyVol) return { conviction: "High", action: "Important Move" };
  if (!bigMove && heavyVol) return { conviction: "Medium", action: "Watch" };
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
// or null. Uses strict crossings — equal-to-level on both sides is not
// a break. Caller is responsible for confirming same-session-ness.
export function detectSrBreak(prevSpot, spot, s20, r20) {
  if (prevSpot == null || spot == null) return null;
  if (r20 != null && prevSpot <= r20 && spot > r20) {
    return { type: "upper", level: r20 };
  }
  if (s20 != null && prevSpot >= s20 && spot < s20) {
    return { type: "lower", level: s20 };
  }
  return null;
}

// Classify a detected S/R break given the hourly vol ratio + price move.
// Mirrors the Resistance & Support Break Tracker table in the spec.
// Returns { conviction, action } or null if the break doesn't qualify.
export function classifySrBreak(breakType, volRatio, priceMovePct) {
  if (!breakType || volRatio == null) return null;
  const moveAbs = priceMovePct == null ? 0 : Math.abs(priceMovePct);
  const bigMove = moveAbs >= MOVE_BIG_PCT;
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
// Hourly comparison: compares the full bucket's volume so far against the
// expected full-bucket volume (avg20 * bucket.frac). For bucket 1 at 25%
// of a 38M avg20, expectedHourVol = 9.5M — compared directly against the
// cumulative volume since 9:30.
//
// EOD evaluation is gated by `now`'s position in the session: when
// etMin >= SESSION_CLOSE_MIN we compare cumVol against `EOD_VOL_MULT * avg20`.
export function evaluateTicker({ now, spot, cumVol, prevClose, avg20, sr, prev, bucketStartCumVol }) {
  if (avg20 == null || avg20 <= 0) return null;
  if (spot == null || cumVol == null) return null;
  const etMin = etMinutesSinceOpen(now);
  const todayKey = etDateKey(now);
  if (etMin < SESSION_OPEN_MIN) return null;

  const hourBucket = bucketForMinute(etMin);
  const isAtOrAfterClose = etMin >= SESSION_CLOSE_MIN;

  // EOD flag — fires at/after 16:00 ET, compares full day's vol to 20D avg.
  let eod = null;
  if (isAtOrAfterClose) {
    const ratio = cumVol / avg20;
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

  // Hourly: compare full-bucket volume vs expected bucket volume.
  // Bucket 1 always starts at cumVol=0 (market open). Later buckets need
  // bucketStartCumVol from the caller (resolved from snapshot history).
  let hourly = null;
  let moveClass = null;
  let srBreak = null;
  const startVol = hourBucket
    ? (hourBucket.startMin === 0 ? 0 : bucketStartCumVol)
    : null;
  if (hourBucket && startVol != null) {
    const expectedBucketVol = avg20 * hourBucket.frac;
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
      prevSpot: prev?.spot ?? null,
      flagged: volRatio != null && volRatio >= HOUR_VOL_MULT,
    };
    moveClass = classifyMove(hourly.priceMovePct, hourly.volRatio);
  }

  // S/R break detection uses prior same-session spot for the crossing check.
  if (
    prev &&
    prev.etDate === todayKey &&
    prev.spot != null &&
    hourly
  ) {
    const breakInfo = detectSrBreak(prev.spot, spot, sr?.s20 ?? null, sr?.r20 ?? null);
    if (breakInfo) {
      const verdict = classifySrBreak(breakInfo.type, hourly.volRatio, hourly.priceMovePct);
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
    flagged: !!flagged,
  };
}
