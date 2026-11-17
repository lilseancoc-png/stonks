// Which earlier OI snapshot the near-term OI tracker compares with (ΔOI).
//
// Open interest settles once a day, after a trading session. A scan taken on
// a weekend or a weekday market holiday sees the same settled OI as the next
// trading morning, because nothing traded in between. When such a snapshot
// was the baseline, the next trading morning's ΔOI read ~0 everywhere: on
// Sep 8, 2026 (after Labor Day) the pre-market scan compared with the Sep 7
// holiday scans and flagged nothing. The baseline is therefore the newest
// snapshot from an earlier date that was a trading day; only when none is
// kept does it fall back to the newest snapshot from any earlier date (the
// old rule), so a long outage still has a baseline.
import { sessionForDate } from "./us-equity-calendar.mjs";

// True for a weekday NYSE session, false for a weekend or listed holiday,
// null when the calendar does not cover the year (treated as a trading day).
function wasTradingDay(dateKey) {
  const s = sessionForDate(dateKey);
  return s ? s.open : null;
}

// history: { snapshots: [{ etDate, ... }] } oldest first. Returns the chosen
// snapshot or null on a cold start.
export function previousDaySnapshot(history, todayKey) {
  const snaps = (history?.snapshots || []).slice().reverse();
  let fallback = null;
  for (const snap of snaps) {
    if (!snap?.etDate || snap.etDate === todayKey) continue;
    if (!fallback) fallback = snap;
    if (wasTradingDay(snap.etDate) !== false) return snap;
  }
  return fallback;
}
