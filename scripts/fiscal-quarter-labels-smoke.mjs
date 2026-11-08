// Fiscal-quarter labels on the fundamentals charts (QC of builds #173-#222).
// Target and Home Depot name a fiscal year by the year it starts in, so the
// quarter ending October 2026 is their Q3 2026, not Q3 2027. Others with a
// January year end (Walmart, Nvidia) keep the end-year name. Pure; no network.
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderAppJs } from "./render/app-js.mjs";

const source = renderAppJs();
new vm.Script(source);
const fn = (name) => {
  const start = source.indexOf("  function " + name + "(");
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n  }", start) + 4;
  return source.slice(start, end);
};
const varLine = (name) => {
  const start = source.indexOf("  var " + name + " =");
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf(";\n", start) + 1);
};

const ctx = vm.createContext({ Date, Math, String, isNaN });
vm.runInContext(varLine("FISCAL_YEAR_NAMED_BY_START"), ctx);
vm.runInContext(fn("fmtQuarterLabel"), ctx);
const label = (date, fye, sym) => ctx.fmtQuarterLabel(date, null, fye, !!ctx.FISCAL_YEAR_NAMED_BY_START[sym]);

// Target: fiscal 2025 ran Feb 2025 to Jan 2026.
assert.equal(label("2025-04-30", 1, "TGT"), "Q1 '25");
assert.equal(label("2026-01-31", 1, "TGT"), "Q4 '25");
assert.equal(label("2026-10-31", 1, "TGT"), "Q3 '26", "the Nov 18 report is Target's Q3 2026");
assert.equal(label("2025-10-31", 1, "HD"), "Q3 '25");

// End-year naming is unchanged.
assert.equal(label("2026-10-31", 1, "WMT"), "Q3 '27");
assert.equal(label("2025-10-31", 1, "NVDA"), "Q3 '26");
assert.equal(label("2025-12-31", 9, "AAPL"), "Q1 '26");
assert.equal(label("2025-12-31", 12, "MSFT"), "Q4 '25");
assert.equal(label("2025-12-31", null, "MSFT"), "Q4 '25", "no year-end month falls back to calendar quarters");

// The fundamentals charts pass the symbol through.
const calls = source.split("renderHistoryChart({").length - 1;
const withSymbol = source.split("symbol: state.symbol,").length - 1;
assert.ok(withSymbol >= 7 && calls >= 8, `${withSymbol} of ${calls} chart calls pass the symbol`);

console.log("fiscal quarter labels smoke ok");
