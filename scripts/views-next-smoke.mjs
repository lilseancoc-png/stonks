// Smoke test for the 2026-11-07 views, data and Owner tools: market-structure
// dates, the Fed liquidity line, the public market map / what-changed / past
// days files, the earnings price paths, grade calibration, the trade journal
// and the sports calibration summary. Also checks the Owner / public split:
// the new public files carry no Owner field, the Owner companions are
// private, and the browser only asks for Owner files with an Owner session.
// Synthetic data only; no network, no store.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { thirdFriday, monthlyExpiration, vixExpiration, marketStructureCalendarEvents, ipoListingsFrom } from "../lib/market-dates.mjs";
import { buildFedLiquidity } from "../lib/fed-liquidity.mjs";
import { buildMarketMap } from "../lib/market-map.mjs";
import { buildSiteSnapshot, nextSiteChanges } from "../lib/site-changes.mjs";
import { buildMarketDays, buildMarketDayBriefs } from "../lib/market-days.mjs";
import { gradeCalibration } from "../lib/grade-research.mjs";
import { applyTradeNote, TRADE_NOTE_TAGS, TRADE_NOTE_MAX_CHARS } from "../lib/track-record-fills.mjs";
import { isPremiumKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { publicDataPayload, BRIEF_ACCESS_POLICY_VERSION } from "../lib/public-data-policy.mjs";
import { modelSummary } from "../lib/sports/models.mjs";
import { buildCalendarIcs } from "../lib/calendar-ics.mjs";

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const root = fileURLToPath(new URL("../", import.meta.url));

// --- market-structure dates ----------------------------------------------------
eq(thirdFriday(2026, 11), "2026-11-20", "third Friday of Nov 2026");
eq(monthlyExpiration(2026, 6), "2026-06-18", "Juneteenth moves June 2026 expiration to Thursday");
eq(vixExpiration(2026, 11), "2026-11-18", "VIX expires 30 days before Dec 18");
const mdEvents = marketStructureCalendarEvents(Date.parse("2026-11-01T00:00:00Z"), Date.parse("2027-01-31T00:00:00Z"), {
  ipos: [{ date: "2026-06-01", symbol: "BIGCO", name: "Big Co", raised: 500e6 }, { date: "2026-06-02", symbol: "TINY", name: "Tiny", raised: 5e6 }],
});
const kinds = (d) => mdEvents.filter((e) => e.date === d).map((e) => e.subtype).sort();
eq(kinds("2026-11-20"), ["opex"], "November monthly expiration");
eq(kinds("2026-12-18"), ["ndx-recon", "sp-rebalance", "witching"], "December witching, S&P rebalance and Nasdaq-100 reset");
ok(mdEvents.some((e) => e.subtype === "vix-expiry" && e.date === "2026-11-18"), "VIX expiry on the calendar");
ok(mdEvents.some((e) => e.subtype === "lockup" && e.ipoSymbol === "BIGCO" && e.estimate), "sizable IPO gets an estimated lockup end");
ok(!mdEvents.some((e) => e.ipoSymbol === "TINY"), "small IPO is skipped");
ok(mdEvents.every((e) => e.type === "market" && !("symbol" in e)), "market events never carry a symbol");
eq(ipoListingsFrom({ ipos: { byQuarter: [{ items: [{ date: "2026-05-01", symbol: "abc", name: "ABC Acquisition Corp", raised: 2e8 }, { date: "2026-05-02", symbol: "xyz", name: "XYZ Inc", raised: 2e8 }] }] } }).map((r) => r.symbol), ["XYZ"], "SPAC shells are left out");
const ics = buildCalendarIcs({ events: mdEvents.concat([{ type: "fomc", date: "2026-12-09", title: "FOMC decision" }]) }, { symbols: [], nowIso: "2026-11-07T12:00:00Z" });
ok(/Quarterly options expiration/.test(ics) && /Monthly options expiration/.test(ics), "market dates reach the .ics feed");
ok(!/lockup/i.test(ics) || /estimate/i.test(ics), "lockup ends in the feed say they are estimates");

// --- Fed liquidity -------------------------------------------------------------
const weeks = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2025, 9, 1) + i * 7 * 86400000).toISOString().slice(0, 10));
const liq = buildFedLiquidity({
  walcl: weeks.map((d, i) => ({ date: d, value: 7_000_000 - i * 1000 })),
  tga: weeks.map((d) => ({ date: d, value: 800_000 })),
  rrp: weeks.map((d) => ({ date: d, value: 300 })),
});
eq(liq.net[0], 5900, "net liquidity = Fed assets − Treasury cash − reverse repo (billions)");
eq(liq.change4w, -4, "four-week change");
eq(buildFedLiquidity({ walcl: [], tga: [], prior: { net: [1] } }).stale, true, "a failed fetch carries the prior line, marked stale");

