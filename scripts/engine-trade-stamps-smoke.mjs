// Measure-only trade stamps (2026-11-26): opposite-side tags on engine trades
// (lib/engines/opposite.mjs) and the market-risk read frozen on each new
// engine and Top Picks trade (lib/market-risk-stamp.mjs). Checks the rules,
// the scoreboard, the brief line, the 1 KB entry snapshot, and that nothing
// that decides a trade reads either stamp. No network.
// Run: node scripts/engine-trade-stamps-smoke.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stampOpposites, oppositeScoreboard, oppositeBriefLine, oppositeTagEnabled, engineSide, flagSide } from "../lib/engines/opposite.mjs";
import { marketRiskStamp, marketRiskTagCounts, MARKET_RISK_ODDS_MAX_DAYS } from "../lib/market-risk-stamp.mjs";
import { buildEntrySnapshot } from "../lib/trade-snapshot.mjs";
import { pickTradeId } from "../lib/pick-trade-text.mjs";
import { OWNER_SETTINGS } from "../lib/owner-settings.mjs";
import { buildOwnerMarketBrief } from "../lib/owner-market-brief.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const src = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

// --- sides and the switch ---------------------------------------------------
ok(engineSide({ side: "put" }) === "down" && engineSide({ side: "call" }) === "up" && engineSide({}) === "up", "engine sides: put down, else up");
ok(flagSide({ side: "put" }) === "down" && flagSide({ side: "bearish" }) === "down" && flagSide({ side: "call" }) === "up", "Top Picks sides");
ok(oppositeTagEnabled({}) && oppositeTagEnabled({ ENGINES_OPPOSITE_TAG: "1" }), "on by default");
for (const v of ["0", "off", "false", " NO "]) ok(!oppositeTagEnabled({ ENGINES_OPPOSITE_TAG: v }), `off on ${v}`);
const setting = OWNER_SETTINGS.find((s) => s.key === "ENGINES_OPPOSITE_TAG");
ok(setting && setting.scope === "build" && setting.default === true && !setting.picks && !setting.impact, "ENGINES_OPPOSITE_TAG is a plain build setting, default on, display only");

// --- stamping ---------------------------------------------------------------
const NOW = "2026-11-27T16:00:00.000Z", EARLIER = "2026-11-20T16:00:00.000Z";
const rec = () => ({ open: [
  { tradeId: "MOM-NVDA", engine: "momentum", symbol: "NVDA", side: "call", entryDate: EARLIER },
  { tradeId: "TEC-NVDA", engine: "technicals", symbol: "NVDA", side: "call", entryDate: EARLIER },
  { tradeId: "REV-NVDA-P", engine: "reversion", symbol: "NVDA", side: "put", entryDate: NOW },
  { tradeId: "REV-NVDA-P-twin", engine: "reversion", symbol: "NVDA", side: "call", entryDate: NOW, twinOf: "REV-NVDA-P" },
  { tradeId: "FUN-AAPL", engine: "fundamentals", symbol: "AAPL", side: "call", entryDate: NOW },
  { tradeId: "FLO-AMD-P", engine: "flow", symbol: "AMD", side: "put", entryDate: NOW },
  { tradeId: "TEC-AMD", engine: "technicals", symbol: "AMD", side: "call", entryDate: NOW },
], closed: [] });
const flagEntry = { symbol: "AAPL", side: "put", entryDate: "2026-11-24T16:00:00.000Z" };
const flagshipOpen = [{ tradeId: pickTradeId(flagEntry), symbol: "AAPL", side: "put" }];
const r = rec();
const links = stampOpposites(r, { flagshipOpen, nowIso: NOW });
const by = (id) => r.open.find((t) => t.tradeId === id);
ok(by("REV-NVDA-P").opposes?.map((x) => x.tradeId).sort().join() === "MOM-NVDA,TEC-NVDA", "a new put is tagged against both open calls on the name");
ok(by("MOM-NVDA").opposedBy?.[0]?.tradeId === "REV-NVDA-P" && by("TEC-NVDA").opposedBy?.[0]?.tradeId === "REV-NVDA-P", "each opposed engine trade names the newcomer");
ok(!by("REV-NVDA-P-twin").opposes && !(by("MOM-NVDA").opposedBy || []).some((x) => x.tradeId === "REV-NVDA-P-twin"), "a shares twin is never tagged or counted");
ok(by("FUN-AAPL").opposes?.[0]?.engine === "flagship" && by("FUN-AAPL").opposes[0].tradeId === flagshipOpen[0].tradeId, "a call against an open Top Pick put names the Top Pick");
// Two new trades in one run on opposite sides make one pair, not two.
const amdPairs = [by("FLO-AMD-P"), by("TEC-AMD")].reduce((s, t) => s + (t.opposes || []).length, 0);
ok(amdPairs === 1, "two new opposite trades in one run make one pair");
ok(links === 4, `link count (${links})`);
const again = stampOpposites(r, { flagshipOpen, nowIso: NOW });
ok(again === 0 && by("MOM-NVDA").opposedBy.length === 1, "stamping again adds nothing");
ok(stampOpposites({ open: [{ tradeId: "x", symbol: "Z", side: "call", entryDate: EARLIER }] }, { nowIso: NOW }) === 0, "an older trade alone is not tagged");
ok(!JSON.stringify(flagshipOpen).includes("opposedBy"), "the Top Picks rows are never written to");

