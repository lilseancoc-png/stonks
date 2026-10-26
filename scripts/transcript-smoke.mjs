#!/usr/bin/env node
// Offline regression check for the earnings-call structured-output contract.
// No network or GEMINI_API_KEY required.
import assert from "node:assert/strict";
import {
  orderTranscriptProbeSymbols,
  shouldRefreshTranscripts,
  TRANSCRIPTS_PER_BUILD,
  transcriptSummaryGenerateConfig,
  normalizeTranscriptSummary,
  updateEarningsCallsData,
  TRANSCRIPT_BRIEF_FORMAT,
} from "./build.mjs";
import { prepareTranscriptInput, transcriptCharacterBudget } from "../lib/transcript-input.mjs";
import { extractCapexGuidanceFromBrief } from "../lib/ai-capex.mjs";

const config = transcriptSummaryGenerateConfig();
assert.equal(config.responseMimeType, "application/json");
assert.ok(config.responseSchema, "transcript config must use the OpenAPI responseSchema path");
assert.ok(!Object.hasOwn(config, "responseJsonSchema"), "the backend rejects this deeply nested JSON Schema");
assert.equal(TRANSCRIPTS_PER_BUILD, 12, "default transcript capacity must cover 12 new calls per build");
assert.equal(shouldRefreshTranscripts({}), true, "local/full builds summarize unless REFRESH_TRANSCRIPTS is off");
assert.equal(shouldRefreshTranscripts({ REFRESH_TRANSCRIPTS: "false" }), false, "daily.yml build job must skip Gemini summaries");
assert.equal(shouldRefreshTranscripts({ REFRESH_TRANSCRIPTS: "0" }), false);

let arraySchemas = 0;
const visit = (node, path = "$") => {
  if (!node || typeof node !== "object") return;
  if (node.type === "array") {
    arraySchemas += 1;
    assert.ok(!Object.hasOwn(node, "maxItems"), `${path}.maxItems must stay off the API wire schema`);
  }
  if (node.items) visit(node.items, `${path}.items`);
  for (const [key, child] of Object.entries(node.properties || {})) {
    visit(child, `${path}.properties.${key}`);
  }
};

visit(config.responseSchema);
assert.ok(arraySchemas >= 17, `expected the capped transcript arrays, found ${arraySchemas}`);
assert.match(config.systemInstruction, /Hard JSON array limits: .*execSummary<=5/);
assert.match(config.systemInstruction, /mgmtTone\.phrases<=2/);
assert.match(config.systemInstruction, /participants<=12/);
assert.equal(config.maxOutputTokens, 16384, "retain headroom until a live output/quality comparison validates a smaller cutoff");
assert.equal(TRANSCRIPT_BRIEF_FORMAT, "compact-v1");
assert.match(config.systemInstruction, /complete supplied transcript/i);
assert.match(config.systemInstruction, /final Q&A/);
assert.match(config.systemInstruction, /changed\/withdrawn/);
assert.match(config.systemInstruction, /GAAP\/non-GAAP/);

// Input retention is independent of where material appears. Preserve final Q&A,
// qualifications and odd formatting; never silently slice at the budget edge.
const source = [
  "CFO: Revenue was $12 billion; adjusted EPS was $2.10, not GAAP EPS.",
  "CEO: Our outlook assumes no additional export restrictions.",
  "Analyst: Is $100 billion a capex commitment?",
  "CFO: No. FY2026 capital expenditures remain $40-45 billion.",
  "Analyst: And the outlook discussed in prepared remarks?",
  "CFO: We withdraw the FY2026 margin outlook because of unresolved regulatory risk.",
].join("\r\n\r\n\t");
const retained = prepareTranscriptInput(source, source.length);
assert.equal(retained.coverage, "complete");
assert.equal(retained.text.replace(/\s/g, ""), source.replace(/\s/g, ""));
assert.ok(retained.text.endsWith("because of unresolved regulatory risk."));
assert.equal(retained.sourceHash, prepareTranscriptInput(retained.text, source.length).sourceHash);
assert.throws(() => prepareTranscriptInput(source, retained.text.length - 1), err => err.transcriptContentFailure && /not clipped/.test(err.message));
assert.equal(prepareTranscriptInput(retained.text, retained.text.length).text, retained.text);
assert.throws(() => prepareTranscriptInput("", 100));
assert.throws(() => prepareTranscriptInput(source, NaN));
assert.equal(transcriptCharacterBudget(undefined),90_000);
assert.equal(transcriptCharacterBudget(""),90_000);
assert.equal(transcriptCharacterBudget("10000"),20_000,"a smaller configured budget must not silently expand to 90k");
assert.equal(transcriptCharacterBudget("50000"),50_000);
for (const bad of ["-1","0","NaN","Infinity","20000.5"]) assert.throws(()=>transcriptCharacterBudget(bad), /positive integer/);