// --- synthetic chains --------------------------------------------------------------
function bars(n, start, drift, seed) {
  let x = start, s = seed;
  const out = [];
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    x *= 1 + drift + (s / 233280 - 0.5) * 0.03;
    const d = new Date(Date.UTC(2025, 10, 3) + i * 86400000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push({ t: d.toISOString().slice(0, 10), c: Math.round(x * 100) / 100, v: 1e6 + (s % 1000) * 1000 });
  }
  return out;
}
const expSec = Math.floor(Date.parse("2026-11-06T00:00:00Z") / 1000);
const chains = {};
[["SPY", 600, 0.0005], ["AAA", 100, 0.001], ["BBB", 50, -0.001], ["CCC", 20, 0.002], ["DDD", 80, 0]].forEach(([s, p, d], i) => {
  chains[s] = {
    spot: p, _bars: bars(380, p, d, 17 + i * 31),
    fundamentals: { shortName: s + " Inc", marketCap: 1e10 * (i + 1), trailingPE: 20, shortInterest: { percentFloat: 4 + i, daysToCover: 2.5, changePct: 10, settlementDate: "2026-10-31" },
      recommendationMean: 1.8, targetMeanPrice: 999 },
    technicals: { rsi: 55, volRegime: { rv30: 0.3 } },
    ivRank: { iv: 0.35, pctile: 40 + i * 10 },
    ivSurface: { skew25: 0.03, skewZ: 0.5 * i },
    grade: { total: 7 }, autoPick: { strike: 1 }, judgment: { text: "private" },
    chains: { [expSec]: { c: [{ s: p, v: 100 }], p: [{ s: p, v: 50 }] }, [expSec + 14 * 86400]: { c: [{ s: p, v: 30 }], p: [] } },
  };
});
const syms = Object.keys(chains);
const map = buildMarketMap({ chains, symbols: syms, sectorOf: () => "Tech", groupOf: () => "Technology", isEtf: (s) => s === "SPY", ivBand: () => ({ band: "normal" }), builtAtIso: "2026-11-06T21:10:00Z" });
eq(map.rows.length, 5, "one row per name");
const aaa = map.rows.find((r) => r.s === "AAA");
eq(aaa.si, 5, "short interest % of float on the row");
ok(Array.isArray(aaa.sp) && aaa.sp.length >= 30 && aaa.sp[0] === 0, "six-month spark starts at zero");
eq(map.corr.syms.length, 4, "correlation leaves ETFs out");
ok(map.corr.m.every((row, i) => row[i] === 100), "correlation diagonal is 100");
ok(map.breadth.dates.length > 100 && map.breadth.a50.every((v) => v == null || (v >= 0 && v <= 100)), "breadth shares are percentages");
eq(map.zeroDte.total.d0, 5 * 150, "same-day option volume counted");
ok(map.zeroDte.total.d0Pct > 0 && map.zeroDte.total.d0Pct < 100, "same-day share is a percentage");

// Owner fields never reach a public file, and the public boundary leaves the
// new files as built.
const OWNER_KEYS = ["grade", "grades", "autoPick", "judgment", "recommendationMean", "targetMeanPrice", "aiSignals", "entryTiming", "_grade", "gradeTotal", "thesis", "picks"];
function ownerKeysIn(v, path = "$", out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => ownerKeysIn(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (OWNER_KEYS.includes(k)) out.push(`${path}.${k}`); ownerKeysIn(x, `${path}.${k}`, out); }
  return out;
}
eq(ownerKeysIn(map), [], "market map carries no Owner field");
eq(publicDataPayload("market-map.json", map), JSON.parse(JSON.stringify(map)), "public boundary leaves the market map unchanged");

