// SEC 8-K filings as official company news (lib/sec-filing-news.mjs).
// Fixtures copy the live data.sec.gov submissions layout checked on
// 2026-11-13 (Apple, JPMorgan, NVIDIA, TSMC): acceptanceDateTime is UTC
// (Apple's 2026-11-09T21:30:40.000Z matched the filing header's 16:30:40 ET),
// items is "2.02,9.01", 6-K rows carry no items.
import assert from "node:assert/strict";
import { parseSecItems, secEventClass, parseSecSubmissions, collectSecFilingNews, secSubmissionsUrl, SEC_8K_SOURCE_ID } from "../lib/sec-filing-news.mjs";
import { collectFreeNewsSources } from "../lib/free-news-sources.mjs";
import { evidenceFeedRows } from "../lib/news-evidence.mjs";
import { buildNewsFeedPayload } from "../lib/news-feed.mjs";
import { validNewsFeedPayload } from "../lib/news-policy.mjs";

let checks = 0;
const eq = (a, b, n) => { assert.deepEqual(a, b, n); checks++; };
const now = new Date("2026-11-13T03:00:00Z");

function submissions({ cik, name, tickers, rows }) {
  const col = (k) => rows.map((r) => r[k] ?? "");
  return { cik, name, tickers, filings: { recent: {
    accessionNumber: col("acc"), filingDate: col("date"), acceptanceDateTime: col("at"), form: col("form"),
    items: col("items"), primaryDocument: col("doc"), reportDate: col("date"),
  } } };
}
const apple = submissions({ cik: "0000320193", name: "Apple Inc.", tickers: ["AAPL"], rows: [
  { acc: "0001140361-26-042798", date: "2026-11-09", at: "2026-11-09T21:30:40.000Z", form: "8-K", items: "8.01,9.01", doc: "ef20085077_8k.htm" },
  { acc: "0000320193-26-000030", date: "2026-11-10", at: "2026-11-10T21:00:00.000Z", form: "4", items: "", doc: "x.xml" },
  { acc: "0000320193-26-000031", date: "2026-11-11", at: "2026-11-11T14:00:00.000Z", form: "8-K", items: "5.07", doc: "vote.htm" },
  { acc: "0000320193-26-000024", date: "2026-11-02", at: "2026-11-02T21:30:23.000Z", form: "8-K", items: "2.02,9.01", doc: "aapl-20261102.htm" },
  { acc: "0000320193-26-000018", date: "2026-07-30", at: "2026-07-30T20:30:28.000Z", form: "8-K", items: "2.02,9.01", doc: "aapl-20260730.htm" },
] });
const nvda = submissions({ cik: "0001045810", name: "NVIDIA CORP", tickers: ["NVDA"], rows: [
  { acc: "0001045810-26-000082", date: "2026-11-12", at: "2026-11-12T13:52:41.000Z", form: "8-K", items: "5.02,9.01", doc: "nvda-20261111.htm" },
  { acc: "0001045810-26-000083", date: "2026-11-12", at: "", form: "8-K/A", items: "Item 1.01, Item 9.01", doc: "nvda-a.htm" },
] });
const tsm = submissions({ cik: "0001046179", name: "TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD", tickers: ["TSM", "TSMWF"], rows: [
  { acc: "0001046179-26-000800", date: "2026-11-12", at: "2026-11-12T13:03:05.000Z", form: "6-K", items: "", doc: "a.htm" },
] });

// Items and classes
eq(parseSecItems("2.02,9.01"), ["2.02", "9.01"]);
eq(parseSecItems("Item 1.01, Item 9.01, Item 1.01, 9.99"), ["1.01", "9.01"], "known items once each");
eq(secEventClass(["2.02", "9.01"]), "earnings");
eq(secEventClass(["5.07", "9.01"]), null, "routine items alone make no row");
eq(secEventClass(["8.01", "4.02"]), "restatement", "most telling item wins");

