// Offline checks for the wide tier (lib/wide-tier.mjs): member-list readers,
// the 30-day refresh and its fallbacks, the bar store, backfill caps, the
// post-close bar, the split guard, second share classes, the off switch,
// empty / partial / stale stores, the hourly re-mark, the in-session carry,
// the summaries, and the wiring (settings, storage ownership, access).
// Synthetic prices only (scripts/fixtures/wide-tier.mjs); no network.
//
//   node scripts/wide-tier-smoke.mjs
//   WIDE_SMOKE_SEED=other WIDE_SMOKE_ASOF=2026-10-14 node scripts/wide-tier-smoke.mjs
import assert from "node:assert/strict";
import * as W from "../lib/wide-tier.mjs";
import { SEED, fixtureRun, syntheticMarket, weekdays, sessionsAfter, sessionOnOrBefore } from "./fixtures/wide-tier.mjs";
import { buildHeatmapPerformance, TICKERS, SECTORS } from "./build.mjs";
import { OWNER_SETTINGS } from "../lib/owner-settings.mjs";
import { OPTIONAL_BAKE_KEYS, UNUSUAL_SHARED_KEYS } from "../lib/data-ownership.mjs";
import { isPremiumKey } from "../lib/premium-keys.mjs";
import { hydrationPolicy } from "../lib/data-hydration.mjs";
import { sessionForDate } from "../lib/us-equity-calendar.mjs";

const SEED_TEXT = process.env.WIDE_SMOKE_SEED || "wide";
// A setting on a holiday or weekend moves back to the session before it.
const AS_OF = sessionOnOrBefore(process.env.WIDE_SMOKE_ASOF || "2026-11-18");
// The wide tier, like the rest of the site, refuses dates outside the published
// NYSE calendar (lib/us-equity-calendar.mjs, 2026-2028): no post-close bar there.
if (!sessionForDate(AS_OF)) { console.error(`wide-tier-smoke: WIDE_SMOKE_ASOF ${AS_OF} is outside the NYSE calendar years in lib/us-equity-calendar.mjs`); process.exit(2); }
// The synthetic market starts about two and a half years before AS_OF.
const START = new Date(Date.parse(AS_OF + "T12:00:00Z") - 900 * 86400000).toISOString().slice(0, 10);
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("  ok  " + name); };

// --- member lists ---------------------------------------------------------------
await test("S&P CSV reader: quoted fields, BRK.B -> BRK-B, duplicates and junk dropped", () => {
  const csv = 'Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location,Date added,CIK,Founded\n' +
    'MMM,3M,Industrials,Industrial Conglomerates,"Saint Paul, Minnesota",1957-03-04,66740,1902\n' +
    'BRK.B,Berkshire Hathaway,Financials,Multi-Sector Holdings,"Omaha, Nebraska",2010-02-16,1067983,1839\n' +
    'MMM,3M again,Industrials,X,"Y",1,2,3\n' +
    '"bad sym",Nope,Industrials,X,"Y",1,2,3\n';
  const rows = W.parseSp500Csv(csv);
  assert.deepEqual(rows.map((r) => r.t), ["MMM", "BRK-B"]);
  assert.equal(rows[0].sec, "Industrials");
  assert.equal(rows[1].ind, "Multi-Sector Holdings");
  assert.deepEqual(W.parseSp500Csv("Ticker,Name\nA,B"), [], "a file without the expected columns reads as empty");
});

await test("Nasdaq-100 YAML reader: start list plus dated changes, bad lines refused", () => {
  const yaml = "---\nyear: 2026\ntickers_on_Jan_1:\n  - AAPL\n  - MSFT\n  - OLD\nchanges:\n  \"2026-03-02\":\n    union:\n      - NEW\n    difference:\n      - OLD\n  \"2026-12-21\":\n    union:\n      - LATE\n    difference:\n      - MSFT\n";
  const parsed = W.parseNdxYaml(yaml);
  assert.equal(parsed.year, 2026);
  assert.deepEqual(W.ndxMembersOn(parsed, "2026-01-10").members, ["AAPL", "MSFT", "OLD"]);
  assert.deepEqual(W.ndxMembersOn(parsed, "2026-03-02").members, ["AAPL", "MSFT", "NEW"], "a change counts from its effective date");
  assert.deepEqual(W.ndxMembersOn(parsed, "2026-12-31").members, ["AAPL", "LATE", "NEW"]);
  assert.throws(() => W.parseNdxYaml("year: 2026\ntickers_on_Jan_1:\n  - AAPL\nweird:\n  stuff here\n"), /unexpected/);
  assert.throws(() => W.parseNdxYaml("year: 2026\n"), /no year or no start list/);
});