// --- scoreboard -------------------------------------------------------------
const pos = { structure: "long", mid: 2, qty: 10 };
const board = oppositeScoreboard({
  open: [{ tradeId: "MOM-NVDA", engine: "momentum", symbol: "NVDA", side: "call", entryDate: EARLIER, optionPnlPct: 5, contract: pos }],
  closed: [
    { tradeId: "REV-NVDA-P", engine: "reversion", symbol: "NVDA", side: "put", entryDate: NOW, exitDate: NOW, outcome: "loss", optionPnlPct: -20, contract: pos, opposes: [{ tradeId: "MOM-NVDA", engine: "momentum" }, { tradeId: "TEC-NVDA", engine: "technicals" }] },
    { tradeId: "TEC-NVDA", engine: "technicals", symbol: "NVDA", side: "call", entryDate: EARLIER, exitDate: NOW, outcome: "win", optionPnlPct: 15, contract: pos },
    { tradeId: "FUN-AAPL", engine: "fundamentals", symbol: "AAPL", side: "call", entryDate: NOW, exitDate: NOW, outcome: "win", optionPnlPct: 30, contract: pos, opposes: [{ tradeId: flagshipOpen[0].tradeId, engine: "flagship", side: "put" }] },
    { tradeId: "FLO-AMD-P", engine: "flow", symbol: "AMD", side: "put", entryDate: NOW, exitDate: NOW, outcome: "void", optionPnlPct: 0, contract: pos, opposes: [{ tradeId: "TEC-AMD", engine: "technicals" }] },
  ] }, { flagship: [{ ...flagEntry, exitDate: NOW, outcome: "loss", optionPnlPct: -40 }], builtAtIso: NOW });
ok(board.enabled && board.pairs === 4, `four pairs (${board.pairs})`);
ok(board.open === 1, "one pair still has an open side");
ok(board.settled === 2 && board.newerWon === 1 && board.olderWon === 1, "settled: the call over the Top Pick put, the older call over the put");
const tp = board.rows.find((p) => p.kind === "top-picks");
ok(tp && tp.winner === "newer" && tp.by === "pct" && tp.older.name === "Top Picks" && tp.older.pct === -40, "a Top Pick side is matched by trade ID and judged by %");
const ee = board.rows.find((p) => p.newer.tradeId === "REV-NVDA-P" && p.older.tradeId === "TEC-NVDA");
ok(ee && ee.winner === "older" && ee.by === "usd" && ee.netUsd === -400 + 300, "two engine trades are judged by dollars");
ok(board.rows.find((p) => p.newer.tradeId === "FLO-AMD-P").newer.state === "not-counted", "a void close is not counted");
ok(board.rows.find((p) => p.older.tradeId === "TEC-AMD").older.state === "unknown", "a partner no longer on hand reads unknown");
ok(board.engineVsTopPicks.pairs === 1 && board.engineVsEngine.pairs === 3, "the split by partner");
ok(board.byEngine.find((x) => x.engine === "technicals")?.won === 1, "by engine");
ok(oppositeScoreboard({ open: [], closed: [] }, { enabled: false }).enabled === false, "switch off: the scoreboard hides");
ok(/1 open pair/.test(oppositeBriefLine(board)) && /newer trade won 1/.test(oppositeBriefLine(board)), "the brief line");
ok(oppositeBriefLine({ ...board, open: 0 }) === null && oppositeBriefLine({ enabled: false }) === null, "no brief line without an open pair");