// Parse
const a = parseSecSubmissions(apple, { symbol: "AAPL", cik: "320193" }, now.getTime());
eq(a.events.length, 1, "7-day window: only the Nov 9 8-K");
eq(a.rejected, 1, "the vote-only 8-K is counted as rejected");
eq(a.events[0].eventId, "sec8k:0001140361-26-042798");
eq(a.events[0].publishedAt, "2026-11-09T21:30:40.000Z", "UTC acceptance time kept as is");
eq(a.events[0].dateOnly, false);
eq(a.events[0].link, "https://www.sec.gov/Archives/edgar/data/320193/000114036126042798/ef20085077_8k.htm");
eq(a.events[0].title, "Apple Inc. files an 8-K: Other events (Item 8.01)");
eq(a.events[0].facts.eventClass, "other");
eq(a.events[0].kind, "sec-filing");
eq(a.events[0].sourceKind, "official");
eq(parseSecSubmissions(apple, { symbol: "AAPL", cik: "320193" }, Date.parse("2026-11-05T00:00:00Z")).events[0].facts.eventClass, "earnings");
const n = parseSecSubmissions(nvda, { symbol: "NVDA", cik: "1045810" }, now.getTime());
eq(n.events.map((e) => e.facts.eventClass), ["leadership", "agreement"]);
eq(n.events[1].dateOnly, true, "missing acceptance time falls back to the filing date");
eq(n.events[1].title.startsWith("NVIDIA CORP amends an 8-K: Material agreement signed (Item 1.01)"), true);
eq(parseSecSubmissions(tsm, { symbol: "TSM", cik: "1046179" }, now.getTime()), { events: [], rejected: 0, foreignFiler: true });
assert.throws(() => parseSecSubmissions(apple, { symbol: "AAPL", cik: "1045810" }), /another filer/); checks++;
assert.throws(() => parseSecSubmissions(apple, { symbol: "MSFT", cik: "320193" }), /Ticker not listed/); checks++;
assert.throws(() => parseSecSubmissions({ cik: "0000320193", filings: { recent: { form: ["8-K"] } } }, { symbol: "AAPL", cik: "320193" }), /layout/); checks++;
const bad = structuredClone(apple); bad.filings.recent.primaryDocument[0] = "../../evil.htm";
eq(parseSecSubmissions(bad, { symbol: "AAPL", cik: "320193" }, now.getTime()).events.length, 0, "unsafe document names are dropped");
eq(secSubmissionsUrl("320193"), "https://data.sec.gov/submissions/CIK0000320193.json");

// Collector: one source state, carry on failure, cache within the TTL
const bodies = { "0000320193": apple, "0001045810": nvda, "0001046179": tsm };
const calls = [];
const fetchImpl = async (url, opts) => {
  calls.push(url);
  assert.match(opts.headers["user-agent"], /mingstreet/i);
  const cik = /CIK(\d{10})/.exec(url)[1];
  if (cik === "0000000001") return new Response("nope", { status: 503 });
  return Response.json(bodies[cik]);
};
const filers = { AAPL: "0000320193", NVDA: "0001045810", TSM: "0001046179", ZZZ: "0000000001" };
const s1 = await collectSecFilingNews({ filers, fetchImpl, now, userAgent: "Mingstreet test https://mingstreet.app" });
eq(calls.length, 4);
eq(s1.label, "SEC 8-K filings");
eq(s1.status, "partial", "3 of 4 read is under the 90% bar");
eq(s1.events.length, 3);
eq(s1.coverage.failed, ["ZZZ"]);
eq(s1.coverage.foreignFilers, ["TSM"]);
eq(s1.names.ZZZ.error, "HTTP 503");
calls.length = 0;
const later = new Date(now.getTime() + 10 * 60000);
const s2 = await collectSecFilingNews({ filers, prior: s1, fetchImpl: async (url) => { calls.push(url); return new Response("down", { status: 500 }); }, now: later });
eq(calls.length, 0, "fresh names are cached and the failed one waits 30 minutes");
eq(s2.events.length, 3, "cached names keep their events");
const s3 = await collectSecFilingNews({ filers, prior: s1, fetchImpl: async () => new Response("down", { status: 500 }), now: new Date(now.getTime() + 50 * 60000) });
eq(s3.status, "partial", "every read failed; only the foreign filer (checked daily) stays cached");
eq(s3.events.length, 3, "a failed read carries the earlier events");
const s3b = await collectSecFilingNews({ filers: { AAPL: "0000320193", NVDA: "0001045810" }, prior: s1, fetchImpl: async () => new Response("down", { status: 500 }), now: new Date(now.getTime() + 50 * 60000), gapMs: 0 });
eq(s3b.status, "error", "nothing read this time");
const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`A${i}`, "0000320193"]));
const okAll = await collectSecFilingNews({ filers: { ...many, ZZZ: "0000000001" }, fetchImpl: async (url) => /0000000001/.test(url) ? new Response("x", { status: 500 }) : Response.json({ ...apple, tickers: [] }), now });
eq(okAll.status, "ok", "one failure in 21 stays ok");
const noMap = await collectSecFilingNews({ filers: {}, prior: s1, fetchImpl, now: new Date(now.getTime() + 50 * 60000) });
eq(Object.keys(noMap.names).sort(), ["AAPL", "NVDA", "TSM", "ZZZ"], "no CIK map: prior CIKs are reused");

