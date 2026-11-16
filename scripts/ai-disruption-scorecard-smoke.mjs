// Smoke test for the AI disruption Owner scorecard (lib/ai-disruption/scorecard.mjs,
// Phase 3). Made-up prices from scripts/ai-disruption-fixture.mjs: with no
// launch effect the tests must not find one, with a planted 3% fall they must,
// the "five days before" window must stay clean, results tests must find a
// planted link to launch pressure, and the same input must give the same
// answer. No network, no store.
//   node scripts/ai-disruption-scorecard-smoke.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDisruptionFiles, emptyState } from "../lib/ai-disruption/log.mjs";
import { buildScorecard, launchEvents, pressureAt, resultsTests, bhQ, spearman, phase4Gate, ROLE_WEIGHT } from "../lib/ai-disruption/scorecard.mjs";
import { isPremiumKey } from "../lib/premium-keys.mjs";
import { fixtureSeries, fixtureEarnings } from "./ai-disruption-fixture.mjs";
import { TICKERS } from "./build.mjs";

let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks += 1; };

const { pub } = buildDisruptionFiles({ state: emptyState(), tickers: TICKERS, builtAt: "2026-11-16T15:00:00Z" });
const launches = pub.launches;
const covered = pub.companies.filter((c) => c.coverage === "covered").map((c) => c.id);

