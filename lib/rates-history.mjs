// The Rates page's long view: the whole Treasury curve today, a month ago and
// a year ago, plus about a year of daily 2Y / 10Y / 30Y yields and the dollar
// index. Pure: the bake passes in the rows it already fetched (the Treasury
// par-yield feed and the Yahoo daily bars from the overnight sweep), so this
// adds no network calls of its own. The result rides in macro-history.json,
// which the Rates page already loads on open.

export const RATES_HISTORY_DAYS = 260;
const DAY = 86400000;
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const ms = (date) => Date.parse(String(date).slice(0, 10) + "T00:00:00Z");

// The newest row on or before a target date, within `slackDays` of it.
function rowAtOrBefore(rows, targetMs, slackDays = 10) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = ms(rows[i].date);
    if (t <= targetMs) return targetMs - t <= slackDays * DAY ? rows[i] : null;
  }
  return null;
}

function barsByDate(bars) {
  const out = new Map();
  for (const b of bars || []) {
    const date = String(b?.t || b?.date || "").slice(0, 10);
    const v = Number(b?.c ?? b?.value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(v)) out.set(date, v);
  }
  return out;
}

// tenors: [[label, feedTag, years], ...] (TREASURY_TENORS in build.mjs).
export function buildRatesHistory({ treasury = [], tenors = [], dxyBars = [], tnxBars = [], tyxBars = [], prior = null, days = RATES_HISTORY_DAYS, builtAtIso = new Date().toISOString() } = {}) {
  const rows = (treasury || [])
    .filter((r) => r && /^\d{4}-\d{2}-\d{2}/.test(String(r.date)) && r.curve && typeof r.curve === "object")
    .map((r) => ({ date: String(r.date).slice(0, 10), curve: r.curve }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dedup = [];
  for (const r of rows) {
    if (dedup.length && dedup[dedup.length - 1].date === r.date) dedup[dedup.length - 1] = r;
    else dedup.push(r);
  }

  let curve = null;
  const latest = dedup[dedup.length - 1];
  if (latest) {
    const labels = tenors.map((t) => t[0]).filter((label) => Number.isFinite(latest.curve[label]));
    const pick = (row, key, name) => row ? { key, name, date: row.date, values: labels.map((l) => round(row.curve[l], 3)) } : null;
    const lastMs = ms(latest.date);
    curve = {
      tenors: labels.map((l) => ({ label: l, years: round((tenors.find((t) => t[0] === l) || [])[2], 4) })),
      lines: [
        pick(latest, "today", "Latest"),
        pick(rowAtOrBefore(dedup, lastMs - 30 * DAY), "month", "1 month ago"),
        pick(rowAtOrBefore(dedup, lastMs - 365 * DAY), "year", "1 year ago"),
      ].filter(Boolean),
      source: "US Treasury daily par yield curve",
    };
    if (labels.length < 4) curve = null;
  }
  if (!curve && prior?.curve) curve = { ...prior.curve, stale: true };

  // Daily series: the Treasury feed is the source for 2Y / 10Y / 30Y; Yahoo's
  // ^TNX / ^TYX fill a day the feed lacks. The dollar index is Yahoo only.
  const two = new Map(), ten = barsByDate(tnxBars), thirty = barsByDate(tyxBars), dxy = barsByDate(dxyBars);
  for (const r of dedup) {
    if (Number.isFinite(r.curve["2Y"])) two.set(r.date, r.curve["2Y"]);
    if (Number.isFinite(r.curve["10Y"])) ten.set(r.date, r.curve["10Y"]);
    if (Number.isFinite(r.curve["30Y"])) thirty.set(r.date, r.curve["30Y"]);
  }
  const allDates = [...new Set([...two.keys(), ...ten.keys(), ...thirty.keys(), ...dxy.keys()])].sort();
  const dates = allDates.slice(-days);
  let daily = null;
  if (dates.length >= 20) {
    daily = {
      dates,
      twoY: dates.map((d) => round(two.get(d), 3)),
      tenY: dates.map((d) => round(ten.get(d), 3)),
      thirtyY: dates.map((d) => round(thirty.get(d), 3)),
      dxy: dates.map((d) => round(dxy.get(d), 2)),
    };
  } else if (prior?.daily) daily = { ...prior.daily, stale: true };

  if (!curve && !daily) return prior || null;
  return { builtAtIso, curve, daily };
}