await test("merge: both-index names marked SN, Nasdaq-only names keep a prior non-S&P sector", () => {
  const list = W.mergeMembers(
    [{ t: "AAPL", n: "Apple", sec: "Information Technology", ind: "Hardware" }],
    ["AAPL", "ASML"],
    [{ t: "ASML", n: "ASML", sec: "Information Technology", ind: "Semis", src: "yahoo" }],
  );
  assert.equal(list.find((m) => m.t === "AAPL").idx, "SN");
  const asml = list.find((m) => m.t === "ASML");
  assert.equal(asml.idx, "N");
  assert.equal(asml.sec, "Information Technology");
  // A name that left the S&P but stays in the Nasdaq-100 loses its S&P sector (re-read from Yahoo).
  const left = W.mergeMembers([], ["XYZ"], [{ t: "XYZ", n: "X", sec: "Energy", ind: "Oil", src: "sp500" }]);
  assert.equal(left[0].sec, null);
});

await test("committed seed: 500+ S&P names, ~100 Nasdaq-100, no second share class, dated sources", () => {
  const sp = SEED.list.filter((m) => m.idx.includes("S")).length, ndx = SEED.list.filter((m) => m.idx.includes("N")).length;
  assert.ok(sp >= W.WIDE_LIMITS.spMin && sp <= W.WIDE_LIMITS.spMax, "S&P count " + sp);
  assert.ok(ndx >= W.WIDE_LIMITS.ndxMin && ndx <= W.WIDE_LIMITS.ndxMax, "NDX count " + ndx);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(SEED.asOf));
  assert.equal(SEED.sources.length, 2);
  for (const s of SEED.sources) assert.ok(s.url && s.read, "source " + s.id + " has a link and a read date");
  const syms = new Set(SEED.list.map((m) => m.t));
  assert.ok(syms.has("BRK-B") && !syms.has("BRK.B"), "Yahoo symbols");
  for (const m of SEED.list) assert.ok(/^[A-Z][A-Z0-9-]{0,7}$/.test(m.t), "symbol " + m.t);
  for (const m of SEED.list.filter((x) => x.idx.includes("S"))) assert.ok(W.GICS_SECTORS.includes(m.sec), m.t + " has a GICS sector");
});

const fakeLists = ({ spRows = 503, ndxRows = 101, ndxFails = false } = {}) => {
  const sp = SEED.list.filter((m) => m.idx.includes("S")).slice(0, spRows);
  const ndx = SEED.list.filter((m) => m.idx.includes("N")).slice(0, ndxRows);
  const csv = "Symbol,Security,GICS Sector,GICS Sub-Industry\n" + sp.map((m) => `${m.t.replace(/-/g, ".")},"${m.n.replace(/"/g, '""')}",${m.sec},"${m.ind || ""}"`).join("\n");
  const yaml = "year: 2026\ntickers_on_Jan_1:\n" + ndx.map((m) => "  - " + m.t).join("\n") + "\nchanges:\n  \"2026-02-02\":\n    union:\n      - ZZZZ\n    difference:\n      - " + ndx[0].t + "\n";
  const reads = [];
  const fetchText = async (url) => {
    reads.push(url);
    if (url.includes("constituents")) return csv;
    if (ndxFails && url.includes("2026")) throw new Error("HTTP 404");
    return yaml.replace("year: 2026", "year: " + (url.match(/(\d{4})\.yaml/)?.[1] || 2026));
  };
  return { fetchText, reads };
};

await test("member refresh: a fresh list is not re-read; an old one is; failures keep the prior list", async () => {
  const now = Date.parse("2026-11-20T15:00:00Z");
  const fresh = { ...SEED, checkedAt: "2026-11-10T00:00:00Z" };
  const a = fakeLists();
  let r = await W.refreshMembers({ prior: fresh, nowMs: now, fetchText: a.fetchText });
  assert.equal(r.fetched, 0); assert.equal(a.reads.length, 0); assert.equal(r.members, fresh);
  const old = { ...SEED, checkedAt: "2026-09-01T00:00:00Z" };
  r = await W.refreshMembers({ prior: old, nowMs: now, fetchText: a.fetchText });
  assert.equal(r.refreshed, true); assert.equal(r.fetched, 2);
  assert.ok(r.members.list.some((m) => m.t === "ZZZZ"), "dated Nasdaq change applied");
  assert.equal(r.members.sources[1].lastChange, "2026-02-02");
  const short = fakeLists({ spRows: 300 });
  r = await W.refreshMembers({ prior: old, nowMs: now, fetchText: short.fetchText });
  assert.equal(r.refreshed, false); assert.equal(r.members.list, old.list); assert.match(r.members.lastError, /300 rows/);
  r = await W.refreshMembers({ prior: old, nowMs: now, fetchText: async () => { throw new Error("offline"); } });
  assert.equal(r.refreshed, false); assert.equal(r.members.list, old.list); assert.match(r.members.lastError, /offline/);
  // Early January: this year's Nasdaq file missing -> last year's, all changes applied.
  const jan = fakeLists({ ndxFails: true });
  r = await W.refreshMembers({ prior: { ...SEED, checkedAt: "2025-11-01T00:00:00Z" }, nowMs: Date.parse("2026-01-02T15:00:00Z"), fetchText: jan.fetchText });
  assert.equal(r.refreshed, true, "fell back to last year's file");
  assert.ok(jan.reads.some((u) => /2025\.yaml/.test(u)));
});

