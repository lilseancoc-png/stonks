// Top Picks run archive smoke test (lib/picks-run-archive.mjs). Offline: fake
// chains, the real scorer + roster builder, no Yahoo, no AI, no store.
// Run: node scripts/picks-run-archive-smoke.mjs
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PICKS_RUN_ARCHIVE_VERSION, PICKS_RUN_MAX_PER_DAY,
  buildPicksRunRecord, compactContract, compactSingle, isCurrentPicksRunPublishKey,
  loadPicksRunDay, mergePicksRunDay, parsePicksRunDay, persistPicksRun, picksRunArchiveEnabled, picksRunDayKey,
} from "../lib/picks-run-archive.mjs";
import {
  isBakeOwnedKey, isDynamicBakeKey, isLocalOnlyKey, isPicksRunArchiveKey, isSeedableKey,
} from "../lib/data-ownership.mjs";
import { isPremiumKey, isRoleRestrictedKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { hydrationPolicy } from "../lib/data-hydration.mjs";
import { assertSeedOwnerKeys } from "./sync-data.mjs";
import { buildTopPicks, pickContractForPick, scoreAllTickers } from "./build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const ok = (label, cond) => { assert.ok(cond, label); n++; };

// --- keys and storage policy ----------------------------------------------
const day = "2026-11-09";
const key = picksRunDayKey(day);
ok("key: flat dated name", key === "picks-run-2026-11-09.json");
ok("key: matcher accepts the day file", isPicksRunArchiveKey(key));
ok("key: matcher rejects nested, undated and other names",
  !isPicksRunArchiveKey("picks-run/2026-11-09.json") && !isPicksRunArchiveKey("picks-run-latest.json")
  && !isPicksRunArchiveKey("picks.json") && !isPicksRunArchiveKey("picks-run-2026-11-9.json"));
assert.throws(() => picksRunDayKey("2026-02-30"), /invalid/);
n++;
ok("privacy: Owner-only on every check", isPremiumKey(key) && isRoleRestrictedKey(key)
  && JSON.stringify(roleClaimForKey(key)) === JSON.stringify(["tr", "tp"]));
ok("ownership: bake-owned, seedable, not local-only", isBakeOwnedKey(key) && isSeedableKey(key) && !isLocalOnlyKey(key));
ok("ownership: not dynamic, so push never delete-stales an older day", !isDynamicBakeKey(key));
assert.doesNotThrow(() => assertSeedOwnerKeys([key]));
assert.throws(() => assertSeedOwnerKeys([key], (k) => (isPicksRunArchiveKey(k) ? false : isPremiumKey(k))), /public copy of picks-run-/);
n += 2;

const bake = hydrationPolicy({ bakeDate: day });
ok("hydration: the bake reopens today's file", bake(key));
ok("hydration: the bake leaves older days remote", !bake("picks-run-2026-11-06.json"));
for (const owner of ["unusual", "oi", "brief", "transcripts", "search-interest", "overnight"]) {
  ok(`hydration: ${owner} never downloads the archive`, !hydrationPolicy({ owner, bakeDate: day })(key));
}
ok("hydration: a research pull can opt into every day", hydrationPolicy({ bakeDate: day, includeArchives: true })("picks-run-2026-01-02.json"));
ok("freshness: only today's file is this run's output",
  isCurrentPicksRunPublishKey(key, day) && !isCurrentPicksRunPublishKey("picks-run-2026-11-06.json", day)
  && !isCurrentPicksRunPublishKey("picks.json", day));
ok("kill switch: on by default, PICKS_RUN_ARCHIVE=0 turns it off",
  picksRunArchiveEnabled({}) && !picksRunArchiveEnabled({ PICKS_RUN_ARCHIVE: "0" }) && !picksRunArchiveEnabled({ PICKS_RUN_ARCHIVE: "false" }));

// --- contract compaction ----------------------------------------------------
const single = compactSingle({ strike: 100, expiry: 1790000000, dte: 45, bid: 4.1, ask: 4.3, mid: 4.2, iv: 0.41, delta: 0.55, oi: 900, contractQuality: { overall: "good" }, earningsInWindow: false });
ok("single: quote fields kept, nested objects dropped", single.k === 100 && single.b === 4.1 && single.a === 4.3 && single.d === 0.55 && single.ew === false && !("contractQuality" in single));
ok("single: a contract with no strike is dropped", compactSingle({ bid: 1 }) === null && compactSingle(null) === null);
const vert = compactContract({ structure: "debit_vertical", optionType: "call", longStrike: 100, shortStrike: 110, expiry: 1790000000, dte: 45, mid: 3.2, netDebit: 3.2, maxLoss: 320, maxProfit: 680,
  legs: [{ qty: 1, type: "call", strike: 100, bid: 5, ask: 5.2, iv: 0.4, expiry: 1790000000 }, { qty: -1, type: "call", strike: 110, bid: 1.8, ask: 2, iv: 0.38, expiry: 1790000000 }] });
ok("shipped contract: structure and both legs with bid/ask", vert.st === "debit_vertical" && vert.legs.length === 2 && vert.legs[1].q === -1 && vert.legs[0].b === 5 && vert.maxLoss === 320);

// --- a real roster through the real engine -----------------------------------
const dayMs = 86400000;
const exp45 = Math.floor((Date.now() + 47 * dayMs) / dayMs) * 86400;
const inDays = (d) => new Date(Date.now() + d * dayMs).toISOString().slice(0, 10);
function mkChain(spot) {
  const c = [], p = [];
  for (let k = 0.80; k <= 1.20; k += 0.025) {
    const strike = Math.round(spot * k);
    const mid = Math.max(0.5, spot * 0.04 * (1.2 - Math.abs(1 - k)));
    c.push({ s: strike, b: mid * 0.98, a: mid * 1.02, l: mid, iv: 0.4, oi: 800, v: 200 });
    p.push({ s: strike, b: mid * 0.98, a: mid * 1.02, l: mid, iv: 0.42, oi: 800, v: 200 });
  }
  return { [String(exp45)]: { c, p } };
}
function mkBars(spot, count, trend) {
  const bars = [];
  let px = spot / (1 + trend * count);
  for (let i = 0; i < count; i++) {
    const w = i % 2 === 0 ? Math.max(0.003, Math.abs(trend) * 2) : -Math.max(0.003, Math.abs(trend) * 2);
    px *= 1 + trend + w;
    bars.push({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), o: px, c: px, h: px * 1.01, l: px * 0.99, v: 1_000_000 + (i % 5) * 20_000 });
  }
  return bars;
}
function mkTicker(spot, sector, bull = true) {
  return {
    spot, chains: mkChain(spot),
    fundamentals: {
      sector, trailingPE: 25, earningsGrowthYoy: bull ? 15 : -30, revenueGrowthYoy: bull ? 12 : -22,
      targetMeanPrice: spot * (bull ? 1.15 : 0.85), numberOfAnalystOpinions: 12,
      analystRevisions: bull ? { upgrades: 3, downgrades: 0 } : { upgrades: 0, downgrades: 4 },
      freeCashFlow: 1e9, netMarginHistory: [{ value: 18 }, { value: 19 }, { value: 20 }],
      fiftyTwoWeekHigh: spot * 1.4, fiftyTwoWeekLow: spot * 0.7, shortPercentOfFloat: 4, nextEarningsDate: inDays(60), growthEstimateCurY: 18,
    },
    technicals: {
      rsi: bull ? 58 : 38, rsi5d: bull ? 54 : 44, macd: bull ? { hist: 0.4, line: 1, signal: 0.6 } : { hist: -0.5, line: -1, signal: -0.4 },
      volume: { rvol: 1.4, priceMove1dPct: bull ? 0.8 : -1.2 },
      sr: { s20: spot * 0.95, r20: spot * 1.05, s50: spot * 0.9, r50: spot * 1.1, s100: spot * 0.85, r100: spot * 1.2 },
      sma: bull ? { sma20: spot * 0.99, sma50: spot * 0.95, sma100: spot * 0.9 } : { sma20: spot * 1.05, sma50: spot * 1.1, sma100: spot * 1.15 },
      volRegime: { rv30Pctile: 40, rv30: 0.35 },
    },
    news: { sentiment: bull ? "bullish" : "bearish" },
    social: { msgCount24h: 50, bullishPct: bull ? 60 : 20, bearishPct: bull ? 20 : 60 },
    ivRank: { pctile: 45, n: 60, iv: 0.4, z: 0.1 },
    _bars: mkBars(spot, 60, bull ? 0.002 : -0.003),
    aiSignals: { guidance: { direction: "inline" }, majorContract: null },
    catalysts: [],
  };
}
const chains = {
  BULLA: mkTicker(120, "Software"), BULLB: mkTicker(80, "Semis"), BEAR: mkTicker(200, "Energy", false),
  MEH: mkTicker(30, "Pharma"), SPY: mkTicker(500, "ETF"),
};
const builtAtIso = new Date().toISOString();
const scoring = scoreAllTickers(chains, [], null, null, null, null, { builtAtIso });
const picks = buildTopPicks(chains, [], null, null, null, null, 0.045, { preScored: scoring, builtAtIso });
// Stand in for the grader on one name so the AI fields are exercised.
const firstSym = scoring.scored[0].sym;
const firstSide = scoring.scored[0].side || "call";
const aiMap = { [`${firstSym}:${firstSide}`]: { grade: "moderate", score: 61, entryVerdict: "wait", confidence: "moderate", macroSupport: "neutral", entryReason: "x".repeat(400), summary: "not archived" } };
const run = buildPicksRunRecord({
  builtAtIso, scored: scoring.scored, picks, aiMap, aiActive: true,
  openPositions: [{ symbol: "MEH", side: "call" }, { symbol: "BAD" }],
  contractFor: (sym, side) => pickContractForPick(side, chains[sym], 0.045),
  versions: { grade: "g1", exit: "e1", nothing: null },
});
ok("record: version and stamp", run.v === PICKS_RUN_ARCHIVE_VERSION && run.builtAtIso === builtAtIso && /^\d{2}:\d{2}$/.test(run.et));
ok("record: one row per scored name", run.rows.length === scoring.scored.length);
ok("record: versions kept, nulls dropped", run.versions.grade === "g1" && run.versions.exit === "e1" && !("nothing" in run.versions));
ok("record: open book listed, malformed rows dropped", run.open.length === 1 && run.open[0] === "MEH:call");
const row0 = run.rows.find((r) => r.s === firstSym);
ok("row: total, side, spot, pillar scores and signal votes", row0.tot != null && (row0.side === "call" || row0.side === "put") && row0.spot > 0
  && row0.pillars && Object.keys(row0.pillars).length >= 4 && row0.signals && Object.keys(row0.signals).length > 0);
