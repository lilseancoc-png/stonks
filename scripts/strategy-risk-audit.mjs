// Read-only review of the active Top Picks exit gates and an optional private
// snapshot. Usage: node scripts/strategy-risk-audit.mjs [path/to/picks-accuracy.json]
// Does not fetch data, write files, place orders, or expose individual trades.
import { readFile } from "node:fs/promises";
import { applyPickSizing, resolvePickOutcome } from "./build.mjs";

const round = (n) => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
const number = (v) => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const mean = (a) => a.length ? a.reduce((s, n) => s + n, 0) / a.length : null;

function exitBoundary(structure, direction) {
  const closes = (pct) => resolvePickOutcome({ structure, modeledOptPnlPct: pct * direction })?.status === (direction > 0 ? "hit-tp-prem" : "hit-stop-prem");
  if (!closes(1000)) return null; // No hard TP when the optional scale-out is on.
  let low = 0, high = 1000;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (closes(mid)) high = mid;
    else low = mid;
  }
  return round(high);
}

function exitEconomics(structure) {
  const win = exitBoundary(structure, 1), loss = exitBoundary(structure, -1);
  return { structure, plannedWinPctOfBasis: win, plannedLossPctOfBasis: loss,
    breakEvenWinRatePctBeforeCosts: win == null || loss == null ? null : round(loss / (win + loss) * 100),
    costSensitivity: win == null || loss == null ? [] : [0, 2, 5].map((cost) => ({
      roundTripCostPctOfEntryBasis: cost, breakEvenWinRatePct: round((loss + cost) / (win + loss) * 100),
    })),
    assumption: "Exactly two exit outcomes at the gates; fixed round-trip cost in entry-basis units. Not a prediction or a guaranteed stop fill." };
}

function returnOnRisk(t) {
  const c = t.contract || {}, pct = number(t.optionPnlPct);
  const credit = c.structure === "credit_vertical";
  const basis = number(credit ? c.netCredit : c.netDebit) ?? number(c.mid);
  const risk = number(c.maxLoss) ?? (credit ? null : basis);
  return pct != null && basis > 0 && risk > 0 ? pct * basis / risk : null;
}

function summarize(trades) {
  const rs = trades.map(returnOnRisk).filter((n) => n != null);
  const wins = rs.filter((r) => r > 0), losses = rs.filter((r) => r < 0);
  const n = rs.length, p = n ? wins.length / n : null;
  const averageWin = mean(wins), averageLoss = losses.length ? -mean(losses) : null;
  const z = 1.96, denominator = n ? 1 + z * z / n : null;
  const center = n ? (p + z * z / (2 * n)) / denominator : null;
  const half = n ? z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator : null;
  const entryQuotes = (t) => {
    const c = t.contract || {};
    return Array.isArray(c.legs) && c.legs.length
      ? c.legs.every((l) => number(l.bid) != null && number(l.ask) != null)
      : number(c.bid) != null && number(c.ask) != null;
  };
  return { trades: trades.length, withRiskDenominator: n, wins: wins.length, losses: losses.length,
    modeledWinRatePct: p == null ? null : round(p * 100),
    averageWinPctOfMaxLoss: round(averageWin), averageLossPctOfMaxLoss: round(averageLoss),
    meanModeledReturnPctOfMaxLoss: round(mean(rs)),
    breakEvenAtObservedAveragesPct: averageWin == null || averageLoss == null ? null : round(averageLoss / (averageWin + averageLoss) * 100),
    wilson95WinRatePct: n ? [round((center - half) * 100), round((center + half) * 100)] : null,
    withStoredEntryBidAsk: trades.filter(entryQuotes).length,
    withQuoteBasedExitMark: trades.filter((t) => number(t.realFillPnlPct) != null && t.realFillBasis === "quote").length,
    withModelFallbackFillMark: trades.filter((t) => number(t.realFillPnlPct) != null && t.realFillBasis === "model").length,
    withStoredGradeModelVersion: trades.filter((t) => typeof t.gradeModelVersion === "string").length,
    interpretation: "Equal initial maximum-loss weighting; not portfolio return. Constant-entry-IV model marks. Wilson interval assumes independent, identically distributed trades; correlated picks and model changes weaken that assumption." };
}

const sizingExample = Array.from({ length: 5 }, () => ({ total: 7, contract: { structure: "long", mid: 10 }, entry: { now: true } }));
applyPickSizing(sizingExample);
const result = {
  exitEconomics: ["long", "debit_vertical", "credit_vertical"].map(exitEconomics),
  displaySizingExample: { assumption: "Five equal Strong picks, $10 premium each, regimeGross=1; account uses configured PICKS_DISPLAY_ACCOUNT, default $25,000.",
    suggestedContractsEach: sizingExample[0].sizing.suggestedContracts,
    maximumLossBudgetPctEach: round(sizingExample[0].sizing.weight * 100),
    totalMaximumLossBudgetPct: round(sizingExample.reduce((s, p) => s + p.sizing.weight, 0) * 100),
    note: "Display sizing only; the simulator and the one-contract Webull mirror use different sizing rules." },
};

if (process.argv[2]) {
  const snapshot = JSON.parse(await readFile(process.argv[2], "utf8"));
  if (!Array.isArray(snapshot.closed) || !Array.isArray(snapshot.open)) throw new Error("Expected a picks-accuracy snapshot with open and closed arrays");
  const decided = snapshot.closed.filter((t) => t && ["win", "loss"].includes(t.outcome) && number(t.optionPnlPct) != null);
  const structures = [...new Set(decided.map((t) => t.contract?.structure || "long"))];
  result.snapshot = { builtAtIso: snapshot.builtAtIso ?? null, totalClosed: snapshot.closed.length, open: snapshot.open.length,
    decided: summarize(decided), byStructure: Object.fromEntries(structures.map((s) => [s, summarize(decided.filter((t) => (t.contract?.structure || "long") === s))])) };
}
console.log(JSON.stringify(result, null, 2));