// --- bars, numbers -------------------------------------------------------------
await test("bar store: aligned columns, out-of-order dates, trim keeps newest", () => {
  const b = W.emptyBars();
  W.setBar(b, "A", "2026-01-05", 10, 100);
  W.setBar(b, "A", "2026-01-02", 9, 90);
  W.setBar(b, "B", "2026-01-06", 20, 200);
  assert.deepEqual(b.dates, ["2026-01-02", "2026-01-05", "2026-01-06"]);
  assert.deepEqual(b.c.A, [9, 10, null]); assert.deepEqual(b.c.B, [null, null, 20]);
  assert.equal(W.setBar(b, "A", "bad", 1, 1), false); assert.equal(W.setBar(b, "A", "2026-01-07", -1, 1), false);
  W.setBar(b, "A", "2026-01-05", 11, undefined);
  assert.equal(b.v.A[1], 100, "an undefined volume keeps the stored one");
  W.trimBars(b, ["A"], 2);
  assert.deepEqual(b.dates, ["2026-01-02", "2026-01-05"], "dates only B had are dropped with B, then the newest 2 kept");
  assert.equal(b.c.B, undefined);
});

await test("returns use the tracked heat map's calendar rule (buildHeatmapPerformance)", () => {
  const days = weekdays("2025-01-02", AS_OF);
  const m = syntheticMarket({ days, seed: SEED_TEXT });
  const series = m.path("TEST");
  const last = series[series.length - 1];
  const mine = W.perfFrom(series, last.c, last.t);
  const theirs = buildHeatmapPerformance({ priceSeries: series.map((b) => ({ t: b.t, c: b.c })), spot: last.c }, last.t + "T21:00:00Z");
  for (const p of ["1w", "1m", "3m", "1y", "ytd"]) {
    if (theirs.perf[p] == null) continue;
    assert.equal(mine.perf[p], theirs.perf[p], p + " return");
    assert.equal(mine.perfStart[p], theirs.perfStart[p], p + " baseline date");
  }
});

await test("series numbers: 52-week levels exclude the last bar, relative volume vs the 50 before", () => {
  const series = [];
  for (let i = 0; i < 260; i++) series.push({ t: "d" + String(i).padStart(4, "0"), c: 100 + (i % 10), v: 1000 });
  series.push({ t: "d9999", c: 150, v: 3500 });
  const st = W.seriesStats(series);
  assert.equal(st.hi52, 109); assert.equal(st.lo52, 100);
  assert.equal(st.rv, 3.5); assert.equal(st.av50, 1000);
  assert.ok(st.close > st.hi52, "the last close is a new high against the window before it");
});

// --- the bake --------------------------------------------------------------------
const base = await fixtureRun({ asOf: AS_OF, seed: SEED_TEXT, unusual: { scannedAt: AS_OF + "T20:30:00Z", tickers: [{ symbol: "AAPL", contracts: [{}] }, { symbol: "ZZZZ", contracts: [] }] } });
const P = base.out.payload;

await test("full run: every member and extra has a row, none missing, funds present, SPY axis kept", () => {
  assert.equal(base.out.backlog, 0);
  assert.equal(P.counts.missing, 0, "missing: " + P.missing.join(","));
  const syms = new Set(P.tickers.map((r) => r.t));
  for (const m of SEED.list) if (!W.SECOND_CLASS[m.t]) assert.ok(syms.has(m.t), "row for " + m.t);
  for (const x of W.WIDE_EXTRAS) assert.ok(syms.has(x), "row for extra " + x);
  for (const [f] of W.SECTOR_FUNDS) assert.ok(P.tickers.some((r) => r.t === f && r.fund), "fund " + f);
  assert.ok(base.out.state.bars.c.SPY, "SPY bars stored for the breadth axis");
  assert.equal(P.asOf, AS_OF);
  assert.equal(P.enabled, true);
});

await test("second share classes are left out so a company counts once", () => {
  const syms = new Set(P.tickers.map((r) => r.t));
  for (const [second, first] of Object.entries(W.SECOND_CLASS)) {
    assert.ok(!syms.has(second), second + " left out");
    if (SEED.list.some((m) => m.t === first)) assert.ok(syms.has(first), first + " kept");
  }
});

await test("tracked names are flagged and grouped; unusual options only from a fresh scan", () => {
  const aapl = P.tickers.find((r) => r.t === "AAPL");
  assert.equal(aapl.tr, 1); assert.equal(aapl.g, "Synthetic group");
  assert.ok(!P.tickers.find((r) => r.t === "ORCL")?.tr);
  assert.ok(P.worth.list.some((w) => w.t === "AAPL" && w.why.includes("options")) || P.worth.counts.options === 1);
  assert.equal(W.unusualSymbols({ scannedAt: new Date(Date.parse(AS_OF + "T21:00:00Z") - 3 * 86400000).toISOString(), tickers: [{ symbol: "AAPL", contracts: [{}] }] }, Date.parse(AS_OF + "T21:00:00Z")).size, 0, "a scan older than 36 hours counts as none");
});