ok("row: entry timing state", run.rows.every((r) => r.tm && typeof r.tm.st === "string"));
ok("row: single-option quote with bid and ask on the graded side", run.rows.filter((r) => r.c).length >= 3 && run.rows.filter((r) => r.c).every((r) => r.c.b > 0 && r.c.a >= r.c.b && r.c.k > 0));
ok("row: IV context", row0.iv && row0.iv.pct === 45 && row0.iv.rv30 === 0.35);
ok("row: AI verdict compact, reason clipped, prose left out", row0.ai.g === "moderate" && row0.ai.sc === 61 && row0.ai.ev === "wait" && row0.ai.er.length === 220 && !("summary" in row0.ai));
ok("row: rows without a grader verdict carry none", run.rows.filter((r) => r.ai).length === 1);
ok("row: every name has an outcome or none", run.rows.every((r) => r.out === null || /^(pick:|gate:|open$|below-bar$)/.test(r.out)));
const shipped = new Set(picks.map((p) => `${p.symbol}:${p.side}`));
ok("row: shipped names read pick:<group>", run.rows.filter((r) => shipped.has(`${r.s}:${r.side}`)).every((r) => r.out.startsWith("pick:")));
ok("picks: one compact row per shipped pick", run.picks.length === picks.length);
ok("picks: shipped rows carry the real contract", run.picks.every((p) => !p.c || p.c.st));
ok("lists: only symbol arrays from rosterMeta", Object.values(run.lists).every((v) => Array.isArray(v) && v.every((s) => typeof s === "string")));
ok("record: no raw bars or chains leak in", !JSON.stringify(run).includes('"priceSeries"') && !JSON.stringify(run).includes('"chains"'));
// 85 names at this row size stays near 100 KB a run.
const perRow = JSON.stringify(run.rows).length / run.rows.length;
ok(`size: about ${Math.round(perRow)} bytes a name (budget 1500)`, perRow < 1500);
ok("pure: building the record leaves the roster untouched", JSON.stringify(buildTopPicks(chains, [], null, null, null, null, 0.045, { preScored: scoring, builtAtIso }).map((p) => p.symbol)) === JSON.stringify(picks.map((p) => p.symbol)));