// --- what changed --------------------------------------------------------------------
const oi1 = { tickers: [{ symbol: "AAA", callWall: { strike: 110 }, putWall: { strike: 95 } }] };
const oi2 = { tickers: [{ symbol: "AAA", callWall: { strike: 120 }, putWall: { strike: 95 } }] };
const day1 = JSON.parse(JSON.stringify(chains));
for (const s of syms) day1[s]._bars = day1[s]._bars.slice(0, -1);
const snap1 = buildSiteSnapshot({ chains: day1, oi: oi1, unusual: { tickers: [] }, f13: null, builtAtIso: "2026-11-05T21:10:00Z" });
const snap2 = buildSiteSnapshot({ chains, oi: oi2, unusual: { tickers: [{ symbol: "BBB", contracts: [{ side: "put", strike: 45, expSec, premium: 2.5e6, vol: 5000 }] }] }, f13: null, builtAtIso: "2026-11-06T21:10:00Z" });
const changes = nextSiteChanges(nextSiteChanges(null, snap1), snap2);
eq(changes.since, "2026-11-05", "diffed against the prior trading day");
ok(changes.items.some((i) => i.kind === "wall" && i.s === "AAA" && i.to === 120), "call wall move listed");
ok(changes.items.some((i) => i.kind === "flow" && i.s === "BBB"), "new unusual trade listed");
eq(Object.keys(changes.snapshots).length, 2, "keeps the recent snapshots for the next diff");
eq(ownerKeysIn(changes), [], "what-changed carries no Owner field");
const sameDay = nextSiteChanges(changes, { ...snap2, at: "2026-11-06T22:00:00Z" });
eq(sameDay.since, "2026-11-05", "a later build the same day still diffs against yesterday");

// --- past days -------------------------------------------------------------------------
const days = buildMarketDays({ chains, symbols: syms, builtAtIso: "2026-11-06T21:10:00Z" });
eq(days.dates.length, Math.min(252, chains.SPY._bars.length), "one date per SPY session, up to a year");
eq(days.moves.AAA.length, days.dates.length, "a move per date");
const c = chains.AAA._bars, n = c.length;
eq(days.moves.AAA[days.moves.AAA.length - 1], Math.round((c[n - 1].c / c[n - 2].c - 1) * 10000), "moves are basis points");
eq(ownerKeysIn(days), [], "market days carry no Owner field");
const briefs = buildMarketDayBriefs({ prior: { briefs: [{ date: "2026-11-05", headline: "Old policy", v: 0 }] }, brief: { headline: "Stocks slid", summary: "x", generatedAtIso: "2026-11-06T21:10:00Z", accessPolicyVersion: BRIEF_ACCESS_POLICY_VERSION }, policyVersion: BRIEF_ACCESS_POLICY_VERSION, builtAtIso: "2026-11-06T21:10:00Z" });
eq(briefs.briefs.map((b) => b.headline), ["Stocks slid"], "only briefs minted under the current policy are kept");

