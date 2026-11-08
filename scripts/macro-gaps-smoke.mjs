// Missing official months and the Calendar countdown cards (QC of builds
// #423-#472). BLS never published October 2025 for most CPI series or the
// household survey, so October 2026 CPI has no 12-month change. Pure; no
// network.
import assert from "node:assert/strict";
import vm from "node:vm";
import { cpiInflationRead, unemploymentRead, econYoyGapNote } from "./build.mjs";
import { renderAppJs } from "./render/app-js.mjs";

// Monthly series oldest-first, YYYY-MM-01 dates, with `skip` months left out.
function monthly(fromYM, toYM, valueAt, skip = []) {
  const out = [];
  let [y, m] = fromYM.split("-").map(Number);
  const [ty, tm] = toYM.split("-").map(Number);
  let i = 0;
  while (y < ty || (y === ty && m <= tm)) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (!skip.includes(ym)) out.push({ date: `${ym}-01`, value: valueAt(i, ym) });
    i++; m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// --- CPI: the newest month has no year-ago index -----------------------------
{
  // Index rises 0.3% a month, so every computable YoY is about 3.7%.
  const cpi = monthly("2024-01", "2026-10", (i) => 300 * Math.pow(1.003, i), ["2025-10"]);
  const read = cpiInflationRead(cpi);
  assert.ok(read, "the CPI read survives the October 2026 gap");
  assert.equal(read.refMonth, "2026-09", "it keeps the newest month that has a 12-month change");
  assert.equal(read.latestMonth, "2026-10");
  assert.match(read.gapNote, /No 12-month change for Oct 2026: the Oct 2025 index was never published/);
  assert.ok(Math.abs(read.yoy - 3.7) < 0.2, `yoy ${read.yoy}`);
  assert.ok(read.prevYoy != null && read.yoy3mAgo != null);

  // A normal month: no note, newest month reported.
  const full = monthly("2024-01", "2026-09", (i) => 300 * Math.pow(1.003, i));
  const normal = cpiInflationRead(full);
  assert.equal(normal.refMonth, "2026-09");
  assert.equal(normal.gapNote, undefined);

  // November 2026 has its own year-ago month again; only the prior-month
  // trend anchor (October 2026) is missing, so the trend reads flat.
  const nov = monthly("2024-01", "2026-11", (i) => 300 * Math.pow(1.003, i), ["2025-10"]);
  const nread = cpiInflationRead(nov);
  assert.equal(nread.refMonth, "2026-11");
  assert.equal(nread.gapNote, undefined);
  assert.equal(nread.prevYoy, null);
  assert.equal(nread.trend, "flat");

  assert.equal(cpiInflationRead([]), null);
}

// --- Unemployment: the Sahm read is anchored by date -----------------------
{
  // Flat 4.0% except a 5.0% spike in September 2025 right before the missing
  // October 2025. A positional 3-month average for November 2025 would be
  // (Nov, Sep, Aug) and fold the spike in; by date it needs October, so it is
  // skipped.
  const ue = monthly("2025-01", "2026-10", (_i, ym) => (ym === "2025-09" ? 5.0 : 4.0), ["2025-10"]);
  const read = unemploymentRead(ue);
  assert.equal(read.refMonth, "2026-10");
  assert.equal(read.rate, 4);
  assert.equal(read.prior, 4);
  assert.equal(read.sahm, 0);
  // A real rise: last three months 4.6%, low 4.0% → Sahm +0.6pp.
  const rising = monthly("2025-01", "2026-10", (_i, ym) => (ym >= "2026-08" ? 4.6 : 4.0), ["2025-10"]);
  assert.equal(unemploymentRead(rising).sahm, 0.6);
  assert.equal(unemploymentRead(rising).trend, "flat", "Sep → Oct 2026 is 4.6 → 4.6");
}

// --- Calendar rows say why a YoY figure is missing -----------------------------
{
  const cpi = monthly("2023-01", "2026-09", (i) => 300 + i, ["2025-10"]);
  assert.match(econYoyGapNote(cpi, "2026-11-10"), /No 12-month change for Oct 2026: the Oct 2025 index was never published/);
  assert.equal(econYoyGapNote(cpi, "2026-12-10"), null, "November 2026 has November 2025");
  assert.equal(econYoyGapNote(monthly("2026-01", "2026-09", (i) => i + 1), "2026-11-10"), null,
    "a series that starts after the year-ago month is not a gap");
}

// --- Browser: Calendar countdown cards and stock-link hover text ---------------
{
  const source = renderAppJs();
  new vm.Script(source);
  const fn = (name) => {
    const start = source.indexOf("  function " + name + "(");
    assert.ok(start >= 0, name);
    const end = source.indexOf("\n  }", start) + 4;
    return source.slice(start, end);
  };
  const ctx = vm.createContext({ Date, Intl, HAS_OWNER_ACCESS: false, fmtCalendarDateShort: (d) => d });
  for (const name of ["calDaysFromToday", "calDaysFromEvent", "calRelativeLabel", "calCountdownLabel", "calNormProb", "calFomcOutcome", "buildCalendarOverview", "symOpenLabel"]) {
    vm.runInContext(fn(name), ctx);
  }
  const today = Date.parse("2026-11-08T00:00:00Z");
  const cards = ctx.buildCalendarOverview({
    fomc: { meetings: [{ date: "2026-12-09", label: "Dec 8–9, 2026" }] },
    events: [
      { type: "report", date: "2026-12-15", title: "Retail sales" },
      { type: "earnings", date: "2026-11-09", symbol: "RKLB", impliedMovePct: 0.14 },
    ],
  }, today);
  const fomc = cards.find((c) => c.kind === "fomc");
  assert.equal(fomc.value, "In 31 days", "the next FOMC card shows a countdown past four weeks");
  assert.equal(cards.find((c) => c.kind === "report").value, "In 37 days");
  assert.equal(cards.find((c) => c.kind === "earnings").label, "Earnings, next 7 days");
  assert.equal(ctx.calCountdownLabel(0), "Today");
  assert.equal(ctx.calCountdownLabel(20), "In 3 weeks");
  assert.equal(ctx.calRelativeLabel(31), "", "day-row tags still stop at four weeks");

  assert.equal(ctx.symOpenLabel("AAPL"), "Open the AAPL stock page", "public visitors are not told about the Owner Grade tab");
  ctx.HAS_OWNER_ACCESS = true;
  assert.equal(ctx.symOpenLabel("AAPL"), "Open AAPL in the Grade tab");
  assert.doesNotMatch(source, /title="Open ' \+ (?:escapeHtml|briefEsc)\([^)]*\) \+ ' in the Grade tab"/, "no hard-coded Grade-tab hover text left");

  assert.match(source, /e\.note \? '<p class="cal-report-note">'/, "report chips show the missing-figure note");
  assert.match(source, /inf\.gapNote \? '<span class="bonds-live-prev">'/, "the CPI tile shows the skipped-month note");
}

console.log("macro gaps smoke ok");