// --- day file merge ----------------------------------------------------------
const mkRun = (iso) => ({ v: 1, builtAtIso: iso, rows: [] });
const morning = mergePicksRunDay({ date: day, run: mkRun("2026-11-09T16:05:00.000Z") });
ok("merge: first run starts the day", morning.date === day && morning.runs.length === 1);
const both = mergePicksRunDay({ date: day, existing: morning, run: mkRun("2026-11-09T20:35:00.000Z") });
ok("merge: afternoon run appends in time order", both.runs.length === 2 && both.runs[0].builtAtIso < both.runs[1].builtAtIso);
const retry = mergePicksRunDay({ date: day, existing: both, run: { ...mkRun("2026-11-09T20:35:00.000Z"), retried: true } });
ok("merge: same stamp replaces, never duplicates", retry.runs.length === 2 && retry.runs[1].retried === true);
const stale = mergePicksRunDay({ date: day, existing: { date: "2026-11-06", runs: [mkRun("2026-11-06T16:05:00.000Z")] }, run: mkRun("2026-11-09T16:05:00.000Z") });
ok("merge: another day's runs are never carried in", stale.runs.length === 1 && stale.runs[0].builtAtIso.startsWith(day));
let many = null;
for (let i = 0; i < PICKS_RUN_MAX_PER_DAY + 3; i++) many = mergePicksRunDay({ date: day, existing: many, run: mkRun(`2026-11-09T${String(10 + i).padStart(2, "0")}:00:00.000Z`) });
ok("merge: a retry storm keeps only the newest runs", many.runs.length === PICKS_RUN_MAX_PER_DAY && many.runs.at(-1).builtAtIso.startsWith("2026-11-09T20"));
ok("parse: rejects another date or a bad body", parsePicksRunDay(JSON.stringify(both), "2026-11-10") === null && parsePicksRunDay("{oops", day) === null);