// Helpers.
ok(Math.abs(spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-9, "spearman: same order is 1");
ok(Math.abs(spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-9, "spearman: reversed is -1");
const q = bhQ([0.01, 0.04, 0.03, null, 0.5]);
ok(q[3] === null && q[0] <= q[2] && q[2] <= q[1] && q[4] === 0.5, "bhQ keeps order and skips missing");
ok(Math.abs(q[0] - 0.04) < 1e-9, "bhQ: smallest p times tests over rank, capped by the next");

// No benchmark, no scorecard.
ok(buildScorecard({ launches, series: {}, earnings: { tickers: {} } }) === null, "no IGV bars = no scorecard");

// 1. Nothing planted: no effect found.
const flat = buildScorecard({ launches, series: fixtureSeries(launches, { drop: 0 }), earnings: fixtureEarnings(covered), companies: covered, builtAt: "2026-11-16T15:00:00Z" });
const allFlat = flat.moves.groups.find((g) => g.id === "all");
ok(flat.moves.events >= 150 && flat.moves.stocks >= 15, `events measured (${flat.moves.events} over ${flat.moves.stocks} stocks)`);
ok(allFlat.n === flat.moves.events, "the all group holds every event");
ok(["no-effect", "collecting"].includes(allFlat.windows.d2.verdict) && ["no-effect", "collecting"].includes(allFlat.windows.d5.verdict), "no planted effect: no verdict of a move");
ok(flat.moves.groups.every((g) => Object.values(g.windows).every((c) => c.q == null || (c.q >= c.p - 1e-9 && c.q <= 1))), "q is at least p and at most 1");
ok(flat.phase4.ready === false && flat.phase4.reasons.length >= 1, "no effect: the Phase 4 gate is not met");
ok(flat.moves.groups.every((g) => !g.id.startsWith("role:")), "role is not tested twice (outcome follows from it)");
ok(flat.moves.path && flat.moves.path.mean.length === 16 && flat.moves.path.mean[4] === 0, "path runs -5..+10 and starts from the close before the launch");
ok(flat.moves.path.lo.every((v, i) => v <= flat.moves.path.hi[i]), "placebo band low under high");

// A benchmark bar missing here and there (a holiday in one file only) must
// not break the placebo paths: those days drop out of the path band only.
{
  const gappy = fixtureSeries(launches, { drop: 0 });
  gappy.IGV = { rows: gappy.IGV.rows.filter((_, i) => i % 97 !== 50) };
  let sc = null, err = null;
  try { sc = buildScorecard({ launches, series: gappy, earnings: fixtureEarnings(covered), companies: covered }); } catch (e) { err = e; }
  ok(!err && sc && sc.moves.path && sc.moves.path.mean.every((v) => Number.isFinite(v)), `missing benchmark bars: scorecard still builds (${err ? err.message : "ok"})`);
}

// Same input, same answer.
const again = buildScorecard({ launches, series: fixtureSeries(launches, { drop: 0 }), earnings: fixtureEarnings(covered), companies: covered, builtAt: "2026-11-16T15:00:00Z" });
ok(JSON.stringify(again) === JSON.stringify(flat), "seeded: the same input gives the same scorecard");

// 2. A planted 3% fall the day after each launch.
const hit = buildScorecard({ launches, series: fixtureSeries(launches, { drop: 0.03 }), earnings: fixtureEarnings(covered), companies: covered });
const allHit = hit.moves.groups.find((g) => g.id === "all");
ok(allHit.windows.d2.verdict === "falls" && allHit.windows.d5.verdict === "falls", "planted fall: found in both after-windows");
ok(allHit.windows.d2.mean < -0.02, `planted fall size recovered (${allHit.windows.d2.mean})`);
ok(allHit.windows.pre.verdict !== "falls" && allHit.windows.pre.verdict !== "rises", "the before-window stays clean");
ok(hit.moves.halves.every((h) => h.mean < 0), "both halves fall");
ok(hit.phase4.ready === true, "planted fall: the Phase 4 gate passes (still needs the Owner)");
ok(hit.moves.perStock.length === hit.moves.stocks && hit.moves.perStock.every((s) => s.d2 < 0.02), "per-stock rows");

// Merging: two launches at one stock within three trading days count once.
const two = [
  { id: "2026-03-02-openai-a", date: "2026-03-02", lab: "openai", title: "A", score: 60, targets: [{ company: "ADBE", coverage: "covered", role: "core", outcome: "obsolescence" }] },
  { id: "2026-03-04-openai-b", date: "2026-03-04", lab: "openai", title: "B", score: 80, targets: [{ company: "ADBE", coverage: "covered", role: "core", outcome: "obsolescence" }] },
  { id: "2026-06-01-google-c", date: "2026-06-01", lab: "google", title: "C", score: 70, targets: [{ company: "ADBE", coverage: "covered", role: "core", outcome: "obsolescence" }, { company: "Canva", coverage: "private", role: "core", outcome: "obsolescence" }] },
];
const ev = launchEvents({ launches: two, series: fixtureSeries(two, { drop: 0 }) });
ok(ev.events.length === 2, "two launches three days apart count once; a private company is never measured");
ok(ev.events[0].ids.length === 2 && ev.events[0].title === "B" && ev.events[0].score === 80, "the merged event keeps the higher-scored launch and both ids");
ok(ev.events.every((e) => e.sym === "ADBE"), "only covered stocks");

// Pressure: score/100 times the role weight, launches in the 91 days before.
const pr = pressureAt(two, "ADBE", "2026-04-15");
ok(pr.launches === 2 && Math.abs(pr.pressure - (0.6 + 0.8) * ROLE_WEIGHT.core) < 1e-9, "pressure sums the two launches before the report");
ok(pressureAt(two, "ADBE", "2026-03-02").launches === 0, "a launch on the report day does not count");
ok(pressureAt(two, "ADBE", "2026-09-15").launches === 0, "launches older than 91 days drop out");

// 3. Results: plant "more pressure, worse surprise" and find it.
const earn = fixtureEarnings(covered, { seed: 5 });
for (const sym of covered) for (const e of earn.tickers[sym].events) e.surprisePct = 2 - 12 * pressureAt(launches, sym, e.date).pressure + 0.5 * Math.sin(e.date.length + e.surprisePct);
const res = resultsTests({ launches, earnings: earn, companies: covered, asOf: "2026-11-13" });
const eps = res.tests.find((t) => t.id === "eps");
ok(eps.n >= 60 && eps.pressured >= 10, `results: enough reports (${eps.n}, ${eps.pressured} with pressure)`);
ok(eps.verdict === "worse-after-pressure" && eps.rho < 0, `planted link found (rho ${eps.rho}, q ${eps.q})`);
ok(flat.results.tests.every((t) => t.verdict === "no-link" || t.verdict === "collecting"), "no planted link: none found");
ok(flat.results.tests.find((t) => t.id === "revenue").n > 0, "revenue growth change measured where four quarters back exist");

// Gate reasons read plainly when there are few events.
const tiny = phase4Gate({ groups: [{ id: "all", n: 5, windows: { d5: { verdict: "collecting", p: 0.5 }, pre: { p: 0.5 } } }], halves: null });
ok(!tiny.ready && tiny.reasons.some((r) => /bar is 40/.test(r)), "gate: under 40 events says so");

// Owner-only: never in the public file, and the Owner file is private.
ok(!("scorecard" in pub) && !JSON.stringify(pub).includes('"phase4"'), "the public file carries no scorecard");
ok(isPremiumKey("ai-disruption-owner.json") && !isPremiumKey("ai-disruption.json"), "Owner file private, public file public");

// The bake reuses the Event spillover bars (no download of its own).
const build = readFileSync(new URL("./build.mjs", import.meta.url), "utf8");
ok(/return \{ matrix, log, series: fetchedSeries \}/.test(build) && /buildDisruptionScorecard\(\{/.test(build), "the bake passes the spillover bars to the scorecard");
ok(!/fetch\(|yahooFinance/.test(readFileSync(new URL("../lib/ai-disruption/scorecard.mjs", import.meta.url), "utf8")), "the scorecard makes no network call");

console.log(`ai-disruption scorecard smoke: ok (${checks} checks; ${flat.moves.events} events, ${(JSON.stringify(flat).length / 1024).toFixed(0)} KB)`);