await test("rows: sector labels, market value rounding, 52-week levels and earnings dates are sane", () => {
  for (const r of P.tickers) {
    if (r.fund) { assert.equal(r.s, "Sector funds"); continue; }
    assert.ok(W.GICS_SECTORS.includes(r.s) || r.s === "Unclassified", r.t + " sector " + r.s);
    if (r.mc != null) assert.equal(r.mc, Number(r.mc.toPrecision(4)));
    if (r.hi52 != null) assert.ok(r.hi52 >= r.lo52);
    if (r.er) assert.ok(r.er >= AS_OF, r.t + " earnings date in the future: " + r.er);
    assert.equal(r.pc, r.sp, "the bake's last close");
  }
  const yahooSourced = P.tickers.filter((r) => r.ss === "yahoo");
  assert.ok(yahooSourced.length > 0 && yahooSourced.every((r) => !r.x.includes("S")), "only non-S&P names take Yahoo's sector");
});

await test("sector table: 11 GICS sectors with their funds, our groups only from tracked names", () => {
  assert.equal(P.sectorTable.sectors.length, 11);
  for (const s of P.sectorTable.sectors) {
    assert.ok(s.fund && s.fundRet, s.name + " has a fund return");
    const fundRow = P.tickers.find((r) => r.t === s.fund);
    assert.equal(s.fundRet["1d"], fundRow.ch);
    assert.equal(s.n, P.tickers.filter((r) => !r.fund && r.s === s.name).length, s.name + " member count");
  }
  assert.equal(P.sectorTable.ours.length, 1);
  assert.equal(P.sectorTable.ours[0].n, P.tickers.filter((r) => r.tr).length);
  const totalAbove = P.sectorTable.sectors.reduce((a, s) => a + s.n, 0) + P.sectorTable.unclassified;
  assert.equal(totalAbove, P.counts.names, "every stock is in one sector row or counted unclassified");
});

await test("worth a look: rule reasons only, ranked, capped at 20, counts add up", () => {
  const w = P.worth;
  assert.ok(w.list.length <= W.WIDE_LIMITS.worthMax);
  for (const item of w.list) {
    const r = P.tickers.find((x) => x.t === item.t);
    if (item.why.includes("high")) assert.ok(r.sp > r.hi52);
    if (item.why.includes("volume")) assert.ok(r.rv >= W.WIDE_LIMITS.volumeX);
    if (item.why.includes("earnings")) assert.ok(item.er >= AS_OF && item.er <= new Date(Date.parse(AS_OF) + 10 * 86400000).toISOString().slice(0, 10));
  }
  for (let i = 1; i < w.list.length; i++) assert.ok(w.list[i - 1].score >= w.list[i].score, "ranked by score");
  assert.equal(w.list.length + w.more, Object.values(w.counts).length ? new Set(P.tickers.filter((r) => !r.fund && (r.sp > r.hi52 && r.hi52 > 0 || r.rv >= 3 || r.t === "AAPL" || (r.er && r.er >= AS_OF && r.er <= new Date(Date.parse(AS_OF) + 10 * 86400000).toISOString().slice(0, 10)))).map((r) => r.t)).size : 0);
});

await test("breadth series has the Market map shape and SPY's dates", () => {
  const b = P.breadth;
  for (const k of ["dates", "spy", "a50", "a200", "hi", "lo", "upv", "n"]) assert.ok(Array.isArray(b[k]), "breadth." + k);
  for (const k of ["spy", "a50", "a200", "hi", "lo", "upv", "n"]) assert.equal(b[k].length, b.dates.length, k + " aligned");
  assert.equal(b.dates[b.dates.length - 1], AS_OF);
  assert.ok(b.n[b.n.length - 1] > 400, "most names counted on the last day");
});

await test("size: the public file stays under 260 KB; the private state under 6 MB", () => {
  const pub = JSON.stringify(P).length, priv = JSON.stringify(base.out.state).length;
  console.log(`       public ${Math.round(pub / 1024)} KB, private ${(priv / 1048576).toFixed(2)} MB`);
  assert.ok(pub < 260 * 1024); assert.ok(priv < 6 * 1048576);
});

