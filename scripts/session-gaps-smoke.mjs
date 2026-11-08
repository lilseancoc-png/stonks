// Trading-session counts behind the freshness labels, and the live 2-year
// yield in early January (QC of builds #373-#422). Market holidays are not
// sessions, a 13:00 ET early close ends the regular session, and the live
// Treasury 2Y read borrows last December for its previous close. Pure; no
// network.
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderAppJs } from "./render/app-js.mjs";
import { closureTables } from "../lib/us-equity-calendar.mjs";
import { fetchTreasuryTwoYear } from "../api/macro-live.js";

const source = renderAppJs();
new vm.Script(source);
const fn = (name) => {
  const start = source.indexOf("  function " + name + "(");
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n  }", start) + 4;
  return source.slice(start, end);
};

// A Date whose no-argument form is a fixed "now".
function frozenDate(nowIso) {
  const NOW = Date.parse(nowIso);
  return class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(NOW); }
    static now() { return NOW; }
  };
}

const { holidays, halfDays } = closureTables();
assert.ok(holidays["2026-11-26"], "Thanksgiving 2026 is in the closure table");
assert.ok(halfDays["2026-11-27"], "the day after Thanksgiving is a half day");

function load(nowIso, unusual) {
  const ctx = vm.createContext({
    Date: frozenDate(nowIso), Intl, Math, Number, String, isFinite,
    MARKET_HOLIDAYS: holidays, MARKET_HALF_DAYS: halfDays, UNUSUAL: unusual || null,
  });
  for (const name of ["marketEtDateParts", "isMarketSessionDay", "marketSessionGap", "flowFreshnessMeta",
    "heatmapEtDateParts", "heatmapSessionGap"]) {
    vm.runInContext(fn(name), ctx);
  }
  return ctx;
}

// --- Holidays are not sessions ------------------------------------------------
{
  const wedClose = "2026-11-25T21:00:00Z"; // Wed 16:00 ET
  const thanksgiving = load("2026-11-26T15:00:00Z"); // Thu 10:00 ET, market closed
  assert.equal(thanksgiving.marketSessionGap(wedClose), 0, "Wednesday's data is current on Thanksgiving");
  assert.equal(thanksgiving.heatmapSessionGap(wedClose), 0);
  const friday = load("2026-11-27T15:00:00Z");
  assert.equal(friday.marketSessionGap(wedClose), 1, "Friday is one session after Wednesday");
  // Friday before MLK Day 2027 → Tuesday is one session, not two.
  const tue = load("2027-01-19T14:00:00Z");
  assert.equal(tue.marketSessionGap("2027-01-15T21:00:00Z"), 1);
  assert.equal(tue.heatmapSessionGap("2027-01-15T21:00:00Z"), 1, "the heatmap is not marked stale after a holiday Monday");
  // Ordinary weekend still counts as zero sessions.
  const mon = load("2026-11-23T14:00:00Z");
  assert.equal(mon.marketSessionGap("2026-11-20T21:00:00Z"), 1);
  assert.equal(load("2026-11-21T16:00:00Z").marketSessionGap("2026-11-20T21:00:00Z"), 0);
}

// --- Flow freshness on a holiday and on a half day ------------------------------
{
  const holiday = load("2026-11-26T15:00:00Z", { scannedAt: "2026-11-25T20:00:00Z", marketState: "REGULAR" });
  const h = holiday.flowFreshnessMeta();
  assert.equal(h.label, "Closed-session reference", "Thanksgiving is outside the regular session");
  assert.equal(h.sessionGap, 0);

  // 15:00 ET on the half day: the 13:00 scan is the session's last, not a delayed one.
  const half = load("2026-11-27T20:00:00Z", { scannedAt: "2026-11-27T18:00:00Z", marketState: "REGULAR" });
  assert.equal(half.flowFreshnessMeta().label, "Closed-session reference");

  // A normal Friday mid-session scan is still executable.
  const normal = load("2026-11-20T16:00:00Z", { scannedAt: "2026-11-20T15:30:00Z", marketState: "REGULAR" });
  const n = normal.flowFreshnessMeta();
  assert.equal(n.executable, true);
  assert.equal(n.label, "Current regular-session scan");
}

// --- Live 2Y yield in early January ----------------------------------------------
{
  const entry = (date, v) =>
    `<entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE>` +
    `<d:BC_2YEAR m:type="Edm.Double">${v}</d:BC_2YEAR></m:properties></content></entry>`;
  const feeds = {
    2026: entry("2026-12-30", "3.90") + entry("2026-12-31", "3.95"),
    2027: entry("2027-01-04", "4.01"),
  };
  const asked = [];
  const fetchYear = async (y) => { asked.push(y); return `<feed>${feeds[y] || ""}</feed>`; };

  const one = await fetchTreasuryTwoYear(Date.parse("2027-01-04T22:00:00Z"), fetchYear);
  assert.deepEqual(asked, [2027, 2026], "January with one row reads last year for the previous close");
  assert.equal(one.value, 4.01);
  assert.equal(one.prevClose, 3.95);
  assert.ok(Math.abs(one.bpsChange1d - 6) < 1e-9);
  assert.equal(one.asOf, "2027-01-04");

  asked.length = 0;
  const none = await fetchTreasuryTwoYear(Date.parse("2027-01-01T15:00:00Z"), async (y) => {
    asked.push(y); return y === 2027 ? "<feed></feed>" : `<feed>${feeds[2026]}</feed>`;
  });
  assert.equal(none.value, 3.95, "New Year's Day shows the last close of December");
  assert.equal(none.asOf, "2026-12-31");

  // Later in the year an empty feed is an outage: no reach back to December.
  asked.length = 0;
  const emptyNow = async (y) => { asked.push(y); return y === 2027 ? "<feed></feed>" : `<feed>${feeds[2026]}</feed>`; };
  await assert.rejects(() => fetchTreasuryTwoYear(Date.parse("2027-03-02T15:00:00Z"), emptyNow), /no usable observation/);
  assert.deepEqual(asked, [2027]);

  // A prior-year failure keeps the one-row read instead of failing the leg.
  const kept = await fetchTreasuryTwoYear(Date.parse("2027-01-04T22:00:00Z"), async (y) => {
    if (y === 2026) throw new Error("Treasury 2Y HTTP 503");
    return `<feed>${feeds[2027]}</feed>`;
  });
  assert.equal(kept.value, 4.01);
  assert.equal(kept.prevClose, null);
}

console.log("session gaps smoke ok");
