// Offline check for the AI disruption registry (lib/ai-disruption/).
import assert from "node:assert/strict";
import { TICKERS } from "./build.mjs";
import { containsInvestmentAdvice } from "../lib/public-data-policy.mjs";
import {
  CAPABILITIES, LABS, LAUNCHES, COMPANIES, CAPTURE_WEIGHTS, validateRegistry,
  captureGrades, captureScore, capabilityBoard, hitsForLaunch, outcomeFor,
  capabilityPressure, coverageOf,
} from "../lib/ai-disruption/index.mjs";

assert.deepEqual(validateRegistry({ tickers: TICKERS, adviceCheck: containsInvestmentAdvice }), []);
assert.ok(CAPABILITIES.length >= 25 && LABS.length >= 5 && LAUNCHES.length >= 50);
assert.ok(Math.abs(Object.values(CAPTURE_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);

// Coverage: the software names the site covers are in the map, and the names
// the owner asked to be able to mention stay mention-only.
const cov = Object.fromEntries(COMPANIES.map((c) => [c.id, coverageOf(c, TICKERS)]));
for (const sym of ["ADBE", "CRM", "NOW", "SNOW", "INTU", "TEAM", "MSFT"]) assert.equal(cov[sym], "covered", sym);
for (const sym of ["CHGG", "SSTK", "DBX", "ASAN", "PATH", "MNDY"]) assert.equal(cov[sym], "mention", sym);
assert.equal(cov["Otter.ai"], "private");

// Scoring: bounded, monotone in the facts.
const base = { capabilities: ["slides"], how: "direct", plans: ["consumer"], availability: "beta", autonomy: "draft", coverage: 3 };
const s0 = captureScore(base);
assert.ok(s0 > 0 && s0 < 100);
assert.ok(captureScore({ ...base, availability: "ga" }) > s0);
assert.ok(captureScore({ ...base, plans: ["free", "consumer"] }) > s0);
assert.ok(captureScore({ ...base, autonomy: "unattended" }) > s0);
assert.ok(captureScore({ ...base, coverage: 5 }) > s0);
assert.equal(captureScore({ ...base, plans: [], coverage: 0, availability: "preview" }) < s0, true);
assert.equal(captureGrades({ ...base, grades: { enterprise: 5 } }).enterprise, 5, "a row may override a derived grade");
assert.equal(captureScore({ capabilities: [], plans: ["free", "enterprise"], availability: "ga", autonomy: "unattended", coverage: 5, how: "platform", grades: { integration: 5 } }), 98);

// Outcome rules.
assert.equal(outcomeFor("direct", "core"), "obsolescence");
assert.equal(outcomeFor("workflow", "core"), "business-model");
assert.equal(outcomeFor("platform", "core"), "business-model");
assert.equal(outcomeFor("direct", "addon"), "commoditization");
assert.equal(outcomeFor("direct", "adjacent"), "watch");

// A known launch maps to the companies the PDF named.
const study = LAUNCHES.find((l) => l.title === "Study mode");
assert.deepEqual(hitsForLaunch(study).map((h) => h.company), ["CHGG"]);
assert.equal(hitsForLaunch(study)[0].outcome, "obsolescence");
const plugins = LAUNCHES.find((l) => l.id.startsWith("2026-02-24-anthropic"));
const hit = hitsForLaunch(plugins).map((h) => h.company);
for (const sym of ["CRM", "HUBS", "DOCU", "SNOW"]) assert.ok(hit.includes(sym), sym);
for (const h of hitsForLaunch(plugins)) assert.ok(!("score" in h) && !("grade" in h));

// Board: a cell only moves up, and reading it at an earlier date ignores later launches.
const early = capabilityBoard(LAUNCHES, "2025-01-01");
const now = capabilityBoard(LAUNCHES);
assert.ok(!early.slides?.anthropic);
assert.ok(now.slides.anthropic.score >= now.slides.anthropic.prior);
for (const cap of Object.keys(early)) for (const lab of Object.keys(early[cap])) assert.ok(now[cap][lab].score >= early[cap][lab].score);

// Pressure fades.
assert.ok(capabilityPressure("slides", "2026-11-15") > capabilityPressure("slides", "2027-06-01"));
assert.equal(capabilityPressure("slides", "2020-01-01"), 0);

const checked = LAUNCHES.filter((l) => l.sourceChecked).length;
console.log(`ai-disruption smoke: ok (${LAUNCHES.length} launches, ${checked} source-checked, ${COMPANIES.length} companies, ${CAPABILITIES.length} capabilities)`);