// --- costs and caps ----------------------------------------------------------------
await test("first-run cost: backfill capped per run, one quote pass, profiles capped, members not re-read", async () => {
  const days = weekdays(START, AS_OF);
  const m = syntheticMarket({ days, seed: SEED_TEXT });
  const now = Date.parse(AS_OF + "T21:20:00Z");
  const r1 = await W.runWideTier({ nowMs: now, seedMembers: SEED, tracked: ["AAPL"], chainBarsOf: m.chainBarsOf, quote: m.quote, chart: m.chart, profile: m.profile, fetchText: async () => { throw new Error("must not read"); } });
  assert.equal(r1.cost.chartCalls, W.WIDE_LIMITS.backfillPerRun);
  assert.equal(r1.cost.quoteCalls, Math.ceil((P.counts.names + 11) / W.WIDE_LIMITS.quoteChunk), "one batched pass over every name and fund");
  assert.ok(r1.cost.profileCalls <= W.WIDE_LIMITS.profilesPerRun);
  assert.equal(r1.cost.memberReads, 0, "the seed is fresh (under 30 days old)");
  assert.ok(r1.backlog > 300);
  const r2 = await W.runWideTier({ nowMs: now + 1000, priorState: r1.state, seedMembers: SEED, tracked: ["AAPL"], chainBarsOf: m.chainBarsOf, quote: m.quote, chart: m.chart, profile: m.profile });
  assert.equal(r2.cost.chartCalls, W.WIDE_LIMITS.backfillPerRun);
  assert.equal(r2.backlog, r1.backlog - W.WIDE_LIMITS.backfillPerRun);
  // An in-session bake (no first quote) takes no quote pass.
  const inSession = Date.parse(AS_OF + "T16:00:00Z");
  const r3 = await W.runWideTier({ nowMs: inSession, priorState: r2.state, seedMembers: SEED, tracked: ["AAPL"], chainBarsOf: m.chainBarsOf, quote: m.quote, chart: m.chart, profile: m.profile, backfillPerRun: 0 });
  assert.equal(r3.cost.quoteCalls, 0); assert.equal(r3.cost.chartCalls, 0);
});

await test("steady post-close bake: quote pass only (no chart calls), today's bar added", async () => {
  const next = sessionsAfter(AS_OF, 1)[0];
  const days = weekdays(START, next);
  const m = syntheticMarket({ days, seed: SEED_TEXT });
  const now = Date.parse(next + "T21:20:00Z");
  const r = await W.runWideTier({ nowMs: now, priorState: structuredClone(base.out.state), seedMembers: SEED, tracked: ["AAPL"], chainBarsOf: m.chainBarsOf, quote: m.quote, chart: m.chart, profile: m.profile });
  assert.equal(r.cost.chartCalls, 0); assert.ok(r.cost.quoteCalls >= 10 && r.cost.quoteCalls <= 12, "quote calls " + r.cost.quoteCalls);
  assert.equal(r.payload.asOf, next);
  const orcl = r.payload.tickers.find((x) => x.t === "ORCL");
  assert.equal(orcl.d, next); assert.equal(orcl.sp, m.path("ORCL").at(-1).c);
});

await test("in-session bake never stores today's unfinished bar (chain or chart)", async () => {
  const next = sessionsAfter(AS_OF, 1)[0];
  const days = weekdays(START, next);
  const m = syntheticMarket({ days, seed: SEED_TEXT });
  const now = Date.parse(next + "T16:00:00Z"); // 11:00 ET
  const r = await W.runWideTier({ nowMs: now, priorState: structuredClone(base.out.state), seedMembers: SEED, tracked: ["AAPL"], chainBarsOf: m.chainBarsOf, quote: m.quote, chart: m.chart, profile: m.profile });
  assert.ok(!r.state.bars.dates.includes(next));
  assert.equal(r.payload.asOf, AS_OF);
});

await test("split guard: a stored close far from Yahoo's previous close is refetched next bake, no bad bar", async () => {
  const next = sessionsAfter(AS_OF, 1)[0];
  const days = weekdays(START, next);
  const m = syntheticMarket({ days, seed: SEED_TEXT });
  m.overrides.set("ORCL", { prevCloseMult: 0.5 });
  const now = Date.parse(next + "T21:20:00Z");
  const r = await W.runWideTier({ nowMs: now, priorState: structuredClone(base.out.state), seedMembers: SEED, tracked: [], chainBarsOf: m.chainBarsOf, quote: m.quote, chart: m.chart, profile: m.profile });
  assert.ok(r.state.refetch.includes("ORCL"));
  const i = r.state.bars.dates.indexOf(next);
  assert.equal(r.state.bars.c.ORCL[i], null, "no bar on the new share basis");
  m.overrides.delete("ORCL");
  const before = m.calls.chart;
  const r2 = await W.runWideTier({ nowMs: now + 60000, priorState: r.state, seedMembers: SEED, tracked: [], chainBarsOf: m.chainBarsOf, quote: m.quote, chart: m.chart, profile: m.profile });
  assert.equal(m.calls.chart - before, 1, "one chart call refetches it");
  assert.ok(!r2.state.refetch.includes("ORCL"));
  assert.equal(r2.payload.tickers.find((x) => x.t === "ORCL").d, next);
});

