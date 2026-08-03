#!/usr/bin/env node
// Offline regression check for the earnings-call structured-output contract.
// No network or GEMINI_API_KEY required.
import assert from "node:assert/strict";
import { transcriptSummaryGenerateConfig } from "./build.mjs";

const config = transcriptSummaryGenerateConfig();
assert.equal(config.responseMimeType, "application/json");
assert.ok(config.responseJsonSchema, "transcript config must use responseJsonSchema");
assert.ok(!Object.hasOwn(config, "responseSchema"), "legacy responseSchema rejects numeric maxItems constraints");

let arraySchemas = 0;
const visit = (node, path = "$") => {
  if (!node || typeof node !== "object") return;
  if (node.type === "array") {
    arraySchemas += 1;
    assert.ok(
      Number.isInteger(node.maxItems) && node.maxItems > 0,
      `${path}.maxItems must be a positive JSON Schema integer`,
    );
  }
  if (node.items) visit(node.items, `${path}.items`);
  for (const [key, child] of Object.entries(node.properties || {})) {
    visit(child, `${path}.properties.${key}`);
  }
};

visit(config.responseJsonSchema);
assert.ok(arraySchemas >= 17, `expected the capped transcript arrays, found ${arraySchemas}`);
console.log(`transcript smoke passed — ${arraySchemas} capped arrays use responseJsonSchema`);
