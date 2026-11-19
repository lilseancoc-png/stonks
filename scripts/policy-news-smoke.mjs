// Offline checks for lib/policy-news (Federal Register + GDELT). No network:
// every fetch goes through a fake that serves fixed answers.
// Run: node scripts/policy-news-smoke.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GDELT_QUERIES, gdeltUrl, gdeltDateMs, parseTimeline, volumeRead, toneRead, readGdelt,
} from "../lib/policy-news/gdelt.mjs";
import { normalizeDoc, tagDoc, parseDocsPage, docsUrl, readFederalRegister, FR_DOCS_URL, FR_PI_URL } from "../lib/policy-news/federal-register.mjs";
import {
  updatePolicyNews, policyNewsDue, policyNewsShadow, policyNewsSummary, foldGdelt, foldFederalRegister,
  cleanPolicyNews, writePolicyNewsFile, readPolicyNewsPrior, POLICY_NEWS_KEY,
} from "../lib/policy-news/index.mjs";
import { isPremiumKey } from "../lib/premium-keys.mjs";

// The covered list, read from build.mjs's TICKERS block (no import: build.mjs
// pulls in the whole bake). Funds are the "ETF" labels plus DRAM.
const buildSrc = readFileSync(new URL("./build.mjs", import.meta.url), "utf8");
const tickBlock = buildSrc.slice(buildSrc.indexOf("export const TICKERS = ["), buildSrc.indexOf("];", buildSrc.indexOf("export const TICKERS = [")));
const ALL = [...tickBlock.replace(/\/\/[^\n]*/g, "").matchAll(/"([A-Z.]+)"/g)].map((m) => m[1]);
const FUNDS = ["SPY", "QQQ", "IWM", "SMH", "UVXY", "TLT", "USO", "GLD", "SLV", "KWEB", "EWY", "DRAM"];
const TICKERS_FOR_TEST = { all: ALL, funds: FUNDS, stocks: ALL.filter((s) => !FUNDS.includes(s)) };

let n = 0;
const ok = (label, cond) => { assert.ok(cond, label); n += 1; };

// ---- GDELT parsers
const NOW = Date.parse("2026-11-19T15:10:00Z"); // 10:10 ET
const H = 3600000;
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
ok("GDELT dates parse to UTC ms", gdeltDateMs("20261112T151500Z") === Date.UTC(2026, 10, 12, 15, 15, 0) && gdeltDateMs("bad") === null);
ok("GDELT URL quotes the query, asks for English and JSON", gdeltUrl('"Netflix"', "timelinevolraw").includes(encodeURIComponent('"Netflix" sourcelang:english')) && /format=json&timespan=7d/.test(gdeltUrl('"Netflix"', "timelinevolraw")));
ok("plain-text rate-limit answers are not timelines", parseTimeline("Please limit requests to one every 5 seconds") === null);
ok("an empty timeline is an empty list, not a failure", Array.isArray(parseTimeline({ timeline: [] })) && parseTimeline({ timeline: [] }).length === 0);
// six quiet days at 2 articles an hour, then a busy last day at 10 an hour
const pts = [];
for (let t = NOW - 7 * 24 * H + H; t <= NOW; t += H) pts.push({ date: stamp(t), value: t > NOW - 24 * H ? 10 : 2 });
const tl = parseTimeline(JSON.stringify({ timeline: [{ series: "Article Count", data: pts }] }));
ok("timeline points parse and sort", tl.length === pts.length && tl[0].ms < tl[tl.length - 1].ms);
const vr = volumeRead(tl, NOW);
ok("volume: last 24 h vs the six-day daily average", vr.vol24 === 240 && vr.base === 48 && vr.ratio === 5);
const quiet = volumeRead([{ ms: NOW - 2 * H, value: 0.4 }], NOW);
ok("volume: under one article a day gives no ratio", quiet.ratio === null);
const tr = toneRead(tl.map((p) => ({ ms: p.ms, value: p.ms > NOW - 24 * H ? -4 : 1 })), NOW);
ok("tone: 24 h and base averages", tr.tone24 === -4 && tr.toneBase === 1);
ok("every covered non-fund stock has a GDELT query; funds have none", TICKERS_FOR_TEST.stocks.every((s) => GDELT_QUERIES[s]) && TICKERS_FOR_TEST.funds.every((s) => !GDELT_QUERIES[s]));

