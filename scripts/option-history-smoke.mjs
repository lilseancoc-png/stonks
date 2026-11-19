// Offline checks for lib/option-history (DoltHub rows, the shared row shape,
// the real-price re-test) and the two research scripts' pure parts.
// Run: node scripts/option-history-smoke.mjs
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { occSymbol, rightOf, normalizeDoltRow, parseDoltApi, doltQueryUrl, writeRows, readYear, historyReader } from "../lib/option-history/index.mjs";
import { matchContract, repriceTrade, summarizeReprice, expiryIso } from "../lib/option-history/reprice.mjs";
import { monthsBetween, monthSql } from "./dolthub-options-pull.mjs";
import { runRealPrices } from "./engines-real-prices.mjs";
import { tradeOutRow } from "./engines-backtest.mjs";

let n = 0;
const ok = (label, cond) => { assert.ok(cond, label); n += 1; };

ok("OCC symbol, unpadded", occSymbol("AAPL", "2026-12-18", "C", 150) === "AAPL261218C00150000" && occSymbol("BRK.B", "2026-01-16", "P", 412.5) === "BRKB260116P00412500");
ok("bad OCC inputs give null", occSymbol("", "2026-12-18", "C", 1) === null && occSymbol("AAPL", "2026-12-18", "X", 1) === null);
ok("rights read from words or letters", rightOf("Call") === "C" && rightOf("put") === "P" && rightOf("x") === null);
const dolt = { date: "2024-03-01", act_symbol: "AAPL", expiration: "2024-04-19", strike: "180.00", call_put: "Call", bid: "5.10", ask: "5.30", vol: "0.2412", delta: "0.52", gamma: "0.03", theta: "-0.08", vega: "0.21", rho: "0.1" };
const row = normalizeDoltRow(dolt);
ok("DoltHub row to the shared shape", row.symbol === "AAPL240419C00180000" && row.right === "C" && row.iv === 0.2412 && row.bid === 5.1 && row.ask === 5.3 && row.delta === 0.52 && row.source === "dolthub" && !("rho" in row));
ok("percent IV becomes a decimal", normalizeDoltRow({ ...dolt, vol: "24.12" }).iv === 0.2412);
ok("crossed, empty and expired quotes are dropped", normalizeDoltRow({ ...dolt, bid: 6, ask: 5 }) === null && normalizeDoltRow({ ...dolt, bid: 0, ask: 0 }) === null && normalizeDoltRow({ ...dolt, expiration: "2024-02-01" }) === null);
ok("DoltHub API answers parse; a failed query is not ok", parseDoltApi({ query_execution_status: "Success", rows: [dolt] }).rows.length === 1 && !parseDoltApi({ query_execution_status: "Error", query_execution_message: "timeout" }).ok && !parseDoltApi("<html>").ok);
ok("row-limited answers say so", parseDoltApi({ query_execution_status: "RowLimit", rows: [dolt] }).truncated);
ok("query URL encodes the SQL on the master branch", doltQueryUrl("SELECT 1").endsWith("/post-no-preference/options/master?q=SELECT%201"));
ok("months between two dates, inclusive", monthsBetween("2023-11-15", "2024-02-01").join(",") === "2023-11,2023-12,2024-01,2024-02");
ok("month SQL pages and refuses odd symbols", /LIMIT 1000 OFFSET 2000$/.test(monthSql("AAPL", "2024-12", { limit: 1000, offset: 2000 })) && monthSql("AAPL", "2024-12").includes("date < '2025-01-01'") && (() => { try { monthSql("A'; DROP", "2024-01"); return false; } catch { return true; } })());

// ---- files round trip
const dir = mkdtempSync(join(tmpdir(), "opthist-"));
const mk = (date, strike, bid, ask, expiry = "2024-04-19", right = "C") => normalizeDoltRow({ ...dolt, date, strike, bid, ask, expiration: expiry, call_put: right });
writeRows(dir, [mk("2024-03-01", 180, 5, 5.2), mk("2024-03-01", 185, 3, 3.2)]);
writeRows(dir, [mk("2024-03-01", 180, 5.1, 5.3), mk("2024-03-04", 180, 6, 6.2)]);
const y = readYear(dir, "AAPL", "2024");
ok("rows merge by date and contract; a later row replaces", y.get("2024-03-01").length === 2 && y.get("2024-03-01").find((r) => r.strike === 180).bid === 5.1 && y.get("2024-03-04").length === 1);
ok("missing files read as empty", readYear(dir, "MSFT", "2024").size === 0);