await test("off switch: the file says off, the state is untouched, no calls", async () => {
  const m = syntheticMarket({ days: weekdays("2026-01-02", AS_OF) });
  const prior = base.out.state;
  const r = await W.runWideTier({ enabled: false, priorState: prior, quote: m.quote, chart: m.chart, profile: m.profile });
  assert.equal(r.payload.enabled, false); assert.equal(r.state, prior);
  assert.equal(m.calls.quote + m.calls.chart + m.calls.profile, 0);
  assert.equal(W.wideTierEnabled({ WIDE_TIER: "0" }), false);
  assert.equal(W.wideTierEnabled({}), true); assert.equal(W.wideTierEnabled({ WIDE_TIER: "1" }), true);
  const h = W.refreshWideIntraday(r.payload, {}, {});
  assert.equal(h.payload, r.payload, "the hourly job leaves an off file alone");
});

await test("empty store with no network: tracked names only, the rest listed as missing, no crash", async () => {
  const m = syntheticMarket({ days: weekdays(START, AS_OF), seed: SEED_TEXT });
  const r = await W.runWideTier({ nowMs: Date.parse(AS_OF + "T16:00:00Z"), seedMembers: SEED, tracked: ["AAPL", "MSFT"], chainBarsOf: m.chainBarsOf });
  assert.deepEqual(r.payload.tickers.map((x) => x.t).sort(), ["AAPL", "MSFT"]);
  assert.ok(r.payload.counts.missing > 400);
  assert.ok(!r.payload.breadth || Math.max(...r.payload.breadth.n) <= 2, "breadth counts only the names that have bars");
});

await test("stale names: a name whose quotes stopped is marked stale, not shown as current", async () => {
  const next = sessionsAfter(AS_OF, 1)[0];
  const m = syntheticMarket({ days: weekdays(START, next), seed: SEED_TEXT });
  m.overrides.set("ORCL", { noQuote: true });
  const r = await W.runWideTier({ nowMs: Date.parse(next + "T21:20:00Z"), priorState: structuredClone(base.out.state), seedMembers: SEED, tracked: [], chainBarsOf: m.chainBarsOf, quote: m.quote, chart: m.chart, profile: m.profile });
  const orcl = r.payload.tickers.find((x) => x.t === "ORCL");
  assert.equal(orcl.stale, 1); assert.equal(orcl.d, AS_OF);
});

await test("partial store: names short of history are backfilled, the rest left alone", async () => {
  const st = structuredClone(base.out.state);
  for (const s of ["ORCL", "KO", "PEP"]) W.dropSymbol(st.bars, s);
  const m = syntheticMarket({ days: weekdays(START, AS_OF), seed: SEED_TEXT });
  const r = await W.runWideTier({ nowMs: Date.parse(AS_OF + "T16:00:00Z"), priorState: st, seedMembers: SEED, tracked: [], chainBarsOf: m.chainBarsOf, quote: m.quote, chart: m.chart, profile: m.profile });
  assert.equal(r.cost.chartCalls, 3); assert.equal(r.backlog, 0);
});

await test("refetch queue longer than the cap: names keep their old bars until their own read succeeds", async () => {
  const st = structuredClone(base.out.state);
  const names = P.tickers.filter((r) => !r.fund).slice(0, 5).map((r) => r.t);
  st.refetch = names.slice();
  const m = syntheticMarket({ days: weekdays(START, AS_OF), seed: SEED_TEXT });
  const r = await W.runWideTier({ nowMs: Date.parse(AS_OF + "T16:00:00Z"), priorState: st, seedMembers: SEED, tracked: [], chainBarsOf: m.chainBarsOf, quote: m.quote, chart: m.chart, profile: m.profile, backfillPerRun: 2 });
  assert.equal(r.cost.chartCalls, 2);
  assert.equal(r.state.refetch.length, 3, "three still queued");
  for (const s of names) assert.ok(r.payload.tickers.some((x) => x.t === s), s + " stays on the map");
});

await test("young listing (under 260 sessions): one chart read a day, not one every bake", async () => {
  const st = structuredClone(base.out.state);
  const sym = "ORCL";
  const youngFrom = new Date(Date.parse(AS_OF + "T12:00:00Z") - 270 * 86400000).toISOString().slice(0, 10);
  const m = syntheticMarket({ days: weekdays(youngFrom, AS_OF), seed: SEED_TEXT }); // ~185 sessions only
  W.dropSymbol(st.bars, sym);
  st.tried = {};
  const at = Date.parse(AS_OF + "T15:00:00Z");
  const r1 = await W.runWideTier({ nowMs: at, priorState: st, seedMembers: SEED, tracked: [], chainBarsOf: m.chainBarsOf, quote: m.quote, chart: m.chart, profile: m.profile });
  assert.equal(r1.cost.chartCalls, 1);
  assert.ok(r1.payload.tickers.some((x) => x.t === sym), "shown with the history it has");
  // An hour later, still in session (13:00 ET is the close on a half day).
  const r2 = await W.runWideTier({ nowMs: at + 3600000, priorState: r1.state, seedMembers: SEED, tracked: [], chainBarsOf: m.chainBarsOf, quote: m.quote, chart: m.chart, profile: m.profile });
  assert.equal(r2.cost.chartCalls, 0, "not again the same day");
  const nextDayIso = sessionsAfter(AS_OF, 1)[0];
  const m3 = syntheticMarket({ days: weekdays(youngFrom, nextDayIso), seed: SEED_TEXT });
  const r3 = await W.runWideTier({ nowMs: Date.parse(nextDayIso + "T15:00:00Z"), priorState: r2.state, seedMembers: SEED, tracked: [], chainBarsOf: m3.chainBarsOf, quote: m3.quote, chart: m3.chart, profile: m3.profile });
  assert.equal(r3.cost.chartCalls, 1, "tried again the next day");
});

