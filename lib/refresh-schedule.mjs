// One schedule for "when does this page update next?" (2026-11-06).
//
// The header freshness line ("Updated 14 min ago · next update 15:30 ET"), the
// When data updates timeline and the PWA/offline note all read these times, so
// a schedule change is made here once. Times are ET minutes after midnight on
// a trading day; cron-job.org owns the daylight-saving conversion.
//
// Written in ES5 so app-js.mjs can embed the factory with toString().
export function refreshScheduleFactory() {
  function hm(h, m) { return h * 60 + (m || 0); }
  var JOBS = {
    brief: { label: 'Market brief', runs: [hm(8, 30), hm(11), hm(13, 30), hm(16, 10)] },
    build: { label: 'Full market build', runs: [hm(10), hm(11), hm(13, 30), hm(15, 30), hm(16, 10)] },
    // beforeClose: no run at or after an early (13:00 ET) close, matching
    // the daily.yml router. onHolidays: the slot still runs on a weekday
    // market holiday (the transcript job does; nothing else does).
    picks: { label: 'Top Picks and swing desks', runs: [hm(11), hm(15, 30)], beforeClose: true },
    flow: { label: 'Flow, volume and heatmap', runs: [hm(9), hm(10), hm(11), hm(12), hm(13), hm(14), hm(15), hm(16)] },
    oi: { label: 'Near-term open interest', runs: [hm(8, 30), hm(17)], approx: true },
    calls: { label: 'Earnings calls and pre-open call', runs: [hm(9), hm(19)], onHolidays: true },
    weekly: { label: 'Weekly Alt Data (Fridays)', runs: [hm(11, 30)], fridayOnly: true }
  };
  // Which job refreshes the data on each page. Pages not listed follow the
  // full build. Live-only pages (no stamped snapshot) return null.
  var TAB_JOB = {
    'brief': 'brief',
    'picks': 'picks', 'open-picks': 'picks', 'track': 'picks', 'stocks': 'picks', 'rotation': 'picks', 'levetf': 'picks', 'leaps': 'picks',
    'flow': 'flow', 'volume': 'flow', 'heatmap': 'flow',
    'oi': 'oi',
    'calls': 'calls',
    'ram-prices': 'weekly', 'accelerator-prices': 'weekly', 'search-interest': 'weekly',
    'sports-nba': null, 'sports-nfl': null, 'sports-pick-builder': null,
    'glossary': null, 'contact': null, 'cheatsheet': null, 'chart-patterns': null, 'timeline': null, 'privacy': null, 'terms': null, 'update-checker': null
  };
  function jobFor(tab) {
    if (tab && Object.prototype.hasOwnProperty.call(TAB_JOB, tab)) return TAB_JOB[tab];
    return 'build';
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clock(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  function dateKeyAdd(key, days) {
    var t = Date.parse(key + 'T12:00:00Z');
    if (!isFinite(t)) return null;
    var d = new Date(t + days * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function dowOf(key) {
    var t = Date.parse(key + 'T12:00:00Z');
    return isFinite(t) ? new Date(t).getUTCDay() : -1;
  }
  // et: { dateKey: 'YYYY-MM-DD', minutes: ET minutes after midnight }.
  // holidays: { 'YYYY-MM-DD': name } full closures. earlyCloses: { date: name
  // or close minute } early closes (13:00 ET when no minute is given).
  // Returns the next scheduled start strictly after now:
  // { dateKey, minutes, clock, dayOffset } or null.
  function nextRun(jobKey, et, holidays, earlyCloses) {
    var job = JOBS[jobKey];
    if (!job || !et || !et.dateKey || !isFinite(et.minutes)) return null;
    holidays = holidays || {};
    earlyCloses = earlyCloses || {};
    for (var add = 0; add < 14; add++) {
      var key = add ? dateKeyAdd(et.dateKey, add) : et.dateKey;
      if (!key) return null;
      var dow = dowOf(key);
      if (dow === 0 || dow === 6) continue;
      if (holidays[key] && !job.onHolidays) continue;
      if (job.fridayOnly && dow !== 5) continue;
      var early = Object.prototype.hasOwnProperty.call(earlyCloses, key) ? earlyCloses[key] : null;
      var closeMin = early == null ? null : (typeof early === 'number' && isFinite(early) ? early : hm(13));
      for (var i = 0; i < job.runs.length; i++) {
        if (add === 0 && job.runs[i] <= et.minutes) continue;
        if (job.beforeClose && closeMin != null && job.runs[i] >= closeMin) continue;
        return { dateKey: key, minutes: job.runs[i], clock: clock(job.runs[i]), dayOffset: add, approx: !!job.approx };
      }
    }
    return null;
  }
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // "15:30 ET", "tomorrow 10:00 ET", "Mon 10:00 ET".
  function nextLabel(jobKey, et, holidays, earlyCloses) {
    var n = nextRun(jobKey, et, holidays, earlyCloses);
    if (!n) return '';
    var t = (n.approx ? '~' : '') + n.clock + ' ET';
    if (n.dayOffset === 0) return t;
    if (n.dayOffset === 1) return 'tomorrow ' + t;
    if (n.dayOffset < 6) return DOW[dowOf(n.dateKey)] + ' ' + t;
    var d = new Date(Date.parse(n.dateKey + 'T12:00:00Z'));
    return DOW[d.getUTCDay()] + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + t;
  }
  return { JOBS: JOBS, TAB_JOB: TAB_JOB, jobFor: jobFor, nextRun: nextRun, nextLabel: nextLabel, clock: clock };
}