// Audit fixes (2026-11-13)
eq(parseSecSubmissions(nvda, { symbol: "NVDA", cik: "1045810", name: "NVIDIA Corporation" }, now.getTime()).events[0].title.startsWith("NVIDIA Corporation files"), true, "mixed-case quote name preferred");
eq(parseSecSubmissions(nvda, { symbol: "NVDA", cik: "1045810", name: "NVDA" }, now.getTime()).events[0].title.startsWith("NVIDIA CORP files"), true, "an all-capitals name does not replace EDGAR's");
const s1named = await collectSecFilingNews({ filers: { AAPL: "0000320193" }, names: { AAPL: "Apple Inc." }, fetchImpl, now, gapMs: 0 });
eq(s1named.events[0].title.startsWith("Apple Inc. files"), true);
const weekLater = new Date(now.getTime() + 8 * 86400000);
const stale = await collectSecFilingNews({ filers, prior: s1, fetchImpl: async () => new Response("down", { status: 500 }), now: weekLater, gapMs: 0 });
eq(stale.events.length, 0, "carried events still leave after seven days");
const callsTsm = [];
const s4 = await collectSecFilingNews({ filers, prior: s1, fetchImpl: async (url) => { callsTsm.push(url); return fetchImpl(url, { headers: { "user-agent": "mingstreet" } }); }, now: new Date(now.getTime() + 2 * 3600000), gapMs: 0 });
eq(callsTsm.some((u) => /0001046179/.test(u)), false, "a foreign filer is re-read once a day, not every 45 minutes");
eq(callsTsm.some((u) => /0000320193/.test(u)), true);
eq(s4.names.TSM.status, "cached");
eq(s2.lastSuccessAt, s1.lastSuccessAt, "a run with only cached names does not move lastSuccessAt");
const t0 = Date.now();
await collectSecFilingNews({ filers: { AAPL: "0000320193", NVDA: "0001045810", TSM: "0001046179" }, fetchImpl, now, concurrency: 1, gapMs: 100 });
eq(Date.now() - t0 >= 200, true, "readers pause between reads");

// Through the official-source collector and into the News feed
const universe = ["AAPL", "NVDA", "TSM", "SPY"];
const quiet = async (url) => {
  if (url.includes("data.sec.gov")) return fetchImpl(url, { headers: { "user-agent": "mingstreet" } });
  return new Response("<rss><channel></channel></rss>", { status: 200 });
};
const state = await collectFreeNewsSources({ universe, fetchImpl: quiet, now, issuerSources: [], secFilers: { AAPL: "320193", NVDA: "1045810", TSM: "1046179", MSFT: "789019" }, secUserAgent: "mingstreet" });
eq(Object.keys(state.sources).includes(SEC_8K_SOURCE_ID), true);
eq(state.coverage.secSymbols, ["AAPL", "NVDA", "TSM"], "names outside the universe are skipped");
eq(state.coverage.secForeignFilers, ["TSM"]);
eq(state.events.filter((e) => e.sourceId === SEC_8K_SOURCE_ID).length, 3);
eq(state.events.every((e) => e.contextOnly === true), true, "filings are context only");
const again = await collectFreeNewsSources({ universe, prior: state, fetchImpl: async () => { throw new Error("offline"); }, now: new Date(now.getTime() + 5 * 60000), issuerSources: [], secFilers: { AAPL: "320193", NVDA: "1045810", TSM: "1046179" } });
eq(again.events.filter((e) => e.sourceId === SEC_8K_SOURCE_ID).length, 3, "the stored state is accepted as a prior");
const skip = await collectFreeNewsSources({ universe, fetchImpl: quiet, now, issuerSources: [] });
eq(skip.sources[SEC_8K_SOURCE_ID], undefined, "no secFilers, no SEC pass");
const rows = evidenceFeedRows(state).filter((r) => r.recordKind === "sec-filing");
eq(rows.length, 3);
eq(rows[0].desk, "company");
const feed = buildNewsFeedPayload({ builtAtIso: now.toISOString(), tickerHeadlines: rows, marketHeadlines: [], chains: {}, sectors: {}, priorItems: [] });
const items = (feed.items || []).filter((i) => i.recordKind === "sec-filing");
eq(items.length, 3, "filings reach the News feed");
eq(items.every((i) => i.contextOnly && /SEC 8-K filing/.test(i.impactReason || "")), true);
const feed2 = buildNewsFeedPayload({ builtAtIso: now.toISOString(), tickerHeadlines: [{ ...rows[0], title: "X files an 8-K: Past financial statements no longer reliable (Item 4.02)", eventId: "sec8k:0000000001-26-000001", link: "https://www.sec.gov/Archives/edgar/data/1/1/t.htm", facts: { ...rows[0].facts, eventClass: "restatement" } }, { ...rows[0], title: "Y files an 8-K: Other events (Item 8.01)", eventId: "sec8k:0000000001-26-000002", link: "https://www.sec.gov/Archives/edgar/data/1/1/u.htm", facts: { ...rows[0].facts, eventClass: "other" } }], marketHeadlines: [], chains: {}, sectors: {}, priorItems: [] });
eq(feed2.items.find((i) => /4\.02/.test(i.title)).impact, "high", "a restatement filing is high impact");
eq(feed2.items.find((i) => /8\.01/.test(i.title)).impact, "context", "an 'other events' filing stays context");
eq(validNewsFeedPayload({ ...feed, sourceHealth: [], sourceCoverage: state.coverage }), true);

console.log(`sec-filing-news-smoke: ${checks} checks passed`);