await test("hole guard: two missed post-close bakes queue a refetch; one missed bake heals from the previous close", async () => {
  const [d1, d2, d3] = sessionsAfter(AS_OF, 3);
  const m = syntheticMarket({ days: weekdays(START, d3), seed: SEED_TEXT });
  // One missed bake (d1): the d2 post-close fills d1 from the previous close.
  const one = await W.runWideTier({ nowMs: Date.parse(d2 + "T21:20:00Z"), priorState: structuredClone(base.out.state), seedMembers: SEED, tracked: [], chainBarsOf: m.chainBarsOf, quote: (l) => m.quote(l, { day: d2 }), chart: m.chart, profile: m.profile });
  const i1 = one.state.bars.dates.indexOf(d1);
  assert.ok(i1 >= 0 && one.state.bars.c.ORCL[i1] > 0, "d1 healed");
  assert.equal(one.state.refetch.length, 0);
  // Two missed bakes (d1, d2): d1 has no close, so names are queued.
  const two = await W.runWideTier({ nowMs: Date.parse(d3 + "T21:20:00Z"), priorState: structuredClone(base.out.state), seedMembers: SEED, tracked: [], chainBarsOf: m.chainBarsOf, quote: (l) => m.quote(l, { day: d3 }), chart: m.chart, profile: m.profile, backfillPerRun: 0 });
  assert.ok(two.state.refetch.includes("ORCL"), "ORCL queued for a refetch");
  const fixed = await W.runWideTier({ nowMs: Date.parse(d3 + "T21:30:00Z"), priorState: two.state, seedMembers: SEED, tracked: [], chainBarsOf: m.chainBarsOf, quote: (l) => m.quote(l, { day: d3 }), chart: m.chart, profile: m.profile, backfillPerRun: 1000 });
  const j = fixed.state.bars.dates.indexOf(d1);
  assert.ok(fixed.state.bars.c.ORCL[j] > 0, "the refetch fills the hole");
  assert.equal(fixed.state.refetch.length, 0);
});

// --- hourly and the in-session carry ------------------------------------------------
const nextDay = sessionsAfter(AS_OF, 1)[0];
const liveQuotes = (payload, { mult = 1.02, state = "REGULAR", prevMult = 1 } = {}) => Object.fromEntries(payload.tickers.map((r) => [r.t, {
  symbol: r.t, regularMarketPrice: Math.round(r.pc * mult * 100) / 100, regularMarketChangePercent: (mult - 1) * 100,
  regularMarketPreviousClose: r.pc * prevMult, regularMarketVolume: r.av50 ? r.av50 * 0.5 : 0, marketState: state, marketCap: (r.mc || 1e9) * mult,
}]));

await test("hourly re-mark: price, 1D, every longer return from its baseline, volume against the time of day", () => {
  const q = liveQuotes(P);
  const h = W.refreshWideIntraday(P, q, { nowIso: nextDay + "T16:00:00Z", expectedFrac: 0.5 });
  assert.equal(h.refreshed, P.tickers.length); assert.equal(h.stale, 0);
  const a = P.tickers.find((r) => r.t === "ORCL"), b = h.payload.tickers.find((r) => r.t === "ORCL");
  assert.equal(b.ch, 2);
  for (const p of Object.keys(a.perf)) {
    const baseA = a.sp / (1 + a.perf[p] / 100), baseB = b.sp / (1 + b.perf[p] / 100);
    assert.ok(Math.abs(baseA / baseB - 1) < 0.0005, p + " baseline unchanged");
  }
  assert.ok(Math.abs(b.rv - 1) < 0.02, "half the normal volume at half the day reads 1x");
  assert.equal(b.pc, a.pc, "the stored close is kept");
  assert.equal(h.payload.refreshedAtIso, nextDay + "T16:00:00Z");
  // A second hourly run on the re-marked file gives the same result for the same quotes.
  const h2 = W.refreshWideIntraday(h.payload, q, { nowIso: nextDay + "T17:00:00Z", expectedFrac: 0.5 });
  assert.deepEqual(h2.payload.tickers.find((r) => r.t === "ORCL").perf, b.perf);
});

