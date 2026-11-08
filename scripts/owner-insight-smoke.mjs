#!/usr/bin/env node
// Offline checks for the 2026-11-08 Owner insight bundle: the closed-trade
// post-mortem read, its Scorecard tally and the rolling win-rate series
// (lib/trade-postmortem.mjs), plus the rendered pieces' presence in the
// generated app.js template. No network, no writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tradePostMortemFactory, TRADE_POSTMORTEM } from "../lib/trade-postmortem.mjs";

let n = 0;
const ok = (label, cond) => { n++; if (!cond) { console.error(`✗ ${label}`); process.exit(1); } };

const PM = tradePostMortemFactory();
ok("factory and singleton agree", typeof PM.build === "function" && typeof TRADE_POSTMORTEM.build === "function");
// ES5 body: the factory is pasted into the browser IIFE with toString().
const src = PM.constructor === Function ? tradePostMortemFactory.toString() : "";
ok("factory body is ES5 (no arrows, template literals, let/const)", !/=>|`|\blet\b|\bconst\b/.test(src));

const base = {
  symbol: "NVDA", side: "call", score: 8.2, entryRegime: "risk-on", entrySignal: "buy-now",
  entryDate: "2026-10-01T15:30:00.000Z", exitDate: "2026-10-15T15:30:00.000Z",
  entrySpot: 100, contract: { iv: 0.40, strike: 100, structure: "long", mid: 5 },
  exitPolicy: { takeProfitPct: 25, stopPct: 50 }, cut: 92, takeProfit: 110,
  thesis: { aiGrade: "strong", aiConfidence: "high" },
};

// Wrong direction loss.
const dirLoss = PM.build({ ...base, exitSpot: 94, optionPnlPct: -52, optHiPct: 4, optLoPct: -52, maePct: -6, status: "hit-stop-prem", outcome: "loss", thesisStatus: { verdict: "broken", driversActive: 0, driversTotal: 3, gradeFlip: false, stopBreached: false } });
ok("direction loss classified", dirLoss.outcome === "loss" && dirLoss.cause === "direction" && dirLoss.label === "Wrong direction");
ok("direction loss has stock move and expected move", dirLoss.dirMovePct === -6 && dirLoss.expectedMovePct > 7 && dirLoss.expectedMovePct < 9 && dirLoss.heldDays === 14);
ok("direction loss lesson blames the grade", /direction call was wrong/.test(dirLoss.lesson));
ok("premium stop before stock stop tagged", dirLoss.tags.includes("premium-stop-first") && dirLoss.facts.some((f) => /premium stop fired/.test(f)));
ok("thesis fact present", dirLoss.facts.some((f) => /Thesis at exit: broken, 0 of 3/.test(f)));
ok("entry fact present", dirLoss.facts.some((f) => /grade \+8\.2, risk-on tape, buy now entry, AI grade strong \(high\)/.test(f)));

// Flat stock, premium bled.
const flat = PM.build({ ...base, exitSpot: 100.4, optionPnlPct: -31, optHiPct: 2, optLoPct: -31, maePct: -1.2, status: "theta-stop", outcome: "loss" });
ok("flat loss classified", flat.cause === "flat" && /Time, not direction/.test(flat.lesson));
ok("exit label from status", flat.facts.some((f) => f === "Exit: theta stop."));

// Right direction, wrong vehicle (stock up 3%, option down).
const veh = PM.build({ ...base, exitSpot: 103, optionPnlPct: -22, optHiPct: 18, optLoPct: -22, status: "expired", outcome: "loss" });
ok("vehicle loss classified", veh.cause === "vehicle" && /IV paid at entry/.test(veh.lesson));
ok("gave-back tag when the peak was past half the target", veh.tags.includes("gave-back") && /72% of the way/.test(veh.facts.join(" ")));

// Put side: stock down is for the trade.
const putWin = PM.build({ ...base, side: "put", exitSpot: 93, optionPnlPct: 27, optHiPct: 27, optLoPct: -28, status: "hit-tp-prem", outcome: "win" });
ok("put win is a direction win", putWin.outcome === "win" && putWin.cause === "direction" && putWin.dirMovePct === 7);
ok("needed-room tag on a win that dipped past half the stop", putWin.tags.includes("needed-room") && /needed room first/.test(putWin.lesson));
ok("put facts say a put wants down", putWin.facts.some((f) => /a put wants down/.test(f)));

// Volatility win: stock flat, option up.
const volWin = PM.build({ ...base, exitSpot: 100.2, optionPnlPct: 26, optHiPct: 26, optLoPct: -3, status: "hit-tp-prem", outcome: "win" });
ok("volatility win classified", volWin.cause === "vehicle" && /not direction/.test(volWin.lesson));

// Credit spread win with a flat stock = premium collected.
const credit = PM.build({ ...base, contract: { iv: 0.4, structure: "credit_vertical", maxLoss: 3 }, exitSpot: 100.5, optionPnlPct: 50, status: "hit-tp-prem", outcome: "win" });
ok("credit win is premium collected", credit.cause === "premium" && credit.label === "Premium collected");

// Real fill gap and legacy fraction stop.
const rf = PM.build({ ...base, exitSpot: 97, optionPnlPct: -50, realFillPnlPct: -56, sizing: { riskToStopPct: 0.5 }, exitPolicy: null, status: "hit-stop-prem", outcome: "loss", cut: 92, maePct: -3 });
ok("real fill spread cost in facts", rf.facts.some((f) => /-56\.0% at the bid\/ask \(spread cost ≈ 6\.0 points\)/.test(f)));

// Not counted / missing data.
ok("left-coverage returns none", PM.build({ ...base, outcome: "left-coverage" }).outcome === "none");
ok("missing exit spot is unknown", PM.build({ ...base, exitSpot: null, optionPnlPct: -50, outcome: "loss" }).cause === "unknown");
ok("null record", PM.build(null) === null);

// Tally.
const closed = [
  { ...base, exitSpot: 94, optionPnlPct: -52, optHiPct: 15, status: "hit-stop-prem", outcome: "loss" },
  { ...base, exitSpot: 100.4, optionPnlPct: -31, optHiPct: 1, status: "theta-stop", outcome: "loss" },
  { ...base, exitSpot: 103, optionPnlPct: -22, optHiPct: 18, status: "expired", outcome: "loss" },
  { ...base, exitSpot: 108, optionPnlPct: 27, optHiPct: 27, optLoPct: -2, status: "hit-tp-prem", outcome: "win" },
  { ...base, exitSpot: 100.1, optionPnlPct: 25, optHiPct: 25, optLoPct: -1, status: "hit-tp-prem", outcome: "win" },
  { ...base, outcome: "left-coverage" },
];
const t = PM.tally(closed);
ok("tally counts decided only", t.n === 5 && t.losses.n === 3 && t.wins.n === 2);
ok("tally loss causes", t.losses.direction === 1 && t.losses.flat === 1 && t.losses.vehicle === 1);
ok("tally win causes", t.wins.direction === 1 && t.wins.vehicle === 1);
ok("tally gave-back", t.gaveBack === 2);

// Rolling win rate.
const dec = [];
for (let i = 0; i < 30; i++) dec.push({ outcome: i % 3 === 0 ? "loss" : "win", exitDate: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}T20:00:00Z` });
const roll = PM.rollingWinRate(dec, 20);
ok("rolling starts at the fifth trade", roll.length === 26 && roll[0].i === 5 && roll[0].n === 5 && roll[0].partial === true);
ok("rolling window caps at 20", roll[roll.length - 1].n === 20 && roll[roll.length - 1].partial === false);
ok("rolling rate in range", roll.every((r) => r.rate >= 0 && r.rate <= 100 && /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
ok("rolling first rate matches", roll[0].rate === 60);
ok("rolling empty for a short list", PM.rollingWinRate(dec.slice(0, 3), 20).length === 0);
ok("rolling ignores undecided", PM.rollingWinRate(dec.concat([{ outcome: "flat", exitDate: "2026-03-01T00:00:00Z" }]), 20).length === 26);

// Generated template pieces.
const appJs = readFileSync(new URL("./render/app-js.mjs", import.meta.url), "utf8");
ok("app-js embeds POST_MORTEM", /var POST_MORTEM = \(\$\{tradePostMortemFactory\.toString\(\)\}\)\(\);/.test(appJs));
ok("closed row carries post-mortem and replay", /accPostMortemHtml\(e\) \+\n\s+accReplayHtml\(e\)/.test(appJs));
ok("scorecard tallies loss causes", appJs.includes("accLossCausesHtml(closed)"));
ok("equity sub-tab mounts the rolling chart", appJs.includes("accMountRollingWin(box, decAll)"));
ok("book risk draws exposure bars", appJs.includes("bookExposureBarsHtml(groups, usd)"));
ok("pick card shows the what-if line", appJs.includes("pickSizingYours(p)") && appJs.includes("pick-tier-yours"));
ok("narrow price chart drops the RSI 50 label and lifts the spot label", appJs.includes("if (!(narrowPc && mid)) rsiGrid") && appJs.includes("(narrowPc ? 9 : 4) * k"));
const client = readFileSync(new URL("./render/owner-insight-client.mjs", import.meta.url), "utf8");
ok("client reads the public per-ticker JSON once per symbol", client.includes("accReplayCache[sym] = fetch(dataUrl(sym + '.json')"));
ok("client has no raw regex escapes", !/[^\\]\\d\{/.test(client));
const html = readFileSync(new URL("./render/html.mjs", import.meta.url), "utf8");
ok("picks pane hosts the what-if box", html.includes('id="picks-whatif"'));

console.log(`owner-insight-smoke: ${n} checks passed`);
