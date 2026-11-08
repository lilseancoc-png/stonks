// Narrative lifecycle outlook and the Top Picks roster wording (QC of builds
// #273-#322). When the risk checks move a story to Challenges or Collapse, the
// model's "why here" and "next" were written for its own earlier stage, so the
// card says the checks moved it, shows the model's text as the earlier read and
// drops the stale next step. The roster's "out" reason names the real roster
// size. Pure; no network.
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderAppJs } from "./render/app-js.mjs";
import { buildPicksRoster } from "./build.mjs";
import { PICKS_COUNT } from "../lib/top-picks-config.mjs";

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

const ctx = vm.createContext({ String, Object });
vm.runInContext(varLine("LIFECYCLE_STAGES"), ctx);
vm.runInContext(varLine("LIFECYCLE_LABELS"), ctx);
vm.runInContext(fn("escapeHtml"), ctx);
vm.runInContext(fn("lifecycleOutlookHtml"), ctx);
const outlook = (o, cur, base) => ctx.lifecycleOutlookHtml(o, cur, base);

const o = { rationale: "Orders are landing as guided.", nextStage: "peak", trigger: "A second guide raise" };

// Moved by the risk checks: says so, keeps the model's text as the earlier read, drops "Next".
{
  const html = outlook(o, "challenges", "validation");
  assert.match(html, /moved this story from Validation to Challenges/);
  assert.match(html, /Earlier read/);
  assert.match(html, /Orders are landing as guided\./);
  assert.doesNotMatch(html, />Next</, "a next step written for the old stage is dropped");
  assert.match(html, /Watch for/);
}

// Not moved: the model's own read stands, with its next step.
{
  const html = outlook(o, "validation", "validation");
  assert.match(html, />Why here</);
  assert.doesNotMatch(html, /Earlier read|moved this story/);
  assert.match(html, />Next</);
  assert.match(html, /is-advancing/);
}

// Older payloads with no base stage render as before.
assert.match(outlook(o, "validation", undefined), />Next</);
assert.equal(outlook(null, "validation", null), "");
// A move with no AI outlook still explains the stage.
assert.match(outlook(null, "collapse", "peak"), /moved this story from Peak to Collapse/);

// Roster: a name that still clears the bar but left the list names the real size.
{
  const pick = (symbol, total) => ({ symbol, side: "call", total, group: "actionable", pillars: {} });
  const grades = { AAA: { total: 6, side: "call", pillars: {} }, BBB: { total: 2, side: "call", pillars: {} } };
  const r = buildPicksRoster([pick("CCC", 7)], [pick("AAA", 6), pick("BBB", 5)], {}, grades, "2026-11-09T16:00:00Z");
  const why = Object.fromEntries(r.exited.map((e) => [e.symbol, e.whyText]));
  assert.equal(why.AAA, `out-ranked off the top ${PICKS_COUNT}`);
  assert.doesNotMatch(why.AAA, /top 10/);
  assert.equal(why.BBB, "dropped below the actionable bar");
}

console.log("narrative lifecycle smoke ok");
