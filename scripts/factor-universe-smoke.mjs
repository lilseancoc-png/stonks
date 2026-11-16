// Offline checks for the Factor lab's wide history test (lib/labs/factor-universe.mjs)
// on a made-up universe: point-in-time rules, the share count across a split,
// a planted factor that must be found, noise that must not pass, costs and
// the public-safe shape of the result.
// Run: node scripts/factor-universe-smoke.mjs
import assert from "node:assert/strict";
import { evaluateUniverse, ttmSeries, latestKnown, sharesSeries, shareCheck, UNIVERSE_FACTORS, UNIVERSE_FAMILIES, UNIVERSE_HORIZONS, _test } from "../lib/labs/factor-universe.mjs";
import { universeFixture, dayNo, SPIN_RATIO } from "./fixtures/factor-universe.mjs";
import { trialsAdjustedT } from "../lib/labs/stats.mjs";

let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const near = (a, b, tol, label) => { assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`); checks++; };

// --- trailing-year totals from filed periods ---
{
  const D = dayNo;
  const rows = [
    [D("2019-01-01"), D("2019-12-31"), D("2020-02-20"), 400],          // full year 2019
    [D("2019-01-01"), D("2019-03-31"), D("2019-05-05"), 90],           // Q1 2019
    [D("2019-01-01"), D("2019-06-30"), D("2019-08-05"), 190],          // six months 2019
    [D("2020-01-01"), D("2020-03-31"), D("2020-05-05"), 120],          // Q1 2020
    [D("2020-01-01"), D("2020-06-30"), D("2020-08-05"), 250],          // six months 2020
    [D("2020-04-01"), D("2020-06-30"), D("2020-08-05"), 130],          // Q2 2020 alone: not a year-to-date figure
  ];
  const s = ttmSeries(rows);
  eq(s.map((e) => e.val), [400, 430, 460], "a full year as filed, then last year plus this year to date minus the same stretch a year earlier");
  eq(s[1].avail, D("2020-05-05"), "a trailing total is public only when its newest part is");
  eq(latestKnown(s, D("2020-05-04")).val, 400, "the day before a filing, the older total still stands");
  eq(latestKnown(s, D("2020-05-05")).val, 430, "on the filing day the new total is used");
  eq(latestKnown(s, D("2020-02-19")), null, "nothing is known before the first filing");
  eq(latestKnown(s, D("2023-01-01")), null, "a total more than 18 months old is not used");
  eq(ttmSeries([]).length, 0, "no rows, no totals");
}

// --- share counts: splits, units, spin-offs ---
{
  const D = dayNo, { sharesAt } = _test;
  const at = (series, iso) => sharesAt(series, D(iso));
  // Filed before a 2-for-1 split: 50 shares. Filed after: 100. In today's terms both are 100.
  const facts = { wsh: [[D("2015-01-01"), D("2015-03-31"), D("2015-05-05"), 50], [D("2015-04-01"), D("2015-06-30"), D("2015-08-05"), 100], [D("2015-07-01"), D("2015-09-30"), D("2015-11-05"), 100], [D("2015-01-01"), D("2015-12-31"), D("2016-02-20"), 100]] };
  const s = sharesSeries(facts, [[D("2015-06-15"), 2]]);
  ok(s.every((e) => e.val === 100), "a count filed before a split is restated into today's shares");
  // With no weighted count the cover-page count is used, as of its own date.
  const cover = sharesSeries({ sh: [[D("2015-05-01"), D("2015-05-05"), 50], [D("2015-08-01"), D("2015-08-05"), 100]] }, [[D("2015-06-15"), 2]]);
  eq(cover.map((e) => e.val), [100, 100], "the cover-page count is used when weighted counts are missing");

  // Eight quarters of one company: 80 million shares, a dollar a share of profit each quarter.
  const quarters = (fn) => { const out = { wsh: [], sh: [], ni: [], eps: [] }; for (let q = 0; q < 8; q++) { const start = D("2014-01-01") + q * 91, end = start + 90, filed = end + 35; fn(out, q, start, end, filed); } return out; };
  const plain = (out, q, start, end, filed, { w = 80e6, c = 80e6, ni = 80e6, eps = 1 } = {}) => { out.wsh.push([start, end, filed, w]); out.sh.push([end + 20, filed, c]); out.ni.push([start, end, filed, ni]); out.eps.push([start, end, filed, eps]); };
  const vals = (series, src) => series.filter((e) => e.src === src).map((e) => Math.round(e.val));

  const thousands = sharesSeries(quarters((o, q, ...r) => plain(o, q, ...r, q === 3 ? { w: 80e3 } : {})), []);
  ok(vals(thousands, "w").every((v) => v === 80e6) && thousands.info.rescaled === 1, "a weighted count filed in thousands is rescaled");
  const always = sharesSeries(quarters((o, q, ...r) => plain(o, q, ...r, { w: 80e3 })), []);
  ok(vals(always, "w").every((v) => v === 80e6) && always.info.rescaled === 8, "even when every weighted count is in thousands: the cover count and profit per share outvote it");
  const perShare = sharesSeries(quarters((o, q, ...r) => plain(o, q, ...r, q >= 3 && q <= 5 ? { eps: 1e6 } : {})), []);
  ok(vals(perShare, "w").every((v) => v === 80e6) && vals(perShare, "c").every((v) => v === 80e6) && perShare.info.rescaled === 0, "per-share figures filed a million times too large do not move the share counts");
  const shell = sharesSeries(quarters((o, q, ...r) => plain(o, q, ...r, q === 0 ? { w: 1000, c: 1000 } : {})), []);
  ok(vals(shell, "w").length === 7 && vals(shell, "c").length === 7 && shell.info.dropped === 2, "a shell company's 1,000 shares are left out, not scaled up");
  const typo = sharesSeries(quarters((o, q, ...r) => plain(o, q, ...r, q === 4 ? { c: 240e6 } : {})), []);
  ok(vals(typo, "c").every((v) => v === 80e6), "one cover count far from both neighbours is treated as a slip");
  // Profit per share of a few cents is too coarse to stand in for a count.
  const coarse = sharesSeries(quarters((o, q, ...r) => plain(o, q, ...r, { ni: 2.4e6, eps: 0.03 })), []);
  ok(vals(coarse, "e").length === 0 && vals(coarse, "w").length === 8, "profit over a few cents a share is not used as a count");
  // Profit that includes partners' shares: the per-share reading runs three times high and is not used.
  const partners = sharesSeries(quarters((o, q, ...r) => plain(o, q, ...r, { ni: 240e6 })), []);
  ok(vals(partners, "e").length === 0 && vals(partners, "w").every((v) => v === 80e6), "profit over earnings per share is dropped where it disagrees with the filed counts");

  // A spin-off the price history books as a 2.5-for-1 split: the filed count does not move.
  const spinDay = D("2015-01-15");
  const spin = sharesSeries(quarters(plain), [[spinDay, 2.5]]);
  eq(spin.info.spins, 1, "an event the share count did not move with is a spin-off");
  near(at(spin, "2014-12-31"), 200e6, 1, "before a spin-off the count is scaled the way the price was");
  near(at(spin, "2015-02-27"), 80e6, 1, "after it the filed count stands");
  // A real 2-for-1 split on the same day: counts filed after it are twice as large.
  const split = sharesSeries(quarters((o, q, start, end, filed) => plain(o, q, start, end, filed, filed >= spinDay ? { w: 160e6, c: 160e6, eps: 0.5 } : {})), [[spinDay, 2]]);
  ok(split.info.spins === 0 && vals(split, "w").every((v) => v === 160e6), "an event the share count moved with is a split");
  // The filing ten weeks before the split day is already restated for it.
  const restated = (filed) => filed >= spinDay - 100;
  // (Each filing here also carries the balance-sheet count, so the restated filing has two cover rows.)
  const early = sharesSeries(quarters((o, q, start, end, filed) => { plain(o, q, start, end, filed, restated(filed) ? { w: 160e6, c: 160e6, eps: 0.5 } : {}); o.sh.push([end, filed, restated(filed) ? 160e6 : 80e6]); }), [[spinDay, 2]]);
  ok(quarters((o, q, s0, e0, filed) => o.wsh.push(filed)).wsh.some((filed) => restated(filed) && filed < spinDay), "(one filing falls between the restatement and the split day)");
  ok(early.info.spins === 0 && vals(early, "w").every((v) => v === 160e6) && vals(early, "c").every((v) => v === 160e6), "a filing already restated before the split day is not doubled again");

  // A new listing: the year's weighted average lags; the newer cover count is used.
  const listing = sharesSeries(quarters((o, q, ...r) => plain(o, q, ...r, q >= 4 ? { w: q === 4 ? 100e6 : 200e6, c: 200e6, ni: 200e6 } : {})), []);
  near(at(listing, "2015-05-29"), 200e6, 1, "the larger of the weighted and the cover count is used after a share issue");
  // A cover count for one share class of two: the weighted count covers both.
  const classes = sharesSeries(quarters((o, q, ...r) => plain(o, q, ...r, { c: 30e6 })), []);
  near(at(classes, "2015-05-29"), 80e6, 1, "a cover count for one share class does not shrink the company");

  // Today's count against today's quote.
  eq(shareCheck(100, { so: 98, cap: 2000, px: 10 }).state, "ok", "a count that matches the quoted share count passes");
  eq(shareCheck(100, { so: 50, cap: 1000, px: 10 }).state, "ok", "or the quoted value over the quoted price, whichever is nearer");
  eq(shareCheck(1000, { so: 100, cap: 1000, px: 10 }).state, "high", "a count ten times the quote (a depositary share) fails");
  eq(shareCheck(30, { so: 100, cap: 1000, px: 10 }).state, "low", "so does a count far below it (a share class the filings do not total)");
  eq(shareCheck(null, { so: 100, cap: 1000, px: 10 }).state, "none", "no count today is its own state");
  eq(shareCheck(100, null).state, "unquoted", "without a quote nothing is checked");
}

// --- the made-up universe ---
const fx = universeFixture();
const res = evaluateUniverse(fx, { size: 120, minNames: 100 });
ok(res.status === "ok" && res.pool === 159 && res.names === 120, "the test runs on the largest 120 of the 159 companies whose share count matches today's quote");
eq(res.shares, { checked: 160, ok: 159, high: 1, low: 0, none: 0, rescaled: 1, spinoffs: 1, filingsLeft: 1 }, "the share check is reported as counts: one depositary share left out, one company rescaled, one spin-off, one filing in the wrong units");
ok(res.months >= 100 && res.from === "2011-01" && res.to <= "2019-11", "it starts once a year of prices exists and stops before the last, unfinished month");
eq(res.factors.map((f) => f.key), UNIVERSE_FACTORS.map((f) => f.key), "every factor is reported");
eq(res.families.map((f) => f.key), UNIVERSE_FAMILIES.map((f) => f.key), "every family has a regression row");
near(res.tBar, trialsAdjustedT(UNIVERSE_FACTORS.length + 1), 0.01, "the bar counts every factor plus the combined score");
const by = Object.fromEntries(res.factors.map((f) => [f.key, f]));
ok(by.gpa.verdict === "holds" && by.gpa.ic[0].ic > 0.05 && by.gpa.ic[0].t > res.tBar && by.gpa.bothHalves, "the planted factor is found, in both halves");
ok(by.gpa.spread.perYear > 10 && by.gpa.spread.net < by.gpa.spread.perYear && by.gpa.spread.net > 0, "its top fifth beats its bottom fifth, a little less after costs");
ok(by.gpa.spread.topVsAll > 0 && by.gpa.spread.topVsAll < by.gpa.spread.perYear, "the top fifth alone beats the average company by less than the full spread");
for (const key of ["inv", "lev", "mom12", "sue", "opm"]) ok(["none", "lucky"].includes(by[key].verdict), `noise does not pass: ${key}`);
ok(by.rev1.spread.turnover > 0.6 && by.gpa.spread.turnover < 0.15, "a fast factor trades far more than a slow one");
ok(by.rev1.spread.perYear - by.rev1.spread.net > 5 * (by.gpa.spread.perYear - by.gpa.spread.net), "so it pays far more in costs");
ok(by.iss.months === 0 && by.iss.spread === null && by.iss.verdict === "few", "a factor on which every company ties forms no top and bottom");
ok(by.gpa.names < 120 && by.ey.names === 120, "ratios that do not fit banks leave them out; the rest keep them");
eq(by.gpa.ic.map((r) => r.h), UNIVERSE_HORIZONS, "rank skill is read at every horizon");
ok(by.gpa.ic[3].n < by.gpa.ic[0].n, "longer horizons have fewer finished months");
const fam = Object.fromEntries(res.families.map((f) => [f.key, f]));
ok(fam.profitability.t > 3 && fam.profitability.slope > 0 && fam.profitability.first > 0 && fam.profitability.second > 0, "the regression credits the planted family");
ok(Math.abs(fam.earnings.t) < 2.5 && Math.abs(fam.momentum.t) < 2.5, "and not the noise families");
ok(res.composite.ic[0].ic > 0 && res.composite.months === res.months, "the combined score is scored on the same months");

// No planted factor: nothing holds.
{
  const flat = evaluateUniverse(universeFixture({ plant: null, seed: 5 }), { size: 120, minNames: 100 });
  ok(flat.factors.every((f) => !["holds", "reversed"].includes(f.verdict) || f.key === "size"), "with no planted factor nothing passes the bar");
  ok(Math.abs(Object.fromEntries(flat.families.map((f) => [f.key, f])).profitability.t) < res.families.find((f) => f.key === "profitability").t, "and the regression credits nothing");
}

// The split company: market value is continuous across the split.
{
  const { prepare, factorsAt } = _test;
  const cal = fx.universe.calendar, c = prepare(fx.universe.companies[3], fx.facts.U003, fx.prices.U003, cal);
  const monthEnds = [], keys = [];
  for (let i = 0; i < cal.length; i++) { const k = new Date(Date.UTC(2000, 0, 1) + cal[i] * 86400000).toISOString().slice(0, 7); if (keys[keys.length - 1] === k) monthEnds[monthEnds.length - 1] = i; else { keys.push(k); monthEnds.push(i); } }
  const at = (key) => { const m = keys.indexOf(key), i = monthEnds[m]; return { cap: factorsAt(c, i, cal[i], monthEnds, m).cap, px: c.px[i] }; };
  const before = at("2015-05"), after = at("2015-08");
  near(after.cap / before.cap, after.px / before.px, 0.02, "market value moves with the price across a split, not with the share count as filed");
}

// The data problems planted in the made-up universe leave market value where it should be.
{
  const { prepare, factorsAt } = _test;
  const cal = fx.universe.calendar, monthEnds = [], keys = [];
  for (let i = 0; i < cal.length; i++) { const k = new Date(Date.UTC(2000, 0, 1) + cal[i] * 86400000).toISOString().slice(0, 7); if (keys[keys.length - 1] === k) monthEnds[monthEnds.length - 1] = i; else { keys.push(k); monthEnds.push(i); } }
  const prep = (k) => { const sym = "U" + String(k).padStart(3, "0"); return prepare(fx.universe.companies[k], fx.facts[sym], fx.prices[sym], cal); };
  const at = (c, key) => { const m = keys.indexOf(key), i = monthEnds[m]; return { cap: factorsAt(c, i, cal[i], monthEnds, m).cap, px: c.px[i], shares: _test.sharesAt(c.shares, cal[i]) }; };
  const today = (k) => fx.universe.companies[k].q.so;
  // Thousands: the count is in single shares again, through all of its history.
  const thousands = prep(5);
  ok(thousands.check.state === "ok" && thousands.shares.info.rescaled > 30, "a company that files its counts in thousands is rescaled and matches today's quote");
  near(at(thousands, "2013-06").shares / today(5), 1, 0.001, "and its count is right years back");
  // Per-share figures a million times too large for a quarter change nothing.
  const perShare = prep(6);
  ok(perShare.check.state === "ok" && perShare.shares.info.rescaled === 0, "a quarter of mis-scaled per-share figures does not touch the share counts");
  near(at(perShare, "2014-12").shares / today(6), 1, 0.001, "the count through that quarter is unchanged");
  // The depositary share: caught by today's quote.
  const adr = prep(7);
  ok(adr.check.state === "high" && Math.abs(adr.check.ratio - 10) < 0.01, "a price quoted per depositary share fails the quote check");
  // The spin-off: before the day the count is scaled the way the price history was, after it not.
  const spin = prep(8);
  eq(spin.shares.info.spins, 1, "the spin-off is not read as a split");
  near(at(spin, "2016-01").shares / today(8), SPIN_RATIO, 0.001, "before a spin-off, market value is the scaled price times the scaled count");
  near(at(spin, "2016-04").shares / today(8), 1, 0.001, "after it, the filed count");
  // A filing in thousands of dollars is set aside whole.
  const slipped = prep(11);
  eq(slipped.filingsLeft, 1, "a filing with its dollars in the wrong units is left out");
  const before = at(slipped, "2014-07"), during = at(slipped, "2014-09"), after = at(slipped, "2014-12");
  near(during.cap / during.px / (before.cap / before.px), 1, 0.001, "and the share count carries through it");
  ok(after.cap > 0, "the company stays in the test");
}

// No look-ahead: changing numbers filed after a date leaves earlier months untouched.
{
  const cut = dayNo("2016-01-01");
  const later = universeFixture();
  for (const f of Object.values(later.facts)) for (const [key, rows] of Object.entries(f)) f[key] = rows.map((r) => { const filed = r.length === 4 ? r[2] : r[1]; if (filed < cut) return r; const out = r.slice(); out[out.length - 1] = Math.round(out[out.length - 1] * 3); return out; });
  for (const p of Object.values(later.prices)) { const i0 = later.universe.calendar.findIndex((d) => d >= cut); p.c = p.c.map((v, i) => (i >= i0 ? v * 1.5 : v)); }
  const upTo = (fixture) => { const cal = fixture.universe.calendar, n = cal.findIndex((d) => d >= cut); return evaluateUniverse({ universe: { ...fixture.universe, calendar: cal.slice(0, n) }, prices: Object.fromEntries(Object.entries(fixture.prices).map(([s, p]) => [s, { ...p, c: p.c.slice(0, n), d: p.d.filter((x) => x[0] < n) }])), facts: fixture.facts }, { size: 120, minNames: 100 }); };
  eq(upTo(later), upTo(fx), "numbers filed after the last month tested change nothing before it");
}

// Thin data answers plainly.
eq(evaluateUniverse({ universe: { calendar: [1, 2, 3], companies: [] }, prices: {}, facts: {} }).status, "no-data", "too little history says so");
eq(evaluateUniverse(universeFixture({ companies: 40 }), { size: 120 }).status, "no-data", "too few companies says so");

// Public-safe: aggregates only, no company named.
{
  const text = JSON.stringify(res);
  ok(!/U\d{3}/.test(text) && !/Made-up company/.test(text), "the result names no company");
  ok(text.length < 20000, "and stays small (" + text.length + " bytes)");
  ok(!("ids" in res.factors[0]) && !("ls" in res.factors[0]), "no month-by-month rows are kept");
}
console.log(`factor-universe smoke: ok (${checks} checks)`);
