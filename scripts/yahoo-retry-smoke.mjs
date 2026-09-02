#!/usr/bin/env node
// Offline regression checks for the Yahoo chart retry boundary.
import assert from "node:assert/strict";
import {
  isTransientYahooError,
  summarizeYahooError,
  withYahooRetry,
} from "../lib/yahoo-retry.mjs";

const legacyHtml = new Error(
  `<!doctype html><html><body><h1>HTTP Status 400 - Bad Request</h1></body></html>`,
);
let transientAttempts = 0;
const waits = [];
const messages = [];
const recovered = await withYahooRetry(
  async () => {
    transientAttempts += 1;
    if (transientAttempts < 3) throw legacyHtml;
    return { quotes: [{ close: 100 }] };
  },
  {
    attempts: 3,
    backoffMs: [10, 20],
    sleep: async (ms) => waits.push(ms),
    log: (message) => messages.push(message),
    label: "TEST daily history",
  },
);

assert.equal(
  transientAttempts,
  3,
  "transient Yahoo chart failures must consume the bounded retry budget",
);
assert.deepEqual(waits, [10, 20]);
assert.equal(recovered.quotes.length, 1);
assert.match(messages[0], /HTTP 400 Bad Request/);
assert.match(messages.at(-1), /succeeded on attempt 3/);
assert.equal(summarizeYahooError(legacyHtml), "HTTP 400 Bad Request");

let validationAttempts = 0;
await assert.rejects(
  withYahooRetry(
    async () => {
      validationAttempts += 1;
      throw new Error("FailedYahooValidationError: schema mismatch");
    },
    {
      attempts: 3,
      sleep: async () => assert.fail("validation failures must not sleep"),
      log: () => {},
    },
  ),
  /FailedYahooValidationError/,
);
assert.equal(
  validationAttempts,
  1,
  "deterministic validation failures must not retry",
);
assert.equal(isTransientYahooError(legacyHtml), true);

let exhaustedAttempts = 0;
await assert.rejects(
  withYahooRetry(
    async () => {
      exhaustedAttempts += 1;
      throw new Error("fetch failed");
    },
    { attempts: 3, backoffMs: [0, 0], sleep: async () => {}, log: () => {} },
  ),
  /fetch failed/,
);
assert.equal(
  exhaustedAttempts,
  3,
  "persistent transport failures must still fail closed after three attempts",
);

console.log("Yahoo retry smoke checks passed.");