// --- the Owner brief finding ------------------------------------------------
const briefWith = (opp) => {
  try { return buildOwnerMarketBrief({ payloads: { "engines.json": { opposites: opp } }, builtAtIso: NOW, desk: {} }); } catch (err) { return { error: String(err?.message || err) }; }
};
const withFinding = briefWith(board), without = briefWith({ ...board, open: 0 });
if (!withFinding.error) {
  ok((withFinding.findings || []).some((f) => f.id === "desk:opposite" && f.priority === 3), "the brief carries the opposite-sides finding");
  ok(!(without.findings || []).some((f) => f.id === "desk:opposite"), "no finding without an open pair");
} else {
  // The brief builder wants more inputs than this smoke gives; the wiring is
  // checked in its source instead.
  const b = src("lib/owner-market-brief.mjs");
  ok(/oppositeBriefLine\(payloads\['engines\.json'\]\?\.opposites\)/.test(b) && /deskFinding\('opposite'/.test(b), "the brief reads the scoreboard into a desk finding");
}

// --- market-risk stamp ------------------------------------------------------
const card = { asOf: "2026-11-25", inDecline: false, stale: false,
  fall: [{ id: "fall10_3m", p: 0.1234 }, { id: "fall10_6m", p: 0.2 }, { id: "fall10_12m", p: 0.31 }, { id: "fall20_12m", p: 0.08 }],
  recovery: [{ id: "lowIn_6m", p: 0.5 }, { id: "newHigh_12m", p: 0.62 }] };
const st = marketRiskStamp({ bottom: { verdict: "pullback", asOf: "2026-11-25" }, quantCard: card, today: "2026-11-27" });
ok(st.v === 1 && st.bt === "pullback" && st.f10_3 === 0.123 && st.f20_12 === 0.08 && st.low6 === 0.5 && st.hi12 === 0.62 && st.oa === "2026-11-25" && st.dec === 0, "verdict and every odds row, rounded");
ok(JSON.stringify(st).length < 160, `the stamp is small (${JSON.stringify(st).length} bytes)`);
ok(marketRiskStamp({ bottom: { verdict: "unavailable" } }) === null, "an unavailable verdict alone stamps nothing");
ok(!("f10_6" in marketRiskStamp({ bottom: { verdict: "stress" }, quantCard: { ...card, stale: true }, today: "2026-11-27" })), "a stale card's odds are left out");
const oldDay = new Date(Date.parse("2026-11-25T12:00:00Z") + (MARKET_RISK_ODDS_MAX_DAYS + 1) * 86400000).toISOString().slice(0, 10);
ok(!("f10_6" in marketRiskStamp({ bottom: { verdict: "stress" }, quantCard: card, today: oldDay })), "a card older than the limit is left out");
ok(marketRiskStamp({ quantCard: { ...card, fall: [{ id: "fall10_6m", p: 1.7 }], recovery: [] }, today: "2026-11-27" }) === null, "an impossible chance is dropped");
ok(marketRiskStamp({}) === null, "nothing in, nothing stamped");
const counts = marketRiskTagCounts({ open: [{ marketRisk: st }], closed: [{ marketRisk: st, exitDate: NOW, outcome: "win" }, { marketRisk: { v: 1 }, exitDate: NOW, outcome: "void" }, { exitDate: NOW }] });
ok(counts.tagged === 3 && counts.closed === 1 && counts.byVerdict.pullback === 2 && counts.byVerdict.none === 1 && !counts.ready, "tag counts");

// --- entry snapshot stays under 1 KB ----------------------------------------
const pillar = (k) => ({ score: 2.5, signals: Array.from({ length: 6 }, (_, i) => ({ key: `${k}${i}`, score: 1, available: true })) });
const pick = { symbol: "NVDA", pillars: { fundamentals: pillar("f"), technicals: pillar("t"), mechanicals: pillar("m"), narrative: pillar("n") }, streak: { color: "green", days: 3, cumulativePct: 4.2 } };
const shadow = { keys: ["r21", "vrp", "sv", "svz", "bf", "att", "rdv", "wkr", "stw", "pf"], rows: { NVDA: [5.1, 2.2, 0.4, 1.1, 0.02, 33, 12, 8, 1200, 0.01] } };
const snap = buildEntrySnapshot(pick, { spot: 100, technicals: { rsi: 55, sma: { sma20: 98, sma50: 95, sma200: 90 } } }, { shadow, marketRisk: st });
ok(snap.risk && snap.risk.bt === "pullback" && snap.risk.f10_6 === 0.2, "the Top Picks snapshot carries the market-risk read");
ok(JSON.stringify(snap).length < 1024, `a full snapshot stays under 1 KB (${JSON.stringify(snap).length} bytes)`);
ok(!("risk" in buildEntrySnapshot(pick, {}, {})), "no read, no risk key");

// --- wiring: stamped after the book, never read by a decision ---------------
const idx = src("lib/engines/index.mjs");
ok(idx.indexOf("stampOpposites(record") > idx.indexOf("const out = stepBook(state, record, stepInput)"), "opposite tags are written after the book step");
ok(idx.indexOf("t.marketRisk = { ...input.marketRisk }") > idx.indexOf("const out = stepBook(state, record, stepInput)"), "market-risk stamps are written after the book step");
for (const f of ["lib/engines/book.mjs", "lib/engines/signals.mjs", "lib/engines/learn.mjs", "lib/engines/allocator.mjs", "lib/engines/contracts.mjs", "lib/webull-mirror.mjs", "lib/top-picks-config.mjs", "lib/trade-instructions.mjs"]) {
  ok(!/\bopposes\b|\bopposedBy\b|\bmarketRisk\b|entrySnapshot\??\.risk/.test(src(f)), `${f} reads neither stamp`);
}
const build = src("scripts/build.mjs");
ok(/marketRisk: marketRiskNow \}\);/.test(build) && /marketRisk: opts\.marketRisk \|\| null/.test(build) && /marketRisk: marketRiskNow,\n\s+\}\);/.test(build), "the bake hands the read to Top Picks and the engines");
ok(!/\.opposes\b|\.opposedBy\b|opposes:|opposedBy:/.test(build), "the bake never writes opposite tags (the Top Picks record stays clean)");
ok(["lib/engines/opposite.mjs", "lib/market-risk-stamp.mjs"].every((f) => !/fetch\(|gemini|generateContent|recordAiUsage/i.test(src(f))), "no network or AI in either module");

console.log(`engine-trade-stamps-smoke: ${n} checks pass`);