// --- Owner / public split ------------------------------------------------------------------
for (const k of ["market-map.json", "site-changes.json", "market-days.json"]) ok(!isPremiumKey(k), `${k} is public`);
for (const k of ["market-days-briefs.json", "grades-daily.json", "picks-open.json", "picks-accuracy.json", "picks-run-2026-11-06.json", "picks-fills.json"]) {
  ok(isPremiumKey(k), `${k} is Owner-only`);
  eq(roleClaimForKey(k), ["tr", "tp"], `${k} needs the Owner claims`);
}
// The browser asks for Owner files only with an Owner session.
const client = await readFile(new URL("render/views-next-client.mjs", import.meta.url), "utf8");
const OWNER_FILES = /(market-days-briefs|grades-daily|picks-open|picks-accuracy|picks-run-)/;
for (const m of client.matchAll(/vnJson\(([^)]*)\)/g)) {
  if (OWNER_FILES.test(m[1])) ok(/,\s*true\s*$/.test(m[1]), `Owner fetch is marked Owner-only: vnJson(${m[1]})`);
}
ok(/if \(ownerOnly && !HAS_OWNER_ACCESS\) return Promise\.resolve\(null\)/.test(client), "Owner-only fetches stop without an Owner session");
const app = await readFile(new URL("render/app-js.mjs", import.meta.url), "utf8");
ok(/function bookRiskHtml\(open\)\{\s*if \(!HAS_OWNER_ACCESS/.test(app), "book risk renders only for the Owner");
ok(/function accNoteBoxHtml\(kind, id\)\{\s*if \(!HAS_OWNER_ACCESS/.test(app), "trade notes render only for the Owner");
const stock = await readFile(new URL("render/stock-page-js.mjs", import.meta.url), "utf8");
ok(/function tabOwner\(\)\{\s*if \(!HAS_OWNER_ACCESS\) return '';/.test(stock), "stock page Owner tab stays Owner-only");

// --- earnings price paths ------------------------------------------------------------------
const { earningsPathFromBars } = await import("./build.mjs");
const eb = Array.from({ length: 30 }, (_, i) => ({ t: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10), c: 100 + i }));
const path = earningsPathFromBars(eb, "2026-10-15", "PM");
eq(path.length, 16, "10 sessions before to 5 after");
eq(path[9], 0, "anchored to the close before the reaction");
eq(path[10], Math.round((115 / 114 - 1) * 10000) / 10000, "index 10 is the reaction session (PM: next day)");
eq(earningsPathFromBars(eb, "2026-10-15", "AM")[10], 0.0088, "AM report reacts the same day");

// --- grade calibration ----------------------------------------------------------------------
const calDays = Array.from({ length: 12 }, (_, d) => ({
  date: `2026-01-${String(d + 1).padStart(2, "0")}`,
  rows: [-8, -5, -2, 0, 2, 5, 8].map((g, i) => ({ grade: g, fwd: g * 0.3 + (d % 3 - 1) * 0.2 + i * 0 })),
}));
const cal = gradeCalibration(calDays, null);
eq(cal.length, 7, "seven grade bars");
ok(cal.every((b, i) => i === 0 || b.meanFwdPct > cal[i - 1].meanFwdPct), "a grade that calls direction climbs left to right");
ok(cal[6].lowPct > cal[0].highPct, "strong ranges separate");
eq(cal[6].hitRate, 1, "strong call names all rose");
eq(gradeCalibration(calDays.slice(0, 2), null)[0].lowPct, null, "no range with fewer than three windows");

// --- trade journal ---------------------------------------------------------------------------
const id = "NVDA-C-11/04/26-11:04";
let r = applyTradeNote({}, { trade_id: id.toLowerCase(), text: "  Took it after the dip.\r\n\n\n\nWatch earnings. ", tags: ["Followed the plan", "Earnings", "Earnings"] }, "2026-11-07T10:00:00Z");
eq(r.notes.trades[id], { text: "Took it after the dip.\n\nWatch earnings.", tags: ["Followed the plan", "Earnings"], at: "2026-11-07T10:00:00Z" }, "trade note saved, trimmed and deduped");
r = applyTradeNote(r.notes, { ticker: "brk.b", text: "Slow mover", tags: [] });
ok(r.notes.tickers["BRK.B"] && r.notes.trades[id], "ticker note saved beside trade notes");
eq(applyTradeNote(r.notes, { ticker: "BRK.B", text: "", tags: [] }).notes.tickers["BRK.B"], undefined, "empty note clears it");
eq(applyTradeNote(r.notes, { trade_id: id, clear: true }).notes.trades[id], undefined, "clear removes a trade note");
eq(applyTradeNote({}, { trade_id: id, tags: ["Made up"] }).error, 'unknown tag "Made up"', "only listed tags");
ok(applyTradeNote({}, { trade_id: "NOT-AN-ID", text: "x" }).error, "bad trade id refused");
ok(applyTradeNote({}, { ticker: "<script>", text: "x" }).error, "bad ticker refused");
ok(applyTradeNote({}, { ticker: "AAA", trade_id: id, text: "x" }).error, "one target per note");
eq(applyTradeNote({}, { ticker: "AAA", text: "x".repeat(5000) }).notes.tickers.AAA.text.length, TRADE_NOTE_MAX_CHARS, "long notes are cut");
ok(TRADE_NOTE_TAGS.length >= 6, "tag list");
const api = await readFile(new URL("../api/auth/[action].js", import.meta.url), "utf8");
ok(/\.\.\.\(prev\.notes \? \{ notes: prev\.notes \} : \{\}\)/.test(api), "a CSV upload keeps the notes");
ok(/req\.body\.note\b/.test(api) && /isSameOriginRequest\(req\)\) return res\.status\(403\)[\s\S]{0,2500}req\.body\.note/.test(api), "note saves sit behind the same-origin check");

// --- sports calibration -----------------------------------------------------------------------
const summary = modelSummary({ model_version: "t", evaluation: { points: { status: "validated", test: { n: 400, ece: 0.02, reliability: [{ lo: 0.4, hi: 0.5, n: 120, mean_p: 0.45, hit_rate: 0.47 }, { lo: 0.5, hi: 0.6, n: 0, mean_p: 0, hit_rate: 0 }, { lo: 0.6, hi: 0.7, n: 80, mean_p: 0.64, hit_rate: 0.61 }] } } } });
eq(summary.stats.points.reliability, [{ p: 0.45, y: 0.47, n: 120 }, { p: 0.64, y: 0.61, n: 80 }], "status card carries the reliability dots");
eq(modelSummary({ evaluation: { points: { test: {} } } }).stats.points.reliability, [], "no bins, no dots");

// --- generated app ------------------------------------------------------------------------------
const built = await readFile(new URL("app.js", `file://${root}`), "utf8").catch(() => "");
if (built.includes("renderViewsNext") || built.includes("loadMarketMap")) {
  ok(!/\.replace\(\/\n/.test(built), "no raw newline inside a generated regex");
}

console.log(`views-next smoke passed (${checks} checks)`);