// --- file round trip -----------------------------------------------------------
const dir = await mkdtemp(resolve(tmpdir(), "picks-run-"));
try {
  const fresh = await loadPicksRunDay(dir, day);
  ok("load: a missing file is a fresh day, not an error", fresh.today === null && !fresh.error);
  const first = await persistPicksRun({ dataDir: dir, bakeDate: day, run, context: fresh, env: {} });
  ok("persist: writes today's flat key", first.key === key && first.runs === 1 && first.rows === run.rows.length);
  const ctx = await loadPicksRunDay(dir, day);
  const second = await persistPicksRun({ dataDir: dir, bakeDate: day, run: { ...run, builtAtIso: new Date(Date.parse(builtAtIso) + 4.5 * 3600000).toISOString() }, context: ctx, env: {} });
  ok("persist: the second run of the day appends", second.runs === 2);
  const saved = JSON.parse(await readFile(resolve(dir, key), "utf8"));
  ok("persist: file parses back with both runs", saved.date === day && saved.runs.length === 2 && saved.runs[0].rows.length === run.rows.length);
  ok("persist: kill switch writes nothing", (await persistPicksRun({ dataDir: dir, bakeDate: "2026-11-10", run, env: { PICKS_RUN_ARCHIVE: "0" } })).skipped === "disabled");
  ok("persist: no run, no file", (await persistPicksRun({ dataDir: dir, bakeDate: "2026-11-10", run: null, env: {} })).skipped === "no-run");
  await writeFile(resolve(dir, picksRunDayKey("2026-11-11")), "{broken", "utf8");
  const broken = await loadPicksRunDay(dir, "2026-11-11");
  ok("load: an unreadable file is reported", broken.today === null && !!broken.error);
  const restarted = await persistPicksRun({ dataDir: dir, bakeDate: "2026-11-11", run, context: broken, env: {} });
  ok("persist: an unreadable file starts the day over", restarted.runs === 1 && restarted.restarted === true);
  ok("persist: a bad date is an error, not a throw", !!(await persistPicksRun({ dataDir: dir, bakeDate: "nope", run, env: {} })).error);
} finally {
  await rm(dir, { recursive: true, force: true });
}

// --- wiring in the bake ----------------------------------------------------------
const src = await readFile(resolve(ROOT, "scripts/build.mjs"), "utf8");
const loadAt = src.indexOf("picksRunContext = await loadPicksRunDay(DATA_DIR");
const wipeAt = src.indexOf("const totalChainBytes = await writeChainFiles(");
const persistAt = src.indexOf("const archived = await persistPicksRun({");
const picksWriteAt = src.indexOf("const picksInfo = await writeTopPicksFile(");
ok("bake: today's file is read before the data/ wipe", loadAt > 0 && wipeAt > 0 && loadAt < wipeAt);
ok("bake: the archive is written after picks.json, inside the Top Picks run", persistAt > picksWriteAt && picksWriteAt > wipeAt);
const recordAt = src.indexOf("picksRun = buildPicksRunRecord({");
const rosterAt = src.indexOf("const picks = buildTopPicks(chains, narratives, streaksMap");
ok("bake: the record is built after the roster, so it cannot feed it", recordAt > rosterAt && rosterAt > 0);
const fresh = await readFile(resolve(ROOT, "scripts/verify-data-freshness.mjs"), "utf8");
ok("freshness: today's file has a publication policy", /isCurrentPicksRunPublishKey\(key, etDateKey\(now\)\)/.test(fresh));

console.log(`picks-run-archive smoke: ${n} checks passed`);
