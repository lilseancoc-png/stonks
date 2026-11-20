// Keeps the Owner Sports jobs on their planned schedule (2026-11-20 branch
// audit). GitHub's cron starts these workflows hours late or not at all: on
// 2026-11-18 to 2026-11-20 the props scan ran 2-3 times a day of 15 planned,
// the NBA research capture 1-2 of 24, and the 13:20 UTC data refresh started
// near 21:40 UTC, so the day's NBA picks were issued before last night's box
// scores were stored. The hourly flow scan and the Daily build are
// dispatched on time by cron-job.org, so each of them asks this plan which
// sports workflow is overdue and dispatches only those. The crons stay as the
// backup (evenings and weekends, when neither on-time job runs).
//
// Pure: no network, no clock. scripts/sports-on-time.mjs reads the newest
// runs from the GitHub API and sends the dispatches. No AI, no market data,
// no sportsbook call here; a dispatched props scan spends the same PropLine
// requests a planned cron run would (it only fills a missed slot).

const MIN = 60 * 1000;

export const SPORTS_ON_TIME = Object.freeze({
  // A scan that started this recently (any state) covers this hour.
  freshMinutes: 40,
  workflows: Object.freeze([
    // Hourly at :37, 14-04 UTC (sports-props.yml).
    { file: "sports-props.yml", kind: "hourly", hours: [0, 1, 2, 3, 4, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] },
    // :22 and :52, 16-03 UTC (nba-prop-research.yml).
    { file: "nba-prop-research.yml", kind: "hourly", hours: [0, 1, 2, 3, 16, 17, 18, 19, 20, 21, 22, 23] },
    // 13:20 and 22:30 UTC (sports-data.yml).
    { file: "sports-data.yml", kind: "slots", slots: [[13, 20], [22, 30]], graceMinutes: 20, windowHours: 12 },
  ]),
});

function newestMs(createdAts) {
  let best = null;
  for (const v of createdAts || []) {
    const t = Date.parse(v);
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best;
}

// The most recent planned slot that is at least `graceMinutes` old.
export function latestSlotMs(nowMs, slots, graceMinutes = 0) {
  const ready = nowMs - graceMinutes * MIN;
  const day = new Date(ready);
  let best = null;
  for (const back of [0, 1]) {
    const base = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - back);
    for (const [h, m] of slots) {
      const t = base + (h * 60 + m) * MIN;
      if (t <= ready && (best == null || t > best)) best = t;
    }
  }
  return best;
}

// runs: { [file]: [created_at ISO, ...] } (newest few runs, any state).
// Returns [{ file, due, reason }] for every workflow in the plan.
export function sportsDispatchPlan({ nowMs, runs = {}, plan = SPORTS_ON_TIME } = {}) {
  const out = [];
  for (const wf of plan.workflows) {
    const last = newestMs(runs[wf.file]);
    if (wf.kind === "hourly") {
      const hour = new Date(nowMs).getUTCHours();
      if (!wf.hours.includes(hour)) { out.push({ file: wf.file, due: false, reason: "outside its hours" }); continue; }
      const age = last == null ? null : (nowMs - last) / MIN;
      if (age != null && age < plan.freshMinutes) { out.push({ file: wf.file, due: false, reason: `ran ${Math.round(age)} min ago` }); continue; }
      out.push({ file: wf.file, due: true, reason: last == null ? "no recent run" : `last run ${Math.round(age)} min ago` });
    } else {
      const slot = latestSlotMs(nowMs, wf.slots, wf.graceMinutes);
      if (slot == null || nowMs - slot > wf.windowHours * 60 * MIN) { out.push({ file: wf.file, due: false, reason: "no slot due" }); continue; }
      if (last != null && last >= slot) { out.push({ file: wf.file, due: false, reason: "slot already ran" }); continue; }
      out.push({ file: wf.file, due: true, reason: `the ${new Date(slot).toISOString().slice(11, 16)} UTC slot has not run` });
    }
  }
  return out;
}