// ---- fake fetch
function fakeFetch(routes, calls) {
  return async (url) => {
    calls.push(url);
    for (const [test, answer] of routes) {
      if (test(url)) {
        const a = typeof answer === "function" ? answer(url) : answer;
        return { ok: (a.status || 200) < 400, status: a.status || 200, text: async () => (typeof a.body === "string" ? a.body : JSON.stringify(a.body)) };
      }
    }
    return { ok: false, status: 404, text: async () => "not found" };
  };
}
const spikeBody = { timeline: [{ series: "Article Count", data: pts }] };
const flatBody = { timeline: [{ series: "Article Count", data: pts.map((p) => ({ ...p, value: 2 })) }] };
const toneBody = { timeline: [{ series: "Average Tone", data: pts.map((p) => ({ ...p, value: Date.parse(p.date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")) > NOW - 24 * H ? -3 : 0.5 })) }] };
{
  const calls = [];
  const fetchImpl = fakeFetch([
    [(u) => u.includes("timelinetone"), { body: toneBody }],
    [(u) => u.includes(encodeURIComponent('"Netflix"')), { body: spikeBody }],
    [(u) => u.includes("timelinevolraw"), { body: flatBody }],
  ], calls);
  const r = await readGdelt({ symbols: ["NFLX", "MSFT", "SPY"], nowMs: NOW, fetchImpl, gapMs: 0 });
  ok("GDELT: funds skipped, two stocks read", r.done.join(",") === "NFLX,MSFT" && !r.reads.SPY);
  ok("GDELT: tone read only on the spiking stock", r.tones === 1 && r.reads.NFLX.tone24 === -3 && r.reads.NFLX.toneBase === 0.5 && r.reads.MSFT.tone24 === undefined);
  ok("GDELT: three calls (two volume, one tone)", r.calls === 3 && calls.length === 3);
}
{
  const calls = [];
  const fetchImpl = fakeFetch([[(u) => u.includes(encodeURIComponent('"Microsoft"')), { body: "Please limit requests" }], [() => true, { body: flatBody }]], calls);
  const r = await readGdelt({ symbols: ["NFLX", "MSFT", "WMT"], nowMs: NOW, fetchImpl, gapMs: 0 });
  ok("GDELT: a rate-limit answer stops the pass and leaves the rest undone", r.stopped === "rate limited" && r.done.join(",") === "NFLX" && calls.length === 2);
}
{
  const fetchImpl = fakeFetch([[(u) => u.includes(encodeURIComponent('"Netflix"')), { status: 500, body: "x" }], [() => true, { body: flatBody }]], []);
  const r = await readGdelt({ symbols: ["NFLX", "MSFT"], nowMs: NOW, fetchImpl, gapMs: 0 });
  ok("GDELT: a failed stock is not marked done; the next one still reads", r.done.join(",") === "MSFT" && r.errors.length === 1);
}
{
  const r = await readGdelt({ symbols: ["NFLX", "MSFT"], nowMs: NOW, fetchImpl: fakeFetch([[() => true, { body: flatBody }]], []), gapMs: 10, budgetMs: 5 });
  ok("GDELT: an exhausted time budget stops before calling", r.stopped === "time budget" && r.calls === 0);
}

// ---- Federal Register tagging
const agency = (slug, name) => ({ slug, name, raw_name: name.toUpperCase() });
const docs = [
  { document_number: "2026-1", type: "Rule", title: "Medicare Program; Contract Year 2027 Policy and Technical Changes to the Medicare Advantage Program", abstract: "", publication_date: "2026-11-18", html_url: "https://www.federalregister.gov/d/2026-1", agencies: [agency("centers-for-medicare-medicaid-services", "Centers for Medicare & Medicaid Services")], significant: true },
  { document_number: "2026-2", type: "Notice", title: "Agency Information Collection Activities; Submission for OMB Review", abstract: "Routine paperwork.", publication_date: "2026-11-18", agencies: [agency("food-and-drug-administration", "Food and Drug Administration")] },
  { document_number: "2026-3", type: "Notice", title: "Determination of Regulatory Review Period; Zepbound", abstract: "tirzepatide", publication_date: "2026-11-17", agencies: [agency("food-and-drug-administration", "Food and Drug Administration")] },
  { document_number: "2026-4", type: "Rule", title: "Additions to the Entity List; Revisions to Advanced Computing Export Controls", abstract: "", publication_date: "2026-11-18", agencies: [agency("industry-and-security-bureau", "Industry and Security Bureau")] },
  { document_number: "2026-5", type: "Notice", title: "Apple Orchards Marketing Order; Washington", abstract: "Fresh apples.", publication_date: "2026-11-18", agencies: [agency("agricultural-marketing-service", "Agricultural Marketing Service")] },
  { document_number: "2026-6", type: "Presidential Document", title: "Continuation of the National Emergency With Respect to Iran", abstract: "", publication_date: "2026-11-17", agencies: [agency("executive-office-of-the-president", "Executive Office of the President")] },
  { document_number: "2026-7", type: "Notice", title: "Microsoft Corporation and Activision; Analysis of Proposed Consent Order", abstract: "", publication_date: "2026-11-18", agencies: [agency("federal-trade-commission", "Federal Trade Commission")] },
  { document_number: "2026-8", type: "Proposed Rule", title: "Regulatory Capital Rule: Large Banking Organizations", abstract: "Basel III endgame", publication_date: "2026-11-18", agencies: [agency("federal-reserve-system", "Federal Reserve System")] },
];
const covered = new Set(TICKERS_FOR_TEST.all);
const tag = (d) => tagDoc(normalizeDoc(d), covered);
ok("a CMS rule tags UnitedHealth on the agency and the Medicare Advantage topic", tag(docs[0]).tickers.includes("UNH") && tag(docs[0]).why.UNH.includes("agency:cms") && tag(docs[0]).why.UNH.includes("topic:medicare-advantage"));
ok("a routine FDA notice is not kept", tag(docs[1]) === null);
ok("an FDA notice naming a GLP-1 tags Lilly and Novo", tag(docs[2]).tickers.join(",").includes("LLY") && tag(docs[2]).tickers.includes("NVO"));
ok("a BIS rule tags the chip makers", ["NVDA", "AMD", "ASML"].every((s) => tag(docs[3]).tickers.includes(s)));
ok("an apple-orchard notice never tags Apple", tag(docs[4]) === null);
ok("a presidential document is kept market-wide with no stock", tag(docs[5]).market === true && tag(docs[5]).tickers.length === 0);
ok("an FTC notice naming Microsoft tags it by name", tag(docs[6]).tickers.join(",") === "MSFT" && tag(docs[6]).why.MSFT[0] === "name");
ok("a Fed capital proposal tags the banks", ["JPM", "BAC", "GS"].every((s) => tag(docs[7]).tickers.includes(s)));
ok("an uncovered stock is never tagged", tagDoc(normalizeDoc(docs[3]), new Set(["NVDA"])).tickers.join(",") === "NVDA");
ok("a bad page body is null, a zero-count page is empty", parseDocsPage("<html>") === null && parseDocsPage({ count: 0 }).results.length === 0);
ok("documents URL asks for 1,000 per page from the date with the fields", /per_page=1000/.test(docsUrl("2026-11-16")) && docsUrl("2026-11-16").includes(encodeURIComponent("conditions[publication_date][gte]") + "=2026-11-16") && docsUrl("2026-11-16").includes(encodeURIComponent("fields[]") + "=agencies"));

const page2Url = `${FR_DOCS_URL}?page=2`;
const pi = { count: 1, results: [{ document_number: "2026-9", type: "Presidential Document", title: "Adjusting Imports of Semiconductors Into the United States", agency_names: ["Executive Office of the President"], publication_date: "2026-11-20", html_url: "https://www.federalregister.gov/public-inspection/2026-9", filing_type: "special" }] };
{
  const calls = [];
  const fetchImpl = fakeFetch([
    [(u) => u === FR_PI_URL, { body: pi }],
    [(u) => u === page2Url, { body: { count: 8, results: docs.slice(4) } }],
    [(u) => u.startsWith(FR_DOCS_URL), { body: { count: 8, total_pages: 2, next_page_url: page2Url, results: docs.slice(0, 4) } }],
  ], calls);
  const r = await readFederalRegister({ todayIso: "2026-11-19", covered, fetchImpl });
  ok("Register: both pages and the inspection list read (3 calls)", r.ok && r.calls === 3 && r.scanned === 9);
  ok("Register: kept docs are the tagged ones plus presidential ones", r.docs.map((d) => d.id).sort().join(",") === "2026-1,2026-3,2026-4,2026-6,2026-7,2026-8,2026-9");
  ok("Register: tomorrow's filing is marked pending and tags the chip makers by topic", r.docs.find((d) => d.id === "2026-9").pending === true && r.docs.find((d) => d.id === "2026-9").tickers.includes("NVDA"));
  ok("Register: the from date is three days back", calls[0].includes("=2026-11-16"));
}
{
  const fetchImpl = fakeFetch([[(u) => u === FR_PI_URL, { body: pi }], [() => true, { status: 503, body: "down" }]], []);
  const r = await readFederalRegister({ todayIso: "2026-11-19", covered, fetchImpl });
  ok("Register: a failed documents read is not ok even when inspection works", r.ok === false && r.errors[0].startsWith("documents"));
}

// ---- orchestration
ok("not due on a Top Picks run or before 09:00 ET", !policyNewsDue(null, { nowMs: NOW, decisionRun: true, symbols: ["NFLX"] }).fr && !policyNewsDue(null, { nowMs: Date.parse("2026-11-19T13:30:00Z"), symbols: ["NFLX"] }).gdelt);
const goodFetch = (calls) => fakeFetch([
  [(u) => u === FR_PI_URL, { body: pi }],
  [(u) => u.startsWith(FR_DOCS_URL), { body: { count: 8, results: docs } }],
  [(u) => u.includes("timelinetone"), { body: toneBody }],
  [(u) => u.includes(encodeURIComponent('"Netflix"')), { body: spikeBody }],
  [(u) => u.includes("timelinevolraw"), { body: flatBody }],
], calls);
const syms = ["NFLX", "MSFT", "UNH", "NVDA", "SPY"];
const run1 = await updatePolicyNews({ prior: null, nowMs: NOW, symbols: syms, fetchImpl: goodFetch([]), env: {}, log: () => {} });
ok("first run reads both sources", run1.ran.fr && run1.ran.gdelt && run1.state.fr.lastOkDate === "2026-11-19" && run1.state.gdelt.done.join(",") === "MSFT,NFLX,NVDA,UNH");
const calls2 = [];
const run2 = await updatePolicyNews({ prior: run1.state, nowMs: NOW + 3 * H, symbols: syms, fetchImpl: goodFetch(calls2), env: {}, log: () => {} });
ok("a second bake the same day reads nothing", !run2.ran.fr && !run2.ran.gdelt && calls2.length === 0);
const run3 = await updatePolicyNews({ prior: run1.state, nowMs: NOW + 24 * H, symbols: syms, fetchImpl: fakeFetch([[() => true, { status: 503, body: "down" }]], []), env: {}, log: () => {} });
ok("a failed next-day read keeps the prior blocks, marked stale", run3.state.fr.stale && run3.state.gdelt.stale && run3.state.fr.docs.length === run1.state.fr.docs.length && run3.state.gdelt.days.NFLX.length === 1);
const calls4 = [];
const run4 = await updatePolicyNews({ prior: run1.state, nowMs: NOW + 24 * H, symbols: syms, fetchImpl: goodFetch(calls4), env: { FEDERAL_REGISTER: "0", GDELT_NEWS: "0" }, log: () => {} });
ok("both switches off: no request, prior kept", calls4.length === 0 && !run4.ran.fr && !run4.ran.gdelt && run4.state.fr.docs.length === run1.state.fr.docs.length && run4.why === "both switched off");
{
  const partial = cleanPolicyNews(run1.state);
  partial.gdelt.done = ["NFLX"];
  const calls5 = [];
  const run5 = await updatePolicyNews({ prior: partial, nowMs: NOW + H, symbols: syms, fetchImpl: goodFetch(calls5), env: { FEDERAL_REGISTER: "0" }, log: () => {} });
  ok("a part-done day reads only the stocks left", run5.ran.gdelt && !calls5.some((u) => u.includes(encodeURIComponent('"Netflix"'))) && run5.state.gdelt.done.length === 4);
}
const sh = policyNewsShadow(run1.state, { nowMs: NOW, symbols: syms });
ok("shadow: Register counts per name, zero kept as measured", sh.rows.UNH.frn >= 1 && sh.rows.MSFT.frn === 1 && sh.rows.NFLX.frn === 0 && sh.rows.NVDA.frn === 2);
ok("shadow: news ratio per stock, tone change only on the spike", sh.rows.NFLX.nvr === 5 && sh.rows.NFLX.ntn === -3.5 && sh.rows.MSFT.nvr === 1 && sh.rows.MSFT.ntn === undefined);
ok("shadow: presidential documents counted; spikes need 10+ stocks read", sh.mkt.frp === 2 && sh.mkt.nvs === undefined);
const old = policyNewsShadow(run1.state, { nowMs: NOW + 4 * 24 * H, symbols: syms });
ok("shadow: an old read logs nothing", Object.keys(old.rows).length === 0 && Object.keys(old.mkt).length === 0);
const sum = policyNewsSummary(run1.state, { nowMs: NOW });
ok("summary: recent docs and the spike list", sum.federalRegister.recent.length === 5 && sum.gdelt.spikes[0].symbol === "NFLX" && /GDELT/.test(sum.credit));
const folded = foldGdelt({ NFLX: [{ d: "2026-07-01", vol24: 1 }, { d: "2026-11-18", vol24: 2 }] }, { NFLX: { vol24: 3 } }, "2026-11-19");
ok("GDELT rows: one per day, older than 90 days dropped", folded.NFLX.map((r) => r.d).join(",") === "2026-11-18,2026-11-19");
const fr = foldFederalRegister([{ id: "a", date: "2026-09-01" }, { id: "b", date: "2026-11-18", pending: false, title: "pub" }], { docs: [{ id: "b", date: "2026-11-19", pending: true, title: "pi" }, { id: "c", date: "2026-11-19", abstract: "x".repeat(900) }] }, "2026-11-19");
ok("Register docs: 30-day window, a published copy beats a pending one, abstracts trimmed", fr.map((d) => d.id).join(",") === "c,b" && fr.find((d) => d.id === "b").title === "pub" && fr[0].abstract.length === 300);
ok("a bad stored file starts fresh", cleanPolicyNews({ version: 99 }).fr.docs.length === 0);

// ---- file round trip and access
const dir = mkdtempSync(join(tmpdir(), "policy-news-"));
await writePolicyNewsFile(dir, run1.state);
const back = await readPolicyNewsPrior(dir);
ok("the file round-trips", back.fr.docs.length === run1.state.fr.docs.length && JSON.parse(readFileSync(join(dir, POLICY_NEWS_KEY), "utf8")).version === 1);
ok("a missing file reads as null", (await readPolicyNewsPrior(join(dir, "nope"))) === null);
ok("policy-news.json is Owner-only", isPremiumKey(POLICY_NEWS_KEY));

console.log(`policy news smoke: ${n} checks passed`);
