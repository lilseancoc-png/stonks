// Automatic engine data checks (lib/data-checks.mjs): coverage, believable
// values, freshness, and the guard that takes a failed feed away from the
// engines. Run: node scripts/data-checks-smoke.mjs (no npm script, so
// verify:risk-cost stays green).
import assert from "node:assert/strict";
import { checkEngineFeeds, guardEngineInputs, dataChecksMode, compactChecks, checksBriefLine, feedsSwitchedOff, barsProblem, priorSession, sessionsBehind, FEEDS } from "../lib/data-checks.mjs";
import { buildEngineViews } from "../lib/engines/index.mjs";
import { buildSourceHealth } from "../lib/source-health.mjs";
import { buildOwnerMarketBrief } from "../lib/owner-market-brief.mjs";
import { ownerSettingDef } from "../lib/owner-settings.mjs";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`); };

const TODAY = "2026-11-24"; // a Tuesday
const PRIOR = "2026-11-23";
const STOCKS = Array.from({ length: 20 }, (_, i) => `S${i}`);
const ETFS = ["SPY", "QQQ"];
const TICKERS = [...STOCKS, ...ETFS];

// 260 weekday bars ending on the prior session, a gentle drift.
function bars(base = 100, { lastDate = PRIOR, glitch = null } = {}) {
  const out = [];
  let d = new Date(lastDate + "T12:00:00Z");
  const dates = [];
  while (dates.length < 260) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) dates.unshift(d.toISOString().slice(0, 10)); d = new Date(d.getTime() - 86400000); }
  dates.forEach((t, i) => { const c = base * (1 + i * 0.0005); out.push({ t, o: c, h: c * 1.01, l: c * 0.99, c, v: 1e6 }); });
  if (glitch) glitch(out);
  return out;
}
function input(over = {}) {
  const chains = {}, barMap = {};
  for (const s of TICKERS) { barMap[s] = bars(); chains[s] = { spot: barMap[s][barMap[s].length - 1].c, earningsHx: { next: { date: "2026-12-10" } } }; }
  const policyNews = Object.fromEntries(STOCKS.map((s) => [s, { frn: 0, nvr: 1.1, ntn: 0.1 }]));
  const webullFlow = Object.fromEntries(STOCKS.map((s) => [s, { wfl: 5, wft: 1e6, wfl5: 3, date: PRIOR }]));
  const crowdRollup = STOCKS.map((s) => ({ symbol: s, shortZ20: 0.4, borrowFeePct: null }));
  const vix = bars(20).map((b) => ({ t: b.t, v: b.c }));
  const vix3m = bars(22).map((b) => ({ t: b.t, v: b.c }));
  const daily = (v) => bars(1).map((b) => ({ t: b.t, v }));
  const fred = { DGS10: daily(4.2), DGS2: daily(3.9), T10Y2Y: daily(0.3), DFF: daily(3.6), NFCI: daily(-0.4), DTWEXBGS: daily(120), CPIAUCSL: [{ t: "2026-10-01", v: 320 }], UNRATE: [{ t: "2026-10-01", v: 4.3 }], USREC: [{ t: "2026-10-01", v: 0 }] };
  const base = {
    tickers: TICKERS, isEtf: (s) => ETFS.includes(s), chains, barsOf: (s) => barMap[s],
    earningsStore: { tickers: Object.fromEntries(STOCKS.map((s) => [s, { events: [{ date: "2026-08-01" }] }])) },
    unusual: { scannedAt: `${TODAY}T15:30:00Z`, tickers: [{ symbol: "S1", contracts: [{ premium: 300000, volume: 2000, dte: 30, side: "call", tape: "ask" }] }] },
    webullFlow, crowdRollup, crowd: { shortVolume: { asOf: PRIOR } },
    policyNews, gdelt: { lastOkDate: TODAY },
    vix, vix3m, liveVol: { date: TODAY, vix: 21, vix3m: 22 },
    fred, fearGreed: { score: 30, asOf: `${TODAY}T14:00:00Z`, stale: false }, fearHistory: [{ date: "2026-11-20", score: 28 }, { date: PRIOR, score: 29 }],
    sectorBars: { XLE: bars(90), XLV: bars(140) }, sectorSpot: { XLE: 95.5, XLV: 148 },
    barMap,
  };
  return { ...base, ...over };
}
const run = (inp, mode = "guard") => checkEngineFeeds(inp, { today: TODAY, builtAtIso: `${TODAY}T16:00:00Z`, mode, universe: TICKERS, stocks: STOCKS });
const feed = (c, id) => c.feeds.find((f) => f.id === id);

test("calendar helpers", () => {
  assert.equal(priorSession("2026-11-23"), "2026-11-20"); // Monday -> Friday
  assert.equal(priorSession("2026-11-27"), "2026-11-25"); // Friday after Thanksgiving
  assert.equal(sessionsBehind("2026-11-20", "2026-11-23"), 1);
  assert.equal(sessionsBehind("2026-11-23", "2026-11-23"), 0);
});

test("mode switch", () => {
  assert.equal(dataChecksMode({}), "guard");
  assert.equal(dataChecksMode({ DATA_CHECKS: "report" }), "report");
  assert.equal(dataChecksMode({ DATA_CHECKS: "off" }), "off");
  assert.equal(dataChecksMode({ DATA_CHECKS: "0" }), "off");
  assert.equal(run(input(), "off"), null);
  const d = ownerSettingDef("DATA_CHECKS");
  assert.ok(d && d.kind === "choice" && d.default === "guard" && d.scope === "build" && d.options.map((o) => o[0]).join() === "guard,report,off");
});

test("a healthy set passes every feed and the guard changes nothing", () => {
  const inp = input();
  const c = run(inp);
  assert.equal(c.feeds.length, FEEDS.length);
  for (const f of c.feeds) assert.equal(f.state, "ok", `${f.id}: ${f.detail}`);
  const g = guardEngineInputs(inp, c);
  assert.equal(g.policyNews, inp.policyNews); assert.equal(g.unusual, inp.unusual); assert.equal(g.vix, inp.vix); assert.equal(g.webullFlow, inp.webullFlow);
  assert.deepEqual(g.dataGuard.skipped, []); assert.deepEqual(g.dataGuard.names, {});
});

test("news: 2 of 20 read fails and the guard drops the GDELT reads but keeps Federal Register counts", () => {
  const pn = Object.fromEntries(STOCKS.map((s, i) => [s, i < 2 ? { frn: 1, nvr: 1.2, ntn: 0 } : { frn: 1 }]));
  const inp = input({ policyNews: pn });
  const c = run(inp);
  const f = feed(c, "news");
  assert.equal(f.state, "fail"); assert.match(f.detail, /read for 2 of 20 stocks/);
  const g = guardEngineInputs(inp, c);
  assert.equal(g.policyNews.S0.nvr, undefined); assert.equal(g.policyNews.S0.frn, 1);
  assert.equal(inp.policyNews.S0.nvr, 1.2, "the bake's own object is not changed");
  assert.ok(g.dataGuard.skipped.some((r) => r.id === "news"));
});

test("news: a spike on most stocks at once fails (broken baseline, Nov 20)", () => {
  const pn = Object.fromEntries(STOCKS.map((s) => [s, { nvr: 20.5, ntn: 0 }]));
  const f = feed(run(input({ policyNews: pn })), "news");
  assert.equal(f.state, "fail"); assert.match(f.detail, /news spike at once/);
});

test("news: stale GDELT day fails", () => {
  const f = feed(run(input({ gdelt: { lastOkDate: "2026-11-18" } })), "news");
  assert.equal(f.state, "fail"); assert.match(f.detail, /2026-11-18/);
});

test("a feed switched off on purpose reads missing and is not guarded", () => {
  assert.deepEqual(feedsSwitchedOff({ GDELT_NEWS: "0", CROWD: "false" }), ["news", "crowd"]);
  assert.deepEqual(feedsSwitchedOff({}), []);
  const inp = input({ gdelt: { lastOkDate: "2026-11-10" } });
  const c = checkEngineFeeds(inp, { today: TODAY, builtAtIso: `${TODAY}T16:00:00Z`, mode: "guard", universe: TICKERS, stocks: STOCKS, switchedOff: ["news"] });
  const f = feed(c, "news");
  assert.equal(f.state, "missing"); assert.equal(f.guarded, false); assert.match(f.detail, /switched off/);
  assert.equal(guardEngineInputs(inp, c).policyNews, inp.policyNews);
  assert.equal(checksBriefLine(c), null);
});

test("report mode shows the fail but takes nothing away", () => {
  const inp = input({ gdelt: { lastOkDate: "2026-11-10" } });
  const c = run(inp, "report");
  assert.equal(feed(c, "news").state, "fail");
  assert.equal(guardEngineInputs(inp, c), inp);
  assert.match(checksBriefLine(compactChecks(c)).detail, /report mode/);
});

test("bars: a +60% glitch day leaves that name out of new entries only", () => {
  const inp = input();
  inp.barMap.S3 = bars(100, { glitch: (b) => { b[b.length - 2].c *= 1.6; b[b.length - 2].h = b[b.length - 2].c; } });
  const c = run(inp);
  const f = feed(c, "bars");
  assert.equal(f.state, "warn"); assert.ok(f.guarded); assert.match(f.names.S3, /\+60% day/);
  const g = guardEngineInputs(inp, c);
  assert.ok(g.dataGuard.names.S3);
  assert.equal(Object.keys(g.dataGuard.names).length, 1);
});

test("bars: impossible prices and a quote far from the close", () => {
  assert.match(barsProblem([{ t: "2026-11-20", c: 10, h: 9, l: 11 }, { t: "2026-11-23", c: 10, h: 10.1, l: 9.9 }], 10), /under a low/);
  assert.match(barsProblem([{ t: "2026-11-20", c: 0, h: 1, l: 0 }], 10), /close of 0/);
  assert.match(barsProblem([{ t: "2026-11-20", c: 10, h: 10.1, l: 9.9 }, { t: "2026-11-23", c: 10, h: 10.1, l: 9.9 }], 25), /from the last close/);
  assert.equal(barsProblem([{ t: "2026-11-20", c: 10, h: 10.1, l: 9.9 }, { t: "2026-11-23", c: 10.5, h: 10.6, l: 9.9 }], 10.4), null);
});

test("bars: under 75% fresh fails the feed", () => {
  const inp = input();
  for (const s of STOCKS.slice(0, 8)) inp.barMap[s] = bars(100, { lastDate: "2026-11-10" });
  assert.equal(feed(run(inp), "bars").state, "fail");
});

test("engine views leave a guarded name out and record why", () => {
  const inp = input();
  const out = buildEngineViews({ today: TODAY, nowMs: Date.parse(`${TODAY}T16:00:00Z`), chains: inp.chains, tickers: inp.tickers, isEtf: inp.isEtf, barsOf: inp.barsOf, dataGuard: { mode: "guard", skipped: [{ id: "news", label: "News", what: "skipped", why: "read for 2 of 20" }], names: { S5: "a +60% day on 2026-11-20" } } });
  assert.equal(out.views.S5, undefined);
  assert.ok(out.views.S6);
  assert.deepEqual(out.health.dataGuard.names, [{ symbol: "S5", why: "a +60% day on 2026-11-20" }]);
  assert.equal(out.health.dataGuard.skipped[0].id, "news");
  const plain = buildEngineViews({ today: TODAY, nowMs: Date.parse(`${TODAY}T16:00:00Z`), chains: inp.chains, tickers: inp.tickers, isEtf: inp.isEtf, barsOf: inp.barsOf });
  assert.equal(plain.health.dataGuard, undefined);
  assert.ok(plain.views.S5);
});

test("webull flow: a net share past 100% drops that name; a stale log fails", () => {
  const inp = input();
  inp.webullFlow = { ...inp.webullFlow, S2: { wfl: 180, wfl5: 3, date: PRIOR } };
  const c = run(inp);
  assert.equal(feed(c, "webull-flow").state, "warn");
  const g = guardEngineInputs(inp, c);
  assert.equal(g.webullFlow.S2, undefined); assert.ok(g.webullFlow.S3);
  const old = Object.fromEntries(STOCKS.map((s) => [s, { wfl: 5, wfl5: 3, date: "2026-11-17" }]));
  const c2 = run(input({ webullFlow: old }));
  assert.equal(feed(c2, "webull-flow").state, "fail");
  assert.equal(guardEngineInputs(input({ webullFlow: old }), c2).webullFlow, null);
});

test("option flow: an old scan or impossible premiums fail and the guard drops it", () => {
  const inp = input({ unusual: { scannedAt: "2026-11-23T19:00:00Z", tickers: [] } });
  const c = run(inp);
  assert.equal(feed(c, "option-flow").state, "fail");
  assert.equal(guardEngineInputs(inp, c).unusual, null);
  assert.equal(feed(run(input({ unusual: null })), "option-flow").state, "missing");
});

test("VIX: impossible close drops every VIX read; a wild live quote drops only the quote", () => {
  const inp = input();
  inp.vix = [...inp.vix.slice(0, -1), { t: PRIOR, v: 0 }];
  const c = run(inp);
  assert.equal(feed(c, "vix").state, "fail");
  const g = guardEngineInputs(inp, c);
  assert.equal(g.vix, null); assert.equal(g.vix3m, null); assert.equal(g.liveVol, null);
  const inp2 = input({ liveVol: { date: TODAY, vix: 95, vix3m: 22 } });
  const c2 = run(inp2);
  assert.equal(feed(c2, "vix").state, "warn");
  const g2 = guardEngineInputs(inp2, c2);
  assert.equal(g2.liveVol, null); assert.equal(g2.vix, inp2.vix);
});

test("FRED: an impossible value drops that series only; stale is shown, never dropped", () => {
  const inp = input();
  inp.fred = { ...inp.fred, DFF: [...inp.fred.DFF.slice(0, -1), { t: PRIOR, v: 360 }], NFCI: [{ t: "2026-09-01", v: -0.4 }] };
  const c = run(inp);
  const f = feed(c, "fred");
  assert.equal(f.state, "fail"); assert.equal(f.series.DFF, "fail"); assert.equal(f.series.NFCI, "warn");
  const g = guardEngineInputs(inp, c);
  assert.deepEqual(g.fred.DFF, []); assert.equal(g.fred.NFCI, inp.fred.NFCI); assert.equal(g.fred.DGS10, inp.fred.DGS10);
});

test("Fear & Greed: an impossible score fails; a stale one only warns", () => {
  const inp = input({ fearGreed: { score: 140, asOf: TODAY } });
  const c = run(inp);
  assert.equal(feed(c, "fear-greed").state, "fail");
  assert.equal(guardEngineInputs(inp, c).fearGreed, null);
  assert.equal(feed(run(input({ fearGreed: { score: 30, asOf: TODAY, stale: true } })), "fear-greed").state, "warn");
});

test("crowd: impossible short-volume scores fail; no crowd read is 'missing'", () => {
  const rows = STOCKS.map((s) => ({ symbol: s, shortZ20: 90 }));
  const inp = input({ crowdRollup: rows });
  const c = run(inp);
  assert.equal(feed(c, "crowd").state, "fail");
  assert.equal(guardEngineInputs(inp, c).crowdRollup, null);
  assert.equal(feed(run(input({ crowdRollup: null })), "crowd").state, "missing");
});

test("sector funds: a bad fund is left out, the rest stay", () => {
  const inp = input();
  inp.sectorBars = { ...inp.sectorBars, XLU: bars(70, { lastDate: "2026-11-02" }) };
  const c = run(inp);
  assert.equal(feed(c, "sector-funds").state, "warn");
  const g = guardEngineInputs(inp, c);
  assert.equal(g.sectorBars.XLU, undefined); assert.ok(g.sectorBars.XLE);
});

test("earnings: a past 'next report' date warns and is never taken away", () => {
  const inp = input();
  inp.chains.S1.earningsHx = { next: { date: "2026-11-02" } };
  const c = run(inp);
  const f = feed(c, "earnings");
  assert.equal(f.state, "warn"); assert.equal(f.guarded, false);
  assert.equal(guardEngineInputs(inp, c).earningsStore, inp.earningsStore);
});

test("a check that throws reads fail, not a crashed bake", () => {
  const inp = input({ barsOf: () => { throw new Error("boom"); } });
  const f = feed(run(inp), "bars");
  assert.equal(f.state, "fail"); assert.match(f.detail, /check itself failed/);
});

test("source health carries the checks; the Owner brief adds one finding on a fail", () => {
  const ok = compactChecks(run(input()));
  const sh = buildSourceHealth({ payloads: new Map(), builtAtIso: `${TODAY}T16:00:00Z`, feedChecks: ok });
  assert.equal(sh.engineFeeds.feeds.length, FEEDS.length);
  assert.equal(buildSourceHealth({ payloads: new Map(), builtAtIso: `${TODAY}T16:00:00Z` }).engineFeeds, undefined);
  const bad = compactChecks(run(input({ gdelt: { lastOkDate: "2026-11-10" } })));
  const brief = buildOwnerMarketBrief({ builtAtIso: `${TODAY}T16:00:00Z`, desk: { dataChecks: bad } });
  const f = brief.findings.find((x) => x.id === "desk:data");
  assert.ok(f, "data finding"); assert.equal(f.priority, 1); assert.match(f.title, /1 data feed failed/); assert.match(f.detail, /News volume and tone/);
  assert.deepEqual(brief.desk.dataChecks.failed, ["news"]);
  const quiet = buildOwnerMarketBrief({ builtAtIso: `${TODAY}T16:00:00Z`, desk: { dataChecks: ok } });
  assert.equal(quiet.findings.find((x) => x.id === "desk:data"), undefined);
});

console.log(`data-checks-smoke: ${passed} passed`);