const candidate = {
  headline: "Reported results; margin outlook withdrawn, capex maintained",
  execSummary: ["Revenue was $12 billion.", "Adjusted EPS was $2.10; GAAP differs.", "Margin outlook withdrawn over regulatory uncertainty."],
  financials: [{label:"Revenue",value:"$12 billion"},{label:"Adjusted EPS",value:"$2.10",context:"Not GAAP EPS"}],
  guidance: [{metric:"Capital expenditures",value:"$40-45 billion",period:"FY2026",change:"maintained"},{metric:"Margin outlook",value:"Withdrawn due to unresolved regulatory risk",period:"FY2026",change:"withdrawn"}],
  risks: ["Outlook assumes no additional export restrictions.","Unresolved regulatory risk."],
  qa: [{analyst:"Analyst",question:"Is $100 billion committed?",respondent:"CFO",answer:"No. FY2026 capex remains $40-45 billion."}],
  operational: [],
  mgmtTone: {label:"cautious",stance:"dovish",summary:"Management qualified the outlook.",phrases:[]},
  analystTone: {label:"probing",summary:"Analysts questioned the capex commitment.",phrases:[]},
  quotes: [],
};
const summary = normalizeTranscriptSummary(candidate);
assert.deepEqual(summary.guidance, candidate.guidance);
assert.equal(summary.financials[1].context,"Not GAAP EPS");
assert.equal(summary.qa[0].answer,candidate.qa[0].answer);
assert.deepEqual(summary.risks,candidate.risks);
assert.deepEqual(summary.segments, [], "optional sections remain empty rather than fabricated");
const guide = extractCapexGuidanceFromBrief({callDate:"2026-10-23",summary}, {calendarFiscal:true,reference:42e9});
assert.equal(guide.low,40e9);
assert.equal(guide.high,45e9);
assert.throws(() => normalizeTranscriptSummary({...candidate,guidance:Array.from({length:11},()=>candidate.guidance[0])}), /not clipped/);
assert.throws(() => normalizeTranscriptSummary({...candidate,qa:Array.from({length:4},()=>candidate.qa[0])}), /not clipped/);
const longRisk = "Risk detail. ".repeat(60)+"Do not omit this final caveat.";
const longContext = "Reported comparison. ".repeat(20)+"This comparison excludes the acquisition.";
const longValue = "Outlook details. ".repeat(20)+"Subject to regulatory approval.";
const complete = normalizeTranscriptSummary({...candidate,risks:[longRisk],financials:[{label:"Revenue",value:"$12 billion",context:longContext}],guidance:[{metric:"Revenue outlook",value:longValue}]});
assert.equal(complete.risks[0],longRisk,"long useful fields must not reject the entire paid result");
assert.equal(complete.financials[0].context,longContext);
assert.equal(complete.guidance[0].value,longValue);
for (const malformed of [
  {...candidate,guidance:"missing"}, {...candidate,guidance:[null]},
  {...candidate,guidance:[{metric:"Capex"}]}, {...candidate,guidance:[{metric:"Capex",value:" "}]},
  {...candidate,risks:[null]}, {...candidate,qa:[{analyst:"Analyst",question:"Where?",respondent:"CFO"}]},
  {...candidate,mgmtTone:null}, {...candidate,financials:[{label:"Revenue",value:12}]},
  {...candidate,epsVerdict:"made-up"},
]) assert.throws(()=>normalizeTranscriptSummary(malformed),err=>err.transcriptContentFailure,"malformed evidence must not disappear into an empty section");

// Formatting changes must not cause a bulk paid refresh of valid old summaries.
const oldEntry = {sym:"AAPL",v:"ect3",quarter:"Q3 FY2026",headline:"Existing valid summary"};
const carried = await updateEarningsCallsData({prior:{calls:{AAPL:oldEntry}},skipSummarize:true});
assert.deepEqual(carried.index.calls.AAPL,oldEntry);
assert.deepEqual(carried.details,[]);

assert.deepEqual(
  orderTranscriptProbeSymbols(
    ["AAPL", "TSLA", "INTC", "MSFT", "NVDA"],
    {
      AAPL: { date: "2026-07-30" },
      TSLA: { date: "2026-07-23" },
      INTC: { date: "2026-07-24" },
      MSFT: { date: "2026-07-30" },
    },
  ),
  ["AAPL", "MSFT", "INTC", "TSLA", "NVDA"],
  "transcript probes must run from the latest earnings print to the oldest, with unknown dates last",
);
console.log(`transcript smoke passed — ${arraySchemas} arrays keep caps in the prompt and off the API wire schema`);