// ---- matching and re-pricing
const day = [mk("2024-03-01", 175, 8, 8.4), mk("2024-03-01", 180, 5, 5.2), mk("2024-03-01", 180, 7, 7.2, "2024-05-17"), mk("2024-03-01", 180, 4, 4.2, "2024-04-19", "P")];
const m = matchContract(day, { right: "C", expiry: "2024-04-21", strike: 179 });
ok("nearest expiry first, then nearest strike, same right", m.strike === 180 && m.expiry === "2024-04-19" && m.right === "C");
ok("nothing within the strike limit gives null", matchContract(day, { right: "C", expiry: "2024-04-19", strike: 300 }) === null);
ok("epoch expiries read as dates", expiryIso(Date.UTC(2024, 3, 19) / 1000) === "2024-04-19");

const hdir = mkdtempSync(join(tmpdir(), "opthist-path-"));
const path = [
  ["2024-03-01", 5.0, 5.2], ["2024-03-04", 5.4, 5.6], ["2024-03-05", 6.6, 6.8], ["2024-03-06", 7.0, 7.2], ["2024-03-08", 6.0, 6.2],
];
writeRows(hdir, path.map(([d, b, a]) => mk(d, 180, b, a)));
const reader = historyReader(hdir);
const trade = { engine: "technicals", setup: "breakout", symbol: "AAPL", side: "call", optionType: "call", strike: 180, expiry: Date.UTC(2024, 3, 19) / 1000, entryDate: "2024-03-01", exitDate: "2024-03-08", entryMid: 4.8, pnlPct: 40 };
const r = repriceTrade(trade, reader, { tp: 25, stop: -40 });
ok("entry at the real ask, same-window exit at the real bid", r.ok && r.realEntry === 5.2 && Math.abs(r.samePct - (6.0 / 5.2 - 1) * 100) < 1e-9);
ok("real path: take-profit on the mid closes at that day's bid", r.pathReason === "take-profit" && r.pathDay === "2024-03-05" && Math.abs(r.pathPct - (6.6 / 5.2 - 1) * 100) < 1e-9);
const noTp = repriceTrade(trade, reader, {});
ok("no exits: the path is the same window", noTp.pathReason === "modeled exit date" && noTp.pathPct === noTp.samePct);
ok("a missing exit quote looks back to the last quote day", repriceTrade({ ...trade, exitDate: "2024-03-07" }, reader, {}).exitDay === "2024-03-06");
ok("no quotes near entry is a skip", repriceTrade({ ...trade, entryDate: "2023-01-03", exitDate: "2023-01-10" }, reader, {}).skip === "no quotes near entry");
ok("a far strike is a skip", repriceTrade({ ...trade, strike: 260 }, reader, {}).skip === "no matching contract");

// ---- summary and the runner
const fake = (i, engine, pct, entryDay) => ({ ok: true, engine, setup: "s", side: "call", entryDay, modeledPct: pct + 20, samePct: pct, pathPct: pct, pathReason: "modeled exit date", entrySpreadPct: 4 });
const priced = [];
for (let i = 0; i < 10; i++) priced.push(fake(i, "technicals", i < 5 ? -10 : 10, `2024-0${1 + Math.floor(i / 2)}-01`));
const s = summarizeReprice(priced, { "no quotes near entry": 3 });
ok("summary: counts, averages, halves, skips", s.priced === 10 && s.skipped === 3 && s.all.realPath.avg === 0 && s.all.modeled.avg === 20 && s.all.halves[0].avg === -10 && s.all.halves[1].avg === 10);
ok("summary: dollars at $2,000 a trade", s.all.usd.modeled === 4000 && s.all.usd.realPath === 0);
ok("summary: setups need 5 trades", Object.keys(s.setups).length === 1);
const run = runRealPrices([trade, { ...trade, entryDate: "2018-06-01" }, { ...trade, trial: true }], reader, { from: "2019-01-01" });
ok("runner: pre-2019 trades skipped, trials kept apart", run.engines.priced === 1 && run.trialsAndTests.priced === 1);
const json = JSON.stringify(run);
ok("runner output holds no price and no trade date", !json.includes("5.2") && !json.includes("2024-03-05") && !/realEntry|pathDay|exitDay/.test(json));

// ---- --trades-out rows
const closed = { engine: "reversion", setup: "oversold-bounce", symbol: "AAPL", side: "call", entryDate: "2024-03-01T14:30:00Z", exitDate: "2024-03-08T20:00:00Z", status: "hit-target", optionPnlPct: 31, outcome: "win", qty: 3,
  contract: { structure: "long", optionType: "call", strike: 180, expiry: 1713484800, dte: 49, mid: 4.8, iv: 0.25 } };
const tr = tradeOutRow(closed);
ok("trades-out row: dates cut to days, contract fields flattened", tr.entryDate === "2024-03-01" && tr.exitDate === "2024-03-08" && tr.strike === 180 && tr.entryMid === 4.8 && tr.pnlPct === 31);
ok("trades-out skips share trades", tradeOutRow({ ...closed, contract: { structure: "shares" } }) === null);

console.log(`option history smoke: ${n} checks passed`);