await test("hourly: a new session moves the last close into the 52-week window; pre-market does not", () => {
  const row = P.tickers.find((r) => r.hi52 > 0 && r.sp > r.hi52) || P.tickers.find((r) => r.hi52 > 0);
  const q = liveQuotes(P, { mult: 1.0 });
  const h = W.refreshWideIntraday(P, q, { nowIso: nextDay + "T16:00:00Z" });
  const after = h.payload.tickers.find((r) => r.t === row.t);
  assert.equal(after.hi52, Math.max(row.hi52, row.pc));
  const pre = liveQuotes(P, { mult: 1.0, state: "PRE", prevMult: 0.97 });
  const h2 = W.refreshWideIntraday(P, pre, { nowIso: nextDay + "T13:30:00Z" });
  assert.equal(h2.payload.tickers.find((r) => r.t === row.t).hi52, row.hi52, "pre-market quote is still yesterday's session");
  assert.equal(h2.payload.tickers.find((r) => r.t === row.t).rv, row.rv, "pre-market keeps the last session's volume read");
});

await test("hourly: a name with no quote keeps its row and is counted", () => {
  const q = liveQuotes(P); delete q.ORCL;
  const h = W.refreshWideIntraday(P, q, { nowIso: nextDay + "T16:00:00Z" });
  assert.equal(h.stale, 1);
  assert.deepEqual(h.payload.tickers.find((r) => r.t === "ORCL"), P.tickers.find((r) => r.t === "ORCL"));
});

await test("in-session bake keeps today's hourly marks; a new close or an old mark does not carry", () => {
  const h = W.refreshWideIntraday(P, liveQuotes(P), { nowIso: nextDay + "T16:05:00Z", expectedFrac: 0.4 }).payload;
  const rebuilt = { ...P, builtAtIso: nextDay + "T18:30:00Z", refreshedAtIso: nextDay + "T18:30:00Z" };
  const c = W.carryIntraday(rebuilt, h, { nowMs: Date.parse(nextDay + "T18:30:00Z") });
  assert.equal(c.carried, P.tickers.length);
  assert.equal(c.payload.refreshedAtIso, h.refreshedAtIso);
  assert.equal(c.payload.tickers.find((r) => r.t === "ORCL").ch, 2);
  // The next hourly run then the next bake: still carried.
  const h2 = W.refreshWideIntraday(c.payload, liveQuotes(P, { mult: 1.03 }), { nowIso: nextDay + "T19:05:00Z" }).payload;
  const c2 = W.carryIntraday({ ...P, builtAtIso: nextDay + "T20:30:00Z" }, h2, { nowMs: Date.parse(nextDay + "T20:30:00Z") });
  assert.equal(c2.payload.tickers.find((r) => r.t === "ORCL").ch, 3);
  // Marks from yesterday do not carry into today.
  assert.equal(W.carryIntraday(rebuilt, h, { nowMs: Date.parse(nextDay + "T18:30:00Z") + 86400000 }).carried, 0);
  // A rebuilt file with a newer close never takes older marks.
  assert.equal(W.carryIntraday({ ...rebuilt, asOf: nextDay }, h, { nowMs: Date.parse(nextDay + "T18:30:00Z") }).carried, 0);
  // A file nobody re-marked (built by a bake, never refreshed) carries nothing.
  assert.equal(W.carryIntraday(rebuilt, { ...P, builtAtIso: nextDay + "T15:00:00Z", refreshedAtIso: nextDay + "T15:00:00Z" }, { nowMs: Date.parse(nextDay + "T18:30:00Z") }).carried, 0);
});

// --- wiring ---------------------------------------------------------------------------
await test("wiring: Owner Settings switch, storage ownership, access, TICKERS move", () => {
  const sw = OWNER_SETTINGS.find((x) => x.key === "WIDE_TIER");
  assert.ok(sw && sw.scope === "build", "WIDE_TIER is a build switch");
  assert.ok(OPTIONAL_BAKE_KEYS.includes("wide-tier.json") && OPTIONAL_BAKE_KEYS.includes("wide-tier-state.json"));
  assert.ok(UNUSUAL_SHARED_KEYS.includes("wide-tier.json"), "the hourly job may push the public file");
  assert.ok(!UNUSUAL_SHARED_KEYS.includes("wide-tier-state.json"), "only the bake writes the state");
  assert.equal(isPremiumKey("wide-tier.json"), false, "the wide list is public");
  assert.equal(isPremiumKey("wide-tier-state.json"), true, "the state is private");
  assert.equal(hydrationPolicy({ owner: "bake" })("wide-tier-state.json"), true, "the bake pulls the bar store");
  assert.equal(hydrationPolicy({ owner: "unusual" })("wide-tier-state.json"), false, "the hourly job skips the 4 MB store");
  assert.equal(hydrationPolicy({ owner: "unusual" })("wide-tier.json"), true, "the hourly job pulls the public file");
  for (const s of W.WIDE_EXTRAS) {
    assert.ok(!TICKERS.includes(s), s + " left TICKERS");
    assert.ok(SECTORS[s], s + " keeps its SECTORS label for old records");
  }
});

console.log(`wide-tier-smoke: ${passed} checks passed (seed ${SEED_TEXT}, as of ${AS_OF})`);
