// Similar-setup odds (lib/setup-odds.mjs) and its record wiring.
// Run: node scripts/setup-odds-smoke.mjs   (offline, no network)
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gradeBand, marketType, setupOf, decidedTrades, oddsFor, buildSetupOdds, SETUP_MIN_N } from "../lib/setup-odds.mjs";

assert.equal(gradeBand(7.4), "7");
assert.equal(gradeBand(-8.2), "8", "put grades are negative; the band uses the size");
assert.equal(gradeBand(9), "9+");
assert.equal(gradeBand(4), "under 7");
assert.equal(gradeBand(null), null);
assert.equal(marketType("severe"), "risk-off");
assert.equal(marketType("Risk-On"), "risk-on");
assert.equal(marketType("neutral"), "neutral");
assert.equal(marketType(undefined), null);
assert.deepEqual(setupOf({ side: "put", total: -8.5 }, "neutral"), { side: "put", band: "8", market: "neutral" }, "roster rows use total + today's market");
assert.deepEqual(setupOf({ side: "call", score: 7.2, entryRegime: "risk-on" }, "neutral"), { side: "call", band: "7", market: "risk-on" }, "a trade keeps its market at entry");
assert.equal(setupOf({ side: "both" }), null);

let k = 0;
const trade = (side, score, regime, outcome, pnl, extra = {}) => ({
  symbol: `T${k}`, side, score, entryRegime: regime, outcome, optionPnlPct: pnl,
  entryDate: new Date(Date.UTC(2026, 8, 1) + (k++) * 3600000).toISOString(), ...extra,
});
const closed = [
  // 9 calls, grade 8, neutral: 6 wins
  ...[30, 28, 25, 26, 40, 31].map((p) => trade("call", 8.3, "neutral", "win", p)),
  ...[-50, -52, -48].map((p) => trade("call", 8.1, "neutral", "loss", p)),
  // 4 calls, grade 8, risk-on: all losses
  ...[-50, -55, -50, -45].map((p) => trade("call", 8.6, "risk-on", "loss", p)),
  // 3 puts, grade 9, severe
  trade("put", -9.4, "severe", "win", 60), trade("put", -9.1, "risk-off", "loss", -50), trade("put", -9.9, "severe", "win", 26),
  // never counted
  trade("call", 8.2, "neutral", "left-coverage", 10), trade("call", 8.2, "neutral", "flat", 0),
  trade("call", 8.2, "neutral", "win", 22, { counted: false }), trade("call", 8.2, "neutral", "win", null),
];
const dup = { ...closed[0] };
const decided = decidedTrades([...closed, dup]);
assert.equal(decided.length, 16, "win/loss only, counted, with a P&L, deduped by symbol:side:entryDate");

// Exact level when it has enough trades.
let o = oddsFor({ side: "call", band: "8", market: "neutral" }, decided);
assert.equal(o.level, "side-band-market");
assert.equal(o.n, 9);
assert.equal(o.wins, 6);
assert.equal(o.winPct, 67);
assert.equal(o.avgPnlPct, Math.round(((30 + 28 + 25 + 26 + 40 + 31 - 50 - 52 - 48) / 9) * 10) / 10);
assert.ok(o.range[0] < 67 && o.range[1] > 67);
assert.ok(!o.few);

// Thin exact level loosens to side + band (13 calls at grade 8).
o = oddsFor({ side: "call", band: "8", market: "risk-on" }, decided);
assert.equal(o.level, "side-band");
assert.equal(o.n, 13);
assert.equal(o.market, undefined);

// Nothing reaches the bar: side only, flagged few.
o = oddsFor({ side: "put", band: "9+", market: "risk-off" }, decided);
assert.equal(o.level, "side");
assert.equal(o.n, 3);
assert.equal(o.few, true);

// No market known: skip the market levels.
o = oddsFor({ side: "call", band: "8", market: null }, decided);
assert.equal(o.level, "side-band");
assert.equal(oddsFor(null, decided), null);
// Lower bar for the check below.
assert.equal(oddsFor({ side: "put", band: "9+", market: "risk-off" }, decided, 3).level, "side-band-market");

// Table: roster first, open trades overwrite with their entry setup.
const table = buildSetupOdds({
  closed: closed.slice(0, 10), archive: closed.slice(10),
  roster: [{ symbol: "NVDA", side: "call", total: 8.4 }, { symbol: "TSLA", side: "put", total: -9.2 }],
  rosterRegime: "neutral",
  open: [{ symbol: "NVDA", side: "call", score: 8.9, entryRegime: "risk-on" }],
  builtAtIso: "2026-11-09T16:00:00.000Z",
});
assert.equal(table.v, 1);
assert.equal(table.minN, SETUP_MIN_N);
assert.equal(table.all.n, 16);
assert.equal(table.picks["NVDA|call"].level, "side-band", "the open trade's risk-on entry is too thin, so it loosens");
assert.equal(table.picks["TSLA|put"].few, true);
assert.equal(Object.keys(table.picks).length, 2);
assert.ok(JSON.stringify(table).length < 4000, "small enough to ride in picks-open.json");

// Record wiring: updatePicksAccuracyFile writes setupOdds into both files.
const storage = await mkdtemp(join(tmpdir(), "setup-odds-"));
try {
  await mkdir(join(storage, "data"));
  let source = await readFile(new URL("./build.mjs", import.meta.url), "utf8");
  source = source.replace(/^(import(?:\s*\{[^}]*\}|\s+[^\n;]+?)\s+from\s+|export\s*\{[^}]*\}\s*from\s+)(["'])([^"']+)\2/gm, (whole, prefix, quote, specifier) => specifier.startsWith("node:") ? whole : prefix + quote + (specifier.startsWith(".") ? new URL(specifier, new URL("./build.mjs", import.meta.url)).href : import.meta.resolve(specifier)) + quote);
  source = source.replace('const ROOT = resolve(__dirname, "..");', "const ROOT = " + JSON.stringify(storage) + ";");
  await writeFile(join(storage, "engine.mjs"), source);
  const engine = await import(pathToFileURL(join(storage, "engine.mjs")).href);
  await writeFile(join(storage, "data/picks.json"), JSON.stringify({ builtAtIso: "2026-11-09T16:00:00.000Z", rosterMeta: { regimeBand: "neutral" }, picks: [{ symbol: "AAPL", side: "call", total: 8.2 }] }));
  const recent = closed.map((c, i) => ({ ...c, symbol: "AAPL", entryDate: new Date(Date.now() - (20 - i) * 86400000).toISOString(), exitDate: new Date(Date.now() - (19 - i) * 86400000).toISOString() }));
  await engine.updatePicksAccuracyFile({}, new Date().toISOString(), { open: [], closed: recent, archive: [] }, null, { enrollNewPicks: false });
  const acc = JSON.parse(await readFile(join(storage, "data/picks-accuracy.json"), "utf8"));
  const openFile = JSON.parse(await readFile(join(storage, "data/picks-open.json"), "utf8"));
  assert.ok(acc.setupOdds && acc.setupOdds.picks["AAPL|call"], "picks-accuracy.json carries setupOdds");
  assert.deepEqual(openFile.setupOdds, acc.setupOdds, "picks-open.json carries the same table");
  assert.equal(acc.setupOdds.picks["AAPL|call"].band, "8");
  assert.ok(Array.isArray(openFile.open));
} finally {
  await rm(storage, { recursive: true, force: true });
}
console.log("setup odds smoke: ok");
