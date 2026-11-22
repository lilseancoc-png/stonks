// What the hourly unusual-flow scan (scripts/scan-unusual.mjs) counts as a
// flag-sized volume burst. Two changes from the 2026-11-17 Options activity
// audit, each with its own switch (repo variable or Owner Settings):
//
// FLOW_OPEN_WINDOW — the opening half hour. Volume is measured as the change
//   since the last in-session snapshot of the same day. The 9:00 ET scan is
//   before the open, so the 10:00 scan had nothing to compare with and never
//   flagged (0 of 188 flags in 60 scans, Nov 5-16): 9:30-10:00 was never
//   counted. With this on, when no same-day in-session snapshot exists, a
//   contract that has traded today counts all of today's volume (Yahoo starts
//   a contract's volume again at its first trade of the day). Contracts that
//   have not traded today still carry yesterday's total, so they stay
//   unmeasured. Such a flag is labeled "since the open". Applies only to a
//   scan by 11:30 ET (the 10:00 scan often starts late behind the 10:00 bake).
//
// FLOW_STOCK_BARS — one bar per stock. A single bar (4,000 contracts an hour
//   inside 14 days to expiry, 2,000 past) flagged mostly NVDA, SPY and MU;
//   49 of 85 stocks never flagged. With this on, a stock's bar is 1% (0.5%
//   past 14 days) of its median full-day option volume over its last 10
//   complete sessions (front two expirations, strikes within 55% of spot),
//   never above the old bar and never below 500 (250). A stock keeps the old
//   bar until 5 complete sessions are on file.
//
// Pure functions; the scanner keeps the daily totals in unusual-history.json.
import { etDateKey, etMinutesSinceOpen } from "./volume-flags.mjs";

export const DTE_NEAR_DAYS = 14;
export const DELTA_NEAR = 4000;
export const DELTA_FAR = 2000;
export const BAR_FLOOR_NEAR = 500;
export const BAR_FLOOR_FAR = 250;
export const BAR_SHARE_NEAR = 0.01;
export const BAR_SHARE_FAR = 0.005;
export const BASELINE_SESSIONS = 10;
export const BASELINE_MIN_SESSIONS = 5;
// A day's total counts toward the baseline once a scan at 15:00 ET or later
// recorded it, so a day whose afternoon scans failed can't drag the bar down.
export const DAY_COMPLETE_MIN = 330;
export const DAILY_KEEP = 20;
// The opening window applies up to 11:30 ET. A later scan with no same-day
// snapshot means the morning scans failed; reading hours of volume against an
// hourly bar would over-flag, so that scan still skips flagging.
export const OPEN_WINDOW_MAX_MIN = 120;

const isOff = (v) => v != null && /^(0|off|false|no)$/i.test(String(v).trim());

export function flowScanSwitches(env = process.env) {
  return {
    openWindow: !isOff(env.FLOW_OPEN_WINDOW),
    stockBars: !isOff(env.FLOW_STOCK_BARS),
  };
}

// Stamped on new Top Picks record trades (flowScanVersion) so the Track Record
// draws a dated divider where the flow vote's input changed. Since 2026-11-22
// the tape tag allows for Yahoo's ~15-minute delay (stalePrint in
// lib/flow-direction.mjs, always on), so every stamp names that date; "-open"
// / "-bars" say which scan switch is still on, "-tag" that only the tag fix is.
export function flowScanVersion(env = process.env) {
  const s = flowScanSwitches(env);
  if (s.openWindow && s.stockBars) return "2026-11-22";
  if (s.openWindow) return "2026-11-22-open";
  if (s.stockBars) return "2026-11-22-bars";
  return "2026-11-22-tag";
}

// True when the contract's last trade happened today after 9:30 ET, so
// Yahoo's volume field is today's session volume.
export function tradedThisSession(lastTradeMs, todayKey) {
  if (!Number.isFinite(lastTradeMs) || !todayKey) return false;
  const d = new Date(lastTradeMs);
  return etDateKey(d.toISOString()) === todayKey && etMinutesSinceOpen(d) >= 0;
}

// Record one stock's session option volume (cumulative, so the latest scan
// of the day holds the day's total). Mutates and returns `dailyVol`:
// { SYM: { "YYYY-MM-DD": { v, m } } }, m = the latest ET minute recorded.
export function recordDailyVolume(dailyVol, symbol, dateKey, etMin, total) {
  const out = dailyVol && typeof dailyVol === "object" ? dailyVol : {};
  if (!symbol || !dateKey || !Number.isFinite(etMin) || etMin < 0 || !Number.isFinite(total) || total < 0) return out;
  const days = out[symbol] && typeof out[symbol] === "object" ? out[symbol] : {};
  const prev = days[dateKey];
  days[dateKey] = {
    v: Math.max(Math.round(total), Number(prev?.v) || 0),
    m: Math.max(etMin, Number(prev?.m) || 0),
  };
  const keep = Object.keys(days).sort().slice(-DAILY_KEEP);
  out[symbol] = Object.fromEntries(keep.map((k) => [k, days[k]]));
  return out;
}

// Median full-day option volume over the stock's last complete sessions
// before today; null until BASELINE_MIN_SESSIONS are on file.
export function stockVolumeBaseline(dailyVol, symbol, todayKey) {
  const days = dailyVol?.[symbol];
  if (!days || typeof days !== "object") return null;
  const vals = Object.keys(days)
    .filter((d) => (!todayKey || d < todayKey) && Number(days[d]?.m) >= DAY_COMPLETE_MIN && Number(days[d]?.v) > 0)
    .sort()
    .slice(-BASELINE_SESSIONS)
    .map((d) => Number(days[d].v))
    .sort((a, b) => a - b);
  if (vals.length < BASELINE_MIN_SESSIONS) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

// The volume bars one stock must clear in a scan window.
export function flowVolumeBars(baseline, { stockBars = true } = {}) {
  if (!stockBars || !(baseline > 0)) return { near: DELTA_NEAR, far: DELTA_FAR, relative: false, baseline: null };
  const near = Math.max(BAR_FLOOR_NEAR, Math.min(DELTA_NEAR, Math.round(baseline * BAR_SHARE_NEAR)));
  const far = Math.max(BAR_FLOOR_FAR, Math.min(DELTA_FAR, Math.round(baseline * BAR_SHARE_FAR)));
  return { near, far, relative: near < DELTA_NEAR || far < DELTA_FAR, baseline: Math.round(baseline) };
}

export function barForDte(bars, dte) {
  const b = bars || { near: DELTA_NEAR, far: DELTA_FAR };
  return dte != null && dte <= DTE_NEAR_DAYS ? b.near : b.far;
}
