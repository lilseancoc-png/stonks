#!/usr/bin/env node
// Offline regression check for the earnings-call structured-output contract.
// No network or GEMINI_API_KEY required.
import assert from "node:assert/strict";
import {
  orderTranscriptProbeSymbols,
  TRANSCRIPTS_PER_BUILD,
  transcriptSummaryGenerateConfig,
} from "./build.mjs";

const config = transcriptSummaryGenerateConfig();
assert.equal(config.responseMimeType, "application/json");
assert.ok(config.responseSchema, "transcript config must use the OpenAPI responseSchema path");
assert.ok(!Object.hasOwn(config, "responseJsonSchema"), "the backend rejects this deeply nested JSON Schema");
assert.equal(TRANSCRIPTS_PER_BUILD, 12, "default transcript capacity must cover 12 new calls per build");

let arraySchemas = 0;
const visit = (node, path = "$") => {
  if (!node || typeof node !== "object") return;
  if (node.type === "array") {
    arraySchemas += 1;
    assert.ok(
      typeof node.maxItems === "string" && /^\d+$/.test(node.maxItems) && Number(node.maxItems) > 0,
      `${path}.maxItems must be a positive string-encoded OpenAPI int64`,
    );
  }
  if (node.items) visit(node.items, `${path}.items`);
  for (const [key, child] of Object.entries(node.properties || {})) {
    visit(child, `${path}.properties.${key}`);
  }
};

visit(config.responseSchema);
assert.ok(arraySchemas >= 17, `expected the capped transcript arrays, found ${arraySchemas}`);

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
console.log(`transcript smoke passed — ${arraySchemas} capped arrays use OpenAPI responseSchema int64 strings`);
